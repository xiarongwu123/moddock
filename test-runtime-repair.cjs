const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const app=process.env.MODDOCK_TEST_ROOT || __dirname;
const {contract,bootstrap,evaluate}=require(path.join(app,'studio-runtime-verification.cjs'));
const {runtimeCycle}=require(path.join(app,'studio-runtime-cycle.cjs'));
const {StudioLifecycle,freshText}=require(path.join(app,'studio-lifecycle.cjs'));
const {ModStudio}=require(path.join(app,'mod-studio.cjs'));
const {LuaFactory}=require(path.join(app,'node_modules/wasmoon'));
const good=`ModdockVerification.expect('effect','effective state after game update')
local function applied()
 ModdockVerification.begin('effect')
 local actual = readEffectiveGameState()
 ModdockVerification.check('effect',actual,42,0.1)
end
RegisterKeyBind(Key.END,ModdockVerification.guard('effect',applied))`;
const draft=code=>({kind:'ue4ss-lua',name:'Verified mod',author:'Test',description:'Read effective state',code});
const hex=v=>Buffer.from(String(v)).toString('hex');
const event=(seq,kind,id,a='',b='',tol='')=>`[Lua] MDVERIFY|marker|${seq}|${kind}|${id}|${hex(a)}|${hex(b)}|${hex(tol)}`;
const spec=contract(good);
test('contract requires actual effect declarations, trigger and dynamic readback',()=>{
 assert.equal(spec.passed,true,JSON.stringify(spec));
 for(const code of ['print("loaded")',`ModdockVerification.expect('x','x')`,good.replace('actual,42','true,true'),good.replace('local actual = readEffectiveGameState()','local actual = 42'),good.replace("ModdockVerification.begin('effect')",''),good+'\nlocal ModdockVerification = {}']) assert.equal(contract(code).passed,false,code);
 assert.equal(contract('-- '+good.replaceAll('\n','\n-- ')).passed,false);
});
test('host wrapper runs in real Lua VM; emits observations instead of trusting success text',async()=>{
 const lua=await new LuaFactory().createEngine(),lines=[];
 try {
  lua.global.set('print',s=>lines.push(s));lua.global.set('readEffectiveGameState',()=>41);
  await lua.doString(`Key={END=1}; function RegisterKeyBind(k,fn) handler=fn end\n`+bootstrap('marker',good)+`\nhandler()`);
  const result=evaluate({text:lines.join('\n'),marker:'marker',contract:spec});
  assert.equal(result.status,'behavior_failed');assert.ok(result.evidence.some(e=>e.actual==='41'));
 }finally{lua.global.close();}
});

test('discarded guard wrappers in hotkey and dispatched callbacks are build errors',()=>{
 const unused=good.replace("RegisterKeyBind(Key.END,ModdockVerification.guard('effect',applied))",`RegisterKeyBind(Key.END,function()
 ModdockVerification.guard('effect',function()
  ExecuteInGameThread(function() ModdockVerification.guard('effect',applied) end)
 end)
end)`);
 const report=contract(unused);
 assert.equal(report.passed,false);
 assert.equal(report.findings.filter(f=>f.code==='RUNTIME_GUARD_UNUSED').length,2);
 assert.ok(contract(good+"\npcall(ModdockVerification.guard,'effect',applied)").findings.some(f=>f.code==='RUNTIME_GUARD_UNUSED'));
 assert.equal(contract(good+"\nModdockVerification.guard('effect',applied)()").passed,true);
});

