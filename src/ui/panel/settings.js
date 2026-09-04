function toLocalInputValue(ms){
const d=new Date(ms);const p=n=>String(n).padStart(2,'0');
return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())}
function openUserModal(id){
const m=$('m-user');
if(id)m.dataset.userId=id;else delete m.dataset.userId;
const u=id?S.users.find(x=>x.id===id):null;
$('mu-title').textContent=t(u?'users.edit':'users.add');
$('mu-go').textContent=t(u?'common.save':'users.add');
$('mu-name').value=u?u.name:'';
const picked=u&&u.protocols!=='all'?u.protocols:['all'];
document.querySelectorAll('#mu-protocols input[type=checkbox]').forEach(i=>{i.checked=picked.includes(i.value)});
$('mu-limit').value=u&&u.dailyReqLimit!=null?String(u.dailyReqLimit):'';
$('mu-expiry').value=u&&u.expiresAt!=null?toLocalInputValue(u.expiresAt):'';
$('mu-ov-label').textContent=t('users.override.label');
$('mu-ov-hint').textContent=t('users.override.hint');
$('mu-ov-address-label').textContent=t('addresses.field.address');
$('mu-ov-port-label').textContent=t('addresses.field.port');
$('mu-ov-label-label').textContent=t('addresses.field.label');
const ov=u&&u.addressOverride?u.addressOverride:null;
$('mu-ov-address').value=ov&&ov.address?ov.address:'';
$('mu-ov-port').value=ov&&ov.port?String(ov.port):'';
$('mu-ov-label2').value=ov&&ov.label?ov.label:'';
const dl=$('mu-ov-options');
if(dl){dl.innerHTML=(S.set.addresses||[]).map(function(a){if(a.enabled===false)return '';return '<option value="'+esc(String(a.address||'').replace(/(:\d+)$/,''))+'"></option>'}).join('')}
$('mu-error').style.display='';$('mu-error').textContent='';
openModal('m-user')}
const FL=(path,type,label,hint,extra)=>Object.assign({path,type,label,hint:hint||null},extra||{});

