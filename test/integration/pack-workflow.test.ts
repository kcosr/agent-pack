import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initPack, status, updateTask } from "../../src/core/operations.js";

describe("pack workflow", () => {
  let cwd: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    cwd = await mkdtemp(path.join(os.tmpdir(), "agent-pack-workflow-"));
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("creates a pack from manifest inputs and updates task status", async () => {
    await mkdir("docs", { recursive: true });
    await mkdir("skills/fresh-eyes", { recursive: true });
    await writeFile("docs/design.md", "# Design\n");
    await writeFile(
      "skills/fresh-eyes/SKILL.md",
      "---\nname: fresh-eyes\ndescription: Re-read changed code.\n---\n",
    );
    await writeFile(
      "pack.yaml",
      `schemaVersion: 1
name: design-review
instructions: Review carefully.
tasks:
  - id: inspect
    title: Inspect the design
references:
  - name: design
    ref: ./docs/design.md
skills:
  - ref: ./skills/**
contract:
  type: review
assumptions:
  - Local files are current.`,
    );

    const pack = await initPack({
      id: "design-review",
      manifests: ["pack.yaml"],
      instructionFiles: [],
      taskRefs: [],
      adHocTasks: [],
      referenceRefs: [],
      skillRefs: [],
      prompt: "Focus on concrete findings.",
      gitRefresh: "auto",
    });

    expect(pack.tasks).toHaveLength(1);
    expect(pack.tasks[0]?.source?.path).toBe("./pack.yaml");
    expect(pack.references[0]?.path).toBe("./docs/design.md");
    expect(pack.skills[0]?.name).toBe("fresh-eyes");
    expect(pack.contract).toEqual({ type: "review" });

    const updated = await updateTask("t001", "completed", "Done.", "design-review");
    expect(updated.status).toBe("completed");
    const loaded = await status("design-review", false);
    expect(Array.isArray(loaded)).toBe(false);
    expect((loaded as typeof updated).taskCounts.completed).toBe(1);
  });

  it("rejects unsupported manifest fields in strict mode", async () => {
    await writeFile(
      "pack.yaml",
      `schemaVersion: 1
unexpected: true
tasks:
  - title: Inspect`,
    );

    await expect(
      initPack({
        id: "strict-pack",
        manifests: ["pack.yaml"],
        instructionFiles: [],
        taskRefs: [],
        adHocTasks: [],
        referenceRefs: [],
        skillRefs: [],
        gitRefresh: "auto",
        strict: true,
      }),
    ).rejects.toThrow("unsupported manifest field");
  });

  it("reports clear errors for missing local task and skill inputs", async () => {
    await expect(
      initPack({
        id: "missing-task",
        manifests: [],
        instructionFiles: [],
        taskRefs: ["./missing-task.yaml"],
        adHocTasks: [],
        referenceRefs: [],
        skillRefs: [],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("task source not found or unreadable");

    await expect(
      initPack({
        id: "missing-skill",
        manifests: [],
        instructionFiles: [],
        taskRefs: [],
        adHocTasks: [],
        referenceRefs: [],
        skillRefs: [{ ref: "./skills/fresh-eyes/SKILL.md" }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("skill file not found");
  });
});
