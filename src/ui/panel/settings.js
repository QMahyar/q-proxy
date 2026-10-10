const SETTINGS_SEC_ALIAS={fragment:'protocols',egress:'addresses',tunnel:'protocols'};
function normalizeSettingsHash(){
const m=location.hash.match(/^#\/settings\/(fragment|egress|tunnel)$/);
if(m)history.replaceState(null,'','#/settings/'+SETTINGS_SEC_ALIAS[m[1]])}
