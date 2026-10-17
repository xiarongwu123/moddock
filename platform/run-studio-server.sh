#!/usr/bin/env bash
set -euo pipefail
root=${1:?Pass the private creation service directory}
runtime=/home/xrw/moddock-nexus/runtime
export LD_LIBRARY_PATH="$runtime/native/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export ELECTRON_RUN_AS_NODE=1
export MODDOCK_STUDIO_TASKS="$root/tasks"
exec "$runtime/electron/electron" "$root/current/platform/studio-service.cjs"
