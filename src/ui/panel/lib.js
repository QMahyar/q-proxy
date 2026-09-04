const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BASE=location.pathname.replace(/panel\/?$/,'');
const TOAST_MS=3500,TOAST_ERR_MS=10000,PROBE_TIMEOUT=5000,PROBE_TRIES=3,MAX_TARGETS=100;
function setLangCookie(l){document.cookie='qp_lang='+l+'; Path=/; Max-Age=31536000; SameSite=Lax'}
function toast(msg,kind){const box=$('toasts');const el=document.createElement('div');el.className='toast'+(kind==='err'?' toast--err':'');if(kind==='err')el.setAttribute('role','alert');
el.innerHTML='<svg class="ticon" aria-hidden="true"><use href="#'+(kind==='err'?'i-x':'i-check')+'"/></svg><span class="toast__msg"></span><button type="button" class="toast__close" aria-label="'+esc(t('common.close'))+'"><svg aria-hidden="true"><use href="#i-x"/></svg></button><i class="toast-bar"></i>';
el.querySelector('.toast__msg').textContent=msg;
box.appendChild(el);while(box.children.length>3)box.firstChild.remove();
const total=kind==='err'?TOAST_ERR_MS:TOAST_MS;const bar=el.querySelector('.toast-bar');
if(total>0){bar.style.animationDuration=total+'ms'}
let removed=false,timer=null,start=Date.now(),left=total;
function removeToast(){if(removed)return;removed=true;clearTimeout(timer);el.classList.add('toast--out');setTimeout(()=>el.remove(),220)}
timer=setTimeout(removeToast,total);
el.addEventListener('mouseenter',()=>{clearTimeout(timer);left-=Date.now()-start;if(bar)bar.style.animationPlayState='paused'});
el.addEventListener('mouseleave',()=>{start=Date.now();timer=setTimeout(removeToast,Math.max(600,left));if(bar)bar.style.animationPlayState='running'});
el.querySelector('.toast__close').addEventListener('click',removeToast)}
const API_TTL=30000;const apiInflight=new Map();
async function api(p,o={}){
const isGet=(!o.method||o.method==='GET')&&!o.fresh;
if(isGet){const inf=apiInflight.get(p);if(inf)return inf;
try{const c=JSON.parse(sessionStorage.getItem('qpc:'+p)||'null');if(c&&Date.now()-c.t<API_TTL)return c.d}catch(e){}}
const prom=(async()=>{
let r;const h=o.body!==undefined?{'Content-Type':'application/json','X-Q-Panel':'1'}:(o.mutate?{'X-Q-Panel':'1'}:{});
if((!o.method||o.method==='GET')){const et=sessionStorage.getItem('qpe:'+p);if(et)h['If-None-Match']=et}
try{r=await fetch(BASE+p,{credentials:'same-origin',method:o.method||'GET',headers:Object.assign(h,o.headers||{}),body:o.body!==undefined?JSON.stringify(o.body):undefined,signal:o.signal})}catch(e){if(e&&e.name==='AbortError')throw e;throw{status:0,code:'',message:''}}
if(r.status===401&&!o.keep401){if(S.dirty&&S.dirty.size>0&&!confirm(t('common.unsaved')))throw{status:401,code:'',message:''};location.replace(BASE+'login');throw{status:401,code:'',message:''}}
if(r.status===304){try{const c=JSON.parse(sessionStorage.getItem('qpc:'+p)||'null');if(c){c.t=Date.now();sessionStorage.setItem('qpc:'+p,JSON.stringify(c));return c.d}}catch(e){}
return api(p,Object.assign({},o,{fresh:true}))}
let j=null;try{j=await r.json()}catch(e){}
if(r.status===403&&j&&j.error&&j.error.code==='PASSWORD_CHANGE_REQUIRED'&&!o.keep401){showForceChange();throw{status:403,code:'PASSWORD_CHANGE_REQUIRED',message:'',handled:true}}
if(!r.ok||!j||j.ok!==true)throw{status:r.status,code:j&&j.error?j.error.code:'',message:j&&j.error?j.error.message:'',fields:j&&j.fields||null,retryAfter:Number(r.headers.get('Retry-After'))||0};
if(!o.method||o.method==='GET'){const et=r.headers.get('ETag');if(et)sessionStorage.setItem('qpe:'+p,et);try{sessionStorage.setItem('qpc:'+p,JSON.stringify({t:Date.now(),d:j.data}))}catch(e){}}
return j.data})();
if(isGet){apiInflight.set(p,prom);const fin=(d)=>{apiInflight.delete(p);return d};prom.then(fin,fin)}
return prom}
function copyText(s){if(navigator.clipboard&&navigator.clipboard.writeText)return navigator.clipboard.writeText(s).catch(()=>fallbackCopy(s));return Promise.resolve(fallbackCopy(s))}
function fallbackCopy(s){const ta=document.createElement('textarea');ta.value=s;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy')}catch(e){}ta.remove()}
const toastErrDirect=toastErr;
toastErr=function(e){if(e&&e.handled)return;toastErrDirect(e)}

let modalReturnFocus=null;
function openModal(id){modalReturnFocus=document.activeElement;const m=$(id);m.hidden=false;const f=m.querySelector('button,input,[href],[tabindex]');if(f)f.focus()}
function closeModal(id){const m=$(id);m.hidden=true;if(modalReturnFocus&&modalReturnFocus.focus)modalReturnFocus.focus();modalReturnFocus=null}
function trapFocus(modal,e){const list=[...modal.querySelectorAll('button,input,[href],[tabindex]:not([tabindex="-1"])')].filter(x=>!x.disabled&&x.offsetParent!==null);if(!list.length)return;const first=list[0],last=list[list.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}
let confirmResolve=null;
function confirmDialog(titleKey,bodyKey,danger,params){$('cf-title').textContent=t(titleKey,params);$('cf-body').textContent=t(bodyKey,params);$('cf-cancel').textContent=t('common.cancel');const ok=$('cf-ok');ok.textContent=t('confirm.yes');ok.className='btn '+(danger?'btn--ghost-danger':'btn--primary');openModal('m-confirm');setTimeout(()=>$('cf-cancel').focus(),0);return new Promise(res=>{confirmResolve=res})}
function settleConfirm(v){if(confirmResolve){const r=confirmResolve;confirmResolve=null;$('m-confirm').hidden=true;if(modalReturnFocus&&modalReturnFocus.focus)modalReturnFocus.focus();modalReturnFocus=null;r(v)}}