const SECTIONS=[
{key:'general',cards:[
{title:null,fields:[
FL('securePath','secret','general.securePath.label','general.securePath.short',{gen:'hex12',copy:true,maxLen:64,help:'general.securePath.help'}),
FL('profileTitle','str','general.profileTitle.label','general.profileTitle.hint',{maxLen:64}),
FL('debugLogging','bool','general.debugLogging.label','general.debugLogging.hint'),
FL('allowedIps','list','security.allowlist.label','security.allowlist.hint')]},
{title:'home.kill.title',fields:[
FL('killSwitch','instantbool','general.killSwitch.label','general.killSwitch.hint'),
FL('language','lang','general.language.label',null)]},
{title:'general.danger.title',danger:true,fields:[]},
{title:'general.backup.title',backup:true,fields:[]},{title:'security.title',security:true,fields:[]},{title:'totp.title',totpCard:true,fields:[]}]},
{key:'protocols',cards:[
{title:'protocols.vless.title',protoCard:'vlessEnabled',fields:[
FL('vlessEnabled','bool',null,null,{protoLabelKey:'protocols.vless.title'}),
FL('vlessUuid','secret','protocols.uuid',null,{gen:'uuid',copy:true}),
FL('vlessPath','str','protocols.path.label','protocols.path.hint',{mono:true}),
FL('vlessFlow','select','protocols.flow.label','protocols.flow.hint',{opts:[['','protocols.flow.off'],['xtls-rprx-vision','protocols.flow.vision']]})]},
{title:'protocols.vmess.title',protoCard:'vmessEnabled',fields:[
FL('vmessEnabled','bool',null,null,{protoLabelKey:'protocols.vmess.title'}),
FL('vmessUuid','secret','protocols.uuid',null,{gen:'uuid',copy:true}),
FL('vmessPath','str','protocols.path.label','protocols.path.hint',{mono:true})]},
{title:'protocols.trojan.title',protoCard:'trojanEnabled',fields:[
FL('trojanEnabled','bool',null,null,{protoLabelKey:'protocols.trojan.title'}),
FL('trojanPassword','secret','protocols.password',null,{gen:'pass',copy:true}),
FL('trojanPath','str','protocols.path.label','protocols.path.hint',{mono:true})]},
{title:'protocols.ss.title',protoCard:'ssEnabled',fields:[
FL('ssEnabled','bool',null,null,{protoLabelKey:'protocols.ss.title'}),
FL('ssPassword','secret','protocols.password',null,{gen:'pass',copy:true}),
FL('ssMethod','select','protocols.cipher',null,{opts:SS_METHODS}),
FL('ssPath','str','protocols.path.label','protocols.path.hint',{mono:true}),
FL('ssDirect','bool','protocols.ssDirect.label','protocols.ssDirect.hint')]},
{title:'protocols.common.title',fields:[
FL('earlyDataEnabled','bool','protocols.earlyData.label','protocols.earlyData.hint'),
FL('earlyDataMaxBytes','num','protocols.earlyData.max',null,{min:0,max:8192}),
FL('fingerprint','select','protocols.fingerprint.label',null,{opts:FPS}),
FL('randomizeSniCase','bool','protocols.sniCase.label','protocols.sniCase.hint'),
FL('echEnabled','bool','protocols.ech.label','protocols.ech.short',{help:'protocols.ech.help'}),
FL('echAuto','bool','protocols.ech.auto','protocols.ech.auto_hint',{help:'protocols.ech.auto_help'}),
FL('echServerName','str','protocols.ech.server','protocols.ech.server_hint',{maxLen:253,vtype:'domain',preview:'ech'}),
FL('alpn','list','protocols.alpn.label','protocols.alpn.hint')]}]},
  {key:'addresses',cards:[
  {title:'addresses.card.title',fields:[
  FL('addresses','addrList','addresses.card.label','addresses.card.hint',{help:'addresses.card.help'}),
  FL('defaultPort','select','addresses.defaultPort.label','addresses.defaultPort.hint',{opts:[[443,'443'],[2053,'2053'],[2083,'2083'],[2087,'2087'],[2096,'2096'],[8443,'8443']]}),
  FL('nameTemplate','str','addresses.nameTemplate.label','addresses.nameTemplate.hint',{mono:true,maxLen:512})]},
  {title:'addresses.remoteSubs.label',fields:[
  FL('remoteSubUrls','list','addresses.remoteSubs.label','addresses.remoteSubs.hint',{validate:'url'})]},
  {title:'remote.nodes.title',fields:[
  FL('remoteNodes','remoteList','remote.nodes.label','remote.nodes.hint',{help:'remote.nodes.help'})]}]},
  {key:'egress',cards:[
  {title:'egress.mode.title',fields:[
  FL('proxyIpMode','chips','egress.mode.label',null,{opts:[['proxyip','egress.mode.list'],['nat64','egress.mode.nat64']]}),
  FL('proxyIps','list','egress.list.label','egress.list.short',{validate:'host_port',help:'egress.list.help',showIf:v=>getPath(v,'proxyIpMode')!=='nat64'}),
  FL('nat64Prefixes','list','egress.nat64.label','egress.nat64.short',{validate:'ipv6_prefix',help:'egress.nat64.help',showIf:v=>getPath(v,'proxyIpMode')==='nat64'}),
  FL('proxyIpPoolUrl','str','egress.poolUrl.label','egress.poolUrl.hint',{mono:true,vtype:'url'})]},
  {title:'egress.pool.title',pool:true,fields:[]}]},
{key:'fragment',cards:[
{title:null,fields:[
FL('fragment.mode','fpreset','fragment.enable',null),
FL('fragment.packets','select','fragment.packets',null,{opts:PACKETS}),
FL(['fragment.lengthMin','fragment.lengthMax'],'range','fragment.length',null),
FL(['fragment.delayMin','fragment.delayMax'],'range','fragment.delay',null),
FL(['fragment.maxSplitMin','fragment.maxSplitMax'],'range','fragment.split',null)]}]},
{key:'chain',cards:[
{title:null,fields:[
FL('chainProxy.enabled','bool','chain.enable',null),
FL('chainProxy.uri','str','chain.uri.label','chain.uri.hint',{mono:true})]}]},
{key:'advanced',cards:[
{title:'advanced.doh.label',fields:[
FL('dohUpstream','str','advanced.doh.label','advanced.doh.short',{mono:true,help:'advanced.doh.help'}),
FL('remoteDns','str','advanced.remoteDns.label',null,{mono:true}),
FL('localDns','str','advanced.localDns.label',null,{mono:true}),
FL('enableUdp53','bool','advanced.udp53.label','advanced.udp53.hint'),
FL('__privateDoh','copyonly','advanced.doh.private',null)]},
{title:'advanced.tg.title',tgActions:true,fields:[
FL('telegram.enabled','bool','advanced.tg.enabled','advanced.tg.hint'),
FL('telegram.botToken','secret','advanced.tg.token',null,{copy:true}),
FL('telegram.chatId','str','advanced.tg.chat_id',null,{mono:true})]},
{title:'advanced.behavior.title',fields:[
FL('urlTestIntervalSec','num','advanced.urlTest.label',null,{min:60,max:86400}),
FL('subUpdateIntervalHours','num','advanced.subInterval.label',null,{min:1,max:168}),
FL('maxNodesPerFormat','num','advanced.maxNodes.label',null,{min:1,max:2000})]},
{title:'advanced.camouflage.label',fields:[
FL('camouflage.mode','select','advanced.camouflage.label',null,{opts:[['off','advanced.camouflage.none'],['static','advanced.camouflage.static'],['proxy','advanced.camouflage.proxy']]}),
FL('camouflage.url','str','advanced.camouflage.url',null,{mono:true}),
FL('speedtestIntercept','bool','advanced.speedtest.label','advanced.speedtest.short',{help:'advanced.speedtest.help'}),
FL('routingRules.bypassLan','bool','routing.bypassLan.label','routing.bypassLan.hint'),
FL('routingRules.blockQuic','bool','routing.blockQuic.label','routing.blockQuic.hint'),
FL('routingRules.blockAds','bool','routing.blockAds.label','routing.blockAds.hint'),
FL('routingRules.blockMalware','bool','routing.blockMalware.label','routing.blockMalware.hint'),
FL('routingRules.customBypass','list','routing.customBypass.label','routing.customBypass.short',{help:'routing.customBypass.help'}),
 FL('routingRules.customBlock','list','routing.customBlock.label','routing.customBlock.short',{help:'routing.customBlock.help'})]}]},
  {key:'sources',cards:[{title:'sources.title',sources:true,fields:[]}]},
  {key:'users',cards:[{title:'users.title',users:true,fields:[]}]},
  {key:'warp',cards:[{warpAccounts:true,fields:[]},{warpPresets:true,fields:[]},{warpAmnezia:true,fields:[]}]}
];
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
   const field=(k,label,ph)=>{const dir=(k==='address'||k==='port')?'ltr':'auto';return '<div class="addr-card__field"><label>'+esc(label)+'</label><input class="input input--mono" type="text" data-addr-field="'+k+'" value="'+esc(get(k))+'" placeholder="'+esc(ph)+'" spellcheck="false" dir="'+dir+'"></div>'};
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
     +field('city',t('addresses.field.city'),'Frankfurt')
     +'</div>'
     +'<div class="addr-card__side"><span class="addr-dot" data-addr-dot="'+esc(String(get('address')).replace(/^\[|\]$/g,'').toLowerCase())+'" hidden></span>'
     +(isHost?'<span class="addr-badge">'+esc(t('addresses.hostname_badge'))+'</span>':'')
     +'<label class="switch addr-switch" title="'+esc(t('addresses.enabled.toggle'))+'"><input type="checkbox" data-addr-enabled-input'+(enabled?' checked':'')+'><span class="switch__track"><span class="switch__thumb"></span></span></label>'
     +'<span class="addr-preview">'+esc(t('addresses.port_preview'))+' '+esc(preview)+'</span>'
     +'<button type="button" class="btn btn--icon btn--sm btn--ghost-danger" data-action="addr-del" data-index="'+i+'" aria-label="'+esc(t('common.remove'))+'"><svg aria-hidden="true"><use href="#i-x"/></svg></button></div></div>';
 }
