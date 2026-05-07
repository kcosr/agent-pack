import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { AgentPackError } from "../errors.js";
import { ensureDir, errorMessage, isAlreadyExists, pathExists } from "../fs.js";
import type { GitRefresh, GitSourceInfo, RuntimePaths, SourceInfo } from "../types.js";
import { parseGitRef, repoHash, sanitizeGitUrl } from "./ref.js";

export interface MaterializedGitRef {
  source: GitSourceInfo;
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
  const sourceUrl = sanitizeGitUrl(parsed.url);
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
      url: sourceUrl,
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
  if (source.kind !== "git") {
    return;
  }
  const mirrorPath = path.join(paths.gitCacheDir, source.repoHash, "mirror.git");
  await ensureMirror(source.url, mirrorPath, refresh);
  await ensureSnapshot(mirrorPath, source.resolvedCommit, gitSnapshotRoot(source, paths));
}

export function gitSnapshotRoot(source: GitSourceInfo, paths: RuntimePaths): string {
  return path.join(paths.cacheDir, "snapshots", source.repoHash, source.resolvedCommit);
}

export function gitSourceTargetPath(
  source: GitSourceInfo,
  paths: RuntimePaths,
): { absPath: string; displayPath: string } {
  const root = gitSnapshotRoot(source, paths);
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
    runGit(["clone", "--mirror", "--", url, mirrorPath]);
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
      const commit = gitOutput([
        "--git-dir",
        mirrorPath,
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${candidate}^{commit}`,
      ]);
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
  const tempDir = `${snapshotRootAbs}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  const tarPath = `${tempDir}.tar`;
  await rm(tempDir, { recursive: true, force: true });
  await rm(tarPath, { force: true });
  await ensureDir(tempDir);
  try {
    validateArchiveTree(mirrorPath, commit);
    runGit(["--git-dir", mirrorPath, "archive", "--format=tar", "--output", tarPath, "--", commit]);
    validateTarEntries(tarPath);
    try {
      execFileSync("tar", ["-xf", tarPath, "-C", tempDir, "--no-same-owner"], { stdio: "pipe" });
    } catch (error) {
      throw new AgentPackError(`failed to extract git archive: ${errorMessage(error)}`);
    }
    await stat(tempDir);
    try {
      await rename(tempDir, snapshotRootAbs);
    } catch (error) {
      if (isDestinationRace(error) && (await pathExists(snapshotRootAbs))) {
        return;
      }
      throw new AgentPackError(`failed to materialize git snapshot: ${errorMessage(error)}`);
    }
  } finally {
    await rm(tarPath, { force: true });
    await rm(tempDir, { recursive: true, force: true });
  }
}

function isDestinationRace(error: unknown): boolean {
  return (
    isAlreadyExists(error) ||
    (typeof error === "object" && error !== null && "code" in error && error.code === "ENOTEMPTY")
  );
}

function validateArchiveTree(mirrorPath: string, commit: string): void {
  const output = gitOutputBuffer(["--git-dir", mirrorPath, "ls-tree", "-rz", commit]);
  for (const rawEntry of output.toString("utf8").split("\0")) {
    if (!rawEntry) {
      continue;
    }
    const [metadata, filePath] = rawEntry.split("\t");
    if (!metadata || !filePath) {
      throw new AgentPackError("unexpected git tree entry while materializing snapshot");
    }
    if (metadata.startsWith("120000 ")) {
      throw new AgentPackError(`git snapshot contains unsupported symlink: ${filePath}`);
    }
    if (path.posix.isAbsolute(filePath) || filePath.split("/").includes("..")) {
      throw new AgentPackError(`git snapshot contains unsafe path: ${filePath}`);
    }
  }
}

function validateTarEntries(tarPath: string): void {
  let listing: string;
  try {
    listing = execFileSync("tar", ["-tvf", tarPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new AgentPackError(`failed to inspect git archive: ${errorMessage(error)}`);
  }
  for (const line of listing.split("\n")) {
    if (!line) {
      continue;
    }
    if (/^[lh]/.test(line)) {
      throw new AgentPackError("git archive contains unsupported link entries");
    }
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

function gitOutputBuffer(args: string[]): Buffer {
  try {
    return execFileSync("git", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
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
