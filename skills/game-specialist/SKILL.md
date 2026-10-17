---
name: moddock-game-specialist
description: Apply the selected game's exact reference guide while honoring MODDOCK supported artifact kinds and verified engine evidence.
---
# Game specialist

Read the game-specific reference selected by the host using read_reference. Identify the game's mod loader, data formats, API evidence and deployment rules before authoring.

For Baldur's Gate 3, use search_api for Ext/Osiris signatures. The desktop owns PAK metadata, controls and Lua validation. Follow the supplied artifact schema; code must use the supported Moddock callbacks and avoid top-level gameplay calls before SessionLoaded.

For other games, distinguish data mods, runtime plugins and source projects. References may describe capabilities outside the desktop's installed adapters. The advertised kinds remain authoritative. Never convert an unsupported game's request into a different game's template.

The main Pi session may call run_agent to get a bounded specialist review. That specialist must read the selected references and report precise missing evidence. Return final host JSON with submit_result; do not include a fictional tool transcript.
