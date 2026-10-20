const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { deflateSync, crc32 } = require('node:zlib');
const { diagnoseGame } = require('../game-diagnostics.cjs');
const { buildContentPack, pngBytes, zipContent } = require('../content-pack.cjs');
const { ModStudio, studioAccess } = require('../mod-studio.cjs');
const { extract } = require('../installers.cjs');
const { createServer, loginFixture } = require('./server-fixture.cjs');
const { accountFixture } = require('./account-fixture.cjs');
const { validatedPlan } = require('../studio-conversations.cjs');

// Packaging fixtures declare a simulated engine readback; they never run game code.
const runtimeLua = code => `${code}\nModdockVerification.expect('effect','fixture game state')
ModdockVerification.begin('effect')
local actual = readEffectiveGameState()
ModdockVerification.check('effect',actual,42)`;

const draft = { kind: 'dialogue', name: '海边的问候', author: '测试作者', npc: 'Abigail', entries: { Mon: '今天也去海边散步吧。', Fri: '周末有什么打算？' } };
async function temp(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-studio-')); t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 3 })); return root; }
async function write(root, file, data) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), data); }
function texture(width = 16) {
 const chunk = (type, bytes) => { const name = Buffer.from(type), head = Buffer.alloc(4), crc = Buffer.alloc(4); head.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes]))); return Buffer.concat([head, name, bytes, crc]); };
 const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(16, 4); header[8] = 8; header[9] = 6;
 return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(16 * (width * 4 + 1)))), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
async function fixture(t, { pro = true, studio, variant = 'stardew', installers, chooseStudioGame } = {}) {
 const root = await temp(t), installPath = path.join(root, 'game'); await fs.mkdir(installPath);
 const game = { id: variant === 'stardew' ? 'steam-413150' : 'fixture-' + variant, appId: variant === 'stardew' ? '413150' : '', name: ({ stardew: 'Stardew Valley', unreal: 'Hogwarts Legacy', unity: 'Unity Fixture', re: 'Resident Evil 4', unknown: 'Custom Game' })[variant], platform: 'Steam', installPath, real: true };
 if (variant === 'stardew') {
 await write(installPath, 'StardewModdingAPI.dll', 'fixture loader');
 await write(installPath, 'StardewModdingAPI.deps.json', JSON.stringify({ libraries: { 'SMAPI/4.2.0': {} } }));
 await write(installPath, 'Stardew Valley.deps.json', JSON.stringify({ libraries: { 'Stardew Valley/1.6.15': {} } }));
 await write(installPath, 'Mods/ContentPatcher/manifest.json', JSON.stringify({ Name: 'Content Patcher', UniqueID: 'Pathoschild.ContentPatcher', Version: '2.9.0', EntryDll: 'ContentPatcher.dll' }));
 await write(installPath, 'Saves/player.sav', 'preserve player save');
 } else if (variant === 'unreal') { await write(installPath, 'Game/Content/Paks/Game.pak', 'fixture'); await write(installPath, 'Game/Binaries/Win64/ue4ss/UE4SS.dll', 'fixture'); }
 else if (variant === 'unity') { await write(installPath, 'UnityPlayer.dll', 'fixture'); await write(installPath, 'Game_Data/Managed/Assembly-CSharp.dll', 'fixture'); }
 else if (variant === 're') { await write(installPath, 're_chunk_000.pak', 'fixture'); await write(installPath, 'dinput8.dll', 'fixture'); await fs.mkdir(path.join(installPath, 'reframework/autorun'), { recursive: true }); }
 const account = accountFixture(); if (pro) account.updateAccount({ membership: { tier: 'pro', expiresAt: null } });
 const service = await createServer({ root: path.join(root, 'data'), port: 0, accounts: account.options, studio, chooseStudioGame,
  scan: async () => ({ games: [game], roots: [], diagnostics: [] }), installers: { processes: async () => [], ...installers } });
 t.after(async () => { await new Promise(resolve => service.server.close(resolve)); await service.studio.conversations.settle(); await service.downloads.persist; });
 const login = await loginFixture(service);
 const post = async (route, body = {}) => { const response = await login.fetch(service.url + '/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': login.state.token }, body: JSON.stringify({ gameId: game.id, ...body }) }); return { status: response.status, body: await response.json() }; };
 return { root, game, service, account, login, post };
}

