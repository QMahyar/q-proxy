const fs = require('fs');
const src = fs.readFileSync('src/ui/panel/settings.js', 'utf8');
const n = src.length;
let line = 1, d = 0, j = 0;
while (j < n) {
  const ch = src[j];
  if (ch === '\n') { line++; j++; continue; }
  if (ch === '/' && src[j + 1] === '/') { while (j < n && src[j] !== '\n') j++; continue; }
  if (ch === '/' && src[j + 1] === '*') { j += 2; while (j < n && !(src[j] === '*' && src[j + 1] === '/')) { if (src[j] === '\n') line++; j++; } j += 2; continue; }
  if (ch === "'" || ch === '"') {
    const q = ch; j++;
    while (j < n) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === '\n') line++; if (src[j] === q) { j++; break; } j++; }
    continue;
  }
  if (ch === '`') {
    j++; let dd = 0;
    while (j < n) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '\n') line++;
      if (src[j] === '`' && dd === 0) { j++; break; }
      if (src[j] === '$' && src[j + 1] === '{') { dd++; j += 2; continue; }
      if (src[j] === '}' && dd > 0) { dd--; j++; continue; }
      j++;
    }
    continue;
  }
  if (ch === '/') {
    let k = j + 1, ok = false;
    while (k < n && src[k] !== '\n') {
      if (src[k] === '\\') { k += 2; continue; }
      if (src[k] === '/') { ok = true; break; }
      if (src[k] === '[') { k++; while (k < n && src[k] !== ']') { if (src[k] === '\\') k++; k++; } continue; }
      k++;
    }
    if (ok) { let q = k + 1; while (q < n && /[gimsuy]/.test(src[q])) q++; j = q; continue; }
    j++; continue;
  }
  if (ch === '{') {
    if (d === 0) {
      const tail = src.slice(Math.max(0, j - 140), j);
      const fm = tail.match(/function\s+([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*$/);
      if (fm) console.log('top-level function', fm[1], 'opens line', line);
    }
    d++; j++; continue;
  }
  if (ch === '}') { d--; if (d < 0) console.log('!!! EXTRA CLOSE at line', line); j++; continue; }
  j++;
}
console.log('final depth:', d);
