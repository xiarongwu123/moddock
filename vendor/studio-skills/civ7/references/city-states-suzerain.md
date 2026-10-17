# City-States & Suzerain bonuses

How Civ VII independent/city-state suzerain bonuses are structured, the effects for modding them,
and the hard-won gotchas — especially for a **tall / one-city** mod where most CS bonuses scale badly.

> **UI-JS side reads** (verified in shipping UI code + in-game 2026-07-04): a city-state's
> suzerain is `cityStatePlayer.Influence.getSuzerain()` (returns the playerId, `-1` if none —
> majors always return -1, so "count players whose suzerain == me" needs no city-state filter);
> its type is `GameInfo.CityStateTypes.lookup(cityStatePlayer.getCityStateCityStateType())`
> → row `.CityStateType` + localized `.Name`. Iterate candidates via `Players.getAlive()`.

## How the bonus system works (the "draft from a pool" mechanic)

- Every city-state has one of **6 types**: `SCIENTIFIC`, `CULTURAL`, `ECONOMIC`, `MILITARISTIC`,
  `EXPANSIONIST`, `DIPLOMATIC` (CityStateTypes in `base-standard/data/independents.xml`).
- Each type has a **pool of ~7 bonus options per Age**. When you become Suzerain of a city-state you
  **draft one option** from that type's pool. You draft again (another option) for each further CS of
  that type you suzerain. The bonus lasts the rest of the Age, even if the CS is later lost.
- **Exclusive vs Shareable:** most options are **exclusive** — the first player to take one **locks it
  out** for everyone else. Exactly **one option per type is repeatable**, flagged `Shareable="true"`
  in the bonus row. The shareable option is the base-game "+`<yield>` to Warehouse buildings" one.

### Bonus IDs and tables (in each age's `data/independents.xml`)
- Two naming schemes coexist: a generic `CITY_STATE_BONUS_<AGE>_<N>` and a type-named
  `CITY_STATE_<TYPE>_BONUS_<AGE>_<N>`. `<AGE>` = `ANTIQUITY` | `EXPLORATION` | `MODERN`.
- Three tables join them: the `Types` row (`<Row Type="…" Kind="KIND_CITY_STATE_BONUS"/>`), the detail
  row (`CityStateBonusType`, `Name`, `Description`, `CityStateType`, and **`Shareable="true"`** on the
  repeatable one), and a `CityStateBonusType → ModifierID` map (what each option actually does).
- **The repeatable option is reliably `CITY_STATE_<TYPE>_BONUS_<AGE>_7`** for all 6 types × 3 ages.
- CS **unique improvements** exist: constructibles tagged `CITY_STATE_UNIQUE_IMPROVEMENT` (6 per age,
  e.g. Antiquity Hillfort/Megalith/Souq/Ziggurat/Ice House/Festival Grounds). Each is unlocked by
  drafting a specific **exclusive** option (`EFFECT_PLAYER_GRANT_CONSTRUCTIBLE_UNLOCK`). They are tile
  improvements but **1-per-city by escalating-cost meta** — do not assume a player builds several.

## Effects for modding suzerain bonuses (all confirmed to exist in base data)

| Effect | Collection | Args | Scales with |
|---|---|---|---|
| `EFFECT_CITY_ADJUST_YIELD_PER_SUZERAINED_CITY_STATE_TYPE` | PLAYER_CITIES | YieldType, Amount, CityStateType | # CS of that type (flat) |
| `EFFECT_CITY_ADJUST_CONSTRUCTIBLE_YIELD_PER_SUZERAINED_CITY_STATE_TYPE` | PLAYER_CITIES | YieldType, ConstructibleType, Amount, CityStateType | # CS of type × # of that building |
| `EFFECT_PLAYER_ADJUST_YIELD_PER_SUZERAIN` | OWNER | YieldType, Amount | total # suzerains (any type) |
| `EFFECT_ADJUST_PLAYER_FREE_POLPULATION_CAPITAL_ON_CITY_STATE` | OWNER | CityStateType, Amount | # CS of that type → free capital pop |
| `EFFECT_DIPLOMACY_ADJUST_DIPLOMATIC_ACTION_TYPE_EFFICIENCY_PER_SUZERAINED_CITY_STATE_TYPE` | OWNER | DiplomaticActionType, CityStateType, … | # CS of type |
| `EFFECT_CITY_ADJUST_TRADE_ROUTE_RANGE_PER_SUZERAIN_OF` | PLAYER_CITIES | … | # suzerains |
| `EFFECT_ADJUST_UNIT_SUZERAIN_OF_COMBAT_MODIFIER` | unit | … | # suzerains |
| `EFFECT_PLAYER_DIPLOMACY_ALLOW_LEVY_FROM_ALL_CITY_STATES` | OWNER | — | boolean |

