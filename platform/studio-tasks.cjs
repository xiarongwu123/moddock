const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { describeError } = require('../studio-errors.cjs');
const MAX_BYTES = 2 * 1024 * 1024;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
async function atomic(file, value) {
 const temporary = file + '.' + crypto.randomUUID() + '.tmp';
 await fs.writeFile(temporary, value, { mode: 0o600, flag: 'wx', flush: true });
 await fs.rename(temporary, file);
}
class StudioTasks {
 constructor({ directory, execute, reserve, logger, timeout = 300000, lease = 25000, retention = 86400000 }) {
  Object.assign(this, { directory, execute, reserve, logger, timeout, lease, retention });
  this.jobs = new Map(); this.locks = new Map(); this.runs = new Set();
  this.ready = this.initialize();
  this.sweeper = setInterval(() => this.prune().catch(() => {}), 3600000); this.sweeper.unref();
 }
 async initialize() {
  await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
  for (const key of await fs.readdir(this.directory)) {
   if (!/^[a-f0-9]{64}$/.test(key)) continue;
   const folder = path.join(this.directory, key);
   const metadata = JSON.parse(await fs.readFile(path.join(folder, 'task.json'), 'utf8'));
   const destination = sha(metadata.id);
   if (key !== destination) {
    if (key !== sha(metadata.owner + ':' + metadata.id)) throw new Error('Invalid task identity');
    await fs.rename(folder, path.join(this.directory, destination));
   }
  }
 }
 validate(value) {
  if (!value || Object.keys(value).some(key => !['version', 'id', 'after', 'operation'].includes(key)) || value.version !== 1
   || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.id || '') || !Number.isSafeInteger(value.after) || value.after < 0 || value.after > 20000
   || !['subscribe', 'cancel'].includes(value.operation)) fail(400, 'invalid_request');
  return value;
 }
 async obtain(owner, action, payload, delivery) {
  await this.ready;
  const key = sha(delivery.id), previous = this.locks.get(key) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
   const hash = sha(JSON.stringify(payload)), folder = path.join(this.directory, key);
   let job = this.jobs.get(key);
   if (!job) {
    let metadata;
    try { metadata = JSON.parse(await fs.readFile(path.join(folder, 'task.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (metadata) {
     if (metadata.owner !== owner || metadata.id !== delivery.id || metadata.action !== action || metadata.hash !== hash) fail(409, 'invalid_request');
     if (metadata.status === 'expired') fail(410, 'studio_task_expired');
     const bytes = await fs.readFile(path.join(folder, 'frames.jsonl'));
     if (bytes.length > MAX_BYTES) fail(500, 'studio_task_interrupted');
     const frames = bytes.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
     if (frames.some((frame, index) => frame.seq !== index + 1)) fail(500, 'studio_task_interrupted');
     job = this.job(metadata, folder, frames, bytes.length); this.jobs.set(key, job);
     const terminal = frames.find(frame => ['result', 'error'].includes(frame.type));
     if (terminal) job.metadata.status = terminal.type === 'result' ? 'completed' : terminal.code === 'studio_cancelled' ? 'cancelled' : 'failed';
     if (!terminal) {
      job.metadata.status = 'failed';
      await this.append(job, { type: 'error', code: 'studio_task_interrupted', diagnostic: describeError(new Error('Creation worker restarted; saved code and progress retained. No generation was replayed.'), 'worker', delivery.id) });
      await atomic(path.join(folder, 'task.json'), JSON.stringify(job.metadata));
     }
     this.trim();
    } else {
     if (delivery.after) fail(410, 'studio_task_expired');
     const metadata = { id: delivery.id, owner, action, hash, created: Date.now(), status: delivery.operation === 'cancel' ? 'cancelled' : 'running' };
     job = this.job(metadata, folder); const release = delivery.operation === 'cancel' ? () => {} : this.reserve(owner, job.controller);
     try {
      await fs.mkdir(folder, { mode: 0o700 });
      await atomic(path.join(folder, 'task.json'), JSON.stringify(metadata));
      await fs.writeFile(path.join(folder, 'frames.jsonl'), '', { flag: 'wx', mode: 0o600, flush: true });
      await atomic(path.join(folder, 'request.json'), JSON.stringify(payload));
      this.jobs.set(key, job);
      if (delivery.operation === 'cancel') await this.append(job, { type: 'error', code: 'studio_cancelled' });
      else {
       const run = this.run(job, payload, release).finally(() => { release(); this.runs.delete(run); });
       this.runs.add(run); run.catch(() => {});
      }
     } catch (error) { release(); throw error; }
    }
   }
   if (job.metadata.owner !== owner || job.metadata.action !== action || job.metadata.hash !== hash) fail(409, 'invalid_request');
   return job;
  });
  this.locks.set(key, operation);
  try { return await operation; } finally { if (this.locks.get(key) === operation) this.locks.delete(key); }
 }
 job(metadata, folder, frames = [], bytes = 0) { return { metadata, folder, frames, bytes, reserved: bytes, seq: frames.length, chain: Promise.resolve(), subscribers: new Set(), controller: new AbortController() }; }
 append(job, value) {
  const frame = { ...value, seq: job.seq + 1 }, line = JSON.stringify(frame) + '\n', reserved = job.reserved + Buffer.byteLength(line);
  if (reserved > MAX_BYTES - 4096 && !['result', 'error'].includes(value.type) || reserved > MAX_BYTES) throw Object.assign(new Error('Creation event journal exceeded its limit'), { code: 'AI_RESPONSE_FORMAT' });
  job.seq++; job.reserved = reserved;
  const operation = job.chain.then(async () => {
   await fs.appendFile(path.join(job.folder, 'frames.jsonl'), line, { mode: 0o600, flush: true });
   job.frames.push(frame); job.bytes += Buffer.byteLength(line);
   for (const res of job.subscribers) {
    if (res.destroyed || res.writableLength > 256 * 1024) { res.destroy(); job.subscribers.delete(res); continue; }
    res.write(line); if (['result', 'error'].includes(frame.type)) res.end();
   }
  });
  job.chain = operation;
  operation.catch(error => { job.failure = error; job.controller.abort(error); });
  return operation;
 }
 async checkpoint(job, file) {
  if (!file || !/^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$/.test(file.name) || file.name.split('/').some(part => ['', '.', '..'].includes(part)) || typeof file.text !== 'string' || Buffer.byteLength(file.text) > 128 * 1024) throw new Error('Invalid project checkpoint');
  const destination = path.join(job.folder, 'project', file.name);
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await atomic(destination, file.text);
 }
 async run(job, payload, release) {
  const { id, owner, action } = job.metadata, timer = setTimeout(() => job.controller.abort(new Error('Creation deadline exceeded')), this.timeout);
  const signal = job.controller.signal;
  const writeLog = diagnostic => {
   job.diagnostic = { ...diagnostic, traceId: id };
   return this.logger?.write({ taskId: id, action, diagnostic: job.diagnostic }) || Promise.resolve();
  };
  try {
   await this.logger?.write({ taskId: id, action, stage: 'started' });
   signal.throwIfAborted();
  const result = await this.execute(action, { ...payload, accountId: owner, taskId: id, signal,
    checkpoint: file => this.checkpoint(job, file), onDiagnostic: writeLog,
    onUsage: usage => this.append(job, { type: 'usage', usage }),
    onEvent: event => { if (signal.aborted || job.metadata.status !== 'running') return; try { void this.append(job, { type: 'event', event }); } catch (error) { job.failure = error; job.controller.abort(error); } } });
   signal.throwIfAborted();
   if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) throw Object.assign(new Error('Invalid creation result size'), { code: 'AI_RESPONSE_FORMAT' });
   release();
   await this.append(job, { type: 'result', result }); job.metadata.status = 'completed';
   await this.logger?.write({ taskId: id, action, stage: 'completed', lastSequence: job.seq });
  } catch (error) {
   release();
   const failure = job.failure || error;
   const diagnostic = failure.diagnostic || (job.diagnostic?.stage === 'model' ? job.diagnostic : describeError(failure, signal.aborted ? 'worker' : 'creation', id));
   await writeLog(diagnostic).catch(() => {});
   const code = ['pro_required', 'ai_quota_unconfigured', 'ai_credits_exhausted'].includes(error.code) ? error.code : signal.aborted ? job.cancelled ? 'studio_cancelled' : 'studio_task_interrupted'
    : /HTTP 402/.test(error.message) ? 'ai_credits_exhausted' : /HTTP 429/.test(error.message) ? 'studio_rate_limited'
    : ['AI_RESPONSE_FORMAT', 'AI_ARTIFACT_INVALID'].includes(error.code) ? 'ai_response_invalid' : 'studio_unavailable';
   job.metadata.status = job.cancelled ? 'cancelled' : 'failed';
   try { await job.chain; await this.append(job, { type: 'error', code, diagnostic }); } catch { for (const res of job.subscribers) res.destroy(); }
  } finally {
   clearTimeout(timer);
   await atomic(path.join(job.folder, 'task.json'), JSON.stringify(job.metadata)).catch(() => {});
   this.trim();
  }
 }
 trim() {
  for (const [key, job] of this.jobs) {
   if (this.jobs.size <= 20) break;
   if (job.metadata.status !== 'running' && !job.subscribers.size) this.jobs.delete(key);
  }
 }
 async handle(req, res, owner, action, payload, input) {
  const delivery = this.validate(input), job = await this.obtain(owner, action, payload, delivery);
  if (delivery.operation === 'cancel') {
   job.cancelled = true; job.controller.abort(new Error('User stopped creation'));
   res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"cancelled":true}'); return;
  }
  if (delivery.after > job.frames.length || job.subscribers.size >= 3) fail(400, 'invalid_request');
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
  res.write(JSON.stringify({ type: 'task', version: 1, id: delivery.id, status: job.metadata.status }) + '\n');
  for (const frame of job.frames) if (frame.seq > delivery.after) res.write(JSON.stringify(frame) + '\n');
  if (job.frames.some(frame => ['result', 'error'].includes(frame.type))) { res.end(); return; }
  job.subscribers.add(res);
  await new Promise(resolve => {
   const heartbeat = setInterval(() => { if (!res.destroyed) res.write('{"type":"heartbeat"}\n'); }, 10000);
   const lease = setTimeout(() => { if (!res.destroyed) res.end('{"type":"checkpoint"}\n'); }, this.lease);
   res.once('close', () => { clearInterval(heartbeat); clearTimeout(lease); job.subscribers.delete(res); resolve(); });
  });
 }
 async prune() {
  await this.ready;
  for (const key of await fs.readdir(this.directory)) {
   if (!/^[a-f0-9]{64}$/.test(key)) continue;
   const folder = path.join(this.directory, key), file = path.join(folder, 'task.json');
   const metadata = JSON.parse(await fs.readFile(file, 'utf8'));
   if (metadata.status === 'running' || metadata.status === 'expired' || metadata.created > Date.now() - this.retention) continue;
   await atomic(file, JSON.stringify({ ...metadata, status: 'expired' }));
   for (const name of ['frames.jsonl', 'request.json', 'project']) await fs.rm(path.join(folder, name), { force: true, recursive: true });
   this.jobs.delete(key);
  }
 }
 async close() { clearInterval(this.sweeper); for (const job of this.jobs.values()) job.controller.abort(new Error('Creation worker shutting down')); await Promise.allSettled([...this.runs]); }
}
module.exports = { StudioTasks };
