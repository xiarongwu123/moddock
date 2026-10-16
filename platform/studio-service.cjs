const http = require('node:http');
const crypto = require('node:crypto');
const { createDeepSeek } = require('../studio-ai.cjs');

const actions = new Set(['plan', 'generate', 'repair']);
const kinds = new Set(['dialogue', 'texture', 'ue4ss-lua', 'reframework-lua', 'bepinex-plugin', 'bg3-lua', 'bg3-follower', 'custom-project', 'project-plan']);
const fields = new Set(['prompt', 'kind', 'plan', 'previousPlan', 'previousDraft', 'validation', 'attempt', 'types', 'capability', 'messages', 'diagnostic', 'environment', 'context', 'agentStep', 'toolHistory']);
function validate(action, value) {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.has(key))) throw new Error('Invalid creation context');
 if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 2000) throw new Error('Invalid prompt');
 if (value.messages !== undefined && (!Array.isArray(value.messages) || value.messages.length > 16 || value.messages.some(item => !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || item.content.length > 12000))) throw new Error('Invalid conversation');
 if (action === 'plan' && (!Array.isArray(value.types) || value.types.length > kinds.size || !value.types.some(type => kinds.has(type.id) && type.available === true))) throw new Error('Invalid creation types');
 if (action !== 'plan' && !kinds.has(value.kind)) throw new Error('Invalid artifact type');
 if (value.agentStep !== undefined && (action !== 'generate' || value.kind !== 'bg3-lua' || !Number.isInteger(value.agentStep) || value.agentStep < 0 || value.agentStep > 6 || !Array.isArray(value.toolHistory) || value.toolHistory.length > 24 || Buffer.byteLength(JSON.stringify(value.toolHistory)) > 110000)) throw new Error('Invalid agent context');
 if (value.toolHistory !== undefined && value.agentStep === undefined) throw new Error('Unexpected tool history');
 return value;
}

async function createStudioService({ accessToken, ai, apiKey, host = '127.0.0.1', port = 0, timeout = 85000, hourlyLimit = 120 } = {}) {
 if (!/^[a-f0-9]{64}$/.test(accessToken || '')) throw new Error('Invalid private service token');
 if (host !== '127.0.0.1' && !/^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) throw new Error('Private bind address required');
 const provider = ai || createDeepSeek({ apiKey });
 const active = new Map(), windows = new Map();
 const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const send = (value, status = 200) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); } };
  const supplied = Buffer.from(req.headers.authorization || ''), expected = Buffer.from('Bearer ' + accessToken);
  if (req.headers.host !== `${host}:${server.address().port}` || req.headers.origin) return send({ code: 'forbidden' }, 403);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return send({ code: 'unauthorized' }, 401);
  const owner = req.headers['x-mu-account-id'];
  if (typeof owner !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(owner)) return send({ code: 'invalid_request' }, 400);
  if (req.method === 'GET' && req.url === '/status') return send({ ready: true, provider: 'DeepSeek', capabilities: ['plan', 'generate', 'repair', 'bg3-agent'] });
  const action = req.url.slice(1);
  if (req.method !== 'POST' || !actions.has(action)) return send({ code: 'not_found' }, 404);
  const controller = new AbortController();
  let timer, reserved = false;
  const cancel = () => { if (!res.writableEnded) controller.abort(); };
  try {
   const chunks = []; let size = 0;
   for await (const chunk of req) { size += chunk.length; if (size > 192 * 1024) return send({ code: 'request_too_large' }, 413); chunks.push(chunk); }
   let payload;
   try { payload = validate(action, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
   catch { return send({ code: 'invalid_request' }, 400); }
   const now = Date.now();
   for (const [id, value] of windows) if (value.started <= now - 3600000) windows.delete(id);
   const window = windows.get(owner) || { started: now, count: 0 };
   if (active.has(owner) || active.size >= 4 || window.count >= hourlyLimit || windows.size >= 10000 && !windows.has(owner)) {
    res.setHeader('Retry-After', '30'); return send({ code: 'studio_rate_limited' }, 429);
   }
   window.count++; windows.set(owner, window); active.set(owner, controller); reserved = true;
   timer = setTimeout(() => controller.abort(), timeout);
   res.on('close', cancel);
   const operation = payload.agentStep !== undefined ? 'agent' : action;
   const result = await provider[operation]({ ...payload, accountId: owner, signal: controller.signal });
   controller.signal.throwIfAborted();
   if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) throw Object.assign(new Error(), { code: 'AI_RESPONSE_FORMAT' });
   send(result);
  } catch (error) {
   const message = error.message || '';
   const credits = /HTTP 402/.test(message), busy = /HTTP 429/.test(message);
   const invalid = ['AI_RESPONSE_FORMAT', 'AI_ARTIFACT_INVALID'].includes(error.code) || /AI 贴图/.test(message);
   if (busy) res.setHeader('Retry-After', '30');
   send({ code: credits ? 'ai_credits_exhausted' : busy ? 'studio_rate_limited' : invalid ? 'ai_response_invalid' : 'studio_unavailable' }, credits || invalid ? 502 : busy ? 429 : 503);
  } finally {
   clearTimeout(timer); res.off('close', cancel);
   if (reserved) active.delete(owner);
  }
 });
 server.requestTimeout = 20000;
 await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
 return { server, url: `http://${host}:${server.address().port}`, async close() {
  for (const controller of active.values()) controller.abort();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
 } };
}
if (require.main === module) createStudioService({ accessToken: process.env.MODDOCK_STUDIO_TOKEN,
 apiKey: process.env.MODDOCK_DEEPSEEK_API_KEY, host: process.env.MODDOCK_STUDIO_HOST || '127.0.0.1',
 port: Number(process.env.MODDOCK_STUDIO_PORT || 8097) }).then(() => console.log('MU private creation service ready'))
 .catch(() => { console.error('MU private creation service configuration failed'); process.exitCode = 1; });
module.exports = { createStudioService };
