const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('./server-fixture.cjs');
const { createSourceKeyStore } = require('../source-key-store.cjs');
const { encryptionFixture, FakeSocket } = require('./source-auth-fixture.cjs');

(async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-source-preview-'));
 const service = await createServer({ root, port: 0, scan: async () => ({ games: [], diagnostics: [] }),
  sourceKeyStore: process.argv.includes('--memory') ? undefined : createSourceKeyStore(path.join(root, 'sources'), encryptionFixture()),
  sources: { fetch: async () => Response.json({ user_id: 42 }) },
  nexusSso: { application: process.argv.includes('--unconfigured') ? '' : 'moddock-fixture', openBrowser: async () => {}, socket: () => {
   const socket = new FakeSocket(); let timer;
   socket.addEventListener('open', () => {
    socket.message({ success: true, data: { connection_token: 'fixture-reconnect' } });
    timer = setTimeout(() => socket.message({ success: true, data: { api_key: 'fixture-nexus-key' } }), 7000);
   });
   socket.addEventListener('close', () => clearTimeout(timer));
   queueMicrotask(() => socket.open()); return socket;
  } },
 });
 console.log('Source authorization UI fixture (simulated Nexus and encryption): ' + service.url);
 const close = async () => { await new Promise(resolve => service.server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); process.exit(0); };
 process.on('SIGINT', close); process.on('SIGTERM', close);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
