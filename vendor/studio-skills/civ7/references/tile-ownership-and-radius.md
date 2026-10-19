# Tile ownership, the swap mechanic, and the 3-hex radius

> ## 🏆 SOLVED 2026-08-15 (1.4.2 build 1290193) — READ THIS FIRST
>
> **A city CAN build on, bank, and staff tiles at rings 4–5. Proven end to end in-game and durable
> across save/reload.** Everything below this box that says otherwise is superseded; it is kept
> because the probe history is still the record of what does *not* work.
>
> **The chain:**
> 1. **Ownership** — the shipped Surveyor's `UNITCOMMAND_CLAIM_RESOURCE` claims "a path of tiles back
>    to the Settlement", and those path tiles are **genuine city territory** (tooltip names the city).
> 2. **Construction** — from a mod `<UIScripts>` file, on a tile the city ALREADY OWNS:
>    ```js
>    const cityID = GameplayMap.getOwningCityFromXY(loc.x, loc.y);   // the adopting city
>    // 1) urban district FIRST if the tile is still rural, 2) then the building. BOTH need Parent.
>    Game.PlayerOperations.sendRequest(owner, "CREATE_ELEMENT",
>        {Kind:"DISTRICT", Type:"DISTRICT_URBAN", Location:loc, Owner:owner, Parent:cityID});
>    Game.PlayerOperations.sendRequest(owner, "CREATE_ELEMENT",
>        {Kind:"CONSTRUCTIBLE", Type:"BUILDING_…", Location:loc, Owner:owner, Parent:cityID});
>    ```
>    ⛔⛔ **`Parent` NAMES THE CITY THAT ADOPTS THE ELEMENT, AND OMITTING IT IS THE #1 CAUSE OF THE
>    "ORPHAN" FAILURE.** Without it the building is created and RENDERS CORRECTLY, but **no city banks
>    its yields and the build menu still offers the building** — the city does not know it exists.
>    With it, the city's own breakdown itemises it under *From Buildings* and it survives save/reload
>    (proven in play 2026-08-19, 1.4.2: `Monument +3 Culture / +2 Influence` on a RING-4 tile).
>    ⚠ **WHY THIS IS EASY TO MISS:** `base-standard/ui/tuner-input/tuner-input.js` contains BOTH shapes —
>    its **Map Panel** branch (place at a clicked location) omits `Parent`, while its **City Panel**
>    branches (lines ~226-287) pass `args.Parent = …selectedCity`. Copying the map-placement branch,
>    which is the one whose framing matches "put a thing on a tile", silently gives you the orphan form.
>    ➡ **METHOD RULE: when lifting an API's argument shape from an example, read EVERY call site of that
>    API in the file — the optional arguments live in the branches whose framing does not match yours.**
>    ⛔ And on owned-but-RURAL ground the **urban district must come first**: sending only the
>    CONSTRUCTIBLE attaches it to the RURAL district, so the tile still reads "Rural", the building gets
>    NO model, and the city files its yields under *From Improvements* instead of *From Buildings*.
> 3. **Income** — the city banks the building's yields, itemised in its own breakdown under
>    *From Buildings*, **with no population assigned to the tile**. (Test: Monument at ring 4 →
>    `+4 Culture / +2 Influence`, specialists 0.)
> 4. **Staffing** — once specialists are unlocked, a specialist can be assigned to that distant urban
>    district **through the ordinary placement UI**, no RPC involved.
>
> **⛔ THE LAW THAT WAS WRONG.** "Population assignment is capped at ring 3" is true **only of
> ACQUIRING land** — `CityCommandTypes.EXPAND`, which claims + improves + populates in one step. It is
> **NOT** true of assigning a specialist to an urban district the city **already owns**:
> `city.Workers.GetAllPlacementInfo()` enumerates the city's urban districts **regardless of distance**.
> The years of "empty outer tiles are a dead end" reasoning came from testing `DISTRICT_RURAL`, the one
> district class that is **not** `Workable="true"` in districts.xml and therefore genuinely does need a
> citizen. **Build urban, not rural.**
>
> **⚠ WHAT CREATE_ELEMENT DOES NOT ENFORCE — plan for all of it.** No distance cap, no placement rule
> set, and **no tech prerequisite** (it placed a Monument 12 turns before Masonry was researched).
> `canStart` returns `Success:true` throughout. A shipped feature must supply every gate itself.
>
> **⛔ METHOD LESSON.** These RPCs are **queued to the simulation** — a read in the same tick as
> `sendRequest` reports the OLD state. A litmus that logged `district now = none` after every step was
> reading too early; the district existed. Re-read on the next press or on `DistrictAddedToMap`, and
> never trust a same-tick after-read. (Also: a mod UIScript's `console.log` reaches no log file — read
> out via an on-screen panel.)
>
> **⛔ RURAL IS CLOSED — don't retry it.** `Workable="true"` sits on `DISTRICT_URBAN` and
> `DISTRICT_CITY_CENTER` and is absent from `DISTRICT_RURAL`, and that is a hard gate: raising a
> district's specialist capacity with `EFFECT_DISTRICT_ADJUST_WORKER_CAP` (verified firing — urban
> tiles went `0/1` → `0/3`) still leaves **no rural tile ever offered** in the placement picker.
> Claiming and improving outer rural tiles both work; nobody can ever be put on them. **Outer land is
> usable only as URBAN districts.**
>
> **Also proven live and data-only:** `EFFECT_UNIT_GRANT_UNASSIGNED_WORKERS` (unit-scoped) grants
> unassigned population, and `EFFECT_DISTRICT_ADJUST_WORKER_CAP` raises per-tile specialist capacity
> with plot-level targeting — see section 6.
>
> **❌ What does NOT work:** `EFFECT_UNIT_GRANT_FREE_BUILDING_IGNORE` from a fake Great Person places
> nothing (controlled negative: co-fired 4-population control fired, all four probe buildings unlocked
> and unbuilt, no placement and no free-build discount). **The UIScript RPC is the only way to put a
> building on a chosen tile.**
>
> **🔴 THIS RULE IS WITHDRAWN — IT WAS A MISSING ARGUMENT, NOT AN ENGINE RULE (disproved in play
> 2026-08-19, 1.4.2).** The old text read: *"NEVER CREATE_ELEMENT on an unowned tile — it grants
> ownership to the player, no city ever adopts it, and the expand picker never offers it again."*
> Every test behind that ran **without `Parent`**.
>
> **With `Parent: <cityID>`, a city ADOPTS an unowned tile.** Ring-4 unowned plot, one district + one
> building, both parented to the nearest city: owner went `-1 -> 0`, an owning city appeared, and the
> city's own breakdown itemised `Monument +4 Culture / +2 Influence` under *From Buildings*.
> ```js
> const city = <the adopting city's ComponentID>;      // on unowned ground you must NAME it —
>                                                      // getOwningCityFromXY returns nothing
> sendRequest(owner,"CREATE_ELEMENT",{Kind:"DISTRICT",Type:"DISTRICT_URBAN",Location:loc,Owner:owner,Parent:city});
> sendRequest(owner,"CREATE_ELEMENT",{Kind:"CONSTRUCTIBLE",Type:"BUILDING_…",Location:loc,Owner:owner,Parent:city});
> ```
> ➡ **The "orphan" IS the Parent-less form.** A tile that no city adopts is what you get when nothing
> tells the engine which city should adopt it.
>
> ⚠ **STILL UNVERIFIED for the unowned case** — verify before shipping anything on it: save/reload;
> whether it works at ranges beyond ring 4; whether the tile behaves normally afterwards (worked,
> expand picker, age transition, capture/raze); AI and multiplayer behaviour. And note there is then
> **no engine-side cost or range limit at all** on claiming this way, so any throttle must be designed
> in deliberately. Tested
> across turns with adjacencies 0–2: the tile stays a player-owned orphan and the city's EXPAND picker
> never offers it again, so seizing effectively deletes a tile from the city's reach. ✅ It is
> **reversible**: `sendRequest(owner, "DESTROY_ELEMENT", {Kind:"DISTRICT", Owner, LocalID})` releases
> the tile back to unowned and the city can then expand onto it normally. (That pair is also a complete
> raze-and-rebuild primitive.) **Only ever place on tiles a city already owns; ownership beyond ring 3
> comes from the Surveyor's claim and nothing else.**