Note the base-game **misspelling `POLPULATION`** in the free-pop effect — copy it exactly.

### Gating requirements
- `REQUIREMENT_PLAYER_ELIGIBLE_CS_BONUS` — arg `CityStateBonus="<a bonus id>"`. True when you **have**
  that bonus (i.e. drafted it). This is how the base game delivers each option's effect, and the only
  **type-specific** suzerain gate available. ⚠️ It is **boolean** (drafting again from a 2nd CS of the
  type doesn't make it "more true" — a per-pop bonus gated this way does **not** stack per CS count).
- `REQUIREMENT_PLAYER_HAS_AT_LEAST_INDEPENDENT_RELATIONSHIP` — arg `Amount` (relationship level). No
  type filter — use for "suzerain of *any* CS".
- `REQUIREMENT_PLOT_IS_SUZERAIN_BY_OWNER` — plot-scoped.

## Gotchas / key facts

- **"Influence" = `YIELD_DIPLOMACY` internally** (the pantheon altar `MOD_PANTHEON_ALTAR_YIELD_INFLUENCE`
  actually sets `YieldType=YIELD_DIPLOMACY`; the id is misleading). Use `YIELD_DIPLOMACY`.
- **Influence is a PLAYER-level resource.** It is only ever emitted via player effects — **never** as a
  per-pop or per-city/tile yield. Don't try `EFFECT_CITY_ADJUST_YIELD_PER_POPULATION` (or any
  `EFFECT_CITY_ADJUST_YIELD*`) with `YIELD_DIPLOMACY`; it silently no-ops (no base modifier does it).
  The proven ways to grant influence:
  - `EFFECT_PLAYER_ADJUST_YIELD` with `YieldType=YIELD_DIPLOMACY` + `Amount` — flat player influence/turn
    (base: `TRAIT_MOD_DEFAULT_YIELD_30`).
  - `EFFECT_PLAYER_ADJUST_CONSTRUCTIBLE_YIELD` (`YieldType`, `Amount`, `ConstructibleType`) — +influence
    per instance of a building the player owns. **Recipe for "influence behind a building in the tree":**
    pick the age's Diplomacy building (AQ `BUILDING_MONUMENT`@`NODE_TECH_AQ_MASONRY`, EX
    `BUILDING_GUILDHALL`@`NODE_TECH_EX_GUILDS`) and gate the modifier on that building's unlock node in
    `OwnerRequirements`. Shows on the building's yield tooltip = self-discoverable.
  - `EFFECT_PLAYER_ADJUST_YIELD_PER_SUZERAIN` — +influence per city-state suzerained (compounding).
  - The base town **Hub Town** focus (data id `PROJECT_TOWN_INN`) routes influence via
    `EFFECT_CITY_ADJUST_YIELD_PER_CONNECTED_CITY` = **0 for a one-city player** (no connected settlements).
- **Flat per-CS / per-building suzerain yields are weak for a ONE-CITY (tall) player.** CS count is small
  and you have one of each building; the only axis that scales is **Population**. For tall mods, gate a
  **per-pop** yield (`EFFECT_CITY_ADJUST_YIELD_PER_POPULATION`) on a suzerain requirement instead of
  adding flat yields.
- **Only the `Shareable` option is reliably obtainable** — a rival can lock any exclusive option. So if
  you want a suzerain-gated bonus that the player can always reach, hang it on
  `REQUIREMENT_PLAYER_ELIGIBLE_CS_BONUS(CITY_STATE_<TYPE>_BONUS_<AGE>_7)` (the shareable id).
