const fs = require('node:fs/promises');
const path = require('node:path');
const coverage = require('../studio-coverage.cjs');

// Read-only inventory audit. Input is a local scanner result {games:[...]}, never AI text.
(async () => {
 const [input, output] = process.argv.slice(2);
 if (!input || !output) throw new Error('Usage: node scripts/audit-studio-games.cjs games.json report.json');
 const inventory = JSON.parse(await fs.readFile(path.resolve(input), 'utf8'));
 const games = Array.isArray(inventory) ? inventory : inventory.games;
 if (!Array.isArray(games) || games.length > coverage.MAX_LOCAL_GAMES) throw new Error('Expected at most 10000 local games');
 const items = [], counts = {};
 for (let offset = 0; offset < games.length; offset += 32) {
  const batch = await coverage.audit(games, { offset });
  items.push(...batch.items);
  for (const [status, count] of Object.entries(batch.counts)) counts[status] = (counts[status] || 0) + count;
  process.stderr.write(`Assessed ${items.length}/${games.length}\n`);
 }
 const report = { createdAt: new Date().toISOString(), target: coverage.TARGET, catalogCount: coverage.page({ limit: 1 }).catalogCount, assessed: items.length, counts, items, targetVerified: false, note: 'Read-only route diagnosis; no build, install or gameplay evidence is implied.' };
 await fs.writeFile(path.resolve(output), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
 console.log(JSON.stringify({ report: path.resolve(output), assessed: items.length, counts }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
