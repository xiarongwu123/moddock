const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const asar = require('/Users/it/.npm/_npx/17a3088631ee63ed/node_modules/@electron/asar');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function hash(file) { const h = crypto.createHash('sha256'); for await (const bytes of createReadStream(file)) h.update(bytes); return h.digest('hex'); }
async function main() {
 const root = path.resolve(process.argv[2]), snapshot = JSON.parse(await fs.readFile(path.join(root, 'snapshot-release/snapshot.json'), 'utf8')), version = snapshot.version;
 const installer = path.join(root, 'release', `Moddock-${version}-windows-x64-Setup.exe`), payload = path.join(root, 'installer-payload');
 const seven = path.resolve('output/windows/.package-cache/electron-builder/7zip@1.0.0/7zip-darwin-arm64-12wkd/bin/7zz');
 const run = args => execFileSync(seven, args, { maxBuffer: 8 * 1024 * 1024 }).toString();
 run(['e', '-y', installer, '$PLUGINSDIR/app-64.7z', '-o' + payload]); assert.match(run(['t', path.join(payload, 'app-64.7z')]), /Everything is Ok/);
 run(['x', '-y', path.join(payload, 'app-64.7z'), 'resources/*', 'Moddock.exe', '-o' + payload]);
 const archive = path.join(payload, 'resources/app.asar'), files = new Set(asar.listPackage(archive).map(file => file.replace(/^\//, '')));
 assert.equal(await hash(archive), await hash(path.join(root, 'release/win-unpacked/resources/app.asar')));
 const exe = await fs.readFile(path.join(payload, 'Moddock.exe')), pe = exe.readUInt32LE(60); assert.equal(exe.toString('ascii', pe, pe + 4), 'PE\0\0'); assert.equal(exe.readUInt16LE(pe + 4), 0x8664);
 const required = ['studio-native-projects.cjs', 'studio-native-tools.cjs', 'studio-native-patch.cjs', 'studio-rgss.cjs', 'studio-godot.cjs', 'studio-ruby.cjs', 'studio-il2cpp.cjs', 'node_modules/@ruby/3.3-wasm-wasi/dist/ruby.wasm', 'node_modules/@ruby/wasm-wasi/dist/cjs/node.js', 'node_modules/fossil-delta/fossil-delta.js', 'vendor/native-toolchains/gamemaker.csx', 'vendor/native-toolchains/godot-config.gd', 'vendor/native-toolchains/Il2CppBridge.cs'];
 for (const name of required) assert(files.has(name), 'Missing native runtime: ' + name);
 assert(!files.has('studio-ai.cjs')); assert(![...files].some(file => /(^|\/)(?:platform|test|\.moddock-tools|\.moddock-data|\.git|credentials)(?:\/|$)|(^|\/)\.env$|ruby\.debug\+stdlib\.wasm/.test(file)));
 let verified = 0;
 for (const [name, expected] of Object.entries(snapshot.hashes)) {
  if (!name.startsWith('src/') && !name.startsWith('node_modules/')) assert(files.has(name), 'Snapshot file missing: ' + name);
  if (!files.has(name)) continue;
  const data = asar.extractFile(archive, name);
  if (/(^|\/)package\.json$/.test(name)) {
   const before = JSON.parse(await fs.readFile(path.join(root, 'snapshot-release/app', name))), after = JSON.parse(data);
   for (const key of ['devDependencies', 'scripts', 'bugs', 'keywords', 'contributors']) if (!(key in after)) delete before[key]; assert.deepEqual(after, before, name);
  } else assert.equal(sha(data), expected, name);
  verified++;
 }
 const smoke = path.join(root, 'package-smoke'); asar.extractAll(archive, smoke);
 const resolve = Module._resolveFilename;
 Module._resolveFilename = function(request, parent, ...rest) { const file = resolve.call(this, request, parent, ...rest); if (parent?.filename.startsWith(smoke + path.sep) && !Module.isBuiltin(request)) assert(file.startsWith(smoke + path.sep), 'Dependency escaped package: ' + request); return file; };
 for (const name of ['server.cjs', 'studio-native-projects.cjs', 'studio-il2cpp.cjs']) require(path.join(smoke, name));
 const patch = await require(path.join(smoke, 'studio-native-patch.cjs')).createNativePatch([{ path: 'data.win', before: Buffer.from('native original resource'), after: Buffer.from('native changed resource') }], 'gamemaker-gml'); assert(patch.outputs.length === 2);
 assert.equal((await require(path.join(smoke, 'studio-ruby.cjs')).checkRuby('raise "not executed"')).passed, true);
 const metadata = JSON.parse(asar.extractFile(archive, 'package.json')); assert.equal(metadata.version, version);
 const sourceRoot = path.resolve('.');
 for (const [name, expected] of Object.entries(snapshot.hashes)) if (!name.startsWith('node_modules/') && name !== 'package.json') assert.equal(await hash(path.join(sourceRoot, name)), expected, 'Current source diverged: ' + name);
 const result = { passed: true, version, arch: 'x64', installer: { file: installer, bytes: (await fs.stat(installer)).size, sha256: await hash(installer) }, archiveSha256: await hash(archive), snapshotFilesVerified: verified, packagedFiles: files.size, nativeRuntimeFilesPresent: true, dependencyClosurePassed: true, snapshotMatchesCurrentSource: true, windowsDeviceTested: false };
 await fs.writeFile(path.join(root, 'package-verification.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
