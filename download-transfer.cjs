const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const crypto = require('node:crypto');
const { setTimeout: wait } = require('node:timers/promises');
const { assertSize } = require('./archive-limits.cjs');

function temporary(error) {
 return [408, 429, 500, 502, 503, 504].includes(error?.status) ||
  ['account_timeout', 'account_unavailable', 'nexus_unavailable', 'DOWNLOAD_IDLE', 'DOWNLOAD_SHORT'].includes(error?.code) ||
  error instanceof TypeError || error?.name === 'TimeoutError' ||
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|UND_ERR/.test(error?.cause?.code || error?.code || '');
}
function failure(code, message) { return Object.assign(new Error(message), { code }); }

// A transfer retry reuses the prepared file; it never requests a new authorization.
async function transfer({ file, partial, signal, open, maxBytes, onProgress, retries = 3, retryDelay = 1000, idleMs = 60000 }) {
 let bytes = 0, total = file.size || null, validator;
 for (let attempt = 0; ; attempt++) {
  signal.throwIfAborted();
  const ctrl = new AbortController(); let timer, handle, response;
  const combined = AbortSignal.any([signal, ctrl.signal]);
  const idle = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(failure('DOWNLOAD_IDLE', '下载连接长时间没有数据')), idleMs); };
  try {
   const offset = bytes;
   const headers = offset ? { Range: `bytes=${offset}-`, ...(validator ? { 'If-Range': validator } : {}) } : {};
   idle(); response = await open(combined, headers);
   if (!response.ok) throw Object.assign(new Error(`下载失败（HTTP ${response.status}）`), { status: response.status, retryAfterSeconds: Number(response.headers.get('retry-after')) || 0 });
   if (/text\/html|application\/json/i.test(response.headers.get('content-type') || '')) throw failure('DOWNLOAD_CONTENT', '来源返回了网页，没有返回 Mod 文件');
   const etag = response.headers.get('etag'), modified = response.headers.get('last-modified');
   const currentValidator = etag && !etag.startsWith('W/') ? etag : modified;
   const lengthHeader = response.headers.get('content-length');
   const length = lengthHeader === null ? null : Number(lengthHeader);
   let expected;
   if (response.status === 206) {
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
    if (!range || Number(range[1]) !== offset || Number(range[2]) < offset || Number(range[2]) >= Number(range[3]) ||
     (length !== null && Number(range[2]) - offset + 1 !== length) ||
     (total && total !== Number(range[3])) || (validator && currentValidator && validator !== currentValidator)) {
     throw failure('DOWNLOAD_RANGE', '续传响应不匹配，已停止下载以保护文件完整性');
    }
    total = Number(range[3]); expected = Number(range[2]) + 1;
   } else if (response.status === 200) {
    // A server without Range support may return the complete representation.
    bytes = 0; total = length || file.size || null; expected = length;
   } else throw failure('DOWNLOAD_RANGE', '下载服务器返回了不支持的响应');
   assertSize(total, maxBytes, '下载文件体积', file.name);
   if (file.size && file.sizeExact !== false && total && file.size !== total) throw failure('DOWNLOAD_SIZE', '文件大小校验失败，来源声明的体积不一致');
   validator = currentValidator;
   handle = await fs.open(partial, response.status === 206 && offset ? 'a' : 'w');
   await onProgress(bytes, total, attempt ? '已连接原文件，继续下载' : '正在下载');
   for await (const chunk of response.body) {
    combined.throwIfAborted(); idle();
    assertSize(bytes + chunk.length, maxBytes, '下载文件体积', file.name);
    if (expected != null && bytes + chunk.length > expected) throw failure('DOWNLOAD_SIZE', '下载数据超出声明体积');
    await handle.writeFile(chunk); bytes += chunk.length;
    await onProgress(bytes, total);
   }
   combined.throwIfAborted();
   if (!bytes || (expected != null && bytes !== expected) || (file.sizeExact !== false && total && bytes !== total)) throw failure('DOWNLOAD_SHORT', '文件大小校验失败，下载尚未完成，正在恢复连接');
   if (expected == null && file.sizeExact === false) total = bytes;
   if (file.size && file.sizeExact !== false && file.size !== bytes) throw failure('DOWNLOAD_SIZE', '文件大小校验失败，下载未完成');
   await handle.sync(); await handle.close(); handle = null;
   const sha = crypto.createHash('sha256'), md5 = crypto.createHash('md5');
   for await (const chunk of createReadStream(partial)) { signal.throwIfAborted(); sha.update(chunk); md5.update(chunk); }
   return { bytes, total, sha256: sha.digest('hex'), md5: md5.digest('hex') };
  } catch (error) {
   const reason = ctrl.signal.aborted ? ctrl.signal.reason : error;
   await handle?.close().catch(() => {}); handle = null;
   await response?.body?.cancel?.().catch(() => {});
   signal.throwIfAborted();
   if (attempt >= retries || !temporary(reason)) throw reason;
   // Without a trusted digest or validator, restarting is safer than appending.
   if (!file.sha256 && !file.md5 && !validator) bytes = 0;
   clearTimeout(timer);
   await onProgress(bytes, total, `连接中断，正在重连原文件（${attempt + 1}/${retries}）`);
   signal.throwIfAborted();
   await wait(Math.max(Math.min(retryDelay * 2 ** attempt, 10000), Math.min((reason.retryAfterSeconds || 0) * 1000, 120000)), undefined, { signal });
  } finally { clearTimeout(timer); await handle?.close().catch(() => {}); }
 }
}
module.exports = { transfer, temporary };
