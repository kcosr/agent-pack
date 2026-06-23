# Authoring Manifests, Tasks & Agents

This is the schema reference for the files you write to compose a pack: manifests, standalone task files, standalone agent files, and inputs. Manifest parsing is strict: unknown fields are rejected instead of being ignored.

For how an agent consumes a pack and how runs execute, see [concepts.md](concepts.md). For commands and flags, see [cli.md](cli.md). For paths, the catalog, and git sources, see [configuration.md](configuration.md). For the rendered brief, see [brief-format.md](brief-format.md).

## Manifest schema

A manifest is a reusable YAML file that can contribute instructions, inputs, tasks, references, skills, agents, and contract rules to a pack. Manifest parsing is strict. Unknown fields are rejected.

### Allowed fields by location

| Location | Allowed fields |
|---|---|
| Manifest | `schemaVersion`, `name`, `instructions`, `inputs`, `tasks`, `references`, `skills`, `agents`, `contract` |
| Input definition | `type`, `required`, `description`, `default`, `values` |
| Inline task object | `id`, `title`, `category`, `body`, `doneWhen`, `when` |
| Inline agent object | `name`, `command`, `args`, `timeoutSec`, `maxAttempts` |
| Reference or skill object | `name`, `description`, `ref` |
| Contract | `do`, `dont` |

### Rules

- `schemaVersion`, when present, must be `1`.
- `tasks`, `references`, `skills`, and `agents` are arrays. Each entry may be either a string ref or an object.
- A string entry in `tasks` is equivalent to `--task <ref>`.
- A string entry in `references` is equivalent to `--reference <ref>`.
- A string entry in `skills` is equivalent to `--skill <ref>`.
- A string entry in `agents` is equivalent to `--agent <ref>`.
- Bare string refs are catalog refs. Local paths must start with `./`, `../`, `~/`, or `/`. See [configuration.md](configuration.md) for the catalog and ref syntax.
- Each inline task object must have `id` or `title`.
- Input names must start with a letter or underscore and may contain letters, numbers, underscores, and dashes.
- Input `type` defaults to `string`; supported types are `string`, `enum`, `boolean`, and `number`.
- Enum inputs require a non-empty `values` list.
- `doneWhen`, `contract.do`, and `contract.dont` are arrays of non-empty strings.
- Reference and skill object `ref` values are non-empty strings.
- Agent object entries are inline definitions and must include `name` and `command`.
- Agent names must be unique after resolving string refs and inline definitions.
- `contract` must include at least one `do` or `dont` entry.
- Manifest task `id` is preserved as `sourceId`; task commands use the runtime ID (`t001`, `t002`, ...) shown by `agent-pack task list`.
- `category` is stored as task metadata but is not currently rendered in the brief.

## Inputs and conditional tasks

Manifest inputs capture caller-provided context and simple workflow state at `init` time. Declare them in an `inputs` map; values are resolved at `init` and render first in the brief when the pack has a non-empty input schema (see [brief-format.md](brief-format.md)).

```yaml
inputs:
  scope:
    required: true
    description: What code, docs, or behavior should the agent inspect?
  severity:
    type: enum
    values: [low, medium, high]
    default: medium
  include_tests:
    type: boolean
    default: true
```

Pass values with repeatable `--input key=value`. Defaults satisfy missing optional or required inputs. Resolved inputs render near the top of `agent-pack brief` as caller-provided context. Inputs are not templates: they are not substituted into task titles, task bodies, instructions, references, skills, or YAML files.

### Input types and coercion

| Type | Accepted values | Notes |
|---|---|---|
| `string` (default) | any string | A `required` string must not be empty |
| `enum` | a member of `values` | `values` must be a non-empty list of strings |
| `boolean` | `true`, `1`, `false`, `0`, or a real YAML boolean | Anything else is an error |
| `number` | any finite number (string or numeric) | Empty and non-finite values are rejected |

A `default`, when set, is coerced by the same rules as a provided value.

### The `when` grammar

Tasks declare YAML-only conditions with `when`. A `when` clause names declared inputs and decides whether a task starts active or locked.

