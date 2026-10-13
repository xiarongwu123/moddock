import { useEffect, useMemo, useRef, useState } from 'react';
import Lanyard from '../components/Lanyard';
import { createAccountStore } from './store.cjs';
import { motion, useDismissMotion } from '../motion/useMotion';
import './user-center.css';

const xml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
const shorten = (value, length) => Array.from(String(value ?? '')).length > length ? Array.from(String(value)).slice(0, length - 1).join('') + '…' : String(value ?? '');
const svgImage = markup => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
const textLines = (value, x, y, length = 36, step = 38) => (String(value || '—').match(new RegExp(`.{1,${length}}`, 'gu')) || []).map((line, i) => `<tspan x="${x}" y="${y + i * step}">${xml(line)}</tspan>`).join('');

function cardImages(account, pro, membership, expiry) {
 const name = account?.name || 'MU 用户';
 const initials = Array.from(name.trim()).slice(0, 2).join('').toUpperCase();
 const accent = pro ? '#c8ff80' : '#bbc9c3';
 const frame = content => svgImage(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1125" viewBox="0 0 800 1125">
  <defs>
   <linearGradient id="base" x2="1" y2="1"><stop stop-color="${pro ? '#24352e' : '#27312e'}"/><stop offset=".48" stop-color="#101917"/><stop offset="1" stop-color="#172321"/></linearGradient>
   <linearGradient id="foil" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#9ee7b3"/><stop offset=".3" stop-color="#e5ffb0"/><stop offset=".55" stop-color="#a4faff"/><stop offset=".76" stop-color="#c9b5ff"/><stop offset="1" stop-color="#f0ffd4"/></linearGradient>
   <radialGradient id="aura"><stop stop-color="${accent}" stop-opacity=".18"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
   <pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse"><path d="M44 0H0V44" fill="none" stroke="#c7f8dc" stroke-opacity=".045"/></pattern>
  </defs>
  <rect width="800" height="1125" fill="url(#base)"/><rect width="800" height="1125" fill="url(#grid)"/>
  <ellipse cx="660" cy="220" rx="470" ry="430" fill="url(#aura)"/>
  <path d="M800 95 385 510 800 925M800 245 530 510 800 775" stroke="url(#foil)" stroke-opacity="${pro ? '.28' : '.09'}" stroke-width="2" fill="none"/>
  <rect x="22" y="22" width="756" height="1081" rx="28" fill="none" stroke="${pro ? 'url(#foil)' : '#71837a'}" stroke-opacity=".45"/>
  <path d="M56 186h688" stroke="#c7f8dc" stroke-opacity=".16"/>
  <g font-family="Arial, 'Microsoft YaHei', sans-serif">${content}</g>
 </svg>`);
 const header = `<text x="58" y="147" fill="#eef7ed" font-size="34" font-weight="700" letter-spacing="6">MODDOCK</text><text x="742" y="147" text-anchor="end" fill="${accent}" font-size="18" letter-spacing="3">${pro ? 'PRO EDITION' : 'PLAYER PASS'}</text>`;
 const barcode = Array.from({ length: 45 }, (_, i) => `<rect x="${58 + i * 6}" y="1030" width="${i % 3 === 0 ? 4 : 2}" height="30"/>`).join('');
 return {
  front: frame(`${header}
   <text x="58" y="323" fill="${pro ? 'url(#foil)' : accent}" font-size="${pro ? 134 : 70}" font-weight="900" letter-spacing="${pro ? '-6' : '8'}">${pro ? 'PRO' : 'PLAYER'}</text>
   ${pro ? '<path d="m678 224 12 31 32 12-32 12-12 31-12-31-32-12 32-12Z" fill="url(#foil)"/><text x="62" y="360" fill="#a1b8a9" font-size="16" letter-spacing="7">PLAY BEYOND LIMITS</text>' : ''}
   <circle cx="400" cy="495" r="104" fill="#14211c" stroke="${pro ? 'url(#foil)' : '#71837a'}" stroke-width="3"/>
   <circle cx="400" cy="495" r="93" fill="#c8ff80" fill-opacity=".07"/>
   <text x="400" y="517" text-anchor="middle" fill="${accent}" font-size="64" font-weight="700">${xml(initials)}</text>
   <text x="400" y="667" text-anchor="middle" fill="#f1f6f0" font-size="${Array.from(name).length > 12 ? 32 : 42}" font-weight="700">${xml(shorten(name, 20))}</text>
   <text text-anchor="middle" fill="#a7b8b0" font-size="24">${textLines(account?.email, 400, 715, 42, 32)}</text>
   <path d="M58 815h684" stroke="#c7f8dc" stroke-opacity=".18"/>
   <text x="58" y="859" fill="#7f998b" font-size="18" letter-spacing="3">MEMBERSHIP</text>
   <text x="58" y="912" fill="${pro ? 'url(#foil)' : accent}" font-size="34" font-weight="700">${xml(membership)}</text>
   <text x="58" y="970" fill="#9db0a4" font-size="22">${xml(expiry)}</text>
   <g fill="${accent}" opacity=".55">${barcode}</g><text x="742" y="1052" text-anchor="end" fill="${accent}" font-size="18" letter-spacing="3">${pro ? 'MU / PRO' : 'MU / STANDARD'}</text>`),
  back: frame(`${header}<text x="58" y="290" fill="${accent}" font-size="24" letter-spacing="5">PLAYER IDENTITY</text>
   <text x="58" y="380" fill="#7f998b" font-size="20" letter-spacing="3">USER ID</text>
   <text fill="#e4eee6" font-size="25">${textLines(account?.id, 58, 426, 38)}</text>
   <text x="58" y="625" fill="#7f998b" font-size="20" letter-spacing="3">EMAIL</text>
   <text fill="#e4eee6" font-size="24">${textLines(account?.email, 58, 672, 42, 32)}</text>
   <path d="M58 815h684" stroke="#c7f8dc" stroke-opacity=".18"/>
   <text x="58" y="867" fill="#7f998b" font-size="22">会员有效期</text><text x="58" y="921" fill="${accent}" font-size="25">${xml(expiry)}</text>
   <text x="58" y="1048" fill="#adc1b2" font-size="23">让每一款游戏，都有新玩法。</text>`),
  strap: svgImage(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="100"><rect width="640" height="100" fill="${pro ? '#b3f66b' : '#40594b'}"/><path d="M0 8h640M0 92h640" stroke="${pro ? '#345321' : '#72907b'}" stroke-width="2"/><text x="320" y="64" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="32" letter-spacing="9" fill="${pro ? '#172810' : '#dceadf'}">MODDOCK${pro ? ' / PRO' : ''}</text></svg>`),
 };
}

