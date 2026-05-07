import { stat } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { AgentPackError } from "../errors.js";
import { errorMessage } from "../fs.js";
import { materializeGitRef } from "../git/cache.js";
import { isGitRef } from "../git/ref.js";
import { nameFromRef } from "../manifest/parse.js";
import { resolveInputPath, toDisplayPath } from "../paths.js";
import { extractSkillMetadata } from "../skills/parse.js";
import type {
  GitRefresh,
  ManifestReference,
  ManifestSkill,
  PackReference,
  PackSkill,
  RuntimePaths,
} from "../types.js";
import { displayGlobMatch, fileGlobOptions, hasGlobMagic } from "./glob.js";

export async function resolveReferences(
  refs: ManifestReference[],
  paths: RuntimePaths,
  refresh: GitRefresh,
): Promise<PackReference[]> {
  const references: PackReference[] = [];
  for (const entry of refs) {
    const resolved = isGitRef(entry.ref)
      ? await resolveGitReference(entry, paths, refresh)
      : await resolveLocalReference(entry, paths);
    references.push({ ...resolved, id: `r${String(references.length + 1).padStart(3, "0")}` });
  }
  return references;
}

export async function resolveSkills(
  refs: ManifestSkill[],
  paths: RuntimePaths,
  refresh: GitRefresh,
): Promise<PackSkill[]> {
  const skills: PackSkill[] = [];
  for (const entry of refs) {
    const files = isGitRef(entry.ref)
      ? await resolveGitSkillFiles(entry.ref, paths, refresh)
      : await resolveLocalSkillFiles(entry.ref, paths);
    if (files.length === 0) {
      throw new AgentPackError(`skill source resolved no SKILL.md files: ${entry.ref}`);
    }
    for (const file of files) {
      const metadata = await readSkillMetadata(file.absPath, entry.ref);
      skills.push({
        id: `s${String(skills.length + 1).padStart(3, "0")}`,
        name: entry.name ?? metadata.name,
        description: entry.description ?? metadata.description,
        source: file.source,
        path: file.displayPath,
      });
    }
  }
  return disambiguateSkillNames(skills);
}

async function resolveLocalReference(
  entry: ManifestReference,
  paths: RuntimePaths,
): Promise<Omit<PackReference, "id">> {
  const name = entry.name ?? nameFromRef(entry.ref);
  if (hasGlobMagic(entry.ref)) {
    const matches = await fg(entry.ref, {
      cwd: paths.repoRoot,
      ...fileGlobOptions,
    });
    return {
      name,
      description: entry.description,
      source: { kind: "glob", path: entry.ref },
      files: matches.map(displayGlobMatch),
    };
  }

  const absPath = resolveInputPath(entry.ref, paths.repoRoot);
  const stats = await stat(absPath).catch(() => {
    throw new AgentPackError(`reference not found: ${entry.ref}`);
  });
  if (stats.isDirectory()) {
    return {
      name,
      description: entry.description,
      source: { kind: "directory", path: toDisplayPath(absPath, paths.repoRoot) },
      rootPath: toDisplayPath(absPath, paths.repoRoot),
    };
  }
  return {
    name,
    description: entry.description,
    source: { kind: "file", path: toDisplayPath(absPath, paths.repoRoot) },
    path: toDisplayPath(absPath, paths.repoRoot),
  };
}

