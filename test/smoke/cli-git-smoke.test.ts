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

  it("uses packaged examples as a catalog root", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agent-pack-examples-catalog-smoke-"));
    const env = { AGENT_PACK_CONFIG_DIR: path.resolve("examples") };

    const list = await runCli(["catalog", "list", "--type", "manifest"], { cwd: workspace, env });
    expect(list.stdout).toContain("manifest\tcode-review\t");
    expect(list.stdout).toContain("manifest\tdemo\t");
    expect(list.stdout).toContain("manifest\tdocs-review\t");

    const candidates = await runCli(["__complete", "manifest", "do"], { cwd: workspace, env });
    expect(candidates.stdout).toBe("docs-review\n");
  });

  it("generates a suffixed pack id when init has no explicit id", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agent-pack-generated-id-smoke-"));
    await writeFile(path.join(workspace, "pack.yaml"), "name: code-review\n");

    const result = await runCli(["init", "--manifest", "./pack.yaml"], { cwd: workspace });
    const match = result.stdout.match(/Created pack (code-review-[a-f0-9]{6})/);

    expect(match?.[1]).toBeDefined();
    expect(result.stdout).toContain(`Run: agent-pack brief --id ${match?.[1]}`);
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

    const packList = await runCli(["list"], { cwd: workspace });
    expect(packList.stdout).toContain("task-pack");
    const packListJson = await runCli(["list", "--json"], { cwd: workspace });
    expect(JSON.parse(packListJson.stdout)).toMatchObject([{ id: "task-pack" }]);

    const help = await runCli(["task", "--help"], { cwd: workspace });
    expect(help.stdout).toContain("list [options]");
    expect(help.stdout).toContain("show [options] <taskId>");
    expect(help.stdout).toContain("start [options] <taskId>");
    expect(help.stdout).toContain("note [options] <taskId> <note>");
    expect(help.stdout).toContain("done [options] <taskId>");
    expect(help.stdout).toContain("block [options] <taskId>");

    const list = await runCli(["task", "list", "--id", "task-pack"], { cwd: workspace });
    expect(list.stdout).toContain("t001");
    expect(list.stdout).toContain("Inspect task commands");

    const done = await runCli(
      ["task", "done", "t001", "--id", "task-pack", "--note", "Completed"],
      { cwd: workspace },
    );
    expect(done.stdout).toContain("Tasks: 1/1 completed, 0 blocked");

    const shown = await runCli(["task", "show", "t001", "--id", "task-pack"], {
      cwd: workspace,
    });
    expect(shown.stdout).toContain("Task: t001");
    expect(shown.stdout).toContain("Status: completed");
    expect(shown.stdout).toContain("Notes:\n- ");
    expect(shown.stdout).toContain("Completed");
    expect(shown.stdout).not.toContain('"id":');

    const shownJson = await runCli(["task", "show", "t001", "--id", "task-pack", "--json"], {
      cwd: workspace,
    });
    expect(JSON.parse(shownJson.stdout)).toMatchObject({
      id: "t001",
      status: "completed",
      title: "Inspect task commands",
    });

    const report = await runCli(["report", "--id", "task-pack"], { cwd: workspace });
    expect(report.stdout).toContain("Pack: task-pack");
    expect(report.stdout).toContain("Tasks:\n- t001 [completed] Inspect task commands");
    expect(report.stdout).toContain("Notes:\n  - ");
    expect(report.stdout).not.toContain('"tasks":');

    const reportJson = await runCli(["report", "--id", "task-pack", "--json"], {
      cwd: workspace,
    });
    expect(JSON.parse(reportJson.stdout)).toMatchObject({
      id: "task-pack",
      tasks: [{ id: "t001", status: "completed" }],
    });

    const summary = await runCli(["summary", "--id", "task-pack"], { cwd: workspace });
    expect(summary.stdout).toContain("Pack: task-pack");
    expect(summary.stdout).toContain("Tasks: 1/1 completed, 0 blocked");

    const summaryJson = await runCli(["summary", "--id", "task-pack", "--json"], {
      cwd: workspace,
    });
    expect(JSON.parse(summaryJson.stdout)).toMatchObject({
      id: "task-pack",
      status: "completed",
      tasks: { completed: 1, total: 1 },
    });

    const systemStatus = await runCli(["status"], { cwd: workspace });
    expect(systemStatus.stdout).toContain("Agent Pack Status");
    expect(systemStatus.stdout).toContain(`Workspace: ${workspace}`);
    expect(systemStatus.stdout).toContain("Config/catalog dir:");
    expect(systemStatus.stdout).toContain("State dir:");

    const systemStatusJson = await runCli(["status", "--json"], { cwd: workspace });
    expect(JSON.parse(systemStatusJson.stdout)).toMatchObject({
      cwd: workspace,
      stateDir: path.join(workspace, ".agent-pack/state"),
    });

    const oldTopLevel = await runCli(["done", "t001", "--id", "task-pack"], {
      cwd: workspace,
      reject: false,
    });
    expect(oldTopLevel.stderr).toContain("unknown command 'done'");

    const oldStatusAll = await runCli(["status", "--all"], { cwd: workspace, reject: false });
    expect(oldStatusAll.stderr).toContain("unknown option '--all'");

    const oldSyncAll = await runCli(["sync", "--all"], { cwd: workspace, reject: false });
    expect(oldSyncAll.stderr).toContain("unknown option '--all'");
  });

  it("lists, shows, and resolves catalog entries", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agent-pack-catalog-smoke-"));
    const configDir = path.join(workspace, "config");
    await mkdir(path.join(configDir, "manifests/review"), { recursive: true });
    await mkdir(path.join(configDir, "tasks/review"), { recursive: true });
    await writeFile(
      path.join(configDir, "manifests/review/code-review.yaml"),
      "name: code-review\ntasks:\n  - review/security\n",
    );
    await writeFile(
      path.join(configDir, "tasks/review/security.yaml"),
      "id: security\ntitle: Review security\n",
    );
    const env = { AGENT_PACK_CONFIG_DIR: configDir };

    const list = await runCli(["catalog", "list"], { cwd: workspace, env });
    expect(list.stdout).toContain("manifest\treview/code-review\t");
    expect(list.stdout).toContain("task\treview/security\t");

    const listJson = await runCli(["catalog", "list", "--type", "task", "--json"], {
      cwd: workspace,
      env,
    });
    expect(JSON.parse(listJson.stdout)).toMatchObject([{ type: "task", name: "review/security" }]);

    const shown = await runCli(["catalog", "show", "manifest", "review/code-review"], {
      cwd: workspace,
      env,
    });
    expect(shown.stdout).toContain("name: code-review");

    const resolvedPath = await runCli(["catalog", "path", "task", "review/security"], {
      cwd: workspace,
      env,
    });
    expect(resolvedPath.stdout.trim()).toBe(path.join(configDir, "tasks/review/security.yaml"));

    const init = await runCli(["init", "--manifest", "review/code-review"], {
      cwd: workspace,
      env,
    });
    expect(init.stdout).toContain("Created pack code-review");
  });

  it("prints shell completion setup and catalog candidates", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agent-pack-completion-smoke-"));
    const configDir = path.join(workspace, "config");
    await mkdir(path.join(configDir, "manifests/review"), { recursive: true });
    await mkdir(path.join(configDir, "tasks/review"), { recursive: true });
    await writeFile(path.join(configDir, "manifests/review/code-review.yaml"), "tasks: []\n");
    await writeFile(path.join(configDir, "tasks/review/security.yaml"), "title: Security\n");
    const env = { AGENT_PACK_CONFIG_DIR: configDir };

    const instructions = await runCli(["completion", "bash"], { cwd: workspace, env });
    expect(instructions.stdout).toContain("For this shell only:");
    expect(instructions.stdout).toContain("source <(agent-pack completion script bash)");

    const script = await runCli(["completion", "script", "bash"], { cwd: workspace, env });
    expect(script.stdout).toContain("complete -o default -o bashdefault -F");
    expect(script.stdout).toContain("agent-pack __complete");
    expect(script.stdout).toContain("--type)");

    const zshScript = await runCli(["completion", "script", "zsh"], { cwd: workspace, env });
    expect(zshScript.stdout).toContain("compdef _agent_pack agent-pack");
    expect(zshScript.stdout).toContain("--type) _describe 'catalog type' catalog_types");

    const fishScript = await runCli(["completion", "script", "fish"], { cwd: workspace, env });
    expect(fishScript.stdout).toContain("__fish_prev_arg_in --type");
    expect(fishScript.stdout).toContain(
      "__fish_seen_subcommand_from catalog; and __fish_seen_subcommand_from show; and __fish_seen_subcommand_from manifest",
    );

    const manifestCandidates = await runCli(["__complete", "manifest", "review/"], {
      cwd: workspace,
      env,
    });
    expect(manifestCandidates.stdout).toBe("review/code-review\n");

    const taskCandidates = await runCli(["__complete", "task", "review/s"], {
      cwd: workspace,
      env,
    });
    expect(taskCandidates.stdout).toBe("review/security\n");

    const pathCandidates = await runCli(["__complete", "task", "./tasks"], {
      cwd: workspace,
      env,
    });
    expect(pathCandidates.stdout).toBe("");
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
    const result = await runCli(["list"], {
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
