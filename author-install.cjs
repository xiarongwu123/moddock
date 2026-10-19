const fs = require('node:fs/promises');
const path = require('node:path');

const fail = message => { throw Object.assign(new Error(message), {code:'AUTO_INSTALL_INSTRUCTIONS'}); };
function instructionTexts(context) {
 const decode=text=>text.replace(/&(?:#(\d+)|#x([\da-f]+)|(amp|quot|apos|lt|gt|nbsp));/gi,(all,decimal,hex,name)=>{
  if(name)return ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '})[name.toLowerCase()];
  const code=decimal?Number(decimal):parseInt(hex,16);return code>0&&code<=0x10ffff&&!(code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):all;
 });
 return ['fileDescription','readmeInstructions','description'].map(source=>({source,text:decode(String(context[source]||'').slice(0,1024*1024))})).filter(item=>item.text.trim());
}
function safeRelative(value) {
 const result=value.replace(/\\/g,'/').replace(/\/+$/,'');
 if(!result||result.length>500||result.split('/').some(p=>!p||p==='.'||p==='..'||/[<>:"|?*\x00-\x1f]/.test(p)||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)))fail('作者说明中的目标路径无法安全定位到当前游戏目录');
 if(/(^|\/)(saves?|saved|savedgames|savegames|screenshots|userdata|userfiles)(\/|$)/i.test(result))fail('作者说明要求写入存档或用户目录，需要对应的专用安装流程');
 return result;
}
// Parse explicit copy/extract destinations only. Prose is evidence, never code.
async function authorRule(game,names,context) {
 const texts=instructionTexts(context);
 if(!texts.length)fail('未取得作者安装说明，无法确认安装目录；请检查资源详情是否可读取后重试');
 const joined=texts.map(x=>x.text).join('\n');
 if(/fomod|redmod|archivexl|redscript|ue4ss|modengine|mod engine|vortex|mod organizer|texmod|movesetextractor/i.test(joined))fail('作者说明涉及专用加载器或部署工具，尚需适配对应安装流程');
 if(/choose\s+(?:only\s+)?one|install\s+(?:only\s+)?one|only\s+one\s+(?:version|variant)|只(?:安装|选择)(?:一个|一种)|二选一/i.test(joined))fail('作者要求选择一个版本；请在文件列表选择对应版本的独立安装包');
 const root=await fs.realpath(game.installPath), candidates=[];
 for(const {source,text} of texts)for(const line of text.split(/[\r\n]+/)) {
  // Quoted paths support spaces; unquoted paths end at whitespace/punctuation.
  const directive=/(?:\b(?:copy|extract|unzip|place|put|move|install|drop)\b.{0,240}?\b(?:into|to|in)\s+|(?:复制|解压|放置|移动|安装).{0,120}?(?:到|至)\s*|(?:放入|放到|置于)\s*)(?:the\s+)?(?:["'`“「]([^"'`”」]+)["'`”」]|(game\s+(?:root(?:\s+directory)?|folder|directory)(?![\w/\\])|[^\s，。；;]+))/ig;
  let match;
  while((match=directive.exec(line))) {
   if(/\b(?:do not|don't|never|instead|alternatively|optional|if)\b|不要|禁止|或者|如果|可选/i.test(line))fail('作者说明包含条件、备选方式或禁止操作，尚不能唯一确认安装方案');
   let raw=(match[1]||match[2]).replace(/[.,。]+$/,'').replace(/\\/g,'/');
   let anchored=false;
   const actual=[root,path.resolve(game.installPath)].map(p=>p.replace(/\\/g,'/')).find(p=>raw.toLowerCase()===p.toLowerCase()||raw.toLowerCase().startsWith(p.toLowerCase()+'/'));
   if(actual){raw=raw.slice(actual.length).replace(/^\//,'');anchored=true;}
   else if(/^[a-z]:|^\/|%|\$\{|\.\./i.test(raw))fail('作者给出的路径位于当前游戏目录之外，无法自动安装');
   const marker=/^(?:\[game(?: root| folder| directory)?\]|<game(?: root| folder| directory)?>|game[_ -]?root(?: directory)?|game folder|game directory|游戏根目录|游戏目录)(?:\/|$)/i;
   if(marker.test(raw)){raw=raw.replace(marker,'');anchored=true;}
   // Bare prose such as “install in the game” is not a path.
   if(!anchored&&!/[\\/]/.test(raw)&&!match[1]&&!/^[\w~.-]+$/.test(raw))continue;
   const destination=raw?safeRelative(raw):'';
   if(destination&&/\.[a-z0-9]{1,8}$/i.test(destination.split('/').at(-1)))fail('作者说明指向具体文件，尚需核对文件替换映射');
   let current=root,seen=false;
   for(const component of destination.split('/').filter(Boolean)) {
    current=path.join(current,component);
    try{const stat=await fs.lstat(current);if(stat.isSymbolicLink()||!stat.isDirectory())fail('作者目标目录包含链接或非目录项目');seen=true;}catch(error){if(error.code!=='ENOENT')throw error;break;}
   }
   if(!anchored&&!seen)fail('作者目标目录与本机游戏结构不匹配，无法确认安装位置');
   candidates.push({destination,source,excerpt:line.trim().slice(0,800),line});
  }
 }
 if(!candidates.length)fail('已读取作者说明，但没有识别到明确的复制或解压目标目录；该安装方式需要补充适配');
 const destinations=new Set(candidates.map(x=>x.destination.toLowerCase()));
 if(destinations.size!==1)fail('作者说明包含多个安装目录或不同版本的安装方式，暂时无法唯一确认本文件的方案');
 const chosen=candidates[0],destination=chosen.destination;
 let sourcePrefix='';
 const explicit=[];
 for(const c of candidates){const m=c.line.match(/(?:contents\s+of\s+["'`“]?([^"'`”]+?)["'`”]?\s+(?:folder\s+)?(?:to|into)|(?:将|把)["'`“]?([^"'`”]+?)["'`”]?(?:目录|文件夹)(?:内|中)(?:的)?(?:内容|文件))/i);if(m)explicit.push(safeRelative((m[1]||m[2]).trim()));}
 if(new Set(explicit.map(x=>x.toLowerCase())).size>1)fail('作者说明给出了多个包内目录，无法唯一确认源文件');
 if(explicit.length){sourcePrefix=explicit[0];if(!names.every(n=>n.startsWith(sourcePrefix+'/')))fail('作者指定的包内目录与实际文件不一致，或包内还包含其他安装内容');}
 else if(destination){
  // Strip a packaged destination tree, retaining every relative subdirectory.
  const prefixes=new Set();
  for(const name of names){const lower=name.toLowerCase(),needle=destination.toLowerCase()+'/';let i=lower.indexOf(needle);while(i>=0){if(i===0||name[i-1]==='/')prefixes.add(name.slice(0,i+destination.length));i=lower.indexOf(needle,i+1);}}
  const matching=[...prefixes].filter(p=>names.every(n=>n.startsWith(p+'/')));
  if(matching.length>1)fail('包内存在多个相同目标目录，无法唯一确认源文件');
  sourcePrefix=matching[0]||'';
 }
 return {id:'author-directory',name:'作者说明 · 目录部署',mode:'copy',destination,sourcePrefix,requires:[],installationRule:{id:'author-directory',name:'作者说明 · 目录部署',origin:'author',analyzedAt:new Date().toISOString(),sources:context.url?[context.url]:[],modName:context.modName||null,notes:['已按作者明确目录与本机包结构生成方案；文件部署后仍需进入游戏确认效果。'],instructions:candidates.map(({source,excerpt})=>({source,excerpt}))}};
}
module.exports={authorRule,instructionTexts};
