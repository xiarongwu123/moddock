const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runInNewContext } = require('node:vm');
const first = { pending: true, revision: '11111111-1111-4111-8111-111111111111', width: 600, height: 200, image: 'data:image/png;base64,dGVzdA==' };
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
 let poll, read = 0, resolveRefresh, deadline;
 const events = {}, clicks = [], image = { style: {}, dataset: {}, getBoundingClientRect: () => ({ left: 10, top: 20, width: 600, height: 200 }), setPointerCapture() {}, addEventListener: (name, handler) => { events[name] = handler; } }, status = {}, zoom = { value: '1', addEventListener() {} };
 const placeholder = {}, picture = { dataset: {} }, reconnect = {};
 const dialog = { querySelector: selector => selector === 'img' ? image : selector === 'select' ? zoom : selector === '.verification-status' ? status : selector === '.verification-placeholder' ? placeholder : selector === '.verification-picture' ? picture : selector === '[data-reconnect]' ? { addEventListener: (_name, handler) => { reconnect.click = handler; } } : {}, querySelectorAll: () => [], addEventListener() {}, showModal() {}, close() {}, remove() {} };
 const source = fs.readFileSync(path.join(__dirname, '../public/nexus-verification.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export function', 'function');
 const context = { document: { createElement: () => dialog, body: { appendChild() {} } }, Image: class { async decode() {} }, AbortController, setTimeout: callback => { deadline = callback; return 1; }, clearTimeout() {}, setInterval: callback => { poll = callback; return 1; }, clearInterval() {} };
 runInNewContext(source + '\nglobalThis.make = createNexusVerification;', context);
 const api = options.api || (async (route, input) => {
  if (route.endsWith('-click')) { clicks.push(input); return { ok: true }; }
  if (++read === 2) return new Promise(resolve => { resolveRefresh = resolve; });
  return first;
 });
 const ui = context.make({ api, toast() {} }); ui.open({ id: 'local-job', name: 'Test control' });
 return { ui, image, clicks, events, status, placeholder, reconnect, timeout: () => deadline(), refresh: () => poll(), completeRefresh: frame => resolveRefresh(frame) };
}
test('a user click is sent while a slower verification picture refresh is in flight', async t => {
 const x = fixture(); t.after(() => x.ui.reset()); await flush(); x.refresh(); await flush();
 await x.events.click({ clientX: 310, clientY: 120, stopPropagation() {} });
 assert.equal(x.clicks.length, 1); assert.equal(x.clicks[0].revision, first.revision); assert.equal(x.clicks[0].x, 300); assert.equal(x.clicks[0].y, 100);
 x.completeRefresh({ ...first, revision: '22222222-2222-4222-8222-222222222222' }); await flush();
});
test('an unresponsive frame request times out visibly and reconnect can recover without a new download', async t => {
 let calls = 0, signal;
 const x = fixture({ api: async (_route, _body, options) => { calls++; signal = options.signal; return calls === 1 ? new Promise(() => {}) : first; } });
 t.after(() => x.ui.reset());
 x.timeout(); await flush();
 assert.equal(signal.aborted, true); assert.match(x.status.textContent, /超时/); assert.equal(x.placeholder.hidden, false);
 x.reconnect.click({ stopPropagation() {} }); await flush();
 assert.equal(calls, 2); assert.equal(x.image.hidden, false); assert.equal(x.placeholder.hidden, true);
});
test('closing the verification dialog cancels its pending request', async () => {
 let signal;
 const x = fixture({ api: async (_route, _body, options) => { signal = options.signal; return new Promise(() => {}); } });
 x.ui.reset(); await flush(); assert.equal(signal.aborted, true);
});
test('pointer press retains the displayed frame and coordinates through a background refresh', async t => {
 const x = fixture(); t.after(() => x.ui.reset()); await flush(); x.refresh(); await flush();
 x.events.pointerdown({ button: 0, pointerId: 1 });
 x.completeRefresh({ ...first, revision: '22222222-2222-4222-8222-222222222222', width: 300, height: 100 }); await flush();
 await x.events.click({ clientX: 310, clientY: 120, stopPropagation() {} });
 assert.equal(x.clicks[0].revision, first.revision); assert.equal(x.clicks[0].x, 300); assert.equal(x.clicks[0].y, 100);
});
