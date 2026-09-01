import type { BuildPlan } from "../types/plan";
import type { IonModule } from "../core/ir";
import { computeVersionHash, computeCanonicalVersionInputs } from "../core/version";
import { loadNativeBinding } from "./native-loader";

export interface NativeGraphNode {
  id: string;
  hash: string | null;
  deps: string[];
  dynamicDeps: string[];
  runtimeLinks?: Array<{ specifier: string; targetId: string; isDynamic: boolean }>;
  kind: string;
  config_hash?: string | null;
  origin?: "app" | "dep";
  format?: "esm" | "cjs";
  runtimeDemandHash?: string | null;
}

export interface NativeGraphRecordBatchNode {
  id: string;
  hash: string | null;
  deps: string[];
  dynamicDeps?: string[];
  runtimeLinks?: Array<{ specifier: string; targetId: string; isDynamic: boolean }>;
  kind?: string;
  configHash?: string | null;
  runtimeDemandHash?: string | null;
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
  incrementalChunkIds?: string[];
  incrementalOnly?: boolean;
  /** Opaque consume-once context issued by native Planner. */
  plannerPublicationContext?: number;
}

export type NativeRuntimeDemandFact = {
  importerPath: string;
  specifier: string;
  usedExports: string[];
  hasNamespace: boolean;
  hasExportStar: boolean;
  isDynamic: boolean;
};

/**
 * C2: Parser-owned runtime demand observed in emitted bytes B. Distinct from
 * NativeRuntimeDemandFact — no `importerPath` (that is caller context / a graph
 * edge-framing, not a parse fact).
 */
export type NativeEmittedRuntimeDemand = {
  specifier: string;
  usedExports: string[];
  hasNamespace: boolean;
  hasExportStar: boolean;
  isDynamic: boolean;
};

/** C2: Parser-owned runtime syntax facts derived from already-final emitted bytes B. */
export type NativeEmittedRuntimeFacts = {
  staticSpecifiers: string[];
  dynamicSpecifiers: string[];
  demands: NativeEmittedRuntimeDemand[];
};

/**
 * C3-a: the canonical derivation node output — final emitted bytes B, the guard-3
 * source map (present only when Define left the bytes unchanged), and the Parser(B)
 * runtime facts. Composition of the three frozen authorities (Transform → Define →
 * Parser); no graph/DPL/CAS/materialization.
 */
export type NativeCanonicalObservation = {
  code: string;
  map?: string | null;
  staticSpecifiers: string[];
  dynamicSpecifiers: string[];
  demands: NativeEmittedRuntimeDemand[];
};

/**
 * C3-b: the minimum generation transport to publish BOTH frozen Transform material
 * projections without a second Transform — base (sourceHash, codeA, mapA) + define
 * (codeB) — plus Parser(B) facts. `configHash`/`defineHash` are supplied by the
 * wave/build context, not duplicated here.
 */
export type NativeCanonicalGeneration = {
  sourceHash: string;
  codeA: string;
  mapA?: string | null;
  codeB: string;
  staticSpecifiers: string[];
  dynamicSpecifiers: string[];
  demands: NativeEmittedRuntimeDemand[];
};

/** C3-b: one per-module generation emitted by a scheduler wave. */
export type NativeWaveGeneration = {
  id: string;
  filePath: string;
  sourceHash: string;
  codeA: string;
  mapA?: string | null;
  codeB: string;
  staticSpecifiers: string[];
  dynamicSpecifiers: string[];
  /**
   * Complete Parser(B) demand facts (importerPath = filePath). Graph consumes the
   * specifier-edge projection; DPL consumes this demand projection — one observation.
   */
  demands: NativeEmittedRuntimeDemand[];
  /**
   * A per-wave PROJECTION of the authoritative resolver's classification (not a new
   * authority fact, never persisted): specifiers classified as non-app dependency
   * targets eligible for DPL admission (do not resolve to an app-source path).
   * Alias/relative → local app edges, excluded. DPL demand = `demands[]` filtered to
   * these; no bare-syntax inference; the scheduler never owns DPL authority.
   */
  depSpecifiers: string[];
  /**
   * C3-c Phase A: resolved canonical target paths of this module's dependency boundaries
   * (Resolver Fact A). Phase C joins these with DPL depStops identity to build dep-leaf
   * records — no re-resolution. Empty for a bare dep not yet resolvable (absent until DPL).
   */
  depBoundaryTargets: string[];
  /**
   * C3-c: the exact Graph node record for this module (Parser(B) observation), built
   * natively by the same classification the legacy `parse_graph_build_file` uses. TS
   * records it via `graphRecordBatch`; Graph admits. Empty recipe (B==A) ⇒ identical
   * to the legacy record.
   */
  record: NativeGraphRecordBatchNode;
  /**
   * Dep-leaf stop nodes (`kind:"dep"`) reached on this module's frontier — the exact
   * `depStops` artifact identity (id + pre-built DPL artifact hash). Dedup by id across
   * the wave before recording; each record for a given id is identical.
   */
  depLeafRecords: NativeGraphRecordBatchNode[];
};

