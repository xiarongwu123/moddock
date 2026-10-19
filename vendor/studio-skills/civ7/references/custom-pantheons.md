# Custom Pantheons (Civ VII) — mod-writable recipe

✅ **VERIFIED IN-GAME 2026-07-15** (standalone litmus, fresh Antiquity game): a mod-added pantheon belief showed in the pantheon chooser with its name/description/icon, was selectable and exclusive, and its Altar-gated per-plot effect fired on-tile — the whole feature end-to-end. Feasibility below is now proven, not just data-inferred.

Verified against installed data 2026-07-13. **Feasibility: YES** — a mod can add a fully-functional custom pantheon. Pantheons are plain DB rows wired through the **standard GameEffects modifier system**, and the in-game chooser is **data-driven**, so a new belief **auto-appears** and is selectable with no acquisition wiring. (For the full 60-belief catalog + the 4 belief classes, see the generated `religion-and-beliefs-catalog.md`; this file is the hand-maintained *build recipe*.)

## Where pantheons live (CONFIRMED)

`Base/modules/age-antiquity/data/religion.xml` (+ `religion-gameeffects.xml` for the concrete effects):
- `<Types>` — `Row Type="PANTHEON_BONUS_n" Kind="KIND_BELIEF"` per pantheon.
- `<BeliefClasses>` — `BELIEF_CLASS_PANTHEON` with `MaxInReligion="1"` (picks per religion, NOT catalog size).
- `<Beliefs>` — `BeliefType`, `Name`, `Description`, `BeliefClassType="BELIEF_CLASS_PANTHEON"`, optional `Shareable="true"` (multi-civ), `AISelectionBin`.
- `<BeliefModifiers>` — binds `BeliefType` → `ModifierID` (the belief→effect link the engine attaches on adoption).

The chooser (`base-standard/ui/pantheon-chooser/screen-pantheon-chooser.js`) loops `GameInfo.Beliefs`, keeps `BeliefClassType == "BELIEF_CLASS_PANTHEON"`, and calls `Game.PlayerOperations.canStart(FOUND_PANTHEON, {BeliefType})` — so a new belief enters the selectable pool automatically once the player unlocks their pantheon normally.

## Acquisition — a mod needn't touch it

