const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function createPlatformEncryption(root) {
 const file = path.join(root, 'master-key.bin'); let key;
 try { key = await fs.readFile(file); }
 catch (error) { if (error.code !== 'ENOENT') throw error; key = crypto.randomBytes(32); await fs.writeFile(file, key, { flag: 'wx', mode: 0o600 }); }
 if (key.length !== 32 || (await fs.stat(file)).mode & 0o077) throw new Error('Invalid private platform encryption key');
 return {
  isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'platform-key-file',
  encryptString(value) { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([Buffer.from('MDN1'), iv, cipher.getAuthTag(), bytes]); },
  decryptString(bytes) { if (bytes.subarray(0, 4).toString() !== 'MDN1') throw new Error('Invalid platform secret'); const cipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(4, 16)); cipher.setAuthTag(bytes.subarray(16, 32)); return Buffer.concat([cipher.update(bytes.subarray(32)), cipher.final()]).toString('utf8'); },
 };
}
module.exports = { createPlatformEncryption };
