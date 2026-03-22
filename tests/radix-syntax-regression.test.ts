import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { parseSync } from "@swc/core";

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

function findRadixDialogIndexMjs(): string | null {
  const cwd = process.cwd();
  const pnpmRoot = path.join(cwd, "node_modules", ".pnpm");
  if (!fs.existsSync(pnpmRoot)) return null;

  // Best-effort: locate any @radix-ui+react-dialog package folder and use its dist/index.mjs.
  const entries = fs.readdirSync(pnpmRoot);
  const hit = entries.find((name) => name.startsWith("@radix-ui+react-dialog@"));
  if (!hit) return null;

  const candidate = path.join(
    pnpmRoot,
    hit,
    "node_modules",
    "@radix-ui",
    "react-dialog",
    "dist",
    "index.mjs",
  );
  return fs.existsSync(candidate) ? candidate : null;
}

describe("Radix .mjs syntax regression", () => {
  beforeEach(() => {
    resolveModuleMock.mockReset();
    tryNativeTransformMock.mockReset();
    tryBundleNodeModuleMock.mockReset();
  });

  it("serves Radix ESM without bundler corruption", async () => {
    const radixPath = findRadixDialogIndexMjs();
    if (!radixPath) {
      // Running in an environment without pnpm-installed Radix.
      return;
    }

    const source = fs.readFileSync(radixPath, "utf8");
    const result = await jsLoader.transform({
      path: radixPath,
      ext: ".mjs",
      code: source,
    });

    // If this starts calling the native bundler again, we risk emitting invalid JS for ESM libs.
    expect(tryBundleNodeModuleMock).not.toHaveBeenCalled();

    // Validate the transformed output is syntactically valid ESM.
    expect(() =>
      parseSync(result.code, {
        syntax: "ecmascript",
        target: "es2022",
        isModule: true,
      }),
    ).not.toThrow();
  });
});

