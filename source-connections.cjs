const { Sources } = require('./sources.cjs');

class SourceConnections {
 constructor(scope, options = {}, store) { this.scope = scope; this.options = options; this.store = store; this.entries = new Map(); }
 async get(owner) {
  if (!this.entries.has(owner)) {
   const entry = { sources: new Sources(this.options), saved: {}, warning: null, queue: Promise.resolve(), disposed: false };
   this.entries.set(owner, entry);
   entry.ready = (async () => {
    try {
     const keys = await this.store?.read(this.scope + '\n' + owner) || {};
     if (entry.disposed) return;
     for (const [source, key] of Object.entries(keys)) { entry.sources.connect(source, key); entry.saved[source] = !!key; }
    } catch { entry.warning = '无法解密已保存的来源授权，请重新连接；原加密文件已保留。'; }
   })();
  }
  const entry = this.entries.get(owner); await entry.ready;
  if (entry.disposed) throw new Error('账号已退出，请重新登录');
  return entry;
 }
 async status(owner) {
  const entry = await this.get(owner);
  return { ...entry.sources.status(), persistent: !!this.store?.isAvailable(), saved: { ...entry.saved }, warning: entry.warning };
 }
 async connect(owner, source, key, current = () => true) {
  const entry = await this.get(owner);
  const work = entry.queue.catch(() => {}).then(async () => {
   if (entry.disposed || !current()) throw new Error('授权已取消，请重新连接');
   // Validate without replacing a working key if encryption or persistence fails.
   const probe = new Sources(); probe.connect(source, key);
   const next = { ...entry.sources.keys, [source]: probe.keys[source] };
   const persistent = !!this.store?.isAvailable();
   if (persistent || !probe.keys[source]) {
    const saved = persistent ? next : Object.fromEntries(Object.entries(next).filter(([name]) => entry.saved[name]));
    try { await this.store?.write(this.scope + '\n' + owner, saved, () => !entry.disposed && current()); }
    catch { throw new Error('无法保存来源授权，请检查系统加密服务和数据目录权限'); }
   }
   if (entry.disposed || !current()) throw new Error('授权已取消，请重新连接');
   entry.sources.connect(source, key);
   entry.saved[source] = persistent && !!probe.keys[source];
   entry.warning = persistent ? null : '当前环境不支持系统加密，授权仅在本次运行有效。';
  });
  entry.queue = work; await work;
  if (entry.disposed) return null;
  return this.status(owner);
 }
 release(owner) {
  const entry = this.entries.get(owner); if (!entry) return;
  entry.disposed = true;
  for (const source of ['nexus', 'workshop']) entry.sources.connect(source, '');
  this.entries.delete(owner);
 }
 close() { for (const owner of this.entries.keys()) this.release(owner); }
}
module.exports = { SourceConnections };
