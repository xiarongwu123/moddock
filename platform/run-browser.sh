#!/usr/bin/env bash
set -euo pipefail
root=${1:?Pass the service deployment directory}
runtime="$root/runtime"
export PATH="$runtime/native/usr/bin:$PATH"
export LD_LIBRARY_PATH="$runtime/native/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export MODDOCK_NEXUS_SERVICE_DATA="$root/data"
export XDG_RUNTIME_DIR="$root/runtime-state"
unset ELECTRON_RUN_AS_NODE
umask 077
mkdir -p "$XDG_RUNTIME_DIR"
# Keep Chromium and Xvfb in their own systemd memory and lifecycle boundary.
exec "$runtime/native/usr/bin/xvfb-run" -a -e "$XDG_RUNTIME_DIR/xvfb.log" -s '-screen 0 1100x850x24 -nolisten tcp' "$runtime/electron/electron" --disable-setuid-sandbox "$root/app/platform/nexus-browser.cjs"
