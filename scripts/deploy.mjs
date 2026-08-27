#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

execSync("node scripts/build-single-file.mjs", { stdio: "inherit" });

const wranglerToml = "wrangler.toml";
const localToml = "wrangler.local.toml";
const hasLocal = existsSync(localToml);
const wranglerContent = existsSync(wranglerToml) ? readFileSync(wranglerToml, "utf8") : "";
const localContent = hasLocal ? readFileSync(localToml, "utf8") : "";
const wranglerValid = wranglerContent && !wranglerContent.includes("REPLACE_WITH_YOUR_KV_ID");
const localValid = hasLocal && !localContent.includes("REPLACE_WITH_YOUR_KV_ID");

let config;
if (localValid) {
  config = localToml;
} else if (wranglerValid) {
  if (hasLocal && !localValid) {
    console.warn(`[deploy] ${localToml} still has placeholder — using ${wranglerToml} instead.`);
    console.warn(`[deploy] Fix: replace the id in ${localToml} or delete it (it's gitignored).`);
  }
  config = wranglerToml;
} else if (hasLocal) {
  config = localToml;
} else {
  config = wranglerToml;
}

const content = readFileSync(config, "utf8");
if (content.includes("REPLACE_WITH_YOUR_KV_ID")) {
  console.error(`\n[deploy] ${config} still contains REPLACE_WITH_YOUR_KV_ID.`);
  console.error("[deploy] Create a KV namespace first:");
  console.error("  npx wrangler kv namespace create QPROXY_KV");
  console.error("  # copy the returned id into wrangler.toml (or wrangler.local.toml)");
  console.error("  # or run: npm run setup  (automated, patches both files)");
  if (hasLocal && config === wranglerToml) {
    console.error(`  # note: ${localToml} exists but has placeholder — delete it or patch it`);
  }
  process.exit(1);
}
console.log(`wrangler deploy --config ${config}`);
execSync(`npx wrangler deploy --config ${config}`, { stdio: "inherit" });
