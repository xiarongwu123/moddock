const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { NexusAuthorizer } = require('../nexus-authorization.cjs');
const page = id => `https://www.nexusmods.com/stardewvalley/mods/99?tab=files&file_id=${id}&nmm=1`;
class Window extends EventEmitter {
 constructor() { super(); this.webContents = new EventEmitter(); this.webContents.getURL = () => this.url; this.webContents.executeJavaScript = async () => this.result || { state: 'waiting' }; this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler; }; this.shown = 0; this.closed = false; }
 async loadURL(url) { this.url = url; }
 isDestroyed() { return this.closed; }
 show() { this.shown++; }
 focus() {}
 close() { this.closed = true; this.emit('closed'); }
}
function fixture(t) {
 const windows = [], grants = [], states = [];
 const authorizer = new NexusAuthorizer({ isAllowed: url => new URL(url).hostname === 'www.nexusmods.com', createWindow: () => { const window = new Window(); windows.push(window); return window; }, receive: async grant => grants.push(grant) });
 t.after(() => authorizer.close());
 const context = (owner, jobId) => ({ owner, jobId, isCurrent: () => true, onState: state => states.push({ jobId, state }) });
 return { authorizer, windows, grants, states, context };
}
test('authorization is serialized, duplicate requests reuse the current file, and successful grants close the window', async t => {
 const x = fixture(t); await x.authorizer.open(page(5), x.context('alice', 'a')); await x.authorizer.open(page(6), x.context('alice', 'b')); await x.authorizer.open(page(5), x.context('alice', 'a'));
 assert.equal(x.windows.length, 1); assert.equal(x.authorizer.queue.length, 1);
 await x.authorizer.accept(x.authorizer.active, 'nxm://file-one'); assert.deepEqual(x.grants, ['nxm://file-one']); assert.equal(x.windows[0].closed, true); assert.equal(x.windows.length, 2); assert.equal(x.windows[1].url, page(6));
});
test('login and site verification are surfaced, and cancellation prevents stale account callbacks', async t => {
 const x = fixture(t); const context = x.context('alice', 'a'); let current = true; context.isCurrent = () => current;
 await x.authorizer.open(page(5), context); x.windows[0].result = { state: 'login_required' }; await x.authorizer.drive(x.authorizer.active); assert.equal(x.windows[0].shown, 1);
 x.windows[0].result = { state: 'verification_required' }; await x.authorizer.drive(x.authorizer.active); assert.equal(x.windows[0].shown, 2);
 const stale = x.authorizer.active; current = false; await x.authorizer.drive(stale); await x.authorizer.accept(stale, 'nxm://stale'); assert.equal(x.grants.length, 0); assert.equal(x.authorizer.active, null); assert.equal(x.windows[0].closed, true);
});
test('cancelling a queued file leaves the current authorization intact and closing the window cancels its owner queue', async t => {
 const x = fixture(t); await x.authorizer.open(page(5), x.context('alice', 'a')); await x.authorizer.open(page(6), x.context('alice', 'b'));
 x.authorizer.cancel('alice', 'b'); assert.equal(x.authorizer.queue.length, 0); assert.equal(x.windows[0].closed, false);
 await x.authorizer.open(page(7), x.context('alice', 'c')); x.windows[0].close(); assert.equal(x.authorizer.active, null); assert.equal(x.authorizer.queue.length, 0); assert.equal(x.windows.length, 1);
});
test('only a validated manager-download file page can start an authorization', async t => {
 const x = fixture(t); for (const url of [page(5).replace('&nmm=1', ''), page(5).replace('www.nexusmods.com', 'evil.test'), page(5).replace('file_id=5', 'file_id=0')]) await assert.rejects(x.authorizer.open(url), /无效/);
 assert.equal(x.windows.length, 0);
});
test('different backend jobs for the same file retain separate authorization callbacks', async t => {
 const x = fixture(t); let first = 0, second = 0;
 await x.authorizer.open(page(5), { ...x.context('platform', 'first'), receive: async () => first++ });
 await x.authorizer.open(page(5), { ...x.context('platform', 'second'), receive: async () => second++ });
 assert.equal(x.authorizer.queue.length, 1); await x.authorizer.accept(x.authorizer.active, 'nxm://first'); await x.authorizer.accept(x.authorizer.active, 'nxm://second');
 assert.equal(first, 1); assert.equal(second, 1); assert.equal(x.windows.length, 2);
});
test('a crashed renderer fails its job and advances the queue without accepting a stale grant', async t => {
 const x = fixture(t); await x.authorizer.open(page(5), x.context('platform', 'first')); await x.authorizer.open(page(6), x.context('platform', 'second'));
 const crashed = x.authorizer.active; x.windows[0].webContents.emit('render-process-gone', {}, { reason: 'crashed' });
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(x.windows[0].closed, true); assert.equal(x.authorizer.active.context.jobId, 'second'); assert.equal(x.authorizer.queue.length, 0);
 assert.ok(x.states.some(item => item.jobId === 'first' && item.state === 'failed'));
 assert.ok(!x.states.some(item => item.jobId === 'second' && item.state === 'cancelled'));
 await x.authorizer.accept(crashed, 'nxm://stale'); await x.authorizer.accept(x.authorizer.active, 'nxm://second');
 assert.deepEqual(x.grants, ['nxm://second']);
});
test('a rejected file grant does not block the next authorization', async t => {
 const x = fixture(t);
 await x.authorizer.open(page(5), { ...x.context('platform', 'first'), receive: async () => { throw new Error('Grant rejected'); } });
 await x.authorizer.open(page(6), x.context('platform', 'second'));
 await x.authorizer.accept(x.authorizer.active, 'nxm://invalid');
 assert.equal(x.authorizer.active.context.jobId, 'second'); assert.equal(x.windows[0].closed, true);
 await x.authorizer.accept(x.authorizer.active, 'nxm://second'); assert.deepEqual(x.grants, ['nxm://second']);
});
test('a failed page load closes its window and releases the authorization slot', async t => {
 const states = [], window = new Window(); window.loadURL = async () => { throw new Error('Renderer unavailable'); };
 const authorizer = new NexusAuthorizer({ isAllowed: () => true, createWindow: () => window }); t.after(() => authorizer.close());
 await authorizer.open(page(5), { onState: state => states.push(state) });
 assert.equal(authorizer.active, null); assert.equal(window.closed, true); assert.ok(states.includes('failed'));
});
