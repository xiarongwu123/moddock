const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Sources } = require('../sources.cjs');

const game = { id: 'rimworld', name: 'RimWorld', appId: '294100' };
const record = { _idRow: 6762, _sModelName: 'Game', _sName: 'RimWorld' };
const index = records => ({ _aRecords: records, _aMetadata: { _nRecordCount: records.length, _nPerpage: 15 } });
const mods = index([{ _idRow: 462914, _sModelName: 'Mod', _sName: 'Wingworld', _sProfileUrl: 'https://gamebanana.com/mods/462914', _aGame: { _idRow: 6762 } }]);

test('GameBanana valid search resolves the game without a fallback and caches it', async () => {
 const calls = [];
 const source = new Sources({ fetch: async value => {
  const url = new URL(value); calls.push(url);
  return Response.json(url.pathname.includes('/Search/') ? index([record]) : mods);
 } });
 const result = await source.list('banana', game);
 assert.equal(result.status, 'ready');
 assert.equal(result.matchedGame.id, '6762');
 assert.equal(result.items[0].id, 'banana:462914');
 assert.equal(await source.bananaGame(game), '6762');
 assert.deepEqual(calls.map(url => url.pathname), ['/apiv11/Util/Search/Results', '/apiv11/Mod/Index']);
 assert.equal(calls[1].searchParams.get('_aFilters[Generic_Game]'), '6762');
});

test('GameBanana malformed search responses recover through the filtered game index', async t => {
 const failures = [null, {}, [], { _aRecords: {} }, index([null]), index([{ _sName: 'RimWorld' }]), index([{ ...record, _sModelName: 'Mod' }]), { _sErrorCode: 'SEARCH_UNAVAILABLE', _sErrorMessage: 'Search temporarily unavailable' }];
 for (const [position, failure] of failures.entries()) await t.test(`response ${position}`, async () => {
  const calls = [];
  const source = new Sources({ fetch: async value => {
   const url = new URL(value); calls.push(url);
   if (url.pathname.includes('/Search/')) return Response.json(failure);
   if (url.pathname === '/apiv11/Game/Index') {
    assert.equal(url.searchParams.get('_aFilters[Generic_Name]'), 'contains,RimWorld');
    return Response.json(index([record]));
   }
   assert.equal(url.pathname, '/apiv11/Mod/Index');
   assert.equal(url.searchParams.get('_aFilters[Generic_Game]'), '6762');
   return Response.json(mods);
  } });
  const result = await source.list('banana', game);
  assert.equal(result.status, 'ready');
  assert.equal(result.matchedGame.id, '6762');
  assert.equal(result.items.length, 1);
  assert.equal(calls.length, 3);
 });
});

test('GameBanana empty and ambiguous indexes stay unmapped without requesting mods', async t => {
 for (const records of [[], [{ ...record, _sName: 'RimWorld Classic' }], [record, { ...record, _idRow: 9999 }]]) await t.test(JSON.stringify(records), async () => {
  let calls = 0;
  const source = new Sources({ fetch: async value => {
   calls++;
   const url = new URL(value);
   assert.ok(!url.pathname.includes('/Mod/'));
   return Response.json(url.pathname.includes('/Search/') ? {} : index(records));
  } });
  const result = await source.list('banana', game);
  assert.equal(result.status, 'unmapped');
  assert.equal(result.candidates.length, records.length);
  assert.equal(calls, 2);
 });
});

test('GameBanana valid empty search does not trigger a fallback', async () => {
 let calls = 0;
 const source = new Sources({ fetch: async () => { calls++; return Response.json(index([])); } });
 assert.equal((await source.list('banana', game)).status, 'unmapped');
 assert.equal(calls, 1);
});

test('GameBanana fallback errors retain the provider code and host and can be retried', async () => {
 let mode = 'error';
 const source = new Sources({ fetch: async value => {
  const url = new URL(value);
  if (url.pathname.includes('/Search/')) return Response.json({});
  if (url.pathname === '/apiv11/Game/Index') return Response.json(mode === 'error' ? { _sErrorCode: 'INDEX_UNAVAILABLE', _sErrorMessage: 'Index temporarily unavailable' } : index([record]));
  return Response.json(mods);
 } });
 const result = await source.list('banana', game);
 assert.equal(result.status, 'error');
 assert.equal(result.code, 'GAMEBANANA_INDEX_UNAVAILABLE');
 assert.equal(result.host, 'gamebanana.com');
 assert.match(result.message, /Index temporarily unavailable/);
 assert.equal(source.cache.size, 0);
 assert.equal(source.gameIds.size, 0);
 mode = 'ready';
 assert.equal((await source.list('banana', game)).status, 'ready');
});

test('GameBanana malformed fallback remains an error rather than an empty result', async () => {
 const source = new Sources({ fetch: async () => Response.json(null) });
 const result = await source.list('banana', game);
 assert.equal(result.status, 'error');
 assert.equal(result.code, 'INVALID_SCHEMA');
 assert.equal(result.host, 'gamebanana.com');
 assert.equal(result.total, null);
});

test('GameBanana HTTP rate limits do not trigger extra index requests', async () => {
 let calls = 0;
 const source = new Sources({ fetch: async () => { calls++; return new Response('', { status: 429 }); } });
 const result = await source.list('banana', game);
 assert.equal(result.code, 'HTTP_429');
 assert.equal(result.host, 'gamebanana.com');
 assert.equal(calls, 1);
});

test('GameBanana games with requests but no mods report an empty Mod index', async () => {
 const source = new Sources({ fetch: async value => {
  const url = new URL(value);
  if (url.pathname.includes('/Search/')) return Response.json(index([{ _idRow: 18925, _sModelName: 'Game', _sName: "Baldur's Gate 3" }]));
  if (url.pathname.includes('/Subfeed')) return Response.json(index([{ _idRow: 52429, _sModelName: 'Request', _sName: 'Character model request', _sProfileUrl: 'https://gamebanana.com/requests/52429' }]));
  assert.equal(url.pathname, '/apiv11/Mod/Index');
  assert.equal(url.searchParams.get('_aFilters[Generic_Game]'), '18925');
  return Response.json(index([]));
 } });
 const result = await source.list('banana', { id: 'steam-1086940', name: "Baldur's Gate 3", appId: '1086940' });
 assert.equal(result.status, 'empty');
 assert.equal(result.total, 0);
 assert.equal(result.returnedCount, 0);
 assert.equal(result.matchedGame.id, '18925');
 assert.equal(result.hasNext, false);
});

test('GameBanana Mod index preserves pagination and game filtering', async () => {
 const source = new Sources({ fetch: async value => {
  const url = new URL(value);
  assert.equal(url.pathname, '/apiv11/Mod/Index');
  assert.equal(url.searchParams.get('_aFilters[Generic_Game]'), '6762');
  assert.equal(url.searchParams.get('_nPage'), '2');
  assert.equal(url.searchParams.get('_nPerpage'), '15');
  return Response.json({ _aRecords: [...mods._aRecords, { ...mods._aRecords[0], _idRow: 9999, _aGame: { _idRow: 18925 } }], _aMetadata: { _nRecordCount: 31, _nPerpage: 15 } });
 } });
 const result = await source.list('banana', { ...game, banana: '6762' }, '', 2);
 assert.equal(result.status, 'ready');
 assert.equal(result.items.length, 1);
 assert.equal(result.total, 31);
 assert.equal(result.hasNext, true);
 assert.equal(result.filteredCount, 1);
});
