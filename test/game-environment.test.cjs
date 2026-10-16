const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { GameEnvironment } = require('../game-environment.cjs');
const { components } = require('../game-components.cjs');
const { Installers, hash } = require('../installers.cjs');
const { executable } = require('./bg3-extender-fixture.cjs');
const { zipContent } = require('../content-pack.cjs');
const { prepareCompiler } = require('../studio-compiler-setup.cjs');
const { createServer, loginFixture } = require('./server-fixture.cjs');
const { accountFixture } = require('./account-fixture.cjs');
const mockFiles = {
 'bepinex-x64': [['winhttp.dll', executable], ['doorstop_config.ini', Buffer.from('fixture')], ['BepInEx/core/BepInEx.dll', executable]],
 'bepinex-x86': [['winhttp.dll', executable], ['doorstop_config.ini', Buffer.from('fixture')], ['BepInEx/core/BepInEx.dll', executable]],
 ue4ss: [['dwmapi.dll', executable], ['ue4ss/UE4SS.dll', executable]],
 'ue4ss-configs': [['Wukong/UE4SS-settings.ini', Buffer.from('MajorVersion = 5\nMinorVersion = 0\n')], ['Wukong/VTableLayout.ini', Buffer.from('fixture')]],
 reframework: [['dinput8.dll', executable]],
 smapi: [['SMAPI fixture/internal/windows/install.dat', zipContent([{ name: 'StardewModdingAPI.dll', data: executable }, { name: 'StardewModdingAPI.exe', data: executable }])]],
};
const mockComponents = Object.fromEntries(Object.entries(mockFiles).map(([id, entries]) => {
 const bytes = zipContent(entries.map(([name, data]) => ({ name, data })));
 return [id, { ...components[id], size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes }];
}));
async function gameFixture(t, kind, options = {}) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'game-environment-'));
 const game = { id: kind, real: true, platform: 'Steam', name: kind + ' [TEST]', installPath: path.join(root, 'game') };
 const write = async (name, value) => { const file = path.join(game.installPath, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, value); };
 if (kind === 'unity') { game.appId = '892970'; await write('Valheim.exe', executable); await write('UnityPlayer.dll', 'fixture'); await write('Valheim_Data/Managed/Assembly-CSharp.dll', 'fixture'); }
 if (kind === 'wukong') { game.appId = '2358720'; await write('b1/Binaries/Win64/b1-Win64-Shipping.exe', executable); await write('b1/Content/Paks/fixture.pak', 'fixture'); }
 if (kind === 're4') { game.appId = '2050650'; await write('re4.exe', executable); await write('re_chunk_000.pak', 'fixture'); }
 if (kind === 'stardew') { game.appId = '413150'; await write('Stardew Valley.exe', executable); await write('Stardew Valley.deps.json', '{"libraries":{"Stardew Valley/1.6.15":{}}}'); }
 if (kind === 'unknown') await write('Game.exe', executable);
 await write('Saves/player.sav', 'preserve player save');
 const installers = await new Installers(path.join(root, 'app'), { jobs: [] }, { processes: async () => [] }).open();
 const selected = options.components || (options.official ? components : mockComponents);
 const manager = new GameEnvironment(path.join(root, 'app'), installers, null, { platform: 'win32',
  components: selected,
  fetch: async url => { const asset = Object.values(selected).find(item => item.url === url); return new Response(asset.bytes || await fs.readFile(path.resolve('output/game-environments', asset.name))); },
  contentPatcher: async () => { await write('Mods/ContentPatcher/manifest.json', '{"UniqueID":"Pathoschild.ContentPatcher","Version":"fixture"}'); }, ...options });
 const context = { game, owner: 'fixture', current: () => true, authorize: async () => {} };
 t.after(() => fs.rm(root, { recursive: true, force: true }));
 return { root, game, write, installers, manager, context };
}
test('different game families select and install their own actual official components without touching saves', async t => {
 try { for (const item of Object.values(components)) await fs.access(path.resolve('output/game-environments', item.name)); }
 catch { t.skip('Optional official archives not downloaded; isolated publication tests remain active'); return; }
 for (const [kind, target] of [['unity', 'BepInEx/core/BepInEx.dll'], ['wukong', 'b1/Binaries/Win64/ue4ss/UE4SS.dll'], ['re4', 'dinput8.dll'], ['stardew', 'StardewModdingAPI.dll']]) {
  const x = await gameFixture(t, kind, { official: true });
  assert.equal((await x.manager.status(x.game)).status, 'missing');
  const result = await x.manager.ensure(x.context); assert.equal(result.ready, true, JSON.stringify(result));
  assert.ok((await fs.stat(path.join(x.game.installPath, target))).size > 20000);
  assert.equal(result.runtimeConfirmed, false);
  assert.equal(await fs.readFile(path.join(x.game.installPath, 'Saves/player.sav'), 'utf8'), 'preserve player save');
  assert.equal((await x.manager.ensure(x.context)).ready, true);
  if (kind === 'wukong') {
   const ini = await fs.readFile(path.join(x.game.installPath, 'b1/Binaries/Win64/ue4ss/UE4SS-settings.ini'), 'utf8');
   assert.match(ini, /MajorVersion\s*=\s*5/); assert.match(ini, /MinorVersion\s*=\s*0/);
   const contents = await fs.readdir(path.join(x.game.installPath, 'b1/Binaries/Win64/ue4ss/Mods')); assert.equal(contents.length, 0, 'bundled cheat/demo Mods are not installed');
  }
 }
});
test('unknown engines and unprofiled Unreal games remain honest source-only routes', async t => {
 const x = await gameFixture(t, 'unknown');
 assert.equal((await x.manager.ensure(x.context)).coverage, 'source-only');
 await x.write('Game/Content/Paks/Base.pak', 'fixture');
 const unreal = await x.manager.status(x.game); assert.equal(unreal.coverage, 'source-only'); assert.equal(unreal.canPrepare, false);
 assert.deepEqual(await fs.readdir(x.game.installPath), ['Game', 'Game.exe', 'Saves']);
});
test('loader file conflicts and running games block new writes, while partial owned writes roll back', async t => {
 const x = await gameFixture(t, 'unity');
 await x.write('winhttp.dll', 'other injector');
 await assert.rejects(x.manager.ensure(x.context), /现有文件/);
 await assert.rejects(fs.access(path.join(x.game.installPath, 'BepInEx/core/BepInEx.dll')));
 assert.equal(await fs.readFile(path.join(x.game.installPath, 'winhttp.dll'), 'utf8'), 'other injector');
 await fs.rm(path.join(x.game.installPath, 'winhttp.dll'));
 x.installers.options.processes = async () => [{ pid: 99999, name: 'Valheim.exe' }];
 await assert.rejects(x.manager.ensure(x.context), /退出游戏/); x.installers.options.processes = async () => [];
 x.manager.options.afterWrite = async () => { throw new Error('fixture disk fault'); };
 await assert.rejects(x.manager.ensure(x.context), /disk fault/);
 await assert.rejects(fs.access(path.join(x.game.installPath, 'BepInEx/core/BepInEx.dll')));
 await assert.rejects(fs.access(path.join(x.game.installPath, 'winhttp.dll')));
 x.manager.options.afterWrite = undefined;
 assert.equal((await x.manager.ensure(x.context)).ready, true);
});
test('external identical bytes are preserved when a concurrent publication wins', async t => {
 const x = await gameFixture(t, 're4');
 const original = fs.link; let concurrent;
 fs.link = async (source, destination) => {
  if (destination.endsWith('dinput8.dll')) { await fs.copyFile(source, destination); concurrent = destination; }
  return original(source, destination);
 };
 try { await assert.rejects(x.manager.ensure(x.context), /EEXIST/); assert.ok((await fs.stat(concurrent)).size > 1000); }
 finally { fs.link = original; }
});
test('automatic compiler preparation checks official-style archive digest and cancellation before publication', async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'compiler-provision-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
 const bytes = zipContent([{ name: 'dotnet.exe', data: executable }, { name: 'sdk/fixture/Roslyn/bincore/csc.dll', data: Buffer.from('compiler fixture; not executed') }]);
 const sdk = { version: 'fixture', url: 'https://builds.dotnet.microsoft.com/fixture.zip', sha512: crypto.createHash('sha512').update(bytes).digest('hex') };
 const options = { sdk, fetch: async () => new Response(bytes) }, context = { current: () => true, authorize: async () => {} };
 const value = await prepareCompiler(root, context, options); assert.equal(await hash(value.executable), await hash(path.join(root, 'dotnet/dotnet.exe')));
 await assert.rejects(prepareCompiler(path.join(root, 'bad'), context, { ...options, sdk: { ...sdk, sha512: '0'.repeat(128) } }), /校验失败/);
 let current = true;
 await assert.rejects(prepareCompiler(path.join(root, 'cancel'), { ...context, current: () => current }, { sdk, fetch: async () => { current = false; return new Response(bytes); } }), /账号已切换/);
 await assert.rejects(fs.access(path.join(root, 'cancel/dotnet/dotnet.exe')));
});
test('Stardew dependency installation uses the MU platform and validates the downloaded Content Patcher identity', async t => {
 for (const identity of ['Pathoschild.ContentPatcher', 'Unexpected.Mod']) {
  const x = await gameFixture(t, 'stardew');
  await x.write('StardewModdingAPI.dll', 'fixture SMAPI');
  await x.write('StardewModdingAPI.deps.json', '{"libraries":{"SMAPI/4.5.2":{}}}');
  const bytes = zipContent([{ name: 'ContentPatcher/manifest.json', data: Buffer.from(JSON.stringify({ Name: 'Content Patcher', UniqueID: identity, Version: '2.9.0', EntryDll: 'ContentPatcher.dll' })) }, { name: 'ContentPatcher/ContentPatcher.dll', data: Buffer.from('fixture only; never executed') }]);
  let downloads = 0;
  const account = accountFixture(); account.updateAccount({ membership: { tier: 'pro', expiresAt: null } });
  const server = await createServer({ root: path.join(x.root, 'server'), port: 0, accounts: account.options,
   scan: async () => ({ games: [x.game], roots: [], diagnostics: [] }), installers: { processes: async () => [] }, gameEnvironment: { platform: 'win32' },
   sources: { nexusPlatform: { downloadFile: async (_game, resource, id) => { assert.equal(resource, 'nexus:stardewvalley:1915'); assert.equal(id, '42'); downloads++; return { name: 'ContentPatcher.zip', size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), _open: async () => new Response(bytes) }; } },
    fetch: async () => Response.json({ data: { game: { id: '1303' }, mod: { description: 'fixture', modRequirements: { nexusRequirements: { nodes: [] } } }, modFiles: [{ fileId: 42, name: 'ContentPatcher', detectedFileExtension: 'zip', sizeInBytes: bytes.length, version: '2.9.0', category: 'MAIN' }] } }) } });
  try {
   const auth = await loginFixture(server), response = await auth.fetch(server.url + '/api/studio/prepare-environment', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': auth.state.token }, body: JSON.stringify({ gameId: x.game.id }) });
   const value = await response.json();
   assert.equal(downloads, 1); assert.equal(response.status, identity === 'Pathoschild.ContentPatcher' ? 200 : 400, JSON.stringify(value));
   if (response.ok) { assert.equal(value.ready, true); assert.equal(server.installers.state.mods[0].units[0].id, identity); }
   else { assert.match(value.error, /不是官方 Content Patcher/); assert.equal(server.installers.state.mods.length, 0); }
  } finally { server.server.closeAllConnections(); await new Promise(resolve => server.server.close(resolve)); await server.downloads.persist; }
 }
});
