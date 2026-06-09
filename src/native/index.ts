import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import type { BuildPlan } from "../types/plan";
import type { IonModule } from "../core/ir";
import { computeVersionHash, computeCanonicalVersionInputs } from "../core/version";

export interface NativeGraphNode {
  id: string;
  hash: string | null;
  deps: string[];
  dynamicDeps: string[];
  kind: string;
  config_hash?: string | null;
  origin?: "app" | "dep";
  format?: "esm" | "cjs";
}

export interface NativeGraphRecordBatchNode {
  id: string;
  hash: string | null;
  deps: string[];
  dynamicDeps?: string[];
  kind?: string;
  configHash?: string | null;
}

export interface NativeBuildChunksTreeshakeOptions {
  mode?: "off" | "safe" | "aggressive" | string;
  include?: string[];
  exclude?: string[];
}

export interface NativeBuildChunksScopeHoistOptions {
  enable?: boolean;
  inlineFunctions?: boolean;
  constantFolding?: boolean;
  combineVariables?: boolean;
}

export interface NativeBuildChunksOptions {
  minifier?: "oxc" | "swc" | "auto" | string;
  minify?: boolean;
  mangle?: boolean;
  treeshake?: NativeBuildChunksTreeshakeOptions;
  scopeHoist?: NativeBuildChunksScopeHoistOptions;
  enableSourcemaps?: boolean;
  externalModules?: string[];
  federationExposeEntries?: string[];
  virtualModuleIds?: string[];
  virtualModuleSources?: string[];
}

export interface NativeBinding {
  parseImports(source: string, filename?: string): string[];
  parseModuleMetadata?(source: string, filename?: string): { imports: string[]; hash: string };
  parseModuleIr?(id: string, source: string, mode?: string): IonModule;
  parserCacheStats?(): { hits: number; misses: number };
  cacheHash?(data: Buffer | Uint8Array): string;
  cacheHashPath?(path: string): string;
  parseAndTransformOxc?(source: string, options: { filename: string; jsx?: boolean; typescript?: boolean; react_refresh?: boolean }): { code: string; map?: string | null };
  parseAndTransformSwc?(source: string, options: { filename: string; jsx?: boolean; typescript?: boolean; react_refresh?: boolean }): { code: string; map?: string | null };
  nativeTransformBatch?(
    jobs: Array<{ id: string; filePath: string; ext: string; code: string }>,
    parserMode?: "oxc" | "swc" | "hybrid" | string | null,
  ): Array<{
    id: string;
    filePath?: string;
    file_path?: string;
    code: string;
    map?: string | null;
    type?: "js" | "css" | "asset" | string;
    kind?: "js" | "css" | "asset" | string;
    error?: string | null;
  }>;
  graphInit(path?: string, version?: string): void;
  graphRecord(id: string, hash: string | null, deps: string[], dynamicDeps?: string[], kind?: string, configHash?: string | null): boolean;
  graphRecordBatch?(nodes: NativeGraphRecordBatchNode[]): number;
  graphBuildFromEntries?(
    entryPaths: string[],
    workspaceRoot: string,
    ionifyDir?: string | null,
    /** T19: dep-leaf stop set — paths that map to pre-built Tier-2 artifacts; BFS stops here */
    depStops?: Array<{ entryPath: string; artifactHash: string }> | null,
    /** Phase MF-A: preserve these specifiers as externals in the planner graph. */
    externalSpecifiers?: string[] | null,
  ): {
    moduleCount: number;
    fingerprint: string;
  };
  graphGet(id: string): NativeGraphNode | undefined | null;
  graphRemove(id: string): void;
  graphLoad(): NativeGraphNode[];
  graphLoadMap?(): Record<string, NativeGraphNode>;
  graphFlush?(): void;
  graphDependents?(target: string): string[];
  graphCollectAffected?(targets: string[]): string[];
  plannerPlanBuild?(entries: string[]): BuildPlan;
  resolveModule?(specifier: string, fromPath: string): {
    kind: string;
    fsPath?: string | null;
    fs_path?: string | null;
    id: string;
    pkg?: {
      name: string;
      version?: string | null;
      subpath?: string | null;
    };
  };
  
