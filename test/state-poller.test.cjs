const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStatePoller, hasActiveWork } = require('../src/state-poller.cjs');

const flush = async () => { for (let n = 0; n < 6; n++) await Promise.resolve(); };
function fixture(options = {}) {
 const visibility = new EventTarget(); visibility.hidden = false;
 const timers = new Map(), calls = [], applied = [];
 let now = 0, id = 0, active = false, suspended = false;
 const poller = createStatePoller({
  visibility,
  schedule(callback, delay) { timers.set(++id, { callback, time: now + delay }); return id; },
  cancel(id) { timers.delete(id); },
  isActive: () => active,
  isPaused: () => suspended,
  read: async signal => { calls.push({ time: now, signal }); return options.read ? options.read(signal) : {}; },
  apply: next => { applied.push(next); options.apply?.(next); },
 });
 const x = { poller, calls, applied, timers, visibility,
  active(value) { active = value; poller.update(); },
  pause(value) { suspended = value; poller.update({ immediate: !value }); },
  hidden(value) { visibility.hidden = value; visibility.dispatchEvent(new Event('visibilitychange')); },
  async advance(ms) {
   const end = now + ms;
   while (true) {
    const due = [...timers].sort((a, b) => a[1].time - b[1].time)[0];
    if (!due || due[1].time > end) break;
    timers.delete(due[0]); now = due[1].time; due[1].callback(); await flush();
   }
   now = end; await flush();
  },
 };
 return x;
}

test('idle state polls slowly and active downloads or SSO keep fast updates', async () => {
 for (const status of ['queued', 'running', 'authorization_required']) assert.ok(hasActiveWork({ jobs: [{ status }] }));
 for (const status of ['connecting', 'waiting', 'reconnecting', 'saving']) assert.ok(hasActiveWork({ nexusSso: { status } }));
 assert.equal(hasActiveWork({ jobs: [{ status: 'completed' }], nexusSso: { status: 'idle' } }), false);
 const x = fixture(); x.poller.start();
 await x.advance(10000); assert.equal(x.calls.length, 0);
 await x.advance(5000); assert.equal(x.calls.length, 1);
 x.active(true); await x.advance(2100); assert.equal(x.calls.length, 4);
 x.active(false); await x.advance(14999); assert.equal(x.calls.length, 4);
 await x.advance(1); assert.equal(x.calls.length, 5); x.poller.stop();
});

test('hidden pages and profile pauses stop requests and resume with an immediate refresh', async () => {
 const x = fixture(); x.active(true); x.poller.start();
 x.hidden(true); await x.advance(60000); assert.equal(x.calls.length, 0);
 x.hidden(false); await x.advance(0); assert.equal(x.calls.length, 1);
 x.pause(true); await x.advance(60000); assert.equal(x.calls.length, 1);
 x.pause(false); await x.advance(0); assert.equal(x.calls.length, 2); x.poller.stop();
});

test('failures back off to one minute and a successful refresh restores the active cadence', async () => {
 let failure = true;
 const x = fixture({ read: async () => { if (failure) throw new Error('offline'); return {}; } });
 x.active(true); x.poller.start();
 await x.advance(700 + 1400 + 2800 + 5600 + 11200 + 22400 + 44800 + 60000);
 assert.deepEqual(x.calls.map((call, index) => call.time - (x.calls[index - 1]?.time || 0)), [700, 1400, 2800, 5600, 11200, 22400, 44800, 60000]);
 failure = false; await x.advance(60000); const count = x.calls.length;
 await x.advance(700); assert.equal(x.calls.length, count + 1); x.poller.stop();
});

test('slow requests never overlap and stopping rejects late responses from the old session', async () => {
 let finish;
 const x = fixture({ read: () => new Promise(resolve => { finish = resolve; }) });
 x.active(true); x.poller.start(); await x.advance(700);
 await x.advance(10000); assert.equal(x.calls.length, 1);
 x.poller.stop(); assert.equal(x.calls[0].signal.aborted, true);
 finish({ owner: 'old-session' }); await flush();
 assert.deepEqual(x.applied, []); assert.equal(x.timers.size, 0);
});

test('quick hide/show retains its immediate refresh while an aborted request settles', async () => {
 let finish, first = true;
 const x = fixture({ read: () => { if (first) { first = false; return new Promise(resolve => { finish = resolve; }); } return {}; } });
 x.poller.start(); await x.advance(15000); x.hidden(true); x.hidden(false);
 assert.equal(x.calls[0].signal.aborted, true);
 finish({ stale: true }); await flush(); await x.advance(0);
 assert.equal(x.calls.length, 2); assert.deepEqual(x.applied, [{}]); x.poller.stop();
});

test('manual refresh replaces an in-flight poll without applying its older snapshot', async () => {
 let finish;
 const x = fixture({ read: () => new Promise(resolve => { finish = resolve; }) });
 x.poller.start(); await x.advance(15000); x.poller.update();
 assert.equal(x.calls[0].signal.aborted, true);
 finish({ stale: true }); await flush(); assert.deepEqual(x.applied, []);
 await x.advance(14999); assert.equal(x.calls.length, 1); x.poller.stop();
});
