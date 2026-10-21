const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
function termsFor(query = '') {
 const text = String(query).toLowerCase(), terms = text.split(/[^a-z0-9_]+/).filter(term => term.length >= 3);
 for (const [word, translated] of [['跳跃', 'jump'], ['时间', 'timescale'], ['负重', 'carry'], ['训练', 'training'], ['伤害', 'damage'], ['速度', 'speed'], ['国策', 'focus'], ['事件', 'event'], ['决议', 'decision'], ['单位', 'unit'], ['建筑', 'building'], ['科技', 'technolog'], ['战士', 'warrior']]) if (text.includes(word)) terms.push(translated);
 return [...new Set(terms)].slice(0, 24);
}
async function collect(root, directories, query = '') {
 root = await fs.realpath(root); const inventory = [], documents = [], terms = termsFor(query); let visited = 0, truncated = false;
 async function directory(relative, depth = 0) {
  let current = root;
  try { for (const part of relative.split('/')) { current = path.join(current, part); if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('定义目录包含链接'); } }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of await fs.readdir(current, { withFileTypes: true })) {
   if (++visited > 2000) { truncated = true; return; }
   const name = relative + '/' + entry.name;
   if (entry.isSymbolicLink()) continue;
   if (entry.isDirectory() && depth < 1) await directory(name, depth + 1);
   else if (entry.isFile() && /\.(?:txt|xml)$/i.test(name) && inventory.length < 120) {
    const stat = await fs.lstat(path.join(root, name)); inventory.push({ path: name, bytes: stat.size });
   } else if (inventory.length >= 120) truncated = true;
  }
 }
 for (const name of directories) { if (visited > 2000) break; await directory(name); }
 let total = 0, reads = 0;
 const score = file => terms.reduce((count, term) => count + Number(file.path.toLowerCase().includes(term)), 0);
 const sources = [];
 for (const file of [...inventory].sort((a, b) => score(b) - score(a) || a.bytes - b.bytes)) {
  if (file.bytes > 512 * 1024 || ++reads > 24) { truncated = true; continue; }
  const bytes = await fs.readFile(path.join(root, file.path)); let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { truncated = true; continue; }
  if (text.includes('\0')) continue;
  const contentScore = score(file) + terms.reduce((n, term) => n + Number(text.toLowerCase().includes(term)), 0);
  sources.push({ file, text, score: contentScore, hash: crypto.createHash('sha256').update(bytes).digest('hex') });
 }
 for (const { file, text, hash } of sources.sort((a, b) => b.score - a.score || a.file.bytes - b.file.bytes)) {
  if (documents.length >= 4 || total >= 40 * 1024) { truncated = true; break; }
  const length = Math.min(12000, 40 * 1024 - total), bytes = Buffer.byteLength(text), complete = bytes <= length;
  let excerpt = text;
  if (!complete) {
   const lines = text.split(/\r?\n/), selected = [];
   for (let index = 0; index < lines.length; index++) if (terms.some(term => lines[index].toLowerCase().includes(term))) selected.push(...lines.slice(Math.max(0, index - 3), index + 6));
   excerpt = (selected.length ? selected.join('\n') : text).slice(0, Math.floor(length / 3));
  }
  total += Buffer.byteLength(excerpt); documents.push({ path: file.path, text: excerpt, complete, sha256: hash });
 }
 return { inventory, documents, truncated };
}
module.exports = { termsFor, collect };
