const { crc32 } = require('node:zlib');
const { inflateSync } = require('node:zlib');

const NPCS = ['Abigail', 'Alex', 'Elliott', 'Emily', 'Haley', 'Harvey', 'Leah', 'Maru', 'Penny', 'Sam', 'Sebastian', 'Shane'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function text(value, name, max) {
 if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error(`${name}不能为空或超过 ${max} 字`);
 return value.trim();
}
function pngBytes(value) {
 if (typeof value !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value) || value.length > 90000) throw new Error('请选择 16 × 16 的 PNG 武器贴图');
 const bytes = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
 if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('PNG 文件头无效');
 let cursor = 8, header, ended = false;
 const data = [];
 while (cursor + 12 <= bytes.length) {
  const length = bytes.readUInt32BE(cursor), type = bytes.toString('ascii', cursor + 4, cursor + 8), end = cursor + 12 + length;
  if (end > bytes.length || crc32(bytes.subarray(cursor + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw new Error('PNG 数据校验失败');
  const chunk = bytes.subarray(cursor + 8, end - 4);
  if (cursor === 8 && type !== 'IHDR') throw new Error('PNG 缺少图像头');
  if (type === 'IHDR') {
   if (header || length !== 13 || chunk.readUInt32BE(0) !== 16 || chunk.readUInt32BE(4) !== 16 || chunk[8] !== 8 || ![2,6].includes(chunk[9]) || chunk[10] || chunk[11] || chunk[12]) throw new Error('贴图需为 16 × 16、8 位 RGB/RGBA PNG');
   header = chunk;
  } else if (type === 'IDAT') data.push(chunk);
  else if (type === 'IEND') { if (length) throw new Error('PNG 结束标记无效'); ended = true; cursor = end; break; }
  else if (!['sRGB','gAMA','pHYs','tEXt','iTXt'].includes(type)) throw new Error('不支持此 PNG 编码，请重新导出普通 PNG');
  cursor = end;
 }
 if (!header || !ended || cursor !== bytes.length || !data.length) throw new Error('PNG 内容不完整');
 const stride = 16 * (header[9] === 6 ? 4 : 3) + 1;
 const raw = inflateSync(Buffer.concat(data), { maxOutputLength: stride * 16 });
 if (raw.length !== stride * 16 || Array.from({ length: 16 }, (_, row) => raw[row * stride]).some(filter => filter > 4)) throw new Error('PNG 像素数据无效');
 return bytes;
}
function buildContentPack(input, id) {
 if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('内容包草稿无效');
 const name = text(input.name, '内容包名称', 60), author = text(input.author, '作者', 60);
 const description = text(input.description || '使用游匣内容包工作台制作', '介绍', 240);
 const manifest = { Name: name, Author: author, Version: '1.0.0', Description: description,
  UniqueID: 'Moddock.Creation' + id.replaceAll('-', ''), MinimumApiVersion: '4.0.0',
  ContentPackFor: { UniqueID: 'Pathoschild.ContentPatcher', MinimumVersion: '2.0.0' }, UpdateKeys: [] };
 let changes, draft, summary;
 const assets = [];
 if (input.kind === 'dialogue') {
  if (!NPCS.includes(input.npc)) throw new Error('请选择支持的原版角色');
  if (!input.entries || typeof input.entries !== 'object' || Array.isArray(input.entries)) throw new Error('请填写至少一天的对话');
  const entries = {};
  for (const [day, line] of Object.entries(input.entries)) {
   if (!DAYS.includes(day)) throw new Error('对话模板只支持星期一至星期日');
   if (!line) continue;
   entries[day] = text(line, '对话', 500);
   if (/[{}]|\$[a-z]|[#^]/i.test(entries[day])) throw new Error('第一版请使用普通对话文本，不包含指令、分支或动态标记');
  }
  if (!Object.keys(entries).length) throw new Error('请填写至少一天的对话');
  changes = [{ Action: 'EditData', Target: 'Characters/Dialogue/' + input.npc, Entries: entries }];
  draft = { kind: 'dialogue', name, author, description, npc: input.npc, entries };
  summary = `${input.npc} · ${Object.keys(entries).length} 天日常对话`;
 } else if (input.kind === 'texture') {
  const image = pngBytes(input.image);
  assets.push({ name: 'assets/weapon.png', data: image });
  // A dedicated texture avoids assuming the vanilla spritesheet index or overwriting another weapon.
  changes = [{ Action: 'Load', Target: manifest.UniqueID + '/Weapon', FromFile: 'assets/weapon.png' },
   { Action: 'EditData', Target: 'Data/Weapons', Fields: { '0': { Texture: manifest.UniqueID + '/Weapon', SpriteIndex: 0 } } }];
  draft = { kind: 'texture', name, author, description, image: input.image };
  summary = '生锈的剑 · 16 × 16 自定义贴图';
 } else throw new Error('不支持的内容包模板');
 const content = { Format: '2.0.0', Changes: changes };
 const readme = `${name}\n作者：${author}\n${description}\n\n适用：Stardew Valley 1.6、SMAPI 4+、Content Patcher 2+。\n安装：将本包放入 Mods，或通过游匣的安装预览部署。\n范围：${summary}。其他 Mod 可能修改同一游戏内容，请在游戏内核对。\n停用或卸载：使用游匣 Mod 管理；本包不修改存档和原始 XNB 文件。\nAI：只有实际使用 AI 服务生成草稿时才标记为 AI 草稿；手动编辑不代表 AI 生成。\n`;
 const files = [{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) },
  { name: 'content.json', data: Buffer.from(JSON.stringify(content, null, 2)) }, { name: 'README.txt', data: Buffer.from(readme) }, ...assets];
 return { manifest, content, draft, summary, files };
}
function zipContent(files) {
 let offset = 0;
 const locals = [], directory = [];
 for (const file of files) {
  const name = Buffer.from(file.name), data = file.data, crc = crc32(data), local = Buffer.alloc(30), central = Buffer.alloc(46);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
  locals.push(local, name, data); directory.push(central, name); offset += local.length + name.length + data.length;
 }
 const cd = Buffer.concat(directory), end = Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
 return Buffer.concat([...locals, cd, end]);
}
module.exports = { buildContentPack, zipContent, pngBytes, NPCS, DAYS };