test('real Lua input reproduces silent discarded guard and verifies proper dispatched wrapper',async()=>{
 const lua=await new LuaFactory().createEngine(),lines=[];let reads=0;
 try {
  lua.global.set('print',s=>lines.push(s));lua.global.set('readEffectiveGameState',()=>{reads++;return 42;});
  const body=good.slice(0,good.indexOf('RegisterKeyBind'));
  await lua.doString(`Key={END=1}; function RegisterKeyBind(k,fn) handler=fn end; function ExecuteInGameThread(fn) fn() end\n`+bootstrap('marker',body+`RegisterKeyBind(Key.END,function() ModdockVerification.guard('effect',applied) end)`)+`\nhandler()`);
  assert.equal(reads,0);assert.equal(lines.filter(s=>s.startsWith('MDVERIFY')).length,0);
  lines.length=0;
  const fixed=body+`RegisterKeyBind(Key.END,ModdockVerification.guard('effect',function() ExecuteInGameThread(ModdockVerification.guard('effect',applied)) end))`;
  assert.equal(contract(fixed).passed,true);
  await lua.doString(bootstrap('marker',fixed)+`\nhandler()`);
  assert.equal(reads,1);assert.equal(evaluate({text:lines.join('\n'),marker:'marker',contract:contract(fixed)}).status,'behavior_verified');
 }finally{lua.global.close();}
});
test('guard reports Lua callback exceptions and initialization errors',async()=>{
 const lua=await new LuaFactory().createEngine(),lines=[];
 try {
  lua.global.set('print',s=>lines.push(s));
  await lua.doString(`Key={END=1}; function RegisterKeyBind(k,fn) handler=fn end\n`+bootstrap('marker',good)+`\nhandler()`);
  assert.equal(evaluate({text:lines.join('\n'),marker:'marker',contract:spec}).status,'script_error');
 }finally{lua.global.close();}
});
test('loading or printed success cannot prove gameplay; no trigger is not an error',()=>{
 assert.equal(evaluate({text:'marker success true',marker:'marker',contract:spec}).status,'awaiting_trigger');
 assert.equal(evaluate({text:event(1,'begin','effect'),marker:'marker',contract:spec,now:0}).status,'awaiting_trigger');
});
test('host compares numbers and requires every declared outcome',()=>{
 const text=event(1,'begin','effect')+'\n'+event(2,'check_number','effect',42.05,42,0.1);
 assert.equal(evaluate({text,marker:'marker',contract:spec}).status,'behavior_verified');
 assert.equal(evaluate({text,marker:'marker',contract:{expectations:[...spec.expectations,{id:'restore'}]}}).status,'awaiting_trigger');
 assert.equal(evaluate({text:text.replace('check_number','check_boolean'),marker:'marker',contract:spec}).status,'behavior_failed');
});
test('timeout starts after a real trigger and survives repeated observations',()=>{
 const text=event(1,'begin','effect');
 const first=evaluate({text,marker:'marker',contract:spec,now:1000});
 assert.equal(evaluate({text,marker:'marker',contract:spec,previous:first,now:17000}).status,'behavior_failed');
});
test('repeated trigger invalidates older pass; failure cannot be hidden by a later pass',()=>{
 const pass=event(1,'begin','effect')+'\n'+event(2,'check_number','effect',42,42,0);
 assert.equal(evaluate({text:pass+'\n'+event(3,'begin','effect'),marker:'marker',contract:spec}).status,'awaiting_trigger');
 const fail=event(1,'begin','effect')+'\n'+event(2,'check_number','effect',1,42,0);
 assert.equal(evaluate({text:fail+'\n'+pass.replace('|1|','|3|').replace('|2|','|4|'),marker:'marker',contract:spec}).status,'behavior_failed');
});
test('other revision markers, unmatched checks, invalid values and old logs never pass',()=>{
 for(const text of [event(2,'check_number','effect',42,42,0),event(1,'begin','other')+'\n'+event(2,'check_number','other',42,42,0),'MDVERIFY|old|1|check_number|effect|3432|3432|30']) assert.notEqual(evaluate({text,marker:'marker',contract:spec}).status,'behavior_verified');
 assert.equal(freshText({hash:'same',mtime:Date.now(),bytes:Buffer.from('success')},{hash:'same'},new Date().toISOString()),'');
 assert.equal(evaluate({text:event(1,'begin','effect')+'\n'+event(2,'check_number','effect','NaN',42,0),marker:'marker',contract:spec}).status,'behavior_failed');
});
test('crash takes priority over successful assertions without asserting a unique culprit',()=>{
 const result=evaluate({text:event(1,'begin','effect')+'\n'+event(2,'check_number','effect',42,42,0),marker:'marker',contract:spec,crashed:true,exitCode:3221225477});
 assert.equal(result.status,'crash_observed');assert.match(result.detail,/其他已启用/);
});
async function fixture(t,options={}) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'runtime-loop-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const game={id:'g',appId:'1144200',name:'Ready Or Not',installPath:path.join(dir,'Game')};await fs.mkdir(game.installPath);
 const workspace={diagnostic:{engine:{key:'unreal',name:'Unreal Engine'},loaders:[],loaderFiles:{UE4SS:[]},requirements:[],antiCheat:[],warnings:[],integration:{message:'test'}},context:{game,guide:{text:'test',path:'test'},toolkit:{commit:'test',repository:'test'},notes:[],engineEvidence:{family:'unreal'}},types:[{id:'ue4ss-lua',available:true}]};
 const studio=new ModStudio(dir,{tools:{luac:false,dotnet:false},integration:{python:false},...options});studio.workspace=async()=>workspace;studio.prepareNative=async()=>{};
 return {studio,game,workspace,dir};
}

