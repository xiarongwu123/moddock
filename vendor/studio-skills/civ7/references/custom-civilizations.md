# Custom Civilizations — the full recipe (worked examples, confidence-labeled)

How to add a complete playable civilization: setup-screen registration, the civ definition,
age-transition unlocks in both directions, unique improvements/units/great-people, and 3D
visuals without authoring any 3D art.

**Sources & evidence tiers.** Primary source = three shipping Workshop civs by Ongsiru, read
2026-07-26: Goguryeo `3762541528` (Antiquity civ), Austria `3769193947` (Modern civ),
Saudi Arabia `3771209470` (Modern civ). Quality signals: modinfo at Steam revision 91
(v0.9.51), accurate engine-behavior comments in the XML, dual-locale text, disciplined
`InsertOrIgnore`. **These mods were NOT independently verified in-game by us.** Every claim
below is labeled:

- ✅ **BASE-PROVEN** — the same table/column/API appears in base-game data (file cited).
- 📦 **WORKED-EXAMPLE** — present in the shipping mods, idiomatic, but not base-identical
  and not verified in-game by us.
- ⚠ **NEEDS-LITMUS** — plausible extension of a base idiom; litmus before relying on it.

---

## Layer 1 — Shell registration (`config/`, shell scope)

The game's setup screens read a SEPARATE config database. Without this layer the civ plays
fine but can never be picked. ✅ BASE-PROVEN shape (matches base `config/` modules; also the
Matt's-Ireland worked example in [ui-modding.md](ui-modding.md) section 5).

- `config.xml` →
  - `Civilizations` row with `Domain="AntiquityAgeCivilizations" | "ExplorationAge..." | "ModernAge..."`
    (the Age picker bucket) + name/description/icon/intro-text.
  - `CivilizationItems` — the bullet list the picker shows (ability + each unique, with icons).
    One row per Age domain if the ability text differs per Age (Austria shows AQ/EX/MO variants).
  - `CivilizationTags` — `TAG_TRAIT_CULTURAL` etc. + `TAG_APEX_AGE_*`.
  - `CivilizationUnlocks` — **base civ → your civ** at an Age transition (Austria: Rome, Greece,
    or Spain unlock it for AGE_MODERN). This is what puts the civ on the transition screen.
  - `LeaderUnlocks` + `LeaderCivilizationBias` — leader-based unlock + picker bias with a
    tooltip reason (Charlemagne → Austria, Bias 2).
- 📦 A tiny `config-legacy-civilization-traits.sql` runs in a shell `always` group at
  **LoadOrder 0** with the comment "the UI compatibility table must exist before shell content
  is applied." Purpose not traced by us; harmless to replicate; drop once base provides it.

## Layer 2 — The civ definition (`data/civilizations.xml`, game scope)

✅ BASE-PROVEN shape throughout (mirror any base civ module):

- `Types`: `KIND_CIVILIZATION` + one `KIND_TRAIT` per trait (an internal marker trait that
  uniques hang off, + a visible "ability" trait).
- `Civilizations` row: `StartingCivilizationLevelType="CIVILIZATION_LEVEL_FULL_CIV"`,
  `ApexAge`, `CapitalName`, `RandomCityNameDepth` — and optionally
  **`UniqueCultureProgressionTree`** (e.g. `TREE_CIVICS_AQ_GOGURYEO`): the NATIVE per-civ
  unique-civics-tree hook (this is how base civs get their civic mini-tree; distinct from a
  full custom tree — see [custom-progression-trees.md](custom-progression-trees.md)). Later-Age
  unique trees load age-scoped (`progression-trees-culture-unique-ex/mo.xml`).
- `LegacyCivilizations` row — required for transition-screen/legacy identity.
- `CivilizationTraits`: the Age marker (`TRAIT_ANTIQUITY_CIV` etc.), your traits, and the
  **AI-steering attribute traits in per-Age variants** (`TRAIT_ATTRIBUTE_MILITARISTIC` +
  `_TOT_EX` + `_TOT_MO`, `..._EXPANSIONIST_WIDE`, …) — omit these and the AI has no
  personality with the civ.
- `TraitModifiers` on the ability trait → ordinary GameEffects modifiers ([gameeffects.md](gameeffects.md)).
- `CityNames` (Goguryeo ships 30), citizen names, `StartBiasTerrains`/`StartBiasResources`.

## Layer 3 — Age scoping + forward unlocks

- Modinfo criteria exactly like ours: per-Age `-current` groups for units/civics/narratives;
  an any-of-three `-persist` group for content that must survive transitions (the AGELESS
  unique improvement loads there); `civilizations-exploration.xml` / `-modern.xml` define
  what persists of an early civ in later Ages. ✅ BASE-PROVEN pattern ([modinfo.md](modinfo.md)).
- **Forward direction** (`data/unlocks.xml`): playing your civ unlocks specific base civs at
  the next transition — `UnlockRequirements` rows adding a `REQSET_CIV_IS_<YOURS>`
  requirement set to base `UNLOCK_CIVILIZATION_*` types, **everything `InsertOrIgnore`** so
  the rows coexist with base and other mods. ✅ BASE-PROVEN table shape; 📦 the etiquette.
- 📦 Cross-mod integration: `ModInUse` / `ModIsEnabled` criteria load integration files only
  when another mod is present (Goguryeo ↔ Ottomans files); a hard `<Mod id="silla">`
  Dependency shares the author's unit-culture assets between his own civs.

## Layer 4 — Uniques

### Unique improvement (Sanseong / Salon / Aramco Well pattern)

✅ BASE-PROVEN tables throughout (see also [constructibles.md](constructibles.md),
[constructibles-placement-adjacency.md](constructibles-placement-adjacency.md)):

- `Constructibles` row, `ConstructibleClass="IMPROVEMENT"`, with per-copy cost growth:
  `CostProgressionModel="COST_PROGRESSION_PREVIOUS_COPIES_CITY"` + `Param1`.
- `Improvements` row: **`TraitType=<civ trait>` is the entire civ-restriction**, plus
  `CityBuildable="true"`. Optional placement constraints as data, no code:
  `AdjacentTerrain="TERRAIN_MOUNTAIN"` (Constructibles row), `MustBeAppealing="true"`,
  `SameAdjacentValid="false"` (Improvements row).
- TypeTags: `UNIQUE_IMPROVEMENT`, `AGELESS`, plus behavior tags (`FORTIFICATION` gives
  fort behavior + makes it count for fortification-adjacency).
- Own adjacencies via `Adjacency_YieldChanges` + `Constructible_Adjacencies`; and
  ✅ BASE-PROVEN `Constructible_WildcardAdjacencies` (base: all three age modules) to grant an
  adjacency to a whole CLASS of *other* buildings by tag — Goguryeo gives FOOD_WAREHOUSE /
  PRODUCTION_WAREHOUSE buildings +Production beside FORTIFICATION tiles, `RequiresActivation="true"`.
- `Constructible_Plunders`, `Constructible_Advisories` (AI awareness — same lesson as
  [custom-units.md](custom-units.md): no advisories = AI blindness).

### Unique units

Multi-tier uniques = one row per tier (`UNIT_X`, `UNIT_X_2`, `UNIT_X_3`) with `Tier=` and
`TraitType=` on each ([custom-units.md](custom-units.md) has the full minimum-table recipe).
📦 Unique CIVILIAN with `MakeTradeRoute="true"` (Saudi's Mandub al-Naft = a trait-locked
merchant with per-copy cost growth) — table columns are base, the combination is the example's.

### Civ-unique Great People (Austria's 10 musicians)

The 3-table shape, Retire actions, and civ-locking are already banked and verified in
[great-people.md](great-people.md). What Austria adds:

- ✅ BASE-PROVEN: binding the class to a constructible — base
  `GREAT_PERSON_CLASS_SHI_DAFU` uses `ConstructibleType="BUILDING_PALACE"` (+`PopulationRequired`),
  base Greece/Egypt use `UniqueQuarterType` (`age-antiquity/data/greatpeople.xml`).
- ⚠ **NEEDS-LITMUS**: Austria binds the class to an **IMPROVEMENT**
  (`ConstructibleType="IMPROVEMENT_AUSTRIA_SALON"`). Same column, but no base row binds to an
  improvement — verify a musician actually spawns from a Salon before relying on
  improvement-bound classes.
- ✅ BASE-PROVEN: per-individual `UnitType` + per-individual placement requirements on the
  Retire action (`ActionRequiresForeignCapital`, `ActionRequiresCapital`,
  `ActionRequiresNavigableRiver`, `ActionRequiresAdjacentMountain`,
  `ActionRequiresCompletedConstructibleTag="HAPPINESS|SCIENCE|GOLD|CULTURE|MILITARY"` +
  `ActionRequiresCompletedDistrictType`) — base Modern's **Jacobin** class uses exactly these
  columns (`age-modern/data/greatpeople.xml`), which is also the class Austria remaps its
  models from. Ten individuals, each a themed puzzle: Mozart retires in a FOREIGN capital,
  Strauss beside a Navigable River, Mahler beside a Mountain, etc.
- ✅ `GreatPersonIndividualIconModifiers` `OverrideUnitIcon` = one shared 2D icon for all
  individuals.

## Layer 5 — Art without authoring 3D (the whole doctrine)

**These mods contain ZERO 3D assets** (file census: png/xml/js/sql only). Everything visual
is 2D PNGs + two reuse mechanisms:

1. **Units → `VisualRemaps`** (own `UpdateVisualRemaps` action — [custom-units.md](custom-units.md)):
   every tier remapped to a base unit (`UNIT_HORSEMAN`, `UNIT_LINE_INFANTRY`…); each great-person
   individual remapped to a base great-person model (the Jacobins). Comments note the model
   resolves through the civ's `UnitCulture`, so the donor pick controls the ethnic model set.
2. **Improvements → the WorldUI cooked-asset renderer** 📦 (the new pattern; API itself
   ✅ BASE-PROVEN — `WorldUI.createModelGroup` is used by base `cinematic-manager.js`,
   `leader-model-manager.js`, `interface-mode-choose-plot.js`):
   when `VisualRemaps` can't/won't render an improvement (Goguryeo's comment: the Hillfort
   visual is authored for hills and does not instantiate on flat terrain; Saudi's custom
   improvements have no cooked model at all), ship a game-scope UIScript that draws a base
   cooked asset at each completed plot. The recipe (both mods identical):
   - Guard `UI.isInGame()`, poll-install until engine globals exist, one-shot flag on `globalThis`.
   - `WorldUI.createModelGroup("<name>")`; params `{ placement: PlacementMode.TERRAIN,
     followTerrain: true, needsShadows: true }` (+ optional `angle:` — Saudi rotates its
     mine 180° to look distinct from the base mine).
   - Scan `player.Constructibles.getConstructibles()` for completed instances of the type;
     **visibility-check other players' plots** via `GameplayMap.getRevealedState(observer,…)
     === RevealedStates.VISIBLE`.
   - Rebuild only when a sorted signature string of `(owner,id,x,y)` changes.
   - Asset names seen working: `IMP_Hillfort`, `IMP_OIL_RIG`, `IMP_Mine_ANT` / `IMP_Mine_MOD`
     (Saudi picks the mine asset by `GameInfo.Ages.lookup(Game.age)` — Age-conditional visuals).
   - **Purely cosmetic** — no gameplay state; degrades safely if the script fails.
   - 💡 Candidate use: rendering a WONDER's cooked asset on a tile whose district can't be
     converted (the Foundations-building case — github.com/chrislittle/metropolis-ascendant
     issue #24).

## Checklist for a new civ

1. Shell: `config.xml` (picker + `CivilizationItems` + `CivilizationUnlocks` + leader bias).
2. Game: `civilizations.xml` (Types/Civilizations/LegacyCivilizations/traits incl. AI
   attribute traits/TraitModifiers/CityNames/start biases).
3. Age scoping: `-current` vs `-persist` groups; forward-persistence files; `unlocks.xml`
   (forward, `InsertOrIgnore`).
4. Uniques: improvement (TraitType + UNIQUE_IMPROVEMENT + AGELESS), units per tier, optional
   GP class (litmus if improvement-bound), optional unique civics tree
   (`UniqueCultureProgressionTree`).
5. Art: 2D PNGs (ImportFiles both scopes + UpdateIcons); VisualRemaps for units; WorldUI
   renderer for modelless improvements.
6. Text: full LOC set incl. city/citizen names, Civilopedia, loading screen.
