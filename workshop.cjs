const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { sourceGames, normalize } = require('./sources.cjs');
const nexusIndex = require('./nexus-games.json');

const catalogId = game => game.nexus ? `catalog:nexus:${game.nexus}` : game.appId ? `catalog:steam:${game.appId}` : `catalog:local:${game.id}`;
const sameGame = (a, b) => a.appId && b.appId ? String(a.appId) === String(b.appId) : a.nexus && b.nexus ? a.nexus === b.nexus : [a.name, a.searchName].filter(Boolean).some(n => [b.name, b.searchName].filter(Boolean).some(m => normalize(n) === normalize(m)));

function catalog(localGames = []) {
 const games = new Map();
 for (const game of sourceGames) games.set(catalogId(game), { ...game, id: catalogId(game), featured: true });
 for (const game of nexusIndex.games) {
  const id = `catalog:nexus:${game.domainName}`;
  if (!games.has(id)) games.set(id, { id, name: game.name, searchName: game.name, nexus: game.domainName });
 }
 for (const local of localGames) {
  const match = [...games.values()].find(game => sameGame(game, local));
  if (match) {
   match.localIds = [...(match.localIds || []), local.id];
   for (const key of ['appId', 'banana', 'nexus', 'workshop']) if (match[key] == null && local[key] != null) match[key] = local[key];
  } else {
   const id = catalogId(local);
   games.set(id, { id, name: local.name, searchName: local.searchName || local.name, appId: local.appId, nexus: local.nexus, banana: local.banana, workshop: local.workshop, localIds: [local.id] });
  }
 }
 return [...games.values()].map(game => ({ ...game, localIds: game.localIds || [] }));
}

class Workshop {
 constructor(root, localGames, mappings = () => ({})) { this.root = path.join(root, 'workshop'); this.localGames = localGames; this.mappings = mappings; this.queues = new Map(); this.items = new Map(); }
 remember(items) {
  for (const item of items) {
   if (this.items.size >= 2000) this.items.delete(this.items.keys().next().value);
   this.items.set(`${item.gameId}/${item.id}`, item);
  }
 }
 games() { return catalog(this.localGames()).map(game => ({ ...game, ...this.mappings()[game.id] })); }
 game(id) {
  const games = this.games(), mapping = this.mappings()[id];
  const game = games.find(game => game.id === id) || (mapping?.nexus ? games.find(game => game.nexus === mapping.nexus) : null);
  if (!game) throw new Error('游戏不在工坊目录中，请重新选择游戏');
  return { ...game, id };
 }
 list({ query = '', page = 1, scope = 'all' } = {}) {
  if (typeof query !== 'string' || query.length > 160 || !Number.isInteger(page) || page < 1 || page > 1000 || !['all', 'installed'].includes(scope)) throw new Error('游戏目录查询参数无效');
  const needle = normalize(query);
  const games = this.games().filter(game => (scope !== 'installed' || game.localIds.length) && (!needle || normalize(`${game.name} ${game.searchName} ${game.nexus || ''}`).includes(needle)));
  games.sort((a, b) => Number(!!b.localIds.length) - Number(!!a.localIds.length) || Number(!!b.featured) - Number(!!a.featured) || a.name.localeCompare(b.name, 'zh-CN'));
  return { items: games.slice((page - 1) * 24, page * 24), page, total: games.length, hasNext: page * 24 < games.length, indexedAt: nexusIndex.fetchedAt };
 }
 async favorites(owner) {
  const file = path.join(this.root, crypto.createHash('sha256').update(String(owner)).digest('hex') + '.json');
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
 }
 saveFavorite(owner, item, enabled) {
  const pending = (this.queues.get(owner) || Promise.resolve()).catch(() => {}).then(async () => {
   let items = await this.favorites(owner);
   items = items.filter(m => !(m.gameId === item.gameId && m.id === item.id));
   if (enabled) {
    if (items.length >= 500) throw new Error('最多收藏 500 个 MOD，请先移除部分收藏');
    items.unshift({ ...item, savedAt: new Date().toISOString() });
   }
   await fs.mkdir(this.root, { recursive: true });
   const file = path.join(this.root, crypto.createHash('sha256').update(String(owner)).digest('hex') + '.json');
   await fs.writeFile(file + '.tmp', JSON.stringify(items));
   await fs.rename(file + '.tmp', file);
   return items;
  });
  this.queues.set(owner, pending);
  pending.finally(() => { if (this.queues.get(owner) === pending) this.queues.delete(owner); }).catch(() => {});
  return pending;
 }
}

module.exports = { Workshop, catalog, sameGame };