test('library collection requires persisted user acceptance of the exact build',async t=>{
 const {recordFeedback,confirmed}=require(path.join(app,'studio-user-feedback.cjs'));
 const {studio,game,workspace}=await fixture(t);
 const item=await studio.save('owner',game,draft(good));await studio.toolchain.run('owner',game,item.id,workspace);
 const context={owner:'owner',game,artifactId:item.id,current:()=>true,authorize:async()=>{}};
 let imported=0;const lifecycle=new StudioLifecycle(studio,{importCreation:async()=>({id:'job'})},{import:async()=>{imported++;}},{});
 await assert.rejects(lifecycle.keep(context),/确认/);assert.equal(imported,0);
 const buildId=(await studio.read('owner',item.id)).toolchain.id;
 await assert.rejects(recordFeedback(studio,'owner',game,{artifactId:item.id,buildId:'stale',status:'accepted'},()=>true),/版本/);
 await assert.rejects(recordFeedback(studio,'owner',{id:'other'},{artifactId:item.id,buildId,status:'accepted'},()=>true),/当前游戏/);
 await assert.rejects(recordFeedback(studio,'owner',game,{artifactId:item.id,buildId,status:'rejected',problem:' '},()=>true),/描述/);
 await recordFeedback(studio,'owner',game,{artifactId:item.id,buildId,status:'accepted'},()=>true);
 assert.equal(confirmed(await studio.read('owner',item.id)),true);
 await lifecycle.keep(context);assert.equal(imported,1);
 await studio.toolchain.run('owner',game,item.id,workspace);
 assert.equal(confirmed(await studio.read('owner',item.id)),false);
 await assert.rejects(lifecycle.keep(context),/确认/);
});

test('negative user feedback preserves draft and runtime context through a real conversation rebuild',async t=>{
 let request;
 const {studio,game,workspace}=await fixture(t,{plan:async()=>({title:'Feature',summary:'Fix reported issue',steps:['Repair'],questions:[],kind:'ue4ss-lua'}),generate:async p=>{request=p;return draft(good);}});
 const initial=await studio.save('owner',game,draft(good));await studio.toolchain.run('owner',game,initial.id,workspace);
 await fs.writeFile(path.join(studio.recordPath('owner',initial.id),'deployment.json'),JSON.stringify({runtime:{status:'awaiting_trigger',detail:'no callback'}}));
 const item={id:crypto.randomUUID(),gameId:game.id,title:'Feature',artifactId:initial.id,status:'completed',messages:[{role:'user',content:'Original requested feature'}]};
 await studio.conversations.persist('owner',item);
 const buildId=(await studio.read('owner',initial.id)).toolchain.id;
 const input={id:item.id,artifactId:initial.id,buildId,status:'rejected',problem:'F7 没有反应'};
 await studio.conversations.feedback('owner',game,input,()=>true,async()=>{});
 await studio.conversations.runs.get(studio.conversations.key('owner',item.id));
 const result=await studio.conversations.read('owner',game,item.id);
 assert.equal(result.status,'completed',result.error);assert.notEqual(result.artifactId,initial.id);
 assert.equal(request.previousDraft.code,good);assert.equal(request.validation.userFeedback.problem,input.problem);
 assert.equal(request.validation.runtime.detail,'no callback');
 assert.equal((await studio.read('owner',initial.id)).feedback.status,'rejected');
 assert.equal((await studio.read('owner',result.artifactId)).feedback,undefined);
 assert.equal(require(path.join(app,'studio-mu-client.cjs')).creationPayload(request).validation.userFeedback.problem,input.problem);
});

