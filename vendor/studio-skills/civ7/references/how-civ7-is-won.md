# How Civilization VII Is Actually Won — Legacy Paths & the Mechanics Each One REQUIRES

Mined read-only from installed base game data (patch level current as of 2026-07-08). Every claim cites a file. Labels: ✅ = confirmed directly in data · ⚠ = inferred from data (reasoning noted) · ❌ = absent.

Purpose: separate **CORE GAME OPERATION** (what the game FORCES you to do to advance a path) from *accomplishments*. If a step below is in a path's REQUIRED CHAIN, it is the **price of entry** — a mod must NEVER treat it as a special/optional achievement.

---

## 1. Overview — the Legacy-Path / Victory system

### The structure ✅
Each Age has exactly **4 Legacy Paths**, one per domain: **Science, Military, Culture, Economic**. (NOT Diplomatic/Expansionist — those exist only as *Legacy/Triumph tags* and attribute-point flavors, not as age-progression paths.)
- Confirmed by the `AgeProgressionMilestones` blocks naming exactly `*_SCIENCE_*`, `*_MILITARY_*`, `*_CULTURE_*`, `*_ECONOMIC_*` in `age-antiquity/data/victories.xml` (lines 202-215), `age-exploration/data/victories.xml` (209-222), `age-modern/data/victories.xml` (205-218).
- The 6-way tag set (`CULTURAL/DIPLOMATIC/ECONOMIC/EXPANSIONIST/MILITARISTIC/SCIENTIFIC/WILDCARD`) is only for Legacy *cards* / attribute rewards: `base-standard/data/legacies.xml` lines 22-31.

### Each path has a Victory-Point (VP) currency and 3 Milestones ✅
A path accrues **path points** (VP) from a specific scoring action (defined per-age in each `victories.xml` `Modifiers`/`ModifierArguments`). Crossing point thresholds triggers **3 milestones** (`AgeProgressionMilestones`):
- Milestone 1 & 2 give a **Legacy Point** in that domain (carried between Ages) + a mid-Age reward card.
- Milestone 3 = `FinalMilestone="true"` → Legacy Point + a **Golden-Age reward** (Antiquity/Exploration) or a **victory-enabling unlock** (Modern).
- Each milestone also feeds the **Age Timer** (see below).

### The Age Timer forces the clock ✅
`age-*/data/victories.xml` → `AgeProgressions` / `AgeProgressionTurns` / `AgeProgressionEvents`:
- Every Age has a timer `MaxPoints`: **120 (Abbreviated) / 140 (Standard) / 160 (Long)**. When it fills, the Age ends. (Same for all 3 ages.)
- **+1 point per turn**, always (`AGE_PROGRESSION_PER_TURN_BASE`, `GameSpeedScaling="false"`).
- Reaching **any player's path milestones** dumps big points into the timer, accelerating the Age's end. Antiquity: milestone events = 5/5/10. Exploration: 5/10/20. Modern: 5/10/0.
- Each **Future Civic** and **Future Tech** completed = +10 to the timer (`AGE_PROGRESSION_FUTURE_CIVIC` / `_FUTURE_TECH`).
- Consequence: pushing your own paths (and rivals pushing theirs) shortens the Age. Milestones are the accelerant.

