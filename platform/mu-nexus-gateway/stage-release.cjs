const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

async function stage(original, extension, destination) {
 const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
 const baseline = {};
 async function files(directory, prefix = '') {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
   const relative = path.join(prefix, entry.name), file = path.join(directory, entry.name);
   if (entry.isDirectory()) await files(file, relative);
   else if (entry.isFile()) baseline[relative] = hash(await fs.readFile(file));
   else throw new Error('Release must contain regular files only');
  }
 }
 await files(original);
 if (baseline['Mu.NexusGateway.dll']) throw new Error('Baseline already contains the extension');
 const manifest = JSON.parse(await fs.readFile(path.join(original, 'Mu.Server.deps.json'), 'utf8'));
 const target = manifest.targets[manifest.runtimeTarget.name];
 const app = Object.keys(target).filter(name => name.startsWith('Mu.Server/'));
 if (app.length !== 1) throw new Error('Unexpected server dependency manifest');
 target[app[0]].dependencies['Mu.NexusGateway'] = '1.0.0';
 target['Mu.NexusGateway/1.0.0'] = { runtime: { 'Mu.NexusGateway.dll': {} } };
 manifest.libraries['Mu.NexusGateway/1.0.0'] = { type: 'project', serviceable: false, sha512: '' };
 await fs.mkdir(destination, { mode: 0o700 });
 await fs.cp(original, destination, { recursive: true });
 await fs.copyFile(extension, path.join(destination, 'Mu.NexusGateway.dll'));
 await fs.writeFile(path.join(destination, 'Mu.Server.deps.json'), JSON.stringify(manifest, null, 2) + '\n');
 for (const [file, digest] of Object.entries(baseline)) {
  if (file !== 'Mu.Server.deps.json' && hash(await fs.readFile(path.join(destination, file))) !== digest) throw new Error('Baseline changed: ' + file);
 }
 const report = { baseline, extensionSha256: hash(await fs.readFile(extension)), depsSha256: hash(await fs.readFile(path.join(destination, 'Mu.Server.deps.json'))), originalServerUnchanged: true };
 await fs.writeFile(path.join(destination, 'nexus-recovery-manifest.json'), JSON.stringify(report, null, 2) + '\n');
 console.log(JSON.stringify({ destination, serverSha256: baseline['Mu.Server.dll'], extensionSha256: report.extensionSha256, originalFilesPreserved: Object.keys(baseline).length - 1 }));
}
if (require.main === module) {
 const [original, extension, destination] = process.argv.slice(2);
 if (!original || !extension || !destination) throw new Error('Usage: stage-release.cjs ORIGINAL_DIRECTORY EXTENSION_DLL NEW_DIRECTORY');
 stage(original, extension, destination).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { stage };
