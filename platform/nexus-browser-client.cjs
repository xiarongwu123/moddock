const net = require('node:net');
const { setTimeout: wait } = require('node:timers/promises');
const { BrowserChannel, unavailable } = require('./browser-channel.cjs');
const states = new Set(['queued', 'waiting', 'submitted', 'login_required', 'verification_required', 'manual_required', 'authorized', 'failed', 'cancelled']);

class NexusBrowserClient {
 constructor({ socketPath, retry = 1000, initialize, diagnostic }) {
  this.socketPath = socketPath; this.retry = retry; this.initialize = initialize; this.diagnostic = diagnostic;
  this.entries = new Map(); this.active = null; this.ready = false; this.closed = false;
  this.connect();
 }
 connect() {
  if (this.closed) return;
  const socket = net.createConnection(this.socketPath), channel = this.channel = new BrowserChannel(socket);
  const timer = setTimeout(() => socket.destroy(), 5000); timer.unref();
  channel.handle = async (method, input) => {
   const entry = this.entries.get(input?.jobId);
   if (method !== 'grant' || channel !== this.channel || !entry || !entry.context.isCurrent() || typeof input.value !== 'string' || input.value.length > 8192) throw unavailable();
   await entry.context.receive(input.value); return { ok: true };
  };
  channel.on('event', (event, input) => {
   if (channel !== this.channel) return;
   this.lastMessage = Date.now();
   if (event === 'ready') {
    this.browserPid = input?.pid;
    Promise.resolve().then(() => this.initialize?.(channel)).then(() => { if (channel === this.channel && !channel.closed) { clearTimeout(timer); this.ready = true; } }).catch(() => channel.close());
   } else if (event === 'state') {
    const entry = this.entries.get(input?.jobId);
    if (!entry || !states.has(input.state)) return;
    entry.state = input.state;
    if (input.state !== 'queued') this.active = entry;
    if (['authorized', 'failed', 'cancelled'].includes(input.state)) { this.entries.delete(input.jobId); if (this.active === entry) this.active = null; }
    Promise.resolve().then(() => entry.context.onState?.(input.state)).catch(() => {});
   }
  });
  const heartbeat = setInterval(() => { if (this.lastMessage && Date.now() - this.lastMessage > 10000) channel.close(); }, 1000); heartbeat.unref();
  channel.on('close', () => {
   clearTimeout(timer); clearInterval(heartbeat);
   if (channel !== this.channel) return;
   this.ready = false; this.active = null; this.browserPid = null; this.lastMessage = null;
   const entries = [...this.entries.values()]; this.entries.clear();
   for (const entry of entries) Promise.resolve().then(() => entry.context.onState?.('browser_unavailable')).catch(() => {});
   if (entries.length) this.diagnostic?.({ event: 'browser_disconnected', affectedJobs: entries.length });
   if (!this.closed) { this.reconnect = setTimeout(() => this.connect(), this.retry); this.reconnect.unref(); }
  });
 }
 async available() {
  for (let n = 0; !this.ready && !this.closed && n < 100; n++) await wait(50);
  if (!this.ready || this.closed) throw unavailable();
  return this.channel;
 }
 async open(page, context) {
  try {
   const channel = await this.available();
   if (!context.isCurrent()) return;
   this.entries.set(context.jobId, { context, state: 'queued' });
   await channel.request('open', { jobId: context.jobId, page });
  } catch (error) { this.entries.delete(context.jobId); await context.onState?.('browser_unavailable'); throw error; }
 }
 cancel(_owner, jobId) {
  for (const [id, entry] of this.entries) if (!jobId || id === jobId) { this.entries.delete(id); if (this.active === entry) this.active = null; }
  if (this.ready) void this.channel.request('cancel', { jobId }).catch(() => {});
 }
 async view(jobId) { if (!this.ready) return { pending: false }; return this.channel.request('view', { jobId }); }
 async click(jobId, input) { if (!this.ready) return false; return this.channel.request('click', { jobId, input }); }
 async maintenance(screenshot) {
  if (!this.ready) return screenshot ? null : { active: false, browserReady: false };
  const value = await this.channel.request('maintenance', { screenshot });
  return screenshot ? value ? Buffer.from(value, 'base64') : null : { ...value, browserReady: true, browserPid: this.browserPid };
 }
 status() { return { browserReady: this.ready }; }
 close() { this.closed = true; clearTimeout(this.reconnect); this.channel?.close(); }
}
module.exports = { NexusBrowserClient };