test('diagnostics reads bounded engine and loader evidence without following directory links', async t => {
 const root = await temp(t), game = path.join(root, 'game'), outside = path.join(root, 'outside');
 await write(game, 'UnityPlayer.dll', 'MZ'); await write(game, 'Game_Data/Managed/Assembly-CSharp.dll', 'MZ');
 await write(game, 'BepInEx/core/BepInEx.dll', 'MZ'); await write(outside, 'EasyAntiCheat.exe', 'MZ');
 await fs.symlink(outside, path.join(game, 'linked'));
 let report = await diagnoseGame({ id: 'fixture', name: 'Fixture', installPath: game });
 assert.equal(report.engine.key, 'unity-mono'); assert.deepEqual(report.loaders, ['BepInEx']); assert.deepEqual(report.antiCheat, []);
 await write(game, 'GameAssembly.dll', 'MZ'); await write(game, 'EasyAntiCheat/EAC.dll', 'MZ');
 report = await diagnoseGame({ id: 'fixture', name: 'Fixture', installPath: game });
 assert.equal(report.engine.key, 'unity-il2cpp'); assert.deepEqual(report.antiCheat, ['EasyAntiCheat']);
 assert.match(report.warnings.join(' '), /不表示不存在保护/);
 const unreal = path.join(root, 'unreal'); await write(unreal, 'Content/Paks/Game.pak', 'fixture');
 assert.equal((await diagnoseGame({ id: 'ue', name: 'UE fixture', installPath: unreal })).engine.key, 'unreal');
});
test('Stardew diagnostic reports actual prerequisite manifests and versions', async t => {
 const x = await fixture(t); const report = await diagnoseGame(x.game);
 assert.equal(report.engine.key, 'dotnet'); assert.equal(report.requirements.every(item => item.ready), true);
 assert.match(report.requirements[1].detail, /2.9.0/);
 await fs.rm(path.join(x.game.installPath, 'Mods/ContentPatcher/manifest.json'));
 assert.equal((await diagnoseGame(x.game)).requirements[1].ready, false);
});
test('dialogue builder limits target, actions and keys; ZIP round trips through production extractor', async t => {
 const root = await temp(t), built = buildContentPack(draft, crypto.randomUUID());
 assert.equal(built.manifest.ContentPackFor.UniqueID, 'Pathoschild.ContentPatcher');
 assert.deepEqual(built.content.Changes, [{ Action: 'EditData', Target: 'Characters/Dialogue/Abigail', Entries: draft.entries }]);
 for (const input of [{ ...draft, npc: '../../Saves' }, { ...draft, entries: { '../path': 'x' } }, { ...draft, entries: {} }, { ...draft, entries: { Mon: '{{Danger}}' } }, { ...draft, entries: { Mon: '$action bad' } }, null]) assert.throws(() => buildContentPack(input, crypto.randomUUID()));
 const file = path.join(root, 'pack.zip'); await fs.writeFile(file, zipContent(built.files));
 const files = await extract(file, path.join(root, 'unpacked'));
 assert.equal(files.length, 3); assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'unpacked/content.json'))), built.content);
});
test('texture pack validates PNG CRC and dimensions and targets one weapon via a private asset', () => {
 const image = texture(), built = buildContentPack({ ...draft, kind: 'texture', image }, crypto.randomUUID());
 assert.equal(pngBytes(image).length > 0, true); assert.equal(built.files.length, 4);
 assert.equal(built.content.Changes[1].Target, 'Data/Weapons');
 assert.equal(built.content.Changes[1].Fields['0'].Texture, built.manifest.UniqueID + '/Weapon');
 assert.throws(() => pngBytes(texture(32)), /16/);
 const bad = Buffer.from(image.split(',')[1], 'base64'); bad[40] ^= 1;
 assert.throws(() => pngBytes('data:image/png;base64,' + bad.toString('base64')), /校验/);
});
test('creation history persists per account and rejects changed archives', async t => {
 const root = await temp(t), studio = new ModStudio(root), game = { id: 'g', appId: '413150', name: 'Stardew Valley', installPath: root };
 const saved = await studio.save('alice', game, draft), reopened = new ModStudio(root);
 assert.equal((await reopened.list('alice', 'g')).length, 1); assert.deepEqual(await reopened.list('bob', 'g'), []);
 await assert.rejects(reopened.read('bob', saved.id), /当前账号/);
 await assert.rejects(studio.save('alice', { ...game, id: 'other', appId: '1', name: 'Other' }, draft), /星露谷/);
 await fs.appendFile(path.join(studio.recordPath('alice', saved.id), 'content-pack.zip'), 'changed');
 await assert.rejects(studio.archive('alice', game, saved.id), /已变化/);
});
test('Pro API saves, exports, previews, installs, disables and uninstalls while preserving saves', async t => {
 const x = await fixture(t), saved = await x.post('studio/save', { draft }); assert.equal(saved.status, 200);
 assert.deepEqual(await fs.readdir(path.join(x.game.installPath, 'Mods')), ['ContentPatcher']);
 const exported = await x.post('studio/export', { id: saved.body.id }); assert.equal(exported.status, 200); assert.ok(exported.body.base64.startsWith('UEs'));
 const plan = await x.post('studio/prepare', { id: saved.body.id }); assert.equal(plan.status, 200, JSON.stringify(plan.body));
 assert.equal(plan.body.profile.mode, 'smapi'); assert.ok(plan.body.files.every(file => file.destination.startsWith('Mods/Moddock.Creation')));
 const installed = await x.post('installations/apply', { id: plan.body.id }); assert.equal(installed.status, 200, JSON.stringify(installed.body));
 const target = path.join(x.game.installPath, 'Mods', saved.body.manifest.UniqueID, 'content.json');
 assert.deepEqual(JSON.parse(await fs.readFile(target)), saved.body.content);
 assert.equal((await x.post('installations/action', { id: installed.body.id, action: 'disable' })).status, 200); await assert.rejects(fs.access(target));
 assert.equal((await x.post('installations/action', { id: installed.body.id, action: 'enable' })).status, 200); await fs.access(target);
 assert.equal((await x.post('installations/action', { id: installed.body.id, action: 'uninstall' })).status, 200); await assert.rejects(fs.access(target));
 assert.equal(await fs.readFile(path.join(x.game.installPath, 'Saves/player.sav'), 'utf8'), 'preserve player save');
});
test('missing Content Patcher blocks installation and leaves the content pack exportable', async t => {
 const x = await fixture(t); await fs.rm(path.join(x.game.installPath, 'Mods'), { recursive: true });
 const saved = await x.post('studio/save', { draft }), plan = await x.post('studio/prepare', { id: saved.body.id });
 assert.equal(plan.status, 400); assert.match(plan.body.error, /Content Patcher|缺少依赖/);
 assert.equal((await x.post('studio/export', { id: saved.body.id })).status, 200);
 await assert.rejects(fs.access(path.join(x.game.installPath, 'Mods')));
});
test('standard and expired Pro accounts cannot call advanced endpoints directly', async t => {
 const x = await fixture(t, { pro: false }); assert.equal(x.login.state.studio.allowed, false);
 for (const route of ['studio/diagnose','studio/save','studio/generate','studio/list']) assert.equal((await x.post(route, { draft })).status, 403);
 x.account.updateAccount({ membership: { tier: 'pro', expiresAt: '2001-01-01T00:00:00Z' } });
 assert.equal((await x.post('studio/diagnose')).status, 403);
 assert.equal(studioAccess({ membership: { tier: 'pro' }, features: [{ key: 'modding.studio', enabled: false, allowed: true }] }), false);
});
test('membership is rechecked when applying a prepared creation', async t => {
 const x = await fixture(t), saved = await x.post('studio/save', { draft }), plan = await x.post('studio/prepare', { id: saved.body.id });
 assert.equal(plan.status, 200); x.account.updateAccount({ membership: { tier: 'standard', expiresAt: null } });
 assert.equal((await x.post('installations/apply', { id: plan.body.id })).status, 403);
 assert.equal((await fs.readdir(path.join(x.game.installPath, 'Mods'))).length, 1);
});
test('another Pro account cannot read a creation or import its download job', async t => {
 const x = await fixture(t), saved = await x.post('studio/save', { draft }), plan = await x.post('studio/prepare', { id: saved.body.id });
 x.account.updateAccount({ id: 'other-user' }); const other = await loginFixture(x.service);
 const call = (route, body) => other.fetch(x.service.url + '/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': other.state.token }, body: JSON.stringify({ gameId: x.game.id, ...body }) });
 assert.equal((await call('studio/read', { id: saved.body.id })).status, 400);
 assert.equal((await call('installations/plan', { jobId: plan.body.jobId })).status, 403);
 assert.equal(other.state.jobs.length, 0);
});
test('AI remains unavailable without an injected service and never creates a fake draft', async t => {
 const x = await fixture(t), response = await x.post('studio/generate', { kind: 'dialogue', npc: 'Abigail', prompt: '写一句问候' });
 assert.equal(response.status, 503); assert.equal(response.body.code, 'AI_SERVICE_NOT_CONFIGURED');
 assert.deepEqual((await x.post('studio/list')).body.items, []); assert.equal(x.login.state.studio.aiAvailable, false);
});
test('future AI adapter returns validated drafts only and supports cancellation', async t => {
 const root = await temp(t), game = { id: 'g', appId: '413150', name: 'Stardew Valley', installPath: root };
 const studio = new ModStudio(root, { generate: async () => draft });
 assert.equal((await studio.generate('alice', game, { kind: 'dialogue', npc: 'Abigail', prompt: 'hello' }, () => true)).draft.npc, 'Abigail');
 studio.options.generate = async () => ({ ...draft, npc: '../../Saves' });
 await assert.rejects(studio.generate('alice', game, { kind: 'dialogue', npc: 'Abigail', prompt: 'hello' }, () => true), /不匹配/);
 let started; const ready = new Promise(resolve => { started = resolve; });
 studio.options.generate = async () => { started(); return new Promise(() => {}); };
 const pending = studio.generate('alice', game, { kind: 'dialogue', npc: 'Abigail', prompt: 'hello' }, () => true);
 await ready; studio.cancelOwner('alice'); await assert.rejects(pending, /取消/); assert.equal(studio.pending.size, 0);
 let invoked = false; studio.options.generate = async () => { invoked = true; return draft; };
 await assert.rejects(studio.generate('alice', game, { kind: 'dialogue', npc: 'Abigail', prompt: 'hello' }, () => false), /账号已切换/);
 assert.equal(invoked, false);
});

