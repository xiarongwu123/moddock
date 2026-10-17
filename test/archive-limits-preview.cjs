const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createServer } = require('./server-fixture.cjs');
const { zip } = require('./zip-fixture.cjs');
const { hash } = require('../installers.cjs');

(async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-archive-preview-'));
 const game = { id: 'steam-1091500', appId: '1091500', name: 'Cyberpunk 2077 压缩包测试（临时目录）', platform: 'Steam', installPath: path.join(root, 'game'), real: true };
 await fs.mkdir(path.join(game.installPath, 'bin/x64'), { recursive: true });
 await fs.mkdir(path.join(game.installPath, 'archive/pc/mod'), { recursive: true });
 await fs.writeFile(path.join(game.installPath, 'bin/x64/Cyberpunk2077.exe'), 'MZfixture');
 const service = await createServer({ root: path.join(root, 'data'), port: 0, scan: async () => ({ games: [game], roots: [], diagnostics: [] }), installers: { processes: async () => [] }, sources: { fetch: async () => Response.json({ _aMetadata: { _nRecordCount: 0 }, _aRecords: [] }) } });
 for (const invalid of [true, false]) {
  const id = crypto.randomUUID(), directory = path.join(service.downloads.root, id), file = path.join(directory, 'fixture.zip');
  const bytes = zip([{ name: invalid ? 'textures/suspicious.pak' : 'textures.archive', data: invalid ? 'fixture' : Buffer.concat([Buffer.from('RDAR'), Buffer.alloc(2 * 1024 ** 2)]), deflate: true }]);
  if (invalid) {
   const central = bytes.indexOf(Buffer.from('504b0102', 'hex'));
   bytes.writeUInt32LE(1, central + 20); bytes.writeUInt32LE(4 * 1024 ** 2, central + 24);
  }
  await fs.mkdir(directory); await fs.writeFile(file, bytes);
  service.downloads.jobs.push({ id, gameId: game.id, gameName: game.name, resourceId: 'banana:1', source: 'banana', fileId: '1', name: invalid ? '超限报错测试包' : '正常高压缩率测试包', status: 'completed', filename: 'fixture.zip', path: file, sha256: await hash(file), bytes: bytes.length, total: bytes.length, progress: 100, message: '测试下载已完成' });
 }
 await service.downloads.save();
 console.log(JSON.stringify({ url: service.url, root }));
 const close = async () => { await new Promise(resolve => service.server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); process.exit(); };
 process.on('SIGINT', close); process.on('SIGTERM', close);
})().catch(error => { console.error(error); process.exitCode = 1; });
