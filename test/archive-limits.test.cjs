const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { LIMITS, assertSize, checkArchiveEntry } = require('../archive-limits.cjs');
const { Installers, extract, hash } = require('../installers.cjs');
const { Downloads } = require('../downloads.cjs');
const { zip } = require('./zip-fixture.cjs');
const GiB = 1024 ** 3;

async function temp(t) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-archive-limits-'));
 t.after(() => fs.rm(root, { recursive: true, force: true }));
 return root;
}

test('large archive metadata accepts former size/count limits and exact new boundaries', () => {
 const entry = { fileName: 'textures/large.pak', uncompressedSize: 8 * GiB, compressedSize: GiB };
 assert.doesNotThrow(() => checkArchiveEntry(entry, 32 * GiB, 12001));
 assert.doesNotThrow(() => checkArchiveEntry({ ...entry, uncompressedSize: LIMITS.fileBytes }, LIMITS.extractedBytes, LIMITS.entries));
 assert.doesNotThrow(() => checkArchiveEntry({ ...entry, uncompressedSize: 2000 * 1024, compressedSize: 1024 }, 2000 * 1024, 1));
 assert.doesNotThrow(() => assertSize(LIMITS.downloadBytes, LIMITS.downloadBytes, '下载文件体积', 'large.zip'));
});

