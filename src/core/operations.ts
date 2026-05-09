import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { renderBrief, renderSummary } from "./brief/render.js";
import { listCatalogEntries, readCatalogEntry, resolveCatalogPath } from "./catalog.js";
import { AgentPackError } from "./errors.js";
import { errorMessage, pathExists } from "./fs.js";
import {
  ensureGitSourceSnapshot,
  gitSnapshotRoot,
  gitSourceTargetPath,
  materializeGitRef,
  withGitCacheLock,
} from "./git/cache.js";
import { isGitRef, parseGitRef } from "./git/ref.js";
import { readInstructions, readManifest } from "./manifest/parse.js";
import { isExplicitPathRef, resolveInputPath, toDisplayPath } from "./paths.js";
import { fileGlobOptions, hasGlobMagic } from "./sources/glob.js";
import { resolveReferences, resolveSkills } from "./sources/resolve.js";
import { StateStore, assertValidPackId } from "./state/store.js";
import { formatTaskId } from "./tasks/id.js";
import { loadTasks } from "./tasks/load.js";
import type { TaskInput } from "./tasks/load.js";
import type {
  CatalogEntry,
  CatalogType,
  CleanResult,
  GitRefresh,
  GitSourceInfo,
  InitInput,
  ManifestReference,
  ManifestSkill,
  PackContract,
  PackManifest,
  PackReference,
  PackSkill,
  PackState,
  PackTask,
  RuntimePaths,
  SourceInfo,
  SystemStatus,
  TaskStatus,
} from "./types.js";

export async function initPack(input: InitInput): Promise<PackState> {
  const store = new StateStore({ stateDir: input.stateDir });
  const paths = store.paths;
  const taskInputs: TaskInput[] = [];
  const referenceRefs: ManifestReference[] = [];
  const skillRefs: ManifestSkill[] = [];
  const instructions: string[] = [];
  let name = input.name;
  let contract: PackContract | undefined;

  for (const include of input.includes) {
    switch (include.type) {
      case "manifest": {
        const { manifest, source: manifestSource } = await readManifestRef(
          include.ref,
          paths,
          input.gitRefresh,
        );
        name ??= manifest.name;
        if (manifest.instructions) {
          instructions.push(manifest.instructions);
        }
        taskInputs.push(...manifestTaskInputs(manifest, manifestSource));
        referenceRefs.push(...manifestReferenceRefs(manifest));
        skillRefs.push(...manifestSkillRefs(manifest));
        contract = mergeContract(contract, manifest.contract);
        break;
      }
      case "instructions":
        instructions.push(await readInstructions(include.path));
        break;
      case "taskRef":
      case "adHocTask":
        taskInputs.push(include);
        break;
      case "reference":
        referenceRefs.push(include.ref);
        break;
      case "skill":
        skillRefs.push(include.ref);
        break;
      default:
        assertNever(include);
    }
  }

  const packId = await resolveInitPackId(store, input.id, name);
  const tasks = await loadTasks(taskInputs, paths, input.gitRefresh);
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
  };
  await store.createPack(pack);
  return store.loadPack(pack.id);
}

function mergeContract(
  current: PackContract | undefined,
  next: PackContract | undefined,
): PackContract | undefined {
  if (!next) {
    return current;
  }
  return {
    do: [...(current?.do ?? []), ...(next.do ?? [])],
    dont: [...(current?.dont ?? []), ...(next.dont ?? [])],
  };
}

async function resolveInitPackId(
  store: StateStore,
  explicitId: string | undefined,
  name: string | undefined,
): Promise<string> {
  if (explicitId || process.env.AGENT_PACK_ID) {
    return assertValidPackId(explicitId ?? process.env.AGENT_PACK_ID);
  }
  return generatePackId(store, slug(name ?? "pack"));
}

async function generatePackId(store: StateStore, base: string): Promise<string> {
  const trimmedBase = base.slice(0, 57).replace(/-$/g, "") || "pack";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const candidate = assertValidPackId(`${trimmedBase}-${randomSuffix()}`);
    if (!(await pathExists(store.packPath(candidate)))) {
      return candidate;
    }
  }
  throw new AgentPackError(`generated pack id already exists for ${trimmedBase}`);
}

function randomSuffix(): string {
  return randomBytes(3).toString("hex");
}

function assertNever(value: never): never {
  throw new AgentPackError(`unsupported init include: ${JSON.stringify(value)}`);
}

