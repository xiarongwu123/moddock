const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
(async () => {
 const root = path.resolve(__dirname, '..'), destination = path.resolve(process.argv[2]);
 await fs.mkdir(destination);
 const names = ['studio-ai.cjs', 'bg3-mod.cjs', 'bg3-controls.cjs', 'content-pack.cjs', 'larian-pak.cjs', 'platform/studio-service.cjs', 'platform/run-studio-server.sh'];
 const hashes = {};
 for (const name of names) {
  const bytes = await fs.readFile(path.join(root, name));
  await fs.mkdir(path.dirname(path.join(destination, name)), { recursive: true });
  await fs.writeFile(path.join(destination, name), bytes, { flag: 'wx', mode: 0o600 });
  hashes[name] = crypto.createHash('sha256').update(bytes).digest('hex');
 }
 await fs.cp(path.join(root, 'node_modules/@xmldom/xmldom'), path.join(destination, 'node_modules/@xmldom/xmldom'), { recursive: true });
 const manifest = { createdAt: new Date().toISOString(), capabilities: ['plan', 'generate', 'repair', 'bg3-agent'], hashes, credentialsIncluded: false };
 await fs.writeFile(path.join(destination, 'service-manifest.json'), JSON.stringify(manifest, null, 2));
 console.log(JSON.stringify({ destination, hashes }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
