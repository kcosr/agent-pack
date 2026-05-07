# agent-pack Design

## Overview

`agent-pack` is a local-first CLI for preparing a durable handoff packet for one or more agents. A pack can include mutable tasks, read-only reference material, and skill files. The agent reads the pack brief, uses the referenced files and cached git snapshots as context, then updates task status and evidence notes as it works.

The core object is a **pack**: a reproducible bundle of instructions, task state, references, skills, provenance, and a generated summary.

## Core Design Choice

Use explicit source flags for pack inputs, plus one optional positional prompt:

```bash
agent-pack init \
  --manifest ./base-pack.yaml \
  --task ./tasks/*.yaml \
  --reference ./docs/state.md \
  --references 'git+https://github.com/org/repo.git//docs/**/*.md#main' \
  --skill ./skills/*/SKILL.md \
  --add-task "Check local notes" \
  --id worker-123 \
  "Review these materials and work through the tasks."
```

The optional prompt is not a task source. It is the first instruction shown in the generated brief, above manifest instructions, tasks, references, and skills. This lets a user initialize a pack with a one-off direction, then tell an agent only: `agent-pack brief --id <id>`.

## Goals

- Create durable agent handoff packs with tasks, references, skills, instructions, and summaries.
- Keep task status/notes mutable while references and skills remain read-only inputs.
- Support local and git-hosted sources for tasks, references, and skills.
- Cache git repositories in a repo-local ignored cache by default and export resolved commits once into shared read-only snapshots.
- Extract skill metadata from `SKILL.md` files so briefs can tell the agent what each skill is for.
- Preserve source provenance for every task, reference, and skill.
- Let users initialize a pack, then tell an agent to run `agent-pack brief --id <id>` and work from it.

## Core CLI Non-goals

- No agent execution or backend orchestration.
- No daemon, retry loop, schedule, worktree lifecycle, PR flow, or external run model.
- No automatic use of skills by the tool itself. `agent-pack` exposes skills to the agent; it does not execute them.
- No implicit broad repo ingestion. Whole-repo context must be requested explicitly with a repo reference.
- No compatibility alias for earlier names unless explicitly requested.

## Pack Contents

A pack can contain:

- `prompt`: optional one-off instruction shown first in the brief.
- `instructions`: top-level handoff guidance.
- `tasks`: mutable work items with status, notes, and evidence.
- `references`: read-only context files for the agent to inspect.
- `skills`: read-only `SKILL.md` files plus extracted metadata.
- `contract`: optional observable behavior/specification.
- `surfaceInventory`: optional list of user-visible names to wire or verify.
- `summary`: generated projection of canonical pack state.

## CLI Sketch

### `init`

```bash
agent-pack init [options] [prompt]
```

Suggested options:

| Option | Purpose |
|---|---|
| `--id <id>` | Use a specific pack instance ID |
| `--name <name>` | Display pack name |
| `--manifest <ref>` | Load one manifest YAML file or git ref |
| `--manifests <ref>` | Alias for `--manifest` |
| `--instructions <path>` | Markdown/YAML instructions file |
| `--add-task <text>` | Add one ad hoc task |
| `--task <ref>` | Add one task YAML file/glob/git ref |
| `--tasks <ref>` | Alias for `--task` |
| `--reference <ref>` | Add one reference file |
| `--references <ref>` | Alias for `--reference` |
| `--skill <ref>` | Add one skill file |
| `--skills <ref>` | Alias for `--skill` |
| `--git-refresh auto\|always\|never` | Override git fetch policy for git sources |
| `--state-dir <path>` | Override state directory |
| `--json` | Emit machine-readable output |
| `--strict` | Reject ambiguous/unsupported metadata |

Both singular and plural forms can accept globs; singular reads better for one file, plural reads better for many.

Examples:

```bash
agent-pack init \
  --id design-worker \
  --name "Design review" \
  --manifest ./base-pack.yaml \
  --task ./tasks/design-review.yaml \
  --reference ./docs/current-design.md \
  --skill ~/.codex/skills/.system/fresh-eyes/SKILL.md \
  --add-task "Check local notes" \
  "Review the design and record concrete findings in task notes."
```

