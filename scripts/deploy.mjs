#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

execSync("node scripts/build-single-file.mjs", { stdio: "inherit" });
const config = existsSync("wrangler.local.toml") ? "wrangler.local.toml" : "wrangler.toml";
const content = readFileSync(config, "utf8");
if (content.includes("REPLACE_WITH_YOUR_KV_ID")) {
  console.error(`\n[deploy] ${config} still contains REPLACE_WITH_YOUR_KV_ID.`);
  console.error("[deploy] Create a KV namespace first:");
  console.error("  npx wrangler kv namespace create QPROXY_KV");
  console.error("  # copy the returned id into wrangler.toml");
  console.error("  # or run: npm run setup  (automated)");
  process.exit(1);
}
console.log(`wrangler deploy --config ${config}`);
execSync(`npx wrangler deploy --config ${config}`, { stdio: "inherit" });
