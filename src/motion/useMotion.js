import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTransition } from 'transition-hook';
import './motion.css';

const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
const subscribe = callback => {
 preference.addEventListener('change', callback);
 return () => preference.removeEventListener('change', callback);
};
export const motion = { fast: 160, panel: 240, splash: 400, card: 360, ease: 'cubic-bezier(0.22, 1, 0.36, 1)' };
export function useReducedMotion() {
 return useSyncExternalStore(subscribe, () => preference.matches, () => true);
}
export function usePresence(open, duration = motion.panel) {
 const reduced = useReducedMotion();
 const transition = useTransition(open, reduced ? 0 : duration);
 return reduced ? { stage: open ? 'enter' : 'leave', shouldMount: open } : { ...transition, stage: open ? transition.stage : 'leave' };
}

export function useDismissMotion(onClosed, duration = motion.panel) {
 const [open, setOpen] = useState(true);
 const [ready, setReady] = useState(false);
 const transition = usePresence(ready && open, duration);
 useLayoutEffect(() => setReady(true), []);
 const callback = useRef(onClosed), completed = useRef(false);
 callback.current = onClosed;
 useEffect(() => {
  if (!open && !transition.shouldMount && !completed.current) {
   completed.current = true;
   // Some hosts dispose a separate React root; let this effect finish first.
   let active = true;
   queueMicrotask(() => { if (active) callback.current?.(); });
   return () => { active = false; };
  }
 }, [open, transition.shouldMount]);
 return { ...transition, closing: !open, dismiss: useCallback(() => setOpen(false), []) };
}

// Keep one live form mounted: replace its content only after the outgoing step fades.
export function useMotionState(initialValue) {
 const [value, setValue] = useState(initialValue);
 const [target, setTarget] = useState(initialValue);
 const [visible, setVisible] = useState(true);
 const reduced = useReducedMotion();
 const presence = usePresence(visible, motion.fast);
 useLayoutEffect(() => {
  if (reduced) { setValue(target); setVisible(true); }
  else if (target !== value) setVisible(false);
 }, [target, value, reduced]);
 useLayoutEffect(() => {
  if (!presence.shouldMount) { setValue(target); setVisible(true); }
 }, [presence.shouldMount, target]);
 return [value, setTarget, { stage: presence.stage, transitioning: target !== value || presence.stage !== 'enter' }];
}
