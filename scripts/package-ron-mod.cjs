const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { components } = require('../game-components.cjs');
const { extract } = require('../installers.cjs');
const { checkLua } = require('../studio-lua.cjs');
const { zipContent } = require('../content-pack.cjs');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
(async () => {
 const report = JSON.parse(await fs.readFile(path.resolve(process.argv[2]), 'utf8'));
 const output = path.resolve(process.argv[3] || 'output/mods/20261016-ready-or-not');
 if (!report.passed || !report.realPiUsed || !report.logicSandboxPassed || report.draft?.kind !== 'ue4ss-lua') throw new Error('Successful native Pi and logic sandbox reports are required');
 const code = report.draft.code, compilation = await checkLua(code);
 if (!compilation.passed) throw new Error(compilation.detail);
 const loader = components.ue4ss, archive = await fs.readFile(path.resolve('output/game-environments', loader.name));
 if (archive.length !== loader.size || digest(archive) !== loader.sha256) throw new Error('Pinned official loader digest mismatch');
 const work = await fs.mkdtemp(path.join(os.tmpdir(), 'ron-release-'));
 try {
  const unpacked = path.join(work, 'loader'); await extract(path.resolve('output/game-environments', loader.name), unpacked);
  const base = 'ReadyOrNot/Binaries/Win64/', mod = base + 'ue4ss/Mods/ModdockSuspectSecondChance/';
  const runtime = ['dwmapi.dll', 'ue4ss/UE4SS.dll', 'ue4ss/UE4SS-settings.ini', 'ue4ss/LICENSE', 'ue4ss/Mods/shared/UEHelpers/UEHelpers.lua', 'ue4ss/UE4SS_SDK_Backends/UE4SS.json'];
  const files = await Promise.all(runtime.map(async name => ({ name: base + name, data: await fs.readFile(path.join(unpacked, name)) })));
  files.push({ name: mod + 'Scripts/main.lua', data: Buffer.from(code) }, { name: mod + 'enabled.txt', data: Buffer.alloc(0) });
  const manifest = { name: report.draft.name, version: '1.0.0', game: 'Ready or Not', steamAppId: '1144200', adapter: 'ue4ss-lua',
   generatedByNativePi: true, luaSyntaxPassed: true, runtimeVerified: false, windowsDeviceTested: false, gameplayTested: false,
   loader: { version: loader.version, archive: loader.name, sha256: loader.sha256, url: loader.url },
   sourceSha256: digest(Buffer.from(code)), files: files.map(file => ({ name: file.name, bytes: file.data.length, sha256: digest(file.data) })),
   apiBaseline: require('../vendor/ready-or-not-api/UPSTREAM.json').commit };
  const instructions = '严阵以待 · 敌人倒地复起 1.0.0\n\n仅用于单人离线。敌人受到致命伤害时，保留正生命值并使用游戏原生装死流程，约 3.5 秒后复起，每名敌人一次。玩家、SWAT、平民不在作用范围内。\n\n安装：退出游戏，将压缩包中的 ReadyOrNot 文件夹合并到游戏安装根目录（与 ReadyOrNot.exe 同级）。包内包含已校验的 UE4SS 和实际 Lua 脚本。如已有 UE4SS，请保留现有加载器与设置，仅复制 ue4ss/Mods/ModdockSuspectSecondChance 文件夹。不要覆盖现有不同版本加载器。\n\n停用：移走 ModdockSuspectSecondChance/enabled.txt 或移出该 Mod 文件夹。存档和游戏原始文件不需要修改。\n\n已完成 Lua 5.4 编译、逻辑沙箱和压缩包文件校验；Windows 实机与当前游戏版本的真实伤害 Hook、倒地和起身效果尚待验证。并非将已经死亡的尸体复活。游戏更新后接口可能变化；不兼容时查看 ReadyOrNot/Binaries/Win64/ue4ss/UE4SS.log。\n';
  files.push({ name: 'INSTALL.txt', data: Buffer.from(instructions) }, { name: 'BUILD.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) });
  const bytes = zipContent(files), filename = 'ReadyOrNot-SuspectSecondChance-1.0.0-Windows-x64.zip';
  await fs.mkdir(output, { recursive: true }); const target = path.join(output, filename); await fs.writeFile(target, bytes, { flag: 'wx' });
  const entries = await extract(target, path.join(work, 'roundtrip'));
  if (entries.length !== files.length || entries.some(entry => !files.some(file => file.name === entry.source && digest(file.data) === entry.sha256))) throw new Error('Packaged Mod readback mismatch');
  const verification = { ...manifest, filename: target, archiveBytes: bytes.length, archiveSha256: digest(bytes), zipCrcAndHashesVerified: true, officialLoaderFilesVerified: true };
  await fs.writeFile(path.join(output, 'mod-verification.json'), JSON.stringify(verification, null, 2));
  console.log(JSON.stringify({ filename: target, bytes: bytes.length, sha256: verification.archiveSha256, files: entries.length, runtimeVerified: false }));
 } finally { await fs.rm(work, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
