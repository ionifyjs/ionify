/**
{
  "description": "Handles Ionify's production build command. Invokes Rust bundler, reads cached graph, and generates optimized bundles and manifest output.",
  "phase": 0,
  "todo": [
    "Implement buildCommand() entry.",
    "Load graph and cached module info.",
    "Invoke Rust bundler via napi bridge.",
    "Emit output files to /dist with manifest.json.",
    "Display build progress using spinner and logger."
  ]
}
*/

import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import zlib from "zlib";
import { logInfo, logError, logWarn } from "@cli/utils/logger";
import { loadIonifyConfig } from "@cli/utils/config";
import { readLockfile } from "@cli/utils/lockfile";
import { resolveMinifier, type MinifierChoice } from "@cli/utils/minifier";
import { resolveTreeshake } from "@cli/utils/treeshake";
import { native, computeGraphVersion, getDepsOptimizerOutputVersion, ensureNativeGraph } from "@native/index";
import { COMPRESSION_CAS_VERSION, getCasArtifactPath, getCompressionCasArtifactPath } from "@core/utils/cas";
import { isCssModuleLikePath } from "@core/utils/css-ext";
import { resolveScopeHoist } from "@cli/utils/scope-hoist";
import { resolveOptimizationLevel, getOptimizationPreset } from "@cli/utils/optimization-level";
import { resolveParser, applyParserEnv } from "@cli/utils/parser";
import {
  generateBuildPlan,
  admitCanonicalBuildPlanMutation,
  writeBuildManifest,
  emitChunks,
  writeAssetsManifest,
  type CanonicalBuildContext,
  type CanonicalDefineRecipe,
  type EmittedOutputInfo,
} from "@core/bundler";
import type { BuildPlan, ProofKind } from "../../types/plan";
import { TransformWorkerPool, type TransformJobResult } from "@core/worker/pool";
import { getCacheKey } from "@core/cache";
import {
  writeTransformArtifact,
  admitTransformArtifact,
  type TransformArtifactExpectation,
} from "@core/transform-artifact-proof";
import {
  materializeCanonicalGeneration,
  type CanonicalMaterializeContext,
} from "@core/canonical-materialize";
import { resolveWorkspace } from "@core/workspace";
import { loadEnv as loadIonifyEnv } from "@cli/utils/env";
import { applyDefineReplacements, buildDefineConfig, buildDefineRecipe, substituteEnvPlaceholders } from "@core/utils/define";
import { computeDefineSignature } from "@core/utils/define-signature";
import { WS_MODULE_PREFIX, fromWsModuleId, toWsModuleId } from "@core/module-id";
import { computeChunkGroupIdFromStableIds } from "@core/deps/vendor-pack-utils";
import { loadDepStopsFromManifest } from "@core/deps/dep-stops";
import { reconcilePackEntries, resolveChunkedPackEntries } from "@core/deps/feature-pack-planner";
import {
  buildCanonicalDepFileNameIndex,
  canonicalizeDepFileName,
  canonicalizeDepUsageIndex,
  collectRuntimeMutationFactsForFiles,
  scanDepEntryPaths,
  scanDepUsage,
  scanDepUsageFacts,
  usageIndexFromRuntimeDemands,
  type DplRuntimeDemandFact,
  type DepUsageIndex,
  type RuntimeSourceMutationFacts,
} from "@core/deps/usage";
import type { NativeDplPublicationEdge, NativeGraphRecordBatchNode } from "@native/index";
import {
  createProductionReadinessRecord,
  hashFileIfExists,
  isVerifiedProductionReadinessForPlan,
  readProductionReadinessRecord,
  writeProductionReadinessRecord,
  type ProductionReadinessCompressionState,
  type ProductionReadinessRecord,
} from "@core/production-readiness-authority";
import {
  getDepEntry,
  registerDepEntry,
  computeSubpathFromEntryPath,
} from "@core/deps/registry";
import { VendorPackV2IndexManager } from "@core/deps/vendor-pack-v2";
import { renderCssTokensModule } from "@core/loaders/css";
import {
  buildCssDemandAnalysis,
  computeCssDemandGraphContentStamp,
  refreshCssDemandGraphContentStamp,
  registerCssDemandGraphSourceFiles,
  requiresCssDemandGraphContentStamp,
} from "@core/loaders/css-demand";
import { isForbiddenFsPath } from "@core/utils/public-path";
import { computeDepsHash } from "@cli/utils/deps-hash";
import {
  PRODUCTION_PLAN_OUTPUT_VERSION,
  readProductionPublicationPlan,
  readProductionPublicationState,
  writeProductionBuildPlanProof,
  type ProductionPublicationIdentity,
} from "@core/production-artifact-publishing";
import {
  classifyImportSpecifiersForGraph,
  collectConfiguredExternalSpecifiers,
  isExternalGraphLeafId,
} from "@core/external-policy";
import { extractImports } from "@core/resolver";
import {
  FEDERATION_GRAPH_PREFIX,
  buildFederationConfigGraphNodes,
  buildFederationContainerBuildSpec,
  buildFederationBuildManifest,
  buildFederationManifestGraphNodes,
  collectFederationExposeEntryPaths,
  collectFederationRemoteImportBindings,
  rewriteFederationGraphEdgeIds,
  type FederationPersistedGraphNode,
} from "@core/federation";
import { Graph } from "@core/graph";
import { GRAPH_KIND_VIRTUAL, classifyStructuralGraphKind, isRuntimeGraphKind } from "@core/graph-kind";
import { resolveProductionBuildEntries } from "@core/build-entry-inference";
import { createProductionGraphVersionInputs } from "@core/production-build-identity";
import { resolveProductionChunkPolicy } from "@core/chunk-policy";

interface BuildOptions {
  outDir?: string;
  mode?: string;
  level?: number;
  /**
   * Phase 5-Cloud-EI-DX2 — `ionify optimize-all` short-circuit.
   *
   * When true, runBuildCommand stops immediately after the deps optimizer
   * pass writes `.verified` — it does NOT generate a build plan, run the
   * Rust bundler, emit `dist/`, or run the post-build compression phase.
   *
   * Used by the `optimize-all` command (and State A → "optimize-all" in the
   * push prompt) to produce a complete `.ionify/deps/<depsHash>/` snapshot
   * without paying for a full production build.
   */
  depsOnly?: boolean;
  /** PAP Phase A asks dependency preparation to return the exact Planner
   * mutation it admitted. Plain `optimize-all` remains DPL-only. */
  publicationContracts?: boolean;
}

export type BuildDependencyPreparation = {
  depsHash: string;
  canonicalPlan: BuildPlan | null;
};

const DEPS_OPTIMIZER_OUTPUT_VERSION = getDepsOptimizerOutputVersion();
const TOPOLOGY_PROOF_VERSION = 1;
const PACKAGE_GRAPH_VERSION = 5;

const topologyValidationProfile = {
  proofValidationTimeMs: 0,
  byteScanTimeMs: 0,
  packageGraphCacheHit: 0,
};

const depsMeasurementProfile = {
  cacheMode: "unknown",
  promoted: 0,
  promotionSkipped: 0,
  outputVersionMismatchSeen: false,
};

function isBuildProfileEnabled(): boolean {
  return process.env.IONIFY_BUNDLE_PROFILE === "1" || process.env.IONIFY_BUNDLE_PROFILE === "true";
}

function logBuildProfile(label: string, startedAt: number): void {
  if (!isBuildProfileEnabled()) return;
  logInfo(`[BuildProfile] ${label}_ms=${Date.now() - startedAt}`);
}

function logBuildProfileDuration(label: string, elapsedMs: number): void {
  if (!isBuildProfileEnabled()) return;
  logInfo(`[BuildProfile] ${label}_ms=${elapsedMs}`);
}

function logBuildProfileValue(label: string, value: number): void {
  if (!isBuildProfileEnabled()) return;
  logInfo(`[BuildProfile] ${label}=${value}`);
}

function logBuildProfileText(label: string, value: string): void {
  if (!isBuildProfileEnabled()) return;
  logInfo(`[BuildProfile] ${label}=${value}`);
}

type TransformCasProfile = {
  nativeJsTransformMs: number;
  nativeJsTransformJobs: number;
  nativeJsTransformReuseJobs: number;
  cssCompileWallMs: number;
  cssCompileTotalMs: number;
  cssPostcssConfigLoadMs: number;
  cssPostcssConfigWaitMs: number;
  cssPostcssConfigCacheHits: number;
  cssTailwindGraphSetupMs: number;
  cssPostcssProcessMs: number;
  cssPostcssPluginMs: number;
  cssTailwindPluginMs: number;
  cssAutoprefixerPluginMs: number;
  cssRtlcssPluginMs: number;
  cssOtherPostcssPluginMs: number;
  cssDependencyCollectionMs: number;
  cssImportDependencyDiscoveryMs: number;
  cssUrlDependencyDiscoveryMs: number;
  cssPipelineHashMs: number;
  cssDemandProofMs: number;
  cssWorkerJobs: number;
  cssGlobalCacheRestoreMs: number;
  cssGlobalCacheRestoreHit: number;
  cssGlobalCacheRestoreMiss: number;
  cssGlobalCacheWriteMs: number;
  cssGlobalCacheWriteFiles: number;
  workerTransformJobs: number;
  workerTransformMs: number;
  defineReplacementMs: number;
  defineReplacementCalls: number;
  artifactHashBookkeepingMs: number;
  artifactHashBookkeepingCalls: number;
  casMkdirMs: number;
  casMkdirCalls: number;
  casWriteMs: number;
  casWriteFiles: number;
  casWriteBytes: number;
  baseArtifactWriteMs: number;
  baseArtifactWriteFiles: number;
  baseArtifactWriteBytes: number;
  variantArtifactWriteMs: number;
  variantArtifactWriteFiles: number;
  variantArtifactWriteBytes: number;
  cssDemandExtractionMs: number;
  cssDemandFilesScanned: number;
  cssDemandCacheHit: number;
  cssDemandCacheMiss: number;
  cssDemandTokens: number;
  cssDemandProofWriteMs: number;
  cssTailwindGraphContentMs: number;
  cssTailwindGraphContentFiles: number;
  cssTailwindGraphContentPlugins: number;
  cssTailwindGraphContentOptimized: number;
  cssTailwindGraphContentFallbacks: number;
};

function createTransformCasProfile(): TransformCasProfile {
  return {
    nativeJsTransformMs: 0,
    nativeJsTransformJobs: 0,
    nativeJsTransformReuseJobs: 0,
    cssCompileWallMs: 0,
    cssCompileTotalMs: 0,
    cssPostcssConfigLoadMs: 0,
    cssPostcssConfigWaitMs: 0,
    cssPostcssConfigCacheHits: 0,
    cssTailwindGraphSetupMs: 0,
    cssPostcssProcessMs: 0,
    cssPostcssPluginMs: 0,
    cssTailwindPluginMs: 0,
    cssAutoprefixerPluginMs: 0,
    cssRtlcssPluginMs: 0,
    cssOtherPostcssPluginMs: 0,
    cssDependencyCollectionMs: 0,
    cssImportDependencyDiscoveryMs: 0,
    cssUrlDependencyDiscoveryMs: 0,
    cssPipelineHashMs: 0,
    cssDemandProofMs: 0,
    cssWorkerJobs: 0,
    cssGlobalCacheRestoreMs: 0,
    cssGlobalCacheRestoreHit: 0,
    cssGlobalCacheRestoreMiss: 0,
    cssGlobalCacheWriteMs: 0,
    cssGlobalCacheWriteFiles: 0,
    workerTransformJobs: 0,
    workerTransformMs: 0,
    defineReplacementMs: 0,
    defineReplacementCalls: 0,
    artifactHashBookkeepingMs: 0,
    artifactHashBookkeepingCalls: 0,
    casMkdirMs: 0,
    casMkdirCalls: 0,
    casWriteMs: 0,
    casWriteFiles: 0,
    casWriteBytes: 0,
    baseArtifactWriteMs: 0,
    baseArtifactWriteFiles: 0,
    baseArtifactWriteBytes: 0,
    variantArtifactWriteMs: 0,
    variantArtifactWriteFiles: 0,
    variantArtifactWriteBytes: 0,
    cssDemandExtractionMs: 0,
    cssDemandFilesScanned: 0,
    cssDemandCacheHit: 0,
    cssDemandCacheMiss: 0,
    cssDemandTokens: 0,
    cssDemandProofWriteMs: 0,
    cssTailwindGraphContentMs: 0,
    cssTailwindGraphContentFiles: 0,
    cssTailwindGraphContentPlugins: 0,
    cssTailwindGraphContentOptimized: 0,
    cssTailwindGraphContentFallbacks: 0,
  };
}

function profileElapsed<T>(profile: TransformCasProfile, key: keyof TransformCasProfile, fn: () => T): T {
  const started = Date.now();
  try {
    return fn();
  } finally {
    profile[key] = (profile[key] as number) + (Date.now() - started);
  }
}

function profileCasMkdir(profile: TransformCasProfile, dir: string): void {
  const started = Date.now();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } finally {
    profile.casMkdirMs += Date.now() - started;
    profile.casMkdirCalls += 1;
  }
}

function byteLengthOfWriteData(data: string | NodeJS.ArrayBufferView): number {
  if (typeof data === "string") return Buffer.byteLength(data, "utf8");
  return data.byteLength;
}

function profileCasWrite(
  profile: TransformCasProfile,
  filePath: string,
  data: string | NodeJS.ArrayBufferView,
  kind: "base" | "variant",
): void {
  const started = Date.now();
  try {
    fs.writeFileSync(filePath, data as any, "utf8");
  } finally {
    const elapsed = Date.now() - started;
    const bytes = byteLengthOfWriteData(data);
    profile.casWriteMs += elapsed;
    profile.casWriteFiles += 1;
    profile.casWriteBytes += bytes;
    if (kind === "base") {
      profile.baseArtifactWriteMs += elapsed;
      profile.baseArtifactWriteFiles += 1;
      profile.baseArtifactWriteBytes += bytes;
    } else {
      profile.variantArtifactWriteMs += elapsed;
      profile.variantArtifactWriteFiles += 1;
      profile.variantArtifactWriteBytes += bytes;
    }
  }
}

function profileJsonCasWrite(
  profile: TransformCasProfile,
  filePath: string,
  data: unknown,
  kind: "base" | "variant",
): void {
  const bytes = Buffer.byteLength(JSON.stringify(data, null, 2) + "\n", "utf8");
  const started = Date.now();
  try {
    writeJsonFile(filePath, data);
  } finally {
    const elapsed = Date.now() - started;
    profile.casWriteMs += elapsed;
    profile.casWriteFiles += 1;
    profile.casWriteBytes += bytes;
    if (kind === "base") {
      profile.baseArtifactWriteMs += elapsed;
      profile.baseArtifactWriteFiles += 1;
      profile.baseArtifactWriteBytes += bytes;
    } else {
      profile.variantArtifactWriteMs += elapsed;
      profile.variantArtifactWriteFiles += 1;
      profile.variantArtifactWriteBytes += bytes;
    }
  }
}

function logTransformCasProfile(profile: TransformCasProfile): void {
  if (!isBuildProfileEnabled()) return;
  logInfo(
    `[BuildProfile][transformCas] nativeJsTransform_ms=${profile.nativeJsTransformMs} jobs=${profile.nativeJsTransformJobs} reusedMutationFacts=${profile.nativeJsTransformReuseJobs}`,
  );
  logInfo(
    `[BuildProfile][transformCas] cssCompileWall_ms=${profile.cssCompileWallMs.toFixed(2)} cssJobs=${profile.cssWorkerJobs} workerTransform_ms=${profile.workerTransformMs.toFixed(2)} workerJobs=${profile.workerTransformJobs}`,
  );
  logInfo(
    `[BuildProfile][cssCompile] total_ms=${profile.cssCompileTotalMs.toFixed(2)} postcssConfigLoad_ms=${profile.cssPostcssConfigLoadMs.toFixed(2)} postcssConfigWait_ms=${profile.cssPostcssConfigWaitMs.toFixed(2)} postcssConfigCacheHits=${profile.cssPostcssConfigCacheHits} tailwindGraphSetup_ms=${profile.cssTailwindGraphSetupMs.toFixed(2)} postcssProcess_ms=${profile.cssPostcssProcessMs.toFixed(2)} pluginTotal_ms=${profile.cssPostcssPluginMs.toFixed(2)}`,
  );
  logInfo(
    `[BuildProfile][cssCompile][plugins] tailwind_ms=${profile.cssTailwindPluginMs.toFixed(2)} autoprefixer_ms=${profile.cssAutoprefixerPluginMs.toFixed(2)} rtlcss_ms=${profile.cssRtlcssPluginMs.toFixed(2)} other_ms=${profile.cssOtherPostcssPluginMs.toFixed(2)}`,
  );
  logInfo(
    `[BuildProfile][cssCompile][proof] dependencyCollection_ms=${profile.cssDependencyCollectionMs.toFixed(2)} importDiscovery_ms=${profile.cssImportDependencyDiscoveryMs.toFixed(2)} urlDiscovery_ms=${profile.cssUrlDependencyDiscoveryMs.toFixed(2)} pipelineHash_ms=${profile.cssPipelineHashMs.toFixed(2)} demandProof_ms=${profile.cssDemandProofMs.toFixed(2)}`,
  );
  logInfo(
    `[BuildProfile][cssGlobalCache] restore_ms=${profile.cssGlobalCacheRestoreMs.toFixed(2)} hit=${profile.cssGlobalCacheRestoreHit} miss=${profile.cssGlobalCacheRestoreMiss} write_ms=${profile.cssGlobalCacheWriteMs.toFixed(2)} files=${profile.cssGlobalCacheWriteFiles}`,
  );
  logInfo(
    `[BuildProfile][transformCas] defineReplacement_ms=${profile.defineReplacementMs} calls=${profile.defineReplacementCalls}`,
  );
  logInfo(
    `[BuildProfile][transformCas] artifactHashBookkeeping_ms=${profile.artifactHashBookkeepingMs} calls=${profile.artifactHashBookkeepingCalls}`,
  );
  logInfo(
    `[BuildProfile][transformCas] casMkdir_ms=${profile.casMkdirMs} calls=${profile.casMkdirCalls}`,
  );
  logInfo(
    `[BuildProfile][transformCas] casWrite_ms=${profile.casWriteMs} files=${profile.casWriteFiles} bytes=${profile.casWriteBytes}`,
  );
  logInfo(
    `[BuildProfile][transformCas] baseArtifactWrite_ms=${profile.baseArtifactWriteMs} files=${profile.baseArtifactWriteFiles} bytes=${profile.baseArtifactWriteBytes}`,
  );
  logInfo(
    `[BuildProfile][transformCas] variantArtifactWrite_ms=${profile.variantArtifactWriteMs} files=${profile.variantArtifactWriteFiles} bytes=${profile.variantArtifactWriteBytes}`,
  );
  logInfo(
    `[BuildProfile][cssDemand] extraction_ms=${profile.cssDemandExtractionMs} filesScanned=${profile.cssDemandFilesScanned} cacheHit=${profile.cssDemandCacheHit} cacheMiss=${profile.cssDemandCacheMiss} tokens=${profile.cssDemandTokens} proofWrite_ms=${profile.cssDemandProofWriteMs}`,
  );
  logInfo(
    `[BuildProfile][cssTailwindGraphContent] override_ms=${profile.cssTailwindGraphContentMs} files=${profile.cssTailwindGraphContentFiles} plugins=${profile.cssTailwindGraphContentPlugins} optimized=${profile.cssTailwindGraphContentOptimized} fallbacks=${profile.cssTailwindGraphContentFallbacks}`,
  );
}

function addCssCompileProfile(profile: TransformCasProfile, cssProfile: unknown): void {
  if (!cssProfile || typeof cssProfile !== "object") return;
  const p = cssProfile as Record<string, unknown>;
  profile.cssCompileTotalMs += Number(p.totalMs ?? 0);
  profile.cssPostcssConfigLoadMs += Number(p.postcssConfigLoadMs ?? 0);
  profile.cssPostcssConfigWaitMs += Number(p.postcssConfigWaitMs ?? 0);
  if (p.postcssConfigCacheHit === true) profile.cssPostcssConfigCacheHits += 1;
  profile.cssTailwindGraphSetupMs += Number(p.tailwindGraphContentMs ?? 0);
  profile.cssPostcssProcessMs += Number(p.postcssProcessMs ?? 0);
  profile.cssPostcssPluginMs += Number(p.postcssPluginMs ?? 0);
  profile.cssTailwindPluginMs += Number(p.tailwindPluginMs ?? 0);
  profile.cssAutoprefixerPluginMs += Number(p.autoprefixerPluginMs ?? 0);
  profile.cssRtlcssPluginMs += Number(p.rtlcssPluginMs ?? 0);
  profile.cssOtherPostcssPluginMs += Number(p.otherPostcssPluginMs ?? 0);
  profile.cssDependencyCollectionMs += Number(p.dependencyCollectionMs ?? 0);
  profile.cssImportDependencyDiscoveryMs += Number(p.importDependencyDiscoveryMs ?? 0);
  profile.cssUrlDependencyDiscoveryMs += Number(p.urlDependencyDiscoveryMs ?? 0);
  profile.cssPipelineHashMs += Number(p.pipelineHashMs ?? 0);
  profile.cssDemandProofMs += Number(p.cssDemandProofMs ?? 0);
}

function cloneWorkerSafeCssOptions(value: unknown): unknown {
  if (value == null) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

function resetTopologyValidationProfile(): void {
  topologyValidationProfile.proofValidationTimeMs = 0;
  topologyValidationProfile.byteScanTimeMs = 0;
  topologyValidationProfile.packageGraphCacheHit = 0;
  depsMeasurementProfile.cacheMode = "unknown";
  depsMeasurementProfile.promoted = 0;
  depsMeasurementProfile.promotionSkipped = 0;
  depsMeasurementProfile.outputVersionMismatchSeen = false;
  native?.depsOptimizerTopologyProfileReset?.();
}

function logTopologyValidationProfile(depsRoot: string): void {
  if (!isBuildProfileEnabled()) return;
  const nativeProfile = native?.depsOptimizerTopologyProfile?.();
  const manifestCounts = countDepsManifestTopologies(depsRoot);
  logBuildProfileDuration("topologyDecisionTime", nativeProfile?.topologyDecisionTimeMs ?? 0);
  logBuildProfileDuration(
    "esmNativeSlimEmissionTime",
    nativeProfile?.esmNativeSlimEmissionTimeMs ?? nativeProfile?.esm_native_slim_emission_time_ms ?? 0,
  );
  logBuildProfileDuration(
    "esmNativeSlimDceTime",
    nativeProfile?.esmNativeSlimDceTimeMs ?? nativeProfile?.esm_native_slim_dce_time_ms ?? 0,
  );
  logBuildProfileValue(
    "esmNativeSlimDceRemovedDeclarations",
    nativeProfile?.esmNativeSlimDceRemovedDeclarations ??
      nativeProfile?.esm_native_slim_dce_removed_declarations ??
      0,
  );
  logBuildProfileValue(
    "esmNativeSlimDceRemovedPureExpressions",
    nativeProfile?.esmNativeSlimDceRemovedPureExpressions ??
      nativeProfile?.esm_native_slim_dce_removed_pure_expressions ??
      0,
  );
  logBuildProfileValue(
    "esmNativeSlimDceFoldedBranches",
    nativeProfile?.esmNativeSlimDceFoldedBranches ?? nativeProfile?.esm_native_slim_dce_folded_branches ?? 0,
  );
  logBuildProfileDuration(
    "topologyProofValidationTime",
    topologyValidationProfile.proofValidationTimeMs + (nativeProfile?.topologyProofValidationTimeMs ?? 0),
  );
  logBuildProfileDuration(
    "topologyByteScanTime",
    topologyValidationProfile.byteScanTimeMs + (nativeProfile?.topologyByteScanTimeMs ?? 0),
  );
  logBuildProfileValue(
    "esmNativeArtifactCount",
    (manifestCounts.esmNative + manifestCounts.esmNativeSlim) || nativeProfile?.esmNativeArtifactCount || 0,
  );
  logBuildProfileValue("esmNativeSlimArtifactCount", manifestCounts.esmNativeSlim);
  logBuildProfileValue(
    "wrapperArtifactCount",
    manifestCounts.wrapper || nativeProfile?.wrapperArtifactCount || 0,
  );
  logBuildProfileDuration("packageGraphBuildTime", nativeProfile?.packageGraphBuildTimeMs ?? 0);
  logBuildProfileValue(
    "packageGraphCacheHit",
    topologyValidationProfile.packageGraphCacheHit + (nativeProfile?.packageGraphCacheHit ?? 0),
  );
  logBuildProfileValue("packageGraphCacheMiss", nativeProfile?.packageGraphCacheMiss ?? 0);
  logBuildProfileText("depsCacheMode", depsMeasurementProfile.cacheMode);
  logBuildProfileValue("depsPromotedArtifactCount", depsMeasurementProfile.promoted);
  logBuildProfileValue("depsPromotionSkippedCount", depsMeasurementProfile.promotionSkipped);
  logBuildProfileValue("depsOutputVersionMismatchSeen", depsMeasurementProfile.outputVersionMismatchSeen ? 1 : 0);
}

function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, data: unknown): void {
  try {
    const next = JSON.stringify(data, null, 2) + "\n";
    try {
      if (fs.existsSync(filePath)) {
        const prev = fs.readFileSync(filePath, "utf8");
        if (prev === next) return;
      }
    } catch {
      // ignore read errors; fall through to write
    }
    fs.writeFileSync(filePath, next, "utf8");
  } catch {
    // ignore write errors; production packs are best-effort metadata
  }
}

async function writeTextFileIfChanged(filePath: string, contents: string): Promise<void> {
  const nextBytes = Buffer.byteLength(contents, "utf8");
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.isFile() && stat.size === nextBytes) {
      const existing = await fs.promises.readFile(filePath, "utf8");
      if (existing === contents) return;
    }
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, contents, "utf8");
}

function syncFederationGraphNodes(graph: Graph, nodes: FederationPersistedGraphNode[]): void {
  const nextIds = new Set(nodes.map((node) => node.id));
  for (const existingId of graph.listNodeIdsByPrefix(FEDERATION_GRAPH_PREFIX)) {
    if (!nextIds.has(existingId)) {
      graph.removeNodeById(existingId);
    }
  }
  for (const node of nodes) {
    graph.recordNodeById(node.id, node.hash, node.deps, node.dynamicDeps ?? [], node.kind);
  }
}

function mergeFederationGraphNodes(...groups: FederationPersistedGraphNode[][]): FederationPersistedGraphNode[] {
  const merged = new Map<string, FederationPersistedGraphNode>();
  for (const group of groups) {
    for (const node of group) merged.set(node.id, node);
  }
  return Array.from(merged.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function resolvePublicDir(rootDir: string, value: unknown): string | null {
  if (value === false) return null;
  const dir = typeof value === "string" && value.trim().length > 0 ? value.trim() : "public";
  return path.isAbsolute(dir) ? dir : path.resolve(rootDir, dir);
}

type CopiedAssetEntry = {
  file: string;
  bytes: number;
  hash: string;
};

type PublicDirCopyResult = {
  assets: CopiedAssetEntry[];
  copied: CopiedAssetEntry[];
  conflicts: string[];
  reservedConflicts: string[];
};

const ENGINE_OWNED_PUBLIC_OUTPUTS = new Set(["index.html", "manifest.json", "manifest.assets.json", "build.stats.json"]);

async function copyPublicDirToOutDir(
  publicDirAbs: string | null,
  outDirAbs: string,
  previousPublicAssets: CopiedAssetEntry[] = [],
): Promise<PublicDirCopyResult> {
  if (!publicDirAbs) return { assets: [], copied: [], conflicts: [], reservedConflicts: [] };
  const srcRoot = path.resolve(publicDirAbs);
  const destRoot = path.resolve(outDirAbs);
  const previousByFile = new Map(previousPublicAssets.map((asset) => [asset.file, asset]));

  let srcStat: fs.Stats | null = null;
  try {
    srcStat = fs.statSync(srcRoot);
  } catch {
    return { assets: [], copied: [], conflicts: [], reservedConflicts: [] };
  }
  if (!srcStat.isDirectory()) return { assets: [], copied: [], conflicts: [], reservedConflicts: [] };

  const currentEntries: CopiedAssetEntry[] = [];
  const copiedEntries: CopiedAssetEntry[] = [];
  const conflicts: string[] = [];
  const reservedConflicts: string[] = [];

  const queue: string[] = [srcRoot];
  while (queue.length) {
    const dir = queue.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const srcPath = path.join(dir, entry.name);
      if (isForbiddenFsPath(srcPath)) continue;
      if (entry.isDirectory()) {
        queue.push(srcPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const rel = path.relative(srcRoot, srcPath);
      if (!rel || rel.startsWith("..")) continue;
      const relPosix = rel.replace(/\\+/g, "/");
      const destPath = path.join(destRoot, rel);
      if (!destPath.startsWith(destRoot + path.sep) && destPath !== destRoot) continue;

      if (fs.existsSync(destPath)) {
        const previous = previousByFile.get(relPosix);
        if (previous) {
          currentEntries.push(previous);
          continue;
        }
        try {
          const srcBytes = await fs.promises.readFile(srcPath);
          const destStat = await fs.promises.stat(destPath);
          if (destStat.isFile() && destStat.size === srcBytes.length) {
            const srcHash = getCacheKey(srcBytes);
            const destHash = getCacheKey(await fs.promises.readFile(destPath));
            if (destHash === srcHash) {
              currentEntries.push({
                file: relPosix,
                bytes: srcBytes.length,
                hash: srcHash,
              });
              continue;
            }
          }
        } catch {
          // Fall through to the conservative conflict path below.
        }
        if (ENGINE_OWNED_PUBLIC_OUTPUTS.has(relPosix)) {
          reservedConflicts.push(relPosix);
          continue;
        }
        conflicts.push(relPosix);
        continue;
      }

      try {
        const fileBytes = await fs.promises.readFile(srcPath);
        await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
        await fs.promises.writeFile(destPath, fileBytes);
        const copied = {
          file: relPosix,
          bytes: fileBytes.length,
          hash: getCacheKey(fileBytes),
        };
        copiedEntries.push(copied);
        currentEntries.push(copied);
      } catch {
        // ignore copy errors; public assets are best-effort
      }
    }
  }

  if (copiedEntries.length) {
    logInfo(`[Build][public] Copied ${copiedEntries.length} file(s) from publicDir into ${path.basename(destRoot)}/`);
  }
  if (conflicts.length) {
    logWarn(`[Build][public] Skipped ${conflicts.length} file(s) due to output conflicts (will not overwrite build artifacts)`);
  }
  if (reservedConflicts.length) {
    logWarn(
      `[Build][public] Skipped ${reservedConflicts.length} engine-owned public file(s) (${reservedConflicts.join(", ")})`,
    );
  }

  return { assets: currentEntries, copied: copiedEntries, conflicts, reservedConflicts };
}

type SourceFreshnessCacheEntry = {
  fsPath: string;
  dev: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  hash: string;
};

export type ProductionSourceFreshnessAudit = {
  current: boolean;
  changedPaths: string[];
  reason?: string;
};

export function auditProductionSourceFreshness(
  plan: BuildPlan,
  ionifyDir: string,
  workspaceRoot: string,
  casRoot: string,
  configHash: string,
): ProductionSourceFreshnessAudit {
  const freshnessCacheFile = path.join(ionifyDir, "source-freshness.v1.json");
  let freshnessCache: Record<string, SourceFreshnessCacheEntry> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(freshnessCacheFile, "utf8"));
    if (parsed && typeof parsed === "object") {
      freshnessCache = parsed as Record<string, SourceFreshnessCacheEntry>;
    }
  } catch {
    return { current: false, changedPaths: [], reason: "missing-source-freshness-cache" };
  }

  const changedPaths: string[] = [];
  for (const chunk of plan.chunks) {
    for (const mod of chunk.modules) {
      if (mod.kind !== "js" && mod.kind !== "css") continue;
      let fsPath = typeof mod.fsPath === "string" && mod.fsPath.length > 0 ? mod.fsPath : null;
      if (!fsPath && typeof mod.id === "string" && mod.id.startsWith(WS_MODULE_PREFIX)) {
        fsPath = fromWsModuleId(mod.id, workspaceRoot);
      }
      if (!fsPath || !path.isAbsolute(fsPath)) continue;
      if (fsPath.includes("node_modules") || fsPath.includes("/.ionify/")) continue;
      try {
        const st = fs.statSync(fsPath);
        const cacheKey = `${mod.id}\n${fsPath}`;
        const cached = freshnessCache[cacheKey];
        const statMatches =
          cached &&
          cached.fsPath === fsPath &&
          cached.dev === st.dev &&
          cached.ino === st.ino &&
          cached.mtimeMs === st.mtimeMs &&
          cached.ctimeMs === st.ctimeMs &&
          cached.size === st.size &&
          typeof cached.hash === "string" &&
          cached.hash.length > 0;
        const diskHash = statMatches ? cached.hash : getCacheKey(fs.readFileSync(fsPath));
        if (!cached || cached.hash !== diskHash) {
          changedPaths.push(fsPath);
          continue;
        }
        if (
          mod.kind !== "css" &&
          typeof mod.hash === "string" &&
          mod.hash.length > 0 &&
          mod.hash !== diskHash
        ) {
          changedPaths.push(fsPath);
          continue;
        }
        if (mod.kind === "css") {
          const cssMeta = readJsonFile<CssCasMeta>(
            path.join(getCasArtifactPath(casRoot, configHash, cached.hash), "meta.json"),
          );
          if (
            !cssMeta ||
            cssMeta.version !== CSS_CAS_META_VERSION ||
            cssMeta.baseHash !== cached.hash ||
            typeof cssMeta.pipelineHash !== "string" ||
            cssMeta.pipelineHash.length === 0
          ) {
            return { current: false, changedPaths, reason: "css-meta-stale" };
          }
          const publishedHash = typeof mod.hash === "string" ? mod.hash : "";
          if (
            cssMeta.artifactHash &&
            cssMeta.depsStampHash &&
            cssDepProofIsCurrent(cssMeta)
          ) {
            const derivedCssFile = path.join(getCasArtifactPath(casRoot, configHash, cssMeta.artifactHash), "transformed.css");
            if (
              !fs.existsSync(derivedCssFile) ||
              (publishedHash !== cssMeta.artifactHash && publishedHash !== cached.hash)
            ) {
              return { current: false, changedPaths, reason: "css-artifact-stale" };
            }
          } else {
            const depsAbs = Array.from(
              new Set(
                [...(cssMeta.deps ?? []), ...(cssMeta.urlDeps ?? [])].filter(
                  (p): p is string => typeof p === "string" && p.length > 0,
                ),
              ),
            );
            const depsStampHash = computeDepsContentStampHash(depsAbs, new Map(), workspaceRoot);
            // The surrounding per-source stat gate has already proven every plan
            // source unchanged, so the meta stamp is implicitly current here.
            const expectedCssHash = getCacheKey(
              `css:v3:${mod.id}:${cached.hash}:${cssMeta.pipelineHash}:${depsStampHash}:${cssMeta.modules ? 1 : 0}:${metaTailwindStampForRecipe(cssMeta)}`,
            );
            const derivedCssFile = path.join(getCasArtifactPath(casRoot, configHash, expectedCssHash), "transformed.css");
            const legacyBaseHashIsMaterialized =
              publishedHash === cached.hash && fs.existsSync(derivedCssFile);
            if (publishedHash !== expectedCssHash && !legacyBaseHashIsMaterialized) {
              return { current: false, changedPaths, reason: "css-recipe-stale" };
            }
          }
        }
      } catch {
        return { current: false, changedPaths: [], reason: "source-unreadable" };
      }
    }
  }

  return {
    current: changedPaths.length === 0,
    changedPaths: Array.from(new Set(changedPaths)).sort(),
    reason: changedPaths.length > 0 ? "source-content-changed" : undefined,
  };
}

/**
 * Advance only the freshness-cache records covered by Planner's committed
 * canonical mutation. The cache remains an accelerator: module identity and
 * hashes come from the Planner plan, and any source race leaves the old entry
 * in place so the next audit fails closed.
 */
function updateSourceFreshnessCacheForCanonicalMutation(
  plan: BuildPlan,
  ionifyDir: string,
  workspaceRoot: string,
  changedPaths: readonly string[],
): void {
  if (changedPaths.length === 0) return;
  const freshnessCacheFile = path.join(ionifyDir, "source-freshness.v1.json");
  let freshnessCache: Record<string, SourceFreshnessCacheEntry>;
  try {
    const parsed = JSON.parse(fs.readFileSync(freshnessCacheFile, "utf8"));
    if (!parsed || typeof parsed !== "object") return;
    freshnessCache = parsed as Record<string, SourceFreshnessCacheEntry>;
  } catch {
    return;
  }

  const changed = new Set(changedPaths.map((filePath) => path.resolve(filePath)));
  let updated = false;
  for (const chunk of plan.chunks) {
    for (const mod of chunk.modules) {
      if (mod.kind !== "js" || typeof mod.hash !== "string" || mod.hash.length === 0) continue;
      let fsPath = typeof mod.fsPath === "string" && mod.fsPath.length > 0 ? mod.fsPath : null;
      if (!fsPath && typeof mod.id === "string" && mod.id.startsWith(WS_MODULE_PREFIX)) {
        fsPath = fromWsModuleId(mod.id, workspaceRoot);
      }
      if (!fsPath || !changed.has(path.resolve(fsPath))) continue;
      try {
        const bytes = fs.readFileSync(fsPath);
        if (getCacheKey(bytes) !== mod.hash) continue;
        const st = fs.statSync(fsPath);
        freshnessCache[`${mod.id}\n${fsPath}`] = {
          fsPath,
          dev: st.dev,
          ino: st.ino,
          mtimeMs: st.mtimeMs,
          ctimeMs: st.ctimeMs,
          size: st.size,
          hash: mod.hash,
        };
        updated = true;
      } catch {
        // A concurrent source mutation must remain visible to the next audit.
      }
    }
  }
  if (!updated) return;
  try {
    const tmp = `${freshnessCacheFile}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(freshnessCache)}\n`, "utf8");
    fs.renameSync(tmp, freshnessCacheFile);
  } catch {
    // Cache persistence is non-authoritative; the next build re-audits.
  }
}

function collectSourceOnlyMutationProof(
  plan: BuildPlan,
  workspaceRoot: string,
  parserMode: string,
  changedPaths: readonly string[],
): {
  ok: boolean;
  changed: number;
  changedPaths: string[];
  runtimeMutations: RuntimeSourceMutationFacts["mutations"];
  reason?: string;
} {
  if (changedPaths.length === 0) {
    return { ok: false, changed: 0, changedPaths: [], runtimeMutations: [], reason: "no-source-changes" };
  }
  const planScanStart = performance.now();
  const changedSet = new Set(changedPaths.map((filePath) => path.resolve(filePath)));
  const changedJsPaths: string[] = [];
  for (const chunk of plan.chunks) {
    for (const mod of chunk.modules) {
      if (mod.kind !== "js" && mod.kind !== "css") continue;
      let fsPath = typeof mod.fsPath === "string" && mod.fsPath.length > 0 ? mod.fsPath : null;
      if (!fsPath && typeof mod.id === "string" && mod.id.startsWith(WS_MODULE_PREFIX)) {
        fsPath = fromWsModuleId(mod.id, workspaceRoot);
      }
      if (!fsPath || !path.isAbsolute(fsPath)) continue;
      if (fsPath.includes("node_modules") || fsPath.includes("/.ionify/")) continue;
      if (!changedSet.has(path.resolve(fsPath))) continue;
      if (mod.kind !== "css") changedJsPaths.push(fsPath);
    }
  }
  const planScanMs = performance.now() - planScanStart;
  const runtimeFactsStart = performance.now();
  const runtimeFacts = collectRuntimeMutationFactsForFiles(changedJsPaths, parserMode);
  const runtimeFactsMs = performance.now() - runtimeFactsStart;
  logBuildProfileText(
    "sourceOnlyMutationProofBreakdown",
    `planScan_ms=${planScanMs.toFixed(2)} nativeFacts_ms=${runtimeFactsMs.toFixed(2)} files=${changedJsPaths.length}`,
  );
  if (runtimeFacts?.profile) {
    logBuildProfileText(
      "runtimeMutationFactBreakdown",
      `inputRead_ms=${runtimeFacts.profile.inputReadMs.toFixed(2)} nativeCall_ms=${runtimeFacts.profile.nativeMutationMs.toFixed(2)} aggregation_ms=${runtimeFacts.profile.aggregationMs.toFixed(2)}`,
    );
  }
  if (!runtimeFacts) {
    return { ok: false, changed: changedPaths.length, changedPaths: [], runtimeMutations: [], reason: "runtime-demand-facts-unavailable" };
  }
  return {
    ok: true,
    changed: changedPaths.length,
    changedPaths: Array.from(changedPaths),
    runtimeMutations: runtimeFacts.mutations,
  };
}

// v2: Tailwind graph-content freshness moved from per-artifact source dependency
// lists to the CSSA aggregated stamp (tailwindGraphContent.stamp). v1 metas are
// rejected (fail closed → one recompile) so pre-stamp state cannot serve stale CSS.
const CSS_CAS_META_VERSION = 2;

type CssCasMeta = {
  version: typeof CSS_CAS_META_VERSION;
  baseHash: string;
  artifactHash?: string;
  artifactBytesHash?: string;
  pipelineHash: string;
  depsStampHash?: string;
  deps: string[];
  urlDeps: string[];
  depsProof?: CssCasDepProof[];
  modules: boolean;
  generatedAt: string;
  cssDemand?: {
    proofVersion: number;
    extractorVersion: number;
    classDemandHash: string;
    dependencyHash: string;
    tokenCount: number;
    sourceFileCount: number;
    uncertain: boolean;
    uncertaintyReasons: string[];
  } | null;
  tailwindGraphContent?: {
    enabled: boolean;
    files: number;
    plugins: number;
    configPath: string | null;
    fallbackReason: string | null;
    /** CSSA aggregated graph-content stamp proving the Tailwind content set. */
    stamp?: string | null;
  } | null;
};

/** Tailwind stamp component of the css:v3 artifact identity recipe. */
function metaTailwindStampForRecipe(cssMeta: Pick<CssCasMeta, "tailwindGraphContent"> | null | undefined): string {
  const tw = cssMeta?.tailwindGraphContent;
  return tw?.enabled === true && typeof tw.stamp === "string" && tw.stamp.length > 0 ? tw.stamp : "none";
}

type CssCasDepProof = {
  filePath: string;
  dev: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  hash: string;
};

function isCssModuleFile(filePath: string): boolean {
  return isCssModuleLikePath(filePath);
}

function recordStructuralGraphFiles(absPaths: string[], workspaceRoot: string, configHash: string): void {
  if (!native?.graphRecord) return;
  const seen = new Set<string>();
  for (const absPath of absPaths) {
    if (typeof absPath !== "string" || absPath.length === 0 || !path.isAbsolute(absPath)) continue;
    if (seen.has(absPath)) continue;
    seen.add(absPath);
    const id = toWsModuleId(absPath, workspaceRoot);
    if (!id) continue;
    try {
      const existing = typeof (native as any).graphGet === "function" ? (native as any).graphGet(id) : null;
      if (existing && isRuntimeGraphKind(existing.kind)) continue;
      if (!fs.existsSync(absPath)) {
        native.graphRecord(id, null, [], [], GRAPH_KIND_VIRTUAL, configHash);
        continue;
      }
      const stat = fs.statSync(absPath);
      if (!stat.isFile()) continue;
      const hash = crypto.createHash("sha256").update(fs.readFileSync(absPath)).digest("hex");
      native.graphRecord(id, hash, [], [], classifyStructuralGraphKind(absPath), configHash);
    } catch {
      // Non-fatal: CSS dependency freshness can still be detected by the CAS stamp hash.
    }
  }
}

function computeDepsContentStampHash(
  depsAbs: string[],
  moduleMetaById: Map<string, { fsPath: string; kind: "js" | "css"; hash: string | null }>,
  workspaceRoot: string,
): string {
  if (!depsAbs.length) return "0";
  const entries: string[] = [];
  for (const depAbs of depsAbs) {
    const abs = path.resolve(depAbs);
    let hash: string | null = null;
    const depId = toWsModuleId(abs, workspaceRoot);
    if (depId) hash = moduleMetaById.get(depId)?.hash ?? null;
    if (!hash) {
      try {
        const raw = fs.readFileSync(abs);
        hash = getCacheKey(raw);
      } catch {
        hash = "missing";
      }
    }
    entries.push(`${depId ?? abs.replace(/\\+/g, "/")}:${hash}`);
  }
  entries.sort();
  return getCacheKey(entries.join("|"));
}

function buildCssCasDepProof(
  depsAbs: string[],
  moduleMetaById: Map<string, { fsPath: string; kind: "js" | "css"; hash: string | null }>,
  workspaceRoot: string,
): CssCasDepProof[] {
  const proofs: CssCasDepProof[] = [];
  const seen = new Set<string>();
  for (const depAbs of depsAbs) {
    const abs = path.resolve(depAbs);
    if (seen.has(abs)) continue;
    seen.add(abs);
    const depId = toWsModuleId(abs, workspaceRoot);
    if (depId && moduleMetaById.has(depId)) continue;
    try {
      const st = fs.statSync(abs);
      if (!st.isFile()) continue;
      proofs.push({
        filePath: abs,
        dev: st.dev,
        ino: st.ino,
        mtimeMs: st.mtimeMs,
        ctimeMs: st.ctimeMs,
        size: st.size,
        hash: getCacheKey(fs.readFileSync(abs)),
      });
    } catch {
      proofs.push({
        filePath: abs,
        dev: 0,
        ino: 0,
        mtimeMs: 0,
        ctimeMs: 0,
        size: -1,
        hash: "missing",
      });
    }
  }
  return proofs.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

function cssDepProofIsCurrent(
  cssMeta: CssCasMeta,
): boolean {
  if (!Array.isArray(cssMeta.depsProof)) return false;
  for (const proof of cssMeta.depsProof) {
    const depAbs = path.resolve(proof.filePath);
    try {
      const st = fs.statSync(depAbs);
      if (
        !st.isFile() ||
        proof.dev !== st.dev ||
        proof.ino !== st.ino ||
        proof.mtimeMs !== st.mtimeMs ||
        proof.ctimeMs !== st.ctimeMs ||
        proof.size !== st.size
      ) {
        return false;
      }
      if (getCacheKey(fs.readFileSync(depAbs)) !== proof.hash) {
        return false;
      }
    } catch {
      return proof.hash === "missing";
    }
  }
  return true;
}

function cssMetaAdmitsCurrentTailwindGraph(cssMeta: CssCasMeta, currentGraphStamp: string | null): boolean {
  if (cssMeta.tailwindGraphContent?.enabled !== true || Number(cssMeta.tailwindGraphContent.files ?? 0) <= 0) {
    return true;
  }
  const stamp = cssMeta.tailwindGraphContent.stamp;
  if (typeof stamp !== "string" || stamp.length === 0) return false;
  return currentGraphStamp !== null && stamp === currentGraphStamp;
}

function copyFileWithHardlinkFallback(src: string, dst: string): boolean {
  try {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (fs.existsSync(dst)) return true;
    try {
      fs.linkSync(src, dst);
    } catch {
      fs.copyFileSync(src, dst);
    }
    return true;
  } catch {
    return false;
  }
}

type DepsManifestIndexEntry = {
  entryPath: string;
  packageLabel: string;
  hasSourcemap: boolean;
  sizeBytes: number;
  moduleCount: number;
  edgeCount: number;
  externalCount: number;
  chunkGroup: string | null;
  chunkFiles: string[];
  artifactTopologyReason: string | null;
};

type VerifiedDepsSnapshotFreshness = {
  fresh: boolean;
  checked: number;
  missing: string[];
  reason?: string;
  detail?: string;
};

function canonicalFsPath(value: string): string {
  try {
    return fs.realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

function loadDepsManifestIndex(depsRoot: string): Map<string, DepsManifestIndexEntry> {
  const manifestPath = path.join(depsRoot, "manifest.json");
  if (!fs.existsSync(manifestPath)) return new Map();
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    const entries: Record<string, any> = parsed?.entries ?? {};
    const activeEntriesRaw = parsed?.activeEntries ?? parsed?.active_entries;
    const activeManifestKeys =
      activeEntriesRaw && typeof activeEntriesRaw === "object"
        ? new Set(Object.values(activeEntriesRaw).filter((value): value is string => typeof value === "string"))
        : null;
    const map = new Map<string, DepsManifestIndexEntry>();
    for (const [manifestKey, entry] of Object.entries(entries)) {
      if (activeManifestKeys && !activeManifestKeys.has(manifestKey)) continue;
      const outFile = (entry as any)?.outFile ?? (entry as any)?.out_file ?? null;
      if (typeof outFile !== "string" || !outFile.endsWith(".js")) continue;
      const sizeBytes =
        typeof (entry as any).sizeBytes === "number"
          ? (entry as any).sizeBytes
          : typeof (entry as any).size_bytes === "number"
            ? (entry as any).size_bytes
            : 0;
      const moduleCount =
        typeof (entry as any).moduleCount === "number"
          ? (entry as any).moduleCount
          : typeof (entry as any).module_count === "number"
            ? (entry as any).module_count
            : 0;
      const edgeCount =
        typeof (entry as any).edgeCount === "number"
          ? (entry as any).edgeCount
          : typeof (entry as any).edge_count === "number"
            ? (entry as any).edge_count
            : 0;
      const externalCount =
        typeof (entry as any).externalCount === "number"
          ? (entry as any).externalCount
          : typeof (entry as any).external_count === "number"
            ? (entry as any).external_count
            : 0;
      const chunkGroup =
        typeof (entry as any).chunkGroup === "string"
          ? (entry as any).chunkGroup
          : typeof (entry as any).chunk_group === "string"
            ? (entry as any).chunk_group
            : null;
      const chunkFilesRaw =
        Array.isArray((entry as any).chunkFiles)
          ? (entry as any).chunkFiles
          : Array.isArray((entry as any).chunk_files)
            ? (entry as any).chunk_files
            : [];
      const chunkFiles = (Array.isArray(chunkFilesRaw) ? chunkFilesRaw : [])
        .map((v) => (typeof v === "string" ? v : null))
        .filter((v): v is string => typeof v === "string" && v.length > 0);
      const artifactTopologyReasonRaw =
        (entry as any).artifactTopologyReason ?? (entry as any).artifact_topology_reason;
      map.set(outFile, {
        entryPath:
          typeof (entry as any)?.entryPath === "string"
            ? (entry as any).entryPath
            : typeof (entry as any)?.entry_path === "string"
              ? (entry as any).entry_path
              : manifestKey.split("::usage::", 1)[0],
        packageLabel: (entry as any).package || "unknown",
        hasSourcemap: (entry as any).hasSourcemap === true,
        sizeBytes,
        moduleCount,
        edgeCount,
        externalCount,
        chunkGroup,
        chunkFiles,
        artifactTopologyReason:
          typeof artifactTopologyReasonRaw === "string" && artifactTopologyReasonRaw.length > 0
            ? artifactTopologyReasonRaw
            : null,
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

function normalizeManifestString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeManifestStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function countDepsManifestTopologies(depsRoot: string): { esmNative: number; esmNativeSlim: number; wrapper: number } {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(depsRoot, "manifest.json"), "utf8"));
    const entries = parsed?.entries && typeof parsed.entries === "object" ? Object.values(parsed.entries) : [];
    let esmNative = 0;
    let esmNativeSlim = 0;
    let wrapper = 0;
    for (const entry of entries) {
      const topology = normalizeManifestString((entry as any)?.artifactTopology ?? (entry as any)?.artifact_topology);
      if (topology === "esm-native") esmNative++;
      else if (topology === "esm-native-slim") esmNativeSlim++;
      else if (topology === "wrapper") wrapper++;
    }
    return { esmNative, esmNativeSlim, wrapper };
  } catch {
    return { esmNative: 0, esmNativeSlim: 0, wrapper: 0 };
  }
}

function hasForbiddenFactoryTokens(code: string): boolean {
  return code.includes("__ionifyModules") || code.includes("__ionifyRequire") || code.includes("shared.sc");
}

function validateDepsPackageGraphFact(entry: any, depsRoot: string): { ok: boolean; reason?: string; graphOutFiles: string[] } {
  const graph = entry?.packageGraph ?? entry?.package_graph;
  if (!graph || typeof graph !== "object") return { ok: true, graphOutFiles: [] };
  if (graph.version !== PACKAGE_GRAPH_VERSION) return { ok: false, reason: "package-graph-version", graphOutFiles: [] };
  if (graph.status !== "ready") return { ok: true, graphOutFiles: [] };
  if (
    normalizeManifestString(graph.identityHash ?? graph.identity_hash).length === 0 ||
    normalizeManifestString(graph.entryFile ?? graph.entry_file).length === 0
  ) {
    return { ok: false, reason: "package-graph-identity", graphOutFiles: [] };
  }
  const files = Array.isArray(graph.files) ? graph.files : [];
  const reachableFilesRaw = graph.reachableFiles ?? graph.reachable_files;
  const reachableFiles = Array.isArray(reachableFilesRaw) ? reachableFilesRaw : [];
  if (files.length === 0 || reachableFiles.length === 0) {
    return { ok: false, reason: "package-graph-files", graphOutFiles: [] };
  }
  const graphOutFiles: string[] = [];
  for (const file of files) {
    const graphOutFile = normalizeManifestString(file?.outFile ?? file?.out_file);
    const graphSourceFile = normalizeManifestString(file?.file);
    const graphHash = normalizeManifestString(file?.hash);
    if (!graphOutFile.endsWith(".js") || graphSourceFile.length === 0 || graphHash.length === 0) {
      return { ok: false, reason: "package-graph-file-invalid", graphOutFiles: [] };
    }
    if (!fs.existsSync(path.join(depsRoot, graphOutFile))) {
      return { ok: false, reason: "package-graph-artifact-missing", graphOutFiles: [] };
    }
    graphOutFiles.push(graphOutFile);
  }
  topologyValidationProfile.packageGraphCacheHit += 1;
  return { ok: true, graphOutFiles };
}

export function validateDepsManifestEntryTopology(
  entry: any,
  depsRoot: string,
  outputVersion = DEPS_OPTIMIZER_OUTPUT_VERSION,
): { ok: boolean; reason?: string } {
  const proofStarted = Date.now();
  try {
    if (!entry || typeof entry !== "object") return { ok: false, reason: "entry-invalid" };
    const entryOutputVersion =
      typeof entry.outputVersion === "number"
        ? entry.outputVersion
        : typeof entry.output_version === "number"
          ? entry.output_version
          : 0;
    if (entryOutputVersion !== outputVersion) {
      depsMeasurementProfile.outputVersionMismatchSeen = true;
      return { ok: false, reason: "output-version-mismatch" };
    }

    const topology = normalizeManifestString(entry.artifactTopology ?? entry.artifact_topology);
    if (topology !== "wrapper" && topology !== "esm-native" && topology !== "esm-native-slim") {
      return { ok: false, reason: "artifact-topology-missing-or-invalid" };
    }
    const topologyReason = normalizeManifestString(entry.artifactTopologyReason ?? entry.artifact_topology_reason);
    if (topologyReason.length === 0) {
      return { ok: false, reason: "artifact-topology-reason-missing" };
    }

    const outFile = normalizeManifestString(entry.outFile ?? entry.out_file);
    if (!outFile.endsWith(".js")) return { ok: false, reason: "topology-out-file" };
    if (!fs.existsSync(path.join(depsRoot, outFile))) {
      return { ok: false, reason: "topology-artifact-missing" };
    }

    const artifactHash = normalizeManifestString(entry.artifactHash ?? entry.artifact_hash);
    if (artifactHash.length === 0) return { ok: false, reason: "topology-artifact-hash-missing" };

    const proofVersion =
      typeof entry.proofVersion === "number"
        ? entry.proofVersion
        : typeof entry.proof_version === "number"
          ? entry.proof_version
          : 0;

    if (topology === "wrapper") {
      return proofVersion === TOPOLOGY_PROOF_VERSION
        ? { ok: true }
        : { ok: false, reason: "topology-proof-version" };
    }

    if (entry.runtimeFormat !== "esm" && entry.runtime_format !== "esm") {
      return { ok: false, reason: "esm-native-runtime-format" };
    }
    if (entry.productionEsmSafe !== true && entry.production_esm_safe !== true) {
      return { ok: false, reason: "esm-native-production-safe" };
    }

    const sharedImportsRaw = entry.sharedImports ?? entry.shared_imports;
    if (!Array.isArray(sharedImportsRaw)) return { ok: false, reason: "esm-native-shared-imports-missing" };
    const sharedImports = normalizeManifestStringArray(sharedImportsRaw);
    if (sharedImports.length > 0) return { ok: false, reason: "esm-native-shared-imports" };

    const chunkGroup = normalizeManifestString(entry.chunkGroup ?? entry.chunk_group);
    if (chunkGroup.length > 0) return { ok: false, reason: "esm-native-chunk-group" };

    const chunkFilesRaw = entry.chunkFiles ?? entry.chunk_files;
    if (!Array.isArray(chunkFilesRaw)) return { ok: false, reason: "esm-native-chunk-files-missing" };
    const chunkFiles = normalizeManifestStringArray(chunkFilesRaw);
    if (chunkFiles.length > 0) return { ok: false, reason: "esm-native-chunk-files" };

    const forbiddenFactoryTokensAbsent =
      entry.forbiddenFactoryTokensAbsent === true || entry.forbidden_factory_tokens_absent === true;
    const graphValidation = validateDepsPackageGraphFact(entry, depsRoot);
    if (!graphValidation.ok) return { ok: false, reason: graphValidation.reason };
    if (proofVersion === TOPOLOGY_PROOF_VERSION && forbiddenFactoryTokensAbsent) {
      return { ok: true };
    }

    const scanStarted = Date.now();
    let code = "";
    try {
      code = fs.readFileSync(path.join(depsRoot, outFile), "utf8");
    } catch {
      return { ok: false, reason: "esm-native-artifact-missing" };
    } finally {
      topologyValidationProfile.byteScanTimeMs += Date.now() - scanStarted;
    }
    if (code.includes("__ionifyModules")) return { ok: false, reason: "esm-native-factory-modules" };
    if (code.includes("__ionifyRequire")) return { ok: false, reason: "esm-native-factory-require" };
    if (code.includes("shared.sc")) return { ok: false, reason: "esm-native-shared-factory" };
    for (const graphOutFile of graphValidation.graphOutFiles) {
      if (graphOutFile === outFile) continue;
      const graphScanStarted = Date.now();
      let graphCode = "";
      try {
        graphCode = fs.readFileSync(path.join(depsRoot, graphOutFile), "utf8");
      } catch {
        return { ok: false, reason: "esm-native-graph-artifact-missing" };
      } finally {
        topologyValidationProfile.byteScanTimeMs += Date.now() - graphScanStarted;
      }
      if (hasForbiddenFactoryTokens(graphCode)) {
        return { ok: false, reason: "esm-native-graph-factory-topology" };
      }
    }

    return { ok: true, reason: "topology-proof-fallback-byte-scan" };
  } finally {
    topologyValidationProfile.proofValidationTimeMs += Date.now() - proofStarted;
  }
}

function manifestHasDifferentOutputVersion(manifestPath: string, outputVersion = DEPS_OPTIMIZER_OUTPUT_VERSION): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const entries = parsed?.entries && typeof parsed.entries === "object" ? Object.values(parsed.entries) : [];
    return entries.some((entry: any) => {
      const entryOutputVersion =
        typeof entry?.outputVersion === "number"
          ? entry.outputVersion
          : typeof entry?.output_version === "number"
            ? entry.output_version
            : 0;
      return entryOutputVersion > 0 && entryOutputVersion !== outputVersion;
    });
  } catch {
    return false;
  }
}

function hasPriorDepsOutputVersionMismatch(ionifyDir: string, currentDepsRoot: string): boolean {
  const localDepsDir = path.join(ionifyDir, "deps");
  const checkParent = (parent: string): boolean => {
    if (!fs.existsSync(parent)) return false;
    try {
      for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dirPath = path.join(parent, entry.name);
        if (path.resolve(dirPath) === path.resolve(currentDepsRoot)) continue;
        if (manifestHasDifferentOutputVersion(path.join(dirPath, "manifest.json"))) return true;
      }
    } catch {
      return false;
    }
    return false;
  };
  if (checkParent(localDepsDir)) return true;
  return checkParent(path.join(os.homedir(), ".ionify", "global", "dep-artifacts", GLOBAL_DEP_CACHE_VERSION));
}

function statFileBytes(filePath: string): number | null {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

function sortedDirectoryFiles(root: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;
  const visit = (dir: string) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const filePath = path.join(dir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) visit(filePath);
      else if (stat.isFile()) out.push(filePath);
    }
  };
  visit(root);
  return out;
}

function depsRootRelativePath(depsRoot: string, filePath: string): string {
  return path.relative(depsRoot, filePath).split(path.sep).join("/");
}

function collectManifestReferencedJsFiles(entry: any): string[] {
  const out = new Set<string>();
  const outFile = normalizeManifestString(entry?.outFile ?? entry?.out_file);
  if (outFile.endsWith(".js")) out.add(outFile);
  const graph = entry?.packageGraph ?? entry?.package_graph;
  const graphFiles = graph && typeof graph === "object" && Array.isArray(graph.files) ? graph.files : [];
  for (const file of graphFiles) {
    const graphOutFile = normalizeManifestString(file?.outFile ?? file?.out_file);
    if (graphOutFile.endsWith(".js")) out.add(graphOutFile);
  }
  return Array.from(out).sort();
}

function sumFilesBytes(depsRoot: string, files: Iterable<string>): number {
  let total = 0;
  for (const file of files) total += statFileBytes(path.join(depsRoot, file)) ?? 0;
  return total;
}

function writeGate4ValueAccountingArtifact(depsRoot: string): { bytes: number; timeMs: number } {
  const started = Date.now();
  const manifestPath = path.join(depsRoot, "manifest.json");
  if (!fs.existsSync(manifestPath)) return { bytes: 0, timeMs: Date.now() - started };
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const entriesRaw = parsed?.entries && typeof parsed.entries === "object" ? Object.values(parsed.entries) : [];
    const dependencyJsFiles = new Set<string>();
    const dependencyGzipFiles = new Set<string>();
    const summary = {
      totalEntries: 0,
      wrapperEntries: 0,
      esmNativeEntries: 0,
      esmNativeSlimEntries: 0,
      wrapperJsBytes: 0,
      esmNativeJsBytes: 0,
      esmNativeSlimJsBytes: 0,
      realDependencyJsBytes: 0,
      realDependencyGzipBytes: 0,
      realDependencyFileCount: 0,
      allDependencyJsBytes: 0,
      allDependencyGzipBytes: 0,
      allDependencyFileCount: 0,
      nonManifestDependencyJsBytes: 0,
      nonManifestDependencyGzipBytes: 0,
      nonManifestDependencyFileCount: 0,
      packageGraphJsBytes: 0,
      packageGraphFileCount: 0,
      diagnosticReportBytes: 0,
      diagnosticReportFileCount: 0,
      contractMetadataBytes: 0,
      contractMetadataFileCount: 0,
      otherNonValueBytes: 0,
      otherNonValueFileCount: 0,
    };
    const entries = entriesRaw.map((entry: any) => {
      const topology = normalizeManifestString(entry?.artifactTopology ?? entry?.artifact_topology) || "wrapper";
      const files = collectManifestReferencedJsFiles(entry);
      for (const file of files) {
        dependencyJsFiles.add(file);
        const gzipFile = `${file}.gz`;
        if (fs.existsSync(path.join(depsRoot, gzipFile))) dependencyGzipFiles.add(gzipFile);
      }
      const graph = entry?.packageGraph ?? entry?.package_graph;
      const graphFiles = graph && typeof graph === "object" && Array.isArray(graph.files) ? graph.files : [];
      const outFile = normalizeManifestString(entry?.outFile ?? entry?.out_file);
      const entryJsBytes = sumFilesBytes(depsRoot, files);
      const graphOnlyFiles = graphFiles
        .map((file: any) => normalizeManifestString(file?.outFile ?? file?.out_file))
        .filter((file: string) => file.endsWith(".js") && file !== outFile)
        .sort();
      const graphJsBytes = sumFilesBytes(depsRoot, graphOnlyFiles);

      summary.totalEntries += 1;
      if (topology === "wrapper") {
        summary.wrapperEntries += 1;
        summary.wrapperJsBytes += entryJsBytes;
      } else if (topology === "esm-native-slim") {
        summary.esmNativeEntries += 1;
        summary.esmNativeSlimEntries += 1;
        summary.esmNativeJsBytes += entryJsBytes;
        summary.esmNativeSlimJsBytes += entryJsBytes;
      } else if (topology === "esm-native") {
        summary.esmNativeEntries += 1;
        summary.esmNativeJsBytes += entryJsBytes;
      }
      summary.packageGraphJsBytes += graphJsBytes;
      summary.packageGraphFileCount += graphOnlyFiles.length;

      return {
        package: normalizeManifestString(entry?.package) ||
          `${normalizeManifestString(entry?.packageName ?? entry?.package_name)}@${normalizeManifestString(entry?.packageVersion ?? entry?.package_version)}`,
        packageName: normalizeManifestString(entry?.packageName ?? entry?.package_name),
        packageVersion: normalizeManifestString(entry?.packageVersion ?? entry?.package_version),
        packageSubpath: normalizeManifestString(entry?.packageSubpath ?? entry?.package_subpath),
        topology,
        artifactJsBytes: entryJsBytes,
        packageGraphJsBytes: graphJsBytes,
        dependencyFiles: files,
        fallbackReason:
          topology === "wrapper"
            ? normalizeManifestString(entry?.artifactTopologyReason ?? entry?.artifact_topology_reason)
            : null,
      };
    }).sort((a: any, b: any) => {
      const packageCompare = a.package.localeCompare(b.package);
      if (packageCompare !== 0) return packageCompare;
      return a.packageSubpath.localeCompare(b.packageSubpath);
    });

    summary.realDependencyJsBytes = sumFilesBytes(depsRoot, dependencyJsFiles);
    summary.realDependencyGzipBytes = sumFilesBytes(depsRoot, dependencyGzipFiles);
    summary.realDependencyFileCount = dependencyJsFiles.size;

    const dependencyValueFiles = new Set<string>([...dependencyJsFiles, ...dependencyGzipFiles]);
    const diagnosticReportFiles = new Set([
      "deps-usage.v2.json",
      "gate3-profile.json",
      "gate4-value-accounting.json",
    ]);
    for (const filePath of sortedDirectoryFiles(depsRoot)) {
      const rel = depsRootRelativePath(depsRoot, filePath);
      const bytes = statFileBytes(filePath) ?? 0;
      if (dependencyValueFiles.has(rel)) {
        if (rel.endsWith(".js")) summary.allDependencyJsBytes += bytes;
        else if (rel.endsWith(".js.gz")) summary.allDependencyGzipBytes += bytes;
        summary.allDependencyFileCount += 1;
        continue;
      }
      if (rel.endsWith(".js") || rel.endsWith(".js.gz")) {
        if (rel.endsWith(".js")) {
          summary.allDependencyJsBytes += bytes;
          summary.nonManifestDependencyJsBytes += bytes;
        } else {
          summary.allDependencyGzipBytes += bytes;
          summary.nonManifestDependencyGzipBytes += bytes;
        }
        summary.allDependencyFileCount += 1;
        summary.nonManifestDependencyFileCount += 1;
        continue;
      }
      if (rel === "manifest.json" || rel === ".verified" || rel.startsWith("vendor-pack.")) {
        summary.contractMetadataBytes += bytes;
        summary.contractMetadataFileCount += 1;
      } else if (diagnosticReportFiles.has(rel)) {
        summary.diagnosticReportBytes += bytes;
        summary.diagnosticReportFileCount += 1;
      } else {
        summary.otherNonValueBytes += bytes;
        summary.otherNonValueFileCount += 1;
      }
    }

    const artifactPath = path.join(depsRoot, "gate4-value-accounting.json");
    writeJsonFile(artifactPath, {
      version: 1,
      diagnostic: true,
      valueBytesExcludeReports: true,
      depsHash: normalizeManifestString(parsed?.depsHash ?? parsed?.deps_hash),
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      packageGraphVersion: PACKAGE_GRAPH_VERSION,
      cacheMode: depsMeasurementProfile.cacheMode,
      promotedArtifacts: depsMeasurementProfile.promoted,
      promotionSkippedArtifacts: depsMeasurementProfile.promotionSkipped,
      outputVersionMismatchSeen: depsMeasurementProfile.outputVersionMismatchSeen,
      summary,
      entries,
    });
    return { bytes: statFileBytes(artifactPath) ?? 0, timeMs: Date.now() - started };
  } catch (err) {
    logWarn(`[deps] WARN: Failed to write Gate 4 value accounting artifact: ${String(err)}`);
    return { bytes: 0, timeMs: Date.now() - started };
  }
}

function writeGate3ProfileArtifact(depsRoot: string): { bytes: number; timeMs: number } {
  const started = Date.now();
  const manifestPath = path.join(depsRoot, "manifest.json");
  if (!fs.existsSync(manifestPath)) return { bytes: 0, timeMs: Date.now() - started };
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const entriesRaw = parsed?.entries && typeof parsed.entries === "object" ? Object.values(parsed.entries) : [];
    const entries = entriesRaw
      .map((entry: any) => {
        const topology = normalizeManifestString(entry?.artifactTopology ?? entry?.artifact_topology);
        const outFile = normalizeManifestString(entry?.outFile ?? entry?.out_file);
        const artifactPath = outFile ? path.join(depsRoot, outFile) : "";
        const artifactBytes = artifactPath ? statFileBytes(artifactPath) : null;
        const graph = entry?.packageGraph ?? entry?.package_graph;
        const graphFiles = graph && typeof graph === "object" && Array.isArray(graph.files) ? graph.files : [];
        const graphBytes = graphFiles.reduce((total: number, file: any) => {
          const graphOutFile = normalizeManifestString(file?.outFile ?? file?.out_file);
          if (!graphOutFile || graphOutFile === outFile) return total;
          return total + (statFileBytes(path.join(depsRoot, graphOutFile)) ?? 0);
        }, 0);
        const wrapperBytes = topology === "wrapper" ? artifactBytes : null;
        const esmNativeBytes =
          (topology === "esm-native" || topology === "esm-native-slim") && artifactBytes !== null
            ? artifactBytes + graphBytes
            : null;
        const esmNativeSlimBytes = topology === "esm-native-slim" ? artifactBytes : null;
        const deltaBytes =
          typeof wrapperBytes === "number" && typeof esmNativeBytes === "number"
            ? wrapperBytes - esmNativeBytes
            : null;
        const reachableRaw = graph?.reachableFiles ?? graph?.reachable_files;
        const exportDemandRaw = entry?.exportDemand ?? entry?.export_demand ?? graph?.usedExports ?? graph?.used_exports;
        return {
          package: normalizeManifestString(entry?.package) ||
            `${normalizeManifestString(entry?.packageName ?? entry?.package_name)}@${normalizeManifestString(entry?.packageVersion ?? entry?.package_version)}`,
          entry: normalizeManifestString(entry?.entryPath ?? entry?.entry_path),
          packageName: normalizeManifestString(entry?.packageName ?? entry?.package_name),
          packageVersion: normalizeManifestString(entry?.packageVersion ?? entry?.package_version),
          packageSubpath: normalizeManifestString(entry?.packageSubpath ?? entry?.package_subpath),
          topology,
          wrapperBytes,
          esmNativeBytes,
          esmNativeSlimBytes,
          deltaBytes,
          reachableFiles: normalizeManifestStringArray(reachableRaw),
          usedExports: normalizeManifestStringArray(exportDemandRaw),
          fallbackReason:
            topology === "wrapper"
              ? normalizeManifestString(entry?.artifactTopologyReason ?? entry?.artifact_topology_reason)
              : null,
        };
      })
      .sort((a: any, b: any) => {
        const packageCompare = a.package.localeCompare(b.package);
        if (packageCompare !== 0) return packageCompare;
        return a.entry.localeCompare(b.entry);
      });

    const summary = entries.reduce(
      (acc: any, entry: any) => {
        acc.total += 1;
        if (entry.topology === "esm-native") acc.esmNative += 1;
        else if (entry.topology === "esm-native-slim") acc.esmNativeSlim += 1;
        else if (entry.topology === "wrapper") acc.wrapper += 1;
        if (typeof entry.wrapperBytes === "number") acc.wrapperBytes += entry.wrapperBytes;
        if (typeof entry.esmNativeBytes === "number") acc.esmNativeBytes += entry.esmNativeBytes;
        if (typeof entry.esmNativeSlimBytes === "number") acc.esmNativeSlimBytes += entry.esmNativeSlimBytes;
        return acc;
      },
      { total: 0, wrapper: 0, esmNative: 0, esmNativeSlim: 0, wrapperBytes: 0, esmNativeBytes: 0, esmNativeSlimBytes: 0 },
    );

    const artifactPath = path.join(depsRoot, "gate3-profile.json");
    writeJsonFile(artifactPath, {
      version: 1,
      diagnostic: true,
      valueBytesExcludeReports: true,
      depsHash: normalizeManifestString(parsed?.depsHash ?? parsed?.deps_hash),
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      summary,
      entries,
    });
    return { bytes: statFileBytes(artifactPath) ?? 0, timeMs: Date.now() - started };
  } catch (err) {
    logWarn(`[deps] WARN: Failed to write Gate 3 profile artifact: ${String(err)}`);
    return { bytes: 0, timeMs: Date.now() - started };
  }
}

function writeDepsMeasurementArtifacts(depsRoot: string): void {
  const started = Date.now();
  const gate3 = writeGate3ProfileArtifact(depsRoot);
  const gate4 = writeGate4ValueAccountingArtifact(depsRoot);
  if (!isBuildProfileEnabled()) return;
  logBuildProfileDuration("profileReportWriteTime", Date.now() - started);
  logBuildProfileValue("gate3ProfileBytes", gate3.bytes);
  logBuildProfileValue("gate4ValueAccountingBytes", gate4.bytes);
  logBuildProfileDuration("gate3ProfileWriteTime", gate3.timeMs);
  logBuildProfileDuration("gate4ValueAccountingWriteTime", gate4.timeMs);
}

type DplSnapshotPublicationFact = {
  routeActive: boolean;
  entryPath: string;
  artifactTopology: string;
  nodeEnv: string;
  outputVersion: number;
  exportDemand: string[];
};

function readDplSnapshotPublicationFacts(
  depsRoot: string,
  outputVersion = DEPS_OPTIMIZER_OUTPUT_VERSION,
): DplSnapshotPublicationFact[] | null {
  const readActivePublications = native?.depsActivePublications;
  if (!readActivePublications) return null;
  try {
    const publications = readActivePublications(depsRoot);
    if (publications.some((publication) => publication.outputVersion !== outputVersion)) return null;
    return publications;
  } catch {
    return null;
  }
}

export async function checkVerifiedDepsSnapshotFreshness(options: {
  rootDir: string;
  depsRoot: string;
  resolvedEntries: string[] | undefined;
  allowedRoots: string[];
  config: any;
  runtimeDemands?: DplRuntimeDemandFact[];
}): Promise<VerifiedDepsSnapshotFreshness> {
  // Polarity: freshness is a completeness PROOF that authorizes skipping the
  // optimizer. Anything that prevents producing the proof must report NOT
  // fresh (fail closed → the optimizer repair path runs), never fresh-by-
  // default — an unprovable snapshot silently accepted is exactly how a stale
  // publication survives while demand has grown.
  if (!native?.depsRuntimeDemandCovered) {
    return { fresh: false, checked: 0, missing: [], reason: "dpl-demand-authority-unavailable" };
  }

  const demandFacts = await collectDplGenerationDemandFacts(options);
  if (!demandFacts.ok) return demandFacts.failure;
  try {
    // TS supplies syntax facts only. DPL resolves package identity, selects the
    // active publication, and verifies topology/export ABI for every demand.
    const coverage = native.depsRuntimeDemandCovered(options.depsRoot, demandFacts.demands);
    if (!coverage.covered) {
      return {
        fresh: false,
        checked: coverage.checked,
        missing: [],
        reason: "dpl-runtime-demand-uncovered",
        detail: coverage.reason ?? undefined,
      };
    }
    return { fresh: true, checked: coverage.checked, missing: [], reason: undefined };
  } catch {
    return { fresh: false, checked: 0, missing: [], reason: "manifest-missing-or-invalid" };
  }
}

type DplGenerationDemandFacts =
  | { ok: true; demands: DplRuntimeDemandFact[] }
  | { ok: false; failure: VerifiedDepsSnapshotFreshness };

/**
 * Collect emitted-runtime syntax facts for DPL generation admission. This is
 * deliberately identity-free: TS may filter configured external exclusions,
 * while package resolution, active-route selection, topology, and export ABI
 * remain DPL-owned.
 */
async function collectDplGenerationDemandFacts(options: {
  rootDir: string;
  resolvedEntries: string[] | undefined;
  allowedRoots: string[];
  config: any;
  runtimeDemands?: DplRuntimeDemandFact[];
}): Promise<DplGenerationDemandFacts> {
  const usageEntries = await resolveUsageEntries(options.rootDir, options.resolvedEntries);
  if (usageEntries.length === 0) return { ok: true, demands: [] };

  let runtimeDemands = options.runtimeDemands;
  try {
    if (!runtimeDemands) {
      // C3-c Phase B: prefer the retained canonical Parser(B)+Resolver demand on the
      // true-cold path (sole authority); the source scanner runs only off that path.
      const coldPump =
        __c3ColdPumpDemand && __c3ColdPumpDemand.rootDir === options.rootDir
          ? __c3ColdPumpDemand
          : null;
      runtimeDemands = coldPump
        ? coldPump.demands
        : (
            await scanDepUsageFacts({
              rootDir: options.rootDir,
              entries: usageEntries,
              allowedRoots: options.allowedRoots,
            })
          ).runtimeDemands;
    }
  } catch {
    return {
      ok: false,
      failure: { fresh: false, checked: 0, missing: [], reason: "runtime-demand-scan-failed" },
    };
  }

  const optimizeExclude = Array.isArray(options.config?.optimizeDeps?.exclude)
    ? new Set(options.config.optimizeDeps.exclude.map((value: any) => String(value)))
    : null;
  return {
    ok: true,
    demands: runtimeDemands.filter((demand) => {
      if (!optimizeExclude || optimizeExclude.size === 0) return true;
      for (const excluded of optimizeExclude) {
        if (demand.specifier === excluded || demand.specifier.startsWith(`${excluded}/`)) return false;
      }
      return true;
    }),
  };
}

async function publishVerifiedDepsGeneration(options: {
  rootDir: string;
  depsRoot: string;
  depsHash: string;
  resolvedEntries: string[] | undefined;
  allowedRoots: string[];
  config: any;
  runtimeDemands?: DplRuntimeDemandFact[];
}): Promise<void> {
  const sentinelPath = path.join(options.depsRoot, ".verified");
  const publishGeneration = native?.depsPublishVerifiedGeneration;
  if (!publishGeneration) {
    removeSnapshotMarker(sentinelPath);
    throw new Error("[deps] DPL generation publication authority is unavailable");
  }
  const demandFacts = await collectDplGenerationDemandFacts(options);
  if (!demandFacts.ok) {
    removeSnapshotMarker(sentinelPath);
    throw new Error(`[deps] Cannot publish DPL generation: ${demandFacts.failure.reason ?? "unknown"}`);
  }
  const coverage = publishGeneration(options.depsRoot, demandFacts.demands);
  if (!coverage.covered) {
    throw new Error(
      `[deps] DPL did not admit the optimized generation ` +
        `(dpl-runtime-demand-uncovered, checked=${coverage.checked}` +
        `${coverage.reason ? `, detail=${coverage.reason}` : ""})`,
    );
  }
  writeDepArtifactsToGlobalCache(
    options.depsHash,
    options.depsRoot,
    DEPS_OPTIMIZER_OUTPUT_VERSION,
  );
}

/**
 * Accept a globally-restored deps snapshot ONLY after it passes the same
 * freshness proof a local sentinel must pass. The global cache is keyed by
 * depsHash (lockfile identity), but a snapshot cached before new imports were
 * added satisfies the hash while missing current demand — writing the sentinel
 * for it would bless an incomplete publication for every future build. On an
 * unproven restore the restored artifacts stay on disk as a warm starting
 * point, the sentinel is NOT written, and the caller falls through to the
 * optimizer repair path which tops up the missing publications.
 */
export async function verifyRestoredDepsSnapshot(options: {
  rootDir: string;
  depsRoot: string;
  sentinelPath: string;
  resolvedEntries: string[] | undefined;
  allowedRoots: string[];
  config: any;
}): Promise<boolean> {
  // A restored global marker is never authoritative locally. Proof must create
  // the local marker after inspecting the restored publication substrate.
  if (!removeSnapshotMarker(options.sentinelPath)) {
    throw new Error(
      `[Ionify] Cannot invalidate restored dependency marker ${options.sentinelPath}`,
    );
  }
  const publishGeneration = native?.depsPublishVerifiedGeneration;
  if (!publishGeneration) return false;
  const demandFacts = await collectDplGenerationDemandFacts({
    rootDir: options.rootDir,
    resolvedEntries: options.resolvedEntries,
    allowedRoots: options.allowedRoots,
    config: options.config,
  });
  if (!demandFacts.ok) {
    logWarn(
      `[deps] Restored global snapshot does not cover current demand (${demandFacts.failure.reason ?? "unknown"}); repairing`,
    );
    return false;
  }
  try {
    const coverage = publishGeneration(options.depsRoot, demandFacts.demands);
    if (!coverage.covered) {
      logWarn(
        `[deps] Restored global snapshot does not cover current demand ` +
          `(dpl-runtime-demand-uncovered${coverage.reason ? `, detail=${coverage.reason}` : ""}); repairing`,
      );
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

export function collectNativeExternalModules(plan: BuildPlan, configuredExternals: readonly string[]): string[] {
  const externals = new Set<string>();

  for (const chunk of plan.chunks) {
    for (const mod of chunk.modules) {
      for (const dep of [...(mod.deps ?? []), ...(mod.dynamicDeps ?? [])]) {
        if (isExternalGraphLeafId(dep, configuredExternals)) {
          externals.add(dep);
        }
      }
    }
  }

  return Array.from(externals).sort();
}

/**
 * T3 — Route node_modules deps through deps optimizer artifacts.
 *
 * Consumes DPL's native publication-closure facts, builds a reverse map from
 * canonical route-active entry paths to artifact paths, then walks the build plan:
 *   - Entry modules (matching a manifest entry) are rerouted to the pre-built artifact,
 *     their hash is recomputed from artifact bytes, and the artifact is written into CAS.
 *   - Internal transitive modules (node_modules files that are NOT direct entries) are
 *     pruned from the plan since the entry artifact already bundles them.
 *   - DPL dependencyImports/sharedImports/packageGraph facts replace source topology
 *     recursively. Every published artifact is hydrated into Tier-1 CAS exactly once;
 *     wrapper bytes are never reparsed by TS to infer dependency ownership.
 *
 * Returns `{ rerouted, pruned, sharedPrewarmed }` counts.
 */
export function rerouteDepsArtifacts(options: {
  plan: BuildPlan;
  depsRoot: string;
  casRoot: string;
  configHash: string;
  workspaceRoot: string;
}): { rerouted: number; pruned: number; sharedPrewarmed: number; idRewritten: number } {
  const { plan, depsRoot, casRoot, configHash, workspaceRoot } = options;
  // G2-C3: authority is no longer transported as an out-of-band set. Each module
  // the reroute reroutes/injects is stamped with its owning authority's
  // `proofKind` directly on the plan module (DplContentHash), so the plan is
  // self-describing and admission dispatches on it — no side-channel.

  type DplRerouteArtifact = {
    outFile: string;
    artifactPath: string;
    artifactHash: string;
    artifactTopology: "wrapper" | "esm-native" | "esm-native-slim";
    dependencyAbi: NonNullable<BuildPlan["chunks"][number]["modules"][number]["dependencyAbi"]>;
    sharedImports: string[];
    dependencyImports: string[];
    graphFiles: Array<{
      outFile: string;
      artifactPath: string;
      dependencyAbi: NonNullable<BuildPlan["chunks"][number]["modules"][number]["dependencyAbi"]>;
    }>;
  };
  const depsArtifactsByEntry = new Map<string, DplRerouteArtifact>();
  const publishedArtifacts: DplRerouteArtifact[] = [];
  const readActivePublications = native?.depsActivePublications;
  if (!readActivePublications) {
    throw new Error("[deps] DPL publication-closure authority is unavailable");
  }
  try {
    const publications = readActivePublications(depsRoot);
    for (const publication of publications) {
      const outFile = publication.outFile;
      if (path.basename(outFile) !== outFile || !outFile.endsWith(".js")) {
        throw new Error(`[deps] DPL published an invalid artifact path: ${outFile}`);
      }
      const artifactPath = path.join(depsRoot, outFile);
      const topology = normalizeManifestString(publication.artifactTopology);
      const artifactTopology: "wrapper" | "esm-native" | "esm-native-slim" =
        topology === "esm-native" || topology === "esm-native-slim" || topology === "wrapper"
          ? topology
          : "wrapper";
      const exportAbi = publication.exportAbi;
      if (
        !exportAbi ||
        !Number.isInteger(exportAbi.version) ||
        exportAbi.version <= 0 ||
        typeof exportAbi.abiHash !== "string" ||
        exportAbi.abiHash.length === 0
      ) {
        throw new Error(`[deps] DPL publication ${outFile} has no transportable export ABI`);
      }
      const dependencyAbi = {
        version: exportAbi.version,
        names: Array.from(new Set(exportAbi.names)).sort(),
        hasDefault: exportAbi.hasDefault,
        uncertain: exportAbi.uncertain,
        abiHash: exportAbi.abiHash,
        imports: publication.dependencyImportAbi.map((dependency) => ({
          outFile: dependency.outFile,
          mode: dependency.mode,
          names: Array.from(new Set(dependency.names)).sort(),
          hasDefault: dependency.hasDefault,
          hasNamespace: dependency.hasNamespace,
          hasSideEffect: dependency.hasSideEffect,
          hasExportStar: dependency.hasExportStar,
          uncertain: dependency.uncertain,
        })),
      };
      const graphAbiByOutFile = new Map(
        publication.packageGraphFileAbi.map((file) => [file.outFile, file] as const),
      );
      const artifact: DplRerouteArtifact = {
        outFile,
        artifactPath,
        artifactHash: publication.artifactHash,
        artifactTopology,
        dependencyAbi,
        sharedImports: Array.from(new Set(publication.sharedImports)).sort(),
        dependencyImports: Array.from(new Set(publication.dependencyImports)).sort(),
        graphFiles: Array.from(new Set(publication.packageGraphFiles))
          .filter((graphOutFile) => graphOutFile !== outFile)
          .sort()
          .map((graphOutFile) => ({
            outFile: graphOutFile,
            artifactPath: path.join(depsRoot, graphOutFile),
            dependencyAbi: {
              version: exportAbi.version,
              names: Array.from(new Set(graphAbiByOutFile.get(graphOutFile)?.exports ?? [])).sort(),
              hasDefault: (graphAbiByOutFile.get(graphOutFile)?.exports ?? []).includes("default"),
              uncertain: false,
              abiHash: exportAbi.abiHash,
              imports: [],
            },
          })),
      };
      publishedArtifacts.push(artifact);
      for (const member of publication.publicationMembers ?? []) {
        const memberTopology = normalizeManifestString(member.artifactTopology);
        const artifactTopology: "wrapper" | "esm-native" | "esm-native-slim" =
          memberTopology === "esm-native" || memberTopology === "esm-native-slim" || memberTopology === "wrapper"
            ? memberTopology
            : "wrapper";
        const memberAbi = member.exportAbi;
        if (
          path.basename(member.outFile) !== member.outFile ||
          !member.outFile.endsWith(".js") ||
          !member.artifactHash ||
          !memberAbi ||
          !Number.isInteger(memberAbi.version) ||
          memberAbi.version <= 0 ||
          !memberAbi.abiHash
        ) {
          throw new Error(`[deps] DPL publication member ${member.outFile} has an invalid artifact contract`);
        }
        const memberDependencyAbi = {
          version: memberAbi.version,
          names: Array.from(new Set(memberAbi.names)).sort(),
          hasDefault: memberAbi.hasDefault,
          uncertain: memberAbi.uncertain,
          abiHash: memberAbi.abiHash,
          imports: member.dependencyImportAbi.map((dependency) => ({
            outFile: dependency.outFile,
            mode: dependency.mode,
            names: Array.from(new Set(dependency.names)).sort(),
            hasDefault: dependency.hasDefault,
            hasNamespace: dependency.hasNamespace,
            hasSideEffect: dependency.hasSideEffect,
            hasExportStar: dependency.hasExportStar,
            uncertain: dependency.uncertain,
          })),
        };
        publishedArtifacts.push({
          outFile: member.outFile,
          artifactPath: path.join(depsRoot, member.outFile),
          artifactHash: member.artifactHash,
          artifactTopology,
          dependencyAbi: memberDependencyAbi,
          sharedImports: [],
          dependencyImports: memberDependencyAbi.imports.map((dependency) => dependency.outFile),
          graphFiles: [],
        });
      }
      if (!publication.routeActive) continue;
      const canonicalEntry = canonicalFsPath(publication.entryPath);
      if (depsArtifactsByEntry.has(canonicalEntry)) {
        throw new Error(`[deps] DPL published multiple active routes for ${publication.entryPath}`);
      }
      depsArtifactsByEntry.set(canonicalEntry, artifact);
    }
  } catch (error) {
    throw new Error(`[deps] Failed to consume DPL publication closure: ${String(error)}`);
  }

  if (depsArtifactsByEntry.size === 0)
    return { rerouted: 0, pruned: 0, sharedPrewarmed: 0, idRewritten: 0 };
  const depsArtifactsByOutFile = new Map<string, DplRerouteArtifact>();
  for (const artifact of publishedArtifacts) {
    const existing = depsArtifactsByOutFile.get(artifact.outFile);
    if (existing) {
      const existingContract = JSON.stringify({
        hash: existing.artifactHash,
        topology: existing.artifactTopology,
        shared: existing.sharedImports,
        dependencies: existing.dependencyImports,
        graph: existing.graphFiles.map((file) => file.outFile),
        abi: existing.dependencyAbi.abiHash,
      });
      const nextContract = JSON.stringify({
        hash: artifact.artifactHash,
        topology: artifact.artifactTopology,
        shared: artifact.sharedImports,
        dependencies: artifact.dependencyImports,
        graph: artifact.graphFiles.map((file) => file.outFile),
        abi: artifact.dependencyAbi.abiHash,
      });
      if (existingContract !== nextContract) {
        throw new Error(`[deps] DPL publication conflict for ${artifact.outFile}`);
      }
      continue;
    }
    depsArtifactsByOutFile.set(artifact.outFile, artifact);
  }

  let rerouted = 0;
  let pruned = 0;
  let idRewritten = 0;

  // ── Identity reroute (dep-boundary invariant) ────────────────────────────────
  // A rerouted dep leaf must also stop carrying its raw `ws://node_modules/...`
  // identity into the plan/manifest. Its single identity becomes the optimized
  // `.ionify/deps/<hash>/<wrapper>` artifact — mirroring dev, where the served
  // import is already `/@deps/<wrapper>` and node_modules is provenance only,
  // never the routing identity. `idRemap` (old node_modules id → artifact id) is
  // applied to every surviving module's dep edges in a second pass so no consumer
  // references a raw node_modules identity either.
  const idRemap = new Map<string, string>();

  // Two distinct node_modules plan modules (e.g. different pnpm virtual paths for
  // the same package) can resolve to the SAME `.ionify/deps` artifact. They are the
  // same dependency: keep exactly one plan module under the artifact id and drop the
  // rest, remapping every old id to the survivor. This preserves single ownership and
  // prevents the chunk surface from emitting the same synthetic export name twice
  // (which would trip swc_bundler's span-hygiene invariant).
  const claimedNewIds = new Set<string>();

  const dplArtifactByModuleId = new Map<
    string,
    DplRerouteArtifact
  >();

  for (const chunk of plan.chunks) {
    const keptModules: typeof chunk.modules = [];
    for (const mod of chunk.modules) {
      let fsPath: string | null =
        typeof mod.fsPath === "string" && mod.fsPath.length > 0 ? mod.fsPath : null;
      if (!fsPath && typeof mod.id === "string" && mod.id.startsWith(WS_MODULE_PREFIX)) {
        fsPath = fromWsModuleId(mod.id, workspaceRoot);
      }
      if (!fsPath && typeof mod.id === "string" && path.isAbsolute(mod.id)) {
        fsPath = mod.id;
      }

      let canonical: string | null = null;
      if (fsPath) {
        try {
          canonical = fs.realpathSync.native(fsPath);
        } catch {
          canonical = path.resolve(fsPath);
        }
      }

      const artifact = canonical ? depsArtifactsByEntry.get(canonical) : null;
      const isNodeModules = fsPath ? fsPath.includes("node_modules") : mod.id.includes("node_modules");
      if (!artifact && !isNodeModules) {
        // G2-C3: workspace Transform-domain source is Transform-owned. Stamp the
        // required admission contract POSITIVELY (this is a workspace source
        // module, not "whatever DPL didn't claim"). CSS keeps its own authority
        // (CSSA) and receives a CssProof kind in a later increment; a consumable
        // JS class not covered here reaches admission unstamped → fails closed.
        if (mod.kind === "js") (mod as any).proofKind = "TransformArtifactProof";
        keptModules.push(mod);
        continue;
      }

      if (artifact) {
        // ── CAS-First fast path ──────────────────────────────────────────────
        // When the optimizer persisted artifactHash in the manifest we can skip
        // readFileSync + getCacheKey (SHA-256 over up to 600 KB) entirely.
        // We still need to ensure the CAS file exists; on the very first build
        // after a re-optimization the CAS slot may be cold, so we do one read
        // only when necessary (cache miss), not unconditionally.
        let resolvedHash: string;
        const artifactCasDir = artifact.artifactHash
          ? getCasArtifactPath(casRoot, configHash, artifact.artifactHash)
          : null;
        const artifactCasFile = artifactCasDir ? path.join(artifactCasDir, "transformed.js") : null;

        if (
          artifact.artifactHash &&
          artifactCasFile &&
          fs.existsSync(artifactCasFile) &&
          casTextFileMatchesHash(artifactCasFile, artifact.artifactHash)
        ) {
          // Full fast path: hash known + CAS warm + content-addressed slot verified.
          resolvedHash = artifact.artifactHash;
        } else {
          // Fallback: read the artifact bytes to compute hash and/or fill CAS.
          const artifactCode = fs.readFileSync(artifact.artifactPath, "utf8");
          resolvedHash = artifact.artifactHash || getCacheKey(artifactCode);
          const casDir = getCasArtifactPath(casRoot, configHash, resolvedHash);
          const casFile = path.join(casDir, "transformed.js");
          fs.mkdirSync(casDir, { recursive: true });
          fs.writeFileSync(casFile, artifactCode, "utf8");
        }

        mod.fsPath = artifact.artifactPath;
        mod.hash = resolvedHash;
        mod.artifactTopology = artifact.artifactTopology;
        mod.dependencyAbi = artifact.dependencyAbi;
        mod.dependencyAbiHash = artifact.dependencyAbi.abiHash;
        // Normalize kind: T19 dep-leaf nodes have kind="dep" so the BFS recognises them
        // as artifact boundaries. After rerouting they are concrete JS artifact files;
        // all downstream consumers (CAS hydration loop, Rust bundler) expect kind="js".
        (mod as any).kind = "js";

        // Identity reroute: replace the raw node_modules id with the artifact id so
        // the plan/manifest carries only the dep-artifact boundary (never node_modules).
        // Resolution is unaffected — consumers import `/@deps/<wrapper>` (resolved by
        // the Rust loader to the artifact path), so the id is a label, not a route.
        const oldId = typeof mod.id === "string" ? mod.id : null;
        let newId: string | null = null;
        try {
          newId = toWsModuleId(artifact.artifactPath, workspaceRoot);
        } catch {
          newId = null;
        }
        if (oldId && newId && oldId !== newId) {
          idRemap.set(oldId, newId);
          if (claimedNewIds.has(newId)) {
            // Duplicate of an artifact already kept as a plan module — drop this one.
            // Its old id still resolves to the survivor via idRemap in the dep-edge pass.
            pruned += 1;
            continue;
          }
          claimedNewIds.add(newId);
          mod.id = newId;
          idRewritten += 1;
        }

        if (newId) dplArtifactByModuleId.set(newId, artifact);

        // G2-C3: DPL owns this artifact's identity + integrity contract. Stamp the
        // required admission contract (transporting DPL's decision; membership came
        // from depsActivePublications, not a path guess).
        (mod as any).proofKind = "DplContentHash";
        keptModules.push(mod);
        rerouted += 1;

      } else {
        pruned += 1;
      }
    }
    chunk.modules = keptModules;
  }

  // ── Pass 2: remap dependency edges off raw node_modules identities ───────────
  // After rerouting, no surviving module may reference a node_modules id in its
  // deps/dynamicDeps. Kept dep leaves → their artifact id; pruned transitive deps
  // (already bundled inside a wrapper, so not standalone plan modules) → dropped.
  // This keeps the manifest dep graph self-consistent with the rerouted identities.
  if (idRemap.size > 0 || pruned > 0) {
    const remapDepList = (list: string[]): string[] => {
      const out: string[] = [];
      const seen = new Set<string>();
      for (const dep of list) {
        let mapped: string | null = dep;
        if (idRemap.has(dep)) {
          mapped = idRemap.get(dep)!;
        } else if (typeof dep === "string" && dep.includes("node_modules")) {
          // Pruned transitive (no standalone artifact) — bundled inside a wrapper.
          mapped = null;
        }
        if (mapped && !seen.has(mapped)) {
          seen.add(mapped);
          out.push(mapped);
        }
      }
      return out;
    };
    for (const chunk of plan.chunks) {
      for (const mod of chunk.modules) {
        if (Array.isArray(mod.deps)) mod.deps = remapDepList(mod.deps);
        if (Array.isArray((mod as any).dynamicDeps)) {
          (mod as any).dynamicDeps = remapDepList((mod as any).dynamicDeps);
        }
        if (Array.isArray(mod.runtimeLinks)) {
          mod.runtimeLinks = mod.runtimeLinks.flatMap((link) => {
            const [targetId] = remapDepList([link.targetId]);
            return targetId ? [{ ...link, targetId }] : [];
          });
        }
      }
    }
  }

  let sharedPrewarmed = 0;

  // DPL topology replaces the source graph at the dependency boundary. Build
  // recursively admits only DPL-published outFiles and never derives package
  // identity or reparses wrapper bytes to rediscover dependency ownership.
  const owners = new Map<
    string,
    { chunk: BuildPlan["chunks"][number]; mod: BuildPlan["chunks"][number]["modules"][number] }
  >();
  for (const chunk of plan.chunks) {
    for (const mod of chunk.modules) {
      const existing = owners.get(mod.id);
      if (existing && dplArtifactByModuleId.has(mod.id)) {
        throw new Error(`[deps] DPL artifact has multiple plan owners: ${mod.id}`);
      }
      if (!existing) owners.set(mod.id, { chunk, mod });
    }
  }

  const moduleIdForOutFile = (outFile: string): string => {
    if (path.basename(outFile) !== outFile || !outFile.endsWith(".js")) {
      throw new Error(`[deps] Invalid DPL topology outFile: ${outFile}`);
    }
    const artifactPath = path.join(depsRoot, outFile);
    return toWsModuleId(artifactPath, workspaceRoot) ?? artifactPath;
  };
  const hydrateArtifact = (artifactPath: string, expectedHash = ""): string => {
    if (!fs.existsSync(artifactPath)) {
      throw new Error(`[deps] DPL topology artifact is missing: ${path.basename(artifactPath)}`);
    }
    const code = fs.readFileSync(artifactPath, "utf8");
    const hash = getCacheKey(code);
    if (expectedHash && expectedHash !== hash) {
      throw new Error(`[deps] DPL artifact hash mismatch: ${path.basename(artifactPath)}`);
    }
    const casDir = getCasArtifactPath(casRoot, configHash, hash);
    const casFile = path.join(casDir, "transformed.js");
    if (!fs.existsSync(casFile) || !casTextFileMatchesHash(casFile, hash)) {
      fs.mkdirSync(casDir, { recursive: true });
      fs.writeFileSync(casFile, code, "utf8");
    }
    return hash;
  };

  const queue = Array.from(dplArtifactByModuleId.keys());
  const visited = new Set<string>();
  const sharedInjected = new Set<string>();
  while (queue.length > 0) {
    const moduleId = queue.shift()!;
    if (!visited.add(moduleId)) continue;
    const artifact = dplArtifactByModuleId.get(moduleId);
    const owner = owners.get(moduleId);
    if (!artifact || !owner) {
      throw new Error(`[deps] DPL topology owner is missing for ${moduleId}`);
    }

    const declared = [
      ...artifact.dependencyImports.map((outFile) => ({
        outFile,
        kind: "dependency" as const,
        dependencyAbi: undefined,
      })),
      ...artifact.sharedImports.map((outFile) => ({
        outFile,
        kind: "shared" as const,
        dependencyAbi: undefined,
      })),
      ...artifact.graphFiles.map((file) => ({
        outFile: file.outFile,
        kind: "graph" as const,
        dependencyAbi: file.dependencyAbi,
      })),
    ];
    const dependencyIds: string[] = [];
    for (const target of declared) {
      const targetPath = path.join(depsRoot, target.outFile);
      const targetId = moduleIdForOutFile(target.outFile);
      dependencyIds.push(targetId);
      const targetArtifact = depsArtifactsByOutFile.get(target.outFile);
      if (target.kind === "dependency" && !targetArtifact) {
        throw new Error(`[deps] DPL dependencyImport is unpublished: ${target.outFile}`);
      }
      if (!owners.has(targetId)) {
        const hash = hydrateArtifact(targetPath, targetArtifact?.artifactHash ?? "");
        const targetModule: BuildPlan["chunks"][number]["modules"][number] = {
          id: targetId,
          fsPath: targetPath,
          hash,
          kind: "js",
          deps: [],
          dynamicDeps: [],
          artifactTopology:
            targetArtifact?.artifactTopology ?? (target.kind === "graph" ? "esm-native" : undefined),
          dependencyAbi: targetArtifact?.dependencyAbi ?? target.dependencyAbi,
          dependencyAbiHash:
            targetArtifact?.dependencyAbi.abiHash ?? target.dependencyAbi?.abiHash,
          // G2-C3: DPL-injected dependency/shared/graph target → DPL contract.
          proofKind: "DplContentHash",
        };
        owner.chunk.modules.push(targetModule);
        owners.set(targetId, { chunk: owner.chunk, mod: targetModule });
        if (target.kind === "shared" && sharedInjected.add(targetId)) sharedPrewarmed += 1;
      }
      if (targetArtifact) {
        dplArtifactByModuleId.set(targetId, targetArtifact);
        queue.push(targetId);
      }
    }
    owner.mod.deps = Array.from(new Set(dependencyIds));
    owner.mod.dynamicDeps = [];
  }

  return { rerouted, pruned, sharedPrewarmed, idRewritten };
}

function stablePlanChunkId(prefix: string, moduleIds: string[]): string {
  const sorted = [...moduleIds].sort();
  const digest = crypto.createHash("sha256").update(sorted.join("\u001f")).digest("hex");
  return `${prefix}-${digest.slice(0, 8)}`;
}

function estimateCanonicalPlanModuleBytes(mod: BuildPlan["chunks"][number]["modules"][number], workspaceRoot: string): number {
  let fsPath = typeof mod.fsPath === "string" && mod.fsPath.length > 0 ? mod.fsPath : "";
  if (!fsPath && typeof mod.id === "string" && mod.id.startsWith(WS_MODULE_PREFIX)) {
    fsPath = fromWsModuleId(mod.id, workspaceRoot) ?? "";
  }
  if (!fsPath && typeof mod.id === "string" && path.isAbsolute(mod.id)) {
    fsPath = mod.id;
  }
  if (!fsPath || !path.isAbsolute(fsPath)) return 1;
  try {
    const stat = fs.statSync(fsPath);
    return Math.max(1, stat.size);
  } catch {
    return 1;
  }
}

type DepsArtifactPlanningFact = {
  chunkGroup: string | null;
  dependencies: string[];
};

function buildDepsArtifactCostIndex(depsRoot: string): Map<string, DepsArtifactPlanningFact> {
  const out = new Map<string, DepsArtifactPlanningFact>();
  const manifestPath = path.join(depsRoot, "manifest.json");
  if (!fs.existsSync(manifestPath)) return out;
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const entries: Record<string, any> = parsed?.entries ?? {};
    for (const entry of Object.values(entries)) {
      const outFile = (entry as any)?.outFile ?? (entry as any)?.out_file;
      if (typeof outFile !== "string" || outFile.length === 0) continue;
      const chunkGroupRaw = (entry as any)?.chunkGroup ?? (entry as any)?.chunk_group;
      const declaredChunkGroup =
        typeof chunkGroupRaw === "string" && chunkGroupRaw.length > 0 ? chunkGroupRaw : null;
      const packageGraph = (entry as any)?.packageGraph ?? (entry as any)?.package_graph;
      const packageGraphFiles =
        packageGraph && packageGraph.status === "ready" && Array.isArray(packageGraph.files)
          ? packageGraph.files
          : [];
      // A DPL packageGraph is one emitted dependency artifact split into local
      // ESM files. Its entry and closure files must remain an atomic planning
      // unit just like a declared chunkGroup; splitting them can create a
      // reverse vendor edge when an external dependency lands in an earlier
      // partition. The group key is derived only from DPL's outFile identity.
      const chunkGroup =
        declaredChunkGroup ?? (packageGraphFiles.length > 0 ? `package-graph:${outFile}` : null);
      const fact: DepsArtifactPlanningFact = {
        chunkGroup,
        dependencies: [
          ...(Array.isArray((entry as any)?.dependencyImports)
            ? (entry as any).dependencyImports
                .map((dependency: any) => dependency?.outFile ?? dependency?.out_file)
                .filter((file: unknown): file is string => typeof file === "string" && file.endsWith(".js"))
            : []),
          ...(Array.isArray((entry as any)?.sharedImports)
            ? (entry as any).sharedImports.filter(
                (file: unknown): file is string => typeof file === "string" && file.endsWith(".js"),
              )
            : []),
        ],
      };
      out.set(outFile, fact);

      if (chunkGroup && packageGraphFiles.length > 0) {
        for (const graphFile of packageGraphFiles) {
          const graphOutFile = graphFile?.outFile ?? graphFile?.out_file;
          if (typeof graphOutFile !== "string" || !graphOutFile.endsWith(".js")) continue;
          const existing = out.get(graphOutFile);
          if (existing?.chunkGroup && existing.chunkGroup !== chunkGroup) {
            // Conflicting DPL proofs fail closed to a standalone unit.
            existing.chunkGroup = null;
            continue;
          }
          out.set(graphOutFile, {
            chunkGroup,
            dependencies: existing?.dependencies ?? [],
          });
        }
      }

      // DPL chunk groups are atomic runtime units. The shared chunk has no
      // standalone manifest entry, so project its group proof from each member's
      // chunkFiles list onto the synthetic shared artifact consumed by the plan.
      const chunkFilesRaw = (entry as any)?.chunkFiles ?? (entry as any)?.chunk_files;
      if (declaredChunkGroup && Array.isArray(chunkFilesRaw)) {
        for (const chunkFile of chunkFilesRaw) {
          if (typeof chunkFile !== "string" || !chunkFile.endsWith(".js")) continue;
          const existing = out.get(chunkFile);
          if (existing && existing.chunkGroup && existing.chunkGroup !== declaredChunkGroup) {
            // Conflicting DPL proofs are not safe to merge speculatively.
            existing.chunkGroup = null;
            continue;
          }
          out.set(chunkFile, {
            chunkGroup: declaredChunkGroup,
            dependencies: existing?.dependencies ?? [],
          });
        }
      }
    }
  } catch {
    return out;
  }
  return out;
}

type CanonicalVendorPlanningUnit = {
  modules: BuildPlan["chunks"][number]["modules"];
  cost: number;
  outFiles: Set<string>;
  dependencies: Set<string>;
  order: number;
};

function orderCanonicalVendorPlanningUnits(
  units: CanonicalVendorPlanningUnit[],
): CanonicalVendorPlanningUnit[] {
  if (units.length < 2) return units;

  const unitByOutFile = new Map<string, number>();
  units.forEach((unit, index) => {
    for (const outFile of unit.outFiles) unitByOutFile.set(outFile, index);
  });
  const edges = units.map(() => new Set<number>());
  units.forEach((unit, index) => {
    for (const dependency of unit.dependencies) {
      const target = unitByOutFile.get(dependency);
      if (target !== undefined && target !== index) edges[index]!.add(target);
    }
  });

  let nextIndex = 0;
  const indices = new Array<number>(units.length).fill(-1);
  const lowLinks = new Array<number>(units.length).fill(0);
  const stack: number[] = [];
  const onStack = new Array<boolean>(units.length).fill(false);
  const components: number[][] = [];
  const visit = (node: number): void => {
    indices[node] = nextIndex;
    lowLinks[node] = nextIndex;
    nextIndex += 1;
    stack.push(node);
    onStack[node] = true;
    for (const target of edges[node]!) {
      if (indices[target] === -1) {
        visit(target);
        lowLinks[node] = Math.min(lowLinks[node]!, lowLinks[target]!);
      } else if (onStack[target]) {
        lowLinks[node] = Math.min(lowLinks[node]!, indices[target]!);
      }
    }
    if (lowLinks[node] !== indices[node]) return;
    const component: number[] = [];
    while (stack.length > 0) {
      const member = stack.pop()!;
      onStack[member] = false;
      component.push(member);
      if (member === node) break;
    }
    component.sort((a, b) => units[a]!.order - units[b]!.order);
    components.push(component);
  };
  for (let index = 0; index < units.length; index += 1) {
    if (indices[index] === -1) visit(index);
  }

  const componentByUnit = new Array<number>(units.length);
  components.forEach((component, componentIndex) => {
    for (const unitIndex of component) componentByUnit[unitIndex] = componentIndex;
  });
  const merged = components.map((component) => {
    const members = component.map((index) => units[index]!);
    return {
      modules: members.flatMap((unit) => unit.modules),
      cost: members.reduce((sum, unit) => sum + unit.cost, 0),
      outFiles: new Set(members.flatMap((unit) => [...unit.outFiles])),
      dependencies: new Set(members.flatMap((unit) => [...unit.dependencies])),
      order: Math.min(...members.map((unit) => unit.order)),
    } satisfies CanonicalVendorPlanningUnit;
  });

  // Dependency-first topological order. A contiguous partition of this order
  // cannot invent a reverse chunk edge from unrelated modules sharing a bin.
  const consumers = merged.map(() => new Set<number>());
  const indegree = new Array<number>(merged.length).fill(0);
  edges.forEach((targets, sourceUnit) => {
    const source = componentByUnit[sourceUnit]!;
    for (const targetUnit of targets) {
      const dependency = componentByUnit[targetUnit]!;
      if (source === dependency || consumers[dependency]!.has(source)) continue;
      consumers[dependency]!.add(source);
      indegree[source] += 1;
    }
  });
  const ready = merged
    .map((_, index) => index)
    .filter((index) => indegree[index] === 0)
    .sort((a, b) => merged[a]!.order - merged[b]!.order);
  const ordered: CanonicalVendorPlanningUnit[] = [];
  while (ready.length > 0) {
    const component = ready.shift()!;
    ordered.push(merged[component]!);
    for (const consumer of consumers[component]!) {
      indegree[consumer] -= 1;
      if (indegree[consumer] === 0) {
        ready.push(consumer);
        ready.sort((a, b) => merged[a]!.order - merged[b]!.order);
      }
    }
  }
  return ordered.length === merged.length ? ordered : merged.sort((a, b) => a.order - b.order);
}

function expandCanonicalVendorPlanningDependencies(
  units: CanonicalVendorPlanningUnit[],
  costIndex: Map<string, DepsArtifactPlanningFact>,
): void {
  const plannedOutFiles = new Set<string>();
  for (const unit of units) {
    for (const outFile of unit.outFiles) plannedOutFiles.add(outFile);
  }

  const memo = new Map<string, Set<string>>();
  const resolving = new Set<string>();
  const resolveToPlanned = (outFile: string): Set<string> => {
    if (plannedOutFiles.has(outFile)) return new Set([outFile]);
    const cached = memo.get(outFile);
    if (cached) return cached;
    if (resolving.has(outFile)) return new Set();
    const fact = costIndex.get(outFile);
    if (!fact) return new Set();

    resolving.add(outFile);
    const resolved = new Set<string>();
    for (const dependency of fact.dependencies) {
      for (const planned of resolveToPlanned(dependency)) resolved.add(planned);
    }
    resolving.delete(outFile);
    memo.set(outFile, resolved);
    return resolved;
  };

  for (const unit of units) {
    const expanded = new Set<string>();
    for (const dependency of unit.dependencies) {
      for (const planned of resolveToPlanned(dependency)) expanded.add(planned);
    }
    unit.dependencies = expanded;
  }
}

function canonicalPlanModuleCost(
  mod: BuildPlan["chunks"][number]["modules"][number],
  workspaceRoot: string,
): { bytes: number; cost: number } {
  const bytes = estimateCanonicalPlanModuleBytes(mod, workspaceRoot);
  // rerouteDepsArtifacts materializes the complete DPL publication closure
  // before this partitioner runs: dependencyImports, sharedImports, and every
  // packageGraph file are concrete plan modules, while missing facts fail the
  // build. Their emitted file sizes therefore already are the complete byte
  // cost. Re-applying root-level module/edge estimates here counts the same
  // closure twice and invents cross-chunk boundaries inside a complete graph.
  return { bytes, cost: bytes };
}

export function rebalanceCanonicalVendorChunks(options: {
  plan: BuildPlan;
  depsRoot: string;
  workspaceRoot: string;
  maxBytes: number | null;
}): { before: number; after: number; modules: number; totalEstimatedBytes: number } {
  const maxBytes = typeof options.maxBytes === "number" && options.maxBytes > 0 ? options.maxBytes : null;
  if (maxBytes === null) return { before: 0, after: 0, modules: 0, totalEstimatedBytes: 0 };

  const vendorEntries = options.plan.chunks
    .map((chunk, index) => ({ chunk, index }))
    .filter(({ chunk }) => chunk.id.startsWith("chunk-vendor"));
  if (vendorEntries.length === 0) return { before: 0, after: 0, modules: 0, totalEstimatedBytes: 0 };

  const seenModules = new Set<string>();
  const vendorModules: BuildPlan["chunks"][number]["modules"] = [];
  const consumers = new Set<string>();
  for (const { chunk } of vendorEntries) {
    for (const consumer of chunk.consumers ?? []) consumers.add(consumer);
    for (const mod of chunk.modules) {
      if (seenModules.has(mod.id)) continue;
      seenModules.add(mod.id);
      vendorModules.push(mod);
    }
  }
  if (vendorModules.length === 0) {
    return { before: vendorEntries.length, after: 0, modules: 0, totalEstimatedBytes: 0 };
  }

  const costIndex = buildDepsArtifactCostIndex(options.depsRoot);
  const estimated = vendorModules.map((mod) => ({
    mod,
    ...canonicalPlanModuleCost(mod, options.workspaceRoot),
    outFile: path.basename(mod.id),
    chunkGroup: costIndex.get(path.basename(mod.id))?.chunkGroup ?? null,
    dependencies: costIndex.get(path.basename(mod.id))?.dependencies ?? [],
  }));
  const totalEstimatedBytes = estimated.reduce((sum, entry) => sum + entry.bytes, 0);
  const totalPlanningCost = estimated.reduce((sum, entry) => sum + entry.cost, 0);
  const planningUnits: CanonicalVendorPlanningUnit[] = [];
  const unitByKey = new Map<string, CanonicalVendorPlanningUnit>();
  for (const [order, entry] of estimated.entries()) {
    const key = entry.chunkGroup ? `dpl:${entry.chunkGroup}` : `module:${entry.mod.id}`;
    let unit = unitByKey.get(key);
    if (!unit) {
      unit = { modules: [], cost: 0, outFiles: new Set(), dependencies: new Set(), order };
      unitByKey.set(key, unit);
      planningUnits.push(unit);
    }
    unit.modules.push(entry.mod);
    unit.cost += entry.cost;
    unit.outFiles.add(entry.outFile);
    for (const dependency of entry.dependencies) unit.dependencies.add(dependency);
  }
  expandCanonicalVendorPlanningDependencies(planningUnits, costIndex);

  const orderedUnits = orderCanonicalVendorPlanningUnits(planningUnits);
  // Greedy first-fit against maxBytes fixes the bin COUNT; the final partition
  // then minimizes the maximum bin cost over the same dependency-first order
  // (linear partition via binary search on the cost cap). Greedy packs early
  // bins tight and hands every cut's overflow to one bin, and the bundler's
  // wall time is bound by its largest chunk's link+minify critical path — a
  // balanced contiguous partition keeps that path flat while preserving unit
  // atomicity, topological order, bin count, and the maxBytes promise (the
  // optimal cap is never above a cap greedy already proved feasible).
  const binCountFor = (cap: number): number => {
    let bins = 0;
    let cost = 0;
    let open = false;
    for (const unit of orderedUnits) {
      if (open && cost + unit.cost > cap) {
        open = false;
        cost = 0;
      }
      if (!open) {
        bins += 1;
        open = true;
      }
      cost += unit.cost;
    }
    return bins;
  };
  const targetBins = binCountFor(maxBytes);
  // A unit larger than any cap sits alone in its own bin (the scan closes the
  // bin at the next unit), so the search floor is 1, not the largest unit —
  // otherwise one oversized unit (e.g. a 4.3MB not-esm wrapper) would pin the
  // cap above maxBytes and disable balancing for every other bin.
  let low = 1;
  let high = Math.min(
    maxBytes,
    orderedUnits.reduce((sum, unit) => sum + unit.cost, 0),
  );
  let balancedCap = high;
  while (low <= high) {
    const cap = Math.floor((low + high) / 2);
    if (binCountFor(cap) <= targetBins) {
      balancedCap = cap;
      high = cap - 1;
    } else {
      low = cap + 1;
    }
  }

  const groups: BuildPlan["chunks"][number]["modules"][] = [];
  let current: BuildPlan["chunks"][number]["modules"] = [];
  let currentCost = 0;
  for (const unit of orderedUnits) {
    if (current.length > 0 && currentCost + unit.cost > balancedCap) {
      groups.push(current);
      current = [];
      currentCost = 0;
    }
    current.push(...unit.modules);
    currentCost += unit.cost;
  }
  if (current.length > 0) groups.push(current);

  const sortedConsumers = Array.from(consumers).sort();
  const nextVendorChunks = groups.map((modules) => ({
    id: stablePlanChunkId("chunk-vendor", modules.map((mod) => mod.id)),
    modules,
    entry: false,
    shared: true,
    consumers: sortedConsumers,
    css: modules.filter((mod) => mod.kind === "css").map((mod) => mod.id).sort(),
    assets: modules.filter((mod) => mod.kind === "asset").map((mod) => mod.id).sort(),
  }));

  const firstVendorIndex = vendorEntries[0]!.index;
  const vendorIndexSet = new Set(vendorEntries.map(({ index }) => index));
  const nextChunks = options.plan.chunks.filter((_, index) => !vendorIndexSet.has(index));
  nextChunks.splice(firstVendorIndex, 0, ...nextVendorChunks);
  options.plan.chunks = nextChunks;

  if (isBuildProfileEnabled()) {
    const top = estimated
      .slice()
      .sort((a, b) => b.bytes - a.bytes || a.mod.id.localeCompare(b.mod.id))
      .slice(0, 8)
      .map((entry) => `${entry.mod.id}=${entry.bytes}/${entry.cost}`)
      .join(",");
    logInfo(
      `[BuildProfile][canonicalVendorRebalance] before=${vendorEntries.length} after=${nextVendorChunks.length} modules=${vendorModules.length} maxBytes=${maxBytes} totalEstimatedBytes=${totalEstimatedBytes} totalPlanningCost=${totalPlanningCost} top=${top}`,
    );
  }

  return {
    before: vendorEntries.length,
    after: nextVendorChunks.length,
    modules: vendorModules.length,
    totalEstimatedBytes,
  };
}

export async function prepareCanonicalProductionDependencyPlan(options: {
  plan: BuildPlan;
  rootDir: string;
  ionifyDir: string;
  depsRoot: string;
  depsHash: string;
  resolvedEntries: string[] | undefined;
  allowedRoots: string[];
  casRoot: string;
  configHash: string;
  workspaceRoot: string;
  config?: any;
  vendorMaxBytes: number | null;
  skipDependencyCoverageRepair?: boolean;
}): Promise<{
  rerouted: number;
  pruned: number;
  sharedPrewarmed: number;
  idRewritten: number;
  rerouteMs: number;
  rebalancedVendorChunks: number;
}> {
  const coverageRepairStart = Date.now();
  if (!options.skipDependencyCoverageRepair) {
    await repairMissingPlanDependencyArtifacts({
      plan: options.plan,
      rootDir: options.rootDir,
      ionifyDir: options.ionifyDir,
      depsRoot: options.depsRoot,
      depsHash: options.depsHash,
      resolvedEntries: options.resolvedEntries,
      allowedRoots: options.allowedRoots,
      workspaceRoot: options.workspaceRoot,
      config: options.config,
    });
  }
  logBuildProfile("dependencyCoverageRepair", coverageRepairStart);

  writeDepsMeasurementArtifacts(options.depsRoot);

  const rerouteStart = Date.now();
  const { rerouted, pruned, sharedPrewarmed, idRewritten } = rerouteDepsArtifacts({
    plan: options.plan,
    depsRoot: options.depsRoot,
    casRoot: options.casRoot,
    configHash: options.configHash,
    workspaceRoot: options.workspaceRoot,
  });
  const rebalance = rebalanceCanonicalVendorChunks({
    plan: options.plan,
    depsRoot: options.depsRoot,
    workspaceRoot: options.workspaceRoot,
    maxBytes: options.vendorMaxBytes,
  });
  const rerouteMs = Date.now() - rerouteStart;

  // PDC is frozen for the Production Work Elimination path. DPL now owns
  // dependency artifact topology and the build consumes those artifacts
  // directly. Keeping PDC on the direct cold path only re-scans app source and
  // writes identity metadata that does not change emitted dependency bytes.
  return {
    rerouted,
    pruned,
    sharedPrewarmed,
    idRewritten,
    rerouteMs,
    rebalancedVendorChunks: rebalance.after,
  };
}

async function repairMissingPlanDependencyArtifacts(options: {
  plan: BuildPlan;
  rootDir: string;
  ionifyDir: string;
  depsRoot: string;
  depsHash: string;
  resolvedEntries: string[] | undefined;
  allowedRoots: string[];
  workspaceRoot: string;
  config?: any;
}): Promise<void> {
  if (!native?.optimizeDependenciesBatch && !native?.optimizeDependency) return;

  const coveredEntryPaths = new Set<string>();
  // Entries that fell back to a whole-package wrapper only because no export
  // demand reached them (e.g. alias node_modules instances of a logical entry
  // whose demand was attributed to a sibling instance). If current demand now
  // exists for their identity, they are repair-eligible: a re-optimization with
  // demand either slims them or records a different topology reason, so this
  // check self-quiesces after one repair.
  const demandlessWrapperByEntryPath = new Map<string, string>();
  const readActivePublications = native?.depsActivePublications;
  if (!readActivePublications) {
    throw new Error("[deps] DPL publication-closure authority is unavailable during plan coverage repair");
  }
  const currentPublications = readActivePublications(options.depsRoot);
  for (const publication of currentPublications) {
    if (!publication.routeActive || !publication.entryPath) continue;
    const canonical = canonicalFsPath(publication.entryPath);
    coveredEntryPaths.add(canonical);
    if (publication.artifactTopologyReason === "package-graph-no-export-demand") {
      demandlessWrapperByEntryPath.set(canonical, publication.entryPath);
    }
  }

  const missing = new Set<string>();
  const demandlessInPlan = new Set<string>();
  for (const chunk of options.plan.chunks) {
    for (const mod of chunk.modules) {
      let fsPath: string | null =
        typeof mod.fsPath === "string" && mod.fsPath.length > 0 ? mod.fsPath : null;
      if (!fsPath && typeof mod.id === "string" && mod.id.startsWith(WS_MODULE_PREFIX)) {
        fsPath = fromWsModuleId(mod.id, options.workspaceRoot);
      }
      if (!fsPath && typeof mod.id === "string" && path.isAbsolute(mod.id)) {
        fsPath = mod.id;
      }
      if (!fsPath || !fsPath.includes(`${path.sep}node_modules${path.sep}`)) continue;
      if (!isOptimizableDepEntryPath(fsPath)) continue;
      const canonical = canonicalFsPath(fsPath);
      if (!coveredEntryPaths.has(canonical)) missing.add(canonical);
      else if (demandlessWrapperByEntryPath.has(canonical)) demandlessInPlan.add(canonical);
    }
  }

  if (missing.size === 0 && demandlessInPlan.size === 0) return;

  fs.mkdirSync(options.depsRoot, { recursive: true });
  const dplDemand = await scanDplUsageDemand({
    rootDir: options.rootDir,
    depsRoot: options.depsRoot,
    depsHash: options.depsHash,
    resolvedEntries: options.resolvedEntries,
    allowedRoots: options.allowedRoots,
  });

  // Demand-less wrappers are re-submitted whenever demand facts exist; DPL owns
  // the identity decision (path or `pkg@version:subpath` adoption from the
  // usage-facts artifact). Entries whose effective demand is still empty are
  // cache hits inside the optimizer (persisted empty demand == effective empty
  // demand, unchanged source), so re-submission stays cheap and self-quiescing.
  if (dplDemand.demandByEntryPath.size > 0) {
    for (const canonical of demandlessInPlan) missing.add(canonical);
  }

  if (missing.size === 0) return;

  const sentinelPath = path.join(options.depsRoot, ".verified");
  try {
    fs.unlinkSync(sentinelPath);
  } catch {
    // The repair path is still valid when the sentinel was already absent.
  }

  const repairEntries = Array.from(missing).map((entryPath) =>
    withDplUsageDemand(entryPath, options.depsHash, dplDemand.demandByEntryPath),
  );

  let failed = 0;
  let singleRepairEntries: typeof repairEntries = [];
  if (native?.optimizeDependenciesBatch) {
    try {
      const results = native.optimizeDependenciesBatch(repairEntries, options.ionifyDir) ?? [];
      for (let index = 0; index < repairEntries.length; index++) {
        const result = results[index] as { error?: string | null } | undefined;
        if (result?.error) {
          failed += 1;
          singleRepairEntries.push(repairEntries[index]);
        }
      }
    } catch (err) {
      failed = repairEntries.length;
      singleRepairEntries = repairEntries.slice();
      logWarn(`[deps] WARN: Plan dependency coverage repair batch failed: ${String(err)}`);
    }
  } else {
    singleRepairEntries = repairEntries.slice();
  }

  if (singleRepairEntries.length > 0 && native?.optimizeDependency) {
    let singleFailures = 0;
    for (const entry of singleRepairEntries) {
      try {
        native.optimizeDependency(entry.entryPath, options.depsHash, false, true, options.ionifyDir);
      } catch {
        singleFailures += 1;
      }
    }
    failed = singleFailures;
  }

  const repairedEntryPaths = new Set<string>();
  const repairedPublications = readActivePublications(options.depsRoot);
  for (const publication of repairedPublications) {
    if (!publication.routeActive || !publication.entryPath) continue;
    repairedEntryPaths.add(canonicalFsPath(publication.entryPath));
  }
  const stillMissing = repairEntries.filter((entry) => !repairedEntryPaths.has(canonicalFsPath(entry.entryPath)));

  if (failed === 0 && stillMissing.length === 0) {
    await publishVerifiedDepsGeneration({
      rootDir: options.rootDir,
      depsRoot: options.depsRoot,
      depsHash: options.depsHash,
      resolvedEntries: options.resolvedEntries,
      allowedRoots: options.allowedRoots,
      config: options.config,
      runtimeDemands: dplDemand.runtimeDemands ?? undefined,
    });
    logInfo(`[deps] Repaired ${repairEntries.length} plan dependency artifact(s) before canonical reroute`);
  } else {
    const failedLabel = failed > 0 ? `, failed=${failed}` : "";
    const sample = stillMissing
      .slice(0, 5)
      .map((entry) => path.basename(entry.entryPath))
      .join(", ");
    logWarn(
      `[deps] WARN: Plan dependency coverage repair incomplete (missing=${stillMissing.length}${failedLabel}${sample ? `, sample=${sample}` : ""}); DBI will fail closed if raw deps remain`,
    );
  }
}

function casTextFileMatchesHash(filePath: string, expectedHash: string): boolean {
  try {
    return getCacheKey(fs.readFileSync(filePath, "utf8")) === expectedHash;
  } catch {
    return false;
  }
}

function computeBuildSlimmingSavedPercent(depsRoot: string, depsHash: string): number | null {
  // Best-effort: only reports when manual pack slimming is present on disk.
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(depsRoot);
  } catch {
    return null;
  }

  let totalFull = 0;
  let totalSlim = 0;

  const slimFiles = entries.filter((name) => name.startsWith("vendor-pack.manual.") && name.endsWith(".slim.json"));
  for (const fileName of slimFiles) {
    const group = fileName.slice("vendor-pack.manual.".length, -".slim.json".length);
    if (!group) continue;
    const baseStatePath = path.join(depsRoot, `vendor-pack.manual.${group}.json`);
    const slimStatePath = path.join(depsRoot, fileName);
    if (!fs.existsSync(baseStatePath) || !fs.existsSync(slimStatePath)) continue;

    try {
      const base = JSON.parse(fs.readFileSync(baseStatePath, "utf8"));
      const slim = JSON.parse(fs.readFileSync(slimStatePath, "utf8"));
      if (!base || !slim) continue;
      if (base.depsHash !== depsHash || slim.depsHash !== depsHash) continue;
      if (base.status !== "ready" || slim.status !== "ready") continue;
      const fullShared = typeof base.sharedFileName === "string" ? base.sharedFileName : null;
      const slimShared = typeof slim.sharedFileName === "string" ? slim.sharedFileName : null;
      if (!fullShared || !slimShared) continue;
      const fullPath = path.join(depsRoot, fullShared);
      const slimPath = path.join(depsRoot, slimShared);
      if (!fs.existsSync(fullPath) || !fs.existsSync(slimPath)) continue;
      const fullBytes = fs.statSync(fullPath).size;
      const slimBytes = fs.statSync(slimPath).size;
      if (fullBytes > 0 && slimBytes > 0 && slimBytes <= fullBytes) {
        totalFull += fullBytes;
        totalSlim += slimBytes;
      }
    } catch {
      // ignore parse/stat errors
    }
  }

  if (totalFull <= 0 || totalSlim <= 0) return null;
  const saved = totalFull - totalSlim;
  if (saved <= 0) return 0;
  return Math.round((saved * 100) / totalFull);
}

function computeBuildVendorPackRequestsSavedPercent(depsRoot: string, depsHash: string): number | null {
  const indexPath = path.join(depsRoot, "vendor-pack.v2.index.json");
  if (!fs.existsSync(indexPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    if (!raw || raw.version !== 1 || raw.depsHash !== depsHash) return null;
    const fileMap = raw.fileNameToPackFile;
    if (!fileMap || typeof fileMap !== "object") return null;
    const memberFiles = Object.keys(fileMap).filter((k) => typeof k === "string" && k.endsWith(".js"));
    const baseline = memberFiles.length;
    if (baseline === 0) return null;

    const packFiles = new Set<string>();
    for (const fileName of memberFiles) {
      const packFile = fileMap[fileName];
      if (typeof packFile === "string" && packFile.endsWith(".js")) {
        packFiles.add(packFile);
      }
    }

    const chunkMap = raw.packFileToChunkFiles ?? null;
    const sharedMap = raw.packFileToSharedFile ?? null;
    const chunks = new Set<string>();
    for (const packFile of Array.from(packFiles)) {
      const list = chunkMap && typeof chunkMap === "object" ? chunkMap[packFile] : null;
      if (Array.isArray(list)) {
        for (const entry of list) {
          if (typeof entry === "string" && entry.endsWith(".js")) chunks.add(entry);
        }
      } else if (sharedMap && typeof sharedMap === "object") {
        const shared = sharedMap[packFile];
        if (typeof shared === "string" && shared.endsWith(".js")) chunks.add(shared);
      }
    }

    const withPack = packFiles.size + chunks.size;
    if (withPack <= 0) return null;
    const saved = baseline - withPack;
    if (saved <= 0) return 0;
    return Math.round((saved * 100) / baseline);
  } catch {
    return null;
  }
}

type PackEntry = { entryPath: string; fileName: string; packageLabel: string; packageName?: string | null };
type DplPackRequestEntry = { entryPath: string; packageLabel: string };

type DplChunkedPublication = {
  chunkGroupId: string;
  chunkFiles: string[];
  sharedFileName: string;
  entries: PackEntry[];
};

type NativeChunkedPublicationResult = {
  chunk_group?: string;
  chunkGroup?: string;
  chunk_files?: string[];
  chunkFiles?: string[];
  entries?: Array<{
    entry_path?: string;
    entryPath?: string;
    out_path?: string;
    outPath?: string;
  }>;
};

function dplArtifactRelativePath(depsRoot: string, artifactPath: string): string | null {
  const absolute = path.resolve(artifactPath);
  const relative = path.relative(path.resolve(depsRoot), absolute);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    return null;
  }
  return toPosixPath(relative);
}

function validateDplArtifactClosure(depsRoot: string, files: readonly string[]): string[] | null {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const value = toPosixPath(String(file).trim());
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  if (normalized.length === 0) return null;
  for (const file of normalized) {
    const relative = path.normalize(file);
    if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) return null;
    if (!relative.endsWith(".js") || !fs.existsSync(path.join(depsRoot, relative))) return null;
  }
  return normalized;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSorted = Array.from(new Set(left)).sort();
  const rightSorted = Array.from(new Set(right)).sort();
  return leftSorted.length === rightSorted.length && leftSorted.every((value, index) => value === rightSorted[index]);
}

export function resolveDplChunkedPackPublication(options: {
  depsRoot: string;
  requests: DplPackRequestEntry[];
  result: NativeChunkedPublicationResult;
}): DplChunkedPublication | null {
  const { depsRoot, requests, result } = options;
  const chunkGroupId = String(result.chunkGroup ?? result.chunk_group ?? "").trim();
  const chunkFiles = validateDplArtifactClosure(
    depsRoot,
    Array.isArray(result.chunkFiles)
      ? result.chunkFiles
      : Array.isArray(result.chunk_files)
        ? result.chunk_files
        : [],
  );
  if (!chunkGroupId || !chunkFiles) return null;

  const publications = Array.isArray(result.entries) ? result.entries : [];
  if (publications.length !== requests.length) return null;
  const byEntryPath = new Map<string, string>();
  for (const publication of publications) {
    const entryPath = publication.entryPath ?? publication.entry_path;
    const outPath = publication.outPath ?? publication.out_path;
    if (typeof entryPath !== "string" || typeof outPath !== "string") return null;
    const key = canonicalFsPath(entryPath);
    const fileName = dplArtifactRelativePath(depsRoot, outPath);
    if (!fileName || !fileName.endsWith(".js") || !fs.existsSync(path.join(depsRoot, fileName))) return null;
    if (byEntryPath.has(key)) return null;
    byEntryPath.set(key, fileName);
  }

  const entries: PackEntry[] = [];
  const seenRequests = new Set<string>();
  for (const request of requests) {
    const key = canonicalFsPath(request.entryPath);
    if (seenRequests.has(key)) return null;
    seenRequests.add(key);
    const fileName = byEntryPath.get(key);
    if (!fileName) return null;
    entries.push({ ...request, entryPath: key, fileName });
  }
  if (seenRequests.size !== byEntryPath.size) return null;

  return {
    chunkGroupId,
    chunkFiles,
    sharedFileName: chunkFiles[0]!,
    entries,
  };
}

function readDplChunkedPackPublication(options: {
  depsRoot: string;
  requests: DplPackRequestEntry[];
  nodeEnv: string;
}): DplChunkedPublication | null {
  const { depsRoot, requests, nodeEnv } = options;
  const readActivePublications = native?.depsActivePublications;
  if (!readActivePublications) return null;
  let publications: Array<{
    routeActive: boolean;
    entryPath: string;
    outFile: string;
    artifactHash: string;
    artifactTopology: string;
    chunkGroup?: string | null;
    chunkFiles: string[];
    sharedImports: string[];
    dependencyImports: string[];
    packageGraphFiles: string[];
    nodeEnv: string;
    outputVersion: number;
  }>;
  try {
    publications = readActivePublications(depsRoot);
  } catch {
    return null;
  }
  const byEntryPath = new Map<string, (typeof publications)[number]>();
  for (const publication of publications) {
    if (!publication.routeActive) continue;
    const key = canonicalFsPath(publication.entryPath);
    if (byEntryPath.has(key)) return null;
    byEntryPath.set(key, publication);
  }

  let chunkGroupId: string | null = null;
  let chunkFiles: string[] | null = null;
  const entries: PackEntry[] = [];
  const seenRequests = new Set<string>();
  for (const request of requests) {
    const key = canonicalFsPath(request.entryPath);
    if (seenRequests.has(key)) return null;
    seenRequests.add(key);
    const publication = byEntryPath.get(key);
    if (!publication) return null;
    const fileName = publication.outFile;
    if (
      !publication.chunkGroup ||
      publication.outputVersion !== DEPS_OPTIMIZER_OUTPUT_VERSION ||
      publication.nodeEnv.toLowerCase() !== nodeEnv.toLowerCase() ||
      !fs.existsSync(path.join(depsRoot, fileName))
    ) {
      return null;
    }
    const publicationChunkFiles = validateDplArtifactClosure(depsRoot, publication.chunkFiles);
    if (!publicationChunkFiles) return null;
    if (chunkGroupId === null) {
      chunkGroupId = publication.chunkGroup;
      chunkFiles = publicationChunkFiles;
    } else if (
      chunkGroupId !== publication.chunkGroup ||
      !sameStringSet(chunkFiles ?? [], publicationChunkFiles)
    ) {
      return null;
    }
    entries.push({ ...request, entryPath: key, fileName });
  }

  if (!chunkGroupId || !chunkFiles || entries.length !== requests.length) return null;
  return {
    chunkGroupId,
    chunkFiles,
    sharedFileName: chunkFiles[0]!,
    entries,
  };
}

type VendorManualPackStatus = "planned" | "building" | "ready" | "failed";
type VendorManualPackState = {
  version: 1;
  depsHash: string;
  outputVersion?: number;
  // T17: NODE_ENV used when this vendor pack was produced.
  nodeEnv?: string;
  group: string;
  updatedAt: string;
  status: VendorManualPackStatus;
  chunkGroupId: string | null;
  sharedFileName: string | null;
  entries: PackEntry[];
  error?: string;
};

type VendorManualPackSlimStatus = "planned" | "building" | "ready" | "failed";
type VendorManualPackSlimEntry = {
  baseFileName: string;
  wrapperFileName: string;
  entryPath: string;
  packageLabel: string;
  usedExports: string[];
};
type VendorManualPackSlimState = {
  version: 1;
  depsHash: string;
  outputVersion?: number;
  group: string;
  updatedAt: string;
  status: VendorManualPackSlimStatus;
  chunkGroupId: string | null;
  sharedFileName: string | null;
  entries: VendorManualPackSlimEntry[];
  error?: string;
};

type DepUsageDisk = {
  version: 2;
  depsHash: string;
  updatedAt: string;
  deps: Record<
    string,
    {
      entryPath: string;
      packageName: string;
      packageVersion: string;
      moduleFormat?: "esm" | "cjs" | "unknown";
      usedExports: string[];
      hasNamespace: boolean;
      hasExportStar: boolean;
      importerKeys?: string[];
      entryRootKeys?: string[];
    }
  >;
};

type ManualPackMatcher = {
  raw: string;
  test: (pkgName: string, subpath: string | null) => boolean;
};

type ManualPackDef = {
  group: string;
  matchers: ManualPackMatcher[];
};

function normalizeManualPackGroup(raw: string): string | null {
  const base = String(raw ?? "").trim().toLowerCase();
  if (!base) return null;
  const normalized = base.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
  return normalized || null;
}

function normalizeMatchSubpath(subpath: string | null | undefined): string | null {
  if (!subpath) return null;
  const cleaned = String(subpath).trim().replace(/^\.\//, "").replace(/^\/+/, "");
  if (!cleaned || cleaned === "." || cleaned === "index") return null;
  return cleaned;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileManualPackMatchers(patterns: string[]): ManualPackMatcher[] {
  const matchers: ManualPackMatcher[] = [];
  for (const rawPattern of patterns) {
    const pattern = String(rawPattern ?? "").trim();
    if (!pattern) continue;
    if (pattern.includes("*")) {
      const source = `^${escapeRegExp(pattern).replace(/\\\*/g, ".*")}$`;
      let re: RegExp | null = null;
      try {
        re = new RegExp(source);
      } catch {
        re = null;
      }
      if (!re) continue;
      matchers.push({
        raw: pattern,
        test: (pkgName: string, subpath: string | null) => {
          const pkg = String(pkgName ?? "");
          if (re!.test(pkg)) return true;
          const sp = normalizeMatchSubpath(subpath);
          if (!sp) return false;
          return re!.test(`${pkg}/${sp}`);
        },
      });
      continue;
    }

    matchers.push({
      raw: pattern,
      test: (pkgName: string, subpath: string | null) => {
        const pkg = String(pkgName ?? "");
        if (pkg === pattern) return true;
        const sp = normalizeMatchSubpath(subpath);
        if (!sp) return false;
        return `${pkg}/${sp}` === pattern;
      },
    });
  }
  return matchers;
}

function compileManualPackDefs(
  vendorPacksManualRaw: Record<string, unknown>,
  optimizeExclude: Set<string> | null,
): ManualPackDef[] {
  const defsByGroup = new Map<string, ManualPackDef>();
  const defs: ManualPackDef[] = [];
  for (const [rawGroup, rawPatterns] of Object.entries(vendorPacksManualRaw)) {
    const group = normalizeManualPackGroup(rawGroup);
    if (!group) continue;
    const patterns = Array.isArray(rawPatterns) ? rawPatterns : [];
    const matchers = compileManualPackMatchers(
      patterns
        .map((v) => String(v ?? "").trim())
        .filter(Boolean)
        .filter((spec) => !optimizeExclude?.has(spec)),
    );
    if (matchers.length === 0) continue;
    const existing = defsByGroup.get(group);
    if (existing) {
      existing.matchers.push(...matchers);
      continue;
    }
    const def: ManualPackDef = { group, matchers };
    defsByGroup.set(group, def);
    defs.push(def);
  }
  return defs;
}

function classifyManualPackGroup(
  defs: ManualPackDef[],
  pkgName: string | null,
  subpath: string | null,
  optimizeExclude?: Set<string> | null,
): string | null {
  if (!pkgName) return null;
  const pkg = String(pkgName);
  const sp = normalizeMatchSubpath(subpath);
  if (optimizeExclude?.has(pkg)) return null;
  if (sp && optimizeExclude?.has(`${pkg}/${sp}`)) return null;
  for (const def of defs) {
    for (const matcher of def.matchers) {
      try {
        if (matcher.test(pkg, sp)) return def.group;
      } catch {
        // ignore matcher errors; packs should never crash build
      }
    }
  }
  return null;
}

function formatDepLabel(pkgName: string, subpath: string | null): string {
  const sp = normalizeMatchSubpath(subpath);
  return sp ? `${pkgName}/${sp}` : pkgName;
}

function loadDepUsageIndexFromDisk(depsRoot: string, depsHash: string): DepUsageIndex | null {
  const depUsagePath = path.join(depsRoot, "deps-usage.v2.json");
  const legacyDepUsagePath = path.join(depsRoot, "deps-usage.v1.json");
  const raw = readJsonFile<any>(depUsagePath) ?? readJsonFile<any>(legacyDepUsagePath);
  if (!raw || (raw.version !== 1 && raw.version !== 2) || raw.depsHash !== depsHash) return null;
  const out: DepUsageIndex = new Map();
  const deps = raw.deps && typeof raw.deps === "object" ? raw.deps : {};
  for (const [fileName, value] of Object.entries(deps)) {
    const item = value as Record<string, unknown> | null;
    if (!item || typeof item !== "object") continue;
    if (typeof item.entryPath !== "string" || typeof item.packageName !== "string") continue;
    if (typeof item.packageVersion !== "string" || !Array.isArray(item.usedExports)) continue;
    const usedExports = item.usedExports
      .map((v: unknown) => (typeof v === "string" ? v : ""))
      .filter(Boolean)
      .slice()
      .sort();
    const unique: string[] = [];
    for (const name of usedExports) {
      if (unique.length === 0 || unique[unique.length - 1] !== name) unique.push(name);
    }
    out.set(fileName, {
      fileName,
      entryPath: item.entryPath,
      packageName: item.packageName,
      packageVersion: item.packageVersion,
      moduleFormat:
        item.moduleFormat === "esm" || item.moduleFormat === "cjs"
          ? item.moduleFormat
          : "unknown",
      usedExports: unique,
      hasNamespace: item.hasNamespace === true,
      hasExportStar: item.hasExportStar === true,
      importerKeys: Array.isArray(item.importerKeys)
        ? item.importerKeys.map((v: unknown) => (typeof v === "string" ? v : "")).filter(Boolean)
        : [],
      entryRootKeys: Array.isArray(item.entryRootKeys)
        ? item.entryRootKeys.map((v: unknown) => (typeof v === "string" ? v : "")).filter(Boolean)
        : [],
    });
  }
  return out;
}

function saveDepUsageIndexToDisk(depsRoot: string, depsHash: string, index: DepUsageIndex): void {
  const depUsagePath = path.join(depsRoot, "deps-usage.v2.json");
  const depsObj: DepUsageDisk["deps"] = {};
  const keys = Array.from(index.keys()).sort();
  for (const fileName of keys) {
    const item = index.get(fileName);
    if (!item) continue;
    depsObj[fileName] = {
      entryPath: item.entryPath,
      packageName: item.packageName,
      packageVersion: item.packageVersion,
      moduleFormat: item.moduleFormat ?? "unknown",
      usedExports: item.usedExports.slice(),
      hasNamespace: item.hasNamespace,
      hasExportStar: item.hasExportStar,
      importerKeys: Array.isArray(item.importerKeys) ? item.importerKeys.slice() : [],
      entryRootKeys: Array.isArray(item.entryRootKeys) ? item.entryRootKeys.slice() : [],
    };
  }
  writeJsonFile(depUsagePath, {
    version: 2,
    depsHash,
    updatedAt: new Date().toISOString(),
    deps: depsObj,
  } satisfies DepUsageDisk);
}

function depUsageDemandByEntryPath(index: DepUsageIndex | null | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!index) return out;
  for (const usage of index.values()) {
    if (!usage) continue;
    // This map is deliberately path-keyed raw input. DPL's native DemandIndex
    // owns pkg@version:subpath adoption across physical install instances.
    if (usage.hasNamespace || usage.hasExportStar) continue;
    if (!Array.isArray(usage.usedExports) || usage.usedExports.length === 0) continue;
    const demand = Array.from(new Set(usage.usedExports
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean))).sort();
    if (demand.length > 0) out.set(canonicalFsPath(usage.entryPath), demand);
  }
  return out;
}

// One usage-demand scan per build process: batch optimization and plan
// coverage repair share the same source-derived demand facts.
let dplUsageDemandMemo: {
  key: string;
  value: {
    index: DepUsageIndex | null;
    demandByEntryPath: Map<string, string[]>;
    runtimeDemands: DplRuntimeDemandFact[] | null;
  };
} | null = null;

/**
 * C3-c Phase A — the cold canonical derivation pump.
 *
 * Drives the native canonical scheduler (`begin/nextWave/ack/end`) BEFORE the deps
 * phase, deriving each app-source module ONCE (Transform(A) → Define(B) → Parser(B) →
 * Resolver(ResolveKind)) with empty depStops (ResolveKind bounds the frontier). Per wave
 * it MATERIALIZES base + define (+ TransformArtifactProof marker-last) via the frozen
 * G2-C2 writer, ACKs, and RELEASES the generation bytes (codeA/mapA/codeB) — bounded
 * per-wave memory. It retains ONLY the compact semantic projections the later phases
 * need:
 *   - app Graph records (Phase C admission);
 *   - resolved Resolver dependency-boundary targets (Phase C dep-leaf join — no re-resolve);
 *   - normalized Parser(B) DPL demand (Phase B publication).
 * Fail-closed: a materialization failure ACKs false and throws (no partial activation).
 */
type CanonicalColdDerivation = {
  moduleCount: number;
  waves: number;
  peakWaveMaterialBytes: number;
  /** Phase C: app-source Graph node records (already resolved edges). */
  appRecords: NativeGraphRecordBatchNode[];
  /** Phase C: canonical resolved dependency-boundary target paths (Resolver Fact A). */
  depBoundaryTargets: Set<string>;
  /** Phase B: normalized Parser(B) dependency demand for DPL publication. */
  dplDemand: DplRuntimeDemandFact[];
};

// C3-c Method-2 Phase B: the canonical Parser(B)+Resolver demand retained by the cold
// derivation, stashed so the DPL demand chokepoints (scanDplUsageDemand /
// collectDplGenerationDemandFacts) consume it as the SOLE authority — the source scanner
// (`scanDepUsageFacts`) never runs on the true-cold path. Keyed by rootDir+depsHash so a
// stale stash from a different build target is never adopted. Cleared for warm/mutation
// paths (which keep their published/canonical demand).
let __c3ColdPumpDemand:
  | { rootDir: string; depsHash: string; demands: DplRuntimeDemandFact[]; entryRoots: string[] }
  | null = null;

function runCanonicalColdDerivation(opts: {
  entryPaths: string[];
  workspaceRoot: string;
  externalSpecifiers: readonly string[];
  context: CanonicalBuildContext;
  parserMode?: string;
}): CanonicalColdDerivation {
  const { entryPaths, workspaceRoot, externalSpecifiers, context } = opts;
  if (
    !native?.canonicalSchedulerBegin ||
    !native.canonicalSchedulerNextWave ||
    !native.canonicalSchedulerAck ||
    !native.canonicalSchedulerEnd
  ) {
    throw new Error("[C3-c] canonical scheduler unavailable; cannot run cold derivation (fail-closed)");
  }
  const materializeCtx: CanonicalMaterializeContext = {
    casRoot: context.casRoot,
    configHash: context.configHash,
    defineHash: context.defineHash,
  };
  const schedId = native.canonicalSchedulerBegin(
    entryPaths,
    workspaceRoot,
    externalSpecifiers.length ? Array.from(externalSpecifiers) : null,
    context.defineRecipe?.replacements ?? [],
    context.defineRecipe?.importMetaEnvLiteral ?? undefined,
    opts.parserMode ?? "hybrid",
    // Phase A runs BEFORE DPL publication: no depStops yet. ResolveKind bounds the
    // frontier (Fact A); dep-leaf artifact identity (Fact B) is joined in Phase C.
    [],
  );
  const appRecords: NativeGraphRecordBatchNode[] = [];
  const depBoundaryTargets = new Set<string>();
  const dplDemand: DplRuntimeDemandFact[] = [];
  let moduleCount = 0;
  let waves = 0;
  let peakWaveMaterialBytes = 0;
  try {
    for (;;) {
      const wave = native.canonicalSchedulerNextWave(schedId);
      if (wave.length === 0) break;
      waves += 1;
      let waveMaterialBytes = 0;
      let ok = true;
      for (const g of wave) {
        try {
          // Material projection: base A + define B + proof marker-last (frozen G2-C2).
          materializeCanonicalGeneration(
            { sourceHash: g.sourceHash, codeA: g.codeA, mapA: g.mapA ?? null, codeB: g.codeB },
            materializeCtx,
          );
        } catch {
          ok = false;
          break;
        }
        waveMaterialBytes +=
          Buffer.byteLength(g.codeA, "utf8") +
          Buffer.byteLength(g.mapA ?? "", "utf8") +
          Buffer.byteLength(g.codeB, "utf8");
        // Compact semantic projections (retained; the wave's bytes are released on ACK).
        appRecords.push(g.record);
        for (const t of g.depBoundaryTargets ?? []) depBoundaryTargets.add(t);
        const depSpecSet = new Set(g.depSpecifiers ?? []);
        let importerPath: string;
        try { importerPath = fs.realpathSync.native(g.filePath); } catch { importerPath = g.filePath; }
        for (const d of g.demands ?? []) {
          if (depSpecSet.has(d.specifier)) {
            dplDemand.push({
              importerPath,
              specifier: d.specifier,
              usedExports: [...(d.usedExports ?? [])],
              hasNamespace: !!d.hasNamespace,
              hasExportStar: !!d.hasExportStar,
              isDynamic: !!d.isDynamic,
            });
          }
        }
        moduleCount += 1;
      }
      if (waveMaterialBytes > peakWaveMaterialBytes) peakWaveMaterialBytes = waveMaterialBytes;
      // ACK → the native scheduler may advance; the wave objects (codeA/mapA/codeB) go
      // out of scope here → per-wave bounded memory (no whole-closure byte retention).
      native.canonicalSchedulerAck(schedId, ok);
      if (!ok) {
        throw new Error("[C3-c] canonical materialization failed; build fails closed");
      }
    }
  } finally {
    try { native.canonicalSchedulerEnd(schedId); } catch { /* best-effort cleanup */ }
  }
  return { moduleCount, waves, peakWaveMaterialBytes, appRecords, depBoundaryTargets, dplDemand };
}

async function scanDplUsageDemand(options: {
  rootDir: string;
  depsRoot: string;
  depsHash: string;
  resolvedEntries: string[] | undefined;
  allowedRoots: string[];
}): Promise<{
  index: DepUsageIndex | null;
  demandByEntryPath: Map<string, string[]>;
  runtimeDemands: DplRuntimeDemandFact[] | null;
}> {
  const memoKey = `${options.depsHash}\n${path.resolve(options.rootDir)}`;
  if (dplUsageDemandMemo && dplUsageDemandMemo.key === memoKey) return dplUsageDemandMemo.value;
  const result = await scanDplUsageDemandUncached(options);
  dplUsageDemandMemo = { key: memoKey, value: result };
  return result;
}

async function scanDplUsageDemandUncached(options: {
  rootDir: string;
  depsRoot: string;
  depsHash: string;
  resolvedEntries: string[] | undefined;
  allowedRoots: string[];
}): Promise<{
  index: DepUsageIndex | null;
  demandByEntryPath: Map<string, string[]>;
  runtimeDemands: DplRuntimeDemandFact[] | null;
}> {
  const usageEntries = await resolveUsageEntries(options.rootDir, options.resolvedEntries);
  if (usageEntries.length === 0 || !native?.resolveModule) {
    const cached = loadDepUsageIndexFromDisk(options.depsRoot, options.depsHash);
    return {
      index: cached,
      demandByEntryPath: depUsageDemandByEntryPath(cached),
      runtimeDemands: usageEntries.length === 0 ? [] : null,
    };
  }
  try {
    const manifestIndex = loadDepsManifestIndex(options.depsRoot);
    const canonicalFileNames = buildCanonicalDepFileNameIndex(
      Array.from(manifestIndex, ([fileName, entry]) => ({ fileName, entryPath: entry.entryPath })),
    );
    // C3-c Phase B: on the true-cold path the canonical Parser(B)+Resolver demand is the
    // SOLE authority — build the usage index from it (same dep-entry canonicalization the
    // scanner uses) rather than re-scanning source. `scanDepUsageFacts` never runs here.
    const coldPump =
      __c3ColdPumpDemand &&
      __c3ColdPumpDemand.rootDir === options.rootDir &&
      __c3ColdPumpDemand.depsHash === options.depsHash
        ? __c3ColdPumpDemand
        : null;
    if (coldPump) {
      const pumpUsage = usageIndexFromRuntimeDemands(
        coldPump.demands,
        options.rootDir,
        coldPump.entryRoots,
      );
      const index = canonicalizeDepUsageIndex(pumpUsage, canonicalFileNames);
      saveDepUsageIndexToDisk(options.depsRoot, options.depsHash, index);
      logInfo(`[C3-c] Phase B DPL demand authority: Parser(B)+Resolver (deps=${index.size}, demands=${coldPump.demands.length}) — source scanner retired`);
      return {
        index,
        demandByEntryPath: depUsageDemandByEntryPath(index),
        runtimeDemands: coldPump.demands,
      };
    }
    const scanned = await scanDepUsageFacts({
        rootDir: options.rootDir,
        entries: usageEntries,
        allowedRoots: options.allowedRoots,
      });
    const index = canonicalizeDepUsageIndex(
      scanned.usage,
      canonicalFileNames,
    );
    saveDepUsageIndexToDisk(options.depsRoot, options.depsHash, index);
    return {
      index,
      demandByEntryPath: depUsageDemandByEntryPath(index),
      runtimeDemands: scanned.runtimeDemands,
    };
  } catch (err) {
    logWarn(`[deps] WARN: DPL usage demand scan failed; using complete dep artifacts (${String(err)})`);
    const cached = loadDepUsageIndexFromDisk(options.depsRoot, options.depsHash);
    return { index: cached, demandByEntryPath: new Map(), runtimeDemands: null };
  }
}

// Path-keyed usage FACTS only. Demand identity (alias node_modules instances of
// the same `pkg@version:subpath` sharing demand) is owned by DPL: the Rust
// optimizer adopts demand from the usage-facts artifact (`deps-usage.v2.json`)
// written by `scanDplUsageDemand` before every production batch.
function withDplUsageDemand(
  entryPath: string,
  depsHash: string,
  demandByEntryPath?: Map<string, string[]> | null,
): { entryPath: string; depsHash: string; usedExports?: string[] } {
  const usedExports = demandByEntryPath?.get(canonicalFsPath(entryPath));
  return usedExports && usedExports.length > 0
    ? { entryPath, depsHash, usedExports: usedExports.slice() }
    : { entryPath, depsHash };
}

async function resolveUsageEntries(rootDir: string, resolvedEntries: string[] | undefined): Promise<string[]> {
  const usageEntries: string[] = [];
  if (Array.isArray(resolvedEntries) && resolvedEntries.length > 0) {
    usageEntries.push(...resolvedEntries);
    return usageEntries;
  }
  for (const candidate of [
    path.join(rootDir, "src", "main.tsx"),
    path.join(rootDir, "src", "main.ts"),
    path.join(rootDir, "src", "index.tsx"),
    path.join(rootDir, "src", "index.ts"),
  ]) {
    if (fs.existsSync(candidate)) usageEntries.push(candidate);
  }
  return usageEntries;
}

function isReadyManualPackState(
  raw: any,
  depsRoot: string,
  depsHash: string,
  group: string,
): raw is VendorManualPackState & { chunkGroupId: string; sharedFileName: string } {
  if (!raw || typeof raw !== "object") return false;
  if (raw.version !== 1 || raw.depsHash !== depsHash || raw.group !== group) return false;
  if (raw.outputVersion !== DEPS_OPTIMIZER_OUTPUT_VERSION) return false;
  if (raw.status !== "ready") return false;
  if (typeof raw.chunkGroupId !== "string" || raw.chunkGroupId.length === 0) return false;
  if (typeof raw.sharedFileName !== "string" || raw.sharedFileName.length === 0) return false;
  if (!Array.isArray(raw.entries) || raw.entries.length === 0) return false;
  if (!fs.existsSync(path.join(depsRoot, raw.sharedFileName))) return false;
  return raw.entries.every((e: any) => e?.fileName && fs.existsSync(path.join(depsRoot, String(e.fileName))));
}

function isReadyManualSlimState(
  raw: any,
  depsRoot: string,
  depsHash: string,
  group: string,
): raw is VendorManualPackSlimState & { chunkGroupId: string; sharedFileName: string } {
  if (!raw || typeof raw !== "object") return false;
  if (raw.version !== 1 || raw.depsHash !== depsHash || raw.group !== group) return false;
  if (raw.outputVersion !== DEPS_OPTIMIZER_OUTPUT_VERSION) return false;
  if (raw.status !== "ready") return false;
  if (typeof raw.chunkGroupId !== "string" || raw.chunkGroupId.length === 0) return false;
  if (typeof raw.sharedFileName !== "string" || raw.sharedFileName.length === 0) return false;
  if (!Array.isArray(raw.entries) || raw.entries.length === 0) return false;
  if (!fs.existsSync(path.join(depsRoot, raw.sharedFileName))) return false;
  return raw.entries.every((e: any) => e?.wrapperFileName && fs.existsSync(path.join(depsRoot, String(e.wrapperFileName))));
}

async function prepareProductionAutoCorePack(options: {
  rootDir: string;
  ionifyDir: string;
  depsHash: string;
  depsRoot: string;
  config: any;
}): Promise<{ enabled: boolean; didWork: boolean; reasons?: string[] }> {
  const profileStart = Date.now();
  const { rootDir, ionifyDir, depsHash, depsRoot, config } = options;
  const optimizeDeps = (config as any)?.optimizeDeps ?? {};
  const vendorPacksRaw = optimizeDeps.vendorPacks ?? false;
  if (vendorPacksRaw !== "auto") return { enabled: false, didWork: false };

  const depsSourcemapEnabled = optimizeDeps.sourcemap === true;
  const depsBundleEsmEnabled = optimizeDeps.bundleEsm !== false; // default true
  const depsSharedChunksRaw = optimizeDeps.sharedChunks;
  const depsSharedChunksMode =
    depsSharedChunksRaw === undefined || depsSharedChunksRaw === "auto"
      ? "auto"
      : depsSharedChunksRaw === true
        ? "1"
        : depsSharedChunksRaw === false
          ? "0"
          : String(depsSharedChunksRaw);
  const depsSharedChunksEnabled = depsSharedChunksMode !== "0";

  const autoEnabled =
    depsSharedChunksEnabled &&
    !!native?.optimizeDependenciesChunked &&
    !depsSourcemapEnabled &&
    depsBundleEsmEnabled;

  if (!autoEnabled) {
    const reasons: string[] = [];
    if (!depsSharedChunksEnabled) reasons.push("sharedChunks=0");
    if (depsSourcemapEnabled) reasons.push("sourcemap=1");
    if (!depsBundleEsmEnabled) reasons.push("bundleEsm=0");
    if (!native?.optimizeDependenciesChunked) reasons.push("nativeChunked=0");
    return { enabled: true, didWork: false, reasons };
  }

  const optimizeExclude: Set<string> | null = Array.isArray(optimizeDeps.exclude)
    ? new Set<string>(optimizeDeps.exclude.map((s: any) => String(s)))
    : null;

  const pkgJson = readProjectPackageJson(rootDir);
  const vendorSpecifiers = detectVendorSpecifiers(pkgJson)
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .filter((s) => !optimizeExclude?.has(s));

  if (!native?.resolveModule) {
    logWarn("[deps] vendorPacks:auto enabled but native.resolveModule is unavailable; skipping production pack prep.");
    return { enabled: true, didWork: false };
  }

  const requests: DplPackRequestEntry[] = [];
  const seen = new Set<string>();
  const requestResolutionStart = Date.now();
  for (const spec of vendorSpecifiers) {
    try {
      const resolved = native.resolveModule(spec, rootDir) as any;
      const kind = resolved?.kind;
      if (!kind || kind === "Builtin" || kind === "Virtual" || kind === "NotFound") continue;
      const fsPath = resolved?.fsPath ?? resolved?.fs_path ?? null;
      if (!fsPath || typeof fsPath !== "string") continue;
      if (!fsPath.includes("node_modules")) continue;
      if (!isOptimizableDepEntryPath(fsPath)) continue;

      const canonicalEntryPath = canonicalFsPath(fsPath);
      if (seen.has(canonicalEntryPath)) continue;
      seen.add(canonicalEntryPath);
      requests.push({ entryPath: canonicalEntryPath, packageLabel: spec });
    } catch {
      // ignore resolution failures
    }
  }
  logBuildProfile("productionAutoPackRequestResolution", requestResolutionStart);

  if (requests.length <= 1) return { enabled: true, didWork: false };
  requests.sort((a, b) => a.packageLabel.localeCompare(b.packageLabel));

  // The state file is diagnostics only. Readiness is reconstructed from DPL's
  // active publication facts so TS never predicts a dependency artifact name.
  const statePath = path.join(depsRoot, "vendor-pack.feature.core.json");
  const currentNodeEnv = process.env.NODE_ENV ?? "development";
  const activePublicationStart = Date.now();
  const activePublication = readDplChunkedPackPublication({
    depsRoot,
    requests,
    nodeEnv: currentNodeEnv,
  });
  logBuildProfile("productionAutoPackDplPublicationRead", activePublicationStart);

  const routingIndexStart = Date.now();
  const vendorPackV2 = new VendorPackV2IndexManager({
    depsRoot,
    depsHash,
    outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
    allowPackFilePrefix: "vendor-pack.feature.",
    log: { info: logInfo, warn: logWarn },
  });
  vendorPackV2.loadFromDisk();
  logBuildProfile("productionAutoPackRoutingIndexRead", routingIndexStart);

  if (activePublication) {
    const publicationAdmissionStart = Date.now();
    writeJsonFile(statePath, {
      version: 1,
      depsHash,
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      nodeEnv: process.env.NODE_ENV,
      group: "core",
      updatedAt: new Date().toISOString(),
      status: "ready",
      chunkGroupId: activePublication.chunkGroupId,
      sharedFileName: activePublication.sharedFileName,
      entries: activePublication.entries,
    } satisfies VendorManualPackState);

    const pack = vendorPackV2.ensurePackModuleFromEntries({
      label: "feature/core",
      packFileName: `vendor-pack.feature.core.${activePublication.chunkGroupId}.js`,
      sharedFileName: activePublication.sharedFileName,
      chunkFiles: activePublication.chunkFiles,
      entries: activePublication.entries,
      prunePackPrefix: "vendor-pack.feature.core.",
    });
    logBuildProfile("productionAutoPackPublicationAdmission", publicationAdmissionStart);
    logBuildProfile("productionAutoPackTotal", profileStart);
    if (!pack) {
      vendorPackV2.prunePackPrefix("vendor-pack.feature.core.");
      writeJsonFile(statePath, {
        version: 1,
        depsHash,
        outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
        nodeEnv: currentNodeEnv,
        group: "core",
        updatedAt: new Date().toISOString(),
        status: "failed",
        chunkGroupId: activePublication.chunkGroupId,
        sharedFileName: activePublication.sharedFileName,
        entries: activePublication.entries,
        error: "DPL chunked publication could not prove a pack-compatible export ABI",
      } satisfies VendorManualPackState);
      return { enabled: true, didWork: false, reasons: ["core-pack-abi-unproven"] };
    }

    return { enabled: true, didWork: false };
  }

  writeJsonFile(statePath, {
    version: 1,
    depsHash,
    outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
    nodeEnv: currentNodeEnv,
    group: "core",
    updatedAt: new Date().toISOString(),
    status: "building",
    chunkGroupId: null,
    sharedFileName: null,
    entries: [],
  } satisfies VendorManualPackState);

  let didWork = false;
  let attemptedPublication: DplChunkedPublication | null = null;
  try {
    const chunked = native?.optimizeDependenciesChunked;
    if (!chunked) throw new Error("native.optimizeDependenciesChunked is not available");
    didWork = true;
    const result = chunked(requests.map((entry) => ({ entryPath: entry.entryPath, depsHash })), ionifyDir);
    attemptedPublication = resolveDplChunkedPackPublication({ depsRoot, requests, result });
    if (!attemptedPublication) {
      throw new Error("DPL chunked optimizer returned an incomplete publication closure");
    }
    const active = readDplChunkedPackPublication({ depsRoot, requests, nodeEnv: currentNodeEnv });
    if (
      !active ||
      active.chunkGroupId !== attemptedPublication.chunkGroupId ||
      !sameStringSet(active.chunkFiles, attemptedPublication.chunkFiles) ||
      active.entries.some((entry, index) => entry.fileName !== attemptedPublication!.entries[index]?.fileName)
    ) {
      throw new Error("DPL active publication does not select the optimizer-returned chunked closure");
    }
    attemptedPublication = active;

    writeJsonFile(statePath, {
      version: 1,
      depsHash,
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      nodeEnv: currentNodeEnv,
      group: "core",
      updatedAt: new Date().toISOString(),
      status: "ready",
      chunkGroupId: active.chunkGroupId,
      sharedFileName: active.sharedFileName,
      entries: active.entries,
    } satisfies VendorManualPackState);

    const pack = vendorPackV2.ensurePackModuleFromEntries({
      label: "feature/core",
      packFileName: `vendor-pack.feature.core.${active.chunkGroupId}.js`,
      sharedFileName: active.sharedFileName,
      chunkFiles: active.chunkFiles,
      entries: active.entries,
      prunePackPrefix: "vendor-pack.feature.core.",
    });
    if (!pack) throw new Error("DPL chunked publication could not prove a pack-compatible export ABI");
  } catch (err) {
    vendorPackV2.prunePackPrefix("vendor-pack.feature.core.");
    writeJsonFile(statePath, {
      version: 1,
      depsHash,
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      nodeEnv: currentNodeEnv,
      group: "core",
      updatedAt: new Date().toISOString(),
      status: "failed",
      chunkGroupId: attemptedPublication?.chunkGroupId ?? null,
      sharedFileName: attemptedPublication?.sharedFileName ?? null,
      entries: attemptedPublication?.entries ?? [],
      error: String(err),
    } satisfies VendorManualPackState);
    logWarn(`[deps] WARN: Auto core production pack build failed: ${String(err)}`);
  }

  logBuildProfile("productionAutoPackTotal", profileStart);
  return { enabled: true, didWork };
}

async function prepareProductionManualPacks(options: {
  rootDir: string;
  ionifyDir: string;
  depsHash: string;
  depsRoot: string;
  config: any;
  resolvedEntries: string[] | undefined;
  allowedRoots: string[];
  depsManifestIndex: Map<string, DepsManifestIndexEntry>;
}): Promise<{ enabled: boolean; didWork: boolean; reasons?: string[] }> {
  const { rootDir, ionifyDir, depsHash, depsRoot, config, resolvedEntries, allowedRoots, depsManifestIndex } = options;
  const optimizeDeps = (config as any)?.optimizeDeps ?? {};
  const vendorPacksRaw = optimizeDeps.vendorPacks ?? false;
  const vendorPacksManualRaw =
    vendorPacksRaw &&
    typeof vendorPacksRaw === "object" &&
    !Array.isArray(vendorPacksRaw) &&
    vendorPacksRaw !== true
      ? (vendorPacksRaw as Record<string, unknown>)
      : null;
  if (!vendorPacksManualRaw) return { enabled: false, didWork: false };

  const depsSourcemapEnabled = optimizeDeps.sourcemap === true;
  const depsBundleEsmEnabled = optimizeDeps.bundleEsm !== false; // default true
  const depsSharedChunksRaw = optimizeDeps.sharedChunks;
  const depsSharedChunksMode =
    depsSharedChunksRaw === undefined || depsSharedChunksRaw === "auto"
      ? "auto"
      : depsSharedChunksRaw === true
        ? "1"
        : depsSharedChunksRaw === false
          ? "0"
          : String(depsSharedChunksRaw);
  const depsSharedChunksEnabled = depsSharedChunksMode !== "0";

  const manualPacksEnabled =
    depsSharedChunksEnabled &&
    !!native?.optimizeDependenciesChunked &&
    !depsSourcemapEnabled &&
    depsBundleEsmEnabled;

  if (!manualPacksEnabled) {
    const reasons: string[] = [];
    if (!depsSharedChunksEnabled) reasons.push("sharedChunks=0");
    if (depsSourcemapEnabled) reasons.push("sourcemap=1");
    if (!depsBundleEsmEnabled) reasons.push("bundleEsm=0");
    if (!native?.optimizeDependenciesChunked) reasons.push("nativeChunked=0");
    return { enabled: true, didWork: false, reasons };
  }

  const packSlimmingRaw = optimizeDeps.packSlimming ?? "auto";
  const packSlimmingEnabled =
    packSlimmingRaw === true || packSlimmingRaw === "auto" || packSlimmingRaw === undefined;

  const optimizeExclude: Set<string> | null = Array.isArray(optimizeDeps.exclude)
    ? new Set<string>(optimizeDeps.exclude.map((s: any) => String(s)))
    : null;

  const defs = compileManualPackDefs(vendorPacksManualRaw, optimizeExclude);
  if (defs.length === 0) return { enabled: false, didWork: false };

  const vendorPackMaxBytes =
    typeof optimizeDeps.vendorPackMaxBytes === "number" && optimizeDeps.vendorPackMaxBytes > 0
      ? Math.floor(optimizeDeps.vendorPackMaxBytes)
      : 600 * 1024;
  const vendorPackMaxMembers =
    typeof optimizeDeps.vendorPackMaxMembers === "number" && optimizeDeps.vendorPackMaxMembers > 0
      ? Math.floor(optimizeDeps.vendorPackMaxMembers)
      : 25;

  const vendorPackV2 = new VendorPackV2IndexManager({
    depsRoot,
    depsHash,
    outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
    allowPackFilePrefix: "vendor-pack.manual.",
    log: { info: logInfo, warn: logWarn },
  });
  vendorPackV2.loadFromDisk();
  const depsManifestCanonicalFileNames = buildCanonicalDepFileNameIndex(
    Array.from(depsManifestIndex, ([fileName, entry]) => ({ fileName, entryPath: entry.entryPath })),
  );

  const usageEntries = await resolveUsageEntries(rootDir, resolvedEntries);
  // Prefer a fresh usage scan for production packs. If scanning fails, fall back to disk cache.
  let depUsageIndex: DepUsageIndex | null = loadDepUsageIndexFromDisk(depsRoot, depsHash);
  if (!native?.resolveModule) {
    if (!depUsageIndex) {
      logWarn(
        "[deps] vendorPacks manual enabled but native.resolveModule is unavailable; skipping production pack prep.",
      );
      return { enabled: true, didWork: false };
    }
  } else if (usageEntries.length === 0) {
    if (!depUsageIndex) {
      logWarn("[deps] vendorPacks manual enabled but no entry files were detected; skipping production pack prep.");
      return { enabled: true, didWork: false };
    }
  } else {
    try {
      const index = canonicalizeDepUsageIndex(
        await scanDepUsage({ rootDir, entries: usageEntries, allowedRoots }),
        depsManifestCanonicalFileNames,
      );
      depUsageIndex = index;
      saveDepUsageIndexToDisk(depsRoot, depsHash, index);
    } catch (err) {
      logWarn(`[deps] WARN: Usage scan failed during production pack prep: ${String(err)}`);
      if (!depUsageIndex) {
        return { enabled: true, didWork: false };
      }
    }
  }
  if (!depUsageIndex) return { enabled: true, didWork: false };
  depUsageIndex = canonicalizeDepUsageIndex(depUsageIndex, depsManifestCanonicalFileNames);

  const manualObserved = new Map<string, Map<string, PackEntry>>();
  for (const def of defs) manualObserved.set(def.group, new Map());

  for (const usage of depUsageIndex.values()) {
    if (!usage.fileName || !usage.entryPath || !usage.packageName) continue;
    const reg = getDepEntry(usage.fileName);
    const computedSubpath = computeSubpathFromEntryPath(usage.entryPath);
    const subpath =
      typeof reg?.subpath === "string"
        ? reg.subpath
        : computedSubpath
          ? computedSubpath
          : null;
    const group = classifyManualPackGroup(defs, usage.packageName, subpath, optimizeExclude);
    if (!group) continue;
    const groupMap = manualObserved.get(group);
    if (!groupMap) continue;
    if (!fs.existsSync(usage.entryPath)) continue;
    const fileName = canonicalizeDepFileName(usage.fileName, usage.entryPath, depsManifestCanonicalFileNames);
    groupMap.set(fileName, {
      entryPath: usage.entryPath,
      fileName,
      packageLabel: formatDepLabel(usage.packageName, subpath),
    });
  }

  const planManualPackEntries = (group: string): PackEntry[] => {
    const entries = reconcilePackEntries(
      Array.from(manualObserved.get(group)?.values() ?? []),
      (fileName, entryPath) => canonicalizeDepFileName(fileName, entryPath, depsManifestCanonicalFileNames),
    );

    const selected: PackEntry[] = [];
    const seen = new Set<string>();
    let totalBytes = 0;
    for (const entry of entries) {
      if (selected.length >= vendorPackMaxMembers) break;
      if (seen.has(entry.fileName)) continue;
      if (!entry.entryPath || !fs.existsSync(entry.entryPath)) continue;
      const sizeBytes = depsManifestIndex.get(entry.fileName)?.sizeBytes ?? 0;
      if (totalBytes + sizeBytes > vendorPackMaxBytes) continue;
      seen.add(entry.fileName);
      totalBytes += sizeBytes;
      selected.push(entry);
    }
    return selected;
  };

  const manualPackStatePathFor = (group: string) => path.join(depsRoot, `vendor-pack.manual.${group}.json`);
  const manualPackSlimStatePathFor = (group: string) => path.join(depsRoot, `vendor-pack.manual.${group}.slim.json`);

  let didWork = false;
  const chunked = native?.optimizeDependenciesChunked;

  for (const def of defs) {
    const group = def.group;
    const entries = planManualPackEntries(group);
    if (entries.length === 0) continue;

    const plannedChunkGroupId = computeChunkGroupIdFromStableIds(entries.map((e) => e.fileName));
    const plannedSharedFileName = `shared.${plannedChunkGroupId}.js`;
    const statePath = manualPackStatePathFor(group);

    const existing = readJsonFile<VendorManualPackState>(statePath);
    const isCached = isReadyManualPackState(existing, depsRoot, depsHash, group);
    const sharedOk =
      isCached &&
      existing.entries.every(
        (entry) =>
          entry?.entryPath &&
          canonicalizeDepFileName(entry.fileName, entry.entryPath, depsManifestCanonicalFileNames) === entry.fileName,
      ) &&
      existing.sharedFileName === plannedSharedFileName &&
      fs.existsSync(path.join(depsRoot, plannedSharedFileName));

    let baseState: VendorManualPackState | null = null;
    if (sharedOk) {
      baseState = existing;
    } else {
      didWork = true;
      writeJsonFile(statePath, {
        version: 1,
        depsHash,
        outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
        group,
        updatedAt: new Date().toISOString(),
        status: "building",
        chunkGroupId: plannedChunkGroupId,
        sharedFileName: plannedSharedFileName,
        entries,
      } satisfies VendorManualPackState);

      try {
        if (!chunked) throw new Error("native.optimizeDependenciesChunked is not available");
        const result = chunked(entries.map((e) => ({ entryPath: e.entryPath, depsHash })), ionifyDir);
        const groupId = (result as any)?.chunk_group ?? (result as any)?.chunkGroup ?? plannedChunkGroupId;
        const resolvedEntries = resolveChunkedPackEntries(
          entries,
          Array.isArray((result as any)?.entries)
            ? (result as any).entries.map((item: any) => ({
                entryPath: (item as any)?.entry_path ?? (item as any)?.entryPath ?? null,
                outPath: (item as any)?.out_path ?? (item as any)?.outPath ?? null,
              }))
            : [],
        );
        const sharedFileName = `shared.${groupId}.js`;
        const sharedOut = path.join(depsRoot, sharedFileName);
        const ok =
          fs.existsSync(sharedOut) &&
          resolvedEntries.every((entry) => fs.existsSync(path.join(depsRoot, entry.fileName)));
        if (!ok) throw new Error("Manual pack optimizer did not produce expected outputs");

        const readyState = {
          version: 1,
          depsHash,
          outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
          group,
          updatedAt: new Date().toISOString(),
          status: "ready",
          chunkGroupId: groupId,
          sharedFileName,
          entries: resolvedEntries,
        } satisfies VendorManualPackState;
        writeJsonFile(statePath, readyState);
        baseState = readyState;
      } catch (err) {
        writeJsonFile(statePath, {
          version: 1,
          depsHash,
          outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
          group,
          updatedAt: new Date().toISOString(),
          status: "failed",
          chunkGroupId: plannedChunkGroupId,
          sharedFileName: plannedSharedFileName,
          entries,
          error: String(err),
        } satisfies VendorManualPackState);
        logWarn(`[deps] WARN: Manual production pack build failed (${group}): ${String(err)}`);
      }
    }

    if (!isReadyManualPackState(baseState, depsRoot, depsHash, group)) continue;

    const baseEntries = Array.isArray(baseState.entries) ? baseState.entries : [];
    if (baseEntries.length === 0) continue;

    // Prefer slimming when ready so the v2 pack file isn't rewritten every build (slim overwrites base pack id).
    // Mirrors dev behavior: slim pack modules take precedence, base pack is fallback only.
    if (packSlimmingEnabled && group !== "core") {
    const usedByBase = new Map<string, string[]>();
    for (const entry of baseEntries) {
      const u = depUsageIndex.get(entry.fileName);
      if (!u) continue;
      if (u.hasNamespace || u.hasExportStar) continue;
      if (!Array.isArray(u.usedExports) || u.usedExports.length === 0) continue;
      usedByBase.set(entry.fileName, u.usedExports.slice());
    }
    if (usedByBase.size > 0) {

    const slimPath = manualPackSlimStatePathFor(group);
    const existingSlim = readJsonFile<VendorManualPackSlimState>(slimPath);
    if (
      isReadyManualSlimState(existingSlim, depsRoot, depsHash, group) &&
      existingSlim.entries.every(
        (entry) =>
          entry?.entryPath &&
          canonicalizeDepFileName(entry.baseFileName, entry.entryPath, depsManifestCanonicalFileNames) ===
            entry.baseFileName,
      )
    ) {
      const sharedPath = path.join(depsRoot, existingSlim.sharedFileName);
      const byBase = new Map(existingSlim.entries.map((e) => [e.baseFileName, e] as const));
      const baseSet = new Set(baseEntries.map((e) => e.fileName));
      const inputsMatch =
        fs.existsSync(sharedPath) &&
        existingSlim.entries.every((e) => baseSet.has(e.baseFileName)) &&
        baseEntries.every((base) => {
          const entry = byBase.get(base.fileName);
          if (!entry) return false;
          if (entry.entryPath !== base.entryPath) return false;
          if (!fs.existsSync(path.join(depsRoot, entry.wrapperFileName))) return false;
          const expected = (usedByBase.get(base.fileName) ?? []).slice().sort();
          const actual = Array.isArray(entry.usedExports) ? entry.usedExports.slice().sort() : [];
          if (expected.length !== actual.length) return false;
          for (let i = 0; i < expected.length; i++) {
            if (expected[i] !== actual[i]) return false;
          }
          return true;
        });

      if (inputsMatch) {
        const ok = vendorPackV2.ensurePackModuleFromWrappers({
          label: `manual/${group}/slim`,
          packFileName: `vendor-pack.manual.${group}.${existingSlim.chunkGroupId}.js`,
          sharedFileName: existingSlim.sharedFileName,
          members: existingSlim.entries.map((e) => ({
            baseFileName: e.baseFileName,
            wrapperFileName: e.wrapperFileName,
            packageLabel: e.packageLabel,
          })),
          prunePackPrefix: `vendor-pack.manual.${group}.`,
        });
        if (ok) continue;
      }
    }

    didWork = true;
    writeJsonFile(slimPath, {
      version: 1,
      depsHash,
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      group,
      updatedAt: new Date().toISOString(),
      status: "building",
      chunkGroupId: null,
      sharedFileName: null,
      entries: baseEntries.map((e) => ({
        baseFileName: e.fileName,
        wrapperFileName: e.fileName,
        entryPath: e.entryPath,
        packageLabel: e.packageLabel,
        usedExports: usedByBase.get(e.fileName) ?? [],
      })),
    } satisfies VendorManualPackSlimState);

    try {
      if (!chunked) throw new Error("native.optimizeDependenciesChunked is not available");
      const result = chunked(
        baseEntries.map((e) => {
          const usedExports = usedByBase.get(e.fileName);
          return usedExports && usedExports.length > 0
            ? ({ entryPath: e.entryPath, depsHash, usedExports } as any)
            : ({ entryPath: e.entryPath, depsHash } as any);
        }),
        ionifyDir,
      );

      const groupId = (result as any)?.chunk_group ?? (result as any)?.chunkGroup ?? null;
      if (!groupId || typeof groupId !== "string") throw new Error("Missing chunkGroupId");
      const sharedFileName = `shared.${groupId}.js`;
      const sharedOut = path.join(depsRoot, sharedFileName);
      if (!fs.existsSync(sharedOut)) throw new Error("Slim shared chunk not found on disk");

      const resultsArr = Array.isArray((result as any)?.entries) ? (result as any).entries : [];
      const outByEntryPath = new Map<string, string>();
      for (const item of resultsArr) {
        const entryPath = (item as any)?.entry_path ?? (item as any)?.entryPath ?? null;
        const outPath = (item as any)?.out_path ?? (item as any)?.outPath ?? null;
        if (typeof entryPath !== "string" || typeof outPath !== "string") continue;
        const canonicalEntryPath = (() => {
          try {
            return fs.realpathSync(entryPath);
          } catch {
            return entryPath;
          }
        })();
        outByEntryPath.set(canonicalEntryPath, path.basename(outPath));
      }

      const slimMembers: Array<{ baseFileName: string; wrapperFileName: string; packageLabel?: string }> = [];
      const slimEntries: VendorManualPackSlimEntry[] = [];
      for (const base of baseEntries) {
        const canonicalBaseEntryPath = (() => {
          try {
            return fs.realpathSync(base.entryPath);
          } catch {
            return base.entryPath;
          }
        })();
        const wrapperFileName = outByEntryPath.get(canonicalBaseEntryPath) ?? base.fileName;
        if (!fs.existsSync(path.join(depsRoot, wrapperFileName))) {
          throw new Error(`Slim wrapper missing for ${base.packageLabel}: ${wrapperFileName}`);
        }
        slimMembers.push({
          baseFileName: base.fileName,
          wrapperFileName,
          packageLabel: base.packageLabel,
        });
        slimEntries.push({
          baseFileName: base.fileName,
          wrapperFileName,
          entryPath: base.entryPath,
          packageLabel: base.packageLabel,
          usedExports: usedByBase.get(base.fileName) ?? [],
        });
      }

      const ok = vendorPackV2.ensurePackModuleFromWrappers({
        label: `manual/${group}/slim`,
        packFileName: `vendor-pack.manual.${group}.${groupId}.js`,
        sharedFileName,
        members: slimMembers,
        prunePackPrefix: `vendor-pack.manual.${group}.`,
      });

      writeJsonFile(slimPath, {
        version: 1,
        depsHash,
        outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
        group,
        updatedAt: new Date().toISOString(),
        status: "ready",
        chunkGroupId: groupId,
        sharedFileName,
        entries: slimEntries,
      } satisfies VendorManualPackSlimState);
      if (ok) continue;
    } catch (err) {
      writeJsonFile(slimPath, {
        version: 1,
        depsHash,
        outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
        group,
        updatedAt: new Date().toISOString(),
        status: "failed",
        chunkGroupId: null,
        sharedFileName: null,
        entries: readJsonFile<VendorManualPackSlimState>(slimPath)?.entries ?? [],
        error: String(err),
      } satisfies VendorManualPackSlimState);
      logWarn(`[deps] WARN: Manual production pack slimming failed (${group}): ${String(err)}`);
    }
      }
    }

    vendorPackV2.ensurePackModuleFromEntries({
      label: `manual/${group}`,
      packFileName: `vendor-pack.manual.${group}.${baseState.chunkGroupId}.js`,
      sharedFileName: baseState.sharedFileName,
      entries: baseState.entries,
      prunePackPrefix: `vendor-pack.manual.${group}.`,
    });
  }

  return { enabled: true, didWork };
}

export async function runBuildCommand(options: BuildOptions = {}) {
  try {
    const buildStart = Date.now();
    const setupStart = Date.now();
    const buildMode =
      options.mode ??
      process.env.IONIFY_MODE ??
      process.env.MODE ??
      (options.depsOnly ? process.env.NODE_ENV ?? "development" : "production");
    // Phase 5-Cloud-EI-DX2 — when invoked via `ionify optimize-all` (depsOnly),
    // honor the caller's NODE_ENV so the deps snapshot lands at the depsHash
    // matching that env. Production builds always force "production" because
    // dist/ output must be production-mode regardless of caller env.
    if (!options.depsOnly) {
      process.env.NODE_ENV = "production";
    } else if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "production") {
      // Non-tagged NODE_ENV in depsOnly mode → default to development (dev shape).
      process.env.NODE_ENV = "development";
    }
    process.env.MODE = buildMode;
    process.env.IONIFY_MODE = buildMode;
    const config = await loadIonifyConfig(process.cwd(), buildMode);
    // Phase 5.4.2: Use root from config
    const projectRootOverride = config?.root ? path.resolve(config.root) : null;
    const workspace = resolveWorkspace(projectRootOverride ?? process.cwd(), {
      projectRootOverride,
    });
    const rootDir = workspace.projectRoot;
    const ionifyDir = workspace.ionifyDir;
    const publicDirAbs = resolvePublicDir(rootDir, (config as any)?.publicDir);

    fs.mkdirSync(ionifyDir, { recursive: true });
    process.env.IONIFY_PROJECT_ROOT = rootDir;
    process.env.IONIFY_WORKSPACE_ROOT = workspace.workspaceRoot;
    process.env.IONIFY_STATE_DIR = ionifyDir;
    process.env.IONIFY_WORKSPACE_ID = workspace.workspaceId;
    process.env.IONIFY_PROJECT_ID = workspace.projectId;
    // Preprocessor options for the transform worker's CSS pre-pass (Sass/Less). The pool inherits
    // process.env; the worker reads + parses this (worker.cjs runCssTransform). JSON-only (function
    // options like sass importers can't cross the worker boundary anyway).
    try {
      const preOpts = (config as any)?.css?.preprocessorOptions;
      process.env.IONIFY_CSS_PREPROCESSOR_OPTIONS = preOpts ? JSON.stringify(preOpts) : "";
    } catch {
      process.env.IONIFY_CSS_PREPROCESSOR_OPTIONS = "";
    }

    // Align env exposure and define replacements with dev server behavior.
    // NOTE: NODE_ENV is forced to production for builds even if env files set it
    //       — except in depsOnly (`ionify optimize-all`) mode, which honors caller.
    process.env.MODE = buildMode;
    const envFromFiles = loadIonifyEnv(process.env.MODE, rootDir);
    if (!options.depsOnly) {
      process.env.NODE_ENV = "production";
    }
    const envValues: Record<string, string> = {
      ...envFromFiles,
      NODE_ENV: process.env.NODE_ENV,
      MODE: process.env.MODE,
    };
    const envPrefix = config?.envPrefix || ["VITE_", "IONIFY_"];
    const defineConfig = buildDefineConfig(config?.define, envValues, envPrefix);
    logInfo(`[define] ${Object.keys(defineConfig).length} replacements configured`);
    // C3-c: build the canonical Define recipe once, here where defineConfig is the
    // authority, and transport it EXPLICITLY into generateBuildPlan (no module-global
    // side channel). The cold graph observation derives B (Parser(B)) from this recipe;
    // an explicit empty recipe legitimately means "no Define" (Define proves B == A).
    const canonicalDefineRecipe: CanonicalDefineRecipe = buildDefineRecipe(defineConfig);
    
    // Check if optimization level is specified (overrides individual settings)
    const optLevel = resolveOptimizationLevel(config?.optimizationLevel, {
      cliLevel: options.level,
      envLevel: process.env.IONIFY_OPTIMIZATION_LEVEL,
    });
    
    let minifier: MinifierChoice;
    const parserMode = resolveParser(config, { envMode: process.env.IONIFY_PARSER });
    let treeshake: ReturnType<typeof resolveTreeshake>;
    let scopeHoist: ReturnType<typeof resolveScopeHoist>;

    if (optLevel !== null) {
      // Use preset
      const preset = getOptimizationPreset(optLevel);
      minifier = preset.minifier;
      treeshake = preset.treeshake;
      scopeHoist = preset.scopeHoist;
      logInfo(`Using optimization level ${optLevel} (preset)`);
    } else {
      // Resolve individual settings
      minifier = resolveMinifier(config, { envVar: process.env.IONIFY_MINIFIER });
      treeshake = resolveTreeshake(config?.treeshake, {
        envMode: process.env.IONIFY_TREESHAKE,
        includeEnv: process.env.IONIFY_TREESHAKE_INCLUDE,
        excludeEnv: process.env.IONIFY_TREESHAKE_EXCLUDE,
      });
      scopeHoist = resolveScopeHoist(config?.scopeHoist, {
        envMode: process.env.IONIFY_SCOPE_HOIST,
        inlineEnv: process.env.IONIFY_SCOPE_HOIST_INLINE,
        constantEnv: process.env.IONIFY_SCOPE_HOIST_CONST,
        combineEnv: process.env.IONIFY_SCOPE_HOIST_COMBINE,
      });
    }

    // Apply parser env only (parser requires env for native binding selection)
    applyParserEnv(parserMode);
    // Do not apply minifier/treeshake/scopeHoist env vars; resolved values are used in config hashing.
    // Avoiding process.env mutation ensures deterministic builds and test isolation.
    
    // Get entries from config and resolve to absolute paths BEFORE canonicalization
    const resolvedBuildEntries = resolveProductionBuildEntries(config, rootDir, (message) => logWarn(message));
    let entries = resolvedBuildEntries.entries;

    if (entries?.length && resolvedBuildEntries.source === "config") {
      logInfo(`Build entries: ${entries.join(", ")}`);
    } else if (entries?.length && resolvedBuildEntries.source === "html") {
      logInfo(`Build entries inferred from index.html: ${entries.join(", ")}`);
    } else {
      logInfo(`No entries in config or index.html, planner will infer from graph`);
    }
    
    // Create version inputs for automatic cache invalidation
    // computeGraphVersion handles canonicalization internally to ensure consistency
    const rawVersionInputs = createProductionGraphVersionInputs({
      config,
      parserMode,
      minifier,
      treeshake,
      scopeHoist,
      entries,
    }) as Parameters<typeof computeGraphVersion>[0];
    // Propagate config hash to native for AST/cache invalidation
    const configHash = computeGraphVersion(rawVersionInputs);
    logInfo(`[Build] Version hash: ${configHash}`);
    process.env.IONIFY_CONFIG_HASH = configHash;
    // C3-c: assemble the generation-coherent canonical build context ONCE, here, from
    // the values already in scope (defineConfig, configHash, ionifyDir). defineRecipe +
    // defineHash are both projections of the same defineConfig; casRoot/configHash are
    // the CAS root/namespace. Transported unchanged into generateBuildPlan — never
    // reacquired downstream. (casRoot/defineHash are used again later via these hoisted
    // bindings, not recomputed.)
    const casRoot = path.join(ionifyDir, "cas");
    const defineSignature = computeDefineSignature(defineConfig as any);
    const defineHash = defineSignature ? getCacheKey(defineSignature) : "";
    const canonicalBuildContext: CanonicalBuildContext = {
      defineRecipe: canonicalDefineRecipe,
      defineHash,
      configHash,
      casRoot,
    };
    const productionChunkPolicy = resolveProductionChunkPolicy(config);
    if (productionChunkPolicy.vendorMaxBytes !== null) {
      process.env.IONIFY_VENDOR_MAX_CHUNK_BYTES = String(productionChunkPolicy.vendorMaxBytes);
    } else {
      delete process.env.IONIFY_VENDOR_MAX_CHUNK_BYTES;
    }
    logBuildProfile("setupConfigIdentity", setupStart);

    // Align deps optimizer (/@deps) with build so native bundler can consume optimized ESM deps
    // (CJS wrappers like react/index.js must be optimized to browser-safe ESM).
    const depsPhaseStart = Date.now();
    resetTopologyValidationProfile();
    const lockfile = readLockfile(workspace.workspaceRoot, rootDir);
    const depsSourcemapEnabled = config?.optimizeDeps?.sourcemap === true;
    const depsBundleEsmEnabled = config?.optimizeDeps?.bundleEsm !== false; // default true
    const depsSharedChunksRaw = config?.optimizeDeps?.sharedChunks;
    const depsSharedChunksMode =
      depsSharedChunksRaw === undefined || depsSharedChunksRaw === "auto"
        ? "auto"
        : depsSharedChunksRaw === true
          ? "1"
          : depsSharedChunksRaw === false
            ? "0"
            : String(depsSharedChunksRaw);
    const depsHash = computeDepsHash(configHash, lockfile, {
      nodeEnv: process.env.NODE_ENV,
      sourcemap: depsSourcemapEnabled,
      bundleEsm: depsBundleEsmEnabled,
      sharedChunks: depsSharedChunksMode,
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
    });
    process.env.IONIFY_DEPS_HASH = depsHash;
    const depsRoot = path.join(ionifyDir, "deps", depsHash);
    process.env.IONIFY_DEPS_ROOT = depsRoot;
    fs.mkdirSync(depsRoot, { recursive: true });

    const buildExternalSpecifiers = collectConfiguredExternalSpecifiers(config);
    const productionPublicationIdentity: ProductionPublicationIdentity = {
      productionPlanOutputVersion: PRODUCTION_PLAN_OUTPUT_VERSION,
      mode: buildMode,
      nodeEnv: "production",
      configHash,
      depsHash,
      depsOptimizerOutputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      entries: entries ?? [],
      entrySource: resolvedBuildEntries.source,
    };

    const earlyOutDir = options.outDir || "dist";
    const earlyAbsOutDir = path.resolve(earlyOutDir);
    const earlyPlanStart = Date.now();
    const earlyPublicationState = readProductionPublicationState(ionifyDir);
    const earlyPublishedPlan = readProductionPublicationPlan(
      ionifyDir,
      productionPublicationIdentity,
      earlyPublicationState,
    );
    const earlyProductionReadinessRecord: ProductionReadinessRecord | null =
      earlyPublishedPlan ? readProductionReadinessRecord(ionifyDir) : null;
    const earlyPraIdentityVerified =
      earlyPublishedPlan !== null &&
      isVerifiedProductionReadinessForPlan(earlyProductionReadinessRecord, {
        configHash,
        workspaceRoot: workspace.workspaceRoot,
        projectRoot: rootDir,
        depsHash,
        plan: earlyPublishedPlan,
        depsOptimizerOutputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      });
    let sourceMutationOutputBase: {
      artifacts: Array<{ id: string; files: ReusedChunkFiles }>;
      stats: Record<string, any>;
      routingManifest: EmittedOutputInfo;
    } | null = null;
    let earlySourceFreshnessAudit: ProductionSourceFreshnessAudit | null = null;
    let earlyPublishedDplGenerationCurrent = false;
    if (earlyPublishedPlan) {
      logBuildProfile("publishedProductionPlanRead", earlyPlanStart);
      const sourceFreshnessPreflightStart = Date.now();
      earlySourceFreshnessAudit = auditProductionSourceFreshness(
        earlyPublishedPlan,
        ionifyDir,
        workspace.workspaceRoot,
        path.join(ionifyDir, "cas"),
        configHash,
      );
      logBuildProfile("praSourceFreshnessPreflight", sourceFreshnessPreflightStart);
      const sourceFreshnessCurrent = earlySourceFreshnessAudit.current;
      if (!sourceFreshnessCurrent && earlyPraIdentityVerified && earlyProductionReadinessRecord) {
        sourceMutationOutputBase = tryVerifyProductionReadinessMaterializedOutputs(
          earlyAbsOutDir,
          earlyProductionReadinessRecord,
        );
      }
      const verifiedPraForDeployReadyOutput =
        sourceFreshnessCurrent &&
        earlyPraIdentityVerified;
      const materializedReadiness =
        verifiedPraForDeployReadyOutput && earlyProductionReadinessRecord
          ? tryVerifyProductionReadinessMaterializedOutputs(earlyAbsOutDir, earlyProductionReadinessRecord)
          : null;
      // PRA owns deploy-ready build reuse, not explicit DPL publication.
      // `optimize-all` must reach DPL so DPL can validate or republish its
      // current topology/ABI contract before the deps-only short-circuit.
      if (!options.depsOnly && materializedReadiness) {
        logInfo("Building...");
        logInfo(`[Build] Using published Production Plan (${earlyPublishedPlan.chunks.length} chunk(s), identity verified)`);
        const totalPlannedModules = earlyPublishedPlan.chunks.reduce((acc, chunk) => acc + chunk.modules.length, 0);
        logInfo(
          `[Build] Plan ready: entries=${earlyPublishedPlan.entries.length}, chunks=${earlyPublishedPlan.chunks.length}, modules=${totalPlannedModules}`,
        );
        logInfo("[PRA] Verified deploy-ready identity for current Production Plan; skipping dependency/CAS/dist readiness probes");
        logBuildProfileDuration("depsAuthorityAndPacks", 0);
        logBuildProfileDuration("generateBuildPlan", 0);
        logBuildProfileDuration("depsReroute", 0);
        logBuildProfileDuration("canonicalDependencyPlan", 0);
        logBuildProfileDuration("moduleIndex", 0);
        logBuildProfileDuration("freshnessScan", 0);
        logBuildProfileDuration("praOutputReadinessProbe", 0);
        logBuildProfileDuration("casBatchCheck", 0);
        logBuildProfileDuration("casHydration", 0);
        logBuildProfileDuration("distReuseProbe", 0);
        logBuildProfileDuration("emitChunksAndFiles", 0);
        logBuildProfileDuration("writeBuildManifest", 0);
        logBuildProfileDuration("writeAssetsManifest", 0);
        logBuildProfileDuration("emitIndexHtml", 0);
        logBuildProfileDuration("publicAssetReadiness", 0);
        logBuildProfileDuration("writeBuildStats", 0);
        logBuildProfileDuration("manifestAssetsStats", 0);

        const outputHashHints = collectOutputHashHints(materializedReadiness.stats);
        const distProof = earlyProductionReadinessRecord!.proofs.dist;
        if (distProof.manifestHash) outputHashHints.set("manifest.json", distProof.manifestHash);
        if (distProof.buildStatsHash) outputHashHints.set("build.stats.json", distProof.buildStatsHash);
        if (distProof.assetsManifestHash) outputHashHints.set("manifest.assets.json", distProof.assetsManifestHash);
        if (distProof.indexHtmlHash) outputHashHints.set("index.html", distProof.indexHtmlHash);
        for (const asset of earlyProductionReadinessRecord!.proofs.publicAssets.assets) {
          outputHashHints.set(toPosixPath(asset.file), asset.hash);
        }

        const coreBuildElapsed = Date.now() - buildStart;
        logInfo(`Build plan generated → ${path.join(earlyAbsOutDir, "manifest.json")}`);
        logInfo(`Entries: ${earlyPublishedPlan.entries.length}, Chunks: ${earlyPublishedPlan.chunks.length}`);
        logInfo(`Modules in plan: ${totalPlannedModules}`);
        logInfo(`CAS hits: PRA verified • transforms needed: 0`);
        logInfo(`Build complete in ${coreBuildElapsed}ms`);
        logInfo(`[Build] Time-to-deploy-ready: ${coreBuildElapsed}ms`);
        logBuildProfileDuration("timeToDeployReady", coreBuildElapsed);

        const compression = await runPostBuildCompression({
          config,
          absOutDir: earlyAbsOutDir,
          casRoot: path.join(ionifyDir, "cas"),
          outputHashHints,
          buildStart,
        });

        const praEmitStart = Date.now();
        try {
          const readinessRecord = createProductionReadinessRecord({
            configHash,
            workspaceRoot: workspace.workspaceRoot,
            projectRoot: rootDir,
            depsHash,
            plan: earlyPublishedPlan,
            artifacts: materializedReadiness.artifacts,
            dist: {
              manifestHash: distProof.manifestHash ?? "",
              buildStatsHash: distProof.buildStatsHash ?? "",
              assetsManifestHash: distProof.assetsManifestHash,
              indexHtmlHash: distProof.indexHtmlHash,
            },
            compression,
            publicAssets: earlyProductionReadinessRecord!.proofs.publicAssets,
            depsOptimizerOutputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
          });
          writeProductionReadinessRecord(ionifyDir, readinessRecord);
        } catch (err) {
          logWarn(`[PRA] Skipped deploy-ready.v1 emit: ${err instanceof Error ? err.message : String(err)}`);
        }
        logBuildProfile("praEmit", praEmitStart);
        const slimmingSaved = computeBuildSlimmingSavedPercent(depsRoot, depsHash);
        const vendorPacksSaved = computeBuildVendorPackRequestsSavedPercent(depsRoot, depsHash);
        logInfo(`Slimming saved: ${typeof slimmingSaved === "number" ? `${slimmingSaved}%` : "0%"}`);
        logInfo(`Vendor packs saved: ${typeof vendorPacksSaved === "number" ? `${vendorPacksSaved}%` : "0%"} requests`);
        return;
      }
    }
    // A partial PAP publication can satisfy dependency readiness for build,
    // but only DPL may admit its generation. Keep this after the exact PRA
    // fast path so deploy-ready reuse performs no dependency probe at all.
    if (
      !options.depsOnly &&
      earlyPublishedPlan &&
      earlySourceFreshnessAudit?.current === true &&
      earlyPublicationState?.tiers.deps.state === "published"
    ) {
      const dplPublishedGenerationProofStart = Date.now();
      try {
        earlyPublishedDplGenerationCurrent =
          native?.depsVerifiedGenerationCurrent?.(depsRoot) === true;
      } catch {
        earlyPublishedDplGenerationCurrent = false;
      }
      logBuildProfile("dplPublishedGenerationProof", dplPublishedGenerationProofStart);
    }

    // Phase 5-Cloud-EI: tag this build's env so a downstream `--push` can
    // trust it without re-deriving from process.env.NODE_ENV (which may have
    // mutated). Only emit if NODE_ENV is one of the two recognized values.
    if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "production") {
      process.env.IONIFY_NODE_ENV = process.env.NODE_ENV;
    }

    // Wave 5: Initialize AST cache with version hash
    if (native?.initAstCache) {
      const versionHash = JSON.stringify(rawVersionInputs);
      native.initAstCache(versionHash);
      logInfo(`AST cache initialized with version hash`);
    }

    const sourceOnlyMutationProofStart = Date.now();
    const sourceOnlyMutationProof =
      earlyPublishedPlan && (!options.depsOnly || options.publicationContracts === true)
        ? collectSourceOnlyMutationProof(
            earlyPublishedPlan,
            workspace.workspaceRoot,
            parserMode,
            earlySourceFreshnessAudit?.changedPaths ?? [],
          )
        : { ok: false, changed: 0, changedPaths: [], runtimeMutations: [], reason: "no-published-plan" };
    logBuildProfile("sourceOnlyMutationProof", sourceOnlyMutationProofStart);
    if (!sourceOnlyMutationProof.ok) {
      logBuildProfileText("sourceOnlyAdmission", `dpl-rejected:${sourceOnlyMutationProof.reason ?? "unknown"}`);
    }
    const sourceOnlyCanonicalMutation =
      sourceOnlyMutationProof.ok && earlyPublishedPlan
        ? admitCanonicalBuildPlanMutation({
            plan: earlyPublishedPlan,
            versionInputs: rawVersionInputs,
            changedSourcePaths: sourceOnlyMutationProof.changedPaths,
            runtimeMutations: sourceOnlyMutationProof.runtimeMutations,
            depsRoot,
            externalSpecifiers: buildExternalSpecifiers,
            consumer: options.depsOnly ? "plan" : "bundler",
          })
        : null;
    const sourceOnlyCanonicalPlan = sourceOnlyCanonicalMutation?.plan ?? null;
    const sourceMutationPlannerChunkIds =
      sourceOnlyCanonicalMutation?.affectedChunkIds ?? null;
    const sourceMutationPublicationContext =
      sourceOnlyCanonicalMutation?.publicationContext ?? null;
    // Source-only admission is atomic across the two existing owners: DPL
    // proves package publication/ABI and Planner proves the complete emitted
    // runtime topology. Neither proof can suppress dependency work alone.
    const skipDepsAuthorityForSourceOnlyEdit = sourceOnlyCanonicalPlan !== null;
    const skipDepsAuthorityForPublishedPlan =
      !options.depsOnly &&
      earlyPublishedPlan !== null &&
      earlySourceFreshnessAudit?.current === true &&
      earlyPublishedDplGenerationCurrent;
    const skipDepsAuthorityForCanonicalPlan =
      skipDepsAuthorityForSourceOnlyEdit || skipDepsAuthorityForPublishedPlan;
    if (sourceOnlyMutationProof.ok && !skipDepsAuthorityForSourceOnlyEdit) {
      logBuildProfileText("sourceOnlyAdmission", "planner-rejected");
    } else if (skipDepsAuthorityForSourceOnlyEdit) {
      logBuildProfileText("sourceOnlyAdmission", "dpl-and-planner-admitted");
      const freshnessCacheUpdateStart = Date.now();
      updateSourceFreshnessCacheForCanonicalMutation(
        sourceOnlyCanonicalPlan!,
        ionifyDir,
        workspace.workspaceRoot,
        sourceOnlyMutationProof.changedPaths,
      );
      logBuildProfile("sourceFreshnessDeltaWrite", freshnessCacheUpdateStart);
    }

    // ── C3-c Method-2 Phase A (cold path only) ────────────────────────────────
    // Derive the app graph ONCE via the canonical scheduler
    // (Transform(A)→Define(B)→Parser(B)→Resolver disposition) BEFORE the deps phase,
    // materializing base+define per wave and retaining ONLY compact projections:
    //   • appRecords          → Phase C graph pre-population (skip Parser(A));
    //   • depBoundaryTargets  → Phase C dep-leaf join (Resolver Fact A ∩ depStops);
    //   • dplDemand           → Phase B DPL publication demand (retires scanDepUsageFacts).
    // Warm/mutation paths keep their published/canonical plan graph, so the pump does not
    // run there (Method 3 owns those). Guarded by the same cold-path predicate that later
    // reaches `generateBuildPlan`.
    let coldDerivation: CanonicalColdDerivation | null = null;
    // Reset any stash from a prior in-process build before this build decides its path;
    // warm/mutation paths must never adopt a previous cold build's pump demand.
    __c3ColdPumpDemand = null;
    if (!skipDepsAuthorityForCanonicalPlan && !options.depsOnly) {
      const coldWsRoot = workspace.workspaceRoot;
      const coldEntrySet = Array.from(
        new Set([...(entries ?? []), ...collectFederationExposeEntryPaths(config, rootDir)]),
      );
      const coldEntryAbs = coldEntrySet
        .map((e) =>
          path.isAbsolute(e)
            ? e
            : e.startsWith(WS_MODULE_PREFIX)
              ? fromWsModuleId(e, coldWsRoot)
              : path.resolve(rootDir, e),
        )
        .filter((p): p is string => typeof p === "string" && p.length > 0 && fs.existsSync(p));
      if (coldEntryAbs.length > 0) {
        const coldStart = Date.now();
        coldDerivation = runCanonicalColdDerivation({
          entryPaths: coldEntryAbs,
          workspaceRoot: coldWsRoot,
          externalSpecifiers: buildExternalSpecifiers,
          context: canonicalBuildContext,
        });
        logBuildProfile("coldCanonicalDerivation", coldStart);
        logInfo(
          `[C3-c] cold canonical derivation: modules=${coldDerivation.moduleCount} waves=${coldDerivation.waves} ` +
            `peakWaveBytes=${coldDerivation.peakWaveMaterialBytes} depBoundary=${coldDerivation.depBoundaryTargets.size} demand=${coldDerivation.dplDemand.length}`,
        );
        // Phase B: publish the retained canonical demand as the sole DPL-demand authority.
        __c3ColdPumpDemand = {
          rootDir,
          depsHash,
          demands: coldDerivation.dplDemand,
          entryRoots: coldEntryAbs,
        };
      }
    }

    const vendorPacksRaw = config?.optimizeDeps?.vendorPacks ?? false;
    const vendorPacksManualConfigured =
      vendorPacksRaw &&
      typeof vendorPacksRaw === "object" &&
      !Array.isArray(vendorPacksRaw) &&
      Object.keys(vendorPacksRaw as any).length > 0;
    const vendorPacksAutoConfigured = vendorPacksRaw === "auto";

    // ── T8: Parallel deps optimization ────────────────────────────────────────
    // When vendorPacks:"auto" is configured, P1 (batch optimizer — non-vendor
    // entries) and P2 (chunked optimizer — vendor entries → shared chunk) are
    // fully independent: they write to disjoint artifact file sets and have no
    // data dependency.
    //
    // Native path (preferred): native.optimizeDepsParallelSplit runs both arms
    // via rayon::join inside a single Rust call — true OS-thread parallelism,
    // saving ~max(P1, P2) instead of P1 + P2 (~130ms on react-basic).
    // After the split, prepareProductionAutoCorePack takes the alreadyReady fast
    // path (files exist) and only writes the VendorPackV2 metadata (~2ms).
    //
    // Fallback: sequential P1 → P2 (original behaviour, always safe).
    //
    // Manual vendor packs (vendorPacksManualConfigured) always run sequentially —
    // their pack entry resolution is interleaved with usage scanning inside
    // prepareProductionManualPacks. A future T8b pass can hoist that.
    if (skipDepsAuthorityForSourceOnlyEdit) {
      depsMeasurementProfile.cacheMode = "local-verified-warm-source-only";
      logInfo(
        `[deps] Skipping dependency freshness scan for source-only edit ` +
          `(changed=${sourceOnlyMutationProof.changed}, depsHash=${depsHash}, DPL publication identity and Planner topology admitted)`,
      );
    } else if (skipDepsAuthorityForPublishedPlan) {
      depsMeasurementProfile.cacheMode = "pap-contract-current";
      logInfo(
        `[deps] Reusing DPL-verified Production Contracts generation ` +
          `(depsHash=${depsHash}, Planner identity and source proof current)`,
      );
    } else if (vendorPacksAutoConfigured) {
      const packsStart = Date.now();
      const vendorExclude = resolveAutoVendorEntryFsPaths(rootDir, config);

      if (
        vendorExclude !== null &&
        vendorExclude.size > 1 &&
        (native as any)?.optimizeDepsParallelSplit
      ) {
        // ── T8 native parallel path ────────────────────────────────────────
        const sentinelPath = path.join(depsRoot, ".verified");
        let depsSnapshotAlreadyFresh = false;
        let skipGlobalRestore = false;
        if (fs.existsSync(sentinelPath)) {
          const freshness = await checkVerifiedDepsSnapshotFreshness({
            rootDir,
            depsRoot,
            resolvedEntries: entries,
            allowedRoots: workspace.allowedRoots,
            config,
          });
          if (freshness.fresh) {
            const checkedLabel = freshness.checked > 0 ? `, checked=${freshness.checked}` : "";
            logInfo(`[deps] Skipping optimization (depsHash=${depsHash} already verified${checkedLabel})`);
            depsMeasurementProfile.cacheMode = "local-verified-warm";
            depsSnapshotAlreadyFresh = true;
          } else {
            try {
              fs.unlinkSync(sentinelPath);
            } catch {
              // Non-fatal: this process will still run the optimizer repair path.
            }
            skipGlobalRestore = true;
            const missingLabel = freshness.missing.length > 0 ? `, missing=${freshness.missing.length}` : "";
            logWarn(
              `[deps] Verified deps snapshot is stale (${freshness.reason ?? "unknown"}${missingLabel}); repairing`,
            );
          }
        }
        if (depsSnapshotAlreadyFresh) {
          // prepareProductionAutoCorePack will find files already exist → alreadyReady fast path.
        } else if (
          !skipGlobalRestore &&
          restoreDepArtifactsFromGlobalCache(depsHash, depsRoot, DEPS_OPTIMIZER_OUTPUT_VERSION) &&
          (await verifyRestoredDepsSnapshot({
            rootDir,
            depsRoot,
            sentinelPath,
            resolvedEntries: entries,
            allowedRoots: workspace.allowedRoots,
            config,
          }))
        ) {
          // ── T20: Global cache hit (demand-verified) ────────────────────────
          logInfo(`[deps] Restored from global cache (depsHash=${depsHash})`);
          depsMeasurementProfile.cacheMode = "global-cache-restored-cold";
        } else {
          // T6 artifact promotion (same as ensureOptimizedDeps)
          depsMeasurementProfile.cacheMode =
            depsMeasurementProfile.outputVersionMismatchSeen || hasPriorDepsOutputVersionMismatch(ionifyDir, depsRoot)
            ? "first-run-after-output-version-bump"
            : "no-cache-true-cold";
          if ((native as any)?.depsPromoteArtifacts) {
            const prevRoot = findPreviousDepsRoot(ionifyDir, depsRoot);
            if (prevRoot) {
              try {
                const r = (native as any).depsPromoteArtifacts(prevRoot, depsRoot, depsHash, DEPS_OPTIMIZER_OUTPUT_VERSION) as { promoted: number; skipped: number };
                depsMeasurementProfile.promoted += r.promoted;
                depsMeasurementProfile.promotionSkipped += r.skipped;
                if (r.promoted > 0) {
                  depsMeasurementProfile.cacheMode = "cross-depshash-promotion";
                  logInfo(`[deps] Promoted ${r.promoted} artifacts from previous deps dir (${r.skipped} need re-optimization)`);
                }
              } catch { /* non-fatal */ }
            }
          }

          // Resolve all non-vendor entry paths (same discovery as ensureOptimizedDeps)
          const batchEntryPaths = await (async () => {
            const out = new Set<string>();
            if (!native?.resolveModule) return out;
            const pkgJson = readProjectPackageJson(rootDir);
            const optimizeExclude = Array.isArray(config?.optimizeDeps?.exclude)
              ? new Set(config.optimizeDeps.exclude.map((s: any) => String(s)))
              : null;
            const depSpecifiers = Object.keys(pkgJson?.dependencies ?? {});
            const includeSpecifiers = Array.isArray(config?.optimizeDeps?.include)
              ? config.optimizeDeps.include.map((s: any) => String(s))
              : [];
            const vendorMode = config?.optimizeDeps?.vendor ?? "auto";
            const vendorSpecifiers = vendorMode === false ? [] : Array.isArray(vendorMode) ? vendorMode.map((s: any) => String(s)) : vendorMode === "auto" ? detectVendorSpecifiers(pkgJson) : [];
            const allSpecs = Array.from(new Set([...vendorSpecifiers, ...includeSpecifiers, ...depSpecifiers].map((s) => s.trim()).filter(Boolean))).filter((s) => !optimizeExclude?.has(s));
            for (const spec of allSpecs) {
              try {
                const r = native.resolveModule(spec, rootDir) as any;
                const fsPath = r?.fsPath ?? r?.fs_path ?? null;
                if (!fsPath || typeof fsPath !== "string" || !fsPath.includes("node_modules")) continue;
                if (!isOptimizableDepEntryPath(fsPath)) continue;
                if (!vendorExclude.has(fsPath)) out.add(fsPath);
              } catch { /* ignore */ }
            }
            const usageEntries = await resolveUsageEntries(rootDir, entries);
            if (usageEntries.length > 0) {
              try {
                const scanned = await scanDepEntryPaths({ rootDir, entries: usageEntries, allowedRoots: workspace.allowedRoots });
                for (const e of scanned) {
                  if (optimizeExclude?.has(e.packageName)) continue;
                  if (!isOptimizableDepEntryPath(e.entryPath)) continue;
                  if (!vendorExclude.has(e.entryPath)) out.add(e.entryPath);
                }
              } catch { /* fallback to package.json discovery */ }
            }
            return out;
          })();

          if (batchEntryPaths.size > 0 || vendorExclude.size > 0) {
            fs.mkdirSync(depsRoot, { recursive: true });
            const dplDemand = await scanDplUsageDemand({
              rootDir,
              depsRoot,
              depsHash,
              resolvedEntries: entries,
              allowedRoots: workspace.allowedRoots,
            });
            const batchEntries = Array.from(batchEntryPaths).map((entryPath) =>
              withDplUsageDemand(entryPath, depsHash, dplDemand.demandByEntryPath),
            );
            // vendorExclude contains the fsPath set; build the OptimizeChunkedEntry array
            const chunkedEntries = Array.from(vendorExclude).map((entryPath) =>
              withDplUsageDemand(entryPath, depsHash, dplDemand.demandByEntryPath),
            );
            try {
              const splitResult = (native as any).optimizeDepsParallelSplit(batchEntries, chunkedEntries, ionifyDir) as {
                chunkGroup: string;
                chunkFiles: string[];
                chunkedEntries: unknown[];
                errors: string[];
              };
              for (const err of splitResult.errors ?? []) {
                logWarn(`[deps] WARN (parallel split): ${err}`);
              }
            } catch (err) {
              logWarn(`[deps] WARN: Parallel split failed, falling back: ${String(err)}`);
              // Fall through to sequential below — but don't write sentinel yet
              await ensureOptimizedDeps({
                rootDir, ionifyDir, depsHash, depsRoot, config,
                resolvedEntries: entries, allowedRoots: workspace.allowedRoots,
                excludeEntryPaths: vendorExclude,
                publishGeneration: false,
              });
            }
            // Optimizer diagnostics are not publication authority: package.json
            // discovery includes tools and unused candidates outside the app
            // runtime closure. DPL alone admits the generation after resolving
            // current raw demand to its active publication topology and ABI.
            await publishVerifiedDepsGeneration({
              rootDir,
              depsRoot,
              depsHash,
              resolvedEntries: entries,
              allowedRoots: workspace.allowedRoots,
              config,
              runtimeDemands: dplDemand.runtimeDemands ?? undefined,
            });
          } else {
            await publishVerifiedDepsGeneration({
              rootDir,
              depsRoot,
              depsHash,
              resolvedEntries: entries,
              allowedRoots: workspace.allowedRoots,
              config,
            });
          }
        }
        // prepareProductionAutoCorePack will find files already exist → alreadyReady fast path
        try {
          const packs = await prepareProductionAutoCorePack({ rootDir, ionifyDir, depsHash, depsRoot, config });
          if (packs.reasons && packs.reasons.length) {
            logWarn(`[deps] Production packs unavailable (${packs.reasons.join(", ")}). Skipping.`);
          } else if (packs.didWork) {
            logInfo(`Production packs ready in ${Date.now() - packsStart}ms (CAS-first, rust-parallel)`);
          } else {
            logInfo(`Production packs ready in ${Date.now() - packsStart}ms (cached)`);
          }
        } catch (err) {
          logWarn(`[deps] WARN: Production pack prep failed: ${String(err)}`);
        }

      } else {
        // ── Fallback: sequential P1 → P2 ──────────────────────────────────
        await ensureOptimizedDeps({
          rootDir,
          ionifyDir,
          depsHash,
          depsRoot,
          config,
          resolvedEntries: entries,
          allowedRoots: workspace.allowedRoots,
          excludeEntryPaths: vendorExclude ?? undefined,
        });
        const packsStart2 = Date.now();
        try {
          const packs = await prepareProductionAutoCorePack({
            rootDir,
            ionifyDir,
            depsHash,
            depsRoot,
            config,
          });
          if (packs.reasons && packs.reasons.length) {
            logWarn(`[deps] Production packs unavailable (${packs.reasons.join(", ")}). Skipping.`);
          } else if (packs.didWork) {
            logInfo(`Production packs ready in ${Date.now() - packsStart2}ms (CAS-first)`);
          } else {
            logInfo("Production packs ready (cached)");
          }
        } catch (err) {
          logWarn(`[deps] WARN: Production pack prep failed: ${String(err)}`);
        }
      }
    } else {
      // No auto vendor packs: sequential P1 only (+ optional manual packs after)
      await ensureOptimizedDeps({
        rootDir,
        ionifyDir,
        depsHash,
        depsRoot,
        config,
        resolvedEntries: entries,
        allowedRoots: workspace.allowedRoots,
      });

      if (vendorPacksManualConfigured) {
        const depsManifestIndexForPacks = loadDepsManifestIndex(depsRoot);
        const packsStart = Date.now();
        try {
          const packs = await prepareProductionManualPacks({
            rootDir,
            ionifyDir,
            depsHash,
            depsRoot,
            config,
            resolvedEntries: entries,
            allowedRoots: workspace.allowedRoots,
            depsManifestIndex: depsManifestIndexForPacks,
          });
          if (packs.reasons && packs.reasons.length) {
            logWarn(`[deps] Production packs unavailable (${packs.reasons.join(", ")}). Skipping.`);
          } else if (packs.didWork) {
            logInfo(`Production packs ready in ${Date.now() - packsStart}ms (CAS-first)`);
          } else {
            logInfo("Production packs ready (cached)");
          }
        } catch (err) {
          logWarn(`[deps] WARN: Production pack prep failed: ${String(err)}`);
        }
      }
    }

    // T19: load dep-stop set for graph_build_from_entries (cold path only).
    // Allows the native BFS to record dep entries as leaf nodes instead of crawling
    // into node_modules source trees \u2014 saves ~500-1100ms on large apps (UP-Portal scale).
    // A DPL+Planner-admitted mutation never enters graph planning, so loading
    // the full dependency stop set here would duplicate DPL consumption.
    const depStops = skipDepsAuthorityForCanonicalPlan ? [] : loadDepStopsFromManifest(depsRoot);
    logBuildProfile("depsAuthorityAndPacks", depsPhaseStart);

    // ── C3-c Method-2 Phase C (cold path): PURE JOIN — retained Resolver boundary
    // membership (Fact A, produced once by Phase A) × post-publication DPL depStops
    // (Fact B: the pre-built dependency artifactHash) → dep-leaf Graph records. No
    // re-resolution, no second Parser, no provisional dep-leaf before DPL: dep-leaf IDs
    // come from the app records' OWN resolved edges (already correct ws:// ids), and the
    // only join is depStop.entryPath → ws:// id → artifactHash. Pre-populating the Graph
    // (app records + dep leaves) makes generateBuildPlan's persisted graph entry-reachable,
    // so `rebuildGraphFromEntries` / Parser(A) never runs on the true-cold path.
    if (coldDerivation && !skipDepsAuthorityForCanonicalPlan && native?.graphRecordBatch) {
      const phaseCStart = Date.now();
      // Open the SAME shared graph (path + version) generateBuildPlan will read, so the
      // pre-populated records are the graph it validates (idempotent re-open there).
      const phaseCGraphReady = ensureNativeGraph(
        path.join(ionifyDir, "graph.db"),
        computeGraphVersion(rawVersionInputs),
        { retryMs: 1500, retryIntervalMs: 50 },
      );
      const depStopById = new Map<string, string>();
      for (const s of depStops) {
        if (!s.artifactHash) continue;
        const depId = toWsModuleId(canonicalFsPath(s.entryPath), workspace.workspaceRoot);
        if (depId) depStopById.set(depId, s.artifactHash);
      }
      const appIds = new Set(coldDerivation.appRecords.map((r) => r.id));
      const depLeafRecords: NativeGraphRecordBatchNode[] = [];
      const emittedLeaf = new Set<string>();
      for (const rec of coldDerivation.appRecords) {
        for (const edge of [...(rec.deps ?? []), ...(rec.dynamicDeps ?? [])]) {
          if (emittedLeaf.has(edge) || appIds.has(edge)) continue;
          const artifactHash = depStopById.get(edge);
          if (artifactHash) {
            // Fact A ∩ Fact B: a resolved dependency-boundary target with a published artifact.
            emittedLeaf.add(edge);
            depLeafRecords.push({ id: edge, hash: artifactHash, deps: [], dynamicDeps: [], runtimeLinks: [], kind: "dep" });
            continue;
          }
          // App-source NON-JS asset edge (e.g. `.css`): the canonical scheduler derives only
          // JS, so these leaves are projected here to complete the app graph. Content-hashed
          // identically to the legacy graph (getCacheKey of the source bytes); kind by extension.
          const edgeAbs = edge.startsWith(WS_MODULE_PREFIX) ? fromWsModuleId(edge, workspace.workspaceRoot) : null;
          if (!edgeAbs || !fs.existsSync(edgeAbs)) continue;
          const ext = path.extname(edgeAbs).toLowerCase();
          const isCss = ext === ".css" || ext === ".scss" || ext === ".sass" || ext === ".less";
          emittedLeaf.add(edge);
          depLeafRecords.push({
            id: edge,
            hash: getCacheKey(fs.readFileSync(edgeAbs)),
            deps: [],
            dynamicDeps: [],
            runtimeLinks: [],
            kind: isCss ? "css" : "asset",
          });
        }
      }
      const admitted = phaseCGraphReady
        ? native.graphRecordBatch([...coldDerivation.appRecords, ...depLeafRecords])
        : -1;
      logBuildProfile("coldCanonicalGraphProjection", phaseCStart);
      logInfo(
        `[C3-c] Phase C graph projection: ready=${phaseCGraphReady} app=${coldDerivation.appRecords.length} depLeaf=${depLeafRecords.length} admitted=${admitted}`,
      );
    }
    logTopologyValidationProfile(depsRoot);

    // Phase 5-Cloud-EI-DX2 — `ionify optimize-all` short-circuit. The deps
    // optimizer pass above has already produced (or reused) every dep
    // artifact and written the `.verified` sentinel. Stop here so callers
    // get an idempotent snapshot without paying for build plan + bundler +
    // compression.
    if (options.depsOnly) {
      writeDepsMeasurementArtifacts(depsRoot);
      logInfo(
        `[deps] optimize-all: snapshot ready at .ionify/deps/${depsHash}/ (skipping bundler, no dist/ output).`,
      );
      return {
        depsHash,
        canonicalPlan: sourceOnlyCanonicalPlan,
      } satisfies BuildDependencyPreparation;
    }

    const federationExposeEntries = collectFederationExposeEntryPaths(config, rootDir);
    const buildEntries = Array.from(
      new Set([...(entries ?? []), ...federationExposeEntries]),
    );

    logInfo("Building...");

    const planStart = Date.now();
    // The early PRA read is the process-local authoritative snapshot for this
    // build. Re-reading the same publication cannot strengthen identity and
    // only repeats JSON hydration on the mutation path.
    const publishedPlanCandidate = earlyPublishedPlan;
    logBuildProfileDuration("publishedProductionPlanReread", 0);
    const publishedPlan =
      publishedPlanCandidate &&
      !sourceOnlyCanonicalPlan &&
      earlySourceFreshnessAudit?.current === true
        ? publishedPlanCandidate
        : null;
    if (publishedPlanCandidate && !publishedPlan) {
      logInfo("[PRA] Published Production Plan source proof is stale; refreshing graph before planning");
    }
    const canonicalMutationPlan = !publishedPlan ? sourceOnlyCanonicalPlan : null;
    let plan = publishedPlan
      ? publishedPlan
      : canonicalMutationPlan
        ? canonicalMutationPlan
      : await generateBuildPlan(
          buildEntries.length > 0 ? buildEntries : undefined,
          rawVersionInputs,
          depStops,
          buildExternalSpecifiers,
          skipDepsAuthorityForSourceOnlyEdit ? sourceOnlyMutationProof.changedPaths : undefined,
          skipDepsAuthorityForSourceOnlyEdit ? sourceOnlyMutationProof.runtimeMutations : undefined,
          skipDepsAuthorityForSourceOnlyEdit ? publishedPlanCandidate ?? undefined : undefined,
          skipDepsAuthorityForSourceOnlyEdit ? depsRoot : undefined,
          undefined,
          canonicalBuildContext,
        );
    logBuildProfile("generateBuildPlan", planStart);
    if (publishedPlan) {
      logInfo(`[Build] Using published Production Plan (${plan.chunks.length} chunk(s), identity verified)`);
    }
    const totalPlannedModules = plan.chunks.reduce((acc, chunk) => acc + chunk.modules.length, 0);
    logInfo(
      `[Build] Plan ready: entries=${plan.entries.length}, chunks=${plan.chunks.length}, modules=${totalPlannedModules}`,
    );
    const readinessRecordReadStart = Date.now();
    const productionReadinessRecord: ProductionReadinessRecord | null =
      earlyProductionReadinessRecord;
    logBuildProfile("productionReadinessRecordRead", readinessRecordReadStart);
    const sourceFreshnessPreflightStart = Date.now();
    const sourceFreshnessCurrent =
      publishedPlan !== null && earlySourceFreshnessAudit?.current === true;
    logBuildProfile("praSourceFreshnessPreflight", sourceFreshnessPreflightStart);
    const verifiedPraForPublishedPlan =
      publishedPlan !== null &&
      sourceFreshnessCurrent &&
      isVerifiedProductionReadinessForPlan(productionReadinessRecord, {
        configHash,
        workspaceRoot: workspace.workspaceRoot,
        projectRoot: rootDir,
        depsHash,
        plan,
        depsOptimizerOutputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      });
    if (verifiedPraForPublishedPlan) {
      logInfo("[PRA] Verified deploy-ready identity for current Production Plan; skipping duplicate canonical dependency readiness probe");
    } else if (productionReadinessRecord?.state === "verified" && publishedPlan !== null && !sourceFreshnessCurrent) {
      logInfo("[PRA] Verified deploy-ready identity found, but source freshness proof is missing or stale; using normal canonical dependency probe");
    }

    const federationGraphStart = Date.now();
    const federationGraph = config?.federation
      ? new Graph(rawVersionInputs, { ionifyDir })
      : null;
    const federationRemoteBindings = config?.federation
      ? collectFederationRemoteImportBindings(config, rootDir)
      : new Map<string, string>();
    logBuildProfile("federationGraphSetup", federationGraphStart);
    if (config?.federation && federationGraph) {
      syncFederationGraphNodes(federationGraph, buildFederationConfigGraphNodes(config, rootDir));
      for (const chunk of plan.chunks) {
        for (const mod of chunk.modules) {
          if (mod.kind !== "js") continue;
          let fsPath =
            typeof mod.fsPath === "string" && mod.fsPath.length > 0 ? mod.fsPath : null;
          if (!fsPath && typeof mod.id === "string" && mod.id.startsWith(WS_MODULE_PREFIX)) {
            fsPath = fromWsModuleId(mod.id, workspace.workspaceRoot);
          }
          const existingNode = fsPath ? federationGraph.getNode(fsPath) : undefined;
          let nextStaticDeps = existingNode?.deps ?? mod.deps ?? [];
          let nextDynamicDeps = existingNode?.dynamicDeps ?? mod.dynamicDeps ?? [];
          if (fsPath && path.isAbsolute(fsPath) && fs.existsSync(fsPath)) {
            try {
              const code = fs.readFileSync(fsPath, "utf8");
              const specs = native?.parseModuleIr
                ? (native.parseModuleIr(fsPath, code)?.dependencies ?? []).map((dep: any) => dep.specifier)
                : extractImports(code, fsPath);
              const { localDeps, externalDeps } = classifyImportSpecifiersForGraph(
                specs,
                fsPath,
                buildExternalSpecifiers,
              );
              nextStaticDeps = [...localDeps, ...externalDeps];
              nextDynamicDeps = [];
            } catch {
              // Fall back to the pre-existing persisted node shape when source re-read/parsing fails.
            }
          }
          const deps = rewriteFederationGraphEdgeIds(nextStaticDeps, federationRemoteBindings);
          const dynamicDeps = rewriteFederationGraphEdgeIds(
            nextDynamicDeps,
            federationRemoteBindings,
          );
          if (
            JSON.stringify(deps) === JSON.stringify(nextStaticDeps) &&
            JSON.stringify(dynamicDeps) === JSON.stringify(nextDynamicDeps)
          ) {
            continue;
          }
          if (fsPath && path.isAbsolute(fsPath)) {
            federationGraph.recordFile(fsPath, mod.hash ?? existingNode?.hash ?? getCacheKey(mod.id), deps, dynamicDeps, mod.kind);
          } else {
            federationGraph.recordNodeById(mod.id, mod.hash ?? null, deps, dynamicDeps, mod.kind);
          }
        }
      }
    }

    let readinessPlanForIdentity: BuildPlan | null = null;

    // ── Production dependency authority ─────────────────────────────────────
    // Canonical order: DPL artifacts first, then buildChunks/PAP consume that
    // single artifact plan shape. PDC is frozen and is not part of the live
    // dependency value or cache-identity path.
    if (!verifiedPraForPublishedPlan && !skipDepsAuthorityForCanonicalPlan) {
      const casRoot = path.join(ionifyDir, "cas");
      const canonicalDeps = await prepareCanonicalProductionDependencyPlan({
        plan,
        rootDir,
        ionifyDir,
        depsRoot,
        depsHash,
        resolvedEntries: entries,
        allowedRoots: workspace.allowedRoots,
        casRoot,
        configHash,
        workspaceRoot: workspace.workspaceRoot,
        config,
        vendorMaxBytes: productionChunkPolicy.vendorMaxBytes,
        skipDependencyCoverageRepair: skipDepsAuthorityForCanonicalPlan,
      });
      if (canonicalDeps.rerouted > 0 || canonicalDeps.pruned > 0) {
        logInfo(
          `[Build] Deps artifact rerouting: ${canonicalDeps.rerouted} entries rerouted (${canonicalDeps.idRewritten} ids → artifact identity), ${canonicalDeps.pruned} internal modules pruned${canonicalDeps.sharedPrewarmed > 0 ? `, ${canonicalDeps.sharedPrewarmed} shared artifacts pre-warmed` : ""}`,
        );
      }
      logBuildProfileDuration("depsReroute", canonicalDeps.rerouteMs);
      logBuildProfileDuration("canonicalDependencyPlan", canonicalDeps.rerouteMs);
    } else {
      logBuildProfileDuration("depsReroute", 0);
      logBuildProfileDuration("canonicalDependencyPlan", 0);
    }
    const outDir = options.outDir || "dist";
    const absOutDir = path.resolve(outDir);
    const readinessPlanCloneStart = Date.now();
    readinessPlanForIdentity = plan;
    // Planner's canonical plan becomes immutable at the DPL-reroute boundary.
    // Build every Transform/CAS/Bundler reference index from an independent
    // emission projection so artifact-hash replacement cannot flow backward
    // into Planner or PRA identity.
    plan = createEmissionPlanProjection(plan);
    logBuildProfile("readinessPlanClone", readinessPlanCloneStart);

    const moduleRefsById = new Map<
      string,
      Array<{ id: string; fsPath?: string | null; hash?: string | null; kind?: string | null }>
    >();
    const moduleMetaById = new Map<
      string,
      { fsPath: string; kind: "js" | "css"; hash: string | null; proofKind: ProofKind | null }
    >();
    const moduleIndexStart = Date.now();
    for (const chunk of plan.chunks) {
      for (const mod of chunk.modules) {
        if (mod.kind !== "js" && mod.kind !== "css") continue;

        let fsPath: string | null =
          typeof mod.fsPath === "string" && mod.fsPath.length > 0 ? mod.fsPath : null;

        if (!fsPath && typeof mod.id === "string" && mod.id.startsWith(WS_MODULE_PREFIX)) {
          fsPath = fromWsModuleId(mod.id, workspace.workspaceRoot);
        }

        if (!fsPath && typeof mod.id === "string" && path.isAbsolute(mod.id)) {
          fsPath = mod.id;
        }

        if (!fsPath || !path.isAbsolute(fsPath)) continue;
        mod.fsPath = fsPath;
        const existing = moduleMetaById.get(mod.id);
        if (!existing) {
          moduleMetaById.set(mod.id, {
            fsPath,
            kind: mod.kind,
            hash: typeof mod.hash === "string" && mod.hash.length > 0 ? mod.hash : null,
            proofKind: (mod as any).proofKind ?? null,
          });
        }
        const bucket = moduleRefsById.get(mod.id);
        if (bucket) bucket.push(mod as any);
        else moduleRefsById.set(mod.id, [mod as any]);
      }
    }
    logBuildProfile("moduleIndex", moduleIndexStart);

    const cssDemandGraphRegisterStart = Date.now();
    const compactCssDemandGraphContent = skipDepsAuthorityForSourceOnlyEdit
      ? refreshCssDemandGraphContentStamp(
          rootDir,
          sourceOnlyMutationProof.changedPaths,
        )
      : null;
    let cssDemandGraphRequired: boolean;
    let cssDemandRegisteredFiles: string[];
    let cssDemandGraphContent;
    if (compactCssDemandGraphContent) {
      cssDemandGraphRequired = true;
      cssDemandGraphContent = compactCssDemandGraphContent;
      cssDemandRegisteredFiles = compactCssDemandGraphContent.changed
        ? registerCssDemandGraphSourceFiles(rootDir, [], { stableTopology: true })
        : [];
    } else {
      cssDemandGraphRequired = requiresCssDemandGraphContentStamp(
        Array.from(moduleMetaById.values())
          .filter((meta) => meta.kind === "css")
          .map((meta) => {
            if (!meta.hash) return null;
            const cssMeta = readJsonFile<CssCasMeta>(
              path.join(getCasArtifactPath(casRoot, configHash, meta.hash), "meta.json"),
            );
            if (
              !cssMeta ||
              cssMeta.version !== CSS_CAS_META_VERSION ||
              cssMeta.baseHash !== meta.hash ||
              !cssMeta.tailwindGraphContent
            ) {
              return null;
            }
            return {
              enabled: cssMeta.tailwindGraphContent.enabled === true,
              files: Number(cssMeta.tailwindGraphContent.files ?? 0),
            };
          }),
      );
      const cssDemandGraphFiles = cssDemandGraphRequired
        ? Array.from(moduleMetaById.values())
            .filter((meta) => {
              if (meta.kind !== "js") return false;
              if (meta.fsPath.includes("node_modules") || meta.fsPath.includes("/.ionify/")) return false;
              const clean = meta.fsPath.split("?")[0]!.split("#")[0]!.toLowerCase();
              return clean.endsWith(".js") || clean.endsWith(".jsx") || clean.endsWith(".ts") || clean.endsWith(".tsx") || clean.endsWith(".mdx");
            })
            .map((meta) => meta.fsPath)
        : [];
      cssDemandRegisteredFiles = registerCssDemandGraphSourceFiles(
        rootDir,
        cssDemandGraphFiles,
        skipDepsAuthorityForSourceOnlyEdit ? { stableTopology: true } : undefined,
      );
      // One CSSA-owned aggregated stamp per build over the graph-admitted Tailwind
      // content set. All CSS artifact freshness gates and css:v3 recipes consume
      // this stamp; nothing re-derives per-artifact source dependency lists.
      cssDemandGraphContent = computeCssDemandGraphContentStamp(
        rootDir,
        skipDepsAuthorityForSourceOnlyEdit
          ? { stableTopologyChangedFiles: sourceOnlyMutationProof.changedPaths }
          : undefined,
      );
    }
    const cssDemandGraphStamp = cssDemandGraphContent?.stamp ?? null;
    if (isBuildProfileEnabled()) {
      logInfo(
        `[BuildProfile][cssDemandGraph] register_ms=${Date.now() - cssDemandGraphRegisterStart} required=${cssDemandGraphRequired ? 1 : 0} files=${cssDemandGraphContent?.files ?? cssDemandRegisteredFiles.length} stamp=${cssDemandGraphStamp ? cssDemandGraphStamp.slice(0, 12) : "none"} extraction_ms=0 cacheHit=0 cacheMiss=0 tokens=0`,
      );
    }

    const moduleOutputs = new Map<string, { code: string; type: "js" | "css" | "asset" }>();

    const modulesInPlan = moduleMetaById.size;
    const transformCasProfile = createTransformCasProfile();

    let casHits = 0;
    const sourceOnlyChangedPaths = new Set(
      (skipDepsAuthorityForSourceOnlyEdit ? sourceOnlyMutationProof.changedPaths : [])
        .map((filePath) => path.resolve(filePath)),
    );
    const incrementalHydrationModuleIds =
      skipDepsAuthorityForSourceOnlyEdit && sourceOnlyChangedPaths.size > 0
        ? new Set(
            Array.from(moduleMetaById.entries())
              .filter(([, meta]) => {
                if (sourceOnlyChangedPaths.has(path.resolve(meta.fsPath))) return true;
                return meta.kind === "css" && cssDemandGraphContent?.changed === true;
              })
              .map(([id]) => id),
          )
        : null;
    if (incrementalHydrationModuleIds) {
      casHits = Math.max(0, modulesInPlan - incrementalHydrationModuleIds.size);
    }

    // ── Source freshness scan ──────────────────────────────────────────────────
    // When source files are edited while no dev server is running, graph.db
    // retains the old per-module hash.  Both Tier-1 (transform cache) and Tier-4
    // (chunk CAS) are keyed by that hash, so a stale graph causes the build to
    // serve old bundled output even when sources changed.
    //
    // Strategy: per-source stamp cache.
    // A single global "last scan" timestamp is not a correctness proof: if a stale
    // build writes the stamp after a source edit, future builds can skip hashing the
    // edited file forever. Instead, cache each source hash under its own
    // (module id, fsPath, dev, ino, mtime, ctime, size) identity:
    //   1. stat() every source module — O(N) syscalls, ~0.003ms/file, no I/O.
    //   2. Reuse a cached hash only when the file identity metadata matches exactly.
    //      Otherwise readFileSync+hash that one file.
    //   3. Always compare the proven disk hash to graph.db's module hash.
    //   4. When a hash mismatch is found: patch meta.hash + plan ref.hash in-memory
    //      and write the new hash back to graph.db via graphRecord.
    //
    // Cost on up-portal warm builds (no edits):
    //   ~300 source files × 0.003ms stat = ~0.9ms  (vs 5ms readFileSync+hash).
    //
    // Patching propagates to:
    //   - jsCasFileById / CAS hydration pass → Tier-1 miss → re-transform ✓
    //   - ref.hash on plan module objects → Rust chunkHash changes → Tier-4 miss ✓
    if (!skipDepsAuthorityForSourceOnlyEdit) {
      const freshnessStart = Date.now();
      const freshnessCacheFile = path.join(ionifyDir, "source-freshness.v1.json");
      type FreshnessCacheEntry = {
        fsPath: string;
        dev: number;
        ino: number;
        mtimeMs: number;
        ctimeMs: number;
        size: number;
        hash: string;
      };
      let freshnessCache: Record<string, FreshnessCacheEntry> = {};
      try {
        const parsed = JSON.parse(fs.readFileSync(freshnessCacheFile, "utf8"));
        if (parsed && typeof parsed === "object") {
          freshnessCache = parsed as Record<string, FreshnessCacheEntry>;
        }
      } catch {
        // No cache yet → hash each source once.
      }

      let staleCount = 0;
      const nextFreshnessCache: Record<string, FreshnessCacheEntry> = {};
      for (const [id, meta] of moduleMetaById.entries()) {
        if (!meta.hash || !meta.fsPath) continue;
        // Skip dep artifacts (under .ionify/) and node_modules (already content-hashed
        // by the dep optimizer; those hashes are stable across depsHash changes).
        const fp = meta.fsPath;
        if (fp.includes("node_modules") || fp.includes("/.ionify/")) continue;
        if (meta.kind !== "js" && meta.kind !== "css") continue;
        try {
          const st = fs.statSync(fp);
          const cacheKey = `${id}\n${fp}`;
          const cached = freshnessCache[cacheKey];
          const diskHash =
            cached &&
            cached.fsPath === fp &&
            cached.dev === st.dev &&
            cached.ino === st.ino &&
            cached.mtimeMs === st.mtimeMs &&
            cached.ctimeMs === st.ctimeMs &&
            cached.size === st.size &&
            typeof cached.hash === "string" &&
            cached.hash.length > 0
              ? cached.hash
              : getCacheKey(fs.readFileSync(fp));
          nextFreshnessCache[cacheKey] = {
            fsPath: fp,
            dev: st.dev,
            ino: st.ino,
            mtimeMs: st.mtimeMs,
            ctimeMs: st.ctimeMs,
            size: st.size,
            hash: diskHash,
          };
          if (diskHash !== meta.hash) {
            meta.hash = diskHash;
            // Patch plan module objects so the Rust bundler uses the correct chunkHash.
            const refs = moduleRefsById.get(id) ?? [];
            for (const ref of refs) ref.hash = diskHash;
            staleCount++;
            // Write updated hash back to graph.db so subsequent builds agree.
            if (native?.graphRecord) {
              const firstRef = refs[0] as any;
              const deps: string[] = Array.isArray(firstRef?.deps) ? firstRef.deps : [];
              const dynDeps: string[] = Array.isArray(firstRef?.dynamicDeps) ? firstRef.dynamicDeps : [];
              try {
                native.graphRecord(id, diskHash, deps, dynDeps, meta.kind, null);
              } catch {
                // Non-fatal: next build will re-detect and re-patch.
              }
            }
          }
        } catch {
          // File may be deleted or unreadable; let the transform phase handle it.
        }
      }
      if (staleCount > 0) {
        logInfo(`[Build] ${staleCount} source module(s) changed since last graph update — CAS keys refreshed`);
      }

      // Update the per-source freshness cache after the scan. This is a performance
      // accelerator only; build correctness does not depend on it being present.
      try {
        fs.mkdirSync(ionifyDir, { recursive: true });
        const tmpFreshness = `${freshnessCacheFile}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmpFreshness, `${JSON.stringify(nextFreshnessCache)}\n`, "utf8");
        fs.renameSync(tmpFreshness, freshnessCacheFile);
      } catch {
        // Non-fatal: next build will fall back to hashing sources.
      }
      logBuildProfile("freshnessScan", freshnessStart);
    } else {
      // Planner's staged canonical mutation already committed the changed hash
      // and preserved or replaced its verified edges. Re-scanning and
      // republishing the complete source population here would introduce a
      // second graph mutation path.
      logBuildProfileDuration("freshnessScan", 0);
    }
    const praOutputProbeStart = Date.now();
    const verifiedPraOutputReuse =
      verifiedPraForPublishedPlan && productionReadinessRecord
        ? tryVerifyProductionReadinessOutputReuse(absOutDir, productionReadinessRecord)
        : null;
    logBuildProfile("praOutputReadinessProbe", praOutputProbeStart);
    if (verifiedPraOutputReuse) {
      logInfo("[PRA] Verified deploy-ready outputs for current Production Plan; skipping duplicate CAS/dist probes");
      logBuildProfileDuration("casBatchCheck", 0);
      logBuildProfileDuration("casHydration", 0);
      logBuildProfileDuration("distReuseProbe", 0);
      logBuildProfileDuration("emitChunksAndFiles", 0);
      logBuildProfileDuration("writeBuildManifest", 0);
      logBuildProfileDuration("writeAssetsManifest", 0);
      logBuildProfileDuration("emitIndexHtml", 0);
      logBuildProfileDuration("publicAssetReadiness", 0);
      logBuildProfileDuration("writeBuildStats", 0);
      logBuildProfileDuration("manifestAssetsStats", 0);

      const outputHashHints = collectOutputHashHints(verifiedPraOutputReuse.stats);
      const distProof = productionReadinessRecord.proofs.dist;
      if (distProof.manifestHash) outputHashHints.set("manifest.json", distProof.manifestHash);
      if (distProof.buildStatsHash) outputHashHints.set("build.stats.json", distProof.buildStatsHash);
      if (distProof.assetsManifestHash) outputHashHints.set("manifest.assets.json", distProof.assetsManifestHash);
      if (distProof.indexHtmlHash) outputHashHints.set("index.html", distProof.indexHtmlHash);
      for (const asset of productionReadinessRecord.proofs.publicAssets.assets) {
        outputHashHints.set(toPosixPath(asset.file), asset.hash);
      }

      const coreBuildElapsed = Date.now() - buildStart;
      logInfo(`Build plan generated → ${path.join(absOutDir, "manifest.json")}`);
      logInfo(`Entries: ${plan.entries.length}, Chunks: ${plan.chunks.length}`);
      logInfo(`Modules in plan: ${modulesInPlan}`);
      logInfo(`CAS hits: PRA verified • transforms needed: 0`);
      logInfo(`Build complete in ${coreBuildElapsed}ms`);
      logInfo(`[Build] Time-to-deploy-ready: ${coreBuildElapsed}ms`);
      logBuildProfileDuration("timeToDeployReady", coreBuildElapsed);

      const compression = await runPostBuildCompression({
        config,
        absOutDir,
        casRoot,
        outputHashHints,
        buildStart,
      });

      const praEmitStart = Date.now();
      try {
        const readinessRecord = createProductionReadinessRecord({
          configHash,
          workspaceRoot: workspace.workspaceRoot,
          projectRoot: rootDir,
          depsHash,
          plan: readinessPlanForIdentity,
          artifacts: verifiedPraOutputReuse.artifacts,
          dist: {
            manifestHash: distProof.manifestHash ?? "",
            buildStatsHash: distProof.buildStatsHash ?? "",
            assetsManifestHash: distProof.assetsManifestHash,
            indexHtmlHash: distProof.indexHtmlHash,
          },
          compression,
          publicAssets: productionReadinessRecord.proofs.publicAssets,
          depsOptimizerOutputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
        });
        writeProductionReadinessRecord(ionifyDir, readinessRecord);
      } catch (err) {
        logWarn(`[PRA] Skipped deploy-ready.v1 emit: ${err instanceof Error ? err.message : String(err)}`);
      }
      logBuildProfile("praEmit", praEmitStart);
      const slimmingSaved = computeBuildSlimmingSavedPercent(depsRoot, depsHash);
      const vendorPacksSaved = computeBuildVendorPackRequestsSavedPercent(depsRoot, depsHash);
      logInfo(`Slimming saved: ${typeof slimmingSaved === "number" ? `${slimmingSaved}%` : "0%"}`);
      logInfo(`Vendor packs saved: ${typeof vendorPacksSaved === "number" ? `${vendorPacksSaved}%` : "0%"} requests`);
      return;
    }

    const defineJobs: Array<{ id: string; artifactHash: string; baseHash: string; baseCode: string }> = [];
    const cssDerivedArtifactHashById = new Map<string, string>();
    const jobs: Array<{
      id: string;
      filePath: string;
      ext: string;
      code: string;
      kind: "js" | "css";
      baseHash: string;
      artifactHash: string;
      cssNeedsJsWrapper?: boolean;
    }> = [];
    const getArtifactHash = (baseHash: string, kind: "js" | "css", dh: string = defineHash): string => {
      if (kind !== "js") return baseHash;
      if (!dh) return baseHash;
      return getCacheKey(`${baseHash}|define:${dh}`);
    };

    // G2-C2: the expected Transform-artifact contract for a consumed JS module,
    // used by admitTransformArtifact. `variant`/`defineHash` describe the
    // artifact the plan actually consumes (the define-variant when a define is
    // configured, else the base). recomputeArtifactHash reuses getArtifactHash so
    // the proof↔location check duplicates no identity math (design §11.3).
    const jsProofExpectation = (baseHash: string, artifactHash: string): TransformArtifactExpectation => ({
      sourceHash: baseHash,
      recipeConfigHash: configHash,
      defineHash,
      artifactKind: "js",
      variant: defineHash ? "define" : "base",
      artifactHash,
      recomputeArtifactHash: (sh, kind, dh) => getArtifactHash(sh, kind === "css" ? "css" : "js", dh),
    });
    // Expectation for the pre-define BASE artifact (its dir hash == baseHash,
    // defineHash == ""), verified before deriving a define-variant from it so a
    // corrupt base cannot silently produce a corrupt variant.
    const jsBaseProofExpectation = (baseHash: string): TransformArtifactExpectation => ({
      sourceHash: baseHash,
      recipeConfigHash: configHash,
      defineHash: "",
      artifactKind: "js",
      variant: "base",
      artifactHash: baseHash,
      recomputeArtifactHash: (sh, kind, dh) => getArtifactHash(sh, kind === "css" ? "css" : "js", dh),
    });

    // Pre-compute casFile paths for non-CSS modules and batch-check existence in parallel
    // (Rust/Rayon stat syscalls vs N sequential TS-side fs.existsSync calls).
    const jsCasFileById = new Map<string, string>();
    for (const [id, meta] of moduleMetaById.entries()) {
      if (incrementalHydrationModuleIds && !incrementalHydrationModuleIds.has(id)) continue;
      if (meta.kind !== "css" && meta.hash) {
        const ah = getArtifactHash(meta.hash, meta.kind);
        jsCasFileById.set(id, path.join(getCasArtifactPath(casRoot, configHash, ah), "transformed.js"));
      }
    }
    const casExistsMap = new Map<string, boolean>();
    if (jsCasFileById.size > 0) {
      const batchPaths = Array.from(jsCasFileById.values());
      const casBatchStart = Date.now();
      const batchExists = (native as any).casBatchCheck(batchPaths) as boolean[];
      logBuildProfile("casBatchCheck", casBatchStart);
      for (let i = 0; i < batchPaths.length; i++) {
        casExistsMap.set(batchPaths[i], batchExists[i]);
      }
    }
    // CAS hydration pass: skip transforms when artifacts already exist.
    const hydrationStart = Date.now();
    for (const [id, meta] of moduleMetaById.entries()) {
      if (incrementalHydrationModuleIds && !incrementalHydrationModuleIds.has(id)) continue;
      const refs = moduleRefsById.get(id) ?? [];
      const baseHashFromPlan = meta.hash;
      const cssNeedsJsWrapper = meta.kind === "css" && isCssModuleFile(meta.fsPath);
      let artifactHashFromPlan = baseHashFromPlan && meta.kind !== "css" ? getArtifactHash(baseHashFromPlan, meta.kind) : null;

      if (meta.kind === "css" && baseHashFromPlan) {
        const baseDir = getCasArtifactPath(casRoot, configHash, baseHashFromPlan);
        let cssMeta = readJsonFile<CssCasMeta>(path.join(baseDir, "meta.json"));
        if (!cssMeta) {
          const restoreStart = Date.now();
          const restored = restoreCssArtifactFromGlobalCache(
            configHash,
            baseHashFromPlan,
            casRoot,
            cssNeedsJsWrapper,
            cssDemandGraphStamp,
          );
          transformCasProfile.cssGlobalCacheRestoreMs += Date.now() - restoreStart;
          if (restored.restored) {
            transformCasProfile.cssGlobalCacheRestoreHit += 1;
            cssMeta = readJsonFile<CssCasMeta>(path.join(baseDir, "meta.json"));
          } else {
            transformCasProfile.cssGlobalCacheRestoreMiss += 1;
          }
        }
        if (
          cssMeta &&
          cssMeta.version === CSS_CAS_META_VERSION &&
          cssMeta.baseHash === baseHashFromPlan &&
          typeof cssMeta.pipelineHash === "string" &&
          cssMeta.pipelineHash.length > 0 &&
          cssDepProofIsCurrent(cssMeta) &&
          cssMetaAdmitsCurrentTailwindGraph(cssMeta, cssDemandGraphStamp)
        ) {
          const depsAbs = Array.from(
            new Set(
              [...(cssMeta.deps ?? []), ...(cssMeta.urlDeps ?? [])].filter(
                (p): p is string => typeof p === "string" && p.length > 0,
              ),
            ),
          );
          const depsStampHash = computeDepsContentStampHash(
            depsAbs,
            moduleMetaById,
            workspace.workspaceRoot,
          );
          artifactHashFromPlan = getCacheKey(
            `css:v3:${id}:${baseHashFromPlan}:${cssMeta.pipelineHash}:${depsStampHash}:${cssNeedsJsWrapper ? 1 : 0}:${metaTailwindStampForRecipe(cssMeta)}`,
          );
        }
      }

      if (artifactHashFromPlan) {
        for (const ref of refs) ref.hash = artifactHashFromPlan;
      }

      const casDir = artifactHashFromPlan
        ? getCasArtifactPath(casRoot, configHash, artifactHashFromPlan)
        : null;
      const casCssFile = casDir ? path.join(casDir, "transformed.css") : null;
      const casJsFile = casDir ? path.join(casDir, "transformed.js") : null;

      if (meta.kind === "css") {
        // Fast-path: derived (or base) CAS dir already has compiled CSS.
        if (casCssFile && fs.existsSync(casCssFile)) {
          try {
            const css = fs.readFileSync(casCssFile, "utf8");
            moduleOutputs.set(id, { code: css, type: "css" });
            casHits += 1;
            // For .module.css: synthesize the JS tokens wrapper if it is absent —
            // no PostCSS re-run needed, just render from stored tokens.json.
            if (cssNeedsJsWrapper && casJsFile && !fs.existsSync(casJsFile)) {
              const tokensFile = path.join(casDir!, "tokens.json");
              const storedTokens = readJsonFile<Record<string, string>>(tokensFile);
              if (storedTokens) {
                try {
                  fs.mkdirSync(casDir!, { recursive: true });
                  fs.writeFileSync(casJsFile, renderCssTokensModule(storedTokens), "utf8");
                } catch {
                  // ignore CAS write errors
                }
              }
            }
            continue;
          } catch {
            // Fall through to transform.
          }
        }
        // Promote-path: derived dir is empty but the base content-hash dir has dev-compiled
        // artifacts (written by `ionify dev`). Copy them into the derived dir so we avoid a
        // full PostCSS re-run. This restores Phase U dev→build CAS sharing for .module.css.
        if (baseHashFromPlan && casDir && casCssFile) {
          const baseCasDir = getCasArtifactPath(casRoot, configHash, baseHashFromPlan);
          if (baseCasDir !== casDir) {
            const baseCssArtifact = path.join(baseCasDir, "transformed.css");
            if (fs.existsSync(baseCssArtifact)) {
              try {
                const css = fs.readFileSync(baseCssArtifact, "utf8");
                fs.mkdirSync(casDir, { recursive: true });
                fs.writeFileSync(casCssFile, css, "utf8");
                moduleOutputs.set(id, { code: css, type: "css" });
                casHits += 1;
                if (cssNeedsJsWrapper && casJsFile) {
                  const baseTokFile = path.join(baseCasDir, "tokens.json");
                  const storedTokens = readJsonFile<Record<string, string>>(baseTokFile);
                  if (storedTokens) {
                    fs.writeFileSync(casJsFile, renderCssTokensModule(storedTokens), "utf8");
                    try {
                      fs.writeFileSync(path.join(casDir, "tokens.json"), JSON.stringify(storedTokens), "utf8");
                    } catch {}
                  }
                }
                continue;
              } catch {
                // Fall through to transform.
              }
            }
          }
        }
      } else {
        // ── G2-C3 authority dispatch: SOLELY on the plan-carried `proofKind` ──
        // The sealed plan is self-describing. Admission never infers authority
        // from fsPath / artifactTopology / flags / any side-channel. `proofKind`
        // identifies the REQUIRED authority-owned contract; materialization below
        // proves or rejects satisfaction of it.
        const proofKind = meta.proofKind;
        if (proofKind === "DplContentHash") {
          // DPL owns identity + integrity (artifactHash = content hash). Admit via
          // DPL's content-hash contract; consume the DPL dir (`meta.hash`) directly
          // (define is never applied to pre-built deps).
          if (baseHashFromPlan) {
            const dplDir = getCasArtifactPath(casRoot, configHash, baseHashFromPlan);
            const dplFile = path.join(dplDir, "transformed.js");
            for (const ref of refs) ref.hash = baseHashFromPlan;
            if (fs.existsSync(dplFile) && casTextFileMatchesHash(dplFile, baseHashFromPlan)) {
              casHits += 1;
              continue;
            }
            // DPL CAS missing/corrupt → re-materialize from the DPL source-of-truth
            // (`.ionify/deps`), fail-closed to DPL's content hash. Never a re-transform.
            if (fs.existsSync(meta.fsPath)) {
              const bytes = fs.readFileSync(meta.fsPath, "utf8");
              if (getCacheKey(bytes) === baseHashFromPlan) {
                fs.mkdirSync(dplDir, { recursive: true });
                fs.writeFileSync(dplFile, bytes, "utf8");
                casHits += 1;
                continue;
              }
            }
          }
          // DPL source-of-truth unavailable/corrupt: fall through to loud failure.
        } else if (proofKind === "TransformArtifactProof") {
          // Transform owns source+recipe→emitted bytes. Existence is not admission:
          // verify the Transform proof vs the current expected contract + bytes.
          // NonAdmissible falls through to narrow reconstruction below.
          const casFile = casDir ? path.join(casDir, "transformed.js") : null;
          if (
            casDir &&
            casFile &&
            baseHashFromPlan &&
            artifactHashFromPlan &&
            (casExistsMap.get(casFile) ?? fs.existsSync(casFile))
          ) {
            const admission = admitTransformArtifact(casDir, jsProofExpectation(baseHashFromPlan, artifactHashFromPlan));
            if (admission.admissible) {
              for (const ref of refs) (ref as any).admittedOutputHash = admission.proof.outputHash;
              casHits += 1;
              continue;
            }
          }
          // NonAdmissible → fall through to reconstruction (define-derive / transform).
        } else {
          // Invariant (G2-C3): a consumable JS module reaching admission with no
          // positive proofKind is unsealed / legacy / unclassified. Fail closed and
          // report the class — NEVER silently classify as Transform. The plan is
          // NonReusable; a full rebuild re-derives + stamps it (next run quiesces).
          throw new Error(
            `[G2-C3] Non-self-describing plan: JS consumable '${id}' ` +
              `(${meta.fsPath ?? "?"}) carries no proofKind. A sealed reusable plan ` +
              `must stamp exactly one authority-owned admission contract per ` +
              `consumable module; rebuild to re-stamp (NonReusable).`,
          );
        }
      }

      // Define variant miss: if the base (pre-define) transform exists in CAS, derive the define variant
      // without re-running the transform worker. G2-C2: admit the BASE proof first
      // so a corrupt base cannot silently produce a corrupt variant.
      if (meta.kind === "js" && baseHashFromPlan && defineHash) {
        const baseDir = getCasArtifactPath(casRoot, configHash, baseHashFromPlan);
        const baseFile = path.join(baseDir, "transformed.js");
        if (fs.existsSync(baseFile) && admitTransformArtifact(baseDir, jsBaseProofExpectation(baseHashFromPlan)).admissible) {
          try {
            const baseCode = fs.readFileSync(baseFile, "utf8");
            const artifactHash = getArtifactHash(baseHashFromPlan, "js");
            for (const ref of refs) ref.hash = artifactHash;
            defineJobs.push({ id, artifactHash, baseHash: baseHashFromPlan, baseCode });
            casHits += 1;
            continue;
          } catch {
            // Fall through to worker transform (base read failed).
          }
        }
      }

      // CAS miss: transform required.
      const filePath = meta.fsPath;
      if (!fs.existsSync(filePath)) {
        throw new Error(`Module missing on disk: ${filePath}`);
      }
      const code = fs.readFileSync(filePath, "utf8");
      const baseHash = baseHashFromPlan ?? getCacheKey(code);
      const artifactHash = meta.kind === "css" ? (artifactHashFromPlan ?? baseHash) : getArtifactHash(baseHash, meta.kind);
      if (meta.kind !== "css") {
        for (const ref of refs) ref.hash = artifactHash;
      }

      // If the base transform exists for this module (even if the planner didn't provide a hash),
      // derive the define variant without invoking the worker transform. G2-C2:
      // admit the BASE proof first (fail-closed to full transform otherwise).
      if (meta.kind === "js" && defineHash) {
        const baseDir = getCasArtifactPath(casRoot, configHash, baseHash);
        const baseFile = path.join(baseDir, "transformed.js");
        if (fs.existsSync(baseFile) && admitTransformArtifact(baseDir, jsBaseProofExpectation(baseHash)).admissible) {
          try {
            const baseCode = fs.readFileSync(baseFile, "utf8");
            defineJobs.push({ id, artifactHash, baseHash, baseCode });
            casHits += 1;
            continue;
          } catch {
            // Fall through to worker transform.
          }
        }
      }
      jobs.push({
        id,
        filePath,
        ext: path.extname(filePath),
        code,
        kind: meta.kind,
        baseHash,
        artifactHash,
        cssNeedsJsWrapper: meta.kind === "css" ? cssNeedsJsWrapper : undefined,
      });
    }
    logBuildProfile("casHydration", hydrationStart);

    const transformsNeeded = jobs.length;
    const percentHits = modulesInPlan > 0 ? Math.round((casHits * 100) / modulesInPlan) : 100;
    const cssJobs = jobs.filter((job) => job.kind === "css");
    const cssModulesOptionsForWorker = cloneWorkerSafeCssOptions((config as any)?.css?.modules);
    const cssPreprocessorOptionsForWorker = cloneWorkerSafeCssOptions((config as any)?.css?.preprocessorOptions);
    const configuredCssWorkers = Number(process.env.IONIFY_CSS_WORKERS || "");
    const cssWorkerCount = Number.isFinite(configuredCssWorkers) && configuredCssWorkers > 0
      ? Math.max(1, Math.min(cssJobs.length || 1, Math.floor(configuredCssWorkers)))
      : cssJobs.length <= 3
        ? 1
        : Math.max(1, Math.min(cssJobs.length, Math.max(1, Math.floor(os.cpus().length / 2))));
    const cssResultsPromise: Promise<TransformJobResult[]> | null = cssJobs.length > 0
      ? (async () => {
        const cssStart = Date.now();
        const cssPool = new TransformWorkerPool({
          size: cssWorkerCount,
        });
        try {
          const cssResults = await cssPool.runMany(
            cssJobs.map((job) => ({
              id: job.id,
              filePath: job.filePath,
              ext: job.ext,
              code: job.code,
              rootDir,
              cssModules: job.cssNeedsJsWrapper === true,
              cssModulesOptions: cssModulesOptionsForWorker,
              cssPreprocessorOptions: cssPreprocessorOptionsForWorker,
              // Content override input for CSSA Tailwind graph narrowing.
              cssDemandGraphFiles: cssDemandRegisteredFiles,
              // Freshness/identity proof for that content set (main-process computed).
              cssDemandGraphStamp,
            })),
          );
          transformCasProfile.cssCompileWallMs += Date.now() - cssStart;
          transformCasProfile.cssWorkerJobs += cssJobs.length;
          for (const result of cssResults as Array<TransformJobResult & { cssProfile?: any }>) {
            const deps = Array.isArray(result.deps)
              ? result.deps.filter((p): p is string => typeof p === "string" && p.length > 0)
              : [];
            const urlDeps = Array.isArray(result.urlDeps)
              ? result.urlDeps.filter((p): p is string => typeof p === "string" && p.length > 0)
              : [];
            const pipelineHash =
              typeof result.pipelineHash === "string" && result.pipelineHash.length > 0
                ? result.pipelineHash
                : "0";
            const demandStart = Date.now();
            result.cssDemand = buildCssDemandAnalysis({
              rootDir,
              cssFile: result.filePath,
              cssHash: getCacheKey(cssJobs.find((job) => job.id === result.id)?.code ?? ""),
              pipelineHash,
              deps: Array.from(new Set([...deps, ...urlDeps])),
            });
            if (result.cssProfile && typeof result.cssProfile === "object") {
              result.cssProfile.cssDemandProofMs =
                Number(result.cssProfile.cssDemandProofMs ?? 0) + (Date.now() - demandStart);
            }
            addCssCompileProfile(transformCasProfile, result.cssProfile);
          }
          return cssResults;
        } catch (err) {
          transformCasProfile.cssCompileWallMs += Date.now() - cssStart;
          throw err;
        } finally {
          await cssPool.close();
        }
      })()
      : null;

    // Derive define variants from base transforms already present in CAS.
    const defineStart = Date.now();
    for (const job of defineJobs) {
      const cacheDir = getCasArtifactPath(casRoot, configHash, job.artifactHash);
      try {
        // G2-C2: write the derived variant + its Transform proof atomically, and
        // pin the admitted output hash so native re-verifies the exact bytes.
        // The derived variant carries no source map (authoritative absence).
        const proof = writeTransformArtifact({
          dir: cacheDir,
          bytes: applyDefineReplacements(job.baseCode, defineConfig),
          map: null,
          identity: {
            sourceHash: job.baseHash,
            recipeConfigHash: configHash,
            defineHash,
            artifactKind: "js",
            variant: "define",
          },
        });
        for (const ref of moduleRefsById.get(job.id) ?? []) (ref as any).admittedOutputHash = proof.outputHash;
      } catch {
        // ignore CAS write errors
      }
    }
    if (defineJobs.length > 0) {
      logBuildProfile("defineVariantDerive", defineStart);
    }

    if (jobs.length > 0) {
      const transformStart = Date.now();
      const transformResultsById = new Map<string, TransformJobResult>();
      const nativeHandledIds = new Set<string>();
      const jobById = new Map(jobs.map((job) => [job.id, job]));
      const jsJobs = jobs.filter((job) => job.kind === "js");
      const nativeTransformBatch = native?.nativeTransformBatch;

      const reusableMutationByPath = new Map(
        // F3-A: reuse the canonical producer's bytes whenever THIS build's
        // mutation proof produced them (`.ok`), not only on the source-only fast
        // path. A topology/demand change requires Graph + DPL re-admission but
        // does NOT invalidate Transform bytes already produced for the same
        // current source and within-build recipe context. Tier-1 stays a
        // materializer; the sourceHash guard + error check below keep it
        // fail-closed to `nativeTransformBatch`.
        (sourceOnlyMutationProof.ok ? sourceOnlyMutationProof.runtimeMutations : []).flatMap((mutation) => {
          const filePath = mutation.filePath ?? mutation.file_path;
          const sourceHash = mutation.sourceHash ?? mutation.source_hash;
          if (!filePath || !sourceHash || mutation.error || typeof mutation.code !== "string") return [];
          return [[canonicalFsPath(filePath), { ...mutation, sourceHash }] as const];
        }),
      );
      for (const job of jsJobs) {
        const reusable = reusableMutationByPath.get(canonicalFsPath(job.filePath));
        if (!reusable || reusable.sourceHash !== getCacheKey(job.code)) continue;
        nativeHandledIds.add(job.id);
        transformResultsById.set(job.id, {
          id: job.id,
          filePath: reusable.filePath ?? reusable.file_path ?? job.filePath,
          code: reusable.code,
          map: reusable.map ?? undefined,
          type: "js",
        });
        transformCasProfile.nativeJsTransformReuseJobs += 1;
      }

      const nativeTransformJobs = jsJobs.filter((job) => !nativeHandledIds.has(job.id));
      if (typeof nativeTransformBatch === "function" && nativeTransformJobs.length > 0) {
        try {
          const nativeResults = profileElapsed(transformCasProfile, "nativeJsTransformMs", () =>
            nativeTransformBatch(
              nativeTransformJobs.map((job) => ({
                id: job.id,
                filePath: job.filePath,
                ext: job.ext,
                code: job.code,
              })),
              parserMode,
            ),
          );
          transformCasProfile.nativeJsTransformJobs += nativeTransformJobs.length;

          for (const result of nativeResults) {
            const job = jobById.get(result.id);
            if (!job) continue;
            nativeHandledIds.add(result.id);
            transformResultsById.set(result.id, {
              id: result.id,
              filePath: result.filePath ?? result.file_path ?? job.filePath,
              code: result.code,
              map: result.map ?? undefined,
              type: (result.type ?? result.kind ?? "js") as TransformJobResult["type"],
              error: result.error ?? undefined,
            });
          }

          if (nativeHandledIds.size > 0) {
            logInfo(`[Build] Native transform batch handled ${nativeHandledIds.size} JS module(s)`);
          }
        } catch (err) {
          logWarn(
            `[Build] Native transform batch unavailable; falling back to worker transforms (${
              err instanceof Error ? err.message : String(err)
            })`,
          );
        }
      }

      if (cssResultsPromise) {
        const cssResults = await cssResultsPromise;
        for (const result of cssResults) {
          transformResultsById.set(result.id, result);
        }
      }

      const workerJobs = jobs.filter((job) => job.kind !== "css" && (job.kind !== "js" || !nativeHandledIds.has(job.id)));
      if (workerJobs.length > 0) {
        const pool = new TransformWorkerPool();
        try {
          const workerStart = Date.now();
          const results = await pool.runMany(
            workerJobs.map((job) => ({
              id: job.id,
              filePath: job.filePath,
              ext: job.ext,
              code: job.code,
            })),
          );
          transformCasProfile.workerTransformMs += Date.now() - workerStart;
          transformCasProfile.workerTransformJobs += workerJobs.length;
          for (const result of results) {
            transformResultsById.set(result.id, result);
          }
        } finally {
          await pool.close();
        }
      }

      for (const job of jobs) {
        const result = transformResultsById.get(job.id);
        if (!result) {
          throw new Error(`Transform failed for ${job.filePath}: no transform result returned`);
        }
        if (result.error) {
          throw new Error(`Transform failed for ${result.filePath}: ${result.error}`);
        }

        const isJs = (result.type ?? "js") === "js";
        if (isJs) {
          // G2-C2: write base + define-variant artifacts each with their own
          // Transform proof (atomic, marker-last), and pin the consumed variant's
          // output hash onto the plan refs for native re-verification.
          const baseProof = writeTransformArtifact({
            dir: getCasArtifactPath(casRoot, configHash, job.baseHash),
            bytes: result.code,
            map: result.map ?? null,
            identity: {
              sourceHash: job.baseHash,
              recipeConfigHash: configHash,
              defineHash: "",
              artifactKind: "js",
              variant: "base",
            },
          });
          const finalCode = profileElapsed(transformCasProfile, "defineReplacementMs", () =>
            applyDefineReplacements(result.code, defineConfig),
          );
          transformCasProfile.defineReplacementCalls += 1;
          let consumedOutputHash = baseProof.outputHash;
          if (job.artifactHash !== job.baseHash) {
            const variantProof = writeTransformArtifact({
              dir: getCasArtifactPath(casRoot, configHash, job.artifactHash),
              bytes: finalCode,
              map: result.map && finalCode === result.code ? result.map : null,
              identity: {
                sourceHash: job.baseHash,
                recipeConfigHash: configHash,
                defineHash,
                artifactKind: "js",
                variant: "define",
              },
            });
            consumedOutputHash = variantProof.outputHash;
          }
          for (const ref of moduleRefsById.get(job.id) ?? []) (ref as any).admittedOutputHash = consumedOutputHash;
        } else {
          const deps = Array.isArray(result.deps)
            ? result.deps.filter((p): p is string => typeof p === "string" && p.length > 0)
            : [];
          const urlDeps = Array.isArray(result.urlDeps)
            ? result.urlDeps.filter((p): p is string => typeof p === "string" && p.length > 0)
            : [];
          const pipelineHash =
            typeof result.pipelineHash === "string" && result.pipelineHash.length > 0
              ? result.pipelineHash
              : "0";
          const cssDemand = result.cssDemand as any;
          const cssDemandProfile = cssDemand?.profile;
          if (cssDemandProfile && typeof cssDemandProfile === "object") {
            transformCasProfile.cssDemandExtractionMs += Number(cssDemandProfile.extractionMs ?? 0);
            transformCasProfile.cssDemandFilesScanned += Number(cssDemandProfile.filesScanned ?? 0);
            transformCasProfile.cssDemandCacheHit += Number(cssDemandProfile.cacheHits ?? 0);
            transformCasProfile.cssDemandCacheMiss += Number(cssDemandProfile.cacheMisses ?? 0);
            transformCasProfile.cssDemandTokens += Number(cssDemandProfile.tokens ?? 0);
            transformCasProfile.cssDemandProofWriteMs += Number(cssDemandProfile.proofWriteMs ?? 0);
          }
          const tailwindGraphContent = result.tailwindGraphContent as any;
          if (tailwindGraphContent && typeof tailwindGraphContent === "object") {
            transformCasProfile.cssTailwindGraphContentMs += Number(tailwindGraphContent.ms ?? 0);
            transformCasProfile.cssTailwindGraphContentFiles += Number(tailwindGraphContent.files ?? 0);
            transformCasProfile.cssTailwindGraphContentPlugins += Number(tailwindGraphContent.plugins ?? 0);
            if (tailwindGraphContent.enabled === true) transformCasProfile.cssTailwindGraphContentOptimized += 1;
            if (tailwindGraphContent.fallbackReason) transformCasProfile.cssTailwindGraphContentFallbacks += 1;
          }

          const depsAbs = profileElapsed(transformCasProfile, "artifactHashBookkeepingMs", () =>
            Array.from(new Set([...deps, ...urlDeps].map((p) => path.resolve(p)))),
          );
          transformCasProfile.artifactHashBookkeepingCalls += 1;
          profileElapsed(transformCasProfile, "artifactHashBookkeepingMs", () =>
            recordStructuralGraphFiles(depsAbs, workspace.workspaceRoot, configHash),
          );
          transformCasProfile.artifactHashBookkeepingCalls += 1;
          const depsStampHash = profileElapsed(transformCasProfile, "artifactHashBookkeepingMs", () =>
            computeDepsContentStampHash(
              depsAbs,
              moduleMetaById,
              workspace.workspaceRoot,
            ),
          );
          transformCasProfile.artifactHashBookkeepingCalls += 1;

          const cssNeedsJsWrapper = job.cssNeedsJsWrapper === true;
          const artifactHash = profileElapsed(transformCasProfile, "artifactHashBookkeepingMs", () =>
            getCacheKey(
              `css:v3:${job.id}:${job.baseHash}:${pipelineHash}:${depsStampHash}:${cssNeedsJsWrapper ? 1 : 0}:${metaTailwindStampForRecipe({ tailwindGraphContent })}`,
            ),
          );
          transformCasProfile.artifactHashBookkeepingCalls += 1;
          const artifactBytesHash = profileElapsed(transformCasProfile, "artifactHashBookkeepingMs", () =>
            getCacheKey(result.code),
          );
          transformCasProfile.artifactHashBookkeepingCalls += 1;
          cssDerivedArtifactHashById.set(job.id, artifactHash);

          // Persist meta under the base hash (content-identity) for future artifact hash derivation.
          const baseDir = profileElapsed(transformCasProfile, "artifactHashBookkeepingMs", () =>
            getCasArtifactPath(casRoot, configHash, job.baseHash),
          );
          transformCasProfile.artifactHashBookkeepingCalls += 1;
          profileCasMkdir(transformCasProfile, baseDir);
          const meta: CssCasMeta = {
            version: CSS_CAS_META_VERSION,
            baseHash: job.baseHash,
            artifactHash,
            artifactBytesHash,
            pipelineHash,
            depsStampHash,
            deps: depsAbs.sort(),
            urlDeps: Array.from(new Set(urlDeps.map((p) => path.resolve(p)))).sort(),
            depsProof: buildCssCasDepProof(depsAbs, moduleMetaById, workspace.workspaceRoot),
            modules: cssNeedsJsWrapper,
            generatedAt: new Date().toISOString(),
            cssDemand: cssDemand?.proof
              ? {
                  proofVersion: Number(cssDemand.proof.proofVersion ?? 0),
                  extractorVersion: Number(cssDemand.proof.extractorVersion ?? 0),
                  classDemandHash: String(cssDemand.proof.classDemandHash ?? ""),
                  dependencyHash: String(cssDemand.proof.dependencyHash ?? ""),
                  tokenCount: Number(cssDemand.proof.tokenCount ?? 0),
                  sourceFileCount: Array.isArray(cssDemand.proof.sourceFiles) ? cssDemand.proof.sourceFiles.length : 0,
                  uncertain: Boolean(cssDemand.proof.uncertain),
                  uncertaintyReasons: Array.isArray(cssDemand.proof.uncertaintyReasons)
                    ? cssDemand.proof.uncertaintyReasons.map((reason: unknown) => String(reason)).sort()
                    : [],
                }
              : null,
            tailwindGraphContent: tailwindGraphContent
              ? {
                  enabled: tailwindGraphContent.enabled === true,
                  files: Number(tailwindGraphContent.files ?? 0),
                  plugins: Number(tailwindGraphContent.plugins ?? 0),
                  configPath: typeof tailwindGraphContent.configPath === "string" ? tailwindGraphContent.configPath : null,
                  fallbackReason:
                    typeof tailwindGraphContent.fallbackReason === "string"
                      ? tailwindGraphContent.fallbackReason
                      : null,
                  stamp:
                    typeof tailwindGraphContent.stamp === "string" && tailwindGraphContent.stamp.length > 0
                      ? tailwindGraphContent.stamp
                      : null,
                }
              : null,
          };
          profileJsonCasWrite(transformCasProfile, path.join(baseDir, "meta.json"), meta, "base");

          const artifactDir = profileElapsed(transformCasProfile, "artifactHashBookkeepingMs", () =>
            getCasArtifactPath(casRoot, configHash, artifactHash),
          );
          transformCasProfile.artifactHashBookkeepingCalls += 1;
          profileCasMkdir(transformCasProfile, artifactDir);
          profileCasWrite(transformCasProfile, path.join(artifactDir, "transformed.css"), result.code, "variant");

          // CSS Modules build parity: provide a JS module exporting tokens for `.module.css`.
          if (cssNeedsJsWrapper) {
            const tokens =
              result.tokens && typeof result.tokens === "object"
                ? (result.tokens as Record<string, string>)
                : {};
            const js = renderCssTokensModule(tokens);
            profileCasWrite(transformCasProfile, path.join(artifactDir, "transformed.js"), js, "variant");
            // Persist tokens for fast JS-wrapper synthesis on subsequent builds (tokens.json
            // allows the CAS hydration pass to skip PostCSS entirely for .module.css hits).
            profileJsonCasWrite(transformCasProfile, path.join(artifactDir, "tokens.json"), tokens, "variant");
          }
          const globalWriteStart = Date.now();
          const globalFiles = writeCssArtifactToGlobalCache(
            configHash,
            job.baseHash,
            artifactHash,
            casRoot,
            cssNeedsJsWrapper,
          );
          transformCasProfile.cssGlobalCacheWriteMs += Date.now() - globalWriteStart;
          transformCasProfile.cssGlobalCacheWriteFiles += globalFiles;

          // Ensure plan modules use the derived CSS artifact hash so native bundler can hydrate JS wrappers.
          const refs = moduleRefsById.get(job.id) ?? [];
          for (const ref of refs) ref.hash = artifactHash;
          job.artifactHash = artifactHash;
        }
        
        const finalCode = isJs
          ? profileElapsed(transformCasProfile, "defineReplacementMs", () =>
              applyDefineReplacements(result.code, defineConfig),
            )
          : result.code;
        if (isJs) transformCasProfile.defineReplacementCalls += 1;
        moduleOutputs.set(job.id, { code: finalCode, type: result.type });
      }
      logBuildProfile("transformsAndCasWrites", transformStart);
      logTransformCasProfile(transformCasProfile);
    } // end if (jobs.length > 0)
    if (
      jobs.length === 0 &&
      (transformCasProfile.cssGlobalCacheRestoreHit > 0 ||
        transformCasProfile.cssGlobalCacheRestoreMiss > 0 ||
        transformCasProfile.cssGlobalCacheRestoreMs > 0)
    ) {
      logTransformCasProfile(transformCasProfile);
    }

    // Ensure native bundler plan hashes are aligned with derived CSS artifact hashes so
    // `transformed.js` wrappers (CSS Modules) can be hydrated from CAS deterministically.
    if (cssDerivedArtifactHashById.size) {
      for (const chunk of plan.chunks) {
        for (const mod of chunk.modules) {
          const derived = cssDerivedArtifactHashById.get(mod.id);
          if (derived) mod.hash = derived;
        }
      }
    }
    const debugCss = process.env.IONIFY_DEBUG === "1" || process.env.IONIFY_DEBUG === "true";
    if (debugCss && cssDerivedArtifactHashById.size) {
      const sample = Array.from(cssDerivedArtifactHashById.entries())
        .slice(0, 5)
        .map(([id, hash]) => `${id}:${hash.slice(0, 8)}`)
        .join(", ");
      logInfo(`[Build][css] derived artifacts: ${sample}`);
      const missing = plan.chunks
        .flatMap((c) => c.modules)
        .filter((m) => m.kind === "css" && isCssModuleFile(m.fsPath ?? ""))
        .filter((m) => !m.hash || typeof m.hash !== "string" || m.hash.length === 0);
      if (missing.length) {
        logWarn(`[Build][css] WARN: missing hashes for ${missing.length} CSS module(s)`);
      }
    }

    // Frozen-PDC invariant: production links DPL dependency artifacts directly.
    // No raw node_modules bridge, virtual re-export shims, or PDC-owned cache
    // identity are introduced here.

    const emitPreparationStart = Date.now();
    const buildMinifyRaw = (config as any)?.build?.minify;
    const buildMinifyEnabled = buildMinifyRaw === false ? false : true;
    const minifyEnabled = optLevel !== null ? optLevel !== 0 : buildMinifyEnabled;
    const mangleEnabled = minifyEnabled;
    const nativeExternalModules = collectNativeExternalModules(plan, buildExternalSpecifiers);

    const federationExposeEntryIds = collectFederationExposeEntryPaths(config, rootDir)
      .map((entry) => toWsModuleId(entry, workspace.workspaceRoot))
      .filter((entryId): entryId is string => typeof entryId === "string" && entryId.length > 0);

    const hostEntryIds = (entries ?? [])
      .map((entry) => toWsModuleId(entry, workspace.workspaceRoot))
      .filter((entryId): entryId is string => typeof entryId === "string" && entryId.length > 0);

    const incrementalChunkIdSet =
      skipDepsAuthorityForSourceOnlyEdit &&
      sourceMutationOutputBase &&
      sourceMutationPlannerChunkIds &&
      !config?.federation
        ? new Set(sourceMutationPlannerChunkIds)
        : null;
    if (incrementalChunkIdSet && cssJobs.length > 0) {
      const changedCssIds = new Set(cssJobs.map((job) => job.id));
      for (const chunk of plan.chunks) {
        if (chunk.css.some((cssId) => changedCssIds.has(cssId))) {
          incrementalChunkIdSet.add(chunk.id);
        }
      }
    }
    const incrementalChunkIds = incrementalChunkIdSet
      ? Array.from(incrementalChunkIdSet).sort()
      : null;
    const changedCssModuleIds = new Set(
      incrementalHydrationModuleIds
        ? Array.from(incrementalHydrationModuleIds).filter(
            (moduleId) => moduleMetaById.get(moduleId)?.kind === "css",
          )
        : [],
    );
    const verifiedResourceStableChunkIds =
      incrementalChunkIdSet && sourceMutationOutputBase
        ? plan.chunks
            .filter(
              (chunk) =>
                incrementalChunkIdSet.has(chunk.id) &&
                chunk.css.every((cssId) => !changedCssModuleIds.has(cssId)),
            )
            .map((chunk) => chunk.id)
            .sort()
        : [];
    logBuildProfileText(
      "incrementalChunkPublication",
      incrementalChunkIds
        ? `admitted:${incrementalChunkIds.length},resources-stable:${verifiedResourceStableChunkIds.length}`
        : "full-emission",
    );
    logBuildProfile("emitPreparation", emitPreparationStart);

    const emitStart = Date.now();
    // Only PRA may admit reuse of an existing dist publication. Tier-4 remains
    // the fallback authority for unchanged chunks when no deploy-ready proof
    // exists; the routing manifest never re-derives plan identity.
    logBuildProfileDuration("distReuseProbe", 0);

    let emittedPlan = plan;
    logInfo(`[Build] Emitting chunks via native bundler`);
    const { artifacts: baseArtifacts, stats: baseStats } = await emitChunks(absOutDir, plan, moduleOutputs, {
      casRoot,
      versionHash: configHash,
      nativePublicationContext:
        incrementalChunkIds && sourceMutationPublicationContext
          ? sourceMutationPublicationContext
          : undefined,
      nativeOptions: {
        minifier,
        minify: minifyEnabled,
        mangle: mangleEnabled,
        treeshake,
        scopeHoist,
        externalModules: nativeExternalModules,
        federationExposeEntries: federationExposeEntryIds,
        incrementalChunkIds: incrementalChunkIds ?? undefined,
        incrementalOnly: incrementalChunkIds ? true : undefined,
      },
      incrementalBase:
        incrementalChunkIds && sourceMutationOutputBase
          ? {
              ...sourceMutationOutputBase,
              verifiedResourceStableChunkIds,
            }
          : undefined,
    });
    let artifacts: Array<{ id: string; files: ReusedChunkFiles }> = baseArtifacts;
    let combinedStats: Record<string, any> = { ...baseStats };
    logBuildProfile("emitChunksAndFiles", emitStart);

    let federationManifest = buildFederationBuildManifest({
      config,
      rootDir,
      workspaceRoot: workspace.workspaceRoot,
      outDir: absOutDir,
      plan: emittedPlan,
      artifacts,
      hostEntryIds,
    });
    if (federationManifest?.container?.entry) {
      const containerSpec = buildFederationContainerBuildSpec(federationManifest, absOutDir);
      if (containerSpec) {
        const containerPlan: BuildPlan = {
          entries: [containerSpec.moduleId],
          chunks: [
            {
              id: containerSpec.chunkId,
              entry: true,
              shared: false,
              consumers: [containerSpec.moduleId],
              css: [],
              assets: [],
              modules: [
                {
                  id: containerSpec.moduleId,
                  fsPath: containerSpec.moduleId,
                  hash: containerSpec.contractHash,
                  kind: "js",
                  deps: [],
                  dynamicDeps: [],
                },
              ],
            },
          ],
        };

        const { artifacts: containerArtifacts, stats: containerStats } = await emitChunks(
          absOutDir,
          containerPlan,
          new Map([[containerSpec.moduleId, { code: containerSpec.source, type: "js" }]]),
          {
            casRoot,
            versionHash: configHash,
            nativeOptions: {
              minifier,
              minify: minifyEnabled,
              mangle: mangleEnabled,
              treeshake,
              scopeHoist,
              virtualModuleIds: [containerSpec.moduleId],
              virtualModuleSources: [containerSpec.source],
            },
          },
        );
        emittedPlan = {
          entries: plan.entries.slice(),
          chunks: [...plan.chunks, ...containerPlan.chunks],
        };
        artifacts = [...artifacts, ...containerArtifacts];
        combinedStats = { ...combinedStats, ...containerStats };
        federationManifest = buildFederationBuildManifest({
          config,
          rootDir,
          workspaceRoot: workspace.workspaceRoot,
          outDir: absOutDir,
          plan: emittedPlan,
          artifacts,
          hostEntryIds,
        });
      }
    }
    if (config?.federation && federationGraph) {
      syncFederationGraphNodes(
        federationGraph,
        mergeFederationGraphNodes(
          buildFederationConfigGraphNodes(config, rootDir),
          buildFederationManifestGraphNodes(federationManifest),
        ),
      );
      federationGraph.flush();
    }
    const manifestStart = Date.now();
    const outputHashHints = collectOutputHashHints(combinedStats);
    const buildManifestStart = Date.now();
    const reusableRoutingManifest =
      incrementalChunkIds &&
      sourceMutationOutputBase &&
      !federationManifest
        ? sourceMutationOutputBase.routingManifest
        : null;
    const buildManifestInfo =
      reusableRoutingManifest ??
      await writeBuildManifest(absOutDir, emittedPlan, artifacts, {
        federation: federationManifest,
      });
    logBuildProfile("writeBuildManifest", buildManifestStart);
    recordOutputHashHint(
      outputHashHints,
      buildManifestInfo,
    );
    const assetsManifestStart = Date.now();
    const assetsManifestInfo = await writeAssetsManifest(absOutDir, artifacts);
    logBuildProfile("writeAssetsManifest", assetsManifestStart);
    recordOutputHashHint(outputHashHints, assetsManifestInfo);

    // Emit index.html for SPA deployments (Phase 6.6+: manifest-driven output)
    const indexHtmlStart = Date.now();
    const indexHtmlInfo = await emitIndexHtml({
      rootDir,
      outDir: absOutDir,
      entries: entries ?? [],
      hostEntryIds,
      plan: emittedPlan,
      artifacts,
      envValues,
      envPrefix,
    });
    logBuildProfile("emitIndexHtml", indexHtmlStart);
    recordOutputHashHint(outputHashHints, indexHtmlInfo);

    // Copy publicDir assets BEFORE writing build.stats.json so they are included in the
    // publicAssets section and eligible for precompressBuildOutputs via outputHashHints.
    const previousPublicAssetSource = Array.isArray(combinedStats.publicAssets)
      ? combinedStats.publicAssets
      : productionReadinessRecord?.proofs.publicAssets.assets;
    const previousPublicAssets = Array.isArray(previousPublicAssetSource)
      ? previousPublicAssetSource.filter(
          (asset: any): asset is CopiedAssetEntry =>
            asset &&
            typeof asset === "object" &&
            typeof asset.file === "string" &&
            typeof asset.bytes === "number" &&
            typeof asset.hash === "string",
        )
      : [];
    const publicCopyStart = Date.now();
    const publicCopy = await copyPublicDirToOutDir(publicDirAbs, absOutDir, previousPublicAssets);
    logBuildProfile("publicAssetReadiness", publicCopyStart);
    if (publicCopy.assets.length > 0) {
      combinedStats.publicAssets = publicCopy.assets;
      for (const asset of publicCopy.assets) {
        outputHashHints.set(asset.file, asset.hash);
      }
    }

    const statsWriteStart = Date.now();
    const statsJson = JSON.stringify(combinedStats, null, 2);
    await writeTextFileIfChanged(path.join(absOutDir, "build.stats.json"), statsJson);
    const buildStatsHash = getCacheKey(statsJson);
    outputHashHints.set("build.stats.json", buildStatsHash);
    logBuildProfile("writeBuildStats", statsWriteStart);
    logBuildProfile("manifestAssetsStats", manifestStart);

    const coreBuildElapsed = Date.now() - buildStart;
    logInfo(`Build plan generated → ${path.join(absOutDir, "manifest.json")}`);
    logInfo(`Entries: ${plan.entries.length}, Chunks: ${plan.chunks.length}`);
    logInfo(`Modules in plan: ${modulesInPlan}`);
    logInfo(`CAS hits: ${casHits} (${percentHits}%) • transforms needed: ${transformsNeeded}`);
    logInfo(`Build complete in ${coreBuildElapsed}ms`);
    logInfo(`[Build] Time-to-deploy-ready: ${coreBuildElapsed}ms`);
    logBuildProfileDuration("timeToDeployReady", coreBuildElapsed);

    const compression = await runPostBuildCompression({
      config,
      absOutDir,
      casRoot,
      outputHashHints,
      buildStart,
    });
    if (publishedPlan === null || !sourceFreshnessCurrent) {
      try {
        writeProductionBuildPlanProof(
          ionifyDir,
          productionPublicationIdentity,
          readinessPlanForIdentity ?? plan,
          { plan: Date.now() - planStart },
        );
      } catch (err) {
        logWarn(`[Planner] Skipped production plan proof emit: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const praEmitStart = Date.now();
    try {
      const readinessRecord = createProductionReadinessRecord({
        configHash,
        workspaceRoot: workspace.workspaceRoot,
        projectRoot: rootDir,
        depsHash,
        plan: readinessPlanForIdentity ?? emittedPlan,
        artifacts,
        dist: {
          manifestHash:
            buildManifestInfo?.hash ?? hashFileIfExists(path.join(absOutDir, "manifest.json")) ?? "",
          buildStatsHash,
          assetsManifestHash:
            assetsManifestInfo?.hash ?? hashFileIfExists(path.join(absOutDir, "manifest.assets.json")),
          indexHtmlHash:
            indexHtmlInfo?.hash ?? hashFileIfExists(path.join(absOutDir, "index.html")),
        },
        compression: {
          state: compression.state,
          manifestHash: compression.manifestHash,
        },
        publicAssets: {
          assets: publicCopy.assets,
          conflicts: publicCopy.conflicts,
        },
        depsOptimizerOutputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      });
      writeProductionReadinessRecord(ionifyDir, readinessRecord);
    } catch (err) {
      logWarn(`[PRA] Skipped deploy-ready.v1 emit: ${err instanceof Error ? err.message : String(err)}`);
    }
    logBuildProfile("praEmit", praEmitStart);
    const slimmingSaved = computeBuildSlimmingSavedPercent(depsRoot, depsHash);
    const vendorPacksSaved = computeBuildVendorPackRequestsSavedPercent(depsRoot, depsHash);
    logInfo(`Slimming saved: ${typeof slimmingSaved === "number" ? `${slimmingSaved}%` : "0%"}`);
    logInfo(`Vendor packs saved: ${typeof vendorPacksSaved === "number" ? `${vendorPacksSaved}%` : "0%"} requests`);
  } catch (err) {
    logError("ionify build failed", err);
    throw err;
  }
}

async function runPostBuildCompression(options: {
  config: any;
  absOutDir: string;
  casRoot: string;
  outputHashHints: Map<string, string>;
  buildStart: number;
}): Promise<{ state: ProductionReadinessCompressionState; manifestHash: string | null }> {
  const precompressRaw = (options.config as any)?.build?.precompress;
  const precompressEnabled = precompressRaw !== false;
  let compressionState: ProductionReadinessCompressionState = precompressEnabled ? "missing" : "skipped";
  let compressionManifestHash: string | null = null;
  const precompressConfig =
    precompressRaw && typeof precompressRaw === "object" && !Array.isArray(precompressRaw)
      ? (precompressRaw as Record<string, unknown>)
      : null;

  if (!precompressEnabled) {
    return { state: compressionState, manifestHash: compressionManifestHash };
  }

  const thresholdRaw = precompressConfig?.thresholdBytes;
  const thresholdBytes =
    typeof thresholdRaw === "number" && Number.isFinite(thresholdRaw)
      ? Math.max(0, Math.floor(thresholdRaw))
      : 1024;
  const gzipLevelRaw = precompressConfig?.gzipLevel;
  const gzipLevel =
    typeof gzipLevelRaw === "number" && Number.isFinite(gzipLevelRaw)
      ? Math.max(0, Math.min(9, Math.floor(gzipLevelRaw)))
      : 9;
  const brotliQualityRaw = precompressConfig?.brotliQuality;
  const brotliQuality =
    typeof brotliQualityRaw === "number" && Number.isFinite(brotliQualityRaw)
      ? Math.max(0, Math.min(11, Math.floor(brotliQualityRaw)))
      : 11;
  const concurrency = resolvePrecompressConcurrency(precompressConfig?.concurrency);
  const emitManifest = precompressConfig?.manifest === false ? false : true;

  // Compression owns every eligible text output uniformly. The Rust backend
  // accepts bytes rather than JavaScript syntax, so restricting it to chunk JS
  // would leave manifests/CSS/HTML on a second, slower codec path.
  type NativeCompressorFn = NonNullable<Parameters<typeof precompressBuildOutputs>[1]["nativeCompressor"]>;
  const nativeCompressBatchFn = native?.compressBatch?.bind(native);
  const nativeCompressor: NativeCompressorFn | undefined = nativeCompressBatchFn
    ? (items) =>
        nativeCompressBatchFn(
          items.map((it) => ({
            id: it.id,
            bytes: it.bytes as unknown as import("buffer").Buffer,
            brotliQuality: it.brotliQuality,
            gzipLevel: it.gzipLevel,
          })),
        ) as Array<{ id: string; br?: Buffer | null; gz?: Buffer | null }>
    : undefined;

  const compressStart = Date.now();
  const report = await precompressBuildOutputs(options.absOutDir, {
    casRoot: options.casRoot,
    thresholdBytes,
    gzipLevel,
    brotliQuality,
    emitManifest,
    concurrency,
    outputHashHints: options.outputHashHints,
    nativeCompressor,
  });
  if (emitManifest) {
    compressionManifestHash = hashFileIfExists(path.join(options.absOutDir, "manifest.compression.json"));
    compressionState = compressionManifestHash ? "verified" : "missing";
  }
  const elapsed = Date.now() - compressStart;
  const backendNote = native?.compressBatch ? " [text=rust]" : "";
  logInfo(
    `[Build][compress]${backendNote} ${report.totals.filesWithSidecars}/${report.totals.filesEligible} files precompressed in ${elapsed}ms (parallel=${report.concurrency}, current=${report.totals.filesAlreadyCurrent}, touched=${report.totals.filesTouched}, cas ${report.totals.casHits} hit/${report.totals.casMisses} miss, copied=${report.totals.sidecarsCopiedFromCas}, compressed=${report.totals.sidecarsCompressed}, br ${formatByteDelta(
      report.totals.brotliOriginalBytes,
    )}→${formatByteDelta(report.totals.brotliBytes)}, gzip ${formatByteDelta(
      report.totals.gzipOriginalBytes,
    )}→${formatByteDelta(report.totals.gzipBytes)})`,
  );
  logInfo(`Build total in ${Date.now() - options.buildStart}ms`);

  return { state: compressionState, manifestHash: compressionManifestHash };
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
  if (has("react") || has("react-dom")) {
    return [
      "react",
      "react-dom",
      "react-dom/client",
      "scheduler",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
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

const OPTIMIZABLE_DEP_ENTRY_EXTS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".json",
]);

function isOptimizableDepEntryPath(entryPath: string): boolean {
  return OPTIMIZABLE_DEP_ENTRY_EXTS.has(path.extname(entryPath).toLowerCase());
}

/**
 * T8: Resolve the fsPath set for the auto vendor specifiers (react/react-dom/vue/svelte
 * families) so that ensureOptimizedDeps can exclude them from the batch optimizer arm
 * while prepareProductionAutoCorePack handles them via the chunked optimizer arm.
 * Returns null when resolution is not possible (native.resolveModule unavailable),
 * and an empty set when no vendor specifiers are detected. Callers must fall back to
 * sequential execution when null is returned.
 */
function resolveAutoVendorEntryFsPaths(rootDir: string, config: any): Set<string> | null {
  if (!native?.resolveModule) return null;
  const optimizeDeps = (config as any)?.optimizeDeps ?? {};
  const optimizeExclude: Set<string> | null = Array.isArray(optimizeDeps.exclude)
    ? new Set<string>(optimizeDeps.exclude.map((s: any) => String(s)))
    : null;
  const pkgJson = readProjectPackageJson(rootDir);
  const vendorSpecifiers = detectVendorSpecifiers(pkgJson)
    .filter((s) => !optimizeExclude?.has(s));
  if (vendorSpecifiers.length === 0) return new Set();
  const result = new Set<string>();
  for (const spec of vendorSpecifiers) {
    try {
      const r = native.resolveModule(spec, rootDir) as any;
      const fsPath = r?.fsPath ?? r?.fs_path ?? null;
      if (!fsPath || typeof fsPath !== "string") continue;
      if (!fsPath.includes("node_modules")) continue;
      if (!isOptimizableDepEntryPath(fsPath)) continue;
      result.add(fsPath);
    } catch {
      // ignore individual resolution failures — still include others
    }
  }
  return result;
}

async function ensureOptimizedDeps(options: {
  rootDir: string;
  ionifyDir: string;
  depsHash: string;
  depsRoot: string;
  config: any;
  resolvedEntries: string[] | undefined;
  allowedRoots: string[];
  /**
   * T8: Entry paths that are owned exclusively by the vendor-pack parallel arm
   * (`prepareProductionAutoCorePack` / `prepareProductionManualPacks`). These are
   * filtered out of the batch optimizer so that P1 and P2 can run concurrently
   * without writing to the same dep artifact files. When null / empty, all
   * discovered entries are processed (legacy sequential behaviour).
   */
  excludeEntryPaths?: Set<string>;
  /**
   * Internal split fallback may defer generation admission until both optimizer
   * arms have settled. This controls transaction timing only; DPL remains the
   * sole authority that can publish the generation.
   */
  publishGeneration?: boolean;
}) {
  const { rootDir, ionifyDir, depsHash, depsRoot, config, resolvedEntries, allowedRoots, excludeEntryPaths } = options;
  const shouldPublishGeneration = options.publishGeneration !== false;

  // ── Bottleneck #3 sentinel fast-path ──────────────────────────────────────
  // depsHash is derived from configHash + lockfile + outputVersion + NODE_ENV +
  // sourcemap + bundleEsm + sharedChunks. Any dep or config change produces a
  // new depsHash → new depsRoot directory → no sentinel → full scan runs.
  // On warm builds with the same depsHash, skip the entire scan+resolve pipeline
  // (readProjectPackageJson, scanDepEntryPaths, N×resolveModule calls, optimizer
  // cache-check pass) — everything that takes ~5-8ms per build per 610 deps.
  const sentinelPath = path.join(depsRoot, ".verified");
  let skipGlobalRestore = false;
  if (fs.existsSync(sentinelPath)) {
    const freshness = await checkVerifiedDepsSnapshotFreshness({
      rootDir,
      depsRoot,
      resolvedEntries,
      allowedRoots,
      config,
    });
    if (freshness.fresh) {
      const checkedLabel = freshness.checked > 0 ? `, checked=${freshness.checked}` : "";
      logInfo(`[deps] Skipping optimization (depsHash=${depsHash} already verified${checkedLabel})`);
      depsMeasurementProfile.cacheMode = "local-verified-warm";
      return;
    }
    try {
      fs.unlinkSync(sentinelPath);
    } catch {
      // Non-fatal: this process will still run the optimizer repair path.
    }
    skipGlobalRestore = true;
    const missingLabel = freshness.missing.length > 0 ? `, missing=${freshness.missing.length}` : "";
    logWarn(
      `[deps] Verified deps snapshot is stale (${freshness.reason ?? "unknown"}${missingLabel}); repairing`,
    );
  }

  // ── T20: Global Tier-5 restore ────────────────────────────────────────────
  // If the global cache has a completed build for this depsHash, restore it to
  // the local depsRoot (hardlinks, ~5ms) and skip the full optimizer (~133ms).
  // The restored snapshot must pass the same demand-coverage proof as a local
  // sentinel before it is accepted; otherwise fall through to the repair path.
  if (
    !skipGlobalRestore &&
    restoreDepArtifactsFromGlobalCache(depsHash, depsRoot, DEPS_OPTIMIZER_OUTPUT_VERSION) &&
    (await verifyRestoredDepsSnapshot({
      rootDir,
      depsRoot,
      sentinelPath,
      resolvedEntries,
      allowedRoots,
      config,
    }))
  ) {
    logInfo(`[deps] Restored from global cache (depsHash=${depsHash})`);
    depsMeasurementProfile.cacheMode = "global-cache-restored-cold";
    return;
  }

  // ── T6: Cross-depsHash artifact promotion ────────────────────────────────
  // When depsHash rotates (pnpm add/update, lockfile/config change), the new
  // depsRoot is empty. Find the most recently completed previous depsRoot and
  // promote artifacts whose sourceHash still matches the on-disk file — these
  // are pre-written as manifest entries so the optimizer treats them as cache
  // hits. Only new/changed deps are re-bundled from source.
  depsMeasurementProfile.cacheMode =
    depsMeasurementProfile.outputVersionMismatchSeen || hasPriorDepsOutputVersionMismatch(ionifyDir, depsRoot)
    ? "first-run-after-output-version-bump"
    : "no-cache-true-cold";
  if ((native as any)?.depsPromoteArtifacts) {
    const prevRoot = findPreviousDepsRoot(ionifyDir, depsRoot);
    if (prevRoot) {
      try {
        const result = (native as any).depsPromoteArtifacts(
          prevRoot,
          depsRoot,
          depsHash,
          DEPS_OPTIMIZER_OUTPUT_VERSION,
        ) as { promoted: number; skipped: number };
        depsMeasurementProfile.promoted += result.promoted;
        depsMeasurementProfile.promotionSkipped += result.skipped;
        if (result.promoted > 0) {
          depsMeasurementProfile.cacheMode = "cross-depshash-promotion";
          logInfo(
            `[deps] Promoted ${result.promoted} artifacts from previous deps dir` +
            ` (${result.skipped} need re-optimization)`,
          );
        }
      } catch {
        // Non-fatal: promotion failure leaves new depsRoot empty → full re-optimization.
      }
    }
  }

  if (!native?.resolveModule) return;
  if (!native?.optimizeDependenciesChunked && !native?.optimizeDependenciesBatch && !native?.optimizeDependency) {
    return;
  }

  const pkgJson = readProjectPackageJson(rootDir);
  const optimizeExclude = Array.isArray(config?.optimizeDeps?.exclude)
    ? new Set(config.optimizeDeps.exclude.map((s: any) => String(s)))
    : null;

  const depSpecifiers = Object.keys(pkgJson?.dependencies ?? {});
  const includeSpecifiers = Array.isArray(config?.optimizeDeps?.include)
    ? config.optimizeDeps.include.map((s: any) => String(s))
    : [];

  const vendorMode = config?.optimizeDeps?.vendor ?? "auto";
  const vendorSpecifiers =
    vendorMode === false
      ? []
      : Array.isArray(vendorMode)
        ? vendorMode.map((s: any) => String(s))
        : vendorMode === "auto"
          ? detectVendorSpecifiers(pkgJson)
          : [];

  const allSpecifiers = Array.from(
    new Set([...vendorSpecifiers, ...includeSpecifiers, ...depSpecifiers].map((s) => s.trim()).filter(Boolean)),
  ).filter((s) => !optimizeExclude?.has(s));

  const entryPaths = new Set<string>();
  for (const spec of allSpecifiers) {
    try {
      const r = native.resolveModule(spec, rootDir);
      const fsPath = (r as any)?.fsPath ?? (r as any)?.fs_path ?? null;
      if (!fsPath || typeof fsPath !== "string") continue;
      // Only optimize external deps (node_modules). Workspace sources are handled by CAS transforms.
      if (!fsPath.includes("node_modules")) continue;
      if (!isOptimizableDepEntryPath(fsPath)) continue;
      entryPaths.add(fsPath);
    } catch {
      // ignore
    }
  }

  const usageEntries = await resolveUsageEntries(rootDir, resolvedEntries);
  if (usageEntries.length > 0) {
    try {
      const scannedEntryPaths = await scanDepEntryPaths({ rootDir, entries: usageEntries, allowedRoots });
      for (const entry of scannedEntryPaths) {
        if (optimizeExclude?.has(entry.packageName)) continue;
        if (!isOptimizableDepEntryPath(entry.entryPath)) continue;
        entryPaths.add(entry.entryPath);
      }
    } catch {
      // Fall back to package.json/include/vendor discovery only.
    }
  }

  if (entryPaths.size === 0) {
    if (shouldPublishGeneration) {
      await publishVerifiedDepsGeneration({
        rootDir,
        depsRoot,
        depsHash,
        resolvedEntries,
        allowedRoots,
        config,
      });
    }
    return;
  }

  // T8: Remove entries owned exclusively by the vendor-pack parallel arm so that
  // P1 (batch) and P2 (chunked) write to disjoint artifact file sets. When
  // excludeEntryPaths is provided, those entries will be optimized by P2 via
  // optimizeDependenciesChunked — running them through this batch path too would
  // create concurrent writes to the same files.
  if (excludeEntryPaths && excludeEntryPaths.size > 0) {
    for (const p of excludeEntryPaths) entryPaths.delete(p);
  }

  if (entryPaths.size === 0) {
    if (shouldPublishGeneration) {
      await publishVerifiedDepsGeneration({
        rootDir,
        depsRoot,
        depsHash,
        resolvedEntries,
        allowedRoots,
        config,
      });
    }
    return;
  }
  fs.mkdirSync(depsRoot, { recursive: true });

  const dplDemand = await scanDplUsageDemand({
    rootDir,
    depsRoot,
    depsHash,
    resolvedEntries,
    allowedRoots,
  });
  const entries = Array.from(entryPaths).map((entryPath) =>
    withDplUsageDemand(entryPath, depsHash, dplDemand.demandByEntryPath),
  );

  const depsSharedChunksRaw = config?.optimizeDeps?.sharedChunks;
  const depsSharedChunksMode =
    depsSharedChunksRaw === undefined || depsSharedChunksRaw === "auto"
      ? "auto"
      : depsSharedChunksRaw === true
        ? "1"
        : depsSharedChunksRaw === false
          ? "0"
          : String(depsSharedChunksRaw);
  const depsSharedChunksEnabled = depsSharedChunksMode !== "0";

  const vendorPacks = config?.optimizeDeps?.vendorPacks;
  const vendorPackV2Enabled =
    vendorPacks === "auto" || (!!vendorPacks && typeof vendorPacks === "object" && !Array.isArray(vendorPacks));
  const avoidGlobalChunked = vendorPackV2Enabled;

  // Prefer chunked optimization when available (enables shared chunk groups), but avoid chunking the
  // entire dependency set when vendor packs v2 are enabled — pack chunk groups must remain stable.
  if (depsSharedChunksEnabled && !avoidGlobalChunked && native?.optimizeDependenciesChunked) {
    let optimized = false;
    try {
      native.optimizeDependenciesChunked(entries, ionifyDir);
      optimized = true;
    } catch {
      // fall through to batch/single
    }
    if (optimized) {
      if (shouldPublishGeneration) {
        await publishVerifiedDepsGeneration({
          rootDir,
          depsRoot,
          depsHash,
          resolvedEntries,
          allowedRoots,
          config,
          runtimeDemands: dplDemand.runtimeDemands ?? undefined,
        });
      }
      return;
    }
  }

  if (native?.optimizeDependenciesBatch) {
    let optimized = false;
    try {
      native.optimizeDependenciesBatch(entries, ionifyDir);
      optimized = true;
    } catch {
      // fall through to single
    }
    if (optimized) {
      if (shouldPublishGeneration) {
        await publishVerifiedDepsGeneration({
          rootDir,
          depsRoot,
          depsHash,
          resolvedEntries,
          allowedRoots,
          config,
          runtimeDemands: dplDemand.runtimeDemands ?? undefined,
        });
      }
      return;
    }
  }

  if (native?.optimizeDependency) {
    for (const entry of entries) {
      try {
        native.optimizeDependency(entry.entryPath, depsHash, false, true, ionifyDir);
      } catch {
        // ignore individual optimization errors
      }
    }
  }
  if (shouldPublishGeneration) {
    await publishVerifiedDepsGeneration({
      rootDir,
      depsRoot,
      depsHash,
      resolvedEntries,
      allowedRoots,
      config,
      runtimeDemands: dplDemand.runtimeDemands ?? undefined,
    });
  }
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

/**
 * T6: Find the most recently completed depsRoot under `<ionifyDir>/deps/` that
 * is not the current one. "Completed" means it has both a `.verified` sentinel
 * (written by `markDepsVerified`) and a `manifest.json` file — i.e., a full,
 * successful prior optimization run. Picks the dir with the newest sentinel mtime.
 */
// ── T20: Tier-5 Global User Cache — dep artifacts ─────────────────────────
// Dep artifacts live in `.ionify/deps/<depsHash>/` which is project-local and
// deleted on `rm -rf .ionify` or CI cache wipe. This global mirror at
// `~/.ionify/global/dep-artifacts/v1/<depsHash>/` survives those wipes and is
// keyed by the same content-hash (depsHash) so it is safe to reuse across
// projects and machines with identical dep trees.
//
// Cold build savings (react-basic): ~133ms (optimizer) → ~5ms (hardlink restore).
// Write is done after every successful optimizer run so the cache self-populates.

const GLOBAL_DEP_CACHE_VERSION = "v1";
const GLOBAL_CSS_ARTIFACT_CACHE_VERSION = "v1";
let globalDepSnapshotSequence = 0;

function getGlobalDepCacheDir(depsHash: string): string {
  return path.join(os.homedir(), ".ionify", "global", "dep-artifacts", GLOBAL_DEP_CACHE_VERSION, depsHash);
}

function getGlobalCssBaseDir(configHash: string, baseHash: string): string {
  return path.join(
    os.homedir(),
    ".ionify",
    "global",
    "css-artifacts",
    GLOBAL_CSS_ARTIFACT_CACHE_VERSION,
    configHash,
    "base",
    baseHash,
  );
}

function getGlobalCssArtifactDir(configHash: string, artifactHash: string): string {
  return path.join(
    os.homedir(),
    ".ionify",
    "global",
    "css-artifacts",
    GLOBAL_CSS_ARTIFACT_CACHE_VERSION,
    configHash,
    "artifact",
    artifactHash,
  );
}

function restoreCssArtifactFromGlobalCache(
  configHash: string,
  baseHash: string,
  casRoot: string,
  modules: boolean,
  currentGraphStamp: string | null,
): { restored: boolean; artifactHash: string | null } {
  const globalBaseDir = getGlobalCssBaseDir(configHash, baseHash);
  const globalMetaFile = path.join(globalBaseDir, "meta.json");
  const cssMeta = readJsonFile<CssCasMeta>(globalMetaFile);
  if (
    !cssMeta ||
    cssMeta.version !== CSS_CAS_META_VERSION ||
    cssMeta.baseHash !== baseHash ||
    cssMeta.modules !== modules ||
    typeof cssMeta.artifactHash !== "string" ||
    cssMeta.artifactHash.length === 0 ||
    typeof cssMeta.pipelineHash !== "string" ||
    cssMeta.pipelineHash.length === 0 ||
    typeof cssMeta.depsStampHash !== "string" ||
    cssMeta.depsStampHash.length === 0 ||
    !cssDepProofIsCurrent(cssMeta) ||
    !cssMetaAdmitsCurrentTailwindGraph(cssMeta, currentGraphStamp)
  ) {
    return { restored: false, artifactHash: null };
  }

  const artifactHash = cssMeta.artifactHash;
  const globalArtifactDir = getGlobalCssArtifactDir(configHash, artifactHash);
  const globalCssFile = path.join(globalArtifactDir, "transformed.css");
  if (!fs.existsSync(globalCssFile)) return { restored: false, artifactHash: null };
  if (cssMeta.artifactBytesHash) {
    try {
      if (getCacheKey(fs.readFileSync(globalCssFile)) !== cssMeta.artifactBytesHash) {
        return { restored: false, artifactHash: null };
      }
    } catch {
      return { restored: false, artifactHash: null };
    }
  }

  const localBaseDir = getCasArtifactPath(casRoot, configHash, baseHash);
  const localArtifactDir = getCasArtifactPath(casRoot, configHash, artifactHash);
  if (!copyFileWithHardlinkFallback(globalMetaFile, path.join(localBaseDir, "meta.json"))) {
    return { restored: false, artifactHash: null };
  }
  if (!copyFileWithHardlinkFallback(globalCssFile, path.join(localArtifactDir, "transformed.css"))) {
    return { restored: false, artifactHash: null };
  }
  if (modules) {
    const globalTokensFile = path.join(globalArtifactDir, "tokens.json");
    if (!fs.existsSync(globalTokensFile)) return { restored: false, artifactHash: null };
    if (!copyFileWithHardlinkFallback(globalTokensFile, path.join(localArtifactDir, "tokens.json"))) {
      return { restored: false, artifactHash: null };
    }
    const globalJsFile = path.join(globalArtifactDir, "transformed.js");
    if (fs.existsSync(globalJsFile)) {
      copyFileWithHardlinkFallback(globalJsFile, path.join(localArtifactDir, "transformed.js"));
    }
  }
  return { restored: true, artifactHash };
}

function writeCssArtifactToGlobalCache(
  configHash: string,
  baseHash: string,
  artifactHash: string,
  casRoot: string,
  modules: boolean,
): number {
  let files = 0;
  const localBaseDir = getCasArtifactPath(casRoot, configHash, baseHash);
  const localArtifactDir = getCasArtifactPath(casRoot, configHash, artifactHash);
  const globalBaseDir = getGlobalCssBaseDir(configHash, baseHash);
  const globalArtifactDir = getGlobalCssArtifactDir(configHash, artifactHash);
  if (copyFileWithHardlinkFallback(path.join(localBaseDir, "meta.json"), path.join(globalBaseDir, "meta.json"))) files += 1;
  if (
    copyFileWithHardlinkFallback(
      path.join(localArtifactDir, "transformed.css"),
      path.join(globalArtifactDir, "transformed.css"),
    )
  ) files += 1;
  if (modules) {
    if (
      copyFileWithHardlinkFallback(
        path.join(localArtifactDir, "transformed.js"),
        path.join(globalArtifactDir, "transformed.js"),
      )
    ) files += 1;
    if (copyFileWithHardlinkFallback(path.join(localArtifactDir, "tokens.json"), path.join(globalArtifactDir, "tokens.json"))) {
      files += 1;
    }
  }
  return files;
}

/**
 * Restore dep artifacts from global Tier-5 cache into localDepsRoot.
 * Uses hardlinks for zero-copy performance (falls back to copy on EXDEV).
 * Returns true if restore succeeded.
 */
function dplSnapshotSatisfiesPublicationContract(depsRoot: string, outputVersion: number): boolean {
  // DPL owns route selection, dependency identity, topology, artifact closure,
  // output version, and export ABI. Tier-5 only transports a snapshot after
  // the native authority has accepted its active immutable publication closure.
  const publications = readDplSnapshotPublicationFacts(depsRoot, outputVersion);
  if (publications === null || publications.length === 0) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(depsRoot, "manifest.json"), "utf8"));
    const entries = parsed?.entries && typeof parsed.entries === "object" ? Object.values(parsed.entries) : [];
    if (entries.length === 0) return false;
    // These are portable snapshot-shape checks only. TS does not select an
    // active recipe or recompute any dependency fact; the native closure above
    // remains the authority for identity, topology, artifacts, and ABI.
    return entries.every((entry: any) => {
      if (!entry || typeof entry !== "object") return false;
      if (entry.outputVersion !== outputVersion) return false;
      if (typeof entry.outFile !== "string" || entry.outFile.length === 0) return false;
      if (typeof entry.entryPath !== "string" || entry.entryPath.length === 0) return false;
      if (typeof entry.packageName !== "string" || entry.packageName.length === 0) return false;
      if (typeof entry.packageVersion !== "string" || entry.packageVersion.length === 0) return false;
      if (typeof entry.packageSubpath !== "string" || entry.packageSubpath.length === 0) return false;
      if (typeof entry.packageRoot !== "string") return false;
      if (entry.runtimeFormat !== "esm" && entry.runtimeFormat !== "cjs" && entry.runtimeFormat !== "unknown") return false;
      if (entry.sideEffects !== "none" && entry.sideEffects !== "present" && entry.sideEffects !== "unknown") return false;
      if (typeof entry.artifactHash !== "string" || entry.artifactHash.length === 0) return false;
      return validateDepsManifestEntryTopology(entry, depsRoot, outputVersion).ok;
    });
  } catch {
    return false;
  }
}

function removeSnapshotMarker(markerPath: string): boolean {
  try {
    fs.unlinkSync(markerPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return true;
    return !fs.existsSync(markerPath);
  }
}

function replaceSnapshotFileAtomic(src: string, dst: string, copyOnly = false): void {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const sequence = globalDepSnapshotSequence++;
  const tempPath = path.join(
    path.dirname(dst),
    `.${path.basename(dst)}.tmp-${process.pid}-${sequence}`,
  );
  try {
    if (copyOnly) {
      fs.copyFileSync(src, tempPath);
    } else {
      try {
        fs.linkSync(src, tempPath);
      } catch {
        fs.copyFileSync(src, tempPath);
      }
    }
    try {
      fs.renameSync(tempPath, dst);
    } catch {
      // Windows cannot atomically replace an existing file. The global marker
      // is absent while publication is in progress, so remove+rename remains
      // fail-closed for concurrent readers.
      if (!removeSnapshotMarker(dst)) throw new Error(`Cannot replace snapshot file: ${dst}`);
      fs.renameSync(tempPath, dst);
    }
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Renamed or already absent.
    }
  }
}

function writeTextMarkerAtomic(markerPath: string, value: string): void {
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  const sequence = globalDepSnapshotSequence++;
  const tempPath = path.join(
    path.dirname(markerPath),
    `.${path.basename(markerPath)}.tmp-${process.pid}-${sequence}`,
  );
  try {
    fs.writeFileSync(tempPath, value);
    try {
      fs.renameSync(tempPath, markerPath);
    } catch {
      if (!removeSnapshotMarker(markerPath)) throw new Error(`Cannot replace snapshot marker: ${markerPath}`);
      fs.renameSync(tempPath, markerPath);
    }
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Renamed or already absent.
    }
  }
}

function snapshotEntryIsMutableControl(entry: string): boolean {
  return entry === ".verified" || entry.endsWith(".json");
}

export function restoreDepArtifactsSnapshot(
  globalDir: string,
  localDepsRoot: string,
  outputVersion: number,
): boolean {
  const globalSentinel = path.join(globalDir, ".verified");
  if (!fs.existsSync(globalSentinel)) return false;
  if (!dplSnapshotSatisfiesPublicationContract(globalDir, outputVersion)) {
    removeSnapshotMarker(globalSentinel);
    return false;
  }
  try {
    fs.mkdirSync(localDepsRoot, { recursive: true });
    if (!removeSnapshotMarker(path.join(localDepsRoot, ".verified"))) return false;
    const entries = fs.readdirSync(globalDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".verified") continue;
      if (!entry.isFile()) return false;
      const src = path.join(globalDir, entry.name);
      const dst = path.join(localDepsRoot, entry.name);
      replaceSnapshotFileAtomic(src, dst, snapshotEntryIsMutableControl(entry.name));
    }
    return true;
  } catch {
    removeSnapshotMarker(path.join(localDepsRoot, ".verified"));
    return false;
  }
}

function restoreDepArtifactsFromGlobalCache(depsHash: string, localDepsRoot: string, outputVersion: number): boolean {
  return restoreDepArtifactsSnapshot(getGlobalDepCacheDir(depsHash), localDepsRoot, outputVersion);
}

/**
 * Mirror a completed local depsRoot into the global Tier-5 cache.
 * Called fire-and-forget (errors are non-fatal).
 */
export function publishDepArtifactsSnapshot(
  localDepsRoot: string,
  globalDir: string,
  outputVersion: number,
): boolean {
  const localSentinel = path.join(localDepsRoot, ".verified");
  const globalSentinel = path.join(globalDir, ".verified");
  if (!fs.existsSync(localSentinel)) return false;
  if (!dplSnapshotSatisfiesPublicationContract(localDepsRoot, outputVersion)) {
    return false;
  }
  try {
    fs.mkdirSync(globalDir, { recursive: true });
    // Manifest-last publication: no reader may accept the global directory
    // while any artifact/control file is being refreshed.
    if (!removeSnapshotMarker(globalSentinel)) return false;
    const entries = fs.readdirSync(localDepsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".verified") continue;
      if (!entry.isFile()) throw new Error(`Unsupported dependency snapshot entry: ${entry.name}`);
      const src = path.join(localDepsRoot, entry.name);
      const dst = path.join(globalDir, entry.name);
      replaceSnapshotFileAtomic(src, dst, snapshotEntryIsMutableControl(entry.name));
    }
    if (!dplSnapshotSatisfiesPublicationContract(globalDir, outputVersion)) {
      return false;
    }
    replaceSnapshotFileAtomic(localSentinel, globalSentinel, true);
    return true;
  } catch {
    removeSnapshotMarker(globalSentinel);
    return false;
  }
}

function writeDepArtifactsToGlobalCache(depsHash: string, localDepsRoot: string, outputVersion: number): void {
  publishDepArtifactsSnapshot(localDepsRoot, getGlobalDepCacheDir(depsHash), outputVersion);
}

function findPreviousDepsRoot(ionifyDir: string, currentDepsRoot: string): string | null {
  const depsDir = path.join(ionifyDir, "deps");
  if (!fs.existsSync(depsDir)) return null;
  try {
    const entries = fs.readdirSync(depsDir, { withFileTypes: true });
    let best: { mtime: number; dirPath: string } | null = null;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(depsDir, entry.name);
      if (dirPath === currentDepsRoot) continue;
      if (!fs.existsSync(path.join(dirPath, ".verified"))) continue;
      if (!fs.existsSync(path.join(dirPath, "manifest.json"))) continue;
      try {
        const mtime = fs.statSync(path.join(dirPath, ".verified")).mtimeMs;
        if (!best || mtime > best.mtime) best = { mtime, dirPath };
      } catch { /* skip unreadable sentinel */ }
    }
    return best?.dirPath ?? null;
  } catch {
    return null;
  }
}

type BuildCompressionReportEntry = {
  file: string;
  outputHash: string | null;
  originalBytes: number;
  brotliBytes: number | null;
  gzipBytes: number | null;
  brotliSidecar: string | null;
  gzipSidecar: string | null;
  brotliSource: "current" | "cas" | "compressed" | null;
  gzipSource: "current" | "cas" | "compressed" | null;
};

type BuildCompressionReport = {
  version: 1;
  compressionCasVersion: number;
  thresholdBytes: number;
  gzipLevel: number;
  brotliQuality: number;
  concurrency: number;
  totals: {
    filesScanned: number;
    filesEligible: number;
    filesWithSidecars: number;
    filesAlreadyCurrent: number;
    filesTouched: number;
    casHits: number;
    casMisses: number;
    sidecarsCopiedFromCas: number;
    sidecarsCompressed: number;
    brotliFiles: number;
    gzipFiles: number;
    brotliOriginalBytes: number;
    brotliBytes: number;
    gzipOriginalBytes: number;
    gzipBytes: number;
    brotliSavedBytes: number;
    gzipSavedBytes: number;
  };
  entries: BuildCompressionReportEntry[];
};

type BuildCompressionManifest = {
  version: 2;
  compressionCasVersion: number;
  thresholdBytes: number;
  gzipLevel: number;
  brotliQuality: number;
  totals: Pick<
    BuildCompressionReport["totals"],
    | "filesEligible"
    | "filesWithSidecars"
    | "brotliFiles"
    | "gzipFiles"
    | "brotliOriginalBytes"
    | "brotliBytes"
    | "gzipOriginalBytes"
    | "gzipBytes"
    | "brotliSavedBytes"
    | "gzipSavedBytes"
  >;
  entries: Array<
    Omit<
      BuildCompressionReportEntry,
      "outputHash" | "brotliSource" | "gzipSource"
    >
  >;
};

type CompressionCandidate = {
  absPath: string;
  rel: string;
  stat: fs.Stats;
};

type CompressionEntryResult = {
  entry: BuildCompressionReportEntry;
  filesAlreadyCurrent: number;
  filesTouched: number;
  casHits: number;
  casMisses: number;
  sidecarsCopiedFromCas: number;
  sidecarsCompressed: number;
};

type ReusedChunkFiles = { js: string[]; css: string[]; assets: string[] };
type PraVerifiedBuildOutputs = {
  artifacts: Array<{ id: string; files: ReusedChunkFiles }>;
  stats: Record<string, any>;
  routingManifest: EmittedOutputInfo;
};

/**
 * Create the build-local Transform/Bundler projection of a Planner-owned
 * canonical plan. Array payloads are copied so downstream emission cannot
 * mutate Planner topology through shared references.
 */
function createEmissionPlanProjection(plan: BuildPlan): BuildPlan {
  return {
    entries: [...plan.entries],
    chunks: plan.chunks.map((chunk) => ({
      ...chunk,
      consumers: [...(chunk.consumers ?? [])],
      css: [...(chunk.css ?? [])],
      assets: [...(chunk.assets ?? [])],
      modules: chunk.modules.map((mod) => ({
        ...mod,
        deps: [...(mod.deps ?? [])],
        dynamicDeps: [...(mod.dynamicDeps ?? [])],
        usedExports: mod.usedExports ? [...mod.usedExports] : mod.usedExports,
        dependencyAbi: mod.dependencyAbi
          ? {
              ...mod.dependencyAbi,
              names: [...mod.dependencyAbi.names],
              imports: mod.dependencyAbi.imports.map((item) => ({
                ...item,
                names: [...item.names],
              })),
            }
          : mod.dependencyAbi,
        runtimeLinks: mod.runtimeLinks
          ? mod.runtimeLinks.map((link) => ({ ...link }))
          : mod.runtimeLinks,
      })),
    })),
  };
}

function readPraVerifiedBuildOutputs(
  outDir: string,
): PraVerifiedBuildOutputs | null {
  const manifestPath = path.join(outDir, "manifest.json");
  const statsPath = path.join(outDir, "build.stats.json");
  let manifestStat: fs.Stats;
  let statsStat: fs.Stats;
  let manifest: any;
  let stats: Record<string, any>;
  try {
    manifestStat = fs.statSync(manifestPath);
    statsStat = fs.statSync(statsPath);
    if (!manifestStat.isFile() || !statsStat.isFile()) return null;
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    stats = JSON.parse(fs.readFileSync(statsPath, "utf8"));
  } catch {
    return null;
  }

  if (manifest?.version !== 3) return null;
  const previousChunks: any[] = Array.isArray(manifest?.chunks) ? manifest.chunks : [];
  if (previousChunks.length === 0) return null;

  const artifacts: Array<{ id: string; files: ReusedChunkFiles }> = [];
  const allFiles = new Set<string>();

  for (const previous of previousChunks) {
    if (!previous || typeof previous.id !== "string") return null;

    const files: ReusedChunkFiles = {
      js: Array.isArray(previous.files?.js) ? previous.files.js : [],
      css: Array.isArray(previous.files?.css) ? previous.files.css : [],
      assets: Array.isArray(previous.files?.assets) ? previous.files.assets : [],
    };
    artifacts.push({ id: previous.id, files });
    for (const rel of [...files.js, ...files.css, ...files.assets]) {
      if (typeof rel === "string" && rel.length > 0) allFiles.add(toPosixPath(rel));
    }
  }

  for (const rel of allFiles) {
    const meta = stats?.[rel];
    if (!meta || typeof meta !== "object") return null;
    if (typeof meta.bytes !== "number" || !Number.isFinite(meta.bytes)) return null;
    if (typeof meta.hash !== "string" || meta.hash.length === 0) return null;
    try {
      const fileStat = fs.statSync(path.join(outDir, rel));
      if (!fileStat.isFile()) return null;
      if (fileStat.size !== meta.bytes) return null;
      // If a user or tool modified dist after build.stats.json was written, do not
      // trust the old hash oracle; fall back to normal emission and rewrite.
      if (fileStat.mtimeMs > statsStat.mtimeMs + 1) return null;
    } catch {
      return null;
    }
  }

  return {
    artifacts,
    stats,
    routingManifest: {
      file: "manifest.json",
      bytes: manifestStat.size,
      hash: getCacheKey(fs.readFileSync(manifestPath)),
    },
  };
}

function tryVerifyProductionReadinessOutputReuse(
  outDir: string,
  record: ProductionReadinessRecord,
): PraVerifiedBuildOutputs | null {
  if (record.state !== "verified") return null;
  const distProof = record.proofs.dist;
  if (!distProof.manifestHash || !distProof.buildStatsHash) return null;
  if (record.proofs.publicAssets.conflicts.length > 0) return null;

  const manifestHash = hashFileIfExists(path.join(outDir, "manifest.json"));
  if (manifestHash !== distProof.manifestHash) return null;
  const buildStatsHash = hashFileIfExists(path.join(outDir, "build.stats.json"));
  if (buildStatsHash !== distProof.buildStatsHash) return null;
  if (distProof.assetsManifestHash) {
    const assetsManifestHash = hashFileIfExists(path.join(outDir, "manifest.assets.json"));
    if (assetsManifestHash !== distProof.assetsManifestHash) return null;
  }
  if (distProof.indexHtmlHash) {
    const indexHtmlHash = hashFileIfExists(path.join(outDir, "index.html"));
    if (indexHtmlHash !== distProof.indexHtmlHash) return null;
  }

  return readPraVerifiedBuildOutputs(outDir);
}

function tryVerifyProductionReadinessMaterializedOutputs(
  outDir: string,
  record: ProductionReadinessRecord,
): PraVerifiedBuildOutputs | null {
  if (record.state !== "verified") return null;
  const distProof = record.proofs.dist;
  if (!distProof.manifestHash || !distProof.buildStatsHash) return null;
  if (record.proofs.publicAssets.conflicts.length > 0) return null;

  const manifestPath = path.join(outDir, "manifest.json");
  const statsPath = path.join(outDir, "build.stats.json");
  let manifestStat: fs.Stats;
  let statsStat: fs.Stats;
  let manifest: any;
  let stats: Record<string, any>;
  try {
    manifestStat = fs.statSync(manifestPath);
    statsStat = fs.statSync(statsPath);
    if (!manifestStat.isFile() || !statsStat.isFile()) return null;
    if (hashFileIfExists(manifestPath) !== distProof.manifestHash) return null;
    if (hashFileIfExists(statsPath) !== distProof.buildStatsHash) return null;
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    stats = JSON.parse(fs.readFileSync(statsPath, "utf8"));
  } catch {
    return null;
  }
  if (manifest?.version !== 3) return null;

  if (distProof.assetsManifestHash) {
    const assetsManifestHash = hashFileIfExists(path.join(outDir, "manifest.assets.json"));
    if (assetsManifestHash !== distProof.assetsManifestHash) return null;
  }
  if (distProof.indexHtmlHash) {
    const indexHtmlHash = hashFileIfExists(path.join(outDir, "index.html"));
    if (indexHtmlHash !== distProof.indexHtmlHash) return null;
  }

  const artifacts: Array<{ id: string; files: ReusedChunkFiles }> = [];
  const allFiles = new Set<string>();
  const explicitOutputHashes = new Map<string, string>();
  if (distProof.assetsManifestHash) {
    explicitOutputHashes.set("manifest.assets.json", distProof.assetsManifestHash);
  }
  if (distProof.indexHtmlHash) {
    explicitOutputHashes.set("index.html", distProof.indexHtmlHash);
  }
  const chunks: any[] = Array.isArray(manifest?.chunks) ? manifest.chunks : [];
  for (const chunk of chunks) {
    if (!chunk || typeof chunk.id !== "string") return null;
    const files: ReusedChunkFiles = {
      js: Array.isArray(chunk.files?.js) ? chunk.files.js : [],
      css: Array.isArray(chunk.files?.css) ? chunk.files.css : [],
      assets: Array.isArray(chunk.files?.assets) ? chunk.files.assets : [],
    };
    artifacts.push({ id: chunk.id, files });
    for (const rel of [...files.js, ...files.css, ...files.assets]) {
      if (typeof rel === "string" && rel.length > 0) allFiles.add(toPosixPath(rel));
    }
  }
  for (const asset of record.proofs.publicAssets.assets) {
    if (typeof asset.file === "string" && asset.file.length > 0) {
      const file = toPosixPath(asset.file);
      allFiles.add(file);
      explicitOutputHashes.set(file, asset.hash);
    }
  }
  if (distProof.assetsManifestHash) allFiles.add("manifest.assets.json");
  if (distProof.indexHtmlHash) allFiles.add("index.html");

  for (const rel of allFiles) {
    const meta = stats?.[rel];
    let expectedBytes: number | null = null;
    let expectedHash: string | null = explicitOutputHashes.get(rel) ?? null;
    if (meta && typeof meta === "object" && typeof meta.bytes === "number" && Number.isFinite(meta.bytes)) {
      expectedBytes = meta.bytes;
      if (!expectedHash && typeof meta.hash === "string" && meta.hash.length > 0) {
        expectedHash = meta.hash;
      }
    } else {
      const publicAsset = record.proofs.publicAssets.assets.find((asset) => toPosixPath(asset.file) === rel);
      if (publicAsset) expectedBytes = publicAsset.bytes;
    }
    try {
      const fileStat = fs.statSync(path.join(outDir, rel));
      if (!fileStat.isFile()) return null;
      if (expectedBytes !== null && fileStat.size !== expectedBytes) return null;
      if (fileStat.mtimeMs > statsStat.mtimeMs + 1) {
        if (!expectedHash || hashFileIfExists(path.join(outDir, rel)) !== expectedHash) return null;
      }
    } catch {
      return null;
    }
  }

  return {
    artifacts,
    stats,
    routingManifest: {
      file: "manifest.json",
      bytes: manifestStat.size,
      hash: distProof.manifestHash,
    },
  };
}

function collectOutputHashHints(stats: Record<string, any>): Map<string, string> {
  const hints = new Map<string, string>();
  for (const [file, meta] of Object.entries(stats)) {
    if (!meta || typeof meta !== "object" || file.startsWith("__")) continue;
    const hash = typeof (meta as any).hash === "string" && (meta as any).hash.length > 0 ? (meta as any).hash : null;
    if (!hash) continue;
    hints.set(toPosixPath(file), hash);
  }
  return hints;
}

function recordOutputHashHint(hints: Map<string, string>, info: EmittedOutputInfo | null | undefined): void {
  if (!info || typeof info.file !== "string" || info.file.length === 0) return;
  if (typeof info.hash !== "string" || info.hash.length === 0) return;
  hints.set(toPosixPath(info.file), info.hash);
}

function formatByteDelta(bytes: number): string {
  const value = Math.max(0, Math.floor(bytes));
  if (value < 1024) return `${value}B`;
  const kb = value / 1024;
  if (kb < 1024) return `${Math.round(kb)}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)}GB`;
}

async function collectFilesRecursive(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (ent) => {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          await walk(full);
          return;
        }
        if (ent.isFile()) out.push(full);
      }),
    );
  };
  await walk(rootDir);
  return out;
}

function resolvePrecompressConcurrency(value: unknown): number {
  const defaultParallelism =
    typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  return Math.max(1, defaultParallelism);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) break;
      results[current] = await worker(items[current], current);
    }
  });

  await Promise.all(runners);
  return results;
}

function brotliCompressAsync(input: Buffer, quality: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib.brotliCompress(
      input,
      {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: quality,
          [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
        },
      },
      (err, result) => {
        if (err || !result) {
          reject(err ?? new Error("brotli compression failed"));
          return;
        }
        resolve(result);
      },
    );
  });
}

function gzipCompressAsync(input: Buffer, level: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib.gzip(input, { level, mtime: 0 } as any, (err, result) => {
      if (err || !result) {
        reject(err ?? new Error("gzip compression failed"));
        return;
      }
      resolve(result);
    });
  });
}

function shouldPrecompressPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".br") || lower.endsWith(".gz")) return false;
  if (path.basename(lower) === "manifest.compression.json") return false;
  const ext = path.extname(lower);
  // Text-like assets only (avoid images/archives that are already compressed).
  return (
    ext === ".js" ||
    ext === ".mjs" ||
    ext === ".cjs" ||
    ext === ".css" ||
    ext === ".html" ||
    ext === ".json" ||
    ext === ".svg" ||
    ext === ".xml" ||
    ext === ".txt" ||
    ext === ".map"
  );
}

export async function precompressBuildOutputs(
  outDir: string,
  opts: {
    casRoot: string;
    thresholdBytes: number;
    gzipLevel: number;
    brotliQuality: number;
    emitManifest: boolean;
  concurrency: number;
    outputHashHints: Map<string, string>;
    /**
     * Optional Rust-native compressor for every text-like output admitted by
     * `shouldPrecompressPath`.
     * Contract: same codec settings (br:quality / gz:level) and size-gating apply.
     */
    nativeCompressor?: (
      items: Array<{ id: string; bytes: Buffer; brotliQuality: number; gzipLevel: number }>,
    ) => Array<{ id: string; br?: Buffer | null; gz?: Buffer | null }>;
  },
): Promise<BuildCompressionReport> {
  const files = await collectFilesRecursive(outDir);
  const candidates: CompressionCandidate[] = [];
  const report: BuildCompressionReport = {
    version: 1,
    compressionCasVersion: COMPRESSION_CAS_VERSION,
    thresholdBytes: opts.thresholdBytes,
    gzipLevel: opts.gzipLevel,
    brotliQuality: opts.brotliQuality,
    concurrency: opts.concurrency,
    totals: {
      filesScanned: files.length,
      filesEligible: 0,
      filesWithSidecars: 0,
      filesAlreadyCurrent: 0,
      filesTouched: 0,
      casHits: 0,
      casMisses: 0,
      sidecarsCopiedFromCas: 0,
      sidecarsCompressed: 0,
      brotliFiles: 0,
      gzipFiles: 0,
      brotliOriginalBytes: 0,
      brotliBytes: 0,
      gzipOriginalBytes: 0,
      gzipBytes: 0,
      brotliSavedBytes: 0,
      gzipSavedBytes: 0,
    },
    entries: [],
  };

  for (const absPath of files) {
    if (!shouldPrecompressPath(absPath)) continue;
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(absPath);
    } catch {
      continue;
    }

    if (!stat.isFile()) continue;
    if (stat.size < opts.thresholdBytes) continue;

    candidates.push({
      absPath,
      rel: toPosixPath(path.relative(outDir, absPath)),
      stat,
    });
  }

  report.totals.filesEligible = candidates.length;

  const readUsableSidecar = async (
    sidecarPath: string,
    originalBytes: number,
  ): Promise<{ size: number; mtimeMs: number } | null> => {
    try {
      const stat = await fs.promises.stat(sidecarPath);
      if (!stat.isFile()) return null;
      if (stat.size <= 0 || stat.size >= originalBytes) return null;
      return { size: stat.size, mtimeMs: stat.mtimeMs };
    } catch {
      return null;
    }
  };

  const results = await mapWithConcurrency(candidates, opts.concurrency, async (candidate) => {
    const { absPath, rel, stat } = candidate;
    const originalBytes = stat.size;
    const hintedOutputHash = opts.outputHashHints.get(rel) ?? null;
    let outputHash: string | null = null;
    if (hintedOutputHash) outputHash = hintedOutputHash;
    let body: Buffer | null = null;
    let bodyPromise: Promise<Buffer> | null = null;
    let outputHashPromise: Promise<string> | null = outputHash ? Promise.resolve(outputHash) : null;
    let brotliBytes: number | null = null;
    let gzipBytes: number | null = null;
    let brotliSidecar: string | null = null;
    let gzipSidecar: string | null = null;
    let brotliSource: "current" | "cas" | "compressed" | null = null;
    let gzipSource: "current" | "cas" | "compressed" | null = null;
    let filesAlreadyCurrent = 0;
    let filesTouched = 0;
    let casHits = 0;
    let casMisses = 0;
    let sidecarsCopiedFromCas = 0;
    let sidecarsCompressed = 0;

    const brPath = `${absPath}.br`;
    const gzPath = `${absPath}.gz`;

    const ensureBody = async (): Promise<Buffer> => {
      if (body) return body;
      if (!bodyPromise) {
        bodyPromise = fs.promises.readFile(absPath).then((loaded) => {
          body = loaded;
          if (!outputHash) outputHash = getCacheKey(loaded);
          return loaded;
        });
      }
      body = await bodyPromise;
      return body;
    };

    const ensureOutputHash = async (): Promise<string> => {
      if (outputHash) return outputHash;
      if (!outputHashPromise) {
        outputHashPromise = ensureBody().then((loaded) => {
          if (!outputHash) outputHash = getCacheKey(loaded);
          return outputHash;
        });
      }
      outputHash = await outputHashPromise;
      return outputHash;
    };

    const tryRestoreFromCompressionCas = async (
      sidecarKind: "br" | "gz",
      sidecarPath: string,
    ): Promise<{ restored: boolean; size: number | null }> => {
      const finalOutputHash = await ensureOutputHash();
      const compressionCasDir = getCompressionCasArtifactPath(opts.casRoot, finalOutputHash, {
        brotliQuality: opts.brotliQuality,
        gzipLevel: opts.gzipLevel,
      });
      const sourceFile = path.join(compressionCasDir, sidecarKind === "br" ? "sidecar.br" : "sidecar.gz");
      const cached = await readUsableSidecar(sourceFile, originalBytes);
      if (!cached) {
        casMisses += 1;
        return { restored: false, size: null };
      }
      try {
        await fs.promises.mkdir(path.dirname(sidecarPath), { recursive: true });
        await fs.promises.copyFile(sourceFile, sidecarPath);
        filesTouched += 1;
        casHits += 1;
        sidecarsCopiedFromCas += 1;
        return { restored: true, size: cached.size };
      } catch {
        casMisses += 1;
        return { restored: false, size: null };
      }
    };

    const persistCompressionCasSidecar = async (
      sidecarKind: "br" | "gz",
      finalOutputHash: string,
      data: Buffer | null,
    ): Promise<void> => {
      const compressionCasDir = getCompressionCasArtifactPath(opts.casRoot, finalOutputHash, {
        brotliQuality: opts.brotliQuality,
        gzipLevel: opts.gzipLevel,
      });
      const targetFile = path.join(compressionCasDir, sidecarKind === "br" ? "sidecar.br" : "sidecar.gz");
      try {
        if (!data || data.length <= 0 || data.length >= originalBytes) {
          await fs.promises.unlink(targetFile).catch(() => {});
          return;
        }
        await fs.promises.mkdir(compressionCasDir, { recursive: true });
        await fs.promises.writeFile(targetFile, data);
      } catch {
        // ignore CAS persistence errors; compression remains best-effort metadata/output
      }
    };

    try {
      const currentBr = await readUsableSidecar(brPath, originalBytes);
      const currentGz = await readUsableSidecar(gzPath, originalBytes);
      const skipBr = !!currentBr && currentBr.mtimeMs >= stat.mtimeMs;
      const skipGz = !!currentGz && currentGz.mtimeMs >= stat.mtimeMs;
      if (skipBr && currentBr) {
        brotliBytes = currentBr.size;
        brotliSidecar = toPosixPath(path.relative(outDir, brPath));
        brotliSource = "current";
      }
      if (skipGz && currentGz) {
        gzipBytes = currentGz.size;
        gzipSidecar = toPosixPath(path.relative(outDir, gzPath));
        gzipSource = "current";
      }
      if (skipBr && skipGz) filesAlreadyCurrent = 1;

      const [restoredBr, restoredGz] = await Promise.all([
        skipBr
          ? Promise.resolve<{ restored: boolean; size: number | null }>({ restored: false, size: null })
          : tryRestoreFromCompressionCas("br", brPath),
        skipGz
          ? Promise.resolve<{ restored: boolean; size: number | null }>({ restored: false, size: null })
          : tryRestoreFromCompressionCas("gz", gzPath),
      ]);
      if (restoredBr.restored) {
        brotliBytes = restoredBr.size;
        brotliSidecar = toPosixPath(path.relative(outDir, brPath));
        brotliSource = "cas";
      }
      if (restoredGz.restored) {
        gzipBytes = restoredGz.size;
        gzipSidecar = toPosixPath(path.relative(outDir, gzPath));
        gzipSource = "cas";
      }

      const needsBrCompression = !skipBr && brotliSource === null;
      const needsGzCompression = !skipGz && gzipSource === null;

      const loadedBody = needsBrCompression || needsGzCompression ? await ensureBody() : null;

      // The native compressor is format-agnostic: all admitted files are byte
      // streams under the same compression CAS identity.
      let br: Buffer | null = null;
      let gz: Buffer | null = null;

      if ((needsBrCompression || needsGzCompression) && loadedBody) {
        const useNative = !!opts.nativeCompressor;
        if (useNative && opts.nativeCompressor) {
          const results = opts.nativeCompressor([
            { id: rel, bytes: loadedBody, brotliQuality: opts.brotliQuality, gzipLevel: opts.gzipLevel },
          ]);
          const result = results[0];
          if (result) {
            br = needsBrCompression ? (result.br ?? null) : null;
            gz = needsGzCompression ? (result.gz ?? null) : null;
          }
        } else {
          [br, gz] = await Promise.all([
            needsBrCompression
              ? brotliCompressAsync(loadedBody, opts.brotliQuality)
              : Promise.resolve<Buffer | null>(null),
            needsGzCompression
              ? gzipCompressAsync(loadedBody, opts.gzipLevel)
              : Promise.resolve<Buffer | null>(null),
          ]);
        }
      }

      if (needsBrCompression && loadedBody) {
        if (br && br.length < loadedBody.length) {
          await fs.promises.writeFile(brPath, br);
          filesTouched += 1;
          sidecarsCompressed += 1;
          brotliBytes = br.length;
          brotliSidecar = toPosixPath(path.relative(outDir, brPath));
          brotliSource = "compressed";
        } else {
          try {
            await fs.promises.unlink(brPath);
            filesTouched += 1;
          } catch {
            // ignore
          }
        }
        await persistCompressionCasSidecar("br", await ensureOutputHash(), br);
      }
      if (brotliBytes === null) {
        const resolved = await readUsableSidecar(brPath, originalBytes);
        if (resolved) {
          brotliBytes = resolved.size;
          brotliSidecar = toPosixPath(path.relative(outDir, brPath));
        }
      }

      if (needsGzCompression && loadedBody) {
        if (gz && gz.length < loadedBody.length) {
          await fs.promises.writeFile(gzPath, gz);
          filesTouched += 1;
          sidecarsCompressed += 1;
          gzipBytes = gz.length;
          gzipSidecar = toPosixPath(path.relative(outDir, gzPath));
          gzipSource = "compressed";
        } else {
          try {
            await fs.promises.unlink(gzPath);
            filesTouched += 1;
          } catch {
            // ignore
          }
        }
        await persistCompressionCasSidecar("gz", await ensureOutputHash(), gz);
      }
      if (gzipBytes === null) {
        const resolved = await readUsableSidecar(gzPath, originalBytes);
        if (resolved) {
          gzipBytes = resolved.size;
          gzipSidecar = toPosixPath(path.relative(outDir, gzPath));
        }
      }
    } catch (err) {
      logWarn(`[Build][compress] WARN: failed to precompress ${rel}: ${String(err)}`);
      return {
        entry: {
          file: rel,
          outputHash,
          originalBytes,
          brotliBytes,
          gzipBytes,
          brotliSidecar,
          gzipSidecar,
          brotliSource,
          gzipSource,
        },
        filesAlreadyCurrent,
        filesTouched,
        casHits,
        casMisses,
        sidecarsCopiedFromCas,
        sidecarsCompressed,
      };
    }
    return {
      entry: {
        file: rel,
        outputHash,
        originalBytes,
        brotliBytes,
        gzipBytes,
        brotliSidecar,
        gzipSidecar,
        brotliSource,
        gzipSource,
      },
      filesAlreadyCurrent,
      filesTouched,
      casHits,
      casMisses,
      sidecarsCopiedFromCas,
      sidecarsCompressed,
    };
  });

  for (const result of results) {
    report.totals.filesAlreadyCurrent += result.filesAlreadyCurrent;
    report.totals.filesTouched += result.filesTouched;
    report.totals.casHits += result.casHits;
    report.totals.casMisses += result.casMisses;
    report.totals.sidecarsCopiedFromCas += result.sidecarsCopiedFromCas;
    report.totals.sidecarsCompressed += result.sidecarsCompressed;
    if (result.entry.brotliBytes !== null) {
      report.totals.brotliFiles += 1;
      report.totals.brotliOriginalBytes += result.entry.originalBytes;
      report.totals.brotliBytes += result.entry.brotliBytes;
      report.totals.brotliSavedBytes += Math.max(0, result.entry.originalBytes - result.entry.brotliBytes);
    }
    if (result.entry.gzipBytes !== null) {
      report.totals.gzipFiles += 1;
      report.totals.gzipOriginalBytes += result.entry.originalBytes;
      report.totals.gzipBytes += result.entry.gzipBytes;
      report.totals.gzipSavedBytes += Math.max(0, result.entry.originalBytes - result.entry.gzipBytes);
    }
    if (result.entry.brotliBytes !== null || result.entry.gzipBytes !== null) {
      report.totals.filesWithSidecars += 1;
    }
    report.entries.push(result.entry);
  }

  report.entries.sort((a, b) => a.file.localeCompare(b.file));
  if (opts.emitManifest) {
    writeJsonFile(
      path.join(outDir, "manifest.compression.json"),
      toBuildCompressionManifest(report),
    );
  }
  return report;
}

function toBuildCompressionManifest(
  report: BuildCompressionReport,
): BuildCompressionManifest {
  const {
    filesEligible,
    filesWithSidecars,
    brotliFiles,
    gzipFiles,
    brotliOriginalBytes,
    brotliBytes,
    gzipOriginalBytes,
    gzipBytes,
    brotliSavedBytes,
    gzipSavedBytes,
  } = report.totals;

  return {
    version: 2,
    compressionCasVersion: report.compressionCasVersion,
    thresholdBytes: report.thresholdBytes,
    gzipLevel: report.gzipLevel,
    brotliQuality: report.brotliQuality,
    totals: {
      filesEligible,
      filesWithSidecars,
      brotliFiles,
      gzipFiles,
      brotliOriginalBytes,
      brotliBytes,
      gzipOriginalBytes,
      gzipBytes,
      brotliSavedBytes,
      gzipSavedBytes,
    },
    entries: report.entries.map((entry) => ({
      file: entry.file,
      originalBytes: entry.originalBytes,
      brotliBytes: entry.brotliBytes,
      gzipBytes: entry.gzipBytes,
      brotliSidecar: entry.brotliSidecar,
      gzipSidecar: entry.gzipSidecar,
    })),
  };
}

function pickPrimaryJs(files: string[] | undefined): string | null {
  if (!files?.length) return null;
  for (const file of files) {
    if (typeof file !== "string") continue;
    if (!file.endsWith(".js")) continue;
    if (file.endsWith(".js.map")) continue;
    return file.startsWith("/") ? file : `/${file}`;
  }
  return null;
}

function pickPrimaryEntryCss(files: string[] | undefined): string[] {
  if (!files?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (file: string) => {
    const href = file.startsWith("/") ? file : `/${file}`;
    if (seen.has(href)) return;
    seen.add(href);
    out.push(href);
  };

  // Prefer extracted chunk CSS emitted under assets/.
  for (const file of files) {
    if (typeof file !== "string") continue;
    if (!file.endsWith(".css")) continue;
    if (file.endsWith(".css.map")) continue;
    if (file.endsWith(".native.css")) continue;
    if (!file.startsWith("assets/") && !file.startsWith("/assets/")) continue;
    add(file);
  }

  // Fallback: include any other CSS files (excluding native debug artifacts).
  if (!out.length) {
    for (const file of files) {
      if (typeof file !== "string") continue;
      if (!file.endsWith(".css")) continue;
      if (file.endsWith(".css.map")) continue;
      if (file.endsWith(".native.css")) continue;
      add(file);
    }
  }

  return out;
}

async function emitIndexHtml(options: {
  rootDir: string;
  outDir: string;
  entries: string[];
  hostEntryIds: string[];
  plan: Awaited<ReturnType<typeof generateBuildPlan>>;
  artifacts: Array<{ id: string; files: { js: string[]; css: string[]; assets: string[] } }>;
  envValues: Record<string, string>;
  envPrefix: string | string[];
}): Promise<EmittedOutputInfo | null> {
  const profileStart = isBuildProfileEnabled() ? process.hrtime.bigint() : 0n;
  const { rootDir, outDir, entries, hostEntryIds, plan, artifacts, envValues, envPrefix } = options;

  const htmlInput = path.join(rootDir, "index.html");
  if (!fs.existsSync(htmlInput)) {
    return null;
  }

  const hostEntryIdSet = new Set(hostEntryIds);
  const isHostEntryChunk = (chunk: (typeof plan.chunks)[number]): boolean =>
    chunk.entry && chunk.consumers.some((consumer) => hostEntryIdSet.has(consumer));
  const isHostSharedChunk = (chunk: (typeof plan.chunks)[number]): boolean =>
    !chunk.entry &&
    chunk.shared &&
    Array.isArray(chunk.consumers) &&
    chunk.consumers.some((consumer) => hostEntryIdSet.has(consumer));
  const entryChunks = plan.chunks.filter(isHostEntryChunk);
  const eagerCssChunks = plan.chunks.filter((chunk) => isHostEntryChunk(chunk) || isHostSharedChunk(chunk));

  const entryScripts = entryChunks
    .map((chunk) => {
      const artifact = artifacts.find((a) => a.id === chunk.id);
      return pickPrimaryJs(artifact?.files?.js);
    })
    .filter((x): x is string => typeof x === "string" && x.length > 0);

  const entryCss = eagerCssChunks
    .flatMap((chunk) => {
      const artifact = artifacts.find((a) => a.id === chunk.id);
      return pickPrimaryEntryCss(artifact?.files?.css);
    })
    .filter((x): x is string => typeof x === "string" && x.length > 0);
  const profilePlanEnd = profileStart ? process.hrtime.bigint() : 0n;

  if (!entryScripts.length) {
    return null;
  }

  const candidateSrcs = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "string") continue;
    const rel = toPosixPath(path.relative(rootDir, entry));
    if (rel && rel !== ".") {
      candidateSrcs.add(`/${rel}`);
      candidateSrcs.add(rel);
    }
  }

  let html = await fs.promises.readFile(htmlInput, "utf8");
  const profileReadEnd = profileStart ? process.hrtime.bigint() : 0n;

  // Vite-compatible `%ENV%` substitution — identical to the dev server's serve-time
  // pass (shared `substituteEnvPlaceholders`), so a `<script src="%VITE_X%">` in
  // index.html resolves the same way in dev and in dist (was left un-substituted →
  // 404 → "Unexpected token '<'"). Unknown placeholders are left literal.
  html = substituteEnvPlaceholders(html, envValues, envPrefix);

  if (entryCss.length) {
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const href of entryCss) {
      if (seen.has(href)) continue;
      seen.add(href);
      const hrefRe = new RegExp(`href=["']${escapeRegExp(href)}["']`, "i");
      if (hrefRe.test(html)) continue;
      unique.push(href);
    }

    if (unique.length) {
      const injected = unique.map((href) => `  <link rel="stylesheet" href="${href}">`).join("\n");
      const headClose = html.match(/<\/head>/i);
      if (headClose?.index !== undefined) {
        const idx = headClose.index;
        html = `${html.slice(0, idx)}${injected}\n${html.slice(idx)}`;
      } else {
        html = `${injected}\n${html}`;
      }
    }
  }

  // Phase 17: when shared/vendor chunks are real, add deterministic modulepreload hints so
  // production does not regress into a waterfall before the module graph is discovered.
  const entryIds = new Set(hostEntryIds);
  const sharedPreloads = plan.chunks
    .filter((chunk) => !chunk.entry && chunk.shared && Array.isArray(chunk.consumers) && chunk.consumers.some((c) => entryIds.has(c)))
    .map((chunk) => {
      const artifact = artifacts.find((a) => a.id === chunk.id);
      return pickPrimaryJs(artifact?.files?.js);
    })
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    // Artifact paths are canonical POSIX/ASCII identities. Code-unit ordering
    // is deterministic across hosts and avoids locale initialization in the
    // changed-file publication path.
    .sort();

  if (sharedPreloads.length) {
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const href of sharedPreloads) {
      if (seen.has(href)) continue;
      seen.add(href);
      const hrefRe = new RegExp(`href=[\"']${escapeRegExp(href)}[\"']`, "i");
      if (hrefRe.test(html)) continue;
      unique.push(href);
    }
    if (unique.length) {
      const injected = unique.map((href) => `  <link rel="modulepreload" href="${href}">`).join("\n");
      const headClose = html.match(/<\/head>/i);
      if (headClose?.index !== undefined) {
        const idx = headClose.index;
        html = `${html.slice(0, idx)}${injected}\n${html.slice(idx)}`;
      } else {
        html = `${injected}\n${html}`;
      }
    }
  }

  const moduleScriptRe =
    /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi;
  let scriptIndex = 0;
  let replacedAny = false;
  html = html.replace(moduleScriptRe, (full, srcRaw) => {
    if (scriptIndex >= entryScripts.length) return full;
    const src = typeof srcRaw === "string" ? srcRaw.trim() : "";
    if (!src) return full;
    if (candidateSrcs.size > 0 && !candidateSrcs.has(src)) {
      return full;
    }
    replacedAny = true;
    const next = entryScripts[scriptIndex++]!;
    return `<script type="module" src="${next}"></script>`;
  });

  if (!replacedAny) {
    const injected = entryScripts.map((s) => `  <script type="module" src="${s}"></script>`).join("\n");
    const bodyClose = html.match(/<\/body>/i);
    if (bodyClose?.index !== undefined) {
      const idx = bodyClose.index;
      html = `${html.slice(0, idx)}${injected}\n${html.slice(idx)}`;
    } else {
      html = `${html}\n${injected}\n`;
    }
  }
  const profileRenderEnd = profileStart ? process.hrtime.bigint() : 0n;

  await fs.promises.mkdir(outDir, { recursive: true });
  const outputFile = path.join(outDir, "index.html");
  await writeTextFileIfChanged(outputFile, html);
  if (profileStart) {
    const profileWriteEnd = process.hrtime.bigint();
    const toMs = (value: bigint): string => (Number(value) / 1_000_000).toFixed(2);
    console.error(
      `[BuildProfile][indexHtml] total_ms=${toMs(profileWriteEnd - profileStart)} plan_ms=${toMs(profilePlanEnd - profileStart)} read_ms=${toMs(profileReadEnd - profilePlanEnd)} render_ms=${toMs(profileRenderEnd - profileReadEnd)} write_ms=${toMs(profileWriteEnd - profileRenderEnd)}`,
    );
  }
  return {
    file: "index.html",
    bytes: Buffer.byteLength(html, "utf8"),
    hash: getCacheKey(html),
  };
}



// ===== Next Phase TODOs =====
// Phase 3: Add parallel chunk planner.
// Phase 4: Integrate Vite/Rollup plugin compatibility.
// Phase 5: Include Analyzer summary after build.
