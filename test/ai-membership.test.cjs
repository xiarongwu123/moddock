const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { requireAI, hasPro, quotaView } = require('../ai-policy.cjs');
const { AIUsage } = require('../ai-usage.cjs');
const { createAccountClient } = require('../account.cjs');
const { accountFixture } = require('./account-fixture.cjs');
const { createMuStudioAI } = require('../studio-mu-client.cjs');
const { createServer } = require('../server.cjs');
const quota = (usedTokens = 0) => ({ usedTokens, limitTokens: 1000000, periodStart: new Date(Date.now() - 86400000).toISOString(), periodEnd: new Date(Date.now() + 86400000 * 29).toISOString() });
const pro = () => ({ membership: { tier: 'pro', expiresAt: null }, features: [], aiUsage: quota() });
test('AI requires current Pro, enabled feature and finite current quota; hard cap is one million', () => {
 assert.throws(() => requireAI({ membership: { tier: 'standard' } }), { code: 'pro_required' });
 assert.throws(() => requireAI({ ...pro(), membership: { tier: 'pro', expiresAt: 'invalid' } }), { code: 'pro_required' });
 assert.equal(hasPro({ ...pro(), membership: { tier: 'pro', expiresAt: new Date(Date.now() - 1).toISOString() } }), false);
 assert.equal(hasPro({ ...pro(), features: [{ key: 'modding.studio', enabled: false, allowed: true }] }), false);
 assert.throws(() => requireAI({ ...pro(), aiUsage: null }), { code: 'ai_quota_unconfigured' });
 assert.throws(() => requireAI({ ...pro(), aiUsage: { ...quota(), reconciliationRequired: true } }), { code: 'ai_quota_unconfigured' });
 assert.equal(quotaView({ ...quota(10), reservedTokens: 20 }).remainingTokens, 999970);
 assert.throws(() => requireAI({ ...pro(), aiUsage: quota(1000000) }), { code: 'ai_credits_exhausted' });
 assert.equal(requireAI({ ...pro(), aiUsage: quota(999999) }).remainingTokens, 1);
 assert.equal(quotaView({ ...quota(), limitTokens: 99999999 }).limitTokens, 1000000);
 for (const value of [{ ...quota(), usedTokens: -1 }, { ...quota(), limitTokens: null }, { ...quota(), periodEnd: '2000-01-01' }, { ...quota(), usedTokens: Infinity }]) assert.equal(quotaView(value), null);
});
test('transport refuses standard, expired, exhausted and unconfigured accounts before model requests; cancellation survives exhaustion', async () => {
 const fixture = accountFixture(); let calls = 0;
 const client = createAccountClient({ ...fixture.options, fetch: async (url, init) => {
  if (String(url).includes('/studio/')) { calls++; return Response.json({ ok: true }); }
  return fixture.options.fetch(url, init);
 } });
 const session = await client.login({ email: 'player@example.com', password: 'player123' });
 const call = (operation = 'subscribe') => client.studioRequest(session.id, session.profile.id, 'plan', { body: JSON.stringify({ delivery: { operation } }) });
 await assert.rejects(call(), { code: 'pro_required' }); assert.equal(calls, 0);
 fixture.updateAccount(pro()); await call(); assert.equal(calls, 1);
 fixture.updateAccount({ aiUsage: quota(1000000) }); await assert.rejects(call(), { code: 'ai_credits_exhausted' }); assert.equal(calls, 1);
 await call('cancel'); assert.equal(calls, 2);
 await client.studioRequest(session.id, session.profile.id, 'plan', { body: JSON.stringify({ delivery: { version: 1, id: require('node:crypto').randomUUID(), after: 1, operation: 'subscribe' } }) });
 assert.equal(calls, 3, 'cloud-owned task replay remains available at exhaustion');
 fixture.updateAccount({ aiUsage: undefined }); await assert.rejects(call(), { code: 'ai_quota_unconfigured' });
 fixture.updateAccount({ membership: { tier: 'standard', expiresAt: null } }); await assert.rejects(call(), { code: 'pro_required' });
});
test('actual input/output accounting survives restart, concurrent updates, duplicate replay and account separation', async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-usage-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
 const journal = new AIUsage(root);
 await Promise.all([journal.record('a', 'task1', { input_tokens: 100, output_tokens: 25 }), journal.record('a', 'task1', { inputTokens: 100, outputTokens: 25 }), journal.record('a', 'task2', { prompt_tokens: 40, completion_tokens: 10 }), journal.record('b', 'task1', { inputTokens: 2, outputTokens: 3 })]);
 assert.deepEqual(await new AIUsage(root).view('a'), { scope: 'this_device', recordedTasks: 2, inputTokens: 140, outputTokens: 35, totalTokens: 175 });
 assert.equal((await journal.view('b')).totalTokens, 5);
 await journal.record('a', 'task1', { inputTokens: 10, outputTokens: 2 }); assert.equal((await journal.view('a')).totalTokens, 175);
 await assert.rejects(journal.record('a', 'bad', { inputTokens: '100', outputTokens: 2 }), { code: 'AI_USAGE_INVALID' });
 const contents = await fs.readFile(journal.file('a'), 'utf8'); assert.equal(contents.includes('task1'), false);
});
test('stream usage is recorded before error; reconnect uses one task and never double counts usage frames', async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-stream-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
 const journal = new AIUsage(root); let attempts = 0;
 const ai = createMuStudioAI(async (owner, route, init) => {
  const { delivery } = JSON.parse(init.body); attempts++;
  const frames = [{ type: 'task', version: 1, id: delivery.id }, { type: 'usage', usage: { inputTokens: 80, outputTokens: 20 } }, attempts === 1 ? { type: 'checkpoint' } : { type: 'result', seq: 1, result: { name: 'done', usage: { inputTokens: 80, outputTokens: 20 } } }];
  return new Response(frames.map(row => JSON.stringify(row)).join('\n'), { headers: { 'content-type': 'application/x-ndjson' } });
 }, { onUsage: (owner, id, usage) => journal.record(owner, id, usage) });
 assert.equal((await ai.plan({ accountId: 'a', prompt: 'test' })).name, 'done');
 assert.equal(attempts, 2); assert.equal((await journal.view('a')).totalTokens, 100);
 const failed = createMuStudioAI(async (owner, route, init) => new Response([{ type: 'task', version: 1, id: JSON.parse(init.body).delivery.id }, { type: 'usage', usage: { input_tokens: 30, output_tokens: 4 } }, { type: 'error', seq: 1, code: 'ai_response_invalid' }].map(x => JSON.stringify(x)).join('\n'), { headers: { 'content-type': 'application/x-ndjson' } }), { onUsage: (owner, id, usage) => journal.record(owner, id, usage) });
 await assert.rejects(failed.generate({ accountId: 'a', prompt: 'test' }));
 assert.equal((await journal.view('a')).totalTokens, 134);
});
test('sequenced cumulative usage advances the reconnect cursor and ignores replayed frames', async () => {
 const cursors = [], usage = [], events = [];
 const ai = createMuStudioAI(async (_owner, _route, init) => {
  const { delivery } = JSON.parse(init.body); cursors.push(delivery.after);
  const frames = [{ type: 'task', version: 1, id: delivery.id },
   { type: 'usage', seq: 1, usage: { inputTokens: 80, outputTokens: 20 } },
   ...(cursors.length === 1 ? [{ type: 'checkpoint' }] : [
    { type: 'event', seq: 2, event: { type: 'thinking_delta', delta: 'once' } },
    { type: 'usage', seq: 3, usage: { inputTokens: 120, outputTokens: 30 } },
    { type: 'result', seq: 4, result: { name: 'done' } },
   ])];
  return new Response(frames.map(frame => JSON.stringify(frame)).join('\n'), { headers: { 'content-type': 'application/x-ndjson' } });
 }, { onUsage: (_owner, _id, value) => usage.push(value) });
 assert.equal((await ai.plan({ accountId: 'a', prompt: 'test', onEvent: event => events.push(event) })).name, 'done');
 assert.deepEqual(cursors, [0, 1]);
 assert.deepEqual(usage, [{ inputTokens: 80, outputTokens: 20 }, { inputTokens: 120, outputTokens: 30 }]);
 assert.equal(events.filter(event => event.type === 'thinking_delta').length, 1);
});
test('HTTP API rejects standard AI actions and isolates account usage, while plans remain accessible', async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-http-')), upstream = accountFixture();
 const service = await createServer({ root, port: 0, nexusPlatformDisabled: true, scan: async () => ({ games: [], diagnostics: [] }), accounts: upstream.options });
 t.after(async () => { await new Promise(resolve => service.server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
 assert.equal((await fetch(service.url + '/api/account/ai-usage')).status, 401);
 const config = await fetch(service.url + '/api/auth/config').then(r => r.json());
 const login = await fetch(service.url + '/api/auth/login', { method: 'POST', headers: { 'X-Moddock-Token': config.token }, body: JSON.stringify({ email: 'player@example.com', password: 'player123' }) });
 const cookie = login.headers.getSetCookie().find(value => /Path=\/api(?:;|$)/.test(value)).split(';')[0];
 const headers = { Cookie: cookie, 'X-Moddock-Token': config.token };
 for (const route of ['conversations/send', 'generate', 'conversations/feedback', 'workspace', 'prepare-environment']) {
  const response = await fetch(service.url + '/api/studio/' + route, { method: 'POST', headers, body: '{}' }); assert.equal(response.status, 403); assert.equal((await response.json()).code, 'pro_required');
 }
 const usage = await fetch(service.url + '/api/account/ai-usage', { headers }).then(r => r.json());
 assert.equal(usage.account.membership.tier, 'standard'); assert.equal(usage.local.totalTokens, 0); assert.equal(usage.quota, null);
 assert.equal((await fetch(service.url + '/api/account/plans', { headers })).status, 200);
 for (const [aiUsage, code] of [[null, 'ai_quota_unconfigured'], [quota(1000000), 'ai_credits_exhausted']]) {
  upstream.updateAccount({ membership: pro().membership, aiUsage });
  const response = await fetch(service.url + '/api/studio/conversations/send', { method: 'POST', headers, body: '{}' });
  assert.equal(response.status, 403); assert.equal((await response.json()).code, code);
 }
});