Everything here was extracted from the **installed base-game code** (not docs), plus
the Civ6 "Neighborhood Tall Extension" mod source. Trust it over wiki/forum claims,
which are stale or wrong on this topic.

> **🏁 STATUS OF THE *DATA-ONLY CLAIM* QUESTION (2026-07-04, full Civ6-vs-Civ7 engine re-audit +
> probe v3 in-game) — still current, and narrower than it sounds: NO data-only claim/ownership
> primitive exists. (Ownership is nevertheless SOLVED, by the Surveyor's native claim — see the box
> above. This section is about granting a plot from GameEffects, which remains dead.)** The last untested shape, `EFFECT_GRANT_PLOT` with a UNIT as modifier owner
> (Civ 6's native contract: dummy unit spawned at the target plot, birth modifier grants the
> plot it stands on), was probed 2026-07-04 via UnitAbilityModifiers on UNIT_SCOUT
> (run-once-at-creation on a story-spawned unit at an unowned dist-4/5 tile + continuous ±
> Amount variants) — **dead in all of them**, making GRANT_PLOT no-op in all five contexts
> (plot/city/player/story/unit). Every Civ 6 route ran through the gameplay script VM, which
> Civ 7 walls off (section 4a). Remaining routes = scenario ship (claimPlot works there) or a
> patch. Unit-scoped probe recipe, reusable for any suspected unit-anchored effect: custom
> KIND_ABILITY + UNIT_CLASS tag on a base unit (TypeTags + UnitClass_Abilities +
> UnitAbilityModifiers rows) attaching the suspect modifier with COLLECTION_OWNER; deliver an
> aimed at-creation firing via a disband-triggered REQUISITE story whose reward is
> EFFECT_PLAYER_GRANT_UNIT_AT_PLOT, and pair every tracer with a proven co-reward (e.g.
> EFFECT_PLOT_PLACE_RESOURCE) so "story fired but effect didn't" is distinguishable.
> Also grounded that day: Civ 7 has NO plot-property setter (the Civ 6 yield-siphon bridge
> can't be assembled — irrelevant anyway, owned tiles self-work at any distance), and no
> gameplay-script modinfo action exists in any installed Base/DLC/workshop modinfo.

## 0. ⛔ SETTLEMENT RADIUS BANDS OVERLAP — "one owner per tile" is a bug shape

Any mod that sweeps a ring band around each settlement (candidate tiles, claimable ground, a planner,
a map overlay) hits this the moment the player founds a **second** settlement: the bands intersect, so
a tile can sit in two at once. The tempting shape is a `Map<plotIndex, owner>` with a
`if (owner.has(plotIndex)) continue;` guard — and that silently awards every contested tile to
whichever settlement came first out of `player.Cities.getCityIds()`, which is **founding order**, so in
practice always the capital.

⚠ **IT ONLY BITES UNOWNED GROUND.** An already-owned tile answers `GameplayMap.getOwningCityFromXY`
for exactly one settlement, so there is nothing to contest and the bug hides completely in any test
run inside existing borders. It appears only out past the working radius — which is exactly where a
reach mod lives.

⚠⚠ **AND IT PRESENTS AS TWO UNRELATED BUGS.** Downstream, "which settlement owns this tile" usually
feeds several gates. When the answer is wrong, every gate is wrong in a different direction at once —
e.g. a feature missing from settlement B's list *and* a row that should have been hidden staying
visible there. They share one cause; chasing them separately wastes rounds.

**What actually works** (proven in play 2026-09-13, a ring-4/5 build planner):
- Keep **two** structures: a single default owner for contexts with no settlement in hand (a click on
  the map carries none), and a **list of every settlement that reaches the tile** for per-settlement UI.
- Offer a contested tile on **every** eligible settlement's screen and let the player's action decide;
  record the chosen settlement on the claim, since unowned ground cannot answer the question later.
- Guard the other direction: once claimed, drop it from every other settlement's list, or two
  settlements plan the same ground.
- For the single default: **nearest wins, and a CITY beats a TOWN at any distance.** Towns cannot
  produce (`CityOnly` projects), so handing contested ground to a nearer town removes it from every
  list in the game rather than moving it to the right one. Break ties by keeping the incumbent so the
  answer does not shift between scans.

## 1. The native cross-city "swap" IS real (wiki says otherwise — it's wrong)

A settlement's **Expand / place-population picker** can reassign a tile that is
**already owned by another of YOUR settlements** into the picking city's borders.
In-game this looks like: the orange "claimable" ring includes a tile whose tooltip
still names a different city of yours; picking it transfers ownership.

- This is NOT Civ6-style gold tile purchase, and NOT permanent-ownership.
- The claimable plot set comes from the **native engine**:
  `Game.CityCommands.canStart(cityID, CityCommandTypes.EXPAND, {}, false)` →
  `result.Plots`. See `base-standard/ui/place-population/model-place-population.js`
  (`updateExpandPlots`). The JS only *renders* `result.Plots`; it does not decide
  them.
- Implication for modders: the eligibility rule (which owned tiles can be pulled,
  and the distance) lives in compiled C++. **You cannot change it from XML or JS.**

## 2. The "3-hex limit" is an EXPANSION cap, NOT a working cap (corrected 2026-06-30; ⚠ RE-CORRECTED 2026-07-03)

> **Controlled FireTuner matrix (4 tiles) — the definitive model:**
> `city.Growth.claimPlot({x,y})` is the engine's **full expansion primitive**, not a bare
> ownership flip. Each call: claims the tile + attaches it to the city as **Rural** +
> **auto-places the terrain-appropriate improvement** (vegetated→Woodcutter,
> mountain→Expedition Base, resource→its real improvement e.g. Plantation, coastal
> water→Fishing Boat) + the city collects the full tile yields **same turn**, including
> all mod plot-modifiers, which apply the moment the tile is owned. Resources join the
> city pool; one claim even minted +1 rural population. Works at **distance 4 AND 5,
> non-contiguously (across unowned gaps), and on water**. City yield delta matched the
> tile tooltip total exactly on all 4 test tiles.
>
> **Unified model reconciling every prior test:** ownership alone ≠ yields (the WASET
> "dead" tile was grabbed by CLAIM_RESOURCE's territory side-effect and never
> auto-improved); an **improved** rural tile pays at any distance; the range-3 cap only
> blocks **player-driven** improving/pop-placement. So "empty outer tiles are a dead
> end" (section 5) is wrong for claimPlot-claimed tiles — they self-improve. The delivery wall
> (gameplay isolate unreachable by mods, section 4a) is UNCHANGED on 1.4.1 and is the only
> thing keeping this out of a shippable mod; it works fully in FireTuner and scenarios.

⚠ **Reframed by in-game testing** — the original "work radius is 3" reading was
imprecise. The truth:
- The **3-hex limit caps natural border EXPANSION/acquisition** — the `EXPAND` picker
  (`Game.CityCommands.canStart(...EXPAND)`), growth events, and leapfrogging all
  refuse to hand out tiles past distance 3.
- It is **NOT a cap on WORKING tiles.** Once a city *owns* a tile by any means, the
  engine assigns citizens and collects its yields normally **at any distance**.
- **PROVEN 2026-06-30 (FireTuner):** `city.Growth.claimPlot({x,y})` grants ownership
  below the expansion cap (claimed **dist-4** tiles); Madrid's per-turn yields then
  **rose with each claim, same turn, no turn passing** (Food 8→10, Prod 10→13, Gold
  7→8.7, Sci 0→1, Cult 8→12, Happy 14→16 over 4 dist-4 claims). The engine works
  owned ring-4 tiles natively.
- **Consequence:** a Civ7 3→5 mod needs ONLY to *claim* ring-4/5 tiles for tall
  cities — **no yield injection, no dummy specialists** (unlike the Civ6 mod, whose
  *working* layer WAS radius-capped, section 4). Dramatically lighter than Civ6.
- **SHIPPABLE as a data-only feature (a "Surveyor"-style claim unit):** the
  general claimPlot route needs a gameplay-script isolate mods can't reach, but the base
  Prospector **`UNITCOMMAND_CLAIM_RESOURCE`** claims a **resource** tile ≤5 hexes into your
  borders with pure data — port that ability chain onto a buildable civilian and you have a
  tall "reach" unit. Resource tiles only; empty ring-4/5 tiles stay unworkable (3-hex work
  radius holds). Full build recipe — the ability-chain port, charges, icons, visuals, AI —
  in [custom-units.md](custom-units.md).

The original notes below remain true for *natural* expansion:
- A settlement only ever **naturally expands to** tiles within **3 hexes** of its City Center.
- **There is NO GlobalParameter for it.** Grepping every module under
  `Base/modules/**/data` for `name="..._RADIUS/RANGE/EXPAND/EXPANSION..." value="N"`
  yields nothing for city work range. The only radius-ish strings are diplomacy
  land-claim args (`CityRadius`, `CapitalRadius` in `diplomacy-gameeffects.xml`).
- The game binaries contain only `CityRadius` (the diplomacy arg) — no
  `CityWorkRange` / `ExpansionRadius` / `WorkableRadius` tunable.
- There is **no `EFFECT_*` to widen the radius** ("grant extra space/extent" does
  not exist). Confirmed engine-side and not data-exposed.

So: a Civ6-style "just bump the work range to 5" mod is **impossible** via the
database/GameEffects layer in Civ7.

## 3. The only data-driven claim system is diplomacy land-claim (different thing)

`EFFECT_START_LAND_CLAIM` / `EFFECT_COMPLETE_LAND_CLAIM`, driven by
`LAND_CLAIM_RANGE_PER_STEP="2"` and `LAND_CLAIM_STEPS="1"`
(`base-standard/data/diplomacy-actions.xml`). These are `Replace`-able params and
real attachable effects — but they govern claiming **another civilization's** tiles
via a diplomatic action, not extending your own city's reach. Not a radius lever.

## 4. How Civ6 actually did 3→5 (and what a Civ7 port would need)

The Civ6 mod **Cyp "Wide and Tall"** (Steam workshop `2706527619`,
`Scripts/CypWt_Script_NeighborhoodTe.lua`) did **NOT** change the engine work
radius. It **simulated** rings 4–5 entirely in Lua:

1. **Real ownership of ring 4–5 plots** via `WorldBuilder.CityManager():SetPlotOwner(x,y,player,city)`,
   gated to `iDistance >= 4 and <= 5` (`CypWtNbhTeSwapTile`, `CypWtNbhTePurchasePlot`).
2. **Picked which outer tiles to "work"** by population + plot score across rings 1–5
   (`CypWtNbhTeDetermineAutoAssignedOuterRingWorkers`).
3. **Injected the would-be yields onto the City Center plot** via plot Properties
   (binary-encoded), minus a "specialist compensation" malus so it nets correctly.
4. **Consumed real population** by creating dummy specialist buildings
   (`BUILDING_CYP_WT_POPULATION_WORKERS_n`, binary-encoded count) so the fake
   working actually costs pop.
5. **Recomputed on events** — `Events.PlotYieldChanged / CityWorkerChanged /
   CityTileOwnershipChanged / CityFocusChanged` + custom `GameEvents.CypWt_CC_*`.

It was a scripted illusion layered on the engine, not a radius change. (This is the
"very experimental, not really in the codebase" approach.)

### Civ7 port feasibility — UPGRADED 2026-06-30: all the scripting primitives EXIST

Researched against the **Civ VII Development Tools** (the modding SDK; installed at
`steamapps/common/Sid Meier's Civilization VII Development Tools/` — `Reference/`
holds de-obfuscated base `.ts` source, `Documentation/` the official modinfo docs,
`FireTuner/` the live console). Every Civ6 primitive has a Civ7 equivalent:

1. **Gameplay-context script vehicle = modinfo `<ScenarioScripts>` action.** Docs
   (`Documentation/modinfo Files.md`): "Adds a new `.js` gameplay script." This is a
   **persistent gameplay-context** script — distinct from `<MapGenScripts>` (loaded
   during map gen then unloaded) and `<UIScripts>` (UI context, read-mostly). It runs
   where state can be MUTATED. The base game's own gameplay scripts
   (`scripts/age-transition-post-load.js`, `maps/map-utilities.js`) run in this
   context and freely mutate: claim plots, regress cities to towns, cap gold, place
   units. (No base *modinfo* uses `ScenarioScripts` — base gameplay scripts load via
   the age/map system — but the action type is documented and supported for mods.)
2. **Plot-ownership API (no WorldBuilder needed) = `city.Growth.claimPlot({x,y})`.**
   A real runtime method on the City Growth component, used by base map code
   (`map-utilities.js:449` `placeRuralDistrict` → `city.Growth?.claimPlot(...)`). This
   is the clean legitimate path and BETTER than the WorldBuilder route. ⚠ It is
   **undocumented in the public typings** (no `.d.ts` signature; present in the engine
   only) — so behaviour must be confirmed live. `WorldBuilder.MapPlots.setOwnership`
   (`tuner-input.js`) remains a fallback.
3. **Live event hooks = `engine.on(...)`** — confirmed present:
   `PlayerTurnActivated`, `PlayerTurnDeactivated`, `CityAddedToMap`,
   `CityInitialized`, `CityProductionChanged`, **`PlotOwnershipChanged`**. Direct
   equivalents of the Civ6 `Events.*` the NBH-TE mod hooked.
4. **FireTuner** (in the Dev Tools) = live JS/console to TEST the API before building.

**✅ CONFIRMED IN-GAME 2026-06-30 (FireTuner):** `claimPlot` does NOT enforce the
3-hex cap. Called `city.Growth.claimPlot({x,y})` on **distance-4** tiles in a live
1.4.1 game (Tuner context); ownership flipped — `GameplayMap.getOwner` returned the
human player (pid 0) for tiles at dist 4 from the city center (e.g. city (38,11) →
owned (36,7),(37,7), both dist 4), and the map border visibly recolored. **The
3-hex radius wall IS breakable from a gameplay script via `claimPlot`.** This was the
make-or-break question — answered YES.

FireTuner notes for re-testing: context dropdown = **Tuner** (the gameplay sim VM;
`GameContext` is UI-only and is `not defined` here — find the human player by scanning
`Players.get(i).isHuman`). `console.log` in the Tuner context goes to the game log, NOT
the FireTuner panel — the panel only prints the **return value**, so `return
JSON.stringify(...)` to see output. Confirmed live APIs: `Players.get(i)` (.isAlive/
.isHuman/.isMajor), `player.Cities.getCities()`→City[], `city.location.{x,y}`,
`city.Growth.claimPlot({x,y})`, `GameplayMap.getPlotDistance/getOwner/getGridWidth/
getGridHeight`, `MapCities.getCity(x,y)`, `city.Workers.getNumWorkers()/getCityWorkerCap()`.
**Yields:** use the **plot-INDEX** form `GameplayMap.getYields(GameplayMap.getIndexFromXY(x,y), pid)`
→ returns `[[yieldTypeHash, amount], …]`; the `{x,y}`-location form returns `[]` (wrong
overload). ⚠ `GameplayMap.getYieldsWithCity(loc, cityID)` exists but **CALLING it in the
Tuner context returned nothing / aborted the script** (likely a native fault on arg shape)
— avoid for now. Also CONFIRMED: `MapCities.getCity(x,y)` on a claimed dist-4 tile returns
the human's city ComponentID (`{owner,id,type}`) → **the engine attaches dist-4 territory
to the city**, not just the player.

**✅ Second test ALSO CONFIRMED 2026-06-30:** the owned ring-4 tiles **DO get worked
natively** — claiming yielding dist-4 tiles raised the city's per-turn yields with each
claim (see section 2). So **NO yield injection / dummy specialists are needed** — the Civ6
faking layer does not need to port at all. The mod is just: claim ring-4/5 tiles for
tall cities; the engine works them.

**UI vs gameplay context (tested 2026-06-30):** `city.Growth.claimPlot` is present in
BOTH contexts (`typeof === function`) but is a **NO-OP in the UI ("App UI") context** —
called it there on an unowned dist-4 tile, no error, ownership stayed `-1`. It only
mutates in the **gameplay (Tuner)** context. There is **no custom UI→gameplay RPC for
mods**: `engine.trigger` is within-context only; the cross-context channels
(`Game.{City,Player,Unit}Operations/Commands.sendRequest`, `engine.call`) are native
and not mod-extensible; all 3 SDK example mods are pure data mods. **Implication for an
INTERACTIVE "player picks a tile" UX:** you can't wire a custom UI plot-picker straight
to `claimPlot`. The reachable interactive route is a **native channel the gameplay
script can OBSERVE** — i.e. a unit/commander **UnitCommand** (native UI→gameplay) whose
unit event the `<ScenarioScripts>` catches and then calls `claimPlot` (a "claim/annex
agent" you move onto the ring-4/5 tile — which also matches the original in-game
observation that started this). AUTO (pop-gated, claim on a growth/turn `engine.on`
event) needs no UI bridge at all and is the lightest path. The plot-picker UI itself is
cloneable from `interface-mode-diplo-claim-plot.ts` (uses `ChoosePlotInterfaceMode`,
`commitPlot`→`Game.PlayerOperations.sendRequest`), but `sendRequest` only routes NATIVE
ops so the picker alone can't claim.

**⚠️ VERDICT (REVISED 2026-06-30): the SCRIPT delivery path is blocked, but a NATIVE/DATA
claim path is UNTESTED and OPEN — do not call the feature dead.** (Premature "not shippable"
conclusion corrected after user pushback.) Two ways to trigger an engine claim: (a) a
custom gameplay JS script calling `claimPlot` — BLOCKED (below); (b) a NATIVE engine action
(unit ability/command, player operation, or effect) triggered purely by DATA — runs in the
engine, ships in normal games, NOT yet tested. The Prospector proves (b) exists.

**Path (b) — native/data claim candidates:**
- **`PlayerOperationTypes.LAND_CLAIM` — ❌ TESTED 2026-07-03: DORMANT/CUT CONTENT on 1.4.1.**
  `Game.PlayerOperations.canStart(pid, PlayerOperationTypes.LAND_CLAIM, {Type:
  GameInfo.DiplomacyActions.lookup("DIPLOMACY_ACTION_LAND_CLAIM").$index, X, Y}, false)`
  returns `{Success:false}` (no reason field) for EVERY tile — unowned ring-4/5, own city
  center, and with a Settler (UNIT_CLASS_CREATE_TOWN) standing ON the target. Corroborating:
  base-wide grep shows LAND_CLAIM referenced in exactly ONE UI file
  (`interface-mode-diplo-claim-plot.js`) and nothing ever switches to
  `INTERFACEMODE_DIPLO_CLAIM_PLOT` — the entry point was cut. The data rows (range
  GlobalParameters `LAND_CLAIM_RANGE_PER_STEP=2`/`STEPS=1` as `<Replace>` rows, effects,
  unit tags, grievance event) are all live but the native operation refuses to start.
  Re-probe after each patch in case Firaxis revives it.
- **Prospector `UNITCOMMAND_CLAIM_RESOURCE`** — native resource-claim (MO, resource-gated).
- Native effects seen: `EFFECT_START_LAND_CLAIM`/`EFFECT_COMPLETE_LAND_CLAIM`,
  `EFFECT_GRANT_SUZERAIN_UNIT_PLOT`, `EFFECT_PLAYER_GRANT_UNIT_AT_PLOT` (no general
  "grant-plot-to-city" effect found, but COMPLETE_LAND_CLAIM is the closest lever).

NEXT TEST (FireTuner, App UI isolate): `Game.PlayerOperations.canStart(pid, LAND_CLAIM,
{Type, X, Y})` on a ring-4 unowned tile → does the native claim accept it (Success=true)?

---
**Path (a) — the BLOCKED script route** (`claimPlot` mutates only in the gameplay/simulation
V8 isolate, which a mod CANNOT inject into for a normal game):
- **In-game test FAILED (Phase 1):** a `<ScenarioScripts>` gameplay JS NEVER EXECUTED in a
  normal AQ single-player game. The action group registered (Modding.log `* aq-claim-agent`)
  but the script's top-level `console.log` appeared in NO log — `Scripting.log` (which DOES
  capture all gameplay/map-script output; it was full of this game's map-gen) and
  `GameCore.log` both had zero `[claim-agent]` lines. The file was never evaluated.
- **Community-confirmed** (CivFanatics "Execution Model" + "Scripting Runtime Information"
  threads): Civ7 runs separate V8 isolates (Tuner, App UI, gameplay, map); the **gameplay
  isolate is not exposed to mods** — "gameplay scripts don't seem to be possible at this
  time." `<ScenarioScripts>` runs only in actual **scenario** games (no base/DLC modinfo uses
  it). The ONLY persistent mod JS in a normal game is `<UIScripts>` (App UI isolate), which
  **can't mutate gameplay** (claimPlot no-op there, tested) and risks MP desync.
