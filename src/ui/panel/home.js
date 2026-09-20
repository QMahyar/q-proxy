
const FPS=['chrome','firefox','safari','ios','android','edge','360','qq','random','randomized'];
const PACKETS=['tlshello','1-1','1-2','1-3','1-5'];
const PRESETS={low:[100,200,1,1],medium:[50,100,1,5],high:[10,20,10,20],severe:[1,5,1,5]};
const CDN_PRESETS=[{id:'cf-443-a',ip:'104.17.0.0',port:443},{id:'cf-443-b',ip:'104.18.0.0',port:443},{id:'cf-443-c',ip:'104.19.0.0',port:443},{id:'cf-2053-a',ip:'104.21.0.0',port:2053},{id:'cf-2083-a',ip:'172.64.32.1',port:2083},{id:'cf-2096-a',ip:'188.114.96.1',port:2096},{id:'cf-80-a',ip:'104.17.0.0',port:80},{id:'cf-8080-a',ip:'172.64.32.1',port:8080}];
const S={set:{},rev:null,status:null,subs:[],snap:{},dirty:new Set(),subMode:(function(){try{return localStorage.getItem('qp_submode')||'normal'}catch(e){return 'normal'}})(),warp:null,pool:null};
let UID=0;
function getPath(o,p){return p.split('.').reduce((a,k)=>a==null?undefined:a[k],o)}
function setPath(o,p,v){const ks=p.split('.');let c=o;for(let i=0;i<ks.length-1;i++){if(typeof c[ks[i]]!=='object'||c[ks[i]]===null)c[ks[i]]={};c=c[ks[i]]}c[ks[ks.length-1]]=v}
function leaves(o,pre,out){for(const k in o){const p=pre?pre+'.'+k:k;const v=o[k];if(v&&typeof v==='object'&&!Array.isArray(v))leaves(v,p,out);else out[p]=v}return out}
function buildShell(){
$('tab-home').textContent=t('nav.home');
$('tab-subs').textContent=t('nav.subs');
$('tab-warp').textContent=t('nav.warp');
$('tab-settings').textContent=t('nav.settings');
$('home-h1').textContent=t('nav.home');
$('subs-h1').textContent=t('tabs.subs.title');
$('warp-h1').textContent=t('nav.warp');
$('settings-h1').textContent=t('nav.settings');
$('logout-btn').setAttribute('aria-label',t('nav.logout'));
$('logout-btn').title=t('nav.logout');
$('shortcuts-btn').setAttribute('aria-label',t('shortcuts.title'));
$('shortcuts-btn').title=t('shortcuts.title');
$('dirty-label').textContent=t('common.unsaved');
$('discard-btn').textContent=t('common.discard');
$('apply-btn').textContent=t('common.apply');
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
document.querySelectorAll('.swatch').forEach(b=>{const nm=t('accent.'+(b.dataset.accent||'cyan'));b.setAttribute('aria-label',nm);b.title=nm});
const _nav=$('nav');if(_nav)_nav.setAttribute('aria-label',t('nav.views'));
const _sw=document.querySelector('.swatches');if(_sw)_sw.setAttribute('aria-label',t('accent.label'));
const _skip=$('skip-link');if(_skip)_skip.textContent=t('common.skip');
document.title='Q Proxy';
const seg=$('langseg');seg.setAttribute('aria-label',t('common.language'));seg.innerHTML='';
[['en','lang.en'],['fa','lang.fa']].forEach(([code,label])=>{const b=document.createElement('button');b.type='button';b.textContent=t(label);b.setAttribute('aria-checked',String(LANG===code));b.setAttribute('role','radio');b.addEventListener('click',()=>{if(code!==LANG){if(S.dirty&&S.dirty.size>0&&!confirm(t('common.unsaved')))return;setLangCookie(code);location.reload()}});seg.appendChild(b)})}
function parseRoute(){
// Unknown or deleted views redirect to home.
const h=location.hash.replace(/^#\/?/,'');
const seg=h.split('/');
if(seg[0]==='settings'){
if(seg[1]==='users')return{view:'home'};
if(seg[1]==='warp')return seg[2]?{view:'warp',warpId:seg[2],redirect:true}:{view:'warp',redirect:true};
return{view:'settings',sec:SECTIONS.some(s=>s.key===seg[1])?seg[1]:'general'}}
if(seg[0]==='users')return{view:'home'};
if(seg[0]==='warp')return{view:'warp',warpId:seg[1]||undefined};
if(seg[0]==='subs')return{view:'subs'};
return{view:'home'}}
function navigate(){
const r=parseRoute();
const h=location.hash;
if(r.redirect){history.replaceState(null,'','#/warp'+(r.warpId?'/'+r.warpId:''))}
if(r.view==='home'&&h!==''&&h!=='#'&&h!=='#/home')history.replaceState(null,'','#/home');
if(r.view==='settings'&&SECTIONS.some(s=>s.key===r.sec))history.replaceState(null,'','#/settings/'+r.sec+(r.warpId?'/'+r.warpId:''));
['home','subs','settings','warp'].forEach(v=>{$('view-'+v).hidden=v!==r.view});
document.querySelectorAll('#nav .tab').forEach(a=>{a.setAttribute('aria-selected',String(a.dataset.view===r.view));a.tabIndex=a.dataset.view===r.view?0:-1});
if(r.view==='settings')showSection(r.sec);
if(r.view==='subs')showSubsView();
if(r.view==='warp')showWarpView(r.warpId);
if(r.view==='home'||r.view==='subs')ensureFreshSubs();
window.scrollTo(0,0);
const titleMap={home:'nav.home',subs:'tabs.subs.title',warp:'nav.warp',settings:'tabs.settings.'+(r.sec||'general')};
const ttl=titleMap[r.view]||'nav.home';
const h1=$('view-'+r.view+'-h1')||$(r.view+'-h1')||$('main');
if(h1){h1.setAttribute('tabindex','-1');h1.focus({preventScroll:true})}
try{announce(t(ttl))}catch(e){}
document.querySelectorAll('#subtabs .subtab').forEach(c=>c.tabIndex=c.getAttribute('aria-selected')==='true'?0:-1)}
let subsFreshAt=0,subsFreshView='',subsRefreshBusy=null;
function ensureFreshSubs(){
const v=parseRoute().view;
if(subsFreshAt===0){subsFreshAt=Date.now();subsFreshView=v;return}
if(subsRefreshBusy)return;
if(Date.now()-subsFreshAt<30000&&subsFreshView===v)return;
subsRefreshBusy=(async()=>{
let d=null;try{d=await api('api/bootstrap')}catch(e){subsRefreshBusy=null;return}
subsRefreshBusy=null;
if(!d)return;
S.subs=(d.subUrls&&d.subUrls.urls)||[];
subsFreshAt=Date.now();
subsFreshView=parseRoute().view;
const cv=parseRoute().view;
if(cv==='home'&&!$('view-home').hidden)renderHome();
else if(cv==='subs'&&!$('view-subs').hidden)showSubsView()})()}
function showWarpView(warpId){
if(!S.warp&&!warpLoadError){const panel=$('warp-body');if(panel)panel.innerHTML='<section class="card">'+loadingBox({rows:4})+'</section>'}
loadWarpIfNeeded().then(()=>{if(parseRoute().view!=='warp')return;if(warpId)renderWarpDetail(warpId);else renderWarpSection()})}
function showSection(sec){
SECTIONS.forEach(s=>{const p=$('sp-'+s.key);if(p)p.hidden=s.key!==sec});
document.querySelectorAll('#subtabs .subtab').forEach(a=>a.setAttribute('aria-selected',String(a.dataset.sec===sec)))}
function buildSubtabs(){
const bar=$('subtabs');bar.setAttribute('aria-label',t('settings.sections'));bar.innerHTML='';
SECTIONS.forEach(s=>{const a=document.createElement('button');a.type='button';a.className='subtab';a.role='tab';a.id='st-'+s.key;a.dataset.sec=s.key;a.textContent=t('tabs.settings.'+s.key);a.setAttribute('aria-selected','false');a.setAttribute('aria-controls','sp-'+s.key);a.tabIndex=-1;a.addEventListener('click',()=>{location.hash='#/settings/'+s.key});bar.appendChild(a)})}
function subUrlWithMode(u){
if(S.subMode!=='fragment')return u;
return u+(u.includes('?')?'&':'?')+'mode=fragment'}
function formatLabel(f){const m=FORMAT_LABELS[f];return m?t(m.key):f}
function copyFieldHtml(value,idAttr){
const lbl=idAttr?String(idAttr):'';
return '<div class="copy-field"><code id="'+idAttr+'" dir="ltr">'+esc(value)+'</code><button type="button" class="btn btn--icon btn--sm" data-action="copy" data-copy-id="'+idAttr+'" aria-label="'+esc(t('common.copy')+(lbl?' '+lbl:''))+'"><svg aria-hidden="true"><use href="#i-copy"/></svg></button><button type="button" class="btn btn--icon btn--sm" data-action="qr" data-qr="'+esc(value)+'" aria-label="'+esc(t('common.qr')+(lbl?' '+lbl:''))+'"><svg aria-hidden="true"><use href="#i-qr"/></svg></button></div>'}
function renderHome(){
const body=$('home-body');
body.innerHTML='';
const protoCount=['vlessEnabled'].filter(k=>S.set&&S.set[k]).length;
const chips=document.createElement('div');chips.className='chips-row';
chips.innerHTML='<span class="stat-chip"><span class="dot dot-cyan"></span>'+esc(t('home.chips.protocols',{n:protoCount}))+'</span><span class="stat-chip"><span class="dot dot-violet"></span>'+esc(t('home.chips.formats',{n:(S.subs||[]).filter(u=>!isInfoEntry(u)).length}))+'</span>';
body.appendChild(chips);
const subs=document.createElement('section');subs.className='card';
let sh='<div class="card__head"><div><div class="card__title">'+esc(t('home.subs.title'))+'</div><div class="field__hint">'+esc(t('home.subs.desc'))+'</div><div class="field__hint">'+esc(t('home.subs.quota'))+'</div></div><div class="seg" role="radiogroup" aria-label="'+esc(t('home.subs.mode.normal'))+'/'+esc(t('home.subs.mode.fragment'))+'">';
[['normal','home.subs.mode.normal'],['fragment','home.subs.mode.fragment']].forEach(([m,k])=>{sh+='<button type="button" role="radio" aria-checked="'+String(S.subMode===m)+'" data-mode="'+m+'">'+esc(t(k))+'</button>'});
sh+='</div></div>';
const urls=mainSubEntries();
urls.slice(0,3).forEach((entry,i)=>{sh+='<div class="row"><span class="field__label" style="margin:0;flex:none;max-width:40%">'+esc(formatLabel(entry.format))+'</span>'+copyFieldHtml(subUrlWithMode(entry.url),'sub-u'+i)+'</div>'});
if(urls.length)sh+='<div class="row" style="border-block-end:0"><a class="btn btn--ghost btn--sm" href="#/subs">'+esc(t('home.subs.viewall'))+'<svg aria-hidden="true" class="viewall-icon"><use href="#i-back"/></svg></a></div>';
subs.innerHTML=sh;
body.appendChild(subs);
if(!S.warp)loadWarpIfNeeded().then(()=>{if(S.warp)renderHome()});
const right=document.createElement('div');
const kill=document.createElement('section');kill.className='card';
kill.innerHTML='<div class="card__head"><div class="card__title">'+esc(t('home.kill.title'))+'</div><span class="chip-status ok" id="kill-chip"></span></div><p class="field__hint" id="kill-desc"></p><div class="row" style="border:0"><label class="switch"><input type="checkbox" role="switch" data-kill'+(S.status&&S.status.killSwitch?' checked':'')+'><span class="switch__track"><span class="switch__thumb"></span></span><span class="switch__label">'+esc(t('general.killSwitch.label'))+'</span></label></div>';
right.appendChild(kill);
const pool=document.createElement('section');pool.className='card';
pool.innerHTML='<div class="card__head"><div class="card__title">'+esc(t('egress.pool.title'))+'</div><button type="button" class="btn btn--ghost btn--sm" data-action="home-pool-refresh"><svg aria-hidden="true"><use href="#i-refresh"/></svg>'+esc(t('home.stats.refresh'))+'</button></div><div id="home-pool"><span class="field__hint">'+esc(t('egress.pool.idle'))+'</span></div>';
right.appendChild(pool);
if(S.status){
const st=document.createElement('section');st.className='card';
const u=S.status.usage||{requestsToday:0,requestsTotal:0};
const todayStr=u.requestsToday!=null?fmtInt(u.requestsToday):'—';
const totalStr=u.requestsTotal!=null?fmtInt(u.requestsTotal):'—';
st.innerHTML='<div class="card__head"><div class="card__title">'+esc(t('home.status.title'))+'</div><span class="field__hint">'+esc(t('home.status.estimate'))+'</span></div><div class="stat-grid"><span class="lbl">'+esc(t('home.status.version'))+'</span><span class="mono">v'+esc(S.status.version||'')+'</span><span></span><span class="lbl">'+esc(t('home.status.colo'))+'</span><span class="mono h-cell">'+esc(S.status.colo||'—')+'</span><span></span><span class="lbl">'+esc(t('home.status.today'))+'</span><span class="mono">'+esc(todayStr)+'</span><span class="mono">'+esc(totalStr)+'</span></div><div id="traffic-chart"></div>';
right.appendChild(st)}
body.appendChild(right);
recordTraffic();
renderTraffic();
loadHomePool();
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
function toastErr(e){if(e&&e.handled)return;if(e&&e.retryAfter)toast(t('toast.rateLimited',{s:e.retryAfter}),'err');else if(!e||e.status===0)toast(t('toast.networkError'),'err');else if(e.code)toast(e.message||e.code,'err');else toast(e.message||t('common.error'),'err')}
async function loadHomePool(){
const box=$('home-pool');if(!box)return;
box.innerHTML=loadingBox({rows:2,label:'common.loading'});
try{S.pool=await api('api/proxy-pool?probe=1',{fresh:true});renderHomePool()}catch(e){if(e&&e.status===401)return;const net=e&&e.status===0;box.innerHTML=errorCard({title:'egress.pool.failed',msg:net?'toast.networkError':null,retryAction:'data-retry="home-pool"'})}}
function renderHomePool(){
const box=$('home-pool');if(!box)return;
const pool=(S.pool&&S.pool.pool)||[];
if(!pool.length){box.innerHTML=emptyCard({title:'egress.pool.empty',cta:'common.retry',attrs:'data-retry="home-pool"'});return}
const probe=((S.pool&&S.pool.probe)||[]);const map=new Map();probe.forEach(p=>map.set(p.ip+':'+p.port,p));
box.innerHTML=pool.slice(0,8).map(function(e){
const k=e.ip+':'+e.port;const pr=map.get(k);
const latency=pr&&pr.latencyMs!=null?esc(String(pr.latencyMs))+'ms':'';
const status=pr?(pr.status==='ok'?'<span class="glyph-ok">✓ '+latency+'</span>':'<span class="glyph-bad">✗</span>'):'<span class="pool-status">'+esc(t('egress.pool.untested'))+'</span>';
return '<div class="pool-row"><span class="pool-cell" dir="ltr">'+esc(k)+'</span><span class="pool-status">'+status+'</span></div>'}).join('')}

