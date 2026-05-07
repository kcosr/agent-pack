import path from "node:path";
import type { RuntimePaths } from "./types.js";

export function resolveRuntimePaths(
  options: { cwd?: string; stateDir?: string } = {},
): RuntimePaths {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const repoRoot = cwd;
  const stateDir = path.resolve(
    cwd,
    options.stateDir ?? process.env.AGENT_PACK_STATE_DIR ?? ".agent-pack/state",
  );
  const cacheDir = path.resolve(cwd, process.env.AGENT_PACK_CACHE_DIR ?? ".agent-pack/cache");
  const gitCacheDir = path.resolve(cacheDir, process.env.AGENT_PACK_GIT_CACHE_DIR ?? "git");
  return {
    cwd,
    repoRoot,
    stateDir,
    cacheDir,
    gitCacheDir,
    packDir: path.join(stateDir, "packs"),
    eventDir: path.join(stateDir, "events"),
    lockDir: path.join(path.dirname(cacheDir), "locks"),
    indexPath: path.join(stateDir, "index.json"),
  };
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
