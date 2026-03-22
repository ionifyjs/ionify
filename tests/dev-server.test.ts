import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { expect, test } from "vitest";
import { startDevServer } from "../src/cli/commands/dev";
import { resetIonifyConfigCache } from "../src/cli/utils/config";
import { resetResolverAliasCache } from "../src/core/resolver";
import { publicPathForFile } from "../src/core/utils/public-path";

test("dev server serves project files over HTTP", async () => {
  const prevCwd = process.cwd();
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-dev-test-"));
  const appRoot = path.join(workspaceRoot, "apps", "web");
  const externalDir = path.join(workspaceRoot, "packages", "shared");

  try {
    fs.writeFileSync(path.join(workspaceRoot, "package.json"), JSON.stringify({ name: "repo", private: true }));
    fs.writeFileSync(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "packages:\n  - \"apps/*\"\n  - \"packages/*\"\n",
      "utf8",
    );
    fs.mkdirSync(appRoot, { recursive: true });
    fs.writeFileSync(path.join(appRoot, "package.json"), JSON.stringify({ name: "web", private: true }));
    fs.writeFileSync(
      path.join(appRoot, "index.html"),
      "<!doctype html><html><body><h1>Ionify</h1></body></html>",
      "utf8"
    );
    fs.writeFileSync(path.join(appRoot, "main.ts"), "export const answer = 42;\n", "utf8");
    fs.mkdirSync(path.join(appRoot, "assets"), { recursive: true });
    fs.mkdirSync(path.join(appRoot, "public"), { recursive: true });
    fs.writeFileSync(path.join(appRoot, "public", "logo.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>\n", "utf8");

    const externalFile = path.join(externalDir, "external.js");
    fs.mkdirSync(externalDir, { recursive: true });
    fs.writeFileSync(externalFile, "export const external = 'ok';\n", "utf8");

    process.chdir(appRoot);
    resetIonifyConfigCache();
    resetResolverAliasCache();

    const handle = await startDevServer({ port: 0, enableSignalHandlers: false });
    try {
      const baseUrl = `http://127.0.0.1:${handle.port}`;

      const htmlResponse = await fetch(baseUrl + "/");
      expect(htmlResponse.status).toBe(200);
      const html = await htmlResponse.text();
      expect(html).toContain("/__ionify_hmr_client.js");

      const moduleResponse = await fetch(baseUrl + "/main.ts");
      expect(moduleResponse.status).toBe(200);
      expect(moduleResponse.headers.get("content-type")).toContain("application/javascript");

      const publicAssetResponse = await fetch(baseUrl + "/logo.svg");
      expect(publicAssetResponse.status).toBe(200);
      expect(publicAssetResponse.headers.get("content-type")).toContain("image/svg+xml");

      fs.writeFileSync(path.join(appRoot, "esm.mjs"), "export const esm = 'ok';\n", "utf8");
      fs.writeFileSync(
        path.join(appRoot, "cjs.cjs"),
        "module.exports = { cjs: 'ok' };\n",
        "utf8"
      );

      const esmResponse = await fetch(baseUrl + "/esm.mjs");
      expect(esmResponse.status).toBe(200);
      expect(esmResponse.headers.get("content-type")).toBe("application/javascript; charset=utf-8");

      const cjsResponse = await fetch(baseUrl + "/cjs.cjs");
      expect(cjsResponse.status).toBe(200);
      expect(cjsResponse.headers.get("content-type")).toBe("application/javascript; charset=utf-8");

      const externalPath = publicPathForFile(appRoot, externalFile);
      const externalResponse = await fetch(baseUrl + externalPath);
      expect(externalResponse.status).toBe(200);
      expect(externalResponse.headers.get("content-type")).toContain("application/javascript");

      const storeDir = path.join(workspaceRoot, "store", ".pnpm", "react-refresh@0.17.0", "node_modules", "react-refresh");
      const runtimeFile = path.join(storeDir, "runtime.js");
      fs.mkdirSync(storeDir, { recursive: true });
      fs.mkdirSync(path.join(appRoot, "node_modules"), { recursive: true });
      fs.writeFileSync(path.join(storeDir, "package.json"), JSON.stringify({ name: "react-refresh" }), "utf8");
      fs.writeFileSync(runtimeFile, "export const refresh = true;\n", "utf8");

      const linkedPackageDir = path.join(appRoot, "node_modules", "react-refresh");
      try {
        fs.symlinkSync(storeDir, linkedPackageDir, "dir");
      } catch {
        // If symlinks are unavailable, skip this assertion on the current machine.
      }

      if (fs.existsSync(linkedPackageDir)) {
        const runtimePath = publicPathForFile(appRoot, runtimeFile);
        expect(runtimePath).toBe("/node_modules/react-refresh/runtime.js");

        const runtimeResponse = await fetch(baseUrl + runtimePath);
        expect(runtimeResponse.status).toBe(200);
        expect(runtimeResponse.headers.get("content-type")).toContain("application/javascript");
      }

      const refreshBridgeResponse = await fetch(baseUrl + "/__ionify_react_refresh.js");
      expect(refreshBridgeResponse.status).toBe(200);
      const refreshBridgeCode = await refreshBridgeResponse.text();
      expect(refreshBridgeCode).toContain('import RefreshRuntime from "/@deps/react-refresh@');
      expect(refreshBridgeCode).not.toContain('/__ionify__/modules/aW52YWxpZA');

      const dirResponse = await fetch(baseUrl + "/assets");
      expect([403, 404]).toContain(dirResponse.status);
    } finally {
      await handle.close();
    }
  } finally {
    process.chdir(prevCwd);
    resetIonifyConfigCache();
    resetResolverAliasCache();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("dev server shuts down promptly with an open HMR SSE client", async () => {
  const prevCwd = process.cwd();
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-dev-shutdown-"));
  let req: http.ClientRequest | null = null;
  let res: http.IncomingMessage | null = null;

  try {
    fs.writeFileSync(path.join(appRoot, "package.json"), JSON.stringify({ name: "web", private: true }));
    fs.writeFileSync(
      path.join(appRoot, "index.html"),
      "<!doctype html><html><body><div id=\"root\"></div><script type=\"module\" src=\"/main.ts\"></script></body></html>\n",
      "utf8",
    );
    fs.writeFileSync(path.join(appRoot, "main.ts"), "export const ok = true;\n", "utf8");

    process.chdir(appRoot);
    resetIonifyConfigCache();
    resetResolverAliasCache();

    const handle = await startDevServer({ port: 0, enableSignalHandlers: false });
    try {
      await new Promise<void>((resolve, reject) => {
        req = http.get(`http://127.0.0.1:${handle.port}/__ionify_hmr`, (incoming) => {
          res = incoming;
          incoming.setEncoding("utf8");
          incoming.once("data", () => resolve());
        });
        req.once("error", reject);
      });

      const closePromise = handle.close();
      const closedQuickly = await Promise.race([
        closePromise.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1000)),
      ]);

      expect(closedQuickly).toBe(true);
      await closePromise;
    } finally {
      req?.destroy();
      res?.destroy();
    }
  } finally {
    process.chdir(prevCwd);
    resetIonifyConfigCache();
    resetResolverAliasCache();
    fs.rmSync(appRoot, { recursive: true, force: true });
  }
});
