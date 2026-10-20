"""Isolated MU + real Pi/provider acceptance. Never seeds a production database."""
import base64
import hashlib
import json
import pathlib
import secrets
import sqlite3
import struct
import sys
import time
import urllib.error
import urllib.request
import uuid

database, origin = sys.argv[1:3]
assert 'payments-rehearsal-studio-20261020-ai-quota-' in database and '/runtime/' in database
assert origin == 'http://127.0.0.1:18098'
db = sqlite3.connect(database)
if '--restore-fixture-usage' in sys.argv:
    root = pathlib.Path(database).parent.parent
    fixture = json.loads((root / 'client-check.json').read_text())
    report = json.loads((root / 'quota-verification.json').read_text())
    assert fixture['owner'].startswith('quota-') and report['passed']
    db.execute('UPDATE ModdockAiPeriods SET used=? WHERE owner=?', (sum(report['actualUsage'].values()), fixture['owner']))
    db.commit()
    print('Isolated fixture restored to its actual provider usage.')
    sys.exit(0)
now = int(time.time())
checks = []
frames = []

def check(value, label):
    assert value, label
    checks.append(label); print('PASS ' + label, flush=True)

def request(route, token=None, body=None, expected=200, extra=None):
    headers = {'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json', **(extra or {})}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(origin + route, headers=headers, data=None if body is None else json.dumps(body).encode())
    try:
        response = urllib.request.urlopen(req, timeout=330)
    except urllib.error.HTTPError as error:
        response = error
    assert response.status == expected, route + ': HTTP ' + str(response.status) + ' ' + response.read(200).decode(errors='replace') if response.status != expected else route
    if response.headers.get_content_type() == 'application/x-ndjson':
        rows = [json.loads(line) for line in response if line.strip()]
        frames.extend(rows)
        return rows
    data = response.read()
    return json.loads(data) if data else None

def insert(table, values):
    for _, name, kind, required, default, _ in db.execute('PRAGMA table_info(' + table + ')'):
        if required and default is None and name not in values:
            values[name] = 0 if kind == 'INTEGER' else ''
    db.execute('INSERT INTO ' + table + ' (' + ','.join(values) + ') VALUES (' + ','.join('?' for _ in values) + ')', list(values.values()))

def account(tag, expiry=None):
    owner = 'quota-' + uuid.uuid4().hex[:12] + '-' + tag
    email, password = owner + '@example.invalid', secrets.token_urlsafe(24)
    salt = secrets.token_bytes(16)
    password_hash = base64.b64encode(b'\x01' + struct.pack('>III', 2, 100000, len(salt)) + salt + hashlib.pbkdf2_hmac('sha512', password.encode(), salt, 100000, 32)).decode()
    insert('AspNetUsers', dict(Id=owner, UserName=email, NormalizedUserName=email.upper(), Email=email, NormalizedEmail=email.upper(), EmailConfirmed=1,
        SecurityStamp=uuid.uuid4().hex, ConcurrencyStamp=uuid.uuid4().hex, PasswordHash=password_hash, CreatedAt=now,
        ProExpiresAt=expiry, TermsVersion='isolated-ai-quota', TermsAcceptedAt=now))
    db.commit()
    return owner, request('/api/v1/auth/login', body=dict(email=email, password=password, deviceName='isolated AI quota acceptance')), dict(email=email, password=password)

standard, normal, _ = account('standard')
expired_id, expired, _ = account('expired', now - 86400)
owner, pro, credentials = account('pro', now + 86400)
token = pro['accessToken']
check(pro['account']['aiUsage']['limitTokens'] == 1000000 and pro['account']['aiUsage']['usedTokens'] == 0, 'login serializes authoritative monthly quota')
payload = dict(harness='pi-agent', prompt='制作一个复用现有角色资源的跟随者，姓名和一句中文问候由你决定。请直接规划，不提问，不制作新模型。',
    types=[dict(id='bg3-follower', available=True)], capability=dict(creativeDefaultsDelegated=True, preferredKind='bg3-follower'),
    context=dict(game=dict(name="Baldur's Gate 3", appId='1086940')), diagnostic=dict(engine=dict(key='larian', name='Larian'), loaders=['BG3 Script Extender']))
request('/api/v1/studio/plan', body=payload, expected=401)
for session in [normal, expired]:
    result = request('/api/v1/studio/plan', session['accessToken'], payload, expected=403)
    check(result['code'] == 'pro_required', 'standard/expired membership rejected at model boundary')