- **No data path either:** there is no XML/SQL `EFFECT_*` to claim tiles or widen radius (sections 2-3).

So the gameplay isolate is reachable only by **FireTuner** (external debug tool) or **scenario
scripts** — neither is a shippable normal-game mod. **REALISTIC OPTIONS:** (a) SHELF until
Firaxis exposes gameplay scripting (community expects it may come); (b) ship as a custom
**SCENARIO** (ScenarioScripts works there) — but that's a load-a-scenario UX, not a normal
normal game; (c) stay **data-only/intensity** (the shipped model). The proven
research (claimPlot ignores the radius + engine works ring-4/5 tiles) is preserved for if/when
the gameplay isolate opens up or for scenario use.

**(Historical design sketch, if delivery ever unblocks:** a `<ScenarioScripts>` script gated to
the tall condition claims eligible ring-4/5 plots on a unit/growth event via `claimPlot`;
player-pick via a Prospector-style "claim agent" unit; ring 4+5; claimable = unowned +
own-empire only; pop-gate/cap for balance; cache + incremental.)

## 5. The SHIPPABLE feature it became — "Tall Resource Reach" (the Surveyor)

Since general tile-extension is unshippable (above), the realistic shippable feature uses the ONE
native claim that works — the Prospector's resource claim — deployed for tall players:

