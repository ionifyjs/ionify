/**
{
  "description": "CSS loader. Compiles CSS through PostCSS, supports CSS modules, and emits JS modules for inline imports.",
  "phase": 2,
  "todo": [
    "Load PostCSS plugins from config.",
    "Generate scoped CSS modules tokens.",
    "Inject styles with HMR-friendly module output."
  ]
}
*/

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { performance } from "perf_hooks";
import { createRequire } from "module";
import { pathToFileURL, fileURLToPath } from "url";
import postcss, { AcceptedPlugin, ProcessOptions } from "postcss";
import postcssLoadConfig from "postcss-load-config";
import postcssModules from "postcss-modules";
import { getCacheKey } from "@core/cache";
import type { IonifyCSSConfig } from "@core/types/config";
import {
  buildCssDemandAnalysis,
  computeCssDemandGraphContentStamp,
  type CssDemandAnalysis,
} from "./css-demand";

type CssTokens = Record<string, string>;

export type CssDependency = {
  filePath: string;
  kind: "dependency";
};

/**
 * Completeness authority for the Tailwind content set (Completeness law, R1).
 *
 * Tailwind utility generation is a correctness decision (authority A8): a
 * missing utility renders the document wrong. The content set that drives it
 * MUST come from a source whose completeness is proven for the document.
 *
 * - `config-globs` — the caller CANNOT prove content completeness (e.g. dev's
 *   live, request-shaped graph, which is only warm-complete). Fail closed to
 *   Tailwind's own config `content` globs — the original, Node-complete
 *   authority. The graph is an optimization input, not a correctness authority.
 * - `graph` — the caller HAS a reachability-complete file set (the build plan).
 *   Narrowing to it is a proven-safe optimization.
 */
export type TailwindContentAuthority =
  | { mode: "config-globs" }
  | { mode: "graph"; files: string[] };

interface CompileCssOptions {
  code: string;
  filePath: string;
  rootDir: string;
  modules?: boolean;
  modulesOptions?: IonifyCSSConfig["modules"];
  preprocessorOptions?: IonifyCSSConfig["preprocessorOptions"];
  /**
   * R1: explicit completeness authority for Tailwind content. Absent → fail
   * closed to config globs (completeness unproven). Dev passes `config-globs`;
   * a caller with a proven-complete plan passes `graph`.
   */
  tailwindContentAuthority?: TailwindContentAuthority;
}

type PreprocessorLang = "scss" | "sass" | "less" | "styl";

interface PreprocessOutcome {
  css: string;
  deps: string[];
  /** Stable preprocessor identity (lib + version) folded into the pipeline hash. */
  version: string;
}

function detectPreprocessorLang(filePath: string): PreprocessorLang | null {
  const ext = path.extname(filePath.split("?")[0].split("#")[0]).toLowerCase();
  if (ext === ".scss") return "scss";
  if (ext === ".sass") return "sass";
  if (ext === ".less") return "less";
  if (ext === ".styl" || ext === ".stylus") return "styl";
  return null;
}

/**
 * Lazy-load a preprocessor (`sass`/`less`) from the PROJECT first (so the app pins its own
 * version, like Vite), then the engine's own node_modules. Returns null if neither resolves.
 */
function loadProjectPreprocessor(name: string, rootDir: string, fromFile: string): any | null {
  for (const base of [fromFile, path.join(rootDir, "package.json")]) {
    try {
      const req = createRequire(base);
      req.resolve(name);
      return req(name);
    } catch {
      /* try next base */
    }
  }
  try {
    return createRequire(__filename ?? fromFile)(name);
  } catch {
    return null;
  }
}

/**
 * Preprocessor pre-pass (css-pipeline-contract §8): compile Sass/SCSS/Less to CSS BEFORE PostCSS,
 * deterministically. Records preprocessor import deps (for watch/invalidation) and returns a stable
 * lib+version identity to fold into the pipeline hash. Stylus is reserved (future-planned, §8).
 */
async function runPreprocessor(
  code: string,
  filePath: string,
  rootDir: string,
  lang: PreprocessorLang,
  options: Record<string, any> | undefined,
): Promise<PreprocessOutcome> {
  const deps: string[] = [];
  if (lang === "scss" || lang === "sass") {
    const sass = loadProjectPreprocessor("sass", rootDir, filePath);
    if (!sass) {
      throw new Error(
        `[ionify:css] "${path.basename(filePath)}" requires the "sass" package — install it in your project: pnpm add -D sass`,
      );
    }
    const langOpts = (options?.[lang] ?? options?.scss ?? {}) as Record<string, any>;
    const result = sass.compileString(code, {
      syntax: lang === "sass" ? "indented" : "scss",
      url: pathToFileURL(filePath),
      loadPaths: [path.dirname(filePath), rootDir, path.join(rootDir, "node_modules")],
      ...langOpts,
    });
    for (const u of (result.loadedUrls ?? []) as Array<URL | string>) {
      try {
        const p = fileURLToPath(u);
        if (p && p !== filePath) deps.push(p);
      } catch {
        /* non-file URL (e.g. sass: built-ins) — ignore */
      }
    }
    return { css: result.css, deps, version: `sass:${String(sass.info ?? "").split("\t")[1] ?? ""}` };
  }
  if (lang === "less") {
    const less = loadProjectPreprocessor("less", rootDir, filePath);
    if (!less) {
      throw new Error(
        `[ionify:css] "${path.basename(filePath)}" requires the "less" package — install it in your project: pnpm add -D less`,
      );
    }
    const langOpts = (options?.less ?? {}) as Record<string, any>;
    const result = await less.render(code, {
      filename: filePath,
      paths: [path.dirname(filePath), rootDir],
      ...langOpts,
    });
    for (const p of (result.imports ?? []) as string[]) {
      if (p && p !== filePath) deps.push(p);
    }
    return { css: result.css, deps, version: `less:${String((less.version ?? []).join?.(".") ?? less.version ?? "")}` };
  }
  // Stylus — reserved (future-planned alongside native-Rust preprocessing, css-pipeline-contract §8).
  throw new Error(
    `[ionify:css] Stylus (.styl) is not yet wired into Ionify's preprocessor pre-pass — Sass/SCSS and Less are supported. (Native-Rust + Stylus are future-planned: css-pipeline-contract §8.)`,
  );
}

