const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { writePak, readPak } = require('../larian-pak.cjs');
const { buildBG3, readModule, editLoadOrder, isEnabled, parseXML } = require('../bg3-mod.cjs');
const { createServer, loginFixture } = require('./server-fixture.cjs');
const { accountFixture } = require('./account-fixture.cjs');
const { diagnoseGame } = require('../game-diagnostics.cjs');
const { runTool } = require('../studio-tools.cjs');
const { dll, executable, release } = require('./bg3-extender-fixture.cjs');

const BASE = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const SETTINGS = `<?xml version="1.0"?><save><version major="4" minor="0" revision="9" build="331"/><region id="ModuleSettings"><node id="root"><children><node id="Mods"><children><node id="ModuleShortDesc"><attribute id="UUID" type="FixedString" value="${BASE}"/><attribute id="Folder" type="LSString" value="GustavDev"/><attribute id="Name" type="LSString" value="GustavDev"/></node><node id="ModuleShortDesc"><attribute id="UUID" type="FixedString" value="${OTHER}"/><attribute id="Folder" type="LSString" value="OtherMod"/><attribute id="Name" type="LSString" value="Other &amp; Mod"/><attribute id="Version64" type="int64" value="36028797018963968"/><attribute id="CustomField" type="LSString" value="preserve-me"/></node></children></node><node id="ModOrder"><children><node id="Module"><attribute id="UUID" type="FixedString" value="${OTHER}"/></node></children></node></children></node></region><region id="Unrelated"><node id="root"><attribute id="keep" value="yes" type="LSString"/></node></region></save>`;
const code = `Ext.Events.SessionLoaded:Subscribe(function()
 PersistentVars = PersistentVars or {}
 if PersistentVars.Companion and Osi.Exists(PersistentVars.Companion) == 1 then return end
 local host = Osi.GetHostCharacter()
 local template = Osi.GetTemplate(host)
 local companion = Osi.CreateAtObject(template, host, 0, 0, "", 1)
 if not companion then error("Companion creation failed") end
 Osi.SetStoryDisplayName(companion, "青岚")
 Osi.AddPartyFollower(companion, host)
 PersistentVars.Companion = companion
end)`;
const draft = { kind: 'bg3-lua', name: '青岚跟随者', author: 'Player', description: '复用当前角色资源的跟随者，不包含新模型或完整同伴剧情。', code };
const followerDraft = { kind: 'bg3-follower', name: '青岚跟随者', author: 'Player', description: '复用当前角色资源，不包含新模型或剧情。', followerName: '青岚', greeting: '此后山高水长，我与你同行。' };
const plan = { title: 'Chinese follower', summary: 'Create a named follower using existing game resources.', kind: 'bg3-lua', steps: ['Generate a real server Lua script.', 'Compile and package LSPK v18.'], requirements: ['Windows BG3 Script Extender.'] };
const textFile = (name, text) => ({ name, data: Buffer.from(text) });
function packageFor(id = crypto.randomUUID()) { const built = buildBG3(draft, id, textFile); return writePak(built.files.map(file => ({ ...file, name: file.name.slice(8) }))); }
async function fixture(t, overrides = {}) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-bg3-'));
 const game = { id: 'steam-1086940', appId: '1086940', name: '博德之门 3 [TEST]', platform: 'Steam', real: true, installPath: path.join(root, 'game') };
 const data = path.join(root, 'userdata'), settings = path.join(data, 'PlayerProfiles/Public/modsettings.lsx'), save = path.join(data, 'PlayerProfiles/Public/Savegames/Story/player.lsv');
 await fs.mkdir(path.join(game.installPath, 'bin'), { recursive: true }); await fs.writeFile(path.join(game.installPath, 'bin/DWrite.dll'), dll);
 await fs.writeFile(path.join(game.installPath, 'bin/bg3_dx11.exe'), executable);
 await fs.mkdir(path.dirname(save), { recursive: true }); await fs.mkdir(path.join(data, 'Mods')); await fs.writeFile(settings, SETTINGS); await fs.writeFile(save, 'preserve real player progress');
 const account = accountFixture(); account.updateAccount({ membership: { tier: 'pro', expiresAt: null } });
 const service = await createServer({ root: path.join(root, 'app'), port: 0, accounts: account.options, bg3Extender: { release, fetch: async () => { throw new Error('Script Extender fixture distribution unavailable'); } }, scan: async () => ({ games: [game], roots: [], diagnostics: [] }), studio: { runtimeObservationMs: 1, runtimeAutoObservationMs: 1, runtimePollMs: 1, integration: { python: false }, plan: async payload => ({ ...plan, kind: payload.capability.preferredKind }), generate: async payload => payload.kind === 'bg3-follower' ? followerDraft : draft, ...overrides.studio }, installers: { bg3DataPath: data, processes: async () => [], ...overrides.installers } });
 t.after(async () => { service.studio.cancelOwner('fixture-user'); await service.studio.conversations.settle(); await new Promise(resolve => service.server.close(resolve)); await service.downloads.persist; await fs.rm(root, { recursive: true, force: true }); });
 const login = await loginFixture(service);
 const post = async (route, body = {}) => { const response = await login.fetch(service.url + '/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': login.state.token }, body: JSON.stringify({ gameId: game.id, ...body }) }); return { status: response.status, body: await response.json() }; };
 const turn = async (message, id) => { const accepted = await post('studio/conversations/send', { message, ...(id ? { id } : {}) }); assert.equal(accepted.status, 202, JSON.stringify(accepted.body)); await service.studio.conversations.settle(); return (await post('studio/conversations/read', { id: accepted.body.id })).body; };
 return { root, game, data, settings, save, service, post, turn };
}
test('LSPK v18 contains actual files, rejects tampering and refuses unsafe or excessive input', () => {
 const bytes = packageFor(), parsed = readPak(bytes), module = readModule(bytes);
 assert.equal(bytes.subarray(0, 4).toString(), 'LSPK'); assert.equal(parsed.version, 18); assert.equal(parsed.files.length, 3);
 assert.ok(module.files.some(file => file.name.endsWith('/BootstrapServer.lua') && file.data.toString().includes('CreateAtObject')));
 assert.ok(module.files.some(file => file.name.endsWith('/Config.json') && JSON.parse(file.data).FeatureFlags[0] === 'Lua'));
 const changed = Buffer.from(bytes); changed[45] ^= 1; assert.throws(() => readPak(changed), /摘要/);
 const offset = Buffer.from(bytes); offset.writeBigUInt64LE(999999999999n, 8); assert.throws(() => readPak(offset), /索引位置/);
 for (const name of ['../escape', 'Mods/../../escape', '/absolute', 'a\\b', 'a//b']) assert.throws(() => writePak([{ name, data: Buffer.from('x') }]), /路径/);
 assert.throws(() => writePak([{ name: 'a', data: Buffer.alloc(5 * 1024 * 1024) }]), /大小/);
 assert.throws(() => writePak([{ name: 'A', data: Buffer.alloc(1) }, { name: 'a', data: Buffer.alloc(1) }]), /重复/);
});
test('host follower logic is idempotent across sessions and resumes partial initialization without false success', async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bg3-follower-contract-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
 const built = buildBG3({ ...followerDraft, followerName: '青岚"; error("injected") --' }, crypto.randomUUID(), textFile);
 const file = path.join(root, 'Follower.lua'); await fs.writeFile(file, built.content.code);
 const { LuaFactory } = require('wasmoon');
 const factory = new LuaFactory(); await factory.mountFile('/Follower.lua', built.content.code);
 const engine = await factory.createEngine(); let output = '';
 try {
  engine.global.set('print', text => { output += text; });
  await engine.doString('arg = {"/Follower.lua"}');
  await engine.doString(await fs.readFile(path.join(__dirname, 'bg3-follower-sandbox.lua'), 'utf8'));
  assert.match(output, /follower contract passed/);
 } finally { engine.global.close(); }
});
test('BG3 load order edits preserve campaign, other mods and unknown XML fields', () => {
 const module = readModule(packageFor()).module;
 const installed = editLoadOrder(SETTINGS, [{ module, enabled: true, install: true }]);
 assert.equal(isEnabled(installed, module), true);
 for (const value of [BASE, OTHER, 'Other &amp; Mod', 'preserve-me', 'Unrelated']) assert.ok(installed.includes(value));
 const removed = editLoadOrder(installed, [{ module, enabled: false }]); assert.equal(isEnabled(removed, module), false);
 assert.ok(removed.includes(OTHER)); assert.ok(removed.includes(BASE)); assert.ok(removed.includes('preserve-me'));
 assert.throws(() => editLoadOrder(installed, [{ module, enabled: true, install: true }]), /已存在/);
 assert.throws(() => editLoadOrder(installed.replace(module.Name, 'External name'), [{ module, enabled: false }]), /外部修改/);
 assert.throws(() => editLoadOrder(SETTINGS.replace('GustavDev', 'BrokenCampaign'), [{ module, enabled: true }]), /主战役/);
 assert.throws(() => parseXML('<!DOCTYPE save [<!ENTITY a "x">]><save/>'), /声明/);
 assert.throws(() => parseXML('<save><node></save>'));
 const noOrder = SETTINGS.replace(/<node id="ModOrder">.*?<\/node><\/children><\/node>/, '');
 const inserted = editLoadOrder(noOrder, [{ module, enabled: true }]); assert.ok(inserted.includes(OTHER)); assert.equal(isEnabled(inserted, module), true);
});
test('BG3 conversation builds a real PAK, installs it to user Mods, manages state and preserves saves', async t => {
 const x = await fixture(t), thread = await x.turn('制作一个中国风人物跟随者，你自己决定细节。');
 assert.equal(thread.status, 'completed', thread.error); assert.equal(thread.plan.kind, 'bg3-follower'); assert.equal(thread.capability.mode, 'supported');
 const saved = (await x.post('studio/read', { id: thread.artifactId })).body;
 assert.equal(saved.installable, true); assert.equal(saved.toolchain.status, 'passed'); assert.ok(saved.toolchain.bundle); assert.equal(saved.toolchain.outputs.length, 1);
 const exported = await x.post('studio/export', { id: saved.id }); assert.equal(exported.status, 200); assert.match(exported.body.filename, /-bg3.zip$/); assert.ok(Buffer.from(exported.body.base64, 'base64').includes(Buffer.from('LSPK')));
 const unconfirmed = await x.post('studio/library', { id: saved.id }); assert.equal(unconfirmed.status, 400);
 const feedback = await x.post('studio/conversations/feedback', { id: thread.id, artifactId: saved.id, buildId: saved.toolchain.id, status: 'accepted' }); assert.equal(feedback.status, 200, JSON.stringify(feedback.body));
 const kept = await x.post('studio/library', { id: saved.id }); assert.equal(kept.status, 200, JSON.stringify(kept.body));
 const fromLibrary = await x.post('installations/auto', { jobId: kept.body.jobId }); assert.equal(fromLibrary.status, 200, JSON.stringify(fromLibrary.body));
 const installed = await x.turn('安装', thread.id); assert.equal(installed.status, 'completed', installed.error);
 const mod = x.service.installers.state.mods[0]; assert.equal(mod.profile.mode, 'bg3'); assert.equal(mod.root, await fs.realpath(x.data));
 const pakFile = path.join(x.data, mod.files[0].destination); const pak = readModule(await fs.readFile(pakFile));
 assert.equal(isEnabled(await fs.readFile(x.settings, 'utf8'), pak.module), true); await assert.rejects(fs.access(path.join(x.game.installPath, 'Mods')));
 const second = await x.turn('制作第二个不同的跟随者。'); await x.turn('安装', second.id);
 const mod2 = x.service.installers.state.mods.find(item => item.id !== mod.id), module2 = mod2.profile.bg3Module;
 assert.equal((await x.post('installations/action', { id: mod.id, action: 'disable' })).status, 200); await assert.rejects(fs.access(pakFile));
 let settings = await fs.readFile(x.settings, 'utf8'); assert.equal(isEnabled(settings, pak.module), false); assert.equal(isEnabled(settings, module2), true); assert.ok(settings.includes(OTHER));
 assert.equal((await x.post('installations/action', { id: mod.id, action: 'enable' })).status, 200); await fs.access(pakFile);
 assert.equal((await x.post('installations/action', { id: mod.id, action: 'verify' })).body.verification.status, 'files_ok');
 await x.service.installers.applyModStates(x.game, x.service.installers.state.mods, new Map([[mod.id, 'disabled'], [mod2.id, 'enabled']]));
 settings = await fs.readFile(x.settings, 'utf8'); assert.equal(isEnabled(settings, pak.module), false); assert.equal(isEnabled(settings, module2), true);
 assert.equal((await x.post('installations/action', { id: mod.id, action: 'uninstall' })).status, 200);
 assert.equal((await x.service.installers.restoreNative(x.game)).removed, 1);
 settings = await fs.readFile(x.settings, 'utf8'); assert.equal(isEnabled(settings, module2), false); assert.ok(settings.includes(OTHER)); assert.ok(settings.includes(BASE));
 assert.equal(await fs.readFile(x.save, 'utf8'), 'preserve real player progress'); assert.deepEqual(await fs.readdir(path.join(x.data, 'Mods')), []);
});
test('BG3 package and load order changes roll back together after a write failure', async t => {
 const x = await fixture(t, { installers: { afterWrite: async (_i, change) => { if (change.rel.endsWith('modsettings.lsx')) throw new Error('fixture disk fault'); } } });
 const thread = await x.turn('制作一个跟随者。'), result = await x.turn('安装', thread.id);
 assert.equal(result.status, 'failed'); assert.match(result.error, /回滚/);
 assert.equal(await fs.readFile(x.settings, 'utf8'), SETTINGS); assert.deepEqual(await fs.readdir(path.join(x.data, 'Mods')), []); assert.equal(x.service.installers.state.mods.length, 0);
});
test('BG3 build stays real while missing prerequisites, running game and external edits block installation changes', async t => {
 const x = await fixture(t), thread = await x.turn('制作人物。');
 await fs.rm(path.join(x.game.installPath, 'bin/DWrite.dll'));
 const missing = await x.turn('安装', thread.id); assert.equal(missing.status, 'failed'); assert.match(missing.error, /Script Extender/); assert.equal(await fs.readFile(x.settings, 'utf8'), SETTINGS);
 await fs.writeFile(path.join(x.game.installPath, 'bin/DWrite.dll'), dll);
 x.service.installers.options.processes = async () => [{ pid: 99999, name: 'bg3_dx11.exe', path: path.join(x.game.installPath, 'bin/bg3_dx11.exe') }];
 const running = await x.turn('安装', thread.id); assert.match(running.error, /退出游戏/);
 x.service.installers.options.processes = async () => [];
 await x.turn('安装', thread.id); const mod = x.service.installers.state.mods[0];
 await fs.writeFile(x.settings, (await fs.readFile(x.settings, 'utf8')).replace(mod.profile.bg3Module.Name, 'External name'));
 const external = await x.post('installations/action', { id: mod.id, action: 'disable' }); assert.equal(external.status, 400); assert.match(external.body.error, /外部修改/); await fs.access(path.join(x.data, mod.files[0].destination));
});
test('BG3 runtime reads only the current artifact log in user data, never stale or game-folder evidence', async t => {
 let active, x;
 x = await fixture(t, { installers: { openGame: async () => { const file = path.join(x.data, active.runtime.log); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, active.runtime.marker); } } });
 const thread = await x.turn('制作跟随者。'); active = (await x.post('studio/read', { id: thread.artifactId })).body;
 const launched = await x.turn('安装并启动游戏', thread.id); assert.equal(launched.status, 'awaiting_runtime', launched.error);
 const report = (await x.post('studio/read', { id: active.id })).body.toolchain;
 assert.equal(report.runtime.status, 'loader_loaded'); assert.ok(report.runtime.runId);
 assert.equal((await diagnoseGame(x.game)).engine.key, 'larian-bg3');
});
test('BG3 missing Lua compiler and invalid Lua cannot produce an installable PAK', async t => {
 for (const studio of [{ tools: { luac: false } }, { generate: async () => ({ ...draft, code: 'local broken = function(' }) }]) {
  const x = await fixture(t, { studio }), thread = await x.turn('做一个金币 Mod。');
  const artifact = (await x.post('studio/read', { id: thread.artifactId })).body;
  assert.equal(artifact.installable, false); assert.equal(artifact.toolchain.bundle, undefined);
  assert.ok(['blocked', 'failed'].includes(artifact.toolchain.status)); assert.equal((await x.post('studio/prepare', { id: artifact.id })).status, 400);
 }
});
test('BG3 requests for an installable Mod replan document-only responses even when the prompt says no development plan', async t => {
 let calls = 0;
 const x = await fixture(t, { studio: { plan: async () => ++calls === 1 ? { ...plan, kind: 'project-plan' } : plan } });
 const thread = await x.turn('生成可安装的 Mod，不要开发方案。');
 assert.equal(thread.status, 'blocked', thread.error); assert.equal(thread.toolchain.status, 'blocked'); assert.equal(calls, 2); assert.equal(thread.plan.kind, 'bg3-lua'); assert.equal(thread.planningAttempts[0].accepted, false);
});
test('bounded follower recipes remain packable on a host without native Lua tools', async t => {
 const x = await fixture(t, { studio: { tools: { luac: false } } }), thread = await x.turn('制作一个跟随者。');
 const saved = (await x.post('studio/read', { id: thread.artifactId })).body;
 assert.equal(saved.installable, true); assert.equal(saved.toolchain.status, 'passed'); assert.ok(saved.toolchain.bundle);
 assert.ok(saved.toolchain.checks.some(check => check.name === '受约束人物配方' && check.status === 'passed'));
 assert.ok(!saved.toolchain.checks.some(check => check.name.startsWith('Lua 语法')));
});