```yaml
tasks:
  - id: deep-review
    title: Deep review
    when:
      severity: high
  - id: write-report
    title: Write report
    when: report_path
  - id: strict-review
    title: Strict review
    when:
      severity:
        in: [high]
      include_tests: true
```

| Form | Meaning |
|---|---|
| Map entry `name: value` | Equality. Matching is strict (`===`), so `true` does not equal `"true"` |
| Map entry `name: {in: [...]}` | Membership: the input value is one of the listed scalars |
| Map entry `name:` (null) or string `when: name` | The named input exists and is non-empty |
| Multiple map entries | ANDed together |

Conditional tasks whose conditions are not satisfied at `init` are stored as locked tasks and hidden from the default brief and `task list`. Run `agent-pack input set <name> <value>` to change inputs and unlock newly satisfied tasks; tasks never relock after they unlock. `agent-pack input unset <name>` clears an optional input that has no default, reverts to the default when one exists, and rejects a required input that has no default.

## Standalone task files

`--task` and `--tasks` load standalone YAML task files. Task objects use these fields: `id`, `title`, `category`, `body`, `doneWhen`, and `when`.

A standalone task file accepts exactly **one** of three shapes. Any top-level key other than `tasks` (for example `schemaVersion`, `name`, `instructions`, `references`, `skills`, `agents`) makes the file a manifest, and it is rejected as a task file.

| Shape | Description |
|---|---|
| Array of task objects | A YAML sequence of task objects |
| Single task object | One task object at the top level |
| `tasks:` wrapper | An object whose only key is `tasks`, holding an array of task objects |

A single task object:

```yaml
id: inspect
title: Inspect implementation
body: Read the changed files and record concrete findings.
doneWhen:
  - Notes cite inspected files.
```

An array of task objects:

```yaml
- id: inspect
  title: Inspect implementation
- id: summarize
  title: Summarize findings
```

A `tasks:` wrapper:

```yaml
tasks:
  - id: inspect
    title: Inspect implementation
```

## Standalone agent files

`--agent` and `--agents` load standalone YAML agent files. An agent file accepts a single agent object, an array of agent objects, or an object whose only key is `agents`.

