import fs from "fs";
import os from "os";
import path from "path";
import { expect, test } from "vitest";
import { BuildAnalyzer } from "../src/core/analyzer";
import { BuildChunkArtifact } from "../src/core/types/plan";

test("build analyzer collects stats", () => {
  const analyzer = new BuildAnalyzer();

  const testChunk: BuildChunkArtifact = {
    id: "test-chunk",
    fileName: "test.js",
    code: "console.log('test');",
    code_bytes: 20,
    map_bytes: 10,
    assets: [{ source: "test.png", fileName: "test.123.png" }],
  };

  analyzer.recordChunk(testChunk, true, false);
  analyzer.recordCacheEvent(true);
  analyzer.recordCacheEvent(false);
  analyzer.recordCacheEvent(true);

  const stats = analyzer.finalize();

  expect(stats.chunks.total).toBe(1);
  expect(stats.chunks.entry).toBe(1);
  expect(stats.chunks.shared).toBe(0);

  expect(stats.cacheHits).toBe(2);
  expect(stats.cacheMisses).toBe(1);
  expect(analyzer.getCacheEfficiency()).toBeCloseTo(66.66666666666666);

  const chunkStats = analyzer.getChunkStats();
  expect(chunkStats.length).toBe(1);
  expect(chunkStats[0].id).toBe("test-chunk");
  expect(chunkStats[0].assets).toBe(1);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-analyzer-test-"));
  try {
    fs.writeFileSync(path.join(tempDir, "build.stats.json"), JSON.stringify(stats, null, 2));

    const written = JSON.parse(
      fs.readFileSync(path.join(tempDir, "build.stats.json"), "utf8")
    );

    expect(written.chunks.total).toBe(1);
    expect(written.cacheHits).toBe(2);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
