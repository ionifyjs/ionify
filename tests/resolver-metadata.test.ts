import { beforeEach, describe, expect, it, vi } from "vitest";

const { metaMock, parseMock } = vi.hoisted(() => ({
  metaMock: vi.fn(),
  parseMock: vi.fn(),
}));

vi.mock("@native/index", () => ({
  tryParseModuleMetadata: (...args: any[]) => metaMock(...args),
  tryParseImports: (...args: any[]) => parseMock(...args),
  native: null,
  ensureNativeGraph: () => {},
}));

import { extractImports } from "../src/core/resolver";

describe("resolver extractImports prefers native metadata", () => {
  beforeEach(() => {
    metaMock.mockReset();
    parseMock.mockReset();
    metaMock.mockReturnValue({ imports: ["./from-meta", "./another"], hash: "deadbeef" });
    parseMock.mockReturnValue(["./from-fallback"]);
  });

  it("returns imports from native metadata when available", () => {
    const deps = extractImports("// empty", "/tmp/entry.ts");
    expect(deps).toEqual(["./from-meta", "./another"]);
    expect(metaMock).toHaveBeenCalledTimes(1);
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("falls back to parseImports when metadata is unavailable", () => {
    metaMock.mockReturnValueOnce(null as any);
    const deps = extractImports("import './a';", "/tmp/entry.ts");
    expect(deps).toEqual(["./from-fallback"]);
    expect(metaMock).toHaveBeenCalled();
    expect(parseMock).toHaveBeenCalled();
  });
});
