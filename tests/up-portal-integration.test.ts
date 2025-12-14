/**
 * Integration Test: UP-Portal-Ionify Client Runtime
 * 
 * This test runs against a live UP-Portal-Ionify dev server to verify
 * that client runtime files are served correctly.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "child_process";
import path from "path";

describe("UP-Portal-Ionify Integration Test", () => {
  let serverProcess: ChildProcess | null = null;
  const port = 5174; // Use a different port to avoid conflicts
  const UP_PORTAL_ROOT = path.resolve("/Users/khaledsalem/Projects/UP-Portal-Ionify");

  beforeAll(async () => {
    // Start the UP-Portal-Ionify dev server
    return new Promise<void>((resolve, reject) => {
      serverProcess = spawn("ionify", ["dev", "--port", String(port)], {
        cwd: UP_PORTAL_ROOT,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";
      const timeout = setTimeout(() => {
        reject(new Error("Server failed to start within 10 seconds"));
      }, 10000);

      serverProcess.stdout?.on("data", (data) => {
        output += data.toString();
        if (output.includes("Ionify Dev Server")) {
          clearTimeout(timeout);
          // Give it a moment to fully initialize
          setTimeout(() => resolve(), 500);
        }
      });

      serverProcess.stderr?.on("data", (data) => {
        console.error("Server error:", data.toString());
      });

      serverProcess.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }, 15000); // 15 second timeout for server start

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      // Wait for graceful shutdown
      await new Promise<void>((resolve) => {
        serverProcess!.on("exit", () => resolve());
        setTimeout(() => {
          if (serverProcess && !serverProcess.killed) {
            serverProcess.kill("SIGKILL");
          }
          resolve();
        }, 3000);
      });
    }
  });

  describe("Client Runtime Files", () => {
    it("should serve __ionify_react_refresh.js without 500 error", async () => {
      const response = await fetch(`http://localhost:${port}/__ionify_react_refresh.js`);
      
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/javascript");
      
      const content = await response.text();
      
      // Should NOT contain bare import
      expect(content).not.toContain('from "react-refresh/runtime"');
      
      // Should contain resolved path
      expect(content).toMatch(/from\s+["'].*node_modules.*react-refresh.*runtime/);
      
      // Should contain setupReactRefresh
      expect(content).toContain("setupReactRefresh");
    });

    it("should serve __ionify_hmr_client.js without syntax errors", async () => {
      const response = await fetch(`http://localhost:${port}/__ionify_hmr_client.js`);
      
      expect(response.status).toBe(200);
      const content = await response.text();
      
      // Should NOT start with "Server" or have syntax errors
      expect(content).not.toMatch(/^Server/);
      expect(content).toContain("EventSource");
      expect(content).toContain("/__ionify_hmr");
    });

    it("should serve __ionify_overlay.js successfully", async () => {
      const response = await fetch(`http://localhost:${port}/__ionify_overlay.js`);
      
      expect(response.status).toBe(200);
      const content = await response.text();
      
      expect(content).toContain("showErrorOverlay");
      expect(content).toContain("clearErrorOverlay");
    });

    it("should establish SSE connection at __ionify_hmr", async () => {
      const controller = new AbortController();
      const response = await fetch(`http://localhost:${port}/__ionify_hmr`, {
        signal: controller.signal,
      });
      
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      
      controller.abort();
    });
  });

  describe("Main Entry Point", () => {
    it("should serve src/main.tsx with transformed JSX", async () => {
      const response = await fetch(`http://localhost:${port}/src/main.tsx`);
      
      expect(response.status).toBe(200);
      const content = await response.text();
      
      // Should have React import resolved
      expect(content).toMatch(/import.*from.*react/i);
      
      // Should have HMR code injected (but not client runtime files)
      expect(content).toContain("import.meta.hot");
    });
  });
});
