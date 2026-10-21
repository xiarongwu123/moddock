const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { GameUpdates } = require('../game-updates.cjs');
const { bananaUpdate, ModLibrary } = require('../library.cjs');
const { Sources } = require('../sources.cjs');
const { Downloads } = require('../downloads.cjs');
const { zip } = require('./zip-fixture.cjs');
const crypto = require('node:crypto');
const { createServer, loginFixture } = require('./server-fixture.cjs');
async function fixture(t) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-builds-'));
 t.after(() => fs.rm(root, { recursive: true, force: true }));
 const game = { id: 'steam-413150', appId: '413150', name: 'Stardew Valley', platform: 'Steam', buildId: '100', installPath: path.join(root, 'game') };
 await fs.mkdir(game.installPath); await fs.writeFile(path.join(game.installPath, 'StardewModdingAPI.exe'), 'fixture');
 return { root, game };
}
test('build changes persist across restart, preserve missing observations and never flag the first scan', async t => {
 const { root, game } = await fixture(t), mods = [{ gameId: game.id, id: 'm', name: 'Example', status: 'enabled' }];
 let tracker = await new GameUpdates(root).open(); await tracker.observe([game]); assert.deepEqual(tracker.view([game], mods), []);
 tracker = await new GameUpdates(root).open(); await tracker.observe([]); await tracker.observe([{ ...game, buildId: null }]);
 game.buildId = '200'; await tracker.observe([game]);
 let alerts = tracker.view([game], mods); assert.equal(alerts[0].from, '100'); assert.equal(alerts[0].to, '200'); assert.equal(alerts[0].mods[0].name, 'Example'); assert.ok(alerts[0].loaders.includes('SMAPI'));
 const detectedAt = alerts[0].detectedAt;
 tracker = await new GameUpdates(root).open(); await tracker.observe([game]); assert.equal(tracker.view([game], mods)[0].detectedAt, detectedAt);
 await Promise.all([tracker.observe([{ ...game, buildId: '300' }]), tracker.observe([{ ...game, buildId: '400' }])]);
 assert.equal(tracker.state[game.id].change.from, '300'); assert.equal(tracker.state[game.id].change.to, '400');
});
const job = { fileId: '1', sourceFileUpdated: '2026-01-01T00:00:00Z', sourceUpdated: '2026-01-01T00:00:00Z', sourceFileMd5: 'aaa', sourceVersion: '1.0' };
const current = { id: '1', md5: 'aaa', updated: '2026-01-01T00:00:00Z' };
test('GameBanana distinguishes page edits, old alternate files, new candidates and changed payloads', () => {
 const detail = { updated: job.sourceUpdated, version: '1.0', files: [current] };
 assert.equal(bananaUpdate(detail, job).status, 'current');
 assert.equal(bananaUpdate({ ...detail, updated: '2026-02-01T00:00:00Z' }, job).status, 'review');
 assert.equal(bananaUpdate({ ...detail, files: [current, { id: '2', updated: '2025-12-01T00:00:00Z' }] }, job).status, 'current');
 const next = { id: '3', updated: '2026-02-01T00:00:00Z', _url: 'secret', md5: 'bbb' };
 const review = bananaUpdate({ ...detail, files: [current, next] }, job); assert.equal(review.status, 'review'); assert.equal(review.files.length, 1); assert.equal(review.files[0]._url, undefined); assert.equal(review.files[0].md5, undefined);
 assert.equal(bananaUpdate({ ...detail, version: '2.0', files: [current, next] }, job).status, 'available');
 assert.equal(bananaUpdate({ ...detail, files: [{ ...current, md5: 'changed' }] }, job).status, 'available');
 assert.equal(bananaUpdate({ ...detail, files: [] }, job).status, 'review');
 assert.equal(bananaUpdate({ ...detail, files: [current, next] }, { fileId: '1' }).status, 'review');
});
test('GameBanana detail and download retain timestamps, archive filtering and source identity validation', async () => {
 const raw = { _aGame: { _idRow: 5937 }, _sVersion: '2.0', _tsDateModified: 1767225600, _aFiles: [{ _idRow: 1, _sFile: 'mod.zip', _sDownloadUrl: 'https://gamebanana.com/dl/1', _tsDateAdded: 1767225600, _sMd5Checksum: 'a'.repeat(32) }, { _idRow: 2, _bIsArchived: true }] };
 const source = new Sources({ fetch: async () => Response.json(raw) }); const game = { id: 'stardew', appId: '413150', banana: '5937' };
 const detail = await source.detail(game, 'banana:99'); assert.equal(detail.files.length, 1); assert.equal(detail.files[0].updated, '2026-01-01T00:00:00.000Z');
 const file = await source.downloadFile(game, 'banana:99', '1'); assert.equal(file.sourceUpdated, detail.updated); assert.equal(file.sourceVersion, '2.0');
 await assert.rejects(source.detail({ ...game, banana: '123' }, 'banana:99'), /不属于/);
 delete raw._aFiles; await assert.rejects(source.detail(game, 'banana:99'), /文件列表返回异常/);
});
test('mixed update checks isolate failures and preserve installed state, candidate downloads use their source', async () => {
 const mods = [{ id: 'n', gameId: 'g', resourceId: 'nexus:test:1', jobId: 'n', units: [], status: 'enabled' }, { id: 'b', gameId: 'g', resourceId: 'banana:1', jobId: 'b', status: 'enabled' }];
 const downloads = { jobs: [{ ...job, id: 'b' }], start: (...args) => args };
 const installers = { state: { mods }, exclusive: fn => fn(), save: async () => {} };
 const sources = { detail: async (_g, id) => { if (id.startsWith('nexus:')) throw new Error('offline'); return { files: [current, { id: '2', updated: '2026-02-01T00:00:00Z' }] }; } };
 const library = new ModLibrary(downloads, installers, sources), game = { id: 'g' };
 const result = await library.checkUpdates(game); assert.deepEqual(result.map(r => r.status), ['error', 'review']); assert.ok(mods.every(m => m.status === 'enabled'));
 assert.equal((await library.downloadUpdate(game, 'b', '2'))[1], 'banana:1');
 await assert.rejects(library.downloadUpdate(game, 'b', '99'), /请先检查/);
});
test('completed GameBanana downloads persist source comparison evidence across restart', async t => {
 const { root, game } = await fixture(t), bytes = zip([{ name: 'mod.txt', data: 'payload' }]);
 const md5 = crypto.createHash('md5').update(bytes).digest('hex');
 const source = { resource: () => ({}), downloadFile: async () => ({ name: 'mod.zip', size: bytes.length, md5, _url: 'https://gamebanana.com/dl/1', sourceUpdated: job.sourceUpdated, sourceVersion: '2.0', updated: job.sourceFileUpdated }) };
 const store = await new Downloads(root, source, { fetch: async () => new Response(bytes, { headers: { 'content-type': 'application/zip', 'content-length': String(bytes.length) } }) }).open();
 store.start(game, 'banana:99', '1', 'Example');
 for (let i = 0; i < 200 && (store.controllers.size || store.jobs[0].status === 'queued'); i++) await new Promise(resolve => setTimeout(resolve, 10));
 assert.equal(store.jobs[0].status, 'completed'); await store.save();
 const reopened = await new Downloads(root, source).open();
 assert.equal(reopened.jobs[0].sourceFileMd5, md5); assert.equal(reopened.jobs[0].sourceUpdated, job.sourceUpdated); assert.equal(reopened.jobs[0].sourceVersion, '2.0'); assert.equal(reopened.jobs[0].sourceFileUpdated, job.sourceFileUpdated);
});
test('server persists startup build baseline and exposes affected mods after rescan', async t => {
 const { root, game } = await fixture(t);
 const options = { root: path.join(root, 'data'), port: 0, scan: async () => ({ games: [{ ...game }], diagnostics: [] }) };
 let service = await createServer(options);
 await new Promise(resolve => service.server.close(resolve));
 game.buildId = '200'; service = await createServer(options); t.after(() => new Promise(resolve => service.server.close(resolve)));
 service.installers.state.mods.push({ id: 'm', name: 'Test Mod', gameId: game.id, status: 'enabled', files: [], units: [] });
 const auth = await loginFixture(service);
 let state = await (await auth.fetch(service.url + '/api/state')).json(); assert.equal(state.gameUpdates[0].from, '100'); assert.equal(state.gameUpdates[0].mods[0].id, 'm');
 game.buildId = '300';
 const response = await auth.fetch(service.url + '/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': state.token }, body: '{}' }); assert.equal(response.status, 200);
 state = await (await auth.fetch(service.url + '/api/state')).json(); assert.equal(state.gameUpdates[0].to, '300');
});
