const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { Downloads } = require('../downloads.cjs');
const { parseNxm, authorizationPage } = require('../nxm.cjs');
const { setTimeout: wait } = require('node:timers/promises');
const path = require('node:path');

const messages = {
 queued: '下载服务正在排队准备文件', waiting: '下载服务正在准备文件', submitted: '正在等待来源下载倒计时',
 login_required: '下载服务等待维护方恢复会话', verification_required: '下载服务等待维护方完成来源验证',
 manual_required: '下载服务等待维护方确认来源页面', failed: '下载服务暂时无法获取文件，请稍后重试', cancelled: '文件准备已取消',
};
async function createNexusService({ root, sources, authorizer, accessToken, fetch, port = 0, requireOwner = false, host = '127.0.0.1', maintenance }) {
 if (host !== '127.0.0.1' && !/^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) throw new Error('Private service bind address required');
 if (!/^[a-f0-9]{64}$/.test(accessToken)) throw new Error('Invalid private service token');
 const readers = new Map();
 let downloads;
 const beforeDownload = requireOwner ? async file => {
  const required = Number(file.size) || 5 * 1024 ** 3, margin = 512 * 1024 ** 2;
  const completed = downloads.jobs.filter(job => job.status === 'completed');
  let cached = completed.reduce((sum, job) => sum + job.bytes, 0), disk = await fs.statfs(root);
  for (const job of completed.slice().reverse()) {
   if (cached + required <= 6 * 1024 ** 3 && disk.bavail * disk.bsize >= required + margin && Date.now() - Date.parse(job.finished) < 86400000) continue;
   if (readers.get(job.id) || Date.now() - Date.parse(job.finished) < 60000 || !/^[a-f0-9-]{36}$/.test(job.id)) continue;
   await fs.rm(path.join(downloads.root, job.id), { recursive: true, force: true }); cached -= job.bytes; job.status = 'expired'; job.message = '后台缓存已清理，可重新下载'; delete job.path;
   disk = await fs.statfs(root);
  }
  await downloads.save();
  if (cached + required > 6 * 1024 ** 3 || disk.bavail * disk.bsize < required + margin) throw new Error('下载服务存储空间暂不足，请稍后重试');
 } : undefined;
 downloads = await new Downloads(root, sources, { fetch, maxParallel: requireOwner ? 1 : 3, beforeDownload }).open();
 for (const job of downloads.jobs) if (job.status === 'authorization_required') { job.status = 'failed'; job.message = '后台服务已重启，请重新下载'; }
 await downloads.save();
 downloads.onAuthorizationRequired = async job => {
  const resource = sources.resource(job.game, job.resourceId);
  await authorizer.open(authorizationPage(job.resourceId, job.fileId), {
   owner: 'platform', jobId: job.id, isCurrent: () => job.status === 'authorization_required',
   receive: value => {
    const grant = parseNxm(value);
    if (grant.domain !== resource.domain || grant.modId !== resource.id || grant.fileId !== job.fileId) throw new Error('NXM file does not match the service job');
    return downloads.resumeAuthorization(job.game, job.resourceId, job.fileId, grant);
   },
   onState: async state => { if (job.status === 'authorization_required' && messages[state]) { if (state === 'cancelled') downloads.cancel(job.id); else { if (state === 'failed') job.status = 'failed'; job.message = messages[state]; await downloads.save(); } } },
  });
 };
 const publicJob = job => ({ id: job.id, status: job.status, message: job.status === 'failed' ? '下载服务暂时无法准备文件，请稍后重试' : job.message, bytes: job.bytes, total: job.total, ...(job.status === 'completed' ? { name: job.filename, size: job.bytes, version: job.version, sha256: job.sha256 } : {}) });
 const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  const send = (body, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  try {
   if (req.headers.host !== `${host}:${server.address().port}` || req.headers.origin) return send({ error: 'Forbidden' }, 403);
   const supplied = Buffer.from(req.headers.authorization || ''), expected = Buffer.from('Bearer ' + accessToken);
   if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return send({ error: 'Unauthorized' }, 401);
   const owner = req.headers['x-mu-account-id'] || (!requireOwner ? 'platform-test' : null);
   if (typeof owner !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(owner)) return send({ error: 'Invalid owner' }, 400);
   const url = new URL(req.url, 'http://' + req.headers.host);
   if (req.method === 'GET' && maintenance && url.pathname === '/maintenance') return send(await maintenance(false));
   if (req.method === 'GET' && maintenance && url.pathname === '/maintenance/screenshot') { const bytes = await maintenance(true); if (!bytes) return send({ error: 'No maintenance window' }, 404); res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(bytes); return; }
   if (req.method === 'GET' && url.pathname === '/status') return send({ ready: !!sources.keys.nexus, pending: downloads.jobs.filter(job => ['queued', 'running', 'authorization_required'].includes(job.status)).length });
   if (req.method === 'POST' && url.pathname === '/jobs') {
    if (downloads.jobs.filter(job => job.owner === owner && ['queued', 'running', 'authorization_required'].includes(job.status)).length >= 3) return send({ error: '当前账号的下载服务正在准备多个文件，请稍后重试' }, 429);
    if (downloads.jobs.filter(job => ['queued', 'running', 'authorization_required'].includes(job.status)).length >= 20) return send({ error: '下载服务繁忙，请稍后重试' }, 429);
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4096) return send({ error: 'Request too large' }, 413); }
    const input = JSON.parse(body);
    if (!/^[a-z0-9_-]{1,80}$/.test(input.domain || '') || !/^[1-9]\d{0,14}$/.test(String(input.modId)) || !/^[1-9]\d{0,14}$/.test(String(input.fileId))) return send({ error: 'Invalid file' }, 400);
    const game = { id: 'platform:' + crypto.randomUUID(), name: input.domain, nexus: input.domain };
    const job = downloads.start(game, `nexus:${input.domain}:${input.modId}`, String(input.fileId), 'Nexus file');
    const stored = downloads.jobs.find(item => item.id === job.id); stored.owner = owner; await downloads.save(); return send(publicJob(stored), 202);
   }
   const match = url.pathname.match(/^\/jobs\/([a-f0-9-]{36})(\/file)?$/), job = match && downloads.jobs.find(item => item.id === match[1]);
   if (!job || (job.owner || 'platform-test') !== owner) return send({ error: 'Not found' }, 404);
   if (req.method === 'GET' && !match[2]) return send(publicJob(job));
   if (req.method === 'DELETE' && !match[2]) { downloads.cancel(job.id); authorizer.cancel('platform', job.id); return send({ ok: true }); }
   if (req.method === 'GET' && match[2]) {
    if (job.status !== 'completed') return send({ error: 'File not ready' }, 409);
    const file = await downloads.completedFile(job.id), stat = await fs.stat(file.file);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': stat.size, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}` });
    const stream = createReadStream(file.file); readers.set(job.id, (readers.get(job.id) || 0) + 1); stream.on('error', () => res.destroy()); res.on('close', () => { readers.set(job.id, Math.max(0, (readers.get(job.id) || 1) - 1)); stream.destroy(); }); stream.pipe(res); return;
   }
   return send({ error: 'Method not allowed' }, 405);
  } catch { if (!res.headersSent) send({ error: '下载服务请求失败，请稍后重试' }, 400); else res.destroy(); }
 });
 await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
 return { server, downloads, url: `http://${host}:${server.address().port}`, async close() { authorizer.close(); for (const job of downloads.jobs) if (['queued', 'running', 'authorization_required'].includes(job.status)) downloads.cancel(job.id); for (let n = 0; downloads.controllers.size && n < 100; n++) await wait(50); await downloads.persist; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
module.exports = { createNexusService };
