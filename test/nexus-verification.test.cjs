const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NexusVerification, verificationRegion } = require('../platform/nexus-verification.cjs');
const { runInNewContext } = require('node:vm');

function fixture() {
 const events = [], region = { x: 100, y: 200, width: 320, height: 160 };
 let attached = false;
 const entry = { context: { jobId: 'alice-job', isCurrent: () => true }, state: 'verification_required', window: {
  isDestroyed: () => false, show() {}, focus() {}, webContents: { focus() {}, executeJavaScript: async () => ({ ...region }), debugger: { isAttached: () => attached, attach() { attached = true; }, detach() { attached = false; }, async sendCommand(method, event) { assert.equal(method, 'Input.dispatchMouseEvent'); events.push(event); } }, capturePage: async captured => { assert.deepEqual(captured, region); return { toPNG: () => Buffer.from('test-picture'), getSize: () => ({ width: 640, height: 320 }) }; } },
 } };
 const authorizer = { active: entry }, verification = new NexusVerification(authorizer);
 return { verification, authorizer, entry, region, events };
}
test('verification exposes only the current job and maps a user click to its cropped picture', async () => {
 const x = fixture(); assert.deepEqual(await x.verification.view('bob-job'), { pending: false });
 const frame = await x.verification.view('alice-job'); assert.equal(frame.pending, true);
 assert.equal(await x.verification.click('bob-job', { revision: frame.revision, x: 100, y: 100 }), false);
 assert.equal(await x.verification.click('alice-job', { revision: frame.revision, x: 320, y: 160 }), true);
 assert.deepEqual(x.events.map(event => [event.type, event.x, event.y]), [['mouseMoved', 260, 280], ['mousePressed', 260, 280], ['mouseReleased', 260, 280]]);
 assert.equal(x.entry.window.webContents.debugger.isAttached(), false);
 assert.equal(await x.verification.click('alice-job', { revision: frame.revision, x: 320, y: 160 }), false);
});
test('expired, out-of-bounds, changed-page and completed-job clicks cannot reach the browser', async () => {
 const x = fixture(), frame = await x.verification.view('alice-job');
 for (const point of [{ x: -1, y: 0 }, { x: 640, y: 0 }, { x: 0, y: 320 }, { x: 0.5, y: 0 }]) assert.equal(await x.verification.click('alice-job', { revision: frame.revision, ...point }), false);
 x.region.y++; assert.equal(await x.verification.click('alice-job', { revision: frame.revision, x: 0, y: 0 }), false); x.region.y--;
 x.verification.frames.get(frame.revision).expires = 0; assert.equal(await x.verification.click('alice-job', { revision: frame.revision, x: 0, y: 0 }), false);
 const fresh = await x.verification.view('alice-job'); x.entry.state = 'submitted';
 assert.deepEqual(await x.verification.view('alice-job'), { pending: false }); assert.equal(await x.verification.click('alice-job', { revision: fresh.revision, x: 0, y: 0 }), false); assert.deepEqual(x.events, []);
});
test('a challenge becoming unavailable during capture cannot publish a stale picture', async () => {
 const x = fixture(); x.entry.window.webContents.capturePage = async () => { x.authorizer.active = null; return { toPNG: () => Buffer.from('private-page'), getSize: () => ({ width: 640, height: 320 }) }; };
 assert.deepEqual(await x.verification.view('alice-job'), { pending: false });
});
test('navigation to a normal page during capture discards the picture', async () => {
 const x = fixture(); let calls = 0; x.entry.window.webContents.executeJavaScript = async () => ++calls === 1 ? { ...x.region } : null;
 assert.deepEqual(await x.verification.view('alice-job'), { pending: false }); assert.equal(x.verification.frames.size, 0);
});
test('a regular Nexus page is not exposed as a full verification screenshot', () => {
 const document = { body: { innerText: 'My account\nVerify you are human\nDownload' }, querySelector: () => ({}), querySelectorAll: () => [] };
 assert.equal(runInNewContext(`(${verificationRegion.toString()})()`, { document, URL, innerWidth: 1100, innerHeight: 850 }), null);
 const challenge = { body: { innerText: 'www.nexusmods.com\nPerforming security verification' }, querySelector: () => null, querySelectorAll: () => [] };
 const region = runInNewContext(`(${verificationRegion.toString()})()`, { document: challenge, URL, innerWidth: 1100, innerHeight: 850 });
 assert.equal(region.width, 1100); assert.equal(region.height, 850);
});
test('a visible verification iframe is cropped even on an otherwise full challenge page', () => {
 const frame = { src: 'https://challenges.cloudflare.com/widget', getClientRects: () => [{}], getBoundingClientRect: () => ({ left: 100, top: 300, right: 400, bottom: 365 }) };
 const document = { body: { innerText: 'Performing security verification' }, querySelector: () => null, querySelectorAll: selector => selector === 'iframe' ? [frame] : [] };
 const region = runInNewContext(`(${verificationRegion.toString()})()`, { document, URL, innerWidth: 1100, innerHeight: 850, getComputedStyle: () => ({ visibility: 'visible' }) });
 assert.equal(region.x, 100); assert.equal(region.y, 300); assert.equal(region.width, 300); assert.equal(region.height, 65);
});
test('native input restores window and web contents focus before sending mouse events', async () => {
 const x = fixture(), order = [], frame = await x.verification.view('alice-job');
 x.entry.window.show = () => order.push('show'); x.entry.window.focus = () => order.push('window-focus'); x.entry.window.webContents.focus = () => order.push('contents-focus');
 x.entry.window.webContents.debugger.sendCommand = async (_method, event) => order.push(event.type);
 assert.equal(await x.verification.click('alice-job', { revision: frame.revision, x: 0, y: 0 }), true);
 assert.deepEqual(order, ['show', 'window-focus', 'contents-focus', 'mouseMoved', 'mousePressed', 'mouseReleased']);
});
