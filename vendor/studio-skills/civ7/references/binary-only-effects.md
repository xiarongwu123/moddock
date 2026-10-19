# Binary-only effects (in the engine, used by NO data file)

Extracted 2026-07-03 from `Civ7_Win64_DX12_FinalRelease.exe` (1.4.1 build 1267347) by ASCII-string
scan for `EFFECT_[A-Z0-9_]+`, then diffed against every EFFECT_ token in Base/modules + DLC
XML/SQL. **These are strings, not verified handlers** - each may be functional cut content, a
dormant feature, or a dead symbol. Test via tracer litmus before relying on one — the pattern:
a tiny UpdateDatabase-only mod defining one modifier per suspect effect, each with a DISTINCT
visible in-game signature (border change, resource appearing, yield tooltip), attach-wrapped
CONTINUOUS to all major players (run-once-at-attach fires before plots/cities exist and never
re-fires), then read results off the visuals in a new game. Arg names are unguessable
(no data examples exist); read GameEffects/Database logs for rejection hints and iterate.

Caveat: the binary scan found FEWER tokens (661) than data uses (763), so plain-string extraction
is incomplete - absence from this list proves nothing, and more hidden effects may exist.

Regenerate after each patch: re-run the scan (method in the "Scan method" section below) -
patches may wire these up or add new ones.

## High-interest for tall/ring-4-5 work (probe round 1 results, 2026-07-03)

- **EFFECT_PLOTS_IN_RANGE_ADJUST_YIELD — ✅ LIVE, VERIFIED IN-GAME.** Args `YieldType`/`Amount`/`Range`
  (guessed, accepted). From `COLLECTION_PLAYER_CITIES` it painted the yield onto ALL tiles in range
  including UNOWNED ring-4/5 tiles (no ownership guard). Note: painted != collected — unworked tiles
  still pay nothing; it's an amplifier for later claimed/worked tiles.
- EFFECT_GRANT_PLOT — **❌❌ DEAD & CLOSED (probe v3, 2026-07-04): no-op in ALL FIVE contexts,
  including the Civ 6-native UNIT-scoped shape.** v2 killed four: plot collection
  (unowned+adjacent subject reqs), COLLECTION_PLAYER_CITIES + Amount, COLLECTION_OWNER + Amount
  (player-attached), COLLECTION_NARRATIVE_STORY at a proven-anchored story plot. v3 killed the
  last: COLLECTION_OWNER attached to a UNIT via UnitAbilityModifiers (Civ 6's Cyp W&T contract —
  "grant the plot the owning unit stands on", their dummy-GP birth modifier). Tested in-game:
  run-once-at-creation (story-spawned Scout ON an unowned dist-4/5 tile, capital existing,
  silver co-reward fired, FireTuner getOwner stayed -1) AND continuous ± Amount (all scouts,
  player + AI, whole session, zero flips). Do NOT re-probe except after a patch; this was the
  final plausible context.
- EFFECT_GRANT_FREE_CONSTRUCTIBLE_ALL_VALID_PLOTS — ❌ no-op with `ConstructibleType` AND
  `ConstructibleClass` args from COLLECTION_PLAYER_CITIES. Treat as dormant.
- EFFECT_ADJUST_PLAYER_CITY_TILES — ❌ no-op player- and city-scoped with Amount; expand picker
  unchanged (still hard ring-3). (Founding-tile-count variant not exhaustively checked.)
- **✅ BONUS PROVEN (probe v2): disband-anchored narrative delivery** — REQUISITE story completed by
  `GOSSIP_DISBANDED_UNIT` (UnitType-filtered, AfterInit) fired at the DISBAND TILE and its
  COLLECTION_NARRATIVE_STORY reward placed a resource exactly there (unowned, player-chosen).
  Base disband story ("It's Not Goodbye") coexists — filter UnitType to a dedicated unit for ship.
- EFFECT_ADJUST_PLOT_PURCHASE_COST — implies a dormant tile-purchase system; untested.

