# GameEffects: Modifiers, the attach-wrapper, collections & requirements

**A gameplay change is a Modifier.** Everything else (Traditions, Projects, tech
nodes) is just plumbing that decides *when* a Modifier reaches a player. Get the
Modifier and its delivery right and the bonus fires; get the delivery wrong and it
loads cleanly and does nothing.

## Contents
- [Anatomy of a Modifier](#anatomy-of-a-modifier)
- [Collections — whose objects the effect acts on](#collections)
- [Requirements — gating per object](#requirements)
- [Scoping by hemisphere (Homeland vs Distant Lands)](#scoping-by-hemisphere-homeland-vs-distant-lands)
- [THE attach-wrapper rule (player/city bonuses)](#the-attach-wrapper-rule)
- [Binding a Modifier to a player](#binding-a-modifier-to-a-player)

## Anatomy of a Modifier

GameEffects files use the root `<GameEffects xmlns="GameEffects">`. A Modifier names
an **effect** (what happens), a **collection** (which objects it happens to), optional
**requirements** (which of those objects qualify), and **arguments** (the effect's
parameters):

```xml
<?xml version="1.0" encoding="utf-8"?>
<GameEffects xmlns="GameEffects">
    <Modifier id="ATTACH_CULTURE_ON_CULTURE_BUILDINGS"
              collection="COLLECTION_PLAYER_CITIES"
              effect="EFFECT_CITY_ADJUST_CONSTRUCTIBLE_YIELD">
        <SubjectRequirements>
            <Requirement type="REQUIREMENT_PLAYER_ELIGIBLE_CS_BONUS">
                <Argument name="CityStateBonus">CITY_STATE_BONUS_ANTIQUITY_7</Argument>
            </Requirement>
        </SubjectRequirements>
        <Argument name="Tag">CULTURE</Argument>
        <Argument name="YieldType">YIELD_CULTURE</Argument>
        <Argument name="Amount">2</Argument>
    </Modifier>
</GameEffects>
```

(Verbatim from base `age-antiquity/data/independents-gameeffects.xml`.)

- **`effect`** and the **`<Argument name="...">`** it expects are **not guessable** —
  e.g. `EFFECT_ADJUST_CITY_IGNORE_UNHAPPINESS_EFFECT` takes `UnhappinessEffect`, not
  `Amount`. Always copy the effect + its exact argument names from a real base-game
  usage. See [finding-base-game-patterns.md](finding-base-game-patterns.md).
- **`<SubjectRequirements>`** gate the *subject* objects (the things in the
  collection). **`<OwnerRequirements>`** gate the *owner* (usually the player).
- Argument values can be **comma-separated lists** where the engine expects multiple
  (e.g. `YieldType="YIELD_FOOD, YIELD_HAPPINESS"`, or a multi-id `ModifierId`). This
  is a valid base-game pattern, not a hack.

## Collections

The `collection` decides what the effect iterates over. Common ones:

| Collection | Acts on |
|------------|---------|
| `COLLECTION_PLAYER_CITIES` | every city the owning player has |
| `COLLECTION_PLAYER_CAPITAL_CITY` | just the capital |
| `COLLECTION_ALL_CITIES` | every city in the game |
| `COLLECTION_OWNER` | the owner itself (e.g. the player) |
| `COLLECTION_MAJOR_PLAYERS` | every major (non city-state) player — used by the wrapper |
| `COLLECTION_PLAYER_CONSTRUCTIBLES` | the player's constructibles (buildings/improvements) |
| `COLLECTION_PLAYER_DISTRICTS` | the player's districts (e.g. `EFFECT_DISTRICT_ADJUST_TOTAL_HEALTH`) |
| `COLLECTION_PLAYER_UNITS` | the player's units (e.g. `EFFECT_UNIT_ADJUST_HEAL_PER_TURN`) |
| `COLLECTION_PLAYER_COMBAT` | the player's units in combat (e.g. `EFFECT_ADJUST_UNIT_STRENGTH_MODIFIER`) |
| `COLLECTION_PLAYER_PLOT_YIELDS` | the player's worked plots (e.g. `EFFECT_PLOT_ADJUST_YIELD`) |

The catch: a collection needs an **owner context** to resolve. A modifier bound at the
*game* level has no "the player," so a `COLLECTION_PLAYER_*` modifier bound there has
nothing to iterate — see the attach-wrapper rule below.

> **Picking the right collection for attach-wrapper delivery.** We deliver every bonus by attaching it
> to the **player** (the `COLLECTION_MAJOR_PLAYERS` wrapper), so each modifier must use the **player-rooted**
> collection for what it touches — NOT the city/unit/plot-context variant the base game uses when it attaches
> from a *city/unit* (e.g. a town project or a unit ability). Using the context-bound variant silently no-ops
> (no unit/city/plot to resolve against). Confirmed working through the wrapper: districts → `COLLECTION_PLAYER_
> DISTRICTS`, units → `COLLECTION_PLAYER_UNITS`, combat strength → `COLLECTION_PLAYER_COMBAT` (NOT
> `COLLECTION_UNIT_COMBAT`), plot yields → `COLLECTION_PLAYER_PLOT_YIELDS` (NOT `COLLECTION_CITY_PLOT_YIELDS`),
> warehouse yields → `COLLECTION_PLAYER_CITIES` + `EFFECT_CITY_GRANT_WAREHOUSE_YIELD`, per-building yields →
> `COLLECTION_OWNER` + `EFFECT_PLAYER_ADJUST_CONSTRUCTIBLE_YIELD` (arg `ConstructibleClass=BUILDING/WONDER` or a
> `ConstructibleType`). When in doubt, grep the base game for the effect and prefer the `COLLECTION_PLAYER_*`/
> `COLLECTION_OWNER` usage (often a tradition/trait) over a project/ability usage.

## Requirements

Requirements filter the collection per object. Like effects, **requirement types and
their argument names are not guessable** — grep a real usage.

### Rules learned in play — every one of these fails SILENTLY

> **⛔ THE OR-SET SIZE CAP.** The installed game ships **38 `REQUIREMENTSET_TEST_ANY` blocks and the
> largest holds FOUR requirements** (re-count before exceeding it; DLC may move the number). A 53-row
> OR-set fired nothing through **two** different shapes — first a named set reached by
> `REQUIREMENT_REQUIREMENTSET_IS_MET`, then the same rows inline under
> `<SubjectRequirements type="REQUIREMENTSET_TEST_ANY">`. No log line, no error; the marker stayed 0
> while a FireTuner probe showed the condition plainly true.
> The attribute itself is fine — the base game sets `type=` on an inline requirements block 30 times
> (22 `TEST_ANY` on `SubjectRequirements`, 8 `TEST_ALL`). **Size is the fault, not shape.**
> **What to do instead:** one modifier per alternative, every one writing the SAME property key.
> `run-once` means the key is set once so they cannot double-pay — *provided a player can only ever
> satisfy one*. Where two alternatives ARE simultaneously reachable, keep those two together in one
> modifier's 2-row `TEST_ANY`. Split 53 into 47 markers that way and it fired first try (2026-08-08).

> **⚠ A REQUIREMENT WITH ONE SHIPPED USE IS UNPROVEN — and that one use tells you what it is FOR.**
> Rarity alone is not the danger; rarity plus a *misread purpose* is. Two silent never-fires in one
> day traced to it:
> - `REQUIREMENT_PLAYER_AT_PEACE_X_TURNS_AGO` (1 use) reads like "you have held peace for X turns".
>   Its single use pairs it with `GOSSIP_MAKE_DOW01` — it is a **betrayal check** ("you had peace ten
>   turns ago *and have since declared war*"), so a player who never went to war may never satisfy it.
>   Three attempts were lost before anyone read the neighbouring rows. Replaced with
>   `REQUIREMENT_GAME_TURN_IS_X_NARRATIVE` (102 uses), which fired immediately.
> - `GOSSIP_UNIT_PROMOTION01` (1 use) — a commendation deed built on it never fired.
>
> Before building on a low-count identifier, **open its shipped use and read the requirements around
> it.** The neighbours are the documentation. Usage counts are in the generated catalog.

> **⚠ A COUNT REQUIREMENT THAT NAMES ONE TYPE DOES NOT SUM ACROSS TWO.**
> `REQUIREMENT_PLAYER_HAS_X_TOWNS_PRODUCING_PROJECT` names a single `ProjectType` — all four shipped
> uses do. Two markers asking for "5 Farming **or** 5 Fishing Towns" give **max(), never the total**:
> an empire holding 2 of each reads 2. To count a UNION, count the objects instead —
> `REQUIREMENT_COLLECTION_COUNT_ATLEAST` over `COLLECTION_PLAYER_CITIES` against a `TEST_ANY` set of
> `REQUIREMENT_CITY_HAS_PROJECT` rows (base-proven on `PROJECT_TOWN_GRANARY`/`PROJECT_TOWN_FISHING`).
> Bonus: a town with **no** focus matches neither branch, so it cannot be miscounted.

> **⚠ SOME REQUIREMENTS ONLY HONOUR A NUMBER THE BASE GAME PASSES.**
> `REQUIREMENT_PLAYER_PLOTS_REVEALED_ARE_X` stayed dark at 93.3% **and** at 99.71%, and fired at 100
> — the only percentage either of its two base uses passes (the denominator is every plot, ocean
> included). If a count-style requirement will not fire, try the shipped number before concluding the
> mechanism is broken.

> **⚠ TEST THE NEGATIVE CASE — an ignored argument reads as success.**
> `REQUIREMENT_PLAYER_HAS_X_WAR_SUPPORT` with a bare `Amount` reads *your own* support in isolation,
> not the contest: it paid out while the player was 2 **behind**. `MoreThanOpponent="True"` is what
> makes it a comparison. Do the thing that should NOT satisfy the gate and confirm it stays dark —
> that is how `WarType=FORMAL_WAR` was confirmed to discriminate (a Surprise War left the marker dark,
> a Formal War lit it).

> **✅ LITMUS-PROVEN 2026-08-02 — the two "founded this Age" requirements.** Both were run live
> in an Exploration **advanced start** (`eni-walls-litmus`, three gold probes at 10k/30k/90k):
> - `REQUIREMENT_CITY_HAS_ONLY_BUILDINGS_FROM_THIS_AGE` **works, and is strict about the
>   building's `Age` FIELD, not when it was placed.** Advanced-start settlements FAIL it (they
>   arrive holding Antiquity-age buildings); a town founded during the Age and then promoted to a
>   City PASSES it. So paired with `REQUIREMENT_CITY_IS_CITY` it is a sound "this settlement was
>   founded this Age" test. Corollary worth knowing before you fear a grant breaks it: the
>   Exploration advanced-start card `CARD_GRANT_WALLS` pushes `BUILDING_ANCIENT_WALLS`
>   (`Age="AGE_ANTIQUITY"`) into every City *and Town* you hold — but only those existing when the
>   card fires, and Ancient Walls are `Purchasable="false"` and unbuildable in a later Age, so a
>   settlement founded after turn 1 can never acquire one. Granted Antiquity buildings can only
>   disqualify settlements that were already disqualified.
> - **"N settlements each having a building WITH an assigned Specialist" works** (proven in-game
>   2026-08-02): `REQUIREMENT_COLLECTION_COUNT_ATLEAST` over `COLLECTION_PLAYER_PLOT_YIELDS` with a
>   sub-`RequirementSet` of `REQUIREMENT_PLOT_HAS_CONSTRUCTIBLE` + `REQUIREMENT_PLOT_HAS_X_WORKER_POPULATION`
>   (`MinWorkerPopulation=1`). Because the plot collection is empire-wide and the building is
>   one-per-settlement, `Count=3` reads as "in 3 settlements". `PLOT_HAS_X_WORKER_POPULATION` is the
>   way to detect an assigned Specialist on a tile.
> - `REQUIREMENT_PLAYER_HAS_AT_LEAST_NUM_BUILDINGS` **counts buildings in TOWNS as well as cities**
>   by default — proven in-game 2026-08-02 with 3 Temples across 1 city + 2 towns. The vocabulary
>   backs this up: the argument list carries a `CityOnly` flag (used exactly once in the entire base
>   game), which only makes sense if towns are otherwise included. Word deeds as "in N settlements",
>   and reach for `CityOnly` when you genuinely mean cities.
> - `REQUIREMENT_PLAYER_HAS_FOUNDED_X_CITIES` is **Age-scoped and counts TOWNS**. It stayed dark
>   through turn 1 of an advanced start (so it does NOT count settlements you begin the Age with —
>   it is carry-safe) and fired the moment a Settler founded one town, with no `OnlyTowns` flag
>   set. Read the name as "settlements founded", not "city-status settlements"; use the
>   `OnlyTowns` argument only to *exclude* cities.

> **⚠ Two argument readings confirmed in play (2026-08-08), both previously inferred.**
> - `REQUIREMENT_PLAYER_HAS_X_WARS`: `AllMajors` selects **who counts**, not "all of them" —
>   `Amount=2` + `AllMajors` fires on two simultaneous major wars.
> - `REQUIREMENT_GAME_TURN_IS_X_NARRATIVE`: `AfterTurn` counts turns **since the Age began**, not
>   absolute game turn (values are small in every Age — 1–5 typically, 20 once in Modern, 25 in
>   Antiquity). That is what makes it usable in content that must work both from an advanced start at
>   turn ~1 and from a full campaign reaching the same Age at turn ~200.

Useful requirements:

- `REQUIREMENT_CITY_POPULATION` — args `MinUrbanPopulation` / `MinTotalPopulation`.
- `REQUIREMENT_CITY_IS_CITY` / `REQUIREMENT_CITY_IS_TOWN` — settlement type.
- `REQUIREMENT_PLAYER_HAS_X_SETTLEMENTS` — settlement count (often used *inverted* with
  a `RequiredCount` as an "anti-wide" guard). **See the crash warning below.**
- `REQUIREMENT_PLAYER_HAS_COMPLETED_PROJECT` — gate a bonus on a project being built.
- `REQUIREMENT_PLAYER_HAS_COMPLETED_PROGRESSION_TREE_NODE` — gate a bonus on a researched
  tech/civic node (the no-project way to unlock bonuses). Args `ProgressionTreeNodeType`
  **+ `MinDepth` (REQUIRED, set to `1`)**. **Omit `MinDepth` and it silently never fires**
  — no log error, the bonus stays off forever. Every base-game use includes it. Works in
  `OwnerRequirements`. See [projects.md](projects.md#gating-on-a-tech-node-without-a-project).
  **`MinDepth=2` = gate on the node's MASTERY** (its depth-2 unlock) — useful to split a node's
  first-tier bonus from a deeper "mastery reward." But **`MinDepth=2` only ever fires on a node that
  actually HAS a mastery** — gate it on a node with no depth-2 and it silently never fires (same trap).
  Verify first: grep the age's `progression-trees-*.xml` for an `UnlockDepth="2"` row on that node.
  (Base uses `MinDepth=2` itself, so it's proven; just confirm the target node has the mastery.)

> **Crash warning:** Do **not** place a player-settlement requirement
> (`REQUIREMENT_PLAYER_HAS_X_SETTLEMENTS`) in **`OwnerRequirements`** on a
> **`COLLECTION_PLAYER_CONSTRUCTIBLES`** modifier — a bare constructible has no
> settlement/owner context and the game **hard-crashes at map load**. Put settlement
> gates in `SubjectRequirements` on a *city* collection instead.

## Scoping by hemisphere (Homeland vs Distant Lands)

Civ VII's gameplay geography is a **binary: Homeland vs Distant Lands** (the two
hemispheres), not an arbitrary continent count. To scope a bonus — or an anti-wide count —
to one hemisphere:

- **`REQUIREMENT_CITY_IS_DISTANT_LANDS`** — a *city* `SubjectRequirement`; `inverse="true"`
  = the homeland. Canonical template: the **Spain trait** (`age-exploration/data/
  civilizations-shared-gameeffects.xml`) gives homeland cities one amount and distant-lands
  cities another, scoped only by this requirement and its inverse.
- **`REQUIREMENT_PLAYER_HAS_X_SETTLEMENTS` takes a hemisphere filter argument** —
  **`OnlyHomelands`** or **`OnlyDistantlands`** (true/false) — so you can count settlements
  *per hemisphere* (the per-hemisphere form of the anti-wide guard). Base proof: the EX
  Expansionist legacy.
  - ⚠️ **Silent-killer spelling: it is `OnlyDistantlands` — lowercase "l" in "lands".** The
    natural-looking `OnlyDistantLands` parses without error and **silently never fires** (same
    failure class as the `MinDepth` gotcha). `OnlyHomelands` is camelCased as expected.
- **`REQUIREMENT_PLAYER_HAS_X_SETTLEMENTS_FOREIGN_HEMISPHERE`** also exists (args `Count`,
  `OnlyConquered`) but is less flexible (no `OnlyCities`/exact-count) — prefer the
  `OnlyDistantlands` arg on the normal requirement.
- **No per-CONTINENT gameplay scoping.** `ContinentType` is real but **map-gen only**
  (`base-standard/data/maps.xml`); no gameplay requirement counts settlements by continent.
  "One city per continent" (N > 2) is **not data-moddable** — it needs Lua. "Per hemisphere"
  (the binary) is fully data-moddable with the above.

**Exact-count bands — prefer threshold + inverse-threshold over `RequiresExactCount` when a
filter is involved.** To express "exactly N settlements in this hemisphere" (e.g. a geometric
100/50/25 anti-wide curve), use a *pair* of requirements: a normal `RequiredCount=N` plus an
`inverse="true"` `RequiredCount=N+1` (= "≥ N AND NOT ≥ N+1"). The base game only proves the
hemisphere filters with a plain threshold, so combining `RequiresExactCount` *with*
`OnlyHomelands`/`OnlyDistantlands` is unproven and risks silently never firing — the
threshold-pair idiom uses only proven primitives.

## A few effects & mechanics worth knowing

Still copy the exact names/args from the base game — but these come up constantly for
tall/yield mods and have non-obvious quirks:

- **`EFFECT_PLAYER_GRANT_PROGRESSION` is TWO different operations, chosen by
  `FreeProgressionType`.** The split is absolute across all 52 shipped uses:

  | Family | Uses | `BoostPercentage` | What it does |
  |---|---|---|---|
  | `FREE_PROGRESSION_NODE_{SPECIFIC, ANY_UNLOCKED, CHEAPEST_UNLOCKED}` | 28 | **never present** | hands over the whole node |
  | `FREE_PROGRESSION_BOOST_{SPECIFIC, ANY_UNLOCKED, CHEAPEST_UNLOCKED}` | 24 | **always present** | adds progress toward it |

  `BoostPercentage` existing only on the BOOST family is the tell that these are separate
  operations rather than one with a knob. Pick `NODE_*` for "grant a free tech"; pick
  `BOOST_*` for a Civ VI-style Eureka. `*_SPECIFIC` additionally takes `NodeType`.
  **A boost does NOT complete a node, even past 100%** (confirmed in play 2026-08-08 with a
  40% boost on a 64%-researched tech): the extra progress sits there, the node reads *0 turns*,
  and completion resolves when the turn processes — exactly like ordinary research crossing its
  threshold. Useful corollary for UI: at the instant a grant lands, the node is **not** yet
  flagged complete, so code that samples research state right after a grant sees the pre-completion
  value.

- **`EFFECT_CITY_ADJUST_ADJACENCY_FLAT_AMOUNT`** — boost ONE named adjacency rule. Args
  `Adjacency_YieldChange` (the rule id, e.g. `QuarterScience`, `WonderCulture`,
  `MountainCulture`, `ResourceScience`, `NaturalWonderCulture`) + `Amount` + `Divisor`.
  **Fractional adjacency works**: `Amount=1` / `Divisor=2` = +0.5 per adjacent source,
  confirmed in-game (not floored to 0). There is **no** blanket "+X% all adjacency"
  effect — enumerate the rules you want.
- **`EFFECT_CITY_ADJUST_CONSTRUCTIBLE_YIELD`** — flat yield to all buildings of a domain
  or a specific type. Args `YieldType` + `Tag` (`SCIENCE`/`CULTURE`/`GOLD`/…) **or**
  `ConstructibleType`. This is the **only** way to target yields by building domain
  (base proof: `ATTACH_CULTURE_ON_CULTURE_BUILDINGS`).
- **`EFFECT_CITY_ADJUST_WORKER_CAP`** — raise the per-tile specialist cap for a whole city.
  Arg `Amount` only; it is **city-wide and cannot be scoped to a building or class**.
- **`EFFECT_DISTRICT_ADJUST_WORKER_CAP` — the SCOPED sibling (verified in-game 2026-08-15).**
  ⛔ Corrects the older note here that a domain-specific specialist cap "doesn't exist" — that
  applies to the CITY effect only. This one is `collection="COLLECTION_PLAYER_DISTRICTS"`, arg
  `Amount`, and takes plot `SubjectRequirements`, so capacity **can** be targeted per district
  (base proof: `TRAIT_MOD_NEGARA_SPECIALIST_CAP_INCREASE` filters to coastal plots). Proven at
  scale: unfiltered `Amount 2` took tiles from `Specialists 0/1` to `0/3`. Continuous — no
  `run-once` (it must re-evaluate as districts appear). Delivered via the standard attach wrapper.
  ⚠ **READ THE RESULT FROM THE TILE TOOLTIP** (`Specialists x/N`). The City Details line "This City
  currently allows N Specialist per Tile" and `city.Workers.getCityWorkerCap()` are both **city-wide**
  figures that do **NOT** reflect district-scoped bumps — they kept reading 1 while tiles read 0/3.
  ⚠ It does **not** make RURAL districts workable: `districts.xml` gives `Workable="true"` to
  `DISTRICT_URBAN` and `DISTRICT_CITY_CENTER` only, and that gate holds regardless of cap — no rural
  tile is ever offered in the placement picker. See
  [tile-ownership-and-radius.md](tile-ownership-and-radius.md).
- **`EFFECT_CITY_ADJUST_RESOURCE_CAP`** — raise a settlement's resource-slot capacity (more
  assignable resources). Arg `Amount` only. Used on `COLLECTION_PLAYER_CITIES` (with
  `REQUIREMENT_CITY_IS_CITY`), capital, or owner (base proof: Qing capital +2, Monopolies +1).
- **`EFFECT_PLAYER_ADJUST_TRADE_CAPACITY`** — add player trade-route capacity. Args `Amount`
  + `MajorsOnly` (bool); `COLLECTION_OWNER`, works any Age. Like any player-level effect it
  **delivers through the standard attach wrapper** (below) — confirmed firing that way.
- **`EFFECT_PLAYER_REPLACE_CONSTRUCTIBLE`** — the **only** effect that puts a constructible on an
  **already-occupied** tile (Destroy one, Create another in place — and **Create can be a WONDER**, the
  only way to place a wonder without an empty tile). Args **`Destroy`** + **`Create`** only (no tile/city/
  count arg); `COLLECTION_OWNER`, `permanent run-once`. ⚠ **It converts ALL the player's instances of the
  `Destroy` type at once** (confirmed in-game: 2 of building X → 2 wonders) — so only ever name a type the
  player has exactly one of. Base use = Golden-Age building upgrades (`BUILDING_ACADEMY`→`_EX`). See the
  victory-wonder recycle pattern below.

> **"GDP" (the Economic Victory metric) ≠ gold income.** It accrues per turn from *tracked*
> sources — chiefly **resources assigned to cities** (+1 each) and **imported** resources
> (+1 each), plus a flat amount for *having* gold buildings — **not** your treasury gold. So
> to move economic victory, grant **resource capacity + trade routes** (so the player can
> assign/import more resources), not raw gold or gold-adjacency.
> `EFFECT_PLAYER_ACTIVATE_VICTORY_POINT_TRACKER` only **activates a named tracker** (arg
> `TrackerName`, `run-once`/`permanent`) — it does **not** grant flat points per turn, so it
> is *not* a clean "give +N GDP" lever (would need a custom tracker definition).

> **Specialist model (patch 1.4.0 — affects design, not syntax):** a Specialist has **no
> base yield**; it grants **100% of its tile's adjacency** and nothing else, while costing
> **2 / 4 / 6 Food *and* Happiness per Age** (1/1 for obsolete buildings). So a Specialist
> on a low-adjacency tile is a *net loss*. The way to make specialist slots worth filling
> is to **boost adjacency** (above) — every point is doubled by the Specialist on the tile.
> `EFFECT_CITY_ADJUST_WORKER_YIELD` (a flat per-specialist yield, e.g. Abbasid Ulema) is
> therefore **off-design** under 1.4.0 — it re-introduces the base yield the devs removed.
>
> **Tooltip self-attribution is IGNORED by per-X city effects (proven in-game, 2 effects):**
> the `Tooltip` argument names a modifier's line in the city yield breakdown for FLAT effects
> (`EFFECT_CITY_ADJUST_YIELD` — works, base-proven), but the **per-X family silently drops it** —
> proven for `EFFECT_CITY_ADJUST_YIELD_PER_POPULATION` (2026-07-17) and
> `EFFECT_CITY_ADJUST_YIELD_PER_SUZERAINED_CITY_STATE_TYPE` (2026-07-19): the yield pays fully but
> lands in the breakdown's anonymous **"Other"** bucket regardless of the argument. Engine-side,
> unfixable from XML. Consequence: any name-matching readout (dashboard attribution) cannot count
> per-X yields — compute them from state instead (see yield-preview-engine.md), and treat "Other"
> lines as expected for per-X content, not a bug.
>
> **Negative-amount semantics (proven in-game 2026-07-18):**
> `EFFECT_CITY_ADJUST_YIELD_PER_POPULATION` **ignores a negative `Amount` entirely** — the
> modifier attaches but subtracts nothing (zero base-game uses of a negative; a "-1 per 2
> Urban" malus silently became a freebie). To build a malus, use
> `EFFECT_CITY_ADJUST_WORKER_YIELD` with a negative `Amount` (**-N per Specialist**) — the
> base game proves the negative path with `TRADITION_OPPRESSIVE_TARIFFS` (-1 Gold per
> Specialist), and a modded "-1 Food per Specialist" verified exactly in-game (city Food
> dropped by precisely the Specialist count). Off-design for a *bonus*, but the sanctioned
> shape for a per-specialist *penalty*.
>
> Baseline cap, for gating math: in **Antiquity the base specialist cap is 0**, and
> researching **Currency** (`NODE_TECH_AQ_CURRENCY`, base game's `MOD_AQ_SPECIALIST_CAP_INCREASE`)
> grants the first +1 — so Currency is effectively "specialists unlocked." The global
> `CITY_WORKER_STARTING_CAP` is overridden only for Exploration (1) and Modern (3); Antiquity
> uses the 0 default. So your `EFFECT_CITY_ADJUST_WORKER_CAP` bonuses stack *on top of* those.

> **No Great People in Civ VII.** There is **no** Great People / Great Person Points (GPP)
> system. When porting ideas from Civ VI (e.g. *Wide & Tall*), drop anything GPP-based —
> there is no `EFFECT_*GREAT_PERSON*` equivalent. Verify a mechanic exists in VII before
> designing around it.

### Victory-wonder recycle: place a WONDER on an occupied tile (the "Foundations" pattern)

Problem: wonders need an **empty** tile (constructibles.md), so a packed tall city can be unable to build a
Modern **victory** wonder (`WONDER_WORLDS_FAIR`, `WONDER_MANHATTAN_PROJECT`). `EFFECT_PLAYER_REPLACE_CONSTRUCTIBLE`
is the fix, and the clean delivery is a **1-step self-converting building** (proven in-game 2026-06-28):

1. Define a normal **"Foundations" BUILDING** (constructibles.md table set) — a building can overbuild an
   **obsolete** district, which is the tile relief (normal play can't overbuild ageless buildings or place a
   wonder on an occupied tile; the REPLACE below is the bypass). Gate its appearance on the **wonder's own
   unlock node** via `ProgressionTreeNodeUnlocks`
   (`KIND_CONSTRUCTIBLE`) so it only appears once you've earned the wonder normally — never a victory shortcut.
2. Bind a convert modifier to that building via **`<ConstructibleModifiers>`** (the same hook the base game uses to
   hang on-completion effects off a constructible, e.g. `MOD_MANHATTAN_PROJECT_GRANT_NUCLEAR_DEVICE`). On completion
   it REPLACEs the building → the wonder, on that tile, with the full wonder cinematic:

```xml
<!-- GameEffects (e.g. modifiers.xml). NOT added to the attach wrapper - it's bound to the building, not the player. -->
<Modifier id="MA_RECLAIM_WORLDS_FAIR" collection="COLLECTION_OWNER" effect="EFFECT_PLAYER_REPLACE_CONSTRUCTIBLE" permanent="true" run-once="true">
  <SubjectRequirements>
    <Requirement type="REQUIREMENT_PLAYER_HAS_CONSTRUCTIBLE" inverse="true"><Argument name="ConstructibleType">WONDER_WORLDS_FAIR</Argument></Requirement>
    <!-- + your tall gate (REQUIREMENT_PLAYER_HAS_X_SETTLEMENTS inverse) -->
  </SubjectRequirements>
  <Argument name="Destroy">BUILDING_MA_WORLDS_FAIR_SITE</Argument>
  <Argument name="Create">WONDER_WORLDS_FAIR</Argument>
</Modifier>
```
```xml
<!-- Data (Database). Loads AFTER the GameEffects file in the action group so the FK resolves. -->
<ConstructibleModifiers><Row ConstructibleType="BUILDING_MA_WORLDS_FAIR_SITE" ModifierId="MA_RECLAIM_WORLDS_FAIR"/></ConstructibleModifiers>
```

Key points / gotchas:
- **Fire REPLACE from a building's `ConstructibleModifiers` (on completion) or from `ProjectCompletionModifiers`
  — NOT from the game-start attach wrapper** (firing REPLACE at game start is a native crash; the base game only
  fires REPLACE at Age transitions, when the constructibles already exist).
- The **`Destroy` building must be unique** (you build exactly one) since REPLACE hits all instances of the type.
  A capped/deliberate Foundations building you only build when needed satisfies this; the `inverse
  REQUIREMENT_PLAYER_HAS_CONSTRUCTIBLE(the wonder)` guard prevents ever creating a second.
- **Victory credit works:** the win checks owning the wonder (or completing a project whose `PrereqConstructible`
  is the wonder, e.g. `PROJECT_OPERATION_IVY` for Military) — the engine can't tell a REPLACE-placed wonder from a
  normally-built one. Confirmed in-game (Operation Ivy unlocked after a REPLACE-placed Manhattan Project).
- Give the Foundations building the **wonder's own icon** (constructibles.md → Icons) and put its how-it-works text
  in the building's **`Tooltip`** (the pop-out renders Tooltip, not Description).

### Appeal (tile desirability) — thresholds, requirements & effects

Appeal is an **accumulated** plot score (NOT a static per-tile value): each **adjacent
item of natural beauty** — forest, savannah woodland, sagebrush steppe, mangrove swamp,
taiga, mountain, coast, navigable river, natural wonder — grants **+1 Appeal** to the tile.
The thresholds and payouts are **engine-side** (not in any GlobalParameters table — don't
look for a moddable cutoff), stated verbatim in the **Civilopedia**:
`Base/modules/base-standard/text/en_us/Civilopedia_Concepts_Text.xml` (the "Appeal" concept):

| Grade | Accumulated Appeal | Vanilla payout (improved **rural** tile) |
|---|---|---|
| Average | 0–2 | nothing |
| **Charming** | **3–4** | +1 Happiness |
| **Breathtaking** | **5+** | +2 Happiness |

- The **Appeal value** lives on terrain/features in `Base/modules/base-standard/data/terrain.xml`
  (+ the natural-wonder terrain files): ordinary natural-beauty features = **`Appeal="1"`**;
  **natural wonders = `Appeal="6"`** → a single adjacent natural wonder alone clears Breathtaking
  (≥5), which is why NW-adjacent tiles read as "always Breathtaking" in-game.
- **`REQUIREMENT_PLOT_HAS_APPEAL`** — gate a plot-yield modifier on a tile's Appeal grade. Two
  threshold args map directly to the grades:
  - `UseAppealHappinessThreshold="true"` = **Charming (3+)** — the +1-Happiness tier.
  - `UseAppealDoubleHappinessThreshold="true"` = **Breathtaking (5+)** — the +2 ("double") tier.
    (That's the literal origin of the "double happiness" name.)
- **⛔ APPEAL IS A RURAL-ONLY PROPERTY — urbanizing a tile DESTROYS it.** Verified in-game
  2026-08-06: a Breathtaking tile had a City Park built on it and the plot tooltip afterwards
  showed **no Appeal line at all**, not a reduced one. So `REQUIREMENT_PLOT_HAS_APPEAL` can never
  be true on an urban plot, and **any deed/bonus of the form "put building X on an Appealing
  tile" is impossible, not merely hard** — the act of building removes the condition it tests.
  This also explains why every shipped Appeal payout is a rural-tile yield: it is a rule, not a
  design preference. Design accordingly — Appeal can reward a rural tile, or gate something
  *adjacent* to appealing terrain, but it cannot survive being built on.
- **Consume appeal** (reward yields on appealing tiles): `EFFECT_PLOT_ADJUST_YIELD` on
  `COLLECTION_CITY_PLOT_YIELDS` (or `COLLECTION_PLAYER_PLOT_YIELDS`) + `REQUIREMENT_PLOT_HAS_APPEAL`.
  Add `REQUIREMENT_PLOT_DISTRICT_CLASS` (`DistrictClass=RURAL`) to restrict to the rural ring.
  Base proofs: `MOD_SHWEDAGON_ZEDI_DAW_TILE_APPEAL_SCIENCE` (RURAL + single/Charming),
  `MOD_HEIAN_HOO_DO_HALL_APPEAL_YIELDS` (no district filter + double/Breathtaking, Cul/Prod/Happy).
- **Grant appeal** (make wonders raise nearby Appeal): **`EFFECT_PLAYER_GRANT_WONDER_APPEAL`**
  (arg `Amount`) — **new in 1.4.1 / Brush & Blade**, defined only in `DLC/heian/modules/data/`
  (`WONDER_HOO_DO_HALL`). It is **player-scoped and wonder-generic** — Amount = appeal each of the
  player's wonders radiates to surrounding tiles (so it *is* an "all wonders grant appeal" lever).
  ⚠ It's the **only** appeal-*granting* effect — base 1.4.1 has none; Appeal otherwise comes only
  from terrain/features. Verify it resolves with the Heian DLC **disabled** before relying on it
  (engine effect, but the only on-disk definition ships in the DLC module).
- **Adjacency variants** also key off appeal grade by name: `AdjacentCharmingAppeal="True"` /
  `AdjacentBreathtakingAppeal="True"` on an `Adjacency_YieldChange` row (Heian Jinja/Jōbō proofs)
  — an alternative to `REQUIREMENT_PLOT_HAS_APPEAL` when the bonus is a building adjacency.

> **Custom activatable adjacency recipe (e.g. "+Happiness to buildings next to a Wonder").** Three pieces,
> and the **table name on the activation row is a crash-class gotcha**:
> 1. Define the rule in **`<Adjacency_YieldChanges>`**: `<Row ID="MyRule" YieldType="YIELD_HAPPINESS"
>    YieldChange="1" TilesRequired="1" AdjacentDistrict="DISTRICT_WONDER"/>`.
> 2. Register the activation row in **`<Constructible_WildcardAdjacencies>`** (NOT `Constructible_Adjacencies`):
>    `<Row YieldChangeId="MyRule" RequiresActivation="true" ConstructibleClass="BUILDING"/>`. Using
>    `Constructible_Adjacencies` throws **`table Constructible_Adjacencies has no column named ConstructibleClass`**,
>    rolls back the *whole* UpdateDatabase action group it's in, and **crashes on load**. Base proof:
>    `ExAttributeCultural01WonderHappiness` (Classical Revival) in `age-exploration/data/constructibles-shared.xml`.
> 3. Turn it on with `EFFECT_CITY_ACTIVATE_CONSTRUCTIBLE_ADJACENCY` (arg `ConstructibleAdjacency="MyRule"`,
>    `COLLECTION_PLAYER_CITIES`). It's binary (the rule's `YieldChange` is the magnitude). These `<Database>`-schema
>    rows need their own data file, loaded BEFORE the modifier that activates them. **Keep that data file in its OWN
>    UpdateDatabase action** (or a load-order that tolerates rollback) — if it shares the action group with your
>    modifiers and errors, it takes them ALL down.
> 4. **Wildcard vs class-restricted.** OMIT `ConstructibleClass` on the activation row → the adjacency applies to
>    **every** constructible, buildings AND wonders = the **Machu Picchu** pattern (`MachuPikchuWildcardMountainCulture`,
>    `AdjacentTerrain="TERRAIN_MOUNTAIN"` → all buildings gain Culture per adjacent mountain). With
>    `ConstructibleClass="BUILDING"` it's buildings only. `AdjacentDistrict`/`AdjacentTerrain` picks what it keys off.
>    **Water-keyed adjacency columns** (verified vs base data — AnjuvannamCoastGold, CandiBentarRiverCulture, AltarLake):
>    `AdjacentTerrain="TERRAIN_COAST"` / `="TERRAIN_NAVIGABLE_RIVER"`, `AdjacentNavigableRiver="true"`, `AdjacentLake="true"`.
>    (For per-tile *worked-yield* gates — as opposed to building adjacency — use the `EFFECT_PLOT_ADJUST_YIELD` water gates
>    in the plot-requirements note below: `REQUIREMENT_PLOT_IS_RIVER`/`_IS_LAKE`/`_BIOME_TYPE_MATCHES`/`_FEATURE_TYPE_MATCHES`.)
> 5. **Scale per Age cleanly** (yields, so per-Age scaling is fine): define numbered rules (`MyRule1/2/3`, YieldChange
>    1/2/3) and have each Age activate ONLY its own — a clean +1/+2/+3 with no cross-Age stacking, using only the
>    proven ACTIVATE effect. (Avoid `EFFECT_CITY_ADJUST_ADJACENCY_FLAT_AMOUNT` to bump an *activated wildcard* — that
>    combo is unverified; the numbered-rules approach sidesteps it.)

> **Don't gate STATIC-WORLD effects on a per-Age node.** The physical world (terrain, features, wonders,
> the Appeal they generate) persists unchanged across Age transitions. So a STRUCTURAL effect — "wonders
> grant Appeal," "a building next to a Wonder gets Happiness," appeal-/terrain-based adjacencies — must not
> be gated on a per-Age tech/civic node: it would blink **off at every Age rollover until re-research**,
> though nothing in the world changed. Gate such effects on **durable** conditions (a settlement-count /
> "tall" gate) or leave them **self-scoping** ("no wonder → no effect"), and keep them **binary** (population
> size doesn't decide whether a wonder confers a benefit — no pop tiers). **Yields are the opposite** — yield
> amounts legitimately change with tech/era, so node-gating + re-earning + scaling them per Age is correct.

> **Working impassable terrain — make mountains yield (no special civ).** Mountains are impassable/dead by default.
> To reclaim them: (1) grant the base **faux improvement** via `EFFECT_PLAYER_GRANT_CONSTRUCTIBLE_UNLOCK`
> (`ConstructibleType="IMPROVEMENT_INCA_MOUNTAIN"`) — it's `RequiresUnlock="true"` and **NOT civ-locked**, displays
> in-game as **"Expedition Base"**, and despite its `Age="AGE_EXPLORATION"` tag it works in **all Ages** (Nepal grants
> it from Antiquity: `MOD_NEPAL_IMPROVE_MOUNTAINS`, comment "reusing the same faux improvement"). Building it makes the
> mountain a worked `DISTRICT_RURAL` tile. (2) Put yields ON the peak with `EFFECT_PLOT_ADJUST_YIELD` (see below) gated
> `REQUIREMENT_PLOT_TERRAIN_TYPE_MATCHES`(`TerrainType=TERRAIN_MOUNTAIN`) + `REQUIREMENT_PLOT_DISTRICT_CLASS` inverse
> (`CITYCENTER, URBAN, WONDER`) — mirrors the Inca Apus (`TRAIT_MOD_APUS_MOUNTAIN_FOOD`). **Alternative, no improvement
> needed:** a **warehouse** yield `TerrainInCity="TERRAIN_MOUNTAIN"` pays per-mountain-in-city automatically (how
> Modern grants +1 Happiness per mountain, `MOMountainTerrainHappiness`).
>
> **Working the open OCEAN — the sea twin of the mountain reclaim** (verified in-game 2026-06-27). Ocean workability is
> Age-dependent: **Antiquity** = coast/rivers/lakes/reefs workable but NOT open ocean; **Exploration** = open ocean
> BLOCKED unless granted; **Modern** = all civs work ocean natively. To let a tall city work empty ocean in Exploration,
> grant `IMPROVEMENT_HAWAII_FISHING_BOAT` via `EFFECT_PLAYER_GRANT_CONSTRUCTIBLE_UNLOCK` (`COLLECTION_OWNER`) — the literal
> sea-twin of the `IMPROVEMENT_INCA_MOUNTAIN` grant (same effect/collection, sits a few lines away in Hawaii's
> `TRAIT_MOD_HAWAII_IMPROVE_OCEAN`). It's a `DISTRICT_RURAL` improvement valid on `TERRAIN_OCEAN` with NO resource gate,
> so it works empty ocean. Then `BIOME_MARINE` plot-yields pay the ocean half (coast was already paying in AQ).

> **`EFFECT_PLOT_ADJUST_YIELD` plot requirements** (subject = a plot; use the PLAYER-rooted `COLLECTION_PLAYER_PLOT_YIELDS`
> so it survives the attach wrapper, NOT the city-context `COLLECTION_CITY_PLOT_YIELDS`). Stack any of:
> `REQUIREMENT_PLOT_TERRAIN_TYPE_MATCHES` (`TerrainType`), `REQUIREMENT_PLOT_DISTRICT_CLASS` (`DistrictClass`, supports
> `inverse`), `REQUIREMENT_PLOT_HAS_APPEAL`, and **`REQUIREMENT_PLOT_IS_HOMELANDS`** (bare; `inverse`=distant lands —
> use it to hemisphere-scope a player-wide plot effect so it doesn't bleed across hemispheres). Comma-list `YieldType`
> + one `Amount` applies that amount to each yield (Hoo-Do/Inca proofs).
>
> **Water plot gates** (verified in-game 2026-06-27; same `EFFECT_PLOT_ADJUST_YIELD` recipe, swap the terrain match):
> `REQUIREMENT_PLOT_IS_RIVER` takes **`Navigable`** (navigable rivers) AND **`Minor`** (minor rivers) as args — one
> requirement covers both river kinds; `REQUIREMENT_PLOT_IS_LAKE` (bare); `REQUIREMENT_PLOT_BIOME_TYPE_MATCHES`
> (`BiomeType="BIOME_MARINE"`) = **coast AND ocean in one gate**; `REQUIREMENT_PLOT_FEATURE_TYPE_MATCHES` accepts a
> **`FeatureClassType`** arg (e.g. `FEATURE_CLASS_AQUATIC` = all reefs/atolls in one rule) as well as a single
> `FeatureType`; `REQUIREMENT_PLOT_IS_NATURAL_WONDER` (bare) = the plot is a natural wonder (scope to *water* NWs by also
> requiring `BIOME_MARINE`, DLC-agnostic). Reqs in `SubjectRequirements` are AND-ed — separate water types = separate
> modifiers, which lets each carry its own yield set + amount, and they STACK on a tile that matches several (e.g. a
> reef in marine biome gets both rules — a deliberate premium-tile spike; add an `inverse` gate to de-dupe if unwanted).

> **Gate gameplay on DISCOVERY, not just a tech.** `REQUIREMENT_PLAYER_DISCOVERED_NATURAL_WONDER` (no `FeatureType` =
> *any* natural wonder; proven in-game by `MOUNT_EVEREST_REVEAL`) is a real in-game `OwnerRequirements` gate — an
> effect switches on once the player discovers a natural wonder (an exploration unlock, not a tree unlock). It's a
> one-way latch, so it doesn't blink at Age transitions. **NOT** the same as a civ **`<CivilizationUnlocks>`** entry —
> that's META-progression (unlocking a civ for *future games*) and can't gate in-game modifiers.
> ⚠ **"Discovered" ≠ "revealed" (confirmed in-game 2026-06-27).** The requirement needs the actual DISCOVERY event — a
> unit reaching/adjacent the NW, firing the "discovered [X]" notification — NOT merely the tile being revealed by vision.
> A turn-1 sighting of a natural wonder at the edge of vision does **not** satisfy it (base parallel: `MOUNT_EVEREST_REVEAL`
> fires *"on discovery"*). If a discovery-gated effect "isn't firing," check the player has truly discovered (visited) a NW.

> **Flat per-city "floor" yield gated on terrain/adjacency (Tonga pattern).** For a guaranteed once-per-city bonus
> (e.g. "+yield just for being coastal"), gate a city-collection yield on **`REQUIREMENT_CITY_HAS_TERRAIN`**
> (`TerrainType` + `Amount` = the city owns ≥Amount tiles of that terrain — clean, AND-combines with a tall gate) or, like
> base Tonga, on **`REQUIREMENT_BUILDING_IS_ADJACENT_TO_X`** (`BuildingType` + `AdjacentTerrainTypes`, in a
> `REQUIREMENTSET_TEST_ANY` to OR several buildings — but OR-sets don't AND cleanly with other reqs, so prefer
> `CITY_HAS_TERRAIN`). Auto-scale the amount with `<Argument name="Amount" type="ScaleByGameAge" extra="100">1</Argument>`.
> ⚠ **`EFFECT_CITY_ADJUST_YIELD` takes a SINGLE `YieldType`** (every base use does; e.g. `MOD_FOUNDER_BELIEF_DOMESTIC_FOOD`
> / `_PRODUCTION` are split modifiers) — emit one modifier per yield. (`EFFECT_PLOT_ADJUST_YIELD` *does* take a comma list.)

> **`type="ScaleByGameAge" extra="100"` = the authored `Amount` is a PER-AGE INCREMENT** (it multiplies by the Age ordinal:
> ×1 Antiquity, ×2 Exploration, ×3 Modern). So `Amount ...extra="100">2</Argument>` resolves to **2 / 4 / 6** across the three
> Ages, not a flat 2. Calibrated against `MEMENTO_AMINA_KWALKWALI` (base `1` → player text reads literally "+1 Gold **per Age**").
> The scaling is engine-compiled (no data/JS formula to read — confirm empirically like this). Two consequences: (1) works on
> **negative** amounts too — base-game raze/conquer Influence penalties (`EFFECT_PLAYER_ADJUST_YIELD_PER_RAZED_SETTLEMENT` /
> `..._PER_CONQUERED_CITY`, `-2`) are actually **−2/−4/−6** by Age; (2) to **offset or match** an age-scaled value you must use
> the SAME `ScaleByGameAge extra="100"` — a flat counter only cancels Antiquity and drifts apart in later Ages. Some rows also
> put `type="ScaleByGameAge"` on the `YieldType` argument (e.g. a golden-age memento) — same mechanism.

## THE attach-wrapper rule

This is the second-biggest silent killer (after the integer version).

**You cannot deliver a player/city bonus by binding a `COLLECTION_PLAYER_CITIES`
(etc.) modifier directly in `<GameModifiers>`.** Game-level binding has no owner
context, so the modifier loads with no error and **never attaches to anyone**. (Proven
by an ungated +50-gold probe that produced nothing when bound directly.)

The base game *always* delivers player bonuses through a two-step **attach wrapper**,
exemplified by `MOD_CS_HILLFORT`:

```xml
<!-- Step 1: the wrapper. Bound at game level; COLLECTION_MAJOR_PLAYERS DOES resolve
     (every major player), and EFFECT_ATTACH_MODIFIERS hands each player the real
     modifiers listed in ModifierId. -->
<Modifier id="MOD_CS_HILLFORT"
          collection="COLLECTION_MAJOR_PLAYERS"
          effect="EFFECT_ATTACH_MODIFIERS">
    <Argument name="ModifierId">ATTACH_HILLFORT</Argument>
</Modifier>

<!-- Step 2: the real bonus. Now it has a player owner, so its own collection
     (COLLECTION_OWNER / COLLECTION_PLAYER_CITIES / ...) resolves correctly and its
     SubjectRequirements gate per object. -->
<Modifier id="ATTACH_HILLFORT"
          collection="COLLECTION_OWNER"
          effect="EFFECT_PLAYER_GRANT_CONSTRUCTIBLE_UNLOCK">
    <SubjectRequirements>
        <Requirement type="REQUIREMENT_PLAYER_ELIGIBLE_CS_BONUS">
            <Argument name="CityStateBonus">CITY_STATE_BONUS_ANTIQUITY_1</Argument>
        </Requirement>
    </SubjectRequirements>
    <Argument name="ConstructibleType">IMPROVEMENT_HILLFORT</Argument>
</Modifier>
```

To deliver many bonuses, list them comma-separated in one wrapper:

```xml
<Modifier id="MY_ATTACH_ALL" collection="COLLECTION_MAJOR_PLAYERS"
          effect="EFFECT_ATTACH_MODIFIERS">
    <Argument name="ModifierId">MY_BONUS_1, MY_BONUS_2, MY_BONUS_3</Argument>
</Modifier>
```

Then **bind only the wrapper** (`MY_ATTACH_ALL`). Each attached modifier resolves its
own collection against each player and self-gates with its own requirements (project
completed, population tier, etc.). A tall / one-city mod can use exactly this: one
`TM_<age>_ATTACH_ALL` wrapper listing ~13 bonus modifiers per Age, bound alone.

## Binding a Modifier to a player

Keep two ideas separate: **delivery** (the wrapper, which gives the modifier a player
owner) and the **unlock gate** (when it's allowed to switch on). Player/city bonuses
should *always* be delivered through the wrapper; you then choose how they unlock:

1. **Tech/civic-node gate (simplest — no project, no slotting).** Bind the wrapper
   always-on via `<GameModifiers>` and put a
   `REQUIREMENT_PLAYER_HAS_COMPLETED_PROGRESSION_TREE_NODE` (`MinDepth=1`!) in each
   bonus's `OwnerRequirements`. The bonus turns on automatically when the node is
   researched. This is a common tall-mod approach. See
   [projects.md](projects.md#gating-on-a-tech-node-without-a-project).

2. **Tradition** — a data-XML `<Traditions>` row, linked to a Modifier via
   `<TraditionModifiers>`, offered by a civic node via `<ProgressionTreeNodeUnlocks>`.
   The tradition's `<GameModifiers>` should bind the **wrapper**, not the raw
   player/city modifier. (Lapses when un-slotted — useful, or a pitfall, at Age boundaries.)

3. **Project completion** — a Project's `<ProjectCompletionModifiers>` row fires a
   Modifier when the project finishes; gate ongoing bonuses on
   `REQUIREMENT_PLAYER_HAS_COMPLETED_PROJECT`. See [projects.md](projects.md). Again, for
   player/city scope, fire a wrapper.

Whichever you pick: keep always-on safety nets (happiness/upkeep cushions) **ungated** so
they survive Age-transition windows when the gate is briefly unmet.

Rule of thumb: if a modifier's `collection` starts with `COLLECTION_PLAYER_` or
`COLLECTION_OWNER` and you're about to bind it directly at game level, stop — wrap it.

## Per-Age variants of an always-scoped row (the "description repoint" idiom)

An always-scoped row (e.g. a Tradition that must persist across Age transitions) has ONE value per
column — but you can vary what the player sees per Age with an **age-scoped `<Update>`** that
repoints a column at a different LOC tag (or value):

1. Register the row once in an always-scope action group (e.g. LoadOrder 107).
2. Emit the variant text rows under distinct tags (`LOC_X_DESC`, `LOC_X_DESC_EX`, `LOC_X_DESC_MO`)
   in the always text file.
3. In each later Age's per-age action group (higher LoadOrder so the row exists), add
   `<Traditions><Update><Where TraditionType="X"/><Set Description="LOC_X_DESC_EX"/></Update></Traditions>`.
   The per-age group re-applies at every Age load, so the column tracks the current Age.

This is the same per-age `<Update>` idiom the base game uses to change resource classes by Age.
Verified 2026-07-19 (a persistent Tradition whose effect re-anchors on each Age's buildings — the
modifiers re-bind per Age anyway; this closes the gap for the DESCRIPTION the player reads).

## Great Work slots: which effect takes which SlotType (silent no-op trap)

Two effects add Great Work slots, and they differ on `GREATWORKSLOT_ANY`:

- `EFFECT_CITY_ADJUST_GREAT_WORK_SLOTS` (city collection; args `ConstructibleType` or `Tag`,
  `SlotType`, `Amount`) — **base NEVER passes `GREATWORKSLOT_ANY`**; every live usage types the
  slot (`GREATWORKSLOT_RELIC` on Temples/Palace: Founder belief BONUS_8_RELIC_SLOT_TEMPLE, Edward
  Teach; Alexander omits SlotType entirely). Passing `ANY` **silently no-ops** (proven in-game
  2026-07-19: "+2 slots on Temples" with ANY added nothing; no log error). Type it to the Age's
  Great Work: `GREATWORKSLOT_WRITING` (AQ Codices) / `GREATWORKSLOT_RELIC` (EX) /
  `GREATWORKSLOT_ARTIFACT` (MO).
- `EFFECT_CONSTRUCTIBLE_ADJUST_GREAT_WORK_SLOTS` (constructible collection +
  `REQUIREMENT_CONSTRUCTIBLE_HAS_GREAT_WORK_SLOT`) — `GREATWORKSLOT_ANY` **works** here; base
  proof is Catherine de Medici (COLLECTION_PLAYER_CONSTRUCTIBLES, +1 ANY slot on every building
  that already has one) and the Heian great person.

## REQUIREMENT_TRIUMPHS_COMPLETED placement rule (in-game matrix, 2026-07-21, twice-corrected same day)

**The final law: `REQUIREMENT_TRIUMPHS_COMPLETED` NEVER evaluates true inside a live
modifier's requirement lists — in ANY placement.** It is not "frozen at attach" (the earlier
theory): a Tradition slotted FRESH, after its Triumph was earned and after a reload, still
paid nothing (in-game: Concordat at 3 settlements with the Triumph complete). Reload never
helps. The requirement only functions at **event/query time** — Legacy/feat requirement sets,
narrative-story gates, dedication unlock checks — never as a live modifier gate.

| Placement | Result |
|---|---|
| In-leaf on an always-attached modifier | ❌ dead (pillars died at 3 settlements) |
| On an always-bound attach wrapper's SubjectRequirements | ❌ dead — the wrapper never attaches its payload mid-session (Temple slots, branch packages) |
| In-leaf on a slot-attached Tradition modifier — ANY slot timing | ❌ dead (fresh-slot Concordat, re-slot + reload City Beautiful) |
| In a Legacy/feat/story/dedication REQUIREMENT SET (event-time evaluation) | ✅ works |
| **Not as a requirement at all — as the attach moment: payload ids in the Triumph's own `LegacyModifiers` reward carrier (`COLLECTION_OWNER` + `EFFECT_ATTACH_MODIFIERS`)** | ✅ **fires instantly at Triumph completion — the ONLY mid-session Triumph-conditioned delivery** |

So the delivery recipe for "bonus gated on a count window AND a Triumph": count reqs in-leaf
(they DO re-evaluate continuously — the proven suspend/return shape), and the Triumph
condition expressed as attachment itself via the reward carrier (one LegacyModifiers row per
LegacyType — base never stacks two; merge payloads). Attach-on-earn is monotonic; detach does
not exist, so anything that must SUSPEND uses continuously-re-evaluated reqs only.

**The structural-blink corollary (in-game proof, 2026-07-21): never split a CAPACITY or
ACTIVATION effect across mutually exclusive requirement windows.** When a state change flips
which window applies, the engine processes the old copy's OFF before the new copy's ON — a
one-tick gap that yields tolerate but structure does not: a windowed
`EFFECT_CITY_ADJUST_GREAT_WORK_SLOTS` handover **evicted every slotted Great Work to the
archive** (capacity recovered; contents did not re-slot), and a deactivated
`EFFECT_CITY_ACTIVATE_CONSTRUCTIBLE_ADJACENCY` / `EFFECT_CITY_ADJUST_ADJACENCY_FLAT_AMOUNT`
does not re-fire. Affected family: Great Work slots, adjacency activations/flat-amounts,
resource capacity, worker/specialist capacity, trade capacity. (Empirically, dropping resource
capacity did NOT unassign already-assigned resources — the engine tolerates over-cap — but
treat the whole family uniformly.) Rule: **windows are for yields; structure gets ONE copy**
with at most a single monotone ceiling requirement (e.g. "at most N settlements") that only
crosses in punished states. Related, pre-existing: never per-Age-node-gate static-world
effects (appeal, unlock grants) — same blink logic at Age transitions.

**Wonders cannot RECEIVE adjacency yields (in-game, 2026-07-21).** A
`Constructible_WildcardAdjacencies` row with `ConstructibleClass="WONDER"` as the receiver
silently does nothing — a completed Wonder adjacent to the rule's anchor showed zero, while
the SAME activation family's building-receiver rules paid correctly in the same save (a
Hospital next to 2 mountains collected the full stacked amount). Combined with the earlier
law (`REQUIREMENT_PLOT_ADJACENT_CONSTRUCTIBLE_TYPE_MATCHES` never matches in live plot-yield
subjects), there is NO working shape for "pay yields on a Wonder conditional on what it's
next to." Working alternatives: unconditional Wonder yields via
`EFFECT_PLAYER_ADJUST_CONSTRUCTIBLE_YIELD ConstructibleClass=WONDER` (Style Empire idiom), or
**flip the direction — pay a BUILDING per adjacent Wonder** with an
`Adjacency_YieldChanges` row using `AdjacentDistrict="DISTRICT_WONDER"` (base-proven
everywhere: the Hospital/Bath/Garden `WonderFood` rule), wildcard-bound to the receiving
building with `RequiresActivation` + `EFFECT_CITY_ACTIVATE_CONSTRUCTIBLE_ADJACENCY`.

**For slottable-Tradition (card) content that must ALSO respect the Triumph gate**, the
companion primitive is `REQUIREMENT_PLAYER_HAS_ACTIVE_TRADITION` (args: `TraditionType`, or
`MinAmount` for a count; also `ActiveAtGoldenAge`). Base-proven to re-evaluate LIVE on an
always-attached modifier: the metaprogression challenge
`CHALLENGE_TUTORIAL_SLOTTED_TRADITIONS_COMPLETED` (base-standard
metaprogression-gameeffects.xml) fires mid-session the moment the player slots their 3rd
Tradition — an always-attached `COLLECTION_OWNER` modifier with the requirement in
OwnerRequirements. Recipe: the card's Triumph-gated copies ride the feat's reward attach and
carry `REQUIREMENT_PLAYER_HAS_ACTIVE_TRADITION` (their own TraditionType) + count windows
in-leaf — pays only while slotted, immune to slot/earn ordering. (The `TraditionType`-filtered
form's live re-evaluation is one litmus behind the `MinAmount` form — verify on first use.)
