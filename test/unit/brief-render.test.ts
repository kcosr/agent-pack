import { describe, expect, it } from "vitest";
import {
  renderBrief,
  renderReport,
  renderSummary,
  renderTask,
} from "../../src/core/brief/render.js";
import type { PackState } from "../../src/core/types.js";

describe("brief rendering", () => {
  it("renders every agent-facing brief section", () => {
    const brief = renderBrief(pack(), "ap");

    expect(brief).toContain("You are working from pack review-pack.");
    expect(brief).toContain("Name: Review Pack");
    expect(brief).toContain("Prompt:\nReview the implementation.");
    expect(brief).toContain("Instructions:\nRead references first.");
    expect(brief).toContain("- [pending] t001 - Inspect API");
    expect(brief).toContain("  Check request handling.");
    expect(brief).toContain("  Done when:");
    expect(brief).toContain("  - Notes cite files.");
    expect(brief).toContain("References:");
    expect(brief).toContain("- design");
    expect(brief).toContain("  Path: ./docs/design.md");
    expect(brief).toContain("- source glob");
    expect(brief).toContain("  Path: ./docs/design.md\n\n- source glob");
    expect(brief).toContain("  Files:");
    expect(brief).toContain("  - ./src/index.ts");
    expect(brief).toContain("Skills:");
    expect(brief).toContain("Use these supplemental skills");
    expect(brief).toContain("- fresh-eyes");
    expect(brief).toContain("- fresh-eyes (2)");
    expect(brief).toContain("  Path: ./skills/fresh-eyes/SKILL.md\n\n- fresh-eyes (2)");
    expect(brief).toContain("Contract:");
    expect(brief).toContain("Do:");
    expect(brief).toContain("- Run tests.");
    expect(brief).toContain("Don't:");
    expect(brief).toContain("- Skip evidence.");
    expect(brief).toContain("Commands:");
    expect(brief).toContain("  ap task list --id review-pack");
    expect(brief).toContain("  ap task show <task-id> --id review-pack");
    expect(brief).toContain("  ap task start <task-id> --id review-pack");
    expect(brief).toContain('  ap task note <task-id> --id review-pack "evidence"');
    expect(brief).toContain(
      '  ap task done <task-id> --id review-pack --note "completion evidence"',
    );
    expect(brief).toContain('  ap task block <task-id> --id review-pack --note "blocker"');
    expect(brief).toContain(
      "For multi-line notes, pass one shell argument with command substitution or a heredoc:",
    );
    expect(brief).toContain("  ap task note <task-id> --id review-pack \"$(cat <<'EOF'");
    expect(brief).toContain("multi-line evidence\nEOF\n)");
    expect(brief).not.toContain("Progress commands:");
    expect(brief.indexOf("Commands:")).toBeLessThan(brief.indexOf("References:"));
    expect(brief.indexOf("References:")).toBeLessThan(brief.indexOf("Skills:"));
    expect(brief.indexOf("Skills:")).toBeLessThan(brief.indexOf("Tasks:"));
  });

  it("renders empty task packs and blocked summary entries", () => {
    const [task] = pack().tasks;
    const state = pack({
      taskCounts: { total: 1, pending: 0, inProgress: 0, completed: 0, blocked: 1 },
      tasks: task ? [{ ...task, status: "blocked" }] : [],
      references: [],
      skills: [],
    });

    const brief = renderBrief(pack({ tasks: [], references: [], skills: [] }));
    expect(brief).toContain("- No tasks in this pack.");
    expect(brief).not.toContain("Commands:");
    expect(renderSummary(state)).toContain("Tasks: 0/1 completed, 1 blocked");
    expect(renderSummary(state)).toContain("Blocked:\n- t001 - Inspect API");
  });

  it("renders inputs before prompt and hides locked tasks from the brief", () => {
    const state = pack({
      inputSchema: {
        scope: {
          type: "string",
          required: true,
          description: "Review scope.",
        },
      },
      inputs: { scope: "auth changes" },
      inputSources: { scope: { source: "cli" } },
      taskCounts: { total: 1, pending: 1, inProgress: 0, completed: 0, blocked: 0 },
      tasks: [
        pack().tasks[0],
        {
          id: "t002",
          title: "Deep review",
          status: "pending",
          notes: [],
          activation: "locked",
          when: "scope",
        },
      ],
    });

    const brief = renderBrief(state);

    expect(brief).toContain("Inputs:");
    expect(brief).toContain("| scope | auth changes | yes | string | Review scope. |");
    expect(brief.indexOf("Name: Review Pack")).toBeLessThan(brief.indexOf("Inputs:"));
    expect(brief.indexOf("Inputs:")).toBeLessThan(brief.indexOf("Prompt:"));
    expect(brief).toContain("- [pending] t001 - Inspect API");
    expect(brief).not.toContain("Deep review");
    expect(renderBrief(pack())).not.toContain("Inputs:");
  });

  it("can render only task ids and titles without task content", () => {
    const brief = renderBrief(pack(), "ap", { includeTaskContent: false });

    expect(brief).toContain("- [pending] t001 - Inspect API");
    expect(brief).not.toContain("  Check request handling.");
    expect(brief).not.toContain("  Done when:");
    expect(brief).toContain(
      "Task content is omitted from this brief. Run `ap task show <task-id> --id review-pack` before working a task.",
    );
  });

  it("can render task commands without pack id arguments", () => {
    const brief = renderBrief(pack(), "ap", { includePackIdInCommands: false });

    expect(brief).toContain("  ap task list");
    expect(brief).toContain("  ap task show <task-id>");
    expect(brief).toContain('  ap task note <task-id> "evidence"');
    expect(brief).not.toContain("--id review-pack");
  });

  it("renders human-readable task and report output without raw source metadata", () => {
    const state = pack({
      tasks: [
        {
          ...pack().tasks[0],
          status: "completed",
          completedAt: "2026-05-07T01:00:00.000Z",
          notes: ["2026-05-07T01:00:00.000Z Checked src/index.ts."],
          source: { kind: "file", path: "./tasks/review.yaml" },
        },
      ],
    });
    const task = state.tasks[0];

    const renderedTask = renderTask(task);
    expect(renderedTask).toContain("Task: t001");
    expect(renderedTask).toContain("Status: completed");
    expect(renderedTask).toContain("Body:\nCheck request handling.");
    expect(renderedTask).toContain("Done when:\n- Notes cite files.");
    expect(renderedTask).toContain("Notes:\n- 2026-05-07T01:00:00.000Z Checked src/index.ts.");
    expect(renderedTask).not.toContain('"source"');
    expect(renderedTask).not.toContain("./tasks/review.yaml");

    const renderedReport = renderReport(state);
    expect(renderedReport).toContain("Pack: review-pack");
    expect(renderedReport).toContain("- t001 [completed] Inspect API");
    expect(renderedReport).toContain("Notes:\n  - 2026-05-07T01:00:00.000Z Checked src/index.ts.");
    expect(renderedReport).toContain(
      "References:\n- r001 - design\n  Description: Design document.\n  Path: ./docs/design.md\n\n- r002 - source glob",
    );
    expect(renderedReport).toContain(
      "Skills:\n- s001 - fresh-eyes\n  Description: Review changed code.\n  Path: ./skills/fresh-eyes/SKILL.md\n\n- s002 - fresh-eyes (2)",
    );
    expect(renderedReport).not.toContain('"source"');
    expect(renderedReport).not.toContain("./tasks/review.yaml");
  });

  it("omits null exit codes from signaled agent run reports", () => {
    const renderedReport = renderReport(
      pack({
        agentRuns: [
          {
            id: "a001",
            agent: "local-agent",
            mode: "interactive",
            status: "signaled",
            startedAt: "2026-05-07T00:00:00.000Z",
            endedAt: "2026-05-07T00:00:01.000Z",
            exitCode: null,
            signal: "SIGTERM",
            timedOut: false,
            stdout: "",
            stdoutTruncated: false,
          },
        ],
      }),
    );

    expect(renderedReport).toContain("Agent Runs:");
    expect(renderedReport).toContain("Mode: interactive");
    expect(renderedReport).toContain("Signal: SIGTERM");
    expect(renderedReport).not.toContain("Exit code: null");
  });
});

