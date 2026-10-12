const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ensureUi } = require('../scripts/build-ui.cjs');

test('startup builds missing UI assets, keeps complete builds, and repairs partial builds', async () => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-ui-build-'));
 try {
  await Promise.all([ensureUi(dir), ensureUi(dir)]);
  for (const name of ['auth.js', 'auth.css']) assert.ok((await fs.stat(path.join(dir, name))).size > 0);
  const js = path.join(dir, 'auth.js');
  const css = path.join(dir, 'auth.css');
  const modified = (await fs.stat(js)).mtimeMs;
  await ensureUi(dir);
  assert.equal((await fs.stat(js)).mtimeMs, modified);
  await fs.unlink(css);
  await ensureUi(dir);
  assert.ok((await fs.stat(css)).size > 0);
 } finally {
  await fs.rm(dir, { recursive: true, force: true });
 }
});
