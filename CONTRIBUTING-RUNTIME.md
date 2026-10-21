# Runtime verification snapshot

This branch imports the verified 0.6.8 desktop source snapshot, including the
dependencies of its AI Mod workflow, then records its automatic runtime
verification and repair implementation. The repository's previous main branch
predates these modules. Existing uncommitted main-worktree changes were not used.

The supplied snapshot contains shipped UI JavaScript. The repository's older
React authoring sources and platform files are retained unchanged, but they do
not contain the complete authoring source for this newer shipped UI. Do not
overwrite the verified bundle by rebuilding the legacy UI. Keep public/auth.js
and public/mod-studio.js consistent when changing the shipped workflow.

Install the pinned dependencies with `npm install --ignore-scripts`, then run:

```
node --test test-runtime-repair.cjs test-runtime-safety.cjs test-creation-save.cjs
```

These regressions are separate from real online AI and game acceptance.
For the archived crash-script cases, set MODDOCK_CRASH_FIXTURE_ROOT to the folder
containing their backup/ and fixed/ subfolders (locally F:/youxia/qa/ron-crash-fix-20261019).
After editing public/mod-studio.js, run node scripts/update-studio-bundle.cjs.
It updates only the shipped studio factory with its existing React bindings and
refuses an unfamiliar bundle. It does not rebuild the incomplete legacy UI tree.
See RUNTIME-VERIFICATION.md for the real test results and their limitations.
Selected runtime evidence is in docs/runtime-e2e; full diagnostic artifacts
remain in the local F:/youxia/qa/live-ai-runtime-e2e folder. Account sessions,
credentials, game saves, installed game files and application installers are
excluded from this commit.
