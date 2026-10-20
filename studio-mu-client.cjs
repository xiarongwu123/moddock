const crypto = require('node:crypto');
const { setTimeout: wait } = require('node:timers/promises');
const { describeError, cleanDiagnostic } = require('./studio-errors.cjs');
function creationPayload(payload) {
 const { diagnostic = {}, context = {}, environment = {} } = payload;
 return {
  harness: 'pi-agent',
  prompt: payload.npc ? payload.prompt + '\n目标角色：' + payload.npc : payload.prompt, kind: payload.kind, plan: payload.plan, previousPlan: payload.previousPlan,
  previousDraft: payload.previousDraft, validation: payload.validation, attempt: payload.attempt,
  types: payload.types, capability: payload.capability,
  messages: payload.messages?.slice(-16).map(({ role, content }) => ({ role, content })),
  diagnostic: { engine: diagnostic.engine, loaders: diagnostic.loaders, requirements: diagnostic.requirements,
   antiCheat: diagnostic.antiCheat, routes: diagnostic.routes },
  environment: Object.fromEntries(Object.entries(environment).map(([key, value]) => [key,
   { available: value.available, version: value.version, reason: value.reason }])),
  context: { game: context.game, engineEvidence: context.engineEvidence, guide: { text: context.guide?.text?.slice(0, 12000) },
   notes: context.notes?.slice(0, 3).map(note => ({ title: note.title, text: note.text?.slice(0, 5000) })) },
 };
}

