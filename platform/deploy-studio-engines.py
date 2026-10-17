import hashlib
import json
import os
import pathlib
import signal
import subprocess
import sys
import tarfile
import time
import urllib.request

os.umask(0o077)
root = pathlib.Path('/home/xrw/moddock-studio')
account = pathlib.Path('/home/xrw/amd-dlss-mu-account')
runtime = '/home/xrw/moddock-nexus/runtime/electron/electron'
mode, checksum = sys.argv[1:3]
assert len(checksum) == 64 and all(char in '0123456789abcdef' for char in checksum)
release = '20261016-engines-' + checksum[:8]
destination = root / 'releases' / release
state_file = root / ('deployment-' + release + '.json')
runtime_env = dict(os.environ, ELECTRON_RUN_AS_NODE='1', LD_LIBRARY_PATH='/home/xrw/moddock-nexus/runtime/native/usr/lib/x86_64-linux-gnu', TMPDIR=str(root / 'tmp'))
private = dict(line.split('=', 1) for line in (root / 'service.env').read_text().splitlines() if line and not line.startswith('#') and '=' in line)
runtime_env.update(private)

def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()

def verify_files():
    manifest = json.loads((destination / 'service-manifest.json').read_text())
    for name, expected in manifest['hashes'].items():
        assert digest(destination / name) == expected, name

def health(port, host='127.0.0.1'):
    for attempt in range(30):
        try:
            request = urllib.request.Request('http://' + host + ':' + str(port) + '/status', headers={'Authorization': 'Bearer ' + private['MODDOCK_STUDIO_TOKEN'], 'X-Mu-Account-Id': 'authoring-health'})
            with urllib.request.urlopen(request, timeout=2) as response:
                result = json.load(response)
            assert result['ready'] and result['harness'] == 'pi-agent'
            return result
        except Exception:
            time.sleep(1)
    raise RuntimeError('Creation service health timeout')

def switch(target):
    link = root / ('current.authoring-' + str(os.getpid()))
    link.symlink_to(target)
    link.replace(root / 'current')

if mode == 'prepare':
    archive = root / 'incoming' / ('authoring-' + checksum[:8] + '.tar.gz')
    assert digest(archive) == checksum and not destination.exists() and not state_file.exists()
    destination.mkdir(mode=0o700)
    with tarfile.open(archive) as tar:
        for member in tar.getmembers():
            assert (member.isdir() or member.isfile()) and not pathlib.Path(member.name).is_absolute() and '..' not in pathlib.Path(member.name).parts
        tar.extractall(destination)
    verify_files()
    with (destination / 'runtime-install.log').open('w') as log:
        subprocess.run([runtime, str(root / 'tools/npm-11.6.2/package/bin/npm-cli.js'), 'ci', '--prefix', str(destination / 'platform'), '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', str(root / 'npm-cache')], env=runtime_env, stdout=log, stderr=log, check=True, timeout=600)
    candidate_env = dict(runtime_env, MODDOCK_STUDIO_HOST='127.0.0.1', MODDOCK_STUDIO_PORT='8096')
    with (destination / 'candidate.log').open('w') as log:
        candidate = subprocess.Popen([runtime, str(destination / 'platform/studio-service.cjs')], env=candidate_env, stdout=log, stderr=log, start_new_session=True)
    state = {'release': release, 'previous': os.readlink(root / 'current'), 'candidatePid': candidate.pid, 'accountRelease': os.readlink(account / 'current'),
             'accountHashes': {name: digest(account / 'current' / name) for name in ['Mu.Server.dll', 'Mu.NexusGateway.dll']},
             'configHashes': {str(file): digest(file) for file in [account / '.env', account / 'compose.yml', root / 'service.env']}}
    state_file.write_text(json.dumps(state, indent=2))
    health(8096)
    print(json.dumps({'release': release, 'candidateReady': True, 'accountUnchanged': True}), flush=True)
elif mode == 'verify':
    health(8096)
    subprocess.run([runtime, str(root / 'incoming/verify-engine-authoring.cjs'), str(destination)], env=runtime_env, check=True, timeout=1250)
elif mode in ['activate', 'rollback']:
    state = json.loads(state_file.read_text())
    assert os.readlink(account / 'current') == state['accountRelease']
    for name, expected in state['accountHashes'].items(): assert digest(account / 'current' / name) == expected
    for file, expected in state['configHashes'].items(): assert digest(pathlib.Path(file)) == expected
    if mode == 'activate':
        assert os.readlink(root / 'current') == state['previous']
        verify_files()
        report = json.loads((destination / 'engine-authoring-check.json').read_text())
        assert report['passed'] and report['serviceRelease'] == release
        assert {entry['family'] for entry in report['results']} == {'rpgmaker', 'renpy'}
        for entry in report['results']:
            assert entry['passed'] and entry['realPiUsed'] and entry['staticBuildPassed']
            assert entry['logicSandboxPassed'] if entry['family'] == 'rpgmaker' else entry['pythonCompilerPassed']
            assert all(name in entry['tools'] for name in ['list_game_files', 'read_game_file', 'write_project_file', 'validate_project', 'submit_result'])
    subprocess.run(['systemctl', '--user', 'stop', 'moddock-studio'], check=True)
    try:
        switch('releases/' + release if mode == 'activate' else state['previous'])
        subprocess.run(['systemctl', '--user', 'start', 'moddock-studio'], check=True)
        health(int(private['MODDOCK_STUDIO_PORT']), private['MODDOCK_STUDIO_HOST'])
    except Exception:
        switch(state['previous'])
        subprocess.run(['systemctl', '--user', 'restart', 'moddock-studio'], check=True)
        raise
    if mode == 'activate':
        command = pathlib.Path('/proc/' + str(state['candidatePid']) + '/cmdline')
        if command.exists() and str(destination / 'platform/studio-service.cjs').encode() in command.read_bytes(): os.kill(state['candidatePid'], signal.SIGTERM)
    print(json.dumps({'status': mode, 'studioRelease': os.readlink(root / 'current'), 'accountUnchanged': True}), flush=True)
else:
    raise RuntimeError('Unsupported deployment action')