function manifestTaskInputs(manifest: PackManifest, source: SourceInfo): TaskInput[] {
  return (manifest.tasks ?? []).map((task) =>
    typeof task === "string"
      ? { type: "taskRef" as const, ref: task }
      : { type: "manifestTask" as const, task, source },
  );
}

function manifestReferenceRefs(manifest: PackManifest): ManifestReference[] {
  return (manifest.references ?? []).map((reference) =>
    typeof reference === "string" ? { ref: reference } : reference,
  );
}

function manifestSkillRefs(manifest: PackManifest): ManifestSkill[] {
  return (manifest.skills ?? []).map((skill) =>
    typeof skill === "string" ? { ref: skill } : skill,
  );
}

async function readManifestRef(
  ref: string,
  paths: RuntimePaths,
  refresh: GitRefresh,
): Promise<{ manifest: PackManifest; source: SourceInfo }> {
  if (!isGitRef(ref)) {
    const absPath = isExplicitPathRef(ref)
      ? resolveInputPath(ref, paths.repoRoot)
      : await resolveCatalogPath("manifest", ref, paths);
    return {
      manifest: await readManifest(absPath),
      source: { kind: "file" as const, path: toDisplayPath(absPath, paths.repoRoot) },
    };
  }
  if (!parseGitRef(ref).pathInRepo) {
    throw new AgentPackError(`git manifest source requires a file path inside the repo: ${ref}`);
  }
  const materialized = await materializeGitRef(ref, paths, refresh);
  let manifest: PackManifest;
  try {
    manifest = await readManifest(materialized.targetAbs);
  } catch (error) {
    if (error instanceof AgentPackError) {
      throw error;
    }
    throw new AgentPackError(`failed to read git manifest ${ref}: ${errorMessage(error)}`);
  }
  return {
    manifest,
    source: materialized.source,
  };
}

export async function catalogList(
  type?: CatalogType,
  options: { createDirs?: boolean } = {},
): Promise<CatalogEntry[]> {
  const store = new StateStore();
  return listCatalogEntries(store.paths, type, options);
}

export async function catalogShow(
  type: CatalogType,
  name: string,
): Promise<{ path: string; content: string }> {
  const store = new StateStore();
  return readCatalogEntry(type, name, store.paths);
}

export async function catalogPath(type: CatalogType, name: string): Promise<string> {
  const store = new StateStore();
  return resolveCatalogPath(type, name, store.paths);
}

export async function syncPack(id: string | undefined, refresh: GitRefresh): Promise<PackState> {
  const store = new StateStore();
  const pack = await store.loadPack(id);
  for (const source of gitSources(pack)) {
    await ensureGitSourceSnapshot(source, store.paths, refresh);
  }
  return pack;
}

export async function cleanCache(id?: string): Promise<CleanResult> {
  const store = new StateStore();
  const packs = id ? [await store.loadPack(id)] : await store.listPacks();
  const repoHashes = new Set<string>();
  for (const pack of packs) {
    for (const source of gitSources(pack)) {
      repoHashes.add(validGitCacheKey(source.repoHash, pack.id));
    }
  }
  const removed: string[] = [];
  for (const repoHash of [...repoHashes].sort()) {
    await withGitCacheLock(store.paths, repoHash, async () => {
      for (const target of gitCacheTargets(repoHash, store.paths)) {
        if (await pathExists(target.absPath)) {
          await rm(target.absPath, { recursive: true, force: true });
          removed.push(target.displayPath);
        }
      }
    });
  }
  return {
    packIds: packs.map((pack) => pack.id),
    repoHashes: [...repoHashes].sort(),
    removed,
  };
}

export async function brief(id?: string): Promise<string> {
  const store = new StateStore();
  const pack = await store.loadPack(id);
  await validateCachePaths(pack, store.paths);
  return renderBrief(await packWithRuntimeGitPaths(pack, store.paths), undefined, {
    includeTaskContent: briefTaskContentEnabled(),
    includePackIdInCommands: Boolean(id),
  });
}

export async function summary(id?: string): Promise<string> {
  return renderSummary(await summaryPack(id));
}

export async function summaryPack(id?: string): Promise<PackState> {
  const store = new StateStore();
  return store.loadPack(id);
}

export async function listTasks(id?: string): Promise<string> {
  const store = new StateStore();
  const pack = await store.loadPack(id);
  return `${pack.tasks.map((task) => `[${task.status}] ${task.id} - ${task.title}`).join("\n")}\n`;
}

export async function showTask(taskId: string, id?: string): Promise<PackTask> {
  const store = new StateStore();
  const pack = await store.loadPack(id);
  return getTask(pack, taskId);
}

