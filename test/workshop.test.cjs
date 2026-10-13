const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { catalog, sameGame, Workshop } = require('../workshop.cjs');
const { loginFixture } = require('./server-fixture.cjs');
const { workshopFixture } = require('./workshop-fixture.cjs');
const stardew = 'catalog:nexus:stardewvalley';
async function fixture(t, options) {
 const service = await workshopFixture(options); t.after(() => service.close());
 const auth = await loginFixture(service);
 const post = async (route, body = {}) => {
  const response = await auth.fetch(service.url + '/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': auth.state.token }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
 };
 return { ...service, post };
}
test('catalog is independent of installed games, paginated, searchable, and keeps game editions distinct', () => {
 const games = catalog(); assert.ok(games.length > 5000);
 assert.equal(games.filter(game => game.id === stardew).length, 1);
 assert.ok(games.find(game => game.id === 'catalog:steam:431960'));
 const local = { id: 'local', name: 'Stardew Valley', appId: '413150', installPath: '/private/test' };
 assert.deepEqual(catalog([local]).find(game => game.id === stardew).localIds, ['local']);
 assert.equal(sameGame({ appId: '72850', name: 'Skyrim' }, { appId: '489830', name: 'Skyrim' }), false);
 const workshop = new Workshop('/tmp/unused', () => []);
 assert.equal(workshop.list({ query: '星露谷' }).items[0].id, stardew);
 assert.equal(workshop.list({ page: 1 }).items.length, 24);
 assert.notEqual(workshop.list({ page: 1 }).items[0].id, workshop.list({ page: 2 }).items[0].id);
 assert.equal(workshop.list({ scope: 'installed' }).total, 0);
 assert.throws(() => workshop.list({ page: -1 }));
});
test('uninstalled game supports three-source browsing; failures stay source-specific and metadata survives', async t => {
 const x = await fixture(t, { empty: true });
 const games = await x.post('workshop/catalog', { query: '星露谷' }); assert.equal(games.status, 200);
 const nexus = await x.post('workshop/list', { gameId: stardew, source: 'nexus' });
 assert.equal(nexus.body.items[0].category, 'Visuals and Graphics'); assert.ok(nexus.body.items[0].updated);
 x.fail('nexusmods.com');
 const failed = await x.post('workshop/list', { gameId: stardew, source: 'nexus', force: true });
 assert.equal(failed.body.status, 'error');
 const banana = await x.post('workshop/list', { gameId: stardew, source: 'banana' }); assert.equal(banana.body.status, 'ready');
 const steam = await x.post('workshop/list', { gameId: 'catalog:nexus:rimworld', source: 'workshop' }); assert.equal(steam.body.items[0].steamUrl, 'steam://url/CommunityFilePage/12345');
 const detail = await x.post('workshop/detail', { gameId: stardew, id: 'banana:99' });
 assert.equal(detail.body.files[0].available, true); assert.ok(!JSON.stringify(detail.body).includes('https://gamebanana.com/dl/'));
 assert.equal((await x.post('workshop/list', { gameId: 'made-up', source: 'banana' })).status, 400);
});
test('favorites persist per account, reject unobserved items, and serialize concurrent writes', async t => {
 const x = await fixture(t);
 assert.equal((await x.post('workshop/favorite', { gameId: stardew, id: 'banana:999', enabled: true })).status, 400);
 const { body: result } = await x.post('workshop/list', { gameId: stardew, source: 'nexus' });
 await Promise.all(result.items.map(item => x.post('workshop/favorite', { gameId: stardew, id: item.id, enabled: true })));
 assert.equal((await x.post('workshop/favorites')).body.length, 3);
 const store = new Workshop(path.join(x.root, 'data'), () => []);
 assert.equal((await store.favorites('fixture-user')).length, 3); assert.equal((await store.favorites('someone-else')).length, 0);
 await x.post('workshop/favorite', { gameId: stardew, id: result.items[0].id, enabled: false });
 assert.equal((await store.favorites('fixture-user')).length, 2);
});
test('download before installation can bind only to the matching scanned game, then deploy through a plan', async t => {
 const x = await fixture(t, { empty: true });
 const download = await x.post('downloads/start', { gameId: stardew, id: 'banana:99', fileId: '5', name: 'Fixture' });
 assert.equal(download.status, 200);
 for (let i = 0; i < 200 && (x.downloads.controllers.size || x.downloads.jobs.some(job => ['queued', 'running'].includes(job.status))); i++) await new Promise(resolve => setTimeout(resolve, 10));
 const job = x.downloads.jobs[0]; assert.equal(job.status, 'completed'); assert.equal(job.import.status, 'unbound');
 assert.deepEqual(await fs.readFile(job.path), x.bytes);
 assert.equal((await x.post('installations/plan', { gameId: stardew, jobId: job.id })).status, 400);
 assert.equal((await x.post('workshop/attach', { gameId: 'forged', jobId: job.id })).status, 400);
 x.install(); await x.post('scan');
 assert.equal((await x.post('workshop/attach', { gameId: x.game.id, jobId: job.id })).status, 200);
 assert.equal(job.gameId, x.game.id); assert.equal(job.import.status, 'ready');
 await x.post('installations/profile', { gameId: x.game.id, rule: { mode: 'copy', sourcePrefix: 'Payload', destination: 'Mods' } });
 const plan = await x.post('installations/plan', { gameId: x.game.id, jobId: job.id }); assert.equal(plan.status, 200);
 const applied = await x.post('installations/apply', { gameId: x.game.id, id: plan.body.id }); assert.equal(applied.status, 200);
 assert.equal(await fs.readFile(path.join(x.game.installPath, 'Mods/example.txt'), 'utf8'), 'Workshop fixture payload');
});
test('catalog Nexus authorization resumes the intended download when the API key is connected later', async t => {
 const x = await fixture(t, { empty: true, server: { authorize: async () => {} } });
 assert.equal((await x.post('nexus/authorize', { gameId: stardew, id: 'nexus:stardewvalley:99', fileId: '5' })).status, 200);
 const url = `nxm://stardewvalley/mods/99/files/5?key=fixture-grant&expires=${Math.floor(Date.now()/1000)+3600}`;
 const received = await x.post('nexus/receive', { url }); assert.equal(received.body.status, 'needs_key');
 assert.equal((await x.post('sources/connection', { source: 'nexus', key: 'fixture-key' })).status, 200);
 assert.equal(x.downloads.jobs[0].gameId, stardew);
 for (let i = 0; i < 200 && x.downloads.controllers.size; i++) await new Promise(resolve => setTimeout(resolve, 10));
});
