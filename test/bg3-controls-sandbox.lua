-- Host transport contract only; this is not BG3 runtime acceptance.
local sessions, ticks, keyHandler, storage, documents = {}, {}, nil, {}, {}
local clock, sequence, count, changed = 0, 0, 0, 0
local prevented = 0
local schema = {
 { key = "threshold", label = "Threshold", type = "number", min = 10, max = 90, step = 5, default = 40 },
 { key = "heal", label = "Heal", type = "action", shortcut = "F8" }
}
local function encode(value)
 if value.enabled ~= nil and value.values and not value.status then return tostring(value.enabled) .. ":" .. tostring(value.values.threshold) .. ":" .. tostring(value.revision) end
 sequence = sequence + 1; local id = "document:" .. sequence; documents[id] = value; return id
end
local function decode(value)
 if value:sub(1, 1) == "[" then return schema end
 if value:sub(1, 1) == "{" then return { enabled = true, values = { threshold = 40 } } end
 return assert(documents[value], "unknown test document")
end
Ext = {
 Json = { Parse = decode, Stringify = encode },
 IO = { LoadFile = function(name) return storage[name] end, SaveFile = function(name, value) storage[name] = value end },
 Timer = { MonotonicTime = function() return clock end },
 Utils = { Print = function() end, PrintError = function() end },
 Events = {
  SessionLoaded = { Subscribe = function(_, callback) sessions[#sessions + 1] = callback end },
  Tick = { Subscribe = function(_, callback) ticks[#ticks + 1] = callback end },
  KeyInput = { Subscribe = function(_, callback) keyHandler = callback end }
 }
}
local root = "Moddock/11111111-1111-4111-8111-111111111111/"
local function store(name, value)
 sequence = sequence + 1; local id = "document:" .. sequence; documents[id] = value; storage[root .. name .. ".json"] = id
end
local function read(name) return documents[storage[root .. name .. ".json"]] end
local function tick() clock = clock + 500; for _, callback in ipairs(ticks) do callback() end end
local function key(repeatKey)
 keyHandler({ Key = "F8", Pressed = true, Repeat = repeatKey, CanPreventAction = true, PreventAction = function() prevented = prevented + 1 end })
end
store("input", { nonce = "old", action = "heal" })
dofile(arg[1])
Moddock.OnSettingsChanged = function(settings, enabled) changed = changed + 1 end
Moddock.OnAction = function(key, settings) assert(key == "heal"); count = count + 1 end
Moddock.Every(500, function(settings) assert(settings.threshold == 40 or settings.threshold == 60) end)
dofile(arg[2])
tick(); assert(count == 0 and changed == 0)
for _, callback in ipairs(sessions) do callback() end
tick(); assert(count == 0 and changed == 1)
store("settings", { enabled = true, values = { threshold = 60 }, revision = "revision-1" })
tick(); assert(changed == 2 and read("state").revision == "revision-1")
key(false); tick()
assert(count == 1 and read("ack").status == "applied")
tick(); assert(count == 1)
key(true); tick(); assert(count == 1 and prevented == 2)
store("settings", { enabled = false, values = { threshold = 60 }, revision = "revision-2" }); tick()
key(false); tick(); assert(count == 1 and prevented == 2)
store("input", { nonce = "force-disabled", action = "heal" }); tick()
assert(count == 1 and read("ack").status == "error")
store("settings", { enabled = true, values = { threshold = 999 }, revision = "bad" }); tick()
assert(read("state").status == "error" and read("state").revision == "bad")
print("control contract passed: deferred initialization, settings bounds, acknowledgements, no replay, hotkeys and disabled actions")
