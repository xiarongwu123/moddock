const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

const FAMILIES = { unity: 'Unity', unreal: 'Unreal Engine', godot: 'Godot', rpgmaker: 'RPG Maker', renpy: "Ren'Py", gamemaker: 'GameMaker' };
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const familyFor = key => key?.startsWith('unity') ? 'unity' : key?.startsWith('rpgmaker') ? 'rpgmaker' : Object.hasOwn(FAMILIES, key || '') ? key : null;
const excluded = /(^|\/)(?:saves?|saved|savegames|user(?:data)?|logs?|cache|\.git|node_modules|screenshots?|persistent)(\/|\.|$)|(?:secret|credential|token|password|\.env)(?:\.|$)/i;
const textResource = /\.(?:js|json|gd|tscn|tres|godot|rpy|py|gml|yy|yyp|ini|cfg|csv|xml|cs|hpp|h|lua)$/i;
function safePath(value) {
 if (typeof value !== 'string' || !value || value.length > 180 || /[\\:\x00-\x1f<>"|?*]/.test(value) || value.split('/').some(part => !part || ['.', '..'].includes(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('游戏资源路径无效');
 return value;
}
async function localFile(root, relative) {
 safePath(relative);
 const file = path.join(await fs.realpath(root), relative);
 if (await fs.realpath(file) !== file || !(await fs.lstat(file)).isFile()) throw new Error('游戏资源含链接或不是普通文件');
 return file;
}
function detectAdditionalEngine(files) {
 const names = [...files.keys()], find = pattern => names.filter(name => pattern.test(name));
 const result = (key, name, evidence) => ({ key, name, confidence: '文件特征匹配', evidence: evidence.map(file => files.get(file)) });
 const mz = find(/(^|\/)js\/rmmz_core\.js$/), mv = find(/(^|\/)js\/rpg_core\.js$/);
 if (mz.length || mv.length) return result(mz.length ? 'rpgmaker-mz' : 'rpgmaker-mv', 'RPG Maker ' + (mz.length ? 'MZ' : 'MV'), (mz.length ? mz : mv).slice(0, 3));
 const rgss = find(/(^|\/)(?:game\.rgss(?:ad|2a|3a)|data\/scripts\.(?:rxdata|rvdata2?)|rgss[123]\d{2}[a-z]?\.dll|.*\.rxproj|.*\.rvproj2?)$/);
 if (rgss.length) return result('rpgmaker-rgss', 'RPG Maker · RGSS', rgss.slice(0, 3));
 const lcf = find(/(^|\/)rpg_rt\.ldb$/); if (lcf.length) return result('rpgmaker-lcf', 'RPG Maker 2000 / 2003', lcf.slice(0, 3));
 const renpy = find(/(^|\/)renpy\/(?:__init__\.py[co]?|common\/.*\.rpyc?)$/);
 if (renpy.length) return result('renpy', "Ren'Py", renpy.slice(0, 3));
 const gm = find(/(^|\/)(?:data\.win|game\.(?:unx|ios|droid)|.*\.yyp)$/);
 if (gm.length) return result('gamemaker', 'GameMaker', gm.slice(0, 3));
 const godot = find(/(^|\/)(?:project\.godot|.*\.pck)$/);
 if (godot.length) return result('godot', 'Godot', godot.slice(0, 3));
 return null;
}
async function inspectContainer(file, kind) {
 const handle = await fs.open(file, 'r');
 try {
  const { size } = await handle.stat(), header = Buffer.alloc(100);
  await handle.read(header, 0, Math.min(size, header.length), 0);
  if (kind === 'godot' && header.toString('ascii', 0, 4) === 'GDPC' && size >= 88) {
   const format = header.readUInt32LE(4), version = [8, 12, 16].map(offset => header.readUInt32LE(offset)).join('.');
   let count = format === 1 ? header.readUInt32LE(84) : format === 2 && size >= 100 ? header.readUInt32LE(96) : null;
   if (format >= 3) { const offset = Number(header.readBigUInt64LE(32)); if (Number.isSafeInteger(offset) && offset >= 104 && offset + 4 <= size) { const word = Buffer.alloc(4); await handle.read(word, 0, 4, offset); count = word.readUInt32LE(0); } }
   return { format: 'Godot PCK', packVersion: format, engineVersion: version, encryptedDirectory: format >= 2 ? !!(header.readUInt32LE(20) & 1) : false, fileCount: count, nativeCompilerRequired: true };
  }
  if (kind === 'gamemaker' && header.toString('ascii', 0, 4) === 'FORM' && size >= 8) {
   const chunks = []; let offset = 8;
   if (header.readUInt32LE(4) + 8 > size) return { format: 'GameMaker FORM', error: '容器长度越界' };
   while (offset + 8 <= size && chunks.length < 80) {
    const chunk = Buffer.alloc(8); await handle.read(chunk, 0, 8, offset);
    const tag = chunk.toString('ascii', 0, 4), length = chunk.readUInt32LE(4);
    if (!/^[A-Z0-9]{4}$/.test(tag) || offset + 8 + length > size) return { format: 'GameMaker FORM', chunks, error: '分块索引无效' };
    chunks.push({ tag, bytes: length }); offset += length + 8;
   }
   return { format: 'GameMaker FORM', chunks, vmCodePresent: chunks.some(chunk => chunk.tag === 'CODE' && chunk.bytes > 4), note: 'CODE 分块仅为静态字节码线索；具体版本及 YYC 需专用工具确认', nativeCompilerRequired: true };
  }
  return { format: 'unverified', note: '仅文件名匹配，尚未确认容器格式' };
 } finally { await handle.close(); }
}
async function embeddedGodot(root, files) {
 for (const [lower, name] of [...files].filter(([name]) => /\.(?:exe|x86_64)$/.test(name)).slice(0, 8)) {
  const handle = await fs.open(await localFile(root, name), 'r');
  try {
   const { size } = await handle.stat(); if (size < 100) continue;
   const tail = Buffer.alloc(12); await handle.read(tail, 0, 12, size - 12);
   if (tail.toString('ascii', 8, 12) !== 'GDPC') continue;
   const length = tail.readBigUInt64LE(0); if (length > BigInt(size - 12) || length < 88n) continue;
   const magic = Buffer.alloc(4); await handle.read(magic, 0, 4, size - 12 - Number(length));
   if (magic.toString() === 'GDPC') return { key: 'godot', name: 'Godot · 内嵌资源包', confidence: '资源包头匹配', evidence: [name] };
  } finally { await handle.close(); }
 }
 return null;
}
async function collectEngineEvidence(game, report) {
 const family = familyFor(report.engine.key);
 if (!family) return null;
 const root = await fs.realpath(game.installPath), inventory = [], documents = [];
 let indexed = 0, textBytes = 0, truncated = false;
 async function walk(directory, prefix = '', depth = 0) {
  const priority = entry => /^(?:js|game|renpy|scripts|data|config|settings|il2cpp_data|metadata)$/i.test(entry.name) || /_Data$/i.test(entry.name) ? 0 : /^(?:bepinex|dotnet|melonloader)$/i.test(entry.name) ? 3 : 1;
  const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => priority(a) - priority(b) || a.name.localeCompare(b.name));
  for (const entry of entries) {
   if (++indexed > 12000) { truncated = true; return; }
   const name = prefix + entry.name;
   if (entry.isSymbolicLink() || excluded.test(name)) continue;
   if (entry.isDirectory() && depth < 5) await walk(path.join(directory, entry.name), name + '/', depth + 1);
   else if (entry.isFile() && (textResource.test(name) || /\.(?:pck|win|unx|rpa|rpyc|rgssad|rgss[23]a|rxdata|rvdata2?|utoc|pak|dll|dat)$/i.test(name))) {
    if (inventory.length < 160) {
     try { safePath(name); const stat = await fs.lstat(path.join(root, name)); inventory.push({ path: name, bytes: stat.size }); } catch { /* Unusable names are not writable targets. */ }
    } else truncated = true;
   }
   if (indexed > 12000) return;
  }
 }
 await walk(root);
 // Loader runtimes can fill the bounded inventory before the game's own binary.
 for (const name of [...(report.engine.evidence || []), ...(report.il2cppMetadata || []), ...(report.loaderFiles?.BepInEx || [])]) {
  if (inventory.some(file => file.path === name)) continue;
  try { const stat = await fs.stat(await localFile(root, name)); if (inventory.length >= 160) inventory.pop(); inventory.unshift({ path: name, bytes: stat.size }); } catch { /* Diagnostics do not authorize linked or missing files. */ }
 }
 const preferred = file => /(?:plugins\.js|project\.godot|options\.rpy|script\.rpy|system\.json|config|settings|player|combat|battle|scripts\/)/i.test(file.path) ? 0 : /(?:rpg|rmmz)_(?:objects|managers|core)\.js$/i.test(file.path) ? 1 : 2;
 for (const file of [...inventory].filter(file => textResource.test(file.path) && file.bytes <= 512 * 1024).sort((a, b) => preferred(a) - preferred(b) || a.bytes - b.bytes)) {
  if (documents.length >= 32 || textBytes >= 52 * 1024) { truncated = true; break; }
  try {
   const bytes = await fs.readFile(await localFile(root, file.path));
   const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
   if (text.includes('\0')) continue;
   const remaining = 52 * 1024 - textBytes, complete = bytes.length <= Math.min(16000, remaining);
   // Large engine files contribute interface lines, never a falsely complete patch target.
   const excerpt = complete ? text : text.split('\n').map((line, index) => ({ line, index })).filter(({ line }) => /(?:prototype\.|function |class |def |func |signal |extends |Utils\.RPGMAKER_(?:NAME|VERSION))/.test(line)).slice(0, 80).map(({ line, index }) => `${index + 1}: ${line.slice(0, 180)}`).join('\n').slice(0, Math.min(6000, remaining));
   if (!excerpt) continue;
   documents.push({ path: file.path, bytes: bytes.length, sha256: digest(bytes), complete, text: excerpt }); textBytes += Buffer.byteLength(excerpt);
  } catch { /* Binary, inaccessible and linked files stay outside the source snapshot. */ }
 }
 const core = inventory.find(file => /(^|\/)js\/(?:rpg|rmmz)_core\.js$/i.test(file.path));
 const renpy = inventory.find(file => /(^|\/)renpy\/__init__\.py$/i.test(file.path)) || (family === 'renpy' && report.engine.evidence.find(file => /(^|\/)renpy\//i.test(file)) ? { path: report.engine.evidence.find(file => /(^|\/)renpy\//i.test(file)) } : null);
 const base = core ? core.path.replace(/js\/[^/]+$/i, '') : renpy ? renpy.path.replace(/renpy\/.*$/i, '') : '';
 const registry = core && inventory.find(file => file.path.toLowerCase() === (base + 'js/plugins.js').toLowerCase());
 const containers = [];
 for (const file of inventory.filter(file => /\.(?:pck|win|unx|droid)$/i.test(file.path)).slice(0, 4)) {
  try { containers.push({ path: file.path, ...await inspectContainer(await localFile(root, file.path), family) }); } catch { /* Inspection errors do not turn into asserted support. */ }
 }
 let mode = family === 'rpgmaker' && core && registry ? 'rpgmaker-plugin' : family === 'renpy' && renpy ? 'renpy-python' : 'investigate';
 if (report.antiCheat.length || report.onlineOnly) mode = 'investigate';
 return { family, name: FAMILIES[family], engineKey: report.engine.key, mode, base, registry: registry?.path || null, inventory, documents, containers, truncated,
  policy: 'Bounded read-only source snapshot. Incomplete interface excerpts are not complete files. No game code was executed. Missing APIs must not be invented.',
  routes: mode === 'rpgmaker-plugin' ? ['JavaScript plugin with host-owned plugins.js registration', 'exact text resource patches'] : mode === 'renpy-python' ? ['Python initialization script loaded by Ren\'Py', 'exact text resource patches'] : ['exact patches to readable text resources', 'source development with explicit build or loading blockers'],
  blockers: mode === 'investigate' ? [family === 'godot' ? '需确认资源挂载与脚本格式；独立 PCK 不会自动加载。' : family === 'gamemaker' ? '需核对 data.win 字节码或 YYC 与重编译工具；GML 源码不能直接复制进成品游戏。' : family === 'rpgmaker' ? '此版本未检测到 MV/MZ 插件入口；RGSS 需要独立 Ruby/归档工具链。' : '需确认此游戏的可加载入口及本机接口，源码存在不等于可安装。'] : [], runtimeVerified: false };
}
function searchEvidence(evidence, query) {
 const terms = String(query).toLowerCase().split(/[\s,]+/).filter(Boolean).slice(0, 12), matches = [];
 for (const doc of evidence?.documents || []) {
  doc.text.split('\n').forEach((line, index) => { if (terms.some(term => line.toLowerCase().includes(term))) matches.push({ path: doc.path, sha256: doc.sha256, line: doc.complete ? index + 1 : null, excerpt: line.slice(0, 400), evidence: doc.complete ? 'local-source' : 'interface-excerpt' }); });
 }
 return { matches: matches.slice(0, 24), coverage: '当前本机只读快照；没有匹配不表示游戏没有此接口', runtimeVerified: false };
}
function readEvidence(evidence, name) {
 const doc = evidence?.documents?.find(doc => doc.path === name);
 if (!doc) throw new Error('此文件未收录在本机只读快照中；请依据资源清单继续调查，不能假定其内容');
 return doc;
}
function parseRegistry(text) {
 const match = /^\s*(?:(?:\/\/[^\n]*\n)|(?:\/\*[\s\S]*?\*\/\s*))*\s*(?:var|let|const)\s+\$plugins\s*=\s*([\s\S]*?)\s*;?\s*$/.exec(text.replace(/^\uFEFF/, ''));
 if (!match) throw new Error('plugins.js 不是可安全合并的标准插件清单');
 const plugins = JSON.parse(match[1].replace(/;\s*$/, ''));
 if (!Array.isArray(plugins) || plugins.length > 500 || plugins.some(plugin => !plugin || typeof plugin.name !== 'string' || typeof plugin.status !== 'boolean' || typeof plugin.parameters !== 'object')) throw new Error('插件清单格式无效');
 return plugins;
}
function normalizeEngineDraft(input) {
 if (!input || !['rpgmaker-plugin', 'renpy-python', 'godot-gdscript', 'gamemaker-gml', 'rpgmaker-rgss', 'unity-il2cpp', 'resource-patch', 'source-development'].includes(input.mode)) throw new Error('引擎工程加载方式无效');
 if (!Array.isArray(input.files) || input.files.length > 12 || !Array.isArray(input.patches || []) || (input.patches || []).length > 12) throw new Error('引擎工程文件数量无效');
 const seen = new Set(); let bytes = 0;
 const files = input.files.map(file => {
  const name = safePath(file?.name);
  if (!/\.(?:js|py|gd|gml|cs|lua|rb|json|ini|cfg|tscn|tres)$/i.test(name) || seen.has(name.toLowerCase()) || typeof file.text !== 'string' || !file.text.trim() || file.text.includes('\0')) throw new Error('请提交实际代码或资源文件，不能以说明文档代替');
  seen.add(name.toLowerCase()); bytes += Buffer.byteLength(file.text); return { name, text: file.text };
 });
 const patches = (input.patches || []).map(patch => {
  const name = safePath(patch?.path);
  if (excluded.test(name) || !textResource.test(name) || !/^[a-f0-9]{64}$/.test(patch.sha256 || '') || typeof patch.find !== 'string' || !patch.find || typeof patch.replace !== 'string' || patch.find === patch.replace || patch.find.includes('\0') || patch.replace.includes('\0')) throw new Error('资源修改必须指定实际文件、原始摘要和唯一的替换文本');
  bytes += Buffer.byteLength(patch.find + patch.replace); return { path: name, sha256: patch.sha256, find: patch.find, replace: patch.replace };
 });
 if (bytes > 64 * 1024 || !files.length && !patches.length) throw new Error('请提交 64 KB 以内的实际实现');
 if (input.mode === 'resource-patch' && files.length || input.mode !== 'resource-patch' && patches.length) throw new Error('脚本工程和资源修改必须使用各自的加载方式');
 if (['rpgmaker-plugin', 'renpy-python'].includes(input.mode) && (files.length !== 1 || files[0].name !== (input.mode === 'rpgmaker-plugin' ? 'main.js' : 'main.py'))) throw new Error('请将完整实现写入主入口文件');
 const entries = { 'godot-gdscript': 'main.gd', 'rpgmaker-rgss': 'main.rb', 'unity-il2cpp': 'main.cs' };
 if (entries[input.mode] && (files.length !== 1 || files[0].name !== entries[input.mode])) throw new Error('请将完整实现写入 ' + entries[input.mode]);
 const targets = input.mode === 'gamemaker-gml' ? input.targets : undefined;
 if (input.mode === 'gamemaker-gml' && (!Array.isArray(targets) || !targets.length || targets.length !== files.length || targets.length > 12 || targets.some(target => !target || !files.some(file => file.name === target.source && /\.gml$/.test(file.name)) || typeof target.entry !== 'string' || target.entry.length > 240 || !/^[a-f0-9]{64}$/.test(target.sha256)) || new Set(targets.map(target => target.entry)).size !== targets.length || new Set(targets.map(target => target.source)).size !== targets.length)) throw new Error('GML 修改需绑定实际入口、原代码摘要和源码文件');
 const blockers = Array.isArray(input.blockers) ? input.blockers.filter(value => typeof value === 'string' && value.trim()).slice(0, 6).map(value => value.slice(0, 400)) : [];
 return { mode: input.mode, files, patches, blockers, ...(targets ? { targets: targets.map(({ entry, source, sha256 }) => ({ entry, source, sha256 })) } : {}) };
}
function validateEngineDraft(input, evidence) {
 const draft = normalizeEngineDraft(input), checks = [];
 if (['rpgmaker-plugin', 'renpy-python'].includes(draft.mode) && evidence?.mode !== draft.mode) throw new Error('当前游戏未检测到所选脚本加载入口');
 if (['godot-gdscript', 'gamemaker-gml', 'rpgmaker-rgss', 'unity-il2cpp'].includes(draft.mode)) {
  if (evidence?.mode !== draft.mode || !evidence.native) throw new Error('当前游戏尚未完成对应原生工具链的接口提取');
  if (draft.mode === 'gamemaker-gml' && draft.targets.some(target => !evidence.documents.some(doc => doc.entry === target.entry && doc.complete && doc.sha256 === target.sha256))) throw new Error('GML 入口必须来自本机完整反编译快照');
  checks.push({ name: '原生构建输入', status: 'passed', detail: '加载入口与本机资源已绑定；将在本机原生编译器中构建并回读，当前检查不代表编译成功。' });
 }
 for (const file of draft.files) {
  if (/\.js$/i.test(file.name)) {
   try { new vm.Script(file.text, { filename: file.name }); checks.push({ name: file.name, status: 'passed', detail: 'JavaScript 语法解析通过，未执行生成代码' }); }
   catch (error) { checks.push({ name: file.name, status: 'failed', detail: error.message }); }
  } else if (/\.py$/i.test(file.name)) {
   const { parser } = require('@lezer/python'), errors = [];
   parser.parse(file.text + '\n').iterate({ enter(node) { if (node.type.isError && errors.length < 8) errors.push('line ' + (file.text.slice(0, node.from).split('\n').length)); } });
   checks.push({ name: file.name, status: errors.length ? 'failed' : 'passed', detail: errors.length ? 'Python 语法错误：' + errors.join(', ') : 'Python 静态语法解析通过；尚未由游戏自带 Python 编译或运行' });
  } else if (/\.json$/i.test(file.name)) {
   try { JSON.parse(file.text); checks.push({ name: file.name, status: 'passed', detail: 'JSON 解析通过' }); }
   catch (error) { checks.push({ name: file.name, status: 'failed', detail: error.message }); }
  }
 }
 for (const patch of draft.patches) {
  const doc = evidence?.documents?.find(doc => doc.path === patch.path);
  if (!doc?.complete || doc.sha256 !== patch.sha256 || doc.text.split(patch.find).length !== 2) throw new Error('修改目标必须来自完整本机快照，且原文只匹配一次：' + patch.path);
 }
 if (draft.mode === 'source-development') checks.push({ name: '游戏构建与加载入口', status: 'blocked', detail: draft.blockers.join('；') || evidence?.blockers?.join('；') || '源码已保存，尚未确认此游戏的编译与加载入口' });
 return { passed: checks.every(check => check.status !== 'failed'), checks, runtimeVerified: false };
}
async function compileEngineProject(game, item, evidence, { predecessor } = {}) {
 const draft = normalizeEngineDraft(item.draft), validation = validateEngineDraft(draft, evidence), outputs = [], baseHashes = {}, generatedCaches = [];
 const root = await fs.realpath(game.installPath), add = (name, text) => outputs.push({ name: 'deploy/' + safePath(name), data: Buffer.from(text) });
 if (predecessor && predecessor.root !== root) throw new Error('上一版本安装位置与当前游戏不一致');
 if (validation.checks.some(check => ['failed', 'blocked'].includes(check.status))) return { ...validation, outputs, baseHashes, generatedCaches };
 if (draft.mode === 'rpgmaker-plugin') {
  const registry = evidence.registry, bytes = await fs.readFile(await localFile(root, registry)), plugins = parseRegistry(bytes.toString('utf8'));
  const original = evidence.documents.find(doc => doc.path === registry);
  if (!original?.complete || digest(bytes) !== original.sha256) throw new Error('插件清单已变化，请重新分析后制作');
  const name = item.manifest.UniqueID;
  const oldPlugins = (predecessor?.files || []).filter(file => /\/plugins\/Moddock[a-f0-9]+\.js$/.test(file.destination) && file.originalHash === null).map(file => path.posix.basename(file.destination, '.js'));
  const merged = plugins.filter(plugin => !oldPlugins.includes(plugin.name));
  merged.push({ name, status: true, description: item.draft.description, parameters: {} });
  add(evidence.base + 'js/plugins/' + name + '.js', draft.files[0].text + '\n');
  add(registry, 'var $plugins =\n' + JSON.stringify(merged, null, 2) + ';\n');
  baseHashes[registry] = digest(bytes); baseHashes[evidence.base + 'js/plugins/' + name + '.js'] = null;
 } else if (draft.mode === 'renpy-python') {
  const name = evidence.base + 'game/' + item.manifest.UniqueID + '.rpy';
  add(name, 'init 999 python:\n' + draft.files[0].text.split('\n').map(line => '    ' + line).join('\n') + '\n');
  baseHashes[name] = null; baseHashes[name + 'c'] = null; generatedCaches.push(name + 'c');
 } else if (draft.mode === 'resource-patch') {
  const grouped = new Map();
  for (const patch of draft.patches) {
   if (!grouped.has(patch.path)) {
    const bytes = await fs.readFile(await localFile(root, patch.path));
    if (digest(bytes) !== patch.sha256) throw new Error('游戏资源已变化，需重新分析：' + patch.path);
    grouped.set(patch.path, bytes.toString('utf8')); baseHashes[patch.path] = patch.sha256;
   }
   const text = grouped.get(patch.path);
   if (text.split(patch.find).length !== 2) throw new Error('资源替换并非唯一匹配：' + patch.path);
   grouped.set(patch.path, text.replace(patch.find, () => patch.replace));
  }
  for (const [name, text] of grouped) {
   // Arbitrary GD/GML/Python edits require their native compiler; data edits need no engine compilation.
   if (!/\.(?:json|ini|cfg|csv|xml)$/i.test(name)) validation.checks.push({ name, status: 'blocked', detail: '修改已生成；尚缺此游戏版本对应的原生脚本编译验证' });
   if (/\.json$/i.test(name)) JSON.parse(text);
   add(name, text);
  }
 }
 if (!outputs.length) validation.checks.push({ name: '可加载文件', status: 'blocked', detail: '未生成可部署的实际文件' });
 // Installation removes the previous revision first. Bind overlapping outputs to its restored base.
 for (const file of predecessor?.files || []) if (Object.hasOwn(baseHashes, file.destination)) {
  const bytes = await fs.readFile(await localFile(root, file.destination)).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  const current = bytes ? digest(bytes) : null, expected = predecessor.status === 'enabled' ? file.sha256 : file.originalHash;
  if (current !== expected) throw new Error('上一版本文件已被外部修改，停止更新：' + file.destination);
  baseHashes[file.destination] = file.originalHash;
 }
 return { ...validation, outputs, baseHashes, generatedCaches };
}
module.exports = { FAMILIES, familyFor, detectAdditionalEngine, collectEngineEvidence, readEvidence, searchEvidence, normalizeEngineDraft, validateEngineDraft, compileEngineProject, safePath, localFile, parseRegistry, inspectContainer, embeddedGodot };
