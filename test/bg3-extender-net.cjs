const { app, net } = require('electron');
const path = require('node:path');
app.whenReady().then(async () => {
 const root = process.env.MODDOCK_EXTENDER_APP_ROOT || path.resolve(__dirname, '..');
 const { download, unpack, RELEASE, createElectronFetch } = require(path.join(root, 'bg3-extender.cjs'));
 const bytes = await download(createElectronFetch(net), RELEASE, AbortSignal.timeout(120000));
 const dll = await unpack(bytes);
 console.log(JSON.stringify({ electronNetwork: true, officialAsset: true, bytes: bytes.length, dllBytes: dll.length, sha256: RELEASE.dllSha256 }));
 app.quit();
}).catch(error => { console.error(error); app.exit(1); });
