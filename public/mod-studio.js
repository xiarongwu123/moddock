import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import ThoughtLine from '../src/components/ThoughtLine.jsx';
import PromptBar from '../src/components/PromptBar.jsx';
import './mod-studio.css';

const active = status => ['analyzing', 'planning', 'generating', 'validating', 'checking', 'building', 'verifying', 'repairing', 'deploying', 'launching', 'observing'].includes(status);
const creating = thread => active(thread?.status) && !thread.command;
const creationReady = s => !!s.saved && s.saved.toolchain?.status === 'passed' && (!s.thread || ['completed','awaiting_runtime','awaiting_exit'].includes(s.thread.status) || !!s.thread.command);
const suggestions = ['我想增加一个有独特能力的新装备，并设计获取方式', '我想调整游戏里的一个机制，让探索更有趣', '我想做一个符合游戏世界观的新角色或剧情'];
const suggestionLabels = ['加一件新装备', '调整游戏机制', '创作角色与剧情'];
const runActions = new Set(['send', 'resume', 'try', 'feedback-submit']);
const activityNames = { build_native_mod: '编译并打包游戏 Mod', prepare_native_tools: '准备游戏制作工具', extract_game_code: '读取游戏玩法接口', generate_interop: '生成游戏接口', inspect_game: '检查游戏环境', list_game_files: '调查游戏资源', read_game_file: '读取玩法代码', search_api: '核对实现方式', read_runtime: '查看运行反馈', check_draft: '检查制作文件', read: '查阅制作资料', read_reference: '查阅游戏资料', run_agent: '分析实现方案', write_project_file: '编写制作文件', read_project_file: '读取制作文件', list_project_files: '查看制作文件', validate_project: '编译与修正', submit_result: '整理创作结果' };
const runKey = thread => thread && `${thread.id}:${thread.messages.filter(message => message.role === 'user').at(-1)?.id || thread.created}`;
const mascot = (className = '', alt = '', mode = className === 'studio-message-avatar' ? 'quiet' : 'idle') => `<img class="studio-mascot ${className}" src="/youxia-ai-mascot.svg#${mode}" alt="${alt}" width="96" height="96">`;

