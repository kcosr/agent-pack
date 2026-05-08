# Agent Onboarding (agent-pack)

This file is a lightweight internal onboarding note for agents working in this repo.

## Start Here

- Read `README.md` for the CLI surface and pack workflow.
- Read `docs/usage.md` for compact installed usage examples.
- Use README sections for pack state, manifest, reference, skill, and cache semantics.
- Source code lives in `src/cli/` and `src/core/`.
- Current CLI entrypoint is `src/cli/agent-pack.ts`.
- Tests live in `test/unit/`, `test/integration/`, and `test/smoke/`.
- CLI smoke tests run with `npm run test:smoke`.
- Example manifests live in `examples/`.

## Conventions

- TypeScript Node CLI.
- Keep command parsing in `src/cli/`.
- Keep pack state, manifest parsing, source resolution, git cache, and brief rendering in `src/core/`.
- Prefer explicit contracts over fallback parsing or heuristic shape detection.
- Local reference and skill paths are read in place.
- Git sources resolve to a commit and read from ignored snapshots under the cache root.
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
- Use these subsections when applicable: Breaking Changes, Added, Changed, Fixed, Removed.
- Add the needed subsection under `## [Unreleased]` if it is missing; do not create duplicate subsection headings.
- Include PR links when available.

## Release

- Run `npm run check`.
- Run `node scripts/release.mjs patch`, `minor`, or `major` from `main`.
- The release script bumps versions, promotes changelog entries, tags, pushes, creates a standard GitHub release, and opens a fresh `## [Unreleased]` section.
