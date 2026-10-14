function advanceNexusAuthorization(page, submitted = false) {
 const expected = new URL(page), current = new URL(location.href);
 const visible = element => !!(element.getClientRects().length && (element.checkVisibility ? element.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : getComputedStyle(element).visibility !== 'hidden'));
 const body = document.body?.innerText || '';
 if (current.hostname === 'users.nexusmods.com' && document.querySelector('input[type="password"]')) return { state: 'login_required' };
 const verified = [...document.querySelectorAll('input[name="cf-turnstile-response"],textarea[name="g-recaptcha-response"],textarea[name="h-captcha-response"]')].some(input => !!input.value);
 if (/verify you are human|checking your browser|verify.*human|验证码|人机验证/i.test(body) || (!verified && [...document.querySelectorAll('iframe')].some(frame => visible(frame) && /challenges\.cloudflare\.com|recaptcha|hcaptcha/i.test(frame.src)))) return { state: 'verification_required' };
 if (current.pathname !== expected.pathname || current.searchParams.get('file_id') !== expected.searchParams.get('file_id') || current.searchParams.get('nmm') !== '1') return { state: 'waiting', reason: 'different_file_page' };
 const mod = expected.pathname.match(/^\/([a-z0-9_-]+)\/mods\/([1-9]\d*)$/);
 for (const link of document.querySelectorAll('a[href^="nxm://"]')) {
  try {
   const grant = new URL(link.href);
   if (mod && grant.hostname === mod[1] && grant.pathname === `/mods/${mod[2]}/files/${expected.searchParams.get('file_id')}`) return { state: 'grant', url: link.href };
  } catch {}
 }
 const roots = [document];
 for (const root of roots) for (const element of root.querySelectorAll('*')) if (element.shadowRoot) roots.push(element.shadowRoot);
 const allControls = roots.flatMap(root => [...root.querySelectorAll('button,a,input[type="button"],input[type="submit"],[role="button"],#slowDownloadButton')]);
 const controls = allControls.filter(visible);
 const label = element => String(element.getAttribute('aria-label') || element.innerText || element.textContent || element.value || '').replace(/\s+/g, ' ').trim();
 const login = controls.find(element => /^(log in|sign in)$/i.test(label(element)));
 if (login) {
  if (login.tagName === 'A') { try { const url = new URL(login.href); if (url.protocol === 'https:' && url.hostname === 'users.nexusmods.com' && url.pathname === '/auth/sign_in') login.click(); } catch {} }
  return { state: 'login_required' };
 }
 const slow = controls.find(element => /^slow download$/i.test(label(element)));
 if (!submitted && slow && !slow.disabled && slow.getAttribute('aria-disabled') !== 'true') { slow.click(); return { state: 'submitted' }; }
 return { state: 'waiting', reason: 'no_download_control', shadowRoots: roots.length - 1, controls: allControls.filter(element => /download/i.test(label(element))).map(element => ({ tag: element.tagName, label: label(element).slice(0, 80), visible: visible(element) })).slice(0, 12) };
}

