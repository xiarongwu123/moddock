const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { NativeProjects } = require('../studio-native-projects.cjs');
const { diagnoseGame } = require('../game-diagnostics.cjs');
const { collectEngineEvidence } = require('../studio-engines.cjs');
const { materializeNativePatch } = require('../studio-native-patch.cjs');
const { readPck } = require('../studio-godot.cjs');
const { target } = require('../installers.cjs');
const { runTool } = require('../studio-tools.cjs');
const { scriptsRead, marshalWrite, archiveRead, archiveWrite } = require('../studio-rgss.cjs');
const zlib = require('node:zlib');
const root = path.resolve(process.env.MODDOCK_NATIVE_ENGINE_OUTPUT || 'output/native-toolchains/engine-builds');
const native = new NativeProjects({ directory: path.resolve('.moddock-tools'), archiveDirectory: path.resolve('output/native-toolchains') });
const results = [];
async function build(name, setup, draft) {
 const directory = path.join(root, name); await fs.rm(directory, { recursive: true, force: true }); await fs.mkdir(directory, { recursive: true });
 await setup(directory);
 const game = { id: name, name, installPath: directory }, diagnostic = await diagnoseGame(game);
 const original = await collectEngineEvidence(game, diagnostic);
 await native.prepare(game, original, { diagnostic });
 const evidence = await native.snapshot(game, original);
 const input = typeof draft === 'function' ? draft(evidence) : draft;
 const work = path.join(directory, 'build'); await fs.mkdir(work);
 const result = await native.build(game, { manifest: { UniqueID: 'Moddock123abc' }, draft: input }, evidence, { work });
 assert(result.passed, JSON.stringify(result));
 const stage = path.join(directory, 'package'); await fs.mkdir(stage);
 for (const file of result.outputs) { await fs.mkdir(path.dirname(path.join(stage, file.name)), { recursive: true }); await fs.writeFile(path.join(stage, file.name), file.data); }
 const files = await materializeNativePatch(directory, stage, result, target);
 assert.equal(files.length, 1); const bytes = await fs.readFile(path.join(stage, files[0].source));
 const entry = { name, mode: evidence.mode, checks: result.checks, inputBytes: (await fs.stat(path.join(directory, evidence.native.target))).size, patchBytes: result.outputs.reduce((sum, file) => sum + file.data.length, 0), sha256: files[0].sha256 };
 results.push(entry); await fs.writeFile(path.join(root, 'verification.json'), JSON.stringify({ created: new Date().toISOString(), results }, null, 2));
 console.log(name + ': ' + evidence.mode + ' compiled / native readback / delta install passed');
 return { bytes, directory, evidence };
}
async function main() {
 await fs.mkdir(root, { recursive: true });
 const row = (id, name, code) => [id, { bytes: Buffer.from(name) }, { bytes: zlib.deflateSync(Buffer.from(code)) }];
 const database = marshalWrite([row(1, 'Game_Player', 'class Game_Player\n def damage\n 10\n end\nend'), row(2, 'Main', 'raise "damage" unless Game_Player.new.damage == 25\nputs "RGSS_EFFECT=25"')]);
 for (const [ext, version] of process.env.MODDOCK_NATIVE_ONLY_GODOT ? [] : [['rxdata', 1], ['rvdata', 1], ['rvdata2', 3]]) {
  const result = await build('rgss-' + ext, async directory => {
   const names = ['Data/Scripts.' + ext, 'Graphics/unchanged.png'];
   const entries = names.map((name, i) => ({ name, nameBytes: Buffer.from(name.replaceAll('/', '\\')), key: 0x12345678 + i, encrypted: Buffer.alloc(0), length: 0 }));
   const archive = { version, seed: 42, entries, read: () => Buffer.alloc(0) };
   const buffer = archiveWrite(archive, new Map([[names[0], database], [names[1], Buffer.from('unchanged asset')]]));
   await fs.writeFile(path.join(directory, version === 3 ? 'Game.rgss3a' : ext === 'rxdata' ? 'Game.rgssad' : 'Game.rgss2a'), buffer);
  }, { mode: 'rpgmaker-rgss', files: [{ name: 'main.rb', text: 'class Game_Player\n alias moddock_damage damage\n def damage\n  moddock_damage + 15\n end\nend' }] });
  const archive = archiveRead(result.bytes), scripts = scriptsRead(archive.read(archive.entries[0]));
  const program = path.join(result.directory, 'verified-scripts.rb'); await fs.writeFile(program, scripts.map(entry => entry.source).join('\n'));
  const ruby = await runTool('/usr/bin/ruby', [program]); assert.equal(ruby.code, 0, ruby.output); assert.match(ruby.output, /RGSS_EFFECT=25/);
 }
 if (!process.env.MODDOCK_NATIVE_ONLY_GODOT) { const gm = await build('gamemaker-vm', async directory => {
  const data = path.join(directory, 'data.win'), blank = path.join(directory, 'blank.win');
  await native.tools.run('umt', ['new', '-o', blank], { cwd: directory });
  const log = await native.tools.run('umt', ['load', blank, '-s', path.resolve('test/native-fixture.csx'), '-o', data], { cwd: directory });
  assert.equal(await fs.readFile(path.join(directory, 'fixture-compiled.txt'), 'utf8').catch(() => log), 'ok'); await fs.rm(blank);
 }, evidence => {
  const doc = evidence.documents.find(doc => doc.entry === 'gml_Object_obj_player_Create_0'); assert(doc?.complete);
  return { mode: 'gamemaker-gml', files: [{ name: 'main.gml', text: doc.text.replace(/damage = 10/, 'damage = 25') }], targets: [{ source: 'main.gml', entry: doc.entry, sha256: doc.sha256 }] };
 });
 assert(gm.bytes.length > 8); }
 for (const version of (process.env.MODDOCK_NATIVE_GODOT_VERSIONS || '3.6.1,4.4.1').split(',')) {
  const result = await build('godot-' + version, async directory => {
   const project = path.join(directory, 'project'); await fs.mkdir(project);
   await fs.writeFile(path.join(project, 'project.godot'), 'config_version=' + (version[0] === '3' ? '4' : '5') + '\n[application]\nconfig/name="NativeFixture"\nrun/main_scene="res://main.tscn"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
   await fs.writeFile(path.join(project, 'main.tscn'), '[gd_scene load_steps=2 format=2]\n[ext_resource path="res://player.gd" type="Script" id=1]\n[node name="Player" type="Node"]\nscript = ExtResource( 1 )\n');
   await fs.writeFile(path.join(project, 'player.gd'), 'extends Node\nvar damage = 10\nfunc _ready():\n call_deferred("verify")\nfunc verify():\n print("GODOT_EFFECT=", damage)\n get_tree().quit(0 if damage == 25 else 1)\n');
   const executable = await native.tools.ensureGodot(version);
   const config = await runTool(executable, [version[0] === '3' ? '--no-window' : '--headless', '--path', project, '--script', path.resolve('test/godot-binary-config.gd')], { cwd: project }); assert.equal(config.code, 0, config.output);
   await fs.rm(path.join(project, 'project.godot'));
   await native.tools.run('gdre', ['--headless', '--compile=' + path.join(project, 'player.gd'), '--bytecode=' + version, '--output=' + project], { cwd: project });
   await fs.rm(path.join(project, 'player.gd')); await fs.writeFile(path.join(project, 'player.gd.remap'), '[remap]\npath="res://player.gdc"\n');
   await native.tools.run('gdre', ['--headless', '--pck-create=' + project, '--pck-version=' + (version[0] === '3' ? '1' : Number(version.split('.')[1]) >= 5 ? '3' : '2'), '--pck-engine-version=' + version, '--output=' + path.join(directory, 'game.pck')], { cwd: directory });
   await fs.rm(project, { recursive: true });
  }, { mode: 'godot-gdscript', files: [{ name: 'main.gd', text: 'extends Node\nfunc _ready():\n get_tree().connect("node_added", ' + (version[0] === '3' ? 'self, "_on_node"' : 'Callable(self, "_on_node")') + ')\n for child in get_tree().root.get_children():\n  _on_node(child)\nfunc _on_node(node):\n if str(node.name) == "Player":\n  node.damage = 25\n' }] });
  assert(readPck(result.bytes).files.has('moddock/Moddock123abc/main.gdc'));
  const pack = path.join(result.directory, 'modified.pck'); await fs.writeFile(pack, result.bytes);
  const executable = await native.tools.ensureGodot(version);
  const run = await runTool(executable, [version[0] === '3' ? '--no-window' : '--headless', '--main-pack', pack], { cwd: result.directory, timeout: 30000 });
  assert.equal(run.code, 0, run.output); assert.match(run.output, /GODOT_EFFECT=25/); results.at(-1).runtime = 'native Godot ' + version + ' changed gameplay variable to 25';
 }
 await fs.writeFile(path.join(root, 'verification.json'), JSON.stringify({ created: new Date().toISOString(), results, windowsDeviceTested: false }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
