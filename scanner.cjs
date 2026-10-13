const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
function parseVdf(text) {
  const tokens = [...text.matchAll(/"((?:\\.|[^"\\])*)"|([{}])/g)].map(m => m[2] || m[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"'));
  let cursor = 0;
  function object() { const out = {}; while (cursor < tokens.length) { const key = tokens[cursor++]; if (key === '}') break; const value = tokens[cursor++]; out[key] = value === '{' ? object() : value; } return out; }
  return object();
}
async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }
async function isDirectory(p) { try { return (await fs.stat(p)).isDirectory(); } catch { return false; } }
function pathKey(value) { const normalized = path.resolve(value); return process.platform === 'win32' ? normalized.toLowerCase() : normalized; }
async function resolveSteamRoot(selected) {
  if (typeof selected !== 'string' || !selected || selected.length > 4096 || selected.includes('\0') || !path.isAbsolute(selected)) throw new Error('请选择有效的游戏库文件夹');
  let current;
  try { current = await fs.realpath(selected); } catch { throw new Error('无法读取所选文件夹，请检查磁盘是否已连接'); }
  if (!(await isDirectory(current))) throw new Error('请选择文件夹，而不是文件');
  // Accept a library, steamapps, common, or a game folder without asking users to know Steam's layout.
  for (let depth = 0; depth < 6; depth++) {
    if (await isDirectory(path.join(current, 'steamapps'))) return current;
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  throw new Error('未找到 Steam 游戏库。请选择 SteamLibrary、steamapps 或其中的游戏文件夹。');
}
async function steamRoots(extra = []) {
  const roots = [...extra];
  if (process.platform === 'win32') {
    for (const key of ['HKCU\\Software\\Valve\\Steam', 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam']) {
      try { const { stdout } = await run('reg.exe', ['query', key]); const m = stdout.match(/(?:SteamPath|InstallPath)\s+REG_SZ\s+(.+)/i); if (m) roots.push(m[1].trim()); } catch {}
    }
    roots.push(path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'));
  } else if (process.platform === 'darwin') roots.push(path.join(os.homedir(), 'Library/Application Support/Steam'));
  else roots.push(path.join(os.homedir(), '.steam/steam'), path.join(os.homedir(), '.local/share/Steam'));
  const libraries = new Map();
  for (const candidate of roots) {
    let root; try { root = await resolveSteamRoot(candidate); } catch { continue; }
    libraries.set(pathKey(root), root);
    try { const data = parseVdf(await fs.readFile(path.join(root, 'steamapps/libraryfolders.vdf'), 'utf8')); for (const [key, v] of Object.entries(data.libraryfolders || data.LibraryFolders || {})) { const p = typeof v === 'object' ? v.path : /^\d+$/.test(key) ? v : null; if (p) { try { const library = await resolveSteamRoot(p); libraries.set(pathKey(library), library); } catch {} } } } catch {}
  }
  return [...libraries.values()];
}
async function scan(extra = [], epicRoot) {
  const games = [], diagnostics = [];
  const roots = await steamRoots(extra);
  for (const root of roots) {
    try {
      for (const file of await fs.readdir(path.join(root, 'steamapps'))) {
        if (!/^appmanifest_\d+\.acf$/.test(file)) continue;
        try { const a = parseVdf(await fs.readFile(path.join(root, 'steamapps', file), 'utf8')).AppState; if (!a?.appid || !a.name || !a.installdir) continue; const dir = path.resolve(root, 'steamapps/common', a.installdir); const common = path.resolve(root, 'steamapps/common'); if (!dir.startsWith(common + path.sep)) continue; if (!(await isDirectory(dir))) continue; games.push({ id: `steam-${a.appid}`, appId: a.appid, name: a.name, english: 'LOCAL INSTALLATION', genre: '本机游戏', platform: 'Steam', installPath: dir, libraryPath: root, buildId: a.buildid || null, real: true }); } catch (e) { diagnostics.push(`${file}: ${e.message}`); }
      }
    } catch (e) { diagnostics.push(`${root}: ${e.message}`); }
  }
  const epic = epicRoot || (process.platform === 'win32' ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic/EpicGamesLauncher/Data/Manifests') : null);
  if (epic && await exists(epic)) {
    for (const file of await fs.readdir(epic)) if (file.endsWith('.item')) {
      try { const m = JSON.parse(await fs.readFile(path.join(epic, file), 'utf8')); if (m.bIsIncompleteInstall || !m.InstallLocation || !m.DisplayName || !(await exists(m.InstallLocation))) continue; games.push({ id: `epic-${m.AppName}`, name: m.DisplayName, english: 'LOCAL INSTALLATION', genre: '本机游戏', platform: 'Epic', installPath: m.InstallLocation, buildId: m.AppVersionString || null, real: true }); } catch (e) { diagnostics.push(`${file}: ${e.message}`); }
    }
  }
  const found = [...new Map(games.map(g => [g.id, g])).values()];
  return { games: found, roots, locations: roots.map(root => ({ path: root, gameCount: found.filter(game => game.libraryPath === root).length })), diagnostics, scannedAt: new Date().toISOString(), platform: process.platform };
}
module.exports = { scan, parseVdf, resolveSteamRoot, pathKey };
