const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const yauzl = require('yauzl');
const { target } = require('./installers.cjs');
const { isBG3 } = require('./bg3-mod.cjs');

// Pin reviewed official bytes; never follow an unverified "latest" executable.
const RELEASE = Object.freeze({ version: 'v33',
 url: 'https://github.com/Norbyte/bg3se/releases/download/v33/BG3SE-Updater-20261012.zip',
 page: 'https://github.com/Norbyte/bg3se/releases/tag/v33',
 size: 5849150, sha256: 'edc6cf20d5ee4e2529390251fa5783cfd0f1f378650ecced3d5d7f39e6b47c8f',
 dllSize: 6429184, dllSha256: '69352751162bf7e2adcd6f8ba2eed38ab4a150a605926d2cc44eb650e188ec31' });
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function pe64(bytes) {
 if (bytes.length < 256 || bytes.toString('ascii', 0, 2) !== 'MZ') return false;
 const offset = bytes.readUInt32LE(60);
 return offset >= 64 && offset + 26 <= bytes.length && bytes.toString('ascii', offset, offset + 4) === 'PE\0\0' && bytes.readUInt16LE(offset + 4) === 0x8664 && bytes.readUInt16LE(offset + 24) === 0x20b;
}
async function readFile(file, max) {
 const stat = await fs.lstat(file);
 if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max) throw new Error('组件路径不是普通文件或文件过大');
 return fs.readFile(file);
}
async function unpack(bytes, release = RELEASE) {
 if (bytes.length !== release.size || digest(bytes) !== release.sha256) throw new Error('Script Extender 下载包 SHA-256 校验失败，请重试');
 const zip = await yauzl.fromBufferPromise(bytes, { lazyEntries: true, validateEntrySizes: true });
 let dll, count = 0;
 try {
  for await (const entry of zip.eachEntry()) {
   const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
   if (++count !== 1 || entry.fileName !== 'DWrite.dll' || mode && mode !== 0x8000 || entry.uncompressedSize !== release.dllSize) throw new Error('官方组件压缩包结构不匹配');
   const chunks = []; let size = 0;
   for await (const chunk of await zip.openReadStreamPromise(entry)) {
    size += chunk.length; if (size > release.dllSize) throw new Error('组件解压大小超限'); chunks.push(chunk);
   }
   dll = Buffer.concat(chunks);
  }
 } finally { zip.close(); }
 if (!dll || dll.length !== release.dllSize || digest(dll) !== release.dllSha256 || !pe64(dll)) throw new Error('Script Extender DLL 完整性或架构校验失败');
 return dll;
}
async function download(fetcher, release, signal) {
 let url = release.url;
 const allowed = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
 for (let redirects = 0; redirects <= 5; redirects++) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !allowed.has(parsed.hostname)) throw new Error('官方组件下载地址无效');
  const response = await fetcher(url, { redirect: 'manual', signal, headers: { 'User-Agent': 'MODDOCK', Accept: 'application/octet-stream' } });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
   const location = response.headers.get('location'); await response.body?.cancel();
   if (!location) break; url = new URL(location, url).href; continue;
  }
  if (!response.ok || !response.body) throw new Error('官方组件下载失败，请检查网络后点一键重试');
  if (response.headers.get('content-length') && Number(response.headers.get('content-length')) !== release.size) { await response.body.cancel(); throw new Error('官方组件下载大小不匹配'); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > release.size) { await response.body.cancel().catch(() => {}); throw new Error('组件下载超过大小限制'); } chunks.push(chunk); }
  return Buffer.concat(chunks);
 }
 throw new Error('官方组件下载重定向异常');
}
function createElectronFetch(net) {
 // net.fetch cancels manual redirects. Preserve each redirect for host validation
 // using ClientRequest, while retaining Chromium's system proxy/TLS handling.
 return (url, init) => new Promise((resolve, reject) => {
  init.signal?.throwIfAborted();
  const request = net.request({ url, method: 'GET', redirect: 'manual', credentials: 'omit', headers: init.headers });
  let settled = false, incoming;
  const cleanup = () => init.signal?.removeEventListener('abort', abort);
  const abort = () => { const error = new Error('官方组件下载已取消或超时'); if (!settled) reject(error); incoming?.destroy(error); request.abort(); };
  init.signal?.addEventListener('abort', abort, { once: true });
  request.on('close', cleanup);
  request.on('error', () => { if (!settled) reject(new Error('无法下载官方组件，请检查网络后点一键重试')); incoming?.destroy(new Error('官方组件下载中断')); });
  request.on('redirect', (status, _method, location) => {
   settled = true; resolve(new Response(null, { status, headers: { location } }));
   request.abort();
  });
  request.on('response', response => {
   incoming = response;
   const headers = new Headers();
   for (const [name, value] of Object.entries(response.headers)) for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
   settled = true; resolve(new Response(Readable.toWeb(response), { status: response.statusCode, headers }));
  });
  request.end();
 });
}
class BG3Extender {
 constructor(root, installers, options = {}) {
  this.cache = path.join(root, 'bg3se'); this.installers = installers; this.options = options;
  this.release = options.release || RELEASE; this.queues = new Map();
 }
 async location(game) {
  if (!isBG3(game)) throw new Error('此组件仅用于博德之门 3');
  const root = await fs.realpath(game.installPath), bin = await target(root, 'bin');
  const names = await fs.readdir(bin);
  return { root, bin, names, loaders: names.filter(name => /^dwrite\.dll$/i.test(name)) };
 }
 async status(game) {
  if (!isBG3(game)) return { applicable: false };
  const supported = (this.options.platform || process.platform) === 'win32' && (this.options.arch || process.arch) === 'x64';
  const base = { applicable: true, supported, source: this.release.page, version: this.release.version, runtimeConfirmed: false };
  try {
   const { root, loaders } = await this.location(game);
   if (loaders.length > 1) throw new Error('检测到多个 DWrite.dll，请先处理文件冲突');
   if (loaders.length) {
    const bytes = await readFile(await target(root, 'bin/' + loaders[0]), 32 * 1024 ** 2), sha256 = digest(bytes);
    const text = bytes.toString('utf16le');
    if (!pe64(bytes) || sha256 !== this.release.dllSha256 && !(text.includes('Norbyte') && text.includes('BG3 Script Extender'))) throw new Error('bin/DWrite.dll 不是已识别的 BG3 Script Extender，已保留原文件并停止安装');
    return { ...base, status: 'ready', ready: true, sha256, version: sha256 === this.release.dllSha256 ? this.release.version : null,
     message: '已检测到 Script Extender，可直接创作和安装 Mod；实际加载待启动游戏确认。' };
   }
   return { ...base, status: supported ? 'missing' : 'unsupported', ready: false,
    message: supported ? '尚未安装 Script Extender，开始创作或安装 Mod 时会自动准备。' : 'Script Extender 自动安装适用于 Windows x64 版博德之门 3。' };
  } catch (error) { return { ...base, status: 'conflict', ready: false, message: error.message }; }
 }
 ensure(context) {
  const key = path.resolve(context.game.installPath), previous = this.queues.get(key) || Promise.resolve();
  const pending = previous.catch(() => {}).then(() => this.install(context)); this.queues.set(key, pending);
  return pending.finally(() => { if (this.queues.get(key) === pending) this.queues.delete(key); });
 }
 async install(context) {
  const { game } = context;
  if (!isBG3(game)) return { applicable: false };
  const authorize = async () => {
   if (!context.current?.() || context.signal?.aborted || typeof context.authorize !== 'function') throw new Error('账号已切换或操作已停止');
   await context.authorize('library.manage');
   if (!context.current() || context.signal?.aborted) throw new Error('账号已切换或操作已停止');
  };
  await authorize();
  const before = await this.status(game); if (before.ready) return before;
  if (before.status !== 'missing') throw new Error(before.message);
  const location = await this.location(game), profile = { mode: 'bg3', bg3GameRoot: location.root };
  await this.installers.guard(location.root, profile);
  const executables = location.names.filter(name => /^bg3(?:_dx11)?\.exe$/i.test(name));
  if (!executables.length) throw new Error('没有找到 BG3 Windows 启动文件，请重新扫描已安装的游戏');
  for (const name of executables) {
   const file = await target(location.root, 'bin/' + name), handle = await fs.open(file, 'r');
   try { const bytes = Buffer.alloc(4096); await handle.read(bytes, 0, bytes.length, 0); if (!pe64(bytes)) throw new Error('BG3 启动文件不是有效的 Windows x64 程序'); } finally { await handle.close(); }
  }
  const signal = context.signal ? AbortSignal.any([context.signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000);
  await fs.mkdir(this.cache, { recursive: true });
  const cache = path.join(this.cache, this.release.sha256 + '.zip'); let bytes;
  try { bytes = await readFile(cache, this.release.size); await unpack(bytes, this.release); } catch { bytes = null; }
  if (!bytes) {
   bytes = await download(this.options.fetch || fetch, this.release, signal);
   await unpack(bytes, this.release);
   const tmp = cache + '.' + crypto.randomUUID() + '.tmp';
   try { await fs.writeFile(tmp, bytes, { flag: 'wx' }); await fs.rename(tmp, cache); } finally { await fs.rm(tmp, { force: true }); }
  }
  const dll = await unpack(bytes, this.release);
  await authorize(); signal.throwIfAborted();
  if ((await this.location(game)).root !== location.root) throw new Error('游戏安装目录已变化，请重新扫描');
  await this.installers.guard(location.root, profile);
  const latest = await this.status(game); if (latest.ready) return latest;
  if (latest.status !== 'missing') throw new Error(latest.message);
  const destination = await target(location.root, 'bin/DWrite.dll'), tmp = await target(location.root, 'bin/.moddock-bg3se-' + crypto.randomUUID() + '.tmp');
  try {
   await fs.writeFile(tmp, dll, { flag: 'wx' });
   await authorize(); signal.throwIfAborted(); await this.installers.guard(location.root, profile);
   // Publish without replacing an existing file, including a concurrent installer.
   await fs.link(tmp, destination);
  } catch (error) {
   if (['EACCES', 'EPERM'].includes(error.code)) throw new Error('无法写入游戏目录，请退出游戏后以管理员身份重新打开游匣，再点一键重试');
   if (error.code === 'EEXIST') throw new Error('安装过程中 DWrite.dll 已出现，已保留该文件，请重新检测');
   throw error;
  } finally { await fs.rm(tmp, { force: true }); }
  const result = await this.status(game);
  if (!result.ready || result.sha256 !== this.release.dllSha256) throw new Error('组件安装后的文件校验失败');
  return { ...result, installed: true, message: 'Script Extender 已自动安装并校验，可直接创作和安装 Mod；首次启动游戏时官方组件会检查更新。' };
 }
}
module.exports = { BG3Extender, RELEASE, pe64, unpack, download, createElectronFetch };
