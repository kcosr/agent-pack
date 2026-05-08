import type { PackState, PackTask } from "../types.js";

export interface BriefRenderOptions {
  includeTaskContent?: boolean;
  includePackIdInCommands?: boolean;
}

export function renderBrief(
  pack: PackState,
  commandName = process.env.AGENT_PACK_CMD ?? "agent-pack",
  options: BriefRenderOptions = {},
): string {
  const includeTaskContent = options.includeTaskContent ?? true;
  const includePackIdInCommands = options.includePackIdInCommands ?? true;
  const lines: string[] = [];
  lines.push(`You are working from pack ${pack.id}.`);
  if (pack.name) {
    lines.push(`Name: ${pack.name}`);
  }
  if (pack.prompt) {
    lines.push("", "Prompt:", pack.prompt);
  }
  if (pack.instructions) {
    lines.push("", "Instructions:", pack.instructions);
  }
  if (pack.contract) {
    lines.push("", "Contract:", "Follow this contract while working this pack.");
    if (pack.contract.do?.length) {
      lines.push("Do:");
      for (const entry of pack.contract.do) {
        lines.push(`- ${entry}`);
      }
    }
    if (pack.contract.dont?.length) {
      lines.push("Don't:");
      for (const entry of pack.contract.dont) {
        lines.push(`- ${entry}`);
      }
    }
  }
  if (pack.tasks.length) {
    lines.push("", "Commands:");
    lines.push(`  ${taskCommand(commandName, pack.id, "list", { includePackIdInCommands })}`);
    lines.push(
      `  ${taskCommand(commandName, pack.id, "show", {
        includePackIdInCommands,
        taskId: "<task-id>",
      })}`,
    );
    lines.push(
      `  ${taskCommand(commandName, pack.id, "start", {
        includePackIdInCommands,
        taskId: "<task-id>",
      })}`,
    );
    lines.push(
      `  ${taskCommand(commandName, pack.id, "note", {
        includePackIdInCommands,
        taskId: "<task-id>",
        trailingArgs: '"evidence"',
      })}`,
    );
    lines.push(
      `  ${taskCommand(commandName, pack.id, "done", {
        includePackIdInCommands,
        taskId: "<task-id>",
        trailingArgs: '--note "completion evidence"',
      })}`,
    );
    lines.push(
      `  ${taskCommand(commandName, pack.id, "block", {
        includePackIdInCommands,
        taskId: "<task-id>",
        trailingArgs: '--note "blocker"',
      })}`,
    );
    lines.push("Use `task list` to see task status and `task show` before working a task.");
    lines.push(
      "For multi-line notes, pass one shell argument with command substitution or a heredoc:",
    );
    lines.push(
      `  ${taskCommand(commandName, pack.id, "note", {
        includePackIdInCommands,
        taskId: "<task-id>",
        trailingArgs: `"$(cat <<'EOF'`,
      })}`,
    );
    lines.push("multi-line evidence");
    lines.push("EOF");
    lines.push(')"');
  }
  if (pack.references.length) {
    lines.push("", "References:");
    pack.references.forEach((reference, index) => {
      if (index > 0) {
        lines.push("");
      }
      lines.push(`- ${reference.name}`);
      if (reference.description) {
        lines.push(`  Description: ${reference.description}`);
      }
      if (reference.path) {
        lines.push(`  ${reference.source.kind === "url" ? "URL" : "Path"}: ${reference.path}`);
      }
      if (reference.rootPath) {
        lines.push(`  Root path: ${reference.rootPath}`);
      }
      if (reference.files?.length) {
        lines.push("  Files:");
        for (const file of reference.files) {
          lines.push(`  - ${file}`);
        }
      }
    });
  }
  if (pack.skills.length) {
    lines.push(
      "",
      "Skills:",
      "Use these supplemental skills when their descriptions match the work in this pack. Read the listed `SKILL.md` before applying a skill's workflow.",
      "",
    );
    pack.skills.forEach((skill, index) => {
      if (index > 0) {
        lines.push("");
      }
      lines.push(`- ${skill.name}`);
      if (skill.description) {
        lines.push(`  Description: ${skill.description}`);
      }
      lines.push(`  Path: ${skill.path}`);
    });
  }
  lines.push("", "Tasks:");
  if (pack.tasks.length === 0) {
    lines.push("- No tasks in this pack.");
  } else {
    const spaceTaskEntries = includeTaskContent && hasDetailedTasks(pack.tasks);
    pack.tasks.forEach((task, index) => {
      if (spaceTaskEntries && index > 0) {
        lines.push("");
      }
      lines.push(formatTaskSummary(task));
      if (includeTaskContent && task.body) {
        lines.push(`  ${task.body}`);
      }
      if (includeTaskContent && task.doneWhen?.length) {
        lines.push("  Done when:");
        for (const condition of task.doneWhen) {
          lines.push(`  - ${condition}`);
        }
      }
    });
    if (!includeTaskContent) {
      lines.push(
        `Task content is omitted from this brief. Run \`${taskCommand(
          commandName,
          pack.id,
          "show",
          {
            includePackIdInCommands,
            taskId: "<task-id>",
          },
        )}\` before working a task.`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function renderSummary(pack: PackState): string {
  const lines = [
    `Pack: ${pack.id}`,
    pack.name ? `Name: ${pack.name}` : undefined,
    `Status: ${pack.status}`,
    `Tasks: ${pack.taskCounts.completed}/${pack.taskCounts.total} completed, ${pack.taskCounts.blocked} blocked`,
    `References: ${pack.references.length}`,
    `Skills: ${pack.skills.length}`,
    `Last updated: ${pack.updatedAt}`,
  ].filter(Boolean);
  const blocked = pack.tasks.filter((task) => task.status === "blocked");
  if (blocked.length) {
    lines.push("", "Blocked:");
    for (const task of blocked) {
      lines.push(`- ${task.id} - ${task.title}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function renderReport(pack: PackState): string {
  const lines = [renderSummary(pack).trimEnd()];
  lines.push("", "Tasks:");
  if (pack.tasks.length === 0) {
    lines.push("- No tasks in this pack.");
  } else {
    pack.tasks.forEach((task, index) => {
      if (index > 0) {
        lines.push("");
      }
      lines.push(formatTaskReportEntry(task));
    });
  }

  lines.push("", "References:");
  if (pack.references.length === 0) {
    lines.push("- No references in this pack.");
  } else {
    pack.references.forEach((reference, index) => {
      if (index > 0) {
        lines.push("");
      }
      lines.push(`- ${reference.id} - ${reference.name}`);
      if (reference.description) {
        lines.push(`  Description: ${reference.description}`);
      }
      if (reference.path) {
        lines.push(`  Path: ${reference.path}`);
      }
      if (reference.rootPath) {
        lines.push(`  Root path: ${reference.rootPath}`);
      }
      if (reference.files?.length) {
        lines.push("  Files:");
        for (const file of reference.files) {
          lines.push(`  - ${file}`);
        }
      }
    });
  }

  lines.push("", "Skills:");
  if (pack.skills.length === 0) {
    lines.push("- No skills in this pack.");
  } else {
    pack.skills.forEach((skill, index) => {
      if (index > 0) {
        lines.push("");
      }
      lines.push(`- ${skill.id} - ${skill.name}`);
      if (skill.description) {
        lines.push(`  Description: ${skill.description}`);
      }
      lines.push(`  Path: ${skill.path}`);
    });
  }

  return `${lines.join("\n")}\n`;
}

export function renderTask(task: PackTask): string {
  const lines = [`Task: ${task.id}`, `Title: ${task.title}`, `Status: ${task.status}`];
  if (task.category) {
    lines.push(`Category: ${task.category}`);
  }
  if (task.startedAt) {
    lines.push(`Started: ${task.startedAt}`);
  }
  if (task.completedAt) {
    lines.push(`Completed: ${task.completedAt}`);
  }
  if (task.blockedAt) {
    lines.push(`Blocked: ${task.blockedAt}`);
  }
  if (task.body) {
    lines.push("", "Body:", task.body);
  }
  if (task.doneWhen?.length) {
    lines.push("", "Done when:");
    for (const condition of task.doneWhen) {
      lines.push(`- ${condition}`);
    }
  }
  lines.push("", "Notes:");
  if (task.notes.length === 0) {
    lines.push("- none");
  } else {
    for (const note of task.notes) {
      lines.push(`- ${note}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatTaskSummary(task: PackTask): string {
  return `- [${task.status}] ${task.id} - ${task.title}`;
}

function formatTaskReportEntry(task: PackTask): string {
  const lines = [`- ${task.id} [${task.status}] ${task.title}`];
  if (task.category) {
    lines.push(`  Category: ${task.category}`);
  }
  if (task.startedAt) {
    lines.push(`  Started: ${task.startedAt}`);
  }
  if (task.completedAt) {
    lines.push(`  Completed: ${task.completedAt}`);
  }
  if (task.blockedAt) {
    lines.push(`  Blocked: ${task.blockedAt}`);
  }
  if (task.notes.length) {
    lines.push("  Notes:");
    for (const note of task.notes) {
      lines.push(`  - ${note}`);
    }
  }
  return lines.join("\n");
}

function taskCommand(
  commandName: string,
  packId: string,
  verb: string,
  options: {
    includePackIdInCommands: boolean;
    taskId?: string;
    trailingArgs?: string;
  },
): string {
  return [
    commandName,
    "task",
    verb,
    options.taskId,
    ...(options.includePackIdInCommands ? ["--id", packId] : []),
    options.trailingArgs,
  ]
    .filter(Boolean)
    .join(" ");
}

function hasDetailedTasks(tasks: PackTask[]): boolean {
  return tasks.some((task) => Boolean(task.body) || Boolean(task.doneWhen?.length));
}
