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
const push = process.argv.includes("--push");

if (version === undefined || !/^v?\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error("usage: node scripts/release.mjs <version> [--dry] [--push]   e.g. node scripts/release.mjs v1.0.1 --push");
  process.exit(1);
}

function defaultBranch() {
  const ref = git("symbolic-ref refs/remotes/origin/HEAD");
  if (ref.startsWith("refs/remotes/origin/")) return ref.replace("refs/remotes/origin/", "");
  const head = git("rev-parse --abbrev-ref HEAD");
  if (head) return head;
  return "master";
}
const tag = version.startsWith("v") ? version : `v${version}`;
if (!/^v?\d+\.\d+\.\d+$/.test(tag)) {
  console.error(`invalid tag "${tag}" — expected vX.Y.Z`);
  process.exit(1);
}

if (git("rev-parse --git-dir").length === 0) {
  console.error("not a git repository");
  process.exit(1);
}

const dirty = git("status --porcelain");
if (dirty.length > 0) {
  console.error(`worktree is dirty — commit or stash before releasing ${tag}:`);
  console.error(dirty);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
if (pkg.version !== tag.slice(1)) {
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
  console.log("[dry] would tag " + tag);
  if (push) console.log(`[dry] would push: git push origin ${defaultBranch()} --tags`);
  process.exit(0);
}

{
  const r = spawnSync("git", ["tag", "-a", tag, "-m", `Release ${tag}`], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`git tag failed (exit ${r.status ?? "unknown"})`);
    process.exit(r.status ?? 1);
  }
  if (r.error) throw r.error;
}
const branch = defaultBranch();
if (push) {
  console.log(`pushing ${tag} to origin/${branch} ...`);
  const r = spawnSync("git", ["push", "origin", branch, "--tags"], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`git push failed (exit ${r.status ?? "unknown"})`);
    process.exit(r.status ?? 1);
  }
  if (r.error) throw r.error;
  console.log(`pushed ${tag} to origin/${branch}`);
} else {
  console.log(`tagged ${tag} — push with: git push origin ${branch} --tags  (or re-run with --push)`);
}
