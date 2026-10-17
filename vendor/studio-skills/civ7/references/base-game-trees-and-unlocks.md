# Civ VII base-game progression trees & what each node unlocks + must-know base facts

Ground-truth reference for modders. Every claim cites an installed base-game data file under
`Base\modules\...` (root: `Sid Meier's Civilization VII`). READ-ONLY; verbatim from shipped XML.

**Data-file legend**
- Tech tree (nodes, cost, prereqs, unlocks): `age-{antiquity,exploration,modern}\data\progression-trees-tech.xml`
- Civic/culture tree: `age-*\data\progression-trees-culture-common.xml`
- Node-granted modifiers (free units etc.): `age-*\data\progression-trees-{tech,culture-common}-gameeffects.xml`
- Units: `age-antiquity\data\units.xml`, `base-standard\data\units.xml` (+ EX/MO age files)
- Starting units: `age-antiquity\data\advanced-start.xml`

Unlock rows are `<ProgressionTreeNodeUnlocks>` in each tree file: `TargetKind` =
`KIND_UNIT` / `KIND_CONSTRUCTIBLE` (building/wonder) / `KIND_MODIFIER` / `KIND_TRADITION` /
`KIND_PROJECT` / `KIND_DIPLOMATIC_ACTION`. `UnlockDepth="2"` = the node's second (deeper) tier.
Civ-unique unlocks carry `RequiredTraitType` and are omitted below (rows exist in the same files).

---

## PART 1 — Main shared trees per Age

Free/automatic grants are flagged **⭐GRANT**. Traditions (policy cards) are unlocked-to-slot, not free.
Every node also unlocks its named Tradition(s); only the most useful ones are listed to keep this tight.

### ANTIQUITY — TECH (`TREE_TECHS_AQ`)
Source: `age-antiquity\data\progression-trees-tech.xml`

| Node (readable) | Cost | Unlocks (units / buildings / wonders / notable) |
|---|---|---|
| Agriculture | 1 | Granary, Fishing Quay (free first tech) |
| Pottery | 70 | Brickyard; +wet-tile production mod |
| Animal Husbandry | 70 | Saw Pit; **UNIT_SLINGER** |
| Sailing | 70 | Harbor; **UNIT_GALLEY**; embarkation mod |
| Writing | 125 | Library; Science city project; Codex (great-work slot); espionage steal-tech |
| Irrigation | 125 | Garden; Wonder Hanging Gardens; **⭐settlement-cap +1** (`MOD_AQ_SETTLEMENT_CAP_INCREASE`) |
| Masonry | 125 | Ancient Walls, Monument; Wonder Pyramids; wall-strength |
| Currency | 245 | Bath, Market; Wonder Colossus; **⭐specialist(worker)-cap +1** (`MOD_AQ_SPECIALIST_CAP_INCREASE`); city-resource GDP |
| Bronze Working | 255 | Barracks; **UNIT_SPEARMAN, UNIT_ARCHER**; infantry-strength |
| Wheel | 245 | Villa; **UNIT_BALLISTA, UNIT_CHARIOT**; siege movement |
| Navigation | 430 | Lighthouse; Wonder Ha'amonga 'a Maui; **UNIT_QUADRIREME**; Chart the Stars project; naval-strength |
| Engineering | 430 | Amphitheater; Ancient Bridge |
| Military Training | 430 | Arena, Blacksmith; unit flanking; ranged/siege-strength |
| Mathematics | 738 | Academy; Wonder Pyramid of the Sun; Wonder Great Library; Spherical Earth project |
| Iron Working | 738 | **UNIT_HORSEMAN, UNIT_PHALANX** |
| Future Tech | 1255 | Repeatable; attribute point / science victory points |

### ANTIQUITY — CIVIC (`TREE_CIVICS_AQ_MAIN`)
Source: `age-antiquity\data\progression-trees-culture-common.xml`

