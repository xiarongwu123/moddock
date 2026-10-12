import { useLayoutEffect, useRef, useState } from 'react';
import DriftWall from '../components/DriftWall';
import { steamCovers } from './steam-covers';

export default function SteamBackdrop({ active }) {
 const host = useRef(null);
 const [width, setWidth] = useState(() => window.innerWidth);
 useLayoutEffect(() => {
  const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
  observer.observe(host.current);
  return () => observer.disconnect();
 }, []);
 const tileWidth = width < 1100 ? 172 : 210;
 return <div className="auth-backdrop" ref={host} aria-hidden="true" inert>
  <DriftWall items={steamCovers} columns={Math.max(4, Math.ceil(width / (tileWidth + 18)) + 2)} tileWidth={tileWidth} tileHeight={Math.round(tileWidth * 1.5)} gap={18} radius={10} tilt={9} turn={-12} roll={-9} perspective={1600} depth={60} speed={22} variance={0.32} parallax={0} lift={0} fade={0.15} dim={0.88} overlayColor="#09110f" decorative paused={!active} />
  <div className="auth-backdrop-shade" />
 </div>;
}
