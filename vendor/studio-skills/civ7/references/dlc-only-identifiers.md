# DLC-only identifiers — what `Base/modules` alone will never tell you

⛔⛔ **THE RULE: every existence check must grep `Base/modules` AND `DLC`.** The install has two trees,
and the DLC one defines **68 `EFFECT_*`, 38 `REQUIREMENT_*`, a unit command and three charged abilities
that appear NOWHERE in Base**. A Base-only sweep does not return "fewer results" — it returns a
confident, wrong *"that capability does not exist"*.

```
<install>/Base/modules/     base-standard, age-antiquity, age-exploration, age-modern
<install>/DLC/              ~50 packs (civs, leaders, wonders), EACH with its own data/
```

```bash
# existence check — the only correct shape
grep -rho 'EFFECT_[A-Z_]*' --include=*.xml Base/modules DLC | sort -u

# the DLC-ONLY set (usually the interesting one)
comm -23 <(grep -rho 'EFFECT_[A-Z_]*' --include=*.xml DLC | sort -u) \
         <(grep -rho 'EFFECT_[A-Z_]*' --include=*.xml Base/modules | sort -u)
```

**How this was found (2026-08-18).** A full sweep for *"can anything claim territory / culture-bomb?"*
ran against `Base` only and concluded nothing existed. Both of these were sitting in `DLC`:

| Missed | Pack | Why it mattered |
|---|---|---|
| `UNITCOMMAND_CLAIM_MOUNTAIN` | nepal | **A SECOND claim vector** — mountains, not just resources |
| `EFFECT_CITY_ADJUST_YIELD_PER_UNDER_SETTLEMENT_CAP` | qajar | **A native tall mechanic** — yield per settlement UNDER the cap |

⚠ **A DLC-only identifier is a DEPENDENCY.** Using one breaks the mod for players without that pack —
gate it behind action-group criteria, or design a fallback. Prefer the generated `references/*-catalog.md`
files (they already cover base+DLC) and mine raw XML only for the gap.

---

## ⭐ Standouts for a TALL / one-city mod

### `EFFECT_CITY_ADJUST_YIELD_PER_UNDER_SETTLEMENT_CAP` — the native tall reward (qajar)

```xml
<Modifier id="MOD_CIV_QAJAR_YIELDS_UNDER_SETTLEMENT_CAP_AQ"
          collection="COLLECTION_PLAYER_CAPITAL_CITY"
          effect="EFFECT_CITY_ADJUST_YIELD_PER_UNDER_SETTLEMENT_CAP">
  <Argument name="Amount">2</Argument>                          <!-- 6 in Exploration -->
  <Argument name="YieldType">YIELD_FOOD,YIELD_PRODUCTION</Argument>
</Modifier>
```

Yield to the **capital**, scaled by **how far UNDER the settlement cap you are**, tuned per Age. This is
the "stay small, get more" shape a tall mod otherwise approximates with hand-built count gates.
⚠ `YieldType` takes a **comma-separated list**.

### The rest of the settlement-cap family

| Identifier | Where | Note |
|---|---|---|
| `EFFECT_CITY_ADJUST_YIELD_PER_UNDER_SETTLEMENT_CAP` | **DLC only** | above |
| `EFFECT_ADJUST_UNIT_UNDER_SETTLEMENT_CAP_COMBAT_MODIFIER` | **DLC only** | combat strength while under cap |
| `EFFECT_ADJUST_CITY_LIMIT` | **DLC only** | ⭐ raises the CITY (not settlement) limit; `Amount` 1–2, `COLLECTION_OWNER` |
| `REQUIREMENT_PLAYER_HAS_FEWEST_SETTLEMENTS` | **DLC only** | a tall gate, already written |
| `EFFECT_PLAYER_ADJUST_SETTLEMENT_CAP` | base (22 uses) | the familiar one |
| `REQUIREMENT_PLAYER_OVER_SETTLEMENT_CAP` | base (3 uses) | the anti-wide gate |
| `EFFECT_CITY_ADJUST_WORKER_CAP` | base (11) + DLC (5) | specialist slots; Joseon gives its capital +1 |

