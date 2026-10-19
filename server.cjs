const http = require('node:http');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { scan, resolveSteamRoot, pathKey } = require('./scanner.cjs');
const { Sources, sourceGames, providers } = require('./sources.cjs');
const { Downloads } = require('./downloads.cjs');
const { Installers } = require('./installers.cjs');
const {ModLibrary}=require('./library.cjs');
const {parseNxm,authorizationPage}=require('./nxm.cjs');
const {recipes}=require('./adapters.cjs');
const { ensureUi } = require('./scripts/build-ui.cjs');
const { createAccountClient, AccountError } = require('./account.cjs');
const { featureForRoute } = require('./account-policy.cjs');
const { Workshop, sameGame } = require('./workshop.cjs');
const { SourceConnections } = require('./source-connections.cjs');
const { NexusSso } = require('./nexus-sso.cjs');
const { createMuNexusPlatformClient } = require('./nexus-platform-client.cjs');
const { ModStudio, studioAccess } = require('./mod-studio.cjs');
const { StudioLifecycle } = require('./studio-lifecycle.cjs');
const { StudioControlHost } = require('./studio-control-host.cjs');
const { BG3Extender } = require('./bg3-extender.cjs');
const { GameEnvironment } = require('./game-environment.cjs');
const { resolveStudioGame, mergeStudioGames } = require('./studio-games.cjs');
const { createMuStudioAI } = require('./studio-mu-client.cjs');
const { planWithPi } = require('./ai-install.cjs');
const { DownloadBundles,bundleOptions } = require('./download-bundles.cjs');
async function createServer(options = {}) {
 await ensureUi();
 const accounts = createAccountClient(options.accounts);
 const sessionOwners = new Map();
 const aiInstallTasks = new Map();
 let bundles;
 const sourceOptions = { ...options.sources };
 if (!options.nexusPlatformDisabled && !sourceOptions.nexusPlatform) sourceOptions.nexusPlatformFactory = owner => createMuNexusPlatformClient((route, init) => {
  const sessionId = [...sessionOwners].find(([, id]) => id === owner)?.[0];
  return accounts.nexusRequest(sessionId, route, init);
 });
 const root = path.resolve(options.root || process.env.MODDOCK_DATA || path.join(__dirname, '.moddock-data')); await fs.mkdir(root, { recursive: true });
 const configPath = path.join(root, 'settings.json'); let config = { scanPaths: [], mappings: {}, autoImport:true };
 try { config = { ...config, ...JSON.parse(await fs.readFile(configPath, 'utf8')) }; } catch (e) { if (e.code !== 'ENOENT') throw e; }
 const saveConfig = async () => { await fs.writeFile(configPath + '.tmp', JSON.stringify(config, null, 2)); await fs.rename(configPath + '.tmp', configPath); };
 const doScan = async paths => mergeStudioGames(await (options.scan || scan)(paths), config.localGames); let scanResult = await doScan(config.scanPaths);
 let choosingScanDirectory = false;
 const token = crypto.randomBytes(32).toString('hex'); const sources = new Sources({ ...sourceOptions, nexusPlatform: sourceOptions.nexusPlatform || sourceOptions.nexusPlatformFactory?.(null) }); const downloads = await new Downloads(root, sources, options.downloads).open();
 const connections = new SourceConnections(accounts.config.legalUrls.terms, sourceOptions, options.sourceKeyStore);
 const sso = new NexusSso({ application: process.env.MODDOCK_NEXUS_APP_ID || require('./nexus-app.json').application, ...options.nexusSso });
 const installers = await new Installers(root, downloads, options.installers).open();
 const bg3Extender = new BG3Extender(root, installers, options.bg3Extender);
 const gameEnvironment = new GameEnvironment(root, installers, bg3Extender, { ...options.gameEnvironment,
  fetch: options.gameEnvironment?.fetch || options.bg3Extender?.fetch,
  contentPatcher: options.gameEnvironment?.contentPatcher || installContentPatcher });
 const library=new ModLibrary(downloads,installers,sources);
 const managedStudio = options.studio === undefined ? createMuStudioAI((owner, route, init) => {
  const sessionId = [...sessionOwners].find(([, id]) => id === owner)?.[0];
  return accounts.studioRequest(sessionId, owner, route, init);
 }) : {};
 const studio = new ModStudio(root, { ...managedStudio, ...options.studio, tools: {
  directory: path.join(root, 'toolchain'), fetch: options.gameEnvironment?.fetch || options.bg3Extender?.fetch, ...options.studio?.tools } });
 const lifecycle = new StudioLifecycle(studio, downloads, library, installers);
 const controls = new StudioControlHost(lifecycle);
 studio.options.lifecycle = lifecycle;
 studio.options.ensureEnvironment = context => gameEnvironment.ensure(context);
 studio.options.runtimeCheck = context => lifecycle.runtime(context);
 const workshop = new Workshop(root, onlineGames, () => config.workshopMappings || {});
 downloads.onCompleted=async job=>{if(!job.game.installPath){job.import={status:'unbound',message:'已下载，关联本机游戏后可预览安装'};await downloads.save();}else if(config.autoImport!==false)await library.import(job.game,job.id);};
 const nexusTargets = new Map();
 let nxmStatus=null; const pendingNxm=new Map();
 let nxmQueue=Promise.resolve();
 function releaseOwner(owner) {
  bundles?.pauseOwner(owner);
  if (!owner) return;
  for(const controller of aiInstallTasks.get(owner)||[])controller.abort(new Error('账号已退出，AI 安装已停止'));
  aiInstallTasks.delete(owner);
  studio.cancelOwner(owner);
  sso.forget(owner);
  options.cancelAuthorization?.(owner);
  const entry = connections.entries.get(owner);
  if (entry) downloads.releaseClient(entry.sources);
  connections.release(owner);
  for (const [id, pending] of pendingNxm) if (pending.owner === owner) pendingNxm.delete(id);
  for (const [id, target] of nexusTargets) if (target.owner === owner) nexusTargets.delete(id);
  if (nxmStatus?.owner === owner) nxmStatus = null;
 }
 async function connectSource(owner, source, key, current) {
  const result = await connections.connect(owner, source, key, current);
  if (!result || (current && !current())) return result;
  if (source === 'nexus') options.cancelAuthorization?.(owner);
  if (source === 'nexus' && key) {
   const client = (await connections.get(owner)).sources;
   for (const [id, pending] of pendingNxm) {
    if (pending.owner !== owner) continue;
    pendingNxm.delete(id);
    try {
     if (Number(pending.auth.expires) * 1000 <= Date.now()) throw new Error('待接收的 NXM 授权已过期，请重新授权');
     const { auth } = pending;
     const job = downloads.resumeAuthorization(downloadGame(pending.gameId), `nexus:${auth.domain}:${auth.modId}`, auth.fileId, auth, client);
     nxmStatus = { owner, id: crypto.randomUUID(), status: 'queued', jobId: job.id, message: '已连接 Nexus，继续下载已授权的文件' };
    } catch (error) { nxmStatus = { owner, id: crypto.randomUUID(), status: 'error', message: error.message }; }
   }
  }
  return result;
 }
 function receiveNxm(value,gameId,sessionId){const action=()=>acceptNxm(value,gameId,sessionId);const p=nxmQueue.catch(()=>{}).then(action);nxmQueue=p;return p;}
 async function acceptNxm(value,gameId,sessionId){
  let owner;
  try{const permission=sessionId?await accounts.authorize(sessionId,'library.manage'):await accounts.authorizeActive('library.manage');owner=permission.account.id;const sources=(await connections.get(owner)).sources;const auth=parseNxm(value);const target=nexusTargets.get(`${owner}:${auth.domain}:${auth.modId}:${auth.fileId}`);let games=gameId?[downloadGame(gameId)]:target?[downloadGame(target.gameId)]:onlineGames();const matches=[];for(const g of games){try{if(await sources.nexusGame(g)===auth.domain)matches.push(g);}catch{}}
   if(matches.length!==1)throw new Error(matches.length?'多个本机游戏匹配此专区，请在设置中选择目标游戏后接收链接':'此 NXM 游戏不在本机游戏库中，请扫描游戏并匹配 Nexus 专区');const g=matches[0];
   if (sources.nexusPlatform) throw new Error('文件由平台服务自动下载，无需接收 Nexus 授权链接');
   const resourceId=`nexus:${auth.domain}:${auth.modId}`;
   if(!sources.keys.nexus){if(pendingNxm.size>=20)throw new Error('待授权链接过多');pendingNxm.set(`${owner}:${g.id}:${resourceId}:${auth.fileId}`,{owner,auth,gameId:g.id});nxmStatus={owner,id:crypto.randomUUID(),status:'needs_key',gameId:g.id,message:'已收到文件授权，请先在设置中连接同一 Nexus 账号'};return nxmStatus;}
   const job=downloads.resumeAuthorization(g,resourceId,auth.fileId,auth,sources);nxmStatus={owner,id:crypto.randomUUID(),status:'queued',gameId:g.id,jobId:job.id,message:'已收到 NXM 文件授权，下载已加入队列'};return nxmStatus;
  }catch(e){nxmStatus={owner,id:crypto.randomUUID(),status:'error',message:e.message};throw e;}
 }
 function onlineGames() { return scanResult.games.map(g => { const known = sourceGames.find(s => (g.appId && s.appId === g.appId) || [s.name, s.searchName].some(n => n.toLowerCase() === g.name.toLowerCase())); return { ...known, ...g, searchName: known?.searchName || g.name, ...config.mappings[g.id] }; }); }
 function downloadGame(id) { return onlineGames().find(g => g.id === id) || workshop.game(id); }
 async function installContentPatcher(context) {
  const { sources: client } = await connections.get(context.owner);
  if (!client.nexusPlatform) throw new Error('Content Patcher 需要 MU 平台官方文件通道；请稍后重试，无需配置个人 Key');
  await context.authorize('library.manage');
  const resource = 'nexus:stardewvalley:1915', detail = await client.detail({ ...context.game, nexus: 'stardewvalley' }, resource);
  const file = detail.files.filter(file => file.category === 'MAIN' && /\.zip$/i.test(file.name) && file.size > 0 && file.size < 32 * 1024 ** 2).sort((a, b) => Number(b.id) - Number(a.id))[0];
  if (!file) throw new Error('官方 Content Patcher 主文件暂不可用，请稍后重试');
  let job = downloads.jobs.find(job => job.gameId === context.game.id && job.resourceId === resource && job.fileId === file.id && job.status === 'completed');
  if (!job) {
   const view = downloads.start({ ...context.game, nexus: 'stardewvalley' }, resource, file.id, 'Content Patcher · 创作前置', undefined, client);
   job = downloads.jobs.find(job => job.id === view.id);
   const deadline = Date.now() + 180000;
   while (['queued', 'running'].includes(job.status) && Date.now() < deadline) {
    if (!context.current() || context.signal?.aborted) { downloads.cancel(job.id); throw new Error('账号已切换，已取消前置下载'); }
    await new Promise(resolve => setTimeout(resolve, 400));
   }
   if (job.status !== 'completed') { if (['queued', 'running'].includes(job.status)) downloads.cancel(job.id); throw new Error('Content Patcher 前置下载未完成：' + job.message); }
  }
  await context.authorize('library.manage'); if (!context.current()) throw new Error('账号已切换');
  const importDeadline = Date.now() + 30000;
  while (downloads.controllers.has(job.id) && Date.now() < importDeadline) await new Promise(resolve => setTimeout(resolve, 100));
  if (downloads.controllers.has(job.id)) throw new Error('Content Patcher 文件仍在校验，请稍后重试');
  const inspected = await installers.inspect(context.game, job.id);
  const manifests = inspected.filter(file => /(?:^|\/)manifest\.json$/i.test(file.path));
  if (manifests.length !== 1) throw new Error('Content Patcher 官方包结构不明确');
  const prepared = await installers.prepare(context.game, job.id, { mode: 'smapi', destination: 'Mods', requires: ['StardewModdingAPI.dll'] });
  try {
   if (prepared.units.length !== 1 || prepared.units[0].id !== 'Pathoschild.ContentPatcher') throw new Error('下载包不是官方 Content Patcher');
   await context.authorize('library.manage'); if (!context.current()) throw new Error('账号已切换');
   await installers.apply(context.game, prepared.id);
  } finally { await installers.discard(prepared.id); }
 }
 async function authorizeFile(owner, sessionId, client, game, resourceId, fileId, job) {
  if (client.nexusPlatform) throw new Error('文件由平台下载服务自动准备，无需客户端授权');
  if (!options.authorize) throw new Error('软件内文件授权需要桌面版');
  const resource = client.resource(game, resourceId);
  if (resource.source !== 'nexus' || resource.domain !== await client.nexusGame(game)) throw new Error('文件不属于当前游戏');
  const page = authorizationPage(resourceId, fileId);
  if (nexusTargets.size >= 100) nexusTargets.delete(nexusTargets.keys().next().value);
  nexusTargets.set(`${owner}:${resource.domain}:${resource.id}:${fileId}`, { owner, gameId: game.id });
  const messages = { queued: '等待自动获取 Nexus 文件授权', waiting: '正在自动获取 Nexus 文件授权', submitted: '正在等待 Nexus 免费下载倒计时', login_required: '请在 Nexus 窗口登录一次，登录后自动继续下载', verification_required: '请完成 Nexus 网页验证，完成后自动继续下载', manual_required: 'Nexus 页面需要确认，请在弹出的窗口完成后继续', failed: 'Nexus 文件授权未完成，请检查网页登录账号并重试', cancelled: '文件授权已取消，可重新获取授权' };
  await options.authorize(page, {
   owner, jobId: job?.id,
   isCurrent: () => sessionOwners.get(sessionId) === owner && connections.entries.get(owner)?.sources === client && !!client.keys.nexus && (!job || job.status === 'authorization_required'),
   receive: value => {
    const grant = parseNxm(value);
    if (grant.domain !== resource.domain || grant.modId !== resource.id || grant.fileId !== String(fileId)) throw new Error('NXM 文件授权与当前任务不匹配');
    return receiveNxm(value, game.id, sessionId);
   },
   onState: async state => {
    if (job?.status === 'authorization_required' && messages[state]) { job.message = messages[state]; await downloads.save(); }
   },
  });
 }
 downloads.onAuthorizationRequired = async (job, client) => {
  if (!options.authorize || !client.keys.nexus || job.status !== 'authorization_required') return;
  const owner = [...connections.entries].find(([, entry]) => entry.sources === client)?.[0];
  const sessionId = [...sessionOwners].find(([, accountId]) => accountId === owner)?.[0];
  if (!owner || !sessionId) return;
  const permission = await accounts.authorize(sessionId, 'library.manage');
  if (permission.account.id !== owner || connections.entries.get(owner)?.sources !== client || job.status !== 'authorization_required') return;
  await authorizeFile(owner, sessionId, client, downloadGame(job.gameId), job.resourceId, job.fileId, job);
 };
 async function installJob(job,profile,sessionId,operationId,extraCurrent=()=>true){
  if(!extraCurrent()||sessionOwners.get(sessionId)!==profile.id)throw new Error('账号已变化，安装已停止');
  const sources=(await connections.get(profile.id)).sources;
  const ensureEnvironment=(target,report)=>gameEnvironment.ensure({game:target,owner:profile.id,report,
   current:()=>extraCurrent()&&sessionOwners.get(sessionId)===profile.id,
   authorize:async feature=>{const permission=await accounts.authorize(sessionId,feature);if(permission.account.id!==profile.id||!extraCurrent()||sessionOwners.get(sessionId)!==profile.id)throw new Error('账号已切换，操作已停止');}});
  return installers.progress.run(job,profile.id,operationId,async report=>{
     let target=onlineGames().find(g=>g.id===job.gameId);
     if(!target&&job.gameId.startsWith('catalog:')){
      const catalog=workshop.game(job.gameId),matches=onlineGames().filter(g=>sameGame(catalog,g));
      if(matches.length!==1)throw new Error(matches.length?'检测到多个安装位置，请先选择要安装的游戏':'请先安装这款游戏并扫描游戏库');
      target=matches[0];job.game=target;job.gameId=target.id;job.gameName=target.name;await downloads.save();
     }
     if(!target)throw new Error('请重新扫描，确认游戏仍在本机');
     report('environment',2,'正在检查游戏环境和所需组件…');
     // This reviewed pack replaces existing addressable bundles and requires
     // only the base game; preparing a plugin loader is unrelated to its install.
     if(!(String(target.appId)==='1913370' && job.resourceId==='nexus:operator:114' && job.fileId==='181'))await ensureEnvironment(target,report);
     let context={};
     if(job.resourceId.startsWith('nexus:')||job.source==='banana'){
      report('environment',5,'正在读取 MOD 说明和前置要求…');
      const resource=sources.resource(target,job.resourceId),detail=await sources.detail(target,job.resourceId);
      const file=detail.files.find(file=>String(file.id)===String(job.fileId));if(!file)throw new Error('所选来源文件已下架，请重新选择');
      context={domain:resource.domain,url:job.source==='banana'?`https://gamebanana.com/mods/${resource.id}`:`https://www.nexusmods.com/${resource.domain}/mods/${resource.id}`,modName:job.name,description:detail.description,fileDescription:file.description,requirements:detail.requirementDetails||detail.requirements||[]};
     }
     if (job.source === 'studio') {
      const rule = await studio.ruleFor(target, job.studio || { adapterId: 'dialogue', draft: { kind: 'dialogue' } }, installers.getProfile(target).rule, profile.id);
      const plan = await installers.prepare(target, job.id, rule, report);
      try { return await installers.apply(target, plan.id, true, report); } catch (error) { await installers.discard(plan.id).catch(() => {}); throw error; }
     }
     const current=()=>sessionOwners.get(sessionId)===profile.id&&extraCurrent();
     const authorizeInstall=async()=>{
      const permission=await accounts.authorize(sessionId,'library.manage');
      if(!current()||permission.account.id!==profile.id)throw new Error('账号已切换，安装已停止');
     };
     context.beforeApply=authorizeInstall;
     context.checkCurrent=()=>{if(!current())throw new Error('账号已切换，安装已停止');};
     context.resolveWithAI=async(files,details,failure)=>{
      const authorize=async()=>{await authorizeInstall();const fresh=await accounts.session(sessionId);if(!studioAccess(fresh))throw new AccountError(403,'pro_required','AI 自动安装使用工程现有 pi agent，需要有效的 Pro AI 权限。');};
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('AI 安装分析超时，请重试')),180000);
      const tasks=aiInstallTasks.get(profile.id)||new Set();tasks.add(controller);aiInstallTasks.set(profile.id,tasks);
      try{const rule=await planWithPi({game:target,files,context:{...details,matchError:failure.message},ai:studio.options,accountId:profile.id,signal:controller.signal,current,authorize,report});context.beforeApply=authorize;return rule;}
      finally{clearTimeout(timer);tasks.delete(controller);if(!tasks.size&&aiInstallTasks.get(profile.id)===tasks)aiInstallTasks.delete(profile.id);}
     };
     return installers.installAuto(target,job.id,context,report);
     });
 }
 bundles=await new DownloadBundles(root,downloads,{
  current:(owner,id)=>sessionOwners.get(id)===owner,
  installBusy:()=>installers.busy||installers.progress.task?.status==='running',
  readyForInstall:jobId=>!downloads.controllers.has(jobId),
  installed:jobId=>installers.state.mods.find(m=>m.jobId===jobId),
  authorize:async(owner,id)=>{const permission=await accounts.authorize(id,'library.manage');if(permission.account.id!==owner||sessionOwners.get(id)!==owner)throw new Error('账号已切换，组合任务已停止');},
  install:async(jobId,owner,id,current)=>{const job=downloads.jobs.find(j=>j.id===jobId&&j.status==='completed');if(!job)throw new Error('组合文件尚未下载完成');return installJob(job,await accounts.requireSession(id),id,undefined,current);},
 }).open();
 const server = http.createServer(async (req, res) => {
  let requestOwner;
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
  const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  try {
   if (req.headers.host !== `127.0.0.1:${server.address().port}`) return send({ error: '非法访问地址' }, 403);
   const url = new URL(req.url, `http://${req.headers.host}`);
   const cookieName = `moddock-account-${server.address().port}`;
   const sessionId = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
   requestOwner = sessionOwners.get(sessionId);
   const sessionCookie = id => res.setHeader('Set-Cookie', [
    `${cookieName}=${id || ''}; HttpOnly; SameSite=Strict; Path=/api${id ? '' : '; Max-Age=0'}`,
    `${cookieName}=; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=0`,
   ]);
   if (url.pathname.startsWith('/api/')) {
    if (req.method === 'GET' && url.pathname === '/api/auth/config') return send({ ...accounts.config, token });
    if (req.method === 'GET' && url.pathname === '/api/auth/session') {
     const profile = await accounts.session(sessionId);
     if (!profile) { sessionCookie(null); releaseOwner(requestOwner); sessionOwners.delete(sessionId); }
     return send({ profile, ...accounts.status(sessionId) });
    }
    const profile = !url.pathname.startsWith('/api/auth/') ? await accounts.requireSession(sessionId) : null;
    const sources = profile ? (await connections.get(profile.id)).sources : null;
    if (req.method === 'GET' && url.pathname === '/api/account/me') return send({ account: await accounts.session(sessionId) });
    if (req.method === 'GET' && url.pathname === '/api/account/plans') return send(await accounts.plans(sessionId));
    if (req.method === 'GET' && url.pathname === '/api/account/orders') return send(await accounts.orders(sessionId));
    if (req.method === 'GET' && url.pathname.startsWith('/api/account/orders/')) return send(await accounts.order(sessionId, decodeURIComponent(url.pathname.slice('/api/account/orders/'.length))));
    if (req.method === 'GET' && url.pathname === '/api/state') return send({ scan: scanResult, token, games: scanResult.games, sourceGames: onlineGames(), providers, connections: await connections.status(profile.id), nexusSso: sso.status(profile.id), jobs: downloads.view(profile.id), bundles: bundles.view(profile.id), installations: installers.view(onlineGames(),profile.id), studio: studio.status(profile), scanPaths: config.scanPaths, canChooseScanDirectory: typeof options.chooseScanDirectory === 'function', mappings: config.mappings, downloadPath: downloads.root, autoImport:config.autoImport!==false, recipes, nxmStatus: nxmStatus?.owner === profile.id ? nxmStatus : null, nexusAuthorizationWindow:!!options.authorize, nxmProtocol:options.protocolStatus?.()||false });
    if (req.method !== 'POST' || req.headers['x-moddock-token'] !== token) return send({ error: '请求未授权' }, 403);
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return send({ error: '请求来源无效' }, 403);
    const bodyLimit = ['/api/studio/save', '/api/studio/generate'].includes(url.pathname) ? 128 * 1024 : 16384;
    let requestBytes = 0; const chunks = [];
    for await (const chunk of req) { requestBytes += chunk.length; if (requestBytes > bodyLimit) return send({ error: '请求过大' }, 413); chunks.push(chunk); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (url.pathname === '/api/auth/code') return send(await accounts.sendCode(body));
    if (url.pathname === '/api/auth/restore') {
     const result = await accounts.restore();
     if (result.id) sessionCookie(result.id); else sessionCookie(null);
     if (result.id) { sessionOwners.set(result.id, result.profile.id); await connections.get(result.profile.id); }
     const { id, ...view } = result;
     return send(view);
    }
    if (url.pathname === '/api/auth/reset-password') {
     const result = await accounts.resetPassword(body);
     for (const [id, owner] of sessionOwners) if (!(await accounts.session(id).catch(() => null))) { releaseOwner(owner); sessionOwners.delete(id); }
     if (!sessionOwners.has(sessionId)) sessionCookie(null);
     return send(result);
    }
    if (url.pathname === '/api/auth/login' || url.pathname === '/api/auth/register') {
     const session = await accounts[url.pathname.endsWith('/login') ? 'login' : 'register'](body);
     if (sessionId) { await accounts.logout(sessionId).catch(() => {}); }
     releaseOwner(requestOwner); sessionOwners.delete(sessionId);
     sessionOwners.set(session.id, session.profile.id); await connections.get(session.profile.id);
     sessionCookie(session.id);
     return send({ profile: session.profile, remember: session.remember, storageWarning: session.storageWarning });
    }
    if (url.pathname === '/api/auth/logout') {
     sessionCookie(null);
     releaseOwner(requestOwner); sessionOwners.delete(sessionId);
     return send(await accounts.logout(sessionId));
    }
    if (url.pathname === '/api/account/password') {
     const result = await accounts.changePassword(sessionId, body);
     releaseOwner(profile.id); sessionOwners.delete(sessionId); sessionCookie(null); return send(result);
    }
    if (url.pathname === '/api/account/authorize') return send(await accounts.authorize(sessionId, body.featureKey));
    if (url.pathname === '/api/account/orders') return send(await accounts.createOrder(sessionId, body));
    if (featureForRoute[url.pathname]) await accounts.authorize(sessionId, featureForRoute[url.pathname]);
    if (url.pathname === '/api/nexus/sso/start' && sources.nexusPlatform) throw new Error('Nexus 下载由平台服务提供，无需连接个人账号');
    if (url.pathname === '/api/nexus/sso/start') return send(sso.start(profile.id, async (key, current) => {
     const permission = await accounts.authorize(sessionId, 'configuration.edit');
     if (permission.account.id !== profile.id || !current()) throw new Error('账号已切换');
     const user = await sources.request('https://api.nexusmods.com/v1/users/validate.json', { headers: { apikey: key, 'Application-Name': 'Moddock', 'Application-Version': require('./package.json').version } });
     if (!user?.user_id || !current()) throw new Error('Nexus 授权无效');
     await connectSource(profile.id, 'nexus', key, current);
    }));
    if (url.pathname === '/api/nexus/sso/cancel') { sso.cancel(profile.id, body.id); return send(sso.status(profile.id)); }
    const game = () => { const g = onlineGames().find(g => g.id === body.gameId); if (!g) throw new Error('请先扫描并选择本机安装的游戏'); return g; };
    const ensureEnvironment = (target, report) => gameEnvironment.ensure({ game: target, owner: profile.id, report,
     current: () => sessionOwners.get(sessionId) === profile.id,
     authorize: async feature => {
      const permission = await accounts.authorize(sessionId, feature);
      if (permission.account.id !== profile.id || sessionOwners.get(sessionId) !== profile.id) throw new Error('账号已切换，操作已停止');
     } });
    const creationJob = downloads.jobs.find(job => job.source === 'studio' && (job.id === body.jobId || job.id === body.id || installers.plans.get(body.id)?.jobId === job.id));
    if (creationJob && creationJob.creationOwner !== profile.id) throw new AccountError(403, 'creation_owner_mismatch', '此内容包不属于当前账号');
    if (creationJob) {
     const permission = await accounts.authorize(sessionId, 'library.manage');
     if (permission.account.id !== profile.id || !studioAccess(permission.account)) throw new AccountError(403, 'pro_required', '创作项目的导入与安装需要 Pro 权限。');
    }
    if (url.pathname.startsWith('/api/studio/')) {
     const permission = await accounts.authorize(sessionId, 'library.manage');
     if (permission.account.id !== profile.id || !studioAccess(permission.account)) throw new AccountError(403, 'pro_required', 'AI Mod 创作工作台为 Pro 高级功能。');
     const owner = profile.id;
     const current = () => sessionOwners.get(sessionId) === owner;
     if (url.pathname === '/api/studio/games/add') {
      if (!options.chooseStudioGame) throw new Error('请在桌面端选择或拖入本机游戏');
      const selected = body.path || await options.chooseStudioGame();
      if (!current()) throw new Error('账号已切换');
      if (!selected) return send({ cancelled: true });
      const added = await resolveStudioGame(selected, scanResult.games);
      const freshPermission = await accounts.authorize(sessionId, 'configuration.edit');
      if (!current() || freshPermission.account.id !== owner || !studioAccess(freshPermission.account)) throw new Error('账号或 Pro 权限已变化，操作已停止');
      if (!scanResult.games.some(game => game.id === added.id)) {
       if ((config.localGames || []).length >= 50) throw new Error('最多添加 50 个本机游戏');
       const previous = config.localGames; config.localGames = [...(previous || []), added];
       try { await saveConfig(); } catch (error) { config.localGames = previous; throw error; }
       scanResult = mergeStudioGames(scanResult, [added]);
      }
      return send({ game: added });
     }
     const target = game();
     if (url.pathname === '/api/studio/environment') return send(await gameEnvironment.status(target));
     if (url.pathname === '/api/studio/prepare-environment') return send(await ensureEnvironment(target));
     if (url.pathname === '/api/studio/conversations/list') return send({ items: await studio.conversations.list(owner, target) });
     if (url.pathname === '/api/studio/conversations/read') return send(await studio.conversations.read(owner, target, body.id));
     if (url.pathname === '/api/studio/conversations/logs') return send(await studio.conversations.diagnostics(owner, target, body.id));
     const authorize = async feature => {
      const permission = await accounts.authorize(sessionId, feature);
      if (!current() || permission.account.id !== owner || !studioAccess(permission.account)) throw new AccountError(403, 'pro_required', '账号或 Pro 权限已变化，操作已停止。');
     };
     if (url.pathname === '/api/studio/library') return send(await lifecycle.keep({ owner, game: target, artifactId: body.id, current, authorize }));
     if (url.pathname === '/api/studio/controls' || url.pathname === '/api/studio/controls/update' || url.pathname === '/api/studio/controls/action-status') {
      const context = { owner, game: target, artifactId: body.id, current, authorize };
      return send(url.pathname.endsWith('/update') ? await controls.update(context, body) : url.pathname.endsWith('/action-status') ? await controls.actionStatus(context, body.nonce) : await controls.get(context));
     }
     if (url.pathname === '/api/studio/conversations/send') return send(await studio.conversations.send(owner, target, body, current, authorize), 202);
     if (url.pathname === '/api/studio/workspace') return send(await studio.workspace(target));
     if (url.pathname === '/api/studio/diagnose') return send((await studio.workspace(target)).diagnostic);
     if (url.pathname === '/api/studio/reference') return send({ text: await studio.integration.document(body.path) });
     if (url.pathname === '/api/studio/list') return send({ items: await studio.list(owner, target.id) });
     if (url.pathname === '/api/studio/save') return send(await studio.save(owner, target, body.draft));
     if (url.pathname === '/api/studio/read') { const item = await studio.read(owner, body.id); if (item.gameId !== target.id) throw new Error('创作不属于当前游戏'); return send(item); }
     if (url.pathname === '/api/studio/preview') return send(await studio.preview(owner, target, body.id));
     if (url.pathname === '/api/studio/toolchain') { const item = await studio.read(owner, body.id); if (item.gameId !== target.id) throw new Error('创作不属于当前游戏'); return send({ report: item.toolchain, environment: await studio.toolchain.environment() }); }
     if (url.pathname === '/api/studio/delete') return send(await studio.remove(owner, target, body.id));
     if (url.pathname === '/api/studio/generate') return send(await studio.generate(owner, target, body, current));
     if (url.pathname === '/api/studio/cancel') { studio.cancelOwner(owner); return send({ ok: true }); }
     if (url.pathname === '/api/studio/export' || url.pathname === '/api/studio/prepare') {
      if (url.pathname === '/api/studio/export') {
       const { item, bytes } = await studio.archive(owner, target, body.id);
       const compiled = ['bg3-lua', 'bg3-follower', 'engine-mod'].includes(item.adapterId);
       const buildId = body.buildId || (compiled && !body.source && item.toolchain?.status === 'passed' ? item.toolchain.id : null);
       if (['bg3-lua', 'bg3-follower'].includes(item.adapterId) && !body.source && !body.buildId && !item.toolchain?.bundle) throw new Error('尚未生成可导出的 BG3 Mod 包，请先完成编译与打包');
       return send(buildId ? await studio.toolchain.bundle(owner, target, item.id, buildId) : { filename: item.draft.name + '.zip', base64: bytes.toString('base64') });
      }
      const saved = await studio.read(owner, body.id);
      if (!saved.toolchain) await studio.toolchain.run(owner, target, body.id, await studio.workspace(target), { current, authorize });
      const { item, bytes } = await studio.deploymentArchive(owner, target, body.id);
      const rule = await studio.ruleFor(target, item, installers.getProfile(target).rule);
      await ensureEnvironment(target);
      const imported = await downloads.importCreation(target, item, bytes, owner);
      await library.import(target, imported.id);
      return send(await installers.prepare(target, imported.id, rule));
     }
     throw new Error('未知创作操作');
    }
    if (url.pathname === '/api/workshop/catalog') return send(workshop.list(body));
    if (url.pathname === '/api/workshop/game') return send(workshop.game(body.gameId));
    if (url.pathname === '/api/workshop/mapping') {
     const g = workshop.game(body.gameId), source = body.source;
     if (!['nexus', 'banana'].includes(source)) throw new Error('来源匹配参数无效');
     const candidate = sources.binding(source, g).candidates?.find(item => item.id === body.id);
     if (!candidate) throw new Error('候选专区已更新，请重新查询后选择');
     if (!(source === 'nexus' ? /^[a-z0-9_-]{1,80}$/ : /^[1-9]\d{0,14}$/).test(candidate.id)) throw new Error('候选专区标识无效');
     const previous = config.workshopMappings || {}, previousLocal = config.mappings;
     config.workshopMappings = { ...previous, [g.id]: { ...previous[g.id], [source]: candidate.id } };
     config.mappings = { ...previousLocal };
     for (const id of g.localIds) config.mappings[id] = { ...previousLocal[id], [source]: candidate.id };
     try { await saveConfig(); } catch (error) { config.workshopMappings = previous; config.mappings = previousLocal; throw error; }
     sources.cache.clear(); sources.gameIds.clear();
     return send(workshop.game(g.id));
    }
    if (url.pathname === '/api/workshop/list') {
     const g = workshop.game(body.gameId);
     if (body.force === true) sources.cache.clear();
     const result = await sources.list(body.source, g, body.query || '', body.page ?? 1);
     workshop.remember(result.items);
     return send(result);
    }
    if (url.pathname === '/api/workshop/detail') {
     const detail = await sources.detail(workshop.game(body.gameId), body.id);
     return send({ ...detail, files: detail.files.map(({ _url, md5, ...file }) => file) });
    }
    if (url.pathname === '/api/workshop/favorites') return send(await workshop.favorites(profile.id));
    if (url.pathname === '/api/workshop/favorite') {
     if (typeof body.enabled !== 'boolean') throw new Error('收藏参数无效');
     workshop.game(body.gameId);
     const existing = await workshop.favorites(profile.id);
     const item = body.enabled ? workshop.items.get(`${body.gameId}/${body.id}`) || existing.find(m => m.gameId === body.gameId && m.id === body.id) : { id: body.id, gameId: body.gameId };
     if (!item) throw new Error('请刷新资源列表后再收藏');
     return send(await workshop.saveFavorite(profile.id, item, body.enabled));
    }
    if (url.pathname === '/api/workshop/attach') {
     const target = game(), job = downloads.jobs.find(j => j.id === body.jobId && j.status === 'completed');
     if (!job || !job.gameId.startsWith('catalog:')) throw new Error('请选择尚未关联游戏的已下载 MOD');
     if (!sameGame(workshop.game(job.gameId), target)) throw new Error('此下载不属于所选本机游戏');
     job.game = target; job.gameId = target.id; job.gameName = target.name;
     await downloads.save();
     await library.import(target, job.id);
     return send({ ok: true });
    }
    if(url.pathname==='/api/library/import')return send(await library.import(game(),body.jobId));
    if(url.pathname==='/api/library/auto-import'){if(typeof body.enabled!=='boolean')throw new Error('自动导入设置无效');config.autoImport=body.enabled;await saveConfig();return send({ok:true});}
    if(url.pathname==='/api/updates/check')return send(await new ModLibrary(downloads,installers,sources).checkUpdates(game()));
    if(url.pathname==='/api/updates/download')return send(await new ModLibrary(downloads,installers,sources).downloadUpdate(game(),body.id,body.fileId));
    if(url.pathname==='/api/loadouts/save')return send(await installers.saveLoadout(game(),body.name));
    if(url.pathname==='/api/loadouts/switch'){const target=game();await ensureEnvironment(target);return send(await installers.switchLoadout(target,body.id));}
    if(url.pathname==='/api/loadouts/delete')return send(await installers.deleteLoadout(game(),body.id));
    if(url.pathname==='/api/nexus/receive')return send(await receiveNxm(body.url,body.gameId,sessionId));
    if(url.pathname==='/api/nexus/authorize'){const g=downloadGame(body.gameId);const job=downloads.jobs.find(j=>j.gameId===g.id&&j.resourceId===body.id&&j.fileId===String(body.fileId)&&j.status==='authorization_required');await authorizeFile(profile.id,sessionId,sources,g,body.id,body.fileId,job);return send({ok:true});}
    if (url.pathname === '/api/installations/profile') return send(await installers.setProfile(game(), body.rule));
    if (url.pathname === '/api/installations/inspect') return send(await installers.inspect(game(), body.jobId));
    if (url.pathname === '/api/installations/auto') {
     const job=downloads.jobs.find(j=>j.id===body.jobId&&j.status==='completed');
     if(!job)throw new Error('请选择已经下载完成的 MOD');
     return send(await installJob(job,profile,sessionId,body.operationId));
    }
    if (url.pathname === '/api/installations/restore') return send(await installers.restoreNative(game()));
    if (url.pathname === '/api/installations/plan') {
     const target = game(), rule = creationJob ? await studio.ruleFor(target, creationJob.studio || { adapterId: 'dialogue', draft: { kind: 'dialogue' } }, installers.getProfile(target).rule, profile.id) : undefined;
     await ensureEnvironment(target);
     return send(await installers.prepare(target, body.jobId, rule));
    }
    if (url.pathname === '/api/installations/discard') return send(await installers.discard(body.id));
    if (url.pathname === '/api/installations/apply') { const target = game(); await ensureEnvironment(target); return send(await installers.apply(target, body.id, body.allowOverwrite === true)); }
    if (url.pathname === '/api/installations/action') { const target = game(); if (body.action === 'enable') await ensureEnvironment(target); return send(await installers.action(target, body.id, body.action)); }
    if (url.pathname === '/api/installations/launch') {
     const target=game();
     if(installers.state.mods.some(mod=>mod.gameId===target.id&&mod.profile.mode==='bg3'&&(mod.status==='enabled'||body.enabledModIds?.includes(mod.id))))await ensureEnvironment(target);
     if(Array.isArray(body.enabledModIds)&&installers.state.mods.some(mod=>mod.gameId===target.id&&mod.status!==(body.enabledModIds.includes(mod.id)?'enabled':'disabled')))await accounts.authorize(sessionId,'library.manage');
     const current=()=>sessionOwners.get(sessionId)===profile.id;
     const authorizeRuntime=async feature=>{
      const permission=await accounts.authorize(sessionId,feature);
      if(!current() || permission.account.id!==profile.id || !studioAccess(permission.account)) throw new Error('账号或 AI 权限已变化，自动修复已停止');
     };
     const replacements=await lifecycle.prepareRecoveries(profile.id,target,current,authorizeRuntime,body.enabledModIds);
     const selected=body.enabledModIds?.map(id=>replacements.get(id)||id);
     const captured=await lifecycle.capture(profile.id,target,selected);
     const run=await installers.launch(target,selected);
     await lifecycle.attachCaptured(profile.id,target,run,captured);
     lifecycle.watchCaptured(profile.id,target,captured,current,authorizeRuntime);
     return send(run);
    }
    if (url.pathname === '/api/installations/run') return send(await installers.checkRun(game(), body.id));
    if (url.pathname === '/api/sources/list') { if (body.force === true) sources.cache.clear(); return send(await sources.list(body.source, game(), body.query || '', body.page ?? 1)); }
    if (url.pathname === '/api/sources/detail') { const detail = await sources.detail(game(), body.id); return send({ ...detail, files: detail.files.map(({ _url, md5, ...f }) => f) }); }
    if (url.pathname === '/api/sources/connection') { if (body.source === 'nexus') sso.cancel(profile.id); return send(await connectSource(profile.id,body.source,body.key)); }
    if(url.pathname==='/api/downloads/bundles/pause'){bundles.pause(profile.id,body.id);return send({ok:true});}
    if(['/api/downloads/bundles/options','/api/downloads/bundles/start','/api/downloads/bundles/resume'].includes(url.pathname)){
     const existing=url.pathname.endsWith('/resume')?bundles.find(profile.id,body.bundleId):null;
     let target=downloadGame(existing?.gameId||body.gameId);
     if(target.id.startsWith('catalog:')){const matches=onlineGames().filter(g=>sameGame(workshop.game(target.id),g));if(matches.length===1)target=matches[0];}
     const resourceId=existing?.resourceId||body.resourceId;
     const detail=await sources.detail(target,resourceId);
     if(url.pathname.endsWith('/options'))return send({...bundleOptions(detail),gameId:target.id,canAutoInstall:!!target.installPath});
     if(existing)return send(await bundles.resume(profile.id,existing.id,sessionId,target,detail,sources,body.installAfter));
     return send(await bundles.start({owner:profile.id,sessionId,game:target,resourceId,detail,client:sources,fileIds:body.fileIds,installAfter:body.installAfter??false,name:body.name,requestId:body.requestId}));
    }
    if (url.pathname === '/api/downloads/start') return send(downloads.start(downloadGame(body.gameId), body.id, body.fileId, body.name,undefined,sources));
    if (url.pathname === '/api/downloads/verification' || url.pathname === '/api/downloads/verification-click') {
     const controller = new AbortController();
     const cancel = () => { if (!res.writableEnded) controller.abort(); };
     res.on('close', cancel);
     try {
      await accounts.authorize(sessionId, 'library.manage');
      if (controller.signal.aborted) return;
      const result = await downloads.verification(body.id, sources, url.pathname.endsWith('-click') ? { revision: body.revision, x: body.x, y: body.y } : undefined, { signal: controller.signal });
      if (!controller.signal.aborted) return send(result);
     } finally { res.off('close', cancel); }
     return;
    }
    if (url.pathname === '/api/downloads/cancel') { downloads.cancel(body.id); options.cancelAuthorization?.(profile.id, body.id); return send({ ok: true }); }
    if (url.pathname === '/api/downloads/file') { const file = await downloads.completedFile(body.id); res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}` }); createReadStream(file.file).pipe(res); return; }
    if (url.pathname === '/api/downloads/reveal') { const file = await downloads.completedFile(body.id); if (!options.reveal) throw new Error('此功能需要桌面版'); await options.reveal(file.file); return send({ ok: true }); }
    if (url.pathname === '/api/scan') { scanResult = await doScan(config.scanPaths); return send(scanResult); }
    if (url.pathname === '/api/paths/select') {
     if (!options.chooseScanDirectory) return send({ error: '请在桌面端选择游戏库文件夹' }, 501);
     if (choosingScanDirectory) return send({ error: '文件夹选择窗口已打开' }, 409);
     choosingScanDirectory = true;
     try {
      const selected = await options.chooseScanDirectory();
      if (!selected) return send({ cancelled: true });
      const directory = await resolveSteamRoot(selected);
      // The user may sign out or lose permission while the native dialog is open.
      const permission = await accounts.authorize(sessionId, 'configuration.edit');
      if (permission.account.id !== profile.id) throw new Error('账号已切换，请重新选择');
      if ([...config.scanPaths, ...(scanResult.roots || [])].some(item => pathKey(item) === pathKey(directory))) return send({ added: false, path: directory });
      if (config.scanPaths.length >= 20) throw new Error('最多添加 20 个额外游戏库，请先移除不再使用的位置');
      const previous = config.scanPaths; config.scanPaths = [...previous, directory];
      try { await saveConfig(); } catch (error) { config.scanPaths = previous; throw error; }
      return send({ added: true, path: directory });
     } finally { choosingScanDirectory = false; }
    }
    if (url.pathname === '/api/paths/remove') {
     if (typeof body.path !== 'string' || !config.scanPaths.includes(body.path)) throw new Error('这个额外扫描位置已被移除');
     const previous = config.scanPaths; config.scanPaths = previous.filter(item => item !== body.path);
     try { await saveConfig(); } catch (error) { config.scanPaths = previous; throw error; }
     return send({ removed: true });
    }
    if (url.pathname === '/api/paths') { if (!Array.isArray(body.paths) || body.paths.length > 20 || body.paths.some(p => typeof p !== 'string' || !path.isAbsolute(p))) throw new Error('请输入绝对路径，每行一个，最多 20 个'); config.scanPaths = body.paths; await saveConfig(); return send({ ok: true }); }
    if (url.pathname === '/api/mapping') {
     const g = game(); const m = body.mapping;
     if (!m || typeof m !== 'object' || typeof m.searchName !== 'string' || m.searchName.length > 160 || !/^[a-z0-9_-]*$/.test(m.nexus || '') || !/^\d*$/.test(m.banana || '') || !/^\d*$/.test(m.appId || '')) throw new Error('来源匹配参数无效');
     if (g.platform === 'Steam' && m.appId && m.appId !== g.appId) throw new Error('Steam 游戏的 App ID 从安装记录读取，不能改为其他游戏');
     config.mappings[g.id] = { searchName: m.searchName.trim() || g.name, ...(m.nexus ? { nexus: m.nexus } : {}), ...(m.banana ? { banana: m.banana } : {}), ...(m.appId ? { appId: m.appId } : {}) }; sources.cache.clear(); sources.gameIds.clear(); await saveConfig(); return send({ ok: true });
    }
    return send({ error: '接口不存在' }, 404);
   }
   const files = { '/': 'index.html', '/favicon.svg': 'favicon.svg', '/favicon.ico': 'favicon.svg', '/app.js': 'app.js', '/download-bundles.js':'download-bundles.js', '/download-bundles.css':'download-bundles.css', '/style.css': 'style.css', '/auth.js': 'auth.js', '/auth.css': 'auth.css', '/splash.svg': 'splash.svg', '/splash-preview.html': 'splash-preview.html', '/splash-preview.css': 'splash-preview.css', '/splash-preview.js': 'splash-preview.js', '/logo-loading.svg': 'logo-loading.svg', '/logo-loading-preview.html': 'logo-loading-preview.html', '/youxia-ai-mascot.png': 'youxia-ai-mascot.png', '/youxia-ai-mascot.svg': 'youxia-ai-mascot.svg', '/mascot-preview.html': 'mascot-preview.html', '/mascot-preview.css': 'mascot-preview.css', '/mascot-preview.js': 'mascot-preview.js', '/fonts/fusion-pixel-12px-proportional-zh_hans.woff2': 'fonts/fusion-pixel-12px-proportional-zh_hans.woff2' }; const name = files[url.pathname] || (/^\/covers\/\d+\.jpg$/.test(url.pathname) ? url.pathname.slice(1) : undefined); if (!name) { res.writeHead(404); return res.end('Not found'); }
   res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https://cdn.akamai.steamstatic.com https://shared.akamai.steamstatic.com https://staticdelivery.nexusmods.com https://images.gamebanana.com https://images.steamusercontent.com https://steamuserimages-a.akamaihd.net data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://api.translate.zvo.cn; frame-ancestors 'none'; base-uri 'none'");
   const content = await fs.readFile(path.join(__dirname, 'public', name));
   res.writeHead(200, { 'Content-Type': name.endsWith('.jpg') ? 'image/jpeg' : name.endsWith('.png') ? 'image/png' : name.endsWith('.woff2') ? 'font/woff2' : name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' }); res.end(content);
  } catch (e) {
   if (res.destroyed || res.writableEnded) return;
   if (e instanceof AccountError) {
    if (e.status === 401 || ['account_disabled', 'disabled', 'user_disabled'].includes(e.code)) releaseOwner(requestOwner);
    if (e.status === 401 || ['account_disabled', 'disabled', 'user_disabled'].includes(e.code)) res.setHeader('Set-Cookie', ['/api', '/api/auth'].map(cookiePath => `moddock-account-${server.address().port}=; HttpOnly; SameSite=Strict; Path=${cookiePath}; Max-Age=0`));
    if (e.retryAfterSeconds) res.setHeader('Retry-After', String(e.retryAfterSeconds));
    return send({ code: e.code, message: e.message, retryAfterSeconds: e.retryAfterSeconds, account: e.account, reason: e.reason }, e.status);
   }
   if (!res.headersSent) send({ error: e.message }, 400); else res.destroy();
  }
 });
 await new Promise(resolve => server.listen(options.port ?? Number(process.env.PORT || 4173), '127.0.0.1', resolve));
 server.on('close', () => { lifecycle.close(); void bundles.close().catch(()=>{}); for(const tasks of aiInstallTasks.values())for(const controller of tasks)controller.abort(new Error('客户端已关闭'));aiInstallTasks.clear();studio.close(); sso.close(); connections.close(); accounts.clear(); });
 return { bundles, server, sources, downloads, installers, library, studio, bg3Extender, gameEnvironment, receiveNxm, accountLegalUrls: accounts.config.legalUrls, url: `http://127.0.0.1:${server.address().port}` };
}
if (require.main === module) createServer().then(({ url }) => console.log(`游匣已启动：${url}`)).catch(e => { console.error(e.message); process.exit(1); });
module.exports = { createServer };
