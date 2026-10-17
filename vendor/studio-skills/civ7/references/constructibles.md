# Constructibles: AGELESS, obsolescence & overbuilding

Buildings, improvements, and wonders are all **Constructibles** (data table `Constructibles`,
root `<Database>`), tagged via `TypeTags` (e.g. `AGELESS`, `WAREHOUSE`, `PRODUCTION_WAREHOUSE`).
How a constructible behaves across Ages — and whether its tile can ever be reclaimed — is
governed by the **`AGELESS` tag** and the **`Age` column**. These rules were verified in-game.

## `AGELESS` = never obsolete, permanent tile (can't be overbuilt by default)

- **`AGELESS`** constructible → **never goes obsolete** (keeps its yields/effect across every Age) and its
  tile is **permanent: it cannot be overbuilt by normal play.** Warehouses (Brickyard, Granary, Sawmill, …)
  **and all Wonders** carry `AGELESS` (e.g. `<Row Type="WONDER_PYRAMIDS" Tag="AGELESS"/>`). Full list + each
  constructible's **Age** and **Ageless** flag: [constructibles-catalog.md](constructibles-catalog.md).
- **Non-`AGELESS`** constructible with an `Age` → goes **obsolete** once the current Age is later than its
  `Age`: it stays on its tile but **loses its yields** — and **this is the one overbuildable case**, a
  current-Age building can replace it at no real cost.
- ⚠ **The default game forbids overbuilding an `AGELESS` building** (and forbids overbuilding/placing a
  **WONDER** on an occupied tile). A **mod** can still reclaim such a tile with the scripted
  **`EFFECT_PLAYER_REPLACE_CONSTRUCTIBLE`** (Destroy+Create) — that is "special mod work," not a normal
  action. A recycle / overbuild feature can use it to place a victory WONDER on a tile normal
  play won't free (an in-game test even landed one over an `AGELESS` Sawmill — which a normal overbuild can't do).
  See [gameeffects.md](gameeffects.md).

## Obsolescence is engine-computed (no per-building flag)

A building is obsolete when **`Age` < the current Age**. There is **no** "obsolete now" column and
no building-level obsolete/replacement table (only *units* have replacement chains). Consequences:

- **Nothing is overbuildable during the first Age (Antiquity)** — there's no earlier age to be
  behind. You can't data-hack a building into being overbuildable within its own age.
- **To test overbuild without an age-advance cheat:** start a new game in a **later Age** via
  **Advanced Setup → Age** (a setup option, not a cheat). A later-age start hands you a capital
  pre-built with obsolete, overbuildable previous-age buildings.

## Overbuilding: ONLY obsolete age-bound buildings (AGELESS + WONDERs are protected)

Verified in-game. By default:

- A current-Age **building** can overbuild an **obsolete previous-age building**, reclaiming that tile (you
  lose nothing — the obsolete one already lost its yields). This is how a tall player frees urban tiles.
- You **cannot** overbuild an **`AGELESS`** building (its tile is permanent), and a **WONDER** can't be
  overbuilt or placed on an occupied tile — **wonders require an *unoccupied* valid tile.**
- ⇒ Overbuilding only recycles **obsolete age-bound** tiles; it can't touch ageless tiles and doesn't free
  space for a wonder. In a fixed city radius, building density and wonders compete for finite empty tiles. To
  place a victory **WONDER** in a packed city you need the scripted **`EFFECT_PLAYER_REPLACE_CONSTRUCTIBLE`**
  ("Foundations" recycle pattern in [gameeffects.md](gameeffects.md)) — it bypasses these default restrictions.

## ⛔ COUNTING A TILE'S SLOTS: `ConstructibleClass=="BUILDING"` IS **NOT** "USES A SLOT"

Verified **2026-08-19** against the full `Base` + `DLC` tree (1.4.2) and against the base game's own placement
model. Two separate exceptions, each with its own engine-side test — copy the engine's test, do not list types.

**1. Occupies NO slot — `ExistingDistrictOnly`.** The base game filters the district's constructibles on the
**COLUMN**, not on a tag, when it builds the slot row:

