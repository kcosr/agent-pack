import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cliPath = path.join(repoRoot, "dist/cli/agent-pack.js");

export interface CliResult {
  stdout: string;
  stderr: string;
}

export async function runCli(
  args: string[],
  options: { cwd: string; reject?: boolean; env?: NodeJS.ProcessEnv } = { cwd: process.cwd() },
): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
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
