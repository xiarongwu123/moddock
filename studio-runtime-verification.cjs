const { parseSource } = require('./studio-ue4ss-safety.cjs');

const FAILURE = new Set(['behavior_failed', 'script_error', 'crash_observed', 'loader_error']);
const keyPattern = /^[a-z][a-z0-9_]{0,47}$/;
function contract(source) {
 const expectations = [], checks = new Set(), begins = new Set(), findings = [], constants=new Set();
 let ast;
 try { ast = parseSource(source); } catch { return { expectations, findings: [{code:'RUNTIME_CONTRACT_PARSE',message:'无法解析运行验收代码'}] }; }
 const literal = n => n?.type === 'StringLiteral' ? n.value ?? n.raw.slice(1,-1) : null;
 function visit(n) {
  if (!n || typeof n !== 'object') return;
  if(n.type==='CallStatement') {
   const call=n.expression, target=call?.base;
   const direct=target?.type==='MemberExpression' && target.base?.name==='ModdockVerification' && target.identifier?.name==='guard';
   const wrapped=target?.name==='pcall' && call.arguments?.[0]?.type==='MemberExpression' && call.arguments[0].base?.name==='ModdockVerification' && call.arguments[0].identifier?.name==='guard';
   if(direct || wrapped) findings.push({code:'RUNTIME_GUARD_UNUSED',line:n.loc?.start.line,message:'guard(id, fn) 返回包装函数，不执行 fn；不得丢弃返回值。把返回函数注册/传给调度器，或显式调用 guard(id, fn)(...)。'});
  }
  if(['LocalStatement','AssignmentStatement'].includes(n.type)) {
   for(const [i,v] of (n.variables || []).entries()) {
    if(v.name==='ModdockVerification' || v.type==='MemberExpression' && v.base?.name==='ModdockVerification') findings.push({code:'RUNTIME_HOST_API',message:'不得覆盖宿主运行验收接口'});
    if(v.type==='Identifier' && /Literal$/.test(n.init?.[i]?.type || '')) constants.add(v.name);
   }
  }
  if (n.type === 'CallExpression' && n.base?.type === 'MemberExpression' && n.base.base?.name === 'ModdockVerification') {
   const method = n.base.identifier.name, args = n.arguments || [], id = literal(args[0]);
   if (['expect','begin','check','fail','guard'].includes(method) && !keyPattern.test(id || '')) findings.push({code:'RUNTIME_CHECK_ID',line:n.loc?.start.line,message:'运行验收 ID 必须是固定的小写字母、数字和下划线'});
   if (method === 'expect') {
    const description = literal(args[1]);
    if (!description || description.length > 160 || expectations.some(e => e.id === id) || expectations.length >= 12) findings.push({code:'RUNTIME_EXPECT',line:n.loc?.start.line,message:'每项功能需唯一固定 ID 和 1–160 字的可观测验收说明；最多 12 项'});
    else expectations.push({id,description});
   }
   if (method === 'check') {
    checks.add(id);
    if (!args[1] || /Literal$/.test(args[1].type) || constants.has(args[1].name) || !args[2] || args[2].type === 'NilLiteral' || args[1].type==='Identifier' && args[1].name===args[2]?.name) findings.push({code:'RUNTIME_READBACK',line:n.loc?.start.line,message:'check(id, actual, expected[, tolerance]) 必须读取实际游戏状态；禁止用常量或同一变量充当 actual 与 expected'});
   }
   if(method==='begin') begins.add(id);
  }
  for (const [k,v] of Object.entries(n)) if (!['loc','range','comments'].includes(k)) Array.isArray(v) ? v.forEach(visit) : v && typeof v === 'object' && visit(v);
 }
 visit(ast);
 if (!expectations.length) findings.push({code:'RUNTIME_CONTRACT_REQUIRED',message:'缺少功能验收：使用 ModdockVerification.expect 声明，并在实际功能触发后 begin、延后读取游戏状态再 check；初始化或 pcall 成功不是效果证据'});
 for (const e of expectations) if (!checks.has(e.id)) findings.push({code:'RUNTIME_CHECK_REQUIRED',message:`验收 ${e.id} 缺少对应的实际状态 check`});
 for (const e of expectations) if (!begins.has(e.id)) findings.push({code:'RUNTIME_BEGIN_REQUIRED',message:`验收 ${e.id} 缺少功能触发时的 begin`});
 for (const id of checks) if (!expectations.some(e => e.id === id)) findings.push({code:'RUNTIME_UNDECLARED',message:`验收 ${id} 未声明 expect`});
 return {version:1,expectations,findings,passed:!findings.length};
}

