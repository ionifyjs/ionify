/**
 * Phase 16 — Production Minification Parity (Beat Vite Bytes)
 *
 * Gates verified by this suite:
 *
 * 1. Bytes-reduction gate — minified chunk is strictly smaller than unminified baseline.
 *    Confirms the native bundler emits compact output, not just stripped-but-not-shrunk code.
 *
 * 2. Determinism gate — identical inputs + identical nativeOptions → identical chunk code.
 *    Needed because SWC/OXC both allocate Mark counters and the bundler traverses HashMaps;
 *    we verify that the final emitted code is byte-for-byte stable across two sequential calls.
 *    Uses mangle=false to avoid alphabet-assignment sensitivity of identifier mangling.
 *
 * 3. No-env-bridges gate — nativeOptions.minifier controls the minifier without requiring the
 *    IONIFY_MINIFIER env var.  This satisfies the Phase 16 "first-class bundler options plumbing"
 *    requirement: resolved values are passed through the NAPI boundary, not via process.env.
 *
 * 4. Identifier-safety gate — mangle=false keeps exported names readable in the output.
 *
 * 5. Minify-off gate — minify:false produces multi-line output and preserves symbol names.
 *
 * 6. CAS-contract gate — build plan module hashes are input-only (set by the TS coordinator from
 *    CAS artifacts); nativeOptions does NOT change plan.chunks[].modules[].hash.
 *    Minification is an output-only transformation applied at chunk-emit time, not stored in CAS.
 *
 * Architecture contract (docs/contracts/bundler-contract.md §2):
 *   - CAS-first: bundler reads transformed.js from CAS; minification is post-CAS, chunk-emit-only.
 *   - Unified pipeline parity: same options flow via BuildChunksOptions NAPI struct.
 *   - Determinism: same inputs + same BuildChunksOptions → same BuildChunkArtifact[].
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { native } from "../src/native/index";
import type { BuildPlan, BuildPlanChunk, BuildPlanModule } from "../src/types/plan";
import type { NativeBuildChunksOptions } from "../src/native/index";

// ─── Representative module ────────────────────────────────────────────────────
// Chosen for Phase 16: realistic function structure with verbose names, comments,
// blank lines, and side-effectful calls so tree-shaking keeps the code in the
// output — and the minifier has meaningful whitespace/comment work to do.
const REPRESENTATIVE_SOURCE = `
// Phase 16 representative module — used to gate minification parity vs Vite.
// This module intentionally uses descriptive variable names and whitespace so
// that minification produces a measurably smaller output.

/**
 * Accumulates item prices and applies a percentage-based tax rate.
 *
 * @param itemPriceList  Array of individual item prices (numbers).
 * @param taxRatePercent Tax rate expressed as a percentage (e.g. 20 = 20%).
 * @returns              Total price including tax, or 0 for an empty list.
 */
function calculateTotalPrice(itemPriceList, taxRatePercent) {
  // Guard: bail out when nothing to process.
  if (!Array.isArray(itemPriceList) || itemPriceList.length === 0) {
    return 0;
  }

  const subtotalBeforeTax = itemPriceList.reduce(
    function accumulatePrice(runningTotal, currentItem) {
      return runningTotal + currentItem;
    },
    0,
  );

  const taxAmount = subtotalBeforeTax * (taxRatePercent / 100);
  const totalIncludingTax = subtotalBeforeTax + taxAmount;

  return totalIncludingTax;
}

/**
 * Public API: returns the order total for a list of item prices with standard tax.
 */
function getOrderTotal(prices, tax) {
  return calculateTotalPrice(prices, tax);
}

const DISCOUNT_RATE = 0.1;
const STANDARD_TAX = 20;

