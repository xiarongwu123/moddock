const { app, BrowserWindow, shell, net, session, safeStorage, dialog } = require('electron');
const path=require('node:path');
const { createServer } = require('./server.cjs');
const { downloadAllowed, externalAllowed } = require('./sources.cjs');
const { createAccountTokenStore } = require('./account-token-store.cjs');
const { createSourceKeyStore } = require('./source-key-store.cjs');
let service,mainWindow,authorizationWindow,protocolRegistered=false;
const pending=[];
function focusMain(){if(mainWindow&&!mainWindow.isDestroyed()){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();}}
function receive(value){if(typeof value!=='string'||!/^nxm:\/\//i.test(value))return;if(!service){if(pending.length<20)pending.push(value);return;}void service.receiveNxm(value).catch(()=>{}).finally(()=>focusMain());}
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on('second-instance',(_event,argv)=>{for(const arg of argv)if(/^nxm:\/\//i.test(arg))receive(arg);focusMain();});
app.on('open-url',(event,value)=>{event.preventDefault();receive(value);});
function officialPage(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['www.nexusmods.com','nexusmods.com','users.nexusmods.com'].includes(u.hostname);}catch{return false;}}
async function authorize(page){
 if(!officialPage(page))throw new Error('授权窗口只允许 Nexus 官方页面');
 if(authorizationWindow&&!authorizationWindow.isDestroyed()){await authorizationWindow.loadURL(page);authorizationWindow.show();authorizationWindow.focus();return;}
 const win=authorizationWindow=new BrowserWindow({width:1100,height:850,title:'Nexus 文件授权 · 游匣',autoHideMenuBar:true,parent:mainWindow,webPreferences:{partition:'persist:moddock-nexus-auth',nodeIntegration:false,contextIsolation:true,sandbox:true}});
 const intercept=(event,url)=>{url=event.url||url;if(/^nxm:\/\//i.test(url)){event.preventDefault();receive(url);return;}if(event.isMainFrame!==false&&!officialPage(url))event.preventDefault();};
 win.webContents.on('will-frame-navigate',event=>{if(String(event.url||'').toLowerCase().startsWith('nxm://')){event.preventDefault();receive(event.url);}});
 win.webContents.on('will-navigate',intercept);win.webContents.on('will-redirect',intercept);
 win.webContents.setWindowOpenHandler(({url})=>{if(/^nxm:\/\//i.test(url))receive(url);else if(officialPage(url))void win.loadURL(url);return {action:'deny'};});
 // The signed file is always handled by the verified local download queue.
 win.on('closed',()=>{if(authorizationWindow===win)authorizationWindow=null;});await win.loadURL(page);
}
if (primary) app.whenReady().then(async () => {
 if(process.defaultApp)protocolRegistered=app.setAsDefaultProtocolClient('nxm',process.execPath,[path.resolve(__dirname)]);else protocolRegistered=app.setAsDefaultProtocolClient('nxm');
 const authSession=session.fromPartition('persist:moddock-nexus-auth');
 authSession.on('will-download',event=>event.preventDefault());
 authSession.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
 const downloadSession = session.fromPartition('moddock-downloads');
 downloadSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => callback({ cancel: !downloadAllowed(details.url) }));
 const dataRoot = process.env.MODDOCK_DATA || path.join(app.getPath('userData'), 'data');
 const tokenStore = createAccountTokenStore(path.join(dataRoot, 'account-session.bin'), safeStorage);
 const sourceKeyStore = createSourceKeyStore(path.join(dataRoot, 'source-credentials'), safeStorage);
 const openNexusSso = url => {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://www.nexusmods.com' || parsed.pathname !== '/sso') throw new Error('无效的 Nexus 授权地址');
  return shell.openExternal(parsed.href);
 };
 const chooseScanDirectory = async () => {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('主窗口尚未就绪，请稍后重试');
  const result = await dialog.showOpenDialog(mainWindow, { title: '添加 Steam 游戏库', buttonLabel: '添加游戏库', message: '选择 Steam 游戏库、steamapps 或其中的游戏文件夹', properties: ['openDirectory', 'dontAddToRecent'] });
  return result.canceled ? null : result.filePaths[0];
 };
 service = await createServer({ port: 0, root: dataRoot, accounts: { tokenStore }, sourceKeyStore, chooseScanDirectory, nexusSso: { openBrowser: openNexusSso }, reveal: file => shell.showItemInFolder(file), authorize, protocolStatus:()=>protocolRegistered, sources: { fetch: (url, init) => net.fetch(String(url), init) }, downloads: { fetch: (url, init) => downloadSession.fetch(String(url), { ...init, redirect: 'follow' }) } });
 mainWindow = new BrowserWindow({ width: 1440, height: 940, minWidth: 1000, minHeight: 700, title: '游匣 · MODDOCK', titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#eef1ee', height: 40 }, backgroundColor: '#101215', autoHideMenuBar: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
 mainWindow.on('closed',()=>{mainWindow=null;if(authorizationWindow&&!authorizationWindow.isDestroyed())authorizationWindow.close();});
 mainWindow.webContents.setWindowOpenHandler(({ url }) => {
  if (Object.values(service.accountLegalUrls).includes(url) || externalAllowed(url)) void shell.openExternal(url).catch(() => {});
  return { action: 'deny' };
 });
 mainWindow.webContents.on('will-navigate', (event, target) => { target=event.url||target; if (!target.startsWith(service.url + '/')) event.preventDefault(); });
 await mainWindow.loadURL(service.url);
 for(const arg of process.argv)if(/^nxm:\/\//i.test(arg))pending.push(arg);
 for(const value of pending.splice(0))receive(value);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => service?.server.close());
