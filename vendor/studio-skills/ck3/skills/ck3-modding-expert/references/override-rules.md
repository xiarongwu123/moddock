# CK3 Load Order & Override Rules (worked examples)

## Load pipeline

1. Vanilla `game/` files load first.
2. Mods load in **playset order, top to bottom**. A mod lower in the playset wins conflicts with mods above it.
3. Within one database (one folder like `common/decisions/`), all files from vanilla + all active mods are merged into one file list and read in **ASCIIbetical filename order** (`0` < `9` < `A` < `Z` < `_` < `a` < `z`).

## Rule 1 — Full-file override

Same relative path + same filename as vanilla ⇒ your file **completely replaces** vanilla's. Even a 1-line file wipes out a 3000-line vanilla file.

- Use only when required (see Rule 5 list) or for total conversions.
- When two mods ship the same file, the lower-playset mod's copy is used; the other is ignored entirely.

## Rule 2 — Single-object override (script databases, LIOS)

Any **top-level object** (defined at column 0, not nested) can be redefined in a *new* file. The definition read **last** wins ("Last In Only Served").

```
# common/scripted_rules/zz_mymod_rules.txt
can_raid = { always = yes }        # replaces vanilla can_raid rule (see "Scripted rules vs scripted triggers" below)
```

- Vanilla `00_rules.txt` < `zz_mymod_rules.txt` ASCIIbetically ⇒ yours wins.
- You can *change* but never *delete* an object this way.
- Name override files so they're identifiable in `database_conflicts.log` (put your mod name in the filename).
- Gotcha: if your filename sorts *before* the vanilla file, vanilla silently wins. When an override "does nothing", check filename ordering first.

### Defines

`common/defines/` supports per-key override; wrap keys in their category:

```
# common/defines/zz_mymod_defines.txt
NCharacter = {
	BASE_FERTILITY = 0.5
	BASE_HEALTH = 5.0
}
```

### Scripted rules vs scripted triggers — pick the right override point

Many gameplay permissions are wired as: `common/scripted_rules/<rule>` → calls → `common/scripted_triggers/<rule>_trigger`. Example (vanilla):

```
# common/scripted_rules/00_rules.txt
can_raid = { can_raid_trigger = yes }
# common/scripted_triggers/00_scripted_rule_triggers.txt
can_raid_trigger = { <30 lines of government/faith/dynasty gates> }
```

When changing *who is allowed to do something*, **override the scripted rule, not the trigger** — the rule is usually a one-liner, so your override is minimal and future-proof:

```
# common/scripted_rules/zz_mymod_rules.txt
can_raid = { always = yes }
```

Overriding the trigger instead forces you to hand-copy vanilla's gate logic, which (a) breaks when a patch changes the gates and (b) risks re-introducing restrictions you meant to remove. Only override the trigger when other script also calls it directly and you need those call sites changed too.

**Permissive overrides must not smuggle gates back in.** If the requirement is "anyone can X", the override is `always = yes` — do not preserve subsets of vanilla's conditions (`is_landed`, faith doctrines, government flags) out of caution. Copied gates both violate the requirement and can *remove* vanilla permissions (e.g. keeping `is_landed = yes` strips landless adventurers of their vanilla raiding rights).

## Rule 3 — on_actions merge, not override

For an on_action, the list keys `events`, `random_events`, and `on_actions` **append** across every definition (vanilla + all mods). The `trigger` and `effect` keys do **not** merge — redefining them stomps vanilla and logs errors.

Correct way to add behavior to a vanilla on_action:

```
# common/on_action/mymod_birth_on_actions.txt
on_birth = {
	on_actions = { mymod_on_birth }     # appended to vanilla's list
}
mymod_on_birth = {
	trigger = { ... }                    # your own on_action: full control
	effect = { add_gold = 100 }
}
```

Wrong way (silently destroys all vanilla on_birth behavior):

```
on_birth = { effect = { add_gold = 100 } }
```

## Rule 4 — GUI is FIOS

In `gui/`, `types` and `templates` follow **First In Only Served** — the *first* loaded definition wins. Name your file to sort first (`00_mymod_widgets.gui`). To replace a type, declare a `types <AnyGroupName> { ... }` block containing your redefinition; templates go bare in the file.

Whole windows (e.g. `window_character.gui`) can only be changed by full-file override of that exact filename.

## Rule 5 — Things that CANNOT be single-object overridden

Full-file override (or different approach) required:

- **Individual events** — override the whole event file (or leave vanilla file alone and disable the event by other means, e.g. overriding a scripted trigger it uses).
- **Individual faiths** inside a religion file.
- **History characters** — same key in two files creates a *duplicate person*, not an override.
- **Adding buildings to holdings** — must override whole `common/holdings/` file listing buildings.
- **New clothes** — must override the relevant gene files; **new animations** — must override the idle animation file.

## Rule 6 — Localization

- New keys: any `*_l_english.yml` under `localization/english/` (nesting free).
- **Overriding a vanilla key**: file must be under `localization/replace/english/` or `localization/english/replace/` — otherwise the game logs duplicate-key errors and result order is unreliable.
- Encoding UTF-8 **with BOM**; header line `l_english:`; entries ` key:0 "Text"` (leading space, version number after colon).

## Diagnosing conflicts

- `Documents\...\logs\database_conflicts.log` — every object that got overridden and by which file. Your mod's overrides *should* appear here; anything unexpected is a bug.
- `error.log` — parse failures. One bad brace can abort the rest of a file, making later objects vanish; always fix the *first* error before rechecking anything downstream.
- Cross-mod conflicts: put the compatch/override mod lower in the playset. Load order has *no* effect except where files/objects collide.
