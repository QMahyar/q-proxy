const SUBS_MODE_IDS=['normal','fragment'];
function isInfoEntry(e){return !!e&&typeof e.url==='string'&&/[?&]view=html/.test(e.url)}
function mainSubEntries(){const idx=f=>FORMAT_ORDER.indexOf(f);return (S.subs||[]).filter(e=>!isInfoEntry(e)).slice().sort((a,b)=>(idx(a.format)<0?99:idx(a.format))-(idx(b.format)<0?99:idx(b.format)))}
function subVariantUrl(entry){
if(entry.format==='base64')return entry.url+(entry.url.includes('?')?'&':'?')+'target=base64';
return entry.url}
function subsModeSeg(){
let sh='<div class="seg" role="radiogroup" aria-label="'+esc(t('home.subs.mode.normal'))+'/'+esc(t('home.subs.mode.fragment'))+'">';
SUBS_MODE_IDS.forEach(m=>{sh+='<button type="button" role="radio" aria-checked="'+String(S.subMode===m)+'" data-mode="'+m+'">'+esc(t('home.subs.mode.'+m))+'</button>'});
return sh+'</div>'}
function subsEmptyHtml(){return emptyCard({icon:'i-qr',title:'home.subs.empty_title',msg:'home.subs.empty_msg',cta:'home.subs.empty_cta',href:'#/settings/protocols'})}
function converterStatusHtml(){
const hasConverter=mainSubEntries().some(e=>{const m=FORMAT_LABELS[e.format];return !!(m&&m.via)});
if(!hasConverter)return '';
const api=String(getPath(S.set,'subConverter.api')||'').trim();
if(api.length>0)return '';
return '<p class="field__hint" dir="auto" style="margin-block:12px 0">'+esc(t('subs.main.converter_missing'))+' <a href="#/settings/advanced">'+esc(t('advanced.converter.title'))+'</a></p>'}
function subsMainHtml(){
const rows=mainSubEntries();
let sh='<section class="card"><div class="card__head"><div><div class="card__title">'+esc(t('subs.main.title'))+'</div><div class="field__hint">'+esc(t('subs.main.desc'))+'</div></div>'+subsModeSeg()+'</div>';
if(!rows.length){sh+=subsEmptyHtml();sh+='</section>';return sh}
if(rows.length>1)sh+='<div class="field" style="margin-block:0 8px"><label class="visually-hidden" for="subs-filter">'+esc(t('subs.main.filter'))+'</label><input class="input" type="search" id="subs-filter" placeholder="'+esc(t('subs.main.filter'))+'" autocomplete="off"></div>';
rows.forEach((entry,i)=>{
const meta=FORMAT_LABELS[entry.format]||{key:null,hint:null,ext:null};
const label=meta.key?t(meta.key):entry.format;
const url=subUrlWithMode(entry.url);
sh+='<div class="row" data-subs-entry="'+i+'"><span class="field__label" style="margin:0;flex:none;max-width:40%">'+esc(label)+(meta.via?' <span class="conv-badge">'+esc(t(meta.via))+'</span>':'')+'</span>'+copyFieldHtml(url,'hub-u'+i)+'</div>';
sh+='<details class="warp-acc subs-acc" data-subs-entry="'+i+'"'+(i===0?' open':'')+'><summary>'+esc(t('subs.main.expand'))+'</summary><div style="padding-block:4px 10px">';
if(meta.hint)sh+='<p class="field__hint" style="margin-block:0 8px"><strong>'+esc(t('subs.usedby'))+':</strong> '+esc(t(meta.hint))+'</p>';
sh+='<p class="field__hint" style="margin-block:0 8px">'+esc(t('subs.main.user_agent'))+'</p>';
sh+='<div class="field" style="margin-block:0 10px"><span class="field__label">'+esc(t('subs.main.variant'))+'</span>'+copyFieldHtml(subVariantUrl(entry),'hub-v'+i)+'</div>';
if(meta.ext)sh+='<p style="margin-block:0"><a class="btn btn--ghost btn--sm" href="'+esc(entry.url)+'" download><svg aria-hidden="true"><use href="#i-download"/></svg>'+esc(t('subs.main.download',{ext:meta.ext}))+'</a></p>';
sh+='</div></details>'});
sh+=converterStatusHtml();
sh+='<p class="field__hint" dir="auto" style="margin-block:12px 0">'+esc(t('home.subs.quota'))+'</p>';
sh+='</section>';
return sh}
function subsWarpHtml(){
const n=S.warp&&Array.isArray(S.warp.accounts)?S.warp.accounts.length:null;
let sh='<section class="card"><div class="card__head"><div><div class="card__title">'+esc(t('subs.warp.title'))+'</div><div class="field__hint">'+esc(t('subs.warp.desc'))+'</div></div></div><div class="row" style="border:0"><a class="btn btn--primary btn--sm" href="#/warp">'+esc(t('subs.warp.cta'))+'</a>';
if(n)sh+='<span class="stat-chip"><span class="dot dot-violet"></span>'+esc(t('warp.chips.accounts',{n:n}))+'</span>';;
sh+='</div></section>';
return sh}
function subsUtilsHtml(){
const doh=location.origin+BASE+'doh';
const sp=String((S.set&&S.set.securePath)||'').replace(/^\/+|\/+$/g,'');
const loginUrl=location.origin+(sp?'/'+sp+'/':BASE)+'login';
let sh='<section class="card"><div class="card__head"><div><div class="card__title">'+esc(t('subs.utils.title'))+'</div><div class="field__hint">'+esc(t('subs.utils.desc'))+'</div></div></div>';
sh+='<div class="row"><span class="field__label" style="margin:0;flex:none;max-width:40%">'+esc(t('subs.utils.doh'))+'</span>'+copyFieldHtml(doh,'hub-doh')+'</div>';
sh+='<div class="row"><span class="field__label" style="margin:0;flex:none;max-width:40%">'+esc(t('subs.utils.panel'))+'</span>'+copyFieldHtml(loginUrl,'hub-login')+'</div>';
sh+=subsToolsHtml();
sh+='</section>';
return sh}
function subsToolsHtml(){
let sh='<div class="field" style="margin-block-start:12px"><span class="field__label">'+esc(t('subs.tools.check_title'))+'</span><div class="btn-row"><select class="select" id="tool-check-proto" aria-label="'+esc(t('subs.tools.check_proto'))+'">'
+['socks5','http','https','turn','sstp'].map(p=>'<option value="'+p+'">'+esc(p)+'</option>').join('')+'</select>'
+'<input type="text" class="input input--mono" id="tool-check-param" dir="ltr" placeholder="user:pass@host:port" autocomplete="off" spellcheck="false" style="flex:1;min-width:0" aria-label="'+esc(t('subs.tools.check_param'))+'">'
+'<button type="button" class="btn btn--ghost btn--sm" data-action="proxy-check">'+esc(t('subs.tools.check'))+'</button></div>'
+'<p class="field__hint" id="tool-check-result" role="status" aria-live="polite" style="margin-block:8px 0"></p></div>';
sh+='<details class="warp-acc subs-acc"><summary>'+esc(t('subs.tools.locations'))+'</summary><div style="padding-block:4px 10px">'
+'<p class="field__hint" style="margin-block:0 8px">'+esc(t('subs.tools.locations_desc'))+'</p>'
+'<div class="btn-row"><button type="button" class="btn btn--ghost btn--sm" data-action="locations-load">'+esc(t('subs.tools.locations_load'))+'</button><button type="button" class="btn btn--ghost btn--sm" data-action="locations-map">'+esc(t('subs.tools.locations_map'))+'</button></div>'
+'<div id="tool-locations" style="margin-block-start:8px" aria-live="polite"></div><div id="tool-map" hidden style="block-size:280px;margin-block-start:8px;border-radius:.6rem;overflow:hidden"></div>'
+'</div></details>';
return sh}
function renderLocationsTable(list){
const box=$('tool-locations');if(!box)return;
if(!Array.isArray(list)||!list.length){box.innerHTML=emptyCard({title:'subs.tools.locations_empty'});return}
const rows=list.slice(0,500).map(l=>{
const o=(l&&typeof l==='object'?l:{});
const cell=k=>esc(String(o[k]??'—'));
return '<div class="pool-row"><span class="pool-cell" dir="ltr">'+cell('iata')+'</span><span class="pool-cell">'+cell('city')+'</span><span class="pool-cell">'+cell('country')+'</span></div>'});
box.innerHTML='<div class="warp-group">'+rows.join('')+'</div>'}
function renderLocationsMap(){
const map=$('tool-map');if(!map||typeof L==='undefined')return;
api('api/locations').then(d=>{
const pts=((d&&d.locations)||[]).filter(l=>l&&isFinite(+l.lat)&&isFinite(+l.lon)).slice(0,500);
const m=L.map(map).setView([20,0],2);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:8,attribution:'© OpenStreetMap contributors'}).addTo(m);
pts.forEach(p=>{L.circleMarker([+p.lat,+p.lon],{radius:4}).addTo(m).bindPopup(esc(String(p.city||p.iata||'')))});
map.dataset.done='1';
}).catch(()=>{map.hidden=true;toast(t('subs.tools.map_offline'),'err')})}
function subsWarpQuickHtml(){
if(!S.warp||!Array.isArray(S.warp.accounts)||!S.warp.accounts.length)return '';
let sh='<section class="card"><div class="card__head"><div><div class="card__title">'+esc(t('subs.utils.warp_quick'))+'</div></div><a class="btn btn--ghost btn--sm" href="#/warp">'+esc(t('subs.warp.cta'))+'</a></div>';
S.warp.accounts.slice(0,3).forEach(a=>{
const url=warpSubUrl(a.token,'wireguard-conf');
sh+='<div class="row"><span class="field__label" style="margin:0;flex:none;max-width:40%">'+esc(a.name)+'</span>'+copyFieldHtml(url,'hub-warp-'+a.id.slice(0,6))+'</div>'});
sh+='</section>';
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
return subsMainHtml()+subsPingHtml()+subsImportHtml()+subsWarpHtml()+subsWarpQuickHtml()+subsUtilsHtml()+subsInfoHtml()}
function subsPingHtml(){
return '<section class="card" id="subs-ping"><div class="card__head"><div><div class="card__title">'+esc(t('subs.ping.title'))+'</div><div class="field__hint">'+esc(t('subs.ping.body'))+'</div></div></div></section>'}
let subImportEndpoints=[];
function subsImportHtml(){
let sh='<section class="card"><div class="card__head"><div><div class="card__title">'+esc(t('subs.import.title'))+'</div><div class="field__hint">'+esc(t('subs.import.desc'))+'</div></div></div>';
sh+='<div class="field"><label class="field__label" for="sub-import-text">'+esc(t('subs.import.title'))+'</label><textarea class="input textarea textarea--mono" id="sub-import-text" rows="5" dir="ltr" spellcheck="false" placeholder="'+esc(t('subs.import.placeholder'))+'"></textarea></div>';
sh+='<div class="btn-row"><button type="button" class="btn btn--ghost btn--sm" data-action="subs-import-preview">'+esc(t('subs.import.preview'))+'</button><button type="button" class="btn btn--ghost btn--sm" data-action="subs-preferred-validate">'+esc(t('subs.import.preferred_validate'))+'</button></div>';
sh+='<div id="sub-import-preview" style="margin-block-start:8px"></div></section>';
return sh}
function renderImportPreview(sources){
const box=$('sub-import-preview');if(!box)return;
subImportEndpoints=[];
const seen=new Set();
(sources||[]).forEach(s=>{(s.endpoints||[]).forEach(e=>{const k=String(e).toLowerCase();if(!seen.has(k)){seen.add(k);subImportEndpoints.push(String(e))}})});
let sh='';
if(!subImportEndpoints.length)sh=emptyCard({title:'subs.import.empty'})+sh;
(sources||[]).forEach(s=>{
const tag=t('subs.import.source',{n:(s.index||0)+1});
sh+='<div class="warp-group"><div style="display:flex;align-items:center;gap:8px;margin-block:12px 2px"><span style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-ghost)">'+esc(tag)+'</span><span class="stat-chip" style="padding:.125rem .5rem">'+esc(t('warp.endpoints.count',{n:(s.endpoints||[]).length}))+'</span></div>';
(s.endpoints||[]).forEach(e=>{sh+='<div class="pool-row"><span class="pool-cell" dir="ltr">'+esc(String(e))+'</span></div>'});
(s.invalid||[]).forEach(iv=>{sh+='<div class="pool-row"><span class="pool-cell" dir="ltr">'+esc('line '+iv.line)+'</span><span class="pool-status"><span class="glyph-bad">✗ '+esc(String(iv.reason))+'</span></span></div>'});
sh+='</div>'});
if(subImportEndpoints.length)sh+='<div class="btn-row" style="margin-block-start:8px"><button type="button" class="btn btn--primary btn--sm" data-action="subs-import-confirm">'+esc(t('subs.import.confirm',{n:subImportEndpoints.length}))+'</button></div>';
box.innerHTML=sh}
function renderPreferredPreview(valid,invalid){
const box=$('sub-import-preview');if(!box)return;
let sh='';
if(!valid.length&&!invalid.length)sh=emptyCard({title:'subs.import.empty'});
if(valid.length){
sh+='<div class="warp-group"><div style="display:flex;align-items:center;gap:8px;margin-block:12px 2px"><span style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-ghost)">'+esc(t('subs.import.preferred_title'))+'</span><span class="stat-chip" style="padding:.125rem .5rem">'+esc(t('warp.endpoints.count',{n:valid.length}))+'</span></div>';
valid.forEach(e=>{
let badges='';
if(e.proxyIp)badges+='<span class="proxy-badge">'+esc(t('subs.import.proxyip'))+'</span>';
if(e.kind&&e.kind!=='direct')badges+='<span class="conv-badge">'+esc(e.kind)+'</span>';
sh+='<div class="pool-row"><span class="pool-cell" dir="ltr">'+esc(String(e.raw))+'</span>'+(badges?'<span class="pool-status">'+badges+'</span>':'')+'</div>'});
sh+='</div>'}
(invalid||[]).forEach(iv=>{sh+='<div class="pool-row"><span class="pool-cell" dir="ltr">'+esc('line '+iv.line)+'</span><span class="pool-status"><span class="glyph-bad">✗ '+esc(String(iv.reason))+'</span></span></div>'});
box.innerHTML=sh}
function filterSubsRows(q){
q=String(q||'').trim().toLowerCase();
const rows=mainSubEntries();
rows.forEach((entry,i)=>{
const meta=FORMAT_LABELS[entry.format]||{key:null};
const label=((meta.key?t(meta.key):entry.format)+' '+entry.format).toLowerCase();
const show=label.includes(q);
document.querySelectorAll('#subs-body [data-subs-entry="'+i+'"]').forEach(el=>{el.hidden=!show});
});
}
function renderSubsView(){
const b=$('subs-body');if(!b)return;
b.innerHTML=subsBodyHtml();
const f=$('subs-filter');
if(f)f.addEventListener('input',()=>filterSubsRows(f.value));}
function showSubsView(){
renderSubsView();
if(!S.warp)loadWarpIfNeeded().then(()=>{if(parseRoute().view==='subs')renderSubsView()})}

document.addEventListener('click',function(e){
const chip=e.target&&e.target.closest?e.target.closest('#subs-body [data-mode]'):null;
if(!chip)return;
S.subMode=chip.dataset.mode;storeSet('qp_submode',S.subMode)
syncModeUrl();
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
