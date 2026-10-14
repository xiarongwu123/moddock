const { setTimeout: wait } = require('node:timers/promises');

function platformDownloads(request, options) {
 return {
  async downloadFile(game, resourceId, fileId, { signal, onProgress } = {}) {
   const match = resourceId.match(/^nexus:([a-z0-9_-]+):([1-9]\d*)$/);
   if (!match || game.nexus !== match[1] || !/^[1-9]\d*$/.test(String(fileId))) throw new Error('Invalid Nexus service file');
   let job, cancellation;
   const cancel = () => {
    if (!cancellation && job?.id && /^[a-f0-9-]{36}$/.test(job.id)) cancellation = request('/jobs/' + job.id, { method: 'DELETE' }).catch(() => {});
    return cancellation;
   };
   try {
    job = await (await request('/jobs', { method: 'POST', body: JSON.stringify({ domain: match[1], modId: match[2], fileId: String(fileId) }), signal })).json();
    if (!/^[a-f0-9-]{36}$/.test(job.id)) throw new Error('Invalid service job response');
    const jobId = job.id, started = Date.now();
    signal?.addEventListener('abort', cancel, { once: true });
    signal?.throwIfAborted();
    while (job.status !== 'completed') {
     if (['failed', 'cancelled', 'expired'].includes(job.status)) throw new Error('下载服务暂时无法准备文件，请稍后重试');
     if (Date.now() - started > (options.timeout || 60 * 60 * 1000)) throw new Error('下载服务准备文件超时，请稍后重试');
     await onProgress?.(job.message);
     await wait(options.interval || 2000, undefined, { signal });
     job = await (await request('/jobs/' + jobId, { signal })).json();
     if (job.id !== jobId) throw new Error('Invalid service job response');
    }
    if (!/^[a-f0-9]{64}$/.test(job.sha256) || !Number.isSafeInteger(job.size) || job.size <= 0) throw new Error('Invalid service file response');
    return { name: job.name, size: job.size, version: job.version, sha256: job.sha256, _open: controllerSignal => request('/jobs/' + jobId + '/file', { signal: controllerSignal }) };
   } catch (error) {
    await cancel();
    throw error;
   } finally { signal?.removeEventListener('abort', cancel); }
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
  try { response = await fetch(new URL(route, base), { ...init, redirect: 'error', signal: init.signal ? AbortSignal.any([init.signal, timeout.signal]) : timeout.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.accessToken } }); }
  finally { clearTimeout(timer); }
  if (!response.ok) { await response.body?.cancel(); throw new Error('下载服务暂不可用，请稍后重试'); }
  return response;
 }
 return platformDownloads(request, options);
}
module.exports = { createNexusPlatformClient, createMuNexusPlatformClient };
