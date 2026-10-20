const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { crc32 } = require('node:zlib');
const { diagnoseGame, smallJson } = require('./game-diagnostics.cjs');
const { zipContent, NPCS, DAYS } = require('./content-pack.cjs');
const { UniversalModder } = require('./universal-modder.cjs');
const { recipesFor, buildStudioProject, projectRule } = require('./studio-recipes.cjs');
const { AccountError } = require('./account.cjs');
const { StudioConversations } = require('./studio-conversations.cjs');
const { StudioToolchain } = require('./studio-toolchain.cjs');
const { selectSkills } = require('./studio-skills.cjs');
const { removeStudioSamples } = require('./studio-migration.cjs');

function studioAccess(account) {
 return require('./ai-policy.cjs').hasPro(account);
}
class ModStudio {
 constructor(root, options = {}) { this.root = path.join(root, 'creations'); this.options = options; this.integration = new UniversalModder(options.integration); this.pending = new Map(); this.queues = new Map(); this.native = new (require('./studio-native-projects.cjs').NativeProjects)(options.tools); this.toolchain = new StudioToolchain(this, options.tools); this.conversations = new StudioConversations(this); this.ready = removeStudioSamples(this.root); this.ready.catch(() => {}); }
 status(account) { return { allowed: studioAccess(account), requiredTier: 'pro', aiAvailable: typeof this.options.plan === 'function' && typeof this.options.generate === 'function', provider: this.options.provider || null, npcs: NPCS, days: DAYS }; }
 directory(owner) { return path.join(this.root, crypto.createHash('sha256').update(owner).digest('hex')); }
 async workspace(game) {
  const diagnostic = await this.integration.diagnose(game, await diagnoseGame(game));
  const context = await this.integration.context(game, diagnostic);
  context.engineEvidence = await require('./studio-engines.cjs').collectEngineEvidence(game, diagnostic);
  context.engineEvidence = await this.native.snapshot(game, context.engineEvidence);
  if (diagnostic.engine.key === 'unreal') {
   const safety = require('./studio-ue4ss-safety.cjs');
   context.engineEvidence.installedUE4SS = await safety.installedUE4SS(game, diagnostic);
   context.guide.text = await safety.agentGuide(context.guide.text);
  }
  if (diagnostic.engine.key !== 'unreal' && recipesFor(game,diagnostic).some(t=>t.id==='reframework-lua' && t.available)) {
   const skill=await fs.readFile(path.join(__dirname,'skills/ue4ss-runtime-safety/SKILL.md'),'utf8');
   const contract=skill.split('## Mandatory executable acceptance contract')[1]?.split('\n## ')[0] || '';
   context.guide.text=('REFramework host runtime verification contract:\n'+contract+'\n'+context.guide.text).slice(0,12000);
  }
  return { diagnostic, context, skills: selectSkills(game, diagnostic), types: this.toolchain.catalog(recipesFor(game, diagnostic)) };
 }
 async prepareNative(game, context) {
  const diagnostic = await diagnoseGame(game);
  if (diagnostic.antiCheat.length || diagnostic.onlineOnly) return;
  const evidence = await require('./studio-engines.cjs').collectEngineEvidence(game, diagnostic);
  await this.native.prepare(game, evidence, { ...context, diagnostic });
 }
 async ruleFor(game, item, savedRule, owner) {
  if (owner && item.artifactId && ['ue4ss-lua', 'reframework-lua'].includes(item.adapterId) && !item.draft?.code) {
   item = (await this.deploymentArchive(owner, game, item.artifactId)).item;
  }
  if (item.adapterId === 'engine-mod' && item.compiled && !item.toolchain?.deployment && item.artifactId && owner) {
   const saved = await this.deploymentArchive(owner, game, item.artifactId);
   if (saved.item.buildId !== item.buildId) throw new Error('此创作已有更新构建，请在创作中重新存入 Mod 库');
   item = saved.item;
  }
  if (item.toolchain && item.toolchain.status !== 'passed') throw new Error('此产物尚未通过制作与文件验证，请先在对话中处理构建结果。');
  if (item.runtime?.verification && !require('./studio-runtime-verification.cjs').contract(item.draft.code).passed) throw new Error('此版本缺少有效的功能回读验收，请由 Agent 重新制作并验证。');
  if (item.adapterId === 'ue4ss-lua') {
   const risk = require('./studio-ue4ss-safety.cjs').analyzeUE4SS(item.draft.code, { game });
   if (!risk.passed) throw Object.assign(new Error('此脚本未通过当前 UE4SS 风险校验，请在创作中要求修复该作品，Agent 会收到以下诊断：' + risk.findings.filter(f => f.severity === 'error').map(f => `${f.code}:${f.line} ${f.message}`).join('；')), { code: 'UE4SS_RISK_CHECK_FAILED', findings: risk.findings });
  }
  const { diagnostic, types } = await this.workspace(game), kind = item.adapterId || item.draft.kind;
  if (!types.find(type => type.id === kind)?.available) throw new Error('当前游戏环境不支持这份创作，请重新诊断并核对适配类型。');
  if (!['dialogue','texture'].includes(kind)) return projectRule(item, diagnostic);
  let contentRoot = '';
  for (const candidate of [...new Set([...(savedRule?.mode === 'smapi' ? [savedRule.root] : []), '', 'Contents/MacOS'])]) {
   try { const stat = await fs.lstat(path.join(game.installPath, candidate, 'StardewModdingAPI.dll')); if (stat.isFile() && !stat.isSymbolicLink()) { contentRoot = candidate; break; } } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { mode: 'smapi', root: contentRoot, destination: 'Mods', requires: ['StardewModdingAPI.dll'] };
 }
 recordPath(owner, id) { if (!/^[a-f0-9-]{36}$/.test(id || '')) throw new Error('创作编号无效'); return path.join(this.directory(owner), id); }
 async list(owner, gameId) {
  await this.ready;
  let entries;
  try { entries = await fs.readdir(this.directory(owner), { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const result = [];
  for (const entry of entries) if (entry.isDirectory() && /^[a-f0-9-]{36}$/.test(entry.name)) {
   try {
    const item = await this.read(owner, entry.name);
    if (item.gameId === gameId) result.push({ id: item.id, name: item.draft.name, kind: item.draft.kind, output: item.output, installable: item.installable, summary: item.summary, created: item.created });
   } catch { /* An interrupted save has no complete metadata and is not a usable creation. */ }
  }
  return result.sort((a, b) => b.created.localeCompare(a.created));
 }
 async read(owner, id) {
  await this.ready;
  let item;
  try { item = await smallJson(path.join(this.recordPath(owner, id), 'record.json')); }
  catch (error) { if (error.code === 'ENOENT') throw new Error('未找到当前账号的创作'); throw error; }
  if (item.id !== id) throw new Error('创作记录不匹配');
  if (!item.adapterId) Object.assign(item, { adapterId: item.draft.kind, output: '内容包', installable: ['dialogue','texture'].includes(item.draft.kind) });
  item.toolchain = await this.toolchain.latest(owner, id);
  if (['bepinex-plugin', 'bg3-lua', 'bg3-follower', 'engine-mod'].includes(item.adapterId) && item.toolchain?.status === 'passed' && item.toolchain.bundle) item.installable = true;
  if (item.toolchain && item.toolchain.status !== 'passed') item.installable = false;
  try { item.deployment = await smallJson(path.join(this.recordPath(owner, id), 'deployment.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { item.library = await smallJson(path.join(this.recordPath(owner, id), 'library.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return item;
 }
 async save(owner, game, input, current = () => true, lineage) {
  const check = () => { if (!current()) throw new Error('创作已停止或账号已切换'); };
  const workspace = await this.workspace(game);
  check();
  const previous = this.queues.get(owner) || Promise.resolve();
  const pending = previous.catch(() => {}).then(async () => {
   check();
   if ((await this.list(owner, game.id)).length >= 50) throw new Error('此游戏已保存 50 个项目，请先导出并删除不再需要的创作');
   check();
   const id = crypto.randomUUID(), built = buildStudioProject(game, input, id, workspace.diagnostic, workspace.context), directory = this.recordPath(owner, id);
   await fs.mkdir(directory, { recursive: true });
   const bytes = zipContent(built.files), sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
   const item = { id, gameId: game.id, created: new Date().toISOString(), summary: built.summary, draft: built.draft,
    manifest: built.manifest, content: built.content, runtime: built.runtime, adapterId: built.adapterId, output: built.output, installable: built.installable,
    ...(lineage ? { lineage } : {}), sha256, files: built.files.map(file => ({ name: file.name, size: file.data.length })) };
   try {
    check();
    await fs.writeFile(path.join(directory, 'content-pack.zip'), bytes, { flag: 'wx' });
    check();
    await fs.writeFile(path.join(directory, 'record.tmp'), JSON.stringify(item));
    check();
    await fs.rename(path.join(directory, 'record.tmp'), path.join(directory, 'record.json'));
   } catch (error) { await fs.rm(directory, { recursive: true, force: true }); throw error; }
   return item;
  });
  this.queues.set(owner, pending);
  try { return await pending; } finally { if (this.queues.get(owner) === pending) this.queues.delete(owner); }
 }
 async archive(owner, game, id) {
  const item = await this.read(owner, id);
  if (item.gameId !== game.id) throw new Error('创作不属于当前游戏');
  const file = path.join(this.recordPath(owner, id), 'content-pack.zip'), stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) throw new Error('创作包无法读取或超过大小限制');
  const bytes = await fs.readFile(file);
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error('内容包文件已变化，请重新保存创作');
  return { item, bytes };
 }
 async remove(owner, game, id) {
  const item = await this.read(owner, id);
  if (item.gameId !== game.id) throw new Error('创作不属于当前游戏');
  await fs.rm(this.recordPath(owner, id), { recursive: true });
  return { ok: true };
 }
 async deploymentArchive(owner, game, id) {
  const archive = await this.archive(owner, game, id), item = archive.item;
  if (item.toolchain?.status !== 'passed') throw new Error('请先完成编译与文件验证，再安装产物。' + (item.toolchain?.checks.filter(check => ['blocked','failed'].includes(check.status)).map(check => check.detail).join('；') || ''));
  if (!['bepinex-plugin', 'bg3-lua', 'bg3-follower', 'engine-mod'].includes(item.adapterId)) return archive;
  const bundle = await this.toolchain.bundle(owner, game, id, item.toolchain.id), bytes = Buffer.from(bundle.base64, 'base64');
  return { item: { ...item, compiled: true, buildId: item.toolchain.id, ...(item.toolchain.bg3Module ? { bg3Module: item.toolchain.bg3Module } : {}), sha256: crypto.createHash('sha256').update(bytes).digest('hex') }, bytes };
 }
 async preview(owner, game, id) {
  const { item, bytes } = await this.archive(owner, game, id), files = [];
  let offset = 0;
  // Host-created archives use stored entries; inspect actual bytes without extraction or execution.
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
   const method = bytes.readUInt16LE(offset + 8), size = bytes.readUInt32LE(offset + 18), length = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
   const start = offset + 30 + length + extra, end = start + size, name = bytes.subarray(offset + 30, offset + 30 + length).toString('utf8');
   if (method !== 0 || end > bytes.length || !item.files.some(file => file.name === name && file.size === size) || files.some(file => file.name === name)) throw new Error('产物文件结构无法预览');
   const data = bytes.subarray(start, end);
   if (crc32(data) !== bytes.readUInt32LE(offset + 14)) throw new Error('产物文件校验失败');
   const image = /\.png$/i.test(name) && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
   files.push({ name, size, ...(image ? { image: 'data:image/png;base64,' + data.toString('base64') } : { text: data.toString('utf8') }) }); offset = end;
  }
  if (files.length !== item.files.length) throw new Error('产物文件列表不完整');
  return { item, game: { id: game.id, name: game.name }, files };
 }
 async generate(owner, game, input, current) {
  if (typeof this.options.generate !== 'function') throw new AccountError(503, 'AI_SERVICE_NOT_CONFIGURED', '内置 AI 服务尚未接入，可先保存创作想法，接入后继续。');
  if (this.pending.has(owner)) throw new Error('已有 AI 草稿正在生成');
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 2000 || input.kind === 'dialogue' && !NPCS.includes(input.npc)) throw new Error('创作需求无效，请选择类型并填写 2000 字以内的描述');
  const workspace = await this.workspace(game);
  if (!current()) throw new Error('账号已切换或创作已取消');
  if (!workspace.types.find(type => type.id === input.kind)?.available) throw new Error('当前游戏尚未适配此创作类型');
  if (this.pending.has(owner)) throw new Error('已有 AI 草稿正在生成');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60000);
  const cancelled = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('草稿生成已取消或超时')), { once: true }));
  this.pending.set(owner, controller);
  try {
   const draft = await Promise.race([this.options.generate({ accountId: owner, gameId: game.id, kind: input.kind, npc: input.npc, prompt: input.prompt.trim(), context: workspace.context, diagnostic: workspace.diagnostic, signal: controller.signal }), cancelled]);
   if (!current() || controller.signal.aborted) throw new Error('账号已切换或创作已取消');
   if (!draft || draft.kind !== input.kind || input.kind === 'dialogue' && draft.npc !== input.npc) throw new Error('AI 返回的草稿与所选模板不匹配');
   const built = buildStudioProject(game, draft, crypto.randomUUID(), workspace.diagnostic, workspace.context);
   return { draft: built.draft, message: 'AI 草稿已校验，请核对并保存项目。' };
  } finally { clearTimeout(timer); if (this.pending.get(owner) === controller) this.pending.delete(owner); }
 }
 cancelOwner(owner) { this.pending.get(owner)?.abort(); }
 close() { for (const controller of this.pending.values()) controller.abort(); }
}
module.exports = { ModStudio, studioAccess };
