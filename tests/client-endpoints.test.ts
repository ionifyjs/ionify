/**
 * Test: Dev Server Client Endpoints
 * 
 * Ensures that the dev server correctly serves client runtime files
 * at their expected endpoints.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startDevServer, type DevServerHandle } from "../src/cli/commands/dev";
import fs from "fs";
import path from "path";
import os from "os";

describe("Dev Server Client Endpoints", () => {
  let server: DevServerHandle;
  let port: number;
  let testRoot: string;

  beforeAll(async () => {
    // Create a test project with react-refresh
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-client-ep-"));
    
    // Create minimal package.json
    fs.writeFileSync(
      path.join(testRoot, "package.json"),
      JSON.stringify({ name: "test", dependencies: { "react-refresh": "^0.14.2" } })
    );

    // Ensure this fixture is treated as its own workspace (Phase 6.5+ workspace-scoped engine state),
    // otherwise Ionify will detect the repo root workspace markers and place `.ionify/` there.
    fs.writeFileSync(path.join(testRoot, "pnpm-workspace.yaml"), "packages:\n  - \"**\"\n");
    
    // Create node_modules with react-refresh symlink
    const nmDir = path.join(testRoot, "node_modules");
    fs.mkdirSync(nmDir, { recursive: true });
    const reactRefreshSrc = path.join(process.cwd(), "node_modules", "react-refresh");
    const reactRefreshDest = path.join(nmDir, "react-refresh");
    if (fs.existsSync(reactRefreshSrc)) {
      try {
        fs.symlinkSync(reactRefreshSrc, reactRefreshDest, "dir");
      } catch (e) {
        // Symlink failed, copy instead
        fs.cpSync(reactRefreshSrc, reactRefreshDest, { recursive: true });
      }
    }
    
    const originalCwd = process.cwd();
    try {
      process.chdir(testRoot);
      server = await startDevServer({ port: 0, enableSignalHandlers: false });
      port = server.port;
    } finally {
      process.chdir(originalCwd);
    }
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  describe("HMR Client Endpoints", () => {
    it("should serve __ionify_hmr_client.js", async () => {
      const response = await fetch(`http://localhost:${port}/__ionify_hmr_client.js`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/javascript");
      
      const content = await response.text();
      expect(content).toContain("EventSource");
      expect(content).toContain("/__ionify_hmr");
    });

    it("should serve __ionify_overlay.js", async () => {
      const response = await fetch(`http://localhost:${port}/__ionify_overlay.js`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/javascript");
      
      const content = await response.text();
      expect(content).toContain("showErrorOverlay");
      expect(content).toContain("clearErrorOverlay");
    });

    it("should serve __ionify_react_refresh.js", async () => {
      const response = await fetch(`http://localhost:${port}/__ionify_react_refresh.js`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/javascript");
      
      const content = await response.text();
      expect(content).toContain("setupReactRefresh");
    });

    it("should establish SSE connection at __ionify_hmr", async () => {
      const controller = new AbortController();
      const signal = controller.signal;
      
      const response = await fetch(`http://localhost:${port}/__ionify_hmr`, { signal });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      expect(response.headers.get("cache-control")).toContain("no-cache");
      
      controller.abort();
    });
  });

  describe("Error Handling", () => {
    it("should return 404 for non-existent paths", async () => {
      const response = await fetch(`http://localhost:${port}/non-existent-file.js`);
      expect(response.status).toBe(404);
    });

    it("should handle POST to __ionify_hmr/apply", async () => {
      // Without a valid update ID, should return 404
      const response = await fetch(`http://localhost:${port}/__ionify_hmr/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "invalid-id" }),
      });
      expect([404, 400]).toContain(response.status);
    });
  });
});