test('shipped feedback UI gates collection, requires a problem, and asks again for a new revision',async()=>{
 const vm=require('node:vm');
 const source=(await fs.readFile(path.join(app,'public/mod-studio.js'),'utf8')).replace(/^import .*;\r?\n/gm,'').replace('export function createModStudio','function createModStudio');
 const context={window:{},document:{querySelector:()=>null,getElementById:()=>null},queueMicrotask,clearTimeout:()=>{},setTimeout:()=>1,DN:{},PN:{},EN:null,RN:null};
 vm.createContext(context);
 // The reproducible-build test below verifies that this factory is shipped.
 const game={id:'g',name:'Game'}, thread={id:'t',status:'completed',artifactId:'a',updated:'1',messages:[]};
 let saved={id:'a',adapterId:'ue4ss-lua',installable:true,draft:{name:'Mod'},toolchain:{id:'b',status:'passed',summary:'OK',checks:[],runtime:{detail:'not_run'}}},calls=[];
 context.options={api:async(route,body)=>{
  calls.push({route,body});
  if(route==='studio/conversations/list')return {items:[thread]};
  if(route==='studio/list')return {items:[]};
  if(route==='studio/environment' || route==='studio/prepare-environment')return {ready:true};
  if(route==='studio/workspace')return {};
  if(route==='studio/conversations/read')return thread;
  if(route==='studio/read')return saved;
  if(route==='studio/conversations/feedback'){
   if(body.status==='accepted'){saved={...saved,feedback:{status:'accepted',buildId:'b'}};return saved.feedback;}
   saved={...saved,id:'new',toolchain:{...saved.toolchain,id:'new-build'},feedback:undefined};Object.assign(thread,{artifactId:'new',updated:'2'});return thread;
  }
  throw new Error(route);
 },render:()=>{},esc:s=>String(s||'').replaceAll('<','&lt;'),icon:()=>'',getGame:()=>game,getGames:()=>[game],getStatus:()=>({allowed:true,aiAvailable:true})};
 vm.runInContext(source+'\nthis.ui=createModStudio(options)',context);
 const ui=context.ui;await ui.enter();await ui.click({studioAction:'start'});
 assert.ok(!ui.render(game).includes('data-studio-action="keep"'));
 await ui.click({studioAction:'feedback-yes'});assert.ok(ui.render(game).includes('data-studio-action="keep"'));
 await ui.click({studioAction:'feedback-no'});assert.ok(ui.render(game).includes('data-studio-feedback'));assert.ok(!ui.render(game).includes('data-studio-action="keep"'));
 const before=calls.length;await ui.click({studioAction:'feedback-submit'});assert.equal(calls.length,before);assert.match(ui.render(game),/请先描述/);
 ui.input({hasAttribute:name=>name==='data-studio-feedback',value:'F7 没反应'});
 await ui.click({studioAction:'feedback-submit'});
 assert.equal(calls.findLast(c=>c.route==='studio/conversations/feedback').body.problem,'F7 没反应');
 assert.ok(!ui.render(game).includes('data-studio-action="keep"'));ui.reset();
});
test('real build rejects missing acceptance contract and compiles injected probe wrapper',async t=>{
 const {studio,game,workspace}=await fixture(t);
 const bad=await studio.save('owner',game,draft('print("success")'));const failed=await studio.toolchain.run('owner',game,bad.id,workspace);
 assert.equal(failed.status,'failed');assert.equal(failed.bundle,undefined);assert.ok(failed.runtimeContract.findings.length);
 const artifact=await studio.save('owner',game,draft(good));const report=await studio.toolchain.run('owner',game,artifact.id,workspace);
 assert.equal(report.status,'passed',JSON.stringify(report));assert.ok(report.bundle);assert.equal(report.runtime.status,'not_run');
});
async function cycleFixture(t, runtime='behavior_failed',extra={}) {
 const x=await fixture(t),{studio,game,workspace}=x;let clock=0,repairs=0,installed=0,launched=0,idleChecks=0;
 const initial=await studio.save('owner',game,draft(good));await studio.toolchain.run('owner',game,initial.id,workspace);
 const item={id:crypto.randomUUID(),artifactId:initial.id,messages:[{role:'user',content:'Make requested feature'}]};
 studio.options.runtimeNow=()=>clock;studio.options.runtimeObservationMs=100;studio.options.runtimePollMs=10;studio.options.runtimeSleep=async()=>{clock+=10;};
 studio.options.repair=async p=>{repairs++;assert.equal(p.validation.status,'failed');assert.equal(p.previousDraft.code,good);return draft(good);};
 studio.options.lifecycle={idle:async()=>{idleChecks++;return true;},install:async()=>{installed++;},launch:async()=>{launched++;}};
 studio.toolchain.checkRuntime=async()=>({id:'build',status:'passed',summary:'built',checks:[],runtime:{status:launched?'behavior_verified':runtime,detail:'evidence',runId:'run'+launched,evidence:[{actual:'wrong'}],exited:!!launched}});
 Object.assign(studio.options,extra);
 const context={owner:'owner',game,current:()=>true,authorize:async()=>{},signal:new AbortController().signal};
 const run=()=>runtimeCycle({studio,owner:'owner',game,item,context,stage:async s=>item.status=s,persist:async()=>{},message:m=>item.messages.push({role:'system',content:m})});
 return {...x,item,context,run,counts:()=>({repairs,installed,launched,idleChecks})};
}
for(const runtime of ['behavior_failed','script_error','crash_observed','loader_error']) test(`${runtime} -> repair -> real save/build -> safe replace -> new run verification`,async t=>{
 const x=await cycleFixture(t,runtime);await x.run();assert.equal(x.item.status,'completed');assert.deepEqual(x.counts(),{repairs:1,installed:1,launched:1,idleChecks:1});assert.equal(x.item.runtimeVerification.runId,'run1');assert.equal(x.item.runtimeRecovery.attempts.length,1);
});
test('running game delays installation; pending repair survives stop and resumes without another AI call',async t=>{
 const x=await cycleFixture(t);x.studio.options.lifecycle.idle=async()=>false;await x.run();assert.equal(x.item.status,'awaiting_exit');assert.equal(x.counts().installed,0);const pending=x.item.runtimeRecovery.pendingArtifactId;assert.ok(pending);
 x.studio.options.lifecycle.idle=async()=>true;await x.run();assert.equal(x.item.status,'completed');assert.equal(x.item.artifactId,pending);assert.equal(x.counts().repairs,1);
});
test('continuous ineffective output consumes at most two repairs, never reports completed',async t=>{
 const x=await cycleFixture(t);x.studio.toolchain.checkRuntime=async()=>({id:'b',status:'passed',checks:[],runtime:{status:'behavior_failed',detail:'bad'}});await x.run();assert.equal(x.counts().repairs,2);assert.equal(x.item.status,'failed');
});
test('untriggered hotkey waits without spending repair credits',async t=>{
 const x=await cycleFixture(t,'awaiting_trigger');await x.run();assert.equal(x.item.status,'awaiting_runtime');assert.equal(x.counts().repairs,0);
});
test('account change or cancellation prevents deployment and further generation',async t=>{
 const x=await cycleFixture(t);x.context.current=()=>false;await assert.rejects(x.run(),/停止|切换/);assert.equal(x.counts().repairs,0);assert.equal(x.counts().installed,0);
});
test('real conversation repairs absent verification contract before completing generation',async t=>{
 let repair=0;
 const x=await fixture(t,{plan:async()=>({title:'Feature',summary:'Feature',steps:['Implement'],questions:[],kind:'ue4ss-lua'}),generate:async()=>draft('print("done")'),repair:async p=>{repair++;assert.ok(p.validation.runtimeContract.findings.length);return draft(good);}});
 const item={id:crypto.randomUUID(),gameId:'g',status:'analyzing',messages:[{role:'user',content:'Make feature'}],planningAttempts:[]};
 await x.studio.conversations.run('owner',x.game,item,new AbortController(),()=>true,async()=>{});assert.equal(item.status,'completed',item.error);assert.equal(repair,1);
});
test('runtime cycle is actually used by conversation launch command',async t=>{
 const x=await cycleFixture(t,'behavior_verified');x.item.command='launch';x.item.gameId='g';
 x.studio.options.lifecycle.launch=async()=>({message:'launched'});
 x.studio.toolchain.checkRuntime=async()=>({id:'b',status:'passed',checks:[],runtime:{status:'behavior_verified',detail:'readback',exited:true}});
 await x.studio.conversations.run('owner',x.game,x.item,new AbortController(),()=>true,async()=>{});
 assert.equal(x.item.status,'completed',x.item.error);assert.equal(x.item.runtimeVerification.status,'behavior_verified');
});
test('lifecycle reads actual fresh log, binds revision/run and observes child exit even after passing',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'runtime-log-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const game={id:'g',installPath:dir},artifact={id:'a',sha256:'sha',buildId:'b',manifest:{UniqueID:'CurrentMod'},runtime:{loader:'UE4SS',marker:'marker',verification:spec},adapterId:'ue4ss-lua'};
 const oldText='previous success\n';await fs.writeFile(path.join(dir,'loader.log'),oldText);
 const baseline={hash:crypto.createHash('sha256').update(oldText).digest('hex'),size:Buffer.byteLength(oldText)};
 const run={id:'r',gameId:'g',started:new Date(Date.now()-1000).toISOString(),managed:[{id:'mod'}]};
 artifact.deployment={runId:'r',sha256:'sha',buildId:'b',gameRoot:await fs.realpath(dir),logRelative:'loader.log',started:run.started,baseline};
 const studio={options:{},recordPath:()=>dir};
 const installers={state:{mods:[{id:'mod',gameId:'g',jobId:'j',status:'enabled',root:dir,profile:{mode:'copy'}}],runs:[run]}};
 const lifecycle=new StudioLifecycle(studio,{jobs:[{id:'j',creationOwner:'o',source:'studio',gameId:'g',resourceId:'studio:a'}]},null,installers);
 let result=await lifecycle.runtime({owner:'o',game,artifact});assert.equal(result.status,'unconfirmed');
 const text='marker\n'+event(1,'begin','effect')+'\n'+event(2,'check_number','effect',42,42,0);
 await fs.appendFile(path.join(dir,'loader.log'),text);
 result=await lifecycle.runtime({owner:'o',game,artifact});assert.equal(result.status,'behavior_verified');
 run.exited=new Date().toISOString();run.exitCode=3221225477;
 result=await lifecycle.runtime({owner:'o',game,artifact});assert.equal(result.status,'crash_observed');assert.equal(result.exited,true);
 artifact.deployment.sha256='other';assert.equal((await lifecycle.runtime({owner:'o',game,artifact})).status,'stale_run');
 artifact.deployment.sha256='sha';installers.state.runs.unshift({id:'new',gameId:'g'});assert.equal((await lifecycle.runtime({owner:'o',game,artifact})).status,'stale_run');
});
test('unrelated loader errors do not cause paid repairs to a valid Mod',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'runtime-error-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const game={id:'g',installPath:dir},run={id:'r',gameId:'g',started:new Date(Date.now()-1000).toISOString(),managed:[{id:'m'}]};
 const artifact={id:'a',sha256:'s',runtime:{marker:'marker',loader:'UE4SS',verification:spec},manifest:{UniqueID:'MyMod'},deployment:{sha256:'s',runId:'r',gameRoot:await fs.realpath(dir),started:run.started,logRelative:'log'}};
 const lifecycle=new StudioLifecycle({options:{},recordPath:()=>dir},{jobs:[{id:'j',creationOwner:'o',source:'studio',gameId:'g',resourceId:'studio:a'}]},null,{state:{runs:[run],mods:[{id:'m',jobId:'j',gameId:'g',status:'enabled',profile:{mode:'copy'}}]}});
 await fs.writeFile(path.join(dir,'log'),'[ERROR] AnotherMod failed to load\n\n\n\n\nmarker\n');
 const result=await lifecycle.runtime({owner:'o',game,artifact});assert.equal(result.status,'awaiting_trigger');assert.equal(result.repairable,false);assert.equal(result.warnings.length,1);
});
test('repair build failure uses remaining bounded attempt and never deploys unbuilt output',async t=>{
 const x=await cycleFixture(t);let calls=0;
 x.studio.options.repair=async()=>{calls++;return draft(calls===1?'print("no verification")':good);};
 await x.run();assert.equal(x.item.status,'completed');assert.equal(calls,2);assert.equal(x.counts().installed,1);assert.equal(x.item.runtimeRecovery.attempts.length,2);
});
test('background observation rotates, preserves history, and stops on explicit cancellation',async t=>{
 const x=await cycleFixture(t,'awaiting_trigger');x.item.runtimeAuto=true;x.context.observationMs=20;await x.run();const messages=x.item.messages.length;
 await x.run();assert.equal(x.item.messages.length,messages);assert.equal(x.item.status,'awaiting_runtime');
});
test('real installer child exit reaches lifecycle crash observation',async t=>{
 const {Installers}=require(path.join(app,'installers.cjs'));
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'runtime-child-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const root=path.join(dir,'Game');await fs.mkdir(root);const game={id:'g',name:'Test game',installPath:root};
 const realRoot=await fs.realpath(root);game.installPath=realRoot;
 const installers=await new Installers(dir,{jobs:[]},{processes:async()=>[]}).open();
 const profile={mode:'copy',root:'',destination:'Mods',requires:[],executable:'node.exe'};
 installers.state.mods.push({id:'m',jobId:'j',gameId:'g',status:'enabled',root:realRoot,profile,files:[],units:[]});
 const run=await installers.startGame(game,{p:{...profile,arguments:['-e','setTimeout(()=>process.exit(23),30)']},file:process.execPath},realRoot);
 const child=installers.children.get(run.id);if(child)await new Promise(resolve=>child.once('exit',resolve));
 assert.equal(installers.state.runs[0].exitCode,23);
 const lifecycle=new StudioLifecycle({options:{},recordPath:()=>dir},{jobs:[{id:'j',creationOwner:'o',source:'studio',gameId:'g',resourceId:'studio:a'}]},null,installers);
 const artifact={id:'a',sha256:'s',runtime:{marker:'marker',loader:'UE4SS',verification:spec},deployment:{sha256:'s',runId:run.id,started:run.started,gameRoot:await fs.realpath(root),logRelative:null}};
 const observed=await lifecycle.runtime({owner:'o',game,artifact});assert.equal(observed.status,'crash_observed');assert.equal(observed.exited,true);
});
test('pending repair is applied before next launch through lifecycle recovery and respects selected Mods',async()=>{
 const pending={id:'new',lineage:{conversationId:'c'}},item={id:'c',artifactId:'old',status:'awaiting_exit',runtimeRecovery:{pendingArtifactId:'new'}};
 let installations=0;
 const studio={pending:new Map(),options:{},read:async()=>pending,conversations:{list:async()=>[{id:'c'}],read:async()=>item,persist:async()=>{}}};
 const lifecycle=new StudioLifecycle(studio,{jobs:[]},null,{});lifecycle.predecessors=()=>[{id:'oldmod',status:'enabled'}];lifecycle.install=async()=>{installations++;return {modId:'newmod'};};
 assert.equal((await lifecycle.prepareRecoveries('o',{},()=>true,async()=>{},[])).size,0);assert.equal(installations,0);
 const replaced=await lifecycle.prepareRecoveries('o',{},()=>true,async()=>{},['oldmod']);assert.equal(replaced.get('oldmod'),'newmod');assert.equal(item.artifactId,'new');assert.equal(item.runtimeRecovery.pendingArtifactId,null);
});
test('actual Downloads -> Library -> Installers replacement preserves payload hashes and disables previous revision',async t=>{
 const {studio,game,workspace,dir}=await fixture(t);
 const {Downloads}=require(path.join(app,'downloads.cjs')),{Installers}=require(path.join(app,'installers.cjs')),{ModLibrary}=require(path.join(app,'library.cjs'));
 const dll='Binaries/Win64/ue4ss/UE4SS.dll';await fs.mkdir(path.dirname(path.join(game.installPath,dll)),{recursive:true});await fs.writeFile(path.join(game.installPath,dll),'fixture-loader');
 workspace.diagnostic.loaderFiles.UE4SS=[dll];
 const downloads=await new Downloads(dir,{}).open(),installers=await new Installers(dir,downloads,{processes:async()=>[]}).open();
 const lifecycle=new StudioLifecycle(studio,downloads,new ModLibrary(downloads,installers,{}),installers),conversationId=crypto.randomUUID();
 const first=await studio.save('o',game,draft(good),()=>true,{conversationId});await studio.toolchain.run('o',game,first.id,workspace);
 const context={owner:'o',game,artifactId:first.id,current:()=>true,authorize:async()=>{}};
 const initial=await lifecycle.install(context);assert.equal(installers.state.mods.length,1);
 const next=await studio.save('o',game,draft(good+'\n-- repaired revision'),()=>true,{conversationId,parentId:first.id});await studio.toolchain.run('o',game,next.id,workspace);
 const repaired=await lifecycle.install({...context,artifactId:next.id});
 assert.equal(installers.state.mods.length,1);assert.notEqual(initial.modId,repaired.modId);
 const checked=await installers.action(game,repaired.modId,'verify');assert.equal(checked.verification.status,'files_ok');
 assert.equal(installers.state.mods.some(m=>m.id===initial.modId),false);
});
test('compiled adapters bind runtime to compiled bundle rather than source archive hash',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'runtime-compiled-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const run={id:'r',gameId:'g',started:new Date().toISOString(),managed:[{id:'m'}]},game={id:'g',installPath:dir};
 const lifecycle=new StudioLifecycle({options:{},recordPath:()=>dir},{jobs:[{id:'j',creationOwner:'o',source:'studio',gameId:'g',resourceId:'studio:a:b',studio:{artifactId:'a',buildId:'b'}}]},null,{state:{runs:[run],mods:[{id:'m',jobId:'j',gameId:'g',status:'enabled',profile:{mode:'copy'}}]}});
 const artifact={id:'a',adapterId:'bepinex-plugin',sha256:'source',toolchain:{id:'b',bundle:{sha256:'bundle'}},runtime:{loader:'BepInEx',marker:'marker'},deployment:{sha256:'bundle',buildId:'b',runId:'r',gameRoot:await fs.realpath(dir),logRelative:null}};
 assert.notEqual((await lifecycle.runtime({owner:'o',game,artifact})).status,'stale_run');
});
test('repair cannot remove the original failing acceptance condition to pass the build',async t=>{
 const {studio,game,workspace}=await fixture(t);const changed=await studio.save('o',game,draft(good.replaceAll("'effect'","'different'")));
 const report=await studio.toolchain.run('o',game,changed.id,workspace,{requiredRuntimeChecks:spec.expectations});
 assert.equal(report.status,'failed');assert.equal(report.bundle,undefined);assert.ok(report.runtimeContract.findings.some(f=>f.code==='RUNTIME_EXPECTATION_REMOVED'));
});
test('cancellation reserves repair budget before calling the remote repair endpoint',async t=>{
 const x=await cycleFixture(t);let calls=0;x.studio.options.repair=async()=>{calls++;if(calls===2)throw Error('cancelled request');return draft('print("bad")');};
 await assert.rejects(x.run(),/cancelled request/);assert.equal(x.item.runtimeRecovery.attempts.length,2);assert.equal(x.counts().installed,0);
});
test('guard preserves callback return values including nil for hook semantics',async()=>{
 const lua=await new LuaFactory().createEngine();
 try {lua.global.set('print',()=>{});await lua.doString(bootstrap('marker',`local f=ModdockVerification.guard('effect',function() return true,nil,5 end); local a,b,c=f(); assert(a==true and b==nil and c==5)`));}
 finally{lua.global.close();}
});
test('bounded large-log reader keeps fresh offsets and previously observed functional evidence',async t=>{
 const {readLog}=require(path.join(app,'studio-lifecycle.cjs'));
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'runtime-tail-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.writeFile(path.join(dir,'log'),'old'.repeat(3*1024*1024));
 const baseline=await readLog(dir,'log');assert.ok(baseline.offset>0);assert.ok(baseline.bytes.length<=8*1024*1024);
 const added=event(1,'begin','effect')+'\n'+event(2,'check_number','effect',42,42,0);await fs.appendFile(path.join(dir,'log'),added);
 const log=await readLog(dir,'log');const text=freshText(log,baseline,new Date(Date.now()-1000).toISOString());assert.equal(text,added);
 const result=evaluate({text,marker:'marker',contract:spec});assert.equal(result.status,'behavior_verified');
 const later=evaluate({text:'later game logs without old probe',marker:'marker',contract:spec,previous:result});assert.equal(later.status,'behavior_verified');
});
test('packaged server boots with complete dependency graph and serves its real login assets',async t=>{
 const {createServer}=require(path.join(app,'server.cjs'));
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'runtime-http-'));let service;
 t.after(async()=>{if(service){await new Promise(r=>service.server.close(r));await service.bundles.close();}await fs.rm(dir,{recursive:true,force:true});});
 service=await createServer({root:dir,port:0,scan:async()=>({games:[],roots:[],locations:[],diagnostics:[]})});
 const page=await fetch(service.url),html=await page.text();assert.equal(page.status,200);assert.match(html,/auth\.js/);
 for(const asset of ['/auth.js','/download-bundles.js','/download-bundles.css']){const response=await fetch(service.url+asset);assert.equal(response.status,200,asset);}
});
test('first real launch accepts the persisted null runtime baseline',()=>{
 assert.equal(evaluate({text:'marker',marker:'marker',contract:spec,previous:null}).status,'awaiting_trigger');
});
test('Windows platform launch monitor holds a real process handle and receives abnormal exit status',async()=>{
 if(process.platform!=='win32')return;
 const {spawn}=require('node:child_process');
 const {observePlatformProcess,stopPlatformMonitors}=require(path.join(app,'studio-game-process.cjs'));
 const child=spawn(process.execPath,['-e','setTimeout(()=>process.exit(27),4000)'],{windowsHide:true,stdio:'ignore'});
 const run={id:'platform-run',launchMethod:'platform'};
 const installers={options:{processes:async()=>[{pid:child.pid,path:process.execPath,name:'Game.exe'}]}};
 try {
  await observePlatformProcess(installers,{installPath:path.dirname(process.execPath)},run);
  const monitor=installers.platformMonitors.get(run.id);assert.ok(monitor);assert.equal(run.gamePid,child.pid);
  await new Promise(resolve=>monitor.child.once('close',resolve));
  assert.equal(run.exitCode,27,run.processObservationError);assert.ok(run.exited);
 } finally {stopPlatformMonitors(installers);if(child.exitCode===null)child.kill();}
});
test('real UE4SS concatenated log records preserve begin and check without newline separators',()=>{
 const text=event(1,'begin','effect')+'[2026-10-19 11:00:00] [Lua] Requested FOV'+event(2,'check_number','effect',42,42,0)+'[2026-10-19] Other output';
 assert.equal(evaluate({text,marker:'marker',contract:spec,previous:null}).status,'behavior_verified');
});

