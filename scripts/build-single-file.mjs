import * as esbuild from "esbuild";
import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const PANEL_DIR = resolve(root, "src/ui/panel");
const PANEL_HTML = resolve(root, "src/ui/panel.html");
const PANEL_HEAD_MARKER = "<!--panel:head-js-->";
const PANEL_CSS_MARKER = "<!--panel:css-->";
const PANEL_JS_MARKER = "<!--panel:js-->";
const PANEL_JS_ORDER = ["dict.js", "lib.js", "qr.js", "home.js", "warp.js", "users.js", "chrome.js", "settings.js", "actions.js"];

function panelPart(name) {
  const text = readFileSync(join(PANEL_DIR, name), "utf8");
  if (text.endsWith("\r\n")) return text.slice(0, -2);
  if (text.endsWith("\n")) return text.slice(0, -1);
  return text;
}

function panelSplice(shell, marker, content) {
  const at = shell.indexOf(marker);
  if (at < 0 || shell.indexOf(marker, at + marker.length) >= 0) throw new Error(`panel marker unresolved: ${marker}`);
  return shell.slice(0, at) + content + shell.slice(at + marker.length);
}

function assemblePanel() {
  const shell = readFileSync(join(PANEL_DIR, "shell.html"), "utf8");
  const eol = shell.includes("\r\n") ? "\r\n" : "\n";
  const js = PANEL_JS_ORDER.map((name) => panelPart(name)).join(eol);
  const html = panelSplice(panelSplice(panelSplice(shell, PANEL_HEAD_MARKER, panelPart("head.js")), PANEL_CSS_MARKER, panelPart("app.css")), PANEL_JS_MARKER, js);
  if (html.includes("<!--panel:")) throw new Error("panel marker left in output");
  return html;
}

function panelScriptBlocks(html) {
  const blocks = [];
  let from = 0;
  for (;;) {
    const open = html.indexOf("<script>", from);
    if (open < 0) break;
    const close = html.indexOf("</script>", open);
    if (close < 0) throw new Error("panel script tag mismatch");
    blocks.push(html.slice(open + "<script>".length, close));
    from = close + "</script>".length;
  }
  if (blocks.length === 0) throw new Error("panel script missing");
  return blocks;
}

function checkPanelScripts(html) {
  const dir = mkdtempSync(join(tmpdir(), "qproxy-panel-"));
  panelScriptBlocks(html).forEach((code, i) => {
    const file = join(dir, `panel-${i}.js`);
    writeFileSync(file, code);
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  });
}

function buildPanelHtml() {
  let html = "";
  try {
    html = assemblePanel();
  } catch (e) {
    console.error(`panel assembly failed: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  try {
    checkPanelScripts(html);
  } catch (e) {
    console.error(`panel script check failed: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  let prev = "";
  try {
    prev = readFileSync(PANEL_HTML, "utf8");
  } catch {
    prev = "";
  }
  if (prev !== html) {
    writeFileSync(PANEL_HTML, html);
    console.log(`src/ui/panel.html assembled (${Buffer.byteLength(html, "utf8")} bytes)`);
  }
  return html;
}

if (process.argv.includes("--assemble-only")) {
  process.stdout.write(buildPanelHtml());
  process.exit(0);
}

buildPanelHtml();

function git(args) {
  try {
    return execSync(`git ${args}`, { encoding: "utf8", cwd: root }).trim();
  } catch {
    return "";
  }
}

const latestTag = git("describe --tags --abbrev=0").replace(/^v/, "");
if (latestTag !== "" && latestTag !== pkg.version) {
  console.log(`building ${pkg.version} (latest tag v${latestTag})`);
}
const version = pkg.version;

const result = await esbuild.build({
  entryPoints: [resolve(root, "src/worker.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2023",
  outfile: resolve(root, "dist/q-proxy.js"),
  minify: true,
   loader: { ".html": "text" },
   define: { __APP_VERSION__: JSON.stringify(version) },
   external: ["cloudflare:*"],
   legalComments: "none",
  metafile: true,
  banner: { js: `/* Q Proxy v${version} */` },
});

const badImports = [];
for (const [path, meta] of Object.entries(result.metafile.inputs)) {
  for (const imp of meta.imports) {
    if (!imp.external || imp.kind === "dynamic-import") continue;
    if (imp.path.startsWith("cloudflare:")) continue;
    badImports.push(`${path} -> ${imp.path}`);
  }
}
if (badImports.length > 0) {
  console.error("Non-bundled runtime imports detected:");
  for (const line of badImports) console.error("  " + line);
  process.exit(1);
}

mkdirSync(resolve(root, "dist"), { recursive: true });
const bytes = result.metafile.outputs["dist/q-proxy.js"]?.bytes ?? "?";
console.log(`dist/q-proxy.js written (${bytes} bytes)`);
copyFileSync(resolve(root, "dist/q-proxy.js"), resolve(root, "dist/_worker.js"));
console.log(`dist/_worker.js written (${bytes} bytes) — Pages Advanced Mode`);
