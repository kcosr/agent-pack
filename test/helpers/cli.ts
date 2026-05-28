import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cliPath = path.join(repoRoot, "dist/cli/main.js");

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
}

export interface RunCliOptions {
  cwd: string;
  reject?: boolean;
  env?: NodeJS.ProcessEnv;
  input?: string;
}

export async function runCli(
  args: string[],
  options: RunCliOptions = { cwd: process.cwd() },
): Promise<CliResult> {
  if (options.input !== undefined) {
    return runCliWithSpawn(args, options);
  }
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: options.cwd,
      env: cliEnv(options),
    });
    return { stdout, stderr, exitCode: 0, signal: null };
  } catch (error) {
    if (options.reject === false && typeof error === "object" && error) {
      return {
        stdout: String((error as { stdout?: string }).stdout ?? ""),
        stderr: String((error as { stderr?: string }).stderr ?? ""),
        exitCode: Number((error as { code?: number }).code ?? 1),
        signal: ((error as { signal?: NodeJS.Signals }).signal ?? null) as NodeJS.Signals | null,
      };
    }
    throw error;
  }
}

function runCliWithSpawn(args: string[], options: RunCliOptions): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: options.cwd,
      env: cliEnv(options),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => {
      stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.stderr.on("data", (chunk) => {
      stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    if (options.input !== undefined) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
    child.on("error", reject);
    child.on("close", (exitCode, signal) => {
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode,
        signal,
      };
      if (exitCode === 0 || options.reject === false) {
        resolve(result);
        return;
      }
      reject(
        new Error(
          `CLI exited with ${exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
        ),
      );
    });
  });
}

function cliEnv(options: RunCliOptions): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AGENT_PACK_CACHE_DIR: path.join(options.cwd, ".agent-pack/cache"),
    AGENT_PACK_CONFIG_DIR: undefined,
    AGENT_PACK_GIT_REFRESH: undefined,
    AGENT_PACK_ID: undefined,
    AGENT_PACK_STATE_DIR: undefined,
    ...options.env,
  };
}
