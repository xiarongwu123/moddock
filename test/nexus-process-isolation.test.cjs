const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const { setTimeout: wait } = require('node:timers/promises');
const { Sources } = require('../sources.cjs');
const { NexusBrowserClient } = require('../platform/nexus-browser-client.cjs');
const { createNexusService } = require('../platform/nexus-service.cjs');
const token = 'a'.repeat(64), bytes = Buffer.from('independent-file-transfer');
async function until(predicate) { for (let n = 0; n < 500; n++) { if (await predicate()) return; await wait(10); } throw new Error('Process isolation state timed out'); }
async function stop(child, signal = 'SIGTERM') { if (child.exitCode !== null || child.signalCode !== null) return; const ended = new Promise(resolve => child.once('exit', resolve)); child.kill(signal); await ended; }
async function fixture(t, options = {}) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-isolation-')), socketPath = process.platform === 'win32' ? '\\\\.\\pipe\\moddock-test-' + crypto.randomUUID() : path.join(root, 'browser.sock'), children = [];
 const browser = new NexusBrowserClient({ socketPath, retry: 30, initialize: channel => channel.request('import') });
 const sources = new Sources(); sources.connect('nexus', 'fixture-backend-key');
 sources.downloadFile = async (_game, _resource, _file, grant) => {
  if (!grant) throw Object.assign(new Error('Browser authorization needed'), { code: 'NEXUS_NXM_REQUIRED' });
  assert.equal(grant.key, 'fixture-grant');
  return { name: 'fixture.zip', size: bytes.length, _url: 'https://premium-files.nexus-cdn.com/fixture.zip' };
 };
 const service = await createNexusService({ root, sources, authorizer: browser, verification: browser, accessToken: token, requireOwner: true, health: () => browser.status(), fetch: options.fetch || (async () => new Response(bytes)) });
 t.after(async () => { await service.close(); browser.close(); for (const child of children) await stop(child); await fs.rm(root, { recursive: true, force: true }); });
 async function spawn() {
  const child = fork(path.join(__dirname, 'browser-process-fixture.cjs'), [socketPath], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }); children.push(child);
  let stderr = ''; child.stderr.on('data', data => { stderr = (stderr + data).slice(-1000); });
  await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); child.once('exit', code => reject(new Error('Browser fixture exited ' + code + ': ' + stderr))); });
  await until(() => browser.ready); return child;
 }
 const call = (route, init = {}, owner = 'alice') => fetch(service.url + route, { ...init, headers: { Authorization: 'Bearer ' + token, 'X-Mu-Account-Id': owner, 'Content-Type': 'application/json' } });
 async function start(fileId = '5') {
  const response = await call('/jobs', { method: 'POST', body: JSON.stringify({ domain: 'stardewvalley', modId: '99', fileId }) }); assert.equal(response.status, 202);
  const job = await response.json(); await until(async () => (await (await call('/jobs/' + job.id)).json()).verificationRequired); return job;
 }
 async function complete(job) {
  const frame = await (await call('/jobs/' + job.id + '/verification')).json();
  assert.equal((await call('/jobs/' + job.id + '/verification/click', { method: 'POST', body: JSON.stringify({ revision: frame.revision, x: 40, y: 50 }) })).status, 200);
  await until(() => service.downloads.jobs.find(item => item.id === job.id).status === 'completed');
 }
 return { root, socketPath, browser, service, spawn, call, start, complete };
}

test('authorization and verification cross a private socket without exposing grants or bypassing owner checks', async t => {
 const x = await fixture(t); await x.spawn(); const job = await x.start();
 if (process.platform !== 'win32') assert.equal((await fs.stat(x.socketPath)).mode & 0o777, 0o600);
 assert.equal((await x.call('/jobs/' + job.id + '/verification', {}, 'bob')).status, 404);
 const frame = await (await x.call('/jobs/' + job.id + '/verification')).json(); assert.equal(frame.width, 200);
 await x.complete(job);
 const response = await x.call('/jobs/' + job.id + '/file'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
 assert.equal(x.service.downloads.jobs[0].sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
 const history = await fs.readFile(path.join(x.root, 'downloads/history.json'), 'utf8'); assert.ok(!history.includes('fixture-grant')); assert.ok(!history.includes(frame.image));
});

test('a browser process crash leaves the API and cached files alive, fails affected authorization and reconnects cleanly', async t => {
 const x = await fixture(t), child = await x.spawn(), cached = await x.start(); await x.complete(cached);
 const waiting = await x.start('6'), stale = await (await x.call('/jobs/' + waiting.id + '/verification')).json();
 await stop(child, 'SIGKILL'); await until(() => !x.browser.ready && x.service.downloads.jobs.find(job => job.id === waiting.id).status === 'failed');
 const status = await x.call('/status'); assert.equal(status.status, 200); assert.equal((await status.json()).browserReady, false);
 const failed = await (await x.call('/jobs/' + waiting.id)).json(); assert.match(failed.message, /授权浏览器正在恢复/);
 assert.deepEqual(Buffer.from(await (await x.call('/jobs/' + cached.id + '/file')).arrayBuffer()), bytes);
 assert.equal((await x.call('/jobs/' + waiting.id + '/verification/click', { method: 'POST', body: JSON.stringify({ revision: stale.revision, x: 40, y: 50 }) })).status, 409);
 await x.spawn(); const next = await x.start('7');
 assert.equal((await x.call('/jobs/' + next.id + '/verification/click', { method: 'POST', body: JSON.stringify({ revision: stale.revision, x: 40, y: 50 }) })).status, 409);
 await x.complete(next); assert.equal(x.service.downloads.jobs.find(job => job.id === waiting.id).status, 'failed');
});

test('a file transfer already authorized continues when the browser process is killed', async t => {
 let release;
 const x = await fixture(t, { fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 5)); release = () => { controller.enqueue(bytes.subarray(5)); controller.close(); }; } })) });
 const child = await x.spawn(), job = await x.start(), frame = await (await x.call('/jobs/' + job.id + '/verification')).json();
 assert.equal((await x.call('/jobs/' + job.id + '/verification/click', { method: 'POST', body: JSON.stringify({ revision: frame.revision, x: 40, y: 50 }) })).status, 200);
 await until(() => x.service.downloads.jobs[0].bytes === 5 && x.browser.entries.size === 0);
 await stop(child, 'SIGKILL'); await until(() => !x.browser.ready);
 assert.equal((await x.call('/status')).status, 200); assert.equal(x.service.downloads.jobs[0].status, 'running');
 release(); await until(() => x.service.downloads.jobs[0].status === 'completed');
 assert.deepEqual(await fs.readFile(x.service.downloads.jobs[0].path), bytes);
});

test('the API starts and serves status while the authorization browser is absent', async t => {
 const x = await fixture(t), response = await x.call('/status');
 assert.equal(response.status, 200); const status = await response.json(); assert.equal(status.ready, true); assert.equal(status.browserReady, false);
 await x.spawn(); assert.equal((await (await x.call('/status')).json()).browserReady, true);
});
