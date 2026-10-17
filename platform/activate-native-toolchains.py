import hashlib
import json
import pathlib
import runpy
import sys

root = pathlib.Path('/home/xrw/moddock-studio')
report = json.loads((root / 'incoming/native-build-check.json').read_text())
checksum = sys.argv[1]
assert report['passed'] and report['serviceRelease'] == '20261016-engines-' + checksum[:8]
assert {entry['mode'] for entry in report['results']} == {'godot-gdscript', 'gamemaker-gml', 'rpgmaker-rgss', 'unity-il2cpp'}
for entry in report['results']:
    assert entry['realPiUsed'] and entry['thinkingStreamed'] and entry['nativeBuildPassed']
    assert entry['libraryInstallationPassed'] and entry['installDisableEnableReplaceUninstallPassed'] and entry['gameDataPreserved']
    assert hashlib.sha256((root / 'incoming/native-pi-results' / (entry['name'] + '.json')).read_bytes()).hexdigest() == entry['sourceFileSha256']
    assert {'list_game_files', 'read_game_file', 'write_project_file', 'validate_project', 'submit_result'} <= set(entry['tools'])
sys.argv = ['deploy-studio-engines.py', 'activate', checksum]
runpy.run_path(str(root / 'incoming/deploy-studio-engines.py'), run_name='__main__')
