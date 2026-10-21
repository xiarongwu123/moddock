const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const parser = require('./vendor/luaparse/luaparse.cjs');
const { DOMParser } = require('@xmldom/xmldom');

const SPECS = {
 'minecraft-datapack': { game: 'Minecraft Java', ids: [], match: /^(?:minecraft(?: java(?: edition)?)?|我的世界(?:java版)?)(?:\s*\[TEST\])?$/i, minecraft: true, exportOnly: true, executables: ['java.exe', 'javaw.exe'], prefix: 'datapacks', docs: 'https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21', scope: 'Java 版命令函数、配方与 JSON 数据包；导出原生 ZIP 后由用户明确选择目标世界；不生成 Java 插件，不自动写入存档。' },
 'minecraft-resourcepack': { game: 'Minecraft Java', ids: [], match: /^(?:minecraft(?: java(?: edition)?)?|我的世界(?:java版)?)(?:\s*\[TEST\])?$/i, minecraft: true, executables: ['java.exe', 'javaw.exe'], prefix: 'resourcepacks', docs: 'https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21-4', scope: 'Java 版资源包：语言、模型 JSON、16×16 方块/物品 PNG 贴图；自动部署到已核对实例，游戏内启用；不生成 Forge/Fabric 插件或音频。' },
 'factorio-lua': { game: '异星工厂', ids: ['427520'], match: /factorio|异星工厂/i, lua: '5.2', entry: 'control.lua', executables: ['bin/x64/factorio.exe'], location: 'factorio', prefix: 'mods', log: 'factorio-current.log', printer: 'log', docs: 'https://lua-api.factorio.com/latest/auxiliary/mod-structure.html', scope: '仅运行时 control.lua 玩法脚本；不生成新模型或原型资产。' },
 'dst-lua': { game: '饥荒联机版', ids: ['322330'], match: /don.t starve together|饥荒联机/i, lua: '5.1', entry: 'modmain.lua', executables: ['bin64/dontstarve_steam_x64.exe', 'bin/dontstarve_steam.exe'], prefix: 'mods', docs: 'https://kleiforums.com/forums/forum/79-dont-starve-together-mods-and-tools/', scope: 'Lua 玩法/客户端脚本；明确 client 或 server 范围，在游戏内启用；不生成动画、模型或专用服务器配置。' },
 'noita-lua': { game: 'Noita', ids: ['881100'], match: /\bnoita\b/i, lua: '5.1', entry: 'init.lua', executables: ['noita.exe'], prefix: 'mods', docs: 'https://noita.wiki.gg/wiki/Modding:_Basics', scope: 'init.lua 回调脚本；不生成二进制资源，不解除 Lua 沙箱；在游戏内启用。' },
 'gmod-lua': { game: "Garry's Mod", ids: ['4000'], match: /garry.?s mod/i, lua: '5.1', entry: 'lua/autorun/__MODDOCK_ID__.lua', executables: ['gmod.exe', 'hl2.exe'], prefix: 'garrysmod/addons', docs: 'https://wiki.facepunch.com/gmod/Addon_Creation', scope: '客户端 Lua addon，使用标准 Lua 5.1 子集；不接受 GLua 的 !、!=、continue 等扩展，不制作 BSP/模型或服务器插件。' },
 'zomboid-lua': { game: '僵尸毁灭工程', ids: ['108600'], match: /project zomboid|僵尸毁灭工程/i, lua: '5.1', entry: 'media/lua/client/__MODDOCK_ID__.lua', executables: ['ProjectZomboid64.exe', 'ProjectZomboid32.exe'], location: 'zomboid', prefix: 'mods', log: 'console.txt', docs: 'https://pzwiki.net/wiki/Mod_structure', scope: '客户端 Kahlua / Lua 5.1 脚本，必须指定 41 或 42 构建系列；不生成 Java 插件或地图，不修改存档。' },
 'beamng-lua': { game: 'BeamNG.drive', ids: ['284160'], match: /beamng/i, lua: '5.1', entry: 'lua/ge/extensions/__MODDOCK_ID__.lua', executables: ['BeamNG.drive.exe'], location: 'beamng', prefix: 'mods/unpacked', log: 'beamng.log', docs: 'https://documentation.beamng.com/modding/programming/extensions/', scope: 'GE Lua 扩展及 modScript 加载入口；模块需 return M，回调挂在 M 上；不生成车辆模型、JBeam 或关卡。' },
 'ck3-data': { game: '王国风云 3', ids: ['1158310'], match: /crusader kings.*(?:iii|3)|王国风云.*3|十字军之王.*3/i, executables: ['binaries/ck3.exe'], location: 'ck3', prefix: 'mod', docs: 'https://ck3.paradoxwikis.com/Mod_structure', scope: '决议、事件、scripted_effects 和本地化文本包；只做结构语法检查，不冒充游戏脚本编译器；在启动器加入播放集。' },
 'barotrauma-content': { game: '潜渊症', ids: ['602960'], match: /barotrauma|潜渊症/i, executables: ['Barotrauma.exe'], prefix: 'LocalMods', docs: 'https://github.com/Regalis11/BaroModDoc/blob/main/docs/Intro/ContentPackages.md', scope: 'Item/Affliction XML 内容包与 filelist.xml；不生成 C#/Lua 插件、潜艇或美术资源；在游戏 Mod 菜单启用。' },
};
const LUA_KINDS = Object.keys(SPECS).filter(kind => SPECS[kind].lua);
const DATA_KINDS = Object.keys(SPECS).filter(kind => !SPECS[kind].lua);
const has = kind => Object.hasOwn(SPECS, kind || '');
const matches = (kind, game = {}) => has(kind) && (game.appId ? SPECS[kind].ids.includes(String(game.appId)) : SPECS[kind].match.test(game.searchName || game.name || ''));
const forGame = game => Object.keys(SPECS).find(kind => !SPECS[kind].exportOnly && matches(kind, game)) || Object.keys(SPECS).find(kind => matches(kind, game));
const idFor = id => 'moddock_' + id.replaceAll('-', '').toLowerCase();
const xmlEscape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
function checkLua(kind, code) {
 try { if (!LUA_KINDS.includes(kind) || typeof code !== 'string' || !code.trim() || Buffer.byteLength(code) > 64000) throw new Error('脚本为空、类型无效或超过 64000 字节'); parser.parse(code, { luaVersion: SPECS[kind].lua, comments: false }); return { passed: true, detail: `Lua ${SPECS[kind].lua} 语法解析通过；未执行脚本，游戏接口和玩法效果待运行验证。` }; }
 catch (error) { return { passed: false, detail: error.message }; }
}
function checkClausewitz(text) {
 const tokens = []; let i = 0;
 while (i < text.length) {
  if (/\s/.test(text[i])) { i++; continue; }
  if (text[i] === '#') { while (i < text.length && text[i] !== '\n') i++; continue; }
  const m = /^(?:"(?:[^"\\]|\\.)*"|[{}]|[!<>?]?=|[<>]|[^\s{}=#"<>!?]+)/.exec(text.slice(i));
  if (!m) throw new Error(`Clausewitz 字符或未闭合字符串位于 ${i}`);
  tokens.push(m[0]); i += m[0].length;
 }
 let cursor = 0;
 const operator = token => /^(?:[!<>?]?=|[<>])$/.test(token || '');
 const scalar = token => token && !operator(token) && token !== '{' && token !== '}';
 function block(top) {
  while (cursor < tokens.length) {
   if (tokens[cursor] === '}') { if (top) throw new Error('Clausewitz 多余右括号'); cursor++; return; }
   if (!scalar(tokens[cursor])) throw new Error('Clausewitz 定义缺少键或值');
   cursor++;
   if (!operator(tokens[cursor])) { if (top) throw new Error('Clausewitz 顶层定义缺少赋值'); continue; }
   cursor++;
   if (tokens[cursor] === '{') { cursor++; block(false); }
   else { if (!scalar(tokens[cursor])) throw new Error('Clausewitz 赋值缺少有效值'); cursor++; }
  }
  if (!top) throw new Error('Clausewitz 大括号未闭合');
 }
 if (!tokens.length) throw new Error('缺少 Clausewitz 定义'); block(true);
}
function checkXML(text) {
 if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('不允许 XML DTD 或实体声明');
 const errors = []; const doc = new DOMParser({ onError: (level, message) => errors.push(message) }).parseFromString(text, 'text/xml');
 if (errors.length || !doc?.documentElement) throw new Error(errors[0] || 'XML 根节点无效');
 return doc;
}
function dataSources(kind, files) {
 if (!DATA_KINDS.includes(kind) || !Array.isArray(files) || !files.length || files.length > 12) throw new Error('内容工程需为 1 至 12 个文件');
 let total = 0; const names = new Set();
 const sources = files.map(file => {
  const name = file?.name;
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_./-]{0,159}$/.test(name) || name.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)) || names.has(name.toLowerCase())) throw new Error('内容工程文件路径无效或重复');
  names.add(name.toLowerCase());
  if (typeof file.text !== 'string' || !file.text.trim() || file.text.includes('\0') || (total += Buffer.byteLength(file.text)) > 128 * 1024) throw new Error('内容文件为空或超过体积限制');
  if (kind === 'ck3-data') {
   if (/^(?:common\/(?:decisions|scripted_effects|scripted_triggers)|events)\/[a-zA-Z0-9_-]+\.txt$/.test(name)) checkClausewitz(file.text);
   else if (/^localization\/(?:english|simp_chinese)\/[a-zA-Z0-9_-]+_l_(?:english|simp_chinese)\.yml$/.test(name)) {
    const language = name.includes('/english/') ? 'english' : 'simp_chinese';
    if (!new RegExp('^\\s*l_' + language + ':\\s*$', 'm').test(file.text.replace(/^\uFEFF/, ''))) throw new Error('CK3 本地化语言头与目录不一致');
    for (const line of file.text.replace(/^\uFEFF/, '').split('\n').filter(line => line.trim() && !/^\s*(?:#|l_(?:english|simp_chinese):)/.test(line))) if (!/^\s+[^\s:]+:\d*\s+"(?:[^"\\]|\\.)*"\s*(?:#.*)?$/.test(line)) throw new Error('CK3 本地化行格式无效');
   } else throw new Error('CK3 此路线仅接受决议、事件、scripted_effects/triggers 和本地化');
  } else if (SPECS[kind].minecraft) {
   // The complete pack is checked below, including cross-file entry requirements.
  } else {
   if (!/^(?:Items|Afflictions)\/[a-zA-Z0-9_-]+\.xml$/.test(name)) throw new Error('潜渊症此路线仅接受 Items/Afflictions XML');
   const doc = checkXML(file.text), expected = name.startsWith('Items/') ? 'Items' : 'Afflictions';
   if (doc.documentElement.nodeName.toLowerCase() !== expected.toLowerCase()) throw new Error('XML 根节点与内容类型不一致');
  }
  return { name, text: file.text };
 });
 if (SPECS[kind].minecraft) require('./studio-minecraft.cjs').validateSources(kind, sources);
 return sources;
}
const version = value => { if (typeof value !== 'string' || !/^\d+\.\d+(?:\.\d+){0,2}$/.test(value)) throw new Error('需要已核对的目标游戏版本（如 2.0 或 1.14.2），不能使用通配版本'); return value; };
function build(input, id) {
 const kind = input.kind, spec = SPECS[kind], uid = idFor(id), files = [], draft = { kind, name: input.name, author: input.author, description: input.description || '使用游匣制作' };
 const add = (name, text) => files.push({ name: 'mod/' + name, data: Buffer.from(text) });
 const replace = text => text.replaceAll('__MODDOCK_ID__', uid);
 let runtime, content;
 if (spec.lua) {
  const checked = checkLua(kind, input.code); if (!checked.passed || input.code.length > 24000) throw new Error(checked.detail);
  draft.code = input.code;
  if (kind === 'factorio-lua') draft.targetVersion = version(input.targetVersion);
  if (kind === 'zomboid-lua') { if (!['41', '42'].includes(input.targetVersion)) throw new Error('僵尸毁灭工程必须指定已核对的 41 或 42 系列'); draft.targetVersion = input.targetVersion; }
  if (kind === 'dst-lua') { if (!['client', 'server'].includes(input.scope)) throw new Error('饥荒联机版需要 client 或 server 范围'); draft.scope = input.scope; }
  const verify = require('./studio-runtime-verification.cjs');
  runtime = { loader: spec.game, marker: `Moddock:${uid}:loaded`, verification: verify.contract(input.code), gameModRoot: true, log: spec.log || null };
  let printer = spec.printer || 'print', prelude = '';
  if (kind === 'gmod-lua') {
   prelude = `if SERVER then AddCSLuaFile() return end\nlocal function ModdockLog(s) file.Append(${JSON.stringify(uid + '.txt')},s..'\\n') end\n`;
   printer = 'ModdockLog'; runtime.log = `garrysmod/data/${uid}.txt`;
  }
  if (kind === 'beamng-lua') { prelude = `local function ModdockLog(s) log('I',${JSON.stringify(uid)},s) end\n`; printer = 'ModdockLog'; }
  const wrapped = prelude + verify.bootstrap(runtime.marker, replace(input.code), printer, kind === 'beamng-lua');
  const final = checkLua(kind, wrapped); if (!final.passed) throw new Error(final.detail);
  let entry = replace(spec.entry);
  if (kind === 'beamng-lua') entry = `lua/ge/extensions/${uid.replaceAll('_', '/')}.lua`;
  if (kind === 'zomboid-lua' && draft.targetVersion === '42') { entry = '42/' + entry; add('common/.moddock-placeholder.txt', 'Common directory required by Build 42.'); }
  add(entry, wrapped);
  if (kind === 'factorio-lua') add('info.json', JSON.stringify({ name: uid, version: '1.0.0', title: input.name, author: input.author, description: draft.description, factorio_version: draft.targetVersion.split('.').slice(0, 2).join('.'), dependencies: ['base >= ' + draft.targetVersion] }, null, 2));
  if (kind === 'dst-lua') add('modinfo.lua', `name=${JSON.stringify(input.name)}\ndescription=${JSON.stringify(draft.description)}\nauthor=${JSON.stringify(input.author)}\nversion="1.0.0"\napi_version=10\ndst_compatible=true\nclient_only_mod=${draft.scope === 'client'}\nall_clients_require_mod=${draft.scope === 'server'}\n`);
  if (kind === 'noita-lua') add('mod.xml', `<Mod name="${xmlEscape(input.name)}" description="${xmlEscape(draft.description)}" request_no_api_restrictions="0" />`);
  if (kind === 'zomboid-lua') add((draft.targetVersion === '42' ? '42/' : '') + 'mod.info', `name=${input.name.replace(/[\r\n]/g, ' ')}\nid=${uid}\ndescription=${draft.description.replace(/[\r\n]/g, ' ')}\n`);
  if (kind === 'beamng-lua') add(`scripts/${uid}/modScript.lua`, `extensions.load(${JSON.stringify(uid)})\n`);
  content = { language: 'Lua ' + spec.lua, loader: spec.game, code: wrapped };
 } else {
  draft.targetVersion = version(input.targetVersion); draft.files = dataSources(kind, input.files);
  if (spec.minecraft) {
   files.push(...require('./studio-minecraft.cjs').build(input, uid, draft.files));
  } else if (kind === 'ck3-data') {
   for (const file of draft.files) add(uid + '/' + path.posix.dirname(file.name) + '/' + uid + '_' + path.posix.basename(file.name), (file.name.endsWith('.yml') ? '\uFEFF' : '') + replace(file.text).replace(/^\uFEFF/, ''));
   const descriptor = `version="1.0.0"\nname=${JSON.stringify(input.name)}\nsupported_version=${JSON.stringify(draft.targetVersion)}\n`;
   add(uid + '/descriptor.mod', descriptor); add(uid + '.mod', descriptor + `path="mod/${uid}"\n`);
  } else {
   for (const file of draft.files) add(file.name, replace(file.text));
   add('filelist.xml', `<contentpackage name="${xmlEscape(input.name)}" modversion="1.0.0" gameversion="${draft.targetVersion}" corepackage="false">\n${draft.files.map(file => `  <${file.name.startsWith('Items/') ? 'Item' : 'Afflictions'} file="%ModDir%/${file.name}" />`).join('\n')}\n</contentpackage>`);
  }
  content = { language: spec.minecraft ? 'Minecraft JSON / mcfunction / PNG' : kind === 'ck3-data' ? 'Clausewitz' : 'XML', files: draft.files, runtimeVerified: false };
 }
 return { draft, manifest: { Name: input.name, Author: input.author, Version: '1.0.0', UniqueID: uid }, files, runtime, content, summary: `${spec.game} · ${spec.scope}`, adapterId: kind, output: spec.lua ? '原生脚本 Mod' : '游戏内容 Mod', installable: false };
}
function validateBuilt(kind, files) {
 const results = [];
 for (const file of files.filter(file => file.name.startsWith('mod/'))) {
  if (file.name.endsWith('.lua')) results.push({ path: file.name, ...checkLua(kind, file.text) });
  else { try { if (/\.(?:json|mcmeta)$/.test(file.name)) JSON.parse(file.text); if (file.name.endsWith('.mcfunction')) require('./studio-minecraft.cjs').command(file.text); if (file.name.endsWith('.png')) require('./content-pack.cjs').pngBytes(file.image); if (file.name.endsWith('.xml')) checkXML(file.text); if (file.name.endsWith('.mod')) checkClausewitz(file.text); results.push({ path: file.name, passed: true, detail: '宿主生成的清单/文本结构检查；游戏语义仍需实测' }); } catch (error) { results.push({ path: file.name, passed: false, detail: error.message }); } }
 }
 return results;
}
function exportPrefix(kind, uid) { return kind === 'factorio-lua' ? uid + '_1.0.0' : SPECS[kind]?.minecraft || ['beamng-lua', 'ck3-data'].includes(kind) ? '' : uid; }
function exportFiles(item, files) {
 const uid = item.manifest.UniqueID, kind = item.adapterId;
 const prefix = exportPrefix(kind, uid) ? exportPrefix(kind, uid) + '/' : '';
 return files.filter(file => file.name.startsWith('mod/')).map(file => ({ name: prefix + file.name.slice(4), data: file.image ? Buffer.from(file.image.split(',')[1], 'base64') : Buffer.from(file.text || '') }));
}
function targetCompatibility(item, workspace) {
 const kind = item.adapterId, docs = workspace.context?.engineEvidence?.documents || [];
 let actual;
 if (SPECS[kind]?.minecraft) {
  const versions = docs.filter(doc => /^versions\//.test(doc.path)).map(doc => JSON.parse(doc.text).id);
  return { status: versions.includes(item.draft.targetVersion) ? 'passed' : 'blocked', detail: versions.includes(item.draft.targetVersion) ? '目标 Java 版本清单和 JAR 容器匹配；尚未实机运行' : '未找到目标 Minecraft Java 版本的本机清单与 JAR，请选择已安装版本；不会猜测包格式。' };
 }
 if (kind === 'factorio-lua') {
  const doc = docs.find(doc => doc.path === 'data/base/info.json');
  if (doc) actual = JSON.parse(doc.text).version;
 } else if (kind === 'ck3-data') {
  const doc = docs.find(doc => doc.path === 'launcher-settings.json');
  if (doc) { const value = JSON.parse(doc.text); actual = [value.rawVersion, value.gameVersion, value.version].find(value => typeof value === 'string' && /^\d+\.\d+(?:\.\d+){0,2}$/.test(value)); }
 }
 if (!actual) return { status: 'pending', detail: '缺少可核对的本机语义版本证据；目标版本声明和游戏接口兼容性仍需验证。Steam buildId 不当作游戏语义版本。' };
 const requested = item.draft.targetVersion;
 const same = kind === 'factorio-lua' ? actual.split('.').slice(0, 2).join('.') === requested.split('.').slice(0, 2).join('.') && requested.split('.').every((n, i) => i < 2 || Number(n) <= Number(actual.split('.')[i] || 0)) : actual === requested;
 return { status: same ? 'passed' : 'blocked', detail: same ? '目标版本与本机版本证据匹配：' + actual : `目标版本 ${requested} 与本机 ${actual} 不匹配，请按已安装版本重新制作。` };
}
function rule(item) {
 return { mode: 'game-mod', modKind: item.adapterId, modId: item.manifest.UniqueID, sourcePrefix: 'mod' };
}
function destination(kind, uid) { return kind === 'ck3-data' ? 'mod' : `${SPECS[kind].prefix}/${uid}${kind === 'factorio-lua' ? '_1.0.0' : ''}`; }
function allowedDestination(p, name) {
 const base = destination(p.modKind, p.modId);
 return p.modKind === 'ck3-data' ? name === `mod/${p.modId}.mod` || name.startsWith(`mod/${p.modId}/`) : name.startsWith(base + '/');
}
async function ordinary(root, rel) {
 let current = await fs.realpath(root);
 for (const part of rel.split('/')) { current = path.join(current, part); const stat = await fs.lstat(current); if (stat.isSymbolicLink()) throw new Error('游戏证据路径包含链接'); }
 if (!(await fs.lstat(current)).isFile()) throw new Error('游戏入口不是普通文件');
 return current;
}
async function documents(options) {
 if (options.documentsPath) return options.documentsPath;
 if (process.platform === 'win32') { const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Environment]::GetFolderPath("MyDocuments")'], { windowsHide: true, timeout: 10000 }); if (stdout.trim()) return stdout.trim(); }
 return path.join(os.homedir(), 'Documents');
}
async function installRoot(game, p, options = {}) {
 if (!matches(p.modKind, game)) throw new Error('制作类型与游戏身份不符');
 const spec = SPECS[p.modKind], root = await fs.realpath(game.installPath);
 if (p.modGameRoot && p.modGameRoot !== root) throw new Error('游戏安装路径已变化，请重新制作安装方案');
 p.modGameRoot = root;
 if (spec.minecraft) {
  if (spec.exportOnly) throw new Error('数据包需要用户明确选择目标世界；当前请导出原生 ZIP，软件不会自动写入任何存档。');
  if (!(await require('./studio-minecraft.cjs').evidence(root)).length) throw new Error('未确认 Minecraft Java 实例的版本清单与 JAR');
  return root;
 }
 const found = [];
 for (const rel of spec.executables) {
  try {
   const file = await ordinary(root, rel), handle = await fs.open(file, 'r'), bytes = Buffer.alloc(4096);
   try { await handle.read(bytes, 0, bytes.length, 0); } finally { await handle.close(); }
   const pe = bytes.readUInt32LE(60);
   if (bytes.toString('ascii', 0, 2) !== 'MZ' || pe < 64 || pe + 4 > bytes.length || bytes.toString('ascii', pe, pe + 4) !== 'PE\0\0') throw new Error('原生游戏入口不是有效的 Windows PE 文件');
   found.push(rel);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
 }
 if (!found.length) throw new Error('未找到该游戏的已支持入口：' + spec.executables.join(' / '));
 if (!spec.location) return root;
 let configured = options.gameModRoots?.[p.modKind];
 if (!configured) {
  if (process.platform !== 'win32') throw new Error('此用户目录自动定位目前仅适配 Windows；可导出游戏 Mod 包');
  if (spec.location === 'factorio') {
   // Never silently deploy to the default when the game selects a portable/custom root.
   for (const rel of ['config-path.cfg', 'config/config.ini']) {
    try { const text = await fs.readFile(await ordinary(root, rel), 'utf8'); if (/^\s*(?:use-system-read-write-data-directories\s*=\s*false|write-data\s*=\s*(?!__PATH__system-write-data__)[^;\s])/mi.test(text)) throw new Error('检测到 Factorio 自定义数据目录，当前无法唯一确认 Mod 目标；已保留产物供导出。'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
   }
   if (!process.env.APPDATA) throw new Error('无法定位 Windows AppData'); configured = path.join(process.env.APPDATA, 'Factorio');
  } else if (spec.location === 'zomboid') configured = path.join(os.homedir(), 'Zomboid');
  else if (spec.location === 'beamng') {
   try { const text = await fs.readFile(await ordinary(root, 'startup.ini'), 'utf8'); if (/^\s*UserPath\s*=\s*\S+/mi.test(text)) throw new Error('BeamNG 自定义 UserPath 尚不能唯一核对，可先导出 Mod'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
   if (!process.env.LOCALAPPDATA) throw new Error('无法定位 Windows LocalAppData'); configured = path.join(process.env.LOCALAPPDATA, 'BeamNG/BeamNG.drive/current');
  } else configured = path.join(await documents(options), 'Paradox Interactive/Crusader Kings III');
 }
 let configuredStat;
 try { configuredStat = await fs.lstat(configured); } catch (error) { if (error.code === 'ENOENT') throw new Error('未找到已存在的游戏用户目录，请先运行游戏一次；当前产物仍可导出。'); throw error; }
 if (!path.isAbsolute(configured) || configuredStat.isSymbolicLink()) throw new Error('游戏用户目录无效或包含链接');
 const data = await fs.realpath(configured); if (!(await fs.stat(data)).isDirectory()) throw new Error('游戏用户目录不是文件夹');
 if (data === root || data.startsWith(root + path.sep)) throw new Error('用户 Mod 不能部署进游戏安装目录');
 return data;
}
function guide(kind) {
 const spec = SPECS[kind];
 if (spec.minecraft) return require('./studio-minecraft.cjs').GUIDE + '\n' + spec.scope;
 return `${spec.game} host recipe ${kind}. ${spec.scope}\n${spec.docs}\n${spec.lua ? `Write actual complete main.lua using Lua ${spec.lua} syntax; no table.pack/table.unpack or later-language operators. Host supplies the game entry, metadata and packaging. Use ModdockVerification.expect/begin/check with real game state and guard(id,callback) for callbacks; callback registration and constant values are not gameplay proof.\n${kind === 'factorio-lua' ? 'Use script events and game only at runtime; never access game in on_load or top-level. targetVersion must match installed base major.minor. No prototype/data-stage implementation in this recipe.' : ''}\n${kind === 'beamng-lua' ? 'Return your module table M. Host preserves the return value and adds scripts/<id>/modScript.lua to load the extension.' : ''}\n${kind === 'zomboid-lua' ? 'targetVersion must be exactly 41 or 42; do not infer from Steam buildId. GLOBAL events must use actual known Kahlua APIs.' : ''}\n${kind === 'dst-lua' ? 'scope must be client or server; server gameplay callbacks must guard GLOBAL.TheWorld.ismastersim. No automatic server configuration edits.' : ''}` : 'Write actual project files using write_project_file, then validate_project. Supply files and exact targetVersion in metadata. CK3 paths: common/decisions, common/scripted_effects, common/scripted_triggers, events, localization/english or localization/simp_chinese. Barotrauma paths: Items/*.xml or Afflictions/*.xml; host builds filelist.xml. These are structural checks, not a full game semantic compiler.'}\nUse __MODDOCK_ID__ token for unique identifiers and file references; host replaces it with the current artifact namespace. Use only verified game APIs and identifiers, inspect local evidence and read references. If version, API or assets are missing, report specific blockers; do not invent compatibility or substitute a document. No filesystem, process or network operations in generated Lua. Host installation and any in-game activation are separate from actual runtime acceptance.`;
}
function schema(kind) { return `kind="${kind}", name<=60, author<=60, description<=240, ${SPECS[kind].lua ? 'code: complete main.lua <=24000 chars' : 'files: 1..12 {name: allowed relative path,text: complete content}, <=128KB total, targetVersion: exact numeric game version'}, ${['factorio-lua','zomboid-lua'].includes(kind) ? 'targetVersion: required verified game version,' : ''}${kind === 'dst-lua' ? 'scope: "client" or "server",' : ''} ${guide(kind)}`; }
async function evidence(game, existing) {
 const kind = forGame(game); if (!kind) return existing;
 const root = await fs.realpath(game.installPath), docs = [...(existing?.documents || [])];
 if (SPECS[kind].minecraft) docs.push(...await require('./studio-minecraft.cjs').evidence(root));
 const paths = kind === 'factorio-lua' ? ['data/base/info.json', 'data/core/lualib/event_handler.lua'] : kind === 'ck3-data' ? ['launcher-settings.json'] : kind === 'barotrauma-content' ? ['Content/ContentPackages/Vanilla.xml'] : [];
 for (const rel of paths) { try { const file = await ordinary(root, rel), st = await fs.stat(file); if (st.size > 24000) continue; const bytes = await fs.readFile(file); docs.push({ path: rel, text: bytes.toString('utf8'), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), complete: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
 return { ...(existing || {}), family: 'native-game-mod', mode: kind, documents: docs, inventory: docs.map(doc => ({ path: doc.path, size: Buffer.byteLength(doc.text) })), gameModKind: kind, routes: [SPECS[kind].scope] };
}
module.exports = { SPECS, LUA_KINDS, DATA_KINDS, has, matches, forGame, idFor, checkLua, dataSources, checkClausewitz, checkXML, build, validateBuilt, exportPrefix, exportFiles, targetCompatibility, rule, destination, allowedDestination, installRoot, guide, schema, evidence };
