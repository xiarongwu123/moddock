// Isolated QA fixture only: writes real files in a temporary game directory.
const {chromium}=require('@playwright/test');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {createServer}=require('./server-fixture.cjs'),{hash}=require('../installers.cjs'),{zip}=require('./zip-fixture.cjs');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moddock-ui-install-'));const g={id:'steam-987654',appId:'987654',name:'安装流程测试（临时目录）',platform:'Steam',installPath:path.join(root,'game'),real:true};await fs.mkdir(path.join(g.installPath,'Content'),{recursive:true});await fs.writeFile(path.join(g.installPath,'Content/config.ini'),'original');
 const service=await createServer({root:path.join(root,'data'),port:0,scan:async()=>({games:[g],roots:[],diagnostics:[]}),installers:{processes:async()=>[]},sources:{fetch:async()=>Response.json({_aMetadata:{_nRecordCount:0},_aRecords:[]})}});let browser;
 try{
 const id='10000000-0000-4000-8000-000000000001',dir=path.join(service.downloads.root,id);await fs.mkdir(dir);const file=path.join(dir,'fixture.zip');await fs.writeFile(file,zip([{name:'Release/config.ini',data:'modded'},{name:'Release/assets/new.txt',data:'new asset'},{name:'README.md'}]));const bytes=(await fs.stat(file)).size;service.downloads.jobs.push({id,gameId:g.id,gameName:g.name,resourceId:'banana:1',source:'banana',fileId:'1',name:'目录映射测试包',status:'completed',filename:'fixture.zip',path:file,sha256:await hash(file),bytes,total:bytes,message:'测试下载已完成'});await service.downloads.save();
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await openHome(page,service.url);await page.locator('[data-nav="tasks"]').first().click();await page.locator('[data-install-job]').click();await page.locator('.plan-files code').filter({hasText:'Release/config.ini'}).waitFor();await page.locator('#rule-prefix').fill('Release');await page.locator('#rule-destination').fill('Content');await page.locator('[data-save-rule]').click();await page.locator('[data-apply-plan]').waitFor();assert.ok((await page.locator('.modal-body').innerText()).includes('备份后替换'));await page.locator('#plan-author').check();await page.locator('#plan-overwrite').check();await page.screenshot({path:path.resolve(__dirname,'../../moddock-install-plan.png'),fullPage:true});await page.locator('[data-apply-plan]').click();await page.locator('.managed-row').waitFor();assert.equal(await fs.readFile(path.join(g.installPath,'Content/config.ini'),'utf8'),'modded');assert.equal(await fs.readFile(path.join(g.installPath,'Content/assets/new.txt'),'utf8'),'new asset');await page.locator('[data-mod-action="verify"]').click();await page.locator('.managed-row').filter({hasText:'托管文件校验通过'}).waitFor();await page.screenshot({path:path.resolve(__dirname,'../../moddock-installations.png'),fullPage:true});
 // Hold requests open to verify loading survives polls and navigation, and clears on failure.
 for(const [action,fail] of [['disable',true],['disable',false],['enable',false]]){
  let release,requests=0;const gate=new Promise(resolve=>{release=resolve;});
  const handler=async route=>{requests++;await gate;if(fail)await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'测试操作失败'})});else await route.continue();};
  await page.route('**/api/installations/action',handler);
  const button=()=>page.locator(`[data-mod-action="${action}"]`);
  const assertLoading=async()=>{assert.equal(await button().isDisabled(),true);assert.equal(await button().getAttribute('aria-busy'),'true');assert.match(await button().innerText(),action==='enable'?/正在启用/:/正在停用/);assert.equal(await button().locator('.spinning').count(),1);assert.equal(await page.locator('.managed-row .row-actions button:enabled').count(),0);};
  try{
   await button().click();await assertLoading();
   await page.waitForResponse(response=>response.url().endsWith('/api/state'));
   await assertLoading();
   await page.locator('[data-nav="tasks"]').first().click();await page.locator('[data-nav="installed"]').first().click();await assertLoading();
   await button().evaluate(element=>element.click());assert.equal(requests,1);
  }finally{release();}
  const next=fail?action:action==='enable'?'disable':'enable';
  await page.locator(`[data-mod-action="${next}"]:not([disabled])`).waitFor();
  assert.equal(await page.locator('[data-mod-action][aria-busy]').count(),0);
  assert.equal(await fs.readFile(path.join(g.installPath,'Content/config.ini'),'utf8'),!fail&&action==='disable'?'original':'modded');
  await page.unroute('**/api/installations/action',handler);
 }
 await page.locator('[data-mod-action="uninstall"]').click();await page.locator('[data-confirm-uninstall]').click();await page.locator('.empty h3').filter({hasText:'还没有托管 Mod'}).waitFor();assert.equal(await fs.readFile(path.join(g.installPath,'Content/config.ini'),'utf8'),'original');await assert.rejects(fs.stat(path.join(g.installPath,'Content/assets/new.txt')),/ENOENT/);assert.deepEqual(errors,[]);console.log('安装界面通过：安装、校验、启停 loading（轮询、导航、防重复、失败恢复）、卸载还原。');
 }finally{await browser?.close();await new Promise(r=>service.server.close(r));await fs.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
const { openHome } = require('./ui-open.cjs');
