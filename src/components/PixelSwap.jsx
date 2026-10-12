'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './PixelSwap.css';

const MAX_PIXELS = 220;
const KEYFRAME_STEPS = 14;
const PATTERNS = {
 random: () => null,
 center: (x, y) => Math.hypot(x - 0.5, y - 0.5) / Math.SQRT1_2,
 edges: (x, y) => Math.min(x, 1 - x, y, 1 - y) * 2,
 'left-to-right': x => x, 'right-to-left': x => 1 - x,
 'top-to-bottom': (_x, y) => y, 'bottom-to-top': (_x, y) => 1 - y,
 diagonal: (x, y) => (x + y) / 2,
 spiral: (x, y) => ((Math.atan2(y - 0.5, x - 0.5) + Math.PI) / (Math.PI * 2) + Math.hypot(x - 0.5, y - 0.5) / Math.SQRT1_2) % 1
};
const EASINGS = { linear: [0, 0, 1, 1], ease: [0.25, 0.1, 0.25, 1], 'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1] };
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const noise = seed => { const v = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const makeEasing = value => {
 const match = /cubic-bezier\(([^)]+)\)/.exec(value);
 const points = match ? match[1].split(',').map(Number) : EASINGS[value];
 if (!points || points.length !== 4 || points.some(Number.isNaN)) return makeEasing('ease');
 const [x1, y1, x2, y2] = points;
 if (x1 === y1 && x2 === y2) return p => p;
 const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
 const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
 return progress => {
  let t = progress;
  for (let i = 0; i < 5; i++) { const slope = (3 * ax * t + 2 * bx) * t + cx; if (!slope) break; t -= (((ax * t + bx) * t + cx) * t - progress) / slope; }
  t = clamp(t, 0, 1); return ((ay * t + by) * t + cy) * t;
 };
};
const coverScale = (size, gap, radius) => {
 const p = clamp(radius, 0, 50) / 100;
 const corner = Math.SQRT1_2 / (Math.SQRT2 * (0.5 - p) + p);
 return ((size + gap) / size) * Math.max(1, corner);
};
const buildGrid = ({ width, height, pixelSize, gap, pattern, randomness }) => {
 let size = pixelSize;
 let columns = Math.max(1, Math.ceil((width + gap) / (size + gap)));
 let rows = Math.max(1, Math.ceil((height + gap) / (size + gap)));
 // Recompute until rounding cannot leave the grid above the pixel budget.
 while (columns * rows > MAX_PIXELS) {
  size = Math.max(size + 1, Math.ceil(size * Math.sqrt(columns * rows / MAX_PIXELS)));
  columns = Math.max(1, Math.ceil((width + gap) / (size + gap)));
  rows = Math.max(1, Math.ceil((height + gap) / (size + gap)));
 }
 const stride = size + gap, originX = (width - (columns * stride - gap)) / 2, originY = (height - (rows * stride - gap)) / 2;
 const order = PATTERNS[pattern] ?? PATTERNS.random, mix = clamp(randomness, 0, 1), pixels = [];
 for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
  const index = row * columns + column, x = columns <= 1 ? 0.5 : column / (columns - 1), y = rows <= 1 ? 0.5 : row / (rows - 1);
  const base = order(x, y), random = noise(index + 1);
  pixels.push({ id: index, left: originX + column * stride, top: originY + row * stride, offset: base === null ? random : base * (1 - mix) + random * mix });
 }
 return { pixels, size, gap, width, height };
};
const buildKeyframes = ({ ease, startScale, endScale, spin, fade }) => {
 const window = [], content = [];
 for (let step = 0; step <= KEYFRAME_STEPS; step++) {
  const progress = step / KEYFRAME_STEPS, eased = ease(progress), scale = startScale + (endScale - startScale) * eased, angle = spin * (1 - eased);
  window.push({ offset: progress, opacity: fade ? Math.min(1, eased * 1.6) : 1, transform: `rotate(${angle}deg) scale(${scale})` });
  content.push({ offset: progress, transform: `scale(${1 / scale}) rotate(${-angle}deg)` });
 }
 return { window, content };
};

