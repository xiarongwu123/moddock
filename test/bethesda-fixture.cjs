const { deflateSync } = require('node:zlib');
function field(name, data) { const h = Buffer.alloc(6); h.write(name); h.writeUInt16LE(data.length, 4); return Buffer.concat([h, data]); }
function record(name, id, parts, formVersion, flags = 0) {
 let payload = Buffer.concat(parts);
 if (flags & 0x40000) { const size = Buffer.alloc(4); size.writeUInt32LE(payload.length); payload = Buffer.concat([size, deflateSync(payload)]); }
 const h = Buffer.alloc(24); h.write(name); h.writeUInt32LE(payload.length, 4); h.writeUInt32LE(flags, 8); h.writeUInt32LE(id, 12); h.writeUInt16LE(formVersion, 20); return Buffer.concat([h, payload]);
}
function group(name, records) { const data = Buffer.concat(records), h = Buffer.alloc(24); h.write('GRUP'); h.writeUInt32LE(data.length + 24, 4); h.write(name, 8); return Buffer.concat([h, data]); }
function master(kind) {
 const form = kind === 'skyrimse-esp' ? 44 : 131, hedr = Buffer.alloc(12); hedr.writeFloatLE(kind === 'skyrimse-esp' ? 1.7 : 1, 0); hedr.writeUInt32LE(6, 4); hedr.writeUInt32LE(0x800, 8);
 const float = value => { const b = Buffer.alloc(4); b.writeFloatLE(value); return b; }, int = value => { const b = Buffer.alloc(4); b.writeInt32LE(value); return b; };
 return Buffer.concat([
  record('TES4', 0, [field('HEDR', hedr)], form, 0x81),
  group('GMST', [
   record('GMST', 0x1001, [field('EDID', Buffer.from('fJumpHeightMin\0')), field('DATA', float(100)), field('ZZZZ', Buffer.from('unchanged'))], form, 0x40000),
   record('GMST', 0x1002, [field('EDID', Buffer.from('iTrainingNumAllowedPerLevel\0')), field('DATA', int(5))], form),
   record('GMST', 0x1003, [field('EDID', Buffer.from('bFixtureToggle\0')), field('DATA', int(1))], form),
  ]),
  group('GLOB', [record('GLOB', 0x1004, [field('EDID', Buffer.from('TimeScale\0')), field('FNAM', Buffer.from('f')), field('FLTV', float(20))], form, 0x40)]),
 ]);
}
function draft(kind) { return { kind, name: 'Native ESP fixture', author: 'Fixture', description: 'Binary plugin fixture, no native game run.', files: [{ name: 'changes.json', text: JSON.stringify({ changes: [
 { signature: 'GMST', editorId: 'fJumpHeightMin', value: 150 }, { signature: 'GMST', editorId: 'iTrainingNumAllowedPerLevel', value: 10 }, { signature: 'GMST', editorId: 'bFixtureToggle', value: false }, { signature: 'GLOB', editorId: 'TimeScale', value: 10 },
 ] }) }] }; }
module.exports = { field, record, group, master, draft };