class NexusAuthorizer {
 constructor(options) { this.options = options; this.queue = []; this.active = null; }
 notify(entry, state) {
  if (entry.state === state) return;
  entry.state = state;
  Promise.resolve(entry.context.onState?.(state)).catch(() => {});
  if (['login_required', 'verification_required', 'manual_required', 'failed'].includes(state) && entry.window && !entry.window.isDestroyed()) { entry.window.show(); entry.window.focus(); }
 }
 async open(page, context = {}) {
  const url = new URL(page);
  if (!this.options.isAllowed(page) || !/^\/([a-z0-9_-]+)\/mods\/[1-9]\d*$/.test(url.pathname) || !/^[1-9]\d*$/.test(url.searchParams.get('file_id') || '') || url.searchParams.get('nmm') !== '1') throw new Error('无效的 Nexus 文件授权页面');
  const existing = [this.active, ...this.queue].find(entry => entry && entry.page === page && entry.context.owner === context.owner && entry.context.jobId === context.jobId);
  if (existing && !['failed', 'manual_required'].includes(existing.state)) { if (existing.window && ['login_required', 'verification_required'].includes(existing.state)) { existing.window.show(); existing.window.focus(); } return; }
  if (existing) this.cancelEntry(existing);
  if (this.queue.length >= 20) throw new Error('Nexus 文件授权队列已满');
  const entry = { page, context, started: Date.now(), state: null, done: false, checking: false, receiving: false };
  this.queue.push(entry); this.notify(entry, 'queued');
  await this.next();
 }
 async next() {
  if (this.active) return;
  const entry = this.queue.shift(); if (!entry) return;
  if (entry.context.isCurrent && !entry.context.isCurrent()) { this.notify(entry, 'cancelled'); return this.next(); }
  this.active = entry; entry.started = Date.now();
  const window = entry.window = this.options.createWindow();
  const intercept = (event, url) => {
   url = event.url || url;
   if (/^nxm:\/\//i.test(url)) { event.preventDefault(); void this.accept(entry, url); }
   else if (event.isMainFrame !== false && !this.options.isAllowed(url)) event.preventDefault();
  };
  window.webContents.on('will-navigate', intercept);
  window.webContents.on('will-redirect', intercept);
  window.webContents.on('will-frame-navigate', intercept);
  window.webContents.on('render-process-gone', () => { void this.fail(entry); });
  window.webContents.on('did-finish-load', () => { void this.drive(entry); });
  window.webContents.setWindowOpenHandler(({ url }) => {
   if (/^nxm:\/\//i.test(url)) void this.accept(entry, url);
   else if (this.options.isAllowed(url)) void window.loadURL(url).catch(() => this.fail(entry));
   return { action: 'deny' };
  });
  window.on('closed', () => { if (!entry.done) this.cancel(entry.context.owner); });
  entry.timer = setInterval(() => { void this.drive(entry); }, this.options.interval || 700);
  entry.timer.unref?.();
  this.notify(entry, 'waiting');
  try { await window.loadURL(entry.page); await this.drive(entry); }
  catch { if (!entry.done && !entry.receiving) await this.fail(entry); }
 }
 async drive(entry) {
  if (entry.done || entry.checking || entry.receiving || entry !== this.active || entry.window.isDestroyed()) return;
  if (entry.context.isCurrent && !entry.context.isCurrent()) return this.cancel(entry.context.owner);
  if (Date.now() - entry.started > (this.options.timeout || 10 * 60 * 1000)) { clearInterval(entry.timer); this.notify(entry, 'manual_required'); return; }
  if (!this.options.isAllowed(entry.window.webContents.getURL())) return;
  entry.checking = true;
  try {
   const result = await entry.window.webContents.executeJavaScript(`(${advanceNexusAuthorization.toString()})(${JSON.stringify(entry.page)},${entry.state === 'submitted'})`);
   if (entry.done || entry !== this.active) return;
   if (result.state === 'grant') await this.accept(entry, result.url);
   else if (result.state !== 'waiting' || !['login_required', 'verification_required', 'submitted', 'manual_required', 'failed'].includes(entry.state)) this.notify(entry, result.state);
   if (result.state === 'waiting' && Date.now() - entry.started > 15000 && entry.state === 'waiting') { this.options.diagnostic?.(result); this.notify(entry, 'manual_required'); }
  } catch (error) { if (!entry.diagnosticError) { entry.diagnosticError = true; this.options.diagnostic?.({ state: 'script_error', message: String(error.message).replace(/(?:nxm|https?):\/\/\S+/g, '[url]').slice(0, 200) }); } if (!entry.done && !entry.window.isDestroyed()) this.notify(entry, 'manual_required'); }
  finally { entry.checking = false; }
 }
 async accept(entry, value) {
  if (entry.done || entry.receiving || entry !== this.active) return;
  if (entry.context.isCurrent && !entry.context.isCurrent()) return this.cancel(entry.context.owner);
  entry.receiving = true;
  try {
   await (entry.context.receive || this.options.receive)(value);
   if (entry.done) return;
   this.notify(entry, 'authorized'); this.finish(entry); this.options.focus?.(); await this.next();
  } catch { if (!entry.done) await this.fail(entry); }
  finally { entry.receiving = false; }
 }
 async fail(entry) {
  if (entry.done) return;
  this.notify(entry, 'failed'); this.finish(entry); await this.next();
 }
 finish(entry) {
  entry.done = true; clearInterval(entry.timer);
  if (this.active === entry) this.active = null;
  this.queue = this.queue.filter(item => item !== entry);
  if (entry.window && !entry.window.isDestroyed()) entry.window.close();
 }
 cancelEntry(entry) { this.notify(entry, 'cancelled'); this.finish(entry); }
 cancel(owner, jobId) {
  for (const entry of [this.active, ...this.queue]) if (entry && (owner === undefined || entry.context.owner === owner) && (!jobId || entry.context.jobId === jobId)) this.cancelEntry(entry);
  void this.next();
 }
 close() { for (const entry of [this.active, ...this.queue]) if (entry) this.cancelEntry(entry); }
}
module.exports = { NexusAuthorizer, advanceNexusAuthorization };
