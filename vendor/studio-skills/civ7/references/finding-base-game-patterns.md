# Finding real EFFECT_/REQUIREMENT_/COLLECTION_ names in the base game

The single most important authoring habit: **never invent names.** Effect names,
requirement names, collection names, and especially **argument names** are not
guessable and not consistently documented. The base game is the source of truth — copy
a real, working usage and adapt the values.

## Where the base game lives

```
C:\Program Files (x86)\Steam\steamapps\common\Sid Meier's Civilization VII\Base\modules
```

Subfolders that matter:

| Folder | Holds |
|--------|-------|
| `base-standard` | Core gameplay tables, civilizations, shared GameEffects. |
| `age-antiquity`, `age-exploration`, `age-modern` | Per-Age content: projects, traditions, tech/culture trees, age-specific effects. |
| `core` | Engine/front-end config (schemas, setup). |

The content you grep is in `.xml` (data + GameEffects) and `.sql` files, plus
`.modinfo` manifests. Workshop mods (more real examples) live under
`steamapps\workshop\content\1295660`.

**DLC content lives elsewhere — grep it too.** Effects and patterns unique to a DLC
civ/leader are **not** in `Base\modules`; they're under the game's `DLC` folder:

```
C:\Program Files (x86)\Steam\steamapps\common\Sid Meier's Civilization VII\DLC\<name>\modules
```

e.g. `DLC\qajar\modules\data\civilizations-shared-gameeffects.xml`. Some of the most
useful, otherwise-undiscoverable effects live only here — the Qajar civ's
`EFFECT_CITY_ADJUST_YIELD_PER_UNDER_SETTLEMENT_CAP` (yields per settlement *under* the
cap), for instance. If a concept exists in-game but you can't find its effect anywhere in
`Base\modules`, it's probably a DLC ability — widen the grep `path` to the game root (or
the `DLC` folder) before concluding it isn't moddable. (City-state **suzerain**
per-type effects like `EFFECT_CITY_ADJUST_YIELD_PER_SUZERAINED_CITY_STATE_TYPE` *are* in
`base-standard`/age folders, but they're easy to miss — search `SUZERAIN` broadly.)

## How to grep (use the Grep tool, or ripgrep)

**1. Find an effect and see its real arguments.** Search for the `EFFECT_*` and read a
full `<Modifier>` that uses it — the `<Argument name="...">` children tell you the
exact, case-sensitive argument names:

```
Grep: pattern="EFFECT_CITY_ADJUST_CONSTRUCTIBLE_YIELD"
      path="C:\Program Files (x86)\Steam\steamapps\common\Sid Meier's Civilization VII\Base\modules"
      output_mode="content"  -C=8
```

**2. Discover what effects even exist for a concept.** Grep broadly, then narrow:

```
Grep: pattern="EFFECT_CITY_ADJUST_\w*GREAT_WORK\w*"  -o  (only matches)
Grep: pattern="EFFECT_PLAYER_\w+"  -o     # all player effects, then eyeball
```

**3. Find a requirement's arguments** — same approach:

```
Grep: pattern="REQUIREMENT_CITY_POPULATION"  -C=4
```

(That one reveals args `MinUrbanPopulation` / `MinTotalPopulation` — which you'd never
have guessed as e.g. "Amount".)

**4. Find a table's real columns** (Projects, Traditions, ProgressionTreeNodeUnlocks):
grep the table name or a known row and read the attributes on a `<Row …/>`.

```
Grep: pattern="PROJECT_INVENT_CALCULUS"   # real Project + its completion modifiers
Grep: pattern="ProgressionTreeNodeUnlocks" -C=3
```

**5. Find a delivery pattern to copy.** When you need "how does the base game give a
player an ongoing bonus," grep for `EFFECT_ATTACH_MODIFIERS` and read the
`COLLECTION_MAJOR_PLAYERS` wrapper around it (e.g. `MOD_CS_HILLFORT`).

