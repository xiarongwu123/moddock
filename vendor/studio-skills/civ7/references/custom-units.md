# Custom units: abilities, charges, granting, icons, visuals, AI

Everything here was learned building a custom "Surveyor"-style unit (a buildable civilian that
carries the base Prospector's `CLAIM_RESOURCE` command into every Age). Units have several **silent /
non-obvious** failure modes that don't match the constructible or modifier rules — read this before
adding a unit, an icon for one, or a 3D look.

## Defining a buildable unit (minimum tables)

A custom unit is buildable from turn 1 of its Age with just these rows (root `<Database>`, loaded via
`UpdateDatabase`), no tech gate needed — exactly like the base Scout/Settler:

```xml
<Types>      <Row Type="UNIT_MYMOD_SURVEYOR" Kind="KIND_UNIT"/></Types>
<Units>      <Row UnitType="UNIT_MYMOD_SURVEYOR" Name="LOC_..._NAME" Description="LOC_..._DESCRIPTION"
                  BaseSightRange="1" BaseMoves="3" UnitMovementClass="UNIT_MOVEMENT_CLASS_FOOT"
                  Domain="DOMAIN_LAND" CoreClass="CORE_CLASS_CIVILIAN" FormationClass="FORMATION_CLASS_SUPPORT"
                  ZoneOfControl="false" CostProgressionModel="COST_PROGRESSION_PREVIOUS_COPIES"
                  CostProgressionParam1="20"/></Units>
<Unit_Costs> <Row UnitType="UNIT_MYMOD_SURVEYOR" YieldType="YIELD_PRODUCTION" Cost="30"/></Unit_Costs>
```

- **No `ProgressionTreeNodeUnlocks` row = buildable from the start of the Age.** Adding one tech-gates the
  build — and see the granting gotcha below, because a tech-locked unit **cannot be granted**.
- **There is NO player-state buildability gate for units** (same as constructibles). You can't make a unit
  "buildable only while tall / while you own X". Gate the unit's *effect* instead (e.g. its ability charge).
- `CostProgressionModel="COST_PROGRESSION_PREVIOUS_COPIES"` makes each extra copy cost more.

## Porting a Modern-only ability into Antiquity/Exploration (the CLAIM_RESOURCE case)

The Prospector's resource-claim ability chain ships **only in age-modern**. To give an AQ/EX unit the same
command, replicate the whole chain in that Age's data (Modern already has it — re-adding there is a
duplicate-insert **crash**, so emit the chain for AQ/EX only):

```xml
<Types>                <Row Type="ABILITY_CLAIM_RESOURCE" Kind="KIND_ABILITY"/></Types>
<Tags>                 <Row Tag="UNIT_CLASS_PROSPECTOR" Category="UNIT_CLASS"/></Tags>
<TypeTags>             <Row Type="UNIT_MYMOD_SURVEYOR" Tag="UNIT_CLASS_PROSPECTOR"/></TypeTags>
<UnitClass_Abilities>  <Row UnitAbilityType="ABILITY_CLAIM_RESOURCE" UnitClassType="UNIT_CLASS_PROSPECTOR"/></UnitClass_Abilities>
<UnitAbilities>        <Row UnitAbilityType="ABILITY_CLAIM_RESOURCE" Name="LOC_..._NAME" Description="LOC_..._DESC"/></UnitAbilities>
<ChargedUnitAbilities> <Row UnitAbilityType="CHARGED_ABILITY_CLAIM_RESOURCE" RechargeTurns="999"/></ChargedUnitAbilities>
```

- The **command** `UNITCOMMAND_CLAIM_RESOURCE` is base-standard (all Ages) and self-highlights valid target
  plots via `ShowActivationPlots="true"` — you get the "where can I claim" helper UI for free.
- Native reach = **5 hexes** from any of your Settlements, **resource tiles only**; the surrounding land
  joins as territory but empty tiles stay unworkable at the 3-hex work radius (see
  [tile-ownership-and-radius.md](tile-ownership-and-radius.md)).
