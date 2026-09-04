function userSubUrl(token){return location.origin+BASE+'sub/u/'+token}
function isUserExpired(u){return u.expiresAt!=null&&u.expiresAt<Date.now()}
function userChip(u){
const expired=isUserExpired(u);
const key=!u.enabled?'users.status.disabled':expired?'users.status.expired':(u.dailyReqLimit!=null&&(u.todayHits||0)>=u.dailyReqLimit)?'users.status.limited':'users.status.active';
return '<span class="chip-status '+(!u.enabled||expired?'bad':'ok')+'">'+esc(t(key))+'</span>'}
function usersCardHtml(){
return '<section class="card"><div class="card__head"><div><div class="card__title">'+esc(t('users.title'))+'</div><div class="field__hint">'+esc(t('users.desc'))+'</div></div><button type="button" class="btn btn--primary btn--sm" data-action="users-add">'+esc(t('users.add'))+'</button></div><div class="bulkbar" id="users-bulk" hidden><span class="stat-chip" id="users-bulk-count"></span><button type="button" class="btn btn--ghost btn--sm" data-action="users-bulk-enable">'+esc(t('users.bulk.enable'))+'</button><button type="button" class="btn btn--ghost btn--sm" data-action="users-bulk-disable">'+esc(t('users.bulk.disable'))+'</button><input type="datetime-local" class="input" id="users-bulk-expiry" aria-label="'+esc(t('users.expiry'))+'"><button type="button" class="btn btn--ghost btn--sm" data-action="users-bulk-extend">'+esc(t('users.bulk.extend'))+'</button><button type="button" class="btn btn--ghost-danger btn--sm" data-action="users-bulk-del">'+esc(t('users.bulk.delete'))+'</button></div><table class="tbl"><thead><tr><th><input type="checkbox" id="users-select-all" aria-label="'+esc(t('users.col.select'))+'"></th><th>'+esc(t('users.col.name'))+'</th><th>'+esc(t('users.col.token'))+'</th><th>'+esc(t('users.col.status'))+'</th><th>'+esc(t('users.col.enabled'))+'</th><th>'+esc(t('users.col.actions'))+'</th></tr></thead><tbody id="users-rows"><tr><td colspan="6"><span class="field__hint">'+esc(t('common.loading'))+'</span></td></tr></tbody></table></section>'}
function userRowHtml(u){
const url=u.token?userSubUrl(u.token):'';
const clip=url?('<button type="button" class="btn btn--icon btn--sm btn--ghost" data-action="copy" data-copy-value="'+esc(url)+'" data-qr="'+esc(url)+'" aria-label="'+esc(t('common.copy'))+'"><svg aria-hidden="true"><use href="#i-copy"/></svg></button><button type="button" class="btn btn--icon btn--sm btn--ghost" data-action="qr" data-qr="'+esc(url)+'" aria-label="'+esc(t('common.qr'))+'"><svg aria-hidden="true"><use href="#i-qr"/></svg></button>'):'';
const acts='<div class="btn-row">'+clip+'<button type="button" class="btn btn--icon btn--sm btn--ghost" data-action="users-edit" data-id="'+esc(u.id)+'" aria-label="'+esc(t('users.edit'))+'"><svg aria-hidden="true"><use href="#i-edit"/></svg></button><button type="button" class="btn btn--icon btn--sm btn--ghost" data-action="users-regen" data-id="'+esc(u.id)+'" aria-label="'+esc(t('warp.detail.regen'))+'"><svg aria-hidden="true"><use href="#i-refresh"/></svg></button><button type="button" class="btn btn--icon btn--sm btn--ghost-danger" data-action="users-del" data-id="'+esc(u.id)+'" aria-label="'+esc(t('users.delete'))+'"><svg aria-hidden="true"><use href="#i-x"/></svg></button></div>';
const sw='<label class="switch"><input type="checkbox" role="switch" data-user-toggle="'+esc(u.id)+'"'+(u.enabled?' checked':'')+'><span class="switch__track"><span class="switch__thumb"></span></span></label>';
return '<tr><td data-l="'+esc(t('users.col.select'))+'"><input type="checkbox" data-user-select="'+esc(u.id)+'"'+(BULK.has(u.id)?' checked':'')+' aria-label="'+esc(t('users.col.select'))+'"></td><td data-l="'+esc(t('users.col.name'))+'" style="max-width:10rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(u.name)+'</td>'
+'<td data-l="'+esc(t('users.col.token'))+'" dir="ltr">'+(url?'<code dir="ltr" class="mono" style="font-size:var(--fs-sm);direction:ltr">'+esc(url)+'</code>':'<span class="field__hint">'+esc(t('users.toast.regen'))+'</span>')+'</td>'
+'<td data-l="'+esc(t('users.col.status'))+'">'+userChip(u)+'</td>'
+'<td data-l="'+esc(t('users.col.enabled'))+'">'+sw+'</td>'
+'<td data-l="'+esc(t('users.col.actions'))+'" style="text-align:end">'+acts+'</td></tr>'}
let usersLoadFailed=false;
const BULK=new Set();
async function loadUsers(){
usersLoadFailed=false;
try{const d=await api('api/users',{fresh:true});S.users=d.users||[]}catch(e){usersLoadFailed=true}
for(const id of[...BULK])if(!S.users.some(u=>u.id===id))BULK.delete(id);
renderUserRows()}
function renderUserRows(){
const tb=$('users-rows');if(!tb)return;
if(usersLoadFailed){tb.innerHTML='<tr><td colspan="6"><p class="field__error" style="display:block">'+esc(t('users.load_failed'))+'</p><button type="button" class="btn btn--ghost btn--sm" data-action="users-reload">'+esc(t('common.retry'))+'</button></td></tr>';return}
tb.innerHTML=S.users.length?S.users.map(userRowHtml).join(''):'<tr><td colspan="6"><span class="field__hint">'+esc(t('users.empty'))+'</span></td></tr>';
updateBulkBar()}
function showRotation(tok){
const url=userSubUrl(tok);
$('rot-title').textContent=t('rotation.title');
$('rot-token').textContent=url;
$('rot-hint').textContent=t('rotation.hint');
$('rot-close').textContent=t('rotation.done');
$('rot-copy').setAttribute('aria-label',t('common.copy'));
const qr=$('rot-qr');if(qr){qr.setAttribute('data-qr',url);qr.setAttribute('aria-label',t('common.qr'))};
openModal('m-rot')}
function updateBulkBar(){
const bar=$('users-bulk');if(!bar)return;
bar.hidden=BULK.size===0;
const c=$('users-bulk-count');if(c)c.textContent=t('users.bulk.selected',{n:BULK.size});
const all=$('users-select-all');
if(all){const ids=(S.users||[]).map(u=>u.id);all.checked=ids.length>0&&ids.every(id=>BULK.has(id))}}
async function bulkUsers(patch){
const ids=[...BULK];
if(!ids.length)return;
if(!(await confirmDialog('users.bulk.selected','users.bulk.confirm',true,{n:ids.length})))return;
try{const d=await api('api/users/bulk',{method:'POST',body:{ids:ids,patch:patch}});
BULK.clear();
let msg=t('users.bulk.done',{updated:d.updated,deleted:d.deleted});
if(d.unknown)msg+=t('users.bulk.unknown',{unknown:d.unknown});
toast(msg,'ok');await loadUsers()}catch(err){toastErr(err)}}