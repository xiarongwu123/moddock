const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createMuStudioAI, readCreationResponse } = require('../studio-mu-client.cjs');

function interrupted(frames, error) {
 let sent = false;
 return new Response(new ReadableStream({ pull(controller) {
  if (sent) controller.error(error);
  else { sent = true; controller.enqueue(Buffer.from(frames.map(frame => JSON.stringify(frame) + '\n').join(''))); }
 } }, { highWaterMark: 0 }), { headers: { 'Content-Type': 'application/x-ndjson' } });
}

test('desktop disables QUIC before app readiness or network initialization', async () => {
 const entry = path.resolve(__dirname, '../electron.cjs'), calls = [], localRequire = createRequire(entry);
 const app = { commandLine: { appendSwitch: name => calls.push(name) }, requestSingleInstanceLock: () => true, on() {},
  whenReady() { calls.push('ready'); return new Promise(() => {}); } };
 vm.runInNewContext(await fs.readFile(entry, 'utf8'), { require: name => name === 'electron' ? { app } : localRequire(name), __dirname: path.dirname(entry), process });
 assert.deepEqual(calls, ['disable-quic', 'ready']);
});

test('QUIC interruption reconnects the same task without duplicating received thinking', async () => {
 let calls = 0; const events = [];
 let taskId;
 const ai = createMuStudioAI(async (_owner, _route, init) => {
  calls++;
  const { delivery } = JSON.parse(init.body); taskId ||= delivery.id; assert.equal(delivery.id, taskId);
  const frames = [{ type: 'task', id: taskId, version: 1 }, { type: 'event', seq: 1, event: { type: 'thinking_delta', delta: 'Checking the game API' } }];
  if (calls === 1) return interrupted(frames, new Error('net::ERR_QUIC_PROTOCOL_ERROR'));
  assert.equal(delivery.after, 1);
  return new Response(frames.concat({ type: 'result', seq: 2, result: { code: 'complete' } }).map(frame => JSON.stringify(frame) + '\n').join(''), { headers: { 'Content-Type': 'application/x-ndjson' } });
 }, { retryDelay: 1 });
 assert.deepEqual(await ai.generate({ prompt: 'Make a mod', onEvent: event => events.push(event) }), { code: 'complete' });
 assert.equal(calls, 2); assert.equal(events.filter(event => event.type === 'thinking_delta').length, 1);
 assert.ok(events.some(event => event.type === 'connection' && event.status === 'reconnecting'));
});

test('a fully received result survives QUIC failure while closing the stream', async () => {
 const result = { kind: 'ue4ss-lua', name: 'Reviving enemies', code: 'print("ready")' };
 assert.deepEqual(await readCreationResponse(interrupted([{ type: 'result', result }], new Error('net::ERR_QUIC_PROTOCOL_ERROR'))), result);
});

test('partial result JSON is never accepted as a completed artifact', async () => {
 let sent = false;
 const response = new Response(new ReadableStream({ pull(controller) {
  if (sent) controller.error(new TypeError('terminated', { cause: { code: 'UND_ERR_SOCKET' } }));
  else { sent = true; controller.enqueue(Buffer.from('{"type":"result","result":{"code":"partial')); }
 } }, { highWaterMark: 0 }), { headers: { 'Content-Type': 'application/x-ndjson' } });
 await assert.rejects(readCreationResponse(response), { code: 'STUDIO_CONNECTION_INTERRUPTED' });
});

test('clean EOF without a result gives the same resumable error', async () => {
 await assert.rejects(readCreationResponse(new Response('{"type":"heartbeat"}\n', { headers: { 'Content-Type': 'application/x-ndjson' } })), { code: 'STUDIO_CONNECTION_INTERRUPTED' });
});

test('cancellation does not turn a received result into successful completion', async () => {
 const controller = new AbortController(), reason = new Error('User cancelled');
 const response = interrupted([{ type: 'result', result: { name: 'discard' } }], reason);
 controller.abort(reason);
 await assert.rejects(readCreationResponse(response, undefined, controller.signal), error => error === reason);
});

test('invalid frames and provider errors still reject after a result', async () => {
 const headers = { 'Content-Type': 'application/x-ndjson' }, result = '{"type":"result","result":{"name":"candidate"}}\n';
 await assert.rejects(readCreationResponse(new Response(result + '{"type":"result","result":{}}\n', { headers })), /重复返回/);
 await assert.rejects(readCreationResponse(new Response(result + '{"type":"error","code":"ai_response_invalid"}\n', { headers })), { code: 'AI_RESPONSE_FORMAT' });
 await assert.rejects(readCreationResponse(new Response(result + 'invalid\n', { headers })), SyntaxError);
});