```bash
agent-pack init \
  --id reviewer-001 \
  --manifest ./base-pack.yaml \
  --manifests 'git+https://github.com/org/packs.git//review-pack.yaml#main' \
  --tasks ./tasks/*.yaml \
  --references 'git+https://github.com/org/repo.git//docs/**/*.md#main' \
  --skills 'git+https://github.com/org/skills.git//*/SKILL.md#v1' \
  --add-task "Check local changes" \
  "Use the repository docs and supplemental skills to complete the review."
```

### `brief`

```bash
agent-pack brief --id worker-123
```

Brief output should include:

- prompt, when provided
- instructions
- task list and status
- references with descriptions and readable paths
- skills with extracted descriptions and readable paths
- contract, surface inventory, assumptions, and blockers when present
- commands for updating task progress

Example:

```text
You are working from pack worker-123.

Prompt:
Review these materials and work through the tasks.

Tasks:
[pending] t001 - Review current design

References:
- current design
  Description: Current design document.
  Path: ./docs/current-design.md

Skills:
Use these supplemental skills when their descriptions match the work in this pack. Read the listed `SKILL.md` before applying a skill's workflow.

- fresh-eyes
  Description: Re-read changed code with fresh eyes and fix obvious issues.
  Path: ./skills/fresh-eyes/SKILL.md

Progress commands:
  agent-pack start t001 --id worker-123
  agent-pack note t001 --id worker-123 "evidence"
  agent-pack done t001 --id worker-123 --note "completion evidence"
```

### Task Commands

Task commands update the mutable task state inside a pack:

```bash
agent-pack list --id worker-123
agent-pack show t001 --id worker-123
agent-pack start t001 --id worker-123
agent-pack note t001 --id worker-123 "Read the design doc."
agent-pack done t001 --id worker-123 --note "Reviewed and summarized findings."
agent-pack block t001 --id worker-123 --note "Need caller decision."
agent-pack status --id worker-123
agent-pack status --all
agent-pack sync --id worker-123
agent-pack report --id worker-123
agent-pack summary --id worker-123
```

Environment default:

```bash
export AGENT_PACK_ID=worker-123
```

Then agents can omit `--id`.

### `status`

Show derived pack progress.

```bash
agent-pack status --id worker-123
agent-pack status --all
agent-pack status --id worker-123 --json
```

Single-pack output:

```text
Pack: worker-123
Name: Design review
Status: in_progress

Tasks: 2/5 completed, 1 blocked
References: 3
Skills: 2
Last updated: 2026-05-07T12:34:10.000Z

Blocked:
- t004 - Verify git snapshot cache
```

All-pack output:

```text
worker-123    Design review    in_progress  2/5  blocked:1
context-only  Context pack     no_tasks     0/0  blocked:0
```

JSON output:

```json
{
  "id": "worker-123",
  "name": "Design review",
  "status": "in_progress",
  "tasks": {
    "total": 5,
    "pending": 2,
    "inProgress": 0,
    "completed": 2,
    "blocked": 1
  },
  "references": 3,
  "skills": 2
}
```

Derived statuses:

| Status | Meaning |
|---|---|
| `no_tasks` | Pack has references/skills/instructions but no tasks. |
| `pending` | Pack has tasks, and none are started, completed, or blocked. |
| `in_progress` | At least one task has started or completed, and the pack is not complete or blocked. |
| `blocked` | One or more tasks are blocked and not all tasks are completed. |
| `completed` | All tasks are completed. |

### `sync`

Hydrate missing git cache material for a pack.

```bash
agent-pack sync --id worker-123
agent-pack sync --all --git-refresh always
```

This command is explicit. Other commands should not implicitly fetch or clone git sources. A user can include it in the prompt given to an agent, for example: "Continue work on `worker-123`; run `agent-pack sync --id worker-123`, then `agent-pack brief --id worker-123` and proceed."

`--git-refresh` is valid only for `init` and `sync`, the two commands that may touch git remotes:

- `auto`: fetch if the mirror is missing or stale by the tool's normal policy.
- `always`: fetch before resolving refs or exporting snapshots.
- `never`: do not fetch; use only existing cache material and fail if it is missing.

## Source Reference Syntax

Use the same reference syntax for tasks, references, and skills:

```text
./local/path.md
./local/directory
./local/glob/**/*.md
git+<repo-url>//<path-inside-repo>#<ref>
git+<repo-url>[#<ref>]
```

Examples:

