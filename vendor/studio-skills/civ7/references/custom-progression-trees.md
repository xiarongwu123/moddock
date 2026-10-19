# Custom Progression Trees (whole new civics trees)

**A mod can add an entirely new civics (culture progression) tree — pure data, no UI work.**
In-game verified 2026-07-09 (litmus `custom-civics-tree-litmus`: a 3-node Antiquity tree
rendered as its own Civics-screen tab, laid out automatically, and was researchable). This is
the same machinery behind the base game's civ-unique trees, the Exploration **Theology** branch,
and the three Modern **Ideology** trees (Democracy/Fascism/Communism).

Scope note: this file is about adding a NEW tree. Injecting a node into an EXISTING tree also
works (verified separately) — same tables, just point `ProgressionTree` at the base tree and
hang a `ProgressionTreePrereqs` row off an existing node.

## The five tables

| Table | Role |
|---|---|
| `Types` | `KIND_TREE` for the tree; `KIND_TREE_NODE` per node |
| `ProgressionTrees` | the tree row: `AgeType`, `SystemType="SYSTEM_CULTURE"`, `Name`, optional `RevealRequirementSetId`, `IconString`, `PrereqFormat="OR"`, `CostProgressionModel`/`Param1`, `MultipleUnlockName`, `CivInjectedName` |
| `ProgressionTreeNodes` | per node: `ProgressionTree`, `Cost`, `Name`, `IconString` (reuse a base `cult_*` glyph), optional `Repeatable="true"` + `RepeatableCostProgressionModel` (the Future-Civic pattern — a repeatable sink node), `CanSteal` |
| `ProgressionTreePrereqs` | the arrows (`Node` ← `PrereqNode`). **Layout is automatic** — no column/row fields needed |
| `ProgressionTreeNodeUnlocks` | what completing a node grants: `TargetKind` = `KIND_TRADITION` / `KIND_MODIFIER` / `KIND_CONSTRUCTIBLE` / `KIND_DIPLOMATIC_ACTION`; `UnlockDepth` 1/2 (2 = mastery); extras: `RequiredGovernmentType`, `RequiredTraitType`/`NotTraitType`, `Hidden="true"`, `AIIgnoreUnlockValue` |

Optional polish: `TypeQuotes` (node quote + VO), `ProgressionTree_Advisories` (advisor class
per node — include them; likely feeds AI valuation).

The **main** tech/civics trees are not special data — the `Ages` table points at them
(`MainCultureProgressionTreeType` / `MainTechProgressionTreeType`,
base-standard/data/ages.xml). Every other tree is a hideable "branch" tree.

## Why the UI just works

The Civics screen asks the engine for `player.Culture.getAvailableTrees()` and builds one tab
per tree (Dev Kit `Reference/base-standard/ui/culture-tree/screen-culture-tree.ts` +
`model-culture-tree.ts`); the culture chooser (pick-next-civic) iterates the same list. No
hardcoded tree list anywhere.

⚠ **Don't put "MAIN" in a custom tree's type string** — the tab sort and the chooser both
special-case `ProgressionTreeType.includes("MAIN")` to float the main tree first.

## The three reveal routes (all shipped in base)

A non-main tree is **hidden by default**. Reveal it one of three ways:

