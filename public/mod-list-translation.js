import { createModListTranslation } from '../src/mod-list-translation.cjs';

export function createListTranslation({ translator, esc }) {
 const store = createModListTranslation(items => translator.translateList(items), {
  isVisible: entry => !!document.querySelector(`[data-mod-list-title="${entry.id}"]`),
  onChange: entries => entries.forEach(update),
 });
 function titleText(entry, scope, detail) {
  const name = entry.text?.name || entry.original.name;
  const action = scope === 'workshop' ? 'data-workshop-mod' : 'data-mod';
  return `<h3 title="${esc(entry.original.name)}"><button type="button" ${action}="${esc(detail)}">${esc(name)}</button></h3>${name !== entry.original.name ? `<button class="mod-original-name" type="button" data-mod-original-search="${esc(entry.original.name)}" data-mod-original-scope="${scope}" title="用原名搜索" aria-label="用原名搜索 ${esc(entry.original.name)}">原名：${esc(entry.original.name)}</button>` : ''}`;
 }
 function summaryText(entry) {
  const summary = entry.text?.summary ?? entry.original.summary;
  const original = summary !== entry.original.summary ? `<details class="mod-original-summary"><summary>简介原文</summary><p>${esc(entry.original.summary)}</p></details>` : '';
  const status = entry.status === 'error' ? `翻译暂不可用，已保留原文 <button class="text-link" type="button" data-mod-list-retry="${entry.id}">重试翻译</button>` : entry.status === 'ready' ? '' : '正在翻译…';
  return `<p class="mod-list-description" title="${esc(summary)}">${esc(summary)}</p>${original}${status ? `<div class="mod-list-translation-status" role="status">${status}</div>` : ''}`;
 }
 function update(entry) {
  for (const slot of document.querySelectorAll(`[data-mod-list-title="${entry.id}"]`)) {
   const focused = slot.contains(document.activeElement);
   slot.innerHTML = titleText(entry, slot.dataset.modListScope, slot.dataset.modListDetail);
   if (focused) slot.querySelector('h3 button')?.focus({ preventScroll: true });
  }
  for (const slot of document.querySelectorAll(`[data-mod-list-summary="${entry.id}"]`)) {
   const open = slot.querySelector('details')?.open;
   const focused = slot.contains(document.activeElement);
   slot.innerHTML = summaryText(entry);
   if (open) slot.querySelector('details')?.setAttribute('open', '');
   if (focused) slot.querySelector('button, summary')?.focus({ preventScroll: true });
  }
 }
 function title(item, scope, detail) {
  const entry = store.get(item);
  return `<div class="mod-list-title" data-mod-list-title="${entry.id}" data-mod-list-scope="${scope}" data-mod-list-detail="${esc(detail)}">${titleText(entry, scope, detail)}</div>`;
 }
 function summary(item) {
  const entry = store.get(item);
  return `<div class="mod-list-summary" data-mod-list-summary="${entry.id}">${summaryText(entry)}</div>`;
 }
 return { title, summary, retry: store.retry, reset: store.reset };
}
