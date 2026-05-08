#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
import type { GitRefresh, InitInclude, PackState } from "../core/types.js";

const program = new Command();
let startupError: AgentPackError | undefined;

program
  .name("agent-pack")
  .description("Prepare durable work packets for coding agents.")
  .version(packageVersion())
  .addHelpText("after", packageHelpText());

configureInitCommand(program);

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

program.parseAsync(process.argv).catch((error) => {
  if (error instanceof AgentPackError) {
    console.error(`agent-pack: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  throw error;
});

function configureInitCommand(root: Command): void {
  const includes: InitInclude[] = [];
  root
    .command("init")
    .description("Create a pack.")
    .option("--id <id>", "use a specific pack ID")
    .option("--name <name>", "set a display name")
    .option(
      "--manifest <ref>",
      "load a pack manifest YAML file or git ref",
      collectInclude(includes, (ref) => ({ type: "manifest", ref })),
      [],
    )
    .option(
      "--manifests <ref>",
      "load a pack manifest YAML file or git ref",
      collectInclude(includes, (ref) => ({ type: "manifest", ref })),
      [],
    )
    .option(
      "--instructions <path>",
      "load instructions from Markdown or YAML",
      collectInclude(includes, (path) => ({ type: "instructions", path })),
      [],
    )
    .option(
      "--add-task <text>",
      "add one ad hoc task",
      collectInclude(includes, (text) => ({ type: "adHocTask", text })),
      [],
    )
    .option(
      "--task <ref>",
      "add task YAML file, glob, or git ref",
      collectInclude(includes, (ref) => ({ type: "taskRef", ref })),
      [],
    )
    .option(
      "--tasks <ref>",
      "add task YAML file, glob, or git ref",
      collectInclude(includes, (ref) => ({ type: "taskRef", ref })),
      [],
    )
    .option(
      "--reference <ref>",
      "add one reference file, directory, glob, URL, or git ref",
      collectInclude(includes, (ref) => ({ type: "reference", ref: { ref } })),
      [],
    )
    .option(
      "--references <ref>",
      "add one reference file, directory, glob, URL, or git ref",
      collectInclude(includes, (ref) => ({ type: "reference", ref: { ref } })),
      [],
    )
    .option(
      "--skill <ref>",
      "add one SKILL.md file",
      collectInclude(includes, (ref) => ({ type: "skill", ref: { ref } })),
      [],
    )
    .option(
      "--skills <ref>",
      "add skill file or glob",
      collectInclude(includes, (ref) => ({ type: "skill", ref: { ref } })),
      [],
    )
    .addOption(gitRefreshOption())
    .option("--state-dir <path>", "override the state directory")
    .option("--json", "emit machine-readable output")
    .argument("[prompt]", "one-off prompt rendered at the top of the brief")
    .action(async (prompt, options) => {
      await run(async () => {
        const pack = await initPack({
          id: options.id,
          name: options.name,
          includes,
          prompt,
          stateDir: options.stateDir,
          gitRefresh: options.gitRefresh,
          json: options.json,
        });
        if (options.json) {
          printJson({ id: pack.id, briefCommand: `agent-pack brief --id ${pack.id}`, pack });
        } else {
          process.stdout.write(`Created pack ${pack.id}\n`);
          process.stdout.write(`Run: agent-pack brief --id ${pack.id}\n`);
        }
      });
    });
}

function collectInclude(includes: InitInclude[], toInclude: (value: string) => InitInclude) {
  return (value: string, previous: string[]): string[] => {
    previous.push(value);
    includes.push(toInclude(value));
    return previous;
  };
}

function gitRefreshOption(): Option {
  return new Option("--git-refresh <policy>", "git fetch policy")
    .choices(["auto", "always", "never"])
    .default(defaultGitRefresh());
}

function defaultGitRefresh(): GitRefresh {
  const value = process.env.AGENT_PACK_GIT_REFRESH;
  if (!value) {
    return "auto";
  }
  if (value === "auto" || value === "always" || value === "never") {
    return value;
  }
  startupError = new AgentPackError(`invalid AGENT_PACK_GIT_REFRESH value: ${value}`);
  return "auto";
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

function packageHelpText(): string {
  const resources = [
    ["README", "README.md"],
    ["Usage", "docs/usage.md"],
    ["Examples", "examples"],
  ]
    .map(([label, relativePath]) => ({ label, path: path.join(packageRoot(), relativePath) }))
    .filter((resource) => existsSync(resource.path));
  if (resources.length === 0) {
    return "";
  }
  const width = Math.max(...resources.map((resource) => resource.label.length));
  return `\nResources:\n${resources
    .map((resource) => `  ${resource.label.padEnd(width)}  ${resource.path}`)
    .join("\n")}`;
}

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(packageRoot(), "package.json"), "utf8")) as {
    version?: unknown;
  };
  return typeof pkg.version === "string" ? pkg.version : "0.0.0";
}

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    if (startupError) {
      throw startupError;
    }
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
