// Reviewed official distributions. Payloads are downloaded on demand, never supplied by AI.
const github = (repository, tag, name, size, sha256) => ({ repository, tag, name, size, sha256,
 url: `https://github.com/${repository}/releases/download/${tag}/${name}`,
 page: `https://github.com/${repository}/releases/tag/${tag}` });
const components = {
 'bepinex-il2cpp-x64': { name: 'BepInEx-Unity.IL2CPP-win-x64-6.0.0-be.788+5b766a3.zip', size: 34336405, sha256: 'f4cc496bd098a0df4164b81e3737297707f13a47c2478dba2f60eefab784817a', url: 'https://builds.bepinex.dev/projects/bepinex_be/788/BepInEx-Unity.IL2CPP-win-x64-6.0.0-be.788%2B5b766a3.zip', page: 'https://builds.bepinex.dev/projects/bepinex_be/788' },
 'bepinex-il2cpp-x86': { name: 'BepInEx-Unity.IL2CPP-win-x86-6.0.0-be.788+5b766a3.zip', size: 31440336, sha256: 'd5954a5993ec39cd1133603d85bff93875d30b6411b712cc13dcf03c8e08a4d3', url: 'https://builds.bepinex.dev/projects/bepinex_be/788/BepInEx-Unity.IL2CPP-win-x86-6.0.0-be.788%2B5b766a3.zip', page: 'https://builds.bepinex.dev/projects/bepinex_be/788' },
 'bepinex-x64': github('BepInEx/BepInEx', 'v5.4.23.5', 'BepInEx_win_x64_5.4.23.5.zip', 639118, '82f9878551030f54657792c0740d9d51a09500eeae1fba21106b0c441e6732c4'),
 'bepinex-x86': github('BepInEx/BepInEx', 'v5.4.23.5', 'BepInEx_win_x86_5.4.23.5.zip', 638544, '37651c79e40d6f909572a4f461ac25350bb3ef8fe7fbd29f1aa8791a33b84c82'),
 ue4ss: github('UE4SS-RE/RE-UE4SS', 'experimental-latest', 'UE4SS_v3.0.1-1176-g1ba38db4.zip', 8741395, 'e615ee7a2c24344ea5aeef85183d6cfd550f4f6352225976679f9fefffd0b9a5'),
 'ue4ss-configs': github('UE4SS-RE/RE-UE4SS', 'experimental-latest', 'zCustomGameConfigs.zip', 420596, '6b496f53c5f0f46217b0b5e64670701bc72ed418fc912e7f9e6ef49c4f5e6948'),
 reframework: github('praydog/REFramework-nightly', 'nightly-01432-d052e8fd3fd41d0a1a33394fcf6e6c19be39b1ee', 'REFramework.zip', 13272178, '27376e1da177ddcde9c46b3541bdc6fa1ad54a11d0cab9f7782eff0481455e94'),
 smapi: github('Pathoschild/SMAPI', '4.5.2', 'SMAPI-4.5.2-installer.zip', 41889142, 'dd01ddca7b566bfe0d3b3d2d03833496abc56c53da976241f2ab443f5484acc4'),
};
const reGames = {
 '883710': ['Resident Evil 2', 're2.exe'], '952060': ['Resident Evil 3', 're3.exe'],
 '2050650': ['Resident Evil 4', 're4.exe'], '418370': ['Resident Evil 7', 're7.exe'],
 '1196590': ['Resident Evil Village', 're8.exe'], '601150': ['Devil May Cry 5', 'DevilMayCry5.exe'],
 '1446780': ['Monster Hunter Rise', 'MonsterHunterRise.exe'], '2246340': ['Monster Hunter Wilds', 'MonsterHunterWilds.exe'],
 '2054970': ["Dragon's Dogma 2", 'DD2.exe'], '1364780': ['Street Fighter 6', 'StreetFighter6.exe'],
};
module.exports = { components, reGames };
