const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runTool } = require('../studio-tools.cjs');
const { commandFor } = require('../studio-conversations.cjs');

test('tool runner bounds output, times out, supports abort and never interprets shell arguments', async () => {
 const marker = '$(touch /tmp/moddock-unwanted-command); echo injected';
 const result = await runTool(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', marker]);
 assert.equal(result.output, marker); assert.equal(result.code, 0);
 await assert.rejects(runTool(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 80 }), /超时/);
 await assert.rejects(runTool(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: AbortSignal.timeout(80) }), /取消/);
 await assert.rejects(runTool(process.execPath, ['-e', 'process.stdout.write("x".repeat(65536))'], { limit: 512 }), /超过限制/);
});
test('conversation commands are narrow and do not consume creative ideas or arbitrary commands', () => {
 for (const value of ['请重新编译', '编译并验证', '验证一下']) assert.equal(commandFor(value), 'build');
 assert.equal(commandFor('帮我预览产物。'), 'preview'); assert.equal(commandFor('导出编译包'), 'export-build');
 assert.equal(commandFor('检查本次运行'), 'runtime'); assert.equal(commandFor('准备制作环境'), 'environment');
 for (const value of ['制作一个新角色', '增加一个验证玩家身份的 NPC', 'run rm -rf /', '编译这个新的任务系统']) assert.equal(commandFor(value), null);
});
