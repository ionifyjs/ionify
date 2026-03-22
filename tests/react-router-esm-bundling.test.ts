/**
 * Phase 5.9.1 — ESM Deps Bundling Integration Test
 *
 * Validates that ESM packages (like @remix-run/router and react-router-dom)
 * are properly bundled with synthesized named exports instead of being served
 * as thin proxies that break when the browser can't resolve re-exports.
 *
 * Bug reproduced: `/@deps/remix-run__router@1.23.2__dist__router_*.js` was a
 * proxy (`export * from "/@fs/..."`) — the browser couldn't find
 * `AbortedDeferredError` because the proxied file's exports are only visible
 * via static analysis, not through `export *` re-export of CJS-in-ESM code.
 *
 * Fix: Phase 5.9.1 bundles ALL deps (ESM + CJS) through the same pipeline,
 * producing self-contained modules with explicit named ESM exports.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { native } from "../src/native/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findPackageDistFile(pkgName: string, distPath: string): string | null {
  const root = process.cwd();
  // pnpm flat lookup
  const flatPath = path.join(root, "node_modules", pkgName, distPath);
  if (fs.existsSync(flatPath)) return flatPath;

  // pnpm .pnpm store lookup — walk the directory to find the package
  const pnpmDir = path.join(root, "node_modules", ".pnpm");
  if (!fs.existsSync(pnpmDir)) return null;

  const safeName = pkgName.replace(/\//g, "+").replace(/@/g, "");
  for (const entry of fs.readdirSync(pnpmDir)) {
    if (!entry.startsWith(safeName) && !entry.startsWith("@" + safeName)) continue;
    const candidate = path.join(pnpmDir, entry, "node_modules", pkgName, distPath);
    if (fs.existsSync(candidate)) return candidate;
  }

  // Also try with @ prefix for scoped packages
  const scopedName = pkgName.replace("/", "+");
  for (const entry of fs.readdirSync(pnpmDir)) {
    if (!entry.includes(scopedName)) continue;
    const candidate = path.join(pnpmDir, entry, "node_modules", pkgName, distPath);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

describe("Phase 5.9.1: ESM Deps Bundling", () => {
  const testDepsDir = path.join(__dirname, ".ionify-test-esm-bundling");

  beforeEach(() => {
    if (fs.existsSync(testDepsDir)) {
      fs.rmSync(testDepsDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDepsDir)) {
      fs.rmSync(testDepsDir, { recursive: true, force: true });
    }
  });

  it("@remix-run/router ESM exports are preserved in bundled output", () => {
    if (!native?.optimizeDependency) {
      console.warn("Native optimizer not available, skipping");
      return;
    }

    const routerEntry = findPackageDistFile(
      "@remix-run/router",
      "dist/router.js"
    );
    if (!routerEntry) {
      console.warn("@remix-run/router not installed, skipping");
      return;
    }

    // Verify the source file is ESM (this is the precondition for the bug)
    const source = fs.readFileSync(routerEntry, "utf8");
    expect(source).toContain("export {");
    expect(source).not.toContain("module.exports");

    try {
      const result = native.optimizeDependency(
        routerEntry,
        "test-esm-bundling",
        false, // no sourcemap
        true   // bundle ESM (Phase 5.9.1)
      );

      expect(result).toBeTruthy();
      const outPath = (result as any).outPath ?? (result as any).out_path;
      expect(outPath).toBeTruthy();
      expect(fs.existsSync(outPath)).toBe(true);

      const output = fs.readFileSync(outPath, "utf8");

      // CRITICAL: Output must NOT be a thin proxy
      expect(output).not.toContain("import * as __ionify_mod");
      expect(output).not.toContain("export * from");

      // CRITICAL: Must have the bundled module wrapper
      expect(output).toContain("__ionifyModules");
      expect(output).toContain("__ionifyRequire");

      // CRITICAL: Named exports must be present (this is the bug that was reported)
      expect(output).toContain("AbortedDeferredError");
      expect(output).toContain("createRouter");
      expect(output).toContain("createMemoryHistory");
      expect(output).toContain("createBrowserHistory");

      // Should have proper ESM export syntax
      expect(output).toContain("export default");
      expect(output).toMatch(/export\s*\{/);
    } finally {
      // Clean up only the test-specific deps hash subdirectory to avoid
      // race conditions with other parallel tests that also use .ionify/
      try {
        const depsDir = path.join(process.cwd(), ".ionify", "deps", "test-esm-bundling");
        if (fs.existsSync(depsDir)) {
          fs.rmSync(depsDir, { recursive: true, force: true });
        }
      } catch {}
    }
  });

  it("react-router-dom ESM entry is bundled with named exports", () => {
    if (!native?.optimizeDependency) {
      console.warn("Native optimizer not available, skipping");
      return;
    }

    const rrdEntry = findPackageDistFile(
      "react-router-dom",
      "dist/index.js"
    );
    if (!rrdEntry) {
      console.warn("react-router-dom not installed, skipping");
      return;
    }

    const source = fs.readFileSync(rrdEntry, "utf8");
    // react-router-dom's dist/index.js is ESM with re-exports from react-router
    expect(source).toContain("export {");
    expect(source).toContain("import ");

    try {
      const result = native.optimizeDependency(
        rrdEntry,
        "test-esm-bundling",
        false,
        true
      );

      expect(result).toBeTruthy();
      const outPath = (result as any).outPath ?? (result as any).out_path;
      const output = fs.readFileSync(outPath, "utf8");
      expect(output).not.toContain("import * as __ionify_mod");

      // Must have bundled runtime
      expect(output).toContain("__ionifyModules");

      // Must have react-router-dom specific exports
      expect(output).toContain("BrowserRouter");
      expect(output).toContain("Link");
      expect(output).toContain("useNavigate");
      expect(output).toContain("useSearchParams");
    } finally {
      try {
        const depsDir = path.join(process.cwd(), ".ionify", "deps", "test-esm-bundling");
        if (fs.existsSync(depsDir)) {
          fs.rmSync(depsDir, { recursive: true, force: true });
        }
      } catch {}
    }
  });

  it("ESM bundle injects SWC interop helpers when needed", () => {
    if (!native?.optimizeDependency) {
      console.warn("Native optimizer not available, skipping");
      return;
    }

    const routerEntry = findPackageDistFile(
      "@remix-run/router",
      "dist/router.js"
    );
    if (!routerEntry) {
      console.warn("@remix-run/router not installed, skipping");
      return;
    }

    try {
      const result = native.optimizeDependency(
        routerEntry,
        "test-esm-interop",
        false,
        true
      );

      expect(result).toBeTruthy();
      const outPath = (result as any).outPath ?? (result as any).out_path;
      const output = fs.readFileSync(outPath, "utf8");

      // If interop helpers are referenced, they must be defined
      if (output.includes("_interop_require_wildcard(")) {
        expect(output).toContain("function _interop_require_wildcard");
        expect(output).toContain("function _getRequireWildcardCache");
      }
      if (output.includes("_interop_require_default(")) {
        expect(output).toContain("function _interop_require_default");
      }
      if (output.includes("_export_star(")) {
        expect(output).toContain("function _export_star");
      }

      // No undefined helper references (the bug from the reverted attempt)
      // Check the output is self-contained
      expect(output).not.toMatch(
        /\b_interop_require_wildcard\b(?![\s\S]*function\s+_interop_require_wildcard)/
      );
    } finally {
      try {
        const depsDir = path.join(process.cwd(), ".ionify", "deps", "test-esm-interop");
        if (fs.existsSync(depsDir)) {
          fs.rmSync(depsDir, { recursive: true, force: true });
        }
      } catch {}
    }
  });

  it("bundleEsm=false still produces ESM proxy for pure ESM files", () => {
    if (!native?.optimizeDependency) {
      console.warn("Native optimizer not available, skipping");
      return;
    }

    // Use a package whose ESM markers are in the first 16KB (is_esm_package heuristic).
    // @remix-run/router's export {} is at the end of 198KB — heuristic misses it.
    // Create a small fixture file instead.
    const tempDir = path.join(process.cwd(), ".ionify-test-proxy-fixture");
    const pkgDir = path.join(tempDir, "node_modules", "esm-test-pkg");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "esm-test-pkg", version: "1.0.0" })
    );
    const entryFile = path.join(pkgDir, "index.js");
    fs.writeFileSync(
      entryFile,
      "export const foo = 42;\nexport function bar() { return foo; }\n"
    );

    try {
      const result = native.optimizeDependency(
        entryFile,
        "test-esm-proxy-compat",
        false,
        false // bundleEsm disabled → should produce proxy for detected ESM
      );

      expect(result).toBeTruthy();
      const outPath = (result as any).outPath ?? (result as any).out_path;
      const output = fs.readFileSync(outPath, "utf8");

      // When ESM bundling is disabled, detected-ESM files should produce a proxy
      expect(output).toContain("import * as __ionify_mod");
      expect(output).toContain("export *");
    } finally {
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
        const depsDir = path.join(process.cwd(), ".ionify", "deps", "test-esm-proxy-compat");
        if (fs.existsSync(depsDir)) {
          fs.rmSync(depsDir, { recursive: true, force: true });
        }
      } catch {}
    }
  });
});
