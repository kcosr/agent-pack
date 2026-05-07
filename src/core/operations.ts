import path from "node:path";
import { renderBrief, renderSummary } from "./brief/render.js";
import { AgentPackError } from "./errors.js";
import { ensureGitSourceSnapshot, gitSourceTargetPath } from "./git/cache.js";
import { readInstructions, readManifest } from "./manifest/parse.js";
import { resolveInputPath, toDisplayPath } from "./paths.js";
import { resolveReferences, resolveSkills } from "./sources/resolve.js";
import { StateStore } from "./state/store.js";
import { loadTasks } from "./tasks/load.js";
import type {
  GitRefresh,
  InitInput,
  ManifestReference,
  ManifestSkill,
  ManifestTask,
  PackState,
  PackTask,
  TaskStatus,
} from "./types.js";

export async function initPack(input: InitInput): Promise<PackState> {
  const store = new StateStore({ stateDir: input.stateDir });
  const paths = store.paths;
  const manifestTasks: ManifestTask[] = [];
  const referenceRefs: ManifestReference[] = [];
  const skillRefs: ManifestSkill[] = [];
  const instructions: string[] = [];
  let name = input.name;
  let contract: unknown;
  let surfaceInventory: unknown[] | undefined;
  let assumptions: unknown[] | undefined;

  for (const manifestPath of input.manifests) {
    const manifest = await readManifest(manifestPath, input.strict);
    const manifestSource = {
      kind: "file" as const,
      path: toDisplayPath(resolveInputPath(manifestPath, paths.repoRoot), paths.repoRoot),
    };
    name ??= manifest.name;
    if (manifest.instructions) {
      instructions.push(manifest.instructions);
    }
    manifestTasks.push(
      ...(manifest.tasks ?? []).map((task) => ({ ...task, source: manifestSource })),
    );
    referenceRefs.push(...(manifest.references ?? []));
    skillRefs.push(...(manifest.skills ?? []));
    contract ??= manifest.contract;
    surfaceInventory ??= manifest.surfaceInventory;
    assumptions ??= manifest.assumptions;
  }

  for (const instructionFile of input.instructionFiles) {
    instructions.push(await readInstructions(instructionFile));
  }

  referenceRefs.push(...input.referenceRefs);
  skillRefs.push(...input.skillRefs);

  const packId = input.id ?? slug(name ?? "pack");
  const tasks = await loadTasks(
    input.taskRefs,
    input.adHocTasks,
    manifestTasks,
    paths,
    input.gitRefresh,
  );
  const references = await resolveReferences(referenceRefs, paths, input.gitRefresh);
  const skills = await resolveSkills(skillRefs, paths, input.gitRefresh);
  const now = new Date().toISOString();
  const pack: PackState = {
    schemaVersion: 1,
    id: packId,
    name,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    repoRoot: ".",
    prompt: input.prompt,
    instructions:
      instructions
        .map((entry) => entry.trim())
        .filter(Boolean)
        .join("\n\n") || undefined,
    taskCounts: { total: 0, pending: 0, inProgress: 0, completed: 0, blocked: 0 },
    tasks,
    references,
    skills,
    contract,
    surfaceInventory,
    assumptions,
  };
  await store.createPack(pack);
  return store.loadPack(pack.id);
}

export async function syncPack(id: string | undefined, refresh: GitRefresh): Promise<PackState> {
  const store = new StateStore();
  const pack = await store.loadPack(id);
  for (const source of gitSources(pack)) {
    await ensureGitSourceSnapshot(source, store.paths, refresh);
  }
  return pack;
}

export async function syncAll(refresh: GitRefresh): Promise<PackState[]> {
  const store = new StateStore();
  const packs = await store.listPacks();
  for (const pack of packs) {
    for (const source of gitSources(pack)) {
      await ensureGitSourceSnapshot(source, store.paths, refresh);
    }
  }
  return packs;
}

export async function brief(id?: string): Promise<string> {
  const store = new StateStore();
  const pack = await store.loadPack(id);
  await validateCachePaths(pack, store.paths);
  return renderBrief(pack);
}

export async function summary(id?: string): Promise<string> {
  const store = new StateStore();
  return renderSummary(await store.loadPack(id));
}

export async function listTasks(id?: string): Promise<string> {
  const store = new StateStore();
  const pack = await store.loadPack(id);
  return `${pack.tasks.map((task) => `[${task.status}] ${task.id} - ${task.title}`).join("\n")}\n`;
}

export async function showTask(taskId: string, id?: string): Promise<string> {
  const store = new StateStore();
  const pack = await store.loadPack(id);
  const task = getTask(pack, taskId);
  return `${JSON.stringify(task, null, 2)}\n`;
}

export async function updateTask(
  taskId: string,
  status: TaskStatus | undefined,
  note: string | undefined,
  id?: string,
): Promise<PackState> {
  const store = new StateStore();
  const pack = await store.loadPack(id);
  const task = getTask(pack, taskId);
  const now = new Date().toISOString();
  if (status) {
    task.status = status;
    if (status === "in_progress") {
      task.startedAt ??= now;
    }
    if (status === "completed") {
      task.completedAt = now;
    }
    if (status === "blocked") {
      task.blockedAt = now;
    }
  }
  if (note?.trim()) {
    task.notes.push(`${now} ${note.trim()}`);
  }
  await store.savePack(pack, status ? `task.${status}` : "task.note", { taskId, note });
  return store.loadPack(pack.id);
}

export async function status(id?: string, all = false): Promise<PackState | PackState[]> {
  const store = new StateStore();
  return all ? store.listPacks() : store.loadPack(id);
}

export async function report(id?: string): Promise<PackState> {
  const store = new StateStore();
  return store.loadPack(id);
}

export async function validateCachePaths(
  pack: PackState,
  paths: StateStore["paths"],
): Promise<void> {
  const targets = new Set<string>();
  for (const reference of pack.references) {
    for (const target of [reference.path, reference.rootPath, ...(reference.files ?? [])].filter(
      Boolean,
    )) {
      if (reference.source.kind === "git") {
        targets.add(String(target));
      }
    }
  }
  for (const skill of pack.skills) {
    if (skill.source.kind === "git") {
      targets.add(skill.path);
    }
  }
  for (const task of pack.tasks) {
    const target = gitSourceTargetPath(task.source, paths)?.displayPath;
    if (target) {
      targets.add(target);
    }
  }
  const results = await Promise.all(
    [...targets].map(async (target) => ({ target, exists: await existsDisplayPath(target) })),
  );
  const missing = results.filter((result) => !result.exists).map((result) => result.target);
  if (missing.length) {
    throw new AgentPackError(
      `cache material missing; run agent-pack sync --id ${pack.id}: ${missing.join(", ")}`,
    );
  }
}

async function existsDisplayPath(displayPath: string): Promise<boolean> {
  const { pathExists } = await import("./fs.js");
  const abs = resolveInputPath(displayPath, process.cwd());
  return pathExists(path.normalize(abs));
}

function getTask(pack: PackState, taskId: string): PackTask {
  const task = pack.tasks.find((entry) => entry.id === taskId);
  if (!task) {
    throw new AgentPackError(`task not found: ${taskId}`);
  }
  return task;
}

function gitSources(pack: PackState) {
  const sources = [
    ...pack.references.map((reference) => reference.source),
    ...pack.skills.map((skill) => skill.source),
    ...pack.tasks.flatMap((task) => (task.source ? [task.source] : [])),
  ];
  return sources.filter((source) => source.kind === "git");
}

function slug(value: string): string {
  const result = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return result || `pack-${Date.now()}`;
}
