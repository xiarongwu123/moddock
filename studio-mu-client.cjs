function creationPayload(payload) {
 const { diagnostic = {}, context = {}, environment = {} } = payload;
 return {
  prompt: payload.npc ? payload.prompt + '\n目标角色：' + payload.npc : payload.prompt, kind: payload.kind, plan: payload.plan, previousPlan: payload.previousPlan,
  previousDraft: payload.previousDraft, validation: payload.validation, attempt: payload.attempt,
  types: payload.types, capability: payload.capability,
  agentStep: payload.agentStep, toolHistory: payload.toolHistory,
  messages: payload.messages?.slice(-16).map(({ role, content }) => ({ role, content })),
  diagnostic: { engine: diagnostic.engine, loaders: diagnostic.loaders, requirements: diagnostic.requirements,
   antiCheat: diagnostic.antiCheat, routes: diagnostic.routes },
  environment: Object.fromEntries(Object.entries(environment).map(([key, value]) => [key,
   { available: value.available, version: value.version, reason: value.reason }])),
  context: { game: context.game, guide: { text: context.guide?.text?.slice(0, 12000) },
   notes: context.notes?.slice(0, 3).map(note => ({ title: note.title, text: note.text?.slice(0, 5000) })) },
 };
}

function createMuStudioAI(request) {
 const call = async (route, payload) => {
  const body = JSON.stringify(creationPayload(payload));
  if (Buffer.byteLength(body) > 192 * 1024) throw new Error('本次创作上下文过大，请缩短需求后重试');
  let response;
  try { response = await request(payload.accountId, route, { body, signal: payload.signal }); }
  catch (error) { if (error.code === 'ai_response_invalid') error.code = 'AI_RESPONSE_FORMAT'; throw error; }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
   size += chunk.length;
   if (size > 256 * 1024) throw new Error('创作服务返回内容过大');
   chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('创作服务返回内容无效，请重试'); }
 };
 return { provider: { name: 'MU AI', model: 'managed' },
  plan: payload => call('plan', payload), generate: payload => call('generate', payload),
  agent: payload => call('generate', payload),
  repair: payload => call('repair', payload) };
}
module.exports = { createMuStudioAI, creationPayload };
