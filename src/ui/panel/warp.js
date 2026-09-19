
const WARP_W=[{id:'wireguard-conf',grad:'grad-1'},{id:'throne',grad:'grad-5'},{id:'v2rayn',grad:'grad-3'},{id:'singbox',grad:'grad-6'}];
function warpFmtLabel(id){return t('warp.fmt.'+id)}
function warpSubUrl(token,format){return location.origin+BASE+'sub/wg/'+token+'/'+format}
const WARP_GROUPS=[['wireguard','wireguard-conf'],['throne','throne'],['singbox','singbox'],['v2rayn','v2rayn']];
const WARP_EXT={'wireguard-conf':'zip','throne':'txt','v2rayn':'txt','singbox':'json'};
function fmtExtTag(id){const ext=WARP_EXT[id];return ext?'<span dir="ltr" style="flex:none;font-family:var(--font-mono);font-size:10px;color:var(--text-dim);border:1px solid var(--border-strong);border-radius:.375rem;padding:1px 6px">.'+esc(ext)+'</span>':''}
function renderWarpSubs(a){
const box=$('warp-detail-subs');if(!box)return;
let sh='';
WARP_GROUPS.forEach(function(g){
const fam=g[0],ids=g.slice(1);
sh+='<div class="warp-group" data-warp-group="'+esc(fam)+'"><div style="display:flex;align-items:center;gap:8px;margin-block:12px 2px"><span style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-ghost)">'+esc(t('warp.groups.'+fam))+'</span><span class="stat-chip" style="padding:.125rem .5rem">'+esc(t('warp.groups.count',{n:ids.length}))+'</span></div>';
WARP_W.forEach(function(f){
if(ids.indexOf(f.id)<0)return;
sh+='<div class="fmt-row" data-fmt="'+esc(f.id)+'"><span class="fmt-icon '+f.grad+'"><svg aria-hidden="true"><use href="#i-download"/></svg></span><span class="fmt-label">'+esc(warpFmtLabel(f.id))+'</span>'+fmtExtTag(f.id)+copyFieldHtml(warpSubUrl(a.token,f.id),'warp-u'+WARP_W.indexOf(f))+'</div>'});
sh+='</div>'});
box.innerHTML=sh}
let warpPromise=null;let warpLoadError=false;
function loadWarp(){if(!warpPromise)warpPromise=(async()=>{const[acc,pre,amz]=await Promise.all([api('api/warp/account'),api('api/warp/presets'),api('api/warp/settings/amnezia')]);S.warp={accounts:acc.accounts,presets:pre.presets,amnezia:amz.amnezia,amneziaEnabled:amz.amneziaEnabled===true};warpLoadError=false;return S.warp})().catch(e=>{warpPromise=null;if(!e||e.status!==401)warpLoadError=true;toastErr(e);throw e});return warpPromise}
function loadWarpIfNeeded(){return S.warp?Promise.resolve(S.warp):loadWarp().catch(()=>null)}
function invalidateWarp(){S.warp=null;warpPromise=null;
try{['api/warp/account','api/warp/presets','api/warp/settings/amnezia'].forEach(function(k){sessionStorage.removeItem('qpc:'+k);sessionStorage.removeItem('qpe:'+k)})}catch(e){}}
function retryWarp(id){const panel=$('warp-body');if(panel)panel.innerHTML='<section class="card">'+loadingBox({rows:4,label:'common.loading'})+'</section>';invalidateWarp();warpLoadError=false;loadWarpIfNeeded().then(function(){const r=parseRoute();if(r.view!=='warp')return;if(id)renderWarpDetail(id);else renderWarpSection()})}
function poolCardHtml(){
return '<section class="card"><div class="card__head"><div><div class="card__title">'+esc(t('egress.pool.title'))+'</div><div class="field__hint">'+esc(t('egress.pool.desc'))+'</div></div><div class="btn-row"><button type="button" class="btn btn--ghost btn--sm" data-action="pool-fetch">'+esc(t('egress.pool.fetch'))+'</button><button type="button" class="btn btn--primary btn--sm" data-action="pool-test">'+esc(t('egress.pool.test'))+'</button></div></div><div id="pool-list" class="pool-list"><span class="field__hint">'+esc(t('egress.pool.idle'))+'</span></div></section>'}
async function loadPool(probe){
const box=$('pool-list');if(!box)return;
box.innerHTML=loadingBox({rows:3});
try{
const d=await api('api/proxy-pool'+(probe?'?probe=1':''),{fresh:true});
S.pool=d;S.poolSource=d.source;S.poolAt=Date.now();renderPool()}
catch(e){if(e&&e.status===401)return;box.innerHTML=errorCard({title:'egress.pool.failed',retryAction:'data-action="pool-fetch"'})}}
function renderPool(){
const box=$('pool-list');if(!box)return;
const pool=(S.pool&&S.pool.pool)||[];
if(!pool.length){box.innerHTML=emptyCard({title:'egress.pool.empty',cta:'common.retry',attrs:'data-action="pool-fetch"'});return}
const probe=((S.pool&&S.pool.probe)||[]);
const map=new Map();probe.forEach(p=>{map.set(p.ip+':'+p.port,p)});
const poolSrc=(S.poolSource||'list');
const at=S.poolAt?new Date(S.poolAt).toLocaleTimeString(LANG==='fa'?'fa-IR':'en-US'):'';
const head='<div class="pool-meta"><span class="pool-status">'+esc(t('egress.pool.source'))+': '+esc(poolSrc)+'</span>'+ (at?'<span class="pool-status">· '+esc(t('egress.pool.updated'))+' '+esc(at)+'</span>':'')+'</div>';
const sorted=[...pool].sort(function(a,b){const pa=map.get(a.ip+':'+a.port),pb=map.get(b.ip+':'+b.port);const oa=pa?pa.latencyMs:1e9,ob=pb?pb.latencyMs:1e9;if(oa===ob)return 0;if(oa===1e9)return 1;if(ob===1e9)return -1;return oa-ob});
box.innerHTML=head+sorted.slice(0,16).map(function(e){
const k=e.ip+':'+e.port;const pr=map.get(k);
const latency=pr&&pr.latencyMs!=null?esc(String(pr.latencyMs))+'ms':'';
const status=pr?(pr.status==='ok'?('<span class="glyph-ok">✓ '+latency+'</span>'):'<span class="glyph-bad">✗</span>'):'<span class="pool-status">'+esc(t('egress.pool.untested'))+'</span>';
return '<div class="pool-row"><span class="pool-cell" dir="ltr">'+esc(k)+'</span><span class="pool-status">'+status+'</span><button type="button" class="btn btn--icon btn--sm btn--ghost" data-action="pool-add" data-addr="'+esc(k)+'" aria-label="'+esc(t('common.add')+': '+k)+'"><svg aria-hidden="true"><use href="#i-copy"/></svg></button></div>'}).join('')}
function warpErrorHtml(id){
return errorCard({title:'warp.error.title',msg:'warp.error.msg',retryAction:'data-warp-retry="'+esc(id||'')+'"'})}
function warpCardHtml(card){
if(card.warpAccounts)return '<section class="card"><div class="card__head"><div><div class="card__title">'+esc(t('warp.accounts'))+'</div></div><div class="btn-row"><button type="button" class="btn btn--ghost btn--sm" data-action="warp-import-open">'+esc(t('warp.import'))+'</button><button type="button" class="btn btn--primary btn--sm" data-action="warp-generate-open">'+esc(t('warp.generate'))+'</button></div></div><div id="warp-accounts" class="warp-grid"></div></section>';
if(card.warpEndpoints)return '<section class="card"><div class="card__head"><div><div class="card__title">'+esc(t('warp.endpoints.title'))+'</div><div class="field__hint">'+esc(t('warp.endpoints.desc'))+'</div></div></div><div id="warp-endpoints"></div></section>';
if(card.warpPresets)return '<section class="card"><div class="card__head"><div class="card__title">'+esc(t('warp.presets.title'))+'</div><button type="button" class="btn btn--primary btn--sm" data-action="warp-preset-add">'+esc(t('warp.presets.add'))+'</button></div><div id="warp-presets"></div></section>';
if(card.warpAmnezia)return '<section class="card"><div class="card__head"><div class="card__title">'+esc(t('warp.amnezia.title'))+'</div></div><p class="field__hint" style="margin-block-end:12px">'+esc(t('warp.amnezia.desc'))+'</p><div style="margin-block-end:12px"><label class="switch"><input type="checkbox" id="warp-amnezia-toggle"><span class="switch__track"><span class="switch__thumb"></span></span><span class="switch__label">'+esc(t('warp.amnezia.toggle'))+'</span></label><p class="field__hint" style="margin-block:8px 0">'+esc(t('warp.amnezia.toggle_hint'))+'</p></div><div class="amz-grid" id="warp-amnezia"></div><button type="button" class="btn btn--primary" data-action="warp-amnezia-save">'+esc(t('warp.amnezia.save'))+'</button></section>';
return ''}
function globalWarpEndpoints(){
const set=S.set||{};
const ids=new Set(Array.isArray(set.warpPresets)?set.warpPresets:[]);
const out=[];
const presets=(S.warp&&S.warp.presets)||[];
for(const p of presets){if(!ids.has(p.id))continue;for(const e of p.endpoints||[])out.push(e.ip+':'+e.port)}
for(const line of Array.isArray(set.warpCustomEndpoints)?set.warpCustomEndpoints:[]){
const t=String(line).trim();if(t.length>0)out.push(t)}
return out}
function globalWarpEndpointCount(){
return new Set(globalWarpEndpoints().map(function(e){return e.toLowerCase()})).size}
function renderWarpEndpoints(){
const box=$('warp-endpoints');if(!box||!S.warp)return;
const set=S.set||{};
const ticked=new Set(Array.isArray(set.warpPresets)?set.warpPresets:[]);
const custom=Array.isArray(set.warpCustomEndpoints)?set.warpCustomEndpoints.filter(function(l){return String(l).trim().length>0}):[];
let h='<div class="field"><span class="field__label">'+esc(t('warp.endpoints.presets'))+'</span><div class="check-list" role="group" id="warp-eps-presets" aria-label="'+esc(t('warp.endpoints.presets'))+'">';
for(const p of S.warp.presets||[]){
h+='<label class="check"><input type="checkbox" data-warp-preset="'+esc(p.id)+'"'+(ticked.has(p.id)?' checked':'')+'><span>'+esc(p.name)+'</span><span class="acct-date" dir="ltr">'+esc((p.endpoints||[]).slice(0,2).map(function(e){return e.ip+':'+e.port}).join(', '))+'</span></label>'}
h+='</div></div><div class="field"><div style="display:flex;align-items:center;gap:8px"><label class="field__label" style="margin:0" for="warp-eps-custom">'+esc(t('warp.endpoints.custom'))+'</label><span class="stat-chip">'+esc(t('warp.endpoints.count',{n:custom.length}))+'</span></div><textarea class="input textarea textarea--mono" id="warp-eps-custom" rows="4" dir="ltr" spellcheck="false" placeholder="162.159.192.1:2408">'+esc(custom.join('\n'))+'</textarea><p class="field__error"></p></div><div class="btn-row"><button type="button" class="btn btn--primary btn--sm" data-action="warp-endpoints-save">'+esc(t('warp.endpoints.save'))+'</button></div>';
box.innerHTML=h}
function renderWarpSection(){
const panel=$('warp-body');if(!panel)return;
if(!S.warp){if(warpLoadError)panel.innerHTML='<section class="card">'+warpErrorHtml('')+'</section>';return}
if(!$('warp-accounts'))panel.innerHTML=warpCardHtml({warpAccounts:true})+warpCardHtml({warpEndpoints:true})+warpCardHtml({warpPresets:true})+warpCardHtml({warpAmnezia:true});
const W=S.warp;
renderWarpEndpoints();
const ac=$('warp-accounts');
if(ac){
ac.innerHTML='<div class="chips-row" style="grid-column:1/-1;margin-block-end:4px"><span class="stat-chip"><span class="dot dot-cyan"></span>'+esc(t('warp.chips.accounts',{n:W.accounts.length}))+'</span><span class="stat-chip"><span class="dot dot-violet"></span>'+esc(t('warp.chips.presets',{n:W.presets.length}))+'</span><span class="stat-chip"><span class="dot dot-cyan"></span>'+esc(t('home.chips.formats',{n:WARP_W.length}))+'</span><span class="stat-chip"><span class="dot dot-violet"></span>'+esc(t('warp.chips.direct'))+'</span></div>';
if(!W.accounts.length){ac.insertAdjacentHTML('beforeend',emptyCard({icon:'i-download',title:'warp.empty_title',msg:'warp.empty_msg',cta:'warp.generate',attrs:'data-action="warp-generate-open"',style:'grid-column:1/-1',extraActions:'<button type="button" class="btn btn--ghost btn--sm" data-action="warp-import-open">'+esc(t('warp.import'))+'</button>'}))}
else W.accounts.forEach(function(a,i){ac.insertAdjacentHTML('beforeend','<a class="acct-card" href="#/warp/'+esc(a.id)+'"><span class="avatar-tile grad-'+((i%6)+1)+'">'+esc((a.name[0]||'W').toUpperCase())+'</span><span class="acct-info"><span class="acct-name">'+esc(a.name)+'</span><span class="acct-date">'+esc((a.created_at||'').slice(0,10))+' · '+esc(t('warp.endpoints.count',{n:fmtInt(globalWarpEndpointCount())}))+'</span></span></a>')})}
const pr=$('warp-presets');
if(pr){let ph='';W.presets.forEach(function(p){const preview=p.endpoints.slice(0,3).map(function(e){return e.ip+':'+e.port}).join(', ')+(p.endpoints.length>3?' +'+fmtInt(p.endpoints.length-3):'');ph+='<div class="row"><div style="min-width:0"><div class="acct-name">'+esc(p.name)+'</div><div class="acct-date" dir="ltr">'+esc(preview)+'</div></div><div class="btn-row"><span class="stat-chip">'+esc(t('warp.presets.count',{n:fmtInt(p.endpoints.length)}))+'</span><button type="button" class="btn btn--icon btn--sm btn--ghost" data-action="warp-preset-edit" data-id="'+esc(p.id)+'" aria-label="'+esc(t('common.edit'))+'"><svg aria-hidden="true"><use href="#i-edit"/></svg></button><button type="button" class="btn btn--icon btn--sm btn--ghost-danger" data-action="warp-preset-del" data-id="'+esc(p.id)+'" aria-label="'+esc(t('common.delete'))+'"><svg aria-hidden="true"><use href="#i-x"/></svg></button></div></div>'});pr.innerHTML=ph}
const am=$('warp-amnezia');
if(am){const AMZ=[['Jc','warp.amnezia.jc'],['Jmin','warp.amnezia.jmin'],['Jmax','warp.amnezia.jmax'],['S1','warp.amnezia.s1'],['S2','warp.amnezia.s2'],['S3','warp.amnezia.s3'],['S4','warp.amnezia.s4'],['H1','warp.amnezia.h1'],['H2','warp.amnezia.h2'],['H3','warp.amnezia.h3'],['H4','warp.amnezia.h4']];let ah='';AMZ.forEach(function(kv){const key=kv[0],lbl=kv[1];const v=W.amnezia&&W.amnezia[key]!==undefined&&W.amnezia[key]!==null?W.amnezia[key]:'';ah+='<div class="field"><label class="field__label" for="amz-'+key+'">'+esc(t(lbl))+'</label><input class="input" type="text" id="amz-'+key+'" dir="ltr" value="'+esc(String(v))+'"></div>'});ah+='<div class="field" style="grid-column:1/-1"><label class="field__label" for="amz-I1">'+esc(t('warp.amnezia.i1'))+'</label><input class="input" type="text" id="amz-I1" dir="ltr" value="'+esc(String(W.amnezia&&W.amnezia.I1||''))+'"></div>';am.innerHTML=ah;const amzTg=$('warp-amnezia-toggle');if(amzTg)amzTg.checked=W.amneziaEnabled===true}
}
function renderWarpDetail(id){
const panel=$('warp-body');if(!panel)return;
if(!S.warp){if(warpLoadError){panel.innerHTML='<div class="detail-title"><a class="back-btn" href="#/warp" aria-label="'+esc(t('warp.back'))+'"><svg aria-hidden="true"><use href="#i-back"/></svg></a><h2 class="view-title">'+esc(t('warp.error.title'))+'</h2></div><section class="card">'+warpErrorHtml(id)+'</section>';return}location.hash='#/warp';return}
if(!S.warp.accounts){location.hash='#/warp';return}
const a=S.warp.accounts.find(function(x){return x.id===id});
if(!a){location.hash='#/warp';return}
let html='<div class="detail-title"><a class="back-btn" href="#/warp" aria-label="'+esc(t('warp.back'))+'"><svg aria-hidden="true"><use href="#i-back"/></svg></a><h2 class="view-title">'+esc(a.name)+'</h2></div>';
html+='<section class="card"><div class="card__head"><div><div class="card__title">'+esc(t('warp.detail.subs'))+'</div><div class="field__hint">'+esc(t('warp.detail.subs_desc'))+'</div></div></div><div id="warp-detail-subs"></div></section>';
html+='<details class="warp-acc token-panel" id="warp-token-details"><summary><span class="stat-chip"><span class="dot dot-cyan"></span>'+esc(t('warp.detail.token'))+'</span><code class="mono" dir="ltr" style="font-size:var(--fs-sm)">'+esc(String(a.token||'').slice(0,8))+'…</code></summary><div class="warp-grid-sub"><code class="mono" dir="ltr" style="word-break:break-all;font-size:var(--fs-sm);color:var(--cyan-pale)">'+esc(a.token)+'</code><div class="btn-row"><button type="button" class="btn btn--ghost btn--sm" data-action="warp-regen" data-id="'+esc(a.id)+'"><svg aria-hidden="true"><use href="#i-refresh"/></svg>'+esc(t('warp.detail.regen'))+'</button></div><p class="field__hint" style="margin-block:8px 0">'+esc(t('warp.detail.token_hint'))+'</p></div></details>';
html+='<section class="card"><div class="card__head"><div class="card__title">'+esc(t('warp.accounts'))+'</div></div><div class="field"><label class="field__label" for="warp-name">'+esc(t('warp.detail.name'))+'</label><div class="secret-field"><input class="input" type="text" id="warp-name" maxlength="100" value="'+esc(a.name)+'"><button type="button" class="btn btn--ghost btn--sm" data-action="warp-save" data-id="'+esc(a.id)+'" data-field="name">'+esc(t('common.apply'))+'</button></div></div><div class="field"><label class="field__label" for="warp-dns">'+esc(t('warp.detail.dns'))+'</label><div class="secret-field"><input class="input" type="text" id="warp-dns" dir="ltr" value="'+esc(a.dns||'')+'"><button type="button" class="btn btn--ghost btn--sm" data-action="warp-save" data-id="'+esc(a.id)+'" data-field="dns">'+esc(t('common.apply'))+'</button></div></div></section>';
html+='<section class="card card--danger"><div class="card__head"><div class="card__title">'+esc(t('warp.detail.delete'))+'</div></div><button type="button" class="btn btn--ghost-danger btn--sm" data-action="warp-delete" data-id="'+esc(a.id)+'">'+esc(t('warp.detail.delete'))+'</button></section>';
panel.innerHTML=html;
renderWarpSubs(a)}
function openWarpModal(id,presetId){
const m=$(id);if(!m)return;
if(id==='m-warp-preset'){
if(!S.warp){toastErr();return}
if(presetId)m.dataset.presetId=presetId;else delete m.dataset.presetId;
const p=S.warp.presets.find(x=>x.id===presetId);
$('wp-name').value=p?p.name:'';
$('wp-endpoints').value=p?p.endpoints.map(e=>e.ip+':'+e.port).join('\n'):'';
$('wp-dns').value=p&&p.dns?p.dns:'';
$('wp-error').style.display='';$('wp-error').textContent='';
$('wp-title').textContent=t(p?'warp.presets.edit':'warp.presets.add');
$('wp-go').textContent=t(p?'common.save':'warp.presets.add')}
else if(id==='m-warp-generate'){$('wg-name').value=''}
else if(id==='m-warp-import'){$('wi-name').value='';$('wi-config').value='';$('wi-error').style.display='';$('wi-error').textContent=''}
openModal(id)}
