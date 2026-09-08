import { describe, expect, it } from "vitest";
// @ts-expect-error node builtin lacks types in this repo (precedent: assets.spec.ts)
import { readFileSync, readdirSync } from "node:fs";
// @ts-expect-error node builtin lacks types in this repo (precedent: assets.spec.ts)
import { join } from "node:path";

const PANEL_DIR = join(process.cwd(), "src", "ui", "panel");
const DICT_FILE = join(PANEL_DIR, "dict.js");
const MARKER = "const DICT={";

const ALLOWED = ["home.status.total"];

function parseDict(text: string): { en: Record<string, string>; fa: Record<string, string> } {
  const clean = text.replace(/\r\n/g, "\n");
  const at = clean.indexOf(MARKER);
  if (at < 0) throw new Error("DICT literal not found in dict.js");
  const start = at + MARKER.length - 1;
  const BS = "\\";
  const SQ = "'";
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let j = start; j < clean.length; j++) {
    const ch = clean[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === BS) esc = true;
      else if (ch === SQ) inStr = false;
      continue;
    }
    if (ch === SQ) inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = j + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error("unbalanced DICT literal");
  if (/\\/.test(clean.slice(start, end))) {
    throw new Error("escape sequences inside DICT values break the guard parser");
  }
  const swapped = clean
    .slice(start, end)
    .replace(/"/g, BS + '"')
    .replace(/'/g, '"')
    .replace(/\n(en|fa):\{/g, '\n"$1":{');
  return JSON.parse(swapped) as { en: Record<string, string>; fa: Record<string, string> };
}

function runtimeCorpus(): string {
  const files = readdirSync(PANEL_DIR)
    .map((f: string) => join(PANEL_DIR, f))
    .concat([join(process.cwd(), "src", "ui", "login.html"), join(process.cwd(), "src", "ui", "camo.html")])
    .filter((f: string) => /\.(js|html)$/.test(f) && f !== DICT_FILE);
  let corpus = "";
  for (const f of files) corpus += readFileSync(f, "utf8") + "\n";
  return corpus;
}

describe("ui/dict usage guard", () => {
  const dict = parseDict(readFileSync(DICT_FILE, "utf8"));
  const enKeys = Object.keys(dict.en);

  it("parses a non-trivial bilingual dictionary", () => {
    expect(enKeys.length).toBeGreaterThan(400);
    expect(dict.en["nav.home"]).toBe("Home");
    expect(typeof dict.fa["nav.home"]).toBe("string");
    expect((dict.fa["nav.home"] ?? "").length).toBeGreaterThan(0);
  });

  it("keeps EN and FA dictionaries at exact key parity", () => {
    const onlyEn = enKeys.filter((k) => !(k in dict.fa));
    const onlyFa = Object.keys(dict.fa).filter((k) => !(k in dict.en));
    expect(onlyEn).toEqual([]);
    expect(onlyFa).toEqual([]);
  });

  it("references every dictionary key from runtime UI code", () => {
    const corpus = runtimeCorpus();
    const used = new Set<string>();
    for (const m of corpus.matchAll(/\bt\('([a-zA-Z0-9_.]+)'\)/g)) used.add(m[1] ?? "");
    for (const m of corpus.matchAll(/\bt\("([a-zA-Z0-9_.]+)"\)/g)) used.add(m[1] ?? "");
    const prefixes = new Set<string>();
    for (const m of corpus.matchAll(/\bt\('([a-zA-Z0-9_]+\.[a-zA-Z0-9_.]*)'\s*\+/g)) prefixes.add(m[1] ?? "");
    for (const m of corpus.matchAll(/\bt\("([a-zA-Z0-9_]+\.[a-zA-Z0-9_.]*)"\s*\+/g)) prefixes.add(m[1] ?? "");
    for (const m of corpus.matchAll(/['"]([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)['"]/g)) {
      const lit: string = m[1] ?? "";
      if (lit && lit in dict.en) used.add(lit);
    }
    for (const k of enKeys) {
      for (const p of prefixes) {
        if (k.startsWith(p)) used.add(k);
      }
    }
    const unused = enKeys.filter((k) => !used.has(k) && !ALLOWED.includes(k));
    expect(
      unused,
      `dead dict keys — delete them from BOTH languages or wire them up:\n  ${unused.join("\n  ")}`,
    ).toEqual([]);
  });
});
