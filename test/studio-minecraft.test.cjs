const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const mods = require('../studio-game-mods.cjs'), mc = require('../studio-minecraft.cjs');
const { zipContent, pngBytes } = require('../content-pack.cjs');
function draft(kind, version = '1.21.4') {
 return { kind, targetVersion: version, name: 'Minecraft fixture', author: 'Fixture', files: kind === 'minecraft-datapack' ? [
  { name: 'data/__MODDOCK_ID__/function/load.mcfunction', text: 'tellraw @a {"text":"Fixture loaded"}' },
  { name: 'data/__MODDOCK_ID__/function/tick.mcfunction', text: '# Real source, static fixture\nexecute as @a run effect give @s minecraft:speed 1 0 true' },
 ] : [
  { name: 'assets/minecraft/lang/zh_cn.json', text: '{"item.minecraft.apple":"测试苹果"}' },
  { name: 'assets/minecraft/textures/item/apple.png.json', text: JSON.stringify({ palette: { '.': '#00000000', X: '#ff0000ff' }, rows: Array.from({ length: 16 }, (_, i) => (i % 2 ? 'X.' : '.X').repeat(8)) }) },
 ] };
}
async function fixture(t) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'minecraft-adapter-')), instance = path.join(root, 'custom-instance');
 t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 3 }));
 const dir = path.join(instance, 'versions/1.21.4'); await fs.mkdir(dir, { recursive: true });
 await fs.writeFile(path.join(dir, '1.21.4.json'), JSON.stringify({ id: '1.21.4', mainClass: 'net.minecraft.client.main.Main', accessToken: 'must-not-be-shared' }));
 await fs.writeFile(path.join(dir, '1.21.4.jar'), zipContent([{ name: 'version.json', data: Buffer.from('{"id":"1.21.4"}') }]));
 await fs.mkdir(path.join(instance, 'saves/world'), { recursive: true }); await fs.writeFile(path.join(instance, 'saves/world/level.dat'), 'preserve');
 await fs.writeFile(path.join(instance, 'options.txt'), 'resourcePacks:[]');
 return { root, instance, game: await require('../studio-games.cjs').resolveStudioGame(instance) };
}
test('Minecraft Java instance detection uses version and JAR evidence and excludes private launcher metadata', async t => {
 const x = await fixture(t); assert.equal(x.game.name, 'Minecraft Java');
 assert.equal((await require('../game-diagnostics.cjs').diagnoseGame(x.game)).engine.key, 'minecraft-java');
 const docs = await mc.evidence(x.instance); assert.equal(docs.length, 1); assert.ok(!JSON.stringify(docs).includes('must-not-be-shared'));
 await fs.writeFile(path.join(x.instance, 'launcher.exe'), require('./bg3-extender-fixture.cjs').executable);
 assert.equal((await require('../studio-games.cjs').resolveStudioGame(x.instance)).name, 'Minecraft Java');
 const unrelated = path.join(x.root, 'not-a-game'); await fs.mkdir(unrelated);
 await assert.rejects(require('../studio-games.cjs').resolveStudioGame(unrelated));
 await fs.writeFile(path.join(x.instance, 'versions/1.21.4/1.21.4.jar'), 'fake'); await assert.rejects(mc.evidence(x.instance), /JAR/);
 assert.equal(mods.matches('minecraft-datapack', { name: 'Minecraft Bedrock' }), false);
 assert.equal(mods.matches('minecraft-resourcepack', { name: 'Minecraft Dungeons' }), false);
});
test('version-specific native packs have root metadata, function tags and real PNG bytes', () => {
 for (const version of Object.keys(mc.VERSIONS)) for (const kind of ['minecraft-datapack', 'minecraft-resourcepack']) {
  const built = mods.build(draft(kind, version), '00000000-0000-4000-8000-000000000000');
  const entries = mods.exportFiles(built, built.files.map(file => ({ name: file.name, ...(file.name.endsWith('.png') ? { image: 'data:image/png;base64,' + file.data.toString('base64') } : { text: file.data.toString() }) })));
  assert.equal(JSON.parse(entries.find(file => file.name === 'pack.mcmeta').data).pack.pack_format, mc.VERSIONS[version][kind === 'minecraft-datapack' ? 'data' : 'resource']);
  assert.ok(entries.every(file => !file.name.startsWith('mod/')));
  if (kind === 'minecraft-datapack') {
   assert.ok(entries.some(file => file.name === 'data/minecraft/tags/function/load.json'));
   assert.ok(entries.some(file => file.name === 'data/minecraft/tags/function/tick.json'));
  } else assert.equal(pngBytes('data:image/png;base64,' + entries.find(file => file.name.endsWith('.png')).data.toString('base64')).readUInt32BE(16), 16);
 }
});
test('Minecraft rejects unknown versions, legacy paths, host metadata overrides, invalid JSON and incomplete commands', () => {
 assert.throws(() => mods.build(draft('minecraft-datapack', '99.1'), 'a'), /包格式/);
 assert.throws(() => mods.build({ ...draft('minecraft-resourcepack', '1.21'), files: [{ name: 'assets/minecraft/items/apple.json', text: '{}' }] }, 'a'), /items/);
 const bad = (name, text) => mods.dataSources('minecraft-datapack', [{ name, text }]);
 assert.throws(() => bad('data/__MODDOCK_ID__/functions/load.mcfunction', 'say no'), /单数/);
 assert.throws(() => bad('pack.mcmeta', '{}'), /仅接受/);
 assert.throws(() => bad('data/__MODDOCK_ID__/function/load.mcfunction', '/say no'), /前缀/);
 assert.throws(() => bad('data/__MODDOCK_ID__/function/load.mcfunction', 'tellraw @a {"text":"unfinished}'), /未闭合/);
 assert.throws(() => mods.dataSources('minecraft-resourcepack', [{ name: 'assets/minecraft/lang/zh_cn.json', text: '{"a":1}' }]), /字符串/);
 assert.throws(() => mods.dataSources('minecraft-resourcepack', [{ name: 'assets/minecraft/textures/item/apple.png.json', text: '{"palette":{},"rows":[]}' }]), /16/);
});
for (const kind of ['minecraft-datapack', 'minecraft-resourcepack']) test(kind + ' source authoring, REST export and installation policy', async t => {
 const x = await fixture(t), account = require('./account-fixture.cjs').accountFixture(); account.updateAccount({ membership: { tier: 'pro', expiresAt: null } });
 const service = await require('./server-fixture.cjs').createServer({ root: path.join(x.root, 'service'), port: 0, accounts: account.options, scan: async () => ({ games: [x.game], roots: [], diagnostics: [] }), installers: { processes: async () => [] }, studio: { integration: { python: false } } });
 t.after(async () => { await new Promise(resolve => service.server.close(resolve)); await service.studio.conversations.settle(); await service.downloads.persist; });
 const login = await require('./server-fixture.cjs').loginFixture(service);
 const post = async (route, value) => { const result = await login.fetch(service.url + '/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': login.state.token }, body: JSON.stringify({ gameId: x.game.id, ...value }) }); return { status: result.status, body: await result.json() }; };
 const workspace = await require('../studio-authoring.cjs').createAuthoringWorkspace({ kind }); t.after(() => workspace.close());
 for (const file of draft(kind).files) await workspace.write(file.name, file.text);
 assert.equal((await workspace.validate()).passed, true);
 const source = await workspace.artifact(draft(kind));
 const saved = await post('studio/save', { draft: source }); assert.equal(saved.status, 200, JSON.stringify(saved.body));
 const report = await service.studio.toolchain.run('fixture-user', x.game, saved.body.id, await service.studio.workspace(x.game));
 assert.equal(report.status, 'passed', JSON.stringify(report)); assert.ok(report.bundle);
 const exported = await post('studio/export', { id: saved.body.id }); assert.equal(exported.status, 200);
 const bytes = Buffer.from(exported.body.base64, 'base64');
 assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'), report.bundle.sha256);
 const target = path.join(x.root, 'export.zip'); await fs.writeFile(target, bytes);
 const unpacked = await require('../installers.cjs').extract(target, path.join(x.root, 'expanded'));
 assert.ok(unpacked.some(file => file.source === 'pack.mcmeta'));
 const read = await service.studio.read('fixture-user', saved.body.id);
 assert.equal(read.installable, kind === 'minecraft-resourcepack');
 const prepared = await post('studio/prepare', { id: saved.body.id });
 if (kind === 'minecraft-datapack') { assert.notEqual(prepared.status, 200); assert.match(prepared.body.error, /目标世界|存档/); }
 else {
  assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
  assert.ok(prepared.body.files.every(file => file.destination.startsWith('resourcepacks/' + read.manifest.UniqueID + '/')));
  const installed = await post('installations/apply', { id: prepared.body.id }); assert.equal(installed.status, 200, JSON.stringify(installed.body));
  for (const action of ['verify', 'disable', 'enable', 'uninstall']) assert.equal((await post('installations/action', { id: installed.body.id, action })).status, 200);
 }
 assert.equal(await fs.readFile(path.join(x.instance, 'saves/world/level.dat'), 'utf8'), 'preserve');
 assert.equal(await fs.readFile(path.join(x.instance, 'options.txt'), 'utf8'), 'resourcePacks:[]');
 const blocked = await service.studio.save('fixture-user', x.game, draft(kind, '1.21.6'));
 const mismatch = await service.studio.toolchain.run('fixture-user', x.game, blocked.id, await service.studio.workspace(x.game)); assert.equal(mismatch.status, 'blocked');
});
