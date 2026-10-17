const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { smallJson } = require('./game-diagnostics.cjs');
const { recordEvent, finishEvents } = require('./studio-events.cjs');
const { describeError, createStudioLogger, cleanDiagnostic } = require('./studio-errors.cjs');

const ACTIVE = new Set(['analyzing', 'planning', 'generating', 'validating', 'checking', 'building', 'verifying', 'repairing', 'deploying', 'launching', 'observing']);
function commandFor(message) {
 const value = String(message || '').trim().replace(/[。！!？?\s]+$/g, '').replace(/^(?:(?:请|帮我|麻烦|给我)\s*)+/, '');
 if (/^(?:重新|再次|继续)?(?:编译|构建|制作)(?:(?:并|和)?(?:验证|校验))?(?:一下|产物|项目|这个项目)?$/.test(value) || /^(?:重新)?(?:验证|校验)(?:一下|产物|项目)?$/.test(value)) return 'build';
 if (/^(?:查看|打开)?(?:产物)?预览(?:产物|一下)?$/.test(value)) return 'preview';
 if (/^导出(?:一下|文件|产物|项目|ZIP|zip|编译包)?$/.test(value)) return /编译包/.test(value) ? 'export-build' : 'export';
 if (/^(?:查看|检查)(?:制作进度|构建状态|验证结果|验证报告|编译结果)$/.test(value)) return 'report';
 if (/^(?:检查|准备|重新检查)(?:制作|编译|构建)?环境$/.test(value)) return 'environment';
 if (/^(?:检查|验证|查看)(?:本次运行|游戏运行|运行结果|日志|本次日志|运行日志)$/.test(value)) return 'runtime';
 if (/^(?:安装|部署)(?:(?:当前|这个|此)(?:产物|项目|Mod|MOD))?(?:到游戏)?(?:并|后|然后)(?:启动|运行|打开)(?:游戏)?(?:并验证|并检查日志|并验证日志)?$/.test(value)) return 'install-launch';
 if (/^(?:安装|部署)(?:(?:当前|这个|此)?(?:产物|项目|Mod|MOD))?(?:到游戏|一下)?$/.test(value)) return 'install';
 if (/^(?:启动|运行|打开)游戏(?:并验证|并检查日志|并验证日志)?$/.test(value)) return 'launch';
 return null;
}
function buildMessage(report) {
 return report.summary + '\n' + report.checks.filter(check => ['blocked', 'failed'].includes(check.status)).map(check => check.name + '：' + check.detail).join('\n') + '\n' + report.runtime.detail;
}
function analysisFor(workspace) {
 const diagnostic = workspace.diagnostic;
 return { engine: diagnostic.engine.name, engineKey: diagnostic.engine.key, loaders: diagnostic.loaders, integration: diagnostic.integration.message,
  route: diagnostic.routes?.[0]?.route || diagnostic.route, warnings: diagnostic.warnings, guide: workspace.context.guide.path,
  references: workspace.context.notes.map(({ text, ...note }) => note), checkedAt: diagnostic.checkedAt };
}
function text(value, label, max) {
 if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error(`${label}需为 1 至 ${max} 字`);
 return value.trim();
}
function lines(value, label, count, length, required = false) {
 if (value === undefined && !required) return [];
 if (!Array.isArray(value) || required && !value.length) throw new Error(`${label}格式无效，需为${required ? '非空' : ''}字符串数组`);
 if (value.length > count) throw new Error(`${label}最多 ${count} 项，本次返回 ${value.length} 项`);
 return value.map(item => text(item, label, length));
}
function validatedPlan(input, types) {
 try {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('AI 未返回有效的创作方案');
  const questions = lines(input.questions, '补充问题', 4, 300);
  const plan = { title: text(input.title, '方案名称', 60), summary: text(input.summary, '方案说明', 2000), questions,
   steps: lines(input.steps, '制作步骤', 12, 500, !questions.length), requirements: lines(input.requirements, '前置说明', 6, 300) };
  if (!questions.length) {
   if (!types.some(type => type.available && type.id === input.kind)) throw new Error('AI 选择了当前游戏不支持的制作方式');
   plan.kind = input.kind;
  }
  return plan;
 } catch (error) { error.code = 'STUDIO_PLAN_INVALID'; throw error; }
}
class StudioConversations {
 constructor(studio) { this.studio = studio; this.runs = new Map(); this.queues = new Map(); this.writes = new Map(); this.loggers = new Map(); }
 key(owner, id) { return owner + ':' + id; }
 file(owner, id) { this.studio.recordPath(owner, id); return path.join(this.studio.directory(owner), 'conversations', id + '.json'); }
 async persist(owner, item) {
  const key = this.key(owner, item.id);
  const operation = (this.writes.get(key) || Promise.resolve()).catch(() => {}).then(() => this.write(owner, item));
  this.writes.set(key, operation);
  try { await operation; } finally { if (this.writes.get(key) === operation) this.writes.delete(key); }
 }
 async write(owner, item) {
  item.updated = new Date().toISOString();
  const file = this.file(owner, item.id), temporary = file + '.' + crypto.randomUUID() + '.tmp';
  await fs.mkdir(path.dirname(file), { recursive: true });
  try { await fs.writeFile(temporary, JSON.stringify(item), { flag: 'wx' }); await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
 }
 message(item, role, content, source) { item.messages.push({ id: crypto.randomUUID(), role, content, ...(source ? { source } : {}), created: new Date().toISOString() }); }
 async log(owner, item, diagnostic) {
  const entry = { at: new Date().toISOString(), ...diagnostic };
  item.diagnostics = [...(item.diagnostics || []), entry].slice(-40);
  if (!this.loggers.has(owner)) this.loggers.set(owner, createStudioLogger(path.join(this.studio.directory(owner), 'logs')));
  await this.loggers.get(owner).write({ conversationId: item.id, gameId: item.gameId, diagnostic: entry });
 }
 async diagnostics(owner, game, id) {
  const item = await this.read(owner, game, id);
  return { application: { name: 'Moddock', version: require('./package.json').version }, exportedAt: new Date().toISOString(),
   game: { id: game.id, name: game.name }, conversation: { id, status: item.status, error: item.error, activeTask: item.activeTask, diagnostic: item.diagnostic },
   diagnostics: item.diagnostics || [], connection: item.harness?.connection, tools: item.toolCalls || [],
   events: item.harness?.events || [], build: item.toolchain || null };
 }
 async read(owner, game, id) {
  await this.studio.ready;
  let item;
  try { item = await smallJson(this.file(owner, id)); }
  catch (error) { if (error.code === 'ENOENT') throw new Error('未找到当前账号的创作对话'); throw error; }
  if (item.id !== id || item.gameId !== game.id) throw new Error('对话不属于当前游戏');
  if (ACTIVE.has(item.status) && !this.runs.has(this.key(owner, id))) {
   item.status = 'interrupted'; finishEvents(item, 'interrupted'); this.message(item, 'system', '上次创作已中断。想法与已有产物已保留，可以继续创作。'); await this.persist(owner, item);
  }
  return item;
 }
 async list(owner, game) {
  await this.studio.ready;
  let entries;
  try { entries = await fs.readdir(path.join(this.studio.directory(owner), 'conversations')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const items = [];
  for (const name of entries) if (/^[a-f0-9-]{36}\.json$/.test(name)) {
   try { const item = await this.read(owner, game, name.slice(0, -5)); items.push({ id: item.id, title: item.title, status: item.status, updated: item.updated }); }
   catch { /* Other games and incomplete records are not part of this list. */ }
  }
  return items.sort((a, b) => b.updated.localeCompare(a.updated));
 }
 async send(owner, game, input, current, authorize) {
  await this.studio.ready;
  const message = input.resume ? null : text(input.message, '创作想法', 2000);
  if (input.resume && !input.id) throw new Error('请选择要继续的创作');
  const previous = this.queues.get(owner) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
   if (!current()) throw new Error('账号已切换');
   if (this.studio.pending.has(owner)) throw new Error('已有创作正在处理，请等待或先停止');
   let item;
   if (input.id) item = await this.read(owner, game, input.id);
   else {
    if ((await this.list(owner, game)).length >= 40) throw new Error('此游戏已保存 40 个对话，请继续已有创作');
    const now = new Date().toISOString();
    item = { id: crypto.randomUUID(), gameId: game.id, title: message.slice(0, 32), messages: [], status: 'idle', created: now, updated: now, analysis: null, plan: null, artifactId: null };
   }
   if (item.messages.length >= 50) throw new Error('此对话已达到消息上限，请新建创作');
   if (input.artifactId) {
    const artifact = await this.studio.read(owner, input.artifactId);
    if (artifact.gameId !== game.id) throw new Error('创作不属于当前游戏');
    if (item.artifactId && item.artifactId !== artifact.id) throw new Error('请新建对话继续其他项目');
    item.artifactId = artifact.id;
    if (!input.id) item.title = artifact.draft.name;
   }
   if (input.mode && input.mode !== 'ai') throw new Error('仅支持真实 AI 创作');
   item.mode = 'ai';
   if (message) this.message(item, 'user', message);
   item.command = commandFor(message); item.action = null;
   item.status = 'analyzing'; item.error = ''; item.diagnostic = null; item.activeTask = null;
   if (!item.command) { item.plan = null; item.analysis = null; item.toolchain = null; item.planningAttempts = []; item.capability = null; item.toolCalls = []; item.harness = null; }
   if (item.command === 'build') item.toolchain = null;
   const controller = new AbortController(), key = this.key(owner, item.id);
   this.studio.pending.set(owner, controller); this.runs.set(key, null);
   try { await this.persist(owner, item); }
   catch (error) { this.runs.delete(key); this.studio.pending.delete(owner); throw error; }
   const response = structuredClone(item);
   const run = this.run(owner, game, item, controller, current, authorize).finally(() => {
    this.runs.delete(key); if (this.studio.pending.get(owner) === controller) this.studio.pending.delete(owner);
   });
   this.runs.set(key, run);
   // A failed final persistence must not become an unhandled rejection in the host.
   run.catch(() => {});
   return response;
  });
  this.queues.set(owner, operation);
  try { return await operation; } finally { if (this.queues.get(owner) === operation) this.queues.delete(owner); }
 }
 async run(owner, game, item, controller, current, authorize) {
  const timer = setTimeout(() => controller.abort(), 900000);
  const check = () => { if (controller.signal.aborted || !current()) throw new Error('创作已停止或账号已切换'); };
  const aborted = new Promise((_, reject) => {
   const stop = () => reject(new Error('创作已停止或超时'));
   if (controller.signal.aborted) stop(); else controller.signal.addEventListener('abort', stop, { once: true });
  });
  // Cancellation may happen while the read-only scanner is running.
  aborted.catch(() => {});
  const stage = async status => { check(); item.status = status; await this.persist(owner, item); check(); };
  let eventTimer;
  const onEvent = event => {
   if (controller.signal.aborted || !current() || !ACTIVE.has(item.status)) return;
   if (recordEvent(item, event) && !eventTimer) eventTimer = setTimeout(() => {
    eventTimer = null; this.persist(owner, item).catch(() => controller.abort());
   }, 120);
  };
  const onTask = task => {
   if (controller.signal.aborted || !current()) return;
   const { diagnostic, ...progress } = task; item.activeTask = progress;
   if (diagnostic) void this.log(owner, item, diagnostic).catch(() => {});
   if (!eventTimer) eventTimer = setTimeout(() => { eventTimer = null; this.persist(owner, item).catch(() => controller.abort()); }, 120);
  };
  try {
   if (item.command) {
    if (item.command === 'environment') {
     const environment = await this.studio.toolchain.environment(controller.signal); check();
     this.message(item, 'system', Object.entries(environment).map(([name, tool]) => `${({ lua: '本机 Lua 5.4', csharp: 'C# 编译', portableLua: '内置 Lua 5.4' })[name] || name}：${tool.available ? '已就绪 · ' + tool.version : tool.reason}`).join('\n'));
    } else if (!item.artifactId) this.message(item, 'system', '当前对话还没有产物，请先描述想制作的 Mod。');
    else {
     const saved = await this.studio.read(owner, item.artifactId); check();
     if (saved.gameId !== game.id) throw new Error('创作不属于当前游戏');
     if (item.command === 'build') {
      const workspace = await Promise.race([this.studio.workspace(game), aborted]); check();
      item.analysis = analysisFor(workspace);
      const report = await this.studio.toolchain.run(owner, game, saved.id, workspace, { signal: controller.signal, current, onStage: stage, onEvent, authorize }); check();
      item.toolchain = { id: report.id, status: report.status, summary: report.summary, updated: report.updated };
      this.message(item, 'system', buildMessage(report));
     } else if (['install','install-launch','launch'].includes(item.command)) {
      const lifecycle = this.studio.options.lifecycle;
      if (!lifecycle) throw new Error('当前宿主尚未接入安装与启动');
      const context = { owner, game, artifactId: saved.id, current: () => !controller.signal.aborted && current(), authorize, signal: controller.signal };
      if (item.command !== 'launch') { await stage('deploying'); const installed = await lifecycle.install(context); this.message(item, 'system', installed.message); check(); }
      if (item.command !== 'install') { await stage('launching'); const launched = await lifecycle.launch(context); this.message(item, 'system', launched.message); check(); await stage('observing'); const report = await lifecycle.observe(context); check(); item.toolchain = { id: report.id, status: report.status, summary: report.summary, updated: report.updated }; this.message(item, 'system', report.runtime.detail); }
     } else if (item.command === 'runtime') {
      await stage('verifying'); const report = await this.studio.toolchain.checkRuntime(owner, game, saved.id, () => !controller.signal.aborted && current()); check();
      item.toolchain = { id: report.id, status: report.status, summary: report.summary, updated: report.updated }; this.message(item, 'system', report.runtime.detail);
     } else if (item.command === 'report') this.message(item, 'system', saved.toolchain ? buildMessage(saved.toolchain) : '此产物尚未运行工具链，可说“编译并验证”。');
     else {
      if (item.command === 'export-build' && !saved.toolchain?.bundle) throw new Error('尚无可导出的编译包，可先说“编译并验证”。');
      item.action = { id: crypto.randomUUID(), kind: item.command === 'preview' ? 'preview' : 'export', artifactId: saved.id, ...(item.command === 'export-build' ? { buildId: saved.toolchain.id } : {}) };
      this.message(item, 'system', item.command === 'preview' ? '已打开当前产物预览，可查看概览、文件和验证报告。' : '已请求导出当前产物；请查看应用的下载结果。');
     }
    }
    check(); item.status = item.command === 'build' && item.toolchain && item.toolchain.status !== 'passed' ? item.toolchain.status === 'blocked' ? 'blocked' : 'failed' : 'completed';
    if (item.status !== 'completed') item.error = item.toolchain.summary;
    finishEvents(item, item.status); await this.persist(owner, item); return;
   }
   check();
   await this.studio.options.ensureEnvironment?.({ owner, game, current, authorize, signal: controller.signal, onEvent }); check();
   await this.studio.prepareNative?.(game, { owner, current, authorize, signal: controller.signal, onEvent }); check();
   const workspace = await Promise.race([this.studio.workspace(game), aborted]); check();
   const diagnostic = workspace.diagnostic;
   item.analysis = analysisFor(workspace);
   const types = workspace.types.filter(type => type.available);
   const requested = item.messages.filter(message => message.role === 'user').at(-1)?.content || '';
   const { deliverableFor, documents } = require('./studio-intent.cjs');
   const deliverable = deliverableFor(requested);
   const sourceOnly = types.length > 0 && types.every(type => documents.has(type.id));
   item.capability = { mode: types.some(type => type.id === 'engine-mod') ? 'engine-development' : sourceOnly ? 'source-only' : 'supported', allowedKinds: types.map(type => type.id),
    engine: workspace.context.engineEvidence ? { family: workspace.context.engineEvidence.family, mode: workspace.context.engineEvidence.mode, routes: workspace.context.engineEvidence.routes } : null,
    deliverable,
    message: sourceOnly ? '当前游戏尚未接通 Mod 的自动制作与打包。可以生成开发方案或源码供预览、导出，暂不能安装进游戏。' : '' };
   const wantsFollower = /跟随者|同伴|新增.{0,12}(?:人物|角色)|(?:做|制作).{0,12}(?:人物|NPC)|\bfollower\b|\bcompanion\b/i.test(item.messages.filter(message => message.role === 'user').at(-1)?.content || '');
   item.capability.preferredKind = wantsFollower && types.some(type => type.id === 'bg3-follower') ? 'bg3-follower' : types.some(type => type.id === 'bg3-lua') ? 'bg3-lua' : null;
   if (types.some(type => type.id === 'bg3-lua')) item.capability.controls = { persistence: 'local-user-data-across-sessions', saveScoped: false, acknowledgementRequired: true };
   this.message(item, 'system', `已识别 ${diagnostic.engine.name}，正在调查这款游戏的玩法代码、资源和加载方式。${diagnostic.loaders.length ? '检测到 ' + diagnostic.loaders.join(' / ') + '。' : ''}`);
   if (sourceOnly && deliverable === 'mod') throw new Error('当前游戏还缺少可执行 Mod 的制作适配，无法完成本次创作。不会用开发方案替代 Mod；你的想法已保留。');
   if (typeof this.studio.options.plan !== 'function' || typeof this.studio.options.generate !== 'function') {
    item.status = 'awaiting_service';
    this.message(item, 'system', '想法与游戏分析已保存。内置 AI 服务尚未接入，方案规划和 Mod 生成暂未开始；接入后可在此继续。');
    await this.persist(owner, item); return;
   }
   await stage('planning');
   const history = item.messages.filter(message => message.role !== 'system').map(({ role, content }) => ({ role, content }));
   const prompt = history.filter(message => message.role === 'user').at(-1)?.content;
   item.capability.creativeDefaultsDelegated = /你自己|你决定|你定|你来定|随便|都可以|自行决定|自行设计|choose (?:the )?details yourself|you decide/i.test(prompt || '');
   const previousArtifact = item.artifactId ? await this.studio.read(owner, item.artifactId).catch(() => null) : null; check();
   const payload = { accountId: owner, gameId: game.id, conversationId: item.id, messages: history, prompt,
    context: workspace.context, diagnostic, types, capability: item.capability, environment: await this.studio.toolchain.environment(controller.signal), previousDraft: previousArtifact?.draft || null, signal: controller.signal, onEvent, onTask };
   let plan, correction;
   for (let attempt = 1; attempt <= 3; attempt++) {
    check(); let candidate;
    try {
     candidate = await Promise.race([this.studio.options.plan({ ...payload, ...correction, attempt }), aborted]); check();
     plan = validatedPlan(candidate, types);
     if (deliverable === 'mod' && !plan.questions.length && documents.has(plan.kind)) throw Object.assign(new Error('用户要的是可安装的 Mod，不能返回开发方案或源码文档；请选择当前游戏可执行的制作类型并完成实现'), { code: 'STUDIO_PLAN_INVALID' });
     if (['bg3-lua', 'bg3-follower'].includes(item.capability.preferredKind) && !plan.questions.length && ['project-plan', 'custom-project'].includes(plan.kind) && !/^(?:请)?(?:先|只)?(?:给我|要|生成|做|写|整理|输出)(?:一份|一个)?(?:开发)?方案|^只(?:输出|导出).?源码/.test(prompt || '')) throw Object.assign(new Error('已接通 BG3 实际制作与 PAK 打包；请按推荐配方生成可制作的 Mod，不要返回开发文档'), { code: 'STUDIO_PLAN_INVALID' });
     if (item.capability.preferredKind === 'bg3-follower' && !plan.questions.length && plan.kind === 'bg3-lua') throw Object.assign(new Error('人物跟随者请使用 bg3-follower 配方，AI 生成姓名和台词，由宿主提供持久化与跟随逻辑'), { code: 'STUDIO_PLAN_INVALID' });
     if ((sourceOnly || ['bg3-lua', 'bg3-follower'].includes(item.capability.preferredKind)) && item.capability.creativeDefaultsDelegated && plan.questions.length) throw Object.assign(new Error('用户已授权自行决定创意细节，请采用合理默认值并在已支持范围内规划，不要返回补充问题'), { code: 'STUDIO_PLAN_INVALID' });
    } catch (error) {
     check();
     if (!['STUDIO_PLAN_INVALID', 'AI_RESPONSE_FORMAT'].includes(error.code)) throw error;
     const reason = String(error.message).slice(0, 500);
     const rejected = { kind: typeof candidate?.kind === 'string' ? candidate.kind.slice(0, 80) : null,
      stepsType: Array.isArray(candidate?.steps) ? 'array' : typeof candidate?.steps,
      ...(Array.isArray(candidate?.steps) ? { stepsCount: candidate.steps.length } : {}) };
     item.planningAttempts.push({ attempt, ...rejected, accepted: false, code: error.code, error: reason });
     if (attempt === 3) throw new Error('AI 方案经两次自动修正仍未通过校验：' + reason + '。想法已保留，可继续对话重试。');
     correction = { previousPlan: rejected, validation: { error: reason, allowedKinds: item.capability.allowedKinds } };
     this.message(item, 'system', `方案校验未通过：${reason}。正在自动重新规划（${attempt}/2）。`);
     await stage('planning'); continue;
    }
    item.planningAttempts.push({ attempt, kind: plan.kind || null, accepted: true });
    break;
   }
   check();
   item.plan = plan; item.title = plan.title;
   this.message(item, 'assistant', plan.summary + (plan.questions.length ? '\n\n' + plan.questions.map(question => '• ' + question).join('\n') : ''));
   if (plan.questions.length) { item.status = 'clarifying'; finishEvents(item, 'completed'); await this.persist(owner, item); return; }
   await stage('generating');
   const generation = { ...payload, kind: plan.kind, plan };
   const draft = await Promise.race([this.studio.options.generate(generation), aborted]); check();
   if (!draft || draft.kind !== plan.kind) throw new Error('AI 生成的产物与创作方案不匹配');
   await stage('validating');
   let artifact = await this.studio.save(owner, game, draft, () => !controller.signal.aborted && current(), { conversationId: item.id, parentId: previousArtifact?.id || null });
   for (let attempt = 0; ; attempt++) {
    item.artifactId = artifact.id; check();
    const report = await this.studio.toolchain.run(owner, game, artifact.id, workspace, { signal: controller.signal, current, onStage: stage, onEvent, authorize }); check();
    item.toolchain = { id: report.id, status: report.status, summary: report.summary, updated: report.updated };
    this.message(item, 'system', buildMessage(report));
    if (report.status !== 'failed' || typeof this.studio.options.repair !== 'function' || attempt >= 2) break;
    await stage('repairing');
    const corrected = await Promise.race([this.studio.options.repair({ ...generation, previousDraft: artifact.draft, validation: report, attempt: attempt + 1 }), aborted]); check();
    if (corrected?.kind !== plan.kind) throw new Error('AI 修复的产物与制作方式不匹配');
    artifact = await this.studio.save(owner, game, corrected, () => !controller.signal.aborted && current(), { conversationId: item.id, parentId: artifact.id });
   }
   const finalReport = artifact.toolchain || await this.studio.toolchain.latest(owner, artifact.id);
   item.status = finalReport?.status === 'passed' ? 'completed' : finalReport?.status === 'blocked' ? 'blocked' : 'failed';
   if (item.status !== 'completed') {
    item.error = finalReport?.summary || '制作尚未通过验证，请继续修复。';
    item.diagnostic = describeError(new Error(cleanDiagnostic(JSON.stringify({ summary: finalReport?.summary, checks: finalReport?.checks, errors: finalReport?.errors }))), 'build', item.activeTask?.id);
    await this.log(owner, item, item.diagnostic);
   }
   finishEvents(item, item.status);
   this.message(item, 'system', `已保存「${artifact.draft.name}」：${artifact.files.length} 个文件，${artifact.output}。` + (item.status !== 'completed' ? '制作尚未通过验证，请根据错误继续修复；当前文件仍可预览或导出。' : ['project-plan', 'custom-project'].includes(artifact.adapterId) ? '这是你要求的开发方案或源码，尚未生成可安装的 Mod。' : '实际 Mod 文件已生成并通过制作校验。可安装、预览或导出，游戏内效果待实测。'));
   await this.persist(owner, item);
  } catch (error) {
   item.status = controller.signal.aborted || !current() ? 'cancelled' : 'failed'; item.error = String(error.message || '创作未完成').slice(0, 500);
   item.diagnostic = error.diagnostic || describeError(error, item.activeTask?.action || item.status, item.activeTask?.id);
   await this.log(owner, item, item.diagnostic).catch(() => {});
   finishEvents(item, item.status);
   this.message(item, 'system', item.status === 'cancelled' ? '创作已停止，想法与已有产物已保留。' : '创作未完成：' + item.error);
   await this.persist(owner, item);
  } finally { clearTimeout(timer); clearTimeout(eventTimer); await this.writes.get(this.key(owner, item.id)); }
 }
 async settle() { await Promise.allSettled([...this.runs.values()].filter(Boolean)); }
}
module.exports = { StudioConversations, validatedPlan, ACTIVE, commandFor };
