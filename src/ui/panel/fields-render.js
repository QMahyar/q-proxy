function helpTrigger(key){
return '<span class="help-wrap"><button type="button" class="help-trigger" aria-label="'+esc(t('common.help'))+'"><svg aria-hidden="true"><use href="#i-info"/></svg></button><span class="help-pop" role="tooltip">'+esc(t(key))+'</span></span>'}
function fieldWrap(id,label,hint,helpKey,countMax){
let lbl='';
if(label){
lbl='<div class="field__label-row"><label class="field__label" for="'+id+'">'+esc(t(label))+'</label>'+(helpKey?helpTrigger(helpKey):'')+(countMax?'<span class="char-count" data-count-for="'+id+'" data-max="'+countMax+'" aria-hidden="true"></span>':'')+'</div>'}
return '<div class="field" id="fw-'+id+'">'+lbl+'{B}'+(hint?'<p class="field__hint">'+esc(t(hint))+'</p>':'')+'<p class="field__error"></p></div>'}

function lines(v){return Array.isArray(v)?v.map(x=>String(x)).filter(x=>x.trim().length>0):[]}
 function addrCardHtml(a,i){
   const host=location.hostname;
   const isHost=a&&a.address&&String(a.address).trim().toLowerCase()===host.toLowerCase();
   const enabled=!(a&&a.enabled===false);
   const get=(k)=>a&&a[k]!=null?String(a[k]):'';
   const field=(k,label,ph)=>{const dir=(k==='address'||k==='port')?'ltr':'auto';const fid=nextId('addr'+i+'-'+k);return '<div class="addr-card__field"><label for="'+fid+'">'+esc(label)+'</label><input class="input input--mono" id="'+fid+'" type="text" data-addr-field="'+k+'" value="'+esc(get(k))+'" placeholder="'+esc(ph)+'" spellcheck="false" dir="'+dir+'"></div>'};
   const port=get('port');
   const inlinePort=(String(a&&a.address||'').match(/:(\d+)\s*$/i)||[])[1];
   const preview=port||inlinePort||String(S.set.defaultPort||443);
   return '<div class="addr-card'+(enabled?'':' addr-card--off')+'" data-addr-index="'+i+'" data-addr-enabled="'+(enabled?'1':'0')+'">'
     +'<div class="addr-card__main">'
     +field('address',t('addresses.field.address'),'1.2.3.4 / asdasd.workers.dev')
     +field('port',t('addresses.field.port'),'443')
     +field('label',t('addresses.field.label'),'US-Blue')
     +field('host',t('addresses.field.host'),'cdn.example.net')
     +field('sni',t('addresses.field.sni'),'cdn.example.net')
     +field('country',t('addresses.field.country'),'DE')
     +'</div>'
     +'<div class="addr-card__side"><span class="addr-dot" data-addr-dot="'+esc(String(get('address')).replace(/^\[|\]$/g,'').toLowerCase())+'" hidden></span>'
     +(isHost?'<span class="addr-badge">'+esc(t('addresses.hostname_badge'))+'</span>':'')
     +'<label class="switch addr-switch" title="'+esc(t('addresses.enabled.toggle'))+'"><input type="checkbox" data-addr-enabled-input aria-label="'+esc(t('addresses.enabled.toggle'))+'"'+(enabled?' checked':'')+'><span class="switch__track"><span class="switch__thumb"></span></span></label>'
     +'<span class="addr-preview">'+esc(t('addresses.port_preview'))+' '+esc(preview)+'</span>'
     +'<button type="button" class="btn btn--icon btn--sm btn--ghost-danger" data-action="addr-del" data-index="'+i+'" aria-label="'+esc(t('common.remove'))+'"><svg aria-hidden="true"><use href="#i-x"/></svg></button></div></div>';
 }
