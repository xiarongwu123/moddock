const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSourceKeyStore } = require('../source-key-store.cjs');
const { SourceConnections } = require('../source-connections.cjs');
const { encryptionFixture } = require('./source-auth-fixture.cjs');

async function fixture(t) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-source-keys-'));
 t.after(() => fs.rm(root, { recursive: true, force: true }));
 const encryption = encryptionFixture();
 return { root, encryption, store: createSourceKeyStore(root, encryption) };
}
test('source keys are encrypted, owner scoped, atomically replaced and restored after restart', async t => {
 const { root, store, encryption } = await fixture(t);
 const keys = { nexus: 'private-nexus-fixture-key', workshop: 'a'.repeat(32) };
 await store.write('service-a\nuser-a', keys);
 const [name] = await fs.readdir(root), bytes = await fs.readFile(path.join(root, name));
 for (const value of [...Object.values(keys), 'user-a', 'service-a']) assert.equal(bytes.includes(Buffer.from(value)), false);
 // Windows reports DOS attributes through stat.mode; POSIX permission bits are not supported.
 if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(root, name))).mode & 0o777, 0o600);
 const reopened = createSourceKeyStore(root, encryption);
 assert.deepEqual(await reopened.read('service-a\nuser-a'), keys);
 assert.deepEqual(await reopened.read('service-a\nuser-b'), {});
 assert.deepEqual(await reopened.read('service-b\nuser-a'), {});
 await Promise.all([store.write('service-a\nuser-a', { nexus: 'rotated' }), store.write('service-a\nuser-a', {})]);
 assert.deepEqual(await store.read('service-a\nuser-a'), {});
 assert.deepEqual(await fs.readdir(root), []);
});
test('plaintext backends, corruption, wrong owners and cancelled writes never become saved credentials', async t => {
 const { root, store, encryption } = await fixture(t);
 const plaintext = createSourceKeyStore(root, { ...encryption, getSelectedStorageBackend: () => 'basic_text' });
 assert.equal(plaintext.isAvailable(), false);
 await assert.rejects(plaintext.write('owner', { nexus: 'secret' }), /unavailable/);
 assert.deepEqual(await fs.readdir(root), []);
 await store.write('owner', { nexus: 'original' });
 let checks = 0;
 await assert.rejects(store.write('owner', { nexus: 'cancelled' }, () => ++checks === 1), /cancelled/);
 assert.deepEqual(await store.read('owner'), { nexus: 'original' });
 const [name] = await fs.readdir(root), file = path.join(root, name);
 await fs.writeFile(file, encryption.encryptString(JSON.stringify({ version: 1, owner: 'another', keys: { nexus: 'wrong-owner' } })));
 await assert.rejects(store.read('owner'), /Invalid/);
 await fs.writeFile(file, 'corrupted');
 const manager = new SourceConnections('scope', {}, { ...store, read: () => store.read('owner') });
 assert.match((await manager.status('owner')).warning, /无法解密/);
 assert.equal((await manager.status('owner')).nexusConnected, false);
 assert.equal(await fs.readFile(file, 'utf8'), 'corrupted');
 await fs.writeFile(file, Buffer.alloc(16385));
 await assert.rejects(store.read('owner'), /too large/);
});
test('connections merge concurrent providers, restore only the same account and persist disconnection', async t => {
 const { store } = await fixture(t), connections = new SourceConnections('scope', {}, store);
 await Promise.all([connections.connect('alice', 'nexus', 'alice-key'), connections.connect('alice', 'workshop', 'b'.repeat(32))]);
 await connections.connect('bob', 'nexus', 'bob-key');
 const old = await connections.get('alice'); connections.release('alice');
 assert.equal(old.sources.keys.nexus, '');
 assert.equal((await connections.get('alice')).sources.keys.nexus, 'alice-key');
 assert.equal((await connections.get('bob')).sources.keys.nexus, 'bob-key');
 await connections.connect('alice', 'nexus', ''); connections.close();
 const restarted = new SourceConnections('scope', {}, store), status = await restarted.status('alice');
 assert.equal(status.nexusConnected, false); assert.equal(status.workshopConnected, true);
 assert.equal(status.saved.workshop, true);
 assert.equal((await new SourceConnections('other-service', {}, store).status('alice')).nexusConnected, false);
 assert.equal(JSON.stringify(status).includes('alice-key'), false);
});
test('unavailable encryption is memory only and allows disconnect; failed persistence keeps the working key', async t => {
 const { root, encryption } = await fixture(t);
 const store = createSourceKeyStore(root, { ...encryption, isEncryptionAvailable: () => false });
 const memory = new SourceConnections('scope', {}, store);
 await memory.connect('alice', 'nexus', 'memory-key');
 await memory.connect('alice', 'workshop', 'c'.repeat(32));
 assert.equal((await memory.status('alice')).saved.nexus, false);
 await memory.connect('alice', 'nexus', '');
 assert.equal((await memory.status('alice')).workshopConnected, true);
 assert.deepEqual(await fs.readdir(root), []);
 const broken = new SourceConnections('scope', {}, { isAvailable: () => true, read: async () => ({ nexus: 'working' }), write: async () => { throw new Error('disk full'); } });
 await assert.rejects(broken.connect('alice', 'nexus', 'replacement'), /无法保存/);
 assert.equal((await broken.get('alice')).sources.keys.nexus, 'working');
 await assert.rejects(broken.connect('alice', 'workshop', 'invalid'), /32 位/);
});
