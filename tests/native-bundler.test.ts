import fs from "fs/promises";
import os from "os";
import path from "path";
import { expect, test } from "vitest";
import {
  emitChunksFromArtifacts,
  writeAssetsManifest,
  writeBuildManifest,
} from "../src/core/bundler";
import type { BuildPlan, BuildPlanChunk, BuildPlanModule } from "../src/types/plan";

test("native bundler emits artifacts and manifests", async () => {
  const prevSourceMaps = process.env.IONIFY_SOURCEMAPS;
  process.env.IONIFY_SOURCEMAPS = "true";

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ionify-native-test-"));
  const workDir = path.join(tempRoot, "workspace");
  const outDir = path.join(tempRoot, "dist");

  await fs.mkdir(workDir, { recursive: true });
  await fs.mkdir(outDir, { recursive: true });

  const entryJs = path.join(workDir, "entry.js");
  const cssPath = path.join(workDir, "styles.css");
  const assetPath = path.join(workDir, "logo.png");

  await fs.writeFile(entryJs, "console.log('entry');\n");
  await fs.writeFile(cssPath, "body{color:red;}");
  await fs.writeFile(assetPath, Buffer.from([0, 1, 2, 3, 4]));

  const modules: BuildPlanModule[] = [
    { id: entryJs, hash: "hash-entry", kind: "js", deps: [], dynamicDeps: [] },
    { id: cssPath, hash: undefined, kind: "css", deps: [], dynamicDeps: [] },
    { id: assetPath, hash: undefined, kind: "asset", deps: [], dynamicDeps: [] },
  ];

  const chunk: BuildPlanChunk = {
    id: "chunk-entry",
    modules,
    entry: true,
    shared: false,
    consumers: ["chunk-entry"],
    css: [cssPath],
    assets: [assetPath],
  };

  const plan: BuildPlan = {
    entries: [entryJs],
    chunks: [chunk],
  };

  const moduleOutputs = new Map<string, { code: string; type: "js" | "css" | "asset" }>();
  moduleOutputs.set(cssPath, { code: "body{color:red;}", type: "css" });

  const nativeArtifacts = [
    {
      id: "chunk-entry",
      file_name: "chunk-entry.native.js",
      code: "console.log('entry chunk');",
      map: '{"version":3,"mappings":""}',
      code_bytes: 25,
      map_bytes: 30,
      assets: [{ source: assetPath, file_name: "logo.1234.png" }],
    },
    {
      id: "chunk-entry::dyn1",
      file_name: "chunk-entry.dyn1.native.js",
      code: "console.log('dynamic');",
      map: null,
      code_bytes: 24,
      map_bytes: 0,
      assets: [],
    },
  ];

  try {
    const { artifacts, stats } = await emitChunksFromArtifacts(outDir, plan, moduleOutputs, nativeArtifacts);

    expect(artifacts).toHaveLength(1);
    const files = artifacts[0]?.files;
    expect(files?.js.some((file) => file.endsWith("chunks/chunk-entry/chunk-entry.native.js"))).toBe(true);
    expect(files?.js.some((file) => file.endsWith("chunks/chunk-entry/chunk-entry.dyn1.native.js"))).toBe(true);
    expect(files?.assets.some((file) => file.endsWith("chunks/chunk-entry/logo.1234.png"))).toBe(true);
    expect(files?.css.length).toBe(1);

    const mainJsPath = path.join(outDir, "chunks", "chunk-entry", "chunk-entry.native.js");
    const jsContent = await fs.readFile(mainJsPath, "utf8");
    expect(jsContent).toContain("//# sourceMappingURL=chunk-entry.native.js.map");

    const cssFilePath = path.join(outDir, files!.css[0]);
    const cssContent = await fs.readFile(cssFilePath, "utf8");
    expect(cssContent).toContain("body{color:red;}");

    await writeBuildManifest(outDir, plan, artifacts);
    const manifest = JSON.parse(await fs.readFile(path.join(outDir, "manifest.json"), "utf8"));
    expect(Array.isArray(manifest.chunks)).toBe(true);
    expect(manifest.chunks).toHaveLength(1);
    expect(manifest.chunks[0].files.js).toContain("chunks/chunk-entry/chunk-entry.native.js");

    await writeAssetsManifest(outDir, artifacts);
    const assetsManifest = JSON.parse(await fs.readFile(path.join(outDir, "manifest.assets.json"), "utf8"));
    expect(Array.isArray(assetsManifest.chunks)).toBe(true);

    const statsPath = path.join(outDir, "build.stats.json");
    await fs.writeFile(statsPath, JSON.stringify(stats, null, 2));
    const statsJson = JSON.parse(await fs.readFile(statsPath, "utf8"));
    const jsStatKey = Object.keys(statsJson).find((key) => key.endsWith("chunk-entry.native.js"));
    expect(jsStatKey).toBeDefined();
  } finally {
    process.env.IONIFY_SOURCEMAPS = prevSourceMaps;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
