const fs = require('node:fs/promises');
const path = require('node:path');
const { isBG3 } = require('./bg3-mod.cjs');

// Selected fingerprints adapted from universal-modder 23902ef (MIT); see THIRD-PARTY-NOTICES.md.
const LIMIT = 12000;
const isStardew = game => String(game.appId) === '413150' || /^(stardew valley|星露谷物语)$/i.test(game.name || '');
async function smallJson(file) {
 const stat = await fs.lstat(file);
 if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) throw new Error('清单无法读取或超过大小限制');
 return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
}
async function diagnoseGame(game) {
 const root = await fs.realpath(game.installPath), files = new Map(), directories = new Map(), warnings = [];
 let truncated = false, visited = 0;
 async function walk(dir, prefix = '', depth = 0) {
  const directory = await fs.opendir(dir);
  for await (const entry of directory) {
   if (++visited > LIMIT) { truncated = true; break; }
   const relative = prefix + entry.name;
   if (entry.isSymbolicLink()) continue;
   if (entry.isDirectory()) directories.set(relative.toLowerCase(), relative);
   if (entry.isFile()) files.set(relative.toLowerCase(), relative);
   else if (entry.isDirectory() && depth < 5 && !['.git', 'node_modules', 'shadercache'].includes(entry.name.toLowerCase())) {
    try { await walk(path.join(dir, entry.name), relative + '/', depth + 1); }
    catch (error) { if (error.code !== 'EACCES' && error.code !== 'EPERM') throw error; warnings.push('部分子目录无读取权限'); }
   }
   if (truncated) break;
  }
 }
 await walk(root);
 const names = [...files.keys()];
 const find = pattern => names.filter(name => pattern.test(name));
 let engine = { key: 'unknown', name: '尚未识别', confidence: '未知', evidence: [] };
 const set = (key, name, evidence) => { engine = { key, name, confidence: '文件特征匹配', evidence: evidence.map(file => files.get(file)) }; };
 const unity = find(/(^|\/)unityplayer\.(dll|so|dylib)$/), managed = find(/(?:_data|(?:^|\/)data)\/managed\/assembly-csharp\.dll$/);
 const il2cpp = find(/(^|\/)(gameassembly\.dll|libil2cpp\.so|global-metadata\.dat)$/), pak = find(/(^|\/)content\/paks\/.*\.(pak|utoc)$/);
 if (unity.length) set(il2cpp.length ? 'unity-il2cpp' : managed.length ? 'unity-mono' : 'unity', il2cpp.length ? 'Unity · IL2CPP' : managed.length ? 'Unity · Mono' : 'Unity', [...unity, ...il2cpp, ...managed].slice(0, 4));
 else if (pak.length) set('unreal', 'Unreal Engine', pak.slice(0, 3));
 else if (require('./studio-engines.cjs').detectAdditionalEngine(files)) engine = require('./studio-engines.cjs').detectAdditionalEngine(files);
 else if (find(/\.deps\.json$/).length) set('dotnet', '.NET / XNA / MonoGame', find(/\.deps\.json$/).slice(0, 3));
 else if (find(/(^|\/)data\/(skyrim|fallout4)\.esm$/).length) set('bethesda', 'Bethesda Creation Engine', find(/\.esm$/).slice(0, 2));
 if (engine.key === 'unknown') engine = await require('./studio-engines.cjs').embeddedGodot(root, files) || engine;
 if (isBG3(game)) set('larian-bg3', 'Larian · Baldur’s Gate 3', find(/(^|\/)(bg3(?:_dx11)?\.exe|gustav(?:dev)?\.pak)$/).slice(0, 3));
 if (find(/(^|\/)re_chunk_\d+\.pak$/).length || require('./game-components.cjs').reGames[String(game.appId)]) set('re-engine', 'Capcom · RE Engine', find(/re_chunk_\d+\.pak$/).slice(0, 3));
 const antiCheat = [
  ['EasyAntiCheat', /easyanticheat|start_protected_game\.exe$/], ['BattlEye', /battleye|beservice/],
  ['Tencent ACE', /ace-base|sgguard|\/ace\/.*\.sys$/], ['Ricochet', /randgrid\.sys$/], ['GameGuard', /gameguard|gamemon.*\.des$/],
 ].filter(([, pattern]) => find(pattern).length).map(([name]) => name);
 const loaders = [
  ['BepInEx', /(^|\/)bepinex\/core\/.*\.dll$/], ['MelonLoader', /(^|\/)melonloader\/.*\.dll$/],
  ['UE4SS', /(^|\/)ue4ss\.dll$/], ['SMAPI', /(^|\/)(stardewmoddingapi|stardewmodapi)\.(dll|exe)$/],
 ].filter(([, pattern]) => find(pattern).length).map(([name]) => name);
 const manifests = [];
 for (const file of find(/(^|\/)mods\/.*\/manifest\.json$/).slice(0, 100)) {
  try { const item = await smallJson(path.join(root, files.get(file))); manifests.push({ id: item.UniqueID, version: item.Version }); } catch { warnings.push('有 Mod 清单无法读取'); }
 }
 const cp = manifests.find(item => item.id === 'Pathoschild.ContentPatcher');
 if (cp) loaders.push('Content Patcher');
 if (antiCheat.length) warnings.push('检测到反作弊文件；请先核对游戏官方允许的离线 Mod 方式。');
 warnings.push('未检出反作弊不表示不存在保护；文件识别结果不等于 Mod 兼容或游戏内生效。');
 if (truncated) warnings.push('目录较大，本次达到 12000 项扫描上限，结果可能不完整。');
 const stardew = isStardew(game);
 const loaderFiles = { UE4SS: find(/(^|\/)ue4ss\.dll$/).map(file => files.get(file)), BepInEx: find(/(^|\/)bepinex\/core\/bepinex(?:\.core)?\.dll$/).map(file => files.get(file)) };
 const reDirectories = [...directories].filter(([name]) => /(^|\/)reframework\/autorun$/.test(name));
 if (reDirectories.length && !loaders.includes('REFramework')) loaders.push('REFramework');
 loaderFiles.REFramework = reDirectories.map(([, name]) => name);
 loaderFiles.BG3SE = isBG3(game) ? find(/(^|\/)bin\/dwrite\.dll$/).map(file => files.get(file)) : [];
 if (loaderFiles.BG3SE.length) loaders.push('BG3 Script Extender');
 const requirements = stardew ? [
  { name: 'SMAPI', ready: loaders.includes('SMAPI'), detail: loaders.includes('SMAPI') ? '检测到启动器文件，运行状态仍需确认' : '未检测到，安装内容包前需安装 SMAPI' },
  { name: 'Content Patcher', ready: !!cp, detail: cp ? `清单版本 ${cp.version || '未声明'}` : '未检测到清单，安装内容包前需安装 Content Patcher' },
 ] : isBG3(game) ? [{ name: 'BG3 Script Extender', ready: loaderFiles.BG3SE.length === 1, detail: loaderFiles.BG3SE.length === 1 ? '检测到 bin/DWrite.dll；实际版本和加载需在游戏中验证' : '脚本 Mod 需要 Norbyte BG3 Script Extender（Windows）' }] : [];
 return { gameId: game.id, checkedAt: new Date().toISOString(), engine, loaders, loaderFiles, antiCheat, requirements,
  managedDirectories: [...new Set(managed.map(file => path.posix.dirname(files.get(file))))],
  il2cppMetadata: find(/(?:^|\/)[^/]+_data\/il2cpp_data\/metadata\/global-metadata\.dat$/).map(file => files.get(file)),
  shippingExecutables: find(/(^|\/)binaries\/win64\/[^/]+-win64-shipping\.exe$/).map(file => files.get(file)).slice(0, 10),
  filesIndexed: files.size, truncated, warnings: [...new Set(warnings)], stardew,
  route: isBG3(game) ? 'BG3 Script Extender Lua → Lua 5.4 校验 → LSPK v18 → 用户 Mods 与 Public 加载顺序；需要 Windows Script Extender。' : stardew ? '使用 SMAPI + Content Patcher 内容包，支持对话与武器贴图模板。' : engine.key.startsWith('unity') ? '先核对游戏支持的 BepInEx / MelonLoader 版本与运行时，再选择插件。' : engine.key === 'unreal' ? '先核对该游戏的 PAK / IoStore 或 UE4SS 加载方式。' : '使用游戏官方工具或已核对的专用加载器；暂不自动选择开发路线。',
 };
}
 module.exports = { diagnoseGame, isStardew, smallJson };
