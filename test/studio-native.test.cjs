const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { zipContent } = require('../content-pack.cjs');
const { Installers, target } = require('../installers.cjs');
const rgss = require('../studio-rgss.cjs');
const { createNativePatch, originalBytes } = require('../studio-native-patch.cjs');
const { checkRuby } = require('../studio-ruby.cjs');
const { normalizeEngineDraft, validateEngineDraft } = require('../studio-engines.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
test('Godot tail-directory pack formats retain data bounds and reject directory overlap', () => {
 const { readPck } = require('../studio-godot.cjs'), content = Buffer.from('actual asset'), name = Buffer.from('res://asset.txt\0');
 for (const format of [3, 4]) {
  const directory = 128 + content.length, header = Buffer.alloc(128), index = Buffer.alloc(4 + 4 + name.length + 8 + 8 + 16 + 4);
  header.write('GDPC'); header.writeUInt32LE(format, 4); header.writeUInt32LE(4, 8); header.writeUInt32LE(5, 12); header.writeUInt32LE(2, 16); header.writeUInt32LE(2, 20); header.writeBigUInt64LE(128n, 24); header.writeBigUInt64LE(BigInt(directory), 32);
  index.writeUInt32LE(1, 0); index.writeUInt32LE(name.length, 4); name.copy(index, 8); index.writeBigUInt64LE(BigInt(content.length), 8 + name.length + 8); crypto.createHash('md5').update(content).digest().copy(index, 8 + name.length + 16);
  const bytes = Buffer.concat([header, content, index]); assert(readPck(bytes).files.get('asset.txt').data.equals(content));
  const tail = Buffer.alloc(12); tail.writeBigUInt64LE(BigInt(bytes.length)); tail.write('GDPC', 8);
  const embedded = readPck(Buffer.concat([Buffer.alloc(256), bytes, tail])); assert.equal(embedded.start, 256); assert(embedded.files.get('asset.txt').data.equals(content));
  const corrupt = Buffer.from(bytes); corrupt.writeBigUInt64LE(BigInt(bytes.length + 1), 32); assert.throws(() => readPck(corrupt), /目录偏移/);
 }
});
async function fixture(t) {
 const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-mod-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
 const root = path.join(directory, 'game'); await fs.mkdir(root); return { directory, root, game: { id: 'native-test', name: 'Native game', installPath: root } };
}
test('Ruby Marshal preserves encodings and shared objects and can be read by independent MRI', () => {
 const shared = { bytes: Buffer.from('shared'), ivars: [[{ symbol: 'E' }, true]] }, values = [0, 1, 122, 123, 255, 256, 65536, -1, -123, -124, -256, -65536, 2147483647, -2147483648];
 const object = [...values, shared, shared], bytes = rgss.marshalWrite(object), read = rgss.marshalRead(bytes);
 assert.deepEqual(read.slice(0, values.length), values); assert.equal(read.at(-1), read.at(-2));
 const result = spawnSync('/usr/bin/ruby', ['-e', 'a=Marshal.load(STDIN.read); raise "reference" unless a[-1].equal?(a[-2]); puts a[0...-2].join(",")'], { input: bytes, encoding: 'utf8' });
 assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), values.join(','));
 assert.throws(() => rgss.marshalRead(Buffer.from([4, 8, 111])), /不支持/);
 assert.throws(() => rgss.marshalRead(bytes.subarray(0, -1)), /越界/);
});
test('portable Ruby compiles actual code without evaluating it and reports native syntax failures', async () => {
 const good = await checkRuby('raise "must never run"\nclass Game_Player\n alias old_damage damage\n def damage\n old_damage + 15\n end\nend'); assert.equal(good.passed, true);
 const bad = await checkRuby('class Game_Player\n def damage(\n end'); assert.equal(bad.passed, false); assert.match(bad.detail, /syntax|Syntax/i);
});
test('native modes bind GML entries to real complete source evidence and reject mismatched entrypoints', () => {
 const source = 'damage = 10;', evidence = { mode: 'gamemaker-gml', native: { target: 'data.win' }, documents: [{ entry: 'gml_Object_Player_Create_0', complete: true, sha256: hash(source), text: source }] };
 const draft = { mode: 'gamemaker-gml', files: [{ name: 'main.gml', text: 'damage = 25;' }], targets: [{ source: 'main.gml', entry: evidence.documents[0].entry, sha256: hash(source) }] };
 assert(validateEngineDraft(draft, evidence).passed);
 assert.throws(() => validateEngineDraft({ ...draft, targets: [{ ...draft.targets[0], entry: 'invented' }] }, evidence), /完整/);
 assert.throws(() => normalizeEngineDraft({ ...draft, targets: [draft.targets[0], draft.targets[0]] }), /GML/);
 assert.throws(() => normalizeEngineDraft({ mode: 'unity-il2cpp', files: [{ name: 'main.rb', text: 'puts 1' }] }), /main.cs/);
});
test('native delta installs, disables, enables and restores through existing transactions; wrong game versions are refused', async t => {
 const x = await fixture(t), before = Buffer.concat([Buffer.alloc(32768, 7), Buffer.from('damage=10')]), after = Buffer.concat([Buffer.alloc(32768, 7), Buffer.from('damage=25')]);
 const bundle = await createNativePatch([{ path: 'data.win', before, after }], 'gamemaker-gml'); assert(bundle.outputs.reduce((n, f) => n + f.data.length, 0) < 2048);
 const archive = path.join(x.directory, 'mod.zip'); await fs.writeFile(archive, zipContent(bundle.outputs)); await fs.writeFile(path.join(x.root, 'data.win'), before);
 const job = { id: 'native-job', gameId: x.game.id, status: 'completed', name: 'Native Mod', sha256: hash(await fs.readFile(archive)) };
 const manager = await new Installers(path.join(x.directory, 'installer'), { jobs: [job], completedFile: async () => ({ file: archive, name: 'mod.zip' }) }, { processes: async () => [] }).open();
 const rule = { mode: 'native', baseHashes: bundle.baseHashes, nativeManifestSha256: bundle.nativeManifestSha256 };
 const plan = await manager.prepare(x.game, job.id, rule); assert.equal(plan.files.length, 1); assert.equal(plan.files[0].destination, 'data.win');
 const mod = await manager.apply(x.game, plan.id, true); assert((await fs.readFile(path.join(x.root, 'data.win'))).equals(after));
 const base = await originalBytes(x.root, 'data.win', mod, manager.root); assert(base.current.equals(after)); assert(base.original.equals(before));
 await manager.action(x.game, mod.id, 'disable'); assert((await fs.readFile(path.join(x.root, 'data.win'))).equals(before));
 await manager.action(x.game, mod.id, 'enable'); assert((await fs.readFile(path.join(x.root, 'data.win'))).equals(after));
 await manager.action(x.game, mod.id, 'uninstall'); assert((await fs.readFile(path.join(x.root, 'data.win'))).equals(before));
 await fs.writeFile(path.join(x.root, 'data.win'), Buffer.from('different game version'));
 await assert.rejects(manager.prepare(x.game, job.id, rule), /版本已变化/);
 assert.equal(await fs.readFile(path.join(x.root, 'data.win'), 'utf8'), 'different game version');
});
test('native reconstruction rejects tampered deltas, unsafe targets and linked game resources before writing', async t => {
 const x = await fixture(t), before = Buffer.from('original bytes'), after = Buffer.from('new actual native bytes'), bundle = await createNativePatch([{ path: 'data.win', before, after }], 'gamemaker-gml');
 const stage = path.join(x.directory, 'stage'); await fs.mkdir(stage);
 for (const file of bundle.outputs) { await fs.mkdir(path.dirname(path.join(stage, file.name)), { recursive: true }); await fs.writeFile(path.join(stage, file.name), file.data); }
 await fs.writeFile(path.join(x.root, 'data.win'), before);
 await fs.writeFile(path.join(stage, 'patches/0.delta'), Buffer.from('corrupt'));
 const { materializeNativePatch } = require('../studio-native-patch.cjs');
 await assert.rejects(materializeNativePatch(x.root, stage, bundle, target), /摘要|长度/);
 await fs.rm(path.join(x.root, 'data.win')); await fs.symlink(path.join(stage, 'MODDOCK-NATIVE.json'), path.join(x.root, 'data.win'));
 await assert.rejects(materializeNativePatch(x.root, stage, bundle, target), /链接/);
 await assert.rejects(createNativePatch([{ path: '../saves/file', before, after }], 'gamemaker-gml'), /路径/);
});
