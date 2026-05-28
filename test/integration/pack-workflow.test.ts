import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addReference,
  addSkill,
  addTask,
  brief,
  catalogList,
  catalogShow,
  cleanCache,
  getInput,
  initPack,
  listInputs,
  listPacks,
  listTasks,
  runPack,
  setInput,
  status,
  summaryPack,
  unsetInput,
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
    cwd = process.cwd();
    vi.stubEnv("AGENT_PACK_BRIEF_TASK_CONTENT", undefined);
    vi.stubEnv("AGENT_PACK_CONFIG_DIR", undefined);
    vi.stubEnv("AGENT_PACK_ID", undefined);
    vi.stubEnv("AGENT_PACK_CREATE_ID", undefined);
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
      createId: "design-review",
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

  it("uses AGENT_PACK_CREATE_ID for init when --create-id is omitted", async () => {
    vi.stubEnv("AGENT_PACK_CREATE_ID", "env-review");

    const pack = await initPack({
      includes: [{ type: "adHocTask", text: "Inspect env-selected pack." }],
      gitRefresh: "auto",
    });

    expect(pack.id).toBe("env-review");
  });

  it("ignores AGENT_PACK_ID when creating packs", async () => {
    vi.stubEnv("AGENT_PACK_ID", "env-review");

    const pack = await initPack({
      includes: [{ type: "adHocTask", text: "Inspect env-selected pack." }],
      gitRefresh: "auto",
    });

    expect(pack.id).toMatch(/^pack-[a-f0-9]{6}$/);
  });

  it("stores manifest-provided agents", async () => {
    await writeFile(
      "pack.yaml",
      `schemaVersion: 1
agents:
  - name: claude
    command: claude
    args: ["--print", "{prompt}"]
`,
    );

    const pack = await initPack({
      createId: "agent-pack",
      includes: [{ type: "manifest", ref: "./pack.yaml" }],
      gitRefresh: "auto",
    });

    expect(pack.agents).toEqual([
      {
        name: "claude",
        command: "claude",
        args: ["--print", "{prompt}"],
        timeoutSec: undefined,
        source: { kind: "file", path: "./pack.yaml" },
      },
    ]);
  });

  it("loads catalog and local agent refs", async () => {
    const configDir = path.join(cwd, "config");
    vi.stubEnv("AGENT_PACK_CONFIG_DIR", configDir);
    await mkdir(path.join(configDir, "agents"), { recursive: true });
    await writeFile(path.join(configDir, "agents", "catalog-agent.yaml"), "command: node\n");
    await writeFile("local-agent.yaml", "name: local-agent\ncommand: node\n");

    const pack = await initPack({
      createId: "agent-refs",
      includes: [
        { type: "agentRef", ref: "catalog-agent" },
        { type: "agentRef", ref: "./local-agent.yaml" },
      ],
      gitRefresh: "auto",
    });

    expect(pack.agents?.map((agent) => [agent.name, agent.command])).toEqual([
      ["catalog-agent", "node"],
      ["local-agent", "node"],
    ]);
  });

  it("rejects duplicate agent names", async () => {
    await writeFile("first.yaml", "name: claude\ncommand: claude\n");
    await writeFile("second.yaml", "name: claude\ncommand: claude\n");

    await expect(
      initPack({
        createId: "duplicate-agents",
        includes: [
          { type: "agentRef", ref: "./first.yaml" },
          { type: "agentRef", ref: "./second.yaml" },
        ],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow('duplicate agent name "claude"');
  });

  it("runs the only configured agent and records stdout", async () => {
    await writeFile(
      "agent.yaml",
      `name: echo-agent
command: ${JSON.stringify(process.execPath)}
args:
  - -e
  - "process.stdout.write(process.argv[1])"
  - "{prompt}"
`,
    );
    const pack = await initPack({
      createId: "run-one-agent",
      includes: [
        {
          type: "agentRef",
          ref: "./agent.yaml",
        },
      ],
      gitRefresh: "auto",
    });

    expect(pack.id).toBe("run-one-agent");
    const result = await runPack({ packId: "run-one-agent" });

    expect(result.exitCode).toBe(0);
    expect(result.run).toMatchObject({
      id: "a001",
      agent: "echo-agent",
      mode: "captured",
      status: "completed",
      exitCode: 0,
      timedOut: false,
      stdoutTruncated: false,
    });
    expect(result.run.stdout).toContain("Run agent-pack brief and follow the instructions");
    expect(result.run.stdout).not.toContain("brief --id");
    expect(result.pack.agentRuns).toHaveLength(1);
    const events = await readEvents("run-one-agent");
    expect(events.at(-1)).toMatchObject({
      type: "agent.run",
      data: {
        runId: "a001",
        agent: "echo-agent",
        mode: "captured",
        status: "completed",
        exitCode: 0,
      },
    });
  });

  it("runs interactive agents without timeout or output capture", async () => {
    await writeFile(
      "agent.yaml",
      nodeAgentYaml("interactive-agent", "setTimeout(() => process.exit(0), 150)", "timeoutSec: 1"),
    );
    await initPack({
      createId: "interactive-agent-pack",
      includes: [{ type: "agentRef", ref: "./agent.yaml" }],
      gitRefresh: "auto",
    });

    const result = await runPack({ packId: "interactive-agent-pack", interactive: true });

    expect(result.exitCode).toBe(0);
    expect(result.run).toMatchObject({
      id: "a001",
      agent: "interactive-agent",
      mode: "interactive",
      status: "completed",
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: "",
      stdoutTruncated: false,
    });
    expect(result.pack.agentRuns?.[0]).toMatchObject({
      mode: "interactive",
      stdout: "",
      stdoutTruncated: false,
    });
  });

  it("returns interactive agent exit codes", async () => {
    await writeFile("agent.yaml", nodeAgentYaml("interactive-fail-agent", "process.exit(7)"));
    await initPack({
      createId: "interactive-fail-pack",
      includes: [{ type: "agentRef", ref: "./agent.yaml" }],
      gitRefresh: "auto",
    });

    const result = await runPack({ packId: "interactive-fail-pack", interactive: true });

    expect(result.exitCode).toBe(7);
    expect(result.run).toMatchObject({
      mode: "interactive",
      status: "failed",
      exitCode: 7,
      stdout: "",
    });
  });

  it("requires --run-agent when a pack has multiple agents", async () => {
    await writeFile("first.yaml", "name: first\ncommand: node\n");
    await writeFile("second.yaml", "name: second\ncommand: node\n");
    await initPack({
      createId: "multi-agent",
      includes: [
        { type: "agentRef", ref: "./first.yaml" },
        { type: "agentRef", ref: "./second.yaml" },
      ],
      gitRefresh: "auto",
    });

    await expect(runPack({ packId: "multi-agent" })).rejects.toThrow(
      "--run-agent is required; available agents: first, second",
    );
  });

  it("records failed agent exits", async () => {
    await writeFile(
      "agent.yaml",
      `name: fail-agent
command: ${JSON.stringify(process.execPath)}
args:
  - -e
  - "process.stdout.write('failed output'); process.exit(7)"
`,
    );
    await initPack({
      createId: "fail-agent-pack",
      includes: [{ type: "agentRef", ref: "./agent.yaml" }],
      gitRefresh: "auto",
    });

    const result = await runPack({ packId: "fail-agent-pack" });

    expect(result.exitCode).toBe(1);
    expect(result.run).toMatchObject({
      status: "failed",
      exitCode: 7,
      stdout: "failed output",
      stdoutTruncated: false,
    });
    expect(result.pack.agentRuns?.[0]).toMatchObject({ status: "failed", exitCode: 7 });
  });

  it("records failed agent spawns", async () => {
    await writeFile(
      "agent.yaml",
      `name: missing-agent
command: definitely-not-an-agent-pack-test-command
`,
    );
    await initPack({
      createId: "spawn-failure-pack",
      includes: [{ type: "agentRef", ref: "./agent.yaml" }],
      gitRefresh: "auto",
    });

    const result = await runPack({ packId: "spawn-failure-pack" });

    expect(result.exitCode).toBe(1);
    expect(result.run).toMatchObject({
      status: "failed",
      exitCode: null,
      signal: null,
      stdout: "",
      stdoutTruncated: false,
    });
    expect(result.pack.agentRuns?.[0]).toMatchObject({ status: "failed" });
  });

  it("records agent signal termination", async () => {
    await writeFile(
      "agent.yaml",
      nodeAgentYaml("signal-agent", "process.kill(process.pid, 'SIGTERM')"),
    );
    await initPack({
      createId: "signal-agent-pack",
      includes: [{ type: "agentRef", ref: "./agent.yaml" }],
      gitRefresh: "auto",
    });

    const result = await runPack({ packId: "signal-agent-pack" });

    expect(result.exitCode).toBe(1);
    expect(result.run).toMatchObject({
      status: "signaled",
      exitCode: null,
      signal: "SIGTERM",
      timedOut: false,
    });
  });

  it("records timed out agents and kills agents that ignore SIGINT", async () => {
    await writeFile(
      "agent.yaml",
      nodeAgentYaml(
        "timeout-agent",
        "process.on('SIGINT', () => {}); setInterval(() => {}, 1000)",
        "timeoutSec: 1",
      ),
    );
    await initPack({
      createId: "timeout-agent-pack",
      includes: [{ type: "agentRef", ref: "./agent.yaml" }],
      gitRefresh: "auto",
    });

    const result = await runPack({ packId: "timeout-agent-pack" });

    expect(result.exitCode).toBe(1);
    expect(result.run).toMatchObject({
      status: "timed_out",
      exitCode: null,
      signal: "SIGKILL",
      timedOut: true,
    });
  }, 10_000);

  it("does not apply a default timeout when timeoutSec is omitted", async () => {
    await writeFile(
      "agent.yaml",
      nodeAgentYaml("slow-agent", "setTimeout(() => process.stdout.write('done'), 150)"),
    );
    await initPack({
      createId: "no-timeout-agent-pack",
      includes: [{ type: "agentRef", ref: "./agent.yaml" }],
      gitRefresh: "auto",
    });

    const result = await runPack({ packId: "no-timeout-agent-pack" });

    expect(result.exitCode).toBe(0);
    expect(result.run).toMatchObject({
      status: "completed",
      exitCode: 0,
      timedOut: false,
      stdout: "done",
    });
  });

  it("caps captured stdout and marks truncated output", async () => {
    await writeFile(
      "agent.yaml",
      nodeAgentYaml("verbose-agent", "process.stdout.write('x'.repeat(70 * 1024))"),
    );
    await initPack({
      createId: "verbose-agent-pack",
      includes: [{ type: "agentRef", ref: "./agent.yaml" }],
      gitRefresh: "auto",
    });

    const result = await runPack({ packId: "verbose-agent-pack" });

    expect(result.exitCode).toBe(0);
    expect(result.run).toMatchObject({
      status: "completed",
      exitCode: 0,
      stdoutTruncated: true,
    });
    expect(Buffer.byteLength(result.run.stdout, "utf8")).toBe(64 * 1024);
  });

  it("captures inputs, hides locked tasks, and unlocks them when inputs change", async () => {
    await writeFile(
      "pack.yaml",
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
  - id: strict-tests
    title: Strict test review
    when:
      severity: high
      include_tests: true
  - id: publish
    title: Publish report
    when: report_path
`,
    );

    const pack = await initPack({
      createId: "input-review",
      includes: [{ type: "manifest", ref: "./pack.yaml" }],
      inputAssignments: ["scope=auth changes"],
      gitRefresh: "auto",
    });

    expect(pack.inputs).toMatchObject({
      scope: "auth changes",
      severity: "medium",
      include_tests: true,
    });
    expect(pack.inputSources).toMatchObject({
      scope: { source: "cli" },
      severity: { source: "default" },
      include_tests: { source: "default" },
    });
    expect(pack.tasks.map((task) => [task.id, task.activation])).toEqual([
      ["t001", "active"],
      ["t002", "locked"],
      ["t003", "locked"],
      ["t004", "locked"],
    ]);
    expect(pack.taskCounts).toMatchObject({ total: 1, pending: 1 });

    await expect(brief("input-review")).resolves.toContain("Inputs:");
    await expect(brief("input-review")).resolves.toContain("| scope | auth changes | yes | string");
    await expect(brief("input-review")).resolves.not.toContain("Deep review");
    await expect(listTasks("input-review")).resolves.toContain("t001 - Baseline review");
    await expect(listTasks("input-review")).resolves.not.toContain("Deep review");
    await expect(listTasks("input-review", "locked")).resolves.toContain(
      "[locked] t002 - Deep review",
    );

    const severity = await setInput("severity", "high", "input-review");

    expect(severity.unlocked.map((task) => task.id)).toEqual(["t002", "t003"]);
    expect(severity.pack.taskCounts).toMatchObject({ total: 3, pending: 3 });
    await expect(listTasks("input-review")).resolves.toContain("t003 - Strict test review");

    const reverted = await unsetInput("severity", "input-review");

    expect(reverted.input).toMatchObject({ name: "severity", value: "medium", source: "default" });
    expect(reverted.unlocked).toEqual([]);
    expect(reverted.pack.tasks.find((task) => task.id === "t002")?.activation).toBe("active");

    const reportPath = await setInput("report_path", "reports/out.md", "input-review");

    expect(reportPath.unlocked.map((task) => task.id)).toEqual(["t004"]);
    await expect(getInput("report_path", "input-review")).resolves.toMatchObject({
      value: "reports/out.md",
      source: "set",
    });
    await expect(unsetInput("scope", "input-review")).rejects.toThrow(
      "required input cannot be unset: scope",
    );
    await expect(listInputs("input-review")).resolves.toHaveLength(4);
  });

  it("rejects invalid inputs and condition shapes before writing state", async () => {
    await writeFile(
      "pack.yaml",
      `schemaVersion: 1
inputs:
  scope:
    required: true
  severity:
    type: enum
    values: [low, high]
tasks:
  - title: Inspect
`,
    );

    await expect(
      initPack({
        createId: "missing-required-input",
        includes: [{ type: "manifest", ref: "./pack.yaml" }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("missing required input: scope");

    await expect(
      initPack({
        createId: "bad-enum-input",
        includes: [{ type: "manifest", ref: "./pack.yaml" }],
        inputAssignments: ["scope=auth", "severity=medium"],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("input severity must be one of");

    await expect(
      initPack({
        createId: "unknown-input",
        includes: [{ type: "manifest", ref: "./pack.yaml" }],
        inputAssignments: ["scope=auth", "unknown=value"],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("unknown input: unknown");

    await expect(summaryPack("missing-required-input")).rejects.toThrow(
      "pack not found: missing-required-input",
    );

    await writeFile(
      "number-pack.yaml",
      `schemaVersion: 1
inputs:
  count:
    type: number
    default: 1
  include_tests:
    type: boolean
tasks:
  - title: Inspect
`,
    );

    const numberPack = await initPack({
      createId: "number-inputs",
      includes: [{ type: "manifest", ref: "./number-pack.yaml" }],
      inputAssignments: ["count=2", "include_tests=1"],
      gitRefresh: "auto",
    });

    expect(numberPack.inputs).toMatchObject({ count: 2, include_tests: true });
    await expect(
      initPack({
        createId: "empty-number-init",
        includes: [{ type: "manifest", ref: "./number-pack.yaml" }],
        inputAssignments: ["count="],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("input count must be a finite number");
    await expect(setInput("count", "", "number-inputs")).rejects.toThrow(
      "input count must be a finite number",
    );
    await expect(setInput("include_tests", "0", "number-inputs")).resolves.toMatchObject({
      input: { name: "include_tests", value: false },
    });
    await expect(getInput("count", "number-inputs")).resolves.toMatchObject({ value: 2 });

    await writeFile(
      "input-a.yaml",
      `schemaVersion: 1
inputs:
  severity:
    type: enum
    values: [low, high]
    default: low
`,
    );
    await writeFile(
      "input-b.yaml",
      `schemaVersion: 1
inputs:
  severity:
    type: enum
    values: [low, high]
    default: high
`,
    );
    await expect(
      initPack({
        createId: "conflicting-inputs",
        includes: [
          { type: "manifest", ref: "./input-a.yaml" },
          { type: "manifest", ref: "./input-b.yaml" },
        ],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("conflicting input definition: severity");
  });

  it("rejects invalid task conditions and locked task updates", async () => {
    await writeFile(
      "bad-when.yaml",
      `schemaVersion: 1
inputs:
  severity:
    type: enum
    values: [low, high]
tasks:
  - title: Bad expression
    when: severity == high
`,
    );
    await expect(
      initPack({
        createId: "bad-when",
        includes: [{ type: "manifest", ref: "./bad-when.yaml" }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("when must be an input name or object");

    await writeFile(
      "locked.yaml",
      `schemaVersion: 1
inputs:
  gate:
    type: boolean
tasks:
  - id: gated
    title: Gated task
    when:
      gate: true
`,
    );
    await initPack({
      createId: "locked-task-update",
      includes: [{ type: "manifest", ref: "./locked.yaml" }],
      gitRefresh: "auto",
    });

    await expect(
      updateTask("t001", "in_progress", undefined, "locked-task-update"),
    ).rejects.toThrow("task is locked: t001");
  });

  it("adds an ad hoc task to an existing pack", async () => {
    await initPack({
      createId: "add-task-pack",
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
      activation: "active",
      notes: [],
    });
    expect(pack.taskCounts).toMatchObject({ total: 2, pending: 2, completed: 0 });
    expect(pack.status).toBe("pending");

    const loaded = await summaryPack("add-task-pack");
    expect(loaded.tasks[1]).toMatchObject(task);
    await expect(brief("add-task-pack")).resolves.toContain("  Inspect request handling.");
    await expect(brief("add-task-pack")).resolves.toContain("  - Findings cite files");
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

  it("rejects task add for a missing pack", async () => {
    await expect(addTask({ packId: "missing-pack", title: "New task" })).rejects.toThrow(
      "pack not found: missing-pack",
    );
  });

  it("rejects empty task add fields before mutating state", async () => {
    await initPack({
      createId: "reject-empty-add",
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

  it("adds references to an existing pack and skips duplicate sources", async () => {
    const configDir = path.join(cwd, "config");
    vi.stubEnv("AGENT_PACK_CONFIG_DIR", configDir);
    await mkdir("docs", { recursive: true });
    await mkdir(path.join(configDir, "references/product"), { recursive: true });
    await writeFile("docs/intro.md", "# Intro\n");
    await writeFile("docs/api.md", "# API\n");
    await writeFile(
      path.join(configDir, "references/product/api.yaml"),
      "name: product api\ndescription: API docs.\nref: ./docs/api.md\n",
    );
    await initPack({
      createId: "reference-add-pack",
      includes: [{ type: "reference", ref: { ref: "./docs/intro.md" } }],
      gitRefresh: "auto",
    });

    const added = await addReference({
      packId: "reference-add-pack",
      ref: "product/api",
      gitRefresh: "auto",
    });

    expect(added.references).toMatchObject([
      {
        id: "r002",
        name: "product api",
        description: "API docs.",
        source: { kind: "file", path: "./docs/api.md" },
        path: "./docs/api.md",
      },
    ]);
    expect(added.skipped).toEqual([]);

    const duplicate = await addReference({
      packId: "reference-add-pack",
      ref: "./docs/api.md",
      gitRefresh: "auto",
    });

    expect(duplicate.references).toEqual([]);
    expect(duplicate.skipped).toMatchObject([{ id: "r002", name: "product api" }]);
    const loaded = await summaryPack("reference-add-pack");
    expect(loaded.references.map((reference) => reference.id)).toEqual(["r001", "r002"]);
    expect(loaded.references).toHaveLength(2);
    const events = await readEvents("reference-add-pack");
    expect(events.at(-2)).toMatchObject({
      type: "reference.added",
      data: { ref: "product/api", addedCount: 1, skippedCount: 0, added: ["r002"] },
    });
    expect(events.at(-1)).toMatchObject({
      type: "reference.added",
      data: { ref: "./docs/api.md", addedCount: 0, skippedCount: 1, skipped: ["r002"] },
    });
  });

  it("deduplicates reference sources regardless of persisted source key order", async () => {
    await mkdir(".agent-pack/state/packs", { recursive: true });
    await writeFile(
      ".agent-pack/state/packs/reordered-source-key.json",
      JSON.stringify({
        schemaVersion: 1,
        id: "reordered-source-key",
        status: "no_tasks",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        repoRoot: ".",
        taskCounts: { total: 0, pending: 0, inProgress: 0, completed: 0, blocked: 0 },
        tasks: [],
        references: [
          {
            id: "r001",
            name: "api",
            source: {
              url: "https://example.com/api.md",
              kind: "url",
            },
            path: "https://example.com/api.md",
          },
        ],
        skills: [],
      }),
    );

    const result = await addReference({
      packId: "reordered-source-key",
      ref: "https://example.com/api.md",
      gitRefresh: "auto",
    });

    expect(result.references).toEqual([]);
    expect(result.skipped).toMatchObject([{ id: "r001", name: "api" }]);
    const loaded = await summaryPack("reordered-source-key");
    expect(loaded.references).toHaveLength(1);
  });

  it("adds skills to an existing pack and skips duplicate sources", async () => {
    vi.stubEnv("AGENT_PACK_ID", "skill-add-pack");
    await mkdir("skills/first", { recursive: true });
    await mkdir("skills/second", { recursive: true });
    await writeFile("skills/first/SKILL.md", "---\nname: review\ndescription: First skill.\n---\n");
    await writeFile(
      "skills/second/SKILL.md",
      "---\nname: review\ndescription: Second skill.\n---\n",
    );
    await initPack({
      createId: "skill-add-pack",
      includes: [{ type: "skill", ref: { ref: "./skills/first/SKILL.md" } }],
      gitRefresh: "auto",
    });

    const result = await addSkill({ ref: "./skills", gitRefresh: "auto" });

    expect(result.skills).toMatchObject([
      {
        id: "s002",
        name: "review (2)",
        description: "Second skill.",
        source: { kind: "file", path: "./skills/second/SKILL.md" },
      },
    ]);
    expect(result.skipped).toMatchObject([{ id: "s001", name: "review" }]);

    const duplicate = await addSkill({
      packId: "skill-add-pack",
      ref: "./skills",
      gitRefresh: "auto",
    });

    expect(duplicate.skills).toEqual([]);
    expect(duplicate.skipped.map((skill) => skill.id)).toEqual(["s001", "s002"]);
    const loaded = await summaryPack("skill-add-pack");
    expect(loaded.skills.map((skill) => [skill.id, skill.name])).toEqual([
      ["s001", "review"],
      ["s002", "review (2)"],
    ]);
  });

  it("preserves explicit skill names with numeric suffixes when adding skills", async () => {
    await mkdir("skills/explicit", { recursive: true });
    await writeFile("skills/explicit/SKILL.md", "---\nname: review (2)\n---\n");
    await initPack({
      createId: "explicit-skill-name",
      includes: [],
      gitRefresh: "auto",
    });

    const result = await addSkill({
      packId: "explicit-skill-name",
      ref: "./skills/explicit/SKILL.md",
      gitRefresh: "auto",
    });

    expect(result.skills).toMatchObject([{ id: "s001", name: "review (2)" }]);
    const loaded = await summaryPack("explicit-skill-name");
    expect(loaded.skills.map((skill) => skill.name)).toEqual(["review (2)"]);
  });

  it("assigns the next available skill suffix only when a name collides", async () => {
    await mkdir("skills/first", { recursive: true });
    await mkdir("skills/second", { recursive: true });
    await mkdir("skills/third", { recursive: true });
    await writeFile("skills/first/SKILL.md", "---\nname: review\n---\n");
    await writeFile("skills/second/SKILL.md", "---\nname: review (2)\n---\n");
    await writeFile("skills/third/SKILL.md", "---\nname: review\n---\n");
    await initPack({
      createId: "skill-name-collision",
      includes: [
        { type: "skill", ref: { ref: "./skills/first/SKILL.md" } },
        { type: "skill", ref: { ref: "./skills/second/SKILL.md" } },
      ],
      gitRefresh: "auto",
    });

    const result = await addSkill({
      packId: "skill-name-collision",
      ref: "./skills/third/SKILL.md",
      gitRefresh: "auto",
    });

    expect(result.skills).toMatchObject([{ id: "s003", name: "review (3)" }]);
    const loaded = await summaryPack("skill-name-collision");
    expect(loaded.skills.map((skill) => skill.name)).toEqual([
      "review",
      "review (2)",
      "review (3)",
    ]);
  });

  it("updates status and counts when adding to a completed pack", async () => {
    await initPack({
      createId: "completed-add",
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
      createId: "concurrent-adds",
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
      createId: "ordered-pack",
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
      createId: "skill-dir",
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
        createId: "ambiguous-local",
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
        createId: "unsupported-field-pack",
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
        createId: "unsupported-nested-pack",
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
        createId: "bad-include-metadata",
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
        createId: "empty-include-metadata",
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
        createId: "empty-skill-metadata",
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
        createId: "bad-contract",
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
        createId: "bad-manifest-task",
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
        createId: "alias-manifest-task",
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
        createId: "unsupported-task-file",
        includes: [{ type: "taskRef", ref: "./task.yaml" }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("task.unknown");
  });

  it("treats instruction files as raw text", async () => {
    await writeFile("instructions.yaml", "note: Review carefully");

    const pack = await initPack({
      createId: "raw-instructions",
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
        createId: "invalid-skill",
        includes: [{ type: "skill", ref: { ref: "./skills/bad/SKILL.md" } }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("frontmatter name must be a string");
  });

  it("rejects git manifest refs without a file path", async () => {
    await expect(
      initPack({
        createId: "git-manifest-no-path",
        includes: [{ type: "manifest", ref: "git+file:///no/such/repo.git#main" }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("git manifest source requires a file path inside the repo");
  });

  it("rejects invalid pack IDs before resolving state paths", async () => {
    await expect(
      initPack({
        createId: "../outside",
        includes: [{ type: "adHocTask", text: "Inspect" }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("invalid pack id");
  });

  it("rejects empty ad hoc tasks before writing state", async () => {
    await expect(
      initPack({
        createId: "empty-task",
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
      createId: "locked-notes",
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
      createId: "stale-lock",
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
      createId: "corrupt-lock",
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
      createId: "no-symlink-globs",
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
      createId: "url-reference",
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
        createId: "credential-url",
        includes: [{ type: "reference", ref: { ref: "https://user:secret@example.com/doc.md" } }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("URL references must not include credentials");
  });

  it("rejects reference globs that match no files", async () => {
    await expect(
      initPack({
        createId: "empty-reference-glob",
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
      createId: "compact-brief",
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
      createId: "env-brief",
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
      createId: "invalid-brief-setting",
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
        createId: "missing-task",
        includes: [{ type: "taskRef", ref: "./missing-task.yaml" }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("task file not found or unreadable");
  });

  it("reports clear errors for missing local skill inputs", async () => {
    await expect(
      initPack({
        createId: "missing-skill",
        includes: [{ type: "skill", ref: { ref: "./skills/fresh-eyes/SKILL.md" } }],
        gitRefresh: "auto",
      }),
    ).rejects.toThrow("skill file not found or unreadable");
  });

  it("reports malformed task YAML as an agent-pack error", async () => {
    await writeFile("bad-task.yaml", "title: [unterminated\n");

    await expect(
      initPack({
        createId: "bad-task",
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

function nodeAgentYaml(name: string, script: string, extra = ""): string {
  return [
    `name: ${name}`,
    `command: ${JSON.stringify(process.execPath)}`,
    `args: [${JSON.stringify("-e")}, ${JSON.stringify(script)}]`,
    extra,
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
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
