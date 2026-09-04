const ACTIONS={
copy(el){
const valEl=el.dataset.copyId?$(el.dataset.copyId):null;
const val=el.dataset.copyValue||(valEl?valEl.textContent:'');
copyText(val||'').then(()=>{
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
inp.value=genFor(el.dataset.gen);
updateCharCount(inp);
inp.dispatchEvent(new Event('change',{bubbles:true}));
toast(t('common.generated'),'ok')},
 qr(el){openQr(el.dataset.qr)},
 'close-modal'(){closeModal('m-qr')},
 'download-qr'(){
 const canvas=$('qr-canvas');
 if(!canvas)return;
 const a=document.createElement('a');
 a.href=canvas.toDataURL('image/png');
 a.download='q-proxy-subscription.png';
 document.body.appendChild(a);
 a.click();
 a.remove()},
logout(){
confirmDialog('confirm.logout_title','confirm.logout_body',true).then(async yes=>{
if(!yes)return;
try{await api('api/auth/logout',{method:'POST',mutate:true})}catch(err){}
location.replace(BASE+'login')})},
apply(){
(async()=>{for(const sec of[...S.dirty])await applySection(sec)})()},
discard(){
[...S.dirty].forEach(sec=>discardSection(sec))},
 'settings-import'(){
 const fileInput=$('settings-import-file');
 fileInput.onchange=async()=>{
 const file=fileInput.files&&fileInput.files[0];
 if(!file)return;
 try{
 const parsed=JSON.parse(await file.text());
 if(parsed&&parsed.kind==='q-proxy-settings'&&parsed.settings){
 await api('api/settings/import',{method:'POST',body:{settings:parsed.settings}});
 toast(t('general.backup.imported'),'ok');location.reload()}
 else toast(t('general.backup.badfile'),'err')}
 catch(err){if(err&&err.fields)toast(Object.values(err.fields)[0],'err');else toastErr(err)}
 finally{fileInput.value=''}};
 fileInput.click()},
 'check-update'(el){
 (async()=>{
 el.disabled=true;
 try{
 const d=await api('api/version/check',{fresh:true});
 if(d.latest===null)toast(t('home.status.updateCheckFailed'),'err');
 else if(d.updateAvailable)toast(t('home.status.updateAvailable',{v:d.latest.replace(/^v/,'')}),'ok');
 else toast(t('home.status.upToDate'),'ok')}
 catch(err){toastErr(err)}
 finally{el.disabled=false}})()},
 'reset-defaults'(){
 confirmDialog('confirm.reset_title','confirm.reset_body',true).then(async yes=>{
if(!yes)return;
try{await api('api/settings/reset',{method:'POST',body:{}});location.reload()}catch(err){toastErr(err)}})},
 'refresh-ip'(){loadMyIp()},
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
 try{await api('api/warp/account/'+el.dataset.id+'/regenerate-token',{method:'POST',body:{}});
 toast(t('users.toast.regen'),'ok');invalidateWarp();loadWarpIfNeeded().then(()=>renderWarpDetail(el.dataset.id))}catch(err){toastErr(err)}})},
 'warp-delete'(el){
 confirmDialog('warp.confirm.delete_title','warp.confirm.delete_body',true).then(async yes=>{
 if(!yes)return;
 try{await api('api/warp/account/'+el.dataset.id,{method:'DELETE',mutate:true});
 toast(t('warp.toast.deleted'),'ok');invalidateWarp();location.hash='#/settings/warp'}catch(err){toastErr(err)}})},
 'warp-amnezia-reset'(el){
 (async()=>{
 try{await api('api/warp/account/'+el.dataset.id,{method:'PUT',body:{amnezia_overrides:null}});
 toast(t('common.saved'),'ok');invalidateWarp();loadWarpIfNeeded().then(()=>renderWarpDetail(el.dataset.id))}catch(err){toastErr(err)}})()},
 'warp-save'(el){
 (async()=>{
 const id=el.dataset.id;const field=el.dataset.field;
 const patch={};
 if(field==='name')patch.name=$('warp-name').value.trim();
 if(field==='dns')patch.dns=$('warp-dns').value.trim();
 if(field==='preset')patch.endpoint_list={type:'preset',preset_id:$('warp-preset').value};
 try{await api('api/warp/account/'+id,{method:'PUT',body:patch});
 toast(t('common.saved'),'ok');invalidateWarp();loadWarpIfNeeded().then(()=>renderWarpDetail(id))}catch(err){toastErr(err)}})()},
 'warp-amnezia-save'(){
  (async()=>{
  const body={};
  ['Jc','Jmin','Jmax','S1','S2','S3','S4','H1','H2','H3','H4'].forEach(k=>{const el=$('amz-'+k);if(!el)return;const v=el.value.trim();if(v.length>0)body[k]=v});
  const i1el=$('amz-I1');const i1=i1el?i1el.value.trim():'';if(i1.length>0)body.I1=i1;
 try{const d=await api('api/warp/settings/amnezia',{method:'PUT',body:{amnezia:body}});
 if(!S.warp)S.warp={accounts:[],presets:[],amnezia:null};
 S.warp.amnezia=d.amnezia;toast(t('common.saved'),'ok')}catch(err){toastErr(err)}})()},
  'warp-preset-del'(el){
  (async()=>{
  try{await api('api/warp/presets/'+el.dataset.id,{method:'DELETE',mutate:true});
  toast(t('warp.toast.presetDeleted'),'ok');invalidateWarp();loadWarpIfNeeded().then(renderWarpSection)}catch(err){toastErr(err)}})()},
  'warp-custom-eps-save'(el){
  (async()=>{
  const eps=$('warp-custom-eps').value.split(/\r?\n/).map(l=>l.trim()).filter(l=>l.length>0);
  try{await api('api/warp/account/'+el.dataset.id,{method:'PUT',body:{endpoint_list:{type:'custom',custom_endpoints:eps}}});
  toast(t('common.saved'),'ok');invalidateWarp();loadWarpIfNeeded().then(()=>renderWarpDetail(el.dataset.id))}catch(err){toastErr(err)}})()},
  'warp-account-amnezia-save'(el){
  (async()=>{
  const body={};
  ['Jc','Jmin','Jmax','S1','S2','S3','S4','H1','H2','H3','H4'].forEach(k=>{const inp=$('amza-'+k);if(!inp)return;const v=inp.value.trim();if(v.length>0)body[k]=v});
  const i1el=$('amza-I1');const i1=i1el?i1el.value.trim():'';if(i1.length>0)body.I1=i1;
  try{await api('api/warp/account/'+el.dataset.id,{method:'PUT',body:{amnezia_overrides:Object.keys(body).length?body:null}});
  toast(t('common.saved'),'ok');invalidateWarp();loadWarpIfNeeded().then(()=>renderWarpDetail(el.dataset.id))}catch(err){toastErr(err)}})()},
 'close-user-modal'(el){closeModal(el.dataset.modal)},
 'users-add'(){openUserModal()},
 'users-edit'(el){openUserModal(el.dataset.id)},
 'users-reload'(){loadUsers()},
 'users-del'(el){
 confirmDialog('users.confirm_delete_title','users.confirm_delete_body',true).then(async yes=>{
 if(!yes)return;
 try{await api('api/users/'+el.dataset.id,{method:'DELETE',mutate:true});toast(t('users.toast.deleted'),'ok');await loadUsers()}catch(err){toastErr(err)}})},
 'users-regen'(el){
 confirmDialog('users.confirm_regen_title','users.confirm_regen_body',true).then(async yes=>{
 if(!yes)return;
 try{const d=await api('api/users/'+el.dataset.id+'/regenerate-token',{method:'POST',body:{}});const tok=d&&d.token;toast(t('users.toast.regen'),'ok');if(tok)showRotation(tok);await loadUsers()}catch(err){toastErr(err)}})},
 'shortcuts'(){renderShortcuts();openModal('m-keys')},
 'close-keys'(){closeModal('m-keys')},
 'close-rot'(){closeModal('m-rot')},
 'backup-export'(){try{localStorage.setItem(EXPORT_KEY,String(Date.now()))}catch(e){}setTimeout(maybeBackupBanner,500)},
 'backup-dismiss'(){try{localStorage.setItem(BACKUP_DISMISS,String(Date.now()))}catch(e){}$('backup-banner').hidden=true},
 'users-bulk-enable'(){bulkUsers({enabled:true})},
 'users-bulk-disable'(){bulkUsers({enabled:false})},
 'users-bulk-del'(){bulkUsers({delete:true})},
 'users-bulk-extend'(){const pick=$('users-bulk-expiry');const v=pick?pick.value:'';if(!v){toast(t('users.bulk.empty_expiry'),'err');return}bulkUsers({expiresAt:new Date(v).getTime()})},
 'tg-setup'(el){
 (async()=>{el.disabled=true;
 try{const d=await api('api/telegram/setup',{method:'POST',body:{}});
 if(d.ok)toast(t('tg.setup_ok'),'ok');
 else toast(t('tg.setup_fail')+(d.description?' · '+d.description:''),'err')}
 catch(err){toastErr(err)}
 finally{el.disabled=false}})()},
 'tg-remove'(el){
 (async()=>{el.disabled=true;
 try{const d=await api('api/telegram/remove',{method:'POST',body:{}});
 if(d.ok)toast(t('tg.remove_ok'),'ok');
 else toast(t('tg.remove_fail')+(d.description?' · '+d.description:''),'err')}
 catch(err){toastErr(err)}
 finally{el.disabled=false}})()},
  'theme-toggle'(){const cur=getTheme();const nxt=cur==='dark'?'light':'dark';try{localStorage.setItem(THEME_KEY,nxt)}catch(e){}applyTheme(nxt);},
  'addr-add'(el){
   const list=el.closest('[data-type="addrList"]');const body=list&&list.querySelector('[data-addr-body]');
   if(body){body.insertAdjacentHTML('beforeend',addrCardHtml({},body.children.length));
   const empty=list&&list.querySelector('.addr-empty');if(empty)empty.style.display='none'}
   markDirty()},
  'addr-del'(el){
   const card=el.closest('.addr-card'),body=el.closest('[data-addr-body]');
   if(body&&card){card.remove();
   const list=el.closest('[data-type="addrList"]');
   if(list&&list.querySelectorAll('[data-addr-body] .addr-card').length===0){const empty=list.querySelector('.addr-empty');if(empty)empty.style.display=''}
   }
   markDirty()},
  'remote-add'(el){
   const list=el.closest('[data-type="remoteList"]');const body=list&&list.querySelector('[data-remote-body]');
   if(body){
   if(body.querySelectorAll('.remote-card').length>=20){toast(t('remote.nodes.max'),'err');return}
   body.insertAdjacentHTML('beforeend',remoteNodeCardHtml({},body.children.length));
   const empty=list&&list.querySelector('.remote-empty');if(empty)empty.style.display='none'}
   markDirty()},
  'remote-del'(el){
   const card=el.closest('.remote-card'),body=el.closest('[data-remote-body]');
   if(body&&card){card.remove();
   const list=el.closest('[data-type="remoteList"]');
   if(list&&list.querySelectorAll('[data-remote-body] .remote-card').length===0){const empty=list.querySelector('.remote-empty');if(empty)empty.style.display=''}
   }
   markDirty()},
  'addr-hostname'(el){
   const list=el.closest('[data-type="addrList"]');const body=list&&list.querySelector('[data-addr-body]');
   if(body){body.insertAdjacentHTML('beforeend',addrCardHtml({address:location.hostname},body.children.length));
   const empty=list&&list.querySelector('.addr-empty');if(empty)empty.style.display='none'}
   markDirty()},
  'addr-probe'(el){
   (async()=>{
   try{const d=await api('api/address-probe',{fresh:true});S.addrHealth=d&&d.results||[];renderAddrDots()}catch(err){toastErr(err)}})()},
  'pool-fetch'(el){loadPool(false)},
  'pool-test'(el){loadPool(true)},
  'home-pool-refresh'(el){loadHomePool()},
  'pool-add'(el){
   const addr=el.dataset.addr||'';
   const ta=document.querySelector('#sp-egress [data-bind="proxyIps"]');
   if(ta&&addr){const lines=ta.value.split('\n').map(x=>x.trim()).filter(Boolean);
   if(!lines.some(x=>x.toLowerCase()===addr.toLowerCase())){lines.push(addr);}
   ta.value=lines.join('\n');markDirty();validateOneEditor(ta)}
   else toastErr()},
  'section-save'(el){applySection(el.dataset.sec)},
  'source-doh'(el){
   (async()=>{try{await loadPool(false)}catch(err){toastErr(err)}})()},
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
 cur.value='';nw.value='';cf.value=''}
 catch(err){
 if(err&&err.status===401)setFw('fw-sec-cur',t('security.wrong_current'));
 else if(err&&err.fields&&err.fields.newPassword)setFw('fw-sec-new',String(err.fields.newPassword));
 else toastErr(err)}
 finally{el.disabled=false}})()},
 'totp-start'(el){
 el.disabled=true;
 (async()=>{
 try{
 const raw=new Uint8Array(20);crypto.getRandomValues(raw);
 const secret=totpB32Encode(raw);
 const plain=[];const hashes=[];
 const ABC='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
 for(let i=0;i<10;i++){const b=new Uint8Array(8);crypto.getRandomValues(b);let s='';for(let j=0;j<8;j++)s+=ABC[b[j]%ABC.length];const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));hashes.push([...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join(''));plain.push(s.slice(0,4)+'-'+s.slice(4))}
 TOTP={secret:secret,hashes:hashes,plain:plain};
 renderTotpSetup()}
 catch(err){toastErr(err)}
 finally{el.disabled=false}})()},
 'totp-qr'(el){
 if(TOTP.secret)openQr(totpIssuerUrl(TOTP.secret))},
 'totp-confirm'(el){
 (async()=>{
 const inp=$('totp-code');if(!inp)return;
 const fw=$('fw-totp-code');const perr=fw?fw.querySelector('.field__error'):null;
 if(perr)perr.textContent='';if(fw)fw.classList.remove('field--error');
 el.disabled=true;
 try{
 if(!(await totpCheck(TOTP.secret,inp.value))){if(fw)fw.classList.add('field--error');if(perr)perr.textContent=t('totp.wrong_code');inp.focus();inp.select();return}
 await api('api/settings/save',{method:'PUT',body:{totp:{enabled:true,secret:TOTP.secret,recoveryCodes:TOTP.hashes}}});
 toast(t('totp.enabled_ok'),'ok');
 renderTotpDone()}
 catch(err){toastErr(err)}
 finally{el.disabled=false}})()},
 'totp-disable'(el){
 (async()=>{
 if(!(await confirmDialog('totp.confirm_disable','totp.confirm_disable_body',true)))return;
 el.disabled=true;
 try{
 await api('api/settings/save',{method:'PUT',body:{totp:{enabled:false}}});
 toast(t('totp.disabled_ok'),'ok');
 totpReset()}
 catch(err){toastErr(err)}
 finally{el.disabled=false}})()}};
