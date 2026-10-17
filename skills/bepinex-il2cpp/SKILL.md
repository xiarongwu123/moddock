---
name: moddock-bepinex-il2cpp
description: Implement and build Unity IL2CPP gameplay mods using actual generated game interop and the host BepInEx 6 compiler and installer.
---
# Unity IL2CPP authoring

This is a MODDOCK adaptation, independently written for its bounded tools.
References: https://github.com/KaelLim/bepinex-modding and https://docs.bepinex.dev/

1. Confirm GameAssembly/IL2CPP evidence with inspect_game. A Unity label alone does not establish Mono or IL2CPP.
2. Check the actual loader version, interop assemblies and target framework before choosing a project layout. Mono BepInEx 5 templates do not establish IL2CPP compatibility.
3. Resolve target names and signatures from generated interop references; use private analysis evidence for behavior. Never invent a Harmony target.
4. Distinguish plugin entrypoints from injected MonoBehaviour lifetimes. Check registration, IntPtr constructors, persistent hosts and collected native objects when debugging callbacks.
5. Treat stripped or inlined native methods as a reason to inspect a caller, not to pretend a patch worked.
6. Use engine-mod with mode unity-il2cpp, main.cs and mod.json. Define public static class ModContent with public static void Initialize(BepInEx.Unity.IL2CPP.BasePlugin plugin). The host generates game interop offline, supplies the BepInEx 6 entry, compiles the plugin and installs its actual DLL. Implement real callbacks and patches; do not stop at PatchAll with no patch methods. Fix native compiler diagnostics when returned. The bepinex-plugin artifact remains a Mono adapter.
7. Pi project tools write your code; the desktop host owns executable tools, dependency preparation, deployment and restore. Do not invent commands or download addresses. Actual game loading and gameplay require separate runtime evidence. A precise encrypted/unsupported metadata blocker cannot be replaced with a development plan labeled as a Mod.
