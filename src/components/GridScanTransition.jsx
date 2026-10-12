import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GridScan } from './GridScan';
import './GridScanTransition.css';

export default function GridScanTransition({ firstContent, secondContent, active, onComplete, className = '' }) {
  const [shown, setShown] = useState(active);
  const [transition, setTransition] = useState(null);
  const overlayRef = useRef(null);
  const completedRef = useRef(null);
  const callbackRef = useRef(onComplete);
  callbackRef.current = onComplete;

  useEffect(() => {
    if (transition || active === shown) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      completedRef.current = active;
      setShown(active);
    } else setTransition({ to: active, phase: 'cover' });
  }, [active, shown, transition]);

  useLayoutEffect(() => {
    if (!transition) {
      if (completedRef.current !== null) {
        const result = completedRef.current;
        completedRef.current = null;
        callbackRef.current?.(result);
      }
      return;
    }
    const { to, phase } = transition;
    if (phase === 'scan') {
      const timer = window.setTimeout(() => setTransition({ to, phase: 'reveal' }), 600);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    const animation = overlayRef.current.animate(
      phase === 'cover' ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }],
      { duration: phase === 'cover' ? 240 : 460, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' }
    );
    animation.finished.then(() => {
      if (cancelled) return;
      if (phase === 'cover') {
        // Commit the incoming page while the scan completely covers both layers.
        setShown(to);
        setTransition({ to, phase: 'scan' });
      } else {
        completedRef.current = to;
        setTransition(null);
      }
    }).catch(() => {});
    return () => { cancelled = true; animation.cancel(); };
  }, [transition, shown]);

  return <div className={`grid-scan-transition ${className}`.trim()} data-active={shown} data-transitioning={!!transition} aria-busy={!!transition}>
    {[firstContent, secondContent].map((content, index) => {
      const visible = index === (shown ? 1 : 0);
      return <div key={index} className="auth-screen" data-visible={visible} aria-hidden={!visible} inert={!visible || !!transition}>{content}</div>;
    })}
    {transition && <div ref={overlayRef} className="grid-scan-transition__overlay" data-phase={transition.phase} aria-hidden="true">
      <GridScan linesColor="#527154" scanColor="#b3f66b" scanOpacity={0.9} gridScale={0.12} lineThickness={1.25} lineJitter={0.03} scanDirection="forward" scanDuration={1.1} scanDelay={0} scanGlow={1.1} bloomIntensity={0.65} bloomThreshold={0.1} bloomSmoothing={0.2} chromaticAberration={0.001} noiseIntensity={0.005} enableWebcam={false} showPreview={false} enableGyro={false} />
    </div>}
  </div>;
}