```js
// base-standard/ui/place-building/model-place-building-v2.js  (~line 290)
const constructibles = selectedDistrict.getConstructibleIds().filter((constructibleID) => {
    ...
    if (constructibleDefinition.ExistingDistrictOnly) { return false; }   // <- the real rule
    return true;
});
```

Base + all DLC: exactly **3** rows carry it — `BUILDING_ANCIENT_WALLS`, `BUILDING_MEDIEVAL_WALLS`,
`BUILDING_DEFENSIVE_FORTIFICATIONS`. All three are `ConstructibleClass="BUILDING"`, so a class check counts
them and a tile holding walls + 2 buildings reads as **full when a slot is free**. The same 3 also carry the
`IGNORE_DISTRICT_PLACEMENT_CAP` tag, but **test the column** — it is what the engine tests, so a future DLC or
third-party wall is handled without a hard-coded list.

**2. Occupies the WHOLE tile — improvement OR wonder OR the `FULL_TILE` tag:**

```js
// same file, ~line 192
const isFulltileConstructible = isImprovement
    || constructibleDef.ConstructibleClass == "WONDER"
    || ConstructibleHasTagType(constructibleDef.ConstructibleType, "FULL_TILE");
```

Base + all DLC: `FULL_TILE` is on **3 Modern-age BUILDINGS** — `BUILDING_AIRFIELD`, `BUILDING_RAIL_STATION`,
`BUILDING_LAUNCH_PAD`. ⚠ **These are the trap**: wonders are obvious, but these read as ordinary slot-fillers
on class alone, and stacking one with other buildings renders the same visibly broken hybrid a stacked wonder
does. `ConstructibleHasTagType` is exported from `base-standard/ui/utilities/utilities-tags.js`.

**Sweep, same tree, for context:** `AGELESS` 153 rows · `PERSISTENT` 3 (`BUILDING_PALACE`, `BUILDING_CITY_HALL`,
`BUILDING_HARBOR`) · `IGNORE_DISTRICT_PLACEMENT_CAP` 3 · `FULL_TILE` 3 · `DISTRICT_WALL` 3 · `LINK_ADJACENT` 5.
**All 69 wonders (base + DLC) are `AGELESS`**, so an ageless test excludes every wonder as a side effect —
do not rely on that alone if the intent is "not a wonder".

`utilities-tags.js` also ships `constructibleTagsToExclude` — the tags the game never shows the player
(`FULL_TILE`, `IGNORE_DISTRICT_PLACEMENT_CAP`, `DISTRICT_WALL`, `LINK_ADJACENT`, `PERSISTENT`, `URBANCENTER`,
`RAIL_CONNECTION`, `MILL`, `CRISIS`, `GREATWORK`, `RELIGIOUS`, `TRADE`, `SUPPLIES`, `UNIT_FORTIFICATION`,
`DAMAGE_UPON_OCCUPATION`). A tag on that list is **mechanical**, and its absence from a tooltip is deliberate.

## ⛔ WALLS CARRY PLACEMENT RULES NO TABLE EXPRESSES — enforce them or the RPC will not

Walls are `ConstructibleClass="BUILDING"`, so any code that offers "buildings" sweeps them up, and
`Game.PlayerOperations.sendRequest(..., "CREATE_ELEMENT", ...)` validates NOTHING. Verified in play
2026-08-19: a picker offered Ancient Walls on a ring-4 tile with no wall within four hexes.

The rules are stated only in the Civilopedia ("Fortifications"), not in `Constructible_Valid*`:
- must be built **adjacent to other Walls of the same Settlement, starting with the City Center**
- **cannot** be adjacent to Walls of a DIFFERENT settlement (except at the City Center, always allowed)
- **cannot** be built on Navigable River hexes — `GameplayMap.isNavigableRiver(x, y)`
- **cannot** be built on Rural tiles
- purchasable with Gold only at the City Center; elsewhere Production, one tile at a time

⚠ `ExistingDistrictOnly="true"` independently means a wall can never OPEN a district, so a wall on bare
ground is impossible regardless of the chain rule. Identify walls by the **`DISTRICT_WALL` tag** (3
types, one per Age). See also the slot-accounting section below — walls occupy no slot.

