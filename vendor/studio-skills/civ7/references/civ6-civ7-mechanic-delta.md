# Civ VI ↔ Civ VII mechanic delta — the feasibility gate

Civ VII reworked most of Civ VI's systems. Before porting a Civ-VI-inspired idea into a Civ VII mod,
check it here so you don't design around a mechanic that **doesn't exist / works differently**. Civ VI
knowledge is reliable; **Civ VII from memory is not** — verify against the installed data
(`effects-collections-catalog.md` for primitives; `cards-suzerain-governments-catalog.md` for content).

## How to use it (the gate)
1. Find the Civ VI subsystem in Part A. **❌ absent** → drop the idea, no design time. **🔷 different shape** →
   the concept rhymes but Civ VII delivers it differently — design to **Civ VII's** form, never port the Civ VI one.
   **✅ present** → buildable; still confirm the exact primitive's usage/args in `effects-collections-catalog.md`.
2. Prefer **Part B** — Civ VII-native systems with no Civ VI analog are the freshest, least-derivative design space.
3. **Two standing caveats — this is a gate, not a lookup:**
   - **Name match ≠ mechanic match.** `EFFECT_DAE_*` (Loyalty/Espionage/Favor/Grievances) are Influence-spent
     **diplomacy ACTIONS**, not Civ VI standalone systems. Read the primitive's real usage before trusting a hit.
   - **Absent-keyword ≠ impossible.** A concept can live in a **data table** with no concept-named `EFFECT_`. The
     canonical trap: Great People — an `EFFECT_*GREAT_PERSON*` grep returns nothing, yet the system exists in
     `age-*/data/greatpeople.xml`. **Always check data tables, not just the effect vocabulary, before ruling something out.**

## Part A — Civ VI subsystem → Civ VII status
Legend: ✅ present (same-ish) · 🔷 different shape · ❌ absent (no substrate)

