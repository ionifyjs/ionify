import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const resolveModuleMock = vi.fn();
const tryNativeTransformMock = vi.fn();
const tryBundleNodeModuleMock = vi.fn();

vi.mock("@native/index", () => ({
  native: {
    resolveModule: (...args: any[]) => resolveModuleMock(...args),
  },
  tryNativeTransform: (...args: any[]) => tryNativeTransformMock(...args),
  tryBundleNodeModule: (...args: any[]) => tryBundleNodeModuleMock(...args),
}));

import { jsLoader } from "../src/core/loaders/js";
import { computeStableDepFileName } from "../src/core/deps/registry";
import { getCacheKey } from "../src/core/cache";

describe("jsLoader deps rewrite", () => {
  beforeEach(() => {
    resolveModuleMock.mockReset();
    tryNativeTransformMock.mockReset();
    tryBundleNodeModuleMock.mockReset();
  });

  it("rewrites pkg_cjs imports to /@deps/ paths", async () => {
    const entryPath = "/project/node_modules/react-dom/client.js";
    resolveModuleMock.mockReturnValue({
      kind: "PkgCjs",
      fsPath: entryPath,
      id: "react-dom/client",
      pkg: {
        name: "react-dom",
        version: "18.2.0",
        subpath: "./client",
      },
    });
    tryNativeTransformMock.mockReturnValue({ code: "import { createRoot } from 'react-dom/client';" });

    const fileName = computeStableDepFileName({
      entryPath,
      packageName: "react-dom",
      packageVersion: "18.2.0",
      subpath: "./client",
    });

    const result = await jsLoader.transform({
      path: "/project/src/main.ts",
      code: "import { createRoot } from 'react-dom/client';",
      ext: ".ts",
    });

    expect(result?.code).toContain(`/@deps/${fileName}`);
  });

  it("dedupes peer-aware dep filenames across duplicate install paths", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-peer-file-name-"));
    const rootEntry = path.join(tmpRoot, "node_modules", "@tanstack", "react-query", "build", "modern", "index.js");
    const featureEntry = path.join(
      tmpRoot,
      "Core",
      "node_modules",
      "@tanstack",
      "react-query",
      "build",
      "modern",
      "index.js",
    );

    fs.mkdirSync(path.dirname(rootEntry), { recursive: true });
    fs.mkdirSync(path.dirname(featureEntry), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "node_modules", "react"), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "Core", "node_modules", "react"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpRoot, "node_modules", "@tanstack", "react-query", "package.json"),
      JSON.stringify({
        name: "@tanstack/react-query",
        version: "5.55.4",
        peerDependencies: { react: "^18" },
      }),
    );
    fs.writeFileSync(
      path.join(tmpRoot, "Core", "node_modules", "@tanstack", "react-query", "package.json"),
      JSON.stringify({
        name: "@tanstack/react-query",
        version: "5.55.4",
        peerDependencies: { react: "^18" },
      }),
    );
    fs.writeFileSync(path.join(tmpRoot, "node_modules", "react", "package.json"), JSON.stringify({ name: "react", version: "18.3.1" }));
    fs.writeFileSync(path.join(tmpRoot, "Core", "node_modules", "react", "package.json"), JSON.stringify({ name: "react", version: "18.3.1" }));
    fs.writeFileSync(rootEntry, "export const value = 1;");
    fs.writeFileSync(featureEntry, "export const value = 1;");

    try {
      const rootFileName = computeStableDepFileName({
        entryPath: rootEntry,
        packageName: "@tanstack/react-query",
        packageVersion: "5.55.4",
        subpath: "./build/modern",
      });
      const featureFileName = computeStableDepFileName({
        entryPath: featureEntry,
        packageName: "@tanstack/react-query",
        packageVersion: "5.55.4",
        subpath: "./build/modern",
      });

      expect(rootFileName).toBe(featureFileName);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("keeps peer-aware dep filenames distinct when peer versions differ", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-peer-file-name-diff-"));
    const rootEntry = path.join(tmpRoot, "node_modules", "@tanstack", "react-query", "build", "modern", "index.js");
    const featureEntry = path.join(
      tmpRoot,
      "Core",
      "node_modules",
      "@tanstack",
      "react-query",
      "build",
      "modern",
      "index.js",
    );

    fs.mkdirSync(path.dirname(rootEntry), { recursive: true });
    fs.mkdirSync(path.dirname(featureEntry), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "node_modules", "react"), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, "Core", "node_modules", "react"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpRoot, "node_modules", "@tanstack", "react-query", "package.json"),
      JSON.stringify({
        name: "@tanstack/react-query",
        version: "5.55.4",
        peerDependencies: { react: "^18" },
      }),
    );
    fs.writeFileSync(
      path.join(tmpRoot, "Core", "node_modules", "@tanstack", "react-query", "package.json"),
      JSON.stringify({
        name: "@tanstack/react-query",
        version: "5.55.4",
        peerDependencies: { react: "^17 || ^18" },
      }),
    );
    fs.writeFileSync(path.join(tmpRoot, "node_modules", "react", "package.json"), JSON.stringify({ name: "react", version: "18.3.1" }));
    fs.writeFileSync(path.join(tmpRoot, "Core", "node_modules", "react", "package.json"), JSON.stringify({ name: "react", version: "17.0.2" }));
    fs.writeFileSync(rootEntry, "export const value = 1;");
    fs.writeFileSync(featureEntry, "export const value = 1;");

    try {
      const rootFileName = computeStableDepFileName({
        entryPath: rootEntry,
        packageName: "@tanstack/react-query",
        packageVersion: "5.55.4",
        subpath: "./build/modern",
      });
      const featureFileName = computeStableDepFileName({
        entryPath: featureEntry,
        packageName: "@tanstack/react-query",
        packageVersion: "5.55.4",
        subpath: "./build/modern",
      });

      expect(rootFileName).not.toBe(featureFileName);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("handles .mjs files (Radix-style ESM) via loader test()", () => {
    expect(
      jsLoader.test({
        ext: ".mjs",
        path: "/project/node_modules/@radix-ui/react-dialog/dist/index.mjs",
      } as any),
    ).toBe(true);
  });

  it("routes CJS wrapper files through /@deps proxy instead of serving raw", async () => {
    const tmpRoot = path.join(process.cwd(), ".tmp-ionify-test");
    const pkgRoot = path.join(tmpRoot, "node_modules", "react");
    const entryPath = path.join(pkgRoot, "index.mjs");
    fs.mkdirSync(pkgRoot, { recursive: true });
    fs.writeFileSync(path.join(pkgRoot, "package.json"), "{\"name\":\"react\",\"version\":\"19.2.3\"}");
    fs.writeFileSync(entryPath, "module.exports = require('./cjs/react.production.js');");

    try {
      const result = await jsLoader.transform({
        path: entryPath,
        ext: ".mjs",
        code: fs.readFileSync(entryPath, "utf8"),
      });

      expect(result.code).toContain("/@deps/");
      expect(tryBundleNodeModuleMock).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("rewrites deps imports to vendor-pack v2 modules when index is present", async () => {
    const prevHash = process.env.IONIFY_DEPS_HASH;
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-vendor-pack-v2-"));
    const depsHash = "deadbeefdeadbeef";
    process.env.IONIFY_DEPS_HASH = depsHash;
    const depsRoot = path.join(tmpRoot, ".ionify", "deps", depsHash);
    fs.mkdirSync(depsRoot, { recursive: true });

    const entryPath = "/project/node_modules/@radix-ui/react-dialog/dist/index.mjs";
    const fileName = computeStableDepFileName({
      entryPath,
      packageName: "@radix-ui/react-dialog",
      packageVersion: "1.0.0",
      subpath: ".",
    });

    const packFileName = "vendor-pack.feature.ui.abc123.js";
    const sharedFileName = "shared.abc123.js";
    const vendorKey = getCacheKey(`vendor-pack-v2:test:${depsHash}:${packFileName}`);
    fs.writeFileSync(
      path.join(depsRoot, packFileName),
      `// ionify:vendor-pack-v2 ${vendorKey}\n// pack\n`,
      "utf8",
    );
    fs.writeFileSync(path.join(depsRoot, sharedFileName), "// shared\n", "utf8");
    fs.writeFileSync(
      path.join(depsRoot, "vendor-pack.v2.index.json"),
      JSON.stringify(
        {
          version: 1,
          depsHash,
          updatedAt: new Date().toISOString(),
          packFileToSharedFile: { [packFileName]: sharedFileName },
          packFileToKey: { [packFileName]: vendorKey },
          packFileToChunkFiles: { [packFileName]: [sharedFileName] },
          fileNameToPackFile: { [fileName]: packFileName },
        },
        null,
        2,
      ),
      "utf8",
    );

    resolveModuleMock.mockImplementation(() => ({
      kind: "PkgEsm",
      fsPath: entryPath,
      id: "@radix-ui/react-dialog",
      pkg: { name: "@radix-ui/react-dialog", version: "1.0.0", subpath: "." },
    }));
    tryNativeTransformMock.mockImplementation((_mode: any, code: string) => ({ code }));

    const memberKey = getCacheKey(`vp2:${fileName}`).slice(0, 12);

    try {
      const result = await jsLoader.transform({
        path: "/project/src/main.ts",
        code:
          "import Dialog, { Root as DialogRoot } from '@radix-ui/react-dialog';\n" +
          "import * as NS from '@radix-ui/react-dialog';\n",
        ext: ".ts",
        config: { root: tmpRoot, optimizeDeps: { vendorPacks: "auto" } } as any,
      });

      expect(result.code).toContain(`/@deps/${packFileName}`);
      expect(result.code).toContain(`__ionify_vp_${memberKey}__default as Dialog`);
      expect(result.code).toContain(`__ionify_vp_${memberKey}__Root as DialogRoot`);
      expect(result.code).toContain(`__ionify_vp_${memberKey}__ns as NS`);
      expect(result.code).not.toContain(`/@deps/${fileName}`);
    } finally {
      process.env.IONIFY_DEPS_HASH = prevHash;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("does not rewrite deps imports to vendor-pack v2 modules when vendorPacks is disabled", async () => {
    const prevHash = process.env.IONIFY_DEPS_HASH;
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-vendor-pack-v2-disabled-"));
    const depsHash = "deadbeefdeadbeef";
    process.env.IONIFY_DEPS_HASH = depsHash;
    const depsRoot = path.join(tmpRoot, ".ionify", "deps", depsHash);
    fs.mkdirSync(depsRoot, { recursive: true });

    const entryPath = "/project/node_modules/@radix-ui/react-dialog/dist/index.mjs";
    const fileName = computeStableDepFileName({
      entryPath,
      packageName: "@radix-ui/react-dialog",
      packageVersion: "1.0.0",
      subpath: ".",
    });

    const packFileName = "vendor-pack.feature.ui.abc123.js";
    const sharedFileName = "shared.abc123.js";
    const vendorKey = getCacheKey(`vendor-pack-v2:test:${depsHash}:${packFileName}`);
    fs.writeFileSync(
      path.join(depsRoot, packFileName),
      `// ionify:vendor-pack-v2 ${vendorKey}\n// pack\n`,
      "utf8",
    );
    fs.writeFileSync(path.join(depsRoot, sharedFileName), "// shared\n", "utf8");
    fs.writeFileSync(
      path.join(depsRoot, "vendor-pack.v2.index.json"),
      JSON.stringify(
        {
          version: 1,
          depsHash,
          updatedAt: new Date().toISOString(),
          packFileToSharedFile: { [packFileName]: sharedFileName },
          packFileToKey: { [packFileName]: vendorKey },
          packFileToChunkFiles: { [packFileName]: [sharedFileName] },
          fileNameToPackFile: { [fileName]: packFileName },
        },
        null,
        2,
      ),
      "utf8",
    );

    resolveModuleMock.mockImplementation(() => ({
      kind: "PkgEsm",
      fsPath: entryPath,
      id: "@radix-ui/react-dialog",
      pkg: { name: "@radix-ui/react-dialog", version: "1.0.0", subpath: "." },
    }));
    tryNativeTransformMock.mockImplementation((_mode: any, code: string) => ({ code }));

    try {
      const result = await jsLoader.transform({
        path: "/project/src/main.ts",
        code: "import * as NS from '@radix-ui/react-dialog';\n",
        ext: ".ts",
        config: { root: tmpRoot, optimizeDeps: { vendorPacks: false } } as any,
      });

      expect(result.code).toContain(`/@deps/${fileName}`);
      expect(result.code).not.toContain(`/@deps/${packFileName}`);
      expect(result.code).not.toContain(`__ionify_vp_`);
    } finally {
      process.env.IONIFY_DEPS_HASH = prevHash;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("routes peer-dependent packages through vendor-pack v2 aliases when the manifest is canonical", async () => {
    const prevHash = process.env.IONIFY_DEPS_HASH;
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-vendor-pack-v2-peer-deps-"));
    const depsHash = "deadbeefdeadbeef";
    process.env.IONIFY_DEPS_HASH = depsHash;
    const depsRoot = path.join(tmpRoot, ".ionify", "deps", depsHash);
    fs.mkdirSync(depsRoot, { recursive: true });

    const pkgRoot = path.join(tmpRoot, "node_modules", "@tanstack", "react-query");
    const entryPath = path.join(pkgRoot, "build", "modern", "index.js");
    fs.mkdirSync(path.dirname(entryPath), { recursive: true });
    fs.writeFileSync(
      path.join(pkgRoot, "package.json"),
      JSON.stringify({
        name: "@tanstack/react-query",
        version: "5.55.4",
        peerDependencies: { react: "^18 || ^19" },
      }),
    );
    fs.writeFileSync(entryPath, "export const useQuery = () => null;\n", "utf8");

    const fileName = computeStableDepFileName({
      entryPath,
      packageName: "@tanstack/react-query",
      packageVersion: "5.55.4",
      subpath: "./build/modern",
    });

    const packFileName = "vendor-pack.feature.data.abc123.js";
    const sharedFileName = "shared.abc123.js";
    const vendorKey = getCacheKey(`vendor-pack-v2:test:${depsHash}:${packFileName}`);

    fs.writeFileSync(
      path.join(depsRoot, packFileName),
      `// ionify:vendor-pack-v2 ${vendorKey}\n// pack\n`,
      "utf8",
    );
    fs.writeFileSync(path.join(depsRoot, sharedFileName), "// shared\n", "utf8");
    fs.writeFileSync(
      path.join(depsRoot, "vendor-pack.v2.index.json"),
      JSON.stringify(
        {
          version: 1,
          depsHash,
          updatedAt: new Date().toISOString(),
          packFileToSharedFile: { [packFileName]: sharedFileName },
          packFileToKey: { [packFileName]: vendorKey },
          packFileToChunkFiles: { [packFileName]: [sharedFileName] },
          fileNameToPackFile: { [fileName]: packFileName },
        },
        null,
        2,
      ),
      "utf8",
    );

    resolveModuleMock.mockImplementation(() => ({
      kind: "PkgEsm",
      fsPath: entryPath,
      id: "@tanstack/react-query",
      pkg: { name: "@tanstack/react-query", version: "5.55.4", subpath: "./build/modern" },
    }));
    tryNativeTransformMock.mockImplementation((_mode: any, code: string) => ({ code }));

    try {
      const result = await jsLoader.transform({
        path: path.join(tmpRoot, "src", "main.ts"),
        code: "import { useQuery } from '@tanstack/react-query';\n",
        ext: ".ts",
        config: { root: tmpRoot, optimizeDeps: { vendorPacks: "auto" } } as any,
      });

      expect(result.code).toContain(`/@deps/${packFileName}`);
      expect(result.code).not.toContain(`/@deps/${fileName}`);
      expect(result.code).toContain(`__ionify_vp_`);
    } finally {
      process.env.IONIFY_DEPS_HASH = prevHash;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("falls back to stable /@deps/ modules when vendor-pack v2 module is invalid", async () => {
    const prevHash = process.env.IONIFY_DEPS_HASH;
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-vendor-pack-v2-fallback-"));
    const depsHash = "deadbeefdeadbeef";
    process.env.IONIFY_DEPS_HASH = depsHash;
    const depsRoot = path.join(tmpRoot, ".ionify", "deps", depsHash);
    fs.mkdirSync(depsRoot, { recursive: true });

    const entryPath = "/project/node_modules/@radix-ui/react-dialog/dist/index.mjs";
    const fileName = computeStableDepFileName({
      entryPath,
      packageName: "@radix-ui/react-dialog",
      packageVersion: "1.0.0",
      subpath: ".",
    });

    const packFileName = "vendor-pack.feature.ui.abc123.js";
    const sharedFileName = "shared.abc123.js";
    const expectedKey = getCacheKey(`vendor-pack-v2:test:${depsHash}:${packFileName}`);
    const wrongKey = getCacheKey(`vendor-pack-v2:wrong:${depsHash}:${packFileName}`);

    fs.writeFileSync(
      path.join(depsRoot, packFileName),
      `// ionify:vendor-pack-v2 ${wrongKey}\n// pack\n`,
      "utf8",
    );
    fs.writeFileSync(path.join(depsRoot, sharedFileName), "// shared\n", "utf8");
    fs.writeFileSync(
      path.join(depsRoot, "vendor-pack.v2.index.json"),
      JSON.stringify(
        {
          version: 1,
          depsHash,
          updatedAt: new Date().toISOString(),
          packFileToSharedFile: { [packFileName]: sharedFileName },
          packFileToKey: { [packFileName]: expectedKey },
          packFileToChunkFiles: { [packFileName]: [sharedFileName] },
          fileNameToPackFile: { [fileName]: packFileName },
        },
        null,
        2,
      ),
      "utf8",
    );

    resolveModuleMock.mockImplementation(() => ({
      kind: "PkgEsm",
      fsPath: entryPath,
      id: "@radix-ui/react-dialog",
      pkg: { name: "@radix-ui/react-dialog", version: "1.0.0", subpath: "." },
    }));
    tryNativeTransformMock.mockImplementation((_mode: any, code: string) => ({ code }));

    try {
      const result = await jsLoader.transform({
        path: "/project/src/main.ts",
        code:
          "import Dialog, { Root as DialogRoot } from '@radix-ui/react-dialog';\n" +
          "import * as NS from '@radix-ui/react-dialog';\n",
        ext: ".ts",
        config: { root: tmpRoot, optimizeDeps: { vendorPacks: "auto" } } as any,
      });

      expect(result.code).toContain(`/@deps/${fileName}`);
      expect(result.code).not.toContain(`/@deps/${packFileName}`);
      expect(result.code).not.toContain(`__ionify_vp_`);
    } finally {
      process.env.IONIFY_DEPS_HASH = prevHash;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("keeps React singleton wrappers on stable /@deps/ modules even when vendor-pack v2 routing exists", async () => {
    const prevHash = process.env.IONIFY_DEPS_HASH;
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-vendor-pack-v2-react-singleton-"));
    const depsHash = "deadbeefdeadbeef";
    process.env.IONIFY_DEPS_HASH = depsHash;
    const depsRoot = path.join(tmpRoot, ".ionify", "deps", depsHash);
    fs.mkdirSync(depsRoot, { recursive: true });

    const entryPath = "/project/node_modules/react-dom/client.js";
    const fileName = computeStableDepFileName({
      entryPath,
      packageName: "react-dom",
      packageVersion: "19.2.4",
      subpath: "client",
    });

    const packFileName = "vendor-pack.manual.core.abc123.js";
    const sharedFileName = "shared.abc123.js";
    const vendorKey = getCacheKey(`vendor-pack-v2:test:${depsHash}:${packFileName}`);
    fs.writeFileSync(
      path.join(depsRoot, packFileName),
      `// ionify:vendor-pack-v2 ${vendorKey}\n// pack\n`,
      "utf8",
    );
    fs.writeFileSync(path.join(depsRoot, sharedFileName), "// shared\n", "utf8");
    fs.writeFileSync(
      path.join(depsRoot, "vendor-pack.v2.index.json"),
      JSON.stringify(
        {
          version: 1,
          depsHash,
          updatedAt: new Date().toISOString(),
          packFileToSharedFile: { [packFileName]: sharedFileName },
          packFileToKey: { [packFileName]: vendorKey },
          packFileToChunkFiles: { [packFileName]: [sharedFileName] },
          fileNameToPackFile: { [fileName]: packFileName },
        },
        null,
        2,
      ),
      "utf8",
    );

    resolveModuleMock.mockImplementation(() => ({
      kind: "PkgEsm",
      fsPath: entryPath,
      id: "react-dom/client",
      pkg: { name: "react-dom", version: "19.2.4", subpath: "client" },
    }));
    tryNativeTransformMock.mockImplementation((_mode: any, code: string) => ({ code }));

    try {
      const result = await jsLoader.transform({
        path: "/project/src/main.tsx",
        code: "import { createRoot } from 'react-dom/client';\n",
        ext: ".tsx",
        config: { root: tmpRoot, optimizeDeps: { vendorPacks: "auto" } } as any,
      });

      expect(result.code).toContain(`/@deps/${fileName}`);
      expect(result.code).not.toContain(`/@deps/${packFileName}`);
      expect(result.code).not.toContain(`__ionify_vp_`);
    } finally {
      process.env.IONIFY_DEPS_HASH = prevHash;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
