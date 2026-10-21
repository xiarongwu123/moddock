const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {promisify}=require('node:util'),execFile=promisify(require('node:child_process').execFile);
const {Installers,relative,hash,extract}=require('../installers.cjs');
const {binary,archiveFormat,parseListing}=require('../archive-format.cjs');
const {InstallationProgress}=require('../installation-progress.cjs');
const {zip}=require('./zip-fixture.cjs'),fomod=require('../fomod.cjs');
const option=(name,source,type='Optional',extra='')=>`<plugin name="${name}"><description>Choose ${name}</description><files><file source="${source}" destination="textures/skin.dds"/></files>${extra}<typeDescriptor><type name="${type}"/></typeDescriptor></plugin>`;
const config=(type='SelectExactlyOne',extra='')=>`<config><moduleName>Skin options</moduleName><requiredInstallFiles><file source="base.bin" destination="base.bin"/></requiredInstallFiles><installSteps order="Explicit"><installStep name="Appearance"><optionalFileGroups order="Explicit"><group name="Skin" type="${type}"><plugins order="Explicit">${option('Blue','blue.dds','Recommended','<conditionFlags><flag name="color">blue</flag></conditionFlags>')}${option('Red','red.dds')}</plugins></group></optionalFileGroups></installStep></installSteps>${extra}</config>`;
test('五种选择规则、推荐项、必选项和伪造选项由后端验证',()=>{
 for(const type of ['SelectExactlyOne','SelectAtMostOne','SelectAtLeastOne','SelectAny','SelectAll']){
  const m=fomod.parse(config(type),'fomod/ModuleConfig.xml',relative),r=fomod.evaluate(m);
  assert.equal(r.steps[0].groups[0].options[0].selected,true);
  if(['SelectExactlyOne','SelectAtLeastOne'].includes(type))assert.throws(()=>fomod.evaluate(m,{s0g0:[]},{},true),/请按要求选择/);
  if(['SelectExactlyOne','SelectAtMostOne'].includes(type))assert.throws(()=>fomod.evaluate(m,{s0g0:['s0g0p0','s0g0p1']},{},true),/请按要求选择/);
  assert.throws(()=>fomod.evaluate(m,{s0g0:['forged']}),/未知/);
 }
});
test('条件标记、隐藏步骤和条件文件按用户选择重算',()=>{
 const conditional='<conditionalFileInstalls><patterns><pattern><dependencies><flagDependency flag="color" value="blue"/></dependencies><files><file source="extra.bin" destination="extra.bin"/></files></pattern></patterns></conditionalFileInstalls>';
 const m=fomod.parse(config('SelectExactlyOne',conditional),'Wrapper/fomod/ModuleConfig.xml',relative),files=['base.bin','blue.dds','red.dds','extra.bin'].map(n=>({path:'Wrapper/'+n}));
 assert.equal(fomod.mappings(m,fomod.evaluate(m,{}, {},true),files).length,3);
 assert.equal(fomod.mappings(m,fomod.evaluate(m,{s0g0:['s0g0p1']},{},true),files).length,2);
});
test('XML 实体、未知依赖、路径穿越、脚本及目标歧义均阻止方案',()=>{
 for(const xml of ['<!DOCTYPE config [<!ENTITY x SYSTEM "file:///C:/secret">]><config/>','<config><moduleDependencies><gameDependency version="1"/></moduleDependencies></config>',config().replace('blue.dds','../blue.dds'),'<config><bad/></config>'])assert.throws(()=>fomod.parse(xml,'fomod/ModuleConfig.xml',relative),/FOMOD|不安全/);
 const m=fomod.parse(config('SelectAny'),'fomod/ModuleConfig.xml',relative),files=['base.bin','blue.dds','red.dds'].map(path=>({path}));
 assert.throws(()=>fomod.mappings(m,fomod.evaluate(m,{s0g0:['s0g0p0','s0g0p1']},{},true),files),/相同优先级/);
 assert.throws(()=>fomod.mappings(m,fomod.evaluate(m),[]),/不存在/);
});
test('依赖插件存在时不会伪称已启用',()=>{
 const m=fomod.parse(config().replace('<moduleName>','<moduleDependencies><fileDependency file="Test.esp" state="Active"/></moduleDependencies><moduleName>'),'fomod/ModuleConfig.xml',relative);
 assert.throws(()=>fomod.evaluate(m,{}, {'test.esp':'Unknown'}),/启用状态/);
 assert.throws(()=>fomod.evaluate(m,{}, {'test.esp':'Missing'}),/前置/);
});
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fomod-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const game={id:'steam:489830',appId:'489830',name:'Skyrim SE',installPath:path.join(root,'game')};await fs.mkdir(path.join(game.installPath,'Data/textures'),{recursive:true});await fs.writeFile(path.join(game.installPath,'SkyrimSE.exe'),'MZfixture');await fs.writeFile(path.join(game.installPath,'Data/textures/skin.dds'),'original');
 const file=path.join(root,'mod.zip');await fs.writeFile(file,zip([{name:'Wrapper/fomod/ModuleConfig.xml',data:config()},{name:'Wrapper/base.bin',data:'base'},{name:'Wrapper/blue.dds',data:'blue'},{name:'Wrapper/red.dds',data:'red'}]));
 const job={id:crypto.randomUUID(),gameId:game.id,status:'completed',name:'FOMOD fixture',sha256:await hash(file)};
 const downloads={jobs:[job],completedFile:async()=>({file,name:'mod.zip'})},engine=await new Installers(root,downloads,{processes:async()=>[]}).open();return {root,game,file,job,engine};
}
test('FOMOD 完整流程：选择前不写入、预览仅选中文件、部署备份、停用还原、重启卸载',async t=>{
 const x=await fixture(t),first=await x.engine.installAuto(x.game,x.job.id);
 assert.equal(first.kind,'fomod');assert.equal(x.engine.state.mods.length,0);assert.equal(await fs.readFile(path.join(x.game.installPath,'Data/textures/skin.dds'),'utf8'),'original');
 const result=await x.engine.installAuto(x.game,x.job.id,{fomodSelection:{s0g0:['s0g0p1']},fomodFinalize:true});assert.equal(result.kind,'fomod-plan');assert.equal(result.plan.files.length,2);assert(result.plan.files.some(f=>f.source==='Wrapper/red.dds'&&f.destination==='Data/textures/skin.dds'));assert(!result.plan.files.some(f=>f.source.includes('fomod')||f.source.endsWith('blue.dds')));
 const mod=await x.engine.apply(x.game,result.plan.id,true);assert.equal(await fs.readFile(path.join(x.game.installPath,'Data/textures/skin.dds'),'utf8'),'red');await x.engine.action(x.game,mod.id,'disable');assert.equal(await fs.readFile(path.join(x.game.installPath,'Data/textures/skin.dds'),'utf8'),'original');await x.engine.action(x.game,mod.id,'enable');const reopened=await new Installers(x.root,x.engine.downloads,{processes:async()=>[]}).open();await reopened.action(x.game,mod.id,'uninstall');assert.equal(await fs.readFile(path.join(x.game.installPath,'Data/textures/skin.dds'),'utf8'),'original');
});
test('等待选项不是安装成功',async()=>{const p=new InstallationProgress();await p.run({id:'job'},'owner',undefined,async()=>({kind:'fomod'}));assert.equal(p.view('owner').status,'waiting_selection');});
test('非 Bethesda 的 FOMOD 保留加载器前置，不会仅凭 XML 把 DLL 写入游戏',async t=>{
 const x=await fixture(t);x.game.appId='12345';await fs.writeFile(x.file,zip([{name:'fomod/ModuleConfig.xml',data:'<config><moduleName>Plugin</moduleName><requiredInstallFiles><file source="My.dll" destination="BepInEx/plugins/My.dll"/></requiredInstallFiles></config>'},{name:'My.dll',data:'MZfixture'}]));x.job.sha256=await hash(x.file);
 await assert.rejects(x.engine.installAuto(x.game,x.job.id,{fomodFinalize:true}),/缺少前置文件.*BepInEx/);
 await fs.mkdir(path.join(x.game.installPath,'BepInEx/core'),{recursive:true});await fs.writeFile(path.join(x.game.installPath,'BepInEx/core/BepInEx.dll'),'loader');const r=await x.engine.installAuto(x.game,x.job.id,{fomodFinalize:true});assert.equal(r.plan.files[0].destination,'BepInEx/plugins/My.dll');assert.deepEqual(r.plan.profile.requires,['BepInEx/core/BepInEx.dll']);
});
test('组合安装遇到 FOMOD 不会伪报已安装或继续后续文件',async t=>{
 const {DownloadBundles}=require('../download-bundles.cjs'),root=await fs.mkdtemp(path.join(os.tmpdir(),'fomod-bundle-'));let calls=0;
 const store=await new DownloadBundles(root,{jobs:[{id:'j1',status:'completed'},{id:'j2',status:'completed'}]},{interval:0,current:()=>true,installBusy:()=>false,installed:()=>null,authorize:async()=>{},install:async()=>{calls++;return {kind:'fomod'};}}).open();t.after(async()=>{await store.close();await fs.rm(root,{recursive:true,force:true});});
 store.items.push({id:'b',owner:'a',status:'waiting_install',installAfter:true,files:[{jobId:'j1',name:'FOMOD'},{jobId:'j2',name:'Next'}]});store.runtime.set('b',{sessionId:'s'});await store.tick();assert.equal(calls,1);assert.equal(store.items[0].status,'install_failed');assert(!store.items[0].files[0].installed);assert.match(store.items[0].error,/FOMOD/);
});
test('内置 7z 真正解包、文件头识别和压缩清单安全边界',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'archive-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'test.txt'),'sevenzip');await execFile(binary(),['a','-t7z',path.join(root,'renamed.zip'),'test.txt'],{cwd:root,windowsHide:true});assert.equal(await archiveFormat(path.join(root,'renamed.zip')),'7z');const files=await extract(path.join(root,'renamed.zip'),path.join(root,'out'));assert.equal(files[0].size,8);
 const row=(p,size='1',extra='')=>`Path = ${p}\nSize = ${size}\nPacked Size = 1\nAttributes = A\n${extra}`;
 assert.throws(()=>parseListing(row('../escape'),1,relative),/不安全/);assert.throws(()=>parseListing(row('x','999999999999'),1,relative),/超限/);assert.throws(()=>parseListing(row('x','1','Symbolic Link = target'),1,relative),/链接/);assert.throws(()=>parseListing(row('x')+'\n\n'+row('X'),2,relative),/重名/);assert.throws(()=>parseListing(row('x','10000000'),1,relative),/膨胀/);
});
function uudecode(value){const rows=[];for(const line of value.split(/\r?\n/).slice(1)){if(line==='end')break;const n=(line.charCodeAt(0)-32)&63,bytes=[];for(let i=1;i<line.length;i+=4){const a=[0,1,2,3].map(j=>(line.charCodeAt(i+j)-32)&63);bytes.push((a[0]<<2)|(a[1]>>4),((a[1]&15)<<4)|(a[2]>>2),((a[2]&3)<<6)|a[3]);}rows.push(Buffer.from(bytes.slice(0,n)));}return Buffer.concat(rows);}
test('真实 RAR4 / RAR5 / RAR5 压缩样本通过内置解码器，链接条目仍被拒绝',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rar-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const sample of ['rar5','rar5-compressed','rar4','rar4-binary']){
  const file=path.join(root,sample+'.zip');await fs.writeFile(file,uudecode(await fs.readFile(path.join(__dirname,'fixtures/rar',sample+'.uu'),'utf8')));assert.equal(await archiveFormat(file),'rar');
  if(sample==='rar4')await assert.rejects(extract(file,path.join(root,sample)),/链接|特殊文件/);
  else{const files=await extract(file,path.join(root,sample));assert(files.length>0);assert(files.every(f=>/^[a-f0-9]{64}$/.test(f.sha256)));if(sample==='rar5')assert.equal(await fs.readFile(path.join(root,sample,'helloworld.txt'),'utf8'),'hello libarchive test suite!\n');}
 }
});
