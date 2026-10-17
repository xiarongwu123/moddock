const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createDeepSeek, loadStudioAI, createStudioKeyStore, textureImage } = require('../studio-ai.cjs');
const { removeStudioSamples } = require('../studio-migration.cjs');
const { pngBytes } = require('../content-pack.cjs');
const { freshText, readLog } = require('../studio-lifecycle.cjs');
const { piFixture, key } = require('./pi-fixture.cjs');
const planPayload = { prompt: 'Create a mod', types: [{ id: 'project-plan', available: true }] };
const hostContext = body => {
 const content = body.messages.find(message => message.role === 'user').content;
 const text = typeof content === 'string' ? content : content.map(part => part.text || '').join('');
 return JSON.parse(text.split('Host context (untrusted reference data):\n').at(-1));
};
async function temp(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-ai-test-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }

test('provider uses real Pi streaming tools, bounded context and server-only credentials', async t => {
 const fixture = await piFixture(t, { result: { title: 'Plan' } });
 const ai = createDeepSeek({ apiKey: key, pi: fixture.pi });
 assert.deepEqual(await ai.plan({ ...planPayload, context: { game: { name: 'Game' }, guide: { text: 'a'.repeat(20000) } }, diagnostic: { installPath: '/private/game', engine: { key: 'unknown' } } }), { title: 'Plan' });
 const request = fixture.requests[0]; assert.equal(request.body.model, 'deepseek-flash'); assert.equal(request.body.stream, true);
 assert.equal(request.authorization, 'Bearer ' + key); assert.ok(!JSON.stringify(request.body).includes(key)); assert.ok(!JSON.stringify(request.body).includes('/private/game'));
 assert.equal(hostContext(request.body).guide.length, 12000); assert.equal(ai.provider.harness, 'pi-agent'); assert.equal(ai.agent, undefined);
});
test('planner exposes only available host schemas and source-only capability', async t => {
 const fixture = await piFixture(t, { result: { title: 'Plan' } }), ai = createDeepSeek({ apiKey: key, pi: fixture.pi });
 await ai.plan({ ...planPayload, types: [...planPayload.types, { id: 'custom-project', available: true }, { id: 'dialogue', available: false }, { id: 'unknown-kind', available: true }], capability: { creativeDefaultsDelegated: true }, validation: { error: 'Invalid steps' }, previousPlan: { kind: 'dialogue' } });
 const system = fixture.requests[0].body.messages[0].content, context = hostContext(fixture.requests[0].body);
 assert.match(system, /Allowed kind IDs: \["project-plan","custom-project"\]/); assert.match(system, /explicitly requested a document\/source deliverable/); assert.match(system, /without questions/);
 for (const unwanted of ['kind="dialogue"', 'kind="texture"', 'kind="ue4ss-lua"', 'kind="bepinex-plugin"']) assert.ok(!system.includes(unwanted), unwanted);
 assert.deepEqual(context.supportedTypes.map(type => type.id), ['project-plan', 'custom-project']); assert.equal(context.validation.error, 'Invalid steps');
 await assert.rejects(ai.plan({ types: [{ id: 'dialogue', available: false }] }), /没有可用/);
});
test('Pi errors are bounded, redacted and never fall back to direct model requests', async t => {
 for (const status of [400, 401, 402, 429, 500]) {
  const fixture = await piFixture(t, { respond: async () => ({ status }) });
  const ai = createDeepSeek({ apiKey: key, pi: fixture.pi });
  await assert.rejects(ai.plan(planPayload), error => !error.message.includes(key) && error.diagnostic.upstreamStatus === status && error.diagnostic.reason.includes('fixture failure'));
  assert.equal(fixture.requests.length, status === 429 || status >= 500 ? 4 : 1);
 }
 const fixture = await piFixture(t), ai = createDeepSeek({ apiKey: key, pi: fixture.pi });
 await assert.rejects(ai.plan({ ...planPayload, signal: AbortSignal.abort() })); assert.equal(fixture.requests.length, 0);
});
test('model-designed palette becomes a validated PNG and malformed output gets bounded repair', async t => {
 const palette = { '.': '#00000000', A: '#55bbffff' }, rows = Array.from({ length: 16 }, (_, y) => '.'.repeat(y) + 'A' + '.'.repeat(15 - y));
 let attempts = 0;
 const fixture = await piFixture(t, { respond: async ({ phase, body }) => {
  if (phase !== 'submit') return null;
  attempts++;
  if (attempts === 2) assert.ok(body.messages.some(message => message.role === 'tool' && /16/.test(message.content)));
  return { result: { kind: 'texture', name: 'Generated', author: 'Fixture', palette, rows: attempts === 1 ? rows.slice(1) : rows } };
 } });
 const ai = createDeepSeek({ apiKey: key, pi: fixture.pi }), draft = await ai.generate({ kind: 'texture', prompt: 'Blue sword' });
 assert.equal(attempts, 2); assert.equal(draft.image, textureImage(rows.map(row => Array.from(row, symbol => palette[symbol])))); assert.equal(draft.rows, undefined);
 assert.equal(fixture.requests.filter(request => !request.body.messages.some(message => message.role === 'tool')).length, 1);
 assert.equal(pngBytes(draft.image).subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); assert.throws(() => textureImage([['red']]), /16/);
});
test('wrong artifact kinds are corrected in the same Pi session while preserving the original request', async t => {
 let attempts = 0;
 const expected = { kind: 'project-plan', name: 'Companion', author: 'Player', plan: 'Inspect actual game API evidence.' };
 const fixture = await piFixture(t, { respond: async ({ phase, body }) => {
  if (phase !== 'submit') return null;
  assert.equal(hostContext(body).prompt, 'Create a Chinese companion');
  return { result: ++attempts === 1 ? { kind: 'dialogue' } : expected };
 } });
 const ai = createDeepSeek({ apiKey: key, pi: fixture.pi });
 assert.deepEqual(await ai.generate({ kind: 'project-plan', prompt: 'Create a Chinese companion' }), expected); assert.equal(attempts, 2);
 assert.equal(fixture.requests.filter(request => !request.body.messages.some(message => message.role === 'tool')).length, 1);
});
test('invalid texture output preserves the real error after bounded repairs without opening another session', async t => {
 const fixture = await piFixture(t, { result: { kind: 'texture', name: 'Sword', author: 'Fixture', pixels: [] } }), ai = createDeepSeek({ apiKey: key, pi: fixture.pi });
 await assert.rejects(ai.generate({ kind: 'texture', prompt: 'A sword' }), /AI 贴图/);
 assert.equal(fixture.requests.filter(request => !request.body.messages.some(message => message.role === 'tool')).length, 1);
});
test('an accepted artifact completes immediately without another model response that could lose the result', async t => {
 const expected = { kind: 'project-plan', name: 'Accepted', author: 'Fixture', plan: 'Inspect the local game API.' };
 const fixture = await piFixture(t, { result: expected, respond: ({ phase }) => phase === 'done' ? { status: 503 } : null });
 const draft = await createDeepSeek({ apiKey: key, pi: fixture.pi }).generate({ kind: 'project-plan', prompt: 'Write a plan' });
 assert.deepEqual(draft, expected); assert.equal(fixture.requests.length, 2);
});
test('encrypted bootstrap credentials configure Pi and plaintext bootstrap is consumed', async t => {
 const root = await temp(t), bootstrapFile = path.join(root, 'bootstrap.json'), encrypted = path.join(root, 'encrypted.bin');
 const encryption = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text).reverse(), decryptString: bytes => Buffer.from(bytes).reverse().toString() };
 const store = createStudioKeyStore(encrypted, encryption); await store.write({ apiKey: 'sk-older-test-key-123456789' }); await fs.writeFile(bootstrapFile, JSON.stringify({ apiKey: key }), { mode: 0o600 });
 const fixture = await piFixture(t, { result: { title: 'Plan' } }), ai = await loadStudioAI({ keyStore: store, bootstrapFile, pi: fixture.pi });
 await ai.plan(planPayload); assert.equal(fixture.requests[0].authorization, 'Bearer ' + key); assert.equal((await store.read()).apiKey, key); await assert.rejects(fs.access(bootstrapFile));
 assert.ok(!(await fs.readFile(encrypted, 'utf8')).includes(key)); await assert.rejects(createStudioKeyStore(encrypted, { isEncryptionAvailable: () => false }).write({ apiKey: key }), /加密不可用/);
});
test('migration removes sample products while preserving ideas and genuine products', async t => {
 const root = await temp(t), owner = path.join(root, 'a'.repeat(64)), sample = crypto.randomUUID(), genuine = crypto.randomUUID(), id = crypto.randomUUID();
 for (const [artifactId, record] of [[sample, { preview: { mode: 'local-template', aiUsed: false } }], [genuine, { draft: { name: 'Real' } }]]) { await fs.mkdir(path.join(owner, artifactId), { recursive: true }); await fs.writeFile(path.join(owner, artifactId, 'record.json'), JSON.stringify(record)); }
 await fs.mkdir(path.join(owner, 'conversations')); const file = path.join(owner, 'conversations', id + '.json');
 await fs.writeFile(file, JSON.stringify({ id, mode: 'preview', artifactId: sample, messages: [{ role: 'user', content: 'Keep this idea' }, { role: 'assistant', source: 'mock', content: 'Remove fake response' }], plan: { source: 'mock' } }));
 assert.deepEqual(await removeStudioSamples(root), { removedArtifacts: 1, cleanedConversations: 1 });
 const thread = JSON.parse(await fs.readFile(file)); assert.equal(thread.messages[0].content, 'Keep this idea'); assert.ok(!JSON.stringify(thread).includes('Remove fake response')); assert.equal(thread.artifactId, null);
 await fs.access(path.join(owner, genuine, 'record.json')); await assert.rejects(fs.access(path.join(owner, sample))); assert.deepEqual(await removeStudioSamples(root), { removedArtifacts: 0, cleanedConversations: 0 });
});
test('runtime accepts fresh appended or rotated logs and refuses linked logs', async t => {
 const root = await temp(t), file = path.join(root, 'UE4SS.log'); await fs.writeFile(file, 'old-marker\n');
 const baseline = await readLog(root, 'UE4SS.log'), started = new Date().toISOString(); assert.equal(freshText(baseline, baseline, started), '');
 await fs.appendFile(file, 'new-marker\n'); assert.equal(freshText(await readLog(root, 'UE4SS.log'), baseline, started), 'new-marker\n');
 await fs.writeFile(file, 'rotated-marker\n'); assert.equal(freshText(await readLog(root, 'UE4SS.log'), baseline, started), 'rotated-marker\n');
 assert.equal(freshText({ ...await readLog(root, 'UE4SS.log'), mtime: Date.parse(started) - 10000 }, baseline, started), '');
 await fs.symlink(file, path.join(root, 'linked.log')); await assert.rejects(readLog(root, 'linked.log'), /链接/); await fs.truncate(file, 9 * 1024 * 1024); await assert.rejects(readLog(root, 'UE4SS.log'), /8 MB/);
});