function pack(overrides: Partial<PackState> = {}): PackState {
  return {
    schemaVersion: 1,
    id: "review-pack",
    name: "Review Pack",
    status: "pending",
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
    repoRoot: ".",
    prompt: "Review the implementation.",
    instructions: "Read references first.",
    taskCounts: { total: 1, pending: 1, inProgress: 0, completed: 0, blocked: 0 },
    tasks: [
      {
        id: "t001",
        sourceId: "inspect-api",
        title: "Inspect API",
        body: "Check request handling.",
        doneWhen: ["Notes cite files."],
        status: "pending",
        notes: [],
      },
    ],
    references: [
      {
        id: "r001",
        name: "design",
        description: "Design document.",
        source: { kind: "file", path: "./docs/design.md" },
        path: "./docs/design.md",
      },
      {
        id: "r002",
        name: "source glob",
        source: { kind: "glob", path: "./src/**/*.ts" },
        files: ["./src/index.ts"],
      },
    ],
    skills: [
      {
        id: "s001",
        name: "fresh-eyes",
        description: "Review changed code.",
        source: { kind: "file", path: "./skills/fresh-eyes/SKILL.md" },
        path: "./skills/fresh-eyes/SKILL.md",
      },
      {
        id: "s002",
        name: "fresh-eyes (2)",
        description: "Review again.",
        source: { kind: "file", path: "./skills/other/SKILL.md" },
        path: "./skills/other/SKILL.md",
      },
    ],
    contract: {
      do: ["Run tests."],
      dont: ["Skip evidence."],
    },
    ...overrides,
  };
}
