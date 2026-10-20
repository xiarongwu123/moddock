const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDeepSeek } = require('../studio-ai.cjs');
const { safeEvent } = require('../studio-events.cjs');
const { verifySkillSources } = require('../studio-skills.cjs');
const { createStudioLogger, describeError } = require('../studio-errors.cjs');
const { StudioTasks } = require('./studio-tasks.cjs');
const { AILedger } = require('./ai-ledger.cjs');

const actions = new Set(['plan', 'generate', 'repair']);
const kinds = new Set(['dialogue', 'texture', 'ue4ss-lua', 'reframework-lua', 'bepinex-plugin', 'bg3-lua', 'bg3-follower', 'engine-mod', 'custom-project', 'project-plan']);
const fields = new Set(['harness', 'prompt', 'kind', 'plan', 'previousPlan', 'previousDraft', 'validation', 'attempt', 'types', 'capability', 'messages', 'diagnostic', 'environment', 'context', 'agentStep', 'toolHistory']);
function validate(action, value) {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.has(key))) throw new Error('Invalid creation context');
 if (value.harness !== undefined && value.harness !== 'pi-agent') throw new Error('Pi harness required');
 if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 2000) throw new Error('Invalid prompt');
 if (value.messages !== undefined && (!Array.isArray(value.messages) || value.messages.length > 16 || value.messages.some(item => !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || item.content.length > 12000))) throw new Error('Invalid conversation');
 if (action === 'plan' && (!Array.isArray(value.types) || value.types.length > kinds.size || !value.types.some(type => kinds.has(type.id) && type.available === true))) throw new Error('Invalid creation types');
 if (action !== 'plan' && !kinds.has(value.kind)) throw new Error('Invalid artifact type');
 if (value.agentStep !== undefined && (value.harness !== undefined || action !== 'generate' || value.kind !== 'bg3-lua' || !Number.isInteger(value.agentStep) || value.agentStep < 0 || value.agentStep > 6 || !Array.isArray(value.toolHistory) || value.toolHistory.length > 24 || Buffer.byteLength(JSON.stringify(value.toolHistory)) > 110000)) throw new Error('Invalid legacy transport');
 if (value.toolHistory !== undefined && value.agentStep === undefined) throw new Error('Unexpected legacy tool history');
 return value;
}

