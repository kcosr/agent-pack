import { createHash } from "node:crypto";
import path from "node:path";
import { AgentPackError } from "../errors.js";

export interface GitRef {
  url: string;
  pathInRepo?: string;
  requestedRef?: string;
}

export function isGitRef(ref: string): boolean {
  return ref.startsWith("git+");
}

export function repoHash(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

export function parseGitRef(ref: string): GitRef {
  if (!isGitRef(ref)) {
    throw new AgentPackError(`not a git reference: ${ref}`);
  }
  let raw = ref.slice("git+".length);
  let requestedRef: string | undefined;
  const hashIndex = raw.lastIndexOf("#");
  if (hashIndex >= 0) {
    requestedRef = raw.slice(hashIndex + 1) || undefined;
    raw = raw.slice(0, hashIndex);
  }

  const separator = findRepoPathSeparator(raw);
  if (separator < 0) {
    return { url: raw, requestedRef };
  }

  const url = raw.slice(0, separator);
  const pathInRepo = raw.slice(separator + 2).replace(/^\/+/, "");
  if (!url || !pathInRepo) {
    throw new AgentPackError(`invalid git reference: ${ref}`);
  }
  return { url, pathInRepo: path.posix.normalize(pathInRepo), requestedRef };
}

function findRepoPathSeparator(raw: string): number {
  const gitMarker = raw.indexOf(".git//");
  if (gitMarker >= 0) {
    return gitMarker + ".git".length;
  }
  const protocolIndex = raw.indexOf("://");
  if (protocolIndex >= 0) {
    return raw.indexOf("//", protocolIndex + 3);
  }
  return raw.indexOf("//");
}
