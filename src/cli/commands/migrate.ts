/**
 * `ionify migrate` — auto-convert a Vite project to Ionify (in-place + backups + report).
 *
 * Strategy:
 *  1. Detect a Vite project (vite.config.* and/or a `vite` dependency).
 *  2. Resolve the Vite config by transpiling it with Ionify's OWN native SWC transform
 *     (`tryNativeTransform` → the same `parseAndTransformSwc` NAPI the engine uses for every
 *     `.ts` file; `@swc/core` is the in-repo fallback) and dynamic-importing it — so plugin
 *     imports and `path.resolve(__dirname,…)` expressions evaluate exactly as Vite would.
 *     No esbuild: Ionify is fully native and never depends on a foreign bundler. `.js`/`.mjs`
 *     configs are imported directly with no transpile. A best-effort static parse is the last
 *     resort.
 *  3. Map the common surface (resolve.alias / server / build / css / define / envPrefix /
 *     base / publicDir / plugins) to an `ionify.config.ts`.
 *  4. Rewrite package.json scripts (vite → ionify) and add `ionify` to devDependencies.
 *  5. Back up everything it touches and write MIGRATION_REPORT.md.
 *
 * Runtime compatibility (Vite-order `.env`, `%VITE_*%` index.html substitution) is already
 * handled by the engine, so a migrated app's `index.html` and `.env` work unchanged.
 */

import fs from "fs";
import path from "path";
import { logInfo, logWarn, logError } from "@cli/utils/logger";
import { tryNativeTransform } from "@native/index";

export interface MigrateOptions {
  cwd?: string;
  force?: boolean;
}

const VITE_CONFIG_NAMES = [
  "vite.config.ts",
  "vite.config.mts",
  "vite.config.cts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs",
];

export async function runMigrateCommand(options: MigrateOptions = {}): Promise<void> {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  const report: string[] = [];

  // ── 1. Detect ───────────────────────────────────────────────────────────────
  const viteConfigPath =
    VITE_CONFIG_NAMES.map((name) => path.join(cwd, name)).find((p) => fs.existsSync(p)) ?? null;
  const pkgPath = path.join(cwd, "package.json");
  const pkg = readJson(pkgPath);
  const hasViteDep = !!(
    pkg &&
    ((pkg.dependencies && pkg.dependencies.vite) || (pkg.devDependencies && pkg.devDependencies.vite))
  );

  if (!viteConfigPath && !hasViteDep) {
    logError(
      "No Vite project detected here (no vite.config.* and no `vite` dependency). " +
        "Run `ionify migrate` from the project root.",
    );
    process.exit(1);
  }

  const ionifyConfigOut = path.join(cwd, "ionify.config.ts");
  if (fs.existsSync(ionifyConfigOut) && !options.force) {
    logError(
      "ionify.config.ts already exists. Re-run with --force to overwrite (a .bak copy is kept).",
    );
    process.exit(1);
  }

  logInfo(`Migrating Vite → Ionify in ${cwd}`);

  // ── 2. Resolve the Vite config ──────────────────────────────────────────────
  let viteConfig: Record<string, unknown> = {};
  if (viteConfigPath) {
    try {
      viteConfig = await loadViteConfig(viteConfigPath, cwd);
      logInfo(`Resolved ${path.basename(viteConfigPath)}`);
    } catch (err) {
      logWarn(
        `Could not execute ${path.basename(viteConfigPath)} (${String(
          (err as Error)?.message ?? err,
        )}); using best-effort static parse.`,
      );
      report.push(
        `⚠ The Vite config could not be executed; values were extracted by static parse. ` +
          `Review the generated ionify.config.ts against ${path.basename(viteConfigPath)}.`,
      );
      viteConfig = staticParseViteConfig(fs.readFileSync(viteConfigPath, "utf8"));
    }
  } else {
    report.push("⚠ No vite.config.* found — generated a minimal ionify.config.ts from package.json.");
  }

  // ── 3. Map → IonifyConfig ───────────────────────────────────────────────────
  const { ionifyConfig, notes } = mapViteToIonify(viteConfig, cwd);
  report.push(...notes);

  // ── 4. Write ionify.config.ts (backup if overwriting) ───────────────────────
  if (fs.existsSync(ionifyConfigOut)) backupFile(ionifyConfigOut);
  fs.writeFileSync(ionifyConfigOut, serializeIonifyConfig(ionifyConfig), "utf8");
  logInfo("Wrote ionify.config.ts");

  // ── 5. Back up vite.config + rewrite package.json ───────────────────────────
  if (viteConfigPath) {
    backupFile(viteConfigPath);
    report.push(`• Backed up ${path.basename(viteConfigPath)} → ${path.basename(viteConfigPath)}.bak`);
  }
  if (pkg) {
    backupFile(pkgPath);
    report.push(...updatePackageJson(pkg, pkgPath));
    logInfo("Updated package.json scripts + added `ionify` devDependency (vite left installed)");
  }

  // ── 6. Report + summary ─────────────────────────────────────────────────────
  writeReport(cwd, viteConfigPath, ionifyConfig, report);
  logInfo("");
  logInfo("✅ Migration complete.");
  logInfo("   1. Install Ionify:  npm install   (or pnpm/yarn install)");
  logInfo("   2. Start dev:       ionify dev");
  logInfo("   3. Review MIGRATION_REPORT.md for anything that needs manual attention.");
}

