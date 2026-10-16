const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createModTranslator } = require('../src/mod-translation.cjs');

test('translates prose and requirement notes while preserving original data, code, paths, and names', async () => {
 const calls = [], item = { summary: 'Fallback summary' };
 const detail = {
  description: 'Install this mod.\nCopy example.dll into Mods/Example. Run `npm install`.\n```sh\nrm file\n```\nRead https://example.com/docs.',
  requirements: ['Content Patcher Latest version required'],
  requirementDetails: [{ name: 'Content Patcher', notes: 'Latest version required' }],
 };
 const before = JSON.stringify(detail);
 const translator = createModTranslator((texts, done) => { calls.push(texts); done({ result: 1, text: texts.map(text => '译文:' + text) }); });
 const result = await translator.translate(item, detail);
 assert.match(result.description, /译文:Install this mod\./);
 for (const original of ['example.dll', 'Mods/Example', '`npm install`', '```sh\nrm file\n```', 'https://example.com/docs.']) {
  assert.ok(result.description.includes(original));
  assert.ok(!calls.flat().some(text => text.includes(original)));
 }
 assert.equal(result.requirements[0], 'Content Patcher 译文:Latest version required');
 assert.equal(JSON.stringify(detail), before);
});

test('coalesces concurrent requests and caches by original content rather than mod id', async () => {
 let calls = 0, finish;
 const translator = createModTranslator((texts, done) => { calls++; finish = () => done({ result: 1, text: texts.map(() => '中文介绍') }); });
 const first = translator.translate({}, { description: 'First description' });
 const second = translator.translate({}, { description: 'First description' });
 assert.equal(calls, 1); finish();
 assert.deepEqual(await first, await second);
 await translator.translate({}, { description: 'First description' }); assert.equal(calls, 1);
 const changed = translator.translate({}, { description: 'Updated description' });
 assert.equal(calls, 2); finish(); await changed;
});

test('splits long descriptions into bounded requests and restores line breaks without losing text', async () => {
 const batches = [], description = ('long description '.repeat(1600) + '\n').repeat(2);
 const translator = createModTranslator((texts, done) => { batches.push(texts); done({ result: 1, text: texts }); });
 const result = await translator.translate({}, { description });
 assert.equal(result.description, description);
 for (const texts of batches) {
  assert.ok(texts.length <= 32);
  assert.ok(texts.reduce((sum, text) => sum + text.length, 0) <= 12000);
  assert.ok(texts.every(text => text.length <= 3000));
 }
});

test('skips Chinese-only text and uses summary when full description is missing', async () => {
 let calls = 0;
 const translator = createModTranslator((texts, done) => { calls++; done({ result: 1, text: texts.map(() => '摘要译文') }); });
 assert.deepEqual(await translator.translate({}, { description: '这是中文介绍。', requirements: ['中文前置说明'] }), { description: '这是中文介绍。', requirements: ['中文前置说明'] });
 assert.equal(calls, 0);
 assert.equal((await translator.translate({ summary: 'English summary' }, {})).description, '摘要译文');
});

test('failures and timeouts remain retryable and late responses cannot replace a retry', async () => {
 let succeed = false;
 const translator = createModTranslator((texts, done, fail) => succeed ? done({ result: 1, text: ['重试成功'] }) : fail());
 await assert.rejects(translator.translate({}, { description: 'Retry this' }));
 succeed = true;
 assert.equal((await translator.translate({}, { description: 'Retry this' })).description, '重试成功');
 let oldCallback, count = 0;
 const timed = createModTranslator((texts, done) => { if (++count === 1) oldCallback = done; else done({ result: 1, text: ['新译文'] }); }, { timeoutMs: 10 });
 await assert.rejects(timed.translate({}, { description: 'Slow request' }), /timed out/);
 assert.equal((await timed.translate({}, { description: 'Slow request' })).description, '新译文');
 oldCallback({ result: 1, text: ['迟到的译文'] });
 assert.equal((await timed.translate({}, { description: 'Slow request' })).description, '新译文');
});

test('rejects partial or invalid responses so untranslated paragraphs are never marked complete', async () => {
 const translator = createModTranslator((texts, done) => done({ result: 1, text: [null] }));
 await assert.rejects(translator.translate({}, { description: 'Invalid response' }), /Invalid/);
});

test('list names and summaries share batches without overwriting source names, ids, or search text', async () => {
 const calls = [];
 const items = [
  { id: 'one', name: 'BETTER TEXTURES', summary: 'Install example.dll into Mods/Example.' },
  { id: 'two', name: 'BETTER TEXTURES', summary: 'Install example.dll into Mods/Example.' },
  { id: 'three', name: '中文名称', summary: '中文介绍' },
 ];
 const original = JSON.stringify(items);
 const translator = createModTranslator((texts, done) => { calls.push(texts); done({ result: 1, text: texts.map(text => '译文:' + text) }); });
 const result = await translator.translateList(items);
 assert.equal(calls.length, 1);
 assert.ok(calls[0].includes('BETTER TEXTURES'));
 assert.equal(calls[0].filter(text => text === 'BETTER TEXTURES').length, 1);
 assert.equal(result[0].name, '译文:BETTER TEXTURES');
 assert.equal(result[0].summary, '译文:Install example.dll 译文:into Mods/Example.');
 assert.deepEqual(result[0], result[1]);
 assert.deepEqual(result[2], { name: '中文名称', summary: '中文介绍' });
 assert.equal(JSON.stringify(items), original);
});