### Density / plot-shape requirements (DLC only)

- **`REQUIREMENT_PLOT_HAS_NUM_CONSTRUCTIBLES`** — gate on **how many constructibles are on a tile**.
  Directly the currency of a density pillar (`Districts.MaxConstructibles` stacking).
- `REQUIREMENT_PLOT_HAS_X_WORKER_POPULATION` — gate on workers on a plot.
- `REQUIREMENT_PLOT_NEAR_CAPITAL`, `REQUIREMENT_PLOT_IS_ANY_CAPITAL`.
- `REQUIREMENT_PLAYER_HAS_CITY_WITH_X_WORKERS`, `REQUIREMENT_PLAYER_HAS_SETTLEMENTS_WITH_POPULATION`.
- `REQUIREMENT_PLAYER_HAS_UNIQUE_QUARTER`, `REQUIREMENT_CITY_IS_ISLAND`,
  `REQUIREMENT_CITY_IS_OWNER_CAPITAL_CONTINENT`.

### Free-building grants (DLC only)

- `EFFECT_CITY_GRANT_FREE_BUILDING` (bolivar) — `Amount`, `run-once`.
- `EFFECT_GRANT_BUILDING_IN_CITY_ADJACENT_TO_TERRAIN` (carthage) — `BuildingType` +
  `AdjacentTerrainType`; grants the building outright.

⚠ Neither places a building on a **chosen** tile — that still needs the UIScript RPC
(see the tile-swap/radius notes).

---

## ⭐ The second claim vector — `UNITCOMMAND_CLAIM_MOUNTAIN` (nepal)

> *"Activate on a Mountain Terrain **within 5 tiles** of one of your Settlement's City Centers. The
> Mountain is improved immediately with a Highland Power Station. **If the Mountain is outside your
> borders, a path of tiles is claimed back to the Settlement.**"*

That is the **documented** confirmation of the corridor behaviour the Surveyor's `CLAIM_RESOURCE` also
shows, and it proves the claim pattern is data-attachable to any unit:

```xml
<Modifier id="SHERPA_MOD_GRANT_ABILITY_CHARGE" collection="COLLECTION_OWNER"
          effect="EFFECT_GRANT_UNIT_ABILITY_CHARGE" permanent="true">
  <Argument name="ChargedAbilityType">CHARGED_ABILITY_CLAIM_MOUNTAIN</Argument>
  <Argument name="Amount">1</Argument>
</Modifier>
<!-- units.xml -->
<Row UnitAbilityType="ABILITY_CLAIM_MOUNTAIN" UnitClassType="UNIT_CLASS_SHERPA"/>
<Row UnitType="UNIT_SHERPA" CommandType="UNITCOMMAND_CLAIM_MOUNTAIN"
     ChargedUnitAbilityType="CHARGED_ABILITY_CLAIM_MOUNTAIN"/>
```

### ⭐ `ChargedUnitAbilities.ConstructibleType` — a data lever on what a claim BUILDS

```sql
CREATE TABLE 'ChargedUnitAbilities' (
  'UnitAbilityType'   TEXT NOT NULL,
  'ConstructibleType' TEXT,                     -- what the claim places
  'RechargeTurns'     INTEGER NOT NULL DEFAULT -1, ... );
```

```xml
<Row UnitAbilityType="CHARGED_ABILITY_CLAIM_MOUNTAIN" RechargeTurns="5"
     ConstructibleType="IMPROVEMENT_HIGHLAND_POWER_STATION"/>
<Row UnitAbilityType="CHARGED_ABILITY_CLAIM_RESOURCE"  RechargeTurns="5"/>   <!-- null -->
```