export interface CompileCssResult {
  css: string;
  tokens?: CssTokens;
  deps: CssDependency[];
  urlDeps: CssDependency[];
  pipelineHash: string;
  cssDemand?: CssDemandAnalysis | null;
  tailwindGraphContent?: CssTailwindGraphContentProfile | null;
  profile?: CompileCssProfile;
}

export type CssTailwindGraphContentProfile = {
  attempted: boolean;
  enabled: boolean;
  ms: number;
  files: number;
  plugins: number;
  configPath: string | null;
  fallbackReason: string | null;
  /**
   * CSSA-owned aggregated content stamp over the graph-admitted Tailwind
   * content set. Tailwind graph narrowing makes CSS output depend on these
   * sources; freshness is proven by this one stamp, never by admitting the
   * source files as per-artifact CSS dependencies.
   */
  stamp?: string | null;
};

export type CompileCssProfile = {
  totalMs: number;
  preprocessorMs: number;
  postcssConfigLoadMs: number;
  postcssConfigWaitMs: number;
  postcssConfigCacheHit: boolean;
  tailwindGraphContentMs: number;
  postcssProcessMs: number;
  postcssPluginMs: number;
  tailwindPluginMs: number;
  autoprefixerPluginMs: number;
  rtlcssPluginMs: number;
  otherPostcssPluginMs: number;
  dependencyCollectionMs: number;
  importDependencyDiscoveryMs: number;
  urlDependencyDiscoveryMs: number;
  pipelineHashMs: number;
  cssDemandProofMs: number;
  postcssPluginTimings: Record<string, number>;
};

interface RenderCssModuleOptions {
  css: string;
  filePath: string;
  tokens?: CssTokens;
  hmr?: boolean;
  inject?: boolean;
}

type LoadedPostcssConfig = {
  plugins: AcceptedPlugin[];
  options: ProcessOptions;
  configFile: string | null;
};

const cachedPostcssConfigByRoot = new Map<string, LoadedPostcssConfig>();
const pendingPostcssConfigByRoot = new Map<string, Promise<LoadedPostcssConfig>>();
const postcssConfigFailedRoots = new Set<string>();

async function getPostcssConfigProfiled(rootDir: string): Promise<{
  config: LoadedPostcssConfig;
  loadMs: number;
  waitMs: number;
  cacheHit: boolean;
}> {
  const key = path.resolve(rootDir);
  const cached = cachedPostcssConfigByRoot.get(key);
  if (cached) return { config: cached, loadMs: 0, waitMs: 0, cacheHit: true };
  const pending = pendingPostcssConfigByRoot.get(key);
  if (pending) {
    const started = cssProfileNow();
    return { config: await pending, loadMs: 0, waitMs: cssProfileNow() - started, cacheHit: false };
  }
  if (postcssConfigFailedRoots.has(key)) {
    const empty: LoadedPostcssConfig = { plugins: [], options: {}, configFile: null };
    cachedPostcssConfigByRoot.set(key, empty);
    return { config: empty, loadMs: 0, waitMs: 0, cacheHit: true };
  }
  const started = cssProfileNow();
  const load = (async (): Promise<LoadedPostcssConfig> => {
    try {
      const result = await postcssLoadConfig({}, rootDir);
      const configFile =
        typeof (result as any)?.file === "string" ? ((result as any).file as string) : null;
      const loaded: LoadedPostcssConfig = {
        plugins: Array.isArray(result.plugins) ? result.plugins : [],
        options: result.options ?? {},
        configFile,
      };
      cachedPostcssConfigByRoot.set(key, loaded);
      return loaded;
    } catch {
      postcssConfigFailedRoots.add(key);
      const empty: LoadedPostcssConfig = { plugins: [], options: {}, configFile: null };
      cachedPostcssConfigByRoot.set(key, empty);
      return empty;
    } finally {
      pendingPostcssConfigByRoot.delete(key);
    }
  })();
  pendingPostcssConfigByRoot.set(key, load);
  return { config: await load, loadMs: cssProfileNow() - started, waitMs: 0, cacheHit: false };
}

async function getPostcssConfig(rootDir: string) {
  return (await getPostcssConfigProfiled(rootDir)).config;
}

function stablePluginName(plugin: unknown): string {
  if (!plugin || typeof plugin !== "function") return "unknown";
  const anyPlugin = plugin as any;
  if (typeof anyPlugin.postcssPlugin === "string" && anyPlugin.postcssPlugin.length > 0) {
    return anyPlugin.postcssPlugin;
  }
  if (typeof anyPlugin.name === "string" && anyPlugin.name.length > 0) return anyPlugin.name;
  if (typeof (plugin as any).toString === "function") {
    return "anonymous";
  }
  return "unknown";
}

