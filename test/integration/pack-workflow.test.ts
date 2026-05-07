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

  it("rejects unsupported nested manifest fields in strict mode", async () => {
    await writeFile(
      "pack.yaml",
      `schemaVersion: 1
tasks:
  - title: Inspect
    unknownNested: true
references:
  - ref: ./README.md
    extra: true`,
    );

    await expect(
      initPack({
        id: "strict-nested-pack",
        manifests: ["pack.yaml"],
        instructionFiles: [],
        taskRefs: [],
        adHocTasks: [],
        referenceRefs: [],
        skillRefs: [],
        gitRefresh: "auto",
        strict: true,
      }),
    ).rejects.toThrow("tasks[0].unknownNested");
  });

  it("rejects invalid pack IDs before resolving state paths", async () => {
    await expect(
      initPack({
        id: "../outside",
        manifests: [],
        instructionFiles: [],
        taskRefs: [],
        adHocTasks: ["Inspect"],
        referenceRefs: [],
        skillRefs: [],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("invalid pack id");
  });

  it("rejects corrupt index JSON instead of treating it as empty", async () => {
    await mkdir(".agent-pack/state", { recursive: true });
    await writeFile(".agent-pack/state/index.json", "{bad json");

    await expect(status(undefined, true)).rejects.toThrow("failed to read JSON");
  });

  it("rejects invalid pack state schema", async () => {
    await mkdir(".agent-pack/state/packs", { recursive: true });
    await writeFile(".agent-pack/state/packs/bad.json", JSON.stringify({ schemaVersion: 99 }));

    await expect(status("bad", false)).rejects.toThrow("schemaVersion 99 is not supported");
  });

  it("preserves concurrent task notes through locked updates", async () => {
    await initPack({
      id: "locked-notes",
      manifests: [],
      instructionFiles: [],
      taskRefs: [],
      adHocTasks: ["Inspect"],
      referenceRefs: [],
      skillRefs: [],
      gitRefresh: "auto",
    });

    await Promise.all([
      updateTask("t001", undefined, "first note", "locked-notes"),
      updateTask("t001", undefined, "second note", "locked-notes"),
    ]);

    const pack = await status("locked-notes", false);
    expect(Array.isArray(pack)).toBe(false);
    expect((pack as Awaited<ReturnType<typeof updateTask>>).tasks[0]?.notes).toHaveLength(2);
  });

  it("reports clear errors for missing local task inputs", async () => {
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
    ).rejects.toThrow("task file not found or unreadable");
  });

  it("reports clear errors for missing local skill inputs", async () => {
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
    ).rejects.toThrow("skill file not found or unreadable");
  });

  it("reports malformed task YAML as an agent-pack error", async () => {
    await writeFile("bad-task.yaml", "title: [unterminated\n");

    await expect(
      initPack({
        id: "bad-task",
        manifests: [],
        instructionFiles: [],
        taskRefs: ["./bad-task.yaml"],
        adHocTasks: [],
        referenceRefs: [],
        skillRefs: [],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("malformed YAML");
  });
});