### How you actually WIN ✅
Two-layer model:
1. **Antiquity & Exploration are NON-terminal.** Their "victory" requirement sets (`REQSET_VICTORY_*`) exist and finishing a path yields a **Golden Age** into the next Age plus permanent Legacy Points — they do NOT end the game. (`legacies-gameeffects`/`victories-gameeffects` grant `UNLOCK_WON_*_VICTORY_1` etc. as bonuses, `age-antiquity/data/legacy-path-gameeffects.xml`.)
2. **Modern Age is terminal.** The real game-ending victories live in `base-standard/data/victories.xml` (`<VictoryTypes>`, 1.4.0). The per-age `age-modern/data/victories.xml` `<Victories>` block is explicitly **DEPRECATED 1.4.0** (comment, lines 17-29). The four Modern victories:
   - `VICTORY_MILITARY_MODERN`, `VICTORY_CULTURE_MODERN`, `VICTORY_ECONOMIC_MODERN` → `ScoringType="COUNTDOWN_VICTORY_SCORING_TYPE_DOMINATION"`, `CountdownDuration="5"`. You win by leading a tracker far enough ahead of the field (see `VictoryDominationPercents`, lines 179-228: the % lead you need shrinks from 500% down to 25% as the Age progresses), which starts a **5-turn countdown**.
   - `VICTORY_SCIENCE_MODERN` → `COUNTDOWN_VICTORY_SCORING_TYPE_FIXED_SCORE`, `MinimumPoints="100"`, and a hard **prereq: an undamaged `BUILDING_LAUNCH_PAD`** (`victories-gameeffects.xml` `REQSET_MODERN_VICTORY_SCIENCE_PREREQ`).
   - `VICTORY_SCORE` (fallback): most Legacy Points when the final Age's timer expires (`base-standard/data/victories.xml` lines 313-332, `REQUIREMENT_TEAM_SCORE_VICTORY`).
   - `VICTORY_DOMINATION` (always-on): capture all rival capitals (`REQSET_DOMINATION_VICTORY`).

### Crises ✅ (interaction with paths)
`age-*/data/legacies.xml` define `LEGACY_*_CRISIS_*` (Invasion / Revolts / Plague) as `LEGACY_CRISIS` subtype, `Inactive="true"` by default. Crises fire in the back half of Antiquity/Exploration and hand out **crisis policy cards** rather than path points; they are a pacing/pressure layer layered on top of the timer, not a 5th path. (Antiquity examples: `age-antiquity/data/legacies.xml` lines 200-207.)

---

## 2. Per-Path breakdown — win condition · ⭐ REQUIRED mechanical chain · mandatory vs optional

### ═══ ANTIQUITY ═══ (`age-antiquity/data/victories.xml`)

#### SCIENCE — "codices + Great Library"
- **Path scoring** ✅: `VICTORY_ANTIQUITY_SCIENCE_GREAT_WORK_SCORING`, `MODIFIER_PLAYER_ADJUST_GREAT_WORK_SCORING`, `GreatWorkObjectType=GREATWORKOBJECT_WRITING`, **VP=1 per codex** (lines 51, 64-66).
- **Milestones** ✅: 3 / 6 / 10 codex-points (lines 203-205).
- **Victory gate** ✅: `REQ_VICTORY_ANTIQUITY_SCIENCE_GREAT_LIBRARY_CONSTRUCTED` = build **1× `WONDER_GREAT_LIBRARY`** (`REQUIREMENT_PLAYER_HAS_AT_LEAST_NUM_BUILDINGS`, lines 89, 98-99). Note: the science gate is a **building**, not a VP count.
- **⭐ REQUIRED CHAIN**:
  1. Acquire **Codices** (great works of writing). Sources ✅: completing tech/civic tree nodes grants them (`progression-trees-tech-gameeffects.xml` `MOD_AQ_CODEX`, `MOD_AQ_CODEX_CIVIC`, `MOD_AQ_MATHEMATICS_CODEX`, all `EFFECT_GRANT_GREAT_WORK` / `GREATWORKOBJECT_WRITING`); also Nalanda wonder, science goody huts, some great people.
  2. **SLOT each codex** in a great-work slot. Codices that are not slotted **do not count** — confirmed by advisory warnings `ADVISOR_WARNING_NO_CODEX_SLOT` and `ADVISOR_WARNING_CODEX_NEEDS_TO_BE_SLOTTED` (`age-antiquity/data/advisory.xml` lines 5-27). Slots come from **Libraries / Academies** (`constructibles.xml` lines 105, 118; science-yield + writing slots) — this is the price of entry.
  3. Build the **Great Library** wonder to actually claim the victory/golden-age.
