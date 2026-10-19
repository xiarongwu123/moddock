const crypto = require('node:crypto');

// LSPK v18 layout: Norbyte/lslib, LS/PackageFormat.cs and PackageWriter.cs.
const HEADER = 40, ENTRY = 272, MAX = 8 * 1024 * 1024;
function safeName(name) {
 if (typeof name !== 'string' || name.length > 240 || !/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('PAK 文件路径无效');
 return name;
}
function archiveHash(files) {
 const hash = crypto.createHash('md5'); for (const file of files) hash.update(file.data);
 return Buffer.from(hash.digest().map(byte => (byte + 1) & 255));
}
function literalBlock(bytes) {
 const extra = [], length = bytes.length;
 if (length >= 15) { let rest = length - 15; while (rest >= 255) { extra.push(255); rest -= 255; } extra.push(rest); }
 return Buffer.concat([Buffer.from([(Math.min(15, length) << 4), ...extra]), bytes]);
}
function decodeBlock(bytes, size) {
 if (size > MAX) throw new Error('PAK 索引超过限制');
 const out = Buffer.alloc(size); let input = 0, output = 0;
 const length = initial => { let n = initial; if (n === 15) { let next; do { if (input >= bytes.length) throw new Error('PAK LZ4 长度无效'); next = bytes[input++]; n += next; } while (next === 255); } return n; };
 while (input < bytes.length) {
  const token = bytes[input++], literals = length(token >> 4);
  if (input + literals > bytes.length || output + literals > size) throw new Error('PAK LZ4 字面量越界');
  bytes.copy(out, output, input, input + literals); input += literals; output += literals;
  if (input === bytes.length) break;
  if (input + 2 > bytes.length) throw new Error('PAK LZ4 偏移无效');
  const offset = bytes.readUInt16LE(input); input += 2; const count = length(token & 15) + 4;
  if (!offset || offset > output || output + count > size) throw new Error('PAK LZ4 匹配越界');
  for (let i = 0; i < count; i++) { out[output] = out[output - offset]; output++; }
 }
 if (output !== size) throw new Error('PAK 索引长度不匹配');
 return out;
}
function writePak(input) {
 if (!Array.isArray(input) || !input.length || input.length > 64) throw new Error('PAK 需包含 1 至 64 个文件');
 const files = input.map(file => ({ name: safeName(file.name), data: Buffer.from(file.data) })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
 if (new Set(files.map(file => file.name.toLowerCase())).size !== files.length || files.reduce((sum, file) => sum + file.data.length, 0) > MAX / 2) throw new Error('PAK 文件重复或大小超过限制');
 const chunks = [], table = Buffer.alloc(files.length * ENTRY); let offset = HEADER;
 for (const [index, file] of files.entries()) {
  const entry = table.subarray(index * ENTRY, (index + 1) * ENTRY);
  entry.write(file.name, 0, 255, 'utf8'); entry.writeUInt32LE(offset, 256); entry.writeUInt32LE(file.data.length, 264);
  chunks.push(file.data); offset += file.data.length;
  const padding = (64 - (offset - HEADER) % 64) % 64; chunks.push(Buffer.alloc(padding, 0xad)); offset += padding;
 }
 const compressed = literalBlock(table), index = Buffer.alloc(8);
 index.writeUInt32LE(files.length); index.writeUInt32LE(compressed.length, 4);
 const header = Buffer.alloc(HEADER); header.write('LSPK'); header.writeUInt32LE(18, 4); header.writeBigUInt64LE(BigInt(offset), 8);
 header.writeUInt32LE(index.length + compressed.length, 16); archiveHash(files).copy(header, 22); header.writeUInt16LE(1, 38);
 return Buffer.concat([header, ...chunks, index, compressed]);
}
function readPak(bytes) {
 if (!Buffer.isBuffer(bytes) || bytes.length < HEADER + 8 || bytes.length > MAX || bytes.toString('ascii', 0, 4) !== 'LSPK' || bytes.readUInt32LE(4) !== 18 || bytes[20] !== 0 || bytes.readUInt16LE(38) !== 1) throw new Error('需要单卷 LSPK v18 Mod 包');
 const listOffset = Number(bytes.readBigUInt64LE(8)), listSize = bytes.readUInt32LE(16);
 if (!Number.isSafeInteger(listOffset) || listOffset < HEADER || listOffset + listSize !== bytes.length || listSize < 8) throw new Error('PAK 索引位置无效');
 const count = bytes.readUInt32LE(listOffset), compressedSize = bytes.readUInt32LE(listOffset + 4);
 if (!count || count > 64 || compressedSize !== listSize - 8) throw new Error('PAK 索引数量或大小无效');
 const table = decodeBlock(bytes.subarray(listOffset + 8), count * ENTRY), files = [], names = new Set(), ranges = [];
 for (let i = 0; i < count; i++) {
  const entry = table.subarray(i * ENTRY, (i + 1) * ENTRY), nul = entry.subarray(0, 256).indexOf(0);
  if (nul < 1 || entry[262] !== 0 || entry[263] !== 0 || entry.readUInt32LE(268) !== 0) throw new Error('PAK 条目压缩或卷编号不受支持');
  const name = safeName(entry.toString('utf8', 0, nul)), offset = entry.readUInt32LE(256) + entry.readUInt16LE(260) * 0x100000000, size = entry.readUInt32LE(264);
  if (names.has(name.toLowerCase()) || offset < HEADER || offset + size > listOffset || ranges.some(range => offset < range.end && offset + size > range.start)) throw new Error('PAK 条目重复或数据越界');
  names.add(name.toLowerCase()); ranges.push({ start: offset, end: offset + size }); files.push({ name, data: bytes.subarray(offset, offset + size) });
 }
 if (!archiveHash(files).equals(bytes.subarray(22, 38))) throw new Error('PAK 内容摘要不匹配');
 return { version: 18, md5: bytes.subarray(22, 38).toString('hex'), files };
}
module.exports = { writePak, readPak };
