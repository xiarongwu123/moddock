// Isolated browser fixture. Platform activation is recorded without opening real games.
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createServer}=require('./server-fixture.cjs');
const {hash}=require('../installers.cjs');
const {zip}=require('./zip-fixture.cjs');

(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moddock-launch-ui-'));
 const game={id:'steam-1144200',appId:'1144200',name:'Ready or Not',platform:'Steam',installPath:path.join(root,'game'),real:true};
 const empty={id:'steam-987654',appId:'987654',name:'无 MOD 测试游戏',platform:'Steam',installPath:path.join(root,'empty'),real:true};
 const target=path.join(game.installPath,'ReadyOrNot/Content/Paks');
 await fs.mkdir(target,{recursive:true});await fs.mkdir(empty.installPath);
 const launches=[];
 const service=await createServer({root:path.join(root,'data'),port:0,scan:async()=>({games:[game,empty],roots:[],diagnostics:[]}),installers:{processes:async()=>[],openGame:async uri=>{launches.push(uri);await fs.writeFile(path.join(root,'launches.json'),JSON.stringify(launches));}},sources:{fetch:async()=>Response.json({_aMetadata:{_nRecordCount:0},_aRecords:[]})}});
 await fs.writeFile(path.join(root,'launches.json'),'[]');
 for(const [name,file,installed,enabled]of [['清晰画质','visual.pak',true,true],['战术装备','equipment.pak',true,false],['中文语音','voice.pak',false,false],['不支持的包','unsupported.txt',false,false]]){
  const id=crypto.randomUUID(),directory=path.join(service.downloads.root,id);await fs.mkdir(directory);
  const archive=path.join(directory,'mod.zip');await fs.writeFile(archive,zip([{name:file,data:name}]));
  const job={id,gameId:game.id,gameName:game.name,game,resourceId:'banana:1',fileId:'1',source:'banana',name,status:'completed',filename:'mod.zip',path:archive,sha256:await hash(archive),version:'1.0.0',bytes:(await fs.stat(archive)).size,message:'MOD 已下载'};
  service.downloads.jobs.push(job);
  if(installed){const mod=await service.installers.installAuto(game,id);if(!enabled)await service.installers.action(game,mod.id,'disable');}
 }
 await service.downloads.save();
 console.log(JSON.stringify({url:service.url,root,gamePath:game.installPath}));
 const close=async()=>{await new Promise(resolve=>service.server.close(resolve));await fs.rm(root,{recursive:true,force:true});process.exit();};
 process.on('SIGINT',close);process.on('SIGTERM',close);
})().catch(error=>{console.error(error);process.exitCode=1;});
