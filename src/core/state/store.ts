import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { AgentPackError } from "../errors.js";
import {
  appendJsonLine,
  ensureDir,
  errorMessage,
  isNotFound,
  pathExists,
  readJson,
  writeJson,
} from "../fs.js";
import { lockNamespace, withDirectoryLock } from "../lock.js";
import { resolveRuntimePaths } from "../paths.js";
import type { PackState, RuntimePaths, TaskCounts, TaskStatus } from "../types.js";
import { derivePackStatus, taskCounts } from "./status.js";

const packStatuses = new Set(["no_tasks", "pending", "in_progress", "blocked", "completed"]);
const taskStatuses = new Set<TaskStatus>(["pending", "in_progress", "blocked", "completed"]);
const taskFields = new Set([
  "id",
  "sourceId",
  "title",
  "category",
  "body",
  "doneWhen",
  "status",
  "notes",
  "source",
  "startedAt",
  "completedAt",
  "blockedAt",
]);
const referenceFields = new Set([
  "id",
  "name",
  "description",
  "source",
  "path",
  "rootPath",
  "files",
]);
const skillFields = new Set(["id", "name", "description", "source", "path"]);
const fileSourceFields = new Set(["kind", "path"]);
const urlSourceFields = new Set(["kind", "url"]);
const taskCountFields = new Set(["total", "pending", "inProgress", "completed", "blocked"]);
const gitSourceFields = new Set([
  "kind",
  "url",
  "requestedRef",
  "resolvedRef",
  "resolvedCommit",
  "repoHash",
  "path",
]);

export interface PackIndexEntry {
  id: string;
  name?: string;
  status: string;
  updatedAt: string;
  path: string;
}

export interface PackIndex {
  schemaVersion: 1;
  packs: Record<string, PackIndexEntry>;
}

export class StateStore {
  readonly paths: RuntimePaths;

  constructor(options: { cwd?: string; stateDir?: string } = {}) {
    this.paths = resolveRuntimePaths(options);
  }

  async ensure(): Promise<void> {
    await ensureDir(this.paths.packDir);
    await ensureDir(this.paths.eventDir);
    await ensureDir(this.paths.lockDir);
  }

  packPath(id: string): string {
    return path.join(this.paths.packDir, `${id}.json`);
  }

  eventPath(id: string): string {
    return path.join(this.paths.eventDir, `${id}.jsonl`);
  }

  async loadIndex(): Promise<PackIndex> {
    return validateIndex(
      await readJson<unknown>(this.paths.indexPath, { schemaVersion: 1, packs: {} }),
      this.paths.indexPath,
    );
  }

  async saveIndex(index: PackIndex): Promise<void> {
    await this.withLock("index", () => writeJson(this.paths.indexPath, index));
  }

  async listPacks(): Promise<PackState[]> {
    const index = await this.loadIndex();
    const packs: PackState[] = [];
    for (const id of await this.packIds(index)) {
      if (!(await pathExists(this.packPath(id)))) {
        continue;
      }
      packs.push(await this.loadPack(id));
    }
    return packs;
  }

  private async packIds(index: PackIndex): Promise<string[]> {
    const ids = new Set(Object.keys(index.packs));
    const entries = await readdir(this.paths.packDir).catch((error) => {
      if (isNotFound(error)) {
        return [];
      }
      throw new AgentPackError(
        `failed to list pack directory ${this.paths.packDir}: ${errorMessage(error)}`,
      );
    });
    for (const entry of entries) {
      if (entry.endsWith(".json")) {
        ids.add(entry.slice(0, -".json".length));
      }
    }
    return [...ids].sort();
  }

  async loadPack(id?: string): Promise<PackState> {
    const packId = assertValidPackId(id ?? process.env.AGENT_PACK_ID);
    const filePath = this.packPath(packId);
    try {
      return validatePack(JSON.parse(await readFile(filePath, "utf8")), filePath);
    } catch (error) {
      if (isNotFound(error)) {
        throw new AgentPackError(`pack not found: ${packId}`);
      }
      if (error instanceof AgentPackError) {
        throw error;
      }
      throw new AgentPackError(`failed to read pack ${packId}: ${errorMessage(error)}`);
    }
  }

