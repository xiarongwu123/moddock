function createAuthClient(request = fetch, now = Date.now) {
 let token, config;
 async function call(route, body) {
  if (body !== undefined && !token) {
   const response = await request('/api/auth/config');
   if (!response.ok) throw new Error('本地服务连接失败，请重新打开游匣。');
   token = (await response.json()).token;
  }
  let response;
  try {
   response = await request(`/api/auth/${route}`, {
    credentials: 'same-origin',
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': token }, body: JSON.stringify(body) }),
   });
  } catch { throw new Error('账号服务连接失败，请稍后重试。'); }
  const data = await response.json();
  if (!response.ok) {
   const error = new Error(data.message || data.error || '账号请求失败，请稍后重试。');
   Object.assign(error, { code: data.code, status: response.status, retryAfterSeconds: data.retryAfterSeconds });
   throw error;
  }
  return data;
 }
 return {
  async config() { config ||= await call('config'); token = config.token; return config; },
  async session() { return (await call('session')).profile; },
  async login({ email, password }) { return (await call('login', { email, password })).profile; },
  async sendCode({ email, password, termsAccepted }) {
   const result = await call('code', { email, password, termsAccepted });
   return { id: now(), expiresAt: now() + result.expiresInSeconds * 1000, resendAt: now() + result.retryAfterSeconds * 1000 };
  },
  async register({ email, password, code, termsAccepted }) {
   const terms = await this.config();
   return (await call('register', { email, password, code, termsAccepted, termsVersion: terms.termsVersion })).profile;
  },
  logout() { return call('logout', {}); },
  reset() { token = undefined; config = undefined; },
 };
}
module.exports = { createAuthClient };