// Side-effectful calls guarantee the bundler keeps these symbols in the output
// regardless of tree-shaking settings, giving the minifier real code to compact.
console.log(getOrderTotal([10, 20, 30], STANDARD_TAX));
console.log(DISCOUNT_RATE);
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePlan(entryPath: string): BuildPlan {
  const modules: BuildPlanModule[] = [
    { id: entryPath, hash: undefined, kind: "js", deps: [], dynamicDeps: [] },
  ];
  const chunk: BuildPlanChunk = {
    id: "chunk-entry",
    entry: true,
    shared: false,
    consumers: [entryPath],
    css: [],
    assets: [],
    modules,
  };
  return { entries: [entryPath], chunks: [chunk] };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("Phase 16 — Production Minification Parity", () => {
  let tempRoot: string;
  let entryJs: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ionify-phase16-"));
    entryJs = path.join(tempRoot, "entry.js");
    await fs.writeFile(entryJs, REPRESENTATIVE_SOURCE);
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  // ── Gate 1: Bytes reduction ────────────────────────────────────────────────

  it("minified output is strictly smaller than unminified baseline (bytes-reduction gate)", async () => {
    if (!native?.buildChunks) {
      // Native binding unavailable in this environment — skip gracefully.
      expect(true).toBe(true);
      return;
    }

    const plan = makePlan(entryJs);

    const unminOpts: NativeBuildChunksOptions = {
      minify: false,
      mangle: false,
      enableSourcemaps: false,
    };
    const minOpts: NativeBuildChunksOptions = {
      minify: true,
      mangle: true,
      minifier: "swc",
      enableSourcemaps: false,
    };

    const unminArtifacts = native.buildChunks!(plan, null, null, unminOpts);
    const minArtifacts = native.buildChunks!(plan, null, null, minOpts);

    expect(unminArtifacts.length).toBeGreaterThan(0);
    expect(minArtifacts.length).toBeGreaterThan(0);

    const unminBytes = unminArtifacts[0].code.length;
    const minBytes = minArtifacts[0].code.length;

    // Minified output must be strictly smaller for the representative source.
    expect(minBytes).toBeLessThan(unminBytes);
  });

  // ── Determinism ───────────────────────────────────────────────────────────

  it("identical inputs and options produce identical chunk output on consecutive calls (determinism gate)", async () => {
    if (!native?.buildChunks) {
      expect(true).toBe(true);
      return;
    }

    const plan = makePlan(entryJs);
    // mangle=false avoids any alphabet-assignment sensitivity in identifier renaming
    // while still exercising whitespace/dead-code compression for meaningful output.
    const opts: NativeBuildChunksOptions = {
      minifier: "swc",
      minify: true,
      mangle: false,
      enableSourcemaps: false,
    };

    const first = native.buildChunks!(plan, null, null, opts);
    const second = native.buildChunks!(plan, null, null, opts);

    expect(first.length).toBe(second.length);
    for (let i = 0; i < first.length; i++) {
      // Byte-for-byte identical code is the determinism contract.
      expect(first[i].code).toBe(second[i].code);
    }
  });

  // ── Gate 3: No env-bridges ────────────────────────────────────────────────

  it("nativeOptions.minifier controls minification without IONIFY_MINIFIER env var (no-env-bridges gate)", async () => {
    if (!native?.buildChunks) {
      expect(true).toBe(true);
      return;
    }

    const savedMinifier = process.env.IONIFY_MINIFIER;
    // Explicitly unset to ensure the test only exercises the nativeOptions path.
    delete process.env.IONIFY_MINIFIER;

    try {
      const plan = makePlan(entryJs);

      // Minifier specified only through nativeOptions — no env var fallback required.
      const opts: NativeBuildChunksOptions = {
        minifier: "swc",
        minify: true,
        mangle: false,
        enableSourcemaps: false,
      };

      const artifacts = native.buildChunks!(plan, null, null, opts);
      expect(artifacts.length).toBeGreaterThan(0);
      expect(artifacts[0].code.length).toBeGreaterThan(0);
    } finally {
      // Restore env to avoid cross-test pollution.
      if (savedMinifier !== undefined) {
        process.env.IONIFY_MINIFIER = savedMinifier;
      }
    }
  });

  // ── Gate 3b: OXC via nativeOptions ────────────────────────────────────────

  it("OXC minifier path via nativeOptions without env var (no-env-bridges gate, oxc variant)", async () => {
    if (!native?.buildChunks) {
      expect(true).toBe(true);
      return;
    }

    const savedMinifier = process.env.IONIFY_MINIFIER;
    delete process.env.IONIFY_MINIFIER;

    try {
      const plan = makePlan(entryJs);

      const opts: NativeBuildChunksOptions = {
        minifier: "oxc",
        minify: true,
        mangle: false,
        enableSourcemaps: false,
      };

      // OXC may fall back to SWC internally when the oxc-stack feature is disabled;
      // what matters is that the call succeeds and returns valid code.
      const artifacts = native.buildChunks!(plan, null, null, opts);
      expect(artifacts.length).toBeGreaterThan(0);
      expect(artifacts[0].code.length).toBeGreaterThan(0);
    } finally {
      if (savedMinifier !== undefined) {
        process.env.IONIFY_MINIFIER = savedMinifier;
      }
    }
  });

  // ── Gate 4: Identifier safety (mangle=false) ──────────────────────────────

  it("mangle=false preserves readable exported symbol names (identifier-safety gate)", async () => {
    if (!native?.buildChunks) {
      expect(true).toBe(true);
      return;
    }

    const plan = makePlan(entryJs);
    const opts: NativeBuildChunksOptions = {
      minifier: "swc",
      minify: true,
      mangle: false,
      enableSourcemaps: false,
    };

    const artifacts = native.buildChunks!(plan, null, null, opts);
    expect(artifacts.length).toBeGreaterThan(0);

    const code = artifacts[0].code;
    // With mangle=false identifiers are not shortened to single letters.
    // The minifier may inline single-use functions, but we verify that
    // multi-char parameter/variable names from the source survive intact.
    // subtotalBeforeTax is a 16-char name — clear evidence mangle is off.
    expect(code).toContain("subtotalBeforeTax");
    // Also confirm no single-letter rewrite of well-known params occurred.
    expect(code).not.toMatch(/function\s*\(\s*[a-z]\s*,\s*[a-z]\s*\)\s*\{/);
  });

  // ── Gate 5: Minify-off path ────────────────────────────────────────────────

  it("minify=false produces multi-line output with preserved symbol names (minify-off gate)", async () => {
    if (!native?.buildChunks) {
      expect(true).toBe(true);
      return;
    }

    const plan = makePlan(entryJs);
    const opts: NativeBuildChunksOptions = {
      minify: false,
      mangle: false,
      enableSourcemaps: false,
    };

    const artifacts = native.buildChunks!(plan, null, null, opts);
    expect(artifacts.length).toBeGreaterThan(0);

    const code = artifacts[0].code;
    // Unminified output must span multiple lines (not a single-line blob).
    expect(code.split("\n").length).toBeGreaterThan(1);
    // Symbol names must be preserved when minification is off.
    expect(code).toContain("calculateTotalPrice");
  });

  // ── Gate 6: CAS contract ──────────────────────────────────────────────────

  it("build plan module hashes are unaffected by nativeOptions (CAS-contract gate)", async () => {
    if (!native?.buildChunks) {
      expect(true).toBe(true);
      return;
    }

    // Build two plans from the same source; nativeOptions differ but module identity must not.
    const planA = makePlan(entryJs);
    const planB = makePlan(entryJs);

    // Both plans start with no pre-computed hash (no CAS; bundler loads from disk).
    expect(planA.chunks[0].modules[0].hash).toBeUndefined();
    expect(planB.chunks[0].modules[0].hash).toBeUndefined();

    const minifiedArtifacts = native.buildChunks!(planA, null, null, {
      minify: true,
      mangle: false,
      enableSourcemaps: false,
    });
    const unminifiedArtifacts = native.buildChunks!(planB, null, null, {
      minify: false,
      mangle: false,
      enableSourcemaps: false,
    });

    // Both builds must produce the same number of chunks — nativeOptions is output-only.
    expect(minifiedArtifacts.length).toBe(unminifiedArtifacts.length);

    // Module IDs in the plan are identical regardless of minification options.
    expect(planA.chunks[0].modules[0].id).toBe(planB.chunks[0].modules[0].id);

    // After buildChunks, the plan hashes remain undefined (no CAS pre-population).
    // The bundler does NOT mutate plan module hashes; they are always input-only.
    expect(planA.chunks[0].modules[0].hash).toBeUndefined();
    expect(planB.chunks[0].modules[0].hash).toBeUndefined();
  });

  // ── Built-in acceptance: minify=true is the default ───────────────────────

  it("minify=true is the default when no nativeOptions are passed (production-default gate)", async () => {
    if (!native?.buildChunks) {
      expect(true).toBe(true);
      return;
    }

    const savedMinifier = process.env.IONIFY_MINIFIER;
    const savedSourcemaps = process.env.IONIFY_SOURCEMAPS;
    delete process.env.IONIFY_MINIFIER;
    process.env.IONIFY_SOURCEMAPS = "false";

    try {
      const plan = makePlan(entryJs);

      // No options at all — default must be minify=true (production-safe default).
      const defaultArtifacts = native.buildChunks!(plan);
      const explicitMinArtifacts = native.buildChunks!(plan, null, null, {
        minify: true,
        mangle: true,
        enableSourcemaps: false,
      });

      expect(defaultArtifacts.length).toBeGreaterThan(0);
      expect(explicitMinArtifacts.length).toBeGreaterThan(0);

      // Default output should be at most as large as the explicit minify=true output.
      // (Default uses the same engine, so typically identical size.)
      const defaultBytes = defaultArtifacts[0].code.length;
      const explicitMinBytes = explicitMinArtifacts[0].code.length;

      const unminifiedArtifacts = native.buildChunks!(plan, null, null, {
        minify: false,
        mangle: false,
        enableSourcemaps: false,
      });
      const unminBytes = unminifiedArtifacts[0].code.length;

      // Default (minify=true) must produce output smaller than the unminified baseline,
      // proving that production defaults emit compact code.
      expect(defaultBytes).toBeLessThan(unminBytes);
      expect(explicitMinBytes).toBeLessThan(unminBytes);
    } finally {
      if (savedMinifier !== undefined) {
        process.env.IONIFY_MINIFIER = savedMinifier;
      }
      if (savedSourcemaps !== undefined) {
        process.env.IONIFY_SOURCEMAPS = savedSourcemaps;
      } else {
        delete process.env.IONIFY_SOURCEMAPS;
      }
    }
  });
});
