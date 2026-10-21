const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
// Explicitly reviewed release formats. Never derive these from a release number.
const VERSIONS = Object.freeze({ '1.21': { data: 48, resource: 34 }, '1.21.4': { data: 61, resource: 46 }, '1.21.6': { data: 80, resource: 63 } });
const has = kind => ['minecraft-datapack', 'minecraft-resourcepack'].includes(kind);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function command(text) {
 for (const line of text.split(/\r?\n/)) {
  const value = line.trim(); if (!value || value.startsWith('#')) continue;
  if (!/^[a-z][a-z0-9_]*(?:\s|$)/.test(value)) throw new Error('mcfunction 命令不能带 / 前缀、宏或控制字符');
  if (/[\x00-\x08\x0b-\x1f]/.test(value)) throw new Error('mcfunction 含控制字符');
  const stack = []; let quote = null, escape = false;
  for (const char of value) {
   if (escape) { escape = false; continue; }
   if (quote) { if (char === '\\') escape = true; else if (char === quote) quote = null; continue; }
   if (char === '"' || char === "'") quote = char;
   else if (char === '{' || char === '[') stack.push(char);
   else if (char === '}' || char === ']') { if (stack.pop() !== (char === '}' ? '{' : '[')) throw new Error('mcfunction 括号不匹配'); }
  }
  if (quote || stack.length) throw new Error('mcfunction 字符串或括号未闭合');
 }
}
function texture(text) {
 const value = JSON.parse(text);
 if (!object(value.palette) || Object.keys(value.palette).length > 32 || !Array.isArray(value.rows) || value.rows.length !== 16 || value.rows.some(row => typeof row !== 'string' || !/^[\x21-\x7e]{16}$/.test(row))) throw new Error('贴图需为 16 行、每行 16 个调色板字符');
 const pixels = value.rows.map(row => [...row].map(key => Object.hasOwn(value.palette, key) ? value.palette[key] : null));
 return require('./content-pack.cjs').pngBytes(require('./studio-pixels.cjs').textureImage(pixels));
}
function validateSources(kind, files) {
 for (const file of files) {
  const name = file.name;
  if (kind === 'minecraft-datapack') {
   if (/^data\/__MODDOCK_ID__\/function\/[a-z0-9_/-]+\.mcfunction$/.test(name)) command(file.text);
   else if (/^data\/__MODDOCK_ID__\/(?:recipe|advancement|loot_table|predicate)\/[a-z0-9_/-]+\.json$/.test(name)) {
    const json = JSON.parse(file.text);
    if (!object(json) && !(name.includes('/predicate/') && Array.isArray(json))) throw new Error('数据包 JSON 根节点无效');
   } else throw new Error('数据包仅接受当前作品命名空间下的 function、recipe、advancement、loot_table、predicate；使用 1.21 单数目录');
  } else {
   if (/^assets\/(?:minecraft|__MODDOCK_ID__)\/textures\/(?:block|item)\/[a-z0-9_/-]+\.png\.json$/.test(name)) texture(file.text);
   else if (/^assets\/(?:minecraft|__MODDOCK_ID__)\/(?:lang|models|blockstates|items)\/[a-z0-9_/-]+\.json$/.test(name)) {
    const json = JSON.parse(file.text); if (!object(json)) throw new Error('资源包 JSON 根节点需为对象');
    if (name.includes('/lang/') && Object.values(json).some(value => typeof value !== 'string')) throw new Error('语言文件需为字符串映射');
   } else throw new Error('资源包仅接受 lang、models、blockstates、items JSON 和 textures/block|item 的 16×16 像素描述');
  }
 }
 if (kind === 'minecraft-datapack' && !files.some(file => file.name === 'data/__MODDOCK_ID__/function/load.mcfunction')) throw new Error('数据包需要实际的 function/load.mcfunction 入口');
}
function build(input, uid, files) {
 const format = VERSIONS[input.targetVersion]; if (!format) throw new Error('尚未核对该 Minecraft 版本的包格式；目前支持 ' + Object.keys(VERSIONS).join('、'));
 validateSources(input.kind, files);
 if (input.targetVersion === '1.21' && files.some(file => file.name.includes('/items/'))) throw new Error('1.21 尚未使用 1.21.4 的 items 资源模型格式，请按目标版本制作');
 const data = input.kind === 'minecraft-datapack', output = [];
 const add = (name, bytes) => output.push({ name: 'mod/' + name, data: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes) });
 add('pack.mcmeta', JSON.stringify({ pack: { pack_format: data ? format.data : format.resource, description: input.description || input.name } }, null, 2));
 for (const file of files) {
  const name = file.name.replaceAll('__MODDOCK_ID__', uid);
  if (name.endsWith('.png.json')) add(name.slice(0, -5), texture(file.text));
  else add(name, file.text.replaceAll('__MODDOCK_ID__', uid));
 }
 if (data) for (const entry of ['load', 'tick']) if (files.some(file => file.name === `data/__MODDOCK_ID__/function/${entry}.mcfunction`)) add(`data/minecraft/tags/function/${entry}.json`, JSON.stringify({ values: [uid + ':' + entry] }));
 return output;
}
async function ordinary(root, relative) {
 let current = root;
 for (const part of relative.split('/')) { current = path.join(current, part); if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Minecraft 版本路径包含链接'); }
 if (!(await fs.lstat(current)).isFile()) throw new Error('Minecraft 版本文件无效');
 return current;
}
async function evidence(root) {
 root = await fs.realpath(root); const documents = [];
 for (const id of Object.keys(VERSIONS)) {
  const rel = `versions/${id}/${id}.json`;
  try {
   const file = await ordinary(root, rel), stat = await fs.stat(file); if (stat.size > 128 * 1024) throw new Error('Minecraft 版本清单过大');
   const text = await fs.readFile(file, 'utf8'), value = JSON.parse(text);
   if (value.id !== id || value.mainClass !== 'net.minecraft.client.main.Main') continue;
   const jar = await fs.open(await ordinary(root, `versions/${id}/${id}.jar`), 'r');
   const magic = Buffer.alloc(4); try { await jar.read(magic, 0, 4, 0); } finally { await jar.close(); }
   if (!magic.equals(Buffer.from([0x50, 0x4b, 3, 4]))) throw new Error('Minecraft 客户端 JAR 不是 ZIP 容器');
   documents.push({ path: rel, text: JSON.stringify({ id: value.id, mainClass: value.mainClass }), complete: true, sha256: crypto.createHash('sha256').update(text).digest('hex') });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
 }
 return documents;
}
const GUIDE = `Minecraft Java only, not Bedrock/Forge/Fabric plugins. Exact targetVersion must be one of ${Object.keys(VERSIONS).join(', ')}; inspect available local version evidence. Write real files and validate_project before submission. Host supplies pack.mcmeta and datapack minecraft load/tick tags. Datapack files: data/__MODDOCK_ID__/function/*.mcfunction (mandatory load.mcfunction, optional tick.mcfunction), recipe/*.json, advancement/*.json, loot_table/*.json, predicate/*.json; 1.21 uses singular directory names. Commands have no leading slash. Resource files: assets/minecraft or assets/__MODDOCK_ID__ with lang/models/blockstates/items JSON. 16x16 texture source path ends textures/block|item/<name>.png.json and its text is JSON {palette:{singleASCII:'#rrggbb[aa]'},rows:[16 strings of exactly 16 palette symbols]}; host encodes actual PNG. Do not invent unsupported model formats, binary assets or game registries. These checks validate structure, not full command or game semantics. Datapacks export to ZIP for explicit target-world installation; never select or alter a save automatically. Resourcepacks can install into the verified Java instance resourcepacks folder; user activates in-game. No automatic options.txt edits. No automatic gameplay proof.`;
module.exports = { VERSIONS, has, command, texture, validateSources, build, evidence, GUIDE };