| Node (readable) | Cost | Unlocks / notable |
|---|---|---|
| Chiefdom | 90 | Traditions (Charismatic Leader, Tool Making); reveals civ culture tree |
| Mysticism | 125 | Building Altar; **Pantheon unlock** (`MOD_PANTHEON_UNLOCK`); Wonder Great Stele |
| **Discipline** | 125 | **⭐FREE ARMY COMMANDER** (`MOD_DISCIPLINE_FREE_COMMANDER`) + unlocks UNIT_ARMY_COMMANDER; Wonder Dur-Sharrukin; Tradition Survey/Honor; Wonder Gate of All Nations |
| Public Life | 245 | Wonder Oracle; Tradition City Guard |
| Code of Laws | 245 | Wonder Petra; **UNIT_MERCHANT** unlock + **⭐FREE MERCHANT** (`MOD_AQ_FREE_MERCHANT`); improve-trade-relations diplo; ToT tradition slot |
| Tactics | 245 | Wonder Terracotta Army; Tradition Drills |
| Entertainment | 450 | Wonder Colosseum; **⭐settlement-cap +1**; celebration victory-points |
| Citizenship | 450 | Wonder Emile Bell; Culture city project; Tradition Drama & Poetry |
| Organized Military | 450 | Wonder Mausoleum of Theodoric; **⭐settlement-cap +1** |
| Literacy | 600 | Wonder Nalanda; Codex civic; literacy science-VP |
| Skilled Trades | 600 | Wonder Sanchi Stupa; Tradition Coinage; GDP mod |
| Philosophy | 750 | Wonder Angkor Wat; Tradition Scholars |
| Commerce | 750 | Wonder Monks Mound; Tradition Commodities/Medicine |
| Future Civic | 1000 | Repeatable; attribute / culture-VP |

### EXPLORATION — TECH (`TREE_TECHS_EX`)
Source: `age-exploration\data\progression-trees-tech.xml`

| Node (readable) | Cost | Unlocks / notable |
|---|---|---|
| Cartography | 525 | Wharf; ocean-command mod |
| Astronomy | 525 | Observatory; **UNIT_FLEET_COMMANDER** (the naval commander) |
| Machinery | 525 | Gristmill, Sawmill |
| Guilds | 870 | Guildhall, Kiln; Relic slot mod; trade-range |
| Feudalism | 870 | Tavern; Medieval Bridge; **⭐settlement-cap +1** (`MOD_EX_SETTLEMENT_CAP_INCREASE`) |
| Heraldry | 870 | **UNIT_KNIGHT, UNIT_MAN_AT_ARMS, UNIT_PRIVATEER**; Relic |
| Castles | 870 | Dungeon, Medieval Walls; **UNIT_CROSSBOWMAN** |
| Education | 1300 | University; Wonder Shwedagon Zedi Daw; **⭐specialist-cap +1**; Relic; Heliocentric Model project |
| Shipbuilding | 1300 | Shipyard; **UNIT_CARRACK**; ocean travel (no damage/obstacle) |
| Metallurgy | 1300 | Armorer; **UNIT_TREBUCHET** |
| Architecture | 1900 | Menagerie, Pavilion; Wonder Forbidden City; Relic slot (Pavilion) |
| Metal Casting | 1900 | **UNIT_LANCER, UNIT_PIKEMAN** |
| Urban Planning | 3625 | Bank, Hospital; Wonder Machu Picchu; **⭐specialist-cap +1**; Invent Calculus project |
| Gunpowder | 3625 | **UNIT_ARQUEBUSIER, UNIT_BOMBARD, UNIT_GALLEON, UNIT_PRIVATEER_2** |
| Future Tech | 4250 | Repeatable |

### EXPLORATION — CIVIC (`TREE_CIVICS_EX_MAIN` + Theology branch)
Source: `age-exploration\data\progression-trees-culture-common.xml`

