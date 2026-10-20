const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createStudioService } = require('./ai-ledger-fixture.cjs');
const { createMuStudioAI } = require('../studio-mu-client.cjs');
const { cleanDiagnostic, describeError } = require('../studio-errors.cjs');
const { createDeepSeek } = require('../studio-ai.cjs');
const { piFixture } = require('./pi-fixture.cjs');
const { createProgressPublisher } = require('../platform/studio-progress.cjs');
const token = 'a'.repeat(64), headers = { Authorization: 'Bearer ' + token, 'X-Mu-Account-Id': 'alice', Accept: 'application/x-ndjson' };
const payload = { harness: 'pi-agent', prompt: 'Make a real mod', kind: 'ue4ss-lua' };
async function fixture(t, ai, options = {}) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-resume-test-'));
 const service = await createStudioService({ ai, accessToken: token, taskDirectory: root, ...options });
 t.after(async () => { await service.close(); await fs.rm(root, { recursive: true, force: true }); });
 return { ...service, root, request: (route, init) => fetch(service.url + '/' + route, { ...init, method: 'POST', headers }) };
}
const body = (id, after = 0, operation = 'subscribe', content = payload) => JSON.stringify({ ...content, delivery: { version: 1, id, after, operation } });
async function frames(response) { return (await response.text()).trim().split('\n').map(line => JSON.parse(line)); }

test('disconnect after a code checkpoint resumes the same worker and deduplicates progress', async t => {
 let calls = 0, requests = 0; const events = [], cursors = [];
 const x = await fixture(t, { generate: async ({ checkpoint, onEvent, signal }) => {
  calls++; await checkpoint({ name: 'main.lua', text: 'print("actual saved code")' });
  onEvent({ type: 'thinking_delta', delta: 'Keep this exact progress' });
  await new Promise(resolve => setTimeout(resolve, 60)); assert(!signal.aborted);
  return { kind: 'ue4ss-lua', code: 'print("actual saved code")' };
 } });
 const ai = createMuStudioAI(async (_owner, route, init) => {
  const delivery = JSON.parse(init.body).delivery; cursors.push({ id: delivery.id, after: delivery.after });
  const response = await x.request(route, init);
  if (++requests !== 1) return response;
  const reader = response.body.getReader(); let cut = false;
  return new Response(new ReadableStream({ async pull(controller) {
   if (cut) { await reader.cancel(); controller.error(new Error('net::ERR_QUIC_PROTOCOL_ERROR')); return; }
   const chunk = await reader.read(); if (chunk.done) { controller.close(); return; }
   cut = new TextDecoder().decode(chunk.value).includes('"seq":1'); controller.enqueue(chunk.value);
  } }, { highWaterMark: 0 }), { headers: response.headers });
 }, { retryDelay: 2 });
 const result = await ai.generate({ ...payload, onEvent: event => events.push(event) });
 assert.equal(calls, 1); assert.equal(result.code, 'print("actual saved code")');
 assert.equal(new Set(cursors.map(item => item.id)).size, 1); assert(cursors.some(item => item.after === 1));
 assert.equal(events.filter(event => event.type === 'thinking_delta').length, 1);
 const job = [...x.tasks.jobs.values()][0];
 assert.equal(await fs.readFile(path.join(job.folder, 'project/main.lua'), 'utf8'), result.code);
 assert.equal(job.metadata.status, 'completed');
});

test('lost initial acknowledgement and repeated subscriptions do not start another model run', async t => {
 let calls = 0, requests = 0, original;
 const x = await fixture(t, { generate: async () => { calls++; return { code: 'completed once' }; } }, { hourlyLimit: 1 });
 const ai = createMuStudioAI(async (_owner, route, init) => {
  const response = await x.request(route, init);
  original ||= init.body;
  if (++requests === 1) { await response.body.cancel(); throw Object.assign(new Error('Connection reset before response'), { code: 'ECONNRESET' }); }
  return response;
 }, { retryDelay: 2 });
 assert.equal((await ai.generate({ ...payload, onEvent() {} })).code, 'completed once'); assert.equal(calls, 1);
 const job = [...x.tasks.jobs.values()][0];
 for (let attempt = 0; attempt < 4; attempt++) assert((await frames(await x.request('generate', { body: original }))).some(frame => frame.type === 'result'));
 assert.equal(calls, 1);
});

test('server rotates subscriptions while keeping one active generation and saved sequence', async t => {
 let calls = 0, subscriptions = 0;
 const x = await fixture(t, { generate: async ({ onEvent }) => { calls++; onEvent({ type: 'thinking_delta', delta: 'once' }); await new Promise(resolve => setTimeout(resolve, 90)); return { code: 'done' }; } }, { taskLease: 15 });
 const ai = createMuStudioAI((_owner, route, init) => { subscriptions++; return x.request(route, init); }, { retryDelay: 1 });
 assert.equal((await ai.generate({ ...payload, onEvent() {} })).code, 'done'); assert.equal(calls, 1); assert(subscriptions > 1);
});