## Workflow

1. Describe the change in plain terms ("add +2 culture to a building type in all my
   cities").
2. Grep for a base-game modifier that does something *structurally* similar and read it
   whole — collection, effect, requirements, and every argument name.
3. Copy it into your GameEffects file and change only the **values** (yield type,
   amount, requirement thresholds), keeping the **names** exactly.
4. If the bonus is player/city scope, route it through the attach wrapper
   ([gameeffects.md](gameeffects.md#the-attach-wrapper-rule)).
5. Validate well-formedness (`scripts/validate-xml.ps1`) and deploy.

When you report a chosen effect/requirement to the user, cite the base-game file you
copied it from — it makes the choice auditable and easy to revisit.

---

# Part 2 — Never assume *semantics*

Part 1 stops you inventing names. It does not stop the more common failure: **using a
real name and assuming what it means.** A whole Modern design pass was re-cut four times
because of assumptions that the shipped data contradicted — every answer was already in
the files.

**This section deliberately does not record answers.** Thresholds, tag names, class
membership and scoping all change with patches (the 1.4.2 pass regenerated every
catalog). What is durable is *that the system exists*, *where its truth lives*, and *the
question to ask*. Look the value up every time.

## Step 0 — enumerate the space *before* you narrow

The seven checks below assume you already found the right candidate. The more common
failure happens one step earlier: **searching confirmatorily.** You go in holding a
candidate, find something that satisfies it, and stop — never learning what else was
there.

This is not a diligence problem. It is a sequencing one, and it has a fix:

**List the whole set first, then filter.** Concretely:

- **Folder before file.** `ls` the age's `data/` directory and read *every* filename before
  opening one. Files that look like variants (`-common`, `-unique`, `-shared`, `-v2`,
  `-tot-`, per-age suffixes) are usually different content, not duplicates. If six files
  share a prefix, know what all six hold before using one.

- **⛔ Grep the shipped XML CASE-INSENSITIVELY.** Attribute spellings are *not* consistent
  between Ages. Progression-tree nodes carry their art as `IconString=` in Antiquity and
  Modern but `Iconstring=` (lowercase s) in Exploration. The game's database loader
  matches column names case-insensitively so it renders perfectly and nothing ever logs a
  complaint — but a case-sensitive `grep`/`re` **silently drops an entire Age**. Proven
  2026-08-09: a scan for `IconString="tech_…"` returned 32 tech icons across three Ages
  and looked like a complete answer; case-insensitive returned 46, and the per-Age split
  went from 16 / 1 / 17 to 41 / 41 / 47. Assume any attribute may be spelled either way.

- **⛔ The XML is not the whole database — scan `.sql` too, and apply it LAST.** Both games
  let a mod (and the base game's own text) load rows from SQL as well as XML, and SQL runs
  *after* the XML, so an `UPDATE` silently overrides what the XML said. Reading only the
  XML reports pre-update values as if they were final. Proven 2026-08-09 mining Civ VI's
  *More Great People*: its 88 display names lived in `Localisation.xml` under a **lowercase
  `tag=`** (uppercase `Tag=` everywhere else in the same file), its effect text lived in an
  `INSERT INTO EnglishText` inside `6T_Text.sql`, and `6T_Update.sql` carried **32
  `SET EraType=…` statements** that moved people between eras. An XML-only, case-sensitive
  pass produced 88 names showing as raw ids and 32 people filed under the wrong era — with
  no error anywhere. Extend the case-insensitive rule to attribute *names*, not just values,
  and always ask "does a later file overwrite this row?"

- **⛔ Never hard-code the set of valid values you iterate over.** A render loop or report
  driven by a fixed list (eras, ages, classes, yields) silently drops every row whose value
  is outside it, and the output still looks complete. Same session: a canonical eight-era
  list dropped 12 people who used the Vikings scenario's own `Early`/`Middle`/`Late` eras
  plus 2 on `ERA_FUTURE` — 14 rows absent from a page that reported "349 people". Derive
  the set from the data, append anything unrecognised, and assert that every input row is
  reachable in the output.

- **Sanity-check the COUNT against the structure before reporting it.** The bug above was
  visible without re-running anything: three Ages each with a full tech tree cannot total
  32 techs, and one Age returning a single hit is not a result, it is a broken query. When
  a scan produces a number, state what number the game's structure implies and compare.
  A count that is silently too low looks exactly like a complete answer.
- **Class before member.** When a gate names a *class* or *tag*, expand it to its members
  and count them before judging whether it is rare or common.
- **Whole row before one attribute.** Constructible and unit rows carry many independent
  constraints — age stamp, terrain, district, tags, purchasability, network flags. Reading
  one and concluding is how a water building gets called a land building.
- **Whole argument list before one argument.** Print every `<Argument>` a requirement takes
  across *all* its usages, not just the usage you happened to open.
- **Both directions of a cross-age relationship.** Per-age folders hold content for *other*
  ages too. A civ's late-age material can live under its own early-age folder — so
  searching only the age you are designing for will miss it.

**Then say what you searched.** Report the boundary of the search, not just the finding:
"across all age folders" or "in `age-modern/data` only" are very different claims. Stating
it makes an incomplete sweep visible instead of silently reading as complete — to the user
*and* to you.

**The tell:** if you can describe the thing you were looking for before you started
looking, you are at risk of a confirmatory search. Enumerate first anyway.

## The seven checks

Run these on any mechanic before designing on it.

**1. What does it actually count?**
Read the **argument values** in shipped usages, not just the argument names. A
requirement used at `Count=15` is not counting distinct types when the thing it counts
only has two or three variants — it is counting copies.

**2. What is it scoped to?**
Scoping usually lives in a *sibling* requirement inside the same `<RequirementSet>`, not
in the requirement you are reading. Grep a usage with `-B6 -A6` and look for
`REQUIREMENT_PLOT_DISTRICT_CLASS`, `REQUIREMENT_CITY_IS_CITY`, `REQUIREMENT_CITY_IS_TOWN`
and age filters sitting next to it. A requirement that looks universal is often only ever
used under a narrow gate.

**3. Is it the engine stopping you, or just convention?**
If every shipped usage is scoped one way, that may be a *design choice*, not a limit.
Check the underlying data before concluding something is impossible: if a value is
computed from terrain/features/adjacency, it exists everywhere that terrain does,
whatever the base game chooses to pay out on.

**4. What gates it — and how big is that gate really?**
Find the unlock modifier (`EFFECT_*_UNLOCK_*`, or a `RequiresUnlock="true"` flag on the
row) and read its requirements. **Expand any CLASS to its members before calling
something rare** — a resource-class or tag gate that sounds like a strategic check is
often a broad, common set. Ages also *reclassify* things, so check the age folder's
`<Update>` blocks, not just the base row.

**5. Is it something the player does by default?**
If normal play satisfies it, it is not an achievement — it is a description of the game.
Check what the subject does unprompted before building a goal on it.

**6. Player-facing name ≠ data id.**
Resolve the `LOC_*` name before writing any user-visible text. Several systems ship data
ids that differ sharply from what the player sees on screen, and using the raw id is
wrong even when the mechanic is right.

**7. Version-stamp anything you do record.**
If you must write a value down, date it and name the file you read it from, so the next
reader knows to re-check rather than trust.

## Enumerate the *gateways*, not just the mechanics

When you need content to build a condition on, sweeping requirement names finds you *mechanics*. It
does not find you **gateways** — content locked behind a commitment the player has to make. Those are
easy to miss precisely because a gateway's payload looks ordinary in the data: an improvement, a
project, a tree node. What makes it a gateway is the *unlock chain sitting behind it*.

Sweep these before concluding a system has nothing to offer. Look up current specifics per Part 2 —
this is a map of where to look, not a list of answers.

| Gateway | What the player must commit to | Where it is defined |
|---|---|---|
| **City-state suzerainty** | win and hold a city-state; types unlock their own improvements | `REQUIREMENT_PLAYER_ELIGIBLE_CS_BONUS`, `EFFECT_PLAYER_GRANT_CONSTRUCTIBLE_UNLOCK`, the `CITY_STATE_UNIQUE_IMPROVEMENT` tag, `independents*.xml` |
| **Town specialisation** | an exclusive, permanent choice for the Age; also governs what that town may *purchase* | `projects.xml` (`ExclusiveSpecialization`, `RequiresUnlock`, `PrereqPopulation`) + the bundles in `projects-gameeffects.xml` |
| **Ideology / government** | a once-per-Age pick, changeable only by crisis | ideology rows (`FirstTreeNode`, `RivalIdeology`), `Government_GoldenAges` |
| **Node masteries** | a second pass over a node already researched | `UnlockDepth="2"` rows in the progression trees |
| **Civ-unique trees** | research outside the shared tree; different every game | trees named `TREE_CIVICS_` (plural) — note `TREE_CIVIC_` singular is the main tree and its branches |
| **Age-transition cards** | a one-time pick at the Age boundary | `age-transition.xml`, `age-transition-gameeffects.xml` |
| **Crisis stages** | time-gated, and shared by every player at once | `crisis-stages.xml`, `REQUIREMENT_AGE_CRISIS_STAGE_IS_X` |

**⚠ A gateway keyed to per-civ ids needs a generator, not a hand-written list.** Unique trees and
civ-unique improvements enumerate by id, span Base *and* DLC, and grow with every civ pack. A civ whose
ids are missing simply cannot satisfy the condition — no error, no log line, it silently never fires.
Generate the list, and add a check that fails the build when the game and your mod disagree.

## Where each system's truth lives

Use this as a lookup map, not as an answer sheet. Paths are relative to
`Base\modules`; always widen to `DLC\` if a search comes up empty (Part 1).

| Question | Read | Ask |
|---|---|---|
| What does a requirement mean / accept? | grep the `REQUIREMENT_*` across all ages, `-B6 -A6` | what are the argument *values*, and what sits beside it in the set? |
| Is a building/improvement gated? | `age-*/data/constructibles.xml`, the row itself | age stamp, `Purchasable`, `Town`, `MultiplePerCity`, district rows, and any network/prereq flag |
| What unlocks a project or focus? | `age-*/data/projects.xml` for `RequiresUnlock`; then grep the project id in `*gameeffects*` | which modifier grants it, and what does *that* require? |
| What does a town focus do? | `age-*/data/projects-gameeffects.xml` | its modifier bundle — including what it lets the town **purchase** by tag |
| Which buildings carry a tag? | the `<TypeTags>` block in `constructibles.xml`, per age | are the matches generic, or civ-unique? |
| What is in a resource class? | `age-*/data/resources*.xml` — including `<Update>` blocks | which age reclassifies what, and how many members are there? |
| Which node unlocks X? | `age-*/data/progression-trees-*.xml` | is it *this* node (circular) or one below (legal)? |
| What can a gossip event filter on? | grep `<Argument name="GOSSIP_*">` values across all ages | enumerate the whole parameter namespace before using a flag |
| Does an event fire on start or completion? | the gossip name itself, plus any `REQUIREMENT_PLAYER_HAS_COMPLETED_*` sibling | is there a completion event at all, or only a started one? |
| Is a unit/building civ-specific? | `TraitType` on the row; `UNIT_CLASS_UNIQUE` in `<TypeTags>` | how many civs actually get it? |

## The rule that follows from all of this

**Cite the file for every non-obvious claim you make about a mechanic.** If you cannot
name where you read it, you are guessing — say so explicitly rather than stating it flat.
