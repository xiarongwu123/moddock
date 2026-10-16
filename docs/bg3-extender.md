# BG3 Script Extender preparation

The desktop app detects the selected scanned BG3 installation. A signed-in MU account with library.manage permission can prepare its environment. The AI studio keeps its existing Pro gate; no account tiers or backend model keys change.

Starting creation prepares the component automatically. Studio installation, Mod library installation, advanced preview/apply and re-enabling a Mod also prepare it before changing Mod files. A separate one-click preparation/recheck button is available in the studio.

Reviewed source: https://github.com/Norbyte/bg3se/releases/tag/v33 (2026-10-12), fetched 2026-10-16. The official ZIP contains DWrite.dll and embeds SE v33 as an offline fallback. The official updater handles subsequent runtime updates on game launch. MODDOCK downloads the unmodified asset on demand; it does not bundle or execute it.

- ZIP SHA-256: edc6cf20d5ee4e2529390251fa5783cfd0f1f378650ecced3d5d7f39e6b47c8f
- DLL SHA-256: 69352751162bf7e2adcd6f8ba2eed38ab4a150a605926d2cc44eb650e188ec31
- Download redirects are limited to official GitHub asset hosts, over HTTPS, with a two-minute limit. Size, digest, exact ZIP entry and x64 PE headers must pass before publication.
- Game identity, a native x64 game executable, a stopped game and the selected directory are checked. Account/session permission and stopped-game checks repeat after the download and before the write.
- The DLL is staged beside the destination and published by a hard link without overwriting an existing file. A game filesystem without hard-link support fails with an error rather than falling back to overwriting.
- Existing x64 files matching the pinned digest or Norbyte/BG3 product markers are reused. This is file evidence, not proof of game loading; an unknown DWrite.dll or a symlink stops installation and is preserved.
- The verified download is cached in local app data. The shared component stays installed when a Mod is removed or native Mod restoration is requested, like other shared loaders. Player saves, ScriptExtenderSettings.json and existing modsettings.lsx are not changed by component preparation.

Windows loader execution, game compatibility, permissions on an actual protected install, antivirus behaviour and real-game effects require device acceptance. The automated checks cover actual official bytes and temporary game directories only.