Base grants the pantheon *pick* via `EFFECT_PLAYER_UNLOCK_PANTHEON` on the **Mysticism** civic node (Maurya's Acharya grants a 2nd). To hand out an extra pick, attach `EFFECT_PLAYER_UNLOCK_PANTHEON` to any node/trait. (`EFFECT_ADD_PANTHEON` is a skill-catalog DLC pattern **not present** in this base install — treat as unverified; use `_UNLOCK_PANTHEON`.)

## Minimal worked recipe (four rows + one modifier chain + loc)

```xml
<!-- data/mod-pantheon.xml -->
<Database>
  <Types><Row Type="PANTHEON_MYMOD_EXAMPLE" Kind="KIND_BELIEF"/></Types>
  <Beliefs>
    <Row BeliefType="PANTHEON_MYMOD_EXAMPLE" Name="LOC_PANTHEON_MYMOD_EXAMPLE_NAME"
         Description="LOC_PANTHEON_MYMOD_EXAMPLE_DESCRIPTION"
         BeliefClassType="BELIEF_CLASS_PANTHEON" AISelectionBin="1"/>
  </Beliefs>
  <BeliefModifiers>
    <Row BeliefType="PANTHEON_MYMOD_EXAMPLE" ModifierID="MOD_PANTHEON_MYMOD_EXAMPLE"/>
  </BeliefModifiers>
</Database>
```
```xml
<!-- data/mod-pantheon-gameeffects.xml : <GameEffects xmlns="GameEffects"> -->
<Modifier id="MOD_PANTHEON_MYMOD_EXAMPLE" collection="COLLECTION_MAJOR_PLAYERS" effect="EFFECT_ATTACH_MODIFIERS">
  <SubjectRequirements><Requirement type="REQUIREMENT_PLAYER_HAS_PANTHEON"/></SubjectRequirements>
  <Argument name="ModifierId">ATTACH_PANTHEON_MYMOD_EXAMPLE</Argument>
</Modifier>
<Modifier id="ATTACH_PANTHEON_MYMOD_EXAMPLE" collection="COLLECTION_PLAYER_CITIES" effect="EFFECT_CITY_ADJUST_YIELD">
  <SubjectRequirements><Requirement type="REQUIREMENT_CITY_HAS_BUILDING"><Argument name="BuildingType">BUILDING_ALTAR</Argument></Requirement></SubjectRequirements>
  <Argument name="YieldType">YIELD_SCIENCE</Argument><Argument name="Amount">3</Argument>
</Modifier>
```
Plus `LOC_PANTHEON_MYMOD_EXAMPLE_NAME`/`_DESCRIPTION`. `BELIEF_CLASS_PANTHEON`, `BUILDING_ALTAR`, and the effects/requirements all pre-exist — the mod only references them.

**Multi-yield beliefs.** The example above uses `EFFECT_CITY_ADJUST_YIELD`, which takes **one** `YieldType` per modifier — a belief paying two yields needs **one modifier per yield** (base does exactly this: `MOD_FOUNDER_BELIEF_DOMESTIC_FOOD` / `_PRODUCTION`). A **tile-scoped** belief built on `EFFECT_PLOT_ADJUST_YIELD` is the exception: it accepts a **comma-list** `YieldType` with a single `Amount`, paying that amount of *each* listed yield — so `YIELD_HAPPINESS, YIELD_PRODUCTION` + `Amount 1` = **+1 Happiness AND +1 Production** on the tile from one modifier (base proof: the Hoo-Do Hall appeal payout). Verified in-game 2026-07-15. Full rule + the CITY-vs-PLOT contrast: [gameeffects.md](gameeffects.md).

## Gotchas

1. The two-step `EFFECT_ATTACH_MODIFIERS` gated on `REQUIREMENT_PLAYER_HAS_PANTHEON` is the native Antiquity shape — mirror it. (The single-step Exploration form binds the `BeliefModifier` straight to a concrete effect, gated on `REQUIREMENT_PLAYER_IS_RELIGION_FOUNDER`.)
2. `religion.xml` has a dev comment calling `BeliefModifiers` "for the AI... no effect for human players" — **misleading**; the standalone `MOD_PANTHEON_*` modifiers have no other attachment point, so `BeliefModifiers` wires them for everyone (the base pantheons are built this way).
3. **No catalog-size cap** — the pool is whatever's in `GameInfo.Beliefs` of the pantheon class.
4. **Antiquity-flavored** — native pantheons pay out *through `BUILDING_ALTAR`*, so they fade as the Altar goes obsolete (standard age-transition static-function behavior). A custom pantheon can use any effect, but key it off the Altar to behave natively.
5. Exclusivity is engine-enforced via the `FOUND_PANTHEON` operation — only the `Shareable` flag is yours.
6. **Icon (verified in-game):** the belief needs an `IconDefinition` whose `ID` = the `BeliefType` and `Path` = a `blp:` or a `fs://` PNG (base has `data/icons/pantheon-icons.xml`: `<Row><ID>PANTHEON_BONUS_4</ID><Path>blp:pant_festivals</Path></Row>`). Load it via `<UpdateIcons>`. Fastest: reuse a base pantheon blp (`blp:pant_festivals`, `blp:pant_harvest`, …) — no `ImportFiles`. For a **bespoke icon**, `ImportFiles` a PNG and point `Path` at `fs://game/<mod>/ui/icons/<name>.png` (belief icon loads fine from a game-scope `always` group). Without it the chooser shows a placeholder; cosmetic, not a functional blocker.
   - **⚠ Style:** base pantheon glyphs are **grey/silver (pewter) on a dark disc with a coppery ring — NOT gold.** A gold glyph looks out of place next to them; match the silver.
   - **Making the PNG from SVG (Coherent won't render SVG-as-background, so you need a raster):** author the medallion as an `<svg>`, then rasterize via a headless browser canvas — `new Image()` with `src="data:image/svg+xml,"+encodeURIComponent(svg)`, `drawImage` onto a `<canvas>`, `canvas.toDataURL("image/png")`. A data-URI SVG doesn't taint the canvas, so `toDataURL` works. To get the bytes to disk, `fetch`-POST the base64 to a tiny local server (CORS-enabled) that writes `Buffer.from(b64,'base64')` to the PNG path — cleaner than piping a 90 KB string back through the tool. 256×256 transparent PNG is a good size. This SVG→canvas→POST pipeline works for **any** custom raster icon, not just pantheons.
   - **⚠ Two things that make a custom medallion match the base (both learned in-game):** (a) **transparent interior** — draw the ring as an *annulus* (stroke, not a filled disc) and leave the middle transparent; the chooser card provides the dark backing. An opaque dark disc renders as a distinct **black oval** the base icons don't have. (b) **Size the glyph to fill ~65–70% of the ring** (scale it up around the medallion centre) — base glyphs nearly fill the frame; a small centred glyph reads faint next to them.
7. **Description icons:** match the base LOC style — `+1 [icon:YIELD_CULTURE] Culture on … in [TIP:LOC_PEDIA_CONCEPTS_SETTLEMENT_TOOLTIP]Settlements[/TIP] with an Altar.` (yield token `[icon:YIELD_*]`, tooltip-linked terms `[TIP:loc]word[/TIP]`). A plain string works but reads unlike the base pantheons.
8. **"On an improvement" gate (verified):** to pay "+X on Plantations/Camps/etc." use `REQUIREMENT_PLOT_HAS_CONSTRUCTIBLE` with `ConstructibleType=IMPROVEMENT_PLANTATION` (it accepts improvements, not just buildings) — cleaner and list-proof vs. enumerating each `REQUIREMENT_PLOT_RESOURCE_TYPE_MATCHES`. Keep the native `REQUIREMENT_CITY_HAS_BUILDING BUILDING_ALTAR` gate too — every base Civ7 pantheon pays *through the Altar*, so dropping it makes yours behave un-natively.

Related: `great-people.md`, and the generated `religion-and-beliefs-catalog.md`.