`CLAIM_RESOURCE` leaves it **null**; `CLAIM_MOUNTAIN` sets it. ⚠ **UNTESTED**: whether `<Update>`-ing
`ConstructibleType` onto `CHARGED_ABILITY_CLAIM_RESOURCE` makes a claim place a constructible of our
choosing. If it works, that is a data-only lever on the claim itself — worth a litmus.

⚠ Also note: a **mountain accepts an IMPROVEMENT** (Highland Power Station) even though the tutorial
says *"Tiles that contain Resources or Mountains can not be built upon."* That ban is about
**buildings**, and is narrower than it first reads.

### The rest of the unit-claim picture

`UnitCommands` carries **no range, target-type or pattern column** — only presentation plus
`RequiresAbility` / `ShowActivationPlots`. Range and what a claim grabs are engine-side. So data can
choose **who gets a claim charge** and **what it builds**, but not **how far** or **what shape**.

---

### DLC-only EFFECT_* (68)

- `EFFECT_ADD_FREE_COASTAL_RAID_TURNS`
- `EFFECT_ADD_PANTHEON`
- `EFFECT_ADD_PLAYER_UNITS_PILLAGE_BUILDING_PLUNDER`
- `EFFECT_ADD_PLAYER_UNITS_PILLAGE_IMPROVEMENT_PLUNDER`
- `EFFECT_ADJUST_CITY_LIMIT`
- `EFFECT_ADJUST_CITY_REPAIR_PURCHASE_EFFICIENCY`
- `EFFECT_ADJUST_PLAYER_ADDITIONAL_ARTIFACTS_IN_TERRITORY`
- `EFFECT_ADJUST_PLAYER_ALLIANCE_CAPITAL_ROUTES`
- `EFFECT_ADJUST_PLAYER_ALLIANCE_TRADE`
- `EFFECT_ADJUST_PLAYER_AUTO_SPREAD_COASTAL_RAID`
- `EFFECT_ADJUST_PLAYER_FORBID_CS_INCORPORATE`
- `EFFECT_ADJUST_PLAYER_RELIC_FOR_BUILDING_WONDER`
- `EFFECT_ADJUST_PLAYER_RELIC_FOR_CIVIC_TREE_MASTERY`
- `EFFECT_ADJUST_PLAYER_RETAIN_CS_INCORPORATE_UNITS`
- `EFFECT_ADJUST_PLAYER_SUZERAIN_CAPITAL_ROUTES`
- `EFFECT_ADJUST_UNIT_ACTIVE_DIPLOMACY_GROUP_COMBAT_STRENGTH`
- `EFFECT_ADJUST_UNIT_COASTAL_RAID_ONLY_DISCOVERIES`
- `EFFECT_ADJUST_UNIT_COASTAL_RAID_YIELD_MODIFIER`
- `EFFECT_ADJUST_UNIT_CONVERT_INDEPENDENT_CHARGES`
- `EFFECT_ADJUST_UNIT_NO_REDUCTION_DAMAGE`
- `EFFECT_ADJUST_UNIT_RESOURCE_DAMAGE`
- `EFFECT_ADJUST_UNIT_ROUGH_COMBAT_IGNORE_MODIFIER`
- `EFFECT_ADJUST_UNIT_UNDER_SETTLEMENT_CAP_COMBAT_MODIFIER`
- `EFFECT_ARMY_ADJUST_ALWAYS_FULL_MOVE`
- `EFFECT_CITY_ADJUST_CAN_PURCHASE_IN_UNREST`
- `EFFECT_CITY_ADJUST_GOLDEN_AGE_OF_CONSTRUCTIBLE_YIELD`
- `EFFECT_CITY_ADJUST_RANDOM_EVENT_CONSTRUCTIBLE_YIELD`
- `EFFECT_CITY_ADJUST_RAZE_RATE`
- `EFFECT_CITY_ADJUST_RESOURCE_CAP_PER_SUZERAIN`
- `EFFECT_CITY_ADJUST_UNIT_PRODUCTION_PER_GREAT_WORK`
- `EFFECT_CITY_ADJUST_YIELD_PER_CITY_STATE_TRADE_ROUTE`
- `EFFECT_CITY_ADJUST_YIELD_PER_NUM_TRADE_ROUTES`
- `EFFECT_CITY_ADJUST_YIELD_PER_UNDER_SETTLEMENT_CAP`
- `EFFECT_CITY_ADJUST_YIELD_PER_UNLOCKED_PROGRESSION_TREE_NODE`
- `EFFECT_CITY_CHANGE_TO_CAPITAL`
- `EFFECT_CITY_GRANT_FREE_BUILDING`
- `EFFECT_CITY_GRANT_YIELD_PER_POP_DEFENSE_CONSTRUCTED`
- `EFFECT_CITY_RENAME`
- `EFFECT_DAE_GRANT_YIELD_PER_RELATIONSHIP`
- `EFFECT_DECLARE_WAR`
- `EFFECT_DIPLOMACY_ADJUST_RELATIONSHIP_GAIN_FROM_FIRST_MEET_RESPONSE`
- `EFFECT_DIPLOMACY_ADJUST_YIELD_PER_SANCTIONED_PLAYER`
- `EFFECT_DIPLOMACY_AGENDA_ON_DISPERSE_IP`
- `EFFECT_DIPLOMACY_SET_NO_LIMIT_FOR_ENDEAVOR_TYPES_WITH_ALLIES`
- `EFFECT_GRANT_ALL_PLAYERS_FAVORS_GRIEVANCES`
- `EFFECT_GRANT_BUILDING_IN_CITY_ADJACENT_TO_TERRAIN`
- `EFFECT_GRANT_CITY_YIELD_BIOME`
- `EFFECT_GRANT_YIELD_FOR_GREAT_WORK`
- `EFFECT_PLAYER_ADJUST_COASTAL_RAID_ARTIFACTS`
- `EFFECT_PLAYER_ADJUST_NO_INFLUENCE_PENALTY_REVEALED_SPIES`
- `EFFECT_PLAYER_ADJUST_NO_OPPOSING_COUNTER_ESPIONAGE`
- `EFFECT_PLAYER_ADJUST_OPPONENT_DAMAGE_ATTACK_MODIFIER`
- `EFFECT_PLAYER_ADJUST_UNIT_CAPTURE_ADDITIONAL_BOOTY`
- `EFFECT_PLAYER_ADJUST_UNIT_EXTRA_COPY`
- `EFFECT_PLAYER_ADJUST_YIELD_FOR_GOLDEN_AGE_START`
- `EFFECT_PLAYER_ADJUST_YIELD_FROM_DISTATERS`
- `EFFECT_PLAYER_ADJUST_YIELD_PER_COMMANDER_LEVEL`
- `EFFECT_PLAYER_CAN_MEET_DISTANT_LAND_CIVS`
- `EFFECT_PLAYER_DESTROY_UNIT_WITH_HIGHEST_LEVEL`
- `EFFECT_PLAYER_GRANT_WONDER_APPEAL`
- `EFFECT_PLAYER_LOWER_ALL_INDEPENDENT_RELATIONSHIPS`
- `EFFECT_PLAYER_SET_ALL_INDEPENDENT_RELATIONSHIPS`
- `EFFECT_RETURN_UNIT_HOME_CITY`
- `EFFECT_STEAL_MAP`
- `EFFECT_UNIT_ADJUST_COMBAT_STRENGTH_BY_TERRAIN`
- `EFFECT_UNIT_ADJUST_DAMAGE_ATTACK_MODIFIER`
- `EFFECT_UNIT_ADJUST_NATURAL_WONDER_COMBAT_BONUS`
- `EFFECT_UNIT_ADJUST_OPERATION_AWARD`

