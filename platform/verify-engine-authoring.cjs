const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

(async () => {
 const service = path.resolve(process.argv[2]), port = process.argv[3] || '8096';
 const engines = require(path.join(service, 'studio-engines.cjs'));
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-authoring-check-'));
 const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
 const results = [];
 try {
  for (const family of ['rpgmaker', 'renpy']) {
   const rpg = family === 'rpgmaker', files = rpg ? {
    'js/rmmz_core.js': 'Utils.RPGMAKER_NAME = "MZ"; Utils.RPGMAKER_VERSION = "1.8.0";',
    'js/rmmz_objects.js': 'function Game_Actor() {}\nGame_Actor.prototype.paramBase = function(paramId) { return paramId === 2 ? 10 : 7; };\n',
    'js/plugins.js': 'var $plugins = [{"name":"Existing","status":true,"description":"keep","parameters":{}}];\n',
   } : {
    'renpy/__init__.py': 'version_tuple = (8, 3, 0)\n',
    'game/script.rpy': 'default coins = 0\nlabel start:\n    "Hello"\n',
    'game/options.rpy': 'init python:\n    # Available engine API: config.start_callbacks, each callback runs after defaults when starting a new game.\n    # store.coins is the rollback/save-backed game currency.\n    pass\n',
   };
   const evidence = { family, engineKey: rpg ? 'rpgmaker-mz' : 'renpy', mode: rpg ? 'rpgmaker-plugin' : 'renpy-python', base: '', registry: rpg ? 'js/plugins.js' : null,
    documents: Object.entries(files).map(([name, text]) => ({ path: name, text, sha256: sha(text), bytes: Buffer.byteLength(text), complete: true })),
    inventory: Object.entries(files).map(([name, text]) => ({ path: name, bytes: Buffer.byteLength(text) })), blockers: [], truncated: false };
   const events = [], tools = new Set(), payload = {
    harness: 'pi-agent', prompt: rpg ? '为这款没有专项适配的 RPG Maker MZ 单机游戏制作实际插件：仅让玩家队伍角色基础攻击力（paramId 2）翻倍，其余属性保持不变。封装原 paramBase 并保留原方法的 this 和参数。不要返回方案或示例。' : '为这款没有专项适配的 RenPy 8 单机游戏制作实际脚本：只在开始新游戏且默认变量建立之后，给 store.coins 增加 10 金币。通过 config.start_callbacks 注册回调，不能在 init 阶段直接修改 coins，也不能影响读取存档。不要返回方案或示例。',
    types: [{ id: 'engine-mod', available: true }], capability: { deliverable: 'mod', allowedKinds: ['engine-mod'] },
    context: { game: { id: 'unlisted-' + family, name: 'Unlisted ' + family + ' validation game' }, engineEvidence: evidence },
    diagnostic: { engine: { key: evidence.engineKey, name: evidence.engineKey }, loaders: [], antiCheat: [], requirements: [] },
   };
   async function call(action, value) {
    console.log(JSON.stringify({ family, stage: action, started: new Date().toISOString() }));
    const response = await fetch('http://127.0.0.1:' + port + '/' + action, { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.MODDOCK_STUDIO_TOKEN, 'X-Mu-Account-Id': 'engine-authoring-validation', Accept: 'application/x-ndjson', 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal: AbortSignal.timeout(310000) });
    if (!response.ok) throw new Error('Candidate HTTP ' + response.status);
    let pending = '', result; const decoder = new TextDecoder();
    const frame = line => {
     if (!line.trim()) return; const value = JSON.parse(line);
     if (value.type === 'error') throw new Error('Authoring failed: ' + value.code);
     if (value.type === 'result') result = value.result;
     if (value.type === 'event') {
      events.push(value.event);
      if (value.event.type === 'tool_end' && !value.event.failed) tools.add(value.event.name);
      if (value.event.type === 'tool_start') console.log(JSON.stringify({ family, tool: value.event.name }));
     }
    };
    for await (const bytes of response.body) { pending += decoder.decode(bytes, { stream: true }); let end; while ((end = pending.indexOf('\n')) >= 0) { frame(pending.slice(0, end)); pending = pending.slice(end + 1); } }
    pending += decoder.decode(); frame(pending); if (!result) throw new Error('No final artifact'); return result;
   }
   const plan = await call('plan', payload);
   if (plan.kind !== 'engine-mod' || plan.questions?.length) throw new Error('No executable engine route selected');
   const draft = await call('generate', { ...payload, kind: plan.kind, plan });
   if (draft.mode !== evidence.mode) throw new Error('Wrong engine loading route: ' + draft.mode);
   for (const name of ['list_game_files', 'read_game_file', 'write_project_file', 'validate_project', 'submit_result']) if (!tools.has(name)) throw new Error('Missing native Pi tool ' + name);
   const gameRoot = path.join(root, family); for (const [name, text] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(gameRoot, name)), { recursive: true }); await fs.writeFile(path.join(gameRoot, name), text); }
   const item = { draft, manifest: { UniqueID: 'Moddock0123456789abcdef' } };
   const compiled = await engines.compileEngineProject({ installPath: gameRoot }, item, evidence);
   if (compiled.checks.some(check => ['blocked', 'failed'].includes(check.status)) || !compiled.outputs.length) throw new Error('Host build did not pass');
   let logicSandboxPassed = false, pythonCompilerPassed = false;
   if (rpg) {
    const sandbox = vm.createContext({}); vm.runInContext(files['js/rmmz_objects.js'], sandbox);
    vm.runInContext(draft.files[0].text, sandbox, { timeout: 200 });
    if (vm.runInContext('new Game_Actor().paramBase(2)', sandbox, { timeout: 200 }) !== 20 || vm.runInContext('new Game_Actor().paramBase(1)', sandbox, { timeout: 200 }) !== 7) throw new Error('Generated plugin did not implement the requested mechanic');
    logicSandboxPassed = true;
   } else {
    const result = spawnSync('python3', ['-I', '-S', '-c', 'import ast,sys; compile(ast.parse(sys.stdin.read()), "<mod>", "exec"); print("syntax-ok")'], { input: draft.files[0].text, encoding: 'utf8', timeout: 5000, maxBuffer: 10000 });
    if (result.status !== 0) throw new Error('Python native syntax check failed: ' + String(result.stderr).slice(0, 1000));
    pythonCompilerPassed = true;
   }
   const report = { family, passed: true, realPiUsed: true, staticBuildPassed: true, logicSandboxPassed, pythonCompilerPassed, gameRuntimeVerified: false, tools: [...tools], thinkingStreamed: events.some(event => event.type === 'thinking_delta'), plan, draft, outputs: compiled.outputs.map(file => ({ name: file.name, sha256: sha(file.data), bytes: file.data.length })), events };
   await fs.writeFile(path.join(service, 'engine-' + family + '-check.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
   results.push({ family, passed: true, realPiUsed: true, staticBuildPassed: true, logicSandboxPassed, pythonCompilerPassed, gameRuntimeVerified: false, tools: [...tools] });
   console.log(JSON.stringify(results.at(-1)));
  }
  await fs.writeFile(path.join(service, 'engine-authoring-check.json'), JSON.stringify({ serviceRelease: path.basename(service), passed: true, results }, null, 2), { mode: 0o600 });
 } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
