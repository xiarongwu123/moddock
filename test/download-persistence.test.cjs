const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { Downloads } = require('../downloads.cjs');
test('download history retries transient Windows replacement locks and serializes the newest complete state', async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'download-history-lock-')); t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 3 }));
 const downloads = await new Downloads(root, {}).open(), rename = fs.rename; let calls = 0;
 t.after(() => { fs.rename = rename; });
 fs.rename = async (...args) => { if (args[1] === path.join(downloads.root, 'history.json') && ++calls <= 2) throw Object.assign(new Error('temporary fixture lock'), { code: calls === 1 ? 'EPERM' : 'EBUSY' }); return rename(...args); };
 downloads.jobs = [{ id: 'first', status: 'completed' }]; const first = downloads.save();
 downloads.jobs = [{ id: 'latest', status: 'completed' }]; const latest = downloads.save();
 await Promise.all([first, latest]); assert.equal(calls, 4);
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(downloads.root, 'history.json'), 'utf8')), downloads.jobs);
});
test('non-transient history failures preserve the previous record and a later save recovers the queue', async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'download-history-fail-')); t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 3 }));
 const downloads = await new Downloads(root, {}).open(), rename = fs.rename; let calls = 0;
 t.after(() => { fs.rename = rename; });
 fs.rename = async (...args) => { if (args[1] === path.join(downloads.root, 'history.json')) { calls++; throw Object.assign(new Error('fixture disk failure'), { code: 'ENOSPC' }); } return rename(...args); };
 downloads.jobs = [{ id: 'retained-in-memory', status: 'completed' }]; await assert.rejects(downloads.save(), { code: 'ENOSPC' }); assert.equal(calls, 1);
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(downloads.root, 'history.json'), 'utf8')), []);
 fs.rename = rename; await downloads.save(); assert.deepEqual(JSON.parse(await fs.readFile(path.join(downloads.root, 'history.json'), 'utf8')), downloads.jobs);
});
