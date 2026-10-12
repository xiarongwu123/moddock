const crypto = require('node:crypto');
const { version } = require('./package.json');

const DEFAULT_BASE_URL = 'https://mu-api.claude-api.cn/';
const TERMS_VERSION = '2026-09-26';
const disabled = error => error.status === 401 || ['disabled', 'account_disabled', 'user_disabled'].includes(error.code);
class AccountError extends Error {
 constructor(status, code, message, retryAfterSeconds) {
  super(message); Object.assign(this, { status, code, retryAfterSeconds });
 }
}
function createAccountClient(options = {}) {
 const base = new URL(options.baseUrl || process.env.MODDOCK_ACCOUNT_URL || DEFAULT_BASE_URL);
 if (base.username || base.password || base.search || base.hash ||
  (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)))) {
  throw new Error('账号服务地址须为 HTTPS，或本机 HTTP 测试地址');
 }
 if (!base.pathname.endsWith('/')) base.pathname += '/';
 const request = options.fetch || fetch;
 const now = options.now || Date.now;
 const sessions = new Map();
 const tokenStore = options.tokenStore;
 let savedOwner = null, restoredId = null, restoreFlight = null;
 let storageWarning = null;
 const config = { termsVersion: TERMS_VERSION, legalUrls: Object.fromEntries(['terms', 'privacy'].map(name => [name, new URL(`legal/${name}`, base).href])) };
 Object.defineProperty(config, 'rememberAvailable', { enumerable: true, get: () => !!tokenStore?.isAvailable() });
 const deviceName = `MODDOCK ${version} (${process.platform})`;
 const fail = (status, code, message, retry) => { throw new AccountError(status, code, message, retry); };
 async function send(route, body, bearer) {
  let response;
  try {
   response = await request(new URL(`api/v1/${route}`, base), {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(route === 'auth/refresh' ? 30000 : 20000),
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
   });
  } catch { fail(503, 'account_unavailable', '无法连接 MU 账号服务，请稍后重试。'); }
  if (response.status === 204) return null;
  let data;
  try { data = await response.json(); } catch {
   fail(response.ok ? 502 : response.status, 'invalid_response', 'MU 账号服务响应无效，请稍后重试。', Number(response.headers.get('retry-after')) || undefined);
  }
  if (!response.ok) {
   const error = new AccountError(response.status, data.code || 'account_error', data.message || 'MU 账号服务请求失败，请稍后重试。', data.retryAfterSeconds || Number(response.headers.get('retry-after')) || undefined);
   if (data.account) error.account = account(data.account);
   if (data.reason) error.reason = data.reason;
   throw error;
  }
  return data;
 }
 function emailAddress(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'invalid_email', '请输入有效的邮箱地址。');
  return email;
 }
 function passwordValue(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) fail(400, 'invalid_password', '密码长度须为 8 至 128 个字符。');
  return value;
 }
 function codeValue(value) {
  if (typeof value !== 'string' || !/^\d{6}$/.test(value)) fail(400, 'invalid_code', '请输入 6 位邮箱验证码。');
  return value;
 }
 function credentials(body) {
  return { email: emailAddress(body.email), password: passwordValue(body.password) };
 }
 function account(data) {
  if (!data || typeof data.id !== 'string' || !data.id || typeof data.email !== 'string' || !data.email || !['standard', 'pro'].includes(data.membership?.tier) || !Array.isArray(data.features)) fail(502, 'invalid_response', 'MU 返回了无效的账号信息。');
  const features = data.features.map(feature => {
   if (typeof feature.key !== 'string' || !feature.key || typeof feature.enabled !== 'boolean' || typeof feature.allowed !== 'boolean' || !['standard', 'pro'].includes(feature.minimumTier) || !Number.isSafeInteger(feature.version) || feature.version < 0) fail(502, 'invalid_response', 'MU 返回了无效的功能权限。');
   return { key: feature.key, enabled: feature.enabled, minimumTier: feature.minimumTier, allowed: feature.allowed, version: feature.version };
  });
  return { id: data.id, email: data.email, name: data.email.split('@')[0], mode: 'mu', membership: { tier: data.membership.tier, expiresAt: data.membership.expiresAt ?? null }, features, paymentsEnabled: data.paymentsEnabled === true };
 }
 async function clearSaved(owner) {
  if (!tokenStore || (owner && savedOwner !== owner)) return;
  savedOwner = null; restoredId = null;
  try { await tokenStore.clear(); storageWarning = null; }
  catch { storageWarning = '未能删除本机登录缓存，请检查账号数据目录的写入权限。'; }
 }
 async function apply(state, data) {
  account(data?.account);
  const expiresAt = Date.parse(data.accessTokenExpiresAt);
  if (typeof data.accessToken !== 'string' || !data.accessToken || typeof data.refreshToken !== 'string' || !data.refreshToken || !Number.isFinite(expiresAt) || expiresAt <= now()) fail(502, 'invalid_response', 'MU 返回了无效的登录会话。');
  Object.assign(state, { accessToken: data.accessToken, refreshToken: data.refreshToken, expiresAt, verifiedAt: now(), profile: account(data.account) });
  state.storageWarning = null;
  if (state.remember) {
   try { await tokenStore.write({ service: base.href, email: state.profile.email, refreshToken: state.refreshToken }); savedOwner = state; storageWarning = null; }
   catch { state.remember = false; await clearSaved(); state.storageWarning = '登录成功，但无法保存保持登录状态；退出程序后需要重新登录。'; }
  }
 }
 async function start(route, body, remember = false) {
  const data = await send(route, body);
  const state = { queue: Promise.resolve(), startedAt: now(), remember: remember && config.rememberAvailable };
  if (!state.remember) await clearSaved();
  await apply(state, data);
  if (remember && !config.rememberAvailable) state.storageWarning = '当前环境不支持加密保持登录；退出程序后需要重新登录。';
  const id = crypto.randomBytes(32).toString('hex');
  sessions.set(id, state);
  return { id, profile: state.profile, remember: state.remember, storageWarning: state.storageWarning || storageWarning };
 }
 async function locked(id, action) {
  const state = sessions.get(id);
  if (!state) return null;
  const pending = state.queue.catch(() => {}).then(async () => {
   if (sessions.get(id) !== state) return null;
   if (now() - state.startedAt >= 30 * 86400000) { sessions.delete(id); await clearSaved(state); return null; }
   try { return await action(state); }
   catch (error) {
    state.verifiedAt = 0;
    if (error.account) state.profile = error.account;
    if (disabled(error) || error.code === 'invalid_response') { sessions.delete(id); await clearSaved(state); }
    throw error;
   }
  });
  state.queue = pending;
  return pending;
 }
 async function authenticated(state, route, body) {
  const refresh = async () => { await apply(state, await send('auth/refresh', { refreshToken: state.refreshToken })); };
  if (state.expiresAt <= now() + 30000) await refresh();
  try { return await send(route, body, state.accessToken); }
  catch (error) {
   if (error.status !== 401) throw error;
   await refresh();
   return send(route, body, state.accessToken);
  }
 }
 async function requireSession(id) {
  const profile = await locked(id, async state => {
   // State polling is frequent; coalesce remote checks while enforcing token expiry.
   if (state.verifiedAt <= now() - 30000 || state.expiresAt <= now() + 30000) {
    state.profile = account(await authenticated(state, 'account/me'));
    state.verifiedAt = now();
   }
   return state.profile;
  });
  if (!profile) fail(401, 'login_required', '请先登录游匣账号。');
  return profile;
 }
 async function withSession(id, action) {
  const result = await locked(id, action);
  if (result === null) fail(401, 'login_required', '请先登录游匣账号。');
  return result;
 }
 async function invalidateEmail(email) {
  for (const [id, state] of sessions) if (state.profile.email === email) sessions.delete(id);
  if (savedOwner?.profile.email === email) await clearSaved();
  else if (tokenStore && !savedOwner) {
   try { if ((await tokenStore.read())?.email === email) await clearSaved(); } catch { await clearSaved(); }
  }
 }
 async function authorize(id, featureKey) {
  if (typeof featureKey !== 'string' || !/^[a-z][a-z0-9_.-]{0,119}$/.test(featureKey)) fail(400, 'invalid_feature', '功能标识无效。');
  return withSession(id, async state => {
   const result = await authenticated(state, 'account/authorize', { featureKey });
   state.profile = account(result.account); state.verifiedAt = now();
   if (result.allowed !== true) fail(403, 'feature_denied', '当前账号没有此功能权限。');
   return { allowed: true, reason: result.reason, account: state.profile };
  });
 }
 async function restore() {
  if (!tokenStore) return { profile: null, storageWarning: null };
  if (restoredId && sessions.has(restoredId)) return { id: restoredId, profile: await requireSession(restoredId), remember: true };
  let saved;
  try {
   saved = await tokenStore.read();
   if (saved && saved.service !== base.href) throw new Error('Account service changed');
  } catch { await clearSaved(); return { profile: null, storageWarning: '保存的登录信息不可用，请重新登录。' }; }
  if (!saved) return { profile: null, storageWarning };
  const state = { queue: Promise.resolve(), startedAt: now(), remember: true };
  try { await apply(state, await send('auth/refresh', { refreshToken: saved.refreshToken })); }
  catch (error) { if (disabled(error) || error.code === 'invalid_response') await clearSaved(); throw error; }
  restoredId = crypto.randomBytes(32).toString('hex'); sessions.set(restoredId, state);
  return { id: restoredId, profile: state.profile, remember: state.remember, storageWarning: state.storageWarning };
 }
 function resourceId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) fail(400, 'invalid_identifier', '套餐或订单标识无效。');
  return encodeURIComponent(value);
 }
 return {
  config,
  requireSession,
  requireActiveSession() { return requireSession([...sessions.keys()].at(-1)); },
  authorize,
  authorizeActive(featureKey) { return authorize([...sessions.keys()].at(-1), featureKey); },
  restore() {
   if (!restoreFlight) restoreFlight = restore().finally(() => { restoreFlight = null; });
   return restoreFlight;
  },
  async resetPassword(body) {
   const email = emailAddress(body.email);
   await send('auth/reset-password', { email, code: codeValue(body.code), newPassword: passwordValue(body.newPassword) });
   await invalidateEmail(email);
   return { ok: true, requiresLogin: true, storageWarning };
  },
  async changePassword(id, body) {
   if (typeof body.currentPassword !== 'string' || !body.currentPassword || body.currentPassword.length > 128) fail(400, 'invalid_password', '请输入当前密码。');
   const newPassword = passwordValue(body.newPassword);
   return withSession(id, async state => {
    await authenticated(state, 'account/password', { currentPassword: body.currentPassword, newPassword });
    await invalidateEmail(state.profile.email);
    return { ok: true, requiresLogin: true, storageWarning };
   });
  },
  plans(id) { return withSession(id, state => authenticated(state, 'plans')); },
  orders(id) { return withSession(id, state => authenticated(state, 'orders')); },
  order(id, orderId) { return withSession(id, state => authenticated(state, `orders/${resourceId(orderId)}`)); },
  createOrder(id, body) { return withSession(id, state => authenticated(state, 'orders', { planId: decodeURIComponent(resourceId(body.planId)) })); },
  async sendCode(body) {
   const email = emailAddress(body.email), purpose = body.purpose ?? 'register';
   if (!['register', 'reset'].includes(purpose)) fail(400, 'invalid_purpose', '验证码用途无效。');
   if (purpose === 'register' && body.termsAccepted !== true) fail(400, 'terms_required', '请阅读并同意用户协议和隐私政策。');
   const result = await send('auth/code', { email, purpose });
   return { message: result.message, retryAfterSeconds: result.retryAfterSeconds || 60, expiresInSeconds: 600 };
  },
  login(body) { return start('auth/login', { ...credentials(body), deviceName }, body.remember === true); },
  register(body) {
   const input = credentials(body);
   if (body.termsAccepted !== true || body.termsVersion !== TERMS_VERSION) fail(400, 'terms_required', '请阅读并同意当前版本的用户协议和隐私政策。');
   if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) fail(400, 'invalid_code', '请输入 6 位邮箱验证码。');
   return start('auth/register', { ...input, code: body.code, termsVersion: TERMS_VERSION, deviceName }, body.remember === true);
  },
  session(id) {
   return locked(id, async state => {
    state.profile = account(await authenticated(state, 'account/me'));
    state.verifiedAt = now();
    return state.profile;
   });
  },
  async logout(id) {
   const state = sessions.get(id);
   try { await locked(id, async current => { await authenticated(current, 'auth/logout', {}); return { ok: true }; }); }
   finally { sessions.delete(id); if (state) await clearSaved(state); }
   return { ok: true, storageWarning };
  },
  clear() { sessions.clear(); },
 };
}
module.exports = { createAccountClient, AccountError, DEFAULT_BASE_URL, TERMS_VERSION };
