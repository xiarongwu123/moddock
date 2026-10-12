const fs = require('node:fs/promises');
const path = require('node:path');
const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const pendingBuilds = new Map();

async function buildUi(outdir = publicDir) {
 const { build } = require('esbuild');
 await build({
 absWorkingDir: projectRoot,
 entryPoints: ['src/main.jsx'],
 bundle: true,
 jsx: 'automatic',
 outfile: path.join(outdir, 'auth.js'),
 minify: true,
 target: ['chrome120'],
 external: ['/fonts/*'],
 define: { 'process.env.NODE_ENV': '"production"' },
 legalComments: 'eof',
 });
}

async function ensureUi(outdir = publicDir) {
 try {
  await Promise.all(['auth.js', 'auth.css'].map(name => fs.access(path.join(outdir, name))));
  return;
 } catch (error) {
  if (error.code !== 'ENOENT') throw error;
 }
 if (!pendingBuilds.has(outdir)) {
  const pending = buildUi(outdir).finally(() => pendingBuilds.delete(outdir));
  pendingBuilds.set(outdir, pending);
 }
 await pendingBuilds.get(outdir);
}

if (require.main === module) buildUi().then(() => console.log('Moddock UI built')).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { buildUi, ensureUi };
