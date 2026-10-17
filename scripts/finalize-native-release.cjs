const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
async function main() {
 const root = path.resolve(process.argv[2]), json = async name => JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
 const packageCheck = await json('package-verification.json'), native = await json('native-verification/verification.json'), browser = await json('browser/verification.json'), compilers = await json('asar-compiler-verification.json');
 assert(packageCheck.passed && packageCheck.snapshotMatchesCurrentSource && native.passed && browser.passed && browser.libraryAutoInstallationPassed);
 assert(compilers.actualAsarRubyCompiler && compilers.actualAsarNativeDelta && compilers.nativeBridgesUnpacked);
 assert.equal(native.results.length, 4); assert.deepEqual(new Set(native.results.map(item => item.mode)), new Set(['godot-gdscript', 'gamemaker-gml', 'rpgmaker-rgss', 'unity-il2cpp']));
 assert(native.results.every(item => item.realPiUsed && item.thinkingStreamed && item.nativeBuildPassed && item.installDisableEnableReplaceUninstallPassed && item.libraryInstallationPassed && item.gameDataPreserved));
 const tests = await fs.readFile('output/native-toolchains/tests-complete-release.log', 'utf8'); assert.match(tests, /# tests 333\s+# suites 0\s+# pass 333\s+# fail 0\s+# cancelled 0\s+# skipped 0/);
 const godot45 = JSON.parse(await fs.readFile('output/native-toolchains/godot45-builds/verification.json', 'utf8')); assert.match(godot45.results[0].runtime, /native Godot 4\.5\.2 changed gameplay variable to 25/);
 const production = JSON.parse(await fs.readFile('output/native-toolchains/native-production-verification.json', 'utf8')); assert(production.passed && production.accountConfigurationUnchanged);
 const report = { passed: true, version: packageCheck.version, arch: packageCheck.arch, created: new Date().toISOString(), installer: packageCheck.installer,
  package: packageCheck, tests: { passed: 333, failed: 0, skipped: 0 }, modes: native.results, browser, compilers, production,
  godotRuntimeSamples: ['3.6.1', '4.4.1', '4.5.2'], snapshotSha256: crypto.createHash('sha256').update(await fs.readFile(path.join(root, 'snapshot-release/snapshot.json'))).digest('hex'),
  windowsDeviceTested: false, realUserGamesTested: false, limitations: ['GameMaker VM bytecode only; YYC is a different pipeline.', 'Legacy RPG Maker route covers XP/VX/VX Ace RGSS, not 2000/2003 LCF.', 'Successful native builds and sample execution do not establish every game/version or requested mechanic.'] };
 await fs.writeFile(path.join(root, 'release-verification.json'), JSON.stringify(report, null, 2));
 await fs.writeFile(packageCheck.installer.file + '.sha256', packageCheck.installer.sha256 + '  ' + path.basename(packageCheck.installer.file) + '\n');
 console.log(JSON.stringify({ passed: true, version: report.version, file: report.installer.file, bytes: report.installer.bytes, sha256: report.installer.sha256, tests: 333, nativeModes: report.modes.length, windowsDeviceTested: false }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
