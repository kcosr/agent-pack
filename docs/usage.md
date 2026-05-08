# agent-pack Usage

This page is a compact reference for installed `agent-pack` users. Start with the repository `README.md` for the full walkthrough.

Run commands from the repository or workspace that contains the files you want the agent to inspect.

Requirements:

- Node.js 20 or newer
- Git and `tar` on `PATH` for git-backed inputs

## Quick Start

Create a pack from the demo manifest:

```bash
agent-pack init \
  --manifest ./examples/demo.yaml \
  "Run the demo task and record the result."
```

Set the generated pack id before asking an agent to work:

```bash
export AGENT_PACK_ID=demo
agent-pack brief
```

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
agent-pack task start t001
agent-pack task note t001 "date output: Thu May 7 ..."
agent-pack task done t001 --note "Recorded date output."
agent-pack report
```

`task show` and `report` print text for humans and agents by default. Use `task show <task-id> --json` or `report --json` for scripts that need saved state objects.

## Source Types

Use these flags with `agent-pack init`:

- `--manifest <ref>`: one catalog, local, or git-backed manifest YAML file
- `--add-task <text>`: one inline task
- `--task <ref>`: catalog task, local task YAML file, glob, or git-backed task file
- `--reference <ref>`: catalog reference, local file, directory, glob, HTTP/HTTPS URL, git path, or whole git repo
- `--skill <ref>`: catalog skill, local `SKILL.md` file, directory scan, glob, or git-backed skill source
- `--instructions <path>`: raw text instructions file

Manifest `tasks`, `references`, and `skills` arrays can use the same refs as these CLI flags:

```yaml
tasks:
  - review/security
  - ./tasks/*.yaml
  - id: inline-check
    title: Check local state
references:
  - product/api
  - ./docs/**/*.md
skills:
  - engineering/fresh-eyes
  - ./skills
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

Inspect catalog entries:

```bash
agent-pack catalog list
agent-pack catalog show manifest review/code-review
agent-pack catalog path skill engineering/fresh-eyes
```

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
