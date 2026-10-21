// Like update-studio-bundle.cjs: the shipped snapshot lacks the complete React
// source tree. Preserve those components and update only the reviewed hooks.
const fs=require('node:fs/promises'),path=require('node:path'),{transform}=require('esbuild');
const root=path.resolve(__dirname,'..');
async function update(){
 const file=path.join(root,'public/auth.js');let bundle=(await transform(await fs.readFile(file,'utf8'),{minify:false})).code;
 if(bundle.includes('MODDOCK_FOMOD_FACTORY_START'))throw new Error('FOMOD hooks already applied; restore the pre-FOMOD bundle before rebuilding');
 function replace(before,after){if(bundle.split(before).length!==2)throw new Error('Shipped FOMOD binding changed: '+before.slice(0,100));bundle=bundle.replace(before,after);}
 const source=(await fs.readFile(path.join(root,'public/fomod-ui.js'),'utf8')).replace('export function createFomodUI','function createFomodUI');
 replace('  async function kZ(n, t) {',`  /*! MODDOCK_FOMOD_FACTORY_START */
 const fomodUI=(function(){${source}\nreturn createFomodUI({api:on,openModal:Wo,renderModal:no,modal:()=>ze,esc:We,translator:MN});})();
 /*! MODDOCK_FOMOD_FACTORY_END */
 async function kZ(n,t){`);
 replace('let s = await on("installations/auto", { jobId: n, operationId: o.id });','let s = await on("installations/auto", { jobId: n, operationId: o.id }); if(s.kind==="fomod"){if(r===yn){fomodUI.show(s);await Un(r).catch(()=>{});}return s;}');
 replace('await kZ(n, r), a === yn &&','(await kZ(n,r))?.kind!=="fomod" && a === yn &&');
 replace('if (ze.kind === "auto-error")','if(ze.kind==="fomod"){const content=fomodUI.content(ze);n=content.heading;t=content.body;a=content.actions;}else if (ze.kind === "auto-error")');
 replace('["rule", "plan", "uninstall", "launch", "auto-error", "restore-result"].includes(ze.kind)','["fomod", "rule", "plan", "uninstall", "launch", "auto-error", "restore-result"].includes(ze.kind)');
 replace('!wf && !pp && Wo({ kind: "install-progress", task: n })','!wf && !pp && ze?.kind!=="fomod" && Wo({ kind: "install-progress", task: n })');
 replace('await kZ(r.job.id, n), t !== yn || ze !== n','await kZ(r.job.id, n), t !== yn || ze !== n'); // modal changes stop the existing play loop
 const output=await transform(bundle,{minify:true,legalComments:'inline',target:'chrome120'});new(require('node:vm').Script)(output.code);await fs.writeFile(file,output.code);console.log('Updated shipped FOMOD hooks and card UI');
}
update().catch(e=>{console.error(e);process.exitCode=1;});
