import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { AgentPackError } from "../errors.js";
import type { ManifestReference, ManifestTask, PackContract, PackManifest } from "../types.js";

const manifestKeys = new Set([
  "schemaVersion",
  "name",
  "instructions",
  "tasks",
  "references",
  "skills",
  "contract",
]);
const taskKeys = new Set(["id", "title", "category", "body", "doneWhen"]);
const includeKeys = new Set(["name", "description", "ref"]);
const contractKeys = new Set(["do", "dont"]);

export async function readManifest(filePath: string): Promise<PackManifest> {
  const content = await readText(filePath, "manifest");
  const parsed = parseYaml(content, filePath);
  if (!parsed || typeof parsed !== "object") {
    throw new AgentPackError(`manifest must be a YAML object: ${filePath}`);
  }
  assertKnownKeys(parsed as Record<string, unknown>, manifestKeys, "manifest");
  validateManifest(parsed as Record<string, unknown>, filePath);
  return parsed as PackManifest;
}

export async function readInstructions(filePath: string): Promise<string> {
  return readText(filePath, "instructions");
}

export async function readTaskFile(filePath: string): Promise<ManifestTask[]> {
  const content = await readText(filePath, "task file");
  const parsed = parseYaml(content, filePath);
  if (Array.isArray(parsed)) {
    return parsed.map((task, index) => normalizeTask(task, `tasks[${index}]`));
  }
  if (parsed && typeof parsed === "object") {
    const raw = parsed as Record<string, unknown>;
    if (Array.isArray(raw.tasks)) {
      assertKnownKeys(raw, new Set(["tasks"]), "taskFile");
      return raw.tasks.map((task, index) => normalizeTask(task, `tasks[${index}]`));
    }
  }
  if (parsed && typeof parsed === "object") {
    return [normalizeTask(parsed, "task")];
  }
  throw new AgentPackError(`task file must contain a task or tasks: ${filePath}`);
}

export async function readReferenceFile(filePath: string): Promise<ManifestReference> {
  const content = await readText(filePath, "reference file");
  const parsed = parseYaml(content, filePath);
  if (isNonEmptyString(parsed)) {
    return { ref: parsed };
  }
  if (!isObject(parsed)) {
    throw new AgentPackError(`reference file must be a string or object: ${filePath}`);
  }
  assertKnownKeys(parsed, includeKeys, "reference");
  if (typeof parsed.ref !== "string" || !parsed.ref.trim()) {
    throw new AgentPackError(`reference ref must be a string: ${filePath}`);
  }
  if (parsed.name !== undefined && typeof parsed.name !== "string") {
    throw new AgentPackError(`reference name must be a string: ${filePath}`);
  }
  if (parsed.description !== undefined && typeof parsed.description !== "string") {
    throw new AgentPackError(`reference description must be a string: ${filePath}`);
  }
  return {
    name: stringValue(parsed.name),
    description: stringValue(parsed.description),
    ref: parsed.ref,
  };
}

export function normalizeTask(task: unknown, label = "task"): ManifestTask {
  if (!task || typeof task !== "object") {
    throw new AgentPackError("task must be an object");
  }
  const raw = task as Record<string, unknown>;
  assertKnownKeys(raw, taskKeys, label);
  const title = stringValue(raw.title) ?? stringValue(raw.id);
  if (!title) {
    throw new AgentPackError("task requires title or id");
  }
  if (
    raw.doneWhen !== undefined &&
    (!Array.isArray(raw.doneWhen) ||
      raw.doneWhen.some((entry) => typeof entry !== "string" || !entry.trim()))
  ) {
    throw new AgentPackError(`${label}.doneWhen must be an array of strings`);
  }
  const doneWhen = Array.isArray(raw.doneWhen)
    ? raw.doneWhen.map((entry) => String(entry))
    : undefined;
  return {
    id: stringValue(raw.id),
    title,
    category: stringValue(raw.category),
    body: stringValue(raw.body),
    doneWhen,
  };
}

export function taskTitleFromText(text: string): ManifestTask {
  if (!text.trim()) {
    throw new AgentPackError("ad hoc task text must not be empty");
  }
  return { title: text };
}

