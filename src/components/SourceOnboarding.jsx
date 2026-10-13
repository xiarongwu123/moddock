import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createSourceConnectionClient } from '../../public/app.js';
import { useDismissMotion } from '../motion/useMotion';
import Collapse from '../motion/Collapse';
import './SourceOnboarding.css';

const pending = status => ['connecting', 'waiting', 'reconnecting', 'saving'].includes(status);
const providers = [
 { id: 'nexus', name: 'Nexus Mods', mark: 'N', description: '连接账号，获取 MOD 下载授权', url: 'https://www.nexusmods.com/users/myaccount?tab=api' },
 { id: 'workshop', name: 'Steam 创意工坊', mark: 'S', description: 'API 连接可选，公开浏览与订阅可直接使用', url: 'https://steamcommunity.com/dev/apikey' },
];
function Check() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>; }

export default function SourceOnboarding({ onClose }) {
 const [client] = useState(createSourceConnectionClient);
 const [state, setState] = useState(null);
 const [expanded, setExpanded] = useState(null);
 const [key, setKey] = useState('');
 const [busy, setBusy] = useState(null);
 const [errors, setErrors] = useState({});
 const [loadError, setLoadError] = useState('');
 const dialog = useRef(null), alive = useRef(false);
 const operation = useRef(null), flowId = useRef(null), readVersion = useRef(0);
 const c = state?.connections || {}, sso = state?.nexusSso || {};
 const waiting = pending(sso.status);
 const anyConnected = c.nexusConnected || c.workshopConnected;
 const { stage, closing, dismiss } = useDismissMotion(onClose);

 async function read() {
  const version = ++readVersion.current;
  try {
   const next = await client.read();
   if (alive.current && version === readVersion.current) { setState(next); setLoadError(''); }
  } catch (error) { if (alive.current && version === readVersion.current) setLoadError(error.message); }
 }
 useLayoutEffect(() => {
  const node = dialog.current;
  node.showModal();
  node.querySelector('h2').focus();
  return () => {
   node.close();
   const heading = document.querySelector('#app h1');
   heading?.setAttribute('tabindex', '-1');
   heading?.focus({ preventScroll: true });
  };
 }, []);
 useEffect(() => {
  alive.current = true;
  void read();
  const timer = setInterval(() => { if (!operation.current) void read(); }, 800);
  return () => {
   alive.current = false; clearInterval(timer); readVersion.current++;
   // A late start response must only cancel this dialog's flow, never a newer one.
   Promise.resolve(operation.current).catch(() => {}).then(() => {
    if (flowId.current) return client.cancel(flowId.current);
   }).catch(() => {});
  };
 }, [client]);
 useEffect(() => {
  if (sso.status === 'connected') {
   setErrors(current => ({ ...current, nexus: '' }));
   if (document.activeElement === document.body) dialog.current?.querySelector('#onboarding-nexus-title')?.focus();
  }
 }, [sso.status]);

 async function run(source, action) {
  if (operation.current) return;
  setBusy(source); setErrors(current => ({ ...current, [source]: '' }));
  const work = Promise.resolve().then(action);
  operation.current = work;
  try { await work; if (alive.current) await read(); }
  catch (error) { if (alive.current) setErrors(current => ({ ...current, [source]: error.message })); }
  finally { if (operation.current === work) operation.current = null; if (alive.current) setBusy(null); }
 }
 function edit(source) { setExpanded(current => current === source ? null : source); setKey(''); setErrors(current => ({ ...current, [source]: '' })); }
 function connect(source) {
  if (source !== 'nexus' || !sso.available) { edit(source); return; }
  void run(source, async () => {
   const flow = await client.start(); flowId.current = flow.id;
  });
 }
 function save(event, source) {
  event.preventDefault();
  const value = key.trim();
  if (!value || (source === 'workshop' && !/^[a-f\d]{32}$/i.test(value))) {
   setErrors(current => ({ ...current, [source]: !value ? '请粘贴 API Key' : 'Steam Web API Key 应为 32 位十六进制字符' }));
   dialog.current?.querySelector(`#onboarding-${source}-key`)?.focus(); return;
  }
  void run(source, async () => {
   await client.connect(source, value);
   if (alive.current) { setKey(''); setExpanded(null); dialog.current?.querySelector(`#onboarding-${source}-title`)?.focus(); }
  });
 }
 function close() {
  setKey(''); dismiss();
 }
 function keepFocus(event) {
  if (event.key !== 'Tab') return;
  const controls = [...dialog.current.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled)')].filter(node => !node.closest('[inert]'));
  const first = controls[0], last = controls.at(-1);
  if ((!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first)) {
   event.preventDefault(); (event.shiftKey ? last : first)?.focus();
  }
 }
 return createPortal(<dialog ref={dialog} className="source-onboarding" data-stage={stage} inert={closing} aria-labelledby="source-onboarding-title" aria-describedby="source-onboarding-description" onKeyDown={keepFocus} onCancel={event => { event.preventDefault(); close(); }}>
  <button className="source-onboarding-close" type="button" aria-label="关闭连接引导" onClick={close}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
  <header className="source-onboarding-header"><span className="source-onboarding-welcome"><Check />注册成功</span><h2 id="source-onboarding-title" tabIndex={-1}>连接你的 MOD 来源</h2><p id="source-onboarding-description">连接常用来源，让下一次下载更轻松。</p></header>
  {!state && !loadError && <div className="source-onboarding-loading" role="status">正在读取连接状态…</div>}
  {loadError && <div className="source-onboarding-error" role="alert">{loadError}<button type="button" onClick={() => void read()}>重试</button></div>}
  {state && <div className="source-onboarding-providers">{providers.map(provider => {
   const source = provider.id, connected = source === 'nexus' ? c.nexusConnected : c.workshopConnected;
   const loading = busy === source || (source === 'nexus' && waiting);
   const error = errors[source] || (!connected && source === 'nexus' && ['error', 'expired'].includes(sso.status) ? sso.message : '');
   return <section className="source-onboarding-provider" data-provider={source} data-connected={!!connected} key={source} aria-labelledby={`onboarding-${source}-title`}>
    <div className="source-onboarding-provider-head"><span className={`source-onboarding-mark is-${source}`} aria-hidden="true">{provider.mark}</span><div className="source-onboarding-provider-copy"><h3 id={`onboarding-${source}-title`} tabIndex={-1}>{provider.name}</h3><p>{connected ? c.saved?.[source] ? '已加密保存，下次自动连接' : '已连接，本次运行有效' : provider.description}</p></div>
     {connected && !loading ? <span className="source-onboarding-connected" role="status"><Check />{source === 'workshop' ? '已配置' : '已连接'}</span> : source === 'nexus' && waiting ? <button className="source-onboarding-connect" type="button" disabled={!!busy} onClick={() => void run(source, () => client.cancel(sso.id))}>取消</button> : <button className="source-onboarding-connect" type="button" disabled={!!busy} aria-expanded={source === 'workshop' || !sso.available ? expanded === source : undefined} aria-controls={source === 'workshop' || !sso.available ? `onboarding-${source}-form` : undefined} onClick={() => connect(source)}>{loading ? '连接中…' : expanded === source ? '收起' : '连接'}</button>}
    </div>
    {source === 'nexus' && waiting && <p className="source-onboarding-progress" role="status"><span className="source-onboarding-spinner" />{sso.status === 'saving' ? '正在保存授权…' : sso.status === 'reconnecting' ? '正在恢复连接…' : '请在浏览器中确认授权，完成后会自动更新。'}</p>}
    <Collapse open={expanded === source && !connected} onEntered={() => dialog.current?.querySelector(`#onboarding-${source}-key`)?.focus()}><form id={`onboarding-${source}-form`} className="source-onboarding-form" onSubmit={event => save(event, source)}>
     <div className="source-onboarding-field-title"><label htmlFor={`onboarding-${source}-key`}>{source === 'workshop' ? 'Steam Web API Key' : 'Nexus API Key'}</label><a href={provider.url} target="_blank" rel="noopener noreferrer">获取 Key ↗</a></div>
     <div className="source-onboarding-field"><input id={`onboarding-${source}-key`} type="password" autoComplete="off" spellCheck={false} maxLength={2048} placeholder="粘贴 API Key" value={key} disabled={!!busy} aria-invalid={!!error} aria-describedby={error ? `onboarding-${source}-error` : undefined} onChange={event => { setKey(event.target.value); setErrors(current => ({ ...current, [source]: '' })); }} /><button type="submit" disabled={!!busy || !key.trim()}>{busy === source ? '保存中…' : '保存连接'}</button></div>
    </form></Collapse>
    {error && <p className="source-onboarding-error" id={`onboarding-${source}-error`} role="alert">{error}{source === 'nexus' && sso.available && expanded !== source && <button type="button" disabled={!!busy} onClick={() => edit(source)}>手动输入 Key</button>}</p>}
   </section>;
  })}</div>}
  {state && !c.persistent && <p className="source-onboarding-storage" role="status">当前环境仅支持本次运行，下次需重新连接。</p>}
  <footer className="source-onboarding-footer"><span>之后可在设置中随时修改</span><button type="button" className={anyConnected ? 'is-ready' : ''} onClick={close}>{anyConnected ? '开始使用' : '暂时跳过'}</button></footer>
 </dialog>, document.body);
}
