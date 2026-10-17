# civ7-modding — a Claude Code skill

A [Claude Code](https://claude.com/claude-code) skill for building **Civilization VII** gameplay/database
mods — `.modinfo` manifests, GameEffects modifiers/requirements, projects, traditions, tech/civic-node-gated
bonuses — plus the hard-won "silent killer" rules (integer version, the attach-wrapper, MinDepth gating, etc.).
It triggers automatically when you're working on a Civ VII mod. See [SKILL.md](SKILL.md) for the full contents.

**Measured, not vibes:** on a 28-task paired benchmark (same model with vs. without the skill, every engine
identifier verified against game data), the skill scored **98% vs. 80%** on graded assertions and finished
**33% faster** — with the failure gap concentrated in "deploys cleanly, silently does nothing" traps.
Full methodology, honest tie/loss reporting, and the task list: [BENCHMARKS.md](BENCHMARKS.md).

## Install

The skill is just a folder of files that lives in a Claude Code skills directory. The installer copies it
there for you:

```bash
# Global — available in Claude Code everywhere (recommended)
npx civ7-modding-skill --global

# Project — available only when working in the current folder
npx civ7-modding-skill --project
```

Install straight from GitHub without an npm publish:

```bash
npx github:chrislittle/civ7-modding-skill --global
```

Custom location:

```bash
npx civ7-modding-skill --dir /path/to/repo   # installs to /path/to/repo/.claude/skills
```

**Manual install:** copy this folder to `~/.claude/skills/civ7-modding` (global) or
`<project>/.claude/skills/civ7-modding` (project).

After installing, **restart Claude Code** (or reload) so it picks up the skill.

## Update

Re-run the same install command. The installer **wipes and re-copies** the skill folder (it `rm`s the
target first), so you always get a clean replacement — including any files dropped upstream:

```bash
# npm registry — add @latest to bypass npx's cache and fetch the newest published version
npx civ7-modding-skill@latest --global

# …or straight from GitHub (pulls the current main)
npx github:chrislittle/civ7-modding-skill --global
```

Use the same target you installed with (`--global`, `--project`, or `--dir <path>`), then **restart Claude
Code** so it reloads the skill.

## Global vs project

- **Global** (`~/.claude/skills/`) — the skill is available in every project on your machine. Best for a
  reusable tool like this.
- **Project** (`<project>/.claude/skills/`) — the skill travels with one repo and is shared with anyone who
  clones it. Use this if you want the skill versioned alongside a specific mod project.

## Start here: ask an AI

New to modding? The fastest way in is to **let an AI do it with you.** Each prompt below has three ways to use it:

- **[Ask Claude]** / **[Ask ChatGPT]** — opens a **new web chat** with the prompt already typed. Best for *learning and planning* — the web chat is smart about Civ VII, but it can't see your computer, your game files, or this skill.
- **Copy** — hover the code block and click the 📋 icon (top-right). Paste it into **[Claude Code](https://claude.com/claude-code)** with this skill installed. That's where the AI can actually *run the scripts, read the game's data, write mod files, and deploy* — the buttons above only talk; Claude Code acts.

> Rule of thumb: **web chat to understand, Claude Code to build.**

### Learn the basics (great in the web chat)

**What even is a Civ VII mod?**

```text
I'm brand new to Civilization VII modding. In plain language, explain what a mod actually is: the .modinfo manifest, the GameEffects modifier system (collection + effect + requirements), and how a single gameplay change reaches a player. Include one tiny worked example.
```
[![Ask Claude](https://img.shields.io/badge/Ask-Claude-D97757?style=flat&logo=anthropic&logoColor=white)](https://claude.ai/new?q=I%27m%20brand%20new%20to%20Civilization%20VII%20modding.%20In%20plain%20language%2C%20explain%20what%20a%20mod%20actually%20is%3A%20the%20.modinfo%20manifest%2C%20the%20GameEffects%20modifier%20system%20%28collection%20%2B%20effect%20%2B%20requirements%29%2C%20and%20how%20a%20single%20gameplay%20change%20reaches%20a%20player.%20Include%20one%20tiny%20worked%20example.) [![Ask ChatGPT](https://img.shields.io/badge/Ask-ChatGPT-10A37F?style=flat&logo=openai&logoColor=white)](https://chatgpt.com/?q=I%27m%20brand%20new%20to%20Civilization%20VII%20modding.%20In%20plain%20language%2C%20explain%20what%20a%20mod%20actually%20is%3A%20the%20.modinfo%20manifest%2C%20the%20GameEffects%20modifier%20system%20%28collection%20%2B%20effect%20%2B%20requirements%29%2C%20and%20how%20a%20single%20gameplay%20change%20reaches%20a%20player.%20Include%20one%20tiny%20worked%20example.)

**Why does my mod show "enabled" but do nothing?** (the #1 beginner trap)

```text
In Civilization VII modding, why can a mod show "enabled" in the Add-Ons menu but apply nothing in game? List the most common silent-failure causes and exactly how to check each one.
```
[![Ask Claude](https://img.shields.io/badge/Ask-Claude-D97757?style=flat&logo=anthropic&logoColor=white)](https://claude.ai/new?q=In%20Civilization%20VII%20modding%2C%20why%20can%20a%20mod%20show%20%22enabled%22%20in%20the%20Add-Ons%20menu%20but%20apply%20nothing%20in%20game%3F%20List%20the%20most%20common%20silent-failure%20causes%20and%20exactly%20how%20to%20check%20each%20one.) [![Ask ChatGPT](https://img.shields.io/badge/Ask-ChatGPT-10A37F?style=flat&logo=openai&logoColor=white)](https://chatgpt.com/?q=In%20Civilization%20VII%20modding%2C%20why%20can%20a%20mod%20show%20%22enabled%22%20in%20the%20Add-Ons%20menu%20but%20apply%20nothing%20in%20game%3F%20List%20the%20most%20common%20silent-failure%20causes%20and%20exactly%20how%20to%20check%20each%20one.)

**How do I install this skill into Claude Code?**

```text
Walk me through installing a Claude Code skill from a GitHub repo step by step (I'll give you the repo URL), then how to confirm Claude Code actually loaded it.
```
[![Ask Claude](https://img.shields.io/badge/Ask-Claude-D97757?style=flat&logo=anthropic&logoColor=white)](https://claude.ai/new?q=Walk%20me%20through%20installing%20a%20Claude%20Code%20skill%20from%20a%20GitHub%20repo%20step%20by%20step%20%28I%27ll%20give%20you%20the%20repo%20URL%29%2C%20then%20how%20to%20confirm%20Claude%20Code%20actually%20loaded%20it.) [![Ask ChatGPT](https://img.shields.io/badge/Ask-ChatGPT-10A37F?style=flat&logo=openai&logoColor=white)](https://chatgpt.com/?q=Walk%20me%20through%20installing%20a%20Claude%20Code%20skill%20from%20a%20GitHub%20repo%20step%20by%20step%20%28I%27ll%20give%20you%20the%20repo%20URL%29%2C%20then%20how%20to%20confirm%20Claude%20Code%20actually%20loaded%20it.)

### Build with the skill (paste into Claude Code)

These need Claude Code with the skill installed — it reads the references, runs the `tools/` scripts, writes files, and deploys. **Copy** each one in.

**Step 1 — Generate the local data references first (prerequisite).** The skill's most valuable references are bulk extractions of *your own* installed game's data — every effect/requirement, the tech & civic trees and what each node unlocks, units, leaders, civilizations, mementos, religion, native Triumphs, cards, resources, constructible placement/adjacency. They aren't bundled (never redistributed), and **the AI grounds its work in them** — so run this once before anything else, and re-run after each game patch or DLC:

```text
Using the civ7-modding skill, generate its local data references: run each gen-*.py script in tools/ against my installed game, then summarize what each file produced and when I'd use it.
```

**Then — make my first mod**

```text
Use the civ7-modding skill to scaffold my first mod: an Antiquity-age tradition that grants +2 Food and +1 Culture on the Palace. Produce the .modinfo, the data XML, and the GameEffects XML, then tell me how to deploy and test it.
```

**Deploy and prove it works**

```text
Deploy my Civ VII mod to the game's Mods folder and verify it actually applied (Discovered - Enabled - Applied) using the skill's scripts. Report what you find.
```

**Debug a mod that does nothing**

```text
My Civilization VII mod shows enabled but does nothing. Use the civ7-modding skill's troubleshooting reference to diagnose it with me, checking the most likely causes first.
```

> **Tip:** the *Ask* links just pre-fill the message — you still press Enter. Want your own? Any prompt becomes a link with `https://claude.ai/new?q=` or `https://chatgpt.com/?q=` followed by your URL-encoded text.

## Generate the data references (first run)

A handful of references are **bulk extractions of the games'/SDK's own data and text**, so they're **not
bundled** (never redistributed). You generate them once from your own install — and re-run after each game
patch or DLC. Each has a script in `tools/`:

```bash
# --- Civilization VII (auto-detects the install via $CIV7_ROOT -> Steam libraries) ---
python tools/gen-effects-catalog.py        # effects-collections-catalog.md  (every EFFECT_/COLLECTION_/REQUIREMENT_ + args)
python tools/gen-names-trees.py            # display-names.md + progression-trees.md  (id->English names; tech/civic trees)
python tools/gen-constructibles-catalog.py # constructibles-catalog.md  (every building/wonder/improvement + its Age)
python tools/gen-cards-catalog.py          # cards-suzerain-governments-catalog.md  (all base+DLC cards / suzerain / govts)
python tools/gen-civilopedia-concepts.py   # civilopedia-concepts.md  (the game's own Civilopedia mechanic prose)
python tools/gen-devkit-docs.py            # dev-kit-official-docs.md  (Firaxis's SDK modding docs; needs the Civ VII Development Tools installed)
python tools/gen-units-catalog.py          # units-catalog.md  (every unit: class/stats/cost/unlock + commander & promotion trees)
python tools/gen-leaders-catalog.py        # leaders-catalog.md  (every leader -> the real EFFECT_ behind its ability)
python tools/gen-civilizations-catalog.py  # civilizations-catalog.md  (every civ: ability + uniques + which have a unique quarter)
python tools/gen-mementos-catalog.py       # mementos-catalog.md  (every Memento + effect + the anti-duplication "taken effects" index)
python tools/gen-religion-catalog.py       # religion-and-beliefs-catalog.md  (all beliefs by class + the pantheon/relic wiring)
python tools/gen-triumphs-catalog.py       # triumphs-legacies-catalog.md  (all native Triumphs + the "don't-duplicate" metric list)
python tools/gen-constructibles-placement.py # constructibles-placement-adjacency.md  (placement land/water/terrain + adjacency yields)
python tools/gen-resource-effects-catalog.py # resource-effects-catalog.md  (every resource -> its concrete effect: yield/combat/production)

# --- Optional: Civilization VI, for design inspiration (auto-detects via $CIV6_ROOT) ---
python tools/gen-civ6-cards-catalog.py     # civ6-policies-governments-catalog.md  (Civ VI policies + governments)
```

Set `CIV7_ROOT` (or `CIV6_ROOT`, or `CIV7_DEVKIT_ROOT` for the dev-tools docs) to override auto-detection.
Output lands in `references/` and is `.gitignore`d, so you never commit game data. Everything else in
`references/` is authored and ships with the skill. Not sure which to run? Use the **"generate its local data
references"** prompt in the section above — Claude Code will run them for you and explain each one.

## License

MIT — see [LICENSE](LICENSE).
