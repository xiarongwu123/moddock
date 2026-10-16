#!/usr/bin/env bash
set -euo pipefail
umask 077
root=/home/xrw/moddock-studio
release=${1:?Pass a verified release ID}
[[ "$release" =~ ^20261015-bg3-agent-[a-f0-9]{8}$ ]]
test -f "$root/releases/$release/service-manifest.json"
test -f "$root/releases/$release/agent-verified"
previous=$(readlink "$root/current")
test "$previous" = releases/20261015-mu-studio-4b8aae58
account=/home/xrw/amd-dlss-mu-account
before=$(sha256sum "$account/current/Mu.Server.dll" "$account/current/Mu.NexusGateway.dll" "$account/.env" "$root/service.env")
rollback() {
 result=$?
 trap - EXIT
 if (( result != 0 )); then
  ln -s "$previous" "$root/current.rollback.$$"
  mv -Tf "$root/current.rollback.$$" "$root/current"
  systemctl --user restart moddock-studio
 fi
 exit "$result"
}
trap rollback EXIT
ln -s "releases/$release" "$root/current.next.$$"
mv -Tf "$root/current.next.$$" "$root/current"
systemctl --user restart moddock-studio
set -a
. "$root/service.env"
set +a
export ELECTRON_RUN_AS_NODE=1
export LD_LIBRARY_PATH=/home/xrw/moddock-nexus/runtime/native/usr/lib/x86_64-linux-gnu
/home/xrw/moddock-nexus/runtime/electron/electron - <<'JS'
(async () => {
 for (let i = 0; i < 15; i++) {
  try {
   const response = await fetch(`http://${process.env.MODDOCK_STUDIO_HOST}:${process.env.MODDOCK_STUDIO_PORT}/status`, { headers: { Authorization: 'Bearer ' + process.env.MODDOCK_STUDIO_TOKEN, 'X-Mu-Account-Id': 'deployment-health' } });
   const data = await response.json();
   if (response.ok && data.ready && data.capabilities.includes('bg3-agent')) { console.log('Production private AI service is healthy with BG3 tool authoring'); return; }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 500));
 }
 throw new Error('Candidate AI health failed');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
JS
test "$before" = "$(sha256sum "$account/current/Mu.Server.dll" "$account/current/Mu.NexusGateway.dll" "$account/.env" "$root/service.env")"
curl --fail --silent --max-time 10 http://127.0.0.1:8089/api/health >/dev/null
printf '%s\n' "Previous private service retained: $previous" "MU account binaries, configuration, credentials and database were not replaced"
