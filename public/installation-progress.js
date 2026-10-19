import './installation-progress.css';

export function renderInstallationProgress(task, { esc, icon }) {
 const running = task.status === 'running', failed = task.status === 'failed';
 const percent = Math.max(0, Math.min(task.status === 'completed' ? 100 : 99, Math.floor(task.percent || 0)));
 const steps = [
  ['environment', '检查环境'], ['inspect', '解析安装包'], ['extracting', '准备文件'],
  ['backup', '备份原文件'], ['installing', '写入并校验'],
 ];
 const phaseIndex = ({ environment: 0, inspect: 1, matching: 1, extracting: 2, checking: 2, backup: 3, installing: 4, finishing: 5, completed: 5 })[task.phase] ?? -1;
 return `<div class="installation-progress ${failed ? 'is-failed' : ''}" data-installation-status="${esc(task.status)}">
  <div class="installation-progress-summary"><span class="installation-progress-icon">${icon(running ? 'loader' : failed ? 'info' : 'check', running ? 'spinning' : '')}</span><div><strong>${esc(task.name)}</strong><p>${running ? '正在安装，请保持游匣运行' : failed ? '安装未完成' : '安装完成'}</p></div><span class="installation-progress-percent">${percent}%</span></div>
  <div class="installation-progress-track" role="progressbar" aria-label="MOD 安装进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-valuetext="${percent}% · ${esc(task.message)}"><div style="width:${percent}%"></div></div>
  <p class="installation-progress-message" role="${failed ? 'alert' : 'status'}">${esc(task.message)}</p>
  ${task.file ? `<p class="installation-progress-file" title="${esc(task.file)}">${esc(task.file)}</p>` : ''}
  ${task.total ? `<p class="installation-progress-count">当前阶段 ${task.processed || 0} / ${task.total} 个文件</p>` : ''}
  <ol class="installation-progress-steps" aria-label="安装步骤">${steps.map(([phase, label], index) => `<li class="${index < phaseIndex ? 'is-done' : index === phaseIndex && running ? 'is-current' : ''}"><span>${index < phaseIndex ? icon('check') : index + 1}</span>${label}</li>`).join('')}</ol>
 </div>`;
}
