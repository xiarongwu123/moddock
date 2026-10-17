const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fixture } = require('./oneclick-fixture.cjs');
const { createServer, loginFixture } = require('./server-fixture.cjs');
const { hasActiveWork } = require('../src/state-poller.cjs');
const pakDirectory = 'ReadyOrNot/Content/Paks';
async function setup(t, options) {
 const x = await fixture(options); t.after(x.close); x.game.appId = '1144200';
 await fs.mkdir(path.join(x.game.installPath, pakDirectory), { recursive: true });
 await fs.writeFile(path.join(x.game.installPath, pakDirectory, 'original-mod.pak'), 'original');
 return x;
}

test('installation progress follows real extraction, backups and writes; success alone reaches 100', async t => {
 const x = await setup(t);
 const job = await x.job([{ name: 'Release/original-mod.pak', data: 'modded' }, { name: 'Release/new.pak', data: 'new' }]);
 const samples = [], id = randomUUID();
 const result = await x.engine.progress.run(job, 'owner', id, report => x.engine.installAuto(x.game, job.id, {}, (...args) => {
  report(...args); samples.push(x.engine.progress.view('owner'));
 }));
 assert.equal(result.jobId, job.id);
 for (const phase of ['inspect', 'matching', 'extracting', 'checking', 'backup', 'installing', 'finishing']) assert.ok(samples.some(sample => sample.phase === phase), phase);
 assert.ok(samples.some(sample => sample.total > 0 && sample.file));
 assert.ok(samples.every((sample, index) => sample.percent < 100 && (!index || sample.percent >= samples[index - 1].percent)));
 const progress = x.engine.view([x.game], 'owner').progress;
 assert.equal(progress.id, id); assert.equal(progress.percent, 100); assert.equal(progress.status, 'completed');
 assert.equal(x.engine.view([x.game], 'someone-else').progress, null);
 assert.equal(Object.hasOwn(progress, 'owner'), false);
 assert.equal(await fs.readFile(path.join(x.game.installPath, pakDirectory, 'original-mod.pak'), 'utf8'), 'modded');
});

test('write failures publish rollback and retain a failed result without claiming completion', async t => {
 const x = await setup(t, { afterWrite: async () => { throw new Error('fixture disk failure'); } });
 const job = await x.job([{ name: 'Release/original-mod.pak', data: 'modded' }]);
 const phases = [];
 await assert.rejects(x.engine.progress.run(job, 'owner', undefined, report => x.engine.installAuto(x.game, job.id, {}, (...args) => { phases.push(args[0]); report(...args); })), /已回滚/);
 assert.ok(phases.includes('rollback'));
 const progress = x.engine.progress.view('owner');
 assert.equal(progress.status, 'failed'); assert.ok(progress.percent < 100); assert.match(progress.message, /已回滚/);
 assert.equal(await fs.readFile(path.join(x.game.installPath, pakDirectory, 'original-mod.pak'), 'utf8'), 'original');
 assert.equal(x.engine.state.mods.length, 0);
});

test('state API exposes in-flight progress and rejects duplicate install requests without replacing the task', async t => {
 const x = await setup(t);
 let release, entered;
 const blocked = new Promise(resolve => { release = resolve; });
 const started = new Promise(resolve => { entered = resolve; });
 const service = await createServer({ root: path.join(x.root, 'api'), port: 0, scan: async () => ({ games: [x.game], roots: [], diagnostics: [] }),
  installers: { processes: async () => [], afterWrite: async () => { entered(); await blocked; } } });
 t.after(async () => { release(); await new Promise(resolve => service.server.close(resolve)); });
 const job = await x.job([{ name: 'Release/original-mod.pak', data: 'modded' }]);
 const directory = path.join(service.downloads.root, job.id); await fs.mkdir(directory);
 await fs.copyFile(job.path, path.join(directory, job.filename)); service.downloads.jobs.push(job);
 const auth = await loginFixture(service), id = randomUUID();
 const post = body => auth.fetch(service.url + '/api/installations/auto', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': auth.state.token }, body: JSON.stringify(body) });
 const pending = post({ jobId: job.id, operationId: id });
 await Promise.race([started, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('installation never reached write')), 10000); timer.unref(); })]);
 const state = await auth.fetch(service.url + '/api/state').then(response => response.json());
 assert.equal(state.installations.progress.id, id); assert.equal(state.installations.progress.status, 'running');
 assert.equal(state.installations.progress.phase, 'installing'); assert.ok(state.installations.progress.percent < 100);
 assert.ok(hasActiveWork(state));
 const duplicate = await post({ jobId: job.id, operationId: randomUUID() });
 assert.equal(duplicate.status, 400); assert.match((await duplicate.json()).error, /正在处理安装/);
 assert.equal(service.installers.progress.view('fixture-user').id, id);
 release(); assert.equal((await pending).status, 200);
 const completed = await auth.fetch(service.url + '/api/state').then(response => response.json());
 assert.equal(completed.installations.progress.percent, 100); assert.equal(completed.installations.progress.status, 'completed');
 assert.equal(hasActiveWork(completed), false);
});

test('hash failure leaves files untouched and allows a later install to start', async t => {
 const x = await setup(t);
 const job = await x.job([{ name: 'Release/new.pak', data: 'new' }]), originalHash = job.sha256;
 job.sha256 = '0'.repeat(64);
 await assert.rejects(x.engine.progress.run(job, 'owner', undefined, report => x.engine.installAuto(x.game, job.id, {}, report)), /校验失败/);
 assert.equal(x.engine.progress.view('owner').status, 'failed'); assert.equal(x.engine.state.mods.length, 0);
 job.sha256 = originalHash;
 await x.engine.progress.run(job, 'owner', undefined, report => x.engine.installAuto(x.game, job.id, {}, report));
 assert.equal(x.engine.progress.view('owner').percent, 100);
});
