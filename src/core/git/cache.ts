import { execFileSync } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { AgentPackError } from "../errors.js";
import { ensureDir, pathExists } from "../fs.js";
import type { GitRefresh, RuntimePaths, SourceInfo } from "../types.js";
import { parseGitRef, repoHash } from "./ref.js";

export interface MaterializedGitRef {
  source: SourceInfo;
  snapshotRootAbs: string;
  snapshotRootDisplay: string;
  targetAbs: string;
  targetDisplay: string;
  pathInRepo?: string;
}

export async function materializeGitRef(
  ref: string,
  paths: RuntimePaths,
  refresh: GitRefresh,
): Promise<MaterializedGitRef> {
  const parsed = parseGitRef(ref);
  const hash = repoHash(parsed.url);
  const mirrorPath = path.join(paths.gitCacheDir, hash, "mirror.git");
  await ensureMirror(parsed.url, mirrorPath, refresh);
  const resolved = resolveCommit(mirrorPath, parsed.requestedRef);
  const snapshotRootAbs = path.join(paths.cacheDir, "snapshots", hash, resolved.commit);
  await ensureSnapshot(mirrorPath, resolved.commit, snapshotRootAbs);
  const snapshotRootDisplay = relativeFromRoot(snapshotRootAbs, paths.repoRoot);
  const targetAbs = parsed.pathInRepo
    ? path.join(snapshotRootAbs, parsed.pathInRepo)
    : snapshotRootAbs;
  return {
    source: {
      kind: "git",
      url: parsed.url,
      requestedRef: parsed.requestedRef,
      resolvedRef: resolved.ref,
      resolvedCommit: resolved.commit,
      path: parsed.pathInRepo,
      repoHash: hash,
    },
    snapshotRootAbs,
    snapshotRootDisplay,
    targetAbs,
    targetDisplay: relativeFromRoot(targetAbs, paths.repoRoot),
    pathInRepo: parsed.pathInRepo,
  };
}

export async function ensureGitSourceSnapshot(
  source: SourceInfo,
  paths: RuntimePaths,
  refresh: GitRefresh,
): Promise<void> {
  if (source.kind !== "git" || !source.url || !source.resolvedCommit) {
    return;
  }
  const hash = source.repoHash ?? repoHash(source.url);
  const mirrorPath = path.join(paths.gitCacheDir, hash, "mirror.git");
  await ensureMirror(source.url, mirrorPath, refresh);
  const snapshotRootAbs = gitSnapshotRoot(source, paths);
  if (!snapshotRootAbs) {
    return;
  }
  await ensureSnapshot(mirrorPath, source.resolvedCommit, snapshotRootAbs);
}

export function gitSnapshotRoot(source: SourceInfo, paths: RuntimePaths): string | undefined {
  if (source.kind !== "git" || !source.url || !source.resolvedCommit) {
    return undefined;
  }
  return path.join(
    paths.cacheDir,
    "snapshots",
    source.repoHash ?? repoHash(source.url),
    source.resolvedCommit,
  );
}

export function gitSourceTargetPath(
  source: SourceInfo | undefined,
  paths: RuntimePaths,
): { absPath: string; displayPath: string } | undefined {
  if (!source) {
    return undefined;
  }
  const root = gitSnapshotRoot(source, paths);
  if (!root) {
    return undefined;
  }
  const absPath = source.path ? path.join(root, source.path) : root;
  return { absPath, displayPath: relativeFromRoot(absPath, paths.repoRoot) };
}

async function ensureMirror(url: string, mirrorPath: string, refresh: GitRefresh): Promise<void> {
  const exists = await pathExists(mirrorPath);
  if (!exists) {
    if (refresh === "never") {
      throw new AgentPackError(
        `git cache missing for ${url}; rerun sync without --git-refresh never`,
      );
    }
    await ensureDir(path.dirname(mirrorPath));
    runGit(["clone", "--mirror", url, mirrorPath]);
    return;
  }
  if (refresh === "always") {
    runGit(["--git-dir", mirrorPath, "fetch", "--prune", "--tags"]);
  }
}

function resolveCommit(mirrorPath: string, requestedRef?: string): { ref: string; commit: string } {
  const ref = requestedRef ?? defaultRef(mirrorPath);
  const candidates = [ref, `refs/heads/${ref}`, `refs/tags/${ref}`];
  for (const candidate of candidates) {
    try {
      const commit = gitOutput(["--git-dir", mirrorPath, "rev-parse", `${candidate}^{commit}`]);
      return { ref, commit };
    } catch {
      // Try the next candidate.
    }
  }
  throw new AgentPackError(`git ref not found: ${ref}`);
}

function defaultRef(mirrorPath: string): string {
  try {
    const symbolic = gitOutput(["--git-dir", mirrorPath, "symbolic-ref", "HEAD"]);
    return symbolic.replace(/^refs\/heads\//, "");
  } catch {
    return "HEAD";
  }
}

async function ensureSnapshot(
  mirrorPath: string,
  commit: string,
  snapshotRootAbs: string,
): Promise<void> {
  if (await pathExists(snapshotRootAbs)) {
    return;
  }
  await ensureDir(path.dirname(snapshotRootAbs));
  const tempDir = `${snapshotRootAbs}.tmp-${process.pid}-${Date.now()}`;
  const tarPath = `${tempDir}.tar`;
  await rm(tempDir, { recursive: true, force: true });
  await rm(tarPath, { force: true });
  await ensureDir(tempDir);
  try {
    runGit(["--git-dir", mirrorPath, "archive", "--format=tar", "--output", tarPath, commit]);
    execFileSync("tar", ["-xf", tarPath, "-C", tempDir], { stdio: "pipe" });
    await stat(tempDir);
    await rm(snapshotRootAbs, { recursive: true, force: true });
    await import("node:fs/promises").then((fs) => fs.rename(tempDir, snapshotRootAbs));
  } finally {
    await rm(tarPath, { force: true });
    await rm(tempDir, { recursive: true, force: true });
  }
}

function runGit(args: string[]): void {
  try {
    execFileSync("git", args, { stdio: "pipe" });
  } catch (error) {
    throw new AgentPackError(gitErrorMessage(error));
  }
}

function gitOutput(args: string[]): string {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    throw new AgentPackError(gitErrorMessage(error));
  }
}

function gitErrorMessage(error: unknown): string {
  if (typeof error === "object" && error && "stderr" in error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr;
    const text = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : stderr;
    if (text?.trim()) {
      return text.trim();
    }
  }
  return "git command failed";
}

function relativeFromRoot(absPath: string, root: string): string {
  const rel = path.relative(root, absPath);
  return rel.startsWith("..") ? rel : `./${rel}`;
}