| Civ VI mechanic | Civ VII | Grounded note | Design implication |
|---|---|---|---|
| **Great People — universal GPP recruitment** | 🔷 | Civ VII HAS great people, but as a **civ-unique data-table system** (`greatpeople.xml`: `GREAT_PERSON_CLASS_*` = Egypt Tjaty, Greece Logios, Han Shi Dafu, Alim, Conquistador, Jacobin, Revolucionario, Uparat, Victory). Units are `CanTrain="false"`, cost-escalating, earned by a civ's own mechanic — **no universal GPP point pool, no recruit-next-in-queue**. Some activate ON a Commander with a 1-charge Retire. | Don't port Civ VI GPP-point cards (no point economy). Civ-unique great people = **civ powers — don't touch**. |
| **Great General** (military Great Person) | ❌ | No `GREAT_GENERAL` / `GREAT_PERSON_CLASS_GENERAL` anywhere. Role fully absorbed into the trainable **Commander** (see worked example below). | Military-leader design = the Commander (Part B), never a Great General |
| **Eureka / Inspiration** (tech & civic boosts) | ❌ | No `EUREKA`/`INSPIRATION`/`BOOST_TECH` primitive; research just accrues | No "gain a boost / free progress" cards |
| **Governors** (+ titles/promotions) | ❌ | No `GOVERNOR` token | No governor cards (Commanders are the military analog, not city governors) |
| **Amenities / Luxuries→amenities** | 🔷 | No `YIELD_AMENITIES`; replaced by **Happiness** + stages (`YIELD_HAPPINESS`, `REQUIREMENT_SETTLEMENT_HAPPINESS_STAGE_MATCHES`) | Use Happiness, never "+N Amenities" |
| **Housing** (growth cap) | ❌ | No `YIELD_HOUSING`; growth = Food vs specialist Food-upkeep | No housing cards |
| **Builder charges + Chop/Harvest** | ❌ | No `HARVEST`/`CHOP`/`REMOVE_FEATURE`; improvements auto-build, no worker-chop | No chop/harvest cards |
| **Tourism / tourism Culture victory** | ❌ | No `YIELD_TOURISM` or tourism effect; culture path = Great Works/artifacts/relics + `YIELD_VICTORY_POINT_CULTURAL` | Culture cards ride Great Works / victory points, not tourism |
| **Loyalty / pressure / Free Cities** | 🔷 | Only `EFFECT_DAE_BUY_LOYALTY` (a diplomacy action vs independents); **no** per-city loyalty-pressure system | No loyalty-pressure cards |
| **Diplomatic Favor + World Congress** | 🔷 / ❌ | Favor→Influence exists (`YIELD_DIPLOMACY`, `EFFECT_PLAYER_DIPLOMACY_FAVOR_ACCRUE_MOD`); **World Congress ❌** (no `CONGRESS`/`RESOLUTION`) | Influence cards OK; no Congress/resolution cards |
| **Envoys + city-state envoy tiers (1/3/6)** | 🔷 | Civ VII = **Suzerain (single winner)** + Influence (`EFFECT_*_PER_SUZERAIN*`); take-all, not envoy-accumulation tiers | Ride the Suzerain model; no envoy-tier cards. See `city-states-suzerain.md` |
| **Spies / Espionage (units, districts)** | 🔷 | `EFFECT_DAE_ESPIONAGE_*` = Influence-driven diplomacy actions; no spy units/districts | Espionage = a diplomacy action, not a spy unit |
| **Grievances / Casus Belli / Warmonger** | 🔷 | **War Support real** (`EFFECT_ADJUST_WAR_SUPPORT_BONUS`, `YIELD_WAR_WEARINESS`); grievances via diplomacy; no warmonger-score. Civ VII has **no surfaced Grievances** | War Support / war-weariness cards OK. See `razing-and-conquest.md` |
| **Era Score → Golden/Dark Ages + era Dedications** | 🔷 | Civ VII = **Ages (hard resets)** + Legacy Paths + age-transition dark effects (`EFFECT_AT_EXP_DARK_AGE_*`) + happiness-driven **Golden-Age celebrations** + **Dedications** (Age-start picks) | Build on Triumphs/Dedications; don't port era-score. See `legacies-triumphs-dedications.md` |
| **Religion (beliefs, apostles, theological combat)** | 🔷 | `YIELD_RELIGION`, `EFFECT_ADD_BELIEF`, auto-spread exist; **Exploration-age** system; no apostle combat | Religion cards possible but age-scoped + reworked |
| **Ideologies** (Freedom/Order/Autocracy) | 🔷 | `YIELD_UNLOCK_IDEOLOGIES`, `YIELD_IDEOLOGY_EARLY_PICK_PER_TIER` — **Modern-age** | Ideology-adjacent cards possible in Modern |
| **Corps / Armies (merge 2–3 units)** | 🔷 | Civ VII = **Commanders** that PACK units + reinforce (`EFFECT_ADD_COMMANDER_WITH_UNITS`, `_ARMY_*`) | Commander/army cards on Civ VII's model, not Civ VI corps |
| **Specialty district adjacency** | 🔷 | Civ VII = urban tiles / **Quarters** + buildings + **specialists-as-adjacency** (`EFFECT_CITY_ACTIVATE_CONSTRUCTIBLE_ADJACENCY`, `_WORKER_YIELD`) | Adjacency cards on Civ VII's model. See `gameeffects.md` |
| **Wildcard / Great-Person policy slots** | 🔷 | Civ VII culture slots = Tradition/Policy/Crisis only; "Wildcard" is a **Legacy/attribute currency**, not a policy slot | Slot cards ride Policy/Tradition slots |
| **Pantheons · Trade routes · Great Works · Wonders(+Appeal)** | ✅ | `YIELD_UNLOCK_PANTHEON`; rich trade-route effects; `YIELD_PER_GREAT_WORK`; `REQUIREMENT_PLOT_HAS_APPEAL` (Appeal is Civ VII-specific) | Buildable |

