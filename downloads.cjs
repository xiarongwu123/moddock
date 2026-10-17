const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { downloadAllowed } = require('./sources.cjs');
const { LIMITS, assertSize } = require('./archive-limits.cjs');
function filename(value) { const name = String(value || 'mod.zip').split(/[\\/]/).pop().replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 150); return !name || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name) ? 'mod-' + (name || 'file.zip') : name; }
class Downloads {
 constructor(root, sources, options = {}) { this.root = path.resolve(root, 'downloads'); this.sources = sources; this.clients = new Map(); this.verifications = new Map(); this.fetch = options.fetch || globalThis.fetch; this.jobs = []; this.controllers = new Map(); this.persist = Promise.resolve(); this.authorizations=new Map(); this.onCompleted=options.onCompleted; this.onAuthorizationRequired=options.onAuthorizationRequired; this.maxParallel=options.maxParallel||3; this.beforeDownload=options.beforeDownload; }
 async open() {
  await fs.mkdir(this.root, { recursive: true });
  try { this.jobs = JSON.parse(await fs.readFile(path.join(this.root, 'history.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  for (const j of this.jobs) { delete j.verificationRequired; if (['queued','running'].includes(j.status)) { j.status = 'failed'; j.message = '上次运行中断，可重新下载'; await fs.rm(path.join(this.root, j.id + '.part'), { force: true }); } }
  if (this.sources.nexusPlatform) for (const j of this.jobs) if (j.status === 'authorization_required') { j.status = 'failed'; j.message = '已切换至平台下载服务，可重新下载'; }
  await this.save(); return this;
 }
 save() { const state = JSON.stringify(this.jobs); this.persist = this.persist.catch(() => {}).then(async () => { await fs.writeFile(path.join(this.root, 'history.tmp'), state); await fs.rename(path.join(this.root, 'history.tmp'), path.join(this.root, 'history.json')); }); return this.persist; }
 start(game, resourceId, fileId, name, authorization, client = this.sources) {
  client.resource(game, resourceId); if (!/^\d+$/.test(String(fileId))) throw new Error('文件 ID 无效');
  if (this.jobs.filter(j => ['queued','running'].includes(j.status)).length >= 20) throw new Error('下载队列已满');
  if (this.jobs.some(j => j.gameId === game.id && j.resourceId === resourceId && j.fileId === String(fileId) && ['queued','running'].includes(j.status))) throw new Error('这个文件已经在下载队列中');
  const job = { id: crypto.randomUUID(), name: String(name || 'Mod 文件').slice(0, 180), gameId: game.id, gameName: game.name, resourceId, fileId: String(fileId), source: resourceId.split(':')[0], status: 'queued', bytes: 0, total: null, progress: 0, message: '等待下载', created: new Date().toISOString(), game };
  this.clients.set(job.id, client);
  if(authorization)this.authorizations.set(job.id,authorization); this.jobs.unshift(job); this.save(); this.pump(); return this.view().find(j => j.id === job.id);
 }
 resumeAuthorization(game, resourceId, fileId, authorization, client = this.sources) {
  const active=this.jobs.find(j=>j.gameId===game.id&&j.resourceId===resourceId&&j.fileId===String(fileId)&&['queued','running'].includes(j.status));if(active){if(this.clients.get(active.id)!==client)throw new Error('此文件正在由另一个账号下载，请稍后重试');this.authorizations.set(active.id,authorization);return this.view().find(j=>j.id===active.id);}
  const existing=this.jobs.find(j=>j.gameId===game.id&&j.resourceId===resourceId&&j.fileId===String(fileId)&&['authorization_required','failed'].includes(j.status));
  if(!existing)return this.start(game,resourceId,fileId,'Nexus Mod '+resourceId.split(':').at(-1),authorization,client);
  if(this.controllers.has(existing.id))throw new Error('下载正在结束，请稍后重新接收授权');
  if(this.jobs.filter(j=>['queued','running'].includes(j.status)).length>=20)throw new Error('下载队列已满');
  this.clients.set(existing.id, client);
  Object.assign(existing,{game,status:'queued',bytes:0,total:null,progress:0,code:null,message:'已收到 NXM 文件授权'});this.authorizations.set(existing.id,authorization);this.save();this.pump();return this.view().find(j=>j.id===existing.id);
 }
 view(owner) { return this.jobs.filter(job => !owner || job.source !== 'studio' || job.creationOwner === owner).map(({ game, creationOwner, ...j }) => j); }
 async importCreation(game, creation, bytes, owner) {
  const resourceId = `studio:${creation.id}` + (creation.compiled ? `:${creation.buildId}` : '');
  const existing = this.jobs.find(job => job.resourceId === resourceId && job.creationOwner === owner && job.gameId === game.id && job.status === 'completed');
  if (existing) { const saved = await this.completedFile(existing.id); const hash = crypto.createHash('sha256').update(await fs.readFile(saved.file)).digest('hex'); if (hash !== creation.sha256) throw new Error('已导入的创作文件发生变化，请保留并检查该文件'); if (creation.compiled && creation.toolchain && !existing.studio?.toolchain) { existing.studio ||= {}; existing.studio.toolchain = { id: creation.toolchain.id, status: creation.toolchain.status, deployment: creation.toolchain.deployment }; await this.save(); } return this.view(owner).find(job => job.id === existing.id); }
  if (!Buffer.isBuffer(bytes) || bytes.length > (creation.compiled && /^[a-f0-9-]{36}$/.test(creation.buildId) ? 32 * 1024 * 1024 : 256 * 1024) || crypto.createHash('sha256').update(bytes).digest('hex') !== creation.sha256) throw new Error('创作包校验失败');
  const id = crypto.randomUUID(), dir = path.join(this.root, id), name = filename(creation.draft.name + '.zip');
  await fs.mkdir(dir);
  try { await fs.writeFile(path.join(dir, name), bytes, { flag: 'wx' }); }
  catch (error) { await fs.rm(dir, { recursive: true, force: true }); throw error; }
  const job = { id, name: creation.draft.name, gameId: game.id, gameName: game.name, game, source: 'studio', creationOwner: owner,
   resourceId, studio: { artifactId: creation.id, buildId: creation.buildId, compiled: creation.compiled, lineage: creation.lineage, runtime: creation.runtime, bg3Module: creation.bg3Module, adapterId: creation.adapterId, installable: creation.installable, manifest: creation.manifest, draft: { kind: creation.draft.kind }, controls: creation.draft.controls, ...(creation.compiled && creation.toolchain ? { toolchain: { id: creation.toolchain.id, status: creation.toolchain.status, deployment: creation.toolchain.deployment } } : {}) }, fileId: '1', version: '1.0.0', filename: name, path: path.join(dir, name),
   status: 'completed', bytes: bytes.length, total: bytes.length, progress: 100, sha256: creation.sha256,
   created: new Date().toISOString(), finished: new Date().toISOString(), message: '本地创作内容包 · SHA-256 校验通过' };
  this.jobs.unshift(job);
  try { await this.save(); } catch (error) { this.jobs = this.jobs.filter(item => item !== job); await fs.rm(dir, { recursive: true, force: true }); throw error; }
  return this.view(owner).find(item => item.id === id);
 }
 async verification(id, client, input, options) {
  const target = this.verifications.get(id), job = this.jobs.find(job => job.id === id);
  if (!target || target.client !== client || job?.status !== 'running' || this.clients.get(id) !== client) throw new Error('此下载任务没有待处理验证');
  return target.client.nexusPlatform.verification(target.jobId, input, options);
 }
 cancel(id) { const job = this.jobs.find(j => j.id === id); if (!job || !['queued','running','authorization_required'].includes(job.status)) throw new Error('任务不能取消'); job.status = 'cancelled'; job.message = '下载已取消'; this.controllers.get(id)?.abort(); if (!this.controllers.has(id)) { this.clients.delete(id); this.authorizations.delete(id); } this.save(); }
 releaseClient(client) { for (const job of this.jobs) if (this.clients.get(job.id) === client && ['queued', 'running'].includes(job.status)) this.cancel(job.id); }
 async response(url, controller) {
  for (let hop = 0; hop < 6; hop++) {
   if (!downloadAllowed(url)) throw new Error('下载地址不在受支持的来源中');
   const timeout = new AbortController(); const timer = setTimeout(() => timeout.abort(new Error('下载服务器响应超时')), 30000); let r;
   try { r = await this.fetch(url, { redirect: 'manual', signal: AbortSignal.any([controller.signal, timeout.signal]), headers: { 'User-Agent': 'Moddock/0.3', 'Accept-Encoding': 'identity' } }); } finally { clearTimeout(timer); }
   if ([301,302,303,307,308].includes(r.status)) { const target = r.headers.get('location'); await r.body?.cancel(); if (!target) throw new Error('下载重定向无效'); url = new URL(target, url).href; continue; }
   if (!r.ok) throw new Error(`下载失败（HTTP ${r.status}）`);
   if (/text\/html|application\/json/.test(r.headers.get('content-type') || '')) { await r.body?.cancel(); throw new Error('来源返回了网页或错误信息，没有返回 Mod 文件'); }
   return r;
  }
  throw new Error('下载重定向次数过多');
 }
 pump() {
  const running = this.controllers.size;
  for (const job of this.jobs.filter(j => j.status === 'queued').reverse().slice(0, Math.max(0, this.maxParallel - running))) {
   const client = this.clients.get(job.id) || this.sources, hadGrant = this.authorizations.has(job.id);
   const ctrl = new AbortController(); this.controllers.set(job.id, ctrl);
   this.run(job, ctrl).catch(() => { job.status = 'failed'; job.message = '无法保存下载记录，请检查磁盘空间'; }).finally(() => {
    this.controllers.delete(job.id); this.pump();
    if (!hadGrant && job.status === 'authorization_required' && this.onAuthorizationRequired) Promise.resolve().then(() => this.onAuthorizationRequired(job, client)).catch(async error => {
     if (job.status === 'authorization_required') { job.message = `自动文件授权未完成：${error.message}`; await this.save(); }
    }).catch(() => {});
   });
  }
 }
 async run(j, ctrl) {
  const partial = path.join(this.root, j.id + '.part'); let handle, idleTimer, usedAuthorization; const resetIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => ctrl.abort(new Error('下载超过 60 秒没有返回数据，请重试')), 60000); };
  try {
   j.status = 'running'; j.message = '获取来源下载授权'; await this.save();
   if (ctrl.signal.aborted) throw new Error('cancelled');
   const client = this.clients.get(j.id) || this.sources;
   usedAuthorization=this.authorizations.get(j.id); const file = await client.downloadFile(j.game, j.resourceId, j.fileId, usedAuthorization, { signal: ctrl.signal, onProgress: async (message, state) => {
    if (j.status !== 'running') return;
    const verificationRequired = !!state?.verification;
    if (verificationRequired) this.verifications.set(j.id, { client, jobId: state.verification }); else this.verifications.delete(j.id);
    if (message && (j.message !== message || !!j.verificationRequired !== verificationRequired)) { j.message = message; j.verificationRequired = verificationRequired; await this.save(); }
   } }); j.version=file.version||'';
   if (ctrl.signal.aborted) throw new Error('cancelled');
   assertSize(file.size, LIMITS.downloadBytes, '下载文件体积', file.name || j.name);
   await this.beforeDownload?.(file);
   j.filename = filename(file.name); j.name = file.label || file.name || j.name;
   const response = file._open ? await file._open(ctrl.signal) : await this.response(file._url, ctrl);
   const length = Number(response.headers.get('content-length') || 0); j.total = length || file.size || null;
   if (j.total > LIMITS.downloadBytes) { await response.body?.cancel(); assertSize(j.total, LIMITS.downloadBytes, '下载文件体积', j.filename); }
   resetIdle(); handle = await fs.open(partial, 'wx'); const sha = crypto.createHash('sha256'), md5 = crypto.createHash('md5'); let last = 0;
   j.message = '正在下载';
   for await (const chunk of response.body) {
    if (ctrl.signal.aborted) throw new Error('cancelled');
    resetIdle(); j.bytes += chunk.length; assertSize(j.bytes, LIMITS.downloadBytes, '下载文件体积', j.filename);
    await handle.writeFile(chunk); sha.update(chunk); md5.update(chunk); j.progress = j.total ? Math.min(99, Math.floor(j.bytes / j.total * 100)) : null;
    if (Date.now() - last > 1000) { await this.save(); last = Date.now(); }
   }
   await handle.sync(); await handle.close(); handle = null;
   if (ctrl.signal.aborted) throw new Error('cancelled');
   if (!j.bytes || (length && length !== j.bytes) || (file.size && file.sizeExact !== false && file.size !== j.bytes)) throw new Error('文件大小校验失败，下载未完成');
   if (file.md5 && md5.digest('hex') !== file.md5.toLowerCase()) throw new Error('来源文件校验值不匹配');
   j.sha256 = sha.digest('hex'); if (file.sha256 && j.sha256 !== file.sha256) throw new Error('下载文件与后台文件校验值不一致'); const dir = path.join(this.root, j.id); await fs.mkdir(dir); await fs.rename(partial, path.join(dir, j.filename));
   j.path = path.join(dir, j.filename); j.progress = 100; j.status = 'completed'; j.message = file.md5 ? '下载完成 · 大小与来源 MD5 校验通过' : '下载完成 · 大小校验通过，已记录 SHA-256'; j.finished = new Date().toISOString();
  } catch (e) {
   await handle?.close().catch(() => {}); await fs.rm(partial, { force: true });
   const cancelled = j.status === 'cancelled'; const freshGrant=this.authorizations.get(j.id);const retryWithGrant=e.code==='NEXUS_NXM_REQUIRED'&&freshGrant&&freshGrant!==usedAuthorization&&!cancelled; j.code=e.code||null; j.status = retryWithGrant?'queued': cancelled ? 'cancelled' : e.code==='NEXUS_NXM_REQUIRED'?'authorization_required':'failed'; j.message = cancelled ? '下载已取消' : (ctrl.signal.reason?.message || (e.message === 'fetch failed' ? '无法连接下载服务器，请重试' : e.message));
  } finally { clearTimeout(idleTimer); this.verifications.delete(j.id); delete j.verificationRequired; if(j.status!=='queued'){this.authorizations.delete(j.id);this.clients.delete(j.id);} await this.save(); }
  if(j.status==='completed'&&this.onCompleted){try{await this.onCompleted(j);}catch(e){j.import={status:'failed',message:e.message};await this.save();}}
 }
 async completedFile(id) { const j = this.jobs.find(j => j.id === id && j.status === 'completed'); if (!j) throw new Error('文件尚未下载完成'); const file = path.join(this.root, j.id, filename(j.filename)); await fs.access(file); return { file, name: filename(j.filename) }; }
}
module.exports = { Downloads, filename };
