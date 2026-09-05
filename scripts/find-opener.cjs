const fs = require('fs');
const s = fs.readFileSync('src/ui/panel/settings.js', 'utf8');
const target = s.indexOf('function securityCardHtml');
function stripUpTo(pos) {
  const code = s.slice(0, pos);
  let out = '', k = 0, m = null;
  while (k < code.length) {
    const ch = code[k];
    if (m) {
      if (ch === '\\') { k += 2; continue; }
      if (ch === '\n') { out += '\n'; }
      if (ch === m) m = null;
      k++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { m = ch; k++; continue; }
    if (ch === '/' && code[k + 1] === '/') { while (k < code.length && code[k] !== '\n') k++; continue; }
    out += ch; k++;
  }
  return out;
}
const code = stripUpTo(target);
let d = 0;
const stack = [];
const ls = code.split('\n');
for (let n = 0; n < ls.length; n++) {
  const l = ls[n];
  for (let c = 0; c < l.length; c++) {
    const ch = l[c];
    if (ch === '{') { d++; stack.push((n + 1) + ':' + l.trim().slice(0, 55)); }
    else if (ch === '}') { d--; stack.pop(); }
  }
}
console.log('depth before securityCardHtml:', d);
console.log('unclosed openers:');
for (const x of stack) console.log('  ', x);
