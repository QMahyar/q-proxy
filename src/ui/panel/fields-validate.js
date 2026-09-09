function readRemoteCard(c){
const get=(k)=>{const f=c.querySelector('[data-remote-field="'+k+'"]');return f?f.value.trim():''};
const raw=(k)=>{const f=c.querySelector('[data-remote-field="'+k+'"]');return f?f.value:''};
const kindSel=c.querySelector('[data-remote-field="kind"]');
const kind=kindSel?kindSel.value:'reality';
const e={kind:kind,name:get('name'),address:get('address'),sni:get('sni')};
const p=get('port');e.port=p===''?0:Number(p);
if(kind==='hy2'){e.password=raw('password');e.obfs=get('obfs');e.obfsPassword=raw('obfsPassword')}
else{e.uuid=get('uuid');e.pbk=get('pbk');e.sid=get('sid');e.flow=get('flow');e.spx=get('spx');e.fp=get('fp')}
return e}
function readBind(el){
if(el.dataset.type==='addrList'){
const body=el.querySelector('[data-addr-body]');
if(!body)return [];
return [...body.querySelectorAll('.addr-card')].map(c=>{
const get=(k)=>{const f=c.querySelector('[data-addr-field="'+k+'"]');return f?f.value.trim():''};
const e={address:get('address')};
if(e.address.length===0)return null;
const p=get('port');if(p)e.port=Number(p);
const l=get('label');if(l)e.label=l;
const h=get('host');if(h)e.host=h;
const sn=get('sni');if(sn)e.sni=sn;
const co=get('country');if(co)e.country=co;
if(c.dataset.addrEnabled==='0')e.enabled=false;
return e}).filter(Boolean)}
if(el.dataset.type==='remoteList'){
const body=el.querySelector('[data-remote-body]');
if(!body)return [];
return [...body.querySelectorAll('.remote-card')].map(c=>{
const e=readRemoteCard(c);
if(e.address.length===0)return null;
return e}).filter(Boolean)}
if(el.dataset.type==='chips'){
const c=el.querySelector('.chip[aria-checked="true"]');
return c?c.dataset.chip:''}
if(el.tagName==='TEXTAREA')return el.value.split('\n').map(s=>s.trim()).filter(Boolean);
if(el.type==='checkbox')return el.checked;
if(el.tagName==='SELECT')return el.value;
if(el.type==='number'){const n=Number(el.value);return Number.isFinite(n)?n:0}
return el.value.trim()}
function writeBind(el,v){
if(el.dataset.type==='addrList'){
const body=el.querySelector('[data-addr-body]');
if(body){body.innerHTML=Array.isArray(v)?v.map(addrCardHtml).join(''):''}
const empty=el.querySelector('.addr-empty');
if(empty)empty.style.display=Array.isArray(v)&&v.length?'none':'';
return}
if(el.dataset.type==='remoteList'){
const body=el.querySelector('[data-remote-body]');
if(body){body.innerHTML=Array.isArray(v)?v.map(remoteNodeCardHtml).join(''):''}
const rempty=el.querySelector('.remote-empty');
if(rempty)rempty.style.display=Array.isArray(v)&&v.length?'none':'';
return}
if(el.dataset.type==='chips'){
el.querySelectorAll('.chip').forEach(c=>c.setAttribute('aria-checked',String(c.dataset.chip===v)));
return}
if(el.tagName==='TEXTAREA'){el.value=lines(v).join('\n');return}
if(el.type==='checkbox'){el.checked=!!v;return}
if(el.tagName==='SELECT'){el.value=String(v);return}
el.value=v==null?'':Array.isArray(v)?lines(v).join('\n'):String(v);
if(el.tagName==='INPUT')updateCharCount(el)}
const RE_DOMAIN=/^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const RE_IPV4=/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const RE_HOST=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const RE_V6PREFIX=/^[0-9A-Fa-f:\[\]\/]{2,50}$/i;
function validIpOrHost(line){
const s=line.replace(/^\[|\]$/g,'');
if(RE_IPV4.test(s))return true;
if(RE_V6PREFIX.test(s)&&s.includes(':'))return true;
return RE_HOST.test(s)}
function validateLine(kind,line){
if(!line)return false;
switch(kind){
case 'domain':return RE_DOMAIN.test(line);
case 'url':return /^https:\/\/\S+$/.test(line);
case 'ipv6_prefix':return RE_V6PREFIX.test(line)&&line.includes(':');
case 'ip_or_host':return validIpOrHost(line);
case 'host_port':return validIpOrHost(stripPort(line));
default:return true}}
let leTimer=null;
function validateLineEditors(scope){
clearTimeout(leTimer);
leTimer=setTimeout(()=>{
(scope||document).querySelectorAll('textarea[data-validate]').forEach(validateOneEditor)},250)}
function validateOneEditor(ta){
const kind=ta.dataset.validate;
const wrap=ta.closest('.line-editor');
const allLines=ta.value.split('\n').map(l=>l.trim()).filter(l=>l.length>0);
const seen=new Set(),bad=[],dups=[];
allLines.forEach(l=>{
if(!validateLine(kind,l)){bad.push(l);return}
if(seen.has(l.toLowerCase()))dups.push(l);
seen.add(l.toLowerCase())});
if(wrap){
const cnt=wrap.querySelector('.cnt'),badEl=wrap.querySelector('.bad');
if(cnt)cnt.textContent=allLines.length;
if(badEl)badEl.textContent=[...bad.slice(0,2).map(l=>t('err.invalid_line',{line:l})),...(dups.length?[t('err.duplicate',{value:dups[0]})]:[])].join(' · ');
ta.setAttribute('aria-invalid',bad.length?'true':'false')}}
function validateAllLineEditors(){validateLineEditors(document)}
const RE_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCALAR_RULES={};
SECTIONS.forEach(s=>s.cards.forEach(c=>c.fields.forEach(f=>{
const ps=Array.isArray(f.path)?f.path:[f.path];
ps.forEach(p=>{
if(f.type==='num'&&typeof f.min==='number')SCALAR_RULES[p]={kind:'num',min:f.min,max:f.max};
else if(f.type==='secret'&&f.gen==='uuid')SCALAR_RULES[p]={kind:'uuid'};
else if(f.vtype==='domain')SCALAR_RULES[p]={kind:'domain'}})})));
function scalarError(el){
const rule=SCALAR_RULES[el.dataset.bind];
if(!rule)return null;
const raw=String(el.value==null?'':el.value).trim();
if(rule.kind==='uuid')return raw===''||RE_UUID.test(raw)?null:'err.uuid';
if(rule.kind==='domain')return raw===''||RE_HOST.test(raw)?null:'err.domain';
if(rule.kind==='num'){
if(raw==='')return 'err.number';
const n=Number(raw);
return Number.isInteger(n)&&n>=rule.min&&n<=rule.max?null:'err.number'}
return null}
function blurValidateEl(el){
const msg=scalarError(el);
if(!msg){
const fw=fieldWrapOf(el);
if(fw&&fw.classList.contains('field--error')){fw.classList.remove('field--error');el.removeAttribute('aria-invalid')}
return}
showFieldError(el.dataset.bind,t(msg))}
function updateCharCount(inp){
const fw=fieldWrapOf(inp);
if(!fw)return;
const cc=fw.querySelector('.char-count');
if(!cc)return;
const max=Number(cc.dataset.max)||0;
if(!max)return;
const n=inp.value.length;
cc.textContent=n+'/'+max;
cc.classList.toggle('warn',n>=max*0.9)}
function randomPass(){
const cs='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const a=new Uint8Array(24);crypto.getRandomValues(a);
let s='';a.forEach(b=>{s+=cs[b%cs.length]});
return s}
function stripPort(s){
const m=s.match(/^(.+):(\d+)$/);
return m?m[1]:s}
function genFor(kind){
if(kind==='uuid')return crypto.randomUUID();
return randomPass()}
