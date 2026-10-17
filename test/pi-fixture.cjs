const http = require('node:http');
const { selectSkills } = require('../studio-skills.cjs');
const key = 'sk-isolated-pi-fixture-key-123456789';
async function piFixture(t, { game = { name: 'Fixture' }, engine = 'unknown', result = {}, respond, delay = 0 } = {}) {
 const { createRuntime } = await import('../platform/studio-pi.mjs');
 const runtime = await createRuntime(key), requests = [];
 const selection = selectSkills(game, { engine: { key: engine } });
 const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push({ body, authorization: req.headers.authorization, url: req.url });
  const step = requests.length;
  const hasTools = body.messages.some(message => message.role === 'tool');
  const submissions = new Set(body.messages.flatMap(message => (message.tool_calls || []).filter(call => call.function.name === 'submit_result').map(call => call.id)));
  const submitted = body.messages.some(message => message.role === 'tool' && submissions.has(message.tool_call_id) && message.content.includes('"accepted":true'));
  const hasAuthoring = body.tools?.some(tool => tool.function.name === 'write_project_file');
  const wrote = body.messages.some(message => message.tool_calls?.some(call => call.function.name === 'write_project_file'));
  const phase = submitted ? 'done' : hasAuthoring && hasTools && !wrote ? 'author' : hasTools ? 'submit' : 'inspect';
  const answer = respond ? await respond({ body, step, phase }) : null;
  if (answer?.status) { res.writeHead(answer.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'isolated fixture failure', code: 'fixture_error' } })); return; }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
  const send = (delta, finish_reason = null) => res.write('data: ' + JSON.stringify({ id: 'fixture-' + step, object: 'chat.completion.chunk', created: 1, model: 'deepseek-flash', choices: [{ index: 0, delta, finish_reason }] }) + '\n\n');
  send({ role: 'assistant', reasoning_content: '核对当前游戏的真实工具与技能。' });
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  let calls;
  if (answer?.calls) calls = answer.calls;
  else if (phase === 'inspect') calls = [{ name: 'inspect_game', arguments: {} }, ...selection.skills.map(skill => ({ name: 'read', arguments: { path: skill.path } })), ...selection.references.map(reference => ({ name: 'read_reference', arguments: { path: reference.path } })), ...(['bg3', 'ready-or-not'].includes(selection.agent.id) && body.tools.some(tool => tool.function.name === 'search_api') ? [{ name: 'search_api', arguments: { query: selection.agent.id === 'bg3' ? 'Osi.GetMaxHitpoints Osi.SetHitpoints' : 'PlayDead DecreaseHealth' } }] : [])];
  else if (phase === 'author') calls = [{ name: 'write_project_file', arguments: { path: 'main.lua', text: (typeof result === 'function' ? result(body) : result).code } }, { name: 'validate_project', arguments: {} }];
  else if (phase === 'submit') calls = [{ name: 'submit_result', arguments: { result: answer && Object.hasOwn(answer, 'result') ? answer.result : typeof result === 'function' ? result(body) : result } }];
  if (calls) {
   send({ tool_calls: calls.map((call, index) => ({ index, id: `call-${step}-${index}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) });
   send({}, 'tool_calls');
  } else { send({ content: '已提交结果。' }); send({}, 'stop'); }
  res.end('data: [DONE]\n\n');
 });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
 const config = runtime.getRegisteredProviderConfig('moddock-deepseek');
 runtime.registerProvider('moddock-deepseek', { ...config, baseUrl: `http://127.0.0.1:${server.address().port}` });
 return { pi: { modelRuntime: runtime }, requests, selection, key, game, diagnostic: { engine: { key: engine } } };
}
module.exports = { piFixture, key };
