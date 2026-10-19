const crypto = require('node:crypto');
const nexusIndex = require('./nexus-games.json').games;
const sourceGames = [
  { id: 'stardew', name: '星露谷物语', searchName: 'Stardew Valley', appId: '413150', nexus: 'stardewvalley', banana: '5937', workshop: false },
  { id: 'cyberpunk', name: '赛博朋克 2077', searchName: 'Cyberpunk 2077', appId: '1091500', nexus: 'cyberpunk2077', workshop: false },
  { id: 'baldurs', name: '博德之门 3', searchName: "Baldur's Gate 3", appId: '1086940', nexus: 'baldursgate3', workshop: false },
  { id: 'elden', name: '艾尔登法环', searchName: 'Elden Ring', appId: '1245620', nexus: 'eldenring', workshop: false },
  { id: 'lethal', name: '致命公司', searchName: 'Lethal Company', appId: '1966720', nexus: 'lethalcompany', workshop: false },
  { id: 'wukong', name: '黑神话：悟空', searchName: 'Black Myth: Wukong', appId: '2358720', nexus: 'blackmythwukong', workshop: false },
  { id: 'valheim', name: '英灵神殿', searchName: 'Valheim', appId: '892970', nexus: 'valheim', workshop: false },
  { id: 'palworld', name: '幻兽帕鲁', searchName: 'Palworld', appId: '1623730', nexus: 'palworld', workshop: false },
  { id: 'rimworld', name: '环世界', searchName: 'RimWorld', appId: '294100', nexus: 'rimworld', workshop: true },
  { id: 'terraria', name: '泰拉瑞亚', searchName: 'Terraria', appId: '105600', nexus: 'terraria', workshop: true },
  { id: 'wallpaper', name: 'Wallpaper Engine', searchName: 'Wallpaper Engine', appId: '431960', workshop: true },
  { id: 'skyrim', name: '上古卷轴 5', searchName: 'Skyrim', appId: '72850', nexus: 'skyrim', workshop: true },
  { id: 'skyrimse', name: '上古卷轴 5 特别版', searchName: 'Skyrim Special Edition', appId: '489830', nexus: 'skyrimspecialedition', workshop: false },
  { id: 'fallout4', name: '辐射 4', searchName: 'Fallout 4', appId: '377160', nexus: 'fallout4' },
  { id: 'falloutnv', name: '辐射：新维加斯', searchName: 'Fallout New Vegas', appId: '22380', nexus: 'newvegas' },
  { id: 'witcher3', name: '巫师 3：狂猎', searchName: 'The Witcher 3', appId: '292030', nexus: 'witcher3' },
  { id: 'cs2', name: '反恐精英 2', searchName: 'Counter-Strike 2', appId: '730' },
  { id: 'l4d2', name: '求生之路 2', searchName: 'Left 4 Dead 2', appId: '550' },
  { id: 'hollowknight', name: '空洞骑士', searchName: 'Hollow Knight', appId: '367520' },
  { id: 'mhw', name: '怪物猎人：世界', searchName: 'Monster Hunter: World', appId: '582010' },
  { id: 'mhr', name: '怪物猎人：崛起', searchName: 'Monster Hunter Rise', appId: '1446780' },
  { id: 'drg', name: '深岩银河', searchName: 'Deep Rock Galactic', appId: '548430' },
  { id: 'bannerlord', name: '骑马与砍杀 2', searchName: 'Mount & Blade II: Bannerlord', appId: '261550' },
  { id: 'dontstarve', name: '饥荒联机版', searchName: "Don't Starve Together", appId: '322330', workshop: true }
];
const providers = [
  { id: 'nexus', name: 'Nexus Mods', short: 'N 网', color: '#efa855', icon: 'N', description: '角色、玩法与画质扩展', homepage: 'https://www.nexusmods.com/' },
  { id: 'banana', name: 'GameBanana', short: '香蕉网', color: '#ead867', icon: 'B', description: '外观、地图与社区创作', homepage: 'https://gamebanana.com/' },
  { id: 'workshop', name: 'Steam 创意工坊', short: '创意工坊', color: '#76b7ed', icon: 'S', description: '通过 Steam 订阅与更新', homepage: 'https://steamcommunity.com/workshop/' }
];
function safeUrl(value, allowed) { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && allowed.includes(u.hostname) ? u.href : null; } catch { return null; } }
function externalAllowed(value) {
  if (/^steam:\/\/url\/CommunityFilePage\/\d+$/.test(value)) return true;
  return !!safeUrl(value, ['www.nexusmods.com', 'nexusmods.com', 'gamebanana.com', 'steamcommunity.com', 'api-docs.nexusmods.com', 'github.com', 'docs.bepinex.dev', 'stardewvalleywiki.com', 'wiki.redmodding.org']);
}
function text(value) { return String(value || '').replace(/<[^>]*>/g, '').replace(/\[(?:\/?[a-z]+)(?:=[^\]]*)?\]/gi, '').replace(/\s+/g, ' ').trim().slice(0, 50000); }
function normalize(value) { return String(value || '').replace(/[™®©]/g, '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }
function bananaGameRecords(raw) {
  if (raw?._sErrorCode) {
    const code = String(raw._sErrorCode).replace(/[^a-z0-9_]/gi, '').slice(0, 80) || 'API_ERROR';
    const reason = typeof raw._sErrorMessage === 'string' ? text(raw._sErrorMessage).slice(0, 300) : '游戏索引服务暂不可用';
    throw Object.assign(new Error(`GameBanana：${reason}`), { code: `GAMEBANANA_${code}`, host: 'gamebanana.com' });
  }
  if (!Array.isArray(raw?._aRecords) || raw._aRecords.some(g => !g || !/^[1-9]\d*$/.test(String(g._idRow)) || typeof g._sName !== 'string' || !g._sName.trim() || (g._sModelName && g._sModelName !== 'Game'))) {
    throw Object.assign(new Error('GameBanana 游戏索引返回异常'), { code: 'INVALID_SCHEMA', host: 'gamebanana.com' });
  }
  return raw._aRecords;
}
function fileAccess(url, source) {
 if(downloadAllowed(url))return {available:true,downloadCode:'DIRECT_DOWNLOAD',downloadReason:'来源提供公开文件地址，可以在软件内下载'};
 if(url)return {available:false,downloadCode:'UNSUPPORTED_DOWNLOAD_ADDRESS',downloadReason:'来源返回的下载地址不在当前支持的 HTTPS 文件域名范围内；这不是账号授权问题'};
 return {available:false,downloadCode:source==='workshop'?'STEAM_CHANNEL_NOT_IMPLEMENTED':'NO_DOWNLOAD_ADDRESS',downloadReason:source==='workshop'?'此工坊文件没有公开直链。软件尚未接入 Steam 客户端下载通道，填写 Steam Web API Key 也不能解决此下载问题':'来源没有提供此文件的直接下载地址；这不是缺少 API Key'};
}
function sourceLinks(game, query = '') {
  const banana = new URL('https://gamebanana.com/search'); banana.searchParams.set('query', query || game.searchName || game.name);
  const workshop = new URL('https://steamcommunity.com/workshop/browse/'); if (game.appId) workshop.searchParams.set('appid', game.appId); if (query) workshop.searchParams.set('searchtext', query);
  return { nexus: game.nexus ? `https://www.nexusmods.com/games/${encodeURIComponent(game.nexus)}/mods` : 'https://www.nexusmods.com/games', banana: banana.href, workshop: workshop.href };
}
function normalizeNexus(raw, game) {
  return raw.map(m => {
    const url = safeUrl(m.mod_page_url || `https://www.nexusmods.com/${game.nexus}/mods/${m.mod_id}`, ['www.nexusmods.com']); if (!url) return null;
    const id = url.match(/\/mods\/(\d+)/)?.[1]; if (!id) return null;
    return { id: `nexus:${game.nexus}:${id}`, source: 'nexus', name: text(m.name), author: text(m.author || m.uploaded_by), summary: text(m.summary), url, image: safeUrl(m.picture_url, ['staticdelivery.nexusmods.com']), category: text(m.category || 'Mod'), version: m.version || null, metric: m.mod_downloads ?? null, metricLabel: '下载', updated: m.updatedAt || (m.updated_timestamp ? new Date(m.updated_timestamp * 1000).toISOString() : null), gameId: game.id, gameName: game.name, installable: false };
  }).filter(Boolean);
}
function normalizeBanana(raw, game, bananaId) {
  return raw.filter(m => (m._sModelName === 'Mod' || (!m._sModelName && /\/mods\/\d+/.test(m._sProfileUrl || ''))) && (!m._aGame?._idRow || String(m._aGame._idRow) === String(bananaId))).map(m => {
    const img = m._aPreviewMedia?._aImages?.[0]; const picture = img?._sUrl || (img?._sBaseUrl && `${img._sBaseUrl}/${img._sFile530 || img._sFile}`);
    const url = safeUrl(m._sProfileUrl, ['gamebanana.com']); if (!url || !/^\/mods\/\d+$/.test(new URL(url).pathname)) return null;
    return { id: `banana:${m._idRow}`, source: 'banana', name: text(m._sName), author: text(m._aSubmitter?._sName), summary: text(m._sDescription || `${m._aRootCategory?._sName || 'Mod'}${m._aSubCategory?._sName ? ' / ' + m._aSubCategory._sName : ''}`), url, image: safeUrl(picture, ['images.gamebanana.com']), category: text(m._aRootCategory?._sName || 'Mod'), version: m._sVersion || null, metric: m._nDownloadCount ?? m._nViewCount ?? null, metricLabel: m._nDownloadCount == null ? '浏览' : '下载', updated: m._tsDateModified ? new Date(m._tsDateModified * 1000).toISOString() : null, gameId: game.id, gameName: game.name, installable: false };
  }).filter(Boolean);
}
function normalizeWorkshop(raw, game) {
  return raw.filter(m => (!(m.consumer_app_id || m.consumer_appid) || String(m.consumer_app_id || m.consumer_appid) === String(game.appId)) && m.result !== 9 && m.file_type !== 1).map(m => {
    const id = String(m.publishedfileid || ''); if (!/^\d+$/.test(id)) return null;
    return { id: `workshop:${id}`, source: 'workshop', name: text(m.title), author: m.creator ? `Steam · ${m.creator}` : 'Steam 创作者', summary: text(m.short_description || m.description), url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`, steamUrl: `steam://url/CommunityFilePage/${id}`, image: safeUrl(m.preview_url, ['images.steamusercontent.com', 'steamuserimages-a.akamaihd.net', 'shared.akamai.steamstatic.com']), category: text(m.tags?.[0]?.tag || '创意工坊'), version: null, metric: m.subscriptions ?? null, metricLabel: '订阅', updated: m.time_updated ? new Date(m.time_updated * 1000).toISOString() : null, gameId: game.id, gameName: game.name, installable: false };
  }).filter(Boolean);
}
function parseWorkshopPage(html, game) {
  const embedded = html.match(/<script\b[^>]*\bid=["']valve-ssr-data["'][^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (embedded) {
    try {
      const state = JSON.parse(embedded);
      const queries = JSON.parse(state.renderContext.queryData).queries;
      const query = queries.find(q => q.queryKey?.[0] === 'workshop_browse' && String(q.queryKey[1]?.appid) === String(game.appId));
      const data = query?.state?.data;
      if (data?.eresult === 1 && Array.isArray(data.results)) return { items: normalizeWorkshop(data.results, game), rawCount: data.results.length, total: data.total_count, page: data.current_page, hasNext: data.current_page < data.total_pages };
    } catch { /* Older pages use the HTML cards below. */ }
  }
  const records = []; const blocks = html.split(/class=["']workshopItem["']/).slice(1);
  for (const block of blocks) {
    const id = block.match(/sharedfiles\/filedetails\/\?id=(\d+)/)?.[1]; const title = block.match(/class=["']workshopItemTitle["'][^>]*>([^<]+)/)?.[1]; const picture = block.match(/class=["']workshopItemPreviewImage["'][^>]*src=["']([^"']+)/)?.[1];
    if (id && title) records.push({ publishedfileid: id, title: title.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"), preview_url: picture });
  }
  const items = normalizeWorkshop(records, game);
  return { items, rawCount: records.length, total: null, hasNext: /(?:下一页|Next|&gt;|›)<\/a>/.test(html) || items.length >= 12 };
}
function parseWorkshopHtml(html, game) { return parseWorkshopPage(html, game).items; }
class Sources {
  constructor(options = {}) { this.fetch = options.fetch || globalThis.fetch; this.timeout = options.timeout || 10000; this.nexusPlatform = options.nexusPlatform; this.keys = { nexus: '', workshop: '' }; this.cache = new Map(); this.inflight = new Map(); this.gameIds = new Map(); this.identities = new Map(); this.matches = new Map(); }
  status() { return { nexusConnected: !!this.nexusPlatform || !!this.keys.nexus, nexusManaged: !!this.nexusPlatform, workshopConnected: !!this.keys.workshop }; }
  connect(source, key) {
    if (!['nexus', 'workshop'].includes(source) || typeof key !== 'string' || key.length > 2048 || /[\r\n]/.test(key)) throw new Error('无效的连接参数');
    if (source === 'workshop' && key && !/^[a-fA-F0-9]{32}$/.test(key.trim())) throw new Error('Steam Web API Key 应为 32 位十六进制字符');
    this.keys[source] = key.trim(); this.cache.clear(); return this.status();
  }
  async request(url, options = {}) {
    const { format, timeout = this.timeout, ...init } = options;
    const host = new URL(url).hostname;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.fetch(String(url), { ...init, redirect: 'error', signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': 'Moddock/' + require('./package.json').version, ...(host === 'api.nexusmods.com' ? { 'Application-Name': 'Moddock', 'Application-Version': require('./package.json').version } : {}), ...init.headers } });
        if (!response.ok) {
          const status = response.status;
          if (status >= 500 && attempt === 0) continue;
          const e = new Error(status === 401 || status === 403 ? '来源拒绝请求，请检查账号授权和接口权限' : status === 429 ? '来源请求过于频繁，请稍后重试' : status === 404 ? '来源未找到此游戏或资源' : `来源接口返回 HTTP ${status}`);
          e.code = `HTTP_${status}`; throw e;
        }
        const buffer = await response.text(); if (buffer.length > 5_000_000) throw Object.assign(new Error('来源响应过大'), { code: 'RESPONSE_SIZE' });
        if (format === 'html') return buffer;
        try { return JSON.parse(buffer); } catch { throw Object.assign(new Error('来源返回了无法解析的数据'), { code: 'INVALID_JSON' }); }
      } catch (e) {
        if (typeof e.code === 'string') { e.host = host; throw e; }
        const code = e.name === 'TimeoutError' || e.name === 'AbortError' ? 'TIMEOUT' : e.cause?.code || 'NETWORK';
        if (attempt === 0 && timeout === this.timeout) continue;
        throw Object.assign(new Error(code === 'TIMEOUT' ? '连接来源超时，请检查网络或代理后重试' : '无法连接来源，请检查网络或系统代理后重试'), { code, host });
      }
    }
  }
  async identity(game) {
    const known = sourceGames.find(g => (game.appId && g.appId === String(game.appId)) || [g.name,g.searchName].some(n => normalize(n) === normalize(game.name)));
    const resolved = { ...known, ...game, searchName: game.searchName && game.searchName !== game.name ? game.searchName : known?.searchName || game.searchName || game.name };
    if (known || !game.appId || (game.searchName && game.searchName !== game.name)) return resolved;
    const key = String(game.appId);
    if (!this.identities.has(key)) this.identities.set(key, (async () => {
      try { const raw = await this.request(`https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(key)}&l=english`, { timeout: 4500 }); const info = raw[key]?.data; return info?.name ? { searchName: info.name, ...(info.categories ? { workshop: info.categories.some(c => c.id === 30) } : {}) } : {}; } catch { return {}; }
    })());
    return { ...resolved, ...await this.identities.get(key) };
  }
  matching(source, game, values) { this.matches.set(`${source}:${game.id}`, values); }
  binding(source, game) { return this.matches.get(`${source}:${game.id}`) || {}; }
  async gql(query, variables = {}) {
    const raw = await this.request('https://api.nexusmods.com/v2/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(this.keys.nexus ? { apikey: this.keys.nexus } : {}) }, body: JSON.stringify({ query, variables }) });
    if (raw.errors?.length || !raw.data) throw new Error('N 网接口查询失败，请检查授权或稍后重试');
    return raw.data;
  }
  async nexusGame(game) {
    game = await this.identity(game);
    if (game.nexus) { this.matching('nexus',game,{name:nexusIndex.find(g=>g.domainName===game.nexus)?.name || game.searchName,id:game.nexus}); return game.nexus; }
    const cacheKey = `nexus:${game.id}:${game.searchName}`;
    if (this.gameIds.has(cacheKey)) return this.gameIds.get(cacheKey);
    const names = [...new Set([game.searchName,game.name].filter(Boolean))];
    let records = nexusIndex.filter(g => names.some(n => normalize(n) === normalize(g.name)));
    if (records.length !== 1) {
      const raw = await this.gql('query($filter:GamesSearchFilter){games(filter:$filter,count:80){nodes{name domainName}}}', { filter: { name: [{ value: game.searchName.replace(/[*?]/g, ''), op: 'WILDCARD' }] } });
      records = raw.games?.nodes || [];
      const exact = records.filter(g => names.some(n => normalize(g.name) === normalize(n)));
      if (exact.length === 1) records = exact;
      else {
        const words = game.searchName.toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>2 && !['the','edition'].includes(w));
        const candidates = [...new Map([...records,...nexusIndex.filter(g=>words.length && words.some(w=>g.name.toLowerCase().includes(w)))].map(g=>[g.domainName,g])).values()].slice(0,6).map(g=>({id:g.domainName,name:g.name}));
        this.matching('nexus',game,{candidates,searchName:game.searchName}); return null;
      }
    }
    const result = records[0]; this.matching('nexus',game,{name:result.name,id:result.domainName}); this.gameIds.set(cacheKey,result.domainName); return result.domainName;
  }
  resource(game, id) {
    if (typeof id !== 'string' || id.length > 160) throw new Error('资源 ID 无效');
    const parts = id.split(':');
    if (parts[0] === 'nexus' && parts.length === 3 && /^[a-z0-9_-]+$/.test(parts[1]) && /^\d+$/.test(parts[2])) return { source: 'nexus', domain: parts[1], id: parts[2] };
    if (['banana', 'workshop'].includes(parts[0]) && parts.length === 2 && /^\d+$/.test(parts[1])) return { source: parts[0], id: parts[1] };
    throw new Error('资源 ID 无效');
  }
  async detail(game, id) {
    const r = this.resource(game, id);
    if (r.source === 'banana') {
      const raw = await this.request(`https://gamebanana.com/apiv11/Mod/${r.id}/ProfilePage`);
      const gameId = await this.bananaGame(game);
      if (!gameId || String(raw._aGame?._idRow) !== String(gameId)) throw new Error('此 Mod 不属于当前游戏');
      if (raw._bIsWithheld || raw._bIsTrashed || raw._bIsPrivate) throw new Error('该资源目前不对外开放');
      return { description: text(raw._sText || raw._sDescription), requirements: [], notice:'香蕉网公开直链文件可直接下载，不需要 Nexus 或 Steam API Key。', files: (raw._aFiles || []).filter(f => !f._bIsArchived).map(f => ({ id: String(f._idRow), name: text(f._sFile), size: Number(f._nFilesize), version: '', ...fileAccess(f._sDownloadUrl,'banana'), _url: f._sDownloadUrl, md5: /^[a-f0-9]{32}$/i.test(f._sMd5Checksum || '') ? f._sMd5Checksum : null })) };
    }
    if (r.source === 'nexus') {
      if (r.domain !== await this.nexusGame(game)) throw new Error('此 Mod 不属于当前游戏');
      const g = await this.gql('query($domain:String){game(domainName:$domain){id}}', { domain: r.domain });
      const raw = await this.gql('query($mod:ID!,$game:ID!){mod(modId:$mod,gameId:$game){description modRequirements{nexusRequirements{nodes{modName notes}}}} modFiles(modId:$mod,gameId:$game){fileId name uri detectedFileExtension sizeInBytes size version category description}}', { mod: r.id, game: String(g.game.id) });
      const connected = this.status().nexusConnected;
      return { description: text(raw.mod.description), requirementDetails: (raw.mod.modRequirements?.nexusRequirements?.nodes || []).map(m => ({name:text(m.modName),notes:text(m.notes)})), requirements: (raw.mod.modRequirements?.nexusRequirements?.nodes || []).map(m => text(`${m.modName} ${m.notes || ''}`)), notice: this.nexusPlatform ? '点击下载后自动准备并传输文件，无需登录 Nexus。' : this.keys.nexus ? 'Nexus 已连接。桌面版会自动完成文件授权和下载；首次网页登录或站点验证需在弹出的官方窗口完成，随后自动继续。' : '公开列表可浏览，下载前请在设置中连接 Nexus。普通账号仍需由 Nexus 网页签发文件授权。', files: raw.modFiles.filter(f => !['REMOVED', 'ARCHIVED', 'OLD_VERSION'].includes(f.category)).map(f => {
        const bytes = Number(f.sizeInBytes), sizeExact = Number.isSafeInteger(bytes) && bytes > 0;
        // Legacy Nexus sizes are rounded KiB rather than exact byte counts.
        const approximate = Number(f.size) * 1024;
        return { id: String(f.fileId), name: text(`${f.name}.${f.detectedFileExtension || 'zip'}`), label: text(f.name), size: sizeExact ? bytes : Number.isFinite(approximate) && approximate > 0 ? Math.round(approximate) : 0, sizeExact, version: f.version, description: text(f.description), category: f.category, available: connected, downloadCode:connected?'NEXUS_PERMISSION_CHECK':'NEXUS_KEY_REQUIRED',downloadReason:this.nexusPlatform?'点击即可下载，文件准备完成后自动传输':this.keys.nexus?'Nexus 已连接，下载时自动核对文件权限':'未连接 Nexus；请在设置中连接账号。' };
      }) };
    }
    if (!game.appId || game.workshop === false) throw new Error('该游戏不支持 Steam 工坊');
    const raw = await this.request('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ itemcount: '1', 'publishedfileids[0]': r.id }).toString() });
    const m = raw.response?.publishedfiledetails?.[0];
    if (!m || m.result !== 1 || String(m.consumer_app_id) !== String(game.appId) || m.file_type === 1) throw new Error('无法读取当前游戏的工坊文件');
    const allowed = downloadAllowed(m.file_url);
    const access=fileAccess(m.file_url,'workshop');
    return { description: text(m.description), requirements: [], notice: access.downloadReason, files: [{ id: r.id, name: text(m.filename || `workshop-${r.id}.bin`), size: Number(m.file_size), ...access, _url: allowed }] };
  }
  async downloadFile(game, id, fileId, authorization, options = {}) {
    if (!/^\d+$/.test(String(fileId))) throw new Error('文件 ID 无效');
    const managedResource = this.resource(game, id);
    if (managedResource.source === 'nexus' && this.nexusPlatform) {
      const domain = await this.nexusGame(game);
      if (managedResource.domain !== domain) throw new Error('此 Mod 不属于当前游戏');
      return this.nexusPlatform.downloadFile({ ...game, nexus: domain }, id, fileId, options);
    }
    const detail = await this.detail(game, id); const file = detail.files.find(f => f.id === String(fileId));
    if (!file) throw new Error('该文件已下架或不属于此 Mod');
    if (!file.available) throw Object.assign(new Error(file.downloadReason || detail.notice || '该来源尚未开放直接下载'),{code:file.downloadCode});
    const resource = this.resource(game, id);
    if (resource.source === 'nexus') {
      const url = new URL(`https://api.nexusmods.com/v1/games/${resource.domain}/mods/${resource.id}/files/${fileId}/download_link.json`);
      if(authorization){if(authorization.domain!==resource.domain||authorization.modId!==resource.id||authorization.fileId!==String(fileId))throw new Error('文件授权与当前下载不匹配');if(Number(authorization.expires)*1000<=Date.now())throw new Error('NXM 文件授权已过期，请重新授权');url.searchParams.set('key',authorization.key);url.searchParams.set('expires',authorization.expires);if(authorization.userId){const account=await this.request('https://api.nexusmods.com/v1/users/validate.json',{headers:{apikey:this.keys.nexus}});if(String(account.user_id)!==authorization.userId)throw new Error('NXM 授权账号与 API Key 账号不一致，请使用同一个 Nexus 账号');}}
      let links; try { links = await this.request(url, { headers: { apikey: this.keys.nexus, 'Application-Name': 'Moddock', 'Application-Version': require('./package.json').version } }); } catch(e) {const message=e.code==='HTTP_401'?'N 网拒绝了 API Key，请在设置中重新连接有效授权':e.code==='HTTP_403'?(authorization?'N 网拒绝此文件授权，请重新授权并确认 API Key 与网页登录为同一账号':'此文件需要 NXM 授权，桌面版会自动获取文件授权并继续下载'):`获取 N 网下载链接失败：${e.message}`;throw Object.assign(new Error(message),{code:e.code==='HTTP_403'?'NEXUS_NXM_REQUIRED':e.code,host:e.host}); }
      file._url = links?.find(l => downloadAllowed(l.URI))?.URI;
    }
    if (!downloadAllowed(file._url)) throw new Error('来源未提供受支持的直接下载地址');
    return file;
  }
  async bananaGame(game) {
    game = await this.identity(game);
    if (game.banana) { this.matching('banana',game,{id:game.banana,name:game.searchName}); return String(game.banana); }
    const key = `banana:${game.id}:${game.searchName}`; if (this.gameIds.has(key)) return this.gameIds.get(key);
    const u = new URL('https://gamebanana.com/apiv11/Util/Search/Results'); u.searchParams.set('_sSearchString', game.searchName); u.searchParams.set('_sModelName', 'Game');
    const names = [game.searchName, game.name].map(name => normalize(String(name).replace(/&/g, 'and')));
    const exact = record => names.includes(normalize(record._sName.replace(/&/g, 'and')));
    let records, indexed;
    try { records = bananaGameRecords(await this.request(u)); }
    catch (error) {
      if (!['INVALID_SCHEMA', 'INVALID_JSON'].includes(error.code) && !error.code?.startsWith('GAMEBANANA_')) throw error;
      records = [];
    }
    if (records.filter(exact).length !== 1) {
      // General search can omit a real exact match or return unrelated popular games.
      const fallback = new URL('https://gamebanana.com/apiv11/Game/Index');
      fallback.searchParams.set('_aFilters[Generic_Name]', `contains,${game.searchName}`);
      fallback.searchParams.set('_nPerpage', '50');
      indexed = await this.request(fallback);
      records = [...new Map([...records, ...bananaGameRecords(indexed)].map(record => [String(record._idRow), record])).values()];
    }
    const matches = records.filter(exact);
    if (matches.length !== 1) {
      const related = matches.length ? matches : records.filter(record => names.some(name => name.length >= 5 && normalize(record._sName.replace(/&/g, 'and')).startsWith(name)));
      const complete = indexed?._aMetadata?._bIsComplete === true || (Number.isSafeInteger(indexed?._aMetadata?._nRecordCount) && indexed._aMetadata._nRecordCount <= indexed._aRecords.length);
      this.matching('banana',game,{searchName:game.searchName,unavailable:!related.length && complete,candidates:related.slice(0,6).map(g=>({id:String(g._idRow),name:g._sName}))}); return null;
    }
    const match = matches[0], id = String(match._idRow); this.matching('banana',game,{name:match._sName,id}); this.gameIds.set(key,id); return id;
  }
  async list(source, game, query = '', page = 1) {
    if (!providers.some(p => p.id === source)) throw new Error('未知资源来源');
    if (typeof query !== 'string' || query.length > 160 || !Number.isInteger(page) || page < 1 || page > 100000) throw new Error('搜索参数无效');
    const cacheKey = JSON.stringify([source, game.id, game.appId, game.nexus, game.banana, game.searchName, query, page, crypto.createHash('sha256').update(this.keys[source] || '').digest('hex')]);
    const hit = this.cache.get(cacheKey); if (hit && Date.now() - hit.at < 180000) return { ...hit.value, cached: true };
    if (this.inflight.has(cacheKey)) return this.inflight.get(cacheKey);
    const pending = this.load(source, game, query, page).then(result => { if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value); if (['ready','empty'].includes(result.status)) this.cache.set(cacheKey, { at: Date.now(), value: result }); return result; }).finally(() => this.inflight.delete(cacheKey));
    this.inflight.set(cacheKey, pending); return pending;
  }
  result(base, rawCount) {
    base.returnedCount = rawCount; base.filteredCount = rawCount - base.items.length;
    if (!base.items.length) {
      if (rawCount > 0 || Number(base.total) > (base.page - 1) * (base.source === 'nexus' ? 20 : 15)) return { ...base, status: 'error', code: 'EMPTY_PARSED_RESULT', message: `来源报告 ${base.total ?? rawCount} 项，但本页没有可展示的 Mod（原始 ${rawCount} 条）。请重试或复制诊断。` };
      return { ...base, status: 'empty', hasNext: false, message: base.query ? `专区已匹配，没有找到关键词“${base.query}”的 Mod` : '专区已匹配，来源当前没有返回 Mod' };
    }
    base.message = `已显示 ${base.items.length} 个 Mod${base.total != null ? `，来源共 ${base.total} 项` : ''}${base.hasNext ? '；可加载更多' : ''}`;
    return base;
  }
  async load(source, game, query, page) {
    const base = { source, gameId: game.id, query, gameName: game.name, searchName: game.searchName || game.name, total: null, items: [], page, hasNext: false, status: 'ready', browseUrl: sourceLinks(game, query)[source], fetchedAt: new Date().toISOString(), cached: false };
    try {
      game = await this.identity(game); base.searchName = game.searchName;
      if (source === 'nexus') {
        const domain = await this.nexusGame(game);
        if (!domain) return { ...base, status: 'unmapped', ...this.binding(source,game), message: `未找到唯一匹配的 N 网专区（查找名：${game.searchName}）${this.binding(source,game).candidates?.length?'，可选择下方候选专区':''}` };
        base.matchedGame = this.binding(source,game);
        const filter = { gameDomainName: [{ value: domain, op: 'EQUALS' }] };
        if (query) filter.name = [{ value: query.replace(/[*?]/g, ''), op: 'WILDCARD' }];
        const raw = await this.gql('query($filter:ModsFilter,$offset:Int){mods(filter:$filter,offset:$offset,count:20,sort:[{downloads:{direction:DESC}}]){totalCount nodes{modId name summary author thumbnailUrl category version downloads updatedAt game{domainName}}}}', { filter, offset: (page - 1) * 20 });
        if (!Array.isArray(raw.mods?.nodes)) throw new Error('N 网搜索返回未知格式');
        base.items = normalizeNexus(raw.mods.nodes.filter(m => !m.game?.domainName || m.game.domainName.toLowerCase() === domain.toLowerCase()).map(m => ({ ...m, mod_id: m.modId, picture_url: m.thumbnailUrl, mod_downloads: m.downloads })), { ...game, nexus: domain });
        base.total = Number.isFinite(Number(raw.mods.totalCount)) ? Number(raw.mods.totalCount) : null; base.hasNext = page * 20 < base.total; base.scope = 'search'; base.matchedGame = this.binding(source,game); return this.result(base, raw.mods.nodes.length);
      }
      if (source === 'banana') {
        const gameId = await this.bananaGame(game);
        if (!gameId) {
          const binding = this.binding(source,game);
          return { ...base, ...binding, status: binding.unavailable ? 'unsupported' : 'unmapped', code: binding.unavailable ? 'GAME_NOT_LISTED' : 'GAME_MATCH_REQUIRED', message: binding.unavailable ? `GameBanana 暂未收录与“${game.searchName}”准确匹配的游戏专区，可切换 N 网或 Steam 创意工坊。` : `尚未确定“${game.searchName}”对应的 GameBanana 专区${binding.candidates?.length ? '，请选择下方候选专区' : '，请重试或查看官方索引'}` };
        }
        base.matchedGame = this.binding(source,game);
        const u = new URL(query ? 'https://gamebanana.com/apiv11/Util/Search/Results' : 'https://gamebanana.com/apiv11/Mod/Index');
        if (page > 1) u.searchParams.set('_nPage', page);
        if (query) { u.searchParams.set('_sSearchString', query); u.searchParams.set('_sModelName', 'Mod'); u.searchParams.set('_idGameRow', gameId); }
        else { u.searchParams.set('_aFilters[Generic_Game]', gameId); u.searchParams.set('_nPerpage', '15'); }
        const raw = await this.request(u); if (raw._sErrorCode || !Array.isArray(raw._aRecords)) throw new Error('香蕉网资源接口暂不可用');
        base.items = normalizeBanana(raw._aRecords, game, gameId); base.hasNext = Number(raw._aMetadata?._nRecordCount || 0) > page * Number(raw._aMetadata?._nPerpage || 15); base.total = raw._aMetadata?._nRecordCount ?? null; base.browseUrl = query ? base.browseUrl : `https://gamebanana.com/games/${gameId}`; base.scope = 'search'; base.matchedGame = this.binding(source,game); return this.result(base, raw._aRecords.length);
      }
      if (game.workshop === false || !game.appId) return { ...base, status: 'unsupported', message: '该游戏没有可用的 Steam 创意工坊 Mod 专区' };
      if (this.keys.workshop) {
        const u = new URL('https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/'); u.searchParams.set('key', this.keys.workshop); u.searchParams.set('input_json', JSON.stringify({ query_type: query ? 12 : 3, page, numperpage: 15, appid: Number(game.appId), search_text: query, days: 7, filetype: 0, return_short_description: true, return_tags: true, return_previews: true }));
        const raw = await this.request(u); if (raw.response?.result !== 1) throw new Error('Steam 查询未成功，请检查 API Key 和游戏支持情况');
        base.items = normalizeWorkshop(raw.response.publishedfiledetails || [], game); base.total = raw.response.total ?? null; base.hasNext = Number(base.total) > page * 15; base.matchedGame = { id: game.appId, name: game.name }; return this.result(base, (raw.response.publishedfiledetails || []).length);
      }
      const u = new URL(base.browseUrl); u.searchParams.set('browsesort', 'trend'); u.searchParams.set('section', 'readytouseitems'); u.searchParams.set('numperpage', '12'); u.searchParams.set('p', page);
      const html = await this.request(u, { format: 'html' }); const parsed = parseWorkshopPage(html, game);
      if (parsed.page != null && parsed.page !== page) throw new Error('Steam 返回的页码不一致，请打开官方工坊或重试');
      Object.assign(base, { items: parsed.items, total: parsed.total, hasNext: parsed.hasNext, scope: 'search' });
      if (parsed.total != null) return this.result(base, parsed.rawCount);
      if (!base.items.length) return { ...base, status: /No items matching|No items to display|没有符合/i.test(html) ? 'empty' : 'needs_connection', message: /No items matching|No items to display|没有符合/i.test(html) ? '工坊没有返回匹配的资源' : '工坊页面未提供可解析的列表，请连接 Steam Web API' };
      return this.result(base, parsed.rawCount);
    } catch (e) { return { ...base, status: 'error', code: e.code || 'QUERY_FAILED', host: e.host || null, message: e.message }; }
  }
}
module.exports = { Sources, sourceGames, providers, sourceLinks, normalizeNexus, normalizeBanana, normalizeWorkshop, parseWorkshopHtml, externalAllowed };

function downloadAllowed(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && (/^filecache\d+\.gamebanana\.com$/.test(u.hostname) || ['gamebanana.com','files.gamebanana.com','nexusmods.com','nexus-cdn.com','steamusercontent.com','steamcontent.com','steampowered.com'].some(host => u.hostname === host || (host !== 'gamebanana.com' && host !== 'steampowered.com' && u.hostname.endsWith('.' + host)))) ? u.href : null; } catch { return null; }
}
module.exports.downloadAllowed = downloadAllowed;

module.exports.normalize = normalize;