- **Mandatory**: getting + **slotting** codices; building Libraries/Academies for slots; the Great Library. **Optional**: *which* techs you take to farm codices.

#### MILITARY — "settlement count, conquest doubles"
- **Scoring** ✅: `MODIFIER_PLAYER_ADJUST_SETTLEMENT_COUNT_SCORING`. Non-conquered settlement = **1 VP**; **conquered settlement = 2 VP** (`VICTORY_ANTIQUITY_MILITARY_CONQUEST_SCORING`, lines 48-49, 55-60).
- **Milestones** ✅: 6 / 9 / 12 (lines 206-208). **Victory gate** ✅: `REQ_VICTORY_ANTIQUITY_MILITARY_SETTLEMENT_VP` = **12 VP** (lines 96-97).
- **⭐ REQUIRED CHAIN**: own settlements; **capturing** enemy settlements is worth double, so the path is built to reward war. Chain = build army → take rival/independent settlements → each conquered town/city books 2 VP.
- **Mandatory**: accumulating settlement VP (owning + conquering). **Optional**: peaceful settling vs conquest mix (both score; conquest just scores faster).

#### CULTURE — "build Wonders"
- **Scoring** ✅: `VICTORY_ANTIQUITY_CULTURE_WONDER_SCORING`, `MODIFIER_PLAYER_ADJUST_WONDER_SCORING`, **VP=1 per Wonder**, `Reversible=false` (lines 50, 61-63).
- **Milestones** ✅: 2 / 4 / 7 (lines 209-211). **Victory gate** ✅: **7 Wonder-VP** (`REQ_VICTORY_ANTIQUITY_CULTURE_WONDER_VP`, VPNeeded=7, lines 94-95).
- **⭐ REQUIRED CHAIN**: build Wonders. That's the whole path in Antiquity — no relics yet. (Relics are the *Exploration* culture chain; see below.)
- **Mandatory**: constructing Wonders (production + adjacency + the tech/civic that unlocks each). **Optional**: which Wonders.

#### ECONOMIC — "resources"
- **Scoring** ✅: `VICTORY_ANTIQUITY_ECONOMIC_RESOURCE_SCORING`, `MODIFIER_PLAYER_ADJUST_RESOURCE_SCORING`, **VP=1 per resource**, `CitiesOnly=false` (lines 52, 67-69).
- **Milestones** ✅: 7 / 14 / 20 (lines 212-214). **Victory gate** ✅: **25 resource-VP** (`REQ_VICTORY_ANTIQUITY_RESOURCE_VP`, VPNeeded=25, lines 100-101).
- **⭐ REQUIRED CHAIN**: assign/slot **resources** (via the resource-slotting system: cities, trade, and resource buildings hold resource slots). Score = count of resources you have slotted/assigned.
- **Mandatory**: acquiring resources and having slots to hold them. **Optional**: trade vs settle vs conquer to get them.

---

### ═══ EXPLORATION ═══ (`age-exploration/data/victories.xml`)

#### SCIENCE — "high-yield specialist districts"
- **Scoring** ✅: `VICTORY_EXPLORATION_SCIENCE_HIGH_YIELD_DISTRICT_SCORING`, `MODIFIER_PLAYER_ADJUST_HIGH_YIELD_DISTRICT_SCORING`, **VP=1 per district with YieldNeeded ≥ 40** (lines 62, 102-104).
- **Milestones** ✅: 1 / 3 / 5. **Victory gate** ✅: **5 VP** (`REQ_VICTORY_EXPLORATION_SCIENCE_HIGH_YIELD_DISTRICT_VP`, VPNeeded=5, lines 132-133).
- **⭐ REQUIRED CHAIN**: develop **specialist districts** (Quarters) whose total yield on a single tile reaches **40+**. Requires stacking buildings + specialists + adjacency. This is the "tall, developed city" path.
- **Mandatory**: pushing individual districts to 40 yield. **Optional**: which yield type dominates.