- **Native claim that works:** `UNITCOMMAND_CLAIM_RESOURCE` (Prospector's `ABILITY_CLAIM_RESOURCE`).
  Claims a **resource** tile **within 5 hexes of a friendly settlement** and **brings it into your
  territory** (confirmed in play + an Explorer test). Resource-gating is NATIVE (the command row
  is bare `Type`+`Kind`; no data requirement to drop) → resource tiles only.
- **Ability transfers to ANY unit** via a `TypeTags` row tagging it `UNIT_CLASS_PROSPECTOR` (PROVEN:
  Explorer test, Modern). The unit→command link is automatic through the charged ability (the
  `units.xml` UnitType+Command row is just an `AIUnitPrioritizedActions` AI hint, not the grant).
- **Empty claimed tiles stay inert:** ⛔ **SUPERSEDED 2026-08-15 — see the box at the top.** What is
  still true: a per-type `EFFECT_PLOT_ADJUST_YIELD` on an unworked RURAL tile is never collected, and
  **no "yield per owned tile/terrain" effect exists**. What was wrong: the conclusion that outer tiles
  can therefore never pay. Give the tile an **urban** district and a **building** (via `CREATE_ELEMENT`)
  and the city banks it with no citizen at all; a specialist can then be placed there through the normal
  UI. The dead end was `DISTRICT_RURAL` specifically — the only district class not marked
  `Workable="true"`.
- **Grant a unit (with an ability):** `EFFECT_CITY_GRANT_UNIT` (arg `UnitType`) grants a unit to a city;
  `EFFECT_GRANT_UNIT_OF_CLASS_AND_APPLY_ABILITY` grants a unit AND applies an ability (Great-Person
  grants use it, `run-once`, node-gated). Charge supply: `EFFECT_GRANT_UNIT_ABILITY_CHARGE`
  (`COLLECTION_OWNER`, recharge timer).
- **NO per-growth-event trigger exists** (verified — only one hardcoded yield-on-growth effect). Unit
  grants are milestone/`run-once`/node-based → tie grants to **population milestones**, not
  every growth. Building can't cost a literal pop (Migrant is `CanTrain="false"` + no "on unit trained"
  trigger to fire `EFFECT_CITY_ADJUST_POPULATION`); cost levers = production + `PrereqPopulation` + cooldown.
