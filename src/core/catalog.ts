import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { AgentPackError } from "./errors.js";
import { pathExists } from "./fs.js";
import type { CatalogEntry, CatalogType, RuntimePaths } from "./types.js";

const catalogLayouts: Record<CatalogType, { dir: string; suffix: string; fileName?: string }> = {
  manifest: { dir: "manifests", suffix: ".yaml" },
  task: { dir: "tasks", suffix: ".yaml" },
  reference: { dir: "references", suffix: ".yaml" },
  skill: { dir: "skills", suffix: "", fileName: "SKILL.md" },
};

export function catalogPath(type: CatalogType, name: string, paths: RuntimePaths): string {
  assertCatalogName(name);
  const layout = catalogLayouts[type];
  const base = path.join(paths.configDir, layout.dir, ...name.split("/"));
  return layout.fileName ? path.join(base, layout.fileName) : `${base}${layout.suffix}`;
}

export async function resolveCatalogPath(
  type: CatalogType,
  name: string,
  paths: RuntimePaths,
): Promise<string> {
  const candidate = catalogPath(type, name, paths);
  if (!(await pathExists(candidate))) {
    throw new AgentPackError(catalogNotFoundMessage(type, name, candidate));
  }
  return candidate;
}

export async function listCatalogEntries(
  paths: RuntimePaths,
  type?: CatalogType,
): Promise<CatalogEntry[]> {
  const types: CatalogType[] = type ? [type] : ["manifest", "task", "reference", "skill"];
  await Promise.all(
    types.map((entryType) => mkdir(catalogRoot(paths, entryType), { recursive: true })),
  );
  const entries = (
    await Promise.all(types.map(async (entryType) => listCatalogType(paths, entryType)))
  ).flat();
  return entries.sort((left, right) =>
    `${left.type}/${left.name}`.localeCompare(`${right.type}/${right.name}`),
  );
}

export async function readCatalogEntry(
  type: CatalogType,
  name: string,
  paths: RuntimePaths,
): Promise<{ path: string; content: string }> {
  const entryPath = await resolveCatalogPath(type, name, paths);
  return { path: entryPath, content: await readFile(entryPath, "utf8") };
}

function assertCatalogName(name: string): void {
  const segments = name.split("/");
  if (
    !name ||
    name.startsWith("/") ||
    name.includes("\\") ||
    segments.some((segment) => !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(segment))
  ) {
    throw new AgentPackError(
      `invalid catalog ref: ${name}; use names like code-review or review/security, or prefix local paths with ./, ../, ~/, or /`,
    );
  }
}

function catalogNotFoundMessage(type: CatalogType, name: string, candidate: string): string {
  return [
    `catalog ${type} not found: ${name}`,
    "Searched:",
    `- ${candidate}`,
    "Use ./, ../, ~/, or / for local filesystem paths.",
  ].join("\n");
}

async function listCatalogType(paths: RuntimePaths, type: CatalogType): Promise<CatalogEntry[]> {
  const root = catalogRoot(paths, type);
  if (!(await pathExists(root))) {
    return [];
  }
  const files = await walkFiles(root);
  return files
    .filter((file) => isCatalogFile(type, file))
    .map((file) => ({
      type,
      name: catalogNameForFile(type, root, file),
      path: file,
    }));
}

function catalogRoot(paths: RuntimePaths, type: CatalogType): string {
  return path.join(paths.configDir, catalogLayouts[type].dir);
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return walkFiles(absPath);
      }
      return entry.isFile() ? [absPath] : [];
    }),
  );
  return files.flat();
}

function isCatalogFile(type: CatalogType, filePath: string): boolean {
  const layout = catalogLayouts[type];
  if (layout.fileName) {
    return path.basename(filePath) === layout.fileName;
  }
  return filePath.endsWith(layout.suffix);
}

function catalogNameForFile(type: CatalogType, root: string, filePath: string): string {
  const layout = catalogLayouts[type];
  const rel = path.relative(root, filePath).replaceAll("\\", "/");
  if (layout.fileName) {
    return path.posix.dirname(rel);
  }
  return rel.slice(0, -layout.suffix.length);
}
