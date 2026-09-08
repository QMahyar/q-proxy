const SUBS_MODE_IDS=['normal','fragment'];
function isInfoEntry(e){return !!e&&typeof e.url==='string'&&/[?&]view=html/.test(e.url)}
function mainSubEntries(){const idx=f=>FORMAT_ORDER.indexOf(f);return (S.subs||[]).filter(e=>!isInfoEntry(e)).slice().sort((a,b)=>(idx(a.format)<0?99:idx(a.format))-(idx(b.format)<0?99:idx(b.format)))}
function subVariantUrl(entry){
if(entry.format==='base64')return entry.url+(entry.url.includes('?')?'&':'?')+'target=base64';
return entry.url}
function subsModeSeg(){
let sh='<div class="seg" role="radiogroup" aria-label="'+esc(t('home.subs.mode.normal'))+'/'+esc(t('home.subs.mode.fragment'))+'">';
SUBS_MODE_IDS.forEach(m=>{sh+='<button type="button" aria-checked="'+String(S.subMode===m)+'" data-mode="'+m+'">'+esc(t('home.subs.mode.'+m))+'</button>'});
return sh+'</div>'}
function subsEmptyHtml(){return emptyCard({icon:'i-qr',title:'home.subs.empty_title',msg:'home.subs.empty_msg',cta:'home.subs.empty_cta',href:'#/settings/protocols'})}
function subsMainHtml(){
const rows=mainSubEntries();
let sh='<section class="card"><div class="card__head"><div><div class="card__title">'+esc(t('subs.main.title'))+'</div><div class="field__hint">'+esc(t('subs.main.desc'))+'</div></div>'+subsModeSeg()+'</div>';
if(!rows.length){sh+=subsEmptyHtml();sh+='</section>';return sh}
rows.forEach((entry,i)=>{
const meta=FORMAT_LABELS[entry.format]||{key:null,hint:null,ext:null};
const label=meta.key?t(meta.key):entry.format;
const url=subUrlWithMode(entry.url);
sh+='<div class="row"><span class="field__label" style="margin:0;flex:none;max-width:40%">'+esc(label)+'</span>'+copyFieldHtml(url,'hub-u'+i)+'</div>';
sh+='<details class="warp-acc subs-acc"><summary>'+esc(t('subs.main.expand'))+'</summary><div style="padding-block:4px 10px">';
if(meta.hint)sh+='<p class="field__hint" style="margin-block:0 8px"><strong>'+esc(t('subs.usedby'))+':</strong> '+esc(t(meta.hint))+'</p>';
sh+='<p class="field__hint" style="margin-block:0 8px">'+esc(t('subs.main.user_agent'))+'</p>';
sh+='<div class="field" style="margin-block:0 10px"><span class="field__label">'+esc(t('subs.main.variant'))+'</span>'+copyFieldHtml(subVariantUrl(entry),'hub-v'+i)+'</div>';
sh+='<p class="field__hint" style="margin-block:0 10px" dir="auto">'+esc(t('country.hint'))+'</p>';
if(meta.ext)sh+='<p style="margin-block:0"><a class="btn btn--ghost btn--sm" href="'+esc(entry.url)+'" download><svg aria-hidden="true"><use href="#i-download"/></svg>'+esc(t('subs.main.download',{ext:meta.ext}))+'</a></p>';
sh+='</div></details>'});
sh+='<p class="field__hint" dir="auto" style="margin-block:12px 0">'+esc(t('home.subs.quota'))+'</p>';
sh+='</section>';
return sh}
function subsUsersHtml(){
let sh='<section class="card"><div class="card__head"><div><div class="card__title">'+esc(t('subs.users.title'))+'</div><div class="field__hint">'+esc(t('subs.users.desc'))+'</div></div><a class="btn btn--ghost btn--sm" href="#/users">'+esc(t('subs.users.manage'))+'</a></div><div id="subs-users">'+loadingBox({rows:2})+'</div></section>';
return sh}
function subsWarpHtml(){
const n=S.warp&&Array.isArray(S.warp.accounts)?S.warp.accounts.length:null;
let sh='<section class="card"><div class="card__head"><div><div class="card__title">'+esc(t('subs.warp.title'))+'</div><div class="field__hint">'+esc(t('subs.warp.desc'))+'</div></div></div><div class="row" style="border:0"><a class="btn btn--primary btn--sm" href="#/warp">'+esc(t('subs.warp.cta'))+'</a>';
if(n)sh+='<span class="stat-chip"><span class="dot dot-violet"></span>'+esc(t('warp.chips.accounts',{n:n}))+'</span>';;
sh+='</div></section>';
return sh}
function subsInfoHtml(){
const info=(S.subs||[]).find(isInfoEntry);
let sh='<section class="card">';
sh+='<div class="card__head"><div><div class="card__title">'+esc(t('subs.info.title'))+'</div><div class="field__hint">'+esc(t('subs.info.desc'))+'</div></div></div>';
if(info)sh+='<div class="row" style="border:0"><div class="copy-field"><code id="hub-info" dir="ltr">'+esc(info.url)+'</code><button type="button" class="btn btn--icon btn--sm" data-action="copy" data-copy-id="hub-info" aria-label="'+esc(t('common.copy'))+'"><svg aria-hidden="true"><use href="#i-copy"/></svg></button></div></div>';
sh+='<details class="warp-acc subs-acc"><summary>'+esc(t('subs.how.title'))+'</summary><div style="padding-block:4px 10px"><p class="field__hint" style="margin-block:0 8px">'+esc(t('subs.how.body'))+'</p><p class="field__hint" style="margin-block:0">'+esc(t('subs.how.cache'))+'</p></div></details>';
sh+='</section>';
return sh}
function subsBodyHtml(){
return subsMainHtml()+subsUsersHtml()+subsWarpHtml()+subsInfoHtml()}
function renderSubsView(){
const b=$('subs-body');if(!b)return;
b.innerHTML=subsBodyHtml();
renderSubsUsers()}
function showSubsView(){
renderSubsView();
loadSubsUsers();
if(!S.warp)loadWarpIfNeeded().then(()=>{if(parseRoute().view==='subs')renderSubsView()})}
function subsUserRowHtml(u){
const hint='<code dir="ltr" class="mono" style="font-size:var(--fs-sm)" title="'+esc(t('users.token.hint_title'))+'">'+esc(u.tokenHint||'')+'</code>';
return '<div class="row"><span class="field__label" style="margin:0;flex:none;max-width:30%">'+esc(u.name)+'</span><span style="flex:1;min-width:0">'+hint+'</span>'+userChip(u)+'</div>'}
let subsUsersLoaded=false;
function renderSubsUsers(){
const box=$('subs-users');if(!box)return;
const all=S.users||[];
if(!subsUsersLoaded&&!all.length)return;
if(!all.length){box.innerHTML=emptyCard({title:'subs.users.empty',cta:'subs.users.empty_cta',href:'#/users',style:'padding:2rem 1.5rem'});return}
box.innerHTML=all.map(subsUserRowHtml).join('')+'<p class="field__hint" style="margin-block:10px 0">'+esc(t('subs.users.hint'))+'</p>'}
async function loadSubsUsers(){
const box=$('subs-users');if(!box)return;
try{const d=await api('api/users',{fresh:true});S.users=d.users||[];subsUsersLoaded=true;renderSubsUsers()}catch(e){if(e&&e.status===401)return;if(e&&e.handled)return;subsUsersLoaded=true;box.innerHTML=errorCard({title:'users.load_failed',retryAction:'data-retry="subs-users"'})}}

document.addEventListener('click',function(e){
const b=e.target&&e.target.closest?e.target.closest('[data-retry="subs-users"]'):null;if(!b)return;
const box=$('subs-users');if(box)box.innerHTML=loadingBox({rows:2});
loadSubsUsers()});
document.addEventListener('click',function(e){
const chip=e.target&&e.target.closest?e.target.closest('#subs-body [data-mode]'):null;
if(!chip)return;
S.subMode=chip.dataset.mode;
chip.parentElement.querySelectorAll('button').forEach(b=>b.setAttribute('aria-checked',String(b===chip)));
const rows=mainSubEntries();
document.querySelectorAll('#subs-body [id^="hub-u"]').forEach(code=>{
const i=Number(String(code.id).slice(5));const entry=rows[i];
if(!entry)return;
const u=subUrlWithMode(entry.url);
code.textContent=u;
const w=code.closest('.copy-field');if(w){const q=w.querySelector('[data-qr]');if(q)q.setAttribute('data-qr',u)}});
document.querySelectorAll('#subs-body [id^="hub-v"]').forEach(code=>{
const i=Number(String(code.id).slice(5));const entry=rows[i];
if(entry)code.textContent=subVariantUrl(entry)})});
