function createAuthClient(request = fetch, now = Date.now) {
 let token, config;
 let sessionDetails = { profile: null, remember: false, storageWarning: null };
 async function call(route, body) {
  if (body !== undefined && !token) {
   const response = await request('/api/auth/config');
   if (!response.ok) throw new Error('本地服务连接失败，请重新打开游匣。');
   token = (await response.json()).token;
  }
  let response;
  try {
   response = await request(route.startsWith('account/') ? `/api/${route}` : `/api/auth/${route}`, {
    credentials: 'same-origin',
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': token }, body: JSON.stringify(body) }),
   });
  } catch { throw new Error('账号服务连接失败，请稍后重试。'); }
  const data = await response.json();
  if (!response.ok) {
   const error = new Error(data.message || data.error || '账号请求失败，请稍后重试。');
   Object.assign(error, { code: data.code, status: response.status, retryAfterSeconds: data.retryAfterSeconds, account: data.account, reason: data.reason });
   if (response.status === 401 || ['account_disabled', 'disabled', 'user_disabled'].includes(data.code)) sessionDetails = { profile: null, remember: false, storageWarning: null };
   else if (data.account) sessionDetails.profile = data.account;
   throw error;
  }
  return data;
 }
 return {
  getSessionDetails() { return structuredClone(sessionDetails); },
  async config() { config ||= await call('config'); token = config.token; return config; },
  async session() {
   sessionDetails = await call('session');
   if (!sessionDetails.profile && (await this.config()).rememberAvailable) return this.restore();
   return sessionDetails.profile;
  },
  async restore() { sessionDetails = await call('restore', {}); return sessionDetails.profile; },
  async login({ email, password, remember = false }) {
   sessionDetails = await call('login', { email, password, remember }); return sessionDetails.profile;
  },
  async sendCode({ email, password, termsAccepted, purpose = 'register' }) {
   const result = await call('code', { email, password, termsAccepted, purpose });
   return { id: now(), expiresAt: now() + result.expiresInSeconds * 1000, resendAt: now() + result.retryAfterSeconds * 1000, message: result.message };
  },
  async register({ email, password, code, termsAccepted, remember = false }) {
   const terms = await this.config();
   sessionDetails = await call('register', { email, password, code, termsAccepted, termsVersion: terms.termsVersion, remember });
   return sessionDetails.profile;
  },
  async resetPassword(input) {
   const result = await call('reset-password', { email: input.email, code: input.code, newPassword: input.newPassword });
   if (sessionDetails.profile?.email === input.email.trim().toLowerCase()) sessionDetails = { profile: null, remember: false, storageWarning: result.storageWarning };
   return result;
  },
  async changePassword(input) {
   const result = await call('account/password', { currentPassword: input.currentPassword, newPassword: input.newPassword });
   sessionDetails = { profile: null, remember: false, storageWarning: result.storageWarning };
   return result;
  },
  async me() { const result = await call('account/me'); sessionDetails.profile = result.account; return result.account; },
  async authorize(featureKey) { const result = await call('account/authorize', { featureKey }); sessionDetails.profile = result.account; return result; },
  plans() { return call('account/plans'); },
  orders() { return call('account/orders'); },
  order(orderId) { return call(`account/orders/${encodeURIComponent(orderId)}`); },
  createOrder(planId) { return call('account/orders', { planId }); },
  async logout() {
   try { return await call('logout', {}); }
   finally { sessionDetails = { profile: null, remember: false, storageWarning: null }; token = undefined; }
  },
  reset() { token = undefined; config = undefined; },
 };
}
module.exports = { createAuthClient };
