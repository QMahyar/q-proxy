import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
// @ts-expect-error node builtin used only while vitest evaluates this config
import { readFileSync } from "node:fs";

const htmlAsText = () => ({
  name: "html-as-text",
  enforce: "pre" as const,
  load(id: string) {
    if (!id.endsWith(".html")) return;
    const content = readFileSync(id.replace(/^\0/, ""), "utf8");
    return { code: `export default ${JSON.stringify(content)};`, map: null };
  },
});

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["test/**/*.spec.ts"],
          exclude: ["test/workers/**", "test/d1/**"],
        },
        plugins: [htmlAsText()],
      },
      {
        plugins: [
          cloudflareTest({
            main: "./src/worker.ts",
            miniflare: {
              compatibilityDate: "2026-08-01",
              compatibilityFlags: ["nodejs_compat"],
              kvNamespaces: ["QPROXY_KV"],
              d1Databases: ["QPROXY_DB"],
              modulesRules: [{ type: "Text", include: ["**/*.html"], fallthrough: true }],
            },
          }),
        ],
        test: {
          name: "workers",
          include: ["test/workers/**/*.spec.ts", "test/d1/**/*.spec.ts"],
        },
      },
    ],
  },
});
