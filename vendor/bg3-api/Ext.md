# BG3 Script Extender interface facts

These signatures describe interoperability, not a running game. Sources:
https://github.com/Norbyte/bg3se/blob/main/Docs/API.md
https://github.com/Norbyte/bg3se/blob/main/BG3Extender/Lua/Client/ClientEvents.h
https://github.com/Norbyte/bg3se/blob/main/BG3Extender/Lua/Client/LuaClient.cpp
Checked 2026-10-15. User code must not perform file or network operations.

## Events
Ext.Events.SessionLoaded:Subscribe(function(event) ... end)
Session state and PersistentVars are ready at this event.
Ext.Events.Tick:Subscribe(function(event) ... end)
Server ticks are approximately 30 Hz; use a bounded timer for gameplay work.
Ext.Osiris.RegisterListener(name, arity, event, handler)
event is before, after, beforeDelete or afterDelete. Call the exact Osiris signature.

## Entities
Ext.Entity.Get(uuid)
Returns a current entity reference; components depend on game version and entity type.
Do not invent fields from another game or assume a nil component exists.

## Stats
Ext.Stats.GetStats(type)
Returns stat entry names. Types include Weapon, StatusData and SpellData.
Ext.Stats.Get(name, level, warnOnError)
Returns the named entry; missing entries must be checked.
Ext.Stats.Create(name, type, template)
Creates a new stat, optionally inheriting from an existing verified entry.
stat:Sync()
Synchronizes changes; writing an existing entry changes that shared entry.

## Templates
Ext.Template.GetRootTemplate(uuid)
Ext.Template.GetAllRootTemplates()
Use real game template UUIDs. Never invent a reference and claim it exists.

## Time and messages
Ext.Timer.MonotonicTime()
Returns monotonic milliseconds, for scheduling only.
Ext.Timer.WaitFor(milliseconds, callback)
Ext.Utils.Print(message)
Ext.Utils.PrintError(message)

## Host-provided Moddock controls
Moddock.Enabled
Moddock.Settings[key]
Moddock.Log(message)
Writes a diagnostic through Ext.Utils.Print.
Moddock.Now()
Returns monotonic milliseconds from Ext.Timer.MonotonicTime.
Moddock.OnSettingsChanged = function(settings, enabled) ... end
Called on session load and settings updates. Undo reversible changes when disabled.
Moddock.OnAction = function(key, settings) ... end
Called for an allowed action button or local function key while enabled.
Moddock.Every(milliseconds, function(settings) ... end)
Runs after session load while enabled. Minimum interval is 100 ms.
The desktop owns transport, input bindings and logging. Do not call Ext.IO or Ext.Net.
Settings persistence is owned by the desktop; do not invent a mod UUID for Ext.Vars.
For health thresholds, calculate Osi.GetHitpoints(host) / Osi.GetMaxHitpoints(host)
after checking maximum HP is positive. This avoids guessing the scale of a percentage API.
