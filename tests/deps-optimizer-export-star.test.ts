import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { startDevServer, type DevServerHandle } from "../src/cli/commands/dev";
import { resetIonifyConfigCache } from "../src/cli/utils/config";
import { resetResolverAliasCache } from "../src/core/resolver";

describe("Deps optimizer ESM export* surface (re-exports)", () => {
  let prevCwd: string;
  let rootDir: string;
  let server: DevServerHandle;
  let baseUrl: string;

  beforeEach(async () => {
    prevCwd = process.cwd();
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-export-star-"));
    fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });

    const nodeModules = path.join(rootDir, "node_modules");
    fs.mkdirSync(nodeModules, { recursive: true });

    // Fake scoped packages: @tanstack/react-query and @tanstack/query-core.
    const tanstackDir = path.join(nodeModules, "@tanstack");
    fs.mkdirSync(tanstackDir, { recursive: true });

    const rqDir = path.join(tanstackDir, "react-query");
    fs.mkdirSync(path.join(rqDir, "build", "modern"), { recursive: true });
    fs.writeFileSync(
      path.join(rqDir, "package.json"),
      JSON.stringify({
        name: "@tanstack/react-query",
        version: "1.0.0",
        main: "build/modern/index.js",
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(rqDir, "build", "modern", "index.js"),
      `export * from '@tanstack/query-core';\nexport const QueryClientProvider = 1;\n`,
      "utf8",
    );

    const qcDir = path.join(tanstackDir, "query-core");
    fs.mkdirSync(path.join(qcDir, "build", "modern"), { recursive: true });
    fs.writeFileSync(
      path.join(qcDir, "package.json"),
      JSON.stringify({
        name: "@tanstack/query-core",
        version: "1.0.0",
        main: "build/modern/index.js",
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(qcDir, "build", "modern", "index.js"),
      `export class QueryClient {}\nexport const qc = 1;\n`,
      "utf8",
    );

    // Fake internal export*: pkg/index.js -> export* from ./foo.js
    const pkgDir = path.join(nodeModules, "pkg");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "pkg", version: "1.0.0", main: "index.js" }),
      "utf8",
    );
    fs.writeFileSync(path.join(pkgDir, "index.js"), `export * from './foo.js';\n`, "utf8");
    fs.writeFileSync(path.join(pkgDir, "foo.js"), `export const Foo = 1;\n`, "utf8");

    fs.writeFileSync(
      path.join(rootDir, "index.html"),
      "<!doctype html><html><head></head><body><div id=\"root\"></div><script type=\"module\" src=\"/src/main.tsx\"></script></body></html>\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(rootDir, "src", "main.tsx"),
      `import { QueryClient } from '@tanstack/react-query';\nimport { Foo } from 'pkg';\nconsole.log(QueryClient, Foo);\n`,
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

  it("exposes export* re-exports (external + internal) without missing named exports", async () => {
    const mainRes = await fetch(baseUrl + "/src/main.tsx");
    expect(mainRes.status).toBe(200);
    const mainCode = await mainRes.text();

    const rqMatch = mainCode.match(/\/@deps\/tanstack__react-query@1\.0\.0[^"']+\.js/);
    expect(rqMatch).toBeTruthy();
    const reactQueryUrl = rqMatch![0];

    const pkgMatch = mainCode.match(/\/@deps\/pkg@1\.0\.0[^"']+\.js/);
    expect(pkgMatch).toBeTruthy();
    const pkgUrl = pkgMatch![0];

    const rqRes = await fetch(baseUrl + reactQueryUrl);
    expect(rqRes.status).toBe(200);
    const rqCode = await rqRes.text();
    expect(rqCode).toMatch(/export \* from \"\/@deps\/tanstack__query-core@1\.0\.0/);

    const pkgRes = await fetch(baseUrl + pkgUrl);
    expect(pkgRes.status).toBe(200);
    const pkgCode = await pkgRes.text();
    expect(pkgCode).toContain("const __ionify_export_Foo = __exports.Foo;");
    expect(pkgCode).toContain("export { __ionify_export_Foo as Foo };");
  });
});

