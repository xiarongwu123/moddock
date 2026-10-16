const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const MAX_MESSAGE = 2 * 1024 * 1024;
const unavailable = () => Object.assign(new Error('授权浏览器正在恢复，请重新下载'), { code: 'BROWSER_UNAVAILABLE' });

class BrowserChannel extends EventEmitter {
 constructor(socket) {
  super(); this.socket = socket; this.pending = new Map(); this.buffer = ''; this.closed = false;
  socket.setEncoding('utf8');
  socket.on('data', bytes => {
   this.buffer += bytes;
   try {
    let end;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
     const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
     if (Buffer.byteLength(line) > MAX_MESSAGE) throw unavailable();
     this.message(JSON.parse(line));
    }
    if (Buffer.byteLength(this.buffer) > MAX_MESSAGE) throw unavailable();
   } catch { socket.destroy(); }
  });
  socket.on('error', () => {});
  socket.on('close', () => {
   this.closed = true;
   for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(unavailable()); }
   this.pending.clear(); this.emit('close');
  });
 }
 send(value) {
  const bytes = JSON.stringify(value) + '\n';
  if (this.closed || this.socket.destroyed || Buffer.byteLength(bytes) > MAX_MESSAGE || this.socket.writableLength + Buffer.byteLength(bytes) > MAX_MESSAGE * 2) { this.socket.destroy(); throw unavailable(); }
  this.socket.write(bytes);
 }
 notify(event, data) { if (!this.closed) { try { this.send({ event, data }); } catch {} } }
 request(method, args, timeout = 5000) {
  if (this.closed || this.pending.size >= 32) return Promise.reject(unavailable());
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
   const timer = setTimeout(() => { this.pending.delete(id); reject(unavailable()); this.socket.destroy(); }, timeout); timer.unref();
   this.pending.set(id, { resolve, reject, timer });
   try { this.send({ id, method, args }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
  });
 }
 message(message) {
  if (!message || typeof message !== 'object') throw unavailable();
  if (message.reply) {
   const pending = this.pending.get(message.reply); if (!pending) return;
   this.pending.delete(message.reply); clearTimeout(pending.timer);
   if (message.error) pending.reject(unavailable()); else pending.resolve(message.result);
  } else if (typeof message.event === 'string') this.emit('event', message.event, message.data);
  else if (/^[a-f0-9-]{36}$/.test(message.id || '') && typeof message.method === 'string') {
   Promise.resolve().then(() => this.handle?.(message.method, message.args)).then(result => { if (!this.closed) this.send({ reply: message.id, result }); }, () => { if (!this.closed) this.send({ reply: message.id, error: true }); }).catch(() => this.socket.destroy());
  } else throw unavailable();
 }
 close() { this.socket.destroy(); }
}
module.exports = { BrowserChannel, unavailable };