test('deployed inactive conversation observes recovery started by a normal library launch',async()=>{
 const vm=require('node:vm');
 const source=(await fs.readFile(path.join(app,'public/mod-studio.js'),'utf8')).replace(/^import .*;\r?\n/gm,'').replace('export function createModStudio','function createModStudio');
 const timers=new Map();let timerId=0,reading=0;
 const game={id:'game'},initial={id:'thread',created:new Date().toISOString(),updated:'before',status:'failed',messages:[]};
 const context={console,window:{},document:{querySelector:()=>({dataset:{gameId:'game'}})},queueMicrotask,
  setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
 vm.createContext(context);vm.runInContext(source+'\nthis.createModStudio=createModStudio',context);
 const ui=context.createModStudio({api:async route=>{
  if(route==='studio/conversations/list')return {items:[initial]};
  if(route==='studio/list')return {items:[]};
  if(route==='studio/environment')return {ready:true};
  if(route==='studio/conversations/read')return ++reading===1?initial:{...initial,status:'observing',updated:'after'};
  if(route==='studio/read')return {id:'artifact',deployment:{runId:'run'}};
  throw new Error(route);
 },render:()=>{},getGame:()=>game,getStatus:()=>({allowed:true})});
 initial.artifactId='artifact';
 await ui.enter();assert.equal([...timers.values()].at(-1).ms,5000);
 await [...timers.values()].at(-1).fn();
 assert.equal(reading,2);assert.equal([...timers.values()].at(-1).ms,1200);ui.reset();
});

test('shipped UI reproducibly includes the tested studio feedback and inactive-project polling factory',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'moddock-ui-rebuild-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 await require(path.join(app,'scripts/build-ui.cjs')).buildUi(directory);
 for(const name of ['auth.js','auth.css']) {
  assert.deepEqual(await fs.readFile(path.join(app,'public',name)),await fs.readFile(path.join(directory,name)),name+' must be built from current sources');
 }
});

test('resume after runtime service failure preserves evidence and does not restart generation',async()=>{
 const {StudioConversations}=require(path.join(app,'studio-conversations.cjs'));
 const studio={ready:Promise.resolve(),pending:new Map(),options:{}};
 const conversations=new StudioConversations(studio),recovery={artifactId:'artifact',attempts:[{reason:'crash_observed'}]};
 const saved={id:'thread',gameId:'game',artifactId:'artifact',status:'failed',command:'install-launch',runtimeRecovery:recovery,messages:[]};
 conversations.read=async()=>saved;conversations.persist=async()=>{};
 let resumed;
 conversations.run=async(_owner,_game,item)=>{resumed=item.command;};
 await conversations.send('owner',{id:'game'},{id:'thread',resume:true},()=>true,async()=>{});
 assert.equal(resumed,'runtime');assert.equal(saved.runtimeRecovery,recovery);assert.equal(saved.artifactId,'artifact');
 saved.command='build';saved.runtimeRecovery=null;
 await conversations.send('owner',{id:'game'},{id:'thread',resume:true},()=>true,async()=>{});
 assert.equal(resumed,'build');
});
