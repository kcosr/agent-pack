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
configureCompletionCommands(program);

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

function configureCompletionCommands(root: Command): void {
  const completion = root
    .command("completion")
    .description("Print shell completion setup instructions.")
    .argument("[shell]", "shell to configure: bash, zsh, or fish")
    .action(async (shell) => {
      await run(async () => {
        process.stdout.write(completionInstructions(normalizeShell(shell)));
      });
    });

  completion
    .command("script")
    .description("Print a shell completion script.")
    .argument("<shell>", "shell script to print: bash, zsh, or fish")
    .action(async (shell) => {
      await run(async () => {
        process.stdout.write(completionScript(normalizeShell(shell)));
      });
    });

  root
    .command("__complete", { hidden: true })
    .argument("<type>", "catalog entry type")
    .argument("[prefix]", "current word prefix", "")
    .action(async (type, prefix) => {
      await run(async () => {
        process.stdout.write(await completionCandidates(type, prefix));
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

type CompletionShell = "bash" | "zsh" | "fish";

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

async function completionCandidates(type: string, prefix: string): Promise<string> {
  if (!isCatalogType(type)) {
    throw new AgentPackError(`unsupported completion type: ${type}`);
  }
  if (isExplicitCompletionPath(prefix)) {
    return "";
  }
  const entries = await catalogList(type);
  const matches = entries
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(prefix))
    .join("\n");
  return matches ? `${matches}\n` : "";
}

function isCatalogType(value: string): value is CatalogType {
  return catalogTypes.includes(value as CatalogType);
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
  local cur prev sub kind
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  case "$prev" in
    --manifest|--manifests) kind="manifest" ;;
    --task|--tasks) kind="task" ;;
    --reference|--references) kind="reference" ;;
    --skill|--skills) kind="skill" ;;
    --type)
      COMPREPLY=( $(compgen -W "manifest task reference skill" -- "$cur") )
      return 0
      ;;
  esac

  if [[ -n "$kind" ]]; then
    COMPREPLY=( $(compgen -W "$(agent-pack __complete "$kind" "$cur" 2>/dev/null)" -- "$cur") )
    return 0
  fi

  sub="\${COMP_WORDS[1]}"
  if [[ "$sub" == "catalog" && ( "\${COMP_WORDS[2]}" == "show" || "\${COMP_WORDS[2]}" == "path" ) ]]; then
    if [[ "$COMP_CWORD" -eq 3 ]]; then
      COMPREPLY=( $(compgen -W "manifest task reference skill" -- "$cur") )
      return 0
    fi
    if [[ "$COMP_CWORD" -eq 4 ]]; then
      COMPREPLY=( $(compgen -W "$(agent-pack __complete "\${COMP_WORDS[3]}" "$cur" 2>/dev/null)" -- "$cur") )
      return 0
    fi
  fi
}

complete -o default -o bashdefault -F _agent_pack_completion agent-pack
`;
}

function zshCompletionScript(): string {
  return `#compdef agent-pack

_agent_pack_catalog_names() {
  local kind="$1"
  local current="\${words[CURRENT]}"
  if [[ "$current" == /* || "$current" == ./* || "$current" == ../* || "$current" == "~" || "$current" == "~/"* ]]; then
    _files
    return
  fi
  local -a names
  names=("\${(@f)$(agent-pack __complete "$kind" "$current" 2>/dev/null)}")
  compadd -a names
}

_agent_pack() {
  local -a catalog_types
  catalog_types=(manifest task reference skill)

  case "\${words[CURRENT-1]}" in
    --manifest|--manifests) _agent_pack_catalog_names manifest; return ;;
    --task|--tasks) _agent_pack_catalog_names task; return ;;
    --reference|--references) _agent_pack_catalog_names reference; return ;;
    --skill|--skills) _agent_pack_catalog_names skill; return ;;
    --type) _describe 'catalog type' catalog_types; return ;;
  esac

  if [[ "\${words[2]}" == "catalog" && ( "\${words[3]}" == "show" || "\${words[3]}" == "path" ) ]]; then
    if (( CURRENT == 4 )); then
      _describe 'catalog type' catalog_types
      return
    fi
    if (( CURRENT == 5 )); then
      _agent_pack_catalog_names "\${words[4]}"
      return
    fi
  fi

  _arguments '*: :_files'
}

compdef _agent_pack agent-pack
`;
}

function fishCompletionScript(): string {
  return `function __agent_pack_catalog_names
  set -l kind $argv[1]
  set -l current (commandline -ct)
  switch $current
    case '/*' './*' '../*' '~' '~/*'
      return
  end
  agent-pack __complete $kind $current 2>/dev/null
end

complete -c agent-pack -n '__fish_seen_subcommand_from init; and __fish_prev_arg_in --manifest --manifests' -a '(__agent_pack_catalog_names manifest)'
complete -c agent-pack -n '__fish_seen_subcommand_from init; and __fish_prev_arg_in --task --tasks' -a '(__agent_pack_catalog_names task)'
complete -c agent-pack -n '__fish_seen_subcommand_from init; and __fish_prev_arg_in --reference --references' -a '(__agent_pack_catalog_names reference)'
complete -c agent-pack -n '__fish_seen_subcommand_from init; and __fish_prev_arg_in --skill --skills' -a '(__agent_pack_catalog_names skill)'
complete -c agent-pack -n '__fish_seen_subcommand_from catalog; and __fish_seen_subcommand_from list; and __fish_prev_arg_in --type' -a 'manifest task reference skill'
complete -c agent-pack -n '__fish_seen_subcommand_from catalog; and __fish_seen_subcommand_from show; and not __fish_seen_subcommand_from manifest task reference skill' -a 'manifest task reference skill'
complete -c agent-pack -n '__fish_seen_subcommand_from catalog; and __fish_seen_subcommand_from path; and not __fish_seen_subcommand_from manifest task reference skill' -a 'manifest task reference skill'
complete -c agent-pack -n '__fish_seen_subcommand_from catalog; and __fish_seen_subcommand_from show; and __fish_seen_subcommand_from manifest' -a '(__agent_pack_catalog_names manifest)'
complete -c agent-pack -n '__fish_seen_subcommand_from catalog; and __fish_seen_subcommand_from show; and __fish_seen_subcommand_from task' -a '(__agent_pack_catalog_names task)'
complete -c agent-pack -n '__fish_seen_subcommand_from catalog; and __fish_seen_subcommand_from show; and __fish_seen_subcommand_from reference' -a '(__agent_pack_catalog_names reference)'
complete -c agent-pack -n '__fish_seen_subcommand_from catalog; and __fish_seen_subcommand_from show; and __fish_seen_subcommand_from skill' -a '(__agent_pack_catalog_names skill)'
complete -c agent-pack -n '__fish_seen_subcommand_from catalog; and __fish_seen_subcommand_from path; and __fish_seen_subcommand_from manifest' -a '(__agent_pack_catalog_names manifest)'
complete -c agent-pack -n '__fish_seen_subcommand_from catalog; and __fish_seen_subcommand_from path; and __fish_seen_subcommand_from task' -a '(__agent_pack_catalog_names task)'
complete -c agent-pack -n '__fish_seen_subcommand_from catalog; and __fish_seen_subcommand_from path; and __fish_seen_subcommand_from reference' -a '(__agent_pack_catalog_names reference)'
complete -c agent-pack -n '__fish_seen_subcommand_from catalog; and __fish_seen_subcommand_from path; and __fish_seen_subcommand_from skill' -a '(__agent_pack_catalog_names skill)'
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
