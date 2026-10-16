const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { BG3Extender, unpack, download, RELEASE } = require('../bg3-extender.cjs');
const { createServer, loginFixture } = require('./server-fixture.cjs');
const { accountFixture } = require('./account-fixture.cjs');
const { pe, dll, executable, archive, release } = require('./bg3-extender-fixture.cjs');
async function fixture(t, options = {}) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-extender-'));
 const game = { id: 'steam-1086940', appId: '1086940', name: '博德之门 3 [TEST]', real: true, platform: 'Steam', installPath: path.join(root, 'BG3') };
 const bin = path.join(game.installPath, 'bin'); await fs.mkdir(bin, { recursive: true }); await fs.writeFile(path.join(bin, 'bg3_dx11.exe'), executable);
 const account = accountFixture(); account.updateAccount({ membership: { tier: 'pro', expiresAt: null } });
 let calls = 0;
 const server = await createServer({ root: path.join(root, 'data'), port: 0, accounts: account.options, nexusPlatformDisabled: true,
  scan: async () => ({ games: [game], roots: [], diagnostics: [] }), studio: { integration: { python: false } },
  installers: { processes: async () => [], ...options.installers },
  bg3Extender: { platform: 'win32', arch: 'x64', release, fetch: async () => { calls++; return new Response(archive); }, ...options.extender } });
 t.after(async () => { server.server.closeAllConnections(); await new Promise(resolve => server.server.close(resolve)); await server.downloads.persist; await fs.rm(root, { recursive: true, force: true }); });
 const auth = await loginFixture(server);
 const post = async (route, body = {}, headers = {}) => {
  const response = await auth.fetch(server.url + '/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': auth.state.token, ...headers }, body: JSON.stringify({ gameId: game.id, ...body }) });
  return { status: response.status, body: await response.json() };
 };
 return { root, game, bin, server, account, post, auth, calls: () => calls };
}
test('MU-gated one-click environment installation validates exact bytes, persists, and safely reuses existing loaders', async t => {
 const x = await fixture(t);
 const missing = await x.post('studio/environment'); assert.equal(missing.body.status, 'missing'); assert.equal(x.calls(), 0);
 const settings = path.join(x.bin, 'ScriptExtenderSettings.json'); await fs.writeFile(settings, '{"Custom":"preserve"}');
 const [a, b] = await Promise.all([x.post('studio/prepare-environment'), x.post('studio/prepare-environment')]);
 assert.equal(a.status, 200, JSON.stringify(a.body)); assert.equal(b.status, 200);
 assert.equal(x.calls(), 1); assert.deepEqual(await fs.readFile(path.join(x.bin, 'DWrite.dll')), dll);
 assert.equal(a.body.runtimeConfirmed, false); assert.equal(a.body.ready, true);
 assert.equal(await fs.readFile(settings, 'utf8'), '{"Custom":"preserve"}');
 assert.equal((await x.post('studio/prepare-environment')).body.status, 'ready'); assert.equal(x.calls(), 1);
 // A restart/new manager reads actual disk evidence, without requiring an app record.
 assert.equal((await new BG3Extender(x.root, x.server.installers).status(x.game)).ready, true);
 await fs.rm(path.join(x.bin, 'DWrite.dll'));
 assert.equal((await x.post('studio/prepare-environment')).status, 200); assert.equal(x.calls(), 1, 'verified download reused');
 const response = await fetch(x.server.url + '/api/studio/prepare-environment', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': x.auth.state.token }, body: JSON.stringify({ gameId: x.game.id }) });
 assert.equal(response.status, 401);
 x.account.updateAccount({ membership: { tier: 'standard', expiresAt: null } });
 assert.equal((await x.post('studio/prepare-environment')).status, 403);
});
test('unknown DLLs, duplicate names, links, running games and unsupported hosts never get overwritten', async t => {
 const x = await fixture(t), file = path.join(x.bin, 'DWrite.dll');
 await fs.writeFile(file, pe('different vendor'));
 assert.equal((await x.post('studio/prepare-environment')).status, 400); assert.deepEqual(await fs.readFile(file), pe('different vendor')); assert.equal(x.calls(), 0);
 await fs.rm(file); await fs.writeFile(file, dll); await fs.writeFile(path.join(x.bin, 'dwrite.DLL'), dll);
 const duplicates = (await fs.readdir(x.bin)).filter(name => /^dwrite\.dll$/i.test(name)).length;
 assert.equal((await x.post('studio/environment')).body.status, duplicates > 1 ? 'conflict' : 'ready'); await fs.rm(path.join(x.bin, 'dwrite.DLL'));
 await fs.rm(file, { force: true }); const outside = path.join(x.root, 'outside'); await fs.writeFile(outside, 'preserve'); await fs.symlink(outside, file);
 assert.equal((await x.post('studio/prepare-environment')).status, 400); assert.equal(await fs.readFile(outside, 'utf8'), 'preserve'); await fs.rm(file);
 x.server.installers.options.processes = async () => [{ pid: 12345, name: 'bg3_dx11.exe' }];
 assert.match((await x.post('studio/prepare-environment')).body.error, /退出游戏/); assert.equal(x.calls(), 0);
 assert.equal((await new BG3Extender(x.root, x.server.installers, { platform: 'darwin' }).status(x.game)).status, 'unsupported');
});
test('tampering, bad redirects and cancellation after download do not publish DLL bytes', async t => {
 const x = await fixture(t, { extender: { fetch: async () => new Response(Buffer.alloc(archive.length)) } });
 assert.match((await x.post('studio/prepare-environment')).body.error, /SHA-256/); await assert.rejects(fs.access(path.join(x.bin, 'DWrite.dll')));
 await assert.rejects(unpack(archive, { ...release, dllSha256: '0'.repeat(64) }), /完整性/);
 await assert.rejects(download(async () => new Response(null, { status: 302, headers: { location: 'https://attacker.invalid/mod.zip' } }), release), /地址无效/);
 let current = true;
 const component = new BG3Extender(path.join(x.root, 'cancelled'), x.server.installers, { platform: 'win32', arch: 'x64', release, fetch: async () => { current = false; return new Response(archive); } });
 await assert.rejects(component.ensure({ game: x.game, current: () => current, authorize: async () => {} }), /账号已切换/);
 await assert.rejects(fs.access(path.join(x.bin, 'DWrite.dll')));
});
test('official reviewed release bytes unpack into the pinned x64 DLL when available locally', async t => {
 const file = path.resolve('output/bg3-extender/BG3SE-Updater-20261012.zip');
 let bytes; try { bytes = await fs.readFile(file); } catch { t.skip('Official release bytes not downloaded in this environment'); return; }
 const actual = await unpack(bytes); assert.equal(actual.length, RELEASE.dllSize);
});