  // Wave 3 & 7: AST Cache functions
  getCachedAst?(id: string, source: string): string | null;
  initAstCache?(versionHash: string): void;
  astCachePrune?(keepPercentage: number): number;
  astCacheStats?(): {
    totalEntries: number;
    totalSizeBytes: number;
    totalHits: number;
    configHash: string;
    hitRate?: number;
    topHotModules?: string[];
  };
  astCacheClear?(): void;
  astCacheWarmup?(): number;
  buildChunks?(
    plan: BuildPlan,
    casRoot?: string | null,
    versionHash?: string | null,
    options?: NativeBuildChunksOptions | null,
  ): {
    id: string;
    file_name?: string;
    code: string;
    map?: string | null;
    code_bytes?: number;
    map_bytes?: number;
    assets?: Array<{ source: string; fileName?: string; file_name?: string }>;
  }[];
  optimizeDependency?(
    entryPath: string,
    depsHash: string,
    enableSourcemap?: boolean,
    bundleEsm?: boolean,
    ionifyDir?: string | null,
  ): {
    out_path: string;
    map_path?: string | null;
  };
  optimizeDependencyWithManifest?(entryPath: string, rootDir: string): Promise<{
    outFile?: string;
    out_file?: string;
    outputCode?: string;
    package?: string;
    hasSourcemap?: boolean;
  }>;
  optimizeDependenciesChunked?(
    entries: Array<{ entryPath: string; depsHash: string; usedExports?: string[] }>,
    ionifyDir?: string | null,
  ): {
    chunk_group?: string;
    chunkGroup?: string;
    chunk_files?: string[];
    chunkFiles?: string[];
    entries?: Array<{
      entry_path?: string;
      entryPath?: string;
      out_path?: string;
      outPath?: string;
      map_path?: string | null;
      mapPath?: string | null;
    }>;
  };
  optimizeDependenciesBatch?(
    entries: Array<{ entryPath: string; depsHash: string }>,
    ionifyDir?: string | null,
  ): Array<{
    out_path?: string;
    outPath?: string;
    map_path?: string | null;
    mapPath?: string | null;
    error?: string | null;
  }>;

  /**
   * T8: Run the batch (non-vendor) and chunked (vendor) dep optimizers in true
   * Rayon-parallel inside Rust. Both arms must operate on disjoint entry file sets
   * (enforced by the TS caller via excludeEntryPaths / resolveAutoVendorEntryFsPaths).
   */
  optimizeDepsParallelSplit?(
    batchEntries: Array<{ entryPath: string; depsHash: string }>,
    chunkedEntries: Array<{ entryPath: string; depsHash: string; usedExports?: string[] | null }>,
    ionifyDir?: string | null,
  ): {
    chunkGroup: string;
    chunkFiles: string[];
    chunkedEntries: Array<{
      entryPath: string;
      outPath: string;
      mapPath?: string | null;
      peerDepWarnings: string[];
    }>;
    errors: string[];
  };

  // Phase 18C: Rust-native batch compression for JS chunk files.
  // Each item is compressed independently (Rayon-parallel in Rust).
  // `br` / `gz` are `null` when the compressed output would not be smaller than the input.
  compressBatch?(
    items: Array<{
      id: string;
      bytes: Buffer;
      brotliQuality: number;
      gzipLevel: number;
    }>,
  ): Array<{
    id: string;
    br?: Buffer | null;
    gz?: Buffer | null;
  }>;
  depsOptimizerOutputVersion?(): number;
}

