"""Read-only deployment acceptance except provisioning a current period for one
existing, already entitled Pro account. Never creates sessions or membership.
"""
import hashlib
import json
import pathlib
import sqlite3
import time
import urllib.error
import urllib.request

root = pathlib.Path('/home/xrw/moddock-studio')
account = pathlib.Path('/home/xrw/amd-dlss-mu-account')
private = dict(line.split('=', 1) for line in (root / 'service.env').read_text().splitlines() if line and not line.startswith('#') and '=' in line)
origin = 'http://' + private['MODDOCK_STUDIO_HOST'] + ':' + private['MODDOCK_STUDIO_PORT']

def get(url, owner=None, authenticate=False):
    headers = {'X-Forwarded-Proto': 'https'}
    if authenticate:
        headers.update(Authorization='Bearer ' + private['MODDOCK_STUDIO_TOKEN'], **{'X-Mu-Account-Id': owner or 'quota-production-health'})
    req = urllib.request.Request(url, headers=headers)
    try:
        response = urllib.request.urlopen(req, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    data = response.read()
    return response.status, json.loads(data) if data else None

db = sqlite3.connect('file:' + str(account / 'data/accounts.sqlite') + '?mode=ro', uri=True)
status, health = get('http://127.0.0.1:8089/api/health')
assert status == 200
status, studio = get(origin + '/status', authenticate=True)
assert status == 200 and studio['ready'] and studio['harness'] == 'pi-agent'
assert get('http://127.0.0.1:8089/api/v1/account/me')[0] == 401
assert get('http://127.0.0.1:8089/internal/moddock/ai-account')[0] == 403
assert get(origin + '/quota')[0] == 401
assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
assert not db.execute('PRAGMA foreign_key_check').fetchall()
row = db.execute('SELECT Id FROM AspNetUsers WHERE ProExpiresAt>? AND DisabledAt IS NULL LIMIT 1', (int(time.time()),)).fetchone()
quota_verified = False
if row:
    status, snapshot = get('http://127.0.0.1:8089/internal/moddock/ai-account', row[0], True)
    assert status == 200 and snapshot['membership']['tier'] == 'pro'
    status, quota = get(origin + '/quota', row[0], True)
    assert status == 200 and quota['limitTokens'] == 1000000 and quota['usedTokens'] >= 0
    quota_verified = True
assert hashlib.sha256((account / 'current/Mu.Server.dll').read_bytes()).hexdigest() == 'e94ad754d3a5b95897fb6d83525dd594c8c9d9da0856ef71c714f599984e3bf0'
report = dict(passed=True, accountRelease=str((account / 'current').resolve().name), studioRelease=str((root / 'current').resolve().name),
    accountHealth=True, studioHealth=True, authenticationBoundaries=True, schemaIntegrity=True, paymentBinaryUnchanged=True,
    existingProQuotaVerified=quota_verified, productionModelCalled=False, syntheticProductionAccountsCreated=False,
    ledgerTables=[row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ModdockAi%'")])
(root / 'ai-quota-production-check-20261020.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report))
