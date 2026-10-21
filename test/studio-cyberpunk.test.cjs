const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { CET, checkCET, isCyberpunk } = require('../studio-cyberpunk.cjs');
const { ModStudio } = require('../mod-studio.cjs');
const { diagnoseGame } = require('../game-diagnostics.cjs');
const { recipesFor } = require('../studio-recipes.cjs');
const { createAuthoringWorkspace } = require('../studio-authoring.cjs');
const { StudioLifecycle } = require('../studio-lifecycle.cjs');
const { createServer, loginFixture } = require('./server-fixture.cjs');
const { accountFixture } = require('./account-fixture.cjs');
const { createDeepSeek } = require('../studio-ai.cjs');
const { piFixture } = require('./pi-fixture.cjs');
const { GameEnvironment } = require('../game-environment.cjs');

// Synthetic gameplay state exercises the adapter. No test executes Cyberpunk.
const code = `ModdockVerification.expect('effect','fixture player state')
registerHotkey('moddock_effect','Test effect',ModdockVerification.guard('effect',function()
 local player=Game.GetPlayer()
 if not player then return end
 ModdockVerification.begin('effect')
 local actual=player:ReadFixtureState()
 ModdockVerification.check('effect',actual,42)
end))`;
const draft = { kind: 'cyberpunk-cet-lua', name: 'CET fixture', author: 'Fixture', code };
async function write(root, name, text) { const file=path.join(root,name); await fs.mkdir(path.dirname(file),{recursive:true}); await fs.writeFile(file,text); }
async function fixture(t) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moddock-cet-'));
 const game={id:'steam-1091500',appId:'1091500',name:'Cyberpunk 2077',platform:'Steam',real:true,installPath:path.join(root,'game')};
 await write(game.installPath,'bin/x64/Cyberpunk2077.exe',require('./bg3-extender-fixture.cjs').executable);
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:3}));
 return {root,game};
}
test('CET identity and dependencies do not depend on generic engine detection or mods directories',async t=>{
 const x=await fixture(t), report=await diagnoseGame(x.game);
 assert.equal(report.engine.key,'redengine'); assert.deepEqual(report.loaderFiles.CET,[]);
 assert.ok(recipesFor(x.game,report).find(type=>type.id===draft.kind).available);
 assert.equal(isCyberpunk({appId:'999',name:'Cyberpunk 2077'}),false);
 assert.ok((await require('../studio-game-api.cjs').search(x.game,'Game.GetPlayer')).matches.length);
 assert.equal((await require('../studio-game-api.cjs').search(x.game,'InventedGodModeAPI')).matches.length,0);
 await fs.mkdir(path.join(x.game.installPath,CET,'mods'),{recursive:true});
 assert.deepEqual((await diagnoseGame(x.game)).loaderFiles.CET,[]);
 await write(x.game.installPath,'bin/x64/plugins/cyber_engine_tweaks.asi','fixture loader');
 assert.deepEqual((await diagnoseGame(x.game)).loaderFiles.CET,['bin/x64/plugins/cyber_engine_tweaks.asi']);
 const environment=new GameEnvironment(x.root,{},null);
 assert.equal((await environment.status(x.game)).ready,true);
 assert.equal(recipesFor(x.game,{...report,antiCheat:['BattlEye']}).find(type=>type.id===draft.kind).available,false);
});
test('CET authoring validates Lua 5.1, rejects later syntax, and requires revalidation after edits',async t=>{
 for(const text of ['local n=5 // 2','local x<const>=1','goto finish\n::finish::','local x=1 & 2','local broken=']) assert.equal(checkCET(text).passed,false,text);
 assert.equal(checkCET('error("must not execute")').passed,true);
 const workspace=await createAuthoringWorkspace({kind:draft.kind}); t.after(()=>workspace.close());
 await workspace.write('main.lua','local n=5 // 2'); assert.equal((await workspace.validate()).passed,false);
 await workspace.write('main.lua',code); assert.equal((await workspace.validate()).passed,true);
 assert.equal((await workspace.artifact({kind:draft.kind})).code,code);
 await workspace.write('main.lua',code+'\n-- edited'); await assert.rejects(workspace.artifact({kind:draft.kind}),/先写入/);
});
test('CET builds an actual init.lua package without a loader but blocks deployment until CET is present',async t=>{
 const x=await fixture(t), studio=new ModStudio(x.root,{integration:{python:false}});
 const workspace=await studio.workspace(x.game); assert.match(workspace.context.guide.text,/Lua 5.1/);
 const item=await studio.save('owner',x.game,draft);
 const report=await studio.toolchain.run('owner',x.game,item.id,workspace);
 assert.equal(report.status,'passed',JSON.stringify(report)); assert.equal(report.installation.ready,false); assert.ok(report.bundle);
 const preview=await studio.preview('owner',x.game,item.id), entry=preview.files.find(file=>file.name==='mod/init.lua');
 assert.ok(entry); assert.equal(checkCET(entry.text).passed,true); assert.match(entry.text,/spdlog.info/);
 await assert.rejects(studio.ruleFor(x.game,await studio.read('owner',item.id)),/Cyber Engine Tweaks/);
 await write(x.game.installPath,'bin/x64/plugins/cyber_engine_tweaks.asi','fixture loader');
 const rule=await studio.ruleFor(x.game,await studio.read('owner',item.id));
 assert.equal(rule.destination,`${CET}/mods/${item.manifest.UniqueID}`); assert.equal(rule.sourcePrefix,'mod');
 const lifecycle=new StudioLifecycle(studio,{}, {}, {});
 assert.equal(await lifecycle.logRelative(x.game,item),`${CET}/mods/${item.manifest.UniqueID}/${item.manifest.UniqueID}.log`);
 const invalid=await studio.save('owner',x.game,{...draft,code:'registerForEvent("onInit",function() end)'});
 const rejected=await studio.toolchain.run('owner',x.game,invalid.id,await studio.workspace(x.game));
 assert.equal(rejected.status,'failed'); assert.equal(rejected.bundle,undefined);
});
test('CET REST installation supports verify, disable, enable and uninstall while preserving other mods',async t=>{
 const x=await fixture(t); await write(x.game.installPath,'bin/x64/plugins/cyber_engine_tweaks.asi','fixture loader');
 await write(x.game.installPath,`${CET}/mods/Other/init.lua`,'-- preserve');
 const account=accountFixture(); account.updateAccount({membership:{tier:'pro',expiresAt:null}});
 const service=await createServer({root:path.join(x.root,'service'),port:0,accounts:account.options,scan:async()=>({games:[x.game],roots:[],diagnostics:[]}),installers:{processes:async()=>[]},studio:{integration:{python:false}}});
 t.after(async()=>{await new Promise(r=>service.server.close(r));await service.studio.conversations.settle();await service.downloads.persist;});
 const login=await loginFixture(service);
 const post=async(route,body)=>{const r=await login.fetch(service.url+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Moddock-Token':login.state.token},body:JSON.stringify({gameId:x.game.id,...body})});return {status:r.status,body:await r.json()};};
 const saved=await post('studio/save',{draft}); assert.equal(saved.status,200,JSON.stringify(saved.body));
 const prepared=await post('studio/prepare',{id:saved.body.id}); assert.equal(prepared.status,200,JSON.stringify(prepared.body));
 assert.equal(prepared.body.files.length,1);
 const installed=await post('installations/apply',{id:prepared.body.id}); assert.equal(installed.status,200,JSON.stringify(installed.body));
 const file=path.join(x.game.installPath,CET,'mods',saved.body.manifest.UniqueID,'init.lua');
 assert.match(await fs.readFile(file,'utf8'),/ReadFixtureState/);
 const lifecycle=service.studio.options.lifecycle, context={owner:'fixture-user',game:x.game,artifactId:saved.body.id,current:()=>true,authorize:async()=>{}};
 service.installers.options.openGame=async()=>{};
 const log=path.join(x.game.installPath,saved.body.runtime.log), marker=saved.body.runtime.marker;
 await write(x.game.installPath,saved.body.runtime.log,marker+'\n');
 await lifecycle.launch(context);
 const runtime=()=>service.studio.read(context.owner,saved.body.id).then(artifact=>lifecycle.runtime({owner:context.owner,game:x.game,artifact}));
 assert.equal((await runtime()).status,'unconfirmed','old logs cannot confirm the new launch');
 await fs.appendFile(log,marker+'\n'); assert.equal((await runtime()).status,'awaiting_trigger');
 const hex=value=>Buffer.from(value).toString('hex');
 await fs.appendFile(log,`MDVERIFY|${marker}|1|begin|effect|||\nMDVERIFY|${marker}|2|check_number|effect|${hex('42')}|${hex('42')}|${hex('0')}\n`);
 assert.equal((await runtime()).status,'behavior_verified');
 for(const action of ['verify','disable','enable','uninstall']) {const r=await post('installations/action',{id:installed.body.id,action}); assert.equal(r.status,200,JSON.stringify(r.body)); if(action==='disable'||action==='uninstall')await assert.rejects(fs.access(file));}
 assert.equal(await fs.readFile(path.join(x.game.installPath,CET,'mods/Other/init.lua'),'utf8'),'-- preserve');
});
test('CET Pi generation writes and validates real source before returning an artifact',async t=>{
 const fixture=await piFixture(t,{game:{name:'Cyberpunk 2077',appId:'1091500'},result:draft,respond:async({phase})=>phase==='submit'?{result:{kind:draft.kind,name:draft.name,author:draft.author}}:null});
 const result=await createDeepSeek({apiKey:fixture.key,pi:fixture.pi}).generate({kind:draft.kind,prompt:'Create a gameplay script',context:{game:fixture.game},capability:{deliverable:'mod'}});
 assert.equal(result.kind,draft.kind); assert.equal(result.code,code);
});
test('CET host guard executes callbacks without Lua 5.2 table helpers',async()=>{
 const engine=await new (require('wasmoon').LuaFactory)().createEngine();
 try {
  await engine.doString(`unpack=table.unpack; table.pack=nil; table.unpack=nil; logs={}; spdlog={info=function(s) logs[#logs+1]=s end}; Game={GetPlayer=function()return {ReadFixtureState=function()return 42 end}end}; registerHotkey=function(id,label,callback) callback() end`);
  const wrapped=require('../studio-runtime-verification.cjs').bootstrap('cet-fixture',code,'spdlog.info');
  await engine.doString(wrapped);
  const text=await engine.doString('return table.concat(logs,"\\n")');
  const result=require('../studio-runtime-verification.cjs').evaluate({text,marker:'cet-fixture',contract:require('../studio-runtime-verification.cjs').contract(code)});
  assert.equal(result.status,'behavior_verified');
 } finally {engine.global.close();}
});
test('MU private service accepts the CET kind through plan, generate and repair',async t=>{
 const received=[],{createStudioService}=require('./ai-ledger-fixture.cjs');
 const ai=Object.fromEntries(['plan','generate','repair'].map(action=>[action,async payload=>{received.push(action);return action==='plan'?{title:'CET',kind:draft.kind,summary:'CET gameplay',steps:['Implement'],requirements:[]}:draft;} ]));
 const token='c'.repeat(64), service=await createStudioService({accessToken:token,ai}); t.after(()=>service.close());
 for(const action of ['plan','generate','repair']){
  const response=await fetch(service.url+'/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'X-Mu-Account-Id':'fixture-user'},body:JSON.stringify({prompt:'Create a CET gameplay Mod',...(action==='plan'?{types:[{id:draft.kind,available:true}]}:{kind:draft.kind})})});
  assert.equal(response.status,200,await response.clone().text());
 }
 assert.deepEqual(received,['plan','generate','repair']);
});
