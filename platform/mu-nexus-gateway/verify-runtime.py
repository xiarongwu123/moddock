import base64
import hashlib
import json
import secrets
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

database, origin = sys.argv[1:3]
assert 'payments-rehearsal-nexus-' in database and '/runtime/' in database
db = sqlite3.connect(database)
now, checks = int(time.time()), 0
run_id = uuid.uuid4().hex[:8]
jobs, backend_calls = {}, []
fixture_bytes = b'isolated-nexus-file-content'


class Backend(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, body, status=200):
        binary = isinstance(body, bytes)
        content = body if binary else json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/octet-stream' if binary else 'application/json')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def read_body(self):
        if self.headers.get('Transfer-Encoding', '').lower() == 'chunked':
            chunks = []
            while True:
                length = int(self.rfile.readline().split(b';')[0], 16)
                if not length:
                    self.rfile.readline()
                    return b''.join(chunks)
                chunks.append(self.rfile.read(length))
                self.rfile.readline()
        return self.rfile.read(int(self.headers.get('Content-Length', '0')))

    def handle_request(self):
        assert self.headers['Authorization'] == 'Bearer ' + 'a' * 64
        owner = self.headers['X-Mu-Account-Id']
        backend_calls.append((self.command, self.path, owner))
        if self.path == '/status':
            return self.send({'ready': True})
        if self.command == 'POST' and self.path == '/jobs':
            data = json.loads(self.read_body())
            if data['modId'] in ['429', '409', '503']:
                return self.send({'error': 'private diagnostic must stay private'}, int(data['modId']))
            identifier = str(uuid.uuid4())
            jobs[identifier] = owner
            return self.send({'id': identifier, 'status': 'completed', 'size': len(fixture_bytes), 'sha256': hashlib.sha256(fixture_bytes).hexdigest()}, 202)
        parts = self.path.split('/')
        identifier = parts[2]
        if jobs.get(identifier) != owner:
            return self.send({'error': 'Not found'}, 404)
        if parts[-1] == 'file':
            return self.send(fixture_bytes)
        if parts[-1] == 'verification':
            return self.send({'pending': True, 'revision': str(uuid.uuid4()), 'image': 'data:image/png;base64,' + 'A' * 30000})
        return self.send({'id': identifier, 'status': 'completed', 'ok': True})

    do_GET = handle_request
    do_POST = handle_request
    do_DELETE = handle_request


backend = ThreadingHTTPServer(('127.0.0.1', 18095), Backend)
threading.Thread(target=backend.serve_forever, daemon=True).start()


def verify(condition, label):
    global checks
    assert condition, label
    checks += 1
    print('PASS ' + label)


def insert(table, values):
    for _, name, kind, required, default, _ in db.execute('PRAGMA table_info(' + table + ')'):
        if required and default is None and name not in values:
            values[name] = 0 if kind == 'INTEGER' else ''
    columns = list(values)
    db.execute('INSERT INTO ' + table + ' (' + ','.join(columns) + ') VALUES (' + ','.join('?' for _ in columns) + ')', list(values.values()))


def account(tag, expiry=None):
    identifier, token = 'nexus-recovery-check-' + run_id + '-' + tag, secrets.token_urlsafe(48)
    email = identifier + '@example.invalid'
    insert('AspNetUsers', dict(Id=identifier, UserName=email, NormalizedUserName=email.upper(), Email=email,
        NormalizedEmail=email.upper(), EmailConfirmed=1, SecurityStamp=uuid.uuid4().hex, ConcurrencyStamp=uuid.uuid4().hex,
        CreatedAt=now, ProExpiresAt=expiry, TermsVersion='isolated-test', TermsAcceptedAt=now))
    insert('AuthSessions', dict(Id=uuid.uuid4().hex, UserId=identifier, FamilyId=uuid.uuid4().hex,
        AccessHash=hashlib.sha256(token.encode()).hexdigest().upper(), RefreshHash=secrets.token_hex(32).upper(),
        CreatedAt=now, AccessExpiresAt=now+3600, RefreshExpiresAt=now+7200, DeviceName='isolated Nexus recovery check'))
    db.commit()
    return identifier, token


