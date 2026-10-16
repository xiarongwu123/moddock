// Real MU/private-model test with a local fixture game. Never a real-game assertion.
const fs = require('node:fs/promises');
const path = require('node:path');
const appRoot = path.resolve(process.env.MODDOCK_AGENT_APP_ROOT || path.join(__dirname, '..'));
const { createServer } = require(path.join(appRoot, 'server.cjs'));
const { accountFixture } = require('./account-fixture.cjs');
const { loginFixture } = require('./server-fixture.cjs');
const { dll } = require('./bg3-extender-fixture.cjs');
const { createMuStudioAI } = require(path.join(appRoot, 'studio-mu-client.cjs'));
(async () => {
 const root = path.resolve(process.env.MODDOCK_AGENT_TEST_ROOT || 'output/bg3-agent/live'), installPath = path.join(root, 'BG3'), userData = path.join(root, 'userdata');
 await fs.mkdir(path.join(installPath, 'bin'), { recursive: true }); await fs.writeFile(path.join(installPath, 'bin/DWrite.dll'), dll);
 await fs.mkdir(path.join(userData, 'Mods'), { recursive: true }); await fs.mkdir(path.join(userData, 'PlayerProfiles/Public'), { recursive: true });
 const settings = path.join(userData, 'PlayerProfiles/Public/modsettings.lsx');
 try { await fs.writeFile(settings, '<save><region id="ModuleSettings"><node id="root"><children><node id="Mods"><children><node id="ModuleShortDesc"><attribute id="UUID" type="FixedString" value="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"/><attribute id="Folder" type="LSString" value="GustavDev"/></node></children></node></children></node></region></save>', { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
 const game = { id: 'steam-1086940', appId: '1086940', name: '博德之门 3 [TEST]', platform: 'Steam', real: true, installPath };
 const direct = process.argv.includes('--private-candidate'), account = accountFixture(); account.updateAccount({ membership: { tier: 'pro', expiresAt: null } });
 const managed = direct ? createMuStudioAI((_owner, route, init) => fetch('http://127.0.0.1:8096/' + route, { method: 'POST', body: init.body, signal: init.signal, headers: { Authorization: 'Bearer ' + 'a'.repeat(64), 'X-Mu-Account-Id': 'candidate-agent-test' } }).then(async response => { if (!response.ok) throw new Error('Candidate AI response ' + response.status + ': ' + await response.text()); return response; })) : undefined;
 const server = await createServer({ root: path.join(root, 'data'), port: Number(process.env.MODDOCK_AGENT_TEST_PORT || 18101), nexusPlatformDisabled: true, accounts: direct ? account.options : { baseUrl: process.env.MODDOCK_ACCOUNT_URL || 'http://127.0.0.1:18098/' }, studio: direct ? managed : undefined,
  scan: async () => ({ games: [game], roots: [], diagnostics: [] }), installers: { bg3DataPath: userData, processes: async () => [] } });
 console.log(JSON.stringify({ url: server.url, mode: direct ? 'private-candidate' : 'real-MU', fixtureGameOnly: true }));
 const close = async () => { for (const owner of server.studio.pending.keys()) server.studio.cancelOwner(owner); await server.studio.conversations.settle(); server.server.closeAllConnections(); await new Promise(resolve => server.server.close(resolve)); await server.downloads.persist; process.exit(); };
 process.on('SIGINT', close); process.on('SIGTERM', close);
 if (process.argv.includes('--run')) {
  let auth, owner;
  if (direct) { auth = await loginFixture(server); owner = 'fixture-user'; }
  else {
   const credentials = JSON.parse(await fs.readFile(process.env.MODDOCK_AGENT_TEST_CREDENTIALS, 'utf8')).credentials;
   const config = await fetch(server.url + '/api/auth/config').then(response => response.json());
   const login = await fetch(server.url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': config.token }, body: JSON.stringify(credentials) });
   const profile = await login.json(); if (!login.ok) throw new Error('Isolated MU login failed');
   owner = profile.profile.id;
   const cookie = login.headers.getSetCookie().find(value => /Path=\/api(?:;|$)/.test(value)).split(';')[0];
   auth = { state: { token: config.token }, fetch: (url, init) => fetch(url, { ...init, headers: { ...init.headers, Cookie: cookie } }) };
  }
  const response = await auth.fetch(server.url + '/api/studio/conversations/send', { method: 'POST', headers: { 'X-Moddock-Token': auth.state.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId: game.id, message: '做一个生命辅助 Mod：低于可调百分比时自动恢复生命，可开关；F8 手动恢复到最大生命。只影响当前主角。阈值默认 40，范围 10 到 90，步长 5。按现有真实 BG3 接口制作，你自行决定其他细节。' }) });
  const accepted = await response.json(); if (response.status !== 202) throw new Error(JSON.stringify(accepted));
  await server.studio.conversations.settle();
  const thread = await server.studio.conversations.read(owner, game, accepted.id);
  await fs.writeFile(path.join(root, 'live-result.json'), JSON.stringify({ mode: direct ? 'private-candidate' : 'real-MU', fixtureGameOnly: true, thread }, null, 2));
  console.log(JSON.stringify({ status: thread.status, error: thread.error, artifactId: thread.artifactId, tools: thread.toolCalls }));
  if (thread.status !== 'completed') throw new Error(thread.error || 'Real model authoring failed');
  if (!process.argv.includes('--keep')) await close();
 }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
