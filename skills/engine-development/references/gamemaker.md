# GameMaker

For engineEvidence.mode=gamemaker-gml the host has actually decompiled the VM code using pinned UndertaleModTool. Read documents with their exact entry names and complete-source SHA-256. Write one or more .gml files containing the full replacement implementation for those entries. Write mod.json {"mode":"gamemaker-gml","patches":[],"blockers":[],"targets":[{"source":"main.gml","entry":"EXACT_ENTRY_FROM_LOCAL_EVIDENCE","sha256":"ORIGINAL_DECOMPILED_SOURCE_SHA256"}]}. Each file must map to one existing complete entry. Preserve original behavior except for the requested change; check callers and object/event lifetimes. The host compiles entries together, rebuilds data.win, reads it back and creates a version-bound delta for transactional installation and restore. Compiler diagnostics return for repair. Never supply C# scripts, executable commands, arbitrary offsets or original game assets.

YYC has native machine code and cannot receive the VM workflow. A missing CODE section, unsupported data format or missing target evidence is a concrete blocker. Do not relabel GML source copying as a built Mod.

References: https://github.com/UnderminersTeam/UndertaleModTool
