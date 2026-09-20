function helpTrigger(key){
const hid=nextId('help');return '<span class="help-wrap"><button type="button" class="help-trigger" aria-label="'+esc(t('common.help'))+'" aria-describedby="'+hid+'"><svg aria-hidden="true"><use href="#i-info"/></svg></button><span class="help-pop" role="tooltip" id="'+hid+'">'+esc(t(key))+'</span></span>'}
function fieldWrap(id,label,hint,helpKey,countMax){
let lbl='';
if(label){
lbl='<div class="field__label-row"><label class="field__label" for="'+id+'">'+esc(t(label))+'</label>'+(helpKey?helpTrigger(helpKey):'')+(countMax?'<span class="char-count" data-count-for="'+id+'" data-max="'+countMax+'" aria-hidden="true"></span>':'')+'</div>'}
return '<div class="field" id="fw-'+id+'">'+lbl+'{B}'+(hint?'<p class="field__hint">'+esc(t(hint))+'</p>':'')+'<p class="field__error"></p></div>'}

function lines(v){return Array.isArray(v)?v.map(x=>String(x)).filter(x=>x.trim().length>0):[]}
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
case 'presetChecks':{
const cur=new Set(lines(getPath(S.set,paths[0])));
const list=f.presetKind==='cdn'?(typeof CDN_PRESETS!=='undefined'?CDN_PRESETS:[]):[];
let h='<div class="check-list" role="group" id="'+id+'" data-bind="'+paths[0]+'" data-type="presetChecks" aria-label="'+esc(t(f.label))+'">'+list.map(p=>'<label class="check"><input type="checkbox" data-preset="'+esc(p.id)+'"'+(cur.has(p.id)?' checked':'')+'><span class="mono" dir="ltr">'+esc(p.ip+':'+p.port)+'</span></label>').join('')+'</div>';
return fieldWrap(id,f.label,f.hint,f.help).replace('{B}',h)}
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
default:return ''}
}
