const fs = require('fs');
const CASES = ['str','num','secret','bool','instantbool','lang','select','chips','ports','list','range','fpreset','copyonly','addrList','remoteList'];
const raw = fs.readFileSync('src/ui/panel/settings.js', 'utf8');
const lines = raw.split('\n').map(l => l.replace(/\r$/, ''));
function stripStrings(l) {
  let out = '', i = 0, m = null;
  while (i < l.length) {
    const ch = l[i];
    if (m) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === m) m = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { m = ch; i++; continue; }
    if (ch === '/' && l[i+1] === '/') break;
    out += ch; i++;
  }
  return out;
}
for (const c of CASES) {
  const start = lines.findIndex(l => l === `case '${c}':{`);
  if (start < 0) { console.log(c, 'MISSING'); continue; }
  let d = 0, end = -1;
  for (let k = start; k < Math.min(start + 40, lines.length); k++) {
    const code = stripStrings(lines[k]);
    for (const ch of code) {
      if (ch === '{') d++;
      else if (ch === '}') { d--; if (d === 0 && k > start) { end = k + 1; break; } }
    }
    if (end > 0) break;
  }
  console.log(c, 'starts', start + 1, '-> balanced ends', end > 0 ? ('line ' + end) : 'NOT within 40 lines');
}
