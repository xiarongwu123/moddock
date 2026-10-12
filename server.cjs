const http = require('node:http');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { scan } = require('./scanner.cjs');
const { Sources, sourceGames, providers } = require('./sources.cjs');
const { Downloads } = require('./downloads.cjs');
const { Installers } = require('./installers.cjs');
const {ModLibrary}=require('./library.cjs');
const {parseNxm,authorizationPage}=require('./nxm.cjs');
const {recipes}=require('./adapters.cjs');
const { ensureUi } = require('./scripts/build-ui.cjs');
async function createServer(options = {}) {
 await ensureUi();
 const root = path.resolve(options.root || process.env.MODDOCK_DATA || path.join(__dirname, '.moddock-data')); await fs.mkdir(root, { recursive: true });
 const configPath = path.join(root, 'settings.json'); let config = { scanPaths: [], mappings: {}, autoImport:true };
 try { config = { ...config, ...JSON.parse(await fs.readFile(configPath, 'utf8')) }; } catch (e) { if (e.code !== 'ENOENT') throw e; }
 const saveConfig = async () => { await fs.writeFile(configPath + '.tmp', JSON.stringify(config, null, 2)); await fs.rename(configPath + '.tmp', configPath); };
 const doScan = options.scan || scan; let scanResult = await doScan(config.scanPaths);
 const token = crypto.randomBytes(32).toString('hex'); const sources = new Sources(options.sources || {}); const downloads = await new Downloads(root, sources, options.downloads).open();
 const installers = await new Installers(root, downloads, options.installers).open();
 const library=new ModLibrary(downloads,installers,sources);
 downloads.onCompleted=async job=>{if(config.autoImport!==false)await library.import(job.game,job.id);};
 let nxmStatus=null; const pendingNxm=new Map();
 let nxmQueue=Promise.resolve();
 function receiveNxm(value,gameId){const action=()=>acceptNxm(value,gameId);const p=nxmQueue.catch(()=>{}).then(action);nxmQueue=p;return p;}
 async function acceptNxm(value,gameId){
  try{const auth=parseNxm(value);let games=onlineGames();if(gameId)games=games.filter(g=>g.id===gameId);const matches=[];for(const g of games){try{if(await sources.nexusGame(g)===auth.domain)matches.push(g);}catch{}}
   if(matches.length!==1)throw new Error(matches.length?'多个本机游戏匹配此专区，请在设置中选择目标游戏后接收链接':'此 NXM 游戏不在本机游戏库中，请扫描游戏并匹配 Nexus 专区');const g=matches[0];
   const resourceId=`nexus:${auth.domain}:${auth.modId}`;
   if(!sources.keys.nexus){if(pendingNxm.size>=20)throw new Error('待授权链接过多');pendingNxm.set(`${g.id}:${resourceId}:${auth.fileId}`,{auth,gameId:g.id});nxmStatus={id:crypto.randomUUID(),status:'needs_key',gameId:g.id,message:'已收到文件授权，请先在设置中连接同一账号的 Nexus API Key'};return nxmStatus;}
   const job=downloads.resumeAuthorization(g,resourceId,auth.fileId,auth);nxmStatus={id:crypto.randomUUID(),status:'queued',gameId:g.id,jobId:job.id,message:'已收到 NXM 文件授权，下载已加入队列'};return nxmStatus;
  }catch(e){nxmStatus={id:crypto.randomUUID(),status:'error',message:e.message};throw e;}
 }
 function onlineGames() { return scanResult.games.map(g => { const known = sourceGames.find(s => (g.appId && s.appId === g.appId) || [s.name, s.searchName].some(n => n.toLowerCase() === g.name.toLowerCase())); return { ...known, ...g, searchName: known?.searchName || g.name, ...config.mappings[g.id] }; }); }
 const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
  const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  try {
   if (req.headers.host !== `127.0.0.1:${server.address().port}`) return send({ error: '非法访问地址' }, 403);
   const url = new URL(req.url, `http://${req.headers.host}`);
   if (url.pathname.startsWith('/api/')) {
    if (req.method === 'GET' && url.pathname === '/api/state') return send({ scan: scanResult, token, games: scanResult.games, sourceGames: onlineGames(), providers, connections: sources.status(), jobs: downloads.view(), installations: installers.view(onlineGames()), scanPaths: config.scanPaths, mappings: config.mappings, downloadPath: downloads.root, autoImport:config.autoImport!==false, recipes, nxmStatus, nexusAuthorizationWindow:!!options.authorize, nxmProtocol:options.protocolStatus?.()||false });
    if (req.method !== 'POST' || req.headers['x-moddock-token'] !== token) return send({ error: '请求未授权' }, 403);
    let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 16384) return send({ error: '请求过大' }, 413); } const body = JSON.parse(raw || '{}');
    const game = () => { const g = onlineGames().find(g => g.id === body.gameId); if (!g) throw new Error('请先扫描并选择本机安装的游戏'); return g; };
    if(url.pathname==='/api/library/import')return send(await library.import(game(),body.jobId));
    if(url.pathname==='/api/library/auto-import'){if(typeof body.enabled!=='boolean')throw new Error('自动导入设置无效');config.autoImport=body.enabled;await saveConfig();return send({ok:true});}
    if(url.pathname==='/api/updates/check')return send(await library.checkUpdates(game()));
    if(url.pathname==='/api/updates/download')return send(await library.downloadUpdate(game(),body.id,body.fileId));
    if(url.pathname==='/api/loadouts/save')return send(await installers.saveLoadout(game(),body.name));
    if(url.pathname==='/api/loadouts/switch')return send(await installers.switchLoadout(game(),body.id));
    if(url.pathname==='/api/loadouts/delete')return send(await installers.deleteLoadout(game(),body.id));
    if(url.pathname==='/api/nexus/receive')return send(await receiveNxm(body.url,body.gameId));
    if(url.pathname==='/api/nexus/authorize'){const g=game();const r=sources.resource(g,body.id);if(r.source!=='nexus'||r.domain!==await sources.nexusGame(g))throw new Error('文件不属于当前游戏');const page=authorizationPage(body.id,body.fileId);if(!options.authorize)throw new Error('软件内授权窗口需要桌面版；网页预览可在设置中粘贴 NXM 链接');await options.authorize(page);return send({ok:true});}
    if (url.pathname === '/api/installations/profile') return send(await installers.setProfile(game(), body.rule));
    if (url.pathname === '/api/installations/inspect') return send(await installers.inspect(game(), body.jobId));
    if (url.pathname === '/api/installations/plan') return send(await installers.prepare(game(), body.jobId));
    if (url.pathname === '/api/installations/discard') return send(await installers.discard(body.id));
    if (url.pathname === '/api/installations/apply') return send(await installers.apply(game(), body.id, body.allowOverwrite === true));
    if (url.pathname === '/api/installations/action') return send(await installers.action(game(), body.id, body.action));
    if (url.pathname === '/api/installations/launch') return send(await installers.launch(game()));
    if (url.pathname === '/api/installations/run') return send(await installers.checkRun(game(), body.id));
    if (url.pathname === '/api/sources/list') { if (body.force === true) sources.cache.clear(); return send(await sources.list(body.source, game(), body.query || '', body.page ?? 1)); }
    if (url.pathname === '/api/sources/detail') { const detail = await sources.detail(game(), body.id); return send({ ...detail, files: detail.files.map(({ _url, md5, ...f }) => f) }); }
    if (url.pathname === '/api/sources/connection') {const result=sources.connect(body.source,body.key);if(body.source==='nexus'&&body.key){for(const [id,p]of pendingNxm){pendingNxm.delete(id);const g=onlineGames().find(g=>g.id===p.gameId);if(g){try{if(Number(p.auth.expires)*1000<=Date.now())throw new Error('待接收的 NXM 授权已过期，请重新授权');const job=downloads.resumeAuthorization(g,`nexus:${p.auth.domain}:${p.auth.modId}`,p.auth.fileId,p.auth);nxmStatus={id:crypto.randomUUID(),status:'queued',jobId:job.id,message:'已连接 Key，继续下载已接收的授权文件'};}catch(e){nxmStatus={id:crypto.randomUUID(),status:'error',message:e.message};}}}}return send(result);}
    if (url.pathname === '/api/downloads/start') return send(downloads.start(game(), body.id, body.fileId, body.name));
    if (url.pathname === '/api/downloads/cancel') { downloads.cancel(body.id); return send({ ok: true }); }
    if (url.pathname === '/api/downloads/file') { const file = await downloads.completedFile(body.id); res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}` }); createReadStream(file.file).pipe(res); return; }
    if (url.pathname === '/api/downloads/reveal') { const file = await downloads.completedFile(body.id); if (!options.reveal) throw new Error('此功能需要桌面版'); await options.reveal(file.file); return send({ ok: true }); }
    if (url.pathname === '/api/scan') { scanResult = await doScan(config.scanPaths); return send(scanResult); }
    if (url.pathname === '/api/paths') { if (!Array.isArray(body.paths) || body.paths.length > 20 || body.paths.some(p => typeof p !== 'string' || !path.isAbsolute(p))) throw new Error('请输入绝对路径，每行一个，最多 20 个'); config.scanPaths = body.paths; await saveConfig(); return send({ ok: true }); }
    if (url.pathname === '/api/mapping') {
     const g = game(); const m = body.mapping;
     if (!m || typeof m !== 'object' || typeof m.searchName !== 'string' || m.searchName.length > 160 || !/^[a-z0-9_-]*$/.test(m.nexus || '') || !/^\d*$/.test(m.banana || '') || !/^\d*$/.test(m.appId || '')) throw new Error('来源匹配参数无效');
     if (g.platform === 'Steam' && m.appId && m.appId !== g.appId) throw new Error('Steam 游戏的 App ID 从安装记录读取，不能改为其他游戏');
     config.mappings[g.id] = { searchName: m.searchName.trim() || g.name, ...(m.nexus ? { nexus: m.nexus } : {}), ...(m.banana ? { banana: m.banana } : {}), ...(m.appId ? { appId: m.appId } : {}) }; sources.cache.clear(); sources.gameIds.clear(); await saveConfig(); return send({ ok: true });
    }
    return send({ error: '接口不存在' }, 404);
   }
   const files = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/auth.js': 'auth.js', '/auth.css': 'auth.css', '/splash.svg': 'splash.svg', '/splash-preview.html': 'splash-preview.html', '/splash-preview.css': 'splash-preview.css', '/splash-preview.js': 'splash-preview.js', '/fonts/fusion-pixel-12px-proportional-zh_hans.woff2': 'fonts/fusion-pixel-12px-proportional-zh_hans.woff2' }; const name = files[url.pathname]; if (!name) { res.writeHead(404); return res.end('Not found'); }
   res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https://cdn.akamai.steamstatic.com https://shared.akamai.steamstatic.com https://staticdelivery.nexusmods.com https://images.gamebanana.com https://images.steamusercontent.com https://steamuserimages-a.akamaihd.net data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
   res.writeHead(200, { 'Content-Type': name.endsWith('.woff2') ? 'font/woff2' : name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' }); res.end(await fs.readFile(path.join(__dirname, 'public', name)));
  } catch (e) { if (!res.headersSent) send({ error: e.message }, 400); else res.destroy(); }
 });
 await new Promise(resolve => server.listen(options.port ?? Number(process.env.PORT || 4173), '127.0.0.1', resolve));
 return { server, sources, downloads, installers, library, receiveNxm, url: `http://127.0.0.1:${server.address().port}` };
}
if (require.main === module) createServer().then(({ url }) => console.log(`游匣已启动：${url}`)).catch(e => { console.error(e.message); process.exit(1); });
module.exports = { createServer };