```text
./docs/design.md
../some-dir
./docs/**/*.md
git+http://git.example.com/org/repo.git//docs/design.md#main
git+https://github.com/org/repo.git//docs/design.md#main
git+https://github.com/org/repo.git//docs/**/*.md#v1.2.0
git+https://github.com/org/repo.git#main
git+ssh://git@github.com/org/repo.git//docs/design.md#main
git+git@github.com:org/repo.git//docs/design.md#main
```

For git references, `#<ref>` is optional. If omitted, v1 uses the remote default branch, resolves it to a commit, and records both the resolved ref and commit in provenance. Explicit refs are still recommended when the pack must be reproducible.

Supported git URL forms:

- `https://...`
- `http://...`
- `ssh://...`
- scp-like SSH, such as `git@github.com:org/repo.git`

`agent-pack` should not implement its own credential system in v1. It should delegate authentication to the user's normal `git` setup: SSH agent, credential helper, netrc, platform keychain, or configured askpass behavior.

## Reference Policy

A reference is one logical context object. It can point at one file, a directory, a glob result, a file/glob inside a git repo, or an entire git repo snapshot. The agent should see the reference as one named entry, not as an unstructured pile of individual files.

Recommended v1 behavior:

- `--reference <file>` records one local file path as one reference.
- `--references <directory>` records one local directory path as one reference.
- `--references <glob>` records matching local files as one grouped reference.
- `--references git+repo//path/file.md#ref` resolves the repo/ref once and records one file path inside the shared snapshot.
- `--references git+repo//path/**/*.md#ref` resolves the repo/ref once and records matching file paths inside the shared snapshot as one grouped reference.
- `--references git+repo#ref` resolves the repo/ref once and records the shared snapshot root as one repository reference.

This keeps the CLI simple: references are always supplied through `--reference` or `--references`; the shape of the ref determines whether the reference is a file, directory, glob, git path, or repo snapshot.

Directory and repo references should preserve their identity in the brief. The agent sees a single reference named from the directory/repo unless the user provides a YAML `name`, plus a path or root path. Do not include a file preview for directory or repo references.

Glob references should list the individual matched files in the brief because the explicit file set is the point of using a glob.

Whole-repo references should use a clean tracked snapshot, not expose the cached bare mirror or `.git` internals. A practical implementation can use `git archive` or an equivalent checkout/export from the resolved commit.

For local directories, reference files in place recursively by default. Do not follow symlinked directories by default. Preserve paths relative to the referenced directory in pack metadata.

For repo snapshots, export tracked files from the resolved commit into the shared snapshot cache. Reject symlink entries instead of extracting them. If the implementation defines default safety excludes for bulky/generated paths, the brief/report must say whether the snapshot is complete or filtered.

Readable paths should be direct local paths for local sources and repo-local cache paths for git sources:

```text
./docs/current-design.md
../some-dir/
.agent-pack/cache/snapshots/<repo-hash>/<commit>/docs/reference.md
.agent-pack/cache/snapshots/<repo-hash>/<commit>/
```

Each reference record should include:

```json
{
  "id": "r001",
  "name": "external reference",
  "description": "External design reference.",
  "source": {
    "kind": "git",
    "url": "https://github.com/org/repo.git",
    "requestedRef": "main",
    "resolvedRef": "main",
    "resolvedCommit": "abc123",
    "path": "docs/reference.md"
  },
  "path": ".agent-pack/cache/snapshots/<repo-hash>/abc123/docs/reference.md"
}
```

The brief should show the readable `path` or `rootPath` only. It should avoid showing both the original source ref and the resolved readable path unless provenance is requested through `agent-pack report --json` or similar detailed output. Agents already have file-reading tools; `agent-pack` does not need custom file paging commands in v1.

## Skill Policy

Skills should be limited to files named `SKILL.md`.

Recommended v1 behavior:

- `--skill ./path/to/SKILL.md` accepts exactly that file.
- `--skills './skills/*/SKILL.md'` accepts matching `SKILL.md` files.
- `--skills './skills/**'` expands only files whose basename is exactly `SKILL.md`.
- `--skill ./skills/foo/README.md` fails because it is not a skill file.
- Git skill refs follow the same rule: only matched files named `SKILL.md` are accepted.

This keeps skill ingestion precise and prevents accidentally treating docs, examples, scripts, or arbitrary markdown as executable agent guidance.

