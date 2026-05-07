# agent-pack

`agent-pack` prepares durable work packets for coding agents.

A pack can contain tasks, reference material, supplemental skills, instructions, and a one-off prompt. The agent reads the generated brief, works through the tasks, and records progress back into pack state with explicit commands.

The result is a repeatable handoff workflow:

```bash
agent-pack init \
  --id design-review \
  --name "Design review" \
  --manifest ./pack.yaml \
  --reference ./docs/design.md \
  --skill ./skills/fresh-eyes/SKILL.md \
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

By default, pack state is stored in the repository working tree:

```text
.agent-pack/state/
```

That state contains pack definitions, task status, notes, and event history. Commit it when you want a pack to travel with the repo so another checkout, host, or agent can resume it.

Git-backed source material is cached separately:

```text
.agent-pack/cache/
```

The cache can always be rebuilt with `agent-pack sync`. Keep cache, locks, and temp files out of git:

```gitignore
.agent-pack/cache/
.agent-pack/locks/
.agent-pack/tmp/
```

If you do not want pack instances committed to the repo, either ignore all of `.agent-pack/` or point state and cache at an external directory:

```gitignore
.agent-pack/
```

```bash
export AGENT_PACK_STATE_DIR="$HOME/.local/state/agent-pack/my-repo"
export AGENT_PACK_CACHE_DIR="$HOME/.cache/agent-pack/my-repo"
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

contract:
  do:
    - Run relevant tests before marking tasks done.
    - Record concrete evidence in task notes.
  dont:
    - Leave required task state updates until the end.
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
| `--id <id>` | Use a specific pack ID (`A-Z`, `a-z`, `0-9`, `.`, `_`, `-`) |
| `--name <name>` | Set a display name |
| `--manifest <ref>` | Load one manifest YAML file or git ref |
| `--manifests <ref>` | Alias for `--manifest`; useful when passing several manifests |
| `--instructions <path>` | Load instructions from Markdown or YAML |
| `--add-task <text>` | Add one ad hoc task |
| `--task <ref>` | Add one task YAML file, glob, or git ref |
| `--tasks <ref>` | Alias for `--task`; useful when passing several task sources |
| `--reference <ref>` | Add one reference |
| `--references <ref>` | Alias for `--reference`; useful when passing several references |
| `--skill <ref>` | Add one `SKILL.md` file |
| `--skills <ref>` | Alias for `--skill`; useful when passing several skills |
| `--git-refresh auto\|always\|never` | Control git fetching for this command |
| `--state-dir <path>` | Override the state directory |
| `--json` | Emit machine-readable output |

Example:

```bash
agent-pack init \
  --id reviewer-001 \
  --add-task "Check local unstaged changes" \
  --manifest git+https://github.com/org/packs.git//base-pack.yaml#main \
  --task ./tasks/*.yaml \
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

Manifests are YAML files that define reusable pack content. A manifest ref can be a local file or a git file ref:

```bash
agent-pack init --manifest ./pack.yaml
agent-pack init --manifests git+https://github.com/org/packs.git//review.yaml#main
```

Treat remote manifests as trusted inputs. Like local manifests, they can name local reference paths and skills that the agent brief will ask the agent to read.

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

CLI flags and manifests can be combined. Merge order is deterministic and source-order based:

1. `agent-pack init` reads include flags from left to right.
2. Each include contributes content to one or more typed brief sections: instructions, tasks, references, skills, or contract.
3. The final brief still renders one section per type. Inside each section, entries keep the relative order of the sources that contributed them.
4. The positional prompt is stored as the pack-level prompt and rendered at the top of the brief. It is not part of section ordering.

For example, this command places the ad hoc task before manifest tasks, while references and skills still render in their own sections:

```bash
agent-pack init \
  --id ordered-review \
  --add-task "Check local unstaged changes first" \
  --manifest ./pack.yaml \
  --task ./tasks/follow-up.yaml \
  --reference ./notes.md
```

The task section renders the ad hoc task, then tasks from `./pack.yaml`, then tasks from `./tasks/follow-up.yaml`. The reference section renders references from `./pack.yaml` before `./notes.md` because the manifest appeared first among reference-contributing sources.

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

Choose one of two common state policies.

### Commit Pack State

Use this when pack instances are part of the repo workflow and should be resumable by another checkout or agent:

```bash
git add .agent-pack/state
git commit -m "Add agent pack state"
```

On the new host:

```bash
agent-pack sync --id reviewer-001
agent-pack brief --id reviewer-001
```

Recommended `.gitignore`:

```gitignore
.agent-pack/cache/
.agent-pack/locks/
.agent-pack/tmp/
```

### Keep Pack State Local

Use this when pack instances are personal scratch state and should not appear in repo history.

Option 1: ignore the whole default directory:

```gitignore
.agent-pack/
```

Option 2: store state and cache outside the repo:

```bash
export AGENT_PACK_STATE_DIR="$HOME/.local/state/agent-pack/reviewer-001"
export AGENT_PACK_CACHE_DIR="$HOME/.cache/agent-pack/reviewer-001"
```

With external state, set `AGENT_PACK_ID` or pass `--id` so commands target the intended pack:

```bash
export AGENT_PACK_ID=reviewer-001
agent-pack brief
```

Local paths are intentionally live. If a local reference or skill changes after pack creation, the agent reads the current file at that path. Git references resolve to a commit and read from exported snapshots. Git snapshots reject symlinks instead of extracting them into the cache.

## Detailed Design

See [docs/design.md](docs/design.md) for the detailed state shape, repository layout, and test strategy.