export default function UserCenter({ initialAccount, onAccount, onRequireLogin, onClose }) {
 const overlayRef = useRef(null);
 const { stage, closing, dismiss: requestClose } = useDismissMotion(onClose, motion.card);
 const [state, setState] = useState({ account: initialAccount, busy: true, error: null });
 const [webglUnavailable, setWebglUnavailable] = useState(false);
 const [backVisible, setBackVisible] = useState(false);
 const account = state.account;
 const expiryDate = account?.membership?.expiresAt ? new Date(account.membership.expiresAt) : null;
 const validExpiry = expiryDate && Number.isFinite(expiryDate.getTime());
 const expired = validExpiry && expiryDate.getTime() <= Date.now();
 const pro = account?.membership?.tier === 'pro' && !expired;
 const membership = pro ? 'MU Pro 会员' : expired ? 'Pro 会员已到期' : '标准账号';
 const expiry = validExpiry ? expiryDate.toLocaleString('zh-CN', { hour12: false }) : pro ? '长期有效' : '未开通 Pro 会员';
 const images = useMemo(() => cardImages(account, pro, membership, expiry), [account, pro, membership, expiry]);

 useEffect(() => {
  const home = document.getElementById('auth-root');
  const wasInert = home?.inert;
  if (home) home.inert = true;
  overlayRef.current.querySelector('.user-center-close').focus({ preventScroll: true });
  const onKeyDown = event => {
   if (event.key === 'Escape') { event.preventDefault(); requestClose(); }
   if (event.key === 'Tab') {
    const stops = [...overlayRef.current.querySelectorAll('button, [tabindex="0"]')];
    const index = stops.indexOf(document.activeElement);
    event.preventDefault();
    stops[(index + (event.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
   }
  };
  document.addEventListener('keydown', onKeyDown);
  const store = createAccountStore();
  let active = true;
  const unsubscribe = store.subscribe(next => {
   if (!active) return;
   setState({ ...next, account: next.account || initialAccount });
   if (next.account) onAccount(next.account);
  });
  store.refresh().catch(error => {
   if (active && (error.status === 401 || ['disabled', 'account_disabled', 'user_disabled', 'invalid_response'].includes(error.code))) onRequireLogin(error.message);
  });
  return () => {
   active = false; unsubscribe(); store.dispose();
   document.removeEventListener('keydown', onKeyDown);
   if (home) home.inert = wasInert;
  };
 }, []);

 return <section ref={overlayRef} className={`user-center-overlay${pro ? ' is-pro' : ''}`} data-stage={stage} inert={closing} role="dialog" aria-modal="true" aria-label="个人中心" onClick={event => { if (event.target === event.currentTarget) requestClose(); }}>
  <div className="user-center-stage">
   {webglUnavailable ? <div className="user-center-fallback"><div className="user-center-strap" aria-hidden="true">MODDOCK</div><button className="user-center-static-card" type="button" aria-label="翻转工牌卡片" onClick={() => setBackVisible(value => !value)}><img src={backVisible ? images.back : images.front} alt="" /></button></div> : <Lanyard frontImage={images.front} backImage={images.back} strapImage={images.strap} cardColor="#172321" finish={pro ? 'holographic' : 'glossy'} metal={pro ? 'gold' : 'graphite'} size={0.64} strapLength={0.2} strapWidth={0.6} damping={0.8} breeze={0.08} intro={false} keyboardLabel="工牌卡片，拖动可摇晃，点击或按回车翻面" onUnavailable={() => setWebglUnavailable(true)} />}
  </div>
  <div className="user-center-controls">
   {state.error ? <p className="account-feedback" role="status">{state.error.message}{account && ' 当前显示最近一次获取的信息。'}</p> : <p className="user-center-card-hint">{state.busy ? '正在更新用户信息…' : account ? webglUnavailable ? '点击工牌翻面' : '拖动工牌 · 点击翻面' : '用户信息暂未加载'}</p>}
   <button className="user-center-close" type="button" aria-label="关闭个人中心" title="关闭个人中心 (Esc)" onClick={requestClose}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
  </div>
  <div className="visually-hidden" aria-busy={state.busy}><h2>个人中心</h2><p>{account?.name || 'MU 用户'}</p><p>{membership}</p><dl><dt>邮箱</dt><dd>{account?.email || '—'}</dd><dt>用户 ID</dt><dd>{account?.id || '—'}</dd><dt>会员有效期</dt><dd>{expiry}</dd></dl></div>
 </section>;
}
