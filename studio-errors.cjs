const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function cleanDiagnostic(value, limit = 1600) {
 return String(value || '').replace(/Bearer\s+[^\s"']+|\bsk-[\w-]{8,}|\beyJ[\w-]+\.[\w-]+\.[\w-]+/gi, '[redacted]')
  .replace(/(["']?(?:api[_-]?key|token|password|secret|authorization)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[redacted]')
  .replace(/https?:\/\/[^\s"'<>]+/gi, value => { try { const url = new URL(value); return url.origin + url.pathname; } catch { return '[url]'; } })
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(0, limit);
}
function describeError(error, stage = 'creation', traceId = crypto.randomUUID()) {
 const causes = []; let current = error;
 for (let depth = 0; current && depth < 4; depth++, current = current.cause) causes.push(cleanDiagnostic((current.code ? current.code + ': ' : '') + (current.message || current.code || current)));
 const text = causes.join(' | '), status = Number(error?.status || /(?:HTTP|status(?: code)?)[\s:（(]*(\d{3})/i.exec(text)?.[1] || /\b(400|401|402|403|408|429|500|502|503|504)\b/.exec(text)?.[1]) || undefined;
 const category = error?.code === 'STUDIO_PERSIST_FAILED' ? 'storage' : /QUIC|net::ERR_|ECONN|UND_ERR_|fetch failed|terminated|socket/i.test(text) ? 'network'
  : status === 429 ? 'rate_limit' : status === 402 ? 'credits' : /timeout|timed out|超时/i.test(text) ? 'timeout'
  : /compile|syntax|编译|语法/i.test(text) ? 'compiler' : stage === 'model' ? 'model' : 'creation';
 return { traceId, stage, category, code: cleanDiagnostic(error?.code || error?.name || 'ERROR', 100), ...(status ? { upstreamStatus: status } : {}), reason: text || 'Unknown creation error', stack: cleanDiagnostic(error?.stack, 1200) };
}
function createStudioLogger(directory) {
 let queue = Promise.resolve();
 return { write(record) {
  if (!directory) return Promise.resolve();
  const entry = { at: new Date().toISOString(), ...record };
  queue = queue.catch(() => {}).then(async () => {
   await fs.mkdir(directory, { recursive: true, mode: 0o700 });
   const file = path.join(directory, 'creation-' + entry.at.slice(0, 10) + '.jsonl');
   try { if ((await fs.stat(file)).size > 8 * 1024 * 1024) await fs.rename(file, file + '.1'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
   await fs.appendFile(file, JSON.stringify(entry) + '\n', { mode: 0o600 });
  });
  queue.catch(() => {}); return queue;
 }, flush: () => queue };
}
module.exports = { cleanDiagnostic, describeError, createStudioLogger };
