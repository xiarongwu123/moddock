const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
function tokenUsage(value) {
 if (!value || typeof value !== 'object') return null;
 const inputTokens = value.inputTokens ?? value.input_tokens ?? value.prompt_tokens;
 const outputTokens = value.outputTokens ?? value.output_tokens ?? value.completion_tokens;
 if (![inputTokens, outputTokens].every(n => Number.isSafeInteger(n) && n >= 0) || !Number.isSafeInteger(inputTokens + outputTokens)) return null;
 return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}
class AIUsage {
 constructor(root) { this.root = path.join(root, 'ai-usage'); this.queue = Promise.resolve(); }
 file(owner) { return path.join(this.root, crypto.createHash('sha256').update(owner).digest('hex') + '.json'); }
 async read(owner) {
  try { const data = JSON.parse(await fs.readFile(this.file(owner), 'utf8')); if (data.version !== 1 || !data.tasks || typeof data.tasks !== 'object') throw new Error('Invalid AI usage journal'); return data; }
  catch (error) { if (error.code !== 'ENOENT') throw error; return { version: 1, tasks: {} }; }
 }
 record(owner, taskId, value) {
  const usage = tokenUsage(value);
  if (!usage) return Promise.reject(Object.assign(new Error('AI 服务没有返回有效 token 用量'), { code: 'AI_USAGE_INVALID' }));
  const pending = this.queue.catch(() => {}).then(async () => {
   const data = await this.read(owner), key = crypto.createHash('sha256').update(taskId).digest('hex'), previous = data.tasks[key];
   // Reports are cumulative per delivery task. Reconnect/replayed frames never charge twice.
   const inputTokens = Math.max(previous?.inputTokens || 0, usage.inputTokens), outputTokens = Math.max(previous?.outputTokens || 0, usage.outputTokens);
   data.tasks[key] = { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, updatedAt: new Date().toISOString() };
   await fs.mkdir(this.root, { recursive: true });
   const file = this.file(owner), temporary = file + '.tmp';
   await fs.writeFile(temporary, JSON.stringify(data), { mode: 0o600 }); await fs.rename(temporary, file);
  });
  this.queue = pending; return pending;
 }
 async view(owner) {
  await this.queue.catch(() => {});
  const tasks = Object.values((await this.read(owner)).tasks);
  return { scope: 'this_device', recordedTasks: tasks.length, ...tasks.reduce((sum, row) => ({ inputTokens: sum.inputTokens + row.inputTokens, outputTokens: sum.outputTokens + row.outputTokens, totalTokens: sum.totalTokens + row.totalTokens }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 }) };
 }
}
module.exports = { AIUsage, tokenUsage };
