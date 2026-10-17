const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
 const [input, output] = process.argv.slice(2), payload = JSON.parse(await fs.readFile(input, 'utf8')), events = [];
 async function call(action, value) {
  const response = await fetch('http://127.0.0.1:8096/' + action, { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.MODDOCK_STUDIO_TOKEN, 'X-Mu-Account-Id': 'native-toolchain-verification', Accept: 'application/x-ndjson', 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal: AbortSignal.timeout(310000) });
  if (!response.ok) throw new Error('Candidate HTTP ' + response.status);
  let pending = '', result; const decoder = new TextDecoder();
  const frame = line => {
   if (!line.trim()) return; const frame = JSON.parse(line);
   if (frame.type === 'error') throw new Error('Pi generation: ' + frame.code);
   if (frame.type === 'result') result = frame.result;
   if (frame.type === 'event') { events.push(frame.event); if (frame.event.type === 'tool_start') console.log(payload.context.engineEvidence.mode + ' ' + frame.event.name); }
  };
  for await (const bytes of response.body) { pending += decoder.decode(bytes, { stream: true }); let end; while ((end = pending.indexOf('\n')) >= 0) { frame(pending.slice(0, end)); pending = pending.slice(end + 1); } }
  frame(pending + decoder.decode()); if (!result) throw new Error('No Pi artifact'); return result;
 }
 const plan = await call('plan', payload);
 if (plan.kind !== 'engine-mod' || plan.questions?.length) throw new Error('Pi did not select actual native Mod authoring');
 const draft = await call('generate', { ...payload, kind: plan.kind, plan });
 if (draft.mode !== payload.context.engineEvidence.mode) throw new Error('Wrong native mode: ' + draft.mode);
 const tools = new Set(events.filter(event => event.type === 'tool_end' && !event.failed).map(event => event.name));
 for (const tool of ['list_game_files', 'read_game_file', 'write_project_file', 'validate_project', 'submit_result']) if (!tools.has(tool)) throw new Error('Pi did not use ' + tool);
 await fs.mkdir(path.dirname(output), { recursive: true });
 await fs.writeFile(output, JSON.stringify({ mode: draft.mode, prompt: payload.prompt, plan, draft, tools: [...tools], thinkingStreamed: events.some(event => event.type === 'thinking_delta'), realPiUsed: true, events }, null, 2), { mode: 0o600 });
 console.log(draft.mode + ' actual Pi artifact complete');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