- ⚠ **The claim's target validity is native and narrow (in-game verified 2026-07-03):** it only
  targets **natively-registered** resources (map-gen, age-transition seeding, or discovery-site
  story rewards). A resource placed by a runtime modifier/story (`EFFECT_PLOT_PLACE_RESOURCE`
  from a gossip-anchored story or plot collection) renders and yields but is **invisible to the
  claim** — the highlighter never lights it, on any terrain, at any range; the story-row
  `ResourceReq` column does not change this. And the **5-hex range has NO data parameter**
  (the only "claim range" param in the dataset belongs to the dead diplo LAND_CLAIM system) —
  both the range and the target filter are unmoddable.
- In **Modern** you only need the unit + `UNIT_CLASS_PROSPECTOR` tag; the base game supplies the rest.

## Charges & self-consumption (there is no generic "consume after use")

- A unit's action count comes from a **charge**: `EFFECT_GRANT_UNIT_ABILITY_CHARGE` with args
  `ChargedAbilityType` + `Amount`, delivered by a `UnitAbilityModifiers` row binding the modifier to the
  ability. `RechargeTurns` on the `ChargedUnitAbilities` row is the only regen knob.
- **Using `UNITCOMMAND_CLAIM_RESOURCE` self-consumes the unit when its last charge is spent** — that
  vanish is **engine-hardwired to the command**, not a data flag. Amount=1 → one claim, then gone.
