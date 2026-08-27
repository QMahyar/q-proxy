#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname ?? ".", "..");
const wranglerPath = resolve(root, "wrangler.toml");

function run(cmd) {
  return execSync(cmd, { encoding: "utf8", cwd: root }).trim();
}

function usage() {
  console.log(`
Q Proxy setup — create KV namespace and patch wrangler.toml

Usage:
  npm run setup              # create KV namespace, patch wrangler.toml, build
  node scripts/setup.mjs --dry   # show what would run, do not execute
  node scripts/setup.mjs --help

What it does:
  1. npx wrangler whoami           — verify auth
  2. npx wrangler kv namespace create QPROXY_KV
  3. Patch wrangler.toml id = "<returned id>"
  4. npm run build                 — produce dist/q-proxy.js + dist/_worker.js

Prerequisites:
  • Cloudflare auth — one of:
      - npx wrangler login (OAuth, recommended)
      - env CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
      - env CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL + CLOUDFLARE_ACCOUNT_ID (Global Key)
  • npm install already run

After setup: npm run deploy   (or follow docs/DEPLOYMENT.md for dashboard/pages paths)
`);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}
const dry = args.includes("--dry") || args.includes("--dry-run");

if (!existsSync(wranglerPath)) {
  console.error("wrangler.toml not found at", wranglerPath);
  process.exit(1);
}

const before = readFileSync(wranglerPath, "utf8");
const alreadyPatched = !before.includes("REPLACE_WITH_YOUR_KV_ID");
if (alreadyPatched) {
  console.log("wrangler.toml already has a KV id — nothing to patch.");
  console.log("If you want to recreate the namespace, reset the id to REPLACE_WITH_YOUR_KV_ID first.");
  if (!dry) {
    console.log("\nRunning build to ensure dist is fresh...");
    execSync("node scripts/build-single-file.mjs", { stdio: "inherit", cwd: root });
  }
  process.exit(0);
}

console.log("Checking Cloudflare auth (wrangler whoami)...");
try {
  const who = run("npx wrangler whoami");
  console.log(who.split("\n").slice(0, 6).join("\n"));
} catch (e) {
  console.error("\n[setup] wrangler whoami failed — are you logged in?");
  console.error("  npx wrangler login");
  console.error("  or set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID");
  console.error(String(e.message ?? e).slice(0, 600));
  process.exit(1);
}

console.log("\nCreating KV namespace QPROXY_KV...");
if (dry) {
  console.log("[dry] would run: npx wrangler kv namespace create QPROXY_KV");
  process.exit(0);
}

let out;
try {
  out = run("npx wrangler kv namespace create QPROXY_KV");
  console.log(out);
} catch (e) {
  console.error("\n[setup] KV create failed:");
  console.error(String(e.message ?? e).slice(0, 1200));
  console.error("\nTip: if using Global API Key, ensure CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL + CLOUDFLARE_ACCOUNT_ID are set.");
  process.exit(1);
}

const idMatch = out.match(/id\s*=\s*"([a-f0-9]{32})"/i) || out.match(/"id"\s*:\s*"([a-f0-9]{32})"/i) || out.match(/([a-f0-9]{32})/);
if (!idMatch) {
  console.error("\n[setup] Could not parse KV id from output. Output was:");
  console.error(out);
  console.error("\nCopy the id manually into wrangler.toml: id = \"YOUR_ID\"");
  process.exit(1);
}
const id = idMatch[1];
console.log(`\nParsed KV id: ${id}`);

const after = before.replace("REPLACE_WITH_YOUR_KV_ID", id);
writeFileSync(wranglerPath, after, "utf8");
console.log(`Patched wrangler.toml → ${wranglerPath}`);

const localPath = resolve(root, "wrangler.local.toml");
if (existsSync(localPath)) {
  const localBefore = readFileSync(localPath, "utf8");
  if (localBefore.includes("REPLACE_WITH_YOUR_KV_ID")) {
    writeFileSync(localPath, localBefore.replace("REPLACE_WITH_YOUR_KV_ID", id), "utf8");
    console.log(`Patched wrangler.local.toml → ${localPath} (was placeholder)`);
  } else {
    console.log(`wrangler.local.toml exists and already has a KV id — left unchanged`);
    console.log(`  (deploy prefers it over wrangler.toml; ensure its id is the one you want)`);
  }
}

console.log("\nBuilding dist/q-proxy.js + dist/_worker.js...");
execSync("node scripts/build-single-file.mjs", { stdio: "inherit", cwd: root });

console.log("\n[setup] done. Next:");
console.log("  npm run deploy          # deploy as Worker");
console.log("  npm run deploy:pages    # deploy as Pages (see docs/DEPLOYMENT.md)");
console.log("  Post-deploy: visit your worker URL once to seed, read securePath from KV, open /<securePath>/panel");