export type NativeRuntimeMutationResult = {
  id: string;
  filePath?: string;
  file_path?: string;
  sourceHash?: string;
  source_hash?: string;
  code: string;
  map?: string | null;
  staticSpecifiers?: string[];
  static_specifiers?: string[];
  dynamicSpecifiers?: string[];
  dynamic_specifiers?: string[];
  runtimeDemands?: NativeRuntimeDemandFact[];
  runtime_demands?: NativeRuntimeDemandFact[];
  error?: string | null;
};

export type NativeDplPublicationEdge = {
  importerPath: string;
  specifier: string;
  entryPath: string;
  outFile: string;
  artifactPath: string;
  artifactHash: string;
  isDynamic: boolean;
};

export type NativeGraphStagedMutationRecord = {
  id: string;
  filePath: string;
  previousHash: string;
  hash: string;
  deps: string[];
  dynamicDeps: string[];
  kind: string;
  preserveEdges: boolean;
  runtimeDemandHash?: string | null;
};

export type NativePlannerCanonicalRefreshResult = {
  plan: BuildPlan;
  graphRecords: NativeGraphStagedMutationRecord[];
  affectedChunkIds: string[];
};

export type NativePlannerCanonicalModuleUpdate = {
  id: string;
  hash?: string | null;
  runtimeDemandHash?: string | null;
  runtimeMutationVerified: boolean;
  runtimeLinks?: BuildPlan["chunks"][number]["modules"][number]["runtimeLinks"];
};

export type NativePlannerCanonicalRefreshDeltaResult = {
  moduleUpdates: NativePlannerCanonicalModuleUpdate[];
  graphRecords: NativeGraphStagedMutationRecord[];
  affectedChunkIds: string[];
  /** Opaque consume-once native Planner publication context. */
  publicationContext: number;
};