test('bundled universal-modder executes original detection and supplies real guide and case text', async t => {
 const x = await fixture(t, { variant: 'unreal' }), { body: workspace } = await x.post('studio/workspace');
 const { UniversalModder } = require('../universal-modder.cjs'), integration = new UniversalModder();
 const runtime = await integration.runtime();
 if (runtime.available) assert.equal(workspace.diagnostic.integration.backend, 'upstream');
 else t.diagnostic('Python unavailable: original scanner path not exercised');
 assert.equal(workspace.diagnostic.engine.key, 'unreal'); assert.match(workspace.context.guide.text, /Unreal/i);
 assert.equal(workspace.context.toolkit.commit, '23902ef42e8ea9b077bfbbf6911eb8ea0348e55a');
 assert.ok(workspace.context.notes.some(note => note.text.length > 100));
 assert.equal((await x.post('studio/reference', { path: workspace.context.guide.path })).status, 200);
 assert.equal((await x.post('studio/reference', { path: 'knowledge/../../account.cjs' })).status, 400);
 const fallback = await new UniversalModder({ python: false }).diagnose(x.game, await diagnoseGame(x.game));
 assert.equal(fallback.integration.backend, 'compatible'); assert.equal(fallback.engine.key, 'unreal');
});
test('generic upstream native fallback preserves local managed game evidence and the corresponding guide', async t => {
 const x = await fixture(t), { body: workspace } = await x.post('studio/workspace');
 assert.equal(workspace.diagnostic.engine.key, 'dotnet');
 assert.ok(workspace.diagnostic.engine.evidence.some(file => file.endsWith('.deps.json')));
 assert.match(workspace.context.guide.path, /dotnet-xna/);
});
test('UE4SS project uses its detected loader directory and existing transactional installation', async t => {
 const x = await fixture(t, { variant: 'unreal' });
 const saved = await x.post('studio/save', { draft: { kind: 'ue4ss-lua', name: 'Test Script', author: 'Player', code: runtimeLua('print("Hello")') } });
 assert.equal(saved.status, 200, JSON.stringify(saved.body));
 assert.equal((await x.post('studio/save', { draft })).status, 400);
 const plan = await x.post('studio/prepare', { id: saved.body.id }); assert.equal(plan.status, 200, JSON.stringify(plan.body));
 assert.equal(plan.body.files.length, 2); assert.ok(plan.body.files.every(file => file.destination.startsWith('Game/Binaries/Win64/ue4ss/Mods/Moddock')));
 const repeatedPlan = await x.post('installations/plan', { jobId: plan.body.jobId }); assert.equal(repeatedPlan.status, 200, JSON.stringify(repeatedPlan.body));
 const installed = await x.post('installations/apply', { id: plan.body.id }); assert.equal(installed.status, 200, JSON.stringify(installed.body));
 const script = path.join(x.game.installPath, 'Game/Binaries/Win64/ue4ss/Mods', saved.body.manifest.UniqueID, 'Scripts/main.lua');
 assert.match(await fs.readFile(script, 'utf8'), /print\("Hello"\)/);
 await x.post('installations/action', { id: installed.body.id, action: 'uninstall' }); await assert.rejects(fs.access(script));
 await fs.rm(path.join(x.game.installPath, 'Game/Binaries/Win64/ue4ss/UE4SS.dll'));
 assert.equal((await x.post('studio/prepare', { id: saved.body.id })).status, 400);
 assert.equal((await x.post('studio/export', { id: saved.body.id })).status, 200);
});
test('REFramework project deploys a uniquely named Lua file only to detected autorun', async t => {
 const x = await fixture(t, { variant: 're' });
 const saved = await x.post('studio/save', { draft: { kind: 'reframework-lua', name: 'RE Script', author: 'Player', code: runtimeLua('log.info("Hello")') } });
 assert.equal(saved.status, 200, JSON.stringify(saved.body));
 const plan = await x.post('studio/prepare', { id: saved.body.id }); assert.equal(plan.status, 200, JSON.stringify(plan.body));
 assert.deepEqual(plan.body.files.map(file => file.destination), [`reframework/autorun/${saved.body.manifest.UniqueID}.lua`]);
 const installed = await x.post('installations/apply', { id: plan.body.id }); assert.equal(installed.status, 200);
 assert.equal((await x.post('installations/action', { id: installed.body.id, action: 'uninstall' })).status, 200);
});
test('Unity source project exports without claiming a compiled or installable plugin', async t => {
 const x = await fixture(t, { variant: 'unity' });
 const saved = await x.post('studio/save', { draft: { kind: 'bepinex-plugin', name: 'Frame Target', author: 'Player', targetFps: 90 } });
 assert.equal(saved.status, 200, JSON.stringify(saved.body)); assert.equal(saved.body.installable, false);
 assert.ok(saved.body.files.some(file => file.name === 'src/Plugin.cs')); assert.ok(!saved.body.files.some(file => file.name.endsWith('.dll')));
 assert.equal((await x.post('studio/export', { id: saved.body.id })).status, 200);
 assert.equal((await x.post('studio/prepare', { id: saved.body.id })).status, 400);
 assert.equal(x.service.downloads.jobs.length, 0);
 await write(x.game.installPath, 'GameAssembly.dll', 'fixture');
 assert.equal((await x.post('studio/save', { draft: saved.body.draft })).status, 400);
});
test('any game can create plans and custom multi-file projects with safe export paths', async t => {
 const x = await fixture(t, { variant: 'unknown' });
 const project = { kind: 'custom-project', name: 'My Mod Project', author: 'Player', files: [{ name: 'scripts/main.lua', text: 'print("hello")' }, { name: 'config.json', text: '{"enabled":true}' }] };
 const saved = await x.post('studio/save', { draft: project }); assert.equal(saved.status, 200, JSON.stringify(saved.body));
 assert.equal(saved.body.installable, false); assert.ok(saved.body.files.some(file => file.name === 'src/scripts/main.lua'));
 assert.equal((await x.post('studio/prepare', { id: saved.body.id })).status, 400);
 const exported = await x.post('studio/export', { id: saved.body.id }); assert.equal(exported.status, 200);
 const zip = path.join(x.root, 'export.zip'); await fs.writeFile(zip, Buffer.from(exported.body.base64, 'base64'));
 await extract(zip, path.join(x.root, 'expanded')); assert.equal(await fs.readFile(path.join(x.root, 'expanded/src/config.json'), 'utf8'), '{"enabled":true}\n');
 for (const name of ['../escape.lua', '/absolute.lua', 'C:/escape.lua', 'NUL.txt', 'dir//file.lua', 'dir./main.lua']) assert.equal((await x.post('studio/save', { draft: { ...project, files: [{ name, text: 'x' }] } })).status, 400);
 assert.equal((await x.post('studio/save', { draft: { kind: 'project-plan', name: 'Plan', author: 'Player', plan: 'Implement and verify the Mod.' } })).status, 200);
});
test('future generator receives upstream workflow, game context and selected adapter', async t => {
 let payload;
 const x = await fixture(t, { variant: 'unreal', studio: { generate: async input => { payload = input; return { kind: input.kind, name: 'Generated draft', author: 'Player', code: 'print("Hello")' }; } } });
 const generated = await x.post('studio/generate', { kind: 'ue4ss-lua', prompt: 'Create a Lua entry point' });
 assert.equal(generated.status, 200, JSON.stringify(generated.body)); assert.match(payload.context.workflow, /mod-any-game/);
 assert.equal(payload.diagnostic.engine.key, 'unreal'); assert.equal(payload.kind, 'ue4ss-lua');
 assert.ok(payload.context.notes.some(note => note.text)); assert.equal((await x.post('studio/list')).body.items.length, 0);
});

