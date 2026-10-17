import fcntl
import hashlib
import json
import os
import pathlib
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request

os.umask(0o077)
root = pathlib.Path('/home/xrw/moddock-studio')
account = pathlib.Path('/home/xrw/amd-dlss-mu-account')
state_file = pathlib.Path(next((arg for arg in sys.argv[1:] if arg != '--rollback'), str(root / 'pi-deployment-20261016-pi-agent-3115d60b.json')))
assert state_file.parent == root and state_file.name.startswith('pi-deployment-20261016-pi-agent-')
state = json.loads(state_file.read_text())
rehearsal = pathlib.Path(state['rehearsal'])
def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()
def link(directory, target):
    temporary = directory / ('current.pi-' + str(os.getpid()))
    temporary.symlink_to(target)
    temporary.replace(directory / 'current')
def compose(*args):
    subprocess.run(['docker', 'compose', *args], cwd=account, check=True)
def healthy():
    for attempt in range(40):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8089/api/health', timeout=2) as response:
                if response.status == 200: return
        except Exception: pass
        time.sleep(1)
    raise RuntimeError('Production account health timeout')
def private_status():
    config = dict(line.split('=', 1) for line in (root / 'service.env').read_text().splitlines() if line and not line.startswith('#') and '=' in line)
    request = urllib.request.Request('http://' + config['MODDOCK_STUDIO_HOST'] + ':' + config['MODDOCK_STUDIO_PORT'] + '/status', headers={'Authorization': 'Bearer ' + config['MODDOCK_STUDIO_TOKEN'], 'X-Mu-Account-Id': 'pi-cutover-health'})
    with urllib.request.urlopen(request, timeout=3) as response: return json.load(response)
def request(route, expected=200, body=None):
    request = urllib.request.Request('http://127.0.0.1:8089' + route, headers={'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json'}, data=None if body is None else json.dumps(body).encode())
    try: response = urllib.request.urlopen(request, timeout=10)
    except urllib.error.HTTPError as error: response = error
    assert response.status == expected, route + ': unexpected status ' + str(response.status)
    data = response.read()
    return json.loads(data) if data else None
