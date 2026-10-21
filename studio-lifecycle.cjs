const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { target } = require('./installers.cjs');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function readLog(root, relative) {
 if (!relative) return null;
 try {
  const file = await target(root, relative), stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('运行日志不是普通文件');
  const offset=Math.max(0,stat.size-8*1024*1024),handle=await fs.open(file,'r');
  let bytes;
  try {const buffer=Buffer.alloc(stat.size-offset),read=await handle.read(buffer,0,buffer.length,offset);bytes=buffer.subarray(0,read.bytesRead);}finally{await handle.close();}
  return { bytes, hash: digest(bytes), size: offset+bytes.length, offset, fileId:`${stat.dev}:${stat.ino}:${stat.birthtimeMs}`, mtime: stat.mtimeMs };
 } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function freshText(log, baseline, started) {
 if (!log || log.hash === baseline?.hash || log.mtime < Date.parse(started)) return '';
 if (!baseline) return log.bytes.toString('utf8');
 if(baseline.fileId && log.fileId && baseline.fileId!==log.fileId) return log.bytes.toString('utf8');
 if(log.offset>0 && log.size>=baseline.size) return log.bytes.subarray(Math.max(0,baseline.size-log.offset)).toString('utf8');
 if (log.size >= baseline.size && digest(log.bytes.subarray(0, baseline.size)) === baseline.hash) return log.bytes.subarray(baseline.size).toString('utf8');
 return log.bytes.toString('utf8');
}
class StudioLifecycle {
 constructor(studio, downloads, library, installers) { Object.assign(this, { studio, downloads, library, installers }); this.keeps = new Map(); }
 check(context) { if (!context.current() || context.signal?.aborted) throw new Error('操作已停止或账号已切换'); }
 async permission(context, feature) {
  this.check(context);
  if (typeof context.authorize !== 'function') throw new Error('缺少宿主权限校验');
  await context.authorize(feature); this.check(context);
 }
 jobFor(owner, game, artifact, buildId) {
  return this.downloads.jobs.find(job => job.creationOwner === owner && job.gameId === game.id && job.source === 'studio' &&
   (job.studio?.artifactId === artifact.id || job.resourceId === `studio:${artifact.id}`) && (!buildId || job.studio?.buildId === buildId));
 }
 predecessors(owner, game, item) {
  return this.installers.state.mods.filter(mod => {
   const old = this.downloads.jobs.find(job => job.id === mod.jobId);
   return mod.gameId === game.id && old?.source === 'studio' && old.creationOwner === owner &&
    (old.studio?.artifactId === item.id || item.lineage?.conversationId && old.studio?.lineage?.conversationId === item.lineage.conversationId);
  });
 }
 async persist(owner, id, deployment) {
  deployment.updated = new Date().toISOString();
  const file = path.join(this.studio.recordPath(owner, id), 'deployment.json'), temporary = file + '.' + crypto.randomUUID() + '.tmp';
  try { await fs.writeFile(temporary, JSON.stringify(deployment), { flag: 'wx' }); await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
 }
 async install(context) {
  const { owner, game, artifactId } = context;
  await this.permission(context, 'library.manage');
  const { item, bytes } = await this.studio.deploymentArchive(owner, game, artifactId);
  await this.studio.options.ensureEnvironment?.(context);
  const rule = await this.studio.ruleFor(game, item, this.installers.getProfile(game).rule);
  this.check(context);
  const job = await this.downloads.importCreation(game, item, bytes, owner);
  await this.library.import(game, job.id); this.check(context);
  const existing = this.installers.state.mods.find(mod => mod.gameId === game.id && mod.jobId === job.id);
  if (existing) {
   if (existing.status !== 'enabled') { await this.permission(context, 'library.manage'); await this.installers.action(game, existing.id, 'enable'); }
   const verified = await this.installers.action(game, existing.id, 'verify');
   if (verified.verification.status !== 'files_ok') throw new Error(verified.verification.message);
   const deployment = { ...item.deployment, status: 'installed', modId: existing.id, jobId: job.id, buildId: item.buildId, sha256: item.sha256, message: '此版本已安装并启用，托管文件校验通过。' };
   if (item.adapterId === 'minecraft-resourcepack') deployment.message = '资源包已部署，文件校验通过。请从自己的启动器打开对应 Minecraft 版本，在资源包菜单启用；游戏效果尚未验证。';
   await this.persist(owner, artifactId, deployment); return deployment;
  }
  const predecessors = this.predecessors(owner, game, item);
  if (predecessors.length > 1) throw new Error('此对话有多个已安装版本，请先在已安装 Mod 中处理');
  const previous = predecessors[0] && structuredClone(predecessors[0]); let removed = false, plan;
  await this.permission(context, 'library.manage');
  try {
   if (previous) { await this.installers.action(game, previous.id, 'uninstall'); removed = true; }
   this.check(context);
   plan = await this.installers.prepare(game, job.id, rule);
   await this.permission(context, 'library.manage');
   const mod = await this.installers.apply(game, plan.id, item.adapterId === 'engine-mod' && plan.files.every(file => !file.originalHash || rule.baseHashes?.[file.destination] === file.originalHash));
   const deployment = { status: 'installed', modId: mod.id, jobId: job.id, buildId: item.buildId, sha256: item.sha256, message: previous ? '当前版本已安装并启用，已替换此对话的上一版本；文件校验通过。' : '产物已安装并启用，文件校验通过。可以继续说“启动游戏并检查日志”。' };
   if (item.adapterId === 'minecraft-resourcepack') deployment.message = '资源包已部署，文件校验通过。请从自己的启动器打开对应 Minecraft 版本，在资源包菜单启用；游戏效果尚未验证。';
   await this.persist(owner, artifactId, deployment); return deployment;
  } catch (error) {
   if (removed && !this.installers.state.mods.some(mod => mod.jobId === job.id && mod.gameId === game.id)) {
    try {
     const restore = await this.installers.prepare(game, previous.jobId, previous.profile);
     try { const mod = await this.installers.apply(game, restore.id, restore.files.every(file => !file.originalHash || previous.profile.baseHashes?.[file.destination] === file.originalHash)); if (previous.status === 'disabled') await this.installers.action(game, mod.id, 'disable'); }
     finally { await this.installers.discard(restore.id); }
    } catch (rollback) { throw new Error('安装未完成，恢复上一版本失败：' + rollback.message); }
   }
   throw error;
  } finally { if (plan) await this.installers.discard(plan.id); }
 }
 async keep(context) {
  const key = context.owner + ':' + context.artifactId, previous = this.keeps.get(key) || Promise.resolve();
  const pending = previous.catch(() => {}).then(() => this.keepOne(context)); this.keeps.set(key, pending);
  try { return await pending; } finally { if (this.keeps.get(key) === pending) this.keeps.delete(key); }
 }
 async keepOne(context) {
  const { owner, game, artifactId } = context;
  await this.permission(context, 'library.manage');
  const { item, bytes } = await this.studio.deploymentArchive(owner, game, artifactId);
  if (!item.installable) throw new Error('这份产物还不能作为可用 Mod 保存，请先完成制作');
  if (!require('./studio-user-feedback.cjs').confirmed(item)) throw new Error('请先在创作页面确认这个版本能正常使用，再存到 Mod 库');
  const job = await this.downloads.importCreation(game, item, bytes, owner);
  await this.library.import(game, job.id);
  await this.permission(context, 'library.manage');
  const record = { jobId: job.id, buildId: item.buildId || null, sha256: item.sha256, savedAt: item.library?.sha256 === item.sha256 ? item.library.savedAt : new Date().toISOString() };
  const file = path.join(this.studio.recordPath(owner, artifactId), 'library.json'), temporary = file + '.' + crypto.randomUUID() + '.tmp';
  try { await fs.writeFile(temporary, JSON.stringify(record), { flag: 'wx' }); await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
  return record;
 }
 async logRelative(game, artifact) {
  if (require('./studio-game-mods.cjs').has(artifact.adapterId)) return artifact.runtime?.log || null;
  if (['bg3-lua', 'bg3-follower'].includes(artifact.adapterId)) return artifact.runtime?.log || null;
  if (artifact.adapterId === 'cyberpunk-cet-lua') return artifact.runtime?.log || null;
  const { diagnostic } = await this.studio.workspace(game), files = diagnostic.loaderFiles;
  if (artifact.runtime?.loader === 'UE4SS' && files.UE4SS?.length === 1) return path.posix.join(path.posix.dirname(files.UE4SS[0]), 'UE4SS.log');
  if (artifact.runtime?.loader === 'BepInEx' && files.BepInEx?.length === 1) return path.posix.join(path.posix.dirname(path.posix.dirname(files.BepInEx[0])), 'LogOutput.log');
  if (artifact.runtime?.loader === 'REFramework' && files.REFramework?.length === 1) return path.posix.join(path.posix.dirname(path.posix.dirname(files.REFramework[0])), 're2_framework_log.txt');
  return null;
 }
 async launch(context) {
  const { owner, game, artifactId } = context;
  await this.permission(context, 'game.launch');
  const { item } = await this.studio.deploymentArchive(owner, game, artifactId), job = this.jobFor(owner, game, item, item.buildId);
  const mod = job && this.installers.state.mods.find(mod => mod.jobId === job.id && mod.gameId === game.id && mod.status === 'enabled');
  if (!mod) throw new Error('请先安装并启用当前产物，再启动游戏');
  await this.studio.options.ensureEnvironment?.(context);
  const verified = await this.installers.action(game, mod.id, 'verify');
  if (verified.verification.status !== 'files_ok') throw new Error(verified.verification.message);
  const logRoot = ['bg3-lua', 'bg3-follower'].includes(item.adapterId) || item.runtime?.gameModRoot ? mod.root : game.installPath;
  const relative = await this.logRelative(game, item), log = await readLog(logRoot, relative);
  await this.permission(context, 'game.launch');
  const run = await this.installers.launch(game);
  const deployment = { ...item.deployment, status: 'launch_requested', modId: mod.id, jobId: job.id, buildId: item.buildId, sha256: item.sha256,
   runId: run.id, started: run.started, gameRoot: await fs.realpath(game.installPath), logRelative: relative, baseline: log ? { hash: log.hash, size: log.size, fileId:log.fileId } : null, runtime: null, message: run.message };
  await this.persist(owner, artifactId, deployment); return deployment;
 }
 async runtime({ owner, game, artifact }) {
  const job = this.jobFor(owner, game, artifact, ['bepinex-plugin', 'bg3-lua', 'bg3-follower', 'engine-mod'].includes(artifact.adapterId) || require('./studio-game-mods.cjs').has(artifact.adapterId) ? artifact.toolchain?.id : undefined);
  const mod = job && this.installers.state.mods.find(mod => mod.gameId === game.id && mod.jobId === job.id && mod.status === 'enabled');
  if (!mod) return { status: 'not_installed', detail: '当前产物尚未安装并启用，没有对应的游戏运行证据。' };
  if (require('./studio-game-mods.cjs').has(artifact.adapterId) && !artifact.runtime?.log) return { status: 'unsupported', detail: '此游戏路线尚无可自动归属到当前作品的运行日志；请在游戏中启用并验证效果，再反馈当前版本是否可用。' };
  const deployment = artifact.deployment;
  const run = deployment?.runId && this.installers.state.runs.find(run => run.id === deployment.runId && run.gameId === game.id && run.managed?.some(entry => entry.id === mod.id));
  if (!run) return { status: 'not_run', detail: '当前产物尚无对应启动记录，请说“启动游戏并检查日志”。' };
  const compiled=['bepinex-plugin','bg3-lua','bg3-follower','engine-mod'].includes(artifact.adapterId) || require('./studio-game-mods.cjs').has(artifact.adapterId);
  const expectedSha=compiled?artifact.toolchain?.bundle?.sha256:artifact.sha256,expectedBuild=compiled?artifact.toolchain?.id:artifact.buildId;
  if(deployment.sha256!==expectedSha || deployment.buildId && deployment.buildId!==expectedBuild) return {status:'stale_run',detail:'运行记录对应旧构建，必须重新启动后验证当前版本。'};
  const latest=this.installers.state.runs.find(r=>r.gameId===game.id);
  if(latest && latest.id!==run.id) return {status:'stale_run',detail:'游戏已有新的启动记录，旧会话证据不能用于自动修复当前运行。'};
  if (deployment.gameRoot !== await fs.realpath(game.installPath)) throw new Error('游戏路径已变化，不能使用旧启动记录');
  await require('./studio-game-process.cjs').observePlatformProcess(this.installers,game,run);
  let runtime;
  if (mod.profile.mode === 'smapi') {
   const checked = await this.installers.checkRun(game, run.id), verification = mod.verification;
   const loaded = verification?.runId === run.id && ['loader_loaded','loader_with_errors'].includes(verification.status);
   runtime = { status: loaded ? verification.status : checked.status === 'log_error' ? 'log_error' : 'unconfirmed', detail: loaded ? verification.message : checked.message };
  } else {
   const log = await readLog(['bg3-lua', 'bg3-follower'].includes(artifact.adapterId) || artifact.runtime?.gameModRoot ? mod.root : game.installPath, deployment.logRelative), text = freshText(log, deployment.baseline, run.started);
   const errors = text.split('\n').filter(line => /\b(ERROR|FATAL)\b|failed to load|could not be loaded/i.test(line));
   const loaded = !!artifact.runtime?.marker && text.split('\n').some(line => line.includes(artifact.runtime.marker) && !/\b(ERROR|FATAL)\b/i.test(line));
   runtime = { status: loaded ? errors.length ? 'loader_with_errors' : 'loader_loaded' : errors.length ? 'log_error' : 'unconfirmed',
    detail: loaded ? `本次 ${artifact.runtime.loader} 日志确认当前产物初始化完成；${errors.length ? '日志存在错误：' + errors.slice(0, 3).join(' / ') : '玩法效果仍需在游戏中确认。'}` : errors.length ? '本次日志检测到错误：' + errors.slice(0, 3).join(' / ') : '已请求启动，尚未发现本次产物的加载日志。游戏完成启动后可说“检查本次运行”。' };
   const { evaluate } = require('./studio-runtime-verification.cjs');
   const crashed = /Fatal error:|Unhandled Exception:|EXCEPTION_ACCESS_VIOLATION|Assertion failed:/i.test(text) || run.exited && (run.signal || typeof run.exitCode === 'number' && run.exitCode !== 0);
   const result = evaluate({text,marker:artifact.runtime?.marker,contract:artifact.runtime?.verification,previous:deployment.runtime,crashed:!!crashed,exitCode:run.exitCode,triggerTimeoutMs:this.studio.options.runtimeTriggerTimeoutMs || 15000});
   if (result.status !== 'unsupported' && (loaded || result.repairable)) runtime = {...runtime,...result};
   // Unrelated loader errors cannot establish which Mod failed.
   const lines=text.split('\n'), identity=artifact.manifest?.UniqueID;
   const ownErrors=identity ? lines.flatMap((line,i)=> /\b(ERROR|FATAL)\b|failed to load|could not be loaded/i.test(line) && lines.slice(Math.max(0,i-2),i+4).join('\n').includes(identity) ? [line] : []) : [];
   if (!result.repairable && ownErrors.length) runtime = {...runtime,status:'loader_error',repairable:true,detail:'本次日志包含当前产物相关的加载错误，将携带证据自动修复。',evidence:ownErrors.slice(0,5)};
   else if(!result.repairable && errors.length) runtime={...runtime,warnings:errors.slice(0,5)};
  }
  runtime = { ...runtime, detail: runtime.detail.slice(0, 2000), runId: run.id, gamePid:run.gamePid || run.pid, processObservationError:run.processObservationError, exited:!!run.exited, checked: new Date().toISOString() };
  await this.persist(owner, artifact.id, { ...deployment, runtime }); return runtime;
 }
 async observe(context) {
  let report;
  for (let attempt = 0; attempt < 3; attempt++) {
   this.check(context);
   report = await this.studio.toolchain.checkRuntime(context.owner, context.game, context.artifactId, context.current);
   if (report.runtime.status !== 'unconfirmed') break;
   if (attempt < 2) await delay(1000, undefined, { signal: context.signal });
  }
  return report;
 }
 async idle(game) {
  const mods=this.installers.state.mods.filter(m=>m.gameId===game.id && m.status==='enabled');
  const profile=mods[0]?.profile || this.installers.getProfile(game).rule;
  if(!profile) return false;
  try { await this.installers.guard(await this.installers.gameRoot(game,profile),profile); return true; }
  catch(error) { if(error.message.includes('请先退出游戏及加载器')) return false; throw error; }
 }
 async capture(owner,game,enabledModIds) {
  const captured=[];
  for(const mod of this.installers.state.mods.filter(m=>m.gameId===game.id && (enabledModIds ? enabledModIds.includes(m.id) : m.status==='enabled'))) {
   const job=this.downloads.jobs.find(j=>j.id===mod.jobId && j.source==='studio' && j.creationOwner===owner);
   const artifactId=job?.studio?.artifactId || job?.resourceId?.replace(/^studio:/,'');
   if(!job || !artifactId) continue;
   const artifact=await this.studio.read(owner,artifactId);
   const relative=await this.logRelative(game,artifact), log=await readLog(['bg3-lua','bg3-follower'].includes(artifact.adapterId)||artifact.runtime?.gameModRoot?mod.root:game.installPath,relative);
   captured.push({mod,artifact,relative,baseline:log?{hash:log.hash,size:log.size,fileId:log.fileId}:null});
  }
  return captured;
 }
 async attachCaptured(owner,game,run,captured) {
  for(const {mod,artifact,relative,baseline} of captured) {
   if(!run.managed?.some(m=>m.id===mod.id)) continue;
   const job=this.downloads.jobs.find(j=>j.id===mod.jobId);
   await this.persist(owner,artifact.id,{...artifact.deployment,status:'launch_requested',modId:mod.id,jobId:mod.jobId,buildId:job.studio?.buildId,sha256:job.sha256,runId:run.id,started:run.started,gameRoot:await fs.realpath(game.installPath),logRelative:relative,baseline,runtime:null});
  }
 }
 watchCaptured(owner,game,captured,current,authorize) {
  const ownerCurrent=current;current=()=>!this.closed && ownerCurrent();
  // Account queue prevents two Mods from installing/relaunching concurrently.
  this.watchQueues ||= new Map();
  const previous=this.watchQueues.get(owner) || Promise.resolve();
  const pending=previous.catch(()=>{}).then(async()=>{
   let candidates=captured;
   while(current() && candidates.length) {
    const next=[];
    for(const {artifact} of candidates) {
    if(!current()) return;
    const id=artifact.lineage?.conversationId;
    if(!id) continue;
    while(this.studio.pending.has(owner)) {if(!current())return;await delay(3000);}
    const conversation=await this.studio.conversations.read(owner,game,id);
    if(conversation.artifactId!==artifact.id && !conversation.runtimeRecovery?.pendingArtifactId) continue;
    await this.studio.conversations.send(owner,game,{id,message:'自动验证并修复运行结果',runtimeAuto:true},current,authorize);
    await this.studio.conversations.runs.get(this.studio.conversations.key(owner,id));
    const checked=await this.studio.conversations.read(owner,game,id);
    if(!['cancelled','failed'].includes(checked.status) && !checked.runtimeVerification?.exited && !['stale_run','unsupported','unavailable','not_run','not_installed'].includes(checked.runtimeVerification?.status)) {
     const updated=await this.studio.read(owner,checked.artifactId);
     next.push({artifact:updated});
    }
    }
    candidates=next;
    if(candidates.length) await delay(3000);
   }
  });
  this.watchQueues.set(owner,pending);
  pending.catch(error=>{if(this.studio.options.onRuntimeError)this.studio.options.onRuntimeError(error);else console.warn('自动运行观察已停止：'+String(error.message).slice(0,500));}).finally(()=>{if(this.watchQueues.get(owner)===pending)this.watchQueues.delete(owner);});
 }
 close() {this.closed=true;require('./studio-game-process.cjs').stopPlatformMonitors(this.installers);}
 async prepareRecoveries(owner,game,current,authorize,enabledModIds) {
  const replacements=new Map();
  if(this.studio.pending.has(owner)) return replacements;
  for(const row of await this.studio.conversations.list(owner,game)) {
   const item=await this.studio.conversations.read(owner,game,row.id), recovery=item.runtimeRecovery;
   if(!recovery?.pendingArtifactId || ['cancelled','failed'].includes(item.status)) continue;
   this.check({current});
   const pending=await this.studio.read(owner,recovery.pendingArtifactId);
   const previous=this.predecessors(owner,game,pending)[0],oldId=previous?.id;
   if(!previous || (enabledModIds ? !enabledModIds.includes(oldId) : previous.status!=='enabled')) continue;
   const deployment=await this.install({owner,game,artifactId:recovery.pendingArtifactId,current,authorize});
   item.artifactId=recovery.pendingArtifactId;recovery.artifactId=item.artifactId;recovery.pendingArtifactId=null;recovery.expectingNewRun=true;item.status='awaiting_runtime';
   await this.studio.conversations.persist(owner,item);
   if(oldId)replacements.set(oldId,deployment.modId);
  }
  return replacements;
 }
}
module.exports = { StudioLifecycle, readLog, freshText };
