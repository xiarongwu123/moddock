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
for name in ['package.json', 'electron.cjs', 'server.cjs', 'sources.cjs', 'workshop.cjs', 'downloads.cjs', 'scanner.cjs', 'installers.cjs', 'archive-limits.cjs', 'installation-progress.cjs', 'auto-install.cjs', 'install-rules.cjs', 'nxm.cjs', 'nexus-authorization.cjs', 'nexus-platform-client.cjs', 'library.cjs', 'adapters.cjs', 'account.cjs', 'account-policy.cjs', 'account-token-store.cjs', 'nexus-games.json', 'nexus-app.json', 'nexus-sso.cjs', 'source-key-store.cjs', 'source-connections.cjs']:
    shutil.copy2(project / name, app / name)
for name in ['auth.js', 'auth.css']:
    assert (project / 'public' / name).is_file(), 'Run npm run build before packaging'
for name in ['game-diagnostics.cjs', 'mod-studio.cjs', 'content-pack.cjs', 'universal-modder.cjs', 'studio-recipes.cjs', 'studio-conversations.cjs', 'studio-mu-client.cjs', 'studio-games.cjs', 'studio-preload.cjs', 'studio-migration.cjs', 'studio-lifecycle.cjs', 'studio-tools.cjs', 'studio-toolchain.cjs', 'larian-pak.cjs', 'bg3-mod.cjs', 'THIRD-PARTY-NOTICES.md']:
    shutil.copy2(project / name, app / name)
for name in ['studio-agent.cjs', 'studio-api.cjs', 'studio-events.cjs', 'studio-skills.cjs', 'studio-lua.cjs', 'bg3-controls.cjs', 'studio-control-host.cjs', 'bg3-extender.cjs', 'game-components.cjs', 'game-environment.cjs', 'studio-compiler-setup.cjs']:
    shutil.copy2(project / name, app / name)
shutil.copy2(project / 'studio-game-mods.cjs', app / 'studio-game-mods.cjs')
shutil.copy2(project / 'studio-coverage.cjs', app / 'studio-coverage.cjs')
shutil.copy2(project / 'studio-minecraft.cjs', app / 'studio-minecraft.cjs')
shutil.copy2(project / 'studio-pixels.cjs', app / 'studio-pixels.cjs')
shutil.copy2(project / 'studio-strategy.cjs', app / 'studio-strategy.cjs')
shutil.copy2(project / 'studio-civilization.cjs', app / 'studio-civilization.cjs')
shutil.copy2(project / 'studio-bethesda.cjs', app / 'studio-bethesda.cjs')
shutil.copy2(project / 'studio-native-evidence.cjs', app / 'studio-native-evidence.cjs')
for name in ['fomod.cjs', 'game-updates.cjs', 'studio-user-feedback.cjs', 'studio-cyberpunk.cjs', 'ai-policy.cjs', 'ai-usage.cjs', 'ai-install.cjs', 'archive-format.cjs', 'author-install.cjs', 'install-instructions.cjs', 'replacement-evidence.cjs', 'download-transfer.cjs', 'download-bundles.cjs', 'studio-game-process.cjs', 'studio-runtime-cycle.cjs', 'studio-runtime-verification.cjs', 'studio-ue4ss-safety.cjs', 'studio-engines.cjs', 'studio-errors.cjs', 'studio-intent.cjs', 'studio-game-api.cjs', 'studio-native-tools.cjs', 'studio-native-projects.cjs', 'studio-native-patch.cjs', 'studio-godot.cjs', 'studio-rgss.cjs', 'studio-ruby.cjs', 'studio-il2cpp.cjs']:
    shutil.copy2(project / name, app / name)
(app / 'scripts').mkdir()
shutil.copy2(project / 'scripts/build-ui.cjs', app / 'scripts/build-ui.cjs')
shutil.copy2(project / 'scripts/universal-modder-bridge.py', app / 'scripts/universal-modder-bridge.py')
shutil.copytree(project / 'vendor', app / 'vendor')
shutil.copytree(project / 'skills', app / 'skills')
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
excluded = {'node_modules', '.cache', '.git', '.demo-data', '.moddock-data', '.moddock-tools', '.moddock-private', '.playwright-cli', 'test-results', 'playwright-report', '__pycache__', 'output'}
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