const creationPlan = { title: 'Exploration helper', summary: 'Create a small exploration helper for this game.', kind: 'ue4ss-lua', steps: ['Inspect the existing loader.', 'Generate the Lua entry point.', 'Validate and package the project.'], requirements: ['An existing compatible UE4SS installation.'] };
test('detailed model plans retain their steps while excessive or malformed metadata stays bounded', () => {
 const types = [{ id: 'ue4ss-lua', available: true }];
 const detailed = { ...creationPlan, steps: Array.from({ length: 9 }, (_, index) => 'Step ' + (index + 1)) };
 assert.deepEqual(validatedPlan(detailed, types).steps, detailed.steps);
 assert.throws(() => validatedPlan({ ...detailed, steps: Array(13).fill('Step') }, types), error => error.code === 'STUDIO_PLAN_INVALID' && /最多 12 项/.test(error.message));
 assert.throws(() => validatedPlan({ ...detailed, steps: [{ text: 'Step' }] }, types), { code: 'STUDIO_PLAN_INVALID' });
});
async function completeTurn(x, input) {
 const accepted = await x.post('studio/conversations/send', input); assert.equal(accepted.status, 202, JSON.stringify(accepted.body));
 await x.service.studio.conversations.settle();
 const response = await x.post('studio/conversations/read', { id: accepted.body.id }); assert.equal(response.status, 200, JSON.stringify(response.body));
 return response.body;
}
test('conversation saves an idea and real diagnosis without inventing an AI plan or artifact', async t => {
 const x = await fixture(t, { variant: 'unreal' }), idea = '我想加入一把会随探索成长的魔杖。';
 const thread = await completeTurn(x, { message: idea });
 assert.equal(thread.status, 'awaiting_service'); assert.equal(thread.analysis.engineKey, 'unreal');
 assert.equal(thread.messages[0].content, idea); assert.equal(thread.messages.filter(message => message.role === 'assistant').length, 0);
 assert.equal(thread.plan, null); assert.equal(thread.artifactId, null); assert.equal((await x.post('studio/list')).body.items.length, 0);
 const ownerDirectories = await fs.readdir(path.join(x.root, 'data/creations'));
 const persisted = JSON.parse(await fs.readFile(path.join(x.root, 'data/creations', ownerDirectories[0], 'conversations', thread.id + '.json')));
 assert.equal(persisted.messages[0].content, idea); assert.equal(persisted.status, 'awaiting_service');
 assert.equal((await x.post('studio/conversations/list')).body.items[0].id, thread.id);
});
test('automatic planning and generation choose an adapter, save the artifact and support natural-language revisions', async t => {
 const planned = [], generated = [];
 const x = await fixture(t, { variant: 'unreal', studio: {
  plan: async payload => { planned.push(payload); return creationPlan; },
  generate: async payload => { generated.push(payload); return { kind: payload.kind, name: 'Exploration helper', author: 'Player', code: runtimeLua(`print("revision ${generated.length}")`) }; },
 } });
 assert.equal(x.login.state.studio.aiAvailable, true);
 const first = await completeTurn(x, { message: 'Make exploration more fun.' });
 assert.equal(first.status, 'completed'); assert.equal(first.plan.kind, 'ue4ss-lua'); assert.ok(first.artifactId);
 assert.equal(planned[0].types.some(type => type.id === 'ue4ss-lua'), true); assert.equal(generated[0].plan.title, creationPlan.title);
 assert.equal(planned[0].diagnostic.engine.key, 'unreal'); assert.ok(planned[0].context.guide.text.length > 100);
 const saved = (await x.post('studio/read', { id: first.artifactId })).body;
 assert.equal(saved.adapterId, 'ue4ss-lua'); assert.equal(saved.installable, true);
 const second = await completeTurn(x, { id: first.id, message: 'Also change the greeting.' });
 assert.equal(second.status, 'completed'); assert.notEqual(second.artifactId, first.artifactId);
 assert.equal(planned[1].previousDraft.code, saved.draft.code); assert.equal(planned[1].messages.filter(message => message.role === 'user').length, 2);
 assert.equal((await x.post('studio/list')).body.items.length, 2);
 assert.equal((await x.post('studio/prepare', { id: second.artifactId })).status, 200);
});
test('a Mod request rejects a document downgrade and compiles a real Lua package even before a local loader is installed', async t => {
 let plans = 0;
 const x = await fixture(t, { variant: 'unreal', studio: {
  plan: async () => ({ ...creationPlan, kind: ++plans === 1 ? 'project-plan' : 'ue4ss-lua' }),
  generate: async () => ({ kind: 'ue4ss-lua', name: 'Executable helper', author: 'Fixture', code: runtimeLua('RegisterHook("/Script/Engine.PlayerController:ClientRestart", function(Context) local pawn = Context:get() if pawn:IsValid() then print(pawn:GetFullName()) end end)') }),
  tools: { luac: false },
 } });
 await fs.rm(path.join(x.game.installPath, 'Game/Binaries/Win64/ue4ss/UE4SS.dll'));
 const thread = await completeTurn(x, { message: '制作实际脚本 Mod，不要开发方案' });
 assert.equal(thread.status, 'completed', thread.error); assert.equal(plans, 2);
 const saved = (await x.post('studio/read', { id: thread.artifactId })).body;
 assert.equal(saved.adapterId, 'ue4ss-lua'); assert.equal(saved.installable, true); assert.equal(saved.toolchain.installation.ready, false);
 assert.ok(saved.toolchain.bundle); assert.ok(saved.files.some(file => file.name.endsWith('Scripts/main.lua')));
 assert.ok(!saved.files.some(file => file.name === 'MODDING_PLAN.md'));
 const bundle = (await x.post('studio/export', { id: saved.id, buildId: saved.toolchain.id })).body;
 assert.ok(Buffer.from(bundle.base64, 'base64').includes(Buffer.from('RegisterHook')));
 assert.equal((await x.post('studio/prepare', { id: saved.id })).status, 400);
});
test('an unsupported game retains the idea without manufacturing a plan as a completed Mod', async t => {
 let called = false;
 const x = await fixture(t, { variant: 'unknown', studio: { plan: async () => { called = true; return { ...creationPlan, kind: 'project-plan' }; }, generate: async () => ({}) } });
 const thread = await completeTurn(x, { message: '开发一个可安装的战斗 Mod' });
 assert.equal(thread.status, 'failed'); assert.equal(thread.artifactId, null); assert.equal(called, false);
 assert.match(thread.error, /制作适配/); assert.equal(thread.messages.filter(message => message.role === 'user').length, 1);
 assert.deepEqual((await x.post('studio/list')).body.items, []);
});
test('clarifying questions stay in the conversation and only generate after an answer', async t => {
 let plans = 0, generations = 0;
 const x = await fixture(t, { variant: 'unreal', studio: {
  plan: async () => ++plans === 1 ? { title: 'Exploration helper', summary: 'Choose the desired activation behavior.', questions: ['Should this activate automatically?'] } : creationPlan,
  generate: async () => { generations++; return { kind: 'ue4ss-lua', name: 'Helper', author: 'Player', code: runtimeLua('print("Hello")') }; },
 } });
 const waiting = await completeTurn(x, { message: 'Create an exploration helper.' });
 assert.equal(waiting.status, 'clarifying'); assert.equal(generations, 0); assert.match(waiting.messages.at(-1).content, /automatically/);
 const completed = await completeTurn(x, { id: waiting.id, message: 'Yes, automatically.' });
 assert.equal(completed.status, 'completed'); assert.equal(generations, 1);
});
test('unsupported AI plans and invalid generated source never become artifacts', async t => {
 let generated = false, plans = 0;
 const x = await fixture(t, { variant: 'unreal', studio: { plan: async () => { plans++; return { ...creationPlan, kind: 'dialogue' }; }, generate: async () => { generated = true; return draft; } } });
 const rejected = await completeTurn(x, { message: 'Make a Mod.' });
 assert.equal(rejected.status, 'failed'); assert.equal(generated, false); assert.match(rejected.error, /不支持/);
 assert.equal(plans, 3); assert.equal(rejected.planningAttempts.length, 3);
 assert.ok(rejected.planningAttempts.every(attempt => attempt.kind === 'dialogue' && !attempt.accepted));
 x.service.studio.options.plan = async () => ({ ...creationPlan, kind: 'custom-project' });
 x.service.studio.options.generate = async () => ({ kind: 'custom-project', name: 'Unsafe project', author: 'Player', files: [{ name: '../escape.lua', text: 'x' }] });
 const invalid = await completeTurn(x, { message: 'Make another Mod.' });
 assert.equal(invalid.status, 'failed'); assert.equal(invalid.artifactId, null); assert.equal((await x.post('studio/list')).body.items.length, 0);
});
test('invalid kinds and malformed steps are automatically replanned with feedback before generation', async t => {
 const requests = []; let generations = 0;
 const x = await fixture(t, { variant: 'unknown', studio: {
  plan: async payload => {
   requests.push(payload);
   if (requests.length === 1) return { ...creationPlan, kind: 'dialogue' };
   if (requests.length === 2) return { ...creationPlan, kind: 'project-plan', steps: 'not an array' };
   return { ...creationPlan, kind: 'project-plan' };
  },
  generate: async payload => { generations++; assert.equal(payload.kind, 'project-plan'); return { kind: payload.kind, name: 'Companion development plan', author: 'Player', plan: 'A new companion requires verified game APIs and a dedicated resource pack adapter.' }; },
 } });
 const thread = await completeTurn(x, { message: 'Create a development plan for a Chinese companion; choose the details yourself.' });
 assert.equal(thread.status, 'completed'); assert.equal(generations, 1); assert.equal(requests.length, 3);
 assert.equal(requests[1].previousPlan.kind, 'dialogue'); assert.match(requests[1].validation.error, /不支持/);
 assert.deepEqual(requests[1].validation.allowedKinds, ['project-plan', 'custom-project']);
 assert.equal(requests[2].previousPlan.stepsType, 'string'); assert.match(requests[2].validation.error, /制作步骤/);
 assert.ok(requests.every(request => request.prompt === requests[0].prompt));
 assert.equal(thread.capability.mode, 'source-only'); assert.match(thread.capability.message, /暂不能安装/);
 assert.deepEqual(thread.planningAttempts.map(attempt => attempt.accepted), [false, false, true]);
 const saved = (await x.post('studio/read', { id: thread.artifactId })).body;
 assert.equal(saved.installable, false); assert.equal(saved.toolchain.status, 'passed');
 assert.match(saved.toolchain.summary, /开发方案/); assert.equal(saved.toolchain.runtime.status, 'not_applicable');
 assert.match(thread.messages.at(-1).content, /尚未生成可安装/);
 assert.equal((await x.post('studio/prepare', { id: saved.id })).status, 400);
 const fresh = await completeTurn(x, { id: thread.id, message: 'Make the plan more detailed.' });
 assert.equal(fresh.planningAttempts.length, 1); assert.equal(fresh.planningAttempts[0].accepted, true);
});
test('malformed model JSON is replanned but transport and balance failures are never retried', async t => {
 let plans = 0;
 const x = await fixture(t, { variant: 'unreal', studio: {
  plan: async () => { if (++plans === 1) throw Object.assign(new Error('Invalid JSON'), { code: 'AI_RESPONSE_FORMAT' }); return creationPlan; },
  generate: async () => ({ kind: 'ue4ss-lua', name: 'Helper', author: 'Player', code: runtimeLua('print("Hello")') }),
 } });
 const completed = await completeTurn(x, { message: 'Create an exploration helper.' });
 assert.equal(completed.status, 'completed'); assert.equal(plans, 2); assert.equal(completed.planningAttempts[0].code, 'AI_RESPONSE_FORMAT');
 for (const reason of ['DeepSeek 账户余额不足（HTTP 402）', 'DeepSeek 服务暂时无法连接']) {
  plans = 0; x.service.studio.options.plan = async () => { plans++; throw new Error(reason); };
  const failed = await completeTurn(x, { message: 'Create another helper.' });
  assert.equal(plans, 1); assert.equal(failed.status, 'failed'); assert.equal(failed.artifactId, null); assert.equal(failed.error, reason);
 }
});
test('delegated creative choices do not cause repeated questions for source-only development plans', async t => {
 const requests = [];
 const x = await fixture(t, { variant: 'unknown', studio: {
  plan: async payload => { requests.push(payload); return requests.length === 1 ? { title: 'Companion', summary: 'Choose a look.', questions: ['Which appearance?'] } : { ...creationPlan, kind: 'project-plan' }; },
  generate: async () => ({ kind: 'project-plan', name: 'Companion', author: 'Player', plan: 'Choose a default appearance and document missing game API evidence.' }),
 } });
 const thread = await completeTurn(x, { message: '给我一份开发方案，做一个人物 Mod，你自己决定就可以了。' });
 assert.equal(thread.status, 'completed'); assert.equal(requests.length, 2); assert.equal(thread.plan.questions.length, 0);
 assert.equal(requests[0].capability.creativeDefaultsDelegated, true); assert.match(requests[1].validation.error, /采用合理默认值/);
 assert.equal(thread.planningAttempts[0].accepted, false); assert.equal(thread.planningAttempts[1].accepted, true);
 assert.equal(thread.messages.filter(message => message.role === 'assistant').length, 1);
});
test('cancelling automatic replanning prevents later retries and artifact generation', async t => {
 let started, plans = 0, generated = false;
 const retrying = new Promise(resolve => { started = resolve; });
 const x = await fixture(t, { variant: 'unreal', studio: {
  plan: async () => { if (++plans === 1) return { ...creationPlan, kind: 'dialogue' }; started(); return new Promise(() => {}); },
  generate: async () => { generated = true; return draft; },
 } });
 const accepted = await x.post('studio/conversations/send', { message: 'Create an exploration helper.' }); await retrying;
 assert.equal((await x.post('studio/cancel')).status, 200); await x.service.studio.conversations.settle();
 const stopped = (await x.post('studio/conversations/read', { id: accepted.body.id })).body;
 assert.equal(stopped.status, 'cancelled'); assert.equal(plans, 2); assert.equal(generated, false); assert.equal(stopped.artifactId, null);
 assert.equal(stopped.planningAttempts.length, 1); assert.equal(stopped.messages[0].content, 'Create an exploration helper.');
});
test('a saved idea can resume after the future service is configured', async t => {
 const x = await fixture(t, { variant: 'unknown' }), waiting = await completeTurn(x, { message: '只输出源码，做一个新任务工程。' });
 x.service.studio.options.plan = async () => ({ ...creationPlan, kind: 'custom-project' });
 x.service.studio.options.generate = async () => ({ kind: 'custom-project', name: 'Quest project', author: 'Player', files: [{ name: 'quest.json', text: '{"name":"New quest"}' }] });
 const completed = await completeTurn(x, { id: waiting.id, resume: true });
 assert.equal(completed.status, 'blocked'); assert.equal(completed.messages.filter(message => message.role === 'user').length, 1);
 assert.equal((await x.post('studio/read', { id: completed.artifactId })).body.installable, false);
});
test('stopping an automatic creation cancels a pending model and preserves the idea', async t => {
 let started; const ready = new Promise(resolve => { started = resolve; }); let generated = false;
 const x = await fixture(t, { variant: 'unreal', studio: { plan: async () => { started(); return new Promise(() => {}); }, generate: async () => { generated = true; return {}; } } });
 const accepted = await x.post('studio/conversations/send', { message: 'Create an exploration helper.' }); await ready;
 assert.equal((await x.post('studio/conversations/send', { message: 'Duplicate creation.' })).status, 400);
 assert.equal((await x.post('studio/cancel')).status, 200); await x.service.studio.conversations.settle();
 const stopped = (await x.post('studio/conversations/read', { id: accepted.body.id })).body;
 assert.equal(stopped.status, 'cancelled'); assert.equal(generated, false); assert.equal(stopped.messages[0].role, 'user'); assert.equal(stopped.artifactId, null);
});
test('conversation access is isolated by account and game and protected by Pro membership', async t => {
 const x = await fixture(t), thread = await completeTurn(x, { message: 'Write a new character story.' });
 await assert.rejects(x.service.studio.conversations.read('another-owner', x.game, thread.id), /当前账号/);
 const ownerDirectories = await fs.readdir(path.join(x.root, 'data/creations'));
 const owner = 'owner'; const isolated = new ModStudio(path.join(x.root, 'isolated'));
 const own = await isolated.conversations.send(owner, x.game, { message: 'Test idea.' }, () => true); await isolated.conversations.settle();
 await assert.rejects(isolated.conversations.read(owner, { ...x.game, id: 'another-game' }, own.id), /当前游戏/);
 const reopened = new ModStudio(path.join(x.root, 'isolated'));
 assert.equal((await reopened.conversations.read(owner, x.game, own.id)).status, 'awaiting_service'); assert.equal(ownerDirectories.length, 1);
 x.account.updateAccount({ membership: { tier: 'standard' } });
 for (const route of ['studio/conversations/list','studio/conversations/read','studio/conversations/send']) assert.equal((await x.post(route, { id: thread.id, message: 'x' })).status, 403);
});
test('an interrupted persisted conversation recovers without claiming the AI is still running', async t => {
 const root = await temp(t), studio = new ModStudio(root), game = { id: 'test-game' }, owner = 'owner', id = crypto.randomUUID();
 await studio.conversations.persist(owner, { id, gameId: game.id, title: 'Idea', status: 'generating', messages: [{ role: 'user', content: 'Idea' }] });
 const recovered = await studio.conversations.read(owner, game, id);
 assert.equal(recovered.status, 'interrupted'); assert.match(recovered.messages.at(-1).content, /已中断/);
 assert.equal((await studio.conversations.read(owner, game, id)).messages.length, recovered.messages.length);
});

