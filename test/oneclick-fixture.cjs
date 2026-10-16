const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Installers,hash}=require('../installers.cjs');
const {zip}=require('./zip-fixture.cjs');

async function fixture(options={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moddock-oneclick-'));
 const game={id:'steam-987654',appId:'987654',name:'One-click test game',platform:'Steam',installPath:path.join(root,'game'),real:true};
 await fs.mkdir(path.join(game.installPath,'Content'),{recursive:true});
 await fs.mkdir(path.join(game.installPath,'Saves'));
 await fs.writeFile(path.join(game.installPath,'Content/original.ini'),'original');
 await fs.writeFile(path.join(game.installPath,'Saves/player.sav'),'player save');
 const downloads={jobs:[],completedFile:async id=>{const job=downloads.jobs.find(j=>j.id===id);return {file:job.path,name:job.filename};}};
 const engine=await new Installers(root,downloads,{processes:async()=>[],...options}).open();
 const job=async(entries,target=game)=>{
  const id=crypto.randomUUID(),file=path.join(root,id+'.zip');await fs.writeFile(file,zip(entries));
  const item={id,gameId:target.id,gameName:target.name,name:'One-click MOD',resourceId:'banana:1',fileId:'1',source:'banana',status:'completed',path:file,filename:'mod.zip',sha256:await hash(file)};
  downloads.jobs.push(item);return item;
 };
 return {root,game,downloads,engine,job,close:()=>fs.rm(root,{recursive:true,force:true})};
}

if(require.main===module)(async()=>{
 const {createServer}=require('./server-fixture.cjs');const x=await fixture();x.game.appId='1144200';x.game.name='Ready or Not (temporary test)';
 const directory=path.join(x.game.installPath,'ReadyOrNot/Content/Paks');await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'original-mod.pak'),'original');
 const service=await createServer({root:path.join(x.root,'ui'),port:0,scan:async()=>({games:[x.game],roots:[],diagnostics:[]}),installers:{processes:async()=>[]},sources:{fetch:async()=>Response.json({_aMetadata:{_nRecordCount:0},_aRecords:[]})}});
 const job=await x.job([{name:'Release/original-mod.pak',data:'modded'},{name:'Release/new-mod.pak',data:'new'},{name:'README.md'}]);
 const dir=path.join(service.downloads.root,job.id);await fs.mkdir(dir);const file=path.join(dir,job.filename);await fs.copyFile(job.path,file);
 service.downloads.jobs.push({...job,path:file,bytes:(await fs.stat(file)).size,progress:100,message:'MOD 已下载'});await service.downloads.save();
 console.log(JSON.stringify({url:service.url,gamePath:x.game.installPath,root:x.root,jobId:job.id}));
 const close=async()=>{await new Promise(resolve=>service.server.close(resolve));await x.close();process.exit();};process.on('SIGINT',close);process.on('SIGTERM',close);
})().catch(error=>{console.error(error);process.exitCode=1;});

module.exports={fixture};
