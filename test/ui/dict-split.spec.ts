import { describe, expect, it } from "vitest";
// @ts-expect-error node builtin lacks types in this repo (precedent: vitest.config.ts)
import { readFileSync } from "node:fs";
// @ts-expect-error node builtin lacks types in this repo (precedent: vitest.config.ts)
import vm from "node:vm";

const SOURCE = readFileSync("src/ui/panel/dict.js", "utf8");

interface Probe {
  LANG: string;
  enKeys: number;
  faKeys: number;
  t: (k: string) => string;
}

function bootDict(cookie: string): Probe {
  // dict.js opens the panel's shared IIFE (actions.js closes it at assembly time).
  // The probe statement must run INSIDE the IIFE to reach LANG/DICT/t, then we close it.
  const instrumented =
    SOURCE.replace(/\r\n/g, "\n") +
    "\nglobalThis.__PROBE={LANG:LANG,enKeys:DICT.en?Object.keys(DICT.en).length:null,faKeys:DICT.fa?Object.keys(DICT.fa).length:null,t:(k)=>t(k)};" +
    "\n})();";
  const document = {
    cookie,
    documentElement: { lang: "", dir: "", dataset: {} as Record<string, string>, style: {} as Record<string, string> },
    getElementById: () => null,
  };
  const sandbox = {
    document,
    navigator: {},
    localStorage: { getItem: () => null, setItem: () => undefined },
    sessionStorage: { getItem: () => null, setItem: () => undefined },
    location: { hash: "", pathname: "/", hostname: "x", search: "", reload: () => undefined },
    window: { matchMedia: () => ({ matches: false, addEventListener: () => undefined }) },
    matchMedia: () => ({ matches: false, addEventListener: () => undefined }),
    globalThis: {} as Record<string, unknown>,
  };
  sandbox.globalThis = sandbox as unknown as Record<string, unknown>;
  vm.createContext(sandbox);
  vm.runInContext(instrumented, sandbox);
  return (sandbox.globalThis as { __PROBE: Probe }).__PROBE;
}

describe("panel dict single-language heap retention", () => {
  it("keeps both languages when the qp_lang cookie is absent (boot reconciliation may switch language)", () => {
    const probe = bootDict("");
    expect(probe.LANG).toBe("fa");
    expect(probe.enKeys).toBeGreaterThan(400);
    expect(probe.faKeys).toBeGreaterThan(400);
  });

  it("drops the English copy once the cookie pins fa (heap-side single-language retention)", () => {
    const probe = bootDict("qp_lang=fa");
    expect(probe.LANG).toBe("fa");
    expect(probe.faKeys).toBeGreaterThan(400);
    expect(probe.enKeys).toBe(0);
    expect(probe.t("nav.home")).toBe("خانه");
    expect(probe.t("users.limit")).toContain("اشتراک");
  });

  it("drops the Persian copy once the cookie pins en", () => {
    const probe = bootDict("qp_lang=en");
    expect(probe.LANG).toBe("en");
    expect(probe.enKeys).toBeGreaterThan(400);
    expect(probe.faKeys).toBe(0);
    expect(probe.t("nav.home")).toBe("Home");
  });

  it("prunes to an empty object (never null) so unguarded DICT.en reads in settings.js stay safe", () => {
    const probe = bootDict("qp_lang=fa");
    expect(probe.enKeys).toBe(0);
    const raw = SOURCE;
    expect(raw).toContain("DICT[LANG==='en'?'fa':'en']={}");
  });

  it("keeps the translator total: unknown keys fall back to the raw key in both pinned states", () => {
    expect(bootDict("qp_lang=fa").t("not.a.key")).toBe("not.a.key");
    expect(bootDict("qp_lang=en").t("not.a.key")).toBe("not.a.key");
  });
});
