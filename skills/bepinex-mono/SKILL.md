---
name: moddock-bepinex-mono
description: Author Unity Mono gameplay mods with BepInEx and Harmony using MODDOCK verified game evidence and its supported artifact contract.
---
# Unity Mono authoring

This is a MODDOCK adaptation, independently written for its bounded tools.
References: https://github.com/KaelLim/bepinex-modding and https://docs.bepinex.dev/

1. Use inspect_game to confirm Unity Mono, loader version and allowed artifact kinds. IL2CPP is a separate route.
2. Read the supplied engine guide and game API evidence. Do not infer a game method from its name or from another game's implementation.
3. For bepinex-plugin, implement only Moddock.Generated.ModContent.Initialize(). The host owns the plugin bootstrap. Never return a second BepInPlugin entrypoint.
4. Match the installed Unity and managed assembly references. Discover types before patching. Harmony target signatures must have evidence.
5. Register callbacks on a persistent object when scene transitions require it. Use bounded work in Update; avoid scene-wide object scans every frame.
6. Preserve existing behavior unless the idea requires changing it. Make reversible patches and settings where supported.
7. Do not install loaders, execute commands, edit game files or claim a build succeeded. The desktop compiles against actual references and reports errors for repair.
8. A compiler pass proves compilation only. Loader logs and a visible game effect are separate acceptance evidence.
