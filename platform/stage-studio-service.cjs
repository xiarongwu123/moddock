const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
(async () => {
 const root = path.resolve(__dirname, '..'), destination = path.resolve(process.argv[2]);
 await fs.mkdir(destination);
 const names = ['studio-ai.cjs', 'studio-skills.cjs', 'studio-api.cjs', 'studio-events.cjs', 'studio-authoring.cjs', 'studio-game-api.cjs', 'studio-lua.cjs', 'bg3-mod.cjs', 'bg3-controls.cjs', 'content-pack.cjs', 'larian-pak.cjs', 'platform/studio-pi.mjs', 'platform/package.json', 'platform/package-lock.json', 'platform/studio-service.cjs', 'platform/run-studio-server.sh'];
 const hashes = {};
 names.push('studio-engines.cjs');
 names.push('studio-errors.cjs', 'studio-mu-client.cjs', 'platform/studio-tasks.cjs', 'platform/studio-progress.cjs');
 names.push('ai-policy.cjs', 'platform/ai-ledger.cjs', 'platform/ai-ledger.sql', 'platform/ai-meter.mjs', 'platform/reconcile-ai-usage.cjs');
 for (const name of names) {
  const bytes = await fs.readFile(path.join(root, name));
  await fs.mkdir(path.dirname(path.join(destination, name)), { recursive: true });
  await fs.writeFile(path.join(destination, name), bytes, { flag: 'wx', mode: 0o600 });
  hashes[name] = crypto.createHash('sha256').update(bytes).digest('hex');
 }
 await fs.cp(path.join(root, 'node_modules/@xmldom/xmldom'), path.join(destination, 'node_modules/@xmldom/xmldom'), { recursive: true });
 for (const module of ['wasmoon', '@types/emscripten']) await fs.cp(path.join(root, 'node_modules', module), path.join(destination, 'node_modules', module), { recursive: true });
 for (const module of ['python', 'common', 'lr', 'highlight']) await fs.cp(path.join(root, 'node_modules/@lezer', module), path.join(destination, 'node_modules/@lezer', module), { recursive: true });
 for (const directory of ['skills', 'agents', 'vendor/studio-skills', 'vendor/ready-or-not-api', 'vendor/bg3-api', 'vendor/universal-modder/skills']) await fs.cp(path.join(root, directory), path.join(destination, directory), { recursive: true });
 async function record(directory = '') {
  for (const entry of await fs.readdir(path.join(destination, directory), { withFileTypes: true })) {
   const name = path.join(directory, entry.name);
   if (entry.isDirectory()) await record(name);
   else if (entry.isFile()) hashes[name] = crypto.createHash('sha256').update(await fs.readFile(path.join(destination, name))).digest('hex');
   else throw new Error('Service snapshot must contain regular files only');
  }
 }
 await record();
 const manifest = { createdAt: new Date().toISOString(), harness: 'pi-agent', runtimeInstall: 'npm ci --prefix platform --omit=dev --ignore-scripts', capabilities: ['plan', 'generate', 'repair', 'skills', 'agents', 'thinking', 'tool-events', 'resumable-tasks', 'diagnostics'], hashes, credentialsIncluded: false };
 await fs.writeFile(path.join(destination, 'service-manifest.json'), JSON.stringify(manifest, null, 2));
 console.log(JSON.stringify({ destination, files: Object.keys(hashes).length, harness: 'pi-agent', credentialsIncluded: false }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