// ── Vite config resolution (Ionify-native transpile + dynamic import) ──────────

async function loadViteConfig(configPath: string, cwd: string): Promise<Record<string, unknown>> {
  const ext = path.extname(configPath).toLowerCase();
  let importUrl: string;
  let tmpFile: string | null = null;

  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    // Plain JS config — import as-is, no transpile.
    importUrl = `file://${configPath}`;
  } else {
    // .ts/.mts/.cts — strip types with Ionify's native SWC transform (no esbuild).
    const source = fs.readFileSync(configPath, "utf8");
    const code = transpileConfigToEsm(source, configPath);
    // Emit next to the original config so BOTH relative (`./x`) and node_modules
    // (`vite`, plugins) imports resolve exactly as the original would.
    tmpFile = path.join(path.dirname(configPath), `.ionify-migrate.${Date.now()}.mjs`);
    fs.writeFileSync(tmpFile, code, "utf8");
    importUrl = `file://${tmpFile}`;
  }

  try {
    const mod = await import(importUrl);
    let cfg: unknown = (mod as { default?: unknown }).default ?? mod;
    if (typeof cfg === "function") {
      cfg = await (cfg as (env: unknown) => unknown)({
        command: "build",
        mode: "production",
        isSsrBuild: false,
        isPreview: false,
        ssrBuild: false,
      });
    }
    cfg = await cfg;
    return cfg && typeof cfg === "object" ? (cfg as Record<string, unknown>) : {};
  } finally {
    if (tmpFile) {
      try {
        fs.rmSync(tmpFile, { force: true });
      } catch {
        /* best effort */
      }
    }
  }
}

/** TypeScript → ESM JS using Ionify's native transform, with the in-repo @swc/core fallback. */
function transpileConfigToEsm(source: string, filename: string): string {
  let code: string | null = null;

  // Primary: the engine's own native SWC NAPI (same path every .ts source uses).
  const native = tryNativeTransform("swc", source, { filename, typescript: true, jsx: false });
  if (native?.code) {
    code = native.code;
  } else {
    // Fallback: @swc/core (already an Ionify dependency / used by the worker pool).
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const swc = require("@swc/core") as typeof import("@swc/core");
      code = swc.transformSync(source, {
        filename,
        jsc: { parser: { syntax: "typescript", tsx: false }, target: "es2022" },
        module: { type: "es6" },
        sourceMaps: false,
      }).code;
    } catch (err) {
      throw new Error(`native transform unavailable and @swc/core fallback failed: ${String(err)}`);
    }
  }

  // Vite TS configs commonly use the CJS globals `__dirname` / `__filename` (e.g.
  // `path.resolve(__dirname, "src")`). In an ESM module those are undefined, so shim them
  // — the transpiled file is emitted in the original config's directory, so
  // `import.meta.url` resolves `__dirname` to exactly the config's dir. Skip the shim if the
  // config declares them itself (ESM-style) to avoid a redeclaration SyntaxError.
  const usesDirname = /\b__dirname\b/.test(source) || /\b__filename\b/.test(source);
  const declaresDirname = /\b(?:const|let|var)\s+__(?:dir|file)name\b/.test(source);
  if (usesDirname && !declaresDirname) {
    const shim =
      `import { fileURLToPath as __ionifyFileURLToPath } from "url";\n` +
      `import { dirname as __ionifyDirname } from "path";\n` +
      `const __filename = __ionifyFileURLToPath(import.meta.url);\n` +
      `const __dirname = __ionifyDirname(__filename);\n`;
    code = shim + code;
  }

  return code;
}

