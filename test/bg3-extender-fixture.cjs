const crypto = require('node:crypto');
const { zipContent } = require('../content-pack.cjs');
function pe(marker = '') {
 const bytes = Buffer.alloc(2048); bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.write('PE\0\0', 128);
 bytes.writeUInt16LE(0x8664, 132); bytes.writeUInt16LE(0x20b, 152);
 bytes.write(marker, 512, 'utf16le'); return bytes;
}
const dll = pe('Norbyte BG3 Script Extender TEST FIXTURE - not executable');
const executable = pe('BG3 GAME TEST FIXTURE - not executable');
const archive = zipContent([{ name: 'DWrite.dll', data: dll }]);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const release = { version: 'fixture', page: 'https://github.com/Norbyte/bg3se/releases/tag/v33', url: 'https://github.com/Norbyte/bg3se/releases/download/fixture/BG3SE.zip', size: archive.length, sha256: hash(archive), dllSize: dll.length, dllSha256: hash(dll) };
module.exports = { pe, dll, executable, archive, release };