Brief wording should make clear that packed skills are supplemental. They are available for the agent to use when their descriptions match the task, but including a skill in a pack does not require using it for every task.

For each `SKILL.md`, extract metadata for the brief:

- `name`: from frontmatter `name`, first heading, parent directory name, or explicit CLI override.
- `description`: from frontmatter `description`, the first short paragraph, or an empty description with a warning.
- `path`: local source path or shared git snapshot path the agent should read.

Recommended skill file parsing:

1. If YAML frontmatter exists, read `name` and `description`.
2. Else use the first H1 heading as `name`.
3. Else use the parent directory name as `name`.
4. For description, use frontmatter `description` first.
5. Else use the first non-heading paragraph up to a reasonable length.
6. Preserve the full `SKILL.md` content unchanged. For git skills, read from the shared snapshot. For local skills, read the local file in place.

Example skill record:

```json
{
  "id": "s001",
  "name": "fresh-eyes",
  "description": "Re-read changed code with fresh eyes, looking for obvious bugs, errors, and issues, then fix them.",
  "source": {
    "kind": "file",
    "path": "./skills/fresh-eyes/SKILL.md"
  },
  "path": "./skills/fresh-eyes/SKILL.md"
}
```

If multiple skills resolve to the same name, keep both but disambiguate display names with a suffix or source label. Do not silently drop one.

## Pack Manifest YAML Shape

A full pack manifest can be YAML:

```yaml
schemaVersion: 1
name: design-review
instructions: |
  Review the design using the included references and skills.

tasks:
  - id: inspect
    title: Inspect the design
    category: process
    body: Read the design and summarize gaps.
    doneWhen:
      - Notes include specific sections reviewed.

references:
  - name: current design
    description: Current design document.
    ref: ./docs/current-design.md

  - name: external docs
    description: External documentation used for comparison.
    ref: git+https://github.com/org/repo.git//docs/**/*.md#main

skills:
  - ref: ./skills/fresh-eyes/SKILL.md

contract:
  type: design
  summary: Produce a comprehensive pack design without changing implementation files.

surfaceInventory:
  - name: agent-pack
    disposition: added
    layers:
      - CLI command name
      - state directory name
      - environment variables
      - brief rendering
      - documentation examples
    symmetricPeers: []
    removalTwin: null
```

CLI flags and YAML can be combined. Merge order should be deterministic:

1. YAML pack sources from `--manifest` / `--manifests`, in flag order within each option
2. `--instructions`, in flag order
3. `--task` / `--tasks` source refs, in flag order within each option
4. `--add-task` ad hoc entries, in flag order
5. `--reference` / `--references`, in flag order within each option
6. `--skill` / `--skills`, in flag order within each option
7. positional prompt, stored as pack-level `prompt`

## State Layout

Default working-directory layout:

```text
<repo>/.agent-pack/
  state/
    index.json
    packs/
      worker-123.json
    events/
      worker-123.jsonl
  cache/
    git/
      <url-hash>/
        mirror.git
    snapshots/
      <url-hash>/
        <commit>/
  locks/
  tmp/
```

The committed state lives under `.agent-pack/state`. The repo-local cache lives under `.agent-pack/cache` and should be ignored by git. `locks` and `tmp` are also local-only.

Recommended `.gitignore` entries:

```gitignore
.agent-pack/cache/
.agent-pack/locks/
.agent-pack/tmp/
```

The git cache stores reusable mirrors and immutable exported snapshots. Pack state stores portable relative paths into local files/directories or repo-local snapshots; it does not copy local reference/skill files into the pack by default.

When one init command includes multiple tasks, references, and skills from the same git repo/ref, `agent-pack` should resolve that repo/ref once to a commit, export one snapshot for that commit, and point every source type at paths inside the same snapshot.

Local paths are referenced directly. If the local file changes after pack init, the agent reads the current file at that path.

## Explicit Sync

`agent-pack sync` should be the only command that fetches or hydrates git-backed material after init. It loads committed pack state from `.agent-pack/state`, finds every git source in tasks, references, and skills, and ensures the needed mirrors and snapshots exist under `.agent-pack/cache`.

This keeps normal commands predictable: `brief`, `show`, `list`, `status`, `report`, and task mutation commands read existing state and paths only. If cache material is missing, they should report the missing path and suggest `agent-pack sync --id <id>`.

