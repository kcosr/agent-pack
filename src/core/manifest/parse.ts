import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { AgentPackError } from "../errors.js";
import type { ManifestTask, PackManifest } from "../types.js";

const manifestKeys = new Set([
  "schemaVersion",
  "name",
  "instructions",
  "tasks",
  "references",
  "skills",
  "contract",
  "surfaceInventory",
  "assumptions",
]);
const taskKeys = new Set(["id", "title", "name", "category", "body", "description", "doneWhen"]);
const includeKeys = new Set(["name", "description", "ref"]);

export async function readManifest(filePath: string, strict = false): Promise<PackManifest> {
  const content = await readText(filePath, "manifest");
  const parsed = parseYaml(content, filePath);
  if (!parsed || typeof parsed !== "object") {
    throw new AgentPackError(`manifest must be a YAML object: ${filePath}`);
  }
  if (strict) {
    assertKnownKeys(parsed as Record<string, unknown>, manifestKeys, "manifest");
  }
  validateManifest(parsed as Record<string, unknown>, filePath, strict);
  return parsed as PackManifest;
}

export async function readInstructions(filePath: string): Promise<string> {
  const content = await readText(filePath, "instructions");
  if (/\.(ya?ml)$/i.test(filePath)) {
    const parsed = parseYaml(content, filePath);
    if (parsed && typeof parsed === "object") {
      const raw = parsed as Record<string, unknown>;
      if (typeof raw.instructions === "string") {
        return raw.instructions;
      }
    }
  }
  return content;
}

export async function readTaskFile(filePath: string): Promise<ManifestTask[]> {
  const content = await readText(filePath, "task file");
  const parsed = parseYaml(content, filePath);
  if (Array.isArray(parsed)) {
    return parsed.map(normalizeTask);
  }
  if (parsed && typeof parsed === "object") {
    const raw = parsed as Record<string, unknown>;
    if (Array.isArray(raw.tasks)) {
      return raw.tasks.map(normalizeTask);
    }
  }
  if (parsed && typeof parsed === "object") {
    return [normalizeTask(parsed)];
  }
  throw new AgentPackError(`task file must contain a task or tasks: ${filePath}`);
}

export function normalizeTask(task: unknown): ManifestTask {
  if (!task || typeof task !== "object") {
    throw new AgentPackError("task must be an object");
  }
  const raw = task as Record<string, unknown>;
  const title = stringValue(raw.title) ?? stringValue(raw.name) ?? stringValue(raw.id);
  if (!title) {
    throw new AgentPackError("task requires title, name, or id");
  }
  const doneWhen = Array.isArray(raw.doneWhen)
    ? raw.doneWhen.map((entry) => String(entry))
    : undefined;
  return {
    id: stringValue(raw.id),
    title,
    category: stringValue(raw.category),
    body: stringValue(raw.body) ?? stringValue(raw.description),
    doneWhen,
  };
}

export function taskTitleFromText(text: string): ManifestTask {
  return { title: text };
}

export function nameFromRef(ref: string): string {
  const clean = ref.replace(/[#?].*$/, "").replace(/\/+$/, "");
  return path.basename(clean) || clean;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function validateManifest(
  manifest: Record<string, unknown>,
  filePath: string,
  strict: boolean,
): void {
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
  validateTasks(manifest.tasks, filePath, strict);
  validateIncludes(manifest.references, "references", filePath, strict);
  validateIncludes(manifest.skills, "skills", filePath, strict);
  if (manifest.surfaceInventory !== undefined && !Array.isArray(manifest.surfaceInventory)) {
    throw new AgentPackError(`manifest surfaceInventory must be an array: ${filePath}`);
  }
  if (manifest.assumptions !== undefined && !Array.isArray(manifest.assumptions)) {
    throw new AgentPackError(`manifest assumptions must be an array: ${filePath}`);
  }
}

function validateTasks(value: unknown, filePath: string, strict: boolean): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new AgentPackError(`manifest tasks must be an array: ${filePath}`);
  }
  for (const [index, task] of value.entries()) {
    if (!isObject(task)) {
      throw new AgentPackError(`manifest tasks[${index}] must be an object: ${filePath}`);
    }
    if (strict) {
      assertKnownKeys(task, taskKeys, `tasks[${index}]`);
    }
    if (task.doneWhen !== undefined && !Array.isArray(task.doneWhen)) {
      throw new AgentPackError(`manifest tasks[${index}].doneWhen must be an array: ${filePath}`);
    }
  }
}

function validateIncludes(
  value: unknown,
  label: "references" | "skills",
  filePath: string,
  strict: boolean,
): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new AgentPackError(`manifest ${label} must be an array: ${filePath}`);
  }
  for (const [index, entry] of value.entries()) {
    if (!isObject(entry)) {
      throw new AgentPackError(`manifest ${label}[${index}] must be an object: ${filePath}`);
    }
    if (strict) {
      assertKnownKeys(entry, includeKeys, `${label}[${index}]`);
    }
    if (typeof entry.ref !== "string" || !entry.ref.trim()) {
      throw new AgentPackError(`manifest ${label}[${index}].ref must be a string: ${filePath}`);
    }
  }
}

function assertKnownKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new AgentPackError(`unsupported manifest field in strict mode: ${label}.${key}`);
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
