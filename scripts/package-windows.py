"""Package source and an already verified Electron Windows x64 runtime.

python3 scripts/package-windows.py --runtime /path/to/Moddock --output /path/to/outputs
The runtime must contain Moddock.exe and Electron companion files.
"""
from pathlib import Path
import argparse, hashlib, json, shutil, struct, zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--runtime', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
project = Path(__file__).resolve().parents[1]
runtime, output = Path(args.runtime).resolve(), Path(args.output).resolve()
exe = (runtime / 'Moddock.exe').read_bytes()
offset = struct.unpack_from('<I', exe, 0x3c)[0]
assert exe[offset:offset+4] == b'PE\0\0' and struct.unpack_from('<H', exe, offset+4)[0] == 0x8664
package = json.loads((project / 'package.json').read_text())
app = runtime / 'resources/app'
if app.exists():
    shutil.rmtree(app)
app.mkdir(parents=True)
for name in ['package.json', 'electron.cjs', 'server.cjs', 'sources.cjs', 'downloads.cjs', 'scanner.cjs', 'installers.cjs', 'nxm.cjs', 'library.cjs', 'adapters.cjs', 'account.cjs', 'account-policy.cjs', 'account-token-store.cjs', 'nexus-games.json']:
    shutil.copy2(project / name, app / name)
for name in ['auth.js', 'auth.css']:
    assert (project / 'public' / name).is_file(), 'Run npm run build before packaging'
(app / 'scripts').mkdir()
shutil.copy2(project / 'scripts/build-ui.cjs', app / 'scripts/build-ui.cjs')
shutil.copytree(project / 'public', app / 'public')
copied = set()
def dependency(name):
    if name in copied:
        return
    src = project / 'node_modules' / name
    metadata = json.loads((src / 'package.json').read_text())
    shutil.copytree(src, app / 'node_modules' / name)
    copied.add(name)
    for child in metadata.get('dependencies', {}):
        dependency(child)
for name in package.get('dependencies', {}):
    dependency(name)
shutil.copy2(project / 'README.md', runtime / '使用说明.md')
output.mkdir(parents=True, exist_ok=True)
windows_zip, source_zip = output / 'moddock-windows-x64.zip', output / 'moddock-source.zip'
with zipfile.ZipFile(windows_zip, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for file in sorted(runtime.rglob('*')):
        if file.is_file():
            archive.write(file, Path('Moddock') / file.relative_to(runtime))
excluded = {'node_modules', '.git', '.demo-data', '.moddock-data', 'test-results', 'playwright-report', '__pycache__', 'output'}
with zipfile.ZipFile(source_zip, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for file in sorted(project.rglob('*')):
        if file.is_file() and not any(part in excluded for part in file.relative_to(project).parts):
            archive.write(file, Path('moddock') / file.relative_to(project))
with zipfile.ZipFile(windows_zip) as archive:
    assert archive.testzip() is None
    assert json.loads(archive.read('Moddock/resources/app/package.json'))['version'] == package['version']
    assert archive.read('Moddock/resources/app/installers.cjs') == (project / 'installers.cjs').read_bytes()
    for name in ['account.cjs', 'account-policy.cjs', 'account-token-store.cjs', 'scripts/build-ui.cjs', 'public/auth.js', 'public/auth.css']:
        assert archive.read('Moddock/resources/app/' + name) == (project / name).read_bytes()
    assert 'Moddock/resources/app/node_modules/yauzl/index.js' in archive.namelist()
    assert 'Moddock/resources/app/node_modules/pend/index.js' in archive.namelist()
    assert not any('.moddock-data' in name or '/test/' in name or '/.git/' in name for name in archive.namelist())
with zipfile.ZipFile(source_zip) as archive:
    assert archive.testzip() is None
    assert not any('/.git/' in name or '/node_modules/' in name for name in archive.namelist())
checksums = []
for file in [windows_zip, source_zip]:
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    checksums.append(digest.hexdigest() + '  ' + file.name)
(output / 'moddock-checksums.txt').write_text('\n'.join(checksums) + '\n')
print(f"Moddock {package['version']} Windows x64 / source ZIP verified; production dependencies: {', '.join(sorted(copied))}")
