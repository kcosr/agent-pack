import { createHash } from "node:crypto";
import { readFileSync, readlinkSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { AgentPackError } from "./errors.js";
import { ensureDir, errorMessage, isAlreadyExists, isNotFound } from "./fs.js";

const lockStaleMs = 5000;

export async function withDirectoryLock<T>(
  lockDir: string,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = path.join(lockDir, `${assertLockName(name)}.lock`);
  await acquireLock(lockPath);
  try {
    return await fn();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

export function lockNamespace(stateDir: string): string {
  return createHash("sha256").update(path.resolve(stateDir)).digest("hex").slice(0, 16);
}

function assertLockName(name: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new AgentPackError(`invalid lock name: ${name}`);
  }
  return name;
}

async function acquireLock(lockPath: string): Promise<void> {
  await ensureDir(path.dirname(lockPath));
  const deadline = Date.now() + 5000;
  while (true) {
    try {
      await mkdir(lockPath);
      await writeFile(
        path.join(lockPath, "holder.json"),
        `${JSON.stringify({
          pid: process.pid,
          command: process.argv.join(" "),
          cwd: process.cwd(),
          createdAt: new Date().toISOString(),
        })}\n`,
      );
      return;
    } catch (error) {
      if (isAlreadyExists(error) && (await removeStaleLock(lockPath))) {
        continue;
      }
      if (!isAlreadyExists(error) || Date.now() > deadline) {
        throw new AgentPackError(
          `failed to acquire agent-pack lock: ${lockPath}: ${errorMessage(error)}; if no agent-pack process is running, remove this lock directory`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function removeStaleLock(lockPath: string): Promise<boolean> {
  const holderPath = path.join(lockPath, "holder.json");
  const lockStats = await stat(lockPath).catch(() => undefined);
  const isOld = Boolean(lockStats && Date.now() - lockStats.mtimeMs > lockStaleMs);
  try {
    const holder = JSON.parse(await readFile(holderPath, "utf8")) as {
      pid?: unknown;
      command?: unknown;
      cwd?: unknown;
    };
    if (
      typeof holder.pid !== "number" ||
      holder.pid <= 0 ||
      !isProcessAlive(holder.pid) ||
      (isOld && !isKnownLockHolder(holder.pid, holder))
    ) {
      await rm(lockPath, { recursive: true, force: true });
      return true;
    }
  } catch (error) {
    if (isOld) {
      await rm(lockPath, { recursive: true, force: true });
      return true;
    }
    if (!isNotFound(error)) {
      return false;
    }
  }
  return false;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isKnownLockHolder(pid: number, holder: { command?: unknown; cwd?: unknown }): boolean {
  try {
    const liveCommand = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
    const liveCwd = readlinkSync(`/proc/${pid}/cwd`);
    if (typeof holder.command === "string" && typeof holder.cwd === "string") {
      return liveCommand === holder.command && liveCwd === holder.cwd;
    }
    return liveCommand.includes("agent-pack");
  } catch {
    return true;
  }
}
