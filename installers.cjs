const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const yauzl = require('yauzl');
const { crc32 } = require('node:zlib');
const {defaultRecipe}=require('./adapters.cjs');
const MAX = 4 * 1024 ** 3;
const hash = async file => { const h = crypto.createHash('sha256'); for await (const b of createReadStream(file)) h.update(b); return h.digest('hex'); };
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = s => s.normalize('NFC').toLowerCase();
function relative(value, empty = false) {
 if (typeof value !== 'string' || value.length > 500) throw new Error('安装路径无效');
 const s = value.replace(/\\/g, '/'); if (empty && !s) return '';
 if (!s || s.split('/').some(p => !p || p === '.' || p === '..' || /[<>:"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p))) throw new Error(`不安全的相对路径：${value}`);
 return s;
}
// Resolve every component without following links inside an installation.
async function target(root, rel) {
 const real = await fs.realpath(root); let current = real;
 for (const p of relative(rel).split('/')) { current = path.join(current, p); try { const st = await fs.lstat(current); if (st.isSymbolicLink()) throw new Error(`安装路径包含符号链接：${rel}`); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
 return current;
}
async function fileHash(file) { try { const st = await fs.lstat(file); if (!st.isFile() || st.isSymbolicLink()) throw new Error('目标不是普通文件'); if (st.size > MAX) throw new Error('目标文件超过 4 GB 限制'); return await hash(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function json(file, limit = 1024 ** 2) { const st = await fs.stat(file); if (st.size > limit) throw new Error('记录超过读取体积限制'); return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
async function atomic(file, value) { await fs.mkdir(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; await fs.writeFile(tmp, JSON.stringify(value, null, 2)); await fs.rename(tmp, file); }
async function extract(file, dir) {
 await fs.mkdir(dir, { recursive: true }); const files = []; const names = new Set(); let bytes = 0, count = 0;
 const zip = await yauzl.openPromise(file, { lazyEntries: true, validateEntrySizes: true });
 try {
  for await (const entry of zip.eachEntry()) {
   if (++count > 12000) throw new Error('压缩包超过 12000 个条目');
   const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
   if (mode && mode !== 0x8000 && mode !== 0x4000) throw new Error('压缩包含链接或特殊文件');
   const directory = entry.fileName.endsWith('/'); const rel = relative(directory ? entry.fileName.slice(0, -1) : entry.fileName);
   if (names.has(key(rel))) throw new Error(`压缩包存在重名文件：${rel}`); names.add(key(rel));
   if (directory) continue;
   bytes += entry.uncompressedSize;
   if (bytes > MAX || entry.uncompressedSize > 1024 ** 3 || (entry.uncompressedSize > 1024 ** 2 && entry.uncompressedSize / Math.max(1, entry.compressedSize) > 500)) throw new Error('压缩包解压体积或压缩率超过限制');
   const out = await target(dir, rel); await fs.mkdir(path.dirname(out), { recursive: true });
   let actual = 0, crc = 0; const h = crypto.createHash('sha256');
   const meter = new Transform({ transform(chunk, enc, cb) { actual += chunk.length; if (actual > entry.uncompressedSize) return cb(new Error('解压大小不匹配')); h.update(chunk); crc=crc32(chunk,crc); cb(null, chunk); } });
   await pipeline(await zip.openReadStreamPromise(entry), meter, createWriteStream(out, { flags: 'wx' }));
   if (actual !== entry.uncompressedSize || crc !== entry.crc32) throw new Error('解压大小或 CRC 校验不匹配');
   files.push({ source: rel, sha256: h.digest('hex'), size: actual });
  }
 } finally { zip.close(); }
 if (!files.length) throw new Error('压缩包没有可安装文件'); return files;
}
const presets = {
 '413150': { mode: 'smapi', destination: 'Mods', executable: process.platform === 'win32' ? 'StardewModdingAPI.exe' : 'StardewModdingAPI', requires: ['StardewModdingAPI.dll'] },
 '1091500': { mode: 'archive', destination: 'archive/pc/mod', executable: 'bin/x64/Cyberpunk2077.exe', requires: ['bin/x64/Cyberpunk2077.exe'] }
};
function profile(input) {
 if (!input || !['copy','smapi','archive','pak','bepinex','bethesda'].includes(input.mode)) throw new Error('请设置该游戏的安装规则');
 const p = { mode: input.mode, root: relative(input.root || '', true), sourcePrefix: relative(input.sourcePrefix || '', true), destination: relative(input.destination || '', true), executable: relative(input.executable || '', true), arguments: input.arguments || [], requires: [], log: relative(input.log || '', true), marker: String(input.marker || '').trim() };
 if(!Array.isArray(p.arguments)||p.arguments.length>30||p.arguments.some(a=>typeof a!=='string'||a.length>500||/[\x00\r\n]/.test(a)))throw new Error('启动参数无效，每行一个参数，最多 30 个');
 if (!Array.isArray(input.requires || []) || (input.requires || []).length > 30 || p.marker.length > 160) throw new Error('前置或日志规则无效');
 p.requires = (input.requires || []).map(r => relative(r));
 if (p.mode === 'bepinex' && !p.requires.includes('BepInEx/core/BepInEx.dll')) p.requires.push('BepInEx/core/BepInEx.dll');
 if (p.mode === 'smapi' && !p.requires.includes('StardewModdingAPI.dll')) p.requires.push('StardewModdingAPI.dll');
 if (p.log && !p.marker) throw new Error('日志验证需填写成功标记；该标记必须来自加载器的实际日志'); return p;
}
const versionAtLeast = (a,b) => { const parse = s => /^\d+(?:\.\d+){1,3}$/.test(s || '') ? s.split('.').map(Number) : null; const x = parse(a), y = parse(b); if (!x || !y) return false; for (let i=0;i<Math.max(x.length,y.length);i++) { if ((x[i]||0)!==(y[i]||0)) return (x[i]||0)>(y[i]||0); } return true; };
function smapiEvidence(text,units){const loaded=new Set();let section=false;for(const line of text.split(/\r?\n/)){const msg=line.replace(/^\[[^\]]+\]\s?/, '');if(/^Loaded \d+ (?:mods|content packs):$/.test(msg)){section=true;continue;}if(section&&/^\s{3}/.test(msg)){const row=msg.trim();for(const u of units){const prefix=u.name+' '+u.version;if(row===prefix||row.startsWith(prefix+' by ')||row.startsWith(prefix+' |'))loaded.add(u.id);}}else if(msg.trim())section=false;}return [...loaded];}
async function manifests(root, prefix = '', depth = 0) {
 const result = []; if (depth > 5) return result;
 let entries; try { entries = await fs.readdir(root, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return result; throw e; }
 for (const e of entries) { if (e.isSymbolicLink() || e.name.startsWith('.')) continue; const rel = prefix ? prefix + '/' + e.name : e.name;
  if (e.isFile() && e.name.toLowerCase() === 'manifest.json') result.push({ manifest: await json(path.join(root,e.name)), rel });
  else if (e.isDirectory()) result.push(...await manifests(path.join(root,e.name),rel,depth+1));
  if (result.length > 2000) throw new Error('Mod 清单数量过多');
 } return result;
}
async function processes() {
 if (process.platform === 'win32') {
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile','-NonInteractive','-Command','Get-CimInstance Win32_Process | Select-Object ProcessId,ExecutablePath,Name | ConvertTo-Json -Compress'], { timeout: 15000, maxBuffer: 4*1024**2, windowsHide: true });
  const rows = JSON.parse(stdout || '[]'); return (Array.isArray(rows) ? rows : [rows]).map(p=>({pid:p.ProcessId,path:p.ExecutablePath || '',name:p.Name}));
 }
 const { stdout } = await promisify(execFile)('ps',['-axo','pid=,comm='],{timeout:10000,maxBuffer:4*1024**2});
 return stdout.split('\n').map(line=>{ const m=line.trim().match(/^(\d+)\s+(.*)$/); return m ? {pid:Number(m[1]),path:m[2],name:path.basename(m[2])}:null; }).filter(Boolean);
}
class Installers {
 constructor(root, downloads, options={}) { this.root=path.resolve(root,'installations'); this.downloads=downloads; this.options=options; this.state={profiles:{},mods:[],runs:[]}; this.plans=new Map(); this.busy=false; this.children=new Map(); }
 async open() {
  await fs.mkdir(this.root,{recursive:true}); try { this.state=await json(path.join(this.root,'state.json'),128*1024**2); } catch(e) { if(e.code!=='ENOENT')throw e; }
  try { const journal=await json(path.join(this.root,'journal.json'),128*1024**2); if(journal.phase!=='committed') { await this.rollback(journal); this.state=journal.before; await this.save(); } await fs.rm(path.join(this.root,'journal.json')); } catch(e) { if(e.code!=='ENOENT') throw new Error('安装事务恢复失败，保留备份：'+e.message); }
  await fs.rm(path.join(this.root,'plans'),{recursive:true,force:true});await fs.rm(path.join(this.root,'inspect'),{recursive:true,force:true});
  const owned=new Set(this.state.mods.map(m=>m.id));let dirs=[];try{dirs=await fs.readdir(path.join(this.root,'mods'));}catch(e){if(e.code!=='ENOENT')throw e;}for(const id of dirs)if(/^[0-9a-f-]{36}$/.test(id)&&!owned.has(id))await fs.rm(path.join(this.root,'mods',id),{recursive:true,force:true});
  for(const r of this.state.runs)if(r.status==='running'){r.status='interrupted';r.message='软件上次退出，无法确认当前游戏进程；请重新验证';} await this.save(); return this;
 }
 save(){return atomic(path.join(this.root,'state.json'),this.state);}
 view(games) { return {profiles:games.map(g=>({gameId:g.id,...this.getProfile(g)})),mods:this.state.mods,runs:this.state.runs.slice(0,30).map(r=>this.runView(r)),loadouts:this.state.loadouts||[],busy:this.busy}; }
 getProfile(game){ const p=this.state.profiles[game.id] || (presets[String(game.appId)] ? profile({...presets[String(game.appId)], root:process.platform==='darwin' && String(game.appId)==='413150'?'Contents/MacOS':''}) : defaultRecipe(game)?profile(defaultRecipe(game)):null); return {configured:!!p,preset:!this.state.profiles[game.id]&&!!p,rule:p}; }
 async exclusive(fn) { if(this.busy)throw new Error('正在处理安装任务，请稍后'); this.busy=true; try{return await fn();}finally{this.busy=false;} }
 async setProfile(game,input) { return this.exclusive(async()=>{const p=profile(input); await this.gameRoot(game,p); this.state.profiles[game.id]=p; await this.save(); return this.getProfile(game);}); }
 async gameRoot(game,p) { if(!game.installPath)throw new Error('游戏安装路径缺失'); const root=await fs.realpath(game.installPath); if(!p.root)return root; const sub=await target(root,p.root); if(!(await fs.stat(sub)).isDirectory())throw new Error('游戏根目录不是文件夹');return sub; }
 async guard(root,p) { const rows=await (this.options.processes || processes)(); const executable=p.executable && path.basename(p.executable).toLowerCase();for(const r of rows){if(r.pid===process.pid)continue;let real=r.path; if(real&&path.isAbsolute(real))try{real=await fs.realpath(real);}catch{try{real=path.join(await fs.realpath(path.dirname(real)),path.basename(real));}catch{}}if((real&&key(real).startsWith(key(root+path.sep)))||(executable&&String(r.name).toLowerCase()===executable))throw new Error('请先退出游戏及加载器，再修改 Mod 文件');} }
 async prerequisites(root,p) { for(const rel of p.requires)if(!await fileHash(await target(root,rel)))throw new Error('缺少前置文件：'+rel); }
 async checkSmapi(root,p,units,ignoreIds=[]){const ignored=new Set(ignoreIds.map(key));const existing=(await manifests(await target(root,p.destination||'Mods'))).filter(e=>!ignored.has(key(e.manifest.UniqueID||'')));for(const u of units){if(existing.some(e=>key(e.manifest.UniqueID||'')===key(u.id)))throw new Error('游戏中已存在同 UniqueID Mod：'+u.id);for(const dep of u.requirements||[]){const found=[...units.map(u=>({UniqueID:u.id,Version:u.version})),...existing.map(e=>e.manifest)].find(a=>key(a.UniqueID||'')===key(dep.UniqueID||''));if(!found||dep.MinimumVersion&&!versionAtLeast(found.Version,dep.MinimumVersion))throw new Error('缺少依赖或版本不足：'+dep.UniqueID);}for(const [required,file,library]of [[u.minimumApiVersion,'StardewModdingAPI.deps.json','SMAPI'],[u.minimumGameVersion,'Stardew Valley.deps.json','Stardew Valley']])if(required){let ver;try{const d=await json(await target(root,file));const name=Object.keys(d.libraries||{}).find(k=>k.startsWith(library+'/')||k.startsWith((library==='SMAPI'?'StardewModdingAPI':library)+'/'));ver=name?.split('/').at(-1);}catch{}if(!versionAtLeast(ver,required))throw new Error('无法确认满足最低版本：'+library+' ≥ '+required);}}}
 async inspect(game,jobId){return this.exclusive(async()=>{const job=this.downloads.jobs.find(j=>j.id===jobId&&j.gameId===game.id&&j.status==='completed');if(!job)throw new Error('请选择该游戏下载完成的文件');const f=await this.downloads.completedFile(jobId);if(!job.sha256||await hash(f.file)!==job.sha256)throw new Error('下载文件校验失败');const dir=path.join(this.root,'inspect',crypto.randomUUID());try{if(/\.zip$/i.test(f.name))return (await extract(f.file,dir)).map(f=>({path:f.source,size:f.size}));if(/\.(archive|pak|utoc|ucas)$/i.test(f.name))return [{path:relative(f.name),size:(await fs.stat(f.file)).size}];throw new Error('此压缩格式需要专用适配，当前支持 ZIP 或原始 archive/pak/utoc/ucas 文件');}finally{await fs.rm(dir,{recursive:true,force:true});}});}
 async prepare(game,jobId) { return this.exclusive(async()=>{
  for(const [id,p] of this.plans)if(Date.now()-p.created>15*60000){await fs.rm(p.stage,{recursive:true,force:true});this.plans.delete(id);} if(this.plans.size>=10)throw new Error('待安装方案过多，请完成或关闭旧方案');
  const p=this.getProfile(game).rule;if(!p)throw new Error('此游戏尚无安装规则，请先打开“安装规则”；所有扫描到的游戏都可配置');
  const job=this.downloads.jobs.find(j=>j.id===jobId && j.status==='completed' && j.gameId===game.id); if(!job)throw new Error('请选择该游戏下载完成的文件');
  if(this.state.mods.some(m=>m.gameId===game.id&&m.jobId===job.id))throw new Error('此文件已经安装，请在已安装 Mod 中管理');
  const root=await this.gameRoot(game,p);await this.guard(root,p);await this.prerequisites(root,p);
  const downloaded=await this.downloads.completedFile(jobId);if(!job.sha256 || await hash(downloaded.file)!==job.sha256)throw new Error('下载文件 SHA-256 已变化，请重新下载');
  if((await fs.stat(downloaded.file)).size>MAX)throw new Error('安装包超过当前 4 GB 安装限制');
  const id=crypto.randomUUID(),stage=path.join(this.root,'plans',id);await fs.mkdir(stage,{recursive:true});
  try{
   let files; if(/\.zip$/i.test(downloaded.name))files=await extract(downloaded.file,stage);
   else if(/\.(archive|pak|utoc|ucas)$/i.test(downloaded.name)){const source=relative(downloaded.name);await fs.copyFile(downloaded.file,path.join(stage,source));files=[{source,sha256:job.sha256,size:(await fs.stat(downloaded.file)).size}];}
   else throw new Error('当前安装引擎支持 ZIP 和 archive/pak/utoc/ucas 原始文件；RAR、7z、可执行安装器需专用解包适配');
   const archiveFiles=files.map(f=>({path:f.source,size:f.size}));let units=[]; const warnings=[];
   if(p.sourcePrefix){files=files.filter(f=>f.source.startsWith(p.sourcePrefix+'/'));if(!files.length)throw new Error('压缩包中不存在配置的内部目录：'+p.sourcePrefix);}
   if(p.mode==='smapi'){
    const found=await manifests(stage);if(!found.length)throw new Error('没有 SMAPI manifest.json；XNB 替换包或其他格式需配置自己的安装规则');
    const chosen=found.filter(x=>files.some(f=>f.source===x.rel));const existing=await manifests(await target(root,p.destination || 'Mods'));
    units=chosen.map(({manifest:m,rel})=>{if(!m.Name||!m.UniqueID||!m.Version||!/^[\w.-]+$/.test(m.UniqueID)||(!m.EntryDll&&!m.ContentPackFor))throw new Error('SMAPI 清单缺少名称、版本、UniqueID 或入口');return {id:m.UniqueID,name:m.Name,version:m.Version,folder:path.posix.dirname(rel),manifest:m};});
    if(!units.length)throw new Error('内部目录中没有 SMAPI Mod');
    if(units.some(u=>units.some(v=>u!==v&&(u.folder==='.'||v.folder.startsWith(u.folder+'/')))))throw new Error('包内有重叠的 Mod 清单目录，请分别选择内部目录安装');
    const identities=new Set();for(const u of units){if(identities.has(key(u.id)))throw new Error('压缩包重复 UniqueID：'+u.id);identities.add(key(u.id));if(existing.some(e=>key(e.manifest.UniqueID||'')===key(u.id)))throw new Error('游戏中已存在同 UniqueID Mod：'+u.id+'；请先卸载旧版本');
     if(u.manifest.EntryDll&&!files.some(f=>f.source===(u.folder==='.'?'':u.folder+'/')+relative(u.manifest.EntryDll)))throw new Error('清单入口 DLL 不存在：'+u.id);
     const deps=[...(u.manifest.Dependencies||[]).filter(d=>d.IsRequired!==false),...(u.manifest.ContentPackFor?[u.manifest.ContentPackFor]:[])];
     for(const dep of deps){const present=[...units.map(a=>({UniqueID:a.id,Version:a.version})),...existing.map(e=>e.manifest)].find(a=>key(a.UniqueID||'')===key(dep.UniqueID||''));if(!present || dep.MinimumVersion&&!versionAtLeast(present.Version,dep.MinimumVersion))throw new Error(`缺少依赖或版本不足：${dep.UniqueID}${dep.MinimumVersion?' ≥ '+dep.MinimumVersion:''}`);}
     for(const [field,file,library]of [['MinimumApiVersion','StardewModdingAPI.deps.json','SMAPI'],['MinimumGameVersion','Stardew Valley.deps.json','Stardew Valley']])if(u.manifest[field]){let ver;try{const d=await json(await target(root,file));const k=Object.keys(d.libraries||{}).find(k=>k.startsWith(library+'/')||k.startsWith((library==='SMAPI'?'StardewModdingAPI':library)+'/'));ver=k?.split('/').at(-1);}catch{}if(!versionAtLeast(ver,u.manifest[field]))throw new Error(`无法确认满足 ${field} ≥ ${u.manifest[field]}，请检查游戏或 SMAPI 版本`);}
    }
    files=files.filter(f=>units.some(u=>u.folder==='.'||f.source.startsWith(u.folder+'/'))).map(f=>{const u=units.find(u=>u.folder==='.'||f.source.startsWith(u.folder+'/'));const tail=u.folder==='.'?f.source:f.source.slice(u.folder.length+1);return {...f,destination:[p.destination||'Mods',u.id,tail].join('/')};});
   }else if(['archive','pak'].includes(p.mode)){
    const ext=p.mode==='archive'?/\.archive$/i:/\.(pak|utoc|ucas)$/i;const unsupported=files.filter(f=>!ext.test(f.source)&&!/\.(txt|md|pdf|png|jpe?g|webp)$/i.test(f.source));if(unsupported.length)throw new Error('此规则仅适用 '+(p.mode==='archive'?'纯 archive':'pak/utoc/ucas')+' 包；还有其他类型：'+unsupported.slice(0,4).map(f=>f.source).join('、'));
    files=files.filter(f=>ext.test(f.source)).map(f=>({...f,destination:[p.destination,path.posix.basename(f.source)].filter(Boolean).join('/')}));if(!files.length)throw new Error('没有匹配此规则的 Mod 文件');
    if(p.mode==='archive')for(const f of files){const h=await fs.open(path.join(stage,f.source),'r');const b=Buffer.alloc(4);try{await h.read(b,0,4,0);}finally{await h.close();}if(b.toString()!=='RDAR')throw new Error('archive 文件头无效：'+f.source);}
    warnings.push('包内无法可靠声明全部框架前置或游戏版本要求，请核对作者说明。');
   }else{
    if(p.mode==='bethesda'){
     if(archiveFiles.some(f=>/(^|\/)fomod\//i.test(f.path)))throw new Error('此包需要 FOMOD 选项安装，不能按 Data 包部署');
     const content=files.filter(f=>! /\.(txt|md|pdf|png|jpe?g|webp)$/i.test(f.source));
     if(!content.some(f=>/\.(esp|esm|esl|bsa|ba2)$/i.test(f.source)))throw new Error('未发现 Bethesda 插件或资源档案');
     if(content.some(f=>/\.(exe|bat|cmd|ps1|dll)$/i.test(f.source)))throw new Error('Data 包含加载器或可执行文件，请按作者说明配置独立规则');
     files=content;warnings.push('插件部署不等于启用：需在游戏或相应加载器中确认插件启用与排序。');
    }
    files=files.map(f=>({...f,destination:[p.destination,p.sourcePrefix?f.source.slice(p.sourcePrefix.length+1):p.mode==='bethesda'?f.source.replace(/^Data\//i,''):f.source].filter(Boolean).join('/')}));warnings.push('按你为该游戏配置的规则部署。软件不会执行压缩包内的安装脚本；须核对作者目录、依赖及版本要求。');
   }
   const names=new Set();for(const f of files){f.destination=relative(f.destination);if(names.has(key(f.destination)))throw new Error('安装目标重复：'+f.destination);names.add(key(f.destination));
    const owner=this.state.mods.find(m=>key(m.root)===key(root)&&m.files.some(other=>key(other.destination)===key(f.destination)));if(owner)throw new Error('与已托管 Mod 冲突：'+owner.name+' / '+f.destination);
    f.originalHash=await fileHash(await target(root,f.destination));
   }
   const plan={id,gameId:game.id,gameName:game.name,root,profile:p,profileHash:digest(p),jobId:job.id,name:job.name,resourceId:job.resourceId,stage,files,units:units.map(({manifest,...u})=>({...u,minimumApiVersion:manifest.MinimumApiVersion,minimumGameVersion:manifest.MinimumGameVersion,requirements:[...(manifest.Dependencies||[]).filter(d=>d.IsRequired!==false),...(manifest.ContentPackFor?[manifest.ContentPackFor]:[])]})),warnings,archiveFiles,created:Date.now()};this.plans.set(id,plan);return this.planView(plan);
  }catch(e){await fs.rm(stage,{recursive:true,force:true});throw e;}
 }); }
 planView(p){return {...p,stage:undefined,profileHash:undefined,files:p.files.map(f=>({...f,overwrite:!!f.originalHash})),expires:new Date(p.created+15*60000).toISOString()};}
 async discard(id){return this.exclusive(async()=>{const p=this.plans.get(id);if(p){this.plans.delete(id);await fs.rm(p.stage,{recursive:true,force:true});}return {ok:true};});}
 async apply(game,id,allowOverwrite=false){return this.exclusive(async()=>{
  const p=this.plans.get(id);if(!p||p.gameId!==game.id||Date.now()-p.created>15*60000)throw new Error('安装方案已过期，请重新生成');
  if(digest(this.getProfile(game).rule)!==p.profileHash||await this.gameRoot(game,p.profile)!==p.root)throw new Error('游戏路径或安装规则已变化，请重新生成方案');
  await this.guard(p.root,p.profile);await this.prerequisites(p.root,p.profile);
  if(p.profile.mode==='smapi')await this.checkSmapi(p.root,p.profile,p.units);
  if(p.files.some(f=>f.originalHash)&&!allowOverwrite)throw new Error('方案将替换已有文件，请确认备份和替换');
  const dir=path.join(this.root,'mods',id);await fs.mkdir(path.join(dir,'payload'),{recursive:true});await fs.mkdir(path.join(dir,'original'),{recursive:true});
  const files=[];for(let i=0;i<p.files.length;i++){const f=p.files[i];const dest=await target(p.root,f.destination);if(await fileHash(dest)!==f.originalHash)throw new Error('方案生成后目标文件已改变：'+f.destination);
   if(this.state.mods.some(m=>key(m.root)===key(p.root)&&m.files.some(a=>key(a.destination)===key(f.destination))))throw new Error('安装方案已与其他托管 Mod 冲突，请重新生成');
   if(await hash(path.join(p.stage,f.source))!==f.sha256)throw new Error('暂存文件校验失败');await fs.copyFile(path.join(p.stage,f.source),path.join(dir,'payload',String(i)));if(f.originalHash)await fs.copyFile(dest,path.join(dir,'original',String(i)));files.push({...f,index:i});
  }
  const record={id,gameId:game.id,gameName:game.name,name:p.name,resourceId:p.resourceId,jobId:p.jobId,version:this.downloads.jobs.find(j=>j.id===p.jobId)?.version||'',root:p.root,profile:p.profile,files,units:p.units,status:'enabled',created:new Date().toISOString(),verification:{status:'deployed',message:'文件已部署并校验；尚未验证游戏内生效'}};
  await this.transaction(record,'install');this.plans.delete(id);await fs.rm(p.stage,{recursive:true,force:true});return record;
 });}
 async action(game,id,action){return this.exclusive(async()=>{if(!['enable','disable','uninstall','verify'].includes(action))throw new Error('未知安装操作');const m=this.state.mods.find(m=>m.id===id&&m.gameId===game.id);if(!m)throw new Error('未找到该游戏的安装记录');if(await this.gameRoot(game,m.profile)!==m.root)throw new Error('游戏安装路径已变化，请恢复原目录后管理旧 Mod');
  if(action==='verify'){const bad=[];for(const f of m.files)if(await fileHash(await target(m.root,f.destination))!==(m.status==='enabled'?f.sha256:f.originalHash))bad.push(f.destination);m.verification={status:bad.length?'changed':'files_ok',message:bad.length?'文件缺失或已修改：'+bad.slice(0,5).join('、'):'托管文件校验通过；尚不能据此确认游戏内生效',checked:new Date().toISOString()};await this.save();return m;}
  await this.guard(m.root,m.profile);if(action==='enable')await this.prerequisites(m.root,m.profile);if(action==='enable'&&m.status==='enabled'||action==='disable'&&m.status==='disabled')return m;
  if(action==='enable'&&m.profile.mode==='smapi')await this.checkSmapi(m.root,m.profile,m.units);
  if(action!=='enable'&&m.status==='enabled'){const removing=new Set(m.units.map(u=>key(u.id)));const other=await manifests(await target(m.root,m.profile.destination||'Mods')).catch(()=>[]);for(const {manifest:x}of other){if(removing.has(key(x.UniqueID||'')))continue;const deps=[...(x.Dependencies||[]).filter(d=>d.IsRequired!==false),...(x.ContentPackFor?[x.ContentPackFor]:[])];if(deps.some(d=>removing.has(key(d.UniqueID||''))))throw new Error('另一个 Mod 依赖当前 Mod：'+x.Name+'，请先停用依赖者');}}
  await this.transaction(m,action);return {ok:true,mod:this.state.mods.find(a=>a.id===id)};
 });}
 async transaction(m,action){
  const before=structuredClone(this.state),dir=path.join(this.root,'mods',m.id);const changes=[];
  for(const f of m.files){const dest=await target(m.root,f.destination);const expected=action==='install'||m.status==='disabled'?f.originalHash:f.sha256;const after=action==='install'||action==='enable'?f.sha256:f.originalHash;
   if(await fileHash(dest)!==expected)throw new Error('文件被外部修改，操作已停止以保留改动：'+f.destination);
   const from=after===f.sha256?path.join(dir,'payload',String(f.index)):after?path.join(dir,'original',String(f.index)):null;if(from&&await hash(from)!==after)throw new Error('备份或安装载荷损坏，操作已停止');
   changes.push({root:m.root,rel:f.destination,before:expected,after,beforeFile:expected===f.sha256?path.join(dir,'payload',String(f.index)):expected?path.join(dir,'original',String(f.index)):null,afterFile:from});
  }
  const createdDirs=[];for(const c of changes){let rel=path.posix.dirname(c.rel);while(rel!=='.'){try{await fs.lstat(await target(c.root,rel));break;}catch(e){if(e.code!=='ENOENT')throw e;}createdDirs.push({root:c.root,rel});rel=path.posix.dirname(rel);}}
  if(action==='install')m.createdDirs=createdDirs;
  const journal={before,changes,createdDirs,phase:'writing'};await atomic(path.join(this.root,'journal.json'),journal);
  try{
   for(let i=0;i<changes.length;i++){const c=changes[i];await this.writeChange(c,c.after,c.afterFile,c.before);if(this.options.afterWrite)await this.options.afterWrite(i,c);}
   if(action==='install')this.state.mods.unshift(m);else if(action==='uninstall')this.state.mods=this.state.mods.filter(a=>a.id!==m.id);else {m.status=action==='enable'?'enabled':'disabled';m.verification={status:'deployed',message:'文件状态已改变，请重新校验和运行验证'};}
   await this.save();journal.phase='committed';await atomic(path.join(this.root,'journal.json'),journal);
  }catch(e){await this.rollback(journal);this.state=before;await this.save();await fs.rm(path.join(this.root,'journal.json'));throw new Error('操作失败，文件已回滚：'+e.message);}
  await fs.rm(path.join(this.root,'journal.json'));
  if(action==='disable'||action==='uninstall')await this.cleanDirs(m.createdDirs||[]);
  if(action==='uninstall')await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});
 }
 async writeChange(c,h,source,expected){const dest=await target(c.root,c.rel);if(await fileHash(dest)!==expected)throw new Error('目标文件发生变化：'+c.rel);if(!h){await fs.rm(dest,{force:true});return;}await fs.mkdir(path.dirname(dest),{recursive:true});const tmp=path.join(path.dirname(dest),'.moddock-'+crypto.randomUUID()+'.tmp');try{await fs.copyFile(source,tmp);if(await hash(tmp)!==h)throw new Error('写入校验失败');await target(c.root,c.rel);if(await fileHash(dest)!==expected)throw new Error('写入前目标文件发生变化');await fs.rename(tmp,dest);if(await hash(dest)!==h)throw new Error('目标校验失败');}finally{await fs.rm(tmp,{force:true});}}
 async cleanDirs(dirs){for(const {root,rel}of [...dirs].sort((a,b)=>b.rel.length-a.rel.length)){try{await fs.rmdir(await target(root,rel));}catch{ /* Retain directories containing unowned/generated files. */ }}}
 async rollback(journal){for(const c of [...journal.changes].reverse()){const h=await fileHash(await target(c.root,c.rel));if(h===c.before)continue;if(h!==c.after)throw new Error('回滚检测到外部文件改动，保留恢复日志：'+c.rel);await this.writeChange(c,c.before,c.beforeFile,c.after);}await this.cleanDirs(journal.createdDirs||[]);}
 async saveLoadout(game,name){return this.exclusive(async()=>{
  if(typeof name!=='string'||!name.trim()||name.length>80)throw new Error('配置档案名称应为 1–80 个字符');
  const loadout={id:crypto.randomUUID(),gameId:game.id,name:name.trim(),rule:this.getProfile(game).rule,mods:this.state.mods.filter(m=>m.gameId===game.id).map(m=>({id:m.id,status:m.status,jobId:m.jobId})),created:new Date().toISOString()};
  this.state.loadouts ||= [];if(this.state.loadouts.filter(l=>l.gameId===game.id).length>=30)throw new Error('每款游戏最多保存 30 个档案');this.state.loadouts.push(loadout);await this.save();return loadout;
 });}
 async deleteLoadout(game,id){return this.exclusive(async()=>{this.state.loadouts=(this.state.loadouts||[]).filter(l=>!(l.id===id&&l.gameId===game.id));await this.save();return {ok:true};});}
 async switchLoadout(game,id){return this.exclusive(async()=>{
  const l=(this.state.loadouts||[]).find(l=>l.id===id&&l.gameId===game.id);if(!l)throw new Error('配置档案不存在');
  const mods=this.state.mods.filter(m=>m.gameId===game.id);for(const entry of l.mods)if(!mods.some(m=>m.id===entry.id&&m.jobId===entry.jobId))throw new Error('档案中的 Mod 已卸载或替换，请重新保存档案');
  const desired=new Map(l.mods.map(m=>[m.id,m.status]));const enabled=mods.filter(m=>desired.get(m.id)==='enabled');
  const allIds=new Set(mods.flatMap(m=>m.units.map(u=>key(u.id))));const units=enabled.flatMap(m=>m.units);if(new Set(units.map(u=>key(u.id))).size!==units.length)throw new Error('档案有重复的 SMAPI UniqueID');
  const roots=new Map();for(const m of mods){if(await this.gameRoot(game,m.profile)!==m.root)throw new Error('游戏安装路径已变化');await this.guard(m.root,m.profile);if(enabled.includes(m))await this.prerequisites(m.root,m.profile);if(m.profile.mode==='smapi')roots.set(m.root+'\0'+m.profile.destination,m);}
  for(const m of roots.values()){
   const group=mods.filter(a=>a.root===m.root&&a.profile.mode==='smapi'&&a.profile.destination===m.profile.destination);const ignored=group.flatMap(a=>a.units.map(u=>key(u.id)));const chosen=enabled.filter(a=>group.includes(a)).flatMap(a=>a.units);
   await this.checkSmapi(m.root,m.profile,chosen,ignored);
   const external=(await manifests(await target(m.root,m.profile.destination||'Mods'))).map(e=>e.manifest).filter(e=>!ignored.includes(key(e.UniqueID||'')));
   const available=[...chosen.map(u=>({UniqueID:u.id,Version:u.version})),...external];
   for(const x of external){const dependencies=[...(x.Dependencies||[]).filter(d=>d.IsRequired!==false),...(x.ContentPackFor?[x.ContentPackFor]:[])];for(const d of dependencies.filter(d=>ignored.includes(key(d.UniqueID||'')))){const found=available.find(a=>key(a.UniqueID||'')===key(d.UniqueID||''));if(!found||d.MinimumVersion&&!versionAtLeast(found.Version,d.MinimumVersion))throw new Error('游戏中另一个 Mod 依赖档案将停用的项：'+x.Name);}}
  }
  if(l.rule)await this.gameRoot(game,l.rule);
  const changes=[];for(const m of mods){const next=desired.get(m.id)||'disabled';const dir=path.join(this.root,'mods',m.id);
   for(const f of m.files){const before=m.status==='enabled'?f.sha256:f.originalHash;const after=next==='enabled'?f.sha256:f.originalHash;if(await fileHash(await target(m.root,f.destination))!==before)throw new Error('文件被外部修改，档案切换已停止：'+f.destination);
    if(before===after)continue;const src=h=>h===f.sha256?path.join(dir,'payload',String(f.index)):h?path.join(dir,'original',String(f.index)):null;
    for(const h of [before,after])if(h&&await hash(src(h))!==h)throw new Error('档案载荷或备份校验失败');changes.push({root:m.root,rel:f.destination,before,after,beforeFile:src(before),afterFile:src(after)});
   }
  }
  const createdDirs=[];for(const c of changes){let rel=path.posix.dirname(c.rel);while(rel!=='.'){try{await fs.lstat(await target(c.root,rel));break;}catch(e){if(e.code!=='ENOENT')throw e;}createdDirs.push({root:c.root,rel});rel=path.posix.dirname(rel);}}
  const journal={before:structuredClone(this.state),changes,createdDirs,phase:'writing'};await atomic(path.join(this.root,'journal.json'),journal);
  try{for(let i=0;i<changes.length;i++){const c=changes[i];await this.writeChange(c,c.after,c.afterFile,c.before);if(this.options.afterWrite)await this.options.afterWrite(i,c);}for(const m of mods){m.status=desired.get(m.id)||'disabled';m.verification={status:'deployed',message:'已切换配置档案，需重新验证运行'};}if(l.rule)this.state.profiles[game.id]=l.rule;await this.save();journal.phase='committed';await atomic(path.join(this.root,'journal.json'),journal);
  }catch(e){await this.rollback(journal);this.state=journal.before;await this.save();await fs.rm(path.join(this.root,'journal.json'));throw new Error('档案切换失败，已回滚：'+e.message);}
  await fs.rm(path.join(this.root,'journal.json'));for(const m of mods.filter(m=>m.status==='disabled'))await this.cleanDirs(m.createdDirs||[]);return {ok:true};
 });}
 async logPath(root,p){if(p.log)return target(root,p.log);if(p.mode==='smapi')return path.join(process.platform==='win32'?path.join(process.env.APPDATA||'','StardewValley'):path.join(os.homedir(),'.config','StardewValley'),'ErrorLogs','SMAPI-latest.txt');return null;}
 async readLog(file){try{const st=await fs.stat(file);if(!st.isFile()||st.size>8*1024**2)throw new Error('运行日志体积超过限制');const text=await fs.readFile(file,'utf8');return {text,hash:digest(text),mtime:st.mtimeMs};}catch(e){if(e.code==='ENOENT')return {text:'',hash:null,mtime:0};throw e;}}
 async launch(game){return this.exclusive(async()=>{const p=this.getProfile(game).rule;if(!p||!p.executable)throw new Error('请在安装规则中设置游戏或加载器可执行文件');const root=await this.gameRoot(game,p);await this.guard(root,p);await this.prerequisites(root,p);const file=await target(root,p.executable);const h=await fs.open(file,'r');const b=Buffer.alloc(4);try{await h.read(b,0,4,0);}finally{await h.close();}if(!(b.subarray(0,2).toString()==='MZ'||b.toString()==='\x7fELF'||[0xfeedface,0xfeedfacf,0xcefaedfe,0xcffaedfe,0xcafebabe].includes(b.readUInt32BE())))throw new Error('启动入口必须是游戏原生可执行文件；不执行脚本或安装器');
  for(const m of this.state.mods.filter(m=>m.gameId===game.id&&m.status==='enabled')){if(await this.gameRoot(game,m.profile)!==m.root)throw new Error('已有 Mod 的游戏安装路径已变化，请先处理旧安装记录');await this.prerequisites(m.root,m.profile);for(const f of m.files)if(await fileHash(await target(m.root,f.destination))!==f.sha256)throw new Error('已安装 Mod 文件校验失败，请先处理：'+f.destination);}
  const managed=this.state.mods.filter(m=>m.gameId===game.id&&m.status==='enabled').map(m=>({id:m.id,units:m.units}));
  const logFile=await this.logPath(root,p),baseline=logFile?await this.readLog(logFile):null;const r={id:crypto.randomUUID(),gameId:game.id,gameName:game.name,started:new Date().toISOString(),status:'running',message:'已请求启动；等待进程及本次日志验证',executable:p.executable,root,profile:p,managed,logFile,baseline:baseline?.hash,baselineLength:baseline?.text.length||0};
  const child=(this.options.spawn||spawn)(file,p.arguments||[],{cwd:root,stdio:'ignore',windowsHide:false,shell:false,detached:false});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});r.pid=child.pid;this.children.set(r.id,child);this.state.runs.unshift(r);await this.save();child.once('exit',(code,signal)=>{r.exitCode=code;r.signal=signal;r.exited=new Date().toISOString();this.children.delete(r.id);});return this.runView(r);
 });}
 runView({baseline,baselineText,profile,logFile,...r}){return r;}
 async checkRun(game,id){return this.exclusive(async()=>{const r=this.state.runs.find(r=>r.id===id&&r.gameId===game.id);if(!r)throw new Error('运行记录不存在');if(await this.gameRoot(game,r.profile)!==r.root)throw new Error('游戏路径已变化，无法检查旧运行日志');let alive=false;if(!r.exited){try{process.kill(r.pid,0);alive=true;}catch{}}const log=r.logFile?await this.readLog(r.logFile):null;let newText='';if(log&&log.hash!==r.baseline&&log.mtime>=Date.parse(r.started)-1000)newText=digest(log.text.slice(0,r.baselineLength))===r.baseline?log.text.slice(r.baselineLength):log.text;
  const errors=newText.split('\n').filter(s=>/\b(ERROR|FATAL)\b|Skipped mods|failed to load|could not be loaded/i.test(s));let loaded=r.profile.marker&&newText.includes(r.profile.marker);
  if(r.profile.mode==='smapi'){const units=(r.managed||[]).flatMap(m=>m.units);r.loadedUnits=smapiEvidence(newText,units);loaded=units.length>0&&r.loadedUnits.length===units.length;for(const snapshot of r.managed||[]){const m=this.state.mods.find(m=>m.id===snapshot.id);if(m&&snapshot.units.length&&snapshot.units.every(u=>r.loadedUnits.includes(u.id)))m.verification={status:errors.length?'loader_with_errors':'loader_loaded',runId:r.id,checked:new Date().toISOString(),message:errors.length?'SMAPI 本次列出了此 Mod，但运行日志存在错误，请查看运行记录':'SMAPI 本次加载列表确认此 Mod 名称和版本；游戏内效果仍需确认'};}}
  r.status=errors.length?'log_error':loaded?'log_confirmed':alive?'running':r.exitCode!==undefined&&r.exitCode!==0?'failed':'needs_confirmation';r.message=errors.length?'本次日志检测到错误：'+errors.slice(0,3).join(' / '):loaded?(r.profile.mode==='smapi'?'SMAPI 本次加载列表包含所有托管 Mod 的名称和版本；仍需在游戏中确认效果':'本次运行日志出现配置的加载成功标记；仍需在游戏中确认效果'):alive?'游戏进程正在运行；未取得 Mod 加载证据，请在游戏内确认':'游戏进程已退出或未能跟踪；未确认 Mod 生效';r.checked=new Date().toISOString();await this.save();return this.runView(r);
 });}
}
module.exports={Installers,relative,target,extract,profile,hash,versionAtLeast,smapiEvidence};
