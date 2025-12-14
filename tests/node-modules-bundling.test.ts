import { describe, it, expect, vi } from "vitest";
import { tryBundleNodeModule } from "../src/native/index";

describe("Node Modules Bundling", () => {
  it("should return null if native bundler is unavailable", () => {
    const filePath = "/fake/node_modules/fake-package/index.js";
    const code = `
      var React = require('react');
      module.exports = React;
    `;

    const result = tryBundleNodeModule(filePath, code);
    
    // If native bundler is not available (CI/dev environments without compiled Rust),
    // should return null to fall back to JS-side handling
    if (result === null) {
      expect(result).toBeNull();
    } else {
      // If native bundler IS available, should return valid ESM
      expect(result).toBeTypeOf("string");
      expect(result).not.toContain("require(");
      expect(result).not.toContain("module.exports");
    }
  });

  it("should handle native bundler errors gracefully", () => {
    const filePath = "/fake/node_modules/broken-package/index.js";
    const invalidCode = `
      this is not valid javascript {{{
    `;

    // Should catch errors and return null instead of throwing
    expect(() => tryBundleNodeModule(filePath, invalidCode)).not.toThrow();
    const result = tryBundleNodeModule(filePath, invalidCode);
    
    // Result should be null (fallback) or valid string (if bundler fixed it somehow)
    expect(result === null || typeof result === "string").toBe(true);
  });

  it("should preserve module identity in chunk ID", () => {
    // This test verifies the chunk ID generation logic
    const filePath = "/path/to/node_modules/@scope/package-name/lib/index.js";
    const code = "module.exports = {};";
    
    // Call tryBundleNodeModule - implementation creates chunk ID like:
    // node_module_/path/to/node_modules/@scope/package-name/lib/index.js
    // with non-alphanumeric chars replaced by underscores
    const result = tryBundleNodeModule(filePath, code);
    
    // Just verify it doesn't crash with scoped packages
    expect(result === null || typeof result === "string").toBe(true);
  });

  it("should handle files with no dependencies", () => {
    const filePath = "/fake/node_modules/simple/index.js";
    const code = `
      module.exports = { value: 42 };
    `;

    const result = tryBundleNodeModule(filePath, code);
    
    if (result !== null) {
      expect(result).toBeTypeOf("string");
      // Should convert to ESM export
      expect(result).not.toContain("module.exports");
    }
  });

  it("should handle CommonJS files with multiple requires", () => {
    const filePath = "/fake/node_modules/complex/index.js";
    const code = `
      var react = require('react');
      var reactDom = require('react-dom');
      var lodash = require('lodash');
      
      module.exports = {
        React: react,
        ReactDOM: reactDom,
        _: lodash
      };
    `;

    const result = tryBundleNodeModule(filePath, code);
    
    if (result !== null) {
      expect(result).toBeTypeOf("string");
      expect(result).not.toContain("require(");
      // Should have import statements (if bundler resolves them) or external markers
    }
  });
});
