// Host provisioning only. URLs, checksums and commands are never supplied by an AI draft.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { runTool } = require('../studio-tools.cjs');

const directory = path.resolve(process.env.MODDOCK_TOOLCHAIN_DIR || path.join(__dirname, '..', '.moddock-tools'));
const hosts = new Set(['www.lua.org', 'builds.dotnet.microsoft.com', 'dotnetcli.blob.core.windows.net']);
async function download(url, file, algorithm, expected, max) {
 if (!hosts.has(new URL(url).hostname) || !url.startsWith('https://')) throw new Error('Unregistered tool distribution');
 const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
 if (!response.ok || !hosts.has(new URL(response.url).hostname)) throw new Error('Tool download failed: ' + response.status);
 const temporary = file + '.' + crypto.randomUUID() + '.tmp', checksum = crypto.createHash(algorithm); let size = 0;
 const handle = await fs.open(temporary, 'wx');
 try {
  for await (const bytes of response.body) { size += bytes.length; if (size > max) throw new Error('Tool download exceeds size limit'); checksum.update(bytes); await handle.writeFile(bytes); }
  if (checksum.digest('hex') !== expected.toLowerCase()) throw new Error('Tool checksum mismatch');
  await handle.close(); await fs.rename(temporary, file);
 } catch (error) { await handle.close().catch(() => {}); await fs.rm(temporary, { force: true }); throw error; }
}
async function invoke(executable, args, cwd) {
 const result = await runTool(executable, args, { cwd, timeout: 180000, limit: 256 * 1024 });
 if (result.code !== 0) throw new Error(result.output.slice(-5000) || 'Tool provisioning failed');
}
async function lua() {
 const version = '5.4.8', archive = path.join(directory, 'lua.tar.gz'), staging = await fs.mkdtemp(path.join(directory, 'lua-stage-'));
 try {
  await download(`https://www.lua.org/ftp/lua-${version}.tar.gz`, archive, 'sha256', '4f18ddae154e793e46eeab727c59ef1c0c0c2b744e7b94219710d76f530629ae', 1024 * 1024);
  await invoke('tar', ['-xzf', archive, '-C', staging], staging);
  const source = path.join(staging, `lua-${version}`, 'src');
  if (process.platform === 'win32') {
   const sources = (await fs.readdir(source)).filter(name => name.endsWith('.c') && name !== 'lua.c').map(name => path.join(source, name));
   await invoke('cl.exe', ['/nologo', '/O2', '/MD', '/Fe:' + path.join(source, 'luac.exe'), ...sources], staging);
  } else await invoke('make', ['-C', source, '-j2', 'luac'], staging);
  await fs.mkdir(path.join(directory, 'bin'), { recursive: true });
  const name = 'luac' + (process.platform === 'win32' ? '.exe' : '');
  await fs.copyFile(path.join(source, name), path.join(directory, 'bin', name));
  await fs.chmod(path.join(directory, 'bin', name), 0o755);
  await fs.copyFile(path.join(staging, `lua-${version}`, 'README'), path.join(directory, 'LUA-README'));
  return { tool: 'Lua', version, platform: process.platform, arch: process.arch };
 } finally { await fs.rm(staging, { recursive: true, force: true }); await fs.rm(archive, { force: true }); }
}
async function dotnet() {
 const rid = ({ darwin: 'osx', win32: 'win', linux: 'linux' })[process.platform] + '-' + process.arch;
 if (!/^(osx|win|linux)-(arm64|x64)$/.test(rid)) throw new Error('Unsupported .NET SDK platform');
 const response = await fetch('https://builds.dotnet.microsoft.com/dotnet/release-metadata/8.0/releases.json', { signal: AbortSignal.timeout(30000) });
 if (!response.ok) throw new Error('Unable to read Microsoft SDK release metadata');
 const metadata = await response.json(), sdk = metadata.releases.find(release => release.sdk?.version === metadata['latest-sdk'])?.sdk;
 const entry = sdk?.files.find(file => file.rid === rid && file.name.endsWith(process.platform === 'win32' ? '.zip' : '.tar.gz'));
 if (!entry || !/^[a-f0-9]{128}$/i.test(entry.hash)) throw new Error('SDK metadata has no verified archive for ' + rid);
 const archive = path.join(directory, process.platform === 'win32' ? 'sdk.zip' : 'sdk.tar.gz'), staging = await fs.mkdtemp(path.join(directory, 'dotnet-stage-'));
 try {
  await download(entry.url, archive, 'sha512', entry.hash, 350 * 1024 * 1024);
  if (process.platform === 'win32') await invoke('tar', ['-xf', archive, '-C', staging], staging);
  else await invoke('tar', ['-xzf', archive, '-C', staging], staging);
  const destination = path.join(directory, 'dotnet');
  try { await fs.access(destination); throw new Error('Managed SDK already exists; keep it or remove it explicitly before provisioning a different version.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.rename(staging, destination);
  return { tool: '.NET SDK', version: sdk.version, rid, sha512: entry.hash };
 } finally { await fs.rm(staging, { recursive: true, force: true }); await fs.rm(archive, { force: true }); }
}
(async () => {
 await fs.mkdir(directory, { recursive: true });
 const results = [];
 if (!process.argv.includes('--dotnet-only')) results.push(await lua());
 if (!process.argv.includes('--lua-only')) results.push(await dotnet());
 await fs.writeFile(path.join(directory, 'provision.json'), JSON.stringify({ created: new Date().toISOString(), results }, null, 2));
 console.log(JSON.stringify({ directory, results }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
