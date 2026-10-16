// Fixture game and account; the component bytes are the actual official release.
const fs = require('node:fs/promises');
const path = require('node:path');
const { executable } = require('./bg3-extender-fixture.cjs');
const { accountFixture } = require('./account-fixture.cjs');
const { loginFixture } = require('./server-fixture.cjs');
const appRoot = path.resolve(process.env.MODDOCK_EXTENDER_APP_ROOT || path.join(__dirname, '..'));
const { createServer } = require(path.join(appRoot, 'server.cjs'));
(async () => {
 const root = path.resolve(process.env.MODDOCK_EXTENDER_ROOT || 'output/bg3-extender/preview'), installPath = path.join(root, 'BG3'), data = path.join(root, 'userdata');
 await fs.mkdir(path.join(installPath, 'bin'), { recursive: true }); await fs.writeFile(path.join(installPath, 'bin/bg3_dx11.exe'), executable);
 await fs.mkdir(path.join(data, 'PlayerProfiles/Public/Savegames'), { recursive: true }); await fs.mkdir(path.join(data, 'Mods'), { recursive: true });
 const settings = path.join(data, 'PlayerProfiles/Public/modsettings.lsx');
 const baseline = '<save><region id="ModuleSettings"><node id="root"><children><node id="Mods"><children><node id="ModuleShortDesc"><attribute id="UUID" type="FixedString" value="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"/><attribute id="Folder" type="LSString" value="GustavDev"/></node></children></node></children></node></region></save>';
 try { await fs.writeFile(settings, baseline, { flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
 await fs.writeFile(path.join(data, 'PlayerProfiles/Public/Savegames/player.lsv'), 'test player save');
 const game = { id: 'steam-1086940', appId: '1086940', name: '博德之门 3 [TEST]', platform: 'Steam', real: true, installPath };
 const account = accountFixture(); account.updateAccount({ membership: { tier: 'pro', expiresAt: null } });
 const server = await createServer({ root: path.join(root, 'app'), port: Number(process.env.MODDOCK_EXTENDER_PORT || 18109), accounts: account.options, nexusPlatformDisabled: true,
  scan: async () => ({ games: [game], roots: [], diagnostics: [] }), installers: { bg3DataPath: data, processes: async () => [], openGame: async () => {} },
  bg3Extender: { platform: 'win32', arch: 'x64', ...(process.argv.includes('--live-download') ? {} : { fetch: async () => new Response(await fs.readFile(path.resolve('output/bg3-extender/BG3SE-Updater-20261012.zip'))) }) },
  studio: { integration: { python: false }, tools: { luac: false },
   plan: async () => ({ title: '测试跟随者', summary: '使用固定测试配方检查组件与安装流程，不是真实模型生成。', kind: 'bg3-follower', questions: [], steps: ['检查游戏环境', '构建跟随者 PAK'], requirements: [] }),
   generate: async () => ({ kind: 'bg3-follower', name: '自动环境测试跟随者', author: 'Test', description: '测试配方；不代表游戏效果。', followerName: '测试同行者', greeting: '安装流程验证。' }) } });
 console.log(JSON.stringify({ url: server.url, root, fixtureGameOnly: true, realModelUsed: false, officialDownload: process.argv.includes('--live-download') }));
 const close = async () => { server.studio.cancelOwner('fixture-user'); await server.studio.conversations.settle(); server.server.closeAllConnections(); await new Promise(resolve => server.server.close(resolve)); await server.downloads.persist; process.exit(); };
 process.on('SIGINT', close); process.on('SIGTERM', close);
 if (process.argv.includes('--verify')) {
  const assert = require('node:assert/strict'), auth = await loginFixture(server);
  const post = async (route, body = {}) => { const res = await auth.fetch(server.url + '/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': auth.state.token }, body: JSON.stringify({ gameId: game.id, ...body }) }); const value = await res.json(); assert.equal(res.status, route.endsWith('/send') ? 202 : 200, JSON.stringify(value)); return value; };
  const thread = await post('studio/conversations/send', { message: '制作一个人物跟随者，其他你决定。' });
  await server.studio.conversations.settle();
  const completed = await post('studio/conversations/read', { id: thread.id }); assert.equal(completed.status, 'completed', completed.error);
  const kept = await post('studio/library', { id: completed.artifactId });
  const installed = await post('installations/auto', { jobId: kept.jobId }); assert.equal(installed.status, 'enabled');
  const environment = await post('studio/environment'); assert.equal(environment.ready, true); assert.equal(environment.runtimeConfirmed, false);
  const { RELEASE } = require(path.join(appRoot, 'bg3-extender.cjs'));
  assert.equal(environment.sha256, RELEASE.dllSha256);
  assert.equal(await fs.readFile(path.join(data, 'PlayerProfiles/Public/Savegames/player.lsv'), 'utf8'), 'test player save');
  await post('installations/restore');
  const restored = await fs.readFile(settings, 'utf8');
  assert.equal(restored.replace('<node id="ModOrder"><children/></node>', ''), baseline);
  assert.equal((await post('studio/environment')).ready, true);
  const report = { passed: true, fixtureGameOnly: true, realModelUsed: false, officialComponentSha256: environment.sha256, automaticLibraryInstall: true, generatedPakInstalled: true, savePreserved: true, campaignAndExistingLoadOrderPreserved: true, sharedLoaderPreservedOnRestore: true, runtimeConfirmed: false, windowsDeviceTested: false };
  await fs.writeFile(path.join(root, 'verification.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  if (!process.argv.includes('--keep')) await close();
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