export interface AddTaskInput {
  packId?: string;
  title: string;
  category?: string;
  body?: string;
  doneWhen?: string[];
}

export async function addTask(input: AddTaskInput): Promise<{ pack: PackState; task: PackTask }> {
  let addedTask: PackTask | undefined;
  const eventData: { taskId?: string; title?: string } = {};
  const store = new StateStore();
  const pack = await store.updatePack(
    input.packId,
    (pack) => {
      const title = requiredString(input.title, "task title");
      const category = optionalString(input.category, "task category");
      const body = optionalString(input.body, "task body");
      const doneWhenValues = input.doneWhen?.map((entry) =>
        requiredString(entry, "task done-when"),
      );
      const doneWhen = doneWhenValues?.length ? doneWhenValues : undefined;
      addedTask = {
        id: nextTaskId(pack.tasks),
        title,
        category,
        body,
        doneWhen,
        status: "pending",
        notes: [],
      };
      pack.tasks.push(addedTask);
      eventData.taskId = addedTask.id;
      eventData.title = title;
    },
    "task.added",
    eventData,
  );
  if (!addedTask) {
    throw new AgentPackError("failed to add task");
  }
  return { pack, task: addedTask };
}

export interface AddReferenceInput {
  packId?: string;
  ref: string;
  gitRefresh: GitRefresh;
}

export interface AddReferencesResult {
  pack: PackState;
  references: PackReference[];
  skipped: PackReference[];
}

export async function addReference(input: AddReferenceInput): Promise<AddReferencesResult> {
  const ref = requiredString(input.ref, "reference ref");
  const store = new StateStore();
  await store.loadPack(input.packId);
  const resolved = await resolveReferences([{ ref }], store.paths, input.gitRefresh);
  const added: PackReference[] = [];
  const skipped: PackReference[] = [];
  const eventData = {
    ref,
    addedCount: 0,
    skippedCount: 0,
    added: [] as string[],
    skipped: [] as string[],
  };
  const pack = await store.updatePack(
    input.packId,
    (pack) => {
      const existingBySource = new Map(
        pack.references.map((reference) => [sourceKey(reference.source), reference]),
      );
      let nextId = nextReferenceId(pack.references);
      for (const reference of resolved) {
        const existing = existingBySource.get(sourceKey(reference.source));
        if (existing) {
          skipped.push(existing);
          eventData.skipped.push(existing.id);
          continue;
        }
        const addedReference = { ...reference, id: formatReferenceId(nextId) };
        nextId += 1;
        pack.references.push(addedReference);
        existingBySource.set(sourceKey(addedReference.source), addedReference);
        added.push(addedReference);
        eventData.added.push(addedReference.id);
      }
      eventData.addedCount = added.length;
      eventData.skippedCount = skipped.length;
    },
    "reference.added",
    eventData,
  );
  return { pack, references: added, skipped };
}

export interface AddSkillInput {
  packId?: string;
  ref: string;
  gitRefresh: GitRefresh;
}

export interface AddSkillsResult {
  pack: PackState;
  skills: PackSkill[];
  skipped: PackSkill[];
}

export async function addSkill(input: AddSkillInput): Promise<AddSkillsResult> {
  const ref = requiredString(input.ref, "skill ref");
  const store = new StateStore();
  await store.loadPack(input.packId);
  const resolved = await resolveSkills([{ ref }], store.paths, input.gitRefresh);
  const added: PackSkill[] = [];
  const skipped: PackSkill[] = [];
  const eventData = {
    ref,
    addedCount: 0,
    skippedCount: 0,
    added: [] as string[],
    skipped: [] as string[],
  };
  const pack = await store.updatePack(
    input.packId,
    (pack) => {
      const existingBySource = new Map(
        pack.skills.map((skill) => [sourceKey(skill.source), skill]),
      );
      const usedSkillNames = skillNamesFrom(pack.skills);
      let nextId = nextSkillId(pack.skills);
      for (const skill of resolved) {
        const existing = existingBySource.get(sourceKey(skill.source));
        if (existing) {
          skipped.push(existing);
          eventData.skipped.push(existing.id);
          continue;
        }
        const addedSkill = {
          ...skill,
          id: formatSkillId(nextId),
          name: nextSkillName(skill.name, usedSkillNames),
        };
        nextId += 1;
        pack.skills.push(addedSkill);
        existingBySource.set(sourceKey(addedSkill.source), addedSkill);
        added.push(addedSkill);
        eventData.added.push(addedSkill.id);
      }
      eventData.addedCount = added.length;
      eventData.skippedCount = skipped.length;
    },
    "skill.added",
    eventData,
  );
  return { pack, skills: added, skipped };
}

