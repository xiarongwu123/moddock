# UE4SS runtime contract

## Object and interface lifetime

`StaticFindObject` can return a non-nil invalid object. `if fn`, `fn ~= nil` or `pcall` success alone is not availability evidence: check `fn:IsValid()`. Call an unbound validated UFunction with the live UObject context first. Do not assume every C++ method is reflected: e.g. an inline `GetMesh` getter may not be a UFunction; verify the reflected property or function instead.

Never treat `pcall` as protection from a native access violation. Do not retry a failing native call with shorter/longer arguments. Match FVector/FTransform/FHitResult/FName and out parameters to the actual UE4SS marshalling contract. Lua tables are supported for some structs, not universally interchangeable with every native struct. Optional diagnostics should use `print`; adding screen messages must not add an unverified native call to otherwise working gameplay.

Delayed work should retain primitive identity (object path, address plus session generation), reacquire a live object on execution, and compare its world to the **current local player's world**, not only its previous world. Old actors can remain valid during travel. Null/current-world loss, world change, object replacement or destroyed targets cancel the work. Never restore the previous world's objects, or toggle a new pawn in an attempt to restore the old pawn. Address alone does not prove identity when objects can be replaced.

## Thread and callback contract

Resolve loader capabilities before choosing scheduling. Prefer supported `ExecuteInGameThreadWithDelay(ms, callback)` / `LoopInGameThreadWithDelay(ms, callback)`; feature-detect them. They run on the game thread. If unavailable, do not start the feature with off-thread UObject access. Legacy `ExecuteWithDelay`/`LoopAsync` callbacks are worker-thread callbacks; only a supported dispatcher may cross into the game thread, with all engine reads/writes inside the dispatched body. A bridge is a compatibility path, not evidence that a loader threading bug is solved. Never touch UObjects in a failure handler that is still on a worker thread.

For `/Script/` RegisterHook calls, the second callback is PRE and the third is POST. Unwrap Context and argument `RemoteUnrealParam` values synchronously; do not retain the wrappers or borrowed struct/FName values after the hook. Store primitive snapshots if needed. Native functions must exist when registering hooks; bound retries and avoid duplicate registrations. Store both IDs if unregistering.

A health argument replacement belongs in the PRE hook when required. Physics, actor destruction and camera/world changes should not reenter the same native death/health transition. Queue them after the event chain and deduplicate per actor. Set the reentrancy state **before** a call that can trigger another hook; clear it on failure. Guard stale queued generations and rapid input. Do not use `os.clock()` as elapsed wall/game time for cooldowns.

## Camera, physics and coexistence

Inspect existing enabled scripts before creating another implementation for the same mechanic. Distinct filenames/keys do not imply compatibility. Prefer one native camera owner and a consistent state source. Never install a second permanent view-target loop just to defeat an existing camera Mod; reconcile the version or report the concrete overlap.

Use a game's native ragdoll/death lifecycle when supported. Manually enabling all mesh bodies/collision/blend weights can desynchronize it; if unavoidable, capture and restore the exact previous state and prove the correct order. Collision enum `1` means QueryOnly; QueryAndPhysics is `3`. QueryOnly is appropriate for queries, so do not blindly replace every `1` with `3`. Mark initialization before calling a potentially reentrant function. Limit actor tracking, timers, spawned effects and retries. Do not call a corpse-only effect on a living actor without evidence of its preconditions.

Verify audience and session checks; failure to establish team/player identity must not grant permission to modify protected roles. Keep a requested offline feature offline. Do not infer support for an arbitrary game from Ready or Not's SDK or from a UE4SS.dll being present.

## Observed Ready or Not regressions

Local evidence from 2026-10-18/19 includes native crashes in optional PrintString/FName paths and a MagCheck diagnostic action; a Lua `pcall` did not catch them. Do not add these as diagnostics. If an on-screen or magazine mechanic is the actual request, find a verified alternative or state the specific unresolved interface; do not silently remove the feature. This is game/build-specific evidence, not proof that these APIs crash every Unreal game.

The recent F3 camera and END native-camera implementations overlapped. Other defects included non-nil function checks, restoring a stale pawn during travel, direct death-hook physics mutation, retained callback data and a four-argument AddImpulse retry. These are regression examples, not proof of a unique cause for every UE4SS crash.

Sources: https://docs.ue4ss.com/dev/lua-api/classes/ufunction.html ; https://docs.ue4ss.com/dev/lua-api/global-functions/registerhook.html ; https://docs.ue4ss.com/dev/lua-api/global-functions/delayedactions.html
