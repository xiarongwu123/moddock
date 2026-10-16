const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { resolveStudioGame, mergeStudioGames } = require('../studio-games.cjs');

test('game selection recognizes native executables and preserves known library identities', async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-game-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
 const file = path.join(root, 'game.exe'); await fs.writeFile(file, 'MZ\0\0');
 const found = await resolveStudioGame(root); assert.equal(found.installPath, await fs.realpath(root)); assert.equal(found.executable, 'game.exe');
 const known = { id: 'steam-1', installPath: found.installPath, appId: '1', name: 'Known Game' };
 assert.equal(await resolveStudioGame(file, [known]), known);
 assert.deepEqual(mergeStudioGames({ games: [known], roots: [] }, [found]).games, [known]);
 await fs.writeFile(path.join(root, 'another.exe'), 'MZ\0\0'); assert.equal((await resolveStudioGame(root)).executable, undefined);
 const empty = path.join(root, 'empty'); await fs.mkdir(empty); await assert.rejects(resolveStudioGame(empty), /没有找到/);
 await fs.symlink(file, path.join(empty, 'linked.exe')); await assert.rejects(resolveStudioGame(empty), /没有找到/);
});
