const fs = require('node:fs/promises');
const path = require('node:path');
const { diagnoseGame } = require('./game-diagnostics.cjs');

// Keep observations when a disk is disconnected or a manifest is temporarily unreadable.
class GameUpdates {
 constructor(root) { this.file = path.join(root, 'game-builds.json'); this.state = {}; this.queue = Promise.resolve(); }
 async open() { try { this.state = JSON.parse(await fs.readFile(this.file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; } return this; }
 observe(games) {
  const work = this.queue.catch(() => {}).then(async () => {
   const next = structuredClone(this.state);
   for (const game of games) {
    if (game.platform !== 'Steam' || !/^\d+$/.test(String(game.buildId || '')) || game.buildId === '0') continue;
    const buildId = String(game.buildId), previous = next[game.id];
    if (previous?.buildId === buildId) continue;
    let change = previous?.change;
    if (previous) {
     let loaders = [], diagnosticError;
     try { loaders = (await diagnoseGame(game)).loaders; } catch (e) { diagnosticError = e.message; }
     change = { from: previous.buildId, to: buildId, detectedAt: new Date().toISOString(), loaders, diagnosticError };
    }
    next[game.id] = { buildId, ...(change ? { change } : {}) };
   }
   await fs.writeFile(this.file + '.tmp', JSON.stringify(next, null, 2));
   await fs.rename(this.file + '.tmp', this.file); this.state = next;
  });
  this.queue = work; return work;
 }
 view(games, mods) {
  return games.flatMap(game => {
   const change = this.state[game.id]?.change;
   if (!change || change.to !== String(game.buildId)) return [];
   const affected = mods.filter(mod => mod.gameId === game.id).map(({ id, name, status }) => ({ id, name, status }));
   return affected.length || change.loaders.length || change.diagnosticError ? [{ gameId: game.id, gameName: game.name, ...change, mods: affected }] : [];
  });
 }
}
module.exports = { GameUpdates };