function resolveCandidates(): string[] {
  const cwd = process.cwd();
  const releaseDir = path.resolve(cwd, "target", "release");
  const debugDir = path.resolve(cwd, "target", "debug");
  const nativeDir = path.resolve(cwd, "native");
  
  // Also check relative to this module's location (for installed packages).
  // NOTE: use fileURLToPath for correct path decoding on all platforms.
  const modulePath = fileURLToPath(import.meta.url);
  const moduleDir = path.dirname(modulePath);

  const findPackageRoot = (startDir: string): string | null => {
    let dir = startDir;
    for (let i = 0; i < 6; i++) {
      const pkgPath = path.join(dir, "package.json");
      try {
        if (fs.existsSync(pkgPath) && fs.statSync(pkgPath).isFile()) {
          return dir;
        }
      } catch {
        // ignore
      }
      const parent = path.dirname(dir);
      if (!parent || parent === dir) break;
      dir = parent;
    }
    return null;
  };

  const packageRoot = findPackageRoot(moduleDir);
  const packageNativeDir = packageRoot ? path.join(packageRoot, "native") : null;
  const packageDistDir = packageRoot ? path.join(packageRoot, "dist") : null;

  const platformFile = process.platform === "win32"
    ? "ionify_core.dll"
    : process.platform === "darwin"
      ? "libionify_core.dylib"
      : "libionify_core.so";

  const candidates = [
    // Installed package location (preferred): dist/ionify_core.node (published via "files": ["dist"]).
    path.join(moduleDir, "ionify_core.node"),
    // Alternative installed layouts (fallback):
    // Prefer `native/` when present (repo/dev layouts) so local rebuilds are picked up even if an old `dist/` exists.
    ...(packageNativeDir ? [path.join(packageNativeDir, "ionify_core.node")] : []),
    ...(packageDistDir ? [path.join(packageDistDir, "ionify_core.node")] : []),
    ...(packageRoot ? [path.join(packageRoot, "ionify_core.node")] : []),
    // Development locations
    path.join(nativeDir, "ionify_core.node"),
    path.join(releaseDir, "ionify_core.node"),
    path.join(releaseDir, platformFile),
    path.join(debugDir, "ionify_core.node"),
    path.join(debugDir, platformFile),
  ];

  return candidates.filter((candidate) => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

let nativeBinding: NativeBinding | null = null;

(() => {
  const require = createRequire(import.meta.url);
  for (const candidate of resolveCandidates()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(candidate) as NativeBinding;
      if (mod) {
        nativeBinding = mod;
        break;
      }
    } catch {
      // try next candidate
    }
  }
})();

export const native = nativeBinding;

export function getDepsOptimizerOutputVersion(): number {
  // 0 is not a real optimizer output version, so a missing native binding causes
  // all cache lookups to miss rather than silently reusing stale artifacts.
  return nativeBinding?.depsOptimizerOutputVersion?.() ?? 0;
}

function shouldUseSwcOnly(): boolean {
  return (process.env.IONIFY_PARSER ?? "").toLowerCase() === "swc";
}

export function tryParseImports(source: string, filename?: string): string[] | null {
  if (!nativeBinding?.parseImports) return null;
  if (shouldUseSwcOnly()) return null;
  try {
    const result = nativeBinding.parseImports(source, filename);
    return Array.isArray(result) ? result : null;
  } catch {
    return null;
  }
}

export function tryParseModuleMetadata(
  source: string,
  filename?: string,
): { imports: string[]; hash: string } | null {
  if (!nativeBinding?.parseModuleMetadata) return null;
  if (shouldUseSwcOnly()) return null;
  try {
    const result = nativeBinding.parseModuleMetadata(source, filename);
    if (
      result &&
      Array.isArray((result as any).imports) &&
      typeof (result as any).hash === "string"
    ) {
      return { imports: result.imports, hash: result.hash };
    }
  } catch {
    // ignore native metadata errors; caller can fall back
  }
  return null;
}

export function getParserCacheStats(): { hits: number; misses: number } | null {
  if (!nativeBinding?.parserCacheStats) return null;
  try {
    const stats = nativeBinding.parserCacheStats();
    if (
      stats &&
      typeof (stats as any).hits === "number" &&
      typeof (stats as any).misses === "number"
    ) {
      return { hits: stats.hits, misses: stats.misses };
    }
  } catch {
    // ignore
  }
  return null;
}

type TransformOptions = {
  filename: string;
  jsx?: boolean;
  typescript?: boolean;
  react_refresh?: boolean;
};

export function tryNativeTransform(mode: "oxc" | "swc" | "hybrid", code: string, options: TransformOptions): { code: string; map?: string | null } | null {
  if (!nativeBinding) return null;
  const wantsOxc = mode === "oxc" || mode === "hybrid";
  const wantsSwc = mode === "swc" || mode === "hybrid";

  if (wantsOxc && nativeBinding.parseAndTransformOxc) {
    try {
      return nativeBinding.parseAndTransformOxc(code, options);
    } catch (err) {
      if (mode === "oxc") throw err;
    }
  }

  if (wantsSwc && nativeBinding.parseAndTransformSwc) {
    try {
      return nativeBinding.parseAndTransformSwc(code, options);
    } catch (err) {
      if (mode === "swc") throw err;
    }
  }

  return null;
}

type EnsureNativeGraphOptions = {
  retryMs?: number;
  retryIntervalMs?: number;
};

function isGraphLockError(err: unknown): boolean {
  const message = String(err);
  return /could not acquire lock|Resource temporarily unavailable|WouldBlock|database is locked|lock/i.test(message);
}

function sleepSync(ms: number): void {
  if (ms <= 0) return;
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

export function ensureNativeGraph(graphPath?: string, version?: string, options: EnsureNativeGraphOptions = {}): boolean {
  if (!nativeBinding?.graphInit) return false;
  const retryMs = Math.max(0, Math.floor(options.retryMs ?? 0));
  const retryIntervalMs = Math.max(10, Math.floor(options.retryIntervalMs ?? 50));
  const deadline = retryMs > 0 ? Date.now() + retryMs : 0;
  let attempts = 0;
  let lastErr: unknown = null;

  try {
    while (true) {
      attempts += 1;
      try {
        nativeBinding.graphInit(graphPath, version);
        return true;
      } catch (err) {
        lastErr = err;
        if (retryMs <= 0 || !isGraphLockError(err) || Date.now() >= deadline) {
          break;
        }
        sleepSync(Math.min(retryIntervalMs, Math.max(0, deadline - Date.now())));
      }
    }
  } catch (err) {
    lastErr = err;
  }

  const attemptNote = attempts > 1 ? ` after ${attempts} attempts` : "";
  console.error(`[Native] Failed to initialize graph${attemptNote}: ${lastErr}`);
  // ignore initialization errors; JS fallback will handle persistence
  return false;
}

type ConfigHashInput = {
  entry?: string[] | string | null;
  parserMode?: string;
  minifier?: string;
  treeshake?: boolean | object;
  scopeHoist?: boolean | object;
  plugins?: string[];
  resolveOptions?: unknown;
  cssOptions?: unknown;
  assetOptions?: unknown;
  runtimeContracts?: Record<string, unknown> | null;
};

function normalizeValue(value: any): any {
  if (value === null || value === undefined) return null;
  if (typeof value === "function") return "[function]";
  if (Array.isArray(value)) return value.map((v) => normalizeValue(v));
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, normalizeValue(v)] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries);
  }
  return value;
}

