#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

execSync("node scripts/build-single-file.mjs", { stdio: "inherit" });
const config = existsSync("wrangler.local.toml") ? "wrangler.local.toml" : "wrangler.toml";
console.log(`wrangler deploy --config ${config}`);
execSync(`npx wrangler deploy --config ${config}`, { stdio: "inherit" });
