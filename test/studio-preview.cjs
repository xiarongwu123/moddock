// Temporary game/account fixtures. --live-ai calls the configured real model.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createServer } = require('./server-fixture.cjs');
const { accountFixture } = require('./account-fixture.cjs');

(async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-studio-preview-'));
 const installPath = path.join(root, 'Stardew Valley');
 const write = async (file, data) => { await fs.mkdir(path.dirname(path.join(installPath, file)), { recursive: true }); await fs.writeFile(path.join(installPath, file), data); };
 await write('StardewModdingAPI.dll', 'fixture loader');
 await write('StardewModdingAPI.deps.json', JSON.stringify({ libraries: { 'SMAPI/4.2.0': {} } }));
 await write('Stardew Valley.deps.json', JSON.stringify({ libraries: { 'Stardew Valley/1.6.15': {} } }));
 await write('Mods/ContentPatcher/manifest.json', JSON.stringify({ Name: 'Content Patcher', UniqueID: 'Pathoschild.ContentPatcher', Version: '2.9.0', EntryDll: 'ContentPatcher.dll' }));
 await write('Saves/player.sav', 'unchanged');
 const game = { id: 'steam-413150', appId: '413150', name: '星露谷物语', platform: 'Steam', installPath, real: true };
 const unreal = { id: 'fixture-unreal', name: '霍格沃茨之遗 · 测试目录', searchName: 'Hogwarts Legacy', platform: '本地', installPath: path.join(root, 'Unreal'), real: true };
 const unity = { id: 'fixture-unity', name: 'Unity Mono · 测试目录', platform: '本地', installPath: path.join(root, 'Unity'), real: true };
 const unknown = { id: 'fixture-custom', name: '自定义游戏 · 测试目录', platform: '本地', installPath: path.join(root, 'Custom'), real: true };
 for (const [item, files] of [[unreal, ['Game/Content/Paks/Game.pak','Game/Binaries/Win64/ue4ss/UE4SS.dll']], [unity, ['UnityPlayer.dll','Game_Data/Managed/Assembly-CSharp.dll']], [unknown, ['game.exe']]]) for (const file of files) { await fs.mkdir(path.dirname(path.join(item.installPath, file)), { recursive: true }); await fs.writeFile(path.join(item.installPath, file), 'fixture'); }
 const games = [unreal, unity, game, unknown];
 if (process.argv.includes('--compiled-fixture')) await require('./toolchain-fixture.cjs').monoFixture(unity.installPath);
 const services = [];
 const studioAI = process.argv.includes('--live-ai') ? await require('../studio-ai.cjs').loadStudioAI() : {};
 const modes = ['pro', 'standard'];
 for (const mode of modes) {
  const pro = mode !== 'standard';
  const account = accountFixture(); if (pro) account.updateAccount({ membership: { tier: 'pro', expiresAt: null } });
  const service = await createServer({ root: path.join(root, mode), port: 0, accounts: account.options, studio: studioAI,
   scan: async () => ({ games, roots: [], diagnostics: [] }), installers: { processes: async () => [] } });
  services.push(service);
 }
 console.log(JSON.stringify({ pro: services[0].url, standard: services[1].url, root, provider: studioAI.provider || null }));
 const close = async () => { for (const service of services) { await new Promise(resolve => service.server.close(resolve)); await service.studio.conversations.settle(); await service.downloads.persist; } await fs.rm(root, { recursive: true, force: true }); process.exit(); };
 process.on('SIGINT', close); process.on('SIGTERM', close);
})().catch(error => { console.error(error); process.exitCode = 1; });