The engine logs NOTHING for unknown/no-op effect configs (all five tracers loaded silently, only
one provably ran) — logs cannot distinguish dead handler from wrong args; only visible tracers can.

**Binary-only COLLECTIONS also scanned (68 total, 22 unused): no hidden plot-scoped collections
exist** — the data-used plot collections are the complete set. The unused ones are team/army/diplo
scoped (COLLECTION_TEAM_*, COLLECTION_PLAYER_ARMIES, COLLECTION_MINOR_PLAYERS,
COLLECTION_COUNT_EQUALS/GREATERTHAN, COLLECTION_OWNER_DISTANT_LANDS_CITY_*, …).

## REQUIREMENT_ diff (done 2026-07-04, same 1.4.1 build): 490 binary / 319 data-used / 173 binary-only

Headliners among the 173 never-used-in-data requirement tokens (strings, not verified handlers):

- **REQUIREMENT_PLOT_PROPERTY_MATCHES** — the EXACT requirement type Civ 6's Cyp Wide-and-Tall
  uses for its plot-property→modifier yield bridge. Present in the Civ 7 binary, used by NO data.
  ⚠ No plot-property SETTER exists at the data level (no EFFECT_PLOT_PROPERTY token; only
  player/unit setters are live — see property-system note below), so even if the handler is alive
  it can only read properties the ENGINE sets on plots (unknown if any exist). Probe order:
  first find any natively-set plot property, else pair-test with narrative-story rewards.
- REQUIREMENT_COLLECTION_COUNT_EQUALS / _GREATERTHAN — generic collection-cardinality gates.
- REQUIREMENT_UNIT_HAS_X_CHARGES, REQUIREMENT_UNIT_ADJACENT_TO_OWNER_TERRITORY,
  REQUIREMENT_PLOT_UNIT_TYPE_MATCHES, REQUIREMENT_PLOT_ADJACENT_FRIENDLY_UNIT_TYPE_MATCHES —
  unit/plot conjunctions useful for unit-delivered mechanics if live.
- REQUIREMENT_PLOT_HAS_YIELD, REQUIREMENT_PLOT_HAS_ANY_IMPROVEMENT, REQUIREMENT_PLOT_HAS_EFFECT,
  REQUIREMENT_PLOT_IS_HILLS/FRESH_WATER/ANY_CAPITAL — plot-state gates absent from data.
- Full 173 list: regenerate via the scan below (kept out of this file for size; the interesting
  subset is above).

**Civ 7 property system (grounded 2026-07-04):** data-live setters = `EFFECT_PLAYER_PROPERTY` and
`EFFECT_UNIT_PROPERTY` (args `Key`/`Value`/`Operation` = SET|CHANGE; base: Commanderies
UpgradeDiscount, Future-Tech NextAgeTechBoost). Data-live reader = 
`EFFECT_PLAYER_ADJUST_YIELD_PER_PROPERTY_VALUE` (args `PropertyName`/`YieldType`/`Multiplier`;
base: age-transition legacy cards, e.g. +2 gold per PROPERTY_ANTIQUITY_TRADE_ROUTE_TOTAL).
Binary-only, unprobed: `EFFECT_CITY_PROPERTY`, `EFFECT_GAME_PROPERTY`. Gameplay-isolate JS also
has `unit.setProperty`/`player.getProperty`/`city.getProperty` (walled to mods). Together the live
pieces = a data-only accumulator substrate: run-once/triggered property CHANGEs feeding a
continuous yield-per-property modifier.

**Scan method (fast, replaces the slow PowerShell byte loop):** copy the exe out of Program Files
(sandbox blocks rg there), then
`rg -a -o 'EFFECT_[A-Z0-9_]{4,}' civ7.exe.bin | sort -u` (same for REQUIREMENT_/COLLECTION_),
diff against `grep -rhoE ... Base/modules DLC --include=*.xml --include=*.sql | sort -u` via
`comm -23`. Delete the exe copy after.

