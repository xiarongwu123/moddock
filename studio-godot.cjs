const crypto = require('node:crypto');
function readPck(bytes) {
 if (bytes.length < 88 || bytes.length > 1024 ** 3) throw new Error('Godot 资源包大小无效');
 let start = 0;
 if (bytes.toString('ascii', 0, 4) !== 'GDPC') {
  if (bytes.toString('ascii', bytes.length - 4) !== 'GDPC') throw new Error('未找到 Godot 资源包头');
  const length = Number(bytes.readBigUInt64LE(bytes.length - 12)); start = bytes.length - 12 - length;
  if (!Number.isSafeInteger(length) || start < 0 || bytes.toString('ascii', start, start + 4) !== 'GDPC') throw new Error('内嵌 Godot 资源包长度无效');
 }
 const format = bytes.readUInt32LE(start + 4), version = [8, 12, 16].map(n => bytes.readUInt32LE(start + n)).join('.');
 if (![1, 2, 3, 4].includes(format) || start + (format >= 3 ? 104 : format === 2 ? 100 : 88) > bytes.length) throw new Error('尚未支持此 Godot PCK 格式或文件头长度无效：' + format);
 const flags = format >= 2 ? bytes.readUInt32LE(start + 20) : 0;
 if (flags & 1) throw new Error('此 Godot 资源索引已加密，缺少游戏作者提供的解密入口');
 if (flags & 4) throw new Error('此 Godot 资源包使用外部稀疏资源，不能按完整 PCK 重建');
 const base = format >= 2 ? Number(bytes.readBigUInt64LE(start + 24)) + (format >= 3 || flags & 2 ? start : 0) : 0;
 const directory = format >= 3 ? start + Number(bytes.readBigUInt64LE(start + 32)) : start + (format === 2 ? 96 : 84);
 if (!Number.isSafeInteger(base) || !Number.isSafeInteger(directory) || directory < start || directory + 4 > bytes.length) throw new Error('PCK 数据或目录偏移无效');
 let at = directory;
 const u32 = () => { if (at + 4 > bytes.length) throw new Error('PCK 索引越界'); const n = bytes.readUInt32LE(at); at += 4; return n; };
 const u64 = () => { if (at + 8 > bytes.length) throw new Error('PCK 索引越界'); const n = Number(bytes.readBigUInt64LE(at)); at += 8; if (!Number.isSafeInteger(n)) throw new Error('PCK 偏移超限'); return n; };
 const count = u32(), files = new Map();
 if (count > 200000) throw new Error('PCK 文件数量超限');
 for (let i = 0; i < count; i++) {
  const length = u32(); if (!length || length > 4096 || at + length + 32 > bytes.length) throw new Error('PCK 文件名或索引长度无效');
  const name = bytes.subarray(at, at + length).toString('utf8').replace(/\0+$/, '').replace(/^res:\/\//, ''); at += length;
  const offset = u64() + base, size = u64(), md5 = bytes.subarray(at, at + 16).toString('hex'); at += 16;
  const fileFlags = format >= 2 ? u32() : 0;
  require('./studio-engines.cjs').safePath(name);
  if (fileFlags || offset + size > bytes.length || files.has(name)) throw new Error('PCK 文件条目加密、重名或越界：' + name);
  const data = bytes.subarray(offset, offset + size);
  if (crypto.createHash('md5').update(data).digest('hex') !== md5) throw new Error('PCK 文件摘要不符：' + name);
  files.set(name, { name, offset, size, md5, data });
 }
 const headerEnd = start + (format >= 3 ? 104 : format === 2 ? 100 : 88);
 if ([...files.values()].some(file => file.size && (file.offset < headerEnd || file.offset < at && file.offset + file.size > directory))) throw new Error('PCK 数据与索引重叠');
 return { format, version, start, files };
}
function addAutoload(config, name, resource) {
 if (!/^[A-Za-z][A-Za-z0-9]+$/.test(name) || !/^res:\/\/moddock\/[A-Za-z0-9]+\/main\.gdc$/.test(resource)) throw new Error('Godot 加载入口无效');
 const line = name + '=' + JSON.stringify('*' + resource) + '\n';
 if (new RegExp('^' + name + '=', 'm').test(config)) throw new Error('Godot 加载入口已存在');
 const section = /^\[autoload\][ \t]*\r?$/m.exec(config);
 if (!section) return config.trimEnd() + '\n\n[autoload]\n' + line;
 return config.slice(0, section.index + section[0].length) + '\n' + line + config.slice(section.index + section[0].length);
}
module.exports = { readPck, addAutoload };
