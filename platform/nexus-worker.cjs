const { app, BrowserWindow, session, safeStorage, net } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Sources, downloadAllowed } = require('../sources.cjs');
const { createSourceKeyStore } = require('../source-key-store.cjs');
const { NexusAuthorizer } = require('../nexus-authorization.cjs');
const { createNexusService } = require('./nexus-service.cjs');
const { createPlatformEncryption } = require('./secret-store.cjs');
const root = process.env.MODDOCK_NEXUS_SERVICE_DATA;
if (!root || !path.isAbsolute(root)) throw new Error('MODDOCK_NEXUS_SERVICE_DATA must be an absolute private directory');
require('node:fs').mkdirSync(path.join(root, 'browser'), { recursive: true, mode: 0o700 });
app.setName('moddock'); app.setPath('userData', path.join(root, 'browser'));
const official = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && ['www.nexusmods.com', 'nexusmods.com', 'users.nexusmods.com'].includes(url.hostname); } catch { return false; } };
let service, authorizer, websiteSession, maintenanceWindow;
app.whenReady().then(async () => {
 await fs.mkdir(root, { recursive: true, mode: 0o700 });
 const store = createSourceKeyStore(path.join(root, 'credentials'), process.env.MODDOCK_NEXUS_SERVER === '1' ? await createPlatformEncryption(root) : safeStorage);
 let imported;
 if (process.env.MODDOCK_NEXUS_IMPORT_FILE) {
  try { imported = JSON.parse(await fs.readFile(process.env.MODDOCK_NEXUS_IMPORT_FILE, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (imported) { await store.write('nexus-platform-test', { nexus: imported.key }); imported.key = ''; }
 }
 let keys = await store.read('nexus-platform-test');
 if (!keys.nexus && process.env.MODDOCK_NEXUS_IMPORT_ROOT && process.env.MODDOCK_NEXUS_IMPORT_OWNER) {
  const previous = createSourceKeyStore(path.join(process.env.MODDOCK_NEXUS_IMPORT_ROOT, 'source-credentials'), safeStorage);
  keys = await previous.read(process.env.MODDOCK_NEXUS_IMPORT_OWNER);
  if (!keys.nexus) throw new Error('No encrypted Nexus test key to import');
  await store.write('nexus-platform-test', { nexus: keys.nexus });
 }
 if (!keys.nexus) throw new Error('Provision the encrypted service key before starting the worker');
 const sources = new Sources({ fetch: (url, init) => net.fetch(url, init) }); sources.connect('nexus', keys.nexus); keys.nexus = '';
 const account = await sources.request('https://api.nexusmods.com/v1/users/validate.json', { headers: { apikey: sources.keys.nexus } });
 const website = websiteSession = session.fromPartition('persist:moddock-platform-nexus');
 if (imported) {
  for (const cookie of imported.cookies || []) {
   if (typeof cookie.domain !== 'string' || !(cookie.domain === 'nexusmods.com' || cookie.domain.endsWith('.nexusmods.com'))) continue;
   const fields = { url: 'https://' + cookie.domain.replace(/^\./, '') + (cookie.path || '/'), name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path, secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite };
   if (cookie.expirationDate) fields.expirationDate = cookie.expirationDate;
   await website.cookies.set(fields);
  }
  await website.cookies.flushStore(); imported.cookies = []; await fs.rm(process.env.MODDOCK_NEXUS_IMPORT_FILE); imported = null;
 }
 website.setPermissionRequestHandler((_contents, _permission, callback) => callback(false)); website.on('will-download', event => event.preventDefault());
 const transfers = session.fromPartition('moddock-platform-transfers');
 transfers.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => callback({ cancel: !downloadAllowed(details.url) }));
 authorizer = new NexusAuthorizer({ isAllowed: official, timeout: 60 * 60 * 1000, diagnostic: result => { if (process.env.MODDOCK_NEXUS_DIAGNOSTICS === '1') process.stdout.write(JSON.stringify({ diagnostic: result }) + '\n'); }, createWindow: () => {
  const window = maintenanceWindow = new BrowserWindow({ show: false, width: 1100, height: 850, title: 'Nexus 后台维护 · 仅维护方操作', autoHideMenuBar: true, webPreferences: { partition: 'persist:moddock-platform-nexus', contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  window.on('closed', () => { if (maintenanceWindow === window) maintenanceWindow = null; });
  window.on('page-title-updated', event => event.preventDefault()); return window;
 } });
 let tokenBytes;
 try { tokenBytes = await fs.readFile(path.join(root, 'backend-token.bin')); }
 catch (error) { if (error.code !== 'ENOENT') throw error; tokenBytes = crypto.randomBytes(32); await fs.writeFile(path.join(root, 'backend-token.bin'), tokenBytes, { flag: 'wx', mode: 0o600 }); }
 if (tokenBytes.length !== 32) throw new Error('Invalid private backend token');
 const accessToken = tokenBytes.toString('hex');
 service = await createNexusService({ root, sources, authorizer, accessToken, requireOwner: process.env.MODDOCK_NEXUS_SERVER === '1', host: process.env.MODDOCK_NEXUS_HOST || '127.0.0.1', port: Number(process.env.MODDOCK_NEXUS_PORT || 0), fetch: (url, init) => transfers.fetch(url, { ...init, redirect: 'follow' }), maintenance: async screenshot => {
  if (!maintenanceWindow || maintenanceWindow.isDestroyed()) return screenshot ? null : { active: false };
  if (screenshot) return (await maintenanceWindow.webContents.capturePage()).toPNG();
  const url = new URL(maintenanceWindow.webContents.getURL());
  const controls = await maintenanceWindow.webContents.executeJavaScript(`(() => { const roots=[document]; for(const root of roots)for(const el of root.querySelectorAll('*'))if(el.shadowRoot)roots.push(el.shadowRoot); return roots.flatMap(root=>[...root.querySelectorAll('button,a,[role="button"],input[type="button"]')]).map(el=>({label:String(el.getAttribute('aria-label')||el.innerText||el.textContent||el.value||'').replace(/\\s+/g,' ').trim(),visible:el.checkVisibility({opacityProperty:true,visibilityProperty:true}),top:Math.round(el.getBoundingClientRect().top)})).filter(el=>/download|slow/i.test(el.label)).map(el=>({...el,label:el.label.slice(0,80)})).slice(0,20); })()`);
  return { active: true, state: authorizer.active?.state, page: url.origin + url.pathname, fileId: url.searchParams.get('file_id'), manager: url.searchParams.get('nmm'), controls, sandbox: maintenanceWindow.webContents.getLastWebPreferences().sandbox };
 } });
 await fs.writeFile(path.join(root, 'client.json'), JSON.stringify({ url: service.url, accessToken }), { mode: 0o600 });
 if (process.env.MODDOCK_NEXUS_IMPORT_ROOT && process.env.MODDOCK_NEXUS_IMPORT_OWNER) {
  const previous = createSourceKeyStore(path.join(process.env.MODDOCK_NEXUS_IMPORT_ROOT, 'source-credentials'), safeStorage);
  const old = await previous.read(process.env.MODDOCK_NEXUS_IMPORT_OWNER); await previous.write(process.env.MODDOCK_NEXUS_IMPORT_OWNER, { ...old, nexus: '' });
 }
 process.stdout.write(JSON.stringify({ ready: true, url: service.url, accountId: account.user_id, premium: !!account.is_premium, config: path.join(root, 'client.json') }) + '\n');
}).catch(error => { process.stderr.write(error.message + '\n'); app.quit(); });
app.on('window-all-closed', () => {});
process.on('SIGTERM', () => app.quit());
let closing = false;
app.on('before-quit', event => { if (service && !closing) { event.preventDefault(); closing = true; void websiteSession.cookies.flushStore().catch(() => {}).then(() => service.close()).finally(() => app.quit()); } else authorizer?.close(); });
