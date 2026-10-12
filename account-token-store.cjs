const fs = require('node:fs/promises');
const path = require('node:path');

function createAccountTokenStore(filename, encryption) {
 let queue = Promise.resolve();
 const isAvailable = () => encryption.isEncryptionAvailable() &&
  !(process.platform === 'linux' && encryption.getSelectedStorageBackend?.() === 'basic_text');
 const serialized = action => {
  const pending = queue.catch(() => {}).then(action);
  queue = pending; return pending;
 };
 return {
  isAvailable,
  read() { return serialized(async () => {
   let bytes;
   try {
    const stat = await fs.stat(filename);
    if (stat.size > 65536) throw new Error('Saved account session is too large');
    bytes = await fs.readFile(filename);
   } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
   if (!isAvailable()) throw new Error('OS account encryption is unavailable');
   const data = JSON.parse(encryption.decryptString(bytes));
   if (data.version !== 1 || typeof data.refreshToken !== 'string' || !data.refreshToken || typeof data.service !== 'string' || typeof data.email !== 'string') throw new Error('Invalid saved account session');
   return data;
  }); },
  write(data) { return serialized(async () => {
   if (!isAvailable()) throw new Error('OS account encryption is unavailable');
   const bytes = encryption.encryptString(JSON.stringify({ version: 1, ...data }));
   await fs.mkdir(path.dirname(filename), { recursive: true });
   const temporary = filename + '.tmp';
   try {
    await fs.writeFile(temporary, bytes, { mode: 0o600 });
    await fs.rename(temporary, filename);
   } finally { await fs.rm(temporary, { force: true }); }
  }); },
  clear() { return serialized(() => fs.rm(filename, { force: true })); },
 };
}
module.exports = { createAccountTokenStore };
