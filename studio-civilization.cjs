const crypto = require('node:crypto');
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const elements = node => Array.from(node.childNodes).filter(child => child.nodeType === 1);
function validateSources(files, checkXML) {
 for (const file of files) {
  if (!/^(?:data|text)\/[a-zA-Z0-9_-]+\.xml$/.test(file.name)) throw new Error('文明 6 此路线仅接受 data/*.xml 和 text/*.xml');
  const doc = checkXML(file.text), root = doc.documentElement, tables = elements(root);
  if (root.nodeName !== 'GameData' || !tables.length) throw new Error('文明 6 内容需有非空 GameData 根节点');
  for (const table of tables) {
   if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(table.nodeName) || !elements(table).length) throw new Error('文明 6 数据表或操作为空');
   if (file.name.startsWith('text/') && table.nodeName !== 'LocalizedText') throw new Error('文明 6 text 文件只允许 LocalizedText');
   for (const operation of elements(table)) {
    if (!['Row', 'Update', 'Delete', 'Replace'].includes(operation.nodeName)) throw new Error('文明 6 数据库 XML 操作无效');
    if (operation.nodeName === 'Update') {
     const nodes = elements(operation);
     if (nodes.length !== 2 || nodes.filter(node => node.nodeName === 'Where').length !== 1 || nodes.filter(node => node.nodeName === 'Set').length !== 1 || nodes.some(node => !node.attributes.length && !elements(node).length)) throw new Error('Update 需要非空 Where 和 Set，禁止无条件批量更新');
    } else if (!operation.attributes.length && !elements(operation).length) throw new Error('文明 6 数据操作缺少实际字段');
   }
  }
 }
}
function build(input, uid, files) {
 const uuid = uid.slice(8).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
 const cooked = files.map(file => ({ name: file.name, data: Buffer.from(file.text.replaceAll('__MODDOCK_ID__', uid)) }));
 const database = cooked.filter(file => file.name.startsWith('data/')), text = cooked.filter(file => file.name.startsWith('text/'));
 const actions = [[database, 'UpdateDatabase', 'database'], [text, 'UpdateText', 'text']].filter(([files]) => files.length).map(([files, action, suffix]) => `<${action} id="${uid}_${suffix}">${files.map(file => `<File>${file.name}</File>`).join('')}</${action}>`).join('\n');
 const metadata = `<Mod id="${uuid}" version="1"><Properties><Name>${escape(input.name)}</Name><Description>${escape(input.description || input.name)}</Description><Authors>${escape(input.author)}</Authors><CompatibleVersions>1.2,2.0</CompatibleVersions></Properties><InGameActions>${actions}</InGameActions><Files>${cooked.map(file => `<File md5="${crypto.createHash('md5').update(file.data).digest('hex')}">${file.name}</File>`).join('')}</Files></Mod>`;
 return [...cooked.map(file => ({ ...file, name: 'mod/' + file.name })), { name: `mod/${uid}.modinfo`, data: Buffer.from(metadata) }];
}
const GUIDE = 'Civilization VI database XML only, not Civ V/VII, Lua, DLLs, art or SQL. Write actual files in data/*.xml with GameData root and real database tables, Row/Replace/Delete or Update with both Where and Set. text/*.xml is GameData/LocalizedText only. Check base-game identifiers, table columns, expansion scopes and installed version from local evidence before use. Host creates a unique GUID .modinfo, InGameActions UpdateDatabase/UpdateText, file list and actual MD5 values. targetVersion is explicit numeric evidence, not Steam buildId. XML structural checks are not the game database semantic compiler. User enables this mod in Additional Content; no automatic changes to Mods.sqlite, AppOptions, saves or game databases. Use write_project_file then validate_project and submit actual source files, not a document.';
module.exports = { validateSources, build, GUIDE };
