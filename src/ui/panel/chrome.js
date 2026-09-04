const TRAFFIC_KEY='qp_traffic';
function readTraffic(){try{const a=JSON.parse(localStorage.getItem(TRAFFIC_KEY)||'[]');return Array.isArray(a)?a.filter(x=>x&&typeof x.today==='number'):[]}catch(e){return[]}}
function recordTraffic(){
if(!S.status||!S.status.usage)return;
const today=S.status.usage.requestsToday||0,total=S.status.usage.requestsTotal||0;
const day=new Date().toISOString().slice(0,10);
let h=readTraffic();
const last=h[h.length-1];
if(last&&last.day===day){last.today=today;last.total=total}
else h.push({day:day,today:today,total:total});
h=h.slice(-30);
try{localStorage.setItem(TRAFFIC_KEY,JSON.stringify(h))}catch(e){}}
function renderTraffic(){
const box=$('traffic-chart');if(!box)return;
const h=readTraffic();
if(h.length<2){box.innerHTML='<p class="field__hint">'+esc(t('graph.empty'))+'</p>';return}
const vals=h.map(x=>x.today);
const max=Math.max.apply(null,vals.concat([1]));
const w=300,ht=72,n=vals.length;
const pts=vals.map((v,i)=>[n===1?0:i/(n-1)*(w-8)+4,ht-6-(v/max)*(ht-16)]);
const line=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
const area=line+' L'+(w-4)+' '+(ht-6)+' L4 '+(ht-6)+' Z';
let bars='';
vals.forEach((v,i)=>{const x=n===1?w/2-6:i/(n-1)*(w-12)+2;const bh=(v/max)*(ht-20);bars+='<rect x="'+x.toFixed(1)+'" y="'+(ht-6-bh).toFixed(1)+'" width="5" height="'+bh.toFixed(1)+'" rx="1.5" style="fill:rgba(var(--accent-rgb),.45)"/>'});
box.innerHTML='<div class="field__label-row"><span class="field__label">'+esc(t('graph.title'))+'</span></div><svg viewBox="0 0 '+w+' '+ht+'" role="img" aria-label="'+esc(t('graph.title'))+'">'+bars+'<path d="'+area+'" style="fill:rgba(var(--accent-rgb),.12)"/><path d="'+line+'" fill="none" style="stroke:var(--cyan)" stroke-width="2" stroke-linecap="round"/></svg>'}
const EXPORT_KEY='qp_last_export',BACKUP_DISMISS='qp_backup_dismiss';
function maybeBackupBanner(){
const box=$('backup-banner');if(!box)return;
let last=0,dis=0;
try{last=Number(localStorage.getItem(EXPORT_KEY)||'0')}catch(e){}
try{dis=Number(localStorage.getItem(BACKUP_DISMISS)||'0')}catch(e){}
const now=Date.now();
if(last&&now-last<30*864e5){box.hidden=true;return}
if(dis&&now-dis<7*864e5){box.hidden=true;return}
box.hidden=false;
box.innerHTML='<p>'+esc(t('backup.remind'))+'</p><a class="btn btn--primary btn--sm" href="'+esc(BASE)+'api/settings/export" download data-action="backup-export">'+esc(t('general.backup.export'))+'</a><button type="button" class="btn btn--ghost btn--sm" data-action="backup-dismiss">'+esc(t('backup.later'))+'</button>'}
function renderShortcuts(){
$('keys-title').textContent=t('shortcuts.title');
$('keys-close').textContent=t('common.close');
const rows=[['Ctrl / \u2318 + S','shortcuts.save'],['Ctrl / \u2318 + K','shortcuts.search'],['g h','shortcuts.home'],['Ctrl / \u2318 + Z','shortcuts.undo'],['Shift + Ctrl / \u2318 + Z','shortcuts.redo']];
$('keys-body').innerHTML='<table class="tbl"><tbody>'+rows.map(r=>'<tr><td style="white-space:nowrap"><code dir="ltr" class="mono">'+esc(r[0])+'</code></td><td data-l="'+esc(r[0])+'">'+esc(t(r[1]))+'</td></tr>').join('')+'</tbody></table>'}
const UR={};
function urStack(sec){if(!UR[sec])UR[sec]={undo:[],redo:[]};return UR[sec]}
function pushUndo(sec,state){
const st=urStack(sec);
if(st.undo[st.undo.length-1]===state)return;
st.undo.push(state);if(st.undo.length>20)st.undo.shift();st.redo.length=0}
let dirtyPushTimer=null;
function scheduleDirtyPush(){
clearTimeout(dirtyPushTimer);
dirtyPushTimer=setTimeout(()=>{for(const sec of[...S.dirty]){try{pushUndo(sec,JSON.stringify(collectSection(sec)))}catch(e){}}},1000)}
function restoreSection(sec,json){
let snap={};try{snap=JSON.parse(json)}catch(e){return}
const panel=$('sp-'+sec);if(!panel)return;
panel.querySelectorAll('[data-bind]').forEach(el=>{
writeBind(el,getPath(snap,el.dataset.bind));
clearFieldErrorEl(el)});
markDirty();
refreshShowIf();
updateEchPreview();
updatePortMasters();
applyProtoDim()}
function undoSection(){
const sec=currentSection();const panel=$('sp-'+sec);if(!panel)return;
const st=urStack(sec);if(!st.undo.length)return;
st.redo.push(JSON.stringify(collectSection(sec)));
restoreSection(sec,st.undo.pop())}
function redoSection(){
const sec=currentSection();const panel=$('sp-'+sec);if(!panel)return;
const st=urStack(sec);if(!st.redo.length)return;
st.undo.push(JSON.stringify(collectSection(sec)));
restoreSection(sec,st.redo.pop())}
let lastG=0;
function isEditable(el){return el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.tagName==='SELECT'||el.isContentEditable)}
function globalKeys(e){
const mod=e.ctrlKey||e.metaKey;
if(mod&&e.key.toLowerCase()==='s'){e.preventDefault();if(S.dirty.size)$('apply-btn').click();return}
if(isEditable(e.target))return;
if(mod&&e.key.toLowerCase()==='k'){e.preventDefault();const s=document.querySelector('#settings-search');if(s)s.focus();else location.hash='#/home';return}
if(mod&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)redoSection();else undoSection();return}
if(e.key==='g'){lastG=Date.now();return}
if(e.key==='h'&&Date.now()-lastG<800){lastG=0;location.hash='#/home'}}