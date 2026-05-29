#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
let outfile = path.join("dist-bin", "agent-pack");

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--outfile") {
    const value = args[index + 1];
    if (!value) {
      throw new Error("--outfile requires a path");
    }
    outfile = value;
    index += 1;
    continue;
  }
  throw new Error(`unsupported argument: ${arg}`);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (typeof pkg.version !== "string" || !pkg.version) {
  throw new Error("package.json version must be a non-empty string");
}

mkdirSync(path.dirname(outfile), { recursive: true });

execFileSync(
  "bun",
  [
    "build",
    "--compile",
    "--define",
    `__AGENT_PACK_VERSION__=${JSON.stringify(pkg.version)}`,
    "--outfile",
    outfile,
    "src/cli/main.ts",
  ],
  { stdio: "inherit" },
);
