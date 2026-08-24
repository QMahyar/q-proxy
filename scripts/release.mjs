#!/usr/bin/env node
import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

function git(args) {
  try {
    return execSync(`git ${args}`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const version = process.argv[2];
const dry = process.argv.includes("--dry");

if (version === undefined || !/^v?\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error("usage: node scripts/release.mjs <version> [--dry]   e.g. node scripts/release.mjs v1.0.1");
  process.exit(1);
}
const tag = version.startsWith("v") ? version : `v${version}`;

if (git("rev-parse --git-dir").length === 0) {
  console.error("not a git repository");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
if (!dry && pkg.version !== tag.slice(1)) {
  console.error(`package.json version ${pkg.version} != tag ${tag} — bump package.json first`);
  process.exit(1);
}

const changelog = readFileSync(new URL("../docs/CHANGELOG.md", import.meta.url), "utf8");
if (!changelog.includes(`## ${tag.slice(1)}`)) {
  console.error(`docs/CHANGELOG.md has no entry for ${tag.slice(1)} — add it before tagging`);
  process.exit(1);
}

console.log(`release ${tag}`);
for (const cmd of ["npm run typecheck", "npm test", "npm run build"]) {
  if (dry) { console.log(`[dry] ${cmd}`); continue; }
  const r = spawnSync(cmd, { shell: true, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`${cmd} failed — release aborted`);
    process.exit(1);
  }
}

if (dry) {
  console.log("[dry] would commit + tag " + tag);
  process.exit(0);
}

const dirty = git("status --porcelain");
if (dirty.length > 0) {
  execSync("git add -A", { stdio: "inherit" });
  execSync(`git commit -m "release: ${tag}"`, { stdio: "inherit" });
}
execSync(`git tag -a ${tag} -m "Release ${tag}"`, { stdio: "inherit" });
console.log(`tagged ${tag} — push with: git push origin master --tags`);
