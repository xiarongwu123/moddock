const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {fixture}=require('./oneclick-fixture.cjs');
const {Installers}=require('../installers.cjs');
const {createServer,loginFixture}=require('./server-fixture.cjs');
const {accountFixture}=require('./account-fixture.cjs');

async function setup(t,options={}){
 const calls=[];
 const x=await fixture({openGame:async uri=>{calls.push(uri);},...options});
 t.after(x.close);
 await x.engine.setProfile(x.game,{mode:'copy',destination:'Content'});
 const install=async(name,data=name)=>{
  const job=await x.job([{name,data}]);
  const plan=await x.engine.prepare(x.game,job.id);
  return x.engine.apply(x.game,plan.id,true);
 };
 return {...x,calls,install};
}

test('launch applies the selected set before opening Steam and persists it without creating loadouts',async t=>{
 const x=await setup(t),a=await x.install('original.ini','modded'),b=await x.install('b.txt');
 await x.engine.action(x.game,b.id,'disable');
 x.engine.options.openGame=async uri=>{
  x.calls.push(uri);
  assert.equal(await fs.readFile(path.join(x.game.installPath,'Content/original.ini'),'utf8'),'original');
  assert.equal(await fs.readFile(path.join(x.game.installPath,'Content/b.txt'),'utf8'),'b.txt');
 };
 const run=await x.engine.launch(x.game,[b.id]);
 assert.deepEqual(x.calls,['steam://rungameid/987654']);
 assert.equal(run.launchMethod,'platform');assert.equal(run.pid,undefined);
 assert.deepEqual(run.managed.map(m=>m.id),[b.id]);
 assert.equal((await x.engine.checkRun(x.game,run.id)).status,'needs_confirmation');
 const reopened=await new Installers(x.root,x.downloads).open();
 assert.equal(reopened.state.mods.find(m=>m.id===a.id).status,'disabled');
 assert.equal(reopened.state.mods.find(m=>m.id===b.id).status,'enabled');
 assert.equal(reopened.state.loadouts?.length||0,0);
});

test('empty selection disables all managed mods; no mods and no configured executable can also launch',async t=>{
 const x=await setup(t);const a=await x.install('a.txt');
 await x.engine.launch(x.game,[]);
 assert.equal(a.status,'disabled');await assert.rejects(fs.access(path.join(x.game.installPath,'Content/a.txt')));
 delete x.engine.state.profiles[x.game.id];
 await x.engine.launch(x.game,[]);assert.equal(x.calls.length,2);
 const stardew={...x.game,id:'steam-413150',appId:'413150'};
 await x.engine.launch(stardew,[]);assert.equal(x.calls.at(-1),'steam://rungameid/413150');
});

test('invalid or foreign selections, changed files and running games never dispatch a launch',async t=>{
 const x=await setup(t),a=await x.install('a.txt');
 for(const selection of [null,{},'all',['unknown'],[a.id,a.id]])await assert.rejects(x.engine.launch(x.game,selection),/选择已失效/);
 await fs.writeFile(path.join(x.game.installPath,'Content/a.txt'),'external');
 await assert.rejects(x.engine.launch(x.game,[]),/外部修改/);
 await assert.rejects(x.engine.launch(x.game,[a.id]),/文件校验失败/);
 x.engine.options.processes=async()=>[{pid:1234,path:path.join(x.game.installPath,'game.exe'),name:'game.exe'}];
 await assert.rejects(x.engine.launch(x.game,[]),/退出游戏/);
 assert.deepEqual(x.calls,[]);assert.equal(a.status,'enabled');
});

test('failed platform activation restores the previous selection and bytes',async t=>{
 const x=await setup(t,{openGame:async()=>{throw new Error('launcher unavailable');}}),a=await x.install('original.ini','modded');
 await assert.rejects(x.engine.launch(x.game,[]),/launcher unavailable/);
 assert.equal(x.engine.state.mods.find(m=>m.id===a.id).status,'enabled');
 assert.equal(await fs.readFile(path.join(x.game.installPath,'Content/original.ini'),'utf8'),'modded');
 assert.equal(x.engine.state.runs.length,0);
});

test('a batch write failure rolls back the selection and never opens the game',async t=>{
 const x=await setup(t),a=await x.install('a.txt'),b=await x.install('b.txt');
 x.engine.options.afterWrite=async i=>{if(i===0)throw new Error('disk fault');};
 await assert.rejects(x.engine.launch(x.game,[]),/已回滚/);
 assert.equal(x.engine.state.mods.find(m=>m.id===a.id).status,'enabled');
 assert.equal(x.engine.state.mods.find(m=>m.id===b.id).status,'enabled');
 assert.equal(await fs.readFile(path.join(x.game.installPath,'Content/a.txt'),'utf8'),'a.txt');
 assert.equal(await fs.readFile(path.join(x.game.installPath,'Content/b.txt'),'utf8'),'b.txt');assert.deepEqual(x.calls,[]);
});

