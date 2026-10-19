# Game-systems reference (how Civ VII actually plays)

Modding-oriented quick reference to the game's **runtime mechanics and magic
numbers** — settlement/growth math, adjacency rules, combat, diplomacy, ages/crises,
religion/ideology. Use it to design mods that *fit* the real systems and to sanity-check
balance (e.g. "is +5 Food per turn a lot?" — compare against the growth cost curve
below).

**Provenance & how to trust these numbers.** Most of this is distilled from two
community Civilopedia mods — **Orion's Civilopedia+** and **Better Civpedia** (public
Steam Workshop) — which document behavior the base Civilopedia leaves vague. Crucially,
**most of these precise values live in the engine, not in moddable data tables** (there
is no GlobalParameter row for the growth constants, combat modifiers, or relationship
point deltas — confirmed by grepping `Base/modules`). That's exactly why this reference
is useful: the numbers aren't grep-able. But it also means:

- Treat every specific number as **community-documented, patch-versioned** — correct as
  of mid-2026, but **spot-check before balance-critical use** (Firaxis retunes).
- A few categories **are** data-backed and you should verify those against the install:
  building **adjacency yield-types** (Adjacency tables), **settlement-cap sources** and
  **specialist-cap sources** (tech/civic unlocks + `EFFECT_*`), resource capacity
  (buildings/wonders). Cross-refs to the data-side references are noted inline.
- This describes the **base game** (all three Ages). DLC/leaders add exceptions.

---

## Settlements, population & the tall/wide math

The most tall-mod-relevant section. Pairs with
[yield-and-balance-design.md](yield-and-balance-design.md) (the design *language*) — this
is the underlying *arithmetic*.

**Settlement Limit** (the soft cap; the thing a tall / one-city mod fights):
- Base limit **3 / 8 / 16** for Antiquity / Exploration / Modern.
- **Over the limit → −5 Happiness in *every* settlement.** Unhappiness then bites yields:
  **−5% yields per point of Unhappiness, capped at −80%.** This is the mechanism that
  makes going wide-past-cap self-limiting.
- **No benefit to being *under* the cap** (except the Qajar civ). At Age start, if you're
  below the cap you're raised to it; if above, some cap-granting unlocks can re-apply.
- Cap increases come from specific techs/civics/wonders/city-state bonuses per Age (data-
  backed — grep unlocks + `EFFECT_PLAYER_ADJUST_SETTLEMENT_CAP`), plus **Expansionist
  Attribute T5** and **Militaristic Attribute T3** (all-Age), and **most unique civic
  trees grant +1**.

**Population growth cost curve** (engine-side; the key balance yardstick):
- Food for the next Growth Event: **Food = x + y·G + z·G²**, where G = the growth-event
  number and (x, y, z) = **(5, 20, 4)** Antiquity / **(30, 50, 5)** Exploration /
  **(60, 60, 6)** Modern. Quadratic → each pop costs meaningfully more than the last.
- **Only Rural Population and Specialists** (pop created by Growth Events) count toward
  the growth-cost G. **Urban population from Buildings does NOT** raise the growth cost
  (nor do Wonders add population). So a "+Food" bonus is worth far more early (low G) than
  late — factor this when scaling a food reward by Age.

**Population types:** Rural (improvements on tiles, from growth/Migrants) · Urban (placing
Buildings; Walls and Wonders do *not* add pop) · Specialists (growth events, or
reassigning a rural pop when you overbuild an improvement with a Building).

**Resource Capacity** defaults: **Capital 4, City 2, Town 1** (raised by markets, ports,
wonders, Economic-attribute tiers, etc.).

**Great Work slots:** Capital **1** by default, all other settlements **0**; buildings add
slots but lose them next Age, wonders' slots are Ageless.

**The Capital's extra perks** (beyond a normal City): Palace gives **+2 per Age** more
Food/Production/Happiness than a City Hall; **+1 Science & +1 Culture adjacency for
Quarters**; 4 (not 2) Resource Capacity; the 1 Great Work slot; goody-hut yields tend to
route here; some city-state bonuses give the Capital +1 pop. The **first Rail Station**
(full-tile, Modern) must go in the Capital.

**Cities vs Towns:**
- **Towns convert ALL their Production into Gold.** Once given a **Focus** (available at
  **7 total Population**), a Town also sends its **Food to connected Cities**.
