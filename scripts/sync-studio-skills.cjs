const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const sources = [
 { id: 'minecraft', repo: 'adhi-jp/agent-skills', commit: 'd5bf6dcbb253a4193f28597aa96f8ad7bad7d96f', roots: ['skills/minecraft-modding-workbench/'] },
 { id: 'civ7', repo: 'chrislittle/civ7-modding-skill', commit: '5511937663bfc5c4f70bbd359bd94c6ff86546ab', roots: [''] },
 { id: 'ck3', repo: 'huangfanglong/CK3-Agent-Skills', commit: '34dc2e1fc072c29ca65b35ee584e4bc1f3af9027', roots: ['skills/ck3-modding-expert/'] },
 { id: 'game-modding', repo: 'SenjuWoo/Ultimate-AI-Starter-Bundle', commit: 'aaeb3b53e0515b5a3b1bec18a46c4414ed682514', roots: ['_CANONICAL-SKILLS/game-modding/', '_CANONICAL-SKILLS/unity-mod-frameworks/', '_CANONICAL-SKILLS/unreal-mod-frameworks/', '_CANONICAL-SKILLS/bethesda-creation-modding/', '_CANONICAL-SKILLS/paradox-modding/'] },
];
async function fetchBytes(url, max = 1024 * 1024) {
 const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'MODDOCK-skill-sync' } });
 if (!response.ok) throw new Error(`Skill source HTTP ${response.status}: ${url}`);
 const bytes = Buffer.from(await response.arrayBuffer());
 if (bytes.length > max) throw new Error('Skill source exceeds size limit');
 return bytes;
}
async function sync(destination = path.resolve(__dirname, '../vendor/studio-skills')) {
 await fs.mkdir(destination, { recursive: true });
 const manifest = { format: 1, sources: [] };
 for (const source of sources) {
  const tree = JSON.parse(await fetchBytes(`https://api.github.com/repos/${source.repo}/git/trees/${source.commit}?recursive=1`, 8 * 1024 * 1024));
  if (tree.truncated || !tree.tree) throw new Error('Incomplete skill source tree');
  const licensePath = tree.tree.find(file => /^LICENSE(?:\.md|\.txt)?$/i.test(file.path))?.path;
  if (!licensePath) throw new Error('Skill source requires an explicit license');
  const license = await fetchBytes(`https://raw.githubusercontent.com/${source.repo}/${source.commit}/${licensePath}`);
  if (!/MIT License|Permission is hereby granted, free of charge/i.test(license.toString())) throw new Error('Unexpected skill license');
  const files = tree.tree.filter(file => file.type === 'blob' && !file.path.split('/').some(part => part.startsWith('.')) && source.roots.some(root => file.path.startsWith(root)) && /\.(?:md|txt|json|csv|xml|sql)$/i.test(file.path));
  const hashes = {}; let total = 0;
  for (const file of files) {
   if (file.path.includes('..') || path.isAbsolute(file.path)) throw new Error('Unsafe skill path');
   const bytes = await fetchBytes(`https://raw.githubusercontent.com/${source.repo}/${source.commit}/${file.path}`);
   total += bytes.length; if (total > 8 * 1024 * 1024) throw new Error('Skill bundle exceeds size limit');
   const target = path.join(destination, source.id, file.path);
   await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes);
   hashes[file.path] = crypto.createHash('sha256').update(bytes).digest('hex');
  }
  await fs.writeFile(path.join(destination, source.id, 'LICENSE'), license);
  hashes.LICENSE = crypto.createHash('sha256').update(license).digest('hex');
  manifest.sources.push({ ...source, license: 'MIT', hashes });
  console.log(`${source.id}: ${files.length} reference files pinned to ${source.commit}`);
 }
 await fs.writeFile(path.join(destination, 'UPSTREAM.json'), JSON.stringify(manifest, null, 2) + '\n');
 return manifest;
}
if (require.main === module) sync(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { sync, sources };
