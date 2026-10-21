const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const mods = require('../studio-game-mods.cjs');
const { ModStudio } = require('../mod-studio.cjs');
const { createAuthoringWorkspace } = require('../studio-authoring.cjs');
const { recipesFor } = require('../studio-recipes.cjs');
const { profile } = require('../installers.cjs');
const { createServer, loginFixture } = require('./server-fixture.cjs');
const { accountFixture } = require('./account-fixture.cjs');
const { piFixture } = require('./pi-fixture.cjs');
const { createDeepSeek } = require('../studio-ai.cjs');
const functionCode = `ModdockVerification.expect('effect','isolated game-state fixture')
local callback=ModdockVerification.guard('effect',function()
 ModdockVerification.begin('effect')
 local actual=readNativeFixtureState()
 ModdockVerification.check('effect',actual,42)
end)
`;
const callbacks = { 'factorio-lua': 'script.on_init(callback)', 'dst-lua': 'AddPlayerPostInit(callback)', 'noita-lua': 'OnPlayerSpawned=callback', 'gmod-lua': 'hook.Add("InitPostEntity","__MODDOCK_ID__",callback)', 'zomboid-lua': 'Events.OnGameStart.Add(callback)', 'beamng-lua': 'local M={}\nM.onExtensionLoaded=callback\nreturn M' };
function draft(kind) {
 if (mods.SPECS[kind]?.bethesda) return require('./bethesda-fixture.cjs').draft(kind);
 if (mods.SPECS[kind]?.strategy || kind === 'civ6-data') return require('./strategy-fixture.cjs').draft(kind);
 const meta = { kind, name: 'Native fixture', author: 'Fixture', description: 'Structural adapter test, no game executed.' };
 if (mods.LUA_KINDS.includes(kind)) return { ...meta, code: functionCode + callbacks[kind], ...(kind === 'factorio-lua' ? { targetVersion: '2.0' } : kind === 'zomboid-lua' ? { targetVersion: '42' } : kind === 'dst-lua' ? { scope: 'client' } : {}) };
 if (kind.startsWith('minecraft-')) return { ...meta, targetVersion: '1.21.4', files: kind === 'minecraft-datapack' ? [{ name: 'data/__MODDOCK_ID__/function/load.mcfunction', text: 'say fixture' }] : [{ name: 'assets/minecraft/lang/zh_cn.json', text: '{"item.minecraft.apple":"测试苹果"}' }] };
 return kind === 'ck3-data' ? { ...meta, targetVersion: '1.14.2', files: [{ name: 'common/decisions/main.txt', text: '__MODDOCK_ID___decision = { is_shown = { always = yes } effect = { add_gold = 50 } }' }, { name: 'localization/english/main_l_english.yml', text: 'l_english:\n __MODDOCK_ID___decision:0 "Fixture decision"' }] } : { ...meta, targetVersion: '1.9.0.0', files: [{ name: 'Items/main.xml', text: '<Items><Item identifier="__MODDOCK_ID__" name="Fixture" /></Items>' }] };
}
async function write(root, name, data) { const file=path.join(root,name); await fs.mkdir(path.dirname(file),{recursive:true}); await fs.writeFile(file,data); }
async function fixture(t, kind) {
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'moddock-native-game-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:3}));
 const game={id:'steam-'+mods.SPECS[kind].ids[0],appId:mods.SPECS[kind].ids[0],name:mods.SPECS[kind].game,platform:'Steam',real:true,installPath:path.join(root,'game')};
 await write(game.installPath,mods.SPECS[kind].executables[0],require('./bg3-extender-fixture.cjs').executable);
 const user=path.join(root,'user'); await fs.mkdir(user);
 await write(user,'Saves/preserve.sav','personal-save'); await write(game.installPath,'unrelated.txt','untouched');
 return {root,game,user,options:{processes:async()=>[],gameModRoots:{[kind]:user}}};
}
for (const kind of Object.keys(mods.SPECS).filter(kind => !mods.SPECS[kind].minecraft && !mods.SPECS[kind].bethesda)) {
 test(kind+' creates actual game files, builds, installs, toggles and uninstalls without touching saves',async t=>{
  const x=await fixture(t,kind), account=accountFixture(); account.updateAccount({membership:{tier:'pro',expiresAt:null}});
  const service=await createServer({root:path.join(x.root,'service'),port:0,accounts:account.options,scan:async()=>({games:[x.game],roots:[],diagnostics:[]}),installers:x.options,studio:{integration:{python:false}}});
  t.after(async()=>{await new Promise(r=>service.server.close(r));await service.studio.conversations.settle();await service.downloads.persist;});
  const login=await loginFixture(service);
  const post=async(route,body)=>{const r=await login.fetch(service.url+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Moddock-Token':login.state.token},body:JSON.stringify({gameId:x.game.id,...body})});return {status:r.status,body:await r.json()};};
  const saved=await post('studio/save',{draft:draft(kind)}); assert.equal(saved.status,200,JSON.stringify(saved.body)); assert.equal(saved.body.installable,false);
  const workspace=await service.studio.workspace(x.game); assert.ok(workspace.types.find(type=>type.id===kind).available); assert.equal(workspace.context.engineEvidence.gameModKind,kind);
  const report=await service.studio.toolchain.run('fixture-user',x.game,saved.body.id,workspace); assert.equal(report.status,'passed',JSON.stringify(report)); assert.ok(report.bundle);
  const item=await service.studio.read('fixture-user',saved.body.id); assert.equal(item.installable,true);
  const deployment=await service.studio.deploymentArchive('fixture-user',x.game,item.id); assert.equal(deployment.item.compiled,true); assert.equal(deployment.item.buildId,report.id); assert.equal(deployment.item.sha256,report.bundle.sha256);
  const preview=await service.studio.preview('fixture-user',x.game,item.id); assert.ok(preview.files.some(file=>file.name.startsWith('mod/')));
  const bundle=await service.studio.toolchain.bundle('fixture-user',x.game,item.id,report.id),archive=path.join(x.root,'native-export.zip'),expanded=path.join(x.root,'native-export');
  await fs.writeFile(archive,Buffer.from(bundle.base64,'base64'));
  const entries=await require('../installers.cjs').extract(archive,expanded); assert.ok(entries.length); assert.ok(entries.every(file=>!file.source.startsWith('mod/')));
  if(kind==='factorio-lua')assert.ok(entries.some(file=>file.source===item.manifest.UniqueID+'_1.0.0/info.json'));
  if(kind==='beamng-lua')assert.ok(entries.some(file=>file.source===`lua/ge/extensions/moddock/${item.manifest.UniqueID.slice(8)}.lua`));
  if(kind==='factorio-lua')assert.equal(JSON.parse(preview.files.find(file=>file.name==='mod/info.json').text).factorio_version,'2.0');
  if(kind==='zomboid-lua')assert.ok(preview.files.some(file=>file.name==='mod/42/mod.info'));
  if(kind==='beamng-lua')assert.ok(preview.files.some(file=>file.name.endsWith('/modScript.lua')));
  if(kind==='ck3-data'||mods.SPECS[kind].strategy){assert.ok(preview.files.find(file=>file.name.endsWith('.yml')).text.startsWith('\uFEFF'));assert.ok(preview.files.some(file=>file.name==='mod/'+item.manifest.UniqueID+'.mod'));}
  const prepared=await post('studio/prepare',{id:item.id}); assert.equal(prepared.status,200,JSON.stringify(prepared.body));
  assert.ok(prepared.body.files.every(file=>mods.allowedDestination({modKind:kind,modId:item.manifest.UniqueID},file.destination)));
  const applied=await post('installations/apply',{id:prepared.body.id}); assert.equal(applied.status,200,JSON.stringify(applied.body));
  const installed=service.installers.state.mods.find(mod=>mod.id===applied.body.id); assert.equal(installed.root,mods.SPECS[kind].location?x.user:x.game.installPath);
  for(const action of ['verify','disable','enable','uninstall']) {const r=await post('installations/action',{id:installed.id,action}); assert.equal(r.status,200,JSON.stringify(r.body));}
  assert.equal(await fs.readFile(path.join(x.user,'Saves/preserve.sav'),'utf8'),'personal-save'); assert.equal(await fs.readFile(path.join(x.game.installPath,'unrelated.txt'),'utf8'),'untouched');
  const denied=recipesFor(x.game,{...workspace.diagnostic,antiCheat:['FixtureProtection']}).find(type=>type.id===kind);assert.equal(denied.available,false);
 });
}
test('game-specific parsers reject incompatible Lua, malformed text, XML entities, unsafe paths and missing versions',()=>{
 assert.equal(mods.checkLua('factorio-lua','local n=1 // 2').passed,false);
 assert.equal(mods.checkLua('noita-lua','goto finish\n::finish::').passed,false);
 assert.equal(mods.checkLua('gmod-lua','if !true then continue end').passed,false);
 assert.throws(()=>mods.checkClausewitz('decision = {'),/未闭合/);
 assert.throws(()=>mods.checkClausewitz('decision = "unterminated'),/字符串/);
 assert.throws(()=>mods.checkClausewitz('decision = = 5'),/缺少/);
 assert.throws(()=>mods.checkXML('<!DOCTYPE x [<!ENTITY foo SYSTEM "file:///secret">]><Items/>'),/DTD/);
 assert.throws(()=>mods.dataSources('barotrauma-content',[{name:'Items/a.xml',text:'<Items><Item></Items>'}]),/./);
 assert.throws(()=>mods.dataSources('barotrauma-content',[{name:'../escape.xml',text:'<Items/>'}]),/路径/);
 for(const kind of ['factorio-lua','zomboid-lua','ck3-data','barotrauma-content'])assert.throws(()=>mods.build({...draft(kind),targetVersion:undefined},'00000000-0000-4000-8000-000000000000'));
 for(const values of [{modKind:'unknown',modId:'moddock_'+'a'.repeat(32)},{modKind:'ck3-data',modId:'../../saves'},{modKind:'factorio-lua',modId:'moddock_'+'a'.repeat(32),root:'../'}])assert.throws(()=>profile({mode:'game-mod',...values}));
 assert.equal(mods.targetCompatibility({adapterId:'factorio-lua',draft:{targetVersion:'2.0'}},{context:{engineEvidence:{documents:[{path:'data/base/info.json',text:'{"version":"2.1.23"}'}]}}}).status,'blocked');
});
test('isolated data authoring validates the actual files and rejects submission after an unvalidated edit',async t=>{
 const workspace=await createAuthoringWorkspace({kind:'ck3-data'});t.after(()=>workspace.close());
 await workspace.write('events/main.txt','event = {');assert.equal((await workspace.validate()).passed,false);
 for(const file of draft('ck3-data').files)await workspace.write(file.name,file.text);
 await workspace.write('events/main.txt','namespace = __MODDOCK_ID__');assert.equal((await workspace.validate()).passed,true);
 assert.equal((await workspace.artifact({kind:'ck3-data'})).files.length,3);
 await workspace.write('events/main.txt','namespace = changed');await assert.rejects(workspace.artifact({kind:'ck3-data'}),/重新校验/);
});
test('module bootstrap preserves BeamNG extension returns and guard return values with nils',async()=>{
 const engine=await new(require('wasmoon').LuaFactory)().createEngine();
 try {
  await engine.doString('log=function()end');
  const built=mods.build({...draft('beamng-lua'),code:'local M={}\nM.value=42\nreturn M'},'00000000-0000-4000-8000-000000000000');
  const entry=built.files.find(file=>file.name.includes('/lua/ge/extensions/'));
  engine.global.set('source',entry.data.toString());
  assert.equal(await engine.doString('local f=assert(load(source)); local M=f();return M.value'),42);
 } finally {engine.global.close();}
});
test('user-root installation rejects wrong game identity, symlinks, changed game roots and running native games',async t=>{
 const x=await fixture(t,'zomboid-lua'),p=profile({mode:'game-mod',modKind:'zomboid-lua',modId:'moddock_'+'a'.repeat(32)});
 assert.equal(await mods.installRoot(x.game,p,x.options),x.user);
 await assert.rejects(mods.installRoot({...x.game,appId:'999'},p,x.options),/身份/);
 await assert.rejects(mods.installRoot(x.game,{...p,modGameRoot:path.join(x.root,'old')},x.options),/变化/);
 const {Installers}=require('../installers.cjs'),installer=new Installers(x.root,{},{processes:async()=>[{pid:999,path:path.join(x.game.installPath,'ProjectZomboid64.exe')} ]});
 await assert.rejects(installer.guard(x.user,p),/退出游戏/);
 const link=path.join(x.root,'user-link');await fs.symlink(x.user,link,'junction');
 await assert.rejects(mods.installRoot(x.game,p,{gameModRoots:{'zomboid-lua':link}}),/链接/);
});
for(const kind of ['factorio-lua','ck3-data','barotrauma-content','minecraft-datapack','minecraft-resourcepack','hoi4-data','civ6-data','skyrimse-esp'])test(kind+' Pi writes and validates actual source before artifact submission',async t=>{
 const value=draft(kind),fixture=await piFixture(t,{game:{name:mods.SPECS[kind].game,appId:mods.SPECS[kind].ids[0]},result:value,respond:async({phase})=>phase==='author'&&value.files?{calls:[...value.files.map(file=>({name:'write_project_file',arguments:{path:file.name,text:file.text}})),{name:'validate_project',arguments:{}}]}:phase==='submit'?{result:{...value,code:undefined,files:undefined}}:null});
 const result=await createDeepSeek({apiKey:fixture.key,pi:fixture.pi}).generate({kind,prompt:'Implement fixture gameplay',context:{game:fixture.game},capability:{deliverable:'mod'}});
 assert.equal(result.kind,kind);if(value.files)assert.deepEqual(result.files,value.files);else assert.equal(result.code,value.code);
});
test('private service validates all native types and the expanded client recipe catalog',async t=>{
 const {createStudioService}=require('./ai-ledger-fixture.cjs'), token='d'.repeat(64), received=[];
 const ai=Object.fromEntries(['plan','generate','repair'].map(action=>[action,async payload=>{received.push([action,payload.kind]);return action==='plan'?{title:'Native',summary:'Actual Mod',kind:'noita-lua',steps:['Implement'],requirements:[]}:draft(payload.kind);} ]));
 const service=await createStudioService({accessToken:token,ai});t.after(()=>service.close());
 const request=(action,payload)=>fetch(service.url+'/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'X-Mu-Account-Id':'fixture-user'},body:JSON.stringify({prompt:'Create a native game Mod',...payload})});
 const types=recipesFor({appId:'881100'},{engine:{key:'unknown'},loaders:[],antiCheat:[]});
 assert.equal((await request('plan',{types})).status,200);
 for(const kind of Object.keys(mods.SPECS))for(const action of ['generate','repair'])assert.equal((await request(action,{kind})).status,200,action+' '+kind);
 assert.equal(received.length,1 + Object.keys(mods.SPECS).length * 2);
});
test('native library save stays bound to the accepted build and rejects the previous build after recompilation',async t=>{
 const x=await fixture(t,'noita-lua'), studio=new ModStudio(x.root,{integration:{python:false}});
 const item=await studio.save('owner',x.game,draft('noita-lua')), workspace=await studio.workspace(x.game);
 const first=await studio.toolchain.run('owner',x.game,item.id,workspace);
 const feedback=require('../studio-user-feedback.cjs');
 await feedback.recordFeedback(studio,'owner',x.game,{artifactId:item.id,buildId:first.id,status:'accepted'},()=>true);
 assert.equal(feedback.confirmed(await studio.read('owner',item.id)),true);
 const previous=(await studio.deploymentArchive('owner',x.game,item.id)).item;
 const second=await studio.toolchain.run('owner',x.game,item.id,workspace); assert.notEqual(first.id,second.id);assert.equal(second.status,'passed');
 assert.equal(feedback.confirmed(await studio.read('owner',item.id)),false);
 await assert.rejects(studio.ruleFor(x.game,{...previous,artifactId:item.id},null,'owner'),/更新构建/);
 await assert.rejects(feedback.recordFeedback(studio,'owner',x.game,{artifactId:item.id,buildId:first.id,status:'accepted'},()=>true),/版本已变化/);
});
