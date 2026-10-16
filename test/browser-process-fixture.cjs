const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const { NexusAuthorizer } = require('../nexus-authorization.cjs');
const { createBrowserHost } = require('../platform/nexus-browser-host.cjs');
class Window extends EventEmitter {
 constructor() { super(); this.closed = false; this.webContents = new EventEmitter(); this.webContents.getURL = () => this.url; this.webContents.executeJavaScript = async () => ({ state: 'verification_required' }); this.webContents.setWindowOpenHandler = () => {}; }
 async loadURL(url) { this.url = url; }
 isDestroyed() { return this.closed; }
 show() {}
 focus() {}
 close() { this.closed = true; this.emit('closed'); }
}
(async () => {
 const authorizer = new NexusAuthorizer({ isAllowed: url => new URL(url).hostname === 'www.nexusmods.com', createWindow: () => new Window() });
 const revision = crypto.randomUUID();
 const verification = {
  async view(jobId) { return authorizer.active?.context.jobId === jobId ? { pending: true, revision, width: 200, height: 100, image: 'data:image/png;base64,dGVzdA==' } : { pending: false }; },
  async click(jobId, input) {
   const entry = authorizer.active;
   if (entry?.context.jobId !== jobId || input?.revision !== revision || input.x !== 40 || input.y !== 50) return false;
   const page = new URL(entry.page), [domain, , modId] = page.pathname.slice(1).split('/');
   await authorizer.accept(entry, `nxm://${domain}/mods/${modId}/files/${page.searchParams.get('file_id')}?key=fixture-grant&expires=${Math.floor(Date.now() / 1000) + 60}`);
   return true;
  },
 };
 const host = await createBrowserHost({ socketPath: process.argv[2], authorizer, verification, maintenance: async screenshot => screenshot ? Buffer.from('fixture-png') : { active: !!authorizer.active } });
 process.send({ ready: true });
 process.on('SIGTERM', () => { void host.close().then(() => process.exit(0)); });
})().catch(error => { console.error(error.message); process.exit(1); });