- **Payoff:** amplify each claimed resource for the tall city via `EFFECT_CITY_ADJUST_YIELD_PER_RESOURCE`
  / `…_PER_SLOTTED_RESOURCE` / `…_PER_RESOURCE_CLASS` (the engine has a whole per-resource family).

**Design (decided):** a DEDICATED tall-gated "Surveyor" unit (not tagging base Migrants), granted at
population milestones, carrying the claim charge, + a per-resource amplifier. **Implementation
shape:** the complete AQ/EX ability-chain wiring is a per-age effects file (unit + UNIT_CLASS_PROSPECTOR
tag + ABILITY_CLAIM_RESOURCE + charge-grant modifier), with a Modern variant using the tag-only form.
Minimal proof-of-concept is just ONE row: a TypeTags entry adding `UNIT_CLASS_PROSPECTOR` to any
Modern-age unit surfaces the working Claim Resource command.

**Ring-4/5 via story-seeded resources (phase-2, researched 2026-07-03):** `EFFECT_PLOT_PLACE_RESOURCE`
lands on UNOWNED plots when driven from `COLLECTION_NARRATIVE_STORY` (13 base discovery stories do it),
and discovery sites spawn ≥3 tiles from major starts = exactly the ring-3–6 band; a custom tall-gated
discovery-investigation story can seed a Surveyor-claimable resource there, all data-only. Full system
writeup: [narrative-events.md](narrative-events.md).

