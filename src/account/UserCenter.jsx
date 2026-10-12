import { useEffect, useMemo, useRef, useState } from 'react';
import Lanyard from '../components/Lanyard';
import { createAccountStore } from './store.cjs';
import './user-center.css';

const xml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
const shorten = (value, length) => Array.from(String(value ?? '')).length > length ? Array.from(String(value)).slice(0, length - 1).join('') + '…' : String(value ?? '');
const svgImage = markup => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;

function cardImages(account, membership, expiry) {
 const name = account?.name || 'MU 用户';
 const initials = Array.from(name.trim()).slice(0, 2).join('').toUpperCase();
 const frame = content => svgImage(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1125" viewBox="0 0 800 1125"><rect width="800" height="1125" fill="#f5f5f1"/><path d="M0 0h800v240L0 390Z" fill="#e9e7f2"/><path d="M590 0h210v1125H720Z" fill="#eeedf5"/>${content}</svg>`);
 return {
  front: frame(`<g font-family="Arial, 'Microsoft YaHei', sans-serif"><text x="64" y="158" fill="#29283b" font-size="36" font-weight="700" letter-spacing="6">MODDOCK</text><text x="64" y="202" fill="#727084" font-size="20" letter-spacing="4">PLAYER IDENTITY</text><circle cx="400" cy="440" r="124" fill="#6860a9"/><text x="400" y="462" text-anchor="middle" fill="#ffffff" font-size="70" font-weight="700">${xml(initials)}</text><text x="400" y="644" text-anchor="middle" fill="#242334" font-size="42" font-weight="700">${xml(shorten(name, 18))}</text><text x="400" y="700" text-anchor="middle" fill="#787586" font-size="24">${xml(shorten(account?.email || '—', 38))}</text><path d="M64 784h672" stroke="#dcdbe4" stroke-width="2"/><text x="64" y="846" fill="#8b8899" font-size="20" letter-spacing="3">MEMBERSHIP</text><text x="64" y="896" fill="#534b8e" font-size="30" font-weight="700">${xml(membership)}</text><text x="64" y="1038" fill="#9894a6" font-size="20">游匣 · 你的游戏与 Mod</text><circle cx="708" cy="1024" r="15" fill="#6860a9"/></g>`),
  back: frame(`<g font-family="Arial, 'Microsoft YaHei', sans-serif"><text x="64" y="158" fill="#29283b" font-size="36" font-weight="700" letter-spacing="6">MODDOCK</text><text x="64" y="380" fill="#8b8899" font-size="22" letter-spacing="3">USER ID</text><text x="64" y="440" fill="#29283b" font-size="27">${xml(shorten(account?.id || '—', 36))}</text><path d="M64 500h672" stroke="#dcdbe4" stroke-width="2"/><text x="64" y="580" fill="#8b8899" font-size="22">会员有效期</text><text x="64" y="640" fill="#534b8e" font-size="28">${xml(expiry)}</text><text x="64" y="930" fill="#29283b" font-size="32" font-weight="700">让每一款游戏，都有新玩法。</text><text x="64" y="1038" fill="#9894a6" font-size="20">PLAYER PASS / 游匣</text></g>`),
  strap: svgImage('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="100"><rect width="640" height="100" fill="#6860a9"/><text x="320" y="65" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="36" letter-spacing="10" fill="#eae7ff">MODDOCK</text></svg>'),
 };
}

export default function UserCenter({ initialAccount, onAccount, onRequireLogin, onClose }) {
 const dialogRef = useRef(null);
 const [state, setState] = useState({ account: initialAccount, busy: true, error: null });
 const [webglUnavailable, setWebglUnavailable] = useState(false);
 const account = state.account;
 const expiryDate = account?.membership?.expiresAt ? new Date(account.membership.expiresAt) : null;
 const validExpiry = expiryDate && Number.isFinite(expiryDate.getTime());
 const pro = account?.membership?.tier === 'pro' && (!validExpiry || expiryDate.getTime() > Date.now());
 const membership = pro ? 'MU Pro 会员' : '标准账号';
 const expiry = validExpiry ? expiryDate.toLocaleString('zh-CN', { hour12: false }) : pro ? '长期有效' : '未开通 Pro 会员';
 const images = useMemo(() => cardImages(account, membership, expiry), [account, membership, expiry]);

 useEffect(() => {
  const dialog = dialogRef.current;
  dialog.showModal();
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
  return () => { active = false; unsubscribe(); store.dispose(); dialog.close(); };
 }, []);

 return <dialog ref={dialogRef} className="user-center-dialog" aria-labelledby="user-center-title"
  onKeyDown={event => { if (event.key === 'Tab') { event.preventDefault(); dialogRef.current.querySelector('.user-center-close').focus(); } }}
  onCancel={event => { event.preventDefault(); onClose(); }}
  onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
  <section className="user-center">
   <button className="user-center-close" type="button" aria-label="关闭个人中心" onClick={onClose} autoFocus><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
   <div className="user-center-stage" aria-hidden="true">
    {webglUnavailable ? <img className="user-center-static-card" src={images.front} alt="" /> : <Lanyard frontImage={images.front} backImage={images.back} strapImage={images.strap} cardColor="#f5f5f1" finish="glossy" metal="silver" size={0.57} strapLength={0.28} strapWidth={0.65} damping={0.7} breeze={0.12} onUnavailable={() => setWebglUnavailable(true)} />}
    {!webglUnavailable && <p className="user-center-card-hint">拖动卡片 · 点击翻面</p>}
   </div>
   <div className="user-center-info" aria-busy={state.busy}>
    <span className="user-center-eyebrow">PLAYER PROFILE</span>
    <h2 id="user-center-title">个人中心</h2>
    {account ? <><p className="user-center-name">{account.name || 'MU 用户'}</p><span className={`account-tier${pro ? ' is-pro' : ''}`}>{membership}</span>
     <dl><div><dt>邮箱</dt><dd>{account.email || '—'}</dd></div><div><dt>用户 ID</dt><dd>{account.id || '—'}</dd></div><div><dt>会员有效期</dt><dd>{expiry}</dd></div></dl>
     {validExpiry && expiryDate.getTime() <= Date.now() && <p className="user-center-status">Pro 会员已到期</p>}
    </> : <p className="user-center-status">{state.busy ? '正在获取用户信息…' : '用户信息暂未加载'}</p>}
    {state.error && <p className="account-feedback" role="status">{state.error.message}{account && ' 当前显示最近一次获取的信息。'}</p>}
   </div>
  </section>
 </dialog>;
}
