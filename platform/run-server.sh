#!/usr/bin/env bash
set -euo pipefail
root=${1:?Pass the service deployment directory}
runtime="$root/runtime"
export PATH="$runtime/native/usr/bin:$PATH"
export LD_LIBRARY_PATH="$runtime/native/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export MODDOCK_NEXUS_SERVICE_DATA="$root/data"
export MODDOCK_NEXUS_SERVER=1
export MODDOCK_NEXUS_PORT=8095
export XDG_RUNTIME_DIR="$root/runtime-state"
umask 077
mkdir -p "$XDG_RUNTIME_DIR"
# Chromium uses the unprivileged namespace sandbox rather than a root-owned setuid helper.
exec "$runtime/native/usr/bin/xvfb-run" -a -e "$XDG_RUNTIME_DIR/xvfb.log" -s '-screen 0 1100x850x24 -nolisten tcp' "$runtime/electron/electron" --disable-setuid-sandbox "$root/app/platform/nexus-worker.cjs"
