function collectSection(sec){
const panel=$('sp-'+sec);
const out={};
if(!panel)return out;
panel.querySelectorAll('[data-bind]').forEach(el=>{
setPath(out,el.dataset.bind,readBind(el))});
return out}
function diffSection(sec){
const cur=collectSection(sec);
let snap={};
try{snap=JSON.parse(S.snap[sec]||'{}')}catch(e){}
const lc=leaves(cur,'',{}),ls=leaves(snap,'',{});
const patch={};
for(const p in lc)if(JSON.stringify(lc[p])!==JSON.stringify(ls[p]))setPath(patch,p,lc[p]);
return{cur,patch}}
function sectionOf(src){
const panel=src&&src.closest?src.closest('[id^="sp-"]'):null;
if(!panel)return null;
const key=panel.id.slice(3);
return SECTIONS.some(s=>s.key===key)?key:null}
function sectionMatchesSnapshot(sec){
try{return JSON.stringify(collectSection(sec))===S.snap[sec]}catch(e){return false}}
function markDirty(source){
const sec=typeof source==='string'?source:sectionOf(source);
if(sec){
if(sectionMatchesSnapshot(sec))S.dirty.delete(sec);
else S.dirty.add(sec)}
else{
S.dirty.clear();
SECTIONS.forEach(s=>{
try{if(JSON.stringify(collectSection(s.key))!==S.snap[s.key])S.dirty.add(s.key)}catch(e){}})}
scheduleDirtyPush();
updateApplyBar()}
function updateApplyBar(){
const ab=$('apply-btn');
$('applybar').hidden=S.dirty.size===0;
if(!ab||ab.dataset.busy==='1'){}
else{ab.disabled=false;ab.textContent=t('common.apply')}
const st=urStack(currentSection());
const ub=$('ur-undo'),rb=$('ur-redo');
if(ub)ub.disabled=!st.undo.length;
if(rb)rb.disabled=!st.redo.length;
document.querySelectorAll('.section-actions__hint').forEach(hint=>{hint.hidden=!S.dirty.has(hint.closest('[id^="sp-"]').id.replace('sp-',''))});
document.querySelectorAll('#subtabs .subtab').forEach(a=>{const base=a.dataset.label||a.textContent.replace(/ \*$/,'');a.dataset.label=base;a.textContent=base+(S.dirty.has(a.dataset.sec)?' *':'')})}
function wireApplyBarUr(){
const bar=$('applybar');
if(!bar||bar.querySelector('#ur-undo'))return;
const mk=(id,labelKey,shift)=>{
const b=document.createElement('button');
b.type='button';b.id=id;b.className='btn btn--ghost btn--sm';
b.textContent=t(labelKey);b.setAttribute('aria-label',t(labelKey));
b.addEventListener('click',()=>{if(shift)redoSection();else undoSection()});
return b};
const inner=bar.querySelector('.applybar__inner');
const ref=$('discard-btn');
const u=mk('ur-undo','shortcuts.undo',false),r=mk('ur-redo','shortcuts.redo',true);
if(ref){inner.insertBefore(u,ref);inner.insertBefore(r,ref)}
else inner.append(u,r);
updateApplyBar()}
async function refreshSubUrls(){
try{sessionStorage.removeItem('qpe:api/bootstrap');sessionStorage.removeItem('qpc:api/bootstrap')}catch(e){}
try{const d=await api('api/bootstrap',{fresh:true});S.subs=(d.subUrls&&d.subUrls.urls)||[];renderHome()}catch(e){}}
async function applySection(sec){
clearFieldErrors(sec);
try{
const{cur,patch}=diffSection(sec);
if(Object.keys(patch).length===0){markDirty(sec);return}
await api('api/settings/save',{method:'PUT',body:patch});
Object.assign(S.set,JSON.parse(JSON.stringify(cur)));
pushUndo(sec,S.snap[sec]||'{}');
S.snap[sec]=JSON.stringify(cur);
markDirty(sec);
 toast(t('toast.settingsSaved'),'ok');
  if(sec==='general'||sec==='addresses')await refreshSubUrls()}
catch(e){
if(e&&e.fields&&Object.keys(e.fields).length){
let n=0;
for(const path in e.fields){
showFieldError(path,e.fields[path]);
n++}
toast(t('common.fixErrors',{count:n}),'err')}
else toastErr(e)}
finally{updateApplyBar()}}
function discardSection(sec){
let snap={};
try{snap=JSON.parse(S.snap[sec]||'{}')}catch(e){}
const panel=$('sp-'+sec);
if(panel)panel.querySelectorAll('[data-bind]').forEach(el=>{
writeBind(el,getPath(snap,el.dataset.bind));
clearFieldErrorEl(el)});
markDirty(sec);
refreshShowIf();
updateEchPreview();
applyProtoDim()}
function fieldWrapOf(bindEl){
return bindEl.closest('.field')}
function showFieldError(path,msg){
document.querySelectorAll('#settings-panels [data-bind="'+CSS.escape(path)+'"]').forEach(el=>{
const fw=fieldWrapOf(el);
if(!fw)return;
fw.classList.add('field--error');
const err=fw.querySelector('.field__error');
if(err)err.textContent=/\s/.test(msg)||!DICT[LANG][msg]&&!DICT.en[msg]?msg:t(msg);
el.setAttribute('aria-invalid','true');
const errId='err-'+(++UID);
err.id=errId;
el.setAttribute('aria-describedby',errId);
announce(err.textContent)})}
function clearFieldErrors(sec){
const panel=$('sp-'+sec);
if(!panel)return;
panel.querySelectorAll('.field--error').forEach(fw=>{
fw.classList.remove('field--error');
fw.querySelectorAll('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'))})}
function clearFieldErrorEl(el){
const fw=fieldWrapOf(el);
if(fw)fw.classList.remove('field--error')}
const UR={};
function urStack(sec){if(!UR[sec])UR[sec]={undo:[],redo:[]};return UR[sec]}
function pushUndo(sec,state){
const st=urStack(sec);
if(st.undo[st.undo.length-1]===state)return;
st.undo.push(state);if(st.undo.length>20)st.undo.shift();st.redo.length=0}
let urBase=null;
function captureUndoBase(el){
const panel=el&&el.closest?el.closest('[id^="sp-"]'):null;
if(!panel)return;
const sec=panel.id.slice(3);
if(!SECTIONS.some(s=>s.key===sec))return;
if(urBase&&urBase.sec===sec)return;
try{urBase={sec:sec,json:JSON.stringify(collectSection(sec))}}catch(e){}}
function clearUndoBase(){urBase=null}
function scheduleDirtyPush(){
if(!urBase)return;
pushUndo(urBase.sec,urBase.json);
urBase=null}
function restoreSection(sec,json){
clearUndoBase();
let snap={};try{snap=JSON.parse(json)}catch(e){return}
const panel=$('sp-'+sec);if(!panel)return;
panel.querySelectorAll('[data-bind]').forEach(el=>{
writeBind(el,getPath(snap,el.dataset.bind));
clearFieldErrorEl(el)});
markDirty(sec);
refreshShowIf();
updateEchPreview();
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
