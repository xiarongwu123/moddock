const { app, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
app.whenReady().then(async () => {
 const root = process.env.MODDOCK_CROSS_APP_ROOT || path.resolve(__dirname, '..');
 const { createElectronFetch } = require(path.join(root, 'bg3-extender.cjs'));
 const { GameEnvironment } = require(path.join(root, 'game-environment.cjs'));
 const out = path.resolve(process.env.MODDOCK_CROSS_NET_ROOT || 'output/game-environments/electron');
 await fs.mkdir(out, { recursive: true }); const stage = await fs.mkdtemp(path.join(out, 'verify-'));
 const manager = new GameEnvironment(out, null, null, { fetch: createElectronFetch(net) });
 const result = await manager.asset('bepinex-x64', stage, AbortSignal.timeout(120000));
 console.log(JSON.stringify({ electronNetwork: true, officialAsset: true, component: 'bepinex-x64', sha256: result.item.sha256, files: result.files.length }));
 await fs.rm(stage, { recursive: true, force: true }); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
