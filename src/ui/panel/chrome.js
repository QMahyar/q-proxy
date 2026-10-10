const TRAFFIC_KEY='qp_traffic';
function readTraffic(){const a=storeGetJson(TRAFFIC_KEY,[]);return Array.isArray(a)?a.filter(x=>x&&typeof x.today==='number'):[]}
function recordTraffic(){
if(!S.status||!S.status.usage)return;
const today=S.status.usage.requestsToday||0,total=S.status.usage.requestsTotal||0;
const day=new Date().toISOString().slice(0,10);
let h=readTraffic();
const last=h[h.length-1];
if(last&&last.day===day){last.today=today;last.total=total}
else h.push({day:day,today:today,total:total});
h=h.slice(-30);
storeSet(TRAFFIC_KEY,JSON.stringify(h))}
function renderTraffic(){
const box=$('traffic-chart');if(!box)return;
const h=readTraffic();
if(h.length<2){box.innerHTML='<p class="field__hint">'+esc(t('graph.empty'))+'</p>';return}
const vals=h.map(x=>x.today);
const max=Math.max.apply(null,vals.concat([1]));
const w=560,ht=120,n=vals.length;
const padL=8,padR=8,padT=12,padB=18;
const X=i=>n===1?w/2:padL+i/(n-1)*(w-padL-padR);
const Y=v=>padT+(1-v/max)*(ht-padT-padB);
const pts=vals.map((v,i)=>[X(i),Y(v)]);
const line=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
const area=line+' L'+(w-padR)+' '+(ht-padB)+' L'+padL+' '+(ht-padB)+' Z';
let grid='';
[0.25,0.5,0.75].forEach(f=>{const y=padT+f*(ht-padT-padB);grid+='<line x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(w-padR)+'" y2="'+y.toFixed(1)+'" style="stroke:rgba(148,163,184,.14)" stroke-width="1" stroke-dasharray="3 4"/>'});
let bars='';
vals.forEach((v,i)=>{const x=X(i);const bh=(ht-padB)-Y(v);bars+='<rect x="'+(x-4).toFixed(1)+'" y="'+Y(v).toFixed(1)+'" width="8" height="'+Math.max(bh,2).toFixed(1)+'" rx="2.5" style="fill:rgba(var(--accent-rgb),.30)"/>'});
const dots=pts.map(p=>'<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="2.6" style="fill:var(--cyan)"/>').join('');
box.innerHTML='<div class="field__label-row"><span class="field__label">'+esc(t('graph.title'))+'</span><span class="stat-chip">'+esc(fmtInt(vals[vals.length-1]))+'</span></div><svg viewBox="0 0 '+w+' '+ht+'" role="img" aria-label="'+esc(t('graph.title'))+'" preserveAspectRatio="none"><title>'+esc(t('graph.title'))+'</title><desc>'+esc(t('graph.desc'))+'</desc>'+grid+bars+'<path d="'+area+'" style="fill:rgba(var(--accent-rgb),.12)"/><path d="'+line+'" fill="none" style="stroke:var(--cyan)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'+dots+'</svg>'}
const EXPORT_KEY='qp_last_export',BACKUP_DISMISS='qp_backup_dismiss';
function maybeBackupBanner(){
const box=$('backup-banner');if(!box)return;
let last=0,dis=0;
last=Number(storeGet(EXPORT_KEY)||'0');
dis=Number(storeGet(BACKUP_DISMISS)||'0');
const now=Date.now();
if(last&&now-last<30*864e5){box.hidden=true;return}
if(dis&&now-dis<7*864e5){box.hidden=true;return}
box.hidden=false;
box.innerHTML='<p>'+esc(t('backup.remind'))+'</p><a class="btn btn--primary btn--sm" href="'+esc(BASE)+'api/settings/export" download data-action="backup-export">'+esc(t('general.backup.export'))+'</a><button type="button" class="btn btn--ghost btn--sm" data-action="backup-dismiss">'+esc(t('backup.later'))+'</button>'}
function renderShortcuts(){
$('keys-title').textContent=t('shortcuts.title');
$('keys-close').textContent=t('common.close');
const rows=[['Ctrl / \u2318 + S','shortcuts.save'],['g h','shortcuts.home'],['Ctrl / \u2318 + Z','shortcuts.undo'],['Shift + Ctrl / \u2318 + Z','shortcuts.redo']];
$('keys-body').innerHTML='<table class="tbl"><tbody>'+rows.map(r=>'<tr><td style="white-space:nowrap"><code dir="ltr" class="mono">'+esc(r[0])+'</code></td><td data-l="'+esc(r[0])+'">'+esc(t(r[1]))+'</td></tr>').join('')+'</tbody></table><p class="field__hint" style="margin-block:8px 0">'+esc(t('shortcuts.hint'))+'</p><div class="btn-row" style="margin-block-start:14px"><button type="button" class="btn btn--ghost btn--sm" data-action="wizard-replay" aria-label="'+esc(t('wizard.title'))+'"><svg aria-hidden="true"><use href="#i-refresh"/></svg>'+esc(t('wizard.title'))+'</button></div>'}
let lastG=0;
function isEditable(el){return el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.tagName==='SELECT'||el.isContentEditable)}
function globalKeys(e){
const mod=e.ctrlKey||e.metaKey;
if(mod&&e.key.toLowerCase()==='s'){e.preventDefault();if(S.dirty.size)$('apply-btn').click();return}
if(mod&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)redoSection();else undoSection();return}
if(isEditable(e.target))return;
if(e.key==='g'){lastG=Date.now();return}
if(e.key==='h'&&Date.now()-lastG<800){lastG=0;location.hash='#/home'}}