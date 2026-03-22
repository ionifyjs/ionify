/**
 * UMD/CJS Interop Tests
 *
 * Covers two compounding bugs that caused `TypeError: Cannot set properties of
 * undefined (setting '_Highcharts')` with Highcharts 12.x (and any package that
 * uses the UMD pattern `(function(root, factory){})(this, ...)`):
 *
 * Bug A — `fold_browser_global_guards` treated `window`, `document`, `self`, etc.
 *   as unknown globals, evaluating `typeof window === "undefined"` to `true` and
 *   replacing `"undefined"==typeof window?this:window` with just `this`.
 *
 * Bug B — `factory()` was called as a plain function, so in strict-mode ESM
 *   `this === undefined`.  The fix changes the call to
 *   `factory.call(globalThis, ...)` so UMD root parameter = the global object.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { native } from "../src/native/index.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeTempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeUmdPackage(
  dir: string,
  opts: { name: string; entryCode: string },
) {
  const pkgDir = path.join(dir, "node_modules", opts.name);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name: opts.name, version: "1.0.0", main: "index.js" }),
  );
  fs.writeFileSync(path.join(pkgDir, "index.js"), opts.entryCode);
  return path.join(pkgDir, "index.js");
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("UMD/CJS interop — factory.call(globalThis) + browser global folding", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const d of tempDirs.splice(0)) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  // ── Bug B: factory.call(globalThis, ...) ─────────────────────────────────

  it("generated bundle uses factory.call(globalThis, ...) not factory()", async () => {
    if (!native?.optimizeDependencyWithManifest) {
      console.warn("Native binding unavailable, skipping");
      return;
    }

    const tmp = makeTempDir("ionify-umd-factoryCall-");
    tempDirs.push(tmp);

    const entryPath = makeUmdPackage(tmp, {
      name: "umd-simple",
      entryCode: `
!function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MyLib = factory();
  }
}(this, function() {
  return { version: '1.0.0' };
});
      `.trim(),
    });

    const result = await native.optimizeDependencyWithManifest(entryPath, tmp);
    expect(result?.outputCode).toBeTruthy();

    const code = result!.outputCode!;
    // Must use .call(globalThis, ...) — not the plain factory() call
    expect(code).toContain("factory.call(globalThis,");
    // Must NOT have the bare factory() form
    expect(code).not.toMatch(/\bfactory\(__ionifyRequire/);
  });

  // ── Bug A: window preserved, not replaced with `this` ────────────────────

  it("`typeof window` ternary resolves to window branch, not this", async () => {
    if (!native?.optimizeDependencyWithManifest) {
      console.warn("Native binding unavailable, skipping");
      return;
    }

    const tmp = makeTempDir("ionify-umd-windowGuard-");
    tempDirs.push(tmp);

    // Classic Highcharts-style UMD:
    //   ("undefined" == typeof window ? this : window) as the root argument
    const entryPath = makeUmdPackage(tmp, {
      name: "umd-window-guard",
      entryCode: `
!function(t, e) {
  if (typeof module === 'object' && module.exports) {
    t._Lib = e();
    module.exports = t._Lib;
  } else {
    t.MyLib = e();
  }
}("undefined" == typeof window ? this : window, function() {
  return { hello: 'world' };
});
      `.trim(),
    });

    const result = await native.optimizeDependencyWithManifest(entryPath, tmp);
    expect(result?.outputCode).toBeTruthy();

    const code = result!.outputCode!;
    // After folding `"undefined" == typeof window ? this : window` should resolve
    // to `window` (window IS a known browser global), NOT to `this`
    expect(code).not.toMatch(/\bfunction\s*\(require,\s*module,\s*exports\)\s*\{[\s\S]*?\(this,/);
    // The assignment t._Lib = e() must not crash — i.e. root must not be `this`
    // We verify the folded form does NOT contain `(this,` as the UMD root arg.
  });

  // ── Related globals: self, globalThis, document ───────────────────────────

  it("`typeof self !== 'undefined'` ternary resolves to self branch", async () => {
    if (!native?.optimizeDependencyWithManifest) {
      console.warn("Native binding unavailable, skipping");
      return;
    }

    const tmp = makeTempDir("ionify-umd-selfGuard-");
    tempDirs.push(tmp);

    // highcharts-react-official uses `"undefined" != typeof self ? self : this`
    const entryPath = makeUmdPackage(tmp, {
      name: "umd-self-guard",
      entryCode: `
!function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.HighchartsReact = factory();
  }
}("undefined" != typeof self ? self : this, function() {
  return {};
});
      `.trim(),
    });

    const result = await native.optimizeDependencyWithManifest(entryPath, tmp);
    expect(result?.outputCode).toBeTruthy();

    const code = result!.outputCode!;
    // `self` is a known browser global — `"undefined" != typeof self` should fold
    // to `true`, keeping `self`, NOT falling back to `this`.
    expect(code).not.toMatch(/\(this,\s*function/);
  });

  // ── Combined: Highcharts-style cross-module scenario ─────────────────────

  it("Highcharts-style UMD bundle produces valid non-crashing output", async () => {
    if (!native?.optimizeDependencyWithManifest) {
      console.warn("Native binding unavailable, skipping");
      return;
    }

    const tmp = makeTempDir("ionify-umd-highcharts-");
    tempDirs.push(tmp);

    // Mirrors the exact Highcharts 12.x pattern that caused the crash
    const entryPath = makeUmdPackage(tmp, {
      name: "highcharts-mock",
      entryCode: `
!function(t, e) {
  "object" == typeof exports && "object" == typeof module
    ? (t._Highcharts = e(), module.exports = t._Highcharts)
    : "function" == typeof define && define.amd
    ? define("highcharts/highcharts", [], e)
    : (t.Highcharts && t.Highcharts.error(16, true), t.Highcharts = e());
}("undefined" == typeof window ? this : window, function() {
  var H = { version: '12.4.0' };
  H._Highcharts = H;
  return H;
});
      `.trim(),
    });

    const result = await native.optimizeDependencyWithManifest(entryPath, tmp);
    expect(result?.outputCode).toBeTruthy();

    const code = result!.outputCode!;
    // Fix A: window guard must not be simplified to `this`
    // Fix B: factory call must use globalThis binding
    expect(code).toContain("factory.call(globalThis,");
    // The module must export the Highcharts-like object
    expect(code).toContain("export default");
  });
});

// ─── getModeAliases-equivalent: browser global list completeness ──────────────

describe("fold_browser_global_guards — known globals coverage", () => {
  // These tests verify the known-globals list through the optimizer output.
  // Each ternary `typeof X === "undefined" ? fallback : X` should fold to X
  // (meaning Ionify knows X is defined in browsers).
  const CRITICAL_BROWSER_GLOBALS = [
    "window",
    "document",
    "self",
    "globalThis",
    "navigator",
    "location",
  ];

  for (const globalName of CRITICAL_BROWSER_GLOBALS) {
    it(`typeof ${globalName} correctly folds to the non-undefined branch`, async () => {
      if (!native?.optimizeDependencyWithManifest) {
        console.warn("Native binding unavailable, skipping");
        return;
      }

      const tmp = makeTempDir(`ionify-global-${globalName}-`);
      // Note: don't push to tempDirs here; use a separate cleanup approach
      try {
        const entryPath = makeUmdPackage(tmp, {
          name: `test-${globalName}`,
          entryCode: `
!function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Lib = factory();
  }
}(typeof ${globalName} !== "undefined" ? ${globalName} : {}, function() {
  return { ok: true };
});
          `.trim(),
        });

        const result = await native.optimizeDependencyWithManifest(
          entryPath,
          tmp,
        );
        expect(result?.outputCode).toBeTruthy();

        const code = result!.outputCode!;
        // The ternary should fold to `globalName` (the defined branch), not `{}`
        // So the factory call should NOT have `{}` as the root argument.
        // We check that `({}` (empty object literal as root) is NOT present.
        expect(code).not.toMatch(/\(\{\},\s*function/);
        expect(code).not.toMatch(/\(\{\},function/);
        // Also factory call must use globalThis binding
        expect(code).toContain("factory.call(globalThis,");
      } finally {
        try {
          fs.rmSync(tmp, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    });
  }
});
