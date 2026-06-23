# Concepts & How It Works

This page is the mental model for `agent-pack`. It explains what a pack is, the pieces that make one up, how the brief is assembled, and what happens when you run an agent against a pack. For exact command flags see [cli.md](cli.md); for manifest, task, and agent schema see [authoring.md](authoring.md); for paths, environment variables, and git sources see [configuration.md](configuration.md); for the exact brief, summary, and report output see [brief-format.md](brief-format.md).

## Passive vs active workflows

`agent-pack` pre-packs context for coding agents: references to read, supplemental skills to apply, instructions to follow, agent launch profiles to use, and executable task lists that keep the work on track.

`agent-pack` can be used passively or actively.

- In **passive** workflows, `agent-pack` prepares the work, renders the agent-facing brief, and records task progress while you run your agent CLI separately. You drive the agent; `agent-pack` is the shared notebook for context and progress.
- In **active** workflows, `agent-pack run` starts one configured agent subprocess. Captured runs store stdout and print the final pack report; interactive runs inherit your terminal and record exit metadata only.

The same pack supports both modes. Active runs are a convenience wrapper around the passive pieces: the spawned agent is told to run `agent-pack brief` and follow it, exactly as you would by hand.

## Pack

A pack is the durable unit of work. A pack stores a prompt, instructions, inputs, tasks, references, skills, agents, optional contract rules, task status, notes, and agent run records. Alongside the pack file, `agent-pack` writes an append-only event log for state changes.

Pack state is stored under a state directory (by default `.agent-pack/state/` in the current working directory). Commit it when you want a pack to travel with the repo so another checkout, host, or agent can resume it. Git-backed source material is cached separately and can always be rebuilt with `agent-pack sync`. For state vs cache locations, what to commit, and how to relocate either, see [configuration.md](configuration.md).

The append-only event log records every state change — pack creation, task additions, each task status change and note, input set/unset, reference and skill additions, and agent runs. For the exact event-type names and the JSONL format, see [configuration.md](configuration.md).

## Brief

The brief is the text document rendered by `agent-pack brief`. It is meant to be pasted into an agent or read by an agent from the shell. `agent-pack` lists reference paths in the brief; it does not paste referenced file contents into the brief.

The brief shows **active tasks only** — locked conditional tasks are omitted until their conditions are satisfied. (The report, by contrast, shows all tasks with locked ones marked.) The brief renders sections in a fixed order, with the Inputs section appearing first whenever the pack declares a non-empty input schema. For the exact section order, the per-section layout, and the summary and report formats, see [brief-format.md](brief-format.md).

By default, task entries include the task body and `doneWhen` checklist. For very large task lists, set `AGENT_PACK_BRIEF_TASK_CONTENT=false` when rendering the brief to show only task status, ID, and title; the brief then tells the agent to run `agent-pack task show <task-id>` before working a task.

## Manifest

A manifest is a reusable YAML file that can contribute inputs, instructions, tasks, references, skills, agents, and contract rules to a pack. Manifest parsing is strict: unknown fields fail fast instead of being ignored.

Manifests are the reusable, version-controllable definition; a pack is a concrete instance created from one or more manifests plus any one-off options. For the full manifest field schema and a complete example, see [authoring.md](authoring.md).

## Prompt

The optional positional prompt is a one-off instruction for this pack instance:

```bash
agent-pack init --create-id worker-123 "Focus first on the cache behavior."
```

It is rendered near the top of the brief. Prompts are not tasks, references, or reusable manifest content.

## Instructions

Instructions are durable guidance loaded from a manifest or a raw instructions file. They are rendered after the prompt and before the tasks.

Use instructions for reusable workflow guidance such as review standards, evidence requirements, or completion expectations.

## Inputs

Inputs are first-class, caller-provided context for a pack. They are declared in a manifest `inputs` map, resolved when the pack is created, rendered first in the brief, and used to drive conditional task activation.

Each input has a type: `string` (the default), `enum`, `boolean`, or `number`.

- `string` values are passed through. A required string must not be empty.
- `enum` requires a non-empty `values` list, and a supplied value must be one of those values.
- `boolean` accepts real booleans, the strings `true` / `1` (true) and `false` / `0` (false), and rejects anything else.
- `number` is coerced from its value and must be finite.

