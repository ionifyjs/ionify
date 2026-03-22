import fs from "fs/promises";
import os from "os";
import path from "path";
import { expect, test } from "vitest";
import { native } from "../src/native/index";
import type { BuildPlan, BuildPlanChunk, BuildPlanModule } from "../src/types/plan";

function makePlan(entryFile: string, consumerFile: string, reexportsFile: string, sharedFile: string): BuildPlan {
  const entryModule: BuildPlanModule = {
    id: entryFile,
    fsPath: entryFile,
    hash: undefined,
    kind: "js",
    deps: [consumerFile],
    dynamicDeps: [],
  };
  const consumerModule: BuildPlanModule = {
    id: consumerFile,
    fsPath: consumerFile,
    hash: undefined,
    kind: "js",
    deps: [reexportsFile],
    dynamicDeps: [],
  };
  const reexportsModule: BuildPlanModule = {
    id: reexportsFile,
    fsPath: reexportsFile,
    hash: undefined,
    kind: "js",
    deps: [sharedFile],
    dynamicDeps: [],
  };
  const sharedModule: BuildPlanModule = {
    id: sharedFile,
    fsPath: sharedFile,
    hash: undefined,
    kind: "js",
    deps: [],
    dynamicDeps: [],
  };

  const entryChunk: BuildPlanChunk = {
    id: "chunk-entry",
    modules: [entryModule, consumerModule, reexportsModule],
    entry: true,
    shared: false,
    consumers: [entryFile],
    css: [],
    assets: [],
  };
  const sharedChunk: BuildPlanChunk = {
    id: "chunk-shared",
    modules: [sharedModule],
    entry: false,
    shared: true,
    consumers: [entryFile],
    css: [],
    assets: [],
  };

  return { entries: [entryFile], chunks: [entryChunk, sharedChunk] };
}

test("Phase 17: rewrites cross-chunk export* and export*as without placeholder chunks", async () => {
  if (!native?.buildChunks) {
    expect(true).toBe(true);
    return;
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ionify-phase17-export-star-"));
  const entryPath = path.join(tmp, "entry.js");
  const consumerPath = path.join(tmp, "consumer.js");
  const reexportsPath = path.join(tmp, "reexports.js");
  const sharedPath = path.join(tmp, "shared.js");

  await fs.writeFile(
    sharedPath,
    ['export const foo = "shared";', 'export const bar = "bar";'].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    reexportsPath,
    [
      'export * from "./shared.js";',
      'export * as ns from "./shared.js";',
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    consumerPath,
    ['import { bar, ns } from "./reexports.js";', "console.log(bar, ns.foo);"].join("\n"),
    "utf8",
  );
  await fs.writeFile(entryPath, ['import "./consumer.js";', 'export const foo = "entry";'].join("\n"), "utf8");

  try {
    const plan = makePlan(entryPath, consumerPath, reexportsPath, sharedPath);
    const artifacts = native.buildChunks!(plan);
    const entry = artifacts.find((a) => a.id === "chunk-entry");
    expect(entry).toBeTruthy();
    const code: string = entry!.code;

    expect(code).toContain('/chunks/chunk-shared/chunk-shared.native.js');

    expect(code).toContain("console.log");
    expect(code).toMatch(/__ionify_ns_[a-f0-9]{8}/);
    expect(code).toMatch(/__ionify_e_[a-f0-9]{8}_[a-f0-9]{6}/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
