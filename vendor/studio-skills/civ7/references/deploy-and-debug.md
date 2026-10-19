# Deploy, test, and debug

The whole debugging problem in Civ VII is **observability**: a broken mod usually
produces no error. So the workflow is built around *proving* each state transition —
discovered, enabled, applied — rather than assuming it.

## Contents
- [Paths you'll use](#paths-youll-use)
- [Deploy + test loop](#deploy--test-loop)
- [The three states (and how to confirm each)](#the-three-states)
- [Reading the logs](#reading-the-logs)
- [Inspecting the Mods.sqlite registry](#inspecting-the-modssqlite-registry)
- [Dev settings (AppOptions.txt)](#dev-settings-appoptionstxt)
- [Live-poking the game: FireTuner (and the UI-mod dev loop)](#live-poking-the-game-firetuner-and-the-ui-mod-dev-loop)
- [The litmus mod](#the-litmus-mod)

## Paths you'll use

Base of the user-data folder (`%LOCALAPPDATA%` = `C:\Users\<you>\AppData\Local`):

```
%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VII\
├── Mods\            ← deploy your mod folder here
├── Logs\            ← Modding.log, Database.log (OVERWRITTEN each launch)
└── Mods.sqlite      ← the mod registry (locked while the game runs)
```

- Base game data to grep: `C:\Program Files (x86)\Steam\steamapps\common\Sid Meier's Civilization VII\Base\modules`
- A bundled `sqlite3.exe` is often at `%TEMP%\sqlitetools\sqlite3.exe`.

## Deploy + test loop

1. Keep a **dev source of truth** outside the game folder (e.g. `C:\dev\civ7-mods\my-mod`).
2. Deploy = remove the old deployed copy, then copy dev → `Mods\`:
   `powershell scripts/deploy-mod.ps1 <dev-folder>`. Deploy a **copied folder**, not a
   junction. Local mods apply fine — no Steam Workshop needed. Re-copying over a
   deployed mod is harmless; it doesn't desync the enable toggle.
3. Launch the game → **Add-Ons** menu → toggle the mod **Enabled**.
4. **Start a NEW game.** Most gameplay actions bind at game start; enabling mid-game or
   loading an old save won't apply them.
   ⚠ This extends to **updating** a mod: modifiers ADDED to an already-enabled mod after a
   game was created NEVER attach to that game's saves (litmus-proven 2026-07-11,
   gen2-featreq-litmus v1→v2): the `GameModifiers` → `EFFECT_ATTACH_MODIFIERS` bindings
   execute at game CREATION only; loading a save re-applies the modifier state stored in
   the save (the old modifiers keep working) but does not re-execute bindings for new
   modifier ids — even after a full app restart with "Applied all components" in
   Modding.log and a clean Database.log. Two consequences: (a) iterating on a litmus needs
   a fresh game per content addition, and (b) a shipped mod UPDATE with new modifiers does
   not affect players' in-progress games — new bonuses land on their next new game. Also
   note: the game process scans mod files at APP LAUNCH; quitting to the main menu does
   NOT re-read a redeployed modinfo — full exit + relaunch required to pick up a new
   version at all.
5. Verify it applied (next section) before concluding anything about your content.

After any edit, repeat 2–5. Editing files in the deployed copy directly also works, but
keeping a dev source + re-deploying avoids confusion about which copy is live.

## The three states

These are independent. A mod can be in an earlier state while *looking* like a later
one — that's the trap.

| State | Means | How to confirm |
|-------|-------|----------------|
| **Discovered** | Engine found the folder/modinfo. | `Modding.log` has a `Loading Mod …` line for it. |
| **Enabled** | Toggled on in Add-Ons. | Add-Ons UI shows it on; `Mods.sqlite` → `Mods.Disabled` is NULL/0. |
| **Applied** | Its action groups actually ran and inserted rows. | `Modding.log` lists it under **"Applied all components of enabled mods"** with its ` * <actiongroup>` lines, AND it's in the **"Target Mods"** list. |

**Only "Applied" means your rows ran.** The classic failure: a non-integer version
leaves a mod Discovered + Enabled but **never Applied** (dropped from Target Mods),
with no error. Always confirm Applied, e.g. `powershell scripts/check-applied.ps1 <mod-id>`.

> "Passed Validation" / FK validation in the log refers to the **whole database**, not
> proof your specific rows loaded. If the mod never applied, its rows were never
> inserted, so there was nothing of yours to validate.

## Reading the logs

`Logs\Modding.log` and `Logs\Database.log` are **overwritten every launch** — copy
them if you want to compare across runs.

- **Load/exclusion failure** (mod never applies): look for the mod in the "Target Mods"
  list and under "Applied all components of enabled mods." If it's absent there despite
  being enabled, it was excluded (check version first).
- **Runtime crash** (applied, then the game dies): `Modding.log` looks *clean* — it
  often ends with "Successfully reconfigured game" and then the process exits. A clean
  log that ends normally followed by a crash points at a runtime issue like the
  `OwnerRequirements`-on-constructibles crash, **not** a load failure.
- `Database.log` surfaces SQL/FK errors during data application — check it when rows you
  expected are missing.

## Inspecting the Mods.sqlite registry

`Mods.sqlite` records what the engine thinks about each mod (notably the stored
**Version** and the **Disabled** flag). It's **locked while the game runs**, so query a
**copy**: `powershell scripts/inspect-registry.ps1 [<mod-id>]` does the copy + query.
Manually it's:

```powershell
$src = "$env:LOCALAPPDATA\Firaxis Games\Sid Meier's Civilization VII\Mods.sqlite"
Copy-Item $src "$env:TEMP\Mods_copy.sqlite" -Force
& "$env:TEMP\sqlitetools\sqlite3.exe" "$env:TEMP\Mods_copy.sqlite" `
  "SELECT ModRowId, ModId, Disabled FROM Mods;"
& "$env:TEMP\sqlitetools\sqlite3.exe" "$env:TEMP\Mods_copy.sqlite" `
  "SELECT * FROM ModProperties WHERE Name='Version';"
```

- `Mods.Disabled`: NULL/0 = enabled, 1 = disabled.
- `ModProperties` holds the **Version the engine actually parsed** — if your modinfo
  says `1` but this shows `0`/empty, you've found a version-parse problem.

## Dev settings (AppOptions.txt)

`AppOptions.txt` sits next to the `Mods` folder (same directory as `Logs`). Options are
commented out with a leading `;` and default off — **remove the `;` and set the value to
`1`** to enable. The five worth turning on for modding (per the official dev-kit
"Getting Started" doc):

| Setting | Effect |
|---------|--------|
| `CopyDatabasesToDisk 1` | after a game starts, dumps the live DBs as `.sqlite` in the `Debug` folder (`gameplay-copy.sqlite`, frontend, localization) — the definitive way to see **every** table/column/value available, including engine-defined types not present in `Base/modules` XML. Overwritten on exit-to-menu / new game. |
| `EnableTuner 1` | lets **FireTuner** connect (see below). |
| `EnableDebugPanels 1` | in-game debug panels via the `` ` `` (backtick) key; also where `UIShortcuts` HTML panels appear. |
| `UIDebugger 1` | inspect the running UI's HTML/CSS/JS from **Google Chrome** (buggy in other browsers). |
| `UIFileWatcher 1` | hot-reloads already-loaded UI files as you edit them — no restart for UI-only changes (DB/text still need a full restart). |

⛔⛔ **A GAME PATCH REGENERATES `AppOptions.txt` AND SILENTLY REVERTS EVERY ONE OF THESE.** Hit
2026-08-22: FireTuner stopped connecting with no other symptom, and the file had been rewritten from
the default template — every dev setting commented out again, with only `Version`,
`DisableModsOnStartupVersion` and `FirstBoot` left uncommented. It looks like a blocked port, a
firewall, or the mod you happen to be working on, and it is none of them.
➡ **When a dev tool stops working for no reason, check this file FIRST** — `grep -n "^EnableTuner"`
answers it in one command. Keep a copy of your edited version somewhere the patcher cannot reach.

`CopyDatabasesToDisk` is the answer whenever you need to confirm an effect/requirement
argument name or a table's real columns and grepping `Base/modules` isn't enough — the
runtime DB has the complete picture.

## Live-poking the game: FireTuner (DIAGNOSE before you rebuild)

⭐⭐ **THE #1 TIME-SAVER — read the runtime state in the console BEFORE starting any
restart→retest or litmus cycle.** When a mod misbehaves in-game (wrong number, a yield in
the wrong bucket, a value you can't explain, a color that won't apply), a data/DB change
costs a **full app restart + a brand-new game** to test (the app scans mods at launch AND
bakes data into a save at creation — see the engine law below), so every *guess* there
burns 5+ minutes. A console probe answers "what is the real value / where does it come
from" in seconds with no restart. In one session this collapsed an ~8-cycle restart
marathon (plus two wrong root-cause guesses) into a **single** probe. Guessing a cause and
rebuilding to test it is the slow path; **read the truth first.**

FireTuner (SDK → *Civilization VII SDK* → FireTuner) has a **Scripting Console** that
evaluates JavaScript against the running game — the same VM UI mods use. (An in-app
browser/console tool, if you have one, hits the same VM.) Rules that bite:
- Input is **single-line** — wrap multi-statement probes in an IIFE.
- The console prints the **return value**, NOT `console.log` — end with `return JSON.stringify(...)`.
- In the **console**, `GameContext` is often **undefined** — use `Game.localPlayer` for the
  local player id (`0` in single-player). Inside a UI-mod **module**, `GameContext.localPlayerID`
  works. They differ — don't paste a module snippet verbatim into the console.
- API methods live sometimes as own-props (`Object.keys(obj)`), sometimes on the prototype
  (`Object.getPrototypeOf(obj)`) — dump both when hunting for a method name.

### Two probes that pay for themselves

**1. Attribute ANY yield to its exact source — the "why is there a mystery +N?" probe.**
`city.Yields.getYields()` returns a per-yield array (index = `GameInfo.Yields[i]`); each
yield is `{base:{value,steps}, modifier:{value,steps}}`, and **every step carries a `value`
+ a `description` (its label).** The yields-breakdown UI's "Base / From Buildings / Adjacency
/ Other" buckets are just these steps grouped by label — so an unexplained **"Other"** line
*names itself* once you walk the tree:
```js
(()=>{const c=Players.get(Game.localPlayer??0).Cities.getCities()[0];const ys=c.Yields.getYields();let fi=-1;for(let i=0;i<GameInfo.Yields.length;i++)if(GameInfo.Yields[i].YieldType==='YIELD_FOOD'){fi=i;break;}const f=ys[fi];const o=[];const R=(s,d)=>{if(!s)return;for(const x of s)if(x.value){let l=x.description||'(unlabeled)';try{if(typeof l==='string'&&l.startsWith('LOC_'))l=Locale.compose(l);}catch(e){}o.push('  '.repeat(d)+l+' = '+x.value);R(x.base&&x.base.steps,d+1);R(x.modifier&&x.modifier.steps,d+1);}};R(f.base&&f.base.steps,0);o.push('-- MODIFIER --');R(f.modifier&&f.modifier.steps,0);return o.join('\n');})()
```
Swap `YIELD_FOOD` for any yield. This instantly ends "what is that extra +N?" — it once
identified an under-cap-dividend food bonus that a numeric coincidence had made look like
an adjacency double-count. (Also: `player.Stats.getYields()` is the player-level twin; diff
its JSON before/after a change to see which leaf your modifier actually moved.)

**2. Player colors, for panel theming.** `UI.Color.getPlayerColors(pid)` → raw
`{primaryColor,secondaryColor}{r,g,b,a}`; `UI.Color.createPlayerColorVariants(pair)` → the
contrast-safe variants. Read them in-console to confirm a civ's actual color before wiring
CSS (full story + the `color: var(--x)` dead-end in ui-modding.md Colors §2).

### FireTuner vs litmus vs restart — use the cheapest that answers the question
1. **Read runtime state / attribute a value → FireTuner probe.** No restart. **Always try first.**
2. **Isolate a MECHANISM (does effect X double? does delivery Y fire?) → litmus mod.** Needs
   a restart, but strips all other content so exactly one variable is under test. ⚠ Reproduce
   the *suspected* cause in a litmus **before** restructuring/parking the real feature — a
   session was burned parking + crashing a live feature to "fix" a non-bug a one-line litmus
   would have exonerated. When the litmus stays clean across every variant, believe it: the
   cause is elsewhere (go back to probe #1).
3. **Only a data/DB/text change needs the full restart + NEW game.** UI (JS/CSS) reloads
   without a new game (a "Reload UI" cheat-panel button re-runs UI scripts live).

### UI mods: the live Coherent/Gameface debugger (port 9444) — DON'T guess DOM selectors

The game's UI is Coherent Gameface, and it exposes a **Chrome-DevTools-Protocol debugger on
`localhost:9444`** while the game runs. This is the UI equivalent of FireTuner: inspect the LIVE DOM
and run JS against it — **never guess selectors from the minified base-game `.js`.** (A whole session
was burned deploy→restart→screenshot guessing `.policy-base-card` vs `<policy-card>`; the debugger
answered it in one call.)

- **One page target.** `curl -s http://localhost:9444/json` → a single target, `url:"fs://game/root-game.html"`,
  `webSocketDebuggerUrl: ws://localhost:9444/json/devtools/page/0`. The *entire* UI (every screen, panel,
  HUD) lives in that one document — so `document.querySelector` from your UIScript reaches all of it.
- **Evaluate against the live DOM** via `Runtime.evaluate`. No Python needed — modern **Node has a
  built-in `WebSocket`** global:
  ```js
  const ws = new WebSocket('ws://localhost:9444/json/devtools/page/0');
  ws.addEventListener('open', () => ws.send(JSON.stringify({id:1, method:'Runtime.evaluate',
      params:{ expression:`(() => { /* query/DUMP the real DOM, return JSON.stringify(...) */ })()`,
               returnByValue:true }})));
  ws.addEventListener('message', e => { const m=JSON.parse(e.data);
      if(m.id===1){ console.log(m.result?.result?.value); process.exit(0);} });
  ```
- **The killer move: prototype the fix in the live DOM.** Inject your decorator's rail/badge/tint
  directly (`document.querySelectorAll(...).forEach(el => el.appendChild(...))`) and the change appears
  on screen instantly — iterate colours/positions/selectors with zero restarts, then bake the proven
  code into the mod file. `GameInfo`, `Locale`, `Players`, etc. are all in scope in that page context.
- **To find a real element:** dump the ancestor chain (tag + classes) of the element whose *own* text is
  a known label — that reveals the true container class + structure without reading minified source.
- ⚠ Requires the game to be running with the screen open. It's read/eval only against the live page;
  baking the result into a mod file still needs the normal deploy (+ UI reload for the new code).

## The litmus mod

When *anything* is unclear, deploy `assets/litmus-mod/` first. It's a minimal valid
mod (integer version, single `AlwaysMet` `UpdateDatabase` action) whose only job is to
produce an **obviously visible** in-game change (it sets every map's natural-wonder
count to 20). If the litmus mod's effect shows up, your loading/deploy pipeline works
and the problem is in your content. If even the litmus mod does nothing, the problem is
environmental (deploy location, enable step, version, new-game step) — fix that before
touching modifiers. Isolating "is it the pipeline or my XML?" this way is the fastest
way out of a silent-failure rabbit hole.
