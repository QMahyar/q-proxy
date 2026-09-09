const SETTINGS_SEC_ALIAS={fragment:'tunnel',chain:'tunnel',sources:'egress'};
function normalizeSettingsHash(){
const m=location.hash.match(/^#\/settings\/(fragment|chain|sources)$/);
if(m)history.replaceState(null,'','#/settings/'+SETTINGS_SEC_ALIAS[m[1]])}
