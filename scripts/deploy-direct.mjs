#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { execSync } from "node:child_process";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_NAME = "q-proxy";
const KV_TITLE = "q-proxy-QPROXY_KV";
const KV_BINDING = "QPROXY_KV";
const COMPAT_DATE = "2026-08-01";

function ask(rl, q) {
  return new Promise((res) => rl.question(q, (a) => res(a.trim())));
}

function isGlobalKey(token) {
  return token.startsWith("cfk_");
}

function redact(token) {
  if (!token) return "";
  if (token.length <= 8) return "***";
  return token.slice(0, 4) + "***" + token.slice(-4);
}

function authHeaders(token, email) {
  if (isGlobalKey(token)) {
    if (!email) throw new Error("Global Key requires email");
    return {
      "X-Auth-Email": email,
      "X-Auth-Key": token,
      "Content-Type": "application/json",
    };
  }
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function authHeadersNoJson(token, email) {
  if (isGlobalKey(token)) {
    return {
      "X-Auth-Email": email,
      "X-Auth-Key": token,
    };
  }
  return {
    Authorization: `Bearer ${token}`,
  };
}

async function cfFetch(url, token, email, opts = {}) {
  const headers = { ...authHeaders(token, email), ...(opts.headers || {}) };
  if (opts.body && !(opts.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (opts.body instanceof FormData) {
    delete headers["Content-Type"];
  }
  const res = await fetch(url, { ...opts, headers });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!res.ok || (json && json.success === false)) {
    const err = json?.errors?.[0]?.message || text.slice(0, 500);
    throw new Error(`CF API ${res.status}: ${err}`);
  }
  return json ?? text;
}

async function getAccountId(token, email, hint) {
  if (hint && /^[a-f0-9]{32}$/.test(hint)) return hint;
  try {
    const data = await cfFetch("https://api.cloudflare.com/client/v4/accounts", token, email);
    const accounts = data.result || [];
    if (accounts.length === 0) throw new Error("No accounts found");
    if (accounts.length === 1) return accounts[0].id;
    console.log("\nMultiple accounts found:");
    accounts.forEach((a, i) => console.log(`  ${i + 1}. ${a.name} — ${a.id}`));
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ans = await ask(rl, "Pick account number [1]: ");
    rl.close();
    const idx = parseInt(ans || "1", 10) - 1;
    return accounts[idx]?.id || accounts[0].id;
  } catch (e) {
    if (hint) return hint;
    throw e;
  }
}

async function getOrCreateKv(token, email, accountId) {
  try {
    const data = await cfFetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces`, token, email);
    const existing = (data.result || []).find((ns) => ns.title === KV_TITLE || ns.title === "QPROXY_KV" || ns.title === "q-proxy");
    if (existing) {
      console.log(`KV exists: ${existing.title} → ${existing.id}`);
      return existing.id;
    }
  } catch {}
  console.log(`Creating KV namespace "${KV_TITLE}"...`);
  const data = await cfFetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces`, token, email, {
    method: "POST",
    body: JSON.stringify({ title: KV_TITLE }),
  });
  console.log(`KV created: ${data.result.id}`);
  return data.result.id;
}

async function getSubdomain(token, email, accountId) {
  try {
    const data = await cfFetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, token, email);
    return data.result?.subdomain || null;
  } catch {
    return null;
  }
}

async function uploadWorker(token, email, accountId, kvId, scriptContent) {
  const metadata = {
    main_module: "q-proxy.js",
    compatibility_date: COMPAT_DATE,
    bindings: [
      {
        type: "kv_namespace",
        name: KV_BINDING,
        namespace_id: kvId,
      },
    ],
  };

  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("q-proxy.js", new Blob([scriptContent], { type: "application/javascript+module" }), "q-proxy.js");

  const headers = authHeadersNoJson(token, email);
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER_NAME}`, {
    method: "PUT",
    headers,
    body: form,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!res.ok || (json && json.success === false)) {
    throw new Error(`Worker upload failed ${res.status}: ${json?.errors?.[0]?.message || text.slice(0, 600)}`);
  }
  return json;
}

async function getDefaultBranchRemote() {
  try {
    const res = await fetch("https://api.github.com/repos/QMahyar/q-proxy", { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const j = await res.json();
      if (j.default_branch) return j.default_branch;
    }
  } catch {}
  return null;
}

function isValidWorkerSource(source) {
  if (source.length < 10240) return false;
  if (!source.includes("export default") && !/export\s*\{[\s\S]*\bas\s*default\b/.test(source)) return false;
  // vm.Script (classic) cannot parse ES-module export syntax. Minified esbuild
  // output uses `export{... as default}` and is valid as a module, so we accept
  // module output directly and only enforce a real parse for classic scripts.
  if (/export\s*\{[\s\S]*\bas\s*default\b/.test(source)) return true;
  try {
    new vm.Script(source, { filename: "q-proxy.js" });
    return true;
  } catch {
    return false;
  }
}

async function getWorkerScript() {
  const local = resolve(root, "dist/q-proxy.js");
  if (existsSync(local)) {
    console.log(`Using local ${local}`);
    const txt = readFileSync(local, "utf8");
    if (!isValidWorkerSource(txt)) {
      throw new Error(`Local worker ${local} failed validation (missing export default, too small, or not parseable JS)`);
    }
    return txt;
  }
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const version = pkg.version || "latest";
  const defaultBranch = await getDefaultBranchRemote();
  const branches = defaultBranch ? [defaultBranch] : [];
  if (!branches.includes("master")) branches.push("master");
  if (!branches.includes("main")) branches.push("main");
  const urls = [
    `https://github.com/QMahyar/q-proxy/releases/latest/download/q-proxy.js`,
    `https://github.com/QMahyar/q-proxy/releases/download/v${version}/q-proxy.js`,
    ...branches.map((b) => `https://raw.githubusercontent.com/QMahyar/q-proxy/${b}/dist/q-proxy.js`),
  ];
  for (const url of urls) {
    try {
      console.log(`Trying ${url}...`);
      const res = await fetch(url);
      if (res.ok) {
        const txt = await res.text();
        if (isValidWorkerSource(txt)) {
          console.log(`Downloaded ${txt.length} bytes from ${url}`);
          return txt;
        }
      }
    } catch {}
  }
  throw new Error("No worker script found. Run: npm run build  (or download q-proxy.js from Releases)");
}

