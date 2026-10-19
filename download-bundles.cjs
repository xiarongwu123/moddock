const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const active=new Set(['downloading','waiting_authorization','installing','waiting_install']);
function bundleOptions(detail){
 const files=(detail.files||[]).map(f=>{
  const name=String(f.label||f.name||''),text=name+'\n'+String(f.description||''),category=String(f.category||'').toUpperCase();
  const source=/\b(?:data source files?|source assets?|source files?|source code|for mod (?:makers|authors)|do not cook\/?pak)\b|源码|开发者素材|开发者资源/i.test(text);
  const old=['REMOVED','ARCHIVED','OLD_VERSION'].includes(category);
  const split=/\.(?:zip|7z)\.\d+$|\bpart\s*\d+\s*(?:of|\/)\s*\d+/i.test(name);
  const blocked=source?'开发资料，不是可直接安装的 MOD':old?'旧版或已归档文件':split?'分卷压缩包需要专用合并流程':!f.available?(f.downloadReason||'当前文件不可下载'):'';
  return {id:String(f.id),name,description:String(f.description||'').slice(0,2000),category,size:Number(f.size)||0,version:f.version||'',blocked,kind:source?'source':old?'old':category==='MAIN'?'main':/UPDATE|PATCH/.test(category)?'update':'optional',allInOne:/\ball[ -]?in[ -]?one\b|整合包|完整版|一体包/i.test(name)};
 });
 const usable=files.filter(f=>!f.blocked),complete=usable.filter(f=>f.allInOne),main=usable.filter(f=>f.kind==='main');
 const recommended=complete.length===1?[complete[0].id]:main.length===1?[main[0].id]:usable.length===1?[usable[0].id]:[];
 return {files,recommended,message:complete.length===1?'已推荐整合成品包；无需再同时选择它已包含的独立文件。':main.length>1?'检测到多个主文件，可能属于不同版本或替代方案，请选择与你的游戏匹配的一套。':'主文件优先；可选内容、补丁及安装顺序请按作者说明确认。'};
}
class DownloadBundles{
 constructor(root,downloads,options={}){this.file=path.join(root,'download-bundles.json');this.downloads=downloads;this.options=options;this.items=[];this.runtime=new Map();this.persistence=Promise.resolve();this.operations=Promise.resolve();this.closed=false;}
 async open(){
  try{this.items=JSON.parse(await fs.readFile(this.file,'utf8'));if(!Array.isArray(this.items))throw Error('组合任务记录格式无效');}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const b of this.items)if(active.has(b.status)){b.status='paused';b.message='客户端已重新启动，点击继续后恢复组合任务。';}
  await this.save();if(this.options.interval!==0){this.timer=setInterval(()=>this.tick().catch(()=>{}),this.options.interval||1500);this.timer.unref();}return this;
 }
 save(){const text=JSON.stringify(this.items);this.persistence=this.persistence.catch(()=>{}).then(async()=>{await fs.writeFile(this.file+'.tmp',text);await fs.rename(this.file+'.tmp',this.file);});return this.persistence;}
 serial(work){const pending=this.operations.catch(()=>{}).then(work);this.operations=pending;return pending;}
 view(owner){return this.items.filter(b=>b.owner===owner).map(({owner:ignored,...b})=>({...b,files:b.files.map(f=>{const job=this.downloads.jobs.find(j=>j.id===f.jobId);return {...f,downloadStatus:job?.status||'missing',progress:job?.progress||0};})}));}
 find(owner,id){const b=this.items.find(b=>b.id===id&&b.owner===owner);if(!b)throw Error('组合任务不存在或不属于当前账号');return b;}
 async start(input){return this.serial(async()=>{
  const {owner,game,resourceId,detail,client,sessionId,installAfter=false}=input,ids=input.fileIds;
  if(!Array.isArray(ids)||!ids.length||ids.length>20||ids.some(id=>typeof id!=='string'||!/^\d+$/.test(id))||new Set(ids).size!==ids.length)throw Error('请选择 1 至 20 个不同的下载文件');
  if(typeof installAfter!=='boolean')throw Error('自动安装选项无效');
  if(installAfter&&!game.installPath)throw Error('请先选择本机游戏安装位置，再下载并自动安装组合');
  if(input.requestId!==undefined&&!/^[\da-f-]{36}$/i.test(input.requestId))throw Error('组合任务标识无效');
  const existing=input.requestId&&this.items.find(b=>b.id===input.requestId);
  if(existing){if(existing.owner!==owner||existing.gameId!==game.id||existing.resourceId!==resourceId||existing.installAfter!==installAfter||JSON.stringify(existing.files.map(f=>f.fileId))!==JSON.stringify(ids))throw Error('组合任务标识已被使用');return this.view(owner).find(b=>b.id===existing.id);}
  const options=bundleOptions(detail),selected=ids.map(id=>{const f=options.files.find(f=>f.id===id);if(!f||f.blocked)throw Error(f?f.name+'：'+f.blocked:'所选文件已下架，请刷新文件列表');return f;});
  if(selected.some(f=>f.allInOne)&&selected.filter(f=>f.kind==='main').length>1)throw Error('整合包与独立主文件可能重复，请选择一套主文件后再创建组合');
  if(selected.filter(f=>f.kind==='main').length>1&&/choose\s+(?:only\s+)?one|install\s+(?:only\s+)?one|only\s+one\s+(?:version|variant)|二选一|只(?:安装|选择)(?:一个|一种)/i.test(detail.description||''))throw Error('作者要求只选择一个版本，请减少所选主文件');
  const files=selected.map(f=>({fileId:f.id,name:f.name}));
  if(this.items.some(b=>b.owner===owner&&b.gameId===game.id&&b.resourceId===resourceId&&active.has(b.status)&&JSON.stringify(b.files.map(f=>f.fileId))===JSON.stringify(ids)))throw Error('这个组合已在处理，请查看下载管理');
  const b={id:input.requestId||randomUUID(),owner,gameId:game.id,gameName:game.name,resourceId,name:String(input.name||'MOD 文件组合').slice(0,180),installAfter,files,status:'downloading',message:'正在下载所选文件；全部完成后再继续。',created:new Date().toISOString()};
  this.prepareJobs(b,game,client);this.items.unshift(b);this.runtime.set(b.id,{sessionId});await this.save();return this.view(owner).find(item=>item.id===b.id);
 });}
 prepareJobs(b,game,client){
  const rows=b.files.map(f=>{
   const previous=f.jobId&&this.downloads.jobs.find(j=>j.id===f.jobId);
   const candidates=this.downloads.jobs.filter(j=>j.gameId===game.id&&j.resourceId===b.resourceId&&j.fileId===f.fileId);
   const job=(previous?.status==='completed'?previous:null)||candidates.find(j=>j.status==='completed')||candidates.find(j=>['queued','running','authorization_required'].includes(j.status));
   if(job&&['queued','running'].includes(job.status)&&this.downloads.clients.get(job.id)!==client)throw Error('所选文件正由另一个会话下载，请等待完成');
   return {file:f,job};
  });
  const count=rows.filter(row=>!row.job).length,queued=this.downloads.jobs.filter(j=>['queued','running'].includes(j.status)).length;
  if(count+queued>20)throw Error('下载队列空间不足，请等待已有任务完成后再添加组合');
  client.resource(game,b.resourceId);
  for(const row of rows){const job=row.job||this.downloads.start(game,b.resourceId,row.file.fileId,row.file.name,undefined,client);row.file.jobId=job.id;}
 }
 async resume(owner,id,sessionId,game,detail,client,installAfter){return this.serial(async()=>{
  const b=this.find(owner,id);if(active.has(b.status))throw Error('组合任务正在处理中');
  const options=bundleOptions(detail);for(const f of b.files){const current=options.files.find(o=>o.id===f.fileId);if(!current||current.blocked)throw Error('文件列表已变化，请重新选择组合：'+f.name);}
  if(installAfter!==undefined&&typeof installAfter!=='boolean')throw Error('自动安装选项无效');
  const auto=installAfter??b.installAfter;if(auto&&!game.installPath)throw Error('请先关联本机游戏');
  this.prepareJobs(b,game,client);b.installAfter=auto;b.status='downloading';b.message='正在继续组合任务';delete b.error;this.runtime.set(b.id,{sessionId});await this.save();return this.view(owner).find(item=>item.id===id);
 });}
 pauseOwner(owner){for(const b of this.items.filter(b=>b.owner===owner&&active.has(b.status)))this.pause(owner,b.id);}
 pause(owner,id){const b=this.find(owner,id);if(!active.has(b.status))return;this.runtime.delete(b.id);b.status='paused';b.message='组合已暂停，已完成的下载和安装均已保留。';void this.save().catch(()=>{});}
 async tick(){
  if(this.busy||this.closed)return;this.busy=true;
  try{for(const b of this.items.filter(b=>active.has(b.status))){
   const runtime=this.runtime.get(b.id);if(!runtime)continue;
   const current=()=>!this.closed&&this.runtime.get(b.id)===runtime&&this.options.current(b.owner,runtime.sessionId);
   if(!current()){this.pause(b.owner,b.id);continue;}
   const jobs=b.files.map(f=>this.downloads.jobs.find(j=>j.id===f.jobId));
   if(jobs.some(j=>!j||['failed','cancelled'].includes(j.status))){b.status='download_failed';b.message='部分文件未下载完成，安装尚未开始。点击继续可重试失败文件。';await this.save();continue;}
   if(jobs.some(j=>j.status==='authorization_required')){b.status='waiting_authorization';b.message='请先在下方文件任务中完成来源授权，组合会自动继续。';continue;}
   if(jobs.some(j=>j.status!=='completed')){b.status='downloading';continue;}
   if(!b.installAfter){b.status='downloaded';b.message='组合文件已全部下载，可一键按顺序安装。';await this.save();continue;}
   if(this.options.installBusy()||jobs.some(j=>this.options.readyForInstall?.(j.id)===false)){b.status='waiting_install';b.message='等待文件检查和当前安装任务完成后安装此组合。';continue;}
   b.status='installing';await this.save();
   try{
    for(const f of b.files){
     if(!current())throw Error('账号已切换或组合已暂停，自动安装已停止');
     const installed=this.options.installed(f.jobId);if(installed){f.modId=installed.id;f.installed=true;continue;}
     await this.options.authorize(b.owner,runtime.sessionId);
     if(!current())throw Error('账号已切换，组合安装已停止');
     b.message='正在安装 '+(b.files.indexOf(f)+1)+'/'+b.files.length+'：'+f.name;await this.save();
     const mod=await this.options.install(f.jobId,b.owner,runtime.sessionId,current);f.modId=mod.id;f.installed=true;await this.save();
    }
    if(current()){b.status='completed';b.message='组合安装完成，全部文件已校验；游戏内效果仍需确认。';}
   }catch(error){if(current()){if(error.message==='正在处理安装任务，请稍后'){b.status='waiting_install';b.message='等待当前文件检查或安装任务完成后继续。';}else{b.status='install_failed';b.error=String(error.message||error);b.message='组合安装已暂停，已成功的项目保留；当前失败文件由安装器回滚。';}}}
   await this.save();
  }}finally{this.busy=false;}
 }
 close(){if(this.closed)return this.persistence;this.closed=true;clearInterval(this.timer);for(const b of this.items.filter(b=>active.has(b.status))){this.runtime.delete(b.id);b.status='paused';b.message='客户端已关闭，重新登录后可继续。';}return this.save();}
}
module.exports={DownloadBundles,bundleOptions};
