const fs = require('fs');
const p = 'src/ui/panel/settings.js';
const lines = fs.readFileSync(p, 'utf8').split('\n');
// the remoteList return line ends with replace('{B}',h)}  -> append a lone } after it
const idx = lines.findIndex(l => l.startsWith("return fieldWrap(id,f.label,f.hint,f.help).replace('{B}',h)}") && lines[lines.indexOf(l) - 6] && lines[lines.indexOf(l) - 6].startsWith("let h='<div class=\"addr-list\" data-type=\"remoteList\""));
console.log('candidate line:', idx + 1);
// safer: find "case 'remoteList':{" then its return line
let start = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].replace(/\r$/, '') === "case 'remoteList':{") { start = i; break; }
}
console.log('remoteList starts:', start + 1);
for (let i = start; i < start + 12; i++) {
  console.log(i + 1, JSON.stringify(lines[i].replace(/\r$/, '').slice(0, 60)));
}