| Node (readable) | Cost | Unlocks / notable |
|---|---|---|
| Economics | 700 | Tradition Maritime Law |
| Piety | 700 | **Building Temple** (religion path); Tradition Commune |
| Mercantilism | 900 | Wonder Tomb of Askia; Tradition Trade Winds |
| Authority | 900 | Wonder Erdene Zuu; ToT tradition slot; counter-spy diplo |
| Inspiration | 900 | Wonder Hale o Keawe; Tradition Renaissance |
| Colonialism | 1300 | Wonder El Escorial; **⭐settlement-cap +1**; Relic; Tradition Charters |
| Bureaucracy | 1300 | Wonder Borobudur; Tradition Constitution |
| Diplomatic Service | 1300 | Wonder Brihadeeswarar Temple; Tradition Heqin |
| Society | 1300 | Wonder House of Wisdom; **⭐settlement-cap +1**; Relic; Tradition Patronage |
| Imperialism | 2100 | Wonder White Tower; **⭐settlement-cap +1**; Tradition Indenture/Tariffs |
| Sovereignty | 2100 | **⭐settlement-cap +1**; Relic; Tradition Divine Right/Regulars |
| Social Class | 2100 | Wonder Notre Dame; **⭐settlement-cap +1**; Tradition Chivalry/Enlightenment |
| Future Civic | 3000 | Repeatable |
| *Theology (branch)* | 700 | Tradition Evangelism; **Reformation belief** mod; Relic |
| *Reformation (branch)* | 900 | Tradition Rationalism/Religious Orders; convert-population diplo |

### MODERN — TECH (`TREE_TECHS_MO`)
Source: `age-modern\data\progression-trees-tech.xml`

| Node (readable) | Cost | Unlocks / notable |
|---|---|---|
| Academics | 1400 | Schoolhouse; Wonder Oxford University |
| Steam Engine | 1400 | Ironworks, Port; **UNIT_IRONCLAD** |
| Military Science | 1400 | Defensive Fortifications, Military Academy; Wonder Red Fort |
| Electricity | 2425 | Laboratory; **⭐specialist-cap +1** (`MOD_MO_SPECIALIST_CAP_INCREASE`) |
| Urbanization | 2425 | Department Store, Opera House, Modern Bridge; **⭐settlement-cap +1** |
| Combustion | 2425 | **UNIT_CRUISER, UNIT_DREADNOUGHT, UNIT_LANDSHIP** |
| Industrialization | 2425 | Rail Station; **UNIT_FIELD_GUN, UNIT_HEAVY_ARTILLERY, UNIT_RIFLEMAN** |
| Radio | 3000 | Radio Station, Tenement; Wonder Eiffel Tower; Crewed Space Flight research |
| Flight | 3000 | Airfield; **UNIT_SQUADRON_COMMANDER** (air commander); **UNIT_BIPLANE, UNIT_BOMBER, UNIT_TRENCH_FIGHTER** |
| Mass Production | 3000 | Cannery, **Factory**; factory-resource GDP; **⭐settlement-cap +1** |
| Computation | 4000 | Stock Exchange; specialist happiness mod |
| Mobilization | 4000 | **UNIT_CARRIER_COMMANDER** (carrier commander); **UNIT_BATTLESHIP, UNIT_DESTROYER, UNIT_SUBMARINE** |
| Armor | 4000 | **UNIT_TANK, UNIT_INFANTRY_COMPANY, UNIT_AT_GUN, UNIT_ASSAULT_GUN** |
| Aerodynamics | 6000 | **UNIT_FIGHTER, UNIT_DIVEBOMBER, UNIT_HEAVY_BOMBER**; Break Sound Barrier project |
| Rocketry | 8500 | Launch Pad; **Launch Satellite / Crewed Space Flight prep** projects (science victory) |
| Nuclear Fission | 8500 | Wonder Manhattan Project |
| Future Tech | 10000 | Repeatable |

### MODERN — CIVIC (`TREE_CIVICS_MO_MAIN` + ideology branches)
Source: `age-modern\data\progression-trees-culture-common.xml`