function cssProfileNow(): number {
  return performance.now();
}

function addCssTiming(timings: Map<string, number>, label: string, ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) return;
  timings.set(label, (timings.get(label) ?? 0) + ms);
}

function labelPostcssPlugin(plugin: AcceptedPlugin, index: number): string {
  const anyPlugin = plugin as any;
  const direct =
    typeof anyPlugin?.postcssPlugin === "string" && anyPlugin.postcssPlugin.length > 0
      ? anyPlugin.postcssPlugin
      : typeof anyPlugin?.name === "string" && anyPlugin.name.length > 0
        ? anyPlugin.name
        : "";
  return direct || `postcss-plugin-${index}`;
}

function timeMaybePromise<T>(timings: Map<string, number>, label: string, started: number, value: T): T {
  if (value && typeof (value as any).then === "function") {
    return (value as any).finally(() => addCssTiming(timings, label, cssProfileNow() - started)) as T;
  }
  addCssTiming(timings, label, cssProfileNow() - started);
  return value;
}

function wrapPostcssVisitorObject<T>(visitor: T, label: string, timings: Map<string, number>): T {
  if (!visitor || typeof visitor !== "object") return visitor;
  const source = visitor as Record<string, any>;
  const out: Record<string, any> = Array.isArray(source) ? [...(source as any[])] : { ...source };
  for (const key of Object.keys(out)) {
    if (key === "postcssPlugin") continue;
    const value = out[key];
    if (typeof value === "function") {
      out[key] = function timedPostcssVisitor(this: unknown, ...args: unknown[]) {
        const started = cssProfileNow();
        const result = value.apply(this, args);
        if (key === "prepare" && result && typeof result === "object" && typeof (result as any).then !== "function") {
          addCssTiming(timings, label, cssProfileNow() - started);
          return wrapPostcssVisitorObject(result, label, timings);
        }
        if (key === "prepare" && result && typeof (result as any).then === "function") {
          return (result as Promise<unknown>).then((prepared) => {
            addCssTiming(timings, label, cssProfileNow() - started);
            return wrapPostcssVisitorObject(prepared, label, timings);
          });
        }
        return timeMaybePromise(timings, label, started, result);
      };
      continue;
    }
    if (value && typeof value === "object") {
      out[key] = wrapPostcssVisitorObject(value, label, timings);
    }
  }
  return out as T;
}

function wrapPostcssPluginsForTiming(
  plugins: AcceptedPlugin[],
  timings: Map<string, number>,
): AcceptedPlugin[] {
  return plugins.map((plugin, index) => {
    const label = labelPostcssPlugin(plugin, index);
    if (typeof plugin === "function") {
      const original = plugin as any;
      const wrapped = function timedPostcssPlugin(this: unknown, ...args: unknown[]) {
        const started = cssProfileNow();
        const result = original.apply(this, args);
        if (result && typeof result === "object" && typeof result.then !== "function") {
          addCssTiming(timings, label, cssProfileNow() - started);
          return wrapPostcssVisitorObject(result, label, timings);
        }
        if (result && typeof result.then === "function") {
          return result.then((prepared: unknown) => {
            addCssTiming(timings, label, cssProfileNow() - started);
            return wrapPostcssVisitorObject(prepared, label, timings);
          });
        }
        return timeMaybePromise(timings, label, started, result);
      };
      Object.assign(wrapped, original);
      return wrapped as AcceptedPlugin;
    }
    return wrapPostcssVisitorObject(plugin, label, timings) as AcceptedPlugin;
  });
}

function classifyPostcssPluginTimings(timings: Record<string, number>): Pick<
  CompileCssProfile,
  "tailwindPluginMs" | "autoprefixerPluginMs" | "rtlcssPluginMs" | "otherPostcssPluginMs"
> {
  let tailwindPluginMs = 0;
  let autoprefixerPluginMs = 0;
  let rtlcssPluginMs = 0;
  let otherPostcssPluginMs = 0;
  const entries = Object.entries(timings).sort(([a], [b]) => a.localeCompare(b));
  for (const [label, ms] of entries) {
    const normalized = label.toLowerCase();
    if (normalized.includes("tailwind")) {
      tailwindPluginMs += ms;
    } else if (normalized.includes("autoprefixer") || normalized === "plugin") {
      autoprefixerPluginMs += ms;
    } else if (normalized.includes("rtlcss")) {
      rtlcssPluginMs += ms;
    } else {
      otherPostcssPluginMs += ms;
    }
  }
  return { tailwindPluginMs, autoprefixerPluginMs, rtlcssPluginMs, otherPostcssPluginMs };
}

function emptyTailwindGraphContentProfile(fallbackReason: string | null): CssTailwindGraphContentProfile {
  return {
    attempted: false,
    enabled: false,
    ms: 0,
    files: 0,
    plugins: 0,
    configPath: null,
    fallbackReason,
  };
}

