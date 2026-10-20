const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('./server-fixture.cjs');
const { submitLogin } = require('./ui-open.cjs');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLz0AAAAASUVORK5CYII=', 'base64');

(async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-grid-scan-'));
 const service = await createServer({ root, port: 0, scan: async () => ({ games: [], roots: [], diagnostics: [] }) });
 let browser;
 try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = [], modelRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (request.url().includes('/weights/')) modelRequests.push(request.url()); });
  await page.route('https://cdn.akamai.steamstatic.com/steam/apps/**', route => route.fulfill({ contentType: 'image/png', body: image }));
  await page.addInitScript(() => {
   window.scanEvidence = { cameras: 0, contexts: [], handoffs: [], completions: [] };
   const getContext = HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext = function (...args) {
    const gl = getContext.apply(this, args);
    if (this.matches('.gridscan__canvas') && gl && !window.scanEvidence.contexts.some(record => record.gl === gl)) window.scanEvidence.contexts.push({ gl, canvas: this });
    return gl;
   };
   if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { window.scanEvidence.cameras++; throw new Error('Transition must not request a camera'); };
   const replaceState = history.replaceState;
   history.replaceState = function (...args) {
    const swap = document.querySelector('.auth-swap');
    if (swap && (args[2] === '#home' || window.scanEvidence.completions.length)) {
     window.scanEvidence.completions.push({ hash: args[2], active: swap.dataset.active, transitioning: swap.dataset.transitioning, overlays: document.querySelectorAll('.grid-scan-transition__overlay').length });
    }
    return replaceState.apply(this, args);
   };
   new MutationObserver(records => {
    for (const record of records) {
     if (record.attributeName !== 'data-active' || !record.target.matches('.auth-swap')) continue;
     const overlay = document.querySelector('.grid-scan-transition__overlay');
     if (overlay) window.scanEvidence.handoffs.push({ opacity: Number(getComputedStyle(overlay).opacity), phase: overlay.dataset.phase });
    }
   }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-active'] });
  });
  await page.goto(service.url);
  assert.equal(await page.locator('.gridscan').count(), 0, 'Do not run the scan before entering home');
  for (let cycle = 0; cycle < 3; cycle++) {
   await submitLogin(page);
   await page.locator('.grid-scan-transition__overlay[data-phase="scan"]').waitFor();
   assert.ok(await page.evaluate(() => [[40, 40], [innerWidth - 40, 40], [innerWidth / 2, innerHeight / 2]].every(([x, y]) => document.elementFromPoint(x, y)?.closest('.grid-scan-transition__overlay'))), 'Scan must cover fixed sidebars and all page content');
   assert.equal(await page.locator('.gridscan').getAttribute('data-renderer'), 'webgl');
   assert.equal(await page.locator('.auth-screen[data-visible="true"]').getAttribute('inert'), '');
   if (!cycle) {
    await fs.mkdir(path.resolve('output/playwright'), { recursive: true });
    await page.screenshot({ path: path.resolve('output/playwright/grid-scan-transition.png') });
   }
   await page.locator('.auth-swap[data-active="true"][data-transitioning="false"]').waitFor();
   await page.getByRole('heading', { name: '我的游戏', exact: true }).waitFor();
   assert.equal(await page.locator('.gridscan').count(), 0);
   await page.getByLabel('账号菜单', { exact: true }).click();
   await page.getByRole('banner').getByRole('button', { name: '退出登录', exact: true }).click();
   await page.locator('.auth-swap[data-active="false"][data-transitioning="false"]').waitFor();
  }
  const evidence = await page.evaluate(() => ({ ...window.scanEvidence, contexts: window.scanEvidence.contexts.map(record => ({ detached: !record.canvas.isConnected, lost: record.gl.isContextLost() })) }));
  assert.equal(evidence.cameras, 0);
  assert.deepEqual(modelRequests, []);
  assert.equal(evidence.contexts.length, 6);
  assert.ok(evidence.contexts.every(record => record.detached && record.lost), 'Completed scans must release their GPU contexts');
  assert.equal(evidence.handoffs.length, 6);
  assert.ok(evidence.handoffs.every(record => record.opacity === 1 && record.phase === 'scan'), 'Switch the real page only behind an opaque scan');
  assert.equal(evidence.completions.length, 6);
  for (const state of evidence.completions) assert.deepEqual(state, { hash: state.active === 'true' ? '#home' : '#login', active: state.active, transitioning: 'false', overlays: 0 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await submitLogin(page);
  await page.locator('.auth-swap[data-active="true"][data-transitioning="false"]').waitFor();
  assert.equal(await page.locator('.gridscan').count(), 0);
  assert.equal(await page.evaluate(() => window.scanEvidence.contexts.length), 6);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByLabel('账号菜单', { exact: true }).click();
  await page.getByRole('banner').getByRole('button', { name: '退出登录', exact: true }).click();
  await page.locator('.auth-swap[data-active="false"][data-transitioning="false"]').waitFor();
  await page.addInitScript(() => {
   const getContext = HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type === 'webgl2' ? null : getContext.call(this, type, ...args); };
  });
  await page.reload();
  await submitLogin(page);
  await page.locator('.gridscan[data-renderer="fallback"]').waitFor();
  await page.locator('.auth-swap[data-active="true"][data-transitioning="false"]').waitFor();
  assert.equal(await page.locator('.gridscan').count(), 0);
  assert.deepEqual(errors, []);
  console.log('GridScan UI passed: three entry/return scans, opaque page handoff, completion after reveal, GPU disposal, no camera/models, reduced motion and WebGL fallback.');
 } finally {
  await browser?.close();
  await new Promise(resolve => service.server.close(resolve));
  await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
