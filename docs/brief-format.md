# Brief, Summary & Report Output

This file is the authoritative spec for what `agent-pack` renders for agents. It is
the single source of truth for the brief's section order and contents, the compact
brief mode, and the `summary`, `report`, and `task show` output.

For the command flags that produce these documents, see [cli.md](./cli.md). For the
`AGENT_PACK_BRIEF_TASK_CONTENT` environment variable, see
[configuration.md](./configuration.md).

## Brief

The brief is the text document rendered by `agent-pack brief`. It is meant to be
pasted into an agent or read by an agent from the shell. `agent-pack` lists
reference paths in the brief; it does not paste referenced file contents into the
brief.

### Section order

When present, the brief renders sections in this exact order. Each section is shown
only when it has content.

| Order | Section | Shown when |
|---:|---|---|
| 1 | Inputs | the pack has a non-empty input schema |
| 2 | Prompt | `prompt` is set |
| 3 | Instructions | `instructions` is set |
| 4 | Contract | `contract.do` or `contract.dont` has entries |
| 5 | Commands | the pack has at least one active task |
| 6 | References | the pack has references |
| 7 | Skills | the pack has skills |
| 8 | Tasks | always (renders `- No tasks in this pack.` when empty) |

The **Inputs** section renders first, before the prompt, whenever the pack declares
inputs. (This resolves the earlier README contradiction, which variously put the
prompt first or listed inputs after the prompt; Inputs is first.)

The brief opens with `You are working from pack <id>.` and, when set, a `Name: <name>`
line, before the first section.

### Tasks: active only

The brief shows **active tasks only**. Locked conditional tasks are omitted until
their `when` conditions are satisfied; see conditional tasks in
[authoring.md](./authoring.md). The `report` command, by contrast, shows all tasks
including locked ones (marked `locked`).

Each active task renders as `- [<status>] <id> - <title>`. By default, task entries
also include the task body and a `Done when:` checklist (from `doneWhen`).

### Inputs section shape

| Column | Source |
|---|---|
| Name | input name |
| Value | resolved value (blank when unset) |
| Required | `yes` / `no` |
| Type | `string` \| `enum` \| `boolean` \| `number` |
| Description | input description (blank when absent) |

The section is introduced with `Treat these inputs as caller-provided context for
this pack.`

### Commands section

When the pack has active tasks, the brief lists the task verbs the agent should use
(`task list`, `task show`, `task start`, `task note`, `task done`, `task block`),
each with `--id <pack-id>` included when the brief was rendered with an explicit id.
It instructs: `Use \`task list\` to see task status and \`task show\` before working
a task.` and shows a heredoc pattern for multi-line notes.

The command name in these lines is `agent-pack` by default, or the value of
`AGENT_PACK_CMD` when invoking through a wrapper.

### Abbreviated example

```text
You are working from pack demo-a1b2c3.
Name: demo

Prompt:
Run the demo task and record evidence.

Commands:
  agent-pack task list
  agent-pack task show <task-id>
  agent-pack task start <task-id>
  agent-pack task note <task-id> "evidence"
  agent-pack task done <task-id> --note "completion evidence"
  agent-pack task block <task-id> --note "blocker"
  ...

Tasks:
- [pending] t001 - Run date and record the output
```

## Compact brief mode

Set `AGENT_PACK_BRIEF_TASK_CONTENT=false` when rendering the brief to produce a
compact task section. This is intended for very large task lists.

```bash
AGENT_PACK_BRIEF_TASK_CONTENT=false agent-pack brief --id reviewer-001
```

Compact briefs omit task bodies and `doneWhen` checklists, but keep task status, ID,
and title. The brief then tells the agent:

> Task content is omitted from this brief. Run `agent-pack task show <task-id>`
> before working a task.

That `task show` line includes `--id <pack-id>` when the brief was rendered with an
explicit id, matching how the Commands section is rendered.

The variable defaults to `true`; an invalid value is a hard error. See
[configuration.md](./configuration.md) for the canonical entry.

## Summary

`agent-pack summary` prints a concise pack progress summary by default. It contains:

| Line | Contents |
|---|---|
| `Pack:` | pack id |
| `Name:` | pack name (only when set) |
| `Status:` | pack status |
| `Tasks:` | `<completed>/<total> completed, <blocked> blocked` |
| `References:` | reference count |
| `Skills:` | skill count |
| `Last updated:` | `updatedAt` timestamp |

When any active task is blocked, a trailing `Blocked:` list of `- <id> - <title>`
follows.

## Report

`agent-pack report` prints a human-readable pack report by default, including task
status and notes. The report begins with the same summary block, then adds:

- **Agent Runs** (when any exist): each run as `- <id> [<status>] <agent>` with
  `Started:`, optional `Attempt:`, `Mode:`, an optional `Message:` block, optional
  `Ended:`, `Exit code:`, `Signal:`, `Timed out:`, and the captured `Output:` (or
  `Output: none`, with `Output truncated: yes` when applicable).
- **Tasks**: **all** tasks, not just active ones. Each renders as
  `- <id> [<activation>] <title>`, where `<activation>` is `locked` for a locked
  task and otherwise the task's status. Locked tasks are therefore visible in the
  report but omitted from the brief. Entries include `Category:`, `Started:`,
  `Completed:`, `Blocked:`, `Unlocked:`, and a `Notes:` list when present.
- **References**: each as `- <id> - <name>` with description, path, root path, and
  files when present.
- **Skills**: each as `- <id> - <name>` with description and path.

## Task show output

`agent-pack task show` renders a single task:

| Line | Shown when |
|---|---|
| `Task:` | always (task id) |
| `Title:` | always |
| `Status:` | always |
| `Category:` | category is set |
| `Started:` | the task was started |
| `Completed:` | the task was completed |
| `Blocked:` | the task was blocked |
| `Body:` | the task has a body |
| `Done when:` | `doneWhen` has entries |
| `Notes:` | always (`- none` when empty) |

## See also

- [cli.md](./cli.md) — the `brief`, `summary`, `report`, and `task show` commands and their flags
- [configuration.md](./configuration.md) — `AGENT_PACK_BRIEF_TASK_CONTENT`, `AGENT_PACK_CMD`, and other environment variables
- [authoring.md](./authoring.md) — inputs, conditional tasks, and the manifest/task schema
- [concepts.md](./concepts.md) — what a brief is and how packs work
- [../README.md](../README.md) — project landing page
