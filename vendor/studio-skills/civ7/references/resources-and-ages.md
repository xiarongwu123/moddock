# Resources: classes, per-age validity, and the age-transition traps

Extracted 2026-07-03 from installed 1.4.1 data while designing resource menus (Pioneer Expedition).
Source tables all live in `base-standard/data/resources.xml` + per-age module `resources.xml`
(`-v2` variants exist for the alternate resource-distribution game option).

## The tables

- `Resources` — ResourceType, **ResourceClassType**, Weight, `AdjacentToLand="true"` (= water
  resource marker: fish/pearls/dyes/whales), Name/Tooltip LOCs.
- `Resource_ValidAges` — THE per-age availability map. A resource with no row for an age is not
  age-legal there.
- `Resource_ValidBiomes` — ResourceType + BiomeType + TerrainType (+FeatureType): natural map-gen
  placement. BIOME_MARINE / TERRAIN_COAST = water. ⚠ Story/effect placement
  (EFFECT_PLOT_PLACE_RESOURCE) is LOOSER than these rows — wine placed fine on flat tundra.
  **BUT the Surveyor/Prospector CLAIM does NOT target effect-seeded resources AT ALL (❌ CONFIRMED
  in-game 2026-07-03, pioneer-litmus v3):** seeds on VALID terrain within range (Wine on flat
  grassland/plains, Wool on rough — both ≤4 hexes) were skipped by the claim target highlighter
  while a natural resource claim worked in the same save. Terrain was ruled OUT as the cause
  (v2's off-terrain theory disproven). The native `UNITCOMMAND_CLAIM_RESOURCE` validity check
  evidently only sees natively-registered (map-gen/age-transition) resources — an
  `EFFECT_PLOT_PLACE_RESOURCE` seed renders and shows yields but is claim-invisible. **A
  seed-then-claim chain is NOT shippable.** Claim-independent alternative:
  `EFFECT_CITY_ADD_RESOURCE_TO_PLOT` (the suzerain gift-resource mechanism, base
  ATTACH_LAPIS_LAZULI/CLOVES/NICKEL on `COLLECTION_PLAYER_CAPITAL_CITY`) places a resource on an
  owned capital plot that improves and slots. **In-game verified 2026-07-03 with ordinary
  map-gen resources: CITY-class works (Gypsum landed in the city); EMPIRE-class did NOT (Marble
  never appeared — note all 3 base gift resources are CITY class). Treat the effect as
  CITY-class-only until the Marble failure is diagnosed** (class restriction vs no valid plot).
  ⚠ **Terrain id ≠ display name**: land terrain ids are `TERRAIN_FLAT` / `TERRAIN_HILL` /
  `TERRAIN_MOUNTAIN`, displayed in-game as **Flat / Rough / Mountainous** — "hill" in data terms
  is the tile the player sees as **Rough** (there are no "Hills" in Civ VII UI).
- `Resource_YieldChanges` — tile yields.
- `Resource_Distribution` — map-gen caps per age (MaxResourceTypes, ResourceTypeMaxPerHemisphere).

## ⚠ Class is PER-AGE: age modules patch `ResourceClassType` via `<Update>` rows

Don't read a resource's class from base-standard and assume it holds. **Exploration reclasses
Horses, Gold, Silver, Furs, Cocoa, Spices, Sugar, Tea (+ Gold/Silver DISTANT_LANDS, Rubies) to
`RESOURCECLASS_TREASURE`** — `Assignable="false"`, they exist to feed Distant-Lands treasure
fleets; in the Homelands they are dead weight for the whole age. Modern reclasses again
(FACTORY class appears: Cotton/Kaolin/Tea/Coffee/Citrus/Quinine/Cocoa; Gold/Silver return to
EMPIRE; Horses/Wine drop to BONUS). Classes: BONUS (settlement-local auto), CITY (city slot),
EMPIRE (empire-wide slot), TREASURE (EX, fleets only), FACTORY (MO, factory slot).

**"Age journey"** = a resource's class per age (e.g. Silver: AQ EMPIRE → EX TREASURE → MO EMPIRE;
Salt: AQ CITY → gone). Any design that grants/places resources must read the journey, not the
snapshot. To build the journey table for the current patch: read `Resources` +
`Resource_Distribution` rows from `base-standard/data/resources.xml` (the baseline), then apply
each age module's `<Update>` rows to `ResourceClassType` in
`age-exploration/data/resources.xml` and `age-modern/data/resources.xml` — the per-age class is
baseline-plus-patches, NOT a per-age full table. Re-derive after each game patch.

## Other gotchas

- **Suzerain-gift resources** (Lapis Lazuli AQ, Cloves EX, Nickel MO): "Not Tradeable", NO
  Resource_ValidBiomes rows (they're placed by the city-state bonus effect
  `EFFECT_CITY_ADD_RESOURCE_TO_PLOT`, capital-owned plots). Story-placement of these is untested.
- **`RESOURCE_*_DISTANT_LANDS` variants** (Gold/Silver): separate types with no ValidAges rows —
  hemisphere-specific map-gen twins; don't use in effects unless you mean them.
- **What happens to an expired resource at age transition** (removed from map vs left inert) is
  UNVERIFIED — test before designing around AQ-only resources persisting.
- EX resources flavored "This is a Distant Lands resource…" (Niter, Truffles, Cloves) are normally
  unobtainable in Homelands that age; effect-placing them there is untested (slotting may or may
  not work).