async function createStudioService({ accessToken, ai, apiKey, ledger, database, accountUrl, host = '127.0.0.1', port = 0, timeout = 300000, hourlyLimit = 120, taskDirectory, taskLease, taskRetention } = {}) {
 if (!/^[a-f0-9]{64}$/.test(accessToken || '')) throw new Error('Invalid private service token');
 if (host !== '127.0.0.1' && !/^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) throw new Error('Private bind address required');
 if (!ai) { await import('./studio-pi.mjs'); await verifySkillSources(); await require('../studio-game-api.cjs').verify(); }
 const provider = ai || createDeepSeek({ apiKey });
 if (!ledger) {
  const target = new URL(accountUrl);
  if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname) || target.username || target.password) throw new Error('Private account callback required');
  ledger = new AILedger({ filename: database, account: async owner => {
   const response = await fetch(target, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { Authorization: 'Bearer ' + accessToken, 'X-Mu-Account-Id': owner, 'X-Forwarded-Proto': 'https' } });
   if (!response.ok) throw new Error('Account unavailable');
   return response.json();
  } });
 }
 const active = new Map(), windows = new Map();
 const temporary = !taskDirectory;
 taskDirectory ||= await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-studio-tasks-'));
 const logger = createStudioLogger(path.join(taskDirectory, 'logs'));
 const reserve = (owner, controller) => {
  const now = Date.now();
  for (const [id, value] of windows) if (value.started <= now - 3600000) windows.delete(id);
  const window = windows.get(owner) || { started: now, count: 0 };
  if (active.has(owner) || active.size >= 4 || window.count >= hourlyLimit || windows.size >= 10000 && !windows.has(owner)) throw Object.assign(new Error('studio_rate_limited'), { code: 'studio_rate_limited', status: 429 });
  window.count++; windows.set(owner, window); active.set(owner, controller);
  return () => { if (active.get(owner) === controller) active.delete(owner); };
 };
 const tasks = new StudioTasks({ directory: taskDirectory, logger, timeout, lease: taskLease, retention: taskRetention, reserve,
  execute: (action, payload) => provider[action]({ ...payload,
   metering: { ledger, owner: payload.accountId, task: payload.taskId, onUsage: payload.onUsage },
   onEvent: input => { const event = safeEvent(input); if (event) payload.onEvent(event); } }) });
 const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const send = (value, status = 200) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); } };
  const supplied = Buffer.from(req.headers.authorization || ''), expected = Buffer.from('Bearer ' + accessToken);
  if (req.headers.host !== `${host}:${server.address().port}` || req.headers.origin) return send({ code: 'forbidden' }, 403);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return send({ code: 'unauthorized' }, 401);
  const owner = req.headers['x-mu-account-id'];
  if (typeof owner !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(owner)) return send({ code: 'invalid_request' }, 400);
  if (req.method === 'GET' && req.url === '/quota') {
   try { return send(ledger.quota(owner)); } catch { return send({ code: 'ai_quota_unconfigured' }, 503); }
  }
  if (req.method === 'GET' && req.url === '/status') return send({ ready: true, provider: provider.provider?.name || 'MU AI', harness: 'pi-agent', activeTasks: active.size, capabilities: ['plan', 'generate', 'repair', 'skills', 'agents', 'thinking', 'tool-events', 'resumable-tasks', 'diagnostics'] });
  const action = req.url.slice(1);
  if (req.method !== 'POST' || !actions.has(action)) return send({ code: 'not_found' }, 404);
  const controller = new AbortController();
  let timer, heartbeat, reserved = false, streaming = false, streamBytes = 0;
  const frame = value => {
   if (res.destroyed || controller.signal.aborted) return;
   const line = JSON.stringify(value) + '\n';
   streamBytes += Buffer.byteLength(line);
   if (streamBytes > 2 * 1024 * 1024 || res.writableLength > 256 * 1024) { controller.abort(); return; }
   res.write(line);
  };
  const cancel = () => { if (!res.writableEnded) controller.abort(); };
  try {
   const chunks = []; let size = 0;
   for await (const chunk of req) { size += chunk.length; if (size > 192 * 1024) return send({ code: 'request_too_large' }, 413); chunks.push(chunk); }
   let payload, delivery;
   try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); delivery = value.delivery;
    if (delivery !== undefined) { tasks.validate(delivery); delete value.delivery; }
    payload = validate(action, value);
   }
   catch { return send({ code: 'invalid_request' }, 400); }
   if (delivery) {
    try { return await tasks.handle(req, res, owner, action, payload, delivery); }
    catch (error) {
     const diagnostic = describeError(error, 'delivery', delivery.id); await logger.write({ taskId: delivery.id, action, diagnostic }).catch(() => {});
     if (res.headersSent) { res.destroy(); return; }
     const code = ['pro_required', 'ai_quota_unconfigured', 'ai_credits_exhausted', 'invalid_request', 'studio_rate_limited', 'studio_task_expired', 'studio_task_interrupted'].includes(error.code) ? error.code : 'studio_unavailable';
     res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' });
     res.end(JSON.stringify({ type: 'task', version: 1, id: delivery.id }) + '\n' + JSON.stringify({ type: 'error', seq: delivery.after + 1, code, diagnostic }) + '\n'); return;
    }
   }
   // Older BG3 clients execute this inspection handshake locally; authoring still belongs to Pi.
   if (payload.agentStep === 0) return send({ type: 'tools', calls: [{ name: 'inspect_game', arguments: {} }, { name: 'search_api', arguments: { query: 'SessionLoaded' } }] });
   const now = Date.now();
   for (const [id, value] of windows) if (value.started <= now - 3600000) windows.delete(id);
   const window = windows.get(owner) || { started: now, count: 0 };
   if (active.has(owner) || active.size >= 4 || window.count >= hourlyLimit || windows.size >= 10000 && !windows.has(owner)) {
    res.setHeader('Retry-After', '30'); return send({ code: 'studio_rate_limited' }, 429);
   }
   window.count++; windows.set(owner, window); active.set(owner, controller); reserved = true;
   timer = setTimeout(() => controller.abort(), timeout);
   res.on('close', cancel);
   if (String(req.headers.accept || '').includes('application/x-ndjson')) {
    streaming = true;
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    heartbeat = setInterval(() => frame({ type: 'heartbeat' }), 10000);
   }
   const taskId = crypto.randomUUID();
   const value = await provider[action]({ ...payload, accountId: owner, signal: controller.signal,
    metering: { ledger, owner, task: taskId, onUsage: usage => { if (streaming) frame({ type: 'usage', usage }); } },
    onEvent: input => { const event = safeEvent(input); if (streaming && event) frame({ type: 'event', event }); } });
   const result = payload.agentStep === undefined ? value : { type: 'complete', draft: value };
   controller.signal.throwIfAborted();
   if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) throw Object.assign(new Error(), { code: 'AI_RESPONSE_FORMAT' });
   if (streaming) { frame({ type: 'result', result }); res.end(); } else send(result);
  } catch (error) {
   const message = error.message || '';
   const credits = /HTTP 402/.test(message), busy = /HTTP 429/.test(message);
   const invalid = ['AI_RESPONSE_FORMAT', 'AI_ARTIFACT_INVALID'].includes(error.code) || /AI 贴图/.test(message);
   if (busy && !res.headersSent) res.setHeader('Retry-After', '30');
   const code = ['pro_required', 'ai_quota_unconfigured', 'ai_credits_exhausted'].includes(error.code) ? error.code : credits ? 'ai_credits_exhausted' : busy ? 'studio_rate_limited' : invalid ? 'ai_response_invalid' : 'studio_unavailable';
   await logger.write({ action, diagnostic: describeError(error, 'legacy_creation') }).catch(() => {});
   if (streaming) { if (!res.destroyed) res.end(JSON.stringify({ type: 'error', code }) + '\n'); } else send({ code }, credits || invalid ? 502 : busy ? 429 : 503);
  } finally {
   clearTimeout(timer); clearInterval(heartbeat); res.off('close', cancel);
   if (reserved) active.delete(owner);
  }
 });
 server.requestTimeout = 20000;
 await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
 return { server, tasks, taskDirectory, url: `http://${host}:${server.address().port}`, async close() {
  await tasks.close(); await logger.flush().catch(() => {});
  for (const controller of active.values()) controller.abort();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  ledger.close();
  if (temporary) await fs.rm(taskDirectory, { recursive: true, force: true });
 } };
}
if (require.main === module) createStudioService({ accessToken: process.env.MODDOCK_STUDIO_TOKEN,
 apiKey: process.env.MODDOCK_DEEPSEEK_API_KEY, host: process.env.MODDOCK_STUDIO_HOST || '127.0.0.1',
 port: Number(process.env.MODDOCK_STUDIO_PORT || 8097), taskDirectory: process.env.MODDOCK_STUDIO_TASKS,
 database: process.env.MODDOCK_AI_DATABASE, accountUrl: process.env.MODDOCK_AI_ACCOUNT_URL }).then(() => console.log('MU private creation service ready'))
 .catch(() => { console.error('MU private creation service configuration failed'); process.exitCode = 1; });
module.exports = { createStudioService };