| Node (readable) | Cost | Unlocks / notable |
|---|---|---|
| Modernization | 1600 | Wonder Hermitage; Tradition Civil Engineering |
| Natural History | 1600 | **Building Museum**; **UNIT_EXPLORER** (archaeology); open Exploration-age archaeology; explorer sight |
| Social Question | 1600 | Wonder Dogo Onsen; Tradition Humanism |
| Political Theory | 2750 | ToT tradition slot; **⭐unlock IDEOLOGIES** (`MOD_MO_UNLOCK_IDEOLOGIES`); Wonder Doi Suthep |
| Globalism | 3750 | Wonder Palacio de Bellas Artes; **⭐settlement-cap +1**; Tradition Ambassadors |
| Nationalism | 3750 | Wonder Taj Mahal; **⭐settlement-cap +1**; Tradition Demagogy |
| Capitalism | 7500 | Wonder Statue of Liberty; **⭐specialist-cap +1**; resource/tourism VP |
| Militarism | 7500 | Wonder Brandenburg Gate; GDP mod; Tradition Materiel/Trenchworks |
| Hegemony | 7500 | Wonder World's Fair; open Antiquity-age archaeology; **⭐settlement-cap +1** |
| Future Civic | 8000 | Repeatable; Artifact great-work mod |
| *Ideology branches* (Democracy / Fascism / Communism, each 3 nodes) | 2750–4500 | Government-flavored Traditions + free-unit mods (e.g. `MOD_DEMOCRACY_RIFLEMEN`, `MOD_FASCISM_LANDSHIP`, `MOD_COMMUNISM_AT_GUNS`) — gated behind Political Theory's ideology unlock |

---

## PART 2 — Key base units & how you get them

Source: `base-standard\data\units.xml` (core roster) and `age-antiquity\data\units.xml` (Warrior/Slinger).

| Unit | CoreClass / role | How obtained |
|---|---|---|
| **Scout** | `CORE_CLASS_RECON` | Available from game start (base-standard); one of the allowed free starting units (`advanced-start.xml` AllowedFreeUnits) |
| **Warrior** | `CORE_CLASS_MILITARY`, Tier 1 | Default-trainable from start — **no tree node gates it** (defined in `age-antiquity\units.xml`); also an allowed free starting unit |
| **Slinger** | `CORE_CLASS_MILITARY` (ranged) | Unlocked by **Animal Husbandry** tech (AQ) |
| **Settler** | `CORE_CLASS_SUPPORT`, `FoundCity="true"` | Trainable once city `PrereqPopulation="5"`; no tree node. Cost scales with settlement count |
| **Migrant** | `CORE_CLASS_CIVILIAN`, `CanTrain="false"` | Not trainable — produced by growth/town mechanics; founds/adds to towns |
| **Merchant** | `CORE_CLASS_CIVILIAN`, `MakeTradeRoute="true"` | Unlocked by **Code of Laws** civic (AQ); one granted free there (`MOD_AQ_FREE_MERCHANT`) |
| *(No Builder)* | — | Civ VII has **no Builder unit**; tile improvements are auto-built by cities |

### Commander line (`FORMATION_CLASS_COMMAND`, all `AGELESS`, gain XP, level up)
| Commander | Domain / PromotionClass | Unlocked by |
|---|---|---|
| **Army Commander** | Land / `PROMOTION_CLASS_LAND_COMMANDER` | **Discipline civic (AQ)** — unlocks the unit AND **grants one free** via `MOD_DISCIPLINE_FREE_COMMANDER` |
| **Fleet Commander** | Sea / `PROMOTION_CLASS_NAVAL_COMMANDER` | **Astronomy** tech (EX) |
| **Squadron Commander** | Air / `PROMOTION_CLASS_AIR_COMMANDER` | **Flight** tech (MO) |
| **Carrier Commander** | Sea / `PROMOTION_CLASS_CARRIER_COMMANDER` | **Mobilization** tech (MO) |

**Free-Commander confirmation (the headline fact):**
`age-antiquity\data\progression-trees-culture-common.xml` line 81 attaches `MOD_DISCIPLINE_FREE_COMMANDER`
to `NODE_CIVIC_AQ_MAIN_DISCIPLINE`. The modifier
(`age-antiquity\data\progression-trees-culture-common-gameeffects.xml` line 10):
`collection="COLLECTION_PLAYER_CAPITAL_CITY" effect="EFFECT_CITY_GRANT_UNIT" run-once="true" permanent="true"`,
`UnitType=UNIT_ARMY_COMMANDER`, `Amount=1`. So completing the **Discipline** civic drops **one free Army
Commander in your capital, once.** ✅ Confirmed from data.

---

## PART 3 — Must-know base facts a modder keeps getting wrong

