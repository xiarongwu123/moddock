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
assert 'payments-rehearsal-studio-' in database and '/runtime/' in database
db = sqlite3.connect(database)
now, checks = int(time.time()), 0
run_id = uuid.uuid4().hex[:8]


def verify(value, label):
    global checks
    assert value, label
    checks += 1
    print('PASS ' + label, flush=True)


def request(route, token=None, body=None, expected=200, extra=None):
    headers = {'X-Forwarded-Proto': 'https', **(extra or {})}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if body is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(origin + route, data=None if body is None else json.dumps(body).encode(), headers=headers)
    try:
        response = urllib.request.urlopen(req, timeout=95)
    except urllib.error.HTTPError as error:
        response = error
    data = response.read()
    assert response.status == expected, route + ': ' + str(response.status) + ', expected ' + str(expected) + ', body=' + data[:120].decode(errors='replace')
    return json.loads(data) if data else None


def insert(table, values):
    for _, name, kind, required, default, _ in db.execute('PRAGMA table_info(' + table + ')'):
        if required and default is None and name not in values:
            values[name] = 0 if kind == 'INTEGER' else ''
    db.execute('INSERT INTO ' + table + ' (' + ','.join(values) + ') VALUES (' + ','.join('?' for _ in values) + ')', list(values.values()))


def account(tag, expiry=None):
    identifier = 'studio-check-' + run_id + '-' + tag
    email = identifier + '@example.invalid'
    password = secrets.token_urlsafe(20)
    salt = secrets.token_bytes(16)
    password_hash = base64.b64encode(b'\x01' + struct.pack('>III', 2, 100000, len(salt)) + salt + hashlib.pbkdf2_hmac('sha512', password.encode(), salt, 100000, 32)).decode()
    insert('AspNetUsers', dict(Id=identifier, UserName=email, NormalizedUserName=email.upper(), Email=email,
        NormalizedEmail=email.upper(), EmailConfirmed=1, SecurityStamp=uuid.uuid4().hex, ConcurrencyStamp=uuid.uuid4().hex,
        PasswordHash=password_hash, CreatedAt=now, ProExpiresAt=expiry, TermsVersion='isolated-test', TermsAcceptedAt=now))
    db.commit()
    session = request('/api/v1/auth/login', body={'email': email, 'password': password, 'deviceName': 'isolated AI integration'})
    return identifier, session, {'email': email, 'password': password}


standard, normal, _ = account('standard')
expired_id, expired, _ = account('expired', now-86400)
owner, pro, credentials = account('pro', now+86400)
token = pro['accessToken']
verify(pro['account']['membership']['tier'] == 'pro', 'real MU login returns current Pro membership')
payload = {'prompt': '制作一个中国风人物跟随者，姓名和一句问候由你决定；明确复用现有角色资源，不制作新模型和完整剧情。',
 'types': [{'id': 'bg3-follower', 'available': True}], 'capability': {'creativeDefaultsDelegated': True, 'preferredKind': 'bg3-follower'},
 'context': {'game': {'name': "Baldur's Gate 3", 'appId': '1086940'}, 'guide': {'text': 'a' * 18000}},
 'diagnostic': {'engine': {'key': 'larian', 'name': 'Larian'}, 'loaders': ['BG3 Script Extender']}}
for bearer, status in [(None, 401), (normal['accessToken'], 403), (expired['accessToken'], 403)]:
    request('/api/v1/studio/plan', bearer, payload, status)
verify(True, 'anonymous, standard and expired Pro requests are denied')
for body, status in [({**payload, 'apiKey': 'injected'}, 400), ({**payload, 'prompt': 'x'*2001}, 400), ({**payload, 'context': {'guide': {'text': 'x'*200000}}}, 413)]:
    request('/api/v1/studio/plan', token, body, status)
verify(True, 'invalid fields, long prompts and oversized contexts are rejected')
plan = request('/api/v1/studio/plan', token, payload, extra={'X-Mu-Account-Id': standard})
verify(plan.get('kind') == 'bg3-follower' and isinstance(plan.get('steps'), list) and plan['steps'], 'real model plans through MU with context above the old 16KB limit')
draft = request('/api/v1/studio/generate', token, {**payload, 'kind': plan['kind'], 'plan': plan})
verify(draft.get('kind') == 'bg3-follower' and draft.get('followerName') and draft.get('greeting'), 'real model generates actual follower fields through MU')
for value in [plan, draft]:
    text = json.dumps(value)
    verify('sk-' not in text and 'MODDOCK_STUDIO_TOKEN' not in text and 'apiKey' not in text, 'model response exposes no service credential')
db.execute("UPDATE FeatureDefinitions SET Enabled=0 WHERE Key='library.manage'");db.commit()
request('/api/v1/studio/plan', token, payload, 403)
db.execute("UPDATE FeatureDefinitions SET Enabled=1 WHERE Key='library.manage'");db.commit()
verify(True, 'live feature policy denial is enforced by the MU gateway')
db.execute('UPDATE AspNetUsers SET DisabledAt=? WHERE Id=?', (now, owner));db.commit()
request('/api/v1/studio/plan', token, payload, 403)
db.execute('UPDATE AspNetUsers SET DisabledAt=NULL WHERE Id=?', (owner,));db.commit()
verify(True, 'disabled accounts cannot call the model')
plans = request('/api/v1/plans')
verify(plans['paymentsEnabled'] and plans['paymentMethod'] == 'manual' and sorted((p['priceMinor'], p['durationDays'], p['configurationSessions']) for p in plans['items']) == [(990,30,0),(2990,30,1),(4990,0,0)], 'all existing manual payment plans remain intact')
nexus = request('/api/v1/nexus/status', normal['accessToken'])
verify(nexus.get('ready') is True, 'existing authenticated Nexus service remains reachable')
request('/api/v1/catalog/supported-games', token)
for route in ['/api/v1/presets?gameKey=steam%3A1245620', '/api/v1/wishes', '/api/v1/compatibility/public/games']:
    request(route, normal['accessToken'])
verify(True, 'private catalog, presets, wishes and compatibility routes remain available')
request('/api/v1/auth/logout', normal['accessToken'], {}, 204)
request('/api/v1/studio/plan', normal['accessToken'], payload, 401)
verify(True, 'revoked MU sessions cannot call creation endpoints')
verify(db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok' and not db.execute('PRAGMA foreign_key_check').fetchall(), 'isolated schema-5 database integrity is valid')
root = pathlib.Path(database).parent
(root/'studio-check.json').write_text(json.dumps({'checks': checks, 'plan': plan, 'draft': draft, 'realModelUsed': True, 'productionDatabaseModified': False}, ensure_ascii=False, indent=2))
private = root/'client-check.json';private.write_text(json.dumps({'credentials': credentials, 'owner': owner, 'session': pro}));private.chmod(0o600)
(root.parent/'studio-runtime-verified').touch()
print('MU AI integration passed: ' + str(checks) + ' assertions.', flush=True)
