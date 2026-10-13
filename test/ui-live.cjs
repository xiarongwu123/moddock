const {chromium}=require('@playwright/test');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {createServer}=require('./server-fixture.cjs');const {scan}=require('../scanner.cjs');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moddock-live-'));const steam=path.join(root,'Steam');await fs.mkdir(path.join(steam,'steamapps/common/Stardew Valley'),{recursive:true});await fs.writeFile(path.join(steam,'steamapps/appmanifest_413150.acf'),'"AppState" { "appid" "413150" "name" "Stardew Valley" "installdir" "Stardew Valley" }');
 const service=await createServer({root:path.join(root,'data'),port:0,scan:()=>scan([steam])});let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await openHome(page,service.url);await page.locator('[data-game="steam-413150"]').waitFor();assert.equal(await page.locator('[data-nav="sources"]').count(),0);assert.equal(await page.locator('[data-nav="discover"]').count(),0);
  await page.locator('[data-game="steam-413150"]').click();await page.getByRole('tab',{name:'探索 Mod',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.online-card').length>=20,{timeout:35000});
  await page.locator('#online-search').fill('sword');await page.locator('[data-online-search]').click();await page.waitForFunction(()=>document.querySelector('.source-messages').textContent.includes('有可展示的 Mod')&&!document.querySelector('.source-messages').textContent.includes('查询中'),{timeout:35000});
  await page.locator('[data-provider="banana"]').click();await page.locator('.online-card').first().waitFor();await page.locator('.online-card [data-mod]').first().click();await page.locator('[data-download-file="1693151"]').waitFor({timeout:30000});assert.equal(await page.locator('.modal a').count(),0);
  await page.locator('[data-download-file="1693151"]').click();await page.locator('.modal-foot [data-nav="tasks"]').click();await page.waitForFunction(()=>document.querySelector('.download-row .status')?.textContent==='已下载'||document.querySelector('.download-row .status')?.textContent==='失败',{timeout:60000});
  const j=service.downloads.jobs[0];assert.equal(j.status,'completed',j.message);assert.equal(j.bytes,3223);assert.equal((await fs.readFile(j.path)).subarray(0,2).toString(),'PK');assert.equal(j.sha256.length,64);
  await page.screenshot({path:path.resolve(__dirname,'../../moddock-downloads.png'),fullPage:true});
  await page.locator('[data-nav="library"]').click();await page.locator('[data-game="steam-413150"]').click();await page.getByRole('tab',{name:'探索 Mod',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.online-card').length>=20,{timeout:35000});await page.locator('[data-provider="nexus"]').click();const before=await page.locator('.online-card').count();await page.locator('[data-more="nexus"]').click();await page.waitForFunction(()=>document.querySelectorAll('.online-card').length>=40,{timeout:35000});assert.ok(await page.locator('.online-card').count()>before);
  await page.screenshot({path:path.resolve(__dirname,'../../moddock-detail.png'),fullPage:false});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log('通过：扫描安装记录、移除演示入口、N 网全库搜索与分页、香蕉网软件内真实 ZIP 下载（3223 B，MD5 与 SHA-256 校验）、详情无外跳、移动布局。');
 }finally{await browser?.close();await new Promise(r=>service.server.close(r));await fs.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
const { openHome } = require('./ui-open.cjs');
