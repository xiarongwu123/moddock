const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {fixture}=require('./oneclick-fixture.cjs');
const {detectRule,assertRequirements}=require('../auto-install.cjs');
const {Installers}=require('../installers.cjs');
const {createServer,loginFixture}=require('./server-fixture.cjs');
async function setup(t,options){const x=await fixture(options);t.after(x.close);return x;}
async function manual(x,job,game=x.game,rule={mode:'copy',destination:''}){await x.engine.setProfile(game,rule);const plan=await x.engine.prepare(game,job.id);return x.engine.apply(game,plan.id,true);}
async function pakGame(x,appId='1144200',directory='ReadyOrNot/Content/Paks'){
 x.game.appId=appId;await fs.mkdir(path.join(x.game.installPath,directory),{recursive:true});
 if(appId==='990080')await fs.writeFile(path.join(x.game.installPath,'HogwartsLegacy.exe'),'game');
 return x.game;
}
const files=(...paths)=>paths.map(path=>({path}));

test('documented Ready or Not installation backs up originals, records evidence and preserves user files on restore',async t=>{
 const x=await setup(t);await pakGame(x);const directory=path.join(x.game.installPath,'ReadyOrNot/Content/Paks');
 await fs.writeFile(path.join(directory,'original-mod.pak'),'original');
 const j=await x.job([{name:'Release/original-mod.pak',data:'modded'},{name:'Release/new-mod.pak',data:'new'},{name:'README.md'}]);
 const m=await x.engine.installAuto(x.game,j.id);assert.equal(m.profile.destination,'ReadyOrNot/Content/Paks');
 assert.equal(m.installationRule.id,'readyornot-pak');assert.ok(m.installationRule.sources.includes('https://www.nexusmods.com/readyornot/articles/321'));
 assert.equal(await fs.readFile(path.join(directory,'original-mod.pak'),'utf8'),'modded');
 await fs.writeFile(path.join(directory,'new-mod.pak'),'user edited MOD');await fs.writeFile(path.join(directory,'user.cfg'),'user settings');
 const result=await x.engine.restoreNative(x.game);assert.equal(result.removed,1);assert.equal(result.preserved,1);
 const recovery=JSON.parse(await fs.readFile(path.join(result.recoveryPath,'files.json'),'utf8'));
 assert.equal(await fs.readFile(recovery.files[0].savedAs,'utf8'),'user edited MOD');
 assert.equal(await fs.readFile(path.join(directory,'original-mod.pak'),'utf8'),'original');
 assert.equal(await fs.readFile(path.join(x.game.installPath,'Saves/player.sav'),'utf8'),'player save');
 assert.equal(await fs.readFile(path.join(directory,'user.cfg'),'utf8'),'user settings');
 await assert.rejects(fs.access(path.join(directory,'new-mod.pak')),/ENOENT/);
 const reopened=await new Installers(x.root,x.downloads,{processes:async()=>[]}).open();assert.equal(reopened.state.mods.length,0);assert.equal(reopened.state.restorations[0].preserved,1);
});

test('native restore removes enabled and disabled mods together without touching another game',async t=>{
 const x=await setup(t);const a=await x.job([{name:'Content/a.bin'}]),b=await x.job([{name:'Content/b.bin'}]);
 const ma=await manual(x,a);await manual(x,b);await x.engine.action(x.game,ma.id,'disable');
 const other={...x.game,id:'other',installPath:path.join(x.root,'other')};await fs.mkdir(path.join(other.installPath,'Content'),{recursive:true});
 const c=await x.job([{name:'Content/c.bin'}],other);await manual(x,c,other);
 assert.equal((await x.engine.restoreNative(x.game)).removed,2);assert.deepEqual(x.engine.state.mods.map(m=>m.gameId),['other']);
 assert.equal(await fs.readFile(path.join(other.installPath,'Content/c.bin'),'utf8'),'fixture');
});

test('native restore retains saves in place even when a legacy manual installation tracked them',async t=>{
 const x=await setup(t),j=await x.job([{name:'Saves/player.sav',data:'old save package'},{name:'Content/new.bin'}]);await manual(x,j);
 await fs.writeFile(path.join(x.game.installPath,'Saves/player.sav'),'current player progress');await x.engine.restoreNative(x.game);
 assert.equal(await fs.readFile(path.join(x.game.installPath,'Saves/player.sav'),'utf8'),'current player progress');
 await assert.rejects(fs.access(path.join(x.game.installPath,'Content/new.bin')),/ENOENT/);
});

