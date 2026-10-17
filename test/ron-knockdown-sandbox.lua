local source = assert(arg[1], "pass an actual generated main.lua")
local function scenario(mode)
 local now, queue, hooks, notifications, logs, thread, serial = 0, {}, {}, {}, {}, true, 100
 local classes = {}
 local function object(name)
  serial = serial + 1
  local obj = { valid = true, address = serial, name = name }
  function obj:IsValid() return self.valid end
  function obj:GetAddress() return self.address end
  function obj:GetFullName() return self.name end
  function obj:GetClass() return classes[self.class] end
  function obj:IsA(class) return self.class == (type(class) == 'string' and class or class.name) or (class.name == '/Script/ReadyOrNot.ReadyOrNotCharacter' and self.health ~= nil) end
  return obj
 end
 for _, name in ipairs({'SuspectCharacter','ReadyOrNotCharacter','CyberneticCharacter','CivilianCharacter','SWATCharacter','PlayerCharacter'}) do classes['/Script/ReadyOrNot.' .. name] = object('/Script/ReadyOrNot.' .. name) end
 local functions = {}
 for _, name in ipairs({'DecreaseHealth','IncreaseHealth','GetCurrentHealth','GetMaxHealth','GetHealthComponent','IsArrested','IsDeadOrUnconscious','IsCivilian','IsOnSWATTeam','IsIncapacitated','IsGettingUp'}) do functions['/Script/ReadyOrNot.ReadyOrNotCharacter:' .. name] = object(name) end
 for _, name in ipairs({'PlayDead','StopPlayingDead','IsPlayingDead','DrawWeapon'}) do functions['/Script/ReadyOrNot.CyberneticCharacter:' .. name] = object(name) end
 functions['/Script/Engine.KismetSystemLibrary:IsStandalone'] = object('IsStandalone')
 local world = object('World /Game/Mission_1'); world.standalone = mode ~= 'coop'
 local currentWorld = world
 local gm = object('GameMode /Game/Mission_1.GM'); world.AuthorityGameMode = gm
 local library = object('KismetSystemLibrary'); function library:IsStandalone(w) assert(thread, 'off-thread world query'); return w.standalone end
 local function schedule(delay, fn, onGameThread) queue[#queue + 1] = {at = now + delay, fn = fn, game = onGameThread} end
 local function advance(ms)
  local target, iterations = now + ms, 0
  while true do
   table.sort(queue, function(a,b) return a.at < b.at end)
   local next = queue[1]; if not next or next.at > target then break end
   table.remove(queue, 1); now = next.at; thread = next.game
   iterations = iterations + 1; assert(iterations < 1000, 'unbounded scheduler loop')
   next.fn(); thread = true
  end
  now = target
 end
 local invalid = {IsValid = function() return false end}
 local env = {assert=assert, error=error, pcall=pcall, xpcall=xpcall, pairs=pairs, ipairs=ipairs, next=next, select=select, tonumber=tonumber, tostring=tostring, type=type, math=math, string=string, table=table, setmetatable=setmetatable, getmetatable=getmetatable}
 env._G = env
 env.print = function(text) logs[#logs + 1] = tostring(text) end
 env.StaticFindObject = function(name)
  if mode == 'missing' and name == '/Script/ReadyOrNot.CyberneticCharacter:PlayDead' then return invalid end
  return classes[name] or functions[name] or (name == '/Script/Engine.Default__KismetSystemLibrary' and library) or invalid
 end
 env.FindFirstOf = function(name) if name == 'World' then return currentWorld end return invalid end
 env.CreateInvalidObject = function() return invalid end
 env.RegisterHook = function(name, pre, post) assert(functions[name], 'unverified hook ' .. name); hooks[name] = {pre = pre, post = post}; return 1,2 end
 env.UnregisterHook = function(name) hooks[name] = nil end
 env.NotifyOnNewObject = function(name, fn) notifications[#notifications+1] = {class=name, fn=fn} end
 env.ExecuteInGameThread = function(fn) if mode == 'scheduler-failure' or mode == 'marshal-failure' and not thread then error('scheduler fault') end schedule(0, fn, true) end
 env.ExecuteWithDelay = function(ms, fn) if mode == 'scheduler-failure' then error('scheduler fault') end schedule(ms, fn, false) end
 if mode ~= 'composed' and mode ~= 'marshal-failure' then env.ExecuteInGameThreadWithDelay = function(ms, fn) if mode == 'scheduler-failure' then error('scheduler fault') end schedule(ms, fn, true) end end
 if mode == 'no-scheduler' then env.ExecuteInGameThreadWithDelay=nil; env.ExecuteInGameThread=nil; env.ExecuteWithDelay=nil end
 env.LoopAsync = function(ms, fn) local tick; tick = function() if fn() == false then schedule(ms, tick, false) end end; schedule(ms, tick, false) end
 env.IsInGameThread = function() return thread end
 env.require = function(name)
  assert(name == 'UEHelpers', 'unexpected module ' .. name)
  return {GetKismetSystemLibrary=function() return library end, GetWorld=function() return currentWorld end, GetGameModeBase=function() return currentWorld.AuthorityGameMode end}
 end
 assert(loadfile(source, 't', env))(); advance(0)
 local damage
 local function actor(kind)
  local a = object(kind .. ' /Game/Mission_1.Actor' .. serial); a.class = '/Script/ReadyOrNot.' .. kind; a.world = world; a.health = 100; a.max = 100; a.draws = 0; a.playing = false
  function a:GetWorld() assert(thread, 'off-thread GetWorld'); return self.world end
  function a:GetCurrentHealth() assert(thread, 'off-thread health read'); return self.health end
  function a:GetMaxHealth() return self.max end
  function a:IncreaseHealth(amount) assert(thread, 'off-thread heal'); self.health = math.min(self.max, self.health + amount) end
  function a:DecreaseHealth(amount) assert(thread, 'off-thread damage'); return damage(self, amount) end
  function a:IsArrested() return self.arrested or false end
  function a:IsCivilian() return kind == 'CivilianCharacter' end
  function a:IsOnSWATTeam() return kind == 'SWATCharacter' end
  function a:IsDeadOrUnconscious() return self.dead or self.unconscious or false end
  function a:IsIncapacitated() return self.unconscious or false end
  function a:IsGettingUp() return false end
  function a:IsPlayingDead() return self.playing end
  function a:PlayDead(duration) assert(thread, 'off-thread PlayDead'); if mode == 'fall-failure' then error('PlayDead rejected') end self.playing = true; self.fallDuration = duration end
  function a:StopPlayingDead() assert(thread, 'off-thread get-up'); self.playing = false end
  function a:DrawWeapon() assert(thread, 'off-thread draw'); assert(not self.arrested and self.valid, 'invalid actor resumed'); self.draws = self.draws + 1 end
  local hc = object('Health'); function hc:GetCurrentResource() return a.health end; function hc:GetMaxResource() return a.max end; function hc:SetResource(n) a.health=n end
  function a:GetHealthComponent() return hc end
  for _, n in ipairs(notifications) do if n.class == a.class then n.fn(a) end end
  advance(0); return a
 end
 local function param(value) return {get=function() return value end, set=function(_,v) value=v end} end
 damage = function(a, amount)
  local hook, context, remote = hooks['/Script/ReadyOrNot.ReadyOrNotCharacter:DecreaseHealth'], param(a), param(amount)
  if hook and hook.pre then hook.pre(context, remote) end
  a.health = a.health - remote:get(); if a.health <= 0 then a.dead = true end
  if hook and hook.post then hook.post(context, remote) end
  advance(0); return remote:get()
 end
 return {actor=actor, damage=damage, advance=advance, logs=logs, changeMission=function(noWorld) if noWorld then currentWorld=nil else currentWorld=object('World /Game/Mission_2'); currentWorld.standalone=true end end}
end

debug.sethook(function() error('sandbox instruction budget exceeded') end, '', 5000000)
for _, mode in ipairs({'native','composed'}) do
 local x = scenario(mode)
 for _, kind in ipairs({'CivilianCharacter','SWATCharacter','PlayerCharacter'}) do local a=x.actor(kind); assert(x.damage(a,110)==110 and not a.playing, mode .. ': affected ' .. kind) end
 local healthy=x.actor('SuspectCharacter'); assert(x.damage(healthy,10)==10 and not healthy.playing, 'nonlethal damage was changed')
 local corpse=x.actor('SuspectCharacter'); corpse.health=0; corpse.dead=true; assert(x.damage(corpse,10)==10 and not corpse.playing, 'corpse was modified')
 local unconscious=x.actor('SuspectCharacter'); unconscious.unconscious=true; assert(x.damage(unconscious,110)==110 and not unconscious.playing, 'incapacitated actor was modified')
 local a=x.actor('SuspectCharacter'); x.damage(a,110); assert(a.health>0 and a.playing and a.fallDuration==3.5, mode .. ': lethal suspect did not enter timed fall')
 x.damage(a,1000); assert(a.health>0 and not a.dead, 'additional damage killed pending suspect')
 x.advance(3499); assert(a.playing and a.draws==0, 'resumed too early'); x.advance(1); assert(not a.playing and a.draws==1 and a.health>0, mode .. ': did not resume after 3.5 seconds')
 x.damage(a,1000); assert(a.dead, 'suspect revived more than once')
 local arrested=x.actor('SuspectCharacter'); x.damage(arrested,110); arrested.arrested=true; x.advance(3500); assert(arrested.draws==0, 'arrested suspect resumed combat')
 local gone=x.actor('SuspectCharacter'); x.damage(gone,110); gone.valid=false; x.advance(3500); assert(gone.draws==0, 'invalid actor resumed')
 local old=x.actor('SuspectCharacter'); x.damage(old,110); x.changeMission(); x.advance(3500); assert(old.draws==0, 'old mission actor resumed')
end
local coop=scenario('coop'); local online=coop.actor('SuspectCharacter'); assert(coop.damage(online,110)==110 and not online.playing, 'co-op damage was modified')
local missing=scenario('missing'); local unsupported=missing.actor('SuspectCharacter'); assert(missing.damage(unsupported,110)==110 and not unsupported.playing, 'missing API still changed damage')
local failed=scenario('fall-failure'); local cannotFall=failed.actor('SuspectCharacter'); failed.damage(cannotFall,110); assert(cannotFall.dead, 'PlayDead failure made suspect invulnerable')
local scheduler=scenario('scheduler-failure'); local cannotSchedule=scheduler.actor('SuspectCharacter'); scheduler.damage(cannotSchedule,110); assert(cannotSchedule.dead, 'scheduler failure granted free survival')
local marshaller=scenario('marshal-failure'); local cannotMarshal=marshaller.actor('SuspectCharacter'); local otherPending=marshaller.actor('SuspectCharacter'); marshaller.damage(cannotMarshal,110); marshaller.damage(otherPending,110); marshaller.advance(3500); marshaller.damage(cannotMarshal,1000); marshaller.damage(otherPending,1000); assert(cannotMarshal.dead and cannotMarshal.draws==0 and otherPending.dead and otherPending.draws==0, 'marshaller failure kept permanent protection')
local unavailable=scenario('no-scheduler'); local untouched=unavailable.actor('SuspectCharacter'); assert(unavailable.damage(untouched,110)==110, 'missing marshaller still changed damage')
local travelling=scenario('native'); local previous=travelling.actor('SuspectCharacter'); travelling.damage(previous,110); travelling.changeMission(true); travelling.advance(3500); assert(previous.draws==0, 'actor resumed with no current player world')
print('Ready or Not logic sandbox passed: offline scope, exclusions, delay, repeat damage, single revival, arrest, invalid actors, mission change, missing API, failed fall; real game unverified.')
