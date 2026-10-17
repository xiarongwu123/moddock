// Browser QA fixture: every install is restricted to an isolated temporary game.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { fixture } = require('./oneclick-fixture.cjs');
const { createServer } = require('./server-fixture.cjs');

(async () => {
 const x = await fixture(); let failOnce = true;
 x.game.name = '安装进度测试（临时游戏）'; x.game.appId = '1144200';
 const pakDirectory = 'ReadyOrNot/Content/Paks';
 await fs.mkdir(path.join(x.game.installPath, pakDirectory), { recursive: true });
 await fs.writeFile(path.join(x.game.installPath, pakDirectory, 'original-mod.pak'), 'original');
 const service = await createServer({ root: path.join(x.root, 'ui'), port: 0,
  scan: async () => ({ games: [x.game], roots: [], diagnostics: [] }),
  installers: { processes: async () => [], openGame: async () => {}, afterWrite: async (_, change) => {
   await new Promise(resolve => setTimeout(resolve, 1800));
   if (change.rel.endsWith('retry.pak') && failOnce) { failOnce = false; throw new Error('测试写入中断'); }
  } }, sources: { fetch: async () => Response.json({ _aMetadata: { _nRecordCount: 0 }, _aRecords: [] }) } });
 for (const [name, entries] of [
  ['画质增强 MOD', [{ name: 'Release/original-mod.pak', data: 'modded' }, { name: 'Release/effects.pak', data: 'effect' }, { name: 'Release/lighting.pak', data: 'lighting' }]],
  ['失败重试 MOD', [{ name: 'Release/retry.pak', data: 'retried' }]],
  ['启动前安装 MOD', [{ name: 'Release/launch.pak', data: 'launch' }]],
 ]) {
  const job = await x.job(entries), directory = path.join(service.downloads.root, job.id);
  await fs.mkdir(directory); const file = path.join(directory, job.filename); await fs.copyFile(job.path, file);
  service.downloads.jobs.push({ ...job, name, path: file, bytes: (await fs.stat(file)).size, progress: 100, message: 'MOD 已下载' });
 }
 await service.downloads.save();
 console.log(JSON.stringify({ url: service.url, root: x.root, gameId: x.game.id }));
 const close = async () => {
  try {
   assert.equal(await fs.readFile(path.join(x.game.installPath, pakDirectory, 'original-mod.pak'), 'utf8'), 'modded');
   assert.equal(await fs.readFile(path.join(x.game.installPath, pakDirectory, 'retry.pak'), 'utf8'), 'retried');
   assert.equal(await fs.readFile(path.join(x.game.installPath, 'Saves/player.sav'), 'utf8'), 'player save');
   console.log('Real fixture files verified; saved game preserved.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  await new Promise(resolve => service.server.close(resolve)); await x.close(); process.exit(process.exitCode || 0);
 };
 process.on('SIGINT', close); process.on('SIGTERM', close);
})().catch(error => { console.error(error); process.exitCode = 1; });
