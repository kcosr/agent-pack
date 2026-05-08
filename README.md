# agent-pack

`agent-pack` saves your tasks, references, instructions, and progress to disk, then renders a brief for a coding agent to read. It is for developers using an LLM coding CLI or editor agent who want work to survive beyond one chat thread.

`agent-pack` does not run the agent. It prepares the work, renders the agent-facing brief, and records task progress while you run your agent CLI separately.

A minimal handoff looks like this:

```bash
agent-pack init \
  --id quickstart \
  --add-task "Read the README and identify one concrete improvement." \
  "Get oriented and record evidence in task notes."

agent-pack brief --id quickstart
```

Then paste a handoff like this into your agent CLI:

```text
Run agent-pack brief --id quickstart and work the pack. Update task status as you go.
```

## Why Use It

Without `agent-pack`, the typical handoff is a long prompt or chat thread. Tasks, references, and progress are not separately addressable. With `agent-pack`, the user and agent share a state file, a stable brief, and simple task commands.

Use it when you want to:

- hand an agent a structured set of tasks
- include specific docs, directories, globs, URLs, or git-backed references
- provide supplemental `SKILL.md` files with extracted descriptions
- keep task progress, notes, blockers, and completion evidence in one place
- resume work later from committed state
- avoid relying on a long chat thread as the only source of truth

## Contents

