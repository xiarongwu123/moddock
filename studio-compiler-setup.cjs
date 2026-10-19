const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { extract } = require('./installers.cjs');
const SDK = Object.freeze({ version: '8.0.426',
 url: 'https://builds.dotnet.microsoft.com/dotnet/Sdk/8.0.426/dotnet-sdk-8.0.426-win-x64.zip',
 sha512: '10261657109f1c62126f106a9ac966739b025b5f6b4a9f88ab7c6e73cacce9aec771895daa3267b8da933a83c32ee91bf458dc6704e1ddcd9bcf0d5edd036abb' });
const flights = new Map();
function prepareCompiler(directory, context, options = {}) {
 if (flights.has(directory)) return flights.get(directory).then(async result => { await context.authorize(); return result; });
 const pending = install(directory, context, options).finally(() => { if (flights.get(directory) === pending) flights.delete(directory); });
 flights.set(directory, pending); return pending;
}
async function install(directory, context, options) {
 const sdk = options.sdk || SDK, destination = path.join(directory, 'dotnet'), executable = path.join(destination, 'dotnet.exe');
 const check = async () => { context.signal?.throwIfAborted(); if (!context.current()) throw new Error('账号已切换'); await context.authorize(); if (!context.current()) throw new Error('账号已切换'); };
 await check();
 try { const stat = await fs.lstat(executable); if (stat.isFile() && !stat.isSymbolicLink()) return { executable, version: sdk.version }; } catch (e) { if (e.code !== 'ENOENT') throw e; }
 await fs.mkdir(directory, { recursive: true });
 const stage = await fs.mkdtemp(path.join(directory, 'compiler-')), archive = path.join(stage, 'sdk.zip');
 const signal = context.signal ? AbortSignal.any([context.signal, AbortSignal.timeout(240000)]) : AbortSignal.timeout(240000);
 try {
  let url = sdk.url, response;
  for (let redirects = 0; redirects <= 5; redirects++) {
   const parsed = new URL(url);
   if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !['builds.dotnet.microsoft.com', 'dotnetcli.blob.core.windows.net'].includes(parsed.hostname)) throw new Error('编译器来源未核对');
   response = await (options.fetch || fetch)(url, { redirect: 'manual', signal });
   if (![301, 302, 303, 307, 308].includes(response.status)) break;
   const next = response.headers.get('location'); await response.body?.cancel(); if (!next) throw new Error('编译器下载地址无效'); url = new URL(next, url).href;
  }
  if (!response?.ok || !response.body) throw new Error('自动准备 C# 编译器失败，请检查网络后重试');
  let size = 0; const digest = crypto.createHash('sha512'), file = await fs.open(archive, 'wx');
  try {
   for await (const chunk of response.body) { size += chunk.length; if (size > 350 * 1024 ** 2) throw new Error('编译器下载大小超限'); digest.update(chunk); await file.writeFile(chunk); }
  } finally { await file.close(); }
  if (digest.digest('hex') !== sdk.sha512) throw new Error('Microsoft C# 编译器下载校验失败');
  await check();
  const payload = path.join(stage, 'payload'); await extract(archive, payload);
  for (const name of ['dotnet.exe', `sdk/${sdk.version}/Roslyn/bincore/csc.dll`]) if (!(await fs.lstat(path.join(payload, name))).isFile()) throw new Error('编译器包结构无效');
  await check(); await fs.rename(payload, destination);
  return { executable, version: sdk.version };
 } finally { await fs.rm(stage, { recursive: true, force: true }); }
}
module.exports = { SDK, prepareCompiler };
