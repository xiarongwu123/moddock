import './nexus-verification.css';

export function createNexusVerification({ api, toast }) {
 let current;
 const dismissed = new Set();
 function close(defer = false) {
  if (!current) return;
  if (defer) dismissed.add(current.job.id);
  clearInterval(current.timer); for (const controller of current.requests) controller.abort(); current.dialog.close(); current.dialog.remove(); current = null;
 }
 function placeholder(session, message) {
  session.frame = null; session.image.hidden = true; session.placeholder.hidden = false;
  session.placeholder.textContent = message; session.picture.dataset.empty = 'true';
 }
 async function request(session, route, input, accept = value => value) {
  const controller = new AbortController(); session.requests.add(controller);
  let timer, onAbort;
  try {
   const deadline = new Promise((_, reject) => {
    onAbort = () => reject(new Error('验证画面连接超时，正在自动重试；也可以点击“重新连接”。'));
    controller.signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => controller.abort(), 12000);
   });
   return await Promise.race([api(route, input, { signal: controller.signal }).then(accept), deadline]);
  } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort); session.requests.delete(controller); }
 }
 async function poll(session) {
  if (current !== session || session.busy || session.clicking || session.gesture || Date.now() < session.nextReadAt) return;
  session.busy = true;
  const operation = session.operation;
  try {
   const frame = await request(session, 'downloads/verification', { id: session.job.id }, async frame => {
    if (!frame.pending) return frame;
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(frame.image || '') || !/^[a-f0-9-]{36}$/.test(frame.revision || '') || !Number.isSafeInteger(frame.width) || !Number.isSafeInteger(frame.height) || frame.width < 1 || frame.height < 1 || frame.width > 2200 || frame.height > 1700) throw new Error('验证画面无效，正在自动重试。');
    const picture = new Image(); picture.src = frame.image; await picture.decode(); return frame;
   });
   if (current !== session || session.clicking || session.gesture || operation !== session.operation) return;
   session.failures = 0; session.nextReadAt = 0;
   if (!frame.pending) { placeholder(session, '来源页面正在更新，正在自动重新获取验证画面…'); session.status.textContent = '等待来源验证画面，可点击“重新连接”立即重试。'; return; }
   session.placeholder.hidden = true; session.picture.dataset.empty = 'false';
   session.frame = frame; session.image.src = frame.image; session.image.hidden = false;
   session.image.style.width = session.zoom.value === 'fit' ? '' : Math.round(frame.width * Number(session.zoom.value)) + 'px'; session.image.dataset.fit = String(session.zoom.value === 'fit');
   session.status.textContent = '请点击画面中的验证控件，完成后下载会自动继续。';
  } catch (error) {
   if (current === session && !session.clicking && operation === session.operation) {
    session.failures++; session.nextReadAt = Date.now() + Math.min(30000, 2000 * 2 ** Math.min(session.failures - 1, 4));
    placeholder(session, '暂未取得验证画面，正在重连。'); session.status.textContent = error.message;
   }
  }
  finally { session.busy = false; if (current === session && session.refreshAfterClick && !session.clicking) { session.refreshAfterClick = false; void poll(session); } }
 }
 function open(job) {
  if (current?.job.id === job.id) return;
  close(); dismissed.delete(job.id);
  const dialog = document.createElement('dialog'); dialog.className = 'nexus-verification';
  dialog.innerHTML = '<header><h2>完成来源验证</h2><button type="button" class="icon-button" data-defer aria-label="稍后验证">×</button></header><p class="verification-job"></p><p class="verification-status" role="status">正在连接验证页面…</p><label class="verification-zoom">显示比例<select aria-label="验证画面显示比例"><option value="1">100%</option><option value="1.5">150%</option><option value="fit">适应窗口</option></select></label><div class="verification-picture" data-empty="true"><p class="verification-placeholder" role="status">正在获取来源验证画面…</p><img alt="Nexus 来源人机验证页面，点击画面中的验证控件" hidden draggable="false"></div><footer><button type="button" class="btn" data-reconnect>重新连接</button><button type="button" class="btn" data-defer>稍后验证</button></footer>';
  dialog.querySelector('.verification-job').textContent = job.name;
  const session = { job, dialog, image: dialog.querySelector('img'), placeholder: dialog.querySelector('.verification-placeholder'), picture: dialog.querySelector('.verification-picture'), status: dialog.querySelector('.verification-status'), zoom: dialog.querySelector('select'), operation: 0, requests: new Set(), nextReadAt: 0, failures: 0 }; current = session;
  session.zoom.addEventListener('change', () => { if (session.frame) { session.image.style.width = session.zoom.value === 'fit' ? '' : Math.round(session.frame.width * Number(session.zoom.value)) + 'px'; session.image.dataset.fit = String(session.zoom.value === 'fit'); } });
  for (const button of dialog.querySelectorAll('[data-defer]')) button.addEventListener('click', event => { event.stopPropagation(); close(true); });
  dialog.querySelector('[data-reconnect]').addEventListener('click', event => {
   event.stopPropagation(); if (session.clicking) return;
   session.operation++; session.nextReadAt = 0; session.failures = 0;
   session.status.textContent = '正在重新连接验证页面…';
   if (session.busy) { session.refreshAfterClick = true; for (const controller of session.requests) controller.abort(); } else void poll(session);
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(true); });
  session.image.addEventListener('pointerdown', event => {
   if (event.button !== 0 || session.clicking || !session.frame) return;
   session.gesture = { frame: session.frame, rect: session.image.getBoundingClientRect() };
   session.operation++; session.image.setPointerCapture(event.pointerId);
  });
  session.image.addEventListener('pointercancel', () => { session.gesture = null; });
  session.image.addEventListener('click', async event => {
   event.stopPropagation(); if (session.clicking || !session.frame || current !== session) return;
   const { frame, rect } = session.gesture || { frame: session.frame, rect: session.image.getBoundingClientRect() }; session.gesture = null;
   const x = Math.floor((event.clientX - rect.left) * frame.width / rect.width), y = Math.floor((event.clientY - rect.top) * frame.height / rect.height);
   if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return;
   session.clicking = true; session.operation++; session.status.textContent = '已发送操作，正在等待来源确认…';
   try { await request(session, 'downloads/verification-click', { id: job.id, revision: frame.revision, x, y }); }
   catch (error) { if (current === session) session.status.textContent = error.message; }
   finally { session.clicking = false; if (current === session) { session.refreshAfterClick = true; if (!session.busy) { session.refreshAfterClick = false; void poll(session); } } }
  });
  document.body.appendChild(dialog); dialog.showModal(); void poll(session); session.timer = setInterval(() => { void poll(session); }, 2000);
 }
 return {
  open,
  update(jobs) {
   for (const id of dismissed) if (!jobs.some(job => job.id === id && job.verificationRequired)) dismissed.delete(id);
   if (current) {
    const job = jobs.find(job => job.id === current.job.id);
    if (!job?.verificationRequired) { close(); if (job?.status === 'completed') toast('文件已下载完成'); }
   }
   if (!current) { const job = jobs.find(job => job.verificationRequired && !dismissed.has(job.id)); if (job) open(job); }
  },
  reset() { close(); dismissed.clear(); },
 };
}
