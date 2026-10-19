const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const root = process.env.MODDOCK_TEST_ROOT || __dirname;
const { StudioConversations } = require(path.join(root, 'studio-conversations.cjs'));
const { describeError } = require(path.join(root, 'studio-errors.cjs'));
async function fixture(t) {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-persist-'));
 t.after(() => fs.rm(dir, { recursive: true, force: true }));
 const studio = { directory: () => dir, recordPath() {} };
 const conversations = new StudioConversations(studio);
 const item = { id: '745eaae4-6c44-40c4-8f3b-47e67e41c2d7', gameId: 'game', status: 'generating', messages: [{ role: 'user', content: 'create mod' }], planningAttempts: [] };
 await conversations.persist('owner', item);
 return { dir, studio, conversations, item, file: conversations.file('owner', item.id) };
}
test('real Windows file lock: original writer fails; fixed writer preserves old JSON and retries replacement', async t => {
 const x = await fixture(t);
 const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$s=[IO.File]::Open($env:MODDOCK_LOCK_FILE,'Open','Read','Read'); [Console]::WriteLine('locked'); [Console]::Out.Flush(); [Console]::ReadLine() | Out-Null; $s.Dispose()"], { env: { ...process.env, MODDOCK_LOCK_FILE: x.file }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
 t.after(() => child.kill());
 await once(child.stdout, 'data');
 const tmp = x.file + '.original-test';
 await fs.writeFile(tmp, '{}');
 await assert.rejects(fs.rename(tmp, x.file), e => ['EPERM', 'EACCES', 'EBUSY'].includes(e.code));
 await fs.rm(tmp);
 const old = await fs.readFile(x.file, 'utf8');
 x.item.title = 'recovered';
 const pending = x.conversations.persist('owner', x.item);
 await delay(180);
 assert.equal(await fs.readFile(x.file, 'utf8'), old);
 child.stdin.end('\n');
 await pending;
 assert.equal(JSON.parse(await fs.readFile(x.file, 'utf8')).title, 'recovered');
 assert.deepEqual((await fs.readdir(path.dirname(x.file))).filter(n => n.endsWith('.tmp')), []);
});
test('permanent disk error retains cause, original JSON and removes temporary file', async t => {
 const x = await fixture(t), rename = fs.rename;
 t.after(() => { fs.rename = rename; });
 const old = await fs.readFile(x.file, 'utf8');
 fs.rename = async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
 await assert.rejects(x.conversations.persist('owner', x.item), e => e.code === 'STUDIO_PERSIST_FAILED' && e.cause.code === 'ENOSPC');
 assert.equal(await fs.readFile(x.file, 'utf8'), old);
 assert.deepEqual((await fs.readdir(path.dirname(x.file))).filter(n => n.endsWith('.tmp')), []);
});
test('concurrent checkpoints leave complete readable JSON', async t => {
 const x = await fixture(t);
 await Promise.all(Array.from({ length: 40 }, (_, i) => x.conversations.persist('owner', { ...x.item, checkpoint: i })));
 assert.equal((await x.conversations.read('owner', { id: 'game' }, x.item.id)).checkpoint, 39);
});
test('checkpoint failure aborts generation with storage diagnosis and original cause, not cancelled/timeout', async t => {
 const x = await fixture(t), rename = fs.rename;
 t.after(() => { fs.rename = rename; });
 const controller = new AbortController();
 x.studio.options = {
  plan: async () => ({ title: 'Test', summary: 'Test', steps: ['Make'], kind: 'engine-mod' }),
  generate: async payload => {
   fs.rename = async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
   payload.onEvent({ type: 'thinking_start', agent: 'test' });
   return new Promise((resolve, reject) => payload.signal.addEventListener('abort', () => { fs.rename = rename; reject(new Error('downstream abort')); }, { once: true }));
  }
 };
 x.studio.workspace = async () => ({ diagnostic: { engine: { name: 'Unreal' }, loaders: [], integration: {}, warnings: [] }, context: { guide: { path: 'guide' }, notes: [] }, types: [{ id: 'engine-mod', available: true }] });
 x.studio.toolchain = { environment: async () => ({}) };
 await x.conversations.run('owner', { id: 'game' }, x.item, controller, () => true);
 const saved = JSON.parse(await fs.readFile(x.file, 'utf8'));
 assert.equal(saved.status, 'failed');
 assert.equal(saved.diagnostic.stage, 'persistence');
 assert.equal(saved.diagnostic.category, 'storage');
 assert.equal(saved.diagnostic.code, 'STUDIO_PERSIST_FAILED');
 assert.match(saved.diagnostic.reason, /ENOSPC/);
 assert.equal(saved.diagnostic.reason.includes('超时'), false);
});
test('user cancellation remains cancellation', async t => {
 const x = await fixture(t), controller = new AbortController();
 controller.abort(); x.studio.options = {};
 await x.conversations.run('owner', { id: 'game' }, x.item, controller, () => true);
 assert.equal(x.item.status, 'cancelled');
 assert.notEqual(x.item.diagnostic.category, 'timeout');
 assert.equal(describeError(Object.assign(new Error('创作超过 15 分钟，已停止'), { code: 'STUDIO_TIMEOUT' })).code, 'STUDIO_TIMEOUT');
});
