import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { emitChunks } from "../src/core/bundler";
import { native as nativeBinding } from "../src/native/index";
import type { BuildPlan, BuildPlanChunk, BuildPlanModule } from "../src/types/plan";

describe("bundler fallback (no native)", () => {
  it("emits fallback chunk artifacts when native buildChunks is unavailable", async () => {
    const originalBuildChunks = nativeBinding?.buildChunks;
    // Force fallback path
    if (nativeBinding) {
      (nativeBinding as any).buildChunks = undefined;
    }

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ionify-fallback-"));
    const outDir = path.join(tempRoot, "dist");
    await fs.mkdir(outDir, { recursive: true });

    const entryPath = path.join(tempRoot, "entry.js");
    await fs.writeFile(entryPath, "console.log('hello');");

    const modules: BuildPlanModule[] = [
      { id: entryPath, hash: undefined, kind: "js", deps: [], dynamicDeps: [] },
    ];

    const chunk: BuildPlanChunk = {
      id: "chunk-main",
      modules,
      entry: true,
      shared: false,
      consumers: ["chunk-main"],
      css: [],
      assets: [],
    };

    const plan: BuildPlan = {
      entries: [entryPath],
      chunks: [chunk],
    };

    const moduleOutputs = new Map<string, { code: string; type: "js" | "css" | "asset" }>();
    moduleOutputs.set(entryPath, { code: "// transformed", type: "js" });

    try {
      const { artifacts } = await emitChunks(outDir, plan, moduleOutputs);
      expect(artifacts).toHaveLength(1);

      const files = artifacts[0]?.files;
      expect(files?.js.some((f) => f.endsWith("chunk-main.fallback.js"))).toBe(true);

      const jsPath = path.join(outDir, files!.js.find((f) => f.endsWith(".fallback.js"))!);
      const content = await fs.readFile(jsPath, "utf8");
      expect(content).toContain("// transformed");
      expect(content).toContain(entryPath);
    } finally {
      if (nativeBinding) {
        (nativeBinding as any).buildChunks = originalBuildChunks;
      }
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
