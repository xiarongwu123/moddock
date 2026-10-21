const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { createServer } = require('../server.cjs');
const { accountFixture } = require('./account-fixture.cjs');
const { openHome } = require('./ui-open.cjs');
(async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'membership-ui-')), upstream = accountFixture();
 const accounts = { ...upstream.options, fetch: async (url, init) => {
  if (new URL(url).pathname.endsWith('/plans')) return Response.json({ items: [{ id: 'fixture-pro', name: 'Pro', durationDays: 30, priceMinor: 990, currency: 'CNY' }, { id: 'fixture-lifetime', name: '终身会员', durationDays: 0, priceMinor: 4990, currency: 'CNY' }], paymentsEnabled: false });
  return upstream.options.fetch(url, init);
 } };
 const service = await createServer({ root, port: 0, nexusPlatformDisabled: true, scan: async () => ({ games: [], diagnostics: [] }), accounts });
 let browser;
 try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openHome(page, service.url);
  await page.locator('[data-nav="studio"]').first().click();
  await expect(page.locator('[data-membership-pitch]')).toContainText('每月 100 万 token');
  await expect(page.locator('[data-studio-prompt]')).toHaveCount(0);
  const output = process.env.MODDOCK_QA_OUTPUT || path.join(os.tmpdir(), 'moddock-membership-qa');
  await fs.mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'marketing.png') });
  await page.locator('[data-membership-open]').first().click();
  await expect(page.locator('.membership-dialog')).toContainText('支付暂未开放');
  for (const button of await page.locator('[data-membership-plan]').all()) await expect(button).toBeDisabled();
  await expect(page.locator('.membership-plans')).toContainText('长期有效');
  await expect(page.locator('.membership-plans')).not.toContainText('/ 0 天');
  await expect(page.locator('.membership-quota')).toContainText('额度待配置');
  upstream.updateAccount({ membership: { tier: 'pro', expiresAt: null }, aiUsage: { limitTokens: 1000000, usedTokens: 32000, periodStart: new Date(Date.now() - 86400000).toISOString(), periodEnd: new Date(Date.now() + 86400000 * 29).toISOString() } });
  await page.locator('[data-membership-refresh]').click();
  await expect(page.locator('.membership-quota')).toContainText('32,000');
  await expect(page.locator('.membership-quota')).toContainText('968,000');
  await page.screenshot({ path: path.join(output, 'pro-quota.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('.membership-dialog').evaluate(node => node.scrollWidth <= node.clientWidth), true);
  await page.keyboard.press('Escape'); await expect(page.locator('.membership-dialog')).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.locator('.account-menu summary').click(); await page.locator('[data-nav="account"]').first().click();
  await page.locator('.user-center-controls [data-membership-open]').click();
  await expect(page.locator('.membership-dialog')).toContainText('Pro 会员已开通');
  await page.keyboard.press('Tab'); assert.equal(await page.locator('.membership-dialog').evaluate(node => node.contains(document.activeElement)), true);
  await page.keyboard.press('Escape'); await expect(page.locator('.membership-dialog')).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log('PASS: standard marketing, hidden AI composer, plans/payment disabled, Pro quota refresh, 390px layout, account entry, focus and Escape');
 } finally { await browser?.close(); await new Promise(resolve => service.server.close(resolve)); await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
