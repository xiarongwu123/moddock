# Cross-game creation environments

The game picker accepts all scanned/local games. Diagnostics and knowledge lookup are common to every game. Creation, loader preparation, compilation, packaging and installation use specific adapters; a detected engine alone is not a promise of compatibility.

| Route | Environment preparation | Build/install evidence boundary |
| --- | --- | --- |
| BG3 | Pinned official Script Extender | Lua compilation and LSPK v18; in-game loading remains separate |
| Unity Mono | BepInEx 5 selected from actual x86/x64 game PE | Actual local game references, Roslyn compile, managed DLL validation, plugins deployment |
| Unreal with existing UE4SS | Reuse the detected unique loader | Bundled Lua compiler, actual mod paths and new runtime log evidence |
| Black Myth Wukong | Pinned UE4SS distribution plus its official Wukong engine/vtable config | Same UE4SS route; no bundled cheat/demo Mods enabled |
| Registered RE Engine games | Pinned monolithic REFramework DLL; Lua autorun directory | Bundled Lua compiler and autorun deployment |
| Stardew Valley | Official SMAPI Windows payload and game deps copy; Content Patcher through MU's Nexus platform | Validated JSON/PNG and SMAPI manifests; source download depends on the MU platform being ready |
| Unity IL2CPP, unprofiled Unreal, Godot, Bethesda and other engines without a creation adapter | Keep detected loader/engine and explain missing support | Existing Mod install rules may apply; AI creation stays source-only or blocked until a verified adapter exists |

The representative fixtures are Wukong, Valheim, RE4, Stardew and Skyrim SE, alongside BG3. They are file/packaging fixtures, not game execution. The centralized registry allows more game-specific configurations without changing UI or authentication.

RE Engine registry entries cover RE2/3/4/7/Village, DMC5, Monster Hunter Rise/Wilds, Dragon's Dogma 2 and SF6. Their presence is distribution routing evidence, not a per-version device certification. Native diagnostics still gate detected protected/online routes. Existing arbitrary DLLs are never overwritten.

Component publishing stages each missing file beside its destination and links it without replacement. Recovery markers use the actual inode/device identity to avoid deleting an identical file installed concurrently by another program. A journal rolls back only files published by the interrupted operation. Existing edits and saves are preserved. Shared loader files remain after ordinary Mod restoration; managed Content Patcher is a normal dependency Mod.

The Windows x64 compiler is downloaded from Microsoft on demand and checked with a pinned SHA-512 before extraction. Only the trusted compiler runs; MODDOCK never runs generated C# or Lua during a build. The SDK does not get bundled with the installer. This can require approximately 285 MB on first use. Unsupported build chains remain blocked rather than reporting a usable Mod.

Official sources, reviewed 2026-10-16:

- https://github.com/BepInEx/BepInEx/releases/tag/v5.4.23.5
- https://github.com/UE4SS-RE/RE-UE4SS/releases/tag/experimental-latest (specific filename, exact digest and matching config digest pinned)
- https://github.com/praydog/REFramework-nightly/releases/tag/nightly-01432-d052e8fd3fd41d0a1a33394fcf6e6c19be39b1ee
- https://github.com/Pathoschild/SMAPI/releases/tag/4.5.2
- https://raw.githubusercontent.com/Pathoschild/SMAPI/develop/src/SMAPI.Installer/assets/README.txt
- https://github.com/Pathoschild/StardewMods/tree/develop/ContentPatcher/docs
- https://builds.dotnet.microsoft.com/dotnet/release-metadata/8.0/releases.json

Model credentials remain on MU. This change does not add GPU mesh generation, regenerate proprietary game assets, or establish universal game compatibility.
