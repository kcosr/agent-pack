# agent-pack Usage

This page is a compact reference for installed `agent-pack` users. Start with the repository `README.md` for the full walkthrough.

## Basic Flow

Create a pack:

```bash
agent-pack init \
  --id review-pack \
  --manifest ./examples/design-review.yaml \
  --reference ./README.md \
  "Review this project and record concrete findings."
```

Print the agent brief:

```bash
agent-pack brief --id review-pack
```

Then ask an agent to run the brief and update task status as it works:

```bash
agent-pack start t001 --id review-pack
agent-pack note t001 --id review-pack "Read README and usage docs."
agent-pack done t001 --id review-pack --note "Findings recorded."
```

## Source Types

Use these flags with `agent-pack init`:

- `--manifest <ref>`: one manifest YAML file, local or git-backed
- `--add-task <text>`: one inline task
- `--task <ref>`: task YAML file, glob, or git-backed task file
- `--reference <ref>`: file, directory, glob, git path, or whole git repo
- `--skill <ref>`: one `SKILL.md` file or a glob/directory scan for `SKILL.md`
- `--instructions <path>`: raw text instructions file

Git refs use this shape:

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
.agent-pack/cache/
```

Commit `.agent-pack/state/` if you want pack progress to travel with the repository. Ignore `.agent-pack/cache/`, `.agent-pack/locks/`, and `.agent-pack/tmp/`.

On a new host, rebuild git-backed material:

```bash
agent-pack sync --id review-pack
agent-pack brief --id review-pack
```
