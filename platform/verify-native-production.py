import hashlib
import json
import pathlib
import subprocess
import urllib.error
import urllib.request

root = pathlib.Path('/home/xrw/moddock-studio')
release = root.joinpath('current').resolve()
state = json.loads((root / ('deployment-' + release.name + '.json')).read_text())
assert release.name == '20261016-engines-8841de1a'
for name, expected in json.loads((release / 'service-manifest.json').read_text())['hashes'].items():
    assert hashlib.sha256((release / name).read_bytes()).hexdigest() == expected
account = pathlib.Path('/home/xrw/amd-dlss-mu-account')
assert account.joinpath('current').readlink().as_posix() == state['accountRelease']
for name, expected in state['accountHashes'].items():
    assert hashlib.sha256((account / 'current' / name).read_bytes()).hexdigest() == expected
for name, expected in state['configHashes'].items():
    assert hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest() == expected
private = dict(line.split('=', 1) for line in (root / 'service.env').read_text().splitlines() if line and not line.startswith('#') and '=' in line)
request = urllib.request.Request('http://' + private['MODDOCK_STUDIO_HOST'] + ':' + private['MODDOCK_STUDIO_PORT'] + '/status', headers={'Authorization': 'Bearer ' + private['MODDOCK_STUDIO_TOKEN'], 'X-Mu-Account-Id': 'native-production-check'})
with urllib.request.urlopen(request, timeout=10) as response:
    status = json.load(response)
assert status['ready'] and status['harness'] == 'pi-agent'
checks = {}
for route, method, expected in [('/api/health', 'GET', 200), ('/api/v1/plans', 'GET', 200), ('/api/v1/studio/plan', 'POST', 401), ('/api/v1/nexus/status', 'GET', 401)]:
    command = ['curl', '--silent', '--show-error', '--max-time', '15', '-o', '/dev/null', '-w', '%{http_code}', '-X', method]
    if method == 'POST':
        command += ['-H', 'Content-Type: application/json', '-d', '{}']
    checks[route] = int(subprocess.check_output(command + ['https://mu-api.claude-api.cn' + route], text=True))
    if checks[route] != expected:
        raise RuntimeError('Public route ' + route + ' returned ' + str(checks[route]) + ', expected ' + str(expected))
result = {'passed': True, 'studioRelease': release.name, 'privatePiReady': True, 'accountReleaseUnchanged': True, 'accountConfigurationUnchanged': True, 'publicProbe': 'curl', 'publicRoutes': checks}
(root / 'incoming/native-production-verification.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result))
