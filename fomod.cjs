// Declarative FOMOD only. XML is data, never an executable installer.
const {DOMParser}=require('@xmldom/xmldom');
const path=require('node:path');
const crypto=require('node:crypto');
const children=(node,name)=>Array.from(node?.childNodes||[]).filter(n=>n.nodeType===1&&(!name||n.nodeName===name));
const child=(node,name)=>children(node,name)[0];
const attr=(node,name,fallback='')=>node?.hasAttribute(name)?node.getAttribute(name):fallback;
const text=node=>node?.textContent?.trim()||'';
const fail=message=>{throw Object.assign(new Error('FOMOD：'+message),{code:'FOMOD_INVALID'});};
const groups=new Set(['SelectExactlyOne','SelectAtMostOne','SelectAtLeastOne','SelectAny','SelectAll']);
const types=new Set(['Required','Recommended','Optional','NotUsable','CouldBeUsable']);
function ordered(node,name){const rows=children(node,name),order=attr(node,'order','Ascending');if(!['Explicit','Ascending','Descending'].includes(order))fail('未知排序方式');return order==='Explicit'?rows:rows.sort((a,b)=>attr(a,'name').localeCompare(attr(b,'name'),'en')*(order==='Descending'?-1:1));}
function parse(xml,configPath,relative){
 if(Buffer.byteLength(xml)>1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml))fail('XML 过大或包含 DTD / 实体声明');
 let doc;try{doc=new DOMParser({onError:()=>fail('XML 格式错误')}).parseFromString(xml,'text/xml');}catch{fail('XML 格式错误');}
 const root=doc.documentElement;if(root?.nodeName!=='config')fail('缺少 config 根节点');
 const allowed=new Set('config moduleName moduleImage moduleDependencies requiredInstallFiles installSteps installStep visible optionalFileGroups group plugins plugin description image files file folder conditionFlags flag typeDescriptor type dependencyType defaultType patterns pattern dependencies flagDependency fileDependency conditionalFileInstalls'.split(' '));
 let count=0;
 function validate(node,depth=0){if(depth>40||++count>20000)fail('XML 结构过深或节点过多');if(!allowed.has(node.nodeName))fail('暂不支持的声明：'+node.nodeName);for(const n of children(node))validate(n,depth+1);}
 validate(root);
 const structure={config:'moduleName moduleImage moduleDependencies requiredInstallFiles installSteps conditionalFileInstalls',installSteps:'installStep',installStep:'visible optionalFileGroups',optionalFileGroups:'group',group:'plugins',plugins:'plugin',plugin:'description image files conditionFlags typeDescriptor',typeDescriptor:'type dependencyType',dependencyType:'defaultType patterns',patterns:'pattern',pattern:'dependencies files type',requiredInstallFiles:'file folder',files:'file folder',conditionFlags:'flag',conditionalFileInstalls:'patterns',moduleDependencies:'dependencies flagDependency fileDependency',dependencies:'dependencies flagDependency fileDependency',visible:'dependencies flagDependency fileDependency'};
 function checkStructure(node){const names=(structure[node.nodeName]||'').split(' ').filter(Boolean);for(const n of children(node)){if(!names.includes(n.nodeName))fail('声明位置无效：'+node.nodeName+'/'+n.nodeName);checkStructure(n);}if(['config','installStep','group','plugin','typeDescriptor','dependencyType','pattern','conditionalFileInstalls'].includes(node.nodeName)){for(const name of names)if(children(node,name).length>1)fail('重复声明：'+name);}}
 checkStructure(root);
 for(const n of Array.from(root.getElementsByTagName('group')))if(!groups.has(attr(n,'type')))fail('未知选项组类型');
 for(const tag of ['type','defaultType'])for(const n of Array.from(root.getElementsByTagName(tag)))if(!types.has(attr(n,'name')))fail('未知选项类型');
 for(const tag of ['file','folder'])for(const n of Array.from(root.getElementsByTagName(tag))){relative(attr(n,'source').replace(/[\\/]+$/,''),tag==='folder');relative(attr(n,'destination').replace(/[\\/]+$/,''),true);for(const key of ['alwaysInstall','installIfUsable'])if(n.hasAttribute(key)&&!['true','false','1','0'].includes(attr(n,key)))fail('无效布尔值');if(n.hasAttribute('priority')&&!/^\d{1,10}$/.test(attr(n,'priority')))fail('无效文件优先级');}
 const prefix=configPath.slice(0,configPath.toLowerCase().lastIndexOf('fomod/'));
 const steps=ordered(child(root,'installSteps'),'installStep').map((s,si)=>({id:'s'+si,node:s,name:attr(s,'name'),groups:ordered(child(s,'optionalFileGroups'),'group').map((g,gi)=>({id:`s${si}g${gi}`,node:g,name:attr(g,'name'),type:attr(g,'type'),options:ordered(child(g,'plugins'),'plugin').map((p,pi)=>({id:`s${si}g${gi}p${pi}`,node:p,name:attr(p,'name'),description:text(child(p,'description'))}))}))}));
 if(steps.reduce((n,s)=>n+s.groups.reduce((n,g)=>n+g.options.length,0),0)>500)fail('选项数量超限');
 return {root,steps,prefix,name:text(child(root,'moduleName')),configPath,sha256:crypto.createHash('sha256').update(xml).digest('hex'),relative};
}
function dependency(node,flags,fileStates,relative){
 if(!node)return true;
 if(node.nodeName==='flagDependency')return flags[attr(node,'flag')]===attr(node,'value');
 if(node.nodeName==='fileDependency'){
  const file=relative(attr(node,'file')),state=attr(node,'state');if(!['Missing','Active','Inactive'].includes(state))fail('未知文件依赖状态');
  if(!Object.hasOwn(fileStates,file.toLowerCase()))fail('无法确认依赖文件状态：'+file);
  const actual=fileStates[file.toLowerCase()];if(actual==='Unknown')fail('无法确认插件启用状态：'+file+'；请先在游戏或加载器中确认');return actual===state;
 }
 const op=attr(node,'operator','And');if(!['And','Or'].includes(op))fail('未知依赖运算');
 const values=children(node).map(n=>dependency(n,flags,fileStates,relative));return op==='And'?values.every(Boolean):values.some(Boolean);
}
function optionType(option,flags,states,relative){
 const descriptor=child(option.node,'typeDescriptor'),simple=child(descriptor,'type');if(simple)return attr(simple,'name');
 const dynamic=child(descriptor,'dependencyType');if(!dynamic)fail('选项缺少 typeDescriptor');
 const match=children(child(dynamic,'patterns'),'pattern').find(p=>dependency(child(p,'dependencies'),flags,states,relative));return attr(child(match,'type')||child(dynamic,'defaultType'),'name');
}
function evaluate(model,selection={},fileStates={},strict=false){
 if(!selection||typeof selection!=='object'||Array.isArray(selection))fail('选项数据无效');
 const known=new Set(model.steps.flatMap(s=>s.groups.map(g=>g.id)));if(Object.keys(selection).some(k=>!known.has(k)))fail('未知选项组');
 const flags=Object.create(null),steps=[],installNodes=[],errors=[],selectedIds=[];
 if(!dependency(child(model.root,'moduleDependencies'),flags,fileStates,model.relative))fail('未满足作者声明的安装前置');
 installNodes.push(...children(child(model.root,'requiredInstallFiles')));
 for(const step of model.steps){
  if(!dependency(child(step.node,'visible'),flags,fileStates,model.relative))continue;
  const view={id:step.id,name:step.name,groups:[]};
  for(const group of step.groups){
   const options=group.options.map(o=>({...o,type:optionType(o,flags,fileStates,model.relative)}));
   let chosen=selection[group.id];if(chosen!==undefined&&(!Array.isArray(chosen)||chosen.some(id=>!options.some(o=>o.id===id))||new Set(chosen).size!==chosen.length))fail('未知或重复选项');
   const single=['SelectExactlyOne','SelectAtMostOne'].includes(group.type);
   if(chosen===undefined){chosen=options.filter(o=>o.type==='Required'||o.type==='Recommended').map(o=>o.id);if(single&&chosen.length>1)chosen=chosen.slice(0,1);}
   chosen=[...new Set([...chosen,...options.filter(o=>o.type==='Required'||group.type==='SelectAll'&&o.type!=='NotUsable').map(o=>o.id)])];
   if(chosen.some(id=>options.find(o=>o.id===id).type==='NotUsable')){if(strict)fail('所选选项当前不可用');chosen=chosen.filter(id=>options.find(o=>o.id===id).type!=='NotUsable');}
   if(single&&chosen.length>1||group.type==='SelectExactlyOne'&&chosen.length!==1||group.type==='SelectAtLeastOne'&&!chosen.length)errors.push('请按要求选择：'+group.name);
   for(const option of options){
    const selected=chosen.includes(option.id);if(selected){selectedIds.push(option.id);for(const flag of children(child(option.node,'conditionFlags'),'flag')){const name=attr(flag,'name');if(['__proto__','constructor','prototype'].includes(name))fail('无效标记');flags[name]=text(flag);}}
    for(const file of children(child(option.node,'files')))if(selected||['true','1'].includes(attr(file,'alwaysInstall'))||option.type!=='NotUsable'&&['true','1'].includes(attr(file,'installIfUsable')))installNodes.push(file);
   }
   view.groups.push({id:group.id,name:group.name,type:group.type,options:options.map(({node,...o})=>({...o,selected:chosen.includes(o.id)}))});
  }
  steps.push(view);
 }
 for(const pattern of children(child(child(model.root,'conditionalFileInstalls'),'patterns'),'pattern'))if(dependency(child(pattern,'dependencies'),flags,fileStates,model.relative))installNodes.push(...children(child(pattern,'files')));
 if(strict&&errors.length)fail(errors.join('；'));
 return {name:model.name,configPath:model.configPath,sha256:model.sha256,steps,errors,selectedIds,installNodes};
}
function mappings(model,result,files){
 const byName=new Map(files.map(f=>[f.path.toLowerCase(),f.path])),destinations=new Map();
 for(const node of result.installNodes){
  if(!['file','folder'].includes(node.nodeName))fail('未知文件声明');
  const folder=node.nodeName==='folder',src=model.relative(attr(node,'source').replace(/[\\/]+$/,''),folder),source=(model.prefix+src).replace(/\/$/,'');
  const destination=model.relative(attr(node,'destination').replace(/[\\/]+$/,''),true),priority=Number(attr(node,'priority','0'));
  const found=folder?files.filter(f=>f.path.toLowerCase().startsWith((source?source+'/':'').toLowerCase())):byName.has(source.toLowerCase())?[{path:byName.get(source.toLowerCase())}]:[];
  if(!found.length)fail('作者指定的源文件不存在：'+source);
  for(const file of found){
   if(/(^|\/)fomod\//i.test(file.path)||/\.(exe|msi|bat|cmd|ps1|reg|lnk|url)$/i.test(file.path))fail('不能部署安装器元数据或执行脚本：'+file.path);
   const tail=folder?file.path.slice(source?source.length+1:0):'';
   const dest=model.relative(folder?[destination,tail].filter(Boolean).join('/'):destination||path.posix.basename(file.path));
   const key=dest.normalize('NFC').toLowerCase(),old=destinations.get(key);
   if(old&&old.priority===priority&&old.source!==file.path)fail('多个选项以相同优先级写入同一目标：'+dest);
   if(!old||priority>old.priority)destinations.set(key,{source:file.path,destination:dest,priority});
  }
 }
 const rows=[...destinations.values()].map(({priority,...row})=>row);if(!rows.length||rows.length>2000)fail('所选方案没有文件或超过 2000 个映射上限');return rows;
}
module.exports={parse,evaluate,mappings};
