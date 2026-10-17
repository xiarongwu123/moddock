const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { smallJson } = require('./game-diagnostics.cjs');
const { zipContent, pngBytes } = require('./content-pack.cjs');
const { StudioTools, runTool } = require('./studio-tools.cjs');
const { writePak } = require('./larian-pak.cjs');
const { readModule } = require('./bg3-mod.cjs');
const { checkLua } = require('./studio-lua.cjs');

const ACTIVE = new Set(['checking', 'building', 'verifying']);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const ADAPTERS = {
 'engine-mod': { name: '按引擎开发', build: '实际源文件与资源修改构建', validation: '引擎入口、静态语法、原文件摘要与加载目录' },
 'ue4ss-lua': { compiler: 'lua', name: 'UE4SS · Lua 5.4', build: 'Lua 语法编译检查', validation: '脚本语法、目录与现有加载器' },
 'reframework-lua': { compiler: 'lua', name: 'REFramework · Lua 5.4', build: 'Lua 语法编译检查', validation: '脚本语法、目录与现有加载器' },
 'bepinex-plugin': { compiler: 'csharp', name: 'BepInEx 5 · Unity Mono', build: 'Roslyn C# 编译', validation: '本机游戏程序集引用与托管 DLL' },
 'bg3-lua': { compiler: 'lua', name: 'BG3 · Script Extender / LSPK v18', build: 'Lua 5.4 编译检查与真实 PAK 打包', validation: 'Lua 语法、LSX 元数据、PAK 索引与打包内容' },
 'bg3-follower': { compiler: 'lua', name: 'BG3 · 人物跟随者 / LSPK v18', build: '受约束人物逻辑、Lua 校验与 PAK 打包', validation: '人物字段、Lua 语法、LSX 元数据与包完整性' },
 dialogue: { name: 'Content Patcher · 对话', build: '内容包无需编译', validation: '内容结构、依赖与 JSON' },
 texture: { name: 'Content Patcher · 贴图', build: '内容包无需编译', validation: '内容结构、依赖、JSON 与 PNG' },
 'custom-project': { name: '自定义源码工程', build: '待专用构建适配', validation: '文件结构、JSON 与完整性' },
 'project-plan': { name: '开发方案', build: '文档无需编译', validation: '文件结构与完整性' },
};
async function atomic(file, value) {
 const temporary = file + '.' + crypto.randomUUID() + '.tmp';
 await fs.mkdir(path.dirname(file), { recursive: true });
 try { await fs.writeFile(temporary, JSON.stringify(value), { flag: 'wx' }); await fs.rename(temporary, file); }
 finally { await fs.rm(temporary, { force: true }); }
}
function managedDll(bytes) {
 if (bytes.length < 256 || bytes.toString('ascii', 0, 2) !== 'MZ') return false;
 const pe = bytes.readUInt32LE(60);
 if (pe + 256 > bytes.length || bytes.toString('ascii', pe, pe + 4) !== 'PE\0\0') return false;
 const optional = pe + 24, magic = bytes.readUInt16LE(optional), start = magic === 0x10b ? 96 : magic === 0x20b ? 112 : 0;
 return !!start && bytes.readUInt32LE(optional + start + 14 * 8) > 0 && bytes.includes(Buffer.from('BSJB'));
}
class StudioToolchain {
 constructor(studio, options = {}) { this.studio = studio; this.tools = new StudioTools(options); this.running = new Set(); }
 directory(owner, id) { return path.join(this.studio.recordPath(owner, id), 'builds'); }
 async latest(owner, id) {
  try {
   const report = await smallJson(path.join(this.directory(owner, id), 'latest.json'));
   if (ACTIVE.has(report.status) && !this.running.has(report.id)) { report.status = 'interrupted'; report.summary = '上次构建已中断，可在对话中要求重新编译。'; report.finished = new Date().toISOString(); await this.persist(owner, id, report); }
   return report;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
 }
 async persist(owner, id, report) {
  report.updated = new Date().toISOString();
  await atomic(path.join(this.directory(owner, id), report.id, 'report.json'), report);
  await atomic(path.join(this.directory(owner, id), 'latest.json'), report);
 }
 catalog(types) { return types.map(type => ({ ...type, toolchain: ADAPTERS[type.id] || null })); }
 async environment(signal) {
  const tools = await this.tools.probe(signal);
  return { ...Object.fromEntries(Object.entries(tools).map(([key, value]) => [key, { available: value.available, version: value.version, reason: value.reason }])), portableLua: { available: true, version: 'Lua 5.4 / wasmoon 1.16.0' } };
 }
 async references(game, report) {
  const candidates = [...(report.managedDirectories || []), ...(report.loaderFiles.BepInEx || []).map(file => path.posix.dirname(file))];
  const result = [], root = await fs.realpath(game.installPath);
  for (const relative of [...new Set(candidates)]) {
   const dir = path.join(root, relative), real = await fs.realpath(dir);
   if (real !== dir || !real.startsWith(root + path.sep)) throw new Error('游戏程序集目录含链接或越界');
   for (const name of (await fs.readdir(dir)).filter(name => /^[a-zA-Z0-9_.-]+\.dll$/i.test(name)).slice(0, 180)) {
    const file = path.join(dir, name), stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024 * 1024) continue;
    if (!result.some(entry => path.basename(entry).toLowerCase() === name.toLowerCase())) result.push(file);
   }
  }
  return result;
 }
 async run(owner, game, id, workspace, { signal, current = () => true, onStage = async () => {}, onEvent = async () => {}, authorize } = {}) {
  const check = () => { if (signal?.aborted || !current()) throw new Error('制作任务已取消'); };
  const { item, files } = await this.studio.preview(owner, game, id); check();
  const adapter = ADAPTERS[item.adapterId], taskId = crypto.randomUUID(), directory = path.join(this.directory(owner, id), taskId), work = path.join(directory, 'work');
  if (!adapter) throw new Error('尚未注册此产物的构建适配器');
  // Keep a bounded number of full reports and compiled artifacts for each saved revision.
  const old = (await fs.readdir(this.directory(owner, id)).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))).filter(name => /^[a-f0-9-]{36}$/.test(name));
  const dated = await Promise.all(old.map(async name => ({ name, mtime: (await fs.stat(path.join(this.directory(owner, id), name))).mtimeMs })));
  for (const entry of dated.sort((a, b) => b.mtime - a.mtime).slice(4)) await fs.rm(path.join(this.directory(owner, id), entry.name), { recursive: true, force: true });
  const report = { id: taskId, artifactId: id, gameId: game.id, adapter: item.adapterId, adapterName: adapter.name, sourceSha256: item.sha256, status: 'checking', created: new Date().toISOString(), checks: [], outputs: [], runtime: { status: 'not_run', detail: '尚未运行游戏；文件或编译验证不代表游戏内兼容与效果。' } };
  this.running.add(taskId);
  const step = async (name, status, detail) => { report.checks.push({ name, status, detail }); await this.persist(owner, id, report); };
  const stage = async status => { check(); report.status = status; await this.persist(owner, id, report); await onStage(status); check(); };
  const cleanLog = value => String(value).split(work).join('<build>').split(game.installPath).join('<game>').slice(0, 10000);
  try {
   await fs.mkdir(work, { recursive: true }); await stage('checking');
   await step('产物完整性', 'passed', `${files.length} 个文件；SHA-256 与 ZIP 条目校验通过`);
   const selected = workspace.types.find(type => type.id === item.adapterId);
   if (!selected?.available) { await step('制作路线', 'blocked', selected?.reason || '当前游戏不支持此制作路线'); return await this.finish(owner, id, report); }
   await step('制作路线', 'passed', `${workspace.diagnostic.engine.name} · ${adapter.name}`);
   if (!['project-plan', 'custom-project'].includes(item.adapterId) && (workspace.diagnostic.antiCheat.length || workspace.diagnostic.onlineOnly)) await step('游戏运行条件', 'blocked', '已保留实际实现；当前存在联网保护特征，尚未确认此版本允许的离线加载方式，暂停构建部署包。');
   let tools = adapter.compiler ? await this.tools.probe(signal) : {};
   if (adapter.compiler === 'csharp' && !tools.csharp.available) {
    await step('自动准备 C# 编译器', 'checking', '首次 C# 创作将按需下载已校验的 Microsoft SDK；无需手动配置。');
    await this.tools.prepareCsharp({ signal, current, authorize: authorize && (() => authorize('library.manage')) });
    tools = await this.tools.probe(signal); check();
    const prepared = report.checks.find(entry => entry.name === '自动准备 C# 编译器');
    prepared.status = tools.csharp.available ? 'passed' : 'blocked'; prepared.detail = tools.csharp.version || tools.csharp.reason;
    await this.persist(owner, id, report);
   }
   check();
   let references = [];
   if (adapter.compiler === 'csharp') {
    references = await this.references(game, workspace.diagnostic);
    const names = references.map(file => path.basename(file).toLowerCase());
    if (!['bepinex.dll', 'mscorlib.dll', 'unityengine.dll'].every(name => names.includes(name))) await step('游戏程序集', 'blocked', '缺少 BepInEx.dll、mscorlib.dll 或 UnityEngine.dll；需要此游戏的 BepInEx 5 与 Mono 程序集。');
    else await step('游戏程序集', 'passed', `已找到 ${references.length} 个本机引用；不执行或重新分发游戏程序集`);
   } else if (['dialogue', 'texture'].includes(item.adapterId)) {
    const missing = workspace.diagnostic.requirements.filter(entry => !entry.ready);
    await step('游戏依赖', missing.length ? 'blocked' : 'passed', missing.length ? '缺少 ' + missing.map(entry => entry.name).join(' / ') : '已检测到 SMAPI 与 Content Patcher；实际加载仍需游戏验证');
   } else if (['bg3-lua', 'bg3-follower'].includes(item.adapterId)) {
    await step('安装方式', 'passed', '生成 LSPK v18 包；安装时校验 BG3 Script Extender，并合并 Public 加载顺序。');
   } else if (adapter.compiler === 'lua') {
    const key = item.adapterId === 'ue4ss-lua' ? 'UE4SS' : 'REFramework';
    const found = workspace.diagnostic.loaderFiles[key] || [];
    report.installation = { ready: found.length === 1, dependency: key, detail: found.length === 1 ? `已检测到唯一 ${key} 位置` : `安装前需要准备 ${key}；当前仍可编译并导出实际脚本包。` };
    await step('游戏加载器', found.length === 1 ? 'passed' : 'pending', report.installation.detail);
   }
   const portableLua = (['ue4ss-lua', 'reframework-lua'].includes(item.adapterId) || item.adapterId === 'bg3-lua' && item.runtime?.control) && !tools.lua.available;
   if (portableLua) await step('编译工具', 'passed', '内置 Lua 5.4 WebAssembly 编译器；无需玩家安装开发工具。');
   else if (item.adapterId === 'bg3-follower' && !tools.lua.available) await step('受约束人物配方', 'passed', '仅接受姓名和台词；脚本由已测试的宿主配方生成，不接收模型代码，无需外部编译器。');
   else if (adapter.compiler) await step('编译工具', tools[adapter.compiler].available ? 'passed' : 'blocked', tools[adapter.compiler].version || tools[adapter.compiler].reason);
   await stage('building');
   let compiled;
   if (portableLua) {
    for (const file of files.filter(file => file.name.endsWith('.lua'))) {
     check(); const result = await checkLua(file.text);
     await step('Lua 语法 · ' + file.name, result.passed ? 'passed' : 'failed', result.detail);
    }
   } else if (adapter.compiler === 'lua' && tools.lua.available) {
    const scripts = files.filter(file => file.name.endsWith('.lua'));
    if (!scripts.length) throw new Error('产物缺少 Lua 入口');
    for (const [index, file] of scripts.entries()) {
     check(); const source = path.join(work, `script-${index}.lua`); await fs.writeFile(source, file.text);
     const result = await runTool(tools.lua.executable, ['-p', source], { cwd: work, signal });
     await step('Lua 语法 · ' + file.name, result.code === 0 ? 'passed' : 'failed', result.code === 0 ? 'Lua 5.4 编译检查通过；未执行脚本' : cleanLog(result.output));
    }
   } else if (adapter.compiler === 'csharp' && tools.csharp.available && !report.checks.some(entry => entry.name === '游戏程序集' && entry.status === 'blocked')) {
    const source = path.join(work, 'Plugin.cs'), output = path.join(work, item.manifest.UniqueID + '.dll');
    await fs.writeFile(source, item.content.code);
    const sources = [source];
    if (item.content.bootstrapCode) { const bootstrap = path.join(work, 'ModdockBootstrap.cs'); await fs.writeFile(bootstrap, item.content.bootstrapCode); sources.push(bootstrap); }
    const result = await runTool(tools.csharp.executable, [tools.csharp.compiler, '/nologo', '/noconfig', '/nostdlib+', '/target:library', '/deterministic+', '/optimize+', '/out:' + output, ...references.map(file => '/reference:' + file), ...sources], { cwd: work, signal, timeout: 45000 });
    await step('C# 编译', result.code === 0 ? 'passed' : 'failed', cleanLog(result.output) || (result.code === 0 ? 'Roslyn 编译通过' : '编译器返回 ' + result.code));
    if (result.code === 0) { const stat = await fs.lstat(output); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw new Error('编译产物超出限制'); compiled = await fs.readFile(output); if (!managedDll(compiled)) throw new Error('编译器没有生成有效的托管 DLL'); await step('托管 DLL', 'passed', `${compiled.length} B；PE 与 CLR 元数据检查通过，未加载程序集`); }
   } else if (item.adapterId === 'engine-mod') {
    const predecessors = this.studio.options.lifecycle?.predecessors(owner, game, item) || [];
    if (predecessors.length > 1) throw new Error('此创作存在多个已安装版本，请先处理旧版本');
    const native = require('./studio-native-projects.cjs').MODES.has(item.draft.mode), callId = crypto.randomUUID();
    if (native) await onEvent({ type: 'tool_start', callId, name: 'build_native_mod', detail: '编译实际代码并构建可安装的游戏资源' });
    let engine;
    try {
     engine = native ? await this.studio.native.build(game, item, workspace.context.engineEvidence, { predecessor: predecessors[0], installersRoot: this.studio.options.lifecycle?.installers.root, work, signal, current, authorize, onEvent })
      : await require('./studio-engines.cjs').compileEngineProject(game, item, workspace.context.engineEvidence, { predecessor: predecessors[0] });
     if (native) await onEvent({ type: 'tool_end', callId, name: 'build_native_mod', failed: engine.checks.some(check => check.status === 'failed'), detail: engine.checks.map(check => check.detail).join('；') });
    } catch (error) { if (native) await onEvent({ type: 'tool_end', callId, name: 'build_native_mod', failed: true, detail: error.message }); throw error; }
    for (const check of engine.checks) await step(check.name, check.status, check.detail);
    if (!report.checks.some(entry => ['failed', 'blocked'].includes(entry.status))) {
     const bytes = zipContent([...engine.outputs, { name: 'BUILD.json', data: Buffer.from(JSON.stringify({ gameId: game.id, adapter: item.adapterId, sourceSha256: item.sha256, runtimeVerified: false }, null, 2)) }]);
     if (bytes.length > 32 * 1024 * 1024) throw new Error('原生 Mod 增量包超过 32 MB 限制');
     await fs.writeFile(path.join(directory, 'compiled.zip'), bytes, { flag: 'wx' });
     report.bundle = { sha256: hash(bytes), size: bytes.length, filename: item.draft.name + '-mod.zip' };
     report.deployment = { baseHashes: engine.baseHashes, generatedCaches: engine.generatedCaches || [], ...(engine.nativeManifestSha256 ? { nativeManifestSha256: engine.nativeManifestSha256 } : {}) };
     report.outputs.push(...engine.outputs.map(file => ({ name: file.name, size: file.data.length, sha256: hash(file.data) })));
     await step('引擎 Mod 打包', 'passed', `${engine.outputs.length} 个实际文件；加载入口与原文件版本已核对，游戏内效果待验证。`);
    }
   } else if (!adapter.compiler) await step('编译阶段', item.adapterId === 'custom-project' ? 'blocked' : 'passed', item.adapterId === 'custom-project' ? '此工程尚无专用编译适配；已保存源码，不执行工程中的构建脚本' : adapter.build);
   await stage('verifying');
   for (const file of files) { check(); if (file.name.endsWith('.json')) { JSON.parse(file.text); await step('JSON · ' + file.name, 'passed', 'JSON 解析通过'); } if (file.image) { pngBytes(file.image); await step('贴图 · ' + file.name, 'passed', 'PNG 尺寸、CRC、解压结构检查通过'); } }
   if (compiled && !report.checks.some(entry => ['failed', 'blocked'].includes(entry.status))) {
    const name = item.manifest.UniqueID + '.dll';
    const bytes = zipContent([{ name: 'plugins/' + name, data: compiled }, { name: 'BUILD.json', data: Buffer.from(JSON.stringify({ gameId: game.id, adapter: item.adapterId, sourceSha256: item.sha256, compiler: tools.csharp.version, runtimeVerified: false }, null, 2)) }]);
    await fs.writeFile(path.join(directory, 'compiled.zip'), bytes, { flag: 'wx' });
    report.bundle = { sha256: hash(bytes), size: bytes.length, filename: item.draft.name + '-compiled.zip' };
    report.outputs.push({ name: 'plugins/' + name, size: compiled.length, sha256: hash(compiled) });
   }
   if (['ue4ss-lua', 'reframework-lua'].includes(item.adapterId) && !report.checks.some(entry => ['failed', 'blocked'].includes(entry.status))) {
    const sources = files.filter(file => file.name.startsWith('mod/')).map(file => ({ name: file.name, data: Buffer.from(file.text || '') }));
    const bytes = zipContent([...sources, { name: 'BUILD.json', data: Buffer.from(JSON.stringify({ gameId: game.id, adapter: item.adapterId, sourceSha256: item.sha256, runtimeVerified: false, installation: report.installation }, null, 2)) }]);
    await fs.writeFile(path.join(directory, 'compiled.zip'), bytes, { flag: 'wx' });
    report.bundle = { sha256: hash(bytes), size: bytes.length, filename: item.draft.name + '-mod.zip' };
    report.outputs.push(...sources.map(file => ({ name: file.name, size: file.data.length, sha256: hash(file.data) })));
    await step('脚本 Mod 打包', 'passed', `${sources.length} 个实际加载文件；Lua 编译通过并已打包 ZIP，游戏效果待实测。`);
   }
   if (['bg3-lua', 'bg3-follower'].includes(item.adapterId) && !report.checks.some(entry => ['failed', 'blocked'].includes(entry.status))) {
    const sources = files.filter(file => file.name.startsWith('package/')).map(file => ({ name: file.name.slice(8), data: Buffer.from(file.text) }));
    const pak = writePak(sources), checked = readModule(pak);
    if (checked.module.UUID !== item.manifest.UUID || checked.files.length !== sources.length || checked.files.some(file => !sources.some(source => source.name === file.name && hash(source.data) === hash(file.data)))) throw new Error('BG3 PAK 回读与源文件不一致');
    const name = 'Mods/' + item.manifest.Folder + '.pak';
    const bytes = zipContent([{ name, data: pak }, { name: 'BUILD.json', data: Buffer.from(JSON.stringify({ gameId: game.id, adapter: item.adapterId, sourceSha256: item.sha256, packageVersion: 18, runtimeVerified: false })) }]);
    await fs.writeFile(path.join(directory, 'compiled.zip'), bytes, { flag: 'wx' });
    report.bg3Module = checked.module;
    report.bundle = { sha256: hash(bytes), size: bytes.length, filename: item.draft.name + '-bg3.zip' };
    report.outputs.push({ name, size: pak.length, sha256: hash(pak) });
    await step('LSPK v18 打包', 'passed', `${checked.files.length} 个实际文件；LSX 模块、索引、数据边界与摘要回读通过`);
   }
   check(); return await this.finish(owner, id, report);
  } catch (error) {
   report.status = signal?.aborted || !current() ? 'cancelled' : 'failed'; report.summary = cleanLog(error.message);
   report.finished = new Date().toISOString(); await this.persist(owner, id, report); return report;
  } finally { this.running.delete(taskId); await fs.rm(work, { recursive: true, force: true }); }
 }
 async finish(owner, id, report) {
  report.status = report.checks.some(entry => entry.status === 'failed') ? 'failed' : report.checks.some(entry => entry.status === 'blocked') ? 'blocked' : 'passed';
  report.summary = report.status === 'passed' ? '制作与文件验证通过，游戏内效果待实测。' : report.status === 'blocked' ? '工程已保存，缺少必要工具、游戏依赖或专用适配。' : '工程已保存，编译或文件验证未通过。';
  if (report.adapter === 'project-plan') {
   if (report.status === 'passed') report.summary = '开发方案已生成并通过文档校验，尚未生成可安装的 Mod。';
   report.runtime = { status: 'not_applicable', detail: '这是开发方案，不包含可加载的 Mod，不适用游戏运行验证。' };
  }
  report.finished = new Date().toISOString(); await this.persist(owner, id, report); return report;
 }
 async bundle(owner, game, artifactId, buildId) {
  const { item } = await this.studio.archive(owner, game, artifactId);
  this.studio.recordPath(owner, buildId);
  const report = await smallJson(path.join(this.directory(owner, artifactId), buildId, 'report.json'));
  if (report.artifactId !== artifactId || report.gameId !== game.id || report.sourceSha256 !== item.sha256 || report.status !== 'passed' || !report.bundle) throw new Error('没有可导出的已通过编译产物');
  const file = path.join(this.directory(owner, artifactId), buildId, 'compiled.zip'), stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024) throw new Error('编译包无法读取或超出限制');
  const bytes = await fs.readFile(file); if (hash(bytes) !== report.bundle.sha256) throw new Error('编译包完整性校验失败');
  return { filename: report.bundle.filename, base64: bytes.toString('base64') };
 }
 async checkRuntime(owner, game, id, current) {
  const { item } = await this.studio.archive(owner, game, id), report = item.toolchain;
  if (!report) throw new Error('请先编译并验证此产物');
  if (report.sourceSha256 !== item.sha256) throw new Error('构建记录与产物版本不一致');
  if (!current()) throw new Error('制作任务已取消');
  const runtime = this.studio.options.runtimeCheck ? await this.studio.options.runtimeCheck({ owner, game, artifact: item }) : { status: 'unavailable', detail: '当前宿主尚未接入游戏运行验证。' };
  if (!current()) throw new Error('制作任务已取消');
  report.runtime = { ...runtime, detail: String(runtime.detail).slice(0, 2000) }; await this.persist(owner, id, report); return report;
 }
}
module.exports = { StudioToolchain, ADAPTERS, managedDll };
