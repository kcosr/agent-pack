import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
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
    const pkg = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
    const result = await runCli(["--version"]);

    expect(result.stdout.trim()).toBe(pkg.version);
  });

  it("runs when invoked through a symlinked bin", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agent-pack-symlink-bin-smoke-"));
    const binPath = path.join(workspace, "agent-pack");
    await symlink(path.resolve("dist/cli/main.js"), binPath);
    const pkg = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));

    const stdout = execFileSync(binPath, ["--version"], {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_PACK_CACHE_DIR: path.join(workspace, ".agent-pack/cache"),
        AGENT_PACK_CONFIG_DIR: undefined,
        AGENT_PACK_GIT_REFRESH: undefined,
        AGENT_PACK_ID: undefined,
        AGENT_PACK_STATE_DIR: undefined,
      },
    });

    expect(stdout.trim()).toBe(pkg.version);
  });

  it("uses packaged examples as a catalog root", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agent-pack-examples-catalog-smoke-"));
    const env = { AGENT_PACK_CONFIG_DIR: path.resolve("examples") };

    const list = await runCli(["catalog", "list", "--type", "manifest"], { cwd: workspace, env });
    expect(list.stdout).toContain("manifest\tcode-review\t");
    expect(list.stdout).toContain("manifest\tdemo\t");
    expect(list.stdout).toContain("manifest\tdocs-review\t");

    const candidates = await runCli(["__complete", "do", "init", "--manifest"], {
      cwd: workspace,
      env,
    });
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
    expect(help.stdout).toContain("add [options] <title>");
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

  it("captures inputs, unlocks conditional tasks, and completes input names", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agent-pack-input-smoke-"));
    await writeFile(
      path.join(workspace, "pack.yaml"),
      `schemaVersion: 1
name: input-review
inputs:
  scope:
    required: true
    description: Review scope.
  severity:
    type: enum
    values: [low, medium, high]
    default: medium
  include_tests:
    type: boolean
    default: true
  report_path:
    type: string
tasks:
  - id: baseline
    title: Baseline review
  - id: deep
    title: Deep review
    when:
      severity: high
  - id: publish
    title: Publish report
    when: report_path
`,
    );

    await runCli(
      ["init", "--id", "input-pack", "--manifest", "./pack.yaml", "--input", "scope=auth changes"],
      { cwd: workspace },
    );

    const brief = await runCli(["brief", "--id", "input-pack"], { cwd: workspace });
    expect(brief.stdout).toContain("Inputs:");
    expect(brief.stdout).toContain("| scope | auth changes | yes | string | Review scope. |");
    expect(brief.stdout).toContain("Baseline review");
    expect(brief.stdout).not.toContain("Deep review");

    const activeTasks = await runCli(["task", "list", "--id", "input-pack"], { cwd: workspace });
    expect(activeTasks.stdout).toContain("Baseline review");
    expect(activeTasks.stdout).not.toContain("Deep review");

    const lockedTasks = await runCli(["task", "list", "--id", "input-pack", "--locked"], {
      cwd: workspace,
    });
    expect(lockedTasks.stdout).toContain("[locked]");
    expect(lockedTasks.stdout).toContain("Deep review");

    const inputList = await runCli(["input", "list", "--id", "input-pack", "--json"], {
      cwd: workspace,
    });
    expect(JSON.parse(inputList.stdout)).toMatchObject([
      { name: "scope", value: "auth changes", source: "cli" },
      { name: "severity", value: "medium", source: "default" },
      { name: "include_tests", value: true, source: "default" },
      { name: "report_path" },
    ]);

    const severity = await runCli(["input", "get", "severity", "--id", "input-pack"], {
      cwd: workspace,
    });
    expect(severity.stdout.trim()).toBe("medium");

    const setSeverity = await runCli(["input", "set", "severity", "high", "--id", "input-pack"], {
      cwd: workspace,
    });
    expect(setSeverity.stdout).toContain("Updated input severity.");
    expect(setSeverity.stdout).toContain("- t002 Deep review");

    const unlockedTasks = await runCli(["task", "list", "--id", "input-pack"], {
      cwd: workspace,
    });
    expect(unlockedTasks.stdout).toContain("Deep review");

    const completionEnv = { AGENT_PACK_ID: "input-pack" };
    const inputSubcommands = await runCli(["__complete", "g", "input"], {
      cwd: workspace,
      env: completionEnv,
    });
    expect(inputSubcommands.stdout).toBe("get\n");

    const inputKeys = await runCli(["__complete", "se", "input", "get"], {
      cwd: workspace,
      env: completionEnv,
    });
    expect(inputKeys.stdout).toBe("severity\n");

    const enumValues = await runCli(["__complete", "h", "input", "set", "severity"], {
      cwd: workspace,
      env: completionEnv,
    });
    expect(enumValues.stdout).toBe("high\n");

    const booleanValues = await runCli(["__complete", "f", "input", "set", "include_tests"], {
      cwd: workspace,
      env: completionEnv,
    });
    expect(booleanValues.stdout).toBe("false\n");
  });

  it("adds references and skills through command groups", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agent-pack-compose-smoke-"));
    await mkdir(path.join(workspace, "docs"), { recursive: true });
    await mkdir(path.join(workspace, "skills/review"), { recursive: true });
    await writeFile(path.join(workspace, "docs/api.md"), "# API\n");
    await writeFile(
      path.join(workspace, "skills/review/SKILL.md"),
      "---\nname: review\ndescription: Review skill.\n---\n",
    );

    await runCli(["init", "--id", "compose-pack", "Compose later."], { cwd: workspace });

    const reference = await runCli(["reference", "add", "./docs/api.md", "--id", "compose-pack"], {
      cwd: workspace,
    });
    expect(reference.stdout).toContain("Added 1 reference to pack compose-pack");
    expect(reference.stdout).toContain("References: 1");

    const duplicateReference = await runCli(
      ["reference", "add", "./docs/api.md", "--id", "compose-pack", "--json"],
      { cwd: workspace },
    );
    expect(JSON.parse(duplicateReference.stdout)).toMatchObject({
      references: [],
      skipped: [{ id: "r001", name: "api.md" }],
      summary: { id: "compose-pack", references: 1 },
    });

    const skill = await runCli(["skill", "add", "./skills", "--id", "compose-pack", "--json"], {
      cwd: workspace,
    });
    expect(JSON.parse(skill.stdout)).toMatchObject({
      skills: [{ id: "s001", name: "review" }],
      skipped: [],
      summary: { id: "compose-pack", skills: 1 },
    });

    const report = await runCli(["report", "--id", "compose-pack"], { cwd: workspace });
    expect(report.stdout).toContain("References:\n- r001 - api.md");
    expect(report.stdout).toContain("Skills:\n- s001 - review");
  });

  it("adds ad hoc tasks through the task add command", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agent-pack-task-add-smoke-"));

    await runCli(["init", "--id", "task-add-pack", "--add-task", "Original task"], {
      cwd: workspace,
    });

    const added = await runCli(
      [
        "task",
        "add",
        "Review auth flow",
        "--id",
        "task-add-pack",
        "--category",
        "review",
        "--body",
        "Inspect request handling.",
        "--done-when",
        "Findings cite files",
        "--done-when",
        "Test gaps are noted",
      ],
      { cwd: workspace },
    );
    expect(added.stdout).toContain("Pack: task-add-pack");
    expect(added.stdout).toContain("Tasks: 0/2 completed, 0 blocked");

    const shown = await runCli(["task", "show", "t002", "--id", "task-add-pack"], {
      cwd: workspace,
    });
    expect(shown.stdout).toContain("Title: Review auth flow");
    expect(shown.stdout).toContain("Category: review");
    expect(shown.stdout).toContain("Body:\nInspect request handling.");
    expect(shown.stdout).toContain("Findings cite files");
    expect(shown.stdout).toContain("Test gaps are noted");

    const addedJson = await runCli(
      ["task", "add", "JSON task", "--id", "task-add-pack", "--json"],
      { cwd: workspace },
    );
    expect(JSON.parse(addedJson.stdout)).toMatchObject({
      task: { id: "t003", title: "JSON task", status: "pending" },
      summary: {
        id: "task-add-pack",
        status: "pending",
        tasks: { total: 3, pending: 3 },
      },
    });

    const emptyTitle = await runCli(["task", "add", "", "--id", "task-add-pack"], {
      cwd: workspace,
      reject: false,
    });
    expect(emptyTitle.stderr).toContain("task title must not be empty");

    const emptyDoneWhen = await runCli(
      ["task", "add", "Bad criteria", "--id", "task-add-pack", "--done-when", " "],
      { cwd: workspace, reject: false },
    );
    expect(emptyDoneWhen.stderr).toContain("task done-when must not be empty");
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
    await mkdir(path.join(configDir, "references/review"), { recursive: true });
    await mkdir(path.join(configDir, "skills/review/fresh-eyes"), { recursive: true });
    await writeFile(path.join(configDir, "manifests/review/code-review.yaml"), "tasks: []\n");
    await writeFile(path.join(configDir, "manifests/$(touch owned).yaml"), "tasks: []\n");
    await writeFile(path.join(configDir, "tasks/review/security.yaml"), "title: Security\n");
    await writeFile(path.join(configDir, "references/review/api.yaml"), "ref: ./docs/api.md\n");
    await writeFile(
      path.join(configDir, "skills/review/fresh-eyes/SKILL.md"),
      "---\ndescription: Review skill\n---\n",
    );
    const env = { AGENT_PACK_CONFIG_DIR: configDir };

    const instructions = await runCli(["completion", "bash"], { cwd: workspace, env });
    expect(instructions.stdout).toContain("For this shell only:");
    expect(instructions.stdout).toContain("source <(agent-pack completion script bash)");
    expect(instructions.stdout).toContain(
      "agent-pack completion script bash > ~/.local/share/agent-pack/completion.bash",
    );
    expect(instructions.stdout).toContain("source ~/.local/share/agent-pack/completion.bash");
    expect(instructions.stdout).toContain("Regenerate that file after upgrading agent-pack.");

    const zshInstructions = await runCli(["completion", "zsh"], { cwd: workspace, env });
    expect(zshInstructions.stdout).toContain(
      "agent-pack completion script zsh > ~/.local/share/agent-pack/completion.zsh",
    );
    expect(zshInstructions.stdout).toContain("source ~/.local/share/agent-pack/completion.zsh");

    const fishInstructions = await runCli(["completion", "fish"], { cwd: workspace, env });
    expect(fishInstructions.stdout).toContain(
      "agent-pack completion script fish > ~/.config/fish/completions/agent-pack.fish",
    );

    const script = await runCli(["completion", "script", "bash"], { cwd: workspace, env });
    expect(script.stdout).toContain("complete -F _agent_pack_completion agent-pack");
    expect(script.stdout).toContain('agent-pack __complete -- "$cur"');

    const zshScript = await runCli(["completion", "script", "zsh"], { cwd: workspace, env });
    expect(zshScript.stdout).toContain("compdef _agent_pack agent-pack");
    expect(zshScript.stdout).toContain("if (( CURRENT > 2 )); then");
    expect(zshScript.stdout).toContain('agent-pack __complete -- "$current"');

    const fishScript = await runCli(["completion", "script", "fish"], { cwd: workspace, env });
    expect(fishScript.stdout).toContain("function __agent_pack_complete");
    expect(fishScript.stdout).toContain('agent-pack __complete -- "$current"');
    expect(fishScript.stdout).toContain("complete -c agent-pack -f");

    const topLevelCandidates = await runCli(["__complete", ""], { cwd: workspace, env });
    expect(topLevelCandidates.stdout).toContain("init\n");
    expect(topLevelCandidates.stdout).toContain("task\n");
    expect(topLevelCandidates.stdout).toContain("reference\n");
    expect(topLevelCandidates.stdout).toContain("skill\n");

    const taskSubcommandCandidates = await runCli(["__complete", "d", "task"], {
      cwd: workspace,
      env,
    });
    expect(taskSubcommandCandidates.stdout).toBe("done\n");

    const initOptionCandidates = await runCli(["__complete", "--", "--mani", "init"], {
      cwd: workspace,
      env,
    });
    expect(initOptionCandidates.stdout).toBe("--manifest\n--manifests\n");

    const briefOptionCandidates = await runCli(["__complete", "", "brief"], {
      cwd: workspace,
      env,
    });
    expect(briefOptionCandidates.stdout).toBe("--id\n");

    const taskOptionCandidates = await runCli(["__complete", "--", "--", "task", "done"], {
      cwd: workspace,
      env,
    });
    expect(taskOptionCandidates.stdout).toContain("--id\n");
    expect(taskOptionCandidates.stdout).toContain("--note\n");

    const taskOptionCandidatesWithoutDash = await runCli(["__complete", "", "task", "done"], {
      cwd: workspace,
      env,
    });
    expect(taskOptionCandidatesWithoutDash.stdout).toContain("--id\n");
    expect(taskOptionCandidatesWithoutDash.stdout).toContain("--note\n");

    const gitRefreshCandidates = await runCli(["__complete", "au", "sync", "--git-refresh"], {
      cwd: workspace,
      env,
    });
    expect(gitRefreshCandidates.stdout).toBe("auto\n");

    const gitRefreshEqualsCandidates = await runCli(
      ["__complete", "--", "--git-refresh=au", "sync"],
      {
        cwd: workspace,
        env,
      },
    );
    expect(gitRefreshEqualsCandidates.stdout).toBe("--git-refresh=auto\n");

    const catalogTypeCandidates = await runCli(["__complete", "m", "catalog", "list", "--type"], {
      cwd: workspace,
      env,
    });
    expect(catalogTypeCandidates.stdout).toBe("manifest\n");

    const catalogSubcommandCandidates = await runCli(["__complete", "p", "catalog"], {
      cwd: workspace,
      env,
    });
    expect(catalogSubcommandCandidates.stdout).toBe("path\n");

    const referenceSubcommandCandidates = await runCli(["__complete", "a", "reference"], {
      cwd: workspace,
      env,
    });
    expect(referenceSubcommandCandidates.stdout).toBe("add\n");

    const skillSubcommandCandidates = await runCli(["__complete", "a", "skill"], {
      cwd: workspace,
      env,
    });
    expect(skillSubcommandCandidates.stdout).toBe("add\n");

    const referenceAddCandidates = await runCli(["__complete", "review/a", "reference", "add"], {
      cwd: workspace,
      env,
    });
    expect(referenceAddCandidates.stdout).toBe("review/api\n");

    const skillAddCandidates = await runCli(["__complete", "review/f", "skill", "add"], {
      cwd: workspace,
      env,
    });
    expect(skillAddCandidates.stdout).toBe("review/fresh-eyes\n");

    const referenceAddOptionCandidates = await runCli(
      ["__complete", "--", "--", "reference", "add", "review/api"],
      {
        cwd: workspace,
        env,
      },
    );
    expect(referenceAddOptionCandidates.stdout).toContain("--id\n");
    expect(referenceAddOptionCandidates.stdout).toContain("--git-refresh\n");
    expect(referenceAddOptionCandidates.stdout).toContain("--json\n");

    const shellCandidates = await runCli(["__complete", "b", "completion", "script"], {
      cwd: workspace,
      env,
    });
    expect(shellCandidates.stdout).toBe("bash\n");

    const manifestCandidates = await runCli(["__complete", "review/", "init", "--manifest"], {
      cwd: workspace,
      env,
    });
    expect(manifestCandidates.stdout).toBe("review/code-review\n");

    const allManifestCandidates = await runCli(["__complete", "", "init", "--manifest"], {
      cwd: workspace,
      env,
    });
    expect(allManifestCandidates.stdout).toContain("review/code-review\n");
    expect(allManifestCandidates.stdout).not.toContain("$(touch owned)");

    const taskCandidates = await runCli(["__complete", "review/s", "init", "--task"], {
      cwd: workspace,
      env,
    });
    expect(taskCandidates.stdout).toBe("review/security\n");

    const referenceCandidates = await runCli(["__complete", "review/a", "init", "--reference"], {
      cwd: workspace,
      env,
    });
    expect(referenceCandidates.stdout).toBe("review/api\n");

    const skillCandidates = await runCli(["__complete", "review/f", "init", "--skill"], {
      cwd: workspace,
      env,
    });
    expect(skillCandidates.stdout).toBe("review/fresh-eyes\n");

    const repeatedOptionCandidates = await runCli(
      ["__complete", "review/", "init", "--manifest", "review/code-review", "--manifest"],
      {
        cwd: workspace,
        env,
      },
    );
    expect(repeatedOptionCandidates.stdout).toBe("review/code-review\n");

    const catalogNameCandidates = await runCli(
      ["__complete", "review/", "catalog", "show", "manifest"],
      {
        cwd: workspace,
        env,
      },
    );
    expect(catalogNameCandidates.stdout).toBe("review/code-review\n");

    const pathCandidates = await runCli(["__complete", "./tasks", "init", "--task"], {
      cwd: workspace,
      env,
    });
    expect(pathCandidates.stdout).toBe("");

    const absolutePathCandidates = await runCli(["__complete", "/tmp/tasks", "init", "--task"], {
      cwd: workspace,
      env,
    });
    expect(absolutePathCandidates.stdout).toBe("");

    const homePathCandidates = await runCli(["__complete", "~", "init", "--task"], {
      cwd: workspace,
      env,
    });
    expect(homePathCandidates.stdout).toBe("");

    const homeSlashPathCandidates = await runCli(["__complete", "~/tasks", "init", "--task"], {
      cwd: workspace,
      env,
    });
    expect(homeSlashPathCandidates.stdout).toBe("");

    const emptyWorkspace = await mkdtemp(path.join(os.tmpdir(), "agent-pack-empty-completion-"));
    const missingConfigDir = path.join(emptyWorkspace, "missing-config");
    const missingConfigEnv = { AGENT_PACK_CONFIG_DIR: missingConfigDir };
    const missingCatalogCandidates = await runCli(["__complete", "", "init", "--manifest"], {
      cwd: emptyWorkspace,
      env: missingConfigEnv,
    });
    expect(missingCatalogCandidates.stdout).toBe("");
    expect(existsSync(path.join(missingConfigDir, "manifests"))).toBe(false);
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
    await mkdir(path.join(repo, "extras/skill"), { recursive: true });
    await mkdir(path.join(repo, "skills/review"), { recursive: true });
    await writeFile(path.join(repo, "docs/reference.md"), "# Reference\n");
    await writeFile(path.join(repo, "docs/extra-reference.md"), "# Extra Reference\n");
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
      path.join(repo, "extras/skill/SKILL.md"),
      "---\nname: extra-skill\ndescription: Extra git skill.\n---\n",
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

    const addedGitReference = await runCli(
      [
        "reference",
        "add",
        `git+${remoteUrl}//docs/extra-reference.md#main`,
        "--id",
        "git-pack",
        "--git-refresh",
        "never",
        "--json",
      ],
      { cwd: workspace },
    );
    expect(JSON.parse(addedGitReference.stdout)).toMatchObject({
      references: [
        {
          id: "r003",
          name: "extra-reference.md",
          source: { kind: "git", path: "docs/extra-reference.md" },
        },
      ],
      skipped: [],
      summary: { id: "git-pack", references: 3 },
    });

    const addedGitSkill = await runCli(
      [
        "skill",
        "add",
        `git+${remoteUrl}//extras/skill/SKILL.md#main`,
        "--id",
        "git-pack",
        "--git-refresh",
        "never",
        "--json",
      ],
      { cwd: workspace },
    );
    expect(JSON.parse(addedGitSkill.stdout)).toMatchObject({
      skills: [
        {
          id: "s003",
          name: "extra-skill",
          source: { kind: "git", path: "extras/skill/SKILL.md" },
        },
      ],
      skipped: [],
      summary: { id: "git-pack", skills: 3 },
    });

    const duplicateGitReference = await runCli(
      [
        "reference",
        "add",
        `git+${remoteUrl}//docs/extra-reference.md#main`,
        "--id",
        "git-pack",
        "--git-refresh",
        "never",
        "--json",
      ],
      { cwd: workspace },
    );
    expect(JSON.parse(duplicateGitReference.stdout)).toMatchObject({
      references: [],
      skipped: [{ id: "r003", name: "extra-reference.md" }],
      summary: { id: "git-pack", references: 3 },
    });

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
