import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rerouteDepsArtifacts } from "../src/cli/commands/build";
import type { BuildPlan, BuildPlanModule, BuildPlanChunk } from "../src/types/plan";

/**
 * T3 — Deps artifact rerouting tests
 *
 * Validates that `rerouteDepsArtifacts()` correctly transforms a build plan:
 *   - Entry modules matching deps manifest entries are rerouted to pre-built artifacts
 *   - Internal transitive node_modules modules are pruned
 *   - Non-node_modules modules are left untouched
 *   - Artifacts are written to CAS for the Rust bundler
 *   - Hash is recomputed from artifact bytes
 */

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function makePlan(chunks: BuildPlanChunk[], entries?: string[]): BuildPlan {
  return {
    entries: entries ?? chunks.filter((c) => c.entry).map((c) => c.modules[0]?.id).filter(Boolean) as string[],
    chunks,
  };
}

function makeChunk(id: string, modules: BuildPlanModule[], opts?: Partial<BuildPlanChunk>): BuildPlanChunk {
  return {
    id,
    modules,
    entry: opts?.entry ?? false,
    shared: opts?.shared ?? false,
    consumers: opts?.consumers ?? [],
    css: opts?.css ?? [],
    assets: opts?.assets ?? [],
  };
}

function makeModule(id: string, opts?: Partial<BuildPlanModule>): BuildPlanModule {
  return {
    id,
    kind: opts?.kind ?? "js",
    deps: opts?.deps ?? [],
    dynamicDeps: opts?.dynamicDeps ?? [],
    fsPath: opts?.fsPath ?? null,
    hash: opts?.hash ?? null,
  };
}

