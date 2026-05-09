import path from "node:path";
import { Argument, type Command, Option } from "commander";
import { catalogTypes, isCatalogName } from "../core/catalog.js";
import { AgentPackError } from "../core/errors.js";
import { catalogList } from "../core/operations.js";
import type { CatalogType } from "../core/types.js";

const completionShells = ["bash", "zsh", "fish"] as const;

type CompletionShell = (typeof completionShells)[number];
type CompletionValueSource =
  | { kind: "catalog"; type: CatalogType }
  | { kind: "catalogFromOperand"; index: number };
type RunAction = (fn: () => Promise<void>) => Promise<void>;

const completionValueSources = new WeakMap<Option | Argument, CompletionValueSource>();
const hiddenCommands = new WeakSet<Command>();

export function configureCompletionCommands(root: Command, run: RunAction): void {
  const completion = root
    .command("completion")
    .description("Print shell completion setup instructions.")
    .addArgument(shellArgument("[shell]", "shell to configure: bash, zsh, or fish"))
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

  const hiddenComplete = root
    .command("__complete", { hidden: true })
    .allowUnknownOption()
    .argument("<prefix>", "current word prefix")
    .argument("[words...]", "completed words before the current prefix")
    .action(async (prefix, words: string[]) => {
      await run(async () => {
        process.stdout.write(await completionCandidates(root, prefix, words));
      });
    });
  hiddenCommands.add(hiddenComplete);
}

export function catalogNameArgument(): Argument {
  const argument = new Argument("<name>", "catalog name");
  completionValueSources.set(argument, { kind: "catalogFromOperand", index: 0 });
  return argument;
}

export function catalogRefOption(
  flags: string,
  description: string,
  type: CatalogType,
  parseArg: (value: string, previous: string[]) => string[],
): Option {
  const option = new Option(flags, description).argParser(parseArg).default([]);
  completionValueSources.set(option, { kind: "catalog", type });
  return option;
}

export function hasCatalogCompletionSource(target: Option | Argument): boolean {
  return completionValueSources.has(target);
}

export async function completionCandidates(
  root: Command,
  prefix: string,
  words: string[],
): Promise<string> {
  const candidates = await resolveCompletionCandidates(root, prefix, words);
  const matches = candidates.filter((candidate) => candidate.startsWith(prefix));
  return matches.length > 0 ? `${matches.join("\n")}\n` : "";
}

export async function resolveCompletionCandidates(
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

  const appCandidates = unique(candidates);
  return appCandidates.length > 0 ? appCandidates : optionCandidates(context.command);
}

function shellArgument(flags: string, description: string): Argument {
  return new Argument(flags, description).choices(completionShells);
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
    throw new AgentPackError(
      `could not detect shell from SHELL=${detected || "(unset)"}; pass bash, zsh, or fish`,
    );
  }
  throw new AgentPackError(`unsupported shell: ${String(value)}; expected bash, zsh, or fish`);
}

function completionInstructions(shell: CompletionShell): string {
  const currentShellCommand =
    shell === "fish"
      ? "agent-pack completion script fish | source"
      : `source <(agent-pack completion script ${shell})`;
  return [
    `Detected shell: ${shell}`,
    "",
    "For this shell only:",
    `  ${currentShellCommand}`,
    "",
    "To enable permanently, generate a completion file once:",
    ...permanentCompletionCommands(shell).map((command) => `  ${command}`),
    "",
    "Regenerate that file after upgrading agent-pack.",
    "",
  ].join("\n");
}

function permanentCompletionCommands(shell: CompletionShell): string[] {
  switch (shell) {
    case "bash":
      return [
        "mkdir -p ~/.local/share/agent-pack",
        "agent-pack completion script bash > ~/.local/share/agent-pack/completion.bash",
        "printf '\\nsource ~/.local/share/agent-pack/completion.bash\\n' >> ~/.bashrc",
      ];
    case "zsh":
      return [
        "mkdir -p ~/.local/share/agent-pack",
        "agent-pack completion script zsh > ~/.local/share/agent-pack/completion.zsh",
        "printf '\\nsource ~/.local/share/agent-pack/completion.zsh\\n' >> ~/.zshrc",
      ];
    case "fish":
      return [
        "mkdir -p ~/.config/fish/completions",
        "agent-pack completion script fish > ~/.config/fish/completions/agent-pack.fish",
      ];
  }
}

function completionScript(shell: CompletionShell): string {
  switch (shell) {
    case "bash":
      return bashCompletionScript();
    case "zsh":
      return zshCompletionScript();
    case "fish":
      return fishCompletionScript();
  }
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

  return (await catalogList(catalogType, { createDirs: false }))
    .map((entry) => entry.name)
    .filter(isCatalogName);
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
  return hiddenCommands.has(command);
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

complete -F _agent_pack_completion agent-pack
`;
}

function zshCompletionScript(): string {
  return `#compdef agent-pack

_agent_pack() {
  local current="\${words[CURRENT]}"
  local -a prior=()
  if (( CURRENT > 2 )); then
    prior=("\${words[2,$(( CURRENT - 1 ))]}")
  fi
  local -a names
  names=("\${(@f)$(agent-pack __complete -- "$current" "\${prior[@]}" 2>/dev/null)}")
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

complete -c agent-pack -f -a '(__agent_pack_complete)'
`;
}
