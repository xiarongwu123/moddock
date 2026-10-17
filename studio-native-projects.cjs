const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { NativeTools, nativeSource } = require('./studio-native-tools.cjs');
const { safePath, localFile } = require('./studio-engines.cjs');
const { readPck, addAutoload } = require('./studio-godot.cjs');
const { originalBytes, createNativePatch } = require('./studio-native-patch.cjs');
const rgss = require('./studio-rgss.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const MODES = new Set(['godot-gdscript', 'gamemaker-gml', 'rpgmaker-rgss', 'unity-il2cpp']);
const godotIncludes = ['project.godot', 'project.binary', '**/*.gd', '**/*.gdc', '**/*.tscn', '**/*.tres', '**/*.remap', '**/*.import'].map(name => '--include=res://' + name);
const bridgePath = () => nativeSource('gamemaker.csx');
async function boundedFile(file, limit = 1024 ** 3) { const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new Error('原生资源不是普通文件或超过大小限制'); return fs.readFile(file); }
function documents(sources) {
 let total = 0;
 return sources.filter(source => typeof source.text === 'string').sort((a, b) => Number(/main|player|battle|damage|combat|actor|inventory/i.test(b.path)) - Number(/main|player|battle|damage|combat|actor|inventory/i.test(a.path))).flatMap(source => {
  const bytes = Buffer.byteLength(source.text); if (total + Math.min(bytes, 16000) > 48 * 1024) return [];
  const complete = bytes <= 16000; total += Math.min(bytes, 16000);
  return [{ ...source, bytes, sha256: sha(Buffer.from(source.text)), text: complete ? source.text : source.text.slice(0, 16000), complete }];
 }).slice(0, 48);
}
class NativeProjects {
 constructor(options = {}) { this.tools = new NativeTools(options); this.options = options; this.root = path.join(this.tools.root, 'projects'); this.pending = new Map(); }
 directory(game) { return path.join(this.root, sha(Buffer.from(path.resolve(game.installPath)))); }
 async snapshot(game, evidence) {
  if (!evidence) return evidence;
  try {
   const record = JSON.parse(await boundedFile(path.join(this.directory(game), 'snapshot.json'), 256 * 1024));
   const bytes = await boundedFile(await localFile(await fs.realpath(game.installPath), record.native.target));
   if (sha(bytes) !== record.native.sha256) return evidence;
   if (record.mode === 'unity-il2cpp' && sha(await boundedFile(await localFile(await fs.realpath(game.installPath), record.native.metadata))) !== record.native.metadataSha256) return evidence;
   let total = 0;
   const selected = [...record.documents, ...evidence.documents].filter(doc => { const length = Buffer.byteLength(doc.text); if (total + length > 52 * 1024) return false; total += length; return true; }).slice(0, 48);
   return { ...evidence, ...record, inventory: [...record.documents.map(({ path, bytes, sha256, complete, entry, kind }) => ({ path, bytes, sha256, complete, entry, kind })), ...evidence.inventory].slice(0, 208), documents: selected, blockers: [], routes: [record.native.route], runtimeVerified: false };
  } catch (error) { if (error.code === 'ENOENT') return evidence; throw error; }
 }
 async prepare(game, evidence, context = {}) {
  if (!evidence || !['godot', 'gamemaker', 'rpgmaker-rgss', 'unity-il2cpp'].includes(evidence.engineKey)) return;
  const key = path.resolve(game.installPath); if (this.pending.has(key)) return this.pending.get(key);
  const task = this.prepareOne(game, evidence, context); this.pending.set(key, task);
  try { return await task; } finally { this.pending.delete(key); }
 }
 async recoverGodot(source, output, context) {
  await this.tools.run('gdre', ['--headless', '--recover=' + source, '--output=' + output, ...godotIncludes], context);
  await this.tools.run('gdre', ['--headless', '--script', nativeSource('godot-config.gd'), '--', source, output], context);
 }
 async prepareOne(game, evidence, context) {
  const root = await fs.realpath(game.installPath), names = evidence.inventory.map(file => file.path); let targets;
  const gameConfigs = evidence.documents.filter(doc => /(?:^|\/)Game\.ini$/i.test(doc.path) && doc.complete), configuredScripts = gameConfigs.length === 1 ? /^Scripts\s*=\s*([^\r\n]+)$/im.exec(gameConfigs[0].text)?.[1]?.trim().replace(/\\/g, '/') : null;
  if (configuredScripts) safePath(configuredScripts);
  if (evidence.engineKey === 'godot') targets = names.filter(name => /\.pck$/i.test(name));
  else if (evidence.engineKey === 'gamemaker') targets = names.filter(name => /(?:^|\/)(?:data\.win|game\.(?:unx|ios|droid))$/i.test(name));
  else if (evidence.engineKey === 'rpgmaker-rgss') {
   const archives = names.filter(name => /(?:^|\/)game\.(?:rgssad|rgss[23]a)$/i.test(name));
   targets = archives.length ? archives : names.filter(name => configuredScripts ? name.toLowerCase() === path.posix.join(path.posix.dirname(gameConfigs[0].path), configuredScripts).toLowerCase() : /(?:^|\/)data\/scripts\.(?:rxdata|rvdata2?)$/i.test(name));
  } else return require('./studio-il2cpp.cjs').prepareIl2cpp(this, game, evidence, context);
  if (!targets.length && evidence.engineKey === 'godot') targets = (context.diagnostic?.engine.evidence || []).filter(name => /\.(?:exe|x86_64)$/i.test(name));
  if (targets.length !== 1) throw new Error('未能确认唯一的主资源容器，无法安全构建：' + targets.join('、'));
  const target = targets[0], bytes = await boundedFile(await localFile(root, target)), digest = sha(bytes), directory = this.directory(game);
  try { const record = JSON.parse(await fs.readFile(path.join(directory, 'snapshot.json'), 'utf8')); if (record.native.sha256 === digest && MODES.has(record.mode)) return record; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(this.root, { recursive: true });
  const work = await fs.mkdtemp(path.join(this.root, 'extract-')), callId = crypto.randomUUID(), onEvent = context.onEvent || (async () => {});
  await onEvent({ type: 'tool_start', callId, name: 'extract_game_code', detail: '提取本机玩法接口并确认原生加载入口' });
  try {
   let record;
   if (evidence.engineKey === 'godot') {
    const pck = readPck(bytes), recovered = path.join(work, 'recovered');
    await this.recoverGodot(await localFile(root, target), recovered, { ...context, cwd: work });
    const config = await boundedFile(path.join(recovered, 'project.godot'), 512 * 1024), sources = [];
    async function walk(dir, prefix = '') {
     for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('恢复目录含链接');
      const name = prefix + entry.name;
      if (entry.isDirectory() && !/^(?:\.godot|\.git)(?:\/|$)/.test(name)) await walk(path.join(dir, entry.name), name + '/');
      else if (entry.isFile() && /\.(?:gd|tscn|tres|godot)$/.test(name) && sources.length < 160 && (await fs.stat(path.join(dir, entry.name))).size < 128 * 1024) sources.push({ path: 'native/godot/' + name, text: await fs.readFile(path.join(dir, entry.name), 'utf8') });
     }
    }
    await walk(recovered);
    record = { mode: 'godot-gdscript', documents: documents(sources), native: { target, sha256: digest, version: pck.version, route: '恢复 GDScript → 匹配字节码编译 → 注入自动加载入口 → 重建 PCK → 增量安装与还原' } };
   } else if (evidence.engineKey === 'gamemaker') {
    await fs.writeFile(path.join(work, 'bridge-request.json'), JSON.stringify({ operation: 'inspect' }));
    await this.tools.run('umt', ['load', await localFile(root, target), '-s', bridgePath()], { ...context, cwd: work });
    const result = JSON.parse(await boundedFile(path.join(work, 'bridge-result.json'), 512 * 1024));
    const sources = result.entries.filter(entry => entry.source !== null).map((entry, i) => ({ path: `native/gml/${i}.gml`, entry: entry.name, text: entry.source }));
    if (!sources.length) throw new Error('未提取到可编辑的 GML 字节码接口');
    record = { mode: 'gamemaker-gml', documents: documents(sources), native: { target, sha256: digest, version: result.version.join('.'), bytecode: result.bytecode, entries: result.entries.map(entry => entry.name), route: 'GML 反编译 → 实际入口重编译 → data.win 回读 → 增量安装与还原' } };
   } else {
    let database = bytes, databasePath = target;
    if (/\.rgss(?:ad|[23]a)$/i.test(target)) {
     const archive = rgss.archiveRead(bytes), found = archive.entries.filter(entry => configuredScripts ? entry.name.toLowerCase() === configuredScripts.toLowerCase() : /(?:^|\/)data\/scripts\.(?:rxdata|rvdata2?)$/i.test(entry.name));
     if (found.length !== 1) throw new Error('RGSS 归档内未找到唯一脚本数据库');
     database = archive.read(found[0]); databasePath = found[0].name;
    }
    const scripts = rgss.scriptsRead(database);
    if (!scripts.some(entry => /^main$/i.test(entry.name.trim()) || /(?:rgss_main|\bSceneManager\.run\b|\$scene\s*=\s*Scene_Title)/.test(entry.source))) throw new Error('RGSS 缺少可确认的 Main 加载入口');
    record = { mode: 'rpgmaker-rgss', documents: documents(scripts.map((entry, i) => ({ path: `native/rgss/${i}.rb`, script: entry.name, text: entry.source }))), native: { target, sha256: digest, databasePath, version: /rvdata2$/i.test(databasePath) ? 'RGSS3' : /rvdata$/i.test(databasePath) ? 'RGSS2' : 'RGSS1', route: '读取 RGSS 脚本 → Ruby 编译 → Main 前注入 → 重建脚本数据库与归档 → 增量安装与还原' } };
   }
   await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, 'snapshot.json'), JSON.stringify(record));
   await onEvent({ type: 'tool_end', callId, name: 'extract_game_code', detail: `已恢复 ${record.documents.length} 份本机代码与接口` }); return record;
  } catch (error) { await onEvent({ type: 'tool_end', callId, name: 'extract_game_code', failed: true, detail: error.message }); throw error; }
  finally { await fs.rm(work, { recursive: true, force: true }); }
 }
 async build(game, item, evidence, context = {}) {
  if (evidence.mode !== item.draft.mode || !evidence.native) throw new Error('原生制作入口与当前游戏不一致');
  if (item.draft.mode === 'unity-il2cpp') return require('./studio-il2cpp.cjs').buildIl2cpp(this, game, item, evidence, context);
  const root = await fs.realpath(game.installPath), native = evidence.native, base = await originalBytes(root, native.target, context.predecessor, context.installersRoot);
  if (sha(base.current) !== native.sha256) throw new Error('游戏资源在调查后已变化，请重新分析');
  const work = context.work, source = path.join(work, 'original' + path.extname(native.target)); await fs.writeFile(source, base.original);
  let output, checks = [];
  if (item.draft.mode === 'rpgmaker-rgss') {
   const result = await require('./studio-ruby.cjs').checkRuby(item.draft.files[0].text, context.signal);
   checks.push({ name: 'Ruby 字节码编译', status: result.passed ? 'passed' : 'failed', detail: result.detail });
   if (!result.passed) return { outputs: [], checks };
   if (/\.rgss(?:ad|[23]a)$/i.test(native.target)) {
    const archive = rgss.archiveRead(base.original), entry = archive.entries.find(entry => entry.name === native.databasePath);
    if (!entry) throw new Error('原始归档脚本入口发生变化');
    const database = rgss.scriptsPatch(archive.read(entry), item.manifest.UniqueID, item.draft.files[0].text);
    output = rgss.archiveWrite(archive, new Map([[entry.name, database]]));
   } else output = rgss.scriptsPatch(base.original, item.manifest.UniqueID, item.draft.files[0].text);
   checks.push({ name: 'RGSS 脚本与归档重建', status: 'passed', detail: '实际 Ruby 脚本已插入 Main 之前；原有脚本、非修改资产均已逐项回读核对。' });
  } else if (item.draft.mode === 'gamemaker-gml') {
   const sources = [];
   for (const [i, target] of item.draft.targets.entries()) {
    const doc = evidence.documents.find(doc => doc.entry === target.entry && doc.complete && doc.sha256 === target.sha256);
    if (!doc) throw new Error('GML 源码入口或摘要不一致');
    const file = path.join(work, `${i}.gml`); await fs.writeFile(file, item.draft.files.find(file => file.name === target.source).text); sources.push({ entry: target.entry, file });
   }
   const modified = path.join(work, 'modified.win');
   await fs.writeFile(path.join(work, 'bridge-request.json'), JSON.stringify({ operation: 'build', sources }));
   const log = await this.tools.run('umt', ['load', source, '-s', bridgePath(), '-o', modified], { ...context, cwd: work });
   const result = JSON.parse(await boundedFile(path.join(work, 'bridge-result.json'), 32768).catch(() => { throw new Error(log.slice(-12000)); }));
   if (result.compiled !== sources.length) throw new Error('GML 编译入口数量不一致');
   await fs.rm(path.join(work, 'bridge-result.json')); await fs.writeFile(path.join(work, 'bridge-request.json'), JSON.stringify({ operation: 'inspect' }));
   await this.tools.run('umt', ['load', modified, '-s', bridgePath()], { ...context, cwd: work });
   const readback = JSON.parse(await boundedFile(path.join(work, 'bridge-result.json'), 512 * 1024));
   if (sources.some(source => !readback.entries.some(entry => entry.name === source.entry && typeof entry.source === 'string'))) throw new Error('编译后的 GML 入口回读失败');
   output = await boundedFile(modified);
   checks.push({ name: 'GML 原生编译与 data.win 回读', status: 'passed', detail: `${sources.length} 个实际入口编译通过，重建后的容器已由原生工具重新读取。` });
  } else {
   const original = readPck(base.original), recovered = path.join(work, 'base-project');
   await this.recoverGodot(source, recovered, { ...context, cwd: work });
   const config = (await boundedFile(path.join(recovered, 'project.godot'), 512 * 1024)).toString('utf8');
   const script = path.join(work, 'main.gd'); await fs.writeFile(script, item.draft.files[0].text);
   const validator = await this.tools.ensureGodot(native.version, context);
   const validation = await require('./studio-tools.cjs').runTool(validator, [native.version.startsWith('3.') ? '--no-window' : '--headless', '--path', recovered, '--script', script, '--check-only'], { cwd: work, signal: context.signal, timeout: 45000, limit: 64000 });
   if (validation.code !== 0 || /(?:Parse Error|SCRIPT ERROR|Error parsing|Failed to load script)/i.test(validation.output)) return { outputs: [], checks: [{ name: 'Godot 原生脚本解析', status: 'failed', detail: validation.output.slice(-12000) }] };
   checks.push({ name: 'Godot 原生脚本解析', status: 'passed', detail: `Godot ${native.version} 原生解析器通过，使用 check-only，未启动游戏主场景。` });
   const log = await this.tools.run('gdre', ['--headless', '--compile=' + script, '--bytecode=' + native.version, '--output=' + work], { ...context, cwd: work });
   const compiled = await boundedFile(path.join(work, 'main.gdc'), 256 * 1024).catch(() => { throw new Error(log.slice(-12000)); });
   if (!['GDSC', 'GDS2'].includes(compiled.toString('ascii', 0, 4))) throw new Error('未生成有效的 Godot 字节码');
   const resource = `moddock/${item.manifest.UniqueID}/main.gdc`, settings = addAutoload(config, item.manifest.UniqueID, 'res://' + resource), settingsFile = path.join(work, 'project.godot');
   await fs.writeFile(settingsFile, settings);
   const modified = path.join(work, 'modified' + path.extname(native.target));
   await this.tools.run('gdre', ['--headless', '--pck-patch=' + source, '--output=' + modified, '--patch-file=' + path.join(work, 'main.gdc') + '=res://' + resource, '--patch-file=' + settingsFile + '=res://project.godot', '--exclude=res://project.binary', ...(original.start ? ['--embed=' + source] : [])], { ...context, cwd: work });
   output = await boundedFile(modified); const readback = readPck(output);
   if (!readback.files.get(resource)?.data.equals(compiled) || readback.files.get('project.godot')?.data.toString('utf8') !== settings || readback.files.has('project.binary')) throw new Error('Godot 加载入口或脚本字节码回读失败');
   for (const [name, file] of original.files) if (!['project.binary', 'project.godot'].includes(name) && !file.data.equals(readback.files.get(name)?.data || Buffer.alloc(0))) throw new Error('Godot 原有资源发生意外变化：' + name);
   checks.push({ name: 'GDScript 字节码与 PCK 重建', status: 'passed', detail: `按 Godot ${native.version} 编译实际脚本，已注入 autoload，保留并回读核对原有资源。` });
  }
  const bundle = await createNativePatch([{ path: native.target, before: base.original, after: output }], item.draft.mode);
  checks.push({ name: '原生增量包', status: 'passed', detail: '增量已在原始资源上重新应用，输出 SHA-256 与原生构建结果完全一致。' });
  return { ...bundle, checks, passed: true };
 }
}
module.exports = { NativeProjects, MODES, boundedFile, documents };
