import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBuildCommand } from "../src/cli/commands/build";
import { resetIonifyConfigCache } from "../src/cli/utils/config";

type BuildManifest = {
  entries?: string[];
  chunks?: Array<{
    id: string;
    entry: boolean;
    files?: { js?: string[]; css?: string[]; assets?: string[] };
  }>;
};

describe("build entry inference", () => {
  let prevCwd = "";
  let rootDir = "";

  beforeEach(() => {
    prevCwd = process.cwd();
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-build-entry-infer-"));
    fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });

    fs.writeFileSync(
      path.join(rootDir, "package.json"),
      JSON.stringify({ name: "test-app", private: true, type: "module" }) + "\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(rootDir, "index.html"),
      "<!doctype html><html><body><div id=\"app\"></div><script type=\"module\" src=\"/src/main.ts\"></script></body></html>\n",
      "utf8",
    );
    fs.writeFileSync(path.join(rootDir, "ionify.config.ts"), "export default {};\n", "utf8");
    fs.writeFileSync(
      path.join(rootDir, "src", "main.ts"),
      "document.body?.setAttribute('data-ionify', 'ok');\n",
      "utf8",
    );

    process.chdir(rootDir);
    resetIonifyConfigCache();
  });

  afterEach(() => {
    process.chdir(prevCwd);
    resetIonifyConfigCache();
    if (rootDir && fs.existsSync(rootDir)) {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("builds from index.html module entry when config.entry is absent", async () => {
    await runBuildCommand({ outDir: "dist" });

    const manifest = JSON.parse(
      fs.readFileSync(path.join(rootDir, "dist", "manifest.json"), "utf8"),
    ) as BuildManifest;
    const entryChunk = (manifest.chunks ?? []).find((chunk) => chunk.entry);

    expect(Array.isArray(manifest.entries)).toBe(true);
    expect(manifest.entries?.length).toBeGreaterThan(0);
    expect(entryChunk).toBeTruthy();
    expect(entryChunk?.files?.js?.some((file) => file.endsWith(".native.js"))).toBe(true);

    const html = fs.readFileSync(path.join(rootDir, "dist", "index.html"), "utf8");
    expect(html).not.toContain("/src/main.ts");
    expect(html).toContain(".native.js");
  });
});
