const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAuthoringWorkspace } = require('../studio-authoring.cjs');
const { search, isReadyOrNot } = require('../studio-game-api.cjs');
const { createDeepSeek } = require('../studio-ai.cjs');
const { piFixture } = require('./pi-fixture.cjs');
const { deliverableFor } = require('../studio-intent.cjs');

test('authoring requires actual compiled source and removes its isolated files on close', async t => {
 const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'authoring-contract-'));
 t.after(() => fs.rm(directory, { recursive: true, force: true }));
 const workspace = await createAuthoringWorkspace({ kind: 'ue4ss-lua', directory });
 t.after(() => workspace.close());
 for (const name of ['../escape', '/main.lua', 'a/../main.lua', 'NUL.lua', 'helper.lua']) await assert.rejects(workspace.write(name, 'return 1'));
 await assert.rejects(workspace.artifact({ kind: 'ue4ss-lua', code: 'print(1)' }), /先写入/);
 await workspace.write('main.lua', 'local broken = function(');
 const failed = await workspace.validate(); assert.equal(failed.passed, false); assert.match(failed.results[0].detail, /Moddock:1/);
 const code = 'error("compile only; never execute")'; await workspace.write('main.lua', code);
 assert.equal((await workspace.validate()).passed, true);
 assert.equal((await workspace.artifact({ kind: 'ue4ss-lua' })).code, code);
 await assert.rejects(workspace.artifact({ code: 'return 1' }), /不一致/);
 await workspace.write('main.lua', 'return 2'); await assert.rejects(workspace.artifact({}), /重新编译/);
 await workspace.close(); assert.deepEqual(await fs.readdir(directory), []);
});
test('game API lookup isolates Ready or Not signatures while sharing documented UE4SS APIs', async () => {
 const game = { name: '严阵以待', appId: '1144200' };
 assert.equal(isReadyOrNot({ ...game, appId: '123' }), false);
 for (const query of ['DecreaseHealth', 'PlayDead', 'StopPlayingDead', 'IsStandalone', 'GetCurrentHealth', 'SuspectCharacter']) {
  const result = await search(game, query); assert.ok(result.matches.some(entry => entry.path.includes(query) || entry.signature.includes(query)), query);
  assert.equal(result.runtimeVerified, false); assert.ok(result.matches.every(entry => entry.line > 0 && entry.source.endsWith('.hpp') || /^https:\/\/(?:docs\.ue4ss\.com|github\.com\/UE4SS-RE\/RE-UE4SS)\//.test(entry.source)));
 }
 assert.equal((await search({ name: 'Other game' }, 'PlayDead')).matches.length, 0);
 assert.ok((await search({ name: 'Other game' }, 'RegisterHook')).matches.some(entry => entry.path === 'UE4SS.RegisterHook'));
 for (const query of ['RegisterHook', 'RemoteUnrealParam', 'IsA', 'GetKismetSystemLibrary', 'ExecuteInGameThread']) {
  const result = await search(game, query); assert.ok(result.matches.some(entry => entry.path.startsWith('UE4SS.') && entry.signature.includes(query === 'IsA' ? 'IsA' : query === 'RemoteUnrealParam' ? 'param:' : query)), query);
 }
});
test('native Pi writes, reads compiler errors, edits and compiles before submitting an executable artifact', async t => {
 const code = 'local value = 42\nreturn value';
 const events = [], fixture = await piFixture(t, { engine: 'unreal', respond: async ({ phase, body }) => {
  const calls = body.messages.flatMap(message => message.tool_calls || []);
  if (phase === 'author') return { calls: [{ name: 'write_project_file', arguments: { path: 'main.lua', text: 'local value = function(' } }, { name: 'validate_project', arguments: {} }] };
  if (phase === 'submit' && calls.filter(call => call.function.name === 'validate_project').length === 1) {
   assert.ok(body.messages.some(message => message.role === 'tool' && message.content.includes('"passed":false')));
   return { calls: [{ name: 'write_project_file', arguments: { path: 'main.lua', text: code } }, { name: 'read_project_file', arguments: { path: 'main.lua' } }, { name: 'validate_project', arguments: {} }] };
  }
  return { result: { kind: 'ue4ss-lua', name: 'Actual source', author: 'Fixture' } };
 } });
 const ai = createDeepSeek({ apiKey: fixture.key, pi: fixture.pi });
 const result = await ai.generate({ kind: 'ue4ss-lua', prompt: 'Implement a real script', capability: { deliverable: 'mod' }, context: { game: fixture.game }, diagnostic: fixture.diagnostic, onEvent: event => events.push(event) });
 assert.equal(result.code, code);
 assert.equal(events.filter(event => event.type === 'tool_end' && event.name === 'validate_project').length, 2);
 assert.ok(events.some(event => event.type === 'tool_end' && event.name === 'write_project_file'));
});
test('document delivery requires an explicit request and cannot replace a requested Mod in Pi', async t => {
 for (const prompt of ['制作一个 Mod', '不要开发方案，开发出来', '生成可安装的 Mod，不要方案']) assert.equal(deliverableFor(prompt), 'mod');
 for (const prompt of ['先给我一份开发方案，做人物 Mod', 'Create a development plan for a quest']) assert.equal(deliverableFor(prompt), 'plan');
 const fixture = await piFixture(t, { respond: async ({ phase }) => phase === 'submit' ? { calls: [{ name: 'submit_result', arguments: { result: { kind: 'project-plan' } } }] } : null });
 const { invokePi } = await import('../platform/studio-pi.mjs');
 await assert.rejects(invokePi({ apiKey: fixture.key, ...fixture.pi, instruction: 'Create an actual Mod.', system: '', payload: { capability: { deliverable: 'mod' } }, context: {} }));
 assert.ok(fixture.requests.some(request => request.body.messages.some(message => message.role === 'tool' && message.content.includes('不能用开发方案'))));
});
test('BG3 can submit metadata after writing and compiling source without repeating that source in the final JSON', async t => {
 const code = 'local host = Osi.GetHostCharacter()\nif host then Osi.SetHitpoints(host, 20, "") end';
 const game = { name: 'BG3', appId: '1086940' };
 const fixture = await piFixture(t, { game, result: { kind: 'bg3-lua', name: 'Heal', author: 'Fixture', controls: [], code }, respond: async ({ phase }) => phase === 'submit' ? { result: { kind: 'bg3-lua', name: 'Heal', author: 'Fixture', controls: [] } } : null });
 const result = await createDeepSeek({ apiKey: fixture.key, pi: fixture.pi }).generate({ kind: 'bg3-lua', prompt: 'Heal the host', context: { game }, capability: { deliverable: 'mod' } });
 assert.equal(result.code, code);
});
test('submission metadata is repaired in the same session without regenerating compiled code', async t => {
 const code = 'local count = 42\nreturn count', events = [], checkpoints = [];
 let submissions = 0;
 const fixture = await piFixture(t, { engine: 'unreal', result: { code }, respond: async ({ phase, body }) => {
  if (phase !== 'submit') return null;
  submissions++;
  if (submissions === 4) assert.ok(body.messages.some(message => message.role === 'tool' && message.content.includes('description')));
  return { result: { kind: 'ue4ss-lua', ...(submissions === 1 ? {} : { name: 'Existing code' }), ...(submissions === 2 ? {} : { author: 'Fixture' }), ...(submissions === 3 ? { description: 'x'.repeat(241) } : {}) } };
 } });
 const draft = await createDeepSeek({ apiKey: fixture.key, pi: fixture.pi }).generate({ kind: 'ue4ss-lua', prompt: 'Keep the compiled code', diagnostic: fixture.diagnostic,
  onEvent: event => events.push(event), checkpoint: file => checkpoints.push(file) });
 assert.equal(draft.code, code); assert.equal(submissions, 4);
 assert.equal(events.filter(event => event.type === 'agent_start').length, 1);
 assert.equal(events.filter(event => event.type === 'tool_start' && event.name === 'inspect_game').length, 1);
 assert.equal(events.filter(event => event.type === 'tool_start' && event.name === 'write_project_file').length, 1);
 assert.equal(events.filter(event => event.type === 'tool_start' && event.name === 'validate_project').length, 1);
 assert.deepEqual(checkpoints.map(file => file.text), [code]);
});
test('a premature assistant stop continues the existing session with its compiled files and exact error', async t => {
 const code = 'local value = 7\nreturn value', events = [];
 let stopped = false;
 const fixture = await piFixture(t, { engine: 'unreal', result: { code }, respond: ({ phase, body }) => {
  if (phase !== 'submit') return null;
  if (!stopped) { stopped = true; return { calls: [] }; }
  assert.ok(body.messages.some(message => message.role === 'user' && JSON.stringify(message.content).includes('existing workspace')));
  return { result: { kind: 'ue4ss-lua', name: 'Continued', author: 'Fixture' } };
 } });
 const draft = await createDeepSeek({ apiKey: fixture.key, pi: fixture.pi }).generate({ kind: 'ue4ss-lua', prompt: 'Finish the existing artifact', diagnostic: fixture.diagnostic, onEvent: event => events.push(event) });
 assert.equal(draft.code, code); assert.equal(events.filter(event => event.type === 'agent_start').length, 1);
 assert.equal(events.filter(event => event.type === 'tool_start' && event.name === 'write_project_file').length, 1);
 assert.ok(events.some(event => event.type === 'retry'));
});
test('desktop compiler repairs restore the existing source and modify only the reported defect', async t => {
 const before = 'local preserved = 42\nlocal broken = function(', after = 'local preserved = 42\nreturn preserved';
 const checkpoints = [], events = [];
 const fixture = await piFixture(t, { engine: 'unreal', respond: async ({ phase, body }) => {
  if (phase === 'author' && !body.messages.some(message => message.tool_calls?.some(call => call.function.name === 'read_project_file'))) return { calls: [{ name: 'read_project_file', arguments: { path: 'main.lua' } }, { name: 'read_runtime', arguments: {} }] };
  const read = body.messages.some(message => message.role === 'tool' && message.content.includes(before.replaceAll('\n', '\\n')));
  if (phase === 'author' || phase === 'submit') {
   if (!body.messages.some(message => message.tool_calls?.some(call => call.function.name === 'write_project_file'))) {
    assert.ok(read, 'The original source must be available through the project tool');
    assert.ok(body.messages.some(message => message.role === 'tool' && message.content.includes('syntax error')));
    return { calls: [{ name: 'write_project_file', arguments: { path: 'main.lua', text: after } }, { name: 'validate_project', arguments: {} }] };
   }
   return { result: { kind: 'ue4ss-lua', name: 'Repaired source', author: 'Fixture' } };
  }
  return null;
 } });
 const ai = createDeepSeek({ apiKey: fixture.key, pi: fixture.pi });
 const draft = await ai.repair({ kind: 'ue4ss-lua', prompt: 'Preserve the existing behavior', previousDraft: { kind: 'ue4ss-lua', code: before }, validation: { errors: ['syntax error'] },
  diagnostic: fixture.diagnostic, checkpoint: file => checkpoints.push(file), onEvent: event => events.push(event) });
 assert.equal(draft.code, after); assert.deepEqual(checkpoints.map(file => file.text), [before, after]);
 assert.equal(events.filter(event => event.type === 'agent_start').length, 1);
 assert.equal(events.filter(event => event.type === 'tool_start' && event.name === 'write_project_file').length, 1);
});
