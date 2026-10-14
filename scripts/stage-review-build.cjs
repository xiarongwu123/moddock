const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('esbuild');

// Freeze an allowlisted application snapshot before generating public review binaries.
(async () => {
 const project = path.resolve(__dirname, '..');
 const destination = path.resolve(process.argv[2] || 'output/nexus-review');
 const version = process.argv[3];
 if (!/^\d+\.\d+\.\d+-[a-zA-Z0-9.]+$/.test(version || '')) throw new Error('Pass a prerelease version');
 await fs.mkdir(destination, { recursive: true });
 const app = path.join(destination, 'app');
 await fs.mkdir(app);
 const runtime = ['electron.cjs', 'server.cjs', 'sources.cjs', 'workshop.cjs', 'downloads.cjs', 'scanner.cjs', 'installers.cjs', 'nxm.cjs', 'nexus-authorization.cjs', 'nexus-platform-client.cjs', 'library.cjs', 'adapters.cjs', 'account.cjs', 'account-policy.cjs', 'account-token-store.cjs', 'nexus-games.json', 'nexus-app.json', 'nexus-sso.cjs', 'source-key-store.cjs', 'source-connections.cjs', 'README.md'];
 for (const file of runtime) await fs.copyFile(path.join(project, file), path.join(app, file));
 for (const directory of ['src', 'public']) await fs.cp(path.join(project, directory), path.join(app, directory), { recursive: true });
 await fs.mkdir(path.join(app, 'scripts'));
 await fs.copyFile(path.join(project, 'scripts/build-ui.cjs'), path.join(app, 'scripts/build-ui.cjs'));
 const original = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
 // The renderer is bundled; only the ZIP reader and its dependencies run as Node modules.
 const metadata = { name: original.name, version, private: true, description: original.description, main: original.main,
  author: 'Rongwen Xia', dependencies: { yauzl: original.dependencies.yauzl }, devDependencies: { electron: original.devDependencies.electron } };
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
