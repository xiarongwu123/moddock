// Authorization URLs are parsed in memory only; never persist their key or full URL.
function parseNxm(value, now = Date.now()) {
 if(typeof value !== 'string'||value.length>4096||/[\x00-\x20]/.test(value))throw new Error('NXM 链接无效');
 let u;try{u=new URL(value);}catch{throw new Error('NXM 链接无效');}
 const m=u.pathname.match(/^\/mods\/([1-9]\d*)\/files\/([1-9]\d*)\/?$/);
 if(u.protocol!=='nxm:'||u.username||u.password||u.port||u.hash||!m||! /^[a-z0-9_-]+$/.test(u.hostname))throw new Error('只支持游戏 Mod 文件的 NXM 链接');
 for(const k of ['key','expires','user_id'])if(u.searchParams.getAll(k).length>1)throw new Error('NXM 授权参数重复');
 const key=u.searchParams.get('key'),expires=u.searchParams.get('expires'),userId=u.searchParams.get('user_id');
 if(!key||key.length>1024||/[\x00-\x20]/.test(key)||! /^\d{1,12}$/.test(expires||''))throw new Error('NXM 链接缺少文件授权 key / expires');
 if(Number(expires)*1000<=now)throw new Error('NXM 文件授权已过期，请重新点击站点下载按钮');
 if(userId&&!/^\d+$/.test(userId))throw new Error('NXM 账号参数无效');
 return {domain:u.hostname.toLowerCase(),modId:m[1],fileId:m[2],key,expires,userId:userId||null};
}
function authorizationPage(resourceId,fileId){const m=String(resourceId).match(/^nexus:([a-z0-9_-]+):([1-9]\d*)$/);if(!m||! /^[1-9]\d*$/.test(String(fileId)))throw new Error('Nexus 文件编号无效');return `https://www.nexusmods.com/${m[1]}/mods/${m[2]}?tab=files&file_id=${fileId}&nmm=1`;}
module.exports={parseNxm,authorizationPage};
