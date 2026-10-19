const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { StudioTools, runTool } = require('./studio-tools.cjs');
const { localFile } = require('./studio-engines.cjs');
const { extract } = require('./installers.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function bytes(file, limit = 128 * 1024 * 1024) { const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new Error('IL2CPP 文件无效或超过限制'); return fs.readFile(file); }
async function dlls(directory) { return (await fs.readdir(directory)).filter(name => name.endsWith('.dll')).map(name => path.join(directory, name)); }
async function compiler(native, context) {
 const tools = new StudioTools(native.options); let probe = await tools.probe(context.signal);
 if (!probe.csharp.available) { await tools.prepareCsharp(context); probe = await tools.probe(context.signal); }
 if (!probe.csharp.available) throw new Error(probe.csharp.reason);
 const sdkRoot = path.resolve(path.dirname(probe.csharp.compiler), '../../../..'), packs = path.join(sdkRoot, 'packs/Microsoft.NETCore.App.Ref');
 const versions = (await fs.readdir(packs)).filter(version => /^\d+\.\d+\.\d+$/.test(version)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
 if (!versions.length) throw new Error('编译器缺少 .NET 引用包');
 const tfm = 'net' + versions[0].split('.').slice(0, 2).join('.');
 return { ...probe.csharp, references: await dlls(path.join(packs, versions[0], 'ref', tfm)), tfm, version: versions[0] };
}
async function bridge(native, context) {
 const coreDll = await native.tools.ensure('il2cpp', context), core = path.dirname(coreDll), tool = await compiler(native, context);
 const source = await fs.readFile(path.join(__dirname, 'vendor/native-toolchains/Il2CppBridge.cs'));
 const id = sha(Buffer.concat([source, Buffer.from(tool.version)])), directory = path.join(native.tools.root, 'il2cpp-bridge-' + id.slice(0, 16)), output = path.join(directory, 'Il2CppBridge.dll');
 await fs.mkdir(directory, { recursive: true });
 for (const file of await dlls(core)) {
  const destination = path.join(directory, path.basename(file)), content = await bytes(file);
  if (await bytes(destination).then(value => sha(value) === sha(content)).catch(error => { if (error.code === 'ENOENT') return false; throw error; })) continue;
  await fs.writeFile(destination, content);
 }
 for (const file of (await dlls(path.join(path.dirname(path.dirname(core)), 'dotnet'))).filter(file => /^Microsoft\.(?:Extensions\.|Bcl\.)/.test(path.basename(file)))) await fs.copyFile(file, path.join(directory, path.basename(file)));
 const code = path.join(directory, 'Il2CppBridge.cs'); await fs.writeFile(code, source);
 const result = await runTool(tool.executable, [tool.compiler, '/nologo', '/noconfig', '/nostdlib+', '/target:exe', '/deterministic+', '/out:' + output, ...[...tool.references, ...await dlls(core).then(files => files.filter(file => path.basename(file) !== 'dobby.dll'))].map(file => '/reference:' + file), code], { signal: context.signal, cwd: directory, timeout: 45000 });
 if (result.code !== 0) throw new Error('IL2CPP 接口工具编译失败：' + result.output);
 await fs.writeFile(path.join(directory, 'Il2CppBridge.runtimeconfig.json'), JSON.stringify({ runtimeOptions: { tfm: tool.tfm, framework: { name: 'Microsoft.NETCore.App', version: tool.version }, rollForward: 'LatestMajor' } }));
 return { tool, core, output, directory };
}
async function unityLibraries(native, version, context) {
 const number = version.match(/^(\d+\.\d+\.\d+)[abfp]\d+$/)?.[1]; if (!number) throw new Error('无法确认 Unity 的实际版本');
 const root = path.join(native.tools.root, 'unity-' + number), archive = root + '.zip', receipt = root + '.json';
 try {
  const record = JSON.parse(await fs.readFile(receipt, 'utf8'));
  for (const file of record.files) if (sha(await bytes(await localFile(root, file.source))) !== file.sha256) throw new Error('Unity 引用库缓存校验失败');
  return root;
 } catch (error) { if (error.code !== 'ENOENT') throw error; }
 await fs.mkdir(native.tools.root, { recursive: true });
 const seed = native.options.archiveDirectory && path.join(native.options.archiveDirectory, 'unity-' + number + '.zip');
 if (seed && await fs.stat(seed).catch(() => null)) await fs.copyFile(seed, archive);
 else {
  const response = await (native.options.fetch || fetch)('https://unity.bepinex.dev/libraries/' + number + '.zip', { signal: AbortSignal.any([...(context.signal ? [context.signal] : []), AbortSignal.timeout(180000)]) });
  if (!response.ok || !response.body) throw new Error('Unity ' + number + ' 引用库暂不可用：HTTP ' + response.status);
  const chunks = []; let length = 0;
  for await (const chunk of response.body) { length += chunk.length; if (length > 100 * 1024 * 1024) throw new Error('Unity 引用库超出体积限制'); chunks.push(chunk); }
  await fs.writeFile(archive, Buffer.concat(chunks));
 }
 const temporary = root + '-' + crypto.randomUUID();
 try {
  const files = await extract(archive, temporary);
  if (!files.some(file => /^UnityEngine(?:\.CoreModule)?\.dll$/.test(file.source))) throw new Error('Unity 引用库中缺少引擎程序集');
  await fs.rename(temporary, root); await fs.writeFile(receipt, JSON.stringify({ source: 'https://unity.bepinex.dev/libraries/' + number + '.zip', sha256: sha(await bytes(archive)), files }));
  return root;
 } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
async function prepareIl2cpp(native, game, evidence, context) {
 const root = await fs.realpath(game.installPath), names = evidence.inventory.map(file => file.path), assemblies = names.filter(name => /(?:^|\/)GameAssembly\.dll$/i.test(name)), metadata = names.filter(name => /_Data\/il2cpp_data\/Metadata\/global-metadata\.dat$/i.test(name));
 if (assemblies.length !== 1 || metadata.length !== 1) throw new Error('需要此游戏唯一且匹配的 GameAssembly.dll 和 global-metadata.dat');
 const target = assemblies[0], metaPath = metadata[0], assembly = await bytes(await localFile(root, target), 1024 ** 3), meta = await bytes(await localFile(root, metaPath));
 if (meta.length < 8 || meta.readUInt32LE(0) !== 0xFAB11BAF) throw new Error('IL2CPP 元数据已加密或不是受支持的格式');
 const data = metaPath.replace(/\/il2cpp_data\/Metadata\/global-metadata\.dat$/i, ''), manager = await localFile(root, data + '/globalgamemanagers'), handle = await fs.open(manager, 'r'), header = Buffer.alloc(4096);
 try { await handle.read(header, 0, header.length, 0); } finally { await handle.close(); }
 const version = header.toString('latin1').match(/(?:20\d\d|6000)\.\d+\.\d+[abfp]\d+/)?.[0];
 if (!version) throw new Error('无法从游戏本体确认 Unity 版本');
 const sha256 = sha(assembly), metadataSha256 = sha(meta), generator = sha(await fs.readFile(path.join(__dirname, 'vendor/native-toolchains/Il2CppBridge.cs'))), interopId = sha(Buffer.from(sha256 + metadataSha256 + version + generator + 'bep788-v2')), directory = native.directory(game), interop = path.join(directory, interopId);
 try { const record = JSON.parse(await fs.readFile(path.join(directory, 'snapshot.json'), 'utf8')); if (record.native.interopId === interopId) return record; } catch (error) { if (error.code !== 'ENOENT') throw error; }
 const onEvent = context.onEvent || (async () => {}), callId = crypto.randomUUID();
 await onEvent({ type: 'tool_start', callId, name: 'generate_interop', detail: '从本机原生程序和元数据生成匹配的游戏接口' });
 try {
  const host = await bridge(native, context), libraries = await unityLibraries(native, version, context);
  const loader = names.filter(name => /(?:^|\/)BepInEx\/core\/BepInEx\.Core\.dll$/i.test(name));
  if (loader.length && (loader.length !== 1 || !((await bytes(await localFile(root, loader[0]))).equals(await bytes(path.join(host.core, 'BepInEx.Core.dll')))))) throw new Error('本机 BepInEx 版本与当前 IL2CPP 编译工具不一致，已保留现有加载器');
  await fs.mkdir(directory, { recursive: true });
  const temporary = interop + '-' + crypto.randomUUID(); await fs.mkdir(temporary);
  try {
   const result = await runTool(host.tool.executable, [host.output, 'generate', await localFile(root, target), await localFile(root, metaPath), version, libraries, temporary], { cwd: host.directory, signal: context.signal, timeout: 300000, limit: 512 * 1024 });
   if (result.code !== 0) throw new Error('IL2CPP 接口生成失败：' + result.output.slice(-16000));
   const docs = JSON.parse(await bytes(path.join(temporary, 'interfaces.json'), 512 * 1024)), refs = await dlls(temporary);
   if (!refs.length || !docs.some(doc => !/^native\/il2cpp\/UnityEngine/.test(doc.path))) throw new Error('IL2CPP 未生成可用的游戏接口');
   const hashes = Object.fromEntries(await Promise.all(refs.map(async file => [path.basename(file), sha(await bytes(file))])));
   await fs.rename(temporary, interop);
   const record = { mode: 'unity-il2cpp', documents: require('./studio-native-projects.cjs').documents(docs), native: { target, sha256, metadata: metaPath, metadataSha256, version, interopId, references: hashes, base: path.posix.dirname(target) === '.' ? '' : path.posix.dirname(target), route: '提取 IL2CPP 元数据 → 自动生成游戏接口 → C# 原生编译 → BepInEx 6 插件安装' } };
   await fs.writeFile(path.join(directory, 'snapshot.json'), JSON.stringify(record));
   await onEvent({ type: 'tool_end', callId, name: 'generate_interop', detail: `已生成 ${refs.length} 个匹配程序集及本机类型签名` }); return record;
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
 } catch (error) { await onEvent({ type: 'tool_end', callId, name: 'generate_interop', failed: true, detail: error.message }); throw error; }
}
async function buildIl2cpp(native, game, item, evidence, context) {
 const root = await fs.realpath(game.installPath), binding = evidence.native;
 if (sha(await bytes(await localFile(root, binding.target), 1024 ** 3)) !== binding.sha256) throw new Error('IL2CPP 原生程序在调查后已变化');
 if (sha(await bytes(await localFile(root, binding.metadata))) !== binding.metadataSha256) throw new Error('IL2CPP 元数据在调查后已变化');
 const host = await bridge(native, context), interop = path.join(native.directory(game), binding.interopId), references = [];
 if (!/^[a-f0-9]{64}$/.test(binding.interopId)) throw new Error('IL2CPP 引用目录无效');
 for (const [name, digest] of Object.entries(binding.references)) {
  const file = await localFile(interop, name); if (sha(await bytes(file)) !== digest) throw new Error('IL2CPP 接口缓存已变化'); references.push(file);
 }
 const code = path.join(context.work, 'main.cs'), boot = path.join(context.work, 'Bootstrap.cs'), output = path.join(context.work, item.manifest.UniqueID + '.dll');
 await fs.writeFile(code, item.draft.files[0].text);
 const preload = Object.keys(binding.references).filter(name => !/^(?:System(?:\.|$)|Microsoft\.|Unity(?:Engine|Editor|\.)|Il2Cpp|mscorlib|netstandard|Mono\.|BepInEx|0Harmony)/i.test(name)).map(name => name.slice(0, -4));
 if (preload.length > 256) throw new Error('游戏互操作程序集数量超出当前限制');
 await fs.writeFile(boot, 'using BepInEx; using BepInEx.Unity.IL2CPP;\n[BepInPlugin("moddock.' + item.manifest.UniqueID + '", "AiMod", "1.0.0")] public sealed class ModdockEntry : BasePlugin { public override void Load() { foreach (var name in new string[] {' + preload.map(name => JSON.stringify(name)).join(',') + '}) System.Reflection.Assembly.Load(name); ModContent.Initialize(this); Log.LogInfo("MODDOCK_LOADED:' + item.manifest.UniqueID + '"); } }\n');
 const runtime = path.join(path.dirname(path.dirname(host.core)), 'dotnet'), runtimeReferences = [];
 for (const file of await dlls(runtime)) if (require('./studio-toolchain.cjs').managedDll(await bytes(file))) runtimeReferences.push(file);
 const allReferences = [...runtimeReferences, ...await dlls(host.core).then(files => files.filter(file => path.basename(file) !== 'dobby.dll')), ...references];
 const result = await runTool(host.tool.executable, [host.tool.compiler, '/nologo', '/noconfig', '/nostdlib+', '/target:library', '/deterministic+', '/optimize+', '/out:' + output, ...allReferences.map(file => '/reference:' + file), code, boot], { cwd: context.work, signal: context.signal, timeout: 45000 });
 const checks = [{ name: 'IL2CPP 插件 C# 编译', status: result.code === 0 ? 'passed' : 'failed', detail: result.output || (result.code === 0 ? '匹配的游戏接口、BepInEx 6 和 .NET 引用下 Roslyn 编译通过；未执行生成代码。' : '编译失败') }];
 if (result.code !== 0) return { outputs: [], checks };
 const compiled = await bytes(output, 4 * 1024 * 1024);
 if (!require('./studio-toolchain.cjs').managedDll(compiled)) throw new Error('未生成有效托管插件');
 const destination = path.posix.join(binding.base, 'BepInEx/plugins', item.manifest.UniqueID, item.manifest.UniqueID + '.dll');
 const loader = path.posix.join(binding.base, 'BepInEx/core/BepInEx.Core.dll');
 return { outputs: [{ name: 'deploy/' + destination, data: compiled }], baseHashes: { [destination]: null, [binding.target]: binding.sha256, [binding.metadata]: binding.metadataSha256, [loader]: sha(await bytes(path.join(host.core, 'BepInEx.Core.dll'))) }, generatedCaches: [], checks, passed: true };
}
module.exports = { prepareIl2cpp, buildIl2cpp, bridge, compiler };
