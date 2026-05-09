import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cliPath = path.join(repoRoot, "dist/cli/main.js");

export interface CliResult {
  stdout: string;
  stderr: string;
}

export async function runCli(
  args: string[],
  options: { cwd: string; reject?: boolean; env?: NodeJS.ProcessEnv } = { cwd: process.cwd() },
): Promise<CliResult> {
  try {
    const env = {
      ...process.env,
      AGENT_PACK_CACHE_DIR: path.join(options.cwd, ".agent-pack/cache"),
      AGENT_PACK_CONFIG_DIR: undefined,
      AGENT_PACK_GIT_REFRESH: undefined,
      AGENT_PACK_ID: undefined,
      AGENT_PACK_STATE_DIR: undefined,
      ...options.env,
    };
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: options.cwd,
      env,
    });
    return { stdout, stderr };
  } catch (error) {
    if (options.reject === false && typeof error === "object" && error) {
      return {
        stdout: String((error as { stdout?: string }).stdout ?? ""),
        stderr: String((error as { stderr?: string }).stderr ?? ""),
      };
    }
    throw error;
  }
}
