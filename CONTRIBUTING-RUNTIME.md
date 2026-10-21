# Runtime regression workflow

Use Node.js 22.19 or newer. Install the pinned desktop and Pi dependencies:

```
npm ci --ignore-scripts
npm run test:setup
npm run build
npm run test:all
```

`npm test` includes the API, installer, authoring, runtime-repair, runtime-safety
and Windows persistence suites. `npm run test:ui` rebuilds the current sources
and runs the isolated Chrome workflows, including FOMOD, update notices and
membership. Chrome must be installed. The UI runner reports the current workflow
and bounds each child process so an unresponsive workflow cannot hang the run.

The merged repository contains the React authoring sources and components.
Build `public/auth.js` and `public/auth.css` with `npm run build`; do not patch
minified symbol names. Both legacy update-bundle scripts now use the same build.
The runtime suite verifies that shipped UI assets match a fresh source build.

Lua syntax and host contract checks use the bundled Lua 5.4 VM. C# integration
requires a .NET SDK (MODDOCK_DOTNET can select it); missing game reference
assemblies block compilation before any compiler download. Optional official
archive tests require the pinned, checksum-verified archives under
output/game-environments and output/bg3-extender. Captured crash regressions use
MODDOCK_CRASH_FIXTURE_ROOT, or locally F:/youxia/qa/ron-crash-fix-20261019, with
backup/ and fixed/ subfolders. Report any skipped cases explicitly.

These automated regressions do not establish real online AI availability or
in-game Mod behavior. See RUNTIME-VERIFICATION.md and docs/runtime-e2e for that
evidence. Keep credentials, sessions, saves, installed game files, compiler SDKs
and downloaded test archives outside Git.