test('selection validates SMAPI dependencies before writes and automatically uses its loader',async t=>{
 const x=await setup(t);
 await fs.writeFile(path.join(x.game.installPath,'StardewModdingAPI.dll'),'loader');
 await fs.writeFile(path.join(x.game.installPath,process.platform==='win32'?'StardewModdingAPI.exe':'StardewModdingAPI'),'MZfixture');
 await x.engine.setProfile(x.game,{mode:'smapi',destination:'Mods'});
 const install=async(name,dependencies=[])=>{
  const job=await x.job([{name:'manifest.json',data:JSON.stringify({Name:name,UniqueID:'test.'+name,Version:'1.0.0',Dependencies:dependencies,EntryDll:'mod.dll'})},{name:'mod.dll'}]);
  const plan=await x.engine.prepare(x.game,job.id);return x.engine.apply(x.game,plan.id);
 };
 const a=await install('Provider'),b=await install('Dependent',[{UniqueID:'test.Provider'}]);
 await assert.rejects(x.engine.launch(x.game,[b.id]),/缺少依赖/);
 assert.equal(a.status,'enabled');assert.deepEqual(x.calls,[]);
 let executable;
 x.engine.options.spawn=(file)=>{executable=file;return spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{stdio:'ignore'});};
 const run=await x.engine.launch(x.game,[a.id,b.id]);t.after(()=>x.engine.children.get(run.id)?.kill());
 assert.match(executable,/StardewModdingAPI(?:\.exe)?$/);assert.ok(run.pid);assert.deepEqual(x.calls,[]);
});

test('explicit native entry is honored and a missing entry fails before changing selected mods',async t=>{
 const x=await setup(t),a=await x.install('a.txt');
 await x.engine.setProfile(x.game,{mode:'copy',executable:'missing.exe'});
 await assert.rejects(x.engine.launch(x.game,[]),/ENOENT/);assert.equal(a.status,'enabled');
 await fs.writeFile(path.join(x.game.installPath,'missing.exe'),'script text');
 await assert.rejects(x.engine.launch(x.game,[]),/原生可执行文件/);assert.deepEqual(x.calls,[]);
});

test('Epic launches through its encoded installation path and web preview reports the desktop requirement',async t=>{
 const x=await setup(t),epic={...x.game,id:'epic-test',platform:'Epic'};
 await x.engine.launch(epic,[]);
 assert.equal(x.calls[0],`com.epicgames.launcher://apps/${encodeURIComponent(await fs.realpath(x.game.installPath))}?action=launch&silent=true`);
 x.engine.options.openGame=undefined;
 await assert.rejects(x.engine.launch(x.game,[]),/桌面客户端/);
});

test('launch API requires game permission plus MOD management permission when changing the selection',async t=>{
 const x=await setup(t),mod=await x.install('a.txt'),account=accountFixture();let opens=0;
 const service=await createServer({root:x.root,port:0,accounts:account.options,scan:async()=>({games:[x.game],roots:[],diagnostics:[]}),installers:{processes:async()=>[],openGame:async()=>{opens++;}}});
 t.after(()=>new Promise(resolve=>service.server.close(resolve)));
 const auth=await loginFixture(service);
 const post=body=>auth.fetch(service.url+'/api/installations/launch',{method:'POST',headers:{'Content-Type':'application/json','X-Moddock-Token':auth.state.token},body:JSON.stringify(body)});
 const features=keys=>keys.map(key=>({key,enabled:true,allowed:true,version:1,minimumTier:'standard'}));
 account.updateAccount({features:features(['game.launch'])});
 assert.equal((await post({gameId:x.game.id,enabledModIds:[]})).status,403);assert.equal(opens,0);
 assert.equal((await post({gameId:x.game.id})).status,200);assert.equal(opens,1);
 assert.equal((await post({gameId:x.game.id,enabledModIds:[mod.id]})).status,200);assert.equal(opens,2);
 account.updateAccount({features:features(['game.launch','library.manage'])});
 assert.equal((await post({gameId:x.game.id,enabledModIds:[]})).status,200);
 assert.equal((await post({gameId:x.game.id,enabledModIds:['foreign']})).status,400);assert.equal(opens,3);
});
