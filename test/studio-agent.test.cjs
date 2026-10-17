const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { checkLua } = require('../studio-lua.cjs');
const { apiSearch, checkReferences } = require('../studio-agent.cjs');
const { buildBG3, readModule } = require('../bg3-mod.cjs');
const { validateControls, valuesFor } = require('../bg3-controls.cjs');
const { runTool } = require('../studio-tools.cjs');
const { createServer, loginFixture } = require('./server-fixture.cjs');
const { accountFixture } = require('./account-fixture.cjs');
const { createDeepSeek } = require('../studio-ai.cjs');
const { dll } = require('./bg3-extender-fixture.cjs');
const { piFixture } = require('./pi-fixture.cjs');

const controls = [{ key: 'threshold', label: 'Threshold', type: 'number', min: 10, max: 90, step: 5, default: 40 }, { key: 'heal', label: 'Heal', type: 'action', shortcut: 'F8' }];
const draft = { kind: 'bg3-lua', name: 'Healing control', author: 'Player', description: 'User-requested healing controls', controls, code: 'Moddock.OnAction = function(key, settings)\n local host = Osi.GetHostCharacter()\n if key == "heal" and host then Osi.SetHitpoints(host, Osi.GetMaxHitpoints(host), "") end\nend' };
const plan = { title: 'Healing control', summary: 'Requested gameplay controls.', kind: 'bg3-lua', steps: ['Inspect game APIs', 'Build and verify Lua'], requirements: ['BG3 Script Extender'] };
async function fixture(t) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-agent-')), game = { id: 'steam-1086940', appId: '1086940', name: '博德之门 3 [TEST]', installPath: path.join(root, 'BG3'), platform: 'Steam', real: true };
 const userData = path.join(root, 'userdata');
 await fs.mkdir(path.join(game.installPath, 'bin'), { recursive: true }); await fs.writeFile(path.join(game.installPath, 'bin/DWrite.dll'), dll);
 await fs.mkdir(path.join(userData, 'Mods'), { recursive: true }); await fs.mkdir(path.join(userData, 'PlayerProfiles/Public'), { recursive: true });
 await fs.writeFile(path.join(userData, 'PlayerProfiles/Public/modsettings.lsx'), '<save><region id="ModuleSettings"><node id="root"><children><node id="Mods"><children><node id="ModuleShortDesc"><attribute id="UUID" type="FixedString" value="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"/><attribute id="Folder" type="LSString" value="GustavDev"/></node></children></node></children></node></region></save>');
 const account = accountFixture(); account.updateAccount({ membership: { tier: 'pro', expiresAt: null } });
 const pi = await piFixture(t, { game, engine: 'native', result: body => body.messages[0].content.includes('This is the artifact generation stage') ? draft : plan });
 const steps = pi.requests;
 const server = await createServer({ root: path.join(root, 'data'), port: 0, accounts: account.options, scan: async () => ({ games: [game], roots: [], diagnostics: [] }), installers: { bg3DataPath: userData, processes: async () => [] },
  studio: { ...createDeepSeek({ apiKey: pi.key, pi: pi.pi }), tools: { luac: false }, integration: { python: false } } });
 const auth = await loginFixture(server);
 const post = async (route, body = {}) => {
  const response = await auth.fetch(server.url + '/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': auth.state.token }, body: JSON.stringify({ gameId: game.id, ...body }) });
  return { status: response.status, body: await response.json() };
 };
 const turn = async (message, id) => { const accepted = await post('studio/conversations/send', { message, id }); assert.equal(accepted.status, 202, JSON.stringify(accepted.body)); await server.studio.conversations.settle(); return (await post('studio/conversations/read', { id: accepted.body.id })).body; };
 t.after(async () => { server.studio.cancelOwner('fixture-user'); await server.studio.conversations.settle(); server.server.closeAllConnections(); await new Promise(resolve => server.server.close(resolve)); await server.downloads.persist; await fs.rm(root, { recursive: true, force: true }); });
 return { server, auth, root, game, userData, steps, post, turn };
}
test('portable Lua compiles without running source and returns actual syntax errors', async () => {
 assert.equal((await checkLua('while true do end')).passed, true);
 assert.equal((await checkLua('error("MUST NOT EXECUTE")')).passed, true);
 const broken = await checkLua('local broken = function('); assert.equal(broken.passed, false); assert.match(broken.detail, /Moddock:1/);
 const lookup = await apiSearch('Osi.GetMaxHitpoints'); assert.ok(lookup.matches.some(item => item.text.includes('function Osi.GetMaxHitpoints(entity)')));
 await assert.rejects(apiSearch('../private\nsecret'));
 await assert.rejects(checkReferences('Ext.NotARealAPI("x")'), /尚无/);
 await assert.rejects(checkReferences('pcall(Ext.Vars.GetModVariables, "FakeMod")'), /尚无/);
 await assert.rejects(checkReferences('Moddock.NotARealHelper()'), /尚无/);
 assert.deepEqual(await checkReferences('-- Ext.Fictional()\nOsi.SetHitpoints("character", 20, "")'), ['Osi.SetHitpoints']);
});
test('parameter schemas reject duplicates, arbitrary keys, invalid ranges and unsupported shortcuts', () => {
 assert.deepEqual(valuesFor(validateControls(controls), {}), { threshold: 40 });
 for (const invalid of [[controls[0], controls[0]], [{ ...controls[0], step: 0 }], [{ ...controls[1], shortcut: 'Ctrl+R' }], [{ ...controls[0], key: '../path' }]]) assert.throws(() => validateControls(invalid));
 assert.throws(() => valuesFor(controls, { threshold: 41 }), /范围/); assert.throws(() => valuesFor(controls, { threshold: 100 }), /范围/); assert.throws(() => valuesFor(controls, { private: 1 }), /无效/);
});
test('real Pi tools create a portable BG3 build and settings wait for exact game acknowledgement', async t => {
 const x = await fixture(t), thread = await x.turn('按 F8 恢复生命，并提供参数滑条');
 assert.equal(thread.status, 'completed', thread.error);
 for (const name of ['write_project_file', 'validate_project']) assert.ok(thread.toolCalls.some(call => call.name === name && call.status === 'completed'));
 assert.ok(thread.toolCalls.some(call => call.name === 'search_api' && call.status === 'completed')); assert.ok(thread.toolCalls.some(call => call.name === 'submit_result' && call.status === 'completed')); assert.equal(thread.harness.status, 'completed');
 const saved = (await x.post('studio/read', { id: thread.artifactId })).body; assert.equal(saved.installable, true); assert.equal(saved.toolchain.status, 'passed'); assert.ok(saved.toolchain.checks.some(check => /WebAssembly/.test(check.detail)));
 const exported = (await x.post('studio/export', { id: saved.id })).body; assert.ok(Buffer.from(exported.base64, 'base64').includes(Buffer.from('BootstrapClient.lua')));
 const installed = await x.turn('安装', thread.id); assert.equal(installed.status, 'completed', installed.error);
 const read = await x.post('studio/controls', { id: saved.id }); assert.equal(read.status, 200); assert.equal(read.body.runtime.status, 'pending');
 const changed = await x.post('studio/controls/update', { id: saved.id, operation: 'settings', enabled: true, values: { threshold: 60 }, revision: read.body.revision }); assert.equal(changed.status, 200); assert.equal(changed.body.runtime.status, 'pending');
 const stale = await x.post('studio/controls/update', { id: saved.id, operation: 'settings', enabled: true, values: { threshold: 40 }, revision: read.body.revision }); assert.equal(stale.status, 400);
 const invalid = await x.post('studio/controls/update', { id: saved.id, operation: 'settings', enabled: true, values: { threshold: 999 }, revision: changed.body.revision }); assert.equal(invalid.status, 400);
 const root = path.join(x.userData, saved.runtime.control.root);
 await fs.writeFile(path.join(root, 'state.json'), JSON.stringify({ revision: 'old', status: 'applied' })); assert.equal((await x.post('studio/controls', { id: saved.id })).body.runtime.status, 'pending');
 await fs.writeFile(path.join(root, 'state.json'), JSON.stringify({ revision: changed.body.revision, status: 'applied' })); assert.equal((await x.post('studio/controls', { id: saved.id })).body.runtime.status, 'applied');
 const action = await x.post('studio/controls/update', { id: saved.id, operation: 'action', action: 'heal' }); assert.equal(action.status, 200); assert.equal(action.body.status, 'pending');
 await fs.writeFile(path.join(root, 'ack.json'), JSON.stringify({ nonce: 'old', status: 'applied' })); assert.equal((await x.post('studio/controls/action-status', { id: saved.id, nonce: action.body.nonce })).body.status, 'pending');
 await fs.writeFile(path.join(root, 'ack.json'), JSON.stringify({ nonce: action.body.nonce, status: 'applied' })); assert.equal((await x.post('studio/controls/action-status', { id: saved.id, nonce: action.body.nonce })).body.status, 'applied');
 await assert.rejects(x.server.studio.read('another-owner', saved.id));
 await fs.rm(path.join(root, 'state.json')); await fs.symlink(path.join(root, 'settings.json'), path.join(root, 'state.json')); assert.equal((await x.post('studio/controls', { id: saved.id })).status, 400);
});
test('host Lua transport handles reloads, settings validation, disabled actions and hotkeys without duplicate actions', async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bg3-control-contract-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
 const built = buildBG3(draft, '11111111-1111-4111-8111-111111111111', (name, text) => ({ name, data: Buffer.from(text) }));
 const files = built.files.filter(file => file.name.endsWith('.lua'));
 for (const [index, file] of files.entries()) await fs.writeFile(path.join(root, index + '.lua'), file.data);
 const result = await runTool(path.resolve('.moddock-tools/bin/lua'), [path.resolve('test/bg3-controls-sandbox.lua'), path.join(root, '0.lua'), path.join(root, '1.lua')]);
 assert.equal(result.code, 0, result.output); assert.match(result.output, /control contract passed/);
});
test('API reference utilities are shared with the Pi harness', async () => {
 const direct = require('../studio-api.cjs'); assert.equal(apiSearch, direct.apiSearch); assert.equal(checkReferences, direct.checkReferences);
});
