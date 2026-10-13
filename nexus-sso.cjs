const crypto = require('node:crypto');
const active = new Set(['connecting', 'waiting', 'reconnecting', 'saving']);

class NexusSso {
 constructor(options = {}) {
  this.application = options.application || '';
  this.openBrowser = options.openBrowser;
  this.socket = options.socket || (url => new WebSocket(url));
  this.timeout = options.timeout || 180000;
  this.retryDelay = options.retryDelay || 1500;
  this.flows = new Map();
 }
 available() { return /^[a-zA-Z0-9_-]{1,100}$/.test(this.application) && !!this.openBrowser; }
 status(owner) {
  const flow = this.flows.get(owner);
  return { available: this.available(), reason: !this.application ? '当前版本尚未配置 Nexus 应用标识，可使用手动连接。' : !this.available() ? '一键连接需要桌面版和有效的 Nexus 应用标识。' : null,
   status: flow?.status || 'idle', message: flow?.message || '', id: flow?.id || null };
 }
 stop(flow) {
  clearTimeout(flow.timer); clearTimeout(flow.retry); clearInterval(flow.heartbeat);
  try { flow.socket?.close(); } catch {}
  flow.token = null;
 }
 finish(flow, status, message) {
  flow.status = status; flow.message = message; this.stop(flow);
 }
 cancel(owner, id) {
  const flow = this.flows.get(owner);
  if (flow && (!id || flow.id === id) && active.has(flow.status)) this.finish(flow, 'cancelled', '已取消 Nexus 连接');
 }
 forget(owner) { this.cancel(owner); this.flows.delete(owner); }
 close() { for (const owner of this.flows.keys()) this.forget(owner); }
 start(owner, acceptKey) {
  if (!this.available()) throw new Error(this.status(owner).reason);
  this.cancel(owner);
  const flow = { id: crypto.randomUUID(), status: 'connecting', message: '正在连接 Nexus…', token: null, attempts: 0, opened: false };
  this.flows.set(owner, flow);
  const current = () => this.flows.get(owner) === flow && active.has(flow.status);
  flow.timer = setTimeout(() => { if (current()) this.finish(flow, 'expired', 'Nexus 授权已超时，请重新连接'); }, this.timeout);
  flow.timer.unref?.();
  const connect = () => {
   if (!current()) return;
   let socket;
   try { socket = flow.socket = this.socket('wss://sso.nexusmods.com'); }
   catch { this.finish(flow, 'error', '无法连接 Nexus 授权服务，请稍后重试'); return; }
   const live = () => current() && flow.socket === socket;
   socket.addEventListener('open', () => {
    if (!live()) { socket.close(); return; }
    try { socket.send(JSON.stringify({ id: flow.id, token: flow.token, protocol: 2 })); }
    catch { this.finish(flow, 'error', '无法发送 Nexus 授权请求，请重试'); return; }
    flow.status = 'waiting'; flow.message = '请在浏览器登录 Nexus，并确认授权 MODDOCK';
    if (typeof socket.ping === 'function') flow.heartbeat = setInterval(() => { if (live()) { try { socket.ping(); } catch { this.finish(flow, 'error', 'Nexus 授权连接已中断，请重新连接'); } } }, 30000);
    if (!flow.opened) {
     flow.opened = true;
     const url = new URL('https://www.nexusmods.com/sso');
     url.searchParams.set('id', flow.id); url.searchParams.set('application', this.application);
     Promise.resolve().then(() => this.openBrowser(url.href)).catch(() => { if (live()) this.finish(flow, 'error', '无法打开默认浏览器，请重新连接'); });
    }
   });
   socket.addEventListener('message', async event => {
    if (!live() || flow.status === 'saving') return;
    let message;
    try { if (typeof event.data !== 'string' || event.data.length > 16384) throw new Error(); message = JSON.parse(event.data); }
    catch { this.finish(flow, 'error', 'Nexus 授权响应格式无效，请重试'); return; }
    if (message?.success !== true) { this.finish(flow, 'error', 'Nexus 未批准此次连接，请确认应用标识并重试'); return; }
    const data = message.data;
    if (typeof data?.connection_token === 'string' && data.connection_token.length <= 4096) flow.token = data.connection_token;
    if (typeof data?.api_key !== 'string') return;
    if (!data.api_key.trim() || data.api_key.length > 2048 || /[\r\n]/.test(data.api_key)) { this.finish(flow, 'error', 'Nexus 返回的授权无效，请重试'); return; }
    flow.status = 'saving'; flow.message = '正在验证并保存 Nexus 授权…';
    try { await acceptKey(data.api_key, current); if (current()) this.finish(flow, 'connected', 'Nexus 已连接'); }
    catch { if (current()) this.finish(flow, 'error', 'Nexus 授权验证或保存失败，请重新连接'); }
   });
   socket.addEventListener('error', () => { if (live() && !flow.token) this.finish(flow, 'error', '无法连接 Nexus 授权服务，请检查网络后重试'); });
   socket.addEventListener('close', () => {
    clearInterval(flow.heartbeat);
    if (!live() || flow.status === 'saving') return;
    if (flow.token && flow.attempts++ < 2) {
     flow.status = 'reconnecting'; flow.message = '连接中断，正在恢复 Nexus 授权…';
     flow.retry = setTimeout(connect, this.retryDelay);
    } else this.finish(flow, 'error', 'Nexus 授权连接已中断，请重新连接');
   });
  };
  connect(); return this.status(owner);
 }
}
module.exports = { NexusSso };
