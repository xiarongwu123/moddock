#!/usr/bin/env bash
set -euo pipefail
umask 077
root=/home/xrw/moddock-studio
release=${1:?Pass a release ID}
[[ "$release" =~ ^20261015-bg3-agent-[a-f0-9]{8}$ ]]
test ! -e "$root/releases/$release"
mkdir "$root/releases/$release"
tar -xzf "$root/bg3-agent-service.tar.gz" -C "$root/releases/$release"
export ELECTRON_RUN_AS_NODE=1
export LD_LIBRARY_PATH=/home/xrw/moddock-nexus/runtime/native/usr/lib/x86_64-linux-gnu
/home/xrw/moddock-nexus/runtime/electron/electron - "$root/releases/$release" <<'JS'
const fs = require('fs'), crypto = require('crypto'), path = require('path');
const root = process.argv[2], manifest = JSON.parse(fs.readFileSync(path.join(root, 'service-manifest.json')));
for (const [name, hash] of Object.entries(manifest.hashes)) {
 if (crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex') !== hash) throw new Error('Service payload mismatch');
}
require(path.join(root, 'platform/studio-service.cjs'));
console.log('Candidate service files and runtime dependencies verified; active release unchanged');
JS