#### MILITARY — "distant-lands settlements; religion & conquest multiply"
- **Scoring** ✅ (`MODIFIER_PLAYER_ADJUST_SETTLEMENT_COUNT_SCORING`, all `DistantLands=true`): non-conquest distant settlement = 1 VP; conquest = 2 VP; **non-conquest that follows your religion = 2**; **conquest + follows religion = 4** (lines 65-98). (Mongolia has its own flat variants.)
- **Milestones** ✅: 4 / 8 / 12. **Victory gate** ✅: **12 VP** (lines 130-131).
- **⭐ REQUIRED CHAIN**: cross the ocean, plant/seize settlements **in the Distant Lands (other hemisphere)**; spreading **your religion** to them multiplies VP. Chain = fleet/exploration tech → distant settling/conquest → religious conversion for the multiplier.
- **Mandatory**: distant-lands presence. **Optional**: peaceful vs conquest; religion is a *force multiplier*, strongly incentivized but not strictly required to reach 12.

#### CULTURE — "RELICS" ⭐⭐ (the chain the designer got wrong)
- **Scoring** ✅: `VICTORY_EXPLORATION_CULTURE_GREAT_WORK_SCORING`, `MODIFIER_PLAYER_ADJUST_GREAT_WORK_SCORING`, `GreatWorkObjectType=GREATWORKOBJECT_RELIC`, **VP=1 per relic** (lines 61, 99-101).
- **Milestones** ✅: 6 / 9 / 12. **Victory gate** ✅: **12 relic-VP** (lines 126-127).
- **⭐ REQUIRED CHAIN — this is a mandatory core loop, not an accomplishment**:
  1. **Found/enhance a Religion.** Relics are *generated by religious beliefs* — every relic source in the data is a belief effect: `EFFECT_ADJUST_PLAYER_RELIC_CONVERTING_*` for converting **city-states, capitals, religious buildings, wonders, holy cities, treasure fleets, rural/urban pop, first-time-owned cities** (`age-exploration/data/religion-gameeffects.xml` `BONUS_9`–`BONUS_31`, lines 164-469). No religion ⇒ effectively no relics.
  2. **Spread that religion** (missionaries/pressure) so conversions fire and mint relics.
  3. **Have relic slots and SLOT the relics.** The belief `BONUS_8_RELIC_SLOT_TEMPLE` adds a `GREATWORKSLOT_RELIC` **to Temples** (lines 79-85); another belief can add relic slots to science buildings (`MOD_ENHANCER_BELIEF_RELIC_SLOTS_ON_SCIENCE_BUILDINGS`, lines 116-127). Relics only count once slotted (same slotting rule as codices). **So Temples are the price of entry**, and the AI's Culture-path bias explicitly favors `BUILDING_TEMPLE` (value 200) + `PSEUDOYIELD_RELIGION_CONVERSION` (300) + Theology/Reformation civics (`age-exploration/data/victories.xml` lines 199-207).
  - **Corrected framing**: *founding a religion → building Temples → converting cities to mint relics → slotting relics* is the FORCED mechanical chain of the Exploration Culture path. It is the entry fee, not a bonus objective.
- **Mandatory**: religion, Temples (slots), conversions, slotting. **Optional**: which beliefs (they only change *which* conversions mint relics).

#### ECONOMIC — "Treasure Fleets"
- **Victory gate** ✅: `REQ_VICTORY_EXPLORATION_ECONOMIC_TREASURE_VP` = **30 VP** (lines 128-129). Milestones ✅: 10 / 20 / 30.
- **⭐ REQUIRED CHAIN** ⚠ (mechanic confirmed, exact VP-per-fleet is a global param): settle/exploit **Treasure resources** (`RESOURCECLASS_TREASURE`) in the Distant Lands → they spawn **Treasure Fleet** units → sail them home and **disband in a home port** to bank VP. Confirmed by: AI biases favoring `Foreign Hemisphere` + `Resource Class RESOURCECLASS_TREASURE` (value 1000) + coastal + Shipbuilding (`age-exploration/data/victories.xml` lines 184-197); and the Modern carry-over tracker `VICTORY_TRACKER_TREASURE_RESOURCES` = `VICTORY_TRACKER_UNIT_DISBAND` governed by global `TREASURE_CONVOY_VP_PER_POINT` (`base-standard/data/victories.xml` lines 116-117).
- **Mandatory**: distant treasure resources + naval logistics to convoy them home. **Optional**: which treasure tiles.

