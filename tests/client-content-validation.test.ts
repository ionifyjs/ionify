/**
 * Test: Client Runtime Content Validation
 * 
 * Ensures that client runtime files are served correctly without
 * transformation errors or circular dependencies.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startDevServer, type DevServerHandle } from "../src/cli/commands/dev";
import path from "path";
import fs from "fs";

describe("Client Runtime Content Validation", () => {
  let server: DevServerHandle;
  let port: number;
  const testProjectDir = path.join(process.cwd(), "test-project-client-validation");

  beforeAll(async () => {
    // Create a minimal test project with react-refresh installed
    fs.mkdirSync(testProjectDir, { recursive: true });
    
    // Create package.json with react-refresh
    fs.writeFileSync(
      path.join(testProjectDir, "package.json"),
      JSON.stringify({
        name: "test-client-validation",
        dependencies: {
          "react-refresh": "^0.14.2"
        }
      })
    );

    // Create node_modules symlink to actual react-refresh
    const nodeModulesDir = path.join(testProjectDir, "node_modules");
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    
    const reactRefreshSrc = path.join(process.cwd(), "node_modules", "react-refresh");
    const reactRefreshDest = path.join(nodeModulesDir, "react-refresh");
    
    if (fs.existsSync(reactRefreshSrc)) {
      // Create symlink or copy
      try {
        fs.symlinkSync(reactRefreshSrc, reactRefreshDest, "dir");
      } catch (e) {
        // If symlink fails, skip this test
        console.warn("Could not create symlink for react-refresh");
      }
    }

    // Start server in test directory
    const originalCwd = process.cwd();
    process.chdir(testProjectDir);
    server = await startDevServer({ port: 0, enableSignalHandlers: false });
    port = server.port;
    process.chdir(originalCwd);
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
    // Cleanup test directory
    if (fs.existsSync(testProjectDir)) {
      fs.rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  describe("React Refresh Runtime", () => {
    it("should serve __ionify_react_refresh.js without errors", async () => {
      const response = await fetch(`http://localhost:${port}/__ionify_react_refresh.js`);
      expect(response.status).toBe(200);
      
      const content = await response.text();
      
      // Should NOT contain bare 'react-refresh/runtime' import
      expect(content).not.toContain('from "react-refresh/runtime"');
      
      // Should contain setupReactRefresh function
      expect(content).toContain("setupReactRefresh");
      expect(content).toContain("RefreshRuntime");
      
      // Should NOT have HMR injection code (import.meta.hot.accept)
      expect(content).not.toContain("import.meta.hot.accept");
    });
  });

  describe("HMR Client", () => {
    it("should serve __ionify_hmr_client.js without syntax errors", async () => {
      const response = await fetch(`http://localhost:${port}/__ionify_hmr_client.js`);
      expect(response.status).toBe(200);
      
      const content = await response.text();
      
      // Should contain HMR client code
      expect(content).toContain("EventSource");
      expect(content).toContain("/__ionify_hmr");
      
      // Should import overlay from correct path
      expect(content).toContain("/__ionify_overlay.js");
      
      // Should NOT have additional HMR injection code
      expect(content).not.toContain("import.meta.hot.accept");
    });
  });

  describe("Error Overlay", () => {
    it("should serve __ionify_overlay.js without modifications", async () => {
      const response = await fetch(`http://localhost:${port}/__ionify_overlay.js`);
      expect(response.status).toBe(200);
      
      const content = await response.text();
      
      // Should contain overlay functions
      expect(content).toContain("showErrorOverlay");
      expect(content).toContain("clearErrorOverlay");
      
      // Should NOT have HMR injection code
      expect(content).not.toContain("import.meta.hot.accept");
    });
  });
});
