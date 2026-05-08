import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addTask,
  brief,
  catalogList,
  catalogShow,
  cleanCache,
  initPack,
  listPacks,
  status,
  summaryPack,
  updateTask,
} from "../../src/core/operations.js";
import { resolveRuntimePaths } from "../../src/core/paths.js";

describe("pack workflow", () => {
  let cwd: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    cwd = await mkdtemp(path.join(os.tmpdir(), "agent-pack-workflow-"));
    process.chdir(cwd);
    vi.stubEnv("AGENT_PACK_BRIEF_TASK_CONTENT", undefined);
    vi.stubEnv("AGENT_PACK_CONFIG_DIR", undefined);
    vi.stubEnv("AGENT_PACK_ID", undefined);
    vi.stubEnv("AGENT_PACK_CACHE_DIR", path.join(cwd, ".agent-pack/cache"));
    vi.stubEnv("AGENT_PACK_STATE_DIR", undefined);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.unstubAllEnvs();
  });

  it("creates a pack from manifest inputs and updates task status", async () => {
    await mkdir("docs", { recursive: true });
    await mkdir("skills/fresh-eyes", { recursive: true });
    await mkdir("tasks", { recursive: true });
    await writeFile("docs/design.md", "# Design\n");
    await writeFile("tasks/referenced.yaml", "id: referenced\ntitle: Inspect referenced task\n");
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
  - ./tasks/referenced.yaml
  - id: inspect
    title: Inspect the design
references:
  - ./docs/design.md
skills:
  - ./skills/**
contract:
  do:
    - Record concrete evidence.
  dont:
    - Skip referenced material.`,
    );

    const pack = await initPack({
      id: "design-review",
      includes: [{ type: "manifest", ref: "./pack.yaml" }],
      prompt: "Focus on concrete findings.",
      gitRefresh: "auto",
    });

    expect(pack.tasks).toHaveLength(2);
    expect(pack.tasks.map((task) => task.title)).toEqual([
      "Inspect referenced task",
      "Inspect the design",
    ]);
    expect(pack.tasks[0]?.source).toMatchObject({ path: "./tasks/referenced.yaml" });
    expect(pack.tasks[1]?.source).toMatchObject({ path: "./pack.yaml" });
    expect(pack.references[0]).toMatchObject({ name: "design.md", path: "./docs/design.md" });
    expect(pack.skills[0]?.name).toBe("fresh-eyes");
    expect(pack.contract).toEqual({
      do: ["Record concrete evidence."],
      dont: ["Skip referenced material."],
    });

    const updated = await updateTask("t001", "completed", "Done.", "design-review");
    expect(updated.status).toBe("in_progress");
    const loaded = await summaryPack("design-review");
    expect(Array.isArray(loaded)).toBe(false);
    expect((loaded as typeof updated).taskCounts.completed).toBe(1);
  });

  it("generates a unique pack id when none is provided", async () => {
    await writeFile(
      "pack.yaml",
      `schemaVersion: 1
name: code-review
tasks:
  - id: inspect
    title: Inspect changes
`,
    );

    const first = await initPack({
      includes: [{ type: "manifest", ref: "./pack.yaml" }],
      gitRefresh: "auto",
    });
    const second = await initPack({
      includes: [{ type: "manifest", ref: "./pack.yaml" }],
      gitRefresh: "auto",
    });

    expect(first.id).toMatch(/^code-review-[a-f0-9]{6}$/);
    expect(second.id).toMatch(/^code-review-[a-f0-9]{6}$/);
    expect(second.id).not.toBe(first.id);
    expect(first.name).toBe("code-review");
  });

  it("uses AGENT_PACK_ID for init when --id is omitted", async () => {
    vi.stubEnv("AGENT_PACK_ID", "env-review");

    const pack = await initPack({
      includes: [{ type: "adHocTask", text: "Inspect env-selected pack." }],
      gitRefresh: "auto",
    });

    expect(pack.id).toBe("env-review");
  });

  it("adds an ad hoc task to an existing pack", async () => {
    await initPack({
      id: "add-task-pack",
      includes: [{ type: "adHocTask", text: "Inspect existing work" }],
      gitRefresh: "auto",
    });

    const { pack, task } = await addTask({
      packId: "add-task-pack",
      title: "  Review auth flow  ",
      category: " review ",
      body: " Inspect request handling. ",
      doneWhen: [" Findings cite files ", " Test gaps are noted "],
    });

    expect(task).toEqual({
      id: "t002",
      title: "Review auth flow",
      category: "review",
      body: "Inspect request handling.",
      doneWhen: ["Findings cite files", "Test gaps are noted"],
      status: "pending",
      notes: [],
    });
    expect(pack.taskCounts).toMatchObject({ total: 2, pending: 2, completed: 0 });
    expect(pack.status).toBe("pending");

    const loaded = await summaryPack("add-task-pack");
    expect(loaded.tasks[1]).toMatchObject(task);
    const events = await readEvents("add-task-pack");
    expect(events.at(-1)).toMatchObject({
      type: "task.added",
      data: { taskId: "t002", title: "Review auth flow" },
    });
  });

  it("generates the next task id from existing runtime ids", async () => {
    await writePackState("task-id-sequence", [
      { id: "t001", title: "First", status: "pending", notes: [] },
      { id: "custom", title: "Custom", status: "pending", notes: [] },
      { id: "t010", title: "Tenth", status: "pending", notes: [] },
    ]);

    const { task } = await addTask({ packId: "task-id-sequence", title: "Next task" });

    expect(task.id).toBe("t011");
  });

  it("rejects empty task add fields before mutating state", async () => {
    await initPack({
      id: "reject-empty-add",
      includes: [{ type: "adHocTask", text: "Original task" }],
      gitRefresh: "auto",
    });

    await expect(addTask({ packId: "reject-empty-add", title: " " })).rejects.toThrow(
      "task title must not be empty",
    );
    await expect(
      addTask({ packId: "reject-empty-add", title: "New task", category: " " }),
    ).rejects.toThrow("task category must not be empty");
    await expect(
      addTask({ packId: "reject-empty-add", title: "New task", body: "" }),
    ).rejects.toThrow("task body must not be empty");
    await expect(
      addTask({ packId: "reject-empty-add", title: "New task", doneWhen: ["Done", " "] }),
    ).rejects.toThrow("task done-when must not be empty");

    const loaded = await summaryPack("reject-empty-add");
    expect(loaded.tasks).toHaveLength(1);
  });

  it("updates status and counts when adding to a completed pack", async () => {
    await initPack({
      id: "completed-add",
      includes: [{ type: "adHocTask", text: "Original task" }],
      gitRefresh: "auto",
    });
    await updateTask("t001", "completed", "Done.", "completed-add");

    const { pack } = await addTask({ packId: "completed-add", title: "Follow-up task" });

    expect(pack.status).toBe("in_progress");
    expect(pack.taskCounts).toMatchObject({ total: 2, pending: 1, completed: 1 });
  });

  it("adds concurrent tasks with unique task ids", async () => {
    await initPack({
      id: "concurrent-adds",
      includes: [{ type: "adHocTask", text: "Original task" }],
      gitRefresh: "auto",
    });

    await Promise.all([
      addTask({ packId: "concurrent-adds", title: "First added task" }),
      addTask({ packId: "concurrent-adds", title: "Second added task" }),
    ]);

    const loaded = await summaryPack("concurrent-adds");
    expect(loaded.tasks.map((task) => task.id).sort()).toEqual(["t001", "t002", "t003"]);
    expect(new Set(loaded.tasks.map((task) => task.id)).size).toBe(3);
  });

  it("reports system status paths and default pack id", () => {
    vi.stubEnv("AGENT_PACK_ID", "active-pack");

    expect(status()).toMatchObject({
      cwd,
      repoRoot: cwd,
      configDir: path.join(os.homedir(), ".config/agent-pack"),
      stateDir: path.join(cwd, ".agent-pack/state"),
      cacheDir: path.join(cwd, ".agent-pack/cache"),
      defaultPackId: "active-pack",
    });
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
        { type: "manifest", ref: "./pack.yaml" },
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

  it("scans local skill directories for SKILL.md files", async () => {
    await mkdir("skills/review", { recursive: true });
    await mkdir("skills/ignored", { recursive: true });
    await writeFile(
      "skills/review/SKILL.md",
      "---\nname: review-skill\ndescription: Review carefully.\n---\n",
    );
    await writeFile("skills/ignored/notes.md", "# Notes\n");

    const pack = await initPack({
      id: "skill-dir",
      includes: [{ type: "skill", ref: { ref: "./skills" } }],
      gitRefresh: "auto",
    });

    expect(pack.skills).toHaveLength(1);
    expect(pack.skills[0]).toMatchObject({
      name: "review-skill",
      path: "./skills/review/SKILL.md",
    });
  });

  it("loads bare refs from the catalog across manifests, tasks, references, and skills", async () => {
    const configDir = path.join(cwd, "config");
    vi.stubEnv("AGENT_PACK_CONFIG_DIR", configDir);
    await mkdir(path.join(configDir, "manifests/review"), { recursive: true });
    await mkdir(path.join(configDir, "tasks/review"), { recursive: true });
    await mkdir(path.join(configDir, "references/product"), { recursive: true });
    await mkdir(path.join(configDir, "skills/engineering/fresh-eyes"), { recursive: true });
    await mkdir("docs", { recursive: true });
    await writeFile("docs/api.md", "# API\n");
    await writeFile(
      path.join(configDir, "tasks/review/security.yaml"),
      "id: security\ntitle: Review security posture\n",
    );
    await writeFile(
      path.join(configDir, "references/product/api.yaml"),
      "name: product api\ndescription: API docs.\nref: ./docs/api.md\n",
    );
    await writeFile(
      path.join(configDir, "skills/engineering/fresh-eyes/SKILL.md"),
      "---\nname: fresh-eyes\ndescription: Review again.\n---\n",
    );
    await writeFile(
      path.join(configDir, "manifests/review/code-review.yaml"),
      `schemaVersion: 1
name: catalog-review
tasks:
  - review/security
references:
  - product/api
skills:
  - engineering/fresh-eyes
`,
    );

    const pack = await initPack({
      includes: [{ type: "manifest", ref: "review/code-review" }],
      gitRefresh: "auto",
    });

    expect(pack.id).toMatch(/^catalog-review-[a-f0-9]{6}$/);
    expect(pack.name).toBe("catalog-review");
    expect(pack.tasks[0]).toMatchObject({
      sourceId: "security",
      title: "Review security posture",
    });
    expect(pack.references[0]).toMatchObject({
      name: "product api",
      description: "API docs.",
      path: "./docs/api.md",
    });
    expect(pack.skills[0]).toMatchObject({
      name: "fresh-eyes",
      description: "Review again.",
    });
  });

  it("creates catalog directories when listing catalog entries", async () => {
    const configDir = path.join(cwd, "config");
    vi.stubEnv("AGENT_PACK_CONFIG_DIR", configDir);

    await expect(catalogList()).resolves.toEqual([]);
    await expectPathPresent(path.join(configDir, "manifests"));
    await expectPathPresent(path.join(configDir, "tasks"));
    await expectPathPresent(path.join(configDir, "references"));
    await expectPathPresent(path.join(configDir, "skills"));
  });

  it("ignores a top-level catalog SKILL.md that has no catalog name", async () => {
    const configDir = path.join(cwd, "config");
    vi.stubEnv("AGENT_PACK_CONFIG_DIR", configDir);
    await mkdir(path.join(configDir, "skills/review"), { recursive: true });
    await writeFile(path.join(configDir, "skills/SKILL.md"), "# Root Skill\n");
    await writeFile(path.join(configDir, "skills/review/SKILL.md"), "# Review Skill\n");

    const entries = await catalogList("skill");

    expect(entries.map((entry) => entry.name)).toEqual(["review"]);
  });

  it("wraps catalog show read failures", async () => {
    const configDir = path.join(cwd, "config");
    vi.stubEnv("AGENT_PACK_CONFIG_DIR", configDir);
    await mkdir(path.join(configDir, "manifests/bad-entry.yaml"), { recursive: true });

    await expect(catalogShow("manifest", "bad-entry")).rejects.toThrow(
      "failed to read catalog manifest bad-entry",
    );
  });

  it("rejects ambiguous local refs that are missing an explicit path prefix", async () => {
    await writeFile("pack.yaml", "tasks: []\n");

    await expect(
      initPack({
        id: "ambiguous-local",
        includes: [{ type: "manifest", ref: "pack.yaml" }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("invalid catalog ref");
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
        includes: [{ type: "manifest", ref: "./pack.yaml" }],
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
        includes: [{ type: "manifest", ref: "./pack.yaml" }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("tasks[0].unknownNested");
  });

  it("rejects invalid manifest include metadata", async () => {
    await writeFile(
      "pack.yaml",
      `schemaVersion: 1
references:
  - name: 123
    ref: ./README.md`,
    );

    await expect(
      initPack({
        id: "bad-include-metadata",
        includes: [{ type: "manifest", ref: "./pack.yaml" }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("references[0].name must be a string");
  });

  it("rejects empty manifest include metadata", async () => {
    await writeFile(
      "pack.yaml",
      `schemaVersion: 1
references:
  - name: " "
    ref: ./README.md
skills:
  - description: ""
    ref: ./skills/fresh-eyes/SKILL.md`,
    );

    await expect(
      initPack({
        id: "empty-include-metadata",
        includes: [{ type: "manifest", ref: "./pack.yaml" }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("references[0].name must be a string");
  });

  it("rejects empty manifest skill metadata", async () => {
    await writeFile(
      "pack.yaml",
      `schemaVersion: 1
skills:
  - description: ""
    ref: ./skills/fresh-eyes/SKILL.md`,
    );

    await expect(
      initPack({
        id: "empty-skill-metadata",
        includes: [{ type: "manifest", ref: "./pack.yaml" }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("skills[0].description must be a string");
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
        includes: [{ type: "manifest", ref: "./pack.yaml" }],
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
        includes: [{ type: "manifest", ref: "./pack.yaml" }],
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
        includes: [{ type: "manifest", ref: "./pack.yaml" }],
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

  it("rejects empty ad hoc tasks before writing state", async () => {
    await expect(
      initPack({
        id: "empty-task",
        includes: [{ type: "adHocTask", text: "   " }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("ad hoc task text must not be empty");

    await expect(summaryPack("empty-task")).rejects.toThrow("pack not found");
  });

  it("rejects corrupt index JSON instead of treating it as empty", async () => {
    await mkdir(".agent-pack/state", { recursive: true });
    await writeFile(".agent-pack/state/index.json", "{bad json");

    await expect(listPacks()).rejects.toThrow("failed to read JSON");
  });

  it("rejects invalid pack state schema", async () => {
    await mkdir(".agent-pack/state/packs", { recursive: true });
    await writeFile(".agent-pack/state/packs/bad.json", JSON.stringify({ schemaVersion: 99 }));

    await expect(summaryPack("bad")).rejects.toThrow("schemaVersion 99 is not supported");
  });

  it("accepts persisted taskCounts with non-canonical key order", async () => {
    await mkdir(".agent-pack/state/packs", { recursive: true });
    await writeFile(
      ".agent-pack/state/packs/reordered-counts.json",
      JSON.stringify({
        schemaVersion: 1,
        id: "reordered-counts",
        status: "no_tasks",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        repoRoot: ".",
        taskCounts: { blocked: 0, completed: 0, inProgress: 0, pending: 0, total: 0 },
        tasks: [],
        references: [],
        skills: [],
      }),
    );

    await expect(summaryPack("reordered-counts")).resolves.toMatchObject({
      id: "reordered-counts",
      taskCounts: { total: 0, pending: 0, inProgress: 0, completed: 0, blocked: 0 },
    });
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

    await expect(summaryPack("obsolete")).rejects.toThrow(
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

  it("rejects malformed task source state before mutation", async () => {
    await mkdir(".agent-pack/state/packs", { recursive: true });
    await writeFile(
      ".agent-pack/state/packs/bad-task-source-state.json",
      JSON.stringify({
        schemaVersion: 1,
        id: "bad-task-source-state",
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
            notes: [],
            source: { kind: "git", url: "https://example.com/repo.git" },
          },
        ],
        references: [],
        skills: [],
      }),
    );

    await expect(updateTask("t001", "completed", "Done.", "bad-task-source-state")).rejects.toThrow(
      "tasks[0].source.resolvedRef",
    );
  });

  it("rejects unknown nested pack state fields", async () => {
    await mkdir(".agent-pack/state/packs", { recursive: true });
    await writeFile(
      ".agent-pack/state/packs/unknown-nested-state.json",
      JSON.stringify({
        schemaVersion: 1,
        id: "unknown-nested-state",
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
            notes: [],
            unexpectedNested: true,
          },
        ],
        references: [],
        skills: [],
      }),
    );

    await expect(summaryPack("unknown-nested-state")).rejects.toThrow("tasks[0].unexpectedNested");
  });

  it("rejects invalid pack reference state", async () => {
    await mkdir(".agent-pack/state/packs", { recursive: true });
    await writeFile(
      ".agent-pack/state/packs/bad-reference-state.json",
      JSON.stringify({
        schemaVersion: 1,
        id: "bad-reference-state",
        status: "no_tasks",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        repoRoot: ".",
        taskCounts: { total: 0, pending: 0, inProgress: 0, completed: 0, blocked: 0 },
        tasks: [],
        references: [{ id: "r001", name: "bad", source: { kind: "file" } }],
        skills: [],
      }),
    );

    await expect(summaryPack("bad-reference-state")).rejects.toThrow("source.path");
  });

  it("rejects persisted git source paths that escape snapshots", async () => {
    await writeGitPackState("escaped-git-path", "aaaaaaaaaaaaaaaa", "../outside.md");

    await expect(summaryPack("escaped-git-path")).rejects.toThrow("escapes repository");
  });

  it("lists valid orphan pack files missing from the index", async () => {
    await mkdir(".agent-pack/state/packs", { recursive: true });
    await writeFile(
      ".agent-pack/state/packs/orphan.json",
      JSON.stringify({
        schemaVersion: 1,
        id: "orphan",
        status: "no_tasks",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        repoRoot: ".",
        taskCounts: { total: 0, pending: 0, inProgress: 0, completed: 0, blocked: 0 },
        tasks: [],
        references: [],
        skills: [],
      }),
    );

    const packs = await listPacks();

    if (!Array.isArray(packs)) {
      throw new Error("expected pack list");
    }
    expect(packs.map((pack) => pack.id)).toContain("orphan");
  });

  it("ignores stale index entries whose pack files were removed", async () => {
    await mkdir(".agent-pack/state", { recursive: true });
    await writeFile(
      ".agent-pack/state/index.json",
      JSON.stringify({
        schemaVersion: 1,
        packs: {
          missing: {
            id: "missing",
            status: "pending",
            updatedAt: new Date().toISOString(),
            path: ".agent-pack/state/packs/missing.json",
          },
        },
      }),
    );

    expect(await listPacks()).toEqual([]);
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

    const pack = await summaryPack("locked-notes");
    expect(Array.isArray(pack)).toBe(false);
    expect((pack as Awaited<ReturnType<typeof updateTask>>).tasks[0]?.notes).toHaveLength(2);
  });

  it("recovers stale pack locks left by dead processes", async () => {
    await initPack({
      id: "stale-lock",
      includes: [{ type: "adHocTask", text: "Inspect" }],
      gitRefresh: "auto",
    });
    const lockPath = packLockPath("stale-lock");
    await mkdir(lockPath, { recursive: true });
    await writeFile(
      path.join(lockPath, "holder.json"),
      JSON.stringify({ pid: 99999999, createdAt: new Date().toISOString() }),
    );

    const pack = await updateTask("t001", "completed", "Done.", "stale-lock");

    expect(pack.status).toBe("completed");
  });

  it("recovers stale pack locks with corrupt holder metadata", async () => {
    await initPack({
      id: "corrupt-lock",
      includes: [{ type: "adHocTask", text: "Inspect" }],
      gitRefresh: "auto",
    });
    const lockPath = packLockPath("corrupt-lock");
    await mkdir(lockPath, { recursive: true });
    await writeFile(path.join(lockPath, "holder.json"), "{bad json");
    const old = new Date(Date.now() - 10_000);
    await utimes(lockPath, old, old);

    const pack = await updateTask("t001", "completed", "Done.", "corrupt-lock");

    expect(pack.status).toBe("completed");
  });

  it("does not follow symlinked directories in local globs", async () => {
    await mkdir("docs/real", { recursive: true });
    await mkdir("outside", { recursive: true });
    await writeFile("docs/real/design.md", "# Design\n");
    await writeFile("outside/secret.md", "# Secret\n");
    await symlink(path.join(cwd, "outside"), "docs/link");

    const pack = await initPack({
      id: "no-symlink-globs",
      includes: [{ type: "reference", ref: { ref: "./docs/**/*.md" } }],
      gitRefresh: "auto",
    });

    expect(pack.references[0]?.files).toEqual(["./docs/real/design.md"]);
  });

  it("renders git reference paths from the current cache directory", async () => {
    const repoHash = "aaaaaaaaaaaaaaaa";
    await mkdir(".agent-pack/state/packs", { recursive: true });
    await mkdir(`external-cache/snapshots/${repoHash}/commit/docs`, { recursive: true });
    await writeFile(`external-cache/snapshots/${repoHash}/commit/docs/design.md`, "# Design\n");
    await writeFile(
      ".agent-pack/state/packs/runtime-cache-path.json",
      JSON.stringify({
        schemaVersion: 1,
        id: "runtime-cache-path",
        status: "no_tasks",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        repoRoot: ".",
        taskCounts: { total: 0, pending: 0, inProgress: 0, completed: 0, blocked: 0 },
        tasks: [],
        references: [
          {
            id: "r001",
            name: "design",
            source: {
              kind: "git",
              url: "file:///repo.git",
              resolvedRef: "main",
              resolvedCommit: "commit",
              repoHash,
              path: "docs/design.md",
            },
            path: `./.agent-pack/cache/snapshots/${repoHash}/commit/docs/design.md`,
          },
        ],
        skills: [],
      }),
    );
    vi.stubEnv("AGENT_PACK_CACHE_DIR", "external-cache");
    await expect(brief("runtime-cache-path")).resolves.toContain(
      `Path: ./external-cache/snapshots/${repoHash}/commit/docs/design.md`,
    );
  });

  it("cleans git cache material for one pack or all current packs", async () => {
    await writeGitPackState("first-clean-pack", "aaaaaaaaaaaaaaaa");
    await writeGitPackState("second-clean-pack", "bbbbbbbbbbbbbbbb");
    await mkdir(".agent-pack/cache/git/aaaaaaaaaaaaaaaa/mirror.git", { recursive: true });
    await mkdir(".agent-pack/cache/snapshots/aaaaaaaaaaaaaaaa/commit", { recursive: true });
    await mkdir(".agent-pack/cache/git/bbbbbbbbbbbbbbbb/mirror.git", { recursive: true });
    await mkdir(".agent-pack/cache/snapshots/bbbbbbbbbbbbbbbb/commit", { recursive: true });

    const scoped = await cleanCache("first-clean-pack");

    expect(scoped).toMatchObject({
      packIds: ["first-clean-pack"],
      repoHashes: ["aaaaaaaaaaaaaaaa"],
    });
    expect(scoped.removed).toEqual([
      ".agent-pack/cache/git/aaaaaaaaaaaaaaaa",
      ".agent-pack/cache/snapshots/aaaaaaaaaaaaaaaa",
    ]);
    await expectPathMissing(".agent-pack/cache/git/aaaaaaaaaaaaaaaa");
    await expectPathMissing(".agent-pack/cache/snapshots/aaaaaaaaaaaaaaaa");
    await expectPathPresent(".agent-pack/cache/git/bbbbbbbbbbbbbbbb");
    await expectPathPresent(".agent-pack/cache/snapshots/bbbbbbbbbbbbbbbb");

    const all = await cleanCache();

    expect(all.packIds).toEqual(["first-clean-pack", "second-clean-pack"]);
    expect(all.repoHashes).toEqual(["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"]);
    expect(all.removed).toEqual([
      ".agent-pack/cache/git/bbbbbbbbbbbbbbbb",
      ".agent-pack/cache/snapshots/bbbbbbbbbbbbbbbb",
    ]);
    await expectPathMissing(".agent-pack/cache/git/bbbbbbbbbbbbbbbb");
    await expectPathMissing(".agent-pack/cache/snapshots/bbbbbbbbbbbbbbbb");
    await expectPathPresent(".agent-pack/state/packs/first-clean-pack.json");
    await expectPathPresent(".agent-pack/state/packs/second-clean-pack.json");
  });

  it("rejects unsafe git cache keys while cleaning", async () => {
    await writeGitPackState("bad-clean-pack", "../escape");

    await expect(cleanCache("bad-clean-pack")).rejects.toThrow("invalid git cache key");
  });

  it("stores bare HTTP and HTTPS references as URL sources", async () => {
    const pack = await initPack({
      id: "url-reference",
      includes: [
        { type: "reference", ref: { ref: "https://example.com/docs/design.md" } },
        {
          type: "reference",
          ref: { name: "remote guide", ref: "http://example.com/guide/" },
        },
      ],
      gitRefresh: "auto",
    });

    expect(pack.references).toMatchObject([
      {
        name: "design.md",
        source: { kind: "url", url: "https://example.com/docs/design.md" },
        path: "https://example.com/docs/design.md",
      },
      {
        name: "remote guide",
        source: { kind: "url", url: "http://example.com/guide/" },
        path: "http://example.com/guide/",
      },
    ]);
    await expect(brief("url-reference")).resolves.toContain(
      "URL: https://example.com/docs/design.md",
    );
  });

  it("rejects URL references that include credentials", async () => {
    await expect(
      initPack({
        id: "credential-url",
        includes: [{ type: "reference", ref: { ref: "https://user:secret@example.com/doc.md" } }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("URL references must not include credentials");
  });

  it("rejects reference globs that match no files", async () => {
    await expect(
      initPack({
        id: "empty-reference-glob",
        includes: [{ type: "reference", ref: { ref: "./docs/**/*.md" } }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("reference source matched no files");
  });

  it("can omit task content from rendered briefs through the environment", async () => {
    await writeFile(
      "task.yaml",
      `id: inspect
title: Inspect implementation
body: Read the implementation carefully.
doneWhen:
  - Notes cite inspected files.
`,
    );
    await initPack({
      id: "compact-brief",
      includes: [{ type: "taskRef", ref: "./task.yaml" }],
      gitRefresh: "auto",
    });

    vi.stubEnv("AGENT_PACK_BRIEF_TASK_CONTENT", "false");
    const rendered = await brief("compact-brief");

    expect(rendered).toContain("- [pending] t001 - Inspect implementation");
    expect(rendered).not.toContain("Read the implementation carefully.");
    expect(rendered).not.toContain("Done when:");
    expect(rendered).toContain(
      "Task content is omitted from this brief. Run `agent-pack task show <task-id> --id compact-brief` before working a task.",
    );
  });

  it("omits pack id arguments from brief commands when AGENT_PACK_ID selects the pack", async () => {
    await initPack({
      id: "env-brief",
      includes: [{ type: "adHocTask", text: "Inspect" }],
      gitRefresh: "auto",
    });

    vi.stubEnv("AGENT_PACK_ID", "env-brief");
    const rendered = await brief();

    expect(rendered).toContain("  agent-pack task list");
    expect(rendered).toContain("  agent-pack task done <task-id> --note");
    expect(rendered).not.toContain("--id env-brief");
  });

  it("rejects invalid task content brief settings", async () => {
    await initPack({
      id: "invalid-brief-setting",
      includes: [{ type: "adHocTask", text: "Inspect" }],
      gitRefresh: "auto",
    });
    vi.stubEnv("AGENT_PACK_BRIEF_TASK_CONTENT", "sometimes");

    await expect(brief("invalid-brief-setting")).rejects.toThrow(
      "invalid AGENT_PACK_BRIEF_TASK_CONTENT",
    );
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

function packLockPath(id: string): string {
  const paths = resolveRuntimePaths();
  const namespace = createHash("sha256")
    .update(path.resolve(paths.stateDir))
    .digest("hex")
    .slice(0, 16);
  return path.join(paths.lockDir, `${namespace}-pack-${id}.lock`);
}

async function readEvents(id: string): Promise<Array<{ type: string; data?: unknown }>> {
  const content = await readFile(`.agent-pack/state/events/${id}.jsonl`, "utf8");
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; data?: unknown });
}

async function writePackState(
  id: string,
  tasks: Array<{ id: string; title: string; status: string; notes: string[] }>,
): Promise<void> {
  await mkdir(".agent-pack/state/packs", { recursive: true });
  await writeFile(
    `.agent-pack/state/packs/${id}.json`,
    JSON.stringify({
      schemaVersion: 1,
      id,
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      repoRoot: ".",
      taskCounts: {
        total: tasks.length,
        pending: tasks.filter((task) => task.status === "pending").length,
        inProgress: tasks.filter((task) => task.status === "in_progress").length,
        completed: tasks.filter((task) => task.status === "completed").length,
        blocked: tasks.filter((task) => task.status === "blocked").length,
      },
      tasks,
      references: [],
      skills: [],
    }),
  );
}

async function writeGitPackState(id: string, repoHash: string, sourcePath?: string): Promise<void> {
  await mkdir(".agent-pack/state/packs", { recursive: true });
  await writeFile(
    `.agent-pack/state/packs/${id}.json`,
    JSON.stringify({
      schemaVersion: 1,
      id,
      status: "no_tasks",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      repoRoot: ".",
      taskCounts: { total: 0, pending: 0, inProgress: 0, completed: 0, blocked: 0 },
      tasks: [],
      references: [
        {
          id: "r001",
          name: "repo",
          source: {
            kind: "git",
            url: "file:///repo.git",
            resolvedRef: "main",
            resolvedCommit: "commit",
            repoHash,
            path: sourcePath,
          },
          rootPath: `./.agent-pack/cache/snapshots/${repoHash}/commit`,
        },
      ],
      skills: [],
    }),
  );
}

async function expectPathPresent(pathName: string): Promise<void> {
  await expect(stat(pathName)).resolves.toBeTruthy();
}

async function expectPathMissing(pathName: string): Promise<void> {
  await expect(stat(pathName)).rejects.toMatchObject({ code: "ENOENT" });
}
