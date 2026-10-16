const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createModListTranslation } = require('../src/mod-list-translation.cjs');
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

test('list translations batch cards and bound concurrent work while leaving browsing immediate', async () => {
 const pending = [], calls = [], updates = [];
 let active = 0, highest = 0;
 const store = createModListTranslation(items => {
  active++; highest = Math.max(highest, active); calls.push(items);
  return new Promise(resolve => pending.push(() => { active--; resolve(items.map(item => ({ name: '中文' + item.name, summary: '中文简介' }))); }));
 }, { delayMs: 0, onChange: entries => updates.push(...entries) });
 const entries = Array.from({ length: 31 }, (_, index) => store.get({ name: 'Mod ' + index, summary: 'Original summary' }));
 assert.ok(entries.every(entry => entry.status === 'queued'));
 await tick(); assert.equal(calls.length, 2); assert.equal(highest, 2);
 pending.shift()(); await tick();
 assert.equal(calls.length, 3);
 while (pending.length) pending.shift()();
 await tick();
 assert.ok(calls.every(items => items.length <= 12));
 assert.ok(entries.every(entry => entry.status === 'ready'));
 assert.equal(updates.length, 31);
 assert.equal(store.get({ name: 'Mod 0', summary: 'Original summary' }), entries[0]);
 assert.notEqual(store.get({ name: 'Mod 0', summary: 'Changed summary' }), entries[0]);
 store.reset();
});

test('a failed list batch stays in original mode and can retry without refetching the source list', async () => {
 let fail = true, requests = 0;
 const store = createModListTranslation(async items => {
  requests++; if (fail) throw new Error('Offline');
  return items.map(item => ({ name: '中文名', summary: '中文简介' }));
 }, { delayMs: 0 });
 const entry = store.get({ name: 'Original name', summary: 'Original summary' });
 await tick(); assert.equal(entry.status, 'error');
 assert.deepEqual(entry.original, { name: 'Original name', summary: 'Original summary' });
 store.get(entry.original); await tick(); assert.equal(requests, 1);
 fail = false; store.retry(entry.id); await tick();
 assert.equal(entry.status, 'ready'); assert.equal(entry.text.name, '中文名'); assert.equal(requests, 2);
 store.reset();
});

test('account resets ignore late work and never update a replacement card with stale text', async () => {
 const pending = [], updates = [];
 const store = createModListTranslation(items => new Promise(resolve => pending.push(() => resolve(items.map(item => ({ name: '中文', summary: '' }))))), { delayMs: 0, onChange: entries => updates.push(...entries) });
 const old = store.get({ name: 'Same name' }); await tick();
 store.reset();
 const current = store.get({ name: 'Same name' }); await tick();
 assert.notEqual(old.id, current.id);
 pending.shift()(); await tick();
 assert.ok(!updates.includes(old)); assert.equal(current.status, 'loading');
 pending.shift()(); await tick();
 assert.equal(current.status, 'ready'); assert.ok(updates.includes(current));
 store.reset();
});
