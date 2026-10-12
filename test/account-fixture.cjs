function accountFixture() {
 const calls = [];
 let account = { id: 'fixture-user', email: 'player@example.com', membership: { tier: 'standard', expiresAt: null }, features: [] };
 let generation = 0;
 let now = Date.now();
 let failure = null;
 let revoked = false;
 const response = () => ({ accessToken: `access-secret-${++generation}`, refreshToken: `refresh-secret-${generation}`, accessTokenExpiresAt: new Date(now + 900000).toISOString(), account });
 return {
  calls,
  advance(milliseconds) { now += milliseconds; },
  revoke() { revoked = true; },
  fail(status, code, message, retryAfterSeconds) { failure = { status, code, message, retryAfterSeconds }; },
  options: {
   now: () => now,
   fetch: async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    const route = new URL(url).pathname;
    calls.push({ route, body, method: init.method, headers: init.headers });
    if (failure) { const error = failure; failure = null; return Response.json(error, { status: error.status }); }
    if (route.endsWith('/auth/code')) return Response.json({ message: 'fixture mail queued', retryAfterSeconds: 60 });
    if (route.endsWith('/auth/register') && body.code !== '246810') return Response.json({ code: 'invalid_code', message: '验证码无效、已使用或已过期。' }, { status: 400 });
    if (route.endsWith('/auth/login') || route.endsWith('/auth/register')) { account = { ...account, email: body.email }; revoked = false; return Response.json(response()); }
    if (route.endsWith('/auth/refresh')) return revoked ? Response.json({ code: 'invalid_session', message: '登录已失效' }, { status: 401 }) : Response.json(response());
    if (route.endsWith('/auth/logout')) { revoked = true; return new Response(null, { status: 204 }); }
    if (route.endsWith('/account/me')) return revoked ? Response.json({ code: 'invalid_session', message: '登录已失效' }, { status: 401 }) : Response.json(account);
    throw new Error(`Unexpected account route: ${route}`);
   },
  },
 };
}
module.exports = { accountFixture };
