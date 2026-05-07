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

export function sanitizeGitUrl(url: string): string {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url)) {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  }
  return url;
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
    validateGitUrl(raw, ref);
    validateGitRefName(requestedRef, ref);
    return { url: raw, requestedRef };
  }

  const url = raw.slice(0, separator);
  const pathInRepo = path.posix.normalize(raw.slice(separator + 2).replace(/^\/+/, ""));
  if (!url || !pathInRepo) {
    throw new AgentPackError(`invalid git reference: ${ref}`);
  }
  validateGitUrl(url, ref);
  validateGitRefName(requestedRef, ref);
  if (pathInRepo === "." || pathInRepo.startsWith("../") || pathInRepo === "..") {
    throw new AgentPackError(`git reference path escapes repository: ${ref}`);
  }
  return { url, pathInRepo, requestedRef };
}

function validateGitUrl(url: string, originalRef: string): void {
  if (!url || url.startsWith("-")) {
    throw new AgentPackError(`invalid git URL: ${originalRef}`);
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url)) {
    const scheme = url.split(":", 1)[0]?.toLowerCase();
    if (!scheme || !["file", "git", "http", "https", "ssh"].includes(scheme)) {
      throw new AgentPackError(`unsupported git URL scheme: ${originalRef}`);
    }
    return;
  }
  if (/^[^@\s]+@[^:\s]+:.+/.test(url)) {
    return;
  }
  throw new AgentPackError(`unsupported git URL: ${originalRef}`);
}

function validateGitRefName(ref: string | undefined, originalRef: string): void {
  if (!ref) {
    return;
  }
  if (ref.startsWith("-") || ref.includes("\0") || ref.includes("..")) {
    throw new AgentPackError(`invalid git ref: ${originalRef}`);
  }
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
