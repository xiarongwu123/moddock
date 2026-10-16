const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
async function stage(original, extension, destination) {
 const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
 const baseline = {};
 async function record(directory, prefix = '') {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
   const name = path.join(prefix, entry.name), file = path.join(directory, entry.name);
   if (entry.isDirectory()) await record(file, name);
   else if (entry.isFile()) baseline[name] = hash(await fs.readFile(file));
   else throw new Error('Release must contain regular files only');
  }
 }
 await record(original);
 if (baseline['Mu.Server.dll'] !== 'e94ad754d3a5b95897fb6d83525dd594c8c9d9da0856ef71c714f599984e3bf0'
  || baseline['Mu.NexusGateway.dll'] !== 'db626ed732e8a74438d0c6f16dfb9380a9891298a655ce0418a5b6b3b2cd6013') throw new Error('Unexpected deployed payment/Nexus baseline');
 await fs.mkdir(destination, { mode: 0o700 });
 await fs.cp(original, destination, { recursive: true });
 await fs.copyFile(extension, path.join(destination, 'Mu.NexusGateway.dll'));
 for (const [file, value] of Object.entries(baseline)) if (file !== 'Mu.NexusGateway.dll' && hash(await fs.readFile(path.join(destination, file))) !== value) throw new Error('Baseline changed: ' + file);
 const report = { baseline, gatewaySha256: hash(await fs.readFile(extension)), originalServerUnchanged: true, schemaChanged: false };
 await fs.writeFile(path.join(destination, 'studio-deployment-manifest.json'), JSON.stringify(report, null, 2) + '\n');
 console.log(JSON.stringify({ destination, gatewaySha256: report.gatewaySha256, originalFilesPreserved: Object.keys(baseline).length - 1 }));
}
if (require.main === module) stage(...process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { stage };