export function nameFromRef(ref: string): string {
  const clean = ref.replace(/[#?].*$/, "").replace(/\/+$/, "");
  return path.basename(clean) || clean;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function validateManifest(manifest: Record<string, unknown>, filePath: string): void {
  if (manifest.schemaVersion !== undefined && manifest.schemaVersion !== 1) {
    throw new AgentPackError(
      `manifest schemaVersion ${String(manifest.schemaVersion)} is not supported: ${filePath}`,
    );
  }
  if (manifest.name !== undefined && typeof manifest.name !== "string") {
    throw new AgentPackError(`manifest name must be a string: ${filePath}`);
  }
  if (manifest.instructions !== undefined && typeof manifest.instructions !== "string") {
    throw new AgentPackError(`manifest instructions must be a string: ${filePath}`);
  }
  validateTasks(manifest.tasks, filePath);
  validateIncludes(manifest.references, "references", filePath);
  validateIncludes(manifest.skills, "skills", filePath);
  validateContract(manifest.contract, filePath);
}

function validateTasks(value: unknown, filePath: string): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new AgentPackError(`manifest tasks must be an array: ${filePath}`);
  }
  for (const [index, task] of value.entries()) {
    if (isNonEmptyString(task)) {
      continue;
    }
    if (!isObject(task)) {
      throw new AgentPackError(`manifest tasks[${index}] must be a string or object: ${filePath}`);
    }
    assertKnownKeys(task, taskKeys, `tasks[${index}]`);
    validateTaskString(task.id, `tasks[${index}].id`, filePath);
    validateTaskString(task.title, `tasks[${index}].title`, filePath);
    validateTaskString(task.category, `tasks[${index}].category`, filePath);
    validateTaskString(task.body, `tasks[${index}].body`, filePath);
    validateStringList(task.doneWhen, `tasks[${index}].doneWhen`, filePath);
    if (task.id === undefined && task.title === undefined) {
      throw new AgentPackError(`manifest tasks[${index}] requires id or title: ${filePath}`);
    }
  }
}

function validateIncludes(value: unknown, label: "references" | "skills", filePath: string): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new AgentPackError(`manifest ${label} must be an array: ${filePath}`);
  }
  for (const [index, entry] of value.entries()) {
    if (isNonEmptyString(entry)) {
      continue;
    }
    if (!isObject(entry)) {
      throw new AgentPackError(
        `manifest ${label}[${index}] must be a string or object: ${filePath}`,
      );
    }
    assertKnownKeys(entry, includeKeys, `${label}[${index}]`);
    if (typeof entry.ref !== "string" || !entry.ref.trim()) {
      throw new AgentPackError(`manifest ${label}[${index}].ref must be a string: ${filePath}`);
    }
  }
}

function validateContract(value: unknown, filePath: string): void {
  if (value === undefined) {
    return;
  }
  if (!isObject(value)) {
    throw new AgentPackError(`manifest contract must be an object: ${filePath}`);
  }
  assertKnownKeys(value, contractKeys, "contract");
  const contract = value as PackContract;
  validateStringList(contract.do, "contract.do", filePath);
  validateStringList(contract.dont, "contract.dont", filePath);
  if (!contract.do?.length && !contract.dont?.length) {
    throw new AgentPackError(`manifest contract requires do or dont entries: ${filePath}`);
  }
}

function validateStringList(value: unknown, label: string, filePath: string): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new AgentPackError(`manifest ${label} must be an array of strings: ${filePath}`);
  }
}

function validateTaskString(value: unknown, label: string, filePath: string): void {
  if (value !== undefined && (typeof value !== "string" || !value.trim())) {
    throw new AgentPackError(`manifest ${label} must be a string: ${filePath}`);
  }
}

function assertKnownKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new AgentPackError(`unsupported metadata field: ${label}.${key}`);
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

async function readText(filePath: string, label: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    throw new AgentPackError(`${label} not found or unreadable: ${filePath}`);
  }
}

function parseYaml(content: string, filePath: string): unknown {
  try {
    return YAML.parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AgentPackError(`malformed YAML in ${filePath}: ${detail}`);
  }
}
