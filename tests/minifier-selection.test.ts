import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, it, expect } from "vitest";
import { native } from "../src/native/index";
import type { BuildPlan, BuildPlanChunk, BuildPlanModule } from "../src/types/plan";

describe("Minifier selection (native bundler)", () => {
  it("builds a simple chunk with SWC and oxc (if native available)", async () => {
    if (!native?.buildChunks) {
      // Native binding not available in this environment; skip gracefully
      expect(true).toBe(true);
      return;
    }

    const prevMaps = process.env.IONIFY_SOURCEMAPS;
    const prevMinifier = process.env.IONIFY_MINIFIER;

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ionify-minifier-test-"));
    try {
      const entryJs = path.join(tempRoot, "entry.js");
      await fs.writeFile(entryJs, "function plus(a,b){return a+b}; console.log(plus(1,2));\n");

      const modules: BuildPlanModule[] = [
        { id: entryJs, hash: undefined, kind: "js", deps: [], dynamicDeps: [] },
      ];

      const chunk: BuildPlanChunk = {
        id: "chunk-entry",
        entry: true,
        shared: false,
        consumers: [entryJs],
        css: [],
        assets: [],
        modules,
      };

      const plan: BuildPlan = {
        entries: [entryJs],
        chunks: [chunk],
      };

      process.env.IONIFY_SOURCEMAPS = "false";

      // SWC path
      process.env.IONIFY_MINIFIER = "swc";
      const swcArtifacts = native.buildChunks!(plan);
      expect(Array.isArray(swcArtifacts)).toBe(true);
      expect(swcArtifacts.length).toBeGreaterThan(0);
      expect(typeof swcArtifacts[0].code).toBe("string");
      expect(swcArtifacts[0].code.length).toBeGreaterThan(0);

      // oxc path (may fall back internally if feature not enabled)
      process.env.IONIFY_MINIFIER = "oxc";
      const oxcArtifacts = native.buildChunks!(plan);
      expect(Array.isArray(oxcArtifacts)).toBe(true);
      expect(oxcArtifacts.length).toBeGreaterThan(0);
      expect(typeof oxcArtifacts[0].code).toBe("string");
      expect(oxcArtifacts[0].code.length).toBeGreaterThan(0);
    } finally {
      process.env.IONIFY_SOURCEMAPS = prevMaps;
      process.env.IONIFY_MINIFIER = prevMinifier;
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
