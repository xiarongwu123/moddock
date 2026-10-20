"""Run on MU host: prepare|activate|rollback|stop-candidate PATCH_SHA256.

Preserves the payment binary, existing data and secrets. Candidate uses a SQLite
backup and real existing service configuration, with mail disabled by port 9.
"""
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
import tarfile
import time
import urllib.request

os.umask(0o077)
root = pathlib.Path('/home/xrw/moddock-studio')
account = pathlib.Path('/home/xrw/amd-dlss-mu-account')
incoming = root / 'incoming/quota-20261020'
mode, checksum = sys.argv[1:3]
assert len(checksum) == 64 and all(c in '0123456789abcdef' for c in checksum)
release = '20261020-ai-quota-' + checksum[:8]
destination = root / 'releases' / release
gateway = account / 'releases' / release
rehearsal = account / 'backups' / ('payments-rehearsal-studio-' + release)
state_file = root / ('deployment-' + release + '.json')
runtime = '/home/xrw/moddock-nexus/runtime/electron/electron'

def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()

def env(file):
    return dict(line.split('=', 1) for line in file.read_text().splitlines() if line and not line.startswith('#') and '=' in line)

def link(directory, target):
    temporary = directory / ('current.quota-' + str(os.getpid()))
    temporary.symlink_to(target)
    temporary.replace(directory / 'current')

def compose(*args):
    subprocess.run(['docker', 'compose', *args], cwd=account, check=True, stdout=subprocess.DEVNULL)

def backup_databases(target):
    target.mkdir(parents=True, mode=0o700, exist_ok=True)
    for name in ['accounts', 'mail-logs']:
        source = sqlite3.connect('file:' + str(account / ('data/' + name + '.sqlite')) + '?mode=ro', uri=True)
        saved = sqlite3.connect(str(target / (name + '.sqlite')))
        source.backup(saved)
        assert saved.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not saved.execute('PRAGMA foreign_key_check').fetchall()
        saved.close(); source.close()

def wait_health(url):
    for _ in range(40):
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError('Health timeout: ' + url)

def private_status(host, port):
    private = env(root / 'service.env')
    request = urllib.request.Request('http://' + host + ':' + str(port) + '/status', headers={
        'Authorization': 'Bearer ' + private['MODDOCK_STUDIO_TOKEN'], 'X-Mu-Account-Id': 'quota-health'})
    with urllib.request.urlopen(request, timeout=3) as response:
        return json.load(response)

