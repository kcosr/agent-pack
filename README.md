# agent-pack

`agent-pack` prepares durable work packets for coding agents.

A pack can contain tasks, reference material, supplemental skills, instructions, and a one-off prompt. The agent reads the generated brief, works through the tasks, and records progress back into pack state with explicit commands.

The result is a repeatable handoff workflow:

```bash
agent-pack init \
  --id design-review \
  --name "Design review" \
  --manifest ./pack.yaml \
  --references ./docs/design.md \
  --skills ./skills/fresh-eyes/SKILL.md \
  "Review the design and record concrete findings."

agent-pack brief --id design-review
```

Then tell an agent:

```text
Run agent-pack brief --id design-review and work the pack.
```

## Why Use It

Agents work better when the handoff is explicit. `agent-pack` gives the user and agent a shared state file, a stable brief, and simple progress commands.

Use it when you want to:

- hand an agent a structured set of tasks
- include specific docs, directories, globs, or git-hosted references
- provide supplemental `SKILL.md` files with extracted descriptions
- keep task progress, notes, blockers, and completion evidence in one place
- resume work later from committed state
- avoid relying on a long chat thread as the only source of truth

`agent-pack` does not run the agent. It prepares the work and tracks progress. You run your agent CLI separately and tell it to read the pack brief.

## Installation

`agent-pack` is distributed as a Node CLI.

```bash
npm install -g agent-pack
agent-pack --help
```

Requirements:

- Node.js
- Git on `PATH` for git-backed references and skills
- normal git credentials configured for private repositories

## Core Concepts

### Pack

A pack is the durable unit of work. It has an ID, optional display name, prompt, instructions, tasks, references, skills, provenance, status, and event history.

Pack state is stored in:

```text
.agent-pack/state/
```

Git-backed source material is cached in:

```text
.agent-pack/cache/
```

Commit `.agent-pack/state` when you want the pack to move with the repository. Ignore `.agent-pack/cache`, `locks`, and `tmp`.

```gitignore
.agent-pack/cache/
.agent-pack/locks/
.agent-pack/tmp/
```

### Prompt

The optional positional prompt is a one-off instruction for this pack instance:

```bash
agent-pack init --id worker-123 "Focus first on the cache behavior."
```

It is rendered at the top of the brief. Prompts are not tasks, references, or reusable manifest content.

### Instructions

Instructions are durable guidance loaded from a manifest or an instructions file. They are rendered after the prompt and before the tasks.

Use instructions for reusable workflow guidance such as review standards, evidence requirements, or completion expectations.

### Tasks

Tasks are mutable work items. Agents update task state as they work:

```bash
agent-pack start t001 --id worker-123
agent-pack note t001 --id worker-123 "Read docs/design.md sections on sync."
agent-pack done t001 --id worker-123 --note "Documented findings in the task notes."
agent-pack block t002 --id worker-123 --note "Need a decision on git refresh behavior."
```

### References

References are read-only context. They can be local files, local directories, globs, git paths, or whole git repo snapshots.

Examples:

```text
./docs/design.md
../some-dir
./docs/**/*.md
git+https://github.com/org/repo.git//docs/reference.md#main
git+https://github.com/org/repo.git//docs/**/*.md#v1.2.0
git+https://github.com/org/repo.git#main
git+git@github.com:org/repo.git//docs/reference.md#main
```

Directory and whole-repo references stay as one logical reference in the brief. Glob references list the matched files.

### Skills

Skills are supplemental `SKILL.md` files. `agent-pack` extracts the skill name, description, and readable path so the brief can tell the agent when a skill may be relevant.

Only files named exactly `SKILL.md` are accepted as skills:

```bash
agent-pack init --skills './skills/**'
```

That command scans broadly but only includes matching `SKILL.md` files.

## Quick Start

Create a small task manifest:

```yaml
# pack.yaml
schemaVersion: 1
name: design-review
instructions: |
  Review the included material before starting tasks.
  Record concrete evidence in task notes.

tasks:
  - id: inspect
    title: Inspect the design
    body: Read the design and identify gaps, contradictions, or missing decisions.
    doneWhen:
      - Notes list the sections reviewed.
      - Any findings include file paths or command output.

references:
  - name: current design
    description: Product design for agent-pack.
    ref: ./docs/design.md

skills:
  - ref: ./skills/fresh-eyes/SKILL.md
```

Initialize a pack:

```bash
agent-pack init \
  --id design-review \
  --manifest ./pack.yaml \
  "Review the current design and complete each task."
```

Show the brief:

```bash
agent-pack brief --id design-review
```

Tell the agent:

```text
Run agent-pack brief --id design-review and work the pack. Update task status as you go.
```

Check progress:

```bash
agent-pack status --id design-review
agent-pack report --id design-review
```

## Command Reference

### `init`

Create a pack.

```bash
agent-pack init [options] [prompt]
```

Common options:

| Option | Purpose |
|---|---|
| `--id <id>` | Use a specific pack ID |
| `--name <name>` | Set a display name |
| `--manifest <path>` | Load a pack manifest YAML file; repeatable |
| `--instructions <path>` | Load instructions from Markdown or YAML |
| `--task <text>` | Add one ad hoc task |
| `--tasks <ref>` | Add task YAML file or glob |
| `--reference <ref>` | Add one reference |
| `--references <ref>` | Add a reference file, directory, glob, or repo |
| `--skill <ref>` | Add one `SKILL.md` file |
| `--skills <ref>` | Add skill file or glob |
| `--git-refresh auto\|always\|never` | Control git fetching for this command |
| `--state-dir <path>` | Override the state directory |
| `--json` | Emit machine-readable output |
| `--strict` | Reject ambiguous or unsupported metadata |

