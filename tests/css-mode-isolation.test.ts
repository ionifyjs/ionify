import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { startDevServer, type DevServerHandle } from "../src/cli/commands/dev";
import { resetIonifyConfigCache } from "../src/cli/utils/config";
import { resetResolverAliasCache } from "../src/core/resolver";
import { getCacheKey } from "../src/core/cache";

describe("Dev server CSS mode isolation + query parity", () => {
  let prevCwd: string;
  let rootDir: string;
  let server: DevServerHandle;
  let baseUrl: string;
  let cssPath: string;

  beforeEach(async () => {
    prevCwd = process.cwd();
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-css-mode-"));
    fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "package.json"), JSON.stringify({ name: "test" }));
    fs.writeFileSync(
      path.join(rootDir, "index.html"),
      "<!doctype html><html><body><div id=\"root\"></div></body></html>\n",
      "utf8",
    );
    fs.writeFileSync(path.join(rootDir, "src", "main.ts"), "import './styles.css';\n", "utf8");
    cssPath = path.join(rootDir, "src", "styles.css");
    fs.writeFileSync(cssPath, ".app-header{position:fixed;}\n", "utf8");

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

  it("serves raw CSS and ?inline JS without cache collision (raw -> inline)", async () => {
    const raw = await fetch(baseUrl + "/src/styles.css");
    expect(raw.status).toBe(200);
    expect(raw.headers.get("content-type")).toContain("text/css");
    const rawBody = await raw.text();
    expect(rawBody.trimStart().startsWith("// ionify:css")).toBe(false);

    const inline = await fetch(baseUrl + "/src/styles.css?inline");
    expect(inline.status).toBe(200);
    expect(inline.headers.get("content-type")).toContain("application/javascript");
    const inlineBody = await inline.text();
    expect(inlineBody.trimStart().startsWith("// ionify:css")).toBe(true);
  });

  it("serves ?inline JS and raw CSS without cache collision (inline -> raw)", async () => {
    const inline = await fetch(baseUrl + "/src/styles.css?inline");
    expect(inline.status).toBe(200);
    expect(inline.headers.get("content-type")).toContain("application/javascript");
    const inlineBody = await inline.text();
    expect(inlineBody.trimStart().startsWith("// ionify:css")).toBe(true);

    const raw = await fetch(baseUrl + "/src/styles.css");
    expect(raw.status).toBe(200);
    expect(raw.headers.get("content-type")).toContain("text/css");
    const rawBody = await raw.text();
    expect(rawBody.trimStart().startsWith("// ionify:css")).toBe(false);
  });

  it("supports ?raw (string module) and ?url (url module)", async () => {
    const rawString = await fetch(baseUrl + "/src/styles.css?raw");
    expect(rawString.status).toBe(200);
    expect(rawString.headers.get("content-type")).toContain("application/javascript");
    const rawStringBody = await rawString.text();
    expect(rawStringBody.trimStart().startsWith("// ionify:css")).toBe(true);
    expect(rawStringBody).toContain("export default css");

    const urlMod = await fetch(baseUrl + "/src/styles.css?url");
    expect(urlMod.status).toBe(200);
    expect(urlMod.headers.get("content-type")).toContain("application/javascript");
    const urlBody = await urlMod.text();
    expect(urlBody.trimStart().startsWith("// ionify:css")).toBe(true);
    expect(urlBody).toContain("export default url");
    expect(urlBody).toContain("styles.css?v=");
  });

  it("regenerates on CAS content-type mismatch (never serves raw CSS as JS)", async () => {
    const cssSource = fs.readFileSync(cssPath, "utf8");
    const contentHash = getCacheKey(cssSource);
    const mode = "css:inline";
    const depsStampHash = "0";
    const artifactHash = getCacheKey(
      `css:v2:${cssPath}:${contentHash}:${mode}:${depsStampHash}`,
    );
    const configHash = process.env.IONIFY_CONFIG_HASH;
    expect(configHash).toBeTruthy();

    const casFile = path.join(
      rootDir,
      ".ionify",
      "cas",
      configHash!,
      artifactHash,
      "transformed.js",
    );
    fs.mkdirSync(path.dirname(casFile), { recursive: true });
    fs.writeFileSync(casFile, cssSource, "utf8"); // wrong: raw CSS stored where JS is expected

    const inline = await fetch(baseUrl + "/src/styles.css?inline");
    expect(inline.status).toBe(200);
    expect(inline.headers.get("content-type")).toContain("application/javascript");
    const inlineBody = await inline.text();
    expect(inlineBody.trimStart().startsWith("// ionify:css")).toBe(true);
  });
});

