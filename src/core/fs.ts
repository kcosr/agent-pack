import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { AgentPackError } from "./errors.js";

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw new AgentPackError(`failed to stat ${filePath}: ${errorMessage(error)}`);
  }
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (isNotFound(error)) {
      return fallback;
    }
    throw new AgentPackError(`failed to read JSON ${filePath}: ${errorMessage(error)}`);
  }
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export async function appendJsonLine(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await appendFile(filePath, `${JSON.stringify(data)}\n`);
}

export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`,
  );
  try {
    await writeFile(tempPath, content);
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw new AgentPackError(`failed to write ${filePath}: ${errorMessage(error)}`);
  }
}

export function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
