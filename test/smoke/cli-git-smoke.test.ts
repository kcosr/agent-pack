import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../helpers/cli.js";

describe("agent-pack CLI git smoke", () => {
  it("prints package resources in top-level help", async () => {
    const result = await runCli(["--help"]);

    expect(result.stdout).toContain("Resources:");
    expect(result.stdout).toContain("README");
    expect(result.stdout).toContain("README.md");
    expect(result.stdout).toContain("Usage");
    expect(result.stdout).toContain("docs/usage.md");
    expect(result.stdout).toContain("Examples");
    expect(result.stdout).toContain("examples");
  });

  it("prints the package version from package.json", async () => {
    const result = await runCli(["--version"]);

    expect(result.stdout.trim()).toBe("0.0.0");
  });

  it("preserves command line source order within each section", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agent-pack-order-smoke-"));
    await mkdir(path.join(workspace, "docs"), { recursive: true });
    await writeFile(path.join(workspace, "docs/manifest.md"), "# Manifest\n");
    await writeFile(path.join(workspace, "docs/after.md"), "# After\n");
    await writeFile(
      path.join(workspace, "after-task.yaml"),
      "id: after\ntitle: After manifest task\n",
    );
    await writeFile(
      path.join(workspace, "pack.yaml"),
      `tasks:
  - id: manifest
    title: Manifest task
references:
  - name: manifest
    ref: ./docs/manifest.md
`,
    );

    await runCli(
      [
        "init",
        "--id",
        "ordered-cli",
        "--add-task",
        "Before manifest task",
        "--manifest",
        "./pack.yaml",
        "--task",
        "./after-task.yaml",
        "--reference",
        "./docs/after.md",
      ],
      { cwd: workspace },
    );

    const state = JSON.parse(
      await readFile(path.join(workspace, ".agent-pack/state/packs/ordered-cli.json"), "utf8"),
    );
    expect(state.tasks.map((task: { title: string }) => task.title)).toEqual([
      "Before manifest task",
      "Manifest task",
      "After manifest task",
    ]);
    expect(state.references.map((reference: { name: string }) => reference.name)).toEqual([
      "manifest",
      "after.md",
    ]);
  });

  it("updates tasks through the task command group", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agent-pack-task-smoke-"));

    await runCli(["init", "--id", "task-pack", "--add-task", "Inspect task commands"], {
      cwd: workspace,
    });

    const list = await runCli(["task", "list", "--id", "task-pack"], { cwd: workspace });
    expect(list.stdout).toContain("t001");
    expect(list.stdout).toContain("Inspect task commands");

    const show = await runCli(["task", "show", "t001", "--id", "task-pack"], { cwd: workspace });
    expect(show.stdout).toContain('"id": "t001"');

    await runCli(["task", "start", "t001", "--id", "task-pack", "--note", "Started"], {
      cwd: workspace,
    });
    await runCli(["task", "note", "t001", "--id", "task-pack", "Evidence"], { cwd: workspace });
    const done = await runCli(
      ["task", "done", "t001", "--id", "task-pack", "--note", "Completed"],
      { cwd: workspace },
    );
    expect(done.stdout).toContain("Tasks: 1/1 completed, 0 blocked");

    const oldTopLevel = await runCli(["done", "t001", "--id", "task-pack"], {
      cwd: workspace,
      reject: false,
    });
    expect(oldTopLevel.stderr).toContain("unknown command 'done'");
  });

  it("clones git sources, materializes snapshots, syncs missing cache, and renders brief", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-pack-smoke-"));
    const repo = path.join(root, "fixture");
    const remote = path.join(root, "fixture.git");
    const workspace = path.join(root, "workspace");
    const remoteUrl = `file://${remote}`;
    await mkdir(repo, { recursive: true });
    await mkdir(workspace, { recursive: true });
    git(["init", "-b", "main"], repo);
    git(["config", "user.email", "test@example.com"], repo);
    git(["config", "user.name", "Test User"], repo);
    await mkdir(path.join(repo, "docs"), { recursive: true });
    await mkdir(path.join(repo, "tasks"), { recursive: true });
    await mkdir(path.join(repo, "skills/review"), { recursive: true });
    await writeFile(path.join(repo, "docs/reference.md"), "# Reference\n");
    await writeFile(
      path.join(repo, "tasks/review.yaml"),
      "id: inspect-git\ntitle: Inspect git material\n",
    );
    await writeFile(
      path.join(repo, "tasks/extra.yaml"),
      "id: inspect-extra\ntitle: Inspect plural task source\n",
    );
    await writeFile(
      path.join(repo, "skills/review/SKILL.md"),
      "---\nname: review-skill\ndescription: Review with evidence.\n---\n",
    );
    await writeFile(
      path.join(repo, "pack.yaml"),
      `schemaVersion: 1
name: remote-manifest
instructions: Use the remote manifest.
tasks:
  - id: inspect-manifest
    title: Inspect manifest material
references:
  - name: manifest reference
    ref: git+${remoteUrl}//docs/reference.md#main
skills:
  - ref: git+${remoteUrl}//skills/**#main
`,
    );
    git(["add", "."], repo);
    git(["commit", "-m", "Initial fixture"], repo);
    git(["clone", "--bare", repo, remote], root);
    await writeFile(
      path.join(workspace, "local-pack.yaml"),
      `tasks:
  - id: inspect-local-manifest
    title: Inspect local manifest material
`,
    );

    const init = await runCli(
      [
        "init",
        "--id",
        "git-pack",
        "--manifest",
        `git+${remoteUrl}//pack.yaml#main`,
        "--manifests",
        "./local-pack.yaml",
        "--reference",
        `git+${remoteUrl}//docs/reference.md#main`,
        "--task",
        `git+${remoteUrl}//tasks/review.yaml#main`,
        "--tasks",
        `git+${remoteUrl}//tasks/extra.yaml#main`,
        "--skills",
        `git+${remoteUrl}//skills/**#main`,
        "--add-task",
        "Inspect ad hoc material",
        "Use git material.",
      ],
      { cwd: workspace },
    );
    expect(init.stdout).toContain("Created pack git-pack");

    const brief = await runCli(["brief", "--id", "git-pack"], { cwd: workspace });
    expect(brief.stdout).toContain(".agent-pack/cache/snapshots/");
    expect(brief.stdout).toContain("Inspect manifest material");
    expect(brief.stdout).toContain("Inspect local manifest material");
    expect(brief.stdout).toContain("review-skill");
    const state = JSON.parse(
      await readFile(path.join(workspace, ".agent-pack/state/packs/git-pack.json"), "utf8"),
    );
    const manifestTask = state.tasks.find(
      (task: { sourceId?: string }) => task.sourceId === "inspect-manifest",
    );
    expect(manifestTask.source.kind).toBe("git");
    expect(manifestTask.source.path).toBe("pack.yaml");
    expect(manifestTask.source.resolvedCommit).toMatch(/^[a-f0-9]{40}$/);

    await rm(path.join(workspace, ".agent-pack/cache"), { recursive: true, force: true });
    const missing = await runCli(["brief", "--id", "git-pack"], { cwd: workspace, reject: false });
    expect(missing.stderr).toContain("agent-pack sync --id git-pack");
    expect(missing.stderr).toContain("\nMissing cache material:\n");
    expect(missing.stderr).toContain("\n- ./.agent-pack/cache/snapshots/");

    const never = await runCli(["sync", "--id", "git-pack", "--git-refresh", "never"], {
      cwd: workspace,
      reject: false,
    });
    expect(never.stderr).toContain("git cache missing");

    const sync = await runCli(["sync", "--id", "git-pack", "--git-refresh", "always"], {
      cwd: workspace,
    });
    expect(sync.stdout).toContain("Synced pack git-pack");

    const restored = await runCli(["brief", "--id", "git-pack"], { cwd: workspace });
    expect(restored.stdout).toContain("Inspect git material");
    expect(restored.stdout).toContain("Inspect plural task source");
    expect(restored.stdout).toContain("Inspect ad hoc material");

    const clean = await runCli(["clean", "--id", "git-pack"], { cwd: workspace });
    expect(clean.stdout).toContain("Cleaned 2 cache paths");

    const cleaned = await runCli(["brief", "--id", "git-pack"], { cwd: workspace, reject: false });
    expect(cleaned.stderr).toContain("agent-pack sync --id git-pack");

    const resync = await runCli(["sync", "--id", "git-pack"], { cwd: workspace });
    expect(resync.stdout).toContain("Synced pack git-pack");
  });

  it.skipIf(process.env.AGENT_PACK_SMOKE_LIVE_GIT !== "1")(
    "initializes a pack from a live HTTPS git reference",
    async () => {
      const workspace = await mkdtemp(path.join(os.tmpdir(), "agent-pack-live-smoke-"));
      const repo = process.env.AGENT_PACK_SMOKE_REPO ?? "https://github.com/kcosr/agent-pack.git";

      const init = await runCli(
        [
          "init",
          "--id",
          "live-git-pack",
          "--reference",
          `git+${repo}`,
          "--add-task",
          "Inspect live git material",
          "Use live git material.",
        ],
        { cwd: workspace },
      );
      expect(init.stdout).toContain("Created pack live-git-pack");

      const brief = await runCli(["brief", "--id", "live-git-pack"], { cwd: workspace });
      expect(brief.stdout).toContain(".agent-pack/cache/snapshots/");
    },
  );

  it("rejects git snapshots that contain symlinks", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-pack-symlink-smoke-"));
    const repo = path.join(root, "fixture");
    const remote = path.join(root, "fixture.git");
    const workspace = path.join(root, "workspace");
    await mkdir(repo, { recursive: true });
    await mkdir(workspace, { recursive: true });
    git(["init", "-b", "main"], repo);
    git(["config", "user.email", "test@example.com"], repo);
    git(["config", "user.name", "Test User"], repo);
    await writeFile(path.join(repo, "target.md"), "# Target\n");
    await symlink("/tmp/agent-pack-escape", path.join(repo, "escape.md"));
    git(["add", "."], repo);
    git(["commit", "-m", "Symlink fixture"], repo);
    git(["clone", "--bare", repo, remote], root);

    const init = await runCli(
      [
        "init",
        "--id",
        "symlink-pack",
        "--reference",
        `git+file://${remote}#main`,
        "--add-task",
        "Inspect",
      ],
      { cwd: workspace, reject: false },
    );

    expect(init.stderr).toContain("unsupported symlink");
  });

  it("rejects invalid git refresh policy from the environment", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agent-pack-env-smoke-"));
    const result = await runCli(["status", "--all"], {
      cwd: workspace,
      reject: false,
      env: { AGENT_PACK_GIT_REFRESH: "sometimes" },
    });

    expect(result.stderr).toContain("invalid AGENT_PACK_GIT_REFRESH");
  });
});

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}