// ── Best-effort static fallback (only when execution fails) ────────────────────

function staticParseViteConfig(source: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const baseMatch = source.match(/\bbase\s*:\s*["'`]([^"'`]+)["'`]/);
  if (baseMatch) out.base = baseMatch[1];
  const portMatch = source.match(/\bport\s*:\s*(\d+)/);
  const outDirMatch = source.match(/\boutDir\s*:\s*["'`]([^"'`]+)["'`]/);
  if (portMatch) out.server = { port: Number(portMatch[1]) };
  if (outDirMatch) out.build = { outDir: outDirMatch[1] };
  return out;
}

// ── Mapping Vite config → IonifyConfig ─────────────────────────────────────────

function mapViteToIonify(
  vite: Record<string, unknown>,
  cwd: string,
): { ionifyConfig: Record<string, unknown>; notes: string[] } {
  const out: Record<string, unknown> = {
    productionArtifactPublishing: "auto",
  };
  const notes: string[] = [
    "• Enabled Production Publishing in auto mode; set productionArtifactPublishing: false to opt out.",
  ];
  const v = (k: string) => vite[k] as Record<string, any> | undefined;

  // resolve.alias
  const alias = v("resolve")?.alias;
  const aliasObj: Record<string, string> = {};
  if (Array.isArray(alias)) {
    for (const entry of alias) {
      if (entry && typeof entry.find === "string" && typeof entry.replacement === "string") {
        aliasObj[entry.find] = toRootRelative(entry.replacement, cwd);
      }
    }
  } else if (alias && typeof alias === "object") {
    for (const [k, val] of Object.entries(alias)) {
      if (typeof val === "string") aliasObj[k] = toRootRelative(val, cwd);
    }
  }
  if (Object.keys(aliasObj).length) out.resolve = { alias: aliasObj };

  // server
  const server: Record<string, unknown> = {};
  const vServer = v("server");
  if (typeof vServer?.port === "number") server.port = vServer.port;
  if (typeof vServer?.host === "string") server.host = vServer.host;
  else if (vServer?.host === true) server.host = "0.0.0.0";
  if (vServer?.https) {
    server.https = true;
    notes.push("• server.https → `true`. If you used custom cert/key, set them in Ionify's server.https config.");
  }
  if (vServer?.cors !== undefined) server.cors = !!vServer.cors;
  if (vServer?.proxy) {
    notes.push("⚠ server.proxy is set in Vite — Ionify's dev proxy is configured differently. Port it manually.");
  }
  if (Object.keys(server).length) out.server = server;

  // build
  const build: Record<string, unknown> = {};
  const vBuild = v("build");
  if (typeof vBuild?.outDir === "string") build.outDir = vBuild.outDir;
  if (typeof vBuild?.sourcemap === "boolean") build.sourcemap = vBuild.sourcemap;
  if (vBuild?.minify !== undefined) build.minify = vBuild.minify !== false;
  if (typeof vBuild?.target === "string") build.target = vBuild.target;
  if (Object.keys(build).length) out.build = build;

  // css
  const vCss = v("css");
  if (vCss) {
    const css: Record<string, unknown> = {};
    if (vCss.modules) css.modules = vCss.modules === true ? {} : vCss.modules;
    if (typeof vCss.postcss === "string") css.postcss = vCss.postcss;
    if (Object.keys(css).length) out.css = css;
    if (vCss.preprocessorOptions) {
      notes.push("⚠ css.preprocessorOptions (Sass/Less) present — verify under Ionify css config.");
    }
  }

  // define / envPrefix / base / publicDir
  if (vite.define && typeof vite.define === "object") out.define = vite.define;
  if (vite.envPrefix) out.envPrefix = vite.envPrefix as string | string[];
  if (typeof vite.base === "string" && vite.base !== "/") out.base = vite.base;
  if (typeof vite.publicDir === "string") out.publicDir = toRootRelative(vite.publicDir, cwd);
  else if (vite.publicDir === false) out.publicDir = false;

  // plugins
  const plugins = Array.isArray(vite.plugins) ? (vite.plugins as unknown[]).flat(Infinity) : [];
  for (const p of plugins) {
    const name = pluginName(p);
    if (!name) continue;
    if (/(^|[^a-z])react([^a-z]|$)/i.test(name)) {
      notes.push(`• Plugin "${name}" → Ionify has built-in React + Fast Refresh; no plugin needed.`);
    } else {
      notes.push(`⚠ Plugin "${name}" is not auto-mapped — check whether Ionify covers it natively.`);
    }
  }

  return { ionifyConfig: out, notes };
}

function pluginName(plugin: unknown): string | null {
  if (!plugin) return null;
  if (Array.isArray(plugin)) {
    for (const p of plugin) {
      const n = pluginName(p);
      if (n) return n;
    }
    return null;
  }
  if (typeof plugin === "object" && typeof (plugin as { name?: unknown }).name === "string") {
    return (plugin as { name: string }).name;
  }
  return null;
}

/** Convert an absolute or relative path to a root-relative `/segment` form Ionify aliases use. */
function toRootRelative(p: string, cwd: string): string {
  if (!path.isAbsolute(p)) {
    return "/" + p.replace(/^\.\//, "").replace(/^\/+/, "");
  }
  const rel = path.relative(cwd, p);
  if (rel.startsWith("..")) return p; // outside the project — keep absolute
  return "/" + rel.split(path.sep).join("/");
}

// ── package.json rewrite ───────────────────────────────────────────────────────

function updatePackageJson(pkg: Record<string, any>, pkgPath: string): string[] {
  const notes: string[] = [];
  pkg.scripts = pkg.scripts || {};
  for (const [name, raw] of Object.entries(pkg.scripts)) {
    if (typeof raw !== "string") continue;
    if (/\bvite\s+preview\b/.test(raw)) {
      notes.push(
        `• Script "${name}" runs \`vite preview\` — Ionify has no preview server; ` +
          `serve the build output with any static file server.`,
      );
      continue;
    }
    const next = raw
      .replace(/\bvite\s+build\b/g, "ionify build")
      .replace(/\bvite\s+optimize\b/g, "ionify build")
      .replace(/(^|\s)vite(\s|$)/g, "$1ionify dev$2")
      .trimEnd();
    if (next !== raw) pkg.scripts[name] = next;
  }

  pkg.devDependencies = pkg.devDependencies || {};
  const hasIonify = (pkg.dependencies && pkg.dependencies.ionify) || pkg.devDependencies.ionify;
  if (!hasIonify) {
    pkg.devDependencies.ionify = "latest";
    notes.push("• Added `ionify@latest` to devDependencies — run your package manager's install.");
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  notes.push("• package.json scripts rewritten (vite → ionify); original saved as package.json.bak.");
  return notes;
}

// ── Serialization + report + io helpers ────────────────────────────────────────

function serializeIonifyConfig(config: Record<string, unknown>): string {
  const body = Object.keys(config).length ? JSON.stringify(config, null, 2) : "{}";
  return (
    `import { defineConfig } from "ionify";\n\n` +
    `// Generated by \`ionify migrate\`. Review against your previous vite.config.\n` +
    `export default defineConfig(${body});\n`
  );
}

function writeReport(
  cwd: string,
  viteConfigPath: string | null,
  ionifyConfig: Record<string, unknown>,
  notes: string[],
): void {
  const lines: string[] = [];
  lines.push("# Ionify Migration Report", "");
  lines.push(`Migrated from: \`${viteConfigPath ? path.basename(viteConfigPath) : "(no vite.config)"}\``);
  lines.push("Generated: `ionify.config.ts` + updated `package.json` scripts", "");
  lines.push("## Mapped configuration", "");
  lines.push("```ts");
  lines.push(serializeIonifyConfig(ionifyConfig).trim());
  lines.push("```", "");
  lines.push("## Notes & manual steps", "");
  if (notes.length === 0) {
    lines.push("- Nothing flagged — a clean, fully-mapped migration. 🎉");
  } else {
    for (const n of notes) lines.push(`- ${n.replace(/^[•\s]+/, "")}`);
  }
  lines.push("", "## Runtime compatibility (already handled by Ionify)", "");
  lines.push("- `.env` files load in Vite order; `%VITE_*%` placeholders in `index.html` are substituted.");
  lines.push("- `index.html` is the entry document as in Vite — no change needed.");
  lines.push("- `vite` is left installed so you can revert via the `.bak` files if needed.");
  fs.writeFileSync(path.join(cwd, "MIGRATION_REPORT.md"), lines.join("\n") + "\n", "utf8");
}

function backupFile(filePath: string): void {
  try {
    fs.copyFileSync(filePath, `${filePath}.bak`);
  } catch {
    /* best effort */
  }
}

function readJson(filePath: string): Record<string, any> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
