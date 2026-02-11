/**
{
  "description": "Ionify Dev Server (Phase 1 Final). Integrates Graph, Cache, Resolver, Watcher, and Transform Engine. Performs incremental rebuilds and skips transforms on cache hits.",
  "phase": 1.5,
  "todo": [
    "Link watcher with graph invalidation.",
    "Perform incremental cache-aware transforms.",
    "Prepare live reload bridge (Phase 2)."
  ]
}
*/

/**
{
  "description": "Ionify Dev Server (Phase 2). Adds SSE-based HMR and CSS/asset loaders. Injects HMR client into HTML responses and broadcasts reload on changes.",
  "phase": 2,
  "todo": [
    "Serve /__ionify_hmr (SSE) and /__ionify_hmr_client.js",
    "Implement CSS '?inline' loader and asset '?import' loader",
    "Broadcast reload events on watcher changes"
  ]
}
*/

import type { IncomingMessage, ServerResponse } from "http";
import http from "http";
import url from "url";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { logInfo, logError, logWarn } from "@cli/utils/logger";
import { getCacheKey } from "@core/cache";
import { Graph } from "@core/graph";
import { extractImports, resolveImports } from "@core/resolver";
import { ModuleResolver } from "@core/resolver/module-resolver";
import { IonifyWatcher } from "@core/watcher";
import { TransformEngine, transformCache } from "@core/transform";
import { HMRServer, injectHMRClient, PendingHMRModule } from "@core/hmr";
import { compileCss, renderCssModule, renderCssRawStringModule, renderCssUrlModule } from "@core/loaders/css";
import { isAssetExt, contentTypeForAsset, assetAsModule, normalizeUrlFromFs } from "@core/loaders/asset";
import { applyRegisteredLoaders } from "@core/loaders/registry";
import { loadIonifyConfig } from "@cli/utils/config";
import { resolveMinifier } from "@cli/utils/minifier";
import { loadEnv as loadIonifyEnv } from "@cli/utils/env";
import { resolveTreeshake } from "@cli/utils/treeshake";
import { resolveScopeHoist } from "@cli/utils/scope-hoist";
import { resolveParser, applyParserEnv } from "@cli/utils/parser";
import { decodePublicPath } from "@core/utils/public-path";
import { getCasArtifactPath } from "@core/utils/cas";
import { native, computeGraphVersion } from "@native/index";
import { getDepEntry, registerDepEntry, computeSubpathFromEntryPath } from "@core/deps/registry";
import { applyDefineReplacements, buildDefineConfig } from "@core/utils/define";
import crypto from "crypto";
import zlib from "zlib";

const IONIFY_CSS_JS_MARKER = "// ionify:css";
const IONIFY_VENDOR_PACK_MARKER = "// ionify:vendor-pack";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// When running from dist/cli/index.js, __dirname is dist/cli
// We need to go up to dist, then into client: dist/cli -> dist -> dist/client
const CLIENT_DIR = path.resolve(__dirname, "../client");
const CLIENT_FALLBACK_DIR = path.resolve(process.cwd(), "src/client");
const DEPS_PREFIX = "/@deps/";

function readClientAssetFile(fileName: string): { filePath: string; code: string } {
  const primary = path.join(CLIENT_DIR, fileName);
  if (fs.existsSync(primary)) {
    return { filePath: primary, code: fs.readFileSync(primary, "utf8") };
  }
  const fallback = path.join(CLIENT_FALLBACK_DIR, fileName);
  if (fs.existsSync(fallback)) {
    return { filePath: fallback, code: fs.readFileSync(fallback, "utf8") };
  }
  throw new Error(`Missing Ionify client asset: ${fileName}`);
}

function readClientAsset(fileName: string): string {
  return readClientAssetFile(fileName).code;
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if ([".mjs", ".js", ".ts", ".tsx", ".jsx", ".cjs", ".mts", ".cts"].includes(ext))
    return "application/javascript; charset=utf-8";
  // For binary files and other assets
  if ([".wasm"].includes(ext))
    return "application/wasm";
  if ([".map"].includes(ext))
    return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function mergeVaryHeader(existing: number | string | string[] | undefined, next: string): string {
  const parts = new Set<string>();
  const add = (value: string) => {
    value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .forEach((v) => parts.add(v));
  };
  if (typeof existing === "string") add(existing);
  else if (Array.isArray(existing)) existing.forEach(add);
  add(next);
  return Array.from(parts).join(", ");
}

function normalizeEtag(tag: string): string {
  return tag.trim().replace(/^W\//, "");
}

function isNotModified(req: IncomingMessage, etag: string): boolean {
  const header = req.headers["if-none-match"];
  const value = Array.isArray(header) ? header.join(",") : header;
  if (!value) return false;
  if (value.trim() === "*") return true;
  const expected = normalizeEtag(etag);
  return value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .some((t) => normalizeEtag(t) === expected);
}

function weakEtagFromStat(prefix: string, stat: fs.Stats): string {
  const mtime = Math.floor(stat.mtimeMs);
  return `W/"${prefix}-${stat.size}-${mtime}"`;
}

function shouldCompressContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return (
    ct.startsWith("text/") ||
    ct.includes("javascript") ||
    ct.includes("json") ||
    ct.includes("xml") ||
    ct.includes("svg")
  );
}

function selectCompressionEncoding(req: IncomingMessage): "gzip" | null {
  const header = req.headers["accept-encoding"];
  const value = Array.isArray(header) ? header.join(",") : header;
  if (!value) return null;
  const enc = value.toLowerCase();
  // Dev: use gzip only (fast) instead of brotli (high latency)
  if (enc.includes("gzip")) return "gzip";
  return null;
}

function looksLikeIonifyCssJsModule(body: Buffer): boolean {
  const head = body.subarray(0, 96).toString("utf8");
  return head.trimStart().startsWith(IONIFY_CSS_JS_MARKER);
}

function computeDepsStampHash(depsAbs: string[]): string {
  if (!depsAbs.length) return "0";
  const entries: string[] = [];
  for (const dep of depsAbs) {
    const abs = path.resolve(dep);
    try {
      const stat = fs.statSync(abs);
      entries.push(`${abs}:${stat.size}:${Math.floor(stat.mtimeMs)}`);
    } catch {
      entries.push(`${abs}:missing`);
    }
  }
  entries.sort();
  return getCacheKey(entries.join("|"));
}

function sendBuffer(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  contentType: string,
  body: Buffer,
  opts?: { etag?: string; cacheControl?: string },
): void {
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", opts?.cacheControl ?? "no-cache");

  const etag = opts?.etag;
  if (etag) {
    res.setHeader("ETag", etag);
    if (isNotModified(req, etag)) {
      res.statusCode = 304;
      res.end();
      return;
    }
  }

  // Compression: fast gzip in dev (level 1 for low latency)
  const encoding =
    body.length >= 1024 && shouldCompressContentType(contentType)
      ? selectCompressionEncoding(req)
      : null;

  if (encoding === "gzip") {
    res.setHeader("Vary", mergeVaryHeader(res.getHeader("Vary"), "Accept-Encoding"));
    res.setHeader("Content-Encoding", "gzip");
    res.statusCode = status;
    res.end(zlib.gzipSync(body, { level: 1 }));
    return;
  }

  res.statusCode = status;
  res.end(body);
}

type LockfileInfo = {
  name: string;
  path: string;
  contents: Buffer;
  packageCount: number | null;
};

const LOCKFILE_ORDER = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
];

