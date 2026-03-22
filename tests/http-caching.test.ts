import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { startDevServer, type DevServerHandle } from "../src/cli/commands/dev";

describe("Dev server HTTP caching", () => {
  let server: DevServerHandle;
  let port: number;
  const testRoot = path.join(process.cwd(), ".test-project-http-cache");

  beforeAll(async () => {
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(testRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(testRoot, "package.json"), JSON.stringify({ name: "test" }));
    // Ensure this fixture is treated as its own workspace (Phase 6.5+ workspace-scoped engine state),
    // otherwise Ionify will detect the repo root workspace markers and place `.ionify/` there.
    fs.writeFileSync(path.join(testRoot, "pnpm-workspace.yaml"), "packages:\n  - \"**\"\n");
    fs.writeFileSync(path.join(testRoot, "src", "main.ts"), "export const answer = 42;\n");
    fs.writeFileSync(
      path.join(testRoot, "index.html"),
      "<!doctype html><html><head><meta charset=\"utf-8\" /></head><body>Hello</body></html>\n",
    );

    const originalCwd = process.cwd();
    try {
      process.chdir(testRoot);
      server = await startDevServer({ port: 0, enableSignalHandlers: false });
      port = server.port;

      // Create a cached dep file directly in the depsRoot so /@deps serves it as a HIT.
      const depsBase = path.join(testRoot, ".ionify", "deps");
      const depsHashDirs = fs
        .readdirSync(depsBase, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
      expect(depsHashDirs.length).toBeGreaterThan(0);
      const depsRoot = path.join(depsBase, depsHashDirs[0]);

      const depFileName = "dummy@1.0.0_abc123.js";
      fs.writeFileSync(path.join(depsRoot, depFileName), "export const dummy = 1;\n");
    } finally {
      process.chdir(originalCwd);
    }
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("sets ETag + Cache-Control: immutable for /@deps and returns 304 on revalidate", async () => {
    const url = `http://localhost:${port}/@deps/dummy@1.0.0_abc123.js`;

    const first = await fetch(url);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toContain("immutable");

    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const second = await fetch(url, {
      headers: {
        "If-None-Match": etag!,
      },
    });
    expect(second.status).toBe(304);
  });

  it("sets ETag + Cache-Control: no-cache for transformed modules and returns 304 on revalidate", async () => {
    const url = `http://localhost:${port}/src/main.ts`;

    const first = await fetch(url);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toContain("no-cache");

    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const second = await fetch(url, {
      headers: {
        "If-None-Match": etag!,
      },
    });
    expect(second.status).toBe(304);
  });
});
