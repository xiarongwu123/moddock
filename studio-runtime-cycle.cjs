const {setTimeout:delay}=require('node:timers/promises');
const {FAILURE}=require('./studio-runtime-verification.cjs');

// The same path handles conversational launches and launches from the Mod library.
// Sources are saved/built while the game runs; replacement waits for a verified exit.
async function runtimeCycle({studio,owner,game,item,context,stage,persist,message,onEvent,onTask}) {
 const now=studio.options.runtimeNow || Date.now;
 const sleep=studio.options.runtimeSleep || ((ms)=>delay(ms,undefined,{signal:context.signal}));
 const deadline=now()+(context.observationMs ?? studio.options.runtimeObservationMs ?? 600000);
 const check=()=>{if(context.signal?.aborted || !context.current()) throw new Error('运行验证已停止或账号已切换');};
 let recovery=item.runtimeRecovery;
 if(!recovery || recovery.artifactId!==item.artifactId) recovery={artifactId:item.artifactId,attempts:[],pendingArtifactId:null};
 item.runtimeRecovery=recovery;
 let lastStatus=item.runtimeAuto?item.runtimeAnnouncedStatus:undefined;
 while(now()<deadline) {
  check();
  if(recovery.pendingArtifactId) {
   await stage('observing');
   if(!await studio.options.lifecycle.idle(game)) {
    if(lastStatus!=='awaiting_exit') {message('修复版本已保存并通过构建；正在等待游戏退出，再自动替换并重新验证。');lastStatus='awaiting_exit';item.runtimeAnnouncedStatus=lastStatus;await persist();}
    await sleep(studio.options.runtimePollMs ?? 3000); continue;
   }
   check();
   const revisedContext={...context,artifactId:recovery.pendingArtifactId};
   await stage('deploying'); await studio.options.lifecycle.install(revisedContext); check();
   item.artifactId=recovery.pendingArtifactId; recovery.artifactId=item.artifactId; recovery.pendingArtifactId=null;recovery.expectingNewRun=true;
   await persist();
   await stage('launching'); await studio.options.lifecycle.launch({...context,artifactId:item.artifactId});check();
   message('修复版已通过安装管理器替换，已重新启动游戏；正在进行新一轮功能验收。');lastStatus=null;
  }
  await stage('observing');
  const report=await studio.toolchain.checkRuntime(owner,game,item.artifactId,context.current);check();
  item.toolchain={id:report.id,status:report.status,summary:report.summary,updated:report.updated};
  item.runtimeVerification=report.runtime;
  if(report.runtime.runId) {
   if(recovery.lastRunId && recovery.lastRunId!==report.runtime.runId && !recovery.expectingNewRun) recovery.attempts=[];
   recovery.lastRunId=report.runtime.runId;recovery.expectingNewRun=false;
  }
  if(lastStatus!==report.runtime.status) {message(report.runtime.detail);lastStatus=report.runtime.status;item.runtimeAnnouncedStatus=lastStatus;await persist();}
  if(FAILURE.has(report.runtime.status)) {
   if(recovery.attempts.length>=2 || typeof studio.options.repair!=='function') {
    item.status='failed';item.error='运行验证失败，自动修复次数已用尽；源码、运行证据和修复历史已保留。';await persist();return;
   }
   const previous=await studio.read(owner,item.artifactId), workspace=await studio.workspace(game);check();
   await context.authorize('library.manage');check();
   const validation={...report,status:'failed',summary:'运行验收失败：'+report.runtime.detail,checks:[...report.checks,{name:'本次游戏运行验收',status:'failed',detail:JSON.stringify(report.runtime)}]};
   const attempt={artifactId:previous.id,runId:report.runtime.runId,reason:report.runtime.status,evidence:report.runtime.evidence,started:new Date().toISOString()};
   recovery.attempts.push(attempt);await persist();await stage('repairing');
   const history=item.messages.filter(m=>m.role==='user' && !/^自动验证并修复运行结果$/.test(m.content));
   const draft=await studio.options.repair({accountId:owner,gameId:game.id,conversationId:item.id,kind:previous.draft.kind,plan:item.plan,
    messages:history.slice(-16),prompt:history.at(-1)?.content || previous.draft.description,context:workspace.context,diagnostic:workspace.diagnostic,types:workspace.types,
    previousDraft:previous.draft,validation,attempt:recovery.attempts.length,signal:context.signal,onEvent,onTask});check();
   if(draft?.kind!==previous.draft.kind) throw new Error('运行修复返回的 Mod 类型不匹配');
   const artifact=await studio.save(owner,game,draft,context.current,{conversationId:item.id,parentId:previous.id});check();
   attempt.repairedArtifactId=artifact.id;await persist();
   const requiredRuntimeChecks=previous.runtime?.verification?.expectations || [];
   const built=await studio.toolchain.run(owner,game,artifact.id,workspace,{signal:context.signal,current:context.current,onStage:stage,onEvent,authorize:context.authorize,requiredRuntimeChecks});check();
   if(built.status!=='passed') {
    // Continue from the failed source using the same bounded repair budget.
    item.artifactId=artifact.id;recovery.artifactId=artifact.id;
    item.runtimeVerification={...report.runtime,status:'script_error',detail:'运行修复版本未通过构建',evidence:built.checks};
    if(recovery.attempts.length>=2) {item.status='failed';item.error='修复版本仍未通过构建，已保留诊断。';await persist();return;}
    // The next repair must receive the build failure rather than attempt to run it.
    recovery.attempts.push({artifactId:artifact.id,reason:'build_failed',started:new Date().toISOString()});await persist();await stage('repairing');
    const corrected=await studio.options.repair({accountId:owner,gameId:game.id,conversationId:item.id,kind:draft.kind,previousDraft:draft,
     context:workspace.context,diagnostic:workspace.diagnostic,types:workspace.types,validation:built,attempt:recovery.attempts.length,signal:context.signal,onEvent,onTask});check();
    if(corrected?.kind!==draft.kind) throw new Error('构建修复返回的 Mod 类型不匹配');
    const final=await studio.save(owner,game,corrected,context.current,{conversationId:item.id,parentId:artifact.id});
    const verified=await studio.toolchain.run(owner,game,final.id,workspace,{signal:context.signal,current:context.current,onStage:stage,onEvent,authorize:context.authorize,requiredRuntimeChecks});check();
    if(verified.status!=='passed') {item.status='failed';item.error='修复版本仍未通过构建，已保留诊断。';await persist();return;}
    recovery.pendingArtifactId=final.id;
   } else recovery.pendingArtifactId=artifact.id;
   await persist();continue;
  }
  if(['unsupported','unavailable','not_installed','not_run','stale_run'].includes(report.runtime.status)) {item.status='awaiting_runtime';await persist();return;}
  if(report.runtime.exited) {item.status=report.runtime.status==='behavior_verified'?'completed':'awaiting_runtime';await persist();return;}
  await sleep(studio.options.runtimePollMs ?? 3000);
 }
 item.status=recovery.pendingArtifactId?'awaiting_exit':item.runtimeVerification?.status==='behavior_verified'?'completed':'awaiting_runtime';
 if(!item.runtimeAuto) message(recovery.pendingArtifactId?'修复版已保存，游戏仍在运行；下次启动前会继续处理替换和重新验证。':item.status==='completed'?'本次声明的功能回读验收通过，运行观察窗口已结束。':'观察窗口结束，尚未取得完整功能证据；没有把“未触发”判定为失败或成功。');
 await persist();
}
module.exports={runtimeCycle};
