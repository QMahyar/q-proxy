// Trivial drift guard: wrangler.toml and vitest.config.ts must agree on the
// workerd compat date/flags, and the entry-point/bindings must stay wired.
// Run in CI after build: `node scripts/check-config.mjs`.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const wrangler = readFileSync(resolve(root, "wrangler.toml"), "utf8");
const vitest = readFileSync(resolve(root, "vitest.config.ts"), "utf8");

const wDate = wrangler.match(/^\s*compatibility_date\s*=\s*"([^"]+)"/m)?.[1] ?? "";
const wFlagsRaw = wrangler.match(/^\s*compatibility_flags\s*=\s*\[([^\]]*)\]/m)?.[1] ?? "";
const wFlags = [...wFlagsRaw.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
const wMain = wrangler.match(/^\s*main\s*=\s*"([^"]+)"/m)?.[1] ?? "";

const vDate = vitest.match(/compatibilityDate\s*:\s*"([^"]+)"/)?.[1] ?? "";
const vFlagsRaw = vitest.match(/compatibilityFlags\s*:\s*\[([^\]]*)\]/)?.[1] ?? "";
const vFlags = [...vFlagsRaw.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();

if (!wDate) failures.push("wrangler.toml: compatibility_date not found");
if (!vDate) failures.push("vitest.config.ts: miniflare compatibilityDate not found");
if (wDate && vDate && wDate !== vDate) {
  failures.push(`compat date drift: wrangler.toml ${wDate} vs vitest.config.ts ${vDate}`);
}
if (JSON.stringify(wFlags) !== JSON.stringify(vFlags)) {
  failures.push(`compat flags drift: wrangler.toml [${wFlags}] vs vitest.config.ts [${vFlags}]`);
}
if (wMain !== "dist/q-proxy.js") {
  failures.push(`wrangler.toml main should be "dist/q-proxy.js" (got ${JSON.stringify(wMain)})`);
}
if (!/binding\s*=\s*"QPROXY_KV"/.test(wrangler)) failures.push('wrangler.toml: missing kv binding "QPROXY_KV"');
if (!/binding\s*=\s*"QPROXY_DB"/.test(wrangler)) failures.push('wrangler.toml: missing d1 binding "QPROXY_DB"');

if (failures.length > 0) {
  for (const f of failures) console.error(`config check: ${f}`);
  process.exit(1);
}
console.log(`config check ok (compat ${wDate} [${wFlags}], main ${wMain}, kv+d1 bindings present)`);
