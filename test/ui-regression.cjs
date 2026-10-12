const {chromium}=require('@playwright/test');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {createServer}=require('./server-fixture.cjs');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moddock-empty-regression-'));const g={id:'steam-413150',appId:'413150',name:'Stardew Valley',platform:'Steam',installPath:root,real:true};
 const service=await createServer({root,port:0,scan:async()=>({games:[g],roots:[],diagnostics:[]}),sources:{fetch:async(url,init)=>{
 if(String(url).includes('nexusmods')){const query=JSON.parse(init.body).variables?.filter?.name?.[0]?.value||'';await new Promise(r=>setTimeout(r,query==='old'?150:10));return Response.json({data:{mods:{totalCount:1,nodes:[{modId:1,name:query||'Actual resource',summary:'Resource from scoped API without redundant game field'}]}}});}
 return Response.json({_aMetadata:{_nRecordCount:0,_nPerpage:15},_aRecords:[]});
 }}});let browser;
 try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await openHome(page,service.url);await page.locator('[data-game]').click();await page.locator('.online-card h3').filter({hasText:'Actual resource'}).waitFor();
 assert.ok((await page.locator('.source-messages').innerText()).includes('没有返回 Mod'));
 await page.locator('[data-provider="banana"]').click();assert.equal(await page.locator('.online-card').count(),0);assert.ok((await page.locator('.empty').innerText()).includes('其他来源已有 1 项'));await page.locator('.empty [data-provider="all"]').click();assert.equal(await page.locator('.online-card').count(),1);
 await page.locator('#online-search').fill('old');await page.locator('[data-online-search]').click();await page.locator('#online-search').fill('new');await page.locator('[data-online-search]').click();await page.locator('.online-card h3').filter({hasText:'new'}).waitFor();await page.waitForTimeout(220);assert.equal(await page.locator('.online-card h3').innerText(),'new');assert.deepEqual(errors,[]);console.log('UI回归通过：接口真实条目不会因省略游戏字段而消失；空来源显示原因与其他来源入口；旧搜索不会覆盖新结果。');
 }finally{await browser?.close();await new Promise(r=>service.server.close(r));await fs.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
const { openHome } = require('./ui-open.cjs');
