const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { target, relative, extract, hash } = require('./installers.cjs');
const { diagnoseGame, isStardew, smallJson } = require('./game-diagnostics.cjs');
const { isBG3 } = require('./bg3-mod.cjs');
const { download } = require('./bg3-extender.cjs');
const { components, reGames } = require('./game-components.cjs');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function existing(file) { try { const st = await fs.lstat(file); if (!st.isFile() || st.isSymbolicLink()) throw new Error('组件文件路径冲突'); return hash(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function machine(file) {
 const h = await fs.open(file, 'r'), bytes = Buffer.alloc(4096);
 try { await h.read(bytes, 0, bytes.length, 0); } finally { await h.close(); }
 if (bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('没有找到有效的 Windows 游戏启动文件');
 const offset = bytes.readUInt32LE(60);
 if (offset < 64 || offset + 26 > bytes.length || bytes.toString('ascii', offset, offset + 4) !== 'PE\0\0') throw new Error('游戏启动文件 PE 结构无效');
 const arch = bytes.readUInt16LE(offset + 4); if (![0x8664, 0x14c].includes(arch)) throw new Error('当前组件仅支持 Windows x64/x86 游戏');
 return arch === 0x8664 ? 'x64' : 'x86';
}
class GameEnvironment {
 constructor(root, installers, bg3, options = {}) {
  this.root = path.join(root, 'game-components'); this.installers = installers; this.bg3 = bg3; this.options = options; this.queues = new Map();
 }
 async describe(game) {
  const report = await diagnoseGame(game), root = await fs.realpath(game.installPath);
  let profile = null;
  if (isStardew(game)) profile = { id: 'smapi', name: 'SMAPI + Content Patcher', executable: 'Stardew Valley.exe', base: '', existing: report.loaders.includes('SMAPI') && report.loaders.includes('Content Patcher') };
  else if (report.engine.key === 'unity-mono') {
   const managed = report.managedDirectories;
   const candidates = [...new Set(managed.map(dir => dir.replace(/_Data\/Managed$/i, '.exe')))];
   if (candidates.length === 1) profile = { id: 'bepinex', name: 'BepInEx 5 · Unity Mono', executable: candidates[0], base: path.posix.dirname(candidates[0]) === '.' ? '' : path.posix.dirname(candidates[0]), existing: report.loaderFiles.BepInEx.length === 1 };
  } else if (report.engine.key === 'unreal' || report.loaders.includes('UE4SS')) {
   const wukong = String(game.appId) === '2358720' || /^(?:black myth:?\s*wukong|黑神话[：:]?悟空)(?:\s*\[TEST\])?$/i.test(game.searchName || game.name || '');
   if (report.loaderFiles.UE4SS.length === 1 || wukong) profile = { id: 'ue4ss', name: 'UE4SS', executable: wukong ? 'b1/Binaries/Win64/b1-Win64-Shipping.exe' : null, base: 'b1/Binaries/Win64', existing: report.loaderFiles.UE4SS.length === 1, custom: wukong ? 'Wukong' : null };
  } else if (report.engine.key === 're-engine' || report.loaders.includes('REFramework') || reGames[String(game.appId)]) {
   const entry = reGames[String(game.appId)];
   if (entry || report.loaderFiles.REFramework.length === 1) profile = { id: 'reframework', name: 'REFramework', executable: entry?.[1], base: '', existing: report.loaderFiles.REFramework.length === 1 && !!await existing(await target(root, 'dinput8.dll')) };
  }
  return { report, root, profile };
 }
 async status(game) {
  if (isBG3(game)) return { ...(await this.bg3.status(game)), adapter: 'bg3', name: 'BG3 Script Extender', coverage: 'adapter', canPrepare: true };
  const { report, profile } = await this.describe(game);
  const supported = (this.options.platform || process.platform) === 'win32';
  const base = { applicable: true, supported, adapter: profile?.id || null, name: profile?.name || report.engine.name, engine: report.engine,
   runtimeConfirmed: false, coverage: profile ? 'adapter' : 'source-only', canPrepare: !!profile && supported };
  if (report.antiCheat.length || report.onlineOnly) return { ...base, ready: false, canPrepare: false, status: 'source-only', message: '当前游戏检测到联网保护，仅开放分析和源码方案；没有已核对的自动部署路线。' };
  if (profile?.existing) return { ...base, ready: true, status: 'ready', message: `已检测到 ${profile.name}，可按对应路线制作；文件检测不代表游戏内效果已验证。` };
  if (!profile) return { ...base, ready: false, status: 'source-only', message: '可分析此游戏并生成方案；专用制作或加载器适配尚未接通。不会套用其他游戏的文件。' };
  return { ...base, ready: false, status: supported ? 'missing' : 'unsupported', message: supported ? `将自动准备 ${profile.name}；无需填写路径或下载地址。` : `${profile.name} 自动安装当前面向 Windows；已有本机环境仍可用于制作。` };
 }
 ensure(context) {
  if (isBG3(context.game)) return this.bg3.ensure(context);
  const key = path.resolve(context.game.installPath), old = this.queues.get(key) || Promise.resolve();
  const pending = old.catch(() => {}).then(() => this.prepare(context)); this.queues.set(key, pending);
  return pending.finally(() => { if (this.queues.get(key) === pending) this.queues.delete(key); });
 }
 async permission(context) {
  if (!context.current?.() || context.signal?.aborted || !context.authorize) throw new Error('操作已停止或账号已切换');
  await context.authorize('library.manage');
  if (!context.current() || context.signal?.aborted) throw new Error('操作已停止或账号已切换');
 }
 async asset(id, stage, signal) {
  const item = (this.options.components || components)[id]; if (!item) throw new Error('没有已核对的官方组件');
  const cacheRoot = path.join(this.root, 'cache'); await fs.mkdir(cacheRoot, { recursive: true });
  const file = path.join(cacheRoot, item.sha256 + '.zip');
  if (await existing(file) !== item.sha256) {
   const bytes = await download(this.options.fetch || fetch, item, signal);
   if (bytes.length !== item.size || digest(bytes) !== item.sha256) throw new Error('官方组件 SHA-256 校验失败');
   const tmp = file + '.' + crypto.randomUUID() + '.tmp';
   try { await fs.writeFile(tmp, bytes, { flag: 'wx' }); await fs.rename(tmp, file); } finally { await fs.rm(tmp, { force: true }); }
  }
  const directory = path.join(stage, id); const files = await extract(file, directory);
  return { directory, files, item };
 }
 async recover(root, journal, guard) {
  let pending; try { pending = await smallJson(journal); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (pending.root !== root || !Array.isArray(pending.files) || pending.files.length > 1000) throw new Error('组件安装恢复记录无效');
  await guard();
  for (const entry of pending.files) {
   if (typeof entry.marker !== 'string' || !entry.marker.startsWith(entry.name + '.moddock-') || !entry.marker.endsWith('.tmp')) throw new Error('组件恢复标记无效');
   const marker = await target(root, relative(entry.marker));
   const file = await target(root, relative(entry.name)), actual = await existing(file);
   let markerStat; try { markerStat = await fs.lstat(marker); } catch (e) { if (e.code !== 'ENOENT') throw e; }
   if (markerStat?.isSymbolicLink()) throw new Error('组件恢复标记包含链接');
   if (actual && markerStat && !pending.committed) {
    const stat = await fs.lstat(file);
    if (stat.ino === markerStat.ino && stat.dev === markerStat.dev) {
     if (actual !== entry.sha256) throw new Error('组件安装中断后文件被外部修改，已保留该文件');
     await fs.rm(file);
    }
   }
   await fs.rm(marker, { force: true });
  }
  await fs.rm(journal);
 }
 async prepare(context) {
  await this.permission(context);
  const location = await this.describe(context.game), { root, profile } = location;
  const guard = () => this.installers.guard(root, { mode: 'copy', executable: profile?.executable || context.game.executable });
  const recordDir = path.join(this.root, digest(Buffer.from(root))), journal = path.join(recordDir, 'pending.json');
  await fs.mkdir(recordDir, { recursive: true }); await this.recover(root, journal, guard);
  const before = await this.status(context.game);
  if (before.ready || !before.canPrepare) return before;
  if (!profile?.executable) return before;
  await guard();
  const arch = await machine(await target(root, profile.executable));
  if (['ue4ss', 'reframework', 'smapi'].includes(profile.id) && arch !== 'x64') throw new Error('当前专用组件需要 x64 游戏');
  const stage = await fs.mkdtemp(path.join(recordDir, 'stage-')), files = [];
  const signal = context.signal ? AbortSignal.any([context.signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000);
  const add = (name, source) => files.push({ name: relative(name), source });
  try {
   if (profile.id === 'bepinex') {
    const asset = await this.asset('bepinex-' + arch, stage, signal);
    for (const file of asset.files.filter(file => /^BepInEx\/core\//.test(file.source) || ['winhttp.dll', 'doorstop_config.ini', '.doorstop_version'].includes(file.source))) add(path.posix.join(profile.base, file.source), path.join(asset.directory, file.source));
   } else if (profile.id === 'reframework') {
    const asset = await this.asset('reframework', stage, signal), file = asset.files.find(file => file.source === 'dinput8.dll');
    if (!file) throw new Error('官方 REFramework 包缺少 dinput8.dll'); add('dinput8.dll', path.join(asset.directory, file.source));
   } else if (profile.id === 'ue4ss') {
    if (!profile.custom) return before;
    const asset = await this.asset('ue4ss', stage, signal), config = await this.asset('ue4ss-configs', stage, signal);
    for (const name of ['dwmapi.dll', 'ue4ss/UE4SS.dll']) { if (!asset.files.some(file => file.source === name)) throw new Error('官方 UE4SS 包结构不匹配'); add(path.posix.join(profile.base, name), path.join(asset.directory, name)); }
    for (const name of ['UE4SS-settings.ini', 'VTableLayout.ini']) {
     const source = profile.custom + '/' + name; if (!config.files.some(file => file.source === source)) throw new Error('缺少此游戏的官方 UE4SS 配置');
     add(path.posix.join(profile.base, 'ue4ss', name), path.join(config.directory, source));
    }
   } else if (profile.id === 'smapi' && !location.report.loaders.includes('SMAPI')) {
    const asset = await this.asset('smapi', stage, signal), nested = asset.files.filter(file => /\/internal\/windows\/install\.dat$/.test(file.source));
    if (nested.length !== 1) throw new Error('官方 SMAPI 包结构不匹配');
    const directory = path.join(stage, 'smapi-payload'), payload = await extract(path.join(asset.directory, nested[0].source), directory);
    for (const file of payload.filter(file => !file.source.startsWith('Mods/'))) add(file.source, path.join(directory, file.source));
    const deps = await target(root, 'Stardew Valley.deps.json'); await smallJson(deps);
    add('StardewModdingAPI.deps.json', deps);
   }
   const planned = [], seen = new Set();
   for (const file of files) {
    if (seen.has(file.name.toLowerCase())) throw new Error('组件包存在重复目标文件'); seen.add(file.name.toLowerCase());
    const actual = await existing(await target(root, file.name)), sha256 = await hash(file.source);
    if (actual && actual !== sha256) throw new Error('现有文件与官方组件冲突，已保留：' + file.name);
    if (!actual) planned.push({ ...file, sha256, marker: file.name + '.moddock-' + crypto.randomUUID() + '.tmp' });
   }
   await this.permission(context); signal.throwIfAborted(); await guard();
   if (await fs.realpath(context.game.installPath) !== root) throw new Error('游戏安装路径已变化');
   const record = { root, files: planned.map(({ name, sha256, marker }) => ({ name, sha256, marker })) };
   await fs.writeFile(journal, JSON.stringify(record), { flag: 'wx' });
   try {
    for (const file of planned) {
     await this.permission(context); signal.throwIfAborted(); await guard();
     const destination = await target(root, file.name); await fs.mkdir(path.dirname(destination), { recursive: true });
     const tmp = await target(root, file.marker);
     await fs.copyFile(file.source, tmp, fs.constants.COPYFILE_EXCL); await fs.link(tmp, destination);
     await this.options.afterWrite?.(file.name, destination);
    }
    const directories = profile.id === 'bepinex' ? [path.posix.join(profile.base, 'BepInEx/plugins')] : profile.id === 'reframework' ? ['reframework/autorun'] : profile.id === 'ue4ss' ? [path.posix.join(profile.base, 'ue4ss/Mods')] : ['Mods'];
    for (const name of directories) await fs.mkdir(await target(root, name), { recursive: true });
    for (const file of planned) if (await existing(await target(root, file.name)) !== file.sha256) throw new Error('组件安装后校验失败');
    const committed = journal + '.tmp'; await fs.writeFile(committed, JSON.stringify({ ...record, committed: true })); await fs.rename(committed, journal);
    await this.recover(root, journal, guard);
   } catch (error) { await this.recover(root, journal, guard); throw error; }
   if (profile.id === 'smapi' && !location.report.loaders.includes('Content Patcher')) {
    if (!this.options.contentPatcher) throw new Error('SMAPI 已自动准备，Content Patcher 官方下载通道暂不可用，请稍后重试');
    await this.permission(context); await this.options.contentPatcher(context);
   }
   return { ...(await this.status(context.game)), installed: true };
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
 }
}
module.exports = { GameEnvironment, machine };