def request(path, token=None, data=None, expected=200, method=None, extra=None, binary=False):
    headers = {'User-Agent': '', 'X-Forwarded-Proto': 'https', **(extra or {})}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    body = None if data is None else json.dumps(data).encode()
    if body is not None:
        headers['Content-Type'] = 'application/json'
    query = urllib.request.Request(origin + path, data=body, headers=headers, method=method)
    try:
        response = urllib.request.urlopen(query, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    content = response.read()
    assert response.status == expected, path + ': HTTP ' + str(response.status) + ', expected ' + str(expected) + ', response=' + content[:180].decode(errors='replace')
    return (content if binary else json.loads(content) if content else None), response.headers


alice, a = account('standard')
bob, b = account('other')
_, expired = account('expired', now-86400)
_, pro = account('pro', now+30*86400)
plans, _ = request('/api/v1/plans')
verify(plans['paymentsEnabled'] and plans['paymentMethod'] == 'manual', 'manual collection remains enabled')
expected_plans = [('mu-pro-monthly', 990, 30, 0), ('mu-pro-lifetime', 4990, 0, 0), ('mu-pro-assisted', 2990, 30, 1)]
verify(len(plans['items']) == 3, 'exactly three payment plans')
orders = {}
for identifier, price, days, sessions in expected_plans:
    item = next(p for p in plans['items'] if p['id'] == identifier)
    verify((item['priceMinor'], item['durationDays'], item['configurationSessions']) == (price, days, sessions), identifier + ' unchanged')
    order, _ = request('/api/v1/orders', a, {'planId': identifier})
    orders[identifier] = order['id']
    verify((order['status'], order['amountMinor'], order['durationDays'], order['configurationSessions']) == ('pending', price, days, sessions), 'order preserves payment snapshot')
    channels = order['payment']['channels']
    images = [c.get('qrImageDataUrl', c.get('imageDataUrl', c.get('qrImageUrl', ''))) for c in channels]
    verify(len(images) == 2 and all(image.startswith('data:image/jpeg;base64,') and base64.b64decode(image.split(',')[1]).startswith(b'\xff\xd8') for image in images), 'both embedded payment QR codes remain available')
    repeat, _ = request('/api/v1/orders', a, {'planId': identifier})
    verify(repeat['id'] == order['id'], 'pending order reuse preserved')
    request('/api/v1/orders/' + order['id'], b, expected=404)
    request('/api/v1/orders/' + order['id'] + '/review', a, {}, expected=204)
    reviewed, _ = request('/api/v1/orders/' + order['id'], a)
    verify(reviewed['status'] == 'review_requested' and reviewed.get('paidAt') is None, 'payment claim does not confirm receipt')
verify(db.execute('SELECT ProExpiresAt FROM AspNetUsers WHERE Id=?', (alice,)).fetchone()[0] is None, 'payment claim does not grant membership')
for token, status in [(None, 401), (a, 403), (expired, 403)]:
    request('/api/v1/catalog/supported-games', token, expected=status)
catalog, headers = request('/api/v1/catalog/supported-games', pro)
catalog = catalog.get('catalog', catalog)
verify(len(catalog.get('games', catalog.get('items', []))) == 162 and headers['Cache-Control'] == 'no-store', 'Pro private catalog preserved')

request('/api/v1/nexus/status', expected=401)
verify(not backend_calls, 'anonymous request never reaches the worker')
state, headers = request('/api/v1/nexus/status', a)
verify(state['ready'] and headers['Cache-Control'] == 'no-store', 'authenticated gateway uses existing host pipeline')
payload = {'domain': 'counterstrike2', 'modId': '33', 'fileId': '39'}
job, _ = request('/api/v1/nexus/jobs', a, payload, expected=202, extra={'X-Mu-Account-Id': bob})
identifier = job['id']
verify(jobs[identifier] == alice, 'job ownership comes from MU claims, ignoring spoofed headers')
request('/api/v1/nexus/jobs/' + identifier, a)
for suffix, method in [('', 'GET'), ('', 'DELETE'), ('/file', 'GET'), ('/verification', 'GET'), ('/verification/click', 'POST')]:
    data = {'revision': str(uuid.uuid4()), 'x': 40, 'y': 50} if method == 'POST' else None
    request('/api/v1/nexus/jobs/' + identifier + suffix, b, data, expected=404, method=method)
verify(True, 'another account cannot poll, cancel, download, view or operate verification')
content, headers = request('/api/v1/nexus/jobs/' + identifier + '/file', a, binary=True)
verify(content == fixture_bytes and hashlib.sha256(content).hexdigest() == job['sha256'], 'gateway streams exact file bytes and checksum')
picture, _ = request('/api/v1/nexus/jobs/' + identifier + '/verification', a)
verify(len(picture['image']) > 16384, 'verification images can exceed normal metadata size')
request('/api/v1/nexus/jobs/' + identifier + '/verification/click', a, {'revision': str(uuid.uuid4()), 'x': 40, 'y': 50})
calls = len(backend_calls)
request('/api/v1/nexus/jobs/' + identifier + '/verification/click', a, {'revision': str(uuid.uuid4()), 'x': -1, 'y': 50}, expected=400)
request('/api/v1/nexus/jobs', a, {**payload, 'domain': 'https://example.invalid'}, expected=400)
request('/api/v1/nexus/maintenance', a, expected=404)
verify(len(backend_calls) == calls, 'invalid inputs and private maintenance routes cannot reach the worker')
for status in [429, 409, 503]:
    error, headers = request('/api/v1/nexus/jobs', a, {**payload, 'modId': str(status)}, expected=status)
    verify('private diagnostic' not in json.dumps(error), 'worker error ' + str(status) + ' is sanitized')
    if status == 429:
        verify(headers['Retry-After'] == '10', 'worker throttling retains retry guidance')
db.execute("UPDATE FeatureDefinitions SET Enabled=0 WHERE Key='library.manage'")
db.commit()
calls = len(backend_calls)
request('/api/v1/nexus/status', a, expected=403)
request('/api/v1/nexus/jobs/' + identifier + '/verification', a, expected=403)
verify(len(backend_calls) == calls, 'live permission denial blocks worker and verification access')
db.execute("UPDATE FeatureDefinitions SET Enabled=1 WHERE Key='library.manage'")
db.commit()
request('/api/v1/auth/logout', b, expected=204, method='POST')
request('/api/v1/nexus/status', b, expected=401)
verify(True, 'revoked MU session is rejected by the restored gateway')
for path in ['/api/v1/presets?gameKey=steam%3A1245620', '/api/v1/wishes', '/api/v1/compatibility/public/games']:
    request(path, a)
verify(True, 'presets, wishes and public compatibility preserved')
metadata = {'user': alice, 'orders': orders, 'checks': checks}
with open(database.rsplit('/', 1)[0] + '/runtime-check.json', 'w') as destination:
    json.dump(metadata, destination)
print('Payments and Nexus gateway integration passed: ' + str(checks) + ' assertions.')
backend.shutdown()
