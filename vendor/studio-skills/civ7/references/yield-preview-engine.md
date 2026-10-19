# Predicting a constructible's yield at a hypothetical plot (the "map-tack" yield engine)

How to compute, **in pure UI JavaScript**, what yields a Building/Wonder/Improvement
*would* produce if placed on a given plot — **before it exists**, without asking the
engine to place anything. This is the hard, reusable core behind planner/overlay mods
(Detailed Map Tacks by wltk, City Planner by Drongo). Distilled from reading that source;
the algorithm and the `GameInfo` tables / `GameplayMap` APIs named here are game facts, so
this is a reimplementation recipe, not lifted code.

Why it's hard: the engine computes a placed constructible's yield from base yields **+**
adjacency rules evaluated against neighbors **+** whatever player-owned modifiers
(traditions, tech/civic nodes, beliefs, leader/civ traits, other buildings) happen to
touch it. None of that is exposed as "preview this placement" — you have to **re-derive
all three parts yourself from the data tables and live map**.

## Top-level decomposition

For a constructible `type` at plot `(x,y)`:

```
totalYield = baseYields(type)
           + selfBonusYields(x, y, type)      // player modifiers that grant this building a plot yield
           + adjacencyYields(x, y, type)       // its Adjacency_YieldChanges evaluated vs the 6 neighbors
```

Cache the static data once on `engine.whenReady` (adjacency lists, modifier tables); only
the per-plot evaluation runs on demand.

## Part 1 — Base yields (easy)

Read `GameInfo.Constructible_YieldChanges` for rows matching `type` → `{YieldType, YieldChange}`.
Flat, no context.

## Part 2 — Adjacency yields (the map-reading part)

Two adjacency sources, both keyed to the constructible:

1. **`GameInfo.Constructible_Adjacencies`** — direct rows: `{ConstructibleType, YieldChangeId,
   RequiresActivation}`. Build a map `constructibleType → [{id, requiresActivation}]`.
2. **`GameInfo.Constructible_WildcardAdjacencies`** — apply to *classes* of building, filtered
   by `ConstructibleClass` / `ConstructibleTag` / `CurrentAgeConstructiblesOnly`. **Only
   `BUILDING`-class constructibles get wildcard adjacencies** — wonders and improvements
   skip them. (This is the "Wonders give an adjacency to all buildings" rule from
   [game-systems-reference.md](game-systems-reference.md), expressed as data.)

For each adjacency id:
- If `RequiresActivation`, skip it unless the player has unlocked it (see the modifier
  engine's `isAdjacencyUnlocked` below — activation comes from a
  `EFFECT_CITY_ACTIVATE_CONSTRUCTIBLE_ADJACENCY` modifier the player owns).
- Look up `GameInfo.Adjacency_YieldChanges.lookup(id)` → an **adjacencyDef** with a big set
  of optional `Adjacent*` columns. Exactly one (or few) is set; each is a *predicate over a
  neighbor plot*:

  | adjacencyDef column | matches a neighbor where… |
  |---|---|
  | `AdjacentBiome` / `AdjacentTerrain` / `AdjacentFeature` / `AdjacentFeatureClass` | plot's biome/terrain/feature(class) equals it |
  | `AdjacentLake` / `AdjacentNaturalWonder` / `AdjacentRiver` / `AdjacentNavigableRiver` | plot flag is true (navigable river ≈ `terrain == TERRAIN_NAVIGABLE_RIVER`) |
  | `AdjacentResource` / `AdjacentSeaResource` / `AdjacentResourceClass` | plot has a (matching-class) resource |
  | `AdjacentConstructible` / `AdjacentConstructibleTag` | a constructible on the plot matches the type/tag |
  | `AdjacentDistrict` / `AdjacentQuarter` / `AdjacentUniqueQuarter` / `AdjacentUniqueQuarterType` | plot's district / quarter-type matches |

- Evaluate over the **6 adjacent plots**: count matches (a predicate returns `true`→1 or a
  number), then `amount = totalCount * adjacencyDef.YieldChange`, yield = `adjacencyDef.YieldType`.
- **Flat-amount add-on**: some modifiers add a flat bump to an adjacency via
  `EFFECT_CITY_ADJUST_ADJACENCY_FLAT_AMOUNT` (args `Adjacency_YieldChange`, `Amount`,
  `Divisor`, `Tooltip`). If the player owns that modifier, add `Amount/Divisor`. (Divisor>1
  gives the fractional-per-adjacency yields — matches the `EFFECT_CITY_ADJUST_ADJACENCY_FLAT_AMOUNT`
  note in [gameeffects.md](gameeffects.md).)

## Part 3 — The plot-details model (feed for Parts 2 & 3-self)

Adjacency predicates need a normalized snapshot of each plot. Build `getRealizedPlotDetails(x,y)`
returning `{ biome, terrain, feature, resource, constructibles[], district, isLake,
isNaturalWonder, isRiver, quarterType }` from the **live map**:

