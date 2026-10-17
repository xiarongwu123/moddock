import hashlib
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import tarfile
import time
import urllib.request

os.umask(0o077)
root = pathlib.Path('/home/xrw/moddock-studio')
account = pathlib.Path('/home/xrw/amd-dlss-mu-account')
mode, checksum = sys.argv[1:3]
assert len(checksum) == 64 and all(char in '0123456789abcdef' for char in checksum)
release = '20261016-resume-' + checksum[:8]
destination = root / 'releases' / release
state_file = root / ('deployment-' + release + '.json')
runtime = '/home/xrw/moddock-nexus/runtime/electron/electron'
environment = dict(os.environ, ELECTRON_RUN_AS_NODE='1', LD_LIBRARY_PATH='/home/xrw/moddock-nexus/runtime/native/usr/lib/x86_64-linux-gnu', TMPDIR=str(root / 'tmp'))
private = dict(line.split('=', 1) for line in (root / 'service.env').read_text().splitlines() if line and not line.startswith('#') and '=' in line)
environment.update(private)

def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()

def health(host, port):
    for attempt in range(30):
        try:
            request = urllib.request.Request('http://' + host + ':' + str(port) + '/status', headers={'Authorization': 'Bearer ' + private['MODDOCK_STUDIO_TOKEN'], 'X-Mu-Account-Id': 'resume-health', 'Connection': 'close'})
            with urllib.request.urlopen(request, timeout=2) as response:
                status = json.load(response)
            assert status['ready'] and 'resumable-tasks' in status['capabilities']
            return status
        except Exception:
            time.sleep(1)
    raise RuntimeError('Resumable creation health timeout')

def verify_files():
    manifest = json.loads((destination / 'service-manifest.json').read_text())
    for name, expected in manifest['hashes'].items():
        assert digest(destination / name) == expected, name

def unchanged(state):
    assert os.readlink(account / 'current') == state['accountRelease']
    for name, expected in state['accountHashes'].items():
        assert digest(account / 'current' / name) == expected
    for name, expected in state['configHashes'].items():
        assert digest(pathlib.Path(name)) == expected

def switch(target):
    link = root / ('current.resume-' + str(os.getpid()))
    link.symlink_to(target)
    link.replace(root / 'current')

if mode == 'prepare':
    archive = root / 'incoming' / ('resume-' + checksum[:8] + '.tar.gz')
    assert digest(archive) == checksum and not destination.exists() and not state_file.exists()
    destination.mkdir(mode=0o700)
    with tarfile.open(archive) as tar:
        for member in tar.getmembers():
            assert (member.isdir() or member.isfile()) and not pathlib.Path(member.name).is_absolute() and '..' not in pathlib.Path(member.name).parts
        tar.extractall(destination)
    verify_files()
    previous = root / 'current'
    if digest(previous / 'platform/package-lock.json') == digest(destination / 'platform/package-lock.json'):
        shutil.copytree(previous / 'platform/node_modules', destination / 'platform/node_modules')
    else:
        with (destination / 'runtime-install.log').open('w') as log:
            subprocess.run([runtime, str(root / 'tools/npm-11.6.2/package/bin/npm-cli.js'), 'ci', '--prefix', str(destination / 'platform'), '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', str(root / 'npm-cache')], env=environment, stdout=log, stderr=log, check=True, timeout=600)
    candidate_env = dict(environment, MODDOCK_STUDIO_HOST='127.0.0.1', MODDOCK_STUDIO_PORT='8096', MODDOCK_STUDIO_TASKS=str(destination / 'candidate-tasks'))
    with (destination / 'candidate.log').open('w') as log:
        candidate = subprocess.Popen([runtime, str(destination / 'platform/studio-service.cjs')], env=candidate_env, stdout=log, stderr=log, start_new_session=True)
    state = {'release': release, 'previous': os.readlink(root / 'current'), 'candidatePid': candidate.pid, 'accountRelease': os.readlink(account / 'current'),
             'accountHashes': {name: digest(account / 'current' / name) for name in ['Mu.Server.dll', 'Mu.NexusGateway.dll']},
             'configHashes': {str(file): digest(file) for file in [account / '.env', account / 'compose.yml', root / 'service.env']}}
    state_file.write_text(json.dumps(state, indent=2))
    status = health('127.0.0.1', 8096)
    print(json.dumps({'release': release, 'candidateReady': True, 'accountUnchanged': True, 'capabilities': status['capabilities']}), flush=True)
elif mode == 'verify':
    health('127.0.0.1', 8096)
    command = [runtime, str(root / 'incoming/verify-studio-resume.cjs'), str(destination)]
    if len(sys.argv) > 3:
        baseline = sys.argv[3]
        assert baseline.startswith('20261016-resume-') and '/' not in baseline
        command.append(str(root / 'releases' / baseline))
    subprocess.run(command, env=environment, check=True, timeout=630)
elif mode == 'activate':
    state = json.loads(state_file.read_text()); unchanged(state); verify_files()
    report = json.loads((destination / 'resume-verification.json').read_text())
    assert report['passed'] and report['realPiUsed'] and report['oneWorker'] and report['creatorSessions'] == 1 and report['checkpointMatchesArtifact'] and report['compilerPassed']
    assert report['clientSha256'] == digest(destination / 'studio-mu-client.cjs')
    assert report['serviceRelease'] == release
    assert os.readlink(root / 'current') == state['previous']
    # Existing clients finish before the private service switches releases.
    for attempt in range(60):
        connections = subprocess.check_output(['ss', '-Htn', 'state', 'established', 'sport', '=', ':' + private['MODDOCK_STUDIO_PORT']], text=True).strip()
        active = health(private['MODDOCK_STUDIO_HOST'], private['MODDOCK_STUDIO_PORT']).get('activeTasks', 0)
        if not connections and not active:
            break
        time.sleep(1)
    else:
        raise RuntimeError('Creation tasks still connected; cutover deferred')
    backup = root / 'backups' / ('resume-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()))
    backup.mkdir(parents=True, mode=0o700)
    (backup / 'previous-release.json').write_text(json.dumps(state))
    subprocess.run(['systemctl', '--user', 'stop', 'moddock-studio'], check=True)
    try:
        switch('releases/' + release)
        subprocess.run(['systemctl', '--user', 'start', 'moddock-studio'], check=True)
        status = health(private['MODDOCK_STUDIO_HOST'], private['MODDOCK_STUDIO_PORT']); unchanged(state)
    except BaseException:
        switch(state['previous']); subprocess.run(['systemctl', '--user', 'restart', 'moddock-studio'], check=True)
        raise
    command = pathlib.Path('/proc/' + str(state['candidatePid']) + '/cmdline')
    if command.exists() and str(destination / 'platform/studio-service.cjs').encode() in command.read_bytes():
        os.kill(state['candidatePid'], signal.SIGTERM)
    state.update(activatedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), backup=str(backup), status=status)
    state_file.write_text(json.dumps(state, indent=2))
    print(json.dumps({'activated': True, 'release': release, 'accountUnchanged': True, 'backup': str(backup)}), flush=True)
else:
    raise RuntimeError('Unsupported deployment action')
