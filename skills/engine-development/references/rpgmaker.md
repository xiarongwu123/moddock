# RPG Maker

MV/MZ have a JavaScript plugin entry: js/rpg_core.js or js/rmmz_core.js plus js/plugins.js. Read local interface excerpts and existing plugins, then write actual main.js using engine-mod/rpgmaker-plugin. The host creates a unique plugin and merges the existing JSON plugin registry without evaluating it. Do not overwrite existing plugins or manufacture a replacement registry.

Alias the original method with the right receiver and arguments; preserve other plugins. MV and MZ APIs differ. Read local data files to verify item/skill/actor IDs. Startup compilation validates JavaScript syntax, not old NW.js feature compatibility or gameplay; prefer conservative syntax.

For XP/VX/VX Ace engineEvidence.mode=rpgmaker-rgss means the host recovered the actual scripts from Scripts.rxdata/rvdata/rvdata2, including RGSSAD/RGSS2A/RGSS3A archives. Read local class and method definitions. Write complete main.rb plus mod.json {"mode":"rpgmaker-rgss","patches":[],"blockers":[]}. The host compiles Ruby syntax, inserts the unique script before Main, preserves compressed original scripts, rebuilds the archive, verifies every asset and exports an installable binary delta with restore support. Use Ruby 1.8 compatible syntax and alias chains: no Module.prepend, keyword arguments, safe navigation, refinements or newer Ruby constructs. Preserve arguments/receiver and prior aliases. The portable compiler uses CRuby 3.3; that does not establish RGSS 1/2 language compatibility or gameplay. Native build errors return for repair. RPG Maker 2000/2003 use LCF, not RGSS, and must not receive Ruby.

References: https://www.rpgmakerweb.com/blog/beginners-guide-to-plugins-part1
