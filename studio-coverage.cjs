const fs = require('node:fs');
const { diagnoseGame } = require('./game-diagnostics.cjs');
const { recipesFor } = require('./studio-recipes.cjs');

const TARGET = 1000;
const MAX_LOCAL_GAMES = 10000;
const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]/gu, '');
let cached;
function catalog() {
 if (cached) return cached;
 const source = JSON.parse(fs.readFileSync(require.resolve('./nexus-games.json'), 'utf8'));
 const domains = new Set();
 const games = source.games.filter(game => typeof game.name === 'string' && /^[a-z0-9_-]+$/i.test(game.domainName) && !domains.has(game.domainName) && domains.add(game.domainName)).map(game => Object.freeze({
  id: 'nexus:' + game.domainName, name: game.name, domainName: game.domainName,
  source: 'https://www.nexusmods.com/' + game.domainName, status: 'unassessed',
 }));
 cached = Object.freeze({ target: TARGET, catalogCount: games.length, fetchedAt: source.fetchedAt, games: Object.freeze(games) });
 return cached;
}
function page({ query = '', offset = 0, limit = 50 } = {}) {
 if (typeof query !== 'string' || query.length > 160 || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('游戏目录查询参数无效');
 const data = catalog(), needle = normalize(query);
 const matches = needle ? data.games.filter(game => normalize(game.name).includes(needle) || normalize(game.domainName).includes(needle)) : data.games;
 return { target: data.target, catalogCount: data.catalogCount, fetchedAt: data.fetchedAt, total: matches.length, offset, items: matches.slice(offset, offset + limit), note: '目录收录不代表已适配；制作能力以本机诊断、构建和实机验证为准。' };
}
function assessment(game, report) {
 const blocked = !!report.onlineOnly || report.antiCheat.length > 0;
 const routes = recipesFor(game, report).filter(route => !['project-plan', 'custom-project'].includes(route.id)).map(route => ({ id: route.id, available: !blocked && route.available, reason: blocked ? '需先确认游戏允许的离线 Mod 路线。' : route.reason }));
 // Engine recognition authorizes investigation, not installation or a successful build.
 const executableRoutes = routes.filter(route => route.available && route.id !== 'engine-mod').map(route => route.id);
 return { gameId: game.id, name: game.name, engine: report.engine.key,
  status: blocked ? 'blocked' : executableRoutes.length ? 'authoring-route' : routes.some(route => route.available) ? 'engine-investigation' : 'missing-adapter',
  routes, executableRoutes, warnings: report.warnings || [], truncated: !!report.truncated,
  buildVerified: false, installationVerified: false, gameplayVerified: false };
}
async function audit(games, { offset = 0, limit = 32, diagnose = diagnoseGame } = {}) {
 if (!Array.isArray(games) || games.length > MAX_LOCAL_GAMES || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('本机游戏诊断参数无效');
 const selected = games.slice(offset, offset + limit), items = new Array(selected.length);
 let next = 0;
 async function worker() {
  while (next < selected.length) {
   const index = next++, game = selected[index];
   try { items[index] = assessment(game, await diagnose(game)); }
   catch (error) { items[index] = { gameId: game.id, name: game.name, status: 'diagnostic-failed', error: error.message }; }
  }
 }
 await Promise.all([worker(), worker()]);
 const counts = {};
 for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;
 return { target: TARGET, total: games.length, offset, nextOffset: offset + selected.length < games.length ? offset + selected.length : null, assessed: items.length, counts, items,
  note: '诊断仅报告制作入口；构建、安装和游戏效果需针对具体产物独立验收。' };
}
module.exports = { TARGET, MAX_LOCAL_GAMES, page, assessment, audit };
