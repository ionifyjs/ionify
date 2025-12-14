/**
 * Test: Client Runtime Files
 * 
 * Ensures that client runtime files (hmr.js, overlay.js, react-refresh-runtime.js)
 * are correctly copied to dist/client during build and can be served by the dev server.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

describe("Client Runtime Files", () => {
  const clientFiles = ["hmr.js", "overlay.js", "react-refresh-runtime.js"];
  const distClientDir = path.join(projectRoot, "dist", "client");
  const srcClientDir = path.join(projectRoot, "src", "client");

  describe("Build Output", () => {
    it("should have dist/client directory", () => {
      expect(fs.existsSync(distClientDir)).toBe(true);
      expect(fs.statSync(distClientDir).isDirectory()).toBe(true);
    });

    clientFiles.forEach((file) => {
      it(`should copy ${file} to dist/client`, () => {
        const distPath = path.join(distClientDir, file);
        expect(fs.existsSync(distPath), `${file} should exist in dist/client`).toBe(true);
        
        const srcPath = path.join(srcClientDir, file);
        const srcContent = fs.readFileSync(srcPath, "utf8");
        const distContent = fs.readFileSync(distPath, "utf8");
        
        expect(distContent).toBe(srcContent);
      });
    });
  });

  describe("File Content Validation", () => {
    it("hmr.js should have valid SSE client code", () => {
      const hmrPath = path.join(distClientDir, "hmr.js");
      const content = fs.readFileSync(hmrPath, "utf8");
      
      expect(content).toContain("EventSource");
      expect(content).toContain("/__ionify_hmr");
      expect(content).toContain("/__ionify_hmr/apply");
    });

    it("overlay.js should export error overlay functions", () => {
      const overlayPath = path.join(distClientDir, "overlay.js");
      const content = fs.readFileSync(overlayPath, "utf8");
      
      expect(content).toContain("showErrorOverlay");
      expect(content).toContain("clearErrorOverlay");
    });

    it("react-refresh-runtime.js should have React Refresh setup", () => {
      const reactRefreshPath = path.join(distClientDir, "react-refresh-runtime.js");
      const content = fs.readFileSync(reactRefreshPath, "utf8");
      
      expect(content).toContain("react-refresh/runtime");
      expect(content).toContain("setupReactRefresh");
      expect(content).toContain("$RefreshReg$");
    });
  });

  describe("File Accessibility", () => {
    clientFiles.forEach((file) => {
      it(`${file} should be readable`, () => {
        const filePath = path.join(distClientDir, file);
        expect(() => fs.readFileSync(filePath, "utf8")).not.toThrow();
      });
    });
  });
});
