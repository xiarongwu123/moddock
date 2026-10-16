const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAccountClient } = require('../account.cjs');
const { accountFixture } = require('./account-fixture.cjs');
const { Sources } = require('../sources.cjs');
const { createMuNexusPlatformClient } = require('../nexus-platform-client.cjs');
const credentials = { email: 'player@example.com', password: 'player123', remember: true };

function account() {
 const fixture = accountFixture(); let failure, cleared = 0;
 const client = createAccountClient({ ...fixture.options, retryDelay: 0,
  tokenStore: { isAvailable: () => true, write: async () => {}, clear: async () => { cleared++; } },
  fetch: (url, init) => failure ? failure(url, init, fixture.options.fetch) : fixture.options.fetch(url, init),
 });
 return { client, fixture, setFailure(value) { failure = value; }, cleared: () => cleared };
}

test('edge HTML and a transient network failure preserve a valid encrypted MU login', async () => {
 const x = account(), login = await x.client.login(credentials); let reads = 0;
 x.setFailure((url, init, next) => {
  if (new URL(url).pathname.endsWith('/account/me') && reads++ < 2) return Promise.resolve(new Response('<html>edge error</html>', { status: 502 }));
  return next(url, init);
 });
 await assert.rejects(x.client.session(login.id), error => error.code === 'account_response_unavailable');
 assert.equal(x.cleared(), 0);
 assert.equal((await x.client.session(login.id)).id, login.profile.id);
 let attempts = 0;
 x.setFailure((url, init, next) => { if (new URL(url).pathname.endsWith('/account/me') && attempts++ === 0) throw new Error('private connection details'); return next(url, init); });
 assert.equal((await x.client.session(login.id)).id, login.profile.id);
 assert.equal(attempts, 2); assert.equal(x.cleared(), 0);
});

test('non-JSON 401 pages cannot revoke MU login; real revoked refresh tokens still do', async () => {
 const x = account(), login = await x.client.login(credentials);
 x.setFailure(async () => new Response('<html>proxy authentication</html>', { status: 401 }));
 await assert.rejects(x.client.session(login.id), error => error.status === 502);
 assert.equal(x.cleared(), 0);
 x.setFailure(null); x.fixture.revoke();
 await assert.rejects(x.client.session(login.id), error => error.status === 401);
 assert.equal(await x.client.session(login.id), null); assert.equal(x.cleared(), 1);
});

test('token rotation and login mutations are not replayed after an uncertain network response', async () => {
 const x = account(); let writes = 0;
 x.setFailure(() => { writes++; throw new Error('private network detail'); });
 await assert.rejects(x.client.login(credentials), error => error.code === 'account_unavailable' && !error.message.includes('private'));
 assert.equal(writes, 1);
 x.setFailure(null); const login = await x.client.login(credentials); x.fixture.advance(900000);
 x.setFailure((url, init, next) => { if (new URL(url).pathname.endsWith('/auth/refresh')) { writes++; throw new DOMException('timeout', 'TimeoutError'); } return next(url, init); });
 await assert.rejects(x.client.session(login.id), error => error.code === 'account_timeout');
 assert.equal(writes, 2); assert.equal(x.cleared(), 0);
});

