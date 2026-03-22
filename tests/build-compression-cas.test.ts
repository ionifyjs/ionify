import fs from "fs/promises";
import os from "os";
import path from "path";
import { expect, test } from "vitest";
import { precompressBuildOutputs } from "../src/cli/commands/build";
import { getCacheKey } from "../src/core/cache";
import { getCompressionCasArtifactPath } from "../src/core/utils/cas";

test("Phase 18: precompressBuildOutputs restores sidecars from compression CAS by final output hash", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ionify-compress-cas-"));
  const outDir = path.join(tmp, "dist");
  const casRoot = path.join(tmp, ".ionify", "cas");
  const sourceCode = `export default "${"ionify-phase-18-".repeat(512)}";`;
  const sourceHash = getCacheKey(sourceCode);
  const sourceFile = path.join(outDir, "main.js");

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(sourceFile, sourceCode, "utf8");

  try {
    const first = await precompressBuildOutputs(outDir, {
      casRoot,
      thresholdBytes: 0,
      gzipLevel: 9,
      brotliQuality: 11,
      emitManifest: false,
      concurrency: 2,
      outputHashHints: new Map([["main.js", sourceHash]]),
    });

    expect(first.totals.casHits).toBe(0);
    expect(first.totals.casMisses).toBe(2);
    expect(first.totals.sidecarsCompressed).toBe(2);

    const compressionCasDir = getCompressionCasArtifactPath(casRoot, sourceHash, {
      brotliQuality: 11,
      gzipLevel: 9,
    });
    await expect(fs.stat(path.join(compressionCasDir, "sidecar.br"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(compressionCasDir, "sidecar.gz"))).resolves.toBeTruthy();

    await fs.unlink(`${sourceFile}.br`);
    await fs.unlink(`${sourceFile}.gz`);

    const second = await precompressBuildOutputs(outDir, {
      casRoot,
      thresholdBytes: 0,
      gzipLevel: 9,
      brotliQuality: 11,
      emitManifest: false,
      concurrency: 2,
      outputHashHints: new Map([["main.js", sourceHash]]),
    });

    expect(second.totals.casHits).toBe(2);
    expect(second.totals.casMisses).toBe(0);
    expect(second.totals.sidecarsCopiedFromCas).toBe(2);
    expect(second.totals.sidecarsCompressed).toBe(0);
    expect(second.entries[0]?.brotliSource).toBe("cas");
    expect(second.entries[0]?.gzipSource).toBe("cas");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