async function resolveGitReference(
  entry: ManifestReference,
  paths: RuntimePaths,
  refresh: GitRefresh,
): Promise<Omit<PackReference, "id">> {
  const materialized = await materializeGitRef(entry.ref, paths, refresh);
  const name =
    entry.name ?? nameFromRef(materialized.pathInRepo ?? materialized.source.url ?? "repository");
  if (!materialized.pathInRepo) {
    return {
      name,
      description: entry.description,
      source: materialized.source,
      rootPath: materialized.snapshotRootDisplay,
    };
  }
  if (hasGlobMagic(materialized.pathInRepo)) {
    const matches = await fg(materialized.pathInRepo, {
      cwd: materialized.snapshotRootAbs,
      ...fileGlobOptions,
    });
    return {
      name,
      description: entry.description,
      source: materialized.source,
      files: matches.map((match) => path.posix.join(materialized.snapshotRootDisplay, match)),
    };
  }
  const stats = await stat(materialized.targetAbs).catch(() => {
    throw new AgentPackError(`git reference path not found: ${entry.ref}`);
  });
  if (stats.isDirectory()) {
    return {
      name,
      description: entry.description,
      source: materialized.source,
      rootPath: materialized.targetDisplay,
    };
  }
  return {
    name,
    description: entry.description,
    source: materialized.source,
    path: materialized.targetDisplay,
  };
}

async function resolveLocalSkillFiles(
  ref: string,
  paths: RuntimePaths,
): Promise<Array<{ absPath: string; displayPath: string; source: PackSkill["source"] }>> {
  const refs = hasGlobMagic(ref)
    ? await fg(ref, { cwd: paths.repoRoot, ...fileGlobOptions })
    : [toDisplayPath(resolveInputPath(ref, paths.repoRoot), paths.repoRoot)];
  const files = refs.filter((entry) => path.basename(entry) === "SKILL.md");
  if (!hasGlobMagic(ref) && path.basename(ref) !== "SKILL.md") {
    throw new AgentPackError(`--skill requires a SKILL.md file: ${ref}`);
  }
  const resolved: Array<{ absPath: string; displayPath: string; source: PackSkill["source"] }> = [];
  for (const displayPath of files) {
    const absPath = resolveInputPath(displayPath, paths.repoRoot);
    resolved.push({
      absPath,
      displayPath: toDisplayPath(absPath, paths.repoRoot),
      source: { kind: "file" as const, path: toDisplayPath(absPath, paths.repoRoot) },
    });
  }
  return resolved;
}

async function readSkillMetadata(filePath: string, ref: string) {
  try {
    return await extractSkillMetadata(filePath);
  } catch (error) {
    if (error instanceof AgentPackError) {
      throw error;
    }
    throw new AgentPackError(`skill file not found or unreadable: ${ref}: ${errorMessage(error)}`);
  }
}

async function resolveGitSkillFiles(
  ref: string,
  paths: RuntimePaths,
  refresh: GitRefresh,
): Promise<Array<{ absPath: string; displayPath: string; source: PackSkill["source"] }>> {
  const materialized = await materializeGitRef(ref, paths, refresh);
  if (!materialized.pathInRepo) {
    const matches = await fg("**/SKILL.md", {
      cwd: materialized.snapshotRootAbs,
      ...fileGlobOptions,
    });
    return matches.map((match) => ({
      absPath: path.join(materialized.snapshotRootAbs, match),
      displayPath: path.posix.join(materialized.snapshotRootDisplay, match),
      source: { ...materialized.source, path: match },
    }));
  }
  const matches = hasGlobMagic(materialized.pathInRepo)
    ? await fg(materialized.pathInRepo, {
        cwd: materialized.snapshotRootAbs,
        ...fileGlobOptions,
      })
    : [materialized.pathInRepo];
  return matches
    .filter((match) => path.basename(match) === "SKILL.md")
    .map((match) => ({
      absPath: path.join(materialized.snapshotRootAbs, match),
      displayPath: path.posix.join(materialized.snapshotRootDisplay, match),
      source: { ...materialized.source, path: match },
    }));
}

function disambiguateSkillNames(skills: PackSkill[]): PackSkill[] {
  const counts = new Map<string, number>();
  return skills.map((skill) => {
    const count = (counts.get(skill.name) ?? 0) + 1;
    counts.set(skill.name, count);
    return count === 1 ? skill : { ...skill, name: `${skill.name} (${count})` };
  });
}
