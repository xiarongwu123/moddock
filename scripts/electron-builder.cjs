const path = require('node:path');

module.exports = {
 appId: 'com.moddock.desktop',
 productName: 'Moddock',
 directories: { output: path.join('output', 'windows') },
 files: [
  '*.cjs',
  '!studio-ai.cjs',
  'package.json',
  'nexus-games.json',
  'nexus-app.json',
  'public/**/*',
  'scripts/build-ui.cjs',
  'scripts/universal-modder-bridge.py',
  'vendor/universal-modder/**/*',
  'vendor/bg3-api/**/*',
  'README.md',
  'THIRD-PARTY-NOTICES.md',
 ],
 asar: true,
 asarUnpack: ['vendor/universal-modder/**/*', 'scripts/universal-modder-bridge.py'],
 npmRebuild: false,
 win: {
  target: [{ target: 'nsis', arch: ['x64'] }],
  signAndEditExecutable: false,
  executableName: 'Moddock',
  artifactName: 'Moddock-${version}-windows-${arch}-Setup.${ext}',
 },
 nsis: {
  oneClick: false,
  perMachine: false,
  allowToChangeInstallationDirectory: true,
  createDesktopShortcut: true,
  createStartMenuShortcut: true,
  shortcutName: 'Moddock',
  runAfterFinish: true,
 },
};
