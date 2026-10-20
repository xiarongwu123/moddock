const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer, loginFixture } = require('./server-fixture.cjs');
const { accountFixture } = require('./account-fixture.cjs');
const { createAccountTokenStore } = require('../account-token-store.cjs');
const { createSourceKeyStore } = require('../source-key-store.cjs');
const { Downloads } = require('../downloads.cjs');
const { encryptionFixture, FakeSocket, tick, until } = require('./source-auth-fixture.cjs');

async function fixture(t, options = {}) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-source-auth-'));
 const encryption = encryptionFixture(), account = accountFixture(), sockets = [], pages = [], requests = [];
 const sourceKeyStore = createSourceKeyStore(path.join(root, 'sources'), encryption);
 const tokenStore = createAccountTokenStore(path.join(root, 'account.bin'), encryption);
 let service;
 async function start() {
  service = await createServer({ root, port: 0, scan: async () => ({ games: [], diagnostics: [] }),
   accounts: { ...account.options, tokenStore }, sourceKeyStore,
   nexusSso: { application: 'moddock-test', openBrowser: url => pages.push(url), socket: () => { const s = new FakeSocket(); sockets.push(s); return s; } },
   sources: { fetch: async (url, init) => { requests.push({ url, init }); return options.validate ? options.validate(url, init) : Response.json({ user_id: 42 }); } },
  });
  return service;
 }
 await start();
 t.after(async () => { if (service.server.listening) await new Promise(resolve => service.server.close(resolve)); await fs.rm(root, { recursive: true, force: true, maxRetries: 3 }); });
 return { root, sourceKeyStore, sockets, pages, requests, account, get service() { return service; }, async restart() {
  await new Promise(resolve => service.server.close(resolve)); return start();
 } };
}
function client(service, auth) {
 return {
  state: () => auth.fetch(service.url + '/api/state').then(response => response.json()),
  async post(route, body = {}) {
   const response = await auth.fetch(service.url + '/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': auth.state.token }, body: JSON.stringify(body) });
   assert.equal(response.ok, true, `${route}: ${response.status}`); return response.json();
  },
 };
}
test('the HTTP cancel route only cancels the requested SSO attempt', async t => {
 const x = await fixture(t), api = client(x.service, await loginFixture(x.service));
 const first = await api.post('nexus/sso/start');
 const second = await api.post('nexus/sso/start');
 await api.post('nexus/sso/cancel', { id: first.id });
 assert.equal((await api.state()).nexusSso.status, 'connecting');
 assert.equal((await api.state()).nexusSso.id, second.id);
 await api.post('nexus/sso/cancel', { id: second.id });
 assert.equal((await api.state()).nexusSso.status, 'cancelled');
});
test('server restores encrypted keys with remembered MU login after restart and never exposes credentials', async t => {
 const x = await fixture(t);
 let auth = await loginFixture(x.service), api = client(x.service, auth);
 await api.post('sources/connection', { source: 'nexus', key: 'restart-private-key' });
 const config = await fetch(x.service.url + '/api/auth/config').then(r => r.json());
 const remembered = await fetch(x.service.url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': config.token }, body: JSON.stringify({ email: 'player@example.com', password: 'player123', remember: true }) });
 assert.equal((await remembered.json()).remember, true);
 await x.restart();
 const newConfig = await fetch(x.service.url + '/api/auth/config').then(r => r.json());
 const restored = await fetch(x.service.url + '/api/auth/restore', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': newConfig.token }, body: '{}' });
 assert.equal((await restored.json()).profile.id, 'fixture-user');
 const cookie = restored.headers.getSetCookie().find(value => /Path=\/api(?:;|$)/.test(value)).split(';')[0];
 auth = { state: { token: newConfig.token }, fetch: (url, init = {}) => fetch(url, { ...init, headers: { ...init.headers, Cookie: cookie } }) };
 api = client(x.service, auth);
 const state = await api.state(); assert.equal(state.connections.nexusConnected, true); assert.equal(state.connections.saved.nexus, true);
 assert.doesNotMatch(JSON.stringify(state), /restart-private-key|refresh-secret|access-secret/);
 for (const name of await fs.readdir(path.join(x.root, 'sources'))) assert.equal((await fs.readFile(path.join(x.root, 'sources', name))).includes(Buffer.from('restart-private-key')), false);
 await api.post('sources/connection', { source: 'nexus', key: '' });
 await x.restart(); auth = await loginFixture(x.service); api = client(x.service, auth);
 assert.equal((await api.state()).connections.nexusConnected, false);
});
test('SSO validates the official API key before saving; logout cancels late grants and another MU account sees no key', async t => {
 const x = await fixture(t), api = client(x.service, await loginFixture(x.service));
 await api.post('nexus/sso/start'); x.sockets[0].open(); await tick();
 x.sockets[0].message({ success: true, data: { api_key: 'sso-private-key' } });
 await until(async () => (await api.state()).nexusSso.status === 'connected');
 assert.equal(x.requests[0].url, 'https://api.nexusmods.com/v1/users/validate.json');
 assert.equal(x.requests[0].init.headers.apikey, 'sso-private-key');
 assert.equal((await api.state()).connections.saved.nexus, true);
 await api.post('nexus/sso/start'); x.sockets[1].open();
 await api.post('auth/logout');
 x.sockets[1].message({ success: true, data: { api_key: 'late-private-key' } }); await tick();
 assert.equal(x.sockets[1].closed, true);
 x.account.updateAccount({ id: 'other-user' });
 const other = client(x.service, await loginFixture(x.service));
 assert.equal((await other.state()).connections.nexusConnected, false);
 await other.post('auth/logout'); x.account.updateAccount({ id: 'fixture-user' });
 const original = client(x.service, await loginFixture(x.service));
 assert.equal((await original.state()).connections.nexusConnected, true);
 const keys = await x.sourceKeyStore.read(x.service.accountLegalUrls.terms + '\nfixture-user');
 assert.equal(keys.nexus, 'sso-private-key');
});
test('cancel during Nexus validation prevents a late save, and changing password cancels the active flow', async t => {
 let validated;
 const x = await fixture(t, { validate: () => new Promise(resolve => { validated = resolve; }) });
 const api = client(x.service, await loginFixture(x.service));
 await api.post('nexus/sso/start'); x.sockets[0].open(); x.sockets[0].message({ success: true, data: { api_key: 'cancelled-secret' } });
 await until(() => !!validated); await api.post('nexus/sso/cancel'); validated(Response.json({ user_id: 42 })); await tick();
 assert.equal((await api.state()).connections.nexusConnected, false);
 await assert.rejects(fs.access(path.join(x.root, 'sources')));
 await api.post('nexus/sso/start'); x.sockets[1].open();
 await api.post('account/password', { currentPassword: 'player123', newPassword: 'player456' });
 assert.equal(x.sockets[1].closed, true);
});
test('rejected Nexus keys never replace an existing saved connection', async t => {
 const x = await fixture(t, { validate: async () => new Response('', { status: 401 }) });
 const api = client(x.service, await loginFixture(x.service));
 await api.post('sources/connection', { source: 'nexus', key: 'working-key' });
 await api.post('nexus/sso/start'); x.sockets[0].open(); x.sockets[0].message({ success: true, data: { api_key: 'rejected-key' } });
 await until(async () => (await api.state()).nexusSso.status === 'error');
 assert.equal((await api.state()).connections.nexusConnected, true);
 assert.equal((await x.sourceKeyStore.read(x.service.accountLegalUrls.terms + '\nfixture-user')).nexus, 'working-key');
});
test('download queues retain their initiating client and reject grants from another account', async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-client-queue-'));
 t.after(() => fs.rm(root, { recursive: true, force: true }));
 let release; const wait = new Promise(resolve => { release = resolve; }), requested = [];
 const source = owner => ({ resource() {}, async downloadFile(_game, _resource, file) { requested.push(owner + file); if (owner === 'alice') await wait; return { name: 'fixture.bin', size: 3, _url: 'https://gamebanana.com/dl/1' }; } });
 const alice = source('alice'), bob = source('bob'), downloads = await new Downloads(root, source('fallback'), { fetch: async () => new Response('abc') }).open();
 const game = { id: 'g', name: 'g' };
 for (let i = 1; i <= 4; i++) downloads.start(game, 'banana:1:1', String(i), 'Fixture', undefined, alice);
 downloads.start(game, 'banana:1:1', '5', 'Bob', undefined, bob);
 await until(() => requested.length === 3);
 assert.throws(() => downloads.resumeAuthorization(game, 'banana:1:1', '4', { key: 'bob-grant' }, bob), /另一个账号/);
 downloads.releaseClient(alice); release();
 await until(() => downloads.controllers.size === 0 && !downloads.jobs.some(j => j.status === 'queued'));
 assert.deepEqual(requested, ['alice1', 'alice2', 'alice3', 'bob5']);
 assert.equal(downloads.jobs.find(j => j.fileId === '5').status, 'completed');
 assert.equal(downloads.jobs.filter(j => j.status === 'cancelled').length, 4);
 assert.equal(downloads.clients.size, 0);
});