### ⛔ NAMING TRAP — walls are not all named `*_WALLS`

**Modern's wall is `BUILDING_DEFENSIVE_FORTIFICATIONS`.** A scan for type names containing `WALL`
returns two of the three and looks complete, which is exactly how "there is no Modern-age wall
building" gets asserted as fact. The set is `BUILDING_ANCIENT_WALLS` (AQ),
`BUILDING_MEDIEVAL_WALLS` (EX), `BUILDING_DEFENSIVE_FORTIFICATIONS` (MO) — **find them by the
`DISTRICT_WALL` tag, never by name.**

⚠ Two more things that match a name or tag search for "wall" and are **not** in this family:
`IMPROVEMENT_HAN_GREAT_WALL` and `IMPROVEMENT_MING_GREAT_WALL` are civ-locked
(`TraitType` `TRAIT_HAN` / `TRAIT_MING`) whole-tile **improvements** whose `ValidDistricts` is
`DISTRICT_RURAL` only. They carry `FORTIFICATION` and `LINK_ADJACENT` but **not** `DISTRICT_WALL`,
so they follow none of the wall rules above. Class and `ValidDistricts` decide scope — tags alone
do not.

## ⛔ EVALUATING ADJACENCY YOURSELF: THE 21 COLUMNS, AND THE 7 EVERYONE MISSES

Any mod that predicts a building's yield on a tile (a planner, a picker, a "what would this pay"
readout) has to reimplement `Adjacency_YieldChanges`, because the engine's own preview only covers
tiles the native placement calculator reaches. Verified against base + DLC on 1.4.2 — every column the
shipped data actually uses, with how many rules use it:

| column | rules | how to test it |
|---|---|---|
| `AdjacentTerrain` | 55 | `GameplayMap.getTerrainType` |
| `AdjacentDistrict` | 38 | `Districts.getAtLocation().type` |
| **`AdjacentConstructibleTag`** | **27** | any constructible on the tile carrying that `TypeTags` row |
| `AdjacentConstructible` | 20 | exact type on the tile |
| **`AdjacentQuarter`** | **20** | see the quarter rule below |
| `AdjacentResource` | 18 | `GameplayMap.getResourceType` >= 0 |
| `AdjacentLake` | 12 | `GameplayMap.isLake` |
| `AdjacentRiver` | 10 | `GameplayMap.isRiver` |
| **`AdjacentNaturalWonder`** | **7** | `GameplayMap.isNaturalWonder` |
| `AdjacentBiome` | 6 | `GameplayMap.getBiomeType` |
| `AdjacentSpecificResource` | 6 | named resource |
| **`AdjacentFeatureClass`** | **5** | `GameInfo.Features.lookup(f).FeatureClassType` |
| **`AdjacentBreathtakingAppeal`** | **4** | `GameplayMap.getAppeal(x,y) >= 5` |
| `AdjacentConstructibleClass` | 3 | class of a constructible on the tile |
| `AdjacentFeature` | 3 | `GameplayMap.getFeatureType` |
| `AdjacentNavigableRiver` | 3 | `GameplayMap.isNavigableRiver` |
| **`AdjacentCharmingAppeal`** | **2** | `GameplayMap.getAppeal(x,y) >= 3` |
| **`AdjacentUniqueQuarterType`** | **2** | a unique quarter of that named type (Zaibatsu, Modern) |
| **`AdjacentUniqueQuarter`** | **1** | any unique quarter |

⛔ `AdjacentSeaResource` and `AdjacentResourceClass` exist in the schema but NO shipped row uses them.

⚠ **The bolded seven are the trap** — 66 of ~240 rules, about 28%. A first-pass evaluator naturally
covers terrain, resources, districts and rivers and silently drops the rest, so its numbers are
plausible and wrong. `AdjacentConstructibleTag` alone is the commonest condition after terrain and
districts.

⭐ **FAIL CLOSED.** An unevaluated condition must count as NO match. Treating it as a match invents
yields, which is far worse than understating them — and log it once per rule so a gap surfaces in the
log rather than as a quietly wrong number.

