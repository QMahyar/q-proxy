const fs = require('fs');
for (const f of ['src/ui/panel/actions.js']) {
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split('\n').map(l => l.replace(/\r$/, ''));
  console.log('=== ' + f + ' (' + lines.length + ' lines) ===');
  let d = 0;
  const stack = [];
  function strip(l) {
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
  for (let n = 0; n < lines.length; n++) {
    const code = strip(lines[n]);
    for (const ch of code) {
      if (ch === '{') { d++; stack.push((n + 1) + ':' + lines[n].trim().slice(0, 50)); }
      else if (ch === '}') { d--; stack.pop(); }
    }
    if (d < 0) { console.log('EXTRA CLOSE at line', n + 1); d = 0; }
  }
  console.log('final depth:', d);
  console.log('unclosed:', JSON.stringify(stack.slice(-4), null, 0).slice(0, 400));
}
