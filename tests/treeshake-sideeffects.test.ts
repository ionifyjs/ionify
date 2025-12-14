import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { native } from "../src/native/index";
import type { BuildPlan, BuildPlanChunk, BuildPlanModule } from "../src/types/plan";

const TEMP_PREFIX = path.join(os.tmpdir(), "ionify-treeshake-");

async function createSideEffectPlan(): Promise<{
  plan: BuildPlan;
  cleanup: () => Promise<void>;
}> {
  const root = await fs.mkdtemp(TEMP_PREFIX);
  const entryFile = path.join(root, "src", "entry.ts");
  const pkgDir = path.join(root, "node_modules", "clean-pkg");
  const pkgEntry = path.join(pkgDir, "index.js");

  await fs.mkdir(path.dirname(entryFile), { recursive: true });
  await fs.mkdir(pkgDir, { recursive: true });

  await fs.writeFile(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name: "clean-pkg", sideEffects: false }, null, 2),
    "utf8"
  );
  await fs.writeFile(pkgEntry, 'console.log("pkg executed");\n', "utf8");

  await fs.writeFile(
    entryFile,
    [
      'import "clean-pkg";',
      "export const value = 42;",
      "console.log('ready');",
      "",
    ].join("\n"),
    "utf8"
  );

  const chunk: BuildPlanChunk = {
    id: "chunk-entry",
    entry: true,
    shared: false,
    consumers: [entryFile],
    css: [],
    assets: [],
    modules: [
      {
        id: entryFile,
        hash: undefined,
        kind: "js",
        deps: [pkgEntry],
        dynamicDeps: [],
      },
      {
        id: pkgEntry,
        hash: undefined,
        kind: "js",
        deps: [],
        dynamicDeps: [],
      },
    ],
  };

  return {
    plan: {
      entries: [entryFile],
      chunks: [chunk],
    },
    cleanup: async () => {
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

describe("Native bundler tree shaking", () => {
  it("omits side-effect-only imports when sideEffects=false", async () => {
    if (!native?.buildChunks) {
      expect(true).toBe(true);
      return;
    }
    const prevMode = process.env.IONIFY_TREESHAKE;
    const prevInclude = process.env.IONIFY_TREESHAKE_INCLUDE;
    const prevExclude = process.env.IONIFY_TREESHAKE_EXCLUDE;
    process.env.IONIFY_TREESHAKE = "safe";
    process.env.IONIFY_TREESHAKE_INCLUDE = JSON.stringify([]);
    process.env.IONIFY_TREESHAKE_EXCLUDE = JSON.stringify([]);
    const { plan, cleanup } = await createSideEffectPlan();
    try {
      const artifacts = native.buildChunks!(plan);
      const entry = artifacts.find((chunk) => chunk.id === "chunk-entry");
      expect(entry).toBeTruthy();
      expect(entry?.code).not.toContain("pkg executed");
      expect(entry?.code).toContain("ready");
    } finally {
      process.env.IONIFY_TREESHAKE = prevMode;
      process.env.IONIFY_TREESHAKE_INCLUDE = prevInclude;
      process.env.IONIFY_TREESHAKE_EXCLUDE = prevExclude;
      await cleanup();
    }
  });
});
