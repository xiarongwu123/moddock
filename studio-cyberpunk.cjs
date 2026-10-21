const parser = require('./vendor/luaparse/luaparse.cjs');
const CET = 'bin/x64/plugins/cyber_engine_tweaks';
const isCyberpunk = game => String(game.appId || '') === '1091500' || (!game.appId && /cyberpunk\s*2077|赛博朋克\s*2077/i.test(game.searchName || game.name || ''));
function checkCET(source) {
 if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > 64000) return { passed: false, detail: 'CET Lua 源码为空或超过 64000 字节' };
 try {
  parser.parse(source, { luaVersion: '5.1', comments: false, scope: true });
  return { passed: true, detail: 'CET Lua 5.1 语法解析通过；未执行脚本，游戏 API 和 LuaJIT 运行兼容性仍需实测。' };
 } catch (error) { return { passed: false, detail: 'CET Lua 5.1: ' + error.message }; }
}
const GUIDE = `Cyberpunk 2077 supports the cyberpunk-cet-lua recipe: actual single-file CET Lua gameplay mods.
Use Lua 5.1 / LuaJIT syntax; no goto, bitwise operators, //, <const>, table.pack or table.unpack. Use unpack.
The host packages mod/init.lua and deploys to bin/x64/plugins/cyber_engine_tweaks/mods/<UniqueID>/init.lua.
CET must match the installed game version; missing CET does not prevent authoring or export, but blocks installation.
Register callbacks with registerForEvent('onInit', function() ... end), registerForEvent('onUpdate', function(deltaTime) ... end), registerHotkey(id, description, function() ... end).
Game.GetPlayer() may be nil in menus; check before using it. Do not invoke gameplay APIs at file top level or assume onInit means a save is loaded. Read selected game references and verify actual game APIs before use. No invented methods or undeclared third-party libraries.
Use ModdockVerification.expect(id, description), begin(id) at the actual feature trigger, then check(id, actualGameState, expected[, tolerance]) after reading real game state. Use guard(id, callback) for callbacks, keeping its returned function. Never report callback registration or a constant as proof of gameplay behavior.
Host provides verification logging through spdlog.info with a unique per-Mod log. No filesystem/process/network operations. Do not replace the host verification API.
This route cannot produce new meshes, textures, voice, quest assets, .archive, REDmod, redscript or RED4ext binaries. Report concrete unsupported requirements rather than substitute another effect.
References: https://wiki.redmodding.org/scripting-cyberpunk/cyber-engine-tweaks/first-steps/mod-structure
https://wiki.redmodding.org/scripting-cyberpunk/cyber-engine-tweaks/cet-functions/misc/debug-functions
https://wiki.redmodding.org/cyber-engine-tweaks/patch-notes`;
const api = [
 ['registerForEvent', "registerForEvent('onInit', callback); registerForEvent('onUpdate', function(deltaTime) ... end). onUpdate runs each frame; throttle work and guard player availability.", 'https://wiki.redmodding.org/scripting-cyberpunk/cyber-engine-tweaks/first-steps/mod-structure'],
 ['Game.GetPlayer', 'Game.GetPlayer() returns the current player object; treat an absent player as unavailable and return before accessing it. player:GetWorldPosition() reads its position.', 'https://wiki.redmodding.org/cyber-engine-tweaks/console/console/how-do-i'],
 ['Game.AddToInventory', 'Game.AddToInventory("Items.money", quantity) adds currency; other item identifiers must be verified separately. Perform at an explicit user trigger, then read actual state to verify.', 'https://wiki.redmodding.org/cyber-engine-tweaks/console/console/how-do-i'],
 ['Game.SetLevel', 'Game.SetLevel("Level", level, 1) sets character level. Verify bounds and read back game state for the installed patch.', 'https://wiki.redmodding.org/cyber-engine-tweaks/console/console/how-do-i'],
 ['Game.GetQuestsSystem', 'Game.GetQuestsSystem():SetFactStr(factName, value) sets a quest fact. Only use explicitly requested verified fact identifiers; do not invent quest assets.', 'https://wiki.redmodding.org/cyber-engine-tweaks/console/console/how-do-i'],
 ['spdlog.info', 'spdlog.info(string) writes to the individual CET mod log at mods/<folder>/<folder>.log. The host uses it for the unique artifact marker and functional verification.', 'https://wiki.redmodding.org/scripting-cyberpunk/cyber-engine-tweaks/cet-functions/misc/debug-functions'],
];
function searchCET(query) {
 if (typeof query !== 'string' || !query.trim() || query.length > 100 || /[\r\n\0]/.test(query)) throw new Error('接口查询需为单行文本');
 const terms = query.toLowerCase().split(/[\s,]+/).filter(Boolean);
 const matches = api.map(([path, signature, source]) => ({ path, signature, source })).filter(entry => terms.some(term => (entry.path + ' ' + entry.signature).toLowerCase().includes(term)));
 return { source: 'CET official documentation', runtimeVerified: false, matches, note: '官方文档的有限静态接口索引，不是完整游戏 SDK。未命中接口时需报告缺少证据，不能编造接口或用初始化日志替代玩法验收。' };
}
module.exports = { CET, isCyberpunk, checkCET, GUIDE, searchCET };
