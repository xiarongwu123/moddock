const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { scan, resolveSteamRoot } = require('../scanner.cjs');
const { createServer, loginFixture } = require('./server-fixture.cjs');
const { accountFixture } = require('./account-fixture.cjs');

async function fixture(t, options = {}) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-scan-'));
 const library = path.join(root, 'SteamLibrary'), game = path.join(library, 'steamapps/common/Scan Sample');
 await fs.mkdir(game, { recursive: true });
 await fs.writeFile(path.join(library, 'steamapps/appmanifest_987654.acf'), '"AppState" { "appid" "987654" "name" "Scan Sample" "installdir" "Scan Sample" }');
 const canonical = await fs.realpath(library);
 let selected = game, calls = 0, service;
 const account = accountFixture();
 async function start() {
  service = await createServer({ root: path.join(root, 'data'), port: 0, accounts: account.options,
   scan: paths => scan(paths, path.join(root, 'no-epic')),
   chooseScanDirectory: async () => { calls++; return typeof selected === 'function' ? selected() : selected; }, ...options });
  const auth = await loginFixture(service);
  return {
   state: () => auth.fetch(service.url + '/api/state').then(r => r.json()),
   post: (route, body = {}, headers = {}) => auth.fetch(service.url + '/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': auth.state.token, ...headers }, body: JSON.stringify(body) }),
  };
 }
 const api = await start();
 t.after(async () => { if (service?.server.listening) await new Promise(resolve => service.server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
 return { root, library, canonical, game, api, account, get service() { return service; }, get calls() { return calls; }, select(value) { selected = value; },
  async restart() { await new Promise(resolve => service.server.close(resolve)); return start(); } };
}
test('selected Steam game and steamapps folders resolve to one canonical library; non-libraries are rejected', async t => {
 const x = await fixture(t);
 for (const directory of [x.library, path.join(x.library, 'steamapps'), path.dirname(x.game), x.game]) assert.equal(await resolveSteamRoot(directory), x.canonical);
 await assert.rejects(resolveSteamRoot(x.root), /未找到 Steam 游戏库/);
 await assert.rejects(resolveSteamRoot(path.join(x.library, 'steamapps/appmanifest_987654.acf')), /请选择文件夹/);
 await assert.rejects(resolveSteamRoot('relative'), /有效/);
 await assert.rejects(resolveSteamRoot(path.join(x.root, 'missing')), /无法读取/);
});
test('picker persists a library once, scanning discovers games, restart restores it, and removing never deletes files', async t => {
 const x = await fixture(t);
 assert.equal((await x.api.state()).canChooseScanDirectory, true);
 assert.deepEqual(await (await x.api.post('paths/select')).json(), { added: true, path: x.canonical });
 await x.api.post('scan');
 let state = await x.api.state();
 assert.equal(state.scan.games.find(g => g.id === 'steam-987654').libraryPath, x.canonical);
 assert.equal(state.scan.locations.find(location => location.path === x.canonical).gameCount, 1);
 x.select(path.join(x.library, 'steamapps'));
 assert.equal((await (await x.api.post('paths/select')).json()).added, false);
 assert.deepEqual((await x.api.state()).scanPaths, [x.canonical]);
 const api = await x.restart();
 assert.deepEqual((await api.state()).scanPaths, [x.canonical]);
 assert.equal((await api.post('paths/remove', { path: x.canonical })).status, 200);
 await api.post('scan'); state = await api.state();
 assert.deepEqual(state.scanPaths, []);
 assert.ok(!state.scan.games.some(g => g.id === 'steam-987654'));
 assert.ok((await fs.stat(x.game)).isDirectory());
 assert.equal((await api.post('paths/remove', { path: x.root })).status, 400);
});
test('cancel, invalid selections and unavailable desktop picker do not mutate scan paths', async t => {
 const x = await fixture(t);
 x.select(null);
 assert.deepEqual(await (await x.api.post('paths/select')).json(), { cancelled: true });
 x.select(x.root);
 assert.equal((await x.api.post('paths/select')).status, 400);
 assert.deepEqual((await x.api.state()).scanPaths, []);
 const web = await fixture(t, { chooseScanDirectory: undefined });
 assert.equal((await web.api.state()).canChooseScanDirectory, false);
 assert.equal((await web.api.post('paths/select')).status, 501);
});
test('picker requires login, CSRF and configuration permission before opening the native window', async t => {
 const x = await fixture(t), token = (await x.api.state()).token;
 assert.equal((await fetch(x.service.url + '/api/paths/select', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': token }, body: '{}' })).status, 401);
 assert.equal((await x.api.post('paths/select', {}, { 'X-Moddock-Token': 'wrong' })).status, 403);
 x.account.updateAccount({ features: [] });
 assert.equal((await x.api.post('paths/select')).status, 403);
 assert.equal(x.calls, 0);
});
test('only one picker opens and signing out while it is open prevents a late configuration write', async t => {
 const x = await fixture(t);
 let release, opened;
 const ready = new Promise(resolve => { opened = resolve; });
 x.select(() => new Promise(resolve => { release = resolve; opened(); }));
 const pending = x.api.post('paths/select');
 await ready;
 assert.equal((await x.api.post('paths/select')).status, 409);
 await x.api.post('auth/logout');
 release(x.game);
 assert.equal((await pending).status, 401);
 const api = await x.restart();
 assert.deepEqual((await api.state()).scanPaths, []);
 x.select(x.game);
 assert.equal((await api.post('paths/select')).status, 200);
});
test('legacy Steam libraryfolders entries and alternate folder selections are deduplicated', async t => {
 const x = await fixture(t), launcher = path.join(x.root, 'Steam');
 await fs.mkdir(path.join(launcher, 'steamapps'), { recursive: true });
 await fs.writeFile(path.join(launcher, 'steamapps/libraryfolders.vdf'), `"LibraryFolders" { "TimeNextStatsReport" "123" "1" "${x.library.replace(/\\/g, '\\\\')}" }`);
 const result = await scan([launcher, x.game, x.library], path.join(x.root, 'no-epic'));
 assert.equal(result.roots.filter(p => p === x.canonical).length, 1);
 assert.equal(result.games.filter(g => g.id === 'steam-987654').length, 1);
});
