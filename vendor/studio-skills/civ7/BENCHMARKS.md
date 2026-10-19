# Benchmarks: skill vs. no-skill

*Iteration 1 — July 2026, Civilization VII patch 1.4.2*

Does this skill actually help? We measured it: **28 realistic modding tasks**, each run twice by the same model (Claude Sonnet) under identical conditions — once with this skill loaded, once without it ("baseline"). Both arms had full access to the installed game's data files and the official Development Tools; the baseline simply had no skill. Every answer was then graded by an independent agent against per-task assertions, with **every engine identifier verified against the game's own data** (an invented `EFFECT_*`/`REQUIREMENT_*` name is an automatic failure — in Civ VII it usually means a crash or a silently dead mod).

## Headline results

| | With skill | Baseline |
|---|---|---|
| Assertions passed | **98.3%** (114/116) | 80.2% (93/116) |
| Tasks with a perfect score | **26 / 28** | 14 / 28 |
| Head-to-head | **12 wins · 15 ties · 1 loss** | |
| Total agent time (all 28 tasks) | **179 min** | 268 min |
| Total tokens | 4.12M | 3.81M |

Three honest takeaways:

1. **The skill's value concentrates in "confidently wrong" failures.** The baseline's misses were rarely visible errors — they were mods that deploy cleanly and silently do nothing, or crash. Examples from this run: declaring a non-integer modinfo version "fine and not your problem" (it silently disables the whole mod); shipping a "fixed" modifier binding that still never fires (no owner context); fabricating two effect names and reusing the real `UNIT_PROSPECTOR` id for a "new" unit (a database collision); a complete mod whose modifier is never bound anywhere, described as deployable; a custom civ whose unique unit has no 3D-model wiring; pantheon beliefs with no icon rows. Every one of these would cost a real modder an evening.
2. **Where the game's own files teach the answer, a strong model ties without the skill — just slower.** Feasibility questions, patterns with abundant shipped precedent, and anything a thorough grep can settle came out even on correctness. The skill's edge there is time (~33% faster overall) and first-try precision, not exclusive knowledge. We report this rather than hide it.
3. **The skill costs ~8% more tokens and buys correctness and speed with them.** It reads references before acting; the baseline burns its tokens re-deriving (or failing to re-derive) engine facts.

The one baseline *win* is worth naming: on the key-binding-editor task, the with-skill run shipped XML comments containing a bare `--` (invalid XML — ironically the same trap that sank a baseline on another task), while the baseline delivered clean files via an alternative override mechanism. Benchmarks that never lose a pair should not be trusted; this one lost exactly where it deserved to.

## Results by category

| Category (tasks) | With skill | Baseline |
|---|---|---|
| Debugging traps (6) | **24/24** | 18/24 |
| Build: basics (3) | 13/14 | 10/14 |
| Build: game mechanics (9) | **38/38** | 29/38 |
| Build: UI (7) | 27/28 | 25/28 |
| Research / feasibility (2) | 8/8 | 8/8 |
| Extending a third-party mod (1) | 4/4 | 3/4 |

The debugging gap is the starkest: those six tasks encode failure modes that were established by real in-game testing and exist in no official documentation — which is precisely why they're in the skill.

## The task set

Tasks were harvested from three sources, not invented: real debugging history (bugs actually hit and solved in-game), re-derivations of shipped mod mechanics (where a proven implementation serves as the answer key), and the techniques used by the most-subscribed Workshop mods. In brief:

**Debugging**: the inert-mod version trap · player/city modifier with no owner context · Great Works evicted by a windowed capacity effect · "+1 per adjacent Wonder" that never fires · cross-Age foreign-key crash · a Triumph-completion requirement that never evaluates live.
**Build (data)**: tech-gated city project · gated per-population tradition card · custom civics tree that renders and researches · resource-claiming consumable unit · minimal custom civilization · two pantheon beliefs · rural-tile yield boost · narrative event with reward choices · new town specialization · on-raze bonus (no native hook — honesty test) · river-restricted building with farm adjacency · custom Age-transition Dedication card.
**Build (UI)**: decorate-don't-replace info row · policy-card chips that coexist with other mods · live-stats popout dashboard · custom map lens with its own minimap button · computed diplo-ribbon stat row · cross-mod stand-down criteria · getting a modded hotkey into the key-binding editor.
**Research**: exact-identifier rapid-fire questions · Civ 6 → Civ 7 port feasibility gate.
**Third-party**: companion patch for a popular Workshop mod without editing its files.