## 6. The population/worker effects (data-only)

- **`EFFECT_UNIT_GRANT_UNASSIGNED_WORKERS` — LIVE, verified in-game 2026-08-15.** Grants unassigned
  population the player then places. Wire it the way the base game's single shipped use does
  (`GREATPERSON_ONE_SPECIALIST`, Al-Jazari, `age-exploration/data/greatpeople-gameeffects.xml`):
  `collection="COLLECTION_OWNER"`, `run-once` + `permanent`, one `Amount` argument, reached by a
  `GreatPersonIndividualActionModifiers` row with
  `AttachmentTargetType="GREAT_PERSON_ACTION_ATTACHMENT_TARGET_UNIT_GREATPERSON"`. Fires on the Great
  Person's Activate press. Pure GameEffects — no UIScript, no RPC, no desync exposure.
  **Scope:** the population arrives *unassigned* and is placed through the normal picker, so it feeds
  the settlement's existing tile set; it is a free-population lever, not a reach lever.
- ⛔ **`EFFECT_PLAYER_GRANT_UNASSIGNED_WORKERS` is a DEAD STRING** — binary-present, **zero uses in any
  base or DLC data**. A four-spelling argument sweep against it returned nothing, which proved only that
  the token has no handler. **Lesson worth generalising: before sweeping argument names on a
  binary-only token, check whether any shipped data uses it at all — and check for a sibling with a
  different scope prefix (`EFFECT_UNIT_…` vs `EFFECT_PLAYER_…`). The live twin was one grep away.**
