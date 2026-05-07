import { describe, expect, it } from "vitest";
import { parseGitRef, sanitizeGitUrl } from "../../src/core/git/ref.js";

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

  it("rejects option-looking URLs and refs", () => {
    expect(() => parseGitRef("git+--upload-pack=touch /tmp/x")).toThrow("invalid git URL");
    expect(() => parseGitRef("git+https://github.com/org/repo.git#--help")).toThrow(
      "invalid git ref",
    );
  });

  it("rejects paths that escape the repository", () => {
    expect(() => parseGitRef("git+https://github.com/org/repo.git//../secret#main")).toThrow(
      "escapes repository",
    );
  });

  it("removes credentials from persisted git URLs", () => {
    expect(sanitizeGitUrl("https://user:token@example.com/org/repo.git")).toBe(
      "https://example.com/org/repo.git",
    );
    expect(sanitizeGitUrl("git@github.com:org/repo.git")).toBe("git@github.com:org/repo.git");
  });
});