test('explicit user cancellation cancels the independent worker and persists a terminal event', async t => {
 let stopped, entered;
 const started = new Promise(resolve => { entered = resolve; }), ended = new Promise(resolve => { stopped = resolve; });
 const x = await fixture(t, { generate: async ({ signal }) => { entered(); await new Promise((_, reject) => signal.addEventListener('abort', () => { stopped(); reject(signal.reason); }, { once: true })); } });
 const controller = new AbortController(), ai = createMuStudioAI((_owner, route, init) => x.request(route, init), { retryDelay: 1 });
 const pending = ai.generate({ ...payload, signal: controller.signal, onEvent() {} });
 const rejected = assert.rejects(pending); await started; controller.abort(); await rejected; await ended;
 await Promise.allSettled([...x.tasks.runs]);
 assert.equal([...x.tasks.jobs.values()][0].frames.at(-1).code, 'studio_cancelled');
});

test('a cancellation arriving before submission creates a tombstone and never runs the model', async t => {
 let calls = 0; const id = crypto.randomUUID();
 const x = await fixture(t, { generate: async () => { calls++; return {}; } });
 assert.deepEqual(await (await x.request('generate', { body: body(id, 0, 'cancel') })).json(), { cancelled: true });
 assert.equal((await frames(await x.request('generate', { body: body(id) }))).at(-1).code, 'studio_cancelled'); assert.equal(calls, 0);
});

test('reusing a task id with different content fails without regenerating', async t => {
 let calls = 0; const id = crypto.randomUUID();
 const x = await fixture(t, { generate: async () => { calls++; return { code: 'original' }; } });
 assert.equal((await frames(await x.request('generate', { body: body(id) }))).at(-1).type, 'result');
 const changed = await frames(await x.request('generate', { body: body(id, 0, 'subscribe', { ...payload, prompt: 'different' }) }));
 assert.equal(changed.at(-1).code, 'invalid_request'); assert.equal(calls, 1);
});

test('task identity is bound to its original owner and cannot replay another account code', async t => {
 const id = crypto.randomUUID();
 const x = await fixture(t, { generate: async ({ accountId }) => ({ owner: accountId }) });
 await frames(await x.request('generate', { body: body(id) }));
 const response = await fetch(x.url + '/generate', { method: 'POST', body: body(id), headers: { ...headers, 'X-Mu-Account-Id': 'bob' } });
 assert.equal((await frames(response)).at(-1).code, 'invalid_request');
});

test('completed code and progress replay after service restart with no provider invocation', async t => {
 let calls = 0; const id = crypto.randomUUID();
 const x = await fixture(t, { generate: async () => { calls++; return { code: 'durable result' }; } });
 await frames(await x.request('generate', { body: body(id) })); await x.close();
 const restarted = await createStudioService({ ai: { generate: async () => { calls++; throw new Error('Must not run'); } }, accessToken: token, taskDirectory: x.root });
 t.after(() => restarted.close());
 const replay = await frames(await fetch(restarted.url + '/generate', { method: 'POST', body: body(id), headers }));
 assert.equal(replay.at(-1).result.code, 'durable result'); assert.equal(calls, 1);
});

test('expired tasks retain identity tombstones and never generate replacement code', async t => {
 let calls = 0; const id = crypto.randomUUID();
 const x = await fixture(t, { generate: async () => { calls++; return { code: 'old result' }; } }, { taskRetention: 1 });
 await frames(await x.request('generate', { body: body(id) })); await Promise.allSettled([...x.tasks.runs]); await new Promise(resolve => setTimeout(resolve, 10)); await x.tasks.prune();
 const replay = await frames(await x.request('generate', { body: body(id) })); assert.equal(replay.at(-1).code, 'studio_task_expired'); assert.equal(calls, 1);
});

test('real Pi failures expose a trace and actual model reason while masking credentials', async t => {
 const pi = await piFixture(t, { respond: () => ({ status: 402 }) });
 const x = await fixture(t, createDeepSeek({ apiKey: pi.key, pi: pi.pi }));
 const ai = createMuStudioAI((_owner, route, init) => x.request(route, init), { retryDelay: 1 });
 let failure;
 await assert.rejects(ai.plan({ prompt: 'Make mod', types: [{ id: 'project-plan', available: true }], onEvent() {} }), error => { failure = error; return true; });
 assert(failure.taskFailure); assert.equal(failure.diagnostic.stage, 'model'); assert.match(failure.diagnostic.reason, /402|isolated fixture failure/);
 assert.match(failure.diagnostic.traceId, /^[a-f0-9-]{36}$/); assert.doesNotMatch(JSON.stringify(failure.diagnostic), /sk-isolated|Bearer/);
 const files = await fs.readdir(path.join(x.root, 'logs')); const log = await fs.readFile(path.join(x.root, 'logs', files[0]), 'utf8');
 assert.match(log, /model/); assert.match(log, /402|isolated fixture failure/); assert.doesNotMatch(log, /sk-isolated|Bearer/);
});

