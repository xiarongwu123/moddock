const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');

(async () => {
 const origin = process.env.MODDOCK_PI_BROWSER_ORIGIN || 'http://127.0.0.1:18101';
 const credentials = JSON.parse(await fs.readFile(process.env.MODDOCK_PI_BROWSER_CREDENTIALS, 'utf8')).credentials;
 const output = path.resolve('output/playwright/pi-agent-live'); await fs.mkdir(output, { recursive: true });
 const browser = await chromium.launch({ channel: 'chrome', headless: true });
 try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin); await page.locator('.boot-splash').waitFor({ state: 'hidden' });
  await page.getByLabel('邮箱地址', { exact: true }).fill(credentials.email);
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByLabel('密码', { exact: true }).waitFor(); await page.locator('#auth-panel[data-transitioning="false"]').waitFor();
  await page.getByLabel('密码', { exact: true }).fill(credentials.password); await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('.auth-swap[data-active="true"][data-transitioning="false"]').waitFor();
  await page.locator('[data-nav="studio"]').first().click(); await page.locator('[data-studio-pick]').first().click(); await page.locator('[data-studio-action="start"]').click();
  await page.locator('#studio-idea').fill('制作一个中国风人物跟随者，姓名和一句问候由你决定。只复用现有角色资源，不制作新模型或完整剧情。'); await page.locator('#studio-idea').press('Enter');
  const progress = page.getByRole('region', { name: '创作进度' });
  await progress.waitFor({ timeout: 30000 });
  await progress.locator(':scope > details > summary').click();
  await page.waitForFunction(() => document.querySelector('[data-help-key^="studio:thinking:"]'), null, { timeout: 180000 });
  await page.locator('[data-help-key^="studio:thinking:"] > summary').click();
  await progress.screenshot({ path: path.join(output, 'thinking.png') });
  await page.waitForFunction(() => document.querySelector('.studio-process[data-status=completed]') || document.querySelector('.studio-error[role=alert]'), null, { timeout: 360000 });
  const error = await page.locator('.studio-error[role=alert]').allTextContents(); assert.equal(error.length, 0, error.join('\n'));
  assert.equal(await progress.getAttribute('data-status'), 'completed');
  assert.ok(await page.getByText('整理创作结果', { exact: true }).count());
  assert.doesNotMatch(await progress.textContent(), /Pi Agent|pi-agent|\bSkill\b|\bAgent\b/);
  assert.ok((await page.locator('[data-help-key^="studio:thinking:"] p').allTextContents()).some(text => text.trim().length > 10));
  await progress.locator(':scope > details > summary').click();
  await page.getByRole('region', { name: '生成结果' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'completed.png') });
  assert.deepEqual(errors, []);
  const report = { passed: true, realModelUsed: true, piHarness: true, gameFixture: true, gameRuntimeVerified: false,
   release: process.env.MODDOCK_PI_RELEASE, toolCalls: await page.locator('.studio-process-step strong').allTextContents(), source: 'isolated real MU account service and real Pi provider' };
  await fs.writeFile(path.join(output, 'browser-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
 } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
