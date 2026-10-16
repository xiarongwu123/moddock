const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
 const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.resolve(__dirname, '../studio-preload.cjs') } });
 try {
  await window.loadURL('data:text/html,<title>Studio preload test</title>');
  const result = await window.webContents.executeJavaScript('({ available: typeof window.moddockDesktop?.gamePath, syntheticPath: window.moddockDesktop?.gamePath(new File(["test"], "game.exe")), node: typeof require })');
  assert.deepEqual(result, { available: 'function', syntheticPath: '', node: 'undefined' });
  console.log('Sandbox game-file bridge passed; synthetic paths rejected; Node remains isolated.');
 } finally { window.destroy(); }
 app.quit();
}).catch(error => { console.error(error.message); app.exit(1); });
