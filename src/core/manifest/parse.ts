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

export async function readManifest(filePath: string, strict = false): Promise<PackManifest> {
  const content = await readText(filePath, "manifest");
  const parsed = parseYaml(content, filePath);
  if (!parsed || typeof parsed !== "object") {
    throw new AgentPackError(`manifest must be a YAML object: ${filePath}`);
  }
  if (strict) {
    for (const key of Object.keys(parsed)) {
      if (!manifestKeys.has(key)) {
        throw new AgentPackError(`unsupported manifest field in strict mode: ${key}`);
      }
    }
  }
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
