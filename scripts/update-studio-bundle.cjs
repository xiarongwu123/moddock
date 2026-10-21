// The newer shipped UI has no complete React authoring tree in this snapshot.
// Update its isolated studio factory using its existing React/component bindings.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..'), file = path.join(root,'public/auth.js');
let bundle = fs.readFileSync(file,'utf8');
const start = '/* MODDOCK_STUDIO_FACTORY_START */', end = '/* MODDOCK_STUDIO_FACTORY_END */';
if(bundle.includes(start)) {
 const a=bundle.indexOf(start), b=bundle.indexOf(end,a);
 if(b<0)throw new Error('Incomplete studio factory patch');
 bundle=bundle.slice(0,a)+bundle.slice(b+end.length);
}
const header='function pZ({api:n,render:t,esc:a,icon:r,getGame:o,getGames:s,changeGame:i,getStatus:l,openPlan:u,openPreview:c,openLibrary:f,refresh:d,toast:p}){';
if(bundle.split(header).length!==2 || !bundle.includes('DN.createElement)(RN,') || !bundle.includes('DN.createElement)(EN,') || !bundle.includes('PN.createRoot)'))throw new Error('Shipped studio bindings changed; inspect them before updating');
const source=fs.readFileSync(path.join(root,'public/mod-studio.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function createModStudio','function createModStudio');
const factory=start+'return (function(createElement,createRoot,ThoughtLine,PromptBar){\n'+source+'\nreturn createModStudio;})(DN.createElement,PN.createRoot,EN,RN)(arguments[0]);'+end;
bundle=bundle.replace(header,header+factory);
new (require('node:vm').Script)(bundle);
fs.writeFileSync(file,bundle);
console.log('Updated shipped studio factory from public/mod-studio.js');
