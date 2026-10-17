const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { safePath, localFile } = require('./studio-engines.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const MAX = 1024 * 1024 * 1024;
async function createNativePatch(changes, engine) {
 const { createDelta, applyDelta } = await import('fossil-delta');
 if (!changes.length || changes.length > 12) throw new Error('原生资源修改数量无效');
 const outputs = [], targets = [], baseHashes = {};
 for (const [index, change] of changes.entries()) {
  const name = safePath(change.path), { before, after } = change;
  if (!Buffer.isBuffer(before) || !Buffer.isBuffer(after) || !before.length || !after.length || before.length > MAX || after.length > MAX || before.equals(after)) throw new Error('原生资源修改无效或超出 1 GB 限制');
  const delta = Buffer.from(createDelta(before, after));
  if (delta.length > 24 * 1024 * 1024 || !Buffer.from(applyDelta(before, delta, { verifyChecksum: true })).equals(after)) throw new Error('增量资源回读校验失败或修改量超过 24 MB');
  const payload = `patches/${index}.delta`;
  targets.push({ path: name, before: { size: before.length, sha256: sha(before) }, after: { size: after.length, sha256: sha(after) }, payload, sha256: sha(delta) });
  outputs.push({ name: payload, data: delta }); baseHashes[name] = sha(before);
 }
 const manifest = Buffer.from(JSON.stringify({ format: 'moddock-native-patch', version: 1, codec: 'fossil', engine, targets }, null, 2));
 outputs.push({ name: 'MODDOCK-NATIVE.json', data: manifest });
 return { outputs, baseHashes, generatedCaches: [], nativeManifestSha256: sha(manifest) };
}
async function materializeNativePatch(root, stage, profile, resolveTarget) {
 const bytes = await fs.readFile(await localFile(stage, 'MODDOCK-NATIVE.json'));
 if (bytes.length > 32768 || sha(bytes) !== profile.nativeManifestSha256) throw new Error('原生 Mod 清单与当前构建不一致');
 const manifest = JSON.parse(bytes);
 if (manifest.format !== 'moddock-native-patch' || manifest.version !== 1 || manifest.codec !== 'fossil' || !Array.isArray(manifest.targets) || !manifest.targets.length || manifest.targets.length > 12) throw new Error('原生 Mod 清单格式无效');
 const { getDeltaTargetSize, applyDelta } = await import('fossil-delta'), files = [], seen = new Set();
 for (const [index, entry] of manifest.targets.entries()) {
  const name = safePath(entry.path);
  if (seen.has(name.toLowerCase()) || entry.payload !== `patches/${index}.delta` || !/^[a-f0-9]{64}$/.test(entry.sha256) || ![entry.before, entry.after].every(value => value && /^[a-f0-9]{64}$/.test(value.sha256) && Number.isInteger(value.size) && value.size > 0 && value.size <= MAX) || profile.baseHashes?.[name] !== entry.before.sha256) throw new Error('原生 Mod 目标约束无效');
  seen.add(name.toLowerCase());
  const originalPath = await resolveTarget(root, name), stat = await fs.lstat(originalPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.before.size) throw new Error('游戏资源版本已变化：' + name);
  const original = await fs.readFile(originalPath);
  if (sha(original) !== entry.before.sha256) throw new Error('游戏资源版本已变化：' + name);
  const payloadPath = await localFile(stage, entry.payload), payloadStat = await fs.stat(payloadPath);
  if (payloadStat.size > 24 * 1024 * 1024) throw new Error('增量载荷超限');
  const delta = await fs.readFile(payloadPath);
  if (sha(delta) !== entry.sha256 || getDeltaTargetSize(delta) !== entry.after.size) throw new Error('增量资源摘要或输出长度不符');
  const result = Buffer.from(applyDelta(original, delta, { verifyChecksum: true }));
  if (result.length !== entry.after.size || sha(result) !== entry.after.sha256) throw new Error('重建后的游戏资源校验失败');
  const source = `_native/${index}.bin`; await fs.mkdir(path.join(stage, '_native'), { recursive: true }); await fs.writeFile(path.join(stage, source), result, { flag: 'wx' });
  files.push({ source, destination: name, sha256: entry.after.sha256, size: result.length });
 }
 return files;
}
async function originalBytes(root, name, predecessor, installersRoot) {
 root = await fs.realpath(root);
 const current = await fs.readFile(await localFile(root, name)), old = predecessor?.files.find(file => file.destination === name);
 if (!old) return { current, original: current };
 if (predecessor.root !== root || sha(current) !== (predecessor.status === 'enabled' ? old.sha256 : old.originalHash) || !old.originalHash || !installersRoot) throw new Error('上一版本原生资源无法安全还原为构建基线');
 const original = await fs.readFile(await localFile(installersRoot, `mods/${predecessor.id}/original/${old.index}`));
 if (sha(original) !== old.originalHash) throw new Error('上一版本的原文件备份已变化');
 return { current, original };
}
module.exports = { createNativePatch, materializeNativePatch, originalBytes };
