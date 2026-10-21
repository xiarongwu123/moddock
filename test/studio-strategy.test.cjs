const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const mods = require('../studio-game-mods.cjs'), strategy = require('../studio-strategy.cjs'), fixture = require('./strategy-fixture.cjs');
test('strategy source directories, localized headers and native launcher namespaces are game-specific', () => {
 for (const kind of Object.keys(strategy.SOURCES)) {
  const draft = fixture.draft(kind), built = mods.build(draft, '00000000-0000-4000-8000-000000000000');
  assert.ok(built.files.some(file => file.name === 'mod/' + built.manifest.UniqueID + '.mod'));
  const localization = built.files.find(file => file.name.endsWith('.yml')); assert.ok(localization.data.toString().startsWith('\uFEFF')); assert.ok(!localization.data.toString().includes('__MODDOCK_ID__'));
  const descriptor = built.files.find(file => file.name.endsWith('descriptor.mod')).data.toString(); assert.ok(descriptor.includes('supported_version="1.0.0"'));
  assert.equal(mods.allowedDestination({ modKind: kind, modId: built.manifest.UniqueID }, 'mod/other.mod'), false);
  assert.throws(() => mods.dataSources(kind, [{ name: draft.files[1].name, text: 'l_french:\n key:0 "wrong"' }]), /语言头/);
  assert.throws(() => mods.dataSources(kind, [{ name: 'common/not_supported/main.txt', text: 'a = yes' }]), /未适配/);
  assert.throws(() => mods.dataSources(kind, [{ name: draft.files[0].name, text: 'a = {' }]), /未闭合/);
  const mismatch = mods.targetCompatibility({ adapterId: kind, draft: { targetVersion: '2.0.0' } }, { context: { engineEvidence: { documents: [{ path: 'launcher/launcher-settings.json', text: '{"rawVersion":"1.0.0"}' }] } } }); assert.equal(mismatch.status, 'blocked');
 }
 assert.throws(() => mods.dataSources('eu4-data', [{ name: 'localisation/simp_chinese/main_l_simp_chinese.yml', text: 'l_simp_chinese:\n a:0 "unsupported"' }]), /未适配/);
});
test('Civ6 host manifest binds actual XML hashes, action kinds and unique UUID, and rejects non-database XML', () => {
 const draft = fixture.draft('civ6-data'), built = mods.build(draft, '00000000-0000-4000-8000-000000000000');
 const metadata = mods.checkXML(built.files.find(file => file.name.endsWith('.modinfo')).data.toString());
 assert.equal(metadata.documentElement.getAttribute('id'), '00000000-0000-4000-8000-000000000000');
 assert.equal(metadata.getElementsByTagName('UpdateDatabase').length, 1); assert.equal(metadata.getElementsByTagName('UpdateText').length, 1);
 const listed = metadata.getElementsByTagName('Files')[0];
 for (const entry of Array.from(listed.childNodes).filter(node => node.nodeType === 1)) {
  const file = built.files.find(file => file.name === 'mod/' + entry.textContent);
  assert.equal(entry.getAttribute('md5'), crypto.createHash('md5').update(file.data).digest('hex'));
 }
 for (const text of ['<GameInfo/>', '<GameData/>', '<GameData><Units><Update><Set Combat="100"/></Update></Units></GameData>', '<!DOCTYPE x><GameData/>']) assert.throws(() => mods.dataSources('civ6-data', [{ name: 'data/main.xml', text }]));
 assert.throws(() => mods.dataSources('civ6-data', [{ name: 'data/main.sql', text: 'DROP TABLE Units;' }]), /仅接受/);
});
test('native game definition evidence is bounded, read-only and keeps personal files outside its approved roots', async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'strategy-evidence-')); t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 3 }));
 const write = async (name, text) => { const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); };
 await write('Base/Assets/Gameplay/Data/Units.xml', '<GameData><Units><Row UnitType="UNIT_WARRIOR" Combat="20"/></Units></GameData>');
 await write('Saves/personal.txt', 'private-save'); await write('credentials.txt', 'private-token');
 const evidence = await mods.evidence({ appId: '289070', name: 'Civilization VI', installPath: root }, null, '提高战士单位的伤害');
 assert.ok(evidence.documents.some(doc => doc.text.includes('UNIT_WARRIOR'))); assert.ok(!JSON.stringify(evidence).includes('private-'));
 await write('launcher/launcher-settings.json', '{"gameDataPath":"Z:/unknown/custom"}');
 await write('hoi4.exe', require('./bg3-extender-fixture.cjs').executable);
 if (process.platform === 'win32') await assert.rejects(mods.installRoot({ appId: '394360', installPath: root }, { modKind: 'hoi4-data' }, { documentsPath: root }), /自定义/);
});
