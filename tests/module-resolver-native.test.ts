import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveModuleMock = vi.fn();

vi.mock("@native/index", () => ({
  native: {
    resolveModule: (...args: any[]) => resolveModuleMock(...args),
  },
}));

import { ModuleResolver } from "../src/core/resolver/module-resolver";

describe("ModuleResolver native integration", () => {
  beforeEach(() => {
    resolveModuleMock.mockReset();
  });

  it("resolves pkg_esm directly", () => {
    resolveModuleMock.mockReturnValue({
      kind: "PkgEsm",
      fsPath: "/tmp/react/index.js",
      id: "react",
      pkg: { name: "react" },
    });

    const resolver = new ModuleResolver("/root");
    const resolved = resolver.resolve("react", "/root/src/app.ts");
    expect(resolved).toBe("/tmp/react/index.js");
    expect(resolver.getMetadata("/tmp/react/index.js")).toBeUndefined();
  });

  it("flags pkg_cjs without conversion", () => {
    resolveModuleMock.mockReturnValue({
      kind: "PkgCjs",
      fsPath: "/tmp/react-dom/index.cjs",
      id: "react-dom",
      pkg: { name: "react-dom" },
    });

    const resolver = new ModuleResolver("/root");
    const resolved = resolver.resolve("react-dom", "/root/src/app.ts");
    expect(resolved).toBe("/tmp/react-dom/index.cjs");
    expect(resolver.getMetadata(resolved!)).toEqual({
      format: "cjs",
      needsInterop: true,
    });
  });
});
