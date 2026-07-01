# agent-pack Usage

Compact reference. See the project [README](../README.md) for the full tour and [docs/](README.md) for complete reference.

Run commands from the repository or workspace that contains the files you want the agent to inspect.

## Requirements

- Node.js 20 or newer (a packaging requirement; the CLI does not verify the Node version)
- Git and `tar` on `PATH` for git-backed inputs
- Bun when manually building or packaging a standalone executable with
  `npm run build:bun` or `npm run package:bun`

## Quick start

Create a pack from the included demo manifest:

```bash
EXAMPLES_DIR="$(agent-pack --help | sed -n 's/^[[:space:]]*Examples[[:space:]][[:space:]]*//p')"

agent-pack init \
  --manifest "$EXAMPLES_DIR/manifests/demo.yaml" \
  "Run the demo task and record the result."
```

On a standalone executable copied by itself, the `EXAMPLES_DIR` trick yields an
empty value because compiled-Bun help only prints adjacent packaged resources.
Use a packaged standalone archive or a real checkout, for example
`./examples/manifests/demo.yaml`.

Set the generated pack id, then read the brief:

```bash
export AGENT_PACK_ID=<generated-id>
agent-pack brief
```

`init` uses `--create-id` when provided, then `AGENT_PACK_CREATE_ID` when set, and otherwise generates an id from the pack name plus a short random suffix. `--id` and `AGENT_PACK_ID` target existing packs.

## Most-used commands

`--json` is not universal. The table below marks each command. For the full availability matrix, JSON shapes, every flag, and exit codes, see [cli.md](cli.md).

| Command | What it does | `--json` |
|---|---|---|
| `agent-pack init [prompt]` | Create a pack from manifests, tasks, references, skills, and agents | yes |
| `agent-pack run [prompt]` | Run one configured agent against a pack (captured or `--interactive`) | yes |
| `agent-pack brief` | Print the agent-facing brief (active tasks only) | no |
| `agent-pack list` | List packs in the current state directory | yes |
| `agent-pack status` | Show resolved paths and defaults | yes |
| `agent-pack summary` | Show a concise pack progress summary | yes |
| `agent-pack report` | Show full pack state (all tasks, locked ones marked) | yes |
| `agent-pack task add <title>` | Add an ad hoc task | yes |
| `agent-pack task list` | List tasks (active by default; `--all` or `--locked`) | no |
| `agent-pack task show <id>` | Show one task's detail | yes |
| `agent-pack task start <id>` | Mark a task `in_progress` | no |
| `agent-pack task done <id>` | Mark a task `completed` | no |
| `agent-pack task block <id>` | Mark a task `blocked` | no |
| `agent-pack task note <id> <note>` | Add a note to a task | no |
| `agent-pack input list` | List declared inputs and effective values | yes |
| `agent-pack input get <name>` | Print one input value | yes |
| `agent-pack input set <name> <value>` | Set an input; unlock newly-satisfied tasks | yes |
| `agent-pack input unset <name>` | Clear or revert an input | yes |
| `agent-pack reference add <ref>` | Add a reference to an existing pack | yes |
| `agent-pack skill add <ref>` | Add a skill to an existing pack | yes |
| `agent-pack sync` | Fetch missing git cache material for a pack | yes |
| `agent-pack clean` | Remove rebuildable git cache material | yes |
| `agent-pack catalog list` | List catalog entries | yes |
| `agent-pack catalog show <type> <name>` | Print a catalog entry file | no |
| `agent-pack catalog path <type> <name>` | Print a catalog entry path | no |
| `agent-pack completion [shell]` | Print shell completion setup instructions | no |

A typical agent loop:

```bash
agent-pack task show t001
agent-pack task start t001
agent-pack task note t001 "date output: Thu May 7 ..."
agent-pack task done t001 --note "Recorded date output."
agent-pack summary
agent-pack report
```

For long task lists, render a compact brief that shows task status, ID, and title without task bodies:

```bash
AGENT_PACK_BRIEF_TASK_CONTENT=false agent-pack brief
```

The compact brief tells the agent to run `agent-pack task show <task-id>` before working a task.

## Source types, catalog, completion, git, and state

These topics each have one canonical home:

