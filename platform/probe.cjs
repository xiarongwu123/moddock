const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: wait } = require('node:timers/promises');
(async () => {
 const root = process.env.MODDOCK_NEXUS_SERVICE_DATA, config = JSON.parse(await fs.readFile(path.join(root, 'client.json'), 'utf8'));
 const call = (route, init = {}) => fetch(config.url + route, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Authorization: 'Bearer ' + config.accessToken, 'X-Mu-Account-Id': 'operator', 'Content-Type': 'application/json' } });
 const status = await call('/status'); if (!status.ok) throw new Error('Backend is unavailable');
 if (process.argv[2] === '--status') { console.log(JSON.stringify(await status.json())); return; }
 if (process.argv[2] === '--maintenance') { console.log(JSON.stringify(await (await call('/maintenance')).json())); const picture = await call('/maintenance/screenshot'); if (picture.ok) await fs.writeFile(path.join(root, 'maintenance.png'), Buffer.from(await picture.arrayBuffer()), { mode: 0o600 }); return; }
 const previous = process.argv[2] === '--last' ? JSON.parse(await fs.readFile(path.join(root, 'probe-job.json'), 'utf8')) : null;
 const response = previous ? await call('/jobs/' + previous.id) : await call('/jobs', { method: 'POST', body: JSON.stringify({ domain: 'baldursgate3', modId: '141', fileId: '9433' }) });
 if (!response.ok) throw new Error('Backend refused probe file');
 let job = await response.json(); await fs.writeFile(path.join(root, 'probe-job.json'), JSON.stringify({ id: job.id }), { mode: 0o600 });
 for (let n = 0; n < 40 && !['completed', 'failed', 'cancelled'].includes(job.status); n++) { await wait(2000); job = await (await call('/jobs/' + job.id)).json(); }
 if (job.status !== 'completed') { console.log(JSON.stringify({ id: job.id, status: job.status, message: job.message })); process.exitCode = 2; return; }
 const file = await call('/jobs/' + job.id + '/file'); if (!file.ok) throw new Error('Probe file unavailable');
 const bytes = Buffer.from(await file.arrayBuffer()), hash = crypto.createHash('sha256').update(bytes).digest('hex');
 if (hash !== job.sha256 || bytes.length !== job.size) throw new Error('Probe bytes do not match metadata');
 await fs.writeFile(path.join(root, 'probe-file.zip'), bytes, { mode: 0o600 });
 console.log(JSON.stringify({ id: job.id, status: job.status, bytes: bytes.length, sha256: hash, verified: true }));
})().catch(() => { console.error('Backend probe failed'); process.exitCode = 1; });