function onDocClick(e){
const el=e.target.closest('[data-action]');
if(el){
const fn=ACTIONS[el.dataset.action];
if(fn)fn(el);
return}
const chip=e.target.closest('[data-chip]');
if(chip){handleChip(chip);return}
const mode=e.target.closest('[data-mode]');
if(mode){
S.subMode=mode.dataset.mode;
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
});
return}}
function handleChip(chip){
const group=chip.closest('[data-type="chips"]');
if(!group)return;
group.querySelectorAll('.chip').forEach(c=>c.setAttribute('aria-checked','false'));
chip.setAttribute('aria-checked','true');
markDirty();
clearTimeout(leTimer);
if(group.hasAttribute('data-fpreset')){
applyFragmentPresetUi(chip.dataset.preset)}
refreshShowIf();
validateAllLineEditors()}
function onChange(e){
if(e.target.matches('[data-remote-field="kind"]')){
const card=e.target.closest('.remote-card');
if(card){const cur=readRemoteCard(card);cur.kind=e.target.value;card.outerHTML=remoteNodeCardHtml(cur,Number(card.dataset.remoteIndex||0))}
markDirty();return}
if(e.target.matches('[data-addr-field]')){markDirty();return}
if(e.target.matches('[data-addr-enabled-input]')){
const card=e.target.closest('.addr-card');
if(card){card.dataset.addrEnabled=e.target.checked?'1':'0';card.classList.toggle('addr-card--off',!e.target.checked)}
markDirty();return}
const usel=e.target.closest('[data-user-select]');
if(usel){if(usel.checked)BULK.add(usel.dataset.userSelect);else BULK.delete(usel.dataset.userSelect);updateBulkBar();return}
if(e.target.id==='users-select-all'){const ids=(S.users||[]).map(u=>u.id);if(e.target.checked)ids.forEach(id=>BULK.add(id));else BULK.clear();renderUserRows();return}
if(e.target.closest('[data-user-toggle]')){
const sw=e.target.closest('.switch');sw.classList.add('pending');
(async()=>{try{await api('api/users/'+e.target.dataset.userToggle,{method:'PUT',body:{enabled:e.target.checked}});toast(t('users.toast.saved'),'ok');await loadUsers()}catch(err){e.target.checked=!e.target.checked;toastErr(err)}finally{sw.classList.remove('pending')}})();
return}
if(e.target.closest('[data-user-proto-all]')){
if(e.target.checked)document.querySelectorAll('#mu-protocols input[data-user-proto]').forEach(i=>{i.checked=false});
return}
if(e.target.closest('[data-user-proto]')&&e.target.checked){
const allBox=document.querySelector('#mu-protocols input[data-user-proto-all]');
if(allBox)allBox.checked=false;
return}
if(e.target.id==='warp-preset'){const id=(location.hash.match(/^#\/settings\/warp\/([0-9a-f-]+)/i)||[])[1];if(id){(async()=>{try{await api('api/warp/account/'+id,{method:'PUT',body:{endpoint_list:{type:'preset',preset_id:e.target.value}}});toast(t('common.saved'),'ok');invalidateWarp();loadWarpIfNeeded().then(()=>renderWarpDetail(id))}catch(err){toastErr(err)}})()}return}
if(e.target.closest('[data-kill]')){setKillSwitch(e.target.checked);return}
if(e.target.closest('[data-lang-sel]')){setLangCookie(e.target.value);location.reload();return}
if(e.target.closest('[data-port-master]')){
const master=e.target;
master.closest('fieldset').querySelectorAll('[data-port-opt]').forEach(c=>{c.checked=master.checked});
markDirty();
updatePortMasters();
return}
const bind=e.target.closest('[data-bind]');
if(bind){
if(bind.tagName==='TEXTAREA')validateOneEditor(bind);
markDirty();
updatePortMasters();
if(/^vlessEnabled$|^vmessEnabled$|^trojanEnabled$|^ssEnabled$/.test(bind.dataset.bind))applyProtoDim()
if(bind.dataset.bind==='echAuto'||bind.dataset.bind==='echServerName')updateEchPreview()}}
function onInput(e){
if(e.target.matches('[data-remote-field]')){markDirty();return}
if(e.target.matches('[data-addr-field]')){markDirty();return}
const bind=e.target.closest('[data-bind]');
if(!bind)return;
if(bind.tagName==='TEXTAREA'){clearTimeout(leTimer);leTimer=setTimeout(()=>validateOneEditor(bind),250)}
else if(bind.tagName==='INPUT'){
const msg=scalarError(bind);
const fw=fieldWrapOf(bind);
if(!msg&&fw&&fw.classList.contains('field--error')){fw.classList.remove('field--error');bind.removeAttribute('aria-invalid')}
updateCharCount(bind)}
if(bind.dataset.bind==='echAuto'||bind.dataset.bind==='echServerName')updateEchPreview()
markDirty()}
function wireEvents(){
document.addEventListener('click',onDocClick);
document.addEventListener('change',onChange);
document.addEventListener('input',onInput);
document.addEventListener('focusout',e=>{
const el=e.target;
if(el&&el.dataset&&el.dataset.bind&&el.tagName==='INPUT')blurValidateEl(el)});
$('m-confirm').addEventListener('click',e=>{if(e.target===$('m-confirm'))settleConfirm(false)});
$('m-qr').addEventListener('click',e=>{if(e.target===$('m-qr'))closeModal('m-qr')});
$('cf-cancel').addEventListener('click',()=>settleConfirm(false));
$('cf-ok').addEventListener('click',()=>settleConfirm(true));
$('m-qr').addEventListener('keydown',e=>{if(e.key==='Tab')trapFocus($('m-qr'),e)});
$('m-confirm').addEventListener('keydown',e=>{if(e.key==='Tab')trapFocus($('m-confirm'),e)});
['m-warp-generate','m-warp-import','m-warp-preset','m-user','m-rot','m-keys'].forEach(id=>$(id).addEventListener('keydown',e=>{if(e.key==='Tab')trapFocus($(id),e)}));
document.addEventListener('keydown',globalKeys);
document.addEventListener('keydown',e=>{
if(e.key==='Escape'){
if(!$('m-confirm').hidden)settleConfirm(false);
else if(!$('m-qr').hidden)closeModal('m-qr');
else if(!$('m-warp-generate').hidden)closeModal('m-warp-generate');
else if(!$('m-warp-import').hidden)closeModal('m-warp-import');
else if(!$('m-warp-preset').hidden)closeModal('m-warp-preset');
else if(!$('m-user').hidden)closeModal('m-user');
else if(!$('m-rot').hidden)closeModal('m-rot');
else if(!$('m-keys').hidden)closeModal('m-keys')}});
window.addEventListener('hashchange',navigate);
window.addEventListener('beforeunload',e=>{
if(S.dirty.size){e.preventDefault();e.returnValue=''}});
wireTabKeys($('nav'),'.tab');
wireTabKeys($('subtabs'),'.subtab');
$('wg-go').addEventListener('click',async()=>{
const btn=$('wg-go');btn.disabled=true;
try{const d=await api('api/warp/account/generate',{method:'POST',body:{name:$('wg-name').value.trim()}});
closeModal('m-warp-generate');toast(t('warp.toast.generated'),'ok');invalidateWarp();location.hash='#/settings/warp/'+d.account.id}
catch(err){toastErr(err)}
finally{btn.disabled=false}});
$('wi-go').addEventListener('click',async()=>{
const btn=$('wi-go');btn.disabled=true;
try{const d=await api('api/warp/account/import',{method:'POST',body:{name:$('wi-name').value.trim(),config:$('wi-config').value}});
closeModal('m-warp-import');toast(t('warp.toast.imported'),'ok');invalidateWarp();location.hash='#/settings/warp/'+d.account.id}
catch(err){if(err&&err.fields&&err.fields.config){$('wi-error').textContent=err.fields.config;$('wi-error').style.display='block'}else toastErr(err)}
finally{btn.disabled=false}});
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
finally{btn.disabled=false}});
$('mu-go').addEventListener('click',async()=>{
const btn=$('mu-go');btn.disabled=true;
const m=$('m-user');const editId=m.dataset.userId||'';
const picked=[...document.querySelectorAll('#mu-protocols input[type=checkbox]:checked')].map(i=>i.value);
const body={name:$('mu-name').value.trim(),protocols:picked.includes('all')?'all':picked};
const limit=$('mu-limit').value.trim();body.dailyReqLimit=limit===''?null:Number(limit);
const exp=$('mu-expiry').value;body.expiresAt=exp===''?null:new Date(exp).getTime();
const ovAddr=$('mu-ov-address').value.trim(),ovPort=$('mu-ov-port').value.trim(),ovLabel=$('mu-ov-label2').value.trim();
if(ovAddr.length>0){body.addressOverride={address:ovAddr};if(ovPort.length>0)body.addressOverride.port=Number(ovPort);if(ovLabel.length>0)body.addressOverride.label=ovLabel}
else body.addressOverride=null;
try{
if(editId){await api('api/users/'+editId,{method:'PUT',body});closeModal('m-user');toast(t('users.toast.saved'),'ok')}
else{const d=await api('api/users',{method:'POST',body});const tok=d&&d.user&&d.user.token;closeModal('m-user');toast(t('users.toast.created'),'ok');if(tok){const url=userSubUrl(tok);copyText(url);openQr(url)}}
await loadUsers()}
catch(err){if(err&&err.fields){$('mu-error').textContent=Object.values(err.fields)[0]||t('common.error');$('mu-error').style.display='block'}else toastErr(err)}
finally{btn.disabled=false}})}
function wireTabKeys(bar,sel){
bar.addEventListener('keydown',e=>{
const tabs=[...bar.querySelectorAll(sel)];
const idx=tabs.indexOf(document.activeElement);
if(idx<0)return;
let next=null;
if(e.key==='ArrowRight'||e.key==='ArrowLeft')next=(idx+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
else if(e.key==='Home')next=0;
else if(e.key==='End')next=tabs.length-1;
if(next!=null){e.preventDefault();tabs[next].focus();tabs[next].click()}})}
function openQr(url){
$('qr-caption').innerHTML='<div class="copy-field"><code dir="ltr">'+esc(url)+'</code><button type="button" class="btn btn--icon btn--sm" data-action="copy" data-copy-value="'+esc(url)+'" aria-label="'+esc(t('common.copy'))+'"><svg aria-hidden="true"><use href="#i-copy"/></svg></button></div>';
if(!QR.render($('qr-canvas'),url)){toast(t('toast.tooLong'),'err');return}
openModal('m-qr')}
function currentSection(){
const r=parseRoute();
return r.view==='settings'?r.sec:'general'}
function renderBootSkeleton(){const body=$('home-body');if(!body)return;body.innerHTML='<div class="skel-card"><div class="skel-row"><div class="skeleton skel-avatar"></div><div class="skel-col"><div class="skeleton skel-a"></div><div class="skeleton skel-b"></div><div class="skeleton skel-c"></div></div></div><div class="skeleton skel-pill"></div></div><div class="skel-card"><div class="skeleton skel-a"></div><div class="skeleton skel-b"></div><div class="skeleton skel-c"></div><div class="skeleton skel-a"></div></div>'}
async function boot(){
buildShell();
wireEvents();
renderBootSkeleton();
try{
const d=await api('api/bootstrap');
S.set=d.settings||{};
S.status=d.status||null;
S.subs=(d.subUrls&&d.subUrls.urls)||[]}
catch(e){
if(e&&e.status===401)return;
S.set={};
toastErr(e);
return}
try{if(!/(?:^|;\s*)qp_lang=(en|fa)/.test(document.cookie)&&S.set&&(S.set.language==='en'||S.set.language==='fa')){LANG=S.set.language;setLangCookie(LANG);document.documentElement.lang=LANG;document.documentElement.dir=LANG==='fa'?'rtl':'ltr';buildShell()}}catch(e){}
renderSettings();
renderHome();
navigate();
maybeBackupBanner();
maybeWizard()}
function maybeWizard(){
try{if(localStorage.getItem('qp_wizard_done'))return}catch(e){}
const protoCount=['vlessEnabled','vmessEnabled','trojanEnabled','ssEnabled'].filter(k=>S.set&&S.set[k]).length;
let step=protoCount>0?1:0;
const body=$('wiz-body');
function render(){
const firstSub=(S.subs||[]).find(u=>u.format==='base64'&&u.label!=='Panel info');
if(step===0){$('wiz-title').textContent=t('wizard.title');body.innerHTML='<p class="field__hint" style="margin-block-end:12px">'+esc(t('wizard.s1_body'))+'</p><a class="btn btn--primary btn--sm" href="#/settings/protocols" onclick="document.getElementById(\'wiz-skip\').click()">'+esc(t('wizard.s1_cta'))+'</a>';$('wiz-next').style.display='none'}
else if(step===1){$('wiz-title').textContent=t('wizard.s2_title');body.innerHTML='<p class="field__hint" style="margin-block-end:12px">'+esc(t('wizard.s2_body'))+'</p>'+(firstSub?copyFieldHtml(subUrlWithMode(firstSub.url),'wiz-sub'):'<p class="field__error" style="display:block">'+esc(t('home.subs.empty_msg'))+'</p>');$('wiz-next').style.display='';$('wiz-next').textContent=t('common.confirm')}
else{$('wiz-title').textContent=t('wizard.s3_title');body.innerHTML='<p class="field__hint">'+esc(t('wizard.s3_body'))+'</p>';$('wiz-next').textContent=t('wizard.done')}}
$('wiz-skip').textContent=t('wizard.skip');
$('wiz-skip').onclick=()=>{closeModal('m-wizard');try{localStorage.setItem('qp_wizard_done','1')}catch(e){}};
$('wiz-next').onclick=()=>{if(step<2){step++;render()}else{$('wiz-skip').onclick()}};
openModal('m-wizard');
render()}
boot();
})();