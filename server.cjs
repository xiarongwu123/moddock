const http = require('node:http');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { scan } = require('./scanner.cjs');
const { Sources, sourceGames, providers } = require('./sources.cjs');
const { Downloads } = require('./downloads.cjs');
async function createServer(options = {}) {
 const root = path.resolve(options.root || process.env.MODDOCK_DATA || path.join(__dirname, '.moddock-data')); await fs.mkdir(root, { recursive: true });
 const configPath = path.join(root, 'settings.json'); let config = { scanPaths: [], mappings: {} };
 try { config = { ...config, ...JSON.parse(await fs.readFile(configPath, 'utf8')) }; } catch (e) { if (e.code !== 'ENOENT') throw e; }
 const saveConfig = async () => { await fs.writeFile(configPath + '.tmp', JSON.stringify(config, null, 2)); await fs.rename(configPath + '.tmp', configPath); };
 const doScan = options.scan || scan; let scanResult = await doScan(config.scanPaths);
 const token = crypto.randomBytes(32).toString('hex'); const sources = new Sources(options.sources || {}); const downloads = await new Downloads(root, sources, options.downloads).open();
 function onlineGames() { return scanResult.games.map(g => { const known = sourceGames.find(s => (g.appId && s.appId === g.appId) || [s.name, s.searchName].some(n => n.toLowerCase() === g.name.toLowerCase())); return { ...known, ...g, searchName: known?.searchName || g.name, ...config.mappings[g.id] }; }); }
 const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
  const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  try {
   if (req.headers.host !== `127.0.0.1:${server.address().port}`) return send({ error: '非法访问地址' }, 403);
   const url = new URL(req.url, `http://${req.headers.host}`);
   if (url.pathname.startsWith('/api/')) {
    if (req.method === 'GET' && url.pathname === '/api/state') return send({ scan: scanResult, token, games: scanResult.games, sourceGames: onlineGames(), providers, connections: sources.status(), jobs: downloads.view(), scanPaths: config.scanPaths, mappings: config.mappings, downloadPath: downloads.root });
    if (req.method !== 'POST' || req.headers['x-moddock-token'] !== token) return send({ error: '请求未授权' }, 403);
    let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 16384) return send({ error: '请求过大' }, 413); } const body = JSON.parse(raw || '{}');
    const game = () => { const g = onlineGames().find(g => g.id === body.gameId); if (!g) throw new Error('请先扫描并选择本机安装的游戏'); return g; };
    if (url.pathname === '/api/sources/list') { if (body.force === true) sources.cache.clear(); return send(await sources.list(body.source, game(), body.query || '', body.page ?? 1)); }
    if (url.pathname === '/api/sources/detail') { const detail = await sources.detail(game(), body.id); return send({ ...detail, files: detail.files.map(({ _url, md5, ...f }) => f) }); }
    if (url.pathname === '/api/sources/connection') return send(sources.connect(body.source, body.key));
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
   const files = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' }; const name = files[url.pathname]; if (!name) { res.writeHead(404); return res.end('Not found'); }
   res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https://cdn.akamai.steamstatic.com https://shared.akamai.steamstatic.com https://staticdelivery.nexusmods.com https://images.gamebanana.com https://images.steamusercontent.com https://steamuserimages-a.akamaihd.net data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
   res.writeHead(200, { 'Content-Type': name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' }); res.end(await fs.readFile(path.join(__dirname, 'public', name)));
  } catch (e) { if (!res.headersSent) send({ error: e.message }, 400); else res.destroy(); }
 });
 await new Promise(resolve => server.listen(options.port ?? Number(process.env.PORT || 4173), '127.0.0.1', resolve));
 return { server, sources, downloads, url: `http://127.0.0.1:${server.address().port}` };
}
if (require.main === module) createServer().then(({ url }) => console.log(`游匣已启动：${url}`)).catch(e => { console.error(e.message); process.exit(1); });
module.exports = { createServer };