This still supports resuming on a new host. A user can clone the project, then tell the agent: "Continue work on `worker-123`; run `agent-pack sync --id worker-123`, then `agent-pack brief --id worker-123` and proceed." The sync command recreates ignored cache material without wiping or rewriting pack state.

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `AGENT_PACK_ID` | Default pack target | unset |
| `AGENT_PACK_STATE_DIR` | Committed pack state directory | `<repo>/.agent-pack/state` |
| `AGENT_PACK_CACHE_DIR` | Ignored cache root | `<repo>/.agent-pack/cache` |
| `AGENT_PACK_GIT_CACHE_DIR` | Git mirror cache root | `$AGENT_PACK_CACHE_DIR/git` |
| `AGENT_PACK_GIT_REFRESH` | Default git fetch policy for `init` and `sync`: `auto`, `always`, `never` | `auto` |
| `AGENT_PACK_CMD` | Command name rendered in briefs | `agent-pack` |

## Pack State Shape

```json
{
  "schemaVersion": 1,
  "id": "worker-123",
  "name": "design review",
  "status": "pending",
  "createdAt": "2026-05-07T12:00:00.000Z",
  "updatedAt": "2026-05-07T12:10:00.000Z",
  "repoRoot": ".",
  "prompt": "Review these materials and work through the tasks.",
  "instructions": "Review the design using the included references and skills.",
  "taskCounts": {
    "total": 1,
    "pending": 1,
    "inProgress": 0,
    "completed": 0,
    "blocked": 0
  },
  "tasks": [
    {
      "id": "t001",
      "sourceId": "inspect",
      "title": "Inspect the design",
      "category": "process",
      "body": "Read the design and summarize gaps.",
      "doneWhen": ["Notes include specific sections reviewed."],
      "status": "pending",
      "notes": [],
      "source": {
        "kind": "file",
        "path": "./tasks/design-review.yaml"
      }
    }
  ],
  "references": [
    {
      "id": "r001",
      "name": "current design",
      "description": "Current design document.",
      "source": {
        "kind": "file",
        "path": "./docs/current-design.md"
      },
      "path": "./docs/current-design.md"
    }
  ],
  "skills": [
    {
      "id": "s001",
      "name": "fresh-eyes",
      "description": "Re-read changed code with fresh eyes, looking for obvious bugs, errors, and issues, then fix them.",
      "source": {
        "kind": "file",
        "path": "./skills/fresh-eyes/SKILL.md"
      },
      "path": "./skills/fresh-eyes/SKILL.md"
    }
  ],
  "contract": {
    "type": "design",
    "summary": "Produce a comprehensive pack design."
  },
  "surfaceInventory": [],
  "assumptions": []
}
```

## Resolution and Materialization

`agent-pack init` should be transactional:

1. Resolve state/cache directories.
2. Parse flags and optional positional prompt.
3. Resolve local source paths.
4. Group git sources by repo/ref.
5. Fetch git mirrors according to `--git-refresh` / `AGENT_PACK_GIT_REFRESH`.
6. Resolve each git repo/ref group once to a commit.
7. Export or reuse one shared snapshot per repo/commit.
8. Expand local and git globs.
9. Filter skills to exact `SKILL.md` basename.
10. Parse/validate task YAML from local paths or snapshot paths.
11. Extract skill metadata from local paths or snapshot paths.
12. Materialize tasks with generated IDs.
13. Write pack JSON, index entry, and `pack.created` event.
14. Emit brief command.

If any hard failure occurs before state commit, no partial pack should be created.

Hard failures:

- explicit task/reference/skill file not found
- git repo/ref unavailable
- skill source resolves files but none are named `SKILL.md`
- `--skill` points to a non-`SKILL.md` file
- malformed task YAML
- invalid task shape
- selected pack ID already exists

Warnings:

- reference glob matches zero files
- skill glob matches files but filters out non-`SKILL.md` paths
- skill description could not be extracted
- reference has no description

Reference-only packs should be allowed without warning. A pack can be useful as context even without mutable tasks.

## V1 Decisions

### Pack Manifests

Support repeatable `--manifest pack.yaml` and `--manifests git+repo//pack.yaml#ref` in v1. YAML is the cleanest way to attach names and descriptions to references and skills, define instructions, and keep larger pack definitions reviewable.

```bash
agent-pack init --manifest ./pack.yaml --id design-worker
agent-pack init --manifests git+https://github.com/org/packs.git//pack.yaml#main --id design-worker
```

