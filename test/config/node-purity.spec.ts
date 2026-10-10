import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function listSrcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listSrcFiles(full));
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

const NODE_IMPORT = /(?:from\s*|import\s*\(|require\s*\()\s*["']node:/;

describe("config/node-purity", () => {
  it("keeps worker src free of node: imports (tests/config use test/node-shim.d.ts instead)", () => {
    const offenders: string[] = [];
    for (const file of listSrcFiles(join(process.cwd(), "src"))) {
      if (file.endsWith(".d.ts")) continue;
      if (NODE_IMPORT.test(readFileSync(file, "utf8"))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps global compiler types scoped to workers-types", () => {
    const tsconfig = JSON.parse(readFileSync(join(process.cwd(), "tsconfig.json"), "utf8")) as {
      compilerOptions?: { types?: string[] };
    };
    expect(tsconfig.compilerOptions?.types ?? []).not.toContain("node");
  });
});