test('diagnostics redact credentials, signed URLs and nested transport secrets', () => {
 const message = 'HTTP 429 api_key="private value" password=private sk-abcdefghijk Bearer access-secret https://user:pass@example.test/error?token=hidden#secret';
 const text = cleanDiagnostic(message); assert.doesNotMatch(text, /private value|private |sk-abcdefghijk|access-secret|user:pass|hidden|#secret/);
 const diagnostic = describeError(new Error('fetch failed', { cause: { code: 'ECONNRESET' } }), 'transport');
 assert.equal(diagnostic.category, 'network'); assert.match(diagnostic.reason, /ECONNRESET/);
});
test('terminal submission errors retain their exact stage and saved source without restarting generation', async t => {
 const code = 'return 42', events = [];
 const pi = await piFixture(t, { result: { kind: 'ue4ss-lua', name: 'Saved source', code } });
 const x = await fixture(t, createDeepSeek({ apiKey: pi.key, pi: pi.pi }));
 const ai = createMuStudioAI((_owner, route, init) => x.request(route, init), { retryDelay: 1 });
 let failure;
 await assert.rejects(ai.generate({ ...payload, onEvent: event => events.push(event) }), error => { failure = error; return true; });
 assert.equal(failure.diagnostic.stage, 'tool:submit_result'); assert.match(failure.diagnostic.reason, /author/);
 assert.equal(events.filter(event => event.type === 'agent_start').length, 1);
 assert.equal(events.filter(event => event.type === 'tool_start' && event.name === 'write_project_file').length, 1);
 const folders = await fs.readdir(x.root); let checkpoint;
 for (const folder of folders) if (/^[a-f0-9]{64}$/.test(folder)) checkpoint = await fs.readFile(path.join(x.root, folder, 'project/main.lua'), 'utf8');
 assert.equal(checkpoint, code);
});

test('Pi preserves compiled source and stops retries when provider failure leaves usage unresolved', async t => {
 let interrupted = false, writes = 0; const events = [];
 const draft = { kind: 'ue4ss-lua', name: 'SDK retry fixture', author: 'Fixture', description: 'A real compiled Lua artifact', code: 'local count=0\nLoopAsync(500,function() count=count+1 return false end)' };
 const pi = await piFixture(t, { engine: 'unreal', result: draft, respond: ({ phase }) => {
  if (phase === 'submit' && !interrupted) { interrupted = true; return { status: 503 }; }
  return null;
 } });
 const ai = createDeepSeek({ apiKey: pi.key, pi: { ...pi.pi, retrySettings: { enabled: true, maxRetries: 2, baseDelayMs: 1, maxAgentDelayMs: 2 } } });
 await assert.rejects(ai.generate({ ...payload, diagnostic: pi.diagnostic, context: { game: pi.game }, checkpoint: async () => { writes++; }, onEvent: event => events.push(event) }), error => error.code === 'ai_quota_unconfigured' && error.diagnostic.upstreamStatus === 503);
 assert(interrupted); assert.equal(writes, 1);
 assert.equal(pi.pi.metering.ledger.quota('fixture-user').reconciliationRequired, true);
 assert.equal(events.filter(event => event.type === 'tool_start' && event.name === 'write_project_file').length, 1);
});

test('token-heavy thinking preserves all text without exhausting the event channel', () => {
 const events = [], publisher = createProgressPublisher(event => events.push(event));
 for (let index = 0; index < 16000; index++) publisher.publish({ type: 'thinking_delta', agent: 'creator', delta: 'x' });
 publisher.publish({ type: 'tool_start', name: 'write_project_file' }); publisher.close();
 assert.equal(events.filter(event => event.type === 'thinking_delta').map(event => event.delta).join(''), 'x'.repeat(16000));
 assert(events.length <= 12); assert.equal(events.at(-1).type, 'tool_start');
 assert(Buffer.byteLength(JSON.stringify(events)) < 20000);
});

test('Pi accepts a bounded JSON-encoded result object without another generation', async t => {
 const expected = { title: 'Encoded result', kind: 'project-plan', summary: 'Validated metadata', steps: ['Inspect APIs'], requirements: [] };
 const pi = await piFixture(t, { respond: ({ phase }) => phase === 'submit' ? { result: JSON.stringify(expected) } : null });
 const ai = createDeepSeek({ apiKey: pi.key, pi: pi.pi });
 assert.deepEqual(await ai.plan({ prompt: 'Write a development plan', types: [{ id: 'project-plan', available: true }] }), expected);
 assert.equal(pi.requests.length, 2);
});

test('completed task cache stays bounded while older results remain replayable', async t => {
 let calls = 0; const ids = [];
 const x = await fixture(t, { generate: async () => { calls++; return { code: 'retained on disk' }; } });
 for (let index = 0; index < 23; index++) {
  const id = crypto.randomUUID(); ids.push(id); await frames(await x.request('generate', { body: body(id) })); await Promise.allSettled([...x.tasks.runs]);
 }
 assert(x.tasks.jobs.size <= 20);
 assert.equal((await frames(await x.request('generate', { body: body(ids[0]) }))).at(-1).result.code, 'retained on disk'); assert.equal(calls, 23);
});
