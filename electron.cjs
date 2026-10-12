const { app, BrowserWindow, shell, net, session } = require('electron');
const { createServer } = require('./server.cjs');
const { downloadAllowed } = require('./sources.cjs');
let service;
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on('second-instance', () => { const window = BrowserWindow.getAllWindows()[0]; if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
if (primary) app.whenReady().then(async () => {
  const downloadSession = session.fromPartition('moddock-downloads');
  downloadSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => callback({ cancel: !downloadAllowed(details.url) }));
  service = await createServer({ port: 0, root: process.env.MODDOCK_DATA || require('node:path').join(app.getPath('userData'), 'data'), reveal: file => shell.showItemInFolder(file), sources: { fetch: (url, init) => net.fetch(String(url), init) }, downloads: { fetch: (url, init) => downloadSession.fetch(String(url), { ...init, redirect: 'follow' }) } });
  const window = new BrowserWindow({ width: 1440, height: 940, minWidth: 1000, minHeight: 700, title: '游匣 · MODDOCK', backgroundColor: '#101215', autoHideMenuBar: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => { if (!target.startsWith(service.url + '/')) { event.preventDefault(); } });
  await window.loadURL(service.url);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => service?.server.close());
