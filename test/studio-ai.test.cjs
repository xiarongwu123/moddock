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
const key = 'sk-test-only-provider-key-123456789';
const planPayload = { types: [{ id: 'project-plan', available: true }] };
const result = (value, reason = 'stop') => new Response(JSON.stringify({ choices: [{ finish_reason: reason, message: { content: JSON.stringify(value) } }] }));
async function temp(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-ai-test-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }

test('DeepSeek uses the real fixed origin, model and JSON contract, with bounded reference data', async () => {
 let request;
 const ai = createDeepSeek({ apiKey: key, fetch: async (url, init) => { request = { url, init }; return result({ title: 'Plan' }); } });
 assert.deepEqual(await ai.plan({ ...planPayload, context: { game: { name: 'Game' }, guide: { text: 'a'.repeat(20000) } }, diagnostic: { installPath: '/private/game', engine: { key: 'unreal' } }, prompt: 'Create a mod' }), { title: 'Plan' });
 assert.equal(request.url, 'https://api.deepseek.com/chat/completions'); assert.equal(request.init.redirect, 'error');
 const body = JSON.parse(request.init.body); assert.equal(body.model, 'deepseek-flash'); assert.deepEqual(body.response_format, { type: 'json_object' });
 assert.equal(request.init.headers.Authorization, 'Bearer ' + key); assert.ok(!request.init.body.includes(key)); assert.ok(!request.init.body.includes('/private/game'));
 assert.equal(JSON.parse(body.messages[1].content).guide.length, 12000);
});
test('planner exposes only available game schemas and explains source-only capability', async () => {
 const requests = [];
 const ai = createDeepSeek({ apiKey: key, fetch: async (_url, init) => { requests.push(JSON.parse(init.body)); return result({ title: 'Plan' }); } });
 await ai.plan({ types: [...planPayload.types, { id: 'custom-project', available: true }, { id: 'dialogue', available: false }, { id: 'unknown-kind', available: true }], capability: { creativeDefaultsDelegated: true }, context: { game: { name: 'Baldur’s Gate 3' } }, validation: { error: 'Invalid steps' }, previousPlan: { kind: 'dialogue' } });
 const [system, user] = requests[0].messages;
 assert.match(system.content, /Allowed kind IDs: \["project-plan","custom-project"\]/);
 assert.match(system.content, /no supported automatic Mod build\/installation adapter/);
 assert.match(system.content, /choose reasonable defaults/);
 assert.match(system.content, /without questions/);
 for (const unwanted of ['kind="dialogue"', 'kind="texture"', 'kind="ue4ss-lua"', 'kind="bepinex-plugin"', 'weekday', 'Abigail']) assert.ok(!system.content.includes(unwanted), unwanted);
 const context = JSON.parse(user.content);
 assert.deepEqual(context.supportedTypes.map(type => type.id), ['project-plan', 'custom-project']);
 assert.equal(context.validation.error, 'Invalid steps'); assert.equal(context.previousPlan.kind, 'dialogue');
 await ai.plan({ types: [...planPayload.types, { id: 'ue4ss-lua', available: true }] });
 assert.match(requests[1].messages[0].content, /kind="ue4ss-lua"/);
 assert.ok(!requests[1].messages[0].content.includes('no supported automatic Mod build/installation adapter'));
 assert.ok(!requests[1].messages[0].content.includes('weekday'));
 await assert.rejects(ai.plan({ types: [{ id: 'dialogue', available: false }] }), /没有可用/);
 assert.equal(requests.length, 2);
});
test('provider failures and truncated JSON are rejected without disclosing provider body or credentials', async () => {
 for (const status of [400,401,402,429,500]) {
  const ai = createDeepSeek({ apiKey: key, fetch: async () => new Response(key + ' sensitive upstream data', { status }) });
  await assert.rejects(ai.plan(planPayload), error => error.message.includes('HTTP ' + status) && !error.code && !error.message.includes(key) && !error.message.includes('sensitive'));
 }
 const ai = createDeepSeek({ apiKey: key, fetch: async () => result({ title: 'incomplete' }, 'length') });
 await assert.rejects(ai.plan(planPayload), error => error.code === 'AI_RESPONSE_FORMAT' && /未完整/.test(error.message));
 const broken = createDeepSeek({ apiKey: key, fetch: async () => new Response('not json') }); await assert.rejects(broken.plan(planPayload), error => error.code === 'AI_RESPONSE_FORMAT' && /无效/.test(error.message));
 const invalid = createDeepSeek({ apiKey: key, fetch: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{bad' } }] })) });
 await assert.rejects(invalid.plan(planPayload), { code: 'AI_RESPONSE_FORMAT' });
 const cancelled = createDeepSeek({ apiKey: key, fetch: async (_url, init) => { init.signal.throwIfAborted(); } });
 await assert.rejects(cancelled.plan({ ...planPayload, signal: AbortSignal.abort() }), /取消或超时/);
});
test('model-designed pixels become a validated PNG without fixed fallback artwork', async () => {
 const pixels = Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => x === y ? '#f00a22' : '#00000000'));
 const image = textureImage(pixels); assert.equal(pngBytes(image).subarray(0,8).toString('hex'), '89504e470d0a1a0a');
 const ai = createDeepSeek({ apiKey: key, fetch: async () => result({ kind: 'texture', pixels }) });
 const draft = await ai.generate({ kind: 'texture' }); assert.equal(draft.image, image); assert.equal(draft.pixels, undefined);
 assert.throws(() => textureImage([['red']]), /16/);
});
test('artifact generation corrects wrong kinds and malformed JSON through the real provider contract', async () => {
 const requests = [], expected = { kind: 'project-plan', name: 'Companion', author: 'Player', plan: 'Game adapter evidence needed.' };
 const ai = createDeepSeek({ apiKey: key, fetch: async (_url, init) => {
  requests.push(JSON.parse(init.body));
  if (requests.length === 1) return result({ kind: 'dialogue', name: 'Wrong game type' });
  if (requests.length === 2) return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{broken' } }] }));
  return result(expected);
 } });
 assert.deepEqual(await ai.generate({ kind: 'project-plan', prompt: 'Create a Chinese companion' }), expected);
 assert.equal(requests.length, 3);
 assert.match(requests[0].messages[0].content, /artifact generation stage/);
 assert.match(requests[1].messages[0].content, /kind 必须为 "project-plan"/);
 const feedback = JSON.parse(requests[1].messages[1].content);
 assert.equal(feedback.previousDraft.kind, 'dialogue'); assert.match(feedback.validation.error, /类型不匹配/);
 assert.ok(requests.every(request => JSON.parse(request.messages[1].content).prompt === 'Create a Chinese companion'));
 let calls = 0;
 const invalid = createDeepSeek({ apiKey: key, fetch: async () => { calls++; return result({ kind: 'dialogue' }); } });
 await assert.rejects(invalid.generate({ kind: 'project-plan' }), /类型不匹配/); assert.equal(calls, 3);
 calls = 0;
 const unavailable = createDeepSeek({ apiKey: key, fetch: async () => { calls++; return new Response('upstream private', { status: 402 }); } });
 await assert.rejects(unavailable.generate({ kind: 'project-plan' }), /余额不足/); assert.equal(calls, 1);
});
test('compact AI texture output is validated and malformed artwork is sent back to the provider', async () => {
 const palette = { '.': '#00000000', A: '#55bbffff' }, rows = Array.from({ length: 16 }, (_, y) => '.'.repeat(y) + 'A' + '.'.repeat(15 - y));
 const calls = [];
 const ai = createDeepSeek({ apiKey: key, fetch: async (_url, init) => {
  calls.push(JSON.parse(init.body));
  return result({ kind: 'texture', name: 'Generated', palette, rows: calls.length === 1 ? rows.slice(1) : rows });
 } });
 const draft = await ai.generate({ kind: 'texture', prompt: 'Blue sword' });
 assert.equal(calls.length, 2);
 const retry = JSON.parse(calls[1].messages[1].content);
 assert.match(retry.validation.error, /16/); assert.equal(retry.previousDraft.rows.length, 15); assert.equal(retry.prompt, 'Blue sword');
 assert.equal(draft.image, textureImage(rows.map(row => Array.from(row, symbol => palette[symbol]))));
 assert.equal(draft.rows, undefined); assert.equal(draft.palette, undefined);
});
test('invalid AI texture colors or sizes exhaust bounded retries without substitute art; service failures do not retry', async () => {
 for (const draft of [{ kind: 'texture', palette: { '.': '#00000000' }, rows: Array(16).fill('A'.repeat(16)) }, { kind: 'texture', pixels: [] }]) {
  let calls = 0;
  const ai = createDeepSeek({ apiKey: key, fetch: async () => { calls++; return result(draft); } });
  await assert.rejects(ai.generate({ kind: 'texture' }), /AI 贴图/); assert.equal(calls, 3);
 }
 let calls = 0;
 const ai = createDeepSeek({ apiKey: key, fetch: async () => { calls++; return new Response('private upstream body', { status: 402 }); } });
 await assert.rejects(ai.generate({ kind: 'texture' }), /余额不足/); assert.equal(calls, 1);
});
test('new private credentials replace the encrypted store and plaintext bootstrap is consumed', async t => {
 const root = await temp(t), bootstrapFile = path.join(root, 'bootstrap.json'), encrypted = path.join(root, 'encrypted.bin');
 const encryption = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text).reverse(), decryptString: bytes => Buffer.from(bytes).reverse().toString() };
 const store = createStudioKeyStore(encrypted, encryption); await store.write({ apiKey: 'sk-older-test-key-123456789' });
 await fs.writeFile(bootstrapFile, JSON.stringify({ apiKey: key }), { mode: 0o600 });
 let auth; const ai = await loadStudioAI({ keyStore: store, bootstrapFile, fetch: async (_url, init) => { auth = init.headers.Authorization; return result({ title: 'Plan' }); } });
 await ai.plan(planPayload); assert.equal(auth, 'Bearer ' + key); assert.equal((await store.read()).apiKey, key); await assert.rejects(fs.access(bootstrapFile));
 assert.ok(!(await fs.readFile(encrypted, 'utf8')).includes(key));
 await assert.rejects(createStudioKeyStore(encrypted, { isEncryptionAvailable: () => false }).write({ apiKey: key }), /加密不可用/);
});
test('migration deletes tagged sample products and plans while preserving ideas and genuine products', async t => {
 const root = await temp(t), owner = path.join(root, 'a'.repeat(64)), sample = crypto.randomUUID(), genuine = crypto.randomUUID(), id = crypto.randomUUID();
 for (const [artifactId, record] of [[sample, { preview: { mode: 'local-template', aiUsed: false } }], [genuine, { draft: { name: 'Real' } }]]) { await fs.mkdir(path.join(owner, artifactId), { recursive: true }); await fs.writeFile(path.join(owner, artifactId, 'record.json'), JSON.stringify(record)); }
 await fs.mkdir(path.join(owner, 'conversations')); const file = path.join(owner, 'conversations', id + '.json');
 await fs.writeFile(file, JSON.stringify({ id, mode: 'preview', artifactId: sample, messages: [{ role: 'user', content: 'Keep this idea' }, { role: 'assistant', source: 'mock', content: 'Remove fake response' }], plan: { source: 'mock' } }));
 assert.deepEqual(await removeStudioSamples(root), { removedArtifacts: 1, cleanedConversations: 1 });
 const thread = JSON.parse(await fs.readFile(file)); assert.equal(thread.messages[0].content, 'Keep this idea'); assert.ok(!JSON.stringify(thread).includes('Remove fake response')); assert.equal(thread.artifactId, null); assert.equal(thread.plan, null); assert.equal(thread.mode, 'ai');
 await fs.access(path.join(owner, genuine, 'record.json')); await assert.rejects(fs.access(path.join(owner, sample)));
 assert.deepEqual(await removeStudioSamples(root), { removedArtifacts: 0, cleanedConversations: 0 });
});
test('runtime accepts only fresh appended or rotated logs and refuses linked logs', async t => {
 const root = await temp(t), file = path.join(root, 'UE4SS.log'); await fs.writeFile(file, 'old-marker\n');
 const baseline = await readLog(root, 'UE4SS.log'), started = new Date().toISOString();
 assert.equal(freshText(baseline, baseline, started), '');
 await fs.appendFile(file, 'new-marker\n'); assert.equal(freshText(await readLog(root, 'UE4SS.log'), baseline, started), 'new-marker\n');
 await fs.writeFile(file, 'rotated-marker\n'); assert.equal(freshText(await readLog(root, 'UE4SS.log'), baseline, started), 'rotated-marker\n');
 const old = { ...await readLog(root, 'UE4SS.log'), mtime: Date.parse(started) - 10000 }; assert.equal(freshText(old, baseline, started), '');
 await fs.symlink(file, path.join(root, 'linked.log')); await assert.rejects(readLog(root, 'linked.log'), /链接/);
 await fs.truncate(file, 9 * 1024 * 1024); await assert.rejects(readLog(root, 'UE4SS.log'), /8 MB/);
});
