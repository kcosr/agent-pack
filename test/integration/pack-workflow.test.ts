import { createHash } from "node:crypto";
import { mkdir, mkdtemp, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { brief, cleanCache, initPack, status, updateTask } from "../../src/core/operations.js";
import { resolveRuntimePaths } from "../../src/core/paths.js";

describe("pack workflow", () => {
  let cwd: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    cwd = await mkdtemp(path.join(os.tmpdir(), "agent-pack-workflow-"));
    process.chdir(cwd);
    vi.stubEnv("AGENT_PACK_CACHE_DIR", path.join(cwd, ".agent-pack/cache"));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.unstubAllEnvs();
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
    expect(pack.tasks[0]?.source).toMatchObject({ path: "./pack.yaml" });
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

  it("rejects empty ad hoc tasks before writing state", async () => {
    await expect(
      initPack({
        id: "empty-task",
        includes: [{ type: "adHocTask", text: "   " }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("ad hoc task text must not be empty");

    await expect(status("empty-task", false)).rejects.toThrow("pack not found");
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

    await expect(status("unknown-nested-state", false)).rejects.toThrow(
      "tasks[0].unexpectedNested",
    );
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

    await expect(status("bad-reference-state", false)).rejects.toThrow("source.path");
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

    const packs = await status(undefined, true);

    if (!Array.isArray(packs)) {
      throw new Error("expected pack list");
    }
    expect(packs.map((pack) => pack.id)).toContain("orphan");
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
      "Task content is omitted from this brief. Run `agent-pack show <task-id> --id compact-brief` before working a task.",
    );
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

async function writeGitPackState(id: string, repoHash: string): Promise<void> {
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
