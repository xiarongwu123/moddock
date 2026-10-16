const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: wait } = require('node:timers/promises');
const { Sources } = require('../sources.cjs');
const { SourceConnections } = require('../source-connections.cjs');
const { Downloads } = require('../downloads.cjs');
const { createNexusService } = require('../platform/nexus-service.cjs');
const { createNexusPlatformClient, createMuNexusPlatformClient } = require('../nexus-platform-client.cjs');
const bytes = Buffer.from('centralized-service-file'), accessToken = 'a'.repeat(64), game = { id: 'g', name: 'Stardew Valley', nexus: 'stardewvalley' }, resource = 'nexus:stardewvalley:99';
const grant = file => `nxm://stardewvalley/mods/99/files/${file}?key=private-grant&expires=${Math.floor(Date.now() / 1000) + 60}&user_id=42`;
async function until(predicate) { for (let n = 0; n < 250; n++) { if (predicate()) return; await wait(10); } throw new Error('Timed out waiting for service state'); }
async function fixture(t, serviceOptions = {}) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-platform-'));
 const contexts = [], cancelled = [];
 const authorizer = { async open(page, context) { contexts.push(context); await context.onState('login_required'); }, cancel(owner, id) { cancelled.push(id); }, close() {} };
 const sources = new Sources(); sources.connect('nexus', 'backend-only-test-key');
 sources.downloadFile = async (_game, _resource, fileId, authorization) => {
  if (!authorization) throw Object.assign(new Error('Website grant needed'), { code: 'NEXUS_NXM_REQUIRED' });
  assert.equal(authorization.key, 'private-grant'); assert.equal(authorization.fileId, fileId);
  return { name: 'fixture.zip', size: bytes.length, version: '1.0', _url: 'https://premium-files.nexus-cdn.com/fixture.zip' };
 };
 const closers = [];
 const service = await createNexusService({ root, sources, authorizer, accessToken, fetch: async () => new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } }), ...serviceOptions }); t.after(async () => { for (const close of closers) await close(); await service.close(); await fs.rm(root, { recursive: true, force: true }); });
 const gateway = createNexusPlatformClient({ url: service.url, accessToken }, { interval: 10 });
 return { root, contexts, cancelled, service, gateway, closers, authorizer };
}
test('clients with no Nexus key share a backend session, wait for maintenance, and receive verified file bytes without grants', async t => {
 const x = await fixture(t), manager = new SourceConnections('test', { nexusPlatform: x.gateway }, { read: async () => ({ nexus: 'old-local-key' }), isAvailable: () => true });
 const alice = await manager.get('alice'), bob = await manager.get('bob'); assert.equal(alice.sources.keys.nexus, ''); assert.equal(bob.sources.keys.nexus, ''); assert.equal((await manager.status('alice')).nexusManaged, true);
 await assert.rejects(manager.connect('alice', 'nexus', 'another-key'), /平台服务/);
 const clients = await Promise.all(['alice', 'bob'].map(async owner => new Downloads(path.join(x.root, owner), (await manager.get(owner)).sources).open()));
 for (const client of clients) client.start(game, resource, '5', 'Mod');
 await until(() => x.contexts.length === 2); assert.ok(x.contexts.every(context => context.owner === 'platform'));
 await until(() => clients.every(client => /维护方/.test(client.jobs[0].message)));
 for (const context of x.contexts) { assert.throws(() => context.receive(grant(6)), /match/); await context.receive(grant(5)); }
 await until(() => clients.every(client => client.jobs[0].status === 'completed'));
 for (const client of clients) { assert.deepEqual(await fs.readFile(client.jobs[0].path), bytes); assert.equal(client.jobs[0].sha256, crypto.createHash('sha256').update(bytes).digest('hex')); const history = await fs.readFile(path.join(client.root, 'history.json'), 'utf8'); for (const secret of ['backend-only-test-key', 'private-grant', 'premium-files.nexus-cdn.com', accessToken]) assert.ok(!history.includes(secret)); }
 const response = await fetch(x.service.url + '/jobs/' + x.service.downloads.jobs[0].id, { headers: { Authorization: 'Bearer ' + accessToken } }); const state = await response.text(); assert.ok(!state.includes('private-grant')); assert.ok(!state.includes(x.root));
});
test('cancellation aborts the backend preparation without asking the client to authorize', async t => {
 const x = await fixture(t), controller = new AbortController();
 const result = x.gateway.downloadFile(game, resource, '5', { signal: controller.signal });
 await until(() => x.contexts.length === 1); const job = x.service.downloads.jobs[0]; controller.abort(); await assert.rejects(result); assert.equal(job.status, 'cancelled'); assert.equal(x.contexts[0].isCurrent(), false); assert.deepEqual(x.cancelled, [job.id]);
});
test('authorization failure ends client polling and frees backend preparation capacity', async t => {
 const x = await fixture(t), result = x.gateway.downloadFile(game, resource, '5');
 const rejected = assert.rejects(result, /暂时无法准备文件/);
 await until(() => x.contexts.length === 1); await x.contexts[0].onState('failed'); await rejected;
 assert.equal(x.service.downloads.jobs[0].status, 'failed'); assert.equal(x.contexts[0].isCurrent(), false);
 const status = await (await fetch(x.service.url + '/status', { headers: { Authorization: 'Bearer ' + accessToken } })).json(); assert.equal(status.pending, 0);
 const next = x.gateway.downloadFile(game, resource, '6'); await until(() => x.contexts.length === 2); await x.contexts[1].receive(grant(6));
 const file = await next; assert.deepEqual(Buffer.from(await (await file._open()).arrayBuffer()), bytes);
});
test('private local service rejects unauthenticated/browser requests and arbitrary network configurations', async t => {
 const x = await fixture(t);
 assert.equal((await fetch(x.service.url + '/status')).status, 401);
 assert.equal((await fetch(x.service.url + '/status', { headers: { Authorization: 'Bearer ' + accessToken, Origin: 'https://evil.test' } })).status, 403);
 const response = await fetch(x.service.url + '/jobs', { method: 'POST', headers: { Authorization: 'Bearer ' + accessToken }, body: JSON.stringify({ domain: '../etc', modId: '99', fileId: '5' }) }); assert.equal(response.status, 400); assert.equal(x.service.downloads.jobs.length, 0);
 for (const url of ['http://evil.test:8000', 'http://127.0.0.1:8000/path', 'http://user:secret@127.0.0.1:8000', 'http://127.0.0.1:8000/?key=secret']) assert.throws(() => createNexusPlatformClient({ url, accessToken }));
});
test('aborting preparation schedules cancellation before the MU owner session is released', async t => {
 const x = await fixture(t, { requireOwner: true }), controller = new AbortController(); let owner = 'mu-alice', reads = 0;
 const gateway = createMuNexusPlatformClient((route, init = {}) => {
  if (!owner) return Promise.reject(new Error('MU session released'));
  if (route.startsWith('jobs/') && !init.method) reads++;
  return fetch(x.service.url + '/' + route, { ...init, headers: { Authorization: 'Bearer ' + accessToken, 'X-Mu-Account-Id': owner } });
 }, { interval: 10 });
 const result = gateway.downloadFile(game, resource, '5', { signal: controller.signal });
 await until(() => reads > 0); controller.abort(); owner = null;
 await assert.rejects(result); assert.equal(x.service.downloads.jobs[0].status, 'cancelled'); assert.equal(x.cancelled.length, 1);
});
test('a corrupted service transfer fails the client hash check', async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-platform-hash-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
 const sources = new Sources({ nexusPlatform: { downloadFile: async () => ({ name: 'test.zip', size: bytes.length, sha256: '0'.repeat(64), _open: async () => new Response(bytes) }) } });
 const client = await new Downloads(root, sources).open(); client.start(game, resource, '5', 'Mod'); await until(() => client.jobs[0].status === 'failed'); assert.match(client.jobs[0].message, /校验值/); assert.equal(client.jobs[0].path, undefined);
});
test('the shared backend isolates MU owners for polling, cancellation and file access', async t => {
 const x = await fixture(t, { requireOwner: true });
 const headers = owner => ({ Authorization: 'Bearer ' + accessToken, 'X-Mu-Account-Id': owner });
 const missing = await fetch(x.service.url + '/status', { headers: { Authorization: 'Bearer ' + accessToken } }); assert.equal(missing.status, 400);
 const response = await fetch(x.service.url + '/jobs', { method: 'POST', headers: headers('mu-alice'), body: JSON.stringify({ domain: 'stardewvalley', modId: '99', fileId: '5' }) }); const job = await response.json();
 await until(() => x.contexts.length === 1); await x.contexts[0].receive(grant(5)); await until(() => x.service.downloads.jobs[0].status === 'completed');
 for (const [method, suffix] of [['GET', ''], ['DELETE', ''], ['GET', '/file']]) assert.equal((await fetch(x.service.url + '/jobs/' + job.id + suffix, { method, headers: headers('mu-bob') })).status, 404);
 assert.deepEqual(Buffer.from(await (await fetch(x.service.url + '/jobs/' + job.id + '/file', { headers: headers('mu-alice') })).arrayBuffer()), bytes);
});
test('verification pictures and clicks use the same owner isolation as downloads', async t => {
 const calls = [], revision = crypto.randomUUID();
 const x = await fixture(t, { requireOwner: true, verification: { view: async id => { calls.push(['view', id]); return { pending: true, revision, image: 'data:image/png;base64,dGVzdA==', width: 200, height: 100 }; }, click: async (id, input) => { calls.push(['click', id]); return input.revision === revision && input.x === 40 && input.y === 50; } } });
 const headers = owner => ({ Authorization: 'Bearer ' + accessToken, 'X-Mu-Account-Id': owner, 'Content-Type': 'application/json' });
 const job = await (await fetch(x.service.url + '/jobs', { method: 'POST', headers: headers('alice'), body: JSON.stringify({ domain: 'stardewvalley', modId: '99', fileId: '5' }) })).json();
 await until(() => x.contexts.length === 1); x.authorizer.active = { context: { jobId: job.id }, state: 'verification_required' }; await x.contexts[0].onState('verification_required');
 const state = await (await fetch(x.service.url + '/jobs/' + job.id, { headers: headers('alice') })).json(); assert.equal(state.verificationRequired, true);
 for (const [method, suffix] of [['GET', '/verification'], ['POST', '/verification/click']]) assert.equal((await fetch(x.service.url + '/jobs/' + job.id + suffix, { method, headers: headers('bob'), ...(method === 'POST' ? { body: '{}' } : {}) })).status, 404);
 assert.equal(calls.length, 0);
 const frame = await (await fetch(x.service.url + '/jobs/' + job.id + '/verification', { headers: headers('alice') })).json(); assert.equal(frame.revision, revision);
 const click = input => fetch(x.service.url + '/jobs/' + job.id + '/verification/click', { method: 'POST', headers: headers('alice'), body: JSON.stringify(input) });
 assert.equal((await click({ revision, x: 40, y: 50 })).status, 200); assert.equal((await click({ revision, x: -1, y: 50 })).status, 409);
 await x.contexts[0].receive(grant(5)); await until(() => x.service.downloads.jobs[0].status === 'completed');
 assert.equal((await (await fetch(x.service.url + '/jobs/' + job.id + '/verification', { headers: headers('alice') })).json()).pending, false);
});
test('default MU clients use their MU login for platform downloads with no local Nexus configuration', async t => {
 const x = await fixture(t), { createServer } = require('../server.cjs'), { accountFixture } = require('./account-fixture.cjs'), { loginFixture } = require('./server-fixture.cjs');
 const clients = [], requests = [];
 for (const owner of ['mu-alice', 'mu-bob']) {
  const account = accountFixture(); account.updateAccount({ id: owner }); const root = path.join(x.root, owner); await fs.mkdir(root);
  const remote = async (url, init) => {
   const pathname = new URL(url).pathname;
   if (!pathname.startsWith('/api/v1/nexus/')) return account.options.fetch(url, init);
   assert.match(init.headers.Authorization, /^Bearer access-secret-/); assert.ok(!init.headers.Authorization.includes(accessToken)); requests.push({ owner, pathname });
   return fetch(x.service.url + pathname.slice('/api/v1/nexus'.length), { ...init, headers: { Authorization: 'Bearer ' + accessToken, 'X-Mu-Account-Id': owner } });
  };
  const service = await createServer({ root, port: 0, scan: async () => ({ games: [{ ...game, installPath: root }], diagnostics: [] }), accounts: { ...account.options, fetch: remote } });
  clients.push(service); x.closers.push(async () => { service.server.closeAllConnections(); await new Promise(resolve => service.server.close(resolve)); });
  const auth = await loginFixture(service); assert.equal(auth.state.connections.nexusManaged, true); assert.equal(auth.state.connections.nexusConnected, true); assert.ok(!auth.state.connections.saved.nexus);
  const post = (route, body) => auth.fetch(service.url + '/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': auth.state.token }, body: JSON.stringify(body) });
  assert.equal((await post('sources/connection', { source: 'nexus', key: 'unused-test-key' })).status, 400);
  await post('downloads/start', { gameId: game.id, id: resource, fileId: '5', name: owner });
 }
 await until(() => x.contexts.length === 2); for (const context of x.contexts) await context.receive(grant(5)); await until(() => clients.every(client => client.downloads.jobs[0].status === 'completed' && client.downloads.controllers.size === 0));
 assert.ok(requests.some(request => request.owner === 'mu-alice')); assert.ok(requests.some(request => request.owner === 'mu-bob'));
 for (const client of clients) assert.deepEqual(await fs.readFile(client.downloads.jobs[0].path), bytes);
});
test('the client forwards only its own active verification and resumes the original download after a user click', async t => {
 let x;
 const revision = crypto.randomUUID(), image = 'data:image/png;base64,dGVzdA==';
 x = await fixture(t, { verification: { view: async () => ({ pending: true, revision, image, width: 200, height: 100 }), click: async (_id, input) => { assert.deepEqual(input, { revision, x: 40, y: 50 }); await x.contexts[0].receive(grant(5)); return true; } } });
 const { createServer } = require('../server.cjs'), { accountFixture } = require('./account-fixture.cjs'), { loginFixture } = require('./server-fixture.cjs');
 const account = accountFixture(), requests = [];
 const service = await createServer({ root: path.join(x.root, 'client'), port: 0, scan: async () => ({ games: [game], diagnostics: [] }), accounts: { ...account.options, fetch: (url, init) => {
  const pathname = new URL(url).pathname; if (!pathname.startsWith('/api/v1/nexus/')) return account.options.fetch(url, init);
  requests.push(pathname); return fetch(x.service.url + pathname.slice('/api/v1/nexus'.length), { ...init, headers: { Authorization: 'Bearer ' + accessToken } });
 } } });
 x.closers.push(async () => { service.server.closeAllConnections(); await new Promise(resolve => service.server.close(resolve)); });
 const auth = await loginFixture(service), post = (route, body) => auth.fetch(service.url + '/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': auth.state.token }, body: JSON.stringify(body) });
 const local = await (await post('downloads/start', { gameId: game.id, id: resource, fileId: '5', name: 'Verification fixture' })).json();
 await until(() => x.contexts.length === 1); x.authorizer.active = { context: { jobId: x.contexts[0].jobId }, state: 'verification_required' }; await x.contexts[0].onState('verification_required');
 await until(() => service.downloads.jobs[0].verificationRequired);
 const frame = await (await post('downloads/verification', { id: local.id })).json(); assert.equal(frame.revision, revision);
 assert.equal((await post('downloads/verification', { id: crypto.randomUUID() })).status, 400);
 assert.equal((await post('downloads/verification-click', { id: local.id, revision, x: 40, y: 50 })).status, 200);
 await until(() => service.downloads.jobs[0].status === 'completed' && service.downloads.controllers.size === 0);
 assert.equal(service.downloads.jobs[0].id, local.id); assert.equal(service.downloads.verifications.size, 0); assert.equal(service.downloads.jobs[0].verificationRequired, undefined);
 assert.ok(requests.some(route => route.endsWith('/verification/click')));
 const history = await fs.readFile(path.join(service.downloads.root, 'history.json'), 'utf8'); assert.ok(!history.includes(image)); assert.ok(!history.includes(x.contexts[0].jobId));
 assert.equal((await post('downloads/verification', { id: local.id })).status, 400);
});
