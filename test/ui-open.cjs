async function openHome(page, url) {
 await page.goto(url);
 await page.getByRole('button', { name: '本地游戏库', exact: true }).click();
 await page.locator('.auth-swap[data-active="true"][data-transitioning="false"]').waitFor();
}
module.exports = { openHome };
