# Changelog

## [0.1.2] - 2026-05-09

### Breaking Changes

### Added

### Changed

### Fixed

- Fixed zsh completion at the top-level command position ([#4](https://github.com/kcosr/agent-pack/pull/4)).

### Removed

## [0.1.1] - 2026-05-09

### Breaking Changes

- Regenerate saved shell completion files after upgrading; the hidden completion
  helper signature changed and older generated scripts will not match the new
  helper contract ([#3](https://github.com/kcosr/agent-pack/pull/3)).

### Added

- Added `agent-pack task add <title>` for appending ad hoc tasks to existing packs ([#2](https://github.com/kcosr/agent-pack/pull/2)).
- Added a bundled `feature-design-summary` example manifest for creating a
  repository-grounded feature design summary markdown file ([#2](https://github.com/kcosr/agent-pack/pull/2)).
- Added shell completion candidates for command names, subcommands, option names,
  known enum values, and completion shell names ([#3](https://github.com/kcosr/agent-pack/pull/3)).

### Changed

- Changed completion setup instructions to recommend generating a static
  completion file for permanent shell startup setup ([#3](https://github.com/kcosr/agent-pack/pull/3)).
- Changed shell completion to suggest active command options when no app-known
  positional completions are available ([#3](https://github.com/kcosr/agent-pack/pull/3)).

### Fixed

### Removed

## [0.1.0] - 2026-05-08

### Added

- Initial `agent-pack` CLI implementation, including durable pack state, brief rendering, compact task briefs, task progress commands, local and git-backed inputs, cache cleaning, packaged examples, and release tooling.
- Catalog refs and `agent-pack catalog list|show|path` for reusable manifests, tasks, references, and skills under the config directory.
- Manifest string refs for tasks, references, and skills, matching the CLI ref semantics.
- Generated pack IDs when neither `--id` nor `AGENT_PACK_ID` is provided.
- Shell completion scripts for catalog-backed manifest, task, reference, and skill refs.

### Changed

- `agent-pack status` now reports system paths and defaults; pack progress moved to `agent-pack summary`, which now supports `--json`.
- GitHub releases created by the release script are standard releases instead of prereleases.

### Fixed

- Hardened git path validation, catalog read errors, manifest include metadata validation, and skill frontmatter parsing.
- Improved catalog skill listing, skill-source errors, task count validation, and test isolation around agent-pack environment variables.