export async function updateTask(
  taskId: string,
  status: TaskStatus | undefined,
  note: string | undefined,
  id?: string,
): Promise<PackState> {
  const store = new StateStore();
  return store.updatePack(
    id,
    (pack) => {
      const task = getTask(pack, taskId);
      const now = new Date().toISOString();
      if (status) {
        task.status = status;
        if (status === "in_progress") {
          task.startedAt ??= now;
          task.completedAt = undefined;
          task.blockedAt = undefined;
        }
        if (status === "completed") {
          task.completedAt = now;
          task.blockedAt = undefined;
        }
        if (status === "blocked") {
          task.blockedAt = now;
          task.completedAt = undefined;
        }
      }
      if (note?.trim()) {
        task.notes.push(`${now} ${note.trim()}`);
      }
    },
    status ? `task.${status}` : "task.note",
    { taskId, note },
  );
}

export function status(): SystemStatus {
  const store = new StateStore();
  return {
    ...store.paths,
    defaultPackId: process.env.AGENT_PACK_ID,
  };
}

export async function listPacks(): Promise<PackState[]> {
  const store = new StateStore();
  return store.listPacks();
}

export async function report(id?: string): Promise<PackState> {
  const store = new StateStore();
  return store.loadPack(id);
}

export async function validateCachePaths(pack: PackState, paths: RuntimePaths): Promise<void> {
  const sourcesByRepo = new Map<string, GitSourceInfo[]>();
  for (const reference of pack.references) {
    if (reference.source.kind === "git") {
      addGitValidationSource(sourcesByRepo, reference.source, pack.id);
    }
  }
  for (const skill of pack.skills) {
    if (skill.source.kind === "git") {
      addGitValidationSource(sourcesByRepo, skill.source, pack.id);
    }
  }
  for (const task of pack.tasks) {
    if (task.source?.kind === "git") {
      addGitValidationSource(sourcesByRepo, task.source, pack.id);
    }
  }
  const missing: string[] = [];
  for (const [repoHash, sources] of sourcesByRepo) {
    await withGitCacheLock(paths, repoHash, async () => {
      const targets = new Set(sources.map((source) => gitCacheValidationPath(source, paths)));
      const results = await Promise.all(
        [...targets].map(async (target) => ({
          target,
          exists: await existsDisplayPath(target, paths),
        })),
      );
      missing.push(...results.filter((result) => !result.exists).map((result) => result.target));
    });
  }
  if (missing.length) {
    throw new AgentPackError(
      [
        `cache material missing; run agent-pack sync --id ${pack.id}`,
        "Missing cache material:",
        ...missing.map((target) => `- ${target}`),
      ].join("\n"),
    );
  }
}

function addGitValidationSource(
  sourcesByRepo: Map<string, GitSourceInfo[]>,
  source: GitSourceInfo,
  packId: string,
): void {
  const repoHash = validGitCacheKey(source.repoHash, packId);
  sourcesByRepo.set(repoHash, [...(sourcesByRepo.get(repoHash) ?? []), source]);
}

function gitCacheValidationPath(source: GitSourceInfo, paths: RuntimePaths): string {
  if (source.path && !hasGlobMagic(source.path)) {
    return gitSourceTargetPath(source, paths).displayPath;
  }
  return toDisplayPath(gitSnapshotRoot(source, paths), paths.repoRoot);
}

function gitCacheTargets(
  repoHash: string,
  paths: RuntimePaths,
): Array<{ absPath: string; displayPath: string }> {
  const targets = [
    path.join(paths.gitCacheDir, repoHash),
    path.join(paths.cacheDir, "snapshots", repoHash),
  ];
  return targets.map((absPath) => ({
    absPath,
    displayPath: toDisplayPath(absPath, paths.repoRoot),
  }));
}

function validGitCacheKey(repoHash: string, packId: string): string {
  if (!/^[a-f0-9]{16}$/.test(repoHash)) {
    throw new AgentPackError(`invalid git cache key in pack ${packId}: ${repoHash}`);
  }
  return repoHash;
}

async function existsDisplayPath(displayPath: string, paths: RuntimePaths): Promise<boolean> {
  const abs = resolveInputPath(displayPath, paths.repoRoot);
  return pathExists(path.normalize(abs));
}