- `GameplayMap.getBiomeType / getTerrainType / getFeatureType / getResourceType(x,y)` →
  index → `GameInfo.<T>.lookup(index)?.<T>Type`. Guard `NO_FEATURE` / `NO_RESOURCE`.
- Respect fog: `GameplayMap.getRevealedState(localPlayerID,x,y) != RevealedStates.HIDDEN`
  before reading — an unrevealed neighbor contributes nothing.
- **Merge in the player's own *planned* placements**, not just built constructibles: the
  plot's `constructibles` list = real constructibles ∪ valid map-tacks the player has
  dropped. This is what lets a planner preview "if I also build X next door." Compute
  `quarterType` from the merged building set.
- Cache by `"x-y"` for the duration of one evaluation pass (a full neighbor sweep re-reads
  the same plots).

Neighbors come from `GameplayMap.getAdjacentPlotLocation({x,y}, direction)` over the 6
`DirectionTypes`; keep the direction so the UI can say "+2 Gold from Coast (NE)".

## Part 4 — The modifier engine (the genuinely clever part)

Buildings also get yields from **player-owned modifiers**: a tradition that gives Libraries
+1 Science, a mastery node, a belief, a leader trait. To preview those you must answer *"is
this modifier currently active for the local player?"* **without the modifier running** —
by reconstructing it from data + live ownership queries.

**Step A — collect the relevant modifiers.** Scan `GameInfo.DynamicModifiers`, keep those
whose `CollectionType` ∈ {`COLLECTION_PLAYER_CITIES`, `COLLECTION_CITY_PLOT_YIELDS`} and
`EffectType` ∈ the effects you can preview:
`EFFECT_CITY_ACTIVATE_CONSTRUCTIBLE_ADJACENCY`, `EFFECT_CITY_ADJUST_ADJACENCY_FLAT_AMOUNT`,
`EFFECT_PLOT_ADJUST_YIELD`. (Map Tacks explicitly does **not** yet handle
`EFFECT_CITY_ADJUST_CONSTRUCTIBLE_YIELD`, `EFFECT_CITY_ACTIVATE_CONSTRUCTIBLE_WAREHOUSE_YIELD`,
`EFFECT_PLAYER_ADJUST_CONSTRUCTIBLE_YIELD` — a known preview gap; warehouse/whole-class
building yields are under-counted.) The dynamic `ModifierType` ends in `_TYPE`; strip that to
get the `modifierId`, then pull its args from `GameInfo.ModifierArguments` and its
`OwnerRequirementSetId` / `SubjectRequirementSetId` from `GameInfo.Modifiers`.

For `EFFECT_PLOT_ADJUST_YIELD`, key the modifier to a constructible by inspecting its
**subject requirement set** for a `REQUIREMENT_PLOT_HAS_CONSTRUCTIBLE` (its `ConstructibleType`
arg = which building this yield attaches to). Store `{modifierId, YieldType, Amount, Tooltip}`
per constructible.

**Step B — "does the player own this modifier?"** A modifier is attached to the player via
exactly one *source*. Resolve the source and query live ownership. Each resolver maps
`modifierId → sourceType`, then checks a player API:

