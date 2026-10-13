export function createSourceAuth(ctx) {
 const { esc, icon, api, toast } = ctx;
 let signature = '', lastFlow = '';
 const pending = status => ['connecting', 'waiting', 'reconnecting', 'saving'].includes(status);
 function render() {
  const { connections: c, nexusSso: s = {} } = ctx.data();
  const waiting = pending(s.status);
  const status = (connected, label) => `<span class="source-connection-status ${connected ? 'is-ready' : ''}">${connected ? icon('check') : '<i aria-hidden="true"></i>'}${label}</span>`;
  const saved = source => c.saved?.[source] ? '已加密保存，下次自动连接' : '已连接，仅本次运行有效';
  const disconnect = source => `<button id="source-${source}-disconnect" class="source-disconnect" data-disconnect="${source}">${source === 'workshop' ? '断开 API' : '断开连接'}</button>`;
  const manual = (source, label, secondary = false) => `<details id="source-${source}-manual" name="source-key-editor" class="source-manual ${secondary ? 'is-secondary' : ''}" ${source === 'nexus' && waiting ? 'inert' : ''}><summary id="source-${source}-toggle">${label}${icon('chevron')}</summary><div class="source-key-form"><label for="${source}-api-key">${source === 'nexus' ? 'Nexus' : 'Steam Web'} API Key</label><input id="${source}-api-key" type="password" autocomplete="off" spellcheck="false" maxlength="2048" placeholder="粘贴 API Key"><button id="source-${source}-save" class="btn primary small" data-connect="${source}">保存连接</button></div></details>`;
  return `<section id="source-connections" class="source-connections" aria-labelledby="source-connections-title">
   <div class="source-connections-heading"><h2 id="source-connections-title">来源连接</h2><span class="source-storage-note">${c.persistent ? icon('shield') + '本机加密 · 自动恢复' : '仅本次运行有效'}</span></div>
   ${c.warning ? `<div class="notice" role="status">${esc(c.warning)}</div>` : ''}
   <div class="source-connection-grid">
    <article class="source-connection-card" data-source-card="nexus" aria-labelledby="source-nexus-title">
     <span class="source-connection-mark is-nexus" aria-hidden="true">N</span><h3 id="source-nexus-title" tabindex="-1">Nexus Mods</h3>
     ${status(c.nexusConnected, waiting ? '等待授权' : c.nexusConnected ? '已连接' : '未连接')}
     <p class="source-connection-description">${c.nexusConnected ? saved('nexus') : '连接账号，获取 MOD 下载授权'}</p>
     ${s.message && !['idle', 'connected', 'cancelled'].includes(s.status) ? `<p class="source-auth-status ${['error', 'expired'].includes(s.status) ? 'is-error' : ''}" role="status">${waiting ? icon('loader', 'spinning') : ''}${esc(s.message)}</p>` : ''}
     <div class="source-card-controls">
      ${waiting ? '<button id="source-nexus-cancel" class="btn small" data-nexus-cancel>取消连接</button>' : s.available ? `<button id="source-nexus-connect" class="btn ${c.nexusConnected ? '' : 'primary'} small" data-nexus-connect>${c.nexusConnected ? '重新授权' : '连接 Nexus'}</button>` : ''}
      ${manual('nexus', s.available ? '手动输入 Key' : c.nexusConnected ? '更换 Key' : '连接 Nexus', !!s.available)}
      ${c.nexusConnected && !waiting ? disconnect('nexus') : ''}
     </div>
    </article>
    <article class="source-connection-card" data-source-card="banana" aria-labelledby="source-banana-title">
     <span class="source-connection-mark is-banana" aria-hidden="true">G</span><h3 id="source-banana-title">GameBanana</h3>
     ${status(true, '可用')}<p class="source-connection-description">公开 MOD 可直接浏览与下载</p>
     <div class="source-card-controls"><span class="source-ready-note">${icon('check')}无需连接账号</span></div>
    </article>
    <article class="source-connection-card" data-source-card="workshop" aria-labelledby="source-workshop-title">
     <span class="source-connection-mark is-workshop" aria-hidden="true">S</span><h3 id="source-workshop-title" tabindex="-1">Steam 创意工坊</h3>
     ${status(true, c.workshopConnected ? 'API 已配置' : '可用')}<p class="source-connection-description">${c.workshopConnected ? saved('workshop') : '公开浏览与 Steam 订阅可直接使用'}</p>
     <div class="source-card-controls">${manual('workshop', c.workshopConnected ? '更换 Key' : '配置 API（可选）')}${c.workshopConnected ? disconnect('workshop') : ''}</div>
    </article>
   </div>
  </section>`;
 }
 function update() {
  const data = ctx.data(); if (!data) return;
  const next = JSON.stringify([data.connections, data.nexusSso]);
  if (next === signature) return;
  signature = next;
  const panel = document.getElementById('source-connections');
  if (panel) {
   const inputs = [...panel.querySelectorAll('input')].map(input => [input.id, input.value]);
   const opened = [...panel.querySelectorAll('details')].map(detail => [detail.id, detail.open]);
   const focus = panel.contains(document.activeElement) ? document.activeElement.id : null;
   const selection = focus && document.activeElement.matches('input') ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
   panel.outerHTML = render();
   for (const [id, value] of inputs) { const input = document.getElementById(id); if (input) input.value = value; }
   for (const [id, open] of opened) { const detail = document.getElementById(id); if (detail) detail.open = open; }
   if (focus) document.getElementById(focus)?.focus({ preventScroll: true });
   if (selection) document.getElementById(focus)?.setSelectionRange(...selection);
  }
  const flow = data.nexusSso;
  if (flow?.id && `${flow.id}:${flow.status}` !== lastFlow) {
   lastFlow = `${flow.id}:${flow.status}`;
   if (flow.status === 'connected') toast(data.connections.saved?.nexus ? 'Nexus 已连接，授权已加密保存' : 'Nexus 已连接，仅本次运行有效');
   if (['error', 'expired'].includes(flow.status)) toast(flow.message);
  }
 }
 async function handleClick(d, button) {
  if (!('nexusConnect' in d || 'nexusCancel' in d || d.connect || d.disconnect)) return false;
  button.disabled = true;
  try {
   if ('nexusConnect' in d) await api('nexus/sso/start', {});
   else if ('nexusCancel' in d) await api('nexus/sso/cancel', {});
   else {
    const source = d.connect || d.disconnect;
    const input = document.getElementById(`${source}-api-key`);
    const key = d.disconnect ? '' : input.value.trim();
    if (d.connect && !key) throw new Error('请先输入 API Key');
    const result = await api('sources/connection', { source, key });
    if (input) input.value = '';
    toast(d.disconnect ? '已断开连接并移除保存的授权' : result?.saved?.[source] ? '授权已加密保存，重启后自动恢复' : '已连接，授权仅本次运行有效');
   }
   await ctx.refresh(); update();
   const source = d.connect || d.disconnect;
   if (source) {
    const detail = document.getElementById(`source-${source}-manual`);
    if (detail) detail.open = false;
    document.getElementById(`source-${source}-title`)?.focus({ preventScroll: true });
   }
  } finally { button.disabled = false; }
  return true;
 }
 return { render, update, handleClick, reset() { signature = ''; lastFlow = ''; } };
}
