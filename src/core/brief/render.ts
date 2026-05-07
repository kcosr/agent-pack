import type { PackState, PackTask } from "../types.js";

export function renderBrief(
  pack: PackState,
  commandName = process.env.AGENT_PACK_CMD ?? "agent-pack",
): string {
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
  lines.push("", "Tasks:");
  if (pack.tasks.length === 0) {
    lines.push("- No tasks in this pack.");
  } else {
    for (const task of pack.tasks) {
      lines.push(formatTaskSummary(task));
      if (task.body) {
        lines.push(`  ${task.body}`);
      }
      if (task.doneWhen?.length) {
        lines.push("  Done when:");
        for (const condition of task.doneWhen) {
          lines.push(`  - ${condition}`);
        }
      }
    }
  }
  if (pack.references.length) {
    lines.push("", "References:");
    for (const reference of pack.references) {
      lines.push(`- ${reference.name}`);
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
    }
  }
  if (pack.skills.length) {
    lines.push(
      "",
      "Skills:",
      "Use these supplemental skills when their descriptions match the work in this pack. Read the listed `SKILL.md` before applying a skill's workflow.",
      "",
    );
    for (const skill of pack.skills) {
      lines.push(`- ${skill.name}`);
      if (skill.description) {
        lines.push(`  Description: ${skill.description}`);
      }
      lines.push(`  Path: ${skill.path}`);
    }
  }
  if (pack.contract) {
    lines.push("", "Contract:", formatBlock(pack.contract));
  }
  if (pack.surfaceInventory?.length) {
    lines.push("", "Surface inventory:", formatBlock(pack.surfaceInventory));
  }
  if (pack.assumptions?.length) {
    lines.push("", "Assumptions:", formatBlock(pack.assumptions));
  }
  lines.push("", "Progress commands:");
  for (const task of pack.tasks) {
    lines.push(`  ${commandName} start ${task.id} --id ${pack.id}`);
    lines.push(`  ${commandName} note ${task.id} --id ${pack.id} "evidence"`);
    lines.push(`  ${commandName} done ${task.id} --id ${pack.id} --note "completion evidence"`);
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

function formatTaskSummary(task: PackTask): string {
  return `[${task.status}] ${task.id} - ${task.title}`;
}

function formatBlock(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
