# AiMod reference and MODDOCK implementation boundary

Inspected https://aimod.games/ on 2026-10-15, including its public HTML,
assets/js/main.js, five Wukong case panels and FAQ.

Observed: the examples show class inspection, enum listing and method
decompilation, repeated tool calls, user gameplay confirmation, and saving a
mod with switches or hotkeys. Website scripts animate a pre-authored transcript;
they are not the desktop execution engine. The site does not expose its model
provider, native execution implementation, or a verified BG3/3D asset pipeline.
The game wall lists engine examples, not 77 individually verified integrations.

The user's selected first game remains Baldur's Gate 3. Original 3D generation
was superseded by the AiMod-style gameplay authoring request; no new GPU/model
service is configured. Do not label generated gameplay scripts as new 3D assets.

MODDOCK uses MU-authenticated AI decisions and bounded local tools: actual game
diagnostics, bundled API lookup, fresh managed runtime logs, and Lua 5.4 compile
checks. Script Extender packages receive fixed host-owned settings/action
transport. Model code cannot choose executable commands, network destinations,
filesystem paths, or private credentials. Compilation is not gameplay execution.

Controlled BG3 scripts declare Moddock.OnSettingsChanged, Moddock.OnAction and
Moddock.Every callbacks. The host generates server settings polling and client
function-key input. The desktop validates account, artifact, installed build and
settings bounds before writing only that artifact's user-data control files.
Actions carry nonces; only a matching acknowledgement can show execution.
Settings remain pending until a matching game response is observed. Gameplay
effects and real Windows/BG3 behavior require device acceptance.