- Composition flags (`--manifest`, `--task`, `--reference`, `--skill`, `--agent`, `--input`, `--instructions`), every command, all flags, JSON shapes, derived statuses, exit codes, and mutual-exclusion errors: [cli.md](cli.md).
- Manifest, task, and agent file schema, inputs, coercion, and the `when` grammar for conditional tasks: [authoring.md](authoring.md).
- Paths, environment variables, git source syntax, the `--git-refresh` policy, the catalog layout, the event log, and state portability: [configuration.md](configuration.md).
- Brief, summary, and report output specification (the agent contract): [brief-format.md](brief-format.md).
- Concepts and how packs fit together: [concepts.md](concepts.md).

## Shipped examples

The npm package includes an `examples/` directory with reusable files for common workflows. Run `agent-pack --help` to see the installed examples path. It ships:

- 12 manifests under `examples/manifests/`, including `demo`, `code-review`, `docs-review`, `design-review`, `feature-design-summary`, `architecture-review`, `bug-investigation`, `codebase-onboarding`, `dependency-audit`, `refactor-execution`, `security-review`, and `testing-audit`.
- 4 agent files under `examples/agents/`: `claude.yaml`, `claude-exec.yaml`, `codex.yaml`, `codex-exec.yaml`.
- 2 task files under `examples/tasks/`: `findings-synthesis.yaml`, `review-gate.yaml`.
- 1 skill under `skills/agent-pack/`: an explicit-invocation skill for agents
  that need to run catalog packs, follow briefs, and work through tasks.

Create a code-review pack:

```bash
agent-pack init \
  --manifest ./examples/manifests/code-review.yaml \
  "Review scope: unstaged changes."

export AGENT_PACK_ID=<generated-id>
agent-pack brief
```

Create a documentation-review pack:

```bash
agent-pack init \
  --manifest ./examples/manifests/docs-review.yaml \
  "Review the repository documentation against the current code."
```

Create a design-review pack. The design-review manifest reviews a design document against the repository's actual code, docs, tests, and conventions. Name the design path in the prompt, or pass `--input design_path=<path>` to capture the target path as a pack input:

```bash
agent-pack init \
  --manifest ./examples/manifests/design-review.yaml \
  --input design_path=path/to/design-doc.md \
  "Review the design document against the repository."
```

Create a feature design-summary pack. This manifest creates a feature branch from `main` by default; pass `--input create_branch=false` to plan in the existing tree, and optionally pass `--input slug=<slug>` when the agent should use a specific slug for branch and design artifact names:

```bash
agent-pack init \
  --manifest ./examples/manifests/feature-design-summary.yaml \
  --input create_branch=false \
  --input slug=import-dry-run \
  "Design summary for: add a dry-run flag to the import command."
```

Use the generated id printed by `init`, or pass `--create-id <id>` for a deterministic pack id. Setting `AGENT_PACK_CREATE_ID` before `init` also provides the pack id for that new pack.

### Examples as a catalog

The `examples/` directory is already laid out as a catalog root. Point `AGENT_PACK_CONFIG_DIR` at it to use the packaged examples by bare catalog name:

```bash
EXAMPLES_DIR="$(agent-pack --help | sed -n 's/^[[:space:]]*Examples[[:space:]][[:space:]]*//p')"
AGENT_PACK_CONFIG_DIR="$EXAMPLES_DIR" agent-pack init --manifest code-review "Review scope: unstaged changes."
```

On a standalone Bun executable copied by itself the help examples path is empty.
Use a packaged standalone archive, point `AGENT_PACK_CONFIG_DIR` at a real
`examples/` checkout, or use another catalog directory instead. See
[configuration.md](configuration.md) for the catalog layout.

Example agent model names (such as `claude-opus-4-7` or `gpt-5.5`) and backend flags (such as `--effort`) shown in the shipped agent files are illustrative only; the parser does not validate them. Backend-specific flags (model, effort, and so on) go in an agent's `args`. See [authoring.md](authoring.md) for the agent file schema.

## See also

- [cli.md](cli.md) — command and flag reference, JSON shapes, exit codes
- [authoring.md](authoring.md) — manifest, task, and agent schema; inputs and conditional tasks
- [configuration.md](configuration.md) — paths, environment variables, git sources, catalog, state
- [brief-format.md](brief-format.md) — brief, summary, and report output spec
- [concepts.md](concepts.md) — concepts and how packs work
- [README.md](../README.md) — project overview and full quick start
