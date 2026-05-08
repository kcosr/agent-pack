#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Argument, Command, Option } from "commander";
import { renderReport, renderSummary, renderTask } from "../core/brief/render.js";
import { AgentPackError } from "../core/errors.js";
import {
  brief,
  catalogList,
  catalogPath,
  catalogShow,
  cleanCache,
  initPack,
  listPacks,
  listTasks,
  report,
  showTask,
  status,
  summary,
  summaryPack,
  syncPack,
  updateTask,
} from "../core/operations.js";
import type {
  CatalogType,
  GitRefresh,
  InitInclude,
  PackState,
  SystemStatus,
  TaskStatus,
} from "../core/types.js";

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
  .description("Fetch and unpack missing git cache material for a pack.")
  .option("--id <id>", "pack ID")
  .addOption(gitRefreshOption())
  .option("--json", "emit machine-readable output")
  .action(async (options) => {
    await run(async () => {
      const result = await syncPack(options.id, options.gitRefresh);
      if (options.json) {
        printJson(result);
      } else {
        process.stdout.write(`Synced pack ${result.id}\n`);
      }
    });
  });

program
  .command("clean")
  .description("Remove rebuildable git cache material for current pack state.")
  .option("--id <id>", "limit cleanup to one pack ID")
  .option("--json", "emit machine-readable output")
  .action(async (options) => {
    await run(async () => {
      const result = await cleanCache(options.id);
      if (options.json) {
        printJson(result);
      } else {
        const repoLabel = result.repoHashes.length === 1 ? "git repo" : "git repos";
        const packLabel = result.packIds.length === 1 ? "pack" : "packs";
        process.stdout.write(
          `Cleaned ${result.removed.length} cache paths for ${result.repoHashes.length} ${repoLabel} across ${result.packIds.length} ${packLabel}\n`,
        );
      }
    });
  });

program
  .command("list")
  .description("List packs in the current state directory.")
  .option("--json", "emit machine-readable output")
  .action(async (options) => {
    await run(async () => {
      const packs = await listPacks();
      if (options.json) {
        printJson(packs.map(statusJson));
        return;
      }
      for (const pack of packs) {
        process.stdout.write(statusRow(pack));
      }
    });
  });

configureTaskCommands(program);
configureCatalogCommands(program);

program
  .command("status")
  .description("Show resolved agent-pack paths and defaults.")
  .option("--json", "emit machine-readable output")
  .action(async (options) => {
    await run(async () => {
      const result = status();
      if (options.json) {
        printJson(result);
      } else {
        process.stdout.write(renderSystemStatus(result));
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
        process.stdout.write(renderReport(pack));
      }
    });
  });

