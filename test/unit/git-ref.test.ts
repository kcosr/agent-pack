import { describe, expect, it } from "vitest";
import { parseGitRef } from "../../src/core/git/ref.js";

describe("parseGitRef", () => {
  it("parses https refs with repo paths and branches", () => {
    expect(parseGitRef("git+https://github.com/org/repo.git//docs/**/*.md#main")).toEqual({
      url: "https://github.com/org/repo.git",
      pathInRepo: "docs/**/*.md",
      requestedRef: "main",
    });
  });

  it("parses scp-like ssh refs", () => {
    expect(parseGitRef("git+git@github.com:org/repo.git//skills/foo/SKILL.md#v1")).toEqual({
      url: "git@github.com:org/repo.git",
      pathInRepo: "skills/foo/SKILL.md",
      requestedRef: "v1",
    });
  });

  it("allows whole repo refs without explicit branch", () => {
    expect(parseGitRef("git+https://github.com/org/repo.git")).toEqual({
      url: "https://github.com/org/repo.git",
      requestedRef: undefined,
    });
  });
});
