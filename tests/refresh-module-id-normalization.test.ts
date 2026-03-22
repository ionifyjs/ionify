import { describe, it, expect } from "vitest";
import { normalizeRefreshModuleId } from "../src/client/react-refresh-runtime.js";

describe("normalizeRefreshModuleId", () => {
  it("strips ?ionify-hmr from absolute URLs", () => {
    expect(
      normalizeRefreshModuleId("http://localhost:5173/src/Counter.tsx?ionify-hmr=123"),
    ).toBe("http://localhost:5173/src/Counter.tsx");
  });

  it("strips unrelated query params too", () => {
    expect(
      normalizeRefreshModuleId("http://localhost:5173/src/Counter.tsx?x=1"),
    ).toBe("http://localhost:5173/src/Counter.tsx");
  });

  it("strips search but preserves hash", () => {
    expect(
      normalizeRefreshModuleId(
        "http://localhost:5173/src/Counter.tsx?ionify-hmr=123&x=1#frag",
      ),
    ).toBe("http://localhost:5173/src/Counter.tsx#frag");
  });

  it("handles relative URLs", () => {
    expect(normalizeRefreshModuleId("/src/Counter.tsx?x=1")).toBe("/src/Counter.tsx");
  });
});