Example:

```bash
agent-pack init \
  --id reviewer-001 \
  --manifest ./base-pack.yaml \
  --tasks ./tasks/*.yaml \
  --references './docs/**/*.md' \
  --skills './skills/**' \
  "Use the included docs and skills to complete the review."
```

### `brief`

Print the agent-facing brief.

```bash
agent-pack brief --id reviewer-001
```

The brief includes the prompt, instructions, task list, references, skills, and progress commands.

### `sync`

Hydrate missing git cache material for a pack.

```bash
agent-pack sync --id reviewer-001
agent-pack sync --all --git-refresh always
```

`sync` is explicit. Other commands do not fetch or clone git sources. If a pack is resumed on a new host, run `sync` before `brief`:

```text
Continue work on reviewer-001. Run agent-pack sync --id reviewer-001, then agent-pack brief --id reviewer-001 and proceed.
```

`--git-refresh` applies only to `init` and `sync`:

| Value | Meaning |
|---|---|
| `auto` | Fetch if the mirror is missing or stale by normal policy |
| `always` | Fetch before resolving refs or exporting snapshots |
| `never` | Do not fetch; use existing cache material and fail if missing |

### Task Commands

```bash
agent-pack list --id reviewer-001
agent-pack show t001 --id reviewer-001
agent-pack start t001 --id reviewer-001
agent-pack note t001 --id reviewer-001 "Read the design."
agent-pack done t001 --id reviewer-001 --note "Completed with evidence in notes."
agent-pack block t002 --id reviewer-001 --note "Need user decision."
```

### Status and Reports

```bash
agent-pack status --id reviewer-001
agent-pack status --all
agent-pack status --id reviewer-001 --json
agent-pack report --id reviewer-001
agent-pack report --id reviewer-001 --json
agent-pack summary --id reviewer-001
```

Derived pack statuses:

| Status | Meaning |
|---|---|
| `no_tasks` | Pack has context but no tasks |
| `pending` | Pack has tasks and no work has started |
| `in_progress` | At least one task has started or completed |
| `blocked` | One or more incomplete tasks are blocked |
| `completed` | All tasks are completed |

## Manifests

Manifests are YAML files that define reusable pack content.

```yaml
schemaVersion: 1
name: implementation-review
instructions: |
  Review references before starting tasks.
  Update task notes with concrete evidence.

tasks:
  - id: inspect
    title: Inspect implementation
    category: review
    body: Check the implementation against the included design.
    doneWhen:
      - Notes identify files inspected.
      - Findings are recorded or the task says no issues found.

references:
  - name: design
    description: Initial product design.
    ref: ./docs/design.md

  - name: upstream examples
    description: Related docs from an external repository.
    ref: git+https://github.com/org/repo.git//docs/**/*.md#main

skills:
  - ref: ./skills/fresh-eyes/SKILL.md
```

CLI flags and manifests can be combined. Merge order is deterministic:

1. manifests in flag order
2. `--tasks` in flag order
3. `--references` in flag order
4. `--skills` in flag order
5. `--task` ad hoc entries in flag order
6. positional prompt

## Git Sources

Git source syntax:

```text
git+<repo-url>//<path-inside-repo>#<ref>
git+<repo-url>#<ref>
```

The `#<ref>` suffix is optional. If omitted, `agent-pack` uses the remote default branch, resolves it to a commit, and records the resolved commit in provenance.

Supported URL forms:

```text
git+https://github.com/org/repo.git//docs/design.md#main
git+http://git.example.com/org/repo.git//docs/design.md#main
git+ssh://git@github.com/org/repo.git//docs/design.md#main
git+git@github.com:org/repo.git//docs/design.md#main
```

Authentication is delegated to normal `git` behavior: SSH agent, credential helper, netrc, platform keychain, or configured askpass.

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `AGENT_PACK_ID` | Default pack target | unset |
| `AGENT_PACK_STATE_DIR` | Pack state directory | `<repo>/.agent-pack/state` |
| `AGENT_PACK_CACHE_DIR` | Cache root | `<repo>/.agent-pack/cache` |
| `AGENT_PACK_GIT_CACHE_DIR` | Git mirror cache root | `$AGENT_PACK_CACHE_DIR/git` |
| `AGENT_PACK_GIT_REFRESH` | Default git fetch policy for `init` and `sync` | `auto` |
| `AGENT_PACK_CMD` | Command name rendered in briefs | `agent-pack` |

Set a default pack ID when working on one pack for a while:

```bash
export AGENT_PACK_ID=reviewer-001

agent-pack brief
agent-pack status
agent-pack done t001 --note "Completed."
```

## State and Portability

Default layout:

```text
.agent-pack/
  state/
    index.json
    packs/
      reviewer-001.json
    events/
      reviewer-001.jsonl
  cache/
    git/
    snapshots/
  locks/
  tmp/
```

Commit state when you want to resume from another checkout:

```bash
git add .agent-pack/state
git commit -m "Add agent pack state"
```

On the new host:

```bash
agent-pack sync --id reviewer-001
agent-pack brief --id reviewer-001
```

Local paths are intentionally live. If a local reference or skill changes after pack creation, the agent reads the current file at that path. Git references resolve to a commit and read from exported snapshots.

## Detailed Design

See [docs/design.md](docs/design.md) for the detailed state shape, repository layout, and test strategy.
