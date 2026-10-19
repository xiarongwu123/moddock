export function renderGameLibrary({ data, selected, tab, query, launching, esc, icon, cover, explore, runCard, studio }) {
 const game = data.sourceGames.find(item => item.id === selected);
 const games = data.scan.games.filter(item => `${item.name} ${item.platform}`.toLowerCase().includes(query.toLowerCase()));
 const mods = data.installations?.mods.filter(item => item.gameId === selected) || [];
 const runs = data.installations?.runs.filter(item => item.gameId === selected) || [];
 const profile = data.installations?.profiles.find(item => item.gameId === selected);
 const enabled = mods.filter(item => item.status === 'enabled').length;
 const restoration = data.installations?.restorations?.find(item => item.gameId === selected && item.preserved);
 const lastPlayed = runs[0] ? new Date(runs[0].started).toLocaleDateString('zh-CN') : '暂无记录';
 const tabs = [['overview', '概览'], ['mods', '我的 Mod'], ['explore', '探索 Mod'], ['studio', '游匣 AI'], ['settings', '游戏设置']];
 const tabButton = (value, label, className = 'btn') => `<button class="${className}" data-game-tab="${value}">${label}</button>`;
 const modRows = (items, actions = false) => items.map(mod => `<article class="library-mod-row">
  <span class="library-mod-icon">${icon('box')}</span>
  <div class="library-mod-copy"><h3>${esc(mod.name)}</h3><span>${mod.files.length} 个文件${mod.version ? ` · v${esc(mod.version)}` : ''}</span></div>
  <span class="library-mod-status ${mod.status === 'enabled' ? 'is-enabled' : ''}">${mod.status === 'enabled' ? '已启用' : '已停用'}</span>
  ${actions ? `<div class="row-actions">${(() => { const job = data.jobs.find(job => job.id === mod.jobId); return job?.studio?.controls ? `<button class="btn small" data-studio-controls="${esc(job.studio.artifactId)}" data-controls-game="${esc(mod.gameId)}">参数与快捷键</button>` : ''; })()}<button class="btn small" data-mod-action="${mod.status === 'enabled' ? 'disable' : 'enable'}" data-managed-id="${esc(mod.id)}">${mod.status === 'enabled' ? '停用' : '启用'}</button><button class="btn small" data-mod-action="verify" data-managed-id="${esc(mod.id)}">校验</button><button class="icon-button" data-mod-action="uninstall" data-managed-id="${esc(mod.id)}" aria-label="卸载 ${esc(mod.name)}">${icon('trash')}</button></div>` : ''}
 </article>`).join('');
 const noMods = () => `<div class="library-mod-empty"><span>${icon('box')}</span><h3>还没有安装 Mod</h3>${tabButton('explore', `${icon('compass')}探索 Mod`, 'btn primary')}</div>`;
 const pending = data.jobs.filter(job => job.gameId === selected && job.status === 'completed' && job.import?.status === 'ready' && !mods.some(mod => mod.jobId === job.id));
 const overview = () => `<div class="library-overview">
  <section class="library-overview-mods"><div class="library-section-heading"><h2>我的 Mod <span>${mods.length}</span></h2>${mods.length ? tabButton('mods', `管理 ${icon('arrow')}`, 'text-link') : ''}</div>
   ${mods.length ? modRows(mods.slice(0, 4)) : noMods()}
   ${pending.length ? tabButton('mods', `${pending.length} 个 Mod 待安装 ${icon('arrow')}`, 'library-pending-link') : ''}
  </section>
  <aside class="library-game-info"><h2>游戏信息</h2><dl><div><dt>平台</dt><dd>${esc(game.platform)}</dd></div><div><dt>安装状态</dt><dd class="is-installed">${icon('check')}已安装</dd></div>${game.buildId ? `<div><dt>版本</dt><dd>${esc(game.buildId)}</dd></div>` : ''}</dl>${tabButton('settings', `查看游戏设置 ${icon('arrow')}`, 'text-link')}</aside>
  ${runs[0] ? `<section class="library-recent-run"><h2>最近运行</h2>${runCard(runs[0])}</section>` : ''}
 </div>`;
 const managed = () => `<div class="library-section-heading"><h2>我的 Mod <span>${mods.length}</span></h2>${tabButton('explore', `${icon('compass')}探索 Mod`)}</div>
  ${mods.length ? `<div class="library-mod-list">${modRows(mods, true)}</div>` : noMods()}
  ${pending.length ? `<h2 class="run-heading">待安装</h2>${pending.map(job => `<div class="file-row"><div><strong>${esc(job.name)}</strong><small>${job.import.files.length} 个文件</small></div><button class="btn small primary" data-install-job="${esc(job.id)}">一键安装</button></div>`).join('')}` : ''}
  <button class="library-pending-link" data-nav="installed">${icon('settings')}全部 Mod 与配置档案${icon('arrow')}</button>`;
 const settings = () => `<section class="library-game-settings"><h2>游戏设置</h2>
  <div class="library-setting-row"><div><h3>启动入口</h3><p>${esc(profile?.rule?.executable || '自动通过游戏平台启动；需要加载器时自动使用对应入口。')}</p></div><button class="btn" data-launch-settings="${esc(game.id)}">设置启动入口</button></div>
  <div class="library-setting-row"><div><h3>安装位置</h3><p class="library-install-path">${esc(game.installPath)}</p></div></div>
  <details class="library-launch-advanced"><summary>高级设置</summary><div class="library-setting-row"><div><h3>手动安装规则</h3><p>默认自动识别，仅在需要自定义目录或特殊安装方式时调整。</p></div><button class="btn" data-rule-game="${esc(game.id)}">手动安装规则</button></div>${restoration ? `<div class="library-setting-row"><div><h3>恢复时保留的用户文件</h3><p>${esc(restoration.recoveryPath)}</p></div></div>` : ''}</details>
  <div class="library-setting-row"><div><h3>Mod 来源</h3><p>关联这款游戏在各个 Mod 平台的专区。</p></div><button class="btn" data-mapping>来源匹配</button></div>
 </section>`;
 return `<div class="game-library-layout">
  <aside class="game-library-sidebar" aria-label="我的游戏库">
   <div class="game-library-sidebar-heading"><button data-nav="library" aria-label="返回游戏库" title="返回游戏库">${icon('grid')}</button><h2>我的游戏</h2><span>${data.scan.games.length}</span></div>
   <label class="game-library-search">${icon('search')}<input id="game-library-search" value="${esc(query)}" placeholder="搜索游戏" aria-label="搜索游戏库">${query ? `<button data-clear-game-search aria-label="清空游戏搜索">${icon('close')}</button>` : ''}</label>
   <div class="game-library-list-label">已安装 <span>${games.length}</span></div>
   <nav class="game-library-list" aria-label="已安装游戏" data-library-scroll>
    ${games.map(item => `<button class="game-library-item ${item.id === selected ? 'is-selected' : ''}" data-game="${esc(item.id)}" ${item.id === selected ? 'aria-current="page"' : ''} title="${esc(item.name)}">
     <span class="game-library-thumb">${icon('gamepad')}${item.appId ? `<img src="${cover(item.appId)}" alt="" loading="lazy">` : ''}</span>
     <span class="game-library-item-copy"><strong>${esc(item.name)}</strong><small>${esc(item.platform)}</small></span>
     ${item.id === selected ? `<span class="game-library-selected-dot" aria-hidden="true"></span>` : ''}
    </button>`).join('') || '<p class="game-library-no-results">没有匹配的游戏</p>'}
   </nav>
   <button class="game-library-add" data-nav="settings">${icon('folder')}添加游戏目录${icon('arrow')}</button>
  </aside>
  <section class="game-library-main" aria-label="${esc(game?.name || '游戏详情')}" data-detail-scroll>
   ${game ? `<header class="game-library-hero ${game.appId ? '' : 'has-no-art'}">
    <div class="game-library-hero-fallback" aria-hidden="true">${icon('gamepad')}</div>
    ${game.appId ? `<img class="game-library-hero-art" src="https://cdn.akamai.steamstatic.com/steam/apps/${encodeURIComponent(game.appId)}/library_hero.jpg" data-fallback-src="${cover(game.appId)}" alt="">` : ''}
    <div class="game-library-hero-copy"><span>${esc(game.platform)}<i></i>本机游戏</span><div class="game-library-hero-title-row"><h1 title="${esc(game.name)}">${esc(game.name)}</h1><div class="game-library-hero-play-slot" data-hero-play-slot></div></div></div>
   </header>
   <div class="game-library-body">
   <div class="game-library-playbar">
    <div class="game-library-play-slot" data-body-play-slot><button class="btn primary game-library-play" data-play-game="${esc(game.id)}" ${launching === game.id ? 'disabled' : ''}>${icon(launching === game.id ? 'loader' : 'play', launching === game.id ? 'spinning' : '')}${launching === game.id ? '正在启动…' : '开始游戏'}</button></div>
    <div class="game-library-stat"><span>最近启动</span><strong>${lastPlayed}</strong></div>
    <div class="game-library-stat"><span>已启用 Mod</span><strong>${enabled}<small> / ${mods.length}</small></strong></div>
    ${mods.length ? `<button class="btn danger" data-restore-game="${esc(game.id)}">恢复原生游戏</button>` : ''}<button class="game-library-settings-button" data-game-tab="settings" aria-label="游戏设置" title="游戏设置">${icon('settings')}</button>
   </div>
   <div class="game-library-tabs" role="tablist" aria-label="游戏内容">${tabs.map(([value, label]) => `<button id="game-tab-${value}" role="tab" aria-selected="${tab === value}" aria-controls="game-library-panel" tabindex="${tab === value ? 0 : -1}" data-game-tab="${value}">${label}${value === 'studio' ? '<span class="studio-pro">PRO</span>' : ''}${value === 'mods' && mods.length ? `<span>${mods.length}</span>` : ''}</button>`).join('')}</div>
   <section class="game-library-panel" id="game-library-panel" role="tabpanel" tabindex="0" aria-labelledby="game-tab-${tab}">${({ overview, mods: managed, explore, studio, settings })[tab]()}</section></div>` : `<div class="game-library-missing">${icon('gamepad')}<h2>游戏已不在库中</h2><p>从左侧选择游戏，或重新扫描游戏库。</p><button class="btn" data-nav="library">返回游戏库</button></div>`}
  </section>
 </div>`;
}

