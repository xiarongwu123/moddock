const { app, net } = require('electron');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { accountFixture } = require('./account-fixture.cjs');

app.whenReady().then(async () => {
 const archive = path.resolve(process.env.MODDOCK_DOWNLOAD_PACKAGE);
 const { createAccountClient } = require(path.join(archive, 'account.cjs'));
 const upstream = accountFixture(); let edge = 0, release, pendingStarted;
 const pending = new Promise(resolve => { pendingStarted = resolve; });
 const server = http.createServer(async (req, res) => {
  const send = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  if (req.url === '/api/v1/nexus/jobs/11111111-1111-4111-8111-111111111111') { release = () => send({ status: 'completed' }); pendingStarted(); return; }
  if (req.url.endsWith('/verification')) return send({ pending: false });
  if (edge && req.url.endsWith('/account/me')) { edge--; res.writeHead(502, { 'Content-Type': 'text/html' }); res.end('<html>edge temporary error</html>'); return; }
  let body = ''; for await (const chunk of req) body += chunk;
  const response = await upstream.options.fetch('https://fixture.test' + req.url, { method: req.method, body: body || undefined, headers: req.headers });
  res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
 });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 try {
  const client = createAccountClient({ baseUrl: 'http://127.0.0.1:' + server.address().port, fetch: (url, init) => net.fetch(String(url), init), retryDelay: 1 });
  const login = await client.login({ email: 'player@example.com', password: 'player123' });
  edge = 2; await assert.rejects(client.session(login.id), error => error.code === 'account_response_unavailable');
  assert.equal((await client.session(login.id)).id, login.profile.id);
  const poll = client.nexusRequest(login.id, 'jobs/11111111-1111-4111-8111-111111111111'); await pending;
  try {
   const frame = await Promise.race([client.nexusRequest(login.id, 'jobs/11111111-1111-4111-8111-111111111111/verification'), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Verification request blocked')), 3000); timer.unref(); })]);
   assert.equal((await frame.json()).pending, false);
  } finally { release(); await poll; }
  const health = await net.fetch('https://mu-api.claude-api.cn/health', { signal: AbortSignal.timeout(20000) });
  assert.equal(health.status, 200); assert.equal((await health.json()).status, 'ok');
  const report = { muHealth: true, accountRecovery: true, nonblockingVerification: true, nativeElectronFetch: true, archive, windowsDeviceTested: false };
  await fs.writeFile(process.env.MODDOCK_DOWNLOAD_PACKAGE_REPORT, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
 } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
 app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
