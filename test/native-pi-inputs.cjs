const fs = require('node:fs/promises');
const path = require('node:path');
const { ModStudio } = require('../mod-studio.cjs');
async function main() {
 const input = path.resolve('output/native-toolchains/pi-inputs'); await fs.mkdir(input, { recursive: true });
 const variants = [
  ['godot', 'output/native-toolchains/engine-builds/godot-4.4.1', '给这款 Godot 单机游戏制作实际 Mod：仅将场景里 Player 的 damage 从 10 改为 25，保留其他逻辑。需要兼顾已经存在和后续新加入的 Player 节点。使用本机恢复出的源代码，不要返回方案或示例。'],
  ['gamemaker', 'output/native-toolchains/engine-builds/gamemaker-vm', '给这款 GameMaker 单机游戏制作实际 Mod：只把 obj_player 的 Create 事件中初始 damage 从 10 改为 25。health、stamina 以及 Step 事件保持原来行为。必须编译回真实 VM 入口，不能只输出方案。'],
  ['rgss', 'output/native-toolchains/engine-builds/rgss-rvdata2', '给这款 RPG Maker VX Ace 单机游戏制作实际 Mod：让 Game_Player#damage 在原返回值上增加 15。用 alias 保留原方法和接收者，保留其他逻辑，兼容 Ruby 1.8 写法。不要修改 Main 和其他资源，不要返回方案。'],
  ['il2cpp', 'output/native-toolchains/il2cpp-build', '给这款 Unity IL2CPP 单机测试游戏制作实际插件：通过 Harmony Prefix 只跳过 NormalBehaviour.Update 的原始执行，保留 NormalBehaviour.Start 和 FirstPassBehaviour 的行为。读取本机接口，写实际 Prefix 返回 false 及正确 Harmony 目标。不要空 PatchAll、方案、日志占位，也不要修改其他玩法。'],
 ];
 const studio = new ModStudio(path.resolve('output/native-toolchains/pi-app'), { integration: { python: false }, tools: { directory: path.resolve('.moddock-tools'), archiveDirectory: path.resolve('output/native-toolchains') } });
 for (const [name, directory, prompt] of variants) {
  const game = { id: 'native-pi-' + name, name: 'Unlisted ' + name + ' game', installPath: path.resolve(directory) }, workspace = await studio.workspace(game);
  const payload = { harness: 'pi-agent', prompt, types: [{ id: 'engine-mod', available: true }], capability: { deliverable: 'mod', allowedKinds: ['engine-mod'] }, context: { game: { id: game.id, name: game.name }, engineEvidence: workspace.context.engineEvidence }, diagnostic: workspace.diagnostic };
  if (!workspace.context.engineEvidence.native) throw new Error('Missing native game evidence: ' + name);
  const bytes = Buffer.from(JSON.stringify(payload)); if (bytes.length > 170 * 1024) throw new Error('Context too large');
  await fs.writeFile(path.join(input, name + '.json'), bytes); console.log(name, bytes.length, workspace.context.engineEvidence.mode);
 }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
