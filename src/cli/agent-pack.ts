import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Argument, Command, Option } from "commander";
import { renderReport, renderSummary, renderTask } from "../core/brief/render.js";
import { catalogTypes } from "../core/catalog.js";
import { AgentPackError } from "../core/errors.js";
import {
  type TaskListMode,
  addReference,
  addSkill,
  addTask,
  agentNameCandidates,
  brief,
  catalogList,
  catalogPath,
  catalogShow,
  cleanCache,
  getInput,
  initPack,
  inputNameCandidates,
  inputValueCompletionCandidates,
  listInputs,
  listPacks,
  listTasks,
  report,
  runPack,
  setInput,
  showTask,
  status,
  summary,
  summaryPack,
  syncPack,
  unsetInput,
  updateTask,
} from "../core/operations.js";
import type {
  GitRefresh,
  InitInclude,
  PackState,
  SystemStatus,
  TaskStatus,
} from "../core/types.js";
import {
  agentNameOption,
  catalogNameArgument,
  catalogRefArgument,
  catalogRefOption,
  configureAgentCompletion,
  configureCompletionCommands,
  configureInputCompletion,
  inputNameArgument,
  inputValueArgument,
} from "./completion.js";
import { type TableColumn, renderTable } from "./table.js";

let startupError: AgentPackError | undefined;

declare const __AGENT_PACK_VERSION__: string | undefined;

export function configureProgram(): Command {
  const root = new Command();
  root
    .name("agent-pack")
    .description("Prepare durable work packets for coding agents.")
    .version(packageVersion())
    .addHelpText("after", packageHelpText());

  configureInputCompletion({
    names: inputNameCandidates,
    values: inputValueCompletionCandidates,
  });
  configureAgentCompletion({
    names: agentNameCandidates,
  });
  configureInitCommand(root);
  configureRunCommand(root);

  root
    .command("brief")
    .description("Print the agent-facing brief.")
    .option("--id <id>", "pack ID")
    .action(async (options) => {
      await run(async () => {
        process.stdout.write(await brief(options.id));
      });
    });

  root
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

  root
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

  root
    .command("list")
    .description("List packs in the current state directory.")
    .option("--json", "emit machine-readable output")
    .action(async (options) => {
      await run(async () => {
        const packs = sortPacksForList(await listPacks());
        if (options.json) {
          printJson(packs.map(statusJson));
          return;
        }
        process.stdout.write(statusTable(packs));
      });
    });

  configureTaskCommands(root);
  configureInputCommands(root);
  configureReferenceCommands(root);
  configureSkillCommands(root);
  configureCatalogCommands(root);
  configureCompletionCommands(root, run);

  root
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

  root
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

  root
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

  return root;
}

