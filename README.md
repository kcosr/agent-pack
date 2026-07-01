# agent-pack

`agent-pack` pre-packs context for coding agents: references to read, supplemental skills to apply, instructions to follow, agent launch profiles to use, and executable task lists that keep the work on track.

`agent-pack` can be used passively or actively. In passive workflows, it prepares the work, renders the agent-facing brief, and records task progress while you run your agent CLI separately. In active workflows, `agent-pack run` starts one configured agent subprocess. Captured runs store stdout and print the final pack report; interactive runs inherit your terminal and record exit metadata only.

## Why Use It

Without `agent-pack`, important context tends to be scattered across prompts, local files, repo links, and ad hoc instructions. With `agent-pack`, the user and agent share a stable brief, named references and skills, and task commands that make progress explicit.

Use it when you want to:

- pre-pack the context an agent should use before it starts work
- declare caller-provided inputs that render first in the brief and gate conditional tasks
- include specific docs, directories, globs, URLs, or git-backed references
- provide supplemental `SKILL.md` files with extracted descriptions
- hand an agent an executable task list with concrete status commands
- keep task progress, notes, blockers, and completion evidence in one place
- resume work later from committed state

## Installation

`agent-pack` is distributed as a Node CLI.

```bash
npm install -g @kcosr/agent-pack
agent-pack --help
```

Requirements:

- Node.js 20 or newer (declared in `package.json` `engines`). Node.js includes `npm`; use your package manager's equivalent if you prefer `pnpm` or `yarn`.
- Git and `tar` on `PATH` for git-backed references, skills, and agents
- Git authentication for private repositories. `agent-pack` shells out to `git`, so SSH agent, credential helper, netrc, platform keychain, GitHub CLI, or configured askpass can work.

For a manual standalone executable, install Bun and run:

```bash
npm run build:bun
./dist-bin/agent-pack --help
```

The Bun build is not part of the npm release flow. It writes a local executable
to `dist-bin/agent-pack` for manual copying. To create a standalone release
archive that includes the executable, README, usage docs, and examples:

```bash
npm run package:bun -- --platform linux-x64
```

The archive is written to `dist-release/agent-pack-VERSION-PLATFORM.tar.gz`.
Use `--platform macos-arm64`, `--platform macos-x64`, `--platform linux-arm64`,
or `--all` to build additional assets. Packaged standalone help prints resource
paths when `README.md`, `docs/usage.md`, and `examples/` are beside the
executable. Release archives also include `skills/`.

After `node scripts/release.mjs patch` creates the GitHub release, upload
standalone archives with:

```bash
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")"
npm run package:bun -- --all
gh release upload "v${VERSION}" dist-release/agent-pack-"${VERSION}"-*.tar.gz
```

`agent-pack` works with any agent CLI or editor agent that can read a text prompt and run shell commands in your workspace. The examples use POSIX shell syntax; on Windows PowerShell, use backticks for line continuations or write commands on one line, and prefer double-quoted globs such as `"./docs/**/*.md"`.

## Quick Start

Create a pack from the included demo manifest. The npm package ships an `examples/` directory; `agent-pack --help` prints its path:

```bash
EXAMPLES_DIR="$(agent-pack --help | sed -n 's/^[[:space:]]*Examples[[:space:]][[:space:]]*//p')"

agent-pack init \
  --manifest "$EXAMPLES_DIR/manifests/demo.yaml" \
  "Run the demo task and record evidence."
```

> On a standalone Bun executable copied by itself, top-level help omits resource
> paths, so `EXAMPLES_DIR` resolves empty. Use a packaged standalone archive or
> a real checkout and pass `--manifest ./examples/manifests/demo.yaml`.

Expected output:

```text
Created pack demo-a1b2c3
Run: agent-pack brief --id demo-a1b2c3
```

`init` uses `--create-id` when provided, then `AGENT_PACK_CREATE_ID` when set, and otherwise generates an id from the pack name plus a short random suffix. `--id` and `AGENT_PACK_ID` always target existing packs.

Set the generated pack id in your shell so later commands can omit `--id`, then render the brief:

```bash
export AGENT_PACK_ID=demo-a1b2c3
agent-pack brief
```

The brief is the agent-facing document, rendered in a fixed section order (inputs first when the pack declares any). The demo manifest has no inputs, so its brief opens with the prompt and shows active tasks only:

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

The sample above is illustrative; for the exact section order and per-section layout see [docs/brief-format.md](docs/brief-format.md).

In your agent CLI or editor agent, paste a handoff like this:

```text
AGENT_PACK_ID is demo-a1b2c3. Run agent-pack brief and work the pack. Update task status as you go.
```

