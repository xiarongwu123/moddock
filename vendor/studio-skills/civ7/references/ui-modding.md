# UI modding (JavaScript / HTML / CSS)

Civ VII's entire interface is an embedded HTML/JS runtime (Coherent GT): every screen,
panel, lens, and tooltip is a web component defined in `Base/modules/core/ui/` and
`Base/modules/<module>/ui/`. UI mods ship JavaScript that runs inside that runtime.
This is a **separate modding domain** from gameplay/database mods: no Modifiers, no
GameEffects — instead you decorate or patch the game's own JS components.

Everything in this reference is distilled from shipping, working Steam Workshop mods
(all public, good study material — subscribe and read the source in
`steamapps/workshop/content/1295660/<item-id>/`):

| Pattern source | Mod (Workshop item) | Author |
|---|---|---|
| Decorators, shared Mod-Options tab, file replacement, ui-next | City Hall (3507102289) | beezany |
| Lens-layer prototype patch | Concise Specialists Lens (3506915277) | JNR |
| Custom lens/layer/interface-mode/view/hotkeys, per-game storage | Detailed Map Tacks (3507297712) | wltk |
| Component prototype patching | Advanced Yield Bar (3512790304) | izica |
| Modifier/requirement evaluation in JS, cross-mod API, TS stubs | Policy Yield Previews (3515801789) | leonardfactory |
| Custom screens, dock buttons, SQL text, settings manager | Drongo's suite: Cheat Panel (3734207916), Wonder Screen (3734274579), City Planner (3734169112), Top Panel (3734234006), Adjacency Lens (3737207667), etc. | Drongo / One More Turn |

## Contents