test('each archive limit names the offending file, actual value and limit', () => {
 const entry = { fileName: 'textures/large.pak', uncompressedSize: 8 * GiB, compressedSize: GiB };
 const cases = [
  [{ ...entry, uncompressedSize: LIMITS.fileBytes + 1 }, LIMITS.fileBytes + 1, 1, '单文件解压体积', String(LIMITS.fileBytes + 1), '128 GiB'],
  [entry, LIMITS.extractedBytes + 1, 3, '累计解压体积', String(LIMITS.extractedBytes + 1), '256 GiB'],
  [entry, 8 * GiB, LIMITS.entries + 1, '条目数', '200001', '200000'],
  [{ ...entry, uncompressedSize: 2001 * 1024, compressedSize: 1024 }, 2001 * 1024, 1, '文件膨胀倍数', '2001.00 倍', '2000 倍']
 ];
 for (const [item, bytes, count, kind, actual, limit] of cases) {
  assert.throws(() => checkArchiveEntry(item, bytes, count), error => {
   for (const text of [kind, entry.fileName, actual, limit]) assert.ok(error.message.includes(text), error.message);
   return true;
  });
 }
 assert.throws(() => checkArchiveEntry({ fileName: 'last-folder/' }, 0, LIMITS.entries + 1), /条目数超限.*last-folder\//);
});

test('a real ZIP above the former 500x ratio installs and restores with CRC validation', async t => {
 const root = await temp(t), game = { id: 'test', installPath: path.join(root, 'game') };
 await fs.mkdir(game.installPath);
 const data = Buffer.alloc(2 * 1024 ** 2), file = path.join(root, 'large.zip');
 const bytes = zip([{ name: 'large.bin', data, deflate: true }]);
 assert.ok(data.length / bytes.length > 500);
 await fs.writeFile(file, bytes);
 const job = { id: 'job', gameId: game.id, status: 'completed', name: 'Large fixture', sha256: await hash(file) };
 const engine = await new Installers(root, { jobs: [job], completedFile: async () => ({ file, name: 'large.zip' }) }, { processes: async () => [] }).open();
 await engine.setProfile(game, { mode: 'copy', destination: 'Mods' });
 const plan = await engine.prepare(game, job.id), installed = await engine.apply(game, plan.id);
 assert.deepEqual(await fs.readFile(path.join(game.installPath, 'Mods/large.bin')), data);
 await engine.action(game, installed.id, 'uninstall');
 await assert.rejects(fs.access(path.join(game.installPath, 'Mods/large.bin')), /ENOENT/);
 const broken = Buffer.from(bytes), central = broken.indexOf(Buffer.from('504b0102', 'hex'));
 broken.writeUInt32LE((broken.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16);
 await fs.writeFile(file, broken);
 await assert.rejects(extract(file, path.join(root, 'broken')), /CRC/);
});

test('real ZIP extraction permits more than 12000 directory entries', async t => {
 const root = await temp(t), file = path.join(root, 'many.zip');
 await fs.writeFile(file, zip([...Array.from({ length: 12001 }, (_, i) => ({ name: `folder-${i}/` })), { name: 'payload.bin' }]));
 const entries = await extract(file, path.join(root, 'stage'));
 assert.deepEqual(entries.map(entry => entry.source), ['payload.bin']);
 assert.equal(await fs.readFile(path.join(root, 'stage/payload.bin'), 'utf8'), 'fixture');
});

test('malformed ZIP ratio reports the file through the install API and cleans staging', async t => {
 const { createServer, loginFixture } = require('./server-fixture.cjs');
 const root = await temp(t), game = { id: 'test', name: 'Archive fixture', installPath: path.join(root, 'game') };
 await fs.mkdir(game.installPath);
 const service = await createServer({ root: path.join(root, 'data'), port: 0, scan: async () => ({ games: [game], roots: [], diagnostics: [] }), installers: { processes: async () => [] } });
 t.after(() => new Promise(resolve => service.server.close(resolve)));
 const bytes = zip([{ name: 'textures/suspicious.pak', data: 'fixture', deflate: true }]);
 const central = bytes.indexOf(Buffer.from('504b0102', 'hex'));
 bytes.writeUInt32LE(1, central + 20);
 bytes.writeUInt32LE(4 * 1024 ** 2, central + 24);
 const id = crypto.randomUUID(), directory = path.join(service.downloads.root, id), file = path.join(directory, 'large.zip');
 await fs.mkdir(directory); await fs.writeFile(file, bytes);
 service.downloads.jobs.push({ id, gameId: game.id, resourceId: 'local:archive-fixture', source: 'local', name: 'Archive fixture', filename: 'large.zip', status: 'completed', sha256: await hash(file) });
 const auth = await loginFixture(service);
 const response = await auth.fetch(service.url + '/api/installations/auto', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': auth.state.token }, body: JSON.stringify({ jobId: id })
 });
 assert.equal(response.status, 400);
 const result = await response.json();
 for (const text of ['文件膨胀倍数超限', 'textures/suspicious.pak', '4194304.00 倍', '2000 倍']) assert.ok(result.error.includes(text), result.error);
 assert.deepEqual(await fs.readdir(game.installPath), []);
 assert.deepEqual(await fs.readdir(path.join(service.installers.root, 'inspect')), []);
 assert.equal(service.installers.plans.size, 0);
});

test('6 GiB reported package and target sizes pass the full install/disable/enable/uninstall path', async t => {
 const root = await temp(t), game = { id: 'test', installPath: path.join(root, 'game') };
 await fs.mkdir(path.join(game.installPath, 'Mods'), { recursive: true });
 const target = path.join(game.installPath, 'Mods/large.pak'), file = path.join(root, 'large.zip');
 await fs.writeFile(target, 'original');
 await fs.writeFile(file, zip([{ name: 'large.pak', data: 'modded' }]));
 const stat = fs.stat, lstat = fs.lstat;
 t.mock.method(fs, 'stat', async (...args) => { const result = await stat(...args); if (args[0] === file) result.size = 6 * GiB; return result; });
 t.mock.method(fs, 'lstat', async (...args) => { const result = await lstat(...args); if (args[0] === target) result.size = 6 * GiB; return result; });
 const job = { id: 'job', gameId: game.id, status: 'completed', name: 'Large fixture', sha256: await hash(file) };
 const engine = await new Installers(root, { jobs: [job], completedFile: async () => ({ file, name: 'large.zip' }) }, { processes: async () => [] }).open();
 await engine.setProfile(game, { mode: 'copy', destination: 'Mods' });
 const plan = await engine.prepare(game, job.id), installed = await engine.apply(game, plan.id, true);
 assert.equal(await fs.readFile(target, 'utf8'), 'modded');
 await engine.action(game, installed.id, 'disable');
 assert.equal(await fs.readFile(target, 'utf8'), 'original');
 await engine.action(game, installed.id, 'enable');
 assert.equal(await fs.readFile(target, 'utf8'), 'modded');
 await engine.action(game, installed.id, 'uninstall');
 assert.equal(await fs.readFile(target, 'utf8'), 'original');
});

async function download(t, file) {
 const root = await temp(t), sources = { downloadFile: async () => file };
 const engine = await new Downloads(root, sources).open();
 const job = { id: crypto.randomUUID(), name: 'Large fixture', game: { id: 'test' }, status: 'queued', bytes: 0 };
 engine.jobs.push(job);
 await engine.run(job, new AbortController());
 return { engine, job };
}

test('downloads accept source estimates above the former 5 GiB limit', async t => {
 const { job } = await download(t, { name: 'large.zip', size: 6 * GiB, sizeExact: false, _open: async () => new Response('fixture') });
 assert.equal(job.status, 'completed', job.message);
 assert.equal(await fs.readFile(job.path, 'utf8'), 'fixture');
});

test('download metadata, response length and streamed bytes each report the new size limit', async t => {
 let opened = false;
 const metadata = await download(t, { name: 'large.zip', size: LIMITS.downloadBytes + 1, _open: async () => { opened = true; } });
 assert.equal(opened, false);
 let cancelled = false;
 const headers = await download(t, { name: 'large.zip', _open: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-length': String(LIMITS.downloadBytes + 1) } }) });
 assert.equal(cancelled, true);
 const streamed = await download(t, { name: 'large.zip', _open: async () => ({ ok: true, status: 200, headers: new Headers(), body: (async function* () { yield { length: LIMITS.downloadBytes + 1 }; })() }) });
 for (const { engine, job } of [metadata, headers, streamed]) {
  assert.equal(job.status, 'failed');
  for (const text of ['下载文件体积超限', 'large.zip', String(LIMITS.downloadBytes + 1), '128 GiB']) assert.ok(job.message.includes(text), job.message);
  assert.equal(job.path, undefined);
  await assert.rejects(fs.access(path.join(engine.root, job.id + '.part')), /ENOENT/);
 }
});
