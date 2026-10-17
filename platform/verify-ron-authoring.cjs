const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
 const service = path.resolve(process.argv[2]);
 const { checkLua } = require(path.join(service, 'studio-lua.cjs'));
 const events = [], tools = new Set();
 const payload = {
  harness: 'pi-agent', prompt: '制作《严阵以待》的单人离线敌人倒地复起 Mod：只影响 Suspect 敌人，不影响玩家、SWAT、平民和人质。在致命伤害生效前保留正生命值，调用游戏原生 PlayDead，倒地 3.5 秒后恢复并拔枪继续战斗，每个敌人最多一次。不要复活真正已死亡的尸体，不要返回方案或示例。使用你已核对的实际接口，给出可安装脚本。必须处理倒地中再受伤、逮捕、关卡切换和无效对象；所有延迟 UObject 操作须回到游戏线程，缺少接口就停用。',
  context: { game: { id: 'steam-1144200', appId: '1144200', name: 'Ready or Not' } },
  diagnostic: { engine: { key: 'unreal', name: 'Unreal Engine' }, loaders: [], requirements: [], antiCheat: [], routes: [] },
  capability: { deliverable: 'mod', allowedKinds: ['ue4ss-lua'] }, environment: { portableLua: { available: true } },
  types: [{ id: 'ue4ss-lua', available: true }, { id: 'project-plan', available: true }],
 };
 async function call(action, value) {
  console.log(JSON.stringify({ stage: action, started: new Date().toISOString() }));
  const response = await fetch('http://127.0.0.1:8096/' + action, { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.MODDOCK_STUDIO_TOKEN, 'X-Mu-Account-Id': 'ron-authoring-validation', 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: JSON.stringify(value), signal: AbortSignal.timeout(310000) });
  if (!response.ok) throw new Error('Candidate service HTTP ' + response.status);
  let result;
  const handle = line => {
   if (!line.trim()) return;
   const frame = JSON.parse(line);
   if (frame.type === 'error') throw new Error('Candidate authoring failed: ' + frame.code);
   if (frame.type === 'result') result = frame.result;
   if (frame.type === 'event') {
    events.push(frame.event);
    if (frame.event.type === 'tool_start') console.log(JSON.stringify({ tool: frame.event.name, detail: frame.event.detail }));
    if (frame.event.type === 'tool_end') { if (!frame.event.failed) tools.add(frame.event.name); console.log(JSON.stringify({ tool: frame.event.name, failed: !!frame.event.failed, detail: frame.event.detail })); }
   }
  };
  let pending = ''; const decoder = new TextDecoder();
  try { for await (const chunk of response.body) { pending += decoder.decode(chunk, { stream: true }); let end; while ((end = pending.indexOf('\n')) >= 0) { handle(pending.slice(0, end)); pending = pending.slice(end + 1); } } pending += decoder.decode(); handle(pending); }
  finally { await fs.writeFile(path.join(service, 'ron-authoring-events.json'), JSON.stringify(events, null, 2), { mode: 0o600 }); }
  if (!result) throw new Error('Candidate returned no artifact');
  return result;
 }
 const repair = process.argv.includes('--repair');
 const previous = repair ? JSON.parse(await fs.readFile(path.join(service, 'ron-authoring-check.json'), 'utf8')) : null;
 const plan = repair ? previous.plan : await call('plan', payload);
 if (plan.kind !== 'ue4ss-lua' || plan.questions?.length) throw new Error('Model did not choose an executable Mod');
 const validation = repair ? JSON.parse(await fs.readFile(path.join(service, 'ron-repair-feedback.json'), 'utf8')) : undefined;
 const draft = await call(repair ? 'repair' : 'generate', { ...payload, kind: plan.kind, plan, ...(repair ? { previousDraft: previous.draft, validation } : {}) });
 const compilation = await checkLua(draft.code);
 if (!compilation.passed) throw new Error(compilation.detail);
 const report = { passed: true, serviceRelease: path.basename(service), realPiUsed: true, compilerPassed: true, runtimeVerified: false, tools: [...tools], eventTypes: [...new Set(events.map(event => event.type))], plan, draft, events, ...(repair ? { repairedFromSandbox: true } : {}) };
 for (const name of ['search_api', 'write_project_file', 'validate_project', 'submit_result']) if (!tools.has(name)) throw new Error('Missing actual native Pi tool: ' + name);
 await fs.writeFile(path.join(service, 'ron-authoring-check.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
 console.log(JSON.stringify({ passed: true, kind: draft.kind, sourceBytes: Buffer.byteLength(draft.code), tools: [...tools], runtimeVerified: false }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