- [Installation](#installation)
- [Core Concepts](#core-concepts)
- [Quick Start](#quick-start)
- [Command Reference](#command-reference)
- [Manifests](#manifests)
- [Git Sources](#git-sources)
- [Environment Variables](#environment-variables)
- [State and Portability](#state-and-portability)
- [More Documentation](#more-documentation)

## Installation

`agent-pack` is distributed as a Node CLI.

```bash
npm install -g @kcosr/agent-pack
agent-pack --help
```

Requirements:

- Node.js 20 or newer. Node.js includes `npm`; use your package manager's equivalent if you prefer `pnpm` or `yarn`.
- Git and `tar` on `PATH` for git-backed references and skills
- Git authentication for private repositories. `agent-pack` shells out to `git`, so SSH agent, credential helper, netrc, platform keychain, GitHub CLI, or configured askpass can work.

`agent-pack` works with any agent CLI or editor agent that can read a text prompt and run shell commands in your workspace. The examples use POSIX shell syntax; on Windows PowerShell, use backticks for line continuations or write commands on one line, and prefer double-quoted globs such as `"./skills/**"`.

## Core Concepts

### Pack

A pack is the durable unit of work. A pack stores a prompt, instructions, tasks, references, skills, an optional contract, task status, and notes. Alongside the pack file, `agent-pack` writes an append-only event log for state changes.

By default, pack state is stored in the repository working tree:

```text
.agent-pack/state/
```

That state contains pack definitions, task status, notes, and event history. Commit it when you want a pack to travel with the repo so another checkout, host, or agent can resume it.

Git-backed source material is cached separately:

```text
$XDG_CACHE_HOME/agent-pack/
```

If `XDG_CACHE_HOME` is unset, the cache defaults to `~/.cache/agent-pack/`. If neither `XDG_CACHE_HOME` nor `HOME` is set, it falls back to `.agent-pack/cache` in the current working directory. The cache can always be rebuilt with `agent-pack sync`; locks also live under this cache root. Use `agent-pack clean` to remove rebuildable git cache material for the current state directory.

If you explicitly point `AGENT_PACK_CACHE_DIR` inside the repository, keep that cache out of git. For example, with `AGENT_PACK_CACHE_DIR=.agent-pack/cache`:

```gitignore
.agent-pack/cache/
```

If you do not want pack instances committed to the repo, either ignore all of `.agent-pack/` or point state at an external directory:

```gitignore
.agent-pack/
```

```bash
export AGENT_PACK_STATE_DIR="$HOME/.local/state/agent-pack/my-repo"
```

### Brief

The brief is the text document rendered by `agent-pack brief`. It is meant to be pasted into an agent or read by an agent from the shell.

When present, the brief renders sections in this order: prompt, instructions, contract, commands, references, skills, and tasks. `agent-pack` lists reference paths in the brief; it does not paste referenced file contents into the brief.

By default, task entries include the task body and `doneWhen` checklist. For very large task lists, set `AGENT_PACK_BRIEF_TASK_CONTENT=false` when rendering the brief to show only task status, ID, and title; the brief will tell the agent to run `agent-pack show <task-id> --id <pack-id>` before working a task.

### Manifest

A manifest is a reusable YAML file that can contribute instructions, tasks, references, skills, and contract rules to a pack. Manifest parsing is strict: unknown fields fail fast instead of being ignored.

### Prompt

The optional positional prompt is a one-off instruction for this pack instance:

```bash
agent-pack init --id worker-123 "Focus first on the cache behavior."
```

It is rendered at the top of the brief. Prompts are not tasks, references, or reusable manifest content.

### Instructions

Instructions are durable guidance loaded from a manifest or a raw instructions file. They are rendered after the prompt and before the tasks.

Use instructions for reusable workflow guidance such as review standards, evidence requirements, or completion expectations.

### Tasks

Tasks are mutable work items. Each task gets an auto-generated runtime ID (`t001`, `t002`, ...). If a manifest task has its own `id`, that value is preserved as `sourceId` for traceability, but task commands use the runtime ID shown by `agent-pack list`.

Agents update task state as they work:

```bash
agent-pack list --id quickstart
agent-pack start t001 --id quickstart
agent-pack note t001 --id quickstart "Read README.md."
agent-pack done t001 --id quickstart --note "Recorded findings in task notes."
```

### References

References are named pointers to read-only context the agent should inspect. They can be local files, local directories, globs, HTTP/HTTPS URLs, git paths, or whole git repo snapshots.

Examples:

```text
./docs/usage.md
../some-dir
./docs/**/*.md
https://example.com/design-notes.md
git+https://github.com/org/repo.git//docs/reference.md#main
git+https://github.com/org/repo.git//docs/**/*.md#v1.2.0
git+https://github.com/org/repo.git#main
git+git@github.com:org/repo.git//docs/reference.md#main
```

Directory and whole-repo references stay as one logical reference in the brief. Glob references list the matched files. Globs match files, include dotfiles, and do not follow symlinks.

### Skills

Skills are supplemental `SKILL.md` files. `agent-pack` extracts the skill name, description, and readable path so the brief can tell the agent when a skill may be relevant.

Only files named exactly `SKILL.md` are accepted as skills:

```bash
agent-pack init --skills './skills/**' --add-task "Apply relevant skills to this work."
```

That command scans broadly but only includes matching `SKILL.md` files.

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

### Contract

A contract is manifest-only guidance rendered in the brief for the agent to follow. It has `do` and `dont` string lists. If multiple manifests contribute contracts, entries are concatenated in source order.

## Quick Start

Create a pack with one task:

```bash
agent-pack init \
  --id quickstart \
  --add-task "Run date and record the output." \
  "Run the demo task and record evidence."
```

Expected output:

```text
Created pack quickstart
Run: agent-pack brief --id quickstart
```

Show the brief:

```bash
agent-pack brief --id quickstart
```

Abbreviated output:

```text
You are working from pack quickstart.

Prompt:
Run the demo task and record evidence.

Commands:
  agent-pack list --id quickstart
  agent-pack show <task-id> --id quickstart
  agent-pack start <task-id> --id quickstart
  agent-pack note <task-id> --id quickstart "evidence"
  agent-pack done <task-id> --id quickstart --note "completion evidence"
  agent-pack block <task-id> --id quickstart --note "blocker"
  ...

Tasks:
[pending] t001 - Run date and record the output.
```

In your agent CLI or editor agent, paste a handoff like this:

```text
Run agent-pack brief --id quickstart and work the pack. Update task status as you go.
```

Check progress:

```bash
agent-pack list --id quickstart
agent-pack status --id quickstart
agent-pack report --id quickstart
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
| `--id <id>` | Use a specific pack ID. Must start with `A-Z`, `a-z`, or `0-9`; may contain `A-Z`, `a-z`, `0-9`, `.`, `_`, `-`; max 64 characters |
| `--name <name>` | Set a display name |
| `--manifest <ref>` | Load one manifest YAML file or git ref |
| `--manifests <ref>` | Alias for `--manifest`; useful when passing several manifests |
| `--instructions <path>` | Read a plain text or Markdown file verbatim as the pack instructions section |
| `--add-task <text>` | Add one ad hoc task |
| `--task <ref>` | Add one task YAML file, glob, or git ref |
| `--tasks <ref>` | Alias for `--task`; useful when passing several task sources |
| `--reference <ref>` | Add one reference file, directory, glob, URL, or git ref |
| `--references <ref>` | Alias for `--reference`; useful when passing several references |
| `--skill <ref>` | Add one `SKILL.md` file |
| `--skills <ref>` | Alias for `--skill`; useful when passing several skills |
| `--git-refresh auto\|always\|never` | Control git fetching for this command |
| `--state-dir <path>` | Override the state directory for `init`; use `AGENT_PACK_STATE_DIR` for other commands |
| `--json` | Emit machine-readable output |

Example:

Illustrative only: replace the `example/...` URLs and local paths with sources that exist for your project.

```bash
agent-pack init \
  --id reviewer-001 \
  --add-task "Check local unstaged changes" \
  --manifest git+https://github.com/example/agent-packs.git//review/base.yaml#main \
  --task git+https://github.com/example/agent-packs.git//tasks/security-review.yaml#main \
  --task ./tasks/*.yaml \
  --reference git+https://github.com/example/product.git//docs/**/*.md#main \
  --reference https://example.com/design-notes.md \
  --reference git+https://github.com/example/product.git//adr#main \
  --references './docs/**/*.md' \
  --skill git+https://github.com/example/agent-skills.git//review/fresh-eyes/SKILL.md#v1.0.0 \
  --skills './skills/**' \
  "Use the included docs and skills to complete the review."
```

That command composes content across types: the manifest can contribute instructions, tasks, references, skills, and contract rules; task flags add more tasks; reference flags add git, URL, and local reading material; skill flags add supplemental `SKILL.md` files.

For a similar pack expressed mostly as one manifest, put the reusable content in YAML. Task file and glob inputs become inline task entries in the manifest; keep `--task` flags alongside `--manifest` when you want to load external task files directly.

```yaml
schemaVersion: 1
name: reviewer-001
instructions: Use the included docs and skills to complete the review.

tasks:
  - title: Check local unstaged changes
  - id: security-review
    title: Run the shared security review task
    body: Follow the security review checklist for this repository.
  - id: local-task-review
    title: Run the local task review checklist
    body: Covers the work that would otherwise live in ./tasks/*.yaml.

references:
  - name: product docs
    ref: git+https://github.com/example/product.git//docs/**/*.md#main
  - name: design notes
    ref: https://example.com/design-notes.md
  - name: architecture decisions
    ref: git+https://github.com/example/product.git//adr#main
  - name: local docs
    ref: ./docs/**/*.md

skills:
  - ref: git+https://github.com/example/agent-skills.git//review/fresh-eyes/SKILL.md#v1.0.0
  - ref: ./skills/**
```

Then initialize with the manifest and a one-off prompt:

```bash
agent-pack init \
  --id reviewer-001 \
  --manifest ./reviewer-pack.yaml \
  "Use the included docs and skills to complete the review."
```

### `brief`

Print the agent-facing brief.

```bash
agent-pack brief --id reviewer-001
```

The brief includes the prompt, instructions, contract if defined, task commands when tasks exist, references, skills, and task list.

For long task lists, render a compact task section:

```bash
AGENT_PACK_BRIEF_TASK_CONTENT=false agent-pack brief --id reviewer-001
```

Compact briefs omit task bodies and `doneWhen` checklists, but keep task status, ID, and title. The agent can run `agent-pack show <task-id> --id reviewer-001` for the full task detail when starting a task.

### `sync`

Fetch and unpack missing git-backed material for a pack.

```bash
agent-pack sync --id reviewer-001
agent-pack sync --all --git-refresh always
agent-pack sync --all --json
```

With `--json`, `sync` emits the synced pack or packs as JSON. `--all --json` emits an array.

`sync` is explicit. Other commands do not fetch or clone git sources. If a pack is resumed on a new host, run `sync` before `brief`:

```text
Continue work on reviewer-001. Run agent-pack sync --id reviewer-001, then agent-pack brief --id reviewer-001 and proceed.
```

`--git-refresh` applies only to `init` and `sync`:

| Value | Meaning |
|---|---|
| `auto` | Clone the mirror if missing; do not refresh existing mirrors |
| `always` | Clone if missing; otherwise run `git fetch --prune --tags` before resolving refs |
| `never` | Do not clone or fetch; fail if the mirror is missing |

With `auto`, a branch ref such as `main` continues resolving from the cached mirror until you run `agent-pack sync --git-refresh always`.

Local references and skills are not affected by `sync`; they are read from their paths when the agent uses them.

### `clean`

Remove rebuildable git cache material for packs in the current state directory.

```bash
agent-pack clean
agent-pack clean --id reviewer-001
agent-pack clean --json
```

By default, `clean` reads all packs in the current state directory and removes matching `git/<repoHash>` mirrors and `snapshots/<repoHash>` directories from the cache root. `--id` limits cleanup to one pack. Pack state, event logs, local references, HTTP/HTTPS references, and locks are not removed.

After cleaning, run `agent-pack sync --all` or `agent-pack sync --id <pack>` before rendering briefs for packs with git-backed material. Resync can fail if the original remote, ref, or credentials are no longer available.

The cache root is shared by default across projects for the same user account. If two state directories reference the same git repository, `agent-pack clean` in one project can remove cache material another project will need to rebuild with `sync`. Do not run `clean` while another `agent-pack` process is reading from or writing to the same cache root.

With `--json`, `clean` emits `{ packIds, repoHashes, removed }`: pack IDs scanned, unique git repository cache keys targeted, and cache paths actually removed.

### Task Commands

```bash
agent-pack list --id reviewer-001
agent-pack show t001 --id reviewer-001
agent-pack start t001 --id reviewer-001 --note "Starting review."
agent-pack note t001 --id reviewer-001 "Read the design."
agent-pack done t001 --id reviewer-001 --note "Completed with evidence in notes."
agent-pack block t002 --id reviewer-001 --note "Need user decision."
```

`agent-pack note` takes the note text as a positional argument. `start`, `done`, and `block` take optional note text with `--note`.

### Status and Reports

```bash
agent-pack status --id reviewer-001
agent-pack status --all
agent-pack status --id reviewer-001 --json
agent-pack report --id reviewer-001
agent-pack report --id reviewer-001 --json
agent-pack summary --id reviewer-001
```

`status --all` prints tab-separated columns: pack id, pack name, status, completed/total task count, and a `blocked:N` field. Use `status --all --json` for scripts.

Derived pack statuses:

| Status | Meaning |
|---|---|
| `no_tasks` | Pack has context but no tasks |
| `pending` | Pack has tasks and no work has started |
| `in_progress` | At least one task has started or completed |
| `blocked` | One or more incomplete tasks are blocked |
| `completed` | All tasks are completed |

### Exit Codes

`agent-pack` exits `0` on success and `1` for user-visible errors such as validation failures, missing packs, missing files, and git failures. Error messages are printed to stderr.

## Manifests

Manifests are YAML files that define reusable pack content. A manifest ref can be a local file or a git file ref:

```bash
agent-pack init --manifest ./pack.yaml
agent-pack init --manifests git+https://github.com/org/packs.git//review.yaml#main
```

Treat remote manifests as trusted inputs. A manifest can reference any local path readable by the user running `agent-pack`, plus arbitrary HTTP/HTTPS URLs that the agent may fetch from the host's network. A malicious manifest could direct the agent to inspect sensitive local files or call internal endpoints reachable from the agent. Only load manifests from sources you trust.

Manifest parsing is strict. Unknown fields are rejected.

| Location | Allowed fields |
|---|---|
| Manifest | `schemaVersion`, `name`, `instructions`, `tasks`, `references`, `skills`, `contract` |
| Task | `id`, `title`, `category`, `body`, `doneWhen` |
| Reference or skill include | `name`, `description`, `ref` |
| Contract | `do`, `dont` |

Rules:

- `schemaVersion`, when present, must be `1`.
- Each task must have `id` or `title`.
- `doneWhen`, `contract.do`, and `contract.dont` are arrays of non-empty strings.
- Reference and skill `ref` values are non-empty strings.
- `contract` must include at least one `do` or `dont` entry.
- Manifest task `id` is preserved as `sourceId`; task commands use the runtime ID (`t001`, `t002`, ...) shown by `agent-pack list`.
- `category` is stored as task metadata but is not currently rendered in the brief.

```yaml
schemaVersion: 1
name: implementation-review
instructions: |
  Review references before starting tasks.
  Update task notes with concrete evidence.

tasks:
  - id: inspect
    title: Inspect implementation
    body: Check the implementation against the included design.
    doneWhen:
      - Notes identify files inspected.
      - Findings are recorded or the task says no issues found.

references:
  - name: design
    description: Initial product design.
    ref: ./docs/usage.md

  - name: upstream examples
    description: Related docs from an external repository.
    ref: git+https://github.com/org/repo.git//docs/**/*.md#main

  - name: published guidance
    description: A public HTTP reference for the agent to read.
    ref: https://example.com/guidance.md

skills:
  - ref: ./skills/fresh-eyes/SKILL.md
```

CLI flags and manifests can be combined. Merge order is deterministic and source-order based:

1. `agent-pack init` reads include flags from left to right.
2. Each include contributes content to one or more typed brief sections: instructions, tasks, references, skills, or contract.
3. The final brief still renders one section per type. Inside each section, entries keep the relative order of the sources that contributed them.
4. The positional prompt is stored as the pack-level prompt and rendered at the top of the brief. It is not part of section ordering.

Suppose this command places the ad hoc task before manifest tasks, while references and skills still render in their own sections:

```bash
agent-pack init \
  --id ordered-review \
  --add-task "Check local unstaged changes first" \
  --manifest git+https://github.com/example/agent-packs.git//review/base.yaml#main \
  --task ./tasks/follow-up.yaml \
  --reference git+https://github.com/example/product.git//docs/api.md#main \
  --reference ./notes.md \
  --skill git+https://github.com/example/agent-skills.git//review/fresh-eyes/SKILL.md#v1.0.0
```

The task section renders the ad hoc task, then tasks from the remote manifest, then tasks from `./tasks/follow-up.yaml`. The reference section renders references from the remote manifest before the remote API doc and `./notes.md` because the manifest appeared first among reference-contributing sources. Skills from the manifest render before the explicit remote skill for the same reason.

## Git Sources

Git source syntax:

```text
git+<repo-url>//<path-inside-repo>#<ref>
git+<repo-url>#<ref>
```

The `#<ref>` suffix is optional. If omitted, `agent-pack` uses the remote default branch, resolves it to a commit, and records the resolved commit in source metadata.

Supported URL forms:

```text
git+https://github.com/org/repo.git//docs/usage.md#main
git+http://git.example.com/org/repo.git//docs/usage.md#main
git+ssh://git@github.com/org/repo.git//docs/usage.md#main
git+git@github.com:org/repo.git//docs/usage.md#main
git+file:///path/to/repo.git//docs/usage.md#main
git+git://git.example.com/org/repo.git//docs/usage.md#main
```

Authentication is delegated to normal `git` behavior: SSH agent, credential helper, netrc, platform keychain, or configured askpass.

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `AGENT_PACK_ID` | Default pack target | unset |
| `AGENT_PACK_STATE_DIR` | Pack state directory | `<repo>/.agent-pack/state` |
| `AGENT_PACK_CACHE_DIR` | Cache root | `$XDG_CACHE_HOME/agent-pack`, or `~/.cache/agent-pack` when `XDG_CACHE_HOME` is unset, or `<cwd>/.agent-pack/cache` when neither `XDG_CACHE_HOME` nor `HOME` is set |
| `AGENT_PACK_GIT_REFRESH` | Default git fetch policy for `init` and `sync` | `auto` |
| `AGENT_PACK_CMD` | Command name rendered in brief task commands; set when invoking through a wrapper | `agent-pack` |
| `AGENT_PACK_BRIEF_TASK_CONTENT` | Include task body and `doneWhen` checklist in rendered briefs; set to `false` to render only task status, ID, and title | `true` |

Relative path values resolve from the current working directory.

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

<cache root>/
  git/
  snapshots/
  locks/
```

The cache root is `AGENT_PACK_CACHE_DIR` when set, otherwise `$XDG_CACHE_HOME/agent-pack`, `~/.cache/agent-pack`, or `.agent-pack/cache` in the current working directory if neither `XDG_CACHE_HOME` nor `HOME` is set.

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
# Only needed if AGENT_PACK_CACHE_DIR is pointed inside the repo.
.agent-pack/cache/
```

### Keep Pack State Local

Use this when pack instances are personal scratch state and should not appear in repo history.

Option 1: ignore the whole default directory:

```gitignore
.agent-pack/
```

Option 2: store state outside the repo:

```bash
export AGENT_PACK_STATE_DIR="$HOME/.local/state/agent-pack/reviewer-001"
```

With external state, set `AGENT_PACK_ID` or pass `--id` so commands target the intended pack:

```bash
export AGENT_PACK_ID=reviewer-001
agent-pack brief
```

`agent-pack` does not snapshot local files. If a local reference or skill changes after pack creation, the agent reads the current file at that path. HTTP/HTTPS references are rendered as URLs for the agent to read. Git references resolve to a commit and read from exported snapshots. Git snapshots reject symlinks instead of extracting them into the cache.

`agent-pack clean` removes git cache directories referenced by current pack state and leaves `.agent-pack/state/` untouched. The removed cache can be rebuilt with `agent-pack sync` while the upstream git sources remain accessible.

### Event Log

Each pack has an append-only JSONL event log under `.agent-pack/state/events/<id>.jsonl`. Events are written for pack creation and task state changes such as start, note, done, and block. Commit event logs with `.agent-pack/state/` when you want the audit trail to travel with the pack.

### Locking

State mutations are serialized with lock directories under the cache root's `locks/` directory. Stale locks whose holder process is gone are recovered automatically. If a command reports a stuck lock and no `agent-pack` process is running, remove the reported lock directory.

Lock filenames are prefixed with a 16-character hash of the state directory path so multiple state directories sharing the same cache root do not collide.

### Reinitializing a Pack

`agent-pack init` fails if the pack id already exists. To recreate a scratch pack, remove `.agent-pack/state/packs/<id>.json` and `.agent-pack/state/events/<id>.jsonl`; the index is reconciled from disk by later status/list operations.

## More Documentation

See [docs/usage.md](docs/usage.md) for a compact installed usage reference.
