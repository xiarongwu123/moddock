const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAccountClient } = require('../account.cjs');
const { createMuStudioAI, creationPayload } = require('../studio-mu-client.cjs');
const { createStudioService } = require('./ai-ledger-fixture.cjs');
const { accountFixture } = require('./account-fixture.cjs');
const { createServer } = require('../server.cjs');
const { loginFixture } = require('./server-fixture.cjs');
const { piFixture } = require('./pi-fixture.cjs');
const { createDeepSeek } = require('../studio-ai.cjs');
const token = 'a'.repeat(64);
const payload = { prompt: 'Make a blue sword', types: [{ id: 'project-plan', available: true }],
 context: { game: { name: 'Fixture' } }, messages: [{ role: 'user', content: 'Make a blue sword' }] };
async function service(t, ai, options = {}) {
 const value = await createStudioService({ accessToken: token, ai, ...options });
 t.after(() => value.close());
 const request = (route, body = payload, headers = {}) => fetch(value.url + '/' + route, {
  method: 'POST', headers: { Authorization: 'Bearer ' + token, 'X-Mu-Account-Id': 'alice', ...headers }, body: JSON.stringify(body) });
 return { ...value, request };
}

test('creation payload omits local paths, credentials and transport identities', () => {
 const data = creationPayload({ ...payload, accountId: 'alice', apiKey: 'private-test-key', signal: new AbortController().signal,
  diagnostic: { installPath: '/private/game', engine: { key: 'unreal' } },
  environment: { lua: { available: true, executable: '/private/compiler', version: '5.4.8' } } });
 const text = JSON.stringify(data);
 for (const value of ['/private/', 'private-test-key', 'accountId', 'signal']) assert.ok(!text.includes(value));
 assert.equal(data.context.game.name, 'Fixture');
 assert.equal(data.harness, 'pi-agent');
});
test('interactive creation rejects an old backend without Pi events', async () => {
 const ai = createMuStudioAI(async () => Response.json({ title: 'Legacy model result' }));
 await assert.rejects(ai.plan({ ...payload, onEvent() {} }), { code: 'PI_RUNTIME_REQUIRED' });
});
test('private creation service authenticates transport and bounds routes and input before calling AI', async t => {
 let calls = 0;
 const x = await service(t, { plan: async () => { calls++; return { title: 'Plan' }; } });
 assert.equal((await fetch(x.url + '/status')).status, 401);
 assert.equal((await x.request('plan', payload, { Origin: 'https://evil.test' })).status, 403);
 assert.equal((await x.request('plan', { ...payload, apiKey: 'injected' })).status, 400);
 assert.equal((await x.request('plan', { ...payload, prompt: 'x'.repeat(2001) })).status, 400);
 assert.equal((await x.request('arbitrary-url')).status, 404);
 assert.equal(calls, 0);
 assert.deepEqual(await (await x.request('plan')).json(), { title: 'Plan' });
 assert.equal(calls, 1);
});
test('private creation service limits concurrent owner work and masks raw provider errors', async t => {
 let release, entered;
 const ready = new Promise(resolve => { entered = resolve; });
 const x = await service(t, { plan: async () => { entered(); await new Promise(resolve => { release = resolve; }); throw new Error('private-key upstream response'); } });
 const pending = x.request('plan'); await ready;
 const busy = await x.request('plan'); assert.equal(busy.status, 429); assert.equal(busy.headers.get('retry-after'), '30');
 release(); const failed = await pending; assert.equal(failed.status, 503);
 assert.deepEqual(await failed.json(), { code: 'studio_unavailable' });
});
test('legacy BG3 transport delegates authoring to Pi while new clients cannot inject tool rounds', async t => {
 let calls = 0;
 const x = await service(t, { generate: async () => { calls++; return { kind: 'bg3-lua', code: 'verified fixture' }; } });
 const body = { ...payload, kind: 'bg3-lua', agentStep: 0, toolHistory: [] };
 assert.equal((await (await x.request('generate', body)).json()).type, 'tools'); assert.equal(calls, 0);
 const completed = await (await x.request('generate', { ...body, agentStep: 1 })).json(); assert.equal(completed.type, 'complete'); assert.equal(completed.draft.kind, 'bg3-lua'); assert.equal(calls, 1);
 assert.equal((await x.request('generate', { ...body, harness: 'pi-agent' })).status, 400);
 for (const invalid of [{ ...body, agentStep: 7 }, { ...body, kind: 'dialogue' }, { ...body, toolHistory: null }, { ...body, agentStep: undefined }, { ...body, accountId: 'other-owner' }]) assert.equal((await x.request('generate', invalid)).status, 400);
});
test('private creation cancellation propagates to the model and releases owner capacity', async t => {
 let started, stopped;
 const ready = new Promise(resolve => { started = resolve; }), cancelled = new Promise(resolve => { stopped = resolve; });
 const x = await service(t, { plan: async ({ signal }) => { started(); await new Promise((_, reject) => signal.addEventListener('abort', () => { stopped(); reject(new Error('aborted')); }, { once: true })); } });
 const controller = new AbortController();
 const pending = fetch(x.url + '/plan', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'X-Mu-Account-Id': 'alice' }, body: JSON.stringify(payload), signal: controller.signal });
 const rejected = assert.rejects(pending); await ready; controller.abort(); await rejected; await cancelled;
});
test('private Pi events arrive before the final result and streaming rate errors close cleanly', async t => {
 let release;
 const x = await service(t, { plan: async ({ onEvent }) => {
  onEvent({ type: 'thinking_delta', agent: 'Pi', delta: '实时思考' });
  await new Promise(resolve => { release = resolve; }); return { title: 'Plan' };
 } });
 const response = await x.request('plan', payload, { Accept: 'application/x-ndjson' }), reader = response.body.getReader();
 const first = new TextDecoder().decode((await reader.read()).value); assert.match(first, /实时思考/); assert.ok(!first.includes('"type":"result"'));
 release(); let remaining = ''; for (;;) { const chunk = await reader.read(); if (chunk.done) break; remaining += new TextDecoder().decode(chunk.value); }
 assert.match(remaining, /"type":"result"/);
 const failing = await service(t, { plan: async () => { throw new Error('HTTP 429 private upstream'); } });
 const error = await failing.request('plan', payload, { Accept: 'application/x-ndjson' });
 assert.deepEqual((await error.text()).trim(), '{"type":"error","code":"studio_rate_limited"}');
});
test('MU creation requests reuse login, refresh once, preserve cancellation and sanitize service failures', async () => {
 const account = accountFixture(); let calls = 0;
 const client = createAccountClient({ ...account.options, fetch: async (url, init) => {
  if (!new URL(url).pathname.startsWith('/api/v1/studio/')) return account.options.fetch(url, init);
  assert.match(init.headers.Authorization, /^Bearer access-secret-/);
  assert.equal(new URL(url).pathname, '/api/v1/studio/plan'); assert.equal(JSON.parse(init.body).accountId, undefined);
  if (++calls === 1) return Response.json({ code: 'invalid_session' }, { status: 401 });
  if (calls === 3) return Response.json({ code: 'upstream_private', message: 'private-key raw diagnostic' }, { status: 503 });
  return Response.json({ title: 'Plan' });
 } });
 const session = await client.login({ email: 'player@example.com', password: 'player123' });
 const ai = createMuStudioAI((owner, route, init) => client.studioRequest(session.id, owner, route, init));
 assert.deepEqual(await ai.plan({ ...payload, accountId: session.profile.id }), { title: 'Plan' });
 assert.equal(account.calls.filter(call => call.route.endsWith('/auth/refresh')).length, 1);
 await assert.rejects(ai.plan({ ...payload, accountId: session.profile.id }), error => !error.message.includes('private-key') && error.code === 'upstream_private');
 await assert.rejects(ai.plan({ ...payload, accountId: 'other-owner' }), { status: 401 });
 client.clear();
 await assert.rejects(ai.plan({ ...payload, accountId: session.profile.id }), { status: 401 });
});
test('slow MU AI requests do not hold the session queue or delay logout cancellation', async () => {
 const account = accountFixture(); let started;
 account.updateAccount({ membership: { tier: 'pro', expiresAt: null } });
 const ready = new Promise(resolve => { started = resolve; });
 const client = createAccountClient({ ...account.options, fetch: async (url, init) => {
  if (!new URL(url).pathname.startsWith('/api/v1/studio/')) return account.options.fetch(url, init);
  started(); await new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
 } });
 const session = await client.login({ email: 'player@example.com', password: 'player123' }), controller = new AbortController();
 const pending = client.studioRequest(session.id, session.profile.id, 'plan', { body: JSON.stringify(payload), signal: controller.signal });
 const rejected = assert.rejects(pending); await ready;
 await Promise.race([client.requireSession(session.id), new Promise((_, reject) => setTimeout(() => reject(new Error('Session queue blocked')), 500))]);
 await client.logout(session.id); controller.abort(); await rejected;
});
test('default logged-in MU studio creates a validated artifact without a local provider key', async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-mu-studio-'));
 const account = accountFixture(); account.updateAccount({ membership: { tier: 'pro', expiresAt: null } });
 const routes = [];
 const pi = await piFixture(t, { result: body => body.messages[0].content.includes('This is the artifact generation stage')
  ? { kind: 'project-plan', name: 'Blue sword plan', author: 'Player', description: 'A development plan', plan: 'Inspect the actual game APIs before implementation.' }
  : { title: 'Plan', summary: 'A development plan.', kind: 'project-plan', steps: ['Inspect game APIs'], requirements: [] } });
 const backend = await service(t, createDeepSeek({ apiKey: pi.key, pi: pi.pi }));
 const game = { id: 'fixture', name: 'Custom Game', installPath: path.join(root, 'game'), real: true };
 await fs.mkdir(game.installPath);
 const local = await createServer({ root: path.join(root, 'data'), port: 0, nexusPlatformDisabled: true, scan: async () => ({ games: [game], diagnostics: [] }),
  accounts: { ...account.options, fetch: async (url, init) => {
   const route = new URL(url).pathname;
   if (!route.startsWith('/api/v1/studio/')) return account.options.fetch(url, init);
   assert.match(init.headers.Authorization, /^Bearer access-secret-/); routes.push(route);
   return fetch(backend.url + route.slice('/api/v1/studio'.length), { ...init, headers: { Authorization: 'Bearer ' + token, 'X-Mu-Account-Id': 'fixture-user', Accept: init.headers.Accept } });
  } } });
 t.after(async () => { await local.studio.conversations.settle(); local.server.closeAllConnections(); await new Promise(resolve => local.server.close(resolve)); await local.downloads.persist; await fs.rm(root, { recursive: true, force: true }); });
 const auth = await loginFixture(local); assert.equal(auth.state.studio.aiAvailable, true);
 const response = await auth.fetch(local.url + '/api/studio/conversations/send', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': auth.state.token }, body: JSON.stringify({ gameId: game.id, message: 'Create a development plan for a blue sword. Choose details yourself.' }) });
 assert.equal(response.status, 202); const accepted = await response.json(); await local.studio.conversations.settle();
 const item = await local.studio.conversations.read('fixture-user', game, accepted.id);
 assert.equal(item.status, 'completed', item.error); assert.ok(item.artifactId);
 assert.equal(item.harness.name, 'pi-agent'); assert.equal(item.harness.status, 'completed'); assert.ok(item.harness.thinking.some(thought => thought.text.includes('真实'))); assert.ok(item.toolCalls.some(call => call.name === 'submit_result' && call.status === 'completed'));
 assert.deepEqual(routes, ['/api/v1/studio/plan', '/api/v1/studio/generate']);
});
