const crypto = require('node:crypto');

function encryptionFixture() {
 const key = crypto.randomBytes(32);
 return {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'fixture',
  encryptString(value) {
   const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
   return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  },
  decryptString(bytes) {
   const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
   decipher.setAuthTag(bytes.subarray(-16));
   return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8');
  },
 };
}
class FakeSocket extends EventTarget {
 constructor() { super(); this.sent = []; this.closed = false; }
 send(value) { this.sent.push(JSON.parse(value)); }
 open() { this.dispatchEvent(new Event('open')); }
 message(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
 close() { if (!this.closed) { this.closed = true; this.dispatchEvent(new Event('close')); } }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check) {
 for (let index = 0; index < 200; index++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
 throw new Error('Fixture condition timed out');
}
module.exports = { encryptionFixture, FakeSocket, tick, until };
