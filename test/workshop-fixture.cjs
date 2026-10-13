const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('./server-fixture.cjs');
const { zip } = require('./zip-fixture.cjs');

async function workshopFixture(options = {}) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-workshop-'));
 const game = { id: 'steam-413150', name: 'Stardew Valley', appId: '413150', platform: 'Steam', installPath: path.join(root, 'game') };
 await fs.mkdir(game.installPath);
 let installed = options.empty ? [] : [game], failure = '', extraPageFails = false;
 const bytes = zip([{ name: 'Payload/example.txt', data: 'Workshop fixture payload' }]);
 const service = await createServer({ root: path.join(root, 'data'), port: 0, scan: async () => ({ games: installed, diagnostics: [] }), installers: { processes: async () => [] },
  sources: { fetch: async (value, init = {}) => {
   const url = new URL(value), body = init.body ? String(init.body) : '';
   if (failure && url.hostname.includes(failure)) throw Object.assign(new Error('Fixture offline'), { code: 'OFFLINE' });
   if (url.hostname === 'api.nexusmods.com') {
    if (url.pathname.includes('download_link')) return new Response('', { status: 403 });
    const input = JSON.parse(body), domain = input.variables?.filter?.gameDomainName?.[0]?.value || 'stardewvalley';
    if (body.includes('modFiles')) return Response.json({ data: { mod: { description: '测试资源的完整介绍。', modRequirements: { nexusRequirements: { nodes: [{ modName: 'SMAPI', notes: '测试前置要求' }] } } }, modFiles: [{ fileId: 5, name: 'Fixture Nexus', category: 'MAIN', version: '1.0.0', sizeInBytes: bytes.length, detectedFileExtension: 'zip' }] } });
    if (body.includes('game(domainName')) return Response.json({ data: { game: { id: 130 } } });
    const offset = input.variables?.offset || 0;
    if (offset && extraPageFails) return new Response('', { status: 503 });
    const keyword = input.variables?.filter?.name?.[0]?.value || '';
    const nodes = keyword === 'nothing' ? [] : Array.from({ length: 3 }, (_, index) => ({ modId: offset + index + 1, name: `Nexus 测试资源 ${offset + index + 1}`, summary: '用于验证工坊浏览、收藏及下载流程的独立测试数据。', author: 'Fixture Author', category: index ? 'Gameplay' : 'Visuals and Graphics', updatedAt: `2026-10-${10 + index}T12:00:00Z`, downloads: 12500 - index * 300, version: '1.0.0', game: { domainName: domain } }));
    return Response.json({ data: { mods: { totalCount: nodes.length ? 40 : 0, nodes } } });
   }
   if (url.hostname === 'gamebanana.com') {
    if (url.pathname.includes('/Util/Search') && url.searchParams.get('_sModelName') === 'Game') return Response.json({ _aRecords: [{ _idRow: 200, _sName: url.searchParams.get('_sSearchString') }] });
    if (url.pathname.includes('/ProfilePage')) return Response.json({ _aGame: { _idRow: 5937 }, _sText: '这是可真实下载 ZIP 字节的测试资源。', _aFiles: [{ _idRow: 5, _sFile: 'fixture.zip', _nFilesize: bytes.length, _sDownloadUrl: 'https://gamebanana.com/dl/5' }] });
    const gameId = Number(url.searchParams.get('_aFilters[Generic_Game]') || url.searchParams.get('_idGameRow') || 5937);
    return Response.json({ _aRecords: [{ _idRow: 99, _sName: 'GameBanana 测试资源', _sProfileUrl: 'https://gamebanana.com/mods/99', _aGame: { _idRow: gameId }, _aSubmitter: { _sName: 'Fixture Creator' }, _aRootCategory: { _sName: 'Skins' }, _nDownloadCount: 7600, _tsDateModified: 1791777600 }], _aMetadata: { _nRecordCount: 1, _nPerpage: 15 } });
   }
   if (url.hostname === 'steamcommunity.com') return new Response('<div class="workshopItem"><a href="sharedfiles/filedetails/?id=12345"><div class="workshopItemTitle">Steam 测试资源</div></a></div>');
   if (url.hostname === 'api.steampowered.com') return Response.json({ response: { publishedfiledetails: [{ result: 1, consumer_app_id: 294100, publishedfileid: '12345', title: 'Steam 测试资源', description: '通过 Steam 订阅此测试资源。', file_url: '' }] } });
   throw new Error(`Unexpected source: ${url.hostname}`);
  } }, downloads: { fetch: async () => new Response(bytes, { headers: { 'content-type': 'application/zip', 'content-length': String(bytes.length) } }) }, ...options.server });
 return { ...service, root, game, bytes, install() { installed = [game]; }, fail(host) { failure = host; }, failNextPage(value) { extraPageFails = value; }, async close() {
  for (const job of service.downloads.jobs) if (['running', 'queued'].includes(job.status)) service.downloads.cancel(job.id);
  await new Promise(resolve => service.server.close(resolve)); await fs.rm(root, { recursive: true, force: true });
 } };
}
module.exports = { workshopFixture };
if (require.main === module) workshopFixture().then(service => {
 console.log(service.url);
 process.on('SIGINT', async () => { await service.close(); process.exit(0); });
 process.on('SIGTERM', async () => { await service.close(); process.exit(0); });
});
