function shareFallbackCopy(url){
const ta=document.createElement('textarea');
ta.value=url;ta.setAttribute('readonly','');ta.setAttribute('contenteditable','true');
ta.style.position='fixed';ta.style.opacity='0';
document.body.appendChild(ta);
ta.select();ta.setSelectionRange(0,url.length);
let ok=false;
try{ok=document.execCommand('copy')}catch(e){ok=false}
ta.remove();return ok}
function shareCopy(url){
const done=ok=>toast(t(ok?'common.copied':'share.copy_failed'),ok?'ok':'err');
if(navigator.clipboard&&navigator.clipboard.writeText){
navigator.clipboard.writeText(url).then(()=>done(true),()=>done(shareFallbackCopy(url)))}
else done(shareFallbackCopy(url))}
function shareCopyCurrent(){const inp=$('share-url');if(inp&&inp.value)shareCopy(inp.value)}
function shareNativeShare(){
const inp=$('share-url');
if(!inp||!inp.value||!(navigator.share))return;
navigator.share({title:$('share-title').textContent,url:inp.value}).catch(()=>{})}
function shareSavePng(){
const canvas=$('share-canvas');if(!canvas)return;
const a=document.createElement('a');
a.href=canvas.toDataURL('image/png');
a.download='q-proxy-qr.png';
document.body.appendChild(a);a.click();a.remove()}
function openShareSheet(o){
o=o||{};
const url=String(o.url||'');
if(!url)return;
const inp=$('share-url');
inp.value=url;
$('share-title').textContent=o.title||t('qr.title');
$('share-copy').textContent=t('share.copy');
$('share-close').textContent=t('common.close');
$('share-png').setAttribute('aria-label',t('qr.download'));
$('share-url-label').textContent=t('share.url_label');
const dl=$('share-download');
if(o.fileName){dl.hidden=false;dl.setAttribute('href',url);dl.setAttribute('download',o.fileName)}
else{dl.hidden=true;dl.removeAttribute('href');dl.removeAttribute('download')}
const nat=$('share-native');
nat.hidden=!(navigator.share);
const warn=$('share-warning');
warn.textContent=t('share.warning');
warn.hidden=o.note!=='once';
if(!QR.render($('share-canvas'),url)){toast(t('toast.tooLong'),'err');return}
openModal('m-share');
setTimeout(()=>{inp.focus();inp.select()},0)}
(function(){
const inp=$('share-url');if(!inp)return;
inp.addEventListener('focus',()=>inp.select());
inp.addEventListener('click',()=>inp.select());
$('share-copy').addEventListener('click',shareCopyCurrent);
$('share-native').addEventListener('click',shareNativeShare);
$('share-png').addEventListener('click',shareSavePng);
$('share-close').addEventListener('click',()=>closeModal('m-share'))})();
