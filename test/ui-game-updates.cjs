// Standalone component QA: does not depend on the workspace's prebuilt auth.js.
const { chromium } = require('@playwright/test');
const { build } = require('esbuild');
const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
 const bundled = await build({ stdin: { contents: `
  import {gameUpdateNotice,checkingUpdates} from './public/game-update-notice.js';
  import {createModManager} from './public/mod-manager.js';
  window.qa={gameUpdateNotice,checkingUpdates,createModManager};`, resolveDir: path.resolve(__dirname, '..') }, bundle: true, write: false, format: 'iife' });
 const browser = await chromium.launch({ channel: 'chrome', headless: true });
 try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<main></main>'); await page.addScriptTag({ content: bundled.outputFiles[0].text });
  await page.evaluate(() => {
   const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
   const game = { id: 'steam-1', name: 'Sample Game', platform: 'Steam', installPath: 'C:/fixture' };
   const mod = { id: 'm', gameId: game.id, name: '<Test Mod>', status: 'enabled', files: [], update: { status: 'review', files: [{ id: '2' }] } };
   const data = { sourceGames: [game], jobs: [], installations: { mods: [mod], runs: [], loadouts: [] }, gameUpdates: [{ gameId: game.id, gameName: game.name, from: '100', to: '200', mods: [mod], loaders: ['UE4SS'] }] };
   window.draw = () => {
    const manager = qa.createModManager({ data: () => data, esc, icon: () => '', cover: () => '', empty: () => '', render: () => {}, openModal: () => {}, runCard: () => '', ruleEvidence: () => '', updatePanel: () => '' });
    document.querySelector('main').innerHTML = manager.render();
   };
   window.draw();
  });
  await page.getByText('Sample Game 已更新，Mod / 加载器可能失效', { exact: true }).waitFor();
  assert.ok((await page.locator('.game-update-notice').innerText()).includes('100 → 200'));
  assert.ok((await page.locator('.game-update-notice').innerText()).includes('UE4SS'));
  assert.ok((await page.locator('.game-update-notice').innerText()).includes('<Test Mod>'));
  assert.equal(await page.locator('.game-update-notice Test').count(), 0);
  await page.getByRole('button', { name: '有文件需核对', exact: true }).waitFor();
  await page.evaluate(() => { qa.checkingUpdates.add('steam-1'); window.draw(); });
  assert.ok(await page.getByRole('button', { name: '检查中…', exact: true }).isDisabled());
  await page.evaluate(() => { qa.checkingUpdates.clear(); window.draw(); });
  assert.ok(await page.getByRole('button', { name: '检查 Mod 更新', exact: true }).isEnabled());
  assert.deepEqual(errors, []);
  console.log('UI passed: persistent build notice, affected names, loader warning, candidate label, duplicate-click prevention, escaped source text.');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
