const SETTINGS_SEC_ALIAS={fragment:'tunnel'};
function normalizeSettingsHash(){
const m=location.hash.match(/^#\/settings\/(fragment)$/);
if(m)history.replaceState(null,'','#/settings/'+SETTINGS_SEC_ALIAS[m[1]])}
