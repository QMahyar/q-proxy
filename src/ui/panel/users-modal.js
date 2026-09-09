function toLocalInputValue(ms){
const d=new Date(ms);const p=n=>String(n).padStart(2,'0');
return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())}
function openUserModal(id){
const m=$('m-user');
if(id)m.dataset.userId=id;else delete m.dataset.userId;
const u=id?S.users.find(x=>x.id===id):null;
$('mu-title').textContent=t(u?'users.edit':'users.add');
$('mu-go').textContent=t(u?'common.save':'users.add');
$('mu-name').value=u?u.name:'';
const picked=u&&u.protocols!=='all'?u.protocols:['all'];
document.querySelectorAll('#mu-protocols input[type=checkbox]').forEach(i=>{i.checked=picked.includes(i.value)});
$('mu-limit').value=u&&u.dailyReqLimit!=null?String(u.dailyReqLimit):'';
$('mu-expiry').value=u&&u.expiresAt!=null?toLocalInputValue(u.expiresAt):'';
$('mu-ov-label').textContent=t('users.override.label');
$('mu-ov-hint').textContent=t('users.override.hint');
$('mu-ov-address-label').textContent=t('addresses.field.address');
$('mu-ov-port-label').textContent=t('addresses.field.port');
$('mu-ov-label-label').textContent=t('addresses.field.label');
const ov=u&&u.addressOverride?u.addressOverride:null;
$('mu-ov-address').value=ov&&ov.address?ov.address:'';
$('mu-ov-port').value=ov&&ov.port?String(ov.port):'';
$('mu-ov-label2').value=ov&&ov.label?ov.label:'';
const dl=$('mu-ov-options');
if(dl){dl.innerHTML=(S.set.addresses||[]).map(function(a){if(a.enabled===false)return '';return '<option value="'+esc(String(a.address||'').replace(/(:\d+)$/,''))+'"></option>'}).join('')}
$('mu-error').style.display='';$('mu-error').textContent='';
openModal('m-user')}
