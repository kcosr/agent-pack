# CLI Reference

Every `agent-pack` command and subcommand, with options, exit codes, and JSON
output shapes. For concepts and the overall workflow, see
[concepts.md](concepts.md). For manifest, task, and agent file schemas, see
[authoring.md](authoring.md). For paths, environment variables, git sources,
and the catalog directory, see [configuration.md](configuration.md). For the
brief, summary, and report output specification, see
[brief-format.md](brief-format.md).

## Conventions

- Bare refs (such as `review/security`) are catalog refs loaded from the
  agent-pack config directory. Local filesystem paths must start with `./`,
  `../`, `~/`, or `/`. See [configuration.md](configuration.md) for the git
  ref syntax and supported URL forms.
- Most commands target a pack with `--id <id>`; when omitted, `AGENT_PACK_ID` is
  used. Commands that create packs use `--create-id <id>`, falling back to
  `AGENT_PACK_CREATE_ID`.
- The child agent invoked by `run` always receives `AGENT_PACK_ID`, and
  `AGENT_PACK_STATE_DIR` when it is set. See [configuration.md](configuration.md)
  for the full environment table.

### `--json` availability

`--json` is not universal. It emits machine-readable output on these commands:

| Has `--json` | Lacks `--json` |
|---|---|
| `init`, `run`, `sync`, `clean`, `list`, `status`, `report`, `summary` | `brief` |
| `task add`, `task show` | `task list`, `task start`, `task note`, `task done`, `task block` |
| `input list`, `input get`, `input set`, `input unset` | — |
| `reference add`, `skill add` | — |
| `catalog list` | `catalog show`, `catalog path` |
| — | `completion`, `completion script` |

