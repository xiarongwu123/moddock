# Unreal Engine

Prefer ue4ss-lua for script mechanics. The host can prepare the official runtime beside a uniquely identified Win64 Shipping executable, without a game-name allowlist. A matching directory or installed loader does not prove that UE4SS supports that game build.

search_api supplies documented UE4SS framework APIs; only matched game indexes or local SDK/source can establish game-specific reflected class/function names. Never copy ReadyOrNot paths into another game. PAK/IoStore data changes need matching cooked assets and packing/version evidence; arbitrary text named .pak is not a Mod. If the requested implementation needs missing SDK/cooked assets, preserve real work and identify the blocker accurately.

Delayed UObject access must run on the game thread and check object/world validity. Initialization logs only prove initialization. References: https://docs.ue4ss.com/dev/lua-api.html
