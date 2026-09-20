function withBusy(el,fn){
if(!el||el.dataset.busy==='1')return Promise.resolve(false);
el.dataset.busy='1';el.setAttribute('aria-busy','true');
const prev=el.disabled;el.disabled=true;
const release=()=>{el.dataset.busy='';delete el.dataset.busy;el.removeAttribute('aria-busy');el.disabled=prev};
let p;
try{p=typeof fn==='function'?fn():Promise.resolve(fn)}catch(err){release();throw err}
return Promise.resolve(p).then(v=>{release();return v===undefined?true:v},e=>{release();throw e})}
const ACTIONS={
copy(el){
if(el.dataset.busy==='1')return;
const valEl=el.dataset.copyId?$(el.dataset.copyId):null;
const val=el.dataset.copyValue||(valEl?valEl.textContent:'');
el.dataset.busy='1';el.setAttribute('aria-busy','true');
let p;
try{p=copyText(val||'')}catch(err){p=Promise.resolve(false)}
p.then(ok=>{
delete el.dataset.busy;el.removeAttribute('aria-busy');
if(!ok){toast(t('share.copy_failed'),'err');return}
el.classList.add('copied');
const use=el.querySelector('use');
if(use){use.setAttribute('href','#i-check');setTimeout(()=>{use.setAttribute('href','#i-copy');el.classList.remove('copied')},900)}
toast(t('common.copied'),'ok')})},
reveal(el){
const inp=$(el.dataset.target);
if(!inp)return;
const show=inp.type==='password';
inp.type=show?'text':'password';
el.setAttribute('aria-pressed',String(show));
el.setAttribute('aria-label',t(show?'common.hide':'common.reveal'));
const use=el.querySelector('use');
if(use)use.setAttribute('href',show?'#i-eye-off':'#i-eye')},
generate(el){
const inp=$(el.dataset.target);
if(!inp)return;
captureUndoBase(inp);
inp.value=genFor(el.dataset.gen);
updateCharCount(inp);
inp.dispatchEvent(new Event('change',{bubbles:true}));
toast(t('common.generated'),'ok')},
 qr(el){openQr(el.dataset.qr)},
 logout(){
confirmDialog('confirm.logout_title','confirm.logout_body',true).then(async yes=>{
if(!yes)return;
try{await api('api/auth/logout',{method:'POST',mutate:true})}catch(err){}
location.replace(BASE+'login')})},
apply(){
withBusy($('apply-btn'),async()=>{
$('apply-btn').textContent=t('common.applying');
try{for(const sec of[...S.dirty])await applySection(sec)}
finally{$('apply-btn').textContent=t('common.apply')}})},
discard(){
const n=S.dirty?S.dirty.size:0;
if(!n)return;
confirmDialog('confirm.discard.title','confirm.discard.message',true,{n:n}).then(async yes=>{
if(!yes)return;
await withBusy($('discard-btn'),()=>{[...S.dirty].forEach(sec=>discardSection(sec))})})},
 'settings-import'(el){
 const fileInput=$('settings-import-file');
 fileInput.onchange=async()=>{
 const file=fileInput.files&&fileInput.files[0];
 if(!file)return;
 try{
 const parsed=JSON.parse(await file.text());
 if(parsed&&parsed.kind==='q-proxy-settings'&&parsed.settings){
 if(!(await confirmDialog('confirm.import.title','confirm.import.message',true,{name:file.name})))return;
 await withBusy(el,()=>api('api/settings/import',{method:'POST',body:{settings:parsed.settings}}));
 toast(t('general.backup.imported'),'ok');location.reload()}
 else toast(t('general.backup.badfile'),'err')}
 catch(err){if(err&&err.fields){const first=String(Object.values(err.fields)[0]);toast(first.indexOf('pre-cut')>=0?t('general.backup.precut'):first,'err')}else toastErr(err)}
 finally{fileInput.value=''}};
 fileInput.click()},
 'reset-defaults'(el){
 confirmDialog('confirm.reset_title','confirm.reset_body',true).then(async yes=>{
if(!yes)return;
try{await withBusy(el,()=>api('api/settings/reset',{method:'POST',body:{}}));location.reload()}catch(err){toastErr(err)}})},
 accent(el){
 const a=el.dataset.accent||'cyan';
 if(a==='cyan')delete document.documentElement.dataset.accent;
 else document.documentElement.dataset.accent=a;
 try{localStorage.setItem('qp_accent',a)}catch(err){}
 document.querySelectorAll('.swatch').forEach(b=>b.setAttribute('aria-pressed',String(b===el)))},
 'warp-generate-open'(){openWarpModal('m-warp-generate')},
 'warp-import-open'(){openWarpModal('m-warp-import')},
 'warp-preset-add'(){openWarpModal('m-warp-preset')},
 'warp-preset-edit'(el){openWarpModal('m-warp-preset',el.dataset.id)},
 'close-warp-modal'(el){closeModal(el.dataset.modal)},
 'warp-regen'(el){
 confirmDialog('warp.confirm.regen_title','warp.confirm.regen_body',true).then(async yes=>{
 if(!yes)return;
 try{const d=await withBusy(el,()=>api('api/warp/account/'+el.dataset.id+'/regenerate-token',{method:'POST',body:{}}));
 const tok=d&&d.token;if(tok&&S.warp){const url=warpSubUrl(tok,'wireguard-conf');openShareSheet({title:t('share.title_rotated'),url:url,fileName:'warp-'+el.dataset.id+'.conf',note:'once'})}else toast(t('warp.toast.regen'),'ok');invalidateWarp();loadWarpIfNeeded().then(()=>renderWarpDetail(el.dataset.id))}catch(err){toastErr(err)}})},
 'warp-delete'(el){
 confirmDialog('warp.confirm.delete_title','warp.confirm.delete_body',true).then(async yes=>{
 if(!yes)return;
 try{await withBusy(el,()=>api('api/warp/account/'+el.dataset.id,{method:'DELETE',mutate:true}));
 toast(t('warp.toast.deleted'),'ok');invalidateWarp();location.hash='#/warp'}catch(err){toastErr(err)}})},
  'warp-save'(el){
 const id=el.dataset.id;const field=el.dataset.field;
 const patch={};
 if(field==='name')patch.name=$('warp-name').value.trim();
 if(field==='dns')patch.dns=$('warp-dns').value.trim();
 withBusy(el,()=>api('api/warp/account/'+id,{method:'PUT',body:patch})
 .then(()=>{toast(t('common.saved'),'ok');invalidateWarp();return loadWarpIfNeeded().then(()=>renderWarpDetail(id))})
 .catch(err=>toastErr(err)))},
  'warp-amnezia-save'(el){
   const body={};
   ['Jc','Jmin','Jmax','S1','S2','S3','S4','H1','H2','H3','H4'].forEach(k=>{const el2=$('amz-'+k);if(!el2)return;const v=el2.value.trim();if(v.length>0)body[k]=v});
   const i1el=$('amz-I1');const i1=i1el?i1el.value.trim():'';if(i1.length>0)body.I1=i1;
   const tg=$('warp-amnezia-toggle');const on=tg?tg.checked:!!(S.warp&&S.warp.amneziaEnabled);
   withBusy(el,()=>api('api/warp/settings/amnezia',{method:'PUT',body:{amnezia:body,amneziaEnabled:on}})
   .then(d=>{if(!S.warp)S.warp={accounts:[],presets:[],amnezia:null,amneziaEnabled:false};S.warp.amnezia=d.amnezia;S.warp.amneziaEnabled=d.amneziaEnabled===true;toast(t('common.saved'),'ok')})
   .catch(err=>toastErr(err)))},
  'warp-preset-del'(el){
  const p=S.warp&&S.warp.presets?S.warp.presets.find(x=>x.id===el.dataset.id):null;
  confirmDialog('confirm.presetDelete.title','confirm.presetDelete.message',true,{name:p?p.name:'',n:p&&p.endpoints?p.endpoints.length:0}).then(async yes=>{
  if(!yes)return;
  try{await withBusy(el,()=>api('api/warp/presets/'+el.dataset.id,{method:'DELETE',mutate:true}));
  toast(t('warp.toast.presetDeleted'),'ok');invalidateWarp();loadWarpIfNeeded().then(renderWarpSection)}catch(err){toastErr(err)}})},
 'warp-endpoints-save'(el){
 const ids=[...document.querySelectorAll('#warp-endpoints input[data-warp-preset]')].filter(c=>c.checked).map(c=>c.dataset.warpPreset);
 const ta=$('warp-eps-custom');
 const custom=ta?ta.value.split(/\r?\n/).map(l=>l.trim()).filter(l=>l.length>0):[];
 const showErr=msg=>{const fw=ta?ta.closest('.field'):null;const err=fw?fw.querySelector('.field__error'):null;if(err)err.textContent=msg;if(ta)ta.setAttribute('aria-invalid','true')};
 const curIds=new Set(Array.isArray(S.set&&S.set.warpPresets)?S.set.warpPresets:[]);
 const curCustom=Array.isArray(S.set&&S.set.warpCustomEndpoints)?S.set.warpCustomEndpoints.map(l=>String(l).trim()).filter(l=>l.length>0):[];
 const same=ids.length===curIds.size&&ids.every(id=>curIds.has(id))&&custom.length===curCustom.length&&custom.every((l,i)=>l===curCustom[i]);
 const doSave=()=>withBusy(el,()=>api('api/settings/save',{method:'PUT',body:Object.assign({warpPresets:ids,warpCustomEndpoints:custom},typeof S.rev==='number'?{baseRev:S.rev}:{})})
 .then((d)=>{if(d&&typeof d.rev==='number')S.rev=d.rev;Object.assign(S.set,{warpPresets:ids,warpCustomEndpoints:custom});toast(t('common.saved'),'ok');invalidateWarp();return loadWarpIfNeeded().then(renderWarpSection)})
 .catch(err=>{if(err&&err.code==='CONFLICT'){toast(t('settings.conflict'),'err');rebaseSettings().then(()=>renderWarpSection());return}if(err&&err.fields&&(err.fields.warpPresets||err.fields.warpCustomEndpoints))showErr(err.fields.warpCustomEndpoints||err.fields.warpPresets);else toastErr(err)}));
 const accounts=S.warp&&S.warp.accounts?S.warp.accounts.length:0;
 if(accounts>0&&!same){confirmDialog('warp.confirm.endpoints_title','warp.confirm.endpoints_body',true,{n:accounts}).then(yes=>{if(yes)doSave()});return}
 doSave()},
  'shortcuts'(){renderShortcuts();openModal('m-keys')},
  'boot-retry'(){boot()},
 'close-keys'(){closeModal('m-keys')},
 'wizard-skip'(){wizardDone()},
 'wizard-protocols'(){wizardDone();location.hash='#/settings/protocols'},
 'wizard-replay'(){
 closeModal('m-keys');
 try{localStorage.removeItem('qp_wizard_done')}catch(e){}
 maybeWizard()},
 'backup-export'(){try{localStorage.setItem(EXPORT_KEY,String(Date.now()))}catch(e){}setTimeout(maybeBackupBanner,500)},
 'backup-dismiss'(){try{localStorage.setItem(BACKUP_DISMISS,String(Date.now()))}catch(e){}$('backup-banner').hidden=true},
 'tg-setup'(el){
 withBusy(el,async()=>{
 try{const d=await api('api/telegram/setup',{method:'POST',body:{}});
 if(d.ok)toast(t('tg.setup_ok'),'ok');
 else toast(t('tg.setup_fail')+(d.description?' · '+d.description:''),'err')}
 catch(err){toastErr(err)}})()},
 'tg-remove'(el){
 withBusy(el,async()=>{
 try{const d=await api('api/telegram/remove',{method:'POST',body:{}});
 if(d.ok)toast(t('tg.remove_ok'),'ok');
 else toast(t('tg.remove_fail')+(d.description?' · '+d.description:''),'err')}
 catch(err){toastErr(err)}})()},
  'theme-toggle'(){const cur=getTheme();const nxt=cur==='dark'?'light':'dark';try{localStorage.setItem(THEME_KEY,nxt)}catch(e){}applyTheme(nxt);},
  'addr-probe'(el){
   withBusy(el,()=>api('api/address-probe',{fresh:true})
   .then(d=>{const r=d&&d.results||[];const ok=r.filter(x=>x.status==='ok').length;toast(t('endpoints.probe.done',{ok:ok,n:r.length}),ok===r.length&&r.length>0?'ok':'err')})
   .catch(err=>toastErr(err)))},
  'pool-fetch'(el){loadPool(false)},
  'pool-test'(el){loadPool(true)},
  'home-pool-refresh'(el){loadHomePool()},
  'pool-add'(el){
   const addr=el.dataset.addr||'';
   const ta=document.querySelector('#sp-egress [data-bind="proxyIps"]');
   if(ta&&addr){captureUndoBase(ta);const lines=ta.value.split('\n').map(x=>x.trim()).filter(Boolean);
   if(!lines.some(x=>x.toLowerCase()===addr.toLowerCase())){lines.push(addr);}
   ta.value=lines.join('\n');markDirty(ta);validateOneEditor(ta)}
   else toastErr()},
  'section-save'(el){withBusy(el,()=>applySection(el.dataset.sec))},
  'change-password'(el){
 (async()=>{
 const cur=$('sec-cur'),nw=$('sec-new'),cf=$('sec-confirm');
 if(!cur||!nw||!cf)return;
 const clearFw=id=>{const fw=$(id);if(!fw)return;fw.classList.remove('field--error');const p=fw.querySelector('.field__error');if(p)p.textContent=''};
 const setFw=(id,msg)=>{const fw=$(id);if(!fw)return;fw.classList.add('field--error');const p=fw.querySelector('.field__error');if(p)p.textContent=msg};
 clearFw('fw-sec-cur');clearFw('fw-sec-new');clearFw('fw-sec-cf');
 if(nw.value.length<8){setFw('fw-sec-new',t('security.rule'));nw.focus();return}
 if(nw.value!==cf.value){setFw('fw-sec-cf',t('security.mismatch'));cf.focus();return}
 el.disabled=true;
 try{
 await api('api/auth/password',{method:'POST',body:{currentPassword:cur.value,newPassword:nw.value},keep401:true});
 toast(t('security.changed'),'ok');
 cur.value='';nw.value='';cf.value='';
 try{sessionStorage.removeItem('qproxy_force_change')}catch(e){}
 try{sessionStorage.removeItem('qpc:api/bootstrap')}catch(e){}
 try{sessionStorage.removeItem('qpe:api/bootstrap')}catch(e){}
 hideForceChange();
 boot()
 }
 catch(err){
 if(err&&err.status===401)setFw('fw-sec-cur',t('security.wrong_current'));
 else if(err&&err.fields&&err.fields.newPassword)setFw('fw-sec-new',String(err.fields.newPassword));
 else toastErr(err)}
 finally{el.disabled=false}})()}};
