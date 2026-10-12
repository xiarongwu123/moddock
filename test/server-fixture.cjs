const { createServer: createLocalServer } = require('../server.cjs');
const { accountFixture } = require('./account-fixture.cjs');

function createServer(options = {}) {
 return createLocalServer({ ...options, accounts: options.accounts || accountFixture().options });
}
async function loginFixture(service) {
 const config = await fetch(service.url + '/api/auth/config').then(response => response.json());
 const response = await fetch(service.url + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Moddock-Token': config.token },
  body: JSON.stringify({ email: 'player@example.com', password: 'player123' }),
 });
 if (!response.ok) throw new Error('Fixture login failed');
 const cookie = response.headers.getSetCookie().find(value => /Path=\/api(?:;|$)/.test(value)).split(';')[0];
 const authenticatedFetch = (url, init = {}) => fetch(url, { ...init, headers: { ...init.headers, Cookie: cookie } });
 const state = await authenticatedFetch(service.url + '/api/state').then(result => result.json());
 return { fetch: authenticatedFetch, state };
}
module.exports = { createServer, loginFixture };
