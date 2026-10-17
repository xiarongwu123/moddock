const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const repository = 'Herkkomehtala/ReadyOrNot-Internal';
const commit = 'ef7c5642688bd265356e72a9a5f25e86d6a88150';
const sdk = 'RoN-Internal/SDK/';
const selected = new Set(['ReadyOrNotCharacter', 'CyberneticCharacter', 'SuspectCharacter', 'CivilianCharacter', 'SWATCharacter', 'PlayerCharacter', 'ResourceComponent', 'HealthComponent', 'CharacterHealthComponent', 'SuspectController', 'ReadyOrNotGameMode', 'CoopGM', 'SingleplayerGM', 'KismetSystemLibrary']);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function sync(local) {
 const read = async name => {
  if (local) return fs.readFile(path.join(local, name));
  const response = await fetch(`https://raw.githubusercontent.com/${repository}/${commit}/${name}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('API reference HTTP ' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer()); if (bytes.length > 8 * 1024 * 1024) throw new Error('API reference exceeds size limit'); return bytes;
 };
 const names = ['ReadyOrNot_classes.hpp', 'Engine_classes.hpp'];
 const entries = [], inputs = {};
 for (const name of names) {
  const file = sdk + name, bytes = await read(file); inputs[file] = digest(bytes);
  let owner, included = false;
  for (const [offset, line] of bytes.toString().split('\n').entries()) {
   const header = /^\/\/ Class (ReadyOrNot|Engine)\.([A-Za-z0-9_]+)/.exec(line);
   if (header) { owner = header[1] + '.' + header[2]; included = selected.has(header[2]); }
   if (!included) continue;
   if (/^class [A-Za-z0-9_]+(?:\s*:\s*public [A-Za-z0-9_]+)?\s*$/.test(line)) entries.push({ path: '/Script/' + owner, signature: line.trim(), source: file, line: offset + 1 });
   if (/^\s+(?:static )?(?:void|bool|float|int32|class \w+\*|E\w+)\s+\w+\(.*\)(?: const)?;\s*$/.test(line)) {
    const signature = line.trim(), method = /\b(\w+)\(/.exec(signature)[1];
    entries.push({ path: '/Script/' + owner + ':' + method, signature, source: file, line: offset + 1 });
   }
  }
 }
 const destination = path.resolve(__dirname, '../vendor/ready-or-not-api'); await fs.mkdir(destination, { recursive: true });
 const license = await read('LICENSE'); if (!license.toString().includes('MIT License')) throw new Error('Expected MIT API source');
 const source = { repository: 'https://github.com/' + repository, commit, license: 'MIT', inputs };
 const bytes = Buffer.from(JSON.stringify({ source, entries }, null, 2) + '\n');
 await fs.writeFile(path.join(destination, 'api.json'), bytes); await fs.writeFile(path.join(destination, 'LICENSE'), license);
 await fs.writeFile(path.join(destination, 'UPSTREAM.json'), JSON.stringify({ ...source, hashes: { 'api.json': digest(bytes), LICENSE: digest(license) } }, null, 2) + '\n');
 console.log(JSON.stringify({ entries: entries.length, commit, bytes: bytes.length }));
}
if (require.main === module) sync(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { sync };