- **Advertising an added bonus in the draft menu:** the option's menu text comes from its **static**
  `Description`. The tag is `CITY_STATE_<TYPE>_BONUS_<AGE>_7_DESCRIPTION` — **no `LOC_` prefix** (verified
  in the l10n files). ⚠️ **To override an EXISTING tag use `<Replace Tag="…">`, NOT `<Row Tag="…">`.**
  `<Row>` INSERTs → duplicate-key on the already-defined base tag → EnglishText load error → "Rolling back
  database to a good state" → **CRASH** (shows in Modding.log, not Database.log; the data loads fine, the
  text file kills it). The base l10n files use `<Replace Tag="…" Language="…">` for exactly this reason.
  Caveat: the text shows for all players, so an anti-wide-gated add-on over-promises to wide players —
  word it "while tall (…)".
  - 🛑 **`<Replace>` OVERWRITES the whole string — it does NOT append/merge.** If you only mean to *add* a
    line, your replacement still replaces everything, so you silently **lose the base description** (the
    player no longer sees what the bonus does — a content bug, not a crash). To augment rather than erase,
    **read the original text and PREPEND it**, then add your line: `"<base description>[N][N]<your add-on>"`.
    The base CS-bonus descriptions live in `Base/modules/age-<age>/text/en_us/IndependentsText.xml` (tag
    `CITY_STATE_<TYPE>_BONUS_<AGE>_7_DESCRIPTION`) and **differ by age** (the building list grows each age),
    so read them per age at generation time rather than hardcoding. This applies to overriding **any**
    existing base LOC tag, not just city-states: `<Replace>` = full replace; include the original if you want
    to keep it. (Learned 2026-06-22 — an override clobbered the "Papermaking" description.)

## Gate on holding the suzerainty, NOT on the bonus pick (runtime-proven 2026-07)
Two ways to gate a "reward per suzerained city-state" effect:
- ❌ `REQUIREMENT_PLAYER_ELIGIBLE_CS_BONUS` (keyed to drafting that type's Shareable bonus,
  `CITY_STATE_<TYPE>_BONUS_<AGE>_7`). It *works*, but it **forces the player to pick the Shareable bonus
  every time** — which fights any other system that wants them to draft a *different* CS bonus (e.g. an
  improvement-picking feat). It also only flips true at the draft moment.
- ✅ `REQUIREMENT_PLAYER_HAS_X_TRIBUTARIES_OF_TYPE` (`<Argument name="CityStateType">SCIENTIFIC</Argument>`,
  `Amount=1`). Keys off simply **holding** suzerainty of that type, regardless of which bonus you drafted.
  Base-verified (Conqueror-set usage), reads continuously. **This is the clean default.** Per-yield-type:
  one modifier per type (SCIENTIFIC/CULTURAL/MILITARISTIC/ECONOMIC/EXPANSIONIST → its yield). DIPLOMATIC has
  no yield of its own → use `EFFECT_PLAYER_ADJUST_YIELD_PER_SUZERAIN` (Influence per total suzerain) gated on
  a DIPLOMATIC tributary.
- **If you decouple, DELETE the menu-DESCRIPTION override.** Once the reward no longer depends on which bonus
  you pick, annotating one option (`..._7_DESCRIPTION`) *misleads* — the base descriptions should stay vanilla
  and the explanation moves to a tree note or the dashboard. (A stale override + a decoupled gate is a common
  drift after a redesign; grep the generated text for `CITY_STATE_.*_BONUS.*_DESCRIPTION` to confirm it's gone.)

## Reading suzerainties from a UI mod (JS)
`Influence.getSuzerain()` on each player returns the suzerain's playerId (majors return -1). Group by type via
`GameInfo.CityStateTypes.lookup(player.getCityStateCityStateType())` → `.Name` (localized) + `.CityStateType`
(enum, match against `SCIENTIFIC`/… with `.includes()` to map to a yield icon):
```js
for (const p of Players.getAlive()) {
    if (p?.Influence?.getSuzerain?.() != myId) continue;
    const row = GameInfo.CityStateTypes.lookup(p.getCityStateCityStateType());
    // row.Name = display, row.CityStateType = enum -> map to yield
}
```

## Resolved (was "unverified")
- The `COLLECTION_MAJOR_PLAYERS` + `EFFECT_ATTACH_MODIFIERS` attach wrapper delivers these fine without base
  eligibility scaffolding — proven in a shipping mod.
- Overriding the base menu description needs the **`<LocalizedText><Replace Tag=... Language="en_US">`** upsert
  (see above), **not** `<EnglishText><Row>` (which duplicates the base tag → load error → crash).
