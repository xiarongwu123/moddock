const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAccountClient } = require('../account.cjs');
const { createMuStudioAI, creationPayload } = require('../studio-mu-client.cjs');
const { createStudioService } = require('../platform/studio-service.cjs');
const { accountFixture } = require('./account-fixture.cjs');
const { createServer } = require('../server.cjs');
const { loginFixture } = require('./server-fixture.cjs');
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
test('private creation gateway accepts bounded BG3 tool rounds and rejects other kinds or orphan results', async t => {
 let seen;
 const x = await service(t, { agent: async value => { seen = value; return { type: 'tools', calls: [{ name: 'inspect_game', arguments: {} }] }; } });
 const body = { ...payload, kind: 'bg3-lua', agentStep: 0, toolHistory: [] };
 const accepted = await x.request('generate', body); assert.equal(accepted.status, 200); assert.equal((await accepted.json()).type, 'tools'); assert.equal(seen.accountId, 'alice');
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
 const backend = await service(t, { plan: async () => ({ title: 'Plan', summary: 'A development plan.', kind: 'project-plan', steps: ['Inspect game APIs'], requirements: [] }),
  generate: async () => ({ kind: 'project-plan', name: 'Blue sword plan', author: 'Player', description: 'A development plan', plan: 'Inspect the actual game APIs before implementation.' }) });
 const game = { id: 'fixture', name: 'Custom Game', installPath: path.join(root, 'game'), real: true };
 await fs.mkdir(game.installPath);
 const local = await createServer({ root: path.join(root, 'data'), port: 0, nexusPlatformDisabled: true, scan: async () => ({ games: [game], diagnostics: [] }),
  accounts: { ...account.options, fetch: async (url, init) => {
   const route = new URL(url).pathname;
   if (!route.startsWith('/api/v1/studio/')) return account.options.fetch(url, init);
   assert.match(init.headers.Authorization, /^Bearer access-secret-/); routes.push(route);
   return fetch(backend.url + route.slice('/api/v1/studio'.length), { ...init, headers: { Authorization: 'Bearer ' + token, 'X-Mu-Account-Id': 'fixture-user' } });
  } } });
 t.after(async () => { await local.studio.conversations.settle(); local.server.closeAllConnections(); await new Promise(resolve => local.server.close(resolve)); await local.downloads.persist; await fs.rm(root, { recursive: true, force: true }); });
 const auth = await loginFixture(local); assert.equal(auth.state.studio.aiAvailable, true);
 const response = await auth.fetch(local.url + '/api/studio/conversations/send', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': auth.state.token }, body: JSON.stringify({ gameId: game.id, message: 'Make a blue sword. Choose details yourself.' }) });
 assert.equal(response.status, 202); const accepted = await response.json(); await local.studio.conversations.settle();
 const item = await local.studio.conversations.read('fixture-user', game, accepted.id);
 assert.equal(item.status, 'completed', item.error); assert.ok(item.artifactId);
 assert.deepEqual(routes, ['/api/v1/studio/plan', '/api/v1/studio/generate']);
});
