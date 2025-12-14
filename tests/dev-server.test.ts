import fs from "fs";
import os from "os";
import path from "path";
import { expect, test } from "vitest";
import { startDevServer } from "../src/cli/commands/dev";
import { resetIonifyConfigCache } from "../src/cli/utils/config";
import { resetResolverAliasCache } from "../src/core/resolver";
import { publicPathForFile } from "../src/core/utils/public-path";

test("dev server serves project files over HTTP", async () => {
  const prevCwd = process.cwd();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-dev-test-"));
  const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-dev-external-"));

  try {
    fs.writeFileSync(
      path.join(tempRoot, "index.html"),
      "<!doctype html><html><body><h1>Ionify</h1></body></html>",
      "utf8"
    );
    fs.writeFileSync(path.join(tempRoot, "main.ts"), "export const answer = 42;\n", "utf8");
    fs.mkdirSync(path.join(tempRoot, "assets"), { recursive: true });

    const externalFile = path.join(externalDir, "external.js");
    fs.writeFileSync(externalFile, "export const external = 'ok';\n", "utf8");

    process.chdir(tempRoot);
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

      fs.writeFileSync(path.join(tempRoot, "esm.mjs"), "export const esm = 'ok';\n", "utf8");
      fs.writeFileSync(
        path.join(tempRoot, "cjs.cjs"),
        "module.exports = { cjs: 'ok' };\n",
        "utf8"
      );

      const esmResponse = await fetch(baseUrl + "/esm.mjs");
      expect(esmResponse.status).toBe(200);
      expect(esmResponse.headers.get("content-type")).toBe("application/javascript; charset=utf-8");

      const cjsResponse = await fetch(baseUrl + "/cjs.cjs");
      expect(cjsResponse.status).toBe(200);
      expect(cjsResponse.headers.get("content-type")).toBe("application/javascript; charset=utf-8");

      const externalPath = publicPathForFile(tempRoot, externalFile);
      const externalResponse = await fetch(baseUrl + externalPath);
      expect(externalResponse.status).toBe(200);
      expect(externalResponse.headers.get("content-type")).toContain("application/javascript");

      const dirResponse = await fetch(baseUrl + "/assets");
      expect([403, 404]).toContain(dirResponse.status);
    } finally {
      await handle.close();
    }
  } finally {
    process.chdir(prevCwd);
    resetIonifyConfigCache();
    resetResolverAliasCache();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(externalDir, { recursive: true, force: true });
  }
});