test('production rejects the removed sample mode', async t => {
 const x = await fixture(t);
 assert.equal((await x.post('studio/conversations/send', { message: 'Test idea.', mode: 'preview' })).status, 400);
 assert.equal(x.login.state.studio.localPreviewAvailable, undefined);
});
test('conversation commands build, report, preview and export existing artifacts without a model', async t => {
 const x = await fixture(t, { studio: { plan: async () => ({ ...creationPlan, kind: 'dialogue' }), generate: async () => draft } });
 let thread = await completeTurn(x, { message: '写一段村民对话' });
 const id = thread.artifactId;
 assert.equal(thread.toolchain.status, 'passed');
 const saved = (await x.post('studio/read', { id })).body;
 assert.equal(saved.toolchain.runtime.status, 'not_run');
 assert.ok(saved.toolchain.checks.some(check => check.name.startsWith('JSON') && check.status === 'passed'));
 thread = await completeTurn(x, { id: thread.id, message: '重新编译' });
 assert.equal(thread.artifactId, id); assert.notEqual(thread.toolchain.id, saved.toolchain.id);
 thread = await completeTurn(x, { id: thread.id, message: '查看验证报告' });
 assert.match(thread.messages.at(-1).content, /游戏内兼容/);
 thread = await completeTurn(x, { id: thread.id, message: '预览产物' });
 assert.equal(thread.action.kind, 'preview'); assert.equal(thread.action.artifactId, id);
 thread = await completeTurn(x, { id: thread.id, message: '导出' }); assert.equal(thread.action.kind, 'export');
 thread = await completeTurn(x, { id: thread.id, message: '检查本次运行' });
 assert.match(thread.messages.at(-1).content, /尚未安装/);
 assert.equal((await x.post('studio/read', { id })).body.toolchain.runtime.status, 'not_installed');
 assert.equal((await x.post('studio/list')).body.items.length, 1);
 assert.equal(x.service.downloads.jobs.length, 0);
 x.account.updateAccount({ membership: { tier: 'standard' } });
 assert.equal((await x.post('studio/toolchain', { id })).status, 403);
});
test('legacy selected projects can enter the conversation toolchain with owner and game isolation', async t => {
 const x = await fixture(t), saved = (await x.post('studio/save', { draft })).body;
 const thread = await completeTurn(x, { message: '编译并验证', artifactId: saved.id });
 assert.equal(thread.artifactId, saved.id); assert.equal(thread.title, draft.name); assert.equal(thread.toolchain.status, 'passed'); assert.ok(thread.analysis);
 const other = (await x.post('studio/save', { draft: { ...draft, name: 'Another revision' } })).body;
 assert.equal((await x.post('studio/conversations/send', { id: thread.id, artifactId: other.id, message: '重新编译' })).status, 400);
 await assert.rejects(x.service.studio.conversations.send('another-owner', x.game, { message: '重新编译', artifactId: saved.id }, () => true), /当前账号/);
 await assert.rejects(x.service.studio.conversations.send('fixture-user', { ...x.game, id: 'another-game' }, { message: '重新编译', artifactId: saved.id }, () => true), /当前游戏/);
});
test('missing compilers and unsupported build adapters preserve source without claiming validation passed', async t => {
 for (const variant of ['unity','unknown']) {
  const x = await fixture(t, { variant, studio: { plan: async () => ({ ...creationPlan, kind: ({ unreal: 'ue4ss-lua', unity: 'bepinex-plugin', unknown: 'custom-project' })[variant] }), generate: async () => ({ kind: ({ unreal: 'ue4ss-lua', unity: 'bepinex-plugin', unknown: 'custom-project' })[variant], name: 'Build fixture', author: 'Fixture', code: 'print(1)', files: [{ name: 'main.txt', text: 'No registered build adapter.' }] }), tools: { luac: false, dotnet: false } } });
  const thread = await completeTurn(x, { message: variant === 'unknown' ? '只输出源码，制作一个探索助手' : '制作一个探索助手' });
  const saved = (await x.post('studio/read', { id: thread.artifactId })).body;
  assert.equal(saved.toolchain.status, 'blocked'); assert.equal(saved.toolchain.runtime.status, 'not_run');
  assert.equal(thread.status, 'blocked');
  assert.ok(saved.toolchain.checks.some(check => check.status === 'blocked'));
  assert.equal((await x.post('studio/export', { id: saved.id })).status, 200);
  assert.equal((await x.post('studio/export', { id: saved.id, buildId: saved.toolchain.id })).status, 400);
 }
});
test('real Lua compilation rejects syntax errors and never executes generated scripts; reserved repair can retry', async t => {
 const { StudioTools } = require('../studio-tools.cjs');
 if (!(await new StudioTools().probe()).lua.available) { t.skip('Host Lua 5.4 compiler is not provisioned'); return; }
 let repairs = 0;
 const x = await fixture(t, { variant: 'unreal', studio: {
  plan: async () => creationPlan,
  generate: async () => ({ kind: 'ue4ss-lua', name: 'Broken Lua', author: 'Fixture', code: 'function broken(' }),
  repair: async payload => { repairs++; assert.equal(payload.validation.status, 'failed'); return { kind: 'ue4ss-lua', name: 'Repaired Lua', author: 'Fixture', code: runtimeLua(`local file = io.open(${JSON.stringify(path.join(x.root, 'must-not-execute'))}, "w"); file:write("executed"); file:close()`) }; },
 } });
 const thread = await completeTurn(x, { message: 'Make a Lua project.' });
 assert.equal(repairs, 1); assert.equal(thread.toolchain.status, 'passed');
 const records = (await x.post('studio/list')).body.items;
 assert.equal(records.length, 2);
 const broken = (await x.post('studio/read', { id: records.find(item => item.id !== thread.artifactId).id })).body;
 assert.equal(broken.toolchain.status, 'failed'); assert.ok(broken.toolchain.checks.some(check => check.name.startsWith('Lua 语法') && check.status === 'failed'));
 assert.equal(broken.installable, false); assert.equal((await x.post('studio/prepare', { id: broken.id })).status, 400);
 await assert.rejects(fs.access(path.join(x.root, 'must-not-execute')));
});
test('real C# compilation exports a checked DLL, keeps revisions isolated, and rejects tampered compiled bundles', async t => {
 const { StudioTools } = require('../studio-tools.cjs');
 if (!(await new StudioTools().probe()).csharp.available) { t.skip('Host .NET SDK is not provisioned'); return; }
 const x = await fixture(t, { variant: 'unity', studio: { plan: async () => ({ ...creationPlan, kind: 'bepinex-plugin' }), generate: async () => ({ kind: 'bepinex-plugin', name: 'Frame target', author: 'Fixture', targetFps: 90 }) } });
 await require('./toolchain-fixture.cjs').monoFixture(x.game.installPath);
 let thread = await completeTurn(x, { message: '目标帧率 90' });
 assert.equal(thread.toolchain.status, 'passed', JSON.stringify((await x.post('studio/read', { id: thread.artifactId })).body.toolchain));
 const id = thread.artifactId, saved = (await x.post('studio/read', { id })).body, report = saved.toolchain;
 assert.ok(report.bundle); assert.ok(report.outputs[0].name.endsWith('.dll')); assert.equal(saved.installable, true);
 const exported = await x.post('studio/export', { id, buildId: report.id }); assert.equal(exported.status, 200);
 const archive = path.join(x.root, 'compiled.zip'), output = path.join(x.root, 'compiled');
 await fs.writeFile(archive, Buffer.from(exported.body.base64, 'base64')); await extract(archive, output);
 const dll = await fs.readFile(path.join(output, report.outputs[0].name));
 assert.equal(require('../studio-toolchain.cjs').managedDll(dll), true);
 assert.equal(crypto.createHash('sha256').update(dll).digest('hex'), report.outputs[0].sha256);
 thread = await completeTurn(x, { id: thread.id, message: '导出编译包' }); assert.equal(thread.action.buildId, report.id);
 await assert.rejects(x.service.studio.toolchain.bundle('another-owner', x.game, id, report.id), /当前账号/);
 await assert.rejects(x.service.studio.toolchain.bundle('fixture-user', { ...x.game, id: 'another-game' }, id, report.id), /当前游戏/);
 await fs.appendFile(path.join(x.service.studio.toolchain.directory('fixture-user', id), report.id, 'compiled.zip'), 'changed');
 assert.equal((await x.post('studio/export', { id, buildId: report.id })).status, 400);
 x.service.studio.options.plan = async () => ({ ...creationPlan, kind: 'bepinex-plugin' });
 x.service.studio.options.generate = async () => ({ kind: 'bepinex-plugin', name: 'Bad C#', author: 'Fixture', code: 'public class Broken {' });
 const failed = await completeTurn(x, { message: 'Create a custom plugin.', mode: 'ai' });
 assert.equal(failed.toolchain.status, 'failed');
 assert.equal((await x.post('studio/read', { id: failed.artifactId })).body.toolchain.bundle, undefined);
 assert.equal(await fs.readdir(path.join(x.game.installPath, 'BepInEx')).then(names => names.includes('plugins')), false);
});

