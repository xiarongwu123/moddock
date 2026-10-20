const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createServer } = require('./server-fixture.cjs');
const { openHome } = require('./ui-open.cjs');

(async () => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-state-polling-'));
 const service = await createServer({ root, port: 0, scan: async () => ({ games: [], roots: [], diagnostics: [] }) });
 let browser, active = false, reads = 0;
 try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  const errors = [], resourceFailures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (new URL(response.url()).pathname.startsWith('/favicon') && response.status() >= 400) resourceFailures.push(response.url()); });
  await page.addInitScript(() => {
   window.qaPageHidden = false;
   Object.defineProperty(document, 'hidden', { get: () => window.qaPageHidden });
  });
  await page.route('**/api/state', async route => {
   reads++;
   const response = await route.fetch();
   const state = await response.json();
   state.jobs = active ? [{ id: 'polling-fixture', status: 'running', name: 'Polling fixture', source: 'banana' }] : [];
   await route.fulfill({ response, json: state });
  });
  await openHome(page, service.url);
  await page.getByRole('status').filter({ hasText: '扫描完成' }).waitFor();
  await page.waitForTimeout(100);
  const idleStart = reads;
  await page.waitForTimeout(10000);
  assert.equal(reads, idleStart, 'An idle library should not request full state every 700ms');
  const changeVisibility = hidden => page.evaluate(value => {
   window.qaPageHidden = value;
   document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await changeVisibility(true);
  active = true;
  const resumed = page.waitForResponse(response => response.url() === service.url + '/api/state' && response.ok());
  await changeVisibility(false); await resumed;
  await page.locator('.tiny-dot').waitFor();
  const activeStart = reads;
  await page.waitForTimeout(1700);
  assert.ok(reads >= activeStart + 2, 'Active tasks must retain responsive progress updates');
  const activeRequests = reads - activeStart;
  await changeVisibility(true);
  await page.waitForTimeout(100);
  const hiddenStart = reads;
  await page.waitForTimeout(1700);
  assert.equal(reads, hiddenStart, 'Hidden-page notifications must pause background state polling');
  active = false;
  const resumedIdle = page.waitForResponse(response => response.url() === service.url + '/api/state' && response.ok());
  await changeVisibility(false); await resumedIdle;
  await page.locator('.tiny-dot').waitFor({ state: 'detached' });
  const idleAgain = reads;
  await page.waitForTimeout(1700);
  assert.equal(reads, idleAgain, 'Finished tasks must return to idle polling');
  assert.deepEqual(errors, []); assert.deepEqual(resourceFailures, []);
  const output = path.resolve(__dirname, '../output/playwright');
  await fs.mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'state-polling.png') });
  const result = { idleSeconds: 10, idleRequests: 0, activeSeconds: 1.7, activeRequests, hiddenSeconds: 1.7, hiddenRequests: 0, resumesImmediately: true, returnsToIdle: true, visibilityNotificationSimulated: true, resourceFailures, pageErrors: errors };
  await fs.writeFile(path.join(output, 'state-polling.json'), JSON.stringify(result, null, 2));
  console.log('State polling UI passed: ' + JSON.stringify(result));
 } finally {
  await browser?.close();
  service.server.closeAllConnections();
  await new Promise(resolve => service.server.close(resolve));
  await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
