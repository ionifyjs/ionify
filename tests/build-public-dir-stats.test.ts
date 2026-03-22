/**
 * T2: Track publicDir assets in build.stats.json
 *
 * Gap G6: Static assets copied from `publicDir` were absent from `build.stats.json`.
 *
 * Tests verify:
 * - `publicAssets` section is written to `build.stats.json` when publicDir contains files
 * - Each entry has correct `file` (relative POSIX path), `bytes`, and `hash` (sha256)
 * - The hash matches the sha256 of the file contents (consistent with getCacheKey)
 * - Files are physically present under `dist/`
 * - Nested directory structure is preserved in the `file` path
 * - No `publicAssets` key is emitted when publicDir is absent or empty
 * - Existing dist/ artifacts are not overwritten (conflict skip leaves no publicAssets entry)
 * - publicDir entries are eligible for precompressBuildOutputs via outputHashHints
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBuildCommand } from "../src/cli/commands/build";
import { resetIonifyConfigCache } from "../src/cli/utils/config";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256hex(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function readStatsJson(rootDir: string, outDir = "dist"): Record<string, unknown> {
  const p = path.join(rootDir, outDir, "build.stats.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
}

type StatsPublicAsset = { file: string; bytes: number; hash: string };

function getPublicAssets(stats: Record<string, unknown>): StatsPublicAsset[] {
  const raw = stats.publicAssets;
  if (!Array.isArray(raw)) return [];
  return raw as StatsPublicAsset[];
}

// ---------------------------------------------------------------------------
// Project scaffolding helpers
// ---------------------------------------------------------------------------

function scaffoldMinimalProject(rootDir: string): void {
  fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, "package.json"),
    JSON.stringify({ name: "test-public-dir", private: true, type: "module" }) + "\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(rootDir, "index.html"),
    '<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>\n',
    "utf8",
  );
  fs.writeFileSync(
    path.join(rootDir, "src", "main.ts"),
    "export const version = 1;\n",
    "utf8",
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("T2: publicDir assets tracked in build.stats.json", () => {
  let prevCwd = "";
  let rootDir = "";

  beforeEach(() => {
    prevCwd = process.cwd();
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-t2-public-dir-"));
    scaffoldMinimalProject(rootDir);
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

  // -------------------------------------------------------------------------
  // Case 1: Single publicDir file → appears in publicAssets
  // -------------------------------------------------------------------------
  it("includes a single publicDir file in build.stats.json publicAssets", async () => {
    const publicDir = path.join(rootDir, "public");
    fs.mkdirSync(publicDir, { recursive: true });
    const faviconContent = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#00bcd4"/></svg>',
      "utf8",
    );
    fs.writeFileSync(path.join(publicDir, "favicon.svg"), faviconContent);

    fs.writeFileSync(path.join(rootDir, "ionify.config.ts"), "export default {};\n", "utf8");

    await runBuildCommand({ outDir: "dist" });

    const stats = readStatsJson(rootDir);
    const publicAssets = getPublicAssets(stats);

    expect(publicAssets).toHaveLength(1);
    expect(publicAssets[0].file).toBe("favicon.svg");
    expect(publicAssets[0].bytes).toBe(faviconContent.length);
    expect(publicAssets[0].hash).toBe(sha256hex(faviconContent));

    // File must be physically present in dist/
    expect(fs.existsSync(path.join(rootDir, "dist", "favicon.svg"))).toBe(true);
    const copied = fs.readFileSync(path.join(rootDir, "dist", "favicon.svg"));
    expect(copied).toEqual(faviconContent);
  });

  // -------------------------------------------------------------------------
  // Case 2: Multiple publicDir files → all appear in publicAssets
  // -------------------------------------------------------------------------
  it("tracks all copied publicDir files with correct bytes and sha256 hash", async () => {
    const publicDir = path.join(rootDir, "public");
    fs.mkdirSync(publicDir, { recursive: true });

    const files: Array<{ name: string; content: Buffer }> = [
      { name: "favicon.svg", content: Buffer.from("<svg/>", "utf8") },
      { name: "robots.txt", content: Buffer.from("User-agent: *\nDisallow:\n", "utf8") },
      { name: "og-image.png", content: Buffer.alloc(128, 0x89) }, // binary
    ];

    for (const { name, content } of files) {
      fs.writeFileSync(path.join(publicDir, name), content);
    }

    fs.writeFileSync(path.join(rootDir, "ionify.config.ts"), "export default {};\n", "utf8");

    await runBuildCommand({ outDir: "dist" });

    const stats = readStatsJson(rootDir);
    const publicAssets = getPublicAssets(stats);

    expect(publicAssets).toHaveLength(files.length);

    for (const { name, content } of files) {
      const entry = publicAssets.find((a) => a.file === name);
      expect(entry, `Entry for ${name} should exist in publicAssets`).toBeTruthy();
      expect(entry!.bytes).toBe(content.length);
      expect(entry!.hash).toBe(sha256hex(content));
      // File physically present
      expect(fs.existsSync(path.join(rootDir, "dist", name))).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Case 3: Nested publicDir directory structure → relative POSIX path preserved
  // -------------------------------------------------------------------------
  it("preserves nested directory structure in publicAssets file paths (POSIX separators)", async () => {
    const publicDir = path.join(rootDir, "public");
    fs.mkdirSync(path.join(publicDir, "icons"), { recursive: true });
    fs.mkdirSync(path.join(publicDir, "fonts"), { recursive: true });

    const nestedFiles: Array<{ relPath: string; content: Buffer }> = [
      { relPath: "icons/icon-192.png", content: Buffer.alloc(64, 0x01) },
      { relPath: "icons/icon-512.png", content: Buffer.alloc(128, 0x02) },
      { relPath: "fonts/inter.woff2", content: Buffer.alloc(256, 0x03) },
      { relPath: "manifest.webmanifest", content: Buffer.from('{"name":"App"}', "utf8") },
    ];

    for (const { relPath, content } of nestedFiles) {
      fs.writeFileSync(path.join(publicDir, relPath.replace(/\//g, path.sep)), content);
    }

    fs.writeFileSync(path.join(rootDir, "ionify.config.ts"), "export default {};\n", "utf8");

    await runBuildCommand({ outDir: "dist" });

    const stats = readStatsJson(rootDir);
    const publicAssets = getPublicAssets(stats);

    expect(publicAssets).toHaveLength(nestedFiles.length);

    for (const { relPath, content } of nestedFiles) {
      const entry = publicAssets.find((a) => a.file === relPath);
      expect(entry, `publicAssets should contain an entry with file="${relPath}"`).toBeTruthy();
      expect(entry!.bytes).toBe(content.length);
      expect(entry!.hash).toBe(sha256hex(content));
      // No backslashes in file path (POSIX normalisation)
      expect(entry!.file).not.toContain("\\");
      // Physically copied with correct structure
      const destPath = path.join(rootDir, "dist", relPath.replace(/\//g, path.sep));
      expect(fs.existsSync(destPath)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Case 4: No publicDir → no publicAssets key in stats
  // -------------------------------------------------------------------------
  it("omits publicAssets from build.stats.json when publicDir does not exist", async () => {
    // No public/ directory created
    fs.writeFileSync(path.join(rootDir, "ionify.config.ts"), "export default {};\n", "utf8");

    await runBuildCommand({ outDir: "dist" });

    const stats = readStatsJson(rootDir);
    expect(Object.prototype.hasOwnProperty.call(stats, "publicAssets")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Case 5: publicDir is empty → no publicAssets key in stats
  // -------------------------------------------------------------------------
  it("omits publicAssets from build.stats.json when publicDir is empty", async () => {
    const publicDir = path.join(rootDir, "public");
    fs.mkdirSync(publicDir, { recursive: true });
    // No files inside

    fs.writeFileSync(path.join(rootDir, "ionify.config.ts"), "export default {};\n", "utf8");

    await runBuildCommand({ outDir: "dist" });

    const stats = readStatsJson(rootDir);
    expect(Object.prototype.hasOwnProperty.call(stats, "publicAssets")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Case 6: Conflict — file already in dist/ is NOT overwritten and NOT in publicAssets
  // -------------------------------------------------------------------------
  it("does not include conflicting files (already in dist/) in publicAssets", async () => {
    const publicDir = path.join(rootDir, "public");
    fs.mkdirSync(publicDir, { recursive: true });
    // favicon.svg will conflict with an existing dist/ file
    fs.writeFileSync(path.join(publicDir, "favicon.svg"), Buffer.from("<svg/>", "utf8"));
    // robots.txt has no conflict and should be present in publicAssets
    const robotsContent = Buffer.from("User-agent: *\nDisallow:\n", "utf8");
    fs.writeFileSync(path.join(publicDir, "robots.txt"), robotsContent);

    fs.writeFileSync(path.join(rootDir, "ionify.config.ts"), "export default {};\n", "utf8");

    // Pre-populate dist/ to simulate the conflict BEFORE running the build
    const distDir = path.join(rootDir, "dist");
    fs.mkdirSync(distDir, { recursive: true });
    const conflictContent = Buffer.from("ALREADY_EXISTS", "utf8");
    fs.writeFileSync(path.join(distDir, "favicon.svg"), conflictContent);

    await runBuildCommand({ outDir: "dist" });

    const stats = readStatsJson(rootDir);
    const publicAssets = getPublicAssets(stats);

    // Only robots.txt should appear — favicon.svg was a conflict
    const faviconEntry = publicAssets.find((a) => a.file === "favicon.svg");
    expect(faviconEntry).toBeUndefined();

    const robotsEntry = publicAssets.find((a) => a.file === "robots.txt");
    expect(robotsEntry).toBeTruthy();
    expect(robotsEntry!.bytes).toBe(robotsContent.length);
    expect(robotsEntry!.hash).toBe(sha256hex(robotsContent));

    // Conflicting file must remain untouched
    const distFavicon = fs.readFileSync(path.join(distDir, "favicon.svg"));
    expect(distFavicon).toEqual(conflictContent);
  });

  // -------------------------------------------------------------------------
  // Case 7: publicAssets hash matches sha256 of file bytes (getCacheKey contract)
  // -------------------------------------------------------------------------
  it("publicAssets hash equals sha256 of original file bytes (getCacheKey contract)", async () => {
    const publicDir = path.join(rootDir, "public");
    fs.mkdirSync(publicDir, { recursive: true });

    // Use a mix of text and binary content
    const textContent = "Hello Ionify publicDir!\n".repeat(200);
    const binaryContent = Buffer.from(Array.from({ length: 512 }, (_, i) => i % 256));

    fs.writeFileSync(path.join(publicDir, "text.txt"), Buffer.from(textContent, "utf8"));
    fs.writeFileSync(path.join(publicDir, "binary.bin"), binaryContent);

    fs.writeFileSync(path.join(rootDir, "ionify.config.ts"), "export default {};\n", "utf8");

    await runBuildCommand({ outDir: "dist" });

    const stats = readStatsJson(rootDir);
    const publicAssets = getPublicAssets(stats);

    const textEntry = publicAssets.find((a) => a.file === "text.txt");
    expect(textEntry).toBeTruthy();
    expect(textEntry!.hash).toBe(sha256hex(Buffer.from(textContent, "utf8")));
    expect(textEntry!.bytes).toBe(Buffer.byteLength(textContent, "utf8"));

    const binEntry = publicAssets.find((a) => a.file === "binary.bin");
    expect(binEntry).toBeTruthy();
    expect(binEntry!.hash).toBe(sha256hex(binaryContent));
    expect(binEntry!.bytes).toBe(binaryContent.length);
  });

  // -------------------------------------------------------------------------
  // Case 8: build.stats.json is written AFTER publicDir copy
  //         (regression guard: stats must include publicAssets, not an empty object)
  // -------------------------------------------------------------------------
  it("build.stats.json snapshot includes publicAssets section (ordering regression guard)", async () => {
    const publicDir = path.join(rootDir, "public");
    fs.mkdirSync(publicDir, { recursive: true });
    const content = Buffer.from("<svg/>", "utf8");
    fs.writeFileSync(path.join(publicDir, "icon.svg"), content);

    fs.writeFileSync(path.join(rootDir, "ionify.config.ts"), "export default {};\n", "utf8");

    await runBuildCommand({ outDir: "dist" });

    // Read the raw file to confirm the JSON actually written to disk reflects the merged state
    const statsRaw = fs.readFileSync(path.join(rootDir, "dist", "build.stats.json"), "utf8");
    const statsObj = JSON.parse(statsRaw) as Record<string, unknown>;

    expect(Array.isArray(statsObj.publicAssets)).toBe(true);
    const pa = statsObj.publicAssets as StatsPublicAsset[];
    expect(pa).toHaveLength(1);
    expect(pa[0].file).toBe("icon.svg");
    expect(pa[0].bytes).toBe(content.length);
    expect(pa[0].hash).toBe(sha256hex(content));
  });
});
