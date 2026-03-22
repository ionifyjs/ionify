import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { runBuildCommand } from "../src/cli/commands/build";
import { resetIonifyConfigCache } from "../src/cli/utils/config";

type ManifestChunk = {
  id: string;
  entry: boolean;
  files?: { js?: string[]; css?: string[]; assets?: string[] };
};

type BuildManifest = {
  chunks?: ManifestChunk[];
};

function readManifest(distDir: string): BuildManifest {
  const file = path.join(distDir, "manifest.json");
  const raw = fs.readFileSync(file, "utf8");
  return JSON.parse(raw) as BuildManifest;
}

function pickChunkMain(manifest: BuildManifest): ManifestChunk {
  const chunks = Array.isArray(manifest.chunks) ? manifest.chunks : [];
  const entry = chunks.find((c) => c.entry) ?? chunks.find((c) => c.id === "chunk-main");
  if (!entry) throw new Error("Missing entry chunk in manifest.json");
  return entry;
}

function pickPrimaryFile(files: string[] | undefined, suffix: string): string {
  const list = Array.isArray(files) ? files : [];
  const hit = list.find((f) => typeof f === "string" && f.endsWith(suffix));
  if (!hit) throw new Error(`Missing ${suffix} file in manifest chunk files`);
  return hit;
}

describe("Phase 14: CSS Modules build parity", () => {
  let prevCwd: string;
  let rootDir: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ionify-build-css-modules-"));
    fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });

    fs.writeFileSync(
      path.join(rootDir, "package.json"),
      JSON.stringify({ name: "test", type: "module" }) + "\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(rootDir, "index.html"),
      "<!doctype html><html><body><div id=\"root\"></div><script type=\"module\" src=\"/src/main.ts\"></script></body></html>\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(rootDir, "ionify.config.ts"),
      `export default { entry: "src/main.ts" };\n`,
      "utf8",
    );

    fs.writeFileSync(path.join(rootDir, "src", "template.txt"), "A\n", "utf8");
    fs.writeFileSync(
      path.join(rootDir, "postcss-template-dep.cjs"),
      `
const fs = require("fs");
const path = require("path");
module.exports = () => {
  return {
    postcssPlugin: "template-dep",
    Once(root, { result }) {
      const file = path.join(__dirname, "src", "template.txt");
      const value = fs.readFileSync(file, "utf8").trim();
      root.append({ selector: ".template-marker", nodes: [{ prop: "--template", value }] });
      result.messages.push({ type: "dependency", file });
    },
  };
};
module.exports.postcss = true;
      `.trim() + "\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(rootDir, "postcss.config.cjs"),
      `module.exports = { plugins: [require("./postcss-template-dep.cjs")] };\n`,
      "utf8",
    );

    fs.writeFileSync(path.join(rootDir, "src", "styles.module.css"), ".foo{color:red;}\n", "utf8");
    fs.writeFileSync(
      path.join(rootDir, "src", "main.ts"),
      `
import classes from "./styles.module.css";
(globalThis as any).__ionify_css_module_value = classes.foo;
export {};
      `.trim() + "\n",
      "utf8",
    );

    process.chdir(rootDir);
    resetIonifyConfigCache();
  });

  afterEach(() => {
    process.chdir(prevCwd);
    resetIonifyConfigCache();
    delete (globalThis as any).__ionify_css_module_value;
    if (rootDir && fs.existsSync(rootDir)) {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("emits runtime-safe token exports for .module.css in build output", async () => {
    await runBuildCommand({ outDir: "dist" });
    const distDir = path.join(rootDir, "dist");
    const manifest = readManifest(distDir);
    const chunk = pickChunkMain(manifest);
    const jsRel = pickPrimaryFile(chunk.files?.js, ".native.js").replace(/^\//, "");
    const jsAbs = path.join(distDir, jsRel);

    await import(pathToFileURL(jsAbs).href);

    const value = (globalThis as any).__ionify_css_module_value;
    expect(typeof value).toBe("string");
    expect(value).toMatch(/^foo___[0-9a-f]{6}$/);
  });

  it("invalidates CSS artifacts when PostCSS dependency changes (Tailwind-like)", async () => {
    await runBuildCommand({ outDir: "dist" });
    const distDir = path.join(rootDir, "dist");
    const manifest1 = readManifest(distDir);
    const chunk1 = pickChunkMain(manifest1);
    const cssRel1 = pickPrimaryFile(chunk1.files?.css, ".css").replace(/^\//, "");
    const cssAbs1 = path.join(distDir, cssRel1);
    const css1 = fs.readFileSync(cssAbs1, "utf8");
    expect(css1).toContain("template:A");

    fs.writeFileSync(path.join(rootDir, "src", "template.txt"), "B\n", "utf8");

    await runBuildCommand({ outDir: "dist" });
    const manifest2 = readManifest(distDir);
    const chunk2 = pickChunkMain(manifest2);
    const cssRel2 = pickPrimaryFile(chunk2.files?.css, ".css").replace(/^\//, "");
    const cssAbs2 = path.join(distDir, cssRel2);
    const css2 = fs.readFileSync(cssAbs2, "utf8");
    expect(css2).toContain("template:B");
    expect(css2).not.toBe(css1);
  });
});