The agent works tasks and records evidence as it goes:

```bash
agent-pack task start t001
agent-pack task note t001 "Ran date; output recorded."
agent-pack task done t001 --note "Recorded the date command and output."
```

Check progress:

```bash
agent-pack task list
agent-pack summary
agent-pack report
```

For day-to-day use, put your own reusable pack files in the catalog config directory and reference them by name:

```bash
CONFIG_DIR="$(agent-pack status --json | node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).configDir)')"
mkdir -p "$CONFIG_DIR"/{manifests,tasks,references,skills,agents}
```

```text
$CONFIG_DIR/
  manifests/review/code-review.yaml
  tasks/review/security.yaml
  references/product/api.yaml
  skills/engineering/fresh-eyes/SKILL.md
  agents/claude.yaml
```

Then run:

```bash
agent-pack init --manifest review/code-review "Review scope: unstaged changes."
```

To run an agent against a pack directly, store an agent profile and use `agent-pack run`:

```bash
agent-pack run --id demo-a1b2c3 --run-agent claude
```

See [docs/cli.md](docs/cli.md) for the full `run` surface and [docs/concepts.md](docs/concepts.md) for the run lifecycle.

## Concepts at a Glance

Each concept is explained in full in [docs/concepts.md](docs/concepts.md).

- **Pack** — The durable unit of work. A pack stores a prompt, instructions, inputs, tasks, references, skills, agents, optional contract rules, task status, notes, and agent run records. An append-only event log records every state change.
- **Brief** — The text document rendered by `agent-pack brief`, meant to be pasted into or read by an agent. It lists reference paths rather than pasting file contents and shows active tasks only.
- **Inputs** — First-class, caller-provided context declared in a manifest `inputs` map. They are resolved at `init`, rendered first in the brief, and drive conditional task activation through a task's `when` clause. Types are `string`, `enum`, `boolean`, and `number`.
- **Manifest** — A reusable YAML file that contributes instructions, inputs, tasks, references, skills, agents, and contract rules to a pack. Parsing is strict: unknown fields fail fast.
- **Prompt & Instructions** — The optional positional prompt is a one-off instruction for this pack instance; instructions are durable, reusable guidance from a manifest or a raw file. Both render near the top of the brief.
- **Tasks** — Mutable work items with auto-generated runtime IDs (`t001`, `t002`, ...) that move through `pending`, `in_progress`, `completed`, and `blocked`. Agents update task state as they work.
- **References** — Named pointers to read-only context: local files, directories, globs, HTTP/HTTPS URLs, git paths, or whole git repo snapshots.
- **Skills** — Supplemental `SKILL.md` files. `agent-pack` extracts the name, description, and readable path so the brief can tell the agent when a skill is relevant.
- **Agents** — Named subprocess launch profiles used by `agent-pack run`. An agent is a single executable plus an `args` array; `{prompt}` is the only template placeholder. They are optional — packs can be used passively.
- **Contract** — Manifest-only `do` and `dont` guidance rendered in the brief for the agent to follow.

## Documentation

| Document | What it covers | For |
|---|---|---|
| [docs/concepts.md](docs/concepts.md) | The mental model: packs, the brief, inputs, the run lifecycle, and the agent execution contract | Anyone who wants to understand how `agent-pack` works |
| [docs/cli.md](docs/cli.md) | Every command, flag, exit code, `--json` support, and mutual-exclusion error | Users running commands and scripting `agent-pack` |
| [docs/authoring.md](docs/authoring.md) | Manifest, task, and agent file schema; inputs and conditional tasks | Authors writing reusable pack files |
| [docs/configuration.md](docs/configuration.md) | Paths, environment variables, git sources, the catalog, state, and portability | Operators configuring directories, git auth, and state policy |
| [docs/brief-format.md](docs/brief-format.md) | The exact brief, summary, report, and `task show` output — the agent contract | Agents and authors who need the rendered output spec |
| [docs/usage.md](docs/usage.md) | Compact installed cheat sheet linking into the canonical docs | Installed users who want a quick reference |
| [examples/](examples/) | Ready-made catalog: 12 manifests, 4 agent files, and 2 task files | Anyone trying packaged workflows by bare catalog name |
| [skills/](skills/) | Packaged skills, including an explicit-invocation `agent-pack` skill | Agent environments that can install bundled skills |

The [examples/](examples/) directory is laid out as a catalog root. Point `AGENT_PACK_CONFIG_DIR` at it (or at a real checkout) to use the packaged manifests, agents, and tasks by bare name; see [docs/configuration.md](docs/configuration.md).
