/* Progressive enhancement for the shipped resource dialogs and download page. */
(()=>{
 'use strict';
 const nativeFetch=window.fetch.bind(window),escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let detail,state,scope=0,pending=false,picker,fetching=new Set(),token;
 const optionCache=new Map(),busy=new Set(),active=new Set(['downloading','waiting_authorization','installing','waiting_install']);
 const size=n=>n>1024*1024?(n/1024/1024).toFixed(1)+' MB':n>1024?(n/1024).toFixed(1)+' KB':n+' B';
 async function api(action,body){
  if(!token){const r=await nativeFetch('/api/auth/config');token=(await r.json()).token;}
  const r=await nativeFetch('/api/'+action,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Moddock-Token':token},body:JSON.stringify(body)});
  const value=await r.json();if(!r.ok){if(r.status===401)reset();throw Error(value.message||value.error||'组合任务请求失败');}return value;
 }
 function reset(){scope++;detail=undefined;state=undefined;picker=undefined;optionCache.clear();fetching.clear();document.querySelectorAll('[data-bundle-ui]').forEach(n=>n.remove());}
 function schedule(){if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;enhanceDialog();renderTasks();});}
 // Observe copies of responses without changing the original response or auth flow.
 window.fetch=async function(input,init){
  const response=await nativeFetch(input,init);let path;try{path=new URL(typeof input==='string'?input:input.url,location.href).pathname;}catch{return response;}
  const epoch=scope;
  if(['/api/auth/logout','/api/auth/login','/api/auth/register'].includes(path)&&response.ok)reset();
  if(path==='/api/state'&&response.ok)void response.clone().json().then(data=>{if(scope===epoch){state=data;schedule();}}).catch(()=>{});
  if(['/api/sources/detail','/api/workshop/detail'].includes(path)&&response.ok&&typeof init?.body==='string'){
   let request;try{request=JSON.parse(init.body);}catch{return response;}
   void response.clone().json().then(data=>{if(scope===epoch&&Array.isArray(data.files)){detail={...request,files:data.files};picker=undefined;schedule();}}).catch(()=>{});
  }
  return response;
 };
 function enhanceDialog(){
  if(!detail)return;const modal=document.querySelector('#modal-root .modal');if(!modal)return;
  const controls=[...modal.querySelectorAll('[data-download-file],[data-workshop-download]')];
  if(!controls.length||controls.some(b=>!detail.files.some(f=>String(f.id)===(b.dataset.downloadFile||b.dataset.workshopDownload))))return;
  const target=modal.querySelector('#workshop-download-target')?.value||detail.gameId;
  const key=scope+':'+target+':'+detail.id,existing=modal.querySelector('[data-bundle-picker]');if(existing?.dataset.bundlePicker===key)return;
  const options=optionCache.get(key);
  if(!options){if(fetching.has(key))return;fetching.add(key);const epoch=scope;
   void api('downloads/bundles/options',{gameId:target,resourceId:detail.id}).then(value=>{if(scope===epoch){optionCache.set(key,value);schedule();}}).catch(()=>{}).finally(()=>fetching.delete(key));return;
  }
  existing?.remove();const fileList=controls[0].closest('.file-list');if(!fileList)return;
  picker={key,gameId:options.gameId,resourceId:detail.id,name:modal.querySelector('#modal-title')?.textContent||'MOD 文件组合',options,selected:[...options.recommended],element:document.createElement('section')};
  picker.element.className='bundle-picker';picker.element.dataset.bundleUi='';picker.element.dataset.bundlePicker=key;fileList.before(picker.element);renderPicker();
 }
 function renderPicker(){
  const p=picker;if(!p?.element.isConnected)return;const o=p.options;
  const chosen=p.selected.map(id=>o.files.find(f=>f.id===id)).filter(Boolean);
  p.element.innerHTML=`<div class="bundle-picker-head"><h3>组合下载与安装</h3><button type="button" class="btn small" data-bundle-recommend>推荐组合</button></div><p>${escape(o.message)}</p><div class="bundle-options">${o.files.map(f=>`<label class="bundle-option ${f.blocked?'is-blocked':''}"><input type="checkbox" data-bundle-file="${escape(f.id)}" ${p.selected.includes(f.id)?'checked':''} ${f.blocked?'disabled':''}><span><strong>${escape(f.name)}</strong><small>${escape(f.blocked||({main:'主文件',update:'补丁 / 更新',optional:'可选文件'})[f.kind]||'文件')} · ${size(f.size)}${f.version?' · v'+escape(f.version):''}</small></span></label>`).join('')}</div>${chosen.length?`<div class="bundle-order" aria-label="组合安装顺序"><strong>安装顺序 · 已选 ${chosen.length} 个</strong>${chosen.map((f,i)=>`<div><span>${i+1}. ${escape(f.name)}</span><button type="button" class="btn small" data-bundle-up="${escape(f.id)}" aria-label="上移 ${escape(f.name)}" ${i===0?'disabled':''}>↑</button><button type="button" class="btn small" data-bundle-down="${escape(f.id)}" aria-label="下移 ${escape(f.name)}" ${i===chosen.length-1?'disabled':''}>↓</button></div>`).join('')}</div>`:''}<p class="bundle-helper">全部下载完成后依次安装，保留每个文件的备份。遇到互斥版本、缺少前置或文件冲突时暂停，已安装的项目会保留。</p><div class="bundle-actions"><button type="button" class="btn" data-bundle-start="download" ${!chosen.length?'disabled':''}>一起下载${chosen.length?'（'+chosen.length+'）':''}</button><button type="button" class="btn primary" data-bundle-start="install" ${!chosen.length||!o.canAutoInstall?'disabled':''}>下载后自动安装</button></div>${!o.canAutoInstall?'<p>选择本机游戏安装位置后，可启用自动安装。</p>':''}<p class="bundle-feedback" role="status"></p>`;
 }
 function renderTasks(){
  const main=[...document.querySelectorAll('main')].find(m=>m.querySelector('h1')?.textContent.trim()==='下载管理');if(!main)return;
  let panel=main.querySelector('[data-bundle-tasks]');const bundles=state?.bundles||[];
  if(!bundles.length){panel?.remove();return;}const signature=JSON.stringify(bundles);
  if(panel?.dataset.signature===signature)return;
  if(!panel){panel=document.createElement('section');panel.dataset.bundleTasks='';panel.dataset.bundleUi='';panel.className='bundle-tasks';main.querySelector('.heading-row')?.after(panel);}
  panel.dataset.signature=signature;
  const labels={downloading:'组合下载中',waiting_authorization:'等待来源授权',waiting_install:'等待安装',installing:'组合安装中',downloaded:'全部已下载',completed:'组合安装完成',paused:'已暂停',download_failed:'下载未完成',install_failed:'安装未完成'};
  panel.innerHTML=`<h2>文件组合</h2>${bundles.map(b=>`<article class="bundle-task"><div class="bundle-picker-head"><strong>${escape(b.name)}</strong><span class="status">${escape(labels[b.status]||b.status)}</span></div><p>${escape(b.gameName)} · ${b.files.filter(f=>f.installed).length}/${b.files.length} 已安装</p><p role="status">${escape(b.message)}</p>${b.error?`<p class="bundle-error" role="alert">${escape(b.error)}</p>`:''}<details><summary>查看 ${b.files.length} 个文件与顺序</summary><ol>${b.files.map(f=>`<li>${escape(f.name)} <span>${f.installed?'已安装':f.downloadStatus==='completed'?'已下载':f.downloadStatus==='running'?'下载中 '+f.progress+'%':({queued:'排队中',failed:'下载失败',cancelled:'下载已取消',authorization_required:'等待授权'})[f.downloadStatus]||'等待处理'}</span></li>`).join('')}</ol></details><div class="bundle-actions">${active.has(b.status)?`<button type="button" class="btn small" data-bundle-pause="${escape(b.id)}">暂停自动安装</button>`:b.status==='completed'?'':`<button type="button" class="btn primary small" data-bundle-resume="${escape(b.id)}" ${busy.has(b.id)?'disabled':''}>${b.status==='downloaded'?'安装此组合':'继续组合任务'}</button>`}</div></article>`).join('')}`;
 }
 document.addEventListener('change',e=>{if(e.target.id==='workshop-download-target'){document.querySelector('[data-bundle-picker]')?.remove();picker=undefined;schedule();return;}
  const id=e.target.dataset.bundleFile;if(!id||!picker)return;if(e.target.checked){if(picker.selected.length>=20){e.target.checked=false;picker.element.querySelector('.bundle-feedback').textContent='一个组合最多选择 20 个文件';return;}picker.selected.push(id);}else picker.selected=picker.selected.filter(f=>f!==id);delete picker.submission;renderPicker();
 });
 document.addEventListener('click',async e=>{
  const button=e.target.closest('button');if(!button||button.disabled)return;const d=button.dataset;
  if('bundleRecommend'in d&&picker){picker.selected=[...picker.options.recommended];delete picker.submission;renderPicker();return;}
  const moved=d.bundleUp||d.bundleDown;if(moved&&picker){const i=picker.selected.indexOf(moved),next=i+(d.bundleUp?-1:1);if(i>=0&&next>=0&&next<picker.selected.length)[picker.selected[i],picker.selected[next]]=[picker.selected[next],picker.selected[i]];delete picker.submission;renderPicker();return;}
  if(d.bundleStart&&picker){const p=picker,epoch=scope;const selected=[...p.selected];if(!selected.length)return;
   const controls=[...p.element.querySelectorAll('button,input')];controls.forEach(b=>b.disabled=true);const feedback=p.element.querySelector('.bundle-feedback');feedback.textContent='正在创建组合任务…';
   const signature=JSON.stringify([selected,d.bundleStart]);if(p.submission?.signature!==signature)p.submission={signature,id:crypto.randomUUID()};
   try{await api('downloads/bundles/start',{gameId:p.gameId,resourceId:p.resourceId,name:p.name,fileIds:selected,installAfter:d.bundleStart==='install',requestId:p.submission.id});if(scope!==epoch)return;feedback.textContent='已加入组合队列。可在下载管理查看进度，关闭详情后任务仍会继续。';state=await api('state');schedule();}
   catch(error){if(scope===epoch)feedback.textContent=error.message;}
   finally{controls.forEach(b=>b.disabled=false);if(picker===p){p.element.querySelector('[data-bundle-start="install"]').disabled=!p.options.canAutoInstall;p.element.querySelectorAll('[data-bundle-file]').forEach(input=>input.disabled=!!p.options.files.find(f=>f.id===input.dataset.bundleFile)?.blocked);}}
  }
  const id=d.bundleResume||d.bundlePause;if(!id||busy.has(id))return;const epoch=scope;busy.add(id);button.disabled=true;
  try{await api('downloads/bundles/'+(d.bundlePause?'pause':'resume'),d.bundlePause?{id}:{bundleId:id,installAfter:true});if(scope===epoch){state=await api('state');schedule();}}
  catch(error){if(scope===epoch){const row=button.closest('.bundle-task');let errorNode=row?.querySelector('.bundle-error');if(row&&!errorNode){errorNode=document.createElement('p');errorNode.className='bundle-error';errorNode.setAttribute('role','alert');row.append(errorNode);}if(errorNode)errorNode.textContent=error.message;}}
  finally{busy.delete(id);button.disabled=false;}
 });
 new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
 let polling=false;setInterval(async()=>{if(polling||!state||!state.bundles?.length)return;if(!state.bundles.some(b=>active.has(b.status))&&!document.querySelector('[data-bundle-tasks]'))return;polling=true;const epoch=scope;
  try{const next=await api('state');if(epoch===scope){state=next;schedule();}}catch{}finally{polling=false;}
 },2500);
})();
