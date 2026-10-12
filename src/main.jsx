import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CodeSlots from './components/CodeSlots';
import GridScanTransition from './components/GridScanTransition';
import ReflectiveCard from './components/ReflectiveCard';
import Shuffle from './components/Shuffle';
import FuzzyText from './components/FuzzyText';
import SteamBackdrop from './auth/SteamBackdrop';
import BootSplash from './components/BootSplash';
import accountClient from './auth/client.cjs';
import { mountHome, unmountHome, suspendHome } from '../public/app.js';
import './auth.css';

const auth = accountClient.createAuthClient();
const normalizeEmail = email => email.trim().toLowerCase();
const symbols = {
 gamepad: 'M6 8h12a4 4 0 0 1 4 4l-1 6a2 2 0 0 1-3 1l-3-3H9l-3 3a2 2 0 0 1-3-1l-1-6a4 4 0 0 1 4-4Z M7 10v5 M4.5 12.5h5 M16 11h.1 M19 14h.1',
 arrow: 'M5 12h14 M13 6l6 6-6 6', mail: 'M3 5h18v14H3z M3 5l9 8 9-8', lock: 'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4',
 eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
 eyeOff: 'M3 3l18 18 M9 5.5A12 12 0 0 1 12 5c6 0 10 7 10 7a19 19 0 0 1-3 4 M6 6a20 20 0 0 0-4 6s4 7 10 7a13 13 0 0 0 5-1.5 M10 10a3 3 0 0 0 4 4',
 left: 'M19 12H5 M11 6l-6 6 6 6', shield: 'M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6Z M8 12l3 3 5-6', check: 'M5 12l4 4L19 6',
 box: 'M3 7l9-5 9 5v10l-9 5-9-5Z M3 7l9 5 9-5 M12 12v10'
};
function Icon({ name, className = '' }) { return <svg className={className} viewBox="0 0 24 24" aria-hidden="true"><path d={symbols[name]} /></svg>; }
function Brand({ active }) { return <div className="auth-brand" role="img" aria-label="游匣 MODDOCK"><span className="auth-brand-symbol"><Icon name="gamepad" /></span><span className="auth-brand-name"><span className="auth-brand-word" aria-hidden="true"><span className="auth-brand-fallback">游匣</span><FuzzyText fontSize={30} fontWeight={760} color="#eef1ee" letterSpacing={3} baseIntensity={0.08} hoverIntensity={0.45} fuzzRange={16} fps={30} transitionDuration={160} paused={!active} className="auth-brand-fuzzy">游匣</FuzzyText></span><small aria-hidden="true">MODDOCK</small></span></div>; }
function Field({ label, id, type = 'text', icon, error, ...props }) {
 const [visible, setVisible] = useState(false);
 const password = type === 'password';
 return <div className="auth-field">
  <label htmlFor={id}>{label}</label>
  <div className={`auth-input-wrap${error ? ' is-invalid' : ''}`}><Icon name={icon} />
   <input id={id} type={password && visible ? 'text' : type} aria-invalid={!!error} aria-describedby={error ? 'auth-step-feedback' : undefined} {...props} />
   {password && <button className="password-toggle" type="button" aria-label={visible ? '隐藏密码' : '显示密码'} aria-pressed={visible} onClick={() => setVisible(v => !v)}><Icon name={visible ? 'eyeOff' : 'eye'} /></button>}
  </div>
 </div>;
}
function AuthPanel({ onEnter, navigating, backgroundActive, initialNotice }) {
 const [mode, setMode] = useState(window.location.hash.startsWith('#register') ? 'register' : 'login');
 const [step, setStep] = useState('email');
 const [email, setEmail] = useState('');
 const [password, setPassword] = useState('');
 const [termsAccepted, setTermsAccepted] = useState(false);
 const [accountConfig, setAccountConfig] = useState(null);
 const [errors, setErrors] = useState({});
 const [notice, setNotice] = useState('');
 const [busy, setBusy] = useState(false);
 const [challenge, setChallenge] = useState(null);
 const [clock, setClock] = useState(Date.now());
 const [status, setStatus] = useState('idle');
 const [slotKey, setSlotKey] = useState(0);
 const [slotSize, setSlotSize] = useState(44);
 const [stepAnimating, setStepAnimating] = useState(false);
 const panelRef = useRef(null);
 const stepAnimationRef = useRef(null);
 const stepTransitionRef = useRef(false);
 const stepDirectionRef = useRef(1);
 const verifyRef = useRef(null);
 const titleRef = useRef(null);
 const pendingRef = useRef(false);
 const remaining = challenge ? Math.max(0, Math.ceil((challenge.resendAt - clock) / 1000)) : 0;
 const expired = challenge && clock >= challenge.expiresAt;
 const stepNumber = step === 'email' ? 1 : step === 'password' ? 2 : 3;
 const title = step === 'verify' ? '验证你的邮箱' : step === 'password' ? mode === 'login' ? '输入密码' : '设置密码' : mode === 'login' ? '欢迎回到游匣' : '创建你的游匣账号';
 useEffect(() => { let live = true; auth.config().then(value => { if (live) setAccountConfig(value); }).catch(error => { if (live) setNotice(error.message); }); return () => { live = false; }; }, []);
 useEffect(() => { if (!stepAnimating) panelRef.current?.querySelector('input')?.focus(); }, [mode, step, stepAnimating]);
 useEffect(() => () => stepAnimationRef.current?.cancel(), []);
 useLayoutEffect(() => {
  if (!stepTransitionRef.current) return;
  stepAnimationRef.current?.cancel();
  const animation = panelRef.current.animate([
   { opacity: 0, transform: `translateX(${stepDirectionRef.current * 14}px)` },
   { opacity: 1, transform: 'translateX(0)' }
  ], { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' });
  stepAnimationRef.current = animation;
  let cancelled = false;
  animation.finished.then(() => {
   if (cancelled) return;
   animation.cancel(); stepAnimationRef.current = null; stepTransitionRef.current = false; setStepAnimating(false);
  }).catch(() => {});
  return () => { cancelled = true; animation.cancel(); };
 }, [step]);
 const changeStep = next => {
  if (stepTransitionRef.current || next === step) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setStep(next); return; }
  stepDirectionRef.current = ['email', 'password', 'verify'].indexOf(next) > ['email', 'password', 'verify'].indexOf(step) ? 1 : -1;
  stepTransitionRef.current = true; setStepAnimating(true);
  const animation = panelRef.current.animate([
   { opacity: 1, transform: 'translateX(0)' },
   { opacity: 0, transform: `translateX(${-stepDirectionRef.current * 14}px)` }
  ], { duration: 110, easing: 'ease-in', fill: 'forwards' });
  stepAnimationRef.current = animation;
  animation.finished.then(() => setStep(next)).catch(() => {});
 };
 useEffect(() => { if (!challenge) return; const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, [challenge]);
 useEffect(() => {
  if (step !== 'verify' || !verifyRef.current) return;
  const node = verifyRef.current;
  const measure = () => setSlotSize(Math.max(28, Math.min(44, Math.floor((node.clientWidth - 40) / 6))));
  measure(); const observer = new ResizeObserver(measure); observer.observe(node);
  return () => observer.disconnect();
 }, [step]);
 useEffect(() => { if (expired) { setStatus('idle'); setNotice('验证码已过期，请重新获取。'); } }, [expired]);
 const changeMode = next => {
  if (busy || pendingRef.current || navigating || stepTransitionRef.current || next === mode) return;
  auth.reset(); setMode(next); setStep('email'); setErrors({}); setNotice(''); setChallenge(null); setPassword(''); setTermsAccepted(false); setStatus('idle');
 };
 const validate = () => {
  const next = {};
  if (step === 'email') {
   if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email))) next.email = '请输入有效的邮箱地址';
  } else {
   if (!password) next.password = '请输入密码';
   else if (password.length < 8 || password.length > 128) next.password = '密码需为 8–128 位';
   if (mode === 'register' && !termsAccepted) next.terms = '请阅读并同意用户协议和隐私政策';
   if (mode === 'register' && !accountConfig) next.terms = '账号服务配置尚未加载，请稍后重试';
  }
  setErrors(next);
  if (Object.keys(next).length) document.getElementById(next.email ? 'auth-email' : 'auth-password')?.focus();
  return !Object.keys(next).length;
 };
 const submit = async e => {
  e.preventDefault(); if (busy || pendingRef.current || navigating || stepTransitionRef.current || !validate()) return;
  if (step === 'email') { setEmail(normalizeEmail(email)); changeStep('password'); return; }
  pendingRef.current = true;
  setBusy(true); setNotice('');
  try {
   if (mode === 'login') { const user = await auth.login({ email, password }); setPassword(''); onEnter(user); }
   else {
    const next = await auth.sendCode({ email, password, termsAccepted }); setChallenge(next); setClock(Date.now()); setSlotKey(k => k + 1); setStatus('idle'); changeStep('verify');
   }
  } catch (err) { setNotice(err.message); }
  finally { pendingRef.current = false; setBusy(false); }
 };
 const resend = async () => {
  if (remaining || busy || pendingRef.current || navigating || stepTransitionRef.current) return;
  pendingRef.current = true;
  setBusy(true); setNotice('');
  try { const next = await auth.sendCode({ email, password, termsAccepted }); setChallenge(next); setClock(Date.now()); setStatus('idle'); setSlotKey(k => k + 1); }
  catch (err) {
   setNotice(err.message);
   if (err.retryAfterSeconds) { setChallenge(current => ({ ...current, resendAt: Date.now() + err.retryAfterSeconds * 1000 })); setClock(Date.now()); }
  }
  finally { pendingRef.current = false; setBusy(false); }
 };
 const verifyCode = async code => {
  if (busy || pendingRef.current || navigating || stepTransitionRef.current || !challenge || expired) return;
  pendingRef.current = true;
  setBusy(true); setNotice('');
  try {
   const user = await auth.register({ email, password, code, termsAccepted });
   setStatus('success'); setPassword(''); onEnter(user);
  }
  catch (err) { setNotice(err.message); setStatus('error'); }
  finally { pendingRef.current = false; setBusy(false); }
 };
 const back = () => {
  if (busy || pendingRef.current || navigating || stepTransitionRef.current) return;
  auth.reset(); changeStep(step === 'verify' ? 'password' : 'email'); setChallenge(null); setStatus('idle'); setErrors({}); setNotice('');
 };
 return <div className="auth-page">
  <SteamBackdrop active={backgroundActive} />
  <main className="auth-form-center" aria-label="游匣账号入口">
   <ReflectiveCard width={430} height="auto" radius={22} theme="dark" tint="#cce1bb" metalness={0.78} roughness={0.38} blurStrength={8} shine={0.4} glare={0.18} bevel={2} enableTilt={false} intro={false} webcam={false} paused={!backgroundActive} className="auth-reflective-card">
    <header className="auth-card-header"><Brand active={backgroundActive} /></header>
    <div className="auth-form-card">
     <div className="auth-mode-row"><div className="auth-tabs" role="tablist" aria-label="账号入口" onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) && !busy && !navigating && !stepTransitionRef.current) { e.preventDefault(); const next = e.key === 'Home' ? 'login' : e.key === 'End' ? 'register' : mode === 'login' ? 'register' : 'login'; changeMode(next); document.getElementById(`${next}-tab`)?.focus(); } }}><button id="login-tab" role="tab" tabIndex={mode === 'login' ? 0 : -1} aria-selected={mode === 'login'} aria-controls="auth-panel" disabled={busy || navigating || stepAnimating} onClick={() => changeMode('login')}>登录</button><button id="register-tab" role="tab" tabIndex={mode === 'register' ? 0 : -1} aria-selected={mode === 'register'} aria-controls="auth-panel" disabled={busy || navigating || stepAnimating} onClick={() => changeMode('register')}>注册</button></div><span className="auth-step-count" aria-label={`第 ${stepNumber} 步，共 ${mode === 'login' ? 2 : 3} 步`}>{stepNumber} / {mode === 'login' ? 2 : 3}</span></div>
     <section id="auth-panel" ref={panelRef} className="auth-step-panel" role="tabpanel" aria-labelledby={`${mode}-tab`} aria-busy={stepAnimating} data-transitioning={stepAnimating} inert={stepAnimating}>
      <div className="auth-form-heading"><h2 id="auth-title" ref={titleRef} tabIndex={-1} aria-label={step === 'email' ? title : undefined} className={step === 'email' ? 'auth-pixel-title' : undefined}>{step === 'email' && backgroundActive && !stepAnimating ? <span aria-hidden="true"><Shuffle key={mode} text={title} tag="span" className="auth-title-shuffle" textAlign="left" shuffleDirection="right" duration={0.35} animationMode="evenodd" shuffleTimes={1} stagger={0.025} rootMargin="0px" triggerOnce triggerOnHover={false} respectReducedMotion /></span> : title}</h2>{step !== 'email' && <p><span className="auth-account-email" title={email}>{email}</span></p>}</div>
      {step !== 'verify' ? <form className="auth-step-form" onSubmit={submit} noValidate>
       <div className="auth-step-input">{step === 'email' ? <Field key="email" id="auth-email" label="邮箱地址" type="email" icon="mail" placeholder="you@example.com" autoComplete="email" value={email} maxLength={254} error={errors.email} disabled={busy || navigating} onChange={e => { setEmail(e.target.value); setErrors({}); setNotice(''); }} /> : <Field key="password" id="auth-password" label={mode === 'register' ? '设置密码' : '密码'} type="password" icon="lock" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} maxLength={128} error={errors.password} disabled={busy || navigating} onChange={e => { setPassword(e.target.value); setErrors({}); setNotice(''); }} />}
       {mode === 'register' && step === 'password' && <div className="auth-terms"><label><input type="checkbox" checked={termsAccepted} disabled={busy || navigating || !accountConfig} onChange={e => { setTermsAccepted(e.target.checked); setErrors({}); setNotice(''); }} />我已阅读并同意</label>{accountConfig && <><a href={accountConfig.legalUrls.terms} target="_blank" rel="noopener noreferrer">用户协议</a><span>和</span><a href={accountConfig.legalUrls.privacy} target="_blank" rel="noopener noreferrer">隐私政策</a></>}</div>}
       <div className="auth-feedback" id="auth-step-feedback" role="alert">{errors[step] || errors.terms || notice || (step === 'email' ? initialNotice : '')}</div></div>
       <button className="auth-primary" type="submit" disabled={busy || navigating}>{navigating ? '正在进入游戏库…' : busy ? '请稍候…' : step === 'email' ? '下一步' : mode === 'login' ? '登录' : '获取邮箱验证码'}<Icon name="arrow" /></button>
      </form> : <div className="verification-step" ref={verifyRef}>
       <div className="verification-label"><span>邮箱验证码</span><details key={challenge?.id} className="verification-help" onKeyDown={e => { if (e.key === 'Escape') { e.currentTarget.open = false; e.currentTarget.querySelector('summary')?.focus(); } }}><summary aria-label="验证码帮助">?</summary><div className="verification-help-content" role="note"><p>如邮箱符合注册条件，验证码邮件已发送，请检查收件箱和垃圾邮件。</p><p>验证码 10 分钟内有效。已有 MU 账号可直接登录。</p></div></details></div>
       <CodeSlots key={slotKey} length={6} status={status} onChange={() => { if (status === 'error') setStatus('idle'); }} onComplete={verifyCode} accentColor="#b3f66b" inkColor="#b3f66b" slotColor="#24292d" digitColor="#142019" dangerColor="#ff7878" slotSize={slotSize} gap={8} radius={9} bounce={0.2} settle={0.3} rise={8} cascade={20} ariaLabel="邮箱验证码" autoFocus disabled={busy || navigating || expired || stepAnimating} />
       <div className="verification-resend"><button type="button" onClick={resend} disabled={remaining > 0 || busy || navigating}>{remaining > 0 ? `${remaining}s` : '重新获取'}</button></div>
       <div className="auth-feedback" role="alert">{notice}</div>
       <div className="verification-auto" role="status">{navigating ? '正在进入…' : busy ? '正在验证…' : ''}</div>
      </div>}
     </section>
     <div className="auth-secondary-actions"><button className="auth-back" style={{ visibility: step === 'email' ? 'hidden' : undefined }} tabIndex={step === 'email' ? -1 : 0} onClick={back} disabled={busy || navigating || stepAnimating}><Icon name="left" />上一步</button></div>
    </div>
   </ReflectiveCard>
  </main>
 </div>;
}
function Home({ session, onReady }) {
 const host = useRef(null);
 useEffect(() => {
  if (session?.mode !== 'mu') return;
  let live = true;
  mountHome(host.current, session).then(mounted => { if (live && mounted) onReady(); });
  return () => { live = false; unmountHome(); };
 }, [session, onReady]);
 return <div className="home-host" ref={host} id="app"><div className="boot">正在打开本地游戏库…</div></div>;
}
function App({ booting }) {
 const [session, setSession] = useState(null);
 const [active, setActive] = useState(false);
 const [navigating, setNavigating] = useState(false);
 const [formKey, setFormKey] = useState(0);
 const [checkingSession, setCheckingSession] = useState(true);
 const [initialNotice, setInitialNotice] = useState('');
 const returningRef = useRef(false);
 useEffect(() => {
  let live = true;
  if (!window.location.hash.startsWith('#register')) window.history.replaceState(null, '', '#login');
  auth.session().then(user => {
   if (live && user) { setNavigating(true); setSession(user); }
  }).catch(error => { if (live && error.status !== 401) setInitialNotice(error.message); })
   .finally(() => { if (live) setCheckingSession(false); });
  return () => { live = false; };
 }, []);
 const ready = useCallback(() => setActive(true), []);
 const enter = user => { if (navigating || user?.mode !== 'mu') return; setNavigating(true); setSession(user); };
 const complete = shown => {
  returningRef.current = false;
  setNavigating(false);
  if (shown) {
   window.history.replaceState(null, '', '#home');
   requestAnimationFrame(() => { document.querySelector('#app h1')?.setAttribute('tabindex', '-1'); document.querySelector('#app h1')?.focus(); });
  } else { window.history.replaceState(null, '', '#login'); setSession(null); auth.reset(); requestAnimationFrame(() => document.getElementById('auth-title')?.focus()); }
 };
 useEffect(() => {
  const logout = async () => {
   if (navigating || checkingSession || returningRef.current) return;
   returningRef.current = true; suspendHome();
   setCheckingSession(true); setInitialNotice('');
   try { await auth.logout(); }
   catch (error) { setInitialNotice(error.message); }
   finally { setCheckingSession(false); setFormKey(k => k + 1); setNavigating(true); setActive(false); }
  };
  const requireLogin = event => {
   if (returningRef.current) return;
   returningRef.current = true;
   unmountHome(); setSession(null); setCheckingSession(false); setFormKey(k => k + 1);
   setInitialNotice(event.detail?.message || '登录已失效，请重新登录。');
   setNavigating(active); setActive(false);
   if (!active) { returningRef.current = false; window.history.replaceState(null, '', '#login'); }
  };
  window.addEventListener('moddock:logout', logout);
  window.addEventListener('moddock:auth-required', requireLogin);
  return () => { window.removeEventListener('moddock:logout', logout); window.removeEventListener('moddock:auth-required', requireLogin); };
 }, [navigating, checkingSession, active]);
 return <GridScanTransition firstContent={<AuthPanel key={formKey} onEnter={enter} navigating={navigating || checkingSession} initialNotice={initialNotice} backgroundActive={!booting && !active && !navigating} />} secondContent={<Home session={session} onReady={ready} />} active={active} onComplete={complete} className="auth-swap" />;
}
function DesktopChrome() {
 const overlay = navigator.windowControlsOverlay;
 const [visible, setVisible] = useState(() => overlay?.visible ?? false);
 useEffect(() => {
  if (!overlay) return;
  const changed = () => setVisible(overlay.visible);
  overlay.addEventListener('geometrychange', changed);
  return () => overlay.removeEventListener('geometrychange', changed);
 }, [overlay]);
 return visible ? <div className="desktop-drag-region" aria-hidden="true" /> : null;
}
function BootApp() {
 const [booting, setBooting] = useState(true);
 const finish = useCallback(() => setBooting(false), []);
 useEffect(() => {
  if (!booting) document.getElementById('auth-email')?.focus();
 }, [booting]);
 return <><div inert={booting} aria-hidden={booting || undefined}><App booting={booting} /></div>{booting && <BootSplash onComplete={finish} />}<DesktopChrome /></>;
}
createRoot(document.getElementById('auth-root')).render(<BootApp />);
