const { createAuthClient } = require('../auth/client.cjs');

function createAccountStore(options = {}) {
 const client = options.client || createAuthClient(options.fetch || fetch, options.now || Date.now);
 const now = options.now || Date.now;
 const schedule = options.setInterval || setInterval;
 const cancel = options.clearInterval || clearInterval;
 const listeners = new Set();
 let queue = Promise.resolve(), timer = null, active = false, disposed = false;
 let failureStarted = null, verified = false;
 let state = { account: null, hasSession: false, online: false, busy: false, error: null, remember: false, storageWarning: null };
 const getState = () => structuredClone({ ...state,
  isReconnecting: state.hasSession && verified && !state.online && failureStarted !== null && now() - failureStarted < 120000,
  canKeepVerifiedView: state.online || (state.hasSession && verified && failureStarted !== null && now() - failureStarted < 120000),
 });
 const notify = () => { if (!disposed) for (const listener of listeners) { try { listener(getState()); } catch {} } };
 function updateTimer() {
  if (active && state.hasSession && !disposed && timer === null) timer = schedule(() => { if (!state.busy) refresh().catch(() => {}); }, 30000);
  if ((!active || !state.hasSession || disposed) && timer !== null) { cancel(timer); timer = null; }
 }
 function applySession() {
  const details = client.getSessionDetails();
  state.account = details.profile; state.hasSession = !!details.profile; state.online = !!details.profile;
  state.remember = details.remember === true; state.storageWarning = details.storageWarning || null;
  verified = state.online; failureStarted = null;
 }
 function run(action) {
  const pending = queue.catch(() => {}).then(async () => {
   if (disposed) throw new Error('Account store is disposed');
   state.busy = true; state.error = null; notify();
   try { const result = await action(); return result; }
   catch (error) {
    state.error = { code: error.code || 'account_error', message: error.message, status: error.status, retryAfterSeconds: error.retryAfterSeconds, reason: error.reason };
    if (error.account) state.account = error.account;
    if (error.status === 401 || ['disabled', 'account_disabled', 'user_disabled', 'invalid_response'].includes(error.code)) {
     state.account = null; state.hasSession = false; state.online = false; state.remember = false; verified = false; failureStarted = null;
    } else if (error.account && state.hasSession) {
     state.online = true; verified = true; failureStarted = null;
    } else if (state.hasSession && error.code !== 'payments_unavailable' && (!error.status || error.status >= 500 || [408, 429].includes(error.status))) {
     state.online = false; if (verified) failureStarted ??= now();
    }
    throw error;
   } finally { state.busy = false; updateTimer(); notify(); }
  });
  queue = pending; return pending;
 }
 const refresh = () => run(async () => { const result = await client.me(); applySession(); return result; });
 const sessionAction = action => run(async () => { const result = await action(); applySession(); return result; });
 return {
  getState,
  subscribe(listener) { if (disposed) throw new Error('Account store is disposed'); listeners.add(listener); listener(getState()); return () => listeners.delete(listener); },
  setActive(value) { active = value === true; updateTimer(); },
  config: () => client.config(),
  initialize: () => sessionAction(() => client.session()),
  login: input => sessionAction(() => client.login(input)),
  register: input => sessionAction(() => client.register(input)),
  restore: () => sessionAction(() => client.restore()),
  sendCode: input => run(() => client.sendCode(input)),
  resetPassword: input => sessionAction(() => client.resetPassword(input)),
  changePassword: input => sessionAction(() => client.changePassword(input)),
  logout: () => run(async () => { try { return await client.logout(); } finally { applySession(); } }),
  refresh,
  authorize: featureKey => sessionAction(() => client.authorize(featureKey)),
  hasFeature: featureKey => state.account?.features?.some(feature => feature.key === featureKey && feature.enabled && feature.allowed) === true,
  plans: () => run(() => client.plans()),
  orders: () => run(() => client.orders()),
  order: orderId => run(() => client.order(orderId)),
  createOrder: planId => run(() => client.createOrder(planId)),
  dispose() { disposed = true; updateTimer(); listeners.clear(); },
 };
}
module.exports = { createAccountStore };
