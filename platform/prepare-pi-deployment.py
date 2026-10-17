import base64
import hashlib
import json
import os
import pathlib
import shutil
import sqlite3
import subprocess
import tarfile
import time
import urllib.request
import sys

os.umask(0o077)
root = pathlib.Path('/home/xrw/moddock-studio')
account = pathlib.Path('/home/xrw/amd-dlss-mu-account')
service_hash = sys.argv[1] if len(sys.argv) > 1 else '3115d60bf8a0f01688fdc3ca57ddf1bf7c53298a2f4e618a5e037f580698e093'
assert len(service_hash) == 64 and all(char in '0123456789abcdef' for char in service_hash)
gateway_hash = '4002536d88191357d0298e3d335f6cb74ee030711533b653683a359544660358'
server_hash = 'e94ad754d3a5b95897fb6d83525dd594c8c9d9da0856ef71c714f599984e3bf0'
old_gateway = '4b8aae5837c46dac78bdb452d67c9b98b690e165aa9e3ed36a55ae12204508b6'
release = '20261016-pi-agent-' + service_hash[:8]
gateway_release = '20261016-pi-gateway-' + gateway_hash[:8]
incoming = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else root / 'incoming/pi-20261016'
assert incoming.parent == root / 'incoming'
destination = root / 'releases' / release
candidate_gateway = account / 'releases' / gateway_release
rehearsal = account / 'backups' / ('payments-rehearsal-studio-pi-' + release)
state_file = root / ('pi-deployment-' + release + '.json')
def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()
def extract(archive, target):
    target.mkdir(mode=0o700)
    with tarfile.open(archive) as tar:
        for member in tar.getmembers():
            assert (member.isdir() or member.isfile()) and not pathlib.Path(member.name).is_absolute()
            assert '..' not in pathlib.Path(member.name).parts
        tar.extractall(target)
def env(file):
    return dict(line.split('=', 1) for line in file.read_text().splitlines() if line and not line.startswith('#') and '=' in line)
assert digest(account / 'current/Mu.Server.dll') == server_hash
assert digest(account / 'current/Mu.NexusGateway.dll') == old_gateway
assert digest(incoming / 'pi-agent-20261016-service.tar.gz') == service_hash
assert digest(incoming / 'Mu.NexusGateway.dll') == gateway_hash
assert not destination.exists() and not rehearsal.exists()
extract(incoming / 'pi-agent-20261016-service.tar.gz', destination)
manifest = json.loads((destination / 'service-manifest.json').read_text())
for name, expected in manifest['hashes'].items():
    assert digest(destination / name) == expected, name
tools = root / 'tools'
tools.mkdir(exist_ok=True)
npm = tools / 'npm-11.6.2'
expected_npm = '7iKzNfy8lWYs3zq4oFPa8EXZz5xt9gQNKJZau3B1ErLBb6bF7sBJ00x09485DOvRT2l5Gerbl3VlZNT57MxJVA=='
assert base64.b64encode(hashlib.sha512((incoming / 'npm-11.6.2.tgz').read_bytes()).digest()).decode() == expected_npm
if not npm.exists():
    extract(incoming / 'npm-11.6.2.tgz', npm)
runtime = pathlib.Path('/home/xrw/moddock-nexus/runtime/electron/electron')
runtime_env = dict(os.environ, ELECTRON_RUN_AS_NODE='1', LD_LIBRARY_PATH='/home/xrw/moddock-nexus/runtime/native/usr/lib/x86_64-linux-gnu', TMPDIR=str(root / 'tmp'))
(root / 'tmp').mkdir(exist_ok=True)
print('Installing pinned Pi dependencies using the existing Node 24 runtime.', flush=True)
with (destination / 'runtime-install.log').open('w') as log:
    subprocess.run([str(runtime), str(npm / 'package/bin/npm-cli.js'), 'ci', '--prefix', str(destination / 'platform'), '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', str(root / 'npm-cache')], env=runtime_env, stdout=log, stderr=log, check=True, timeout=600)
baseline = {str(file.relative_to(account / 'current')): digest(file) for file in (account / 'current').rglob('*') if file.is_file()}
if not candidate_gateway.exists():
    shutil.copytree(account / 'current', candidate_gateway)
    shutil.copy2(incoming / 'Mu.NexusGateway.dll', candidate_gateway / 'Mu.NexusGateway.dll')
