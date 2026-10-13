import HoloCard from './HoloCard';

// Same controller mark used by the app header and public/splash.svg.
const foilPattern = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 36 36"><g transform="translate(6 4)" fill="none" stroke="white" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12a4 4 0 0 1 4 4l-1 6a2 2 0 0 1-3 1l-3-3H9l-3 3a2 2 0 0 1-3-1l-1-6a4 4 0 0 1 4-4Z M7 10v5 M4.5 12.5h5 M16 11h.1 M19 14h.1"/></g></svg>')}`;

const fallbackArt = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="630" height="880" viewBox="0 0 630 880"><defs><radialGradient id="b"><stop stop-color="#496b61"/><stop offset="1" stop-color="#112521"/></radialGradient><pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M0 40L40 0" stroke="#b3f6cb" stroke-opacity=".07"/></pattern></defs><path fill="url(#b)" d="M0 0h630v880H0z"/><path fill="url(#p)" d="M0 0h630v880H0z"/><g transform="translate(215 290) scale(8.3)" fill="none" stroke="#bfdbcb" stroke-width=".8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12a4 4 0 0 1 4 4l-1 6a2 2 0 0 1-3 1l-3-3H9l-3 3a2 2 0 0 1-3-1l-1-6a4 4 0 0 1 4-4Z M7 10v5 M4.5 12.5h5 M16 11h.1 M19 14h.1"/></g><text x="315" y="520" text-anchor="middle" fill="#b6d3c3" font-family="sans-serif" font-size="18" letter-spacing="8">MODDOCK</text></svg>')}`;

export default function LibraryGameCards({ games, query }) {
 return games.map((game, index) => ({ game, index })).filter(({ game }) => !query || `${game.name} ${game.platform}`.toLowerCase().includes(query.toLowerCase())).map(({ game, index }) => <HoloCard
  key={game.id}
  className="game-card"
  data-game={game.id}
  alt={`${game.name} · ${game.platform}`}
  image={game.appId ? `https://cdn.akamai.steamstatic.com/steam/apps/${encodeURIComponent(game.appId)}/library_600x900.jpg` : fallbackArt}
  fallbackImage={fallbackArt}
  aspectRatio={63 / 88}
  preset="bursts"
  patternImage={foilPattern}
  intensity={0.32}
  edgeSparkle={0.04}
  frame={3}
  glare={0.08}
  tiltMax={9}
  hoverScale={1.02}
  idle={false}
 >
  <span className="game-holo__scrim" aria-hidden="true" />
  <span className="game-holo__edition" aria-hidden="true">MODDOCK<span>{String(index + 1).padStart(3, '0')}</span></span>
  <span className="game-holo__info"><span className="game-holo__name">{game.name}</span><span className="game-holo__platform">{game.platform}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14 M13 6l6 6-6 6" /></svg></span></span>
 </HoloCard>);
}
