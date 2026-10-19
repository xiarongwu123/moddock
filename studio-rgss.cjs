const zlib = require('node:zlib');

const MAX = 1024 * 1024 * 1024;
const advance = key => (Math.imul(key, 7) + 3) >>> 0;
function marshalRead(bytes) {
 let at = 2; const objects = [], symbols = [];
 if (bytes[0] !== 4 || bytes[1] !== 8) throw new Error('RGSS 脚本数据库不是 Ruby Marshal 4.8');
 const take = length => { if (!Number.isSafeInteger(length) || length < 0 || at + length > bytes.length) throw new Error('Marshal 数据越界'); const result = bytes.subarray(at, at + length); at += length; return result; };
 const integer = () => {
  const c = take(1).readInt8(); if (!c) return 0; if (c > 4) return c - 5; if (c < -4) return c + 5;
  const data = take(Math.abs(c)); let n = c < 0 ? -1 : 0;
  for (let i = 0; i < data.length; i++) n = (n & ~(255 << (8 * i))) | (data[i] << (8 * i));
  return n;
 };
 function value(depth = 0) {
  if (depth > 24 || objects.length > 200000) throw new Error('Marshal 数据复杂度超限');
  const tag = take(1).toString();
  if (tag === '0') return null; if (tag === 'T') return true; if (tag === 'F') return false;
  if (tag === 'i') return integer();
  if (tag === '@') { const index = integer(); if (index < 0 || index >= objects.length) throw new Error('Marshal 对象引用无效'); return objects[index]; }
  if (tag === ';') { const index = integer(); if (index < 0 || index >= symbols.length) throw new Error('Marshal 符号引用无效'); return symbols[index]; }
  if (tag === ':') { const symbol = { symbol: take(integer()).toString('utf8') }; symbols.push(symbol); return symbol; }
  if (tag === '"') { const string = { bytes: take(integer()) }; objects.push(string); return string; }
  if (tag === '[') { const count = integer(); if (count < 0 || count > 50000) throw new Error('Marshal 数组超限'); const array = []; objects.push(array); for (let i = 0; i < count; i++) array.push(value(depth + 1)); return array; }
  if (tag === 'I') { const object = value(depth + 1), count = integer(); if (!object || !object.bytes || count < 0 || count > 16) throw new Error('Marshal 字符串属性无效'); object.ivars = []; for (let i = 0; i < count; i++) object.ivars.push([value(depth + 1), value(depth + 1)]); return object; }
  throw new Error('脚本数据库含不支持的 Marshal 类型：' + tag);
 }
 const result = value(); if (at !== bytes.length) throw new Error('Marshal 数据尾部异常'); return result;
}
function marshalWrite(object) {
 const chunks = [Buffer.from([4, 8])], objects = new Map(), symbols = new Map();
 const tag = text => chunks.push(Buffer.from(text));
 function integer(n) {
  if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) throw new Error('Marshal 整数超限');
  if (!n) return chunks.push(Buffer.from([0]));
  if (n > 0 && n < 123 || n < 0 && n > -124) return chunks.push(Buffer.from([(n + (n > 0 ? 5 : -5)) & 255]));
  let size = 4; while (size > 1 && (n >> ((size - 1) * 8)) === (n < 0 ? -1 : 0)) size--;
  const bytes = Buffer.alloc(size + 1); bytes[0] = (n < 0 ? -size : size) & 255; for (let i = 0; i < size; i++) bytes[i + 1] = (n >>> (8 * i)) & 255; chunks.push(bytes);
 }
 function value(v) {
  if (v === null) return tag('0'); if (v === true) return tag('T'); if (v === false) return tag('F'); if (typeof v === 'number') { tag('i'); return integer(v); }
  if (v.symbol !== undefined) { if (symbols.has(v.symbol)) { tag(';'); return integer(symbols.get(v.symbol)); } symbols.set(v.symbol, symbols.size); tag(':'); const b = Buffer.from(v.symbol); integer(b.length); chunks.push(b); return; }
  if (objects.has(v)) { tag('@'); return integer(objects.get(v)); } objects.set(v, objects.size);
  if (Array.isArray(v)) { tag('['); integer(v.length); v.forEach(value); return; }
  if (!Buffer.isBuffer(v.bytes)) throw new Error('Marshal 对象无效');
  if (v.ivars?.length) tag('I'); tag('"'); integer(v.bytes.length); chunks.push(v.bytes);
  if (v.ivars?.length) { integer(v.ivars.length); for (const pair of v.ivars) { value(pair[0]); value(pair[1]); } }
 }
 value(object); return Buffer.concat(chunks);
}
function scriptsRead(bytes) {
 const rows = marshalRead(bytes);
 if (!Array.isArray(rows) || !rows.length || rows.length > 20000) throw new Error('RGSS 脚本列表无效');
 return rows.map(row => {
  if (!Array.isArray(row) || row.length !== 3 || !Number.isInteger(row[0]) || !row[1]?.bytes || !row[2]?.bytes) throw new Error('RGSS 脚本条目格式无效');
  const data = zlib.inflateSync(row[2].bytes, { maxOutputLength: 2 * 1024 * 1024 });
  const declared = /(?:coding|encoding)\s*[:=]\s*([\w-]+)/i.exec(data.subarray(0, 200).toString('latin1'))?.[1];
  let source;
  for (const encoding of [...new Set([declared, 'utf-8', 'shift_jis', 'gbk'].filter(Boolean))]) { try { source = new TextDecoder(encoding, { fatal: true }).decode(data); break; } catch { /* Preserve compressed originals regardless of their source encoding. */ } }
  if (source === undefined) throw new Error('RGSS 脚本使用无法识别的文本编码');
  return { row, id: row[0], name: row[1].bytes.toString('utf8'), source };
 });
}
function scriptsPatch(bytes, name, code) {
 const entries = scriptsRead(bytes).filter(entry => !/^Moddock[a-f0-9]+$/.test(entry.name) || entry.name !== name);
 let at = entries.findIndex(entry => /^main$/i.test(entry.name.trim()));
 if (at < 0) at = entries.findIndex(entry => /(?:rgss_main|\bSceneManager\.run\b|\$scene\s*=\s*Scene_Title)/.test(entry.source));
 if (at < 0) throw new Error('未找到可确认的 Main 入口，不能保证新脚本被执行');
 const ids = new Set(entries.map(entry => entry.id)); let id = 1900000000; while (ids.has(id)) id++;
 const source = '# encoding: UTF-8\n' + code + '\n';
 const row = [id, { bytes: Buffer.from(name) }, { bytes: zlib.deflateSync(Buffer.from(source)) }];
 const rows = entries.map(entry => entry.row); rows.splice(at, 0, row);
 const output = marshalWrite(rows), checked = scriptsRead(output);
 if (checked.length !== rows.length || checked[at].source !== source || entries.some(entry => !checked.some(copy => copy.id === entry.id && copy.row[2].bytes.equals(entry.row[2].bytes)))) throw new Error('脚本数据库回读校验失败');
 return output;
}
function archivePath(bytes) {
 let decoded; try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { decoded = new TextDecoder('shift_jis', { fatal: true }).decode(bytes); }
 const name = decoded.replace(/\\/g, '/');
 require('./studio-engines.cjs').safePath(name); return name;
}
function cryptData(bytes, key) {
 const out = Buffer.alloc(bytes.length); let word = key;
 for (let i = 0; i < bytes.length; i++) { if (i && i % 4 === 0) word = advance(word); out[i] = bytes[i] ^ (word >>> ((i % 4) * 8) & 255); }
 return out;
}
function archiveRead(bytes) {
 if (bytes.length > MAX || bytes.length < 8 || bytes.toString('binary', 0, 7) !== 'RGSSAD\0' || ![1, 3].includes(bytes[7])) throw new Error('RGSS 归档头无效或大小超限');
 const version = bytes[7], entries = [], names = new Set(); let at = 8, key = 0xDEADCAFE;
 const read = () => { if (at + 4 > bytes.length) throw new Error('RGSS 归档索引越界'); const n = bytes.readUInt32LE(at); at += 4; return n; };
 if (version === 3) key = (Math.imul(read(), 9) + 3) >>> 0;
 while (at < bytes.length) {
  if (entries.length >= 100000) throw new Error('RGSS 归档文件数量超限');
  let offset, length, fileKey, nameLength;
  if (version === 3) {
   offset = (read() ^ key) >>> 0; if (!offset) break;
   length = (read() ^ key) >>> 0; fileKey = (read() ^ key) >>> 0; nameLength = (read() ^ key) >>> 0;
  } else { nameLength = (read() ^ key) >>> 0; key = advance(key); }
  if (!nameLength || nameLength > 4096 || at + nameLength > bytes.length) throw new Error('RGSS 文件名索引无效');
  const nameBytes = Buffer.alloc(nameLength);
  for (let i = 0; i < nameLength; i++) { nameBytes[i] = bytes[at++] ^ (version === 3 ? key >>> ((i % 4) * 8) & 255 : key & 255); if (version === 1) key = advance(key); }
  if (version === 1) { length = (read() ^ key) >>> 0; key = advance(key); fileKey = key; offset = at; at += length; }
  if (offset + length > bytes.length || offset < 8) throw new Error('RGSS 文件数据越界');
  const name = archivePath(nameBytes); if (names.has(name.toLowerCase())) throw new Error('RGSS 归档文件名重复'); names.add(name.toLowerCase());
  entries.push({ name, nameBytes, offset, length, key: fileKey, encrypted: bytes.subarray(offset, offset + length) });
 }
 if (version === 3 && entries.some(entry => entry.offset < at)) throw new Error('RGSS 数据与索引重叠');
 if (version === 1 && at !== bytes.length) throw new Error('RGSS 归档长度异常');
 return { version, seed: version === 3 ? bytes.readUInt32LE(8) : null, entries, read: entry => cryptData(entry.encrypted, entry.key) };
}
function archiveWrite(archive, replacements = new Map()) {
 const chunks = [Buffer.from('RGSSAD\0', 'binary'), Buffer.from([archive.version])]; let key = 0xDEADCAFE;
 const word = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); chunks.push(b); };
 if (archive.version === 3) {
  word(archive.seed); key = (Math.imul(archive.seed, 9) + 3) >>> 0;
  let offset = 12 + archive.entries.reduce((n, e) => n + 16 + e.nameBytes.length, 0) + 16; const data = [];
  for (const entry of archive.entries) {
   const replacement = replacements.get(entry.name), payload = replacement ? cryptData(replacement, entry.key) : entry.encrypted;
   word(offset ^ key); word(payload.length ^ key); word(entry.key ^ key); word(entry.nameBytes.length ^ key);
   chunks.push(Buffer.from(entry.nameBytes.map((c, i) => c ^ (key >>> ((i % 4) * 8) & 255)))); data.push(payload); offset += payload.length;
  }
  for (let i = 0; i < 4; i++) word(key); chunks.push(...data);
 } else for (const entry of archive.entries) {
  word(entry.nameBytes.length ^ key); key = advance(key);
  const name = Buffer.alloc(entry.nameBytes.length); for (let i = 0; i < name.length; i++) { name[i] = entry.nameBytes[i] ^ (key & 255); key = advance(key); } chunks.push(name);
  const replacement = replacements.get(entry.name); word((replacement ? replacement.length : entry.length) ^ key); key = advance(key);
  chunks.push(replacement ? cryptData(replacement, key) : entry.key === key ? entry.encrypted : cryptData(cryptData(entry.encrypted, entry.key), key));
 }
 const output = Buffer.concat(chunks); if (output.length > MAX) throw new Error('RGSS 归档大小超限');
 const checked = archiveRead(output);
 for (let i = 0; i < archive.entries.length; i++) {
  const expected = replacements.get(archive.entries[i].name) || archive.read(archive.entries[i]);
  if (checked.entries[i]?.name !== archive.entries[i].name || !checked.read(checked.entries[i]).equals(expected)) throw new Error('RGSS 归档重建后数据不一致');
 }
 return output;
}
module.exports = { marshalRead, marshalWrite, scriptsRead, scriptsPatch, archiveRead, archiveWrite, cryptData };
