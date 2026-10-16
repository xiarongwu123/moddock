const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { NexusAuthorizer } = require('../nexus-authorization.cjs');
const { NexusVerification } = require('./nexus-verification.cjs');
const { createBrowserHost } = require('./nexus-browser-host.cjs');
const { authorizationRequestAllowed } = require('./nexus-browser-policy.cjs');
const root = process.env.MODDOCK_NEXUS_SERVICE_DATA;
if (!root || !path.isAbsolute(root)) throw new Error('MODDOCK_NEXUS_SERVICE_DATA must be an absolute private directory');
require('node:fs').mkdirSync(path.join(root, 'browser'), { recursive: true, mode: 0o700 });
app.setName('moddock'); app.setPath('userData', path.join(root, 'browser'));
const official = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && ['www.nexusmods.com', 'nexusmods.com', 'users.nexusmods.com'].includes(url.hostname); } catch { return false; } };
let host, authorizer, website, window;
app.whenReady().then(async () => {
 website = session.fromPartition('persist:moddock-platform-nexus');
 const blockedFrameHosts = new Set();
 website.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
  const allowed = authorizationRequestAllowed(details);
  if (!allowed && blockedFrameHosts.size < 64) { try { blockedFrameHosts.add(new URL(details.url).hostname); } catch {} }
  callback({ cancel: !allowed });
 });
 website.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
 website.on('will-download', event => event.preventDefault());
 authorizer = new NexusAuthorizer({ isAllowed: official, timeout: 60 * 60 * 1000, createWindow: () => {
  const created = window = new BrowserWindow({ show: false, width: 1100, height: 850, title: 'Nexus 后台维护 · 仅维护方操作', autoHideMenuBar: true, webPreferences: { partition: 'persist:moddock-platform-nexus', contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  created.on('closed', () => { if (window === created) window = null; });
  created.on('page-title-updated', event => event.preventDefault()); return created;
 } });
 host = await createBrowserHost({ socketPath: path.join(root, 'browser.sock'), authorizer, verification: new NexusVerification(authorizer),
  importSession: async () => {
   const file = process.env.MODDOCK_NEXUS_IMPORT_FILE; if (!file) return;
   let imported; try { imported = JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
   for (const cookie of imported.cookies || []) {
    if (typeof cookie.domain !== 'string' || !(cookie.domain === 'nexusmods.com' || cookie.domain.endsWith('.nexusmods.com'))) continue;
    const fields = { url: 'https://' + cookie.domain.replace(/^\./, '') + (cookie.path || '/'), name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path, secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite };
    if (cookie.expirationDate) fields.expirationDate = cookie.expirationDate;
    await website.cookies.set(fields);
   }
   await website.cookies.flushStore(); imported = null; await fs.rm(file);
  },
  maintenance: async screenshot => {
   const resources = () => ({ processRssMB: Math.round(app.getAppMetrics().reduce((sum, item) => sum + (item.memory?.workingSetSize || 0), 0) / 1024), blockedFrameHosts: [...blockedFrameHosts].sort() });
   if (!window || window.isDestroyed()) return screenshot ? null : { active: false, ...resources() };
   if (screenshot) return (await window.webContents.capturePage()).toPNG();
   const url = new URL(window.webContents.getURL());
   const controls = await window.webContents.executeJavaScript(`(() => { const roots=[document]; for(const root of roots)for(const el of root.querySelectorAll('*'))if(el.shadowRoot)roots.push(el.shadowRoot); return roots.flatMap(root=>[...root.querySelectorAll('button,a,[role="button"],input[type="button"]')]).map(el=>({label:String(el.getAttribute('aria-label')||el.innerText||el.textContent||el.value||'').replace(/\\s+/g,' ').trim(),visible:el.checkVisibility({opacityProperty:true,visibilityProperty:true}),top:Math.round(el.getBoundingClientRect().top)})).filter(el=>/download|slow/i.test(el.label)).map(el=>({...el,label:el.label.slice(0,80)})).slice(0,20); })()`);
   const frameHosts = [...new Set(window.webContents.mainFrame.framesInSubtree.map(frame => { try { return new URL(frame.url).hostname; } catch { return ''; } }).filter(Boolean))].sort();
   return { active: true, state: authorizer.active?.state, page: url.origin + url.pathname, fileId: url.searchParams.get('file_id'), manager: url.searchParams.get('nmm'), controls, frameHosts, ...resources(), sandbox: window.webContents.getLastWebPreferences().sandbox };
  },
 });
 console.log(JSON.stringify({ browserReady: true, pid: process.pid }));
}).catch(() => { console.error('Authorization browser initialization failed'); app.exit(1); });
app.on('window-all-closed', () => {});
process.on('SIGTERM', () => app.quit());
let closing = false;
app.on('before-quit', event => {
 if (!closing) { event.preventDefault(); closing = true; authorizer?.close(); void Promise.resolve().then(() => website?.cookies.flushStore()).catch(() => {}).then(() => host?.close()).finally(() => app.exit(0)); }
});
