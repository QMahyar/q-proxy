function userSubUrl(token){return location.origin+BASE+'sub/u/'+token}
function isUserExpired(u){return u.expiresAt!=null&&u.expiresAt<Date.now()}
function userChip(u){
const expired=isUserExpired(u);
const key=!u.enabled?'users.status.disabled':expired?'users.status.expired':(u.dailyReqLimit!=null&&(u.todayHits||0)>=u.dailyReqLimit)?'users.status.limited':'users.status.active';
return '<span class="chip-status '+(!u.enabled||expired?'bad':'ok')+'">'+esc(t(key))+'</span>'}
const USERS_MAX=50,USERS_PROTO_ORDER=['vless','vmess','trojan','ss'];
function fmtInt(n){if(LANG==='fa'){return String(n).replace(/[0-9]/g,function(d){return '\u06f0\u06f1\u06f2\u06f3\u06f4\u06f5\u06f6\u06f7\u06f8\u06f9'[+d]})}return String(n)}
function fmtDayCount(ms){
const days=Math.round(Math.abs(ms)/86400000);
if(days>=30){const months=Math.floor(days/30);const rem=days%30;const base=t('users.rel.months',{n:fmtInt(months)});return rem>0?base+' '+t('users.rel.days',{n:fmtInt(rem)}):base}
return t('users.rel.days',{n:fmtInt(days)})}
function fmtExpiry(ms){
if(ms==null)return '<span class="field__hint">\u2014</span>';
const now=Date.now();
if(ms<=now)return '<span class="hint-danger">'+esc(t('users.rel.expired_ago',{d:fmtDayCount(now-ms)}))+'</span>';
const left=ms-now;
if(left<3600000)return '<span class="hint-danger">'+esc(t('users.rel.soon'))+'</span>';
if(left<86400000){const h=Math.max(1,Math.round(left/3600000));return '<span class="hint-danger">'+esc(t('users.rel.hours',{n:fmtInt(h)}))+'</span>'}
return esc(t('users.rel.in_days',{d:fmtDayCount(ms-now)}))}
function fmtQuota(u){
if(u.dailyReqLimit==null)return '<span class="field__hint">\u2014</span>';
const hits=u.todayHits||0;
const over=hits>=u.dailyReqLimit;
const val=fmtInt(hits)+'/'+fmtInt(u.dailyReqLimit);
return over?'<span class="hint-danger">'+esc(val)+'</span>':esc(val)}
function userScopeHtml(u){
if(u.protocols==='all')return '<span class="stat-chip">'+esc(t('users.all'))+'</span>';
const picked=Array.isArray(u.protocols)?u.protocols:[];
if(!picked.length)return '<span class="field__hint">\u2014</span>';
const ordered=USERS_PROTO_ORDER.filter(function(p){return picked.indexOf(p)>=0}).map(function(p){return '<span class="stat-chip">'+esc(p.toUpperCase())+'</span>'});
const extra=picked.filter(function(p){return USERS_PROTO_ORDER.indexOf(p)<0}).map(function(p){return '<span class="stat-chip">'+esc(p)+'</span>'});
return ordered.concat(extra).join(' ')}
function userOverrideBadge(){
return ' <span class="stat-chip" title="'+esc(t('users.badge.scoped'))+'" style="font-size:10px;padding-block:1px">'+esc(t('users.badge.scoped'))+'</span>'}
function usersCapacityChip(n){
return '<span class="stat-chip" role="status" title="'+esc(t('users.capacity.title'))+'"><span class="dot dot-violet"></span>'+esc(t('users.capacity',{n:fmtInt(n),max:fmtInt(USERS_MAX)}))+'</span>'}
function usersSearchHtml(){
return '<input type="search" class="input" id="users-search" placeholder="'+esc(t('users.search.placeholder'))+'" aria-label="'+esc(t('users.search.placeholder'))+'" style="max-width:14rem">'}
function usersCardHtml(){
return '<section class="card"><div class="card__head"><div><div class="card__title">'+esc(t('users.title'))+'</div><div class="field__hint">'+esc(t('users.desc'))+'</div></div><div class="btn-row">'+usersSearchHtml()+'<span id="users-capacity-slot">'+usersCapacityChip(0)+'</span><button type="button" class="btn btn--primary btn--sm" data-action="users-add">'+esc(t('users.add'))+'</button></div></div><div class="bulkbar" id="users-bulk" hidden><span class="stat-chip" id="users-bulk-count"></span><button type="button" class="btn btn--ghost btn--sm" data-action="users-bulk-enable">'+esc(t('users.bulk.enable'))+'</button><button type="button" class="btn btn--ghost btn--sm" data-action="users-bulk-disable">'+esc(t('users.bulk.disable'))+'</button><input type="datetime-local" class="input" id="users-bulk-expiry" aria-label="'+esc(t('users.expiry'))+'"><button type="button" class="btn btn--ghost btn--sm" data-action="users-bulk-extend">'+esc(t('users.bulk.extend'))+'</button><button type="button" class="btn btn--ghost-danger btn--sm" data-action="users-bulk-del">'+esc(t('users.bulk.delete'))+'</button></div><table class="tbl"><thead id="users-thead"><tr><th><input type="checkbox" id="users-select-all" aria-label="'+esc(t('users.col.select'))+'"></th><th>'+esc(t('users.col.name'))+'</th><th>'+esc(t('users.col.token'))+'</th><th>'+esc(t('users.col.expires'))+'</th><th>'+esc(t('users.col.quota'))+'</th><th>'+esc(t('users.col.scope'))+'</th><th>'+esc(t('users.col.enabled'))+'</th><th>'+esc(t('users.col.actions'))+'</th></tr></thead><tbody id="users-rows"><tr><td colspan="8">'+loadingBox({label:'common.loading'})+'</td></tr></tbody></table></section>'}
function wireUsersSearch(){
const inp=$('users-search');if(!inp||inp.dataset.wired)return;
inp.dataset.wired='1';inp.addEventListener('input',function(){USERS_QUERY=inp.value;renderUserRows()})}
function usersFiltered(){
const q=USERS_QUERY.trim().toLowerCase();
if(!q)return S.users;
return S.users.filter(function(u){return u.name.toLowerCase().indexOf(q)>=0})}
function userRowHtml(u){
const hint='<div class="btn-row"><code dir="ltr" class="mono" style="font-size:var(--fs-sm)" title="'+esc(t('users.token.hint_title'))+'">'+esc(u.tokenHint||'')+'</code><button type="button" class="btn btn--icon btn--sm btn--ghost" data-action="users-regen" data-id="'+esc(u.id)+'" aria-label="'+esc(t('users.token.regen'))+'" title="'+esc(t('users.token.regen'))+'"><svg aria-hidden="true"><use href="#i-refresh"/></svg></button></div>';
const acts='<div class="btn-row"><button type="button" class="btn btn--icon btn--sm btn--ghost" data-action="users-edit" data-id="'+esc(u.id)+'" aria-label="'+esc(t('users.edit'))+'"><svg aria-hidden="true"><use href="#i-edit"/></svg></button><button type="button" class="btn btn--icon btn--sm btn--ghost-danger" data-action="users-del" data-id="'+esc(u.id)+'" aria-label="'+esc(t('users.delete'))+'"><svg aria-hidden="true"><use href="#i-x"/></svg></button></div>';
const sw='<label class="switch"><input type="checkbox" role="switch" data-user-toggle="'+esc(u.id)+'"'+(u.enabled?' checked':'')+'><span class="switch__track"><span class="switch__thumb"></span></span></label>';
const badge=u.protocols!=='all'?userOverrideBadge():'';
const absDate=u.expiresAt!=null?new Date(u.expiresAt).toLocaleString():'';
return '<tr><td data-l="'+esc(t('users.col.select'))+'"><input type="checkbox" data-user-select="'+esc(u.id)+'"'+(BULK.has(u.id)?' checked':'')+' aria-label="'+esc(t('users.col.select'))+'"></td><td data-l="'+esc(t('users.col.name'))+'" style="max-width:10rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(u.name)+badge+'</td>'
+'<td data-l="'+esc(t('users.col.token'))+'" dir="ltr">'+hint+'</td>'
+'<td data-l="'+esc(t('users.col.expires'))+'" title="'+esc(absDate)+'">'+fmtExpiry(u.expiresAt)+'</td>'
+'<td data-l="'+esc(t('users.col.quota'))+'">'+fmtQuota(u)+'</td>'
+'<td data-l="'+esc(t('users.col.scope'))+'">'+userScopeHtml(u)+'</td>'
+'<td data-l="'+esc(t('users.col.enabled'))+'">'+sw+'</td>'
+'<td data-l="'+esc(t('users.col.actions'))+'" style="text-align:end">'+acts+'</td></tr>'}
let usersLoadFailed=false;
let USERS_QUERY='';
const BULK=new Set();
async function loadUsers(){
usersLoadFailed=false;
try{const d=await api('api/users',{fresh:true});S.users=d.users||[];if(typeof renderHomeUsers==='function')renderHomeUsers()}catch(e){usersLoadFailed=true}
for(const id of[...BULK])if(!S.users.some(u=>u.id===id))BULK.delete(id);
renderUserRows()}
function usersEmptyHtml(){
return emptyCard({icon:'i-qr',title:'users.empty',msg:'users.empty_msg',cta:'users.empty_cta',attrs:'data-action="users-add"'})}
function renderUserRows(){
const tb=$('users-rows');if(!tb)return;
wireUsersSearch();
const th=$('users-thead');if(th)th.hidden=false;
if(usersLoadFailed){tb.innerHTML='<tr><td colspan="8">'+errorCard({title:'users.load_failed',retryAction:'data-action="users-reload"'})+'</td></tr>';return}
const capSlot=$('users-capacity-slot');if(capSlot)capSlot.innerHTML=usersCapacityChip(S.users.length);
const rows=usersFiltered();
const empty=S.users.length===0;
if(th)th.hidden=empty;
if(empty){tb.innerHTML='<tr><td colspan="8" style="padding:0">'+usersEmptyHtml()+'</td></tr>';updateBulkBar();return}
if(!rows.length){tb.innerHTML='<tr><td colspan="8"><span class="field__hint">'+esc(t('users.search.empty'))+'</span></td></tr>';updateBulkBar();return}
tb.innerHTML=rows.map(userRowHtml).join('');
updateBulkBar()}
function updateBulkBar(){
const bar=$('users-bulk');if(!bar)return;
bar.hidden=BULK.size===0;
const c=$('users-bulk-count');if(c)c.textContent=t('users.bulk.selected',{n:BULK.size});
const all=$('users-select-all');
if(all){const ids=(S.users||[]).map(u=>u.id);all.checked=ids.length>0&&ids.every(id=>BULK.has(id))}}
document.addEventListener('click',function(e){
const rb=e.target&&e.target.closest?e.target.closest('[data-action="users-reload"]'):null;if(!rb)return;
const ltb=$('users-rows');if(ltb)ltb.innerHTML='<tr><td colspan="8">'+loadingBox({label:'common.loading'})+'</td></tr>'});
async function bulkUsers(patch){
const ids=[...BULK];
if(!ids.length)return;
if(!(await confirmDialog('users.bulk.selected','users.bulk.confirm',true,{n:ids.length})))return;
try{const d=await api('api/users/bulk',{method:'POST',body:{ids:ids,patch:patch}});
BULK.clear();
let msg=t('users.bulk.done',{updated:d.updated,deleted:d.deleted});
if(d.unknown)msg+=t('users.bulk.unknown',{unknown:d.unknown});
toast(msg,'ok');await loadUsers()}catch(err){toastErr(err)}}
