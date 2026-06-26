#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const platformTargets = new Map([
  ["linux-x64", "bun-linux-x64"],
  ["linux-arm64", "bun-linux-arm64"],
  ["macos-arm64", "bun-darwin-arm64"],
  ["macos-x64", "bun-darwin-x64"],
]);

const args = process.argv.slice(2);
let outdir = "dist-release";
const platforms = [];

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--outdir") {
    const value = args[index + 1];
    if (!value) {
      throw new Error("--outdir requires a path");
    }
    outdir = value;
    index += 1;
    continue;
  }
  if (arg === "--platform") {
    const value = args[index + 1];
    if (!value) {
      throw new Error("--platform requires a platform");
    }
    platforms.push(value);
    index += 1;
    continue;
  }
  if (arg === "--all") {
    platforms.push(...platformTargets.keys());
    continue;
  }
  throw new Error(`unsupported argument: ${arg}`);
}

if (platforms.length === 0) {
  platforms.push(currentPlatform());
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const absoluteOutdir = path.isAbsolute(outdir) ? outdir : path.resolve(process.cwd(), outdir);
const stageParent = path.join(repoRoot, ".agent-pack", "release-stage");
const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
if (pkg.name !== "@kcosr/agent-pack") {
  throw new Error(`unexpected package name: ${pkg.name}`);
}
if (typeof pkg.version !== "string" || !pkg.version) {
  throw new Error("package.json version must be a non-empty string");
}

mkdirSync(absoluteOutdir, { recursive: true });
mkdirSync(stageParent, { recursive: true });

const uniquePlatforms = [...new Set(platforms)];
for (const platform of uniquePlatforms) {
  const target = platformTargets.get(platform);
  if (!target) {
    throw new Error(`unsupported platform: ${platform}`);
  }

  const archiveRoot = `agent-pack-${pkg.version}-${platform}`;
  const archivePath = path.join(absoluteOutdir, `${archiveRoot}.tar.gz`);
  const stage = mkdtempSync(path.join(stageParent, "package-bun-"));

  try {
    const root = path.join(stage, archiveRoot);
    mkdirSync(root, { recursive: true });

    execFileSync(
      process.execPath,
      ["scripts/build-bun.mjs", "--outfile", path.join(root, "agent-pack"), "--target", target],
      { cwd: repoRoot, stdio: "inherit" },
    );

    for (const entry of ["README.md", "LICENSE", "CHANGELOG.md", "docs", "examples", "skills"]) {
      cpSync(path.join(repoRoot, entry), path.join(root, entry), { recursive: true });
    }

    execFileSync("tar", ["-C", stage, "-czf", archivePath, archiveRoot], { stdio: "inherit" });
    console.log(archivePath);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function currentPlatform() {
  if (process.platform === "linux" && process.arch === "x64") {
    return "linux-x64";
  }
  if (process.platform === "linux" && process.arch === "arm64") {
    return "linux-arm64";
  }
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "macos-arm64";
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return "macos-x64";
  }
  throw new Error(`unsupported current platform: ${process.platform}-${process.arch}`);
}
