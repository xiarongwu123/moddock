const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const parser = require('./vendor/luaparse/luaparse.cjs');
const VERSION = 1;
const GAME = '/Script/ReadyOrNot.';
const arity = new Map(Object.entries({AddImpulse: 3, SetViewTargetWithBlend: 5, LineTraceSingle: 12,
 K2_SetActorLocation: 4, K2_SetActorLocationAndRotation: 5, SetCollisionEnabled: 1}));
const ronArity = new Map(Object.entries({ToggleThirdPerson: 0, DecreaseHealth: 1, IncreaseHealth: 1,
 EnableRagdoll: 2, Multicast_EnableRagdoll: 2, DisableRagdoll: 0, Multicast_DisableRagdoll: 0,
 SpawnBloodPool: 0, OnKilled: 1, OnIncapacitated: 1, Multicast_OnKilled: 2, Multicast_OnIncapacitated: 1}));
const native = new Set(['IsValid','IsA','GetWorld','GetAddress','GetFullName','GetClass',
 ...arity.keys(), ...ronArity.keys(), 'GetMesh','GetControlRotation','K2_GetActorLocation',
 'IsDeadOrUnconscious','IsOnSWATTeam','IsCivilian','IsArrested','SpawnActor','PrintString']);
const engineGlobals = new Set(['StaticFindObject','FindFirstOf','FindAllOf','FindObjects','StaticConstructObject']);
const mutation = new Set(['EnableRagdoll','Multicast_EnableRagdoll','DisableRagdoll',
 'SetAllBodiesSimulatePhysics','K2_DestroyActor','SetViewTargetWithBlend','ToggleThirdPerson']);
const scheduled = new Set(['ExecuteInGameThread','ExecuteInGameThreadWithDelay','LoopInGameThreadWithDelay',
 'ExecuteInGameThreadAfterFrames','LoopInGameThreadAfterFrames']);
