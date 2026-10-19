# Razing, capture rewards & conquest hooks

Everything here was verified against installed 1.4.1 + DLC data **and** in-game testing.
Read before building any "reward for taking/razing a city" or "make razing viable" feature.

> **Live create/destroy primitive (UI-isolate RPC):** for a scripted "demolish this district"
> or "rebuild this tile" mechanic outside the native raze timeline, a mod `<UIScripts>` file can
> durably destroy/create districts & constructibles via
> `Game.PlayerOperations.sendRequest(owner,"DESTROY_ELEMENT"|"CREATE_ELEMENT",args)` — authoritative,
> survives save/reload, proven by the *Building Demolisher* mod. Full API + the fake-Great-Person
> trigger + caveats: [ui-modding.md](ui-modding.md) section 6. A cleaner route than overbuild/REPLACE
> for targeted tile relief.

## The base-game razing model (what you're working against)

- **Razing takes multiple turns**, and the duration is **driven by the settlement's population** (Civilopedia: *"the
  number of turns correlates to the size (population)… tiles are razed from the farthest tiles to center"*). The
  per-turn chew rate is `CITY_RAZE_DISTRICTS_PER_TURN` = **2 (Exploration) / 3 (Modern)**; Antiquity uses the engine
  default. Razing itself grants **no yields** — the reward path is *pillaging* (below), a separate unit action.
- **Influence penalty:** `TRAIT_MOD_NEGATIVE_INFLUENCE_RAZED_SETTLEMENTS` = `EFFECT_PLAYER_ADJUST_YIELD_PER_RAZED_SETTLEMENT`,
  `YIELD_DIPLOMACY`, `-2` `ScaleByGameAge extra="100"` → **−2/−4/−6 by Age**, per razed settlement. Applied **AFTER the
  burn completes** ("for the remainder of the current Age"), **resets at Age transition**. Attached to every major civ's
  age trait (`TRAIT_ANTIQUITY_CIV`/`EXPLORATION_CIV`/`MODERN_CIV`). Parallel `..._CONQUERED_SETTLEMENTS` for kept cities.
- **War Support:** razing adds **+1 permanent War Support against you per opponent**.
- **Diplomatic hit:** a **Relationship** penalty (internal `GrievancesGiven="5000"` on `CITY_RAZED`/`TOWN_RAZED` in
  `diplomacy-actions.xml`). ⚠ **Civ VII has NO surfaced "Grievances" mechanic** — that was Civ VI: Gathering Storm.
  Civ VII runs on Relationships + Influence; the grievance value only feeds the relationship drop. Don't tell a user
  they'll "see grievances."
- **A settlement being razed STILL counts** toward `REQUIREMENT_PLAYER_HAS_X_SETTLEMENTS` until the burn completes, so
  it transiently pushes the player over their settlement count (relevant to any settlement-count gate — see below).
- **`city.isBeingRazed`** exists only as a **UI/script property** — there is **no `REQUIREMENT_*` that exposes it**, so
  you cannot gate/count on "is this settlement being razed."

## Speeding up razing — `EFFECT_CITY_ADJUST_RAZE_RATE`

- The **only base use** is the Qajar Soltan (`SOLTAN_MOD_RAIZING`): `collection="COLLECTION_UNIT_OCCUPIED_CITY"`,
  bound via **`UnitAbilityModifiers` → `ABILITY_SOLTAN`** (a *unit-ability* modifier), gated
  `REQUIREMENT_UNIT_IS_STATIONED_ON_DISTRICT` (needs a garrisoned unit). **Delivered through a player attach-wrapper this
  collection never resolves to a unit → the effect silently does nothing** (confirmed in-game: raze timer unchanged).
- **✅ It DOES work on `COLLECTION_PLAYER_CITIES`** (a settlement being razed is still one of your cities) — wrapper-
  deliverable, no garrison needed. This is the shippable delivery.
- **Diminishing returns, not a flat cap:** rate `+20` took a pop-8 city 7→4 turns; `+999` took it 7→3. A 50× bump
  bought one turn. **You cannot reach 1 turn for a mid-size city** — the floor scales with population. Set the amount
  high (e.g. 999) to pin razing to its practical floor; it's harmless on non-razing cities.

## Rewarding capture — the on-capture hook (VISIBLE, per capture)

The clean, proven way to pay the player for taking a city (works whether they keep or raze it):

