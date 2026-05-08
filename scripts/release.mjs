#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const bump = process.argv[2];
if (!isVersionArg(bump)) {
  console.error("Usage: node scripts/release.mjs <patch|minor|major|x.y.z>");
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

function output(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

if (output("git", ["status", "--porcelain"]) !== "") {
  throw new Error("release requires a clean working tree");
}

if (output("git", ["branch", "--show-current"]) !== "main") {
  throw new Error("release must run from main");
}

run("npm", ["version", bump, "--no-git-tag-version"]);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const version = pkg.version;
if (pkg.name !== "@kcosr/agent-pack") {
  throw new Error(`unexpected package name: ${pkg.name}`);
}
if (pkg.publishConfig?.access !== "public") {
  throw new Error("package publishConfig.access must be public");
}
const changelog = readFileSync("CHANGELOG.md", "utf8");
const released = changelog.replace("## [Unreleased]", `## [${version}] - ${today}`);
if (released === changelog) {
  throw new Error("CHANGELOG.md is missing an Unreleased section");
}
writeFileSync("CHANGELOG.md", released);
run("npm", ["run", "check"]);
run("npm", ["run", "test:smoke"]);
run("npm", ["publish", "--dry-run", "--access", "public"]);
run("git", ["add", "package.json", "package-lock.json", "CHANGELOG.md"]);
run("git", ["commit", "-m", `Release v${version}`]);
run("git", ["tag", `v${version}`]);
run("npm", ["publish", "--access", "public"]);
run("git", ["push", "origin", "main"]);
run("git", ["push", "origin", `v${version}`]);
run("gh", ["release", "create", `v${version}`, "--generate-notes"]);

const next = released.replace(
  "# Changelog",
  "# Changelog\n\n## [Unreleased]\n\n### Breaking Changes\n\n### Added\n\n### Changed\n\n### Fixed\n\n### Removed",
);
writeFileSync("CHANGELOG.md", next);
run("git", ["add", "CHANGELOG.md"]);
run("git", ["commit", "-m", "Prepare for next release"]);
run("git", ["push", "origin", "main"]);

function isVersionArg(value) {
  return (
    value === "patch" ||
    value === "minor" ||
    value === "major" ||
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value ?? "")
  );
}
