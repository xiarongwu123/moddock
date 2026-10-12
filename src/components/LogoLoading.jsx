import './LogoLoading.css';

export default function LogoLoading({ label = '正在加载…', size = 200, className = '' }) {
 return <div className={`logo-loading ${className}`.trim()} role="status">
  <img src="/logo-loading.svg" alt="" aria-hidden="true" style={{ width: size }} />
  <span className="logo-loading__label">{label}</span>
 </div>;
}
