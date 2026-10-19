const { randomUUID } = require('node:crypto');

class InstallationProgress {
 constructor() { this.task = null; }
 view(owner) {
  if (!this.task || this.task.owner !== owner) return null;
  const { owner: ignored, ...task } = this.task;
  return task;
 }
 async run(job, owner, id, work) {
  if (this.task?.status === 'running') throw new Error('正在处理安装任务，请稍后');
  if (id !== undefined && !/^[a-f0-9-]{36}$/i.test(id)) throw new Error('安装任务标识无效');
  const task = this.task = { id: id || randomUUID(), owner, jobId: job.id, gameId: job.gameId,
   name: job.name, status: 'running', phase: 'environment', percent: 0,
   message: '正在检查游戏和安装环境…', file: '', processed: 0, total: 0, startedAt: Date.now(), updatedAt: Date.now() };
  const report = (phase, percent, message, details = {}) => {
   if (task.status !== 'running') return;
   Object.assign(task, { phase, percent: Math.max(task.percent, Math.min(99, percent)), message,
    file: '', processed: 0, total: 0 }, details, { updatedAt: Date.now() });
  };
  try {
   const result = await work(report);
   Object.assign(task, { status: 'completed', phase: 'completed', percent: 100,
    message: 'MOD 安装完成，文件已校验，原始文件已备份。', file: '', processed: 0, total: 0, updatedAt: Date.now() });
   return result;
  } catch (error) {
   Object.assign(task, { status: 'failed', phase: 'failed', message: error.message, updatedAt: Date.now() });
   throw error;
  }
 }
}

module.exports = { InstallationProgress };
