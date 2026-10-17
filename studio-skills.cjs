const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const root = __dirname;
const bundle = 'vendor/studio-skills/game-modding/_CANONICAL-SKILLS/';
const GAME_RULES = [
 ['bg3', ['1086940'], /baldur.?s?\s*gate\s*(?:3|iii)\b|博德之门\s*3/i, 'baldurs-gate3.md'],
 ['cyberpunk2077', ['1091500'], /cyberpunk\s*2077|赛博朋克\s*2077/i, 'cyberpunk2077.md'],
 ['witcher3', ['292030'], /witcher.*3|巫师.*3/i, 'witcher3-redkit.md'],
 ['divinity2', ['435150'], /divinity.*(?:sin.*2|ii)|神界.*2/i, 'divinity-original-sin2.md'],
 ['terraria', ['105600', '1281930'], /terraria|tmodloader|泰拉瑞亚/i, 'terraria-tmodloader.md'],
 ['factorio', ['427520'], /factorio|异星工厂/i, 'factorio.md'],
 ['zomboid', ['108600'], /project zomboid|僵尸毁灭工程/i, 'project-zomboid.md'],
 ['dst', ['322330'], /don.t starve together|饥荒联机/i, 'dont-starve-together.md'],
 ['noita', ['881100'], /noita/i, 'noita.md'],
 ['gmod', ['4000'], /garry.?s mod/i, 'garrys-mod.md'],
 ['slay-the-spire', ['646570'], /slay the spire|杀戮尖塔/i, 'slay-the-spire.md'],
 ['barotrauma', ['602960'], /barotrauma|潜渊症/i, 'barotrauma.md'],
 ['cities2', ['949230'], /cities.*(?:ii|2)|都市.*2/i, 'cities-skylines2.md'],
 ['beamng', ['284160'], /beamng/i, 'beamng.md'],
 ['arma3', ['107410'], /arma.*3|武装突袭.*3/i, 'arma3.md'],
 ['dayz', ['221100'], /dayz/i, 'dayz.md'],
 ['space-engineers', ['244850'], /space engineers|太空工程师/i, 'space-engineers.md'],
 ['bannerlord', ['261550'], /bannerlord|骑马与砍杀.*(?:ii|2)/i, 'bannerlord.md'],
 ['nms', ['275850'], /no man.s sky|无人深空/i, 'no-mans-sky.md'],
];
function selectSkills(game = {}, diagnostic = {}) {
 const name = game.searchName || game.name || '', appId = String(game.appId || ''), engine = diagnostic.engine?.key || 'unknown';
 const skills = [{ id: 'mod-any-game', name: '通用 Mod 制作', path: 'vendor/universal-modder/skills/mod-any-game/SKILL.md', reason: '通用制作流程' }];
 const add = (id, name, file, reason) => skills.push({ id, name, path: file, reason });
 const family = require('./studio-engines.cjs').familyFor(engine);
 if (family) add('engine-development', '按引擎开发 · ' + require('./studio-engines.cjs').FAMILIES[family], 'skills/engine-development/SKILL.md', '按实际引擎开放调查与开发，无游戏名单限制');
 if (['unity-mono', 'unity-il2cpp'].includes(engine)) {
  const il2cpp = /il2cpp/i.test(engine);
  add(il2cpp ? 'bepinex-il2cpp' : 'bepinex-mono', il2cpp ? 'BepInEx · IL2CPP' : 'BepInEx · Mono', `skills/bepinex-${il2cpp ? 'il2cpp' : 'mono'}/SKILL.md`, '检测到 ' + engine);
 }
 if (engine === 'unity') add('unity-mod-frameworks', 'Unity 引擎诊断', bundle + 'unity-mod-frameworks/SKILL.md', 'Unity 后端尚未确定，先核对 Mono / IL2CPP');
 if (engine === 'unreal') add('unreal-mod-frameworks', 'Unreal / UE4SS', bundle + 'unreal-mod-frameworks/SKILL.md', '检测到 Unreal');
 if (engine === 'creation') add('bethesda-creation-modding', 'Bethesda Creation', bundle + 'bethesda-creation-modding/SKILL.md', '检测到 Creation Engine');
 const readyOrNot = require('./studio-game-api.cjs').isReadyOrNot(game);
 if (readyOrNot) add('ready-or-not', '严阵以待专项', 'skills/ready-or-not/SKILL.md', '匹配严阵以待游戏身份');
 if (appId === '413150' || /stardew|星露谷/i.test(name)) add('stardew', '星露谷物语专项', 'skills/stardew/SKILL.md', '匹配 SMAPI / Content Patcher 游戏');
 if (/minecraft|我的世界/i.test(name)) add('minecraft-modding-workbench', 'Minecraft 专项', 'vendor/studio-skills/minecraft/skills/minecraft-modding-workbench/SKILL.md', '匹配 Minecraft');
 if (appId === '1295660' || /civilization.*(?:vii|7)|文明.*7/i.test(name)) add('civ7-modding', '文明 7 专项', 'vendor/studio-skills/civ7/SKILL.md', '匹配文明 7');
 if (appId === '1158310' || /crusader kings.*(?:iii|3)|王国风云.*3|十字军之王.*3/i.test(name)) add('ck3-modding-expert', '王国风云 3 专项', 'vendor/studio-skills/ck3/skills/ck3-modding-expert/SKILL.md', '匹配王国风云 3');
 const match = GAME_RULES.find(([, ids, pattern]) => appId ? ids.includes(appId) : pattern.test(name));
 const references = match ? [{ id: match[0], name: name || match[0], path: bundle + 'game-modding/references/' + match[3] }] : [];
 if (family) references.push({ id: 'engine-' + family, name: require('./studio-engines.cjs').FAMILIES[family] + ' 开发与加载', path: 'skills/engine-development/references/' + family + '.md' });
 if (readyOrNot) references.push({ id: 'ready-or-not', name: '严阵以待接口与制作流程', path: 'skills/ready-or-not/references/implementation.md' });
 if (readyOrNot) references.push({ id: 'ready-or-not-ue4ss', name: '严阵以待 Lua 加载接口', path: 'skills/ready-or-not/references/ue4ss-lua.md' });
 if (match) add('game-specialist', '游戏专项 · ' + (name || match[0]), 'skills/game-specialist/SKILL.md', '匹配游戏身份');
 const specialist = skills.at(-1);
 return { harness: 'pi-agent', agent: { id: match?.[0] || specialist.id, name: specialist.name + ' Agent' }, skills, references,
  dependencies: skills.some(skill => skill.id === 'minecraft-modding-workbench') ? [{ id: 'minecraft-modding-mcp', available: false, detail: '未配置 Minecraft MCP；使用技能自带的无 MCP 工作流，不宣称 MCP 可用。' }] : [] };
}
async function readSkillFile(relative, limit = 24000) {
 if (typeof relative !== 'string' || !/^(?:skills|vendor\/(?:studio-skills|universal-modder|bg3-api))\/[a-zA-Z0-9_./-]+\.(?:md|txt|json)$/i.test(relative) || relative.split('/').some(part => part === '..' || part === '.')) throw new Error('技能文档路径无效');
 const file = path.join(root, relative), real = await fs.realpath(file);
 if (real !== file || !(await fs.stat(file)).isFile()) throw new Error('技能文档不可用');
 const stat = await fs.stat(file); if (stat.size > 1024 * 1024) throw new Error('技能文档过大');
 return (await fs.readFile(file, 'utf8')).slice(0, limit);
}
async function verifySkillSources() {
 const directory = path.join(root, 'vendor/studio-skills');
 const manifest = JSON.parse(await fs.readFile(path.join(directory, 'UPSTREAM.json'), 'utf8'));
 let count = 0;
 for (const source of manifest.sources) for (const [name, expected] of Object.entries(source.hashes)) {
  if (!/^[a-z0-9-]+$/.test(source.id) || path.isAbsolute(name) || name.split('/').some(part => part === '..') || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('技能来源清单无效');
  const file = path.join(directory, source.id, name), stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('技能来源文件无效');
  if (crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex') !== expected) throw new Error('技能来源哈希不匹配：' + name);
  count++;
 }
 return count;
}
module.exports = { selectSkills, readSkillFile, verifySkillSources, GAME_RULES };
