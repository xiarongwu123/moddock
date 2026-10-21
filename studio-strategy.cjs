const SOURCES = Object.freeze({
 'hoi4-data': { localization: 'localisation', languages: ['english', 'simp_chinese'], directories: ['common/national_focus', 'common/decisions', 'common/ideas', 'common/scripted_effects', 'common/scripted_triggers', 'events'], userDirectory: 'Paradox Interactive/Hearts of Iron IV', title: '钢铁雄心 4' },
 'stellaris-data': { localization: 'localisation', languages: ['english', 'simp_chinese'], directories: ['common/edicts', 'common/policies', 'common/governments/civics', 'common/scripted_effects', 'common/scripted_triggers', 'events'], userDirectory: 'Paradox Interactive/Stellaris', title: '群星' },
 'eu4-data': { localization: 'localisation', flatLocalization: true, languages: ['english'], directories: ['common/ideas', 'common/event_modifiers', 'common/scripted_effects', 'common/scripted_triggers', 'decisions', 'events'], userDirectory: 'Paradox Interactive/Europa Universalis IV', title: '欧陆风云 4' },
 'vic3-data': { localization: 'localization', languages: ['english', 'simp_chinese'], directories: ['common/decisions', 'common/journal_entries', 'common/laws', 'common/scripted_effects', 'common/scripted_triggers', 'events'], userDirectory: 'Paradox Interactive/Victoria 3', title: '维多利亚 3' },
});
const has = kind => Object.hasOwn(SOURCES, kind || '');
function validateSources(kind, files, { checkClausewitz }) {
 const spec = SOURCES[kind];
 for (const file of files) {
  const directory = file.name.slice(0, file.name.lastIndexOf('/'));
  if (spec.directories.includes(directory) && /^[a-zA-Z0-9_-]+\.txt$/.test(file.name.slice(directory.length + 1))) { checkClausewitz(file.text); continue; }
  const language = spec.languages.find(language => file.name.startsWith(spec.localization + '/' + (spec.flatLocalization ? '' : language + '/')) && new RegExp('/[a-zA-Z0-9_-]+_l_' + language + '\\.yml$').test(file.name));
  if (!language) throw new Error(spec.title + ' 文件目录或本地化语言未适配');
  const lines = file.text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim() && !/^\s*#/.test(line));
  if (lines.shift()?.trim() !== 'l_' + language + ':') throw new Error('本地化语言头与文件路径不一致');
  if (!lines.length || lines.some(line => !/^\s+[^\s:]+:\d*\s+"(?:[^"\\]|\\.)*"\s*(?:#.*)?$/.test(line))) throw new Error('本地化内容行格式无效');
 }
}
function build(input, uid, files) {
 const path = require('node:path'), output = [];
 const add = (name, text) => output.push({ name: 'mod/' + name, data: Buffer.from(text) });
 for (const file of files) add(`${uid}/${path.posix.dirname(file.name)}/${uid}_${path.posix.basename(file.name)}`, (file.name.endsWith('.yml') ? '\uFEFF' : '') + file.text.replace(/^\uFEFF/, '').replaceAll('__MODDOCK_ID__', uid));
 const descriptor = `version="1.0.0"\nname=${JSON.stringify(input.name)}\nsupported_version=${JSON.stringify(input.targetVersion)}\n`;
 add(uid + '/descriptor.mod', descriptor); add(uid + '.mod', descriptor + `path="mod/${uid}"\n`);
 return output;
}
function guide(kind) {
 const spec = SOURCES[kind];
 return `${spec.title}: write actual Clausewitz gameplay files in ${spec.directories.map(dir => dir + '/*.txt').join(', ')}. Localization: ${spec.languages.map(language => spec.localization + '/' + (spec.flatLocalization ? '' : language + '/') + '<name>_l_' + language + '.yml with l_' + language + ': header').join('; ')}. Host prefixes filenames, adds UTF-8 BOM to localization, and emits descriptor.mod plus a sibling launcher .mod. Explicit numeric targetVersion required; do not infer semantic version from Steam buildId. Use __MODDOCK_ID__ in new identifiers, namespaces and references. Read installed vanilla definitions before choosing game identifiers and scopes. Structural validation is not the game semantic compiler. Do not produce maps, assets, replace_path, dependencies or launcher database edits. User enables in the launcher playset; file deployment is not in-game activation. Use write_project_file then validate_project and submit actual files, not a plan.`;
}
module.exports = { SOURCES, has, validateSources, build, guide };
