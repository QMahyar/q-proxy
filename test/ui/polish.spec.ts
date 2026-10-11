import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const LOGIN = "src/ui/login.html";
const SHELL = "src/ui/panel/shell.html";
const ACTIONS = "src/ui/panel/actions.js";
const HOME = "src/ui/panel/home.js";
const DICT = "src/ui/panel/dict.js";

const dictHits = (key: string): number => {
  const src = readFileSync(DICT, "utf8");
  return [...src.matchAll(new RegExp(`'${key.replace(/\./g, "\\.")}':`, "g"))].length;
};

describe("B6 login auth guard", () => {
  it("login page guards the auto-redirect with a session counter (no redirect loops)", () => {
    const src = readFileSync(LOGIN, "utf8");
    expect(src.includes("_auth_auto_redirect")).toBe(true);
  });

  it("login POST does not follow worker redirects (valid-cookie POST is not misreported)", () => {
    const src = readFileSync(LOGIN, "utf8");
    expect(src.includes("opaqueredirect")).toBe(true);
  });
});

describe("B6 expert JSON mode", () => {
  it("shell has the expert modal", () => {
    expect(readFileSync(SHELL, "utf8").includes('id="m-expert"')).toBe(true);
  });

  it("actions wires expert open/save/close", () => {
    const src = readFileSync(ACTIONS, "utf8");
    for (const k of ["'expert-open'", "'expert-save'", "'close-expert'", "m-expert"]) {
      expect(src.includes(k)).toBe(true);
    }
  });

  it("expert strings are bilingual", () => {
    for (const k of ["expert.title", "expert.desc", "expert.save", "expert.badJson"]) {
      expect(dictHits(k)).toBe(2);
    }
  });
});

describe("B6 footer version state", () => {
  it("footer marks preview builds distinctly from releases", () => {
    expect(readFileSync(HOME, "utf8").includes("ver-dot")).toBe(true);
  });
});

describe("B6 wizard protocol honesty", () => {
  it("onboarding no longer claims VLESS is the only protocol", () => {
    const src = readFileSync(DICT, "utf8");
    expect(src.includes("تنها پروتکل")).toBe(false);
    expect(src.includes("only protocol")).toBe(false);
  });
});
