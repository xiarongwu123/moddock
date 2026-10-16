const { spawnSync } = require('node:child_process');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const scripts = ['ui-state-polling', 'ui-regression', 'ui-installations', 'ui-features', 'ui-download-access', 'ui-grid-scan', 'ui-drift-wall', 'ui-reflective-card'];
const failed = [];
for (const name of scripts) {
 const result = spawnSync(process.execPath, [path.join(project, 'test', name + '.cjs')], { cwd: project, stdio: 'inherit' });
 if (result.error) console.error(result.error.message);
 if (result.status !== 0) failed.push(name);
}
console.log(`UI regression: ${scripts.length - failed.length}/${scripts.length} passed${failed.length ? '; failed: ' + failed.join(', ') : ''}`);
if (failed.length) process.exitCode = 1;