## Full list (195 effects)
- EFFECT_ADD_COMMANDER_WITH_UNITS_TO_PLAYER_CITY
- EFFECT_ADD_PLAYER_BELIEF_YIELD
- EFFECT_ADD_RELIGIOUS_BUILDING
- EFFECT_ADD_RELIGIOUS_BUILDING_MULTIPLIER
- EFFECT_ADD_RELIGIOUS_UNIT
- EFFECT_ADJUST_BUILDING_SPREAD_CHARGES
- EFFECT_ADJUST_CITIES_HAS_URBAN_DEFENSES
- EFFECT_ADJUST_CITY_RELIGION_EXTRA_PROMOTIONS
- EFFECT_ADJUST_CITY_RELIGION_ON_CAPTURE
- EFFECT_ADJUST_CITY_UNIT_MAX_LEVEL
- EFFECT_ADJUST_DISTRICT_BASE_YIELD_CHANGE
- EFFECT_ADJUST_DISTRICT_YIELD_CHANGE
- EFFECT_ADJUST_DISTRICT_YIELD_MODIFIER
- EFFECT_ADJUST_GAINS_ALL_FOLLOWER_BELIEFS
- EFFECT_ADJUST_GREAT_PEOPLE_POINTS_PER_KILL
- EFFECT_ADJUST_GREAT_PERSON_GUARANTEE
- EFFECT_ADJUST_GREAT_PERSON_PATRONAGE_DISCOUNT_PERCENT
- EFFECT_ADJUST_GREAT_PERSON_POINTS
- EFFECT_ADJUST_GREAT_PERSON_POINTS_PERCENT
- EFFECT_ADJUST_GREAT_PERSON_POINTS_REFUND_PERCENT
- EFFECT_ADJUST_HEAL_CHARGES
- EFFECT_ADJUST_MULTIPLY_TREASURY
- EFFECT_ADJUST_PLAYER_CITY_TILES
- EFFECT_ADJUST_PLAYER_DISTRICT_AIR_SLOTS
- EFFECT_ADJUST_PLAYER_ENFORCE_BORDERS
- EFFECT_ADJUST_PLAYER_FREE_CIVIC_ON_CITY_STATE
- EFFECT_ADJUST_PLAYER_FREE_GREAT_PERSON_POINTS
- EFFECT_ADJUST_PLAYER_FREE_GREAT_WORK_ON_CITY_STATE
- EFFECT_ADJUST_PLAYER_FREE_TECH_ON_CITY_STATE
- EFFECT_ADJUST_PLAYER_JOINTWAR_PLUNDER
- EFFECT_ADJUST_PLAYER_LEVY_DISCOUNT_PERCENT
- EFFECT_ADJUST_PLAYER_NEW_CONTINENT_GREAT_WORK
- EFFECT_ADJUST_PLAYER_NO_OCCUPATION_PENALTIES
- EFFECT_ADJUST_PLAYER_OPEN_BORDERS_FROM_INFLUENCE
- EFFECT_ADJUST_PLAYER_OR_CITY_ALL_PURCHASE_EFFICIENCY
- EFFECT_ADJUST_PLAYER_RELIC_FOR_GOLDEN_AGE
- EFFECT_ADJUST_PLAYER_RELIC_FOR_PROGRESSION_TREE_MASTERY
- EFFECT_ADJUST_PLAYER_RELIC_FOR_RESOURCE
- EFFECT_ADJUST_PLAYER_SPY_BONUS
- EFFECT_ADJUST_PLAYER_STEAL_TECH_BOOSTS
- EFFECT_ADJUST_PLAYER_UNIT_DISTRICT_PERCENT
- EFFECT_ADJUST_PLAYER_UNIT_WONDER_PERCENT
- EFFECT_ADJUST_PLAYER_YIELD_MODIFIER_PER_EARNED_GREAT_PERSON
- EFFECT_ADJUST_PLOT_PURCHASE_COST
- EFFECT_ADJUST_RELIGIOUS_COMBAT_LOSS
- EFFECT_ADJUST_RELIGIOUS_SPREAD_DISTANCE
- EFFECT_ADJUST_RELIGIOUS_SPREAD_STRENGTH
- EFFECT_ADJUST_UNIT_AREA_DAMAGE
- EFFECT_ADJUST_UNIT_BOOST_ALL_SPIES
- EFFECT_ADJUST_UNIT_BUILD_CHARGES
- EFFECT_ADJUST_UNIT_BYPASS_COMBAT_UNIT
- EFFECT_ADJUST_UNIT_BYPASS_WALLS
- EFFECT_ADJUST_UNIT_CANNOT_ATTACK
- EFFECT_ADJUST_UNIT_CAPITAL_RESOURCES_COMBAT_MODIFIER
- EFFECT_ADJUST_UNIT_CLEAR_TERRAIN_START_MOVEMENT
- EFFECT_ADJUST_UNIT_CONVERTS_BARBARIANS
- EFFECT_ADJUST_UNIT_ENABLE_WALL_ATTACK
- EFFECT_ADJUST_UNIT_ENABLE_WALL_ATTACK_WHOLE_GAME_SAME_RELIGION
- EFFECT_ADJUST_UNIT_ESCAPE_BOOST
- EFFECT_ADJUST_UNIT_EVICT_PERCENT
- EFFECT_ADJUST_UNIT_EXERT_ZOC
- EFFECT_ADJUST_UNIT_FORCE_RETREAT
- EFFECT_ADJUST_UNIT_FOREIGN_SPREAD_MODIFIER
- EFFECT_ADJUST_UNIT_FRIENDLY_TERRITORY_COMBAT
- EFFECT_ADJUST_UNIT_FRIENDLY_TERRITORY_START_MOVEMENT
- EFFECT_ADJUST_UNIT_GREAT_PERSON_CHARGES
- EFFECT_ADJUST_UNIT_HOLY_CITIES_COMBAT_MODIFIER
- EFFECT_ADJUST_UNIT_IGNORE_RESOURCE_MAINTENANCE
- EFFECT_ADJUST_UNIT_LAND_VICTORY_SPREAD
- EFFECT_ADJUST_UNIT_NATURAL_WONDER_DEFERRED_CHARGES
- EFFECT_ADJUST_UNIT_NO_FOREIGN_SPREAD
- EFFECT_ADJUST_UNIT_NO_RECIPROCAL_DAMAGE
- EFFECT_ADJUST_UNIT_OWNER
- EFFECT_ADJUST_UNIT_RAIDING
- EFFECT_ADJUST_UNIT_RELIC_UPON_DEATH
- EFFECT_ADJUST_UNIT_SPY_ESTABLISH_TIME
- EFFECT_ADJUST_UNIT_SPY_OPERATION_CHANCE
- EFFECT_ADJUST_UNIT_SPY_OPERATION_TIME
- EFFECT_ADJUST_UNIT_STRENGTH_PER_ENEMY_IN_COMMAND_RADIUS
- EFFECT_ADJUST_UNIT_STRENGTH_REDUCTION_FOR_DAMAGE_MODIFIER
- EFFECT_ADJUST_UNIT_URBAN_POPULATION_COMBAT_MODIFIER
- EFFECT_ADJUST_UNIT_WAR_SUPPORT_COMBAT_STRENGTH
- EFFECT_ADJUST_UNIT_WMD_PROTECTION
- EFFECT_ADJUST_VALID_FEATURES_WONDERS
- EFFECT_ADJUST_WAR_WEARINESS_YIELD_PENALTY
- EFFECT_ADJUST_WONDER_YIELD_CHANGE
- EFFECT_ADJUST_YIELD_PER_ACTIVE_ENVOY
- EFFECT_ADJUST_YIELD_PER_ENVOY
- EFFECT_ADOPT_ALLY_FOUNDED_RELIGIONS
- EFFECT_ARMY_ADJUST_ATTRITION_DAMAGE
- EFFECT_CITY_ADJUST_BUILD_QUEUE
- EFFECT_CITY_ADJUST_CIVILIAN_UNIT_FOOD
- EFFECT_CITY_ADJUST_CONSTRUCTIBLE_ADJACENCY
- EFFECT_CITY_ADJUST_FREE_CONSTRUCTIBLE_TIER
- EFFECT_CITY_ADJUST_HIT_POINTS
- EFFECT_CITY_ADJUST_LOCAL_UNHAPPINESS
- EFFECT_CITY_ADJUST_PURCHASE_EFFICIENCY_PER_RESOURCE
- EFFECT_CITY_ADJUST_RESOURCE_CAP_PER_RESOURCE
- EFFECT_CITY_ADJUST_RESOURCE_CAP_PER_TOWN
- EFFECT_CITY_ADJUST_TOWN_UPGRADE_COST_MULTIPLIER
- EFFECT_CITY_ADJUST_TRADE_ROUTE_RANGE_PER_RESOURCE
- EFFECT_CITY_ADJUST_TRADE_YIELD_PER_RESOURCE
- EFFECT_CITY_ADJUST_TREASURE_PREREQ
- EFFECT_CITY_ADJUST_UNIT_MOVEMENT_CLASS_PRODUCTION
- EFFECT_CITY_ADJUST_WORKER_MAINTENANCE_EFFICIENCY_PER_RESOURCE
- EFFECT_CITY_ADJUST_WORKER_YIELD_PER_ATTRIBUTE
- EFFECT_CITY_ADJUST_WORKER_YIELD_PER_WORKER_ON_TILE
- EFFECT_CITY_ADJUST_YIELD_PER_COMMANDER_APPLIED_PROMOTIONS
- EFFECT_CITY_ADJUST_YIELD_PER_DISTRICT
- EFFECT_CITY_ADJUST_YIELD_PER_NUM_CAPTURED_CITIES
- EFFECT_CITY_MAKE_OWNER_RELIGION
- EFFECT_CITY_PROPERTY
- EFFECT_CITY_SPAWN_TRIBE_ARMY
- EFFECT_CITY_SPAWN_TRIBE_NEAR
- EFFECT_DAE_REVEAL_PLAYER_CAPITAL
- EFFECT_DIPLO_ACTION_ADJUST_SUPPORT_OF_OWNER
- EFFECT_DIPLOMACY_ADJUST_DIPLOMATIC_ACTION_TOKEN_BONUS_PER_PLAYER_RELATIONSHIP
- EFFECT_DIPLOMACY_ADJUST_INFLUENCE_FROM_GRIEVANCES
- EFFECT_DIPLOMACY_ADJUST_UNIT_PRODUCTION_PER_PLAYER_RELATIONSHIP
- EFFECT_DIPLOMACY_BROKEN_PROMISE
- EFFECT_DIPLOMACY_FORCE_INCURSION
- EFFECT_DIPLOMACY_KEPT_PROMISE
- EFFECT_DIPLOMACY_NO_PROMISE
- EFFECT_DIPLOMACY_ONE_SIDED_TRADES
- EFFECT_DIPLOMACY_RANDOM
- EFFECT_DIPLOMACY_SIMPLE_EFFECT
- EFFECT_DIPLOMACY_THIRD_PARTY_EFFECTS
- EFFECT_DISTRICT_ADJUST_MAX_SUPPLIES
- EFFECT_DISTRICT_GRANT_SUPPLIES
- EFFECT_ENABLE_RELIGION_AUTO_SPREAD
- EFFECT_ENABLE_RELIGION_AWARDS_ENVOY
- EFFECT_EXPLORE_ENTIRE_MAP
- EFFECT_FOUND_RELIGION
- EFFECT_GAME_PROPERTY
- EFFECT_GRANT_AIR_SLOTS
- EFFECT_GRANT_BUILDING_IN_CITY
- EFFECT_GRANT_BUILDING_IN_CITY_IGNORE
- EFFECT_GRANT_CITY_OWNER_INFLUENCE_TOKEN_WONDER
- EFFECT_GRANT_CITY_ROAD_TO_CAPITAL
- EFFECT_GRANT_FREE_CONSTRUCTIBLE_ALL_VALID_PLOTS
- EFFECT_GRANT_GREAT_PERSON_CLASS_IN_CITY
- EFFECT_GRANT_PLAYER_RELIGIOUS_PRESSURE_GREAT_PERSON_ACTIVATED
- EFFECT_GRANT_PLAYER_YIELD_PERCENT_UNIT_COST
- EFFECT_GRANT_PLOT
- EFFECT_GRANT_SPY
- EFFECT_GRANT_STRENGTH_PER_ADJACENT_UNIT_TYPE
- EFFECT_GRANT_SUPPORT_RESPONSE_BONUS
- EFFECT_GRANT_UNIT_YIELD_ADJACENT_FEATURES
- EFFECT_GRANT_UNIT_YIELD_ADJACENT_TERRAINS
- EFFECT_GRANT_YIELD_BASED_ON_CURRENT_YIELD_RATE
- EFFECT_GRANT_YIELD_PER_ENVOY
- EFFECT_GRANT_YIELD_PER_GREAT_WORK_IN_CITY
- EFFECT_GRANT_YIELD_PER_RESOURCES_IN_CITY
- EFFECT_MAP_REMOVE_CLIFFS_IN_DIRECTION
- EFFECT_PLAYER_ADD_YIELD_DEBT
- EFFECT_PLAYER_ADD_YIELD_DEBT_DISCOVERY
- EFFECT_PLAYER_ADJUST_CONSTRUCTIBLE_ADJACENCY
- EFFECT_PLAYER_ADJUST_FREE_CONSTRUCTIBLE_TIER
- EFFECT_PLAYER_ADJUST_GOLDEN_AGE_THRESHOLD
- EFFECT_PLAYER_ADJUST_LEGACY_PATH_CITY_STATE_SCORING
- EFFECT_PLAYER_ADJUST_LEGACY_PATH_NATURAL_WONDER_SCORING
- EFFECT_PLAYER_ADJUST_LEGACY_PATH_UNIT_TELEPORT_SCORING
- EFFECT_PLAYER_ADJUST_TREASURE_FLEET_BONUS_POINTS
- EFFECT_PLAYER_ADJUST_UNIT_NAVAL_GOLD_SIPHONED_PERCENT
- EFFECT_PLAYER_ADJUST_UNIT_PRODUCTION_PER_OTHER_UNIT_TYPE
- EFFECT_PLAYER_ADJUST_UNIT_UPGRADE_DISCOUNT
- EFFECT_PLAYER_ADJUST_YIELD_PER_ATTRIBUTE
- EFFECT_PLAYER_ADJUST_YIELD_PER_ATTRIBUTE_LEVEL
- EFFECT_PLAYER_ADJUST_YIELD_PER_NUM_CITIES
- EFFECT_PLAYER_ADJUST_YIELDS_PER_SETTLEMENT_OVER_CAP
- EFFECT_PLAYER_ARMY_CAP
- EFFECT_PLAYER_ATTRIBUTE_UPGRADE
- EFFECT_PLAYER_CHANGE_CELEBRATION_CULTURE_SLOT
- EFFECT_PLAYER_DIPLOMACY_ACTION_PROGRESS_MOD
- EFFECT_PLAYER_DIPLOMACY_ADJUST_THIRD_PARTY_SUPPORT_MAX
- EFFECT_PLAYER_DIPLOMACY_CHANGE_DISPERSE_INDEPENDENT_MODIFIER
- EFFECT_PLAYER_DIPLOMACY_EXTRA_LEVY_UNITS
- EFFECT_PLAYER_GOVERNOR_CAP
- EFFECT_PLAYER_GRANT_ATTRIBUTE_TREE_NODE
- EFFECT_PLAYER_GRANT_GIFT
- EFFECT_PLAYER_GRANT_UNASSIGNED_WORKERS
- EFFECT_PLAYER_NO_TREASURE_FLEETS_FROM_RESOURCES
- EFFECT_PLAYER_NULLIFY_OTHERS_TRADE_YIELD
- EFFECT_PLAYER_SAME_GOVERNMENT_GRANT_FAVORS_GRIEVANCES
- EFFECT_PLOT_ADJUST_YIELD_RANDOM
- EFFECT_PLOTS_IN_RANGE_ADJUST_YIELD
- EFFECT_RETURN_UNIT_HOME_CITY
- EFFECT_TIMEOUT_UNIT_OFF_MAP
- EFFECT_TREAT_CAPITAL_AS_HOLY_CITY
- EFFECT_TRIGGER_GAME_MECHANIC
- EFFECT_UNIT_ADJUST_CAPTURE_FULL_MOVEMENT
- EFFECT_UNIT_ADJUST_SIPHON_AMOUNT
- EFFECT_UNIT_SET_ATTACK_AFTER_MOVE
- EFFECT_USED
- EFFECT_VISIBILITY_CHANGED

