#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Argument, Command, Option } from "commander";
import { renderReport, renderSummary, renderTask } from "../core/brief/render.js";
import { catalogTypes } from "../core/catalog.js";
import { AgentPackError } from "../core/errors.js";
import {
  addTask,
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

let startupError: AgentPackError | undefined;

const completionShells = ["bash", "zsh", "fish"] as const;

type CompletionShell = (typeof completionShells)[number];
type CompletionValueSource =
  | { kind: "catalog"; type: CatalogType }
  | { kind: "catalogFromOperand"; index: number };

const completionValueSources = new WeakMap<Option | Argument, CompletionValueSource>();

const program = configureProgram();

program.parseAsync(process.argv).catch((error) => {
  if (error instanceof AgentPackError) {
    console.error(`agent-pack: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  throw error;
});

function configureProgram(): Command {
  const root = new Command();
  root
    .name("agent-pack")
    .description("Prepare durable work packets for coding agents.")
    .version(packageVersion())
    .addHelpText("after", packageHelpText());

  configureInitCommand(root);

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

  configureTaskCommands(root);
  configureCatalogCommands(root);
  configureCompletionCommands(root);

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

function configureCompletionCommands(root: Command): void {
  const completion = root
    .command("completion")
    .description("Print shell completion setup instructions.")
    .addArgument(shellArgument("[shell]", "shell to configure: bash, zsh, or fish").argOptional())
    .action(async (shell) => {
      await run(async () => {
        process.stdout.write(completionInstructions(normalizeShell(shell)));
      });
    });

  completion
    .command("script")
    .description("Print a shell completion script.")
    .addArgument(shellArgument("<shell>", "shell script to print: bash, zsh, or fish"))
    .action(async (shell) => {
      await run(async () => {
        process.stdout.write(completionScript(normalizeShell(shell)));
      });
    });

  root
    .command("__complete", { hidden: true })
    .allowUnknownOption()
    .argument("<prefix>", "current word prefix")
    .argument("[words...]", "completed words before the current prefix")
    .action(async (prefix, words: string[]) => {
      await run(async () => {
        process.stdout.write(await completionCandidates(root, prefix, words));
      });
    });
}

function configureInitCommand(root: Command): void {
  const includes: InitInclude[] = [];
  root
    .command("init")
    .description("Create a pack.")
    .option("--id <id>", "use a specific pack ID")
    .option("--name <name>", "set a display name")
    .addOption(
      catalogRefOption(
        "--manifest <ref>",
        "load a catalog, local, or git pack manifest YAML file",
        "manifest",
        collectInclude(includes, (ref) => ({ type: "manifest", ref })),
      ),
    )
    .addOption(
      catalogRefOption(
        "--manifests <ref>",
        "load a catalog, local, or git pack manifest YAML file",
        "manifest",
        collectInclude(includes, (ref) => ({ type: "manifest", ref })),
      ),
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
    .addOption(
      catalogRefOption(
        "--task <ref>",
        "add catalog, local, or git task YAML",
        "task",
        collectInclude(includes, (ref) => ({ type: "taskRef", ref })),
      ),
    )
    .addOption(
      catalogRefOption(
        "--tasks <ref>",
        "add catalog, local, or git task YAML",
        "task",
        collectInclude(includes, (ref) => ({ type: "taskRef", ref })),
      ),
    )
    .addOption(
      catalogRefOption(
        "--reference <ref>",
        "add catalog, local, URL, or git reference",
        "reference",
        collectInclude(includes, (ref) => ({ type: "reference", ref: { ref } })),
      ),
    )
    .addOption(
      catalogRefOption(
        "--references <ref>",
        "add catalog, local, URL, or git reference",
        "reference",
        collectInclude(includes, (ref) => ({ type: "reference", ref: { ref } })),
      ),
    )
    .addOption(
      catalogRefOption(
        "--skill <ref>",
        "add catalog, local, or git skill",
        "skill",
        collectInclude(includes, (ref) => ({ type: "skill", ref: { ref } })),
      ),
    )
    .addOption(
      catalogRefOption(
        "--skills <ref>",
        "add catalog, local, or git skill",
        "skill",
        collectInclude(includes, (ref) => ({ type: "skill", ref: { ref } })),
      ),
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

function catalogNameArgument(): Argument {
  const argument = new Argument("<name>", "catalog name");
  completionValueSources.set(argument, { kind: "catalogFromOperand", index: 0 });
  return argument;
}

function catalogRefOption(
  flags: string,
  description: string,
  type: CatalogType,
  parseArg: (value: string, previous: string[]) => string[],
): Option {
  const option = new Option(flags, description).argParser(parseArg).default([]);
  completionValueSources.set(option, { kind: "catalog", type });
  return option;
}

function shellArgument(flags: string, description: string): Argument {
  return new Argument(flags, description).choices(completionShells);
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

function normalizeShell(value: unknown): CompletionShell {
  if (value === "bash" || value === "zsh" || value === "fish") {
    return value;
  }
  if (value === undefined) {
    const detected = path.basename(process.env.SHELL ?? "");
    if (detected === "bash" || detected === "zsh" || detected === "fish") {
      return detected;
    }
    throw new AgentPackError("could not detect shell; pass bash, zsh, or fish");
  }
  throw new AgentPackError(`unsupported shell: ${String(value)}; expected bash, zsh, or fish`);
}

function completionInstructions(shell: CompletionShell): string {
  const command =
    shell === "fish"
      ? "agent-pack completion script fish | source"
      : `source <(agent-pack completion script ${shell})`;
  const rcFile =
    shell === "bash" ? "~/.bashrc" : shell === "zsh" ? "~/.zshrc" : "~/.config/fish/config.fish";
  return [
    `Detected shell: ${shell}`,
    "",
    "For this shell only:",
    `  ${command}`,
    "",
    `To enable permanently, add this to ${rcFile}:`,
    `  ${command}`,
    "",
  ].join("\n");
}

function completionScript(shell: CompletionShell): string {
  switch (shell) {
    case "bash":
      return bashCompletionScript();
    case "zsh":
      return zshCompletionScript();
    case "fish":
      return fishCompletionScript();
    default:
      throw new AgentPackError(`unsupported shell: ${shell}`);
  }
}

async function completionCandidates(
  root: Command,
  prefix: string,
  words: string[],
): Promise<string> {
  const candidates = await resolveCompletionCandidates(root, prefix, words);
  const matches = candidates.filter((candidate) => candidate.startsWith(prefix));
  return matches.length > 0 ? `${matches.join("\n")}\n` : "";
}

async function resolveCompletionCandidates(
  root: Command,
  prefix: string,
  words: string[],
): Promise<string[]> {
  const context = completionContext(root, words);
  const equalsValue = optionValuePrefix(context.command, prefix);
  if (equalsValue) {
    const values = await valueCandidates(
      equalsValue.option,
      context.operands,
      equalsValue.valuePrefix,
    );
    return values.map((value) => `${equalsValue.flag}=${value}`);
  }

  if (context.pendingOption) {
    return valueCandidates(context.pendingOption, context.operands, prefix);
  }

  if (prefix.startsWith("-")) {
    return optionCandidates(context.command);
  }

  const candidates: string[] = [];
  if (context.operands.length === 0) {
    candidates.push(...subcommandCandidates(context.command));
  }

  const argument = context.command.registeredArguments[context.operands.length];
  if (argument) {
    candidates.push(...(await valueCandidates(argument, context.operands, prefix)));
  }

  return unique(candidates);
}

function completionContext(
  root: Command,
  words: string[],
): { command: Command; operands: string[]; pendingOption?: Option } {
  let command = root;
  const operands: string[] = [];
  let pendingOption: Option | undefined;

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (pendingOption) {
      pendingOption = undefined;
      continue;
    }

    if (word === "--") {
      operands.push(...words.slice(index + 1));
      break;
    }

    if (operands.length === 0) {
      const subcommand = visibleSubcommand(command, word);
      if (subcommand) {
        command = subcommand;
        continue;
      }
    }

    const option = optionForToken(command, word);
    if (option) {
      if ((option.required || option.optional) && !word.includes("=")) {
        pendingOption = option;
      }
      continue;
    }

    operands.push(word);
  }

  return { command, operands, pendingOption };
}

function optionValuePrefix(
  command: Command,
  prefix: string,
): { flag: string; option: Option; valuePrefix: string } | undefined {
  if (!prefix.startsWith("--") || !prefix.includes("=")) {
    return undefined;
  }
  const index = prefix.indexOf("=");
  const flag = prefix.slice(0, index);
  const option = command.options.find((candidate) => candidate.long === flag);
  if (!option || (!option.required && !option.optional)) {
    return undefined;
  }
  return { flag, option, valuePrefix: prefix.slice(index + 1) };
}

function optionForToken(command: Command, token: string): Option | undefined {
  if (!token.startsWith("-")) {
    return undefined;
  }
  const flag = token.includes("=") ? token.slice(0, token.indexOf("=")) : token;
  return command.options.find((option) => option.long === flag || option.short === flag);
}

async function valueCandidates(
  target: Option | Argument,
  operands: string[],
  prefix: string,
): Promise<string[]> {
  const choices = target.argChoices;
  if (choices) {
    return choices;
  }

  const source = completionValueSources.get(target);
  if (!source) {
    return [];
  }

  const catalogType =
    source.kind === "catalog" ? source.type : catalogTypeFromOperand(operands[source.index]);
  if (!catalogType || isExplicitCompletionPath(prefix)) {
    return [];
  }

  return (await catalogList(catalogType)).map((entry) => entry.name);
}

function catalogTypeFromOperand(value: string | undefined): CatalogType | undefined {
  if (value && isCatalogType(value)) {
    return value;
  }
  return undefined;
}

function subcommandCandidates(command: Command): string[] {
  return command.commands
    .filter((candidate) => !isHiddenCommand(candidate))
    .map((candidate) => candidate.name());
}

function optionCandidates(command: Command): string[] {
  return command.options
    .filter((option) => !option.hidden)
    .map((option) => option.long)
    .filter((option): option is string => typeof option === "string");
}

function visibleSubcommand(command: Command, name: string): Command | undefined {
  return command.commands.find(
    (candidate) => !isHiddenCommand(candidate) && candidate.name() === name,
  );
}

function isHiddenCommand(command: Command): boolean {
  return (command as Command & { _hidden?: boolean })._hidden === true;
}

function isCatalogType(value: string): value is CatalogType {
  return catalogTypes.includes(value as CatalogType);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isExplicitCompletionPath(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value === "~" ||
    value.startsWith("~/")
  );
}

function bashCompletionScript(): string {
  return `_agent_pack_completion() {
  local cur
  local -a words
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  words=("\${COMP_WORDS[@]:1:COMP_CWORD-1}")
  COMPREPLY=( $(compgen -W "$(agent-pack __complete -- "$cur" "\${words[@]}" 2>/dev/null)" -- "$cur") )
}

complete -o default -o bashdefault -F _agent_pack_completion agent-pack
`;
}

function zshCompletionScript(): string {
  return `#compdef agent-pack

_agent_pack() {
  local current="\${words[CURRENT]}"
  local -a prior
  prior=("\${words[2,$(( CURRENT - 1 ))]}")
  local -a names
  names=("\${(@f)$(agent-pack __complete -- "$current" "\${prior[@]}" 2>/dev/null)}")
  if (( \${#names[@]} == 0 )); then
    _files
    return
  fi
  compadd -a names
}

compdef _agent_pack agent-pack
`;
}

function fishCompletionScript(): string {
  return `function __agent_pack_complete
  set -l current (commandline -ct)
  set -l words (commandline -opc)
  if test (count $words) -gt 0
    set -e words[1]
  end
  if test (count $words) -gt 0; and test "$words[-1]" = "$current"
    set -e words[-1]
  end
  agent-pack __complete -- "$current" $words 2>/dev/null
end

complete -c agent-pack -a '(__agent_pack_complete)'
`;
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

function taskJson(task: PackState["tasks"][number]) {
  return {
    id: task.id,
    title: task.title,
    category: task.category,
    body: task.body,
    doneWhen: task.doneWhen,
    status: task.status,
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
