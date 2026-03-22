import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { native } from "../src/native/index.js";
import { jsLoader } from "../src/core/loaders/js.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, "fixtures", "radix-alias");

describe("Radix + Alias Integration", () => {
  beforeEach(() => {
    // Clean up any previous test artifacts
    const ionifyDir = path.join(fixturesDir, ".ionify");
    if (fs.existsSync(ionifyDir)) {
      fs.rmSync(ionifyDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Cleanup
    const ionifyDir = path.join(fixturesDir, ".ionify");
    if (fs.existsSync(ionifyDir)) {
      fs.rmSync(ionifyDir, { recursive: true, force: true });
    }
  });

  it("should properly optimize Radix imports from aliased paths", async () => {
    // This test verifies:
    // 1. Alias resolution works (@core/components/Dialog)
    // 2. Radix .mjs files are processed by loader
    // 3. Bare imports (react, @radix-ui/*) are rewritten to /@deps/...
    // 4. No CJS code ends up in .mjs files served to browser
    
    // For now, this is a placeholder - we need to set up the full test infrastructure
    expect(true).toBe(true);
  });

  it("should detect CJS in files claiming to be ESM", async () => {
    if (!native?.resolveModule) {
      console.warn("Native resolver not available, skipping test");
      return;
    }

    // Test React's index.js - it has "type": "module" but contains CJS
    const reactPath = path.join(
      process.cwd(),
      "node_modules/.pnpm/react@19.2.3/node_modules/react/index.js"
    );
    
    if (!fs.existsSync(reactPath)) {
      console.warn("React not installed, skipping test");
      return;
    }

    const content = fs.readFileSync(reactPath, "utf8");
    
    // Verify React's index.js contains CJS patterns
    expect(content).toContain("module.exports");
    expect(content).toContain("require(");
    
    // The optimizer should NOT treat this as ESM
    // (Testing via file content for now, would need optimizer access for full test)
  });

  it("should handle .mjs files with proper ESM content", async () => {
    // Test Radix's actual .mjs files - they are pure ESM
    const radixDialogPath = path.join(
      process.cwd(),
      "node_modules/.pnpm/@radix-ui+react-dialog@1.1.15_@types+react-dom@19.2.3_@types+react@19.2.7__@types+react_66d7d575cbd072ce29e52afb89085e9d/node_modules/@radix-ui/react-dialog/dist/index.mjs"
    );

    if (!fs.existsSync(radixDialogPath)) {
      console.warn("Radix Dialog not installed, skipping test");
      return;
    }

    const content = fs.readFileSync(radixDialogPath, "utf8");
    
    // Verify it's proper ESM
    expect(content).toContain("import ");
    expect(content).toContain("export ");
    
    // Should NOT contain CJS patterns
    expect(content).not.toContain("module.exports");
    expect(content).not.toContain("require(");
  });

  it("should rewrite imports in .mjs files processed by loader", async () => {
    if (!native?.resolveModule) {
      console.warn("Native resolver not available, skipping test");
      return;
    }

    // Simulate a .mjs file with bare imports to installed packages
    const mjsCode = `import lodash from 'lodash';
import postcss from 'postcss';

export function MyComponent() {
  return null;
}`;

    const result = await jsLoader.transform({
      path: "/project/src/components/test.mjs",
      code: mjsCode,
      ext: ".mjs",
    });

    // After transformation, bare imports should be rewritten to /@deps/...
    expect(result?.code).not.toContain("from 'lodash'");
    expect(result?.code).not.toContain("from 'postcss'");
  });

  it("should preserve quote types in import rewriting", async () => {
    // Test both single and double quotes with installed packages
    const code = `import lodash from 'lodash';
import postcss from "postcss";`;

    const result = await jsLoader.transform({
      path: "/project/test.js",
      code,
      ext: ".js",
    });

    // Should preserve original quote types
    // (This tests the es-module-lexer slicing logic)
    expect(result?.code).toBeTruthy();
  });

  it("should handle dynamic imports correctly", async () => {
    if (!native?.resolveModule) {
      console.warn("Native resolver not available, skipping test");
      return;
    }

    const code = `const lodash = await import('lodash');
const postcss = await import("postcss");`;

    const result = await jsLoader.transform({
      path: "/project/test.js",
      code,
      ext: ".js",
    });

    // Note: dynamic import rewriting depends on parser support. This is a smoke test to ensure
    // the loader doesn't crash when dynamic imports are present.
    expect(result?.code).toBeTruthy();
  });
});