function remoteNodeCardHtml(r,i){
const kind=r&&r.kind==='hy2'?'hy2':'reality';
const get=(k)=>r&&r[k]!=null?String(r[k]):'';
const field=(k,label,ph,tp)=>'<div class="addr-card__field"><label>'+esc(label)+'</label><input class="input input--mono" type="'+(tp||'text')+'" data-remote-field="'+k+'" value="'+esc(get(k))+'" placeholder="'+esc(ph)+'" spellcheck="false" dir="ltr"></div>';
let h='<div class="addr-card remote-card" data-remote-index="'+i+'"><div class="addr-card__main">';
h+='<div class="addr-card__field"><label>'+esc(t('remote.nodes.kind'))+'</label><select class="select" data-remote-field="kind"><option value="reality"'+(kind==='reality'?' selected':'')+'>'+esc(t('remote.nodes.kind.reality'))+'</option><option value="hy2"'+(kind==='hy2'?' selected':'')+'>'+esc(t('remote.nodes.kind.hy2'))+'</option></select></div>';
h+=field('name',t('remote.nodes.name'),'VPS-1');
h+=field('address',t('remote.nodes.address'),'203.0.113.10');
h+=field('port',t('remote.nodes.port'),'443','number');
if(kind==='reality'){
h+=field('uuid',t('remote.nodes.uuid'),'d342d11e-…');
h+=field('sni',t('remote.nodes.sni'),'www.microsoft.com');
h+=field('pbk',t('remote.nodes.pbk'),'jNXH…');
h+=field('sid',t('remote.nodes.sid'),'6ba85179');
h+='<div class="addr-card__field"><label>'+esc(t('remote.nodes.flow'))+'</label><select class="select" data-remote-field="flow"><option value=""'+(get('flow')===''?' selected':'')+'>'+esc(t('protocols.flow.off'))+'</option><option value="xtls-rprx-vision"'+(get('flow')==='xtls-rprx-vision'?' selected':'')+'>'+esc(t('protocols.flow.vision'))+'</option></select></div>';
h+=field('spx',t('remote.nodes.spx'),'/');
h+='<div class="addr-card__field"><label>'+esc(t('remote.nodes.fp'))+'</label><select class="select" data-remote-field="fp">'+FPS.map(f=>'<option value="'+esc(f)+'"'+(get('fp')===f?' selected':'')+'>'+esc(f)+'</option>').join('')+'</select></div>';
}else{
h+=field('sni',t('remote.nodes.sni'),'example.com');
h+='<div class="addr-card__field"><label>'+esc(t('remote.nodes.password'))+'</label><input class="input input--mono" type="password" data-remote-field="password" value="'+esc(get('password'))+'" autocomplete="off" spellcheck="false" dir="ltr"></div>';
h+='<div class="addr-card__field"><label>'+esc(t('remote.nodes.obfs'))+'</label><select class="select" data-remote-field="obfs"><option value=""'+(get('obfs')===''?' selected':'')+'>'+esc(t('remote.nodes.obfs.none'))+'</option><option value="salamander"'+(get('obfs')==='salamander'?' selected':'')+'>salamander</option></select></div>';
h+='<div class="addr-card__field"><label>'+esc(t('remote.nodes.obfsPassword'))+'</label><input class="input input--mono" type="password" data-remote-field="obfsPassword" value="'+esc(get('obfsPassword'))+'" autocomplete="off" spellcheck="false" dir="ltr"></div>';
}
h+='</div><div class="addr-card__side"><button type="button" class="btn btn--icon btn--sm btn--ghost-danger" data-action="remote-del" aria-label="'+esc(t('common.remove'))+'"><svg aria-hidden="true"><use href="#i-x"/></svg></button></div></div>';
return h}
function bindHtml(f){
const paths=Array.isArray(f.path)?f.path:[f.path];
const id='f'+(++UID);
switch(f.type){
case 'str':{
const val=String(getPath(S.set,paths[0])??'');
const extra=f.preview==='ech'?'<p class="field__hint" data-ech-preview dir="ltr"></p>':'';
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
case 'instantbool':{
const on=!!(S.status&&S.status.killSwitch);
return '<div class="field" id="fw-'+id+'"><div class="row"><label class="switch"><input type="checkbox" role="switch" id="'+id+'" data-kill'+(on?' checked':'')+'><span class="switch__track"><span class="switch__thumb"></span></span><span class="switch__label">'+esc(t(f.label))+'</span></label><span class="chip-status ok" data-kill-chip></span></div>'+(f.hint?'<p class="field__hint">'+esc(t(f.hint))+'</p>':'')+'</div>'}
case 'lang':{
return '<div class="field" id="fw-'+id+'"><label class="field__label" for="'+id+'">'+esc(t(f.label))+'</label><select class="select" id="'+id+'" data-lang-sel><option value="en"'+(LANG==='en'?' selected':'')+'>English</option><option value="fa"'+(LANG==='fa'?' selected':'')+'>فارسی</option></select></div>'}
case 'select':{
const cur=String(getPath(S.set,paths[0])??'');
let h='<select class="select" id="'+id+'" data-bind="'+paths[0]+'">'+f.opts.map(o=>{const v=Array.isArray(o)?o[0]:o;const k=Array.isArray(o)?o[1]:null;return '<option value="'+esc(v)+'"'+(cur===v?' selected':'')+'>'+esc(k?t(k):v)+'</option>'}).join('')+'</select>';
return fieldWrap(id,f.label,f.hint,f.help).replace('{B}',h)}
case 'chips':{
const cur=String(getPath(S.set,paths[0])??'');
let h='<div role="radiogroup" class="chip-row" data-bind="'+paths[0]+'" data-type="chips" aria-label="'+esc(t(f.label))+'">'+f.opts.map(([v,k])=>'<button type="button" role="radio" class="chip" data-chip="'+esc(v)+'" aria-checked="'+String(cur===v)+'">'+esc(t(k))+'</button>').join('')+'</div>';
return fieldWrap(id,f.label,f.hint).replace('{B}',h)}
case 'ports':{
const fam=f.family==='tls'?TLS_PORTS:PLAIN_PORTS;
const cur=lines(getPath(S.set,paths[0])).map(Number);
let h='<fieldset class="port-matrix" style="margin-block-end:12px"><legend style="font-size:var(--fs-sm);color:var(--text-dim);font-weight:600;padding-inline:6px">'+esc(t(f.label))+' <label class="btn btn--icon btn--sm" title="'+esc(t('common.yes'))+'/'+esc(t('common.no'))+'"><input type="checkbox" data-port-master data-family="'+f.family+'" style="position:absolute;opacity:0;width:1px;height:1px" aria-label="'+esc(t(f.label))+' all"></label></legend><div class="port-cells" data-bind="'+paths[0]+'" data-type="ports" data-family="'+f.family+'">'+fam.map(p=>'<label class="port-cell"><input type="checkbox" value="'+p+'" data-port-opt'+(cur.includes(p)?' checked':'')+'><span>'+p+'</span></label>').join('')+'</div></fieldset>';
return fieldWrap(id,f.label,null).replace('{B}',h)}
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
function cardHtml(card){
if(card.users)return usersCardHtml();
if(card.warpAccounts||card.warpPresets||card.warpAmnezia)return warpCardHtml(card);
if(card.pool)return poolCardHtml();
if(card.sources)return sourcesCardHtml();
if(card.danger&&!card.fields.length){
return '<section class="card"><div class="card__head"><div class="card__title hint-danger">'+esc(t(card.title))+'</div></div><button type="button" class="btn btn--ghost-danger" data-action="reset-defaults">'+esc(t('common.resetDefaults'))+'</button></section>'}
if(card.backup&&!card.fields.length){
return '<section class="card"><div class="card__head"><div class="card__title">'+esc(t(card.title))+'</div></div><div class="btn-row"><a class="btn btn--ghost btn--sm" href="'+esc(BASE)+'api/settings/export" download data-action="backup-export">'+esc(t('general.backup.export'))+'</a><button type="button" class="btn btn--ghost btn--sm" data-action="settings-import">'+esc(t('general.backup.import'))+'</button></div><input type="file" id="settings-import-file" accept=".json,application/json" hidden><p class="field__hint" id="settings-import-hint">'+esc(t('general.backup.import_hint'))+'</p></section>'}
function securityCardHtml(){
return '<section class="card"><div class="card__head"><div class="card__title">'+esc(t('security.title'))+'</div></div><p class="field__hint">'+esc(t('security.hint'))+'</p>'
+'<div class="field" id="fw-sec-cur"><div class="field__label-row"><label class="field__label" for="sec-cur">'+esc(t('security.current'))+'</label></div><div class="secret-field"><input type="password" class="input input--mono" style="flex:1;min-width:0" id="sec-cur" autocomplete="current-password" spellcheck="false" dir="ltr"><button type="button" class="btn btn--icon btn--ghost" data-action="reveal" data-target="sec-cur" aria-label="'+esc(t('common.reveal'))+'" aria-pressed="false"><svg aria-hidden="true"><use href="#i-eye"/></svg></button></div><p class="field__error"></p></div>'
+'<div class="field" id="fw-sec-new"><div class="field__label-row"><label class="field__label" for="sec-new">'+esc(t('security.new'))+'</label></div><div class="secret-field"><input type="password" class="input input--mono" style="flex:1;min-width:0" id="sec-new" autocomplete="new-password" spellcheck="false" dir="ltr"><button type="button" class="btn btn--icon btn--ghost" data-action="reveal" data-target="sec-new" aria-label="'+esc(t('common.reveal'))+'" aria-pressed="false"><svg aria-hidden="true"><use href="#i-eye"/></svg></button></div><p class="field__error"></p></div>'
+'<div class="field" id="fw-sec-cf"><div class="field__label-row"><label class="field__label" for="sec-confirm">'+esc(t('security.confirm'))+'</label></div><div class="secret-field"><input type="password" class="input input--mono" style="flex:1;min-width:0" id="sec-confirm" autocomplete="new-password" spellcheck="false" dir="ltr"><button type="button" class="btn btn--icon btn--ghost" data-action="reveal" data-target="sec-confirm" aria-label="'+esc(t('common.reveal'))+'" aria-pressed="false"><svg aria-hidden="true"><use href="#i-eye"/></svg></button></div><p class="field__error"></p></div>'
+'<div class="btn-row"><button type="button" class="btn btn--primary" data-action="change-password">'+esc(t('security.change'))+'</button></div></section>'}
if(card.security&&!card.fields.length){return securityCardHtml()}
if(card.totpCard&&!card.fields.length){return totpCardHtml()}
const dim=card.protoCard&&getPath(S.set,card.protoCard)===false;
let h='<section class="card'+(dim?' card--dim':'')+'"'+(card.protoCard?' data-proto-card="'+card.protoCard+'"':'')+'><div class="card__head"><div class="card__title">'+esc(t(card.title))+'</div></div>';
card.fields.forEach(f=>{h+=bindHtml(f)});
if(card.tgActions)h+='<div class="btn-row"><button type="button" class="btn btn--ghost btn--sm" data-action="tg-setup">'+esc(t('advanced.tg.setup'))+'</button><button type="button" class="btn btn--ghost btn--sm" data-action="tg-remove">'+esc(t('advanced.tg.remove'))+'</button></div>';
return h+'</section>'}
const TOTP_B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
let TOTP={secret:'',hashes:[],plain:[],started:false,confirmed:false};
function totpWarnActive(){return TOTP.started&&!TOTP.confirmed}
function totpCodesFile(){const s=t('totp.recovery_title')+' — Q Proxy\r\n\r\n';return s+TOTP.plain.join('\r\n')+'\r\n'}
function totpB32Encode(bytes){let s='',bits=0,acc=0;for(let i=0;i<bytes.length;i++){acc=(acc<<8)|bytes[i];bits+=8;while(bits>=5){bits-=5;s+=TOTP_B32[(acc>>>bits)&31]}}if(bits>0)s+=TOTP_B32[(acc<<(5-bits))&31];return s}
function totpB32Decode(str){const c=String(str||'').trim().toUpperCase().replace(/[\s-]+/g,'').replace(/=+$/,'');if(c.length<16||!/^[A-Z2-7]+$/.test(c))return null;const out=[];let bits=0,acc=0;for(const ch of c){acc=(acc<<5)|TOTP_B32.indexOf(ch);bits+=5;if(bits>=8){bits-=8;out.push((acc>>>bits)&255)}}return new Uint8Array(out)}
async function totpHotp(key,counter){const msg=new Uint8Array(8);let c=counter;for(let i=7;i>=0;i--){msg[i]=c%256;c=Math.floor(c/256)}const k=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-1'},false,['sign']);const sig=new Uint8Array(await crypto.subtle.sign('HMAC',k,msg));const o=sig[sig.length-1]&15;const n=((sig[o]&127)<<24)|((sig[o+1]<<16))|((sig[o+2]<<8))|(sig[o+3]);return String(n%1000000).padStart(6,'0')}
async function totpCheck(secret,code){const key=totpB32Decode(secret);if(!key)return false;const norm=String(code||'').replace(/[\s-]+/g,'');if(!/^\d{6}$/.test(norm))return false;const ctr=Math.floor(Math.floor(Date.now()/1000)/30);for(let d=-1;d<=1;d++){if(ctr+d<0)continue;if(await totpHotp(key,ctr+d)===norm)return true}return false}
function totpIssuerUrl(secret){return 'otpauth://totp/'+encodeURIComponent('Q Proxy:admin')+'?secret='+encodeURIComponent(secret)+'&issuer='+encodeURIComponent('Q Proxy')+'&algorithm=SHA1&digits=6&period=30'}
function totpIdleHtml(){return '<div class="btn-row"><button type="button" class="btn btn--primary btn--sm" data-action="totp-start">'+esc(t('totp.setup'))+'</button><button type="button" class="btn btn--ghost btn--sm" data-action="totp-disable">'+esc(t('totp.disable'))+'</button></div>'+(totpWarnActive()?'<p class="field__hint" style="color:var(--warning)">'+esc(t('totp.warn.restart'))+'</p>':'')}
function totpCardHtml(){return '<section class="card"><div class="card__head"><div class="card__title">'+esc(t('totp.title'))+'</div></div><p class="field__hint">'+esc(t('totp.desc'))+'</p><p class="field__hint">'+esc(t('totp.status_hint'))+'</p><div id="totp-body">'+totpIdleHtml()+'</div></section>'}
function totpReset(){TOTP={secret:'',hashes:[],plain:[],started:false,confirmed:false};const b=$('totp-body');if(b)b.innerHTML=totpIdleHtml()}
function renderTotpSetup(){const b=$('totp-body');if(!b)return;b.innerHTML='<p class="field__hint">'+esc(t('totp.step_secret'))+'</p>'+'<div class="field__label-row"><span class="field__label">'+esc(t('totp.secret_label'))+'</span></div>'+'<div class="copy-field"><code id="totp-secret" dir="ltr">'+esc(TOTP.secret)+'</code><button type="button" class="btn btn--icon btn--sm" data-action="copy" data-copy-value="'+esc(TOTP.secret)+'" aria-label="'+esc(t('common.copy'))+'"><svg aria-hidden="true"><use href="#i-copy"/></svg></button><button type="button" class="btn btn--icon btn--sm" data-action="totp-qr" aria-label="'+esc(t('totp.show_qr'))+'"><svg aria-hidden="true"><use href="#i-qr"/></svg></button></div>'+(totpWarnActive()?'<p class="field__hint" style="color:var(--warning)">'+esc(t('totp.warn.restart'))+'</p>':'')+'<p class="field__hint">'+esc(t('totp.step_verify'))+'</p>'+'<div class="field" id="fw-totp-code"><div class="field__label-row"><label class="field__label" for="totp-code">'+esc(t('totp.code_label'))+'</label></div><input type="text" class="input input--mono" id="totp-code" autocomplete="one-time-code" inputmode="numeric" spellcheck="false" dir="ltr" maxlength="6"><p class="field__error"></p></div>'+'<p class="field__hint">'+esc(t('totp.step_backup'))+'</p>'+'<div class="field__label-row"><span class="field__label">'+esc(t('totp.recovery_title'))+'</span></div>'+'<div class="copy-field"><code id="totp-codes" dir="ltr">'+esc(TOTP.plain.join(' '))+'</code><button type="button" class="btn btn--icon btn--sm" data-action="copy" data-copy-value="'+esc(TOTP.plain.join('\n'))+'" aria-label="'+esc(t('common.copy'))+'"><svg aria-hidden="true"><use href="#i-copy"/></svg></button><button type="button" class="btn btn--icon btn--sm" data-action="totp-codes-download" aria-label="'+esc(t('totp.codes.download'))+'" title="'+esc(t('totp.codes.download'))+'"><svg aria-hidden="true"><use href="#i-download"/></svg></button></div>'+'<label class="switch"><input type="checkbox" id="totp-saved" data-totp-saved><span class="switch__track"><span class="switch__thumb"></span></span><span class="switch__label">'+esc(t('totp.saved.confirm'))+'</span></label>'+'<div class="btn-row"><button type="button" class="btn btn--primary btn--sm" data-action="totp-confirm" disabled>'+esc(t('totp.verify_enable'))+'</button><button type="button" class="btn btn--ghost btn--sm" data-action="totp-start">'+esc(t('totp.setup'))+'</button></div>'+'<p class="field__hint" style="color:var(--warning)">'+esc(t('totp.warn.clock'))+'</p>'}
function renderTotpDone(){const b=$('totp-body');if(!b)return;b.innerHTML='<p class="field__hint">'+esc(t('totp.enabled_ok'))+'</p>'+'<p class="field__hint" style="color:var(--warning)">'+esc(t('totp.warn.clock'))+'</p>'+'<div class="btn-row"><button type="button" class="btn btn--ghost btn--sm" data-action="totp-disable">'+esc(t('totp.disable'))+'</button></div>'}
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
updatePortMasters();
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
function updatePortMasters(){
document.querySelectorAll('[data-port-master]').forEach(master=>{
const cells=master.closest('fieldset').querySelectorAll('[data-port-opt]');
const checked=[...cells].filter(c=>c.checked).length;
master.checked=checked===cells.length;
master.indeterminate=checked>0&&checked<cells.length})}
function applyFragmentPresetUi(mode){
const panel=$('sp-fragment');
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
const ci=get('city');if(ci)e.city=ci;
if(c.dataset.addrEnabled==='0')e.enabled=false;
return e}).filter(Boolean)}
if(el.dataset.type==='remoteList'){
const body=el.querySelector('[data-remote-body]');
if(!body)return [];
return [...body.querySelectorAll('.remote-card')].map(c=>{
const e=readRemoteCard(c);
if(e.address.length===0)return null;
return e}).filter(Boolean)}
if(el.dataset.type==='ports'){
const fam=el.dataset.family==='tls'?TLS_PORTS:PLAIN_PORTS;
return fam.filter(p=>el.querySelector('input[data-port-opt][value="'+p+'"]').checked)}
if(el.dataset.type==='chips'){
const c=el.querySelector('.chip[aria-checked="true"]');
return c?c.dataset.chip:''}
if(el.tagName==='TEXTAREA')return lines(el.value);
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
if(el.dataset.type==='ports'){
const arr=lines(v).map(Number);
el.querySelectorAll('input[data-port-opt]').forEach(c=>{c.checked=arr.includes(Number(c.value))});
return}
if(el.dataset.type==='chips'){
el.querySelectorAll('.chip').forEach(c=>c.setAttribute('aria-checked',String(c.dataset.chip===v)));
return}
if(el.tagName==='TEXTAREA'){el.value=lines(v).join('\n');return}
if(el.type==='checkbox'){el.checked=!!v;return}
if(el.tagName==='SELECT'){el.value=String(v);return}
el.value=v==null?'':Array.isArray(v)?lines(v).join('\n'):String(v);
if(el.tagName==='INPUT')updateCharCount(el)}
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
function markDirty(){
S.dirty.clear();
SECTIONS.forEach(s=>{
try{if(JSON.stringify(collectSection(s.key))!==S.snap[s.key])S.dirty.add(s.key)}catch(e){}});
scheduleDirtyPush();
updateApplyBar()}
function updateApplyBar(){
$('applybar').hidden=S.dirty.size===0;
$('apply-btn').disabled=false;
$('apply-btn').textContent=t('common.apply');
document.querySelectorAll('.section-actions__hint').forEach(hint=>{hint.hidden=!S.dirty.has(hint.closest('[id^="sp-"]').id.replace('sp-',''))})
document.querySelectorAll('#subtabs .subtab').forEach(a=>{const base=a.dataset.label||a.textContent.replace(/ \*$/,'');a.dataset.label=base;a.textContent=base+(S.dirty.has(a.dataset.sec)?' *':'')})}
async function refreshSubUrls(){
try{sessionStorage.removeItem('qpe:api/bootstrap');sessionStorage.removeItem('qpc:api/bootstrap')}catch(e){}
try{const d=await api('api/bootstrap',{fresh:true});S.subs=(d.subUrls&&d.subUrls.urls)||[];renderHome()}catch(e){}}
async function applySection(sec){
const btn=$('apply-btn');
btn.disabled=true;btn.textContent=t('common.applying');
clearFieldErrors(sec);
try{
const{cur,patch}=diffSection(sec);
if(Object.keys(patch).length===0){markDirty();return}
if(patch.securePath!==undefined&&!(await confirmDialog('confirm.securepath_title','confirm.securepath_body',true)))return;
await api('api/settings/save',{method:'PUT',body:patch});
Object.assign(S.set,JSON.parse(JSON.stringify(cur)));
pushUndo(sec,S.snap[sec]||'{}');
S.snap[sec]=JSON.stringify(cur);
markDirty();
 toast(t('toast.settingsSaved'),'ok');
 if(patch.securePath!==undefined){const nb='/'+String(cur.securePath||'').replace(/^\/+|\/+$/g,'');location.replace(nb+'/panel');return}
  if(sec==='general'||sec==='addresses')await refreshSubUrls()}
catch(e){
if(e&&e.fields&&Object.keys(e.fields).length){
let n=0;
for(const path in e.fields){
showFieldError(path,e.fields[path]);
n++}
toast(t('common.fixErrors',{count:n}),'err')}
else toastErr(e)}
finally{btn.disabled=false;updateApplyBar()}}
function discardSection(sec){
let snap={};
try{snap=JSON.parse(S.snap[sec]||'{}')}catch(e){}
const panel=$('sp-'+sec);
if(panel)panel.querySelectorAll('[data-bind]').forEach(el=>{
writeBind(el,getPath(snap,el.dataset.bind));
clearFieldErrorEl(el)});
markDirty();
refreshShowIf();
updateEchPreview();
updatePortMasters();
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
el.setAttribute('aria-describedby',errId)})}
function clearFieldErrors(sec){
const panel=$('sp-'+sec);
if(!panel)return;
panel.querySelectorAll('.field--error').forEach(fw=>{
fw.classList.remove('field--error');
fw.querySelectorAll('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'))})}
function clearFieldErrorEl(el){
const fw=fieldWrapOf(el);
if(fw)fw.classList.remove('field--error')}
const RE_DOMAIN=/^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const RE_IPV4=/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const RE_HOST=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const RE_V6PREFIX=/^[0-9A-Fa-f:\[\]\/]{2,50}$/i;
function validIpOrHost(line){
const s=line.replace(/^\[|\]$/g,'');
if(RE_IPV4.test(s))return true;
if(RE_V6PREFIX.test(s)&&s.includes(':'))return true;
return RE_HOST.test(s)&&s.includes('.')||(RE_HOST.test(s)&&!s.includes('.'))}
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
if(cnt)cnt.textContent=allLines.length+(ta.id.indexOf('checker-targets')===0?' / '+MAX_TARGETS:'');
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
SCALAR_RULES.securePath={kind:'required'};
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
if(rule.kind==='required')return raw.length>0?null:'err.required';
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
function randomHex(nBytes){
const a=new Uint8Array(nBytes);crypto.getRandomValues(a);
return[...a].map(b=>b.toString(16).padStart(2,'0')).join('')}

function stripPort(s){
const m=s.match(/^(.+):(\d+)$/);
return m?m[1]:s}
function genFor(kind){
if(kind==='uuid')return crypto.randomUUID();
if(kind==='hex12')return randomHex(12);
return randomPass()}