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
  do:
    - Record concrete evidence.
  dont:
    - Skip referenced material.`,
    );

    const pack = await initPack({
      id: "design-review",
      includes: [{ type: "manifest", ref: "pack.yaml" }],
      prompt: "Focus on concrete findings.",
      gitRefresh: "auto",
    });

    expect(pack.tasks).toHaveLength(1);
    expect(pack.tasks[0]?.source?.path).toBe("./pack.yaml");
    expect(pack.references[0]?.path).toBe("./docs/design.md");
    expect(pack.skills[0]?.name).toBe("fresh-eyes");
    expect(pack.contract).toEqual({
      do: ["Record concrete evidence."],
      dont: ["Skip referenced material."],
    });

    const updated = await updateTask("t001", "completed", "Done.", "design-review");
    expect(updated.status).toBe("completed");
    const loaded = await status("design-review", false);
    expect(Array.isArray(loaded)).toBe(false);
    expect((loaded as typeof updated).taskCounts.completed).toBe(1);
  });

  it("preserves source order within each brief section", async () => {
    await mkdir("docs", { recursive: true });
    await mkdir("skills/first", { recursive: true });
    await mkdir("skills/second", { recursive: true });
    await writeFile("docs/before.md", "# Before\n");
    await writeFile("docs/manifest.md", "# Manifest\n");
    await writeFile("docs/after.md", "# After\n");
    await writeFile("skills/first/SKILL.md", "---\nname: first\ndescription: First skill.\n---\n");
    await writeFile(
      "skills/second/SKILL.md",
      "---\nname: second\ndescription: Second skill.\n---\n",
    );
    await writeFile("after-task.yaml", "id: after\ntitle: After manifest task\n");
    await writeFile(
      "pack.yaml",
      `schemaVersion: 1
instructions: Manifest instructions.
tasks:
  - id: manifest
    title: Manifest task
references:
  - name: manifest
    ref: ./docs/manifest.md
skills:
  - ref: ./skills/second/SKILL.md
`,
    );

    const pack = await initPack({
      id: "ordered-pack",
      includes: [
        { type: "adHocTask", text: "Before manifest task" },
        { type: "reference", ref: { name: "before", ref: "./docs/before.md" } },
        { type: "skill", ref: { ref: "./skills/first/SKILL.md" } },
        { type: "manifest", ref: "pack.yaml" },
        { type: "taskRef", ref: "./after-task.yaml" },
        { type: "reference", ref: { name: "after", ref: "./docs/after.md" } },
      ],
      gitRefresh: "auto",
    });

    expect(pack.instructions).toBe("Manifest instructions.");
    expect(pack.tasks.map((task) => task.title)).toEqual([
      "Before manifest task",
      "Manifest task",
      "After manifest task",
    ]);
    expect(pack.references.map((reference) => reference.name)).toEqual([
      "before",
      "manifest",
      "after",
    ]);
    expect(pack.skills.map((skill) => skill.name)).toEqual(["first", "second"]);
  });

  it("rejects unsupported manifest fields", async () => {
    await writeFile(
      "pack.yaml",
      `schemaVersion: 1
unexpected: true
tasks:
  - title: Inspect`,
    );

    await expect(
      initPack({
        id: "unsupported-field-pack",
        includes: [{ type: "manifest", ref: "pack.yaml" }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("unsupported metadata field");
  });

  it("rejects unsupported nested manifest fields", async () => {
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
        id: "unsupported-nested-pack",
        includes: [{ type: "manifest", ref: "pack.yaml" }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("tasks[0].unknownNested");
  });

  it("rejects invalid contract shapes", async () => {
    await writeFile(
      "pack.yaml",
      `schemaVersion: 1
contract:
  do: Run tests`,
    );

    await expect(
      initPack({
        id: "bad-contract",
        includes: [{ type: "manifest", ref: "pack.yaml" }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("contract.do must be an array of strings");
  });

  it("rejects invalid manifest task shapes", async () => {
    await writeFile(
      "pack.yaml",
      `schemaVersion: 1