const async = new Set(['ExecuteWithDelay','LoopAsync']);
function children(node) {
 return Object.entries(node).filter(([key]) => !['loc','range','comments'].includes(key))
  .flatMap(([,v]) => Array.isArray(v) ? v : [v]).filter(v => v && typeof v === 'object' && v.type);
}
function name(node) {
 if (!node) return '';
 if (node.type === 'Identifier') return node.name;
 if (node.type === 'MemberExpression') return name(node.base) + node.indexer + node.identifier.name;
 return '';
}
const method = node => node?.type === 'MemberExpression' ? node.identifier.name : '';
function literal(node) {
 if (node?.type !== 'StringLiteral') return '';
 return node.value ?? node.raw?.slice(1,-1) ?? '';
}
function some(node, predicate) { return !!node && (predicate(node) || children(node).some(c => some(c,predicate))); }
function parseSource(source) {
 // luaparse handles 5.3; erase only real 5.4 local-variable attribute tokens,
 // preserving offsets/newlines. The independent Lua 5.4 compiler is authoritative.
 parser.parse(source,{wait:true,luaVersion:'5.3',comments:false});
 const tokens=[];
 for(;;) { const token=parser.lex(); tokens.push(token); if(token.type===1)break; }
 const ranges=[];
 for(let i=0;i<tokens.length;i++) if(tokens[i].type===4&&tokens[i].value==='local') {
  let j=i+1;
  while(tokens[j]?.type===8) {
   j++;
   if(tokens[j]?.value==='<' && ['const','close'].includes(tokens[j+1]?.value) && tokens[j+2]?.value==='>') {
    ranges.push([tokens[j].range[0],tokens[j+2].range[1]]); j+=3;
   }
   if(tokens[j]?.value!==',')break;
   j++;
  }
 }
 let normalized=source;
 for(const [start,end] of ranges.reverse()) normalized=normalized.slice(0,start)+normalized.slice(start,end).replace(/[^\r\n]/g,' ')+normalized.slice(end);
 return parser.parse(normalized,{luaVersion:'5.3',locations:true,ranges:true,comments:false});
}
function analyzeUE4SS(source, {game = {}, installed = []} = {}) {
 const findings = [], seen = new Set();
 function add(code,node,message,severity='error') {
  const line = node?.loc?.start.line || 1, key = code + ':' + line;
  if (!seen.has(key)) { seen.add(key); findings.push({code,line,severity,message}); }
 }
 let tree;
 try { tree = parseSource(source); }
 catch (e) {
  return {version:VERSION,passed:false,runtimeVerified:false,findings:[{code:'UE4SS_ANALYSIS_SYNTAX',severity:'error',line:e.line || 1,
   message:'无法完成风险分析：' + e.message + '。请结合独立 Lua 5.4 编译结果修正此处语法后重试；风险分析未通过不能视为已验证。'}]};
 }
 const ron = require('./studio-game-api.cjs').isReadyOrNot(game);
 const scopes = new WeakMap(), scopesRoot={parent:null,bindings:new Map()};
 function bind(scope,key,value) { if(key) scope.bindings.set(key,value); }
 function resolve(scope,key) { for(let s=scope;s;s=s.parent) if(s.bindings.has(key)) return s.bindings.get(key); }
 function index(node,scope) {
  scopes.set(node,scope);
  if(node.type==='FunctionDeclaration') {
   if(node.identifier) bind(scope,name(node.identifier),{fn:node});
   const inner={parent:scope,bindings:new Map()};
   for(const p of node.parameters) bind(inner,name(p),{parameter:true});
   for(const child of node.body) index(child,inner);
   return;
  }
  if(['LocalStatement','AssignmentStatement'].includes(node.type)) {
   node.variables.forEach((v,i)=>{
    const value=node.init[i];
    bind(scope,name(v),{fn:value?.type==='FunctionDeclaration'?value:null,value,
     lookup:some(value,c=>c.type==='CallExpression' && name(c.base)==='StaticFindObject')});
   });
  }
  for(const child of children(node)) index(child,scope);
 }
 index(tree,scopesRoot);
 function forwardingWrapper(fn) {
  const key=fn?.parameters?.[1]?.name;
  return !!key && some(fn,n=>n.type==='IndexExpression' && n.index.type==='Identifier' && n.index.name===key)
   && some(fn,n=>n.type==='CallExpression' && name(n.base)==='table.unpack');
 }
 function scan(node) {
  if(node.type==='CallExpression') {
   const m=method(node.base), required=arity.get(m) ?? (ron ? ronArity.get(m) : undefined);
   if(required!==undefined && node.base.indexer===':' && !node.arguments.some(a=>a.type==='VarargLiteral') && node.arguments.length!==required)
    add('UE4SS_NATIVE_ARITY',node,`${m} 需要 ${required} 个显式参数，本次为 ${node.arguments.length} 个；按真实反射签名修正，不要通过不同参数数量重试。`);
   const wrapper=resolve(scopes.get(node),name(node.base))?.fn;
   if(forwardingWrapper(wrapper)) {
    const target=literal(node.arguments[1]), count=arity.get(target) ?? (ron?ronArity.get(target):undefined);
    if(count!==undefined && !node.arguments.some(a=>a.type==='VarargLiteral') && node.arguments.length-2!==count)
     add('UE4SS_NATIVE_ARITY',node,`${target} 的转发调用需要 ${count} 个原生参数，本次为 ${node.arguments.length-2} 个；pcall 包装不会改变原生签名。`);
   }
   if(ron && m==='PrintString') add('RON_NATIVE_DIAGNOSTIC',node,'该游戏已有 PrintString/FName 原生崩溃回归记录。可选提示使用 print；若屏幕提示是核心需求，请提供已验证的替代接口，不要删除核心功能。');
   if(ron && m==='MagCheck') add('RON_NATIVE_DIAGNOSTIC',node,'不要使用曾触发原生崩溃的 MagCheck 作为测试/提示动作；使用可观察的实际目标功能验证。');
  }
  if(node.type==='ReturnStatement') for(const value of node.arguments) {
   if(value.type==='BinaryExpression' && ['~=','=='].includes(value.operator)) {
    const variable=value.left.type==='NilLiteral'?value.right:value.right.type==='NilLiteral'?value.left:null;
    if(variable?.type==='Identifier' && resolve(scopes.get(node),variable.name)?.lookup)
     add('UE4SS_INVALID_LOOKUP',value,'StaticFindObject 的非 nil 返回值仍可能无效。返回/判断 IsValid() 的结果，不能仅用 nil 比较表示接口可用。');
   }
  }
  for(const child of children(node)) scan(child);
 }
 scan(tree);
 // Follow named helper callbacks and dispatch boundaries. Unresolved dynamic
 // calls remain outside the proof; findings do not certify arbitrary Lua.
 const visited=new WeakMap();
 function functionFor(expression,scope) {
  if(expression?.type==='FunctionDeclaration') return expression;
  return resolve(scope,name(expression))?.fn;
 }
 function walk(node,mode='unknown',wrappers=new Set()) {
  if(node.type==='FunctionDeclaration') return;
  if(node.type==='CallExpression') {
   const callee=name(node.base), m=method(node.base), scope=scopes.get(node);
   if(mode==='worker' && (native.has(m) || engineGlobals.has(callee) || callee.startsWith('UEHelpers.Get')))
    add('UE4SS_OFF_THREAD',node,'异步回调正在访问 UObject/反射接口。把全部读取、校验和写入放入游戏线程回调，而不只是最后的赋值。');
   if(mode==='hook' && mutation.has(m)) add('UE4SS_REENTRANT_MUTATION',node,'原生事件回调内直接改变相机/物理/Actor 生命周期，存在重入风险。事件内同步读取必要参数，去重并在事件链结束后重新确认对象再修改。');
   if(mode==='deferred' && m==='get' && wrappers.has(name(node.base.base)))
    add('UE4SS_BORROWED_PARAM',node,'延迟回调保留了 RegisterHook 参数包装器。请在原回调内 get() 并复制必要的原始值，执行时重新查找目标。');
   if(callee==='pcall'||callee==='xpcall') {
    const protectedFunction=functionFor(node.arguments[0],scope);
    if(protectedFunction) follow(protectedFunction,mode,wrappers);
   }
   if(async.has(callee) || scheduled.has(callee) || callee==='RegisterHook' || callee==='RegisterKeyBind') {
    let callbackIndexes, nextMode;
    if(callee==='RegisterHook') { callbackIndexes=[1,2]; nextMode='hook'; }
    else if(callee==='RegisterKeyBind') { callbackIndexes=[node.arguments.length-1]; nextMode='worker'; }
    else { callbackIndexes=[node.arguments.length-1]; nextMode=async.has(callee)?'worker':'deferred'; }
    for(const i of callbackIndexes) {
     const fn=functionFor(node.arguments[i],scope);
     if(fn) {
      const params=callee==='RegisterHook'?new Set(fn.parameters.map(name)):wrappers;
      follow(fn,nextMode,params);
     }
    }
    for(let i=0;i<node.arguments.length;i++) if(!callbackIndexes.includes(i)) walk(node.arguments[i],mode,wrappers);
    return;
   }
   const fn=functionFor(node.base,scope);
   if(fn) follow(fn,mode,wrappers);
  }
  for(const child of children(node)) walk(child,mode,wrappers);
 }
 function follow(fn,mode,wrappers) {
  const key=mode+':'+[...wrappers].sort().join(',');
  let modes=visited.get(fn); if(!modes) visited.set(fn,modes=new Set());
  if(modes.has(key)) return; modes.add(key);
  for(const child of fn.body) walk(child,mode,wrappers);
 }
 walk(tree);
 function discover(node) {
  if(node.type==='FunctionDeclaration') follow(node,'unknown',new Set());
  for(const child of children(node)) discover(child);
 }
 discover(tree);
 const traits = {
  cameraNative:some(tree,n=>n.type==='CallExpression' && (method(n.base)==='ToggleThirdPerson' || literal(n.arguments[0]).endsWith(':ToggleThirdPerson'))),
  cameraCustom:some(tree,n=>n.type==='CallExpression' && method(n.base)==='SetViewTargetWithBlend'),
  physics:some(tree,n=>n.type==='CallExpression' && mutation.has(method(n.base)) && /Ragdoll|Bodies/.test(method(n.base))),
 };
 if((traits.cameraNative||traits.cameraCustom) && installed.some(m=>m.cameraNative||m.cameraCustom))
  add('UE4SS_CAMERA_OVERLAP',tree,'已启用脚本也在修改相机。核对 installedUE4SS 中的来源/版本，优先复用同一原生相机状态；独立相机循环与内置切换需兼容处理。','warning');
 return {version:VERSION,passed:!findings.some(f=>f.severity==='error'),runtimeVerified:false,traits,findings,
  coverage:'静态已知风险分析；不执行生成代码，未证明原生兼容、对象生命周期或游戏内效果。'};
}

