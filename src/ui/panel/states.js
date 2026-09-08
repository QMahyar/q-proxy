function emptyCard(o){
o=o||{};
const icon=o.icon?'<div class="empty-icon"><svg aria-hidden="true"><use href="#'+esc(o.icon)+'"/></svg></div>':'';
const title=o.title?'<div class="empty-title">'+esc(t(o.title))+'</div>':'';
const msg=o.msg?'<p class="empty-msg">'+esc(t(o.msg))+'</p>':'';
let cta='';
if(o.cta){
const lbl=esc(t(o.cta));
cta='<div class="empty-actions">'+(o.href?'<a class="btn btn--primary btn--sm" href="'+esc(o.href)+'">'+lbl+'</a>':'<button type="button" class="btn btn--primary btn--sm" '+(o.attrs||'')+'>'+lbl+'</button>')+(o.extraActions||'')+'</div>'}
return '<div class="empty-card"'+(o.style?' style="'+esc(o.style)+'"':'')+'>'+icon+title+msg+cta+'</div>'}
function loadingBox(o){
o=o||{};
const n=Math.max(1,Math.min(6,o.rows||3));
let bars='';
for(let i=0;i<n;i++)bars+='<div class="skeleton skel-bar"></div>';
const label=o.label?'<span class="field__hint">'+esc(t(o.label))+'</span>':'';
return '<div class="loading-box" role="status">'+bars+label+'</div>'}
function errorCard(o){
o=o||{};
const retry=o.retryAction?'<div class="empty-actions"><button type="button" class="btn btn--primary btn--sm" '+o.retryAction+'><svg aria-hidden="true"><use href="#i-refresh"/></svg>'+esc(o.retryLabel?t(o.retryLabel):t('common.retry'))+'</button></div>':'';
return '<div class="empty-card empty-card--error" role="alert"><div class="empty-icon empty-icon--error"><svg aria-hidden="true"><use href="#'+esc(o.icon||'i-x')+'"/></svg></div><div class="empty-title">'+esc(t(o.title||'common.error'))+'</div>'+(o.msg?'<p class="empty-msg">'+esc(t(o.msg))+'</p>':'')+retry+'</div>'}
