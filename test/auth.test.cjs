const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server.cjs');
const { createAccountClient, TERMS_VERSION } = require('../account.cjs');
const { createAuthClient } = require('../src/auth/client.cjs');
const { accountFixture } = require('./account-fixture.cjs');

async function fixture(t) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-account-'));
 const upstream = accountFixture();
 const service = await createServer({ root, port: 0, scan: async () => ({ games: [], diagnostics: [] }), accounts: upstream.options });
 t.after(async () => { await new Promise(resolve => service.server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
 const state = await (await fetch(service.url + '/api/auth/config')).json();
 let cookie = '';
 const localFetch = async (url, init = {}) => {
  const response = await fetch(service.url + url, { ...init, headers: { ...init.headers, Cookie: cookie } });
  if (response.headers.has('set-cookie')) cookie = response.headers.getSetCookie().find(value => /Path=\/api(?:;|$)/.test(value)).split(';')[0];
  return response;
 };
 const post = (route, body, headers = {}) => localFetch(`/api/auth/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': state.token, ...headers }, body: JSON.stringify(body) });
 return { root, service, upstream, client: createAuthClient(localFetch), localFetch, post, cookie: () => cookie };
}
test('MU login, reload verification and logout use the real contract without exposing or storing tokens', async t => {
 const x = await fixture(t);
 const password = '12345678';
 assert.equal(await x.client.session(), null);
 assert.equal((await x.client.login({ email: ' Player@Example.com ', password })).mode, 'mu');
 const request = x.upstream.calls[0];
 assert.equal(request.route, '/api/v1/auth/login');
 assert.deepEqual(request.body, { email: 'player@example.com', password, deviceName: 'MODDOCK 0.5.0 (' + process.platform + ')' });
 assert.match(x.cookie(), /^moddock-account-\d+=[a-f0-9]{64}$/);
 const response = await x.localFetch('/api/auth/session');
 const text = await response.text();
 for (const secret of ['access-secret', 'refresh-secret', password]) assert.ok(!text.includes(secret));
 assert.equal(x.upstream.calls.at(-1).headers.Authorization, 'Bearer access-secret-1');
 assert.equal((await x.client.session()).email, 'player@example.com');
 assert.equal((await fetch(x.service.url + '/api/auth/session').then(r => r.json())).profile, null, 'A second browser cannot inherit this login');
 for (const file of await fs.readdir(x.root)) {
  if (!(await fs.stat(path.join(x.root, file))).isFile()) continue;
  const contents = await fs.readFile(path.join(x.root, file), 'utf8');
  assert.ok(!/access-secret|refresh-secret|12345678/.test(contents));
 }
 await x.client.logout();
 assert.equal(x.upstream.calls.at(-1).route, '/api/v1/auth/logout');
 assert.equal(await x.client.session(), null);
});
test('MU email code and registration send purpose, consent version and entered code; invalid code stays logged out', async t => {
 const x = await fixture(t);
 const input = { email: 'register@example.com', password: 'a'.repeat(128), termsAccepted: true };
 const challenge = await x.client.sendCode(input);
 assert.equal(challenge.expiresAt - challenge.resendAt, 540000);
 assert.deepEqual(x.upstream.calls[0].body, { email: input.email, purpose: 'register' });
 await assert.rejects(x.client.register({ ...input, code: '111111' }), error => error.code === 'invalid_code' && error.status === 400);
 assert.equal(await x.client.session(), null);
 const profile = await x.client.register({ ...input, code: '246810' });
 assert.equal(profile.email, input.email);
 assert.deepEqual(x.upstream.calls.at(-1).body, { email: input.email, password: input.password, code: '246810', termsVersion: TERMS_VERSION, deviceName: `MODDOCK 0.5.0 (${process.platform})` });
 assert.equal(x.upstream.calls.filter(call => call.route.includes('verify')).length, 0);
});
test('local auth rejects missing token, cross-origin posts, missing consent and invalid inputs before calling MU', async t => {
 const x = await fixture(t);
 const body = { email: 'player@example.com', password: '12345678' };
 assert.equal((await x.post('login', body, { 'X-Moddock-Token': '' })).status, 403);
 assert.equal((await x.post('login', body, { Origin: 'https://other.example' })).status, 403);
 assert.equal((await x.post('code', body)).status, 400);
 assert.equal((await x.post('register', { ...body, code: '246810', termsAccepted: true, termsVersion: 'stale' })).status, 400);
 assert.equal((await x.post('login', { ...body, password: 'short' })).status, 400);
 assert.equal((await x.post('login', { ...body, email: 'bad' })).status, 400);
 assert.equal(x.upstream.calls.length, 0);
});
test('expired access token rotates once for concurrent session reads and logout uses the new bearer', async t => {
 const x = await fixture(t);
 await x.client.login({ email: 'player@example.com', password: '12345678' });
 x.upstream.advance(900000);
 await Promise.all([x.client.session(), x.client.session(), x.client.session()]);
 const refreshes = x.upstream.calls.filter(call => call.route.endsWith('/auth/refresh'));
 assert.equal(refreshes.length, 1);
 assert.deepEqual(refreshes[0].body, { refreshToken: 'refresh-secret-1' });
 await x.client.logout();
 assert.equal(x.upstream.calls.at(-1).headers.Authorization, 'Bearer access-secret-2');
});
test('401 retries via refresh; a revoked or disabled account clears the local session', async t => {
 const x = await fixture(t);
 await x.client.login({ email: 'player@example.com', password: '12345678' });
 x.upstream.fail(401, 'invalid_session', '会话过期');
 assert.equal((await x.client.session()).mode, 'mu');
 assert.equal(x.upstream.calls.filter(call => call.route.endsWith('/auth/refresh')).length, 1);
 x.upstream.fail(403, 'account_disabled', '账号已被停用。');
 await assert.rejects(x.client.session(), error => error.code === 'account_disabled');
 assert.equal(await x.client.session(), null);
});
test('MU rate limits and maintenance are preserved; failed logout still clears the local session', async t => {
 const x = await fixture(t);
 x.upstream.fail(429, 'code_rate_limited', '请稍后再获取验证码。', 120);
 const response = await x.post('code', { email: 'player@example.com', password: '12345678', termsAccepted: true });
 assert.equal(response.status, 429);
 assert.equal(response.headers.get('retry-after'), '120');
 assert.equal((await response.json()).retryAfterSeconds, 120);
 x.upstream.fail(503, 'service_maintenance', '服务维护中，请稍后重试。', 30);
 await assert.rejects(x.client.login({ email: 'player@example.com', password: '12345678' }), error => error.code === 'service_maintenance' && error.retryAfterSeconds === 30);
 await x.client.login({ email: 'player@example.com', password: '12345678' });
 x.upstream.fail(503, 'service_unavailable', '服务暂时不可用');
 await assert.rejects(x.client.logout(), error => error.status === 503);
 assert.equal(await x.client.session(), null);
});
test('unreachable MU and malformed successful sessions cannot appear as authenticated', async () => {
 const input = { email: 'player@example.com', password: '12345678' };
 const unavailable = createAccountClient({ fetch: async () => { throw new Error('network private details'); } });
 await assert.rejects(unavailable.login(input), error => error.status === 503 && !error.message.includes('private'));
 const malformed = createAccountClient({ fetch: async () => Response.json({ accessToken: 'token' }) });
 await assert.rejects(malformed.login(input), error => error.status === 502);
 assert.throws(() => createAccountClient({ baseUrl: 'http://remote.example/' }), /HTTPS/);
});
test('all local business routes require a session; bootstrap token and forged cookies cannot bypass login', async t => {
 const x = await fixture(t);
 const config = await x.localFetch('/api/auth/config').then(response => response.json());
 const state = await x.localFetch('/api/state');
 assert.equal(state.status, 401);
 assert.deepEqual(await state.json(), { code: 'login_required', message: '请先登录游匣账号。' });
 for (const route of ['scan', 'paths', 'sources/connection', 'sources/list', 'downloads/start', 'downloads/file', 'installations/apply', 'installations/launch', 'library/import', 'loadouts/switch', 'updates/download', 'nexus/receive']) {
  const response = await fetch(x.service.url + '/api/' + route, { method: 'POST', headers: { 'X-Moddock-Token': config.token, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 401, route);
 }
 const forged = await fetch(x.service.url + '/api/state', { headers: { Cookie: `moddock-account-${new URL(x.service.url).port}=fake-session` } });
 assert.equal(forged.status, 401);
 await assert.rejects(x.service.receiveNxm('nxm://stardewvalley/mods/99/files/5'), error => error.code === 'login_required');
 assert.equal(x.service.downloads.jobs.length, 0);
 assert.equal(x.upstream.calls.length, 0);
});
test('login opens business routes with an HttpOnly API cookie; logout invalidates copied cookies immediately', async t => {
 const x = await fixture(t);
 const login = await x.post('login', { email: 'player@example.com', password: 'player123' });
 assert.equal(login.status, 200);
 assert.match(login.headers.getSetCookie()[0], /HttpOnly; SameSite=Strict; Path=\/api$/);
 const cookie = x.cookie();
 assert.equal((await x.localFetch('/api/state')).status, 200);
 assert.equal((await x.localFetch('/api/state')).status, 200);
 assert.equal(x.upstream.calls.filter(call => call.route.endsWith('/account/me')).length, 0, 'Frequent state polls share the freshly verified login');
 await x.client.logout();
 assert.equal((await fetch(x.service.url + '/api/state', { headers: { Cookie: cookie } })).status, 401);
 await assert.rejects(x.service.receiveNxm('nxm://stardewvalley/mods/99/files/5'), error => error.code === 'login_required');
});
test('business authorization coalesces remote checks and blocks revoked, disabled or unavailable MU sessions', async t => {
 const x = await fixture(t);
 await x.client.login({ email: 'player@example.com', password: 'player123' });
 x.upstream.advance(31000);
 const reads = await Promise.all([x.localFetch('/api/state'), x.localFetch('/api/state'), x.localFetch('/api/state')]);
 assert.ok(reads.every(response => response.status === 200));
 assert.equal(x.upstream.calls.filter(call => call.route.endsWith('/account/me')).length, 1);
 x.upstream.advance(31000);
 x.upstream.fail(503, 'service_unavailable', '服务暂时不可用');
 assert.equal((await x.localFetch('/api/state')).status, 503);
 assert.equal((await x.localFetch('/api/state')).status, 200, 'Recovery must revalidate instead of using the failed check');
 x.upstream.advance(31000);
 x.upstream.revoke();
 assert.equal((await x.localFetch('/api/state')).status, 401);
 assert.equal((await x.localFetch('/api/state')).status, 401);
 assert.equal(await x.client.session(), null);
});
