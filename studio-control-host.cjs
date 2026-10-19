const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { target } = require('./installers.cjs');
const { validateControls, valuesFor } = require('./bg3-controls.cjs');

async function readJSON(root, relative) {
 try {
  const file = await target(root, relative), stat = await fs.lstat(file);
  if (!stat.isFile() || stat.size > 16384) throw new Error('Mod 控制记录无效');
  return { value: JSON.parse(await fs.readFile(file, 'utf8')), mtime: stat.mtimeMs };
 } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
class StudioControlHost {
 constructor(lifecycle) { this.lifecycle = lifecycle; this.queues = new Map(); }
 async resolve(context) {
  await this.lifecycle.permission(context, 'library.manage');
  const artifact = await this.lifecycle.studio.read(context.owner, context.artifactId);
  if (artifact.gameId !== context.game.id || !artifact.runtime?.control || artifact.adapterId !== 'bg3-lua') throw new Error('此 Mod 尚未接入参数控制');
  const job = this.lifecycle.jobFor(context.owner, context.game, artifact, artifact.toolchain?.id);
  const mod = job && this.lifecycle.installers.state.mods.find(mod => mod.jobId === job.id && mod.gameId === context.game.id && mod.status === 'enabled');
  if (!mod || mod.profile.mode !== 'bg3') throw new Error('请先安装并启用当前版本 Mod，再调整参数');
  const verified = await this.lifecycle.installers.action(context.game, mod.id, 'verify');
  if (verified.verification.status !== 'files_ok') throw new Error(verified.verification.message);
  const relative = `Script Extender/Moddock/${artifact.id}`;
  if (artifact.runtime.control.root !== relative) throw new Error('Mod 控制目录不匹配');
  return { artifact, mod, relative, schema: validateControls(artifact.draft.controls) };
 }
 async get(context) {
  const state = await this.resolve(context);
  return this.snapshot(context, state);
 }
 async snapshot(context, { artifact, mod, relative, schema }) {
  const stored = await readJSON(mod.root, relative + '/settings.json');
  const enabled = stored ? stored.value.enabled : true;
  if (typeof enabled !== 'boolean') throw new Error('Mod 开关记录无效');
  const values = valuesFor(schema, stored?.value.values || {});
  const revision = stored?.value.revision || 'default';
  const response = await readJSON(mod.root, relative + '/state.json');
  const isCurrent = response?.value.revision === revision && (!stored || response.mtime >= stored.mtime);
  const runtime = isCurrent ? { status: response.value.status, error: typeof response.value.error === 'string' ? response.value.error.slice(0, 500) : '' } : { status: 'pending' };
  this.lifecycle.check(context);
  return { artifactId: artifact.id, schema, enabled, values, revision, runtime,
   message: runtime.status === 'applied' ? '游戏脚本已确认应用本次参数；实际玩法效果请在游戏中确认。' : runtime.status === 'error' ? '游戏脚本处理失败：' + runtime.error : '参数已保留，等待游戏加载当前 Mod 后确认。' };
 }
 update(context, input) {
  const key = context.owner + ':' + context.artifactId, previous = this.queues.get(key) || Promise.resolve();
  const pending = previous.catch(() => {}).then(() => this.write(context, input)); this.queues.set(key, pending);
  return pending.finally(() => { if (this.queues.get(key) === pending) this.queues.delete(key); });
 }
 async write(context, input) {
  const resolved = await this.resolve(context), { mod, relative, schema } = resolved;
  const before = await this.snapshot(context, resolved);
  if (!input || !['settings', 'action'].includes(input.operation)) throw new Error('Mod 控制操作无效');
  let record, name;
  if (input.operation === 'settings') {
   if (input.revision !== before.revision) throw new Error('参数已在其他窗口更新，请刷新后重试');
   if (typeof input.enabled !== 'boolean') throw new Error('Mod 开关参数无效');
   record = { enabled: input.enabled, values: valuesFor(schema, input.values), revision: crypto.randomUUID() }; name = 'settings';
  } else {
   if (!before.enabled || !schema.some(control => control.type === 'action' && control.key === input.action)) throw new Error('此动作不可用');
   const previous = await readJSON(mod.root, relative + '/input.json');
   const ack = await readJSON(mod.root, relative + '/ack.json');
   if (previous && previous.value.nonce !== ack?.value.nonce && Date.now() - previous.mtime < 3000) throw new Error('上一动作仍在等待游戏处理，请稍后重试');
   record = { nonce: crypto.randomUUID(), action: input.action }; name = 'input';
  }
  await this.lifecycle.permission(context, 'library.manage');
  const file = await target(mod.root, relative + '/' + name + '.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = await target(mod.root, relative + '/' + name + '.' + crypto.randomUUID() + '.tmp');
  try { await fs.writeFile(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 }); this.lifecycle.check(context); await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
  if (name === 'settings') return this.snapshot(context, resolved);
  return { artifactId: resolved.artifact.id, nonce: record.nonce, status: 'pending', message: '动作已发送，等待当前游戏脚本确认；重复执行可能累加效果。' };
 }
 async actionStatus(context, nonce) {
  if (!/^[a-f0-9-]{36}$/.test(nonce || '')) throw new Error('动作编号无效');
  const { mod, relative } = await this.resolve(context);
  const input = await readJSON(mod.root, relative + '/input.json'), ack = await readJSON(mod.root, relative + '/ack.json');
  const matched = input?.value.nonce === nonce && ack?.value.nonce === nonce && ack.mtime >= input.mtime;
  this.lifecycle.check(context);
  return { nonce, status: matched ? ack.value.status : 'pending', message: matched ? ack.value.status === 'applied' ? '游戏脚本已执行该动作；效果请在游戏中确认。' : '动作执行失败：' + String(ack.value.error || '').slice(0, 500) : '尚未收到当前动作的游戏确认。' };
 }
}
module.exports = { StudioControlHost, readJSON };