async function installedUE4SS(game, diagnostic) {
 const mods=[], loaders=diagnostic.loaderFiles?.UE4SS || [];
 if(loaders.length!==1) return {mods,truncated:false,note:'未定位唯一已安装 UE4SS，不能推断 Mod 共存状态。'};
 const root=await fs.realpath(game.installPath), directory=path.join(root,path.dirname(loaders[0]),'Mods');
 // Never follow a game-side link or read outside the selected game.
 async function local(file,limit) {
  const stat=await fs.lstat(file), real=await fs.realpath(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>limit||!real.toLowerCase().startsWith(root.toLowerCase()+path.sep)) return null;
  return fs.readFile(file,'utf8');
 }
 let entries;
 try { entries=await fs.readdir(directory,{withFileTypes:true}); } catch(e) { if(e.code==='ENOENT')return {mods,truncated:false}; throw e; }
 let total=0, truncated=false;
 const orderText=await local(path.join(directory,'mods.txt'),16384).catch(()=>null);
 for(const entry of entries.filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&e.name!=='shared').sort((a,b)=>a.name.localeCompare(b.name))) {
  if(mods.length>=24||total>=256*1024) { truncated=true; break; }
  if(!/^[A-Za-z0-9_.-]+$/.test(entry.name))continue;
  // mods.txt is authoritative when it names the Mod; otherwise enabled.txt.
  const orderLine=orderText?.split(/\r?\n/).map(line=>line.match(/^\s*([^;:#]+?)\s*:\s*([01])\s*(?:;.*)?$/)).find(match=>match?.[1].trim()===entry.name);
  let enabled=orderLine?orderLine[2]==='1':false;
  if(!orderLine) enabled=(await local(path.join(directory,entry.name,'enabled.txt'),1024).catch(()=>null))!==null;
  if(!enabled)continue;
  const text=await local(path.join(directory,entry.name,'Scripts/main.lua'),64000).catch(()=>null);
  if(text===null) { mods.push({id:entry.name,analysis:'unavailable'}); continue; }
  total+=Buffer.byteLength(text);
  const result=analyzeUE4SS(text,{game});
  mods.push({id:entry.name,sha256:crypto.createHash('sha256').update(text).digest('hex'),...result.traits,
   riskCodes:[...new Set(result.findings.map(f=>f.code))]});
 }
 return {mods,truncated,note:'只读已启用脚本的静态摘要；不执行 Mod，也不自动停用或修改用户已有 Mod。'};
}
async function agentGuide(previous) {
 const base=path.join(__dirname,'skills/ue4ss-runtime-safety');
 const [skill,contract]=await Promise.all(['SKILL.md','references/runtime-contract.md'].map(n=>fs.readFile(path.join(base,n),'utf8')));
 return ('Host UE4SS authoring skill (packaged version '+VERSION+')\n'+skill+'\n'+contract+'\nSelected engine reference:\n'+previous).slice(0,12000);
}
module.exports={VERSION,analyzeUE4SS,installedUE4SS,agentGuide,parseSource};
