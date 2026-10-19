---
name: moddock-stardew
description: Create Stardew Valley dialogue and texture content using MODDOCK supported SMAPI and Content Patcher recipes.
---
# Stardew Valley

Use inspect_game to confirm the actual SMAPI and Content Patcher evidence and supported host kinds. Read the supplied .NET/XNA engine guide.

The dialogue recipe changes one existing supported NPC's plain weekday strings. It does not create a new NPC, schedule or translation project. Follow the exact NPC list and string limits in the host schema.

The texture recipe uses a validated 16 by 16 palette or pixel image. Draw the requested object; do not substitute fixed placeholder art. The host encodes PNG and builds the content pack.

For a new gameplay mechanic requiring a C# SMAPI plugin, use an evidenced custom-project or project-plan unless the host explicitly advertises a matching executable adapter. Do not present a BepInEx plugin as a SMAPI mod. Confirm target version, content keys, asset names and dependencies before implementation.
