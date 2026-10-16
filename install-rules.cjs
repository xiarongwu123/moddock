const reviewedAt = '2026-10-14';
const sources = Object.freeze({
 smapi: 'https://stardewvalleywiki.com/Modding:Player_Guide/Getting_Started',
 cyberpunk: 'https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-users/users-modding-cyberpunk-2077',
 hogwarts: 'https://github.com/Nexus-Mods/game-hogwartslegacy',
 readyornot: 'https://www.nexusmods.com/readyornot/articles/321',
 wukong: 'https://www.nexusmods.com/blackmythwukong/mods/1407?tab=posts',
 stellar: 'https://www.nexusmods.com/stellarblade/mods/232',
 tekken: 'https://www.nexusmods.com/site/mods/1833',
 skyrim: 'https://github.com/Nexus-Mods/vortex-games/blob/master/game-skyrimse/index.js',
 fallout: 'https://github.com/Nexus-Mods/vortex-games/blob/master/game-fallout4/index.js',
 bepinex: 'https://docs.bepinex.dev/master/articles/dev_guide/plugin_tutorial/2_plugin_start.html',
 patchers: 'https://docs.bepinex.dev/master/articles/dev_guide/preloader_patchers.html',
 melon: 'https://github.com/LavaGang/MelonLoader#readme',
});
const games = Object.freeze([
 { id:'stardewvalley', appId:'413150', name:'星露谷', type:'smapi', source:sources.smapi },
 { id:'cyberpunk2077', appId:'1091500', name:'赛博朋克 2077', type:'archive', directory:'archive/pc', executable:'bin/x64/Cyberpunk2077.exe', destination:'archive/pc/mod', source:sources.cyberpunk },
 { id:'hogwartslegacy', appId:'990080', name:'霍格沃茨之遗', type:'pak', directory:'Phoenix/Content/Paks', executable:'HogwartsLegacy.exe', destination:'Phoenix/Content/Paks/~mods', variants:['Phoenix/Content/Paks/~mods'], source:sources.hogwarts },
 { id:'readyornot', appId:'1144200', name:'严阵以待', type:'pak', directory:'ReadyOrNot/Content/Paks', destination:'ReadyOrNot/Content/Paks', variants:['ReadyOrNot/Content/Paks','ReadyOrNot/Content/Paks/~mods'], source:sources.readyornot },
 { id:'blackmythwukong', appId:'2358720', name:'黑神话：悟空', type:'pak', directory:'b1/Content/Paks', destination:'b1/Content/Paks/~mods', variants:['b1/Content/Paks/~mods','b1/Content/Paks/Mods'], source:sources.wukong, sources:[sources.wukong,'https://www.nexusmods.com/blackmythwukong/articles/64'] },
 { id:'stellarblade', appId:'3489700', name:'剑星', type:'pak', directory:'SB/Content/Paks', destination:'SB/Content/Paks/~mods', variants:['SB/Content/Paks/~mods','SB/Content/Paks'], source:sources.stellar, sources:[sources.stellar,'https://www.nexusmods.com/stellarblade/mods/2789?tab=files'] },
 { id:'tekken8', appId:'1778820', name:'铁拳 8', type:'pak', directory:'Polaris/Content/Paks', destination:'Polaris/Content/Paks/~mods', variants:['Polaris/Content/Paks/~mods','Polaris/Content/Paks/mods','Polaris/Content/Paks'], source:sources.tekken, sources:[sources.tekken,'https://www.nexusmods.com/tekken8/mods/319','https://www.nexusmods.com/tekken8/mods/39'] },
 { id:'skyrimspecialedition', appId:'489830', name:'上古卷轴 5 SE', type:'bethesda', source:sources.skyrim },
 { id:'fallout4', appId:'377160', name:'辐射 4', type:'bethesda', source:sources.fallout },
]);
function gameRule(game,domain) {
 const byApp=games.find(rule=>rule.appId===String(game.appId));
 if(byApp&&domain&&byApp.id!==domain)throw Object.assign(new Error('Nexus 游戏专区与本机游戏标识不一致'),{code:'AUTO_INSTALL_GAME_MISMATCH'});
 return byApp || games.find(rule=>rule.id===(domain||game.nexus));
}
function evidence(id,name,urls) { return {id,name,reviewedAt,sources:[...new Set(urls.filter(Boolean))]}; }
module.exports={games,sources,reviewedAt,gameRule,evidence};