function prefilledTokenUrl() {
  const perms = [
    { key: "workers_scripts", type: "edit" },
    { key: "workers_kv_storage", type: "edit" },
  ];
  const encoded = encodeURIComponent(JSON.stringify(perms));
  return `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${encoded}&name=Q%20Proxy&accountId=*&zoneId=all`;
}

function openBrowser(url) {
  try {
    const cmd =
      process.platform === "win32"
        ? `start "" "${url}"`
        : process.platform === "darwin"
          ? `open "${url}"`
          : `xdg-open "${url}"`;
    execSync(cmd, { stdio: "ignore" });
    console.log(`Opened browser: ${url}`);
  } catch {
    console.log(`Open this URL manually: ${url}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isDry = args.includes("--dry");
  const isHelp = args.includes("--help") || args.includes("-h");

  if (isHelp) {
    console.log(`
Q Proxy direct deploy — no wrangler needed

Usage:
  node scripts/deploy-direct.mjs [--dry] [--token <token>] [--email <email>] [--account-id <id>] [--password <pw>]
  npm run deploy:direct -- --dry
  CLOUDFLARE_API_TOKEN=xxx node scripts/deploy-direct.mjs
  CLOUDFLARE_API_KEY=cfk_xxx CLOUDFLARE_EMAIL=you@example.com CLOUDFLARE_ACCOUNT_ID=xxx node scripts/deploy-direct.mjs

Env:
  CLOUDFLARE_API_TOKEN           — API Token (Bearer)
  CLOUDFLARE_API_KEY             — Global Key (cfk_...)
  CLOUDFLARE_EMAIL               — required with Global Key
  CLOUDFLARE_ACCOUNT_ID          — optional, auto-detected if not given

Pre-filled token URL:
  ${prefilledTokenUrl()}

What it does:
  1. Asks for token (or reads env), detects Global vs Token
  2. Resolves account_id (auto via /accounts)
  3. Creates KV namespace QPROXY_KV (or reuses)
  4. Uploads dist/q-proxy.js via direct CF API (no wrangler)
  5. Fetches https://<worker>.workers.dev/ to seed, reads KV via API, prints Panel URL
`);
    process.exit(0);
  }

  let token = process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_KEY || process.env.CF_API_TOKEN || "";
  let email = process.env.CLOUDFLARE_EMAIL || process.env.CF_API_EMAIL || "";
  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--token" && args[i + 1]) token = args[++i];
    if (args[i] === "--email" && args[i + 1]) email = args[++i];
    if (args[i] === "--account-id" && args[i + 1]) accountId = args[++i];
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  if (!token) {
    console.log("\nNo API token found in env (CLOUDFLARE_API_TOKEN or CLOUDFLARE_API_KEY).");
    console.log("Create a token with: Workers Scripts:Edit + Workers KV Storage:Edit");
    const url = prefilledTokenUrl();
    console.log(`\nPre-filled token URL:\n  ${url}\n`);
    const openAns = await ask(rl, "Open browser to create token? [Y/n] ");
    if (openAns.toLowerCase() !== "n" && openAns.toLowerCase() !== "no") openBrowser(url);
    token = await ask(rl, "Paste API Token or Global Key (cfk_...): ");
    if (!token) {
      console.error("No token given — abort.");
      process.exit(1);
    }
  }

  if (isGlobalKey(token) && !email) {
    console.log(`\nDetected Global API Key (${redact(token)}) — needs email + account_id`);
    email = await ask(rl, "Cloudflare email: ");
    if (!email) {
      console.error("Email required for Global Key");
      process.exit(1);
    }
    if (!accountId) {
      accountId = await ask(rl, "Account ID (32 hex, from dashboard URL): ");
    }
  }

  let password = "";
  for (let i = 0; i < args.length; i++) if (args[i] === "--password" && args[i + 1]) password = args[++i];
  if (!password && process.env.QPROXY_PASSWORD) password = process.env.QPROXY_PASSWORD;

  console.log(`\nAuth: ${isGlobalKey(token) ? "Global Key" : "API Token"} ${redact(token)}${email ? ` / ${email}` : ""}`);

  if (isDry) {
    console.log(`Account ID: ${accountId || "(would auto-detect)"}`);
    console.log(`\n[dry] Would create KV "${KV_TITLE}" in ${accountId || "<accountId>"}`);
    console.log(`[dry] Would upload Worker "${WORKER_NAME}" with KV binding ${KV_BINDING}`);
    console.log(`[dry] Would fetch https://<subdomain>.workers.dev/ to seed and read securePath`);
    if (password) console.log(`[dry] Would set first password via POST /<sp>/api/auth/setup`);
    rl.close();
    process.exit(0);
  }

  try {
    accountId = await getAccountId(token, email, accountId);
    console.log(`Account ID: ${accountId}`);
  } catch (e) {
    if (!accountId) {
      console.error(`Could not resolve account_id: ${e.message}`);
      accountId = await ask(rl, "Enter Account ID manually: ");
    }
  }

  if (!password) {
    const ans = await ask(rl, "First panel password (8+ chars, letter + digit) [empty to set later in panel]: ");
    password = ans;
    if (password && password.length < 8) {
      console.error("Password too short (8+ chars)");
      process.exit(1);
    }
  }

  rl.close();

  const kvId = await getOrCreateKv(token, email, accountId);
  const script = await getWorkerScript();
  console.log(`\nUploading Worker "${WORKER_NAME}" (${Math.round(script.length / 1024)} KB) with KV ${kvId}...`);
  await uploadWorker(token, email, accountId, kvId, script);
  console.log("Worker uploaded");

  let subdomain = await getSubdomain(token, email, accountId);
  if (!subdomain) {
    console.log("Enabling workers.dev subdomain...");
    try {
      const data = await cfFetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, token, email, {
        method: "PUT",
        body: JSON.stringify({ enabled: true }),
      });
      subdomain = data.result?.subdomain;
    } catch {}
  }
  if (!subdomain) {
    try {
      const data = await cfFetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, token, email);
      subdomain = data.result?.subdomain;
    } catch {}
  }

  const workerUrl = subdomain ? `https://${WORKER_NAME}.${subdomain}.workers.dev` : `https://${WORKER_NAME}.workers.dev`;
  console.log(`\nWorker URL: ${workerUrl}`);

  console.log(`Seeding ${workerUrl}/ ...`);
  try {
    const res = await fetch(`${workerUrl}/`, { headers: { "User-Agent": "q-proxy/deploy-direct" }, signal: AbortSignal.timeout(8000) });
    console.log(`Seed: ${res.status} ${res.statusText}`);
    await res.text().catch(() => {});
  } catch (e) {
    console.warn(`Seed fetch failed: ${String(e.message).slice(0, 200)} — KV may still seed on next visit`);
  }
  // KV is eventually consistent — wait 2s for propagation before reading securePath
  await new Promise((r) => setTimeout(r, 2000));

  console.log("Reading securePath from KV via API...");
  let securePath = "";
  try {
    const headers = isGlobalKey(token) ? { "X-Auth-Email": email, "X-Auth-Key": token } : { Authorization: `Bearer ${token}` };
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvId}/values/qproxy:settings`, { headers });
    if (res.ok) {
      const txt = await res.text();
      const parsed = JSON.parse(txt);
      securePath = parsed?.data?.securePath || parsed?.securePath || "";
    } else {
      console.warn(`KV read status ${res.status}, trying alternative...`);
      const data = await cfFetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvId}/values/qproxy:settings`, token, email);
      securePath = data?.data?.securePath || "";
    }
  } catch (e) {
    console.warn(`KV read failed: ${e.message.slice(0, 300)}`);
  }

  if (!securePath) {
    console.log("\nCould not auto-read securePath (KV eventual consistency).");
    console.log(`Try manually: curl ${workerUrl}/ && then:`);
    if (isGlobalKey(token)) {
      console.log(`  curl "https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvId}/values/qproxy:settings" -H "X-Auth-Email: ${email}" -H "X-Auth-Key: ${redact(token)}"`);
    } else {
      console.log(`  curl "https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvId}/values/qproxy:settings" -H "Authorization: Bearer ${redact(token)}"`);
    }
    console.log(`Or: npx wrangler kv key get "qproxy:settings" --binding=QPROXY_KV --remote`);
    process.exit(0);
  }

  if (password) {
    console.log(`\nSetting first password...`);
    try {
      const res = await fetch(`${workerUrl}/${securePath}/api/auth/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Q-Panel": "1" },
        body: JSON.stringify({ newPassword: password }),
      });
      const txt = await res.text();
      if (txt.includes('"ok":true')) console.log("Password set");
      else console.log(`Password set response: ${txt.slice(0, 300)} (you can set it in panel)`);
    } catch (e) {
      console.log(`Password set failed (set it in panel): ${String(e.message).slice(0, 200)}`);
    }
  }

  console.log("\n" + "=".repeat(62));
  console.log("  Q Proxy is live (direct API, no wrangler)");
  console.log("=".repeat(62));
  console.log(`  Panel:        ${workerUrl}/${securePath}/panel`);
  console.log(`  Login:        ${workerUrl}/${securePath}/login`);
  console.log(`  Subscription: ${workerUrl}/${securePath}/sub`);
  console.log(`  securePath: ${securePath}`);
  console.log(`  KV: ${kvId}  Account: ${accountId}`);
  console.log("=".repeat(62));
  if (password) console.log("\nPassword already set — open Panel and log in.");
  else console.log("\nNext: open the Panel URL and set a password (8+ chars, letter + digit).");
}

main().catch((e) => {
  console.error(`\n[deploy-direct] failed: ${e.message}`);
  console.error(e.stack?.slice(0, 800) || "");
  process.exit(1);
});