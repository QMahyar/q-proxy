import * as esbuild from "esbuild";
import { execSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

function gitVersion() {
  try {
    return execSync("git describe --tags --abbrev=0", { encoding: "utf8", cwd: root }).trim().replace(/^v/, "");
  } catch {
    return null;
  }
}

const tagVersion = gitVersion();
if (tagVersion !== null && tagVersion !== pkg.version) {
  console.error(`version drift: package.json ${pkg.version} != git tag v${tagVersion}`);
  console.error("fix with: npm version <value>  (or move the tag)");
  process.exit(1);
}
const version = tagVersion ?? pkg.version;

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
console.log(`dist/q-proxy.js written (${result.metafile.outputs["dist/q-proxy.js"]?.bytes ?? "?"} bytes)`);
