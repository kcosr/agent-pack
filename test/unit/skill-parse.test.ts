import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractSkillMetadata } from "../../src/core/skills/parse.js";

describe("extractSkillMetadata", () => {
  it("uses frontmatter name and description", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agent-pack-skill-"));
    const skillPath = path.join(dir, "SKILL.md");
    await writeFile(
      skillPath,
      "---\nname: reviewer\ndescription: Review code carefully.\n---\n# Other\n",
    );

    await expect(extractSkillMetadata(skillPath)).resolves.toEqual({
      name: "reviewer",
      description: "Review code carefully.",
    });
  });

  it("falls back to heading and first paragraph", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agent-pack-skill-"));
    const skillPath = path.join(dir, "SKILL.md");
    await writeFile(skillPath, "# Fresh Eyes\n\nRead changed code again.");

    await expect(extractSkillMetadata(skillPath)).resolves.toEqual({
      name: "Fresh Eyes",
      description: "Read changed code again.",
    });
  });
});
