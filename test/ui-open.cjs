async function openHome(page, url) {
 await page.goto(url);
 await submitLogin(page);
 await page.locator('.auth-swap[data-active="true"][data-transitioning="false"]').waitFor();
}
async function submitLogin(page) {
 await page.locator('.boot-splash').waitFor({ state: 'hidden' });
 await page.getByRole('heading', { name: '欢迎回到游匣', exact: true }).waitFor();
 await page.getByLabel('邮箱地址', { exact: true }).fill('player@example.com');
 await page.getByRole('button', { name: '下一步', exact: true }).click();
 await page.getByLabel('密码', { exact: true }).waitFor();
 await page.locator('#auth-panel[data-transitioning="false"]').waitFor();
 await page.getByLabel('密码', { exact: true }).fill('player123');
 await page.getByRole('button', { name: '登录', exact: true }).click();
}
module.exports = { openHome, submitLogin };