### ⚠ A QUARTER IS A FULL DISTRICT, NOT "TWO BUILDINGS"

`AdjacentQuarter` is 20 rules, so getting this wrong is expensive. A tile is a Quarter when its
district is **FULL** — `Districts.MaxConstructibles` complete constructibles — and every one of them
**counts toward a quarter**, which is the base game's own test in
`model-place-building-v2.js:588 willBecomeQuarter()`: **AGELESS, or belonging to the CURRENT Age.**
An obsolete previous-Age building on the tile means it is a district and not a quarter, which is why
quarters stop being quarters at an Age rollover.

⛔ **Read the cap from the district row, never hard-code 2.** A mod raising `MaxConstructibles` (a
one-row change) silently changes what "full" means, so every Quarter in the game then needs a third
building.

### Appeal thresholds are not in any table

Each adjacent item of natural beauty is **+1 Appeal**; **Charming = 3**, **Breathtaking = 5**. Stated
in the Civilopedia and enforced by the engine, present in no data row — so they must be written as
constants. `GameplayMap.getAppeal(x, y)` returns the score.

## ⛔ "URBAN" IS A COLUMN AND A LIVE PROPERTY — NEVER A HAND-ROLLED DISTRICT LIST

**Rural tiles are NOT districts.** The Civilopedia states the placement rule as: constructibles may be
placed on owned Rural tiles *"provided they are connected to an Urban tile or City Center"*, which then
converts the tile to Urban. Anything reimplementing that rule (a mod placing buildings itself, past the
range the native calculator covers) must reproduce it, because the `CREATE_ELEMENT` RPC enforces nothing.

`Districts.UrbanCoreType` is the game's classification — verified base + DLC, 1.4.2:

| DistrictType | DistrictClass | `UrbanCoreType` |
|---|---|---|
| `DISTRICT_CITY_CENTER` | CITYCENTER | `ALWAYS_URBAN` |
| `DISTRICT_URBAN` | URBAN | `ALWAYS_URBAN` |
| `DISTRICT_WONDER` | WONDER | **`URBAN_IF_CONNECTED`** |
| `DISTRICT_RURAL` | RURAL | `NEVER_URBAN` |
| `DISTRICT_WILDERNESS` | WILDERNESS | `NEVER_URBAN` |

⭐ **ASK THE ENGINE, DO NOT DERIVE IT: `District.isUrbanCore`** is a live boolean on the District object
— the base game uses it for exactly this judgement in
`base-standard/ui/place-building/model-place-building-v2.js:366`.

⚠ **Why a hand-rolled list of district types is WRONG**: `DISTRICT_WONDER` is `URBAN_IF_CONNECTED`, a
CONDITIONAL. A wonder tile counts as urban only when connected, and only the engine knows whether a
given wonder currently is. A static list either wrongly includes disconnected wonders or wrongly
excludes connected ones. Read `isUrbanCore`; fall back to the column only if the property is missing.

⚠ Also note `Workable="true"` is on CITY_CENTER and URBAN only — RURAL is not workable, which is the
separate reason a specialist can never be assigned to a rural tile.

## Recipe: make a constructible age-bound (overbuildable later)

This is the "Nerfed Warehouses" pattern — strip `AGELESS` and assign an `Age`:

```sql
UPDATE Constructibles SET Age='AGE_ANTIQUITY' WHERE ConstructibleType='BUILDING_BRICKYARD';
DELETE FROM TypeTags WHERE Tag='AGELESS' AND Type='BUILDING_BRICKYARD';
```

Use cases & caveats:
- **Good for:** letting a tile-starved (e.g. one-city/tall) player **recycle** dead obsolete
  buildings into higher-value current-age buildings, and freeing building demand off *empty* tiles.
- **It is a GLOBAL change** — the `Constructibles`/`TypeTags` edit affects **every player, incl. the
  AI**. Unlike a gated `<Modifier>`, you can't scope a table edit to one player.
- **It nerfs the building** — losing `AGELESS` means losing the cross-Age persistence/yield unless
  the player actively overbuilds it each Age.
- **Do NOT strip `AGELESS` from Wonders** — they'd go obsolete (lose their permanent effect) and be
  destroyable via overbuild. Wonders are meant to be permanent; leave them `AGELESS`.

