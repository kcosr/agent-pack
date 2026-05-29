import path from "node:path";
import fg from "fast-glob";
import { resolveCatalogPath } from "../catalog.js";
import { AgentPackError } from "../errors.js";
import { materializeGitRef } from "../git/cache.js";
import { isGitRef } from "../git/ref.js";
import { normalizeAgent, readAgentFile } from "../manifest/parse.js";
import { isExplicitPathRef, resolveInputPath, toDisplayPath } from "../paths.js";
import { fileGlobOptions, hasGlobMagic } from "../sources/glob.js";
import type {
  GitRefresh,
  InitInclude,
  ManifestAgent,
  PackAgent,
  RuntimePaths,
  SourceInfo,
} from "../types.js";

export type AgentInput =
  | { type: "manifestAgent"; agent: ManifestAgent; source: SourceInfo }
  | Extract<InitInclude, { type: "agentRef" }>;

export async function loadAgents(
  inputs: AgentInput[],
  paths: RuntimePaths,
  refresh: GitRefresh,
): Promise<PackAgent[]> {
  const agents: PackAgent[] = [];
  for (const input of inputs) {
    switch (input.type) {
      case "agentRef":
        agents.push(...(await loadAgentRef(input.ref, paths, refresh)));
        break;
      case "manifestAgent":
        agents.push(packAgent(input.agent, input.source));
        break;
      default:
        assertNever(input);
    }
  }
  assertUniqueAgentNames(agents);
  return agents;
}

function packAgent(agent: ManifestAgent, source?: SourceInfo): PackAgent {
  const normalized = normalizeAgent(agent);
  return {
    name: normalized.name,
    command: normalized.command,
    args: normalized.args ?? [],
    timeoutSec: normalized.timeoutSec,
    maxAttempts: normalized.maxAttempts ?? 1,
    source,
  };
}

function assertNever(value: never): never {
  throw new AgentPackError(`unsupported agent input: ${JSON.stringify(value)}`);
}

async function loadAgentRef(
  ref: string,
  paths: RuntimePaths,
  refresh: GitRefresh,
): Promise<PackAgent[]> {
  if (isGitRef(ref)) {
    return loadGitAgentRef(ref, paths, refresh);
  }
  if (isExplicitPathRef(ref)) {
    return loadLocalAgentRef(ref, paths);
  }
  return loadCatalogAgentRef(ref, paths);
}

async function loadCatalogAgentRef(ref: string, paths: RuntimePaths): Promise<PackAgent[]> {
  const absPath = await resolveCatalogPath("agent", ref, paths);
  const agents = await readAgentFile(absPath, path.basename(ref));
  return agents.map((agent) =>
    packAgent(agent, { kind: "file", path: toDisplayPath(absPath, paths.repoRoot) }),
  );
}

async function loadLocalAgentRef(ref: string, paths: RuntimePaths): Promise<PackAgent[]> {
  const files = hasGlobMagic(ref)
    ? await fg(ref, { cwd: paths.repoRoot, ...fileGlobOptions })
    : [toDisplayPath(resolveInputPath(ref, paths.repoRoot), paths.repoRoot)];
  if (files.length === 0) {
    throw new AgentPackError(`agent source matched no files: ${ref}`);
  }
  const loaded = await Promise.all(
    files.map(async (file) => {
      const absPath = resolveInputPath(file, paths.repoRoot);
      const agents = await readAgentFile(absPath);
      return agents.map((agent) =>
        packAgent(agent, { kind: "file", path: toDisplayPath(absPath, paths.repoRoot) }),
      );
    }),
  );
  return loaded.flat();
}

async function loadGitAgentRef(
  ref: string,
  paths: RuntimePaths,
  refresh: GitRefresh,
): Promise<PackAgent[]> {
  const materialized = await materializeGitRef(ref, paths, refresh);
  if (!materialized.pathInRepo) {
    throw new AgentPackError(`git agent source requires a path or glob inside the repo: ${ref}`);
  }
  const files = hasGlobMagic(materialized.pathInRepo)
    ? await fg(materialized.pathInRepo, {
        cwd: materialized.snapshotRootAbs,
        ...fileGlobOptions,
      })
    : [materialized.pathInRepo];
  if (files.length === 0) {
    throw new AgentPackError(`agent source matched no files: ${ref}`);
  }
  const loaded = await Promise.all(
    files.map(async (file) => {
      const absPath = path.join(materialized.snapshotRootAbs, file);
      const agents = await readAgentFile(absPath);
      return agents.map((agent) => packAgent(agent, { ...materialized.source, path: file }));
    }),
  );
  return loaded.flat();
}

function assertUniqueAgentNames(agents: PackAgent[]): void {
  const seen = new Set<string>();
  for (const agent of agents) {
    if (seen.has(agent.name)) {
      throw new AgentPackError(`duplicate agent name "${agent.name}"`);
    }
    seen.add(agent.name);
  }
}