function bootstrap(marker, source, printer='print', returnModule=false) {
 // This host adapter emits primitives only. It never reads UObjects or adds native calls.
 return `local ModdockVerification = (function()
 local seq, pending = 0, {}
 local function hex(v) local s=type(v)=='number' and string.format('%.17g',v) or tostring(v); return (s:sub(1,512):gsub('.', function(c) return string.format('%02x',string.byte(c)) end)) end
 local function emit(kind,id,a,b,t)
  seq=seq+1
  ${printer}('MDVERIFY|${marker}|'..seq..'|'..kind..'|'..id..'|'..hex(a)..'|'..hex(b)..'|'..hex(t)..'\\n')
 end
 local api={}
 function api.expect(id,description) end
 function api.begin(id) pending[id]=true; emit('begin',id,'','','') end
 function api.check(id,actual,expected,tolerance)
  if not pending[id] then error('verification check requires begin: '..id) end
  pending[id]=nil
  local kind=type(actual)
  if kind~='number' and kind~='boolean' and kind~='string' then emit('error',id,'actual must be a primitive','',''); return end
  if type(expected)~=kind then emit('error',id,'actual and expected types differ','',''); return end
  if kind=='string' and (#actual>512 or #expected>512) then emit('error',id,'string readback exceeds 512 bytes','',''); return end
  emit('check_'..kind,id,actual,expected,tolerance or 0)
 end
 function api.fail(id,reason) pending[id]=nil; emit('error',id,reason,'','') end
 function api.guard(id,fn)
  return function(...)
   local function pack(...) return {n=select('#',...),...} end
   local results=pack(pcall(fn,...))
   if not results[1] then api.fail(id,results[2]); return end
   return (table.unpack or unpack)(results,2,results.n)
  end
 end
 return api
end)()
local function moddock_initialize()
${source}
end
local ok,result=pcall(moddock_initialize)
if not ok then ModdockVerification.fail('initialize',result); error(result) end
${printer}(${JSON.stringify(marker)})
${returnModule ? 'return result' : ''}
`;
}

function evaluate({text='',marker,contract:spec,previous={},now=Date.now(),triggerTimeoutMs=15000,crashed=false,exitCode}) {
 previous ||= {};
 const evidence=[], states={...(previous.states || {})}, prior=previous.pending || {};
 let error, hadFailure=previous.status==='behavior_failed';
 const prefix='MDVERIFY|'+marker+'|';
 for (const chunk of text.split(prefix).slice(1)) {
  // UE4SS print does not necessarily append a newline. Older wrappers and
  // unrelated native log entries may concatenate multiple events on one line.
  const match=chunk.match(/^(\d+)\|([a-z_]+)\|([a-z][a-z0-9_]{0,47})\|((?:[0-9a-f]{2}){0,512})\|((?:[0-9a-f]{2}){0,512})\|((?:[0-9a-f]{2}){0,512})(?=$|\s|\[)/);
  if(!match) continue;
  const parts=match.slice(1);
  const [seq,kind,id,...raw]=parts;
  if(!raw.every(v=>/^(?:[0-9a-f]{2}){0,512}$/.test(v))) continue;
  const [a,b,t]=raw.map(v=>Buffer.from(v,'hex').toString('utf8'));
  if(kind==='error') { error={id,reason:a}; evidence.push({id,kind,reason:a}); continue; }
  if(!spec?.expectations?.some(e=>e.id===id)) continue;
  const last=states[id]; if(last && Number(seq)<=last.seq) continue;
  if(kind==='begin') states[id]={seq:Number(seq),status:'pending',since:prior[id]?.seq===Number(seq)?prior[id].since:now};
  else if(kind.startsWith('check_') && last?.status==='pending') {
   let passed=false;
   if(kind==='check_number') passed=[a,b,t].every(v=>v.trim()!=='' && Number.isFinite(Number(v))) && Number(t)>=0 && Math.abs(Number(a)-Number(b))<=Number(t);
   if(kind==='check_boolean') passed=['true','false'].includes(a) && a===b;
   if(kind==='check_string') passed=a===b;
   states[id]={seq:Number(seq),status:passed?'passed':'failed',actual:a,expected:b,tolerance:t};
   if(!passed) {hadFailure=true;evidence.push({id,kind:'failed_readback',actual:a,expected:b,tolerance:t});}
  }
 }
 for(const [id,s] of Object.entries(states)) evidence.push({id,...s});
 const pending=Object.fromEntries(Object.entries(states).filter(([,s])=>s.status==='pending'));
 let status='awaiting_trigger', detail='已加载，等待功能触发和游戏状态回读；尚未确认效果。';
 if(!spec?.expectations?.length) {status='unsupported';detail='此版本没有可执行的功能验收协议，不能自动判断效果；需要重新生成带验收的实现。';}
 else if(spec.expectations.every(e=>states[e.id]?.status==='passed')) {status='behavior_verified';detail='声明的功能验收已通过游戏状态回读；继续观察本次运行。';}
 if(hadFailure) {status='behavior_failed';detail='实际游戏状态与预期不符，将携带回读证据自动修复。';}
 if(Object.values(pending).some(s=>now-s.since>=triggerTimeoutMs)) {status='behavior_failed';detail='功能已经触发，但在期限内没有完成状态回读，将自动修复。';}
 if(error) {status='script_error';detail='当前脚本报告运行异常：'+error.reason;}
 if(crashed) {status='crash_observed';detail='本次游戏出现异常退出或致命错误；原因尚需结合当前 Mod 与其他已启用 Mod 排查。';evidence.push({kind:'process_or_fatal',exitCode});}
 return {status,detail,evidence:evidence.slice(-30),states,pending,repairable:FAILURE.has(status)};
}
module.exports={contract,bootstrap,evaluate,FAILURE};
