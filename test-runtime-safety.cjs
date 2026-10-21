const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const app = process.env.MODDOCK_TEST_ROOT || __dirname;
const {analyzeUE4SS,installedUE4SS,agentGuide} = require(path.join(app,'studio-ue4ss-safety.cjs'));

test('effective FOV reflected lookup must use the camera manager owner',()=>{
 const wrong=analyzeUE4SS('local reader="/Script/Engine.PlayerController:GetFOVAngle"');
 assert.ok(wrong.findings.some(f=>f.code==='UE4SS_FOV_OWNER'));
 const correct=analyzeUE4SS('local reader="/Script/Engine.PlayerCameraManager:GetFOVAngle"');
 assert.ok(!correct.findings.some(f=>f.code==='UE4SS_FOV_OWNER'));
});
const {ModStudio} = require(path.join(app,'mod-studio.cjs'));
const {creationPayload} = require(path.join(app,'studio-mu-client.cjs'));
const ron={appId:'1144200'};
const analysis=(code,game=ron)=>analyzeUE4SS(code,{game});
const codes=result=>result.findings.filter(f=>f.severity==='error').map(f=>f.code);
const fixtureRoot=process.env.MODDOCK_CRASH_FIXTURE_ROOT || path.resolve(__dirname,'../ron-crash-fix-20261019');
const fixedRoot=path.join(fixtureRoot,'fixed');
const backupRoot=path.join(fixtureRoot,'backup');
const names=['Moddock35338a1c62b44ec1823465829a3f2af0','Moddock3e8a018b81c645c992a3d66c1a0d9329','Moddock40f14048ffb944d79bda6199930d4b6b'];
test('all three real failing scripts are rejected; repaired scripts pass known-risk analysis',async()=>{
 for(const name of names) {
  const bad=await fs.readFile(path.join(backupRoot,name,'Scripts/main.lua'),'utf8');
  const good=await fs.readFile(path.join(fixedRoot,name,'Scripts/main.lua'),'utf8');
  assert.equal(analysis(bad).passed,false,name);
  assert.equal(analysis(good).passed,true,JSON.stringify(analysis(good).findings));
 }
});
test('comments, quoted source, long strings and correct signatures do not trip checks',()=>{
 const r=analysis(`-- mesh:AddImpulse({},'None',true,false)\nlocal text=[=[pc:PrintString()]=]\nlocal quoted="ExecuteWithDelay(1, function() a:GetWorld() end)"\nmesh:AddImpulse({X=0,Y=0,Z=1},'None',true)\n`);
 assert.deepEqual(codes(r),[]);
});
test('off-thread engine reads follow named helpers and pcall; dispatch boundary is respected',()=>{
 const bad=analysis(`local function work() pcall(function() local w=actor:GetWorld() end) end\nExecuteWithDelay(100,work)`);
 assert.ok(codes(bad).includes('UE4SS_OFF_THREAD'));
 const good=analysis(`local function work() ExecuteInGameThread(function() actor:GetWorld() end) end\nExecuteWithDelay(100,work)`);
 assert.deepEqual(codes(good),[]);
});
test('hook borrowed parameters cannot escape into deferred closures',()=>{
 assert.ok(codes(analysis(`RegisterHook('/Script/Test.C:Hit',function(ctx) ExecuteInGameThreadWithDelay(100,function() ctx:get() end) end)`)).includes('UE4SS_BORROWED_PARAM'));
 assert.deepEqual(codes(analysis(`RegisterHook('/Script/Test.C:Hit',function(ctx,amount) local n=amount:get(); ExecuteInGameThreadWithDelay(100,function() print(n) end) end)`)),[]);
});
test('native physics mutation in a hook is rejected; queued mutation is allowed',()=>{
 assert.ok(codes(analysis(`local function change() actor:EnableRagdoll(5,false) end\nRegisterHook('/Script/Test.C:Death',change)`)).includes('UE4SS_REENTRANT_MUTATION'));
 assert.deepEqual(codes(analysis(`RegisterHook('/Script/Test.C:Death',function() ExecuteInGameThreadWithDelay(100,function() actor:EnableRagdoll(5,false) end) end)`)),[]);
});
test('invalid lookup sentinel check is rejected; validated UFunction is allowed',()=>{
 assert.ok(codes(analysis(`local f=StaticFindObject('/Script/A:B'); return f~=nil`)).includes('UE4SS_INVALID_LOOKUP'));
 assert.deepEqual(codes(analysis(`local f=StaticFindObject('/Script/A:B'); return f~=nil and f:IsValid()`)),[]);
});
test('game-specific regressions and signatures do not leak into other games',()=>{
 assert.ok(codes(analysis(`ksl:PrintString()`)).includes('RON_NATIVE_DIAGNOSTIC'));
 assert.equal(analysis(`actor:EnableRagdoll(1,2,3)`,{appId:'999'}).passed,true);
 assert.equal(analysis(`ksl:PrintString()`,{appId:'999'}).passed,true);
});
test('native arity catches colon syntax and generic forwarding helper retries',()=>{
 assert.ok(codes(analysis(`mesh:AddImpulse({},'None',true,false)`)).includes('UE4SS_NATIVE_ARITY'));
 assert.ok(codes(analysis(`local function callSafe(o,n,...) local f=o[n]; local a=table.pack(...); return f(o,table.unpack(a)) end\ncallSafe(mesh,'AddImpulse',{},'None',true,false)`)).includes('UE4SS_NATIVE_ARITY'));
});
test('risk analysis never executes generated code or claims gameplay verification',()=>{
 globalThis.UE4SS_ANALYSIS_RAN=false;
 const r=analysis(`while true do end; os.execute('should-not-run')`);
 assert.equal(r.runtimeVerified,false); assert.equal(globalThis.UE4SS_ANALYSIS_RAN,false);
 assert.equal(analysis(`local a <const> = 1`).passed,true);
 assert.ok(codes(analysis(`local a <const> = 1\nmesh:AddImpulse({},'None',true,false)`)).includes('UE4SS_NATIVE_ARITY'));
});
test('same-camera overlap is surfaced without disabling user Mods',()=>{
 const r=analyzeUE4SS(`pawn:ToggleThirdPerson()`,{game:ron,installed:[{id:'old',cameraCustom:true}]});
 assert.equal(r.passed,true); assert.ok(r.findings.some(f=>f.code==='UE4SS_CAMERA_OVERLAP'&&f.severity==='warning'));
});
async function fixture(t,options={}) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ue4ss-safety-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const game={id:'g',appId:'1144200',name:'Ready Or Not',installPath:path.join(dir,'Game')};
 await fs.mkdir(game.installPath,{recursive:true});
 const guide={path:'skills/mod-any-game/references/engines/unreal.md',text:await agentGuide('Unreal guide')};
 const diagnostic={engine:{key:'unreal',name:'Unreal Engine'},loaders:[],loaderFiles:{UE4SS:[]},antiCheat:[],onlineOnly:false,requirements:[],integration:{message:'test'},warnings:[]};
 const context={game,guide,notes:[],toolkit:{repository:'fixture',commit:'fixture'},engineEvidence:{family:'unreal',installedUE4SS:{mods:[]}}};
 const studio=new ModStudio(dir,{tools:{luac:false,dotnet:false},integration:{python:false},...options});
 const workspace={diagnostic,context,types:[{id:'ue4ss-lua',available:true}]};
 studio.workspace=async()=>workspace; studio.prepareNative=async()=>{};
 return {studio,workspace,game,dir};
}
const draft=code=>({kind:'ue4ss-lua',name:'Camera',author:'Test',description:'Camera fixture',code: `ModdockVerification.expect('effect','test effective state'); ModdockVerification.begin('effect'); local measured = readEffectiveGameState(); ModdockVerification.check('effect',measured,1);\n`+code});
const goodCodePromise=fs.readFile(path.join(fixedRoot,names[1],'Scripts/main.lua'),'utf8');
test('real build gate prevents bad ZIP output; accepted source is still runtime not_run',async t=>{
 const {studio,workspace,game}=await fixture(t);
 const bad=await studio.save('owner',game,draft(`pc:SetViewTargetWithBlend(pawn,0)`));
 const report=await studio.toolchain.run('owner',game,bad.id,workspace);
 assert.equal(report.status,'failed'); assert.equal(report.bundle,undefined);
 assert.ok(report.ue4ssSafety[0].findings.some(f=>f.code==='UE4SS_NATIVE_ARITY'));
 const good=await studio.save('owner',game,draft(await goodCodePromise));
 const passed=await studio.toolchain.run('owner',game,good.id,workspace);
 assert.equal(passed.status,'passed'); assert.ok(passed.bundle); assert.equal(passed.runtime.status,'not_run');
});
test('actual conversation automatically repairs risk failure without user intervention',async t=>{
 let repairCalls=0;
 const x=await fixture(t,{
  plan:async()=>({title:'Camera',summary:'Camera',steps:['Implement camera'],requirements:[],questions:[],kind:'ue4ss-lua'}),
  generate:async()=>draft(`pc:SetViewTargetWithBlend(pawn,0)`),
  repair:async payload=>{repairCalls++; assert.equal(payload.validation.status,'failed'); assert.ok(payload.validation.ue4ssSafety[0].findings.length); return draft(await goodCodePromise);}
 });
 const item={id:crypto.randomUUID(),gameId:'g',title:'Camera',status:'analyzing',messages:[{role:'user',content:'做一个第三人称视角 Mod'}],planningAttempts:[]};
 await x.studio.conversations.run('owner',x.game,item,new AbortController(),()=>true);
 assert.equal(item.status,'completed',item.error); assert.equal(repairCalls,1);
 const saved=await x.studio.read('owner',item.artifactId); assert.equal(saved.toolchain.status,'passed');
});
test('repeated unsafe output stops after two automatic repairs and remains uninstallable',async t=>{
 let repairCalls=0;const bad=draft(`pc:SetViewTargetWithBlend(pawn,0)`);
 const x=await fixture(t,{plan:async()=>({title:'Camera',summary:'Camera',steps:['Implement'],questions:[],kind:'ue4ss-lua'}),generate:async()=>bad,repair:async()=>{repairCalls++;return bad;}});
 const item={id:crypto.randomUUID(),gameId:'g',status:'analyzing',messages:[{role:'user',content:'做第三人称视角 Mod'}],planningAttempts:[]};
 await x.studio.conversations.run('owner',x.game,item,new AbortController(),()=>true);
 assert.equal(repairCalls,2); assert.equal(item.status,'failed');
 const saved=await x.studio.read('owner',item.artifactId); assert.equal(saved.installable,false); assert.equal(saved.toolchain.bundle,undefined);
});
test('old passed build cannot bypass the current installation risk gate',async t=>{
 const {studio,game}=await fixture(t);
 await assert.rejects(studio.ruleFor(game,{adapterId:'ue4ss-lua',draft:draft(`pc:SetViewTargetWithBlend(pawn,0)`),toolchain:{status:'passed'}}),e=>e.code==='UE4SS_RISK_CHECK_FAILED');
});
test('packaged skill and contract reach every managed request through the existing guide field',async()=>{
 const guide=await agentGuide('x'.repeat(15000));
 assert.ok(guide.length<=12000); assert.ok(guide.includes('UE4SS runtime contract'));
 for(const action of ['plan','generate','repair']) {
  const sent=creationPayload({action,context:{guide:{text:guide},engineEvidence:{installedUE4SS:{mods:[{id:'existing',cameraCustom:true}]}}}});
  assert.equal(sent.context.guide.text,guide); assert.equal(sent.context.engineEvidence.installedUE4SS.mods[0].id,'existing');
 }
 const selected=require(path.join(app,'studio-skills.cjs')).selectSkills({appId:'1144200'},{engine:{key:'unreal'}});
 assert.ok(selected.skills.some(s=>s.id==='ue4ss-runtime-safety')); assert.ok(selected.references.some(r=>r.id==='ue4ss-runtime-safety'));
});
test('real workspace path injects the skill and installed inventory before managed requests',async t=>{
 const x=await fixture(t);
 x.workspace.diagnostic.engine.evidence=[];
 x.studio.integration.diagnose=async()=>x.workspace.diagnostic;
 x.studio.integration.context=async()=>({...x.workspace.context,guide:{path:'unreal.md',text:'Original engine guide'}});
 x.studio.native.snapshot=async(game,evidence)=>evidence;
 const actual=await ModStudio.prototype.workspace.call(x.studio,x.game);
 assert.ok(actual.context.guide.text.startsWith('Host UE4SS authoring skill'));
 assert.ok(actual.context.engineEvidence.installedUE4SS);
 assert.ok(creationPayload({context:actual.context}).context.guide.text.includes('UE4SS runtime contract'));
});
test('installed script scan honors enabled state and refuses linked source outside game',async t=>{
 const {game}=await fixture(t), mods=path.join(game.installPath,'ue4ss','Mods');
 for(const id of ['Enabled','Disabled']) {
  await fs.mkdir(path.join(mods,id,'Scripts'),{recursive:true});
  await fs.writeFile(path.join(mods,id,'enabled.txt'),'');
  await fs.writeFile(path.join(mods,id,'Scripts/main.lua'),`pawn:ToggleThirdPerson()`);
 }
 await fs.writeFile(path.join(mods,'mods.txt'),'Disabled : 0\nEnabled : 1\n');
 const outside=path.join(path.dirname(game.installPath),'Outside');
 await fs.mkdir(path.join(outside,'Scripts'),{recursive:true});
 await fs.writeFile(path.join(outside,'enabled.txt'),'');
 await fs.writeFile(path.join(outside,'Scripts/main.lua'),`pawn:ToggleThirdPerson()`);
 await fs.symlink(outside,path.join(mods,'Linked'),'junction');
 const r=await installedUE4SS(game,{loaderFiles:{UE4SS:['ue4ss/UE4SS.dll']}});
 assert.deepEqual(r.mods.map(m=>m.id),['Enabled']); assert.equal(r.mods[0].cameraNative,true);
});