## Part B — Civ VII-native systems with NO Civ VI analog (mine THESE for fresh cards)
| Civ VII system | Key primitives |
|---|---|
| **Ages / hard resets + Legacy Paths + Triumphs + Dedications + Crisis** | `Legacies`, `AdvancedStartCards`, `EFFECT_AT_*`, `YIELD_PER_COMPLETED_TRIUMPH` |
| **Independent Powers + Suzerain (single winner)** | `EFFECT_*_PER_SUZERAIN*`, `REQUIREMENT_PLAYER_ELIGIBLE_CS_BONUS` |
| **Happiness stages + happiness-driven Celebrations** | `REQUIREMENT_SETTLEMENT_HAPPINESS_STAGE_MATCHES` (Happy/Joyous/Ecstatic), `YIELD_CELEBRATION` |
| **Commanders (train, level, pack army, promotions, persist across Ages)** | `UNIT_ARMY_COMMANDER`, `CommanderExperience`→`_COMMANDER_LEVEL`, `EFFECT_ARMY_ADJUST_UNIT_CAPACITY`, `EFFECT_ADD_COMMANDER_WITH_UNITS`, `EFFECT_ARMY_ADJUST_COMMAND_RADIUS`, `EFFECT_CITY_ADJUST_YIELD_PER_COMMANDER_LEVEL` |
| **Ageless buildings / Overbuild / Obsolescence** | `EFFECT_CITY_ADJUST_OVERBUILD_PRODUCTION_MOD`, `REQUIREMENT_PLAYER_OVERBUILDS`. See `constructibles.md` |
| **Resource assignment / slots / caps** | `EFFECT_CITY_ADJUST_RESOURCE_CAP`, `REQUIREMENT_CITY_HAS_X_OPEN_RESOURCE_SLOTS`, `YIELD_ASSIGNED_FACTORY_RESOURCE`. See `resources-and-ages.md` |
| **Towns vs Cities + specializations + upgrade** | `EFFECT_EXP_TOWN`, `_TOWN_UPGRADE_DISCOUNT`, `YIELD_PER_NUM_TOWNS`. See `town-specialization-rollin.md` |
| **Specialists as adjacency multipliers** | `EFFECT_CITY_ADJUST_WORKER_YIELD`, `_SPECIALIST_CAP_PENALTY` |
| **Distant Lands / two-hemisphere continents** | `REQUIREMENT_CITY_IS_DISTANT_LANDS`, `YIELD_MOD_PER_NUM_DISTANT_LAND_SETTLEMENTS` |
| **Attribute trees + attribute points (6 domains + Wildcard)** | `YIELD_LEADER_ATTRIBUTE_POINT_*`, `YIELD_PER_ATTRIBUTE_TREE_UNLOCKED` |
| **Settlement cap / conquest / razing scaling** | `EFFECT_PLAYER_ADJUST_SETTLEMENT_CAP`, `YIELD_PER_CONQUERED_SETTLEMENT`, `_PER_RAZED_SETTLEMENT`. See `razing-and-conquest.md` |

## Worked example — Civ VI Great General vs Civ VII Commander
The clearest illustration of "same theme, opposite mechanic," and the case that proves the data-table caveat.

| | **Civ VI Great General** (`UNIT_GREAT_GENERAL`) | **Civ VII Commander** (`UNIT_ARMY_COMMANDER`) |
|---|---|---|
| What it is | A **Great Person** (civilian, `CanTrain="False"`, capturable) | A **standard trainable military unit** (civ replacements exist: `UNIT_LEGATUS`, `UNIT_HAZARAPATIS`) |
| How you get it | **You must generate a dedicated, type-specific resource — Great General Points** (`PSEUDOYIELD_GPP_GENERAL`, its own pool separate from Scientist/Merchant/etc.), from Encampment buildings, some wonders/policies, and specific civ/unit abilities; recruits the next *named historical* general | **Built/purchased** like any unit; no points |
| Named / era-locked | Yes — Boudica/Sun Tzu (`GREATPERSON_COMBAT_STRENGTH_AOE_CLASSICAL_LAND`), then Medieval/Renaissance/…; **only buffs same-era units → obsolesces** | No — stays relevant the whole game |
| Effect | Static **passive aura**: +5 Combat Strength + `ABILITY_GREAT_GENERAL_MOVEMENT` to *adjacent same-era* land units | **Command radius** projecting combat (`EFFECT_ARMY_ADJUST_COMMAND_RADIUS`) + boosts reinforce/movement/XP of its army |
| Signature | **One-shot Retire** ability, then expended | **Packs an army** — units stack into it for one-tile transport/deploy (kills the 1-unit-per-tile shuffle) |
| Progression | None; consumed | **Levels via Experience** into promotion/commendation trees; **persists across Ages**; even pays empire yields (`EFFECT_CITY_ADJUST_YIELD_PER_COMMANDER_LEVEL`, `EFFECT_AT_EXP_COMMANDER_*`) |

**One line:** Civ VI's Great General is a *typed-GPP-generated, era-locked, expendable Great Person* projecting a static
aura; Civ VII's Commander is a *trainable, permanently-leveling logistics unit* that carries the army, projects a
command radius, reinforces, and drags promotions across the whole game. The Civ VI general's lineage **split** in
Civ VII: persistent captain → Commander; expendable-named-hero flavor → civ-unique great people.

---
*Regenerate the evidence base after a patch/DLC: `python tools/gen-effects-catalog.py` (primitives) +
`python tools/gen-cards-catalog.py` (content). Re-verify any 🔷/❌ whose primitive set changed.*
