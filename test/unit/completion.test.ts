import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type Argument, Command, type Option } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureProgram } from "../../src/cli/agent-pack.js";
import {
  completionCandidates,
  configureInputCompletion,
  hasCatalogCompletionSource,
  inputNameArgument,
  inputValueArgument,
} from "../../src/cli/completion.js";

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

    const catalogRefArguments = allArguments(root).filter((argument) =>
      argument.description.startsWith("catalog, local"),
    );
    expect(catalogRefArguments.map((argument) => argument.description).sort()).toEqual([
      "catalog, local, URL, or git reference",
      "catalog, local, or git skill",
    ]);
    expect(catalogRefArguments.every(hasCatalogCompletionSource)).toBe(true);
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

  it.each([
    ["reference", "review/api\n"],
    ["skill", "review/fresh-eyes\n"],
  ])("resolves catalog candidates for %s add", async (command, expected) => {
    await expect(
      completionCandidates(configureProgram(), "review/", [command, "add"]),
    ).resolves.toBe(expected);
  });

  it("resolves input key and value candidates", async () => {
    configureInputCompletion({
      names: async () => ["scope", "severity", "include_tests"],
      values: async (name) => {
        if (name === "severity") {
          return ["low", "medium", "high"];
        }
        if (name === "include_tests") {
          return ["true", "false"];
        }
        return [];
      },
    });
    const root = inputCompletionProgram();

    await expect(completionCandidates(root, "se", ["input", "get"])).resolves.toBe("severity\n");
    await expect(completionCandidates(root, "h", ["input", "set", "severity"])).resolves.toBe(
      "high\n",
    );
    await expect(completionCandidates(root, "f", ["input", "set", "include_tests"])).resolves.toBe(
      "false\n",
    );
  });

  it("silently omits dynamic input candidates when pack state cannot load", async () => {
    configureInputCompletion({
      names: async () => {
        throw new Error("no pack");
      },
      values: async () => {
        throw new Error("no pack");
      },
    });
    const root = inputCompletionProgram();

    await expect(completionCandidates(root, "", ["input", "get"])).resolves.toBe("");
    await expect(completionCandidates(root, "", ["input", "set", "severity"])).resolves.toBe("");
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

function inputCompletionProgram(): Command {
  const root = new Command();
  const input = root.command("input");
  input.command("get").addArgument(inputNameArgument("<name>", "input name"));
  input
    .command("set")
    .addArgument(inputNameArgument("<name>", "input name"))
    .addArgument(inputValueArgument("<value>", "input value", 0));
  return root;
}