function readLockfile(rootDir: string): LockfileInfo | null {
  for (const name of LOCKFILE_ORDER) {
    const filePath = path.join(rootDir, name);
    if (!fs.existsSync(filePath)) continue;
    const contents = fs.readFileSync(filePath);
    const packageCount = estimateLockfilePackageCount(name, contents);
    return { name, path: filePath, contents, packageCount };
  }
  return null;
}

function estimateLockfilePackageCount(name: string, contents: Buffer): number | null {
  if (name === "package-lock.json") {
    try {
      const parsed = JSON.parse(contents.toString("utf8"));
      if (parsed?.packages && typeof parsed.packages === "object") {
        return Object.keys(parsed.packages).length;
      }
    } catch {
      return null;
    }
  }

  if (name === "pnpm-lock.yaml") {
    const text = contents.toString("utf8");
    return text.split("\n").filter((line) => line.trimStart().startsWith("/")).length;
  }

  if (name === "yarn.lock") {
    const text = contents.toString("utf8");
    return text.split("\n").filter((line) => line && !line.startsWith(" ") && line.endsWith(":")).length;
  }

  return null;
}

function computeDepsHash(
  configHash: string,
  lockfile: LockfileInfo | null,
  opts: { nodeEnv: string; sourcemap: boolean; bundleEsm: boolean },
): string {
  const hash = crypto.createHash("sha256");
  hash.update(configHash);
  if (lockfile) {
    hash.update(lockfile.contents);
  }
  hash.update(`NODE_ENV=${opts.nodeEnv}`);
  hash.update(`optimizeDeps.sourcemap=${opts.sourcemap ? "1" : "0"}`);
  hash.update(`optimizeDeps.bundleEsm=${opts.bundleEsm ? "1" : "0"}`);
  return hash.digest("hex").slice(0, 16);
}

function readProjectPackageJson(rootDir: string): any | null {
  const pkgPath = path.join(rootDir, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch {
    return null;
  }
}

function detectVendorSpecifiers(pkgJson: any | null): string[] {
  if (!pkgJson || typeof pkgJson !== "object") return [];
  const deps = {
    ...(pkgJson.dependencies || {}),
    ...(pkgJson.devDependencies || {}),
    ...(pkgJson.peerDependencies || {}),
  };
  const has = (name: string) => Object.prototype.hasOwnProperty.call(deps, name);

  // Framework hot-path sets (dev). Keep these small and high-value.
  if (has("react") || has("react-dom")) {
    return [
      "react",
      "react-dom",
      "react-dom/client",
      "scheduler",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-refresh",
    ];
  }
  if (has("vue")) {
    return ["vue", "@vue/runtime-dom", "@vue/runtime-core"];
  }
  if (has("svelte")) {
    return ["svelte", "svelte/internal"];
  }

  return [];
}

function computeSubpathForDep(fsPath: string, pkg?: any): string | null {
  const computed = computeSubpathFromEntryPath(fsPath);
  if (computed) return computed;
  // If the file exists on disk and the physical subpath is empty, treat it as the main entry.
  // Fall back to resolver-provided logical subpath only when the physical path cannot be inspected
  // (primarily in tests/mocked environments).
  if (fs.existsSync(fsPath)) return null;
  const raw = pkg?.subpath;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/^\.\//, "").replace(/^\/+/, "");
    if (cleaned && cleaned !== "." && cleaned !== "index") {
      return cleaned;
    }
  }
  return null;
}

type VendorDep = {
  specifier: string;
  entryPath: string;
  fileName: string;
  packageLabel: string;
};

function resolveVendorDeps(rootDir: string, specifiers: string[]): VendorDep[] {
  if (!native?.resolveModule) return [];
  const seen = new Set<string>();
  const resolved: VendorDep[] = [];

  for (const spec of specifiers) {
    try {
      const r = native.resolveModule(spec, rootDir);
      const fsPath = (r as any)?.fsPath ?? (r as any)?.fs_path ?? null;
      if (!fsPath || typeof fsPath !== "string") continue;
      const pkg = (r as any)?.pkg ?? null;
      const packageName = typeof pkg?.name === "string" ? pkg.name : spec;
      const packageVersion = typeof pkg?.version === "string" ? pkg.version : "0.0.0";
      const subpath = computeSubpathForDep(fsPath, pkg);
      const entry = registerDepEntry({
        entryPath: fsPath,
        packageName,
        packageVersion,
        subpath,
      });
      if (seen.has(entry.fileName)) continue;
      seen.add(entry.fileName);
      resolved.push({
        specifier: spec,
        entryPath: fsPath,
        fileName: entry.fileName,
        packageLabel: formatDepLabel(packageName, subpath),
      });
    } catch {
      // Ignore resolution errors; vendor mode should degrade gracefully.
    }
  }

  return resolved;
}

function injectModulePreload(html: string, href: string): string {
  const tag = `<link rel="modulepreload" href="${href}">`;
  if (html.includes(tag)) return html;

  const headCloseMatch = html.match(/<\/head>/i);
  if (headCloseMatch?.index !== undefined) {
    const idx = headCloseMatch.index;
    return `${html.slice(0, idx)}${tag}\n${html.slice(idx)}`;
  }

  const headOpenMatch = html.match(/<head[^>]*>/i);
  if (headOpenMatch?.index !== undefined) {
    const idx = headOpenMatch.index + headOpenMatch[0].length;
    return `${html.slice(0, idx)}\n${tag}${html.slice(idx)}`;
  }

  return `${tag}\n${html}`;
}