- **You cannot make a unit vanish after an arbitrary custom action.** Consumption is hardwired to specific
  actions only: `UNITOPERATION_FOUND_CITY` (Migrant/Settler), the `MakeTradeRoute="true"` flag on the
  Units row (Merchant *becomes* the route), and charged commands like CLAIM_RESOURCE. There is **no**
  data-level "remove this unit" effect you can hook to a custom event (`EFFECT_PLAYER_DESTROY_UNIT_WITH_HIGHEST_LEVEL`
  targets an arbitrary tagged unit and can't hook an action). `Consumer="true"` is an unrelated AI attribute.
- **Modern shares its charge with the base unit.** If your Modern unit is `UNIT_CLASS_PROSPECTOR`-tagged it
  inherits the base `PROSPECTOR_MOD_GRANT_ABILITY_CHARGE` (COLLECTION_OWNER, **ungated**, shared with
  America's Prospector). You can't per-unit-remove that; gating the charge in Modern means giving your unit
  its *own* claim chain instead of the shared tag (heavier).

## Granting a unit (two traps)

1. **A tech-LOCKED unit can't be granted.** `EFFECT_CITY_GRANT_UNIT` no-ops if the unit has an
   un-researched `ProgressionTreeNodeUnlocks`. Symptom: nothing spawns, and the unit shows "blocked by
   <tech>" in the tree. Fix: drop the unlock row (buildable + grantable from turn 1, like Scout).
2. **`run-once="true"` through the attach wrapper fires at ATTACH time, not deferred.** A one-shot grant
   gated on "city reaches pop N" evaluates once at game start (pop < N) and never re-fires. For "grant a
   unit when a city reaches state X" use a **continuous** grant capped by
   `REQUIREMENT_PLAYER_HAS_AT_LEAST_NUM_UNIT_TYPE inverse="true"` (own fewer than N) — re-evaluates every
   turn like the working tier bonuses and hard-caps total grants without run-once. ⚠ If the unit
   self-consumes, an "own fewer than 1" cap **re-grants forever** — for a consumable unit, prefer
   buildable-only over a grant.

## Icons: a unit needs TWO rows, in BOTH scopes, from an `always` group

The build list, tooltips and small map flag resolve a unit icon via `UI.getIconURL(UnitType, "UNIT_FLAG")`
against `IconDefinitions`. Two independent gotchas, both giving a **blank/black icon** with no log error:

- **Register TWO rows** (mirror the base Scout's full footprint): a default-context **flag** row and a
  **FONTICON** portrait row. Flag alone → the panel/list portrait is blank.
  ```xml
  <IconDefinitions>
    <Row><ID>UNIT_MYMOD_SURVEYOR</ID><Path>blp:unitflag_immigrant</Path></Row>
    <Row ID="UNIT_MYMOD_SURVEYOR" Context="FONTICON" IconSize="64" Path="blp:fi_unit_migrant_64" />
  </IconDefinitions>
  ```
  Reuse any base blp (`unitflag_*` + `fi_unit_*_64`); no custom art needed. Pick a donor whose blps live in
  **base-standard** (Scout, Migrant, Settler, Merchant) so they exist in every Age — a `unitflag_prospector`
  ships only in age-modern and won't resolve in AQ/EX.
- **✅ CUSTOM PNG icons also work (in-game verified):** both rows accept an
  `fs://game/<modId>/<path>.png` Path instead of a blp — build list, unit flag and panel icon all render it.
  Requirements: `ImportFiles` the PNG **in BOTH `scope="game"` and `scope="shell"` `always` groups** (same
  dual-scope rule as the icon XML), plus an extensionless twin copy of the file (Ireland-mod convention — the
  engine references textures by bare ID in some contexts). Art style: white silhouette on transparency,
  anti-aliased (supersample from 512px), ~64–128px. The unit-icon contexts are NOT among the `blp:`-prefix
  drop spots that break custom-civ art (those are civ-specific: splash/chooser/age-cards/diplo/culture-nodes).
- **Load the icon file in BOTH `scope="game"` AND `scope="shell"` action groups, `criteria="always"`.** The
  unit-flag manager reads icon-name definitions from the **shell** icon DB; a game-scope-only registration
  leaves in-game flags/portraits **black**. And per-Age (`criteria="age-*"`) icon groups **don't register
  at all** — the icon manager only reads `always` groups (this is why a single-module, multi-Age mod gets
  **one global unit look**, not per-Age art). The base loads every `unit-icons.xml` in both game+shell
  always groups for exactly this reason.

## 3D model & the live-render portrait (VisualRemap + its hard limit)

- **`VisualRemaps` is NOT a gameplay-DB table.** Loading it via `UpdateDatabase` crashes at map load with
  `no such table: VisualRemaps`. It has its **own action**: `<UpdateVisualRemaps><Item>...</Item></UpdateVisualRemaps>`
  (base loads `data/visual-remaps.xml` this way in both game + shell `always` groups). Same "load in an
  `always` group" rule as icons.
- **Direction: `From` = the DONOR (a real unit whose 3D model exists), `To` = your new unit.** Base
  convention: `REMAP_SCOUT_FOUNDER` = `From UNIT_SCOUT → To UNIT_SCOUT_FOUNDER` (the requested identity is
  `To`; the donor art is `From`). Getting it backwards → no model.
  ```xml
  <VisualRemaps><Row>
    <ID>REMAP_MYMOD_SURVEYOR</ID><DisplayName>LOC_..._NAME</DisplayName><Kind>UNIT</Kind>
    <From>UNIT_MIGRANT</From><To>UNIT_MYMOD_SURVEYOR</To>
  </Row></VisualRemaps>
  ```
  This makes the unit render as the donor **on the map and in the build menu**.
- **The selected-unit panel PORTRAIT stays black even with a correct remap** — that square is a
  **live 3D render of the unit's OWN art asset** (`unit-actions.js` `setupUnitInfo()`:
  `WorldUI.requestPortrait(unitType, unitType, bg)` → `background-image: url("live:/UNIT_TYPE")`). A
  brand-new unit has no art asset, so it renders black regardless of icons or remaps — `VisualRemaps`
  can't alias it (only 3 founder-overlay remaps exist game-wide; no unit→unit art alias).
- **✅ THE FIX — a tiny `UIScripts` decorator (in-game verified):** decorate the
  panel and re-point the render at the donor. `Controls.decorate("unit-actions", (component) => …)` wraps
  `component.setupUnitInfo` on the instance (the provider runs at component creation, before attach, and
  must return an object with all four no-op lifecycle methods `beforeAttach/afterAttach/beforeDetach/afterDetach`);
  after the base method runs, if `component.portraitImage.style.backgroundImage` contains your unit type,
  call `WorldUI.requestPortrait("UNIT_<DONOR>", "UNIT_<DONOR>", "UnitPortraitsBG_BASE")` and set the style
  to `url("live:/UNIT_<DONOR>")` — bit-for-bit the call path a real selected donor unit uses, so it renders
  the donor's live 3D portrait. String-match the style (no `Units`/`GameInfo` lookups needed); try/catch
  everything so the worst case is the base black square. Load the script via `<UIScripts>` in a game-scope
  `always` group. Working example: a mod's `ui/<feature>/<feature>-portrait.js` decorator. (The
  army-panel has the same render pattern — extend the same patch there only if the unit can appear in armies.)
- **⚠ The remapped map model is a FIXED, era-wrong mesh — and this can't be fixed from data (verified
  2026-07-15).** A base unit's on-map 3D model is resolved by the OWNER's **Civilization → UnitCulture**
  (`VisArt_CivilizationUnitCultures`: `CivilizationType → UnitCulture`). Because you play a different civ
  each Age, the *same* `UNIT_MIGRANT` looks antiquity-robed under an Antiquity civ and 18th-c.-wigged under
  an Exploration civ — the unit isn't evolving, the civ is. But a `VisualRemap` has **no culture/Age
  column** (From/To/ID/Kind/DisplayName only), and your custom unit has **no UnitCulture of its own**, so
  the relink resolves to a **default-culture** donor mesh — e.g. the wigged Migrant shown even in Antiquity,
  never the player's current-civ variant. There is no remap knob and no accessible unit→UnitCulture table to
  fix it; getting per-Age/per-civ art means wiring the unit into the `VisArt`/art-definition pipeline (visual
  layer / dev art tools), i.e. bespoke art, not config. Practical takeaway: **pick a donor whose *default*
  mesh reads acceptably in your target Age**, or accept the cosmetic mismatch — donor-swapping and
  FormationClass changes can't make the remap Age-adapt (and matching the donor's FormationClass is separately
  required for cloned commands like `CLAIM_RESOURCE`, so don't change it for looks).

