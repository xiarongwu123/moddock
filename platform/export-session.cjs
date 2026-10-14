const { app, session, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createSourceKeyStore } = require('../source-key-store.cjs');
const root = process.env.MODDOCK_NEXUS_SERVICE_DATA, output = process.env.MODDOCK_NEXUS_EXPORT;
if (!root || !output || !path.isAbsolute(root) || !path.isAbsolute(output)) throw new Error('Private export paths are required');
app.setName('moddock'); app.setPath('userData', path.join(root, 'browser'));
app.whenReady().then(async () => {
 const keys = await createSourceKeyStore(path.join(root, 'credentials'), safeStorage).read('nexus-platform-test');
 if (!keys.nexus) throw new Error('No platform key');
 const website = session.fromPartition('persist:moddock-platform-nexus');
 const cookies = (await website.cookies.get({})).filter(cookie => cookie.domain === 'nexusmods.com' || cookie.domain.endsWith('.nexusmods.com'));
 await fs.writeFile(output, JSON.stringify({ key: keys.nexus, cookies }), { flag: 'wx', mode: 0o600 });
 process.stdout.write(JSON.stringify({ exported: true, cookies: cookies.length }) + '\n'); app.quit();
}).catch(() => { process.stderr.write('Platform session export failed\n'); app.exit(1); });