assert digest(candidate_gateway / 'Mu.NexusGateway.dll') == gateway_hash
assert all(digest(candidate_gateway / name) == value for name, value in baseline.items() if name != 'Mu.NexusGateway.dll')
(rehearsal / 'runtime/keys').mkdir(parents=True, mode=0o700)
for name in ['accounts', 'mail-logs']:
    source = sqlite3.connect('file:' + str(account / ('data/' + name + '.sqlite')) + '?mode=ro', uri=True)
    target = sqlite3.connect(str(rehearsal / ('runtime/' + name + '.sqlite')))
    source.backup(target)
    assert target.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    target.close(); source.close()
private = env(root / 'service.env')
candidate_env = dict(runtime_env)
candidate_env.update(private)
candidate_env.update(MODDOCK_STUDIO_HOST='127.0.0.1', MODDOCK_STUDIO_PORT='8096')
with (rehearsal / 'candidate-studio.log').open('w') as log:
    candidate = subprocess.Popen([str(runtime), str(destination / 'platform/studio-service.cjs')], env=candidate_env, stdout=log, stderr=log, start_new_session=True)
(rehearsal / 'candidate-studio.pid').write_text(str(candidate.pid))
for attempt in range(30):
    try:
        request = urllib.request.Request('http://127.0.0.1:8096/status', headers={'Authorization': 'Bearer ' + private['MODDOCK_STUDIO_TOKEN'], 'X-Mu-Account-Id': 'pi-candidate-health'})
        with urllib.request.urlopen(request, timeout=2) as response:
            status = json.load(response)
        assert status['harness'] == 'pi-agent' and status['ready']
        break
    except Exception:
        if candidate.poll() is not None: raise RuntimeError('Candidate Pi service failed to start; inspect its private log')
        time.sleep(1)
else: raise RuntimeError('Candidate Pi service health timeout')
container = json.loads(subprocess.check_output(['docker', 'inspect', 'amd-dlss-mu-account'], text=True))[0]
config = dict(value.split('=', 1) for value in container['Config']['Env'])
config.update(ASPNETCORE_URLS='http://127.0.0.1:18098', Database__Path='/data/accounts.sqlite', DataProtection__Path='/data/keys', Studio__BackendUrl='http://127.0.0.1:8096', Maintenance__Enabled='false', Email__Provider='smtp', Smtp__Host='127.0.0.1', Smtp__Port='9', Smtp__AllowPrivatePlaintext='true', Smtp__StartTls='false')
container_name = 'mu-pi-rehearsal-' + service_hash[:8]
command = ['docker', 'run', '-d', '--name', container_name, '--label', 'moddock.pi.rehearsal=' + release, '--network', 'host', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-v', str(candidate_gateway) + ':/app:ro', '-v', str(rehearsal / 'runtime') + ':/data', '-w', '/app']
for key in config:
    command += ['-e', key]
if container['Config'].get('User'):
    command += ['--user', container['Config']['User']]
command += [container['Config']['Image'], 'dotnet', 'Mu.Server.dll']
docker_env = dict(os.environ)
docker_env.update(config)
subprocess.run(command, env=docker_env, check=True, stdout=subprocess.DEVNULL)
state = {'release': release, 'gatewayRelease': gateway_release, 'rehearsal': str(rehearsal), 'incoming': str(incoming), 'candidatePid': candidate.pid, 'candidateContainer': container_name,
         'previousStudio': os.readlink(root / 'current'), 'previousAccount': os.readlink(account / 'current'), 'baseline': baseline,
         'gatewayHash': gateway_hash, 'configHashes': {str(file): digest(file) for file in [account / '.env', account / 'compose.yml', root / 'service.env']}}
state_file.write_text(json.dumps(state, indent=2)); state_file.chmod(0o600)
for attempt in range(30):
    try:
        with urllib.request.urlopen('http://127.0.0.1:18098/api/health', timeout=2) as response: assert response.status == 200
        break
    except Exception: time.sleep(1)
else: raise RuntimeError('Isolated MU rehearsal health timeout')
print(json.dumps({'state': str(state_file), 'candidatePi': status, 'rehearsalOrigin': 'http://127.0.0.1:18098', 'productionUnchanged': True}), flush=True)
