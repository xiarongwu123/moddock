const { setTimeout: wait } = require('node:timers/promises');
const { temporary } = require('./download-transfer.cjs');

function authorizationQueue() {
 let active = false; const queue = [];
 function next() {
  if (active) return;
  const entry = queue.shift(); if (!entry) return;
  entry.signal?.removeEventListener('abort', entry.abort);
  active = true; let released = false;
  entry.resolve(() => { if (released) return; released = true; active = false; next(); });
 }
 return signal => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const entry = { resolve, signal, abort() { const index = queue.indexOf(entry); if (index >= 0) queue.splice(index, 1); reject(signal.reason); } };
  signal?.addEventListener('abort', entry.abort, { once: true }); queue.push(entry); next();
 });
}

function platformDownloads(request, options) {
 const acquire = authorizationQueue(), retained = new Map();
 return {
  async downloadFile(game, resourceId, fileId, { signal, onProgress } = {}) {
   const match = resourceId.match(/^nexus:([a-z0-9_-]+):([1-9]\d*)$/);
   if (!match || game.nexus !== match[1] || !/^[1-9]\d*$/.test(String(fileId))) throw new Error('Invalid Nexus service file');
   await onProgress?.('正在排队等待来源授权', { verification: null });
   const release = await acquire(signal), key = resourceId + ':' + fileId;
   let job = retained.get(key), cancellation;
   const cancel = () => {
    if (!cancellation && job?.id && /^[a-f0-9-]{36}$/.test(job.id)) cancellation = request('/jobs/' + job.id, { method: 'DELETE' }).catch(() => {});
    return cancellation;
   };
   try {
    if (!job) job = await (await request('/jobs', { method: 'POST', body: JSON.stringify({ domain: match[1], modId: match[2], fileId: String(fileId) }), signal })).json();
    if (!/^[a-f0-9-]{36}$/.test(job.id)) throw new Error('Invalid service job response');
    retained.set(key, job);
    const jobId = job.id, started = Date.now();
    signal?.addEventListener('abort', cancel, { once: true });
    signal?.throwIfAborted();
    while (job.status !== 'completed') {
     if (['failed', 'cancelled', 'expired'].includes(job.status)) throw Object.assign(new Error(job.message || '下载服务暂时无法准备文件，请稍后重试'), { code: 'NEXUS_JOB_TERMINAL' });
     if (Date.now() - started > (options.timeout || 60 * 60 * 1000)) throw new Error('下载服务准备文件超时，请稍后重试');
     await onProgress?.(job.message, { verification: job.verificationRequired === true ? jobId : null });
     await wait(options.interval || 2000, undefined, { signal });
     const reconnectStarted = Date.now(); let failures = 0;
     for (;;) {
      try { job = await (await request('/jobs/' + jobId, { signal })).json(); break; }
      catch (error) {
       const retryable = temporary(error);
       if (!retryable || signal?.aborted || Date.now() - reconnectStarted >= (options.reconnectTimeout ?? 90000)) throw error;
       await onProgress?.('与 MU 下载服务的连接暂时中断，正在自动重连原任务…', { verification: job.verificationRequired === true ? jobId : null });
       await wait(Math.max(Math.min((options.interval || 2000) * 2 ** Math.min(failures++, 3), 10000), Math.min((error.retryAfterSeconds || 0) * 1000, 120000)), undefined, { signal });
      }
     }
     if (job.id !== jobId) throw new Error('Invalid service job response');
     retained.set(key, job);
    }
    if (!/^[a-f0-9]{64}$/.test(job.sha256) || !Number.isSafeInteger(job.size) || job.size <= 0) throw new Error('Invalid service file response');
    return { name: job.name, size: job.size, version: job.version, sha256: job.sha256, _open: async (controllerSignal, headers) => {
     try { return await request('/jobs/' + jobId + '/file', { signal: controllerSignal, headers }); }
     catch (error) { if ([404, 410].includes(error.status)) retained.delete(key); throw error; }
    } };
   } catch (error) {
    if (signal?.aborted) { await cancel(); retained.delete(key); }
    else if (!temporary(error)) retained.delete(key);
    throw error;
   } finally { signal?.removeEventListener('abort', cancel); release(); }
  },
  async verification(jobId, input, { signal } = {}) {
   if (!/^[a-f0-9-]{36}$/.test(jobId)) throw new Error('Invalid verification job');
   return (await request('/jobs/' + jobId + '/verification' + (input ? '/click' : ''), { signal, ...(input ? { method: 'POST', body: JSON.stringify(input) } : {}) })).json();
  },
 };
}
function createMuNexusPlatformClient(request, options = {}) {
 return platformDownloads((route, init) => request(route.slice(1), init), options);
}
function createNexusPlatformClient(config, options = {}) {
 const base = new URL(config.url);
 if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.pathname !== '/' || base.search || base.hash || base.username || base.password || !base.port || !/^[a-f0-9]{64}$/.test(config.accessToken)) throw new Error('Invalid local Nexus test service configuration');
 const fetch = options.fetch || globalThis.fetch;
 async function request(route, init = {}) {
  const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), 15000); let response;
  try { response = await fetch(new URL(route, base), { ...init, redirect: 'error', signal: init.signal ? AbortSignal.any([init.signal, timeout.signal]) : timeout.signal, headers: { ...init.headers, 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.accessToken } }); }
  finally { clearTimeout(timer); }
  if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error('下载服务暂不可用，请稍后重试'), { status: response.status, retryAfterSeconds: Number(response.headers.get('retry-after')) || 0 }); }
  return response;
 }
 return platformDownloads(request, options);
}
module.exports = { createNexusPlatformClient, createMuNexusPlatformClient };
