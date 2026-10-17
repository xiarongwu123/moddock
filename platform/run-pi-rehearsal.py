import json
import os
import pathlib
import re
import subprocess
import time
import urllib.request

root = pathlib.Path('/home/xrw/moddock-studio')
state = json.loads((root / 'pi-deployment-20261016-pi-agent-3115d60b.json').read_text())
rehearsal = pathlib.Path(state['rehearsal'])
container = json.loads(subprocess.check_output(['docker', 'inspect', 'amd-dlss-mu-account'], text=True))[0]
config = dict(value.split('=', 1) for value in container['Config']['Env'])
config.update(ASPNETCORE_URLS='http://127.0.0.1:18098', Database__Path='/data/accounts.sqlite', DataProtection__Path='/data/keys', Studio__BackendUrl='http://127.0.0.1:8096', Maintenance__Enabled='false', Email__Provider='smtp', Smtp__Host='127.0.0.1', Smtp__Port='9', Smtp__AllowPrivatePlaintext='true', Smtp__StartTls='false')
previous = subprocess.run(['docker', 'inspect', state['candidateContainer']], capture_output=True, text=True)
if previous.returncode == 0:
    previous = json.loads(previous.stdout)[0]
    assert previous['Config']['Labels'].get('moddock.pi.rehearsal') == state['release'] and not previous['State']['Running']
    subprocess.run(['docker', 'rm', state['candidateContainer']], check=True, stdout=subprocess.DEVNULL)
command = ['docker', 'run', '-d', '--name', state['candidateContainer'], '--label', 'moddock.pi.rehearsal=' + state['release'], '--network', 'host', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '-v', '/home/xrw/amd-dlss-mu-account/releases/' + state['gatewayRelease'] + ':/app:ro', '-v', str(rehearsal / 'runtime') + ':/data', '-w', '/app']
for key in config:
    command += ['-e', key]
if container['Config'].get('User'):
    command += ['--user', container['Config']['User']]
command += [container['Config']['Image'], 'dotnet', 'Mu.Server.dll']
runtime_env = dict(os.environ)
runtime_env.update(config)
subprocess.run(command, env=runtime_env, check=True, stdout=subprocess.DEVNULL)
for attempt in range(20):
    status = json.loads(subprocess.check_output(['docker', 'inspect', state['candidateContainer']], text=True))[0]['State']
    if not status['Running']:
        result = subprocess.run(['docker', 'logs', state['candidateContainer'], '--tail', '40'], capture_output=True, text=True)
        output = re.sub(r'\bsk-[\w-]+|Bearer\s+\S+', '[redacted]', result.stdout + result.stderr)
        print(output[-8000:], flush=True)
        raise RuntimeError('Isolated MU candidate exited')
    try:
        with urllib.request.urlopen('http://127.0.0.1:18098/api/health', timeout=2) as response:
            assert response.status == 200
        print('Isolated MU gateway ready; production unchanged.', flush=True)
        break
    except Exception:
        time.sleep(1)
else:
    raise RuntimeError('Isolated MU health timeout')