  async createPack(pack: PackState): Promise<void> {
    await this.ensure();
    await this.withPackLock(pack.id, async () => {
      if (await pathExists(this.packPath(pack.id))) {
        throw new AgentPackError(`pack already exists: ${pack.id}`);
      }
      await this.savePackUnlocked(pack, "pack.created");
    });
  }

  async savePack(pack: PackState, eventType?: string, eventData: unknown = {}): Promise<void> {
    await this.withPackLock(pack.id, () => this.savePackUnlocked(pack, eventType, eventData));
  }

  async updatePack(
    id: string | undefined,
    mutator: (pack: PackState) => void | Promise<void>,
    eventType?: string,
    eventData: unknown = {},
  ): Promise<PackState> {
    const packId = assertValidPackId(id ?? process.env.AGENT_PACK_ID);
    return this.withPackLock(packId, async () => {
      const pack = await this.loadPack(packId);
      await mutator(pack);
      await this.savePackUnlocked(pack, eventType, eventData);
      return pack;
    });
  }

  private async savePackUnlocked(
    pack: PackState,
    eventType?: string,
    eventData: unknown = {},
  ): Promise<void> {
    await this.ensure();
    const now = new Date().toISOString();
    pack.updatedAt = eventType === "pack.created" ? pack.updatedAt : now;
    pack.taskCounts = taskCounts(pack.tasks);
    pack.status = derivePackStatus(pack.tasks);
    const packId = assertValidPackId(pack.id);
    await writeJson(this.packPath(packId), pack);
    await this.withLock("index", async () => {
      const index = await this.loadIndex();
      index.packs[packId] = {
        id: packId,
        name: pack.name,
        status: pack.status,
        updatedAt: pack.updatedAt,
        path: path.relative(this.paths.repoRoot, this.packPath(packId)),
      };
      await writeJson(this.paths.indexPath, index);
    });
    if (eventType) {
      await appendJsonLine(this.eventPath(packId), {
        type: eventType,
        packId,
        at: now,
        data: eventData,
      });
    }
  }

  private async withPackLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    return this.withLock(`pack-${assertValidPackId(id)}`, fn);
  }

  private async withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return withDirectoryLock(
      this.paths.lockDir,
      `${lockNamespace(this.paths.stateDir)}-${name}`,
      fn,
    );
  }
}

export function assertValidPackId(id: string | undefined): string {
  if (!id) {
    throw new AgentPackError("pack id is required; pass --id or set AGENT_PACK_ID");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
    throw new AgentPackError(`invalid pack id: ${id}`);
  }
  return id;
}

function validateIndex(value: unknown, filePath: string): PackIndex {
  if (!isObject(value) || value.schemaVersion !== 1 || !isObject(value.packs)) {
    throw new AgentPackError(`invalid pack index schema: ${filePath}`);
  }
  return value as unknown as PackIndex;
}

function validatePack(value: unknown, filePath: string): PackState {
  if (!isObject(value)) {
    throw new AgentPackError(`invalid pack state: ${filePath}`);
  }
  if (value.schemaVersion !== 1) {
    throw new AgentPackError(
      `pack schemaVersion ${String(value.schemaVersion)} is not supported: ${filePath}`,
    );
  }
  for (const field of ["id", "createdAt", "updatedAt", "repoRoot"]) {
    if (typeof value[field] !== "string") {
      throw new AgentPackError(`invalid pack state field '${field}': ${filePath}`);
    }
  }
  for (const field of ["name", "prompt", "instructions"]) {
    validateOptionalPackString(value[field], field, filePath);
  }
  const tasks = value.tasks;
  if (!Array.isArray(tasks)) {
    throw new AgentPackError(`invalid pack state field 'tasks': ${filePath}`);
  }
  const references = value.references;
  if (!Array.isArray(references)) {
    throw new AgentPackError(`invalid pack state field 'references': ${filePath}`);
  }
  const skills = value.skills;
  if (!Array.isArray(skills)) {
    throw new AgentPackError(`invalid pack state field 'skills': ${filePath}`);
  }
  if (typeof value.status !== "string" || !packStatuses.has(value.status)) {
    throw new AgentPackError(`invalid pack state field 'status': ${filePath}`);
  }
  validateKnownPackFields(value, filePath);
  validatePackContract(value.contract, filePath);
  const counts = validateTaskCounts(value.taskCounts, filePath);
  validatePackTasks(tasks, filePath);
  validatePackReferences(references, filePath);
  validatePackSkills(skills, filePath);
  const expectedCounts = taskCounts(value.tasks as PackState["tasks"]);
  if (JSON.stringify(counts) !== JSON.stringify(expectedCounts)) {
    throw new AgentPackError(`invalid pack state field 'taskCounts': ${filePath}`);
  }
  if (value.status !== derivePackStatus(value.tasks as PackState["tasks"])) {
    throw new AgentPackError(`invalid pack state field 'status': ${filePath}`);
  }
  return value as unknown as PackState;
}

