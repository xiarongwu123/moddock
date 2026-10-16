const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const { readPak } = require('./larian-pak.cjs');
const { controlsRuntime } = require('./bg3-controls.cjs');

const VERSION = '36028797018963969';
const AI_GUIDE = `BG3 host adapter: bg3-lua creates a real Script Extender server Lua mod, packages meta.lsx + ScriptExtender/Config.json + BootstrapServer.lua into LSPK v18 and installs to the user Mods folder with Public load order management. Missing Script Extender is an installation prerequisite, not a reason to return a document.
API evidence: Norbyte/bg3se Docs/API.md (Ext.Events.SessionLoaded:Subscribe, Ext.Utils.Print, Ext.Entity.Get, mod-local PersistentVars); Liareth BG3 HF4 exported Osiris signatures (GetHostCharacter(), GetTemplate(object)->template UUID, Exists(object)->integer, CreateAtObject(template,anchor,temporary,playSpawn,spawnFinishEvent STRING,matchOrientation)->object UUID, SetStoryDisplayName(object,name STRING), AddPartyFollower(follower,leader), RemovePartyFollower(follower,leader)).
For a basic custom follower, choose original creative name and greeting, register SessionLoaded, get the host and its real template at runtime, create a new actor beside it using CreateAtObject(template,host,0,0,"",1), name it and add it as a party follower. Save the created GUID in mod-local PersistentVars and check Exists before creating another after reload. Validate host/template/created GUIDs and report errors rather than silently pretending success. This reuses the current player's existing model/template; it does NOT produce new ethnic facial features, a new mesh, Hanfu assets, voice, origin selection, recruitment dialogue trees, approval or a full story companion. State these limits plainly in the summary. Never invent template UUIDs or claim those assets were made. If the player wants new visuals, ask for an existing installed asset mod rather than promise new 3D production. The host handles metadata, packing, installation and a per-artifact initialization log; do not write files or configure loading yourself.`;
const isBG3 = game => String(game.appId) === '1086940' || /^(?:Baldur.?s Gate 3|博德之门\s*3)(?:\s*\[TEST\])?$/i.test(game.searchName || game.name || '');
const xml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
function parseXML(text) {
 if (typeof text !== 'string' || Buffer.byteLength(text) > 256 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('LSX 文件过大或包含不支持的声明');
 return new DOMParser({ onError: () => { throw new Error('LSX XML 结构无效'); } }).parseFromString(text.replace(/^\uFEFF/, ''), 'application/xml');
}
const children = (node, tag) => Array.from(node.childNodes || []).filter(child => child.nodeType === 1 && (!tag || child.tagName === tag));
function one(nodes, message) { if (nodes.length !== 1) throw new Error(message); return nodes[0]; }
function value(node, id) { return children(node, 'attribute').find(attribute => attribute.getAttribute('id') === id)?.getAttribute('value'); }
function group(parent, id) { return one(children(parent, 'node').filter(node => node.getAttribute('id') === id), 'LSX 缺少唯一节点：' + id); }
function container(node, create = false) {
 const found = children(node, 'children');
 if (!found.length && create) { const child = node.ownerDocument.createElement('children'); node.appendChild(child); return child; }
 return one(found, 'LSX children 结构不明确');
}
function moduleInfo(manifest) {
 if (!manifest || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(manifest.UUID || '') || !/^[A-Za-z0-9_]{1,80}$/.test(manifest.Folder || '') || typeof manifest.Name !== 'string' || !manifest.Name.trim() || manifest.Name.length > 60 || !/^\d{1,19}$/.test(manifest.Version64 || '') || BigInt(manifest.Version64) > 0x7fffffffffffffffn || typeof manifest.MD5 !== 'string' || manifest.MD5 !== '' && !/^[a-f0-9]{32}$/i.test(manifest.MD5)) throw new Error('BG3 模块元数据无效');
 return { UUID: manifest.UUID.toLowerCase(), Folder: manifest.Folder, Name: manifest.Name, Version64: manifest.Version64, MD5: manifest.MD5.toLowerCase() };
}
function readModule(bytes) {
 const pak = readPak(bytes), meta = pak.files.filter(file => /^Mods\/[A-Za-z0-9_]+\/meta\.lsx$/.test(file.name));
 if (meta.length !== 1) throw new Error('BG3 包需包含唯一 meta.lsx');
 const document = parseXML(meta[0].data.toString('utf8'));
 const info = one(Array.from(document.getElementsByTagName('node')).filter(node => node.getAttribute('id') === 'ModuleInfo'), 'BG3 缺少唯一 ModuleInfo');
 const module = moduleInfo({ UUID: value(info, 'UUID'), Folder: value(info, 'Folder'), Name: value(info, 'Name'), Version64: value(info, 'Version64'), MD5: value(info, 'MD5') || '' });
 if (meta[0].name !== 'Mods/' + module.Folder + '/meta.lsx' || pak.files.some(file => !file.name.startsWith('Mods/' + module.Folder + '/') && !file.name.startsWith('Public/' + module.Folder + '/') && !file.name.startsWith('Localization/'))) throw new Error('BG3 包模块目录不一致');
 return { module, files: pak.files };
}
function settingsTree(text) {
 const document = parseXML(text), region = one(Array.from(document.getElementsByTagName('region')).filter(node => node.getAttribute('id') === 'ModuleSettings'), '未找到唯一 ModuleSettings，请先运行游戏创建 Public 配置');
 const root = container(group(region, 'root')), mods = container(group(root, 'Mods'), true);
 const orderNodes = children(root, 'node').filter(node => node.getAttribute('id') === 'ModOrder');
 if (orderNodes.length > 1) throw new Error('加载顺序存在重复 ModOrder');
 const order = orderNodes.length ? container(orderNodes[0], true) : null;
 const nodes = children(mods, 'node');
 if (!nodes.some(node => /^Gustav(?:Dev)?$/i.test(value(node, 'Folder') || ''))) throw new Error('加载顺序缺少主战役，已停止以保留现有配置');
 for (const list of [nodes, order ? children(order, 'node') : []]) { const ids = list.map(node => value(node, 'UUID')?.toLowerCase()); if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('加载顺序 UUID 缺失或重复'); }
 return { document, root, mods, order };
}
function editLoadOrder(text, operations) {
 const tree = settingsTree(text), { document, root, mods } = tree; let order = tree.order;
 const attr = (parent, id, type, content) => { const child = document.createElement('attribute'); child.setAttribute('id', id); child.setAttribute('type', type); child.setAttribute('value', content); parent.appendChild(child); };
 for (const operation of operations) {
  const module = moduleInfo(operation.module), matches = children(mods, 'node').filter(node => value(node, 'UUID')?.toLowerCase() === module.UUID);
  if (matches.length && (operation.install || value(matches[0], 'Folder') !== module.Folder || value(matches[0], 'Name') !== module.Name || value(matches[0], 'Version64') !== module.Version64)) throw new Error('同 UUID 模块已存在或被外部修改：' + module.Name);
  if (!operation.enabled) {
   for (const node of matches) mods.removeChild(node);
   if (order) for (const node of children(order, 'node').filter(node => value(node, 'UUID')?.toLowerCase() === module.UUID)) order.removeChild(node);
   continue;
  }
  if (!matches.length) {
   const node = document.createElement('node'); node.setAttribute('id', 'ModuleShortDesc');
   for (const [id, content] of Object.entries(module)) attr(node, id, id === 'Version64' ? 'int64' : id === 'UUID' ? 'FixedString' : 'LSString', content);
   attr(node, 'PublishHandle', 'uint64', '0'); mods.appendChild(node);
  }
  if (!order) {
   const node = document.createElement('node'); node.setAttribute('id', 'ModOrder'); root.appendChild(node); order = container(node, true);
   for (const existing of children(mods, 'node').filter(item => !/^Gustav(?:Dev)?$/i.test(value(item, 'Folder') || ''))) { const entry = document.createElement('node'); entry.setAttribute('id', 'Module'); attr(entry, 'UUID', 'FixedString', value(existing, 'UUID')); order.appendChild(entry); }
  }
  if (!children(order, 'node').some(node => value(node, 'UUID')?.toLowerCase() === module.UUID)) { const node = document.createElement('node'); node.setAttribute('id', 'Module'); attr(node, 'UUID', 'FixedString', module.UUID); order.appendChild(node); }
 }
 return new XMLSerializer().serializeToString(document);
}
function isEnabled(text, module) {
 const { mods, order } = settingsTree(text), uuid = moduleInfo(module).UUID;
 return children(mods, 'node').some(node => value(node, 'UUID')?.toLowerCase() === uuid && value(node, 'Folder') === module.Folder) && (!order || children(order, 'node').some(node => value(node, 'UUID')?.toLowerCase() === uuid));
}
function buildBG3(input, id, textFile) {
 const folder = 'Moddock' + id.replaceAll('-', ''), manifest = { UUID: id, Folder: folder, Name: input.name, Version64: VERSION };
 const attributes = { Author: ['LSString', input.author], Description: ['LSString', input.description], Folder: ['LSString', folder], Name: ['LSString', input.name], UUID: ['FixedString', id], Version64: ['int64', VERSION], MD5: ['LSString', ''], Type: ['FixedString', 'Add-on'] };
 const meta = '<?xml version="1.0" encoding="UTF-8"?>\n<save><version major="4" minor="0" revision="9" build="331"/><region id="Config"><node id="root"><children><node id="Dependencies"/><node id="ModuleInfo">' + Object.entries(attributes).map(([key, [type, content]]) => `<attribute id="${key}" type="${type}" value="${xml(content)}"/>`).join('') + '<children><node id="Scripts"/><node id="TargetModes"><children><node id="Target"><attribute id="Object" type="FixedString" value="Story"/></node></children></node></children></node></children></node></region></save>\n';
 const marker = `Moddock:${folder}:loaded`, log = `Moddock/${id}.log`;
 const code = input.kind === 'bg3-follower' ? `local function valid(guid)\n return type(guid) == "string" and guid ~= "" and not string.find(guid, "00000000-0000-0000-0000-000000000000", 1, true)\nend\nlocal function ensure_follower()\n PersistentVars = PersistentVars or {}\n local host = Osi.GetHostCharacter()\n if not valid(host) then error("No active host character") end\n local follower = PersistentVars.Companion\n local exists = valid(follower) and Osi.Exists(follower) or 0\n local created = exists ~= 1 and exists ~= true\n if not created and PersistentVars.Ready then return end\n if created then\n  local template = Osi.GetTemplate(host)\n  if not valid(template) then error("No verified character template") end\n  follower = Osi.CreateAtObject(template, host, 0, 0, "", 1)\n  if not valid(follower) then error("Character creation failed") end\n  PersistentVars.Companion = follower\n  PersistentVars.Ready = false\n end\n Osi.SetStoryDisplayName(follower, ${JSON.stringify(input.followerName)})\n Osi.AddPartyFollower(follower, host)\n PersistentVars.Ready = true\n if created then Osi.OpenMessageBox(host, ${JSON.stringify(input.greeting)}) end\nend\nExt.Events.SessionLoaded:Subscribe(function()\n local ok, err = pcall(ensure_follower)\n if not ok then\n  Ext.IO.SaveFile(${JSON.stringify(log)}, "ERROR: " .. tostring(err))\n  Ext.Utils.PrintError(tostring(err))\n  return\n end\n Ext.Utils.Print(${JSON.stringify(marker)})\n Ext.IO.SaveFile(${JSON.stringify(log)}, ${JSON.stringify(marker)})\nend)\n` : `local function moddock_initialize()\n${input.code}\nend\nlocal ok, err = pcall(moddock_initialize)\nif not ok then\n Ext.IO.SaveFile(${JSON.stringify(log)}, "ERROR: " .. tostring(err))\n error(err)\nend\nExt.Events.SessionLoaded:Subscribe(function()\n Ext.Utils.Print(${JSON.stringify(marker)})\n Ext.IO.SaveFile(${JSON.stringify(log)}, ${JSON.stringify(marker)})\nend)\n`;
 const controlled = input.kind === 'bg3-lua' && input.controls !== undefined ? controlsRuntime(id, input.controls) : null;
 const recorded = (controlled?.server || '') + `local function moddock_record(message)\n Ext.IO.SaveFile(${JSON.stringify(log)}, message .. "\\n" .. tostring(Ext.Timer.MonotonicTime()))\nend\n` + code.replaceAll(`Ext.IO.SaveFile(${JSON.stringify(log)}, `, 'moddock_record(');
 const files = [textFile(`package/Mods/${folder}/meta.lsx`, meta), textFile(`package/Mods/${folder}/ScriptExtender/Config.json`, JSON.stringify({ RequiredVersion: 29, ModTable: folder, FeatureFlags: ['Lua'] })), textFile(`package/Mods/${folder}/ScriptExtender/Lua/BootstrapServer.lua`, recorded)];
 if (controlled) files.push(textFile(`package/Mods/${folder}/ScriptExtender/Lua/BootstrapClient.lua`, controlled.client));
 return { manifest: { ...manifest, Author: input.author, Version: '1.0.0', UniqueID: folder }, content: { language: 'Lua', loader: 'BG3 Script Extender', code: recorded }, runtime: { loader: 'BG3 Script Extender', marker, log: 'Script Extender/' + log, ...(controlled ? { control: controlled.control } : {}) }, files };
}
module.exports = { isBG3, parseXML, moduleInfo, readModule, editLoadOrder, isEnabled, buildBG3, VERSION, AI_GUIDE };
