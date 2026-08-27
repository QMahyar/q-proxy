#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname ?? ".", "..");

function run(cmd) {
  return execSync(cmd, { encoding: "utf8", cwd: root }).trim();
}

function pickConfig() {
  const wranglerToml = "wrangler.toml";
  const localToml = "wrangler.local.toml";
  const hasLocal = existsSync(resolve(root, localToml));
  const wranglerContent = existsSync(resolve(root, wranglerToml)) ? readFileSync(resolve(root, wranglerToml), "utf8") : "";
  const localContent = hasLocal ? readFileSync(resolve(root, localToml), "utf8") : "";
  const wranglerValid = wranglerContent && !wranglerContent.includes("REPLACE_WITH_YOUR_KV_ID");
  const localValid = hasLocal && !localContent.includes("REPLACE_WITH_YOUR_KV_ID");
  if (localValid) return localToml;
  if (wranglerValid) return wranglerToml;
  return null;
}

const config = pickConfig();
if (!config) {
  console.error("[post-deploy] No valid wrangler config found (both have placeholder).");
  console.error("  Run: npm run setup   or   npx wrangler kv namespace create QPROXY_KV");
  process.exit(1);
}

let workerUrl = process.argv[2] || process.env.WORKER_URL || "";
if (workerUrl && !workerUrl.startsWith("http")) workerUrl = `https://${workerUrl}`;
if (workerUrl) console.log(`[post-deploy] Using Worker URL: ${workerUrl}`);

if (!workerUrl) {
  console.log("[post-deploy] No Worker URL given, trying to discover via wrangler deployments...");
  try {
    const out = run(`npx wrangler deployments list --config ${config} 2>&1 || npx wrangler deploy --dry-run --config ${config} 2>&1`);
    const m = out.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev[^\s"']*/i) || out.match(/https:\/\/[^\s]+\.workers\.dev/);
    if (m) {
      workerUrl = m[0].replace(/\/$/, "");
      console.log(`[post-deploy] Discovered Worker URL: ${workerUrl}`);
    }
  } catch {}
}

if (!workerUrl) {
  console.log("[post-deploy] Could not auto-discover Worker URL.");
  console.log("  Pass it as arg: node scripts/post-deploy.mjs https://q-proxy.xxx.workers.dev");
  console.log("  Or set WORKER_URL env var.");
  console.log("  Falling back to KV read without seeding fetch (may show empty if not yet seeded)...");
} else {
  console.log(`\n[post-deploy] Seeding ${workerUrl}/ ...`);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${workerUrl}/`, { signal: ctrl.signal, headers: { "User-Agent": "q-proxy/post-deploy" } });
    clearTimeout(t);
    console.log(`[post-deploy] Seed fetch: ${res.status} ${res.statusText}`);
    await res.text().catch(() => {});
  } catch (e) {
    console.warn(`[post-deploy] Seed fetch failed (KV may still seed on next visit): ${String(e.message).slice(0, 200)}`);
  }
  await new Promise((r) => setTimeout(r, 1500));
}

console.log(`\n[post-deploy] Reading qproxy:settings from KV (binding QPROXY_KV, config ${config})...`);
let raw;
try {
  raw = run(`npx wrangler kv key get "qproxy:settings" --binding=QPROXY_KV --remote --config ${config}`);
} catch (e) {
  console.error("[post-deploy] KV read failed:");
  console.error(String(e.message).slice(0, 800));
  console.error("\nTry: npx wrangler kv key get \"qproxy:settings\" --binding=QPROXY_KV --remote --config " + config);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  console.error("[post-deploy] KV value is not JSON, raw:");
  console.error(raw.slice(0, 800));
  process.exit(1);
}

const sp = parsed?.data?.securePath || parsed?.securePath || "";
const hostname = parsed?.data?.hostnameOverride || "";
if (!sp) {
  console.error("[post-deploy] securePath not found in KV. Raw keys:", Object.keys(parsed).join(", "));
  console.error(raw.slice(0, 1000));
  process.exit(1);
}

const base = workerUrl || `https://<your-worker>.workers.dev`;
if (!workerUrl) console.log(`[post-deploy] (base URL unknown, showing placeholder base)`);
console.log("\n" + "=".repeat(62));
console.log("  Q Proxy is live");
console.log("=".repeat(62));
console.log(`  Panel:        ${base}/${sp}/panel`);
console.log(`  Login:        ${base}/${sp}/login`);
console.log(`  Subscription: ${base}/${sp}/sub`);
console.log(`  Clash:        ${base}/${sp}/sub?target=clash`);
console.log(`  sing-box:     ${base}/${sp}/sub?target=singbox`);
console.log(`  WARP:         ${base}/${sp}/sub/wg/<token>/wireguard-conf`);
console.log(`  My IP:        ${base}/${sp}/my-ip`);
console.log("");
console.log(`  securePath: ${sp}`);
if (hostname) console.log(`  hostnameOverride: ${hostname}`);
console.log("=".repeat(62));
console.log("\nNext: open the Panel URL and set a password (8+ chars, letter + digit).");
console.log("Keep the full https://<host>/<sp> URL — rotating the path invalidates clients.");
