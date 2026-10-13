const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('./server-fixture.cjs');
const { scan } = require('../scanner.cjs');

(async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-scan-preview-'));
 const game = path.join(root, 'SteamLibrary/steamapps/common/Scan Sample');
 await fs.mkdir(game, { recursive: true });
 await fs.writeFile(path.join(root, 'SteamLibrary/steamapps/appmanifest_987654.acf'), '"AppState" { "appid" "987654" "name" "Scan Sample" "installdir" "Scan Sample" }');
 const service = await createServer({ root: path.join(root, 'data'), port: 0,
  scan: paths => scan(paths, path.join(root, 'no-epic')),
  chooseScanDirectory: async () => { await new Promise(resolve => setTimeout(resolve, 800)); return game; },
 });
 console.log('Scan UI fixture (simulated folder picker, real Steam manifests): ' + service.url);
 const close = async () => { await new Promise(resolve => service.server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); process.exit(0); };
 process.on('SIGINT', close); process.on('SIGTERM', close);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
