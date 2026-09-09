function renderSettings(){
buildSubtabs();
const wrap=$('settings-panels');
wrap.innerHTML='';
SECTIONS.forEach(s=>{
const p=document.createElement('div');
p.id='sp-'+s.key;p.role='tabpanel';p.setAttribute('aria-labelledby','st-'+s.key);
p.hidden=true;
let h='';
if(s.key==='protocols'){
const protoCards=s.cards.slice(0,4);
const commonCards=s.cards.slice(4);
h+='<div class="grid2">';protoCards.forEach(c=>{h+=cardHtml(c)});h+='</div>';
commonCards.forEach(c=>{h+=cardHtml(c)});
 } else {
 s.cards.forEach(c=>{h+=cardHtml(c)});
 }
  h='<div class="section-actions"><button type="button" class="btn btn--primary btn--sm" data-action="section-save" data-sec="'+s.key+'">'+esc(t('common.save'))+'</button><span class="section-actions__hint" data-dirty-hint hidden>'+esc(t('common.unsaved'))+'</span></div>'+h;
  p.innerHTML=h;
 wrap.appendChild(p)});
applyFragmentPresetUi(String(getPath(S.set,'fragment.mode')||'off'));
SECTIONS.forEach(s=>{S.snap[s.key]=JSON.stringify(collectSection(s.key))});
S.dirty.clear();
updateApplyBar();
applyProtoDim();
syncKillUI();
refreshShowIf();
updateEchPreview();
validateAllLineEditors();
document.querySelectorAll('#settings-panels .char-count').forEach(cc=>{const inp=$(cc.dataset.countFor);if(inp)updateCharCount(inp)})}
function applyProtoDim(){
document.querySelectorAll('[data-proto-card]').forEach(card=>{
const key=card.dataset.protoCard;
const on=getPath(S.set,key)!==false;
card.classList.toggle('card--dim',!on);
card.querySelectorAll('[data-bind]').forEach(el=>{
if(el.closest('.row'))return;
el.disabled=!on})})}
function applyFragmentPresetUi(mode){
const panel=$('sp-tunnel');
if(!panel)return;
['lengthMin','lengthMax','delayMin','delayMax'].forEach((k,idx)=>{
const el=panel.querySelector('[data-bind="fragment.'+k+'"]');
if(!el)return;
if(PRESETS[mode]){el.value=String(PRESETS[mode][idx]);el.disabled=true}
else el.disabled=false});
panel.querySelectorAll('[data-bind^="fragment."]').forEach(el=>{
if(el.tagName==='SELECT')el.disabled=mode==='off'})}
function refreshShowIf(){
SECTIONS.forEach(s=>s.cards.forEach(c=>c.fields.forEach(f=>{
if(!f.showIf)return;
const paths=Array.isArray(f.path)?f.path:[f.path];
const el=$('sp-'+s.key).querySelector('[data-fpath="'+paths[0]+'"]');
if(el)el.hidden=!f.showIf(collectSection(s.key))})))}
function updateEchPreview(){
document.querySelectorAll('[data-ech-preview]').forEach(el=>{
const panel=el.closest('[id^="sp-"]');
const auto=panel?panel.querySelector('[data-bind="echAuto"]'):null;
const manual=panel?panel.querySelector('[data-bind="echServerName"]'):null;
const name=manual?String(manual.value||'').trim():'';
if(name.length>0)el.textContent=t('protocols.ech.preview_manual',{name:name});
else if(auto&&auto.checked)el.textContent=t('protocols.ech.preview_auto',{name:location.hostname||'worker'});
else el.textContent=t('protocols.ech.preview_off')})}
