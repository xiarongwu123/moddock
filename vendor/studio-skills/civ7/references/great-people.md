# Great People (Civ VII) — reference & custom-build recipe

Verified against installed data 2026-07-13. Civ VII has **no** universal Great-Person-Points economy and **no** Great General (that role is the trainable Commander) — but it **does** have civ-unique great people, and they are **fully mod-writable** through ordinary database tables + the standard GameEffects modifier vocabulary.

## Where they live (base + DLC, per Age)

- Antiquity: `Base/modules/age-antiquity/data/greatpeople.xml` (+ `greatpeople-gameeffects.xml`) — Egypt **Tjaty**, Greece **Logios**, Han **Shi Dafu**
- Exploration: `age-exploration/data/greatpeople.xml` — Abbasid **Alim**, Spain **Conquistador**
- Modern: `age-modern/data/greatpeople.xml` — France **Jacobin**, Mexico **Revolucionario**, Siam **Uparat**, + the engine-special **Victory** class (Keynes)
- DLC adds classes the same way (`DLC/heian/…`, `DLC/iceland/…`)
- **Authoritative schema:** `Base/Assets/schema/gameplay/01_GameplaySchema.sql` — `GreatPersonClasses`, `GreatPersonIndividuals`, `Constructible_GreatPersonPoints`, `GreatPersonVictoryTypeEntries`, `ExcludedGreatPersonClasses`, `Map_GreatPersonClasses`.

## The three-layer shape

1. **`GreatPersonClasses`** = the "profession" (one per civ). `UnitType` (civilian shell), `Name`, `IconString`, `ActionIcon`, `GenerateDuplicateIndividuals`. **Acquisition trigger columns** (this is how you EARN one — a fixed small set): `UniqueQuarterType` (Greece `QUARTER_ACROPOLIS`→Logios), OR `ConstructibleType` + `PopulationRequired` (Han: `BUILDING_PALACE` + `10`), OR `CityStatesSuzerained` (Siam Uparat `1`). Caps: `MaxPlayerInstances`, `Map_GreatPersonClasses.MaxWorldInstances`.
2. **`GreatPersonIndividuals`** = the named people (≈10 per class). `GreatPersonClassType`, `AgeType`, `UnitType` (each individual its own unit), `ActionCharges` (1 typical; `0` = passive; Keynes `99`), `ActionNameTextOverride` (usually `LOC_GREATPERSON_ACTION_NAME_RETIRE`), + a menu of **`ActionRequires*`** gate columns for where/when Retire can fire (`ActionRequiresCompletedDistrictType`, `ActionRequiresOwnedTile`, `ActionRequiresIncompleteWonder`, `ActionRequiresOnUnitType`, `ActionRequiresForeignHemisphere`, `ActionRequiresGoldCost`, …).
3. **`GreatPersonIndividualActionModifiers`** = individual → `ModifierId` + `AttachmentTargetType` (targets: `..._PLAYER`, `..._DISTRICT_IN_TILE`, `..._DISTRICT_WONDER_IN_TILE`, `..._UNIT_GREATPERSON`, `..._COMMANDER_IN_TILE`, `..._ARMY_IN_TILE`, `..._CITY_IN_TILE`).

## Effect / activation wiring

Abilities are **100% standard GameEffects `Modifier`s** — nothing special (`EFFECT_PLAYER_GRANT_GOLDEN_AGE`, `EFFECT_PLAYER_GRANT_YIELD` w/ `type="ScaleByGameSpeed"`, `EFFECT_PLAYER_GRANT_PROGRESSION`, `EFFECT_GRANT_UNIT_OF_CLASS_AND_APPLY_ABILITY`, `EFFECT_CITY_ADJUST_POPULATION`, …), and they may carry `<SubjectRequirements>`. **Flow:** meet the class trigger → the game *births* a named individual as a civilian unit → move it to a tile satisfying its `ActionRequires*` gates → use **Retire** → the modifier(s) apply to the chosen `AttachmentTargetType`, consuming a charge.

**Civ-lock is via the UNIT's `TraitType`** (in `units.xml`: `UNIT_TJATY … TraitType="TRAIT_EGYPT"`), NOT a class column — which is why Shi Dafu triggers on the universal `BUILDING_PALACE` yet only Han receive it. **For a civ-agnostic mod: give the great-person unit NO restrictive `TraitType`.** `ExcludedGreatPersonClasses(class, TraitType)` can additionally bar traits.

## Minimal worked example — a custom, civ-agnostic great person

Earned by owning mod building `BUILDING_MA_FORUM` at population ≥12; Retire in an owned Urban district → Golden Age.

