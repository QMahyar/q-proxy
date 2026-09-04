
const WARP_F=[['wireguard-conf','WireGuard .conf (ZIP)','grad-1'],['wireguard-conf-amnezia','WireGuard .conf Amnezia (ZIP)','grad-4'],['throne','Throne wg://','grad-5'],['throne-amnezia','Throne wg:// Amnezia','grad-4'],['wireguard-uri','wireguard://','grad-2'],['v2rayn','V2RayN (base64)','grad-3'],['singbox','sing-box','grad-6'],['singbox-amnezia','sing-box Amnezia','grad-4'],['singbox-legacy','sing-box legacy','grad-2'],['singbox-legacy-amnezia','sing-box legacy Amnezia','grad-3'],['xray','Xray','grad-1'],['clash','Clash / mihomo','grad-5'],['clash-amnezia','Clash / mihomo Amnezia','grad-4'],['surge','Surge','grad-6'],['surfboard','Surfboard','grad-2'],['loon','Loon','grad-3'],['egern','Egern','grad-6']];
function warpSubUrl(token,format){return location.origin+BASE+'sub/wg/'+token+'/'+format}
let warpPromise=null;
function loadWarp(){if(!warpPromise)warpPromise=(async()=>{const[acc,pre,amz]=await Promise.all([api('api/warp/account'),api('api/warp/presets'),api('api/warp/settings/amnezia')]);return S.warp={accounts:acc.accounts,presets:pre.presets,amnezia:amz.amnezia}})().catch(e=>{warpPromise=null;toastErr(e);throw e});return warpPromise}
function loadWarpIfNeeded(){return S.warp?Promise.resolve(S.warp):loadWarp().catch(()=>null)}
function invalidateWarp(){S.warp=null;warpPromise=null}
function poolCardHtml(){
return '<section class="card"><div class="card__head"><div><div class="card__title">'+esc(t('egress.pool.title'))+'</div><div class="field__hint">'+esc(t('egress.pool.desc'))+'</div></div><div class="btn-row"><button type="button" class="btn btn--ghost btn--sm" data-action="pool-fetch">'+esc(t('egress.pool.fetch'))+'</button><button type="button" class="btn btn--primary btn--sm" data-action="pool-test">'+esc(t('egress.pool.test'))+'</button></div></div><div id="pool-list" class="pool-list"><span class="field__hint">'+esc(t('egress.pool.idle'))+'</span></div></section>'}
function sourcesCardHtml(){
return '<section class="card"><div class="card__head"><div class="card__title">'+esc(t('sources.title'))+'</div></div><p class="field__hint">'+esc(t('sources.desc'))+'</p>'
+'<div class="field"><span class="field__label">'+esc(t('sources.links.label'))+'</span><div class="line-editor"><textarea rows="4" class="input textarea textarea--mono" dir="ltr" spellcheck="false" placeholder="https://…" data-bind="sourceUrls" data-validate="url">'+esc((S.set.sourceUrls||[]).join('\n'))+'</textarea><div class="meta"><span class="cnt"></span><span class="bad"></span></div></div><p class="field__hint">'+esc(t('sources.links.hint'))+'</p></div>'
+'<div class="field"><span class="field__label">'+esc(t('sources.tools.title'))+'</span><div class="btn-row"><button type="button" class="btn btn--ghost btn--sm" data-action="pool-fetch">'+esc(t('egress.pool.fetch'))+'</button><button type="button" class="btn btn--ghost btn--sm" data-action="source-doh">'+esc(t('sources.tools.doh'))+'</button></div><p class="field__hint">'+esc(t('sources.tools.hint'))+'</p></div></section>'}
async function loadPool(probe){
const box=$('pool-list');if(!box)return;
box.innerHTML='<span class="field__hint">'+esc(t('common.loading'))+'</span><span class="spin" style="display:inline-block;vertical-align:middle"></span>';
try{
const d=await api('api/proxy-pool'+(probe?'?probe=1':''),{fresh:true});
S.pool=d;S.poolSource=d.source;S.poolAt=Date.now();renderPool()}
catch(e){if(e&&e.status===401)return;box.innerHTML='<p class="field__error" style="display:block">'+esc(t('egress.pool.failed'))+'</p>'}}
function renderPool(){
const box=$('pool-list');if(!box)return;
const pool=(S.pool&&S.pool.pool)||[];
if(!pool.length){box.innerHTML='<span class="field__hint">'+esc(t('egress.pool.empty'))+'</span>';return}
const probe=((S.pool&&S.pool.probe)||[]);
const map=new Map();probe.forEach(p=>{map.set(p.ip+':'+p.port,p)});
const poolSrc=(S.poolSource||'list');
const at=S.poolAt?new Date(S.poolAt).toLocaleTimeString():'';
const head='<div class="pool-meta"><span class="pool-status">'+esc(t('egress.pool.source'))+': '+esc(poolSrc)+'</span>'+ (at?'<span class="pool-status">· '+esc(t('egress.pool.updated'))+' '+esc(at)+'</span>':'')+'</div>';
const sorted=[...pool].sort(function(a,b){const pa=map.get(a.ip+':'+a.port),pb=map.get(b.ip+':'+b.port);const oa=pa?pa.latencyMs:1e9,ob=pb?pb.latencyMs:1e9;if(oa===ob)return 0;if(oa===1e9)return 1;if(ob===1e9)return -1;return oa-ob});
box.innerHTML=head+sorted.slice(0,16).map(function(e){
const k=e.ip+':'+e.port;const pr=map.get(k);
const status=pr?(pr.status==='ok'?('<span class="glyph-ok">✓</span> '+pr.latencyMs+'ms'):'<span class="glyph-bad">✗</span>'):'<span class="pool-status">'+esc(t('egress.pool.untested'))+'</span>';
return '<div class="pool-row"><span class="pool-cell" dir="ltr">'+esc(k)+'</span><span class="pool-status">'+status+'</span><button type="button" class="btn btn--icon btn--sm btn--ghost" data-action="pool-add" data-addr="'+esc(k)+'" aria-label="'+esc(t('common.add'))+'"><svg aria-hidden="true"><use href="#i-copy"/></svg></button></div>'}).join('')}
function renderAddrDots(){
const map=new Map();
(S.addrHealth||[]).forEach(r=>{const ip=String(r.ip||'').replace(/^\[|\]$/g,'').toLowerCase();map.set(ip+':'+String(r.port||''),r)});
document.querySelectorAll('#sp-addresses [data-addr-dot]').forEach(function(dot){
const card=dot.closest('.addr-card');if(!card)return;
const addr=(card.querySelector('[data-addr-field="address"]').value||'').trim();
let host=addr;let portFromAddr='';
const br=addr.match(/^\[([^\]]+)\](?::(\d+))?$/);if(br){host=br[1];if(br[2])portFromAddr=br[2]}
else{const c=addr.lastIndexOf(':');if(c>0&&!addr.includes('::')){host=addr.slice(0,c);portFromAddr=addr.slice(c+1)}}
const port=portFromAddr||(card.querySelector('[data-addr-field="port"]').value||'').trim()||String(S.set.defaultPort||443);
const r=map.get(host.replace(/^\[|\]$/g,'').toLowerCase()+':'+port);
if(r){dot.hidden=false;dot.className='addr-dot '+(r.status==='ok'?'dot--ok':'dot--bad');dot.title=r.latencyMs!=null?(r.latencyMs+'ms'):t('egress.pool.untested')}
else dot.hidden=true});
}
function warpCardHtml(card){
if(card.warpAccounts)return '<section class="card"><div class="card__head"><div><div class="card__title">'+esc(t('warp.accounts'))+'</div></div><div class="btn-row"><button type="button" class="btn btn--ghost btn--sm" data-action="warp-import-open">'+esc(t('warp.import'))+'</button><button type="button" class="btn btn--primary btn--sm" data-action="warp-generate-open">'+esc(t('warp.generate'))+'</button></div></div><div id="warp-accounts" class="warp-grid"></div></section>';
if(card.warpPresets)return '<section class="card"><div class="card__head"><div class="card__title">'+esc(t('warp.presets.title'))+'</div><button type="button" class="btn btn--primary btn--sm" data-action="warp-preset-add">'+esc(t('warp.presets.add'))+'</button></div><div id="warp-presets"></div></section>';
if(card.warpAmnezia)return '<section class="card"><div class="card__head"><div class="card__title">'+esc(t('warp.amnezia.title'))+'</div></div><p class="field__hint" style="margin-block-end:12px">'+esc(t('warp.amnezia.desc'))+'</p><div class="amz-grid" id="warp-amnezia"></div><button type="button" class="btn btn--primary" data-action="warp-amnezia-save">'+esc(t('warp.amnezia.save'))+'</button></section>';
return ''}
function renderWarpSection(){
const panel=$('sp-warp');if(!panel)return;
if(!$('warp-accounts'))panel.innerHTML=warpCardHtml({warpAccounts:true})+warpCardHtml({warpPresets:true})+warpCardHtml({warpAmnezia:true});
const W=S.warp;if(!W)return;
const ac=$('warp-accounts');
if(ac){
ac.innerHTML='<div class="chips-row" style="grid-column:1/-1;margin-block-end:4px"><span class="stat-chip"><span class="dot dot-cyan"></span>'+esc(t('warp.chips.accounts',{n:W.accounts.length}))+'</span><span class="stat-chip"><span class="dot dot-violet"></span>'+esc(t('warp.chips.presets',{n:W.presets.length}))+'</span><span class="stat-chip"><span class="dot dot-cyan"></span>'+esc(t('home.chips.formats',{n:WARP_F.length}))+'</span><span class="stat-chip"><span class="dot dot-violet"></span>'+esc(t('warp.chips.direct'))+'</span></div>';
if(!W.accounts.length){ac.insertAdjacentHTML('beforeend','<div class="empty-card" style="grid-column:1/-1"><div class="empty-icon"><svg aria-hidden="true"><use href="#i-download"/></svg></div><div class="empty-title">'+esc(t('warp.empty_title'))+'</div><p class="empty-msg">'+esc(t('warp.empty_msg'))+'</p><div class="empty-actions"><button type="button" class="btn btn--primary btn--sm" data-action="warp-generate-open">'+esc(t('warp.generate'))+'</button><button type="button" class="btn btn--ghost btn--sm" data-action="warp-import-open">'+esc(t('warp.import'))+'</button></div></div>')}
else W.accounts.forEach(function(a,i){const eps=a.endpoint_list&&a.endpoint_list.type==='custom'?t('warp.detail.custom_eps',{n:a.endpoint_list.custom_endpoints.length}):(W.presets.find(function(p){return p.id===(a.endpoint_list&&a.endpoint_list.preset_id)})||{name:a.endpoint_list&&a.endpoint_list.preset_id||''}).name;ac.insertAdjacentHTML('beforeend','<a class="acct-card" href="#/settings/warp/'+esc(a.id)+'"><span class="avatar-tile grad-'+((i%6)+1)+'">'+esc((a.name[0]||'W').toUpperCase())+'</span><span class="acct-info"><span class="acct-name">'+esc(a.name)+'</span><span class="acct-date">'+esc((a.created_at||'').slice(0,10))+' · '+esc(eps)+'</span></span>'+(a.amnezia_overrides?'<span class="amz-tag">AMZ</span>':'')+'</a>')})}
const pr=$('warp-presets');
if(pr){let ph='';W.presets.forEach(function(p){const preview=p.endpoints.slice(0,3).map(function(e){return e.ip+':'+e.port}).join(', ')+(p.endpoints.length>3?' +'+(p.endpoints.length-3):'');ph+='<div class="row"><div style="min-width:0"><div class="acct-name">'+esc(p.name)+'</div><div class="acct-date" dir="ltr">'+esc(preview)+'</div></div><div class="btn-row"><span class="stat-chip">'+esc(t('warp.presets.count',{n:p.endpoints.length}))+'</span><button type="button" class="btn btn--icon btn--sm btn--ghost" data-action="warp-preset-edit" data-id="'+esc(p.id)+'" aria-label="'+esc(t('common.edit'))+'"><svg aria-hidden="true"><use href="#i-edit"/></svg></button><button type="button" class="btn btn--icon btn--sm btn--ghost-danger" data-action="warp-preset-del" data-id="'+esc(p.id)+'" aria-label="'+esc(t('common.delete'))+'"><svg aria-hidden="true"><use href="#i-x"/></svg></button></div></div>'});pr.innerHTML=ph}
const am=$('warp-amnezia');
if(am){const AMZ=[['Jc','Jc (0-128)'],['Jmin','Jmin (0-1280)'],['Jmax','Jmax (0-1280)'],['S1','S1 (0-65535)'],['S2','S2 (0-65535)'],['S3','S3 (0-65535)'],['S4','S4 (0-65535)'],['H1','H1'],['H2','H2'],['H3','H3'],['H4','H4']];let ah='';AMZ.forEach(function(kv){const key=kv[0],lbl=kv[1];const v=W.amnezia&&W.amnezia[key]!==undefined&&W.amnezia[key]!==null?W.amnezia[key]:'';ah+='<div class="field"><label class="field__label" for="amz-'+key+'">'+esc(lbl)+'</label><input class="input" type="text" id="amz-'+key+'" dir="ltr" value="'+esc(String(v))+'"></div>'});ah+='<div class="field" style="grid-column:1/-1"><label class="field__label" for="amz-I1">'+esc(t('warp.amnezia.i1'))+'</label><input class="input" type="text" id="amz-I1" dir="ltr" value="'+esc(String(W.amnezia&&W.amnezia.I1||''))+'"></div>';am.innerHTML=ah}
}
function renderWarpDetail(id){
const panel=$('sp-warp');if(!panel)return;
if(!S.warp||!S.warp.accounts){location.hash='#/settings/warp';return}
const a=S.warp.accounts.find(function(x){return x.id===id});
if(!a){location.hash='#/settings/warp';return}
let html='<div class="detail-title"><a class="back-btn" href="#/settings/warp" aria-label="'+esc(t('warp.back'))+'"><svg aria-hidden="true"><use href="#i-back"/></svg></a><h2 class="view-title">'+esc(a.name)+'</h2>'+(a.amnezia_overrides?'<span class="amz-tag">AMZ</span>':'')+'</div>';
html+='<section class="token-panel"><div class="card__head" style="margin-block-end:6px"><span class="stat-chip"><span class="dot dot-cyan"></span>'+esc(t('warp.detail.token'))+'</span><div class="btn-row"><button type="button" class="btn btn--ghost btn--sm" data-action="warp-regen" data-id="'+esc(a.id)+'"><svg aria-hidden="true"><use href="#i-refresh"/></svg>'+esc(t('warp.detail.regen'))+'</button></div></div><code class="mono" dir="ltr" style="word-break:break-all;font-size:var(--fs-sm);color:var(--cyan-pale)">'+esc(a.token)+'</code></section>';
const presetSel='<select class="select" id="warp-preset">'+S.warp.presets.map(function(p){return '<option value="'+esc(p.id)+'"'+(a.endpoint_list.type==='preset'&&a.endpoint_list.preset_id===p.id?' selected':'')+'>'+esc(p.name)+' ('+p.endpoints.length+')</option>'}).join('')+'</select>';
html+='<section class="card"><div class="card__head"><div class="card__title">'+esc(t('warp.accounts'))+'</div></div><div class="field"><label class="field__label" for="warp-name">'+esc(t('warp.detail.name'))+'</label><div class="secret-field"><input class="input" type="text" id="warp-name" maxlength="100" value="'+esc(a.name)+'"><button type="button" class="btn btn--ghost btn--sm" data-action="warp-save" data-id="'+esc(a.id)+'" data-field="name">'+esc(t('common.apply'))+'</button></div></div><div class="field"><label class="field__label" for="warp-preset">'+esc(t('warp.detail.preset'))+'</label>'+presetSel+'</div><div class="field"><label class="field__label" for="warp-dns">'+esc(t('warp.detail.dns'))+'</label><div class="secret-field"><input class="input" type="text" id="warp-dns" dir="ltr" value="'+esc(a.dns||'')+'"><button type="button" class="btn btn--ghost btn--sm" data-action="warp-save" data-id="'+esc(a.id)+'" data-field="dns">'+esc(t('common.apply'))+'</button></div></div></section>';
const customEps=(a.endpoint_list.type==='custom'?a.endpoint_list.custom_endpoints:[]).map(function(e){return e.ip+':'+e.port}).join('\n');
html+='<section class="card"><div class="card__head"><div class="card__title">'+esc(t('warp.detail.custom_eps_title'))+'</div></div><p class="field__hint">'+esc(t('warp.detail.custom_eps_desc'))+'</p><div class="field"><textarea class="input textarea textarea--mono" id="warp-custom-eps" rows="5" dir="ltr" spellcheck="false" placeholder="162.159.192.1:2408">'+esc(customEps)+'</textarea></div><div class="btn-row"><button type="button" class="btn btn--primary btn--sm" data-action="warp-custom-eps-save" data-id="'+esc(a.id)+'">'+esc(t('common.save'))+'</button></div></section>';
html+='<section class="card"><div class="card__head"><div><div class="card__title">'+esc(t('warp.detail.subs'))+'</div><div class="field__hint">'+esc(t('warp.detail.subs_desc'))+'</div></div></div><div id="warp-detail-subs"></div></section>';
const ov=a.amnezia_overrides||S.warp.amnezia||{};
const AMZK=[['Jc','Jc (0-128)'],['Jmin','Jmin (0-1280)'],['Jmax','Jmax (0-1280)'],['S1','S1 (0-65535)'],['S2','S2 (0-65535)'],['S3','S3 (0-65535)'],['S4','S4 (0-65535)'],['H1','H1'],['H2','H2'],['H3','H3'],['H4','H4']];
let amh='<p class="field__hint" style="margin-block-end:12px">'+esc(a.amnezia_overrides?t('warp.detail.amnezia_on'):t('warp.detail.amnezia_off'))+'</p><div class="amz-grid">';
AMZK.forEach(function(kv){const key=kv[0];const valA=ov&&ov[key]!==undefined&&ov[key]!==null?ov[key]:'';amh+='<div class="field"><label class="field__label" for="amza-'+key+'">'+esc(kv[1])+'</label><input class="input" type="text" id="amza-'+key+'" dir="ltr" value="'+esc(String(valA))+'"></div>'});
amh+='<div class="field" style="grid-column:1/-1"><label class="field__label" for="amza-I1">'+esc(t('warp.amnezia.i1'))+'</label><input class="input" type="text" id="amza-I1" dir="ltr" value="'+esc(String((ov&&ov.I1)||''))+'"></div></div>';
amh+='<div class="btn-row"><button type="button" class="btn btn--primary btn--sm" data-action="warp-account-amnezia-save" data-id="'+esc(a.id)+'">'+esc(t('warp.detail.amnezia_save'))+'</button>'+(a.amnezia_overrides?'<button type="button" class="btn btn--ghost btn--sm" data-action="warp-amnezia-reset" data-id="'+esc(a.id)+'">'+esc(t('warp.detail.amnezia_reset'))+'</button>':'')+'</div>';
html+='<section class="card"><div class="card__head"><div class="card__title">'+esc(t('warp.amnezia.title'))+'</div></div>'+amh+'</section>';
html+='<section class="card card--danger"><div class="card__head"><div class="card__title">'+esc(t('warp.detail.delete'))+'</div></div><button type="button" class="btn btn--ghost-danger btn--sm" data-action="warp-delete" data-id="'+esc(a.id)+'">'+esc(t('warp.detail.delete'))+'</button></section>';
panel.innerHTML=html;
const subs=$('warp-detail-subs');let sh='';WARP_F.forEach(function(fmt,i){const f=fmt[0],label=fmt[1],grad=fmt[2];sh+='<div class="fmt-row"><span class="fmt-icon '+grad+'"><svg aria-hidden="true"><use href="#i-download"/></svg></span><span class="fmt-label">'+esc(label)+'</span>'+copyFieldHtml(warpSubUrl(a.token,f),'warp-u'+i)+'</div>'});subs.innerHTML=sh}
function warpSubsHtml(){
if(!S.warp||!S.warp.accounts.length)return '';
let h=S.warp.accounts.map(function(a){return '<details class="warp-acc"><summary><span class="acct-name">'+esc(a.name)+'</span> · '+WARP_F.length+'</summary><div class="warp-grid-sub">'+WARP_F.map(function(fmt,i){return '<div class="fmt-row"><span class="fmt-icon '+fmt[2]+'"><svg aria-hidden="true"><use href="#i-download"/></svg></span><span class="fmt-label">'+esc(fmt[1])+'</span>'+copyFieldHtml(warpSubUrl(a.token,fmt[0]),'hwarp-u'+a.id+'-'+i)+'</div>'}).join('')+'</div></details>'}).join('');
return '<div class="warp-subs"><div class="warp-subs__head">'+esc(t('home.subs.warp'))+'</div>'+h+'</div>'}
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