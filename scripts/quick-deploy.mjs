#!/usr/bin/env node
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname ?? ".", "..");

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", cwd: root, ...opts }).trim();
}

function ask(rl, q) {
  return new Promise((res) => rl.question(q, (a) => res(a.trim())));
}

const isInteractive = process.stdin.isTTY;
const args = process.argv.slice(2);
const isPages = args.includes("--pages");
const isWorker = args.includes("--worker") || !isPages;
const isDry = args.includes("--dry");

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Q Proxy quick-deploy — one-command wizard (BPB-style)

Usage:
  npm run quick-deploy              # interactive wizard (Workers by default)
  npm run quick-deploy -- --pages   # deploy as Pages
  node scripts/quick-deploy.mjs --dry   # preview without side effects

What it does:
  1. Checks Cloudflare auth (wrangler whoami) — offers to run wrangler login
  2. Creates KV namespace QPROXY_KV (or reuses existing)
  3. Patches wrangler.toml (+ wrangler.local.toml if present)
  4. Builds dist/q-proxy.js + dist/_worker.js
  5. Deploys (Workers: wrangler deploy, Pages: wrangler pages deploy)
  6. Seeds Worker URL, reads securePath from KV, prints Panel/Sub URLs

Auth: npx wrangler login (OAuth) or CLOUDFLARE_API_TOKEN+ACCOUNT_ID or CLOUDFLARE_API_KEY+EMAIL+ACCOUNT_ID
See docs/DEPLOYMENT.md for all paths.
`);
  process.exit(0);
}

console.log("Q Proxy quick-deploy wizard");
console.log("==========================");
console.log(`Mode: ${isPages ? "Pages (wrangler pages deploy)" : "Workers (wrangler deploy)"}${isDry ? " [dry-run]" : ""}\n`);

console.log("Checking Cloudflare auth...");
let whoOk = false;
try {
  const who = run("npx wrangler whoami 2>&1");
  console.log(who.split("\n").slice(0, 4).join("\n"));
  whoOk = true;
} catch (e) {
  const msg = String(e.message || e);
  console.log(msg.slice(0, 800));
}

if (!whoOk) {
  console.log("\nNot logged in. Quick-deploy needs Cloudflare auth.");
  console.log("  Option 1 (recommended): npx wrangler login   (browser OAuth)");
  console.log("  Option 2: set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID");
  console.log("  Option 3: set CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL + CLOUDFLARE_ACCOUNT_ID (Global Key)");
  console.log("\nPre-filled token URL (create an API Token with correct permissions):");
  console.log("  https://dash.cloudflare.com/profile/api-tokens");
  console.log("  Permissions needed: Zone:Read, Account:Read, Workers Scripts:Edit, Workers KV Storage:Edit, Pages:Edit (if Pages)");
  console.log("  Or use the wizard's generated URL:");
  const perms = isPages
    ? "workers_scripts:edit,workers_kv_storage:edit,page:edit,zone:read,account:read"
    : "workers_scripts:edit,workers_kv_storage:edit,zone:read,account:read";
  console.log(`  https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${encodeURIComponent(perms)}`);

  if (isDry || !isInteractive) {
    console.log("\n[dry] would prompt for login and exit");
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = await ask(rl, "\nRun 'npx wrangler login' now? [Y/n] ");
  rl.close();
  if (ans.toLowerCase() !== "n" && ans.toLowerCase() !== "no") {
    const r = spawnSync("npx", ["wrangler", "login"], { stdio: "inherit", cwd: root });
    if (r.status !== 0) process.exit(r.status ?? 1);
    try {
      const who2 = run("npx wrangler whoami 2>&1");
      console.log(who2.split("\n").slice(0, 4).join("\n"));
      whoOk = true;
    } catch {}
  }
  if (!whoOk) {
    console.error("\nStill not authenticated. Set env vars and retry.");
    process.exit(1);
  }
}

console.log("\nChecking wrangler.toml...");
const wranglerPath = resolve(root, "wrangler.toml");
let wranglerContent = readFileSync(wranglerPath, "utf8");
let needsKv = wranglerContent.includes("REPLACE_WITH_YOUR_KV_ID");
let kvId = null;

if (!needsKv) {
  const m = wranglerContent.match(/id\s*=\s*"([a-f0-9]{32})"/i);
  if (m) kvId = m[1];
  console.log(`wrangler.toml already has KV id: ${kvId ? kvId.slice(0, 8) + "..." : "(unknown)"}`);
  if (isDry) console.log("[dry] would reuse existing KV");
} else {
  console.log("Need to create KV namespace QPROXY_KV...");
  if (isDry) {
    console.log("[dry] would run: npx wrangler kv namespace create QPROXY_KV");
    kvId = "DRY_RUN_ID_" + "0".repeat(24);
  } else {
    try {
      const out = run("npx wrangler kv namespace create QPROXY_KV");
      console.log(out);
      const idMatch = out.match(/id\s*=\s*"([a-f0-9]{32})"/i) || out.match(/"id"\s*:\s*"([a-f0-9]{32})"/i) || out.match(/([a-f0-9]{32})/);
      if (!idMatch) throw new Error("Could not parse KV id");
      kvId = idMatch[1];
      console.log(`\nCreated KV id: ${kvId}`);
    } catch (e) {
      const msg = String(e.message);
      if (msg.includes("already exists") || msg.includes("10014")) {
        console.log("\nKV namespace already exists (code 10014). Reusing...");
        try {
          const list = run("npx wrangler kv namespace list 2>&1");
          const parsed = JSON.parse(list);
          const found = parsed.find((ns) => ns.title && ns.title.toLowerCase().includes("qproxy"));
          if (found) {
            kvId = found.id;
            console.log(`Reusing KV: ${found.title} → ${kvId}`);
          } else if (parsed[0]?.id) {
            kvId = parsed[0].id;
            console.log(`Reusing first KV: ${kvId}`);
          }
        } catch {}
        if (!kvId) {
          console.error("Could not find existing KV. Create manually: npx wrangler kv namespace create QPROXY_KV");
          console.error(msg.slice(0, 800));
          process.exit(1);
        }
      } else {
        console.error("\nKV create failed:");
        console.error(msg.slice(0, 1000));
        process.exit(1);
      }
    }
    const after = wranglerContent.replace("REPLACE_WITH_YOUR_KV_ID", kvId);
    writeFileSync(wranglerPath, after, "utf8");
    console.log(`Patched wrangler.toml → ${kvId}`);

    const localPath = resolve(root, "wrangler.local.toml");
    if (existsSync(localPath)) {
      const localBefore = readFileSync(localPath, "utf8");
      if (localBefore.includes("REPLACE_WITH_YOUR_KV_ID")) {
        writeFileSync(localPath, localBefore.replace("REPLACE_WITH_YOUR_KV_ID", kvId), "utf8");
        console.log(`Patched wrangler.local.toml`);
      }
    }
  }
}

if (isDry) {
  console.log("\n[dry] would run: npm run build");
  console.log(isPages ? "[dry] would run: wrangler pages deploy dist --project-name=q-proxy" : "[dry] would run: wrangler deploy");
  console.log("[dry] would then: fetch Worker URL to seed, read KV, print Panel URL");
  process.exit(0);
}

console.log("\nBuilding...");
execSync("node scripts/build-single-file.mjs", { stdio: "inherit", cwd: root });

let workerUrl = "";
if (isPages) {
  const projectName = process.env.PAGES_PROJECT_NAME || "q-proxy";
  console.log(`\nDeploying to Pages (project: ${projectName})...`);
  console.log("Ensure KV is bound in Pages dashboard: Settings → Bindings → KV → QPROXY_KV");
  try {
    const out = run(`npx wrangler pages deploy dist --project-name=${projectName} 2>&1`);
    console.log(out);
    const m = out.match(/https:\/\/[^\s]+\.pages\.dev[^\s]*/i);
    if (m) workerUrl = m[0];
  } catch (e) {
    console.error("Pages deploy failed:");
    console.error(String(e.message).slice(0, 1000));
    process.exit(1);
  }
} else {
  console.log("\nDeploying to Workers...");
  const config = existsSync(resolve(root, "wrangler.local.toml")) && !readFileSync(resolve(root, "wrangler.local.toml"), "utf8").includes("REPLACE_WITH_YOUR_KV_ID")
    ? "wrangler.local.toml"
    : "wrangler.toml";
  if (existsSync(resolve(root, "wrangler.local.toml")) && readFileSync(resolve(root, "wrangler.local.toml"), "utf8").includes("REPLACE_WITH_YOUR_KV_ID") && !readFileSync(resolve(root, "wrangler.toml"), "utf8").includes("REPLACE_WITH_YOUR_KV_ID")) {
    console.warn(`[quick-deploy] wrangler.local.toml has placeholder — using ${config} (deploy is now smart)`);
  }
  try {
    const out = run(`npx wrangler deploy --config ${config} 2>&1`);
    console.log(out);
    const m = out.match(/https:\/\/[^\s]+\.workers\.dev[^\s]*/i);
    if (m) workerUrl = m[0].replace(/\/$/, "");
  } catch (e) {
    console.error("Deploy failed:");
    console.error(String(e.message).slice(0, 1200));
    process.exit(1);
  }
}

if (workerUrl) console.log(`\nDeployed to: ${workerUrl}`);

const postArgs = workerUrl ? ` "${workerUrl}"` : "";
console.log("\nSeeding and reading securePath...");
try {
  execSync(`node scripts/post-deploy.mjs${postArgs}`, { stdio: "inherit", cwd: root });
} catch (e) {
  console.warn("post-deploy helper failed, try manually:");
  console.warn(`  node scripts/post-deploy.mjs ${workerUrl || "https://<worker>.workers.dev"}`);
}

console.log("\nQuick-deploy done.");