| Source | Mapping table | Live ownership check |
|---|---|---|
| **Leader / Civ trait** | `GameInfo.LeaderTraits` + `GameInfo.CivilizationTraits` → the player's traits, then `GameInfo.TraitModifiers` | modifier's trait ∈ local player's leader/civ traits |
| **Tradition** (policy card) | `GameInfo.TraditionModifiers` (modifierId→TraditionType) | `player.Culture.isTraditionActive(Database.makeHash(traditionType))` |
| **Tech/Civic node** | `GameInfo.ProgressionTreeNodeUnlocks` (TargetKind `KIND_MODIFIER`/`KIND_TRADITION`/`KIND_CONSTRUCTIBLE` → node) | `Game.ProgressionTrees.getNodeState(playerId,node) == NODE_STATE_FULLY_UNLOCKED` |
| **Belief** (pantheon/religion) | `GameInfo.BeliefModifiers` (ModifierID→BeliefType); beliefs attach via `EFFECT_ATTACH_MODIFIERS`, so also follow the `ModifierArguments` "ModifierId" chain | belief ∈ `player.Religion.getPantheons() ∪ getBeliefs()` |
| **Constructible** (a building you own grants the modifier) | `GameInfo.ConstructibleModifiers` (modifierId→ConstructibleType) | player has that constructible (or it's the tack being placed) |

`isModifierActive = trait ∥ tradition ∥ tree ∥ belief ∥ constructible` **AND**
`isModifierRequirementMet` (Step C).

**Step C — evaluate the requirement sets in JS.** Re-implement the requirement check the
engine would run: for the modifier's Owner and Subject `RequirementSetId`, read
`GameInfo.RequirementSets` (`REQUIREMENTSET_TEST_ALL` → `every`, `TEST_ANY` → `some`) over
its `GameInfo.RequirementSetRequirements`, and hand-evaluate each `RequirementType` against
your plot-details + the constructible being placed. You only implement the requirement types
that matter for placement (Map Tacks handles `REQUIREMENT_WONDER_IS_ACTIVE`,
`REQUIREMENT_PLOT_FEATURE_TYPE_MATCHES`, `REQUIREMENT_PLOT_HAS_CONSTRUCTIBLE`,
`REQUIREMENT_PLOT_TERRAIN_TYPE_MATCHES`); **unknown requirement types default to `false`** (a
conservative miss). This is the fundamental trade-off of the whole approach — see below.

## What this buys you, and its limits

- **Result shape:** `{ base:[{type,amount}], bonus:[{type,amount,text}],
  adjacencies:[{type,amount,text}] }` — enough to render an itemized preview ("+2 Science
  base, +1 from Currency, +2 from 2 adjacent Mountains").
- **It is a re-implementation of engine logic, so it drifts.** Every unhandled effect, wildcard
  filter (`HasBiome`/`HasNavigableRiver` are TODO in the source), or requirement type is a
  silent under-count. Treat the number as a **strong estimate, not authoritative** — and
  re-audit after patches that touch adjacency/yield effects. For an *exact* figure of an
  already-built thing, read `player.Stats.getYields()` instead (see
  [ui-modding.md](ui-modding.md)); this engine's whole reason to exist is the *hypothetical*
  case that `getYields()` can't answer.
- **Cost:** all static tables are cached once; a placement preview is one plot-details build
  + a 6-neighbor sweep, cheap enough for hover.

## Reusing this (in a dashboard or planner)

The reusable spine is Step B/C — **"is modifier M active for the local player, derived from
data + live ownership"** — which is useful well beyond yield previews (e.g. the Bonus
dashboard deciding whether a mod bonus is live without waiting for it to fire). If you only
need your own mod's bonuses, you can shortcut: your mod knows its modifier ids, so you can check their
specific sources (tree node unlocked via `Game.ProgressionTrees.getNodeState`, tall gate via
your own settlement count) directly, instead of scanning all of `GameInfo.DynamicModifiers`.
The full scan matters only when you must preview *arbitrary* (including other mods'/base)
constructibles, as a general planner does.

## The OTHER preview engine: integrating with Leonardfactory's Policy Yields Preview

`lf-policies-yields-preview` (Steam workshop `1295660/3515801789`, repo
`github.com/rockfactory/civ7-lf-policies-yields-preview`, MIT) is a general yield-COMPUTATION
engine: it resolves a modifier's effect x live game state directly, sidestepping the engine
attribution tree entirely (so it is immune to the "per-pop yields land in the anonymous Other
bucket" problem that kills attribution-based readouts). Integration lessons (all in-game-proven
2026-07-18):

**Public API** — `globalThis.LfYieldsPreview`:
- `previewModifierByIds([modifierIds])` -> `{ yields: {YIELD_X: n}, isValid, error }` (never throws
  at the API boundary; internal resolver errors surface as `isValid:false`)
- `renderYieldsPreviewBox(result)` -> styled HTMLDivElement in his exact look
- Consumer pattern: gate every call on `if (globalThis.LfYieldsPreview)`, load your consumer
  UIScript at LoadOrder > 500 game-scope, and degrade gracefully when absent. `types/extension-api.d.ts`
  ships typings.

**Architecture that works: blind ID lists.** Feed his engine the modifier ids your generator already
knows (a tiny emitted manifest file), including ALL mutually-exclusive window/variant copies — his
engine EVALUATES your requirement sets against live state, so the wrong-window copies contribute 0
and no gating logic is needed on your side. Values are int-rounded (preview-grade, not ledger-exact).

**THE ORDER LAW (generic consumer-interop lesson):** his requirement evaluation is a JS `.every()`
over `REQUIREMENTSET_TEST_ALL` — it SHORT-CIRCUITS, and an *unhandled RequirementType throws*,
killing the whole preview batch for that card. So when authoring requirement sets that third-party
resolvers will read: **put cheap, universally-handled requirements FIRST and exotic/unpreviewable
ones LAST**. A set that fails early on a count requirement never reaches the throwing one; the same
set with the exotic requirement first is dead in every state.

**Known resolver gaps + upstream fixes filed:** `REQUIREMENT_PLOT_HAS_CONSTRUCTIBLE` lacked
`ConstructibleClass` (PR #17) and `REQUIREMENT_TRIUMPHS_COMPLETED` / `REQUIREMENT_PLAYER_HAS_ACTIVE_TRADITION`
had no handlers (PR #18 — implemented with `player.Legacies.isTriggered` + `isTraditionActive`,
see legacies-triumphs-dedications.md). Pattern for contributing: his `requirement.js` is one big
switch keyed on RequirementType; handlers document observed base-XML argument variants and THROW on
unhandled shapes.

**Patch-test technique for upstream PRs:** UI scripts load at app launch and need no new game — so
you can verify a fix against a real save by copying the edited script OVER the installed workshop
copy (back up the original first), relaunching, and probing via the console
(`JSON.stringify(globalThis.LfYieldsPreview.previewModifierByIds(["SOME_ID"]))`). Steam "verify
integrity" or any Workshop update restores the original.
