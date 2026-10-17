const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const { createDeepSeek } = require('../studio-ai.cjs');
const { createStudioService } = require('../platform/studio-service.cjs');
const { accountFixture } = require('./account-fixture.cjs');
const { piFixture } = require('./pi-fixture.cjs');
const { openHome } = require('./ui-open.cjs');
const application = path.resolve(process.env.MODDOCK_NATIVE_PACKAGE || '.');
async function main() {
 const output = path.resolve(process.env.MODDOCK_NATIVE_UI_OUTPUT || 'output/native-toolchains/browser'), root = path.join(output, 'data'), gamePath = path.join(output, 'game');
 await fs.rm(root, { recursive: true, force: true }); await fs.rm(gamePath, { recursive: true, force: true }); await fs.mkdir(gamePath, { recursive: true });
 await fs.copyFile(path.resolve('output/native-toolchains/engine-builds/godot-4.4.1/game.pck'), path.join(gamePath, 'game.pck'));
 const game = { id: 'unlisted-godot-browser', name: '原野探险', real: true, installPath: gamePath, platform: '本机游戏' }, source = JSON.parse(await fs.readFile(path.resolve('output/native-toolchains/pi-results/godot.json'), 'utf8'));
 const cleanup = [], fixture = await piFixture({ after: fn => cleanup.push(fn) }, { game, engine: 'godot', delay: 550, respond: ({ phase, body }) => {
  if (phase !== 'author') return null;
  const doc = { path: 'native/godot/player.gd' };
  const { files, ...manifest } = source.draft;
  return { calls: [{ name: 'list_game_files', arguments: {} }, { name: 'read_game_file', arguments: { path: doc.path } }, { name: 'write_project_file', arguments: { path: 'mod.json', text: JSON.stringify(manifest) } }, ...files.map(file => ({ name: 'write_project_file', arguments: { path: file.name, text: file.text } })), { name: 'validate_project', arguments: {} }] };
 }, result: body => body.messages[0].content.includes('This is the artifact generation stage') ? { kind: source.draft.kind, name: source.draft.name, author: source.draft.author, description: source.draft.description } : source.plan });
 const token = 'c'.repeat(64), service = await createStudioService({ accessToken: token, ai: createDeepSeek({ apiKey: fixture.key, pi: fixture.pi }) });
 const account = accountFixture(); account.updateAccount({ membership: { tier: 'pro', expiresAt: null } });
 const server = await require(path.join(application, 'server.cjs')).createServer({ root, port: 0, nexusPlatformDisabled: true, scan: async () => ({ games: [game], roots: [], diagnostics: [] }),
  studio: { ...require('../studio-mu-client.cjs').createMuStudioAI((_owner, route, init) => fetch(service.url + '/' + route, { ...init, method: 'POST', headers: { Authorization: 'Bearer ' + token, 'X-Mu-Account-Id': 'native-ui', Accept: 'application/x-ndjson', 'Content-Type': 'application/json' } })), integration: { python: false }, tools: { directory: path.resolve('.moddock-tools'), archiveDirectory: path.resolve('output/native-toolchains') } }, installers: { processes: async () => [] },
  accounts: { ...account.options, fetch: (url, init) => new URL(url).pathname.startsWith('/api/v1/studio/') ? fetch(service.url + new URL(url).pathname.slice('/api/v1/studio'.length), { ...init, headers: { Authorization: 'Bearer ' + token, 'X-Mu-Account-Id': 'native-ui', Accept: init.headers.Accept } }) : account.options.fetch(url, init) } });
 const browser = await chromium.launch({ channel: 'chrome', headless: true });
 try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = []; page.on('pageerror', error => errors.push(error.message));
  await openHome(page, server.url); await page.locator('[data-nav="studio"]').first().click(); await page.locator('[data-studio-pick]').first().click(); await page.locator('[data-studio-action="start"]').click();
  await page.locator('#studio-idea').fill(source.prompt); await page.locator('#studio-idea').press('Enter');
  const panel = page.getByRole('region', { name: '创作进度' }); await panel.waitFor(); await panel.locator(':scope > details > summary').click();
  await page.waitForFunction(() => document.querySelector('.studio-process[data-status=completed]') || document.querySelector('.studio-error[role=alert]'), null, { timeout: 120000 });
  assert.deepEqual(await page.locator('.studio-error[role=alert]').allTextContents(), []);
  await page.waitForFunction(() => !document.querySelector('.studio-process .thought-line[data-working]'), null, { timeout: 5000 });
  await page.getByRole('region', { name: '生成结果' }).waitFor();
  await panel.getByText('编译并打包游戏 Mod', { exact: true }).waitFor(); await panel.getByText('读取玩法代码', { exact: true }).waitFor();
  assert.doesNotMatch(await panel.textContent(), /pi-agent|Pi Agent|\bSkill\b|\bAgent\b/);
  await page.screenshot({ path: path.join(output, 'native-tools-completed.png') });
  await page.getByRole('button', { name: '存入 Mod 库', exact: true }).click(); await page.getByRole('button', { name: '已存入 Mod 库', exact: true }).waitFor();
  const library = await page.evaluate(async () => {
   const state = await (await fetch('/api/state')).json(), job = state.jobs.find(job => job.source === 'studio');
   const response = await fetch('/api/installations/auto', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': state.token }, body: JSON.stringify({ jobId: job.id }) });
   const result = await response.json();
   if (response.ok) await fetch('/api/installations/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': state.token }, body: JSON.stringify({ gameId: job.gameId, id: result.id, action: 'uninstall' }) });
   return { status: response.status, mode: result.profile?.mode, error: result.error };
  });
  assert.equal(library.status, 200, JSON.stringify(library)); assert.equal(library.mode, 'native');
  await page.locator('#studio-idea').fill('安装'); await page.locator('#studio-idea').press('Enter');
  await page.waitForFunction(() => document.querySelector('.studio-process[data-status=completed]') && document.querySelector('.studio-message:last-of-type')?.textContent.includes('安装'), null, { timeout: 30000 });
  const mod = server.installers.state.mods.find(mod => mod.gameId === game.id); assert.equal(mod?.profile.mode, 'native');
  await page.screenshot({ path: path.join(output, 'native-mod-installed.png') }); assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ passed: true, application, realPiSdk: true, modelProtocolFixture: true, actualNativeCompileAndInstall: true, libraryAutoInstallationPassed: true, noInfrastructureBranding: true, tools: await panel.locator('.studio-process-step strong').allTextContents() }, null, 2));
  console.log('Native Godot browser creation / real native compilation / tool states / install passed');
 } finally { await browser.close(); server.studio.cancelOwner('fixture-user'); await server.studio.conversations.settle(); server.server.closeAllConnections(); await new Promise(resolve => server.server.close(resolve)); await server.downloads.persist; await service.close(); for (const fn of cleanup.reverse()) await fn(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