Inputs are resolved at init from CLI assignments first, then declared defaults, and a required input with no value and no default is an error. After init, `input set` and `input unset` change values:

- `input set` coerces and stores a value, then unlocks any tasks whose conditions are now satisfied.
- `input unset` clears an input that is optional and has no default, reverts to the default when one exists, and rejects an attempt to unset a required input that has no default.

Tasks never relock: once a task is unlocked it stays active even if its input later changes. For the input declaration schema and CLI surface, see [authoring.md](authoring.md) and [cli.md](cli.md).

### Conditional tasks

A task may carry a `when` clause that ties its activation to inputs. Tasks without a `when` are always active. A task with a `when` starts active only if its condition matches the resolved inputs; otherwise it is `locked` and hidden from the brief until satisfied.

`when` matching works as follows:

- A bare input name (string), or a `null`/omitted condition value for an input, means the named input simply exists and is non-empty.
- A scalar condition value means equality, and the comparison is strict (`===`), so the boolean `true` does not match the string `"true"`.
- An `{ in: [...] }` condition means the input value is a member of the list.
- When the `when` is a map with multiple entries, all of them must match (they are ANDed).

This lets one manifest carry tasks that only become relevant for particular input combinations, kept out of the agent's way until they apply.

## Tasks

Tasks are mutable work items. Each task gets an auto-generated runtime ID (`t001`, `t002`, ...). If a manifest task has its own `id`, that value is preserved as `sourceId` for traceability, but task commands use the runtime ID shown by `agent-pack task list`.

Agents update task state as they work:

```bash
export AGENT_PACK_ID=quickstart
agent-pack task list
agent-pack task start t001
agent-pack task note t001 "Read README.md."
agent-pack task done t001 --note "Recorded findings in task notes."
```

A task moves through `pending`, `in_progress`, `completed`, and `blocked`. A blocked task is an intentional halt: it signals that the work cannot proceed and, during active runs, stops further retries.

## References

References are named pointers to read-only context the agent should inspect. They can be local files, local directories, globs, HTTP/HTTPS URLs, git paths, or whole git repo snapshots.

Directory and whole-repo references stay as one logical reference in the brief. Glob references list the matched files. Globs match files, include dotfiles, and do not follow symlinks. For the full set of accepted reference forms (including the git URL syntax) and how git sources are cached and refreshed, see [configuration.md](configuration.md).

## Skills

Skills are supplemental `SKILL.md` files. `agent-pack` extracts the skill name, description, and readable path so the brief can tell the agent when a skill may be relevant. Only files named exactly `SKILL.md` are accepted as skills.

A `SKILL.md` may include YAML frontmatter with `name` and `description` fields. Other frontmatter fields are ignored. Without frontmatter, the name falls back to the first `#` heading and then the parent directory name; the description falls back to the first paragraph, capped at 300 characters.

If multiple skills resolve to the same name, `agent-pack` appends `(2)`, `(3)`, and so on in the brief. Use distinct `name` values for predictable labels.

```markdown
---
name: fresh-eyes
description: Re-read changed code and look for obvious defects.
---

# Fresh Eyes

Review the changed files again before finalizing.
```

## Agents

Agents are named subprocess launch profiles used by `agent-pack run`. They are optional: packs can still be used passively with `agent-pack brief`, the task commands, and the report commands.

Agent names must be unique within a pack because `--run-agent <name>` selects one stored launch profile. Agent args are user-controlled; `agent-pack` only expands `{prompt}`, spawns the command, and records the run.

```yaml
name: claude
command: claude
args: ["--print", "{prompt}"]
```

Backend-specific flags such as model or effort belong in `args`; `agent-pack` does not validate them. (Names like `claude-opus-4-7`, `gpt-5.5`, or flags like `--effort` shown in examples are illustrative only.) For the full agent schema, see [authoring.md](authoring.md).

## Contract

A contract is manifest-only guidance rendered in the brief for the agent to follow. It has `do` and `dont` string lists. If multiple manifests contribute contracts, entries are concatenated in source order.

## Run lifecycle