export function mountGameLibraryScroll(root) {
 const main = root.querySelector('.game-library-main');
 const hero = main?.querySelector('.game-library-hero');
 if (!hero) return () => {};
 const button = main.querySelector('[data-play-game]');
 const heroSlot = main.querySelector('[data-hero-play-slot]');
 const bodySlot = main.querySelector('[data-body-play-slot]');
 const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
 let docked = false, frame = 0, animation;
 const measure = () => {
  const expanded = hero.offsetHeight;
  const copyHeight = hero.querySelector('.game-library-hero-copy').offsetHeight;
  const compact = Math.min(expanded, Math.max(copyHeight + 8, Math.min(190, Math.max(144, main.clientHeight * .22))));
  // The hero scrolls in normal flow, then sticks at its compact height. Resizing it while
  // scrolling would change the scroll range and make short lists jump or oscillate.
  main.style.setProperty('--library-hero-offset', `${expanded - compact}px`);
  main.style.setProperty('--library-hero-compact', `${compact}px`);
 };
 const sync = (animate = true) => {
  frame = 0;
  // Separate entry/exit thresholds prevent flicker near the top. Both slots keep their size.
  const next = main.scrollHeight > main.clientHeight + 1 && main.scrollTop > (docked ? 8 : 24);
  main.dataset.scrolled = String(main.scrollTop > 0);
  if (next === docked) return;
  const focused = document.activeElement === button;
  animation?.cancel();
  (next ? heroSlot : bodySlot).appendChild(button);
  docked = next;
  main.dataset.launchDocked = String(docked);
  if (focused) button.focus({ preventScroll: true });
  if (animate && !reducedMotion.matches) {
   animation = button.animate([{ opacity: .35, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
 };
 const schedule = () => { if (!frame) frame = requestAnimationFrame(() => sync()); };
 const stopAnimation = () => { if (reducedMotion.matches) animation?.cancel(); };
 main.addEventListener('scroll', schedule, { passive: true });
 reducedMotion.addEventListener('change', stopAnimation);
 const observer = new ResizeObserver(() => { measure(); schedule(); });
 observer.observe(main);
 observer.observe(hero);
 observer.observe(hero.querySelector('.game-library-hero-copy'));
 observer.observe(main.querySelector('.game-library-panel'));
 measure();
 sync(false);
 return () => {
  cancelAnimationFrame(frame);
  animation?.cancel();
  observer.disconnect();
  main.removeEventListener('scroll', schedule);
  reducedMotion.removeEventListener('change', stopAnimation);
 };
}