test('a slow Nexus poll cannot lock out verification and concurrent 401 responses rotate once', async () => {
 const x = account(), login = await x.client.login(credentials);
 let release, entered;
 const started = new Promise(resolve => { entered = resolve; });
 const slow = new Promise(resolve => { release = resolve; });
 x.setFailure(async (url, init, next) => {
  const route = new URL(url).pathname;
  if (!route.includes('/nexus/')) return next(url, init);
  if (route.endsWith('/verification')) return Response.json({ pending: false });
  entered(); await slow; return Response.json({ status: 'completed' });
 });
 const polling = x.client.nexusRequest(login.id, 'jobs/11111111-1111-4111-8111-111111111111'); await started;
 try {
  const frame = await Promise.race([x.client.nexusRequest(login.id, 'jobs/11111111-1111-4111-8111-111111111111/verification'), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('verification locked behind poll')), 500); timer.unref(); })]);
  assert.equal((await frame.json()).pending, false);
 } finally { release(); await polling; }
 let stale = 0;
 x.setFailure(async (url, init, next) => {
  if (!new URL(url).pathname.includes('/nexus/')) return next(url, init);
  if (init.headers.Authorization === 'Bearer access-secret-1') { stale++; await new Promise(resolve => setImmediate(resolve)); return Response.json({ code: 'invalid_session' }, { status: 401 }); }
  return Response.json({ ready: true });
 });
 await Promise.all([x.client.nexusRequest(login.id, 'status'), x.client.nexusRequest(login.id, 'status')]);
 assert.equal(stale, 2); assert.equal(x.fixture.calls.filter(call => call.route.endsWith('/auth/refresh')).length, 1);
});

test('GameBanana exact lookup recovers matches omitted by general search', async () => {
 const calls = [], game = { id: 'test', name: 'New Test Game' };
 const source = new Sources({ fetch: async url => {
  calls.push(String(url));
  return Response.json({ _aRecords: String(url).includes('/Game/Index') ? [{ _idRow: 42, _sName: game.name }] : [{ _idRow: 90, _sName: 'Unrelated Test Game' }] });
 } });
 assert.equal(await source.bananaGame(game), '42'); assert.equal(calls.length, 2);
});
test('a temporary MU poll outage reconnects to the original download without duplicating or cancelling it', async () => {
 let created = 0, reads = 0, cancelled = 0; const progress = [];
 const id = '11111111-1111-4111-8111-111111111111';
 const platform = createMuNexusPlatformClient(async (route, init) => {
  if (route === 'jobs') { created++; return Response.json({ id, status: 'running' }); }
  if (init?.method === 'DELETE') { cancelled++; return Response.json({ ok: true }); }
  if (reads++ === 0) throw Object.assign(new Error('MU temporarily offline'), { status: 503 });
  return Response.json({ id, status: 'completed', name: 'test.zip', size: 10, sha256: 'a'.repeat(64) });
 }, { interval: 1, reconnectTimeout: 1000 });
 const file = await platform.downloadFile({ nexus: 'squad' }, 'nexus:squad:1', '1', { onProgress: message => progress.push(message) });
 assert.equal(file.size, 10); assert.equal(created, 1); assert.equal(cancelled, 0); assert.match(progress.join(' '), /重连原任务/);
});

test('Squad is not confused with Cruelty Squad and absent indexes have a useful source status', async () => {
 const game = { id: 'squad-test', name: 'Squad' };
 const source = new Sources({ fetch: async () => Response.json({ _aRecords: [{ _idRow: 19007, _sName: 'Cruelty Squad' }, { _idRow: 23450, _sName: 'Jitsu Squad' }], _aMetadata: { _bIsComplete: true, _nRecordCount: 2 } }) });
 const result = await source.list('banana', game);
 assert.equal(result.status, 'unsupported'); assert.equal(result.code, 'GAME_NOT_LISTED'); assert.deepEqual(result.candidates, []);
 assert.match(result.message, /N 网或 Steam/);
});

test('ampersand aliases match only an exact game identity and ambiguous exact names remain selectable', async () => {
 const source = new Sources({ fetch: async () => Response.json({ _aRecords: [{ _idRow: 10, _sName: 'Draw and Guess' }] }) });
 assert.equal(await source.bananaGame({ id: 'draw', name: 'Draw & Guess' }), '10');
 const ambiguous = new Sources({ fetch: async () => Response.json({ _aRecords: [{ _idRow: 11, _sName: 'Same Game' }, { _idRow: 12, _sName: 'Same Game' }] }) });
 const result = await ambiguous.list('banana', { id: 'same', name: 'Same Game' });
 assert.equal(result.status, 'unmapped'); assert.equal(result.candidates.length, 2);
});