tasks:
  - title: 123
  - id: inspect
    doneWhen:
      - true`,
    );

    await expect(
      initPack({
        id: "bad-manifest-task",
        includes: [{ type: "manifest", ref: "pack.yaml" }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("tasks[0].title must be a string");
  });

  it("rejects manifest task aliases", async () => {
    await writeFile(
      "pack.yaml",
      `schemaVersion: 1
tasks:
  - name: Inspect
    description: Read the design`,
    );

    await expect(
      initPack({
        id: "alias-manifest-task",
        includes: [{ type: "manifest", ref: "pack.yaml" }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("tasks[0].name");
  });

  it("rejects unknown task file fields", async () => {
    await writeFile(
      "task.yaml",
      `title: Inspect
unknown: true`,
    );

    await expect(
      initPack({
        id: "unsupported-task-file",
        includes: [{ type: "taskRef", ref: "./task.yaml" }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("task.unknown");
  });

  it("treats instruction files as raw text", async () => {
    await writeFile("instructions.yaml", "note: Review carefully");

    const pack = await initPack({
      id: "raw-instructions",
      includes: [{ type: "instructions", path: "./instructions.yaml" }],
      gitRefresh: "auto",
    });

    expect(pack.instructions).toBe("note: Review carefully");
  });

  it("rejects invalid skill frontmatter", async () => {
    await mkdir("skills/bad", { recursive: true });
    await writeFile("skills/bad/SKILL.md", "---\nname: 123\n---\n# Bad\n");

    await expect(
      initPack({
        id: "invalid-skill",
        includes: [{ type: "skill", ref: { ref: "./skills/bad/SKILL.md" } }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("frontmatter name must be a string");
  });

  it("rejects git manifest refs without a file path", async () => {
    await expect(
      initPack({
        id: "git-manifest-no-path",
        includes: [{ type: "manifest", ref: "git+file:///no/such/repo.git#main" }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("git manifest source requires a file path inside the repo");
  });

  it("rejects invalid pack IDs before resolving state paths", async () => {
    await expect(
      initPack({
        id: "../outside",
        includes: [{ type: "adHocTask", text: "Inspect" }],
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

  it("rejects unknown pack state fields", async () => {
    await mkdir(".agent-pack/state/packs", { recursive: true });
    await writeFile(
      ".agent-pack/state/packs/obsolete.json",
      JSON.stringify({
        schemaVersion: 1,
        id: "obsolete",
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        repoRoot: ".",
        taskCounts: { total: 0, pending: 0, inProgress: 0, completed: 0, blocked: 0 },
        tasks: [],
        references: [],
        skills: [],
        unexpectedField: true,
      }),
    );

    await expect(status("obsolete", false)).rejects.toThrow(
      "unsupported pack state field 'unexpectedField'",
    );
  });

  it("rejects invalid pack task state before mutation", async () => {
    await mkdir(".agent-pack/state/packs", { recursive: true });
    await writeFile(
      ".agent-pack/state/packs/bad-task-state.json",
      JSON.stringify({
        schemaVersion: 1,
        id: "bad-task-state",
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        repoRoot: ".",
        taskCounts: { total: 1, pending: 1, inProgress: 0, completed: 0, blocked: 0 },
        tasks: [
          {
            id: "t001",
            title: "Inspect",
            status: "pending",
            notes: "not an array",
          },
        ],
        references: [],
        skills: [],
      }),
    );

    await expect(updateTask("t001", "completed", "Done.", "bad-task-state")).rejects.toThrow(
      "tasks[0].notes",
    );
  });

  it("preserves concurrent task notes through locked updates", async () => {
    await initPack({
      id: "locked-notes",
      includes: [{ type: "adHocTask", text: "Inspect" }],
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
        includes: [{ type: "taskRef", ref: "./missing-task.yaml" }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("task file not found or unreadable");
  });

  it("reports clear errors for missing local skill inputs", async () => {
    await expect(
      initPack({
        id: "missing-skill",
        includes: [{ type: "skill", ref: { ref: "./skills/fresh-eyes/SKILL.md" } }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("skill file not found or unreadable");
  });

  it("reports malformed task YAML as an agent-pack error", async () => {
    await writeFile("bad-task.yaml", "title: [unterminated\n");

    await expect(
      initPack({
        id: "bad-task",
        includes: [{ type: "taskRef", ref: "./bad-task.yaml" }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("malformed YAML");
  });
});