test('native restore rolls back all mods after a mid-write error and retains journals when rollback is blocked',async t=>{
 const x=await setup(t);for(const name of ['a','b'])await manual(x,await x.job([{name:'Content/'+name+'.bin',data:name}]));
 x.engine.options.afterWrite=async i=>{if(i===0)throw new Error('disk fault');};
 await assert.rejects(x.engine.restoreNative(x.game),/已回滚全部/);assert.equal(x.engine.state.mods.length,2);
 for(const name of ['a','b'])assert.equal(await fs.readFile(path.join(x.game.installPath,'Content/'+name+'.bin'),'utf8'),name);
 x.engine.options.afterWrite=async(_i,c)=>{await fs.writeFile(path.join(c.root,c.rel),'external');throw new Error('disk fault');};
 await assert.rejects(x.engine.restoreNative(x.game),/回滚检测到外部/);await assert.rejects(x.engine.restoreNative(x.game),/事务尚未恢复/);
 await fs.access(path.join(x.engine.root,'journal.json'));
});

test('native restore validates all original backups and running games before changing files',async t=>{
 const x=await setup(t),m=await manual(x,await x.job([{name:'Content/new.bin'},{name:'Content/original.ini',data:'modded'}]));
 x.engine.options.processes=async()=>[{pid:9999,path:path.join(x.game.installPath,'game.exe')}];await assert.rejects(x.engine.restoreNative(x.game),/退出游戏/);
 x.engine.options.processes=async()=>[];await fs.writeFile(path.join(x.engine.root,'mods',m.id,'original','1'),'damaged');
 await assert.rejects(x.engine.restoreNative(x.game),/备份损坏/);assert.equal(await fs.readFile(path.join(x.game.installPath,'Content/new.bin'),'utf8'),'fixture');
});

test('unknown Paks folders, generic layouts and saved manual rules never authorize automatic deployment',async t=>{
 const x=await setup(t);await fs.mkdir(path.join(x.game.installPath,'Project/Content/Paks'),{recursive:true});
 await assert.rejects(detectRule(x.game,files('mod.pak')),/不能仅凭 Paks/);
 const j=await x.job([{name:'Content/new.bin'}]);await x.engine.setProfile(x.game,{mode:'copy',destination:''});
 await assert.rejects(x.engine.installAuto(x.game,j.id),/已停止自动安装/);assert.equal(x.engine.state.mods.length,0);
 await assert.rejects(fs.access(path.join(x.game.installPath,'Content/new.bin')),/ENOENT/);
});

test('game identifiers and game structure must match the documented PAK profile',async t=>{
 const x=await setup(t);await assert.rejects(detectRule({...x.game,appId:'1144200'},files('mod.pak')),/目录结构/);
 await pakGame(x);await assert.rejects(detectRule(x.game,files('mod.pak'),{domain:'hogwartslegacy'}),/专区与本机/);
 await assert.rejects(detectRule(x.game,files('pakchunk0-Windows.pak')),/基础游戏档案/);
 await assert.rejects(detectRule(x.game,files('Data/fomod/ModuleConfig.xml','Data/a.esp')),/FOMOD/);
 await assert.rejects(detectRule(x.game,files('Saves/player.sav')),/存档/);
});

test('file instructions override general descriptions within registered Tekken paths, and conflicting paths are rejected',async t=>{
 const x=await setup(t);await pakGame(x,'1778820','Polaris/Content/Paks');
 const rule=await detectRule(x.game,files('mod.pak'),{fileDescription:'Place files in Polaris\\Content\\Paks\\mods, not ~mods',description:'Use Polaris/Content/Paks/~mods'});
 assert.equal(rule.destination,'Polaris/Content/Paks/mods');
 await assert.rejects(detectRule(x.game,files('mod.pak'),{fileDescription:'Use Polaris/Content/Paks/mods or Polaris/Content/Paks/~mods'}),/多个不同/);
});

test('IoStore companions are retained, and missing companions, Lua and LogicMods cannot masquerade as ordinary PAKs',async t=>{
 const x=await setup(t);await pakGame(x,'3489700','SB/Content/Paks');
 const rule=await detectRule(x.game,files('mod.pak','mod.utoc','mod.ucas'));assert.equal(rule.destination,'SB/Content/Paks/~mods');
 await assert.rejects(detectRule(x.game,files('mod.utoc')),/配套文件/);
 await assert.rejects(detectRule(x.game,files('LogicMods/blueprint.pak')),/蓝图/);
 await assert.rejects(detectRule(x.game,files('mod.pak','Scripts/main.lua')),/Lua/);
 await assert.rejects(detectRule(x.game,files('mod.pak'),{fileDescription:'Install using TekkenMovesetExtractor'}),/外部工具/);
 await assert.rejects(detectRule(x.game,files('Easy/mod.pak','Hard/other.pak'),{fileDescription:'Install only one version'}),/只选择一个/);
});

