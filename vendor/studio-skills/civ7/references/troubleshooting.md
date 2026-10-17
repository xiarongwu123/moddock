# Troubleshooting: symptom → cause

Match the symptom, don't theorize. Civ VII rarely tells you what's wrong, so this maps
the observable behavior to the documented cause and the fix. Work top-down within each
section — the first causes are the most common.

## Task: the game just patched - is my shipped mod still OK?

⭐ **VERIFY AGAINST THE INSTALLED DATA, NOT THE PATCH NOTES.** Notes are prose: they announce features
and almost never list a renamed identifier, which is the thing that actually breaks a mod. A renamed
or deleted name is the classic silent failure - the row is dropped at load, the mod still shows as
enabled, and the mechanic simply never fires.

**Four checks, in this order. Each answers something the previous one cannot.**

**1. Do all the names we reference still exist?** Collect every ALL-CAPS identifier the mod
references, subtract the ones it defines itself, and look the rest up in the installed `Base` + `DLC`
XML. Worked example: `tools/check-patch-compat.py` in the civ7_mods repo.

⛔⛔ **TWO CLASSES OF NAME, AND ONLY ONE IS IN THE XML.**
  · **Data-declared** - buildings, wonders, civs, techs, traditions. These are rows. Absent from the
    installed data means genuinely gone, and a mod naming one is broken.
  · **Engine-side** - `EFFECT_*`, `REQUIREMENT_*`, `COLLECTION_*`. These live in the EXECUTABLE and
    appear in XML only where base content happens to use them. Judging them by XML produces false
    alarms: `EFFECT_PLAYER_REPLACE_CONSTRUCTIBLE` is real, shipped, and proven in play, yet appears
    in no game XML at all because no base modifier uses it.
  ⭐ **ENGINE-SIDE NAMES CAN STILL BE VERIFIED - GREP THE BINARIES.** They are compiled in as
    strings: `grep -rl EFFECT_NAME "…/Base/Binaries/Win64/"` hits
    `Civ7_Win64_DX12_FinalRelease.exe` and the Vulkan build when the effect exists. That turns
    "unverifiable" into a real check, and is far better evidence than an old test record.

**2. Load a game with the mod on, then read `Database.log`.** Look for
`[gameplay]: Passed Validation.` - that means the gameplay DB built with the mod's components applied
and no foreign key was dropped. ⚠ The frontend/localization validations pass long before gameplay
does; only the `[gameplay]` line is about your content.

**3. Read `UI.log`** if the mod touches UI - the highest-risk area across a patch, because base UI
gets refactored. Look for `JS Error`, `SOURCE ERROR`, and the mod's own startup lines.

**5. ⚠⚠ `git diff` THE EXPORT BEFORE UPLOADING - a publish after a patch carries changes you did
not make.** A publish pipeline that re-runs its generators will pick up whatever the patch added,
because a generator that ENUMERATES game content (one row per civilization, one project per building)
silently widens with the game. Real case: the first E&I publish after Update 1.5 carried +93 lines
across six Modern data files - three new DLC civilizations the Political Theory generator had found on
its own. Good change, and it shipped in the change note. But it had never been through a gameplay DB
load, so it got one first.
➡ **Whatever the diff shows, load a game before uploading.** Generated rows are exactly the kind that
   fail on a foreign key, and `[gameplay]: Passed Validation` is the only thing that says they did not.

**4. Diff the CONTENT counts** to find what the patch added: wonders, buildings, civs. A mod that
ENUMERATES constructibles (a generator that makes one project per building) needs regenerating;
a mod that does not, does not care.

⚠ **ATTRIBUTE EVERY WARNING BEFORE REPORTING IT.** In one 1.5 pass the logs held `Warning: Apply
Actions` for `gaul-text` and `iceland` (base-game DLC), three `width: max-content` warnings that
fired BEFORE the mod's components applied, and a file literally named `StartupErrorMessages.xml`
matching a grep for "error". None were the mod's. Check the timestamp against
`Applying mod components` and read the line AFTER a CSS warning - Coherent prints the source file
on the following line.

⚠ **`Unable to parse declaration` IS COSMETIC, AND USUALLY NOT NEW.** Coherent/Gameface rejects
`display:inline-block`, `display:inline-flex`, `align-items:baseline` and `width:max-content`; the
declaration is dropped and layout falls back. Without a pre-patch log you cannot tell whether a
patch introduced it - look at the actual panel and decide, rather than assuming a regression.
➡ The durable fix is the same one this engine keeps teaching: **lay out with flex, not with inline
anything.**