## Gen-2 data-effect probe results (2026-07-05, `gen2-litmus` / `gen2-cityprop-litmus`)

- **`EFFECT_CITY_PROPERTY` — ❌ INERT FROM DATA (probed, in-game).** 0 shipped data uses; the token
  **FK-validates and the mod applies with no error/rollback**, but it **silently writes nothing** —
  after a `COLLECTION_PLAYER_CITIES` setter (`Key`/`Value`/`Operation=SET`, args cloned from
  `EFFECT_PLAYER_PROPERTY`), `Players.get(0).Cities.getCapital().getProperty("<Key>")` read `null`.
  So **per-city / per-metropolis property accumulators are not data-moddable on 1.4.1** — use
  player-scoped properties (contrast below).
- **`EFFECT_PLAYER_PROPERTY` — ✅ WORKS + JS-READABLE.** `Key`/`Value`/`Operation` (both `SET` and
  base's `CHANGE`); the value reads back in-game via `Players.get(pid).getProperty("<Key>")` (unset
  keys → `null`). Good for dashboard accumulator meters + milestone-gating requirements. ⚠ its arbitrary
  `Key` is **NOT** read by `EFFECT_PLAYER_ADJUST_YIELD_PER_PROPERTY_VALUE` (engine-totals only) — no
  data-only "+N yield per counter point". See narrative-events.md "Quests & data-driven progression".