1. **`RevealRequirementSetId` on the ProgressionTrees row** — evaluated on gameplay EVENTS,
   not continuously. ✅ In-game verified (2026-07-09): **`REQUIREMENT_TRIUMPHS_COMPLETED`
   (MinCount=1) works here** — a hidden tree revealed mid-game the moment the player
   completed a Triumph, even though base only uses that requirement in unlock/challenge
   contexts. So "earn a feat → a new tree/branch appears" is fully buildable.
   **⚠ But an ALWAYS-TRUE reveal reqset does NOT reveal the tree at Age start** (in-game
   2026-07-09: a tree whose set held only base `REQ_AGE_IS_EXPLORATION` stayed hidden on
   turn 1 of EX with the mod fully applied). Every base reveal-reqset condition flips on an
   event (found religion / completed node / completed triumph) — the set seems to get its
   evaluation kick from those events. **For an always-visible tree, use route 2 (the effect),
   never an always-true reqset.** Reveal-reqsets are for genuinely conditional,
   event-flipped reveals.
   Base: Theology = founded-a-religion + age check; Ideologies =
   `REQUIREMENT_PLAYER_HAS_COMPLETED_PROGRESSION_TREE_NODE` on Political Theory
   (age-modern/data/progression-trees-culture-common.xml). For an always-visible tree, use a
   single always-true requirement (e.g. base `REQ_AGE_IS_EXPLORATION` from
   base-standard/data/unlocks.xml). ⚠ In THIS reveal-reqset context base omits `MinDepth`
   and it works (unlike the modifier-requirement context, where omitting MinDepth is the
   silent killer). A `RequirementStrings` row with `Context="RevealProgress"` gives the
   hidden tree its "how to reveal" teaser line.
2. **`EFFECT_PLAYER_REVEAL_CULTURE_TREE`** (arg `ProgressionTreeType`) — how civ-unique trees
   appear: a trait-attached `COLLECTION_OWNER` modifier gated on
   `REQUIREMENT_PLAYER_HAS_CIVILIZATION_OR_LEADER_TRAIT`
   (age-exploration/data/civilizations-gameeffects.xml, `MOD_REVEAL_CIV_CULTURE_TREE_*`).
   Works with a **leader** trait too → leader-specific trees are possible. For a universal
   tree, deliver through the standard attach wrapper (`COLLECTION_MAJOR_PLAYERS` +
   `EFFECT_ATTACH_MODIFIERS` → the reveal modifier) bound in `GameModifiers`. ✅ This is the
   route the litmus verified in-game.
   The `Civilizations.UniqueCultureProgressionTree` column is bookkeeping/UI, not the reveal.
3. **A hidden node-unlock granting the reveal modifier** — "research X → a new tree appears".
   The Test-of-Time tree is revealed by `<Row ProgressionTreeNodeType="NODE_CIVIC_AQ_MAIN_CHIEFDOM"
   TargetKind="KIND_MODIFIER" TargetType="MOD_REVEAL_CIV_CULTURE_TREE_TEST_OF_TIME_ANTIQUITY"
   UnlockDepth="1" Hidden="true"/>` (age-antiquity/data/progression-trees-culture-tot-common.xml).

## Node rewards

Node-granted `KIND_MODIFIER` targets attach with the player as owner. Base shape:
`collection="COLLECTION_OWNER"` + `permanent="true"` + `<String context="Description">` (the
tree UI prints that string on the node card). City-wide yields: unlock a `KIND_TRADITION`
whose `TraditionModifiers` use `COLLECTION_PLAYER_CITIES` (normal tradition plumbing).

⚠ **Card/tooltip text needs icon markup** — a plain "+2 Culture" renders without the yield
icon and looks off next to base cards. Base style (copy it):
`[B]+2 [icon:YIELD_CULTURE][/B] Culture in all Cities.` — `[icon:YIELD_*]` inline,
`[B]…[/B]` bold around the amount+icon, optional `[TIP:LOC_…]…[/TIP]` concept links
(see any base `LOC_TRADITION_*_DESCRIPTION`).

## Limits / cautions

- **Culture trees only.** `EFFECT_PLAYER_REVEAL_CULTURE_TREE` has no TECH twin (0 hits in the
  effects catalog). A custom `SYSTEM_TECH` tree could only try the reqset route — **unproven**,
  and the tech screen may assume one tree.
- **Trees are per-Age** (`AgeType` is required). Researched-node modifiers do not survive the
  Age transition — so per the static-functions design rule, never deliver static-world effects
  (appeal, wonder/terrain adjacency) through a per-Age tree node; yields/caps/slots are fine.
