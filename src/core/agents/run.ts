import { type ChildProcess, spawn } from "node:child_process";
import { AgentPackError } from "../errors.js";
import type { PackAgent } from "../types.js";

export interface AgentProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stdoutTruncated: boolean;
  spawnError?: string;
}

export type AgentRunMode = "captured" | "interactive";

const STDOUT_LIMIT_BYTES = 64 * 1024;
const KILL_GRACE_MS = 5_000;

export async function runAgentProcess(input: {
  agent: PackAgent;
  packId: string;
  stateDir?: string;
  mode?: AgentRunMode;
  prompt?: string;
}): Promise<AgentProcessResult> {
  const prompt = input.prompt ?? agentPrompt();
  const args = input.agent.args.map((arg) => expandAgentArg(arg, prompt));
  if (input.mode === "interactive") {
    return spawnInteractiveAgent({
      command: input.agent.command,
      args,
      packId: input.packId,
      stateDir: input.stateDir,
    });
  }
  return spawnAgent({
    command: input.agent.command,
    args,
    timeoutSec: input.agent.timeoutSec,
    packId: input.packId,
    stateDir: input.stateDir,
  });
}

function spawnInteractiveAgent(input: {
  command: string;
  args: string[];
  packId: string;
  stateDir?: string;
}): Promise<AgentProcessResult> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(input.command, input.args, {
        env: childEnv(input.packId, input.stateDir),
        stdio: "inherit",
      });
    } catch (error) {
      resolve({
        exitCode: null,
        signal: null,
        timedOut: false,
        stdout: "",
        stdoutTruncated: false,
        spawnError: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    let settled = false;
    const finish = (result: AgentProcessResult) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    child.on("error", (error) => {
      finish({
        exitCode: null,
        signal: null,
        timedOut: false,
        stdout: "",
        stdoutTruncated: false,
        spawnError: error.message,
      });
    });

    child.on("close", (exitCode, signal) => {
      finish({
        exitCode,
        signal,
        timedOut: false,
        stdout: "",
        stdoutTruncated: false,
      });
    });
  });
}

export function agentPrompt(): string {
  const commandName = process.env.AGENT_PACK_CMD ?? "agent-pack";
  return `Run ${commandName} brief and follow the instructions. Update task status as you work. When finished, stop.`;
}

function expandAgentArg(value: string, prompt: string): string {
  const expanded = value.replaceAll("{prompt}", prompt);
  const unknown = /\{[A-Za-z][A-Za-z0-9_]*\}/.exec(expanded);
  if (unknown) {
    throw new AgentPackError(`unsupported agent arg placeholder: ${unknown[0]}`);
  }
  return expanded;
}

function spawnAgent(input: {
  command: string;
  args: string[];
  timeoutSec?: number;
  packId: string;
  stateDir?: string;
}): Promise<AgentProcessResult> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(input.command, input.args, {
        env: childEnv(input.packId, input.stateDir),
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch (error) {
      resolve({
        exitCode: null,
        signal: null,
        timedOut: false,
        stdout: "",
        stdoutTruncated: false,
        spawnError: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    let stdout = Buffer.alloc(0);
    let stdoutTruncated = false;
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let settled = false;

    const finish = (result: AgentProcessResult) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      if (killTimer) {
        clearTimeout(killTimer);
      }
      resolve(result);
    };

    const sigkillAfterGrace = () => {
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            child.kill("SIGKILL");
          } catch {
            // ignore
          }
        }
      }, KILL_GRACE_MS);
    };

    if (input.timeoutSec !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGINT");
        } catch {
          // ignore
        }
        sigkillAfterGrace();
      }, input.timeoutSec * 1000);
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length >= STDOUT_LIMIT_BYTES) {
        stdoutTruncated = true;
        return;
      }
      const remaining = STDOUT_LIMIT_BYTES - stdout.length;
      if (chunk.length > remaining) {
        stdout = Buffer.concat([stdout, chunk.subarray(0, remaining)]);
        stdoutTruncated = true;
        return;
      }
      stdout = Buffer.concat([stdout, chunk]);
    });

    child.on("error", (error) => {
      finish({
        exitCode: null,
        signal: null,
        timedOut,
        stdout: stdout.toString("utf8"),
        stdoutTruncated,
        spawnError: error.message,
      });
    });

    child.on("close", (exitCode, signal) => {
      finish({
        exitCode,
        signal,
        timedOut,
        stdout: stdout.toString("utf8"),
        stdoutTruncated,
      });
    });
  });
}

function childEnv(packId: string, stateDir: string | undefined): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AGENT_PACK_ID: packId,
    ...(stateDir ? { AGENT_PACK_STATE_DIR: stateDir } : {}),
  };
}
