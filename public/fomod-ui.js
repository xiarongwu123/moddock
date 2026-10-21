// The host supplies its existing translator, modal and authenticated API.
export function createFomodUI({api,openModal,renderModal,modal,esc,translator}){
 const labels={SelectExactlyOne:'必须选择一项',SelectAtMostOne:'最多选择一项',SelectAtLeastOne:'至少选择一项',SelectAny:'可自由多选',SelectAll:'全部必选'};
 const types={Required:'必选',Recommended:'作者推荐',Optional:'可选',NotUsable:'当前不可用',CouldBeUsable:'请核对兼容性'};
 function selection(current){return Object.fromEntries(current.wizard.steps.flatMap(s=>s.groups.map(g=>[g.id,g.options.filter(o=>o.selected).map(o=>o.id)])));}
 async function translate(current){
  const rows=current.wizard.steps.flatMap(s=>[{key:s.id,name:s.name,summary:''},...s.groups.flatMap(g=>[{key:g.id,name:g.name,summary:''},...g.options.map(o=>({key:o.id,name:o.name,summary:o.description}))])]);
  current.translationStatus='loading';
  try{const translated=await translator.translateList(rows);current.translated=Object.fromEntries(rows.map((r,i)=>[r.key,translated[i]]));current.translationStatus='ready';}
  catch{current.translationStatus='error';}
  if(modal()===current)renderModal();
 }
 function show(result){const current={kind:'fomod',...result,selection:selection(result),translated:{},translationStatus:'loading'};openModal(current);void translate(current);}
 function content(current){
  const label=(row,field='name')=>esc(!current.original&&current.translated[row.id]?.[field==='description'?'summary':field]||row[field]);
  return {heading:'选择安装选项 · '+current.wizard.name,body:`<p>按作者提供的选项配置安装。生成方案后可核对每个目标文件。</p><div class="mod-translation-bar"><span role="status">${current.translationStatus==='loading'?'正在翻译为中文…':current.translationStatus==='ready'?'选项已翻译为中文':'翻译暂不可用，已显示作者原文'}</span><button class="btn small" data-fomod-original>${current.original?'查看中文':'查看原文'}</button>${current.translationStatus==='error'?'<button class="btn small" data-fomod-translate>重试翻译</button>':''}</div>${current.error?`<p class="notice failed" role="alert">${esc(current.error)}</p>`:''}${current.wizard.steps.map(s=>`<section class="fomod-step"><h3>${label(s)}</h3>${s.groups.map(g=>`<fieldset class="fomod-group"><legend>${label(g)} · ${labels[g.type]}</legend><div class="fomod-options">${g.options.map(o=>`<label class="fomod-option ${o.selected?'selected':''}"><input type="${['SelectExactlyOne','SelectAtMostOne'].includes(g.type)?'radio':'checkbox'}" name="${g.id}" data-fomod-option="${o.id}" data-fomod-group="${g.id}" ${o.selected?'checked':''} ${current.busy||o.type==='Required'||o.type==='NotUsable'||g.type==='SelectAll'?'disabled':''}><span><strong>${label(o)}</strong><small>${types[o.type]}</small><p>${label(o,'description')}</p>${!current.original?`<details><summary>作者原文</summary><p>${esc(o.name)}</p><p>${esc(o.description)}</p></details>`:''}</span></label>`).join('')}</div>${g.type==='SelectAtMostOne'?`<button class="text-link" data-fomod-clear="${g.id}" ${current.busy?'disabled':''}>清除此组选项</button>`:''}</fieldset>`).join('')}</section>`).join('')}${current.wizard.errors.map(e=>`<p class="notice">${esc(e)}</p>`).join('')}`,actions:`<button class="btn primary" data-fomod-plan ${current.busy?'disabled':''}>${current.busy?'正在核对…':'生成安装方案'}</button>`};
 }
 async function update(current,finalize=false){
  if(current.busy)return;current.busy=true;current.error='';renderModal();
  try{
   const result=await api('installations/auto',{jobId:current.jobId,fomodSelection:current.selection,fomodFinalize:finalize});
   if(modal()!==current)return;
   if(result.kind==='fomod-plan'){openModal({kind:'plan',plan:result.plan});return;}
   current.wizard=result.wizard;current.selection=selection(result);
  }catch(error){current.error=error.message;current.selection=selection(current);}
  finally{current.busy=false;if(modal()===current)renderModal();}
 }
 async function change(input){const current=modal();if(current?.kind!=='fomod'||current.busy)return;const group=current.wizard.steps.flatMap(s=>s.groups).find(g=>g.id===input.dataset.fomodGroup);if(!group)return;
  const values=current.selection[group.id]||[];
  current.selection[group.id]=input.type==='radio'?[input.dataset.fomodOption]:input.checked?[...new Set([...values,input.dataset.fomodOption])]:values.filter(id=>id!==input.dataset.fomodOption);await update(current);
 }
 async function click(d){const current=modal();if(current?.kind!=='fomod')return false;
  if('fomodOriginal'in d){current.original=!current.original;renderModal();}
  else if('fomodTranslate'in d){await translate(current);}
  else if('fomodPlan'in d)await update(current,true);
  else if(d.fomodClear){current.selection[d.fomodClear]=[];await update(current);}
  else return false;return true;
 }
 document.addEventListener('change',event=>{if(event.target.matches('[data-fomod-option]'))void change(event.target);});
 document.addEventListener('click',event=>{const button=event.target.closest('[data-fomod-plan],[data-fomod-original],[data-fomod-translate],[data-fomod-clear]');if(button)void click(button.dataset);});
 return {show,content,change,click};
}
