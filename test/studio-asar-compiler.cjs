const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
app.whenReady().then(async () => {
 const archive = path.resolve(process.env.MODDOCK_COMPILER_PACKAGE);
 const { checkLua } = require(path.join(archive, 'studio-lua.cjs'));
 const source = JSON.parse(await fs.readFile(process.env.MODDOCK_RON_ARTIFACT, 'utf8')).draft.code;
 assert.equal((await checkLua(source)).passed, true);
 assert.equal((await checkLua('local broken = function(')).passed, false);
 const { validateEngineDraft } = require(path.join(archive, 'studio-engines.cjs'));
 assert.equal(validateEngineDraft({ mode: 'renpy-python', files: [{ name: 'main.py', text: 'x = 1\n' }] }, { mode: 'renpy-python' }).passed, true);
 assert.equal(validateEngineDraft({ mode: 'renpy-python', files: [{ name: 'main.py', text: 'if :\n  pass' }] }, { mode: 'renpy-python' }).passed, false);
 const native = await fs.stat(path.join(archive.replace(/app\.asar$/, 'app.asar.unpacked'), 'vendor/native-toolchains/gamemaker.csx')).then(() => true).catch(() => false);
 let nativeVerified = false;
 if (native) {
  const { checkRuby } = require(path.join(archive, 'studio-ruby.cjs'));
  assert.equal((await checkRuby('raise "never execute"\nclass Player\n def damage\n 25\n end\nend')).passed, true);
  assert.equal((await checkRuby('def damage(\n')).passed, false);
  const { createNativePatch } = require(path.join(archive, 'studio-native-patch.cjs'));
  const patch = await createNativePatch([{ path: 'data.win', before: Buffer.from('original native data'), after: Buffer.from('modified actual native data') }], 'gamemaker-gml');
  assert(patch.nativeManifestSha256); assert.equal(patch.outputs.length, 2); nativeVerified = true;
 }
 const report = { passed: true, actualAsarWasmCompiler: true, actualAsarPythonParser: true, actualAsarRubyCompiler: nativeVerified, actualAsarNativeDelta: nativeVerified, nativeBridgesUnpacked: native, electron: process.versions.electron, sourceBytes: Buffer.byteLength(source), windowsDeviceTested: false };
 await fs.writeFile(process.env.MODDOCK_COMPILER_REPORT, JSON.stringify(report, null, 2));
 console.log(JSON.stringify(report)); app.quit();
}).catch(error => { console.error(error.message); app.exit(1); });
