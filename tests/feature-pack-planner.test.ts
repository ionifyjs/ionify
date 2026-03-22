import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  deriveFeaturePackRoutingMap,
  isFeaturePackSlimAligned,
  reconcilePackEntries,
  resolveChunkedPackEntries,
  selectStableFeaturePackEntries,
  type FeaturePackObservedEntry,
} from "../src/core/deps/feature-pack-planner";

describe("feature-pack planner", () => {
  it("derives routing from current ready state only", () => {
    const routing = deriveFeaturePackRoutingMap([
      {
        status: "ready",
        chunkGroupId: "sc-current",
        entries: [
          {
            entryPath: "/app/node_modules/@tanstack/react-query/index.js",
            fileName: "tanstack__react-query.js",
            packageLabel: "@tanstack/react-query",
          },
        ],
      },
      {
        status: "building",
        chunkGroupId: "sc-stale",
        entries: [
          {
            entryPath: "/app/node_modules/@tanstack/react-query-devtools/index.js",
            fileName: "tanstack__react-query-devtools.js",
            packageLabel: "@tanstack/react-query-devtools",
          },
        ],
      },
      null,
    ]);

    expect(Array.from(routing.entries())).toEqual([["tanstack__react-query.js", "sc-current"]]);
  });

  it("keeps current ready entries pinned when re-planning auto packs", () => {
    const candidates: FeaturePackObservedEntry[] = [
      {
        entryPath: "/app/node_modules/@tanstack/react-query/index.js",
        fileName: "tanstack__react-query.js",
        packageLabel: "@tanstack/react-query",
        score: 80,
        sizeBytes: 40,
      },
      {
        entryPath: "/app/node_modules/@tanstack/react-query-devtools/index.js",
        fileName: "tanstack__react-query-devtools.js",
        packageLabel: "@tanstack/react-query-devtools",
        score: 75,
        sizeBytes: 30,
      },
      {
        entryPath: "/app/node_modules/@mui/x-date-pickers/index.js",
        fileName: "mui__x-date-pickers.js",
        packageLabel: "@mui/x-date-pickers",
        score: 95,
        sizeBytes: 35,
      },
    ];

    const selected = selectStableFeaturePackEntries({
      currentReadyEntries: [
        {
          entryPath: "/app/node_modules/@tanstack/react-query/index.js",
          fileName: "tanstack__react-query.js",
          packageLabel: "@tanstack/react-query",
        },
        {
          entryPath: "/app/node_modules/@tanstack/react-query-devtools/index.js",
          fileName: "tanstack__react-query-devtools.js",
          packageLabel: "@tanstack/react-query-devtools",
        },
      ],
      candidates,
      maxMembers: 2,
      maxBytes: 70,
    });

    expect(selected.map((entry) => entry.fileName)).toEqual([
      "tanstack__react-query.js",
      "tanstack__react-query-devtools.js",
    ]);
  });

  it("rejects stale slim packs that no longer match the current base membership", () => {
    expect(
      isFeaturePackSlimAligned(
        [
          {
            entryPath: "/app/node_modules/@tanstack/react-query/index.js",
            fileName: "tanstack__react-query.js",
            packageLabel: "@tanstack/react-query",
          },
          {
            entryPath: "/app/node_modules/@tanstack/react-query-devtools/index.js",
            fileName: "tanstack__react-query-devtools.js",
            packageLabel: "@tanstack/react-query-devtools",
          },
        ],
        [
          {
            baseFileName: "tanstack__react-query-devtools.js",
            wrapperFileName: "tanstack__react-query-devtools.usage.js",
          },
        ],
      ),
    ).toBe(false);
  });

  it("accepts slim packs only when they cover the exact current base membership", () => {
    expect(
      isFeaturePackSlimAligned(
        [
          {
            entryPath: "/app/node_modules/@tanstack/react-query/index.js",
            fileName: "tanstack__react-query.js",
            packageLabel: "@tanstack/react-query",
          },
          {
            entryPath: "/app/node_modules/@tanstack/react-query-devtools/index.js",
            fileName: "tanstack__react-query-devtools.js",
            packageLabel: "@tanstack/react-query-devtools",
          },
        ],
        [
          {
            baseFileName: "tanstack__react-query-devtools.js",
            wrapperFileName: "tanstack__react-query-devtools.usage.js",
          },
          {
            baseFileName: "tanstack__react-query.js",
            wrapperFileName: "tanstack__react-query.usage.js",
          },
        ],
      ),
    ).toBe(true);
  });

  it("reconciles pack entries to canonical file names and removes path aliases", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-pack-reconcile-"));
    const realDir = path.join(tempDir, "real");
    const linkDir = path.join(tempDir, "link");
    fs.mkdirSync(realDir, { recursive: true });
    fs.writeFileSync(path.join(realDir, "index.js"), "export const value = 1;\n", "utf8");
    fs.symlinkSync(realDir, linkDir);

    try {
      const reconciled = reconcilePackEntries(
        [
          {
            entryPath: path.join(linkDir, "index.js"),
            fileName: "pkg_old.js",
            packageLabel: "pkg",
          },
          {
            entryPath: path.join(realDir, "index.js"),
            fileName: "pkg_new.js",
            packageLabel: "pkg",
          },
        ],
        (fileName, entryPath) => (fs.realpathSync(entryPath) === path.join(realDir, "index.js") ? "pkg_new.js" : fileName),
      );

      expect(reconciled).toEqual([
        {
          entryPath: path.join(realDir, "index.js"),
          fileName: "pkg_new.js",
          packageLabel: "pkg",
        },
      ]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rewrites pack entries to the actual emitted chunked wrapper files", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-pack-result-"));
    const realDir = path.join(tempDir, "real");
    const linkDir = path.join(tempDir, "link");
    fs.mkdirSync(realDir, { recursive: true });
    fs.writeFileSync(path.join(realDir, "index.js"), "export const value = 1;\n", "utf8");
    fs.symlinkSync(realDir, linkDir);

    try {
      const resolved = resolveChunkedPackEntries(
        [
          {
            entryPath: path.join(linkDir, "index.js"),
            fileName: "pkg_old.js",
            packageLabel: "pkg",
          },
        ],
        [
          {
            entryPath: path.join(realDir, "index.js"),
            outPath: path.join(tempDir, "deps", "pkg_actual.js"),
          },
        ],
      );

      expect(resolved).toEqual([
        {
          entryPath: path.join(linkDir, "index.js"),
          fileName: "pkg_actual.js",
          packageLabel: "pkg",
        },
      ]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
