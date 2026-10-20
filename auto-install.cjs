const fs = require('node:fs/promises');
const path = require('node:path');
const {gameRule,evidence,sources}=require('./install-rules.cjs');
const {authorRule,instructionTexts}=require('./author-install.cjs');
const {assertPlainPakInstructions}=require('./install-instructions.cjs');

const documentation = name => /(^|\/)(readme|license|changelog|instructions|installation|credits|安装说明|使用说明|安装教程|说明)[^.\/]*(\.[^\/]*)?$/i.test(name) || /\.(md|pdf)$/i.test(name);
const userFile = name => /(^|\/)(saves?|saved|savedgames|savegames|screenshots|userdata|userfiles)(\/|$)/i.test(name) || /\.(sav|save)$/i.test(name);
const failure = (message,code='AUTO_INSTALL_UNRECOGNIZED') => Object.assign(new Error(message), {code});
const normalize = value => String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const packagePath = value => String(value||'').replace(/\\+/g,'/').toLowerCase();

function assertRequirements(context,rule,mods=[]) {
 const names=mods.filter(mod=>mod.status==='enabled').flatMap(mod=>[mod.name,mod.installationRule?.modName,...(mod.units||[]).map(unit=>unit.name)]).filter(Boolean).map(normalize);
 const missing=[];
 for(const item of context.requirements||[]){
  const name=typeof item==='string'?item:item.name,notes=typeof item==='string'?'':item.notes;
  if(/^\s*(optional|recommended|可选|推荐)(?:\s|[:：-]|$)/i.test(notes||''))continue;
  const normalized=normalize(name);
  if(rule.mode==='smapi'&&/^smapi(?:stardewmoddingapi)?$/.test(normalized))continue;
  if(rule.id?.startsWith('bepinex-')&&/^bepinex(?:pack)?5?$/.test(normalized)&&!/^\s*(?:version\s*)?6\b/i.test(notes||''))continue;
  if(rule.id?.startsWith('melon-')&&normalized==='melonloader')continue;
  if(!names.includes(normalized))missing.push(name);
 }
 if(missing.length)throw failure('无法确认已安装作者要求的前置 MOD：'+missing.join('、'),'AUTO_INSTALL_REQUIREMENTS');
}

