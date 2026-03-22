import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { configureResolverAliases, resetResolverAliasCache } from "../src/core/resolver";

const resolveModuleMock = vi.fn();

vi.mock("@native/index", () => ({
  native: {
    resolveModule: (...args: any[]) => resolveModuleMock(...args),
  },
}));

import {
  buildCanonicalDepFileNameIndex,
  canonicalizeDepUsageIndex,
  scanDepUsage,
  type DepUsageIndex,
} from "../src/core/deps/usage";

beforeEach(() => {
  resolveModuleMock.mockReset();
  resetResolverAliasCache();
});

afterEach(() => {
  resetResolverAliasCache();
});

test("canonicalizes duplicate dep usage entries to the manifest-backed artifact", () => {
  const entryPath = "/tmp/project/node_modules/react-hook-form/dist/index.esm.mjs";
  const usage: DepUsageIndex = new Map([
    [
      "react-hook-form@7.71.1__dist__index.esm_old111.js",
      {
        fileName: "react-hook-form@7.71.1__dist__index.esm_old111.js",
        entryPath,
        packageName: "react-hook-form",
        packageVersion: "7.71.1",
        usedExports: ["useForm"],
        hasNamespace: false,
        hasExportStar: false,
      },
    ],
    [
      "react-hook-form@7.71.1__dist__index.esm_new222.js",
      {
        fileName: "react-hook-form@7.71.1__dist__index.esm_new222.js",
        entryPath,
        packageName: "react-hook-form",
        packageVersion: "7.71.1",
        usedExports: ["Controller", "useForm"],
        hasNamespace: true,
        hasExportStar: false,
      },
    ],
  ]);

  const canonical = buildCanonicalDepFileNameIndex([
    {
      fileName: "react-hook-form@7.71.1__dist__index.esm_new222.js",
      entryPath,
    },
  ]);

  const result = canonicalizeDepUsageIndex(usage, canonical);

  expect(Array.from(result.keys())).toEqual(["react-hook-form@7.71.1__dist__index.esm_new222.js"]);
  expect(result.get("react-hook-form@7.71.1__dist__index.esm_new222.js")).toEqual({
    fileName: "react-hook-form@7.71.1__dist__index.esm_new222.js",
    entryPath,
    packageName: "react-hook-form",
    packageVersion: "7.71.1",
    usedExports: ["Controller", "useForm"],
    hasNamespace: true,
    hasExportStar: false,
  });
});

test("scanDepUsage traverses alias-resolved app modules before classifying deps", async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-dep-usage-alias-"));
  const appEntry = path.join(tmpRoot, "src", "main.tsx");
  const dialogModule = path.join(tmpRoot, "core", "DialogDemo.tsx");
  const depEntry = path.join(
    tmpRoot,
    "node_modules",
    "@radix-ui",
    "react-dialog",
    "dist",
    "index.mjs",
  );

  fs.mkdirSync(path.dirname(appEntry), { recursive: true });
  fs.mkdirSync(path.dirname(dialogModule), { recursive: true });
  fs.mkdirSync(path.dirname(depEntry), { recursive: true });

  fs.writeFileSync(appEntry, "import { DialogDemo } from '@core/DialogDemo';\nexport const App = () => DialogDemo();\n");
  fs.writeFileSync(dialogModule, "import * as Dialog from '@radix-ui/react-dialog';\nexport const DialogDemo = () => Dialog.Root;\n");
  fs.writeFileSync(depEntry, "export const Root = () => null;\n");
  fs.writeFileSync(
    path.join(tmpRoot, "node_modules", "@radix-ui", "react-dialog", "package.json"),
    JSON.stringify({ name: "@radix-ui/react-dialog", version: "1.1.15" }),
  );

  configureResolverAliases({ "@core": "/core" }, tmpRoot);
  resolveModuleMock.mockImplementation((specifier: string) => {
    if (specifier === "@radix-ui/react-dialog") {
      return {
        kind: "PkgEsm",
        fsPath: depEntry,
        pkg: {
          name: "@radix-ui/react-dialog",
          version: "1.1.15",
          subpath: "./dist",
        },
      };
    }
    return { kind: "NotFound" };
  });

  try {
    const result = await scanDepUsage({
      rootDir: tmpRoot,
      entries: [appEntry],
      allowedRoots: [tmpRoot],
    });

    const only = Array.from(result.values());
    expect(only).toHaveLength(1);
    expect(only[0]?.packageName).toBe("@radix-ui/react-dialog");
    expect(only[0]?.hasNamespace).toBe(true);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
