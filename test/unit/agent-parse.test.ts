import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readAgentFile, readManifest } from "../../src/core/manifest/parse.js";

describe("agent parsing", () => {
  it("reads a single agent file", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agent-pack-agent-"));
    const file = path.join(dir, "agent.yaml");
    await writeFile(file, 'name: claude\ncommand: claude\nargs: ["--print", "{prompt}"]\n');

    await expect(readAgentFile(file)).resolves.toEqual([
      {
        name: "claude",
        command: "claude",
        args: ["--print", "{prompt}"],
        timeoutSec: undefined,
        maxAttempts: undefined,
      },
    ]);
  });

  it("reads an array of agents", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agent-pack-agent-"));
    const file = path.join(dir, "agents.yaml");
    await writeFile(
      file,
      `- name: claude
  command: claude
- name: codex
  command: codex
  timeoutSec: 30
`,
    );

    await expect(readAgentFile(file)).resolves.toEqual([
      {
        name: "claude",
        command: "claude",
        args: undefined,
        timeoutSec: undefined,
        maxAttempts: undefined,
      },
      {
        name: "codex",
        command: "codex",
        args: undefined,
        timeoutSec: 30,
        maxAttempts: undefined,
      },
    ]);
  });

  it("reads an agents wrapper", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agent-pack-agent-"));
    const file = path.join(dir, "agents.yaml");
    await writeFile(file, "agents:\n  - name: claude\n    command: claude\n");

    await expect(readAgentFile(file)).resolves.toEqual([
      {
        name: "claude",
        command: "claude",
        args: undefined,
        timeoutSec: undefined,
        maxAttempts: undefined,
      },
    ]);
  });

  it("accepts string refs and inline agent definitions in manifests", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agent-pack-agent-"));
    const file = path.join(dir, "pack.yaml");
    await mkdir(path.join(dir, "agents"));
    await writeFile(
      file,
      `schemaVersion: 1
agents:
  - claude
  - ./agents/repo.yaml
  - name: local-claude
    command: claude
    args: ["--print", "{prompt}"]
`,
    );

    await expect(readManifest(file)).resolves.toMatchObject({
      agents: [
        "claude",
        "./agents/repo.yaml",
        {
          name: "local-claude",
          command: "claude",
          args: ["--print", "{prompt}"],
        },
      ],
    });
  });

  it("rejects object ref agent entries in manifests", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agent-pack-agent-"));
    const file = path.join(dir, "pack.yaml");
    await writeFile(file, "schemaVersion: 1\nagents:\n  - ref: claude\n");

    await expect(readManifest(file)).rejects.toThrow("unsupported metadata field: agents[0].ref");
  });

  it("rejects invalid agent maxAttempts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agent-pack-agent-"));
    const file = path.join(dir, "agent.yaml");
    await writeFile(file, "name: claude\ncommand: claude\nmaxAttempts: 0\n");

    await expect(readAgentFile(file)).rejects.toThrow(
      "agent.maxAttempts must be a positive integer",
    );
  });
});