export default function PixelSwap({
 firstContent, secondContent, pixelSize = 64, gap = 0, pixelRadius = 0, pixelSpin = 0, pixelScale = 0.35,
 fade = true, duration = 1400, pixelDuration = 450, pattern = 'random', randomness = 0,
 easing = 'cubic-bezier(0.22, 1, 0.36, 1)', trigger = 'hover', initialActive = false, active, onActiveChange, onComplete,
 aspectRatio = '16 / 10', className = '', style
}) {
 const [internalActive, setInternalActive] = useState(initialActive);
 const [shownActive, setShownActive] = useState(active ?? initialActive);
 const [transition, setTransition] = useState(null);
 const [box, setBox] = useState({ width: 0, height: 0 });
 const containerRef = useRef(null), layerRefs = useRef([]), pixelRefs = useRef([]), animationsRef = useRef([]);
 const completionRef = useRef(null);
 const desiredActive = active ?? internalActive, incomingIndex = transition?.to ? 1 : 0;
 const grid = useMemo(() => buildGrid({ width: box.width, height: box.height, pixelSize: Math.max(8, Math.round(pixelSize)), gap: Math.max(0, Math.round(gap)), pattern, randomness }), [box.width, box.height, pixelSize, gap, pattern, randomness]);
 const config = { duration, pixelDuration, pixelSpin, pixelScale, pixelRadius, fade, easing, onComplete };
 const configRef = useRef(config), gridRef = useRef(grid);
 configRef.current = config; gridRef.current = grid;
 useEffect(() => {
  const container = containerRef.current; if (!container) return;
  const measure = () => { const width = container.clientWidth, height = container.clientHeight; if (width && height) setBox(current => current.width === width && current.height === height ? current : { width, height }); };
  measure(); const observer = new ResizeObserver(measure); observer.observe(container); return () => observer.disconnect();
 }, []);
 const stopAnimations = useCallback(() => {
  animationsRef.current.forEach(a => a.cancel()); animationsRef.current = [];
  pixelRefs.current.forEach(pixel => pixel?.replaceChildren());
 }, []);
 useEffect(() => stopAnimations, [stopAnimations]);
 useEffect(() => {
  if (transition || desiredActive === shownActive) return;
  setTransition({ to: desiredActive, grid: gridRef.current });
 }, [desiredActive, shownActive, transition]);
 useEffect(() => {
  if (!transition) return;
  const settings = configRef.current, { grid: frozenGrid, to } = transition;
  let cancelled = false;
  const finish = () => {
   if (cancelled) return;
   // Keep the final pixel frame until React reveals the real layer in the same commit.
   completionRef.current = { to, onComplete: settings.onComplete };
   setShownActive(to); setTransition(null);
  };
  const source = layerRefs.current[to ? 1 : 0];
  if (!source || !frozenGrid.pixels.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
  const total = Math.max(200, settings.duration), pixelMs = clamp(settings.pixelDuration, 60, total), spread = Math.max(0, total - pixelMs);
  const endScale = coverScale(frozenGrid.size, frozenGrid.gap, settings.pixelRadius);
  const keyframes = buildKeyframes({ ease: makeEasing(settings.easing), startScale: clamp(settings.pixelScale, 0.05, 1) * endScale, endScale, spin: settings.pixelSpin, fade: settings.fade });
  // cloneNode does not copy canvas pixels; use one shared snapshot for the whole swap.
  const canvasSnapshots = [...source.querySelectorAll('canvas')].map(canvas => {
   try { canvas.dispatchEvent(new Event('pixel-swap:capture')); return canvas.toDataURL('image/png'); }
   catch { return null; }
  });
  frozenGrid.pixels.forEach((pixel, index) => {
   const el = pixelRefs.current[index]; if (!el) return;
   const content = document.createElement('div'); content.className = 'pixel-swap__pixel-content';
   Object.assign(content.style, { left: `${-pixel.left}px`, top: `${-pixel.top}px`, width: `${frozenGrid.width}px`, height: `${frozenGrid.height}px`, transformOrigin: `${pixel.left + frozenGrid.size / 2}px ${pixel.top + frozenGrid.size / 2}px` });
   // Visual clones never participate in focus, forms or ID lookup.
   const clone = source.cloneNode(true); clone.dataset.visible = 'true'; clone.removeAttribute('aria-hidden'); clone.inert = true;
   clone.querySelectorAll('canvas').forEach((canvas, index) => {
    if (!canvasSnapshots[index]) return;
    const snapshot = document.createElement('img');
    snapshot.src = canvasSnapshots[index]; snapshot.className = canvas.className; snapshot.style.cssText = canvas.style.cssText; snapshot.alt = ''; snapshot.setAttribute('aria-hidden', 'true');
    canvas.replaceWith(snapshot);
   });
   clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
   content.appendChild(clone); el.replaceChildren(content);
   const timing = { duration: pixelMs, delay: pixel.offset * spread, easing: 'linear', fill: 'both' };
   animationsRef.current.push(el.animate(keyframes.window, timing), content.animate(keyframes.content, timing));
  });
  Promise.all(animationsRef.current.map(animation => animation.finished)).then(finish, () => {});
  return () => { cancelled = true; stopAnimations(); };
 }, [stopAnimations, transition]);
 useLayoutEffect(() => {
  const completed = completionRef.current;
  if (transition || !completed || completed.to !== shownActive) return;
  completionRef.current = null;
  completed.onComplete?.(shownActive);
 }, [shownActive, transition]);
 const requestActive = useCallback(next => { if (active === undefined) setInternalActive(next); onActiveChange?.(next); }, [active, onActiveChange]);
 const interactionProps = useMemo(() => {
  if (trigger === 'hover') return { onMouseEnter: () => requestActive(true), onMouseLeave: () => requestActive(false), onFocus: () => requestActive(true), onBlur: () => requestActive(false), tabIndex: 0 };
  if (trigger === 'click') return { onClick: () => requestActive(!desiredActive), onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); requestActive(!desiredActive); } }, role: 'button', tabIndex: 0 };
  return {};
 }, [desiredActive, requestActive, trigger]);
 const renderLayer = (content, index) => {
  const isShown = index === (shownActive ? 1 : 0);
  return <div key={index} ref={el => { layerRefs.current[index] = el; }} className="pixel-swap__layer" data-visible={isShown && !(transition && index === incomingIndex)} style={{ zIndex: isShown ? 2 : 1 }} aria-hidden={!isShown} inert={!isShown || !!transition}>{content}</div>;
 };
 return <div ref={containerRef} className={`pixel-swap ${className}`.trim()} style={{ aspectRatio, ...style }} data-active={shownActive} data-transitioning={!!transition} {...interactionProps}>
  {renderLayer(firstContent, 0)}{renderLayer(secondContent, 1)}
  {transition && <div className="pixel-swap__grid" aria-hidden="true" inert>{transition.grid.pixels.map((pixel, index) => <div key={pixel.id} ref={el => { pixelRefs.current[index] = el; }} className="pixel-swap__pixel" style={{ left: pixel.left, top: pixel.top, width: transition.grid.size, height: transition.grid.size, borderRadius: `${clamp(pixelRadius, 0, 50)}%` }} />)}</div>}
 </div>;
}
