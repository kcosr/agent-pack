---
name: agent-pack
description: Use only when explicitly requested to run or follow an agent-pack workflow, pack, catalog manifest, brief, or task list. Helps an agent execute an existing agent-pack catalog workflow, read the generated brief, and update task status while working through the pack.
---

# Agent Pack

Use `agent-pack` to run an existing workflow from a catalog manifest and work through the generated brief. Do not author new manifests unless the user explicitly asks for that; normally the user provides a command like `agent-pack init --manifest <pack> ...` or names the pack to run.

## Basic Flow

If the user provides an exact command, run it. Otherwise use the named catalog manifest:

```bash
agent-pack init --manifest <pack> "User's requested work scope."
```

After `init`, run the brief command printed by the CLI, usually:

```bash
agent-pack brief --id <pack-id>
```

Follow the brief. Keep task state current as work proceeds:

```bash
agent-pack task list --id <pack-id>
agent-pack task show <task-id> --id <pack-id>
agent-pack task start <task-id> --id <pack-id> --note "Started."
agent-pack task note <task-id> --id <pack-id> "Evidence or decision."
agent-pack task done <task-id> --id <pack-id> --note "Completion evidence."
agent-pack task block <task-id> --id <pack-id> --note "Specific blocker."
```

Use `task show` before working a task when the brief is compact or the task details matter. Use `task note` for evidence that should survive context loss. Mark a task `blocked` only when progress really requires user input or external change.

## Useful Discovery

To see where `agent-pack` is reading config and state:

```bash
agent-pack status
agent-pack status --json
```

To get the current config/catalog directory:

```bash
CONFIG_DIR="$(agent-pack status --json | node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).configDir)')"
```

To inspect available workflows:

```bash
agent-pack catalog list --type manifest
agent-pack catalog show manifest <name>
```

If packaged examples are configured as the catalog, these manifests may be available:

- `architecture-review`
- `bug-investigation`
- `code-review`
- `codebase-onboarding`
- `demo`
- `dependency-audit`
- `design-review`
- `docs-review`
- `feature-design-summary`
- `refactor-execution`
- `security-review`
- `testing-audit`

Treat that list as a convenience hint, not a source of truth. Always prefer `agent-pack catalog list --type manifest` for the actual configured environment.

If packaged examples are present beside the installed package or standalone archive, `agent-pack --help` prints their path. To use those examples by bare catalog name for one command:

```bash
EXAMPLES_DIR="$(agent-pack --help | sed -n 's/^[[:space:]]*Examples[[:space:]][[:space:]]*//p')"
AGENT_PACK_CONFIG_DIR="$EXAMPLES_DIR" agent-pack catalog list --type manifest
```
