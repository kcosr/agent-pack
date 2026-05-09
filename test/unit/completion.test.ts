import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Argument, Command, Option } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureProgram } from "../../src/cli/agent-pack.js";
import { completionCandidates, hasCatalogCompletionSource } from "../../src/cli/completion.js";

describe("shell completion", () => {
  let configDir: string;

  beforeEach(async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "agent-pack-completion-unit-"));
    configDir = path.join(workspace, "config");
    await mkdir(path.join(configDir, "manifests/review"), { recursive: true });
    await mkdir(path.join(configDir, "tasks/review"), { recursive: true });
    await mkdir(path.join(configDir, "references/review"), { recursive: true });
    await mkdir(path.join(configDir, "skills/review/fresh-eyes"), { recursive: true });
    await writeFile(path.join(configDir, "manifests/review/code-review.yaml"), "tasks: []\n");
    await writeFile(path.join(configDir, "tasks/review/security.yaml"), "title: Security\n");
    await writeFile(path.join(configDir, "references/review/api.yaml"), "ref: ./docs/api.md\n");
    await writeFile(
      path.join(configDir, "skills/review/fresh-eyes/SKILL.md"),
      "---\nname: fresh-eyes\ndescription: Review skill\n---\n",
    );
    vi.stubEnv("AGENT_PACK_CONFIG_DIR", configDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps catalog-backed completion metadata attached to the command tree", () => {
    const root = configureProgram();

    const catalogOptions = allOptions(root).filter(
      (option) => option.description.includes("catalog") && !option.argChoices,
    );
    expect(catalogOptions.map((option) => option.long).sort()).toEqual([
      "--manifest",
      "--manifests",
      "--reference",
      "--references",
      "--skill",
      "--skills",
      "--task",
      "--tasks",
    ]);
    expect(catalogOptions.every(hasCatalogCompletionSource)).toBe(true);

    const catalogNameArguments = allArguments(root).filter(
      (argument) => argument.description === "catalog name",
    );
    expect(catalogNameArguments).toHaveLength(2);
    expect(catalogNameArguments.every(hasCatalogCompletionSource)).toBe(true);
  });

  it.each([
    ["--manifest", "review/code-review\n"],
    ["--manifests", "review/code-review\n"],
    ["--task", "review/security\n"],
    ["--tasks", "review/security\n"],
    ["--reference", "review/api\n"],
    ["--references", "review/api\n"],
    ["--skill", "review/fresh-eyes\n"],
    ["--skills", "review/fresh-eyes\n"],
  ])("resolves catalog candidates for init %s", async (flag, expected) => {
    await expect(completionCandidates(configureProgram(), "review/", ["init", flag])).resolves.toBe(
      expected,
    );
  });

  it("resolves catalog names from the preceding catalog type operand", async () => {
    await expect(
      completionCandidates(configureProgram(), "review/", ["catalog", "show", "manifest"]),
    ).resolves.toBe("review/code-review\n");
  });
});

function allOptions(command: Command): Option[] {
  return [command, ...allSubcommands(command)].flatMap((candidate) => candidate.options);
}

function allArguments(command: Command): Argument[] {
  return [command, ...allSubcommands(command)].flatMap(
    (candidate) => candidate.registeredArguments,
  );
}

function allSubcommands(command: Command): Command[] {
  return command.commands.flatMap((child) => [child, ...allSubcommands(child)]);
}