`agent-pack run` either targets an existing pack or creates one and runs it in a single step.

- With `--id`, `run` loads an existing pack and runs an agent against it. `--id` cannot be combined with create-and-run options.
- Without `--id`, `run` accepts the same create-and-compose options as `init` (manifests, inputs, references, skills, agents, a prompt), builds a new pack, commits it, and then runs it.

### Captured vs interactive runs

By default, `run` captures the subprocess stdout, stores it in the pack's `agentRuns`, and prints the final `agent-pack report` output. Backend stderr is not streamed, stored, or rendered. With `--json`, `run` prints `{ pack, runs, outcome }`.

For an interactive backend session, pass `--interactive` with an agent definition whose args start the backend in interactive mode. Interactive runs inherit stdin, stdout, and stderr from the current terminal. They do not capture output, do not apply `timeoutSec`, do not retry with `maxAttempts`, and do not support `--json` (`--interactive` cannot be combined with `--json`). They still append an `agentRuns` entry with mode, status, exit code, signal, and timestamps.

### Outcomes

Each run produces one of four outcomes:

- **completed** — the agent finished and the pack is done (all active tasks completed, or the pack has no tasks).
- **blocked** — the agent marked an active task `blocked`. This is treated as an intentional halt and stops retries.
- **failed** — a captured attempt did not succeed (non-zero exit, signal, or timeout) and no further attempts remain.
- **exhausted** — attempts ran out with work still pending: the last process may even have exited `0`, but the pack was not finished.

### Retries

`maxAttempts` defaults to `1` and applies to captured runs only. When a captured attempt fails, times out, or exits with active tasks still pending or in progress, `run` retries until the selected agent reaches `maxAttempts`. Each attempt is recorded as its own `agentRuns` entry, and each retry receives a reminder prompt listing the remaining tasks. Retries stop as soon as all active tasks are completed or any active task is marked `blocked`.

`maxAttempts` greater than `1` has two hard requirements: it cannot be combined with `--interactive` ("interactive agents cannot use maxAttempts greater than 1"), and the agent's `args` must include `{prompt}` so retry attempts can receive the reminder.

### Exit codes

`agent-pack` exits `0` on success and `1` for a user-visible error (validation failures, a missing pack or file, git failures), printed to stderr. For `run` specifically:

- A captured run that fails returns `1`.
- The `exhausted` outcome returns `1` even when the last process exited `0`.
- An **interactive** run passes through the child agent's exit code (for example `2` or `130`), or `128 + signal` when the child was terminated by a signal.

For the full per-command exit-code and `--json` behavior, see [cli.md](cli.md).

## Agent execution model / contract

An agent is a single executable (its `command`) plus an `args` array. `agent-pack` spawns the command **directly, without a shell**: there is no `&&`, no pipes, no quoting, globbing, or redirection, and no working-directory override — the agent runs in the current directory.

`{prompt}` is the only supported template placeholder in `args`. It expands to a generated instruction telling the subprocess to run `agent-pack brief` and follow it. For existing packs, a positional follow-up message is folded into that generated prompt and recorded on the `agentRuns` entry; agents must include `{prompt}` in `args` to receive a follow-up message.

The child process always receives `AGENT_PACK_ID`, and `AGENT_PACK_STATE_DIR` when a state directory is set, so the brief and follow-up task commands can target the pack without explicit `--id` arguments.

In captured mode, `agent-pack` stores the subprocess stdout in `agentRuns` and prints the report; stderr is never streamed or stored, and `timeoutSec` applies only to captured runs. In interactive mode the child owns the terminal and only run metadata is recorded.

This is the contract the agent operates under: read the brief, work the active tasks, record progress and evidence with the task commands, and either complete the pack or mark a task blocked when it cannot proceed.

## See also

- [brief-format.md](brief-format.md) — exact brief, summary, and report output (the agent contract)
- [authoring.md](authoring.md) — manifest, task, and agent schema, inputs, and conditional tasks
- [cli.md](cli.md) — every command, flag, exit code, and `--json` support
- [configuration.md](configuration.md) — paths, environment variables, git sources, catalog, and portability
- [README.md](../README.md) — landing page, install, and quick start
