import hashlib
import json
import os
import pathlib
import shutil
import sqlite3
import subprocess
import urllib.request

home = pathlib.Path('/home/xrw')
account = home / 'amd-dlss-mu-account'
studio = home / 'moddock-studio'
def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest() if file.is_file() else None
def env(file):
    return dict(line.split('=', 1) for line in file.read_text().splitlines() if line and not line.startswith('#') and '=' in line)
report = {'host': os.uname().sysname, 'machine': os.uname().machine,
          'diskFree': shutil.disk_usage(home).free, 'tools': {name: shutil.which(name) for name in ['node', 'npm', 'docker', 'python3']}}
for name, directory in [('account', account), ('studio', studio)]:
    current = directory / 'current'
    report[name] = {'current': os.readlink(current), 'hashes': {file: digest(current / file) for file in ['Mu.Server.dll', 'Mu.NexusGateway.dll', 'platform/studio-service.cjs', 'studio-ai.cjs'] if (current / file).is_file()}}
report['configHashes'] = {str(file): digest(file) for file in [account / '.env', account / 'compose.yml', studio / 'service.env']}
config = env(account / '.env')
report['accountConfig'] = {key: value for key, value in config.items() if key in ['ASPNETCORE_HOSTINGSTARTUPASSEMBLIES', 'Studio__BackendUrl', 'Nexus__BackendUrl', 'ASPNETCORE_ENVIRONMENT']}
report['containers'] = [line for line in subprocess.check_output(['docker', 'ps', '--format', '{{.Names}} {{.Image}} {{.Ports}}'], text=True).splitlines() if line.startswith('amd-dlss-mu-')]
report['studioUnit'] = subprocess.check_output(['systemctl', '--user', 'show', 'moddock-studio', '-p', 'ActiveState', '-p', 'ExecStart'], text=True).strip()
runtime = home / 'moddock-nexus/runtime/electron/electron'
runtime_env = dict(os.environ, ELECTRON_RUN_AS_NODE='1', LD_LIBRARY_PATH=str(home / 'moddock-nexus/runtime/native/usr/lib/x86_64-linux-gnu'))
report['runtime'] = json.loads(subprocess.check_output([str(runtime), '-p', 'JSON.stringify(process.versions)'], env=runtime_env, text=True))
database = sqlite3.connect('file:' + str(account / 'data/accounts.sqlite') + '?mode=ro', uri=True)
report['database'] = {'schemaVersion': database.execute('SELECT Version FROM DatabaseSchemas WHERE Id=1').fetchone()[0], 'integrity': database.execute('PRAGMA integrity_check').fetchone()[0]}
database.close()
private = env(studio / 'service.env')
report['studioCredentialsConfigured'] = all(private.get(key) for key in ['MODDOCK_STUDIO_TOKEN', 'MODDOCK_DEEPSEEK_API_KEY'])
request = urllib.request.Request('http://' + private['MODDOCK_STUDIO_HOST'] + ':' + private['MODDOCK_STUDIO_PORT'] + '/status', headers={'Authorization': 'Bearer ' + private['MODDOCK_STUDIO_TOKEN'], 'X-Mu-Account-Id': 'pi-deployment-inspection'})
with urllib.request.urlopen(request, timeout=10) as response:
    report['privateStatus'] = json.load(response)
print(json.dumps(report, indent=2))
