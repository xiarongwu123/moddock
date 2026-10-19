---
name: ck3-modding-expert
description: Core knowledge base for Crusader Kings III mod development — mod anatomy (.mod descriptors, replace_path), the full game directory structure (common/, events/, history/, gfx/, gui/, localization/, map_data/), load order and override rules (LIOS/FIOS), and the debug/testing workflow. Use this skill whenever the user wants to create a CK3 mod, set up mod files, figure out where a file goes, fix a mod that won't load or isn't taking effect, resolve mod conflicts, or understand how CK3 reads its files — even if they don't say the word "mod" but are clearly working with CK3 game files.
---

# CK3 Modding Expert

Working knowledge of how Crusader Kings III loads, structures, and overrides its data files, and how to set up, organize, and debug a mod. Resolve the user's installed version and paths through workspace `AGENTS.md`; do not assume the author's environment.

## The one-paragraph mental model

CK3 is a database engine. Nearly everything — decisions, traits, events, religions — is a named top-level object parsed from `.txt` files (Jomini script) under mirrored directory trees. The game builds each database by reading **vanilla files first, then each mod in playset order (top → bottom, later wins)**. Within a database, files load in **ASCIIbetical filename order** and a later definition of the same object name replaces the earlier one (**LIOS** — Last In Only Served). A mod is therefore just a folder that mirrors `game/` plus a `.mod` descriptor; modding is mostly *placing correctly-named objects in correctly-named paths*.

## Mod anatomy

A local mod = two things:

1. **Descriptor** `.mod` file under `CK3_MOD_DIR` (normally the CK3 user-data `mod/` directory):

```
version="1.0"
tags={ "Gameplay" }
name="My Mod Name"
supported_version="1.19.*"
path="mod/my-mod"
```

- `path=` uses **forward slashes**. Prefer a portable user-data-relative path such as `mod/my-mod` when the folder lives under `CK3_MOD_DIR`. An external workspace requires an absolute path, but that descriptor is machine-local and should not be committed.
- A copy named `descriptor.mod` (without `path=`) lives inside the mod folder itself; the launcher generates both when you use *Mod library → Upload Mod → Create a Mod* (preferred way to bootstrap).
- `replace_path="common/dynasties"` makes the game ignore ALL vanilla files in that folder — total-conversion tool; never use it casually. AGOT's `descriptor.mod` is the reference example.
- `remote_file_id` is set when uploaded to Workshop. If you subscribe to your own uploaded mod, delete the local copy — the launcher breaks with both present.

2. **Mod folder** mirroring `game/` structure: `common/`, `events/`, `localization/`, `gfx/`, `gui/`, `history/`, `map_data/`, `music/`, `sound/`. Only include folders you actually change.

For the full annotated directory map (all 122 `common/` subdirectories, `events/` and `history/` subtrees), read `references/file-structure.md`. When entering an unfamiliar database, first read Paradox's own schema doc: the `_<name>.info` file inside that vanilla folder (e.g. `common/decisions/_decisions.info`).

## Override rules — the part everyone gets wrong

Full details and worked examples: `references/override-rules.md`. The short version:

| Situation | Rule |
|---|---|
| Same file path as vanilla/another mod | **Whole file replaced** (last mod in playset wins). Avoid unless intentional. |
| Same object name, different file, script database | **LIOS**: definition in the ASCIIbetically-later filename wins. `zz_my_override.txt` beats `00_vanilla.txt`. |
| GUI `types`/`templates` | **FIOS**: first definition wins → name your file `00_...gui`. Whole windows (`window_character.gui`) must be full-file overrides. |
| on_action `events` / `random_events` / `on_actions` lists | **Appended** across all definitions. To add behavior, define `on_birth = { on_actions = { mymod_on_birth } }` and put your effect in `mymod_on_birth`. Redefining `effect`/`trigger` on a vanilla on_action clobbers vanilla behavior and logs errors. |
| Localization keys | Only replaceable from `localization/replace/<lang>/` (or `<lang>/replace/`). |
| Defines | Single-key override fine: `NCharacter = { BASE_FERTILITY = 0.5 }` in a new file under `common/defines/`. |
| Events, faiths, history characters | **Cannot** be single-object overridden — whole file only (history chars duplicate instead of override!). |
| Buildings into holdings, new clothes genes, animations | Require whole-file override of `common/holdings/`, gene files, idle animation respectively. |

