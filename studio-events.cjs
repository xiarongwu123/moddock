const TYPES = new Set(['selection', 'agent_start', 'agent_end', 'thinking_start', 'thinking_delta', 'thinking_end', 'text_delta', 'tool_start', 'tool_end', 'skill_loaded', 'retry', 'connection']);
const clean = (value, length = 1000) => String(value || '').replace(/\bsk-[\w-]{8,}|Bearer\s+[^\s"']+/gi, '[redacted]').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(0, length);
function safeEvent(input) {
 if (!input || !TYPES.has(input.type)) return null;
 const event = { type: input.type, harness: 'pi-agent', at: new Date().toISOString() };
 for (const key of ['agent', 'callId', 'name', 'status', 'path']) if (typeof input[key] === 'string') event[key] = clean(input[key], 500);
 if (typeof input.delta === 'string') event.delta = clean(input.delta, 2000);
 if (typeof input.detail === 'string') event.detail = clean(input.detail);
 if (Number.isSafeInteger(input.attempt)) event.attempt = Math.max(0, Math.min(input.attempt, 1000));
 if (typeof input.taskId === 'string') event.taskId = clean(input.taskId, 100);
 if (typeof input.failed === 'boolean') event.failed = input.failed;
 if (Number.isFinite(input.durationMs)) event.durationMs = Math.max(0, Math.min(input.durationMs, 360000));
 if (input.type === 'selection' && input.selection) {
  const source = input.selection;
  event.selection = { harness: 'pi-agent', agent: { id: clean(source.agent?.id, 100), name: clean(source.agent?.name, 100) },
   skills: Array.isArray(source.skills) ? source.skills.slice(0, 8).map(skill => ({ id: clean(skill.id, 100), name: clean(skill.name, 100), reason: clean(skill.reason, 200) })) : [],
   dependencies: Array.isArray(source.dependencies) ? source.dependencies.slice(0, 4).map(dep => ({ id: clean(dep.id, 100), available: dep.available === true, detail: clean(dep.detail, 300) })) : [] };
 }
 return event;
}
function recordEvent(item, input) {
 const event = safeEvent(input); if (!event) return false;
 item.harness ||= { name: 'pi-agent', status: 'running', skills: [], thinking: [], events: [] };
 const harness = item.harness;
 if (event.type === 'connection') harness.connection = { status: event.status, attempt: event.attempt, taskId: event.taskId, detail: event.detail, at: event.at };
 if (['thinking_start', 'thinking_delta', 'tool_start', 'tool_end'].includes(event.type) && event.agent) harness.currentAgent = event.agent;
 if (event.selection) Object.assign(harness, event.selection);
 if (event.type === 'agent_start') { harness.status = 'running'; harness.modelStatus = 'waiting'; harness.currentAgent = event.agent; }
 if (event.type === 'agent_end') { harness.status = event.status; }
 if (event.type === 'thinking_start' || event.type === 'thinking_delta') {
  harness.modelStatus = 'thinking';
  let thought = harness.thinking.at(-1);
  if (!thought || thought.agent !== event.agent || thought.status !== 'running') { thought = { agent: event.agent, text: '', status: 'running', created: event.at }; harness.thinking.push(thought); }
  thought.text = (thought.text + (event.delta || '')).slice(-6000);
  harness.thinking = harness.thinking.slice(-6);
 }
 if (event.type === 'thinking_end') for (const thought of harness.thinking) if (thought.agent === event.agent) thought.status = 'completed';
 if (event.type === 'text_delta') harness.modelStatus = 'writing';
 if (event.type === 'tool_start') {
  harness.modelStatus = 'tool';
  item.toolCalls ||= [];
  item.toolCalls.push({ id: event.callId, name: event.name, agent: event.agent, status: 'running', detail: event.detail || '', created: event.at });
  item.toolCalls = item.toolCalls.slice(-80);
 }
 if (event.type === 'tool_end') {
  const call = item.toolCalls?.findLast(tool => tool.id === event.callId);
  if (call) Object.assign(call, { status: event.failed ? 'failed' : 'completed', detail: event.failed ? event.detail : call.detail || event.detail, durationMs: event.durationMs });
 }
 if (event.type === 'skill_loaded') for (const skill of harness.skills) if (skill.name === event.name) skill.status = 'loaded';
 if (event.type !== 'thinking_delta' && event.type !== 'text_delta') {
  const { selection, detail, delta, ...compact } = event;
  harness.events.push(compact); harness.events = harness.events.slice(-100);
 }
 while (Buffer.byteLength(JSON.stringify({ harness, toolCalls: item.toolCalls })) > 64 * 1024) {
  if (harness.events.length > 2) harness.events.shift();
  else if (harness.thinking.length > 1) harness.thinking.shift();
  else if (item.toolCalls?.length > 1) item.toolCalls.shift();
  else { if (harness.thinking[0]) harness.thinking[0].text = harness.thinking[0].text.slice(-2000); break; }
 }
 return true;
}
function finishEvents(item, status) {
 if (!item.harness) return;
 item.harness.status = status;
 for (const thought of item.harness.thinking) if (thought.status === 'running') thought.status = status;
 for (const call of item.toolCalls || []) if (call.status === 'running') call.status = status === 'completed' ? 'interrupted' : status;
}
module.exports = { safeEvent, recordEvent, finishEvents };
