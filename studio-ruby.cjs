const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
async function checkRuby(code, signal) {
 if (typeof code !== 'string' || Buffer.byteLength(code) > 64000) throw new Error('Ruby 源码超出限制');
 return new Promise((resolve, reject) => {
  const worker = new Worker(__filename, { workerData: { code }, execArgv: [], stdout: true, stderr: true });
  const stop = () => { worker.terminate(); reject(new Error('Ruby 编译已取消')); };
  const timer = setTimeout(() => { worker.terminate(); reject(new Error('Ruby 编译超时')); }, 15000);
  const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); };
  worker.once('message', result => { clean(); worker.terminate(); resolve(result); });
  worker.once('error', error => { clean(); reject(error); });
  worker.once('exit', code => { clean(); if (code) reject(new Error('Ruby 编译器异常退出')); });
  signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) stop();
 });
}
if (!isMainThread && workerData?.code !== undefined) (async () => {
 try {
  const fs = require('node:fs/promises'), { DefaultRubyVM } = require('@ruby/wasm-wasi/dist/node');
  const binary = await fs.readFile(require.resolve('@ruby/3.3-wasm-wasi/dist/ruby.wasm'));
  const { vm } = await DefaultRubyVM(await WebAssembly.compile(binary), { env: { RUBYOPT: '--disable=gems,error_highlight,did_you_mean,syntax_suggest' } });
  const hex = Buffer.from(workerData.code).toString('hex');
  vm.eval(`RubyVM::InstructionSequence.compile(["${hex}"].pack("H*").force_encoding("UTF-8"), "main.rb")`);
  parentPort.postMessage({ passed: true, detail: 'CRuby 3.3 WebAssembly 字节码编译通过；未执行生成脚本，RGSS 1/2 仍要求 Ruby 1.8 兼容语法。' });
 } catch (error) { parentPort.postMessage({ passed: false, detail: String(error.message).slice(0, 4000) }); }
})();
module.exports = { checkRuby };
