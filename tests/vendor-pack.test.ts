import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { startDevServer, type DevServerHandle } from "../src/cli/commands/dev";
import { resetIonifyConfigCache } from "../src/cli/utils/config";
import { resetResolverAliasCache } from "../src/core/resolver";

describe("Deps optimizer vendor pack (dev preload)", () => {
  let prevCwd: string;
  let rootDir: string;
  let server: DevServerHandle;
  let baseUrl: string;

  beforeEach(async () => {
    prevCwd = process.cwd();
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-vendor-pack-"));
    fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });

    // Minimal fake framework deps (no network installs).
    const nodeModules = path.join(rootDir, "node_modules");
    fs.mkdirSync(nodeModules, { recursive: true });
    const reactDir = path.join(nodeModules, "react");
    const reactDomDir = path.join(nodeModules, "react-dom");
    fs.mkdirSync(reactDir, { recursive: true });
    fs.mkdirSync(reactDomDir, { recursive: true });
    fs.writeFileSync(
      path.join(reactDir, "package.json"),
      JSON.stringify({ name: "react", version: "1.0.0", main: "index.js" }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(reactDir, "index.js"),
      "exports.useMemo = () => null; exports.version = '1.0.0';\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(reactDomDir, "package.json"),
      JSON.stringify({ name: "react-dom", version: "1.0.0", main: "index.js" }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(reactDomDir, "index.js"),
      "exports.version = '1.0.0';\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(reactDomDir, "client.js"),
      "exports.createRoot = () => ({ render(){} });\n",
      "utf8",
    );

    fs.writeFileSync(
      path.join(rootDir, "package.json"),
      JSON.stringify({
        name: "test-vendor-pack",
        dependencies: { react: "1.0.0", "react-dom": "1.0.0" },
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(rootDir, "index.html"),
      "<!doctype html><html><head></head><body><div id=\"root\"></div><script type=\"module\" src=\"/src/main.tsx\"></script></body></html>\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(rootDir, "src", "main.tsx"),
      "import { useMemo } from 'react'; import { createRoot } from 'react-dom/client'; console.log(useMemo, createRoot);\n",
      "utf8",
    );

    process.chdir(rootDir);
    resetIonifyConfigCache();
    resetResolverAliasCache();
    server = await startDevServer({ port: 0, enableSignalHandlers: false });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
    process.chdir(prevCwd);
    resetIonifyConfigCache();
    resetResolverAliasCache();
    if (rootDir && fs.existsSync(rootDir)) {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("injects modulepreload for vendor.<depsHash>.js and serves it", async () => {
    const htmlRes = await fetch(baseUrl + "/");
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();

    const match = html.match(/href="(\/@deps\/vendor\.[0-9a-f]{16}\.js)"/);
    expect(match).toBeTruthy();
    const vendorUrl = match![1];

    const vendorRes = await fetch(baseUrl + vendorUrl);
    expect(vendorRes.status).toBe(200);
    expect(vendorRes.headers.get("content-type")).toContain("application/javascript");
    const vendorBody = await vendorRes.text();
    expect(vendorBody).toContain("// ionify:vendor-pack");
    expect(vendorBody).toContain("import \"/@deps/react@1.0.0");
    expect(vendorBody).toContain("import \"/@deps/react-dom@1.0.0");
  });
});
