# Narrative Events & Discovery Stories (data-moddable, incl. placing resources on UNOWNED plots)

Researched 2026-07-03 against installed 1.4.1 base data + the **official Dev Tools docs**
(`steamapps/common/Sid Meier's Civilization VII Development Tools/Documentation/Narrative Events.md`
— read it, it is the single best Firaxis modding doc) + the official example mod
`Development Tools/Examples/fxs-new-narrative-event/` (a complete custom discovery, plain
`UpdateDatabase`, no special action type). Everything below is data-only → shippable as a normal mod.

## Why this system matters for tile/resource work

**`EFFECT_PLOT_PLACE_RESOURCE` from `COLLECTION_NARRATIVE_STORY` places a resource on the story's
plot even when that plot is UNOWNED.** Base game does it 13× (AQ: silver 22003D, pearls 27008D,
wine 21002D, horses 21203D, gypsum 21005D, marble 21124D; EX: 7 more) — all discovery-story rewards
landing on wilderness discovery-site tiles. This bypasses the effect's owner restriction that applies
when it's driven from ordinary plot collections (litmus-proven: from `COLLECTION_PLAYER_PLOT_YIELDS`
it fires only on plots the attached player owns). The collection determines the privilege.

## Core model

A **NarrativeStory** = one node in a pop-up graph. A pop-up = parent story (supplies `StoryTitle` +
`Completion` body) + its child stories (each = one button, supplying `Name`/`Imperative`/`Description`),
linked via `NarrativeStory_Links` (From→To, Priority = button order; Name/Description on the link row
are required-but-unused — fill with the same LOC tags).

Tables (all in `<Database>`, plain UpdateDatabase):
- `Types` row `Kind="KIND_NARRATIVE_STORY"` per story.
- `NarrativeStories` — the story rows (columns below).
- `NarrativeStory_Links` — parent→child (button) edges.
- `NarrativeRewards` — NarrativeRewardType → ModifierID (one row per modifier; multiple modifiers =
  multiple reward types). Modifiers live in GameEffects XML as usual; use `permanent="true"`
  (and base uses `run-once="true"` for one-shot grants).
- `NarrativeStory_Rewards` — story → reward, `Activation="COMPLETE"` (when RequirementSetId met)
  or `"START"` (when activated). Base discovery choices grant B/C-button rewards at START and
  final-payoff D rewards at COMPLETE.
- `NarrativeRewardIcons` — button icons (yields, `UNIT`, `QUEST`, `CUSTOM`; `Negative="TRUE"` for red).
- `NarrativeStory_TextReplacements` — dynamic text: `NarrativeStoryTextType` BODY/REWARD/IMPERATIVE/
  OPTION + `NarrativeTextReplacementType` REWARD (auto-describes the reward modifier — many buttons'
  Description is just `{1_REWARD}.`), CAPITAL, CIVILIZATION, CIVILIZATION_ADJ, INDEPENDENT.
- `NarrativeStoryOverrides` — "this specific story takes precedence over that generic one"
  (every specific discovery story overrides `DISCOVERY_BASE`).
- `NarrativeStory_Queues` (base `narrative-sifting.xml`) — queue defs. Discovery queues have
  `ActivationCount=0` (uncapped); normal thematic groups (`NARRATIVE_GROUP_WONDER` etc.) mostly 2/age.

## Key NarrativeStories columns (from all 4657 base rows + official doc)

- `Activation`: `AUTO` (initial discovery events), `REQUISITE` (initial standard events — activates
  when `ActivationRequirementSetId` passes), `LINKED` (child/button), `LINKED_REQUISITE` (button shown
  only if its ActivationRequirementSet passes at pop-up time), `UNLOCKED` (follow-up unlocked by an
  earlier choice), rare: `LINKED_SUBJECT_REQUISITE`, `UNLOCKED_OPPONENT`, `INDEPENDENT_GIFT`, `FAILURE`.
- `ActivationRequirementSetId` (optional) — **eligibility, checked ONCE at story init; failures are
  archived and never shown** (official doc). This is where a tall gate / civ gate / tech gate goes.
  Ignored by plain `LINKED`.
- `RequirementSetId` — **completion check, polled continuously after init**; pop-up fires on
  completion. `Met` = no check. Discovery A-stories use `REQSET_DISCOVERY_BASE_NARRATIVE`
  (= single `REQUIREMENT_PLAYER_TRIGGERED_DISCOVERY`).
