import os
import pathlib
import subprocess

root = pathlib.Path('/home/xrw/moddock-studio')
environment = dict(os.environ, ELECTRON_RUN_AS_NODE='1', LD_LIBRARY_PATH='/home/xrw/moddock-nexus/runtime/native/usr/lib/x86_64-linux-gnu', TMPDIR=str(root / 'tmp'))
environment.update(dict(line.split('=', 1) for line in (root / 'service.env').read_text().splitlines() if line and not line.startswith('#') and '=' in line))
output = root / 'incoming/native-pi-results'
output.mkdir(mode=0o700, exist_ok=True)
for name in ['godot', 'gamemaker', 'rgss', 'il2cpp']:
    subprocess.run(['/home/xrw/moddock-nexus/runtime/electron/electron', str(root / 'incoming/native-pi-request.cjs'), str(root / 'incoming/native-pi-inputs' / (name + '.json')), str(output / (name + '.json'))], env=environment, check=True, timeout=630)
