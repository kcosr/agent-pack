import path from "node:path";
import fg from "fast-glob";
import { resolveCatalogPath } from "../catalog.js";
import { AgentPackError } from "../errors.js";
import { materializeGitRef } from "../git/cache.js";
import { isGitRef } from "../git/ref.js";
import { readTaskFile, taskTitleFromText } from "../manifest/parse.js";
import { isExplicitPathRef, resolveInputPath, toDisplayPath } from "../paths.js";
import { fileGlobOptions, hasGlobMagic } from "../sources/glob.js";
import type {
  GitRefresh,
  InitInclude,
  ManifestTask,
  PackTask,
  RuntimePaths,
  SourceInfo,
} from "../types.js";
import { formatTaskId } from "./id.js";

export type TaskInput =
  | { type: "manifestTask"; task: ManifestTask; source: SourceInfo }
  | Extract<InitInclude, { type: "taskRef" | "adHocTask" }>;

export async function loadTasks(
  inputs: TaskInput[],
  paths: RuntimePaths,
  refresh: GitRefresh,
): Promise<PackTask[]> {
  const tasks: Array<{ task: ManifestTask; source?: SourceInfo }> = [];
  for (const input of inputs) {
    switch (input.type) {
      case "taskRef":
        tasks.push(...(await loadTaskRef(input.ref, paths, refresh)));
        break;
      case "adHocTask":
        tasks.push({ task: taskTitleFromText(input.text) });
        break;
      case "manifestTask":
        tasks.push({ task: input.task, source: input.source });
        break;
      default:
        assertNever(input);
    }
  }
  return tasks.map(({ task, source }, index) => ({
    id: formatTaskId(index + 1),
    sourceId: task.id,
    title: task.title ?? task.id ?? `Task ${index + 1}`,
    category: task.category,
    body: task.body,
    doneWhen: task.doneWhen,
    when: task.when,
    status: "pending",
    notes: [],
    activation: "active",
    source,
  }));
}

function assertNever(value: never): never {
  throw new AgentPackError(`unsupported task input: ${JSON.stringify(value)}`);
}

async function loadTaskRef(
  ref: string,
  paths: RuntimePaths,
  refresh: GitRefresh,
): Promise<Array<{ task: ManifestTask; source?: SourceInfo }>> {
  if (isGitRef(ref)) {
    return loadGitTaskRef(ref, paths, refresh);
  }
  if (isExplicitPathRef(ref)) {
    return loadLocalTaskRef(ref, paths);
  }
  return loadCatalogTaskRef(ref, paths);
}

async function loadCatalogTaskRef(
  ref: string,
  paths: RuntimePaths,
): Promise<Array<{ task: ManifestTask; source?: SourceInfo }>> {
  const absPath = await resolveCatalogPath("task", ref, paths);
  const tasks = await readTaskFile(absPath);
  return tasks.map((task) => ({
    task,
    source: { kind: "file" as const, path: toDisplayPath(absPath, paths.repoRoot) },
  }));
}

async function loadLocalTaskRef(
  ref: string,
  paths: RuntimePaths,
): Promise<Array<{ task: ManifestTask; source?: SourceInfo }>> {
  const files = hasGlobMagic(ref)
    ? await fg(ref, { cwd: paths.repoRoot, ...fileGlobOptions })
    : [toDisplayPath(resolveInputPath(ref, paths.repoRoot), paths.repoRoot)];
  if (files.length === 0) {
    throw new AgentPackError(`task source matched no files: ${ref}`);
  }
  const loaded = await Promise.all(
    files.map(async (file) => {
      const absPath = resolveInputPath(file, paths.repoRoot);
      const tasks = await readTaskFile(absPath);
      return tasks.map((task) => ({
        task,
        source: { kind: "file" as const, path: toDisplayPath(absPath, paths.repoRoot) },
      }));
    }),
  );
  return loaded.flat();
}

async function loadGitTaskRef(
  ref: string,
  paths: RuntimePaths,
  refresh: GitRefresh,
): Promise<Array<{ task: ManifestTask; source?: SourceInfo }>> {
  const materialized = await materializeGitRef(ref, paths, refresh);
  if (!materialized.pathInRepo) {
    throw new AgentPackError(`git task source requires a path or glob inside the repo: ${ref}`);
  }
  const files = hasGlobMagic(materialized.pathInRepo)
    ? await fg(materialized.pathInRepo, {
        cwd: materialized.snapshotRootAbs,
        ...fileGlobOptions,
      })
    : [materialized.pathInRepo];
  if (files.length === 0) {
    throw new AgentPackError(`task source matched no files: ${ref}`);
  }
  const loaded = await Promise.all(
    files.map(async (file) => {
      const absPath = path.join(materialized.snapshotRootAbs, file);
      const tasks = await readTaskFile(absPath);
      return tasks.map((task) => ({
        task,
        source: { ...materialized.source, path: file },
      }));
    }),
  );
  return loaded.flat();
}