```xml
<!-- data/mod-greatpeople.xml -->
<Database>
  <Types>
    <Row Type="GREAT_PERSON_CLASS_MA_STEWARD" Kind="KIND_GREAT_PERSON_CLASS"/>
    <Row Type="GREAT_PERSON_INDIVIDUAL_MA_STEWARD_ONE" Kind="KIND_GREAT_PERSON_INDIVIDUAL"/>
    <Row Type="UNIT_MA_STEWARD" Kind="KIND_UNIT"/><Row Type="UNIT_MA_STEWARD_ONE" Kind="KIND_UNIT"/>
  </Types>
  <Units>   <!-- civilian shells, NO TraitType => every civ -->
    <Row UnitType="UNIT_MA_STEWARD" Name="LOC_UNIT_MA_STEWARD_NAME" BaseMoves="3" BaseSightRange="1"
         Domain="DOMAIN_LAND" CoreClass="CORE_CLASS_CIVILIAN" FormationClass="FORMATION_CLASS_CIVILIAN"
         UnitMovementClass="UNIT_MOVEMENT_CLASS_FOOT" ZoneOfControl="false"
         CostProgressionModel="COST_PROGRESSION_PREVIOUS_COPIES" CostProgressionParam1="30"/>
    <Row UnitType="UNIT_MA_STEWARD_ONE" Name="LOC_GP_MA_STEWARD_ONE_NAME" BaseMoves="3" BaseSightRange="1"
         Domain="DOMAIN_LAND" CoreClass="CORE_CLASS_CIVILIAN" FormationClass="FORMATION_CLASS_CIVILIAN"
         UnitMovementClass="UNIT_MOVEMENT_CLASS_FOOT" ZoneOfControl="false" CanTrain="false" CanPurchase="false"
         CostProgressionModel="COST_PROGRESSION_PREVIOUS_COPIES" CostProgressionParam1="30"/>
  </Units>
  <TypeTags><Row Type="UNIT_MA_STEWARD_ONE" Tag="UNIT_CLASS_GREATPERSON"/></TypeTags>
  <GreatPersonClasses>
    <Row GreatPersonClassType="GREAT_PERSON_CLASS_MA_STEWARD" Name="LOC_UNIT_MA_STEWARD_NAME"
         UnitType="UNIT_MA_STEWARD" ConstructibleType="BUILDING_MA_FORUM" PopulationRequired="12"
         GenerateDuplicateIndividuals="true" IconString="unitflag_logios" ActionIcon="action_greatperson"/>
  </GreatPersonClasses>
  <GreatPersonIndividuals>
    <Row GreatPersonIndividualType="GREAT_PERSON_INDIVIDUAL_MA_STEWARD_ONE" Name="LOC_GP_MA_STEWARD_ONE_NAME"
         GreatPersonClassType="GREAT_PERSON_CLASS_MA_STEWARD" AgeType="AGE_ANTIQUITY" Gender="F"
         ActionCharges="1" ActionRequiresOwnedTile="true" ActionRequiresCompletedDistrictType="DISTRICT_URBAN"
         ActionNameTextOverride="LOC_GREATPERSON_ACTION_NAME_RETIRE" UnitType="UNIT_MA_STEWARD_ONE"/>
  </GreatPersonIndividuals>
  <GreatPersonIndividualActionModifiers>
    <Row GreatPersonIndividualType="GREAT_PERSON_INDIVIDUAL_MA_STEWARD_ONE" ModifierId="MA_STEWARD_GOLDEN_AGE"
         AttachmentTargetType="GREAT_PERSON_ACTION_ATTACHMENT_TARGET_PLAYER"/>
  </GreatPersonIndividualActionModifiers>
</Database>
```
```xml
<!-- data/mod-greatpeople-gameeffects.xml : GameEffects xmlns="GameEffects" -->
<Modifier id="MA_STEWARD_GOLDEN_AGE" collection="COLLECTION_OWNER" effect="EFFECT_PLAYER_GRANT_GOLDEN_AGE" run-once="true" permanent="true"/>
```
To instead **extend an existing** class, drop the `GreatPersonClasses`/`Units` blocks and add `GreatPersonIndividuals` + `GreatPersonIndividualActionModifiers` referencing e.g. `GREAT_PERSON_CLASS_TJATY`.

## Blockers / limits (the non-obvious ones)

1. **No `EFFECT_*GRANT_GREAT_PERSON`.** You CANNOT spawn a great person from a tradition, tree node, project, or narrative reward via a modifier (zero hits across Base). Acquisition must be one of the class-row trigger columns.
2. **Acquisition triggers are a fixed set:** `UniqueQuarterType` / `ConstructibleType`+`PopulationRequired` / `CityStatesSuzerained`. **⚠ Implication for a custom-tree mod:** a great person **cannot hang off a custom progression-tree node directly** — only off a mod-owned constructible/wonder + population threshold (or a suzerain count). Fits a building/wonder layer, not a civic-tree spine. 📦 A shipping Workshop civ (Austria `3769193947`) binds a class to an **IMPROVEMENT** via the same `ConstructibleType` column — plausible but base only proves building/quarter binding; NEEDS-LITMUS before relying on improvement-bound classes (see [custom-civilizations.md](custom-civilizations.md)).
3. **`Constructible_GreatPersonPoints`** (per-turn accrual) exists in schema but is **populated nowhere** in base/DLC — a points-recruitment route is UNTESTED, not a shipping path.
4. **Per-Age**, like everything else — individuals are scoped by `AgeType` and each Age resets.
5. The **Victory** class (Keynes) is engine-granted by the victory system — not a general acquisition route.

**Practical value:** modest for a custom-tree mod — the acquisition constraint (must key off a building/wonder, not a tree node) means it's not a drop-in tree reward. Best used if your mod adds a signature building/wonder that "graduates" a custom great person.
