# The `.modinfo` file

The `.modinfo` is the manifest: it tells the engine what your mod is, what it
depends on, *when* each chunk of content applies, and *which files* deliver it. Get
this wrong and nothing else matters — the engine never reaches your data.

## Contents
- [Skeleton](#skeleton)
- [Properties — and the integer-Version rule](#properties)
- [Dependencies vs References](#dependencies-vs-references)
- [ActionCriteria — when does an action group apply](#actioncriteria)
- [ActionGroups — what loads, and in what order](#actiongroups)

## Skeleton

A real, working modinfo (this is the structure verified to load and apply):

```xml
<?xml version="1.0" encoding="utf-8"?>
<Mod id="my-cool-mod" version="1" xmlns="ModInfo">
    <Properties>
        <Name>My Cool Mod</Name>
        <Description>What it does.</Description>
        <Authors>Your Name</Authors>
        <Package>Mod</Package>
        <AffectsSavedGames>1</AffectsSavedGames>
        <Version>1</Version>
    </Properties>

    <Dependencies>
        <Mod id="base-standard" title="LOC_MODULE_BASE_STANDARD_NAME"/>
    </Dependencies>
    <References>
        <Mod id="core" title="LOC_MODULE_CORE_NAME"/>
    </References>

    <ActionCriteria>
        <Criteria id="always">
            <AlwaysMet/>
        </Criteria>
        <Criteria id="age-antiquity">
            <AgeInUse>AGE_ANTIQUITY</AgeInUse>
        </Criteria>
    </ActionCriteria>

    <ActionGroups>
        <ActionGroup id="text-all" scope="game" criteria="always">
            <Properties><LoadOrder>100</LoadOrder></Properties>
            <Actions>
                <UpdateText>
                    <Item>text/en_us/MyModText.xml</Item>
                </UpdateText>
            </Actions>
        </ActionGroup>
        <ActionGroup id="antiquity" scope="game" criteria="age-antiquity">
            <Properties><LoadOrder>110</LoadOrder></Properties>
            <Actions>
                <UpdateDatabase>
                    <Item>data/antiquity/projects.xml</Item>
                    <Item>data/antiquity/modifiers.xml</Item>
                    <Item>data/antiquity/traditions.xml</Item>
                </UpdateDatabase>
            </Actions>
        </ActionGroup>
    </ActionGroups>
</Mod>
```

The `id` is the mod's identity everywhere (log lines, the Mods.sqlite registry, the
deployed folder name). Keep it stable; bump it deliberately when you want the engine
to treat the mod as new.

## Properties

| Tag | Notes |
|-----|-------|
| `<Name>` / `<Description>` | Shown in the Add-Ons UI. Can be literal text or `LOC_*` keys. **For line breaks in a multi-paragraph Description, use the `[N]` token — raw newlines are collapsed to spaces** (see below). |
| `<Authors>` | Free text. |
| `<Package>` | `Mod` for player mods. |
| `<AffectsSavedGames>` | `1` if it changes gameplay (most gameplay mods) — can't be added/removed mid-game. `0` = UI/localization-only, toggleable anytime. **Defaults to `1` if omitted.** |
| `<Version>` | **MUST be an integer.** See below. |
| `<ShowInBrowser>` | `1`/`0` — show on the Add-Ons screen (default `1`). |
| `<EnabledByDefault>` | `1`/`0` — enabled on first run if never toggled (default `1`). |
| `<Package>` / `<PackageSortIndex>` | grouping/order hints — **not currently used by the UI.** |

> An **empty `<Name>`** hides the mod from the Add-Ons screen but it still loads — an
> occasional cause of "my mod runs but I can't find it in the list."

### Line breaks in `<Description>` — use `[N]`, not raw newlines

The Add-Ons / mod-details screen **collapses literal newlines (and runs of whitespace) to a single
space**, so a long multi-paragraph `<Description>` renders as one wall of text. Use the game's newline
token **`[N]`** to force breaks — `[N]` for a line break, `[N][N]` for a paragraph gap. (`[N]` is Civ
VII's standard newline token; it's used throughout the base-game LOC text.) **Confirmed in-game
2026-06-22** rendering correctly in a mod's Add-Ons description.

Tip for readable XML source: put the `[N]` token at the **start** of each logical line (the physical
newline before it collapses to an invisible trailing space), e.g.:

```xml
<Description>My Mod — one-line tagline.
[N][N]A paragraph of intro text describing the mod.
[N][N]KEY FEATURES
[N]- First feature.
[N]- Second feature.</Description>
```

This works with inline literal text. If you instead localize the Description via a `LOC_*` key (also
valid — base/DLC modules do this), put the `[N]` tokens in the LOC string; that text path runs through
the same formatter. No other rich markup (e.g. `[B]` bold) is verified for this field — stick to `[N]`.

### The integer-Version rule (the #1 silent killer — for DATABASE mods)

The engine stores a mod's version as an **integer**. A non-integer like `0.1` parses
to `0`/invalid, and the engine then **silently drops the mod from "Target Mods."** The
symptom is maximally confusing: the mod is *discovered* (you see "Loading Mod …" in
Modding.log), it shows **Enabled** in the Add-Ons menu, FK validation passes — and it
applies absolutely nothing, with no error anywhere.

**Scope of the rule (revised 2026-07-29 after auditing the Workshop top list):** the
Target-Mods drop bites the **gameplay-database application path** — `UpdateDatabase`
/ GameEffects / text applied to the game DB. **UI-only mods demonstrably survive a
dotted version**: bz-map-trix (`version="4.0.0"` + `<Version>4.0.0</Version>`, 100k+
subscribers), izica's combat-power (`1.4.0`), Drongo's suite (`1.0`, `1.0.1`) all
ship non-integer versions and work, because `UIScripts`/`ImportFiles` load regardless.

- For any mod with database content: use `<Version>1</Version>` and matching
  `version="1"` — non-negotiable. If a DB mod "shows enabled but does nothing," check
  the version **first**, before anything else.
- Community conventions you'll see in working UI mods: **semver encoded as an
  integer** in the attribute with the human-readable form in the element
  (bz-re-sorts: `version="20400"` + `<Version>2.4.0</Version>`, i.e. 2·10000+4·100);
  `<Version>` omitted entirely (JNR); and Policy Yield Previews' bump script treats
  the `version=` **attribute** as a never-bumped format version while bumping only
  `<Version>`. Safest habit remains integer in both — it costs nothing and removes a
  whole failure class.
- The version the engine actually recorded lives in the `ModProperties` table of
  `Mods.sqlite` — inspect it with `scripts/inspect-registry.ps1` if in doubt.

## Dependencies vs References

- `<Dependencies>` — modules that **must** be present and load **before** yours.
  Gameplay mods depend on `base-standard`.
- `<References>` — soft ordering: load after these *if present* (e.g. `core`). Use it
  to sequence relative to other content without making it mandatory.
- `<ReverseReferences>` — the inverse: listed mods load **after** yours (force your rows
  to win over another module's without editing that module). Pairs with `<Exclude>`.

All three use `<Mod id="..." title="LOC_..."/>`. Every mod implicitly depends on `core`,
`base-standard`, and the three age modules (`age-antiquity`/`-exploration`/`-modern`).

## ActionCriteria

`<Criteria>` blocks define **conditions**; an `<ActionGroup>` names one via its
`criteria` attribute. The two you'll use most:

- `<AlwaysMet/>` — always applies. Use for age-agnostic content like localized text.
- `<AgeInUse>AGE_ANTIQUITY</AgeInUse>` — applies only during that Age. Civ VII content
  is heavily Age-scoped; typically you write one criteria + one action group per Age
  (`AGE_ANTIQUITY`, `AGE_EXPLORATION`, `AGE_MODERN`) so each Age loads only its own
  rows. This also avoids duplicate-row collisions across Ages.

  **This is the ONLY age-gating syntax that exists — copy it exactly.** There is no
  `<Ages>`/`<Age>` block, no `Age=` attribute on ActionGroups or ImportFiles, and no
  per-row age attribute in modinfo files; models keep inventing all three. The whole
  working shape, verbatim:
  ```xml
  <ActionCriteria>
      <Criteria id="exploration-age"><AgeInUse>AGE_EXPLORATION</AgeInUse></Criteria>
  </ActionCriteria>
  <ActionGroups>
      <ActionGroup id="my-exploration-content" scope="game" criteria="exploration-age">
          <Actions><UpdateDatabase><Item>data/exploration/my-rows.xml</Item></UpdateDatabase></Actions>
      </ActionGroup>
  </ActionGroups>
  ```

**Modifiers on a `<Criteria>`:** `any="true"` = met if *any* child condition holds
(default is ALL must hold); `inverse="1"` on a condition negates it
(`<AgeInUse inverse="1">AGE_ANTIQUITY</AgeInUse>` = "not Antiquity").

**Full criterion vocabulary** (from the official dev-kit docs — beyond `AlwaysMet` /
`AgeInUse` these are documented but not all isolation-tested here; confirm behavior before
relying on one):

| Criterion | Met when |
|-----------|----------|
| `AlwaysMet` / `NeverMet` | always / never. |
| `AgeInUse` | current Age == value (`AGE_ANTIQUITY` / `AGE_EXPLORATION` / `AGE_MODERN`, or a modded age). |
| `AgeWasUsed` | value Age was played in a *previous* Age of this game (NOT the current one; Advanced Starts don't count). |
| `AgeEverInUse` | `AgeInUse` OR `AgeWasUsed`. |
| `AgeAtOrBefore` | base-game-attested (age-antiquity.modinfo `antiquity-age-persist`): loads content that must remain valid in LATER Ages too (AQ constructibles standing on the map in EX/MO, legacy civs). Semantics ≈ "the named Age is at or before the game's current Age." |
| `ConfigurationValueMatches` | a setup config parameter equals a value — child `<Group>` (ConfigurationGroup) + `<ConfigurationId>` (ConfigurationKey) + `<Value>`. See the advanced-setup note below. |
| `ConfigurationValueContains` | same, but `<Value>` is a comma-delimited list; met if the parameter matches ANY. |
| `MapInUse` | current map == the `File` column value, e.g. `{base-standard}maps/continents-plus.js`. |
| `RuleSetInUse` | ruleset in use (default only `RULESET_STANDARD`; more via mods/DLC). |
| `GameModeInUse` | one of `WorldBuilder` / `SinglePlayer` / `HotSeat` / `MultiPlayer`. |
| `LeaderPlayabe` *(sic — spelled that way in the docs)* / `CivilizationPlayable` | the leader/civ is a valid setup option (civ availability is Age-dependent). |
| `ModInUse` | a mod with the given `id` is active (user mod OR Firaxis DLC id). Optional `<Version>` sub-element checks the version **EXACTLY** — `1` ≠ `1.0`. |

> **Advanced-Setup / mod-options gating — ✅ LITMUS-PROVEN IN-GAME (2026-08-01).**
> `ConfigurationValueMatches` is the *officially documented* way to gate an action group on a
> setup-screen parameter, and the full route is now verified live: a mod-added `Parameters`
> row (`Domain="bool"`, `ConfigurationGroup="Game"`, custom `ConfigurationKey`, loaded via a
> `scope="shell"` `UpdateDatabase`) renders on the Create-Game screen with its localized label,
> and two `ConfigurationValueMatches` criteria (`Value` 1 / 0) cleanly selected which game
> `UpdateDatabase` variant loaded — the chosen variant's marker applied, the other's did NOT,
> both toggle values tested. Note this gates *whether an action group loads at game start*,
> decided on the setup screen; it is not a live in-game toggle. A separate self-contained
> module keyed on `ModInUse` remains an alternative for whole-mod switches.

> **⛔ THE VALUE MUST BE A STRING OR A BOOLEAN — a NUMBER never matches.**
> Measured 2026-08-06, six variants in a single game (`eni-cfg-litmus`). A parameter whose stored
> value is a number was **never** matched by `ConfigurationValueMatches`: not with a custom
> `DomainValues` list at `Hash="0"`, not with the same list at `Hash="1"` (the shape every
> base-game custom-domain parameter uses), and not as a primitive `uint`. A `Domain="bool"`
> parameter matched, and so did a `DomainValues` list whose values were **strings**. Domain and
> `Hash` are irrelevant; the stored value's **type** is everything.
> This is why no base-game dropdown trips over it — every one of them uses string values
> (`AGE_ANTIQUITY`, `DIFFICULTY_DEITY`, `RULESET_STANDARD`), never a bare number.
> **The failure is completely silent**: the criteria simply never fires, its action group never
> loads, no error appears in Modding.log, and the player gets the default while believing they
> chose otherwise. A shipped mod ran this way for its whole life before the cause was found.
> So for a `< >` cycler, name the values — `MYMOD_LEVEL_10`, not `10`:
> ```xml
> <Row ParameterID="MyLevel" Domain="MyLevels" DefaultValue="MYMOD_LEVEL_40" Hash="0" .../>
> <DomainValues>
>   <Row Domain="MyLevels" Value="MYMOD_LEVEL_10" Name="LOC_MYMOD_10" SortIndex="10"/>
> </DomainValues>
> ```
> and match `<Value>MYMOD_LEVEL_10</Value>`. If you are migrating an existing parameter off
> numeric values, **change the `ConfigurationKey` too** — the old key may still hold a stale number
> in a player's saved setup, which would never match and would resurrect the bug.
> Corollary: a cycler holds exactly one value, so mutually-exclusive options need no extra
> machinery. Do not reach for one bool per option.

> **⛔ `ParameterDependencies` can hide your options entirely.** Added to make four `Domain="bool"`
> rows behave as a radio group (each row requiring the others to equal `"0"`), and **all four
> options vanished from the setup screen** — no error anywhere. Isolated in the same game: a
> second mod's parameters, identical but for having no dependency rows, still rendered. Suspected
> mechanism is the same value-type mismatch as above (a bool stores `false`, not the number `0`),
> so every dependency failed and a parameter whose dependency is unsatisfied is not drawn. Prefer
> a single cycler over dependency-linked bools.

> **Where a mod's setup row RENDERS — its own `ParameterGroups` entry, plus a LOW `SortIndex`.**
> `advanced-options-base.js` → `refreshGameOptions()` walks `GameSetup.getGameParameters()` in
> **SortIndex order** and opens a collapsible block the **first time it meets a `GroupId`**,
> appending every later row of that group into the block already open — wherever that block sits.
> **So a group's on-screen position is its LOWEST-indexed parameter**, and for a single-row mod
> group, `SortIndex` *is* the block position.
> Two consequences that look like contradictions until you have the rule:
> - `LegacySets` (TRIUMPH SETTINGS) is `SortIndex="10"` yet renders *after* the Victories rows at
>   `4000` — because Victories lives in `GameOptions`, whose block was opened by `Ruleset` at `10`.
> - A mod row at `SortIndex="200"` rendered *below* MAP SETTINGS even though `MapSize` is `1030` —
>   because `MapOptions` is opened by `StartPosition` at a much lower index, and the 1000+ map rows
>   then pile into that already-open block above it.
>
> Verified live on the Create Game screen (2026-08-06) with a `GameSetup.getGameParameters()` probe
> that dumped the real block order — worth re-running rather than reasoning about, since the base
> index values are spread across several config files and some parameters are engine-defined:
> ```js
> [...new Set(GameSetup.getGameParameters().filter(p=>!p.hidden).map(p=>GameSetup.resolveString(p.group)))]
> ```
> Practical values: the earliest base parameters are `Ruleset` and `LegacySets` at `10`, so
> **`SortIndex` below 10 puts your block first**; a mid value drops you into the middle of the base
> blocks. Reusing a base `GroupId` gives you no control at all — your row is simply appended to
> that group's existing block. Ship your own group and point the parameter at it:
> ```xml
> <ParameterGroups>
>   <Row GroupId="MyModOptions" Name="LOC_MYMOD_GROUP_NAME"/>
> </ParameterGroups>
> <Parameters>
>   <Row ParameterID="MyModSetting" ... GroupId="MyModOptions" SortIndex="10"/>
> </Parameters>
> ```
> The header text comes from `ParameterGroups.Name` resolved through the shell text DB; an
> unresolved name renders an **empty** header (`this.groupNames.get(groupName) ?? ""`), so ship
> the `LOC_` row in the same `scope="shell"` `UpdateText` as the parameter's own labels.

## ActionGroups

Each `<ActionGroup>` ties a `criteria` to a set of `<Actions>`.

- **`scope`** — `"game"` for gameplay/database content (what this skill is about).
  `"shell"` is for the front-end/setup screens (menus, config). If your gameplay rows
  aren't applying, confirm the group is `scope="game"`.
- **`<Properties><LoadOrder>N</LoadOrder>`** — lower loads first. Put text low (e.g.
  100) and data slightly higher (110) so localization exists before data references it.
- **`<Actions>`**:
  - `<UpdateDatabase><Item>path</Item>…</UpdateDatabase>` — load gameplay data XML/SQL
    and GameEffects XML. **`<Item>` order matters within a group**: a table must be
    registered before another file references it (load `projects.xml` before the
    `modifiers.xml`/`traditions.xml` that name those projects).
  - `<UpdateText><Item>text/en_us/…</Item></UpdateText>` — localization (`LOC_*` keys).
  - `<UpdateIcons><Item>data/…-icons.xml</Item>…</UpdateIcons>` — icon definitions
    (`<IconDefinitions><Row><ID>TYPE</ID><Path>blp:atlas_name</Path></Row>`). **Icons
    load into a SEPARATE icons database** — they must go through `<UpdateIcons>`, NOT
    `<UpdateDatabase>`. Putting an `<IconDefinitions>` block in a file loaded by
    `<UpdateDatabase>` errors ("no such table") and **rolls back the ENTIRE action group**,
    so the whole age's data fails to apply (mod shows "Content Configuration Validation
    Failed"). To reuse base-game art with no custom asset, point `<Path>` at an existing
    atlas entry (e.g. `blp:city_antiquity_256x256`, `blp:project_discover_calculus`); the
    UI resolves the icon by the row's `<ID>` matching the object's Type. This mirrors how
    the base game loads `data/icons/project-icons.xml`.
  - `<UIScripts>` (load a JS module into the UI runtime) and `<ImportFiles>` (mount
    HTML/CSS/PNG assets — or shadow-replace a base-game UI file at the same relative
    path) are the UI-mod actions — see [ui-modding.md](ui-modding.md). Two UI-relevant
    facts that surprise data modders: `<UpdateText>` also accepts **`.sql`** files
    (`INSERT OR REPLACE INTO LocalizedText …`), and `<UpdateDatabase>` in a
    **`scope="shell"`** group writes the *frontend/config* database (hotkey
    `InputActions` rows live there), not the gameplay database.

Paths are **relative to the modinfo's folder**, forward slashes. You can also load a file
**from another mod** by prefixing the path with that mod's id in curly braces:
`<Item>{other-mod-id}data/foo.xml</Item>`.

**Full action-type list** (official dev-kit docs; the common ones are covered above):

| Action | Loads |
|--------|-------|
| `UpdateDatabase` | gameplay OR frontend DB (per group `scope`) — `.xml`/`.sql`, incl. `<GameEffects>`. |
| `UpdateText` | Localization DB (`.xml`/`.sql`). |
| `UpdateIcons` / `UpdateColors` | Icons / Colors DBs (separate from gameplay — see the UpdateIcons note above; Colors work the same way). |
| `UIScripts` | register `.js` UI-runtime modules. |
| `ImportFiles` | mount assets into the VFS (PNG/HTML/CSS/JS); same relative path = shadow-replace a base file. |
| `UIShortcuts` | load `.html` panels into the in-game **debug** menu (needs `EnableDebugPanels 1`). |
| `UpdateVisualRemaps` | Visual Remap DB — relink one entity's visuals onto another asset (its **own** action; putting VisualRemaps in `UpdateDatabase` crashes — see [custom-units.md](custom-units.md)). |
| `MapGenScripts` | a `.js` loaded during map generation then unloaded. |
| `ScenarioScripts` | a gameplay `.js` script. |
| `UpdateArt` | art files — not useful until art tools ship. |

**`<Exclude>` — suppress another module's action group.** Inside an `<ActionGroup>`, an
`<Exclude mod_id="X" action_group_id="Y"/>` prevents that *other* mod's action group from
loading when yours does (compatibility-patch / total-override pattern). Mind load order —
`<ReverseReferences>` helps force yours to win.

A quick way to reason about a confusing mod: list its action groups and ask, for each,
"what criteria gates it, and is it `scope="game"`?" An action group whose criteria is
never met (e.g. wrong AGE constant) simply never runs, silently.
