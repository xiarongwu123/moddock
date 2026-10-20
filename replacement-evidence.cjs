const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const key = value => value.normalize('NFC').toLowerCase();
const blocked = message => Object.assign(new Error(message), { code: 'AI_INSTALL_BLOCKED' });
const backupPart = /^(?:backups?|vanilla[ _-]?backup|original[ _-]?backup)$/i;
const backupPath = name => name.split('/').slice(0, -1).some(part => backupPart.test(part));
const forbiddenTree = /(?:^|\/)(?:backups?|saves?|saved|savedgames|savegames|screenshots|userdata|userfiles|\.git)(?:\/|$)/i;
const replacementType = /\.(?:bundle|xnb|dds|png|jpe?g|webp|tga|uasset|uexp|ubulk)$/i;

function backupEvidence(texts) {
 for (const item of texts) for (const line of item.text.split(/[\r\n]+/)) {
  const normalized = line.replace(/[()]/g, '');
  // "Back up your files" alone does not describe a supplied original backup.
  if (/backup\s+folder\s+of\s+(?:vanilla|original)\s+files?/i.test(normalized)) {
   const quote = line.match(/backup\s+folder\s+of\s+(?:vanilla|original)\s+file(?:\(s\)|s)?(?:\s+affected)?(?:\s+for\s+easy\s+uninstall)?/i)?.[0];
   if (quote) return { source: item.source, quote };
  }
 }
 return null;
}

function classifyFiles(files, texts) {
 const evidence = backupEvidence(texts), active = files.filter(file => !backupPath(file.path));
 const excludedFiles = [];
 for (const file of files.filter(file => backupPath(file.path))) {
  const parts = file.path.split('/'), index = parts.findIndex(part => backupPart.test(part));
  const suffix = key(parts.slice(index + 1).join('/'));
  const counterparts = active.filter(other => key(other.path).endsWith('/' + suffix));
  if (!evidence || !suffix.includes('/') || counterparts.length !== 1)
   throw blocked('包内备份文件缺少作者备份用途说明或唯一对应的模组文件，无法自动排除：' + file.path);
  excludedFiles.push({ source: file.path, reason: 'original-backup', counterpart: counterparts[0].path, evidence });
 }
 return { files: active, excludedFiles };
}

function validateExclusions(files, excludedFiles, texts) {
 if (!Array.isArray(excludedFiles)) throw blocked('备份排除记录无效');
 const expected = classifyFiles(files, texts).excludedFiles;
 if (expected.length !== excludedFiles.length || new Set(excludedFiles.map(row => row.source)).size !== expected.length)
  throw blocked('备份排除清单与实际安装包不一致');
 for (const row of expected) {
  const actual = excludedFiles.find(item => item.source === row.source);
  if (!actual || actual.reason !== row.reason || actual.counterpart !== row.counterpart ||
      actual.evidence?.source !== row.evidence.source || actual.evidence?.quote !== row.evidence.quote)
   throw blocked('备份排除依据与实际安装包不一致：' + row.source);
 }
 return new Set(expected.map(row => row.source));
}

async function uniqueMatches(game, files, { check = () => {}, maxEntries = 200000, maxDepth = 32 } = {}) {
 const root = await fs.realpath(game.installPath), wanted = new Set(files.map(file => key(path.posix.basename(file.path))));
 const candidates = new Map([...wanted].map(name => [name, []]));
 let count = 0;
 async function walk(directory, prefix = '', depth = 0) {
  check();
  if (depth > maxDepth) throw blocked('游戏目录过深，无法完整确认文件唯一性');
  const entries = await fs.opendir(directory);
  for await (const entry of entries) {
   check();
   if (++count > maxEntries) throw blocked('游戏目录超过扫描上限，无法完整确认文件唯一性');
   const rel = prefix + entry.name;
   if (entry.isSymbolicLink()) throw blocked('游戏目录包含链接，无法完整确认文件唯一性：' + rel);
   if (entry.isDirectory()) {
    if (!forbiddenTree.test(rel)) await walk(path.join(directory, entry.name), rel + '/', depth + 1);
   } else if (entry.isFile() && candidates.has(key(entry.name))) candidates.get(key(entry.name)).push(rel);
  }
 }
 await walk(root);
 return files.map(file => {
  const found = candidates.get(key(path.posix.basename(file.path))) || [];
  // Require both a unique name and the complete relative directory suffix.
  const destination = found.length === 1 ? found[0] : null;
  return { source: file.path, destination: destination && key(file.path).endsWith('/' + key(destination)) ? destination : null,
   candidates: found };
 });
}

async function replacementRule(game, files, texts, context, options = {}) {
 const classified = classifyFiles(files, texts), payload = classified.files;
 const joined = texts.map(item => item.text).join('\n');
 // Keep option installers, prohibited actions and explicit conflicting paths in the author/AI flow.
 if (!payload.length || payload.some(file => !replacementType.test(file.path)) ||
     !/replac|retextur|替换|重贴图/i.test(joined) ||
     /choose|only one|optional|do not|don't|never|fomod|mod\s*engine|texmod|只选|二选|可选|不要|禁止/i.test(joined) ||
     !/没有识别到明确的复制或解压目标目录/.test(context.matchError || '')) return null;
 const matches = await uniqueMatches(game, payload, options);
 if (matches.some(row => !row.destination)) {
  const failed = matches.find(row => !row.destination);
  const unresolved = matches.filter(row => !row.destination).length;
  throw blocked(`已核对 ${matches.length} 个安装文件：${matches.length - unresolved} 个匹配，${unresolved} 个待确认；已识别 ${classified.excludedFiles.length} 个原版备份。` +
   (failed.candidates.length > 1 ? '本机存在多个同名文件' : '本机缺少唯一且相对目录吻合的原文件，可能与当前游戏版本不同') +
   '：' + failed.source + '。已停止整个包的安装，请选择适配当前游戏版本的文件。');
 }
 const destinations = new Set(matches.map(row => key(row.destination)));
 if (destinations.size !== matches.length) throw blocked('多个包内文件映射到同一目标，可能包含版本选项，已停止安装');
 const baseHashes = {};
 for (const row of matches) {
  options.check?.();
  const hash = crypto.createHash('sha256');
  for await (const chunk of require('node:fs').createReadStream(path.join(game.installPath, row.destination))) { options.check?.(); hash.update(chunk); }
  baseHashes[row.destination] = hash.digest('hex');
 }
 return { id: 'local-file-replacement', name: '本机原文件唯一匹配', mode: 'copy', root: '', destination: '', sourcePrefix: '', requires: [],
  fileMappings: matches.map(({ source, destination }) => ({ source, destination })), baseHashes,
  excludedFiles: classified.excludedFiles,
  installationRule: { id: 'local-file-replacement', name: '本机原文件唯一匹配', origin: 'local-files', analyzedAt: new Date().toISOString(),
   modName: context.modName || null, sources: context.url ? [context.url] : [],
   instructions: texts.map(item => ({ source: item.source, excerpt: item.text })),
   excludedFiles: classified.excludedFiles,
   fileEvidence: matches.map(({ source, destination }) => ({ source, destination, kind: 'unique-existing-file', sha256: baseHashes[destination] })),
   notes: [`通过本机唯一同名文件及完整相对目录核对 ${matches.length} 个替换目标；排除 ${classified.excludedFiles.length} 个原版备份。覆盖前备份当前文件。游戏内效果仍需确认。`] } };
}

module.exports = { classifyFiles, validateExclusions, uniqueMatches, replacementRule };
