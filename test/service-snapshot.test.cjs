const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);

test('Linux service snapshot has LF launchers and portable, matching manifest paths', async () => {
 const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'moddock-service-snapshot-'));
 try {
  const destination = path.join(temporary, 'service');
  await execFile(process.execPath, [path.join(__dirname, '../platform/stage-studio-service.cjs'), destination]);
  const shell = await fs.readFile(path.join(destination, 'platform/run-studio-server.sh'), 'utf8');
  assert.ok(shell.startsWith('#!/usr/bin/env bash\n'));
  assert.ok(!shell.includes('\r'), 'CRLF breaks Linux shell commands and paths');
  const manifest = JSON.parse(await fs.readFile(path.join(destination, 'service-manifest.json'), 'utf8'));
  assert.equal(manifest.credentialsIncluded, false);
  for (const [name, expected] of Object.entries(manifest.hashes)) {
   assert.ok(!name.includes('\\'), 'Linux manifest paths must use forward slashes');
   const bytes = await fs.readFile(path.join(destination, name));
   assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expected, name);
  }
 } finally {
  await fs.rm(temporary, { recursive: true, force: true });
 }
});