- **⚠ Carrying a TRADITION across Ages — the definition must load in EVERY Age.** Each Age
  rebuilds the database from the action groups whose criteria match, so a tradition declared
  only in an age-scoped group **ceases to exist** after the flip (empirically bitten
  2026-07-09: an AQ-unlocked Tradition-slot card vanished from the EX government screen).
  Base loads ALL of `age-antiquity/data/traditions.xml` under **`always`** criteria — do the
  same: declare the Tradition row + its `TraditionModifiers` + the modifiers themselves in an
  always-criteria group; keep only the node UNLOCK in the age group. Related mechanics seen
  in base (config/civics-traditions.xml + age modinfos): trait-tagged traditions
  **auto-unlock at Age start from persistent civ/leader traits** (`IgnoreInitializeUnlock`
  opts out — so "traditions the player never researched" can appear via traits);
  `ObsoletesTraditionType` = a later-Age card that replaces an earlier one (Sales and Trade
  I→II — the upgrade-chain idiom); Traditions may carry an `AgeType` column in
  Test-of-Time-mode data; and the `AgeAtOrBefore` modinfo criterion is base's "persist into
  later Ages" scope for map-standing content. **⚠ CONFIRMED in-game (2026-07-09): a trait-less
  tradition's unlock STATE does NOT survive the Age flip** — even with the definition
  always-loaded in both Ages, a card unlocked (and slotted!) in AQ was gone from the EX
  government screen. Tradition "carry" in Civ VII = persistent TRAITS re-unlocking each Age,
  not remembered unlocks. And ❌ **Triumph completions do NOT persist across Ages either**
  (in-game 2026-07-09: a reveal modifier gated on `REQUIREMENT_TRIUMPHS_COMPLETED` MinCount=1
  stayed inactive at EX load for a player holding an AQ Triumph — counting is
  current-Age-only). So cross-Age carry has exactly two vehicles: the native **Dedication**
  (`AdvancedStartCards`) layer, or a **next-Age re-grant node/choice** (the syncretism
  pattern below).
  **Firaxis's own carry playbook = re-grant per Age, never remember** (confirmed by the
  Test-of-Time SYNCRETISM system): a Time-Tested civ's signature tradition is re-granted as
  an Age-appropriate NEW card each Age (`CivSelfSyncretismUnlocks` →
  `TRADITION_<CIV>_SYNCRETISM_<AGE>` + a bonus Tradition slot), with `ObsoletesTraditionType`
  swapping out the previous version — the upgrade-chain idiom (Sales and Trade I→II). A mod
  wanting "the same card across Ages" should do likewise: per-Age unlock vehicle + I/II/III
  chain. Related syncretism vocabulary: `EFFECT_PLAYER_GRANT_SYNCRETIC_CHOICE` = a native
  modifier-grantable **pick-one choice screen** ("adopt an associated civ's uniques or affirm
  your own traditions"; choice pools = `LeaderSyncretismUnlocks` / `CivSelfSyncretismUnlocks` /
  the base-EMPTY `CivilizationSyncretismUnlocks` hook — age-antiquity/data/
  unlocks-syncretism.xml); `CanSteal="false"` on a tree node exempts it from syncretic
  adoption. ⚠ Whether the choice screen works outside Test-of-Time mode = unprobed.
- **AI**: ✅ verified 2026-07-09 (FireTuner readout, turn ~50) — **AI players DO research a
  modded tree** (2 of 5 AIs had researched nodes; one AI even triggered the
  Triumph-conditioned hidden-branch reveal and was researching the branch). Uptake is
  heterogeneous (3 of 5 showed none at that point), so don't assume universal adoption —
  include `ProgressionTree_Advisories` rows and calibrate at high difficulty.
- Nodes cost **Culture** and compete with the main civics tree for it — a custom tree has
  built-in opportunity cost, same as Theology/civ-unique trees.

## Working example

Proven via the custom-civics-tree litmus (2026-07-09) — one 3-node tree (root + 2 tracks) per
Age, each Age a different reveal route (AQ = effect via wrapper ✅ verified; EX = always-true
reqset; MO = conditional after Political Theory), plus a depth-2 mastery on a custom node and
tradition/slot/settlement-cap rewards. For shipped wiring at scale, see the Ascendancy tree in
the public metropolis-ascendant repo (github.com/chrislittle/metropolis-ascendant).