function validateKnownPackFields(value: Record<string, unknown>, filePath: string): void {
  const allowed = new Set([
    "schemaVersion",
    "id",
    "name",
    "status",
    "createdAt",
    "updatedAt",
    "repoRoot",
    "prompt",
    "instructions",
    "taskCounts",
    "tasks",
    "references",
    "skills",
    "contract",
  ]);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      throw new AgentPackError(`unsupported pack state field '${field}': ${filePath}`);
    }
  }
}

function validatePackContract(value: unknown, filePath: string): void {
  if (value === undefined) {
    return;
  }
  if (!isObject(value)) {
    throw new AgentPackError(`invalid pack state field 'contract': ${filePath}`);
  }
  for (const key of Object.keys(value)) {
    if (key !== "do" && key !== "dont") {
      throw new AgentPackError(`invalid pack contract field '${key}': ${filePath}`);
    }
  }
  for (const field of ["do", "dont"]) {
    const entries = value[field];
    if (
      entries !== undefined &&
      (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string"))
    ) {
      throw new AgentPackError(`invalid pack contract field '${field}': ${filePath}`);
    }
  }
}

function validateTaskCounts(value: unknown, filePath: string): TaskCounts {
  if (!isObject(value)) {
    throw new AgentPackError(`invalid pack state field 'taskCounts': ${filePath}`);
  }
  validateKnownFields(value, taskCountFields, "taskCounts", filePath);
  for (const field of ["total", "pending", "inProgress", "completed", "blocked"]) {
    if (!Number.isInteger(value[field]) || Number(value[field]) < 0) {
      throw new AgentPackError(`invalid pack taskCounts field '${field}': ${filePath}`);
    }
  }
  return value as unknown as TaskCounts;
}

function validateOptionalPackString(value: unknown, field: string, filePath: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new AgentPackError(`invalid pack state field '${field}': ${filePath}`);
  }
}

function validatePackTasks(value: unknown[], filePath: string): void {
  for (const [index, task] of value.entries()) {
    if (!isObject(task)) {
      throw new AgentPackError(`invalid pack task at index ${index}: ${filePath}`);
    }
    validateKnownFields(task, taskFields, `tasks[${index}]`, filePath);
    validateRequiredString(task.id, `tasks[${index}].id`, filePath);
    validateRequiredString(task.title, `tasks[${index}].title`, filePath);
    if (typeof task.status !== "string" || !taskStatuses.has(task.status as TaskStatus)) {
      throw new AgentPackError(`invalid pack task field 'tasks[${index}].status': ${filePath}`);
    }
    if (!Array.isArray(task.notes) || task.notes.some((note) => typeof note !== "string")) {
      throw new AgentPackError(`invalid pack task field 'tasks[${index}].notes': ${filePath}`);
    }
    for (const field of ["sourceId", "category", "body", "startedAt", "completedAt", "blockedAt"]) {
      validateOptionalString(task[field], `tasks[${index}].${field}`, filePath);
    }
    if (
      task.doneWhen !== undefined &&
      (!Array.isArray(task.doneWhen) || task.doneWhen.some((entry) => typeof entry !== "string"))
    ) {
      throw new AgentPackError(`invalid pack task field 'tasks[${index}].doneWhen': ${filePath}`);
    }
    if (task.source !== undefined) {
      validateSource(task.source, `tasks[${index}].source`, filePath);
    }
  }
}

