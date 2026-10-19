export function createStudioControls({ api, esc, icon, modal, openModal, renderModal }) {
 const context = value => ({ gameId: value.gameId, id: value.artifactId });
 async function load(current) {
  const value = await api('studio/controls', context(current));
  if (modal() !== current) return;
  current.control = value; current.error = ''; renderModal();
 }
 return {
  async open(gameId, artifactId) {
   const current = { kind: 'studio-controls', gameId, artifactId, loading: true };
   openModal(current);
   try { await load(current); } catch (error) { if (modal() === current) current.error = error.message; }
   finally { if (modal() === current) { current.loading = false; renderModal(); } }
  },
  render(current) {
   const c = current.control, disabled = current.busy ? 'disabled' : '';
   const body = c ? `<label class="studio-control-enabled"><input id="studio-control-enabled" type="checkbox" ${c.enabled ? 'checked' : ''} ${disabled}>游戏内启用此 Mod</label><div class="studio-controls-list">${c.schema.map(control => control.type === 'action' ? `<div class="studio-control-row"><span>${esc(control.label)}${control.shortcut ? `<kbd>${esc(control.shortcut)}</kbd>` : ''}</span><button class="btn small" data-control-action="${esc(control.key)}" ${disabled || !c.enabled ? 'disabled' : ''}>执行一次</button></div>` : `<label class="studio-control-row" for="studio-control-${esc(control.key)}"><span>${esc(control.label)}</span>${control.type === 'number' ? `<input id="studio-control-${esc(control.key)}" type="range" min="${control.min}" max="${control.max}" step="${control.step}" value="${c.values[control.key]}" data-control-range ${disabled}><output>${c.values[control.key]}</output>` : `<input id="studio-control-${esc(control.key)}" type="checkbox" ${c.values[control.key] ? 'checked' : ''} ${disabled}>`}</label>`).join('')}</div><p class="studio-control-feedback" role="status">${esc(current.actionResult?.message || c.message)}</p><p class="studio-fineprint">快捷键在游戏窗口内触发。需要先加载当前 Mod；参数应用确认与实际玩法效果分别检查。</p>` : '';
   return `<div class="modal-backdrop"><section class="modal studio-controls-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-busy="${!!current.busy}"><div class="modal-head"><h2 id="modal-title">Mod 参数与快捷键</h2><button class="icon-button" data-close aria-label="关闭弹窗">${icon('close')}</button></div><div class="modal-body">${current.loading ? '<p>正在读取 Mod 参数…</p>' : body}${current.error ? `<p class="studio-error" role="alert">${esc(current.error)}</p>` : ''}</div><div class="modal-foot"><button class="btn" data-close>关闭</button>${c ? `<button class="btn" data-control-refresh ${disabled}>检查游戏反馈</button><button class="btn primary" data-control-save ${disabled}>保存参数</button>` : ''}</div></section></div>`;
  },
  async click(data) {
   if (data.studioControls) { await this.open(data.controlsGame, data.studioControls); return true; }
   const current = modal();
   if (current?.kind !== 'studio-controls' || !('controlSave' in data || 'controlRefresh' in data || data.controlAction)) return false;
   if (current.busy || !current.control) return true;
   const c = current.control;
   let input;
   if ('controlSave' in data) input = { operation: 'settings', revision: c.revision, enabled: document.getElementById('studio-control-enabled').checked,
    values: Object.fromEntries(c.schema.filter(item => item.type !== 'action').map(item => [item.key, item.type === 'number' ? Number(document.getElementById('studio-control-' + item.key).value) : document.getElementById('studio-control-' + item.key).checked])) };
   current.busy = true; current.error = ''; renderModal();
   try {
    if (input) { const result = await api('studio/controls/update', { ...context(current), ...input }); if (modal() === current) { current.control = result; current.actionResult = null; } }
    else if (data.controlAction) { const result = await api('studio/controls/update', { ...context(current), operation: 'action', action: data.controlAction }); if (modal() === current) current.actionResult = result; }
    else if (current.actionResult?.nonce) { const result = await api('studio/controls/action-status', { ...context(current), nonce: current.actionResult.nonce }); if (modal() === current) current.actionResult = result; }
    else await load(current);
   } catch (error) { if (modal() === current) current.error = error.message; }
   finally { if (modal() === current) { current.busy = false; renderModal(); } }
   return true;
  },
  input(element) { if (element.hasAttribute('data-control-range')) element.nextElementSibling.value = element.value; },
 };
}
