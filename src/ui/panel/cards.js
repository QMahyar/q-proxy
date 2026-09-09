function cardHtml(card){
if(card.pool)return poolCardHtml();
if(card.danger&&!card.fields.length){
return '<section class="card"><div class="card__head"><div class="card__title hint-danger">'+esc(t(card.title))+'</div></div><button type="button" class="btn btn--ghost-danger" data-action="reset-defaults">'+esc(t('common.resetDefaults'))+'</button></section>'}
if(card.backup&&!card.fields.length){
return '<section class="card"><div class="card__head"><div class="card__title">'+esc(t(card.title))+'</div></div><div class="btn-row"><a class="btn btn--ghost btn--sm" href="'+esc(BASE)+'api/settings/export" download data-action="backup-export">'+esc(t('general.backup.export'))+'</a><button type="button" class="btn btn--ghost btn--sm" data-action="settings-import">'+esc(t('general.backup.import'))+'</button></div><input type="file" id="settings-import-file" accept=".json,application/json" hidden><p class="field__hint" id="settings-import-hint">'+esc(t('general.backup.import_hint'))+'</p></section>'}
return cardBodyHtml(card)}
function panelAddressCardHtml(){
const sp=String((S.set&&S.set.securePath)||'').replace(/^\/+|\/+$/g,'');
const loginUrl=location.origin+(sp?'/'+sp+'/':BASE)+'login';
return '<section class="card"><div class="card__head"><div class="card__title">'+esc(t('address.panelTitle'))+'</div></div>'
+'<div class="copy-field"><code dir="ltr">'+esc(loginUrl)+'</code><button type="button" class="btn btn--icon btn--sm" data-action="copy" data-copy-value="'+esc(loginUrl)+'" aria-label="'+esc(t('common.copy'))+'"><svg aria-hidden="true"><use href="#i-copy"/></svg></button></div>'
+'<p class="field__hint">'+esc(t('address.panelHint'))+'</p></section>'}
function securityCardHtml(){
return '<section class="card"><div class="card__head"><div class="card__title">'+esc(t('security.title'))+'</div></div><p class="field__hint">'+esc(t('security.hint'))+'</p>'
+'<div class="field" id="fw-sec-cur"><div class="field__label-row"><label class="field__label" for="sec-cur">'+esc(t('security.current'))+'</label></div><div class="secret-field"><input type="password" class="input input--mono" style="flex:1;min-width:0" id="sec-cur" autocomplete="current-password" spellcheck="false" dir="ltr"><button type="button" class="btn btn--icon btn--ghost" data-action="reveal" data-target="sec-cur" aria-label="'+esc(t('common.reveal'))+'" aria-pressed="false"><svg aria-hidden="true"><use href="#i-eye"/></svg></button></div><p class="field__error"></p></div>'
+'<div class="field" id="fw-sec-new"><div class="field__label-row"><label class="field__label" for="sec-new">'+esc(t('security.new'))+'</label></div><div class="secret-field"><input type="password" class="input input--mono" style="flex:1;min-width:0" id="sec-new" autocomplete="new-password" spellcheck="false" dir="ltr"><button type="button" class="btn btn--icon btn--ghost" data-action="reveal" data-target="sec-new" aria-label="'+esc(t('common.reveal'))+'" aria-pressed="false"><svg aria-hidden="true"><use href="#i-eye"/></svg></button></div><p class="field__error"></p></div>'
+'<div class="field" id="fw-sec-cf"><div class="field__label-row"><label class="field__label" for="sec-confirm">'+esc(t('security.confirm'))+'</label></div><div class="secret-field"><input type="password" class="input input--mono" style="flex:1;min-width:0" id="sec-confirm" autocomplete="new-password" spellcheck="false" dir="ltr"><button type="button" class="btn btn--icon btn--ghost" data-action="reveal" data-target="sec-confirm" aria-label="'+esc(t('common.reveal'))+'" aria-pressed="false"><svg aria-hidden="true"><use href="#i-eye"/></svg></button></div><p class="field__error"></p></div>'
+'<div class="btn-row"><button type="button" class="btn btn--primary" data-action="change-password">'+esc(t('security.change'))+'</button></div></section>'}
function cardBodyHtml(card){
if(card.panelAddr&&!card.fields.length){return panelAddressCardHtml()}
if(card.security&&!card.fields.length){return securityCardHtml()}
if(card.totpCard&&!card.fields.length){return totpCardHtml()}
if(card.advTls){
let h='<section class="card"><details class="adv-tls warp-acc"><summary>'+esc(t(card.title))+'</summary>';
card.fields.forEach(f=>{h+=bindHtml(f)});
return h+'</details></section>'}
const dim=card.protoCard&&getPath(S.set,card.protoCard)===false;
let h='<section class="card'+(dim?' card--dim':'')+'"'+(card.protoCard?' data-proto-card="'+card.protoCard+'"':'')+'><div class="card__head"><div class="card__title">'+esc(t(card.title))+'</div></div>';
card.fields.forEach(f=>{h+=bindHtml(f)});
if(card.tgActions)h+='<div class="btn-row"><button type="button" class="btn btn--ghost btn--sm" data-action="tg-setup">'+esc(t('advanced.tg.setup'))+'</button><button type="button" class="btn btn--ghost btn--sm" data-action="tg-remove">'+esc(t('advanced.tg.remove'))+'</button></div>';
return h+'</section>'}