CLI flags can still be used for quick one-off packs. If both manifests and explicit flags are provided, merge deterministically: load manifests first in flag order, then append instruction files, CLI-provided task source refs, ad hoc tasks, references, and skills in category order.

### Local Files

Do not copy local reference or skill files into pack state. Store readable local paths in the pack. Local paths are intentionally live.

### Brief Content

Do not inline reference excerpts in the brief. Print names, descriptions, and paths. Agents can use normal file-reading tools to inspect exact ranges or offsets.

### Skill Execution

`agent-pack` does not execute skills. It exposes supplemental skills to the agent. The agent decides whether to read and apply a skill based on the task and the skill description.

### Pack Target Flag

Use `--id` for task commands. `--id` names the mutable pack instance. `--name` remains display metadata.

### Positional Prompt

Support one optional positional prompt on `agent-pack init`. Store it as pack-level `prompt` and render it at the top of `agent-pack brief`. The prompt is an instruction to the agent, not a task definition and not a reference source.

```bash
agent-pack init \
  --id worker-123 \
  --manifest ./review-pack.yaml \
  "Review the bundled material and complete the checklist."
```

## Repository Setup

Recommended repo shape:

```text
agent-pack/
  AGENTS.md
  CHANGELOG.md
  README.md
  biome.json
  package.json
  package-lock.json
  src/
    cli/
      agent-pack.ts
    core/
      brief/
      git/
      manifest/
      sources/
      state/
      tasks/
  test/
    unit/
    integration/
      cli/
    smoke/
  docs/
  examples/
  scripts/
    release.mjs
```

Use a single-package TypeScript Node CLI repo. V1 ships only the `agent-pack` behavior.

Entry point boundaries:

- `src/cli/agent-pack.ts`: current CLI for init, sync, brief, status, report, and task updates.
- `src/core/`: reusable pack logic with no process-spawning or agent-specific orchestration assumptions.
- A later orchestration CLI can be added as `src/cli/agent-pack-runner.ts` plus `src/runner/` without moving pack state, source resolution, or brief rendering out of `src/core/`.

Initial `package.json` bin shape:

```json
{
  "bin": {
    "agent-pack": "./dist/cli/agent-pack.js"
  }
}
```

If the runner is added later, extend the bin map without moving the existing CLI:

```json
{
  "bin": {
    "agent-pack": "./dist/cli/agent-pack.js",
    "agent-pack-runner": "./dist/cli/agent-pack-runner.js"
  }
}
```

### Package Scripts

Sample `package.json` scripts:

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.test.json --noEmit",
    "test": "vitest run",
    "test:smoke": "vitest run test/smoke",
    "test:watch": "vitest",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write .",
    "check": "npm run lint && npm run typecheck && npm run test",
    "lint-staged": "lint-staged",
    "prepare": "husky install"
  }
}
```

Keep `npm test` fast enough for local iteration. Smoke tests can be slower and should run through `npm run test:smoke`.

### Smoke Tests

Smoke tests should exercise the built CLI end to end, including live git behavior. They are allowed to clone/fetch real repositories and verify cache refresh behavior.

Required smoke coverage:

- `agent-pack init` with a git reference over HTTPS.
- `agent-pack init` with a git skill ref that resolves only `SKILL.md` files.
- `agent-pack sync --id <id>` hydrating missing `.agent-pack/cache` snapshots from committed state.
- `agent-pack sync --git-refresh always` fetching before snapshot materialization.
- `agent-pack sync --git-refresh never` failing clearly when required cache material is absent.
- `agent-pack brief --id <id>` after live git materialization, verifying the brief points at readable snapshot paths.

Smoke tests should create temporary workspaces and avoid depending on developer-global git cache state. They can use small public repositories or local temporary bare repositories served through normal git URL forms; at least one test should cover a real network HTTPS clone unless the environment explicitly opts out.

Suggested environment controls:

```text
AGENT_PACK_SMOKE_LIVE_GIT=1
AGENT_PACK_SMOKE_REPO=https://github.com/<org>/<small-fixture-repo>.git
```

When live network smoke tests are disabled, the test suite should skip them explicitly rather than silently downgrading them into unit tests.

### Biome and Husky

Sample `biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "complexity": {
        "noForEach": "off"
      },
      "suspicious": {
        "noAssignInExpressions": "off"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "files": {
    "ignore": ["dist/", "node_modules/", "coverage/", ".agent-pack/"]
  }
}
```

Sample `.husky/pre-commit`:

```sh
#!/bin/sh
npm run lint-staged
npm run check
```

Sample `lint-staged` package config:

```json
{
  "lint-staged": {
    "*.{ts,tsx,js,jsx,mjs,cjs,json,md,yaml,yml}": ["biome format --write"]
  }
}
```

### AGENTS.md

Sample `AGENTS.md`:

```markdown
# Agent Onboarding (agent-pack)