with (account / 'backups/.backup.lock').open('a') as lock, (root / '.pi-deploy.lock').open('a') as studio_lock:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    fcntl.flock(studio_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if '--rollback' in sys.argv:
        compose('stop', '--timeout', '30', 'account')
        subprocess.run(['systemctl', '--user', 'stop', 'moddock-studio'], check=True)
        link(account, state['previousAccount']); link(root, state['previousStudio'])
        subprocess.run(['systemctl', '--user', 'start', 'moddock-studio'], check=True)
        compose('up', '-d', '--force-recreate', 'account'); healthy()
        print('Previous schema-5 account and studio releases restored; all current database writes retained.', flush=True)
        sys.exit(0)
    assert os.readlink(account / 'current') == state['previousAccount']
    assert os.readlink(root / 'current') == state['previousStudio']
    for name, expected in state['baseline'].items(): assert digest(account / 'current' / name) == expected, name
    for file, expected in state['configHashes'].items(): assert digest(pathlib.Path(file)) == expected, file
    assert (rehearsal / 'studio-runtime-verified').is_file()
    runtime_report = json.loads((rehearsal / 'runtime/studio-check.json').read_text())
    browser_report = json.loads((rehearsal / 'browser-check.json').read_text())
    assert runtime_report['realModelUsed'] and 'thinking_delta' in runtime_report['piEventTypes']
    assert browser_report['passed'] and browser_report['realModelUsed'] and browser_report['piHarness']
    assert browser_report['release'] == state['release']
    service = root / 'releases' / state['release']
    gateway = account / 'releases' / state['gatewayRelease']
    manifest = json.loads((service / 'service-manifest.json').read_text())
    for name, expected in manifest['hashes'].items(): assert digest(service / name) == expected, name
    for name, expected in state['baseline'].items():
        assert digest(gateway / name) == (state['gatewayHash'] if name == 'Mu.NexusGateway.dll' else expected), name
    backup = account / 'backups' / ('pi-cutover-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()))
    backup.mkdir(mode=0o700)
    for name in ['.env', 'compose.yml']: shutil.copy2(account / name, backup / name)
    shutil.copytree(account / 'data/keys', backup / 'keys')
    (backup / 'previous-releases.json').write_text(json.dumps({'account': state['previousAccount'], 'studio': state['previousStudio']}))
    maintenance = backup / 'maintenance.json'
    maintenance.write_text(json.dumps({'services': {'account': {'environment': {'Maintenance__Enabled': 'true'}}}}))
    try:
        print('Closing account writes and stopping the previous studio for the verified cutover.', flush=True)
        compose('stop', '--timeout', '30', 'account')
        subprocess.run(['systemctl', '--user', 'stop', 'moddock-studio'], check=True)
        for name in ['accounts', 'mail-logs']:
            original = sqlite3.connect('file:' + str(account / ('data/' + name + '.sqlite')) + '?mode=ro', uri=True)
            saved = sqlite3.connect(str(backup / (name + '.sqlite')))
            original.backup(saved)
            assert saved.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
            assert not saved.execute('PRAGMA foreign_key_check').fetchall()
            original.close(); saved.close()
        print('Final account/mail backups and integrity checks completed.', flush=True)
        link(account, 'releases/' + state['gatewayRelease']); link(root, 'releases/' + state['release'])
        subprocess.run(['systemctl', '--user', 'start', 'moddock-studio'], check=True)
        for attempt in range(30):
            try:
                status = private_status()
                assert status.get('harness') == 'pi-agent' and status['ready']
                break
            except Exception: time.sleep(1)
        else: raise RuntimeError('Production Pi health timeout')
        compose('-f', 'compose.yml', '-f', str(maintenance), 'up', '-d', '--force-recreate', 'account'); healthy()
        subprocess.run(['python3', str(pathlib.Path(state.get('incoming', root / 'incoming/pi-20261016')) / 'verify-data.py'), str(backup / 'accounts.sqlite'), str(account / 'data/accounts.sqlite'), str(backup / 'mail-logs.sqlite'), str(account / 'data/mail-logs.sqlite')], check=True)
        for file, expected in state['configHashes'].items(): assert digest(pathlib.Path(file)) == expected, file
        for file in (backup / 'keys').rglob('*'):
            if file.is_file(): assert digest(file) == digest(account / 'data/keys' / file.relative_to(backup / 'keys'))
        actual_gateway = subprocess.check_output(['docker', 'exec', 'amd-dlss-mu-account', 'sha256sum', '/app/Mu.NexusGateway.dll'], text=True).split()[0]
        assert actual_gateway == state['gatewayHash']
        compose('up', '-d', '--force-recreate', 'account'); healthy()
        plans = request('/api/v1/plans')
        assert plans['paymentsEnabled'] and plans['paymentMethod'] == 'manual'
        assert sorted((plan['priceMinor'], plan['durationDays'], plan['configurationSessions']) for plan in plans['items']) == [(990, 30, 0), (2990, 30, 1), (4990, 0, 0)]
        request('/api/v1/nexus/status', 401)
        request('/api/v1/studio/plan', 401, {'harness': 'pi-agent', 'prompt': 'Authentication probe only'})
        database = sqlite3.connect('file:' + str(account / 'data/accounts.sqlite') + '?mode=ro', uri=True)
        assert database.execute('SELECT Version FROM DatabaseSchemas WHERE Id=1').fetchone()[0] == 5
        assert database.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        database.close()
        state.update(activatedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), cutover=str(backup), productionPi=status, schema=5)
        state_file.write_text(json.dumps(state, indent=2))
        print(json.dumps({'activated': True, 'studioRelease': state['release'], 'gatewayRelease': state['gatewayRelease'], 'schema': 5, 'databaseRowsPreserved': True, 'configurationPreserved': True, 'rollbackBackup': str(backup)}), flush=True)
    except BaseException:
        print('Cutover failed; restoring the previous service releases without restoring databases.', flush=True)
        link(account, state['previousAccount']); link(root, state['previousStudio'])
        subprocess.run(['systemctl', '--user', 'restart', 'moddock-studio'], check=False)
        subprocess.run(['docker', 'compose', 'up', '-d', '--force-recreate', 'account'], cwd=account, check=False)
        raise
