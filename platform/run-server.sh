#!/usr/bin/env bash
set -euo pipefail
root=${1:?Pass the service deployment directory}
runtime="$root/runtime"
export PATH="$runtime/native/usr/bin:$PATH"
export LD_LIBRARY_PATH="$runtime/native/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export MODDOCK_NEXUS_SERVICE_DATA="$root/data"
export MODDOCK_NEXUS_SERVER=1
export MODDOCK_NEXUS_PORT=8095
umask 077
# Reuse the bundled Node runtime without starting Chromium in the API service.
export ELECTRON_RUN_AS_NODE=1
exec "$runtime/electron/electron" "$root/app/platform/nexus-worker.cjs"
