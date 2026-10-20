# UE4SS Lua interface facts

These framework APIs are independently documented, and search_api also indexes
them. Do not search the game's C++ SDK for UE4SS globals. The API index JSON is
accessed through search_api; no vendor/ready-or-not-api/README.md exists.

- UObject methods: obj:IsValid(), obj:IsA(fullClassPath or UClass),
  obj:GetWorld(), obj:GetAddress(), obj:GetFullName(), obj:GetClass().
- StaticFindObject(fullObjectPath) resolves a class, function or class default.
  FindFirstOf(shortClassName) resolves a non-default instance only.
- RegisterHook('/Script/ReadyOrNot.ReadyOrNotCharacter:DecreaseHealth', pre, post)
  uses a pre-hook followed by original logic and an optional post-hook. Context
  and arguments are RemoteUnrealParam wrappers. Context:get() reads the actor;
  Amount:get() reads the float and Amount:set(value) replaces it before damage.
  The UFunction must exist before hook registration. Catch registration errors,
  keep retries bounded if waiting for game classes, and report incompatibility.
  Remove it with `UnregisterHook(fullFunctionPath, preId, postId)` in one call.
- Prefer supported ExecuteInGameThreadWithDelay / LoopInGameThreadWithDelay;
  feature-detect them. ExecuteWithDelay runs on a worker thread. A supported
  ExecuteInGameThread bridge may be used for older loaders, with every UObject
  access inside its body; it does not prove the loader has no threading defects.
- StaticFindObject failure can return a non-nil invalid object: check IsValid().
  Read ../../ue4ss-runtime-safety/references/runtime-contract.md before coding.
- NotifyOnNewObject(fullClassPath, callback) receives the UObject directly,
  includes subclasses, and unregisters if the callback returns true.
- `local UEHelpers = require('UEHelpers')` is available from the pinned loader's
  shared Mods. `UEHelpers.GetKismetSystemLibrary()` returns the class default
  library; call `ksl:IsStandalone(world)` to enforce offline solo. Do not call
  FindFirstOf('KismetSystemLibrary') because default objects are excluded.

Sources:
https://docs.ue4ss.com/dev/lua-api/classes/uobject.html
https://docs.ue4ss.com/dev/lua-api/classes/remoteunrealparam.html
https://docs.ue4ss.com/dev/lua-api/global-functions/staticfindobject.html
https://docs.ue4ss.com/dev/lua-api/global-functions/findfirstof.html
https://docs.ue4ss.com/dev/lua-api/global-functions/registerhook.html
https://docs.ue4ss.com/dev/lua-api/global-functions/unregisterhook.html
https://docs.ue4ss.com/dev/lua-api/global-functions/executeingamethread.html
https://docs.ue4ss.com/dev/lua-api/global-functions/executewithdelay.html
https://docs.ue4ss.com/dev/lua-api/global-functions/notifyonnewobject.html
https://github.com/UE4SS-RE/RE-UE4SS/blob/1ba38db4/assets/Mods/shared/UEHelpers/UEHelpers.lua