test('BepInEx plugin and patcher layouts stay separate; a bare DLL needs explicit author instructions',async t=>{
 const x=await setup(t);await fs.mkdir(path.join(x.game.installPath,'BepInEx/core'),{recursive:true});await fs.writeFile(path.join(x.game.installPath,'BepInEx/core/BepInEx.dll'),'loader');
 await assert.rejects(detectRule(x.game,files('unknown.dll')),/不能只凭 DLL/);
 for(const directory of ['plugins','patchers']){
  const j=await x.job([{name:'Release/BepInEx/'+directory+'/'+directory+'.dll'}]),m=await x.engine.installAuto(x.game,j.id);
  assert.equal(m.files[0].destination,'BepInEx/'+directory+'/'+directory+'.dll');
 }
 const bare=await x.job([{name:'bare.dll'},{name:'README.md',data:'Copy bare.dll into BepInEx/patchers.'}]);
 assert.equal((await x.engine.installAuto(x.game,bare.id)).files[0].destination,'BepInEx/patchers/bare.dll');
 await assert.rejects(detectRule(x.game,files('bare.dll'),{fileDescription:'Requires BepInEx 6, put in BepInEx/plugins'}),/BepInEx 6/);
});

test('MelonLoader Mods and Plugins are selected only with an installed MelonLoader',async t=>{
 const x=await setup(t);await fs.writeFile(path.join(x.game.installPath,'version.dll'),'proxy');await fs.writeFile(path.join(x.game.installPath,'dobby.dll'),'hook');
 await assert.rejects(detectRule(x.game,files('Mods/mod.dll')),/不能只凭 DLL/);
 await fs.mkdir(path.join(x.game.installPath,'MelonLoader'));
 assert.equal((await detectRule(x.game,files('Mods/mod.dll'))).destination,'Mods');
 assert.equal((await detectRule(x.game,files('Plugins/plugin.dll'))).destination,'Plugins');
});

test('Cyberpunk legacy archives use documented paths; REDmod, framework companions and Bethesda activation are not silently skipped',async t=>{
 const x=await setup(t);x.game.appId='1091500';await fs.mkdir(path.join(x.game.installPath,'archive/pc'),{recursive:true});await fs.mkdir(path.join(x.game.installPath,'bin/x64'),{recursive:true});await fs.writeFile(path.join(x.game.installPath,'bin/x64/Cyberpunk2077.exe'),'game');
 const j=await x.job([{name:'Release/mod.archive',data:'RDARfixture'}]),m=await x.engine.installAuto(x.game,j.id);
 assert.equal(m.files[0].destination,'archive/pc/mod/mod.archive');
 await assert.rejects(detectRule(x.game,files('mods/Test/info.json','mods/Test/archives/mod.archive')),/REDmod/);
 await assert.rejects(detectRule(x.game,files('mod.archive','mod.archive.xl')),/ArchiveXL/);
 await assert.rejects(detectRule({...x.game,appId:'489830'},files('Data/a.esp')),/插件启用/);
});

test('SMAPI package and source dependencies are checked, including manually installed Content Patcher',async t=>{
 const x=await setup(t);x.game.appId='413150';await fs.writeFile(path.join(x.game.installPath,'StardewModdingAPI.dll'),'loader');
 const j=await x.job([{name:'Release/manifest.json',data:JSON.stringify({Name:'Test',UniqueID:'test.Auto',Version:'1.0.0',ContentPackFor:{UniqueID:'Pathoschild.ContentPatcher'}})},{name:'Release/content.json',data:'{}'}]);
 const context={requirements:[{name:'SMAPI'},{name:'Content Patcher'}]};
 await assert.rejects(x.engine.installAuto(x.game,j.id,context),/Content Patcher/);
 const directory=path.join(x.game.installPath,'Mods/ContentPatcher');await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify({Name:'Content Patcher',UniqueID:'Pathoschild.ContentPatcher',Version:'2.0.0',EntryDll:'ContentPatcher.dll'}));await fs.writeFile(path.join(directory,'ContentPatcher.dll'),'plugin');
 const m=await x.engine.installAuto(x.game,j.id,context);assert.equal(m.profile.mode,'smapi');assert.equal(m.files[0].destination,'Mods/test.Auto/manifest.json');
 assert.throws(()=>assertRequirements({requirements:[{name:'Unknown loader'}]},m.profile,[]),/Unknown loader/);
 assert.doesNotThrow(()=>assertRequirements({requirements:[{name:'Optional loader',notes:'Optional'}]},m.profile,[]));
});

