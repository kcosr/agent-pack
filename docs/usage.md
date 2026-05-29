# agent-pack Usage

This page is a compact reference for installed `agent-pack` users. Start with the repository `README.md` for the full walkthrough.

Run commands from the repository or workspace that contains the files you want the agent to inspect.

Requirements:

- Node.js 20 or newer
- Git and `tar` on `PATH` for git-backed inputs
- Bun when manually building a standalone executable with `npm run build:bun`

## Quick Start

Create a pack from the included demo manifest:

```bash
EXAMPLES_DIR="$(agent-pack --help | sed -n 's/^[[:space:]]*Examples[[:space:]][[:space:]]*//p')"

agent-pack init \
  --manifest "$EXAMPLES_DIR/manifests/demo.yaml" \
  "Run the demo task and record the result."
```

Set the generated pack id before asking an agent to work:

```bash
export AGENT_PACK_ID=<generated-id>
agent-pack brief
```

`init` uses `--create-id` when provided, then `AGENT_PACK_CREATE_ID` when set, and otherwise generates an id from the pack name plus a short random suffix. `--id` and `AGENT_PACK_ID` target existing packs.

List packs in the current state directory:

```bash
agent-pack list
agent-pack list --json
```

For long task lists, render a compact brief that shows task status, ID, and title without task bodies:

```bash
AGENT_PACK_BRIEF_TASK_CONTENT=false agent-pack brief
```

The compact brief tells the agent to run `agent-pack task show <task-id>` before working a task.

Then ask an agent to run the brief and update task status as it works:

```bash
agent-pack task show t001
agent-pack task add "Review follow-up"
agent-pack task start t001
agent-pack task note t001 "date output: Thu May 7 ..."
agent-pack task done t001 --note "Recorded date output."
agent-pack summary
agent-pack report
```

`task start`, `task note`, `task done`, and `task block` print compact task-count confirmations. `task show`, `summary`, and `report` print text for humans and agents by default. Use `task add <title> --json`, `task show <task-id> --json`, `summary --json`, or `report --json` for scripts that need saved state objects.

To let `agent-pack` launch a configured agent subprocess, add an agent definition and use `run`:

```yaml
agents:
  - name: claude
    command: claude
    args: ["--print", "{prompt}"]
```

```bash
agent-pack run --manifest ./pack.yaml --run-agent claude "Review scope: unstaged changes."
agent-pack run --id <existing-pack-id> --run-agent claude
```

If a pack has exactly one stored agent, `--run-agent` can be omitted. Captured `run` executions capture agent stdout, record it in `agentRuns`, and print the final report. Backend stderr is not streamed or stored.

For an interactive backend session, use an agent definition whose args start the backend interactively and pass `--interactive`:

```yaml
agents:
  - name: claude-interactive
    command: claude
    args: ["--model", "claude-opus-4-7", "--effort", "xhigh", "{prompt}"]
```

```bash
agent-pack run --id <existing-pack-id> --run-agent claude-interactive --interactive
```

Interactive runs inherit terminal stdin/stdout/stderr, do not capture output, ignore `timeoutSec`, do not support `--json`, and print nothing after the backend exits. They still record exit metadata in `agentRuns`.

Inspect resolved paths and defaults:

```bash
agent-pack status
agent-pack status --json
```

## Source Types

Use these flags with `agent-pack init`:

- `--manifest <ref>`: one catalog, local, or git-backed manifest YAML file
- `--input <key=value>`: set one declared manifest input; repeat for multiple inputs
- `--add-task <text>`: one inline task
- `--task <ref>`: catalog task, local task YAML file, glob, or git-backed task file
- `--reference <ref>`: catalog reference, local file, directory, glob, HTTP/HTTPS URL, git path, or whole git repo
- `--skill <ref>`: catalog skill, local `SKILL.md` file, directory scan, glob, or git-backed skill source
- `--agent <ref>`: catalog, local, or git-backed agent definition
- `--instructions <path>`: raw text instructions file

After a pack exists, use additive commands to compose it further:

```bash
agent-pack task add "Review follow-up"
agent-pack reference add ./docs/api.md
agent-pack reference add product/api
agent-pack skill add ./skills/review/SKILL.md
agent-pack skill add engineering/fresh-eyes
agent-pack input list
agent-pack input set severity high
```

`task add` accepts optional `--category`, `--body`, repeatable `--done-when`, and `--json`. `reference add` and `skill add` accept the same ref formats as `init --reference` and `init --skill`, infer names and descriptions from the existing resolvers, skip sources already present in the pack, and support `--git-refresh auto|always|never` plus `--json`. `input set` validates against the stored manifest schema and unlocks conditional tasks whose `when` clauses are satisfied.