export function createModStudio({ api, render, esc, icon, getGame, getGames, changeGame, getStatus, openPlan, openPreview, openLibrary, refresh, toast }) {
 const states = new Map(); let revision = 0, epoch = 0;
 let thoughtRoot, thoughtHost;
 let promptRoot, promptHost;
 const picker = { busy: false, error: '', coverage: null, auditBusy: false, stopAudit: false };
 const state = id => { if (!states.has(id)) states.set(id, { idea: '', drafts: new Map(), threads: [], records: [], thread: null, saved: null, loaded: false, ready: false, busy: '', error: '', timer: null }); return states.get(id); };
 const visible = game => document.querySelector('[data-studio-root]')?.dataset.gameId === game.id;
 const update = () => { revision++; render(); };
 const same = ticket => ticket === epoch;
 function remember(s, thread) {
  if (s.thread?.id !== thread.id && !runActions.has(s.busy)) {
   s.drafts.set(s.thread?.id || 'new', s.idea);
   s.idea = s.drafts.get(thread.id) || '';
  }
  if (runKey(s.thread) !== runKey(thread) && !runActions.has(s.busy)) { s.activityStartedAt = null; s.activityEndedAt = null; }
  s.thread = thread;
  s.threads = [{ id: thread.id, title: thread.title, status: thread.status, updated: thread.updated }, ...s.threads.filter(item => item.id !== thread.id)];
 }
 function thoughtProps(s) {
  const thread = s.thread, pending = runActions.has(s.busy);
  if (!thread && !pending) return null;
  const working = pending || active(thread?.status);
  const lastIdea = thread?.messages.filter(message => message.role === 'user').at(-1);
  const startedAt = s.activityStartedAt ?? Date.parse(lastIdea?.created || thread?.created);
  if (!Number.isFinite(startedAt)) return null;
  const command = pending ? s.busy === 'try' : !!thread.command;
  const failed = !!s.error || ['blocked', 'failed', 'cancelled', 'interrupted', 'awaiting_service'].includes(thread?.status);
  const doneLabel = s.error ? '这次遇到了点问题，用时' : ({ awaiting_runtime:'文件已生成，等待游戏功能验证，用时',awaiting_exit:'修复版已保存，等待游戏退出，用时',blocked: '制作还需要处理一些问题，用时', failed: '这次还没做好，用时', cancelled: '先歇一会儿，用时', interrupted: '创作已中断，用时', awaiting_service: '还没连上创作服务，用时', clarifying: '等你补充一点细节，用时' })[thread?.status] || (command ? '这一步处理好了，用时' : '文件已生成，游戏效果待验证，用时');
  const current = thread?.toolCalls?.findLast(tool => tool.status === 'running');
  const stage = { analyzing: '正在了解你的想法', planning: '正在构思玩法', generating: '正在制作你的 Mod', validating: '正在检查制作文件', checking: '正在检查游戏环境', building: '正在编译制作文件', verifying: '正在验证制作结果', repairing: '正在调整制作内容', deploying: '正在安装到游戏', launching: '正在启动游戏', observing: '正在查看运行反馈' }[thread?.status];
  const label = thread?.harness?.connection?.status === 'reconnecting' ? '连接中断，正在自动重连' : current ? activityNames[current.name] || '正在处理创作内容' : thread?.harness?.modelStatus === 'thinking' ? '正在思考实现方式' : stage || '正在准备创作';
  return { key: startedAt, working, startedAt, label, doneLabel,
   elapsed: working ? undefined : Math.max(0, ((s.activityEndedAt || Date.parse(thread?.updated) || startedAt) - startedAt) / 1000),
   color: !working && failed ? '#cfab88' : '#aeb9ac', fontSize: 12, glyph: 'none', shimmer: false, settleBlur: 0, collapsible: false, showTimer: true };
 }
 function thought(s) {
  const props = thoughtProps(s);
  const tools = s.thread?.toolCalls || [];
  const harness = s.thread?.harness;
  const statusName = status => ({ running: '进行中', completed: '已完成', failed: '未完成', cancelled: '已停止', interrupted: '已中断' })[status] || '等待处理';
  const toolRows = tools.map(tool => `<li class="studio-process-step is-${esc(tool.status)}"><span class="studio-process-step-mark" aria-hidden="true">${icon(tool.status === 'completed' ? 'check' : tool.status === 'running' ? 'loader' : 'info', tool.status === 'running' ? 'spinning' : '')}</span><strong>${esc(activityNames[tool.name] || '处理创作内容')}</strong><span>${esc(statusName(tool.status))}${Number.isFinite(tool.durationMs) && tool.durationMs >= 1000 ? ` · ${(tool.durationMs / 1000).toFixed(1)} 秒` : ''}</span></li>`).join('');
  const thoughts = harness?.thinking || [];
  const displayThought = text => String(text || '').replace(/\bpi[ -]?agent\b/gi, '创作助手').replace(/\bskills?\b/gi, '制作资料');
  const thinking = thoughts.length ? `<details class="studio-process-thinking" data-help-key="studio:thinking:${s.thread.id}"><summary>思考记录${props?.working && harness.modelStatus === 'thinking' ? '<span>思考中</span>' : ''}${icon('chevron')}</summary><div>${thoughts.map(thought => `<p>${esc(displayThought(thought.text))}</p>`).join('')}</div></details>` : '';
  const plan = s.thread?.plan?.steps?.length ? `<details class="studio-process-thinking" data-help-key="studio:plan:${s.thread.id}"><summary>制作方案${icon('chevron')}</summary><ol>${s.thread.plan.steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol></details>` : '';
  const records = s.thread?.messages.filter(message => message.role === 'system') || [];
  const history = records.length ? `<details class="studio-process-thinking" data-help-key="studio:logs:${s.thread.id}"><summary>处理记录${icon('chevron')}</summary><div>${records.map(message => `<p>${esc(displayThought(message.content))}</p>`).join('')}</div></details>` : '';
  if (!props) return '';
  const status = props.working ? 'running' : s.thread?.status || 'completed';
  return `<section class="studio-process is-${esc(status)}" aria-label="创作进度" data-status="${esc(status)}"><details data-help-key="studio:process:${s.thread?.id || 'new'}"><summary><span class="studio-process-mark" aria-hidden="true">${icon(props.working ? 'sparkles' : status === 'completed' ? 'check' : 'info')}</span><span data-studio-thought>${esc(props.working ? props.label : props.doneLabel)}</span><span class="studio-process-toggle">查看过程${icon('chevron')}</span></summary><div class="studio-process-body">${tools.length ? `<ol class="studio-process-steps" aria-label="处理记录">${toolRows}</ol>` : props.working ? '<p class="studio-process-waiting">正在准备创作资料…</p>' : ''}${thinking}${plan}${history}</div></details></section>`;
 }
 function clearThought() {
  const root = thoughtRoot; thoughtRoot = null; thoughtHost = null;
  if (root) queueMicrotask(() => root.unmount());
 }
 function mountThought(container) {
  const slot = container.querySelector('[data-studio-thought]'), gameId = slot?.closest('[data-studio-root]')?.dataset.gameId;
  if (!slot || !states.has(gameId)) { clearThought(); return; }
  if (thoughtHost) slot.replaceWith(thoughtHost);
  else { thoughtHost = slot; thoughtRoot = createRoot(slot); }
  thoughtRoot.render(createElement(ThoughtLine, thoughtProps(state(gameId))));
 }
 function clearPrompt() {
  const root = promptRoot; promptRoot = null; promptHost = null;
  if (root) queueMicrotask(() => root.unmount());
 }
 function mountPrompt(container) {
  const slot = container.querySelector('[data-studio-prompt]'), gameId = slot?.closest('[data-studio-root]')?.dataset.gameId;
  if (!slot || !states.has(gameId)) { clearPrompt(); return; }
  if (promptHost) { if (slot !== promptHost) slot.replaceWith(promptHost); }
  else { promptHost = slot; promptRoot = createRoot(slot); }
  const s = state(gameId), busy = active(s.thread?.status) || runActions.has(s.busy);
  promptRoot.render(createElement(PromptBar, {
   key: gameId, inputId: 'studio-idea', inputLabel: '你的 Mod 想法', value: s.idea,
   placeholder: s.thread ? '接着聊，想改哪里？' : '说说你想做的 Mod…',
   sources: [], commands: [], models: [], efforts: [], busy, disabled: !!s.busy && !runActions.has(s.busy), stopDisabled: !!s.busy,
   hint: busy ? '正在创作，可停止生成' : 'Enter 发送 · Shift+Enter 换行',
   background: '#181d1b', color: '#dfe8d9', menuBackground: '#19221a', sparkColor: '#b9dc82', width: 820, radius: 18, maxRows: 5,
   onChange: text => { s.idea = text; s.drafts.set(s.thread?.id || 'new', text); mountPrompt(container); },
   onSend: text => { if (!s.busy && !active(s.thread?.status) && getGame()?.id === gameId) { s.idea = text; return request('send'); } },
   onStop: () => request('cancel'),
  }));
 }
 async function artifact(s, game, ticket) {
  const id = s.thread?.artifactId;
  if (!id) { s.saved = null; return; }
  if (id === s.saved?.id && s.artifactRevision === s.thread.updated) return;
  try { const saved = await api('studio/read', { gameId: game.id, id }); if (same(ticket)) { s.saved = saved; s.artifactRevision = s.thread.updated; } }
  catch (error) { if (same(ticket)) { s.saved = null; s.error = '产物暂时无法读取，对话已保留：' + error.message; } }
 }
 function schedule(game) {
  const s = state(game.id); clearTimeout(s.timer);
  if (!s.thread || !visible(game)) return;
  // A normal library launch can start runtime recovery after this page loaded
  // an inactive conversation. Keep observing deployed projects for that change.
  if (!active(s.thread.status) && !s.saved?.deployment?.runId) return;
  s.timer = setTimeout(() => poll(game), active(s.thread.status) ? 1200 : 5000);
 }
 async function poll(game) {
  const s = state(game.id), id = s.thread?.id, ticket = epoch;
  if (!id || !visible(game)) return;
  try {
   const thread = await api('studio/conversations/read', { gameId: game.id, id });
   if (!same(ticket) || s.thread?.id !== id) return;
   const changed = JSON.stringify(thread) !== JSON.stringify(s.thread); remember(s, thread);
   await artifact(s, game, ticket); if (!same(ticket)) return;
   if (changed && !active(thread.status)) s.records = (await api('studio/list', { gameId: game.id })).items;
   if (same(ticket) && visible(game) && changed) update();
   if (same(ticket) && visible(game) && !active(thread.status)) await deliver(s, game, ticket);
  } catch (error) { if (same(ticket)) { s.error = error.message; if (visible(game)) update(); } return; }
  if (same(ticket)) schedule(game);
 }
 function toolReport(report, detailed = false) {
  if (!report) return '<div class="studio-tool-report"><p>尚无构建记录。可直接说“编译并验证”。</p></div>';
  const status = { passed: '文件验证通过', blocked: '制作条件未就绪', failed: '验证未通过', cancelled: '已取消', interrupted: '已中断', checking: '检查环境中', building: '编译中', verifying: '验证中' }[report.status] || report.status;
  const checks = detailed ? report.checks : report.checks.filter(check => ['blocked','failed','pending'].includes(check.status));
  return `<section class="studio-tool-report is-${esc(report.status)}"><div class="studio-section-head"><h3>制作与验证</h3><span class="studio-tag">${esc(status)}</span></div><p>${esc(report.summary || report.adapterName)}</p>${checks.map(check => `<div class="studio-tool-check is-${esc(check.status)}"><strong>${check.status === 'passed' ? '✓' : ['blocked','pending'].includes(check.status) ? '·' : '!'} ${esc(check.name)}</strong><${detailed ? 'pre' : 'p'}>${esc(check.detail)}</${detailed ? 'pre' : 'p'}></div>`).join('')}<p class="studio-fineprint">${esc(report.runtime.detail)}</p>${report.bundle ? `<p class="studio-fineprint">已生成编译包 · ${report.outputs.map(output => esc(output.name)).join(' / ')}</p>` : ''}</section>`;
 }
 function result(s, busy) {
  const saved = s.saved;
  if (!saved || creating(s.thread)) return '';
  const ready = creationReady(s), kept = saved.library && (!['bepinex-plugin', 'bg3-lua', 'bg3-follower', 'engine-mod', 'factorio-lua', 'dst-lua', 'noita-lua', 'gmod-lua', 'zomboid-lua', 'beamng-lua', 'ck3-data', 'barotrauma-content', 'minecraft-datapack', 'minecraft-resourcepack'].includes(saved.adapterId) || saved.library.buildId === saved.toolchain?.id);
  const reporting = s.feedbackArtifactId === saved.id && s.feedbackBuildId === saved.toolchain?.id;
  const accepted = !reporting && saved.feedback?.status === 'accepted' && saved.feedback.buildId === saved.toolchain?.id;
  const feedback = `<section class="studio-user-feedback" aria-label="试玩反馈"><p>进游戏试用后，这个 Mod 能正常使用吗？</p><div class="studio-result-actions"><button class="btn" data-studio-action="feedback-yes" ${busy ? 'disabled' : ''}>能用，效果符合预期</button><button class="btn" data-studio-action="feedback-no" ${busy ? 'disabled' : ''}>不能用 / 效果不对</button></div>${reporting ? `<label for="studio-feedback-problem">遇到了什么问题？</label><textarea id="studio-feedback-problem" data-studio-feedback maxlength="2000" rows="3" placeholder="例如：按 F7 没反应、进入关卡闪退、视角与预期不符" ${busy ? 'disabled' : ''}>${esc(s.feedbackProblem || '')}</textarea><button class="btn primary" data-studio-action="feedback-submit" ${busy ? 'disabled' : ''}>提交问题并继续修改</button><p class="studio-result-hint">会结合当前作品和已有运行记录继续修改，完成后请重新试玩。</p>` : accepted ? '<p class="studio-result-hint">已确认当前版本能用，可以存到 Mod 库。</p>' : ''}</section>`;
  return `<section class="studio-result studio-completion" aria-label="生成结果"><div class="studio-completion-heading"><span class="studio-completion-icon">${icon(ready ? 'box' : 'info')}</span><div><span class="studio-kicker">${ready ? (saved.adapterId === 'project-plan' ? '开发方案已生成' : (accepted ? '你已确认能用' : '制作完成 · 请试玩确认')) : '还需要处理一些问题'}</span><h3>${esc(saved.draft.name)}</h3></div></div><p>${esc(saved.draft.description || saved.summary)}</p>${ready && saved.installable ? `<div class="studio-result-actions"><button class="btn primary" data-studio-action="try" ${busy ? 'disabled' : ''}>${icon('play')}${saved.adapterId === 'minecraft-resourcepack' ? '安装资源包' : '进游戏试试'}</button>${accepted ? `<button class="btn" data-studio-action="keep" ${busy || kept ? 'disabled' : ''}>${icon('box')}${kept ? '已存入 Mod 库' : '存到 Mod 库'}</button>` : ''}${kept ? '<button class="text-link" data-studio-action="library">打开 Mod 库</button>' : ''}</div>${feedback}` : `<p class="studio-result-hint">${ready ? (saved.exportOnly ? '数据包已生成，可导出原生 ZIP 后放入你选择的世界 datapacks 目录；尚未验证游戏效果。' : '这是你要求的文档或源码，可查看内容或导出。') : '这次制作还没有通过验证，可以继续对话调整。'}</p>`}${s.saved.deployment?.runtime ? `<p class="studio-fineprint">${esc(s.saved.deployment.runtime.detail)}</p>` : ''}<details class="studio-technical" data-help-key="studio:artifact:${saved.id}"><summary>文件与制作详情</summary><div class="studio-result-actions"><button class="btn small" data-studio-action="product" ${busy ? 'disabled' : ''}>查看文件与预览</button><button class="btn small" data-studio-action="export" ${busy ? 'disabled' : ''}>导出 ZIP</button>${saved.toolchain?.bundle ? `<button class="btn small" data-studio-action="export-build" ${busy ? 'disabled' : ''}>导出编译包</button>` : ''}</div>${toolReport(saved.toolchain)}${gameInfo(s)}</details></section>`;
 }
 function gameInfo(s) {
  const a = s.thread?.analysis;
  return `<section class="studio-game-info"><h3>当前游戏分析</h3>${a ? `<dl><div><dt>引擎</dt><dd>${esc(a.engine)}</dd></div><div><dt>加载器</dt><dd>${esc(a.loaders.join(' / ') || '暂未检出')}</dd></div></dl><p class="studio-fineprint">${esc(a.integration)}</p><details class="studio-technical" data-help-key="studio:analysis:${s.thread.id}"><summary>高级详情 · 开发依据</summary><p>${esc(a.route)}</p>${a.warnings.map(warning => `<p>${esc(warning)}</p>`).join('')}<small>${esc(a.guide)}</small>${a.references.map(note => `<p>${esc(note.title)} · ${esc(note.status)}</p>`).join('')}</details>` : '<p class="studio-fineprint">发送想法后，自动读取本机游戏特征与相关开发资料。</p>'}</section>`;
 }
 function conversation(s) {
  const thread = s.thread;
  if (!thread) return thought(s) || `<div class="studio-welcome">${mascot('studio-welcome-mascot', '挥手的匣仔')}<h3>想给游戏加点什么？</h3><p>说出你想要的玩法，AiMod 在游戏里帮你做出来。</p><p class="studio-engine-coverage">Unity · 虚幻 · Godot · RPG Maker · Ren'Py · GameMaker<br>这些引擎做的单机游戏，都可以试试。</p></div>`;
  const history = thread.messages.filter(message => message.role !== 'system');
  return `${history.map(message => `<article class="studio-message is-${message.role}" aria-label="${message.role === 'user' ? '你的想法' : '匣仔的回复'}"><div class="studio-message-label">${message.role === 'user' ? '你' : `${mascot('studio-message-avatar')}<strong>匣仔</strong><small>游匣 AI</small>`}</div><div class="studio-message-text">${esc(message.content)}</div></article>`).join('')}${thread.capability?.mode === 'source-only' ? `<p class="studio-capability" role="note">${esc(thread.capability.message)}</p>` : ''}${thought(s)}${['awaiting_service','cancelled','interrupted','failed','blocked'].includes(thread.status) ? `<div class="studio-continuation">${mascot('studio-continuation-mascot')}<span>${thread.status === 'awaiting_service' ? '暂时还没连上创作服务，你的点子已经存好啦。' : ['failed','blocked'].includes(thread.status) ? '这次卡住了，你的点子还在。我们可以继续调整。' : '你的点子已经存好，随时可以接着做。'}</span><button class="btn small" data-studio-action="resume" ${s.busy ? 'disabled' : ''}>接着做</button></div>` : ''}`;
 }
 function guide() {
  return `<ol class="studio-guide" aria-label="使用方式">${[['选个游戏', '从列表选一款，或直接拖入本机游戏。'], ['聊聊点子', '想要什么效果，直接告诉匣仔就好。'], ['进游戏试试', '把实际看到的情况告诉匣仔，一起调整。'], ['收藏你的作品', '满意后存进 Mod 库，下次接着玩。']].map(([title, description], index) => `<li><span>0${index + 1}</span><div><h3>${title}</h3><p>${description}</p></div></li>`).join('')}</ol>`;
 }
 function selection(game) {
  const s = game ? state(game.id) : null, busy = picker.busy || !!s?.busy;
  return `<div class="studio-setup"><section class="studio-selection"><span class="studio-kicker">从这里开始</span><h3>今天想给哪款游戏加点料？</h3><div class="studio-game-options" aria-label="游戏列表">${getGames().map(item => `<button type="button" draggable="${!busy}" data-studio-pick="${esc(item.id)}" class="${item.id === game?.id ? 'is-selected' : ''}" aria-pressed="${item.id === game?.id}" ${busy ? 'disabled' : ''}>${icon('gamepad')}<span>${esc(item.name)}<small>${esc(item.platform || '本机游戏')}</small></span>${item.id === game?.id ? icon('check') : ''}</button>`).join('') || '<p>还没有发现本机游戏，可以先选择游戏文件。</p>'}</div></section><section class="studio-engine" data-studio-drop>${mascot('studio-setup-mascot', '匣仔等你一起创作')}<h3>${game ? esc(game.name) : '带上你的游戏，一起开工'}</h3><p>也可以将游戏文件夹或启动文件拖到这里。</p>${window.moddockDesktop?.gamePath ? `<button class="text-link" data-studio-action="add-game" ${busy ? 'disabled' : ''}>选择游戏文件</button>` : !getGames().length ? '<button class="text-link" data-nav="settings">添加游戏库</button>' : ''}<button class="btn primary studio-engine-start" data-studio-action="start" ${busy || !game ? 'disabled' : ''}>${icon(busy ? 'loader' : 'sparkles', busy ? 'spinning' : '')}${s?.busy === 'start' ? '匣仔准备中…' : '和匣仔一起创作'}</button></section></div>${picker.error || s?.error ? `<p class="studio-error" role="alert">${esc(picker.error || s.error)}</p>` : ''}${guide()}`;
 }
 function panel(game) {
  const content = mainPanel(game), s = game && state(game.id), environment = s?.environment;
  if (!getStatus()?.allowed || !environment?.applicable || environment.ready) return content;
  const canPrepare = environment.canPrepare ?? environment.supported;
  const message = s.busy === 'environment' || s.busy === 'start' ? '正在准备，请稍候…' : environment.status === 'conflict' ? '游戏文件需要检查，处理后就能继续准备。' : canPrepare ? '开始创作前，需要先准备一下。' : '发送想法后，将自动调查这款游戏的实现方式。';
  return `<section class="studio-environment" aria-label="创作提示"><p role="status">${message}</p><button class="btn small" data-studio-action="${environment.status === 'conflict' || !canPrepare ? 'check-environment' : 'environment'}" ${s.busy || active(s.thread?.status) ? 'disabled' : ''}>${!canPrepare || environment.status === 'conflict' ? '重新检查' : '自动准备'}</button></section>` + content;
 }
 function coveragePanel() {
  const report = picker.coverage;
  const labels = { 'authoring-route': '有专用制作入口', 'engine-investigation': '需调查引擎实现', 'missing-adapter': '缺少适配', blocked: '存在联网或保护限制', 'diagnostic-failed': '读取失败' };
  return `<details class="studio-technical" data-help-key="studio:coverage"><summary>查看本机游戏适配情况</summary><p>逐款检查本机文件与制作入口。构建、安装和游戏效果仍需分别验证。</p><button class="btn small" data-studio-action="${picker.auditBusy ? 'coverage-stop' : 'coverage'}">${picker.auditBusy ? '停止检查' : '检查本机游戏'}</button>${report ? `<p role="status">已检查 ${report.items.length} / ${report.total} 款</p><ul>${Object.entries(report.counts).map(([status, count]) => `<li>${esc(labels[status] || status)}：${count}</li>`).join('')}</ul><ul>${report.items.map(item => `<li>${esc(item.name || item.gameId)}：${esc(labels[item.status] || item.status)}${item.error ? ' · ' + esc(item.error) : ''}</li>`).join('')}</ul>` : ''}${picker.auditError ? `<p role="alert">${esc(picker.auditError)}</p>` : ''}</details>`;
 }
 function mainPanel(game) {
  if (!getStatus()?.allowed && window.ModdockMembership) return window.ModdockMembership.marketing();
  if (!getStatus()?.allowed) return `<div class="studio-locked">${mascot('studio-locked-mascot', '游匣 AI 卡通伙伴匣仔')}<span class="studio-pro">PRO</span><h2>游匣 AI</h2><p>我是匣仔，陪你把游戏里的奇思妙想做成 Mod。<br>开通 Pro，和我一起开始创作。</p><button class="btn primary" data-nav="account">查看我的会员</button></div>`;
  const s = game ? state(game.id) : null, t = s?.thread, running = active(t?.status), busy = !!s?.busy, disabled = busy || running;
  const empty = !t && !busy && !s?.saved;
  const controls = s?.ready ? `<div class="studio-thread-controls">${s.threads.length ? `<label class="visually-hidden" for="studio-thread">历史创作</label><select id="studio-thread" data-studio-thread ${disabled ? 'disabled' : ''}><option value="">新创作</option>${s.threads.map(item => `<option value="${item.id}" ${item.id === t?.id ? 'selected' : ''}>${esc(item.title)}</option>`).join('')}</select>` : ''}${s.threads.length || t || s.saved ? `<button class="text-link" data-studio-action="new" ${disabled ? 'disabled' : ''}>${icon('sparkles')}新创作</button>` : ''}</div>` : '';
  const header = s?.ready ? `<button class="studio-selected-game" data-studio-action="choose-game" aria-label="更换游戏，当前：${esc(game.name)}" ${disabled ? 'disabled' : ''}>${icon('gamepad')}<span>${esc(game.name)}</span>${icon('chevron')}</button>${controls}` : '<div class="studio-brand-title"><h2>游匣 <span>AI</span></h2><span class="studio-pro">PRO</span></div>';
  return `<div class="mod-studio studio-chat studio-simple" data-studio-root data-game-id="${esc(game?.id || '')}">
   <header class="studio-heading">${header}</header>
   ${!s?.ready ? coveragePanel() : ''}
   ${!s?.ready ? selection(game) : `<div class="studio-chat-layout">
    <section class="studio-conversation ${empty ? 'is-empty' : ''}" aria-label="创作对话">
     <div class="studio-chat-scroll" data-studio-scroll data-chat-id="${t?.id || 'new'}" aria-live="polite" aria-busy="${running}">${s.busy === 'load' ? '<p class="studio-loading">正在读取创作记录…</p>' : conversation(s)}${result(s, disabled)}</div>
     ${s.error || t?.error ? `<div class="studio-error" role="alert">${esc(s.error || t.error)}</div>` : ''}
     ${t?.harness?.connection?.status === 'reconnecting' && running ? '<p class="studio-service-status" role="status">网络暂时中断，正在自动重连。代码和进度已保留，恢复后会继续。</p>' : ''}
     ${t?.diagnostic || t?.diagnostics?.length ? `<details class="studio-technical studio-diagnostics" data-help-key="studio:diagnostics:${t.id}"><summary>查看${t.diagnostic ? '错误详情' : '连接日志'}</summary><div>${t.diagnostic ? `<p>失败阶段：${esc(({ model: '模型请求', creation: '创作执行', worker: '创作进程', transport: '网络传输', build: '编译与验证', planning: '玩法规划', generating: '制作文件', generate: '制作文件', plan: '玩法规划', repair: '修复制作文件' })[t.diagnostic.stage] || t.diagnostic.stage)}</p><p>错误码：<code>${esc(t.diagnostic.code)}</code>${t.diagnostic.upstreamStatus ? ` · HTTP ${esc(t.diagnostic.upstreamStatus)}` : ''}</p><p>请求编号：<code>${esc(t.diagnostic.traceId)}</code></p><pre>${esc(t.diagnostic.reason)}</pre>` : '<p>连接中断与恢复记录已保存。</p>'}<button class="btn small" data-studio-action="export-logs">导出诊断日志</button></div></details>` : ''}
     <div class="studio-composer" data-studio-prompt></div>
     ${empty ? `<div class="studio-suggestions" aria-label="试试这些想法">${suggestionLabels.map((label, index) => `<button type="button" data-studio-suggestion="${index}">${esc(label)}</button>`).join('')}</div>` : ''}
     ${!getStatus()?.aiAvailable ? '<p class="studio-service-status" role="status">点子会保留，等待创作服务连接。</p>' : ''}
    </section>
   </div><details class="studio-help"><summary>使用指南</summary>${guide()}</details>`}
  </div>`;
 }
 async function importGame(selectedPath) {
  const game = getGame(), s = game && state(game.id), ticket = epoch;
  if (!getStatus()?.allowed || picker.busy || s?.busy || active(s?.thread?.status)) return;
  picker.busy = true; picker.error = ''; update();
  try {
   const result = await api('studio/games/add', selectedPath ? { path: selectedPath } : {});
   if (!same(ticket) || result.cancelled) return;
   await refresh(); if (!same(ticket)) return;
   await changeGame(result.game.id);
   await ui.enter();
  } catch (error) { if (same(ticket)) picker.error = error.message; }
  finally { if (same(ticket)) { picker.busy = false; update(); } }
 }
 async function request(action) {
  if (action === 'coverage-stop') { picker.stopAudit = true; return; }
  if (action === 'coverage') {
   if (picker.auditBusy || !getStatus()?.allowed) return;
   const ticket = epoch;
   picker.auditBusy = true; picker.stopAudit = false; picker.auditError = ''; picker.coverage = { items: [], counts: {}, total: getGames().length }; update();
   try {
    let offset = 0;
    do {
     const batch = await api('studio/coverage', { offset });
     if (!same(ticket)) return;
     picker.coverage.total = batch.total;
     picker.coverage.items.push(...batch.items);
     for (const [status, count] of Object.entries(batch.counts)) picker.coverage.counts[status] = (picker.coverage.counts[status] || 0) + count;
     offset = batch.nextOffset; update();
    } while (offset !== null && !picker.stopAudit);
   } catch (error) { if (same(ticket)) picker.auditError = error.message; }
   finally { if (same(ticket)) { picker.auditBusy = false; update(); } }
   return;
  }
  if (action === 'add-game') return importGame();
  const game = getGame(); if (!game || !getStatus()?.allowed) return;
  const s = state(game.id), ticket = epoch;
  if (s.busy) return;
  if (action === 'cancel') { try { await api('studio/cancel', { gameId: game.id }); await poll(game); } catch (error) { s.error = error.message; update(); } return; }
  if (action === 'refresh') { await poll(game); return; }
  if (active(s.thread?.status) && action !== 'export-logs') return;
  if (action === 'library') { await openLibrary?.(game); return; }
  if (action === 'send' && !s.idea.trim()) return;
  if (action === 'feedback-no') { s.feedbackArtifactId = s.saved?.id; s.feedbackBuildId = s.saved?.toolchain?.id; s.feedbackProblem = ''; update(); return; }
  if (action === 'feedback-submit' && !s.feedbackProblem?.trim()) { s.error = '请先描述遇到的问题'; update(); return; }
  if (runActions.has(action)) { s.activityStartedAt = Date.now(); s.activityEndedAt = null; }
  s.busy = action; s.error = ''; update();
  try {
   if (action === 'feedback-yes' || action === 'feedback-submit') {
    const rejected = action === 'feedback-submit';
    const response = await api('studio/conversations/feedback', {gameId:game.id,id:s.thread?.id,artifactId:s.saved?.id,buildId:s.saved?.toolchain?.id,status:rejected?'rejected':'accepted',problem:rejected?s.feedbackProblem:''});
    if (!same(ticket)) return;
    if (rejected) { remember(s,response); s.saved = null; s.feedbackProblem = ''; }
    else { s.saved = await api('studio/read',{gameId:game.id,id:s.saved.id}); s.feedbackArtifactId = null; }
   }
   if (action === 'start' || action === 'environment' || action === 'check-environment') {
    const environment = await api(action === 'check-environment' || action === 'environment' && s.environment?.ready ? 'studio/environment' : 'studio/prepare-environment', { gameId: game.id });
    if (!same(ticket)) return; s.environment = environment;
    if (action === 'start') { await api('studio/workspace', { gameId: game.id }); if (!same(ticket)) return; s.ready = true; }
   }
   if (action === 'choose-game') s.ready = false;
   if (action === 'new') { s.drafts.set(s.thread?.id || 'new', s.idea); s.thread = null; s.saved = null; s.idea = ''; s.drafts.delete('new'); s.activityStartedAt = null; s.activityEndedAt = null; clearTimeout(s.timer); }
   if (action === 'send' || action === 'resume' || action === 'try') {
    const thread = await api('studio/conversations/send', { gameId: game.id, id: s.thread?.id, artifactId: s.saved?.id, mode: 'ai', ...(action === 'resume' ? { resume: true } : { message: action === 'try' ? s.saved?.adapterId === 'minecraft-resourcepack' ? '安装产物' : s.saved?.deployment?.modId ? '启动游戏并检查日志' : '安装并启动游戏' : s.idea }) });
    if (!same(ticket)) return; remember(s, thread); if (action === 'send') { s.idea = ''; s.drafts.delete(thread.id); s.drafts.delete('new'); }
   }
   if (action === 'keep' && s.saved) { await api('studio/library', { gameId: game.id, id: s.saved.id }); if (!same(ticket)) return; s.saved = await api('studio/read', { gameId: game.id, id: s.saved.id }); if (!same(ticket)) return; await refresh(); }
   if (action === 'prepare' && s.saved) { const plan = await api('studio/prepare', { gameId: game.id, id: s.saved.id }); if (same(ticket)) { await refresh(); if (same(ticket)) openPlan(plan); } }
   if (action === 'product' && s.saved) { const payload = await api('studio/preview', { gameId: game.id, id: s.saved.id }); if (same(ticket)) openPreview(payload); }
   if (action === 'export-logs' && s.thread) {
    const logs = await api('studio/conversations/logs', { gameId: game.id, id: s.thread.id });
    const url = URL.createObjectURL(new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `Moddock-creation-${s.thread.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
   }
   if (['export','export-build'].includes(action) && s.saved) await exportFile(game, s.saved.id, action === 'export-build' ? s.saved.toolchain?.id : undefined, ticket);
  } catch (error) { if (same(ticket)) { s.error = error.message; if (runActions.has(action)) s.activityEndedAt = Date.now(); } }
  finally { if (same(ticket)) { s.busy = ''; update(); schedule(game); if (['new','start'].includes(action)) document.getElementById('studio-idea')?.focus({ preventScroll: true }); } }
 }
 async function exportFile(game, id, buildId, ticket) {
  const exported = await api('studio/export', { gameId: game.id, id, buildId }); if (!same(ticket)) return;
  const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(exported.base64), char => char.charCodeAt(0))], { type: 'application/zip' }));
  const link = document.createElement('a'); link.href = url; link.download = exported.filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
 }
 async function deliver(s, game, ticket) {
  const action = s.thread?.action;
  if (!action || action.id === s.handledAction) return;
  s.handledAction = action.id;
  try {
   if (action.kind === 'preview') { const payload = await api('studio/preview', { gameId: game.id, id: action.artifactId }); if (same(ticket)) openPreview(payload); }
   if (action.kind === 'export') await exportFile(game, action.artifactId, action.buildId, ticket);
  } catch (error) { if (same(ticket)) { s.error = error.message; update(); } }
 }
 function productModal(modal) {
  const { item, game, files } = modal.payload, file = files[modal.fileIndex || 0], image = files.find(file => file.image), entries = item.draft.kind === 'dialogue' ? Object.entries(item.draft.entries) : [];
  const tab = modal.tab || 'overview';
  const overview = `<div class="studio-product-overview"><div class="studio-product-art">${image ? `<img src="${esc(image.image)}" alt="AI 生成的像素贴图" class="studio-product-pixel">` : entries.length ? `<span class="studio-product-npc">${esc(item.draft.npc)}</span><div class="studio-dialogue-preview">${entries.map(([day, line]) => `<p><small>${esc(day)}</small>${esc(line)}</p>`).join('')}</div>` : `${icon('box')}<span>${esc(item.output)}</span>`}</div><div class="studio-product-copy"><span class="studio-kicker">${esc(game.name)}</span><h3>${esc(item.draft.name)}</h3><p>${esc(item.draft.description)}</p><div class="studio-product-stats"><span>${files.length} 个真实文件</span><span>SHA-256 已校验</span><span>${esc(item.output)}</span></div></div></div>`;
  const fileView = `<div class="studio-product-files"><nav aria-label="产物文件">${files.map((entry, index) => `<button data-studio-preview-file="${index}" class="${entry === file ? 'is-selected' : ''}" aria-pressed="${entry === file}">${icon('file')}<span>${esc(entry.name)}</span><small>${entry.size} B</small></button>`).join('')}</nav><section aria-label="文件内容"><div class="studio-product-file-heading"><code>${esc(file.name)}</code><small>${file.size} B · 只读</small></div>${file.image ? `<div class="studio-product-image"><img src="${esc(file.image)}" alt="${esc(file.name)}"></div>` : `<pre tabindex="0">${esc(file.text || '（空文件）')}</pre>`}</section></div>`;
  return `<div class="modal-backdrop"><section class="modal studio-product-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><div><h2 id="modal-title">产物预览</h2><p>查看生成产物与压缩包内的实际文件</p></div><button class="icon-button" data-close aria-label="关闭弹窗">${icon('close')}</button></div><div class="studio-product-tabs"><button data-studio-preview-tab="overview" aria-pressed="${tab === 'overview'}" class="${tab === 'overview' ? 'is-selected' : ''}">产物概览</button><button data-studio-preview-tab="files" aria-pressed="${tab === 'files'}" class="${tab === 'files' ? 'is-selected' : ''}">制作文件 <small>${files.length}</small></button><button data-studio-preview-tab="validation" aria-pressed="${tab === 'validation'}" class="${tab === 'validation' ? 'is-selected' : ''}">验证报告</button></div><div class="modal-body">${tab === 'files' ? fileView : tab === 'validation' ? toolReport(item.toolchain, true) : overview}<p class="studio-product-notice">此预览不运行代码，也不代表游戏内实机画面。</p></div><div class="modal-foot"><button class="btn" data-close>关闭</button>${item.toolchain?.bundle ? '<button class="btn" data-studio-action="export-build">导出编译包</button>' : ''}<button class="btn primary" data-studio-action="export">${icon('download')}导出 ZIP</button></div></section></div>`;
 }
 const ui = {
  get revision() { return revision; }, render: panel, renderPreview: productModal,
  mount(container) { mountThought(container); mountPrompt(container); },
  async enter() {
   const game = getGame(); if (!game || !getStatus()?.allowed) return;
   const s = state(game.id), ticket = epoch; if (s.busy) return; if (s.loaded) { schedule(game); return; }
   s.busy = 'load'; update();
   try {
    const [threads, records, environment] = await Promise.all([api('studio/conversations/list', { gameId: game.id }), api('studio/list', { gameId: game.id }), api('studio/environment', { gameId: game.id })]);
    if (!same(ticket)) return; s.threads = threads.items; s.records = records.items; s.environment = environment;
    if (s.threads.length) { const thread = await api('studio/conversations/read', { gameId: game.id, id: s.threads[0].id }); if (!same(ticket)) return; remember(s, thread); s.handledAction = thread.action?.id; await artifact(s, game, ticket); }
    if (same(ticket)) s.loaded = true;
   } catch (error) { if (same(ticket)) s.error = error.message; }
   finally { if (same(ticket)) { s.busy = ''; update(); schedule(game); } }
  },
  submit: () => request('send'),
  async click(data) {
   if (data.studioPick) { const game = getGame(); if (!picker.busy && (!game || !state(game.id).busy && !active(state(game.id).thread?.status))) { picker.error = ''; await changeGame(data.studioPick); await this.enter(); } return true; }
   if (!data.studioAction && data.studioSuggestion === undefined && !data.studioLoad && !data.studioDelete) return false;
   if (data.studioAction) { await request(data.studioAction); return true; }
   const game = getGame(); if (!game) return true; const s = state(game.id), ticket = epoch; if (s.busy || active(s.thread?.status)) return true;
   if (data.studioSuggestion !== undefined) { s.idea = suggestions[Number(data.studioSuggestion)] || ''; update(); document.getElementById('studio-idea')?.focus({ preventScroll: true }); }
   if (data.studioLoad) { s.busy = 'read'; update(); try { const saved = await api('studio/read', { gameId: game.id, id: data.studioLoad }); if (same(ticket)) { if (s.thread?.artifactId !== saved.id) s.thread = null; s.saved = saved; } } catch (error) { if (same(ticket)) s.error = error.message; } finally { if (same(ticket)) { s.busy = ''; update(); } } }
   if (data.studioDelete && window.confirm('删除这个项目记录与导出包？创作对话、已导入和已安装的副本会保留。')) { s.busy = 'delete'; update(); try { await api('studio/delete', { gameId: game.id, id: data.studioDelete }); if (same(ticket)) { s.records = s.records.filter(item => item.id !== data.studioDelete); if (s.saved?.id === data.studioDelete) s.saved = null; } } catch (error) { if (same(ticket)) s.error = error.message; } finally { if (same(ticket)) { s.busy = ''; update(); } } }
   return true;
  },
  input(element) {
   if (element.hasAttribute('data-studio-feedback')) { const game = getGame(); if (game) state(game.id).feedbackProblem = element.value; return; }
   if (!element.hasAttribute('data-studio-idea')) return; const game = getGame(); if (!game) return; const s = state(game.id); s.idea = element.value;
   const button = document.querySelector('[data-studio-form] button[type="submit"]'); if (button) button.disabled = !s.idea.trim() || !!s.busy;
  },
  async change(element) {
   if (element.hasAttribute('data-studio-game')) { await changeGame(element.value); await this.enter(); return; }
   if (!element.hasAttribute('data-studio-thread')) return;
   const game = getGame(); if (!game) return; const s = state(game.id), ticket = epoch; if (s.busy || active(s.thread?.status)) return;
   if (!element.value) { await request('new'); return; }
   s.busy = 'load'; s.error = ''; update();
   try { const thread = await api('studio/conversations/read', { gameId: game.id, id: element.value }); if (!same(ticket)) return; remember(s, thread); s.handledAction = thread.action?.id; s.saved = null; await artifact(s, game, ticket); }
   catch (error) { if (same(ticket)) s.error = error.message; }
   finally { if (same(ticket)) { s.busy = ''; update(); schedule(game); } }
  },
  drag(event) {
   const button = event.target.closest('[data-studio-pick]');
   if (button && !button.disabled) event.dataTransfer.setData('application/x-moddock-game', button.dataset.studioPick);
  },
  dragOver(event) { if (event.target.closest('[data-studio-root]')) event.preventDefault(); const target = event.target.closest('[data-studio-drop]'); if (target) target.classList.add('is-dragging'); },
  dragLeave(event) { const target = event.target.closest('[data-studio-drop]'); if (target && !target.contains(event.relatedTarget)) target.classList.remove('is-dragging'); },
  async drop(event) {
   if (!event.target.closest('[data-studio-root]')) return;
   event.preventDefault(); document.querySelector('[data-studio-drop]')?.classList.remove('is-dragging');
   if (!event.target.closest('[data-studio-drop]')) return;
   const game = getGame(), s = game && state(game.id);
   if (picker.busy || s?.busy || active(s?.thread?.status)) return;
   const id = event.dataTransfer.getData('application/x-moddock-game');
   if (id && getGames().some(game => game.id === id)) { await changeGame(id); await this.enter(); return; }
   const file = event.dataTransfer.files[0]; if (!file) return;
   if (!window.moddockDesktop?.gamePath) { picker.error = '请在桌面端拖入本机游戏，网页中可以从列表选择。'; update(); return; }
   try { const selectedPath = window.moddockDesktop.gamePath(file); if (!selectedPath) throw new Error('无法读取此游戏的位置'); await importGame(selectedPath); }
   catch (error) { picker.error = error.message; update(); }
  },
  reset() { epoch++; for (const s of states.values()) clearTimeout(s.timer); states.clear(); clearThought(); clearPrompt(); picker.busy = false; picker.error = ''; picker.auditBusy = false; picker.coverage = null; picker.auditError = ''; revision++; },
 };
 return ui;
}
