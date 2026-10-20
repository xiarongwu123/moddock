const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server.cjs');
const { accountFixture } = require('./account-fixture.cjs');
const { submitLogin } = require('./ui-open.cjs');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLz0AAAAASUVORK5CYII=', 'base64');

(async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-drift-wall-'));
 const service = await createServer({ root, port: 0, scan: async () => ({ games: [], roots: [], diagnostics: [] }), accounts: accountFixture().options });
 let browser;
 try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://cdn.akamai.steamstatic.com/steam/apps/**', route => route.fulfill({ contentType: 'image/png', body: image }));
  await page.goto(service.url);
  const moving = page.locator('.drift-wall__track').first();
  const start = await moving.evaluate(node => node.style.transform);
  await page.waitForFunction(value => document.querySelector('.drift-wall__track').style.transform !== value, start);
  assert.equal(await page.locator('.auth-backdrop [tabindex="0"]').count(), 0);
  assert.equal(await page.locator('.auth-backdrop').getAttribute('aria-hidden'), 'true');
  assert.equal(await page.locator('.drift-wall').getAttribute('data-paused'), 'false');
  assert.equal(await page.locator('.drift-wall img').evaluateAll(images => new Set(images.map(img => img.src)).size), 18);
  await page.waitForFunction(() => [...document.querySelectorAll('.drift-wall img')].every(img => img.complete && img.naturalWidth > 0));
  assert.equal(await page.locator('.drift-wall img').evaluateAll(images => images.every(img => new URL(img.src).origin === location.origin)), true, 'Covers should be bundled locally');
  const coverResponse = await page.request.get(service.url + '/covers/730.jpg');
  assert.equal(coverResponse.status(), 200);
  assert.equal(coverResponse.headers()['content-type'], 'image/jpeg');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('.drift-wall').dataset.paused === 'true');
  for (const viewport of [{ width: 1000, height: 700 }, { width: 1440, height: 940 }, { width: 2560, height: 1080 }, { width: 1100, height: 1500 }]) {
   await page.setViewportSize(viewport);
   await page.waitForFunction(size => document.querySelector('.drift-wall').clientWidth === size.width && document.querySelector('.drift-wall').clientHeight === size.height, viewport);
   await page.waitForFunction(() => Number.parseFloat(getComputedStyle(document.querySelector('.drift-wall__plane')).height) === Math.ceil(Math.hypot(innerWidth, innerHeight) * 1.4));
   for (const phase of [0, 0.25, 0.75, 0.999, 0.001]) {
    const rows = await page.evaluate(phase => {
     const backdrop = document.querySelector('.auth-backdrop');
     backdrop.inert = false;
     backdrop.style.pointerEvents = 'auto';
     document.querySelectorAll('.drift-wall__inner').forEach(inner => { inner.style.pointerEvents = 'auto'; });
     const tracks = [...document.querySelectorAll('.drift-wall__track')];
     const previous = tracks.map(track => track.style.transform);
     tracks.forEach((track, column) => {
      const first = track.firstElementChild;
      const repeat = [...track.children].find(tile => tile.dataset.tileId === `${column}-1-0`);
      const period = repeat.offsetTop - first.offsetTop;
      track.style.transform = `translate3d(0, ${-((phase + column * 0.17) % 1) * period}px, 0)`;
     });
     const coverage = [8, innerHeight * 0.2, innerHeight * 0.5, innerHeight * 0.8, innerHeight - 8].map(y => {
      let covered = 0, count = 0;
      for (let x = 8; x < innerWidth - 8; x += 20) {
       count++;
       if (document.elementsFromPoint(x, y).some(element => element.matches('.drift-wall__tile img'))) covered++;
      }
      return covered / count;
     });
     tracks.forEach((track, column) => { track.style.transform = previous[column]; });
     backdrop.inert = true;
     backdrop.style.pointerEvents = '';
     document.querySelectorAll('.drift-wall__inner').forEach(inner => { inner.style.pointerEvents = ''; });
     return coverage;
    }, phase);
    assert.ok(rows.every(coverage => coverage > 0.6), `Background must cover every viewport row at ${viewport.width}x${viewport.height}, phase ${phase}: ${rows}`);
   }
  }
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => document.querySelector('.drift-wall').dataset.paused === 'false');
  await submitLogin(page);
  await page.locator('.auth-swap[data-active="true"][data-transitioning="false"]').waitFor();
  assert.equal(await page.locator('.drift-wall').getAttribute('data-paused'), 'true');
  const stopped = await moving.evaluate(node => node.style.transform);
  await page.waitForTimeout(150);
  assert.equal(await moving.evaluate(node => node.style.transform), stopped);
  await page.getByLabel('账号菜单', { exact: true }).click();
  await page.getByRole('banner').getByRole('button', { name: '退出登录', exact: true }).click();
  await page.locator('.auth-swap[data-active="false"][data-transitioning="false"]').waitFor();
  assert.equal(await page.locator('.drift-wall').getAttribute('data-paused'), 'false');
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.getByRole('tab', { name: '注册', exact: true }).click();
  await page.getByLabel('邮箱地址', { exact: true }).fill('wall@example.com');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.locator('#auth-panel[data-transitioning="false"]').waitFor();
  await page.getByLabel('设置密码', { exact: true }).fill('player123');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '获取邮箱验证码', exact: true }).click();
  await page.locator('#auth-panel[data-transitioning="false"]').waitFor();
  await page.getByLabel('邮箱验证码', { exact: true }).fill('246810');
  await page.locator('.auth-swap[data-active="true"][data-transitioning="false"]').waitFor();
  await page.locator('.source-onboarding-footer').getByRole('button', { name: /^(暂时跳过|开始使用)$/ }).click();
  await page.getByRole('heading', { name: '我的游戏', exact: true }).waitFor();
  await page.getByLabel('账号菜单', { exact: true }).click();
  await page.getByRole('banner').getByRole('button', { name: '退出登录', exact: true }).click();
  await page.locator('.auth-swap[data-active="false"][data-transitioning="false"]').waitFor();
  const widths = await page.locator('.auth-swap > .auth-screen[data-visible="true"]').evaluate(node => ({ scroll: node.scrollWidth, client: node.clientWidth }));
  assert.equal(widths.scroll, widths.client, 'Decorative background must not create horizontal scrolling');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('.drift-wall').dataset.paused === 'true');
  const still = await moving.evaluate(node => node.style.transform);
  await page.waitForTimeout(150);
  assert.equal(await moving.evaluate(node => node.style.transform), still);
  await page.route('**/covers/*.jpg', route => route.fulfill({ status: 404, body: '' }));
  await page.reload();
  await page.waitForFunction(() => [...document.querySelectorAll('.drift-wall img')].every(img => img.dataset.fallback === 'true' && img.complete && img.naturalWidth > 0));
  assert.deepEqual(errors, []);
  await page.unroute('**/covers/*.jpg');
  await page.route('https://cdn.akamai.steamstatic.com/**', route => route.abort());
  await page.reload();
  await page.waitForFunction(() => [...document.querySelectorAll('.drift-wall img')].every(img => !img.dataset.fallback && img.complete && img.naturalWidth > 0));
  console.log('DriftWall UI passed: local covers work with CDN blocked; four desktop sizes stay covered across wrap phases; motion, pause, registration, reduced motion and header-image fallback.');
 } finally {
  await browser?.close();
  await new Promise(resolve => service.server.close(resolve));
  await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
