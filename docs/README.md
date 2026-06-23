# agent-pack Documentation

This directory is the reference documentation for `agent-pack`. Start with [concepts.md](./concepts.md) for the mental model, or jump to the page for your task below. For the project landing page, install instructions, and quick start, see [../README.md](../README.md).

## Documentation map

| Document | What it covers | For |
|---|---|---|
| [concepts.md](./concepts.md) | The mental model: packs, the brief, inputs, the run lifecycle, and the agent execution contract | Anyone who wants to understand how `agent-pack` works |
| [cli.md](./cli.md) | Every command, flag, exit code, `--json` support, and mutual-exclusion error | Users running commands and scripting `agent-pack` |
| [authoring.md](./authoring.md) | Manifest, task, and agent file schema; inputs and conditional tasks | Authors writing reusable pack files |
| [configuration.md](./configuration.md) | Paths, environment variables, git sources, the catalog, state, and portability | Operators configuring directories, git auth, and state policy |
| [brief-format.md](./brief-format.md) | The exact brief, summary, report, and `task show` output — the agent contract | Agents and authors who need the rendered output spec |
| [usage.md](./usage.md) | Compact installed cheat sheet linking into the canonical docs | Installed users who want a quick reference |

The [../examples/](../examples/) directory is a ready-made catalog root (12 manifests, 4 agent files, 2 task files). Point `AGENT_PACK_CONFIG_DIR` at it to use the packaged workflows by bare catalog name; see [configuration.md](./configuration.md).

## Note on `docs/design/`

The `docs/design/` directory held internal design specifications and is not part of the user documentation. It is being removed; do not link to any `docs/design/` path.
