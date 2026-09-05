const fs = require('fs');
const lines = fs.readFileSync('src/ui/panel/settings.js', 'utf8').split('\n').map(l => l.replace(/\r$/, ''));
function stripStrings(l) {
  let out = '', i = 0, m = null;
  while (i < l.length) {
    const ch = l[i];
    if (m) { if (ch === '\\') { i += 2; continue; } if (ch === m) m = null; i++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { m = ch; i++; continue; }
    if (ch === '/' && l[i + 1] === '/') break;
    out += ch; i++;
  }
  return out;
}
for (const fn of ['function bindHtml', 'function cardHtml', 'function securityCardHtml', 'function totpCardHtml']) {
  const idx = lines.findIndex(l => l.startsWith(fn));
  if (idx < 0) { console.log(fn, 'MISSING'); continue; }
  let d = 0;
  for (let k = 0; k < idx; k++) {
    const c = stripStrings(lines[k]);
    for (const ch of c) { if (ch === '{') d++; else if (ch === '}') d--; }
  }
  console.log(fn, 'at line', idx + 1, 'nesting depth', d);
}
