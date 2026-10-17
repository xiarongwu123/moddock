const electron = require('electron');
const { app, session } = electron;
const fs = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const application = path.resolve(process.env.MODDOCK_NETWORK_PACKAGE || '.');
const output = path.resolve(process.env.MODDOCK_NETWORK_OUTPUT || 'output/playwright/studio-network');
const { readCreationResponse } = require(path.join(application, 'studio-mu-client.cjs'));
let fixture;

async function probe(options) {
 assert(app.commandLine.hasSwitch('disable-quic'));
 await fs.mkdir(output, { recursive: true });
 const logFile = path.join(output, 'chromium-netlog.json');
 await session.defaultSession.netLog.startLogging(logFile);
 const statuses = [];
 for (let attempt = 0; attempt < 2; attempt++) {
  const response = await options.accounts.fetch('https://mu-api.claude-api.cn/api/health', { signal: AbortSignal.timeout(20000) });
  statuses.push(response.status); assert.equal(response.status, 200); await response.arrayBuffer();
 }
 fixture = http.createServer((req, res) => {
  assert.equal(req.method, 'POST'); res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  res.write('{"type":"event","event":{"type":"thinking_delta","delta":"streaming"}}\n');
  setTimeout(() => res.end('{"type":"result","result":{"complete":true}}\n'), 300);
 });
 await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
 let eventBeforeResult = false;
 const response = await options.accounts.fetch(`http://127.0.0.1:${fixture.address().port}`, { method: 'POST', body: '{}', signal: AbortSignal.timeout(10000) });
 const result = await readCreationResponse(response, () => { eventBeforeResult = true; });
 assert.deepEqual(result, { complete: true }); assert(eventBeforeResult);
 await new Promise(resolve => fixture.close(resolve)); fixture = null;
 await session.defaultSession.netLog.stopLogging();
 const log = JSON.parse(await fs.readFile(logFile, 'utf8'));
 const types = Object.fromEntries(Object.entries(log.constants.logEventTypes).map(([name, id]) => [id, name]));
 const http2 = log.events.some(event => types[event.type] === 'HTTP2_SESSION_RECV_HEADERS');
 const quicSessions = log.events.filter(event => types[event.type] === 'QUIC_SESSION').length;
 assert(http2); assert.equal(quicSessions, 0);
 const report = { passed: true, application, electron: process.versions.electron, quicDisabledBeforeReady: true, healthStatuses: statuses,
  actualHttp2Observed: http2, quicSessions, realChromiumStreamingPost: true, eventsBeforeResult: eventBeforeResult, windowsDeviceTested: false };
 await fs.writeFile(path.join(output, 'electron-verification.json'), JSON.stringify(report, null, 2));
 console.log(JSON.stringify(report));
 return { url: 'http://127.0.0.1', accountLegalUrls: {}, server: { close() {} } };
}

class TestWindow {
 constructor() { this.webContents = { on() {}, setWindowOpenHandler() {} }; }
 on() {}
 async loadURL() { setImmediate(() => app.quit()); }
}

try {
 assert(!app.isReady());
 const entry = path.join(application, 'electron.cjs'), localRequire = createRequire(entry);
 vm.runInNewContext(readFileSync(entry, 'utf8'), {
  require: name => name === 'electron' ? { ...electron, BrowserWindow: TestWindow } : name === './server.cjs' ? { createServer: options => probe(options).catch(error => { console.error(error); fixture?.closeAllConnections(); fixture?.close(); app.exit(1); return new Promise(() => {}); }) } : localRequire(name),
  __dirname: application, process,
 });
} catch (error) { console.error(error); app.exit(1); }