if mode == 'prepare':
    archive = incoming / 'quota-patch.tar.gz'
    assert digest(archive) == checksum
    assert not destination.exists() and not gateway.exists() and not state_file.exists()
    if (root / 'current').resolve().name.startswith('20261020-ai-quota-'):
        previous_state = json.loads((root / ('deployment-' + (root / 'current').resolve().name + '.json')).read_text())
        assert all(digest(root / 'current' / name) == value for name, value in previous_state['hashes'].items())
    else:
        assert digest(root / 'current/platform/studio-service.cjs') == '248e3a1712d9d15d592ae65f7eeb51d11623d9c266586473b38d62d699f53ddb'
        assert digest(root / 'current/platform/studio-pi.mjs') == 'fd3ab5c61d23a6a173254aa34278b8862f46d41658fbc73f2f97813312ae622f'
    # Reuse the exact installed dependencies. No unrelated authoring changes.
    shutil.copytree(root / 'current', destination, ignore=shutil.ignore_patterns('node_modules', 'candidate-tasks', '*.log'))
    for relative in ['node_modules', 'platform/node_modules']:
        (destination / relative).symlink_to((root / 'current' / relative).resolve(), target_is_directory=True)
    with tarfile.open(archive) as tar:
        for member in tar.getmembers():
            assert member.isfile() and member.name in ['ai-policy.cjs', 'platform/ai-ledger.cjs', 'platform/ai-ledger.sql', 'platform/ai-meter.mjs', 'platform/reconcile-ai-usage.cjs', 'platform/studio-pi.mjs', 'platform/studio-service.cjs', 'platform/studio-tasks.cjs']
        tar.extractall(destination)
    hashes = {name: digest(destination / name) for name in [m.name for m in tarfile.open(archive).getmembers()]}
    shutil.copytree(account / 'current', gateway)
    shutil.copy2(incoming / 'gateway/out/Mu.NexusGateway.dll', gateway / 'Mu.NexusGateway.dll')
    baseline = {str(file.relative_to(account / 'current')): digest(file) for file in (account / 'current').rglob('*') if file.is_file()}
    assert all(digest(gateway / name) == value for name, value in baseline.items() if name != 'Mu.NexusGateway.dll')
    backup_databases(rehearsal / 'runtime')
    (rehearsal / 'runtime/keys').mkdir(mode=0o700)
    private = env(root / 'service.env')
    environment = dict(os.environ, **private, ELECTRON_RUN_AS_NODE='1', LD_LIBRARY_PATH='/home/xrw/moddock-nexus/runtime/native/usr/lib/x86_64-linux-gnu')
    environment.update(MODDOCK_STUDIO_HOST='127.0.0.1', MODDOCK_STUDIO_PORT='8096', MODDOCK_STUDIO_TASKS=str(rehearsal / 'tasks'),
                       MODDOCK_AI_DATABASE=str(rehearsal / 'runtime/accounts.sqlite'), MODDOCK_AI_ACCOUNT_URL='http://127.0.0.1:18098/internal/moddock/ai-account')
    with (rehearsal / 'candidate.log').open('w') as log:
        candidate = subprocess.Popen([runtime, str(destination / 'platform/studio-service.cjs')], env=environment, stdout=log, stderr=log, start_new_session=True)
    container = json.loads(subprocess.check_output(['docker', 'inspect', 'amd-dlss-mu-account'], text=True))[0]
    config = dict(value.split('=', 1) for value in container['Config']['Env'])
    config.update(ASPNETCORE_URLS='http://127.0.0.1:18098', Database__Path='/data/accounts.sqlite', DataProtection__Path='/data/keys', Studio__BackendUrl='http://127.0.0.1:8096',
                  Maintenance__Enabled='false', Email__Provider='smtp', Smtp__Host='127.0.0.1', Smtp__Port='9', Smtp__AllowPrivatePlaintext='true', Smtp__StartTls='false')
    name = 'mu-ai-quota-' + checksum[:8]
    command = ['docker', 'run', '-d', '--name', name, '--network', 'host', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-v', str(gateway) + ':/app:ro', '-v', str(rehearsal / 'runtime') + ':/data', '-w', '/app']
    for key in config:
        command += ['-e', key]
    if container['Config'].get('User'):
        command += ['--user', container['Config']['User']]
    command += [container['Config']['Image'], 'dotnet', 'Mu.Server.dll']
    subprocess.run(command, env=dict(os.environ, **config), check=True, stdout=subprocess.DEVNULL)
    state = dict(release=release, previousStudio=os.readlink(root / 'current'), previousAccount=os.readlink(account / 'current'), candidatePid=candidate.pid,
                 candidateContainer=name, rehearsal=str(rehearsal), baseline=baseline, hashes=hashes, gatewayHash=digest(gateway / 'Mu.NexusGateway.dll'),
                 configHashes={str(file): digest(file) for file in [account / '.env', account / 'compose.yml', root / 'service.env']})
    state_file.write_text(json.dumps(state, indent=2))
    wait_health('http://127.0.0.1:18098/api/health')
    assert private_status('127.0.0.1', 8096)['ready']
    print(json.dumps(dict(release=release, prepared=True, productionUnchanged=True, rehearsal=str(rehearsal))))
elif mode in ['activate', 'rollback']:
    state = json.loads(state_file.read_text())
    with (account / 'backups/.backup.lock').open('a') as lock, (root / '.pi-deploy.lock').open('a') as studio_lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB); fcntl.flock(studio_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if mode == 'activate':
            report = json.loads((rehearsal / 'quota-verification.json').read_text())
            assert report['passed'] and report['realModelUsed'] and report['ledgerMatchesUsage'] and report['accountSerialization']
            assert os.readlink(root / 'current') == state['previousStudio'] and os.readlink(account / 'current') == state['previousAccount']
            assert all(digest(pathlib.Path(file)) == value for file, value in state['configHashes'].items())
            assert all(digest(destination / file) == value for file, value in state['hashes'].items())
            assert digest(gateway / 'Mu.NexusGateway.dll') == state['gatewayHash']
            private = env(root / 'service.env')
            assert private_status(private['MODDOCK_STUDIO_HOST'], int(private['MODDOCK_STUDIO_PORT']))['activeTasks'] == 0
        backup = root / 'backups' / (mode + '-quota-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()))
        backup.mkdir(mode=0o700)
        shutil.copy2(root / 'service.env', backup / 'service.env')
        compose('stop', '--timeout', '30', 'account')
        subprocess.run(['systemctl', '--user', 'stop', 'moddock-studio'], check=True)
        try:
            backup_databases(backup)
            if mode == 'activate':
                text = (root / 'service.env').read_text()
                text += '\nMODDOCK_AI_DATABASE=/home/xrw/amd-dlss-mu-account/data/accounts.sqlite\nMODDOCK_AI_ACCOUNT_URL=http://127.0.0.1:8089/internal/moddock/ai-account\n'
                (root / 'service.env').write_text(text)
                link(root, 'releases/' + release); link(account, 'releases/' + release)
            else:
                original_backup = pathlib.Path(state['backup'])
                shutil.copy2(original_backup / 'service.env', root / 'service.env')
                link(root, state['previousStudio']); link(account, state['previousAccount'])
            if mode == 'activate':
                subprocess.run(['systemctl', '--user', 'start', 'moddock-studio'], check=True)
            compose('up', '-d', '--force-recreate', 'account')
            wait_health('http://127.0.0.1:8089/api/health')
            if mode == 'activate':
                private = env(root / 'service.env')
                assert private_status(private['MODDOCK_STUDIO_HOST'], int(private['MODDOCK_STUDIO_PORT']))['ready']
        except BaseException:
            shutil.copy2(backup / 'service.env', root / 'service.env')
            link(root, state['previousStudio']); link(account, state['previousAccount'])
            # The baseline has no quota enforcement. Keep inference paused on
            # rollback rather than reopening an unmetered provider path.
            subprocess.run(['systemctl', '--user', 'stop', 'moddock-studio'], check=True)
            compose('up', '-d', '--force-recreate', 'account')
            raise
        if mode == 'activate':
            state['backup'] = str(backup); state['activatedAt'] = time.time(); state_file.write_text(json.dumps(state, indent=2))
        print(json.dumps(dict(release=release, action=mode, healthy=True, aiPaused=mode == 'rollback', backup=str(backup), databaseWritesRetained=True)))
elif mode == 'stop-candidate':
    state = json.loads(state_file.read_text())
    command = pathlib.Path('/proc/' + str(state['candidatePid']) + '/cmdline')
    if command.exists() and str(destination / 'platform/studio-service.cjs').encode() in command.read_bytes():
        os.kill(state['candidatePid'], signal.SIGTERM)
    subprocess.run(['docker', 'stop', state['candidateContainer']], check=True, stdout=subprocess.DEVNULL)
    print('Candidate services stopped.')
else:
    raise RuntimeError('Unsupported deployment action')
