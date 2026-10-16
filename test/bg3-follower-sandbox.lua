-- Contract test for host-owned follower logic, not an emulation of the game engine.
local callback, latest, created, following, failName = nil, nil, 0, 0, false
local host, template = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
local entities = {}
local clock = 0
Ext = {
 Events = { SessionLoaded = { Subscribe = function(_, handler) callback = handler end } },
 IO = { SaveFile = function(_, text) latest = text end },
 Utils = { Print = function() end, PrintError = function() end },
 Timer = { MonotonicTime = function() clock = clock + 1; return clock end }
}
Osi = {
 GetHostCharacter = function() return host end,
 GetTemplate = function(target) assert(target == host); return template end,
 Exists = function(target) return entities[target] and 1 or 0 end,
 CreateAtObject = function(source, anchor, temporary, play, event, orientation)
  assert(source == template and anchor == host and temporary == 0 and play == 0 and event == "" and orientation == 1)
  created = created + 1
  local guid = "cccccccc-cccc-4ccc-8ccc-" .. string.format("%012d", created)
  entities[guid] = true; return guid
 end,
 SetStoryDisplayName = function(target, name)
  assert(entities[target] and type(name) == "string" and name ~= "")
  if failName then error("name application failed") end
 end,
 AddPartyFollower = function(target, leader) assert(entities[target] and leader == host); following = following + 1 end,
 OpenMessageBox = function(target, text) assert(target == host and type(text) == "string") end
}
dofile(arg[1])
assert(type(callback) == "function")
callback()
assert(created == 1 and following == 1 and PersistentVars.Ready and not string.find(latest, "ERROR", 1, true))
local first = PersistentVars.Companion
local firstLog = latest
callback()
assert(created == 1 and following == 1 and PersistentVars.Companion == first)
assert(latest ~= firstLog)
entities[first] = nil; failName = true
callback()
assert(created == 2 and following == 1 and not PersistentVars.Ready and string.find(latest, "ERROR", 1, true))
local pending = PersistentVars.Companion
failName = false; callback()
assert(created == 2 and following == 2 and PersistentVars.Ready and PersistentVars.Companion == pending)
assert(not string.find(latest, "ERROR", 1, true))
print("follower contract passed: no duplicates on reload; partial initialization retries the same actor; failures never log success")