function pruneDepsCache(rootDir: string, depsHash: string) {
  const depsRoot = path.join(rootDir, ".ionify", "deps");
  if (!fs.existsSync(depsRoot)) return;
  const entries = fs
    .readdirSync(depsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(depsRoot, entry.name);
      const stat = fs.statSync(fullPath);
      return { name: entry.name, path: fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const keep = new Set<string>();
  keep.add(depsHash);
  for (const entry of entries.slice(0, 2)) {
    keep.add(entry.name);
  }

  for (const entry of entries) {
    if (!keep.has(entry.name)) {
      fs.rmSync(entry.path, { recursive: true, force: true });
    }
  }
}

function loadDepsManifestIndex(depsRoot: string): Map<string, { entryPath: string; packageLabel: string; hasSourcemap: boolean }> {
  const manifestPath = path.join(depsRoot, "manifest.json");
  if (!fs.existsSync(manifestPath)) return new Map();
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    const entries: Record<string, any> = parsed?.entries ?? {};
    const map = new Map<string, { entryPath: string; packageLabel: string; hasSourcemap: boolean }>();
    for (const [entryPath, entry] of Object.entries(entries)) {
      if (!entry?.outFile) continue;
      map.set(entry.outFile, {
        entryPath,
        packageLabel: entry.package || "unknown",
        hasSourcemap: entry.hasSourcemap === true,
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

function formatDepLabel(name: string, subpath?: string | null) {
  if (!subpath) return name;
  const cleaned = subpath.replace(/^\.\//, "").replace(/^\/+/, "");
  if (!cleaned || cleaned === ".") return name;
  return `${name}/${cleaned}`;
}

type HMRModuleResponse =
  | {
      url: string;
      hash: string | null;
      deps: string[];
      reason: PendingHMRModule["reason"];
      status: "deleted";
    }
  | {
      url: string;
      hash: string;
      deps: string[];
      reason: PendingHMRModule["reason"];
      status: "updated";
      code: string;
    };

export interface StartDevServerOptions {
  port?: number;
  host?: string;
  enableSignalHandlers?: boolean;
}

export interface DevServerHandle {
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}

export async function startDevServer({
  port = 5173,
  host = process.env.IONIFY_HOST || "127.0.0.1",
  enableSignalHandlers = true,
}: StartDevServerOptions = {}): Promise<DevServerHandle> {
  const bootStartMs = Date.now();
  // Phase 5.4.2: Load config first to get root option
  const userConfig = await loadIonifyConfig();
  const rootDir = userConfig?.root || process.cwd();
  
  const watcher = new IonifyWatcher(rootDir);
  const cacheDebug = process.env.IONIFY_DEV_TRANSFORM_CACHE_DEBUG === "1";
  
  // Honor project/ENV minifier selection consistently in dev.
  // Keep the resolved value in config hashing, but avoid mutating process-wide
  // env vars (important for test isolation and multi-server scenarios).
  const minifier = resolveMinifier(userConfig, { envVar: process.env.IONIFY_MINIFIER });
  const parserMode = resolveParser(userConfig, { envMode: process.env.IONIFY_PARSER });
  applyParserEnv(parserMode);
  const treeshake = resolveTreeshake(userConfig?.treeshake, {
    envMode: process.env.IONIFY_TREESHAKE,
    includeEnv: process.env.IONIFY_TREESHAKE_INCLUDE,
    excludeEnv: process.env.IONIFY_TREESHAKE_EXCLUDE,
  });
  // Do not apply treeshake env vars here; resolved value is used in config hashing.
  const scopeHoist = resolveScopeHoist(userConfig?.scopeHoist, {
    envMode: process.env.IONIFY_SCOPE_HOIST,
    inlineEnv: process.env.IONIFY_SCOPE_HOIST_INLINE,
    constantEnv: process.env.IONIFY_SCOPE_HOIST_CONST,
    combineEnv: process.env.IONIFY_SCOPE_HOIST_COMBINE,
  });
  // Do not apply scope-hoist env vars here; resolved value is used in config hashing.

  // Resolve entry(ies) to absolute path BEFORE canonicalization
  // Handle paths starting with '/' using path.join, not path.resolve
  const resolvedEntries = userConfig?.entry
    ? (Array.isArray(userConfig.entry) ? userConfig.entry : [userConfig.entry]).map(
        (entry) => (entry.startsWith("/") ? path.join(rootDir, entry) : path.resolve(rootDir, entry)),
      )
    : undefined;

  // Create graph with version inputs for automatic cache invalidation
  // computeGraphVersion handles canonicalization internally to ensure consistency
  const pluginNames = Array.isArray(userConfig?.plugins)
    ? userConfig.plugins
        .map((p: any) => (typeof p === "string" ? p : p?.name))
        .filter((name): name is string => typeof name === "string" && name.length > 0)
    : undefined;
  const rawVersionInputs: Parameters<typeof computeGraphVersion>[0] = {
    parserMode,
    minifier,
    treeshake,
    scopeHoist,
    plugins: pluginNames,
    entry: resolvedEntries ?? null,
    cssOptions: (userConfig as any)?.css,
    assetOptions: (userConfig as any)?.assets ?? (userConfig as any)?.asset,
  };
  const configHash = computeGraphVersion(rawVersionInputs);
  logInfo(`[Dev] Version hash: ${configHash}`);
  process.env.IONIFY_CONFIG_HASH = configHash;
  const casRoot = path.join(rootDir, ".ionify", "cas");

  const lockfile = readLockfile(rootDir);
  if (lockfile) {
    const countLabel = lockfile.packageCount === null ? "unknown" : lockfile.packageCount;
    logInfo(`[deps] SCAN lockfile: ${lockfile.name} (${countLabel} packages)`);
  }

  // Deps hashing must include options that affect optimized output to keep artifacts version-isolated.
  const depsSourcemapEnabled = userConfig?.optimizeDeps?.sourcemap === true;
  const depsBundleEsmEnabled = userConfig?.optimizeDeps?.bundleEsm !== false; // default true
  const depsNodeEnv = process.env.NODE_ENV ?? "development";

  const depsHash = computeDepsHash(configHash, lockfile, {
    nodeEnv: depsNodeEnv,
    sourcemap: depsSourcemapEnabled,
    bundleEsm: depsBundleEsmEnabled,
  });
  logInfo(`[deps] depsHash: ${depsHash} from ${lockfile?.name ?? "config"}`);
  const depsRoot = path.join(rootDir, ".ionify", "deps", depsHash);
  fs.mkdirSync(depsRoot, { recursive: true });
  pruneDepsCache(rootDir, depsHash);
  const depsManifestIndex = loadDepsManifestIndex(depsRoot);
  
  // Phase 5.9.2: Vendor pack (dev) — preload hot framework deps early to reduce cold-start waterfalls.
  const optimizeVendorMode = (userConfig as any)?.optimizeDeps?.vendor ?? "auto";
  const optimizeExclude = Array.isArray(userConfig?.optimizeDeps?.exclude)
    ? new Set(userConfig!.optimizeDeps!.exclude)
    : null;
  const autoVendor = optimizeVendorMode === "auto";
  const vendorSpecifiersRaw =
    optimizeVendorMode === false
      ? []
      : Array.isArray(optimizeVendorMode)
        ? optimizeVendorMode
        : autoVendor
          ? detectVendorSpecifiers(readProjectPackageJson(rootDir))
          : [];
  const vendorSpecifiers = vendorSpecifiersRaw
    .map((s) => String(s).trim())
    .filter(Boolean)
    .filter((s) => !optimizeExclude?.has(s));
  const vendorDeps = resolveVendorDeps(rootDir, vendorSpecifiers);
  const vendorPackFileName = vendorDeps.length > 0 ? `vendor.${depsHash}.js` : null;
  const vendorPackUrl = vendorPackFileName ? `${DEPS_PREFIX}${vendorPackFileName}` : null;

  const ensureVendorPackFile = (): void => {
    if (!vendorPackFileName || !vendorPackUrl || vendorDeps.length === 0) return;
    const vendorKey = getCacheKey(
      `vendor:v1:${vendorDeps
        .map((d) => `${d.specifier}:${d.fileName}`)
        .sort()
        .join("|")}`,
    );
    const filePath = path.join(depsRoot, vendorPackFileName);
    if (fs.existsSync(filePath)) {
      try {
        const head = fs.readFileSync(filePath, "utf8").slice(0, 256);
        if (head.includes(`${IONIFY_VENDOR_PACK_MARKER} ${vendorKey}`)) return;
      } catch {
        // fall through to rewrite
      }
    }
    const imports = vendorDeps
      .slice()
      .sort((a, b) => a.specifier.localeCompare(b.specifier))
      .map((d) => `import "${DEPS_PREFIX}${d.fileName}";`)
      .join("\n");
    const body =
      `${IONIFY_VENDOR_PACK_MARKER} ${vendorKey}\n` +
      `// depsHash: ${depsHash}\n` +
      `// vendor: ${vendorDeps.map((d) => d.specifier).join(", ")}\n` +
      `${imports}\n`;
    try {
      fs.writeFileSync(filePath, body, "utf8");
    } catch {
      // ignore write errors; vendor mode is best-effort
    }
  };
  
  // Initialize transformer with CAS after configHash is computed
  const transformer = new TransformEngine({ casRoot, versionHash: configHash });
  
  const graph = new Graph(rawVersionInputs);
  
  // Wave 5: Initialize AST cache with version hash
  if (native?.initAstCache) {
    const versionHash = JSON.stringify(rawVersionInputs);
    native.initAstCache(versionHash);
    logInfo(`AST cache initialized with version hash`);
    // Warm-up AST cache for recently modified files
    if (native?.astCacheWarmup) {
      try {
        native.astCacheWarmup();
      } catch (err) {
        logWarn(`AST cache warmup skipped: ${err}`);
      }
    }
    if (native?.astCacheStats) {
      try {
        const stats = native.astCacheStats();
        const entries = (stats as any).total_entries ?? (stats as any).totalEntries ?? 0;
        const sizeBytes = (stats as any).total_size_bytes ?? (stats as any).totalSizeBytes ?? 0;
        const hits = (stats as any).total_hits ?? (stats as any).totalHits ?? 0;
        const hitRate = (stats as any).hit_rate ?? (stats as any).hitRate ?? 0;
        logInfo(`[AST Cache] entries=${entries}, size=${sizeBytes} bytes, hits=${hits}, hitRate=${hitRate}`);
      } catch {
        // ignore stats errors
      }
    }
  }

  // Initialize module resolver with config
  const moduleResolver = new ModuleResolver(rootDir, {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.mjs'],
    conditions: ['import', 'default'],
    mainFields: ['module', 'main'],
    ...(userConfig?.resolve || {})
  });
  // Built-in + user loaders (from ionify.config) are wired into the transform engine here.
  await applyRegisteredLoaders(transformer, userConfig);
  const hmr = new HMRServer();
  const envFromFiles = loadIonifyEnv("development", rootDir);
  process.env.NODE_ENV = process.env.NODE_ENV ?? "development";
  process.env.MODE = process.env.MODE ?? "development";
  const envValues: Record<string, string> = {
    ...envFromFiles,
    NODE_ENV: process.env.NODE_ENV,
    MODE: process.env.MODE,
  };
  
  // Phase 5.4.3: Build define config from user config + env variables
  const envPrefix = userConfig?.envPrefix || ["VITE_", "IONIFY_"];
  const defineConfig = buildDefineConfig(userConfig?.define, envValues, envPrefix);
  logInfo(`[define] ${Object.keys(defineConfig).length} replacements configured`);
  
  const envPlaceholderPattern = /%([A-Z0-9_]+)%/g;
  const envEnabledExts = new Set([
    ".html",
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".jsx",
  ]);
  const applyEnvPlaceholders = (input: string, extname: string): string => {
    if (!envEnabledExts.has(extname)) return input;
    return input.replace(envPlaceholderPattern, (match, key) => {
      if (
        key === "NODE_ENV" ||
        key === "MODE" ||
        key.startsWith("VITE_") ||
        key.startsWith("IONIFY_")
      ) {
        const replacement = envValues[key];
        return replacement !== undefined ? replacement : match;
      }
      return match;
    });
  };

  const parseJsonBody = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => resolve());
      req.on("error", (err) => reject(err));
    });
    if (!chunks.length) return null;
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  };

  const sendJson = (res: ServerResponse, status: number, payload: unknown) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(body);
  };

  const buildUpdatePayload = async (
    modules: PendingHMRModule[],
  ): Promise<HMRModuleResponse[]> => {
    const updates: HMRModuleResponse[] = [];
    for (const mod of modules) {
      // Deleted files short-circuit: drop from graph + watcher.
      const exists = fs.existsSync(mod.absPath);
      if (mod.reason === "deleted" || !exists) {
        graph.removeFile(mod.absPath);
        watcher.unwatchFile(mod.absPath);
        updates.push({
          url: mod.url,
          hash: null,
          deps: [],
          reason: mod.reason,
          status: "deleted",
        });
        continue;
      }

      watcher.watchFile(mod.absPath);

      const ext = path.extname(mod.absPath).toLowerCase();
      if (ext === ".css") {
        // CSS is served via the dev server CSS pipeline (query-based modes), not TransformEngine.
        // Keep the HMR payload minimal and avoid overwriting CSS dependency edges with empty JS-import parsing.
        let hash = mod.hash;
        if (!hash) {
          try {
            hash = getCacheKey(fs.readFileSync(mod.absPath, "utf8"));
          } catch {
            hash = graph.getNode(mod.absPath)?.hash ?? getCacheKey(mod.absPath);
          }
        }
        const depsAbs = graph.getNode(mod.absPath)?.deps ?? [];
        const kind = /\.module\.css$/i.test(mod.absPath) ? "css-module" : "css";
        graph.recordFile(mod.absPath, hash, depsAbs, [], kind);
        updates.push({
          url: mod.url,
          hash,
          deps: depsAbs.map((dep) => normalizeUrlFromFs(rootDir, dep)),
          reason: mod.reason,
          status: "updated",
          code: "",
        });
        continue;
      }

      if (isAssetExt(ext)) {
        // Assets are served as binary or as `?import` JS shims. Avoid TransformEngine (text) transforms here.
        let hash = mod.hash;
        if (!hash) {
          try {
            const buf = fs.readFileSync(mod.absPath);
            hash = crypto.createHash("sha256").update(buf).digest("hex");
          } catch {
            hash = graph.getNode(mod.absPath)?.hash ?? getCacheKey(mod.absPath);
          }
        }
        graph.recordFile(mod.absPath, hash, [], [], "asset");
        updates.push({
          url: mod.url,
          hash,
          deps: [],
          reason: mod.reason,
          status: "updated",
          code: "",
        });
        continue;
      }

      let code: string;
      try {
        code = fs.readFileSync(mod.absPath, "utf8");
      } catch (err) {
        logError("Failed to read module during HMR apply", err);
        throw err;
      }

      // Use new IR-based parser
      let hash: string;
      let specs: string[];
      if (native?.parseModuleIr) {
        try {
          const ir = native.parseModuleIr(mod.absPath, code);
          hash = ir.hash;
          specs = ir.dependencies.map((dep: any) => dep.specifier);
        } catch {
          hash = getCacheKey(code);
          specs = extractImports(code, mod.absPath);
        }
      } else {
        hash = getCacheKey(code);
        specs = extractImports(code, mod.absPath);
      }
      
      const depsAbs = resolveImports(specs, mod.absPath);
      graph.recordFile(mod.absPath, hash, depsAbs);
      for (const dep of depsAbs) {
        watcher.watchFile(dep);
      }

      const result = await transformer.run({
        path: mod.absPath,
        code,
        ext: path.extname(mod.absPath),
        moduleHash: hash,
        config: userConfig ?? null,
      });

      const transformed = result.code;
      const envApplied = applyEnvPlaceholders(
        transformed,
        path.extname(mod.absPath),
      );

      updates.push({
        url: mod.url,
        hash,
        deps: depsAbs.map((dep) => normalizeUrlFromFs(rootDir, dep)),
        reason: mod.reason,
        status: "updated",
        code: envApplied,
      });
    }
    return updates;
  };

  const server = http.createServer(async (req, res) => {
    try {
      const parsed = url.parse(req.url || "/", true);
      let reqPath = parsed.pathname || "/";
      try {
        reqPath = decodeURIComponent(reqPath);
      } catch {
        // leave as undecoded path to avoid crashing on malformed encodings
      }
      const q = parsed.query || {};

      // --- HMR endpoints ---
      if (reqPath === "/__ionify_hmr") {
        // Browser subscribes to this SSE channel for HMR summaries.
        hmr.handleSSE(req, res);
        return;
      }
      if (reqPath === "/__ionify_hmr_client.js") {
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
        res.end(readClientAsset("hmr.js"));
        return;
      }
      if (reqPath === "/__ionify_overlay.js") {
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
        res.end(readClientAsset("overlay.js"));
        return;
      }
      if (reqPath === "/__ionify_react_refresh.js") {
        try {
          const asset = readClientAssetFile("react-refresh-runtime.js");
          
          // Resolve react-refresh/runtime to actual node_modules path
          let reactRefreshPath: string;
          try {
            // Create a require function from the project root to resolve modules
            const projectRequire = createRequire(path.join(rootDir, "package.json"));
            reactRefreshPath = projectRequire.resolve("react-refresh/runtime");
          } catch (err) {
            logError("Failed to resolve react-refresh/runtime", err);
            res.statusCode = 500;
            res.end("Failed to resolve react-refresh/runtime. Make sure react-refresh is installed.");
            return;
          }
          
          const reactRefreshUrl = normalizeUrlFromFs(rootDir, reactRefreshPath);
          
          // Replace the import with the resolved path
          let code = asset.code.replace(
            'import RefreshRuntime from "react-refresh/runtime"',
            `import RefreshRuntime from "${reactRefreshUrl}"`
          );
          
          res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
          res.end(code);
        } catch (err) {
          logError("Failed to serve react refresh runtime", err);
          res.statusCode = 500;
          res.end("Internal Server Error");
        }
        return;
      }
      if (reqPath === "/__ionify_hmr/apply") {
        if (req.method !== "POST") {
          res.writeHead(405, { Allow: "POST" });
          res.end("Method Not Allowed");
          return;
        }
        let body: any;
        try {
          body = await parseJsonBody(req);
        } catch (err) {
          logError("Invalid JSON body for HMR apply", err);
          sendJson(res, 400, { error: "Invalid JSON body" });
          return;
        }
        const id = typeof body?.id === "string" ? body.id : null;
        if (!id) {
          sendJson(res, 400, { error: "Missing update id" });
          return;
        }
        const pending = hmr.consumeUpdate(id);
        if (!pending) {
          sendJson(res, 404, { error: "Update not found", id });
          return;
        }
        try {
          const modules = await buildUpdatePayload(pending.modules);
          sendJson(res, 200, {
            type: "update",
            id: pending.summary.id,
            timestamp: Date.now(),
            modules,
          });
        } catch (err) {
          logError("Failed to build HMR update payload", err);
          hmr.broadcastError({
            id,
            message: "Failed to compile update; falling back to full reload",
          });
          sendJson(res, 500, { error: "Failed to compile update", id });
        }
        return;
      }
      if (reqPath === "/__ionify_hmr/error") {
        if (req.method !== "POST") {
          res.writeHead(405, { Allow: "POST" });
          res.end("Method Not Allowed");
          return;
        }
        let body: any;
        try {
          body = await parseJsonBody(req);
        } catch {
          body = null;
        }
        const id = typeof body?.id === "string" ? body.id : undefined;
        const message =
          typeof body?.message === "string"
            ? body.message
            : "Unknown HMR error";
        logError(`[HMR] client reported error${id ? ` ${id}` : ""}: ${message}`);
        hmr.broadcastError({ id, message });
        sendJson(res, 200, { ok: true });
        return;
      }

      if (reqPath.startsWith(DEPS_PREFIX)) {
        const fileName = reqPath.slice(DEPS_PREFIX.length);
        if (vendorPackFileName && fileName === vendorPackFileName) {
          ensureVendorPackFile();
        }
        if (fileName.endsWith(".js.map")) {
          const mapPath = path.join(depsRoot, fileName);
          if (fs.existsSync(mapPath)) {
            const stat = fs.statSync(mapPath);
            const etag = weakEtagFromStat(`deps-map-${depsHash}`, stat);
            // Check 304 before reading file
            if (isNotModified(req, etag)) {
              res.setHeader("ETag", etag);
              res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
              res.statusCode = 304;
              res.end();
              return;
            }
            sendBuffer(
              req,
              res,
              200,
              "application/json; charset=utf-8",
              fs.readFileSync(mapPath),
              { etag, cacheControl: "public, max-age=31536000, immutable" },
            );
            return;
          }
        }

        const depsFilePath = path.join(depsRoot, fileName);
        const entryFromManifest = depsManifestIndex.get(fileName);
        const entryFromRegistry = getDepEntry(fileName);
        const entryPath = entryFromManifest?.entryPath ?? entryFromRegistry?.entryPath;
        const packageLabel =
          entryFromRegistry?.packageName
            ? formatDepLabel(entryFromRegistry.packageName, entryFromRegistry.subpath)
            : entryFromManifest?.packageLabel ?? fileName;

        if (fs.existsSync(depsFilePath)) {
          const stat = fs.statSync(depsFilePath);
          const etag = weakEtagFromStat(`deps-${depsHash}`, stat);
          // Check 304 before reading file (avoid blocking IO)
          if (isNotModified(req, etag)) {
            res.setHeader("ETag", etag);
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            res.statusCode = 304;
            res.end();
            logInfo(`[deps] OPTIMIZE ${packageLabel}: HIT from cache (304)`);
            return;
          }
          sendBuffer(
            req,
            res,
            200,
            "application/javascript; charset=utf-8",
            fs.readFileSync(depsFilePath),
            { etag, cacheControl: "public, max-age=31536000, immutable" },
          );
          logInfo(`[deps] OPTIMIZE ${packageLabel}: HIT from cache`);
          return;
        }

        if (!entryPath || !native?.optimizeDependency) {
          res.statusCode = 404;
          res.end("Dependency not found");
          return;
        }

        try {
          const start = Date.now();
          const rawSize = fs.existsSync(entryPath) ? fs.statSync(entryPath).size : 0;
          const result = native.optimizeDependency(entryPath, depsHash, depsSourcemapEnabled, depsBundleEsmEnabled);
          const outPath = (result as any)?.out_path ?? (result as any)?.outPath ?? depsFilePath;
          const mapPath = (result as any)?.map_path ?? (result as any)?.mapPath ?? null;
          const resolvedOutPath = path.isAbsolute(outPath)
            ? outPath
            : path.join(depsRoot, outPath);
          if (!fs.existsSync(resolvedOutPath)) {
            throw new Error("Optimizer did not produce output");
          }
          const outBuffer = fs.readFileSync(resolvedOutPath);
          const optimizedSize = outBuffer.length;
          const stat = fs.statSync(resolvedOutPath);
          const etag = weakEtagFromStat(`deps-${depsHash}`, stat);
          sendBuffer(req, res, 200, "application/javascript; charset=utf-8", outBuffer, {
            etag,
            cacheControl: "public, max-age=31536000, immutable",
          });
          const elapsed = Date.now() - start;
          const rawKb = (rawSize / 1024).toFixed(1);
          const optKb = (optimizedSize / 1024).toFixed(1);
          const mapSuffix = mapPath ? ` map=${path.basename(mapPath)}` : "";
          logInfo(`[deps] OPTIMIZE ${packageLabel}: MISS → BUILD (${elapsed}ms, ${rawKb}KB → ${optKb}KB)${mapSuffix}`);
          // Refresh manifest index after optimization
          const refreshed = loadDepsManifestIndex(depsRoot);
          refreshed.forEach((value, key) => depsManifestIndex.set(key, value));
          return;
        } catch (err) {
          logWarn(
            `[deps] WARN: Optimization failed for ${packageLabel}, serving raw (fallback): ${String(err)}`,
          );
          try {
            const raw = fs.readFileSync(entryPath);
            res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
            res.end(raw);
          } catch (readErr) {
            logError("Failed to read raw dependency", readErr);
            res.statusCode = 500;
            res.end("Dependency optimization failed");
          }
          return;
        }
      }

      // Resolve to FS path
      const fsPath = decodePublicPath(rootDir, reqPath);
      if (!fsPath) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      let effectiveFsPath = fsPath;
      let effectiveUrlPath = reqPath;
      if (fs.existsSync(effectiveFsPath) && fs.statSync(effectiveFsPath).isDirectory()) {
        // Try index files with various extensions
        const indexExtensions = ['.html', '.js', '.ts', '.tsx', '.jsx'];
        let found = false;
        
        for (const ext of indexExtensions) {
          const indexFile = path.join(effectiveFsPath, `index${ext}`);
          if (fs.existsSync(indexFile)) {
            effectiveFsPath = indexFile;
            effectiveUrlPath = effectiveUrlPath.endsWith("/")
              ? `${effectiveUrlPath}index${ext}`
              : `${effectiveUrlPath}/index${ext}`;
            found = true;
            break;
          }
        }

        if (!found) {
          // Look for module resolution in directory
          const packageJson = path.join(effectiveFsPath, "package.json");
          if (fs.existsSync(packageJson)) {
            try {
              const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
              if (pkg.main) {
                const mainFile = path.join(effectiveFsPath, pkg.main);
                if (fs.existsSync(mainFile)) {
                  effectiveFsPath = mainFile;
                  found = true;
                }
              }
            } catch (e) {
              // Ignore package.json parsing errors
            }
          }
        }

        if (!found) {
          // Try resolving as a module directory
          for (const ext of indexExtensions) {
            const moduleFile = path.join(effectiveFsPath, `module${ext}`);
            if (fs.existsSync(moduleFile)) {
              effectiveFsPath = moduleFile;
              found = true;
              break;
            }
          }
        }

        if (!found) {
          res.statusCode = 404;
          res.end("Module not found");
          return;
        }
      }
      if (!fs.existsSync(effectiveFsPath)) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      // Assets: static files or `?import` JS shims.
      const ext = path.extname(effectiveFsPath);
      if (isAssetExt(ext)) {
        try {
          const data = fs.readFileSync(effectiveFsPath);
          const assetHash = crypto.createHash("sha256").update(data).digest("hex");
          const kind = "asset";
          const changed = graph.recordFile(effectiveFsPath, assetHash, [], [], kind);
          watcher.watchFile(effectiveFsPath);
          if (changed) {
            logInfo(`[Graph] Asset updated: ${effectiveFsPath}`);
          }
        } catch {
          // ignore hashing errors; still serve
        }
        if ("import" in q) {
          const js = assetAsModule(normalizeUrlFromFs(rootDir, effectiveFsPath));
          res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
          res.end(js);
          return;
        } else {
          res.writeHead(200, { "Content-Type": contentTypeForAsset(ext) });
          fs.createReadStream(effectiveFsPath).pipe(res);
          return;
        }
      }

      // CSS loader: ?inline or .module.css => JS module via PostCSS pipeline
      if (ext === ".css") {
        try {
          const cssSource = fs.readFileSync(effectiveFsPath, "utf8");
          const isModule = "module" in q || /\.module\.css$/i.test(effectiveFsPath);

          // Vite-ish CSS query modes:
          // - raw: serve CSS (for <link> or direct fetch)
          // - inline: JS module that injects styles (Ionify default for CSS imports)
          // - module: JS module exporting tokens + injecting styles
          // - raw-string: JS module exporting CSS string (no injection)
          // - url: JS module exporting URL to raw CSS
          const mode =
            "raw" in q
              ? "css:raw-string"
              : "url" in q
                ? "css:url"
                : isModule
                  ? "css:module"
                  : "inline" in q
                    ? "css:inline"
                    : "css:raw";

          const contentHash = getCacheKey(cssSource);
          watcher.watchFile(effectiveFsPath);

          const kind = isModule ? "css-module" : "css";

          // Mode + dependency-isolated CAS key to prevent cross-mode collisions and stale CSS
          // when @import or PostCSS plugin dependencies change.
          const prevDeps = graph.getNode(effectiveFsPath)?.deps ?? [];
          for (const dep of prevDeps) {
            watcher.watchFile(dep);
          }
          const depsStampHash = computeDepsStampHash(prevDeps);
          let artifactHash = getCacheKey(
            `css:v2:${effectiveFsPath}:${contentHash}:${mode}:${depsStampHash}`,
          );
          let casDir = getCasArtifactPath(casRoot, configHash, artifactHash);
          const jsMode = mode !== "css:raw";
          let casFile = path.join(casDir, jsMode ? "transformed.js" : "transformed.css");
          let finalBuffer: Buffer | null = null;
          if (fs.existsSync(casFile)) {
            try {
              finalBuffer = fs.readFileSync(casFile);
              const ok = jsMode
                ? looksLikeIonifyCssJsModule(finalBuffer)
                : !looksLikeIonifyCssJsModule(finalBuffer);
              if (ok) {
                res.setHeader("X-Ionify-Cache", "HIT");
              } else {
                finalBuffer = null;
                res.setHeader("X-Ionify-Cache", "MISMATCH");
              }
            } catch {
              finalBuffer = null;
            }
          }

          if (!finalBuffer) {
            let body: string;

            if (mode === "css:url") {
              // Vite-style URL export for CSS.
              // Include a stable version key to make the JS module update when CSS changes.
              const rawUrl = `${effectiveUrlPath}?v=${contentHash}-${depsStampHash.slice(0, 8)}`;
              body = renderCssUrlModule(rawUrl);
            } else {
              // Run PostCSS + (optional) modules pipeline.
              const { css: compiledCss, tokens, deps } = await compileCss({
                code: cssSource,
                filePath: effectiveFsPath,
                rootDir,
                modules: isModule,
              });

              const depsAbs = deps.map((d) => d.filePath).filter(Boolean);
              const nextDepsStampHash = computeDepsStampHash(depsAbs);
              artifactHash = getCacheKey(
                `css:v2:${effectiveFsPath}:${contentHash}:${mode}:${nextDepsStampHash}`,
              );
              casDir = getCasArtifactPath(casRoot, configHash, artifactHash);
              casFile = path.join(casDir, jsMode ? "transformed.js" : "transformed.css");
              const changed = graph.recordFile(effectiveFsPath, contentHash, depsAbs, [], kind);
              if (changed) {
                logInfo(`[Graph] CSS updated: ${effectiveFsPath}`);
              }
              for (const dep of depsAbs) {
                watcher.watchFile(dep);
              }

              if (mode === "css:raw") {
                body = compiledCss;
              } else if (mode === "css:raw-string") {
                body = renderCssRawStringModule(compiledCss);
              } else {
                // css:inline and css:module are both injector JS modules; css:module additionally exports tokens.
                body = renderCssModule({
                  css: compiledCss,
                  filePath: effectiveFsPath,
                  tokens: isModule ? tokens ?? {} : undefined,
                });
              }
            }
            finalBuffer = Buffer.from(body, "utf8");
            res.setHeader("X-Ionify-Cache", "MISS");
            try {
              fs.mkdirSync(casDir, { recursive: true });
              fs.writeFileSync(casFile, finalBuffer);
            } catch {
              // ignore CAS write errors
            }
          }

          const etag = `W/"css-${configHash}-${artifactHash}-${mode}"`;
          if (jsMode) {
            sendBuffer(req, res, 200, "application/javascript; charset=utf-8", finalBuffer, {
              etag,
              cacheControl: "no-cache",
            });
          } else {
            sendBuffer(req, res, 200, "text/css; charset=utf-8", finalBuffer, {
              etag,
              cacheControl: "no-cache",
            });
          }
          logInfo(`Served: ${effectiveUrlPath} ${mode}`);
          return;
        } catch (err) {
          logError("Failed to process CSS", err);
          hmr.broadcastError({
            message:
              err instanceof Error
                ? `Failed to process CSS: ${err.stack || err.message}`
                : `Failed to process CSS: ${String(err)}`,
          });
          res.statusCode = 500;
          res.end("Failed to process CSS");
          return;
        }
      }

      // Default: HTML/JS/TS handling
      const code = fs.readFileSync(effectiveFsPath, "utf8");
      
      // Use new IR-based parser
      let hash: string;
      let specs: string[];
      if (native?.parseModuleIr) {
        try {
          const ir = native.parseModuleIr(effectiveFsPath, code);
          hash = ir.hash;
          specs = ir.dependencies.map((dep: any) => dep.specifier);
        } catch {
          hash = getCacheKey(code);
          specs = extractImports(code, effectiveFsPath);
        }
      } else {
        hash = getCacheKey(code);
        specs = extractImports(code, effectiveFsPath);
      }
      
      const depsAbs = resolveImports(specs, effectiveFsPath);
      const changed = graph.recordFile(effectiveFsPath, hash, depsAbs);

      watcher.watchFile(effectiveFsPath);
      for (const dep of depsAbs) {
        watcher.watchFile(dep);
      }

      let result: { code: string };
      try {
        result = await transformer.run({
          path: effectiveFsPath,
          code,
          ext,
          moduleHash: hash,
          config: userConfig ?? null,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.stack || err.message : String(err);
        hmr.broadcastError({ message: `Failed to transform ${effectiveUrlPath}: ${message}` });
        throw err;
      }
      const transformedCode = result.code;
      res.setHeader("X-Ionify-Cache", changed ? "MISS" : "HIT");

      // Phase 5.4.3: Apply define replacements first
      const withDefine = applyDefineReplacements(transformedCode, defineConfig);
      const envApplied = applyEnvPlaceholders(withDefine, ext);

      // HTML: inject HMR client
      if (path.extname(effectiveFsPath) === ".html") {
        ensureVendorPackFile();
        const withVendor = vendorPackUrl ? injectModulePreload(envApplied, vendorPackUrl) : envApplied;
        const injected = injectHMRClient(withVendor);
        const etag = `W/"html-${configHash}-${hash}"`;
        sendBuffer(req, res, 200, "text/html; charset=utf-8", Buffer.from(injected, "utf8"), {
          etag,
          cacheControl: "no-cache",
        });
      } else {
        const finalBuffer = Buffer.from(envApplied);
        const etag = `W/"mod-${configHash}-${hash}"`;
        sendBuffer(req, res, 200, guessContentType(effectiveFsPath), finalBuffer, {
          etag,
          cacheControl: "no-cache",
        });
      }

      logInfo(`Served: ${effectiveUrlPath} deps:${depsAbs.length} ${changed ? "(updated)" : "(cached)"}`);
      if (cacheDebug) {
        const m = transformCache.metrics();
        logInfo(`[Ionify][Dev Cache] hits:${m.hits} misses:${m.misses} size:${m.size}`);
      }
    } catch (err) {
      logError("Error serving request:", err);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });

  // Broadcast HMR reload on changes
  watcher.on("change", (file, status) => {
    logInfo(`[Watcher] ${status}: ${file}`);
    const ext = path.extname(file).toLowerCase();
    const isReactFastRefreshBoundary =
      status !== "deleted" && (ext === ".tsx" || ext === ".jsx");
    const isCssBoundary = status !== "deleted" && ext === ".css";

    // Keep HMR boundary updates narrow to avoid full JS re-evaluation, but still
    // include affected CSS nodes so Tailwind/content and CSS @import chains stay fresh.
    const collected = graph.collectAffected([file]);
    const affected =
      isReactFastRefreshBoundary || isCssBoundary
        ? [
            file,
            ...collected.filter(
              (absPath) =>
                absPath !== file &&
                path.extname(absPath).toLowerCase() === ".css",
            ),
          ]
        : collected;
    if (!affected.includes(file)) {
      affected.unshift(file);
    }
    const modules: PendingHMRModule[] = [];
    for (const absPath of affected) {
      const reason: PendingHMRModule["reason"] =
        absPath === file
          ? status === "deleted"
            ? "deleted"
            : "changed"
          : "dependent";
      let hash: string | null = null;
      if (reason !== "deleted") {
        if (absPath === file) {
          try {
            const code = fs.readFileSync(absPath, "utf8");
            hash = getCacheKey(code);
          } catch {
            hash = graph.getNode(absPath)?.hash ?? null;
          }
        } else {
          hash = graph.getNode(absPath)?.hash ?? null;
        }
      }
      modules.push({
        absPath,
        url:
          path.extname(absPath).toLowerCase() === ".css"
            ? `${normalizeUrlFromFs(rootDir, absPath)}?inline`
            : isAssetExt(path.extname(absPath).toLowerCase())
              ? `${normalizeUrlFromFs(rootDir, absPath)}?import`
              : normalizeUrlFromFs(rootDir, absPath),
        hash,
        reason,
      });
    }
    const summary = hmr.queueUpdate(modules);
    if (summary) {
      logInfo(
        `[HMR] update ${summary.id} -> ${summary.modules.length} module(s) queued`,
      );
    }
    if (status === "deleted") {
      graph.removeFile(file);
      watcher.unwatchFile(file);
    }
  });

  let closingPromise: Promise<void> | null = null;
  let cleanedUp = false;
  const signalHandlers: Array<{ event: NodeJS.Signals; handler: () => void }> = [];

  const cleanup = (force: boolean = false) => {
    if (cleanedUp) return;
    cleanedUp = true;

    // Force close any hanging connections if in force mode
    if (force) {
      server.getConnections((err, count) => {
        if (!err && count > 0) {
          server.closeAllConnections();
        }
      });
    }

    try {
      watcher.closeAll();
    } catch (err) {
      logError("Error closing watcher:", err);
    }

    try {
      hmr.close();
    } catch (err) {
      logError("Error closing HMR:", err);
    }

    graph.flush();
    
    for (const { event, handler } of signalHandlers) {
      process.off(event, handler);
    }
  };

  server.on("close", () => cleanup(false));

  const shutdown = async (exitProcess: boolean) => {
    if (!closingPromise) {
      closingPromise = new Promise<void>((resolve, reject) => {
        // Add a timeout to force cleanup after 3 seconds
        const timeoutId = setTimeout(() => {
          logInfo("Server shutdown taking too long, forcing cleanup...");
          cleanup(true);
          resolve();
        }, 3000);

        server.close((err) => {
          clearTimeout(timeoutId);
          if (err) {
            logError("Error during server shutdown:", err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }

    try {
      await Promise.race([
        closingPromise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Shutdown timeout")), 5000)
        )
      ]);
    } catch (err) {
      logError("Shutdown error:", err);
      cleanup(true); // Force cleanup on timeout
    }

    if (exitProcess) {
      // Give a small grace period for cleanup to finish
      setTimeout(() => process.exit(0), 100);
    }
  };

  if (enableSignalHandlers) {
    const onSignal = () => {
      void shutdown(true);
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    signalHandlers.push({ event: "SIGINT", handler: onSignal });
    signalHandlers.push({ event: "SIGTERM", handler: onSignal });
  }

  await new Promise<void>((resolve, reject) => {
    const onError = (err: unknown) => reject(err);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  const actualPort =
    address && typeof address === "object" && address?.port
      ? address.port
      : port;

  logInfo(`Ionify Dev Server (Phase 2) at http://localhost:${actualPort}`);
  logInfo(`Ready in ${Date.now() - bootStartMs}ms`);
  logInfo(`HMR listening at /__ionify_hmr (SSE)`);

  // Phase 5.9.2: Pre-warm vendor deps (best-effort, non-blocking).
  if (vendorDeps.length > 0) {
    const vendorLabels = vendorDeps.map((d) => d.packageLabel).join(", ");
    logInfo(`[deps] Vendor pack detected (${vendorDeps.length}): ${vendorLabels}`);
    ensureVendorPackFile();

    const missing = vendorDeps.filter((d) => !fs.existsSync(path.join(depsRoot, d.fileName)));
    if (missing.length > 0) {
      const entryCount = missing.length;
      logInfo(`[deps] Pre-warming vendor deps (${entryCount}) in parallel...`);
      Promise.resolve()
        .then(() => {
          if (native?.optimizeDependenciesBatch && !depsSourcemapEnabled && depsBundleEsmEnabled) {
            const results = native.optimizeDependenciesBatch(
              missing.map((d) => ({ entryPath: d.entryPath, depsHash })),
            );
            results.forEach((r, idx) => {
              const dep = missing[idx];
              if (r?.error) {
                logWarn(`[deps] Vendor prewarm failed ${dep.packageLabel}: ${r.error}`);
              } else if (r?.out_path || r?.outPath) {
                const outPath = (r as any).out_path ?? (r as any).outPath;
                logInfo(
                  `[deps] ✓ Vendor prewarmed ${dep.packageLabel} → ${path.basename(outPath)}`,
                );
              }
            });
            return;
          }

          if (!native?.optimizeDependency) return;
          for (const dep of missing) {
            try {
              const result = native.optimizeDependency(
                dep.entryPath,
                depsHash,
                depsSourcemapEnabled,
                depsBundleEsmEnabled,
              );
              const outPath = (result as any)?.out_path ?? (result as any)?.outPath ?? null;
              if (outPath) {
                logInfo(`[deps] ✓ Vendor prewarmed ${dep.packageLabel} → ${path.basename(outPath)}`);
              }
            } catch (err) {
              logWarn(`[deps] Vendor prewarm failed ${dep.packageLabel}: ${String(err)}`);
            }
          }
        })
        .catch((err) => {
          logWarn(`[deps] Vendor prewarm error: ${err}`);
        });
    }
  }

  // Phase 5.4.2: Pre-warm optimizeDeps.include packages
  if (userConfig?.optimizeDeps?.include && Array.isArray(userConfig.optimizeDeps.include)) {
    const includes = userConfig.optimizeDeps.include;
    if (includes.length > 0) {
      logInfo(`[deps] Pre-warming ${includes.length} dependencies: ${includes.join(", ")}`);
      
      // Pre-warm in background to avoid blocking server startup
      Promise.all(
        includes.map(async (pkgName) => {
          try {
            if (!native?.resolveModule || !native?.optimizeDependency) {
              logWarn(`[deps] Cannot pre-warm ${pkgName}: native functions not available`);
              return;
            }
            
            // Resolve the package from root
            const resolved = native.resolveModule(pkgName, rootDir);
            if (!resolved || !resolved.fsPath && !resolved.fs_path) {
              logWarn(`[deps] Cannot pre-warm ${pkgName}: resolution failed`);
              return;
            }
            
            const entryPath = resolved.fsPath || resolved.fs_path!;
            
            // Trigger optimization (will be cached for later requests)
            const result = native.optimizeDependency(entryPath, depsHash, depsSourcemapEnabled, depsBundleEsmEnabled);
            
            if (result?.out_path) {
              const fileName = path.basename(result.out_path);
              logInfo(`[deps] ✓ Pre-warmed ${pkgName} → ${fileName}`);
            }
          } catch (err) {
            logWarn(`[deps] Failed to pre-warm ${pkgName}: ${err}`);
          }
        })
      ).catch((err) => {
        logWarn(`[deps] Pre-warming error: ${err}`);
      });
    }
  }

  return {
    server,
    port: actualPort,
    close: async () => {
      await shutdown(false);
    },
  };
}


// ===== Next Phase TODOs =====
// Phase 3: live HMR channel + web client bridge.
