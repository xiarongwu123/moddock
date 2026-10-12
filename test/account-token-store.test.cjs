const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createAccountTokenStore } = require('../account-token-store.cjs');

async function fixture(t) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-encrypted-account-'));
 t.after(() => fs.rm(root, { recursive: true, force: true }));
 return path.join(root, 'account-session.bin');
}
function encryptionFixture() {
 const key = crypto.randomBytes(32);
 return {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
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
test('encrypted token store writes atomically, survives restart and never writes tokens or email as plaintext', async t => {
 const filename = await fixture(t), encryption = encryptionFixture();
 const store = createAccountTokenStore(filename, encryption);
 const data = { service: 'https://mu-api.claude-api.cn/', email: 'player@example.com', refreshToken: 'refresh-secret-first' };
 assert.equal(await store.read(), null);
 await store.write(data);
 const bytes = await fs.readFile(filename);
 for (const value of Object.values(data)) assert.equal(bytes.includes(Buffer.from(value)), false);
 assert.deepEqual(await createAccountTokenStore(filename, encryption).read(), { version: 1, ...data });
 await Promise.all([store.write({ ...data, refreshToken: 'rotated' }), store.clear()]);
 assert.equal(await store.read(), null);
 await assert.rejects(fs.access(filename + '.tmp'));
});
test('unavailable encryption and corrupted or oversized saved credentials fail closed', async t => {
 const filename = await fixture(t), encryption = encryptionFixture();
 const disabled = createAccountTokenStore(filename, { ...encryption, isEncryptionAvailable: () => false });
 await assert.rejects(disabled.write({ refreshToken: 'secret' }), /unavailable/);
 await assert.rejects(fs.access(filename));
 await fs.writeFile(filename, 'corrupted');
 await assert.rejects(createAccountTokenStore(filename, encryption).read());
 await fs.writeFile(filename, Buffer.alloc(65537));
 await assert.rejects(createAccountTokenStore(filename, encryption).read(), /too large/);
});
