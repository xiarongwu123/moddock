import { gameUpdateNotice, checkingUpdates } from './game-update-notice.js';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import UserCenter from '../src/account/UserCenter.jsx';
import LibraryGameCards from '../src/components/LibraryGameCards.jsx';
import { createWorkshop } from './workshop.js';
import { createDetailTranslation, modTranslator } from './mod-translation.js';
import { createListTranslation } from './mod-list-translation.js';
import { createSourceAuth } from './source-auth.js';
import { createNexusVerification } from './nexus-verification.js';
import { renderGameLibrary, mountGameLibraryScroll } from './game-library.js';
import { createModStudio } from './mod-studio.js';
import { createStudioControls } from './studio-controls.js';
import { createModManager } from './mod-manager.js';
import { renderInstallationProgress } from './installation-progress.js';
import '../src/components/GameLibrary.css';
import { cancelDomMotion, dismissModal, enterPage, setModalContent } from '../src/motion/domMotion';
import { createStatePoller, hasActiveWork } from '../src/state-poller.cjs';
import { createFomodUI } from './fomod-ui.js';

const paths = {
 bookmark:'M6 3h12v19l-6-4-6 4Z',
 user:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4 22v-2a8 8 0 0 1 16 0v2',
 gamepad:'M6 8h12a4 4 0 0 1 4 4l-1 6a2 2 0 0 1-3 1l-3-3H9l-3 3a2 2 0 0 1-3-1l-1-6a4 4 0 0 1 4-4Z M7 10v5 M4.5 12.5h5 M16 11h.1 M19 14h.1',
 library:'M4 4h5v16H4z M12 4h3v16h-3z M18 5l3-1 4 15-3 1z', compass:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M16 8l-3 5-5 3 3-5Z', box:'M3 7l9-5 9 5v10l-9 5-9-5Z M3 7l9 5 9-5 M12 12v10', download:'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5', settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M9 3h6l1 3 3 1 2 5-2 3-3 1-1 5H9l-1-3-3-1-2-5 2-3 3-1Z', search:'M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Z M16 16l5 5', bell:'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5Z M10 21h4', chevron:'M9 5l7 7-7 7', arrow:'M5 12h14 M13 6l6 6-6 6', left:'M19 12H5 M11 6l-6 6 6 6', scan:'M4 8V4h4 M16 4h4v4 M20 16v4h-4 M8 20H4v-4 M8 12h8', grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z', shield:'M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6Z M8 12l3 3 5-6', sparkles:'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z M20 2v4 M18 4h4', sun:'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5L19 19 M5 19l1.5-1.5 M17.5 6.5L19 5', shirt:'M8 3l4 3 4-3 6 4-3 5-3-2v11H8V10l-3 2-3-5Z', check:'M5 12l4 4L19 6', close:'M6 6l12 12 M18 6L6 18', clock:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 6v6l4 2', restore:'M3 10a9 9 0 1 1 1 8 M3 4v6h6 M12 7v5l3 2', trash:'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7', info:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 11v6 M12 7h.01', folder:'M3 5h7l2 3h9v12H3Z', loader:'M21 12a9 9 0 1 1-9-9', play:'M8 4l13 8-13 8Z', file:'M5 2h9l5 5v15H5Z M14 2v6h5 M8 12h8 M8 16h8'
};
const icon = (name, cls='') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.box}"/></svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cover = id => `https://cdn.akamai.steamstatic.com/steam/apps/${encodeURIComponent(id)}/header.jpg`;
let data, view='library', selected=null, query='', scanning=false, modal=null, previousFocus, toastTimer;
let scanPathsBusy=false, scanError='';
const pendingModActions=new Map();
function renderPendingModActions(){
 for(const button of app.querySelectorAll('[data-mod-action]')){
  const action=pendingModActions.get(button.dataset.managedId);
  if(!action)continue;
  const row=button.closest('.managed-row, .library-mod-row');
  row?.setAttribute('aria-busy','true');
  for(const control of row?.querySelectorAll('button')||[])control.disabled=true;
  if(button.dataset.modAction!==action)continue;
  const label=action==='enable'?'正在启用…':action==='disable'?'正在停用…':'正在校验…';
  button.setAttribute('aria-busy','true');
  if(button.classList.contains('manager-switch')){
   button.setAttribute('aria-label',label);
   const status=row.querySelector('.manager-state');
   status.setAttribute('role','status');
   status.innerHTML=`${icon('loader','spinning')} ${label}`;
  }else button.innerHTML=`${icon('loader','spinning')}<span role="status">${label}</span>`;
 }
}
let lastNxm=null;
let onlineProvider='all', onlineQuery='', onlineDraft='', onlineResults={}, generation=0, requests={};
let gameTab='overview', gameLibraryQuery='', launchingGame=null;
let disposeGameLibraryScroll=()=>{};
let app,homeProfile,accountRoot,accountHost;
let gameCardsRoot,gameCardsHost;
function clearGameCards(){const root=gameCardsRoot;gameCardsRoot=null;gameCardsHost=null;if(root)queueMicrotask(()=>root.unmount());}
function renderGameCards(){
 const slot=app.querySelector('[data-library-cards]');
 if(!slot){clearGameCards();return;}
 if(gameCardsHost)slot.replaceWith(gameCardsHost);
 else{gameCardsHost=slot;gameCardsRoot=createRoot(slot);}
 gameCardsRoot.render(createElement(LibraryGameCards,{games:data.scan.games,query}));
}
let renderedPage=null,renderedLibraryKey=null,renderedDetailKey=null,renderedManagerKey=null;
const sourceAuth = createSourceAuth({ api, esc, icon, toast, data: () => data, refresh });
const nexusVerification = createNexusVerification({ api, toast });
const translation = createDetailTranslation({ modal: () => modal, renderModal });
const fomodUI=createFomodUI({api,openModal,renderModal,modal:()=>modal,esc,translator:modTranslator});
const listTranslation = createListTranslation({ translator: modTranslator, esc });
const studioControls = createStudioControls({ api, esc, icon, modal: () => modal, openModal, renderModal });
const workshop = createWorkshop({ api, esc, icon, size: n => size(n), cover, empty: (...args) => empty(...args), toast,
 data: () => data, modal: () => modal, openModal, closeModal, renderModal, refresh, planJob, translation, listTranslation,
 render: () => { if (view === 'workshop') render(); }
});
function closeAccount(restoreFocus=false){accountRoot?.unmount();accountRoot=null;accountHost?.remove();accountHost=null;if(restoreFocus){app?.querySelector('.account-menu summary')?.focus({preventScroll:true});statePoller?.update({immediate:true});}}
function openAccount(){
 if(accountRoot)return;
 const epoch=homeEpoch;
 accountHost=document.createElement('div');accountHost.dataset.accountCenter='';document.body.appendChild(accountHost);
 accountRoot=createRoot(accountHost);
 statePoller?.update();
 accountRoot.render(createElement(UserCenter,{
  initialAccount:homeProfile,
  onAccount:account=>{if(epoch===homeEpoch){homeProfile=account;const label=app?.querySelector('.account-identity');if(label)label.innerHTML=`${esc(account.name)}<small>${esc(account.email)}</small>`;}},
  onRequireLogin:(message,tone)=>{if(epoch===homeEpoch)window.dispatchEvent(new CustomEvent('moddock:auth-required',{detail:{message,tone}}));},
  onClose:()=>closeAccount(true),
 }));
}
function requestError(response,result,epoch=homeEpoch){const message=result.message||result.error||'请求失败';if(epoch===homeEpoch&&(response.status===401||result.code==='account_disabled')){window.dispatchEvent(new CustomEvent('moddock:auth-required',{detail:{message}}));}return new Error(message);}
async function api(route,body,options={}){const epoch=homeEpoch;const r=await fetch(`/api/${route}`,{...options,...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Moddock-Token':data.token},body:JSON.stringify(body)})});const result=await r.json();if(!r.ok)throw requestError(r,result,epoch);return result;}
export function createSourceConnectionClient() {
 const epoch = homeEpoch;
 const call = (route, body) => epoch === homeEpoch && app?.isConnected ? api(route, body) : Promise.reject(new Error('账号已切换，请重新打开连接设置'));
 return { read: () => call('state'), connect: (source, key) => call('sources/connection', { source, key }), start: () => call('nexus/sso/start', {}), cancel: id => call('nexus/sso/cancel', { id }) };
}
function toast(message){const el=document.getElementById('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4500);}
const size=n=>n==null?'大小未知':n<1024?`${n} B`:n<1024**2?`${(n/1024).toFixed(1)} KB`:n<1024**3?`${(n/1024**2).toFixed(1)} MB`:`${(n/1024**3).toFixed(2)} GB`;
const active=j=>['queued','running'].includes(j.status);
const currentGame=()=>data?.sourceGames?.find(g=>g.id===selected);
const studioGame=()=>currentGame()||(view==='studio'?data?.sourceGames?.find(g=>g.installPath):null);
const studio = createModStudio({ api, render, esc, icon, getGame: studioGame, getGames: () => data?.scan?.games || [], changeGame: async id => { selected=id;render(); }, getStatus: () => data?.studio, openPlan: plan => openModal({ kind: 'plan', plan }), openPreview: payload => openModal({ kind: 'studio-preview', payload, tab: 'overview', fileIndex: 0 }), openLibrary: async game => { selected=game.id;view='detail';gameTab='mods';await refresh();render();statePoller?.update(); }, refresh, toast });
const provider=id=>id==='studio'?{id,short:'本地创作',color:'#b9dc82'}:data.providers.find(p=>p.id===id);
const empty=(head,text,action='')=>`<div class="empty">${icon('gamepad')}<h3>${esc(head)}</h3>${text?`<p>${esc(text)}</p>`:''}${action}</div>`;
const modManager=createModManager({data:()=>data,esc,icon,cover,empty,render,openModal,runCard,ruleEvidence,updatePanel});
const help=(text,label='帮助')=>`<details class="context-help" data-help-key="${esc(view+':'+label)}"><summary aria-label="${esc(label)}">?</summary><div class="context-help-body"><p>${esc(text)}</p></div></details>`;
function pageHelp(){const text=({library:'登录后自动读取 Steam / Epic 安装记录。未找到游戏时，可在设置中添加游戏库目录。',tasks:'下载完成后一键安装，自动识别规则并备份原始文件；需要自定义时打开高级设置。',installed:'停用和卸载会还原备份。文件被外部修改时停止操作，保留修改；运行记录可检查 Mod 是否生效。',detail:'下载后核对安装方案中的前置、冲突和覆盖文件，再运行游戏检查效果。'})[view];return text?help(text,'页面帮助'):'';}
function render(){
 if(!app?.isConnected)return;
 if(accountRoot)return;
 const pageKey=view+':'+(selected||'');
 const pageChanged=pageKey!==renderedPage;
 const libraryKey=view==='library'?JSON.stringify([data.gameUpdates,[...checkingUpdates],data.scan,query,scanning,data.jobs.some(active),homeProfile?.name,homeProfile?.email]):null;
 // Unchanged polls must not detach a hovered or keyboard-focused card.
 if(!pageChanged&&libraryKey!==null&&libraryKey===renderedLibraryKey)return;
 renderedLibraryKey=libraryKey;
 const detailKey=view==='detail'?JSON.stringify([data.gameUpdates,[...checkingUpdates],data.scan.games,data.sourceGames,data.installations,data.jobs,data.providers,data.studio,studio.revision,onlineResults,onlineProvider,onlineQuery,onlineDraft,gameTab,gameLibraryQuery,launchingGame,[...pendingModActions],homeProfile?.name,homeProfile?.email]):null;
 if(!pageChanged&&detailKey!==null&&detailKey===renderedDetailKey)return;
 renderedDetailKey=detailKey;
 const managerKey=view==='installed'?JSON.stringify([data.gameUpdates,[...checkingUpdates],data.installations,data.jobs,data.sourceGames,modManager.key(),[...pendingModActions],homeProfile?.name,homeProfile?.email]):null;
 if(!pageChanged&&managerKey!==null&&managerKey===renderedManagerKey)return;
 renderedManagerKey=managerKey;
 const previousContent=app.querySelector('.content');
 const sidebarScroll=app.querySelector('[data-library-scroll]')?.scrollTop||0;
 const detailScroll=app.querySelector('[data-detail-scroll]')?.scrollTop||0;
 const previousChat=app.querySelector('[data-studio-scroll]');
 const chatScroll=previousChat?{id:previousChat.dataset.chatId,top:previousChat.scrollTop,bottom:previousChat.scrollHeight-previousChat.scrollTop-previousChat.clientHeight<70}:null;
 const f=document.activeElement, id=f?.id, caret=f?.selectionStart;
 const focusedGame=f?.closest('[data-game]')?.dataset.game;
 const headingFocused=f===app.querySelector('h1');
 const openHelp=new Set([...app.querySelectorAll('details[data-help-key][open]')].map(node=>node.dataset.helpKey));
 const accountMenuOpen=app.querySelector('.account-menu')?.open;
 const accountMenuFocus=f?.closest('.account-menu')?f.matches('summary')?'summary':f.dataset.nav?'[data-nav="account"]':'[data-auth-logout]':null;
 const helpFocus=f?.closest('details.context-help')?.dataset.helpKey;
 disposeGameLibraryScroll();
 app.innerHTML=`<div class="shell shell-topnav">
  <header class="app-header">
   <button class="brand home-brand" data-nav="library" aria-label="游匣首页"><span class="auth-brand" aria-hidden="true"><span class="auth-brand-symbol">${icon('gamepad')}</span><span class="auth-brand-name"><span class="auth-brand-word"><span class="auth-brand-fallback">游匣</span></span><small>MODDOCK</small></span></span></button>
   <nav class="primary-nav" aria-label="主导航">${[['library','我的游戏'],['workshop','MOD 工坊'],['studio','游匣 AI'],['tasks','下载管理'],['installed','Mod 管理']].map(([v,label])=>{const current=view===v||(v==='library'&&view==='detail');return `<button data-nav="${v}" class="${current?'active':''}" ${current?'aria-current="page"':''}><span>${label}</span>${v==='tasks'&&data.jobs.some(active)?'<span class="tiny-dot" aria-label="有进行中的下载"></span>':''}</button>`;}).join('')}</nav>
   <div class="header-actions">
    <button class="header-action ${view==='settings'?'active':''}" data-nav="settings" aria-label="设置" title="设置" ${view==='settings'?'aria-current="page"':''}>${icon('settings')}</button>
    <details class="account-menu" ${accountMenuOpen?'open':''}>
     <summary class="header-account profile-text" aria-label="账号菜单" title="${esc(homeProfile?.name||'MU 用户')}">${icon('user')}<span class="account-identity visually-hidden">${esc(homeProfile?.name||'MU 用户')}<small>${esc(homeProfile?.email)}</small></span></summary>
     <div class="account-menu-panel"><button data-nav="account" aria-label="打开个人中心">${icon('user')}个人中心</button><button class="logout-action" data-auth-logout aria-label="退出登录">${icon('left')}退出登录</button></div>
    </details>
   </div>
  </header>
  <main class="content ${view==='library'?'library-content':view==='detail'?'game-library-content':view==='studio'?'studio-content':view==='settings'?'settings-content':view==='installed'?'mod-manager-content':''}">${({library,detail,tasks,installed:modManager.render,settings,workshop:workshop.render,studio:()=>studio.render(studioGame())})[view]()}</main>
 </div>`;
 if(previousContent&&!pageChanged){const next=app.querySelector('.content');previousContent.className=next.className;previousContent.innerHTML=next.innerHTML;next.replaceWith(previousContent);}
 renderGameCards();
 renderPendingModActions();
 studio.mount(app);
 const sidebar=app.querySelector('[data-library-scroll]');if(sidebar)sidebar.scrollTop=sidebarScroll;
 const detailPane=app.querySelector('[data-detail-scroll]');if(detailPane)detailPane.scrollTop=pageChanged?0:detailScroll;
 const chatPane=app.querySelector('[data-studio-scroll]');if(chatPane)chatPane.scrollTop=chatPane.dataset.chatId==='new'?0:!chatScroll||chatScroll.id!==chatPane.dataset.chatId||chatScroll.bottom?chatPane.scrollHeight:chatScroll.top;
 disposeGameLibraryScroll=mountGameLibraryScroll(app);
 if(focusedGame){[...app.querySelectorAll('[data-game]')].find(node=>node.dataset.game===focusedGame)?.focus({preventScroll:true});}
 if(pageChanged){renderedPage=pageKey;enterPage(app);}
 app.querySelectorAll('details[data-help-key]').forEach(node=>{node.open=openHelp.has(node.dataset.helpKey);});
 if(accountMenuFocus)app.querySelector('.account-menu')?.querySelector(accountMenuFocus)?.focus({preventScroll:true});
 if(helpFocus){[...app.querySelectorAll('details[data-help-key]')].find(node=>node.dataset.helpKey===helpFocus)?.querySelector('summary').focus({preventScroll:true});}
 app.querySelectorAll('img:not(.holo-card img)').forEach(img=>img.addEventListener('error',()=>{if(img.dataset.fallbackSrc){img.src=img.dataset.fallbackSrc;delete img.dataset.fallbackSrc;return;}img.style.opacity=0;img.parentElement.classList.add('media-unavailable');}));
 if(['library-search','game-library-search','manager-search','online-search','workshop-game-search','workshop-mod-search','studio-idea'].includes(id)){const el=document.getElementById(id);if(el&&!el.disabled){el.focus({preventScroll:true});el.setSelectionRange(caret,caret);}}
 if(id?.startsWith('game-tab-'))document.getElementById(id)?.focus({preventScroll:true});
 if(id?.startsWith('manager-')&&id!=='manager-search')document.getElementById(id)?.focus({preventScroll:true});
 if(headingFocused){const heading=app.querySelector('h1');heading?.setAttribute('tabindex','-1');heading?.focus({preventScroll:true});}
}
function library(){
 const games=data.scan.games.filter(g=>!query||`${g.name} ${g.platform}`.toLowerCase().includes(query.toLowerCase()));
 const scanButton=()=>`<button class="btn primary" data-action="scan" ${scanning?'disabled':''}>${icon(scanning?'loader':'scan',scanning?'spinning':'')}${scanning?'扫描中…':'扫描本机游戏'}</button>`;
 return `<div class="library-toolbar">
  <div class="heading-title"><h1>我的游戏</h1><span class="library-count" aria-label="${data.scan.games.length} 款本机游戏">${data.scan.games.length}</span>${pageHelp()}</div>
  <div class="library-actions"><label class="searchbox">${icon('search')}<input id="library-search" value="${esc(query)}" placeholder="搜索游戏" aria-label="搜索本机游戏"></label><button class="btn" data-nav="settings">${icon('folder')}扫描目录</button>${scanButton()}</div>
 </div>
 ${games.length?'<div class="game-grid library-game-grid" data-library-cards></div>':`<section class="library-empty"><div class="library-empty-copy"><span class="library-empty-icon">${icon(query?'search':'gamepad')}</span><h2>${query?'没有匹配的游戏':scanning?'正在扫描本机游戏…':'还没有发现本机游戏'}</h2><p>${query?'试试其他游戏名称或平台关键词':scanning?'正在读取游戏安装记录，请稍候':'扫描本机游戏，或选择游戏所在目录'}</p>${query?'<button class="btn" data-action="clear-search">清空搜索</button>':`${scanButton()}<button class="library-directory-link" data-nav="settings">选择目录</button>`}</div></section>`}
 ${gameUpdateNotice(data,esc)}${data.scan.diagnostics.length?`<div class="notice">${icon('info')}${esc(data.scan.diagnostics.join('；'))}</div>`:''}`;
}
function detail(){
 return gameUpdateNotice(data,esc,selected)+renderGameLibrary({data,selected,tab:gameTab,query:gameLibraryQuery,launching:launchingGame,esc,icon,cover,explore:exploreMods,runCard,studio:()=>studio.render(currentGame())});
}
function exploreMods(){
 const g=currentGame();if(!g)return empty('游戏已不在扫描结果中','返回游戏库重新扫描。');
 const items=Object.values(onlineResults).flatMap(r=>r.items||[]).filter(m=>onlineProvider==='all'||m.source===onlineProvider);
 const labels={ready:'有可展示的 Mod',empty:'没有返回 Mod',loading:'查询中',error:'连接失败',unsupported:'不支持',unmapped:'需要匹配',needs_connection:'需要授权'};
 const ps=data.providers.filter(p=>onlineProvider==='all'||p.id===onlineProvider);
 const loading=ps.some(p=>onlineResults[p.id]?.status==='loading');
 const others=Object.values(onlineResults).flatMap(r=>r.items||[]).length;
 const emptyTitle=loading?'正在查找 Mod…':ps.some(p=>onlineResults[p.id]?.status==='error')?'资源查询失败':ps.some(p=>onlineResults[p.id]?.status==='unmapped')?'尚未匹配到游戏专区':onlineQuery?'没有匹配这个关键词的 Mod':'当前来源没有返回 Mod';
 const emptyText=onlineProvider!=='all'&&others?`其他来源已有 ${others} 项，可以切换到全部来源。`:loading?'各来源正在独立查询，返回的 Mod 会立即显示。':'请查看上方每个来源的具体结果。连接失败或未匹配不代表这个游戏没有 Mod。';
 return `<div class="heading-row"><div><div class="heading-title"><h2>探索 Mod</h2>${pageHelp()}</div></div><button class="btn small" data-mapping>${icon('settings')}来源匹配</button></div><div class="online-search-field">${icon('search')}<input id="online-search" value="${esc(onlineDraft)}" placeholder="输入 Mod 名或关键词，搜索当前游戏…" aria-label="搜索当前游戏 Mod"><button class="btn primary" data-online-search>搜索</button><button class="btn" data-online-refresh aria-label="刷新结果">${icon('restore')}</button></div><div class="toolbar source-tabs"><button class="filter-pill ${onlineProvider==='all'?'active':''}" data-provider="all">全部来源</button>${data.providers.map(p=>`<button class="filter-pill ${onlineProvider===p.id?'active':''}" data-provider="${p.id}">${p.short} <span class="source-count">${['ready','empty'].includes(onlineResults[p.id]?.status)?(onlineResults[p.id]?.total??onlineResults[p.id]?.items?.length??0):'—'}</span></button>`).join('')}<span class="right">已显示 ${items.length} 项</span></div><div class="source-messages">${ps.map(p=>{const r=onlineResults[p.id];return `<div class="source-message"><span><b>${esc(p.short)}</b>${esc(labels[r?.status]||'准备查询')} · ${esc(r?.message||'正在读取游戏专区…')}${r?.matchedGame?.name?' · 专区：'+esc(r.matchedGame.name):''}${r?.code?' · '+esc(r.code):''}</span><div>${['error','needs_connection'].includes(r?.status)?`<button class="text-link" data-retry-source="${p.id}">重试</button><button class="text-link" data-nav="settings">连接设置</button>`:''}${r?.status==='unmapped'?'<button class="text-link" data-mapping>匹配专区</button>':''}${r&&r.status!=='loading'?`<button class="text-link" data-diagnostic="${p.id}">复制诊断</button>`:''}</div></div>${r?.candidates?.length?`<div class="match-candidates"><span>可能的 ${p.short} 专区：</span>${r.candidates.map(c=>`<button class="btn small" data-bind-source="${p.id}" data-bind-id="${esc(c.id)}">${esc(c.name)}</button>`).join('')}</div>`:''}`}).join('')}</div>${items.length?`<div class="mod-grid online-grid">${items.map(modCard).join('')}</div>`:empty(emptyTitle,emptyText,onlineProvider!=='all'&&others?'<button class="btn" data-provider="all">查看全部来源</button>':'')}<div class="source-pagination">${ps.filter(p=>onlineResults[p.id]?.hasNext).map(p=>`<button class="btn" data-more="${p.id}">加载更多 ${p.short} · 第 ${(onlineResults[p.id]?.page||1)+1} 页 ${icon('chevron')}</button>`).join('')}</div>`;
}
function modCard(m){const p=provider(m.source);return `<article class="mod-card online-card" data-source="${esc(m.source)}"><button class="online-art" data-mod="${esc(m.id)}" aria-label="查看 ${esc(m.name)}" style="--source-color:${p.color}">${icon('box')}${m.image?`<img src="${esc(m.image)}" alt="" loading="lazy">`:''}<span class="online-source-tag">${p.short}</span></button><div class="mod-copy">${listTranslation.title(m,'online',m.id)}<div class="online-author">by ${esc(m.author||'社区作者')}</div>${listTranslation.summary(m)}<div class="mod-meta"><span>${icon('download')}${m.metric==null?'':new Intl.NumberFormat('zh-CN',{notation:'compact'}).format(m.metric)+' '+m.metricLabel}</span>${m.version?`<span>v${esc(m.version)}</span>`:''}</div><div class="mod-actions"><button class="text-link" data-mod="${esc(m.id)}">查看详情</button><button class="btn primary small" data-mod="${esc(m.id)}">${icon('download')}选择文件 / 下载</button></div></div></article>`;}
const ruleNames={copy:'目录映射 / 原文件替换',smapi:'SMAPI 清单包',archive:'纯 archive 包',pak:'Unreal pak / utoc / ucas',bepinex:'BepInEx 插件目录',bethesda:'Bethesda · Data 插件资源包'};
function ruleEvidence(mod){const r=mod.installationRule;return r?`<details data-help-key="rule-evidence-${esc(mod.id)}"><summary>安装依据：${esc(r.name)}</summary><p>${r.origin==='pi-agent'?'pi agent 已分析作者说明并通过本地方案校验':r.origin==='local-files'?'已核对本机唯一原文件与包内相对目录':r.origin==='author'?'根据作者安装说明自动分析':`规则核对日期 ${esc(r.reviewedAt)}`} · 目标目录 ${esc(mod.profile.fileMappings?`逐文件映射（${mod.profile.fileMappings.length} 个文件）`:mod.profile.destination||'游戏目录')}</p>${(r.instructions||[]).map(item=>`<p>作者原文（${esc(({fileDescription:'所选文件说明',readmeInstructions:'包内 README',description:'模组介绍'})[item.source]||item.source)}）：${esc(item.excerpt)}</p>`).join('')}${(r.notes||[]).map(note=>`<p>${esc(note)}</p>`).join('')}${r.sources.map(url=>`<p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a></p>`).join('')}</details>`:'';}
function runCard(r){return `<div class="source-message"><span><b>本次运行</b>${esc(r.message)}<small> · ${new Date(r.started).toLocaleString('zh-CN')}${r.pid?' · PID '+r.pid:''}</small></span><button class="btn small" data-check-run="${esc(r.id)}">检查本次运行</button></div>`;}
function updatePanel(m){if(!m.update)return '';const u=m.update;return `<p>${esc(u.message)}${u.currentVersion?' · 当前 v'+esc(u.currentVersion):''}</p>${u.files?.length?`<div class="file-list">${u.files.map(f=>`<div class="file-row"><div><strong>${esc(f.label||f.name)}</strong><small>v${esc(f.version||'未知')} · ${esc(f.category||'')} · ${size(f.size)}${f.updated?' · '+esc(new Date(f.updated).toLocaleString('zh-CN')):''}</small></div><button class="btn small" ${f.available===false?'disabled':''} data-download-update="${m.id}" data-update-file="${esc(f.id)}">${u.status==='review'?'下载候选文件':'下载此更新'}</button></div>`).join('')}</div><p>更新下载会进入待安装库。安装前先卸载旧版并保留备份，再核对新版本方案和依赖。</p>`:''}`;}

async function openRule(gameId,jobId){if(gameId.startsWith('catalog:')&&jobId){await workshop.handleClick({workshopJob:jobId});return;}if(modal?.kind==='plan'){await api('installations/discard',{id:modal.plan.id});closeModal();}const g=data.sourceGames.find(g=>g.id===gameId);if(!g)throw new Error('请重新扫描该游戏');const suggestions=data.jobs.find(j=>j.id===jobId)?.import?.suggestions||[];const p=data.installations.profiles.find(p=>p.gameId===gameId)?.rule||suggestions[0]||{mode:'copy',root:'',sourcePrefix:'',destination:'',executable:'',requires:[],log:'',marker:''};openModal({kind:'rule',gameId,jobId,game:g,rule:p,suggestions,loading:!!jobId});if(jobId){const current=modal;try{const files=await api('installations/inspect',{gameId,jobId});if(modal===current)modal.files=files;}catch(e){if(modal===current)modal.error=e.message;}if(modal===current){modal.loading=false;renderModal();}}}
async function previewJob(jobId){const job=data.jobs.find(j=>j.id===jobId);if(!job)throw new Error('下载任务不存在');if(job.gameId.startsWith('catalog:')){await workshop.handleClick({workshopJob:jobId});return;}toast('正在生成高级安装预览…');const plan=await api('installations/plan',{gameId:job.gameId,jobId});openModal({kind:'plan',plan});}
let installBusy=false;
function syncInstallationProgress(){
 const task=data?.installations?.progress;if(!task)return;
 if(modal?.kind==='install-progress'&&modal.task.id===task.id){if(modal.task.status!=='running'&&task.status==='running'||JSON.stringify(modal.task)===JSON.stringify(task))return;modal.task=task;renderModal();}
 else if(modal?.kind==='play'&&modal.installation?.id===task.id){if(modal.installation.status!=='running'&&task.status==='running'||JSON.stringify(modal.installation)===JSON.stringify(task))return;modal.installation=task;renderModal();}
 else if(task.status==='running'&&!installBusy&&!launchingGame&&modal?.kind!=='fomod')openModal({kind:'install-progress',task});
}
async function installWithProgress(jobId,current){
 const job=data.jobs.find(job=>job.id===jobId),epoch=homeEpoch;
 const task={id:crypto.randomUUID(),jobId,gameId:job.gameId,name:job.name,status:'running',phase:'environment',percent:0,message:'正在连接安装服务…'};
 if(current.kind==='play')current.installation=task;else current.task=task;
 renderModal();statePoller?.update({immediate:true});
 try{
  const result=await api('installations/auto',{jobId,operationId:task.id});
  if(result.kind==='fomod'){if(epoch===homeEpoch){fomodUI.show(result);await refresh(epoch).catch(()=>{});}return result;}
  if(epoch===homeEpoch){const latest=current.kind==='play'?current.installation:current.task;Object.assign(latest,{status:'completed',phase:'completed',percent:100,message:'MOD 安装完成，文件已校验，原始文件已备份。',file:'',total:0});if(modal===current)renderModal();}
  return result;
 }catch(error){
  if(epoch===homeEpoch){await refresh(epoch).catch(()=>{});const latest=current.kind==='play'?current.installation:current.task;if(data.installations.progress?.id===task.id&&data.installations.progress.status==='completed')return;if(data.installations.progress?.id!==task.id||data.installations.progress.status!=='running'){Object.assign(latest,{status:'failed',phase:'failed',message:error.message});if(modal===current)renderModal();}}
  throw error;
 }
}
async function planJob(jobId){
 if(installBusy||data.installations.progress?.status==='running')return;
 const job=data.jobs.find(j=>j.id===jobId);if(!job)throw new Error('下载任务不存在');
 const epoch=homeEpoch;installBusy=true;const current={kind:'install-progress',task:{name:job.name,status:'running'}};openModal(current);
 try{const result=await installWithProgress(jobId,current);if(result?.kind==='fomod')return;if(epoch===homeEpoch){modManager.showInstalled();await refresh(epoch).catch(()=>{});}}
 catch{ /* The progress panel retains the failure or the running server task. */ }
 finally{installBusy=false;statePoller?.update();}
}
async function restoreNative(gameId){
 if(installBusy)return;
 const game=data.sourceGames.find(g=>g.id===gameId),epoch=homeEpoch;if(!game)return;
 installBusy=true;toast('正在还原原始文件，保留存档和用户文件…');
 try{const result=await api('installations/restore',{gameId});if(epoch!==homeEpoch)return;await refresh(epoch);openModal({kind:'restore-result',game,result});}
 finally{installBusy=false;}
}
function renderInstallModal(){let heading,body,actions='';const field=(id,label,value,hint='')=>`<label for="rule-${id}">${label}<input id="rule-${id}" value="${esc(value||'')}" placeholder="${esc(hint)}"></label>`;
 if(modal.kind==='fomod'){
  ({heading,body,actions}=fomodUI.content(modal));
 }else if(modal.kind==='auto-error'){
  heading='MOD 暂未安装';body=`<p>${esc(modal.error)}</p>`;
  actions=modal.gameId.startsWith('catalog:')?`<button class="btn" data-workshop-job="${esc(modal.jobId)}">选择本机游戏</button>`:`<button class="btn" data-install-job="${esc(modal.jobId)}">重新读取说明并安装</button>`;
 }else if(modal.kind==='restore-result'){
  const r=modal.result;heading='已恢复原生游戏';body=`<p>${esc(modal.game.name)} · 已移除 ${r.removed} 个托管 MOD，并还原原始文件。</p><p>存档、截图及未托管文件保留在原处。</p>${r.preserved?`<p>另外保存了 ${r.preserved} 个修改过的托管文件：</p><div class="path-box">${esc(r.recoveryPath)}</div>`:''}`;
 }else if(modal.kind==='launch'){
  const p=modal.rule;
  setModalContent(document.getElementById('modal-root'),`<div class="modal-backdrop"><section class="modal library-launch-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">设置启动入口</h2><button class="icon-button" data-close aria-label="关闭弹窗">${icon('close')}</button></div><div class="modal-body"><p class="library-launch-game">${esc(modal.game.name)}</p><div class="path-box">${esc(modal.game.installPath)}</div><label for="launch-executable">游戏或加载器启动入口<input id="launch-executable" value="${esc(p.executable||'')}" placeholder="例如 bin/x64/Game.exe" aria-describedby="launch-path-help"></label><p id="launch-path-help" class="modal-small">填写相对于游戏目录的可执行文件路径。</p><details class="library-launch-advanced"><summary>高级启动选项</summary><label for="launch-root">游戏内容子目录<input id="launch-root" value="${esc(p.root||'')}" placeholder="通常留空"></label><label for="launch-arguments">启动参数（每行一个）<textarea id="launch-arguments">${esc((p.arguments||[]).join('\n'))}</textarea></label></details></div><div class="modal-foot"><button class="btn" data-close>取消</button><button class="btn primary" data-save-launch>${modal.startAfterSave?'保存并继续':'保存设置'}</button></div></section></div>`);
  return;
 }else if(modal.kind==='rule'){const p=modal.rule;heading=modal.game.name+' · 高级安装设置';body=`<p>按作者安装说明保存这款游戏的规则。目录均相对于扫描到的游戏目录；留空表示根目录。每项安装保存自己的规则快照，可以为不同类型的包调整默认规则。</p><div class="path-box">${esc(modal.game.installPath)}</div>${modal.planError?`<div class="notice failed">${esc(modal.planError)}</div>`:''}<label>安装模板<select id="rule-template"><option value="">选择模板（核对作者说明后使用）</option>${(data.recipes||[]).map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></label>${modal.suggestions?.length?`<p>包内文件推荐：${modal.suggestions.map(r=>esc(r.name)).join('、')}</p>`:''}<label for="rule-mode">安装格式<select id="rule-mode">${Object.entries(ruleNames).map(([k,v])=>`<option value="${k}" ${p.mode===k?'selected':''}>${v}</option>`).join('')}</select></label>${field('root','游戏内容根目录',p.root,'通常留空；Mac 星露谷可为 Contents/MacOS')}${field('prefix','只安装压缩包中的这个目录',p.sourcePrefix,'留空安装完整包，例如 MyMod/BepInEx/plugins')}${field('destination','目标目录',p.destination,'按作者说明，例如 Mods、BepInEx/plugins 或 Content/Paks/~mods')}<p>目录映射保留包内目录结构；SMAPI 根据 UniqueID 建子目录；archive/pak 格式按文件名部署。外层多余目录请在“只安装…”中填写。</p><label for="rule-requires">必须先存在的前置文件（每行一个）<textarea id="rule-requires" placeholder="相对游戏内容根目录，例如 BepInEx/core/BepInEx.dll">${esc((p.requires||[]).join('\n'))}</textarea></label>${field('executable','游戏或加载器启动入口',p.executable,'相对游戏内容根目录，例如 bin/x64/Game.exe')}<label for="rule-arguments">启动参数（每行一个，可留空）<textarea id="rule-arguments" placeholder="每行一个独立参数，按作者说明填写">${esc((p.arguments||[]).join('\n'))}</textarea></label><h3>可选的日志验证</h3>${field('log','加载器日志路径',p.log,'相对游戏内容根目录，例如 BepInEx/LogOutput.log')}${field('marker','日志中的加载成功标记',p.marker,'必须使用加载器实际输出的标记；不用正则')}<p>只读取本次运行新增或重写的日志。没有标记时，显示进程状态并要求游戏内确认。日志标记仅确认对应加载事件。</p>${modal.jobId?`<h3>下载包里的实际文件</h3>${modal.loading?'<p>正在安全解包检查…</p>':modal.error?`<p class="notice">${esc(modal.error)}</p>`:`<div class="plan-files">${(modal.files||[]).map(f=>`<div><code>${esc(f.path)}</code><span>${size(f.size)}</span></div>`).join('')}</div>`}`:''}`;actions='<button class="btn primary" data-save-rule>保存规则'+(modal.jobId?'并生成方案':'')+'</button>';
 }else if(modal.kind==='plan'){const p=modal.plan,overwrites=p.files.filter(f=>f.overwrite);heading='安装方案 · '+p.name;body=`<p>${esc(p.gameName)} · ${esc(ruleNames[p.profile.mode])} · ${p.files.length} 个文件</p><div class="path-box">${esc(p.root)}</div>${p.units.length?`<p>${p.units.map(u=>esc(u.name)+' / '+esc(u.id)+' / '+esc(u.version)).join('<br>')}</p>`:''}${p.warnings.map(w=>`<div class="notice">${icon('info')}${esc(w)}</div>`).join('')}<h3>将写入的文件</h3><div class="plan-files">${p.files.map(f=>`<div><code>${esc(f.source)} → ${esc(f.destination)}</code><span class="${f.overwrite?'overwrite':''}">${f.overwrite?'备份后替换':'新文件'}</span></div>`).join('')}</div><p>方案 15 分钟后过期。执行前再次检查路径、前置、冲突和校验值；失败自动回滚。</p><label class="check-label"><input id="plan-author" type="checkbox">我已核对作者说明，此包的游戏版本、前置及目标目录正确</label>${overwrites.length?`<label class="check-label"><input id="plan-overwrite" type="checkbox">确认备份并替换上方 ${overwrites.length} 个已有文件；停用或卸载时还原</label>`:''}`;actions=`<button class="btn" data-rule-game="${esc(p.gameId)}" data-rule-job="${p.jobId}">修改规则</button><button class="btn primary" data-apply-plan>安装 ${p.files.length} 个文件</button>`;
 }else{const m=modal.record;heading='卸载 · '+m.name;body=`<p>卸载 ${esc(m.gameName)} 的 ${m.files.length} 个托管文件。已有原文件备份会还原；外部修改会阻止操作。</p><div class="plan-files">${m.files.map(f=>`<div><code>${esc(f.destination)}</code><span>${f.originalHash?'还原原文件':'移除托管文件'}</span></div>`).join('')}</div><p>未托管文件（包括游戏或 Mod 后续生成的文件）会保留。</p>`;actions='<button class="btn danger" data-confirm-uninstall>确认卸载并还原</button>';}
 setModalContent(document.getElementById('modal-root'),`<div class="modal-backdrop"><section class="modal install-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">${esc(heading)}</h2><button class="icon-button" data-close aria-label="关闭弹窗">${icon('close')}</button></div><div class="modal-body">${body}</div><div class="modal-foot"><button class="btn" data-close>关闭</button>${actions}</div></section></div>`);
}
function tasks(){const labels={queued:'排队中',running:'下载中',completed:'已下载',failed:'失败',cancelled:'已取消',authorization_required:'获取文件授权'};return `<div class="heading-row"><div><div class="heading-title"><h1>下载管理</h1>${pageHelp()}</div></div><span class="status">${data.jobs.filter(active).length} 个进行中</span></div>${data.jobs.length?`<div class="list">${data.jobs.map(j=>`<div class="installed-row download-row"><div class="mod-icon">${icon(active(j)?'loader':j.status==='completed'?'check':'info',active(j)?'spinning':'')}</div><div class="row-copy"><h3>${esc(j.name)}</h3><p>${esc(j.gameName)} · ${esc(provider(j.source)?.short)} · ${size(j.bytes)} / ${size(j.total)}</p><p>${esc(j.message)}</p>${j.import?`<p>${esc(j.import.message)}</p>`:''}${active(j)?`<div class="progress"><div style="width:${j.progress||0}%"></div></div>`:''}${j.path?`<div class="download-file-path">${esc(j.path)}</div>`:''}</div><span class="status ${j.status==='failed'?'failed':''}">${j.verificationRequired?'等待验证':labels[j.status]}</span><div class="row-actions">${j.verificationRequired?`<button class="btn primary small" data-verify-download="${j.id}">完成验证</button>`:''}${j.status==='authorization_required'?`<button class="btn primary small" data-authorize-job="${j.id}">重试文件授权</button><button class="btn small" data-cancel="${j.id}">取消</button>${!data.nexusAuthorizationWindow?'<button class="btn small" data-nav="settings">接收 NXM 链接</button>':''}`:active(j)?`<button class="btn small" data-cancel="${j.id}">取消</button>`:['failed','cancelled'].includes(j.status)?`<button class="btn small" data-retry-download="${j.id}">重新下载</button>`:`<button class="btn primary small" data-install-job="${j.id}" ${data.installations.mods.some(m=>m.jobId===j.id)?'disabled':''}>${data.installations.mods.some(m=>m.jobId===j.id)?'已安装':'一键安装'}</button><details class="install-advanced" data-help-key="advanced-${j.id}"><summary>高级设置</summary><button class="btn small" data-import-job="${j.id}">${j.import?.status==='ready'?'重新检查包':'导入待安装库'}</button><button class="btn small" data-rule-game="${esc(j.gameId)}" data-rule-job="${j.id}">手动安装规则</button><button class="btn small" data-reveal="${j.id}">打开位置</button><button class="btn small" data-save-file="${j.id}">另存文件</button></details>`}</div></div>`).join('')}</div>`:empty('还没有下载任务','',`<button class="btn primary" data-nav="library">查看我的游戏</button>`)}`;}
function scanSettings(){
 const result=data.scan, games=result.games, busy=scanning||scanPathsBusy, selecting=scanPathsBusy==='select';
 const key=value=>{const normalized=value.replace(/\\/g,'/').replace(/\/$/,'');return result.platform==='win32'?normalized.toLowerCase():normalized;};
 const locations=(result.locations||(result.roots||[]).map(path=>({path,gameCount:0}))).map(item=>({...item,available:true,manual:data.scanPaths.some(value=>key(value)===key(item.path))}));
 for(const directory of data.scanPaths)if(!locations.some(item=>key(item.path)===key(directory)))locations.push({path:directory,gameCount:0,available:false,manual:true});
 const scanned=result.scannedAt?new Date(result.scannedAt):null;
 const platforms=['Steam',...(result.platform==='win32'||games.some(game=>game.platform==='Epic')?['Epic']:[])];
 return `<section class="settings-panel scan-settings" aria-labelledby="scan-settings-title">
  <div class="scan-settings-heading"><div class="scan-settings-title"><span class="scan-settings-icon">${icon('scan')}</span><div><h2 id="scan-settings-title" tabindex="-1">游戏扫描</h2><p>从启动器自动发现已安装的游戏</p></div></div><div class="scan-settings-actions"><button class="btn" data-action="scan" ${busy?'disabled':''}>${icon(scanning?'loader':'scan',scanning?'spinning':'')}${scanning?'扫描中…':'重新扫描'}</button><button class="btn primary" data-add-scan-path ${busy||!data.canChooseScanDirectory?'disabled':''} ${!data.canChooseScanDirectory?'title="请在桌面端选择文件夹"':''}>${icon('folder')}${selecting?'正在选择…':'添加游戏库'}</button></div></div>
  <div class="scan-summary"><div class="scan-summary-count" role="status">${scanning?'正在查找游戏…':selecting?'请在系统窗口中选择文件夹':scanPathsBusy?'正在移除扫描位置…':`已发现 <strong>${games.length}</strong> 款游戏`}</div><div class="scan-platforms">${platforms.map(platform=>`<span>${platform}<b>${games.filter(game=>game.platform===platform).length}</b></span>`).join('')}</div><span class="scan-last-run" ${scanned?`title="${esc(scanned.toLocaleString('zh-CN'))}"`:''}>${scanned?`最近扫描 ${scanned.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}`:'尚未扫描'}</span></div>
  ${scanError?`<div class="scan-feedback is-error" role="alert">${esc(scanError)}</div>`:''}
  ${!games.length&&!busy&&!scanError?'<p class="scan-empty-hint">没有找到游戏？选择 Steam 游戏库或其中的游戏文件夹，会自动识别所属游戏库。</p>':''}
  ${!data.canChooseScanDirectory?'<p class="scan-empty-hint">添加游戏库需在桌面端使用系统文件夹选择器。</p>':''}
  ${locations.length?`<details class="scan-locations" data-help-key="scan-locations"><summary>扫描位置<span>${locations.length}</span>${icon('chevron')}</summary><div class="scan-location-list">${locations.map(location=>`<div class="scan-location"><span class="scan-location-icon">${icon('folder')}</span><div class="scan-location-copy"><strong>${esc(location.path.split(/[\\/]/).filter(Boolean).at(-1)||location.path)}</strong><span title="${esc(location.path)}">${esc(location.path)}</span></div><span class="scan-location-status ${location.available?'':'is-unavailable'}">${location.available?`${location.manual?'手动添加':'自动发现'} · ${location.gameCount} 款`: '暂不可用'}</span>${location.manual?`<button class="icon-button" data-remove-scan-path="${esc(location.path)}" aria-label="移除额外扫描位置 ${esc(location.path)}" title="仅移除额外扫描位置，不删除游戏文件" ${busy?'disabled':''}>${icon('close')}</button>`:''}</div>`).join('')}</div></details>`:''}
  ${result.diagnostics?.length?`<details class="scan-diagnostics" data-help-key="scan-diagnostics"><summary>${result.diagnostics.length} 个扫描提示</summary>${result.diagnostics.map(message=>`<p>${esc(message)}</p>`).join('')}</details>`:''}
 </section>`;
}
function settings(){return `<div class="heading-row"><div><h1>设置</h1></div></div>
 ${sourceAuth.render()}
 ${scanSettings()}
 ${data.connections.nexusManaged?'':`<div class="settings-panel"><h2>Nexus 文件授权回传</h2>${help((data.nexusAuthorizationWindow?'支持软件内授权窗口。':'网页预览可粘贴已取得的 NXM 链接。')+(data.nxmProtocol?' NXM 协议已注册。':' NXM 协议未注册。')+' 链接被其他管理器接收时，可在这里粘贴 Mod Manager Download 产生的链接。临时链接仅在内存使用。','NXM 链接帮助')}<label>目标本机游戏<select id="nxm-game"><option value="">按 Nexus 专区自动匹配</option>${data.sourceGames.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}</select></label><label>NXM 文件链接<input id="nxm-url" type="password" autocomplete="off" placeholder="nxm://游戏专区/mods/编号/files/编号?key=…&amp;expires=…"></label><button class="btn primary" data-receive-nxm>接收授权并下载</button>${data.nxmStatus?`<p>${esc(data.nxmStatus.message)}</p>`:''}</div>`}
 <div class="settings-panel"><h2>下载完成自动导入</h2><label class="check-label"><input id="auto-import" type="checkbox" ${data.autoImport?'checked':''}>下载校验后自动检查包内文件，加入待安装 Mod 库</label>${help('自动导入只检查 MOD 文件；点击一键安装后自动匹配规则并备份原始文件。RAR、7z 和可执行安装器暂不支持。','自动导入帮助')}</div>
 <div class="settings-panel"><h2>文件保存位置</h2><div class="path-box">${esc(data.downloadPath)}</div>${help('每个下载任务使用独立目录。完成后可在下载管理中打开位置或另存文件。下载会校验文件大小，并记录 SHA-256；来源提供 MD5 时同时比对。','保存位置帮助')}</div>`;}
async function refresh(epoch=homeEpoch){const next=await api('state');if(epoch!==homeEpoch)return false;data=next;render();syncInstallationProgress();if(['managed-detail','manager-settings'].includes(modal?.kind))renderModal();notifyNxm();sourceAuth.update();nexusVerification.update(data.jobs);statePoller?.update();return true;}
function notifyNxm(){if(data.nxmStatus&&lastNxm!==data.nxmStatus.id){lastNxm=data.nxmStatus.id;toast(data.nxmStatus.message);}}
async function runScan(message=''){
 if(scanning||!app?.isConnected)return;
 const epoch=homeEpoch;scanning=true;scanError='';statePoller?.update();render();
 try{
  await api('scan',{});
  if(epoch!==homeEpoch)return;
  if(await refresh(epoch))toast(`${message||'扫描完成'}，发现 ${data.scan.games.length} 款游戏`);
 }catch(e){if(epoch===homeEpoch){scanError=e.message;toast(e.message);}}
 finally{if(epoch===homeEpoch){scanning=false;render();statePoller?.update();}}
}
async function changeScanPath(directory){
 if(scanPathsBusy||scanning||!app?.isConnected)return;
 const epoch=homeEpoch;scanPathsBusy=directory?'remove':'select';scanError='';render();
 try{
  const result=await api(directory?'paths/remove':'paths/select',directory?{path:directory}:{});
  if(epoch!==homeEpoch||result.cancelled)return;
  if(await refresh(epoch))await runScan(directory?'已移除额外扫描位置':result.added?'已添加游戏库':'游戏库已在扫描范围内');
 }catch(error){if(epoch===homeEpoch){scanError=error.message;toast(error.message);}}
 finally{if(epoch===homeEpoch){scanPathsBusy=false;render();app?.querySelector('[data-add-scan-path]')?.focus({preventScroll:true});}}
}
async function openGame(id){if(view==='detail'&&selected===id)return;generation++;selected=id;view='detail';gameTab='overview';onlineProvider='all';onlineQuery='';onlineDraft='';onlineResults={};render();statePoller?.update();}
async function selectGameTab(tab){if(!['overview','mods','explore','studio','settings'].includes(tab))return;if(tab!==gameTab){const pane=app.querySelector('[data-detail-scroll]');if(pane)pane.scrollTop=0;}gameTab=tab;render();statePoller?.update();if(tab==='studio')await studio.enter();if(tab==='explore'&&!Object.keys(onlineResults).length)await loadSources();}
function openLaunchSettings(gameId,startAfterSave=false){
 const game=data.sourceGames.find(g=>g.id===gameId);if(!game)throw new Error('请重新扫描该游戏');
 const rule=data.installations.profiles.find(p=>p.gameId===gameId)?.rule||{mode:'copy',root:'',sourcePrefix:'',destination:'',requires:[],log:'',marker:''};
 openModal({kind:'launch',gameId,game,rule,startAfterSave});document.getElementById('launch-executable')?.focus();
}
function launchItems(gameId){
 const mods=data.installations.mods.filter(m=>m.gameId===gameId);
 return [...mods.map(mod=>({key:mod.jobId||mod.id,name:mod.name,version:mod.version,mod})),...data.jobs.filter(job=>job.gameId===gameId&&job.status==='completed'&&!mods.some(mod=>mod.jobId===job.id)).map(job=>({key:job.id,name:job.name,version:job.version,job}))];
}
async function playGame(gameId){
 if(launchingGame)return;
 const game=data.sourceGames.find(g=>g.id===gameId);if(!game)throw new Error('请重新扫描该游戏');
 const items=launchItems(gameId);
 openModal({kind:'play',gameId,game,items,selection:new Set(items.filter(item=>item.mod?.status==='enabled').map(item=>item.key))});
}
function renderPlayModal(){
 const current=modal,{game,items,selection,busy,error}=current;
 setModalContent(document.getElementById('modal-root'),`<div class="modal-backdrop"><section class="modal library-play-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-busy="${!!busy}"><div class="modal-head"><h2 id="modal-title">启动前 · MOD 管理</h2><button class="icon-button" data-close aria-label="关闭弹窗" ${busy?'disabled':''}>${icon('close')}</button></div><div class="modal-body"><div class="library-play-heading"><span class="library-play-icon">${icon('gamepad')}</span><div><h3>${esc(game.name)}</h3><p>勾选要使用的 MOD，确认后启动游戏。</p></div></div>${error?`<div class="notice failed" role="alert">${esc(error)}</div>`:''}${items.length?`<div class="library-play-toolbar"><span id="launch-mod-count" role="status">已选 ${selection.size} / ${items.length}</span><div><button class="text-link" data-select-launch-mods="all" ${busy?'disabled':''}>全选</button><button class="text-link" data-select-launch-mods="none" ${busy?'disabled':''}>全部取消</button></div></div><div class="library-play-mods" role="group" aria-label="本次启动的 MOD">${items.map((item,index)=>`<label class="library-play-mod" for="launch-mod-${index}"><input id="launch-mod-${index}" type="checkbox" data-launch-mod="${esc(item.key)}" ${selection.has(item.key)?'checked':''} ${busy?'disabled':''}><span class="library-mod-icon">${icon('box')}</span><span class="library-play-mod-copy"><strong>${esc(item.name)}</strong><small>${item.version?'v'+esc(item.version)+' · ':''}${item.mod?(item.mod.status==='enabled'?'已启用':'已停用'):'已下载 · 启动时安装'}</small></span></label>`).join('')}</div><p class="modal-small">未勾选的已安装 MOD 将停用；选中的待安装 MOD 会先自动安装。此次选择会保留到下次启动。</p>`:'<div class="library-play-empty">'+icon('box')+'<p>当前游戏没有已下载的 MOD，可以直接启动。</p></div>'}${busy?`<p class="library-play-progress" role="status">${icon('loader','spinning')}${esc(current.progress||'正在应用 MOD 选择…')}</p>`:''}</div><div class="modal-foot"><button class="btn" data-close ${busy?'disabled':''}>取消</button><button class="btn" data-play-settings ${busy?'disabled':''}>启动设置</button><button class="btn primary" data-confirm-play ${busy?'disabled':''}>${icon(busy?'loader':'play',busy?'spinning':'')}${busy?'正在启动…':'启动游戏'}</button></div></section></div>`);
}
async function confirmPlay(){
 const current=modal;if(current?.kind!=='play'||current.busy)return;
 const epoch=homeEpoch;current.busy=true;current.error='';launchingGame=current.gameId;render();renderModal();
 try{
  if(!await refresh(epoch)||modal!==current)return;
  current.items=launchItems(current.gameId);
  if([...current.selection].some(key=>!current.items.some(item=>item.key===key)))throw new Error('所选 MOD 已变化，请重新打开启动弹窗');
  for(const item of current.items.filter(item=>item.job&&current.selection.has(item.key))){
   current.progress='正在安装 '+item.name+'…';renderModal();
   const result=await installWithProgress(item.job.id,current);if(result?.kind==='fomod')return;
   if(epoch!==homeEpoch||modal!==current)return;
  }
  if(!await refresh(epoch)||modal!==current)return;
  current.items=launchItems(current.gameId);current.installation=null;current.progress='正在应用 MOD 选择并启动游戏…';renderModal();
  const chosen=current.items.filter(item=>current.selection.has(item.key));
  if(chosen.some(item=>!item.mod))throw new Error('部分 MOD 尚未安装，请重试');
  await api('installations/launch',{gameId:current.gameId,enabledModIds:chosen.map(item=>item.mod.id)});
  if(epoch!==homeEpoch)return;
  current.busy=false;if(modal===current)closeModal();
  if(await refresh(epoch))toast('已应用 MOD 选择，并请求启动游戏');
 }catch(error){
  if(epoch!==homeEpoch||modal!==current)return;
  current.error=error.message;
  await refresh(epoch).catch(()=>{});
  if(epoch===homeEpoch&&modal===current)current.items=launchItems(current.gameId);
 }finally{if(epoch===homeEpoch){launchingGame=null;current.busy=false;render();if(modal===current)renderModal();}}
}
async function loadSources(one,more=false,force=false){
 const gen=one?generation:++generation, gameId=selected, q=onlineQuery;
 const ids=one?[one]:data.providers.map(p=>p.id);
 for(const source of ids){requests[source]=(requests[source]||0)+1;const old=onlineResults[source];const page=more?(old?.page||1)+1:1;onlineResults[source]={...old,status:'loading',items:more?(old?.items||[]):[],requestPage:page};}if(view==='detail')render();
 await Promise.all(ids.map(async source=>{const old=onlineResults[source],ticket=requests[source];try{const r=await api('sources/list',{source,gameId,query:q,page:old.requestPage,force});if(gen!==generation||selected!==gameId||ticket!==requests[source])return;onlineResults[source]={...r,items:more?[...old.items,...r.items.filter(m=>!old.items.some(o=>o.id===m.id))]:r.items};}catch(e){if(gen!==generation||ticket!==requests[source])return;onlineResults[source]={...old,status:'error',message:e.message};}if(view==='detail')render();}));
}
function downloadControl(f){if(f.available)return `<div class="row-actions"><button class="btn primary small" data-download-file="${esc(f.id)}">${icon('download')}下载</button></div>`;if(f.downloadCode==='NEXUS_KEY_REQUIRED')return '<button class="btn small" data-nav="settings" data-close>连接 N 网</button>';const labels={STEAM_CHANNEL_NOT_IMPLEMENTED:'工坊通道未接入',NO_DOWNLOAD_ADDRESS:'未提供下载地址',UNSUPPORTED_DOWNLOAD_ADDRESS:'暂不支持此地址'};return `<button class="btn small" disabled title="${esc(f.downloadReason||'来源没有开放下载')}">${esc(labels[f.downloadCode]||'来源未开放下载')}</button>`;}
function closeModal(immediate=false){if(!immediate&&(modal?.kind==='play'&&modal.busy||modal?.kind==='install-progress'&&modal.task.status==='running'))return;if(modal?.resumePlay&&!immediate){modal=modal.resumePlay;renderModal();document.querySelector('[data-confirm-play]')?.focus();return;}if(modal?.kind==='plan')api('installations/discard',{id:modal.plan.id}).catch(()=>{});const hadModal=!!modal;modal=null;dismissModal(document.getElementById('modal-root'),immediate);if(hadModal){const target=previousFocus?.isConnected?previousFocus:previousFocus?.id?document.getElementById(previousFocus.id):null;target?.focus();}}
function renderInstallProgressModal(){
 const task=modal.task,running=task.status==='running',failed=task.status==='failed';
 const job=data.jobs.find(job=>job.id===task.jobId),gameId=job?.gameId||task.gameId;
 const retry=failed&&job?`<button class="btn" data-install-job="${esc(job.id)}">重新读取说明并安装</button>${gameId.startsWith('catalog:')?`<button class="btn" data-workshop-job="${esc(job.id)}">选择本机游戏</button>`:''}`:'';
 setModalContent(document.getElementById('modal-root'),`<div class="modal-backdrop"><section class="modal install-progress-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-busy="${running}"><div class="modal-head"><h2 id="modal-title">${running?'正在安装 MOD':failed?'MOD 安装未完成':'MOD 安装完成'}</h2><button class="icon-button" data-close aria-label="关闭弹窗" ${running?'disabled':''}>${icon('close')}</button></div><div class="modal-body">${renderInstallationProgress(task,{esc,icon})}</div><div class="modal-foot">${running?'<span class="modal-small">安装时会自动备份，完成后可查看安装结果。</span>':`<button class="btn" data-close>关闭</button>${retry}${!failed?'<button class="btn primary" data-nav="installed" data-close>查看已安装 MOD</button>':''}`}</div></section></div>`);
 document.querySelector('.install-progress-modal')?.setAttribute('aria-busy',String(running));
}
function renderModal(){
 if(!modal)return;let heading,body;
 if(modal.kind==='install-progress'){renderInstallProgressModal();return;}
 if(modal.kind==='managed-detail'){setModalContent(document.getElementById('modal-root'),modManager.detail(modal.id));return;}
 if(modal.kind==='manager-settings'){setModalContent(document.getElementById('modal-root'),modManager.settings(modal.gameId));return;}
 if(modal.kind==='studio-controls'){setModalContent(document.getElementById('modal-root'),studioControls.render(modal));return;}
 if(modal.kind==='studio-preview'){setModalContent(document.getElementById('modal-root'),studio.renderPreview(modal));return;}
 if(modal.kind==='play'){renderPlayModal();if(modal.installation)document.querySelector('.library-play-modal .modal-body')?.insertAdjacentHTML('beforeend',renderInstallationProgress(modal.installation,{esc,icon}));return;}
 if(modal.workshop){const focused=document.getElementById('modal-root').contains(document.activeElement);setModalContent(document.getElementById('modal-root'),workshop.renderModal(modal));if(focused)document.querySelector('.modal [data-close]')?.focus({preventScroll:true});return;}
 if(['fomod','rule','plan','uninstall','launch','auto-error','restore-result'].includes(modal.kind)){renderInstallModal();return;}
 if(modal.kind==='loadout'){const l=modal.loadout;heading='切换配置 · '+l.name;body=`<p>将整套 Mod 启用状态切换到保存的档案，恢复其默认安装规则。</p><div class="file-list">${l.mods.map(e=>`<div class="file-row"><strong>${esc(data.installations.mods.find(m=>m.id===e.id)?.name||'已卸载的 Mod（无法切换）')}</strong><span>${e.status==='enabled'?'启用':'停用'}</span></div>`).join('')}</div><p>档案以外的托管 Mod 将停用。执行前校验文件、前置和依赖；失败回滚整套变更。</p>`;}
 else if(modal.kind==='mapping'){const g=currentGame();heading='匹配游戏来源';body=`<p>自动匹配使用安装记录中的游戏名和 App ID。未找到唯一专区时，可以补充对应的专区信息。</p><label>用于搜索的游戏名<input id="mapping-name" value="${esc(g.searchName)}"></label><label>N 网游戏专区名<input id="mapping-nexus" placeholder="例如 stardewvalley" value="${esc(g.nexus||'')}"></label><label>香蕉网游戏 ID<input id="mapping-banana" placeholder="例如 5937" value="${esc(g.banana||'')}"></label><label>Steam App ID<input id="mapping-app" value="${esc(g.appId||'')}" ${g.platform==='Steam'?'readonly':''}></label>`;}
 else {const m=modal.item;heading=m.name;const d=modal.detail&&{...modal.detail,...translation.content(modal)};body=`<div class="modal-summary"><div class="mod-icon">${icon('box')}</div><div><h3>${esc(m.name)}</h3><p>${esc(provider(m.source).name)} · ${esc(m.author)}</p></div></div>${modal.loading?`<div class="notice">${icon('loader','spinning')}正在获取详情和文件列表…</div>`:modal.error?`<div class="notice">${icon('info')}${esc(modal.error)}</div><button class="btn" data-detail-retry>重试</button>`:`${translation.controls(modal)}<p class="modal-description resource-description">${esc(d.description||m.summary)}</p>${d.requirements?.length?`<h3>前置要求</h3><ul>${d.requirements.map(r=>`<li>${esc(r)}</li>`).join('')}</ul>`:''}${d.notice?`<div class="notice">${icon('info')}${esc(d.notice)}</div>`:''}<h3>下载文件</h3><div class="file-list">${d.files.length?d.files.map(f=>`<div class="file-row"><div><strong>${esc(f.label||f.name)}</strong><small>${size(f.size)} ${f.version?'· v'+esc(f.version):''} ${f.category?'· '+esc(f.category):''}</small>${f.downloadReason?`<p class="file-download-reason">${esc(f.downloadReason)}</p>`:''}</div>${downloadControl(f)}</div>`).join(''):'<p>来源未提供可下载文件。</p>'}</div>`}`;}
 setModalContent(document.getElementById('modal-root'),`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">${esc(heading)}</h2><button class="icon-button" data-close aria-label="关闭弹窗">${icon('close')}</button></div><div class="modal-body">${body}</div><div class="modal-foot"><button class="btn" data-close>关闭</button>${modal.kind==='loadout'?'<button class="btn primary" data-apply-loadout>切换整套配置</button>':modal.kind==='mapping'?'<button class="btn primary" data-save-mapping>保存并重新查询</button>':'<button class="btn" data-nav="tasks" data-close>查看下载</button>'}</div></section></div>`);
}
function openModal(value){previousFocus=document.activeElement;modal=value;renderModal();const close=document.querySelector('.modal [data-close]:not([disabled])'),dialog=document.querySelector('.modal');if(close)close.focus();else if(dialog){dialog.tabIndex=-1;dialog.focus();}}
async function loadDetail(item){openModal({kind:'resource',item,loading:true});const current=modal;try{const d=await api('sources/detail',{gameId:item.gameId,id:item.id});if(modal!==current)return;modal.detail=d;}catch(e){if(modal!==current)return;modal.error=e.message;}if(modal===current){modal.loading=false;renderModal();void translation.start(current);}}
document.addEventListener('click',async e=>{
 if(!app?.isConnected||app.closest('[inert]'))return;
 const b=e.target.closest('button');if(!b||b.disabled)return;const d=b.dataset;
 try{
 if(await studioControls.click(d))return;
 if(modal?.kind==='studio-preview'&&(d.studioPreviewTab||d.studioPreviewFile!==undefined)){
  if(['overview','files','validation'].includes(d.studioPreviewTab))modal.tab=d.studioPreviewTab;
  if(d.studioPreviewFile!==undefined){const index=Number(d.studioPreviewFile);if(Number.isInteger(index)&&modal.payload.files[index]){modal.fileIndex=index;modal.tab='files';}}
  renderModal();document.querySelector(d.studioPreviewTab?`[data-studio-preview-tab="${d.studioPreviewTab}"]`:`[data-studio-preview-file="${modal.fileIndex}"]`)?.focus({preventScroll:true});return;
 }
 if(d.modListRetry){listTranslation.retry(d.modListRetry);return;}
 if(d.modOriginalSearch){const original=d.modOriginalSearch.slice(0,160);if(d.modOriginalSearch.length>160)toast('名称较长，已使用原名前 160 个字符搜索');if(d.modOriginalScope==='workshop')await workshop.searchOriginal(original);else{onlineDraft=original;onlineQuery=original;await loadSources();}return;}
 const accountMenu=app.querySelector('.account-menu');if(accountMenu)accountMenu.open=false;
 if(await workshop.handleClick(d,b))return;
 if(await studio.click(d))return;
 if(modManager.click(d))return;
 if('modTranslationToggle'in d){translation.toggle();return;}
 if('modTranslationRetry'in d){void translation.start(modal);return;}
 if(await sourceAuth.handleClick(d,b)){onlineResults={};return;}
 if('authLogout'in d){window.dispatchEvent(new CustomEvent('moddock:logout'));return;}
 if(d.nav==='account'){closeModal();openAccount();return;}
 if(d.nav){if(view==='detail')generation++;closeModal();view=d.nav;query='';render();statePoller?.update();if(view==='workshop')await workshop.enter();if(view==='studio')await studio.enter();}
 if('close'in d)closeModal();
 if(d.game)await openGame(d.game);
 if(d.gameTab)await selectGameTab(d.gameTab);
 if('clearGameSearch'in d){gameLibraryQuery='';render();document.getElementById('game-library-search')?.focus();}
 if(d.playGame)await playGame(d.playGame);
 if('confirmPlay'in d)await confirmPlay();
 if(d.selectLaunchMods&&modal?.kind==='play'&&!modal.busy){modal.selection=new Set(d.selectLaunchMods==='all'?modal.items.map(item=>item.key):[]);document.querySelectorAll('[data-launch-mod]').forEach(input=>{input.checked=modal.selection.has(input.dataset.launchMod);});document.getElementById('launch-mod-count').textContent=`已选 ${modal.selection.size} / ${modal.items.length}`;}
 if('playSettings'in d&&modal?.kind==='play'){const current=modal;openLaunchSettings(current.gameId,true);modal.resumePlay=current;}
 if(d.launchSettings)openLaunchSettings(d.launchSettings);
 if('saveLaunch'in d){
  const executable=document.getElementById('launch-executable').value.trim();if(!executable){document.getElementById('launch-executable').focus();throw new Error('请填写游戏或加载器的启动入口');}
  const current=modal,epoch=homeEpoch;const rule={...current.rule,executable,root:document.getElementById('launch-root').value.trim(),arguments:document.getElementById('launch-arguments').value.split('\n').map(value=>value.trim()).filter(Boolean)};
  b.disabled=true;try{await api('installations/profile',{gameId:current.gameId,rule});if(epoch!==homeEpoch)return;if(modal===current)closeModal(true);if(!await refresh(epoch))return;if(current.resumePlay)openModal(current.resumePlay);else if(current.startAfterSave)await playGame(current.gameId);else toast('启动设置已保存');}finally{b.disabled=false;}
 }
 if(d.action==='scan')await runScan();
 if(d.action==='clear-search'){query='';render();document.getElementById('library-search')?.focus();}
 if('addScanPath'in d)await changeScanPath();
 if(d.removeScanPath)await changeScanPath(d.removeScanPath);
 if(d.provider){onlineProvider=d.provider;render();}
 if('onlineSearch'in d){onlineQuery=onlineDraft.trim();await loadSources();}
 if('onlineRefresh'in d)await loadSources(undefined,false,true);
 if(d.retrySource)await loadSources(d.retrySource,false,true);
 if(d.diagnostic){const r=onlineResults[d.diagnostic],g=currentGame();await navigator.clipboard.writeText(JSON.stringify({version:'0.5.0',game:{name:g.name,appId:g.appId,searchName:g.searchName,nexus:g.nexus,banana:g.banana},source:d.diagnostic,status:r.status,message:r.message,code:r.code,host:r.host,query:r.query,matchedGame:r.matchedGame,total:r.total,returned:r.returnedCount,filtered:r.filteredCount,parsed:r.items?.length,displayed:app.querySelectorAll(`.online-card[data-source="${d.diagnostic}"]`).length,activeSource:onlineProvider},null,2));toast('诊断信息已复制，可直接粘贴给我');}
 if(d.bindSource){const g=currentGame();await api('mapping',{gameId:selected,mapping:{searchName:g.searchName,nexus:g.nexus||'',banana:g.banana||'',appId:g.appId||'',[d.bindSource]:d.bindId}});await refresh();await loadSources(d.bindSource,false,true);}
 if(d.more&&onlineResults[d.more]?.status!=='loading')await loadSources(d.more,true);
 if(d.mod){const m=Object.values(onlineResults).flatMap(r=>r.items||[]).find(m=>m.id===d.mod);if(m)await loadDetail(m);}
 if('detailRetry'in d)await loadDetail(modal.item);
 if('mapping'in d)openModal({kind:'mapping'});
 if('saveMapping'in d){const mapping={searchName:document.getElementById('mapping-name').value,nexus:document.getElementById('mapping-nexus').value.trim(),banana:document.getElementById('mapping-banana').value.trim(),appId:document.getElementById('mapping-app').value.trim()};await api('mapping',{gameId:selected,mapping});closeModal();await refresh();await loadSources();}
 if(d.authorizeJob){const j=data.jobs.find(j=>j.id===d.authorizeJob);await api('nexus/authorize',{gameId:j.gameId,id:j.resourceId,fileId:j.fileId});}
 if('receiveNxm'in d){const input=document.getElementById('nxm-url');const url=input.value;input.value='';await api('nexus/receive',{url,gameId:document.getElementById('nxm-game').value||undefined});await refresh();}
 if(d.importJob){const j=data.jobs.find(j=>j.id===d.importJob);if(j.gameId.startsWith('catalog:')){await workshop.handleClick({workshopJob:j.id});return;}await api('library/import',{gameId:j.gameId,jobId:j.id});await refresh();toast('已导入待安装 Mod 库');}
 if(d.saveLoadout){await api('loadouts/save',{gameId:d.saveLoadout,name:document.getElementById('loadout-name-'+d.saveLoadout).value});await refresh();toast('配置档案已保存');}
 if(d.switchLoadout){const l=data.installations.loadouts.find(l=>l.id===d.switchLoadout);openModal({kind:'loadout',loadout:l});}
 if('applyLoadout'in d){const l=modal.loadout;await api('loadouts/switch',{gameId:l.gameId,id:l.id});closeModal();await refresh();toast('整套配置已切换');}
 if(d.deleteLoadout){await api('loadouts/delete',{gameId:d.loadoutGame,id:d.deleteLoadout});await refresh();}
 if(d.checkUpdates){if(checkingUpdates.has(d.checkUpdates))return;checkingUpdates.add(d.checkUpdates);b.disabled=true;render();toast('正在检查已安装的 Nexus / GameBanana Mod…');try{const results=await api('updates/check',{gameId:d.checkUpdates});await refresh();toast(results.some(item=>item.status==='error')?'部分来源检查失败，请查看 Mod 详情并重试':results.length?'更新检查完成，请在 Mod 管理中查看详情':'没有可检查的 Nexus / GameBanana 托管 Mod；请核对加载器官方版本');}finally{checkingUpdates.delete(d.checkUpdates);b.disabled=false;render();}}
 if(d.downloadUpdate){const m=data.installations.mods.find(m=>m.id===d.downloadUpdate);await api('updates/download',{gameId:m.gameId,id:m.id,fileId:d.updateFile});await refresh();toast('更新已加入下载队列；旧版保持当前状态');}
 if(d.downloadFile){const m=modal.item;await api('downloads/start',{gameId:m.gameId,id:m.id,fileId:d.downloadFile,name:m.name});toast('已加入下载队列');await refresh();}
 if(d.cancel){await api('downloads/cancel',{id:d.cancel});await refresh();}
 if(d.retryDownload){const j=data.jobs.find(j=>j.id===d.retryDownload);await api('downloads/start',{gameId:j.gameId,id:j.resourceId,fileId:j.fileId,name:j.name});await refresh();}
 if(d.verifyDownload){const job=data.jobs.find(job=>job.id===d.verifyDownload);if(job?.verificationRequired)nexusVerification.open(job);}
 if(d.installJob)await planJob(d.installJob);
 if(d.restoreGame)await restoreNative(d.restoreGame);
 if(d.ruleGame)await openRule(d.ruleGame,d.ruleJob);
 if(d.launchGame)await playGame(d.launchGame);
 if(d.checkRun){const r=data.installations.runs.find(r=>r.id===d.checkRun);await api('installations/run',{gameId:r.gameId,id:r.id});await refresh();}
 if(d.modAction){
  const m=data.installations.mods.find(m=>m.id===d.managedId);
  if(!m||pendingModActions.has(m.id))return;
  if(d.modAction==='uninstall')openModal({kind:'uninstall',record:m});
  else{
   pendingModActions.set(m.id,d.modAction);render();
   try{await api('installations/action',{gameId:m.gameId,id:m.id,action:d.modAction});await refresh();}
   finally{pendingModActions.delete(m.id);render();}
  }
 }
 if('saveRule'in d){const el=id=>document.getElementById('rule-'+id).value.trim();const gameId=modal.gameId,jobId=modal.jobId;await api('installations/profile',{gameId,rule:{mode:el('mode'),root:el('root'),sourcePrefix:el('prefix'),destination:el('destination'),executable:el('executable'),arguments:el('arguments').split('\n').map(s=>s.trim()).filter(Boolean),requires:el('requires').split('\n').map(s=>s.trim()).filter(Boolean),log:el('log'),marker:el('marker')}});closeModal();await refresh();toast('游戏专属安装规则已保存');if(jobId)await previewJob(jobId);}
 if('applyPlan'in d){if(!document.getElementById('plan-author').checked)throw new Error('请先核对作者的目录、前置和版本要求');const p=modal.plan;b.disabled=true;try{await api('installations/apply',{gameId:p.gameId,id:p.id,allowOverwrite:document.getElementById('plan-overwrite')?.checked===true});closeModal();view='installed';modManager.showInstalled();await refresh();toast('文件安装完成；可校验文件或运行验证');}finally{b.disabled=false;}}
 if('confirmUninstall'in d){const m=modal.record;b.disabled=true;try{await api('installations/action',{gameId:m.gameId,id:m.id,action:'uninstall'});closeModal();await refresh();toast('已卸载，已替换的原文件已还原');}finally{b.disabled=false;}}
 if(d.reveal)await api('downloads/reveal',{id:d.reveal});
 if(d.saveFile){const r=await fetch('/api/downloads/file',{method:'POST',headers:{'X-Moddock-Token':data.token,'Content-Type':'application/json'},body:JSON.stringify({id:d.saveFile})});if(!r.ok)throw requestError(r,await r.json());const url=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=url;a.download=data.jobs.find(j=>j.id===d.saveFile).filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 }catch(e){toast(e.message);}
});
document.addEventListener('change',async e=>{workshop.change(e.target);try{await studio.change(e.target);if(e.target.dataset.launchMod&&modal?.kind==='play'&&!modal.busy){const key=e.target.dataset.launchMod;if(e.target.checked)modal.selection.add(key);else modal.selection.delete(key);document.getElementById('launch-mod-count').textContent=`已选 ${modal.selection.size} / ${modal.items.length}`;}if(e.target.id==='auto-import'){await api('library/auto-import',{enabled:e.target.checked});await refresh();}if(e.target.id==='rule-template'){const r=data.recipes.find(r=>r.id===e.target.value);if(r&&modal?.kind==='rule'){const recommended=modal.suggestions?.find(s=>s.id===r.id);modal.rule={...r,...recommended,root:'',executable:r.executable||'',requires:r.requires||[],arguments:[],log:'',marker:''};renderModal();}}}catch(err){toast(err.message);}});
document.addEventListener('input',e=>{workshop.input(e.target);studio.input(e.target);studioControls.input(e.target);modManager.input(e.target);if(e.target.id==='library-search'){query=e.target.value;render();}if(e.target.id==='game-library-search'){gameLibraryQuery=e.target.value;render();}if(e.target.id==='online-search')onlineDraft=e.target.value;});
document.addEventListener('keydown',e=>modManager.keydown(e));
document.addEventListener('keydown',e=>{
 if(!e.target.matches('.game-library-tabs [role="tab"]')||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
 e.preventDefault();const tabs=['overview','mods','explore','studio','settings'],index=tabs.indexOf(gameTab);
 const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
 selectGameTab(tabs[next]).catch(error=>toast(error.message));document.getElementById('game-tab-'+tabs[next])?.focus({preventScroll:true});
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(modal)closeModal();else{const opened=app?.querySelector('details.account-menu[open],details.context-help[open]');if(opened){opened.open=false;opened.querySelector('summary').focus();}}}if(e.key==='Enter'&&e.target.id==='online-search'){onlineQuery=onlineDraft.trim();loadSources();}if(e.key==='Tab'&&modal){const els=[...document.querySelectorAll('.modal button:not([disabled]),.modal input:not([disabled]),.modal select:not([disabled]),.modal a[href]')];if(!els.length){e.preventDefault();return;}const first=els[0],last=els.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
let statePoller;
document.addEventListener('submit',e=>{if(e.target.hasAttribute('data-studio-form')){e.preventDefault();studio.submit().catch(error=>toast(error.message));}else if(e.target.dataset.workshopForm){e.preventDefault();workshop.submit(e.target).catch(error=>toast(error.message));}});
document.addEventListener('dragstart',e=>studio.drag(e));
document.addEventListener('dragover',e=>studio.dragOver(e));
document.addEventListener('dragleave',e=>studio.dragLeave(e));
document.addEventListener('drop',e=>{studio.drop(e).catch(error=>toast(error.message));});
let homeEpoch=0;
export async function mountHome(element,profile){
 const epoch=++homeEpoch;
 app=element;homeProfile=profile;view='library';selected=null;query='';gameTab='overview';gameLibraryQuery='';launchingGame=null;scanning=false;scanPathsBusy=false;scanError='';renderedPage=null;renderedDetailKey=null;renderedManagerKey=null;workshop.reset();studio.reset();sourceAuth.reset();modManager.reset();
 statePoller?.stop();
 try{
  const next=await api('state');if(epoch!==homeEpoch)return false;data=next;render();syncInstallationProgress();nexusVerification.update(data.jobs);
  statePoller=createStatePoller({
   read:signal=>api('state',undefined,{signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])}),
   isActive:()=>installBusy||!!launchingGame||hasActiveWork(data),
   isPaused:()=>scanning||!app?.isConnected||!!accountRoot||!installBusy&&data.installations.progress?.status!=='running'&&(view==='studio'||view==='detail'&&gameTab==='studio'),
   apply:next=>{
    if(epoch!==homeEpoch)return;
    data=next;
    syncInstallationProgress();
    if(!['settings','workshop'].includes(view)&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))render();
    notifyNxm();sourceAuth.update();nexusVerification.update(data.jobs);
   },
  });
  statePoller.start();void runScan();return true;
 }
 catch(e){if(epoch===homeEpoch)app.innerHTML=`<div class="boot">无法连接本地服务：${esc(e.message)} <button data-home-retry>重试</button></div>`;return false;}
}
document.addEventListener('click',e=>{if(e.target.closest('[data-home-retry]'))mountHome(app,homeProfile);});
document.addEventListener('click',e=>{if(!e.target.closest('.context-help'))app?.querySelectorAll('.context-help[open]').forEach(node=>{node.open=false;});});
document.addEventListener('click',e=>{if(!e.target.closest('.account-menu')){const menu=app?.querySelector('.account-menu');if(menu)menu.open=false;}});
export function suspendHome(){disposeGameLibraryScroll();homeEpoch++;generation++;scanning=false;scanPathsBusy=false;scanError='';workshop.reset();studio.reset();sourceAuth.reset();nexusVerification.reset();statePoller?.stop();statePoller=null;clearTimeout(toastTimer);document.getElementById('toast')?.classList.remove('show');cancelDomMotion();closeAccount();}
export function unmountHome(){suspendHome();listTranslation.reset();clearGameCards();closeModal(true);app?.replaceChildren();app=null;homeProfile=null;renderedPage=null;}
