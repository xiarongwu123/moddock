# CK3 Dev & Debug Workflow

## Launch options

Set on the Steam properties for CK3, or a shortcut to `binaries\ck3.exe`:

| Flag | Effect |
|---|---|
| `-debug_mode` | Console, dev tooltips (shows IDs, scopes), debug interactions, Explorer |
| `-develop` | Hot-reload of most files on save (script, loc); pair with `-debug_mode` |
| `-mapeditor` | Launches map editor |
| `-random_seed=42` | Deterministic RNG (needs `-debug_mode`) — good for reproducing bugs |
| `-continuelastsave` | Boot straight into last save |
| `-nographics` | Headless observer game |

Debug-mode mouse shortcuts: **Ctrl+click** character = play them; **Alt+click** = kill; **Ctrl+Alt+click** = open in Explorer.

## Console commands for modders

Open with `` ` ``. Key commands:

- `event <namespace.id> [character_id]` — fire an event
- `effect <effect script>` — run any effect on current character, e.g. `effect add_gold = 100`, `effect trigger_event = mymod.0001`
- `trigger <trigger script>` — evaluate a trigger, e.g. `trigger is_adult = yes`
- `release_mode` — toggles on-screen error tracker (shows new errors as they happen)
- `script_docs` — dump `effects.log`, `triggers.log`, `event_targets.log`, `event_scopes.log`, `modifiers.log`, `on_actions.log`, `custom_localization.log` to the logs dir. **Re-run after every game patch.**
- `dump_data_types` — dump GUI/loc data functions to `logs/data_types/`
- `reload <registry>` / `reload events` / `reload texture` — force reload where `-develop` doesn't catch it
- `observe` — observer mode; `play <character_id>` — switch character
- **Explorer** (button in console window) — browse any game object and run effects/triggers in its scope; invaluable for testing scope chains interactively

## The edit-test loop

1. Have the game running with `-debug_mode -develop`.
2. Edit script → save. Most `common/` and `localization/` files hot-reload; events usually need console `reload events`; some databases (traits, landed titles, GUI windows) may need a restart.
3. Trigger your content via console (`event`, `effect`, decision UI).
4. **Check `error.log`** — keep it open in an editor that auto-refreshes (VS Code). Treat any new line as a failure. Fix the *first* error first: parse failures cascade.
5. Check `database_conflicts.log` once per structural change: your intended overrides should appear; anything else is an accident.

## Log files that matter (`Documents\Paradox Interactive\Crusader Kings III\logs\`)

| File | Use |
|---|---|
| `error.log` | Script errors — the pass/fail signal for every change |
| `database_conflicts.log` | What overrode what |
| `game.log` | Runtime messages, `debug_log` effect output |
| `debug.log` | Engine-level detail |
| `effects.log`, `triggers.log`, `event_targets.log`, `event_scopes.log`, `modifiers.log`, `on_actions.log` | API dumps from `script_docs` — see api-schema-knowledge skill |
| `data_types/*.txt` | GUI/localization function dumps from `dump_data_types` |

## Testing checklist for a new piece of content

- [ ] `error.log` diff clean after load
- [ ] Object appears in game (decision listed, event fires via console, trait assignable via `effect add_trait = x`)
- [ ] Localization renders (no raw `mymod_key_name` on screen)
- [ ] Tooltips sensible (desc, cost, requirements show correctly — CK3 auto-generates tooltips from triggers/effects)
- [ ] AI interaction sane (`ai_will_do`/`ai_potential`/`ai_check_interval` present where required; observe an AI-only game for a few years if the content is AI-facing)
- [ ] No unintended entries in `database_conflicts.log`
- [ ] For events: fires from its intended source (on_action/decision/interaction), not just console

## Publishing

- Launcher → Mod library → Upload Mod → select mod → platform → Upload. Steam: goes up private; flip to Public on the Workshop page. `thumbnail.png` (1:1, ≤1MB) in mod folder for Workshop.
- Update `supported_version` in the descriptor with each game patch you verify against (`1.19.*` wildcard tolerates hotfixes).
- List changed vanilla files in the mod description for compatibility-checking by users.
- Unsubscribe/remove local duplicate after uploading (launcher can't handle both).
