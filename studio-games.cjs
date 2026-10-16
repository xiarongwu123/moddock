const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathKey } = require('./scanner.cjs');

async function nativeFile(file) {
 const stat = await fs.lstat(file);
 if (!stat.isFile() || stat.isSymbolicLink()) return false;
 const handle = await fs.open(file, 'r'), bytes = Buffer.alloc(4);
 try { await handle.read(bytes, 0, 4, 0); } finally { await handle.close(); }
 return bytes.subarray(0, 2).toString() === 'MZ' || bytes.toString() === '\x7fELF' || [0xfeedface,0xfeedfacf,0xcefaedfe,0xcffaedfe,0xcafebabe].includes(bytes.readUInt32BE());
}
async function resolveStudioGame(selected, games = []) {
 if (typeof selected !== 'string' || !path.isAbsolute(selected) || selected.length > 4096 || selected.includes('\0')) throw new Error('请拖入本机游戏文件夹或游戏启动文件');
 const real = await fs.realpath(selected);
 const knownPaths = await Promise.all(games.map(async game => ({ game, root: await fs.realpath(game.installPath).catch(() => game.installPath) })));
 const known = knownPaths.filter(({ root }) => pathKey(real) === pathKey(root) || pathKey(real).startsWith(pathKey(root) + path.sep)).sort((a, b) => b.root.length - a.root.length)[0];
 if (known) return known.game;
 const stat = await fs.lstat(real);
 if (!stat.isDirectory() && !stat.isFile()) throw new Error('请选择普通游戏文件或文件夹');
 if (stat.isFile() && !await nativeFile(real)) throw new Error('请选择游戏原生启动文件，不能使用脚本、快捷方式或安装包');
 const root = stat.isDirectory() ? real : path.dirname(real);
 let executable = stat.isFile() ? path.basename(real) : null;
 if (!executable) {
  const directory = root.endsWith('.app') ? path.join(root, 'Contents/MacOS') : root;
  const entries = await fs.readdir(directory, { withFileTypes: true });
  if (entries.length > 500) throw new Error('目录内容较多，请选择具体游戏文件夹或启动文件');
  const candidates = [];
  for (const entry of entries.filter(entry => entry.isFile())) if (await nativeFile(path.join(directory, entry.name))) candidates.push(path.relative(root, path.join(directory, entry.name)).split(path.sep).join('/'));
  if (!candidates.length) throw new Error('没有找到游戏原生启动文件，请选择具体游戏文件夹');
  if (candidates.length === 1) executable = candidates[0];
 }
 return { id: 'local-' + crypto.createHash('sha256').update(pathKey(root)).digest('hex').slice(0, 20), name: path.basename(root).replace(/\.app$/i, ''),
  platform: '本地', installPath: root, ...(executable ? { executable } : {}), real: true };
}
function mergeStudioGames(result, localGames = []) {
 const games = [...result.games];
 for (const game of localGames) if (!games.some(existing => existing.id === game.id || pathKey(existing.installPath) === pathKey(game.installPath))) games.push(game);
 return { ...result, games };
}
module.exports = { resolveStudioGame, mergeStudioGames };
