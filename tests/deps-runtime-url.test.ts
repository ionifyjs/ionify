import { describe, expect, it } from "vitest";
import { depsFileNameFromRuntimeUrl, formatDepsRuntimeUrl } from "../src/core/deps/runtime-url";

describe("dependency runtime URL generation", () => {
  it("separates identical logical wrapper names across DPL store generations", () => {
    const fileName = "react-router@6.30.6__dist_73122b.js";
    const npmUrl = formatDepsRuntimeUrl(fileName, "11d6f0d174eb224e");
    const pnpmUrl = formatDepsRuntimeUrl(fileName, "98bbeecdeecacbce");

    expect(npmUrl).toBe(`/@deps/${fileName}?v=11d6f0d174eb224e`);
    expect(pnpmUrl).toBe(`/@deps/${fileName}?v=98bbeecdeecacbce`);
    expect(npmUrl).not.toBe(pnpmUrl);
    expect(depsFileNameFromRuntimeUrl(npmUrl)).toBe(fileName);
  });

  it("keeps chunk routing and store generation in one canonical URL", () => {
    expect(formatDepsRuntimeUrl("react.js", "deadbeefdeadbeef", "sc123")).toBe(
      "/@deps/react.js?v=deadbeefdeadbeef&cg=sc123",
    );
  });
});
