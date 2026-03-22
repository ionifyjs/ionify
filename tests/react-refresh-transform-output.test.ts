import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDevServer, type DevServerHandle } from "../src/cli/commands/dev";
import { resetIonifyConfigCache } from "../src/cli/utils/config";
import { resetResolverAliasCache } from "../src/core/resolver";

function writeStubReactPackage(nmDir: string) {
  const reactDir = path.join(nmDir, "react");
  fs.mkdirSync(reactDir, { recursive: true });
  fs.writeFileSync(
    path.join(reactDir, "package.json"),
    JSON.stringify({ name: "react", version: "0.0.0", type: "module", main: "index.js" }),
    "utf8",
  );
  // Minimal surface for transform/rewrite. We don't execute React in this test.
  fs.writeFileSync(path.join(reactDir, "index.js"), "export default {};\n", "utf8");
  fs.writeFileSync(path.join(reactDir, "jsx-runtime.js"), "export const jsx = () => null; export const jsxs = jsx; export const Fragment = {};\n", "utf8");
  fs.writeFileSync(path.join(reactDir, "jsx-dev-runtime.js"), "export const jsxDEV = () => null; export const Fragment = {};\n", "utf8");
}

function writeStubReactDomPackage(nmDir: string) {
  const dir = path.join(nmDir, "react-dom");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "react-dom", version: "0.0.0", type: "module", main: "index.js" }),
    "utf8",
  );
  fs.writeFileSync(path.join(dir, "index.js"), "export default {};\n", "utf8");
  fs.writeFileSync(path.join(dir, "client.js"), "export function createRoot(){ return { render(){} }; }\n", "utf8");
}

function linkOrCopyPackage({
  projectRoot,
  destNodeModulesDir,
  name,
}: {
  projectRoot: string;
  destNodeModulesDir: string;
  name: string;
}) {
  const src = path.join(projectRoot, "node_modules", name);
  const dest = path.join(destNodeModulesDir, name);
  if (!fs.existsSync(src)) {
    throw new Error(`Missing dependency in repo node_modules: ${name}`);
  }
  if (fs.existsSync(dest)) return;

  try {
    fs.symlinkSync(src, dest, "dir");
  } catch {
    fs.cpSync(src, dest, { recursive: true });
  }
}

describe("React Refresh transform output (stable module ids)", () => {
  const projectRoot = process.cwd();
  const fixtureRoot = path.join(
    projectRoot,
    "tests",
    "fixtures",
    "react-refresh-stable-id",
  );

  let tempRoot: string;
  let prevCwd: string;
  let server: DevServerHandle | null = null;

  beforeAll(async () => {
    prevCwd = process.cwd();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-refresh-stable-id-"));
    fs.cpSync(fixtureRoot, tempRoot, { recursive: true });

    const nmDir = path.join(tempRoot, "node_modules");
    fs.mkdirSync(nmDir, { recursive: true });

    // Avoid hard dependency on React being installed in the Ionify repo itself.
    // This test validates transform output, not real React runtime behavior.
    writeStubReactPackage(nmDir);
    writeStubReactDomPackage(nmDir);
    linkOrCopyPackage({ projectRoot, destNodeModulesDir: nmDir, name: "react-refresh" });

    process.chdir(tempRoot);
    resetIonifyConfigCache();
    resetResolverAliasCache();
    server = await startDevServer({ port: 0, enableSignalHandlers: false });
  }, 20000);

  afterAll(async () => {
    try {
      if (server) {
        await server.close();
      }
    } finally {
      if (prevCwd) {
        process.chdir(prevCwd);
      }
      if (tempRoot && fs.existsSync(tempRoot)) {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it("injects React Refresh bootstrap using a normalized module id (no ionify-hmr in ids)", async () => {
    if (!server) throw new Error("dev server not started");
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const res = await fetch(`${baseUrl}/src/NoHooks.tsx?ionify-hmr=123`);
    expect(res.status).toBe(200);

    const content = await res.text();

    // Uses Refresh runtime bootstrap and normalizes module id (strip cache-busting param).
    expect(content).toContain('from "/__ionify_hmr_client.js"');
    expect(content).toContain("setupReactRefresh");
    expect(content).toContain("normalizeRefreshModuleId(import.meta.url)");
    expect(content).not.toContain("ionify-hmr=");

    // React component exports are registered.
    expect(content).toContain("window.$RefreshReg$?.(NoHooks");

    // Accept wiring exists for the component module.
    expect(content).toContain("import.meta.hot.accept");
    expect(content).toContain("__ionifyRefresh__?.refresh?.(newModule)");
  });
});
