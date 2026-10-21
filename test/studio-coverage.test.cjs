const { test } = require('node:test');
const assert = require('node:assert/strict');
const coverage = require('../studio-coverage.cjs');
const report = (engine = 'unknown', extra = {}) => ({ engine: { key: engine }, antiCheat: [], loaders: [], warnings: [], ...extra });

test('catalog has over 1000 distinct sourced records without declaring executable support', () => {
 const first = coverage.page({ limit: 100 });
 assert.ok(first.catalogCount >= 1000);
 const ids = new Set();
 for (let offset = 0; offset < first.total; offset += 100) for (const item of coverage.page({ offset, limit: 100 }).items) {
  assert.equal(item.status, 'unassessed'); assert.match(item.source, /^https:\/\/www\.nexusmods\.com\//);
  assert.ok(!ids.has(item.id)); ids.add(item.id);
 }
 assert.equal(ids.size, first.catalogCount);
 assert.ok(coverage.page({ query: 'Cyberpunk' }).items.some(item => /2077/.test(item.name)));
 assert.throws(() => coverage.page({ limit: 1000 }));
 assert.throws(() => coverage.page({ offset: -1 }));
});

test('coverage separates generic investigation, authoring, protection and missing adapters', () => {
 assert.equal(coverage.assessment({ id: 'unity', name: 'Unknown Unity' }, report('unity-il2cpp')).status, 'engine-investigation');
 assert.equal(coverage.assessment({ id: 'unknown' }, report()).status, 'missing-adapter');
 const native = coverage.assessment({ id: 'steam-881100', appId: '881100', name: 'Noita' }, report());
 assert.equal(native.status, 'authoring-route'); assert.ok(native.executableRoutes.includes('noita-lua'));
 assert.equal(native.buildVerified, false); assert.equal(native.installationVerified, false); assert.equal(native.gameplayVerified, false);
 for (const extra of [{ antiCheat: ['EAC'] }, { onlineOnly: true }]) {
  const protectedGame = coverage.assessment({ id: 'unity' }, report('unity-mono', extra));
  assert.equal(protectedGame.status, 'blocked'); assert.ok(protectedGame.routes.every(route => !route.available));
 }
});

test('1000 local identities audit in bounded batches with failures isolated and no inferred runtime evidence', async () => {
 const games = Array.from({ length: 1000 }, (_, i) => ({ id: 'local-' + i, name: 'Fixture ' + i }));
 let active = 0, peak = 0, calls = 0;
 const diagnose = async game => {
  active++; peak = Math.max(peak, active); calls++;
  await new Promise(resolve => setImmediate(resolve)); active--;
  if (game.id === 'local-500') throw new Error('fixture unreadable');
  return report('unity-il2cpp');
 };
 const items = [];
 let offset = 0;
 do { const result = await coverage.audit(games, { offset, limit: 100, diagnose }); items.push(...result.items); offset = result.nextOffset; } while (offset !== null);
 assert.equal(calls, 1000); assert.equal(peak, 2); assert.equal(items.length, 1000);
 assert.equal(items.filter(item => item.status === 'diagnostic-failed').length, 1);
 assert.ok(items.every(item => item.gameplayVerified !== true));
 assert.equal(coverage.MAX_LOCAL_GAMES >= 1000, true);
 await assert.rejects(coverage.audit(games, { limit: 101 }));
});

test('authenticated catalog and batch API work without selecting a game and retain Pro authorization', async t => {
 const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
 const { createServer, loginFixture } = require('./server-fixture.cjs');
 const account = require('./account-fixture.cjs').accountFixture();
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-api-'));
 const service = await createServer({ root, port: 0, accounts: account.options, scan: async () => ({ games: [], roots: [], diagnostics: [] }) });
 t.after(async () => { await new Promise(resolve => service.server.close(resolve)); await service.downloads.persist; await fs.rm(root, { recursive: true, force: true, maxRetries: 3 }); });
 const login = await loginFixture(service);
 const post = (route, body) => login.fetch(service.url + '/api/studio/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': login.state.token }, body: JSON.stringify(body) });
 assert.equal((await post('catalog', {})).status, 403);
 account.updateAccount({ membership: { tier: 'pro', expiresAt: null } });
 const found = await post('catalog', { query: 'Cyberpunk' }); assert.equal(found.status, 200); assert.ok((await found.json()).total > 0);
 const audited = await post('coverage', {}); assert.equal(audited.status, 200); assert.equal((await audited.json()).assessed, 0);
});
