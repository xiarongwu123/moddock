const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { createServer } = require('../server.cjs');
const { accountFixture } = require('./account-fixture.cjs');
const { Sources } = require('../sources.cjs');
const { createNexusService } = require('../platform/nexus-service.cjs');
const { zip } = require('./zip-fixture.cjs');

function png() {
 const crc = bytes => { let n = 0xffffffff; for (const byte of bytes) { n ^= byte; for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0); } return (n ^ 0xffffffff) >>> 0; };
 const chunk = (type, bytes) => { const name = Buffer.from(type), head = Buffer.alloc(4), tail = Buffer.alloc(4); head.writeUInt32BE(bytes.length); tail.writeUInt32BE(crc(Buffer.concat([name, bytes]))); return Buffer.concat([head, name, bytes, tail]); };
 const header = Buffer.alloc(13); header.writeUInt32BE(240); header.writeUInt32BE(120, 4); header[8] = 8; header[9] = 2;
 const pixels = Buffer.alloc(120 * 721);
 for (let y = 0; y < 120; y++) for (let x = 0; x < 240; x++) { const offset = y * 721 + 1 + x * 3; pixels[offset] = 96; pixels[offset + 1] = 180; pixels[offset + 2] = 60; }
 return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
 const real = process.argv.includes('--real-mu'), root = path.resolve(process.env.MODDOCK_DOWNLOAD_CHECK_ROOT || 'output/download-recovery/preview');
 await fs.mkdir(root, { recursive: true });
 let transport = fetch, electron, backend, context, blocked = true;
 if (process.versions.electron) { electron = require('electron'); await electron.app.whenReady(); transport = (url, init) => electron.net.fetch(String(url), init); }
 const game = { id: 'download-squad', name: 'Squad', appId: '393380', platform: 'Steam' };
 const bytes = zip([{ name: 'fixture.txt', data: 'Isolated download UI fixture; not a real game Mod.' }]);
 const revision = crypto.randomUUID(), image = 'data:image/png;base64,' + png().toString('base64');
 const upstream = accountFixture();
 let accounts = { fetch: transport }, sources = { fetch: transport };
 if (!real) {
  const privateSources = new Sources(); privateSources.connect('nexus', 'fixture-backend-key');
  privateSources.downloadFile = async (_game, _resource, _file, authorization) => {
   if (!authorization) throw Object.assign(new Error('Test grant required'), { code: 'NEXUS_NXM_REQUIRED' });
   return { name: 'test.zip', size: bytes.length, _url: 'https://premium-files.nexus-cdn.com/test.zip' };
  };
  const authorizer = { async open(_page, input) { context = input; this.active = { context: input, state: 'verification_required' }; await input.onState('verification_required'); }, cancel() {}, close() {} };
  backend = await createNexusService({ root: path.join(root, 'worker'), sources: privateSources, authorizer, accessToken: 'a'.repeat(64), fetch: async () => new Response(bytes), verification: {
   view: async () => ({ pending: true, revision, width: 240, height: 120, image }),
   click: async () => { await context.receive(`nxm://squad/mods/1/files/5?key=fixture-grant&expires=${Math.floor(Date.now() / 1000) + 60}&user_id=42`); return true; },
  } });
  accounts = { ...upstream.options, retryDelay: 0, fetch: async (url, init) => {
   const route = new URL(url).pathname;
   if (!route.startsWith('/api/v1/nexus/')) return upstream.options.fetch(url, init);
   if (route.endsWith('/verification') && blocked) {
    blocked = false;
    return new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')), { once: true }); });
   }
   return fetch(backend.url + route.slice('/api/v1/nexus'.length), { ...init, headers: { Authorization: 'Bearer ' + 'a'.repeat(64) } });
  } };
  sources = { fetch: async (url, init = {}) => {
   const parsed = new URL(url), query = init.body || '';
   if (parsed.hostname === 'gamebanana.com') {
    if (/\/Game\/Index|\/Util\/Search/.test(parsed.pathname)) return Response.json({ _aRecords: [{ _idRow: 11, _sName: 'Squad' }, { _idRow: 12, _sName: 'Squad' }] });
    return Response.json({ _aRecords: [], _aMetadata: { _nRecordCount: 0 } });
   }
   if (parsed.hostname === 'store.steampowered.com') return Response.json({ '393380': { success: true, data: { name: 'Squad' } } });
   if (parsed.hostname === 'steamcommunity.com') return new Response('No items to display');
   if (query.includes('modFiles')) return Response.json({ data: { mod: { description: '固定下载测试素材。绿色画面为测试控件，不是来源验证码。' }, modFiles: [{ fileId: 5, name: 'test.zip', sizeInBytes: bytes.length, category: 'MAIN', detectedFileExtension: 'zip' }] } });
   if (query.includes('game(domainName')) return Response.json({ data: { game: { id: 130 } } });
   return Response.json({ data: { mods: { totalCount: 1, nodes: [{ modId: 1, name: '下载恢复测试 [TEST]', summary: '固定测试素材，不是实际 Mod。', game: { domainName: 'squad' } }] } } });
  } };
 }
 const service = await createServer({ root: path.join(root, 'client'), port: Number(process.env.MODDOCK_DOWNLOAD_CHECK_PORT || 18120), scan: async () => ({ games: [game], diagnostics: [] }), accounts, sources, studio: { ai: null } });
 console.log(JSON.stringify({ url: service.url, realMu: real, root, pid: process.pid }));
 const close = async () => { for (const job of service.downloads.jobs) if (['running', 'queued'].includes(job.status)) service.downloads.cancel(job.id); await service.downloads.persist; service.server.closeAllConnections(); await new Promise(resolve => service.server.close(resolve)); await backend?.close(); electron ? electron.app.exit(0) : process.exit(0); };
 process.on('SIGTERM', close); process.on('SIGINT', close);
 const timer = setInterval(async () => {
  const completed = service.downloads.jobs.filter(job => job.status === 'completed');
  if (completed.length) await fs.writeFile(path.join(root, 'downloads-verified.json'), JSON.stringify({ realMu: real, generatedAt: new Date().toISOString(), downloads: completed.map(job => ({ name: job.name, source: job.source, bytes: job.bytes, sha256: job.sha256, path: job.path, resource: job.resourceId, file: job.fileId })) }, null, 2));
 }, 2000); timer.unref();
})().catch(error => { console.error(error); process.exitCode = 1; });