- **`EFFECT_PLAYER_ADJUST_SETTLEMENT_CAP` negative leg — ✅ WORKS.** `Amount="-2"` (`COLLECTION_OWNER`,
  attach-wrapped) **lowers** the cap cleanly — base start cap 3 read **1/1** on founding (no clamp-at-0,
  not ignored). So a mod can drive the cap DOWN and hand it back with additive `+1` grants (earned-
  expansion / charter designs). (`Minimum` arg untested — not needed for the subtract.)
- **Injecting a node into an existing progression tree — ✅ functional / ⚠ no tree-graph render.**
  A custom `ProgressionTreeNodes` + `ProgressionTreePrereqs` + `ProgressionTreeNodeUnlocks` row set
  injected into `TREE_CIVICS_AQ_MAIN` **FK-validates, applies, is prereq-gated correctly, and is
  researchable** — it appears in the **Choose Civic study picker** (with cost + unlock icon) once its
  prereq completes, and its `KIND_MODIFIER` unlock (an `EFFECT_PLAYER_ATTRIBUTE` grant) is wired to fire.
  **BUT it does NOT draw as a box in the tree-GRAPH screen** (the graph needs layout coordinates an
  injected node lacks; the picker LIST enumerates available nodes regardless). Also: the node's `Cost`
  must be **≥ its prereq's cost** or it won't even appear in the picker (Cost 90 < Mysticism 125 =
  invisible; Cost 200 = visible). So injected nodes are a viable *mechanic* but a clean researchable
  *tree graph* needs unsolved UI-layout work.