Manifest `tasks`, `references`, `skills`, and `agents` arrays can use the same refs as these CLI flags:

```yaml
tasks:
  - review/security
  - ./tasks/*.yaml
  - id: inline-check
    title: Check local state
  - id: strict-review
    title: Review strictly
    when:
      severity: high
references:
  - product/api
  - ./docs/**/*.md
skills:
  - engineering/fresh-eyes
  - ./skills
agents:
  - ./agents/claude.yaml
  - name: local-claude
    command: claude
    args: ["--print", "{prompt}"]
```

Manifest `inputs` can declare required values and defaults:

```yaml
inputs:
  scope:
    required: true
    description: What should the agent inspect?
  severity:
    type: enum
    values: [low, medium, high]
    default: medium
```

Initialize with inputs:

```bash
agent-pack init --manifest review/code-review --input scope="unstaged changes"
```

Bare refs such as `review/security` are catalog refs under the config directory. Local paths must start with `./`, `../`, `~/`, or `/`.

Catalog default:

```text
$XDG_CONFIG_HOME/agent-pack/
~/.config/agent-pack/
```

Use `AGENT_PACK_CONFIG_DIR` to override it. Catalog layout:

```text
manifests/review/code-review.yaml
tasks/review/security.yaml
references/product/api.yaml
skills/engineering/fresh-eyes/SKILL.md
```

Create your own reusable pack files in that directory, then reference them by name:

```bash
agent-pack init --manifest review/code-review "Review scope: unstaged changes."
```

Inspect catalog entries:

```bash
agent-pack catalog list
agent-pack catalog show manifest review/code-review
agent-pack catalog path skill engineering/fresh-eyes
```

The npm package includes an `examples/` directory that is already laid out as a catalog root. Point `AGENT_PACK_CONFIG_DIR` at that directory when you want reusable bare refs:

```bash
EXAMPLES_DIR="$(agent-pack --help | sed -n 's/^[[:space:]]*Examples[[:space:]][[:space:]]*//p')"
AGENT_PACK_CONFIG_DIR="$EXAMPLES_DIR" agent-pack init --manifest code-review "Review scope: unstaged changes."
```

The manual Bun standalone build emits `dist-bin/agent-pack` and omits npm package resource paths from help. Use a real catalog directory with `AGENT_PACK_CONFIG_DIR` when running that copied executable.

Other bundled manifests include `docs-review` for documentation review and
`feature-design-summary` for creating a repository-grounded feature design
summary markdown file from a feature brief. The feature design-summary manifest
creates a feature branch from `main` by default; pass
`--input create_branch=false` to plan in the existing tree.

Enable shell completion for the current shell session:

```bash
source <(agent-pack completion script bash)
source <(agent-pack completion script zsh)
agent-pack completion script fish | source
```

For permanent setup, write the generated script once and source that file from shell startup instead of running `agent-pack` every time a shell starts:

```bash
mkdir -p ~/.local/share/agent-pack
agent-pack completion script bash > ~/.local/share/agent-pack/completion.bash
printf '\nsource ~/.local/share/agent-pack/completion.bash\n' >> ~/.bashrc
```

For zsh, use `completion.zsh` and `~/.zshrc`. For fish, write to `~/.config/fish/completions/agent-pack.fish`. Regenerate the file after upgrading `agent-pack`.

Run `agent-pack completion` for detected-shell instructions. Completion suggests command names, subcommands, option names, known enum values, shell names for `completion`, and catalog names for catalog-backed refs. When no app-known positional value exists, completion suggests options for the active command.

Git refs use this shape. See the README for the full list of supported URL forms:

```text
git+https://github.com/org/repo.git//path/in/repo.md#main
git+git@github.com:org/repo.git//path/in/repo.md#main
```

Omit `#ref` to use the repository default branch.

## State and Cache

Pack state is durable:

```text
.agent-pack/state/
```

Git cache material is rebuildable:

```text
$XDG_CACHE_HOME/agent-pack/
```

If `XDG_CACHE_HOME` is unset, the cache defaults to `~/.cache/agent-pack/`. If neither `XDG_CACHE_HOME` nor `HOME` is set, it falls back to `.agent-pack/cache` in the current working directory. Commit `.agent-pack/state/` if you want pack progress to travel with the repository. Ignore the cache only if you explicitly place `AGENT_PACK_CACHE_DIR` inside the repo.

On a new host, rebuild git-backed material:

```bash
agent-pack sync
agent-pack sync --json
agent-pack brief
```

Clean rebuildable git cache material without removing pack state:

```bash
agent-pack clean
agent-pack clean --id demo
agent-pack sync
```