This file is a lightweight internal onboarding note for agents working in this repo.

## Start Here

- Read `README.md` for the CLI surface and pack workflow.
- Read `docs/design.md` for pack state, manifest, reference, skill, and cache semantics.
- Source code lives in `src/cli/` and `src/core/`.
- Current CLI entrypoint is `src/cli/agent-pack.ts`.
- Tests live in `test/unit/` and `test/integration/`.
- CLI smoke tests live in `test/smoke/` and run with `npm run test:smoke`.
- Example manifests live in `examples/`.

## Conventions

- TypeScript Node CLI.
- Keep command parsing in `src/cli/`.
- Keep pack state, manifest parsing, source resolution, git cache, and brief rendering in `src/core/`.
- Prefer explicit contracts over fallback parsing or heuristic shape detection.
- Local reference and skill paths are read in place.
- Git sources resolve to a commit and read from ignored snapshots under `.agent-pack/cache`.
- Skills must resolve to files named exactly `SKILL.md`.

## Testing

- Run `npm install` to install dependencies.
- Run `npm run lint` for Biome checks.
- Run `npm run typecheck` for TypeScript checks.
- Run `npm test` for tests.
- Run `npm run test:smoke` before releases and after changes to git source resolution, cache hydration, or CLI wiring.
- Run `npm run check` before committing or releasing.
- If you cannot run relevant checks, call that out explicitly.

## Changelog

- Add user-facing changes to `CHANGELOG.md` under `## [Unreleased]`.
- Use the existing subsections: Breaking Changes, Added, Changed, Fixed, Removed.
- Append to existing subsections; do not create duplicate subsection headings.
- Include PR links when available.

## Release

- Run `npm run check`.
- Run `node scripts/release.mjs patch`, `minor`, or `major` from `main`.
- The release script bumps versions, promotes changelog entries, tags, pushes, creates a GitHub prerelease, and opens a fresh `## [Unreleased]` section.
```

### Changelog

Sample `CHANGELOG.md` scaffold:

```text
# Changelog

## [Unreleased]

### Breaking Changes

### Added

### Changed

### Fixed

### Removed
```

Rules:

- New entries go under `## [Unreleased]`.
- Append to existing subsections.
- Keep entries user-facing.
- Include PR links when available.
- Do not edit released sections except to correct factual errors.

### Release Script

Sample `scripts/release.mjs` behavior:

1. require a clean working tree
2. require release branch `main`
3. bump `package.json` and `package-lock.json`
4. promote `CHANGELOG.md` `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD`
5. commit `Release vx.y.z`
6. tag `vx.y.z`
7. push branch and tag
8. create a GitHub prerelease with `gh release create`
9. add a fresh `## [Unreleased]` scaffold
10. commit `Prepare for next release`

The script should not run tests itself; release instructions should require `npm run check` before release.

## Summary

`agent-pack` bundles tasks, references, and skills into a durable handoff packet. The pack model keeps mutable task progress while adding read-only context and skill metadata. The important constraints are:

- explicit flags: `--manifest`, `--task` / `--tasks`, `--reference` / `--references`, `--skill` / `--skills`
- skills are only `SKILL.md`
- references can be files, directories, globs, git paths, or git repo snapshots
- local files are referenced in place by default
- git clones and snapshots are cached in `.agent-pack/cache` by default
- `agent-pack sync` explicitly hydrates missing git cache material
- one git repo/ref is resolved once and reused across tasks, references, and skills
- skill descriptions are extracted and shown in the brief
- tasks remain evidence-bearing and mutable
- references and skills remain read-only and provenance-tracked

This gives a clean workflow: initialize a reproducible pack, then tell an agent to run `agent-pack brief --id <id>` and work from the tasks, references, and skills included there.