Agent object fields: `name`, `command`, `args`, `timeoutSec`, and `maxAttempts`.

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | string | required (catalog/local files fall back to the file's base name) | Must be unique within a pack |
| `command` | string | required | A single executable; spawned directly, never through a shell |
| `args` | array of strings | `[]` | `{prompt}` is the only template placeholder |
| `timeoutSec` | positive integer | unset | Applies only to captured runs; ignored for `run --interactive` |
| `maxAttempts` | positive integer | `1` | Captured runs only; `> 1` requires `{prompt}` in `args` and cannot be combined with `--interactive` |

A single agent object:

```yaml
name: claude
command: claude
args: ["--print", "{prompt}"]
```

An array of agent objects:

```yaml
- name: claude
  command: claude
  args: ["--print", "{prompt}"]
- name: codex
  command: codex
  args: ["exec", "{prompt}"]
```

An `agents:` wrapper:

```yaml
agents:
  - name: claude
    command: claude
    args: ["--print", "{prompt}"]
```

Manifest `agents` entries follow the task pattern: string entries are refs and object entries are inline definitions. Object entries do not use `ref`.

Backend-specific flags (model, effort, and so on) go in `args`; the parser does not validate them. Model names such as `claude-opus-4-7` or `gpt-5.5` and flags such as `--effort` shown in any example are illustrative only.

```yaml
name: claude-opus
command: claude
args: ["--print", "--model", "claude-opus-4-7", "--effort", "high", "{prompt}"]
```

This file documents only the agent file fields. For the execution model (no shell, no cwd override, the `AGENT_PACK_ID` and `AGENT_PACK_STATE_DIR` environment passed to the child, captured vs interactive behavior), see [concepts.md](concepts.md).

## Complete manifest example

Save this as `reviewer-pack.yaml` and load it with `--manifest`. String entries use the same ref syntax as the corresponding CLI flag; object entries add inline task content or reference/skill metadata.

```yaml
schemaVersion: 1
name: reviewer-001
instructions: Use the included docs and skills to complete the review.

inputs:
  scope:
    required: true
    description: What should the agent inspect?
  severity:
    type: enum
    values: [low, medium, high]
    default: medium

tasks:
  - title: Check local unstaged changes
  - id: deep-review
    title: Perform a strict review
    when:
      severity: high
  - review/security
  - git+https://github.com/example/agent-packs.git//tasks/security-review.yaml#main
  - ./tasks/*.yaml

references:
  - product/api
  - name: product docs
    ref: git+https://github.com/example/product.git//docs/**/*.md#main
  - https://example.com/design-notes.md
  - name: architecture decisions
    ref: git+https://github.com/example/product.git//adr#main
  - ./docs/**/*.md

skills:
  - engineering/fresh-eyes
  - ref: git+https://github.com/example/agent-skills.git//review/fresh-eyes/SKILL.md#v1.0.0
  - ./skills

agents:
  - ./agents/claude.yaml
  - name: local-claude
    command: claude
    args: ["--print", "{prompt}"]
```

Then initialize with the manifest and a one-off prompt:

```bash
agent-pack init \
  --create-id reviewer-001 \
  --manifest ./reviewer-pack.yaml \
  --input scope="unstaged auth changes" \
  "Use the included docs and skills to complete the review."
```

Here is a second complete manifest that mixes task refs, inline tasks, references, skills, and agents:

```yaml
schemaVersion: 1
name: implementation-review
instructions: |
  Review references before starting tasks.
  Update task notes with concrete evidence.

tasks:
  - ./tasks/preflight.yaml
  - ./tasks/review/*.yaml
  - id: inspect
    title: Inspect implementation
    body: Check the implementation against the included design.
    doneWhen:
      - Notes identify files inspected.
      - Findings are recorded or the task says no issues found.

references:
  - ./docs/**/*.md
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
  - ./skills/review
agents:
  - ./agents/claude.yaml
  - name: local-claude
    command: claude
    args: ["--print", "{prompt}"]
```

## CLI flags and manifests together

CLI flags and manifests can be combined. Merge order is deterministic and source-order based:

1. `agent-pack init` reads include flags from left to right.
2. Each include contributes content to one or more typed sections: instructions, tasks, references, skills, agents, or contract.
3. The final brief still renders one section per type. Inside each section, entries keep the relative order of the sources that contributed them.
4. The positional prompt is stored as the pack-level prompt and rendered at the top of the brief. It is not part of section ordering.

Suppose this command places the ad hoc task before manifest tasks, while references and skills still render in their own sections:

```bash
agent-pack init \
  --create-id ordered-review \
  --add-task "Check local unstaged changes first" \
  --manifest git+https://github.com/example/agent-packs.git//review/base.yaml#main \
  --task ./tasks/follow-up.yaml \
  --reference git+https://github.com/example/product.git//docs/api.md#main \
  --reference ./notes.md \
  --skill git+https://github.com/example/agent-skills.git//review/fresh-eyes/SKILL.md#v1.0.0
```

The task section renders the ad hoc task, then tasks from the remote manifest, then tasks from `./tasks/follow-up.yaml`. The reference section renders references from the remote manifest before the remote API doc and `./notes.md` because the manifest appeared first among reference-contributing sources. Skills from the manifest render before the explicit remote skill for the same reason.

## Where errors surface

Manifest parsing is shallow: unsupported fields, wrong types, and malformed YAML are caught when the file is read. Some checks only run at `init`, after sources are resolved and merged:

- Input value coercion (string/enum/boolean/number) against the resolved schema.
- A `when` clause that names an undeclared input.
- Conflicting duplicate input definitions across merged manifests (same name, different definition).

## See also

- [concepts.md](concepts.md) — what a pack is and the agent execution model
- [cli.md](cli.md) — command and flag reference
- [configuration.md](configuration.md) — catalog, paths, environment, and git ref syntax
- [brief-format.md](brief-format.md) — the rendered brief and report contract
- [../README.md](../README.md) — landing page and quick start