- ⚠⚠ **"Fire a story when the player achieves X" puts X in `RequirementSetId` (polled), NEVER in
  `ActivationRequirementSetId` (checked once at init → story silently archived if X isn't already
  true at game start).** Field-proven the hard way (E&I mod, 2026-08-01): 16 REQUISITE stories with
  the achievement in the activation set and `RequirementSetId="Met"` — every one archived at init,
  zero pop-ups ever, no log errors. Wrong-way-round encodes fail SILENTLY. (That mod ultimately
  shipped the achievement watch as direct always-attached modifiers with `SubjectRequirements`
  + run-once + an `EFFECT_ATTACH_MODIFIERS` wrapper, with a UI-script pop-up — also a valid route,
  and immune to story queue caps.)
- **⭐ THE POLLED SET IS THE ESCAPE HATCH FOR "TABLE-FORM-ONLY" REQUIREMENTS.** Some requirements
  appear in the shipped data **only inside `<RequirementSet>` rows** and never in a live `<Modifier>`
  — and several of those are **inert when written inline** in `SubjectRequirements`: no error, no log
  line, the condition simply never passes. Both halves are now proven in-game (E&I, 2026-08-06):
  `REQUIREMENT_PLAYER_HAS_X_SETTLEMENTS_AT` stayed dark inline on a settlement that plainly
  qualified, while `REQUIREMENT_PLAYER_RAZED_X_CITIES` **fired correctly** from a hidden story's
  polled `RequirementSetId`. `REQUIREMENT_PLAYER_AT_PEACE_X_TURNS_AGO` (one shipped use, in a
  narrative set) failed inline the same way.
  **So the check is cheap and worth doing before you encode:** grep the requirement in the base data
  and see whether *any* use sits inside a `<Modifier>`. If every use is in a `RequirementSet`, do not
  write it inline — deliver it through a hidden story whose `RequirementSetId` carries it, exactly
  the context the base game uses.
  Two rules for that route: the marker/boost modifiers it rewards must carry **no inline
  requirements of their own** (the condition belongs in the polled set; inline ones double-gate it
  silently), and **verify the story is ACTIVE, not archived**, before trusting a null result —
  `player.Stories.getActiveIds()` / `getNumArchived()` + `getArchived(i)`, resolving each id via
  `Stories.find(id)` → `GameInfo.NarrativeStories.lookup(story.type)`. An archived story is the
  wrong-way-round failure above and no amount of playing will fire it.