program
  .command("summary")
  .description("Show a concise pack summary.")
  .option("--id <id>", "pack ID")
  .option("--json", "emit machine-readable output")
  .action(async (options) => {
    await run(async () => {
      if (options.json) {
        printJson(statusJson(await summaryPack(options.id)));
      } else {
        process.stdout.write(await summary(options.id));
      }
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
      "load a catalog, local, or git pack manifest YAML file",
      collectInclude(includes, (ref) => ({ type: "manifest", ref })),
      [],
    )
    .option(
      "--manifests <ref>",
      "load a catalog, local, or git pack manifest YAML file",
      collectInclude(includes, (ref) => ({ type: "manifest", ref })),
      [],
    )
    .option(
      "--instructions <path>",
      "load raw instructions from a text or Markdown file",
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
      "add catalog, local, or git task YAML",
      collectInclude(includes, (ref) => ({ type: "taskRef", ref })),
      [],
    )
    .option(
      "--tasks <ref>",
      "add catalog, local, or git task YAML",
      collectInclude(includes, (ref) => ({ type: "taskRef", ref })),
      [],
    )
    .option(
      "--reference <ref>",
      "add catalog, local, URL, or git reference",
      collectInclude(includes, (ref) => ({ type: "reference", ref: { ref } })),
      [],
    )
    .option(
      "--references <ref>",
      "add catalog, local, URL, or git reference",
      collectInclude(includes, (ref) => ({ type: "reference", ref: { ref } })),
      [],
    )
    .option(
      "--skill <ref>",
      "add catalog, local, or git skill",
      collectInclude(includes, (ref) => ({ type: "skill", ref: { ref } })),
      [],
    )
    .option(
      "--skills <ref>",
      "add catalog, local, or git skill",
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

function configureTaskCommands(root: Command): void {
  const task = root.command("task").description("List, inspect, and update pack tasks.");

  task
    .command("list")
    .description("List tasks in a pack.")
    .option("--id <id>", "pack ID")
    .action(async (options) => {
      await run(async () => {
        process.stdout.write(await listTasks(options.id));
      });
    });

  task
    .command("show")
    .description("Show a task.")
    .argument("<taskId>", "task ID")
    .option("--id <id>", "pack ID")
    .option("--json", "emit machine-readable output")
    .action(async (taskId, options) => {
      await run(async () => {
        const task = await showTask(taskId, options.id);
        if (options.json) {
          printJson(task);
        } else {
          process.stdout.write(renderTask(task));
        }
      });
    });

  configureTaskStatusCommand(
    task,
    "start",
    "Mark a task in progress.",
    "in_progress",
    "progress note",
  );

  task
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

  configureTaskStatusCommand(
    task,
    "done",
    "Mark a task completed.",
    "completed",
    "completion evidence",
  );
  configureTaskStatusCommand(task, "block", "Mark a task blocked.", "blocked", "blocker note");
}

function configureTaskStatusCommand(
  task: Command,
  name: string,
  description: string,
  status: TaskStatus,
  noteDescription: string,
): void {
  task
    .command(name)
    .description(description)
    .argument("<taskId>", "task ID")
    .option("--id <id>", "pack ID")
    .option("--note <note>", noteDescription)
    .action(async (taskId, options) => {
      await run(async () => {
        const pack = await updateTask(taskId, status, options.note, options.id);
        process.stdout.write(renderSummary(pack));
      });
    });
}

function configureCatalogCommands(root: Command): void {
  const catalog = root.command("catalog").description("List and inspect catalog entries.");

  catalog
    .command("list")
    .description("List catalog entries.")
    .addOption(catalogTypeOption().makeOptionMandatory(false))
    .option("--json", "emit machine-readable output")
    .action(async (options) => {
      await run(async () => {
        const entries = await catalogList(options.type);
        if (options.json) {
          printJson(entries);
          return;
        }
        for (const entry of entries) {
          process.stdout.write(`${entry.type}\t${entry.name}\t${entry.path}\n`);
        }
      });
    });

  catalog
    .command("show")
    .description("Print a catalog entry file.")
    .addArgument(catalogTypeArgument())
    .argument("<name>", "catalog name")
    .action(async (type, name) => {
      await run(async () => {
        process.stdout.write((await catalogShow(type, name)).content);
      });
    });

  catalog
    .command("path")
    .description("Print a catalog entry path.")
    .addArgument(catalogTypeArgument())
    .argument("<name>", "catalog name")
    .action(async (type, name) => {
      await run(async () => {
        process.stdout.write(`${await catalogPath(type, name)}\n`);
      });
    });
}

function catalogTypeOption(): Option {
  return new Option("--type <type>", "catalog entry type").choices(catalogTypes());
}

function catalogTypeArgument() {
  return new Argument("<type>", "catalog entry type").choices(catalogTypes());
}

function catalogTypes(): CatalogType[] {
  return ["manifest", "task", "reference", "skill"];
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

function renderSystemStatus(result: SystemStatus): string {
  return [
    "Agent Pack Status",
    `Workspace: ${result.cwd}`,
    `Config/catalog dir: ${result.configDir}`,
    `State dir: ${result.stateDir}`,
    `Cache dir: ${result.cacheDir}`,
    `Git cache dir: ${result.gitCacheDir}`,
    `Lock dir: ${result.lockDir}`,
    `Pack dir: ${result.packDir}`,
    `Event dir: ${result.eventDir}`,
    `Index: ${result.indexPath}`,
    `Default pack id: ${result.defaultPackId ?? "(unset)"}`,
    "",
  ].join("\n");
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

function statusRow(pack: PackState): string {
  return `${pack.id}\t${pack.name ?? ""}\t${pack.status}\t${pack.taskCounts.completed}/${pack.taskCounts.total}\tblocked:${pack.taskCounts.blocked}\n`;
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