A single-object override can change but never *remove* an object.

Two principles when overriding permissions ("who can do X"):
- **Override the scripted rule, not its trigger.** Vanilla wires permissions as `common/scripted_rules/<rule>` (one-liner) calling `common/scripted_triggers/<rule>_trigger` (the gate logic). `can_raid = { always = yes }` in scripted_rules is minimal and patch-proof; rewriting `can_raid_trigger` means hand-copying vanilla gates.
- **Permissive overrides take no hostages.** "Anyone can X" means `always = yes` — don't carry over subsets of vanilla's conditions "to be safe"; copied gates violate the requirement and can strip permissions vanilla granted (e.g. `is_landed = yes` locks out landless adventurers who *can* raid in vanilla).

## Conventions that keep mods maintainable

- **Prefix everything** — files, folders, event namespaces, scripted effect/trigger names, loc keys, saved scopes — with a short mod tag (AGOT uses `agot_`). Makes `database_conflicts.log` legible and prevents collisions.
- Keep the `00_`/`##_` numeric prefix convention for load ordering inside `common/` folders; use a high prefix (`zz_`) for deliberate overrides.
- One feature slice per like-named file across folders: `common/on_action/mymod_colonization_on_actions.txt` ↔ `common/scripted_effects/00_mymod_colonization_effects.txt` ↔ `events/mymod_colonization_events.txt` (AGOT's pattern).
- Encoding: script files UTF-8 (no BOM needed); **localization `.yml` must be UTF-8 with BOM** and named `*_l_english.yml` (lowercase L; US spelling "localization"); first line `l_english:`.
- Mirror localization to all languages (copy the English file, rename the language suffix and header) so non-English players don't see raw keys.

## Dev & debug workflow

Full loop with console commands: `references/workflow.md`. Essentials:

1. Launch with `-debug_mode -develop` (Steam launch options or shortcut args). `-develop` hot-reloads most script/loc files on save; events and some databases still need `reload` console commands or a restart.
2. Note `error.log` size, do your change, launch/reload, **diff `error.log`** (`Documents\...\logs\error.log`). An empty diff is the pass condition. `database_conflicts.log` shows what your mod overrode — verify it's only what you intended.
3. Test in-game via console (`` ` ``): `event mymod.0001`, `effect <effect>`, `trigger <trigger>`, `release_mode` (on-screen error tracker), Explorer window for running script on arbitrary objects; Ctrl+click to play any character.
4. After a game patch: re-run `script_docs` + `dump_data_types` in console to refresh the API dumps that `api-schema-knowledge` relies on.

## Debugging a mod that "does nothing"

Check in this order — these cover ~90% of cases:

1. Mod not actually enabled in the current **playset**, or both a local and Workshop copy exist.
2. Wrong path: file not mirroring the vanilla path exactly (`common/decision/` instead of `common/decisions/`, `localisation/` instead of `localization/`).
3. Localization file missing BOM, wrong name pattern, or missing `l_english:` header → keys show raw.
4. Your object silently overridden — check `database_conflicts.log`, or overridden BY vanilla ordering (your file sorts before the vanilla one).
5. Script error killed the whole file — one syntax error can abort parsing of the rest of the file; check `error.log` from the top.
6. Stale launcher cache — delete `mods_registry.json` and `launcher-v2.sqlite` in the Documents CK3 dir, restart launcher.

## Composition with the other skills

- Verifying any trigger/effect/scope/modifier name exists → **api-schema-knowledge** (mandatory before emitting script).
- Writing the actual script content → **paradox-script-syntax**.
- Understanding/designing the game system you're modding → **ck3-mechanics-analyst**.
