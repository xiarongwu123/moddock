// Operator-only: never exposed by HTTP. Evidence must come from the provider.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { AILedger } = require('./ai-ledger.cjs');
const [database, evidenceFile] = process.argv.slice(2);
const evidenceBytes = fs.readFileSync(evidenceFile);
const evidence = JSON.parse(evidenceBytes);
if (!evidence.source || !evidence.providerId || !evidence.callId || !evidence.owner || !evidence.task) throw new Error('Provider evidence identity required');
const ledger = new AILedger({ filename: database, account: () => { throw new Error('Reconciliation cannot infer'); } });
try {
 const row = ledger.db.prepare("SELECT * FROM ModdockAiCalls WHERE id=? AND state='unresolved'").get(evidence.callId);
 if (!row || row.owner !== evidence.owner || row.task !== evidence.task) throw new Error('Unknown unresolved call');
 ledger.transaction(() => {
  ledger.db.prepare('UPDATE ModdockAiCalls SET evidence_sha256=? WHERE id=?').run(crypto.createHash('sha256').update(evidenceBytes).digest('hex'), evidence.callId);
 });
 const usage = ledger.settle(evidence.owner, evidence.task, evidence.callId, evidence.usage, evidence.providerId);
 console.log(JSON.stringify({ callId: evidence.callId, usage, reconciled: true }));
} finally { ledger.close(); }