## Per-resource yield & tall gating (effect-side levers)

- **`EFFECT_CITY_ADJUST_YIELD_PER_RESOURCE`** (args `Amount`, `YieldType`, `ResourceType`,
  `PercentMultiplier`) pays a city extra of a yield per copy of a resource it owns — one modifier per
  `(resource, yield)` pair. Drive it data-first off the base `Resource_YieldChanges` rows
  (`resources.xml` + `resources-v2.xml`) so it covers DLC automatically. NOTE: it's a **city-total** yield,
  invisible on the tile; to show a bonus *on the resource tile* use `EFFECT_PLOT_ADJUST_YIELD` +
  `COLLECTION_PLAYER_PLOT_YIELDS` + `REQUIREMENT_PLOT_RESOURCE_TYPE_MATCHES`.
- **Tall-gating a player-level ability charge:** put `REQUIREMENT_PLAYER_HAS_X_SETTLEMENTS inverse="true"`
  (the "fewer than N settlements" cutoff) as a SubjectRequirement on the `COLLECTION_OWNER` charge-grant
  modifier. Clean in AQ/EX; Modern rides the shared base Prospector charge (see above), so gating there is
  harder.

## AI behavior: no hooks = the AI ignores the unit

- The AI builds and uses a unit only when it has **AI hooks**: `Unit_Advisories` rows
  (`AdvisoryClassType`, e.g. `ADVISORY_CLASS_EMPIRE_EXPANSION`/`ECONOMIC`/`FOOD`) and often a unit-bias
  list entry in a civ's `ai-shared.xml` (e.g. `America Unit Biases … UNIT_PROSPECTOR Value=50`). The
  claim-resource *behavior* itself is driven off those same Prospector advisories.
- **A custom unit with NO advisories/biases/operations is effectively invisible to the AI** — it won't
  prioritize/spam it and can't drive its special ability. Handy: an ungated player utility with no AI hooks
  is not a wide-AI exploit (only a human uses it). Conversely, if you *want* AI use, you must add the hooks.
- A third AI table exists beyond advisories/biases: **`AIUnitPrioritizedActions`** (found in the shipped
  Prospector chain during benchmark verification) — it maps a unit to the actions the AI should
  prioritize with it. If you port a chargeable ability and want the AI to actually *use* the charge,
  mirror the base unit's row here too, not just its advisories.

## Load-order recap for a unit + its icon/visual/binding

- Unit definition (`Types/Units/…`) → an `UpdateDatabase` group that loads **before** any modifier that
  references the unit type (e.g. a grant). A `*-shared` group at a lower LoadOrder works.
- `UnitAbilityModifiers` binding a charge-grant → an `UpdateDatabase` group loading **after** the
  modifiers.xml that defines the charge-grant modifier (so the FK resolves).
- Icons → `<UpdateIcons>` in game **and** shell `always` groups.
- Visual remap → `<UpdateVisualRemaps>` in an `always` group (game; add shell to match base).