async function detectRule(game,files,context={}) {
 const names=files.map(file=>file.path.replace(/\\/g,'/')).filter(name=>!documentation(name));
 if(!names.length)throw failure('这个包没有可安装的 MOD 文件','AUTO_INSTALL_UNSUPPORTED');
 if(names.some(userFile))throw failure('包内包含存档或用户文件，请在高级设置中单独处理','AUTO_INSTALL_USER_FILES');
 if(names.some(name=>/(^|\/)fomod\//i.test(name)))throw failure('作者使用 FOMOD 选项安装，需要专用安装器','AUTO_INSTALL_UNSUPPORTED');
 if(names.some(name=>/\.(exe|msi|bat|cmd|ps1|reg)$/i.test(name)))throw failure('包内含安装程序或脚本，不能按普通 MOD 目录部署','AUTO_INSTALL_UNSUPPORTED');
 if(names.some(name=>/(^|\/)(LogicMods|Scripts)\//i.test(name)&&/\.(pak|lua)$/i.test(name))||names.some(name=>/\.(lua|logicmod|ue4sslogicmod)$/i.test(name)))throw failure('检测到 UE4SS / Lua / 蓝图 MOD，需要对应加载器和专用安装流程','AUTO_INSTALL_UNSUPPORTED');
 const root=await fs.realpath(game.installPath);
 const exists=async(relative,directory=false)=>{try{let current=root,stat;for(const part of relative.split('/')){current=path.join(current,part);stat=await fs.lstat(current);if(stat.isSymbolicLink())return false;}return directory?stat.isDirectory():stat.isFile();}catch(error){if(error.code==='ENOENT')return false;throw error;}};
 const gameProfile=gameRule(game,context.domain);
 const instruction=packagePath(instructionTexts(context).map(item=>item.text).join('\n'));
 const finish=(rule,urls)=>({...rule,installationRule:{...evidence(rule.id,rule.name,urls.concat(context.url||[])),modName:context.modName||null,notes:gameProfile?.id==='blackmythwukong'&&instruction.includes('-fileopenlog')?['作者说明涉及 -fileopenlog；游戏启动前请按该文件说明确认启动参数或对应加载器。']:[]}});
 if(context.domain==='groundbranch' && context.url==='https://www.nexusmods.com/groundbranch/mods/195') {
  const directory='GroundBranch/Content/GroundBranch/Inventory/RailAttachment/RailCover';
  const prefix='Dual Pressure Pad',expected=['S_RailCover_Short.uasset','S_RailCover_Short.uexp',
   ...['BC','N','RMA'].flatMap(suffix=>['uasset','ubulk','uexp'].map(ext=>`T_RailCover_Small_${suffix}.${ext}`))];
  const paths=expected.map(name=>`${prefix}/${directory}/${name}`);
  if(names.length!==paths.length || new Set(names).size!==paths.length || paths.some(name=>!names.includes(name)))throw failure('Surefire Dual Pressure Pad 包结构与已核对的 1.0.0 旧版资源不一致，已停止安装','AUTO_INSTALL_UNSUPPORTED');
  if(String(game.appId)!=='16900'||!await exists('GroundBranch.exe')||!await exists(directory,true)||!(await Promise.all(expected.map(name=>exists(directory+'/'+name)))).every(Boolean))throw failure('Surefire Dual Pressure Pad 1.0.0 是旧版 GROUND BRANCH 资源包；当前游戏缺少它对应的 RailCover 原始文件，无法确认兼容。请使用适配当前游戏版本的 MOD。此问题无需调用 MU 创作服务。','AUTO_INSTALL_GAME_MISMATCH');
  const rule=finish({id:'groundbranch-surefire-195',name:'GROUND BRANCH · Surefire Dual Pressure Pad 旧版资源替换',mode:'copy',destination:'',sourcePrefix:prefix,executable:'GroundBranch.exe',requires:['GroundBranch.exe',...expected.map(name=>directory+'/'+name)]},[context.url,context.url+'?tab=posts']);
  rule.installationRule.notes=['仅适用于包含对应 RailCover 原始文件的旧版游戏；安装文件可备份还原，游戏内效果仍需确认。'];
  return rule;
 }
 if(String(game.appId)==='1913370' && context.domain==='operator' && context.url==='https://www.nexusmods.com/operator/mods/114') {
  const directory='OPERATOR_Data/StreamingAssets/aa/StandaloneWindows64';
  const expected=[
   'charactermods_stripped_assets_tribal_de4b68cb46dd04aed6d9c8e1293a4563.bundle',
   'charactermods_stripped_assets_oldschool_f0e0a96bb45d81eff8ef040ecf40ecff.bundle',
   'charactermods_stripped_assets_americaneagle_ec45ae8c6bdeba119ac7562000217502.bundle',
  ];
  const basenames=names.map(name=>path.posix.basename(name));
  if(names.length!==expected.length || new Set(basenames).size!==expected.length || expected.some(name=>!basenames.includes(name)))throw failure('纹身包结构与已核对的三个替换文件不一致，已停止安装','AUTO_INSTALL_UNSUPPORTED');
  if(!await exists('OPERATOR.exe') || !await exists(directory,true) || !(await Promise.all(expected.map(name=>exists(directory+'/'+name)))).every(Boolean))throw failure('没有找到 OPERATOR 对应的原始纹身资源文件','AUTO_INSTALL_GAME_MISMATCH');
  return finish({id:'operator-tattoos-114',name:'OPERATOR · Custom Tattoo Pack 原纹身替换',mode:'copy',destination:directory,executable:'OPERATOR.exe',requires:['OPERATOR.exe']},[context.url]);
 }
 const prefixFor=directory=>{
  const lower=directory.toLowerCase()+'/',prefixes=new Set();
  for(const name of names){const normalized=name.toLowerCase();for(let offset=0;offset<name.length;offset++){if((offset===0||name[offset-1]==='/')&&normalized.startsWith(lower,offset))prefixes.add(name.slice(0,offset+directory.length));}}
  const candidates=[...prefixes].filter(prefix=>names.every(name=>name.startsWith(prefix+'/')));
  return candidates.length===1?candidates[0]:null;
 };
 if(names.some(name=>/(^|\/)manifest\.json$/i.test(name))){
  if(gameProfile?.id!=='stardewvalley')throw failure('SMAPI 包只能安装到已确认的星露谷游戏','AUTO_INSTALL_GAME_MISMATCH');
  const gameRoot=await exists('Contents/MacOS',true)?'Contents/MacOS':'';
  return finish({id:'stardew-smapi',name:'SMAPI 清单包',mode:'smapi',root:gameRoot,destination:'Mods'},[sources.smapi]);
 }
 const bepinex=prefixFor('BepInEx/plugins'),patchers=prefixFor('BepInEx/patchers');
 const bareDll=names.some(name=>/\.dll$/i.test(name))&&names.every(name=>!name.includes('/'));
 const instructedPlugin=bareDll&&instruction.includes('bepinex/plugins'),instructedPatcher=bareDll&&instruction.includes('bepinex/patchers');
 if(instructedPlugin&&instructedPatcher)throw failure('作者说明同时提到插件与预加载补丁目录，需要确认所选文件类型');
 if(bepinex||patchers||instructedPlugin||instructedPatcher){
  const patcher=!!patchers||instructedPatcher;
  if(/bepinex[ _-]*6\b/.test(instruction))throw failure('此文件要求 BepInEx 6，当前自动规则仅覆盖已核对的 BepInEx 5 布局','AUTO_INSTALL_UNSUPPORTED');
  if(!names.some(name=>/\.dll$/i.test(name)))throw failure('BepInEx 包没有插件 DLL','AUTO_INSTALL_UNSUPPORTED');
  return finish({id:patcher?'bepinex-patchers':'bepinex-plugins',name:patcher?'BepInEx 5 预加载补丁':'BepInEx 5 插件',mode:patcher?'copy':'bepinex',sourcePrefix:patchers||bepinex||'',destination:patcher?'BepInEx/patchers':'BepInEx/plugins',requires:['BepInEx/core/BepInEx.dll']},[patcher?sources.patchers:sources.bepinex]);
 }
 const melonMods=prefixFor('Mods'),melonPlugins=prefixFor('Plugins');
 if((melonMods||melonPlugins)&&await exists('MelonLoader',true)&&await exists('version.dll')&&await exists('dobby.dll'))return finish({id:melonPlugins?'melon-plugins':'melon-mods',name:melonPlugins?'MelonLoader Plugins':'MelonLoader Mods',mode:'copy',sourcePrefix:melonPlugins||melonMods,destination:melonPlugins?'Plugins':'Mods',requires:['version.dll','dobby.dll']},[sources.melon]);
 if(names.some(name=>/\.(esp|esm|esl|bsa|ba2)$/i.test(name)))throw failure('Bethesda MOD 还需要插件启用、加载顺序或资源配置；当前不能把复制 Data 当成完整安装','AUTO_INSTALL_UNSUPPORTED');
 if(names.some(name=>/\.dll$/i.test(name)))throw failure('不能只凭 DLL 后缀判断插件类型；需要作者提供加载器目录或专用适配','AUTO_INSTALL_UNSUPPORTED');
 if(names.some(name=>/\.archive$/i.test(name))){
  if(gameProfile?.id!=='cyberpunk2077')throw failure('archive 包与当前游戏不匹配','AUTO_INSTALL_GAME_MISMATCH');
  if(names.some(name=>/(^|\/)mods\/[^/]+\/(info\.json|archives\/)/i.test(name))||names.some(name=>/(^|\/)info\.json$/i.test(name)))throw failure('REDmod 需要部署和启用，不能按 legacy archive 安装','AUTO_INSTALL_UNSUPPORTED');
  if(!names.every(name=>/\.archive$/i.test(name)))throw failure('此赛博朋克包包含 ArchiveXL 或其他框架文件，需要对应的前置与专用规则','AUTO_INSTALL_UNSUPPORTED');
  if(!await exists(gameProfile.executable)||!await exists(gameProfile.directory,true))throw failure('当前目录不是可确认的赛博朋克安装','AUTO_INSTALL_GAME_MISMATCH');
  return finish({id:'cyberpunk-legacy-archive',name:'Cyberpunk legacy archive',mode:'archive',destination:gameProfile.destination,requires:[gameProfile.executable],executable:gameProfile.executable},[gameProfile.source]);
 }
 if(names.some(name=>/\.(pak|utoc|ucas)$/i.test(name))){
  if(gameProfile?.type!=='pak'){
   if(!names.every(name=>/\.(pak|utoc|ucas)$/i.test(name)))throw failure('此包混合了 PAK 与其他类型文件，需要对应的专用安装流程','AUTO_INSTALL_UNSUPPORTED');
   const lower=new Set(names.map(name=>name.toLowerCase()));
   for(const name of names)if(/\.(utoc|ucas)$/i.test(name)){const sibling=name.replace(/\.(utoc|ucas)$/i,ext=>ext.toLowerCase()==='.utoc'?'.ucas':'.utoc');if(!lower.has(sibling.toLowerCase()))throw failure('IoStore 文件缺少配套文件：'+sibling,'AUTO_INSTALL_UNSUPPORTED');}
   const rule=await authorRule(game,names,context);return {...rule,mode:'pak'};
  }
  if(!names.every(name=>/\.(pak|utoc|ucas)$/i.test(name)))throw failure('此包混合了 PAK 与其他类型文件，需要作者专用安装规则','AUTO_INSTALL_UNSUPPORTED');
  if(names.filter(name=>/\.pak$/i.test(name)).length>1&&/choose\s+(?:only\s+)?one|install\s+(?:only\s+)?one|only\s+one\s+(?:version|variant)|只(?:安装|选择)(?:一个|一种)/i.test(instruction))throw failure('包内有多个 PAK，而作者要求只选择一个版本；请先选择对应文件','AUTO_INSTALL_UNSUPPORTED');
  if(!await exists(gameProfile.directory,true)||gameProfile.executable&&!await exists(gameProfile.executable))throw failure('游戏标识与实际安装目录结构不一致','AUTO_INSTALL_GAME_MISMATCH');
  if(gameProfile.id==='readyornot'&&names.some(name=>/^pakchunk\d+-windows(?:noeditor)?(?:[._-].*)?\.(pak|utoc|ucas)$/i.test(path.posix.basename(name))))throw failure('此包试图覆盖严阵以待的基础游戏档案，不能按普通 MOD 安装','AUTO_INSTALL_UNSUPPORTED');
  const lower=new Set(names.map(name=>name.toLowerCase()));
  for(const name of names){if(/\.(utoc|ucas)$/i.test(name)){const sibling=name.replace(/\.(utoc|ucas)$/i,ext=>ext.toLowerCase()==='.utoc'?'.ucas':'.utoc');if(!lower.has(sibling.toLowerCase()))throw failure('IoStore 文件缺少配套文件：'+sibling,'AUTO_INSTALL_UNSUPPORTED');}}
  const destinationInstruction=packagePath(context.fileDescription||context.readmeInstructions||context.description);
  const mentions=gameProfile.variants.filter(destination=>destinationInstruction.includes(destination.toLowerCase())).filter(destination=>!gameProfile.variants.some(other=>other.toLowerCase().startsWith(destination.toLowerCase()+'/')&&destinationInstruction.includes(other.toLowerCase())));
  if(mentions.length>1)throw failure('作者说明包含多个不同安装目录，需要确认所选文件对应的安装方式');
  const destination=mentions[0]||gameProfile.destination;
  if(names.some(name=>/(^|\/)logicmods\//i.test(name)))throw failure('LogicMods 包需要蓝图加载器的专用安装流程','AUTO_INSTALL_UNSUPPORTED');
  assertPlainPakInstructions(context);
  return finish({id:gameProfile.id+'-pak',name:gameProfile.name+' · 普通 PAK',mode:'pak',destination,requires:gameProfile.executable?[gameProfile.executable]:[]},gameProfile.sources||[gameProfile.source]);
 }
 return authorRule(game,names,context);
}

module.exports={detectRule,documentation,userFile,assertRequirements};
