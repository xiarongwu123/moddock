---
name: ready-or-not
description: Develop executable Ready or Not gameplay Mods using UE4SS Lua, game-specific API evidence, real source files and compiler feedback. Applies to Steam 1144200 and exact Ready or Not identities.
---

# Ready or Not authoring

Read `references/implementation.md`, inspect the actual game context and use
`search_api` to verify the classes/functions needed for this request.

The default deliverable is executable gameplay code. An absent local loader is
an installation dependency, not a reason to replace the Mod with a planning
document. The host can package a tested Lua entry and prepare the registered
Ready or Not UE4SS layout. Game execution is validated separately.

Use `write_project_file` to create the full `main.lua`, then `validate_project`.
Read diagnostics, edit and compile again until the actual source passes. Submit
the requested kind, name, author and description using `submit_result`; the host
reads the compiled source. Do not fill the final artifact with TODOs, empty
callbacks, log-only demonstrations or another feature instead of the request.

Use reflected names, not raw memory offsets. Check class/function availability
at runtime and log one clear incompatibility message when a required interface
is absent. Run UObject operations on the game thread. Keep delayed callbacks
bound to valid objects from the same mission. Preserve the requested audience:
suspects, civilians, SWAT and player characters are distinct classes.

If the exact behavior cannot be implemented from the evidence, identify the
specific missing interface. Do not invent a `Revive` function, silently change
the requested mechanic or call a written plan a completed Mod.
