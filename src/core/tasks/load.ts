import path from "node:path";
import fg from "fast-glob";
import { AgentPackError } from "../errors.js";
import { materializeGitRef } from "../git/cache.js";
import { isGitRef } from "../git/ref.js";
import { readTaskFile, taskTitleFromText } from "../manifest/parse.js";
import { resolveInputPath, toDisplayPath } from "../paths.js";
import { hasGlobMagic } from "../sources/glob.js";
import type { GitRefresh, ManifestTask, PackTask, RuntimePaths, SourceInfo } from "../types.js";

export async function loadTasks(
  taskRefs: string[],
  adHocTasks: string[],
  manifestTasks: ManifestTask[],
  paths: RuntimePaths,
  refresh: GitRefresh,
): Promise<PackTask[]> {
  const tasks: Array<{ task: ManifestTask; source?: SourceInfo }> = manifestTasks.map((task) => ({
    task,
    source: task.source,
  }));
  for (const ref of taskRefs) {
    tasks.push(...(await loadTaskRef(ref, paths, refresh)));
  }
  tasks.push(...adHocTasks.map((task) => ({ task: taskTitleFromText(task) })));
  return tasks.map(({ task, source }, index) => ({
    id: `t${String(index + 1).padStart(3, "0")}`,
    sourceId: task.id,
    title: task.title ?? task.id ?? `Task ${index + 1}`,
    category: task.category,
    body: task.body,
    doneWhen: task.doneWhen,
    status: "pending",
    notes: [],
    source,
  }));
}

async function loadTaskRef(
  ref: string,
  paths: RuntimePaths,
  refresh: GitRefresh,
): Promise<Array<{ task: ManifestTask; source?: SourceInfo }>> {
  return isGitRef(ref) ? loadGitTaskRef(ref, paths, refresh) : loadLocalTaskRef(ref, paths);
}

async function loadLocalTaskRef(
  ref: string,
  paths: RuntimePaths,
): Promise<Array<{ task: ManifestTask; source?: SourceInfo }>> {
  const files = hasGlobMagic(ref)
    ? await fg(ref, { cwd: paths.repoRoot, onlyFiles: true, dot: true, unique: true })
    : [toDisplayPath(resolveInputPath(ref, paths.repoRoot), paths.repoRoot)];
  if (files.length === 0) {
    throw new AgentPackError(`task source matched no files: ${ref}`);
  }
  const loaded: Array<{ task: ManifestTask; source?: SourceInfo }> = [];
  for (const file of files) {
    const absPath = resolveInputPath(file, paths.repoRoot);
    const tasks = await readTaskFile(absPath);
    loaded.push(
      ...tasks.map((task) => ({
        task,
        source: { kind: "file" as const, path: toDisplayPath(absPath, paths.repoRoot) },
      })),
    );
  }
  return loaded;
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
        onlyFiles: true,
        dot: true,
        unique: true,
      })
    : [materialized.pathInRepo];
  if (files.length === 0) {
    throw new AgentPackError(`task source matched no files: ${ref}`);
  }
  const loaded: Array<{ task: ManifestTask; source?: SourceInfo }> = [];
  for (const file of files) {
    const absPath = path.join(materialized.snapshotRootAbs, file);
    const tasks = await readTaskFile(absPath);
    loaded.push(
      ...tasks.map((task) => ({
        task,
        source: { ...materialized.source, path: file },
      })),
    );
  }
  return loaded;
}
