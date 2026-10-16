#!/usr/bin/env bash
set -euo pipefail
cd /home/xrw/amd-dlss-mu-account
umask 077
rehearsal=${1:?Pass the verified rehearsal directory}
release=releases/20261015-nexus-payments-db626ed7
expected_server=e94ad754d3a5b95897fb6d83525dd594c8c9d9da0856ef71c714f599984e3bf0
expected_extension=db626ed732e8a74438d0c6f16dfb9380a9891298a655ce0418a5b6b3b2cd6013
test -f "$rehearsal/runtime-verified"
test -f "$rehearsal/browser-verified"
exec 9>>backups/.backup.lock
flock -x 9
previous=$(readlink current)
test "$previous" = releases/20261014-payments-e94ad754
test "$(sha256sum current/Mu.Server.dll | cut -d ' ' -f 1)" = "$expected_server"
test "$(docker exec amd-dlss-mu-account sha256sum /app/Mu.Server.dll | cut -d ' ' -f 1)" = "$expected_server"
test "$(sha256sum "$release/Mu.Server.dll" | cut -d ' ' -f 1)" = "$expected_server"
test "$(sha256sum "$release/Mu.NexusGateway.dll" | cut -d ' ' -f 1)" = "$expected_extension"
python3 - "$release/nexus-recovery-manifest.json" <<'PY'
import hashlib,json,pathlib,sys
manifest=json.load(open(sys.argv[1]))
for name,digest in manifest['baseline'].items():
 assert hashlib.sha256((pathlib.Path('current')/name).read_bytes()).hexdigest()==digest,name+': production baseline differs'
print('Every original production file matches the retained payment release.')
PY
cutover="backups/nexus-recovery-cutover-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$cutover"
cp -p .env compose.yml "$cutover/"
cp -a data/keys "$cutover/keys"
printf '%s\n' "$previous" >"$cutover/previous-release.txt"
printf 'services:\n  account:\n    environment:\n      Maintenance__Enabled: "true"\n' >"$cutover/maintenance.yml"
rollback() {
 result=$?
 trap - EXIT
 if (( result != 0 )); then
  cp -p "$cutover/.env" .env
  ln -s "$previous" "current.rollback.$$"
  mv -Tf "current.rollback.$$" current
  docker compose up -d --force-recreate account || true
  echo 'Restored the previous schema-5 service and configuration; no database snapshots were restored.' >&2
 fi
 exit "$result"
}
trap rollback EXIT
docker compose stop --timeout 30 account
test "$(docker inspect --format '{{.State.Running}}' amd-dlss-mu-account)" = false
python3 - "$cutover" <<'PY'
import pathlib,sqlite3,sys
backup=pathlib.Path(sys.argv[1])
for name in ['accounts','mail-logs']:
 source=sqlite3.connect('file:data/'+name+'.sqlite?mode=ro',uri=True)
 target=sqlite3.connect(str(backup/(name+'.sqlite')))
 source.backup(target)
 assert target.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 assert not target.execute('PRAGMA foreign_key_check').fetchall()
 target.close();source.close()
print('Final account and mail databases backed up and integrity checked.')
env=pathlib.Path('.env'); text=env.read_text()
assert not any(line.startswith('ASPNETCORE_HOSTINGSTARTUPASSEMBLIES=') for line in text.splitlines())
temporary=pathlib.Path('.env.nexus-next')
temporary.write_text(text.rstrip('\n')+'\nASPNETCORE_HOSTINGSTARTUPASSEMBLIES=Mu.NexusGateway\n')
temporary.chmod(0o600);temporary.replace(env)
PY
ln -s "$release" "current.next.$$"
mv -Tf "current.next.$$" current
docker compose -f compose.yml -f "$cutover/maintenance.yml" up -d --force-recreate account
wait_healthy() {
 for attempt in {1..30}; do
  if curl --fail --silent --max-time 2 http://127.0.0.1:8089/api/health >/dev/null; then return 0; fi
  sleep 1
 done
 return 1
}
wait_healthy
test "$(curl --silent --max-time 8 -o /dev/null -w '%{http_code}' -H 'X-Forwarded-Proto: https' http://127.0.0.1:8089/api/v1/nexus/status)" = 503
python3 "$rehearsal/verify-data.py" "$cutover/accounts.sqlite" data/accounts.sqlite "$cutover/mail-logs.sqlite" data/mail-logs.sqlite | tee "$cutover/data-check.txt"
cmp -s compose.yml "$cutover/compose.yml"
diff -rq data/keys "$cutover/keys"
python3 - "$cutover/.env" <<'PY'
import pathlib,sys
before=pathlib.Path(sys.argv[1]).read_text().splitlines()
after=pathlib.Path('.env').read_text().splitlines()
assert [line for line in after if not line.startswith('ASPNETCORE_HOSTINGSTARTUPASSEMBLIES=')]==before
print('All existing settings, credentials, payment configuration and keys preserved.')
PY
docker compose up -d --force-recreate account
wait_healthy
test "$(curl --silent --max-time 8 -o /dev/null -w '%{http_code}' -H 'X-Forwarded-Proto: https' http://127.0.0.1:8089/api/v1/nexus/status)" = 401
curl --fail --silent --max-time 8 -H 'X-Forwarded-Proto: https' http://127.0.0.1:8089/api/v1/plans >"$cutover/plans.json"
python3 - "$cutover/plans.json" <<'PY'
import json,sys
response=json.load(open(sys.argv[1]))
assert response['paymentsEnabled'] is True and response['paymentMethod']=='manual'
assert sorted((p['priceMinor'],p['durationDays'],p['configurationSessions']) for p in response['items'])==[(990,30,0),(2990,30,1),(4990,0,0)]
print('Production manual collection and all three plans preserved; Nexus authentication restored.')
PY
printf 'ACTIVATED=%s\nCUTOVER=%s\n' "$release" "$cutover"