---

### ═══ MODERN (terminal Age) ═══ (`age-modern/data/victories.xml` for milestones; `base-standard/data/victories.xml` for the real win conditions)

Modern paths accrue path points to hit 3 milestones (which grant Legacy Points + unlock the victory constructible/project), but **the game is won by the `VICTORY_*_MODERN` trackers in `base-standard/data/victories.xml`** via the domination-countdown / fixed-score model.

#### SCIENCE — "Space Race" ⭐
- **Modern milestones** ✅: path points 1 / 2 / 3 (`age-modern` lines 206-208). Milestone 3 unlocks the rocket project boost.
- **Win condition** ✅: `VICTORY_SCIENCE_MODERN`, **FIXED_SCORE, MinimumPoints=100**, hard prereq **undamaged `BUILDING_LAUNCH_PAD`** (`base-standard/victories-gameeffects.xml` lines 19-26). Scoring: `VICTORY_TRACKER_PROJECT_COMPLETION` for **`PROJECT_LAUNCH_ROCKET`** (`base-standard/victories.xml` line 124) + carry-over **codices** (`VICTORY_TRACKER_CODICES`, GREATWORKOBJECT_WRITING, line 125).
- **⭐ REQUIRED CHAIN**: tech to Flight/Rocketry → **build a Launch Pad** (prereq) → complete the **Launch Rocket** project(s) (space-race projects: `PROJECT_TRANS_OCEANIC_FLIGHT`, `PROJECT_BREAK_SOUND_BARRIER`, `PROJECT_LAUNCH_SATELLITE`, then rocket — AI bias lists them, lines 184-191) → hit 100 points → 5-turn countdown.
- **Mandatory**: Launch Pad + rocket project(s). **Optional**: codex padding.

#### CULTURE — "Tourism / World's Fair" ⭐
- **Modern milestones** ✅: 5 / 10 / 15 (lines 212-214). Milestone 3 unlocks **`WONDER_WORLDS_FAIR`** + a wonder boost (`age-modern` lines 238-239; `legacy-path-gameeffects.xml` `MOD_AGE_REWARD_CULTURE_UNLOCK_WORLDS_FAIR` = `EFFECT_PLAYER_GRANT_CONSTRUCTIBLE_UNLOCK`).
- **Win condition** ✅: `VICTORY_CULTURE_MODERN`, domination-countdown. The **tracker is broad** (`base-standard/victories.xml` lines 94-161) — it is a Tourism/culture aggregate scoring, among others:
  - Wonders (Antiquity 4 / Exploration 8 / Modern 12 pts each), Natural Wonders (10), **Relics (3) and Artifacts (5)** (great works carried & slotted), Celebrations, Unique Quarters/Improvements, Resort Towns (`PROJECT_TOWN_RESORT`), trade routes, and many civ-unique/Triumph activations.