| # | Fact | Status | Citation |
|---|---|---|---|
| 1 | **Discipline civic grants a free Army Commander** (capital, once) — plus unlocks the unit. | ✅ | `age-antiquity\...\progression-trees-culture-common.xml` L81 + `...-gameeffects.xml` L10 |
| 2 | **Code of Laws civic also grants a free Merchant** (`MOD_AQ_FREE_MERCHANT`, capital, once). Lesser-known second AQ freebie. | ✅ | same tree files, L92 / gameeffects L16 |
| 3 | There are exactly **4 victory/legacy paths per age: Culture, Military, Science, Economic** — NOT 6. | ✅ | `age-antiquity\data\gameplay.xml` L4-7 (`LEGACY_PATH_ANTIQUITY_{CULTURE,MILITARY,SCIENCE,ECONOMIC}`) |
| 4 | There are exactly **6 City-State (independent) types: Cultural, Diplomatic, Economic, Expansionist, Militaristic, Scientific** — there is **no "Religious"** type. | ✅ | distinct `CITY_STATE_*_BONUS` categories across `age-*\data\independents.xml` |
| 5 | **Great Works are age-locked to a single object type**: Antiquity = `GREATWORKOBJECT_WRITING` (Codex), Exploration = `RELIC`, Modern = `ARTIFACT`. They must be slotted in buildings/wonders. | ✅ | `age-{antiquity,exploration,modern}\data\greatworks.xml` (each file uses exactly one object type) |
| 6 | **Culture/relic path runs through religion**: Temple (and thus relics) is gated behind the **Piety** civic (EX), not a tech. | ✅ | `age-exploration\...\progression-trees-culture-common.xml` (Piety → `BUILDING_TEMPLE`) |
| 7 | **Card/bonus unlocks come from tree nodes** via `<ProgressionTreeNodeUnlocks>` rows (`TargetKind` = UNIT/CONSTRUCTIBLE/MODIFIER/TRADITION/PROJECT/DIPLOMATIC_ACTION). Traditions are *unlocked to slot*, not auto-granted. | ✅ | all `progression-trees-*.xml` |
| 8 | **Settlement cap is raised +1 per node** by `EFFECT_PLAYER_ADJUST_SETTLEMENT_CAP` (`MOD_*_SETTLEMENT_CAP_INCREASE`), attached to *many* nodes each age (AQ: Irrigation tech, Entertainment & Org-Military civics; several in EX/MO). It is not a single fixed value. | ✅ | `age-antiquity\...\progression-trees-tech-gameeffects.xml` L4 + numerous unlock rows |
| 9 | **Specialist cap** is a separate lever: `EFFECT_CITY_ADJUST_WORKER_CAP` (`MOD_*_SPECIALIST_CAP_INCREASE`), +1 per node (AQ Currency, EX Education/Urban Planning, MO Electricity/Capitalism). "Specialist" = "worker" in the effect name. | ✅ | same gameeffects file L8 |
| 10 | **There is no Builder unit** and **no universal worker** — tile improvements auto-build. Civilian roster is Scout/Settler/Migrant/Merchant + commanders. | ✅ | `base-standard\data\units.xml` (no `UNIT_BUILDER`) |
| 11 | **Warrior is not tech-gated** — it's a Tier-1 default-trainable available from turn 1; only Slinger (Animal Husbandry) and later units are node-gated. | ✅ | `age-antiquity\data\units.xml` L125 (no unlock row for Warrior) |
| 12 | **Starting free units = Scout + Warrior** (player picks from AllowedFreeUnits; `FreeUnits="1"`), plus `UNIT_FOUNDER` at Antiquity start. | ✅ | `age-antiquity\data\advanced-start.xml` |
| 13 | **Pantheon is unlocked by the Mysticism civic** (`MOD_PANTHEON_UNLOCK`), and full religion/ideology systems unlock later (Ideologies via **Political Theory** civic, MO). | ✅ | AQ culture tree L73; MO culture tree (`MOD_MO_UNLOCK_IDEOLOGIES`) |
| 14 | **`Future Tech`/`Future Civic` are repeatable** end nodes (`Repeatable="true"`, cost re-scales) granting attribute points / victory points — not dead ends. | ✅ | each tree's final node row |
| 15 | Node **`UnlockDepth="2"`** unlocks are the node's deeper tier (revealed after first investment) — a modder inserting unlocks must set this correctly or the item appears at the wrong tier. | ✅ | ubiquitous in `progression-trees-*.xml` |
