const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('esbuild');

// Freeze an allowlisted application snapshot before generating public review binaries.
(async () => {
 const project = path.resolve(__dirname, '..');
 const destination = path.resolve(process.argv[2] || 'output/nexus-review');
 const version = process.argv[3];
 if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/.test(version || '')) throw new Error('Pass a semantic version');
 await fs.mkdir(destination, { recursive: true });
 const app = path.join(destination, 'app');
 await fs.mkdir(app);
 const runtime = ['electron.cjs', 'server.cjs', 'sources.cjs', 'workshop.cjs', 'downloads.cjs', 'scanner.cjs', 'installers.cjs', 'auto-install.cjs', 'install-rules.cjs', 'nxm.cjs', 'nexus-authorization.cjs', 'nexus-platform-client.cjs', 'library.cjs', 'adapters.cjs', 'account.cjs', 'account-policy.cjs', 'account-token-store.cjs', 'nexus-games.json', 'nexus-app.json', 'nexus-sso.cjs', 'source-key-store.cjs', 'source-connections.cjs', 'README.md'];
 runtime.push('archive-limits.cjs', 'installation-progress.cjs');
 runtime.push('game-diagnostics.cjs', 'content-pack.cjs', 'mod-studio.cjs', 'universal-modder.cjs', 'studio-recipes.cjs', 'studio-conversations.cjs', 'studio-mu-client.cjs', 'studio-games.cjs', 'studio-preload.cjs', 'studio-migration.cjs', 'studio-lifecycle.cjs', 'studio-tools.cjs', 'studio-toolchain.cjs', 'larian-pak.cjs', 'bg3-mod.cjs', 'THIRD-PARTY-NOTICES.md');
 runtime.push('studio-agent.cjs', 'studio-lua.cjs', 'bg3-controls.cjs', 'studio-control-host.cjs', 'bg3-extender.cjs');
 runtime.push('studio-skills.cjs', 'studio-api.cjs', 'studio-events.cjs', 'studio-intent.cjs', 'studio-game-api.cjs');
 runtime.push('studio-engines.cjs', 'studio-cyberpunk.cjs', 'studio-game-mods.cjs', 'studio-coverage.cjs', 'studio-minecraft.cjs', 'studio-pixels.cjs');
 runtime.push('fomod.cjs', 'game-updates.cjs', 'studio-user-feedback.cjs');
 runtime.push('studio-errors.cjs');
 runtime.push('studio-native-tools.cjs', 'studio-native-projects.cjs', 'studio-native-patch.cjs', 'studio-godot.cjs', 'studio-rgss.cjs', 'studio-ruby.cjs', 'studio-il2cpp.cjs');
 runtime.push('game-components.cjs', 'game-environment.cjs', 'studio-compiler-setup.cjs');
 runtime.push('ai-policy.cjs', 'ai-usage.cjs', 'ai-install.cjs', 'archive-format.cjs', 'author-install.cjs', 'install-instructions.cjs', 'replacement-evidence.cjs', 'download-transfer.cjs', 'download-bundles.cjs');
 runtime.push('studio-game-process.cjs', 'studio-runtime-cycle.cjs', 'studio-runtime-verification.cjs', 'studio-ue4ss-safety.cjs');
 for (const file of runtime) await fs.copyFile(path.join(project, file), path.join(app, file));
 for (const directory of ['src', 'public', 'vendor', 'skills']) await fs.cp(path.join(project, directory), path.join(app, directory), { recursive: true });
 await fs.mkdir(path.join(app, 'scripts'));
 await fs.copyFile(path.join(project, 'scripts/build-ui.cjs'), path.join(app, 'scripts/build-ui.cjs'));
 await fs.copyFile(path.join(project, 'scripts/universal-modder-bridge.py'), path.join(app, 'scripts/universal-modder-bridge.py'));
 const original = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
 // The renderer is bundled; runtime ZIP and XML readers stay as Node modules.
 const metadata = { name: original.name, version, private: true, description: original.description, main: original.main,
  author: 'Rongwen Xia', dependencies: Object.fromEntries(['yauzl', '@xmldom/xmldom', 'wasmoon', '@lezer/python', '@ruby/wasm-wasi', '@ruby/3.3-wasm-wasi', 'fossil-delta'].map(name => [name, original.dependencies[name]])), devDependencies: { electron: original.devDependencies.electron } };
 await fs.writeFile(path.join(app, 'package.json'), JSON.stringify(metadata, null, 2) + '\n');
 const copied = new Set();
 async function dependency(name) {
  if (copied.has(name)) return;
  const source = path.join(project, 'node_modules', name);
  const info = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
  await fs.cp(source, path.join(app, 'node_modules', name), { recursive: true });
  copied.add(name);
  for (const child of Object.keys(info.dependencies || {})) await dependency(child);
 }
 await dependency('yauzl');
 await dependency('@xmldom/xmldom');
 await dependency('wasmoon');
 await dependency('@lezer/python');
 await dependency('@ruby/wasm-wasi');
 await dependency('@ruby/3.3-wasm-wasi');
 await dependency('fossil-delta');
 for (const name of ['ruby+stdlib.wasm', 'ruby.debug+stdlib.wasm']) await fs.rm(path.join(app, 'node_modules/@ruby/3.3-wasm-wasi/dist', name), { force: true });
 await build({ absWorkingDir: app, entryPoints: ['src/main.jsx'], bundle: true, jsx: 'automatic', outfile: path.join(app, 'public/auth.js'), minify: true,
  target: ['chrome120'], nodePaths: [path.join(project, 'node_modules')], external: ['/fonts/*'], define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof' });
 const hashes = {};
 async function record(directory) {
  for (const entry of await fs.readdir(path.join(app, directory), { withFileTypes: true })) {
   const name = path.join(directory, entry.name);
   if (entry.isDirectory()) await record(name);
   else hashes[name] = crypto.createHash('sha256').update(await fs.readFile(path.join(app, name))).digest('hex');
  }
 }
 await record('');
 await fs.writeFile(path.join(destination, 'snapshot.json'), JSON.stringify({ version, createdAt: new Date().toISOString(), hashes }, null, 2));
 console.log(JSON.stringify({ app, version, files: Object.keys(hashes).length, dependencies: [...copied] }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
