const path = require('node:path');
const { buildContentPack } = require('./content-pack.cjs');
const { isStardew } = require('./game-diagnostics.cjs');
const { isBG3, buildBG3 } = require('./bg3-mod.cjs');
const { validateControls } = require('./bg3-controls.cjs');

const definitions = [
 { id: 'project-plan', name: '开发方案', category: '通用', description: '结合引擎指南与社区经验，整理任意游戏的 Mod 创作计划。', output: '方案工程', installable: false },
 { id: 'custom-project', name: '自定义 Mod 工程', category: '通用', description: '自由组织脚本、代码和配置文件，适用于更多游戏与创作方向。', output: '源码工程', installable: false },
 { id: 'engine-mod', name: '按引擎开发 Mod', category: '通用引擎', description: '根据本机代码和资源调查、编写实现、构建并校验；无需命中特定游戏名单。', output: '引擎 Mod 工程', installable: false },
 { id: 'ue4ss-lua', name: 'UE4SS Lua 脚本', category: 'Unreal', description: '编写玩法与交互脚本，打包后交给已有 UE4SS 加载。', output: '脚本 Mod', installable: true },
 { id: 'reframework-lua', name: 'REFramework Lua 脚本', category: 'RE Engine', description: '制作 REFramework autorun 脚本，适用于已安装该框架的游戏。', output: '脚本 Mod', installable: true },
 { id: 'bepinex-plugin', name: 'BepInEx 插件工程', category: 'Unity Mono', description: '生成 C# 插件工程，使用本机游戏程序集自动编译与校验。', output: '插件工程', installable: false },
 { id: 'bg3-lua', name: '博德之门 3 脚本 Mod', category: '博德之门 3', description: '生成 Script Extender Lua，编译检查并打包为 LSPK v18，自动部署与管理加载顺序。', output: 'BG3 PAK Mod', installable: false },
 { id: 'bg3-follower', name: '博德之门 3 人物跟随者', category: '博德之门 3', description: 'AI 设计姓名与台词，宿主生成原版资源跟随者逻辑并打包 PAK；不含新模型或完整同伴剧情。', output: 'BG3 人物 PAK Mod', installable: false },
 { id: 'dialogue', name: 'Content Patcher 对话', category: '星露谷', description: '为原版角色编写日常对话，生成内容包。', output: '内容包', installable: true },
 { id: 'texture', name: 'Content Patcher 贴图', category: '星露谷', description: '为生锈的剑替换 16 × 16 像素贴图。', output: '内容包', installable: true },
];
function recipesFor(game, report) {
 const protectedGame = !!report.onlineOnly || report.antiCheat.length > 0;
 return definitions.map(type => {
  let available = false, reason = '';
  if (['project-plan', 'custom-project'].includes(type.id)) available = true;
  else if (type.id === 'engine-mod') { available = !!require('./studio-engines.cjs').familyFor(report.engine.key); reason = '需识别 Unity、Unreal、Godot、RPG Maker、Ren\'Py 或 GameMaker 引擎。'; }
  else if (['dialogue','texture'].includes(type.id)) { available = isStardew(game); reason = '需要星露谷物语的 Content Patcher 适配。'; }
  else if (type.id === 'bepinex-plugin') { available = report.engine.key === 'unity-mono'; reason = '仅支持已识别的 Unity Mono；IL2CPP 需要不同工程。'; }
  else if (['bg3-lua', 'bg3-follower'].includes(type.id)) { available = isBG3(game); reason = '仅支持博德之门 3 的 Script Extender 脚本包。'; }
  else if (type.id === 'ue4ss-lua') { available = report.engine.key === 'unreal'; reason = '需要 Unreal Engine；安装时需检测到唯一 UE4SS.dll。'; }
  else if (type.id === 'reframework-lua') { available = report.engine.key === 're-engine' || report.loaders.includes('REFramework'); reason = '需要 RE Engine 或已检测到 REFramework autorun 目录。'; }
  if (protectedGame && (type.installable || ['bg3-lua', 'bg3-follower'].includes(type.id))) { available = false; reason = '当前游戏存在反作弊或联网专用特征，暂不开放安装适配。'; }
  return { ...type, available, reason: available ? '' : reason };
 });
}
function requiredText(value, label, limit) { if (typeof value !== 'string' || !value.trim() || value.length > limit || value.includes('\0')) throw new Error(`${label}需为 1 至 ${limit} 字`); return value.trim(); }
function buildStudioProject(game, input, id, report, context) {
 if (!input || typeof input !== 'object') throw new Error('创作草稿无效');
 const recipe = recipesFor(game, report).find(type => type.id === input.kind);
 if (!recipe?.available) throw new Error(recipe?.reason || '此创作类型尚未适配');
 if (['dialogue','texture'].includes(input.kind)) return { ...buildContentPack(input, id), adapterId: input.kind, output: '内容包', installable: true };
 const name = requiredText(input.name, '项目名称', 60), author = requiredText(input.author, '作者', 60);
 const description = requiredText(input.description || '使用游匣 AI Mod 创作工作台制作', '介绍', 240), uniqueId = 'Moddock' + id.replaceAll('-', '');
 const draft = { kind: input.kind, name, author, description };
 const manifest = { Name: name, Author: author, Version: '1.0.0', UniqueID: uniqueId };
 let files = [], content, summary, runtime;
 const textFile = (name, text) => ({ name, data: Buffer.from(text) });
 if (['bg3-lua', 'bg3-follower'].includes(input.kind)) {
  if (input.kind === 'bg3-follower') {
   draft.followerName = requiredText(input.followerName, '人物姓名', 40); draft.greeting = requiredText(input.greeting, '人物台词', 300);
   if ([draft.followerName, draft.greeting].some(value => !value.isWellFormed() || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))) throw new Error('人物文本包含无效字符');
  }
  else {
   draft.code = requiredText(input.code, 'BG3 Lua 脚本', 24000);
   if (input.controls !== undefined) draft.controls = validateControls(input.controls);
  }
  const built = buildBG3(draft, id, textFile);
  Object.assign(manifest, built.manifest); ({ content, runtime } = built); files.push(...built.files);
  summary = `${game.name} · Script Extender 脚本与 PAK 工程`;
 } else if (input.kind === 'engine-mod') {
  const engine = require('./studio-engines.cjs');
  Object.assign(draft, engine.normalizeEngineDraft(input));
  engine.validateEngineDraft(draft, context.engineEvidence);
  for (const file of draft.files) files.push(textFile('src/' + file.name, file.text));
  files.push(textFile('mod.json', JSON.stringify({ mode: draft.mode, patches: draft.patches, blockers: draft.blockers, targets: draft.targets }, null, 2)));
  content = { engine: report.engine.name, mode: draft.mode, status: 'awaiting-build' };
  if (draft.mode === 'unity-il2cpp') runtime = { loader: 'BepInEx', marker: 'MODDOCK_LOADED:' + uniqueId };
  summary = `${game.name} · ${report.engine.name} · 实际开发工程`;
 } else if (input.kind === 'project-plan') {
  draft.plan = requiredText(input.plan, '开发方案', 24000);
  content = { game: game.name, engine: report.engine.name, type: recipe.name, plan: draft.plan };
  summary = `${game.name} · 开发方案`;
  files.push(textFile('MODDING_PLAN.md', `# ${name}\n\nGame: ${game.name}\nEngine: ${report.engine.name}\nAuthor: ${author}\n\n${draft.plan}\n`));
 } else if (input.kind === 'custom-project') {
  if (!Array.isArray(input.files) || !input.files.length || input.files.length > 12) throw new Error('自定义工程需包含 1 至 12 个文本文件');
  const seen = new Set(); let total = 0;
  draft.files = input.files.map(file => {
   const name = requiredText(file?.name, '工程文件路径', 120);
   if (!/^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) || seen.has(name.toLowerCase())) throw new Error('文件路径无效或重复，请使用工程内的相对路径');
   const text = requiredText(file.text, '文件内容', 24000); total += Buffer.byteLength(text);
   if (total > 64 * 1024) throw new Error('工程文本总大小需小于 64 KB');
   seen.add(name.toLowerCase()); files.push(textFile('src/' + name, text + '\n'));
   return { name, text };
  });
  content = { status: 'source-only', files: draft.files };
  summary = `${game.name} · 自定义工程 · ${draft.files.length} 个文件`;
 } else if (input.kind === 'ue4ss-lua' || input.kind === 'reframework-lua') {
  draft.code = requiredText(input.code, 'Lua 脚本', 24000);
  runtime = { loader: input.kind === 'ue4ss-lua' ? 'UE4SS' : 'REFramework', marker: `Moddock:${uniqueId}:loaded` };
  const verifier = require('./studio-runtime-verification.cjs');
  runtime.verification = verifier.contract(draft.code);
  const wrapped = verifier.bootstrap(runtime.marker, draft.code, input.kind === 'ue4ss-lua' ? 'print' : 'log.info');
  content = { language: 'Lua', loader: runtime.loader, code: wrapped };
  summary = `${game.name} · ${content.loader} 脚本`;
  if (input.kind === 'ue4ss-lua') files.push(textFile('mod/Scripts/main.lua', wrapped), textFile('mod/enabled.txt', ''));
  else files.push(textFile(`mod/${uniqueId}.lua`, wrapped));
 } else if (input.kind === 'bepinex-plugin') {
  const fps = Number(input.targetFps);
  if (!input.code && (!Number.isInteger(fps) || fps < 15 || fps > 240)) throw new Error('目标帧率需为 15 至 240 的整数');
  if (input.code) draft.code = requiredText(input.code, 'C# 源码', 24000); else draft.targetFps = fps;
  if (input.entryPoint && input.entryPoint !== 'Moddock.Generated.ModContent.Initialize') throw new Error('C# 初始化入口不受支持');
  if (input.entryPoint) draft.entryPoint = input.entryPoint;
  const code = `using BepInEx;\nusing BepInEx.Configuration;\nusing UnityEngine;\n\n[BepInPlugin("${uniqueId.toLowerCase()}", "Moddock Frame Target", "1.0.0")]\npublic sealed class FrameTargetPlugin : BaseUnityPlugin\n{\n    private ConfigEntry<int> targetFps;\n    private void Awake()\n    {\n        targetFps = Config.Bind("Display", "TargetFps", ${fps}, "Target frame rate; the game may override it.");\n        Application.targetFrameRate = targetFps.Value;\n        Logger.LogInfo("Frame target requested: " + targetFps.Value);\n    }\n}\n`;
  const project = `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>netstandard2.0</TargetFramework>\n    <AssemblyName>${uniqueId}</AssemblyName>\n  </PropertyGroup>\n  <ItemGroup>\n    <Reference Include="BepInEx"><HintPath>$(GamePath)/BepInEx/core/BepInEx.dll</HintPath><Private>false</Private></Reference>\n    <Reference Include="UnityEngine"><HintPath>$(ManagedPath)/UnityEngine.dll</HintPath><Private>false</Private></Reference>\n    <Reference Include="UnityEngine.CoreModule" Condition="Exists('$(ManagedPath)/UnityEngine.CoreModule.dll')"><HintPath>$(ManagedPath)/UnityEngine.CoreModule.dll</HintPath><Private>false</Private></Reference>\n  </ItemGroup>\n  <Target Name="CheckGameReferences" BeforeTargets="ResolveReferences">\n    <Error Condition="!Exists('$(GamePath)/BepInEx/core/BepInEx.dll')" Text="Set GamePath to your BepInEx 5 game folder." />\n    <Error Condition="!Exists('$(ManagedPath)/UnityEngine.dll')" Text="Set ManagedPath to this game's Managed folder." />\n  </Target>\n</Project>\n`;
  let pluginCode = draft.code || code, bootstrapCode;
  if (draft.entryPoint || !draft.code) {
   runtime = { loader: 'BepInEx', marker: `Moddock:${uniqueId}:loaded` };
   if (draft.entryPoint) bootstrapCode = `using BepInEx;\n[BepInPlugin("${uniqueId.toLowerCase()}", ${JSON.stringify(name)}, "1.0.0")]\npublic sealed class ModdockBootstrap : BaseUnityPlugin\n{\n private void Awake()\n {\n  Moddock.Generated.ModContent.Initialize();\n  Logger.LogInfo(${JSON.stringify(runtime.marker)});\n }\n}\n`;
   else pluginCode = pluginCode.replace('Logger.LogInfo("Frame target requested:', `Logger.LogInfo(${JSON.stringify(runtime.marker)});\n        Logger.LogInfo("Frame target requested:`);
  }
  files.push(textFile('src/Plugin.cs', pluginCode), textFile('src/ModdockPlugin.csproj', project));
  if (bootstrapCode) files.push(textFile('src/ModdockBootstrap.cs', bootstrapCode));
  content = { language: 'C#', ...(draft.code ? {} : { targetFps: fps }), code: pluginCode, bootstrapCode, status: 'source-only' };
  summary = `${game.name} · BepInEx 工程${draft.code ? '' : ` · ${fps} FPS 目标`}`;
 }
 const projectInfo = { ...manifest, gameId: game.id, game: game.name, engine: report.engine.key, adapter: recipe.id, output: recipe.output, upstream: context.toolkit.commit };
 files.push(textFile('project.json', JSON.stringify(projectInfo, null, 2)));
 files.push(textFile('REFERENCES.md', `# Development references\n\nUpstream: ${context.toolkit.repository}\nCommit: ${context.toolkit.commit}\nGuide: ${context.guide.path}\n\n${context.notes.map(note => `- ${note.title} (${note.status})`).join('\n')}\n\nCommunity reports are evidence to review, not compatibility guarantees.\n`));
 const instructions = input.kind === 'bepinex-plugin' ? 'Source project only. Install the .NET SDK and BepInEx 5 for this exact Unity Mono game.\nBuild src/ModdockPlugin.csproj with GamePath and ManagedPath pointing to your own local references.\nReview the compiled DLL before deploying it to BepInEx/plugins. Game references are not redistributed.\nA target frame rate does not override VSync or guarantee a performance increase.\n' : input.kind === 'engine-mod' ? 'Actual engine Mod implementation. The desktop host prepares matching tools, builds and verifies the installable Mod, and installs it with backups.\nUse the compiled ZIP for installation; this source archive contains the build inputs. Game files and locally generated game interfaces are not redistributed.\nCompilation and packaging do not establish in-game behavior; check the actual game after installation.\n' : input.kind === 'project-plan' ? 'Planning document only. No game files are installed.\n' : input.kind === 'custom-project' ? 'Source project only. Review the source, choose the game-specific toolchain, build and validate before deploying.\nNo files from this project are installed or executed by Moddock.\n' : 'Review every Lua statement before installing. Moddock does not execute the script itself.\nRequires an existing compatible loader. Verify loading and behavior in the actual game.\n';
 files.push(textFile('README.md', `${name}\n${description}\nAuthor: ${author}\n\n${instructions}`));
 return { draft, manifest, content, runtime, summary, files, adapterId: recipe.id, output: recipe.output, installable: recipe.installable };
}
function projectRule(item, report) {
 if (!item.installable) throw new Error('这份产物是开发方案或待编译工程，请导出；尚无可安装的 Mod 文件。');
 if (report.antiCheat.length || report.onlineOnly) throw new Error('当前游戏只开放开发方案，不能部署脚本。');
 if (item.adapterId === 'engine-mod' && item.compiled && item.toolchain?.deployment) return { mode: item.toolchain.deployment.nativeManifestSha256 ? 'native' : 'copy', sourcePrefix: item.toolchain.deployment.nativeManifestSha256 ? '' : 'deploy', destination: '', requires: [], ...item.toolchain.deployment };
 if (['bg3-lua', 'bg3-follower'].includes(item.adapterId) && item.compiled) return { mode: 'bg3', sourcePrefix: 'Mods', destination: 'Mods', requires: [], bg3Module: item.bg3Module };
 if (item.adapterId === 'ue4ss-lua') {
  const entries = report.loaderFiles.UE4SS;
  if (entries.length !== 1) throw new Error('未检测到唯一 UE4SS.dll，请先正确安装适合此游戏版本的 UE4SS，再重新诊断。');
  const base = path.posix.dirname(entries[0]);
  return { mode: 'copy', sourcePrefix: 'mod', destination: path.posix.join(base === '.' ? '' : base, 'Mods', item.manifest.UniqueID), requires: [entries[0]] };
 }
 if (item.adapterId === 'reframework-lua') {
  const entries = report.loaderFiles.REFramework;
  if (entries.length !== 1) throw new Error('未检测到唯一 REFramework autorun 目录，请先安装并运行适合此游戏的框架。');
  return { mode: 'copy', sourcePrefix: 'mod', destination: entries[0], requires: [] };
 }
 if (item.adapterId === 'bepinex-plugin' && item.compiled) {
  const entries = report.loaderFiles.BepInEx || [];
  if (entries.length !== 1 || report.engine.key !== 'unity-mono') throw new Error('未检测到唯一 BepInEx Mono 环境');
  return { mode: 'copy', sourcePrefix: 'plugins', destination: path.posix.join(path.posix.dirname(path.posix.dirname(entries[0])), 'plugins', item.manifest.UniqueID), requires: [entries[0]] };
 }
 throw new Error('此创作类型需要专用安装适配');
}
module.exports = { recipesFor, buildStudioProject, projectRule };