function findTailwindConfigPath(rootDir: string): string | null {
  const candidates = [
    "tailwind.config.js",
    "tailwind.config.cjs",
    "tailwind.config.mjs",
    "tailwind.config.ts",
    "tailwind.config.cts",
    "tailwind.config.mts",
  ];
  for (const candidate of candidates) {
    const abs = path.join(rootDir, candidate);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

function isTailwindPluginFactory(plugin: AcceptedPlugin): boolean {
  if (typeof plugin !== "function") return false;
  const fn = plugin as unknown as { name?: string; postcss?: boolean; toString?: () => string };
  if (fn.name === "tailwindcss" && fn.postcss === true) return true;
  const source = typeof fn.toString === "function" ? fn.toString() : "";
  return fn.postcss === true && source.includes('postcssPlugin: "tailwindcss"');
}

function cssMayUseTailwindSyntax(css: string): boolean {
  return /@(?:tailwind|apply|config|import|layer|screen|variants|responsive|theme|utility|variant|custom-variant)\b|\b(?:theme|screen)\s*\(/.test(css);
}

function cssNeedsTailwindContentScan(css: string): boolean {
  return /@tailwind\s+utilities\b|@(?:source|plugin)\b/.test(css);
}

function graphTailwindContent(originalContent: unknown, files: string[]): unknown {
  if (originalContent && typeof originalContent === "object" && !Array.isArray(originalContent)) {
    return {
      ...(originalContent as Record<string, unknown>),
      files,
    };
  }
  return { files };
}

function stripPresetContent(preset: unknown): unknown {
  if (!preset || typeof preset !== "object" || Array.isArray(preset)) return preset;
  const input = preset as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    if (key === "content") continue;
    output[key] = key === "presets" && Array.isArray(input[key])
      ? (input[key] as unknown[]).map(stripPresetContent)
      : input[key];
  }
  return output;
}

function cloneTailwindConfigForGraphContent(config: unknown, files: string[]): Record<string, unknown> {
  const source = config && typeof config === "object" && !Array.isArray(config)
    ? (config as Record<string, unknown>)
    : {};
  return {
    ...source,
    content: graphTailwindContent(source.content, files),
    presets: Array.isArray(source.presets) ? source.presets.map(stripPresetContent) : source.presets,
  };
}

function createTailwindGraphContentPipeline(
  rootDir: string,
  css: string,
  plugins: AcceptedPlugin[],
  contentAuthority: TailwindContentAuthority,
): { plugins: AcceptedPlugin[]; profile: CssTailwindGraphContentProfile } {
  const started = Date.now();
  const tailwindIndexes = plugins
    .map((plugin, index) => (isTailwindPluginFactory(plugin) ? index : -1))
    .filter((index) => index >= 0);
  if (tailwindIndexes.length === 0) return { plugins, profile: emptyTailwindGraphContentProfile("no-tailwind-plugin") };

  if (!cssMayUseTailwindSyntax(css)) {
    const tailwindIndexSet = new Set(tailwindIndexes);
    return {
      plugins: plugins.filter((_plugin, index) => !tailwindIndexSet.has(index)),
      profile: {
        ...emptyTailwindGraphContentProfile("no-tailwind-syntax"),
        attempted: true,
        ms: Date.now() - started,
        plugins: tailwindIndexes.length,
      },
    };
  }

  // R1 — Completeness law (authority A8). Narrow the Tailwind content set ONLY
  // when the caller proved completeness (`graph` mode with the reachability-
  // complete plan files). Otherwise fail closed to Tailwind's config globs (the
  // original plugins, unchanged): dev cannot prove its live graph is complete
  // for the first document, so it must NOT narrow (Finding #1).
  if (contentAuthority.mode === "config-globs") {
    return { plugins, profile: emptyTailwindGraphContentProfile("content-authority-config-globs") };
  }
  const graphFiles = contentAuthority.files;
  if (graphFiles.length === 0) return { plugins, profile: emptyTailwindGraphContentProfile("no-graph-source-files") };

  const configPath = findTailwindConfigPath(rootDir);
  if (!configPath) return { plugins, profile: emptyTailwindGraphContentProfile("no-tailwind-config") };

  try {
    const req = createRequire(path.join(rootDir, "package.json"));
    const tailwindFactory = req("tailwindcss") as (configOrPath?: unknown) => AcceptedPlugin;
    const tailwindEntry = req.resolve("tailwindcss");
    const loadConfigPath =
      [
        path.join(path.dirname(tailwindEntry), "lib", "load-config.js"),
        path.join(path.dirname(tailwindEntry), "lib", "lib", "load-config.js"),
      ].find((candidate) => fs.existsSync(candidate)) ?? path.join(path.dirname(tailwindEntry), "lib", "load-config.js");
    const loadConfigModule = req(loadConfigPath) as { loadConfig?: (filePath: string) => unknown };
    if (typeof tailwindFactory !== "function" || typeof loadConfigModule.loadConfig !== "function") {
      return {
        plugins,
        profile: {
          ...emptyTailwindGraphContentProfile("tailwind-loader-unavailable"),
          attempted: true,
          ms: Date.now() - started,
          files: graphFiles.length,
          configPath,
        },
      };
    }

    const userConfig = loadConfigModule.loadConfig(configPath);
    const contentFiles = cssNeedsTailwindContentScan(css) ? graphFiles : [];
    const graphConfig = cloneTailwindConfigForGraphContent(userConfig, contentFiles);
    let replaced = 0;
    const nextPlugins = plugins.map((plugin, index) => {
      if (!tailwindIndexes.includes(index)) return plugin;
      replaced += 1;
      return tailwindFactory(graphConfig);
    });
    return {
      plugins: nextPlugins,
      profile: {
        attempted: true,
        enabled: replaced > 0,
        ms: Date.now() - started,
        files: contentFiles.length,
        plugins: replaced,
        configPath,
        fallbackReason: replaced > 0 ? null : "tailwind-plugin-not-replaced",
      },
    };
  } catch (err) {
    return {
      plugins,
      profile: {
        ...emptyTailwindGraphContentProfile(`tailwind-graph-content-error:${String(err).split("\n")[0]}`),
        attempted: true,
        ms: Date.now() - started,
        files: graphFiles.length,
        configPath,
      },
    };
  }
}

function sortObjectKeys<T extends Record<string, any>>(value: T): T {
  const out: Record<string, any> = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = value[key];
  }
  return out as T;
}

export function resolveCssSpecifier(spec: string, filePath: string, rootDir: string): string | null {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  if (/^(data:|https?:|\/\/)/i.test(trimmed)) return null;
  if (trimmed.startsWith("/")) return path.resolve(rootDir, "." + trimmed);
  if (trimmed.startsWith("@/")) return path.resolve(rootDir, "src", trimmed.slice(2));
  if (trimmed.startsWith(".") || trimmed.startsWith("..")) return path.resolve(path.dirname(filePath), trimmed);

  const specifier = trimmed.startsWith("~") ? trimmed.slice(1) : trimmed;
  try {
    return createRequire(filePath).resolve(specifier);
  } catch {
    return path.resolve(path.dirname(filePath), trimmed);
  }
}

function discoverUrlDeps(css: string, filePath: string, rootDir: string): string[] {
  const deps: string[] = [];
  const seen = new Set<string>();
  const add = (p: string | null) => {
    if (!p) return;
    const norm = p.replace(/\\+/g, "/");
    if (seen.has(norm)) return;
    seen.add(norm);
    deps.push(p);
  };

  // Note: This is a conservative parser; it ignores CSS escapes and nested functions.
  // It is sufficient as a dependency signal for watcher/invalidation.
  const urlRe = /url\(\s*(?:'([^']+)'|"([^"]+)"|([^'"\s)]+))\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = urlRe.exec(css))) {
    const spec = (match[1] || match[2] || match[3] || "").trim();
    add(resolveCssSpecifier(spec, filePath, rootDir));
  }
  return deps;
}

