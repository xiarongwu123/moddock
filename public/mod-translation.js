import translate from 'i18n-jsautotranslate';
import { createModTranslator } from '../src/mod-translation.cjs';

translate.selectLanguageTag.show = false;
translate.language.setLocal('english');
let configured = false;
export const modTranslator = createModTranslator((texts, success, failure) => {
 if (!configured) {
  translate.request.setHost(['https://api.translate.zvo.cn/']);
  configured = true;
 }
 translate.request.translateText({ from: 'auto', to: 'chinese_simplified', texts }, success, failure);
});

export function createDetailTranslation(ctx) {
 function render() {
  const body = document.querySelector('#modal-root .modal-body');
  const description = body?.querySelector('.resource-description');
  const scroll = body?.scrollTop || 0, textScroll = description?.scrollTop || 0;
  const focused = document.activeElement?.closest('[data-mod-translation-toggle], [data-mod-translation-retry]');
  const selector = focused?.hasAttribute('data-mod-translation-toggle') ? '[data-mod-translation-toggle]' : focused ? '[data-mod-translation-retry]' : null;
  ctx.renderModal();
  const next = document.querySelector('#modal-root .modal-body');
  if (next) next.scrollTop = scroll;
  const nextDescription = next?.querySelector('.resource-description');
  if (nextDescription) nextDescription.scrollTop = textScroll;
  if (selector) next?.querySelector(selector)?.focus({ preventScroll: true });
 }
 async function start(current) {
  if (!current?.detail || current.loading || current.error || current.translation?.status === 'loading' || current.translation?.status === 'ready') return;
  const state = current.translation = { status: 'loading', original: current.translation?.original || false };
  render();
  try {
   state.text = await modTranslator.translate(current.item, current.detail);
   state.status = 'ready';
  } catch { state.status = 'error'; }
  if (ctx.modal() === current && current.translation === state) render();
 }
 function toggle() {
  const current = ctx.modal();
  if (!current?.translation) return;
  current.translation.original = !current.translation.original;
  render();
 }
 function content(current) {
  const state = current.translation;
  return state?.status === 'ready' && !state.original ? state.text : { description: current.detail.description || current.item.summary || '', requirements: current.detail.requirements || [] };
 }
 function controls(current) {
  const state = current.translation;
  if (!state) return '';
  const message = state.original ? '正在查看原文' : state.status === 'loading' ? '正在翻译为中文…' : state.status === 'error' ? '翻译暂不可用，已显示原文' : '已自动翻译为中文';
  return `<div class="mod-translation-bar"><span role="status" aria-live="polite">${message}</span><div><button class="btn small" type="button" data-mod-translation-toggle aria-pressed="${!!state.original}">${state.original ? '查看中文' : '查看原文'}</button>${state.status === 'error' ? '<button class="text-link" type="button" data-mod-translation-retry>重试翻译</button>' : ''}</div></div>`;
 }
 return { start, toggle, content, controls };
}