- Upgrading Town→City raises the cost of the *next* upgrade, and **each City adds +10% to
  the Production cost of all non-Warehouse Buildings empire-wide** (see cost scaling
  below). This is the built-in brake on going wide with Cities — directly relevant to any
  tall-incentive mod.
- Town **Focus roll-in** details (which focus = which yield lever) are in
  [town-specialization-rollin.md](town-specialization-rollin.md); the in-game focus
  names are in [display-names.md](display-names.md).

---

## Buildings, adjacency & improvements

**Adjacency by building yield-type** (data-backed via Adjacency tables — this is the map
a yield mod should respect so its buildings feel native):
- **Culture & Happiness** buildings ← **Mountains, Natural Wonders** (*a NW that is also a
  Mountain counts double*). This is why appeal / mountain / natural-wonder yield bonuses fit here — see
  [gameeffects.md](gameeffects.md) Appeal/adjacency section.
- **Science & Production** buildings ← **Resources**.
- **Gold & Food** buildings ← **Navigable Rivers, Lakes, Coast** (**not Ocean**).
- **Wonders give an adjacency to *all* buildings** — except Factories and Full-Tile
  buildings in the Modern Age.
- **Specialists** add **+1 to *every* adjacency of the buildings on their District**
  (this is the post-1.4 specialist model — they are pure adjacency multipliers with no
  base yield; see also [gameeffects.md](gameeffects.md)).

