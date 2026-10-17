# Ready or Not executable Mods

## Evidence

`search_api` reads 800+ reflected signatures extracted from the MIT SDK at:
https://github.com/Herkkomehtala/ReadyOrNot-Internal/tree/ef7c5642688bd265356e72a9a5f25e86d6a88150/RoN-Internal/SDK

Input file hashes, source lines and license are retained in
`vendor/ready-or-not-api/`. These are static reference signatures, not a test of
the user's installed game build. Ignore the upstream trainer, patching and
score-bypass implementation; MODDOCK uses only the reflected API index.

UE4SS Lua and hook semantics:
https://docs.ue4ss.com/dev/lua-api.html
https://docs.ue4ss.com/dev/lua-api/global-functions/registerhook.html
https://docs.ue4ss.com/dev/lua-api/global-functions/executeingamethread.html

Independent Ready or Not modder evidence for the current loader layout:
https://github.com/RGB-Outl4w/ArmedUpNReady
https://github.com/Nokama0/ReadyOrNot-MissionObjectiveCounter/blob/main/UE4SS-NOTES.md

## Loader and package

The registered executable is
`ReadyOrNot/Binaries/Win64/ReadyOrNotSteam-Win64-Shipping.exe`; another shipping
name may be selected only when the host observes it as the unique candidate.
The pinned experimental loader layout is `Win64/dwmapi.dll` and
`Win64/ue4ss/UE4SS.dll`, using the release's own UE4SS-settings.ini.
Do not use Wukong's custom configuration. A Mod is
`ue4ss/Mods/<UniqueID>/Scripts/main.lua` plus `enabled.txt`.

UE4SS embeds Lua 5.4. Use the registered project compiler; it compiles without
running the gameplay source. `validate_project` passing is a static check, so
the final description must not say the game was launched or the effect proved.

## Suspect knockdown and return to combat

Search the signatures before implementing. The public SDK contains
`ReadyOrNotCharacter:DecreaseHealth(float Amount)`, `IncreaseHealth(float Amount)`,
`GetCurrentHealth()`, `GetMaxHealth()`, `GetHealthComponent()`, `IsArrested()`,
`IsCivilian()`, `IsOnSWATTeam()`, `IsDeadOrUnconscious()`;
`CyberneticCharacter:PlayDead(float Duration, bool bPlayVO)`,
`StopPlayingDead()`, `IsPlayingDead()` and `DrawWeapon()`.
`SuspectCharacter` derives from `CyberneticCharacter`.

For the visible effect of an enemy falling and standing back up after 3-4
seconds, the game's existing PlayDead/get-up flow is a candidate. Intercept a
lethal/incapacitating health reduction before irreversible death, retain a
positive health amount, play the timed fall and resume the original suspect.
Do not pretend a truly dead character can be revived merely by increasing HP.
Explain this approach accurately in the Mod description if used.

Native hook parameters are RemoteUnrealParam values: `.get()` reads and `.set()`
replaces an argument; use a pre-hook to alter the amount before original logic.
Re-entrancy, additional shots during the fall, invalid actors, arrest, mission
changes and unsupported signatures must be handled. Never affect players,
SWAT, civilians or hostages. Use a standalone-world guard if offline-only was
requested. The current game's actual call path remains a real-game test item.

`ExecuteWithDelay` alone runs on a UE4SS thread. Delayed UObject access must
use `ExecuteInGameThreadWithDelay(ms, callback)` when available, or compose
`ExecuteWithDelay(ms, function() ExecuteInGameThread(callback) end)`.
If neither marshaller is available, leave damage unchanged and report the
unsupported runtime. Never call reflected methods from a raw delay callback.

## Defensive implementation checks

A previous world and its actors can remain valid during travel. A delayed
callback must compare both the actor's world and the current player world from
`UEHelpers.GetWorld()` with the captured world. Checking only the actor's old
world address does not detect mission changes.

Probe every required UFunction before rewriting any damage. If PlayDead,
get-up, weapon drawing or a required role/health check is absent, leave native
damage unchanged and report the specific missing function once. If the fall
or scheduling fails after a pre-hook already clamped damage, clear protection
and restore the remaining original damage through DecreaseHealth using a
reentrancy bypass. Never swallow a fall error and grant free invulnerability.
An off-thread marshalling error may clear Lua protection state and log, but
must not touch UObjects. Check arrest/death before applying pending protection.