- **Specialist unlock (Antiquity)** = tech node `NODE_TECH_AQ_CURRENCY`, which carries
  `MOD_AQ_SPECIALIST_CAP_INCREASE` (`EFFECT_CITY_ADJUST_WORKER_CAP` +1, `COLLECTION_PLAYER_CITIES`).
  Until a city's `Workers.getCityWorkerCap()` exceeds 0 there are no specialists at all, and
  `canStart(ASSIGN_WORKER)` returns false for **every** plot — a confound that will silently invalidate
  any early-game specialist probe.
- **`EFFECT_DISTRICT_ADJUST_WORKER_CAP` — LIVE, verified in-game 2026-08-15.** Per-district specialist
  capacity, `collection="COLLECTION_PLAYER_DISTRICTS"`, arg `Amount`, continuous (never `run-once`),
  delivered through the standard attach wrapper. Takes plot `SubjectRequirements`, so it can be
  targeted (base: `TRAIT_MOD_NEGARA_SPECIALIST_CAP_INCREASE`, coastal only). Unfiltered `Amount 2`
  took tiles from `Specialists 0/1` to `0/3`. ⚠ Read it from the **tile tooltip** — the City Details
  "allows N Specialist per Tile" line and `getCityWorkerCap()` are city-wide and ignore district
  bumps. ⚠ Does not open rural (see the box at the top).