- **⭐ REQUIRED CHAIN**: sustain a **Tourism/culture output** that keeps the aggregate tracker ahead of every rival by the required domination %. In practice: keep building Wonders, keep the relic/artifact great-work pipeline slotted, run culture Projects (Resort Towns, World's Fair). **Artifacts** (`GREATWORKOBJECT_ARTIFACT`) are the Modern great-work — dug up by Explorers/archaeology and **slotted in Museums** (AI bias `BUILDING_MUSEUM` + `PSEUDOYIELD_DIGGING_RESEARCHING_UNIT`, `age-modern` lines 193-200).
- **Mandatory**: an ongoing culture/tourism lead (Wonders + slotted great works + culture projects). **Optional**: exact mix of contributors.

#### ECONOMIC — "Factories / slotted resources / GDP" 
- **Modern milestones** ✅: path points **150 / 300 / 500** (lines 215-217) — an order of magnitude larger than other paths because it counts a per-turn/aggregate economic figure. Milestone 3 grants a free `UNIT_JOHN_MAYNARD_KEYNES` great person (`legacy-path-gameeffects.xml` lines 9-13).
- **Win condition** ✅: `VICTORY_ECONOMIC_MODERN`, domination-countdown. Trackers (`base-standard/victories.xml` lines 110-160): **slotted resources by class** (Bonus/City 1, **Factory 3**), gold-tagged buildings per turn, imported slotted resources, treasure carry-over, railroad routes, captured-settlement GDP, etc.
- **⭐ REQUIRED CHAIN**: industrialize — build **Factories** and factory-resource infrastructure, **slot Factory-class resources** (worth most), run gold buildings and trade/rail networks, so your economic tracker leads the field.
- **Mandatory**: factories + slotted resources + gold throughput. **Optional**: rail vs trade vs conquest-GDP emphasis.

#### MILITARY — "Ideology-driven conquest"
- **Modern milestones** ✅: 10 / 15 / 20 (lines 209-211). Milestone 3 unlocks **`WONDER_MANHATTAN_PROJECT`** + Operation Ivy project boost (`age-modern` lines 233-235; `legacy-path-gameeffects.xml` `EFFECT_PLAYER_GRANT_CONSTRUCTIBLE_UNLOCK`).
- **Scoring** ✅ (`MODIFIER_PLAYER_ADJUST_SETTLEMENT_SCORING`, `OncePerLocation=true`): conquer settlement = 1 VP; **conquer while you have an Ideology = 2**; **conquer a settlement of the opposing Ideology = 3**; re-acquiring your own = 1/2/3 similarly (lines 71-98). Modern win tracker also weights original capitals (4) and ideology settlements (2) (`base-standard/victories.xml` lines 89-93).
- **⭐ REQUIRED CHAIN**: **adopt an Ideology** (Political Theory civic — AI bias `NODE_CIVIC_MO_MAIN_POLITICAL_THEORY` 2000, `PSEUDOYIELD_UNLOCK_IDEOLOGIES`) → wage war → **conquer settlements, especially enemy-capital and opposing-ideology ones** for the highest VP.
- **Mandatory**: conquest; Ideology is the multiplier the path is balanced around. **Optional**: which ideology.

---

## 3. CONSOLIDATED "REQUIRED-MECHANICS — never an accomplishment" list

Gate any design idea against this. If your mod's "special reward" is on this list, you are taxing/gating a mechanic the base game **forces** a path-follower to perform.

| # | Required mechanic (price of entry) | Path(s) that FORCE it | Source |
|---|---|---|---|
| 1 | **Acquire codices** (writing great works) from tech/civic nodes | Antiquity Science | `progression-trees-tech-gameeffects.xml` MOD_AQ_CODEX* ✅ |
| 2 | **SLOT codices** in Library/Academy great-work slots (unslotted = 0) | Antiquity Science; Modern Science padding | `advisory.xml` CODEX_NEEDS_TO_BE_SLOTTED ✅ |
| 3 | **Build the Great Library** wonder | Antiquity Science (hard gate) | `age-antiquity/victories.xml` L98-99 ✅ |
| 4 | **Build Wonders** (repeatedly) | Antiquity Culture (7); Modern Culture tracker | `age-antiquity/victories.xml` L61-63 ✅ |
| 5 | **Acquire & slot resources** (resource-slot system) | Antiquity Economic; Modern Economic | `age-antiquity/victories.xml` L67-69; `base-standard` L110-160 ✅ |
| 6 | **Found a Religion** | Exploration Culture (relics come only from beliefs) | `religion-gameeffects.xml` BONUS_9-31 ✅ |
| 7 | **Build Temples** (to get relic slots) + **spread religion / convert** to mint relics | Exploration Culture | `religion-gameeffects.xml` BONUS_8, L79-85 ✅ |
| 8 | **SLOT relics** (unslotted = 0), 12 to win | Exploration Culture; Modern Culture | inferred from slot+advisory pattern ⚠ / scoring ✅ |
| 9 | **Settle/conquer in Distant Lands** (other hemisphere) | Exploration Military; carries to Modern | `age-exploration/victories.xml` L65-98 ✅ |
| 10 | **Convoy Treasure-Fleet units home & disband** | Exploration Economic (30 VP) | `base-standard/victories.xml` L116-117 ✅ |
| 11 | **Develop districts to 40+ yield** | Exploration Science | `age-exploration/victories.xml` L102-104 ✅ |
| 12 | **Dig up Artifacts & slot in Museums** | Modern Culture | `base-standard` L102; `age-modern` L193-200 ✅ |
| 13 | **Build a Launch Pad + complete Rocket project(s)** | Modern Science (hard prereq + score) | `victories-gameeffects.xml` L19-26; `base-standard` L124 ✅ |
| 14 | **Build Factories & slot Factory-class resources** | Modern Economic | `base-standard` L113, L134 ✅ |
| 15 | **Adopt an Ideology, then conquer** | Modern Military | `age-modern/victories.xml` L75-98 ✅ |
| 16 | **Complete Future Techs/Civics** (accelerates Age end) + accrue Legacy Points | ALL (timer + Score victory) | `age-*/victories.xml` AgeProgressionEvents ✅ |

### Things a mod designer would WRONGLY assume are "special" (they are core operation)
- **Slotting relics into Temples** — the literal price of entry for Exploration Culture, gated behind founding + spreading a religion. Not an achievement.
- **Slotting codices** (Antiquity Science) and **artifacts in Museums** (Modern Culture) — same slot-or-it-doesn't-count rule.
- **Founding a religion** — mandatory infrastructure for the Culture path, not a flavor pick.
- **Building Temples / Libraries / Academies / Museums / Factories / Launch Pad** — these are *slot/gate* buildings the paths require, not optional yield buildings.
- **Building Wonders** — literally the Antiquity Culture currency (1 VP each, 7 to win) and a heavy Modern-Culture tracker weight.
- **Adopting an Ideology** — the Modern Military/Culture multiplier, effectively required, not a bonus.
- **Distant-Lands settling & Treasure Fleets** — the entire Exploration Economic/Military engine.

### Big structural facts to respect
- **Only 4 paths per Age** (Science/Military/Culture/Economic). Diplomatic & Expansionist are NOT age-progression paths — do not model them as victory paths.
- **Antiquity/Exploration don't end the game**; they hand out **Golden Ages + Legacy Points**. Only **Modern** ends it, via **domination-countdown** (Mil/Cult/Econ) or **fixed 100-pt space race** (Sci), or **Score** at timer expiry.
- **Milestones double as the Age-timer accelerant** — completing paths (yours or rivals') shortens the Age. Padding the timer with Future Tech/Civic (+10 each) is a real lever.
- Modern Economic path points are on a ~10× scale (150/300/500) vs other paths — do not compare raw path-point magnitudes across domains.

---

### Files cited
- `Base/modules/age-antiquity/data/victories.xml`, `legacy-path-gameeffects.xml`, `legacies.xml`, `advisory.xml`, `constructibles.xml`, `progression-trees-tech-gameeffects.xml`, `constructibles-no-persist(-gameeffects).xml`, `greatworks.xml`, `goody-huts.xml`
- `Base/modules/age-exploration/data/victories.xml`, `religion-gameeffects.xml`
- `Base/modules/age-modern/data/victories.xml`, `legacy-path-gameeffects.xml`
- `Base/modules/base-standard/data/victories.xml`, `victories-gameeffects.xml`, `legacies.xml`