- [Modinfo wiring for UI mods](#modinfo-wiring-for-ui-mods)
- [The three patch techniques (prefer the least invasive)](#the-three-patch-techniques)
- [Custom screens and panels](#custom-screens-and-panels)
- [⭐ Reuse the game's parts, don't imitate them](#-reuse-the-games-parts-dont-imitate-them)
- [Lenses and lens layers](#lenses-and-lens-layers)
- [Interface modes and views](#interface-modes-and-views)
- [Hotkeys](#hotkeys)
- [Mod options and the shared settings store](#mod-options-and-the-shared-settings-store)
- [Persisting mod data](#persisting-mod-data)
- [The JS game API surface](#the-js-game-api-surface)
- [Cross-mod integration](#cross-mod-integration)
- [ui-next: the second UI stack](#ui-next-the-second-ui-stack)
- [⛔⛔ Never identify game content by its rendered text](#-never-identify-game-content-by-its-rendered-text-shipped-bug-law-2026-09-06)
- [Debugging UI mods](#debugging-ui-mods)
- [Colors: leaders, player-color CSS, plot tinting, tree icons](#colors-leaders-player-color-css-plot-tinting-tree-icons)

## Modinfo wiring for UI mods

UI mods use the same `.modinfo` anatomy as data mods (integer Version rule included)
but different Actions:

- **`<UIScripts><Item>path.js</Item></UIScripts>`** — load a JS file as an ES module
  when the context starts. This is the workhorse: decorators, patches, and component
  definitions all load this way.
  ⚠ **LIST ONLY THE ENTRY POINTS.** Anything reached by `import` from a listed module
  loads automatically, and the import graph is also what fixes load order between your
  own modules. **Listing an imported module here as well EXECUTES IT TWICE** — so a
  decorator registers twice, a listener double-fires, and a module-level `setInterval`
  runs two copies. (Better City UI, Najane: 40+ modules, exactly two `UIScripts` rows.)
- **`<ImportFiles><Item>path</Item></ImportFiles>`** — mount a file into the UI
  virtual filesystem so it's addressable at an `fs://game/...` URL. Used for `.html`
  templates, `.css`, and `.png` assets — **and for wholesale replacement of base-game
  UI files**: an imported file whose relative path matches a base module file (e.g.
  `ui/production-chooser/panel-production-chooser.js`, which exists in
  `base-standard`) **shadows the original** — the game loads your copy instead
  (Drongo's Compact Production and Policy Screen work entirely this way; City Hall
  replaces four files this way). Replacement is the most conflict-prone technique —
  see the ladder below.
- **`<UpdateIcons>`** — icon XML (`IconDefinitions`). `<Path>` can point at an
  imported PNG: import `assets/logo.png`, then `<Path>fs://game/logo.png</Path>`.
- **`<UpdateText>`** — accepts **`.sql` files as well as XML**. Several mods write
  text as `INSERT OR REPLACE INTO LocalizedText (Tag, Language, Text) VALUES (...);`
  — same table, free choice of format. Localize per-language with the `locale`
  attribute: `<Item locale="de_DE">text/de_DE/InGameText.xml</Item>` (no attribute =
  default/en_US).
- **`<UpdateDatabase>` is scope-sensitive**: in a `scope="shell"` group it writes the
  **frontend/config database** (input tables like `InputActions`,
  `InputActionDefaultGestures`, `InputContextConstraints` live there); in a
  `scope="game"` group it writes the gameplay database (`InterfaceModes` etc.).
  Registering a hotkey therefore needs a *shell*-scope UpdateDatabase.

**Scopes:** `scope="shell"` = main menu / options / create-game screens;
`scope="game"` = in-game HUD. A script that should exist in both places (options
registration, settings) must be listed in **both** a shell-scope and a game-scope
ActionGroup — every options-bearing mod surveyed does exactly that.

**LoadOrder is the compatibility contract.** Base UI defines components; mods that
decorate/patch must load after them, and mods that patch *other mods* must load after
those. Observed conventions: mods exposing an API to others use a low value
(Policy Yield Previews: 500, documented so consumers pick >500); ordinary
decorators use 1000–10000; aggressive whole-screen replacers use 100000. A
`<References>` entry on another mod (e.g. City Hall references JNR's lens mod)
declares soft ordering without a hard dependency.

**fs:// paths.** Your mod's files are addressable at
`fs://game/<mod-id>/<relative-path>` — this is the canonical form for
`Controls.define` content/styles, `Controls.loadStyle`, and cross-file imports
(`import { x } from 'fs://game/drongos-top-panel/ui/settings/settings.js'`).
Root-absolute imports **without** the `fs://` prefix also work —
`import { x } from '/drongos-wonder-screen/code/model.js'` — and `UIScripts`
registration alone makes a module resolvable this way (no `ImportFiles` entry
needed; Drongo's colour booster has zero ImportFiles yet its scripts import each
other). Note the path segment is the **`<Mod id>`, not the folder name** — they can
differ (sloth-global-relations-panel's folder is `global-relations-panel`).
**✅ An `<img src="fs://game/<mod-id>/path/file.png">` in markup you inject RENDERS** — verified
in-game 2026-08-06 with a 512×512 transparent PNG in a mod's own dashboard header, given an
`ImportFiles` row for that file. Worth stating because there was no precedent to copy: the base
game's UI contains exactly ONE `<img src="fs://…">` and it names a built-in asset by bare name
(`fs://game/popup_icon_glow`), while mods' own PNG references are typically icon-definition
`<Path>` rows rather than img tags. **No extensionless twin is needed for this** — that trick is
for the unit-icon/`UpdateIcons` route. This matters because it is the practical way to ship
artwork that inline SVG cannot reproduce: **the base UI uses no SVG gradients or filters
anywhere** (the only matches in `Base/modules` are element names inside the Solid.js vendor
bundle), so any emblem whose depth comes from `linearGradient`/`radialGradient`/`feGaussianBlur`
should be rendered to PNG and imported rather than inlined.

ImportFiles-mounted assets are also reachable at the VFS root (`fs://game/logo.png`)
and, when shadowing, under the base module's path. (⚠ Unverified anomaly, litmus
pending: two shipping mods address their own ImportFiles-mounted files under a
*foreign* module prefix — `fs://game/base-standard/ui/<their-file>` — and appear to
work, suggesting the module segment is not authoritative for mounted files. Don't
rely on it either way yet.) In JS `import` statements, base
modules are absolute-rooted: `'/core/ui/...'`, `'/base-standard/ui/...'`. When a
shadow-replaced file uses *relative* imports, they resolve into YOUR mod's overlay —
which is why replacement mods dual-list helper JS in both `UIScripts` and
`ImportFiles` (the copy must exist at the relative path the replaced file expects).
⚠ Never ship an unmodified base file just to satisfy such an import: it freezes that
whole file at the current patch (Drongo's leader ribbons shipped a verbatim
`model-diplo-ribbon.js` that silently pinned 50 KB of base logic two patches back).

UI-only mods set `<AffectsSavedGames>0</AffectsSavedGames>` so they can be
added/removed mid-campaign. `<EnabledByDefault>1</EnabledByDefault>` and
`<ShowInBrowser>1</ShowInBrowser>` are common. `<SpecialThanks>` and `<LastUpdated>`
are surfaced by mod-manager UI mods.

## The three patch techniques

Ranked from most to least compatible. Use the highest one that can do the job.

### 1. `Controls.decorate` — the official augmentation hook

The engine exposes a decorator registry keyed by component tag name. A decorator
class receives the live component instance and gets lifecycle callbacks:

```js
export class MyDecorator {
    constructor(component) {
        this.component = component;       // component.Root = its DOM root
    }
    beforeAttach() { }
    afterAttach() {
        // add buttons, listeners, DOM — the component is in the document now
    }
    beforeDetach() { }
    afterDetach() { }                     // remove window listeners here
}
Controls.decorate('panel-sub-system-dock', (c) => new MyDecorator(c));
```

All four methods must exist (even empty); a fifth, `onAttributeChanged(name, prev,
next)`, is optional and fires on observed-attribute changes (used by Drongo's mod
manager). Decorators from multiple mods coexist on the same component — this is why
it's the preferred technique. Useful decoration
targets seen in the wild:

- `'panel-sub-system-dock'` — the right-side HUD dock. The component has a real API:
  `panel.addButton({ tooltip, modifierClass, callback, class, audio, focusedAudio })`.
  This is THE way to give a custom screen an entry point.
  ⚠ `addButton` ALWAYS appends at the row's end — it takes NO position field (an `index`
  property in buttonData is silently ignored). To insert at a position, use the panel's
  other method `addRingButton(buttonData, index)` (index = second PARAMETER): it wraps the
  button in an `fxs-ring-meter` + inserts before `buttonContainer.childNodes[index]`, and
  is what the base uses for the big-tier age/tech/culture rings (row order: age 0, tech 1,
  culture 2 — so index 3 = "right after the civic ring", big-tier sized via a big
  modifierClass like `civic`). Its return is `{button, ring, turnCounter}`; the
  turn-counter chip renders (empty) under a custom ring too. (Proven in-game, E&I 2026-08.)
- `'panel-mini-map'` — `component.miniMapButtonRow.appendChild(...)` to add minimap
  buttons.
- `'lens-panel'` — `component.createLayerCheckbox("LOC_MY_LAYER", "my-layer-id")` to
  add a lens-layer toggle to the minimap's lens panel, and
  `component.createLensButton("LOC_MY_LENS", "my-lens-id", "lens-group")` to register
  a whole custom **lens** as a radio button mutually exclusive with the base lenses
  (base API, `panel-mini-map.js` — how discovery-lens and Drongo's adjacency lens
  surface theirs; the base game registers ~11 lenses this way, not the 3 this doc
  previously implied).
- `'screen-options'` / options screens — see mod options below.

### 2. Prototype / instance monkey-patching

For changing *existing behavior* rather than adding alongside it. Grab the class via
the component registry, keep the original method, delegate:

```js
const def = Controls.getDefinition('yield-bar-entry');
const proto = def.createInstance.prototype;
const orig = proto.updateValueText;
proto.updateValueText = function (...args) {
    if (myCase(this)) { /* custom */ return; }
    orig.apply(this, args);
};
```

Variants observed working:
- **Singleton patch** — managers exported as instances are patched directly:
  `HotkeyManager.handleInput = function(...) {...}` (keep+call the original). The
  sturdier form goes through the prototype — `Object.getPrototypeOf(ExportedInstance)`
  — so the patch survives instance re-creation (izica patches `DiploRibbonData` this
  way, then calls `DiploRibbonData.updateAll()` to force a re-render).
- **Exported-class patch** — when a base module exports its class, import it and
  patch the prototype directly, no registry needed:
  `import { PanelYieldBanner } from '/base-standard/ui/diplo-ribbon/panel-yield-banner.js';
  PanelYieldBanner.prototype.render = function(){...}` (Drongo's top panel, ETFI).
- **Prototype-from-a-live-instance (the beezany composite)** — inside a
  `Controls.decorate` decorator, `Object.getPrototypeOf(component)` reaches classes
  with no registry entry and no export. Three required pieces: a `static` field as a
  patch-once guard (decorators run per instance), a back-reference
  (`component.bzComponent = this`) so the patched base method can call decorator
  state, and `after_rv ?? orig_rv` return chaining. Gives real "afterRender" hooks.
- **⚠ Re-bind stale listeners.** Base components often capture
  `this.method.bind(this)` in their constructor — a later prototype patch does NOT
  reach the already-registered bound copy. After patching, re-bind:
  `component.updateXListener = component.update.bind(component)` (bz mods do this in
  three places; forgetting it is a silent no-op patch).
- **Template replacement from a decorator** — `component.getContent = () => newHtml`
  replaces a base screen's entire markup with no file shadowing (Drongo's mod
  manager rebuilds the Add-Ons screen this way) — a rung between decorate and
  whole-file replacement.
- **Registered-object patch** — a lens layer already registered can be fetched and
  its methods replaced: `LensManager.layers.get('fxs-worker-yields-layer').updateSpecialistPlot = function (info) {...}` (JNR's whole mod is this one patch).
- **Import the base module first** so the thing you patch is guaranteed registered:
  `import '/base-standard/ui/lenses/layer/worker-yields-layer.js';` before touching
  `LensManager.layers`. Bare side-effect imports pin load order within your script.
- izica's Advanced Yield Bar wraps its patches in a `setTimeout(..., 600)` to dodge
  init-order races — that works but is fragile; prefer `engine.whenReady.then(...)`
  or side-effect imports.

### 3. Whole-file replacement via ImportFiles

Ship a modified copy of a base file at the same relative path. Total control, but:
two mods replacing the same file = last-load-order wins, the other mod breaks
silently; and every game patch that touches the original silently diverges from your
copy. The big UI overhaul mods accept this cost. If you replace a file other mods
commonly patch (production chooser, diplo ribbon…), expect conflict reports.

**A registry alternative to file replacement (legacy stack, verified in
`core/ui/component-support.js` 2026-07-31):** `ComponentManager.define()` — the thing
behind `Controls.define` — keeps whichever registration for a tag name has the
highest `priority` (ties → later registration wins), and only the winner reaches
`customElements.define()`. So a UIScript loaded after core can re-register a base
tag with a modified class via
`Controls.define("some-base-tag", { createInstance: MyPatchedClass, ..., priority: 1 })`
and deterministically own the component — no ImportFiles shadow, no path collision.
Same coexistence caveat as file replacement (you own the whole component; other
mods' decorators still apply, but a second priority-redefiner fights you), and the
same patch-rot risk if you copied the base class. Prefer decorate; use this over
file replacement when you must change a class the registry owns. (This is the
legacy-stack sibling of ui-next's `ComponentRegistry.register` `overridePriority`,
documented in the ui-next section.)

## Custom screens and panels

A new screen is a web component: subclass `Panel`, register with `Controls.define`,
and open it through `ContextManager`.

```js
import Panel from '/core/ui/panel-support.js';
import { MustGetElement } from '/core/ui/utilities/utilities-dom.js';

class MyScreen extends Panel {
    onInitialize() { this.frame = MustGetElement(".my-frame", this.Root); }
    onAttach()     { /* wire buttons: el.addEventListener("action-activate", fn) */ }
    onDetach()     { /* unhook */ }
    onReceiveFocus() { super.onReceiveFocus(); /* NavTray setup */ }
}

Controls.define('screen-my-mod', {
    createInstance: MyScreen,
    description: 'My screen.',
    styles:  ['fs://game/<mod-id>/ui/my-screen.css'],
    content: ['fs://game/<mod-id>/ui/my-screen.html'],   // ImportFiles'd template
    attributes: [],
    classNames: ['w-full', 'h-full'],
});
```

Open/close with `ContextManager.push("screen-my-mod", { singleton: true,
createMouseGuard: true })` / `ContextManager.pop(...)`. A toggle checks
`ContextManager.getCurrentTarget()?.tagName == 'SCREEN-MY-MOD'`. Standard supporting
cast: `FocusManager` (focus), `NavTray` (controller hints), `Databind` (list
binding), `InputEngineEventName` + `inputEvent.isCancelInput()` for Esc/B-button
close handling, `fxs-activatable` elements firing `action-activate`, and Tailwind-ish
utility classes (`flex`, `absolute`, `text-xs`…) available throughout. The HTML
template can carry its own `<style>` block — sizes in `rem`.

### CSS gotchas inside the game UI

- **⚠ `display: inline-block` does not flow horizontally** (verified in-game
  2026-07-22): a row of inline-block spans stacked VERTICALLY over their card. The
  base UI is flex everywhere for a reason — build any chip/pill row as
  `display: flex; flex-wrap: wrap` with `flex: none` children.
- **⚠ Appending an in-flow child to a `policy-base-card` stretches the ENTIRE card
  grid** (verified in-game 2026-07-22): every card on the Policies screen ballooned,
  including untouched ones — the grid equalizes card heights. Overlay instead: give
  the card `position: relative` (via a data-attribute selector — class bindings are
  reactive and get wiped, data attributes survive) and absolutely position your
  element inside it (`bottom: 0; left: 0; right: 0; pointer-events: none`) so it
  never participates in layout.
  **1.4.2 corollary — anchor overlays in guaranteed dead space, not presumed dead
  space** (verified in-game 2026-07-28): patch 1.4.2 rewrote the policy screens
  (`policy-card.js`, `policies-and-traditions.js`, `government-overview.js`) as
  compiled SolidJS components with a compact layout whose description text runs to
  the card's bottom edge — a `bottom: 0` overlay that had sat in free space now
  landed ON the text. The patch-proof placement: straddle the card's bottom border
  (`bottom: -0.5rem; z-index` + near-opaque pill background) so the row hangs half
  into the **inter-card margin** — space the layout guarantees empty no matter how
  the card interior is re-cut. General laws: (a) base screens keep migrating to
  compiled Solid components patch by patch — selectors often survive these rewrites
  while interior GEOMETRY does not, so re-verify overlay placement (not just
  selector existence) after every patch; (b) to find which of your dependency files
  a patch actually touched, check file modification TIMESTAMPS in the install —
  Steam only rewrites changed files, so old dates prove a file is untouched.
- **⚠ `font-style: italic` renders text INVISIBLE** — no error, no fallback, the
  element simply shows nothing. The shipped game fonts have no italic face and the
  engine doesn't synthesize an oblique; the entire base UI (core + base-standard)
  contains zero italic declarations, which is the tell. Verified in-game 2026-07-04
  (three styled-but-empty elements all shared `font-style: italic`; removing it made
  all three appear). De-emphasize with color/opacity/size instead.
- CSS **shorthand properties can be rejected** where the longhand works (reported by
  the Enhanced Town Focus Info changelog for a `text-decoration` shorthand). If a
  rule mysteriously doesn't apply, try the longhand form.
- **Flexbox `margin-left: auto` is silently ignored** (verified in-game 2026-07-04):
  the classic push-to-the-right idiom leaves the element hugging its neighbor. Use an
  explicit spacer element (`<span style="flex:1 1 auto">`) or `justify-content:
  space-between` instead.
- Render `[icon:…]`/`[B]`/`[N]` markup by assigning `el.innerHTML =
  Locale.stylize(locTagOrText)`; `textContent` + `Locale.compose` leaves the tokens
  as literal text. `[STYLE:cls]text[/S]` becomes `<span class="cls">…</span>` and `[N]`
  splits into separate `<p cohinline>` blocks — so a LOC string can carry its own
  styled spans (e.g. a callout chip) that your injected stylesheet then paints.
- **`content: attr(data-x)` is NOT resolved** (renders nothing). Static
  `content:"…"` works fine, so for per-item text bake one rule per item
  (`.tag-A::after{content:"A text"}`) and toggle the class — don't rely on `attr()`.
- **CSS unicode escapes in `content` don't parse** (`content:"\2713"` shows literal
  `13`, not ✓). Put the literal character in the string instead.
- **Injected `<style>` class rules DO apply** (including `background`/`border` on a
  `::after`), but only with LITERAL colours — Coherent ignores `var()`. `getComputedStyle`
  is unreliable here (reports the rule as absent even when it renders), so verify visually,
  not by reading computed style.

### Custom art on a dock button

`addButton({ modifierClass })` reuses a base icon (the modifierClass keys a
`.ssb__button-icon.<class> { background-image: url("blp:…") }` rule) — so two mods
picking the same modifierClass get identical twin buttons. To ship your own art:
keep the modifierClass (it provides sizing/ring behavior), `ImportFiles` a
transparent PNG, and override with higher specificity keyed on the `class` you
passed to `addButton`:

```css
.ssb__button.tut-my-mod .ssb__button-icon {
    background-image: url("fs://game/<mod-id>/ui/icons/my-icon.png");
    background-size: contain; background-repeat: no-repeat; background-position: center;
}
```

Load it at decorate time with `Controls.loadStyle(...)` (the panel's
`Controls.define` styles only load with the panel). Leave ~15% transparent margin in
the PNG or the art pokes outside the circular button frame.

### Durable overlays on progression-tree cards (badges, pills, tints)

The culture/tech tree re-renders its cards (`tree-card-v2[type]`) on any redraw, and
**the engine's reconciliation deletes any child element you inject** — so an appended
`<div>` badge vanishes. Two things survive: **inline style changes on existing
elements**, and **CSS pseudo-elements** (they're not DOM nodes). So to add a badge/pill
to a card: inject a stylesheet with a `::after` rule (static `content:"…"`, literal
colours) and *toggle a class* on the card's own bar element from a decorator. Drive it
from a rAF poll in a `Controls.decorate('screen-culture-tree', …)` component; identify
your nodes by `GameInfo.ProgressionTreeNodes.lookup(Number(el.getAttribute('type')))`.
For a two-state pill (e.g. available vs earned) just swap between two classes.

- **Node icons** are the node row's `IconString`, resolved live by the UI from the icon
  DB — so changing it shows on an existing save after a restart (no new game needed;
  it's display metadata, not baked gameplay state). Reusing the base game's own generic
  civic glyphs (`cult_*`, distinct per Age — Antiquity `cult_commerce/literacy/…`,
  Exploration `cult_economics/mercantilism/…`, Modern `cult_capitalism/militarism/…`)
  gives native-quality, theme-matched icons for a custom tree with zero art. (Hand-authored
  SVG can't match the game's 3D-rendered raster icons; base-icon reuse or `blp:` is the way
  to that fidelity. `background-image: url(<svg>)` doesn't render in Coherent anyway — only
  inline `<svg>` elements do. To ship a *bespoke* raster icon (`IconDefinition` `Path` → an
  imported PNG), author it as SVG and **rasterize to PNG via a headless browser canvas** —
  `new Image()` from a data-URI SVG → `drawImage` to `<canvas>` → `toDataURL("image/png")` →
  `fetch`-POST the base64 to a small CORS server that writes it to disk. Recipe detail in
  `custom-pantheons.md` (works for any custom raster icon, not just pantheons).)
- A node's **hover tooltip carries no node id**; link it to its node by finding the card
  that currently has a `hover` class and reading that card's `type`.

## ⭐ Reuse the game's parts, don't imitate them

**The law (learned expensively, 2026-08-17): if the shipping UI already draws the thing you want, find
that element or class and instantiate it. Hand-written HTML/CSS that imitates the game's look needs
endless restyling, hits the engine's CSS subset, and still reads as a mod bolted on.** Before writing a
panel, grep `Base/modules` for a component that already does the job — most of them are driven purely by
`data-*` attributes, so `document.createElement` + `setAttribute` is the whole integration.

### `production-chooser-item` — the real production row, free

`base-standard/ui-next/components/production-chooser-item.js`. A `defineLegacyComponent` element whose
entire input is `data-*` attributes. Creating one gets you the 64px icon, uppercase title, ageless pill,
base-yield icons, turn cost with the timer glyph, hover/focus/select chrome, audio, **and the full
production tooltip on hover** — none of which you write.

```js
import '/base-standard/ui-next/components/production-chooser-item.js';
const el = document.createElement('production-chooser-item');
el.setAttribute('data-name', def.Name);                 // LOC key; composed for you
el.setAttribute('data-type', def.ConstructibleType);    // drives the icon AND the tooltip
el.setAttribute('data-category', 'buildings');          // buildings|units|projects|wonders
el.setAttribute('data-is-purchase', 'false');
el.setAttribute('data-cost', String(turns));            // ⚠ TURNS when not a purchase, GOLD when it is
el.setAttribute('data-is-ageless', ageless ? 'true' : 'false');
el.setAttribute('data-info-display-type', 'base-yield');
el.setAttribute('data-base-yields', JSON.stringify([{ yieldType, value }]));
```

The authoritative attribute mapping is `updateProductionChooserItemElement` in
`base-standard/ui/production-chooser/panel-production-chooser.js` — copy from there, not from guesswork.
Turns come from `city.BuildQueue.getTurnsLeft(type)`.

- **Activation event is `chooser-item-selected`** (`ChooserItemSelectedEventName`, defined in
  `core/ui/components/fxs-chooser-item.js`), and it **bubbles** — put one listener on the list container
  and read `ev.target.closest('[data-your-key]')` rather than wiring every row.
- ⚠ **Selected state is internal to `ChooserItem` and is NOT exposed as a data attribute.** You cannot
  push a row into the selected look from outside. Either let one click be the commit (which is what the
  production menu itself does) or track selection yourself in a separate element.

### Frames, buttons, and the rest of the vocabulary

- **`fxs-frame`** (`core/ui/components/fxs-frame.js`) is the ornate bordered box. `frame-style` =
  `f1` (default, filigree) / `f2` / `simple`; `no-filigree="true"`, `filigree-class` (default `mt-8`),
  `top-border-style` = `b1`/`b2`. Children are redirected into its content div automatically.
- **`fxs-button`** takes `caption`, `disabled`, `action-key`, and emits `action-activate`. Siblings:
  `fxs-hero-button`, `fxs-icon-button`, `fxs-text-button`, `fxs-close-button`, `fxs-minimize-button`.
- `img-tooltip-bg` + `img-tooltip-border` is the *small contextual card* chrome — correct for a tooltip,
  too flat when the ask is "a real popup with a box".

### Sprite grids: the two-part map vocabulary

Map chips are **circles** (slots) and **houses** (yields), and they are drawn by different calls. Text
may go inside a circle; **an icon never does** — cramming a yield glyph into a pip is what makes chips
look like they are colliding.

Do not hand-roll a grid. Instantiate the game's own visualizer, which keeps **two** grids (background
art, foreground glyphs) so a chip's parts layer instead of fighting:

```js
import { YieldChangeVisualizer } from '/base-standard/ui/lenses/layer/yield-change-visualizer.js';
const vis = new YieldChangeVisualizer('MyMod_Chips');   // creates MyMod_Chips_Background/_Foreground
vis.setVisible(true);
vis.addSprite(loc, 'specialist_tile_pip_full', {x,y,z}, {scale});
vis.addText(loc, '5', {x,y,z}, { fonts:['TitleFont'], fontSize:5, faceCamera:true });
vis.addYieldChange({ yieldType, yieldDelta }, loc, {x,y}, 4294967295, {x:0,y:-10,z:0});
vis.clear();   // clears both grids
```

**Never invent offsets or scales.** The constants are in
`base-standard/ui/lenses/layer/worker-yields-layer.js` and `…/yield-change-visualizer.js`:

| Constant | Value | What it governs |
|---|---|---|
| `SPECIALIST_PIP_X_OFFSET` | **15** | horizontal pip spacing (a guessed 26 spills off the hex) |
| `SPECIALIST_PIP_Y_INITIAL_OFFSET` / `_Y_OFFSET` | 12 / 18 | first row height, row pitch |
| `SPECIALIST_PIP_WRAP_AT` | 6 | pips per row before wrapping |
| `SPECIALIST_PIP_SHRINK_COUNT` / `_SCALE` | 4 / 0.7 | shrink once `maxIndex >= 4` |
| `ICON_Z_OFFSET` | 5 | z for pips and text |
| `YIELD_CHANGE_OFFSET` | `{0,-10,0}` | yield houses sit BELOW the pips |
| `yieldSpritePadding` | 11 | horizontal spacing of yield houses |
| `PILL_SCALE` / **`ICON_SCALE`** | 0.9 / **0.35** | ⚠ a yield glyph is drawn at **0.35** |
| `BASE_TEXT_PARAMS` | `fontSize:4, stroke:0` | text over art carries **no** stroke |

Copy `getSpecialistPipOffsetsAndScale(index, maxIndex)` from the base layer rather than reimplementing
the wrap/shrink maths. Textures: `specialist_tile_pip_full` / `_empty` / `_bad`,
`yield_arrow_positive` / `_negative`. Concise Specialists Lens (workshop 3506915277) is the reference
mod for this idiom — it monkeypatches `updateSpecialistPlot` and reuses every base constant.

### Icons

`UI.getIconCSS(type[, context])` for a CSS `url(...)`, `UI.getIconBLP(type)` for a sprite-grid asset
name. Yields have intensity variants `${YieldType}_1` … `_5`. Prefer **yield** icons over building
portraits in small UI — the painted portraits are too dark to read at chip and row size.

### Attaching to existing panels

`Controls.decorate('panel-mini-map', (c) => new MyDecorator(c))` then, in `beforeAttach()`,
`this.component.miniMapButtonRow.appendChild(btn)` puts a control among the map tools (the Detailed Map
Tacks pattern, workshop 3507297712). Two things silently break this:

- ⛔ **The UIScripts action group must have NO `LoadOrder`.** A late `LoadOrder` (e.g. 1800) registers
  the decorator after the panel already attached, and the button never appears. Map Tacks' UI group
  carries no LoadOrder at all — split UI into its own group and leave it unordered.
- Use the game's button art (`fs://game/hud_mini_lens_btn.png` at `2.6666666667rem`, background inset
  negative). A hand-drawn CSS circle renders as an unreadable speck. `pointer-events:auto` is required;
  the row does not grant it.

## Lenses and lens layers

`LensManager` (`'/core/ui/lenses/lens-manager.js'`) governs map lenses.

- **A lens** = named sets of layers: `{ activeLayers: Set, allowedLayers: Set }`,
  registered `LensManager.registerLens('my-lens', instance)`. Base layer names you'll
  compose: `fxs-hexgrid-layer`, `fxs-resource-layer`, `fxs-yields-layer`,
  `fxs-city-borders-layer`, `fxs-culture-borders-layer`. Base lenses:
  `fxs-default-lens`, `fxs-settler-lens`, `fxs-building-placement-lens`.
- **A layer** = an object with `initLayer()`, `applyLayer()`, `removeLayer()`,
  registered `LensManager.registerLensLayer('my-layer', instance)`.
- Add your layer to an existing lens:
  `LensManager.lenses.get("fxs-default-lens").allowedLayers.add("my-layer")`.
- Runtime control: `LensManager.setActiveLens(id)`, `toggleLayer(id)`,
  `enableLayer(id)`, `isLayerEnabled(id)`; react to lens switches via the
  `LensActivationEventName` window event (`event.detail.activeLens`), and to layer
  hotkeys via the `'layer-hotkey'` window event.
- Surface a checkbox for the layer with the `'lens-panel'` decorator (above).

Drawing on the map from a layer:

- **3D sprites/text at plots** — `this.yieldVisualizer.addSprite(location, textureName,
  offsets, {scale})`, `.addText(location, str, offsets, {fonts:["TitleFont"], fontSize,
  faceCamera:true})`, `.addYieldChange(...)` (see the worker-yields layer).
- **VFX at plots** — `const grp = WorldUI.createModelGroup("MyGroup");
  grp.addVFXAtPlot("VFX_3dUI_Tut_SelectThis_01", plotCoord, {x:0,y:0,z:0});
  grp.clear()`. ⭐ Far more capable than it looks — see the next section.
- **Flat colored plot fills / edges** — `WorldUI.createOverlayGroup` + `addPlotOverlay`
  (see [Colors](#colors-leaders-player-color-css-plot-tinting-tree-icons) for the full
  recipe — this is how ACB-style "tint tiles by yield/type" lenses are drawn).
- Plot coordinates from an index: `GameplayMap.getLocationFromIndex(plotIndex)`.

## ⭐ Lighting tiles: `addVFXAtPlot` is tintable, and there is a whole palette (2026-08-21)

A real 3D light on the terrain, not a colour wash over it — this is what a flat
`addPlotOverlay` fill cannot do. **Verified by reading base UI + a shipping mod, not yet
written by us.**

```js
const grp = WorldUI.createModelGroup("MyGroup");
grp.addVFXAtPlot(
  "VFX_3dUI_Hex_Highlight_01",
  plotIndexOrCoord,                       // BOTH forms work - base passes an index, mods pass {x,y}
  { x: 0, y: 0, z: 0 },                   // offset
  { angle: 0, constants: { Color3: [1, 0.992, 0.62], Alpha1: 1 } }
);
grp.clear();                              // the only teardown
```

**The 4th argument is the whole story.** `interface-mode-place-building.js:151` glows Unique
Quarter candidate plots with exactly the call above, so:

- `constants.Color3: [r,g,b]` — **the glow takes a colour**, as linear floats, not sRGB.
  ⚠ Do not paste a hex value's `/255` channels in and expect a match.
  `constants.Alpha1`, and `constants.tintColor1` on some effects
  (`support-unit-map-decoration.js:510`).
- `angle`, and `placement: PlacementMode.FIXED | TERRAIN` — governs how the effect sits on
  the ground. The tutorial passes `TERRAIN` (`tutorial-manager.js:2209`); several mods omit it.
- Effect-specific constants: `{ turn, scale }`, `{ start, end, height }`.

**The plot VFX that exist in base UI** (all base assets — no art to ship):

| name | what it is | used by |
|---|---|---|
| `VFX_3dUI_Hex_Highlight_01` | generic tintable hex glow — **the general-purpose one** | Unique Quarter plots during placement |
| `VFX_3dUI_Tut_SelectThis_01` | "click here" beam | tutorial |
| `VFX_3dUI_Unit_Selected_01` | selected-unit ring | unit selection |
| `VFX_3dUI_PlotCursor_01` / `_City_Picker` / `_Free` | hover cursors | acquire-tile, place-building |
| `VFX_3dUI_TurnCount_01` | ⭐ **renders a turn NUMBER on the tile** (`constants:{turn, scale}`) | reinforcement + unit paths |
| `VFX_3dUI_MovePip_01`, `_Movement_Marker_Start_01`, `_Reinforcement_Arrow`, `_TradeRoute_01` | path furniture (`start`/`end`/`Color3`) | movement, trade |
| `VFX_District_Added_To_Map`, `VFX_UnitSelection_Ground_Burst_01` | one-shot bursts | placement feedback |

⭐ **Stacking reads as "lit" rather than "tinted".** Detailed Map Tacks puts *two* effects on
one plot — `Tut_SelectThis_01` (beam) + `Unit_Selected_01` (ring).

### The pattern worth stealing: glow a tile when its plan becomes relevant

`dmt-map-tack-layer.js` (Detailed Map Tacks, ~60 lines) is the clearest example of a mod
reminding the player of its own data at the moment the base UI asks for a decision:

1. a **lens layer** owns the model group and listens on `LensActivationEventName`;
2. when the active lens becomes **`fxs-building-placement-lens`** — the build queue's
   "choose a tile" step — it reads
   **`BuildingPlacementManager.currentConstructible.ConstructibleType`**;
3. it glows only the tiles its own store has marked for **that same constructible type**;
4. `modelGroup.clear()` on any lens change.

It does the same for city-centre plans under `fxs-settler-lens`. The type match is what makes
it read as *your plan*, not decoration. ⛔ Read your **own** store, never another mod's.

## Icons: getting the game's own art into a mod's UI (2026-08-22)

⛔ **Do not draw a lookalike and do not use a text glyph.** A drawn `✕` does not even render in the
game's font, and a text `◉` reads as a low-res circle. Every mark below is a real asset the base UI
itself uses, so a mod's controls look native and stay correct across patches.

```js
import { Icon } from '/core/ui/utilities/utilities-image.js';
```

| what | call | notes |
|---|---|---|
| **Civilization symbol** | `Icon.getCivSymbolCSSFromCivilizationType(player.civilizationType)` | returns a ready `url(...)` for `background-image`. Also `getCivSymbolCSSFromPlayer(componentID)` and `getCivSymbolFromCivilizationType()` for the bare URL. What city banners, the diplo ribbon and age-scores all use. Unknown civ → `fs://game/civ_sym_unknown.png`. |
| **Yield icon** | `UI.getIconCSS(yieldType, 'YIELD')` | ✅ the route that answers in practice. Fallbacks worth keeping in order: `UI.getIconCSS(type)`, `UI.getIconURL(type,'YIELD')`, `UI.getIconBLP(type)`. |
| **Constructible icon** | `Icon.getConstructibleIconFromDefinition(def)` | takes the `GameInfo.Constructibles` row, not the type string. |

**Direct art paths that already exist** — `fs://game/<name>.png`, or `blp:<name>`:

| purpose | asset |
|---|---|
| look at / locate a tile | `action_lookout.png` |
| remove from a queue | `city_queue_trash.png` |
| reorder in a queue | `city_queue_up.png` (rotate 180° for "down", as the base build queue does) |
| close | `hud_closebutton.png` (`_hover`, `_pressed` variants) |
| delete / minus | `blp:icon_delete`, `blp:icon_minus` |

### ⛔ TINTING art: two different mechanisms, and picking the wrong one fails SILENTLY

| art | how it is coloured | example |
|---|---|---|
| **civ symbol** (`Icon.getCivSymbolCSS*`) | `filter: fxs-color-tint(<colour>)` | `panel-diplo-ribbon.css:430` — `.diplo-ribbon__symbol { filter: fxs-color-tint(var(--player-color-secondary)); }` |
| **hex plates / panel art** (`bg_hex-icon.png`, banners) | `fxs-background-image-tint: <colour>` | `.diplo-ribbon__portrait-bg`, declared in the SAME rule as its `background-image` |

⚠⚠ The civ symbol art is a **white mask**. Untinted it is invisible on any light surface, and using
`fxs-background-image-tint` on it does nothing at all — no error, no log line, just white. Cost three
rounds of guessing before reading the source.
⚠ When you do use `fxs-background-image-tint`, declare it **beside** the `background-image` it tints;
tinting from a stylesheet an image assigned inline did not take.

⚠ Icon paths are **NOT derivable from the type name**. `BUILDING_LIBRARY` is `blp:buildicon_library`,
but the pattern is not guaranteed — READ the `IconDefinitions` row rather than composing the string.

⚠ Set them with `el.style.backgroundImage = css` plus
`background-size:contain; background-repeat:no-repeat; background-position:center` in your stylesheet.

## Interface modes and views

For UI states that own the whole interaction (placement cursors, choosers):

> ⭐ **"Let the player click a tile" is a solved, VERIFIED-IN-GAME pattern (2026-08-15) — you do not
> need to build a picker.** Extend the base class and it does the highlighting and click capture:
> ```js
> import ChoosePlotInterfaceMode from '/base-standard/ui/interface-modes/interface-mode-choose-plot.js';
> import { InterfaceMode } from '/core/ui/interface-modes/interface-modes.js';
> class MyPicker extends ChoosePlotInterfaceMode {
>   initialize() { return true; }
>   selectPlot(plot) { this.commitPlot(plot); InterfaceMode.switchToDefault(); return false; }
>   commitPlot(plot) { /* plot.x, plot.y = the tile the player clicked */ }
> }
> InterfaceMode.addHandler("MYMOD_INTERFACEMODE_PICK", new MyPicker());
> ```
> Pair it with `<InterfaceModes><Row InterfaceModeType="MYMOD_INTERFACEMODE_PICK" ViewName="Placement"/></InterfaceModes>`
> — reusing the base **"Placement"** view means you can skip `ViewManager.addHandler` and the harness
> template entirely. ⚠ **Both halves are required**; the row alone or the handler alone silently does
> nothing. Enter it from a hotkey by wrapping `HotkeyManager.handleInput` (an exported singleton) and
> calling `InterfaceMode.switchTo(...)`. Verified end to end: hotkey → mode → click → a building placed
> on the clicked tile with no unit involved. Shipping precedent: *Detailed Map Tacks* (1295660/3507297712).
>
> ⚠⚠ **BUILD THE EXIT BEFORE THE ENTRANCE.** The `Placement` view **hides the normal HUD**, so a mode
> that can be entered but not left leaves the player on a bare map with no menus (hit in testing).
> Escape does work via the base class, but do not rely on it alone: give the subclass its own
> `handleInput` catching `inputEvent.isCancelInput()` / `"sys-menu"` / `"mousebutton-right"`, exit
> through **one wrapped `leave()` helper** called unconditionally after the commit — so a throw in your
> placement code cannot strand the player — and make the entry hotkey **toggle**. Three escape hatches
> is not excessive for a mode that removes the UI.

1. **Register the mode in the gameplay DB** (game-scope `UpdateDatabase`):
   `<InterfaceModes><Row InterfaceModeType="MYMOD_INTERFACEMODE_X" ViewName="MyView"/></InterfaceModes>`
2. **Add the JS handler**: `InterfaceMode.addHandler('MYMOD_INTERFACEMODE_X', handler)`
   where handler implements `transitionTo(old, new, context)`, `transitionFrom(...)`,
   and `handleInput(inputEvent)` (return `false` + `stopPropagation()` to consume;
   check `inputEvent.detail.status == InputActionStatuses.FINISH`, names like
   `'mousebutton-left'`, `'accept'`, `'sys-menu'`, `inputEvent.isCancelInput()`).
   Switch with `InterfaceMode.switchTo("MYMOD_INTERFACEMODE_X")` / `switchToDefault()`.
3. **Register the view** the mode names: `ViewManager.addHandler(instance)` with
   `getName()`, `getInputContext()` (`InputContext.World`), `getHarnessTemplate()`,
   `enterView()/exitView()`, and `getRules()` — a list of
   `{ name: "unit-flags", type: UISystem.World, visible: "false" }` toggles that
   hide/show HUD systems while the view is active. The harness template is a
   `<template>` of `fxs-slot` regions (top-left, bottom-center, …) appended to
   `document.body`, and is where your custom panels mount.

In `transitionTo`, modes typically also call `LensManager.setActiveLens(...)`,
`WorldUI.setUnitVisibility(false)`, `UI.Player.deselectAllUnits()` /
`deselectAllCities()`.

## Hotkeys

Three pieces, two scopes:

1. **Shell-scope `UpdateDatabase`** with input rows:
   ```xml
   <InputActions>
     <Row ActionId="open-my-panel" DeviceType="Keyboard" Name="LOC_MY_KEY" Description="LOC_MY_KEY"/>
   </InputActions>
   <InputContextConstraints>
     <Row ActionId="open-my-panel" ContextId="World"/>
   </InputContextConstraints>
   <InputActionDefaultGestures>
     <Row ActionId="open-my-panel" Index="0" GestureType="KBMouse" GestureData="KEY_F2"/>
   </InputActionDefaultGestures>
   ```
   `InputContextConstraints` is optional — shipping mods register working hotkeys
   with just `InputActions` + `InputActionDefaultGestures` and gate in JS via
   `InterfaceMode.allowsHotKeys()` instead. Other row facts from shipping mods:
   `<Replace>` works as the row verb, one action can carry several gestures via
   `Index="0"/"1"` (key + numpad twin), modifiers use
   `GestureData="KEY_SHIFT+KEY_B"`, and `ContextId="Dual"` exists alongside
   `World`/`Unit`. Localize the `LOC_*` names in both scopes.
   ⚠ **CORRECTED 2026-07-29 (refined 2026-07-30): these rows do NOT make the binding
   appear in the game's key-binding options screen.** The editor
   (`core/ui/options/editors/editor-keyboard-mapping.js`) builds its row list from a
   hardcoded action set and never reads the `InputActions` table. Fix: decorate the
   editor — `Controls.decorate('editor-keyboard-mapping', ...)` — and add your row in
   the decorator's **`beforeAttach()`**: look up
   `Input.getActionIdByName("my-action-id")`, skip if
   `component.mappingDataMap.has(actionId)`, else
   `component.actionContainer.appendChild(component.createActionEntry(actionId,
   inputContext))`. Ship the decorator in BOTH the shell-scope group (with the input
   rows) and a game-scope group (the options screen opens from both contexts).
   Detailed Map Tacks ships exactly this. (Do not look for an
   `afterAddActionsForContext` hook — that name is bz-map-trix's own private helper
   inside a heavier prototype-patch variant, not a Firaxis API.) Without this, the
   hotkey works but is invisible and un-remappable in options.
2. **Game-scope interception.** Two working styles:
   - Patch `HotkeyManager.handleInput` (keep the original; on
     `InputActionStatuses.FINISH` + your action name, call
     `HotkeyManager.sendHotkeyEvent(name)` — which dispatches a window CustomEvent
     `'hotkey-<name>'` — and return `false`).
   - Or register your own engine input handler:
     `ContextManager.registerEngineInputHandler({ handleInput(inputEvent) {...} })`
     and dispatch the CustomEvent yourself, guarded by
     `InterfaceMode.allowsHotKeys()`.
3. **Listen**: `window.addEventListener('hotkey-open-my-panel', fn)`. For lens-layer
   toggles use `HotkeyManager.sendLayerHotkeyEvent(name)` and listen for
   `'layer-hotkey'` checking `event.detail.name`.

## Mod options and the shared settings store

There is no official mod-settings API, so the community converged on a shared
convention — follow it exactly, because deviating breaks *other* mods:

**The Options "Mods" tab.** Register the category (idempotently — many mods do this)
and your options, in scripts loaded in **both shell and game** scopes:

```js
import '/core/ui/options/screen-options.js';   // ensure options screen loads first
import { CategoryType, Options, OptionType } from '/core/ui/options/model-options.js';
import { CategoryData } from '/core/ui/options/options-helpers.js';

CategoryType["Mods"] = "mods";
CategoryData[CategoryType.Mods] ??= {
    title: "LOC_UI_CONTENT_MGR_SUBTITLE",
    description: "LOC_UI_CONTENT_MGR_SUBTITLE_DESCRIPTION",
};

Options.addInitCallback(() => {
    Options.addOption({
        category: CategoryType.Mods,
        group: "my_mod_group",
        type: OptionType.Checkbox,        // dropdowns etc. also exist
        id: "my-option-id",
        initListener:   (info) => info.currentValue = mySettings.flag,
        updateListener: (_info, value) => mySettings.flag = value,
        label: "LOC_OPTIONS_MY_FLAG",
        description: "LOC_OPTIONS_MY_FLAG_DESCRIPTION",
    });
});
```

**⚠ Registration gotcha:** the stock `Options.addInitCallback` queues your callback
only for the options model's FIRST initialization — a late-loading mod's options
**silently never appear** (re-opening the screen replays only an internal *re-init*
list). The shipped community fix (Enhanced Town Focus Info) patches
`Options.addInitCallback` to push the callback onto BOTH `optionsInitCallbacks` and
`optionsReInitCallbacks` before registering. Verified as the cause of a
"my Options entry doesn't show but other mods' do" bug (2026-07-04).

The options screen renders a **group header from an auto-derived LOC key**:
`LOC_OPTIONS_GROUP_<YOUR_GROUP_ID_UPPERCASED>`. Define that string or players see the
raw key above your options.

**⚠ THE ONE-KEY localStorage RULE.** The engine's `localStorage` bridge is broken for
multiple keys: **if any mod writes a second localStorage key, reading breaks for
EVERY mod.** The convention (documented in Drongo's and beezany's source, enforced by
cleanup code that deletes stray keys): all mods share the single key `"modSettings"`,
holding one JSON object namespaced per mod:

```js
const all = JSON.parse(localStorage.getItem("modSettings") || "{}");
all["my-mod-id"] ??= {};
all["my-mod-id"]["myOption"] = value;
localStorage.setItem("modSettings", JSON.stringify(all));
```

Never `localStorage.setItem("my-own-key", ...)`. (Several mods carry migration code
to remove their own legacy extra keys — that's the scar tissue.)

**The more robust backend** is the engine's user-options store, usable alongside (or
instead of) localStorage:
`UI.setOption("user", "Mod", "my-mod.my-option", value)` +
`Configuration.getUser().saveCheckpoint()`; read with
`UI.getOption("user", "Mod", name)` (returns `null` if unset). City Hall writes both
and prefers `UI.getOption` on read. Game-side gameplay option groups also exist
(`UI.getOption("user", "Gameplay", ...)`).

## Persisting mod data

- **Per-user, global**: the `modSettings` localStorage object or `UI.setOption`
  (above). Survives across games; not tied to a save.
- **Per-game**: the `Catalog` serializer
  (`'/core/ui/utilities/utility-serialize.js'`) — `new Catalog({name: "MYMOD", version: 1})`, then
  `catalog.getObject("MY_ID")` gives an object with `write(key, value)`,
  `read(key)`, `getKeys()`. Detailed Map Tacks stores all tack data this way (JSON
  strings per plot key), reloading it on `Loading.runWhenLoaded(...)`. Deletion
  quirk: write `null` **and** remove the key from the object's `childrenIDs` set.
  ⚠ **Reworked in patch 1.4.2** (`CATALOG_FORMAT_VERSION 3`; official modder note in the
  1.4.2 patch notes) — three rules that break pre-1.4.2 usage:
  1. **Two modes.** Constructor without a player = **world catalog** (local-only,
     read-immediately-after-write still works). Constructor with
     `player: Players.get(GameContext.localPlayerID)` = **player catalog**: writes go
     through a **player operation to the cache**, so a read immediately after a write
     returns the OLD value — wait for the `CatalogItemCommittedEvent` window event
     (match `event.detail.catalogId/objectId/key`) before reading back.
  2. **Player catalogs can only be written on that player's turn** — off-turn writes are
     silently ignored by the app ("not your turn").
  3. **Catalogs are cleared at each Age transition** (current default; Firaxis says a
     future release will make them persist across Ages). Don't treat a catalog as
     cross-Age storage yet.
  Under the hood both modes store hashed key/values in the Tutorial property store
  (`GameTutorial.setProperty` / `player.Tutorial.setProperty`). Reference source:
  `Reference/core/ui/utilities/utility-serialize.ts` in the Dev Tools SDK.
  **The shipping escape hatch (post-1.4.2):** Detailed Map Tacks now VENDORS the
  pre-1.4.2 serializer (a copy of quest-tracker's `SerialBase` built directly on
  `GameTutorial.setProperty`) instead of importing `Catalog` — restoring synchronous
  read-after-write with no turn or Age restrictions. If the new Catalog rules break
  your use case, that's the community answer.
  **The hash scheme is also the cross-mod read channel**: keys are
  `Database.makeHash("_<scope>_<id>_<key>")` with a `"KEYS"` row as the object's
  index (comma-separated key list). Drongo's city planner reads Detailed Map Tacks'
  entire tack store this way — no API, no dependency:
  `GameTutorial.getProperty(hash("DMT_OBJ","MAP_TACK","KEYS"))`, then per-key reads.
- **Per-user, via the save system** (4th backend): Drongo's mod manager stores
  mod-set profiles as `SaveFileTypes.GAME_CONFIGURATION` files
  (`SaveLocations.LOCAL_STORAGE` + `SaveTypes.WORLDBUILDER_MAP`), written with
  `Network.saveGame({...})`, enumerated via `SaveLoadData.querySaveGameList(...)`
  (async — listen for the `'model-save-load-query-done'` window event, read
  `event.detail.fileList`), deleted with `Network.deleteGame`. Save entries even
  expose `enabledMods`. Heavyweight but survives everything and is user-visible.
- UI state that only needs the session: module-level variables.

## The JS game API surface

Read access is broad; **write access to game state goes through operation requests**,
not direct setters. No official docs — but Policy Yield Previews ships TypeScript
ambient declarations (`types/engine.d.ts`, `types/GameInfo.d.ts` — 55KB of API
surface) that double as the best available reference; wire them into a `jsconfig.json`
for IntelliSense while developing.

Frequently used, all confirmed in shipping mods:

- **Players / player**: `Players.get(GameContext.localPlayerID)` (or
  `localObserverID`), `player.Stats.getNetYield(YieldTypes.YIELD_GOLD)`,
  `player.Stats.getYields()` (recursive breakdown tree), `player.Cities.getCities()`,
  `player.Units.getUnits()`, `player.Resources.getResources()`, `player.Culture`,
  `player.Diplomacy`.
- **City**: `city.Workers.getNumWorkers(false)`, `city.urbanPopulation`,
  `city.ruralPopulation`, `city.BuildQueue.getQueue()`,
  `city.Constructibles.getGreatWorkBuildings()`.
- **Static data**: `GameInfo.<Table>` (array-likes mirroring the gameplay DB:
  `GameInfo.Units.lookup(type)`, `GameInfo.Yields[i].YieldType`,
  `GameInfo.ProgressionTreeNodes`, row `$index` gives the hash/index used by APIs).
- **Map**: `GameplayMap.getLocationFromIndex(i)`, plus per-plot query methods.
- **Mutations** (the only way): `Game.PlayerOperations.sendRequest(playerID,
  PlayerOperationTypes.GRANT_TREE_NODE, { ProgressionTreeNodeType: node.$index,
  FullyUnlock: 1 })` — the cheat-panel mods are a catalog of available operations.
- **Text**: `Locale.compose("LOC_KEY", args...)`; text markup understood by UI
  strings: `[icon:YIELD_GOLD]`, `[B]bold[/B]`, `[n]` newline. **Parameterized LOC** uses
  `{1_Name}` placeholders (the suffix after `_` is just a label; positional) — the LOC row
  `"…up to {1_Max} this Age"` filled by `Locale.compose(key, maxValue)`. Pass an already-composed
  string as the arg (not a raw LOC key) to avoid double-resolution.
- **Progression / Triumphs / suzerain reads** (for read-only dashboards):
  - **Tree-node unlocked depth**: `Game.ProgressionTrees.getNode(playerId, nodeHash).depthUnlocked`
    (0 none / 1 base / 2 mastery). Look the node up in `GameInfo.ProgressionTreeNodes`; a node in a
    *hidden* (not-yet-revealed) tree still exists in `GameInfo`, so this returns 0 cleanly pre-reveal.
  - **Legacies / feats live**: `Players.get(pid).Legacies` component + `GameInfo.Legacies` (filter to
    your `LEGACY_*` prefix, scope to `Game.age`). Each row gives `.Name`, `.Description`,
    `.TriggerDescription`; check earned-state with the same helper the base Legacies UI uses. Lets a
    panel show "how to unlock" text (the trigger) and live earned/locked state without hardcoding.
  - **Suzerain city-states**: see [city-states-suzerain.md](city-states-suzerain.md#reading-suzerainties-from-a-ui-mod-js)
    (`Influence.getSuzerain()` + `GameInfo.CityStateTypes.lookup`).
- **Adding a switcher tab to an existing panel**: register the tab id in the panel's `TABS` list,
  add an `<fxs-activatable class="…-tab-<id>">` button in the HTML, and tag each card/row with
  `dataset.system = '<id>'`; the filter that shows `card.dataset.system == activeTab` does the rest.
  A `flex-wrap` filter row absorbs the extra button. Synthetic "cards" (plain objects with
  `{lane, system, nodeName, lines, unlockedDepth, requiredDepth}`) render through the same card
  path as real ones — handy for a bespoke tab (e.g. a per-item "what / how to get / have it?" list).
- **Events**: `engine.whenReady.then(fn)` (script start), `engine.on/off('EventName',
  fn, ctx)` and component-scoped `this.Root.listenForEngineEvent('EventName', fn,
  this)`. Real event names seen: `CityPopulationChanged`,
  `ConstructibleAddedToMap`, `PlayerTurnActivated`, `LocalPlayerTurnEnd`,
  `DiplomacyRelationshipChanged`, `DiplomacyDeclareWar`… Mods can also define their
  own bus events: `engine.trigger("MyCustomEvent")` + `engine.on("MyCustomEvent",...)`.
- `Loading.runWhenLoaded(fn)` — after game load (earlier and more reliable than the
  `'user-interface-loaded-and-ready'` window event, which lags ~1s).

A remarkable existence proof: Policy Yield Previews re-implements the **entire
GameEffects modifier/requirement evaluation pipeline in UI JS** (reads `GameInfo`
modifier tables, resolves collections to subjects, applies effect semantics, renders
predicted yields). If you need to *display* what a Modifier would do, that mod's
`scripts/` tree is the reference implementation.

### The attributed yield tree (`player.Stats.getYields()`)

Returns one recursive breakdown tree per yield (index-aligned with `GameInfo.Yields`)
— the engine's own attribution, exact to the decimal. Node shape: `{ value, type,
id, description?, steps?, base?, modifier? }`. **Walk `steps` plus `base`/`modifier`
only when they are objects** — they can also be plain numbers, and a naive walker
that wraps them silently drops most of the tree. Structure: player total → named
player-level sources (diplomacy actions appear by display name) → per-city subtree →
`From Buildings` (per building) / `From Improvements` (per plot) / deductions
(per-building maintenance, itemized).

**The label lever is the effect's `Tooltip` ARGUMENT** —
`<Argument name="Tooltip">LOC_MY_LABEL</Argument>` on the modifier — NOT the
`<String context="Description">` row. This is how the base game names its yield
contributions (the `Tooltip` argument appears on nearly every yield effect in the
base data: 126 uses on `EFFECT_CITY_ADJUST_YIELD`, 4-of-4 on
`…_YIELD_PER_POPULATION`, 35 on `EFFECT_PLAYER_ADJUST_CONSTRUCTIBLE_YIELD`, …).
Established by in-game experiment (2026-07-04, incl. fresh-game controls):

| Experiment | Result |
|---|---|
| `EFFECT_PLOT_ADJUST_YIELD` **with** a `Tooltip` arg | ✓ labeled leaf per plot (composed text), under "Additions" |
| `EFFECT_CITY_ADJUST_YIELD` **with** a `Tooltip` arg | ✓ labeled leaf (composed text), directly under city Income |
| Same two classes, **no** `Tooltip` | exact anonymous leaf — value right, name gone |
| `EFFECT_PLAYER_ADJUST_CONSTRUCTIBLE_YIELD` with a `Tooltip` arg | ✗ **still anonymous** (exact leaf under its building) — this class's `Tooltip` feeds a different surface; identify structurally or recompute |
| Any class with a `<String context="Description">` added | **still anonymous — `Description` rows do NOT label the tree** (they're for other UI surfaces) |
| warehouse / appeal effects | engine self-labels ("Warehouse Bonus", "Appeal Bonus") regardless |

**Binding timing:** the label text is **snapshotted when the modifier attaches** and
persists in the save — changing a `Tooltip` mid-campaign leaves the old text on
already-attached instances until they re-attach (requirements re-evaluating, or a new
game, which shows the new label from turn 1). Proven by observing a test label survive
its own revert across sessions. Only matters during development; shipped players never
see a label change mid-save.

The leaf `id` field is a runtime registry — **not** a `GameInfo.Modifiers` or
`ModifierStrings` index; don't join on it. To identify labeled leaves, match the
composed text (`Locale.compose` your Tooltip keys and string-compare; the tree stores
composed text, so this stays localization-consistent). For unlabeled contributions,
either match structurally (known position + expected value) or recompute from
`GameInfo.ModifierArguments` (`Amount`/`Percent`) × live state — the tree then serves
as a total-level validation.

`getYields()` only answers for what **already exists**. To predict the yield of a
constructible **not yet built** (planner/overlay mods — Map Tacks, City Planner), you
must re-derive base + adjacency + owned-modifier yields from the data tables and live
map yourself — the full algorithm is in
[yield-preview-engine.md](yield-preview-engine.md).

## ⛔⛔ THE AI NEVER RUNS YOUR UI SCRIPT — so never let data promise what only UI delivers

The architectural law behind a whole class of silent bugs, found 2026-09-13.

`<UIScripts>` run in the **UI isolate, for the local human only**. An AI player never executes a line
of them. That is fine for anything cosmetic — but it is a trap the moment your mod pairs:

- a **data-side cost or entry point** the AI can see and choose (a Project, a Constructible, a
  Tradition), with
- a **UI-side fulfilment** that actually delivers the result (a `CREATE_ELEMENT` call, a panel the
  player interacts with, state kept in a `Catalog` store).

The AI takes the entry point, pays, and gets nothing. No error, nothing in any log, and no player
ever sees it happen — it just quietly degrades every AI in every game.

⚠ **A UI-side filter is NOT a gate.** If your production list hides unavailable items in JS, that rule
exists only for the human. The AI reads the gameplay database directly and sees everything you
declared, unfiltered.

**➡ The rule: anything the AI can choose must be gated IN DATA, or be fully deliverable IN DATA.**
Never rely on a UI filter, and never assume the AI's scoring will decline it for you — that is opaque
logic you do not control and a patch can change. For projects specifically, see
[projects.md](projects.md) — `RequiresUnlock="true"` plus an `EFFECT_CITY_UNLOCK_PROJECT` modifier is
the base game's own shape for "hidden until explicitly granted".

⚠ Related but distinct: `Game.PlayerOperations.sendRequest('CREATE_ELEMENT')` **is** the one proven
UI→data write, so a UI script can make durable gameplay changes — it just cannot make them *for an AI
player*, because nothing triggers it there.

## Cross-mod integration

- **Expose an API**: attach a frozen object to `globalThis`
  (`globalThis.MyModApi = Object.freeze({...})`) from a known-LoadOrder script;
  document that consumers must use a higher LoadOrder. Make every method no-throw
  (return `{ isValid:false, error }` instead).
- **Consume optionally**: `if (globalThis.LfYieldsPreview) { ... }` — no Dependencies
  entry needed; with a hard `<Dependencies>` entry the global is guaranteed present.
- **Detect other mods' components defensively**:
  `LensManager.layers?.has("bz-culture-borders-layer")` and pick base-game
  fallbacks otherwise (Drongo's Adjacency Lens integrates City Hall's layers this
  way without depending on it).

## ui-next: the second UI stack

Newer game versions are migrating screens to **`core/ui-next/`** — a SolidJS-based
component system (`core/vendor/solid-js/`), with `defineLegacyComponent` bridging to
the old registry. Consequences, all observed in current mods:

- Some screens now have **both** implementations (production chooser: old
  `ui/production-chooser/panel-production-chooser.js` *and*
  `ui-next/components/production-chooser-item.js`). Mods that restyle such screens
  must ship **both** the `ui/` and `ui-next/` replacements or the mod only half-works.
- ui-next components are compiled Solid output (`template()`, `createEffect`,
  `insert`) — there's no `Controls.getDefinition` prototype to monkey-patch. **Four**
  patch routes (revised 2026-07-29; this doc previously claimed only the first two):
  1. **File replacement** (invasive, breaks on every game patch — see the staleness
     warning below).
  2. **Portal-observer patch** for anything that renders into a Portal — below.
  3. **`ComponentRegistry.register` — the clean official override.** ui-next
     components live in a registry (`core/ui-next/services/component-registry.js`)
     that takes `{name, createInstance, styles, images, overridePriority}`. Verified
     from the registry source: at equal priority the FIRST registration wins — so a
     UIScript loaded with `loadOrder="-1"` (attribute form, negative values legal)
     registers before the base module's lazy import and owns the component
     (unlock_all_mementos re-registers `memento-select` this way, via UIScripts, NOT
     a file shadow). Cleaner still: pass `overridePriority: 1` and win regardless of
     load order. `ComponentRegistry.get(name)` returns the mutable wrapper (its
     `.factory` can be swapped live). A sibling `ModelRegistry` in the same directory
     has the same `overridePriority` mechanism for models.
  4. **Thin-shell fork + own Solid modules** — replace the base ui-next file with a
     minimal shell and put your additions in hand-written compiled-Solid modules
     loaded as UIScripts, imported by mod-rooted absolute path (bz-map-trix's plot
     tooltip). Keeps the diff-against-base small when the game patches.
     `defineLegacyComponent` also works as a *mod* technique for exposing your own
     Solid component to legacy markup (City Hall's production-chooser item).
- **Portal-observer patch for ui-next tooltips — ✅ VERIFIED IN-GAME 2026-07-26** (worked
  example: wltk's Tech/Civic Progress, Workshop `3770924739`; re-implemented in a standalone
  litmus and confirmed live: the progress/cost pill patch AND an injected content box rendered
  in tech-tree tooltips, the civics tree, the chooser side panel, **and a MODDED custom
  civics tree** — custom trees render the same `tree-card-v2` cards and the same ui-next
  tooltip, so one patch covers base + custom; also proven coexisting with another mod's
  decorator-based chips on the same cards). Bonus pattern proven in the same litmus:
  **relocating an authored element** — a mod's own `[STYLE:]`-styled text span already
  rendered inside the tooltip can be lifted into an injected box (`cloneNode` the text,
  `remove()` the original), consolidating duplicate UI without touching the source mod's
  text pipeline. Bonus engine fact from the litmus:
  **children appended to a ui-next tooltip PERSIST** — the tooltip DOM is REUSED across
  hovers rather than remounted (refined 2026-07-29: Policy Yield Previews tracks which
  node its injection was for — `dataset.lfYieldsForNode` — and re-injects when the
  hovered node changes while the tooltip element survives; so persist ≠ fresh: key your
  injection on the hovered item and refresh it, or you'll show the previous item's
  data). Injected children are not reconciled away the way tree CARDS are (where
  injected children get deleted and only CSS `::after` survives). Placement matters though: append to the tooltip ROOT and the element
  renders as a detached strip below the framed panel; insert BEFORE the cost row to read as a
  native content section. Every ui-next tooltip mounts into the shared
  portal root **`#uinext-tooltips`** via `<Portal mount={tooltipRoot}>` (see
  `core/ui-next/components/tooltip.js`). So instead of replacing the compiled component:
  1. `MutationObserver` on `document.getElementById('uinext-tooltips')` (childList +
     subtree) — **never `document.body`**, which churns on every UI change in the game;
     the portal root only mutates when a tooltip opens/closes.
  2. On each added node, detect your target tooltip by its class
     (e.g. `.tech-civic-tooltip`) and patch its DOM/`innerHTML` post-mount
     (`Locale.stylize` for icon markup).
  3. Recover the *trigger context* (which card/item the tooltip is for) via native
     `:hover` selectors at patch time: `document.querySelector('tree-card-v2:hover')`,
     `'.tech-item[node-id]:hover'`. ⚠ ChooserItem's activatable root renders as a plain
     `<div>` with classes (see `core/ui-next/components/activatable.js`), NOT a custom
     `<fxs-activatable>` tag — select by class/attribute, not tag name.
  4. Pull live values from the JS API as needed (`player.Techs.getNodeCost(nodeId)`,
     `Game.ProgressionTrees.getNode(player.id, nodeId).progress`).
  ⚠ **Placing elements inside the tooltip: NEVER walk parent chains by guess — read the
  component's template from the compiled source and anchor on its real classes.** Proven the
  hard way (two mirrored failures in one litmus): the tooltip's visible panel is drawn by a
  `Tooltip.Frame` CHILD of the `.tech-civic-tooltip` element, so appending to the tooltip root
  lands OUTSIDE the frame (a detached strip below), and climbing "until parent === tooltip"
  overshoots to the Frame itself (a detached strip above). The fix: the compiled component
  (`base-standard/ui-next/tooltips/tech-civic-tooltip.js`) shows the frame's children are
  [header → unlock sections → cost row `.flex.flex-row.flex-wrap`], so anchor above the cost
  row and `insertBefore(box, row)` — inside the frame.
  ⛔ **SELECT THAT ROW DIRECTLY — `tooltip.querySelector('[class*="flex-wrap"][class*="mt-2"]')` —
  NOT via `pill.closest('.flex-wrap')`.** This doc used to say `closest` from the cost pill, and
  that advice shipped a bug: finding the pill first meant locating it by its "Cost" text, so the
  anchor inherited a language dependency and the whole injection vanished outside English (E&I
  v4, 2026-09-06 — see *Never identify game content by its rendered text* below). The row comes
  from a fixed `template()` literal in the compiled Solid source, so it can always be selected on
  its own classes, in any language.
  ⚠ **AND REVISE "absent over detached".** The old rule — *if the anchor is missing, skip the
  insert rather than fall back to the root* — is right about not dangling content off the frame,
  but taken literally it converts a cosmetic miss into a TOTAL, SILENT feature loss, which is
  exactly how the above shipped and got reported as "the mod isn't working". Correct form:
  **try the structural anchor, then a fallback anchor, then append to the frame — and log which
  one you used.** A box in a slightly wrong place is a bug report; no box at all reads as a
  broken mod. (Spacing note: the LAST unlock section has no bottom margin — the game
  spaces via the cost row's top margin, so give injected rows their gap on TOP.)
  The same mod's legacy-stack half is a standard `Controls.decorate` on the tree detail
  panel, with two MutationObservers (attribute filter `['progress','level',...]` on the
  component root + childList on its cost container) **plus one immediate run in
  `afterAttach()`** — the pill was built before the observers started, a general
  decorate-timing gotcha. Together = the pattern for a screen straddling both stacks:
  decorate the legacy half, portal-observe the Solid half.
- Some services moved (e.g. `FocusManager` now at
  `'/core/ui-next/services/focus-manager.js'`). **Patches move import paths between
  game versions and silently break mods** — a moved options-screen module is a known
  cause of "my mod's options tab stopped appearing after the patch." Re-verify import
  paths against the installed `Base/modules/core/` after every game update.

## ⛔⛔ Never identify game content by its rendered text (shipped-bug law, 2026-09-06)

**The game owns every string a player reads. A mod that reads one back to work out *what* it is
has hardcoded a language.** This shipped in Eureka & Inspiration v3 and made its entire tech-tree
overlay invisible in every language except English — silently, no log line, no error.

**The diagnostic signature, and it is unmistakable once you know it:** the parts of the mod that
resolve content by **hash or attribute keep working**, while the parts that resolve it by **text
go dark**. In E&I the bulb badges on the tree cards rendered perfectly while the tooltip box and
the progress pill were absent. That asymmetry looks *selective*, which is why it was reported as
a mod conflict and cost two wrong diagnoses (Solid DOM-reuse, then a specific co-installed mod)
before anyone thought to change the game language. **If a UI mod "works except for one surface",
ask what identifies content on that surface before you look at other mods.**

The two failure modes, both from the same file:

```js
// ⛔ NODE IDENTITY BY HEADER TEXT — hardcoded English name table
const hit = ENI_NAME2NODE[tooltipHeader.textContent.trim().toUpperCase()];  // "VIDA PÚBLICA" → miss
// ⛔ ANCHOR BY AN ENGLISH WORD — LOC_CARD_COST is "Coste:" / "Coût :" / "Kosten:" / "Стоимость:"
if (/^Cost\b/.test(el.textContent)) costEl = el;
```

### The three correct patterns (all proven in shipping mods)

1. **Identity from attributes, via `:hover`.** The Solid tooltip carries no node id, but the card
   that triggered it does. Metropolis Ascendant's `mad-tree-tooltip.js` was immune from the start
   because it never read text:
   ```js
   const card = document.querySelector('tree-card-v2:hover');
   const item = document.querySelector('.tech-item[node-id]:hover, .culture-item[node-id]:hover');
   const type = card?.getAttribute('type');          // hash string → your own type map
   ```
   ⚠ **The attribute differs by surface**: the full trees use `tree-card-v2[type]`, but the
   tech/civic research **choosers use `[node-id]`**. A single `[type]` selector silently misses
   every chooser (and a bare `[type]` also risks matching unrelated elements). Handle both.
2. **Anchors from structure, never from words.** Compiled Solid components build their frames from
   fixed `template()` literals, so their class strings are stable and language-free —
   `tooltip.querySelector('[class*="flex-wrap"][class*="mt-2"]')` for the cost row, or "the last
   `.rounded-full` in the tooltip" for the cost pill itself (MA's `costPillOf`). Read the compiled
   source for the literal; never infer the anchor from what it says.
3. **If you genuinely must match by name, localise BOTH sides.** Some DOM offers no id at all — a
   base `PolicyCard` exposes no `TraditionType` — so name matching is the only route. Then build
   the lookup from the game's own localised strings, never from a literal table:
   ```js
   for (const t of GameInfo.Traditions) map.set(Locale.compose(t.Name).trim().toLowerCase(), t.TraditionType);
   ```
   MA's `mad-card-brand.js` / `mad-card-chips.js` do exactly this and work in every language.

### The deeper lesson — the first fix was not enough

Round one localised the string *matches* (deriving the cost prefix from `Locale.compose('LOC_CARD_COST')`)
and **Spanish still failed**, because the injected box still *depended* on finding that element.
⛔ **It is not enough to translate a string match — take the string OUT of the load-bearing path.**
Ask: if this match returns nothing, does the feature degrade or disappear? If it disappears, the
match is load-bearing and must be replaced by structure, not translated.

### Display names, and where the localised one lives

Never print your own name table for game content. `ProgressionTreeNodes` rows carry
`Name="LOC_CIVIC_MYSTICISM_NAME"` — compose it (this is what the base sub-system dock does):
```js
const info = GameInfo.ProgressionTreeNodes.lookup(Database.makeHash(nodeType));
const label = Locale.compose(info.Name);   // compose returns the KEY UNCHANGED on a miss — test for that
```
Memoise it (called per row / per tooltip), and keep a literal table only as a last-resort fallback.

### English text DOES fall back — verified, so a mod need not ship l10n to function

`Base/Assets/schema/localization/schema-loc-10.sql` defines `EnglishText` as a VIEW that inserts into
`LocalizedText` with `Language='en_US'`, and `LanguagePriorities` gives every shipped language a
**fallback to `en_US` at priority 50** (its own locale is 100). So an English-only mod's strings
render in a Spanish game — nothing is blank. **Missing translations are a polish backlog; text-based
identification is a functional bug.** Do not conflate them.

### ⭐ `tree-card-v2`: one host holds the base node AND its Mastery row

Proven empirically 2026-09-06 after two wrong guesses from the compiled Solid source, both of which
shipped as regressions:

- The host carries the **base node's** `type` attribute.
- The host is **not** itself classed `tree-card--mastery`, so testing the host's classes never
  detects a mastery — a decorator keyed on the card will happily draw the base node's content on a
  Mastery-II tooltip.
- The host **does contain** a `.tree-card--mastery` descendant, so `card.querySelector('.tree-card--mastery')`
  matches EVERY card and suppresses the whole overlay.

⛔ Neither "is the card a mastery?" question has a correct answer, because the card is both.
✅ **Ask about the POINTER instead**: `event.target.closest('.tree-card--mastery')` is true only when
the cursor is genuinely over the mastery row. `closest()` includes the element itself.

⚠ Beware stale sibling comments: the same base file describes masteries as "separate tree-card-v2
elements" in one place and says the host "wraps the mastery-II row too" in another. Only the second
matches observed behaviour. **When two comments disagree, instrument the live DOM — do not pick one.**

### Test it



**Switching the game language for two minutes finds this class of bug, and no amount of English
testing ever will.** Add it to the pre-ship pass for any mod that reads the DOM. And when a UI
injection can silently draw nothing, emit one self-limiting log line naming the reason — silence is
what turned a one-line fix into a multi-round investigation.

## Coherent CSS/layout laws (in-game proven 2026-07-26)

Things this engine's renderer eats SILENTLY — no error, just wrong layout:

- **⛔ Name the game's OWN font families — a system font silently falls back.** Coherent ships only
  the faces in `Base/modules/core/fonts`, declared as **`TitleFont`** (display) and **`BodyFont`**
  (text), each with `-SC`/`-TC`/`-JP`/`-KR` locale variants that the UI joins into one stack — see
  `core/ui/themes/default/global-scaling.js`. So `font-family: Georgia, serif` renders as the
  default sans in-game while looking perfect in a desktop-browser preview; write
  `font-family: TitleFont, <system fallback>` instead, putting the system name last purely for
  offline previewing. This bites hardest when styling a wordmark or heading to match external art.
- **⛔ `font-weight` must be 400 or 700 — an intermediate weight renders the text INVISIBLE.**
  Proven in-game 2026-08-06: `font-weight:600` on a section header drew *nothing at all* — the
  text was in the DOM, the element's border and padding rendered, and a `font-weight:400` pill
  inside the same header drew normally, but the label itself was blank. The UI font ships regular
  and bold only and **Coherent does not synthesise the weights between them** — it draws empty
  rather than falling back to the nearest face. `700` and `bold` are safe (shipping UI uses them);
  `500`, `600` and any other numeric weight are not. Carry emphasis with size, colour and
  `text-transform` instead. This one is nastier than a layout bug because the text simply is not
  there — it reads as a data failure, not a styling one, and sends you hunting the wrong thing.
- **⛔ A rejected declaration kills the WHOLE stylesheet, and if that throw sits upstream of your event
  wiring it silently disables the feature.** Proven twice, 2026-08-16: `align-items: baseline` is
  rejected outright by the parser, and because the offending `<style>` append ran *before* handler
  registration, clicks stopped working with no error pointing at CSS. Two rules follow: **register
  behaviour before styling**, each in its own `try`, and set the "already styled" flag *before* the
  append so one failure cannot re-run forever. Same reason `ensure()` must create its root element
  before the stylesheet, never after.
- **⛔ Your class names share one global namespace with the game's utility classes — pick a colliding
  one and the game's rule wins.** A class literally named `hidden` inherited the base `.hidden
  {display:none}` and a third element simply never drew. Prefix every class (`.rings-ch-row`), and never
  use a bare English word that reads like a utility (`hidden`, `active`, `selected`, `open`, `small`).
- **`display: grid` collapses to block.** Grid children stack full-width as if the property
  were never set (proven: a 3-column card grid deployed as stacked rows). Multi-column layouts
  MUST be `flex-wrap` + percentage widths on the items. Flex `column-gap`/`row-gap` ARE safe
  (shipping UI uses them). ⚠ Under re-verification (2026-07-29): three shipping Workshop mods
  (Drongo's mod manager, city planner, cheat panel) use `display: grid` in their markup/CSS —
  either it works in some contexts or their layouts silently degrade; litmus pending. Until
  then, keep using flex-wrap.
- **`color: var(--x)` never paints — but the law is SPECIFIC to `color:` (narrowed
  2026-07-29).** Confirmed working in shipping mods: `background-color: var(--x)` (Drongo's
  top panel themes its whole pill scheme this way, per-class and per-`:hover` overrides of one
  custom property), `var()` in lengths and `calc()` (`width: calc(1.66rem + (var(--n,2) *
  0.54rem))`), and `filter: fxs-color-tint(var(--x))` (base-game idiom, 33 uses in Base CSS).
  For text color specifically: literal colors or inline styles, as before.
- **`filter: fxs-color-tint(<color>)` recolors any element with a `blp:` background** —
  the engine's own CSS recolor function (base uses it in diplo-ribbon, age-scores,
  advisor screens). The full recipe for tinting game art to an arbitrary color:
  `filter: grayscale(1) brightness(1.5) fxs-color-tint(#b5afa9);` (bz-ready-or-not's
  ring meter). Siblings: `fxs-background-image-tint` (set via `style.setProperty`),
  and standard `drop-shadow`/`sepia`/`saturate`/`contrast` filters work — including on
  `html, body` for whole-UI grading (Drongo's colour booster). CSS masks work too:
  `mask-image: url("blp:mask_hex_icon_64px.png")` + `mask-size/position` hex-clips a
  portrait. `@media (experience: mobile)` is a real Coherent media feature.
- **⛔⛔ SIZE EVERY UI IN `rem`, AND ON THE GAME'S FONT LADDER. Two separate bugs, both silent,
  both shipped by us before a player caught them.** Reported 2026-08-09 by an E&I user on a
  high-resolution MacBook: *"the text/UI is so tiny that it's not playable."*

  **(1) `px` does not scale.** `Options → Accessibility → Font Scale` (Extra Small … Extra Large)
  works by writing `html { font-size: <n>px }` — see `core/ui/themes/default/global-scaling.js`,
  where `const BASE_FONT_SIZE = 18` and `newScalePx = globalScale / 100 * BASE_FONT_SIZE`. So
  **`rem` follows the setting and `px` is frozen**, and a high-DPI display raises the same root by
  another route. Base-game CSS is **8,615 `rem` against 161 `px`**; those 161 are hairline borders,
  the one thing that should stay px. E&I shipped **156 px against 4 rem** — exactly inverted,
  including all 22 font sizes. Conversion is `px ÷ 18 = rem`. Reusable converter:
  `mods/eureka-inspiration/tools/px-to-rem.py <ui-folder> [--apply]` (dry-runs by default, keeps
  border/outline widths in px, recurses).

  **(2) Converting faithfully is not enough — the sizes themselves must be on the ladder.**
  `global-scaling.js` defines the only text sizes the game uses:

  | class | px | rem |
  |---|---|---|
  | `font-body-xs` | 14 | 0.7778 |
  | `font-body-sm` | 16 | 0.8889 |
  | **`font-body-base`** | **18** | **1** ← 124 uses, the standard body size |
  | `font-title-lg` | 22 | 1.2222 |
  | `font-title-xl` | 26 | 1.4444 |

  **Nothing in the base game goes below 14px.** E&I had 16 of its 22 font sizes *below* that floor
  (9–13px), so even after a correct px→rem conversion it still rendered at roughly two-thirds of
  base-game text at every scale — a constant ratio the player reads as "the mod ignores my
  accessibility setting." Snap every size to a rung, rounding **up**. Prefer the game's own classes
  (`font-body-base` etc.) over hand-rolled rem where you control the markup.

  **(3) A PERSISTENT panel will not restyle itself when the player changes the setting mid-game.**
  Coherent does **not** recompute `rem` in an already-injected stylesheet when `html { font-size }`
  changes, and the usual `if (document.getElementById('my-style')) return;` guard means the sheet is
  written once and never again. Transient UI (tooltips rebuilt on hover, popups created per event)
  picks the new scale up naturally; a dashboard that stays open keeps the sizes it was born with
  while the whole game rescales around it. The game fires an engine event for exactly this —
  `screen-options.js` and `global-scaling.js` are its only base-game listeners:

  ```js
  engine.on('UIFontScaleChanged', () => {
      document.getElementById('my-style')?.remove();   // drop it...
      injectStyle();                                   // ...and write it again
      render();          // ALSO re-render: inline style="..." attributes are rebuilt only by a
  });                    // render, and a stylesheet refresh cannot reach them
  ```

  Wrap it in try/catch — a context without `engine` should degrade to the old behaviour, not throw.

  **Testing it needs no exotic hardware.** Both the accessibility dropdown and a high-DPI display
  converge on the same single lever: `newScalePx` is set either from `globalScale / 100 *
  BASE_FONT_SIZE` (the dropdown) or from `currentBasis * BASE_FONT_SIZE * autoScaleAdjustment`
  (computed from the screen), and **both feed the one `html { font-size }` rule**. So proving your
  UI follows the dropdown proves it follows the display. Set Font Scale to **Extra Large** and
  compare your text against the base-game label beside it — Extra Small proves nothing, since
  small-and-frozen looks like small-and-scaled. Then change the setting **with your panel open** to
  catch (3). Watch for containers that now clip: fixed heights and `overflow:hidden` with thin
  padding are what break (E&I's progress pill had 1px of vertical padding around text that grew
  from 11px to 14px).

- **`window.innerWidth` / `window.innerHeight` / `getComputedStyle(document.documentElement).fontSize`
  ✅ WORK** — the reliable way to build screen-relative panels: measure at attach, set inline
  pixel sizes, floor/cap in rem so the game's UI-scale setting is respected. Don't gamble on
  `vw/vh` units.
- **⛔ A custom panel's header scrolls away once its content outgrows the frame — and the obvious
  fix causes a worse bug.** `fxs-subsystem-frame` puts your slotted markup in a content area it
  classes `flex-auto` (`flex: 1 1 auto`) with **no `min-height`**, and a flex item with
  `min-height: auto` cannot shrink below its content. So the moment your column is taller than the
  frame, the content area grows past it and the FRAME scrolls, carrying your header and tab bar out
  of view. Your own `flex: 1 1 auto; min-height: 0` on the inner scroll region never gets a chance,
  because the box it should fill was never bounded. **The trap is latent** — a panel ships fine for
  months and breaks on a font-size change, because nothing is wrong until the content grows.

  ⛔⛔ **DO NOT fix it by restyling the frame's content area.** The natural-looking fix

  ```css
  /* ☠ makes the whole panel FLICKER - do not ship this */
  .my-frame .subsystem-frame__content { display: flex; flex-direction: column; min-height: 0; }
  ```

  does cure the scrolling, and it also made Metropolis Ascendant's dashboard flicker so badly it was
  unusable (in-game, 2026-08-09, confirmed by reverting). Forcing that area into flex puts
  `fxs-scrollable` — a custom element that measures itself — into a measure → reflow → re-measure
  loop. **Never change the layout MODE of a base-game element you do not own.**

  The safe direction is to constrain **your own** column instead: measure the non-scrolling parts at
  attach and set an explicit pixel `max-height` on your scroll region, alongside the existing
  measured frame sizing (`getComputedStyle(document.documentElement).fontSize`, see the entry
  below). That changes no layout mode and adds no feedback path. Untested as of writing — the
  flicker fix was to revert, and the scrolling fault is currently open in MA.

- **Auto flex margins (`margin-left: auto` on a flex child) don't push — the child stays in
  place** (proven 2026-08-01: a header close button styled `margin-left:auto` rendered mid-row).
  Push flex children apart with `flex-grow: 1` on the element that should absorb the space
  (base UI's own idiom), or an explicit spacer div.
- **Layout law, not engine-specific but bites here:** a vertically-centered panel sized with
  `max-height` re-centers every time its content length changes (e.g. tab switches with
  different content = the panel visibly hops around the screen). Give it a FIXED `height` and
  a `flex: 1` scrollable interior; short views show open space instead of moving the frame.

## Debugging UI mods

- **Console output**: `console.log/warn/error` from UI scripts lands in the game's
  UI log (`Logs/` next to Modding.log). Errors thrown during a script's module load
  kill that script silently — a mod that "does nothing" often just threw on line 1
  (bad import path is the classic).
- **⛔ ONE MODULE'S SyntaxError SILENTLY DELETES EVERY MODULE THAT IMPORTS IT — and the symptom
  looks like a missing feature, not a crash.** Proven 2026-08-17: a stray duplicated method signature
  in `rings-outer.js` produced `JS Error: … SyntaxError: Unexpected token '{'` plus a `SOURCE ERROR` for
  *both* that file and the file importing it. Nothing else appeared in-game; the visible symptom was
  simply *"there are no buttons"*. **Read `Logs/UI.log` FIRST** — `grep <your-mod-prefix> UI.log` gives
  the file and line in one step, where reasoning from the symptom sends you auditing APIs that were
  never broken.
- **⚠ `node --check yourfile.js` is NOT sufficient to validate a UI script.** It accepted the exact
  file the game rejected: inside a class body a duplicated `method(args) {` line re-parses as a *call
  expression followed by a block*, which is legal JS, so the braces still balance and Node reports OK
  while the class silently swallows everything after it. Copy to `.mjs` and `node --check` for a
  stricter module-goal parse, but treat **UI.log as the only authority** — the game's parser is
  stricter than Node's. Corollary for scripted edits (sed/python replacements): when a replacement
  block re-states a signature, confirm the old one was consumed —
  `grep -n 'methodName(' file.js` should show it once.
- **FireTuner** (Steam → *Sid Meier's Civilization VII SDK*) has a **Scripting
  Console** that evaluates JS against the live game — the fastest way to poke
  `Players.get(...)`, test selectors, or dump state. Input is single-line; wrap
  multi-statement probes in an IIFE one-liner.
- **Reload UI without restarting**: `UI.refreshPlayerColors?.()` aside, the known
  community lever is the cheat-panel "Reload UI" action; with Drongo's Cheat Panel
  installed (F8) you get it as a button. UI scripts re-run on reload — a much faster
  dev loop than relaunching, though `UpdateDatabase`/text changes still need a
  restart.
- **Inspect the real DOM**: there's no built-in inspector; log
  `document.querySelector(...)` results from FireTuner, or read the base module
  source in `Base/modules/core/ui/` + `Base/modules/base-standard/ui/` — grep there
  for component tag names (`Controls.define('panel-...'`) the same way you grep for
  EFFECT names in data modding.

## ⭐ The Dev Kit is the primary UI reference

Firaxis ships **"Sid Meier's Civilization VII Development Tools"** (a separate Steam
install under `steamapps/common/`). It has what the shipped game lacks:
- **`Reference/`** — the **uncompiled** UI source: `.tsx` / `.ts` / `.scss` (SolidJS
  + SCSS). Vastly clearer than the minified `.js` in `Base/modules`. When you need to
  know how a screen builds an element/class/icon, read the `.tsx`/`.scss` here first.
- **`Documentation/`** — Database Modding, modinfo, The Modifier System, Narrative
  Events (Markdown). Authoritative; check before reverse-engineering.
- **`Examples/`** — e.g. `fxs-new-policies` (a working new-traditions mod).
- **FireTuner** (live scripting console) + **SteamWorkshopUploader**.

Lesson (learned the hard way): **check the dev kit before declaring something
impossible or iterating blind.** Reading `screen-policies.scss` + `policy-card.tsx`
is what solved policy-card branding after many failed guesses.

## Asset path rule for icons & CSS `url()`

Reference an imported mod asset as **`fs://game/<modId>/<path-in-mod>`** — NOT a bare
filename. E.g. mod id `my-mod`, file `ui/icons/dock-icon.png` →
`fs://game/my-mod/ui/icons/dock-icon.png`. This holds for
`IconDefinitions` `<Path>`, CSS `background-image: url(...)`, `Controls.loadStyle`,
and JS `import`. PNGs used as data icons must also be `ImportFiles`'d in the modinfo
(dev-kit "Database Modding" doc). A bare `fs://game/logo.png` silently fails to load
(you get the frame/ring but a blank image) — this cost several debug cycles.

## Branding / restyling base cards (policy-card recipe — live-DOM-verified)

Base **policy/tradition cards do NOT expose per-card art to data** — the card icon
and background are computed in the UI JS. Confirmed dead ends (don't retry):
`IconDefinitions[TraditionType]` is never consulted; the card art derives from the
UI model's `TraitType`, which the engine **forces to `TRAIT_RANDOM`** for any
tradition not owned by a civ. So a modded `Traditions.TraitType` is ignored — native
recolor is impossible for modded non-civ cards. Brand them from JS instead.

> ⚠️ **Inspect the LIVE DOM before writing selectors — don't guess from the minified
> base `.js`.** The real class names differ from what source-reading suggests, and a
> card renders with DIFFERENT DOM in different states (see below). Use the Coherent
> debugger (port 9444) to dump the real structure and to prototype the fix by injecting
> into the running screen — see deploy-and-debug.md. Every selector below was verified
> that way; a whole session was burned guessing before.

**The recipe = a `UIScripts` decorator: MutationObserver → identify → restyle inline.**

1. **Observe + identify.** `MutationObserver(document.body, {childList,subtree})`,
   debounced rescan of `.policy-base-card`. There is **no TraditionType DOM attribute** —
   match each card by its displayed NAME: read `.font-title.uppercase.text-sm.font-bold`
   `.textContent` and look it up against `GameInfo.Traditions` (`Locale.compose(t.Name)`,
   filter your `TRADITION_MOD_` prefix). Appended child nodes + `data-*` attrs SURVIVE the
   SolidJS redraws on policy cards (⚠ unlike `tree-card-v2`, where injected children are
   wiped). Added *classes* get reset — use data-attrs or inline styles.

2. **⚠ Set colours INLINE from JS, never via CSS `var()`.** Coherent silently ignores
   `color`/`background: var(--x)` (the same dead-end the yield dashboards hit), so a
   CSS-class + custom-property theming approach renders nothing. Apply hex colours with
   `el.style.background = '#...'` etc. `Controls.loadStyle` is still fine for static
   positioning that doesn't vary, but anything lane/player-coloured must be inline.

3. **Swap the icon in place** (don't overlay a floating badge — it leaves the stock art
   poking out). The icon is TWO nested elements: `.policy-card-icon-backer` (the ~50px
   hexagon frame, `blp:accent_hex_*`) CONTAINS `.policy-card-icon` (the ~38px inner glyph,
   `blp:icon_*`, pulled left by `-ml-5` into the gutter). To brand: hide the inner
   `.policy-card-icon` (`backgroundImage='none'`) and **restyle the backer element itself**
   into your badge — `borderRadius:50%`, `border`, a dark `background`, and inject an inline
   `<svg>` logo child (inline SVG renders in Gameface — no PNG/rasterizer needed). Shift it
   a few px left (`transform:translateX(-Npx)`) so it clears the description text (which
   starts ~x:43), and give it a higher `zIndex` than any rail you draw so the rail passes
   behind it.

4. **⚠ Handle the SLOTTED state, not just the chooser list.** A card in the "available"
   list has ONE icon backer. When SLOTTED it gains a second `.policy-card-icon-backer.policy-grayscale`
   (the dual-slot "policy OR tradition" indicator), and the SLOT itself renders a greyscale
   placeholder socket BEHIND the card whose `-ml-5` icons poke out past your badge. Empty
   slots are greyscale placeholders too. For a fully clean look, **hide every
   `.policy-card-icon-backer.policy-grayscale` globally** (a card's own icon backer is
   non-greyscale, so it's untouched) — one robust rule, no per-card position guessing.
   **Test your branding in BOTH the available list AND slotted.**

⚠ **Coherent `querySelector` rejects `:not()`** (`SyntaxError: Invalid CSS selector`) —
filter in JS (`[...els].filter(...)`) instead.

Fragility is **cosmetic-only**: if a patch breaks the decorator, you lose the tint/logo,
never the card's function (it still renders + slots via the base UI). This is the intended
way to brand modded cards; a *dedicated custom slot type* does the opposite (it fails to
render at all — the government screen only supports Tradition/Policy/Crisis slot columns).

### Culture/tech TREE nodes (`tree-card-v2` in `screen-culture-tree`) — glow/highlight (⭐ 2026-07-13)
Worked example: a custom per-node "boost earned" glow. Hard-won specifics that differ from policy cards:
- **Node identity = the `type` attribute, and it is the NUMERIC node HASH, not the string.** Select
  `tree-card-v2[type]`; resolve the string via `GameInfo.ProgressionTreeNodes.lookup(Number(type))
  ?.ProgressionTreeNodeType` (filter e.g. `startsWith('NODE_MYMOD_')`). `Game.ProgressionTrees.getNode
  (pid, hash)` / `getNodeState` / `Players.get(pid).Culture.getNodeCost(hash)` accept the hash.
- **⚠ On tree-card-v2, INJECTED CHILD ELEMENTS ARE DELETED on the next redraw** (unlike the policy-card
  case above where appended children survive — the tree re-renders its card subtree aggressively). A
  fill-over-the-card via an overlay `<div>` vanishes. **Only inline STYLE on the existing element
  survives**, and only if you REAPPLY it every scan. So highlight with `el.style.setProperty(
  'box-shadow', …, 'important')` (a glow: outer bloom + 1px edge + `inset` edge-tint hugs the rounded
  card; `outline` draws a hard RECTANGLE ignoring border-radius — looks crude). Paint the visible bar
  `.tree-card-hitbox` (the host/`.tree-card-bg` are `display:contents`/covered).
- **Realm matters:** a standalone game-scope UIScript loads into the ROOT/bootstrap document and can't
  reach the in-game tree screen; host the decorator in a UIScript group that runs in-game (proven: the
  same group as a working in-game panel/dock). Drive it with a top-level `requestAnimationFrame`
  poller (+ optional `Controls.decorate('screen-culture-tree')`), not lifecycle hooks.
- **Reading modded state per node:** a modifier can write a player property (`EFFECT_PLAYER_PROPERTY`,
  Key/Value/Operation=CHANGE) and the UI reads it back via `Players.get(pid).getProperty(Database.
  makeHash(key))` — confirmed working (base UI only ever uses `GameTutorial.getProperty`, but the
  player object exposes `getProperty` too). This is the clean way to surface "did my modded thing fire"
  to the UI when node data has no field for it (e.g. Civ7 commingles boost + research progress with no
  boost flag).
- **⚠ EDGE-HUGGING OVERLAYS ON TREE CARDS ARE UNIMPLEMENTABLE (3 field failures, E&I 2026-08-01).**
  The card's drawn artwork is INSET inside every layout box by margins you cannot read — the
  `tree-card-v2` host, `.tree-card-hitbox` (padded input area), and `.tree-card-name-unlocks` are all
  WIDER/TALLER than the visible bar art, so any pseudo-element pinned to a box edge (`right:0`,
  `top:0/bottom:0` — e.g. an "end-cap" band or full-width underline) renders as a floating stray line
  in the gutter. What DOES align: (a) chips INSET from the edge (`top:50%; right:16px;
  translateY(-50%)` on the hitbox — MA's shipping pill; caveat: crowded 6-icon unlock rows reach the
  right edge and collide), and (b) effects on elements whose box IS their artwork — `.tree-node-icon`
  (the circular node portrait: its background image fills its box) takes `border-radius:50%` +
  `box-shadow` rings/glows with perfect registration, and `.tree-card-name` takes color tints.
  Design card indicators from (a)/(b) only; never promise edge-registered geometry.
- **Mastery-II rows are SEPARATE `tree-card-v2` elements with the SAME node-type hash** (class
  `tree-card--mastery`; the main card has `parent-node`). Any per-node decoration matched via
  `tree-card-v2[type]` hits both — filter mastery cards out or your marks appear twice.
- **✅ SHIPPED RECIPE — name-anchored CSS glyph (E&I 2026-08-01, Chris-approved).** To mark a card
  right after its title text: `.tree-card-name` is `flex-initial` (content-width), so a pseudo-element
  at `left:100%` + margin sits just past the last letter and follows the name's length. The name has
  Tailwind `truncate` (overflow:hidden) which would clip it — override `overflow:visible` +
  `position:relative` on decorated cards. A legible mini-LIGHTBULB needs no image (images injected
  into tree cards are wiped anyway): `::after` 12px circle + 2px border = the glass, and the base is
  an offset shrunk box-shadow puck (`0 8px 0 -4px <color>`); add a soft outer glow shadow when "lit".
  Color language that read instantly in play: default warm gold = "a boost exists here", switch to
  the mod's accent color + glow = earned. State classes go on `.tree-card-hitbox`, reapplied on a
  ~400ms scan (classes get reset by redraws).

## Colors: leaders, player-color CSS, plot tinting, tree icons

Four independent color levers, distilled from shipping color mods (Atlas / Matt's
Colours / SIB Configurator = leader colors; Ash's Color-Coded Buildings = plot tint;
Orion's Bonus Icons+ = tree icons).

### 1. Leader / player map colors (data — `Colors` + `PlayerColors`)

A leader's map colors are two DB tables, edited game-scope (`UpdateDatabase`):

- **`Colors`** = named color definitions. `(Type, Color, Color3D)` where the two color
  columns are `"R,G,B,A"` strings in **0–255** (note: NOT hex, NOT 0–1). `Color` is the
  UI/flat color, `Color3D` the in-world one (usually identical). Add with
  `INSERT OR REPLACE INTO Colors (Type,Color,Color3D) VALUES ('MYCIV_PRIMARY',"100,44,148,255","100,44,148,255"), …`.
- **`PlayerColors`** = per-leader assignment, keyed `WHERE Type='LEADER_X'`. Columns:
  `PrimaryColor`, `SecondaryColor`, and three backup jerseys `Alt1PrimaryColor` /
  `Alt1SecondaryColor` … `Alt3…` (used when two players would clash). Each holds a
  `Colors.Type` string. Reassign with
  `UPDATE PlayerColors SET PrimaryColor="MYCIV_PRIMARY" WHERE Type='LEADER_X';`.

Convention that keeps colors legible: make secondary a near-white/near-black so icons
and text (which the engine derives from the pair — see below) stay readable.

### 2. Player-color CSS variables (JS/CSS — tint your own panels)

The engine exposes each player's colors as a small palette you can stamp onto any
element. This is how to make a mod panel/badge match the active player's colors.

- **API:** `UI.Color.getPlayerColors(playerId)` → the raw pair;
  `UI.Color.createPlayerColorVariants(pair)` derives, for `.primaryColor` and
  `.secondaryColor` each, `{mainColor, moreColor, lessColor, textColor, accentColor,
  tintColor}` plus a top-level `.isPrimaryLighter` flag (text/accent are auto-blended
  toward white/black for contrast — you don't compute contrast yourself).
- **Stamp helper — verified exports of `/core/ui/utilities/utilities-color.js`
  (2026-07-14, read from the install):** the function is **`applyPlayerColorsToElement(element,
  playerId)`** — NOT `realizePlayerColors` (that name does not exist here; guessing it
  wasted two debug rounds). It sets, on `element`: `--player-color-primary`,
  `--player-color-primary-more/-text/-accent` (note: **no `-less`**), the matching
  `--player-color-secondary(+-more/-text/-accent)`, and toggles class
  `primary-color-is-lighter`. The file also exports `getPlayerColorVariants(playerId)`
  (returns the variants **object** above, cached — use it to read `mainColor`/
  `isPrimaryLighter` yourself), `isPrimaryColorLighter(playerId)`, and the color
  converters `HexToFloat4 / ObjectToRgbaString / RGBAToString / numberHexToStringRGB`.
  (`UI.Player.get{Primary,Secondary}ColorValueAsString` — narrowed 2026-07-29: this
  API **does work** in shipping mods (Drongo's Wonder Screen calls it in a JS model,
  Relationship Preview in a decorator); our 2026-07-14 failure in a custom `Panel`
  context was context- or timing-specific, not a missing API. There is also
  `getPrimaryColorValueAsHex(pid)` returning `0xAABBGGRR` ints for overlay colors.
  The utilities route below remains the belt-and-suspenders choice.)
- **⛔ Packed overlay colors are `0xAABBGGRR` — ABGR, not ARGB.** Red and blue are swapped
  relative to every web/hex habit, and nothing errors: you just get the wrong colour and go
  looking for a bug elsewhere (a Library blue drew as orange, 2026-08-16). The `{x,y,z,w}` float
  form used by `addPlots` is plain RGBA and does **not** swap — only the packed-int form does.
- **⚠⚠ CONTRADICTED ON 1.4.2 — READ BOTH ENTRIES BEFORE ACTING (2026-09-13).** The claim below is
  from 2026-07-14. A tracker panel built on 1.4.2 themes almost entirely through `var()`: six
  identity families redefine `--plate` / `--bas` / `--chalk` in plain CSS classes, rules like
  `.x-plate { background-color: var(--plate); color: var(--plate-ink) }` paint correctly, and when
  the runtime overwrote the inline `--plate-ink` the title text changed colour with it. So on this
  build `color: var(--x)` **does** resolve, from both class-declared and inline custom properties.
  What failed in the same session was the **opposite** half of the entry below — see the next bullet.
  ⚠ Do not assume either behaviour. **The robust pattern, which is correct under both:** resolve the
  colour in JS, keep it in a variable, and use that variable for anything JS generates (SVG
  attributes, inline styles); let CSS `var()` handle the purely declarative surfaces.
- **⚠⚠ DO NOT READ A CUSTOM PROPERTY BACK OUT OF THE DOM.** `getComputedStyle(el).getPropertyValue('--x')`
  returned **empty** for a property set inline on that element's PARENT, on 1.4.2 — while CSS `var()`
  on the very same element resolved the same property correctly. The symptom is nasty: the read has a
  `|| fallback` after it, so it never throws and never logs; you silently ship the hardcoded fallback.
  It cost two rounds on one panel — a close button drew in a dark slate fallback that happened to look
  deliberate on light plates and vanished on a dark one, and the identical mistake had already been
  found and annotated a few lines away in the same file for a different element.
  ⚠ This directly contradicts the 2026-07-14 note below that `getComputedStyle(child)` returns the
    parent's value. One of the two is build-dependent; neither is worth betting on. Keep the resolved
    value in a JS variable instead of asking the DOM for it back.
- **The 2026-07-14 entry, kept verbatim:** A custom property set on an element *does* inherit to
  descendants (confirmed: `getComputedStyle(child).getPropertyValue('--x')` returns the
  parent's value), but a declaration like `.foo { color: var(--x) }` **does not use it** —
  the color collapses to inherited/black, and setting the var to any value changes nothing.
  So **CSS-variable theming for dynamic colors is a dead end here.** Symptom: your panel
  renders all-gray/black (not even the `var(--x, fallback)` fallback shows, because the var
  *is* defined — just ignored). Fix: **compute the color in JS and set it DIRECTLY as an
  inline style on each element** (`el.style.color = 'rgb(...)'`, `el.style.backgroundColor`,
  `el.style.borderColor`) after every render pass and on tab-switch. Inline styles are the
  only thing that reliably paints. Keep the CSS with hardcoded sane defaults so the base
  state is never gray; JS overrides on top.
- **⚠ `fxs-*` custom elements render their text/chrome INTERNALLY**, so host CSS `color`/
  `box-shadow` never reaches the painted pixels: `fxs-header` paints its own (gold) title
  text — you cannot recolor it from outside; `fxs-subsystem-frame`'s ornate frame is a
  **background image** (`blp:hud_sidepanel_bg` + filigree PNGs), NOT a border-image, so an
  inset `box-shadow` hides behind it and `fxs-border-image-tint` on the frame **washes the
  whole panel** (wrong lever). `fxs-border-image-tint` only tints an element that itself
  carries a `border-image-source` (`blp:`) — the base game makes a dedicated element for it
  (`.city-banner__stretch-bg`, `.diplo-ribbon__front-banner`). Recolor only the **plain
  `<div>`/`<span>`** you create in JS; leave the fxs chrome alone.
- **Legibility on a dark panel — use the engine's own `accentColor`, don't roll your own.**
  A civ's raw `primaryColor` is often dark (navy/purple/brown) and unreadable on a dark
  panel. Custom normalization is a rabbit hole (HSL-lightness ≠ perceived luminance → green
  reads bright, blue dark at the same L; brown is *dark orange* so any lift turns it orange;
  near-white civs desaturate to gray). The clean answer: **`createPlayerColorVariants(pair)
  .primaryColor.accentColor`** is the engine's pre-derived contrast-safe form (e.g. raw
  purple `rgba(55,0,101)` → accent `rgba(84,98,153)`) — muted, matches Civ7's restrained
  palette, legible on dark, and it's per-leader/persona exact (dual leaders like Friedrich
  each resolve correctly, no table to maintain). Parse its `r,g,b` and build your own
  `rgb()`/`rgba()` strings (the variant strings carry alpha `255` in 0–255 form). This was
  a pragmatic choice after rejecting custom normalization as a "mixed bag."
- **Where the data lives:** per-leader colors are `base-standard/data/colors/playercolors.xml`
  — a `Colors` block (named defs → `"R,G,B,A"`) and a `PlayerColors` block mapping each
  `LEADER_*` (and generic `PLAYERCOLOR_*` slots) to a `PrimaryColor`/`SecondaryColor`. You
  rarely need it though — `getPlayerColors(pid)` resolves the exact active color at runtime.
- **The `--player-color-*` route still works for plain elements** where you *can* use CSS:
  `applyPlayerColorsToElement(element, playerId)` sets `--player-color-primary(+-more/-text/
  -accent)` etc., and `fxs-border-image-tint: var(--player-color-primary)` tints a real
  border-image element (SIB's diplo-ribbon fix). But per the `color: var()` law above, don't
  rely on it for `color`; prefer direct inline styling for anything dynamic.

### 3. Tinting plots from a lens layer (`WorldUI` plot overlays)

For "color the map by <data>" lenses (ACB tints each tile by its building's dominant
yield). Inside a lens layer (`initLayer/applyLayer/removeLayer`, registered via
`LensManager.registerLensLayer` — see [Lenses](#lenses-and-lens-layers)):

```js
this.overlayGroup = WorldUI.createOverlayGroup("MyOverlay", 1); // (name, zIndex)
this.overlay = this.overlayGroup.addPlotOverlay();
// colors are float4 RGBA in 0–1: {x:r/255, y:g/255, z:b/255, w:alpha}
this.overlay.addPlots(plotArray, { fillColor: c, edgeColor: {x:c.x,y:c.y,z:c.z,w:0} });
this.overlay.clear();                 // wipe before each redraw
this.overlayGroup.setVisible(bool);   // show/hide the whole group
```

- `plotArray` = `[{x,y}, …]`. **Batch by color**: group all same-color plots and issue
  one `addPlots` per color (ACB builds a `Map` keyed by the color string) — far cheaper
  than per-plot calls across a full `GameplayMap.getGridWidth()×getGridHeight()` sweep.
- `fillColor` fills the hex; `edgeColor` outlines it — set one's `w:0` to draw only the
  other (fill-only, edge-only, or both = three render modes).
- Redraw on the data events you care about (ACB listens to `ConstructibleAddedToMap` /
  `ConstructibleRemovedFromMap`) and only when `this.visible`.
- Reading tile constructibles for the color decision: `MapConstructibles.getConstructibles(x,y)`
  → component IDs → `Constructibles.getByComponentID(cid)` → `GameInfo.Constructibles.lookup(item.type)`.

### 4. Recoloring / reassigning tech & civic tree bonus icons

Each tree-node bonus draws an icon via an **`IconAliases`** row (`ID` = the bonus's
modifier key like `MOD_AQ_TECH_WALL_STRENGTH`, `OtherID` = an icon definition). To
swap in your own art:

1. Register the art in **`IconDefinitions`** `(ID, Path)` with an
   `fs://game/<modId>/icons/<file>` path (extension optional; the PNG must also be
   `ImportFiles`'d). See [Asset path rule](#asset-path-rule-for-icons--css-url).
2. **Remap** the bonus to it in `IconAliases`. ⚠ **Gotcha (confirmed in Orion's
   source): `UPDATE` on an existing `IconAliases` row silently does nothing** — you must
   `DELETE FROM IconAliases WHERE ID='MOD_…';` then `INSERT INTO IconAliases (ID,OtherID)
   VALUES ('MOD_…','MY_ICON');`.
3. Run both via the modinfo **`<UpdateIcons>`** action — and register it in **both a
   `scope="shell"` and a `scope="game"` ActionGroup** (icons show in shell menus and
   in-game trees; miss one scope and half your icons revert).

This is the clean way to give a custom tech/culture-tree mod's fan-out bonuses legible,
color-coded icons instead of inheriting a generic base icon.

### 5. Custom-civ art & the "Art Fixes" compat shim

A full custom **civilization** ships art through four mechanisms (worked example: *Matt's
Civs: Ireland*, workshop `3506935009`):

- **`ImportFiles`** the raw assets — the `.png` **and** its extensionless twin (the engine
  references textures by bare ID). Import in **both** `scope="shell"` and `scope="game"`
  ActionGroups (shell = setup/civ-select, game = in-game); miss a scope and that half of
  the UI shows nothing.
- **`<UpdateIcons>` → `icons.xml`** registers them: `<Icons>` declares `ID` + `Context`
  (`DEFAULT` / `BACKGROUND` / `BACKGROUND_VERT`); `<IconDefinitions>` maps `ID`(+`Context`
  +`IconSize`) → a `Path`; `<IconAliases>` points a bonus at an existing icon. Path flavors:
  mod-relative extensionless (`<modId>/icons/<file>`), **`blp:<name>` = reuse a base-game
  texture** (`blp:CG_Rome_Colosseum_VERT`), or `fs://game/…` absolute.
- **`<UpdateVisualRemaps>` → `visual-remaps.xml`** reuses **3D in-world models** (distinct
  from the 2D `blp:` icons above): `<Row><Kind>BUILDING</Kind><From>BUILDING_MY_THING</From>
  <To>BUILDING_RAILYARD</To></Row>` gives a custom building/unit a real model with zero 3D
  art. (A sibling remap that renames the base type with a trailing `_` via `sql/icons.sql`
  frees the original ID for the custom one to remap onto.)
- Loading splash = `BACKGROUND`-context icons at `IconSize` 720/1080; age-transition
  cinematics = `.webm` via `movies.xml`.

**The catch — base UI silently drops modded-civ art in ~5 spots.** The engine's texture
pipeline prefixes custom asset paths with its atlas scheme `blp:`, which only resolves
built-in textures — so `blp:fs://…` and `blp:bg-panel-<civ>` render nothing. The community
dependency **Custom Civ Art Fixes** (Slothoth, workshop `3735898897`) is a generic
`<UIScripts>` shim (loaded in both scopes) that monkeypatches the fixes at runtime:

- `WorldUI.addBackgroundLayer` override → the post-select **splash**: if the texture is a
  registered custom civ, render the art as a full-screen **DOM overlay `<div>`** instead
  (engine layer → CSS fallback). Driven by a one-row table `CivsWithoutBackgrounds
  (CivilizationType, ArtPath)` the civ mod populates with a single `INSERT` (the only
  per-civ input needed; the other four fixes are automatic).
- `CSSStyleDeclaration.prototype.setProperty` override + a `MutationObserver` → globally
  rewrites `blp:fs://…`→`fs://…` and `blp:bg-panel-X`→ the mapped URL, catching inline
  styles on the **game-select chooser cards, age-transition cards, and diplomacy golden
  icon**.
- `Icon.getCultureIconFromProgressionTreeNodeDefinition` override → fixes the **shared
  culture-tree node icon** for anachronistic civs: when a `ProgressionTreeNodes` row is
  flagged **`CivInjectedIcon`**, it substitutes the player civ's `cult_<civ>` icon.

**When this matters:** only for a full custom **civilization**. A custom **progression tree
granted to all players** (e.g. a mod-wide custom civics/tech tree) is *not* a civ — the splash,
chooser-card, and diplomacy fixes never fire, and its nodes use plain `IconString` /
`IconAliases` (section 4), which already work without the shim. Reach for Art Fixes (and
`CivInjectedIcon`) only if you build an actual civ or a per-civ-injected culture node.

### 6. Mutating authoritative gameplay from a UIScript (the sanctioned RPC)

The common belief is "a mod's `<UIScripts>` (App UI isolate) can't change gameplay — the
gameplay isolate is walled." That's **only half true**, and the distinction is sharp
(verified in-game 2026-07-10, and by the shipping *Building Demolisher* mod, workshop
`3741851079`):

- **WorldBuilder debug map-writes are INERT/transient** from a UIScript.
  `WorldBuilder.MapPlots.setOwnership(playerId, loc)` and `…setResource(...)` report a change
  but it does not render, does not yield, and **does not survive save/reload**. Do not rely
  on them for durable state.
- **The sanctioned native-operation RPC IS authoritative and DURABLE.**
  `Game.PlayerOperations.sendRequest(playerId, "CREATE_ELEMENT" | "DESTROY_ELEMENT", args)`
  writes real, persistent game state from the UI isolate:

```js
// CREATE a rural district (auto-places the terrain-appropriate improvement, e.g. Farm):
Game.PlayerOperations.sendRequest(owner, "CREATE_ELEMENT",
  { Kind: "DISTRICT", Type: "DISTRICT_RURAL", Location: {x,y}, Owner: owner });
// CREATE a specific constructible/improvement:
Game.PlayerOperations.sendRequest(owner, "CREATE_ELEMENT",
  { Kind: "CONSTRUCTIBLE", Type: "BUILDING_…", Location: {x,y}, Owner: owner });
// DESTROY a district or constructible (get the id first):
const d = Districts.getIdAtLocation(loc);            // {owner, id}
Game.PlayerOperations.sendRequest(owner, "DESTROY_ELEMENT",
  { Kind: "DISTRICT", Owner: d.owner, LocalID: d.id });
// pre-check (optional diagnostic): returns {Success:bool}
Game.PlayerOperations.canStart(owner, "CREATE_ELEMENT", args, false);
```

- Helper reads: `Districts.getAtLocation(loc)` / `getIdAtLocation(loc)`,
  `district.getConstructibleIdsOfClass(ConstructibleClasses.IMPROVEMENT)`,
  `GameplayMap.getOwner(x,y)` (all work in UI ctx).
- **Trigger it from a unit button via the "fake Great Person" pattern** — the cleanest
  UI→action hook: give a unit `UNIT_CLASS_GREATPERSON` + `AvailableInTimeline="false"` and a
  `GreatPersonIndividuals` row with `ActionCharges` + `ActionRequires*` gates; its Activate
  press fires `engine.on("UnitGreatPersonActivated", cb)` in the UIScript. See
  [custom-units.md](custom-units.md) for the full unit data. (*Building Demolisher* grants the
  unit via a narrative story's `EFFECT_CITY_GRANT_UNIT`, human-only.)

**⚠ Hard limits — what this does NOT give you:**
- **`CREATE_ELEMENT` on an UNOWNED tile comes out PLAYER-owned, not city-attached** — an orphan
  outside every city's territory, showing tile yields that no city banks. Nothing UI-reachable folds
  an unowned out-of-range plot into a city (`city.Growth.claimPlot` is gameplay-isolate only and a
  no-op in a UIScript; CityCommands `EXPAND`/`PURCHASE` are C++-capped at the 3-hex radius).
  ⭐ **BUT THIS IS NOT A WALL — corrected 2026-08-15.** Claim the tile into city territory FIRST
  (the Surveyor's native `UNITCOMMAND_CLAIM_RESOURCE` claims a path of tiles back to the settlement,
  and they are genuine city land), then `CREATE_ELEMENT` onto it: the district and building attach to
  the **city**, and the city banks the building's yields — at ring 4/5, with no population assigned,
  durable across save/reload. Orphaning was an artefact of starting from an unowned tile.
  ⚠ The op enforces **no** distance cap, **no** placement rules and **no** tech prerequisite, and
  `canStart` returns `Success:true` regardless — supply every gate yourself.
  ⛔ The RPC is **queued to the sim**: a read in the same tick as `sendRequest` returns the OLD state.
  Full chain and caveats: [tile-ownership-and-radius.md](tile-ownership-and-radius.md).
- Runs as the local player; **MP-desync is unverified** (the RPC is the deterministic
  sanctioned channel, so safer than WorldBuilder writes, but confirm before shipping MP).

**Good for:** live, durable **razing / rebuild** (create + destroy districts and
constructibles — a cleaner route than overbuild/REPLACE gymnastics; see
[razing-and-conquest.md](razing-and-conquest.md)), resource removal, and terrain/district
edits that must persist.

## ⭐⭐ `plot-icons` — the FOURTH map-rendering route, and the game's own (2026-09-13)

Sourced from the shipping Workshop mod **Better City UI** (`better-city-ui`, Najane), whose own
header documents why it abandoned sprites for this.

⛔ **FIRST, THE SPRITE CEILING, NOW PINNED DOWN.** `addSprite` takes **`scale`, `alpha`, `angle` and
`offset` — and nothing else**, checked against every call in the game. **A SPRITE CANNOT BE
COLOURED.** That independently confirms the four failed compositing attempts banked below (see the
sprite-grid stacking section): a coloured ring around a sprite icon is not expressible at any effort,
and every coloured texture the game ships already has a yield SYMBOL printed on it, so it reads as a
second icon rather than as a frame.

✅ **THE ANSWER IS THE GAME'S OWN PLOT-ICON SYSTEM** — a registered Controls component that the
engine anchors at a tile, in the DOM, where a CSS border is just a CSS border:

```js
import PlotIconsManager from '/core/ui/plot-icons/plot-icons-manager.js';  // DEFAULT export, a SINGLETON
const attributes = new Map([["data-event-class", eventClass]]);
PlotIconsManager.addPlotIcon("plot-icon-random-event", location, attributes);
PlotIconsManager.removePlotIcons("plot-icon-random-event", location);       // location optional = all
```

- `type` is a **registered Controls component name**; base ships `plot-icon-archeology`,
  `plot-icon-resource`, `plot-icon-random-event`, `plot-icon-suggested-settlement` under
  `base-standard/ui/plot-icon/`.
- **It scales to map-wide use** — base drives it from the continent layer, the random-events layer
  and the archaeology lens across every revealed plot. That was the open question before committing.
- ⚠ **ONE ELEMENT PER TILE, not per thing.** `addPlotIcon` places a single element at a plot; lay a
  row of icons out INSIDE it.
- ⚠ `Component` and `Controls` are **engine globals, not imports** — `component-support.js` exports
  nothing at all. The game's own plot icons are written the same way.

**Choosing between this and WorldAnchors (below):** WorldAnchors is a raw anchor you register and
unregister yourself, good for one-off labels you fully control. `plot-icons` is a MANAGED system with
add/remove by type and location and base-game lens integration — prefer it for anything per-tile and
repeated.

## ⭐ Tile-anchored DOM labels — WorldAnchors (the third map-rendering route)

Sourced 2026-08-22 from the shipping Workshop mod **"City-Tile Labels"** (`pd-building-labels`
v1.3.0, skar99/Hensteve) — per-tile building labels rendered as REAL HTML, not sprites.

There are **FOUR** ways to draw on the map (the fourth, `plot-icons`, is documented above):

| route | what it is | text? | styling? |
|---|---|---|---|
| World sprites/VFX | `WorldUI` model groups, `addSprite`/`addText`/`addVFXAtPlot` | crude | atlas art only — ⛔ **sprites cannot be coloured** |
| Screen DOM | panels in `#worldanchor`/body | full | full CSS |
| **Tile-anchored DOM** | **a DOM element the ENGINE pins to a world position** | **full** | **full CSS** |
| **`plot-icons`** | **the game's own managed per-tile component system** | **full** | **full CSS** |

The mechanism (building-labels.bundle.js:1742):

```js
this.worldAnchorHandle = WorldAnchors.RegisterFixedWorldAnchor(location, {x: 0, y: 0, z: 20});
root.setAttribute("data-bind-style-transform2d",
    `{{FixedWorldAnchors.offsetTransforms[${this.worldAnchorHandle}].value}}`);
root.setAttribute("data-bind-style-opacity",
    `{{FixedWorldAnchors.visibleValues[${this.worldAnchorHandle}]}}`);
// on detach:
WorldAnchors.UnregisterFixedWorldAnchor(this.worldAnchorHandle);
```

- `location` is a plot coord; the `z` offset lifts the anchor above the ground plane.
- The **data binding does all the work**: the engine writes a 2D transform every frame as the
  camera moves, and `visibleValues` fades the element with distance/occlusion — no per-frame JS,
  no camera listener. This is the same mechanism city banners ride.
- The element must carry `pointer-events-none` and the **`allowCameraMovement`** class so map
  drag/zoom passes through it.
- Position with `transform: translateX(-50%) translateY(-100%)` on an inner container so the
  label sits centered ABOVE the anchor point; the outer element gets the engine's transform.

**Their label anatomy, worth copying** (container → frame → box → items):
- per-item: a round icon wrapper whose `::before` ring is **color-coded by category**
  (food `#80b34d` · production `#8f5732` · gold `#f6ce55` · science `#6ca6e0` · culture `#6d5fe6`
  · happiness `#f5993d` · military `#d65353` · diplomacy `#afb7cf` · wonder `#e7d39a`) — a
  ready-made, player-familiar category palette;
- a small **state badge dot** at the icon's top-right corner (`queued` blue, `overbuildable`
  grey) — state on the corner, identity in the middle;
- an optional **`with-background-box`** style (dark rounded box + `filter: drop-shadow`) vs the
  bare floating style, and an **`icons-only`** compact variant — three looks from one DOM shape;
- constructible portraits via `UI.getIconCSS(type)` read fine at ~2rem on the map.

⚠ **Two anti-patterns in the same mod — do NOT copy:**
- `categoryFromTokens()` classifies buildings by **NAME SUBSTRINGS** ("barracks", "wall", …) —
  the naming trap this skill's front page warns about. Classify from data (adjacency yield type,
  TypeTags), never from the id's spelling.
- It harvests player colors by reading `--city-banner-color` CSS vars off live city-banner DOM.
  The sanctioned route is `UI.Color.getPlayerColors()` + `createPlayerColorVariants()` (see the
  Colors section above).

## ⛔ Sprite-grid stacking is uncontrollable across textures (proven the hard way, 2026-08-23)

➡ **THERE IS A WAY OUT, FOUND LATER — see `plot-icons` above.** Everything in this section stands
(four attempts, all failed), and 2026-09-13 supplied the reason: `addSprite` accepts only `scale`,
`alpha`, `angle` and `offset`, so a sprite **cannot be coloured or framed at all**. If you need a
coloured rim, a border, or controlled layering on a tile, do not fight the sprite grid — use
`PlotIconsManager.addPlotIcon`, where it is ordinary CSS.


Learned across four failed attempts to composite a "red rim around a normal pip" from two disc
textures in one `WorldUI` sprite grid (two-rings):

- **Insertion order is NOT draw order** between different textures: drawing disc A then disc B on the
  same spot rendered A on top.
- **The z coordinate does not fix it either**: the same pair at `z` and `z-2` still rendered the
  "lower" one on top. The grid appears to batch/sort by texture, in an order the caller cannot set.
- ⚠ The one stacking that DOES hold: a small glyph sprite drawn after a disc at the same z reliably
  renders above it (the pip + yield-icon pattern). Trust that specific pairing, nothing more.
- Related texture facts: the base ships exactly THREE specialist pip discs (`_empty`, `_full` — has a
  person baked in — and `_bad` — has a red "!" baked in); `specialist_pip_framed_empty/_full` exist as
  a fourth/fifth family from the city screen. Baked-in punctuation cannot be composited away.

➡ **If a mark needs controlled layering or styling, do not fight the sprite grid** — use a tintable
plot VFX (`addVFXAtPlot` + `Color3`, section above; colours render ADDITIVELY and wash out — test in
game, keep them saturated/dark) or a WorldAnchors DOM label (section above), both of which the caller
fully controls. The two-rings obsolete mark ended as: plain pips + a deep-crimson hex glow
(`#c31220` via srgbToLinear), with the detail carried in the panel.
