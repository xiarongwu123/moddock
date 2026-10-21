/* Shared membership screen for the source UI and the preserved shipped bundle. */
(() => {
 'use strict';
 const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
 const number = value => Number.isSafeInteger(value) ? value.toLocaleString('zh-CN') : '—';
 let overlay, previousFocus, busy = false, token, sequence = 0;
 const marketing = () => `<div class="studio-locked membership-pitch" data-membership-pitch><img src="/youxia-ai-mascot.svg" alt="匣仔" width="112" height="112"><span class="studio-pro">PRO</span><h2>让你的游戏，多一种玩法</h2><p>开通游匣 Pro，和匣仔一起把想法做成 Mod。</p><div class="membership-benefits"><article><strong>一句话开始创作</strong><p>描述想要的装备、角色或玩法，让 AI 陪你实现。</p></article><article><strong>边试玩，边改进</strong><p>反馈实际效果，继续调整你的作品。</p></article><article><strong>AI 安装分析</strong><p>结合作者说明，辅助分析复杂 Mod 的安装方式。</p></article></div><p class="membership-caption">全部 AI 功能仅限有效 Pro 会员，每月 100 万 token。生成和修改都会消耗额度。</p><button class="btn primary" data-membership-open>查看 Pro 套餐与额度</button></div>`;
 async function api(route, body) {
  if (body !== undefined && !token) token = (await (await fetch('/api/auth/config')).json()).token;
  const response = await fetch('/api/account/' + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': token }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.message || data.error || '会员信息暂时无法加载'), { code: data.code });
  return data;
 }
 function close() { if (busy) return; sequence++; overlay?.remove(); overlay = null; previousFocus?.focus?.(); }
 function shell() {
  previousFocus = document.activeElement;
  overlay = document.createElement('div'); overlay.className = 'membership-overlay';
  overlay.innerHTML = `<section class="membership-dialog" role="dialog" aria-modal="true" aria-labelledby="membership-title"><header><div><span class="studio-pro">游匣 PRO</span><h2 id="membership-title">把想法，变成新玩法</h2></div><button class="btn" data-membership-close aria-label="关闭会员页面">关闭</button></header><div data-membership-body role="status">正在获取套餐与 AI 额度…</div><p data-membership-message role="status"></p></section>`;
  document.body.append(overlay); overlay.querySelector('button').focus();
 }
 async function load() {
  const ticket = ++sequence, host = overlay;
  const results = await Promise.allSettled([api('ai-usage'), api('plans')]);
  if (!host || host !== overlay || ticket !== sequence) return;
  const usage = results[0].value, plans = results[1].value;
  const quota = usage?.quota, membership = usage?.account?.membership;
  const pro = membership?.tier === 'pro' && (membership.expiresAt == null || Date.parse(membership.expiresAt) > Date.now());
  const items = Array.isArray(plans?.items) ? plans.items : [];
  host.querySelector('[data-membership-body]').innerHTML = `<div class="membership-status"><strong>${pro ? 'Pro 会员已开通' : '开通 Pro，解锁全部 AI 功能'}</strong>${membership?.expiresAt ? `<span>会员有效期至 ${esc(new Date(membership.expiresAt).toLocaleString('zh-CN'))}</span>` : ''}</div><div class="membership-benefits"><article><strong>AI 创作</strong><p>从想法到制作文件，持续对话调整。</p></article><article><strong>AI 修复</strong><p>带着试玩反馈继续改进作品。</p></article><article><strong>AI 安装分析</strong><p>辅助识别复杂安装说明与文件映射。</p></article></div><section class="membership-quota"><h3>AI token 额度</h3>${quota ? `<p>本期已用 <strong>${number(quota.usedTokens)}</strong> / ${number(quota.limitTokens)} token</p><p>剩余 ${number(quota.remainingTokens)} token · ${esc(new Date(quota.periodEnd).toLocaleString('zh-CN'))} 重置</p><progress aria-label="本期 token 使用量" max="${Math.max(1, quota.limitTokens)}" value="${Math.min(quota.limitTokens, quota.usedTokens)}"></progress>` : `<p>${results[0].status === 'rejected' ? esc(results[0].reason.message) : '额度待配置，暂不能发起 AI 请求。'}</p>`}<p>Pro 每月 100 万 token。输入、输出及多轮修改均计入用量，具体扣费以服务端记录为准。</p>${usage?.local?.recordedTasks ? `<small>本机已记录 ${number(usage.local.totalTokens)} token（输入 ${number(usage.local.inputTokens)} / 输出 ${number(usage.local.outputTokens)}）；本机明细不代替账户账单。</small>` : '<small>暂无本机 token 明细；未回传用量不表示零消耗。</small>'}</section><div class="membership-plans">${items.map(plan => `<article><h3>${esc(plan.name)}</h3><p>${Number.isSafeInteger(plan.priceMinor) && typeof plan.currency === 'string' ? esc(plan.currency) + ' ' + (plan.priceMinor / 100).toFixed(2) : '价格待确认'}${plan.durationDays === 0 ? ' / 长期有效' : Number.isSafeInteger(plan.durationDays) && plan.durationDays > 0 ? ' / ' + plan.durationDays + ' 天' : ''}</p><p>${Number.isSafeInteger(plan.tokenLimit) ? number(plan.tokenLimit) + ' token / 期' : '每月 100 万 token'}</p><button class="btn primary" data-membership-plan="${esc(plan.id)}" ${plans.paymentsEnabled === true ? '' : 'disabled'}>${plans.paymentsEnabled === true ? (pro ? '续费 / 调整套餐' : '开通 Pro') : '支付暂未开放'}</button></article>`).join('') || `<p>${results[1].status === 'rejected' ? esc(results[1].reason.message) : '套餐暂未开放，请稍后重试。'}</p>`}</div><button class="btn" data-membership-refresh>刷新会员与额度</button>`;
 }
 async function open() { if (overlay) { await load(); return; } shell(); await load(); }
 window.ModdockMembership = { marketing, open };
 const originalFetch = window.fetch.bind(window);
 window.fetch = async function(input, init) {
  const response = await originalFetch(input, init);
  let pathname; try { pathname = new URL(typeof input === 'string' ? input : input.url, location.href).pathname; } catch { return response; }
  if (response.status === 403 && /^\/api\/(studio\/|installations\/)/.test(pathname)) {
   void response.clone().json().then(data => { if (['pro_required', 'ai_credits_exhausted', 'ai_quota_unconfigured'].includes(data.code)) void open(); }).catch(() => {});
  }
  return response;
 };
 for (const name of ['moddock:logout', 'moddock:auth-required']) window.addEventListener(name, () => { sequence++; overlay?.remove(); overlay = null; token = undefined; });
 document.addEventListener('click', async event => {
  const button = event.target.closest('[data-membership-open],[data-membership-close],[data-membership-refresh],[data-membership-plan],[data-membership-order]');
  if (!button) return;
  event.preventDefault(); event.stopPropagation();
  if (button.hasAttribute('data-membership-open')) return open();
  if (button.hasAttribute('data-membership-close')) return close();
  if (button.hasAttribute('data-membership-refresh')) return load();
  if (busy || !overlay) return;
  busy = true; button.disabled = true;
  const host = overlay, ticket = sequence, message = host.querySelector('[data-membership-message]');
  message.textContent = '正在处理订单…';
  try {
   const orderId = button.dataset.membershipOrder;
   const order = orderId ? await api('orders/' + encodeURIComponent(orderId)) : await api('orders', { planId: button.dataset.membershipPlan });
   if (host !== overlay || ticket !== sequence) return;
   if (['paid', 'completed'].includes(order.status)) { message.textContent = '订单已支付，正在刷新会员状态…'; await load(); }
   else {
    message.textContent = '订单状态：' + ({ pending: '等待支付', cancelled: '已取消', expired: '已过期', failed: '支付失败' }[order.status] || '等待确认');
    const checkout = order.checkoutUrl || order.paymentUrl;
    if (checkout) { try { const url = new URL(checkout); if (url.protocol === 'https:' && !url.username && !url.password) { const link = document.createElement('a'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'btn'; link.textContent = '前往支付'; message.append(' ', link); } } catch {} }
    if (order.id) { const check = document.createElement('button'); check.className = 'btn'; check.dataset.membershipOrder = order.id; check.textContent = '查询支付结果'; message.append(' ', check); }
   }
  } catch (error) { if (host === overlay) message.textContent = error.message; }
  finally { busy = false; button.disabled = false; }
 }, true);
 document.addEventListener('keydown', event => {
  if (!overlay) return;
  if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
  if (event.key === 'Tab') { const stops = [...overlay.querySelectorAll('button:not(:disabled),a[href]')]; if (!stops.length) return; const index = stops.indexOf(document.activeElement); event.preventDefault(); event.stopImmediatePropagation(); stops[(index + (event.shiftKey ? -1 : 1) + stops.length) % stops.length].focus(); }
 }, true);
 const observer = new MutationObserver(() => {
  for (const locked of document.querySelectorAll('.studio-locked:not([data-membership-pitch])')) locked.outerHTML = marketing();
  const controls = document.querySelector('.user-center-controls');
  if (controls && !controls.querySelector('[data-membership-open]')) { const button = document.createElement('button'); button.className = 'btn'; button.dataset.membershipOpen = ''; button.textContent = 'Pro 会员与 AI 额度'; controls.prepend(button); }
 });
 observer.observe(document.body, { childList: true, subtree: true });
})();
