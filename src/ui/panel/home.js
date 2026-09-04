
const TLS_PORTS=[443,2053,2083,2087,2096,8443],PLAIN_PORTS=[80,8080,8880,2052,2082,2086,2095];
const SS_METHODS=['aes-128-gcm','aes-256-gcm','chacha20-ietf-poly1305'];
const FPS=['chrome','firefox','safari','ios','android','edge','360','qq','random','randomized'];
const PACKETS=['tlshello','1-1','1-2','1-3','1-5'];
const PRESETS={low:[100,200,1,1],medium:[50,100,1,5],high:[10,20,10,20],severe:[1,5,1,5]};
const S={set:{},status:null,subs:[],snap:{},dirty:new Set(),subMode:'normal',users:[],warp:null,pool:null,addrHealth:[]};
let UID=0;
function getPath(o,p){return p.split('.').reduce((a,k)=>a==null?undefined:a[k],o)}
function setPath(o,p,v){const ks=p.split('.');let c=o;for(let i=0;i<ks.length-1;i++){if(typeof c[ks[i]]!=='object'||c[ks[i]]===null)c[ks[i]]={};c=c[ks[i]]}c[ks[ks.length-1]]=v}
function leaves(o,pre,out){for(const k in o){const p=pre?pre+'.'+k:k;const v=o[k];if(v&&typeof v==='object'&&!Array.isArray(v))leaves(v,p,out);else out[p]=v}return out}
function buildShell(){
$('tab-home').textContent=t('nav.home');
$('tab-settings').textContent=t('nav.settings');
$('home-h1').textContent=t('nav.home');
$('settings-h1').textContent=t('nav.settings');
$('logout-btn').setAttribute('aria-label',t('nav.logout'));
$('logout-btn').title=t('nav.logout');
$('shortcuts-btn').setAttribute('aria-label',t('shortcuts.title'));
$('shortcuts-btn').title=t('shortcuts.title');
$('dirty-label').textContent=t('common.unsaved');
$('discard-btn').textContent=t('common.discard');
$('apply-btn').textContent=t('common.apply');
$('qr-title').textContent=t('qr.title');
$('qr-hint').textContent=t('qr.hint');
$('qr-close').textContent=t('common.close');
$('wg-title').textContent=t('warp.gen.title');
$('wg-desc').textContent=t('warp.gen.desc');
$('wg-name-label').textContent=t('warp.detail.name');
$('wg-cancel').textContent=t('common.cancel');
$('wg-go').textContent=t('warp.generate');
$('wi-title').textContent=t('warp.imp.title');
$('wi-desc').textContent=t('warp.imp.desc');
$('wi-name-label').textContent=t('warp.detail.name');
$('wi-config-label').textContent=t('warp.imp.config');
$('wi-cancel').textContent=t('common.cancel');
$('wi-go').textContent=t('warp.import');
$('wp-name-label').textContent=t('warp.detail.name');
$('wp-cancel').textContent=t('common.cancel');
$('mu-name-label').textContent=t('users.name');
$('mu-protocols-label').textContent=t('users.protocols');
$('mu-proto-all-label').textContent=t('users.all');
$('mu-limit-label').textContent=t('users.limit');
$('mu-limit-hint').textContent=t('users.limit_none');
$('mu-expiry-label').textContent=t('users.expiry');
$('mu-expiry-hint').textContent=t('users.expiry_none');
$('mu-cancel').textContent=t('common.cancel');
document.querySelectorAll('.swatch').forEach(b=>{const nm=t('accent.'+(b.dataset.accent||'cyan'));b.setAttribute('aria-label',nm);b.title=nm});
const _nav=$('nav');if(_nav)_nav.setAttribute('aria-label',t('nav.views'));
const _sw=document.querySelector('.swatches');if(_sw)_sw.setAttribute('aria-label',t('accent.label'));
$('qr-download').textContent=t('qr.download');
document.title='Q Proxy';
const seg=$('langseg');seg.innerHTML='';
[['en','lang.en'],['fa','lang.fa']].forEach(([code,label])=>{const b=document.createElement('button');b.type='button';b.textContent=t(label);b.setAttribute('aria-checked',String(LANG===code));b.setAttribute('role','radio');b.addEventListener('click',()=>{if(code!==LANG){setLangCookie(code);location.reload()}});seg.appendChild(b)})}
function parseRoute(){
const h=location.hash.replace(/^#\/?/,'');
const seg=h.split('/');
if(seg[0]==='settings'){
if(seg[1]==='warp'&&seg[2])return{view:'settings',sec:'warp',warpId:seg[2]};
return{view:'settings',sec:SECTIONS.some(s=>s.key===seg[1])?seg[1]:'general'};
}
return{view:'home'}}
function navigate(){
const r=parseRoute();
const h=location.hash;
if(r.view==='home'&&h!==''&&h!=='#'&&h!=='#/home')history.replaceState(null,'','#/home');
if(r.view==='settings'&&SECTIONS.some(s=>s.key===r.sec))history.replaceState(null,'','#/settings/'+r.sec+(r.warpId?'/'+r.warpId:''));
['home','settings'].forEach(v=>{$('view-'+v).hidden=v!==r.view});
document.querySelectorAll('#nav .tab').forEach(a=>a.setAttribute('aria-selected',String(a.dataset.view===r.view)));
if(r.view==='settings')showSection(r.sec,r.warpId);
window.scrollTo(0,0)}
function showSection(sec,warpId){
SECTIONS.forEach(s=>{const p=$('sp-'+s.key);if(p)p.hidden=s.key!==sec});
document.querySelectorAll('#subtabs .subtab').forEach(a=>a.setAttribute('aria-selected',String(a.dataset.sec===sec)));
if(sec==='users')loadUsers();
if(sec==='warp')loadWarpIfNeeded().then(()=>{if(warpId)renderWarpDetail(warpId);else renderWarpSection()})}
function buildSubtabs(){
const bar=$('subtabs');bar.innerHTML='';
SECTIONS.forEach(s=>{const a=document.createElement('button');a.type='button';a.className='subtab';a.role='tab';a.id='st-'+s.key;a.dataset.sec=s.key;a.textContent=t('tabs.settings.'+s.key);a.setAttribute('aria-selected','false');a.setAttribute('aria-controls','sp-'+s.key);a.addEventListener('click',()=>{location.hash='#/settings/'+s.key});bar.appendChild(a)})}
function subUrlWithMode(u){
if(S.subMode!=='fragment')return u;
return u+(u.includes('?')?'&':'?')+'mode=fragment'}
function copyFieldHtml(value,idAttr){
return '<div class="copy-field"><code id="'+idAttr+'" dir="ltr">'+esc(value)+'</code><button type="button" class="btn btn--icon btn--sm" data-action="copy" data-copy-id="'+idAttr+'" aria-label="'+esc(t('common.copy'))+'"><svg aria-hidden="true"><use href="#i-copy"/></svg></button><button type="button" class="btn btn--icon btn--sm" data-action="qr" data-qr="'+esc(value)+'" aria-label="'+esc(t('common.qr'))+'"><svg aria-hidden="true"><use href="#i-qr"/></svg></button></div>'}
function renderHome(){
const body=$('home-body');
body.innerHTML='';
const protoCount=['vlessEnabled','vmessEnabled','trojanEnabled','ssEnabled'].filter(k=>S.set&&S.set[k]).length;
const chips=document.createElement('div');chips.className='chips-row';
chips.innerHTML='<span class="stat-chip"><span class="dot dot-cyan"></span>'+esc(t('home.chips.protocols',{n:protoCount}))+'</span><span class="stat-chip"><span class="dot dot-violet"></span>'+esc(t('home.chips.formats',{n:(S.subs||[]).filter(u=>u.format!=='base64'||u.label!=='Panel info').length}))+'</span>';
body.appendChild(chips);
const subs=document.createElement('section');subs.className='card';
let sh='<div class="card__head"><div><div class="card__title">'+esc(t('home.subs.title'))+'</div><div class="field__hint">'+esc(t('home.subs.desc'))+'</div><div class="field__hint">'+esc(t('home.subs.quota'))+'</div></div><div class="seg" role="radiogroup" aria-label="'+esc(t('home.subs.mode.normal'))+'/'+esc(t('home.subs.mode.fragment'))+'">';
[['normal','home.subs.mode.normal'],['fragment','home.subs.mode.fragment']].forEach(([m,k])=>{sh+='<button type="button" aria-checked="'+String(S.subMode===m)+'" data-mode="'+m+'">'+esc(t(k))+'</button>'});
sh+='</div></div>';
const urls=[...S.subs].sort((a,b)=>(a.format==='base64'?-1:0)-(b.format==='base64'?-1:0));
urls.forEach((entry,i)=>{sh+='<div class="row"><span class="field__label" style="margin:0;flex:none;max-width:40%">'+esc(entry.label||entry.format)+'</span>'+copyFieldHtml(subUrlWithMode(entry.url),'sub-u'+i)+'</div>'});
if(S.warp&&S.warp.accounts.length)sh+=warpSubsHtml();
if(urls.length)sh+='<p class="field__hint" dir="auto">'+esc(t('country.hint'))+'</p>';
if(!urls.length&&!(S.warp&&S.warp.accounts.length))sh+='<div class="empty-card"><div class="empty-icon"><svg aria-hidden="true"><use href="#i-qr"/></svg></div><div class="empty-title">'+esc(t('home.subs.empty_title'))+'</div><p class="empty-msg">'+esc(t('home.subs.empty_msg'))+'</p><div class="empty-actions"><a class="btn btn--primary btn--sm" href="#/settings/protocols">'+esc(t('home.subs.empty_cta'))+'</a></div></div>';
subs.innerHTML=sh;
body.appendChild(subs);
if(!S.warp)loadWarpIfNeeded().then(()=>{if(S.warp)renderHome()});
const right=document.createElement('div');
const kill=document.createElement('section');kill.className='card';
kill.innerHTML='<div class="card__head"><div class="card__title">'+esc(t('home.kill.title'))+'</div><span class="chip-status ok" id="kill-chip"></span></div><p class="field__hint" id="kill-desc"></p><div class="row" style="border:0"><label class="switch"><input type="checkbox" role="switch" data-kill'+(S.status&&S.status.killSwitch?' checked':'')+'><span class="switch__track"><span class="switch__thumb"></span></span><span class="switch__label">'+esc(t('general.killSwitch.label'))+'</span></label></div>';
right.appendChild(kill);
const ip=document.createElement('section');ip.className='card';
ip.innerHTML='<div class="card__head"><div class="card__title">'+esc(t('home.stats.title'))+'</div><button type="button" class="btn btn--ghost btn--sm" data-action="refresh-ip"><svg aria-hidden="true"><use href="#i-refresh"/></svg>'+esc(t('home.stats.refresh'))+'</button></div><div id="ip-body"><span class="field__hint">'+esc(t('home.stats.idle'))+'</span></div><p class="field__hint"><a href="'+esc(BASE)+'my-ip" target="_blank" rel="noopener">'+esc(t('home.stats.link'))+'</a></p>';
right.appendChild(ip);
const pool=document.createElement('section');pool.className='card';
pool.innerHTML='<div class="card__head"><div class="card__title">'+esc(t('egress.pool.title'))+'</div><button type="button" class="btn btn--ghost btn--sm" data-action="home-pool-refresh"><svg aria-hidden="true"><use href="#i-refresh"/></svg>'+esc(t('home.stats.refresh'))+'</button></div><div id="home-pool"><span class="field__hint">'+esc(t('egress.pool.idle'))+'</span></div>';
right.appendChild(pool);
const uc=document.createElement('section');uc.className='card';
uc.innerHTML='<div class="card__head"><div><div class="card__title">'+esc(t('users.title'))+'</div><div class="field__hint">'+esc(t('home.users.desc'))+'</div></div><a class="btn btn--ghost btn--sm" href="#/settings/users">'+esc(t('home.users.manage'))+'</a></div><div id="home-users"><span class="field__hint">'+esc(t('common.loading'))+'</span></div>';
right.appendChild(uc);
if(S.status){
const st=document.createElement('section');st.className='card';
const u=S.status.usage||{requestsToday:0,requestsTotal:0};
st.innerHTML='<div class="card__head"><div class="card__title">'+esc(t('home.status.title'))+'</div><button type="button" class="btn btn--ghost btn--sm" data-action="check-update">'+esc(t('home.status.checkUpdate'))+'</button></div><div class="stat-grid"><span class="lbl">'+esc(t('home.status.version'))+'</span><span class="mono">v'+esc(S.status.version||'')+'</span><span></span><span class="lbl">'+esc(t('home.status.colo'))+'</span><span class="mono h-cell">'+esc(S.status.colo||'—')+'</span><span></span><span class="lbl">'+esc(t('home.status.today'))+'</span><span class="mono">'+esc(String(u.requestsToday!=null?u.requestsToday:'—'))+'</span><span class="mono">'+esc(String(u.requestsTotal!=null?u.requestsTotal:'—'))+'</span></div><div id="traffic-chart"></div>';
right.appendChild(st)}
body.appendChild(right);
recordTraffic();
renderTraffic();
loadHomePool();
loadHomeUsers();
syncKillUI()}
function syncKillUI(){
const on=!!(S.status&&S.status.killSwitch);
document.querySelectorAll('[data-kill]').forEach(b=>{b.checked=on});
const chip=$('kill-chip'),desc=$('kill-desc');
if(chip){chip.textContent=t(on?'home.kill.paused':'home.kill.active');chip.className='chip-status '+(on?'bad':'ok')}
if(desc)desc.textContent=t(on?'home.kill.desc_paused':'home.kill.desc_active');
document.querySelectorAll('[data-kill-chip]').forEach(ch=>{
ch.textContent=t(on?'home.kill.paused':'home.kill.active');
ch.className='chip-status '+(on?'bad':'ok')})}
let killTimer=null,killAbort=null;
async function setKillSwitch(on){
if(on&&!(await confirmDialog('confirm.killswitch_title','confirm.killswitch_body',true))){syncKillUI();return}
if(S.status)S.status.killSwitch=on;
syncKillUI();
if(killTimer)clearTimeout(killTimer);
if(killAbort)killAbort.abort();
killAbort=new AbortController();
killTimer=setTimeout(async()=>{
document.querySelectorAll('[data-kill]').forEach(b=>b.closest('.switch').classList.add('pending'));
try{const d=await api('api/killswitch',{method:'POST',body:{enabled:on},signal:killAbort.signal});
if(S.status&&d&&typeof d.killSwitch==='boolean')S.status.killSwitch=d.killSwitch;
syncKillUI();toast(t(on?'toast.killOn':'toast.killOff'),'ok')}
catch(e){if(e&&e.name==='AbortError')return;
if(S.status)S.status.killSwitch=!on;
syncKillUI();toastErr(e)}
finally{document.querySelectorAll('[data-kill]').forEach(b=>b.closest('.switch').classList.remove('pending'))}},300)}
function toastErr(e){toast(!e||e.status===0?t('toast.networkError'):e.message||t('common.error'),'err')}
async function loadHomePool(){
const box=$('home-pool');if(!box)return;
box.innerHTML='<span class="field__hint">'+esc(t('common.loading'))+'</span>';
try{S.pool=await api('api/proxy-pool?probe=1',{fresh:true});renderHomePool()}catch(e){if(e&&e.status===401)return;box.innerHTML='<p class="field__error" style="display:block">'+esc(t('egress.pool.failed'))+'</p>'}}
function renderHomePool(){
const box=$('home-pool');if(!box)return;
const pool=(S.pool&&S.pool.pool)||[];
if(!pool.length){box.innerHTML='<span class="field__hint">'+esc(t('egress.pool.empty'))+'</span>';return}
const probe=((S.pool&&S.pool.probe)||[]);const map=new Map();probe.forEach(p=>map.set(p.ip+':'+p.port,p));
box.innerHTML=pool.slice(0,8).map(function(e){
const k=e.ip+':'+e.port;const pr=map.get(k);
const status=pr?(pr.status==='ok'?'<span class="glyph-ok">✓ '+pr.latencyMs+'ms</span>':'<span class="glyph-bad">✗</span>'):'<span class="pool-status">'+esc(t('egress.pool.untested'))+'</span>';
return '<div class="pool-row"><span class="pool-cell" dir="ltr">'+esc(k)+'</span><span class="pool-status">'+status+'</span></div>'}).join('')}
async function loadHomeUsers(){
const box=$('home-users');if(!box)return;
try{const d=await api('api/users',{fresh:true});S.users=d.users||[];renderHomeUsers()}catch(e){if(e&&e.status===401)return;box.innerHTML='<p class="field__error" style="display:block">'+esc(t('users.load_failed'))+'</p>'}}
function renderHomeUsers(){
const box=$('home-users');if(!box)return;
const all=S.users||[];const active=all.filter(u=>u.enabled&&!isUserExpired(u)).length;
box.innerHTML='<div class="stat-grid"><span class="lbl">'+esc(t('users.title'))+'</span><span class="mono">'+all.length+'</span><span></span><span class="lbl">'+esc(t('home.users.active'))+'</span><span class="mono">'+active+'</span></div>'}
async function loadMyIp(){const box=$('ip-body');
if(!box)return;
box.innerHTML='<span class="field__hint">'+esc(t('common.loading'))+'</span>';
try{
const d=await fetch(BASE+'my-ip',{credentials:'same-origin',headers:{Accept:'application/json'}});
if(!d.ok)throw 0;
const j=await d.json();
const data=j&&j.ok!==undefined?j.data:j;
box.innerHTML='<table class="tbl"><tbody>'
+'<tr><td data-l="'+esc(t('home.stats.via_cf'))+'"><code dir="ltr" class="mono">'+esc(data.cfEgressIp||'—')+(data.colo?' · '+esc(data.colo):'')+'</code></td><td class="h-cell" data-l="'+esc(t('home.stats.via_other'))+'"><code dir="ltr" class="mono">'+esc(data.ip||'—')+'</code></td></tr>'
+'<tr><td data-l="'+esc(t('home.stats.colo'))+'">'+esc(data.colo||'—')+'</td><td data-l="'+esc(t('home.stats.country'))+'">'+esc(data.country||'—')+'</td></tr>'
+'<tr><td data-l="'+esc(t('home.stats.city'))+'">'+esc(data.city||'—')+'</td><td data-l="'+esc(t('home.stats.asn'))+'">'+esc(data.asn||'—')+'</td></tr>'
+'</tbody></table>'}
catch(e){box.innerHTML='<p class="field__error" style="display:block">'+esc(t('home.stats.failed'))+'</p>'}}