// Explicit fixture games. --real-mu uses a real MU gateway/model, not a real game.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { executable } = require('./bg3-extender-fixture.cjs');
const { monoFixture } = require('./toolchain-fixture.cjs');
const { accountFixture } = require('./account-fixture.cjs');
const { loginFixture } = require('./server-fixture.cjs');
const appRoot = path.resolve(process.env.MODDOCK_CROSS_APP_ROOT || path.join(__dirname, '..'));
const { createServer } = require(path.join(appRoot, 'server.cjs'));
const { components } = require(path.join(appRoot, 'game-components.cjs'));
const specs = [
 ['2358720', '黑神话：悟空 [TEST]', 'wukong', 'ue4ss-lua'], ['2050650', '生化危机 4 [TEST]', 're4', 'reframework-lua'],
 ['892970', 'Valheim [TEST]', 'unity', 'bepinex-plugin'], ['413150', '星露谷物语 [TEST]', 'stardew', 'dialogue'],
 ['489830', '上古卷轴 5 特别版 [TEST]', 'skyrim', 'project-plan'],
];
(async () => {
 const root = path.resolve(process.env.MODDOCK_CROSS_ROOT || 'output/game-environments/preview'), games = [];
 const write = async (base, file, bytes) => { await fs.mkdir(path.dirname(path.join(base, file)), { recursive: true }); await fs.writeFile(path.join(base, file), bytes); };
 for (const [appId, name, key, kind] of specs) {
  const game = { id: 'steam-' + appId, appId, name, platform: 'Steam', real: true, installPath: path.join(root, key), fixtureKind: kind };
  if (key === 'wukong') { await write(game.installPath, 'b1/Binaries/Win64/b1-Win64-Shipping.exe', executable); await write(game.installPath, 'b1/Content/Paks/Base.pak', 'fixture'); }
  if (key === 're4') { await write(game.installPath, 're4.exe', executable); await write(game.installPath, 're_chunk_000.pak', 'fixture'); }
  if (key === 'unity') { await write(game.installPath, 'Valheim.exe', executable); await write(game.installPath, 'UnityPlayer.dll', 'fixture'); await monoFixture(game.installPath); }
  if (key === 'stardew') {
   await write(game.installPath, 'Stardew Valley.exe', executable); await write(game.installPath, 'StardewModdingAPI.dll', 'fixture');
   await write(game.installPath, 'StardewModdingAPI.deps.json', '{"libraries":{"SMAPI/4.5.2":{}}}'); await write(game.installPath, 'Stardew Valley.deps.json', '{"libraries":{"Stardew Valley/1.6.15":{}}}');
   await write(game.installPath, 'Mods/ContentPatcher/manifest.json', '{"Name":"Content Patcher","UniqueID":"Pathoschild.ContentPatcher","Version":"2.9.0","EntryDll":"ContentPatcher.dll"}');
  }
  if (key === 'skyrim') { await write(game.installPath, 'SkyrimSE.exe', executable); await write(game.installPath, 'Data/Skyrim.esm', 'fixture'); }
  await write(game.installPath, 'Saves/player.sav', 'preserve'); games.push(game);
 }
 const account = accountFixture(); account.updateAccount({ membership: { tier: 'pro', expiresAt: null } });
 const prompts = { 'ue4ss-lua': '做一个 UE4SS Lua Mod，在加载时打印一句原创中文问候即可，不修改游戏内机制，不访问文件。其他你自己决定。',
  'reframework-lua': '做一个 REFramework Lua Mod，用 log.info 在加载时打印一句原创中文问候即可，不访问文件。其他你自己决定。',
  'bepinex-plugin': '做一个 BepInEx Mono 插件，仅在加载时执行一次 UnityEngine.Application.targetFrameRate = 90，不改变 VSync，不声称能提升性能。此测试只提供 Application.targetFrameRate API；不得使用其他 Unity 类型、GameObject、MonoBehaviour、Time、SceneManagement、事件或回调。使用宿主 Moddock.Generated.ModContent.Initialize 入口，方法内只需这一行赋值，不维持帧率。其他你自己决定。',
  dialogue: '给 Abigail 写周一和周五的简短原创中文问候，其他你自己决定。', 'project-plan': '整理此游戏的 Mod 开发方案，明确当前缺少专用制作打包适配，不生成可安装 Mod。其他你自己决定。' };
 const real = process.argv.includes('--real-mu');
 const { csharp } = await new (require('../studio-tools.cjs').StudioTools)().probe();
 const service = await createServer({ root: path.join(root, 'app'), port: Number(process.env.MODDOCK_CROSS_PORT || 18115), nexusPlatformDisabled: !real,
  accounts: real ? { baseUrl: 'http://127.0.0.1:18098/' } : account.options,
  scan: async () => ({ games, roots: [], diagnostics: [] }), installers: { processes: async () => [], openGame: async () => {} },
  gameEnvironment: { platform: 'win32', fetch: async url => { const asset = Object.values(components).find(item => item.url === url); if (!asset) throw new Error('Unregistered fixture distribution'); return new Response(await fs.readFile(path.resolve('output/game-environments', asset.name))); } },
  ...(real ? {} : { studio: { integration: { python: false }, tools: { dotnet: csharp.executable, luac: false },
   plan: async payload => { const kind = games.find(game => game.appId === payload.context.game.appId).fixtureKind; return { kind, title: '跨游戏流程测试', summary: '固定测试草稿，不是实际模型输出或游戏实测。', questions: [], steps: ['按此游戏适配器制作', '校验并打包'], requirements: [] }; },
   generate: async payload => ({ kind: payload.kind, name: '跨游戏测试作品', author: 'Fixture', description: '测试素材，不代表实际玩法已确认。', code: payload.kind === 'reframework-lua' ? 'log.info("fixture")' : 'print("fixture")', targetFps: 90,
    ...(payload.kind === 'bepinex-plugin' ? { code: undefined } : {}), npc: 'Abigail', entries: { Mon: '周一好。', Fri: '周五好。' }, plan: '当前未提供专用制作打包适配；这是开发方案，不能安装进游戏。' }) } }),
  ...(real ? { studio: undefined } : {}) });
 if (real) service.studio.toolchain.tools.options.dotnet = csharp.executable;
 console.log(JSON.stringify({ url: service.url, root, fixtureGamesOnly: true, realModel: real }));
 const close = async () => { for (const owner of service.studio.pending.keys()) service.studio.cancelOwner(owner); await service.studio.conversations.settle(); service.server.closeAllConnections(); await new Promise(resolve => service.server.close(resolve)); await service.downloads.persist; process.exit(); };
 process.on('SIGTERM', close); process.on('SIGINT', close);
 if (process.argv.includes('--verify')) {
  let auth;
  if (!real) auth = await loginFixture(service);
  else {
   const config = await fetch(service.url + '/api/auth/config').then(r => r.json()), credentials = JSON.parse(await fs.readFile(process.env.MODDOCK_CROSS_CREDENTIALS, 'utf8')).credentials;
   const response = await fetch(service.url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': config.token }, body: JSON.stringify(credentials) }); assert.equal(response.status, 200);
   const cookie = response.headers.getSetCookie().find(value => /Path=\/api(?:;|$)/.test(value)).split(';')[0];
   auth = { state: { token: config.token }, fetch: (url, init) => fetch(url, { ...init, headers: { ...init.headers, Cookie: cookie } }) };
  }
  const post = async (game, route, body = {}) => { const response = await auth.fetch(service.url + '/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': auth.state.token }, body: JSON.stringify({ gameId: game.id, ...body }) }); const value = await response.json(); assert.equal(response.status, route.endsWith('/send') ? 202 : 200, JSON.stringify(value)); return value; };
  const results = [];
  for (const game of games) {
   const environment = await post(game, 'studio/prepare-environment');
   const accepted = await post(game, 'studio/conversations/send', { message: prompts[game.fixtureKind] }); await service.studio.conversations.settle();
   const thread = await post(game, 'studio/conversations/read', { id: accepted.id }); assert.equal(thread.status, 'completed', thread.error);
   const artifact = await post(game, 'studio/read', { id: thread.artifactId }); assert.equal(artifact.toolchain.status, 'passed', JSON.stringify(artifact.toolchain));
   let installed = false;
   if (game.fixtureKind !== 'project-plan') { const kept = await post(game, 'studio/library', { id: artifact.id }); await post(game, 'installations/auto', { jobId: kept.jobId }); installed = true; }
   assert.equal(await fs.readFile(path.join(game.installPath, 'Saves/player.sav'), 'utf8'), 'preserve');
   const result = { game: game.name, adapter: artifact.adapterId, environment: environment.status, compiled: artifact.toolchain.status, installed, sourceOnly: !installed, runtimeConfirmed: false, artifactId: artifact.id };
   results.push(result); console.log(JSON.stringify(result));
  }
  const report = { passed: true, fixtureGamesOnly: true, realMuLogin: real, realModel: real, csharpCompiler: csharp.version, windowsGameTested: false, results };
  await fs.writeFile(path.join(root, 'verification.json'), JSON.stringify(report, null, 2));
  if (!process.argv.includes('--keep')) await close();
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
