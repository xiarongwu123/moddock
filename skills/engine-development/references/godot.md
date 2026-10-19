# Godot

Inspect project.godot, readable GDScript/resources, PCK version and any game-provided mod loader. Godot 3 and 4 syntax, binary resources and compiled GDScript differ. A pack needs an actual loader or a verified replacement/patch mechanism: dropping a standalone PCK beside an executable does not activate it.

For engineEvidence.mode=godot-gdscript write main.gd extending Node and mod.json with that mode. The host recovers project settings and actual scripts, compiles matching GDScript bytecode using pinned GDRE, adds a unique autoload, replaces the binary project settings with equivalent text settings, rebuilds the original PCK or embedded pack, and verifies unchanged assets. It exports a version-bound binary delta installed with backups. You implement the requested mechanics using recovered classes, signals and scene evidence. Process existing scene nodes as well as future nodes; initialization order can otherwise miss the player. Godot 3 uses object/method signal connections; Godot 4 uses Callable. Do not assume a reference excerpt is a complete file. Never insert log-only placeholders or a generic FPS example.

Native compilation diagnostics return for repair. Source-development is reserved for evidenced encrypted/custom-format/API blockers. Native runtime verification is distinct from compilation; do not claim a game was run unless its runtime evidence exists.

References: https://docs.godotengine.org/en/stable/tutorials/export/exporting_pcks.html