function remoteNodeCardHtml(r,i){
const kind=r&&r.kind==='hy2'?'hy2':'reality';
const get=(k)=>r&&r[k]!=null?String(r[k]):'';
const field=(k,label,ph,tp)=>{const fid=nextId('rmt'+i+'-'+k);return '<div class="addr-card__field"><label for="'+fid+'">'+esc(label)+'</label><input class="input input--mono" id="'+fid+'" type="'+(tp||'text')+'" data-remote-field="'+k+'" value="'+esc(get(k))+'" placeholder="'+esc(ph)+'" spellcheck="false" dir="ltr"></div>'};
let h='<div class="addr-card remote-card" data-remote-index="'+i+'"><div class="addr-card__main">';
const kindId=nextId('rmt'+i+'-kind');h+='<div class="addr-card__field"><label for="'+kindId+'">'+esc(t('remote.nodes.kind'))+'</label><select class="select" id="'+kindId+'" data-remote-field="kind"><option value="reality"'+(kind==='reality'?' selected':'')+'>'+esc(t('remote.nodes.kind.reality'))+'</option><option value="hy2"'+(kind==='hy2'?' selected':'')+'>'+esc(t('remote.nodes.kind.hy2'))+'</option></select></div>';
h+=field('name',t('remote.nodes.name'),'VPS-1');
h+=field('address',t('remote.nodes.address'),'203.0.113.10');
h+=field('port',t('remote.nodes.port'),'443','number');
if(kind==='reality'){
h+=field('uuid',t('remote.nodes.uuid'),'d342d11e-…');
h+=field('sni',t('remote.nodes.sni'),'www.microsoft.com');
h+=field('pbk',t('remote.nodes.pbk'),'jNXH…');
h+=field('sid',t('remote.nodes.sid'),'6ba85179');
const flowId=nextId('rmt'+i+'-flow');h+='<div class="addr-card__field"><label for="'+flowId+'">'+esc(t('remote.nodes.flow'))+'</label><select class="select" id="'+flowId+'" data-remote-field="flow"><option value=""'+(get('flow')===''?' selected':'')+'>'+esc(t('protocols.flow.off'))+'</option><option value="xtls-rprx-vision"'+(get('flow')==='xtls-rprx-vision'?' selected':'')+'>'+esc(t('protocols.flow.vision'))+'</option></select></div>';
h+=field('spx',t('remote.nodes.spx'),'/');
const fpId=nextId('rmt'+i+'-fp');h+='<div class="addr-card__field"><label for="'+fpId+'">'+esc(t('remote.nodes.fp'))+'</label><select class="select" id="'+fpId+'" data-remote-field="fp">'+FPS.map(f=>'<option value="'+esc(f)+'"'+(get('fp')===f?' selected':'')+'>'+esc(f)+'</option>').join('')+'</select></div>';
}else{
h+=field('sni',t('remote.nodes.sni'),'example.com');
const pwId=nextId('rmt'+i+'-password');h+='<div class="addr-card__field"><label for="'+pwId+'">'+esc(t('remote.nodes.password'))+'</label><input class="input input--mono" id="'+pwId+'" type="password" data-remote-field="password" value="'+esc(get('password'))+'" autocomplete="off" spellcheck="false" dir="ltr"></div>';
const obId=nextId('rmt'+i+'-obfs');h+='<div class="addr-card__field"><label for="'+obId+'">'+esc(t('remote.nodes.obfs'))+'</label><select class="select" id="'+obId+'" data-remote-field="obfs"><option value=""'+(get('obfs')===''?' selected':'')+'>'+esc(t('remote.nodes.obfs.none'))+'</option><option value="salamander"'+(get('obfs')==='salamander'?' selected':'')+'>salamander</option></select></div>';
const opId=nextId('rmt'+i+'-obfsPassword');h+='<div class="addr-card__field"><label for="'+opId+'">'+esc(t('remote.nodes.obfsPassword'))+'</label><input class="input input--mono" id="'+opId+'" type="password" data-remote-field="obfsPassword" value="'+esc(get('obfsPassword'))+'" autocomplete="off" spellcheck="false" dir="ltr"></div>';
}
h+='</div><div class="addr-card__side"><button type="button" class="btn btn--icon btn--sm btn--ghost-danger" data-action="remote-del" aria-label="'+esc(t('common.remove'))+'"><svg aria-hidden="true"><use href="#i-x"/></svg></button></div></div>';
return h}
function bindHtml(f){
const paths=Array.isArray(f.path)?f.path:[f.path];
const id='f'+(++UID);
switch(f.type){
case 'str':{
const val=String(getPath(S.set,paths[0])??'');
const extra=f.preview==='ech'?'<p class="field__hint" data-ech-preview dir="auto"></p>':'';
return fieldWrap(id,f.label,f.hint,f.help,f.maxLen||0).replace('{B}','<input type="text" class="input'+(f.mono?' input--mono':'')+'" id="'+id+'" data-bind="'+paths[0]+'" autocomplete="off" spellcheck="false" dir="'+(f.mono?'ltr':'auto')+'" value="'+esc(val)+'">'+extra)}
case 'num':{
const val=getPath(S.set,paths[0]);
return fieldWrap(id,f.label,f.hint,f.help).replace('{B}','<input type="number" step="1" class="input" id="'+id+'" data-bind="'+paths[0]+'" value="'+esc(val==null?'':String(val))+'">')}
case 'secret':{
const val=String(getPath(S.set,paths[0])??'');
let h='<div class="secret-field"><input type="password" class="input input--mono" style="flex:1;min-width:0" id="'+id+'" data-bind="'+paths[0]+'" autocomplete="off" spellcheck="false" dir="ltr" aria-label="'+esc(t(f.label))+'" value="'+esc(val)+'">';
h+='<button type="button" class="btn btn--icon btn--ghost" data-action="reveal" data-target="'+id+'" aria-label="'+esc(t('common.reveal'))+'" aria-pressed="false"><svg aria-hidden="true"><use href="#i-eye"/></svg></button>';
if(f.copy)h+='<button type="button" class="btn btn--icon btn--ghost" data-action="copy" data-copy-id="'+id+'" aria-label="'+esc(t('common.copy'))+'"><svg aria-hidden="true"><use href="#i-copy"/></svg></button>';
if(f.gen)h+='<button type="button" class="btn btn--icon btn--ghost" data-action="generate" data-gen="'+f.gen+'" data-target="'+id+'" aria-label="'+esc(t('common.generate'))+'"><svg aria-hidden="true"><use href="#i-dice"/></svg></button>';
return fieldWrap(id,f.label,f.hint,f.help,f.maxLen||0).replace('{B}',h+'</div>')}
case 'bool':{
const on=!!getPath(S.set,paths[0]);
const label=f.protoLabelKey?esc(t(f.protoLabelKey)):esc(t(f.label));
const hintTxt=f.protoLabelKey?'<p class="field__hint">'+esc(t('protocols.disabled_hint'))+'</p>':(f.hint?'<p class="field__hint">'+esc(t(f.hint))+'</p>':'');
return '<div class="field" id="fw-'+id+'"><div class="row"><label class="switch"><input type="checkbox" role="switch" id="'+id+'" data-bind="'+paths[0]+'"'+(on?' checked':'')+'><span class="switch__track"><span class="switch__thumb"></span></span><span class="switch__label">'+label+'</span></label>'+(f.help?helpTrigger(f.help):'')+'</div>'+hintTxt+'<p class="field__error"></p></div>'}
case 'select':{
const cur=String(getPath(S.set,paths[0])??'');
let h='<select class="select" id="'+id+'" data-bind="'+paths[0]+'">'+f.opts.map(o=>{const v=Array.isArray(o)?o[0]:o;const k=Array.isArray(o)?o[1]:null;return '<option value="'+esc(v)+'"'+(cur===v?' selected':'')+'>'+esc(k?t(k):v)+'</option>'}).join('')+'</select>';
return fieldWrap(id,f.label,f.hint,f.help).replace('{B}',h)}
case 'chips':{
const cur=String(getPath(S.set,paths[0])??'');
let h='<div role="radiogroup" class="chip-row" data-bind="'+paths[0]+'" data-type="chips" aria-label="'+esc(t(f.label))+'">'+f.opts.map(([v,k])=>'<button type="button" role="radio" class="chip" data-chip="'+esc(v)+'" aria-checked="'+String(cur===v)+'">'+esc(t(k))+'</button>').join('')+'</div>';
return fieldWrap(id,f.label,f.hint).replace('{B}',h)}
case 'list':{
const arr=lines(getPath(S.set,paths[0]));
let h='<div class="line-editor"><textarea rows="5" class="input textarea textarea--mono" id="'+id+'" data-bind="'+paths[0]+'" data-validate="'+(f.validate||'')+'" dir="ltr" spellcheck="false" autocomplete="off">'+esc(arr.join('\n'))+'</textarea><div class="meta"><span class="cnt"></span><span class="bad"></span></div></div>';
let out=fieldWrap(id,f.label,f.hint,f.help).replace('{B}',h);
if(f.showIf)out=out.replace('<div class="field"','<div class="field" data-fpath="'+paths[0]+'"');
return out}
case 'range':{
const mn=getPath(S.set,paths[0]),mx=getPath(S.set,paths[1]);
let h='<div class="btn-row"><input type="number" step="1" class="input" style="max-width:120px" id="'+id+'a" data-bind="'+paths[0]+'" value="'+esc(mn==null?'':String(mn))+'" aria-label="'+esc(t(f.label))+' min"><span aria-hidden="true">–</span><input type="number" step="1" class="input" style="max-width:120px" id="'+id+'b" data-bind="'+paths[1]+'" value="'+esc(mx==null?'':String(mx))+'" aria-label="'+esc(t(f.label))+' max"></div>';
return fieldWrap(id,f.label,f.hint,f.help).replace('{B}',h)}
case 'fpreset':{
const cur=String(getPath(S.set,'fragment.mode')||'off');
let h='<div role="radiogroup" class="chip-row" data-bind="fragment.mode" data-type="chips" data-fpreset aria-label="'+esc(t('fragment.preset.label'))+'">';
[['off','fragment.preset.off'],['low','fragment.preset.low'],['medium','fragment.preset.medium'],['high','fragment.preset.high'],['severe','fragment.preset.severe'],['custom','fragment.preset.custom']].forEach(([v,k])=>{h+='<button type="button" role="radio" class="chip" data-chip="'+v+'" data-preset="'+v+'" aria-checked="'+String(cur===v)+'">'+esc(t(k))+'</button>'});
h+='</div>';
return fieldWrap(id,'fragment.preset.label','fragment.preset.short','fragment.preset.help').replace('{B}',h)}
case 'copyonly':{
return fieldWrap(id,f.label,null).replace('{B}','<div class="copy-field"><code dir="ltr">'+esc(BASE+'doh')+'</code><button type="button" class="btn btn--icon btn--sm" data-action="copy" data-copy-value="'+esc(BASE+'doh')+'" aria-label="'+esc(t('common.copy'))+'"><svg aria-hidden="true"><use href="#i-copy"/></svg></button></div>')}
case 'addrList':{
const arr=Array.isArray(getPath(S.set,paths[0]))?(getPath(S.set,paths[0])||[]):[];
let h='<div class="addr-list" data-type="addrList" data-bind="'+paths[0]+'">';
if(arr.length===0)h+='<div class="addr-empty">'+esc(t('addresses.empty_hint'))+'</div>';
h+='<div data-addr-body>'+arr.map(addrCardHtml).join('')+'</div>';
h+='<div class="btn-row"><button type="button" class="btn btn--ghost btn--sm" data-action="addr-add">'+esc(t('addresses.add'))+'</button><button type="button" class="btn btn--ghost btn--sm" data-action="addr-hostname">'+esc(t('addresses.use_hostname'))+'</button><button type="button" class="btn btn--ghost btn--sm" data-action="addr-probe">'+esc(t('addresses.test'))+'</button></div>';
h+='</div>';
return fieldWrap(id,f.label,f.hint,f.help).replace('{B}',h)}
case 'remoteList':{
const arr=Array.isArray(getPath(S.set,paths[0]))?(getPath(S.set,paths[0])||[]):[];
let h='<div class="addr-list" data-type="remoteList" data-bind="'+paths[0]+'">';
if(arr.length===0)h+='<div class="addr-empty remote-empty">'+esc(t('remote.nodes.empty'))+'</div>';
h+='<div data-remote-body>'+arr.map(remoteNodeCardHtml).join('')+'</div>';
h+='<div class="btn-row"><button type="button" class="btn btn--ghost btn--sm" data-action="remote-add">'+esc(t('remote.nodes.add'))+'</button></div>';
h+='</div>';
return fieldWrap(id,f.label,f.hint,f.help).replace('{B}',h)}
default:return ''}
}
