# Changelog

## [Unreleased]

### Breaking Changes

- Renamed inline ad hoc task input from `--task <text>` to `--add-task <text>`.
- Changed `--task <ref>` to mean a task source ref, matching `--tasks <ref>`.

### Added

- Initial `agent-pack` CLI implementation.
- Added git ref support for `--manifest <ref>` and `--manifests <ref>`.
- Added `--manifests <ref>` as an alias for `--manifest <ref>`.
- Added `--add-task <text>` for inline ad hoc task text.

### Changed

- Treat `--task <ref>` and `--tasks <ref>` as singular/plural aliases for task source refs.
- Documented category-based merge order for manifests, instructions, task sources, ad hoc tasks, references, skills, and the positional prompt.

### Fixed

### Removed
