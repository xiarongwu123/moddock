const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Sources } = require('../sources.cjs');
const { createSourceKeyStore } = require('../source-key-store.cjs');
const { createPlatformEncryption } = require('./secret-store.cjs');
const { createNexusService } = require('./nexus-service.cjs');
const { NexusBrowserClient } = require('./nexus-browser-client.cjs');
const root = process.env.MODDOCK_NEXUS_SERVICE_DATA;
if (!root || !path.isAbsolute(root)) throw new Error('MODDOCK_NEXUS_SERVICE_DATA must be an absolute private directory');
let service, browser, closing = false;

(async () => {
 await fs.mkdir(root, { recursive: true, mode: 0o700 });
 const store = createSourceKeyStore(path.join(root, 'credentials'), await createPlatformEncryption(root));
 if (process.env.MODDOCK_NEXUS_IMPORT_FILE) {
  let imported;
  try { imported = JSON.parse(await fs.readFile(process.env.MODDOCK_NEXUS_IMPORT_FILE, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (imported?.key) { await store.write('nexus-platform-test', { nexus: imported.key }); imported.key = ''; }
 }
 const keys = await store.read('nexus-platform-test');
 if (!keys.nexus) throw new Error('Provision the encrypted service key before starting the API');
 const sources = new Sources(); sources.connect('nexus', keys.nexus); keys.nexus = '';
 let tokenBytes;
 try { tokenBytes = await fs.readFile(path.join(root, 'backend-token.bin')); }
 catch (error) { if (error.code !== 'ENOENT') throw error; tokenBytes = crypto.randomBytes(32); await fs.writeFile(path.join(root, 'backend-token.bin'), tokenBytes, { flag: 'wx', mode: 0o600 }); }
 if (tokenBytes.length !== 32) throw new Error('Invalid private backend token');
 const accessToken = tokenBytes.toString('hex');
 browser = new NexusBrowserClient({ socketPath: path.join(root, 'browser.sock'),
  initialize: channel => channel.request('import'),
  diagnostic: result => console.log(JSON.stringify(result)),
 });
 service = await createNexusService({ root, sources, authorizer: browser, verification: browser, accessToken,
  requireOwner: process.env.MODDOCK_NEXUS_SERVER === '1', host: process.env.MODDOCK_NEXUS_HOST || '127.0.0.1',
  port: Number(process.env.MODDOCK_NEXUS_PORT || 0), maintenance: screenshot => browser.maintenance(screenshot),
  health: () => ({ apiPid: process.pid, ...browser.status() }),
 });
 await fs.writeFile(path.join(root, 'client.json'), JSON.stringify({ url: service.url, accessToken }), { mode: 0o600 });
 console.log(JSON.stringify({ ready: true, pid: process.pid, url: service.url }));
})().catch(async () => { console.error('Download API initialization failed'); try { await service?.close(); } finally { browser?.close(); process.exitCode = 1; } });

async function close() {
 if (closing) return; closing = true;
 try { await service?.close(); } finally { browser?.close(); }
}
process.on('SIGTERM', () => { void close().then(() => process.exit(0), () => process.exit(1)); });
process.on('SIGINT', () => { void close().then(() => process.exit(0), () => process.exit(1)); });
