import path from "node:path";
import type { RuntimePaths } from "./types.js";

export function resolveRuntimePaths(
  options: { cwd?: string; stateDir?: string } = {},
): RuntimePaths {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const repoRoot = cwd;
  const configDir = path.resolve(cwd, process.env.AGENT_PACK_CONFIG_DIR ?? defaultConfigDir(cwd));
  const stateDir = path.resolve(
    cwd,
    options.stateDir ?? process.env.AGENT_PACK_STATE_DIR ?? ".agent-pack/state",
  );
  const cacheDir = path.resolve(cwd, process.env.AGENT_PACK_CACHE_DIR ?? defaultCacheDir(cwd));
  const gitCacheDir = path.join(cacheDir, "git");
  return {
    cwd,
    repoRoot,
    configDir,
    stateDir,
    cacheDir,
    gitCacheDir,
    packDir: path.join(stateDir, "packs"),
    eventDir: path.join(stateDir, "events"),
    lockDir: path.join(cacheDir, "locks"),
    indexPath: path.join(stateDir, "index.json"),
  };
}

function defaultConfigDir(cwd: string): string {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, "agent-pack");
  }
  if (process.env.HOME) {
    return path.join(process.env.HOME, ".config", "agent-pack");
  }
  return path.resolve(cwd, ".agent-pack/config");
}

function defaultCacheDir(cwd: string): string {
  if (process.env.XDG_CACHE_HOME) {
    return path.join(process.env.XDG_CACHE_HOME, "agent-pack");
  }
  if (process.env.HOME) {
    return path.join(process.env.HOME, ".cache", "agent-pack");
  }
  return path.resolve(cwd, ".agent-pack/cache");
}

export function toDisplayPath(absPath: string, root: string): string {
  const rel = path.relative(root, absPath);
  if (!rel || rel === "") {
    return ".";
  }
  if (rel.startsWith("..")) {
    return rel;
  }
  return rel.startsWith(".") ? rel : `./${rel}`;
}

export function resolveInputPath(input: string, cwd: string): string {
  if (input.startsWith("~")) {
    return path.join(process.env.HOME ?? cwd, input.slice(1));
  }
  return path.resolve(cwd, input);
}

export function isExplicitPathRef(ref: string): boolean {
  return (
    path.isAbsolute(ref) ||
    ref.startsWith("./") ||
    ref.startsWith("../") ||
    ref === "~" ||
    ref.startsWith("~/")
  );
}
