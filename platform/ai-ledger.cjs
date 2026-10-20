const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hasPro } = require('../ai-policy.cjs');
const fail = (code, status = 403) => { throw Object.assign(new Error(code), { code, status }); };
const integer = n => Number.isSafeInteger(n) && n >= 0;
const identity = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
class AILedger {
 constructor({ filename, account, clock = Date.now, lease = 360000 } = {}) {
  if (!filename || !path.isAbsolute(filename) || !account) throw new Error('AI ledger configuration required');
  this.account = account; this.clock = clock; this.lease = lease;
  this.db = new DatabaseSync(filename, { open: true });
  this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  // Refuse an empty/wrong database instead of creating an independent account store.
  this.db.prepare('SELECT Id FROM AspNetUsers LIMIT 1').get();
  this.db.exec(fs.readFileSync(path.join(__dirname, 'ai-ledger.sql'), 'utf8'));
 }
 transaction(fn) {
  this.db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); this.db.exec('COMMIT'); return result; }
  catch (error) { this.db.exec('ROLLBACK'); throw error; }
 }
 period(owner) {
  if (!identity(owner)) fail('invalid_request', 400);
  const date = new Date(this.clock());
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString();
  this.db.prepare('INSERT OR IGNORE INTO ModdockAiPeriods(owner,start,end,limit_tokens) VALUES(?,?,?,1000000)').run(owner, start, end);
  const period = this.db.prepare('SELECT * FROM ModdockAiPeriods WHERE owner=? AND start=?').get(owner, start);
  if (!period || period.end !== end || period.limit_tokens !== 1000000 || !integer(period.used) || !integer(period.reserved)) fail('ai_quota_unconfigured', 503);
  return period;
 }
 recover() {
  const rows = this.db.prepare("SELECT * FROM ModdockAiCalls WHERE state='reserved' AND expires<=?").all(this.clock());
  for (const row of rows) {
   this.db.prepare('UPDATE ModdockAiPeriods SET reserved=reserved-? WHERE owner=? AND start=?').run(row.input_budget + row.output_budget, row.owner, row.period);
   this.db.prepare("UPDATE ModdockAiCalls SET state='unresolved' WHERE id=?").run(row.id);
  }
 }
 quota(owner) {
  return this.transaction(() => {
   this.recover(); const row = this.period(owner);
   return { limitTokens: row.limit_tokens, usedTokens: row.used, periodStart: row.start, periodEnd: row.end,
    reservedTokens: row.reserved, reconciliationRequired: !!this.db.prepare("SELECT 1 FROM ModdockAiCalls WHERE owner=? AND state='unresolved' LIMIT 1").get(owner) };
  });
 }
 async reserve(owner, task, inputBudget, desiredOutput = 16384) {
  if (!identity(owner) || !identity(task) || !integer(inputBudget) || inputBudget > 128000 || !integer(desiredOutput) || desiredOutput < 1 || desiredOutput > 16384) fail('invalid_request', 400);
  let account;
  try { account = await this.account(owner); } catch { fail('ai_quota_unconfigured', 503); }
  if (account?.id !== owner || !hasPro(account, this.clock()) || account.features?.find(f => f.key === 'library.manage')?.allowed !== true) fail('pro_required');
  return this.transaction(() => {
   this.recover(); const row = this.period(owner);
   if (this.db.prepare("SELECT 1 FROM ModdockAiCalls WHERE owner=? AND state='unresolved' LIMIT 1").get(owner)) fail('ai_quota_unconfigured', 503);
   const available = row.limit_tokens - row.used - row.reserved;
   const outputBudget = Math.min(desiredOutput, available - inputBudget, 128000 - inputBudget);
   if (outputBudget < 1) fail('ai_credits_exhausted');
   const id = crypto.randomUUID(), now = this.clock();
   this.db.prepare('INSERT INTO ModdockAiCalls(id,owner,task,period,input_budget,output_budget,state,expires,created) VALUES(?,?,?,?,?,?,\'reserved\',?,?)').run(id, owner, task, row.start, inputBudget, outputBudget, now + this.lease, now);
   this.db.prepare('UPDATE ModdockAiPeriods SET reserved=reserved+? WHERE owner=? AND start=?').run(inputBudget + outputBudget, owner, row.start);
   return { id, outputBudget };
  });
 }
 identify(owner, task, id, providerId) {
  if (typeof providerId !== 'string' || !providerId || providerId.length > 256) fail('ai_quota_unconfigured', 503);
  const row = this.db.prepare('SELECT * FROM ModdockAiCalls WHERE id=? AND owner=? AND task=?').get(id, owner, task);
  if (!row || row.provider_id && row.provider_id !== providerId) fail('invalid_request', 409);
  this.db.prepare('UPDATE ModdockAiCalls SET provider_id=? WHERE id=?').run(providerId, id);
 }
 settle(owner, task, id, usage, providerId = null) {
  if (!usage || !integer(usage.inputTokens) || !integer(usage.outputTokens) || !integer(usage.inputTokens + usage.outputTokens)) fail('ai_quota_unconfigured', 503);
  return this.transaction(() => {
   const row = this.db.prepare('SELECT * FROM ModdockAiCalls WHERE id=?').get(id);
   if (!row || row.owner !== owner || row.task !== task) fail('invalid_request', 403);
   if (row.provider_id && row.provider_id !== providerId) fail('invalid_request', 409);
   if (row.state === 'settled') {
    if (row.input_tokens !== usage.inputTokens || row.output_tokens !== usage.outputTokens || row.provider_id !== providerId) fail('invalid_request', 409);
    return this.usage(owner, task);
   }
   if (providerId && this.db.prepare("SELECT 1 FROM ModdockAiCalls WHERE provider_id=? AND id<>? AND state='settled'").get(providerId, id)) fail('ai_quota_unconfigured', 503);
   this.db.prepare('UPDATE ModdockAiPeriods SET used=used+?, reserved=reserved-? WHERE owner=? AND start=?').run(usage.inputTokens + usage.outputTokens, row.state === 'reserved' ? row.input_budget + row.output_budget : 0, owner, row.period);
   this.db.prepare("UPDATE ModdockAiCalls SET state='settled',input_tokens=?,output_tokens=?,provider_id=? WHERE id=?").run(usage.inputTokens, usage.outputTokens, providerId, id);
   return this.usage(owner, task);
  });
 }
 unresolved(owner, task, id) {
  this.transaction(() => {
   const row = this.db.prepare('SELECT * FROM ModdockAiCalls WHERE id=? AND owner=? AND task=?').get(id, owner, task);
   if (!row) fail('invalid_request', 403);
   if (row.state !== 'reserved') return;
   this.db.prepare('UPDATE ModdockAiPeriods SET reserved=reserved-? WHERE owner=? AND start=?').run(row.input_budget + row.output_budget, owner, row.period);
   this.db.prepare("UPDATE ModdockAiCalls SET state='unresolved' WHERE id=?").run(id);
  });
 }
 usage(owner, task) {
  const row = this.db.prepare("SELECT COALESCE(SUM(input_tokens),0) AS inputTokens,COALESCE(SUM(output_tokens),0) AS outputTokens FROM ModdockAiCalls WHERE owner=? AND task=? AND state='settled'").get(owner, task);
  return { ...row };
 }
 close() { this.db.close(); }
}
module.exports = { AILedger };