### DLC-only REQUIREMENT_* (38)

- `REQUIREMENT_CITY_FOUNDED_WITH_X_BIOME_TILES`
- `REQUIREMENT_CITY_HAS_RESOURCE_ASSIGNED`
- `REQUIREMENT_CITY_IS_IN_TRADE_NETWORK`
- `REQUIREMENT_CITY_IS_ISLAND`
- `REQUIREMENT_CITY_IS_OWNER_CAPITAL_CONTINENT`
- `REQUIREMENT_COLLECTION_ALL_MET`
- `REQUIREMENT_PLAYER_AT_PEACE_X_TURNS_AGO`
- `REQUIREMENT_PLAYER_BEHIND_TECH`
- `REQUIREMENT_PLAYER_COMPARES_NUM_NARRATIVE_TAGS_WITH_PLAYERS`
- `REQUIREMENT_PLAYER_COMPLETED_ESPIONAGE_ACTION`
- `REQUIREMENT_PLAYER_DISCOVERED_NATURAL_WONDER_FIRST`
- `REQUIREMENT_PLAYER_HAS_ACTIVE_STORY`
- `REQUIREMENT_PLAYER_HAS_AT_LEAST_NUM_COASTAL_RAIDS`
- `REQUIREMENT_PLAYER_HAS_CITY_WITH_X_WORKERS`
- `REQUIREMENT_PLAYER_HAS_FEATURE`
- `REQUIREMENT_PLAYER_HAS_FEWEST_SETTLEMENTS`
- `REQUIREMENT_PLAYER_HAS_GREAT_WORK_ACTIVE`
- `REQUIREMENT_PLAYER_HAS_MOST_TRADE_ROUTES`
- `REQUIREMENT_PLAYER_HAS_PLUNDERED_X_TRADE_ROUTES`
- `REQUIREMENT_PLAYER_HAS_SETTLEMENTS_WITH_POPULATION`
- `REQUIREMENT_PLAYER_HAS_UNIQUE_QUARTER`
- `REQUIREMENT_PLAYER_HAS_UNIT_OF_DOMAIN_KILL_UNIT`
- `REQUIREMENT_PLAYER_HAS_X_SETTLEMENTS_WITH_RELIGION`
- `REQUIREMENT_PLAYER_RESEARCH_ARTIFACTS_IMMEDIATE`
- `REQUIREMENT_PLAYER_STARTS_TRADE_ROUTE_WITH_MATCHING_BUILDING`
- `REQUIREMENT_PLAYER_TRADES_WITH_PLAYERS_AT_WAR`
- `REQUIREMENT_PLAYER_UNIT_DESTROYS_DISTRICT_DEFENSES`
- `REQUIREMENT_PLAYER_UNIT_DESTROYS_DISTRICT_DEFENSES_TRIGGER`
- `REQUIREMENT_PLOT_ADJACENT_NUM_ENEMY_UNITS`
- `REQUIREMENT_PLOT_ADJACENT_RESOURCE_CLASS_TYPE_MATCHES`
- `REQUIREMENT_PLOT_HAS_NUM_CONSTRUCTIBLES`
- `REQUIREMENT_PLOT_HAS_X_WORKER_POPULATION`
- `REQUIREMENT_PLOT_IS_ANY_CAPITAL`
- `REQUIREMENT_PLOT_NEAR_CAPITAL`
- `REQUIREMENT_SPECIFIC_LEADER_ELIMINATED`
- `REQUIREMENT_UNIT_HAS_ABILITY`
- `REQUIREMENT_UNIT_HAS_MOVED`
- `REQUIREMENT_UNIT_TIER_MATCHES`

### DLC-only UNITCOMMAND_* (text tags omitted) (1)

- `UNITCOMMAND_CLAIM_MOUNTAIN`

### DLC-only CHARGED_ABILITY_* (3)

- `CHARGED_ABILITY_CLAIM_MOUNTAIN`
- `CHARGED_ABILITY_CONVERT_INDEPENDENT`
- `CHARGED_ABILITY_RAIDING_PARTY`
