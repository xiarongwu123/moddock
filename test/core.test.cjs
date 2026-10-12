const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { scan, parseVdf } = require('../scanner.cjs');
const { createServer } = require('../server.cjs');
async function fixture(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-test-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
async function action(store, type, id) { const job = store.start(type, id); while (store.busy) await new Promise(r => setTimeout(r, 5)); return job; }
test('扫描多 Steam 库与 Epic，排除未完成安装', async t => {
 const root = await fixture(t), steam = path.join(root, 'steam'), second = path.join(root, 'other'), epic = path.join(root, 'epic');
 await fs.mkdir(path.join(steam, 'steamapps'), { recursive: true }); await fs.mkdir(path.join(second, 'steamapps/common/Sample'), { recursive: true }); await fs.mkdir(epic);
 await fs.writeFile(path.join(steam, 'steamapps/libraryfolders.vdf'), `"libraryfolders" { "0" { "path" "${second}" } }`);
 await fs.writeFile(path.join(second, 'steamapps/appmanifest_42.acf'), '"AppState" { "appid" "42" "name" "Sample Game" "installdir" "Sample" "buildid" "123" }');
 await fs.writeFile(path.join(epic, 'good.item'), JSON.stringify({ AppName: 'epic-sample', DisplayName: 'Epic Sample', InstallLocation: root, AppVersionString: '1.0' }));
 await fs.writeFile(path.join(epic, 'incomplete.item'), JSON.stringify({ AppName: 'bad', DisplayName: 'Incomplete', InstallLocation: root, bIsIncompleteInstall: true }));
 const result = await scan([steam], epic); assert.ok(result.games.find(g => g.id === 'steam-42' && g.buildId === '123')); assert.ok(result.games.find(g => g.id === 'epic-epic-sample')); assert.ok(!result.games.find(g => g.name === 'Incomplete'));
 assert.equal(parseVdf('"root" { "path" "D:\\\\Steam" }').root.path, 'D:\\Steam');
});
