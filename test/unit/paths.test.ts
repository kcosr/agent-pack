import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveRuntimePaths } from "../../src/core/paths.js";

describe("resolveRuntimePaths", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults cache material to XDG cache home", () => {
    vi.stubEnv("AGENT_PACK_CACHE_DIR", undefined);
    vi.stubEnv("XDG_CACHE_HOME", "/tmp/xdg-cache");
    vi.stubEnv("HOME", "/home/tester");

    const paths = resolveRuntimePaths({ cwd: "/repo" });

    expect(paths.stateDir).toBe(path.resolve("/repo/.agent-pack/state"));
    expect(paths.cacheDir).toBe(path.resolve("/tmp/xdg-cache/agent-pack"));
    expect(paths.gitCacheDir).toBe(path.resolve("/tmp/xdg-cache/agent-pack/git"));
    expect(paths.lockDir).toBe(path.resolve("/tmp/xdg-cache/agent-pack/locks"));
  });

  it("falls back to the home cache directory", () => {
    vi.stubEnv("AGENT_PACK_CACHE_DIR", undefined);
    vi.stubEnv("XDG_CACHE_HOME", undefined);
    vi.stubEnv("HOME", "/home/tester");

    const paths = resolveRuntimePaths({ cwd: "/repo" });

    expect(paths.cacheDir).toBe(path.resolve("/home/tester/.cache/agent-pack"));
    expect(paths.gitCacheDir).toBe(path.resolve("/home/tester/.cache/agent-pack/git"));
    expect(paths.lockDir).toBe(path.resolve("/home/tester/.cache/agent-pack/locks"));
  });

  it("keeps explicit cache overrides rooted at the current working directory", () => {
    vi.stubEnv("AGENT_PACK_CACHE_DIR", "local-cache");
    vi.stubEnv("XDG_CACHE_HOME", "/tmp/xdg-cache");

    const paths = resolveRuntimePaths({ cwd: "/repo" });

    expect(paths.cacheDir).toBe(path.resolve("/repo/local-cache"));
    expect(paths.gitCacheDir).toBe(path.resolve("/repo/local-cache/git"));
    expect(paths.lockDir).toBe(path.resolve("/repo/local-cache/locks"));
  });
});
