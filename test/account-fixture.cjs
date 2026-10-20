function accountFixture() {
 const calls = [];
 let account = { id: 'fixture-user', email: 'player@example.com', membership: { tier: 'standard', expiresAt: null }, paymentsEnabled: false,
  features: ['library.manage', 'configuration.edit', 'game.launch'].map(key => ({ key, enabled: true, minimumTier: 'standard', allowed: true, version: 1 })) };
 let generation = 0;
 let now = Date.now();
 let failure = null;
 let revoked = false;
 const response = () => ({ accessToken: `access-secret-${++generation}`, refreshToken: `refresh-secret-${generation}`, accessTokenExpiresAt: new Date(now + 900000).toISOString(), account });
 return {
  calls,
  advance(milliseconds) { now += milliseconds; },
  revoke() { revoked = true; },
  updateAccount(change) {
   account = { ...account, ...change };
   if (account.membership.tier === 'pro' && !Object.hasOwn(change, 'aiUsage') && account.aiUsage === undefined) {
    const date = new Date(now);
    account.aiUsage = { limitTokens: 1000000, usedTokens: 0, periodStart: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString(), periodEnd: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString() };
   }
  },
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
    if (route.endsWith('/auth/reset-password') || route.endsWith('/account/password')) {
     if (body.code && body.code !== '246810') return Response.json({ code: 'invalid_code', message: '验证码无效、已使用或已过期。' }, { status: 400 });
     revoked = true; return new Response(null, { status: 204 });
    }
    if (route.endsWith('/account/authorize')) {
     if (revoked) return Response.json({ code: 'invalid_session', message: '登录已失效' }, { status: 401 });
     const feature = account.features.find(item => item.key === body.featureKey);
     const allowed = feature?.enabled === true && feature.allowed === true;
     const reason = !feature ? 'unknown_feature' : !feature.enabled ? 'feature_disabled' : !allowed ? 'pro_required' : 'allowed';
     return Response.json({ allowed, reason, account, code: allowed ? null : reason, message: allowed ? null : '当前账号没有此功能权限。' }, { status: allowed ? 200 : 403 });
    }
    if (route.endsWith('/plans')) return Response.json({ items: [{ id: 'fixture-pro', name: 'Pro', durationDays: 30, priceMinor: 990, currency: 'CNY' }], paymentsEnabled: false });
    if (route.endsWith('/orders') && init.method === 'POST') return Response.json({ code: 'payments_unavailable', message: '支付尚未开放，暂时无法购买。' }, { status: 503 });
    if (route.endsWith('/orders')) return Response.json({ items: [{ id: 'fixture-order', planId: 'fixture-pro', status: 'pending' }], paymentsEnabled: false });
    if (route.endsWith('/orders/fixture-order')) return Response.json({ id: 'fixture-order', planId: 'fixture-pro', status: 'pending' });
    if (route.includes('/orders/')) return Response.json({ code: 'order_not_found', message: '订单不存在。' }, { status: 404 });
    if (route.endsWith('/account/me')) return revoked ? Response.json({ code: 'invalid_session', message: '登录已失效' }, { status: 401 }) : Response.json(account);
    throw new Error(`Unexpected account route: ${route}`);
   },
  },
 };
}
module.exports = { accountFixture };