- **`PlayerOperationTypes.ASSIGN_WORKER`** (`{ Location: plotIndex, Amount: 1 }`,
  `interface-mode-acquire-tile.ts`) is the specialist-placement RPC — plot-indexed, no city id, no range
  argument. The UI filters candidates through `PlotWorkersManager.workablePlotIndexes` *before* calling
  `canStart`, so a tile missing from the picker is not proof the native op refuses it.

**UI-isolate RPC route — 2026-07-10, and REVISED 2026-08-15 (see the box at the top — the orphan
problem is solved by claiming the tile first):** a shipping mod's
`<UIScripts>` file *can* write durable authoritative state via the sanctioned RPC
`Game.PlayerOperations.sendRequest(owner,"CREATE_ELEMENT",{Kind:"DISTRICT",Type:"DISTRICT_RURAL",
Location,Owner})` — verified to create a real Rural district + Farm that survives save/reload
(details: [ui-modding.md](ui-modding.md) section 6). On an **UNOWNED** tile the result is
**player-owned and orphaned** — no city banks it — because nothing UI-reachable folds an out-of-range
plot into a city's territory (`claimPlot` is gameplay-isolate only; `EXPAND`/`PURCHASE` are ring-3
capped). And `WorldBuilder.MapPlots.setOwnership` from a UIScript is inert/transient (no border, no
yield, no persistence).

⭐ **THE FIX, 2026-08-15: don't start from an unowned tile.** Let the **Surveyor's claim** fold the
tile into city territory first, then `CREATE_ELEMENT` onto it — the result attaches to the **city**,
not the player, and the city banks it. Orphaning was an artefact of the starting state, not a property
of the RPC.

Design rule worth carrying into any use of these mechanics: do NOT gate static-world effects
(appeal, wonder/terrain adjacency) behind per-Age tech/civic nodes — they would wrongly blink
off at Age rollovers; keep them binary and condition-gated. Yields are fine to re-gate/scale
per Age.
