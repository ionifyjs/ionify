import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  VendorPackV2IndexManager,
} from "../src/core/deps/vendor-pack-v2";
import { hashVendorPackV2RoutingIndex } from "../src/core/deps/routing-hash";

function writeFile(filePath: string, body: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, "utf8");
}

describe("vendor-pack-v2 index determinism gates", () => {
  it("persists packIndexHash and usageIndexHash deterministically", () => {
    const depsHash = "deadbeefdeadbeef";
    const outputVersion = 15;
    const depsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-vp2-"));

    const sharedFileName = "shared.sc12345678.js";
    writeFile(path.join(depsRoot, sharedFileName), `// shared\nexport const __ionifyRequire = () => ({})\n`);

    const wrapperFileName = "dep-a@1.0.0_x.js";
    writeFile(
      path.join(depsRoot, wrapperFileName),
      [
        `import { __ionifyRequire } from "/@deps/${sharedFileName}";`,
        `const __exports = __ionifyRequire("entry-a");`,
        `export { __ionify_export_foo as foo };`,
        `export { __ionify_export_bar as bar };`,
        ``,
      ].join("\n"),
    );

    const mgr = new VendorPackV2IndexManager({ depsRoot, depsHash, outputVersion });
    mgr.ensurePackModuleFromEntries({
      label: "test/manual/ui",
      packFileName: "vendor-pack.manual.ui.sc12345678.js",
      sharedFileName,
      entries: [{ entryPath: "/dev/null", fileName: wrapperFileName, packageLabel: "dep-a" }],
      prunePackPrefix: "vendor-pack.manual.ui.",
    });

    const packPath = path.join(depsRoot, "vendor-pack.manual.ui.sc12345678.js");
    expect(fs.existsSync(packPath)).toBe(true);
    const firstHead = fs.readFileSync(packPath, "utf8").slice(0, 256);
    const firstKey = (firstHead.match(/\/\/\s*ionify:vendor-pack-v2\s+([0-9a-fA-F]{32,})/) ?? [])[1] ?? null;
    expect(typeof firstKey).toBe("string");

    // Restart simulation: reload manager and re-ensure the same pack.
    const mgr2 = new VendorPackV2IndexManager({ depsRoot, depsHash, outputVersion });
    mgr2.loadFromDisk();
    mgr2.ensurePackModuleFromEntries({
      label: "test/manual/ui",
      packFileName: "vendor-pack.manual.ui.sc12345678.js",
      sharedFileName,
      entries: [{ entryPath: "/dev/null", fileName: wrapperFileName, packageLabel: "dep-a" }],
      prunePackPrefix: "vendor-pack.manual.ui.",
    });
    const secondHead = fs.readFileSync(packPath, "utf8").slice(0, 256);
    const secondKey = (secondHead.match(/\/\/\s*ionify:vendor-pack-v2\s+([0-9a-fA-F]{32,})/) ?? [])[1] ?? null;
    expect(secondKey).toBe(firstKey);

    const indexPath = path.join(depsRoot, "vendor-pack.v2.index.json");
    expect(fs.existsSync(indexPath)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(indexPath, "utf8"));

    expect(typeof raw.packIndexHash).toBe("string");
    expect(raw.packIndexHash).toBe(hashVendorPackV2RoutingIndex(raw, depsHash, outputVersion));

    expect(raw.usageIndexHash === null || raw.usageIndexHash === undefined).toBe(true);

    mgr.setUsageIndexHash("a".repeat(64));
    const raw2 = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    expect(raw2.usageIndexHash).toBe("a".repeat(64));
    expect(raw2.packIndexHash).toBe(hashVendorPackV2RoutingIndex(raw2, depsHash, outputVersion));
  });

  it("ignores persisted indexes from a different deps output version", () => {
    const depsHash = "deadbeefdeadbeef";
    const depsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-vp2-version-"));
    const indexPath = path.join(depsRoot, "vendor-pack.v2.index.json");
    fs.writeFileSync(
      indexPath,
      JSON.stringify(
        {
          version: 1,
          depsHash,
          outputVersion: 14,
          updatedAt: "2026-01-01T00:00:00.000Z",
          packFileToSharedFile: {
            "vendor-pack.feature.data.scold.js": "shared.scold.js",
          },
          fileNameToPackFile: {
            "dep-a@1.0.0_x.js": "vendor-pack.feature.data.scold.js",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const mgr = new VendorPackV2IndexManager({ depsRoot, depsHash, outputVersion: 15 });
    mgr.loadFromDisk();

    expect(mgr.fileNameToPackFile.size).toBe(0);
    expect(mgr.packFileToSharedFile.size).toBe(0);
  });

  it("loads persisted routing without creating alias modules", () => {
    const depsHash = "deadbeefdeadbeef";
    const outputVersion = 15;
    const depsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-vp2-load-"));
    const packFileName = "vendor-pack.feature.data.sc12345678.js";
    const sharedFileName = "shared.sc12345678.js";

    writeFile(path.join(depsRoot, sharedFileName), `// shared\nexport const __ionifyRequire = () => ({})\n`);
    writeFile(path.join(depsRoot, packFileName), `// ionify:vendor-pack-v2 ${"a".repeat(64)}\n// pack\n`);
    writeFile(path.join(depsRoot, "dep-a@1.0.0_x.js"), `export const foo = 1;\n`);
    fs.writeFileSync(
      path.join(depsRoot, "vendor-pack.v2.index.json"),
      JSON.stringify(
        {
          version: 1,
          depsHash,
          outputVersion,
          updatedAt: "2026-01-01T00:00:00.000Z",
          packFileToSharedFile: {
            [packFileName]: sharedFileName,
          },
          packFileToKey: {
            [packFileName]: "a".repeat(64),
          },
          packFileToChunkFiles: {
            [packFileName]: [sharedFileName],
          },
          fileNameToPackFile: {
            "dep-a@1.0.0_x.js": packFileName,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const mgr = new VendorPackV2IndexManager({
      depsRoot,
      depsHash,
      outputVersion,
      allowPackFilePrefix: "vendor-pack.feature.data.",
    });
    mgr.loadFromDisk();

    expect(mgr.packFileToSharedFile.get(packFileName)).toBe(sharedFileName);
    expect(mgr.fileNameToPackFile.get("dep-a@1.0.0_x.js")).toBe(packFileName);
    expect(fs.existsSync(path.join(depsRoot, "vendor-pack.feature.data.current.js"))).toBe(false);
  });
});