```xml
<!-- clone of Xerxes XERXES_MOD_GOLD_ON_CAPTURE_SETTLEMENT -->
<Modifier id="..._CAPTURE_GOLD" collection="COLLECTION_PLAYER_CITIES" effect="EFFECT_CITY_GRANT_YIELD" permanent="true">
    <SubjectRequirements>
        <Requirement type="REQUIREMENT_PLAYER_FIRST_TIME_SETTLEMENT_OCCUPATION"/>
        <Requirement type="REQUIREMENT_CITY_TRANSFER_TYPE_MATCHES"><Argument name="TransferType">BY_COMBAT</Argument></Requirement>
    </SubjectRequirements>
    <Argument name="YieldType">YIELD_GOLD</Argument>
    <Argument name="Amount" type="ScaleByGameAge" extra="100">200</Argument>  <!-- 200/400/600 by Age -->
</Modifier>
```

- `EFFECT_CITY_GRANT_YIELD` (YieldType, Amount) is a **one-time lump** to the owning player, and `permanent="true"` on a
  **per-city collection** gated on `REQUIREMENT_PLAYER_FIRST_TIME_SETTLEMENT_OCCUPATION` **fires once per newly captured
  city** (not once ever). ✅ in-game confirmed. `REQUIREMENT_CITY_TRANSFER_TYPE_MATCHES(BY_COMBAT)` restricts it to
  forceful captures (vs gift/liberation). One modifier per yield (Gold, Influence=`YIELD_DIPLOMACY`, …).
- For a truly *once-ever* lump instead, use `EFFECT_PLAYER_GRANT_YIELD` with `run-once="true" permanent="true"`
  (the great-people / legacy pattern: +300 Gold, +500 Influence).
- **On-RAZE** specifically (vs on-capture) needs the discrete `GOSSIP_CITY_RAZED01` narrative-story subsystem — heavier;
  prefer the on-capture hook for the tall "take-then-raze" playstyle. `REQUIREMENT_PLAYER_RAZED_X_CITIES` (Amount
  threshold) exists but only increments on raze *completion* (so it can't gate anything during a first raze).
- **Pillage is the size-scaled reward** (each building pillaged: 40 Science/Age military/sci/prod, 40 Culture/Age
  culture/happy, 40/120/360 Gold food/gold). Amplify with `EFFECT_ADD_PLAYER_UNITS_PILLAGE_BUILDING_PLUNDER`
  (`COLLECTION_OWNER`, Amount + PlunderType — confirmed) — one modifier per `PLUNDER_GOLD/SCIENCE/CULTURE/…`.
  ⚠ `EFFECT_ADJUST_UNIT_PLUNDER_YIELDS` (+% all plunder) did **not** show in the building-pillage preview in testing.

## UX lesson — don't cancel penalties invisibly

An "offset" that cancels a base penalty (e.g. a positive `EFFECT_PLAYER_ADJUST_YIELD_PER_RAZED_SETTLEMENT` to null the
−Influence) is **mechanically real but unseeable** — there is no UI for "a penalty that didn't happen," and the base
**capture dialog still hardcodes the "−N Influence" warning** from the base modifier, so the game actively contradicts
your offset. **Prefer a visible lump grant** that does the same job on-screen (e.g. +Influence on capture) over an
invisible ongoing offset.

## Requirement logic gotchas (general, not just razing)

- **Modifier requirement blocks are FLAT** — you cannot nest AND/OR inside one block. A block is `TEST_ALL` (default) or
  `type="REQUIREMENTSET_TEST_ANY"` (OR), applied to *all* its requirements. No base modifier nests requirement sets.
- A modifier has **two** blocks — `SubjectRequirements` and `OwnerRequirements` — that **AND together**. So to express
  `AND(x,y) AND (a OR b)`: put x,y in one block (TEST_ALL) and `a,b` in the other as `TEST_ANY`. (Watch what already
  lives in each block — e.g. a tech-node gate in `OwnerRequirements` would get OR'd if you make that block TEST_ANY.)
- `REQUIREMENT_PLAYER_HAS_X_SETTLEMENTS` weights settlement types via **`CountPerOwnSettlement`** and
  **`CountPerConqueredSettlement`** (base always sets both to 1 = count all). Design note: **count-all is usually
  correct** — acquiring an allowed metropolis *by conquest* should still count (and keep its bonuses); don't switch to
  founded-only to "fix" a transient raze, or you reward unlimited conquer-and-keep.
- **A requirement-gated, non-permanent `EFFECT_PLAYER_ADJUST_SETTLEMENT_CAP` does not dynamically recompute** in-game
  (a war-gated +1 cap never applied). Settlement-cap adjustments behave like permanent grants; don't rely on toggling
  them via a requirement.