test('Nexus one-click API rechecks the selected file instructions and prerequisites before touching game files',async t=>{
 const x=await setup(t);await pakGame(x);x.game.nexus='readyornot';let requirements=[],available=true;
 const service=await createServer({root:path.join(x.root,'api'),port:0,scan:async()=>({games:[x.game],roots:[],diagnostics:[]}),installers:{processes:async()=>[]},sources:{fetch:async(_url,init)=>Response.json(init.body?.includes('modFiles')?{data:{mod:{description:'General description',modRequirements:{nexusRequirements:{nodes:requirements}}},modFiles:available?[{fileId:1,name:'Test',detectedFileExtension:'zip',category:'MAIN',description:'Install in ReadyOrNot/Content/Paks/~mods'}]:[]}}:{data:{game:{id:42}}})}});
 t.after(()=>new Promise(r=>service.server.close(r)));
 const add=async name=>{const j=await x.job([{name:name+'.pak'}]),dir=path.join(service.downloads.root,j.id);await fs.mkdir(dir);await fs.copyFile(j.path,path.join(dir,j.filename));j.resourceId='nexus:readyornot:476';j.source='nexus';service.downloads.jobs.push(j);return j;};
 const first=await add('first');assert.equal((await fetch(service.url+'/api/installations/auto',{method:'POST',body:JSON.stringify({jobId:first.id})})).status,401);
 const auth=await loginFixture(service),post=(route,body)=>auth.fetch(service.url+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Moddock-Token':auth.state.token},body:JSON.stringify(body)});
 let response=await post('installations/auto',{jobId:first.id});assert.equal(response.status,200);const record=await response.json();assert.equal(record.profile.destination,'ReadyOrNot/Content/Paks/~mods');assert.ok(record.installationRule.sources.includes('https://www.nexusmods.com/readyornot/mods/476'));
 requirements=[{modName:'UE4SS custom framework',notes:''}];const second=await add('second');response=await post('installations/auto',{jobId:second.id});assert.equal(response.status,400);assert.match((await response.json()).error,/前置 MOD/);
 await assert.rejects(fs.access(path.join(x.game.installPath,'ReadyOrNot/Content/Paks/~mods/second.pak')),/ENOENT/);
 available=false;response=await post('installations/auto',{jobId:second.id});assert.equal(response.status,400);assert.match((await response.json()).error,/下架/);
 assert.equal((await post('installations/restore',{gameId:x.game.id})).status,200);
});

test('workshop downloads bind only to a unique installed game',async t=>{
 const x=await setup(t);await pakGame(x);let games=[x.game];const service=await createServer({root:path.join(x.root,'api'),port:0,scan:async()=>({games,roots:[],diagnostics:[]}),installers:{processes:async()=>[]}});
 t.after(()=>new Promise(r=>service.server.close(r)));const auth=await loginFixture(service),post=(route,body)=>auth.fetch(service.url+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Moddock-Token':auth.state.token},body:JSON.stringify(body)});
 const catalog=(await(await post('workshop/catalog',{})).json()).items.find(g=>g.appId===x.game.appId);
 const add=async name=>{const j=await x.job([{name:name+'.pak'}]),dir=path.join(service.downloads.root,j.id);await fs.mkdir(dir);await fs.copyFile(j.path,path.join(dir,j.filename));j.gameId=catalog.id;service.downloads.jobs.push(j);return j;};
 const j=await add('first');assert.equal((await post('installations/auto',{jobId:j.id})).status,200);assert.equal(j.gameId,x.game.id);
 const another={...x.game,id:'other',installPath:path.join(x.root,'second')};await fs.mkdir(path.join(another.installPath,'ReadyOrNot/Content/Paks'),{recursive:true});games=[x.game,another];await post('scan',{});
 const ambiguous=await add('ambiguous'),response=await post('installations/auto',{jobId:ambiguous.id});assert.equal(response.status,400);assert.match((await response.json()).error,/多个安装位置/);assert.equal(ambiguous.gameId,catalog.id);
});
