const fs = require('fs');
const lines = fs.readFileSync('src/ui/panel/settings.js', 'utf8').split('\n');
// cardHtml region: lines 263..271 (1-indexed) i.e. idx 262..270
const region = lines.slice(262, 271).join('\n');
function strip(s) {
  let out = '', i = 0, m = null;
  while (i < s.length) {
    const ch = s[i];
    if (m) { if (ch === '\\') { i += 2; continue; } if (ch === m) m = null; i++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { m = ch; i++; continue; }
    if (ch === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    out += ch; i++;
  }
  return out;
}
const code = strip(region);
let d = 0;
for (const ch of code) { if (ch === '{') d++; else if (ch === '}') d--; }
console.log('cardHtml region net depth:', d);
console.log('stripped region:');
console.log(code);
