const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { inflateSync } = require('node:zlib');
const MASTERS = Object.freeze({ 'skyrimse-esp': 'Data/Skyrim.esm', 'fallout4-esp': 'Data/Fallout4.esm' });
const has = kind => Object.hasOwn(MASTERS, kind || '');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const cache = new Map();
function changes(files) {
 if (files.length !== 1 || files[0].name !== 'changes.json') throw new Error('ESP 工程仅接受 changes.json');
 const input = JSON.parse(files[0].text), items = input?.changes;
 if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'changes') || !Array.isArray(items) || !items.length || items.length > 12) throw new Error('ESP changes 需为 1 至 12 条实际覆盖');
 const seen = new Set();
 return items.map(item => {
  if (!item || Object.keys(item).some(key => !['signature', 'editorId', 'value'].includes(key)) || !['GMST', 'GLOB'].includes(item.signature) || typeof item.editorId !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,119}$/.test(item.editorId) || !(typeof item.value === 'boolean' || typeof item.value === 'number' && Number.isFinite(item.value))) throw new Error('仅支持按真实 EditorID 修改 GMST/GLOB 数值或布尔值');
  const key = item.signature + ':' + item.editorId.toLowerCase(); if (seen.has(key)) throw new Error('ESP 重复覆盖同一记录'); seen.add(key);
  return { signature: item.signature, editorId: item.editorId, value: item.value };
 });
}
function subrecords(bytes) {
 const result = []; let offset = 0, extended;
 while (offset < bytes.length) {
  if (offset + 6 > bytes.length) throw new Error('ESP 子记录头越界');
  const signature = bytes.toString('ascii', offset, offset + 4), short = bytes.readUInt16LE(offset + 4); offset += 6;
  if (!/^[A-Z0-9_]{4}$/.test(signature)) throw new Error('ESP 子记录签名无效');
  if (signature === 'XXXX') { if (extended !== undefined || short !== 4 || offset + 4 > bytes.length) throw new Error('ESP 扩展长度无效'); extended = bytes.readUInt32LE(offset); offset += 4; continue; }
  const length = extended ?? short; extended = undefined;
  if (offset + length > bytes.length) throw new Error('ESP 子记录数据越界');
  result.push({ signature, offset, length, data: bytes.subarray(offset, offset + length) }); offset += length;
 }
 if (extended !== undefined) throw new Error('ESP 扩展长度缺少子记录');
 return result;
}
function single(parts, signature, length) {
 const matches = parts.filter(part => part.signature === signature);
 if (matches.length !== 1 || length !== undefined && matches[0].length !== length) throw new Error('ESP 字段缺失、重复或长度异常：' + signature);
 return matches[0];
}
function valueOf(record) {
 const parts = subrecords(record.data), edid = single(parts, 'EDID').data;
 if (!edid.length || edid.at(-1) !== 0) throw new Error('ESP EditorID 未正确结束');
 const editorId = edid.subarray(0, -1).toString('ascii'); if (!/^[A-Za-z_][A-Za-z0-9_]{0,119}$/.test(editorId)) throw new Error('ESP EditorID 无效');
 let type, field;
 if (record.signature === 'GLOB') { type = single(parts, 'FNAM', 1).data.toString('ascii'); if (!['s', 'l', 'f', 'b'].includes(type)) return null; field = single(parts, 'FLTV', 4); }
 else { type = editorId[0].toLowerCase(); if (!['i', 'f', 'b'].includes(type)) return null; field = single(parts, 'DATA', 4); }
 if (record.signature === 'GLOB' && !Number.isFinite(field.data.readFloatLE())) throw new Error('源全局变量不是有限数值');
 const value = record.signature === 'GLOB' ? type === 'b' ? !!field.data.readFloatLE() : field.data.readFloatLE() : type === 'f' ? field.data.readFloatLE() : type === 'b' ? !!field.data.readUInt32LE() : field.data.readInt32LE();
 if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('源游戏记录包含非有限数值');
 return { signature: record.signature, editorId, type, value, fieldOffset: field.offset, formId: record.header.readUInt32LE(12), recordSha256: digest(Buffer.concat([record.header, record.data])) };
}
async function ordinary(root, relative) {
 root = await fs.realpath(root); let file = root;
 for (const part of relative.split('/')) { file = path.join(file, part); if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('主文件路径包含链接'); }
 if (!(await fs.lstat(file)).isFile()) throw new Error('主文件不是普通文件'); return file;
}
async function readMaster(game, kind) {
 const relative = MASTERS[kind]; if (!relative) throw new Error('ESP 游戏类型无效');
 const file = await ordinary(game.installPath, relative), stat = await fs.stat(file), key = file + ':' + stat.size + ':' + stat.mtimeMs;
 if (cache.has(key)) return cache.get(key);
 if (stat.size < 24 || stat.size > 4 * 1024 ** 3) throw new Error('主文件体积不受支持');
 const handle = await fs.open(file, 'r');
 async function read(offset, length) {
  if (!Number.isSafeInteger(offset + length) || offset < 0 || length < 0 || offset + length > stat.size || length > 1024 * 1024) throw new Error('主文件记录边界或体积无效');
  const bytes = Buffer.alloc(length); let done = 0;
  while (done < length) { const result = await handle.read(bytes, done, length - done, offset + done); if (!result.bytesRead) throw new Error('读取主文件不完整'); done += result.bytesRead; }
  return bytes;
 }
 try {
  const header = await read(0, 24); if (header.toString('ascii', 0, 4) !== 'TES4' || header.readUInt32LE(12) !== 0) throw new Error('不是受支持的 TES4 主文件头');
  const parts = subrecords(await read(24, header.readUInt32LE(4))), hedr = single(parts, 'HEDR', 12).data;
  if (parts.some(part => part.signature === 'MAST') || !Number.isFinite(hedr.readFloatLE()) || hedr.readFloatLE() <= 0 || hedr.readFloatLE() > 2) throw new Error('此主文件头或依赖布局尚不支持');
  const records = [], groups = new Map(); let offset = 24 + header.readUInt32LE(4), total = 0, indexed = 0;
  while (offset < stat.size) {
   const group = await read(offset, 24); if (group.toString('ascii', 0, 4) !== 'GRUP') throw new Error('主文件顶层不是 GRUP');
   const size = group.readUInt32LE(4), signature = group.toString('ascii', 8, 12);
   if (size < 24 || offset + size > stat.size || group.readInt32LE(12) !== 0) throw new Error('主文件组边界无效');
   if (['GMST', 'GLOB'].includes(signature)) {
    if (groups.has(signature)) throw new Error('主文件包含重复的设置组'); groups.set(signature, group);
    let cursor = offset + 24;
    while (cursor < offset + size) {
     if (++indexed > 20000) throw new Error('设置记录超过本次索引上限');
     const recordHeader = await read(cursor, 24), length = recordHeader.readUInt32LE(4);
     if (recordHeader.toString('ascii', 0, 4) !== signature || cursor + 24 + length > offset + size || recordHeader.readUInt32LE(12) >>> 24) throw new Error('设置记录布局或主文件 FormID 不受支持');
     let data = await read(cursor + 24, length);
     if (recordHeader.readUInt32LE(8) & 0x40000) {
      if (data.length < 4 || data.readUInt32LE(0) > 1024 * 1024) throw new Error('设置记录解压长度无效');
      const expected = data.readUInt32LE(0); data = inflateSync(data.subarray(4), { maxOutputLength: 1024 * 1024 }); if (data.length !== expected) throw new Error('设置记录解压长度不一致');
     }
     total += data.length; if (total > 32 * 1024 * 1024) throw new Error('设置记录超过内存索引上限');
     if (!(recordHeader.readUInt32LE(8) & 0x20)) {
      const record = { signature, header: recordHeader, data }, info = valueOf(record);
      if (info && info.formId) records.push({ ...record, info });
     }
     cursor += 24 + length;
    }
   }
   offset += size;
  }
  const hash = crypto.createHash('sha256'), chunk = Buffer.alloc(1024 * 1024); let position = 0;
  while (position < stat.size) { const { bytesRead } = await handle.read(chunk, 0, chunk.length, position); if (!bytesRead) throw new Error('主文件摘要读取中断'); hash.update(chunk.subarray(0, bytesRead)); position += bytesRead; }
  const after = await handle.stat(); if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error('读取期间主文件发生变化，请重试');
  const result = { relative, sha256: hash.digest('hex'), header, hedr, records, groups };
  while (cache.size >= 2) cache.delete(cache.keys().next().value); cache.set(key, result); return result;
 } finally { await handle.close(); }
}
function sub(signature, bytes) { if (bytes.length > 65535) throw new Error('插件字段过长'); const header = Buffer.alloc(6); header.write(signature); header.writeUInt16LE(bytes.length, 4); return Buffer.concat([header, bytes]); }
function replacement(record, value) {
 const { signature, type, fieldOffset } = record.info, data = Buffer.from(record.data), numeric = typeof value === 'number';
 if (signature === 'GLOB' && type === 'b') {
  if (typeof value !== 'boolean') throw new Error('布尔 GLOB 需要 true 或 false'); data.writeFloatLE(value ? 1 : 0, fieldOffset);
 } else if (signature === 'GLOB' || type === 'f') {
  if (!numeric || !Number.isFinite(Math.fround(value))) throw new Error('此记录需要可表示的 float32 数值');
  if (signature === 'GLOB' && type !== 'f' && (!Number.isInteger(value) || value < (type === 's' ? -32768 : -2147483648) || value > (type === 's' ? 32767 : 2147483647) || Math.fround(value) !== value)) throw new Error('整数 GLOB 超出类型范围或精度');
  data.writeFloatLE(value, fieldOffset);
 } else if (type === 'b') { if (typeof value !== 'boolean') throw new Error('布尔 GMST 需要 true 或 false'); data.writeUInt32LE(value ? 1 : 0, fieldOffset); }
 else { if (!numeric || !Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new Error('整数 GMST 超出 int32 范围'); data.writeInt32LE(value, fieldOffset); }
 const header = Buffer.from(record.header); header.writeUInt32LE(data.length, 4); header.writeUInt32LE((header.readUInt32LE(8) & ~0x40000) >>> 0, 8);
 return { signature: record.signature, header, data };
}
async function compile(game, item) {
 const master = await readMaster(game, item.adapterId), requested = changes(item.draft.files), selected = [], outputGroups = [];
 for (const change of requested) {
  const matches = master.records.filter(record => record.signature === change.signature && record.info.editorId.toLowerCase() === change.editorId.toLowerCase());
  if (matches.length !== 1) throw new Error('主文件中未找到唯一记录：' + change.signature + ':' + change.editorId);
  const record = replacement(matches[0], change.value); selected.push({ ...record, info: valueOf(record) });
 }
 for (const signature of ['GMST', 'GLOB']) {
  const records = selected.filter(record => record.signature === signature); if (!records.length) continue;
  const header = Buffer.from(master.groups.get(signature)), data = Buffer.concat(records.flatMap(record => [record.header, record.data])); header.writeUInt32LE(data.length + 24, 4); outputGroups.push(Buffer.concat([header, data]));
 }
 const hedr = Buffer.from(master.hedr); hedr.writeUInt32LE(selected.length + outputGroups.length, 4); hedr.writeUInt32LE(0x800, 8);
 const data = Buffer.concat([sub('HEDR', hedr), sub('CNAM', Buffer.from(item.draft.author + '\0')), sub('SNAM', Buffer.from((item.draft.description || item.draft.name) + '\0')), sub('MAST', Buffer.from(path.posix.basename(master.relative) + '\0')), sub('DATA', Buffer.alloc(8))]);
 const header = Buffer.from(master.header); header.writeUInt32LE(data.length, 4); header.writeUInt32LE(0, 8); header.writeUInt32LE(0, 12);
 const bytes = Buffer.concat([header, data, ...outputGroups]);
 const verified = inspect(bytes);
 if (verified.records.length !== selected.length || selected.some(record => !verified.records.some(actual => actual.signature === record.signature && actual.formId === record.info.formId && actual.value === record.info.value))) throw new Error('ESP 回读记录与目标数值不一致');
 return { files: [{ name: item.manifest.UniqueID + '.esp', data: bytes }], master: { path: master.relative, sha256: master.sha256 }, records: verified.records };
}
function inspect(bytes) {
 if (bytes.length < 24 || bytes.toString('ascii', 0, 4) !== 'TES4' || bytes.readUInt32LE(8) !== 0) throw new Error('ESP 插件头无效');
 const end = 24 + bytes.readUInt32LE(4); if (end > bytes.length) throw new Error('ESP 头越界');
 const fields = subrecords(bytes.subarray(24, end)), hedr = single(fields, 'HEDR', 12).data, records = []; let offset = end, groups = 0;
 const master = single(fields, 'MAST').data.toString('utf8').replace(/\0$/, ''); single(fields, 'DATA', 8);
 while (offset < bytes.length) {
  if (offset + 24 > bytes.length || bytes.toString('ascii', offset, offset + 4) !== 'GRUP') throw new Error('ESP 组头无效');
  const size = bytes.readUInt32LE(offset + 4), signature = bytes.toString('ascii', offset + 8, offset + 12);
  if (size < 24 || offset + size > bytes.length || bytes.readInt32LE(offset + 12) !== 0 || !['GMST', 'GLOB'].includes(signature)) throw new Error('ESP 组边界或类型无效');
  groups++; let cursor = offset + 24;
  while (cursor < offset + size) {
   if (cursor + 24 > offset + size) throw new Error('ESP 记录头越界'); const header = bytes.subarray(cursor, cursor + 24), length = header.readUInt32LE(4);
   if (cursor + 24 + length > offset + size || header.toString('ascii', 0, 4) !== signature || header.readUInt32LE(8) & 0x40000 || header.readUInt32LE(12) >>> 24) throw new Error('ESP 记录边界或类型无效');
   const info = valueOf({ signature, header, data: bytes.subarray(cursor + 24, cursor + 24 + length) }); if (!info) throw new Error('ESP 含不支持的设置类型'); records.push(info); cursor += 24 + length;
  }
  offset += size;
 }
 if (!records.length || hedr.readUInt32LE(4) !== records.length + groups) throw new Error('ESP 记录计数不一致');
 return { master, records };
}
async function evidence(game, kind, query) {
 try {
  const master = await readMaster(game, kind), terms = require('./studio-native-evidence.cjs').termsFor(query);
  const records = master.records.map(record => record.info).filter(record => !terms.length || terms.some(term => (record.editorId + ' ' + record.signature).toLowerCase().includes(term)));
  return { master: { path: master.relative, sha256: master.sha256 }, total: records.length, records: records.slice(0, query ? 32 : 120), truncated: records.length > (query ? 32 : 120), runtimeVerified: false };
 } catch (error) { if (error.code === 'ENOENT') return { records: [], blocked: '未找到本机原版主文件：' + MASTERS[kind], runtimeVerified: false }; throw error; }
}
const GUIDE = 'Native ESP numeric override for Skyrim Special Edition or Fallout 4 only; no Lua, Papyrus, SKSE/F4SE, new forms, weapons, assets, quests, DLC masters or string GMST values. Write a single changes.json with {changes:[{signature:"GMST"|"GLOB",editorId:actual installed EditorID,value:finite number or boolean}]}, at most 12 changes. Inspect local Bethesda record evidence and search_api first; never invent FormIDs or EditorIDs. Host reads the original base ESM, preserves record headers, FormIDs and unrelated fields, changes only the typed numeric field, emits a standalone ESP with the correct master dependency and reads it back. Integer/boolean/float ranges are enforced against actual source types. The local master SHA256 is the compatibility baseline and must match at installation and enable. User activates the plugin in their normal game/mod manager; no automatic plugins.txt, INI, load-order or save edits. Use write_project_file, validate_project then submit actual files. This route cannot implement arbitrary new gameplay features, and file correctness is not in-game verification.';
module.exports = { MASTERS, has, changes, subrecords, valueOf, readMaster, compile, inspect, evidence, GUIDE };