export interface NativeBinding {
  parseImports(source: string, filename?: string): string[];
  parseModuleMetadata?(source: string, filename?: string): { imports: string[]; hash: string };
  parseModuleIr?(id: string, source: string, mode?: string): IonModule;
  parserCacheStats?(): { hits: number; misses: number };
  cacheHash?(data: Buffer | Uint8Array): string;
  cacheHashPath?(path: string): string;
  /**
   * Canonical Define code-rewrite (the single authoritative implementation).
   * `replacements` are pre-sorted longest-first and value-formatted by the TS
   * config layer; `importMetaEnvLiteral` is the `import.meta.env` object literal
   * when defined. Returns the rewritten code.
   */
  applyDefineReplacements?(
    code: string,
    replacements: Array<{ key: string; replacement: string; isMember: boolean }>,
    importMetaEnvLiteral?: string,
  ): string;
  depsStoreHash(
    configHash: string,
    lockfileContents: Buffer | null,
    nodeEnv: string | null,
    sourcemap: boolean,
    bundleEsm: boolean,
    sharedChunks: string,
    outputVersion: number,
  ): string;
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
  nativeRuntimeMutationBatch?(
    jobs: Array<{ id: string; filePath: string; ext: string; code: string }>,
    parserMode?: "oxc" | "swc" | "hybrid" | string | null,
  ): NativeRuntimeMutationResult[];
  /**
   * C2: authoritative Parser primitive over ALREADY-FINAL emitted bytes B.
   * `bytes` is the sole observed material; `parserContext.filePath` is context
   * only (dialect + error label), never re-read. No Transform / Define / graph
   * mutation / resolution / CAS / DPL. Fails closed on invalid syntax.
   */
  parseEmittedRuntimeFacts?(
    bytes: string,
    parserContext?: { filePath?: string | null } | null,
  ): NativeEmittedRuntimeFacts;
  /**
   * C3-a: canonical derivation node — source → Transform(A) → Define(B) →
   * Parser(B). `replacements` is the C1 Define recipe (`[]` = no Define);
   * `parserMode` defaults to env / hybrid. Returns final bytes B, the guard-3 map,
   * and Parser(B) facts. Composition only — no graph/DPL/CAS/materialization.
   */
  canonicalModuleObservation?(
    source: string,
    filePath: string,
    parserMode?: string | null,
    replacements?: Array<{ key: string; replacement: string; isMember: boolean }>,
    importMetaEnvLiteral?: string | null,
  ): NativeCanonicalObservation;
  /** C3-b: full generation transport (A/mapA + B + Parser(B) + sourceHash) for one module. */
  canonicalGeneration?(
    source: string,
    filePath: string,
    parserMode?: string | null,
    replacements?: Array<{ key: string; replacement: string; isMember: boolean }>,
    importMetaEnvLiteral?: string | null,
  ): NativeCanonicalGeneration;
  /**
   * C3-b: native per-wave canonical closure scheduler (dormant; C3-c activates).
   * Orchestration only — not a Graph/DPL authority. Bounded outstanding = 1 wave:
   * `nextWave` requires the prior wave `ack`-ed.
   */
  canonicalSchedulerBegin?(
    entryPaths: string[],
    workspaceRoot: string,
    externalSpecifiers?: string[] | null,
    replacements?: Array<{ key: string; replacement: string; isMember: boolean }>,
    importMetaEnvLiteral?: string | null,
    parserMode?: string | null,
    /** C3-c passes production's pre-built dep-leaf boundary; empty in C3-b. */
    depStops?: Array<{ entryPath: string; artifactHash: string }> | null,
  ): number;
  canonicalSchedulerNextWave?(id: number): NativeWaveGeneration[];
  canonicalSchedulerAck?(id: number, ok: boolean): void;
  canonicalSchedulerEnd?(id: number): void;
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
  graphRefreshFromEntries?(
    entryPaths: string[],
    workspaceRoot: string,
    ionifyDir?: string | null,
    depStops?: Array<{ entryPath: string; artifactHash: string }> | null,
    externalSpecifiers?: string[] | null,
  ): {
    moduleCount: number;
    fingerprint: string;
  };
  graphRefreshFromRuntimeFacts?(
    facts: Array<{
      filePath: string;
      sourceHash: string;
      staticSpecifiers: string[];
      dynamicSpecifiers: string[];
      runtimeDemands: NativeRuntimeDemandFact[];
    }>,
    workspaceRoot: string,
    ionifyDir?: string | null,
    depStops?: Array<{ entryPath: string; artifactHash: string }> | null,
    externalSpecifiers?: string[] | null,
  ): {
    moduleCount: number;
    fingerprint: string;
  };
  graphStageCanonicalMutations?(
    graphPath: string,
    graphVersion: string,
    records: NativeGraphStagedMutationRecord[],
  ): number;
  graphGet(id: string): NativeGraphNode | undefined | null;
  graphRemove(id: string): void;
  graphLoad(): NativeGraphNode[];
  graphLoadMap?(): Record<string, NativeGraphNode>;
  graphFlush?(): void;
  graphDependents?(target: string): string[];
  graphCollectAffected?(targets: string[]): string[];
  graphStateFingerprint?(): string;
  planCacheFingerprint?(): string;
  planCacheTopologyFingerprint?(): string;
  plannerPlanBuild?(entries: string[]): BuildPlan;
  plannerRefreshPlanHashes?(plan: BuildPlan, expectedTopologyFingerprint: string): BuildPlan;
  plannerRefreshCanonicalPlan?(
    plan: BuildPlan,
    facts: Array<{
      filePath: string;
      sourceHash: string;
      staticSpecifiers: string[];
      dynamicSpecifiers: string[];
      runtimeDemands: NativeRuntimeDemandFact[];
    }>,
    publicationEdges: NativeDplPublicationEdge[],
    workspaceRoot: string,
    depsRoot: string,
    externalSpecifiers?: string[] | null,
  ): NativePlannerCanonicalRefreshResult;
  plannerRefreshCanonicalPlanDelta?(
    plan: BuildPlan,
    facts: Array<{
      filePath: string;
      sourceHash: string;
      staticSpecifiers: string[];
      dynamicSpecifiers: string[];
      runtimeDemands: NativeRuntimeDemandFact[];
    }>,
    publicationEdges: NativeDplPublicationEdge[],
    workspaceRoot: string,
    depsRoot: string,
    externalSpecifiers?: string[] | null,
  ): NativePlannerCanonicalRefreshDeltaResult;
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
  /**
   * A1/B.1 authority: the canonical local-source extension list + order (dotted,
   * e.g. ".ts"). The single source of truth every TS local-source resolver
   * consumes instead of defining its own array.
   */
  localSourceExtensions?(): string[];
  /**
   * G1-c (F13) authority: the logical:v2 stable dependency artifact file name
   * computed from resolver-supplied coordinates. The TS dev registry consumes
   * this instead of deriving names with its own fingerprint mirror.
   */
  stableDepArtifactFileName(
    entryPath: string,
    packageName: string,
    packageVersion?: string,
    subpath?: string,
  ): string;

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
    plan: BuildPlan | null,
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
    entries: Array<{ entryPath: string; depsHash: string; usedExports?: string[] | null }>,
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
    batchEntries: Array<{ entryPath: string; depsHash: string; usedExports?: string[] | null }>,
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
  depsActivePublications?(depsRoot: string): Array<{
    routeActive: boolean;
    entryPath: string;
    outFile: string;
    artifactHash: string;
    artifactTopology: "wrapper" | "esm-native" | "esm-native-slim" | string;
    artifactTopologyReason?: string | null;
    chunkGroup?: string | null;
    chunkFiles: string[];
    sharedImports: string[];
    publicationMembers: Array<{
      outFile: string;
      artifactHash: string;
      artifactTopology: "wrapper" | "esm-native" | "esm-native-slim" | string;
      exportAbi: {
        version: number;
        names: string[];
        hasDefault: boolean;
        uncertain: boolean;
        abiHash: string;
      };
      dependencyImportAbi: Array<{
        outFile: string;
        mode: string;
        names: string[];
        hasDefault: boolean;
        hasNamespace: boolean;
        hasSideEffect: boolean;
        hasExportStar: boolean;
        uncertain: boolean;
      }>;
    }>;
    dependencyImports: string[];
    packageGraphFiles: string[];
    nodeEnv: string;
    outputVersion: number;
    exportDemand: string[];
    exportAbi: {
      version: number;
      names: string[];
      hasDefault: boolean;
      uncertain: boolean;
      abiHash: string;
    };
    dependencyImportAbi: Array<{
      outFile: string;
      mode: string;
      names: string[];
      hasDefault: boolean;
      hasNamespace: boolean;
      hasSideEffect: boolean;
      hasExportStar: boolean;
      uncertain: boolean;
    }>;
    packageGraphFileAbi: Array<{
      outFile: string;
      exports: string[];
    }>;
  }>;
  depsRuntimeDemandCovered?(
    depsRoot: string,
    demands: Array<{
      importerPath: string;
      specifier: string;
      usedExports: string[];
      hasNamespace: boolean;
      hasExportStar: boolean;
      isDynamic: boolean;
    }>,
  ): {
    covered: boolean;
    checked: number;
    deferredDemands: number;
    activePublications: number;
    publicationEdges: NativeDplPublicationEdge[];
    reason?: string | null;
  };
  depsPublishVerifiedGeneration?(
    depsRoot: string,
    demands: Array<{
      importerPath: string;
      specifier: string;
      usedExports: string[];
      hasNamespace: boolean;
      hasExportStar: boolean;
      isDynamic: boolean;
    }>,
  ): {
    covered: boolean;
    checked: number;
    deferredDemands: number;
    activePublications: number;
    publicationEdges: NativeDplPublicationEdge[];
    reason?: string | null;
  };
  depsVerifiedGenerationCurrent?(depsRoot: string): boolean;
  depsPromoteArtifacts?(
    oldRoot: string,
    newRoot: string,
    newDepsHash: string,
    currentOutputVersion: number,
  ): { promoted: number; skipped: number };
  depsOptimizerTopologyProfile?(): {
    topologyDecisionTimeMs?: number;
    topologyProofValidationTimeMs?: number;
    topologyByteScanTimeMs?: number;
    esmNativeArtifactCount?: number;
    wrapperArtifactCount?: number;
    packageGraphBuildTimeMs?: number;
    packageGraphCacheHit?: number;
    packageGraphCacheMiss?: number;
  };
  depsOptimizerTopologyProfileReset?(): void;
}

const nativeBinding: NativeBinding | null = loadNativeBinding<NativeBinding>();

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
