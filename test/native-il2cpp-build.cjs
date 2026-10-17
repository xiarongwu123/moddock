const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { NativeProjects } = require('../studio-native-projects.cjs');
const { collectEngineEvidence } = require('../studio-engines.cjs');
const { diagnoseGame } = require('../game-diagnostics.cjs');
async function main() {
 const directory = path.resolve('output/native-toolchains/il2cpp-build'), data = 'Simple_2019_4_34_Data';
 await fs.mkdir(path.join(directory, data, 'il2cpp_data/Metadata'), { recursive: true });
 for (const [from, to] of [['test-il2cpp-GameAssembly.dll', 'GameAssembly.dll'], ['test-il2cpp-global-metadata.dat', data + '/il2cpp_data/Metadata/global-metadata.dat'], ['test-il2cpp-globalgamemanagers', data + '/globalgamemanagers'], ['test-il2cpp-UnityPlayer.dll', 'UnityPlayer.dll'], ['test-il2cpp-Simple.exe', 'Simple_2019_4_34.exe']]) await fs.copyFile(path.resolve('output/native-toolchains', from), path.join(directory, to));
 const game = { id: 'il2cpp-native-test', name: 'Cpp2IL public test game', installPath: directory }, diagnostic = await diagnoseGame(game);
 assert.equal(diagnostic.engine.key, 'unity-il2cpp');
 const evidence = await collectEngineEvidence(game, diagnostic), native = new NativeProjects({ directory: path.resolve('.moddock-tools'), archiveDirectory: path.resolve('output/native-toolchains') });
 await native.prepare(game, evidence, { diagnostic, onEvent: async e => console.log(e.name, e.type, e.detail) });
 const snapshot = await native.snapshot(game, evidence); assert.equal(snapshot.mode, 'unity-il2cpp');
 await fs.writeFile(path.join(directory, 'evidence.json'), JSON.stringify(snapshot, null, 2));
 const code = 'using BepInEx.Unity.IL2CPP;\nusing HarmonyLib;\npublic static class ModContent { public static void Initialize(BasePlugin plugin) { new Harmony("moddock.test.gameplay").PatchAll(typeof(ModContent).Assembly); } }\n';
 const work = path.join(directory, 'build'); await fs.mkdir(work, { recursive: true });
 const result = await native.build(game, { manifest: { UniqueID: 'Moddock123abc' }, draft: { mode: 'unity-il2cpp', files: [{ name: 'main.cs', text: code }] } }, snapshot, { work });
 assert(result.passed, JSON.stringify(result));
 const report = { source: 'https://github.com/SamboyCoding/Cpp2IL/tree/b5ad444b82267cb1e4b88b8b373c008105bdea52/TestFiles/Simple_2019_4_34', nativeInterfaceGeneration: true, referenceCount: Object.keys(snapshot.native.references).length, checks: result.checks, outputs: result.outputs.map(file => ({ name: file.name, bytes: file.data.length })), windowsDeviceTested: false, gameplayVerified: false };
 await fs.writeFile(path.join(directory, 'verification.json'), JSON.stringify(report, null, 2)); console.log(report);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