/**
 * Computes deterministic version hash for graph/cache invalidation.
 *
 * This hash encompasses ALL build-affecting configuration options.
 * Any change to inputs → different hash → automatic cache invalidation.
 *
 * Delegates to shared canonicalization logic in src/core/version.ts to ensure
 * dev and build commands compute identical hashes from the same config.
 *
 * Used by:
 * - Graph versioned sled trees (graph.db/v{hash})
 * - AST cache validation (version field)
 * - Transform cache partitioning
 * - CAS directory structure (.ionify/cas/<version>/)
 *
 * @example
 * const hash = computeGraphVersion({
 *   parserMode: "oxc",
 *   minifier: "oxc",
 *   plugins: ["@ionify/react"],
 *   cssOptions: { modules: true }
 * });
 * // → "a1b2c3d4e5f6g7h8"
 */
export function computeGraphVersion(inputs: ConfigHashInput): string {
  // Use shared canonicalization and hashing from version.ts
  const canonical = computeCanonicalVersionInputs(inputs as any);
  return computeVersionHash(canonical);
}

/**
 * Bundle a single node_modules file using the native bundler.
 * Returns the bundled ESM code or null if native bundler is unavailable.
 */
export function tryBundleNodeModule(filePath: string, code: string): string | null {
  if (!nativeBinding?.plannerPlanBuild || !nativeBinding?.buildChunks) {
    return null;
  }

  try {
    // Use the native planner to create a proper BuildPlan for this single entry
    const plan = nativeBinding.plannerPlanBuild([filePath]);
    
    if (!plan || !plan.chunks || plan.chunks.length === 0) {
      return null;
    }

    const artifacts = nativeBinding.buildChunks(plan);
    if (artifacts && artifacts.length > 0 && artifacts[0].code) {
      return artifacts[0].code;
    }
  } catch (error) {
    // Bundling failed, return null to fall back to JS-side handling
    console.warn(`[Ionify] Native bundler failed for ${filePath}:`, error);
  }

  return null;
}
