export function createWorkshop(ctx) {
 const { api, esc, icon, size, cover, empty, toast } = ctx;
 let state;
 let catalogTicket = 0, sourceGeneration = 0;
 const sourceTickets = {};
 const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('zh-CN') : '日期未提供';
 const provider = id => ctx.data().providers.find(p => p.id === id);
 const items = () => Object.values(state.results).flatMap(result => result.items || []);
 const saved = item => state.favorites.some(m => m.id === item.id && m.gameId === item.gameId);
 const identity = item => `${item.gameId}/${item.id}`;
 const findItem = key => [...items(), ...state.favorites].find(item => identity(item) === key);
 const localGames = game => ctx.data().sourceGames.filter(g => game?.localIds?.includes(g.id));

 function reset() {
  catalogTicket++; sourceGeneration++;
  state = { scope: 'all', gameQuery: '', gameDraft: '', catalog: null, catalogBusy: false, catalogError: '', game: null, query: '', draft: '', source: 'all', category: 'all', sort: 'default', results: {}, favorites: [], favoritesReady: false };
 }
 reset();

 async function enter() {
  const current = state;
  if (!state.favoritesReady) {
   try { const favorites = await api('workshop/favorites', {}); if (state === current) { state.favorites = favorites; state.favoritesReady = true; } }
   catch (error) { if (state === current) toast(error.message); }
  }
  if (state !== current) return;
  if (!state.catalog && !state.catalogBusy) await loadCatalog();
  ctx.render();
 }

 async function loadCatalog(more = false) {
  const ticket = ++catalogTicket, current = state;
  state.catalogBusy = true; state.catalogError = '';
  const page = more ? (state.catalog?.page || 1) + 1 : 1;
  ctx.render();
  try {
   const result = await api('workshop/catalog', { scope: state.scope === 'installed' ? 'installed' : 'all', query: state.gameQuery, page });
   if (ticket !== catalogTicket || current !== state) return;
   state.catalog = { ...result, items: more ? [...state.catalog.items, ...result.items] : result.items };
  } catch (error) { if (ticket === catalogTicket) state.catalogError = error.message; }
  finally { if (ticket === catalogTicket) { state.catalogBusy = false; ctx.render(); } }
 }

 async function selectGame(id) {
  const gen = ++sourceGeneration;
  const game = await api('workshop/game', { gameId: id });
  if (gen !== sourceGeneration) return;
  Object.assign(state, { game, query: '', draft: '', source: 'all', category: 'all', results: {} });
  ctx.render();
  await loadSources();
 }

 async function loadSources(one, more = false, force = false) {
  if (!state.game) return;
  const gen = one ? sourceGeneration : ++sourceGeneration;
  const game = state.game, query = state.query;
  const ids = one ? [one] : ctx.data().providers.map(p => p.id);
  await Promise.all(ids.map(async source => {
   const ticket = sourceTickets[source] = (sourceTickets[source] || 0) + 1;
   const previous = state.results[source];
   const page = more ? (previous?.page || 1) + 1 : 1;
   state.results[source] = { ...previous, status: 'loading', items: more ? previous?.items || [] : [] };
   ctx.render();
   try {
    const result = await api('workshop/list', { source, gameId: game.id, query, page, force });
    if (gen !== sourceGeneration || ticket !== sourceTickets[source]) return;
    // Keep the last successful page when a later page fails, so retry cannot skip it.
    state.results[source] = result.status === 'error' && more
     ? { ...previous, status: 'error', message: result.message, moreFailed: true }
     : { ...result, items: more ? [...previous.items, ...result.items.filter(m => !previous.items.some(old => old.id === m.id))] : result.items };
   } catch (error) {
    if (gen !== sourceGeneration || ticket !== sourceTickets[source]) return;
    state.results[source] = { ...(more ? previous : { items: [] }), status: 'error', message: error.message, moreFailed: more };
   }
   ctx.render();
  }));
 }

 function gameCard(game) {
  return `<button class="game-card workshop-game" data-workshop-game="${esc(game.id)}"><div class="game-art">${game.appId ? `<img src="${cover(game.appId)}" loading="lazy" alt="">` : icon('gamepad')}<span class="game-badge ${game.localIds.length ? 'real' : ''}">${game.localIds.length ? '本机已安装' : '浏览 MOD'}</span><span class="game-arrow">${icon('arrow')}</span></div><div class="game-info"><h3>${esc(game.name)}</h3><span class="workshop-game-subtitle">${esc(game.searchName || game.name)}</span></div></button>`;
 }

 function card(item) {
  const source = provider(item.source);
  const key = esc(identity(item));
  const favorite = saved(item);
  const downloading = ctx.data().jobs.some(job => job.resourceId === item.id && ['queued', 'running'].includes(job.status));
  return `<article class="mod-card workshop-mod" data-source="${esc(item.source)}"><div class="workshop-art"><button class="online-art" data-workshop-mod="${key}" aria-label="查看 ${esc(item.name)}" style="--source-color:${source.color}">${icon('box')}${item.image ? `<img src="${esc(item.image)}" alt="" loading="lazy">` : ''}<span class="online-source-tag">${esc(source.short)}</span></button><button class="workshop-save ${favorite ? 'is-saved' : ''}" data-workshop-favorite="${key}" aria-label="${favorite ? '取消收藏' : '收藏'} ${esc(item.name)}" aria-pressed="${favorite}">${icon('bookmark')}</button></div><div class="mod-copy"><span class="workshop-category">${esc(item.category || 'MOD')}</span><h3 title="${esc(item.name)}"><button data-workshop-mod="${key}">${esc(item.name)}</button></h3><div class="online-author">${esc(item.author || '社区作者')}</div><p>${esc(item.summary)}</p><div class="mod-meta"><span>${item.metric == null ? '暂无统计' : new Intl.NumberFormat('zh-CN', { notation: 'compact' }).format(item.metric) + ' ' + esc(item.metricLabel)}</span><span>${date(item.updated)}</span></div><div class="mod-actions"><span>${state.scope === 'favorites' && !state.game ? esc(item.gameName) : item.version ? 'v' + esc(item.version) : '社区 MOD'}</span><button class="btn small" data-workshop-mod="${key}">${downloading ? '下载中' : item.source === 'workshop' ? '查看 / 订阅' : '查看详情'}${icon('chevron')}</button></div></div></article>`;
 }

 function render() {
  const header = `<div class="library-toolbar workshop-toolbar"><div class="heading-title"><h1>MOD 工坊</h1><span class="workshop-caption">发现下一种玩法</span></div><div class="workshop-scopes" aria-label="工坊浏览范围">${[['all', '全部游戏'], ['installed', '我的游戏'], ['favorites', '收藏']].map(([scope, title]) => `<button class="filter-pill ${state.scope === scope ? 'active' : ''}" data-workshop-scope="${scope}" aria-pressed="${state.scope === scope}">${scope === 'favorites' ? icon('bookmark') : ''}${title}${scope === 'favorites' ? `<span>${state.favorites.length}</span>` : ''}</button>`).join('')}</div></div>`;
  if (state.game) return header + renderGame();
  if (state.scope === 'favorites') return header + `<p class="workshop-intro">收藏的 MOD 保存在当前账号的本机目录，随时回来继续浏览。</p>` + (state.favorites.length ? `<div class="mod-grid workshop-grid">${state.favorites.map(card).join('')}</div>` : empty('还没有收藏的 MOD', '浏览游戏专区，点击卡片上的书签即可收藏。', '<button class="btn primary" data-workshop-scope="all">探索游戏</button>'));
  const catalog = state.catalog;
  return header + `<div class="workshop-catalog-bar"><div><h2>${state.gameQuery ? '搜索结果' : state.scope === 'installed' ? '为你的游戏发现 MOD' : '选择一款游戏'}</h2><p>${state.scope === 'installed' ? '进入游戏专区，查看三个来源的社区资源。' : '从已安装游戏和精选游戏开始，也可以搜索更多游戏。'}</p></div><form class="searchbox workshop-catalog-search" data-workshop-form="games">${icon('search')}<input id="workshop-game-search" value="${esc(state.gameDraft)}" maxlength="160" placeholder="搜索游戏名称" aria-label="搜索工坊游戏"><button type="submit" aria-label="搜索游戏">${icon('arrow')}</button></form></div>${state.catalogError ? `<div class="notice">${esc(state.catalogError)}<button class="text-link" data-workshop-catalog-retry>重试</button></div>` : ''}${catalog?.items.length ? `<div class="game-grid workshop-game-grid">${catalog.items.map(gameCard).join('')}</div><div class="workshop-pagination"><span>已显示 ${catalog.items.length} / ${catalog.total} 款目录游戏</span>${catalog.hasNext ? `<button class="btn" data-workshop-catalog-more ${state.catalogBusy ? 'disabled' : ''}>${state.catalogBusy ? '加载中…' : '更多游戏'}</button>` : ''}</div>` : state.catalogBusy ? `<div class="workshop-loading">${icon('loader', 'spinning')}正在读取游戏目录…</div>` : state.catalogError ? '' : empty(state.gameQuery ? '没有找到这款游戏' : '还没有发现本机游戏', state.gameQuery ? '试试英文名或更短的游戏名称。' : '你仍然可以浏览全部游戏，或回到游戏库扫描。', `<button class="btn" data-workshop-scope="all">浏览全部游戏</button><button class="btn" data-nav="library">我的游戏</button>`)}`;
 }

 function renderGame() {
  const game = state.game;
  const sources = ctx.data().providers.filter(p => state.source === 'all' || p.id === state.source);
  const loaded = items().filter(item => state.source === 'all' || item.source === state.source);
  const categories = [...new Set(loaded.map(item => item.category).filter(Boolean))].sort();
  return `<button class="back" data-workshop-back>${icon('left')}返回${state.scope === 'favorites' ? '收藏' : '游戏目录'}</button><section class="workshop-game-heading">${game.appId ? `<img src="${cover(game.appId)}" alt="">` : `<div class="workshop-game-symbol">${icon('gamepad')}</div>`}<div><h2>${esc(game.name)}</h2><p>${esc(game.searchName)} <span>· ${localGames(game).length ? '本机已安装' : '可先下载收藏，安装时关联本机游戏'}</span></p></div>${localGames(game).length === 1 ? `<button class="btn small" data-game="${esc(localGames(game)[0].id)}">游戏管理${icon('chevron')}</button>` : ''}</section><form class="online-search-field workshop-mod-search" data-workshop-form="mods">${icon('search')}<input id="workshop-mod-search" maxlength="160" value="${esc(state.draft)}" placeholder="搜索这款游戏的 MOD" aria-label="搜索工坊 MOD"><button class="btn primary" type="submit">搜索</button><button class="btn" type="button" data-workshop-refresh aria-label="刷新工坊资源">${icon('restore')}</button></form><div class="toolbar source-tabs workshop-sources"><button class="filter-pill ${state.source === 'all' ? 'active' : ''}" data-workshop-source="all">全部来源</button>${ctx.data().providers.map(p => `<button class="filter-pill ${state.source === p.id ? 'active' : ''}" data-workshop-source="${p.id}">${esc(p.short)}<span class="source-count">${state.results[p.id]?.total ?? '—'}</span></button>`).join('')}</div><div class="workshop-filters"><label>来源分类<select id="workshop-category"><option value="all">全部分类</option>${categories.map(category => `<option value="${esc(category)}" ${state.category === category ? 'selected' : ''}>${esc(category)}</option>`).join('')}</select></label><label>排序<select id="workshop-sort"><option value="default">来源默认</option><option value="updated" ${state.sort === 'updated' ? 'selected' : ''}>最近更新（已加载）</option></select></label><span>分类筛选当前已加载的 ${loaded.length} 项</span></div>${sources.map(renderSource).join('')}`;
 }

 function renderSource(source) {
  const result = state.results[source.id];
  let visible = (result?.items || []).filter(item => state.category === 'all' || item.category === state.category);
  if (state.sort === 'updated') visible = [...visible].sort((a, b) => (Date.parse(b.updated) || 0) - (Date.parse(a.updated) || 0));
  const status = result?.status;
  const error = ['error', 'unmapped', 'unsupported', 'needs_connection'].includes(status);
  const notice = error ? `<div class="workshop-source-notice" role="status">${icon('info')}<p>${esc(result.message)}</p>${status === 'needs_connection' ? '<button class="text-link" data-nav="settings">连接设置</button>' : ''}${['error', 'needs_connection'].includes(status) ? `<button class="text-link" data-workshop-retry="${source.id}">重试</button>` : ''}${status !== 'unsupported' && result.browseUrl ? `<a class="text-link" href="${esc(result.browseUrl)}" target="_blank" rel="noopener noreferrer">官方专区${icon('arrow')}</a>` : ''}</div>` : '';
  return `<section class="workshop-source-section" aria-label="${esc(source.name)}"><div class="workshop-source-heading"><h3><span style="--source-color:${source.color}">${esc(source.icon)}</span>${esc(source.name)}</h3><span>${status === 'loading' ? '正在读取…' : result?.total != null ? `${result.total} 项来源结果` : ''}</span></div>${notice}${visible.length ? `<div class="mod-grid workshop-grid">${visible.map(card).join('')}</div>` : status === 'loading' ? '<div class="workshop-skeleton" aria-label="正在加载资源"><div></div><div></div><div></div></div>' : !error ? `<p class="workshop-source-empty">${state.category !== 'all' ? '已加载结果中暂无此分类，可继续加载或切换分类。' : state.query ? '没有找到匹配的 MOD，试试其他关键词。' : '这个来源暂未返回 MOD。'}</p>` : ''}${result?.hasNext ? `<div class="workshop-pagination"><button class="btn small" data-workshop-more="${source.id}" ${status === 'loading' ? 'disabled' : ''}>${status === 'loading' ? '加载中…' : `加载更多 ${esc(source.short)}`}</button></div>` : ''}</section>`;
 }

 async function favorite(item, button) {
  const current = state;
  button.disabled = true;
  try {
   const enabled = !saved(item);
   const favorites = await api('workshop/favorite', { gameId: item.gameId, id: item.id, enabled });
   if (state !== current) return;
   state.favorites = favorites;
   ctx.render();
   if (ctx.modal()?.workshop) ctx.renderModal();
   toast(enabled ? '已收藏' : '已取消收藏');
  } finally { button.disabled = false; }
 }

 async function detail(item) {
  ctx.openModal({ kind: 'resource', workshop: true, item, loading: true });
  const current = ctx.modal();
  try {
   const [data, game] = await Promise.all([api('workshop/detail', { gameId: item.gameId, id: item.id }), api('workshop/game', { gameId: item.gameId })]);
   if (ctx.modal() !== current) return;
   Object.assign(current, { detail: data, game });
  } catch (error) { if (ctx.modal() === current) current.error = error.message; }
  if (ctx.modal() === current) { current.loading = false; ctx.renderModal(); }
 }

 function renderModal(modal) {
  if (modal.kind === 'workshop-attach') {
   const locals = localGames(modal.game);
   return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">关联本机游戏</h2><button class="icon-button" data-close aria-label="关闭弹窗">${icon('close')}</button></div><div class="modal-body"><p>${esc(modal.game.name)} · ${esc(modal.job.name)}</p>${locals.length ? `<label>安装到<select id="workshop-attach-target">${locals.map(game => `<option value="${esc(game.id)}">${esc(game.name)} · ${esc(game.platform)} · ${esc(game.installPath)}</option>`).join('')}</select></label><p>关联后检查下载包，再进入原有安装方案预览。</p>` : '<p>尚未扫描到这款游戏。安装游戏后，请在“我的游戏”扫描，再回到下载管理关联。</p>'}</div><div class="modal-foot"><button class="btn" data-close>关闭</button>${locals.length ? '<button class="btn primary" data-workshop-attach>关联并预览安装</button>' : '<button class="btn primary" data-nav="library" data-close>我的游戏</button>'}</div></section></div>`;
  }
  const item = modal.item, data = modal.detail, steam = item.source === 'workshop';
  const locals = localGames(modal.game);
  const target = modal.target || (locals.length === 1 ? locals[0].id : item.gameId);
  const fileControl = file => file.available
   ? `<button class="btn primary small" data-workshop-download="${esc(file.id)}">${icon('download')}下载</button>${item.source === 'nexus' ? `<button class="text-link" data-workshop-authorize="${esc(file.id)}">网页授权</button>` : ''}`
   : file.downloadCode === 'NEXUS_KEY_REQUIRED' ? '<button class="btn small" data-nav="settings" data-close>连接 N 网</button>' : `<span class="workshop-file-unavailable">${esc(file.downloadReason || '来源暂未开放下载')}</span>`;
  return `<div class="modal-backdrop workshop-backdrop"><section class="modal workshop-drawer" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><span>${esc(provider(item.source).name)}</span><button class="icon-button" data-close aria-label="关闭详情">${icon('close')}</button></div><div class="modal-body">${item.image ? `<img class="workshop-detail-image" src="${esc(item.image)}" alt="${esc(item.name)} 预览">` : ''}<div class="workshop-detail-title"><span>${esc(item.gameName)} · ${esc(item.category || 'MOD')}</span><h2 id="modal-title">${esc(item.name)}</h2><p>by ${esc(item.author || '社区作者')} · ${date(item.updated)}</p></div><div class="workshop-detail-actions"><button class="btn ${saved(item) ? 'is-saved' : ''}" data-workshop-favorite="${esc(identity(item))}" aria-pressed="${saved(item)}">${icon('bookmark')}${saved(item) ? '已收藏' : '收藏'}</button><a class="btn" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">作者原页${icon('arrow')}</a>${steam ? `<a class="btn primary" href="${esc(ctx.data().nexusAuthorizationWindow ? item.steamUrl || item.url : item.url)}" target="_blank" rel="noopener noreferrer">在 Steam 中订阅</a>` : ''}</div>${modal.loading ? `<div class="notice">${icon('loader', 'spinning')}正在读取介绍和文件…</div>` : modal.error ? `<div class="notice">${esc(modal.error)}</div><button class="btn" data-workshop-detail-retry>重试</button>` : `<div class="resource-description">${esc(data.description || item.summary)}</div>${data.requirements?.length ? `<h3>前置要求</h3><ul class="workshop-requirements">${data.requirements.map(requirement => `<li>${esc(requirement)}</li>`).join('')}</ul>` : '<p class="workshop-detail-note">来源未列出结构化前置要求，请核对作者说明。</p>'}${steam ? '<div class="notice">订阅、下载和更新由 Steam 处理。打开订阅页后，请在 Steam 中确认订阅状态。</div>' : `<h3>下载文件</h3><label class="workshop-target">关联游戏<select id="workshop-download-target"><option value="${esc(item.gameId)}" ${target === item.gameId ? 'selected' : ''}>仅下载，稍后关联本机游戏</option>${locals.map(game => `<option value="${esc(game.id)}" ${target === game.id ? 'selected' : ''}>${esc(game.name)} · ${esc(game.platform)} · ${esc(game.installPath)}</option>`).join('')}</select></label><p class="workshop-detail-note">下载后进入下载管理，核对前置和安装方案后安装。</p>${data.notice ? `<details class="workshop-download-help"><summary>下载说明</summary><p>${esc(data.notice)}</p></details>` : ''}<div class="file-list">${data.files.length ? data.files.map(file => `<div class="file-row"><div><strong>${esc(file.label || file.name)}</strong><small>${size(file.size)}${file.version ? ' · v' + esc(file.version) : ''}</small></div><div class="workshop-file-actions">${fileControl(file)}</div></div>`).join('') : '<p>来源未提供可下载文件。</p>'}</div>`}`}</div><div class="modal-foot"><button class="btn" data-close>继续浏览</button><button class="btn" data-nav="tasks" data-close>下载管理${icon('chevron')}</button></div></section></div>`;
 }

 async function handleClick(d, button) {
  if (d.workshopScope) {
   sourceGeneration++; state.game = null; state.scope = d.workshopScope;
   state.gameQuery = ''; state.gameDraft = ''; state.catalog = null;
   if (state.scope !== 'favorites') await loadCatalog(); else ctx.render();
  } else if (d.workshopGame) await selectGame(d.workshopGame);
  else if ('workshopBack' in d) { sourceGeneration++; state.game = null; ctx.render(); }
  else if ('workshopCatalogMore' in d) await loadCatalog(true);
  else if ('workshopCatalogRetry' in d) await loadCatalog();
  else if (d.workshopSource) { state.source = d.workshopSource; state.category = 'all'; ctx.render(); }
  else if ('workshopRefresh' in d) { state.category = 'all'; await loadSources(undefined, false, true); }
  else if (d.workshopRetry) await loadSources(d.workshopRetry, !!state.results[d.workshopRetry]?.moreFailed, true);
  else if (d.workshopMore) await loadSources(d.workshopMore, true);
  else if (d.workshopMod) { const item = findItem(d.workshopMod); if (item) await detail(item); }
  else if (d.workshopFavorite) { const item = findItem(d.workshopFavorite); if (item) await favorite(item, button); }
  else if ('workshopDetailRetry' in d) await detail(ctx.modal().item);
  else if (d.workshopDownload || d.workshopAuthorize) {
   const modal = ctx.modal(), item = modal.item;
   const gameId = document.getElementById('workshop-download-target').value;
   button.disabled = true;
   try {
    await api(d.workshopDownload ? 'downloads/start' : 'nexus/authorize', { gameId, id: item.id, fileId: d.workshopDownload || d.workshopAuthorize, name: item.name });
    toast(d.workshopDownload ? '已加入下载队列' : '请在 Nexus 网页中选择 Mod Manager Download');
    await ctx.refresh();
   } finally { button.disabled = false; }
  } else if (d.workshopJob) {
   const job = ctx.data().jobs.find(job => job.id === d.workshopJob);
   const game = await api('workshop/game', { gameId: job.gameId });
   ctx.openModal({ kind: 'workshop-attach', workshop: true, job, game });
  } else if ('workshopAttach' in d) {
   const job = ctx.modal().job;
   button.disabled = true;
   try {
    await api('workshop/attach', { jobId: job.id, gameId: document.getElementById('workshop-attach-target').value });
    ctx.closeModal(); await ctx.refresh(); await ctx.planJob(job.id);
   } finally { button.disabled = false; }
  } else return false;
  return true;
 }

 function input(element) {
  if (element.id === 'workshop-game-search') state.gameDraft = element.value;
  if (element.id === 'workshop-mod-search') state.draft = element.value;
 }
 function change(element) {
  if (element.id === 'workshop-category') { state.category = element.value; ctx.render(); }
  if (element.id === 'workshop-sort') { state.sort = element.value; ctx.render(); }
  if (element.id === 'workshop-download-target' && ctx.modal()) ctx.modal().target = element.value;
 }
 async function submit(form) {
  if (form.dataset.workshopForm === 'games') { state.gameQuery = state.gameDraft.trim(); await loadCatalog(); }
  if (form.dataset.workshopForm === 'mods') { state.query = state.draft.trim(); state.category = 'all'; await loadSources(); }
 }
 return { render, renderModal, enter, reset, handleClick, input, change, submit };
}
