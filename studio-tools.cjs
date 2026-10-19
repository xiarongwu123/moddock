const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

function runTool(executable, args, { cwd, signal, timeout = 30000, limit = 16384 } = {}) {
 return new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new Error('制作任务已取消'));
  let output = '', size = 0, reason = '', timer, killTimer;
  const child = spawn(executable, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
   env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', MSBUILDDISABLENODEREUSE: '1' } });
  const stop = message => { if (reason) return; reason = message; child.kill(); killTimer = setTimeout(() => child.kill('SIGKILL'), 1000); killTimer.unref(); };
  const cancel = () => stop('制作任务已取消');
  const append = bytes => { size += bytes.length; if (size > limit) { stop('编译器输出超过限制'); return; } output += bytes.toString('utf8'); };
  child.stdout.on('data', append); child.stderr.on('data', append);
  signal?.addEventListener('abort', cancel, { once: true });
  timer = setTimeout(() => stop('编译器运行超时'), timeout); timer.unref();
  const clean = () => { clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', cancel); };
  child.once('error', error => { clean(); reject(error); });
  child.once('close', code => { clean(); if (reason) reject(new Error(reason)); else resolve({ code, output }); });
 });
}
class StudioTools {
 constructor(options = {}) { this.options = options; this.cache = null; }
 async prepareCsharp(context) {
  if (process.platform !== 'win32' || process.arch !== 'x64' || this.options.dotnet === false || this.options.autoInstall === false || !context.authorize) return;
  const directory = this.options.directory;
  if (!directory) return;
  const { prepareCompiler } = require('./studio-compiler-setup.cjs');
  await prepareCompiler(directory, context, { fetch: this.options.fetch }); this.cache = null;
 }
 async probe(signal) {
  if (this.cache && Date.now() - this.cache.time < 15000) return this.cache.value;
  const directory = this.options.directory || process.env.MODDOCK_TOOLCHAIN_DIR || path.join(__dirname.replace(/app\.asar([\\/])?$/, 'app.asar.unpacked$1'), '.moddock-tools');
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const candidates = (key, names) => this.options[key] === false ? [] : this.options[key] ? [this.options[key]] : [process.env['MODDOCK_' + key.toUpperCase()], ...names].filter(Boolean);
  let lua = { available: false, reason: '宿主未配备 Lua 5.4 编译器；工程已保留，可在环境就绪后重新编译。' };
  for (const executable of candidates('luac', [path.join(directory, 'bin', 'luac' + suffix), 'luac5.4', 'luac54', 'luac'])) {
   if (signal?.aborted) throw new Error('制作任务已取消');
   try { const result = await runTool(executable, ['-v'], { signal, timeout: 4000 }); if (result.code === 0 && /Lua 5\.4\./.test(result.output)) { lua = { available: true, executable, version: result.output.trim().slice(0, 120) }; break; } } catch { /* Missing or incompatible tools cannot validate Lua 5.4. */ }
  }
  let csharp = { available: false, reason: '宿主未配备带 Roslyn 编译器的 .NET SDK；工程已保留，可在环境就绪后重新编译。' };
  for (const executable of candidates('dotnet', [path.join(directory, 'dotnet', 'dotnet' + suffix), path.join(__dirname, '.moddock-tools/dotnet', 'dotnet' + suffix), 'dotnet'])) {
   if (signal?.aborted) throw new Error('制作任务已取消');
   try {
    const result = await runTool(executable, ['--list-sdks'], { signal, timeout: 5000 });
    const sdks = [...result.output.matchAll(/^(\d+\.\d+\.\d+) \[([^\r\n]+)\]$/gm)].reverse();
    for (const [, version, root] of sdks) { const compiler = path.join(root, version, 'Roslyn/bincore/csc.dll'); if ((await fs.stat(compiler)).isFile()) { csharp = { available: true, executable, compiler, version }; break; } }
    if (csharp.available) break;
   } catch { /* A runtime-only installation is not a compiler. */ }
  }
  if (signal?.aborted) throw new Error('制作任务已取消');
  const value = { lua, csharp }; this.cache = { time: Date.now(), value }; return value;
 }
}
module.exports = { StudioTools, runTool };