## Symptom: mod doesn't appear / shows enabled but does NOTHING

The mod is discovered and toggled on, but no effect in-game. First, confirm whether it
actually **Applied**: `powershell scripts/check-applied.ps1 <mod-id>` (or grep
`Modding.log` for the mod under "Applied all components of enabled mods" and in the
"Target Mods" list).

**If it did NOT apply (absent from Target Mods):**

1. **Non-integer `<Version>`.** *The* most common cause. `version="0.1"` → silently
   dropped from Target Mods while still showing enabled. Fix: integer `version="1"` in
   both the `<Mod version="">` attribute and `<Version>` tag. Verify the parsed value
   in `Mods.sqlite` → `ModProperties` (`scripts/inspect-registry.ps1`).
   → [modinfo.md](modinfo.md#properties)
2. **ActionGroup criteria never met.** A group gated on the wrong `AGE_*` constant (or a
   typo'd criteria id) never runs. Confirm the criteria matches the Age you started.
3. **Wrong scope.** Gameplay rows in a `scope="shell"` group won't affect a game.
   Gameplay = `scope="game"`. → [modinfo.md](modinfo.md#actiongroups)
4. **Didn't start a NEW game** / enabled mid-session. Re-enable, start a fresh game.
5. **Not actually deployed** where the engine looks, or deployed as a broken junction.
   Re-run `scripts/deploy-mod.ps1`; confirm the folder is in `…\Mods\`.

**If it DID apply but the bonus still does nothing:**

6. **Player/city modifier bound directly in `<GameModifiers>`.** No owner context → it
   attaches to no one, silently. Deliver it via a `COLLECTION_MAJOR_PLAYERS` +
   `EFFECT_ATTACH_MODIFIERS` wrapper and bind only the wrapper.
   → [gameeffects.md](gameeffects.md#the-attach-wrapper-rule)
7. **Requirements never pass.** Your `SubjectRequirements`/`OwnerRequirements` gate the
   effect out (population threshold not reached, settlement count, project not built).
   Temporarily remove the gates (or add an ungated debug probe like +50 gold/turn) to
   confirm the effect fires at all, then reintroduce gates one at a time.
8. **Wrong argument name** — the effect ran but ignored your arg because the name is
   off (args are case-sensitive and not guessable). Re-copy the exact
   `<Argument name="...">` from a real base-game usage.
   → [finding-base-game-patterns.md](finding-base-game-patterns.md)
9. **`REQUIREMENT_PLAYER_HAS_COMPLETED_PROGRESSION_TREE_NODE` missing `MinDepth`.** If a
   bonus gated on a researched tech/civic node never fires even with the node researched,
   you almost certainly omitted `<Argument name="MinDepth">1</Argument>`. Without it the
   requirement silently never passes — no log error. Add `MinDepth=1`.
   → [projects.md](projects.md#gating-on-a-tech-node-without-a-project)
10. **Misspelled `OnlyDistantlands`.** A per-hemisphere bonus/count scoped to the distant
    hemisphere never fires because the arg was written `OnlyDistantLands` (capital L). The
    correct spelling is **`OnlyDistantlands`** (lowercase "l"); the wrong case parses with no
    error and silently never passes. (`OnlyHomelands` is camelCased normally.)
    → [gameeffects.md](gameeffects.md#scoping-by-hemisphere-homeland-vs-distant-lands)
11. **`REQUIREMENT_PLAYER_DISCOVERED_NATURAL_WONDER` not satisfied — "discovered" ≠ "revealed."** A bonus gated on
    discovering a natural wonder won't fire just because the NW tile is visible on the map. It needs the actual
    DISCOVERY event (a unit reaching/adjacent the wonder → the "discovered [X]" notification). A turn-1 sighting at the
    edge of vision is a *reveal*, not a discovery. Confirmed in-game; base parallel `MOUNT_EVEREST_REVEAL` fires *"on
    discovery."* If testing, send a unit to actually visit a NW. → [gameeffects.md](gameeffects.md#requirements)
12. **The OR-set is too big.** A `REQUIREMENTSET_TEST_ANY` far larger than anything the base game
    ships fires nothing and logs nothing. The installed game's **largest holds four requirements**;
    a 53-row set failed both as a named set and inline (2026-08-08). Split it into one modifier per
    alternative, each writing the SAME property key. Inline `type="REQUIREMENTSET_TEST_ANY"` on
    `<SubjectRequirements>` is itself fine — 22 base uses. → [effects-collections-catalog.md](effects-collections-catalog.md)
13. **The requirement has one shipped use, and it does not mean what its name suggests.** Before
    building on a low-count identifier, open its single use and read the requirements *around* it —
    the neighbours are the documentation. `REQUIREMENT_PLAYER_AT_PEACE_X_TURNS_AGO` reads like a
    peace-duration check; its one use pairs it with a declaration of war, making it a **betrayal**
    check that a peaceful player may never satisfy. Three attempts were lost to that before anyone
    read the neighbour. → [effects-collections-catalog.md](effects-collections-catalog.md)
14. **A numeric threshold the base game never passes.** Some requirements only honour the values
    Firaxis exercises. `REQUIREMENT_PLAYER_PLOTS_REVEALED_ARE_X` stayed dark at 93.3% and 99.71%
    and fired at 100 — the only percentage its two base uses pass. If a count-style requirement
    will not fire, try the shipped number before assuming the mechanism is broken.

## Symptom: a deed/bonus fires, but on the wrong thing

1. **An argument you added is being ignored, and the requirement still passes.** This reads as
   success, which is why it survives testing. `REQUIREMENT_PLAYER_HAS_X_WAR_SUPPORT` with a bare
   `Amount` reads *your own* support in isolation, not the contest — it paid out while the player
   was 2 behind; `MoreThanOpponent="True"` is what makes it a comparison. **Test the negative
   case**: do the thing that should NOT satisfy the deed and confirm it stays dark. A war-type
   filter was confirmed the same way — a Surprise War left the marker dark, a Formal War lit it.
2. **A count requirement that names ONE type does not sum across two.** See
   `REQUIREMENT_PLAYER_HAS_X_TOWNS_PRODUCING_PROJECT` in
   [effects-collections-catalog.md](effects-collections-catalog.md): two markers give max(), not the
   total. Count the objects with `REQUIREMENT_COLLECTION_COUNT_ATLEAST` instead.

## Symptom: project doesn't appear in the city's build list

1. **Project has no effect** → hidden. Add a `ProjectCompletionModifiers` row binding a
   real Modifier. → [projects.md](projects.md#the-two-rules-that-hide-a-project)
2. **`RequiresUnlock` wrong.** Tech-unlocked City projects need `RequiresUnlock="false"`
   (the `ProgressionTreeNodeUnlocks` row is the gate). `"true"` is for Town warehouse
   projects.
3. **Not unlocked / wrong node.** The `ProgressionTreeNodeUnlocks` row points at a
   `ProgressionTreeNodeType` you haven't researched, or a mistyped node. Verify the node
   id against `progression-trees-tech.xml`.
4. **`CityOnly` vs settlement type** — a `CityOnly="true"` project won't show in a Town.

## Symptom: my new building shows BLANK (no icon) in the build list

The constructible has no icon mapping. Icons load via an **`<UpdateIcons>`** action (NOT `<UpdateDatabase>`)
with `IconDefinitions` rows mapping the type → a `blp:` asset; you can reuse a base asset (no art needed).
→ [constructibles.md](constructibles.md#icons-map-a-constructible-to-an-icon-reuse-an-existing-asset)

## Symptom: my custom UNIT's flag/icon is blank, or the selected-unit portrait square is black

Three separate causes — work through them in order:
1. **Icon registered only in `scope="game"`.** The unit-flag manager reads icon-name definitions from the
   **shell** icon DB. Load `surveyor-icons.xml` in **both** a `scope="game"` and a `scope="shell"` group,
   `criteria="always"`. Per-Age (`criteria="age-*"`) icon groups don't register at all.
2. **Only a flag row, no FONTICON row.** The list/tooltip portrait uses a `Context="FONTICON" IconSize="64"`
   row; add it alongside the default-context flag row.
3. **The big selected-unit PANEL portrait is still black** even with icons + a correct `VisualRemap` — that
   square is a **live 3D render of the unit's own art asset** (`live:/UNIT_TYPE`), which a brand-new unit
   lacks; remaps can't alias it. Map + build-menu look fine; only that panel square is affected.
   **✅ Fixable (verified 2026-07-12):** a `Controls.decorate("unit-actions", …)` UIScript that wraps
   `setupUnitInfo()` and re-points the square at the donor's render (`live:/UNIT_<DONOR>`). Recipe in
   → [custom-units.md](custom-units.md#3d-model--the-live-render-portrait-visualremap--its-hard-limit)

Log note: `UI.log` records only **failed** resource loads — a *successful* icon load logs nothing, so
"my blp was never requested" is NOT proof it didn't resolve. Don't diagnose from its absence.

## Symptom: my building's pop-out info panel shows the wrong / short text

The constructible pop-out renders the **`Tooltip`** field, not `Description`. Put the player-facing
"what it does" text in `LOC_..._TOOLTIP`. → [constructibles.md](constructibles.md#the-production-pop-out-renders-tooltip-not-description)

## Symptom: I can't hide/disable a building based on player state (owns wonder X, has N cities)

You can't — the `Constructibles` schema gates buildability only on physical placement + `RequiresUnlock`, with
**no player-state requirement hook**. Conditional hiding needs a UI mod (JS production-list filter); in pure data,
gate the building's *effect* (a `<Modifier>` requirement) instead, and accept the entry stays visible.
→ [constructibles.md](constructibles.md#defining-a-new-building-the-minimum-table-set)

## Symptom: a story/effect-seeded resource renders on the map but the Prospector/Surveyor CLAIM won't target it

Expected — not a bug in your mod. The claim's native validity only sees **natively-registered**
resources (map-gen, age-transition seeding, discovery-site story rewards). A resource placed by
a runtime story or plot-collection modifier (`EFFECT_PLOT_PLACE_RESOURCE`) renders, shows yields,
and occupies the plot, but the claim highlighter never lights it — regardless of terrain or
range, and the story-row `ResourceReq` column doesn't help. No data-side fix exists (in-game
verified 2026-07-03, six-run litmus). If you need a claimable seeded resource, deliver it via a
**discovery-queue story bound to a map-gen site** (those register natively) or grant it directly
on owned land with `EFFECT_CITY_ADD_RESOURCE_TO_PLOT` (CITY-class resources only).
→ [narrative-events.md](narrative-events.md) + [custom-units.md](custom-units.md)

## Symptom: my chained narrative stories all fire at once / land their rewards on the wrong tile

Two engine rules (in-game verified 2026-07-03): **`UNLOCKED`-by-predecessor does not meter
same-trigger repeats** — every story in the chain completes off the FIRST trigger gossip
(burst); and **`DuplicateCount>1` gossip requirements anchor the story plot ERRATICALLY** (not
reliably the Kth gossip's tile). The only shape with correct anchoring: **one REQUISITE story
per distinct trigger filter, count=1 + `AfterInit`**. To meter N repeats, use N distinct trigger
filters (e.g. different UnitTypes). → [narrative-events.md](narrative-events.md)

## Symptom: wrong constructible age (e.g. treating Temple as Antiquity)

Constructible ages are **not** guessable from the id (`BUILDING_TEMPLE` = Exploration, `BUILDING_MONUMENT` =
Antiquity). Grep the generated [constructibles-catalog.md](constructibles-catalog.md) for the Age + Ageless flag
before asserting one. Generate it via `python tools/gen-constructibles-catalog.py`.

## Symptom: game CRASHES on load / at map generation

1. **`REQUIREMENT_PLAYER_HAS_X_SETTLEMENTS` (or other player-settlement requirement) in
   `OwnerRequirements` on a `COLLECTION_PLAYER_CONSTRUCTIBLES` modifier.** Hard crash at
   map load — a bare constructible has no settlement/owner context. Move the gate to
   `SubjectRequirements` on a city collection, or drop it for those modifiers.
   → [gameeffects.md](gameeffects.md#requirements)
2. **Malformed XML** — a file that isn't well-formed can take the load down. Run
   `scripts/validate-xml.ps1 <mod-folder>` before every test.
3. **Overriding an existing text tag with `<EnglishText><Row Tag="…">`.** `<Row>` does an
   INSERT; re-defining a tag the base game already defines (e.g. a `CITY_STATE_…_DESCRIPTION`)
   collides → "There were errors loading 'text/…' that require a rollback" → "Rolling back
   database to a good state" → crash. **The data loaded fine; the TEXT file killed it.** Fix:
   override with the upsert verb — `<LocalizedText><Replace Tag="…" Language="en_US"><Text>…
   </Text></Replace></LocalizedText>` (the exact pattern base l10n files use). Use `<Row>` only
   for NEW tags. (This crash shows in **Modding.log**, not Database.log.)
   ⛔ **And `<Update>` on `EnglishText` takes the whole mod down**: `cannot modify EnglishText
   because it is a view` (hit 2026-08-16 — the mod stopped loading entirely, and the innocent
   mod being blamed alongside it cost a further round). **`EnglishText` is a VIEW over
   `LocalizedText`, not a table** — it is writable by INSERT only. Anything that edits an
   existing string must target `<LocalizedText>` with an explicit `Language="en_US"`.
4. **`VisualRemaps` loaded via `<UpdateDatabase>`.** Database.log: `no such table: VisualRemaps
   … In XMLSerializer while updating table VisualRemaps from file …`. `VisualRemaps` isn't a
   gameplay-DB table — it has its **own action**, `<UpdateVisualRemaps>`. Move the remap file out
   of the `UpdateDatabase` list into an `UpdateVisualRemaps` action (an `always` group).
5. **`<EnglishText>` (or any LocalizedText table) inside an `<UpdateDatabase>` file.** Database.log:
   `[gameplay] ERROR: no such table: EnglishText` and the game crashes at map load (hit again
   2026-07-13). Text tables live in the TEXT database — load them via `<UpdateText>` (a separate
   file), never in a gameplay `UpdateDatabase` item. Same "wrong action for the table" class as
   the VisualRemaps crash above: each layer (gameplay DB / text / icons / visual remaps) has its
   own action and its own database.
   → [custom-units.md](custom-units.md#3d-model--the-live-render-portrait-visualremap--its-hard-limit)
6. **Two `<Argument>` rows with the SAME name on one modifier.** Database.log:
   `[gameplay] ERROR: UNIQUE constraint failed: ModifierArguments.ModifierId,
   ModifierArguments.Name` then `Failed to add Modifier (…)` → crash at game load (hit
   2026-08-01 with two `ModifierId` arguments on an `EFFECT_ATTACH_MODIFIERS` wrapper).
   The (ModifierId, Name) pair is UNIQUE — an argument name appears ONCE per modifier.
   Where the engine expects multiple values, pass ONE argument with a **comma-separated
   list** (the base multi-attach idiom: `<Argument name="ModifierId">A, B, C</Argument>`).
   → [gameeffects.md](gameeffects.md#the-attach-wrapper)
7. **Diagnosis tip:** a runtime crash leaves `Modding.log` *clean* (often ending
   "Successfully reconfigured game") with the process dying after — distinct from a
   load-exclusion failure where the mod simply never reaches "Applied."
   → [deploy-and-debug.md](deploy-and-debug.md#reading-the-logs)

## Symptom: a *generated* data file is valid XML but the bonus is off / ungated / wrong

If you emit GameEffects from a script (PowerShell template, codegen), **valid XML does not
mean correct content.** A templated value that resolves to empty still produces well-formed
XML — e.g. `<Argument name="ProgressionTreeNodeType"></Argument>` (an empty node) makes the
gate silently never pass, with no error from the generator or the XML validator.

1. **Empty/blank substituted values.** Grep the *generated output* for the tell-tale empty
   attribute (`pattern='ProgressionTreeNodeType"></Argument>'`) before deploying. More
   generally, after generating, spot-check that the values you expected actually landed.
2. **PowerShell variable-name collisions are case-INSENSITIVE.** `$N` and `$n` are the same
   variable; a `foreach ($n in …)` loop will clobber a `$N` you set earlier, so later
   `$N.Foo` lookups return nothing → empty substitutions (cause of #1). Rename to disambiguate.
3. **Don't trust `Select-String -SimpleMatch | %{ $_.Matches.Count }`** to verify counts — under
   `-SimpleMatch` the `.Matches` collection isn't populated and it falsely returns 0. Use
   `(Select-String -Pattern … -SimpleMatch).Count` (matching-line count) instead.
4. **Audit the GENERATED output, never the source, to know what actually ships.** A generator
   full of conditional guards (`if (-not $Strip) { $out += … }`, block-wrapped emits) is a trap:
   a `grep` of the *source* shows emit lines that are actually suppressed, and misses ones a
   guard on an enclosing line kills. Grep the emitted `.xml` for real `<Modifier id="…">` / `<Row>`
   lines instead — that's ground truth. (Cost me a wrong "this is live" conclusion during a de-layer.)

The habit: **regenerate → grep the output for both presence (expected ids/nodes) and absence
(empty args) → only then deploy.** A green XML-validator and a non-erroring generator are
necessary, not sufficient.

## Symptom: I removed a bonus but its old text still shows on a node — or a yield's breakdown label broke

Two failure modes when retiring/de-layering a modifier that had a node "note":

1. **Orphaned display row.** Generator-style node notes are `ProgressionTreeNodeUnlocks` rows
   (`TargetKind="KIND_MODIFIER"` → a lightweight display-only "note" modifier that just carries
   the LOC text). If you strip the *bonus* modifier but leave its note's display row, the base
   node keeps **advertising a bonus that no longer exists.** When you retire a modifier, also
   suppress its note row (and the note-modifier). Audit: for every note key, confirm a live bonus
   still backs it; grep the generated `traditions.xml` for stale `TargetType="…_NOTE_…"` rows.
2. **Dual-role note key = broken attribution label.** The *same* generated note LOC key is often
   reused as an always-on modifier's `<Argument name="Tooltip">` — that Tooltip is the city
   yield-breakdown attribution ("+2 Science from *Suzerainty*" instead of "Other"). If you strip
   the note (deleting the LOC string), any modifier still pointing its Tooltip at it now shows a
   **dangling/blank label** in the breakdown. Fix: give always-on modifiers a **standalone,
   hand-authored attribution LOC** (e.g. `LOC_MA_SUZERAIN_LABEL` = "Suzerainty"), never a generated
   tree-display note key. Decouple the breakdown label from the tree note from the start.

## Symptom: some of my rows are missing / FK errors

1. **`<Item>` load order.** Within an ActionGroup, a file that references a table must
   load after the file that creates it (projects before modifiers/traditions that name
   them). Reorder the `<Item>`s. → [modinfo.md](modinfo.md#actiongroups)
2. Check `Database.log` for the specific SQL/FK error and the row it rejected.
3. Remember "Passed Validation" is the **whole DB**, not proof your rows are in — if the
   mod never applied, your rows were never inserted in the first place.

## Symptom: UI mod loads but the screen/patch does nothing (UI-mod cases)

All from shipping-mod scar tissue — see [ui-modding.md](ui-modding.md) for the patterns.

1. **A thrown error during module load kills the whole script silently.** The #1 cause is
   a bad `import` path — especially after a game patch **moves a core module** (known case:
   an options-screen module moved and every mod importing the old path lost its Options tab).
   Check the UI log for the exception; re-verify import paths against the installed
   `Base/modules/core/ui/` tree after every patch.
2. **Script registered with the wrong scope.** Options/settings scripts must be listed in
   BOTH a `scope="shell"` and a `scope="game"` ActionGroup; a hotkey's `InputActions` rows
   must load via a **shell**-scope `UpdateDatabase` (they live in the frontend DB).
3. **Mod-options saved but readback is broken for every mod** → some mod wrote a second
   localStorage key. The engine's localStorage bridge only tolerates the single shared
   `"modSettings"` key (one JSON object, namespaced per mod). Find and remove the stray key.
   → [ui-modding.md](ui-modding.md#mod-options-and-the-shared-settings-store)
4. **Two mods replace the same base file via `ImportFiles`** — higher LoadOrder wins, the
   other mod silently breaks. Prefer `Controls.decorate`/prototype patches; if replacement
   is unavoidable, document the conflict.
5. **You patched the old `ui/` file but the screen now runs on `ui-next/`** (or half of it
   does — the production chooser uses both stacks). Restyle/replace BOTH variants.
   → [ui-modding.md](ui-modding.md#ui-next-the-second-ui-stack)
6. **Patch ran before the target was registered.** Side-effect-import the base module first
   (`import '/base-standard/ui/...';`) or defer via `engine.whenReady.then(...)` instead of
   timers.
7. **A text element renders EMPTY (styled box present, no words, no error)** → check for
   `font-style: italic`. The game fonts ship no italic face and the engine draws nothing
   instead of synthesizing a slant (base UI uses zero italics). Remove the italic; de-emphasize
   with color/opacity/size. Verified in-game. → [ui-modding.md](ui-modding.md#css-gotchas-inside-the-game-ui)

## Symptom: UI state keyed to "node finished" sticks forever after the node completes

Your JS decides completion with `Game.ProgressionTrees.getNode(pid, hash).progress >= cost` —
and it works during research, then never flips after the node finishes.

**Cause (proven by FireTuner probe 2026-07-26, in-game): `node.progress` is WORKING state —
the engine RESETS it to 0 when the node completes.** On a finished node the probe reads
`prog=0 depth=1 cost=<real cost>`: `progress >= cost` is `0 >= cost` = false forever, so any
"completed → hide/change UI" branch keyed on it never runs. (`Culture.getNodeCost` keeps
returning the real cost — that part is fine.)

**Fix: use `depthUnlocked` as the completion signal** — it survives completion and increments
per depth (`>= 1` = base research done; `>= 2` = mastery done). One-line probe to check any
node live:

```js
(()=>{const p=GameContext.localPlayerID,h=Database.makeHash('NODE_...'),n=Game.ProgressionTrees.getNode(p,h);return 'prog='+(n?.progress)+' depth='+(n?.depthUnlocked)+' cost='+(Players.get(p)?.Culture?.getNodeCost(h));})()
```

(FireTuner tip: RETURN the string — `console.log` output isn't always shown; the console
echoes the expression's return value. And attach to the in-game UI context, or the globals
read as undefined.) In tree-card UI you can also read the card's `unlocks-by-depth`
attribute (`depth.isCompleted`) — display-state fed by the screen, equally reliable there.

## When you're stuck in a silent-failure loop

Stop guessing and **isolate the layer**: deploy `assets/litmus-mod/` (integer version,
single `AlwaysMet` SQL with an obvious effect). If the litmus effect shows → pipeline
is fine, the bug is in your content (sections above). If even the litmus does nothing →
the bug is environmental (deploy path, enable, version, new-game). This binary split is
almost always faster than re-reading your XML for the tenth time.
→ [deploy-and-debug.md](deploy-and-debug.md#the-litmus-mod)

## Plot-yield tradition slotted mid-session pays NOTHING until app relaunch

**Symptom (2 sightings, 2026-07):** a custom Tradition whose modifier is
`COLLECTION_PLAYER_PLOT_YIELDS` + `EFFECT_PLOT_ADJUST_YIELD` with a
`REQUIREMENT_PLOT_HAS_CONSTRUCTIBLE ConstructibleClass=WONDER` subject filter ("+2 Culture on
each Wonder plot") applies no yields when the Tradition is slotted mid-session; after a full app
exit+relaunch the same save pays correctly. Requirements were satisfied the whole time - it is
an attach/refresh failure, not a gating bug.

**Scope narrowed (in-game A/B, 2026-07-18):** the plot-collection mechanism is NOT broken
generally — a sibling card on the same collection/effect with the same owner-side window
requirements but a `ConstructibleType` (specific buildings) plot filter paid **instantly** on
mid-session slot (tile 10→15, same save). The failure is specific to the wonder-plot shape
(the `ConstructibleClass=WONDER` filter and/or wonder-plot handling).

**Fix that works (✅ in-game verified 2026-07-18 — pays the instant the card slots):** when the
payload can be expressed per-CONSTRUCTIBLE rather than per-plot,
use the base game''s other idiom — `COLLECTION_OWNER` + `EFFECT_PLAYER_ADJUST_CONSTRUCTIBLE_YIELD`
with `ConstructibleClass`/`ConstructibleType`/`Tag` (base proof: TRADITION_STYLE_EMPIRE "+2
Culture on Wonders", COCORICO "+2 Happiness on Wonders"). No plot machinery, and OWNER-collection
tradition modifiers provably apply the moment the card is slotted. Bonus: Leonardfactory''s
yields-preview engine computes this effect natively (all three filter args).

Plot-only payloads (appeal-gated tiles, two-buildings-on-one-plot) can''t be re-shaped this way -
if one of those shows the same symptom, suspect the plot-collection family generally and test
base Skazki mid-session to isolate engine vs mod.

## Plot-adjacency requirement silently never matches in a live plot-yield modifier

**Symptom (in-game, 2026-07-19):** a `COLLECTION_PLAYER_PLOT_YIELDS` + `EFFECT_PLOT_ADJUST_YIELD`
modifier whose SubjectRequirements combine `REQUIREMENT_PLOT_HAS_CONSTRUCTIBLE` (works alone -
proven) with `REQUIREMENT_PLOT_ADJACENT_CONSTRUCTIBLE_TYPE_MATCHES` pays NOTHING, reload included,
with every owner-side gate satisfied. Base usage check: that adjacency requirement appears ONLY in
requirement SETS (feat/trigger counting - where it DOES work, in-game proven) and on city
collections - never as a plot-yield modifier subject.

**Fix that works:** deliver "constructible X gains yields per adjacent constructible Y" through the
**wildcard-adjacency activation** instead - an `Adjacency_YieldChanges` row with
`AdjacentConstructible="BUILDING_Y"` (specific-type column, base-proven: Dai Viet,
japan-korea-wonders; class/tag variants: `AdjacentConstructibleClass`, `AdjacentConstructibleTag`),
a `Constructible_WildcardAdjacencies` row (`RequiresActivation="true"`, optional
`ConstructibleClass="WONDER"` to scope who gains), activated per city via
`EFFECT_CITY_ACTIVATE_CONSTRUCTIBLE_ADJACENCY`. In-game-proven mechanism (mountain/coast wildcard
rules; adjacency yields land on the target constructible itself).

## Symptom: game CRASHES loading a new game after adding data rows ("Failed Validation" in Database.log)

Open Database.log and look for `ERROR: Invalid Reference on <Table>.<Column> - "<ID>" does not
exist` followed by `Failed Validation.` — that exact pair means a FOREIGN KEY in your new rows
points at an id that is not in the CURRENT game's database, and the load dies.

**The age-scoping trap (proven 2026-07-21):** the gameplay DB only contains the CURRENT age's
module (plus base-standard and past-age content that persists). A **future age's id does not
exist yet** — e.g. `BUILDING_MUSEUM` (Modern) is an invalid reference during an Antiquity or
Exploration game. So a file loaded in EVERY age's action group (or an always-scope group) must
NEVER reference age-specific ids from a later age. An Exploration start crashed on an
`Adjacency_YieldChanges.AdjacentConstructible="BUILDING_MUSEUM"` row shipped in a shared
per-age-loaded file.

**⭐ Fix B - SELF-GUARDING SQL (often better than splitting).** Instead of enumerating ids in XML `<Row>`s,
write the rows with a SQL `INSERT ... SELECT` that **reads its own keys out of the live database**. A row can
then only be generated for something that actually exists in THIS age, so the foreign key cannot fail, and one
`criteria="always"` action group covers every age:

```sql
INSERT OR REPLACE INTO Constructible_ValidTerrains (ConstructibleType, TerrainType)
SELECT c.ConstructibleType, t.TerrainType
FROM   Constructibles c CROSS JOIN Terrains t
WHERE  c.ConstructibleType IN ('IMPROVEMENT_HAN_GREAT_WALL', 'IMPROVEMENT_MING_GREAT_WALL')
  AND  t.TerrainType       IN ('TERRAIN_FLAT', 'TERRAIN_HILL', 'TERRAIN_MOUNTAIN');
```

In an Antiquity game the Ming wall simply is not in `Constructibles`, so no row is emitted for it and nothing
breaks; in Exploration/Modern both appear. Prefer this whenever the rows are a **cross-product of ids that may
or may not exist** in a given age; prefer Fix A when each age genuinely needs *different values* rather than the
same values over whichever ids are present. Source: the Workshop mod *Great Wall on Mountains* (3777474032),
whose author hit this exact rollback; the pattern is theirs, verified against our own FK trap above.

⚠ Related silent failure from the same mod's notes: a `UnitAbilityModifiers` row naming a **ModifierId that does
not exist** rolls the WHOLE action group back with no error - the mod loads and does nothing. Same class as the
FK rollback: check every cross-file id reference by name, both directions.

**Fix A:** split such rows by age — each age's action group loads only rows referencing ids that
exist in THAT age (its own + earlier ages' persistent content). Generator pattern: emit the rows
into the per-age Database file, parameterized by the age's id. Corollary when writing ANY new
row: check the referenced id's defining module/age in the constructibles catalog first — the
XML validating and the emitted file looking right proves nothing about per-age FK validity.
