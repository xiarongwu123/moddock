// Curated from Steam's Most Played chart on 2026-10-12; this is a static artwork selection.
export const steamChartSource = 'https://store.steampowered.com/charts/mostplayed';
export const steamCovers = [
 [730, 'Counter-Strike 2'],
 [570, 'Dota 2'],
 [578080, 'PUBG: BATTLEGROUNDS'],
 [1172470, 'Apex Legends'],
 [1422450, 'Deadlock'],
 [2507950, 'Delta Force'],
 [440, 'Team Fortress 2'],
 [1808500, 'ARC Raiders'],
 [252490, 'Rust'],
 [892970, 'Valheim'],
 [2868840, 'Slay the Spire 2'],
 [230410, 'Warframe'],
 [413150, 'Stardew Valley'],
 [1623730, 'Palworld'],
 [236390, 'War Thunder'],
 [1091500, 'Cyberpunk 2077'],
 [1086940, "Baldur's Gate 3"],
 [1203220, 'NARAKA: BLADEPOINT'],
].map(([appId, title]) => ({
 appId,
 title,
 image: `/covers/${appId}.jpg`,
 fallback: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
}));