describe("T3: deps artifact rerouting", () => {
  let rootDir: string;
  let depsRoot: string;
  let casRoot: string;
  const configHash = "test-config-hash-001";

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-t3-reroute-"));
    depsRoot = path.join(rootDir, ".ionify", "deps", "abc123");
    casRoot = path.join(rootDir, ".ionify", "cas");
    fs.mkdirSync(depsRoot, { recursive: true });
    fs.mkdirSync(casRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  // ─── Test 1: Single entry module is rerouted ───
  it("reroutes a single node_modules entry to its pre-built artifact", () => {
    const entryPath = path.join(rootDir, "node_modules", "react", "index.js");
    fs.mkdirSync(path.dirname(entryPath), { recursive: true });
    fs.writeFileSync(entryPath, "module.exports = require('./cjs/react.development.js');");

    const artifactCode = "export function createElement() { /* pre-built ESM */ }";
    const outFile = "react@18.3.1_abc123.js";
    fs.writeFileSync(path.join(depsRoot, outFile), artifactCode);

    // Write deps manifest
    const manifest = {
      entries: {
        [entryPath]: { outFile, package: "react@18.3.1" },
      },
    };
    fs.writeFileSync(path.join(depsRoot, "manifest.json"), JSON.stringify(manifest));

    const plan = makePlan([
      makeChunk("chunk-vendor", [
        makeModule(`ws://node_modules/react/index.js`, { fsPath: entryPath, hash: sha256("old") }),
      ]),
    ]);

    const { rerouted, pruned } = rerouteDepsArtifacts({
      plan,
      depsRoot,
      casRoot,
      configHash,
      workspaceRoot: rootDir,
    });

    expect(rerouted).toBe(1);
    expect(pruned).toBe(0);
    expect(plan.chunks[0].modules).toHaveLength(1);

    const mod = plan.chunks[0].modules[0];
    expect(mod.fsPath).toBe(path.join(depsRoot, outFile));
    expect(mod.hash).toBe(sha256(artifactCode));

    // Verify CAS was written
    const casDir = path.join(casRoot, configHash, sha256(artifactCode));
    expect(fs.existsSync(path.join(casDir, "transformed.js"))).toBe(true);
    expect(fs.readFileSync(path.join(casDir, "transformed.js"), "utf8")).toBe(artifactCode);
  });

  // ─── Test 2: Internal transitive modules are pruned ───
  it("prunes internal transitive node_modules modules", () => {
    const entryPath = path.join(rootDir, "node_modules", "react", "index.js");
    const internalPath = path.join(rootDir, "node_modules", "react", "cjs", "react.development.js");
    fs.mkdirSync(path.dirname(internalPath), { recursive: true });
    fs.writeFileSync(entryPath, "module.exports = require('./cjs/react.development.js');");
    fs.writeFileSync(internalPath, "// internal CJS code");

    const artifactCode = "export function createElement() {}";
    const outFile = "react@18.3.1_abc123.js";
    fs.writeFileSync(path.join(depsRoot, outFile), artifactCode);

    fs.writeFileSync(
      path.join(depsRoot, "manifest.json"),
      JSON.stringify({ entries: { [entryPath]: { outFile, package: "react@18.3.1" } } }),
    );

    const plan = makePlan([
      makeChunk("chunk-vendor", [
        makeModule("ws://node_modules/react/index.js", { fsPath: entryPath, hash: sha256("old1") }),
        makeModule("ws://node_modules/react/cjs/react.development.js", { fsPath: internalPath, hash: sha256("old2") }),
      ]),
    ]);

    const { rerouted, pruned } = rerouteDepsArtifacts({
      plan,
      depsRoot,
      casRoot,
      configHash,
      workspaceRoot: rootDir,
    });

    expect(rerouted).toBe(1);
    expect(pruned).toBe(1);
    expect(plan.chunks[0].modules).toHaveLength(1);
    expect(plan.chunks[0].modules[0].fsPath).toBe(path.join(depsRoot, outFile));
  });

  // ─── Test 3: Non-node_modules modules are untouched ───
  it("leaves non-node_modules modules untouched", () => {
    const srcPath = path.join(rootDir, "src", "main.ts");
    fs.mkdirSync(path.dirname(srcPath), { recursive: true });
    fs.writeFileSync(srcPath, "console.log('app');");

    // No manifest
    const plan = makePlan([
      makeChunk("chunk-entry", [
        makeModule("ws://src/main.ts", { fsPath: srcPath, hash: sha256("app"), kind: "js" }),
      ], { entry: true }),
    ]);

    const originalModule = { ...plan.chunks[0].modules[0] };

    const { rerouted, pruned } = rerouteDepsArtifacts({
      plan,
      depsRoot,
      casRoot,
      configHash,
      workspaceRoot: rootDir,
    });

    expect(rerouted).toBe(0);
    expect(pruned).toBe(0);
    expect(plan.chunks[0].modules).toHaveLength(1);
    expect(plan.chunks[0].modules[0].fsPath).toBe(originalModule.fsPath);
    expect(plan.chunks[0].modules[0].hash).toBe(originalModule.hash);
  });

  // ─── Test 4: Multiple deps across a single vendor chunk ───
  it("reroutes multiple deps and prunes all internal transitive modules", () => {
    // React entry + internal
    const reactEntry = path.join(rootDir, "node_modules", "react", "index.js");
    const reactInternal = path.join(rootDir, "node_modules", "react", "cjs", "react.production.min.js");
    fs.mkdirSync(path.dirname(reactInternal), { recursive: true });
    fs.writeFileSync(reactEntry, "module.exports = require('./cjs/react.production.min.js');");
    fs.writeFileSync(reactInternal, "// minified react");

    // Lodash entry + internal
    const lodashEntry = path.join(rootDir, "node_modules", "lodash", "lodash.js");
    const lodashInternal = path.join(rootDir, "node_modules", "lodash", "lodash.min.js");
    fs.mkdirSync(path.dirname(lodashInternal), { recursive: true });
    fs.writeFileSync(lodashEntry, "module.exports = {};");
    fs.writeFileSync(lodashInternal, "// minified lodash");

    const reactArtifact = "export const React = { createElement() {} };";
    const lodashArtifact = "export function debounce() {}";
    fs.writeFileSync(path.join(depsRoot, "react@18.3.1_abc123.js"), reactArtifact);
    fs.writeFileSync(path.join(depsRoot, "lodash@4.17.21_def456.js"), lodashArtifact);

    fs.writeFileSync(
      path.join(depsRoot, "manifest.json"),
      JSON.stringify({
        entries: {
          [reactEntry]: { outFile: "react@18.3.1_abc123.js", package: "react@18.3.1" },
          [lodashEntry]: { outFile: "lodash@4.17.21_def456.js", package: "lodash@4.17.21" },
        },
      }),
    );

    const plan = makePlan([
      makeChunk("chunk-vendor", [
        makeModule("ws://node_modules/react/index.js", { fsPath: reactEntry }),
        makeModule("ws://node_modules/react/cjs/react.production.min.js", { fsPath: reactInternal }),
        makeModule("ws://node_modules/lodash/lodash.js", { fsPath: lodashEntry }),
        makeModule("ws://node_modules/lodash/lodash.min.js", { fsPath: lodashInternal }),
      ]),
    ]);

    const { rerouted, pruned } = rerouteDepsArtifacts({
      plan,
      depsRoot,
      casRoot,
      configHash,
      workspaceRoot: rootDir,
    });

    expect(rerouted).toBe(2);
    expect(pruned).toBe(2);
    expect(plan.chunks[0].modules).toHaveLength(2);

    const ids = plan.chunks[0].modules.map((m) => m.id);
    expect(ids).toContain("ws://node_modules/react/index.js");
    expect(ids).toContain("ws://node_modules/lodash/lodash.js");
  });

  // ─── Test 5: Missing manifest returns zero changes ───
  it("returns zero changes when manifest is missing", () => {
    const plan = makePlan([
      makeChunk("chunk-vendor", [
        makeModule("ws://node_modules/react/index.js", {
          fsPath: path.join(rootDir, "node_modules", "react", "index.js"),
        }),
      ]),
    ]);

    const { rerouted, pruned } = rerouteDepsArtifacts({
      plan,
      depsRoot,
      casRoot,
      configHash,
      workspaceRoot: rootDir,
    });

    expect(rerouted).toBe(0);
    expect(pruned).toBe(0);
    expect(plan.chunks[0].modules).toHaveLength(1);
  });

  // ─── Test 6: Artifact hash is correctly computed from artifact bytes (not source) ───
  it("computes hash from artifact bytes, not original source", () => {
    const entryPath = path.join(rootDir, "node_modules", "lodash", "lodash.js");
    fs.mkdirSync(path.dirname(entryPath), { recursive: true });
    fs.writeFileSync(entryPath, "// ORIGINAL CJS LODASH — 600KB of code");

    const artifactCode = "export function debounce() { /* optimized ESM */ }";
    const outFile = "lodash@4.17.21_def456.js";
    fs.writeFileSync(path.join(depsRoot, outFile), artifactCode);

    fs.writeFileSync(
      path.join(depsRoot, "manifest.json"),
      JSON.stringify({ entries: { [entryPath]: { outFile, package: "lodash@4.17.21" } } }),
    );

    const oldHash = sha256("// ORIGINAL CJS LODASH — 600KB of code");
    const plan = makePlan([
      makeChunk("chunk-vendor", [
        makeModule("ws://node_modules/lodash/lodash.js", { fsPath: entryPath, hash: oldHash }),
      ]),
    ]);

    rerouteDepsArtifacts({ plan, depsRoot, casRoot, configHash, workspaceRoot: rootDir });

    const mod = plan.chunks[0].modules[0];
    expect(mod.hash).toBe(sha256(artifactCode));
    expect(mod.hash).not.toBe(oldHash);
  });

  // ─── Test 7: Mixed chunk (src + node_modules) preserves src modules ───
  it("preserves src modules in a mixed chunk containing both src and node_modules", () => {
    const srcPath = path.join(rootDir, "src", "app.tsx");
    const nmEntry = path.join(rootDir, "node_modules", "react", "index.js");
    const nmInternal = path.join(rootDir, "node_modules", "react", "cjs", "react.development.js");
    fs.mkdirSync(path.dirname(srcPath), { recursive: true });
    fs.mkdirSync(path.dirname(nmInternal), { recursive: true });
    fs.writeFileSync(srcPath, "import React from 'react';");
    fs.writeFileSync(nmEntry, "module.exports = {};");
    fs.writeFileSync(nmInternal, "// internal");

    const artifactCode = "export default {};";
    fs.writeFileSync(path.join(depsRoot, "react@18.3.1_abc.js"), artifactCode);
    fs.writeFileSync(
      path.join(depsRoot, "manifest.json"),
      JSON.stringify({ entries: { [nmEntry]: { outFile: "react@18.3.1_abc.js" } } }),
    );

    const plan = makePlan([
      makeChunk("chunk-entry", [
        makeModule("ws://src/app.tsx", { fsPath: srcPath, hash: sha256("import React from 'react';"), kind: "js" }),
        makeModule("ws://node_modules/react/index.js", { fsPath: nmEntry }),
        makeModule("ws://node_modules/react/cjs/react.development.js", { fsPath: nmInternal }),
      ], { entry: true }),
    ]);

    const { rerouted, pruned } = rerouteDepsArtifacts({
      plan,
      depsRoot,
      casRoot,
      configHash,
      workspaceRoot: rootDir,
    });

    expect(rerouted).toBe(1);
    expect(pruned).toBe(1);
    expect(plan.chunks[0].modules).toHaveLength(2);

    const srcMod = plan.chunks[0].modules.find((m) => m.id === "ws://src/app.tsx");
    expect(srcMod).toBeDefined();
    expect(srcMod!.fsPath).toBe(srcPath);
    expect(srcMod!.hash).toBe(sha256("import React from 'react';"));

    const reactMod = plan.chunks[0].modules.find((m) => m.id === "ws://node_modules/react/index.js");
    expect(reactMod).toBeDefined();
    expect(reactMod!.fsPath).toBe(path.join(depsRoot, "react@18.3.1_abc.js"));
  });

  // ─── Test 8: CAS artifact is not overwritten if already present ───
  it("does not overwrite CAS artifact if it already exists", () => {
    const entryPath = path.join(rootDir, "node_modules", "react", "index.js");
    fs.mkdirSync(path.dirname(entryPath), { recursive: true });
    fs.writeFileSync(entryPath, "module.exports = {};");

    const artifactCode = "export const React = {};";
    const outFile = "react@18.3.1_abc.js";
    fs.writeFileSync(path.join(depsRoot, outFile), artifactCode);

    fs.writeFileSync(
      path.join(depsRoot, "manifest.json"),
      JSON.stringify({ entries: { [entryPath]: { outFile } } }),
    );

    // Pre-populate CAS with existing content
    const artifactHash = sha256(artifactCode);
    const casDir = path.join(casRoot, configHash, artifactHash);
    fs.mkdirSync(casDir, { recursive: true });
    const existingContent = "// EXISTING CAS CONTENT — should not be overwritten";
    fs.writeFileSync(path.join(casDir, "transformed.js"), existingContent);

    const plan = makePlan([
      makeChunk("chunk-vendor", [
        makeModule("ws://node_modules/react/index.js", { fsPath: entryPath }),
      ]),
    ]);

    rerouteDepsArtifacts({ plan, depsRoot, casRoot, configHash, workspaceRoot: rootDir });

    // CAS should NOT have been overwritten
    const casContent = fs.readFileSync(path.join(casDir, "transformed.js"), "utf8");
    expect(casContent).toBe(existingContent);
  });

  // ─── Test 9: Scoped package entry is correctly rerouted ───
  it("reroutes scoped package entries (@scope/pkg)", () => {
    const entryPath = path.join(rootDir, "node_modules", "@radix-ui", "react-dialog", "dist", "index.mjs");
    fs.mkdirSync(path.dirname(entryPath), { recursive: true });
    fs.writeFileSync(entryPath, "export const Dialog = {};");

    const artifactCode = "export const Dialog = { /* optimized */ };";
    const outFile = "@radix-ui__react-dialog@1.0.0_abc.js";
    fs.writeFileSync(path.join(depsRoot, outFile), artifactCode);

    fs.writeFileSync(
      path.join(depsRoot, "manifest.json"),
      JSON.stringify({ entries: { [entryPath]: { outFile } } }),
    );

    const plan = makePlan([
      makeChunk("chunk-vendor", [
        makeModule("ws://node_modules/@radix-ui/react-dialog/dist/index.mjs", { fsPath: entryPath }),
      ]),
    ]);

    const { rerouted, pruned } = rerouteDepsArtifacts({
      plan,
      depsRoot,
      casRoot,
      configHash,
      workspaceRoot: rootDir,
    });

    expect(rerouted).toBe(1);
    expect(pruned).toBe(0);
    expect(plan.chunks[0].modules[0].fsPath).toBe(path.join(depsRoot, outFile));
    expect(plan.chunks[0].modules[0].hash).toBe(sha256(artifactCode));
  });

  // ─── Test 10: Module with only id (no fsPath) and containing node_modules ───
  it("prunes modules identified by id containing node_modules when no fsPath is set", () => {
    const entryPath = path.join(rootDir, "node_modules", "react", "index.js");
    fs.mkdirSync(path.dirname(entryPath), { recursive: true });
    fs.writeFileSync(entryPath, "module.exports = {};");

    const artifactCode = "export default {};";
    fs.writeFileSync(path.join(depsRoot, "react@18.3.1_abc.js"), artifactCode);
    fs.writeFileSync(
      path.join(depsRoot, "manifest.json"),
      JSON.stringify({ entries: { [entryPath]: { outFile: "react@18.3.1_abc.js" } } }),
    );

    // Module with only id (as an absolute path), no fsPath set
    const plan = makePlan([
      makeChunk("chunk-vendor", [
        makeModule(entryPath, { fsPath: null }),
      ]),
    ]);

    const { rerouted, pruned } = rerouteDepsArtifacts({
      plan,
      depsRoot,
      casRoot,
      configHash,
      workspaceRoot: rootDir,
    });

    // The id is an absolute path containing node_modules, fsPath resolves from it,
    // and it matches the manifest entry, so it should be rerouted.
    expect(rerouted).toBe(1);
    expect(pruned).toBe(0);
  });

  // ─── Test 11: Empty plan chunks are handled gracefully ───
  it("handles empty chunks gracefully", () => {
    fs.writeFileSync(
      path.join(depsRoot, "manifest.json"),
      JSON.stringify({ entries: {} }),
    );

    const plan = makePlan([makeChunk("chunk-empty", [])]);

    const { rerouted, pruned } = rerouteDepsArtifacts({
      plan,
      depsRoot,
      casRoot,
      configHash,
      workspaceRoot: rootDir,
    });

    expect(rerouted).toBe(0);
    expect(pruned).toBe(0);
    expect(plan.chunks[0].modules).toHaveLength(0);
  });

  // ─── Test 12: Manifest with snake_case out_file is handled ───
  it("handles manifest entries with snake_case out_file field", () => {
    const entryPath = path.join(rootDir, "node_modules", "lodash", "lodash.js");
    fs.mkdirSync(path.dirname(entryPath), { recursive: true });
    fs.writeFileSync(entryPath, "module.exports = {};");

    const artifactCode = "export function debounce() {}";
    const outFile = "lodash@4.17.21_def456.js";
    fs.writeFileSync(path.join(depsRoot, outFile), artifactCode);

    // Use snake_case "out_file" instead of "outFile"
    fs.writeFileSync(
      path.join(depsRoot, "manifest.json"),
      JSON.stringify({ entries: { [entryPath]: { out_file: outFile } } }),
    );

    const plan = makePlan([
      makeChunk("chunk-vendor", [
        makeModule("ws://node_modules/lodash/lodash.js", { fsPath: entryPath }),
      ]),
    ]);

    const { rerouted } = rerouteDepsArtifacts({
      plan,
      depsRoot,
      casRoot,
      configHash,
      workspaceRoot: rootDir,
    });

    expect(rerouted).toBe(1);
    expect(plan.chunks[0].modules[0].hash).toBe(sha256(artifactCode));
  });
});