function forceFlagged(){
if(S.set&&S.set.passwordIsBootstrap===true)return true;
try{return sessionStorage.getItem('qproxy_force_change')==='1'}catch(e){return false}}
function showForceChange(){
if(S.forceChange)return;
S.forceChange=true;
try{sessionStorage.setItem('qproxy_force_change','1')}catch(e){}
const tb=document.querySelector('header.topbar');
if(tb)tb.hidden=true;
const mn=$('main');
if(mn)mn.hidden=true;
const ab=$('applybar');
if(ab)ab.hidden=true;
const sec=$('force-change');
if(!sec)return;
const host=$('fc-fields');
if(host&&!host.dataset.built){
host.dataset.built='1';
host.innerHTML=securityCardHtml()}
const ti=$('fc-title');
if(ti)ti.textContent=t('onboarding.forcechange.title');
const ex=$('fc-explainer');
if(ex)ex.textContent=t('onboarding.forcechange.explainer');
sec.hidden=false;
sec.style.display='flex';
const cur=$('sec-cur');
if(cur)cur.focus()}
function hideForceChange(){
S.forceChange=false;
const sec=$('force-change');
if(sec){sec.hidden=true;sec.style.display=''}
const tb=document.querySelector('header.topbar');
if(tb)tb.hidden=false;
const mn=$('main');
if(mn)mn.hidden=false;
const ab=$('applybar');
if(ab&&!(S.dirty&&S.dirty.size>0))ab.hidden=true}
function onDocClick(e){
const el=e.target.closest('[data-action]');
if(el){
const fn=ACTIONS[el.dataset.action];
if(fn)fn(el);
return}
const retry=e.target.closest('[data-retry]');
if(retry){
const k=retry.getAttribute('data-retry');
if(k==='home-pool')loadHomePool();
return}
const wretry=e.target.closest('[data-warp-retry]');
if(wretry){wretry.disabled=true;retryWarp(wretry.getAttribute('data-warp-retry')||'');return}
const chip=e.target.closest('[data-chip]');
if(chip){handleChip(chip);return}
const mode=e.target.closest('[data-mode]');
if(mode){
S.subMode=mode.dataset.mode;try{localStorage.setItem('qp_submode',S.subMode)}catch(err){}
mode.parentElement.querySelectorAll('button').forEach(b=>b.setAttribute('aria-checked',String(b===mode)));
const urls=[...S.subs].sort((a,b)=>(a.format==='base64'?-1:0)-(b.format==='base64'?-1:0));
document.querySelectorAll('#home-body [id^="sub-u"] code').forEach((code,i)=>{
const entry=urls[i];
if(!entry) return;
const newUrl=subUrlWithMode(entry.url);
code.textContent=newUrl;
const wrapper=code.closest('.copy-field');
if(wrapper){
const qrBtn=wrapper.querySelector('[data-qr]');
if(qrBtn) qrBtn.setAttribute('data-qr',newUrl);
}
})
return}}
function handleChip(chip){
const group=chip.closest('[data-type="chips"]');
if(!group)return;
captureUndoBase(chip);
group.querySelectorAll('.chip').forEach(c=>c.setAttribute('aria-checked','false'));
chip.setAttribute('aria-checked','true');
markDirty(chip);
clearTimeout(leTimer);
if(group.hasAttribute('data-fpreset')){
applyFragmentPresetUi(chip.dataset.preset)}
refreshShowIf();
validateAllLineEditors()}
function onChange(e){
if(e.target.closest('[data-kill]')){setKillSwitch(e.target.checked);return}
const bind=e.target.closest('[data-bind]');
if(bind){
if(bind.tagName==='TEXTAREA')validateOneEditor(bind);
markDirty(bind);
if(/^vlessEnabled$/.test(bind.dataset.bind))applyProtoDim()
if(bind.dataset.bind==='echAuto'||bind.dataset.bind==='echServerName')updateEchPreview()}}
let dirtyTimer=null;
function onInput(e){
const bind=e.target.closest('[data-bind]');
if(!bind)return;
if(bind.tagName==='TEXTAREA'){clearTimeout(leTimer);leTimer=setTimeout(()=>validateOneEditor(bind),250);clearTimeout(dirtyTimer);dirtyTimer=setTimeout(()=>markDirty(bind),120);return}
else if(bind.tagName==='INPUT'){
const msg=scalarError(bind);
const fw=fieldWrapOf(bind);
if(!msg&&fw&&fw.classList.contains('field--error')){fw.classList.remove('field--error');bind.removeAttribute('aria-invalid')}
updateCharCount(bind)}
if(bind.dataset.bind==='echAuto'||bind.dataset.bind==='echServerName')updateEchPreview()
clearTimeout(dirtyTimer);dirtyTimer=setTimeout(()=>markDirty(bind),120)}
let eventsWired=false;
function wireEvents(){
if(eventsWired)return;
eventsWired=true;
document.addEventListener('click',onDocClick);
document.addEventListener('change',onChange);
document.addEventListener('input',onInput);
document.addEventListener('focusin',e=>{captureUndoBase(e.target)});
document.addEventListener('focusout',e=>{
const el=e.target;
if(el&&el.dataset&&el.dataset.bind&&el.tagName==='INPUT')blurValidateEl(el)});
$('m-confirm').addEventListener('click',e=>{if(e.target===$('m-confirm'))settleConfirm(false)});
$('m-share').addEventListener('click',e=>{if(e.target===$('m-share'))closeModal('m-share')});
$('cf-cancel').addEventListener('click',()=>settleConfirm(false));
$('cf-ok').addEventListener('click',()=>settleConfirm(true));
$('m-confirm').addEventListener('keydown',e=>{if(e.key==='Tab')trapFocus($('m-confirm'),e)});
['m-warp-generate','m-warp-import','m-warp-preset','m-share','m-keys','m-wizard'].forEach(id=>{const el=$(id);if(el)el.addEventListener('keydown',e=>{if(e.key==='Tab')trapFocus(el,e)})});
document.addEventListener('keydown',globalKeys);
document.addEventListener('keydown',e=>{
if(e.key==='Escape'){
if(!$('m-confirm').hidden)settleConfirm(false);
else if(!$('m-share').hidden)closeModal('m-share');
else if(!$('m-warp-generate').hidden)closeModal('m-warp-generate');
else if(!$('m-warp-import').hidden)closeModal('m-warp-import');
else if(!$('m-warp-preset').hidden)closeModal('m-warp-preset');
else if(!$('m-wizard').hidden)wizardDone();
else if(!$('m-keys').hidden)closeModal('m-keys')}});
window.addEventListener('hashchange',navigate);
wireApplyBarUr();
window.addEventListener('beforeunload',e=>{
if(S.dirty.size){e.preventDefault();e.returnValue=''}});
wireTabKeys($('nav'),'.tab');
wireTabKeys($('subtabs'),'.subtab');
$('wg-go').addEventListener('click',()=>withBusy($('wg-go'),async()=>{
try{const d=await api('api/warp/account/generate',{method:'POST',body:{name:$('wg-name').value.trim()}});
closeModal('m-warp-generate');toast(t('warp.toast.generated'),'ok');invalidateWarp();location.hash='#/warp/'+d.account.id}
catch(err){toastErr(err)}}));
$('wi-go').addEventListener('click',()=>withBusy($('wi-go'),async()=>{
try{const d=await api('api/warp/account/import',{method:'POST',body:{name:$('wi-name').value.trim(),config:$('wi-config').value}});
closeModal('m-warp-import');toast(t('warp.toast.imported'),'ok');invalidateWarp();location.hash='#/warp/'+d.account.id}
catch(err){if(err&&err.fields&&err.fields.config){$('wi-error').textContent=err.fields.config;$('wi-error').style.display='block';const ta=$('wi-config');if(ta){ta.setAttribute('aria-invalid','true');const eid='err-wi';$('wi-error').id=eid;ta.setAttribute('aria-describedby',eid);announce($('wi-error').textContent)}}else toastErr(err)}}));
$('wp-go').addEventListener('click',async()=>{
const btn=$('wp-go');btn.disabled=true;
const m=$('m-warp-preset');const editId=m.dataset.presetId||'';
const endpoints=$('wp-endpoints').value.split(/\r?\n/).map(l=>l.trim()).filter(l=>l.length>0);
const dns=$('wp-dns').value.trim();
try{
if(editId)await api('api/warp/presets/'+editId,{method:'PUT',body:{name:$('wp-name').value.trim(),endpoints,dns:dns.length?dns:null}});
else await api('api/warp/presets',{method:'POST',body:{name:$('wp-name').value.trim(),endpoints,dns:dns.length?dns:null}});
closeModal('m-warp-preset');toast(t('common.saved'),'ok');invalidateWarp();loadWarpIfNeeded().then(renderWarpSection)}
catch(err){if(err&&err.fields){$('wp-error').textContent=Object.values(err.fields)[0]||t('common.error');$('wp-error').style.display='block'}else toastErr(err)}
finally{btn.disabled=false}})}
function wireTabKeys(bar,sel){
bar.addEventListener('keydown',e=>{
const tabs=[...bar.querySelectorAll(sel)];
const idx=tabs.indexOf(document.activeElement);
if(idx<0)return;
const rtl=document.documentElement.dir==='rtl';
let next=null;
if((e.key==='ArrowRight'&&!rtl)||(e.key==='ArrowLeft'&&rtl))next=(idx+1)%tabs.length;
else if((e.key==='ArrowLeft'&&!rtl)||(e.key==='ArrowRight'&&rtl))next=(idx-1+tabs.length)%tabs.length;
else if(e.key==='Home')next=0;
else if(e.key==='End')next=tabs.length-1;
if(next!=null){e.preventDefault();tabs[next].focus();tabs[next].click()}})}
function openQr(url){
openShareSheet({url:url})}
function currentSection(){
const r=parseRoute();
return r.view==='settings'?r.sec:'general'}
function renderBootSkeleton(){const body=$('home-body');if(!body)return;body.innerHTML='<div class="loading-box" role="status">'+loadingBox({rows:4,label:'common.loading'})+'</div>'}
async function boot(){
buildShell();
wireEvents();
renderBootSkeleton();
try{
const d=await api('api/bootstrap');
S.set=d.settings||{};
S.rev=typeof S.set.rev==='number'?S.set.rev:null;
S.status=d.status||null;
S.subs=(d.subUrls&&d.subUrls.urls)||[]}
catch(e){
if(e&&e.status===401)return;
if(e&&e.code==='PASSWORD_CHANGE_REQUIRED')return;
S.set={};
toastErr(e);
const body=$('home-body');if(body)body.innerHTML=errorCard({title:'common.error',msg:e&&e.status===0?'toast.networkError':null,retryAction:'data-action="boot-retry"'});
return}
try{if(!/(?:^|;\s*)qp_lang=(en|fa)/.test(document.cookie)&&S.set&&(S.set.language==='en'||S.set.language==='fa')){LANG=S.set.language;setLangCookie(LANG);document.documentElement.lang=LANG;document.documentElement.dir=LANG==='fa'?'rtl':'ltr';buildShell()}}catch(e){}
if(forceFlagged())showForceChange();
if(S.forceChange)return;
renderSettings();
renderHome();
navigate();
maybeBackupBanner();
if(!S.forceChange)maybeWizard()}
function wizardDone(){
closeModal('m-wizard');
try{localStorage.setItem('qp_wizard_done','1')}catch(e){}}
function maybeWizard(){
try{if(localStorage.getItem('qp_wizard_done'))return}catch(e){}
const protoCount=['vlessEnabled'].filter(k=>S.set&&S.set[k]).length;
let step=protoCount>0?1:0;
const body=$('wiz-body');
function render(){
if(step===0){$('wiz-title').textContent=t('wizard.title');body.innerHTML='<p class="field__hint" style="margin-block-end:12px">'+esc(t('wizard.s1_body'))+'</p><a class="btn btn--primary btn--sm" href="#/settings/protocols" data-action="wizard-protocols">'+esc(t('wizard.s1_cta'))+'</a>';$('wiz-next').style.display='none'}
else if(step===1){$('wiz-title').textContent=t('wizard.s2_title');const entries=mainSubEntries().slice(0,3);body.innerHTML='<p class="field__hint" style="margin-block-end:12px">'+esc(t('wizard.s2_body'))+'</p>'+(entries.length?entries.map((entry,i)=>'<div class="row"><span class="field__label" style="margin:0;flex:none;max-width:40%">'+esc(formatLabel(entry.format))+'</span>'+copyFieldHtml(subUrlWithMode(entry.url),'wiz-sub'+i)+'</div>').join(''):'<p class="field__error" style="display:block">'+esc(t('home.subs.empty_msg'))+'</p>');$('wiz-next').style.display='';$('wiz-next').textContent=t('common.confirm')}
else{$('wiz-title').textContent=t('wizard.s3_title');body.innerHTML='<p class="field__hint">'+esc(t('wizard.s3_body'))+'</p>';$('wiz-next').textContent=t('wizard.done')}}
$('wiz-skip').textContent=t('wizard.skip');
$('wiz-skip').setAttribute('data-action','wizard-skip');
$('wiz-next').onclick=()=>{if(step<2){step++;render()}else wizardDone()};
openModal('m-wizard');
render()}
boot();
})();