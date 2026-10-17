const { test } = require('node:test');
const assert = require('node:assert/strict');
const { piFixture } = require('./pi-fixture.cjs');
const { createDeepSeek } = require('../studio-ai.cjs');
const { selectSkills, readSkillFile, GAME_RULES } = require('../studio-skills.cjs');
const { recordEvent, finishEvents } = require('../studio-events.cjs');
const { readCreationResponse } = require('../studio-mu-client.cjs');

test('routes exact games and engines to bundled Pi skills without treating unknown Unity as Mono', async () => {
 for (const [name, appId, key, expected] of [['Example', '', 'unity-mono', 'bepinex-mono'], ['Example', '', 'unity-il2cpp', 'bepinex-il2cpp'], ['Example', '', 'unity', 'unity-mod-frameworks'], ['Example', '', 'unreal', 'unreal-mod-frameworks'], ['Minecraft', '', 'java', 'minecraft-modding-workbench'], ['Example', '1295660', 'native', 'civ7-modding'], ['Example', '1158310', 'native', 'ck3-modding-expert'], ['星露谷物语', '413150', 'dotnet', 'stardew']]) {
  const selected = selectSkills({ name, appId }, { engine: { key } });
  assert.ok(selected.skills.some(skill => skill.id === expected), name + ':' + key);
  if (key === 'unity') assert.ok(!selected.skills.some(skill => skill.id === 'bepinex-mono'));
  for (const skill of selected.skills) assert.match(await readSkillFile(skill.path), /name:/);
 }
 for (const [, ids] of GAME_RULES) for (const reference of selectSkills({ appId: ids[0] }).references) await readSkillFile(reference.path);
 await assert.rejects(readSkillFile('skills/../package.json'));
 assert.equal(selectSkills({ name: 'Unknown' }).skills.length, 1);
 assert.equal(selectSkills({ name: "Baldur's Gate 2" }).references.length, 0);
 assert.equal(selectSkills({ name: '博德之门 1' }).references.length, 0);
 assert.equal(selectSkills({ name: "Baldur's Gate 3", appId: '9999999' }).references.length, 0);
});
test('real Pi SDK reads selected skills, executes tools and forwards native thinking events', async t => {
 const expected = { title: 'Plan', summary: 'Development plan', kind: 'project-plan', steps: ['Check game APIs'], requirements: [] };
 const fixture = await piFixture(t, { game: { name: 'Unity fixture' }, engine: 'unity-mono', result: expected });
 const ai = createDeepSeek({ apiKey: fixture.key, pi: fixture.pi }), events = [];
 assert.deepEqual(await ai.plan({ prompt: 'Create a mod', context: { game: fixture.game }, diagnostic: fixture.diagnostic, types: [{ id: 'project-plan', available: true }], onEvent: event => events.push(event) }), expected);
 assert.equal(fixture.requests.length, 2); assert.ok(fixture.requests.every(request => request.body.stream === true));
 assert.ok(fixture.requests.every(request => request.body.reasoning_effort === 'low'));
 assert.ok(!fixture.requests[0].body.tools.some(tool => ['run_agent', 'search_api'].includes(tool.function.name)), 'Planning stays bounded to routing and reference inspection');
 assert.ok(events.some(event => event.type === 'thinking_delta' && event.delta.includes('真实')));
 for (const name of ['inspect_game', 'read', 'submit_result']) assert.ok(events.some(event => event.type === 'tool_end' && event.name === name && !event.failed));
 assert.ok(events.some(event => event.type === 'skill_loaded' && event.path.includes('bepinex-mono')));
 assert.equal(events.at(-1).status, 'completed');
});
test('Pi enforces actual skill reads and game inspection before accepting an artifact', async t => {
 const fixture = await piFixture(t, { respond: async ({ step }) => step === 1 ? { calls: [{ name: 'submit_result', arguments: { result: { kind: 'project-plan' } } }] } : step === 2 ? { calls: [] } : null });
 const ai = createDeepSeek({ apiKey: fixture.key, pi: fixture.pi });
 await assert.rejects(ai.plan({ prompt: 'Make mod', types: [{ id: 'project-plan', available: true }] }), { code: 'AI_RESPONSE_FORMAT' });
 assert.ok(fixture.requests[1].body.messages.some(message => message.role === 'tool' && message.content.includes('先检查游戏')));
});
test('specialist delegation creates a second real Pi session and cannot recursively delegate', async t => {
 const events = [];
 const fixture = await piFixture(t, { respond: async ({ body, phase }) => {
  const specialist = body.messages[0].content.includes('# MODDOCK game specialist');
  if (specialist) {
   assert.ok(!body.tools.some(tool => tool.function.name === 'run_agent'));
   return { result: { findings: 'Verified host-supported kinds.', missingEvidence: [] } };
  }
  if (phase === 'submit' && !body.messages.some(message => message.tool_calls?.some(call => call.function.name === 'run_agent'))) return { calls: [{ name: 'run_agent', arguments: { task: 'Review supported game API evidence.' } }] };
  return { result: { title: 'Reviewed plan', kind: 'project-plan', name: 'Reviewed plan', author: 'Fixture', plan: 'Reviewed the supported game API evidence.' } };
 } });
 const ai = createDeepSeek({ apiKey: fixture.key, pi: fixture.pi });
 const result = await ai.generate({ kind: 'project-plan', prompt: 'Write a development plan', types: [{ id: 'project-plan', available: true }], onEvent: event => events.push(event) });
 assert.equal(result.title, 'Reviewed plan'); assert.equal(events.filter(event => event.type === 'agent_start').length, 2);
 assert.ok(events.some(event => event.type === 'tool_end' && event.name === 'run_agent' && !event.failed));
});
test('native Pi cancellation ends active tool/thinking state and bounded traces redact secrets', async t => {
 const fixture = await piFixture(t, { delay: 100 }), controller = new AbortController(), item = {};
 const ai = createDeepSeek({ apiKey: fixture.key, pi: fixture.pi });
 const pending = ai.plan({ prompt: 'Make mod', types: [{ id: 'project-plan', available: true }], signal: controller.signal, onEvent: event => {
  recordEvent(item, event); if (event.type === 'thinking_delta') controller.abort();
 } });
 await assert.rejects(pending, /取消|超时/); finishEvents(item, 'cancelled');
 assert.equal(item.harness.status, 'cancelled'); assert.ok(item.harness.thinking.every(thought => thought.status !== 'running'));
 recordEvent(item, { type: 'thinking_delta', delta: fixture.key }); assert.ok(!JSON.stringify(item).includes(fixture.key));
 for (let i = 0; i < 150; i++) recordEvent(item, { type: 'tool_start', callId: String(i), name: 'read' });
 assert.equal(item.toolCalls.length, 80); assert.equal(item.harness.events.length, 100);
});
test('NDJSON decoding preserves split UTF-8, reports events before completion and rejects truncated streams', async () => {
 const bytes = Buffer.from(JSON.stringify({ type: 'event', event: { type: 'thinking_delta', delta: '游戏' } }) + '\n' + JSON.stringify({ type: 'result', result: { title: '完成' } }) + '\n');
 const events = [], response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
 assert.deepEqual(await readCreationResponse(response, event => events.push(event)), { title: '完成' }); assert.equal(events[0].delta, '游戏');
 await assert.rejects(readCreationResponse(new Response('{"type":"heartbeat"}\n', { headers: { 'Content-Type': 'application/x-ndjson' } })), /未收到完整结果/);
 await assert.rejects(readCreationResponse(new Response('{"type":"error","code":"ai_response_invalid"}\n', { headers: { 'Content-Type': 'application/x-ndjson' } })), { code: 'AI_RESPONSE_FORMAT' });
});
