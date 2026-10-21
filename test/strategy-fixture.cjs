const { SOURCES } = require('../studio-strategy.cjs');
function draft(kind) {
 const meta = { kind, name: 'Strategy fixture', author: 'Fixture', description: 'Static data package fixture; no native game run.', targetVersion: '1.0.0' };
 if (kind === 'civ6-data') return { ...meta, files: [
  { name: 'data/units.xml', text: '<GameData><Units><Update><Where UnitType="UNIT_WARRIOR"/><Set Combat="40"/></Update></Units></GameData>' },
  { name: 'text/names.xml', text: '<GameData><LocalizedText><Row Tag="LOC___MODDOCK_ID___NAME" Language="en_US" Text="Fixture"/></LocalizedText></GameData>' },
 ] };
 const source = SOURCES[kind], language = 'english', localization = `${source.localization}/${source.flatLocalization ? '' : language + '/'}main_l_${language}.yml`;
 const files = {
  'hoi4-data': { name: 'common/national_focus/focus.txt', text: 'focus_tree = { id = __MODDOCK_ID__ default = no country = { factor = 0 } focus = { id = __MODDOCK_ID___one icon = GFX_goal_generic_political_reform x = 0 y = 0 cost = 1 completion_reward = { add_political_power = 50 } } }' },
  'stellaris-data': { name: 'events/event.txt', text: 'namespace = __MODDOCK_ID__\ncountry_event = { id = __MODDOCK_ID__.1 hide_window = yes is_triggered_only = yes immediate = { add_resource = { energy = 100 } } }' },
  'eu4-data': { name: 'decisions/decision.txt', text: 'country_decisions = { __MODDOCK_ID___decision = { potential = { tag = FRA } allow = { stability = 0 } effect = { add_stability = 1 } ai_will_do = { factor = 0 } } }' },
  'vic3-data': { name: 'common/decisions/decision.txt', text: '__MODDOCK_ID__ = { is_shown = { is_player = yes } possible = { always = yes } when_taken = { add_treasury = 1000 } ai_chance = { base = 0 } }' },
 };
 return { ...meta, files: [files[kind], { name: localization, text: 'l_english:\n __MODDOCK_ID___one:0 "Fixture"' }] };
}
module.exports = { draft };
