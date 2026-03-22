import { describe, it, expect } from "vitest";
import { native } from "../src/native";

describe("ESM Export Detection After Transform", () => {
  it("should detect exports from ESM files transformed to CJS", async () => {
    if (!native?.optimizeDependencyWithManifest) {
      console.warn("Native binding not available, skipping test");
      return;
    }

    // This test verifies Phase 5.4 fix: Export detection runs AFTER ESM→CJS transform
    // Previously failed because cjs_lexer ran on original ESM code (found no CJS exports)
    
    const testPackage = "aria-hidden"; // Real-world ESM package with export syntax
    const entryPath = require.resolve(`${testPackage}/dist/es2015/index.js`);
    
    try {
      const result = await native.optimizeDependencyWithManifest(
        entryPath,
        process.cwd()
      );
      
      expect(result).toBeDefined();
      expect(result.outputCode).toBeDefined();
      
      // Should have named exports, not just default
      expect(result.outputCode).toContain("export {");
      expect(result.outputCode).toContain("export default __exports");
      
      // Should export specific functions
      const hasHideOthers = result.outputCode.includes("hideOthers");
      const hasInertOthers = result.outputCode.includes("inertOthers");
      expect(hasHideOthers || hasInertOthers).toBe(true);
      
    } catch (error: any) {
      // If package not found, skip test
      if (error.code === "MODULE_NOT_FOUND") {
        console.warn(`${testPackage} not installed, skipping test`);
        return;
      }
      throw error;
    }
  });

  it("should detect exports from react-remove-scroll ESM package", async () => {
    if (!native?.optimizeDependencyWithManifest) {
      console.warn("Native binding not available, skipping test");
      return;
    }
    
    const testPackage = "react-remove-scroll";
    const entryPath = require.resolve(`${testPackage}/dist/es2015/index.js`);
    
    try {
      const result = await native.optimizeDependencyWithManifest(
        entryPath,
        process.cwd()
      );
      
      expect(result).toBeDefined();
      expect(result.outputCode).toBeDefined();
      
      // Should have RemoveScroll export
      expect(result.outputCode).toContain("export {");
      const hasRemoveScroll = result.outputCode.includes("RemoveScroll");
      expect(hasRemoveScroll).toBe(true);
      
    } catch (error: any) {
      if (error.code === "MODULE_NOT_FOUND") {
        console.warn(`${testPackage} not installed, skipping test`);
        return;
      }
      throw error;
    }
  });
});
