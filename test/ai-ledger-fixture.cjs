const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { AILedger } = require('../platform/ai-ledger.cjs');
async function ledgerFixture() {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-ledger-fixture-'));
 const filename = path.join(root, 'accounts.sqlite');
 const db = new DatabaseSync(filename);
 db.exec("CREATE TABLE AspNetUsers(Id TEXT PRIMARY KEY); INSERT INTO AspNetUsers VALUES('alice'),('bob'),('fixture-user');"); db.close();
 const ledger = new AILedger({ filename, account: async id => {
  ledger.db.prepare('INSERT OR IGNORE INTO AspNetUsers(Id) VALUES(?)').run(id);
  return { id, membership: { tier: 'pro', expiresAt: null }, features: [{ key: 'library.manage', allowed: true }] };
 } });
 return { ledger, root, async close() { ledger.close(); await fs.rm(root, { recursive: true, force: true }); } };
}
async function createStudioService(options) {
 const fixture = await ledgerFixture();
 try {
  const service = await require('../platform/studio-service.cjs').createStudioService({ ...options, ledger: fixture.ledger });
  let closed = false;
  return { ...service, async close() { if (closed) return; closed = true; await service.close(); await fs.rm(fixture.root, { recursive: true, force: true }); } };
 } catch (error) { await fixture.close(); throw error; }
}
module.exports = { ledgerFixture, createStudioService };
