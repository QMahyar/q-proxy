import { execSync } from "node:child_process";

function git(args) {
  try {
    return execSync(`git ${args}`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const tag = git("describe --tags --abbrev=0");
if (tag.length === 0) {
  console.error("no git tag found — create one with: node scripts/release.mjs <version>");
  process.exit(1);
}
console.log(tag.replace(/^v/, ""));
