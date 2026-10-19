# CK3 Directory Structure Reference (1.19)

Ground truth: the installed vanilla directory resolved as `CK3_GAME_DIR`. A mod mirrors any subset of this tree. Folders marked ⭐ are the most commonly modded. Folders containing a `_<name>.info` schema doc are noted — always read it before writing to that database.

## Top level of `game/`

| Folder | Contents |
|---|---|
| `common/` ⭐ | Nearly all gameplay databases (see below) |
| `events/` ⭐ | All events, organized by theme (see below) |
| `history/` ⭐ | Start-date setup: characters, titles, provinces, wars, cultures |
| `localization/` ⭐ | Text, per-language subfolders + `replace/` |
| `gfx/` | Art assets: portraits, coat of arms patterns, models, map objects, interface illustrations |
| `gui/` | Interface layout (`.gui` files, FIOS override rules) |
| `map_data/` | Heightmap, provinces.png, definition.csv, rivers, geographical regions |
| `music/`, `sound/` | Audio + `.asset` definitions |
| `dlc/`, `dlc_metadata/` | DLC packaging (don't mod) |
| `data_binding/` | GUI data functions (advanced) |
| `fonts/`, `notifications/`, `licenses/` | Rarely modded |
| `tools/`, `tests/`, `content_source/` | Dev tooling, not loaded in normal play |
| `reader_export/` | Docs for `@:define`/`@:insert` reader actions (token-level templating) |

## `common/` — all 122 subdirectories

Grouped by system. Names are exact.

**Characters & traits**: `traits` ⭐ (monolithic `00_traits.txt`), `character_backgrounds`, `character_memory_types`, `scripted_character_templates`, `dna_data`, `ethnicities`, `genes`, `nicknames`, `deathreasons`, `pool_character_selectors`, `portrait_types`, `dynasties`, `dynasty_houses`, `dynasty_house_mottos`, `dynasty_house_motto_inserts`, `dynasty_legacies`, `dynasty_perks`, `house_aspirations`, `house_relation_types`, `house_unities`

**Events & script plumbing** ⭐: `on_action` (hooks connecting game occurrences to events/effects; subdirs: `activities/`, `dlc/`, `lifestyles/`, `relations/`, `schemes/`, `story_cycles/`), `scripted_effects`, `scripted_triggers`, `scripted_modifiers`, `scripted_lists`, `scripted_rules`, `scripted_guis`, `scripted_costs`, `scripted_animations`, `script_values`, `effect_localization`, `trigger_localization`, `customizable_localization`, `event_2d_effects`, `event_backgrounds`, `event_themes`, `event_transitions`, `story_cycles`

**Decisions & interactions** ⭐: `decisions` (has `_decisions.info`; `dlc_decisions/` subdir), `decision_group_types`, `character_interactions`, `character_interaction_categories`, `important_actions`, `suggestions`, `ruler_objective_advice_types`

**Realm & titles** ⭐: `landed_titles`, `laws`, `governments`, `holdings`, `buildings`, `council_positions`, `council_tasks`, `court_positions`, `court_amenities`, `court_types`, `courtier_guest_management`, `guest_system`, `vassal_stances`, `subject_contracts`, `lease_contracts`, `task_contracts`, `tax_slots`, `domiciles` (landless adventurers), `confederation_types`, `great_projects`

**Succession**: `succession_election`, `succession_appointment`

**Warfare**: `men_at_arms_types`, `casus_belli_types` ⭐, `casus_belli_groups`, `combat_effects`, `combat_phase_events`, `ai_war_stances`, `graphical_unit_types`, `raids`

**Faith & culture** ⭐: `religion` (subdirs: religions, holy sites, doctrines, fervor), `faith_icons` *(under gfx)*, `culture` (subdirs: cultures, pillars, traditions, innovations, eras, name_lists, creation_names), `flavorization` (title/name flavor per culture/government)

**Schemes & intrigue** ⭐: `schemes`, `secret_types`, `hook_types`, `opinion_modifiers`, `scripted_relations`, `factions`

**Lifestyles** ⭐: `lifestyles`, `lifestyle_perks`, `focuses`, `inspirations`

**Activities & travel**: `activities` (feasts, hunts, pilgrimages, tournaments…), `travel`, `accolade_types`, `accolade_icons`, `accolade_names`

**World systems**: `struggle`, `situation` (1.18+ regional situations, e.g. steppe), `epidemics`, `legends`, `legitimacy`, `artifacts`, `court_amenities`, `diarchies`, `holy_orders` *(in religion)*, `great_holy_wars` *(in religion)*

**Modifiers & values** ⭐: `modifiers` (static named modifiers), `modifier_definition_formats`, `modifier_icons`, `named_colors`, `defines` (engine constants; single-key overridable), `game_rules`, `game_concepts`

**AI**: `ai_goaltypes`, `ai_war_stances`

**UI/meta**: `bookmarks`, `bookmark_portraits`, `messages`, `message_filter_types`, `message_group_types`, `console_groups`, `coat_of_arms`, `connection_arrows`, `playable_difficulty_infos`, `tutorial_lessons`, `tutorial_lesson_chains`, `achievements`, `province_terrain`, `terrain_types`

## `events/` subdirectories (31)

`activities`, `artifacts`, `councillor_task_events`, `courtier_guest_management_events`, `court_events`, `culture_events`, `death_events`, `decisions_events`, `diarchy_events`, `dlc`, `education_and_childhood`, `factions`, `government_events`, `interaction_events`, `legacy_events`, `lifestyles`, `nickname_events`, `notification_events`, `prison_events`, `relations_events`, `religion_events`, `scheme_events`, `secret_events`, `situation_events`, `story_cycles`, `stress_events`, `test_events`, `trait_specific_events`, `travel_events`, `war_events`, `yearly_events` — plus ~33 loose `.txt` files at top level and `_events.info` (the event schema doc).

Subdirectory placement is organizational only — an event file works anywhere under `events/`. Files declare `namespace = <ns>` at top; events are keyed `<ns>.<number>`.

## `history/` subdirectories (9)

`artifacts`, `characters` ⭐, `cultures`, `provinces`, `province_mapping`, `situations`, `struggles`, `titles` ⭐, `wars` — plus `_characters.info`, `_history.info`, `_provinces.info`.

- `characters/`: one file per culture/region; character keys are strings; dated blocks `YYYY.M.D = { birth = yes }` hold life events. **History characters duplicate rather than override** — full-file override only.
- `titles/`: holder/liege/law assignments per date per title.
- `provinces/`: culture/religion/holding per province.

## `localization/` layout

```
localization/
├── english/                    # *_l_english.yml, first line "l_english:"
│   ├── event_localization/    # (any subfolder nesting is fine)
│   └── ...
├── french/ german/ korean/ russian/ simp_chinese/ spanish/ ...
└── replace/english/            # overrides of vanilla keys go here
```

AGOT pattern worth copying: isolate all mod keys in `localization/english/<modprefix>/` with themed subfolders, and put vanilla-key overrides in `localization/replace/english/`.

## How AGOT (the reference total conversion) maps onto this

- `common/` mirrors vanilla folder names 1:1 (103 subdirs) — mod-specific *content* lives in *files* named `00_agot_<system>_*.txt` inside vanilla-named folders, never in invented folders (exceptions: genuinely new databases like `great_projects/`).
- `events/` splits vanilla-mirroring files (for overrides, keep vanilla names) from mod content in prefixed dirs (`agot_events/`, `agot_scheme_events/`…).
- 239 scripted-effect files, all `00_`-prefixed; per-feature file slicing (`agot_colonization_*` across on_action/scripted_effects/events).
- Dedicated `events/errorfixers/`, `agot_debug_events.txt`, `agot_maintenance_on_actions.txt` — error handling as first-class content.
