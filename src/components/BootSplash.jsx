import { useEffect, useRef } from 'react';
import { motion, useDismissMotion } from '../motion/useMotion';
import './BootSplash.css';

export default function BootSplash({ onComplete }) {
 const completeRef = useRef(onComplete);
 completeRef.current = onComplete;
 const { dismiss, closing } = useDismissMotion(() => completeRef.current(), motion.splash);
 useEffect(() => {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finish = dismiss;
  const timer = setTimeout(finish, motion.matches ? 100 : 2400);
  const changed = event => { if (event.matches) finish(); };
  motion.addEventListener('change', changed);
  return () => { clearTimeout(timer); motion.removeEventListener('change', changed); };
 }, [dismiss]);
 return <section className="boot-splash" data-closing={closing} inert={closing} aria-label="游匣启动动画">
  <img className="boot-splash__art" src="/splash.svg" alt="游匣 MODDOCK，你的游戏，你的玩法" onError={dismiss} />
  <button className="boot-splash__skip" onClick={dismiss}>跳过动画<span aria-hidden="true">↗</span></button>
 </section>;
}
