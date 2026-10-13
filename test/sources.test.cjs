const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Sources, sourceGames, downloadAllowed } = require('../sources.cjs');
const { Downloads, filename } = require('../downloads.cjs');
const { createServer, loginFixture } = require('./server-fixture.cjs');
const game = { ...sourceGames[0], id:'steam-413150',platform:'Steam',installPath:'D:\\SteamLibrary\\Stardew Valley',real:true };
const wait = async d => { for(let n=0;n<200&&(d.controllers.size||d.jobs.some(j=>['running','queued'].includes(j.status)));n++)await new Promise(r=>setTimeout(r,10)); };
const temp = async t => {const root=await fs.mkdtemp(path.join(os.tmpdir(),'moddock-v3-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;};
test('N 网全库搜索、分页、游戏范围及缓存',async()=>{
 let calls=0,body;const s=new Sources({fetch:async(url,opts)=>{calls++;body=JSON.parse(opts.body);return Response.json({data:{mods:{totalCount:34461,nodes:[{modId:1,name:'Sword',game:{domainName:'stardewvalley'}},{modId:2,name:'Wrong game',game:{domainName:'other'}}]}}});}});
 const r=await s.list('nexus',game,'sword',2);assert.equal(r.scope,'search');assert.equal(r.total,34461);assert.equal(r.hasNext,true);assert.equal(r.items.length,1);assert.equal(body.variables.offset,20);assert.equal(body.variables.filter.name[0].value,'sword');assert.equal(body.variables.filter.gameDomainName[0].value,'stardewvalley');assert.equal((await s.list('nexus',game,'sword',2)).cached,true);assert.equal(calls,1);
});
test('香蕉网详情校验游戏、文件归属及直链',async()=>{
 const s=new Sources({fetch:async()=>Response.json({_aGame:{_idRow:5937},_sText:'<b>description</b>',_aFiles:[{_idRow:5,_sFile:'mod.zip',_nFilesize:3,_sDownloadUrl:'https://gamebanana.com/dl/5'}]})});
 assert.equal((await s.detail(game,'banana:99')).description,'description');assert.equal((await s.downloadFile(game,'banana:99','5'))._url,'https://gamebanana.com/dl/5');await assert.rejects(s.downloadFile(game,'banana:99','6'),/不属于/);await assert.rejects(s.detail({...game,banana:'100'},'banana:99'),/不属于/);
});
test('下载状态区分 N 网缺少 Key、工坊通道缺失和香蕉网地址缺失',async()=>{
 const banana=new Sources({fetch:async()=>Response.json({_aGame:{_idRow:5937},_aFiles:[{_idRow:1,_sFile:'direct.zip',_sDownloadUrl:'https://gamebanana.com/dl/1'},{_idRow:2,_sFile:'missing.zip'}]})});const b=await banana.detail(game,'banana:99');assert.equal(b.files[0].available,true);assert.equal(b.files[1].downloadCode,'NO_DOWNLOAD_ADDRESS');assert.ok(!b.files[1].downloadReason.includes('需要授权'));
 const nexus=new Sources({fetch:async(url,opts)=>{if(opts.body.includes('modFiles'))return Response.json({data:{mod:{description:'test'},modFiles:[{fileId:5,name:'mod',category:'MAIN'}]}});return Response.json({data:{game:{id:130}}});}});const n=await nexus.detail(game,'nexus:stardewvalley:99');assert.equal(n.files[0].downloadCode,'NEXUS_KEY_REQUIRED');assert.equal(n.files[0].available,false);nexus.connect('nexus','test-key');assert.equal((await nexus.detail(game,'nexus:stardewvalley:99')).files[0].downloadCode,'NEXUS_PERMISSION_CHECK');
 const workshop=new Sources({fetch:async()=>Response.json({response:{publishedfiledetails:[{result:1,consumer_app_id:294100,publishedfileid:'99',file_url:''}]}})});const w=await workshop.detail({...game,appId:'294100',workshop:true},'workshop:99');assert.equal(w.files[0].downloadCode,'STEAM_CHANNEL_NOT_IMPLEMENTED');assert.match(w.files[0].downloadReason,/Web API Key 也不能解决/);
});
test('N 网 CDN 官方链接允许下载，网络错误不冒充账号权限问题',async()=>{
 assert.ok(downloadAllowed('https://premium-files.nexus-cdn.com/130/mod.zip'));assert.ok(downloadAllowed('https://supporter-files.nexus-cdn.com/130/mod.zip'));assert.equal(downloadAllowed('https://nexus-cdn.com.evil.test/file'),null);assert.equal(downloadAllowed('http://premium-files.nexus-cdn.com/file'),null);
 let mode='ready';const s=new Sources({fetch:async(url,opts)=>{if(String(url).includes('/download_link.json')){if(mode==='network')throw Object.assign(new Error('Connection reset'),{code:'ECONNRESET'});if(mode==='denied')return new Response('',{status:403});return Response.json([{URI:'https://premium-files.nexus-cdn.com/130/mod.zip'}]);}if(opts.body.includes('modFiles'))return Response.json({data:{mod:{description:'test'},modFiles:[{fileId:5,name:'mod',category:'MAIN'}]}});return Response.json({data:{game:{id:130}}});}});s.connect('nexus','test-key');assert.match((await s.downloadFile(game,'nexus:stardewvalley:99','5'))._url,/nexus-cdn/);mode='network';await assert.rejects(s.downloadFile(game,'nexus:stardewvalley:99','5'),e=>e.code==='ECONNRESET'&&e.message.includes('Connection reset')&&!e.message.includes('Premium'));mode='denied';await assert.rejects(s.downloadFile(game,'nexus:stardewvalley:99','5'),/NXM 授权/);
});
test('Steam 工坊查询分页，详情无直链时不能假装下载',async()=>{
 const g={...sourceGames.find(g=>g.id==='rimworld'),id:'steam-294100'};let u;
 const s=new Sources({fetch:async(url,opts)=>{u=new URL(url);if(opts.method==='POST')return Response.json({response:{publishedfiledetails:[{result:1,consumer_app_id:294100,publishedfileid:'99',title:'Mod',file_url:'',file_size:20}]}});return Response.json({response:{result:1,total:40,publishedfiledetails:[{publishedfileid:'99',consumer_app_id:294100,title:'Mod'}]}});}});
 s.connect('workshop','a'.repeat(32));const r=await s.list('workshop',g,'test',2);assert.equal(JSON.parse(u.searchParams.get('input_json')).page,2);assert.equal(r.hasNext,true);const d=await s.detail(g,'workshop:99');assert.equal(d.files[0].available,false);await assert.rejects(s.downloadFile(g,'workshop:99','99'),/下载通道/);
});
test('Steam 新版公开 SSR 列表保留分页、分类与总数，过滤其他游戏及合集', async () => {
 const game = { ...sourceGames.find(g => g.id === 'rimworld') };
 let data = { eresult: 1, current_page: 2, total_pages: 3, total_count: 70, results: [
  { publishedfileid: '42', consumer_appid: 294100, title: 'Public mod', tags: [{ tag: 'Mod' }], subscriptions: 300, time_updated: 1791582767 },
  { publishedfileid: '43', consumer_appid: 999, title: 'Other game' },
  { publishedfileid: '44', consumer_appid: 294100, title: 'Collection', file_type: 1 }
 ] };
 const source = new Sources({ fetch: async () => new Response(`<script type="application/json" id="valve-ssr-data">${JSON.stringify({ renderContext: { queryData: JSON.stringify({ queries: [{ queryKey: ['workshop_browse', { appid: 294100 }], state: { data } }] }) } })}</script>`) });
 const result = await source.list('workshop', game, '', 2);
 assert.equal(result.status, 'ready'); assert.equal(result.items.length, 1); assert.equal(result.total, 70); assert.equal(result.hasNext, true);
 assert.equal(result.items[0].category, 'Mod'); assert.equal(result.items[0].metric, 300); assert.ok(result.items[0].updated);
 data = { ...data, current_page: 1, total_pages: 0, total_count: 0, results: [] };
 assert.equal((await source.list('workshop', game, 'nothing')).status, 'empty');
 source.cache.clear();
 assert.equal((await source.list('workshop', game, '', 2)).status, 'error');
});
test('真实字节下载、来源 MD5 与大小校验、重启记录恢复',async t=>{
 const root=await temp(t),bytes=Buffer.from('real fixture content');
 const sources={resource:()=>({source:'banana'}),downloadFile:async()=>({name:'../mod.zip',size:bytes.length,md5:crypto.createHash('md5').update(bytes).digest('hex'),_url:'https://files.gamebanana.com/mod.zip'})};
 const d=await new Downloads(root,sources,{fetch:async()=>new Response(bytes,{headers:{'content-type':'application/zip','content-length':String(bytes.length)}})}).open();d.start(game,'banana:1','2','Mod');await wait(d);assert.equal(d.jobs[0].status,'completed');assert.deepEqual(await fs.readFile(d.jobs[0].path),bytes);assert.equal(d.jobs[0].sha256,crypto.createHash('sha256').update(bytes).digest('hex'));assert.equal((await new Downloads(root,sources).open()).jobs[0].status,'completed');
 sources.downloadFile=async()=>({name:'mod.zip',size:bytes.length,md5:'0'.repeat(32),_url:'https://files.gamebanana.com/mod.zip'});d.start(game,'banana:1','3','Bad checksum');await wait(d);assert.equal(d.jobs[0].status,'failed');assert.match(d.jobs[0].message,/校验/);await assert.rejects(fs.access(path.join(d.root,d.jobs[0].id+'.part')));
});
test('拒绝非来源重定向、网页伪装和取消下载，清理临时文件',async t=>{
 const root=await temp(t);const sources={resource:()=>({}),downloadFile:async()=>({name:'mod.zip',_url:'https://gamebanana.com/dl/1'})};
 let mode='redirect';const d=await new Downloads(root,sources,{fetch:async(url,opts)=>{
 if(mode==='redirect')return new Response(null,{status:302,headers:{location:'http://127.0.0.1:9000/private'}});
 if(mode==='html')return new Response('<html>Login</html>',{headers:{'content-type':'text/html'}});
 return new Response(new ReadableStream({start(c){c.enqueue(Buffer.from('a'));opts.signal.addEventListener('abort',()=>c.error(new Error('aborted')));}}),{headers:{'content-type':'application/zip'}});
 }}).open();d.start(game,'banana:1','1','Redirect');await wait(d);assert.equal(d.jobs[0].status,'failed');mode='html';d.start(game,'banana:1','2','HTML');await wait(d);assert.match(d.jobs[0].message,/网页/);mode='stream';const j=d.start(game,'banana:1','3','Cancel');await new Promise(r=>setTimeout(r,25));d.cancel(j.id);await wait(d);assert.equal(d.jobs[0].status,'cancelled');await assert.rejects(fs.access(path.join(d.root,j.id+'.part')));assert.equal(downloadAllowed('https://nexusmods.com.evil.test/x'),null);assert.equal(downloadAllowed('file:///etc/passwd'),null);assert.equal(filename('..\\CON.exe'),'mod-CON.exe');
});
test('接口只暴露本机游戏、不暴露密钥和下载直链、下载必须鉴权',async t=>{
 const root=await temp(t);const service=await createServer({root,port:0,scan:async()=>({games:[game],roots:[],diagnostics:[]})});t.after(()=>new Promise(r=>service.server.close(r)));
 const authenticated=await loginFixture(service),state=authenticated.state;assert.deepEqual(state.games,[game]);assert.equal(state.sourceGames.length,1);assert.ok(!('mods'in state));
 const post=(route,body,auth=true)=>authenticated.fetch(service.url+'/api/'+route,{method:'POST',headers:auth?{'X-Moddock-Token':state.token}:{},body:JSON.stringify(body)});
 assert.equal((await post('downloads/start',{},false)).status,403);assert.equal((await post('downloads/start',{gameId:'stardew',id:'banana:1',fileId:'1'})).status,400);assert.equal((await post('action',{action:'install'})).status,404);
 await post('sources/connection',{source:'workshop',key:'a'.repeat(32)});assert.ok(!(await(await authenticated.fetch(service.url+'/api/state')).text()).includes('a'.repeat(32)));
 assert.equal((await post('mapping',{gameId:game.id,mapping:{searchName:'Stardew Valley',appId:'1'}})).status,400);
});
test('空列表不显示获取成功，有原始记录但全被过滤时明确报告解析问题',async()=>{
 const empty=new Sources({fetch:async()=>Response.json({_aRecords:[],_aMetadata:{_nRecordCount:0,_nPerpage:15}})});const a=await empty.list('banana',game);assert.equal(a.status,'empty');assert.equal(a.returnedCount,0);assert.equal(a.items.length,0);assert.equal(a.hasNext,false);assert.ok(!a.message.includes('可搜索并分页'));
 const invalid=new Sources({fetch:async()=>Response.json({data:{mods:{totalCount:2,nodes:[{modId:8,name:'Other',game:{domainName:'other'}}]}}})});const b=await invalid.list('nexus',game);assert.equal(b.status,'error');assert.equal(b.code,'EMPTY_PARSED_RESULT');assert.equal(b.returnedCount,1);assert.equal(b.filteredCount,1);
});
test('游戏专区限定接口省略冗余字段时，合法 Mod 不被误过滤',async()=>{
 const n=new Sources({fetch:async()=>Response.json({data:{mods:{totalCount:1,nodes:[{modId:8,name:'Actual Mod'}]}}})});assert.equal((await n.list('nexus',game)).items.length,1);
 const b=new Sources({fetch:async()=>Response.json({_aMetadata:{_nRecordCount:1},_aRecords:[{_idRow:8,_sName:'Actual Mod',_sProfileUrl:'https://gamebanana.com/mods/8'}]})});assert.equal((await b.list('banana',game,'mod')).items.length,1);
});
test('商标、中文与 Skyrim 别名保持安全的游戏身份匹配',async()=>{
 const {normalize}=require('../sources.cjs');assert.equal(normalize('FINAL FANTASY™ XVI'),'finalfantasyxvi');assert.notEqual(normalize('黑神话：悟空'),normalize('星露谷物语'));
 const s=new Sources({fetch:async()=>{throw Error('Offline');}});assert.equal(await s.nexusGame({id:'steam-72850',name:'The Elder Scrolls V: Skyrim',appId:'72850'}),'skyrim');assert.equal(await s.nexusGame({id:'steam-489830',name:'The Elder Scrolls V: Skyrim Special Edition',appId:'489830'}),'skyrimspecialedition');
});
test('网络错误保留来源和具体代码，超时不伪装为空 Mod',async()=>{
 const s=new Sources({fetch:async()=>{throw new DOMException('timed out','TimeoutError');}});const r=await s.list('banana',game);assert.equal(r.status,'error');assert.equal(r.code,'TIMEOUT');assert.equal(r.host,'gamebanana.com');assert.equal(r.total,null);
});
