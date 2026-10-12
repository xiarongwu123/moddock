const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server.cjs');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLz0AAAAASUVORK5CYII=', 'base64');

(async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-reflective-card-'));
 const service = await createServer({ root, port: 0, scan: async () => ({ games: [], roots: [], diagnostics: [] }) });
 let browser;
 try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://cdn.akamai.steamstatic.com/steam/apps/**', route => route.fulfill({ contentType: 'image/png', body: image }));
  await page.addInitScript(() => {
   window.cameraRequests = 0;
   window.authRouteChanges = [];
   window.resizeAlphas = [];
   window.authStepAnimations = [];
   window.fuzzyOffsets = [];
   const drawImage = CanvasRenderingContext2D.prototype.drawImage;
   CanvasRenderingContext2D.prototype.drawImage = function (...args) {
    if (this.canvas.matches?.('.auth-brand-fuzzy') && args.length === 9) window.fuzzyOffsets.push(args[5]);
    return drawImage.apply(this, args);
   };
   const animate = Element.prototype.animate;
   Element.prototype.animate = function (frames, options) {
    if (this.id === 'auth-panel') window.authStepAnimations.push({ frames, duration: options.duration, inputs: this.querySelectorAll('input').length });
    return animate.call(this, frames, options);
   };
   const replaceState = history.replaceState;
   history.replaceState = function (...args) {
    window.authRouteChanges.push(args[2]);
    return replaceState.apply(this, args);
   };
   const Observer = ResizeObserver;
   window.ResizeObserver = class extends Observer {
    constructor(callback) {
     super((entries, observer) => {
      callback(entries, observer);
      for (const { target } of entries) {
       if (!target.matches('.reflective-card__body') || target.parentElement.dataset.renderer !== 'webgl') continue;
       const canvas = target.querySelector('canvas');
       const gl = canvas.getContext('webgl2');
       const pixel = new Uint8Array(4);
       gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
       window.resizeAlphas.push(pixel[3]);
      }
     });
    }
   };
   if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { window.cameraRequests++; throw new Error('Camera must remain off for login'); };
  });
  await page.goto(service.url);
  await page.locator('.boot-splash').waitFor({ state: 'hidden' });
  const card = page.locator('.auth-reflective-card');
  const centered = async () => {
   const geometry = await card.evaluate(node => { const box = node.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width, bottom: box.bottom, viewport: [innerWidth, innerHeight] }; });
   assert.ok(Math.abs(geometry.x - geometry.viewport[0] / 2) < 1);
   assert.ok(Math.abs(geometry.y - geometry.viewport[1] / 2) < 1, JSON.stringify(geometry));
   assert.equal(geometry.width, 430);
   assert.ok(geometry.bottom <= geometry.viewport[1]);
  };
  const shuffledTitle = async expected => {
   await page.getByRole('heading', { name: expected, exact: true }).waitFor();
   await page.locator('.auth-title-shuffle[data-shuffle-state="running"]').waitFor();
   const running = await page.locator('.auth-title-shuffle').evaluate(node => ({ strips: node.querySelectorAll('[data-start-x]').length, transforms: [...node.querySelectorAll('[data-start-x]')].map(strip => strip.style.transform), font: getComputedStyle(node).fontSize, width: node.getBoundingClientRect().width, available: node.closest('.auth-form-heading').clientWidth }));
   assert.equal(running.strips, [...expected].length);
   assert.equal(running.font, '24px');
   assert.ok(await page.locator('.auth-title-shuffle').evaluate(node => getComputedStyle(node).fontFamily.includes('Fusion Pixel')));
   assert.ok(await page.evaluate(text => document.fonts.check('24px "Fusion Pixel"', text), expected), 'Bundled Chinese pixel font must be loaded before splitting');
   assert.ok(running.width <= running.available, 'Chinese Shuffle title must fit inside the card');
   await page.waitForFunction(before => [...document.querySelectorAll('.auth-title-shuffle [data-start-x]')].some((node, index) => node.style.transform !== before[index]), running.transforms);
   await page.locator('.auth-title-shuffle[data-shuffle-state="complete"]').waitFor();
   assert.equal(await page.locator('.auth-title-shuffle').innerText(), expected);
   assert.equal(await page.locator('.auth-title-shuffle .shuffle-char').count(), [...expected].length, 'Finished shuffle must remove duplicate glyphs');
   await centered();
  };
  await shuffledTitle('欢迎回到游匣');
  await centered();
  const branding = await page.locator('.auth-brand').evaluate(node => {
   const box = node.getBoundingClientRect();
   return { center: box.x + box.width / 2, font: parseFloat(getComputedStyle(node).fontSize) };
  });
  assert.ok(Math.abs(branding.center - 720) < 1);
  assert.equal(branding.font, 30);
  assert.equal(await page.getByRole('img', { name: '游匣 MODDOCK', exact: true }).count(), 1);
  const logo = page.locator('.auth-brand-fuzzy');
  await page.locator('.auth-brand-fuzzy[data-ready="true"][data-animating="true"]').waitFor();
  const logoSize = await logo.evaluate(node => ({ backing: node.width, display: parseFloat(node.style.width), scale: devicePixelRatio }));
  assert.equal(logoSize.backing, Math.ceil(logoSize.display * logoSize.scale), 'FuzzyText must render at the display pixel ratio');
  const stillFrame = await logo.evaluate(node => node.toDataURL());
  await page.waitForFunction(previous => document.querySelector('.auth-brand-fuzzy').toDataURL() !== previous, stillFrame);
  await page.evaluate(() => { window.fuzzyOffsets = []; });
  await page.waitForFunction(() => window.fuzzyOffsets.length > 60);
  const idleSpread = await page.evaluate(() => Math.max(...window.fuzzyOffsets.map(Math.abs)));
  await page.evaluate(() => { window.fuzzyOffsets = []; });
  await logo.hover();
  await page.waitForFunction(spread => window.fuzzyOffsets.some(value => Math.abs(value) > spread), idleSpread);
  await page.mouse.move(0, 0);
  assert.equal(await page.getByText('前端预览', { exact: true }).count(), 0);
  assert.equal(await page.locator('.auth-form-heading p').count(), 0, 'Email step should not include introductory copy');
  await page.setViewportSize({ width: 1000, height: 700 });
  await centered();
  await page.waitForFunction(() => {
   const canvas = document.querySelector('.reflective-card__canvas');
   return canvas.height === Math.round(canvas.parentElement.offsetHeight * Math.min(devicePixelRatio, 2));
  });
  await page.getByLabel('邮箱地址', { exact: true }).fill('inline@example.com');
  await page.evaluate(() => {
   const card = document.querySelector('.auth-reflective-card');
   const canvas = card.querySelector('canvas');
   window.inlineBaseline = { card, canvas, backdrop: document.querySelector('.drift-wall'), track: document.querySelector('.drift-wall__track'), email: document.querySelector('#auth-email'), bounds: card.getBoundingClientRect().toJSON(), width: canvas.width, height: canvas.height, context: canvas.getContext('webgl2'), routes: window.authRouteChanges.length };
  });
  const unchanged = async () => {
   const stable = await page.evaluate(() => {
    const old = window.inlineBaseline;
    const card = document.querySelector('.auth-reflective-card');
    const canvas = card.querySelector('canvas');
    return {
     nodes: old.card === card && old.canvas === canvas && old.backdrop === document.querySelector('.drift-wall') && old.track === document.querySelector('.drift-wall__track') && old.email === document.querySelector('#auth-email'),
     bounds: JSON.stringify(old.bounds) === JSON.stringify(card.getBoundingClientRect().toJSON()),
     canvas: old.width === canvas.width && old.height === canvas.height && old.context === canvas.getContext('webgl2'),
     routes: old.routes === window.authRouteChanges.length,
     scans: document.querySelectorAll('.grid-scan-transition__overlay').length
    };
   });
   assert.deepEqual(stable, { nodes: true, bounds: true, canvas: true, routes: true, scans: 0 });
   assert.equal(new URL(page.url()).hash, '#login');
   assert.equal(await page.getByLabel('邮箱地址', { exact: true }).inputValue(), 'inline@example.com');
  };
  await page.getByRole('tab', { name: '注册', exact: true }).click();
  await shuffledTitle('创建你的游匣账号');
  await unchanged();
  await page.getByRole('tab', { name: '登录', exact: true }).click();
  await shuffledTitle('欢迎回到游匣');
  await unchanged();
  for (let cycle = 0; cycle < 3; cycle++) {
   await page.getByRole('tab', { name: '注册', exact: true }).click();
   await unchanged();
   await page.getByRole('tab', { name: '登录', exact: true }).click();
   await unchanged();
   await page.getByRole('tab', { name: '登录', exact: true }).press('ArrowRight');
   await unchanged();
   await page.getByRole('tab', { name: '注册', exact: true }).press('ArrowLeft');
   await unchanged();
  }
  const singleStep = async label => {
   await page.getByLabel(label, { exact: true }).waitFor();
   await page.locator('#auth-panel[data-transitioning="false"]').waitFor();
   assert.equal(await page.locator('#auth-panel input:visible').count(), 1, 'Every step must show exactly one input');
   assert.equal(await page.getByLabel(label, { exact: true }).evaluate(node => document.activeElement === node), true);
   await centered();
   const height = await card.evaluate(node => node.getBoundingClientRect().height);
   assert.equal(height, await page.evaluate(() => window.inlineBaseline.bounds.height), 'Changing steps must not resize the card');
   assert.equal(new URL(page.url()).hash, '#login');
  };
  await page.getByLabel('邮箱地址', { exact: true }).fill('');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByText('请输入有效的邮箱地址', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('邮箱地址', { exact: true }).getAttribute('aria-invalid'), 'true');
  await page.getByLabel('邮箱地址', { exact: true }).fill('card@example.com');
  await page.getByLabel('邮箱地址', { exact: true }).press('Enter');
  await page.locator('#auth-panel[data-transitioning="true"]').waitFor();
  assert.equal(await page.locator('#auth-panel').getAttribute('inert'), '');
  assert.equal(await page.getByRole('button', { name: '本地游戏库', exact: true }).isEnabled(), false);
  await page.locator('#auth-panel form').dispatchEvent('submit');
  await singleStep('密码');
  assert.equal(await page.locator('.auth-title-shuffle').count(), 0, 'Password heading should retain its normal text');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByText('请输入密码', { exact: true }).waitFor();
  await page.getByLabel('密码', { exact: true }).fill('player123');
  await page.getByRole('button', { name: '上一步', exact: true }).click();
  await singleStep('邮箱地址');
  assert.equal(await page.getByLabel('邮箱地址', { exact: true }).inputValue(), 'card@example.com');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await singleStep('密码');
  assert.equal(await page.getByLabel('密码', { exact: true }).inputValue(), 'player123');
  await page.getByRole('button', { name: '显示密码', exact: true }).click();
  assert.equal(await page.getByLabel('密码', { exact: true }).getAttribute('type'), 'text');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('.auth-swap[data-active="true"][data-transitioning="false"]').waitFor();
  await page.locator('.auth-brand-fuzzy[data-animating="false"]').waitFor({ state: 'attached' });
  const pausedLogo = await logo.evaluate(node => node.toDataURL());
  await page.waitForTimeout(100);
  assert.equal(await logo.evaluate(node => node.toDataURL()), pausedLogo, 'Logo should stop drawing while home is visible');
  assert.match(await page.locator('.profile-text').innerText(), /card/);
  await page.getByRole('button', { name: '返回登录页面', exact: true }).click();
  await page.locator('.auth-swap[data-active="false"][data-transitioning="false"]').waitFor();
  await page.locator('.auth-brand-fuzzy[data-animating="true"]').waitFor();
  await centered();
  await page.getByRole('tab', { name: '注册', exact: true }).click();
  await singleStep('邮箱地址');
  await page.getByLabel('邮箱地址', { exact: true }).fill('register@example.com');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await singleStep('设置密码');
  await page.getByLabel('设置密码', { exact: true }).fill('123');
  await page.getByRole('button', { name: '获取邮箱验证码', exact: true }).click();
  await page.getByText('密码需为 8–64 位，包含字母和数字', { exact: true }).waitFor();
  await page.getByLabel('设置密码', { exact: true }).fill('player123');
  await page.getByRole('button', { name: '获取邮箱验证码', exact: true }).click();
  await singleStep('邮箱验证码');
  assert.equal(await page.getByText('输入完整验证码后自动注册', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('note').isVisible(), false, 'Verification help must not be displayed by default');
  const help = page.getByLabel('验证码帮助', { exact: true });
  await help.click();
  assert.equal(await page.getByRole('note').isVisible(), true);
  assert.match(await page.getByRole('note').innerText(), /246810/);
  await centered();
  assert.equal(await card.evaluate(node => node.getBoundingClientRect().height), await page.evaluate(() => window.inlineBaseline.bounds.height), 'Help must not resize the card');
  await help.press('Escape');
  assert.equal(await page.getByRole('note').isVisible(), false);
  assert.equal(new URL(page.url()).hash, '#login', 'Verification stays inside the same account page');
  await page.getByLabel('邮箱验证码', { exact: true }).fill('111111');
  await page.getByText('验证码不正确，请重新输入', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.code-slots__slot[data-filled]').length === 0);
  assert.equal(await page.locator('.auth-swap').getAttribute('data-active'), 'false');
  await page.getByRole('button', { name: '上一步', exact: true }).click();
  await singleStep('设置密码');
  await page.getByRole('button', { name: '获取邮箱验证码', exact: true }).click();
  await singleStep('邮箱验证码');
  assert.equal(await page.getByRole('button', { name: '完成注册并进入', exact: true }).count(), 0);
  await page.getByLabel('邮箱验证码', { exact: true }).fill('24681');
  assert.equal(await page.locator('.auth-swap').getAttribute('data-active'), 'false', 'Partial code must not register');
  await page.getByLabel('邮箱验证码', { exact: true }).press('0');
  await page.locator('.auth-swap[data-active="true"][data-transitioning="false"]').waitFor();
  assert.equal(new URL(page.url()).hash, '#home');
  assert.match(await page.locator('.profile-text').innerText(), /register/);
  const animations = await page.evaluate(() => window.authStepAnimations);
  assert.equal(animations.length, 14, 'Seven step changes should each have one exit and one entrance');
  for (let index = 0; index < animations.length; index += 2) {
   const outgoing = animations[index], incoming = animations[index + 1];
   assert.equal(outgoing.duration, 110); assert.equal(incoming.duration, 220);
   assert.equal(outgoing.inputs, 1); assert.equal(incoming.inputs, 1);
   assert.equal(outgoing.frames[1].opacity, 0); assert.equal(incoming.frames[0].opacity, 0);
   assert.equal(incoming.frames[1].opacity, 1);
   assert.ok(outgoing.frames[1].transform === 'translateX(-14px)' && incoming.frames[0].transform === 'translateX(14px)' || outgoing.frames[1].transform === 'translateX(14px)' && incoming.frames[0].transform === 'translateX(-14px)');
  }
  assert.equal(animations[2].frames[1].transform, 'translateX(14px)', 'Back should reverse the slide direction');
  assert.equal(await page.evaluate(() => window.cameraRequests), 0);
  const resizeAlphas = await page.evaluate(() => window.resizeAlphas);
  assert.ok(resizeAlphas.every(alpha => alpha > 0), `Resizing must repaint before presentation: ${resizeAlphas}`);
  await page.addInitScript(() => {
   const getContext = HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type === 'webgl2' ? null : getContext.call(this, type, ...args); };
  });
  await page.reload();
  await page.locator('.boot-splash').waitFor({ state: 'hidden' });
  await page.locator('.auth-reflective-card[data-renderer="fallback"]').waitFor();
  await centered();
  assert.ok(await page.getByRole('button', { name: '下一步', exact: true }).isEnabled());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.auth-brand-fuzzy[data-animating="false"]').waitFor();
  const reducedLogo = await logo.evaluate(node => node.toDataURL());
  await page.waitForTimeout(100);
  assert.equal(await logo.evaluate(node => node.toDataURL()), reducedLogo, 'Reduced motion should keep the logo static');
  await page.getByLabel('邮箱地址', { exact: true }).fill('reduced@example.com');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.locator('#auth-panel[data-transitioning="false"]').waitFor();
  await page.getByLabel('密码', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.authStepAnimations.length), 0, 'Reduced motion skips step animations');
  await page.getByRole('tab', { name: '注册', exact: true }).click();
  await page.locator('.auth-title-shuffle[data-shuffle-state="complete"]').waitFor();
  assert.equal(await page.locator('.auth-title-shuffle .shuffle-char').count(), 0, 'Reduced motion leaves the title unsplit');
  assert.equal(await page.getByRole('heading', { name: '创建你的游匣账号', exact: true }).isVisible(), true);
  assert.deepEqual(errors, []);
  console.log('Auth UI passed: FuzzyText logo motion, hover intensity, 2x rendering, pause/resume and reduced motion; Shuffle titles, stable steps, automatic registration and WebGL fallback.');
 } finally {
  await browser?.close();
  await new Promise(resolve => service.server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
