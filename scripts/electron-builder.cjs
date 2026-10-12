const path = require('node:path');

module.exports = {
 appId: 'com.moddock.desktop',
 productName: 'Moddock',
 directories: { output: path.join('output', 'windows') },
 files: [
  '*.cjs',
  'package.json',
  'nexus-games.json',
  'public/**/*',
  'scripts/build-ui.cjs',
  'README.md',
 ],
 asar: true,
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
