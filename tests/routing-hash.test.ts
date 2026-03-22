import { describe, it, expect } from "vitest";
import { computeChunkGroupIdFromStableIds } from "../src/core/deps/vendor-pack-utils";
import { hashFeaturePackRoutingIndex, hashVendorPackV2RoutingIndex } from "../src/core/deps/routing-hash";

describe("deps routing hashes are deterministic", () => {
  const outputVersion = 15;

  it("computeChunkGroupIdFromStableIds is order-insensitive + duplicate-insensitive", () => {
    const a = computeChunkGroupIdFromStableIds(["b@1.js", "a@1.js", "a@1.js"]);
    const b = computeChunkGroupIdFromStableIds(["a@1.js", "b@1.js"]);
    expect(a).toBe(b);
    expect(a).toMatch(/^sc[0-9a-f]{8}$/);
  });

  it("hashFeaturePackRoutingIndex ignores updatedAt and key order", () => {
    const depsHash = "deadbeefdeadbeef";
    const indexA = {
      version: 1,
      depsHash,
      outputVersion,
      updatedAt: "2020-01-01T00:00:00.000Z",
      fileNameToChunkGroupId: {
        "b@1.0.0_x.js": "scbbbbbbbb",
        "a@1.0.0_x.js": "scaaaaaaaa",
      },
    };
    const indexB = {
      version: 1,
      depsHash,
      outputVersion,
      updatedAt: "2026-01-01T00:00:00.000Z",
      fileNameToChunkGroupId: {
        "a@1.0.0_x.js": "scaaaaaaaa",
        "b@1.0.0_x.js": "scbbbbbbbb",
      },
    };
    expect(hashFeaturePackRoutingIndex(indexA, depsHash, outputVersion)).toBe(
      hashFeaturePackRoutingIndex(indexB, depsHash, outputVersion),
    );

    const indexC = {
      ...indexA,
      fileNameToChunkGroupId: {
        ...indexA.fileNameToChunkGroupId,
        "a@1.0.0_x.js": "sccccccccc",
      },
    };
    expect(hashFeaturePackRoutingIndex(indexA, depsHash, outputVersion)).not.toBe(
      hashFeaturePackRoutingIndex(indexC, depsHash, outputVersion),
    );
    expect(hashFeaturePackRoutingIndex(indexA, depsHash, outputVersion + 1)).toBeNull();
  });

  it("hashVendorPackV2RoutingIndex ignores updatedAt and normalizes chunk lists", () => {
    const depsHash = "deadbeefdeadbeef";
    const indexA = {
      version: 1,
      depsHash,
      outputVersion,
      updatedAt: "2020-01-01T00:00:00.000Z",
      packFileToSharedFile: { "vendor-pack.feature.ui.sc1.js": "shared.sc1.js" },
      packFileToKey: { "vendor-pack.feature.ui.sc1.js": "ABCDEF" + "0".repeat(58) },
      packFileToChunkFiles: { "vendor-pack.feature.ui.sc1.js": ["shared.sc1.js", "shared.sc1.js"] },
      fileNameToPackFile: {
        "radix@1.0.0_x.js": "vendor-pack.feature.ui.sc1.js",
        "mui@1.0.0_x.js": "vendor-pack.feature.ui.sc1.js",
      },
    };
    const indexB = {
      version: 1,
      depsHash,
      outputVersion,
      updatedAt: "2026-01-01T00:00:00.000Z",
      packFileToSharedFile: { "vendor-pack.feature.ui.sc1.js": "shared.sc1.js" },
      packFileToKey: { "vendor-pack.feature.ui.sc1.js": ("abcdef" + "0".repeat(58)).toUpperCase() },
      packFileToChunkFiles: { "vendor-pack.feature.ui.sc1.js": ["shared.sc1.js"] },
      fileNameToPackFile: {
        "mui@1.0.0_x.js": "vendor-pack.feature.ui.sc1.js",
        "radix@1.0.0_x.js": "vendor-pack.feature.ui.sc1.js",
      },
    };
    expect(hashVendorPackV2RoutingIndex(indexA, depsHash, outputVersion)).toBe(
      hashVendorPackV2RoutingIndex(indexB, depsHash, outputVersion),
    );
    expect(hashVendorPackV2RoutingIndex(indexA, depsHash, outputVersion + 1)).toBeNull();
  });
});
