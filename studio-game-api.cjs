const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const docs = 'https://docs.ue4ss.com/dev/lua-api/';
const framework = [
 ['RegisterHook', 'RegisterHook("/Script/Module.Class:Function", preCallback, postCallback?) -> preId, postId. Native /Script/ second callback runs BEFORE original; Context and arguments are RemoteUnrealParam.', 'global-functions/registerhook.html'],
 ['UnregisterHook', 'UnregisterHook(fullUFunctionPath, preId, postId) removes the registered callbacks. Pass the path and both IDs in one call, never a single ID.', 'global-functions/unregisterhook.html'],
 ['RemoteUnrealParam', 'param:get() reads and param:set(value) replaces a parameter before original execution.', 'classes/remoteunrealparam.html'],
 ['StaticFindObject', 'StaticFindObject(fullObjectPath) -> UObject. Find classes, UFunctions and class defaults by path; test IsValid().', 'global-functions/staticfindobject.html'],
 ['FindFirstOf', 'FindFirstOf(shortClassName) finds a non-default instance, not a UClass or class default object.', 'global-functions/findfirstof.html'],
 ['UObject.IsA', 'object:IsA(UClass) or object:IsA(fullClassPath) -> bool; use /Script/ReadyOrNot.SuspectCharacter for suspects.', 'classes/uobject.html'],
 ['UObject.GetWorld', 'object:GetWorld() -> UWorld; compare a valid captured world with the current world before delayed operations.', 'classes/uobject.html'],
 ['UObject.GetClass', 'object:GetClass() -> UClass; object:GetFullName() -> string; object:GetAddress() -> integer identity, not a memory-patching interface.', 'classes/uobject.html'],
 ['RemoteObject.IsValid', 'object:IsValid() -> bool; call inside pcall before accessing a retained UObject.', 'classes/remoteobject.html'],
 ['ExecuteWithDelay', 'ExecuteWithDelay(milliseconds, callback) runs asynchronously on the UE4SS thread. Do not access UObjects in this callback; call ExecuteInGameThread(body) from it.', 'global-functions/executewithdelay.html'],
 ['ExecuteInGameThread', 'ExecuteInGameThread(callback) marshals UObject operations to the game thread. Feature-detect the installed dispatcher; keep engine reads and writes inside its body.', 'global-functions/executeingamethread.html'],
 ['ExecuteInGameThreadWithDelay', 'ExecuteInGameThreadWithDelay(milliseconds, callback) schedules on the game thread when this API exists in the installed loader; feature-detect it. Reacquire targets and verify the current world in the callback.', 'global-functions/delayedactions.html'],
 ['LoopInGameThreadWithDelay', 'LoopInGameThreadWithDelay(milliseconds, callback) runs recurring work on the game thread when supported; retain the handle and cancel when no longer needed.', 'global-functions/delayedactions.html'],
 ['NotifyOnNewObject', 'NotifyOnNewObject(fullClassPath, callback) observes newly constructed instances including subclasses; returning true unregisters this notification.', 'global-functions/notifyonnewobject.html'],
].map(([name, signature, page]) => ({ path: 'UE4SS.' + name, signature, source: docs + page, runtimeVerified: false }));
framework.push({ path: 'UE4SS.UEHelpers.GetKismetSystemLibrary', signature: 'local UEHelpers = require("UEHelpers"); local ksl = UEHelpers.GetKismetSystemLibrary(); ksl:IsStandalone(world) checks the selected world. This helper uses the KismetSystemLibrary class default object.', source: 'https://github.com/UE4SS-RE/RE-UE4SS/blob/1ba38db4/assets/Mods/shared/UEHelpers/UEHelpers.lua', runtimeVerified: false });

async function verify() {
 const directory = path.join(__dirname, 'vendor/ready-or-not-api');
 const manifest = JSON.parse(await fs.readFile(path.join(directory, 'UPSTREAM.json'), 'utf8'));
 for (const name of ['api.json', 'LICENSE']) {
  const bytes = await fs.readFile(path.join(directory, name));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== manifest.hashes[name]) throw new Error('游戏接口索引完整性检查失败');
 }
 return manifest;
}

const isReadyOrNot = game => game?.appId ? String(game.appId) === '1144200' : /^(?:ready\s*or\s*not|严阵以待)(?:\s*\[TEST\])?$/i.test(game?.searchName || game?.name || '');
async function search(game, query, evidence) {
 if (require('./studio-cyberpunk.cjs').isCyberpunk(game || {})) return require('./studio-cyberpunk.cjs').searchCET(query);
 if (typeof query !== 'string' || query.length > 100 || !query.trim() || /[\r\n\0]/.test(query)) throw new Error('接口查询需为单行文本');
 const kind = require('./studio-game-mods.cjs').forGame(game || {});
 if (require('./studio-game-mods.cjs').SPECS[kind]?.bethesda) {
  const snapshot = evidence?.documents?.find(doc => doc.path === 'moddock-bethesda-records.json');
  const terms = require('./studio-native-evidence.cjs').termsFor(query);
  const result = snapshot ? JSON.parse(snapshot.text) : await require('./studio-bethesda.cjs').evidence(game, kind, query);
  if (snapshot) result.records = result.records.filter(record => terms.some(term => (record.editorId + ' ' + record.signature).toLowerCase().includes(term)));
  return { source: result.master, matches: result.records.map(record => ({ path: record.signature + ':' + record.editorId, signature: JSON.stringify(record) })), runtimeVerified: false, note: result.blocked || '本机主文件中的真实设置；数值修改与游戏效果需实测。' };
 }
 if (isReadyOrNot(game)) await verify();
 const index = isReadyOrNot(game) ? JSON.parse(await fs.readFile(path.join(__dirname, 'vendor/ready-or-not-api/api.json'), 'utf8')) : { entries: [], source: docs };
 const terms = query.toLowerCase().split(/[\s,]+/).filter(Boolean);
 const matches = [...index.entries, ...framework.filter(entry => isReadyOrNot(game) || !entry.signature.includes('ReadyOrNot'))].map(entry => {
  const method = entry.path.split(/[.:]/).at(-1).toLowerCase(), haystack = (entry.path + ' ' + entry.signature).toLowerCase();
  return { ...entry, score: terms.reduce((score, term) => score + (method === term ? 8 : haystack.includes(term) ? 1 : 0), 0) };
 })
  .filter(entry => entry.score).sort((a, b) => b.score - a.score).slice(0, 18).map(({ score, ...entry }) => entry);
 return { source: index.source, runtimeVerified: false, matches, note: '公开 SDK 的静态接口证据；当前游戏构建中的名称与触发顺序需实测。' };
}
module.exports = { search, isReadyOrNot, verify };