test('conversation installs, replaces its own revision, launches via the host and verifies only new loader evidence', async t => {
 const x = await fixture(t, { variant: 'unreal', studio: { runtimeObservationMs: 1, runtimePollMs: 1, plan: async () => creationPlan, generate: async () => ({ kind: 'ue4ss-lua', name: 'Lifecycle fixture', author: 'Fixture', code: runtimeLua('local value = 1') }) } });
 let thread = await completeTurn(x, { message: 'Create a Lua mod' }); assert.equal(thread.toolchain.status, 'passed');
 thread = await completeTurn(x, { id: thread.id, message: '安装' }); assert.equal(thread.status, 'completed', thread.error);
 let artifact = (await x.post('studio/read', { id: thread.artifactId })).body; assert.equal(artifact.deployment.status, 'installed');
 const first = artifact.id;
 thread = await completeTurn(x, { id: thread.id, message: '安装' }); assert.equal(x.service.installers.state.mods.length, 1);
 thread = await completeTurn(x, { id: thread.id, message: '改一下名称' });
 thread = await completeTurn(x, { id: thread.id, message: '安装' }); assert.equal(thread.status, 'completed', thread.error);
 artifact = (await x.post('studio/read', { id: thread.artifactId })).body; assert.notEqual(artifact.id, first); assert.equal(x.service.installers.state.mods.length, 1);
 x.game.appId = '12345'; let opened = 0;
 const log = path.join(x.game.installPath, 'Game/Binaries/Win64/ue4ss/UE4SS.log');
 await fs.writeFile(log, artifact.runtime.marker + '\n');
 x.service.installers.options.openGame = async uri => { assert.equal(uri, 'steam://rungameid/12345'); opened++; };
 thread = await completeTurn(x, { id: thread.id, message: '启动游戏并检查日志' }); assert.equal(thread.status, 'awaiting_runtime', thread.error); assert.equal(opened, 1);
 assert.equal((await x.post('studio/read', { id: artifact.id })).body.toolchain.runtime.status, 'unconfirmed');
 await fs.appendFile(log, artifact.runtime.marker + '\n');
 thread = await completeTurn(x, { id: thread.id, message: '检查本次运行' });
 assert.equal(thread.status, 'awaiting_runtime');
 assert.equal((await x.post('studio/read', { id: artifact.id })).body.toolchain.runtime.status, 'awaiting_trigger');
 await fs.appendFile(log, 'ERROR runtime failure\n'); await completeTurn(x, { id: thread.id, message: '检查日志' });
 assert.equal((await x.post('studio/read', { id: artifact.id })).body.toolchain.runtime.status, 'loader_error');
});
test('compiled model C# bootstrap installs genuine DLL bytes and permissions are rechecked before mutation', async t => {
 const x = await fixture(t, { variant: 'unity', studio: {
  runtimeObservationMs: 1, runtimePollMs: 1,
  plan: async () => ({ ...creationPlan, kind: 'bepinex-plugin' }),
  generate: async () => ({ kind: 'bepinex-plugin', name: 'Real compilation fixture', author: 'Fixture', entryPoint: 'Moddock.Generated.ModContent.Initialize', code: 'namespace Moddock.Generated { public static class ModContent { public static void Initialize() { UnityEngine.Application.targetFrameRate = 90; } } }' }),
 } });
 await require('./toolchain-fixture.cjs').monoFixture(x.game.installPath);
 let thread = await completeTurn(x, { message: 'Create a frame target plugin' }); assert.equal(thread.toolchain.status, 'passed', thread.error);
 thread = await completeTurn(x, { id: thread.id, message: '安装' }); assert.equal(thread.status, 'completed', thread.error);
 const artifact = (await x.post('studio/read', { id: thread.artifactId })).body, mod = x.service.installers.state.mods[0];
 assert.equal(mod.files.length, 1); assert.match(mod.files[0].destination, /^BepInEx\/plugins\/.*\.dll$/);
 const dll = await fs.readFile(path.join(mod.root, mod.files[0].destination)); assert.equal(require('../studio-toolchain.cjs').managedDll(dll), true);
 assert.equal(crypto.createHash('sha256').update(dll).digest('hex'), artifact.toolchain.outputs[0].sha256);
 x.game.appId = '12346';
 x.service.installers.options.openGame = async () => { await fs.writeFile(path.join(x.game.installPath, 'BepInEx/LogOutput.log'), artifact.runtime.marker + '\n'); };
 thread = await completeTurn(x, { id: thread.id, message: '启动游戏并检查日志' }); assert.equal(thread.status, 'awaiting_runtime', thread.error);
 assert.equal((await x.post('studio/read', { id: artifact.id })).body.toolchain.runtime.status, 'loader_loaded');
 let started = false; x.service.installers.options.openGame = async () => { started = true; };
 await assert.rejects(x.service.studio.options.lifecycle.launch({ owner: 'fixture-user', game: x.game, artifactId: artifact.id, current: () => true, authorize: async () => { throw Error('permission revoked'); } }), /permission revoked/); assert.equal(started, false);
 await fs.appendFile(path.join(mod.root, mod.files[0].destination), 'tamper');
 thread = await completeTurn(x, { id: thread.id, message: '启动游戏' }); assert.equal(thread.status, 'failed'); assert.equal(started, false);
});
test('a failed revision deployment restores the previous installed package and preserves unrelated mods', async t => {
 const x = await fixture(t, { studio: { plan: async () => ({ ...creationPlan, kind: 'dialogue' }), generate: async () => draft } });
 let thread = await completeTurn(x, { message: 'Create dialogue' });
 thread = await completeTurn(x, { id: thread.id, message: '安装' }); assert.equal(thread.status, 'completed', thread.error);
 const previous = structuredClone(x.service.installers.state.mods[0]);
 const oldContent = await fs.readFile(path.join(previous.root, previous.files[0].destination));
 thread = await completeTurn(x, { id: thread.id, message: 'Change the dialogue' });
 const prepare = x.service.installers.prepare.bind(x.service.installers); let rejected = false;
 x.service.installers.prepare = async (...args) => { if (!rejected && args[1] !== previous.jobId) { rejected = true; throw Error('injected deployment failure'); } return prepare(...args); };
 thread = await completeTurn(x, { id: thread.id, message: '安装' }); assert.equal(thread.status, 'failed'); assert.match(thread.error, /injected deployment failure/);
 assert.equal(x.service.installers.state.mods.length, 1); assert.equal(x.service.installers.state.mods[0].jobId, previous.jobId);
 assert.deepEqual(await fs.readFile(path.join(previous.root, previous.files[0].destination)), oldContent);
 await fs.access(path.join(x.game.installPath, 'Mods/ContentPatcher/manifest.json'));
 assert.equal(await fs.readFile(path.join(x.game.installPath, 'Saves/player.sav'), 'utf8'), 'preserve player save');
});
test('saving a completed Mod to the library is durable, idempotent and does not install or launch it', async t => {
 const x = await fixture(t), saved = (await x.post('studio/save', { draft })).body;
 assert.equal((await x.post('studio/library', { id: saved.id })).status, 400);
 await completeTurn(x, { artifactId: saved.id, message: '重新编译' });
 const [first, concurrent] = await Promise.all([x.post('studio/library', { id: saved.id }), x.post('studio/library', { id: saved.id })]); assert.equal(first.status, 200, JSON.stringify(first.body)); assert.deepEqual(concurrent.body, first.body);
 assert.equal(x.service.installers.state.mods.length, 0); assert.equal(x.service.installers.state.runs.length, 0);
 assert.equal(x.service.downloads.jobs.length, 1); assert.equal(x.service.downloads.jobs[0].import.status, 'ready');
 const again = await x.post('studio/library', { id: saved.id }); assert.deepEqual(again.body, first.body);
 assert.equal(x.service.downloads.jobs.length, 1);
 assert.deepEqual((await x.post('studio/read', { id: saved.id })).body.library, first.body);
 await assert.rejects(x.service.studio.options.lifecycle.keep({ owner: 'another-owner', game: x.game, artifactId: saved.id, current: () => true, authorize: async () => {} }), /当前账号/);
 x.account.updateAccount({ membership: { tier: 'standard' } }); assert.equal((await x.post('studio/library', { id: saved.id })).status, 403);
});
test('choosing a native game adds it once, retains it on rescan and never executes it', async t => {
 const root = await temp(t), file = path.join(root, 'New Game/game.exe'); await write(root, 'New Game/game.exe', 'MZ\0\0');
 const x = await fixture(t, { chooseStudioGame: async () => file });
 const chosen = await x.post('studio/games/add'); assert.equal(chosen.status, 200, JSON.stringify(chosen.body));
 assert.equal(chosen.body.game.name, 'New Game'); assert.equal(chosen.body.game.executable, 'game.exe');
 const again = await x.post('studio/games/add', { path: file }); assert.equal(again.body.game.id, chosen.body.game.id);
 assert.equal((await x.post('scan')).body.games.filter(game => game.id === chosen.body.game.id).length, 1);
 assert.equal(x.service.installers.state.runs.length, 0);
 const config = JSON.parse(await fs.readFile(path.join(x.root, 'data/settings.json'))); assert.equal(config.localGames.length, 1);
 assert.equal((await x.post('studio/games/add', { path: '../../etc' })).status, 400);
 await write(root, 'not-a-game.js', 'console.log("not executed")'); assert.equal((await x.post('studio/games/add', { path: path.join(root, 'not-a-game.js') })).status, 400);
 x.account.updateAccount({ membership: { tier: 'standard' } }); assert.equal((await x.post('studio/games/add', { path: file })).status, 403);
});
module.exports = { fixture, draft, texture };
