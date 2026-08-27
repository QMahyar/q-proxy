#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname ?? ".", "..");

execSync("node scripts/build-single-file.mjs", { stdio: "inherit", cwd: root });

const workerFile = resolve(root, "dist/_worker.js");
if (!existsSync(workerFile)) {
  console.error("dist/_worker.js not found — build failed");
  process.exit(1);
}

const projectName = process.env.PAGES_PROJECT_NAME || process.env.CF_PAGES_PROJECT_NAME || "q-proxy";
const branchInfo = existsSync(resolve(root, "wrangler.toml"))
  ? readFileSync(resolve(root, "wrangler.toml"), "utf8").includes("REPLACE_WITH_YOUR_KV_ID")
    ? " (note: wrangler.toml KV id is still placeholder — for Pages you bind KV in the dashboard, not wrangler.toml)"
    : ""
  : "";

console.log(`\n[pages deploy] project: ${projectName}${branchInfo}`);
console.log("[pages deploy] Ensure you have created a KV namespace and bound it as QPROXY_KV");
console.log("  Dashboard: Workers & Pages → your Pages project → Settings → Bindings → Add KV Namespace (QPROXY_KV)");
console.log("  See docs/DEPLOYMENT.md § Pages for details.\n");

const cmd = `npx wrangler pages deploy dist --project-name=${projectName}`;
console.log(`Running: ${cmd}`);
try {
  execSync(cmd, { stdio: "inherit", cwd: root });
} catch (e) {
  console.error("\n[pages deploy] wrangler pages deploy failed.");
  console.error("Common fixes:");
  console.error("  • npx wrangler login   (or set CLOUDFLARE_API_TOKEN)");
  console.error("  • Ensure dist/_worker.js exists (npm run build)");
  console.error("  • For a new Pages project, create it first in the dashboard, or run: npx wrangler pages project create " + projectName);
  process.exit(1);
}
console.log("\n[pages deploy] done. Visit your Pages URL once to seed, then read KV qproxy:settings → securePath.");
