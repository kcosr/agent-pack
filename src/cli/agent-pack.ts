#!/usr/bin/env node
import { Command, Option } from "commander";
import { renderSummary } from "../core/brief/render.js";
import { AgentPackError } from "../core/errors.js";
import {
  brief,
  initPack,
  listTasks,
  report,
  showTask,
  status,
  summary,
  syncAll,
  syncPack,
  updateTask,
} from "../core/operations.js";
import type { GitRefresh, ManifestReference, ManifestSkill, PackState } from "../core/types.js";

const program = new Command();

program
  .name("agent-pack")
  .description("Prepare durable work packets for coding agents.")
  .version("0.1.0");

program
  .command("init")
  .description("Create a pack.")
  .option("--id <id>", "use a specific pack ID")
  .option("--name <name>", "set a display name")
  .option("--manifest <path>", "load a pack manifest YAML file", collect, [])
  .option("--instructions <path>", "load instructions from Markdown or YAML", collect, [])
  .option("--task <text>", "add one ad hoc task", collect, [])
  .option("--tasks <ref>", "add task YAML file or glob", collect, [])
  .option("--reference <ref>", "add one reference", collect, [])
  .option("--references <ref>", "add a reference file, directory, glob, or repo", collect, [])
  .option("--skill <ref>", "add one SKILL.md file", collect, [])
  .option("--skills <ref>", "add skill file or glob", collect, [])
  .addOption(gitRefreshOption())
  .option("--state-dir <path>", "override the state directory")
  .option("--json", "emit machine-readable output")
  .option("--strict", "reject ambiguous or unsupported metadata")
  .argument("[prompt]", "one-off prompt rendered at the top of the brief")
  .action(async (prompt, options) => {
    await run(async () => {
      const pack = await initPack({
        id: options.id,
        name: options.name,
        manifests: options.manifest,
        instructionFiles: options.instructions,
        taskRefs: options.tasks,
        adHocTasks: options.task,
        referenceRefs: toRefs([...options.reference, ...options.references]),
        skillRefs: toSkills([...options.skill, ...options.skills]),
        prompt,
        stateDir: options.stateDir,
        gitRefresh: options.gitRefresh,
        json: options.json,
        strict: options.strict,
      });
      if (options.json) {
        printJson({ id: pack.id, briefCommand: `agent-pack brief --id ${pack.id}`, pack });
      } else {
        process.stdout.write(`Created pack ${pack.id}\n`);
        process.stdout.write(`Run: agent-pack brief --id ${pack.id}\n`);
      }
    });
  });

program
  .command("brief")
  .description("Print the agent-facing brief.")
  .option("--id <id>", "pack ID")
  .action(async (options) => {
    await run(async () => {
      process.stdout.write(await brief(options.id));
    });
  });

program
  .command("sync")
  .description("Hydrate missing git cache material for a pack.")
  .option("--id <id>", "pack ID")
  .option("--all", "sync all packs")
  .addOption(gitRefreshOption())
  .option("--json", "emit machine-readable output")
  .action(async (options) => {
    await run(async () => {
      const result = options.all
        ? await syncAll(options.gitRefresh)
        : await syncPack(options.id, options.gitRefresh);
      if (options.json) {
        printJson(result);
      } else if (Array.isArray(result)) {
        process.stdout.write(`Synced ${result.length} packs\n`);
      } else {
        process.stdout.write(`Synced pack ${result.id}\n`);
      }
    });
  });

program
  .command("list")
  .description("List tasks in a pack.")
  .option("--id <id>", "pack ID")
  .action(async (options) => {
    await run(async () => {
      process.stdout.write(await listTasks(options.id));
    });
  });

program
  .command("show")
  .description("Show a task as JSON.")
  .argument("<taskId>", "task ID")
  .option("--id <id>", "pack ID")
  .action(async (taskId, options) => {
    await run(async () => {
      process.stdout.write(await showTask(taskId, options.id));
    });
  });

program
  .command("start")
  .description("Mark a task in progress.")
  .argument("<taskId>", "task ID")
  .option("--id <id>", "pack ID")
  .option("--note <note>", "progress note")
  .action(async (taskId, options) => {
    await run(async () => {
      const pack = await updateTask(taskId, "in_progress", options.note, options.id);
      process.stdout.write(renderSummary(pack));
    });
  });

program
  .command("note")
  .description("Add a task note.")
  .argument("<taskId>", "task ID")
  .argument("<note>", "note")
  .option("--id <id>", "pack ID")
  .action(async (taskId, note, options) => {
    await run(async () => {
      const pack = await updateTask(taskId, undefined, note, options.id);
      process.stdout.write(renderSummary(pack));
    });
  });

program
  .command("done")
  .description("Mark a task completed.")
  .argument("<taskId>", "task ID")
  .option("--id <id>", "pack ID")
  .option("--note <note>", "completion evidence")
  .action(async (taskId, options) => {
    await run(async () => {
      const pack = await updateTask(taskId, "completed", options.note, options.id);
      process.stdout.write(renderSummary(pack));
    });
  });

program
  .command("block")
  .description("Mark a task blocked.")
  .argument("<taskId>", "task ID")
  .option("--id <id>", "pack ID")
  .option("--note <note>", "blocker note")
  .action(async (taskId, options) => {
    await run(async () => {
      const pack = await updateTask(taskId, "blocked", options.note, options.id);
      process.stdout.write(renderSummary(pack));
    });
  });

program
  .command("status")
  .description("Show derived pack progress.")
  .option("--id <id>", "pack ID")
  .option("--all", "show all packs")
  .option("--json", "emit machine-readable output")
  .action(async (options) => {
    await run(async () => {
      const result = await status(options.id, options.all);
      if (options.json) {
        printJson(Array.isArray(result) ? result.map(statusJson) : statusJson(result));
      } else if (Array.isArray(result)) {
        for (const pack of result) {
          process.stdout.write(
            `${pack.id}\t${pack.name ?? ""}\t${pack.status}\t${pack.taskCounts.completed}/${pack.taskCounts.total}\tblocked:${pack.taskCounts.blocked}\n`,
          );
        }
      } else {
        process.stdout.write(renderSummary(result));
      }
    });
  });

program
  .command("report")
  .description("Show full pack state.")
  .option("--id <id>", "pack ID")
  .option("--json", "emit machine-readable output")
  .action(async (options) => {
    await run(async () => {
      const pack = await report(options.id);
      if (options.json) {
        printJson(pack);
      } else {
        process.stdout.write(`${JSON.stringify(pack, null, 2)}\n`);
      }
    });
  });

program
  .command("summary")
  .description("Show a concise pack summary.")
  .option("--id <id>", "pack ID")
  .action(async (options) => {
    await run(async () => {
      process.stdout.write(await summary(options.id));
    });
  });

program.parseAsync(process.argv);

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function gitRefreshOption(): Option {
  return new Option("--git-refresh <policy>", "git fetch policy")
    .choices(["auto", "always", "never"])
    .default((process.env.AGENT_PACK_GIT_REFRESH as GitRefresh | undefined) ?? "auto");
}

function toRefs(refs: string[]): ManifestReference[] {
  return refs.map((ref) => ({ ref }));
}

function toSkills(refs: string[]): ManifestSkill[] {
  return refs.map((ref) => ({ ref }));
}

function statusJson(pack: PackState) {
  return {
    id: pack.id,
    name: pack.name,
    status: pack.status,
    tasks: pack.taskCounts,
    references: pack.references.length,
    skills: pack.skills.length,
  };
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof AgentPackError) {
      console.error(`agent-pack: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}
