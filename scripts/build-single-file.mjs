import * as esbuild from "esbuild";
import { execSync } from "node:child_process";
import { readFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

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