const POSTCSS_DIR_DEPENDENCY_MAX_FILES = 5000;

function normalizeDependencyPath(depPath: string, rootDir: string, fromFile: string): string | null {
  const value = String(depPath || "").trim();
  if (!value) return null;
  if (/^(?:data:|https?:|\/\/)/i.test(value)) return null;
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(path.dirname(fromFile) || rootDir, value);
}

function globToRegExp(glob: string): RegExp {
  const normalized = glob.replace(/\\+/g, "/").replace(/^\.\//, "");
  let out = "^";
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]!;
    if (ch === "*") {
      if (normalized[i + 1] === "*") {
        if (normalized[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    if (ch === "{") {
      const end = normalized.indexOf("}", i + 1);
      if (end !== -1) {
        const body = normalized.slice(i + 1, end);
        const parts = body
          .split(",")
          .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"));
        out += `(?:${parts.join("|")})`;
        i = end;
        continue;
      }
    }
    out += ch.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  out += "$";
  return new RegExp(out);
}

function expandDirectoryDependency(dir: string, glob: string | null): string[] {
  const deps: string[] = [];
  const root = path.resolve(dir);
  if (!fs.existsSync(root)) return deps;
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) return stat.isFile() ? [root] : deps;

  const re = globToRegExp(glob && glob.trim() ? glob : "**/*");
  const visit = (current: string) => {
    if (deps.length >= POSTCSS_DIR_DEPENDENCY_MAX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (deps.length >= POSTCSS_DIR_DEPENDENCY_MAX_FILES) return;
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".ionify" || entry.name === "dist") {
        continue;
      }
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path.relative(root, abs).replace(/\\+/g, "/");
      if (re.test(rel)) deps.push(abs);
    }
  };
  visit(root);
  return deps;
}

function collectPostcssMessageDeps(
  messages: readonly unknown[],
  rootDir: string,
  filePath: string,
  tailwindGraphFiles: ReadonlySet<string> | null = null,
): string[] {
  const deps: string[] = [];
  const seen = new Set<string>();
  const add = (depPath: string | null, plugin: unknown) => {
    if (!depPath) return;
    const normalized = path.resolve(depPath).replace(/\\+/g, "/");
    if (plugin === "tailwindcss" && tailwindGraphFiles?.has(normalized)) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    deps.push(depPath);
  };

  for (const message of messages) {
    const msg = message as any;
    if (!msg || typeof msg !== "object") continue;
    if (
      (msg.type === "dependency" || msg.type === "build-dependency" || msg.type === "missing-dependency") &&
      typeof msg.file === "string"
    ) {
      add(normalizeDependencyPath(msg.file, rootDir, filePath), msg.plugin);
      continue;
    }
    if (msg.type === "dir-dependency" && typeof msg.dir === "string") {
      const baseDir = normalizeDependencyPath(msg.dir, rootDir, filePath);
      if (!baseDir) continue;
      for (const dep of expandDirectoryDependency(baseDir, typeof msg.glob === "string" ? msg.glob : null)) {
        add(dep, msg.plugin);
      }
      continue;
    }
    if (msg.type === "context-dependency") {
      const raw = typeof msg.dir === "string" ? msg.dir : typeof msg.file === "string" ? msg.file : null;
      const dep = raw ? normalizeDependencyPath(raw, rootDir, filePath) : null;
      if (!dep) continue;
      if (fs.existsSync(dep) && fs.statSync(dep).isDirectory()) {
        for (const child of expandDirectoryDependency(dep, typeof msg.glob === "string" ? msg.glob : null)) {
          add(child, msg.plugin);
        }
      } else {
        add(dep, msg.plugin);
      }
    }
  }

  return deps;
}

/**
 * Rewrite **local** `url(...)` references in compiled CSS via a caller-supplied mapper.
 *
 * This is the single, shared `url()`-rebasing primitive (CSS Option 2) used by both:
 *  - the dev server (serve-time → maps each asset to its dev-served public path), and
 *  - the production bundler (emit-time → maps each asset to a hashed `dist/assets/` file).
 *
 * The CAS `transformed.css` artifact stays phase-neutral; only the served/emitted body is
 * rewritten — so dev and build share resolution but produce phase-appropriate targets.
 *
 * Left untouched (returned verbatim): external (`data:`, `http(s):`, `//`), fragment-only
 * (`#clip`), and root-relative (`/foo.png`, already site-root-resolvable) specifiers.
 * Relative (`./`, `../`), alias (`@/`), `~pkg`, and bare-package specifiers are resolved
 * against `fromFsPath`/`rootDir` and handed to `mapTarget`; returning `null` (or the same
 * string) leaves the original `url()` as-is (an unresolved ref the dist-CSS gate surfaces).
 *
 * Callers MUST NOT feed `@import url(...)` statements through this function — it rewrites
 * every `url()` token. The bundler isolates `@import` first; the dev path runs this only
 * after `@import` has been rewritten to served URLs.
 */
export function rewriteCssUrls(
  css: string,
  fromFsPath: string,
  rootDir: string,
  mapTarget: (absPath: string, originalSpec: string) => string | null,
): string {
  const urlRe = /url\(\s*(?:'([^']*)'|"([^"]*)"|([^'")\s]+))\s*\)/gi;
  return css.replace(urlRe, (full, sQuote, dQuote, bare) => {
    const spec = (sQuote ?? dQuote ?? bare ?? "").trim();
    if (!spec) return full;
    // external / fragment-only / root-relative — never rebased
    if (/^(?:data:|https?:|\/\/|#|\/)/i.test(spec)) return full;
    const abs = resolveCssSpecifier(spec, fromFsPath, rootDir);
    if (!abs) return full;
    const replacement = mapTarget(abs, spec);
    if (!replacement || replacement === spec) return full;
    const quote = sQuote != null ? "'" : '"';
    return `url(${quote}${replacement}${quote})`;
  });
}

async function computePipelineHash(
  rootDir: string,
  modules: boolean,
  modulesOptions?: IonifyCSSConfig["modules"],
  preprocessor?: { lang: string; version: string; options?: Record<string, any> } | null,
): Promise<string> {
  const { plugins, options, configFile } = await getPostcssConfig(rootDir);
  const pluginNames = plugins.map(stablePluginName).filter(Boolean).sort();
  let configFileHash: string | null = null;
  let configFileId: string | null = null;
  if (configFile && fs.existsSync(configFile)) {
    try {
      const raw = fs.readFileSync(configFile);
      configFileHash = getCacheKey(raw);
      const abs = path.resolve(configFile);
      const rel = path.relative(rootDir, abs).replace(/\\+/g, "/");
      configFileId = rel && !rel.startsWith("../") ? rel : path.basename(abs);
    } catch {
      configFileHash = null;
    }
  }

  const normalizedModules =
    modules && modulesOptions
      ? {
          localsConvention:
            typeof modulesOptions.localsConvention === "string"
              ? modulesOptions.localsConvention
              : null,
          generateScopedName:
            typeof modulesOptions.generateScopedName === "string"
              ? modulesOptions.generateScopedName
              : typeof modulesOptions.generateScopedName === "function"
                ? "function"
                : null,
        }
      : null;

  // Note: postcss `options` can include non-serializable values; only hash a safe subset.
  const normalizedOptions = {
    map: (options as any)?.map ?? null,
  };

  const payload: Record<string, unknown> = {
    schema: "ionify:css-pipeline:v1",
    configFile: configFileId,
    configFileHash,
    pluginNames,
    options: normalizedOptions,
    modules: modules ? 1 : 0,
    modulesOptions: normalizedModules,
  };

  // Fold preprocessor identity (lib + version + options) ONLY for preprocessed files — plain `.css`
  // keeps its v1 hash unchanged (no mass CAS invalidation). css-pipeline-contract §8.
  if (preprocessor) {
    let optionsTag: string | null = null;
    try {
      optionsTag = preprocessor.options ? JSON.stringify(preprocessor.options) : null;
    } catch {
      optionsTag = "<unserializable>";
    }
    payload.preprocessor = { lang: preprocessor.lang, version: preprocessor.version, options: optionsTag };
  }

  return getCacheKey(JSON.stringify(payload));
}

function createScopedNameGenerator({
  rootDir,
  filePath,
  modulesOptions,
}: {
  rootDir: string;
  filePath: string;
  modulesOptions?: IonifyCSSConfig["modules"];
}) {
  const custom = modulesOptions?.generateScopedName;
  if (typeof custom === "function") {
    return (name: string, filename: string, css: string) => custom(name, filename, css);
  }
  if (typeof custom === "string" && custom.trim().length > 0) {
    const pattern = custom;
    return (name: string, filename: string) => {
      const baseName = path.basename(filename || filePath).replace(/\.[^.]+$/, "");
      const rel = path.relative(rootDir, filename || filePath).replace(/\\+/g, "/");
      const hashHex = crypto.createHash("sha256").update(`${rel}:${name}`).digest("hex");

      return pattern
        .replace(/\[name\]/g, baseName)
        .replace(/\[local\]/g, name)
        .replace(/\[hash(?::(hex|base64))?(?::(\d+))?\]/g, (_m, enc, lenRaw) => {
          const len = lenRaw ? Math.max(1, Math.min(32, Number(lenRaw))) : 6;
          if (enc === "base64") {
            const b64 = Buffer.from(hashHex, "hex").toString("base64url");
            return b64.slice(0, len);
          }
          return hashHex.slice(0, len);
        });
    };
  }

  return (name: string, filename: string) => {
    const relative = path
      .relative(rootDir, filename || filePath)
      .replace(/\\+/g, "/");
    const seed = crypto.createHash("sha1").update(relative).digest("hex").slice(0, 6);
    return `${name}___${seed}`;
  };
}

export async function compileCss({
  code,
  filePath,
  rootDir,
  modules = false,
  modulesOptions,
  preprocessorOptions,
  // R1: fail closed. Absent authority = completeness unproven → config globs.
  tailwindContentAuthority = { mode: "config-globs" },
}: CompileCssOptions): Promise<CompileCssResult> {
  const totalStart = cssProfileNow();
  let preprocessorMs = 0;
  let postcssConfigLoadMs = 0;
  let postcssConfigWaitMs = 0;
  let postcssConfigCacheHit = false;
  let tailwindGraphContentMs = 0;
  let postcssProcessMs = 0;
  let dependencyCollectionMs = 0;
  let importDependencyDiscoveryMs = 0;
  let urlDependencyDiscoveryMs = 0;
  let pipelineHashMs = 0;
  let cssDemandProofMs = 0;
  const pluginTimingMap = new Map<string, number>();

  // Preprocessor pre-pass (Sass/SCSS/Less) → CSS, BEFORE PostCSS (css-pipeline-contract §8).
  // Unified across dev/build/worker; preprocessor import deps + lib identity are tracked below.
  const preprocessorLang = detectPreprocessorLang(filePath);
  let sourceCss = code;
  let preprocessorIdentity: { lang: string; version: string; options?: Record<string, any> } | null = null;
  const preprocessorDeps: string[] = [];
  if (preprocessorLang) {
    const started = cssProfileNow();
    const pre = await runPreprocessor(code, filePath, rootDir, preprocessorLang, preprocessorOptions);
    preprocessorMs += cssProfileNow() - started;
    sourceCss = pre.css;
    preprocessorDeps.push(...pre.deps);
    preprocessorIdentity = { lang: preprocessorLang, version: pre.version, options: preprocessorOptions };
  }

  const configProfile = await getPostcssConfigProfiled(rootDir);
  const { plugins, options, configFile } = configProfile.config;
  postcssConfigLoadMs += configProfile.loadMs;
  postcssConfigWaitMs += configProfile.waitMs;
  postcssConfigCacheHit = configProfile.cacheHit;
  const tailwindStart = cssProfileNow();
  const tailwindGraphContent = createTailwindGraphContentPipeline(
    rootDir,
    sourceCss,
    plugins,
    tailwindContentAuthority,
  );
  tailwindGraphContentMs += cssProfileNow() - tailwindStart;
  const pipeline = [...tailwindGraphContent.plugins];
  let tokens: CssTokens | undefined;

  if (modules) {
    const scopedName = createScopedNameGenerator({ rootDir, filePath, modulesOptions });
    pipeline.push(
      postcssModules({
        generateScopedName: scopedName,
        localsConvention: modulesOptions?.localsConvention,
        getJSON(_filename, json) {
          tokens = sortObjectKeys(json as CssTokens);
        },
      })
    );
  }

  const timedPipeline = wrapPostcssPluginsForTiming(pipeline, pluginTimingMap);
  const runner = postcss(timedPipeline);
  const processStart = cssProfileNow();
  const result = await runner.process(sourceCss, {
    ...options,
    from: filePath,
    map: false,
  });
  postcssProcessMs += cssProfileNow() - processStart;

  const depStart = cssProfileNow();
  const deps: CssDependency[] = [];
  const urlDeps: CssDependency[] = [];
  const seenDeps = new Set<string>();
  const seenUrlDeps = new Set<string>();
  const addDep = (depPath: string) => {
    const normalized = depPath.replace(/\\+/g, "/");
    if (seenDeps.has(normalized)) return;
    seenDeps.add(normalized);
    deps.push({ filePath: depPath, kind: "dependency" });
  };
  const addUrlDep = (depPath: string) => {
    const normalized = depPath.replace(/\\+/g, "/");
    if (seenUrlDeps.has(normalized)) return;
    seenUrlDeps.add(normalized);
    urlDeps.push({ filePath: depPath, kind: "dependency" });
  };

  if (configFile) addDep(configFile);

  // Preprocessor import deps (@use/@import of partials resolved by sass/less) → watch/invalidation.
  for (const dep of preprocessorDeps) addDep(dep);

  // PostCSS plugin dependency messages (postcss-import, Tailwind content globs, etc.).
  const tailwindGraphFiles =
    tailwindGraphContent.profile.enabled && tailwindContentAuthority.mode === "graph"
      ? new Set(tailwindContentAuthority.files.map((item) => path.resolve(item).replace(/\\+/g, "/")))
      : null;
  for (const dep of collectPostcssMessageDeps(result.messages || [], rootDir, filePath, tailwindGraphFiles)) {
    addDep(dep);
  }
  dependencyCollectionMs += cssProfileNow() - depStart;

  // Lightweight @import discovery on the POST-preprocessor CSS (covers plain CSS @imports the
  // preprocessor passed through; preprocessor-level @use/@import are already recorded above).
  // Note: This is best-effort; external URLs are ignored.
  const importStart = cssProfileNow();
  const importRe =
    /@import\s+(?:url\(\s*)?(?:'([^']+)'|"([^"]+)"|([^'"\s)]+))\s*\)?[^;]*;/gi;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(sourceCss))) {
    const spec = (match[1] || match[2] || match[3] || "").trim();
    if (!spec) continue;
    const resolved = resolveCssSpecifier(spec, filePath, rootDir);
    if (resolved) addDep(resolved);
  }
  importDependencyDiscoveryMs += cssProfileNow() - importStart;

  // url() dependency discovery (assets referenced from CSS)
  const urlStart = cssProfileNow();
  for (const dep of discoverUrlDeps(result.css, filePath, rootDir)) {
    addUrlDep(dep);
  }
  urlDependencyDiscoveryMs += cssProfileNow() - urlStart;

  const pipelineHashStart = cssProfileNow();
  const pipelineHash = await computePipelineHash(rootDir, modules, modulesOptions, preprocessorIdentity);
  pipelineHashMs += cssProfileNow() - pipelineHashStart;
  const depsForDemand = Array.from(new Set([...deps.map((dep) => dep.filePath), ...urlDeps.map((dep) => dep.filePath)]));
  const demandStart = cssProfileNow();
  const cssDemand = buildCssDemandAnalysis({
    rootDir,
    cssFile: filePath,
    cssHash: getCacheKey(code),
    pipelineHash,
    deps: depsForDemand,
  });
  cssDemandProofMs += cssProfileNow() - demandStart;

  const postcssPluginTimings = Object.fromEntries(
    Array.from(pluginTimingMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, ms]) => [label, Number(ms.toFixed(2))]),
  );
  const pluginClassifications = classifyPostcssPluginTimings(postcssPluginTimings);

  // Attach the CSSA graph-content stamp when narrowing shaped this output.
  tailwindGraphContent.profile.stamp =
    tailwindGraphContent.profile.enabled && tailwindGraphContent.profile.files > 0
      ? computeCssDemandGraphContentStamp(rootDir)?.stamp ?? null
      : null;

  const compiled: CompileCssResult = {
    css: result.css,
    tokens,
    deps,
    urlDeps,
    pipelineHash,
    cssDemand,
    tailwindGraphContent: tailwindGraphContent.profile,
    profile: {
      totalMs: cssProfileNow() - totalStart,
      preprocessorMs,
      postcssConfigLoadMs,
      postcssConfigWaitMs,
      postcssConfigCacheHit,
      tailwindGraphContentMs,
      postcssProcessMs,
      postcssPluginMs: Object.values(postcssPluginTimings).reduce((sum, ms) => sum + ms, 0),
      ...pluginClassifications,
      dependencyCollectionMs,
      importDependencyDiscoveryMs,
      urlDependencyDiscoveryMs,
      pipelineHashMs,
      cssDemandProofMs,
      postcssPluginTimings,
    },
  };

  return compiled;
}

export function renderCssModule({
  css,
  filePath,
  tokens,
  hmr = true,
  inject = true,
}: RenderCssModuleOptions): string {
  const cssJson = JSON.stringify(css);
  const styleId = `ionify-css-${getCacheKey(filePath).slice(0, 8)}`;
  const tokensJson = tokens ? JSON.stringify(tokens) : "null";

  return `
// ionify:css
const cssText = ${cssJson};
const styleId = ${JSON.stringify(styleId)};
${inject ? `let style = document.querySelector(\`style[data-ionify-id="\${styleId}"]\`);
if (!style) {
  style = document.createElement("style");
  style.setAttribute("data-ionify-id", styleId);
  document.head.appendChild(style);
}
style.textContent = cssText;` : ""}
${tokens ? `const tokens = ${tokensJson};` : ""}
export const css = cssText;
${tokens ? `export const classes = tokens;
export default tokens;` : `export default cssText;`}
${hmr ? `if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    const existing = document.querySelector(\`style[data-ionify-id="\${styleId}"]\`);
    if (existing) existing.remove();
  });
}` : ""}
`.trim();
}

export function renderCssTokensModule(tokens: CssTokens): string {
  const sorted = sortObjectKeys(tokens);
  const tokensJson = JSON.stringify(sorted);
  return `
// ionify:css
const tokens = ${tokensJson};
export const classes = tokens;
export default tokens;
`.trim();
}

export function renderCssRawStringModule(cssText: string): string {
  return `
// ionify:css
const css = ${JSON.stringify(cssText)};
export { css };
export default css;
`.trim();
}

export function renderCssUrlModule(url: string): string {
  return `
// ionify:css
const url = ${JSON.stringify(url)};
export { url };
export default url;
`.trim();
}
