import { useLayoutEffect, useRef } from 'react';
import { usePresence } from './useMotion';

export default function Collapse({ open, children, onEntered }) {
 const { stage, shouldMount } = usePresence(open);
 const callback = useRef(onEntered);
 callback.current = onEntered;
 useLayoutEffect(() => { if (open && stage === 'enter') callback.current?.(); }, [open, stage]);
 return shouldMount && <div className="motion-collapse" data-stage={stage} inert={!open}>
  <div className="motion-collapse-inner">{children}</div>
 </div>;
}