## Age-transition lifecycle (when can you build / overbuild what)

A constructible's `Age` (and the `AGELESS` tag) decide its whole lifecycle. **Grep the
[constructibles-catalog.md](constructibles-catalog.md) for any constructible's Age — it is NOT guessable
from the id** (`BUILDING_TEMPLE` is **Exploration**, not Antiquity; `BUILDING_MONUMENT` is Antiquity).

- **Age-bound building** (has `Age="AGE_X"`, e.g. `BUILDING_TEMPLE` = `AGE_EXPLORATION`):
  - **Buildable ONLY during its own Age.** You cannot build it in a later Age — e.g. you cannot build a
    Temple in Modern. (Antiquity→Exploration→Modern: each tier's buildings are buildable only in that tier.)
  - **On transition to the next Age it goes obsolete:** it stays on its tile but **loses its yields**, and
    becomes the natural **overbuild** target (a current-Age building can replace it at no real cost).
- **`AGELESS` building** (the outlier, e.g. `BUILDING_SAWMILL` — `AGELESS`, no `Age`):
  - **Buildable in any Age**, **never obsolete** (keeps its yields across every transition), and its tile is
    **permanent — NOT overbuildable by normal play.** Only a mod's `EFFECT_PLAYER_REPLACE_CONSTRUCTIBLE` can
    reclaim it (special mod work, not a default action).
- **WONDER** (`ConstructibleClass="WONDER"`): needs an **empty** valid tile, can't be overbuilt and can't
  overbuild (most are also `AGELESS`). A packed city must use `EFFECT_PLAYER_REPLACE_CONSTRUCTIBLE` to place one.
- **First Age (Antiquity):** nothing is overbuildable (no earlier Age to be behind), so obsolescence/overbuild
  only matter from Exploration onward.

## Defining a NEW building (the minimum table set)

A buildable building needs rows in **four** tables (miss the `Buildings` row and it won't function):

```xml
<Database>
  <Types><Row Type="BUILDING_MY_THING" Kind="KIND_CONSTRUCTIBLE"/></Types>
  <Constructibles>
    <Row ConstructibleType="BUILDING_MY_THING" Name="LOC_..._NAME" Description="LOC_..._DESCRIPTION"
         Tooltip="LOC_..._TOOLTIP" ConstructibleClass="BUILDING" Cost="200" Population="0"
         Age="AGE_MODERN" RequiresUnlock="true"/>
  </Constructibles>
  <Buildings><Row ConstructibleType="BUILDING_MY_THING" Movable="false"/></Buildings>   <!-- omit Town= -> city-only -->
  <Constructible_ValidDistricts><Row ConstructibleType="BUILDING_MY_THING" DistrictType="DISTRICT_URBAN"/></Constructible_ValidDistricts>
</Database>
```

- `RequiresUnlock="true"` + a `ProgressionTreeNodeUnlocks` row (`TargetKind="KIND_CONSTRUCTIBLE"`) gates it on a
  tech/civic node — same as a base wonder (e.g. World's Fair is unlocked by `NODE_CIVIC_MO_MAIN_HEGEMONY` at
  `UnlockDepth="2"`/mastery; Manhattan Project by `NODE_TECH_MO_NUCLEAR_FISSION` at depth 1).
  **⚠ The unbuildable-building trap (benchmark-caught, twice):** `RequiresUnlock="true"` with NO
  matching `ProgressionTreeNodeUnlocks` row = a building that exists but can never be built, silently.
  Decide explicitly: either `RequiresUnlock="false"` (always available) or ship the unlock row.
  And deliver **base yields as plain `Constructible_YieldChanges` rows** — never via a modifier
  wrapper "for consistency": a wrapper that's defined but never bound in `<GameModifiers>` is dead
  code, and the plain row is the shipped idiom anyway. Pre-flight checklist for every new building:
  Types row · Constructibles row · Buildings row · valid-districts row · yield rows ·
  unlock row **or** `RequiresUnlock="false"` · localization for Name/Tooltip.
- `Constructible_ValidDistricts = DISTRICT_URBAN` lets it overbuild obsolete urban districts.
- **No player-state buildability gate exists.** The `Constructibles` schema gates only on physical placement
  (`Constructible_ValidDistricts/Terrains/Biomes/Features/Resources`, `Adjacent*`, hemisphere `RequiresHomeland/
  RequiresDistantLands`) + `RequiresUnlock`. **You cannot hide/disable a building because the player owns wonder
  X, has N cities, etc.** — there is no requirement-set hook on a constructible. Conditional hiding needs a UI mod
  (JS production-list filter). (You *can* still gate a `<Modifier>` the building fires — just not the building's
  own buildability.)

## Building on a MOUNTAIN, and what `Constructible_ValidTerrains` actually means

**`Constructible_ValidTerrains` is an EXCLUSIVE whitelist**, and it is the entire mechanism for placing a
constructible on a mountain. No modifier, no script - one companion-table row per allowed terrain.

- A constructible with **no** rows in the table is **unrestricted** by it.
- A constructible **with** rows may be placed **only** on the terrains listed.

**⚠ THE TRAP:** adding only `TERRAIN_MOUNTAIN` to an existing building does not *also* allow mountains - it
**restricts that building to mountains and nothing else**. List every terrain it must remain valid on
(typically `TERRAIN_FLAT`, `TERRAIN_HILL`, `TERRAIN_MOUNTAIN`).

**Verified 2026-08-11** against the installed base + DLC:

| Evidence | Reading |
|---|---|
| Only **53 of 251** constructibles appear in the table at all | absence cannot mean "buildable nowhere", so absence = unrestricted |
| `BUILDING_ANCIENT_WALLS` lists exactly COAST + FLAT + HILL | the list is the complete permitted set - walls genuinely cannot take a mountain |
| `WONDER_MACHU_PIKCHU` lists **only** `TERRAIN_MOUNTAIN` | which is exactly why it is mountain-only in play |

**Two shipped mountain precedents, and only two:** `IMPROVEMENT_HIGHLAND_POWER_STATION`
(`DLC/nepal/modules/data/constructibles-modern.xml:30`) and **`WONDER_MACHU_PIKCHU`**. The wonder one is the
notable half - **a WONDER can legally occupy a mountain tile**, so mountain placement is not improvements-only.

When the rows are a cross-product over ids that may not exist in every Age (two Age-scoped walls, say), emit them
with the self-guarding SQL `INSERT ... SELECT` in [troubleshooting.md](troubleshooting.md) rather than literal
`<Row>`s - it cannot fail a foreign key, so one `criteria="always"` group covers all three Ages.

## The production pop-out renders `Tooltip`, NOT `Description`

For a building/constructible, the in-game **info pop-out** (the panel beside the production list) shows the
constructible's **`Tooltip`** string. Put the player-facing "what it does / how to use it" text in
`LOC_..._TOOLTIP`. (`Description` is used elsewhere/auto-composed; don't rely on it for the pop-out body.)

## Icons: map a constructible to an icon (reuse an existing asset)

A new constructible with no icon shows **blank** in the build list. Icons load via an **`<UpdateIcons>`** action
(NOT `<UpdateDatabase>`), with `IconDefinitions` rows mapping the type to a `blp:` atlas asset. You can **reuse a
base asset** — no custom art needed:

```xml
<!-- data/icons/my-icons.xml -->
<Database><IconDefinitions>
  <Row><ID>BUILDING_MY_THING</ID><Path>blp:wondericon_worldsfair</Path></Row>
</IconDefinitions></Database>
```
```xml
<!-- modinfo: icons load globally; an UpdateIcons action group, criteria="always" like the base art groups -->
<ActionGroup id="my-icons" scope="game" criteria="always">
  <Actions><UpdateIcons><Item>data/icons/my-icons.xml</Item></UpdateIcons></Actions>
</ActionGroup>
```
Find a wonder/building's `blp:` path in `Base/modules/age-*/data/icons/*-icons.xml`. Reusing the target's own icon
(e.g. a "Foundations" building that becomes the World's Fair → `blp:wondericon_worldsfair`) doubles as a UI cue.
