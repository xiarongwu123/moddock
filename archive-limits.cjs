const GiB = 1024 ** 3;
const LIMITS = Object.freeze({
 downloadBytes: 128 * GiB,
 extractedBytes: 256 * GiB,
 fileBytes: 128 * GiB,
 entries: 200000,
 expansionRatio: 2000,
 ratioMinBytes: 1024 ** 2
});

function formatBytes(bytes) {
 const units = ['GiB', 'MiB', 'KiB'];
 for (let i = 0; i < units.length; i++) {
  const scale = 1024 ** (3 - i);
  if (bytes >= scale) return `${Number((bytes / scale).toFixed(2))} ${units[i]}（${bytes} 字节）`;
 }
 return `${bytes} 字节`;
}

function assertSize(size, limit, kind, name) {
 if (size > limit) throw new Error(`${kind}超限：${name}；实际 ${formatBytes(size)}，上限 ${formatBytes(limit)}`);
}

function checkArchiveEntry(entry, bytes, count) {
 const name = entry.fileName;
 if (count > LIMITS.entries) throw new Error(`压缩包条目数超限：${name}；当前 ${count} 个，上限 ${LIMITS.entries} 个（含目录）`);
 if (name.endsWith('/')) return;
 assertSize(entry.uncompressedSize, LIMITS.fileBytes, '单文件解压体积', name);
 assertSize(bytes, LIMITS.extractedBytes, '累计解压体积', name);
 const ratio = entry.uncompressedSize / Math.max(1, entry.compressedSize);
 if (entry.uncompressedSize > LIMITS.ratioMinBytes && ratio > LIMITS.expansionRatio) {
  throw new Error(`文件膨胀倍数超限：${name}；实际 ${ratio.toFixed(2)} 倍，上限 ${LIMITS.expansionRatio} 倍（压缩后 ${formatBytes(entry.compressedSize)}，解压后 ${formatBytes(entry.uncompressedSize)}）`);
 }
}

module.exports = { LIMITS, formatBytes, assertSize, checkArchiveEntry };
