const SHORTCUTS = ['F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'];
function validateControls(input = []) {
 if (!Array.isArray(input) || input.length > 8) throw new Error('Mod 参数最多 8 项');
 const seen = new Set(), shortcuts = new Set();
 return input.map(control => {
  if (!control || !/^[a-z][a-zA-Z0-9_]{0,31}$/.test(control.key || '') || seen.has(control.key) || !['boolean', 'number', 'action'].includes(control.type) || typeof control.label !== 'string' || !control.label.trim() || control.label.length > 40) throw new Error('Mod 参数名称或类型无效');
  seen.add(control.key);
  const result = { key: control.key, label: control.label.trim(), type: control.type };
  if (control.type === 'boolean') { if (typeof control.default !== 'boolean') throw new Error('开关默认值无效'); result.default = control.default; }
  if (control.type === 'number') {
   const { min, max, step, default: value } = control;
   if (![min, max, step, value].every(Number.isFinite) || min < -100000 || max > 100000 || max <= min || step <= 0 || step > max - min || (max - min) / step > 10000 || value < min || value > max) throw new Error('数值参数范围无效');
   Object.assign(result, { min, max, step, default: value });
  }
  if (control.shortcut !== undefined) {
   if (control.type !== 'action' || !SHORTCUTS.includes(control.shortcut) || shortcuts.has(control.shortcut)) throw new Error('快捷键需为不重复的 F6 至 F12');
   result.shortcut = control.shortcut; shortcuts.add(control.shortcut);
  }
  return result;
 });
}
function valuesFor(controls, input) {
 if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !controls.some(control => control.key === key && control.type !== 'action'))) throw new Error('Mod 参数无效');
 return Object.fromEntries(controls.filter(control => control.type !== 'action').map(control => {
  const value = Object.hasOwn(input, control.key) ? input[control.key] : control.default;
  if (control.type === 'boolean' ? typeof value !== 'boolean' : !Number.isFinite(value) || value < control.min || value > control.max || Math.abs((value - control.min) / control.step - Math.round((value - control.min) / control.step)) > 0.00001) throw new Error('Mod 参数超出允许范围：' + control.label);
  return [control.key, value];
 }));
}
function controlsRuntime(id, controls) {
 const root = `Moddock/${id}`, defaults = Object.fromEntries(controls.filter(control => control.type !== 'action').map(control => [control.key, control.default]));
 const schema = JSON.stringify(controls), initial = JSON.stringify({ enabled: true, values: defaults });
 const server = `local schema = Ext.Json.Parse(${JSON.stringify(schema)})
local initial = Ext.Json.Parse(${JSON.stringify(initial)})
local root = ${JSON.stringify(root)}
local ready, lastConfig, lastInput, nextPoll, currentRevision = false, nil, nil, 0, "default"
Moddock = { Enabled = true, Settings = initial.values }
function Moddock.Log(message) Ext.Utils.Print("[Moddock] " .. tostring(message)) end
function Moddock.Now() return Ext.Timer.MonotonicTime() end
local function read(name)
 local ok, data = pcall(Ext.IO.LoadFile, root .. "/" .. name .. ".json")
 if not ok or type(data) ~= "string" or #data > 16384 then return nil end
 local parsed, value = pcall(Ext.Json.Parse, data)
 return parsed and type(value) == "table" and value or nil
end
local function write(name, value)
 Ext.IO.SaveFile(root .. "/" .. name .. ".json", Ext.Json.Stringify(value))
end
local function apply()
 local config = read("settings") or initial
 currentRevision = config.revision or "default"
 if type(config.enabled) ~= "boolean" or type(config.values) ~= "table" then error("Invalid Mod settings") end
 local values = {}
 for _, c in ipairs(schema) do
  if c.type ~= "action" then
   local value = config.values[c.key]
   if value == nil then value = c.default end
   if c.type == "boolean" and type(value) ~= "boolean" then error("Invalid boolean setting") end
   if c.type == "number" and (type(value) ~= "number" or value ~= value or value < c.min or value > c.max or math.abs((value - c.min) / c.step - math.floor((value - c.min) / c.step + 0.5)) > 0.00001) then error("Invalid numeric setting") end
   values[c.key] = value
  end
 end
 local serialized = Ext.Json.Stringify({ enabled = config.enabled, values = values, revision = currentRevision })
 if serialized == lastConfig then return end
 Moddock.Enabled, Moddock.Settings = config.enabled, values
 lastConfig = serialized
 if Moddock.OnSettingsChanged then Moddock.OnSettingsChanged(values, config.enabled) end
 write("state", { enabled = Moddock.Enabled, values = values, revision = config.revision or "default", status = "applied" })
end
function Moddock.Every(ms, callback)
 assert(type(ms) == "number" and ms >= 100 and ms <= 60000 and type(callback) == "function")
 local nextRun = 0
 Ext.Events.Tick:Subscribe(function()
  if not ready or not Moddock.Enabled then return end
  local now = Ext.Timer.MonotonicTime()
  if now < nextRun then return end
  nextRun = now + ms
  local ok, err = pcall(callback, Moddock.Settings)
  if not ok then Moddock.Enabled = false; write("state", { status = "error", error = tostring(err), enabled = false, revision = currentRevision }) end
 end)
end
local function poll()
 apply()
 local input = read("input")
 if not input or type(input.nonce) ~= "string" or #input.nonce > 100 or input.nonce == lastInput then return end
 lastInput = input.nonce
 local known = false
 for _, c in ipairs(schema) do if c.type == "action" and c.key == input.action then known = true end end
 local ok, err = pcall(function()
  if not known or not Moddock.Enabled or type(Moddock.OnAction) ~= "function" then error("Action is unavailable") end
  Moddock.OnAction(input.action, Moddock.Settings)
 end)
 write("ack", { nonce = input.nonce, status = ok and "applied" or "error", error = ok and "" or tostring(err) })
end
Ext.Events.SessionLoaded:Subscribe(function()
 local input = read("input"); lastInput = input and input.nonce or nil
 ready = true; lastConfig = nil
 local ok, err = pcall(apply)
 if not ok then Moddock.Enabled = false; write("state", { status = "error", error = tostring(err), enabled = false, revision = currentRevision }) end
end)
Ext.Events.Tick:Subscribe(function()
 local now = Ext.Timer.MonotonicTime()
 if not ready or now < nextPoll then return end
 nextPoll = now + 300
 local ok, err = pcall(poll)
 if not ok then Moddock.Enabled = false; write("state", { status = "error", error = tostring(err), enabled = false, revision = currentRevision }) end
end)
`;
 const client = `local schema = Ext.Json.Parse(${JSON.stringify(schema)})
local root = ${JSON.stringify(root)}
local serial = 0
Ext.Events.KeyInput:Subscribe(function(event)
 if not event.Pressed then return end
 local ok, text = pcall(Ext.IO.LoadFile, root .. "/settings.json")
 if ok and type(text) == "string" and #text <= 16384 then
  local parsed, settings = pcall(Ext.Json.Parse, text)
  if parsed and type(settings) == "table" and settings.enabled == false then return end
 end
 for _, c in ipairs(schema) do
  if c.type == "action" and c.shortcut and tostring(event.Key) == c.shortcut then
   if event.CanPreventAction then event:PreventAction() end
   if event.Repeat then return end
   serial = serial + 1
   Ext.IO.SaveFile(root .. "/input.json", Ext.Json.Stringify({ nonce = "key:" .. tostring(Ext.Timer.MonotonicTime()) .. ":" .. tostring(serial), action = c.key }))
   return
  end
 end
end)
`;
 return { server, client, control: { root: 'Script Extender/' + root, schema: controls, defaults } };
}
module.exports = { SHORTCUTS, validateControls, valuesFor, controlsRuntime };
