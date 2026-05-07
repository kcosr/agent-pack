import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { AgentPackError } from "../errors.js";
import {
  appendJsonLine,
  ensureDir,
  errorMessage,
  isAlreadyExists,
  isNotFound,
  pathExists,
  readJson,
  writeJson,
} from "../fs.js";
import { resolveRuntimePaths } from "../paths.js";
import type { PackState, RuntimePaths, TaskStatus } from "../types.js";
import { derivePackStatus, taskCounts } from "./status.js";

const packStatuses = new Set(["no_tasks", "pending", "in_progress", "blocked", "completed"]);
const taskStatuses = new Set<TaskStatus>(["pending", "in_progress", "blocked", "completed"]);

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
    for (const id of Object.keys(index.packs).sort()) {
      packs.push(await this.loadPack(id));
    }
    return packs;
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
    const lockPath = path.join(this.paths.lockDir, `${name}.lock`);
    await this.acquireLock(lockPath);
    try {
      return await fn();
    } finally {
      await rm(lockPath, { recursive: true, force: true });
    }
  }

  private async acquireLock(lockPath: string): Promise<void> {
    await ensureDir(path.dirname(lockPath));
    const deadline = Date.now() + 5000;
    while (true) {
      try {
        await mkdir(lockPath);
        return;
      } catch (error) {
        if (!isAlreadyExists(error) || Date.now() > deadline) {
          throw new AgentPackError(`failed to acquire pack lock: ${lockPath}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
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
  for (const field of ["references", "skills"]) {
    if (!Array.isArray(value[field])) {
      throw new AgentPackError(`invalid pack state field '${field}': ${filePath}`);
    }
  }
  if (typeof value.status !== "string" || !packStatuses.has(value.status)) {
    throw new AgentPackError(`invalid pack state field 'status': ${filePath}`);
  }
  validateKnownPackFields(value, filePath);
  validatePackContract(value.contract, filePath);
  validateTaskCounts(value.taskCounts, filePath);
  validatePackTasks(tasks, filePath);
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

function validateTaskCounts(value: unknown, filePath: string): void {
  if (!isObject(value)) {
    throw new AgentPackError(`invalid pack state field 'taskCounts': ${filePath}`);
  }
  for (const field of ["total", "pending", "inProgress", "completed", "blocked"]) {
    if (!Number.isInteger(value[field]) || Number(value[field]) < 0) {
      throw new AgentPackError(`invalid pack taskCounts field '${field}': ${filePath}`);
    }
  }
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
  }
}

function validateRequiredString(value: unknown, label: string, filePath: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new AgentPackError(`invalid pack task field '${label}': ${filePath}`);
  }
}

function validateOptionalString(value: unknown, label: string, filePath: string): void {
  if (value !== undefined && (typeof value !== "string" || !value.trim())) {
    throw new AgentPackError(`invalid pack task field '${label}': ${filePath}`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
