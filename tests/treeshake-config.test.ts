import { describe, expect, it } from "vitest";
import { resolveTreeshake, applyTreeshakeEnv } from "../src/cli/utils/treeshake";

describe("treeshake resolver", () => {
  it("uses safe mode by default", () => {
    const resolved = resolveTreeshake(undefined);
    expect(resolved.mode).toBe("safe");
    expect(resolved.include).toEqual([]);
    expect(resolved.exclude).toEqual([]);
  });

  it("respects boolean values", () => {
    expect(resolveTreeshake(false).mode).toBe("off");
    expect(resolveTreeshake(true).mode).toBe("safe");
  });

  it("merges object configuration", () => {
    const resolved = resolveTreeshake({
      mode: "aggressive",
      include: ["**/*.pure.ts"],
      exclude: ["**/*.polyfill.ts"],
    });
    expect(resolved.mode).toBe("aggressive");
    expect(resolved.include).toEqual(["**/*.pure.ts"]);
    expect(resolved.exclude).toEqual(["**/*.polyfill.ts"]);
  });

  it("supports env overrides", () => {
    const resolved = resolveTreeshake(undefined, {
      envMode: "off",
      includeEnv: JSON.stringify(["pkg/**"]),
      excludeEnv: JSON.stringify(["legacy/**"]),
    });
    expect(resolved.mode).toBe("off");
    expect(resolved.include).toEqual(["pkg/**"]);
    expect(resolved.exclude).toEqual(["legacy/**"]);
  });

  it("writes normalized env vars", () => {
    const snapshotEnv = { ...process.env };
    const resolved = { mode: "aggressive", include: ["a"], exclude: ["b"] } as const;
    applyTreeshakeEnv(resolved);
    try {
      expect(process.env.IONIFY_TREESHAKE).toBe("aggressive");
      expect(process.env.IONIFY_TREESHAKE_INCLUDE).toBe(JSON.stringify(["a"]));
      expect(process.env.IONIFY_TREESHAKE_EXCLUDE).toBe(JSON.stringify(["b"]));
    } finally {
      Object.assign(process.env, snapshotEnv);
    }
  });
});