async function readCreationResponse(response, onEvent, signal, delivery) {
 const streaming = response.headers.get('content-type')?.includes('application/x-ndjson');
 const decoder = new TextDecoder(); let pending = '', bytes = 0, final;
 const handle = async line => {
  if (!line.trim()) return;
  const frame = JSON.parse(line);
  if (delivery && frame.type === 'task') {
   if (frame.version !== 1 || frame.id !== delivery.id) throw Object.assign(new Error('创作任务编号不匹配'), { code: 'STUDIO_TASK_INVALID' });
   delivery.negotiated = true; delivery.connected?.(); return;
  }
  const usage = frame.usage || frame.result?.usage || frame.event?.usage;
  if (usage && delivery && !delivery.negotiated) throw Object.assign(new Error('用量缺少已验证的创作任务'), { code: 'STUDIO_TASK_INVALID' });
  if (delivery && frame.type === 'checkpoint') { delivery.rotate = true; return; }
  if (delivery && (['event', 'result', 'error'].includes(frame.type) || frame.type === 'usage' && frame.seq !== undefined)) {
   if (!delivery.negotiated || !Number.isSafeInteger(frame.seq) || frame.seq < 1) throw Object.assign(new Error('创作任务缺少可恢复的进度编号'), { code: 'STUDIO_TASK_INVALID' });
   if (frame.seq <= delivery.after) return;
   if (frame.seq !== delivery.after + 1) throw Object.assign(new Error('创作进度传输不完整，正在重新连接'), { code: 'STUDIO_STREAM_GAP' });
  }
  if (usage) await delivery?.onUsage?.(usage);
  if (frame.type === 'usage') {
   if (delivery && Number.isSafeInteger(frame.seq)) { delivery.after = frame.seq; delivery.checkpoint?.(); }
   return;
  }
  if (frame.type === 'event') onEvent?.(frame.event);
  else if (frame.type === 'result') { if (final !== undefined) throw new Error('创作服务重复返回结果'); final = frame.result; }
  else if (frame.type === 'error') {
   const diagnostic = frame.diagnostic && { traceId: cleanDiagnostic(frame.diagnostic.traceId, 100), stage: cleanDiagnostic(frame.diagnostic.stage, 100), category: cleanDiagnostic(frame.diagnostic.category, 100), code: cleanDiagnostic(frame.diagnostic.code, 100), upstreamStatus: frame.diagnostic.upstreamStatus, reason: cleanDiagnostic(frame.diagnostic.reason) };
   const message = ({ ai_credits_exhausted: '创作服务额度暂不足。', studio_rate_limited: '创作服务请求过多。', ai_response_invalid: '制作内容未通过校验。', studio_task_interrupted: '创作进程已停止，代码和进度已保留。', studio_cancelled: '创作已停止。' })[frame.code] || '创作执行失败，请查看错误详情。';
   throw Object.assign(new Error(message), { code: frame.code === 'ai_response_invalid' ? 'AI_RESPONSE_FORMAT' : frame.code, diagnostic, taskFailure: true });
  }
  else if (frame.type !== 'heartbeat') throw new Error('创作事件格式无效');
  if (delivery && frame.type === 'event' && Number.isSafeInteger(frame.seq)) { delivery.after = frame.seq; delivery.checkpoint?.(); }
 };
 try {
  for await (const chunk of response.body) {
   signal?.throwIfAborted(); bytes += chunk.length;
   if (bytes > (streaming ? 2 * 1024 * 1024 : 256 * 1024)) throw new Error('创作服务返回内容过大');
   pending += decoder.decode(chunk, { stream: true });
   if (streaming) {
    let end; while ((end = pending.indexOf('\n')) >= 0) { await handle(pending.slice(0, end)); pending = pending.slice(end + 1); }
    if (pending.length > 256 * 1024) throw new Error('创作事件过大');
   }
  }
  pending += decoder.decode(); signal?.throwIfAborted();
  if (!streaming) { const result = JSON.parse(pending); if (result.usage) await delivery?.onUsage?.(result.usage); return result; }
  if (pending.trim()) await handle(pending);
  if (final === undefined && delivery?.rotate) return;
  if (final === undefined) throw Object.assign(new Error('创作连接已中断，未收到完整结果。想法与已有产物已保留。'), { code: 'STUDIO_CONNECTION_INTERRUPTED' });
  return final;
 } catch (error) {
  await response.body?.cancel().catch(() => {});
  const detail = [error?.message, error?.code, error?.cause?.code].filter(Boolean).join(' ');
  const transport = /net::ERR_[A-Z_]+|\b(?:ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|ETIMEDOUT|EPIPE|UND_ERR_[A-Z_]+)\b|^fetch failed$|^terminated$/.test(detail);
  if (!signal?.aborted && transport) {
   // A complete result frame survives a transport failure during stream shutdown.
   if (final !== undefined) return final;
   throw Object.assign(new Error('创作连接中断，未收到完整结果。想法与已有产物已保留。', { cause: error }), { code: 'STUDIO_CONNECTION_INTERRUPTED' });
  }
  throw error;
 }
}
function createMuStudioAI(request, { retryDelay = 1000, maxRetryDelay = 15000, requestTimeout = 45000, onUsage } = {}) {
 const call = async (route, payload) => {
  const content = creationPayload(payload), id = crypto.randomUUID(), signal = payload.signal || AbortSignal.timeout(900000);
  let attempt = 0, reconnecting = false, finished = false;
  const notify = status => payload.onEvent?.({ type: 'connection', status, taskId: id, attempt, detail: status === 'reconnecting' ? '连接中断，正在自动重连。已保存的代码和进度会继续保留。' : '连接已恢复，继续接收同一次创作。' });
  const delivery = { id, after: 0, onUsage: usage => onUsage?.(payload.accountId, id, usage), checkpoint: () => payload.onTask?.({ id, action: route, after: delivery.after }),
   connected: () => { if (reconnecting) { reconnecting = false; notify('connected'); } } };
  const bodyFor = operation => JSON.stringify({ ...content, delivery: { version: 1, id, after: delivery.after, operation } });
  if (Buffer.byteLength(bodyFor('subscribe')) > 192 * 1024) throw new Error('本次创作上下文过大，请缩短需求后重试');
  const cancel = () => { if (!finished) void request(payload.accountId, route, { body: bodyFor('cancel'), signal: AbortSignal.timeout(10000) }).then(response => response.body?.cancel()).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true }); payload.onTask?.({ id, action: route, after: 0 });
  try {
   for (;;) {
    signal.throwIfAborted(); delivery.rotate = false;
    const connectionSignal = AbortSignal.any([signal, AbortSignal.timeout(requestTimeout)]);
    try {
     const response = await request(payload.accountId, route, { body: bodyFor('subscribe'), signal: connectionSignal });
     if (payload.onEvent && !response.headers.get('content-type')?.includes('application/x-ndjson')) {
      await response.body?.cancel(); throw Object.assign(new Error('创作服务需要更新后才能继续。'), { code: 'PI_RUNTIME_REQUIRED' });
     }
     const result = await readCreationResponse(response, payload.onEvent, connectionSignal, delivery);
     if (result !== undefined) { finished = true; return result; }
    } catch (error) {
     if (signal.aborted) throw signal.reason;
     if (error.code === 'ai_response_invalid') error.code = 'AI_RESPONSE_FORMAT';
     const diagnostic = describeError(error, 'transport', id);
     const retryable = !error.taskFailure && (connectionSignal.aborted || diagnostic.category === 'network' || ['STUDIO_CONNECTION_INTERRUPTED', 'STUDIO_STREAM_GAP', 'studio_unavailable', 'account_unavailable', 'account_timeout'].includes(error.code) || !error.code && [502, 503, 504].includes(error.status));
     if (!retryable) { finished = true; throw error; }
     reconnecting = true; attempt++; notify('reconnecting'); payload.onTask?.({ id, action: route, after: delivery.after, diagnostic });
     await wait(Math.min(maxRetryDelay, retryDelay * 2 ** Math.min(attempt - 1, 5)), undefined, { signal });
    }
   }
  } finally { signal.removeEventListener('abort', cancel); }
 };
 return { provider: { name: '游匣 AI', model: 'managed', harness: 'pi-agent' },
  plan: payload => call('plan', payload), generate: payload => call('generate', payload),
  repair: payload => call('repair', payload) };
}
module.exports = { createMuStudioAI, creationPayload, readCreationResponse };
