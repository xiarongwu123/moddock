// Run only against the guarded isolated MU acceptance account, through SSH.
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createServer } = require('../server.cjs');
(async () => {
 const fixture = JSON.parse(await fs.readFile(process.env.MODDOCK_AI_REAL_ACCOUNT_FILE, 'utf8'));
 assert.match(fixture.owner, /^quota-[a-f0-9]+-pro$/);
 const expected = Number(process.env.MODDOCK_AI_EXPECT_USED || 1000000);
 assert.ok(Number.isSafeInteger(expected) && expected >= 0 && expected <= 1000000);
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-cloud-browser-'));
 const service = await createServer({ root, port: 0, nexusPlatformDisabled: true, scan: async () => ({ games: [], diagnostics: [] }),
  accounts: { baseUrl: 'http://127.0.0.1:18098', fetch: (url, init) => fetch(url, { ...init, headers: { ...init.headers, 'X-Forwarded-Proto': 'https' } }) } });
 let browser;
 try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(service.url);
  await page.locator('.boot-splash').waitFor({ state: 'hidden' });
  await page.getByLabel('邮箱地址', { exact: true }).fill(fixture.credentials.email);
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.locator('#auth-panel[data-transitioning="false"]').waitFor();
  await page.getByLabel('密码', { exact: true }).fill(fixture.credentials.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.locator('.auth-swap[data-active="true"][data-transitioning="false"]').waitFor();
  await page.locator('.account-menu summary').click();
  await page.locator('[data-nav="account"]').first().click();
  await page.locator('.user-center-controls [data-membership-open]').click();
  await expect(page.locator('.membership-dialog')).toContainText('Pro 会员已开通');
  await expect(page.locator('.membership-quota')).toContainText('1,000,000');
  await expect(page.locator('.membership-quota')).toContainText('剩余 ' + (1000000 - expected).toLocaleString('en-US') + ' token');
  await expect(page.locator('.membership-quota')).toContainText(expected.toLocaleString('en-US'));
  const output = path.join(__dirname, '../output/playwright/ai-quota-real'); await fs.mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, expected === 1000000 ? 'exhausted.png' : 'provider-usage.png') });
  const quota = await page.evaluate(() => fetch('/api/account/ai-usage').then(r => r.json()));
  assert.equal(quota.account.id, fixture.owner); assert.equal(quota.quota.usedTokens, expected);
  assert.equal(quota.quota.remainingTokens, 1000000 - expected); assert.equal(quota.local.totalTokens, 0);
  if (expected === 1000000) {
   const denied = await page.evaluate(async () => {
    const config = await fetch('/api/auth/config').then(r => r.json());
    const response = await fetch('/api/studio/conversations/send', { method: 'POST', headers: { 'X-Moddock-Token': config.token }, body: '{}' });
    return { status: response.status, code: (await response.json()).code };
   });
   assert.deepEqual(denied, { status: 403, code: 'ai_credits_exhausted' });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: real MU login, authoritative quota ' + expected + ', remaining ' + (1000000 - expected) + ', separate device journal and browser rendering');
 } finally {
  await browser?.close(); await new Promise(resolve => service.server.close(resolve));
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
