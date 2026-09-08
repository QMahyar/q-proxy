let A11Y_SEQ=0;
function nextId(prefix){
A11Y_SEQ+=1;
return 'qa'+A11Y_SEQ+'-'+String(prefix==null?'id':prefix).replace(/[^a-zA-Z0-9_-]/g,'')}
let announceTimer=null;
function announce(msg){
const el=document.getElementById('a11y-live');
if(!el||!msg)return;
el.textContent='';
if(announceTimer)clearTimeout(announceTimer);
announceTimer=setTimeout(()=>{el.textContent=String(msg)},30)}
function radiogroupItems(group){
const pressed=group.getAttribute('data-radiogroup')==='pressed';
return [...group.querySelectorAll(pressed?'[aria-pressed]':'[role="radio"],[aria-checked]')]}
function radiogroupChecked(items){
return items.find(el=>el.getAttribute('aria-checked')==='true'||el.getAttribute('aria-pressed')==='true')}
function syncRadiogroup(group){
const items=radiogroupItems(group).filter(el=>!el.disabled);
if(!items.length)return;
const checked=radiogroupChecked(items);
items.forEach(el=>{el.tabIndex=el===checked?0:-1});
if(!checked)items[0].tabIndex=0}
function wireRadiogroups(root){
(root||document).querySelectorAll('[role="radiogroup"],[data-radiogroup]').forEach(group=>{
if(group.dataset.rgWired)return;
group.dataset.rgWired='1';
syncRadiogroup(group)})}
function radiogroupKeydown(e){
if(e.altKey||e.ctrlKey||e.metaKey)return;
const t=e.target;
if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.isContentEditable))return;
const group=t&&t.closest?t.closest('[role="radiogroup"],[data-radiogroup]'):null;
if(!group)return;
const items=radiogroupItems(group).filter(el=>!el.disabled);
if(!items.length)return;
const cur=t.closest('[role="radio"],[aria-checked],[aria-pressed]');
const idx=cur?items.indexOf(cur):-1;
const rtl=document.documentElement.dir==='rtl';
let next=null;
if((e.key==='ArrowRight'&&!rtl)||(e.key==='ArrowLeft'&&rtl)||e.key==='ArrowDown')next=idx<0?0:(idx+1)%items.length;
else if((e.key==='ArrowLeft'&&!rtl)||(e.key==='ArrowRight'&&rtl)||e.key==='ArrowUp')next=idx<0?items.length-1:(idx-1+items.length)%items.length;
else if(e.key==='Home')next=0;
else if(e.key==='End')next=items.length-1;
if(next==null)return;
e.preventDefault();
const el=items[next];
el.click();
el.focus();
syncRadiogroup(group)}
(function a11yBoot(){
wireRadiogroups(document);
document.addEventListener('keydown',radiogroupKeydown);
if(typeof MutationObserver==='function'){
let timer=null;
const scan=()=>{
if(timer)clearTimeout(timer);
timer=setTimeout(()=>{
wireRadiogroups(document);
document.querySelectorAll('[role="radiogroup"],[data-radiogroup]').forEach(syncRadiogroup)},50)};
new MutationObserver(scan).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-checked','aria-pressed']})}
})();
