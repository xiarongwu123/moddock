const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
(async () => {
 const root = process.env.MU_ACCOUNT_ROOT, backendRoot = process.env.MODDOCK_NEXUS_SERVICE_DATA;
 if (!root || !backendRoot || !path.isAbsolute(root) || !path.isAbsolute(backendRoot)) throw new Error('Private deployment paths required');
 const config = JSON.parse(await fs.readFile(path.join(backendRoot, 'client.json'), 'utf8'));
 if (!/^http:\/\/172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}:8095$/.test(config.url) || !/^[a-f0-9]{64}$/.test(config.accessToken)) throw new Error('Invalid private backend configuration');
 const envFile = path.join(root, '.env'), previous = await fs.readFile(envFile, 'utf8');
 const stamp = new Date().toISOString().replace(/[-:.]/g, ''), backup = path.join(root, 'backups', 'nexus-config-' + stamp);
 await fs.mkdir(backup, { recursive: true, mode: 0o700 }); await fs.writeFile(path.join(backup, 'env.before'), previous, { mode: 0o600 });
 const next = previous.split('\n').filter(line => !/^Nexus__(BackendUrl|BackendToken|BackendHost)=/.test(line)).join('\n').replace(/\n*$/, '\n') + `Nexus__BackendUrl=${config.url}\nNexus__BackendToken=${config.accessToken}\n`;
 const temporary = envFile + '.nexus-next'; await fs.writeFile(temporary, next, { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, envFile);
 const hash = value => crypto.createHash('sha256').update(value).digest('hex');
 await fs.writeFile(path.join(backup, 'hashes.json'), JSON.stringify({ before: hash(previous), after: hash(next) }), { mode: 0o600 });
 console.log(JSON.stringify({ configured: true, backup }));
})().catch(() => { console.error('MU backend configuration failed; no secret values were logged'); process.exitCode = 1; });