function configureInitCommand(root: Command): void {
  const includes: InitInclude[] = [];
  const inputAssignments: string[] = [];
  const command = root
    .command("init")
    .description("Create a pack.")
    .option("--create-id <id>", "use a specific ID for the new pack")
    .option("--name <name>", "set a display name");

  addCompositionOptions(command, includes, inputAssignments);
  command
    .addOption(gitRefreshOption())
    .option("--state-dir <path>", "override the state directory")
    .option("--json", "emit machine-readable output")
    .argument("[prompt]", "one-off prompt rendered at the top of the brief")
    .action(async (prompt, options) => {
      await run(async () => {
        const pack = await initPack({
          createId: options.createId,
          name: options.name,
          includes,
          inputAssignments: options.input,
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

function configureRunCommand(root: Command): void {
  const includes: InitInclude[] = [];
  const inputAssignments: string[] = [];
  const command = root
    .command("run")
    .description("Run one configured agent against a pack.")
    .option("--id <id>", "existing pack ID")
    .option("--create-id <id>", "use a specific ID for the new pack")
    .option("--name <name>", "set a display name for a new pack");

  addCompositionOptions(command, includes, inputAssignments, " for a new pack");
  command
    .addOption(agentNameOption("--run-agent <name>", "stored agent name to execute"))
    .addOption(gitRefreshOption())
    .option("--state-dir <path>", "override the state directory")
    .option("--interactive", "run the agent with inherited terminal stdio")
    .option("--json", "emit machine-readable output")
    .argument(
      "[prompt]",
      "new pack prompt, or follow-up message when --id targets an existing pack",
    )
    .action(async (prompt, options) => {
      await run(async () => {
        const hasNewPackInputs = hasCreateInputs(includes, inputAssignments, options);
        const createInputs = hasNewPackInputs || (!options.id && Boolean(prompt));
        if (options.id && hasNewPackInputs) {
          throw new AgentPackError("--id cannot be combined with create-and-run options");
        }
        if (options.interactive && options.json) {
          throw new AgentPackError("--interactive cannot be combined with --json");
        }
        const result = await runPack({
          packId: createInputs ? undefined : options.id,
          runAgent: options.runAgent,
          message: options.id ? prompt : undefined,
          interactive: options.interactive,
          stateDir: options.stateDir,
          init: createInputs
            ? {
                createId: options.createId,
                name: options.name,
                includes,
                inputAssignments: options.input,
                prompt,
                stateDir: options.stateDir,
                gitRefresh: options.gitRefresh,
                json: options.json,
              }
            : undefined,
        });
        if (options.json) {
          printJson({ pack: result.pack, runs: result.runs, outcome: result.outcome });
        } else if (options.interactive) {
          // The child owned the terminal; keep post-run output silent.
        } else {
          process.stdout.write(renderReport(result.pack));
        }
        if (result.exitCode !== 0) {
          process.exitCode = result.exitCode;
        }
      });
    });
}

function addCompositionOptions(
  command: Command,
  includes: InitInclude[],
  inputAssignments: string[],
  descriptionSuffix = "",
): void {
  command
    .option(
      "--input <key=value>",
      `set a manifest input${descriptionSuffix}`,
      collectString,
      inputAssignments,
    )
    .addOption(
      catalogRefOption(
        "--manifest <ref>",
        `load a catalog, local, or git pack manifest YAML file${descriptionSuffix}`,
        "manifest",
        collectInclude(includes, (ref) => ({ type: "manifest", ref })),
      ),
    )
    .addOption(
      catalogRefOption(
        "--manifests <ref>",
        `load a catalog, local, or git pack manifest YAML file${descriptionSuffix}`,
        "manifest",
        collectInclude(includes, (ref) => ({ type: "manifest", ref })),
      ),
    )
    .option(
      "--instructions <path>",
      `load raw instructions from a text or Markdown file${descriptionSuffix}`,
      collectInclude(includes, (path) => ({ type: "instructions", path })),
      [],
    )
    .option(
      "--add-task <text>",
      `add one ad hoc task${descriptionSuffix}`,
      collectInclude(includes, (text) => ({ type: "adHocTask", text })),
      [],
    )
    .addOption(
      catalogRefOption(
        "--task <ref>",
        `add catalog, local, or git task YAML${descriptionSuffix}`,
        "task",
        collectInclude(includes, (ref) => ({ type: "taskRef", ref })),
      ),
    )
    .addOption(
      catalogRefOption(
        "--tasks <ref>",
        `add catalog, local, or git task YAML${descriptionSuffix}`,
        "task",
        collectInclude(includes, (ref) => ({ type: "taskRef", ref })),
      ),
    )
    .addOption(
      catalogRefOption(
        "--reference <ref>",
        `add catalog, local, URL, or git reference${descriptionSuffix}`,
        "reference",
        collectInclude(includes, (ref) => ({ type: "reference", ref: { ref } })),
      ),
    )
    .addOption(
      catalogRefOption(
        "--references <ref>",
        `add catalog, local, URL, or git reference${descriptionSuffix}`,
        "reference",
        collectInclude(includes, (ref) => ({ type: "reference", ref: { ref } })),
      ),
    )
    .addOption(
      catalogRefOption(
        "--skill <ref>",
        `add catalog, local, or git skill${descriptionSuffix}`,
        "skill",
        collectInclude(includes, (ref) => ({ type: "skill", ref: { ref } })),
      ),
    )
    .addOption(
      catalogRefOption(
        "--skills <ref>",
        `add catalog, local, or git skill${descriptionSuffix}`,
        "skill",
        collectInclude(includes, (ref) => ({ type: "skill", ref: { ref } })),
      ),
    )
    .addOption(
      catalogRefOption(
        "--agent <ref>",
        `add a catalog, local, or git agent definition${descriptionSuffix}`,
        "agent",
        collectInclude(includes, (ref) => ({ type: "agentRef", ref })),
      ),
    )
    .addOption(
      catalogRefOption(
        "--agents <ref>",
        `add a catalog, local, or git agent definition${descriptionSuffix}`,
        "agent",
        collectInclude(includes, (ref) => ({ type: "agentRef", ref })),
      ),
    );
}

function hasCreateInputs(
  includes: InitInclude[],
  inputAssignments: string[],
  options: { name?: string; createId?: string },
): boolean {
  return (
    includes.length > 0 ||
    inputAssignments.length > 0 ||
    Boolean(options.name) ||
    Boolean(options.createId)
  );
}

function configureTaskCommands(root: Command): void {
  const task = root.command("task").description("List, inspect, and update pack tasks.");

  task
    .command("add")
    .description("Add an ad hoc task to a pack.")
    .argument("<title>", "task title")
    .option("--id <id>", "pack ID")
    .option("--category <category>", "task category")
    .option("--body <text>", "task body/details")
    .option("--done-when <criterion>", "completion criterion", collectString, [])
    .option("--json", "emit machine-readable output")
    .action(async (title, options) => {
      await run(async () => {
        const result = await addTask({
          packId: options.id,
          title,
          category: options.category,
          body: options.body,
          doneWhen: options.doneWhen,
        });
        if (options.json) {
          printJson({
            task: taskJson(result.task),
            summary: statusJson(result.pack),
          });
        } else {
          process.stdout.write(renderSummary(result.pack));
        }
      });
    });

  task
    .command("list")
    .description("List tasks in a pack.")
    .option("--id <id>", "pack ID")
    .option("--all", "include locked tasks")
    .option("--locked", "show only locked tasks")
    .action(async (options) => {
      await run(async () => {
        process.stdout.write(await listTasks(options.id, taskListMode(options)));
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
        process.stdout.write(renderTaskMutation(pack, taskId, "note added"));
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
        process.stdout.write(renderTaskMutation(pack, taskId, taskMutationLabel(status)));
      });
    });
}

function configureInputCommands(root: Command): void {
  const input = root.command("input").description("List and update pack inputs.");

  input
    .command("list")
    .description("List pack inputs.")
    .option("--id <id>", "pack ID")
    .option("--json", "emit machine-readable output")
    .action(async (options) => {
      await run(async () => {
        const entries = await listInputs(options.id);
        if (options.json) {
          printJson(entries);
          return;
        }
        process.stdout.write(inputTable(entries));
      });
    });

  input
    .command("get")
    .description("Get a pack input value.")
    .addArgument(inputNameArgument("<name>", "input name"))
    .option("--id <id>", "pack ID")
    .option("--json", "emit machine-readable output")
    .action(async (name, options) => {
      await run(async () => {
        const entry = await getInput(name, options.id);
        if (options.json) {
          printJson(entry);
        } else {
          process.stdout.write(`${entry.value ?? ""}\n`);
        }
      });
    });

  input
    .command("set")
    .description("Set a pack input value.")
    .addArgument(inputNameArgument("<name>", "input name"))
    .addArgument(inputValueArgument("<value>", "input value", 0))
    .option("--id <id>", "pack ID")
    .option("--json", "emit machine-readable output")
    .action(async (name, value, options) => {
      await run(async () => {
        const result = await setInput(name, value, options.id);
        if (options.json) {
          printJson(inputMutationJson(result));
        } else {
          process.stdout.write(inputMutationText("Updated", result.input.name, result.unlocked));
        }
      });
    });

  input
    .command("unset")
    .description("Unset a pack input value.")
    .addArgument(inputNameArgument("<name>", "input name"))
    .option("--id <id>", "pack ID")
    .option("--json", "emit machine-readable output")
    .action(async (name, options) => {
      await run(async () => {
        const result = await unsetInput(name, options.id);
        if (options.json) {
          printJson(inputMutationJson(result));
        } else {
          process.stdout.write(inputMutationText("Unset", result.input.name, result.unlocked));
        }
      });
    });
}

function configureReferenceCommands(root: Command): void {
  const reference = root.command("reference").description("Add pack references.");

  reference
    .command("add")
    .description("Add a reference to a pack.")
    .addArgument(catalogRefArgument("<ref>", "catalog, local, URL, or git reference", "reference"))
    .option("--id <id>", "pack ID")
    .addOption(gitRefreshOption())
    .option("--json", "emit machine-readable output")
    .action(async (ref, options) => {
      await run(async () => {
        const result = await addReference({
          packId: options.id,
          ref,
          gitRefresh: options.gitRefresh,
        });
        if (options.json) {
          printJson({
            references: result.references,
            skipped: result.skipped,
            summary: statusJson(result.pack),
          });
        } else {
          process.stdout.write(
            addResultLine(
              "reference",
              result.pack.id,
              result.references.length,
              result.skipped.length,
            ),
          );
          process.stdout.write(renderSummary(result.pack));
        }
      });
    });
}

function configureSkillCommands(root: Command): void {
  const skill = root.command("skill").description("Add pack skills.");

  skill
    .command("add")
    .description("Add a skill to a pack.")
    .addArgument(catalogRefArgument("<ref>", "catalog, local, or git skill", "skill"))
    .option("--id <id>", "pack ID")
    .addOption(gitRefreshOption())
    .option("--json", "emit machine-readable output")
    .action(async (ref, options) => {
      await run(async () => {
        const result = await addSkill({
          packId: options.id,
          ref,
          gitRefresh: options.gitRefresh,
        });
        if (options.json) {
          printJson({
            skills: result.skills,
            skipped: result.skipped,
            summary: statusJson(result.pack),
          });
        } else {
          process.stdout.write(
            addResultLine("skill", result.pack.id, result.skills.length, result.skipped.length),
          );
          process.stdout.write(renderSummary(result.pack));
        }
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
        process.stdout.write(catalogTable(entries));
      });
    });

  catalog
    .command("show")
    .description("Print a catalog entry file.")
    .addArgument(catalogTypeArgument())
    .addArgument(catalogNameArgument())
    .action(async (type, name) => {
      await run(async () => {
        process.stdout.write((await catalogShow(type, name)).content);
      });
    });

  catalog
    .command("path")
    .description("Print a catalog entry path.")
    .addArgument(catalogTypeArgument())
    .addArgument(catalogNameArgument())
    .action(async (type, name) => {
      await run(async () => {
        process.stdout.write(`${await catalogPath(type, name)}\n`);
      });
    });
}

function catalogTypeOption(): Option {
  return new Option("--type <type>", "catalog entry type").choices(catalogTypes);
}

function catalogTypeArgument() {
  return new Argument("<type>", "catalog entry type").choices(catalogTypes);
}

function collectInclude(includes: InitInclude[], toInclude: (value: string) => InitInclude) {
  return (value: string, previous: string[]): string[] => {
    previous.push(value);
    includes.push(toInclude(value));
    return previous;
  };
}

function collectString(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function taskListMode(options: { all?: boolean; locked?: boolean }): TaskListMode {
  if (options.all && options.locked) {
    throw new AgentPackError("pass only one of --all or --locked");
  }
  if (options.all) {
    return "all";
  }
  if (options.locked) {
    return "locked";
  }
  return "active";
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
    `Default create id: ${result.defaultCreateId ?? "(unset)"}`,
    "",
  ].join("\n");
}

function statusJson(pack: PackState) {
  return {
    id: pack.id,
    name: pack.name,
    status: pack.status,
    createdAt: pack.createdAt,
    updatedAt: pack.updatedAt,
    tasks: pack.taskCounts,
    references: pack.references.length,
    skills: pack.skills.length,
    agents: pack.agents?.length ?? 0,
  };
}

function taskJson(task: PackState["tasks"][number]) {
  return {
    id: task.id,
    title: task.title,
    category: task.category,
    body: task.body,
    doneWhen: task.doneWhen,
    status: task.status,
    activation: task.activation,
    when: task.when,
    unlockedAt: task.unlockedAt,
  };
}

function statusTable(packs: PackState[]): string {
  return renderTable(
    [
      { header: "ID", value: (pack) => pack.id },
      { header: "NAME", value: (pack) => pack.name },
      { header: "STATUS", value: (pack) => pack.status },
      {
        header: "TASKS",
        value: (pack) => `${pack.taskCounts.completed}/${pack.taskCounts.total}`,
      },
      { header: "BLOCKED", value: (pack) => pack.taskCounts.blocked },
      { header: "CREATED", value: (pack) => formatListTimestamp(pack.createdAt) },
      { header: "UPDATED", value: (pack) => formatListTimestamp(pack.updatedAt) },
    ],
    packs,
  );
}

function sortPacksForList(packs: PackState[]): PackState[] {
  return [...packs].sort((left, right) => {
    const updated = right.updatedAt.localeCompare(left.updatedAt);
    return updated === 0 ? left.id.localeCompare(right.id) : updated;
  });
}

function formatListTimestamp(value: string): string {
  return value.slice(0, 16).replace("T", " ");
}

function renderTaskMutation(pack: PackState, taskId: string, action: string): string {
  return [
    `Updated ${taskId}: ${action}`,
    `Tasks: ${pack.taskCounts.completed}/${pack.taskCounts.total} completed, ${pack.taskCounts.blocked} blocked`,
    "",
  ].join("\n");
}

function taskMutationLabel(status: TaskStatus): string {
  return status === "in_progress" ? "started" : status;
}

function inputTable(entries: Awaited<ReturnType<typeof listInputs>>): string {
  return renderTable(
    [
      { header: "NAME", value: (entry) => entry.name },
      { header: "VALUE", value: (entry) => entry.value },
      { header: "REQUIRED", value: (entry) => (entry.required ? "yes" : "no") },
      { header: "TYPE", value: (entry) => entry.type },
      { header: "SOURCE", value: (entry) => entry.source },
      { header: "DESCRIPTION", value: (entry) => entry.description },
    ],
    entries,
  );
}

function catalogTable(entries: Awaited<ReturnType<typeof catalogList>>): string {
  const columns: TableColumn<(typeof entries)[number]>[] = [
    { header: "TYPE", value: (entry) => entry.type },
    { header: "NAME", value: (entry) => entry.name },
    { header: "PATH", value: (entry) => entry.path },
  ];
  return renderTable(columns, entries);
}

function inputMutationJson(result: Awaited<ReturnType<typeof setInput>>) {
  return {
    input: result.input,
    unlocked: result.unlocked.map(taskJson),
    summary: statusJson(result.pack),
  };
}

function inputMutationText(
  verb: "Updated" | "Unset",
  name: string,
  unlocked: PackState["tasks"],
): string {
  const lines = [`${verb} input ${name}.`];
  if (unlocked.length) {
    lines.push(`Unlocked ${unlocked.length} ${unlocked.length === 1 ? "task" : "tasks"}:`);
    for (const task of unlocked) {
      lines.push(`- ${task.id} ${task.title}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function addResultLine(
  kind: "reference" | "skill",
  packId: string,
  added: number,
  skipped: number,
): string {
  const plural = kind === "reference" ? "references" : "skills";
  const noun = added === 1 ? kind : plural;
  if (added === 0) {
    return `No new ${plural} added to pack ${packId}; skipped ${skipped} already present.\n`;
  }
  return `Added ${added} ${noun} to pack ${packId}; skipped ${skipped} already present.\n`;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function packageHelpText(): string {
  const root = packageResourceRoot();
  if (!root) {
    return "";
  }
  const resources = [
    ["README", "README.md"],
    ["Usage", "docs/usage.md"],
    ["Examples", "examples"],
  ]
    .map(([label, relativePath]) => ({ label, path: path.join(root, relativePath) }))
    .filter((resource) => existsSync(resource.path));
  if (resources.length === 0) {
    return "";
  }
  const width = Math.max(...resources.map((resource) => resource.label.length));
  return `\nResources:\n${resources
    .map((resource) => `  ${resource.label.padEnd(width)}  ${resource.path}`)
    .join("\n")}`;
}

function packageResourceRoot(): string | undefined {
  if (isCompiledBun()) {
    return path.dirname(process.execPath);
  }
  return packageRoot();
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
  if (typeof __AGENT_PACK_VERSION__ === "string" && __AGENT_PACK_VERSION__) {
    return __AGENT_PACK_VERSION__;
  }
  if (isCompiledBun()) {
    return "0.0.0";
  }
  const pkg = JSON.parse(readFileSync(path.join(packageRoot(), "package.json"), "utf8")) as {
    version?: unknown;
  };
  return typeof pkg.version === "string" ? pkg.version : "0.0.0";
}

function isCompiledBun(): boolean {
  return (
    typeof (process.versions as NodeJS.ProcessVersions & { bun?: string }).bun === "string" &&
    import.meta.url.includes("$bunfs")
  );
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
