import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { jsLoader } from "@core/loaders/js";
import fs from "fs";
import path from "path";
import os from "os";

describe("CSS and Asset Import Rewriting", () => {
  let testDir: string;
  let appFile: string;
  let cssFile: string;
  let svgFile: string;
  let pngFile: string;
  let utilsFile: string;

  beforeEach(() => {
    // Create a temporary directory structure for testing
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-test-"));
    appFile = path.join(testDir, "app.tsx");
    cssFile = path.join(testDir, "styles.css");
    svgFile = path.join(testDir, "logo.svg");
    pngFile = path.join(testDir, "icon.png");
    utilsFile = path.join(testDir, "utils.ts");

    // Create actual files so resolveImport can find them
    fs.writeFileSync(cssFile, "body { margin: 0; }");
    fs.writeFileSync(svgFile, "<svg></svg>");
    fs.writeFileSync(pngFile, "fake-png-data");
    fs.writeFileSync(utilsFile, "export const foo = 'bar';");
    fs.writeFileSync(appFile, ""); // Will be filled by tests
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("should add ?inline to CSS imports", async () => {
    const code = `import "./styles.css";\nconsole.log("test");`;
    fs.writeFileSync(appFile, code);

    const result = await jsLoader.transform({
      path: appFile,
      code,
      ext: ".tsx",
    });

    // Check that ?inline was added (encoded path + ?inline)
    expect(result?.code).toContain("?inline");
  });

  it("should add ?import to SVG imports", async () => {
    const code = `import logo from "./logo.svg";\nconsole.log(logo);`;
    fs.writeFileSync(appFile, code);

    const result = await jsLoader.transform({
      path: appFile,
      code,
      ext: ".tsx",
    });

    // Check that ?import was added (encoded path + ?import)
    expect(result?.code).toContain("?import");
  });

  it("should add ?import to PNG imports", async () => {
    const code = `import icon from "./icon.png";\nconsole.log(icon);`;
    fs.writeFileSync(appFile, code);

    const result = await jsLoader.transform({
      path: appFile,
      code,
      ext: ".tsx",
    });

    // Check that ?import was added (encoded path + ?import)
    expect(result?.code).toContain("?import");
  });

  it("should preserve existing query params on CSS", async () => {
    const code = `import styles from "./styles.css?module";\nconsole.log(styles);`;
    fs.writeFileSync(appFile, code);

    const result = await jsLoader.transform({
      path: appFile,
      code,
      ext: ".tsx",
    });

    // Should keep the existing ?module param, not add ?inline
    expect(result?.code).toContain("?module");
    expect(result?.code).not.toContain("?inline");
  });

  it("should properly resolve and rewrite regular JS/TS imports", async () => {
    const code = `import { foo } from "./utils";\nconsole.log(foo);`;
    fs.writeFileSync(appFile, code);

    const result = await jsLoader.transform({
      path: appFile,
      code,
      ext: ".tsx",
    });

    // Should resolve to encoded path but NOT add ?inline or ?import query params
    expect(result?.code).toContain("/__ionify__/modules/");
    expect(result?.code).not.toContain("?inline");
    expect(result?.code).not.toContain("?import");
  });

  it("should handle mixed imports (JS, CSS, and assets)", async () => {
    const code = `
import { foo } from "./utils";
import "./styles.css";
import logo from "./logo.svg";
import icon from "./icon.png";

console.log(foo, logo, icon);
`;
    fs.writeFileSync(appFile, code);

    const result = await jsLoader.transform({
      path: appFile,
      code,
      ext: ".tsx",
    });

    // Should have 4 imports total
    const importMatches = result?.code.match(/from\s+["']|import\s+["']/g);
    expect(importMatches).toBeTruthy();
    
    // CSS import should have ?inline (1 occurrence)
    const inlineMatches = result?.code.match(/\?inline/g);
    expect(inlineMatches).toBeTruthy();
    expect(inlineMatches?.length).toBe(1);

    // Asset imports should have ?import (2 occurrences: svg and png)
    const importQueryMatches = result?.code.match(/\?import/g);
    expect(importQueryMatches).toBeTruthy();
    expect(importQueryMatches?.length).toBe(2);
  });

  it("should not break bare specifiers for node_modules", async () => {
    const code = `import React from "react";\nimport { useState } from "react";\nconsole.log(React);`;
    fs.writeFileSync(appFile, code);

    const result = await jsLoader.transform({
      path: appFile,
      code,
      ext: ".tsx",
    });

    // Should properly resolve react imports (will depend on node_modules being available)
    // At minimum, should not crash and should produce valid code
    expect(result?.code).toBeDefined();
    expect(result?.code.length).toBeGreaterThan(0);
    // Should contain some form of react import (either resolved or original)
    expect(result?.code.toLowerCase()).toContain("react");
  });

  it("should not add query params to React runtime imports", async () => {
    // This test verifies that React imports aren't mistakenly treated as assets
    const code = `
import { jsx } from "react/jsx-runtime";
export const MyComponent = () => jsx("div", { children: "Hello" });
`;
    fs.writeFileSync(appFile, code);

    const result = await jsLoader.transform({
      path: appFile,
      code,
      ext: ".tsx",
    });

    // Should NOT add ?inline or ?import to react imports
    expect(result?.code).toBeDefined();
    expect(result?.code).not.toContain("react/jsx-runtime?inline");
    expect(result?.code).not.toContain("react/jsx-runtime?import");
    
    // Note: react/jsx-runtime may or may not be fully resolved depending on whether
    // react is installed in the test environment. The key is it shouldn't get
    // ?inline or ?import query params which are only for CSS and assets.
  });
});
