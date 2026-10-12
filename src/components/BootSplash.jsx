import { useEffect, useRef } from 'react';
import './BootSplash.css';

export default function BootSplash({ onComplete }) {
 const completeRef = useRef(onComplete);
 completeRef.current = onComplete;
 useEffect(() => {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finish = () => completeRef.current();
  const timer = setTimeout(finish, motion.matches ? 100 : 2800);
  const changed = event => { if (event.matches) finish(); };
  motion.addEventListener('change', changed);
  return () => { clearTimeout(timer); motion.removeEventListener('change', changed); };
 }, []);
 return <section className="boot-splash" aria-label="游匣启动动画">
  <img className="boot-splash__art" src="/splash.svg" alt="游匣 MODDOCK，你的游戏，你的玩法" onError={() => completeRef.current()} />
  <button className="boot-splash__skip" onClick={() => completeRef.current()}>跳过动画<span aria-hidden="true">↗</span></button>
 </section>;
}
