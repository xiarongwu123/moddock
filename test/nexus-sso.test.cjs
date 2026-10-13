const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NexusSso } = require('../nexus-sso.cjs');
const { FakeSocket, tick, until } = require('./source-auth-fixture.cjs');

function fixture(t, options = {}) {
 const sockets = [], pages = [];
 const sso = new NexusSso({ application: 'moddock-test', openBrowser: url => pages.push(url), socket: url => {
  assert.equal(url, 'wss://sso.nexusmods.com'); const socket = new FakeSocket(); sockets.push(socket); return socket;
 }, retryDelay: 1, ...options });
 t.after(() => sso.close()); return { sso, sockets, pages };
}
test('SSO uses official protocol 2 and returns no API key or reconnect token to the renderer', async t => {
 const { sso, sockets, pages } = fixture(t), keys = [];
 const flow = sso.start('alice', async (key, current) => { assert.equal(current(), true); keys.push(key); });
 sockets[0].open(); await tick();
 assert.deepEqual(sockets[0].sent, [{ id: flow.id, token: null, protocol: 2 }]);
 const page = new URL(pages[0]);
 assert.equal(page.origin + page.pathname, 'https://www.nexusmods.com/sso');
 assert.equal(page.searchParams.get('application'), 'moddock-test'); assert.equal(page.searchParams.get('id'), flow.id);
 sockets[0].message({ success: true, data: { connection_token: 'reconnect-secret' } });
 sockets[0].message({ success: true, data: { api_key: 'nexus-api-secret' } }); await tick();
 assert.equal(sso.status('alice').status, 'connected'); assert.equal(sockets[0].closed, true);
 assert.deepEqual(keys, ['nexus-api-secret']);
 assert.doesNotMatch(JSON.stringify(sso.status('alice')), /nexus-api-secret|reconnect-secret/);
 assert.equal(sso.flows.get('alice').token, null);
});
test('SSO resumes the same browser authorization after a temporary disconnect', async t => {
 const { sso, sockets, pages } = fixture(t);
 const flow = sso.start('alice', async () => {}); sockets[0].open(); await tick();
 sockets[0].message({ success: true, data: { connection_token: 'connection-secret' } }); sockets[0].close();
 await until(() => sockets.length === 2); sockets[1].open(); await tick();
 assert.deepEqual(sockets[1].sent[0], { id: flow.id, token: 'connection-secret', protocol: 2 });
 assert.equal(pages.length, 1);
 sockets[1].message({ success: true, data: { api_key: 'restored-key' } }); await tick();
 assert.equal(sso.status('alice').status, 'connected');
});
test('a dismissed onboarding flow cannot cancel a newer Nexus connection', t => {
 const { sso, sockets } = fixture(t);
 const first = sso.start('alice', async () => {});
 const second = sso.start('alice', async () => {});
 sso.cancel('alice', first.id);
 assert.equal(sso.status('alice').id, second.id);
 assert.equal(sso.status('alice').status, 'connecting');
 assert.equal(sockets[1].closed, false);
 sso.cancel('alice', second.id);
 assert.equal(sso.status('alice').status, 'cancelled');
 assert.equal(sockets[1].closed, true);
});
test('cancellation and replacement ignore late callbacks, including verification already in progress', async t => {
 const { sso, sockets } = fixture(t); let release, committed = false;
 sso.start('alice', async (_key, current) => { await new Promise(resolve => { release = resolve; }); if (current()) committed = true; });
 sockets[0].open(); sockets[0].message({ success: true, data: { api_key: 'late-key' } });
 assert.equal(sso.status('alice').status, 'saving'); sso.cancel('alice'); release(); await tick();
 assert.equal(committed, false); assert.equal(sso.status('alice').status, 'cancelled');
 const fresh = sso.start('alice', async () => { committed = true; });
 sockets[0].message({ success: true, data: { api_key: 'stale-key' } }); await tick();
 assert.equal(committed, false); assert.equal(sso.status('alice').id, fresh.id);
 sso.forget('alice'); sockets[1].message({ success: true, data: { api_key: 'logged-out-key' } }); await tick();
 assert.equal(committed, false); assert.equal(sso.status('alice').status, 'idle');
});
test('missing App ID, timeouts, invalid payloads, denied grants and browser failures are actionable', async t => {
 assert.throws(() => new NexusSso().start('alice', () => {}), /应用标识/);
 const { sso, sockets } = fixture(t, { timeout: 15 }); sso.start('alice', async () => {});
 await until(() => sso.status('alice').status === 'expired'); assert.equal(sockets[0].closed, true);
 for (const value of [null, { success: false, error: 'upstream-secret' }, { success: true, data: { api_key: 'bad\nkey' } }]) {
  sso.start('alice', async () => assert.fail('Invalid key accepted')); sockets.at(-1).open(); sockets.at(-1).message(value);
  assert.equal(sso.status('alice').status, 'error'); assert.doesNotMatch(sso.status('alice').message, /upstream-secret/);
 }
 const broken = fixture(t, { openBrowser: () => { throw new Error('failed'); } });
 broken.sso.start('alice', async () => {}); broken.sockets[0].open(); await tick();
 assert.match(broken.sso.status('alice').message, /无法打开/);
});
