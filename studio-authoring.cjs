const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { checkLua } = require('./studio-lua.cjs');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const gameMods = require('./studio-game-mods.cjs');
const luaKinds = new Set(['ue4ss-lua', 'reframework-lua', 'bg3-lua', 'cyberpunk-cet-lua', ...gameMods.LUA_KINDS]);
async function createAuthoringWorkspace({ kind, signal, directory = os.tmpdir(), evidence, checkpoint, previousDraft } = {}) {
 const root = await fs.mkdtemp(path.join(directory, 'moddock-authoring-'));
 const files = new Map(); let validated;
 const check = () => signal?.throwIfAborted();
 const fingerprint = () => sha256(JSON.stringify([...files.values()]));
 const engineDraft = async () => {
  if (!files.has('mod.json')) throw new Error('请先写入 mod.json，声明实际加载方式、资源修改和阻塞项');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'mod.json'), 'utf8'));
  const sources = [];
  for (const name of files.keys()) if (name !== 'mod.json') sources.push({ name, text: await fs.readFile(path.join(root, name), 'utf8') });
  return require('./studio-engines.cjs').normalizeEngineDraft({ ...manifest, files: sources });
 };
 const relative = name => {
  if (typeof name !== 'string' || name.length > 160 || !/^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$/.test(name)
   || name.split('/').some(part => !part || ['.', '..'].includes(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('工程路径必须是工作区内的普通相对路径');
  return name;
 };
 const workspace = {
  async write(name, text) {
   check(); name = relative(name);
   if (luaKinds.has(kind) && name !== 'main.lua') throw new Error('当前脚本适配使用单一 main.lua 入口，请将实现完整写入此文件');
   if (typeof text !== 'string' || !text.trim() || text.includes('\0') || Buffer.byteLength(text) > 64000) throw new Error('工程文件需为 1 至 64000 字节文本');
   if (!files.has(name) && files.size >= 12) throw new Error('工程最多包含 12 个文件');
   const bytes = Buffer.byteLength(text), total = [...files].reduce((sum, [file, info]) => sum + (file === name ? 0 : info.bytes), bytes);
   if (total > 128 * 1024) throw new Error('工程总大小超过限制');
   const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true });
   await fs.writeFile(file, text, { mode: 0o600 }); check();
   const info = { path: name, bytes, sha256: sha256(text) }; files.set(name, info); validated = undefined;
   await checkpoint?.({ name, text, sha256: info.sha256 }); check();
   return info;
  },
  async read(name) {
   check(); name = relative(name); if (!files.has(name)) throw new Error('工程文件不存在');
   return { ...files.get(name), text: await fs.readFile(path.join(root, name), 'utf8') };
  },
  list() { check(); return [...files.values()]; },
  async validate() {
   check();
   if (kind === 'engine-mod') {
    const result = require('./studio-engines.cjs').validateEngineDraft(await engineDraft(), evidence);
    validated = { ...result, fingerprint: fingerprint() }; return validated;
   }
   if (gameMods.DATA_KINDS.includes(kind)) {
    try {
     const sources = await Promise.all([...files.keys()].map(async name => ({ name, text: await fs.readFile(path.join(root, name), 'utf8') })));
     gameMods.dataSources(kind, sources); validated = { passed: true, fingerprint: fingerprint(), runtimeVerified: false }; return validated;
    } catch (error) { validated = { passed: false, detail: error.message, fingerprint: fingerprint() }; return validated; }
   }
   if (!luaKinds.has(kind)) throw new Error('当前工程没有服务端编译器；客户端会执行对应的专用构建');
   if (!files.has('main.lua')) throw new Error('请先写入完整的 main.lua 入口');
   const results = [];
   for (const [name, info] of files) {
    check();
    const text = await fs.readFile(path.join(root, name), 'utf8');
    if (name.endsWith('.lua')) results.push({ path: name, sha256: info.sha256, ...(gameMods.has(kind) ? gameMods.checkLua(kind, text) : kind === 'cyberpunk-cet-lua' ? require('./studio-cyberpunk.cjs').checkCET(text) : await checkLua(text)) });
    else if (name.endsWith('.json')) { try { JSON.parse(text); results.push({ path: name, passed: true }); } catch (error) { results.push({ path: name, passed: false, detail: error.message }); } }
   }
   check(); validated = { passed: results.length > 0 && results.every(result => result.passed), results, runtimeVerified: false };
   return validated;
  },
  async artifact(result) {
   check();
   if (gameMods.DATA_KINDS.includes(kind)) {
    if (!validated?.passed || validated.fingerprint !== fingerprint()) throw new Error('必须先写入完整内容文件并通过 validate_project；修改后重新校验');
    const sources = await Promise.all([...files.keys()].map(async name => ({ name, text: await fs.readFile(path.join(root, name), 'utf8') })));
    if (result.files !== undefined && JSON.stringify(result.files) !== JSON.stringify(sources)) throw new Error('提交内容与已验证工程不一致');
    return { ...result, files: sources };
   }
   if (kind === 'engine-mod') {
    if (!validated?.passed || validated.fingerprint !== fingerprint()) throw new Error('必须先写入实际工程并通过 validate_project；修改后需重新检查');
    const draft = await engineDraft();
    for (const key of ['mode', 'files', 'patches', 'blockers', 'targets']) if (result[key] !== undefined && JSON.stringify(result[key]) !== JSON.stringify(draft[key])) throw new Error('提交内容与已验证工程不一致：' + key);
    return { ...result, ...draft };
   }
   if (!luaKinds.has(kind)) return result;
   const entry = files.get('main.lua');
   if (!entry || !validated?.passed || validated.results.find(file => file.path === 'main.lua')?.sha256 !== entry.sha256) throw new Error('必须先写入实际 main.lua 并通过 validate_project；修改后需重新编译');
   const code = await fs.readFile(path.join(root, 'main.lua'), 'utf8');
   if (result.code !== undefined && result.code !== code) throw new Error('提交代码与已编译工程不一致，请提交当前 main.lua');
   return { ...result, code };
  },
  async close() { await fs.rm(root, { recursive: true, force: true }); },
 };
 try {
  if (previousDraft?.kind === kind) {
   if (gameMods.DATA_KINDS.includes(kind)) for (const file of previousDraft.files || []) await workspace.write(file.name, file.text);
   if (luaKinds.has(kind) && previousDraft.code) await workspace.write('main.lua', previousDraft.code);
   if (kind === 'engine-mod') {
    const { mode, patches, blockers, targets, files } = require('./studio-engines.cjs').normalizeEngineDraft(previousDraft);
    await workspace.write('mod.json', JSON.stringify({ mode, patches, blockers, targets }));
    for (const file of files) await workspace.write(file.name, file.text);
   }
  }
  return workspace;
 } catch (error) { await workspace.close(); throw error; }
}
module.exports = { createAuthoringWorkspace, luaKinds, dataKinds: new Set(gameMods.DATA_KINDS) };
