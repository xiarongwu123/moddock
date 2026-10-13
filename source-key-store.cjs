const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function validKeys(keys) {
 if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return false;
 return Object.entries(keys).every(([source, key]) => ['nexus', 'workshop'].includes(source) && typeof key === 'string' && key.length <= 2048 && !/[\r\n]/.test(key) && (source !== 'workshop' || !key || /^[a-f\d]{32}$/i.test(key)));
}
function createSourceKeyStore(root, encryption) {
 const queues = new Map();
 const isAvailable = () => !!encryption?.isEncryptionAvailable() && encryption.getSelectedStorageBackend?.() !== 'basic_text';
 const filename = owner => path.join(root, crypto.createHash('sha256').update(owner).digest('hex') + '.bin');
 function serialized(owner, action) {
  const pending = (queues.get(owner) || Promise.resolve()).catch(() => {}).then(action);
  queues.set(owner, pending);
  pending.finally(() => { if (queues.get(owner) === pending) queues.delete(owner); }).catch(() => {});
  return pending;
 }
 return {
  isAvailable,
  read(owner) { return serialized(owner, async () => {
   let bytes;
   try {
    if ((await fs.stat(filename(owner))).size > 16384) throw new Error('Saved source credentials are too large');
    bytes = await fs.readFile(filename(owner));
   } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
   if (!isAvailable()) throw new Error('OS encryption is unavailable');
   const data = JSON.parse(encryption.decryptString(bytes));
   if (data.version !== 1 || data.owner !== owner || !validKeys(data.keys)) throw new Error('Invalid saved source credentials');
   return data.keys;
  }); },
  write(owner, keys, current = () => true) { return serialized(owner, async () => {
   if (!current()) throw new Error('Source authorization was cancelled');
   if (!validKeys(keys)) throw new Error('Invalid source credentials');
   if (!Object.values(keys).some(Boolean)) { await fs.rm(filename(owner), { force: true }); return; }
   if (!isAvailable()) throw new Error('OS encryption is unavailable');
   const bytes = encryption.encryptString(JSON.stringify({ version: 1, owner, keys }));
   await fs.mkdir(root, { recursive: true });
   const temporary = filename(owner) + '.tmp';
   try {
    await fs.writeFile(temporary, bytes, { mode: 0o600 });
    if (!current()) throw new Error('Source authorization was cancelled');
    await fs.rename(temporary, filename(owner));
   }
   finally { await fs.rm(temporary, { force: true }); }
  }); },
 };
}
module.exports = { createSourceKeyStore };