**⭐ THE PAIRING COROLLARY (apply this whenever design touches "which
buildings go together"):** two buildings on one tile share the same six neighbors, so
buildings complement when their adjacency families MATCH — one great location then feeds
both, and neither wastes the spot. The canonical foundational pairs, straight from the
per-Age `Constructible_Adjacencies` tables:
- **Waterfront pairs** (Coast/River family): AQ Market + Garden · EX Guildhall/Bazaar/Bank +
  Tavern/Wharf · MO Port/Stock Exchange + Cannery/Tenement.
- **Resource pairs**: AQ Library/Academy + Barracks/Blacksmith · EX Observatory/University +
  Dungeon/Armorer · MO Schoolhouse/Laboratory + Factory/Military Academy.
- **Beauty pairs** (Mountain/NW/Wonder family): AQ Monument/Amphitheater + Arena/Villa/Altar ·
  EX Kiln/Pavilion + Temple/Menagerie · MO Museum/Opera House + **Department Store**/Radio
  Station (⚠ the Department Store reads "commerce" but is a Happiness building → beauty-facing,
  NOT waterfront).
Cross-LANE but same-FAMILY pairs are what a good player actually co-sites — design content
(deeds, feats, adjacency rewards) around those, never around thematic pairs from different
families (a Guildhall+Kiln "pair" fights for different tiles). Wonders please every building,
so wonder-adjacency is the universal sweetener.

**Warehouse buildings** have **no adjacency**; instead they push a flat yield onto
matching **Improvements** (e.g. Granary +1 Food on Farms/Pastures/Plantations; Brickyard
+1 Production on Clay Pits/Mines/Quarries). They still count as Food/Production buildings
for other bonuses. Warehouse delivery is the `TerrainInCity` / improvement-targeting route
in [gameeffects.md](gameeffects.md).

**Diplomacy buildings** carry a flat **Influence** yield (Monument +1, Villa +3, Guildhall
+6, Radio Station +9…) and keep giving Influence even when their adjacency goes obsolete —
the "park an old Diplomacy building on a junk tile" trick.

**Building cost scaling** (engine-side; the wide-tax): **+10% Production cost per City
(empire-wide) and +5% per Building already in that settlement** — **except Production and
Warehouse buildings, which are exempt** (and are not themselves counted). Gold purchase
cost = **3× the Production cost**.

**Quarters & Districts:** a **Quarter** = a tile with **2 Buildings of the current Age (or
Ageless)**. Urban Districts can only be placed **adjacent to another Urban District** (or
"hop" over a Wonder that is itself adjacent to one). On Age transition many tiles stop
being Quarters (their buildings went obsolete) — see
[constructibles.md](constructibles.md) for the Ageless/obsolete lifecycle.

---

## Combat & the military layer

Base **unit strength** is tiered and Age-scaled: **each Unit Tier = +5 base Strength over
the previous**, and each Age's Tier-2 baseline steps up (Infantry melee ≈ **25 / 40 / 55**
for AQ/EX/MO Tier-2; Tier-1 = −5, Tier-3 = +5). Three damage types — **Melee** (adjacent,
both take damage, enables Flanking) · **Ranged** (no return damage, blocked by Vegetation)
· **Bombard** (vs Walls). Three domains — Land / Naval / Air (Land can Embark but is weak
and can't attack except Amphibious melee).

**Strength modifiers** (all in `NAR_REW_COMBAT` points; these stack unless noted):
- **Damaged**: −1 per 10 HP lost.
- **Fortify**: +5 defending (temporary fortifications).
- **Terrain**: −2 attacking-from/defending-in River; −10 Amphibious attack; +3 defending
  in Rough; +2 in dense Vegetation.
- **Flanking** (needs Military Training in AQ, free after): +2 adjacent-to-front, +3
  adjacent-to-rear, +5 rear.
- **Strategic resources**: **+1 per matching Empire Resource, max +6** (Iron→melee,
  Horses→cavalry, Niter→siege, Oil→naval/cavalry, etc., by Age).
- **Tech/Civic masteries**: +3 each (e.g. Bronze Working→Infantry).
- **War Weariness**: −1 per point (see below).
- **Commander auras**: various, and **do NOT stack** across two commanders (except Zeal).
- **Difficulty**: AI/Independent power get a flat combat delta by difficulty (Deity =
  **AI +8**, Independents +0).

**War Support / War Weariness** (the war-happiness system):
- Declaring war grants **War Support** based on relationship: a **Formal War** needs
  **Hostile** relations (no bonus support to the defender); at friendlier levels it's a
  **Surprise War** and the *defender* gets support (Helpful 5 → Neutral 3 → Unfriendly 2).
- The side with **less** War Support suffers **War Weariness = (enemy support − own
  support)**, capped at 20, giving **−1 Combat Strength per point** vs that opponent **and**
  a Happiness penalty (−3 to −7 per point depending on who founded the settlement,
  **worsening −2 per Age**). Only the worst war counts — multiple wars don't multiply the
  happiness hit.

**Healing** per turn by tile ownership: Settlement Centre +20, Friendly +15, Neutral +10,
Hostile +5. **Pillaging** an Improvement heals +30; pillaging a Building yields
Culture/Science/Gold by building type, scaling by Age (AQ 40 → MO up to 360 Gold).

**Siege & Walls:** all Fortified Districts (incl. the Settlement Centre and some Wonders)
must be destroyed *and entered* to capture a settlement. Walls give +100 Health and +15
melee-defense, **degrade hard when obsolete** (+50/+7 one Age old, near-worthless further);
Wall base Melee Strength = the highest base-melee Unit the civ has fielded (min 20, resets
each Age). **Siege units** are the intended wall-breakers (highest Bombard, also damage
units inside); Melee units get punished attacking walls.

**Nukes:** require the **Manhattan Project** wonder (Modern), then a Bomber + the Produce
Nuclear Weapon project (1000 Production). Blast hits target + adjacent tiles; **Fallout
lasts 10 turns** (−50 HP/turn to units, nullifies tile yields, blocks new
infrastructure) — the standard "deny an opponent's victory" tool.

---

## Diplomacy, trade & governments

**Relationship levels** (a hidden score): **Helpful 60+** (needed for Alliances) ·
Friendly 20+ · Neutral · Unfriendly −20 · **Hostile −60** (needed for a Formal War). Point
deltas are engine-side; representative values: Friendly Greeting +20, Support an Endeavour
+12, Denounce −60, Sanction −30, **Settle within 10 tiles of a Capital −20**, Touching
Borders −10, shared Government +10, opposing Ideologies −9 (every 3 turns).

**Befriending Independent Powers → City-States:** the **Befriend Independent** action adds
**2 points/turn**; a **Friendly** IP needs **30** points, a **Hostile** IP needs **60**.
The repeatable **Add Support** action adds +1/turn but costs more Influence each time.
Influence cost scales **+20% per active befriend/already-owned CS**, and is **doubled in
Exploration, tripled in Modern**. (Suzerain *bonuses* themselves are in
[city-states-suzerain.md](city-states-suzerain.md).)

**⭐ THE EXACT INFLUENCE COSTS (added 2026-07-13 after under-sizing a reward against them —
size ANY Influence-denominated content against this table; from each age module's
`diplomacy-actions.xml` `InfCostNoRelationship`):**

| Action | Antiquity | Exploration | Modern |
|---|---:|---:|---:|
| Befriend Independent (`DIPLOMACY_ACTION_GIVE_INFLUENCE_TOKEN`) | 80 | 160 | **240** |
| Become Suzerain (`DIPLOMACY_ACTION_BECOME_SUZERAIN`) | 255 | 510 | **765** |

One Modern suzerainty from a cold start ≈ **1,005 Influence**, rising with each held/active
one (`COST_PROGRESSION_NUM_SUZERAIN_AND_CURRENTLY_BEFRIENDING`, Param 20/10). Modding lever
with base precedent on these exact actions: `EFFECT_DIPLOMACY_ADJUST_DIPLOMATIC_ACTION_TYPE_
EFFICIENCY` — Greek Xenia targets the Befriend action by `ActionType`; native Puppet Master
pays 50% on `ActionGroupType=DIPLOMACY_ACTION_GROUP_PROJECT` (where Become Suzerain lives).
Semantics = +% progress/efficiency (an effective discount), not a printed price cut.

**Trade ranges** (per Age, Land / Naval): **10/30 · 15/45 · 20/60.** These also set how far
a new settlement can be to **connect to your Trade Network** — a settlement founded out of
range is **not connected** (no roads, no trade routes, **can't allocate Resources to/from
it**). Trade income to you when someone routes to you: **2/3/4 Gold per resource** by Age.

**Governments** determine your **Celebration** bonus menu (chosen before the first
Celebration). Each is a pair of ~+20% flat-percentage yield/production boosts (e.g.
Classical Republic +20% Culture / +15% Production toward Wonders). The Exploration
**Revolutions crisis** forces a one-time choice among three special Governments. Note these
are **Celebration (Golden-Age) bonuses**, a distinct system from Policies/Traditions — full
card catalog in [cards-suzerain-governments-catalog.md](cards-suzerain-governments-catalog.md).

### Government lifecycle — WHEN you pick one, and why you can't just switch [DATA]

Data model, per age in `age-*/data/governments.xml`:

| Table | What it does |
|---|---|
| `Governments` | the government + its `CelebrationName` |
| `StartingGovernments` (AgeType, GovernmentType) | **the menu the player may choose from in that age** |
| `Government_ValidGoldenAges` | the (usually 2) Celebration bonuses that government offers |
| `GovernmentModifiers` | its always-on passives |

**Shipped menus — three choices per age**, one per "lane":
AQ `CLASSICAL_REPUBLIC / DESPOTISM / OLIGARCHY` · EX `FEUDAL_MONARCHY / PLUTOCRACY / THEOCRACY` ·
MO `AUTHORITARIANISM / BUREAUCRATIC_MONARCHY / ELECTIVE_REPUBLIC`. Extra governments exist in
`Types` but are **commented out of `StartingGovernments`** (`REVOLUCION`, and EX's
`REVOLUTIONARY_AUTHORITARIANISM / CONSTITUTIONAL_MONARCHY / REVOLUTIONARY_REPUBLIC`) — they are
crisis/narrative-granted only, never freely selectable.

**⚠ A GOVERNMENT IS A ONCE-PER-AGE CHOICE, NOT A SWITCHABLE STANCE — do not design deeds, quests or
rewards around "change your government" mid-age.** The mechanics:
- Selection is gated by `EFFECT_PLAYER_BLOCK_GOVERNMENT_SELECTION`. The Antiquity civ trait applies
  that block while `NODE_CIVIC_AQ_MAIN_CHIEFDOM` is **not** complete (`inverse="true"` requirement),
  so researching **Chiefdom** is what opens the first-ever government pick; later ages open the
  picker at the age flip.
- The picker itself is `NOTIFICATION_CHOOSE_GOVERNMENT` → the `government-chooser` UI. There is no
  player-initiated "swap government" action and no swap cost anywhere in the data.
- Mid-age changes exist ONLY as scripted pushes: `EFFECT_PLAYER_SET_GOVERNMENT` (5 uses, all
  narrative/crisis modifiers — this is how Revolucion and the Revolutions-crisis governments land).
- `GOSSIP_CHANGE_GOVERNMENT` therefore fires at those moments (age pick / crisis), not on a whim —
  counting it as a repeatable player action is a design error.
- **Celebrations do NOT change government.** A Celebration grants a policy slot and lets you pick
  one of your *current* government's two `Government_ValidGoldenAges` bonuses
  (`celebration-chooser` UI). Government choice and Celebration choice are different pickers.

---

## Ages, crises & legacy pacing

Each Age (except Modern) has **3 possible Crises**, toggleable at setup. A crisis runs in
three escalating phases tied to **Age Progress**: **Begins at 70%, Intensifies at 80%,
Culminates at 90%**, each phase opening more **Crisis Policy** slots.

- **Antiquity:** Invasions (hostile encampments spawn) · Plagues (10-turn outbreaks pillage
  tiles, cause unrest) · Revolts (unhappy settlements pillage themselves, then **defect
  after 10 turns unhappy**).
- **Exploration:** Revolutions (Gold stress + the special-Government choice) · Plagues (as
  AQ, but Physicians can now cure) · Wars of Religion / Religious Revolts (foreign-religion
  settlements revolt).

Crisis Policies and the choices they force are cards (see the catalog). The Age-pacing /
victory / Triumph layer is separate — see
[legacies-triumphs-dedications.md](legacies-triumphs-dedications.md).

**⭐ WHAT SURVIVES THE AGE TRANSITION (assembled 2026-07-13 — check any Age-scoped design
against this list; a condition pre-satisfied by carried state is not a real deed/feat):**
- **PERSISTS:** buildings & districts (obsolete, adjacencies deactivate — many Quarters stop
  being Quarters) · population incl. assigned Specialists (a tall AQ metropolis carries 3+
  Specialists into EX — in-game confirmed) · slotted/unlocked **Traditions, with effects
  stacking** (litmus-proven) · discovered Natural Wonders / map state · commanders (AGELESS).
- **RESETS:** progression-tree unlock state & Triumph completion counts (litmus-proven) ·
  **suzerainty / city-state relationships** (play-confirmed) · trade routes
  (re-established in the new Age) · **Great Works are EVICTED to the archive** (in-game
  confirmed — re-displaying them is a real new-Age action) · celebrations/happiness stages
  re-evaluate against new-Age thresholds.

---

## Religion, beliefs & ideology (structure)

The unlock chain (data-backed civics — grep to confirm exact node ids):
- **Pantheon** ← the **Mysticism** civic; its bonus is tied to **Altars** (you must build
  Altars to get it).
- **Religion** ← the **Piety** civic; **Temples** train **Missionaries**; creating a
  religion reveals the **Theology** tree. Belief slots: **1 Reliquary** (which settlements
  give Relics on conversion) + up to **3 Founder** beliefs (yields from converting foreign
  settlements; two are unlocked via Narrative Events at >50% conversion) + **1 Enhancer**
  (from the Theology civic; spread/great-work/unit bonuses).
- **Ideology** ← the **Political Theory** civic, then studying Democracy / Fascism /
  Communism for one turn locks you in. **Racing matters: the first leader to join gets +2
  Policy Slots, the second gets +1.** Ideology civics grant Attribute points, free Capital
  units, and Specialist/Town trade-off policies.
- **⚠ IDEOLOGY RIVALRY IS A ONE-WAY RING, NOT MUTUAL OPPOSITION.** Each `Ideologies` row carries a
  single **`RivalIdeology`**, and they chain rather than pair up:
  **Communism → Democracy → Fascism → Communism.** So a Communist player's rival is Democracy —
  *not* Fascism, even though Fascism's own rival is Communism. The relation is directional and
  every ideology has exactly ONE rival, never two.
  This matters for **`REQUIREMENT_PLAYER_IS_AT_WAR_WITH_OPPOSING_IDEOLOGY`** (10 shipped uses),
  which takes **no arguments** and tests only *"is my enemy holding MY rival ideology"*. Verified
  in-game 2026-08-06: a Communist player at war with a Fascist civ did **not** satisfy it, though
  the identical pairing would satisfy it for the Fascist. There is no "any different ideology"
  variant and nothing to widen it with, so a deed or bonus built on it reaches only **one of the
  two** other ideologies — price it as an opportunity, and never word it as "an opposing ideology",
  which players read as "any other one".
  The three roots also carry **`CanBoost="false"`** and can never take a tech/civic boost; only the
  two nodes behind each root can. Each ideology is its own `ProgressionTree`, so a player walks one
  branch and the other four boostable nodes are unreachable that game.

(Belief *contents* are partly a work-in-progress in the source; treat the structure above
as solid and verify individual belief yields in-game or against
[cards-suzerain-governments-catalog.md](cards-suzerain-governments-catalog.md).)
