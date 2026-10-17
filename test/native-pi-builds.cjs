const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const application = path.resolve(process.env.MODDOCK_NATIVE_PACKAGE || '.'), load = name => require(path.join(application, name));
const { ModStudio } = load('mod-studio.cjs'), { Downloads } = load('downloads.cjs'), { Installers } = load('installers.cjs');
const { ModLibrary } = load('library.cjs'), { StudioLifecycle } = load('studio-lifecycle.cjs'), { GameEnvironment } = load('game-environment.cjs');
const { runTool } = load('studio-tools.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function main() {
 const output = path.resolve(process.env.MODDOCK_NATIVE_VERIFY_OUTPUT || 'output/native-toolchains/pi-builds'); await fs.mkdir(output, { recursive: true }); const results = [];
 for (const name of ['godot', 'gamemaker', 'rgss', 'il2cpp']) {
  const source = JSON.parse(await fs.readFile(path.resolve('output/native-toolchains/pi-results', name + '.json'), 'utf8'));
  assert(source.realPiUsed && source.thinkingStreamed);
  const folder = path.join(output, name); await fs.rm(folder, { recursive: true, force: true }); const gameRoot = path.join(folder, 'game'); await fs.mkdir(gameRoot, { recursive: true });
  const fixture = path.resolve(name === 'godot' ? 'output/native-toolchains/engine-builds/godot-4.4.1' : name === 'gamemaker' ? 'output/native-toolchains/engine-builds/gamemaker-vm' : name === 'rgss' ? 'output/native-toolchains/engine-builds/rgss-rvdata2' : 'output/native-toolchains/il2cpp-build');
  const files = name === 'godot' ? ['game.pck'] : name === 'gamemaker' ? ['data.win'] : name === 'rgss' ? ['Game.rgss3a'] : ['GameAssembly.dll', 'UnityPlayer.dll', 'Simple_2019_4_34.exe', 'Simple_2019_4_34_Data/globalgamemanagers', 'Simple_2019_4_34_Data/il2cpp_data/Metadata/global-metadata.dat'];
  for (const file of files) { await fs.mkdir(path.dirname(path.join(gameRoot, file)), { recursive: true }); await fs.copyFile(path.join(fixture, file), path.join(gameRoot, file)); }
  await fs.mkdir(path.join(gameRoot, 'Saves')); await fs.writeFile(path.join(gameRoot, 'Saves/player.sav'), 'preserve');
  const originals = Object.fromEntries(await Promise.all(files.map(async file => [file, sha(await fs.readFile(path.join(gameRoot, file)))])));
  const game = { id: 'native-real-pi-' + name, name: 'Unlisted ' + name + ' game', installPath: gameRoot }, owner = 'native-validation';
  const downloads = await new Downloads(folder, {}).open(), installers = await new Installers(folder, downloads, { processes: async () => [] }).open();
  const environment = new GameEnvironment(folder, installers, null, { platform: 'win32', fetch: async url => {
   assert.match(url, /^https:\/\/builds\.bepinex\.dev\/projects\/bepinex_be\/788\//);
   return new Response(await fs.readFile(path.resolve('output/native-toolchains/bepinex-il2cpp-788.zip')));
  } });
  const studio = new ModStudio(folder, { integration: { python: false }, tools: { directory: path.resolve('.moddock-tools'), archiveDirectory: path.resolve('output/native-toolchains') } });
  const lifecycle = new StudioLifecycle(studio, downloads, new ModLibrary(downloads, installers, {}), installers); studio.options.lifecycle = lifecycle; studio.options.ensureEnvironment = context => environment.ensure(context);
  const context = { owner, game, current: () => true, authorize: async () => {} };
  await environment.ensure(context); await studio.prepareNative(game, context);
  const workspace = await studio.workspace(game), saved = await studio.save(owner, game, source.draft, () => true, { conversationId: 'native-verification-' + name });
  const report = await studio.toolchain.run(owner, game, saved.id, workspace, { ...context });
  assert.equal(report.status, 'passed', JSON.stringify(report)); assert(report.bundle?.size > 100);
  const archive = await studio.deploymentArchive(owner, game, saved.id); await fs.writeFile(path.join(folder, 'actual-mod.zip'), archive.bytes);
  const deployment = await lifecycle.install({ ...context, artifactId: saved.id });
  assert.equal(deployment.status, 'installed'); const mod = installers.state.mods.find(mod => mod.id === deployment.modId); assert(mod?.files.length);
  await installers.action(game, mod.id, 'verify'); assert.equal(mod.verification.status, 'files_ok');
  if (name === 'godot') {
   const run = await runTool(path.resolve('.cache/native-upstream/godot4/Godot.app/Contents/MacOS/Godot'), ['--headless', '--main-pack', path.join(gameRoot, 'game.pck')], { cwd: gameRoot, timeout: 30000 }); assert.equal(run.code, 0, run.output); assert.match(run.output, /GODOT_EFFECT=25/);
  } else if (name === 'rgss') {
   const rgss = load('studio-rgss.cjs'), archive = rgss.archiveRead(await fs.readFile(path.join(gameRoot, 'Game.rgss3a'))), entry = archive.entries.find(entry => /Scripts\.rvdata2$/.test(entry.name));
   const rubyFile = path.join(folder, 'verify.rb'); await fs.writeFile(rubyFile, rgss.scriptsRead(archive.read(entry)).map(entry => entry.source).join('\n'));
   const run = await runTool('/usr/bin/ruby', [rubyFile]); assert.equal(run.code, 0, run.output); assert.match(run.output, /RGSS_EFFECT=25/);
  } else if (name === 'gamemaker') {
   const inspect = path.join(folder, 'readback'); await fs.mkdir(inspect); await fs.writeFile(path.join(inspect, 'bridge-request.json'), '{"operation":"inspect"}');
   await studio.native.tools.run('umt', ['load', path.join(gameRoot, 'data.win'), '-s', path.resolve('vendor/native-toolchains/gamemaker.csx')], { cwd: inspect });
   const data = JSON.parse(await fs.readFile(path.join(inspect, 'bridge-result.json'), 'utf8')), code = data.entries.find(entry => entry.name === 'gml_Object_obj_player_Create_0').source;
   assert.match(code, /damage\s*=\s*25/); assert.match(code, /health\s*=\s*100/); assert.match(code, /stamina\s*=\s*30/);
  } else {
   const code = source.draft.files.find(file => file.name === 'main.cs').text;
   assert.match(code, /NormalBehaviour/); assert.match(code, /Update/); assert.match(code, /Prefix/); assert.match(code, /return\s+false/);
  }
  await installers.action(game, mod.id, 'disable'); for (const [file, hash] of Object.entries(originals)) assert.equal(sha(await fs.readFile(path.join(gameRoot, file))), hash);
  await installers.action(game, mod.id, 'enable');
  await studio.prepareNative(game, context); const revisionWorkspace = await studio.workspace(game), revisionDraft = structuredClone(source.draft);
  if (name === 'gamemaker') for (const target of revisionDraft.targets) target.sha256 = revisionWorkspace.context.engineEvidence.documents.find(doc => doc.entry === target.entry && doc.complete).sha256;
  const revision = await studio.save(owner, game, revisionDraft, () => true, { conversationId: 'native-verification-' + name, parentId: saved.id });
  const second = await studio.toolchain.run(owner, game, revision.id, revisionWorkspace, { ...context }); assert.equal(second.status, 'passed', JSON.stringify(second));
  const changed = await lifecycle.install({ ...context, artifactId: revision.id }); assert.equal(changed.status, 'installed'); assert.equal(installers.state.mods.filter(mod => mod.gameId === game.id).length, 1);
  await installers.action(game, changed.modId, 'uninstall'); for (const [file, hash] of Object.entries(originals)) assert.equal(sha(await fs.readFile(path.join(gameRoot, file))), hash);
  const libraryJob = downloads.jobs.find(job => job.studio?.artifactId === revision.id), libraryRule = await studio.ruleFor(game, libraryJob.studio, installers.getProfile(game).rule, owner);
  assert.equal(libraryRule.mode, name === 'il2cpp' ? 'copy' : 'native');
  if (name !== 'il2cpp') { const legacy = structuredClone(libraryJob.studio); delete legacy.toolchain; assert.deepEqual(await studio.ruleFor(game, legacy, installers.getProfile(game).rule, owner), libraryRule); }
  const libraryPlan = await installers.prepare(game, libraryJob.id, libraryRule), libraryMod = await installers.apply(game, libraryPlan.id, true);
  await installers.action(game, libraryMod.id, 'uninstall'); for (const [file, hash] of Object.entries(originals)) assert.equal(sha(await fs.readFile(path.join(gameRoot, file))), hash);
  assert.equal(await fs.readFile(path.join(gameRoot, 'Saves/player.sav'), 'utf8'), 'preserve');
  results.push({ name, mode: source.mode, realPiUsed: true, thinkingStreamed: source.thinkingStreamed, nativeBuildPassed: true, installDisableEnableReplaceUninstallPassed: true, libraryInstallationPassed: true, gameDataPreserved: true, gameRuntimeVerified: name === 'godot', logicSandboxPassed: ['rgss', 'gamemaker'].includes(name), compiledBytes: archive.bytes.length, sha256: sha(archive.bytes), tools: source.tools });
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ passed: true, application, results, windowsDeviceTested: false }, null, 2)); console.log(name + ': real Pi code / native build / installation lifecycle passed');
 }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