function validatePackReferences(value: unknown[], filePath: string): void {
  for (const [index, reference] of value.entries()) {
    if (!isObject(reference)) {
      throw new AgentPackError(`invalid pack reference at index ${index}: ${filePath}`);
    }
    validateKnownFields(reference, referenceFields, `references[${index}]`, filePath);
    validateRequiredString(reference.id, `references[${index}].id`, filePath);
    validateRequiredString(reference.name, `references[${index}].name`, filePath);
    validateOptionalString(reference.description, `references[${index}].description`, filePath);
    validateSource(reference.source, `references[${index}].source`, filePath);
    const locationCount =
      Number(reference.path !== undefined) +
      Number(reference.rootPath !== undefined) +
      Number(reference.files !== undefined);
    if (locationCount !== 1) {
      throw new AgentPackError(`invalid pack reference location at index ${index}: ${filePath}`);
    }
    validateOptionalString(reference.path, `references[${index}].path`, filePath);
    validateOptionalString(reference.rootPath, `references[${index}].rootPath`, filePath);
    if (
      reference.files !== undefined &&
      (!Array.isArray(reference.files) ||
        reference.files.some((entry) => typeof entry !== "string"))
    ) {
      throw new AgentPackError(
        `invalid pack reference field 'references[${index}].files': ${filePath}`,
      );
    }
  }
}

function validatePackSkills(value: unknown[], filePath: string): void {
  for (const [index, skill] of value.entries()) {
    if (!isObject(skill)) {
      throw new AgentPackError(`invalid pack skill at index ${index}: ${filePath}`);
    }
    validateKnownFields(skill, skillFields, `skills[${index}]`, filePath);
    validateRequiredString(skill.id, `skills[${index}].id`, filePath);
    validateRequiredString(skill.name, `skills[${index}].name`, filePath);
    validateOptionalString(skill.description, `skills[${index}].description`, filePath);
    validateRequiredString(skill.path, `skills[${index}].path`, filePath);
    validateSource(skill.source, `skills[${index}].source`, filePath);
  }
}

function validateSource(value: unknown, label: string, filePath: string): void {
  if (!isObject(value)) {
    throw new AgentPackError(`invalid pack source field '${label}': ${filePath}`);
  }
  if (
    value.kind !== "file" &&
    value.kind !== "directory" &&
    value.kind !== "glob" &&
    value.kind !== "git" &&
    value.kind !== "url"
  ) {
    throw new AgentPackError(`invalid pack source field '${label}.kind': ${filePath}`);
  }
  if (value.kind === "git") {
    validateKnownFields(value, gitSourceFields, label, filePath);
    validateRequiredString(value.url, `${label}.url`, filePath);
    validateRequiredString(value.resolvedRef, `${label}.resolvedRef`, filePath);
    validateRequiredString(value.resolvedCommit, `${label}.resolvedCommit`, filePath);
    validateRequiredString(value.repoHash, `${label}.repoHash`, filePath);
    validateOptionalString(value.requestedRef, `${label}.requestedRef`, filePath);
    validateOptionalString(value.path, `${label}.path`, filePath);
    return;
  }
  if (value.kind === "url") {
    validateKnownFields(value, urlSourceFields, label, filePath);
    const sourceUrl = value.url;
    validateRequiredString(sourceUrl, `${label}.url`, filePath);
    validateHttpUrl(sourceUrl, `${label}.url`, filePath);
    return;
  }
  validateKnownFields(value, fileSourceFields, label, filePath);
  validateRequiredString(value.path, `${label}.path`, filePath);
}

function validateHttpUrl(value: string, label: string, filePath: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AgentPackError(`invalid pack state field '${label}': ${filePath}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AgentPackError(`invalid pack state field '${label}': ${filePath}`);
  }
  if (url.username || url.password) {
    throw new AgentPackError(`invalid pack state field '${label}': ${filePath}`);
  }
}

function validateRequiredString(
  value: unknown,
  label: string,
  filePath: string,
): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AgentPackError(`invalid pack state field '${label}': ${filePath}`);
  }
}

function validateOptionalString(value: unknown, label: string, filePath: string): void {
  if (value !== undefined && (typeof value !== "string" || !value.trim())) {
    throw new AgentPackError(`invalid pack state field '${label}': ${filePath}`);
  }
}

function validateKnownFields(
  value: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
  filePath: string,
): void {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      throw new AgentPackError(`unsupported pack state field '${label}.${field}': ${filePath}`);
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
