import { gameUpdateNotice } from './game-update-notice.js';
export function createModManager({ data, esc, icon, cover, empty, render, openModal, runCard, ruleEvidence, updatePanel }) {
 let gameId='all', tab='installed', query='';
 const mods=()=>data().installations?.mods||[];
 const pending=()=>data().jobs.filter(job=>job.status==='completed'&&job.import?.status==='ready'&&!mods().some(mod=>mod.jobId===job.id));
 const matches=item=>`${item.name} ${item.gameName}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
 const gameArt=game=>`<span class="manager-game-art">${icon('gamepad')}${game.appId?`<img src="${cover(game.appId)}" alt="" loading="lazy">`:''}</span>`;
 function games() {
  const entries=new Map();
  for(const item of [...mods(),...pending()]) {
   if(!entries.has(item.gameId))entries.set(item.gameId,data().sourceGames.find(game=>game.id===item.gameId)||{id:item.gameId,name:item.gameName});
  }
  return [...entries.values()];
 }
 function row(mod) {
  const enabled=mod.status==='enabled';
  const warning=['changed','loader_with_errors'].includes(mod.verification?.status);
  return `<article class="manager-mod-row managed-row ${enabled?'':'is-disabled'}">
   <span class="manager-mod-icon">${icon('box')}</span>
   <div class="manager-mod-copy"><button id="manager-name-${esc(mod.id)}" class="manager-mod-name" data-managed-detail="${esc(mod.id)}">${esc(mod.name)}</button><p>${mod.version?`v${esc(mod.version)} <span>·</span> `:''}${mod.files.length} 个文件${warning?` <span>·</span> <button class="manager-warning" data-managed-detail="${esc(mod.id)}">${icon('info')}需要检查</button>`:''}${mod.update?.files?.length?` <span>·</span> <button class="manager-update" data-managed-detail="${esc(mod.id)}">${mod.update.status==='review'?'有文件需核对':'有可用更新'}</button>`:''}</p></div>
   <span class="manager-state ${enabled?'is-enabled':''}">${enabled?'已启用':'已停用'}</span>
   <button id="manager-toggle-${esc(mod.id)}" class="manager-switch" role="switch" aria-checked="${enabled}" aria-label="${enabled?'停用':'启用'} ${esc(mod.name)}" data-mod-action="${enabled?'disable':'enable'}" data-managed-id="${esc(mod.id)}"><span></span></button>
   <button id="manager-detail-${esc(mod.id)}" class="manager-details-button" data-managed-detail="${esc(mod.id)}" aria-label="${esc(mod.name)}的详情与更多操作" title="详情与更多操作">${icon('chevron')}</button>
  </article>`;
 }
 function pendingRow(job) {
  return `<article class="manager-mod-row manager-pending-row"><span class="manager-mod-icon">${icon('download')}</span><div class="manager-mod-copy"><h3>${esc(job.name)}</h3><p>${job.version?`v${esc(job.version)} <span>·</span> `:''}${job.import.files.length} 个文件 <span>·</span> 已准备好</p></div><details class="install-advanced" data-help-key="advanced-${esc(job.id)}"><summary>高级设置</summary><button class="btn small" data-rule-game="${esc(job.gameId)}" data-rule-job="${esc(job.id)}">设置安装规则</button></details><button class="btn primary small" data-install-job="${esc(job.id)}">一键安装</button></article>`;
 }
 function group(game,items) {
  const local=data().sourceGames.some(item=>item.id===game.id&&item.installPath);
  return `<section class="manager-group" aria-label="${esc(game.name)}的 Mod"><header class="manager-group-head"><div>${gameArt(game)}<h3>${esc(game.name)}</h3><span>${items.length}</span></div>${local?`<div class="manager-game-actions">${mods().some(mod=>mod.gameId===game.id)?`<button class="manager-settings-button" data-manager-settings="${esc(game.id)}" aria-label="${esc(game.name)}的游戏设置" title="游戏设置">${icon('settings')}</button>`:''}<button class="btn small manager-launch" data-launch-game="${esc(game.id)}">${icon('play')}启动游戏</button></div>`:''}</header><div class="manager-mod-list">${items.map(tab==='installed'?row:pendingRow).join('')}</div></section>`;
 }
 function content() {
  const allGames=games();
  if(gameId!=='all'&&!allGames.some(game=>game.id===gameId))gameId='all';
  const inGame=item=>gameId==='all'||item.gameId===gameId;
  const installedMods=mods().filter(inGame),pendingJobs=pending().filter(inGame);
  const items=(tab==='installed'?installedMods:pendingJobs).filter(matches);
  const shownGames=allGames.filter(game=>items.some(item=>item.gameId===game.id));
  const runs=(data().installations?.runs||[]).filter(inGame);
  const selectedGame=allGames.find(game=>game.id===gameId);
  return `<div class="manager-heading"><div><h1>Mod 管理</h1><p>让喜欢的游戏，按你的方式运行。</p></div><button class="btn manager-browse" data-nav="workshop">${icon('compass')}发现更多 Mod</button></div>
   ${gameUpdateNotice(data(),esc,gameId==='all'?undefined:gameId)}<div class="manager-layout"><aside class="manager-sidebar" aria-label="按游戏筛选 Mod"><div class="manager-sidebar-label">我的 Mod 库 <span>${allGames.length} 款游戏</span></div><button class="manager-game ${gameId==='all'?'is-selected':''}" data-manager-game="all" aria-pressed="${gameId==='all'}"><span class="manager-all-icon">${icon('grid')}</span><span>全部游戏</span><b>${mods().length+pending().length}</b></button><div class="manager-game-divider"></div>${allGames.map(game=>`<button class="manager-game ${gameId===game.id?'is-selected':''}" data-manager-game="${esc(game.id)}" aria-pressed="${gameId===game.id}">${gameArt(game)}<span>${esc(game.name)}</span><b>${mods().filter(mod=>mod.gameId===game.id).length+pending().filter(job=>job.gameId===game.id).length}</b></button>`).join('')}<div class="manager-sidebar-note">${icon('shield')}<span>原始文件自动备份<br>随时停用或还原</span></div></aside>
   <section class="manager-workspace" aria-label="${esc(selectedGame?.name||'全部游戏')}的 Mod 列表"><div class="manager-toolbar"><div class="manager-tabs" role="tablist" aria-label="安装状态"><button id="manager-tab-installed" role="tab" aria-selected="${tab==='installed'}" aria-controls="manager-results" tabindex="${tab==='installed'?0:-1}" data-manager-tab="installed">已安装 <span>${installedMods.length}</span></button><button id="manager-tab-pending" role="tab" aria-selected="${tab==='pending'}" aria-controls="manager-results" tabindex="${tab==='pending'?0:-1}" data-manager-tab="pending">待安装 <span>${pendingJobs.length}</span></button></div><label class="manager-search">${icon('search')}<input id="manager-search" value="${esc(query)}" placeholder="搜索 Mod…" aria-label="搜索 Mod">${query?`<button data-manager-clear aria-label="清空搜索">${icon('close')}</button>`:''}</label></div>
   <div id="manager-results" class="manager-results" role="tabpanel" aria-labelledby="manager-tab-${tab}">${shownGames.map(game=>group(game,items.filter(item=>item.gameId===game.id))).join('')||empty(query?'没有匹配的 Mod':tab==='pending'?'暂无待安装 Mod':'还没有托管 Mod',query?'试试其他名称，或清空搜索。':tab==='pending'?'下载完成的 Mod 会出现在这里。':'安装喜欢的 Mod 后，在这里统一管理。',query?'<button class="btn" data-manager-clear>清空搜索</button>':`<button class="btn" data-nav="${tab==='pending'?'tasks':'workshop'}">${tab==='pending'?'查看下载':'逛逛 Mod 工坊'}</button>`)}</div>
   ${runs.length?`<details class="manager-runs" data-help-key="manager-runs-${esc(gameId)}"><summary>${icon('clock')}运行记录 <span>${runs.length}</span>${icon('chevron')}</summary><div>${runs.slice(0,10).map(run=>`<h3>${esc(run.gameName)}</h3>${runCard(run)}`).join('')}</div></details>`:''}
   <footer class="manager-footer">${icon('shield')}停用或卸载会还原原始文件，保留存档与用户文件。</footer></section></div>`;
 }
 function dialog(title,body,footer) {
  return `<div class="modal-backdrop"><section class="modal manager-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button class="icon-button" data-close aria-label="关闭弹窗">${icon('close')}</button></div><div class="modal-body">${body}</div><div class="modal-foot">${footer}</div></section></div>`;
 }
 function detail(id) {
  const mod=mods().find(item=>item.id===id);
  if(!mod)return dialog('Mod 已移除','<p>此 Mod 已不在托管列表中。</p>','<button class="btn" data-close>关闭</button>');
  const warning=['changed','loader_with_errors'].includes(mod.verification?.status);
  return dialog(mod.name,`<div class="manager-detail-summary"><span class="manager-mod-icon">${icon('box')}</span><div><p>${esc(mod.gameName)}</p><span>${mod.status==='enabled'?'已启用':'已停用'} · ${mod.files.length} 个文件${mod.version?' · v'+esc(mod.version):''}</span></div></div><section class="manager-detail-section"><div class="manager-detail-heading"><h3>文件状态</h3><button class="btn small" data-mod-action="verify" data-managed-id="${esc(mod.id)}">${icon('shield')}校验文件</button></div><p class="${warning?'manager-warning':''}">${esc(mod.verification?.message||'尚未校验文件。可校验托管文件是否完整，游戏内效果需启动游戏确认。')}</p></section>${mod.update?`<section class="manager-detail-section"><h3>Mod 更新</h3>${updatePanel(mod)}</section>`:''}<details class="manager-detail-section" data-help-key="manager-files-${esc(mod.id)}"><summary>安装文件与备份</summary><div class="plan-files">${mod.files.map(file=>`<div><code>${esc(file.destination)}</code><span>${file.originalHash?'有原文件备份':'新增文件'}</span></div>`).join('')}</div>${ruleEvidence(mod)}</details>`,`<button class="btn danger" data-mod-action="uninstall" data-managed-id="${esc(mod.id)}">${icon('trash')}卸载 Mod</button><button class="btn" data-close>完成</button>`);
 }
 function settings(id) {
  const game=data().sourceGames.find(item=>item.id===id);
  if(!game)return dialog('游戏未找到','<p>请重新扫描游戏目录。</p>','<button class="btn" data-close>关闭</button>');
  const loadouts=(data().installations.loadouts||[]).filter(item=>item.gameId===id);
  return dialog(game.name,`<section class="manager-detail-section manager-config"><h3>Mod 配置档案</h3><p>保存当前启用的 Mod，一键切换不同玩法。</p><label for="loadout-name-${esc(id)}" class="visually-hidden">档案名称</label><div class="manager-save-config"><input id="loadout-name-${esc(id)}" maxlength="80" placeholder="档案名称，例如日常游玩"><button class="btn" data-save-loadout="${esc(id)}">保存当前配置</button></div>${loadouts.length?`<div class="file-list">${loadouts.map(item=>`<div class="file-row"><div><strong>${esc(item.name)}</strong><small>${item.mods.filter(mod=>mod.status==='enabled').length} 个启用 / ${item.mods.length} 个记录</small></div><div class="row-actions"><button class="btn small" data-switch-loadout="${esc(item.id)}" data-loadout-game="${esc(id)}">查看并切换</button><button class="icon-button" aria-label="删除档案 ${esc(item.name)}" data-delete-loadout="${esc(item.id)}" data-loadout-game="${esc(id)}">${icon('trash')}</button></div></div>`).join('')}</div>`:''}<details class="manager-config-help"><summary>配置切换说明</summary><p>保存 Mod 启用状态和默认安装规则。切换时，不在档案中的 Mod 会停用；插件加载顺序保持不变。</p></details></section><section class="manager-detail-section manager-maintenance"><div><h3>检查更新</h3><p>查看这款游戏已安装的 Nexus / GameBanana Mod 更新。</p></div><button class="btn small" data-check-updates="${esc(id)}">检查更新</button></section><section class="manager-detail-section manager-maintenance"><div><h3>恢复原生游戏</h3><p>移除托管 Mod 并还原原始文件，保留存档和用户文件。</p></div><button class="btn small danger" data-restore-game="${esc(id)}">恢复原生</button></section>`,'<button class="btn" data-close>完成</button>');
 }
 return {
  render:content,detail,settings,
  key:()=>[gameId,tab,query],
  click(dataset) {
   if(dataset.managerGame){gameId=dataset.managerGame;render();[...document.querySelectorAll('[data-manager-game]')].find(button=>button.dataset.managerGame===gameId)?.focus({preventScroll:true});return true;}
   if(dataset.managerTab){tab=dataset.managerTab==='pending'?'pending':'installed';render();document.getElementById('manager-tab-'+tab)?.focus({preventScroll:true});return true;}
   if('managerClear'in dataset){query='';render();document.getElementById('manager-search')?.focus();return true;}
   if(dataset.managedDetail){openModal({kind:'managed-detail',id:dataset.managedDetail});return true;}
   if(dataset.managerSettings){openModal({kind:'manager-settings',gameId:dataset.managerSettings});return true;}
   return false;
  },
  input(target){if(target.id==='manager-search'){query=target.value;render();}},
  keydown(event) {
   if(!event.target.matches('[data-manager-tab]')||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
   event.preventDefault();tab=event.key==='Home'?'installed':event.key==='End'?'pending':tab==='pending'?'installed':'pending';render();document.getElementById('manager-tab-'+tab)?.focus({preventScroll:true});
  },
  showInstalled(){gameId='all';tab='installed';query='';},
  reset(){gameId='all';tab='installed';query='';}
 };
}
