const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
async function main() {
 const service = path.resolve(process.argv[2]), { createMuStudioAI } = require(path.join(service, 'studio-mu-client.cjs'));
 const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
 let taskId, detached = false, requests = 0, previousDraft, restoredSource = false; const events = [], checkpoints = [];
 if (process.argv[3]) {
  const baseline = path.resolve(process.argv[3]), report = JSON.parse(await fs.readFile(path.join(baseline, 'resume-verification.json'), 'utf8'));
  assert(report.passed && report.compilerPassed);
  const journal = (await fs.readFile(path.join(baseline, 'candidate-tasks', sha('resume-ron-validation:' + report.taskId), 'frames.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  previousDraft = journal.find(frame => frame.type === 'result').result;
 }
 const ai = createMuStudioAI(async (_owner, route, init) => {
  const { delivery } = JSON.parse(init.body); taskId ||= delivery.id; assert.equal(delivery.id, taskId); requests++;
  const response = await fetch('http://127.0.0.1:8096/' + route, { ...init, method: 'POST', headers: { Authorization: 'Bearer ' + process.env.MODDOCK_STUDIO_TOKEN, 'X-Mu-Account-Id': 'resume-ron-validation', Accept: 'application/x-ndjson', 'Content-Type': 'application/json' } });
  assert.equal(response.status, 200);
  if (detached) return response;
  const reader = response.body.getReader(); let pending = '', cut = false; const decoder = new TextDecoder();
  return new Response(new ReadableStream({ async pull(controller) {
   if (cut) { detached = true; await reader.cancel(); controller.error(new Error('net::ERR_CONNECTION_RESET')); return; }
   const chunk = await reader.read(); if (chunk.done) { controller.close(); return; }
   pending += decoder.decode(chunk.value, { stream: true }); let end;
   while ((end = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, end); pending = pending.slice(end + 1); if (!line.trim()) continue;
    const frame = JSON.parse(line);
    if (frame.type === 'event' && frame.event.type === 'tool_end' && frame.event.name === 'write_project_file' && !frame.event.failed) cut = true;
   }
   controller.enqueue(chunk.value);
  }, cancel: () => reader.cancel() }, { highWaterMark: 0 }), { headers: response.headers });
 }, { retryDelay: 100 });
 const payload = { kind: 'ue4ss-lua', harness: 'pi-agent',
  prompt: '制作《严阵以待》的单人离线敌人倒地复起 Mod：只影响 Suspect，不影响玩家、SWAT、平民和人质。在致命伤害生效前保留正生命值，调用原生 PlayDead，倒地 3.5 秒后恢复并拔枪继续战斗，每个敌人最多一次。不要复活真正已死亡的尸体。处理倒地中受伤、逮捕、关卡切换和无效对象。所有延迟 UObject 操作回到游戏线程，接口缺失则安全停用。我要实际可安装代码，实机稍后验证。',
  plan: { title: '离线倒地复起', summary: '只影响离线敌人的倒地复起机制', kind: 'ue4ss-lua', steps: ['核对接口', '编写并编译 Lua', '提交可安装脚本'], requirements: [] },
  context: { game: { id: 'steam-1144200', appId: '1144200', name: 'Ready or Not' } },
  diagnostic: { engine: { key: 'unreal', name: 'Unreal Engine' }, loaders: [], requirements: [], antiCheat: [], routes: [] },
  capability: { deliverable: 'mod', allowedKinds: ['ue4ss-lua'] }, environment: { portableLua: { available: true } },
  types: [{ id: 'ue4ss-lua', available: true }], signal: AbortSignal.timeout(610000),
  onTask: task => checkpoints.push(task), onEvent: event => {
   events.push(event); if (event.type === 'tool_start') console.log(event.name);
   if (previousDraft && event.type === 'agent_start' && !event.agent.includes('专项复核')) {
    const source = syncFs.readFileSync(path.join(service, 'candidate-tasks', sha('resume-ron-validation:' + taskId), 'project/main.lua'), 'utf8');
    assert.equal(source, payload.previousDraft.code); restoredSource = true;
   }
  } };
 if (previousDraft) {
  payload.previousDraft = { ...previousDraft, code: previousDraft.code + '\nlocal moddock_repair_probe = function(' };
  const compilation = await require(path.join(service, 'studio-lua.cjs')).checkLua(payload.previousDraft.code); assert.equal(compilation.passed, false);
  payload.validation = { status: 'failed', checks: [{ name: 'Lua compiler', ...compilation }] };
  payload.prompt = '修复现有工程的实际 Lua 编译错误。原有玩法代码已经完成，不要重新实现或改写。读取工作区 main.lua 和 read_runtime 的真实编译诊断，只删除文件末尾多出来的未闭合行 local moddock_repair_probe = function(，其他源码逐字保留。重新编译后提交同一产物，实机稍后验证。';
 }
 let draft;
 try { draft = await (previousDraft ? ai.repair(payload) : ai.generate(payload)); }
 catch (error) { console.error(JSON.stringify({ code: error.code, diagnostic: error.diagnostic, taskId })); throw error; }
 assert(detached, 'The real generated code write was not followed by a simulated disconnect'); assert(requests > 1);
 const folder = path.join(service, 'candidate-tasks', sha('resume-ron-validation:' + taskId));
 const project = await fs.readFile(path.join(folder, 'project/main.lua'), 'utf8'); assert.equal(project, draft.code);
 if (previousDraft) { assert(restoredSource); assert.equal(draft.code.trimEnd(), previousDraft.code.trimEnd(), 'Repair must preserve all previously completed gameplay code'); }
 const compilation = await require(path.join(service, 'studio-lua.cjs')).checkLua(draft.code); assert(compilation.passed, compilation.detail);
 const journal = (await fs.readFile(path.join(folder, 'frames.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
 assert.equal(journal.filter(frame => frame.type === 'result').length, 1);
 assert.equal(new Set(journal.map(frame => frame.seq)).size, journal.length);
 const files = await fs.readdir(path.join(service, 'candidate-tasks/logs')); let starts = 0;
 for (const name of files) for (const line of (await fs.readFile(path.join(service, 'candidate-tasks/logs', name), 'utf8')).trim().split('\n')) {
  const log = JSON.parse(line); if (log.taskId === taskId && log.stage === 'started') starts++;
 }
 assert.equal(starts, 1);
 const creatorSessions = events.filter(event => event.type === 'agent_start' && !event.agent.includes('专项复核')).length;
 assert.equal(creatorSessions, 1, 'Artifact generation must not restart the creator session');
 const report = { passed: true, serviceRelease: path.basename(service), clientSha256: sha(await fs.readFile(path.join(service, 'studio-mu-client.cjs'))),
  realPiUsed: true, oneWorker: starts === 1, creatorSessions, subscriptions: requests, simulatedDisconnectAfterCodeWrite: detached,
  checkpointMatchesArtifact: true, compilerPassed: compilation.passed, sourceBytes: Buffer.byteLength(draft.code), taskId,
  thinkingStreamed: events.some(event => event.type === 'thinking_delta'), reconnectStateStreamed: events.some(event => event.type === 'connection' && event.status === 'reconnecting'),
  restoredSourceBeforeModel: restoredSource, repairedExistingProject: !!previousDraft, originalGameplaySourcePreserved: !!previousDraft,
  realGameTested: false, windowsDeviceTested: false };
 await fs.writeFile(path.join(service, 'resume-verification.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
 console.log(JSON.stringify(report));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