- `Age` — story belongs to one Age.
- `UIActivation` — pop-up skin: STANDARD, DISCOVERY, 3DPANEL, CRISIS, LIGHT, SYSTEMIC, CINEMATIC.
- `Queue` — for discovery stories: which landmark + likelihood tier (see Discoveries below).
- `FirstOnly="TRUE"` — once per game (all base resource-placing discovery stories set it).
- `AllowDuplicates="TRUE"` — 74 base uses; the repeatability lever (dark-age + tot stories).
- `StartEveryone`, `ForceChoice` — set TRUE on initial discovery events (official recipe).
- `IsQuest` + `Imperative` + `ShowProgress` + `Timeout`/`EndTurn` — quest-style buttons with turn limits.
- `Cost`/`CostYield` — button that charges (e.g. 50 gold "pay the locals" options).
- `ResourceReq` — on the 6 AQ resource A-stories, paired 1:1 with the resource the D-step places
  (wine story has `ResourceReq="RESOURCE_WINE"`…). Inferred (not doc'd): eligibility filter "this
  resource must be placeable at/near the site". Keep it matched to the placed resource.
- `Hidden="TRUE"` — no pop-up of its own (used on B/C middle steps).

## Story location = where the trigger happened (this is the plot COLLECTION_NARRATIVE_STORY yields)

- **Discovery stories**: anchored to the investigated discovery-site tile. That's how base resource
  placement hits unowned wilderness.
- **REQUISITE stories completed by a gossip**: anchored to the gossip's location — base precedent
  `12A` (age-modern): completion = `GOSSIP_CONQUER_CITY` of your Mughal capital; reward =
  `COLLECTION_NARRATIVE_STORY` + `EFFECT_PLAYER_GRANT_UNIT_AT_PLOT` → 3 Sepoys spawn at that city's
  plot. (No base example pairs a gossip-anchored story with PLOT_PLACE_RESOURCE — plausible, untested.)
- The official doc's gossip appendix lists **per-gossip "Has Location?"**. Notable located gossips:
  `GOSSIP_UNIT_USES_ABILITY_CHARGE` (params UnitType, Ability — the Surveyor's ABILITY_CLAIM_RESOURCE
  emits this on every claim → post-claim reward chains are easy), GOSSIP_GATHER_RESOURCE (the improved
  resource's plot), GOSSIP_FOUND_CITY, GOSSIP_CONSTRUCT_BUILDING, GOSSIP_UNIT_DESTROYED, etc.
- **✅ GOSSIP_CONSTRUCT_BUILDING — three facts proven in-game 2026-08-02 (E&I Guilds deed):**
  1. **PURCHASING a building fires the construct gossip**, exactly like producing one. A
     gold-purchased Bazaar tripped the deed. Do not assume event-counted construction deeds
     require production — they don't, and a purchase-heavy player earns them just the same.
  2. A `Numeric` payload filter works and compares against the **summed** adjacency, not a
     single source: `Hash,ConstructibleType,BUILDING_BAZAAR,Numeric,AdjacencyBonus,3` fired on a
     Bazaar drawing +3 from three adjacent Coast tiles alone.
  3. ⚠️ **Resource tiles use a DIFFERENT ConstructibleType.** Four improvements ship a
     `_RESOURCE` twin — `IMPROVEMENT_WOODCUTTER_RESOURCE`, `_MINE_RESOURCE`,
     `_CLAY_PIT_RESOURCE`, `_FISHING_BOAT_RESOURCE` — created when the tile carries a resource
     (`Constructible_ValidResources` maps e.g. RESOURCE_SPICES → WOODCUTTER_RESOURCE). They
     display under the base name in the tooltip, so this is invisible in play. Farm, Pasture,
     Camp, Plantation and Quarry have no twin. Any `Hash,ConstructibleType,IMPROVEMENT_X` filter
     must list BOTH ids or it silently misses every resource tile.
- **⚠️⚠️ NEVER filter a train event on `UnitType` ALONE — it silently excludes every civ whose
  UNIQUE replaces that unit.** Found in play 2026-08-02: a deed asking for a Slinger could not be
  earned by the Han, whose Nu *replaces* the Slinger — those players cannot build the base unit at
  all, so the deed was invisible-impossible for them. This is not a rare edge: `UNIT_SLINGER` has
  **5** replacements shipped (Burning Arrow, Hulche, Hwarang, Nu, Yumi), `UNIT_WARRIOR` has 2
  (Hoplite, Medjay), `UNIT_CROSSBOWMAN` has 2 (Keshig, Waraq'aq). Check
  `<Row ... ReplacesUnitType="UNIT_X"/>` before naming any unit in a deed.
  **The fix**: the train event also carries **`UnitTypeReplaces`**, which matches a unique *by the
  unit it replaces* (shipped precedent: `Hash,UnitTypeReplaces,UNIT_WARRIOR`). List both forms.
  Because base and unique are mutually exclusive for any one civ, `Amount` counting stays correct:
  4 slots (2 units × base/replacement) with `Amount=2` reads "one of each unit, whichever form this
  civ builds". For a `DuplicateCount` deed ("train 3 of X"), do NOT add slots — `DuplicateCount` is
  documented for a SINGLE gossip type; give the unique path its own modifier writing the same
  property, since only one path can ever fire.
  Better still where it fits: use a **class flag** (`CavalryUnit`, `InfantryUnit`) and the whole
  problem disappears, since a unique keeps its class.
- **✅ GOSSIP_TRAIN_UNIT carries UNIT-CLASS flags, not just UnitType** (proven in-game 2026-08-02):
  `Hash,CavalryUnit,True` counted any cavalry unit regardless of its specific type, so a deed can
  say "train 3 Cavalry" without enumerating every unit id per civ.
- **`GOSSIP_UNIT_COMBAT_DEATH` is the richest payload in the game.** ⚠️ CORRECTED 2026-08-02 — an
  earlier version of this note wrongly claimed the kill gossip carried no class flags. Verified list:
  `OtherPlayer` · `AtWar` · `CombatType` · `DomainType` / `KillingDomainType` · `KillingUnitType` ·
  `KillingDamage` · `KillingUnitKillCount` · `KillingUnitInCommandRadius` · `IsKillingUnitInfantry` ·
  `IsKillingUnitPlotOwner` · `IsKillingUnitForeignHemisphere` · `DyingUnitType` · `DyingUnitLevel` ·
  `DyingCivilization` · `DyingLeader` · `DyingWarSupport` · `IsDyingMinorPlayer` ·
  `IsDyingUnitCommander` · `IsDyingUnitInfantry/Cavalry/Ranged/Siege` · `IsDyingUnitStronger` ·
  `IsDyingUnitFaster` · `IsDyingUnitWalled` · `IsDyingUnitPlotOwner` · `IsDyingUnitInCommandRadius` ·
  `IsDyingUnitForeignHemisphere` · `BiomeType`.
  Design consequences: **`IsDyingMinorPlayer`** separates Independent kills from major-civ kills, so
  two combat deeds in one Age need not nest; **`IsDyingUnitStronger`** expresses "beat something
  tougher than you" without naming a unit; `KillingUnitInCommandRadius` expresses fighting under a
  Commander. ⚠️ But there is **no `KillingUnitTypeReplaces`** — the killer side has no unique-unit
  escape hatch, so a killer-type filter must enumerate the uniques (base data does exactly that:
  `UNIT_IMMORTAL` + `UNIT_IMMORTAL_2`). Prefer `IsKillingUnitInfantry` or a dying-side flag instead.
  `KillingUnitKillCount` is a hidden per-unit tally used only by narrative stories — units do NOT
  level in Civ 7, so do not present it to players as veterancy.
  When counting *distinct kinds* of thing this way, remember `Amount` counts **matched slots**,
  not distinct concepts — listing a base id and its `_RESOURCE` twin makes one logical type
  score twice. Count logical types with one run-once marker each instead.
- `REQUIREMENT_PLAYER_HAS_AT_LEAST_NUM_GOSSIPS` is the narrative workhorse requirement; supports
  per-gossip param filters (`Hash,UnitType,UNIT_X,Hash,Ability,ABILITY_Y`), `DuplicateCount`,
  **The numbered-suffix convention (verified vs shipped data 2026-07-31):** the `01`/`02`
  suffixes seen in shipped requirements (`GOSSIP_CITY_RAZED01`) are NOT distinct gossip
  types — the gossip row is plain `GOSSIP_CITY_RAZED`; the suffix exists only as the
  *argument key* inside this requirement, letting one requirement reference several
  parameterized instances: `<Argument name="GossipTypes">GOSSIP_CITY_RAZED01</Argument>`
  paired with `<Argument name="GOSSIP_CITY_RAZED01">Hash,OtherPlayer,Other</Argument>`
  (razed-gossip payload fields: `OtherPlayer` Self/Other, `IsForeignHemisphere`). Two
  corollaries proven by exhaustive shipped-data search: a `COLLECTION_NARRATIVE_STORY`
  reward modifier carries **no scoping requirement** (scoping is purely by ID reference
  through `NarrativeRewards`/`NarrativeStory_Rewards` — there is no
  `REQUIREMENT_NARRATIVE_STORY_TYPE_MATCHES`, don't invent it); and **no shipped story
  re-fires per triggering event** — the razed-gossip precedent (9009A) activates once at
  a count threshold and grants a permanent modifier once. Treat any "fires again on each
  raze/event" design as unproven until litmus-tested.
  `Distance` (two gossips within N tiles of each other), **`AfterInit=True`** (only count gossips
  after story init — essential for repeatable stories so each instance waits for a NEW event),
  `AfterTurn`, `TurnWindow`, `OrderedTurnWindow`.

## Discoveries (the "goody hut" subset) — full custom recipe (official, example-mod-verified)

1. A-story: `Activation="AUTO"`, `UIActivation="DISCOVERY"`, `StartEveryone`/`FirstOnly`/`ForceChoice`
   TRUE, `RequirementSetId="REQSET_DISCOVERY_BASE_NARRATIVE"`, pick a `Queue`.
2. `NarrativeStoryOverrides` row overriding `DISCOVERY_BASE` (else the generic fallback wins).
3. Assign predefined `DISCOVERY_BASE_REWARD` at COMPLETE — that's what removes the landmark tile.
4. Children as normal LINKED stories (UIActivation DISCOVERY), rewards/icons as usual.

Queue = landmark type × tier: `NARRATIVE_GROUP_DISCOVERY_<CAVE|RUINS|CAMPFIRE|TENTS|PLAZA|CAIRN|RICH|
WRECKAGE|COAST|SHIPWRECK>_<BASIC|INVESTIGATION|MYTHIC>` (+GROVE). BASIC = walk-on trigger;
INVESTIGATION = the unit "Investigate" action (base resource-placing stories all live here);
MYTHIC = the rare tier. `DiscoverySiftingImprovements` maps queue↔`IMPROVEMENT_*`.

**Where discovery sites are**: map-gen only (`base-standard/maps/discovery-generator.js`) — Poisson
scatter (avg spacing 5), skips owned plots and anything closer than
`g_RequiredDistanceFromMajorForDiscoveries = 3` tiles to a major start. So sites naturally sit in
**rings 3–6 of the capital** — the ring-4/5 band. No effect spawns them later (only
`EFFECT_PLOT_DESTROY_DISCOVERY` exists); Exploration age seeds its own fresh batch.

## The ring-4/5 chain (a shelved, engine-blocked example)

> **Status:** a feature built on this was SHELVED (`blocked`): runtime-story seeds are
> claim-invisible (see the delivery-dependence block below), and the claimable alternative
> (discovery sites) is map-random — unusable under a strict 1-settlement footprint. Everything
> below remains VALID ENGINE REFERENCE for other mods/uses; just don't read it as an active plan.

Custom tall-gated **discovery-investigation** story per age: A-story in the INVESTIGATION queues with
`ActivationRequirementSetId` = tall gate (settlement count / tech-node MinDepth), `ResourceReq` +
D-step `COLLECTION_NARRATIVE_STORY` + `EFFECT_PLOT_PLACE_RESOURCE` (clone the DISCOVERY_21002 wine
chain) → resource appears ON the investigated site (unowned, rings 3–6) → a claim unit (a Surveyor-style
Prospector) claims it (self-improves, per-resource amplifiers apply). Repeatability: drop `FirstOnly`, set
`AllowDuplicates="TRUE"` (semantics across multiple sites untested — litmus first).

**✅ VERIFIED IN-GAME 2026-07-03 (litmus mod story-seed-test v5/v6):**
- Modded stories enter the discovery draw and win site bindings; a custom story placed WINE on an
  unowned FLAT TUNDRA plot (placement validator is looser than natural map-gen terrain rules).
- **Discovery stories are BOUND to specific map sites at game creation, NOT drawn per-trigger** —
  each landmark's story is predetermined. Debug bindings via FireTuner (Tuner ctx):
  `Players.get(0).Stories` → `getActiveIds()` / `find(id)` → `{type,state}` /
  `getStoryPlotCoord(id)` (= the bound site tile) / `getArchived(i)` + `getNumArchived()` /
  `getStoryStateName(i)` (1 Disabled, 2 Active, 4 RequirementsMet, 5 Complete, 6 Discarded,
  7 Suppressed, 8 Failed).
- `ActivationRequirementSetId` IS honored on AUTO/discovery stories (tall-gated chain fired at 1 city).
- **Gossip-completed REQUISITE stories anchor COLLECTION_NARRATIVE_STORY to the GOSSIP's plot**:
  story completed by `GOSSIP_UNIT_USES_ABILITY_CHARGE` (`Hash,UnitType,<unit>` + `AfterInit=True`)
  spawned a unit via EFFECT_PLAYER_GRANT_UNIT_AT_PLOT exactly where the charge was used. This is the
  player-aimed delivery mechanism: located gossip → story at that tile → place/spawn there.
- ⚠ **Never leave a discovery queue with ZERO stories** — muting all base stories out of every
  discovery queue crashed the game at map generation (site binding against an empty queue is a
  native crash path). Mute/replace only queues you refill.
- `MapConstructibles.addDiscovery` exists in the gameplay context but always returns false at
  runtime — it is map-gen-only; you cannot spawn discovery sites mid-game.

**❌ DISPROVEN IN-GAME 2026-07-03 (pioneer-litmus v1): UNLOCKED-by-predecessor does NOT sequence
same-trigger stories.** A chain of `UNLOCKED` stories (armed via `NarrativeStory_Links` from the
predecessor, base 3243D→3243A shape) all completed in a burst off the FIRST trigger gossip —
`AfterInit=True` did not hold the follow-ups back through the unlock (each unlocked story saw the
already-fired gossip and completed instantly, cascading the whole chain). UNLOCKED is fine for
*different-trigger* follow-ups (its base use); do not use it to meter repeats of the same event.
**The COUNT LADDER (`AfterInit=True` + `DuplicateCount=K`, 32 base precedents) sequences
correctly but is ALSO unusable for aimed placements (pioneer-litmus v2, in-game 2026-07-03):**
one popup per event in the right order, **but the story plot anchors ERRATICALLY for K>1** —
observed K=2 anchoring to gossip #1's tile, K=3 anchoring correctly, K=4 anchoring to gossip
#3's tile. Fine for ladders whose rewards don't care about the plot; never pair K>1 with
`COLLECTION_NARRATIVE_STORY` plot-targeted effects.
**The reliable player-aimed shape = ONE story per TRIGGER FILTER, count=1 + `AfterInit`**
(anchored to the correct gossip tile in every test: pioneer-litmus v2 step 1, probe v2 scout
disband, story-seed v6 Surveyor charge). To meter N repeats per age, use N distinct trigger
filters (e.g. N different UnitTypes, one story each) instead of counting one trigger.
**Also proven (pioneer-litmus v2): `EFFECT_PLOT_PLACE_RESOURCE` REPLACES a resource previously
seeded on that plot** (Wine→Wool, Gypsum→Hides observed) — "no-op on occupied tiles" is false
at least for story-seeded resources; behavior on NATURAL resources still unverified.

**⚠ CLAIMABILITY OF SEEDED RESOURCES DEPENDS ON THE DELIVERY (both in-game 2026-07-03):**
- ❌ **GOSSIP-ANCHORED (disband) story seeds are INVISIBLE to the Prospector/Surveyor CLAIM**
  (`UNITCOMMAND_CLAIM_RESOURCE`): terrain-valid, in-range seeds were skipped by the claim's
  target highlighter while natural claims worked in the same save (pioneer-litmus v3). The seed
  renders and shows yields but the native claim validity doesn't see it.
- ✅ **DISCOVERY-story seeds ARE claimable and register FULLY**: a custom tall-gated
  INVESTIGATION story (story-seed-test Cairn→Wine, `ResourceReq` set) seeded the site, the
  Surveyor claim lit up and completed — tile joined territory, auto-improved, and the resource
  appeared as a slotted EMPIRE resource with origin. Post-claim gossip-triggered follow-up
  story also fired.
- **Differentiator RESOLVED (pioneer-litmus v5/run 6, in-game 2026-07-03): the discovery-SITE
  MACHINERY, definitively — `ResourceReq` confers NOTHING.** Gossip-anchored disband stories
  WITH `ResourceReq` seeded correctly (Wine on flat grassland, Horses) and their seeds were
  still claim-invisible. Consequence: **claimable seeding exists ONLY through discovery-queue
  stories bound to map-gen sites; no runtime (gossip/REQUISITE) story can produce a claimable
  resource, and nothing bolts on to fix it.** Side-facts from the same run: `ResourceReq` does
  NOT break/archive a site-less REQUISITE story (both fired normally); and
  `EFFECT_CITY_ADD_RESOURCE_TO_PLOT` as a story reward accepted an ordinary CITY-class resource
  (Gypsum → landed in the city) but an EMPIRE-class one (Marble) never appeared — all 3 base
  gift resources are CITY class, so treat the effect as CITY-class-proven only.
Alternative claim-independent grant: `EFFECT_CITY_ADD_RESOURCE_TO_PLOT` (city-scoped suzerain
gift mechanism — lands on an owned capital plot, improves, slots; city-scoped modifiers are
precedented as story rewards, 238 uses in AQ narrative gameeffects; acceptance of ordinary
map resources untested).

**Also verified 2026-07-03 (pioneer-litmus v1):** a tall-gated REQUISITE gossip story renders a
3-button choice menu (LINKED children, rewards at START) on a STANDARD popup; and the base
disband story "It's Not Goodbye" fires alongside a custom disband-triggered story on the SAME
disband and grants +100 Happiness toward Celebration — a custom disband feature should override
it (`NarrativeStoryOverrides`) to avoid the double pop-up and the freebie.

**Still untested:** AllowDuplicates re-instantiation after a story completes (multiple simultaneous
instances of *different* chains work); exact ResourceReq semantics; placing a resource on a plot
that already has one (assume no-op — pick empty target tiles).

## Quests & data-driven progression (probed in-game 2026-07-05, `gen2-litmus`)

A full Civ-6-boost-style "do a deed → pop-up → reward" loop, incl. a choice pop-up, is buildable
data-only. All confirmed in a new Antiquity game (logs: `NarrativeStories.log`, `Balance_Identity.csv`).

- **Quest UI** — a `NarrativeStories` row with `IsQuest="TRUE"` + `Imperative="LOC_..."` +
  `ShowProgress="TRUE"` renders as a tracked **Journal quest** with the imperative text AND a live
  **progress counter (e.g. 0/3)** — and the counter renders for an ordinary **state-count completion
  requirement** (e.g. `REQUIREMENT_PLAYER_HAS_AT_LEAST_NUM_MILITARY_UNITS Amount=3`), not just gossip
  ladders. Model exactly on the base **1A→1C** chain.
- **Choice pop-up** — a `REQUISITE` opener (`UIActivation="STANDARD"`) with two `LINKED` children
  (via `NarrativeStory_Links`, `Priority` = button order) renders a **two-button choice menu** on
  completion; each child can itself be an `IsQuest`. `ForceChoice` is NOT required for the buttons to
  appear (base 1A omits it) and the pick logs as a `CHOOSE_NARRATIVE_STORY_DIRECTION` player op. This
  is the pantheon-style fork mechanic, data-only.
- **Instant completion for the opener** — `RequirementSetId="Met"` completes a REQUISITE story the
  turn it activates (pops the menu immediately); gate *who gets it* with `ActivationRequirementSetId`.
- **AI-noise gate** — `ActivationRequirementSetId` = a set containing `REQUIREMENT_PLAYER_IS_HUMAN`
  restricts the whole chain to the human (confirmed: `NarrativeStories.log` showed only "Player 0";
  no AI pop-ups/spam). Use this for any human-only quest UI.
- **Reward = a modifier granted on COMPLETE** (or START) via `NarrativeRewards` + `NarrativeStory_Rewards`.
  A story can carry **multiple** reward modifiers (one `NarrativeStory_Rewards` row each). Confirmed
  reward effects (both fired, logged "applied reward"):
  - **`EFFECT_PLAYER_ATTRIBUTE`** (`COLLECTION_OWNER`, `AttributeType` + `Amount`, `run-once`,
    `permanent`) grants a **spendable leader attribute point** — clone of base `4C_NARRATIVE_MODIFIER`.
    The point lands in the attribute-spend UI (`Balance_Identity.csv`: "Add points from source: <mod>").
    This is the proven "quest → player-chosen currency" loop (a data-only pantheon-choice substrate).
  - **`EFFECT_PLAYER_PROPERTY`** (`Key`/`Value`/`Operation`, **`SET` works**, not just base's `CHANGE`)
    writes a player property that is then **JS-readable** via `Players.get(pid).getProperty("<Key>")`
    (returned the set value; unset keys read `null`) — the substrate for dashboard accumulator meters.
    ⚠ **BUT** `EFFECT_PLAYER_ADJUST_YIELD_PER_PROPERTY_VALUE` does **NOT** read an arbitrary mod-set
    `Key` (no yield appeared with the property at 7) — that reader only sees engine-maintained totals
    (`PROPERTY_ANTIQUITY_TRADE_ROUTE_TOTAL` etc.). So "counter → +N yield, data-only" is unavailable for
    mod counters; turn a counter into power via attribute points or discrete `REQUIREMENT_PLAYER_HAS_X_*`
    tiers, and use the counter itself only for display + milestone gating.
- **`RequirementSet` omits `type`** — `TEST_ALL` is the default (all requirements must pass); only
  `type="REQUIREMENTSET_TEST_ANY"` is ever explicit in base. Don't author `type="REQUIREMENTSET_TEST_ALL"`
  (that id doesn't appear in base data; a bare set is the proven form).
