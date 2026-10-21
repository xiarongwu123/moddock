const {suggestions}=require('./adapters.cjs');
const {versionAtLeast}=require('./installers.cjs');
function bananaUpdate(detail, job = {}) {
 const current = detail.files.find(f => String(f.id) === String(job.fileId));
 const baseline = Date.parse(job.sourceFileUpdated || job.finished || job.created);
 const changed = current && job.sourceFileMd5 && current.md5 && job.sourceFileMd5 !== current.md5;
 const candidates = detail.files.filter(f => String(f.id) !== String(job.fileId) && (!Number.isFinite(baseline) || !f.updated || Date.parse(f.updated) > baseline));
 const files = changed ? [current, ...candidates] : candidates;
 const previousVersion = job.sourceVersion || job.version;
 const newerVersion = previousVersion && detail.version && detail.version !== previousVersion && versionAtLeast(detail.version, previousVersion);
 const pageChanged = job.sourceUpdated && detail.updated && Date.parse(detail.updated) > Date.parse(job.sourceUpdated);
 const fileChangedWithoutHash = current && !job.sourceFileMd5 && Number.isFinite(baseline) && Date.parse(current.updated) > baseline;
 const unknownBaseline = !job.sourceUpdated && !job.finished && !job.created && !job.sourceFileUpdated;
 const status = files.length ? changed || newerVersion ? 'available' : 'review' : pageChanged || fileChangedWithoutHash || !current || unknownBaseline ? 'review' : 'current';
 return { status, currentVersion: job.version || '', updated: detail.updated,
  message: changed ? '已下载文件的来源校验值已变化，请核对更新说明' : files.length ? '发现新的候选文件，请核对更新时间、适用版本和可选内容' : fileChangedWithoutHash ? '原文件的上传时间已变化，旧记录缺少来源校验值，请核对作者说明' : pageChanged ? '作者页面已更新，文件列表未发现可确认的新版本' : !current ? '原文件已下架或归档，请到来源页面核对替代文件' : unknownBaseline ? '旧记录缺少来源基线，请核对作者更新时间与文件列表' : '未发现可确认的新版本',
  files: files.map(({ _url, md5, ...file }) => file), checked: new Date().toISOString() };
}
class ModLibrary {
 constructor(downloads,installers,sources){this.downloads=downloads;this.installers=installers;this.sources=sources;this.queue=Promise.resolve();}
 import(game,jobId){const work=()=>this.importOne(game,jobId);const promise=this.queue.catch(()=>{}).then(work);this.queue=promise;return promise;}
 async importOne(game,jobId){const j=this.downloads.jobs.find(j=>j.id===jobId&&j.gameId===game.id&&j.status==='completed');if(!j)throw new Error('请选择下载完成的文件');
  const files=await this.installers.inspect(game,jobId);j.import={status:'ready',message:'MOD 文件已校验，可以一键安装',files,suggestions:suggestions(game,files),at:new Date().toISOString()};await this.downloads.save();return j.import;
 }
 async checkUpdates(game){return this.installers.exclusive(async()=>{
  const mods=this.installers.state.mods.filter(m=>m.gameId===game.id&&/^(nexus|banana):/.test(m.resourceId));
  const details=new Map();
  for(const m of mods){try{if(!details.has(m.resourceId))details.set(m.resourceId,this.sources.detail(game,m.resourceId));const d=await details.get(m.resourceId);const job=this.downloads.jobs.find(j=>j.id===m.jobId);if(m.resourceId.startsWith('banana:')){m.update=bananaUpdate(d,job);continue;}const currentVersion=m.version||job?.version||m.units[0]?.version||'';
   const main=d.files.filter(f=>['MAIN','Main Files',1].includes(f.category));const choices=main.length?main:d.files;
   const newer=main.filter(f=>currentVersion&&f.version!==currentVersion&&versionAtLeast(f.version,currentVersion));
   const review=choices.filter(f=>f.id!==job?.fileId&&(!currentVersion||f.version&&f.version!==currentVersion));
   const status=newer.length?'available':review.length?'review':'current';
   m.update={status,currentVersion,message:status==='available'?'发现版本号更高的文件，请核对主文件和前置':status==='review'?'发现其他文件，版本无法可靠比较；请查看文件列表': '未发现可确认的新版本',files:(newer.length?newer:review).map(({_url,md5,...f})=>f),checked:new Date().toISOString()};
  }catch(e){m.update={status:'error',message:e.message,checked:new Date().toISOString()};}}
  await this.installers.save();return mods.map(m=>({id:m.id,...m.update}));
 });}
 async downloadUpdate(game,id,fileId){const m=this.installers.state.mods.find(m=>m.id===id&&m.gameId===game.id);if(!m?.update?.files.some(f=>f.id===String(fileId)))throw new Error('请先检查并选择此 Mod 的更新文件');return this.downloads.start(game,m.resourceId,fileId,m.name+' · 更新',undefined,this.sources);}
}
module.exports={ModLibrary,bananaUpdate};
