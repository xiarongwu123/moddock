const { LuaFactory } = require('wasmoon');

async function checkLua(source) {
 if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > 64000) throw new Error('Lua source exceeds the validation limit');
 const engine = await new LuaFactory().createEngine();
 try {
  await engine.doString('function ModdockCompile(source) local fn, err = load(source, "@Moddock", "t", {}); return fn and "" or err end');
  const error = engine.global.get('ModdockCompile')(source);
  return { passed: !error, detail: error || 'Lua 5.4 WebAssembly 编译检查通过；没有执行生成脚本。' };
 } finally { engine.global.close(); }
}
module.exports = { checkLua };
