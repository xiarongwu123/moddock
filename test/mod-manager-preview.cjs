// Disposable local games and ZIPs for reviewing the Mod manager without user data.
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createServer}=require('./server-fixture.cjs');
const {zip}=require('./zip-fixture.cjs');
const {hash}=require('../installers.cjs');

(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moddock-manager-preview-'));
 const games=[{id:'steam-413150',appId:'413150',name:'星露谷物语',platform:'Steam'},{id:'steam-730',appId:'730',name:'反恐精英 2',platform:'Steam'}].map(game=>({...game,installPath:path.join(root,game.id),real:true}));
 for(const game of games)await fs.mkdir(path.join(game.installPath,'Content'),{recursive:true});
 const service=await createServer({root:path.join(root,'data'),port:Number(process.env.MODDOCK_MANAGER_PORT)||0,scan:async()=>({games,roots:[],diagnostics:[]}),installers:{processes:async()=>[]},sources:{fetch:async()=>Response.json({_aMetadata:{_nRecordCount:0},_aRecords:[]})}});
 async function add(game,name,filename,installed) {
  const id=crypto.randomUUID(),directory=path.join(service.downloads.root,id);await fs.mkdir(directory);
  const file=path.join(directory,'mod.zip');await fs.writeFile(file,zip([{name:filename,data:'preview mod'}]));const bytes=(await fs.stat(file)).size;
  service.downloads.jobs.push({id,gameId:game.id,gameName:game.name,resourceId:'banana:1',source:'banana',fileId:'1',name,version:'1.0.0',status:'completed',filename:'mod.zip',path:file,sha256:await hash(file),bytes,total:bytes,progress:100,message:'下载完成'});await service.downloads.save();
  await service.library.import(game,id);
  if(installed){const plan=await service.installers.prepare(game,id,{mode:'copy',destination:'Content'});await service.installers.apply(game,plan.id,true);}
 }
 await add(games[0],'霜蓝水晶短剑','frostblade.json',true);
 await add(games[1],'Rainbow Crosshair','rainbow.cfg',true);
 await add(games[0],'更清晰的季节图标','season-icons.json',false);
 console.log(JSON.stringify({url:service.url,root}));
 const close=async()=>{await new Promise(resolve=>service.server.close(resolve));await fs.rm(root,{recursive:true,force:true});process.exit();};
 process.on('SIGTERM',close);process.on('SIGINT',close);
})().catch(error=>{console.error(error);process.exitCode=1;});