## Does the model matter? The Haiku tier

The same 28 tasks, paired and graded with the same rubrics, run by **Claude Haiku** (a smaller, cheaper model):

| | Sonnet + skill | Sonnet baseline | Haiku + skill | Haiku baseline |
|---|---|---|---|---|
| Assertions passed | 98% | 80% | **77%** | **47%** |
| Skill delta | **+18 pts** | | **+31 pts** | |
| Head-to-head | 12W · 15T · 1L | | 16W · 8T · 4L | |
| Agent time (total) | 179 min | 268 min | 100 min | 125 min |

Three findings worth stating plainly:

1. **The skill's value roughly doubles on the smaller model.** Haiku baselines collapsed on exactly the tasks Sonnet baselines survived by brute-force research: fabricated APIs, a Civ 6-era modinfo schema that would never load, a decorator whose card-matching function always returns null, invented table names. Haiku with the skill recovered most — not all — of that ground.
2. **The skill is not a harness for a model below the task.** Haiku *with* the skill still fabricated identifiers on several hard tasks and lost four pairs outright (including one 0-score where it invented three resource-detection APIs around an otherwise correct architecture). On the two hardest build tasks (custom civilization, custom pantheon) both Haiku arms effectively failed. If your work is trap-heavy or spec-precise, the skill helps most on a model that can already almost do the job.
3. **A benchmark loss became a skill fix became a win.** Sonnet's only lost pair (the key-binding editor) exposed a wrong hook name in the skill's own docs; it was fixed mid-program, and the Haiku tier then won that same pair 4/4 vs 2/4 using the corrected text. That loop — benchmark finds the flaw, the flaw gets fixed, the next tier confirms it — is the main reason to keep running this.

## A contamination event, disclosed

Midway through the Haiku tier, one baseline answer quoted a distinctive internal design-law phrase verbatim with almost no research. Investigation showed the cause: the test harness's project-memory file (a development-notes index) was being injected into every agent's context, and it contained condensed answers to several trap tasks. The response: the affected run was quarantined and re-run; every subsequent prompt carried an explicit instruction to treat that context as off-limits; and — most importantly — the three prior-tier baseline ties most likely to have been seeded were **re-run under decontaminated conditions**. All three baselines independently re-derived their answers from game data with citations, so the published Sonnet numbers stand unchanged. Because the leak could only have *helped* baselines, all skill deltas reported here are lower bounds. We disclose this because a benchmark you can't audit is a benchmark you shouldn't trust.

## Method notes and limitations

- One trial per task per condition (no variance estimate yet); runner model Claude Sonnet; graders were independent agents (Sonnet/Haiku) with explicit per-task assertions and file-level verification duties. Grading rubrics encoded ground truth established by in-game testing.
- The baseline was barred from this skill and its source project but allowed the installed game, official docs, and its own knowledge. In a handful of UI tasks, baseline agents also consulted popular Workshop mods installed on the test machine — realistic modder behavior, so those runs were kept and the deviation noted; several of the resulting ties trace to exactly that.
- Some tasks derive from the same field experience that built the skill, so the deck is home-turf by construction. The counterweights: every assertion is independently checkable against game data, the tie rate is reported, and the task list above is public — rerun it with any model and judge for yourself.
- The benchmark already improved the skill mid-run: it caught one incorrect hook name in the skill's own hotkey documentation (fixed), exposed a missing XML-comment lint, and surfaced two engine mechanisms the skill hadn't documented. That feedback loop is the point: iteration 2 will re-run this set after the current documentation expansion.
