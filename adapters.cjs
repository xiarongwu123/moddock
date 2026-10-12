// Explicit install recipes: package recognition is a suggestion, never permission to deploy.
const recipes=[
 {id:'smapi',name:'星露谷 · SMAPI',mode:'smapi',destination:'Mods',requires:['StardewModdingAPI.dll']},
 {id:'cyber-archive',name:'赛博朋克 · 纯 archive',mode:'archive',destination:'archive/pc/mod',requires:['bin/x64/Cyberpunk2077.exe'],executable:'bin/x64/Cyberpunk2077.exe'},
 {id:'skyrim-data',name:'上古卷轴 5 SE · Data 包',mode:'bethesda',destination:'Data',requires:['SkyrimSE.exe'],executable:'SkyrimSE.exe'},
 {id:'fallout4-data',name:'辐射 4 · Data 包',mode:'bethesda',destination:'Data',requires:['Fallout4.exe'],executable:'Fallout4.exe'},
 {id:'hogwarts-pak',name:'霍格沃茨之遗 · 纯 pak',mode:'pak',destination:'Phoenix/Content/Paks/~mods'},
 {id:'wukong-pak',name:'黑神话：悟空 · 纯 pak',mode:'pak',destination:'b1/Content/Paks/~mods'},
 {id:'stellar-pak',name:'剑星 · 纯 pak',mode:'pak',destination:'SB/Content/Paks/~mods'},
 {id:'tekken-pak',name:'铁拳 8 · 纯 pak',mode:'pak',destination:'Polaris/Content/Paks/~mods'},
 {id:'bepinex',name:'Unity · BepInEx 插件目录',mode:'bepinex',destination:'BepInEx/plugins',requires:['BepInEx/core/BepInEx.dll']},
 {id:'melon',name:'Unity · MelonLoader Mods（Windows）',mode:'copy',destination:'Mods',requires:['version.dll','dobby.dll']},
 {id:'unreal',name:'Unreal · 纯 pak（需填写游戏内容目录）',mode:'pak',destination:'Content/Paks/~mods'},
 {id:'copy',name:'通用 · 按作者目录映射',mode:'copy',destination:''}
];
const presetIds={'413150':'smapi','1091500':'cyber-archive','489830':'skyrim-data','377160':'fallout4-data','990080':'hogwarts-pak','2358720':'wukong-pak','3489700':'stellar-pak','1778820':'tekken-pak','892970':'bepinex','1966720':'bepinex','632360':'bepinex'};
function defaultRecipe(game){return recipes.find(r=>r.id===presetIds[String(game.appId)]);}
function suggestions(game,files){const names=files.map(f=>f.path.replace(/\\/g,'/'));const known=defaultRecipe(game);const ids=new Set();if(known)ids.add(known.id);if(names.some(n=>/(^|\/)manifest\.json$/i.test(n)))ids.add('smapi');if(names.some(n=>/\.archive$/i.test(n)))ids.add('cyber-archive');if(names.some(n=>/\.(pak|utoc|ucas)$/i.test(n)))ids.add(known?.mode==='pak'?known.id:'unreal');if(names.some(n=>/(^|\/)BepInEx\/plugins\//i.test(n)))ids.add('bepinex');if(names.some(n=>/\.(esp|esm|esl|bsa|ba2)$/i.test(n)))ids.add(known?.mode==='bethesda'?known.id:'skyrim-data');ids.add('copy');return recipes.filter(r=>ids.has(r.id)).map(r=>({...r,reason:r===known?'根据游戏安装记录推荐，仍需核对包类型':'根据包内文件格式推荐，需核对游戏与前置',sourcePrefix:r.mode==='bethesda'&&names.some(n=>n.startsWith('Data/'))?'Data':r.mode==='bepinex'&&names.some(n=>n.startsWith('BepInEx/plugins/'))?'BepInEx/plugins':''}));}
module.exports={recipes,defaultRecipe,suggestions};
