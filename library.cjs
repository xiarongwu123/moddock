const {suggestions}=require('./adapters.cjs');
const {versionAtLeast}=require('./installers.cjs');
class ModLibrary {
 constructor(downloads,installers,sources){this.downloads=downloads;this.installers=installers;this.sources=sources;this.queue=Promise.resolve();}
 import(game,jobId){const work=()=>this.importOne(game,jobId);const promise=this.queue.catch(()=>{}).then(work);this.queue=promise;return promise;}
 async importOne(game,jobId){const j=this.downloads.jobs.find(j=>j.id===jobId&&j.gameId===game.id&&j.status==='completed');if(!j)throw new Error('请选择下载完成的文件');
  const files=await this.installers.inspect(game,jobId);j.import={status:'ready',message:'已校验并导入待安装库；选择规则后预览安装',files,suggestions:suggestions(game,files),at:new Date().toISOString()};await this.downloads.save();return j.import;
 }
 async checkUpdates(game){return this.installers.exclusive(async()=>{
  const mods=this.installers.state.mods.filter(m=>m.gameId===game.id&&m.resourceId?.startsWith('nexus:'));
  for(const m of mods){try{const d=await this.sources.detail(game,m.resourceId);const job=this.downloads.jobs.find(j=>j.id===m.jobId);const currentVersion=m.version||job?.version||m.units[0]?.version||'';
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
module.exports={ModLibrary};