async function packWithRuntimeGitPaths(pack: PackState, paths: RuntimePaths): Promise<PackState> {
  return {
    ...pack,
    references: await Promise.all(
      pack.references.map(async (reference) => {
        if (reference.source.kind !== "git") {
          return reference;
        }
        const source = reference.source;
        return withGitCacheLock(paths, validGitCacheKey(source.repoHash, pack.id), async () => {
          const rootDisplay = toDisplayPath(gitSnapshotRoot(source, paths), paths.repoRoot);
          if (reference.files) {
            const pattern = source.path;
            if (pattern && hasGlobMagic(pattern)) {
              const matches = await fg(pattern, {
                cwd: gitSnapshotRoot(source, paths),
                ...fileGlobOptions,
              });
              return {
                ...reference,
                files: matches.map((match) => path.posix.join(rootDisplay, match)),
              };
            }
            return reference;
          }
          if (reference.rootPath) {
            return {
              ...reference,
              rootPath: gitSourceTargetPath(source, paths).displayPath,
            };
          }
          if (reference.path) {
            return {
              ...reference,
              path: gitSourceTargetPath(source, paths).displayPath,
            };
          }
          return reference;
        });
      }),
    ),
    skills: pack.skills.map((skill) =>
      skill.source.kind === "git"
        ? { ...skill, path: gitSourceTargetPath(skill.source, paths).displayPath }
        : skill,
    ),
  };
}

function getTask(pack: PackState, taskId: string): PackTask {
  const task = pack.tasks.find((entry) => entry.id === taskId);
  if (!task) {
    throw new AgentPackError(`task not found: ${taskId}`);
  }
  return task;
}

function nextTaskId(tasks: PackTask[]): string {
  const usedIds = new Set(tasks.map((task) => task.id));
  let next = 1;
  for (const task of tasks) {
    const match = /^t(\d+)$/.exec(task.id);
    if (!match) {
      continue;
    }
    next = Math.max(next, Number(match[1]) + 1);
  }
  let candidate = formatTaskId(next);
  while (usedIds.has(candidate)) {
    next += 1;
    candidate = formatTaskId(next);
  }
  return candidate;
}

function nextReferenceId(references: PackReference[]): number {
  return nextEntityNumber(
    references.map((reference) => reference.id),
    "r",
  );
}

function formatReferenceId(value: number): string {
  return `r${String(value).padStart(3, "0")}`;
}

function nextSkillId(skills: PackSkill[]): number {
  return nextEntityNumber(
    skills.map((skill) => skill.id),
    "s",
  );
}

function formatSkillId(value: number): string {
  return `s${String(value).padStart(3, "0")}`;
}

function nextEntityNumber(ids: string[], prefix: string): number {
  const usedIds = new Set(ids);
  let next = 1;
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  for (const id of ids) {
    const match = pattern.exec(id);
    if (!match) {
      continue;
    }
    next = Math.max(next, Number(match[1]) + 1);
  }
  while (usedIds.has(`${prefix}${String(next).padStart(3, "0")}`)) {
    next += 1;
  }
  return next;
}

function sourceKey(source: SourceInfo): string {
  switch (source.kind) {
    case "file":
    case "directory":
    case "glob":
      return JSON.stringify([source.kind, source.path]);
    case "url":
      return JSON.stringify([source.kind, source.url]);
    case "git":
      return JSON.stringify([
        source.kind,
        source.url,
        source.requestedRef ?? null,
        source.resolvedRef,
        source.resolvedCommit,
        source.repoHash,
        source.path ?? null,
      ]);
  }
}

function skillNamesFrom(skills: PackSkill[]): Set<string> {
  return new Set(skills.map((skill) => skill.name));
}

function nextSkillName(name: string, usedNames: Set<string>): string {
  if (!usedNames.has(name)) {
    usedNames.add(name);
    return name;
  }
  let suffix = 2;
  let candidate = `${name} (${suffix})`;
  while (usedNames.has(candidate)) {
    suffix += 1;
    candidate = `${name} (${suffix})`;
  }
  usedNames.add(candidate);
  return candidate;
}

function requiredString(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AgentPackError(`${label} must not be empty`);
  }
  return trimmed;
}

function optionalString(value: string | undefined, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requiredString(value, label);
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

function briefTaskContentEnabled(): boolean {
  const value = process.env.AGENT_PACK_BRIEF_TASK_CONTENT;
  if (!value || value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new AgentPackError(
    `invalid AGENT_PACK_BRIEF_TASK_CONTENT value: ${value}; expected true or false`,
  );
}
