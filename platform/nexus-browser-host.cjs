const net = require('node:net');
const fs = require('node:fs/promises');
const { BrowserChannel, unavailable } = require('./browser-channel.cjs');

async function createBrowserHost({ socketPath, authorizer, verification, maintenance, importSession }) {
 let peer;
 const entries = new Map();
 const server = net.createServer(socket => {
  if (peer) { socket.destroy(); return; }
  const channel = peer = new BrowserChannel(socket);
  const heartbeat = setInterval(() => channel.notify('heartbeat'), 2000); heartbeat.unref();
  channel.handle = async (method, input) => {
   if (channel !== peer) throw unavailable();
   if (method === 'import') { await importSession?.(); return { ok: true }; }
   if (method === 'maintenance') {
    const value = await maintenance?.(!!input?.screenshot);
    return input?.screenshot ? value?.toString('base64') || null : value || { active: false };
   }
   if (method === 'cancel') {
    if (input?.jobId && !/^[a-f0-9-]{36}$/.test(input.jobId)) throw unavailable();
    authorizer.cancel('platform', input?.jobId); return { ok: true };
   }
   if (!/^[a-f0-9-]{36}$/.test(input?.jobId || '')) throw unavailable();
   if (method === 'view') return verification.view(input.jobId);
   if (method === 'click') return verification.click(input.jobId, input.input);
   if (method !== 'open' || typeof input.page !== 'string' || input.page.length > 2048 || entries.size >= 20) throw unavailable();
   if (entries.has(input.jobId)) return { ok: true };
   const context = { owner: 'platform', jobId: input.jobId,
    isCurrent: () => peer === channel && entries.get(input.jobId) === context,
    receive: value => channel.request('grant', { jobId: input.jobId, value }, 10000),
    onState: state => {
     channel.notify('state', { jobId: input.jobId, state });
     if (['authorized', 'failed', 'cancelled'].includes(state)) entries.delete(input.jobId);
    },
   };
   entries.set(input.jobId, context);
   void authorizer.open(input.page, context).catch(() => context.onState('failed'));
   return { ok: true };
  };
  channel.on('close', () => {
   clearInterval(heartbeat);
   if (peer !== channel) return;
   peer = null; entries.clear(); authorizer.close();
  });
  channel.notify('ready', { pid: process.pid });
 });
 const namedPipe = process.platform === 'win32' && socketPath.startsWith('\\\\.\\pipe\\');
 if (!namedPipe) try {
  const stat = await fs.lstat(socketPath);
  if (!stat.isSocket() || stat.uid !== process.getuid?.()) throw new Error('Invalid browser socket');
  const live = await new Promise(resolve => {
   const socket = net.createConnection(socketPath);
   socket.once('connect', () => { socket.destroy(); resolve(true); });
   socket.once('error', error => resolve(error.code !== 'ECONNREFUSED' && error.code !== 'ENOENT'));
  });
  if (live) throw new Error('Browser socket is already active');
  await fs.unlink(socketPath);
 } catch (error) { if (error.code !== 'ENOENT') throw error; }
 await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
 if (!namedPipe) await fs.chmod(socketPath, 0o600);
 return { server, async close() { peer?.close(); authorizer.close(); await new Promise(resolve => server.close(resolve)); if (!namedPipe) await fs.rm(socketPath, { force: true }); } };
}
module.exports = { createBrowserHost };
