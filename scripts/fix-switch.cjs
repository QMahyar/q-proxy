const fs = require('fs');
const p = 'src/ui/panel/settings.js';
const lines = fs.readFileSync(p, 'utf8').split('\n');
// insert lone } after line 260 (index 259): the remoteList return line, closing bindHtml's switch,
// so that `default:` and the function-closing } + cardHtml stay correctly nested.
const retIdx = lines.findIndex((l, i) => l.replace(/\r$/, '').startsWith("return fieldWrap(id,f.label,f.hint,f.help).replace('{B}',h)}") && i > 250);
if (retIdx < 0) { console.log('return line not found'); process.exit(1); }
console.log('return line:', retIdx + 1, '| next:', JSON.stringify(lines[retIdx + 1].replace(/\r$/, '')));
lines.splice(retIdx + 1, 0, '}');
fs.writeFileSync(p, lines.join('\n'));
console.log('inserted switch close after line', retIdx + 1);