check(db.execute('SELECT COUNT(*) FROM ModdockAiCalls').fetchone()[0] == 0, 'denied calls never reserve or invoke a provider')
task = str(uuid.uuid4())
body = dict(payload, delivery=dict(version=1, id=task, after=0, operation='subscribe'))
rows = request('/api/v1/studio/plan', token, body, extra={'Accept': 'application/x-ndjson', 'X-Mu-Account-Id': standard})
while not any(row['type'] in ['result', 'error'] for row in rows):
    body['delivery']['after'] = max([row.get('seq', 0) for row in rows] + [body['delivery']['after']])
    rows = request('/api/v1/studio/plan', token, body, extra={'Accept': 'application/x-ndjson'})
check(rows[0]['type'] == 'task' and rows[0]['id'] == task, 'matching delivery handshake precedes usage/results')
terminal = rows[-1]
check(terminal['type'] == 'result', 'real Pi model planning succeeds: ' + terminal.get('code', 'ok'))
calls = db.execute('SELECT input_tokens,output_tokens,state,provider_id FROM ModdockAiCalls WHERE owner=? AND task=?', (owner, task)).fetchall()
check(len(calls) > 1 and all(row[2] == 'settled' and row[3] for row in calls), 'all real provider turns have unique settled billing records')
actual = dict(inputTokens=sum(row[0] for row in calls), outputTokens=sum(row[1] for row in calls))
usage_frames = [row['usage'] for row in frames if row['type'] == 'usage']
check(usage_frames[-1] == actual and actual['inputTokens'] > 0 and actual['outputTokens'] > 0, 'cumulative stream input/output exactly matches provider ledger')
snapshot = request('/api/v1/account/me', token)
check(snapshot['aiUsage']['usedTokens'] == sum(actual.values()) and snapshot['aiUsage']['reservedTokens'] == 0, 'account/me immediately returns settled usage and releases reservation')
auth = request('/api/v1/account/authorize', token, dict(featureKey='library.manage'))
check(auth['account']['aiUsage'] == snapshot['aiUsage'], 'feature authorization uses the same account serialization')
fresh = request('/api/v1/auth/refresh', body=dict(refreshToken=pro['refreshToken']))
token = fresh['accessToken']
check(fresh['account']['aiUsage'] == snapshot['aiUsage'], 'token refresh preserves account quota')
before = len(calls)
body['delivery']['after'] = 0
replay = request('/api/v1/studio/plan', token, body, extra={'Accept': 'application/x-ndjson'})
check(replay[-1]['type'] == 'result' and db.execute('SELECT COUNT(*) FROM ModdockAiCalls WHERE owner=? AND task=?', (owner, task)).fetchone()[0] == before, 'reconnect/replay never starts another model call or charge')
foreign = request('/api/v1/studio/plan', normal['accessToken'], body, extra={'Accept': 'application/x-ndjson'})
check(foreign[-1]['type'] == 'error' and foreign[-1]['code'] == 'invalid_request', 'another authenticated account cannot subscribe to task')
db.execute('UPDATE ModdockAiPeriods SET used=1000000 WHERE owner=?', (owner,)); db.commit()
new_body = dict(payload, delivery=dict(version=1, id=str(uuid.uuid4()), after=0, operation='subscribe'))
blocked = request('/api/v1/studio/plan', token, new_body, extra={'Accept': 'application/x-ndjson'})
check(blocked[-1]['type'] == 'error' and blocked[-1]['code'] == 'ai_credits_exhausted', 'exhaustion blocks new inference at cloud model boundary')
check(request('/api/v1/studio/plan', token, body, extra={'Accept': 'application/x-ndjson'})[-1]['type'] == 'result', 'exhausted owner can still retrieve an existing result')
body['delivery']['operation'] = 'cancel'
check(request('/api/v1/studio/plan', token, body)['cancelled'], 'exhausted owner can still cancel its own task')
check(db.execute('SELECT COUNT(*) FROM ModdockAiCalls WHERE owner=?', (standard,)).fetchone()[0] == 0, 'spoofed account header cannot redirect charges')
check(db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok' and not db.execute('PRAGMA foreign_key_check').fetchall(), 'account database retains integrity')
report = dict(passed=True, realModelUsed=True, ledgerMatchesUsage=True, accountSerialization=True, checks=checks, actualUsage=actual, providerCalls=before, productionDatabaseModified=False)
root = pathlib.Path(database).parent.parent
(root / 'quota-verification.json').write_text(json.dumps(report, indent=2))
(root / 'client-check.json').write_text(json.dumps(dict(owner=owner, credentials=credentials, session=fresh)))
print(json.dumps(report), flush=True)
