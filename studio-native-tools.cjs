const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createReadStream } = require('node:fs');
const { extract } = require('./installers.cjs');
const { runTool } = require('./studio-tools.cjs');
const nativeSource = name => path.join(__dirname.replace(/app\.asar$/, 'app.asar.unpacked'), 'vendor/native-toolchains', name);

const artifact = (repo, tag, name, size, sha256, executable) => ({ url: `https://github.com/${repo}/releases/download/${tag}/${name}`, name, size, sha256, executable, source: `https://github.com/${repo}/tree/${tag}` });
const DISTRIBUTIONS = {
 gdre: {
  'win32-x64': artifact('GDRETools/gdsdecomp', 'v2.7.4', 'GDRE_tools-v2.7.4-windows.zip', 42626001, 'af24c563eee501effb194d83595de64696c32547b2246034dbfb891a24bfa0ad', 'gdre_tools.exe'),
  'darwin-arm64': artifact('GDRETools/gdsdecomp', 'v2.7.4', 'GDRE_tools-v2.7.4-macos.zip', 71380501, 'a148b9509c2826fcc238e81c21005bf3128bdcee1a87c3f79ad943a205aa2170', 'Godot RE Tools.app/Contents/MacOS/Godot RE Tools'),
  'linux-x64': artifact('GDRETools/gdsdecomp', 'v2.7.4', 'GDRE_tools-v2.7.4-linux.zip', 35295754, '3dc4f1244dda62e41e0c952ac00a69e60e07f3b0d5a211164806bf9d41a54758', 'gdre_tools.x86_64'),
 },
 umt: {
  'win32-x64': artifact('UnderminersTeam/UndertaleModTool', '0.9.2.0', 'UTMT_CLI_v0.9.2.0-Windows.zip', 62585935, 'e7573e45d107be34f81f955c6e4afc3c7c8f2628e5a6f307a871e3825b3dfb40', 'UndertaleModCli.exe'),
  'darwin-arm64': artifact('UnderminersTeam/UndertaleModTool', '0.9.2.0', 'UTMT_CLI_v0.9.2.0-macOS.zip', 60849980, '03042fa77f93e9b7fcb06592b77fb8369876e6d6fff7680a63dc0fa2df5444ef', 'UndertaleModCli'),
  'darwin-x64': artifact('UnderminersTeam/UndertaleModTool', '0.9.2.0', 'UTMT_CLI_v0.9.2.0-macOS-x86.zip', 68347542, '8c210151736d828a6fa47bcf86e1365c20d1f2d587a0341274490e6026c09ee6', 'UndertaleModCli'),
  'linux-x64': artifact('UnderminersTeam/UndertaleModTool', '0.9.2.0', 'UTMT_CLI_v0.9.2.0-Ubuntu.zip', 67610661, 'd182f00c0e5ced8d9252aa1f796374cfee077a3889a658e70b68685f9cd559c7', 'UndertaleModCli'),
 },
};
DISTRIBUTIONS.gdre['darwin-x64'] = DISTRIBUTIONS.gdre['darwin-arm64'];
const il2cpp = { ...require('./game-components.cjs').components['bepinex-il2cpp-x64'], name: 'bepinex-il2cpp-788.zip', executable: 'BepInEx/core/BepInEx.Core.dll', source: 'https://github.com/BepInEx/BepInEx/tree/5b766a3' };
DISTRIBUTIONS.il2cpp = Object.fromEntries(['win32-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64'].map(key => [key, il2cpp]));
const hash = async (file, algorithm = 'sha256') => { const h = crypto.createHash(algorithm); for await (const bytes of createReadStream(file)) h.update(bytes); return h.digest('hex'); };
class NativeTools {
 constructor(options = {}) { this.options = options; this.root = path.resolve(options.directory || process.env.MODDOCK_TOOLCHAIN_DIR || path.join(__dirname, '.moddock-tools'), 'native'); this.pending = new Map(); }
 async ensure(name, context = {}) {
  const key = `${process.platform}-${process.arch}`, spec = DISTRIBUTIONS[name]?.[key];
  if (!spec) throw new Error('当前系统没有此原生编译工具：' + name);
  if (this.pending.has(name)) return this.pending.get(name);
  const work = this.prepare(name, spec, context); this.pending.set(name, work);
  try { return await work; } finally { this.pending.delete(name); }
 }
 async prepare(name, spec, { signal, current = () => true, authorize, onEvent = async () => {} }) {
  const check = () => { signal?.throwIfAborted(); if (!current()) throw new Error('工具准备已取消'); };
  const expected = spec.sha256 || spec.sha512, algorithm = spec.sha256 ? 'sha256' : 'sha512';
  const directory = path.join(this.root, name + '-' + expected.slice(0, 16));
  const verify = async () => {
   const receipt = JSON.parse(await fs.readFile(path.join(directory, 'receipt.json'), 'utf8'));
   if ((receipt.archiveHash || receipt.sha256) !== expected || !Array.isArray(receipt.files) || !receipt.files.length) throw new Error('工具校验记录无效');
   for (const file of receipt.files) { const local = await require('./studio-engines.cjs').localFile(directory, file.source); if (await hash(local) !== file.sha256) throw new Error('工具文件已变化'); }
   check(); return path.join(directory, spec.executable);
  };
  try { return await verify(); } catch (error) { if (error.code !== 'ENOENT') throw new Error('原生编译工具完整性检查失败：' + error.message); }
  check(); if (authorize) await authorize('library.manage'); check();
  const callId = crypto.randomUUID(), started = Date.now(), label = name === 'gdre' || name.startsWith('godot-') ? 'Godot 编译工具' : name === 'il2cpp' ? 'IL2CPP 接口工具' : 'GameMaker 编译工具';
  await onEvent({ type: 'tool_start', callId, name: 'prepare_native_tools', detail: '正在自动准备' + label });
  await fs.mkdir(this.root, { recursive: true });
  const archive = path.join(this.root, spec.name), temporary = directory + '-' + crypto.randomUUID();
  try {
   let cached = false;
   try { cached = (await fs.stat(archive)).size === spec.size && await hash(archive, algorithm) === expected; } catch (error) { if (error.code !== 'ENOENT') throw error; }
   if (!cached) {
    const seed = this.options.archiveDirectory && path.join(this.options.archiveDirectory, spec.name);
    if (seed && (await fs.stat(seed).catch(() => null))?.size === spec.size && await hash(seed, algorithm) === expected) await fs.copyFile(seed, archive);
    else {
     const response = await (this.options.fetch || fetch)(spec.url, { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(300000)]) });
     if (!response.ok || !response.body) throw new Error('编译工具下载失败：HTTP ' + response.status);
     const partial = archive + '.partial-' + crypto.randomUUID(), handle = await fs.open(partial, 'wx'); let total = 0;
     try { for await (const chunk of response.body) { check(); total += chunk.length; if (total > spec.size) throw new Error('下载体积超出固定版本'); await handle.write(chunk); } } finally { await handle.close(); }
     if (total !== spec.size || await hash(partial, algorithm) !== expected) { await fs.rm(partial, { force: true }); throw new Error('编译工具官方摘要校验失败'); }
     await fs.rename(partial, archive);
    }
   }
   const files = await extract(archive, temporary); check();
   if (!files.some(file => file.source === spec.executable)) throw new Error('工具包中没有预期编译器');
   if (process.platform !== 'win32') await fs.chmod(path.join(temporary, spec.executable), 0o755);
   await fs.writeFile(path.join(temporary, 'receipt.json'), JSON.stringify({ archiveHash: expected, algorithm, source: spec.source, files }));
   await fs.rename(temporary, directory);
   const executable = await verify();
   await onEvent({ type: 'tool_end', callId, name: 'prepare_native_tools', detail: label + '已准备并通过完整性校验', durationMs: Date.now() - started });
   return executable;
  } catch (error) { await onEvent({ type: 'tool_end', callId, name: 'prepare_native_tools', failed: true, detail: error.message, durationMs: Date.now() - started }); throw error; }
  finally { await fs.rm(temporary, { recursive: true, force: true }); }
 }
 async ensureGodot(version, context = {}) {
  if (!/^[34]\.\d{1,2}\.\d{1,3}$/.test(version)) throw new Error('Godot 引擎版本不受支持：' + version);
  const name = 'godot-' + version, key = `${process.platform}-${process.arch}`;
  DISTRIBUTIONS[name] ||= {};
  if (!DISTRIBUTIONS[name][key]) {
   const tag = version.replace(/\.0$/, '') + '-stable', major = Number(version[0]), system = process.platform === 'win32' ? 'win64.exe' : process.platform === 'darwin' ? (major === 3 ? 'osx.universal' : 'macos.universal') : (major === 3 ? 'x11.64' : 'linux.x86_64');
   if (process.platform === 'win32' && process.arch !== 'x64' || process.platform === 'linux' && process.arch !== 'x64') throw new Error('当前系统没有对应的 Godot 原生编译器');
   const assetName = `Godot_v${tag}_${system}.zip`, manifestFile = path.join(this.root, name + '-distribution.json');
   let spec;
   try { spec = JSON.parse(await fs.readFile(manifestFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
   if (!spec) {
    const fetcher = this.options.fetch || fetch, request = { signal: context.signal, headers: { 'User-Agent': 'MODDOCK' } };
    const response = await fetcher(`https://api.github.com/repos/godotengine/godot/releases/tags/${tag}`, request);
    if (!response.ok) throw new Error('无法获取匹配 Godot 版本的官方工具：HTTP ' + response.status);
    const release = await response.json(), asset = release.assets?.find(asset => asset.name === assetName);
    if (!asset || !Number.isInteger(asset.size) || asset.size > 220 * 1024 * 1024) throw new Error('未找到此 Godot 版本对应的原生工具');
    const sumsResponse = await fetcher(`https://github.com/godotengine/godot/releases/download/${tag}/SHA512-SUMS.txt`, request);
    if (!sumsResponse.ok) throw new Error('无法获取 Godot 官方摘要');
    const sums = await sumsResponse.text(); if (sums.length > 65536) throw new Error('Godot 摘要清单超限');
    const checksum = sums.split('\n').map(line => line.trim().split(/\s+/)).find(row => row[1]?.replace(/^\*/, '') === assetName)?.[0];
    if (!/^[a-f0-9]{128}$/i.test(checksum || '')) throw new Error('官方清单没有此 Godot 工具的摘要');
    spec = { ...artifact('godotengine/godot', tag, assetName, asset.size, undefined, process.platform === 'darwin' ? 'Godot.app/Contents/MacOS/Godot' : `Godot_v${tag}_${system}`), sha512: checksum.toLowerCase() };
    await fs.mkdir(this.root, { recursive: true }); await fs.writeFile(manifestFile, JSON.stringify(spec));
   }
   if (spec.name !== assetName || spec.url !== `https://github.com/godotengine/godot/releases/download/${tag}/${assetName}` || !/^[a-f0-9]{128}$/.test(spec.sha512 || '')) throw new Error('Godot 官方工具缓存索引无效');
   DISTRIBUTIONS[name][key] = spec;
  }
  return this.ensure(name, context);
 }
 async run(name, args, context = {}) {
  const executable = await this.ensure(name, context);
  const result = await runTool(executable, args, { cwd: context.cwd || path.dirname(executable), signal: context.signal, timeout: context.timeout || 180000, limit: context.limit || 128 * 1024 });
  if (result.code !== 0) throw new Error((result.output || '原生编译器返回 ' + result.code).slice(-16000));
  return result.output;
 }
}
module.exports = { NativeTools, DISTRIBUTIONS, nativeSource };
