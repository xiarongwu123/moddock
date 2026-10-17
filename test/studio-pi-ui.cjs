const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const application = process.env.MODDOCK_UI_PACKAGE ? path.resolve(process.env.MODDOCK_UI_PACKAGE) : path.resolve(__dirname, '..');
const { createServer } = require(path.join(application, 'server.cjs'));
const { createDeepSeek } = require('../studio-ai.cjs');
const { createStudioService } = require('../platform/studio-service.cjs');
const { accountFixture } = require('./account-fixture.cjs');
const { piFixture } = require('./pi-fixture.cjs');
const { openHome } = require('./ui-open.cjs');

(async () => {
 const cleanup = [], root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-pi-ui-'));
 const bg3 = process.argv.includes('--bg3'), ron = process.argv.includes('--ron'), rpg = process.argv.includes('--rpg');
 const ronResult = ron ? JSON.parse(await fs.readFile(path.resolve(process.env.MODDOCK_RON_ARTIFACT || 'output/mu-studio/ron-authoring-check.json'), 'utf8')) : null;
 const game = { id: ron ? 'steam-1144200' : bg3 ? 'steam-1086940' : rpg ? 'unlisted-rpg' : 'pi-unity-fixture', ...(ron ? { appId: '1144200' } : bg3 ? { appId: '1086940' } : {}), name: ron ? '严阵以待' : bg3 ? '博德之门 3' : rpg ? '林间小冒险' : '雨中冒险 2', platform: '本地测试目录', installPath: path.join(root, ron ? 'RON' : bg3 ? 'BG3' : rpg ? 'RPG' : 'Unity'), real: true };
 const userData = path.join(root, 'userdata');
 if (bg3) {
  await fs.mkdir(path.join(game.installPath, 'bin'), { recursive: true });
  await fs.writeFile(path.join(game.installPath, 'bin/DWrite.dll'), require('./bg3-extender-fixture.cjs').dll);
  await fs.mkdir(path.join(userData, 'Mods'), { recursive: true });
  await fs.mkdir(path.join(userData, 'PlayerProfiles/Public'), { recursive: true });
  await fs.writeFile(path.join(userData, 'PlayerProfiles/Public/modsettings.lsx'), '<save><region id="ModuleSettings"><node id="root"><children><node id="Mods"><children><node id="ModuleShortDesc"><attribute id="UUID" type="FixedString" value="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"/><attribute id="Folder" type="LSString" value="GustavDev"/></node></children></node></children></node></region></save>');
 } else if (ron) {
  for (const [name, bytes] of [['ReadyOrNot/Binaries/Win64/ReadyOrNotSteam-Win64-Shipping.exe', require('./bg3-extender-fixture.cjs').executable], ['ReadyOrNot/Content/Paks/fixture.pak', Buffer.from('isolated fixture')]]) { const file = path.join(game.installPath, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes); }
 } else if (rpg) {
  for (const [name, text] of [['js/rmmz_core.js', 'Utils.RPGMAKER_NAME="MZ";'], ['js/rmmz_objects.js', 'Game_Actor.prototype.paramBase=function(id){return 10;};'], ['js/plugins.js', 'var $plugins = [];']]) { const file = path.join(game.installPath, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); }
 } else for (const name of ['UnityPlayer.dll', 'Example_Data/Managed/Assembly-CSharp.dll', 'BepInEx/core/BepInEx.dll']) { const file = path.join(game.installPath, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, 'isolated fixture'); }
 const engineDraft = { kind: 'engine-mod', name: '进攻节奏', author: 'UI fixture', description: '队伍成员的基础攻击力提升一倍，其他属性保持原有计算。' };
 const enginePlan = { title: engineDraft.name, summary: engineDraft.description, kind: engineDraft.kind, steps: ['调查本机玩法代码', '编写攻击属性插件', '校验并打包'], requirements: [] };
 const engineCode = '(function(){var original=Game_Actor.prototype.paramBase;Game_Actor.prototype.paramBase=function(id){var value=original.call(this,id);return id===2?value*2:value;};})();';
 const draft = { kind: 'bg3-follower', name: '青岚 · 剑湾同行者', author: 'UI fixture', description: '一位来自远方的同行者，陪你探索剑湾。青岚会在主角身旁出现，随队行动，并随存档保留。角色沿用当前游戏已有的外观资源，首次相遇时会向你道一声问候。', followerName: '青岚', greeting: '山海路远，愿与君同行。' };
 const plan = { title: draft.name, summary: '制作一位能陪你探索剑湾的中国风跟随者，沿用游戏已有的角色资源。', kind: draft.kind, steps: ['核对游戏环境', '制作跟随者', '验证制作文件'], requirements: [] };
 const model = await piFixture({ after: fn => cleanup.push(fn) }, { game, engine: ron ? 'unreal' : bg3 ? 'native' : rpg ? 'rpgmaker-mz' : 'unity-mono', delay: process.argv.includes('--preview') && !process.argv.includes('--fast-preview') ? 4500 : 650,
  ...(rpg ? { respond: ({ phase, body }) => process.argv.includes('--model-error') && JSON.stringify(body.messages).includes('触发诊断验证') ? { status: 402 } : phase === 'author' ? { calls: [
   { name: 'list_game_files', arguments: {} }, { name: 'read_game_file', arguments: { path: 'js/rmmz_objects.js' } },
   { name: 'write_project_file', arguments: { path: 'mod.json', text: '{"mode":"rpgmaker-plugin"}' } },
   { name: 'write_project_file', arguments: { path: 'main.js', text: engineCode } }, { name: 'validate_project', arguments: {} },
  ] } : null } : {}), result: body => rpg ? (body.messages[0].content.includes('This is the artifact generation stage') ? engineDraft : enginePlan) : ron ? (body.messages[0].content.includes('This is the artifact generation stage') ? ronResult.draft : ronResult.plan) : bg3 ? (body.messages[0].content.includes('This is the artifact generation stage') ? draft : plan) : body.messages[0].content.includes('This is the artifact generation stage')
  ? { kind: 'project-plan', name: '探索机制方案', author: 'Pi fixture', description: '依据当前游戏能力生成开发方案。', plan: '核对游戏 API 后再实现探索机制；当前是开发方案，尚未生成可安装 Mod。' }
  : { title: '探索机制方案', summary: '先核对游戏 API，再设计探索机制。当前生成开发方案。', kind: 'project-plan', steps: ['核对引擎与接口', '设计探索机制'], requirements: [] } });
 const token = 'a'.repeat(64), backend = await createStudioService({ accessToken: token, ai: createDeepSeek({ apiKey: model.key, pi: model.pi }) });
 const account = accountFixture(); account.updateAccount({ membership: { tier: 'pro', expiresAt: null } });
 let generation = 0, offlineUntil = 0;
 const creationRequest = async (url, init) => {
  const route = new URL(url).pathname;
  if (Date.now() < offlineUntil) throw new Error('net::ERR_CONNECTION_RESET');
  const response = await fetch(backend.url + route.slice('/api/v1/studio'.length), { ...init, headers: { Authorization: 'Bearer ' + token, 'X-Mu-Account-Id': 'fixture-user', Accept: init.headers.Accept } });
  if (!route.endsWith('/generate') || ++generation !== 2 || !process.argv.includes('--network-error')) return response;
  const reader = response.body.getReader(); let sent = false;
  return new Response(new ReadableStream({ async pull(controller) {
   if (sent) { offlineUntil = Date.now() + 5000; await reader.cancel(); controller.error(new Error('net::ERR_QUIC_PROTOCOL_ERROR')); }
   else { sent = true; const chunk = await reader.read(); if (chunk.done) controller.close(); else controller.enqueue(chunk.value); }
  }, cancel: () => reader.cancel() }, { highWaterMark: 0 }), { headers: response.headers });
 };
 const local = await createServer({ root: path.join(root, 'data'), port: 0, nexusPlatformDisabled: true, scan: async () => ({ games: [game], roots: [], diagnostics: [] }),
  installers: { bg3DataPath: userData, processes: async () => [] },
  ...(ron ? { gameEnvironment: { platform: 'win32', fetch: async () => new Response(await fs.readFile(path.resolve('output/game-environments', require('../game-components.cjs').components.ue4ss.name))) } } : {}),
  accounts: { ...account.options, fetch: (url, init) => new URL(url).pathname.startsWith('/api/v1/studio/')
   ? creationRequest(url, init)
   : account.options.fetch(url, init) } });
 let browser;
 try {
  if (process.argv.includes('--preview')) {
   console.log(JSON.stringify({ url: local.url, gameFixture: true, modelProtocolFixture: true, taskDirectory: backend.taskDirectory }));
   await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
   return;
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openHome(page, local.url);
  await page.locator('[data-nav="studio"]').first().click(); await page.locator('[data-studio-pick]').first().click();
  await page.locator('[data-studio-action="start"]').click();
  assert.match(await page.locator('.studio-welcome').textContent(), /Godot.*RPG Maker.*Ren'Py.*GameMaker/);
  await page.locator('#studio-idea').fill(rpg ? '让队伍的基础攻击力翻倍，其他属性保持原样。' : ron ? '制作只影响单人离线敌人的倒地复起 Mod：倒地后 3.5 秒复起，每个敌人一次。我要实际可安装的 Mod。' : bg3 ? '想要一位中国风的同行者，陪我一起探索剑湾。名字和问候语由你决定。' : '先给我一份开发方案，设计一个探索机制'); await page.locator('#studio-idea').press('Enter');
  const panel = page.getByRole('region', { name: '创作进度' });
  await panel.waitFor({ timeout: 20000 }); await page.waitForFunction(() => document.querySelector('.studio-process .thought-line[data-working]'));
  assert.equal(await panel.locator(':scope > details').getAttribute('open'), null, 'Process details are collapsed by default');
  await panel.locator(':scope > details > summary').click();
  await page.locator('[data-help-key^="studio:thinking:"] > summary').click(); await page.getByText('核对当前游戏的真实工具与技能。', { exact: true }).first().waitFor();
  const output = path.resolve('output/playwright/studio-refined' + (rpg ? '-rpg' : ron ? '-ron' : bg3 ? '-bg3' : '') + (process.env.MODDOCK_UI_PACKAGE ? '-packaged' : '')); await fs.mkdir(output, { recursive: true });
  await panel.screenshot({ path: path.join(output, 'thinking.png') });
  await page.waitForFunction(() => document.querySelector('.studio-process[data-status=completed]'), null, { timeout: 30000 });
  assert.ok(await panel.getByText('整理创作结果', { exact: true }).count());
  assert.ok(await panel.getByText('查阅制作资料', { exact: true }).count());
  assert.doesNotMatch(await panel.textContent(), /Pi Agent|pi-agent|\bSkill\b|\bAgent\b|read_reference|submit_result/);
  assert.ok(model.requests.some(request => JSON.stringify(request.body).includes(rpg ? 'skills/engine-development/references/rpgmaker.md' : ron ? 'skills/ready-or-not/SKILL.md' : bg3 ? 'baldurs-gate3.md' : 'skills/bepinex-mono/SKILL.md')), 'Game Skills remain selected internally');
  await panel.locator(':scope > details > summary').click();
  await page.getByRole('region', { name: '生成结果' }).scrollIntoViewIfNeeded();
  if (bg3 || ron || rpg) {
   assert.ok(await page.getByRole('button', { name: '进游戏试试', exact: true }).isEnabled());
   await page.getByRole('button', { name: '存入 Mod 库', exact: true }).click();
   await page.getByRole('button', { name: '已存入 Mod 库', exact: true }).waitFor();
  }
  await panel.screenshot({ path: path.join(output, 'completed.png') });
  await page.screenshot({ path: path.join(output, 'desktop.png') });
  if (rpg) {
   await panel.locator(':scope > details > summary').click();
   await panel.getByText('读取玩法代码', { exact: true }).waitFor();
   await panel.screenshot({ path: path.join(output, 'engine-tools.png') });
   await panel.locator(':scope > details > summary').click();
   await page.locator('#studio-idea').fill('安装'); await page.locator('#studio-idea').press('Enter');
   await page.waitForFunction(() => document.querySelector('.studio-process[data-status=completed]') && document.querySelector('.studio-message:last-of-type')?.textContent.includes('安装'), null, { timeout: 30000 });
   const installed = local.installers.state.mods.find(mod => mod.gameId === game.id && mod.status === 'enabled'); assert.ok(installed);
   const registry = require('../studio-engines.cjs').parseRegistry(await fs.readFile(path.join(game.installPath, 'js/plugins.js'), 'utf8'));
   assert.equal(registry.length, 1); assert.equal(registry[0].status, true);
   assert.equal(await fs.readFile(path.join(game.installPath, 'js/plugins', registry[0].name + '.js'), 'utf8'), engineCode + '\n');
   await page.screenshot({ path: path.join(output, 'installed.png') });
   await page.locator('#studio-idea').fill('继续保留基础攻击翻倍，重新制作这一版'); await page.locator('#studio-idea').press('Enter');
   await page.waitForFunction(() => document.querySelector('.studio-process[data-status=completed]') && document.querySelectorAll('.studio-message.is-user').length >= 3, null, { timeout: 30000 });
   await page.locator('#studio-idea').fill('安装'); await page.locator('#studio-idea').press('Enter');
   await page.waitForFunction(() => document.querySelector('.studio-process[data-status=completed]') && document.querySelectorAll('.studio-message.is-user').length >= 4, null, { timeout: 30000 });
   const revised = require('../studio-engines.cjs').parseRegistry(await fs.readFile(path.join(game.installPath, 'js/plugins.js'), 'utf8'));
   assert.equal(revised.length, 1, 'Revision replacement must remove the previous registry entry');
   assert.notEqual(revised[0].name, registry[0].name); assert.equal(local.installers.state.mods.length, 1);
   await assert.rejects(fs.access(path.join(game.installPath, 'js/plugins', registry[0].name + '.js')), /ENOENT/);
  }
  if (ron) {
   const records = await local.studio.list('fixture-user', game.id), saved = await local.studio.read('fixture-user', records[0].id);
   assert.equal(saved.adapterId, 'ue4ss-lua'); assert.equal(saved.installable, true); assert.ok(saved.toolchain.bundle);
   assert.equal(saved.files.some(file => file.name === 'MODDING_PLAN.md'), false);
   await page.locator('[data-help-key^="studio:artifact:"] > summary').click(); await page.getByRole('button', { name: '查看文件与预览', exact: true }).click();
   await page.locator('[data-studio-preview-tab="files"]').click();
   await page.getByRole('button', { name: /main.lua/ }).click();
   assert.match(await page.locator('.studio-product-modal').textContent(), /PlayDead/);
   await page.locator('.studio-product-modal').screenshot({ path: path.join(output, 'actual-source.png') });
   await page.locator('.studio-product-modal [data-close]').last().click();
   await page.locator('#studio-idea').fill('安装'); await page.locator('#studio-idea').press('Enter');
   await page.waitForFunction(() => document.querySelector('.studio-process[data-status=completed]') && document.querySelector('.studio-message:last-of-type')?.textContent.includes('安装'), null, { timeout: 30000 });
   const installed = local.installers.state.mods.find(mod => mod.gameId === game.id && mod.status === 'enabled'); assert.ok(installed);
   const source = path.join(game.installPath, installed.profile.destination, 'Scripts/main.lua');
   assert.ok((await fs.readFile(source, 'utf8')).includes(ronResult.draft.code.trim()));
   await page.screenshot({ path: path.join(output, 'installed.png') });
  }
  await page.setViewportSize({ width: 600, height: 900 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Creation view must fit a narrow window');
  assert.equal(await page.locator('.app-header').count(), 1);
  await page.screenshot({ path: path.join(output, 'narrow.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#studio-idea').fill('继续调整探索奖励'); await page.locator('#studio-idea').press('Enter');
  await page.waitForFunction(() => document.querySelector('.studio-process .thought-line[data-working]'));
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.studio-process[data-status=cancelled]'), null, { timeout: 15000 });
  assert.equal(await panel.locator('.studio-process-step.is-running').count(), 0);
  assert.deepEqual(errors, []); console.log(JSON.stringify({ passed: true, gameFixture: true, application, harness: 'real Pi SDK with isolated model protocol fixture', checks: ['internal game Skill selection', 'no infrastructure branding', 'collapsed process', 'live thinking', 'tool completion', ...(bg3 || ron || rpg ? ['installable result actions', 'save to library'] : []), ...(ron ? ['actual PlayDead Lua source preview', 'official UE4SS auto preparation', 'transactional script installation'] : []), ...(rpg ? ['six engine coverage', 'actual local source tools', 'transactional plugin registry merge'] : []), 'narrow window', 'cancel'], screenshots: output }));
 } finally {
  await browser?.close(); local.studio.cancelOwner('fixture-user'); await local.studio.conversations.settle(); local.server.closeAllConnections(); await new Promise(resolve => local.server.close(resolve)); await local.downloads.persist;
  await backend.close(); for (const fn of cleanup.reverse()) await fn(); await fs.rm(root, { recursive: true, force: true });
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
