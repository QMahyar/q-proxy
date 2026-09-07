import { describe, expect, it } from "vitest";
// @ts-expect-error node builtin lacks types in this repo (precedent: test/ui/assets.spec.ts)
import { readFileSync } from "node:fs";

const CSS_PATH = "src/ui/panel/app.css";

type Decl = { name: string; value: string };

type ThemeBlock = Decl[];

const readThemeBlock = (selector: string): ThemeBlock => {
  const css = readFileSync(CSS_PATH, "utf8");
  const start = css.indexOf(`${selector}{`);
  if (start === -1) throw new Error(`selector not found in app.css: ${selector}`);
  const open = start + selector.length;
  let depth = 0;
  let close = -1;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) throw new Error(`unbalanced braces after ${selector}`);
  const body = css.slice(open + 1, close);
  return body
    .split(";")
    .map((d: string) => d.trim())
    .filter(Boolean)
    .map((d: string) => {
      const eq = d.indexOf(":");
      return { name: d.slice(0, eq).trim(), value: d.slice(eq + 1).trim() };
    });
};

const varValue = (theme: "dark" | "light", name: string): string => {
  const block: ThemeBlock = readThemeBlock(theme === "dark" ? ":root" : 'html[data-theme="light"]');
  const decl: Decl | undefined = block.find((d) => d.name === `--${name}`);
  if (!decl) throw new Error(`--${name} not defined in ${theme} theme`);
  return decl.value;
};

const hexLuminance = (hex: string): number => {
  const raw = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) throw new Error(`not a 6-digit hex: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16) / 255).map((v) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
};

const contrastRatio = (fgHex: string, bgHex: string): number => {
  const l1 = hexLuminance(fgHex);
  const l2 = hexLuminance(bgHex);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};

const STATUS_TOKENS = ["success", "warning", "danger"] as const;
const TEXT_TOKENS = ["text-faint", "text-ghost"] as const;
const AA = 4.5;

describe("ui/theme contrast", () => {
  it.each(["dark", "light"] as const)(
    "%s theme: success/warning/danger pass AA on --bg and --bg-raised",
    (theme) => {
      const bg = varValue(theme, "bg");
      const raised = varValue(theme, "bg-raised");
      for (const token of STATUS_TOKENS) {
        const fg = varValue(theme, token);
        const onBg = contrastRatio(fg, bg);
        const onRaised = contrastRatio(fg, raised);
        expect(onBg, `--${token} ${fg} on --bg ${bg} in ${theme}`).toBeGreaterThanOrEqual(AA);
        expect(onRaised, `--${token} ${fg} on --bg-raised ${raised} in ${theme}`).toBeGreaterThanOrEqual(AA);
      }
    }
  );

  it.each(["dark", "light"] as const)(
    "%s theme: text-faint/text-ghost pass AA on --bg and --bg-raised",
    (theme) => {
      const bg = varValue(theme, "bg");
      const raised = varValue(theme, "bg-raised");
      for (const token of TEXT_TOKENS) {
        const fg = varValue(theme, token);
        const onBg = contrastRatio(fg, bg);
        const onRaised = contrastRatio(fg, raised);
        expect(onBg, `--${token} ${fg} on --bg ${bg} in ${theme}`).toBeGreaterThanOrEqual(AA);
        expect(onRaised, `--${token} ${fg} on --bg-raised ${raised} in ${theme}`).toBeGreaterThanOrEqual(AA);
      }
    }
  );

  it.each(["dark", "light"] as const)("%s theme: faint is stricter than ghost", (theme) => {
    const faint = varValue(theme, "text-faint");
    const ghost = varValue(theme, "text-ghost");
    expect(contrastRatio(faint, varValue(theme, "bg"))).toBeGreaterThan(
      contrastRatio(ghost, varValue(theme, "bg"))
    );
  });

  it("empty-state title uses a theme token, not a hardcoded color", () => {
    const css = readFileSync(CSS_PATH, "utf8");
    const rule: string | undefined = css
      .split("\n")
      .find((l: string) => l.includes(".empty-title{"));
    expect(rule, ".empty-title rule exists").toBeTruthy();
    expect(rule).toMatch(/color:var\(--(text|text-mid|text-dim|text-faint)\)/);
    expect(rule).not.toMatch(/color:#[0-9a-fA-F]{3,8}/);
  });

  it("keeps the status/text token hexes at the audited values (drift guard)", () => {
    expect(varValue("light", "success")).toBe("#15803d");
    expect(varValue("light", "warning")).toBe("#b45309");
    expect(varValue("light", "danger")).toBe("#dc2626");
    expect(varValue("light", "danger-strong")).toBe("#b91c1c");
    expect(varValue("light", "text-faint")).toBe("#475569");
    expect(varValue("light", "text-ghost")).toBe("#64748b");
    expect(varValue("dark", "success")).toBe("#34d399");
    expect(varValue("dark", "warning")).toBe("#fbbf24");
    expect(varValue("dark", "danger")).toBe("#f87171");
    expect(varValue("dark", "text-faint")).toBe("#94a3b8");
    expect(varValue("dark", "text-ghost")).toBe("#76808f");
  });

  it("resolves var() references inside theme blocks", () => {
    expect(varValue("dark", "accent")).toBe("var(--cyan)");
    expect(varValue("light", "danger-strong")).toBe("#b91c1c");
  });
});
