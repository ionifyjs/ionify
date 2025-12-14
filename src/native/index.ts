import fs from "fs";
import path from "path";
import { createRequire } from "module";
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

export interface NativeBinding {
  parseImports(source: string, filename?: string): string[];
  parseModuleMetadata?(source: string, filename?: string): { imports: string[]; hash: string };
  parseModuleIr?(id: string, source: string, mode?: string): IonModule;
  parserCacheStats?(): { hits: number; misses: number };
  cacheHash?(data: Buffer | Uint8Array): string;
  cacheHashPath?(path: string): string;
  parseAndTransformOxc?(source: string, options: { filename: string; jsx?: boolean; typescript?: boolean; react_refresh?: boolean }): { code: string; map?: string | null };
  parseAndTransformSwc?(source: string, options: { filename: string; jsx?: boolean; typescript?: boolean; react_refresh?: boolean }): { code: string; map?: string | null };
  graphInit(path?: string, version?: string): void;
  graphRecord(id: string, hash: string | null, deps: string[], dynamicDeps?: string[], kind?: string, configHash?: string | null): boolean;
  graphGet(id: string): NativeGraphNode | undefined | null;
  graphRemove(id: string): void;
  graphLoad(): NativeGraphNode[];
  graphLoadMap?(): Record<string, NativeGraphNode>;
  graphFlush?(): void;
  graphDependents?(target: string): string[];
  graphCollectAffected?(targets: string[]): string[];
  plannerPlanBuild?(entries: string[]): BuildPlan;
  
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
  buildChunks?(plan: BuildPlan, casRoot?: string | null, versionHash?: string | null): {
    id: string;
    file_name?: string;
    code: string;
    map?: string | null;
    code_bytes?: number;
    map_bytes?: number;
    assets?: Array<{ source: string; fileName?: string; file_name?: string }>;
  }[];
}

function resolveCandidates(): string[] {
  const cwd = process.cwd();
  const releaseDir = path.resolve(cwd, "target", "release");
  const debugDir = path.resolve(cwd, "target", "debug");
  const nativeDir = path.resolve(cwd, "native");
  
  // Also check relative to this module's location (for installed packages)
  const moduleDir = path.dirname(new URL(import.meta.url).pathname);
  const packageNativeDir = path.resolve(moduleDir, "..", "native");
  const packageDistDir = path.resolve(moduleDir, "..");

  const platformFile = process.platform === "win32"
    ? "ionify_core.dll"
    : process.platform === "darwin"
      ? "libionify_core.dylib"
      : "libionify_core.so";

  const candidates = [
    // Installed package locations (checked first)
    path.join(packageDistDir, "ionify_core.node"),
    path.join(packageNativeDir, "ionify_core.node"),
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

export function ensureNativeGraph(graphPath?: string, version?: string) {
  if (!nativeBinding?.graphInit) return;
  try {
    nativeBinding.graphInit(graphPath, version);
  } catch (err) {
    console.error(`[Native] Failed to initialize graph: ${err}`);
    // ignore initialization errors; JS fallback will handle persistence
  }
}

type ConfigHashInput = {
  entry?: string[] | string | null;
  parserMode?: string;
  minifier?: string;
  treeshake?: boolean | object;
  scopeHoist?: boolean | object;
  plugins?: string[];
  cssOptions?: unknown;
  assetOptions?: unknown;
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