`--interactive` cannot be combined with `--json` (see [Mutual-exclusion errors](#mutual-exclusion-errors)).

## `init`

Create a pack.

```bash
agent-pack init [options] [prompt]
```

The positional `[prompt]` is a one-off prompt rendered at the top of the brief.

| Option | Purpose |
|---|---|
| `--create-id <id>` | Use a specific ID for the new pack. If omitted, `AGENT_PACK_CREATE_ID` is used when set; otherwise `agent-pack` generates `<name>-<suffix>` |
| `--name <name>` | Set a display name |
| `--input <key=value>` | Set one declared manifest input; repeat for multiple inputs |
| `--manifest <ref>` | Load one catalog manifest, local manifest YAML file, or git ref |
| `--manifests <ref>` | Alias for `--manifest`; useful when passing several manifests |
| `--instructions <path>` | Read a plain text or Markdown file verbatim as the pack instructions section |
| `--add-task <text>` | Add one ad hoc task |
| `--task <ref>` | Add one catalog task, local task YAML file, glob, or git ref |
| `--tasks <ref>` | Alias for `--task`; useful when passing several task sources |
| `--reference <ref>` | Add one catalog reference, local reference file, directory, glob, URL, or git ref |
| `--references <ref>` | Alias for `--reference`; useful when passing several references |
| `--skill <ref>` | Add one catalog skill, local `SKILL.md` file, directory scan, glob, or git ref |
| `--skills <ref>` | Alias for `--skill`; useful when passing several skills |
| `--agent <ref>` | Add one catalog, local, or git agent definition |
| `--agents <ref>` | Alias for `--agent`; useful when passing several agent definitions |
| `--git-refresh <auto\|always\|never>` | Control git fetching for this command. Default: `AGENT_PACK_GIT_REFRESH`, else `auto`. See [git-refresh policy](configuration.md) |
| `--state-dir <path>` | Override the state directory for this command |
| `--json` | Emit machine-readable output |

Example (the `example/...` URLs and local paths are illustrative — replace them
with sources that exist for your project):

```bash
agent-pack init \
  --create-id reviewer-001 \
  --add-task "Check local unstaged changes" \
  --input scope="unstaged auth changes" \
  --manifest git+https://github.com/example/agent-packs.git//review/base.yaml#main \
  --task git+https://github.com/example/agent-packs.git//tasks/security-review.yaml#main \
  --task ./tasks/*.yaml \
  --reference git+https://github.com/example/product.git//docs/**/*.md#main \
  --reference https://example.com/design-notes.md \
  --skill git+https://github.com/example/agent-skills.git//review/fresh-eyes/SKILL.md#v1.0.0 \
  --skills ./skills \
  --agent ./agents/claude.yaml \
  "Use the included docs and skills to complete the review."
```

That command composes content across types: the manifest can contribute
instructions, tasks, references, skills, agents, and contract rules; task flags
add more tasks; reference flags add git, URL, and local reading material; skill
flags add supplemental `SKILL.md` files; agent flags add launch profiles for
`agent-pack run`. The same content can be expressed as a single manifest YAML —
see [authoring.md](authoring.md).

## `run`

Run one configured agent against a pack.

```bash
agent-pack run [options] [prompt]
```

For an existing pack, the positional `[prompt]` is a follow-up message for this
agent run, recorded on the `agentRuns` entry. For a new pack, it is the one-off
prompt. `run` accepts the same composition flags as `init`, so it can create a
pack and run it in one command.

| Option | Purpose |
|---|---|
| `--id <id>` | Existing pack ID to run against |
| `--create-id <id>` | Use a specific ID for the new pack |
| `--name <name>` | Set a display name for a new pack |
| `--input <key=value>` | Set one declared manifest input for a new pack; repeat for multiple |
| `--manifest <ref>` | Load one catalog, local, or git pack manifest for a new pack |
| `--manifests <ref>` | Alias for `--manifest` |
| `--instructions <path>` | Load raw instructions from a text or Markdown file for a new pack |
| `--add-task <text>` | Add one ad hoc task for a new pack |
| `--task <ref>` | Add catalog, local, or git task YAML for a new pack |
| `--tasks <ref>` | Alias for `--task` |
| `--reference <ref>` | Add catalog, local, URL, or git reference for a new pack |
| `--references <ref>` | Alias for `--reference` |
| `--skill <ref>` | Add catalog, local, or git skill for a new pack |
| `--skills <ref>` | Alias for `--skill` |
| `--agent <ref>` | Add a catalog, local, or git agent definition for a new pack |
| `--agents <ref>` | Alias for `--agent` |
| `--run-agent <name>` | Stored agent name to execute. Optional when the pack has exactly one stored agent |
| `--git-refresh <auto\|always\|never>` | Control git fetching for this command. Default: `AGENT_PACK_GIT_REFRESH`, else `auto` |
| `--state-dir <path>` | Override the state directory for this command |
| `--interactive` | Run the agent with inherited terminal stdio |
| `--json` | Emit machine-readable output |

```bash
# Run a stored agent against an existing pack
agent-pack run --id reviewer-001 --run-agent local-claude

# Omit --run-agent when the pack has exactly one stored agent
agent-pack run --id reviewer-001

# Send a follow-up message to an existing pack
agent-pack run --id reviewer-001 "Please re-check the prior finding after my edits."

# Create a pack and run it in one command
agent-pack run \
  --create-id reviewer-001 \
  --manifest ./reviewer-pack.yaml \
  --agent ./agents/claude.yaml \
  --run-agent claude \
  "Use the included docs and skills to complete the review."
```

`--agent` and `--agents` compose agent definitions into a new pack. `--run-agent`
selects the stored agent to execute. Agent names must be unique within a pack;
duplicate names fail instead of being renamed.

`{prompt}` is the only supported template variable in an agent's `args`. It
expands to a generated instruction that tells the subprocess to run `agent-pack
brief` and follow the brief. For existing packs, a positional follow-up message
is included in that generated prompt and recorded on the `agentRuns` entry;
agents must include `{prompt}` in `args` to receive a follow-up message.
Backend-specific flags such as model or effort belong in `args`; the parser does
not validate them. For the agent file schema, see [authoring.md](authoring.md).

By default, `run` captures the subprocess stdout, stores it in the pack's
`agentRuns`, and prints the final `agent-pack report` output. Backend stderr is
not streamed, stored, or rendered. With `--json`, `run` prints
`{ pack, runs, outcome }`.

`maxAttempts` defaults to `1` and applies to captured runs only. When a captured
run fails, times out, or exits with active tasks still pending or in progress,
`run` retries until the selected agent reaches `maxAttempts`. Each attempt is
recorded as its own `agentRuns` entry. Retries stop as soon as all active tasks
are completed or any active task is marked `blocked`. A `maxAttempts` greater
than `1` requires `{prompt}` in `args`, and is a hard error when combined with
`--interactive`.

Interactive runs (`--interactive`) inherit stdin, stdout, and stderr from the
current terminal. They do not capture output, do not apply `timeoutSec`, do not
retry with `maxAttempts`, and do not support `--json`. They still append an
`agentRuns` entry with mode, status, exit code, signal, and timestamps. The exit
code passes through from the child agent (see [Exit codes](#exit-codes)).

The `run --json` `outcome` is `{ status, attempts }`, where `status` is one of
`completed`, `blocked`, `exhausted`, or `failed`.

## `brief`

Print the agent-facing brief. No `--json`.

```bash
agent-pack brief --id reviewer-001
```

| Option | Purpose |
|---|---|
| `--id <id>` | Pack ID |

The brief shows active tasks only; locked conditional tasks are omitted until
their conditions are satisfied. For the full render order and output spec, see
[brief-format.md](brief-format.md). Set `AGENT_PACK_BRIEF_TASK_CONTENT=false`
to render a compact task section (status, ID, title only); see
[configuration.md](configuration.md).

## `sync`

Fetch and unpack missing git cache material for a pack.

```bash
agent-pack sync --id reviewer-001
agent-pack sync --id reviewer-001 --git-refresh always
agent-pack sync --id reviewer-001 --json
```

| Option | Purpose |
|---|---|
| `--id <id>` | Pack ID |
| `--git-refresh <auto\|always\|never>` | Git fetch policy. Default: `AGENT_PACK_GIT_REFRESH`, else `auto` |
| `--json` | Emit the synced pack as JSON |

`sync` is explicit for existing pack material. `reference add` and `skill add`
also resolve git refs when adding new material. Other commands do not fetch or
clone git sources. If a pack is resumed on a new host, run `sync` before
`brief`. Local references and skills are not affected by `sync`; they are read
from their paths when the agent uses them. See
[configuration.md](configuration.md) for the `--git-refresh` policy table and
git ref syntax.

## `clean`

Remove rebuildable git cache material for packs in the current state directory.

```bash
agent-pack clean
agent-pack clean --id reviewer-001
agent-pack clean --json
```

| Option | Purpose |
|---|---|
| `--id <id>` | Limit cleanup to one pack ID |
| `--json` | Emit `{ packIds, repoHashes, removed }` |

By default, `clean` reads all packs in the current state directory and removes
matching `git/<repoHash>` mirrors and `snapshots/<repoHash>` directories from the
cache root. `--id` limits cleanup to one pack. Pack state, event logs, local
references, HTTP/HTTPS references, and locks are not removed. After cleaning, run
`agent-pack sync --id <pack>` before rendering briefs for packs with git-backed
material. For cache layout and sharing behavior, see
[configuration.md](configuration.md).

## `list`

List packs in the current state directory.

```bash
agent-pack list
agent-pack list --json
```

| Option | Purpose |
|---|---|
| `--json` | Emit an array of status objects |

Text output is an aligned table sorted by most recently updated pack first. It
includes pack id, name, status, completed/total task count, blocked count,
created time, and updated time.

## `task`

List, inspect, and update pack tasks.

```bash
agent-pack task add "Review auth flow" --id reviewer-001
agent-pack task add "Review auth flow" --id reviewer-001 --category review --body "Inspect session handling." --done-when "Findings cite files" --done-when "Test gaps are noted"
agent-pack task list --id reviewer-001
agent-pack task list --id reviewer-001 --locked
agent-pack task list --id reviewer-001 --all
agent-pack task show t001 --id reviewer-001
agent-pack task start t001 --id reviewer-001 --note "Starting review."
agent-pack task note t001 --id reviewer-001 "Read the design."
agent-pack task done t001 --id reviewer-001 --note "Completed with evidence in notes."
agent-pack task block t002 --id reviewer-001 --note "Need user decision."
```

### `task add`

Add an ad hoc task to a pack. The title is required and must not be empty after
trimming; optional values must also be non-empty when provided.

| Option / Argument | Purpose |
|---|---|
| `<title>` | Task title (required) |
| `--id <id>` | Pack ID |
| `--category <category>` | Task category |
| `--body <text>` | Task body/details |
| `--done-when <criterion>` | Completion criterion; repeatable |
| `--json` | Emit `{ task, summary }` |

### `task list`

List tasks in a pack. Shows only active tasks by default. No `--json`.

| Option | Purpose |
|---|---|
| `--id <id>` | Pack ID |
| `--all` | Include locked tasks (active and locked) |
| `--locked` | Show only locked conditional tasks |

`--all` and `--locked` are mutually exclusive (see [Mutual-exclusion errors](#mutual-exclusion-errors)).

### `task show`

Show a task. Prints a human-readable detail (status, body, `doneWhen`, notes) by
default.

| Option / Argument | Purpose |
|---|---|
| `<taskId>` | Task ID (required) |
| `--id <id>` | Pack ID |
| `--json` | Emit the task state object |

### `task start` / `task done` / `task block`

Update task status. Each prints a compact confirmation with the updated task ID
and active task counts. No `--json`.

| Command | Sets status | Argument / Option |
|---|---|---|
| `task start <taskId>` | `in_progress` | `--id <id>`, `--note <progress note>` |
| `task done <taskId>` | `completed` | `--id <id>`, `--note <completion evidence>` |
| `task block <taskId>` | `blocked` | `--id <id>`, `--note <blocker note>` |

### `task note`

Add a task note. The note text is a positional argument. No `--json`.

| Argument / Option | Purpose |
|---|---|
| `<taskId>` | Task ID (required) |
| `<note>` | Note text (required) |
| `--id <id>` | Pack ID |

## `input`

List and update pack inputs.

```bash
agent-pack input list --id reviewer-001
agent-pack input get severity --id reviewer-001
agent-pack input set severity high --id reviewer-001
agent-pack input unset severity --id reviewer-001
```

| Subcommand | Argument(s) | Options | Behavior |
|---|---|---|---|
| `input list` | — | `--id <id>`, `--json` | Aligned table of declared inputs with effective values, required flags, types, value sources, descriptions |
| `input get` | `<name>` | `--id <id>`, `--json` | Print one effective value |
| `input set` | `<name> <value>` | `--id <id>`, `--json` | Validate against the stored schema, update the pack, unlock newly-satisfied conditional tasks |
| `input unset` | `<name>` | `--id <id>`, `--json` | Clear optional-without-default; revert-to-default when a default exists; reject required-without-default |

Once a task unlocks, it stays active even if a later input change would no longer
satisfy its condition. For input types, coercion rules, and `when` matching, see
[authoring.md](authoring.md).

## `reference add`

Add a reference to an existing pack.

```bash
agent-pack reference add ./docs/api.md --id reviewer-001
agent-pack reference add product/api --id reviewer-001
agent-pack reference add https://example.com/docs/design.md --id reviewer-001 --json
```

| Argument / Option | Purpose |
|---|---|
| `<ref>` | Catalog, local, URL, or git reference (required) |
| `--id <id>` | Pack ID |
| `--git-refresh <auto\|always\|never>` | Git fetch policy. Default: `AGENT_PACK_GIT_REFRESH`, else `auto` |
| `--json` | Emit `{ references, skipped, summary }` |

The ref accepts the same catalog, local path, URL, and git formats as `init
--reference`. Sources already present in the pack are skipped instead of added
again.

## `skill add`

Add a skill to an existing pack.

```bash
agent-pack skill add ./skills/review/SKILL.md --id reviewer-001
agent-pack skill add engineering/fresh-eyes --id reviewer-001 --git-refresh never
agent-pack skill add ./skills --id reviewer-001 --json
```

| Argument / Option | Purpose |
|---|---|
| `<ref>` | Catalog, local `SKILL.md`, directory, glob, or git skill (required) |
| `--id <id>` | Pack ID |
| `--git-refresh <auto\|always\|never>` | Git fetch policy. Default: `AGENT_PACK_GIT_REFRESH`, else `auto` |
| `--json` | Emit `{ skills, skipped, summary }` |

The ref accepts the same catalog, local `SKILL.md`, directory, glob, and git
formats as `init --skill`. Sources already present in the pack are skipped.

## `status`

Show resolved agent-pack paths and defaults.

```bash
agent-pack status
agent-pack status --json
```

| Option | Purpose |
|---|---|
| `--json` | Emit resolved paths and current defaults |

Inspect resolved directories and defaults such as the config/catalog dir, state
dir, cache dir, current `AGENT_PACK_ID`, and current `AGENT_PACK_CREATE_ID`. See
[configuration.md](configuration.md) for path resolution rules.

## `summary`

Show a concise pack progress summary. Prints text by default.

```bash
agent-pack summary --id reviewer-001
agent-pack summary --id reviewer-001 --json
```

| Option | Purpose |
|---|---|
| `--id <id>` | Pack ID |
| `--json` | Emit a compact pack progress object |

For the summary output spec, see [brief-format.md](brief-format.md).

## `report`

Show full pack state. Prints a human-readable report (task status and notes) by
default.

```bash
agent-pack report --id reviewer-001
agent-pack report --id reviewer-001 --json
```

| Option | Purpose |
|---|---|
| `--id <id>` | Pack ID |
| `--json` | Emit the full saved pack state |

`report` shows all tasks, with locked ones marked. For the report output spec,
see [brief-format.md](brief-format.md).

## `catalog`

List and inspect catalog entries. This section documents the catalog command;
for catalog directory layout, config resolution, and how refs are resolved, see
[configuration.md](configuration.md).

```bash
agent-pack catalog list
agent-pack catalog list --type task
agent-pack catalog list --json
agent-pack catalog show manifest review/code-review
agent-pack catalog path task review/security
```

| Subcommand | Argument(s) | Options | Behavior |
|---|---|---|---|
| `catalog list` | — | `--type <type>`, `--json` | Aligned table with type, catalog name, and absolute path. Creates catalog directories when missing |
| `catalog show` | `<type> <name>` | — | Print a catalog entry file. No `--json` |
| `catalog path` | `<type> <name>` | — | Print a catalog entry path. No `--json` |

The `<type>` enum has five values: `manifest`, `task`, `reference`, `skill`,
`agent`.

## `completion`

Print shell completion setup instructions. No shell startup files are written.
No `--json`.

```bash
agent-pack completion        # detect shell from $SHELL
agent-pack completion bash
agent-pack completion zsh
agent-pack completion fish
```

| Argument | Purpose |
|---|---|
| `[shell]` | Shell to configure: `bash`, `zsh`, or `fish`. Omit to detect from `$SHELL` |

### `completion script`

Print a shell completion script.

```bash
agent-pack completion script bash
agent-pack completion script zsh
agent-pack completion script fish
```

| Argument | Purpose |
|---|---|
| `<shell>` | Shell script to print: `bash`, `zsh`, or `fish` (required) |

To enable completion only for the current shell:

```bash
source <(agent-pack completion script bash)
source <(agent-pack completion script zsh)
agent-pack completion script fish | source
```

For permanent setup, generate a static completion file once and source it from
shell startup.

For bash:

```bash
mkdir -p ~/.local/share/agent-pack
agent-pack completion script bash > ~/.local/share/agent-pack/completion.bash
printf '\nsource ~/.local/share/agent-pack/completion.bash\n' >> ~/.bashrc
```

For zsh:

```bash
mkdir -p ~/.local/share/agent-pack
agent-pack completion script zsh > ~/.local/share/agent-pack/completion.zsh
printf '\nsource ~/.local/share/agent-pack/completion.zsh\n' >> ~/.zshrc
```

For fish:

```fish
mkdir -p ~/.config/fish/completions
agent-pack completion script fish > ~/.config/fish/completions/agent-pack.fish
```

Regenerate the completion file after upgrading `agent-pack`. Completions suggest
command names, subcommands, option names, known enum values (such as
`--git-refresh auto|always|never` and `catalog list --type
manifest|task|reference|skill|agent`), shell names for `completion`, catalog
names for catalog-backed refs, input names for `input get|set|unset`, enum and
boolean values for `input set`, plus `catalog show|path` names. When no app-known
positional value exists, completion suggests options for the active command;
explicit filesystem path prefixes such as `/`, `./`, `../`, `~`, and `~/` return
no catalog candidates.

## JSON output shapes

| Command | JSON shape |
|---|---|
| `init --json` | `{ id, briefCommand, pack }` |
| `run --json` | `{ pack, runs, outcome }` |
| `sync --id <id> --json` | Pack state object |
| `clean --json` | `{ packIds, repoHashes, removed }` |
| `list --json` | Array of status objects with `createdAt` and `updatedAt` |
| `status --json` | Resolved paths and current defaults |
| `summary --json` | `{ id, name, status, createdAt, updatedAt, tasks, references, skills, agents }` |
| `report --json` | Full pack state object |
| `task add <title> --json` | `{ task, summary }` |
| `task show <task-id> --json` | Task state object |
| `input list --json` | Array of input entries |
| `input get <name> --json` | One input entry |
| `input set <name> <value> --json` | `{ input, unlocked, summary }` |
| `input unset <name> --json` | `{ input, unlocked, summary }` |
| `reference add <ref> --json` | `{ references, skipped, summary }` |
| `skill add <ref> --json` | `{ skills, skipped, summary }` |
| `catalog list --json` | Array of `{ type, name, path }` entries |

## Derived pack statuses

| Status | Meaning |
|---|---|
| `no_tasks` | Pack has context but no tasks |
| `pending` | Pack has tasks and no work has started |
| `in_progress` | At least one task has started or completed |
| `blocked` | One or more incomplete tasks are blocked |
| `completed` | All tasks are completed |

## Exit codes

`agent-pack` exits `0` on success and `1` for user-visible errors
(`AgentPackError`: validation failures, missing packs, missing files, git
failures), printed to stderr as `agent-pack: <message>`.

`run` exit codes are richer:

| Outcome | Exit code |
|---|---|
| Captured run completes, outcome not `exhausted` | `0` |
| Captured run fails | `1` |
| Outcome `exhausted` (even if the last process exited `0`) | `1` |
| Interactive run | The child agent's exit code (e.g. `2`, `130`), or `128 + signal` when terminated by a signal |

## Mutual-exclusion errors

| Combination | Error message |
|---|---|
| `run --id` with create/compose options | `--id cannot be combined with create-and-run options` |
| `run --interactive` with `--json` | `--interactive cannot be combined with --json` |
| `task list --all` with `--locked` | `pass only one of --all or --locked` |

## See also

- [concepts.md](concepts.md) — concepts and how packs work
- [authoring.md](authoring.md) — manifest, task, and agent file schemas; inputs and conditional tasks
- [configuration.md](configuration.md) — paths, environment variables, git sources, catalog, state
- [brief-format.md](brief-format.md) — brief, summary, and report output spec
- [../README.md](../README.md) — project overview and quick start
