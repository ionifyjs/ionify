import fs from "fs";
import path from "path";
import chalk from "chalk";

import { logError, logInfo } from "@cli/utils/logger";
import { loadIonifyConfig } from "@cli/utils/config";
import { resolveMinifier } from "@cli/utils/minifier";
import { resolveParser, applyParserEnv } from "@cli/utils/parser";
import { resolveScopeHoist } from "@cli/utils/scope-hoist";
import { resolveTreeshake } from "@cli/utils/treeshake";
import { hashVendorPackV2RoutingIndex } from "@core/deps/routing-hash";
import { REACT_REFRESH_RUNTIME_MODULE } from "@core/refresh/reactRefreshInstrumentation";
import { RouteHintIndex, normalizeDocumentRouteKey } from "@core/route-hints";
import { resolveWorkspace } from "@core/workspace";
import { computeGraphVersion, ensureNativeGraph, native } from "@native/index";

export interface AnalyzeOptions {
  json?: boolean;
  limit?: number;
  verbose?: boolean;
  section?: AnalyzeSection;
  graph?: boolean;
  build?: boolean;
  packs?: boolean;
  routes?: boolean;
  findings?: boolean;
  tree?: boolean;
  deps?: boolean;
  depsHash?: string;
  outDir?: string;
}

type AnalyzeSurface = "graph" | "build" | "packs" | "routes" | "findings";
type AnalyzeSection = AnalyzeSurface | "deps";
type AnalyzeCertainty = "high" | "medium" | "low";
type AnalyzeSeverity = "high" | "medium" | "low";
type AnalyzeHealthLevel = "high" | "medium" | "low" | "missing";
type AnalyzeRouteVisibility = "present" | "missing";

export interface GraphNodeSummary {
  id: string;
  hash: string | null;
  deps: string[];
}

export interface GraphTreeNode {
  id: string;
  depCount: number;
  deps?: GraphTreeNode[];
  cycle?: boolean;
  truncated?: boolean;
}

export interface GraphAnalyzeSummary {
  modules: number;
  edges: number;
  averageDeps: number;
  roots: string[];
  densest: Array<{ id: string; deps: number }>;
  mostDepended: Array<{ id: string; dependents: number }>;
  orphans: string[];
  tree?: GraphTreeNode[];
}

export interface BuildTopFile {
  file: string;
  bytes: number;
  type: string;
}

export interface BuildAnalyzeSummary {
  outDir: string;
  hasManifest: boolean;
  hasStats: boolean;
  entries: number;
  chunks: {
    total: number;
    entry: number;
    shared: number;
  };
  files: {
    js: number;
    css: number;
    assets: number;
    maps: number;
    publicAssets: number;
    totalTracked: number;
  };
  bytes: {
    js: number;
    css: number;
    assets: number;
    maps: number;
    publicAssets: number;
    totalTracked: number;
  };
  topFiles: BuildTopFile[];
}

export type VendorPackAnalyzePack = {
  packFileName: string;
  members: number;
  chunkFiles: string[];
  requestsPacked: number;
  requestsUnpacked: number;
  requestsSaved: number;
  bytesPacked: number | null;
  bytesWrappers: number | null;
};

export type VendorPackAnalyzeSlimGroup = {
  label: string;
  baseSharedBytes: number | null;
  slimSharedBytes: number | null;
  savedBytes: number | null;
};

export type VendorPackAnalyzeSummary = {
  depsHash: string;
  depsRoot: string;
  selectionMode: "explicit" | "env" | "single-dir" | "latest-mtime-fallback";
  packIndexHash: string | null;
  usageIndexHash: string | null;
  packs: VendorPackAnalyzePack[];
  slimGroups: VendorPackAnalyzeSlimGroup[];
};

export interface RouteAnalyzeRouteSummary {
  routeKey: string;
  documents: number;
  totalAssets: number;
  depAssets: number;
  sourceAssets: number;
  totalRequests: number;
}

export interface RouteAnalyzeAssetSummary {
  url: string;
  kind: "dep" | "source";
  totalRequestCount: number;
  minDepth: number;
  routeKeys: string[];
}

export interface RouteAnalyzePreloadSummary {
  url: string;
  kind: "dep" | "source";
  routeRequestCount: number;
  totalRequestCount: number;
  minDepth: number;
}

export interface RouteAnalyzeFirstRouteBytes {
  totalObservedBytes: number;
  depObservedBytes: number;
  sourceObservedBytes: number;
  observedAssets: number;
  unresolvedAssets: number;
}

export interface RouteAnalyzePackCoverage {
  totalDepAssets: number;
  coveredDepAssets: number;
  uncoveredDepAssets: number;
  coverageRate: number | null;
  estimatedCurrentRequests: number | null;
  estimatedPackedRequests: number | null;
  estimatedRequestsSaved: number | null;
}

export interface RouteAnalyzeUncoveredHotDep {
  url: string;
  fileName: string;
  packageLabel: string | null;
  totalRequestCount: number;
  routeRequestCount: number;
  minDepth: number;
  bytes: number | null;
  importers: number;
  entryRoots: number;
}

export interface RouteAnalyzeEntryCriticalEvidence {
  criticalAssets: number;
  deferredAssets: number;
  criticalRequests: number;
  deferredRequests: number;
}

export interface RouteAnalyzeHistorySignals {
  routeHints: boolean;
  depUsage: boolean;
  packRouting: boolean;
  manifestOwnership: boolean;
}

export interface RouteAnalyzePolicyVisibility {
  signals: RouteAnalyzeHistorySignals;
  currentEffects: string[];
  entryCriticalEvidence: RouteAnalyzeEntryCriticalEvidence | null;
  policyReuse: {
    status: "unavailable";
    reason: string;
  };
  missingCapabilities: string[];
}

export interface RouteAnalyzeSummary {
  statePath: string;
  primaryRouteKey: string | null;
  routeCount: number;
  routes: RouteAnalyzeRouteSummary[];
  topDepAssets: RouteAnalyzeAssetSummary[];
  topSourceAssets: RouteAnalyzeAssetSummary[];
  suggestedPreloads: RouteAnalyzePreloadSummary[];
  firstRouteBytes: RouteAnalyzeFirstRouteBytes | null;
  packCoverage: RouteAnalyzePackCoverage | null;
  uncoveredHotDeps: RouteAnalyzeUncoveredHotDep[];
  policyVisibility: RouteAnalyzePolicyVisibility;
}

export interface AnalyzeSummary {
  version: 1;
  workspace: {
    projectRoot: string;
    workspaceRoot: string;
    ionifyDir: string;
  };
  selected: AnalyzeSurface[];
  summary: AnalyzeOverviewSummary;
  health: AnalyzeHealthSummary;
  topFindings: AnalyzeTopFinding[];
  graph?: GraphAnalyzeSummary | null;
  build?: BuildAnalyzeSummary | null;
  packs?: VendorPackAnalyzeSummary | null;
  routes?: RouteAnalyzeSummary | null;
  findings?: AnalyzeFindings | null;
}

export interface AnalyzeOverviewSummary {
  modules: number | null;
  dependencies: number | null;
  entries: number | null;
  chunks: number | null;
  jsBytes: number | null;
  cssBytes: number | null;
  packSavingsRequests: number | null;
}

export interface AnalyzeHealthSummary {
  bundlePressure: AnalyzeHealthLevel;
  duplicatePressure: AnalyzeHealthLevel;
  packCoverage: AnalyzeHealthLevel;
  routeVisibility: AnalyzeRouteVisibility;
}

export interface AnalyzeTopFinding {
  id: string;
  severity: AnalyzeSeverity;
  title: string;
  why: string;
  action: string | null;
  confidence: AnalyzeCertainty;
  evidence: Record<string, string | number | boolean | null>;
  source: "duplicate" | "chunk-bloat" | "dep-bloat";
}

export interface AnalyzeDuplicateVersionDetail {
  version: string;
  graphModules: number;
  depArtifacts: number;
  importers: number;
  entryRoots: number;
  sampleIds: string[];
}

export interface AnalyzeDuplicateFinding {
  packageName: string;
  versions: AnalyzeDuplicateVersionDetail[];
  evidenceSources: Array<"graph" | "dep-usage" | "deps-manifest">;
  totalGraphModules: number;
  totalDepArtifacts: number;
  totalImporters: number;
  severity: AnalyzeSeverity;
  confidence: AnalyzeCertainty;
}

export interface AnalyzeChunkModuleHint {
  id: string;
  deps: number;
}

export interface AnalyzeChunkBloatFinding {
  kind: "build-chunk";
  chunkId: string;
  entry: boolean;
  shared: boolean;
  totalBytes: number;
  jsBytes: number;
  cssBytes: number;
  assetBytes: number;
  consumerCount: number;
  moduleCount: number;
  depReferenceCount: number;
  topModules: AnalyzeChunkModuleHint[];
  severity: AnalyzeSeverity;
  confidence: "high";
}

export interface AnalyzeDependencyBloatFinding {
  kind: "dep-artifact";
  fileName: string;
  packageName: string;
  packageVersion: string;
  packageLabel: string;
  bytes: number;
  moduleCount: number;
  edgeCount: number;
  externalCount: number;
  importerCount: number;
  entryRootCount: number;
  usedExportCount: number | null;
  hasNamespace: boolean | null;
  hasExportStar: boolean | null;
  chunkGroup: string | null;
  chunkFiles: string[];
  packFileName: string | null;
  packed: boolean;
  severity: AnalyzeSeverity;
  confidence: AnalyzeCertainty;
}

export interface AnalyzeSuggestion {
  kind: "align-package-versions" | "review-pack-coverage";
  target: string;
  severity: AnalyzeSeverity;
  confidence: AnalyzeCertainty;
  rationale: string;
}

export interface AnalyzeBloatSummary {
  chunks: AnalyzeChunkBloatFinding[];
  dependencies: AnalyzeDependencyBloatFinding[];
}

export interface AnalyzeFindings {
  duplicates: AnalyzeDuplicateFinding[];
  bloat: AnalyzeBloatSummary;
  suggestions: AnalyzeSuggestion[];
}

type DepsRootSelection = {
  depsHash: string;
  depsRoot: string;
  selectionMode: "explicit" | "env" | "single-dir" | "latest-mtime-fallback";
};

type RouteHintStateDisk = {
  version: 1;
  routes: Record<
    string,
    {
      documents?: number;
      assets?: Record<
        string,
        {
          kind?: "dep" | "source";
          requestCount?: number;
          minDepth?: number;
        }
      >;
    }
  >;
};

type BuildManifestChunkModule = {
  id?: string;
  kind?: string;
  deps?: string[];
  dynamicDeps?: string[];
};

type BuildManifestChunk = {
  id?: string;
  entry?: boolean;
  shared?: boolean;
  consumers?: string[];
  modules?: BuildManifestChunkModule[];
  files?: {
    js?: string[];
    css?: string[];
    assets?: string[];
  };
};

type BuildManifestDisk = {
  entries?: string[];
  chunks?: BuildManifestChunk[];
};

type DepUsageDisk = {
  version: 1 | 2;
  depsHash: string;
  deps?: Record<
    string,
    {
      entryPath?: string;
      packageName?: string;
      packageVersion?: string;
      usedExports?: string[];
      hasNamespace?: boolean;
      hasExportStar?: boolean;
      importerKeys?: string[];
      entryRootKeys?: string[];
    }
  >;
};

type DepUsageSummary = {
  fileName: string;
  entryPath: string;
  packageName: string;
  packageVersion: string;
  usedExports: string[];
  hasNamespace: boolean;
  hasExportStar: boolean;
  importerKeys: string[];
  entryRootKeys: string[];
};

type DepsManifestEntrySummary = {
  fileName: string;
  entryPath: string;
  packageLabel: string;
  packageName: string;
  packageVersion: string;
  sizeBytes: number;
  moduleCount: number;
  edgeCount: number;
  externalCount: number;
  chunkGroup: string | null;
  chunkFiles: string[];
};

type VendorPackIndexDisk = {
  version: 1;
  depsHash: string;
  outputVersion?: number;
  packIndexHash?: string | null;
  usageIndexHash?: string | null;
  packFileToChunkFiles?: Record<string, string[]>;
  fileNameToPackFile?: Record<string, string>;
};

const GRAPH_TREE_MAX_DEPTH = 4;
const HEAVY_DEP_SUGGESTION_MIN_BYTES = 50 * 1024;
const HEAVY_DEP_SUGGESTION_MIN_IMPORTERS = 2;

function sectionTitle(label: string): string {
  return chalk.bold.cyan(label);
}

function subSectionTitle(label: string): string {
  return chalk.bold(label);
}

function dimText(value: string): string {
  return chalk.dim(value);
}

function accent(value: string): string {
  return chalk.bold.white(value);
}

function metric(value: string): string {
  return chalk.bold(value);
}

function colorSeverity(severity: AnalyzeSeverity): string {
  switch (severity) {
    case "high":
      return chalk.bold.red("High");
    case "medium":
      return chalk.bold.yellow("Medium");
    case "low":
      return chalk.bold.blue("Low");
  }
}

function colorConfidence(confidence: AnalyzeCertainty): string {
  switch (confidence) {
    case "high":
      return chalk.bold.green("High");
    case "medium":
      return chalk.bold.yellow("Medium");
    case "low":
      return chalk.bold.gray("Low");
  }
}

function colorHealth(level: AnalyzeHealthLevel | AnalyzeRouteVisibility): string {
  switch (level) {
    case "high":
    case "present":
      return chalk.bold.green(formatHealth(level));
    case "medium":
      return chalk.bold.yellow(formatHealth(level));
    case "low":
      return chalk.bold.blue(formatHealth(level));
    case "missing":
      return chalk.bold.red(formatHealth(level));
  }
}

function bullet(value: string): string {
  return `  ${chalk.gray("•")} ${value}`;
}

function compareSeverity(a: AnalyzeSeverity, b: AnalyzeSeverity): number {
  const rank = { high: 3, medium: 2, low: 1 } as const;
  return rank[b] - rank[a];
}

function compareCertainty(a: AnalyzeCertainty, b: AnalyzeCertainty): number {
  const rank = { high: 3, medium: 2, low: 1 } as const;
  return rank[b] - rank[a];
}

function classifyDuplicateSeverity(versionCount: number, totalDepArtifacts: number): AnalyzeSeverity {
  if (versionCount >= 3 || totalDepArtifacts >= 6) return "high";
  if (versionCount >= 2) return "medium";
  return "low";
}

function classifyChunkSeverity(totalBytes: number, shared: boolean): AnalyzeSeverity {
  if (shared && totalBytes >= 5 * 1024 * 1024) return "high";
  if (!shared && totalBytes >= 2 * 1024 * 1024) return "high";
  if (shared && totalBytes >= 1 * 1024 * 1024) return "medium";
  if (!shared && totalBytes >= 512 * 1024) return "medium";
  return "low";
}

function classifyDependencySeverity(
  bytes: number,
  importerCount: number,
  entryRootCount: number,
  packed: boolean,
): AnalyzeSeverity {
  const reach = Math.max(importerCount, entryRootCount);
  if (!packed && bytes >= 512 * 1024) return "high";
  if (!packed && bytes >= 128 * 1024 && reach >= 2) return "medium";
  if (packed && bytes >= 512 * 1024) return "medium";
  return "low";
}

function resolveAnalyzeEntryFromHtmlInput(htmlInput: string, rootDir: string, specifier: string): string | null {
  if (typeof specifier !== "string" || specifier.length === 0) return null;
  if (/^(?:https?:)?\/\//.test(specifier)) return null;
  const withoutHash = specifier.split("#", 1)[0] ?? specifier;
  const withoutQuery = withoutHash.split("?", 1)[0] ?? withoutHash;
  if (!withoutQuery) return null;

  if (withoutQuery.startsWith("/")) {
    return path.join(rootDir, withoutQuery);
  }

  return path.resolve(path.dirname(htmlInput), withoutQuery);
}

function inferAnalyzeEntriesFromHtml(rootDir: string): string[] {
  const htmlInput = path.join(rootDir, "index.html");
  if (!fs.existsSync(htmlInput)) return [];

  let html = "";
  try {
    html = fs.readFileSync(htmlInput, "utf8");
  } catch {
    return [];
  }

  const moduleScriptRe =
    /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi;
  const entries: string[] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(moduleScriptRe)) {
    const src = typeof match[1] === "string" ? match[1] : "";
    const resolved = resolveAnalyzeEntryFromHtmlInput(htmlInput, rootDir, src);
    if (!resolved || !fs.existsSync(resolved) || seen.has(resolved)) continue;
    seen.add(resolved);
    entries.push(resolved);
  }

  return entries;
}

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function statSize(filePath: string): number | null {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

function normalizeUrlPath(value: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "";
  const queryIndex = trimmed.indexOf("?");
  const hashIndex = trimmed.indexOf("#");
  let end = trimmed.length;
  if (queryIndex >= 0) end = Math.min(end, queryIndex);
  if (hashIndex >= 0) end = Math.min(end, hashIndex);
  return trimmed.slice(0, end);
}

function getDepFileNameFromUrl(url: string): string | null {
  const normalized = normalizeUrlPath(url);
  if (!normalized.startsWith("/@deps/")) return null;
  const fileName = normalized.slice("/@deps/".length);
  return fileName && fileName.endsWith(".js") ? fileName : null;
}

function resolveRouteSourceAssetPath(projectRoot: string, url: string): string | null {
  const normalized = normalizeUrlPath(url);
  if (!normalized.startsWith("/")) return null;
  const relative = normalized.slice(1);
  if (!relative) return null;
  return path.join(projectRoot, relative);
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "n/a";
  const value = Math.max(0, Math.floor(bytes));
  if (value < 1024) return `${value}B`;
  const kb = value / 1024;
  if (kb < 1024) return `${Math.round(kb)}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)}GB`;
}

function loadVendorPackRoutingIndex(depsRoot: string, depsHash: string): VendorPackIndexDisk | null {
  const index = readJson<VendorPackIndexDisk>(path.join(depsRoot, "vendor-pack.v2.index.json"));
  if (!index || index.version !== 1 || index.depsHash !== depsHash) return null;
  return index;
}

function getSelectedSurfaces(options: AnalyzeOptions): AnalyzeSurface[] {
  if (options.section) {
    switch (options.section) {
      case "graph":
        return ["graph"];
      case "build":
        return ["build", "findings"];
      case "deps":
        return ["findings"];
      case "packs":
        return ["packs", "findings"];
      case "routes":
        return ["routes"];
      case "findings":
        return ["findings"];
      default:
        return [options.section];
    }
  }

  const selected: AnalyzeSurface[] = [];
  if (options.graph || options.tree || options.deps) selected.push("graph");
  if (options.build) selected.push("build");
  if (options.packs) selected.push("packs");
  if (options.routes) selected.push("routes");
  if (options.findings) selected.push("findings");
  return selected.length > 0 ? selected : ["graph", "build", "packs", "routes", "findings"];
}

function listDepsRootCandidates(
  ionifyDir: string,
): Array<{
  depsHash: string;
  depsRoot: string;
  mtimeMs: number;
  completeness: number;
}> {
  const depsDir = path.join(ionifyDir, "deps");
  if (!fs.existsSync(depsDir)) return [];
  return fs
    .readdirSync(depsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const depsHash = entry.name;
      const depsRoot = path.join(depsDir, depsHash);
      const indexPath = path.join(depsRoot, "vendor-pack.v2.index.json");
      const manifestPath = path.join(depsRoot, "manifest.json");
      const usagePath = path.join(depsRoot, "deps-usage.v2.json");
      const legacyUsagePath = path.join(depsRoot, "deps-usage.v1.json");
      const statPath = fs.existsSync(indexPath) ? indexPath : depsRoot;
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(statPath).mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      const completeness =
        Number(fs.existsSync(indexPath)) +
        Number(fs.existsSync(manifestPath)) +
        Number(fs.existsSync(usagePath) || fs.existsSync(legacyUsagePath));
      return { depsHash, depsRoot, mtimeMs, completeness };
    })
    .sort((a, b) => b.completeness - a.completeness || b.mtimeMs - a.mtimeMs || a.depsHash.localeCompare(b.depsHash));
}

export function selectDepsRoot(
  ionifyDir: string,
  depsHash?: string | null,
  envDepsHash?: string | null,
): DepsRootSelection | null {
  const candidates = listDepsRootCandidates(ionifyDir);
  if (candidates.length === 0) return null;

  const explicit = typeof depsHash === "string" && depsHash.trim().length > 0 ? depsHash.trim() : null;
  if (explicit) {
    const match = candidates.find((item) => item.depsHash === explicit);
    if (match) return { depsHash: match.depsHash, depsRoot: match.depsRoot, selectionMode: "explicit" };
  }

  const env = typeof envDepsHash === "string" && envDepsHash.trim().length > 0 ? envDepsHash.trim() : null;
  if (env) {
    const match = candidates.find((item) => item.depsHash === env);
    if (match) return { depsHash: match.depsHash, depsRoot: match.depsRoot, selectionMode: "env" };
  }

  if (candidates.length === 1) {
    const only = candidates[0];
    return { depsHash: only.depsHash, depsRoot: only.depsRoot, selectionMode: "single-dir" };
  }

  const best = candidates[0];
  return best
    ? { depsHash: best.depsHash, depsRoot: best.depsRoot, selectionMode: "latest-mtime-fallback" }
    : null;
}

function computeInboundCounts(nodes: GraphNodeSummary[]): Map<string, number> {
  const dependentCounts = new Map<string, number>();
  for (const node of nodes) {
    for (const dep of node.deps) {
      dependentCounts.set(dep, (dependentCounts.get(dep) ?? 0) + 1);
    }
  }
  return dependentCounts;
}

function buildGraphTree(
  nodesById: Map<string, GraphNodeSummary>,
  roots: string[],
  limit: number,
  maxDepth = GRAPH_TREE_MAX_DEPTH,
): GraphTreeNode[] {
  const childLimit = Math.max(1, limit);

  const visit = (id: string, depth: number, stack: Set<string>): GraphTreeNode => {
    const node = nodesById.get(id);
    const deps = node?.deps ?? [];
    const summary: GraphTreeNode = {
      id,
      depCount: deps.length,
    };

    if (depth >= maxDepth || deps.length === 0) {
      if (deps.length > 0 && depth >= maxDepth) summary.truncated = true;
      return summary;
    }

    const sortedDeps = deps.slice().sort();
    const limitedDeps = sortedDeps.slice(0, childLimit);
    const nextStack = new Set(stack);
    nextStack.add(id);
    summary.deps = limitedDeps.map((depId) => {
      if (stack.has(depId)) {
        return {
          id: depId,
          depCount: nodesById.get(depId)?.deps.length ?? 0,
          cycle: true,
        };
      }
      return visit(depId, depth + 1, nextStack);
    });
    if (sortedDeps.length > limitedDeps.length) summary.truncated = true;
    return summary;
  };

  return roots.slice(0, Math.max(1, limit)).map((root) => visit(root, 0, new Set<string>()));
}

export function computeGraphSummary(
  nodes: GraphNodeSummary[],
  limit = 10,
  includeTree = false,
): GraphAnalyzeSummary {
  const modules = nodes.length;
  let edgeCount = 0;
  const dependentCounts = computeInboundCounts(nodes);
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));

  for (const node of nodes) {
    edgeCount += node.deps.length;
  }

  const densest = [...nodes]
    .sort((a, b) => b.deps.length - a.deps.length || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((node) => ({ id: node.id, deps: node.deps.length }));

  const mostDepended = [...dependentCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id, count]) => ({ id, dependents: count }));

  const orphanSet = new Set(nodes.map((n) => n.id));
  for (const node of nodes) {
    for (const dep of node.deps) orphanSet.delete(dep);
  }
  const roots = Array.from(orphanSet).sort();

  return {
    modules,
    edges: edgeCount,
    averageDeps: modules === 0 ? 0 : edgeCount / modules,
    roots,
    densest,
    mostDepended,
    orphans: roots,
    tree: includeTree ? buildGraphTree(nodesById, roots, limit) : undefined,
  };
}

function readGraphFromDisk(ionifyDir: string): GraphNodeSummary[] | null {
  const file = path.join(ionifyDir, "graph.json");
  if (!fs.existsSync(file)) return null;
  try {
    const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
    if (snapshot?.version !== 1 || !snapshot?.nodes) return null;
    return Object.entries<Record<string, any>>(snapshot.nodes).map(([id, node]) => ({
      id,
      hash: node.hash ?? null,
      deps: Array.isArray(node.deps) ? node.deps : [],
    }));
  } catch (err) {
    logError("Failed to read graph snapshot", err);
    return null;
  }
}

async function loadGraphSnapshot(ionifyDir: string): Promise<GraphNodeSummary[] | null> {
  if (native?.graphLoad) {
    try {
      const nodes = native.graphLoad();
      if (Array.isArray(nodes)) {
        return nodes.map((node) => ({
          id: node.id,
          hash: node.hash ?? null,
          deps: Array.isArray(node.deps) ? node.deps : [],
        }));
      }
    } catch {
      // Fall back to disk snapshot without polluting JSON output.
    }
  }
  return readGraphFromDisk(ionifyDir);
}

async function resolveAnalyzeWorkspace(): Promise<ReturnType<typeof resolveWorkspace>> {
  const envMode = process.env.IONIFY_MODE ?? process.env.MODE ?? process.env.NODE_ENV ?? "development";
  const config = await loadIonifyConfig(process.cwd(), envMode);
  const projectRootOverride = config?.root ? path.resolve(config.root) : null;
  const workspace = resolveWorkspace(projectRootOverride ?? process.cwd(), {
    projectRootOverride,
  });
  const rootDir = workspace.projectRoot;

  const parserMode = resolveParser(config, { envMode: process.env.IONIFY_PARSER });
  applyParserEnv(parserMode);
  const minifier = resolveMinifier(config, { envVar: process.env.IONIFY_MINIFIER });
  const treeshake = resolveTreeshake(config?.treeshake, {
    envMode: process.env.IONIFY_TREESHAKE,
    includeEnv: process.env.IONIFY_TREESHAKE_INCLUDE,
    excludeEnv: process.env.IONIFY_TREESHAKE_EXCLUDE,
  });
  const scopeHoist = resolveScopeHoist(config?.scopeHoist, {
    envMode: process.env.IONIFY_SCOPE_HOIST,
    inlineEnv: process.env.IONIFY_SCOPE_HOIST_INLINE,
    constantEnv: process.env.IONIFY_SCOPE_HOIST_CONST,
    combineEnv: process.env.IONIFY_SCOPE_HOIST_COMBINE,
  });

  const configuredEntries = config?.entry
    ? (Array.isArray(config.entry) ? config.entry : [config.entry])
        .map((entry) => (entry.startsWith("/") ? path.join(rootDir, entry) : path.resolve(rootDir, entry)))
        .filter((entry) => typeof entry === "string" && entry.length > 0)
    : [];
  const entries = configuredEntries.length > 0 ? configuredEntries : inferAnalyzeEntriesFromHtml(rootDir);
  const pluginNames = Array.isArray(config?.plugins)
    ? config.plugins
        .map((plugin: any) => (typeof plugin === "string" ? plugin : plugin?.name))
        .filter((name): name is string => typeof name === "string" && name.length > 0)
    : undefined;

  const configHash = computeGraphVersion({
    parserMode,
    minifier,
    treeshake,
    scopeHoist,
    plugins: pluginNames,
    entry: entries.length > 0 ? entries : null,
    cssOptions: (config as any)?.css,
    assetOptions: (config as any)?.assets ?? (config as any)?.asset,
    runtimeContracts: {
      reactRefreshRuntimeModule: REACT_REFRESH_RUNTIME_MODULE,
    },
  });

  process.env.IONIFY_CONFIG_HASH = configHash;
  ensureNativeGraph(path.join(workspace.ionifyDir, "graph.db"), configHash);

  return workspace;
}

export function summarizeBuildOutputs(
  outDir: string,
  limit: number,
): BuildAnalyzeSummary | null {
  const absOutDir = path.resolve(outDir);
  const manifestPath = path.join(absOutDir, "manifest.json");
  const statsPath = path.join(absOutDir, "build.stats.json");
  const manifest = readJson<any>(manifestPath);
  const stats = readJson<Record<string, any>>(statsPath);
  if (!manifest && !stats) return null;

  const chunkEntries = Array.isArray(manifest?.chunks) ? manifest.chunks : [];
  const topFiles: BuildTopFile[] = [];
  const files = {
    js: 0,
    css: 0,
    assets: 0,
    maps: 0,
    publicAssets: 0,
    totalTracked: 0,
  };
  const bytes = {
    js: 0,
    css: 0,
    assets: 0,
    maps: 0,
    publicAssets: 0,
    totalTracked: 0,
  };

  if (stats && typeof stats === "object") {
    for (const [file, meta] of Object.entries(stats)) {
      if (file === "publicAssets" || file.startsWith("__")) continue;
      if (!meta || typeof meta !== "object") continue;
      const type = typeof meta.type === "string" ? meta.type : "unknown";
      const size = typeof meta.bytes === "number" && Number.isFinite(meta.bytes) ? meta.bytes : 0;
      files.totalTracked += 1;
      bytes.totalTracked += size;
      if (type === "js") {
        files.js += 1;
        bytes.js += size;
      } else if (type === "css") {
        files.css += 1;
        bytes.css += size;
      } else if (type === "asset") {
        files.assets += 1;
        bytes.assets += size;
      } else if (type === "map") {
        files.maps += 1;
        bytes.maps += size;
      }
      topFiles.push({ file, bytes: size, type });
    }

    const publicAssets = Array.isArray((stats as any).publicAssets) ? (stats as any).publicAssets : [];
    for (const asset of publicAssets) {
      const file = typeof asset?.file === "string" ? asset.file : null;
      const size = typeof asset?.bytes === "number" && Number.isFinite(asset.bytes) ? asset.bytes : 0;
      if (!file) continue;
      files.publicAssets += 1;
      bytes.publicAssets += size;
      topFiles.push({ file, bytes: size, type: "public-asset" });
    }
  }

  topFiles.sort((a, b) => b.bytes - a.bytes || a.file.localeCompare(b.file));

  return {
    outDir: absOutDir,
    hasManifest: !!manifest,
    hasStats: !!stats,
    entries: Array.isArray(manifest?.entries) ? manifest.entries.length : 0,
    chunks: {
      total: chunkEntries.length,
      entry: chunkEntries.filter((chunk: any) => chunk?.entry === true).length,
      shared: chunkEntries.filter((chunk: any) => chunk?.shared === true).length,
    },
    files,
    bytes,
    topFiles: topFiles.slice(0, Math.max(1, limit)),
  };
}

function analyzeVendorPacks(
  depsRoot: string,
  depsHash: string,
  selectionMode: DepsRootSelection["selectionMode"],
  limit: number,
): VendorPackAnalyzeSummary | null {
  const index = loadVendorPackRoutingIndex(depsRoot, depsHash);
  if (!index) return null;

  const derivedPackIndexHash =
    typeof index.outputVersion === "number" ? hashVendorPackV2RoutingIndex(index, depsHash, index.outputVersion) : null;
  const packIndexHash = typeof index.packIndexHash === "string" ? index.packIndexHash : derivedPackIndexHash;
  const usageIndexHash = typeof index.usageIndexHash === "string" ? index.usageIndexHash : null;
  const routing: Record<string, string> =
    index.fileNameToPackFile && typeof index.fileNameToPackFile === "object" ? index.fileNameToPackFile : {};
  const packToChunks: Record<string, string[]> =
    index.packFileToChunkFiles && typeof index.packFileToChunkFiles === "object" ? index.packFileToChunkFiles : {};

  const membersByPack = new Map<string, string[]>();
  for (const [fileName, packFileName] of Object.entries(routing)) {
    if (typeof fileName !== "string" || typeof packFileName !== "string") continue;
    const list = membersByPack.get(packFileName) ?? [];
    list.push(fileName);
    membersByPack.set(packFileName, list);
  }

  const packs: VendorPackAnalyzePack[] = [];
  for (const [packFileName, members] of membersByPack.entries()) {
    const chunkFilesRaw = Array.isArray(packToChunks[packFileName]) ? packToChunks[packFileName] : [];
    const chunkFiles = chunkFilesRaw.filter((v) => typeof v === "string" && v.endsWith(".js"));
    const uniqueChunks = Array.from(new Set(chunkFiles)).sort();
    const requestsPacked = 1 + uniqueChunks.length;
    const requestsUnpacked = members.length;
    const requestsSaved = Math.max(0, requestsUnpacked - requestsPacked);

    const packBytes = statSize(path.join(depsRoot, packFileName));
    let chunksBytes = 0;
    let chunksKnown = true;
    for (const chunk of uniqueChunks) {
      const b = statSize(path.join(depsRoot, chunk));
      if (b === null) chunksKnown = false;
      chunksBytes += b ?? 0;
    }
    const bytesPacked = packBytes === null || !chunksKnown ? null : packBytes + chunksBytes;

    let wrappersBytes = 0;
    let wrappersKnown = true;
    for (const fileName of members) {
      const b = statSize(path.join(depsRoot, fileName));
      if (b === null) wrappersKnown = false;
      wrappersBytes += b ?? 0;
    }
    const bytesWrappers = wrappersKnown ? wrappersBytes : null;

    packs.push({
      packFileName,
      members: members.length,
      chunkFiles: uniqueChunks,
      requestsPacked,
      requestsUnpacked,
      requestsSaved,
      bytesPacked,
      bytesWrappers,
    });
  }

  packs.sort((a, b) => b.requestsSaved - a.requestsSaved || b.members - a.members || a.packFileName.localeCompare(b.packFileName));

  const slimGroups: VendorPackAnalyzeSlimGroup[] = [];
  const files = fs.existsSync(depsRoot) ? fs.readdirSync(depsRoot) : [];
  const stateFiles = files.filter((f) => f.startsWith("vendor-pack.") && f.endsWith(".json"));
  for (const file of stateFiles) {
    if (file.endsWith(".slim.json")) continue;
    const base = readJson<any>(path.join(depsRoot, file));
    if (!base || base.version !== 1 || base.depsHash !== depsHash) continue;
    const slimFile = file.replace(/\.json$/, ".slim.json");
    const slim = readJson<any>(path.join(depsRoot, slimFile));
    if (!slim || slim.version !== 1 || slim.depsHash !== depsHash) continue;
    if (base.status !== "ready" || slim.status !== "ready") continue;
    const baseShared = typeof base.sharedFileName === "string" ? base.sharedFileName : null;
    const slimShared = typeof slim.sharedFileName === "string" ? slim.sharedFileName : null;
    const baseBytes = baseShared ? statSize(path.join(depsRoot, baseShared)) : null;
    const slimBytes = slimShared ? statSize(path.join(depsRoot, slimShared)) : null;
    const savedBytes =
      baseBytes !== null && slimBytes !== null && baseBytes > 0 && slimBytes > 0 ? baseBytes - slimBytes : null;
    const label = file.replace(/^vendor-pack\./, "").replace(/\.json$/, "");
    slimGroups.push({ label, baseSharedBytes: baseBytes, slimSharedBytes: slimBytes, savedBytes });
  }

  slimGroups.sort((a, b) => (b.savedBytes ?? -1) - (a.savedBytes ?? -1) || a.label.localeCompare(b.label));

  return {
    depsHash,
    depsRoot,
    selectionMode,
    packIndexHash,
    usageIndexHash,
    packs: packs.slice(0, Math.max(1, limit)),
    slimGroups: slimGroups.slice(0, Math.max(1, limit)),
  };
}

function buildRouteFirstRouteBytes(
  projectRoot: string,
  routeAssets: Array<{ url: string; kind: "dep" | "source"; requestCount: number }>,
  depsSelection?: DepsRootSelection | null,
): RouteAnalyzeFirstRouteBytes | null {
  if (!projectRoot || routeAssets.length === 0) return null;

  let depObservedBytes = 0;
  let sourceObservedBytes = 0;
  let observedAssets = 0;
  let unresolvedAssets = 0;

  for (const asset of routeAssets) {
    let bytes: number | null = null;
    if (asset.kind === "dep") {
      const fileName = getDepFileNameFromUrl(asset.url);
      if (fileName && depsSelection) {
        bytes = statSize(path.join(depsSelection.depsRoot, fileName));
      }
    } else {
      const filePath = resolveRouteSourceAssetPath(projectRoot, asset.url);
      if (filePath) bytes = statSize(filePath);
    }

    if (bytes === null) {
      unresolvedAssets += 1;
      continue;
    }

    observedAssets += 1;
    if (asset.kind === "dep") depObservedBytes += bytes;
    else sourceObservedBytes += bytes;
  }

  return {
    totalObservedBytes: depObservedBytes + sourceObservedBytes,
    depObservedBytes,
    sourceObservedBytes,
    observedAssets,
    unresolvedAssets,
  };
}

function buildRoutePackCoverage(options: {
  routeAssets: Array<{ url: string; kind: "dep" | "source"; requestCount: number; minDepth: number }>;
  depsSelection?: DepsRootSelection | null;
  limit: number;
}): {
  packCoverage: RouteAnalyzePackCoverage | null;
  uncoveredHotDeps: RouteAnalyzeUncoveredHotDep[];
  signals: RouteAnalyzeHistorySignals;
} {
  const { routeAssets, depsSelection, limit } = options;
  const depAssets = routeAssets.filter((asset) => asset.kind === "dep");
  if (!depsSelection) {
    return {
      packCoverage: null,
      uncoveredHotDeps: [],
      signals: {
        routeHints: true,
        depUsage: false,
        packRouting: false,
        manifestOwnership: false,
      },
    };
  }

  const depUsageIndex = loadDepUsageIndex(depsSelection.depsRoot, depsSelection.depsHash);
  const depsManifestIndex = loadDepsManifestIndex(depsSelection.depsRoot);
  const routingIndex = loadVendorPackRoutingIndex(depsSelection.depsRoot, depsSelection.depsHash);
  const fileNameToPackFile =
    routingIndex?.fileNameToPackFile && typeof routingIndex.fileNameToPackFile === "object"
      ? routingIndex.fileNameToPackFile
      : {};
  const packFileToChunkFiles =
    routingIndex?.packFileToChunkFiles && typeof routingIndex.packFileToChunkFiles === "object"
      ? routingIndex.packFileToChunkFiles
      : {};

  const routeDepWrappers = depAssets
    .map((asset) => {
      const fileName = getDepFileNameFromUrl(asset.url);
      if (!fileName) return null;
      if (!depsManifestIndex.has(fileName) && !depUsageIndex?.has(fileName)) return null;
      return { ...asset, fileName };
    })
    .filter((asset): asset is { url: string; kind: "dep"; requestCount: number; minDepth: number; fileName: string } => !!asset);

  if (routeDepWrappers.length === 0) {
    return {
      packCoverage: {
        totalDepAssets: 0,
        coveredDepAssets: 0,
        uncoveredDepAssets: 0,
        coverageRate: null,
        estimatedCurrentRequests: 0,
        estimatedPackedRequests: 0,
        estimatedRequestsSaved: 0,
      },
      uncoveredHotDeps: [],
      signals: {
        routeHints: true,
        depUsage: !!depUsageIndex,
        packRouting: !!routingIndex,
        manifestOwnership: depsManifestIndex.size > 0,
      },
    };
  }

  const uniqueCurrentFiles = new Set<string>();
  const uniquePackRequests = new Set<string>();
  const uncoveredHotDeps: RouteAnalyzeUncoveredHotDep[] = [];
  let coveredDepAssets = 0;
  let uncoveredDepAssets = 0;

  for (const asset of routeDepWrappers) {
    uniqueCurrentFiles.add(asset.fileName);
    const packFileName = fileNameToPackFile[asset.fileName];
    if (typeof packFileName === "string" && packFileName.length > 0) {
      coveredDepAssets += 1;
      uniquePackRequests.add(packFileName);
      const chunkFiles = Array.isArray(packFileToChunkFiles[packFileName]) ? packFileToChunkFiles[packFileName] : [];
      for (const chunkFile of chunkFiles) {
        if (typeof chunkFile === "string" && chunkFile.endsWith(".js")) uniquePackRequests.add(chunkFile);
      }
      continue;
    }

    uncoveredDepAssets += 1;
    const manifestEntry = depsManifestIndex.get(asset.fileName);
    const usageEntry = depUsageIndex?.get(asset.fileName);
    const bytes = manifestEntry?.sizeBytes ?? statSize(path.join(depsSelection.depsRoot, asset.fileName));
    const packageLabel =
      manifestEntry?.packageLabel ??
      (usageEntry ? `${usageEntry.packageName}@${usageEntry.packageVersion}` : null);

    uncoveredHotDeps.push({
      url: asset.url,
      fileName: asset.fileName,
      packageLabel,
      totalRequestCount: asset.requestCount,
      routeRequestCount: asset.requestCount,
      minDepth: asset.minDepth,
      bytes,
      importers: usageEntry?.importerKeys.length ?? 0,
      entryRoots: usageEntry?.entryRootKeys.length ?? 0,
    });
  }

  uncoveredHotDeps.sort(
    (a, b) =>
      b.routeRequestCount - a.routeRequestCount ||
      a.minDepth - b.minDepth ||
      (b.bytes ?? -1) - (a.bytes ?? -1) ||
      a.fileName.localeCompare(b.fileName),
  );

  const estimatedCurrentRequests = uniqueCurrentFiles.size;
  const estimatedPackedRequests = uncoveredDepAssets + uniquePackRequests.size;
  return {
    packCoverage: {
      totalDepAssets: routeDepWrappers.length,
      coveredDepAssets,
      uncoveredDepAssets,
      coverageRate: routeDepWrappers.length > 0 ? coveredDepAssets / routeDepWrappers.length : null,
      estimatedCurrentRequests,
      estimatedPackedRequests,
      estimatedRequestsSaved: Math.max(0, estimatedCurrentRequests - estimatedPackedRequests),
    },
    uncoveredHotDeps: uncoveredHotDeps.slice(0, Math.max(1, limit)),
    signals: {
      routeHints: true,
      depUsage: !!depUsageIndex,
      packRouting: !!routingIndex,
      manifestOwnership: depsManifestIndex.size > 0,
    },
  };
}

function buildRoutePolicyVisibility(options: {
  primaryRouteKey: string | null;
  routeAssets: Array<{ url: string; kind: "dep" | "source"; requestCount: number; minDepth: number }>;
  suggestedPreloads: RouteAnalyzePreloadSummary[];
  packCoverage: RouteAnalyzePackCoverage | null;
  signals: RouteAnalyzeHistorySignals;
}): RouteAnalyzePolicyVisibility {
  const { primaryRouteKey, routeAssets, suggestedPreloads, packCoverage, signals } = options;
  let criticalAssets = 0;
  let deferredAssets = 0;
  let criticalRequests = 0;
  let deferredRequests = 0;

  for (const asset of routeAssets) {
    if (asset.minDepth <= 1) {
      criticalAssets += 1;
      criticalRequests += asset.requestCount;
    } else {
      deferredAssets += 1;
      deferredRequests += asset.requestCount;
    }
  }

  const currentEffects: string[] = [];
  if (primaryRouteKey && suggestedPreloads.length > 0) {
    currentEffects.push(
      `Route hints currently influence preload selection for ${primaryRouteKey} (${suggestedPreloads.length} candidate${suggestedPreloads.length === 1 ? "" : "s"}).`,
    );
  }
  if (packCoverage && packCoverage.totalDepAssets > 0) {
    currentEffects.push(
      `Vendor-pack routing currently covers ${packCoverage.coveredDepAssets}/${packCoverage.totalDepAssets} primary-route dep artifacts.`,
    );
    currentEffects.push(
      `Estimated route dep requests drop from ${packCoverage.estimatedCurrentRequests ?? 0} to ${packCoverage.estimatedPackedRequests ?? 0} when current routing applies.`,
    );
  }
  if (signals.depUsage) {
    currentEffects.push("Dep-usage evidence is available for route dependency explainability.");
  }

  return {
    signals,
    currentEffects,
    entryCriticalEvidence:
      routeAssets.length > 0
        ? {
            criticalAssets,
            deferredAssets,
            criticalRequests,
            deferredRequests,
          }
        : null,
    policyReuse: {
      status: "unavailable",
      reason: "Planner-owned history policy hashing is not implemented yet, so reuse vs recompute is not observable.",
    },
    missingCapabilities: [
      "Route history currently influences preload/modulepreload selection, not full history-aware chunk membership.",
      "Entry-critical vs deferred is derived from route-hint minDepth only and is not a planner-owned chunk policy verdict.",
      "Planner-owned policy reuse reporting is not available until a versioned history policy layer exists.",
    ],
  };
}

export function summarizeRoutes(
  routeHintStatePath: string,
  limit: number,
  options?: {
    projectRoot?: string;
    depsSelection?: DepsRootSelection | null;
  },
): RouteAnalyzeSummary | null {
  if (!fs.existsSync(routeHintStatePath)) return null;
  const raw = readJson<RouteHintStateDisk>(routeHintStatePath);
  if (!raw || raw.version !== 1 || !raw.routes || typeof raw.routes !== "object") return null;

  const index = new RouteHintIndex(routeHintStatePath);
  const primaryRouteKey = index.getPrimaryRouteKey();
  const routeEntries = Object.entries(raw.routes).map(([routeKey, route]) => {
    const assets = route?.assets && typeof route.assets === "object" ? route.assets : {};
    let depAssets = 0;
    let sourceAssets = 0;
    let totalRequests = 0;
    for (const asset of Object.values(assets)) {
      const requestCount =
        typeof asset?.requestCount === "number" && Number.isFinite(asset.requestCount) ? Math.floor(asset.requestCount) : 0;
      totalRequests += requestCount;
      if (asset?.kind === "dep") depAssets += 1;
      else if (asset?.kind === "source") sourceAssets += 1;
    }
    return {
      routeKey,
      documents:
        typeof route?.documents === "number" && Number.isFinite(route.documents) ? Math.floor(route.documents) : 0,
      totalAssets: depAssets + sourceAssets,
      depAssets,
      sourceAssets,
      totalRequests,
    } satisfies RouteAnalyzeRouteSummary;
  });

  routeEntries.sort((a, b) => b.documents - a.documents || b.totalRequests - a.totalRequests || a.routeKey.localeCompare(b.routeKey));

  const topDepAssets = index
    .summarizeAssets("dep")
    .slice(0, Math.max(1, limit))
    .map((item) => ({
      url: item.url,
      kind: item.kind,
      totalRequestCount: item.totalRequestCount,
      minDepth: item.minDepth,
      routeKeys: item.routeKeys,
    })) satisfies RouteAnalyzeAssetSummary[];

  const topSourceAssets = index
    .summarizeAssets("source")
    .slice(0, Math.max(1, limit))
    .map((item) => ({
      url: item.url,
      kind: item.kind,
      totalRequestCount: item.totalRequestCount,
      minDepth: item.minDepth,
      routeKeys: item.routeKeys,
    })) satisfies RouteAnalyzeAssetSummary[];

  const suggestedPreloads = index.selectPreloads(primaryRouteKey, {
    maxEntries: Math.max(1, limit),
    maxDepEntries: Math.max(1, limit),
    maxSourceEntries: Math.max(1, limit),
    minRequestCount: 1,
  });

  const normalizedPrimaryRouteKey = primaryRouteKey ? normalizeDocumentRouteKey(primaryRouteKey) : null;
  const primaryRouteRaw =
    normalizedPrimaryRouteKey && raw.routes[normalizedPrimaryRouteKey] ? raw.routes[normalizedPrimaryRouteKey] : null;
  const primaryRouteAssets = primaryRouteRaw?.assets && typeof primaryRouteRaw.assets === "object" ? primaryRouteRaw.assets : {};
  const primaryRouteAssetEntries: Array<{ url: string; kind: "dep" | "source"; requestCount: number; minDepth: number }> =
    Object.entries(primaryRouteAssets)
    .map(([url, asset]) => ({
      url,
      kind: asset?.kind === "dep" ? ("dep" as const) : ("source" as const),
      requestCount:
        typeof asset?.requestCount === "number" && Number.isFinite(asset.requestCount) ? Math.floor(asset.requestCount) : 0,
      minDepth:
        typeof asset?.minDepth === "number" && Number.isFinite(asset.minDepth) && asset.minDepth >= 0
          ? Math.floor(asset.minDepth)
          : 0,
    }))
    .filter((asset) => asset.requestCount > 0)
    .sort((a, b) => b.requestCount - a.requestCount || a.minDepth - b.minDepth || a.url.localeCompare(b.url));

  const firstRouteBytes =
    options?.projectRoot && normalizedPrimaryRouteKey
      ? buildRouteFirstRouteBytes(options.projectRoot, primaryRouteAssetEntries, options.depsSelection)
      : null;
  const coverage = buildRoutePackCoverage({
    routeAssets: primaryRouteAssetEntries,
    depsSelection: options?.depsSelection,
    limit,
  });
  const policyVisibility = buildRoutePolicyVisibility({
    primaryRouteKey: normalizedPrimaryRouteKey,
    routeAssets: primaryRouteAssetEntries,
    suggestedPreloads,
    packCoverage: coverage.packCoverage,
    signals: coverage.signals,
  });

  return {
    statePath: routeHintStatePath,
    primaryRouteKey,
    routeCount: routeEntries.length,
    routes: routeEntries.slice(0, Math.max(1, limit)),
    topDepAssets,
    topSourceAssets,
    suggestedPreloads,
    firstRouteBytes,
    packCoverage: coverage.packCoverage,
    uncoveredHotDeps: coverage.uncoveredHotDeps,
    policyVisibility,
  };
}

function uniqueSorted(values: string[]): string[] {
  const out = values.filter((value) => typeof value === "string" && value.length > 0).slice().sort();
  return out.filter((value, index) => index === 0 || out[index - 1] !== value);
}

function parsePackageLabel(label: string): { packageName: string; packageVersion: string } | null {
  if (typeof label !== "string" || label.length === 0) return null;
  const at = label.lastIndexOf("@");
  if (at <= 0 || at === label.length - 1) return null;
  const packageName = label.slice(0, at);
  const packageVersion = label.slice(at + 1);
  if (!packageName || !packageVersion) return null;
  return { packageName, packageVersion };
}

const packageVersionCache = new Map<string, string | null>();

function readPackageVersion(packageRoot: string): string | null {
  const normalizedRoot = path.resolve(packageRoot);
  if (packageVersionCache.has(normalizedRoot)) {
    return packageVersionCache.get(normalizedRoot) ?? null;
  }
  const manifest = readJson<{ version?: string }>(path.join(normalizedRoot, "package.json"));
  const version = typeof manifest?.version === "string" && manifest.version.length > 0 ? manifest.version : null;
  packageVersionCache.set(normalizedRoot, version);
  return version;
}

function extractPackageIdentityFromModuleId(moduleId: string): { packageName: string; packageVersion: string } | null {
  const fsPath = moduleId.startsWith("ws://") ? moduleId.slice("ws://".length) : moduleId;
  const marker = `${path.sep}node_modules${path.sep}`;
  const idx = fsPath.lastIndexOf(marker);
  if (idx < 0) return null;

  const packageRootBase = fsPath.slice(0, idx + marker.length);
  const after = fsPath.slice(idx + marker.length);
  const parts = after.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return null;

  const packageName =
    parts[0].startsWith("@") && parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
  if (!packageName) return null;

  const pnpmMarker = `${path.sep}.pnpm${path.sep}`;
  const pnpmIdx = fsPath.indexOf(pnpmMarker);
  if (pnpmIdx >= 0) {
    const segment = fsPath.slice(pnpmIdx + pnpmMarker.length).split(/[\\/]/, 1)[0] ?? "";
    const encodedName = packageName.replace(/\//g, "+");
    if (segment.startsWith(`${encodedName}@`)) {
      const version = segment.slice(encodedName.length + 1).split("_", 1)[0] ?? "";
      if (version) return { packageName, packageVersion: version };
    }
  }

  const packageRoot =
    parts[0].startsWith("@") && parts.length >= 2
      ? path.join(packageRootBase, parts[0], parts[1])
      : path.join(packageRootBase, parts[0]);
  const version = readPackageVersion(packageRoot);
  return version ? { packageName, packageVersion: version } : null;
}

function loadDepUsageIndex(depsRoot: string, depsHash: string): Map<string, DepUsageSummary> | null {
  const depUsagePath = path.join(depsRoot, "deps-usage.v2.json");
  const legacyPath = path.join(depsRoot, "deps-usage.v1.json");
  const raw = readJson<DepUsageDisk>(depUsagePath) ?? readJson<DepUsageDisk>(legacyPath);
  if (!raw || (raw.version !== 1 && raw.version !== 2) || raw.depsHash !== depsHash) return null;

  const entries = raw.deps && typeof raw.deps === "object" ? raw.deps : {};
  const out = new Map<string, DepUsageSummary>();
  for (const [fileName, item] of Object.entries(entries)) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.entryPath !== "string" || typeof item.packageName !== "string") continue;
    if (typeof item.packageVersion !== "string" || !Array.isArray(item.usedExports)) continue;
    out.set(fileName, {
      fileName,
      entryPath: item.entryPath,
      packageName: item.packageName,
      packageVersion: item.packageVersion,
      usedExports: uniqueSorted(item.usedExports.filter((value): value is string => typeof value === "string")),
      hasNamespace: item.hasNamespace === true,
      hasExportStar: item.hasExportStar === true,
      importerKeys: uniqueSorted(Array.isArray(item.importerKeys) ? item.importerKeys.filter((value): value is string => typeof value === "string") : []),
      entryRootKeys: uniqueSorted(Array.isArray(item.entryRootKeys) ? item.entryRootKeys.filter((value): value is string => typeof value === "string") : []),
    });
  }
  return out;
}

function loadDepsManifestIndex(depsRoot: string): Map<string, DepsManifestEntrySummary> {
  const manifestPath = path.join(depsRoot, "manifest.json");
  const raw = readJson<{ entries?: Record<string, any> }>(manifestPath);
  const entries = raw?.entries && typeof raw.entries === "object" ? raw.entries : {};
  const out = new Map<string, DepsManifestEntrySummary>();

  for (const [entryPath, value] of Object.entries(entries)) {
    const item = value as Record<string, unknown> | null;
    if (!item || typeof item !== "object") continue;
    const fileName = typeof item.outFile === "string" ? item.outFile : typeof item.out_file === "string" ? item.out_file : null;
    if (!fileName || !fileName.endsWith(".js")) continue;

    const packageLabel = typeof item.package === "string" ? item.package : "unknown";
    const parsed = parsePackageLabel(packageLabel) ?? extractPackageIdentityFromModuleId(`ws://${entryPath}`);
    if (!parsed) continue;

    const chunkFilesRaw = Array.isArray(item.chunkFiles)
      ? item.chunkFiles
      : Array.isArray(item.chunk_files)
        ? item.chunk_files
        : [];
    out.set(fileName, {
      fileName,
      entryPath,
      packageLabel,
      packageName: parsed.packageName,
      packageVersion: parsed.packageVersion,
      sizeBytes: typeof item.sizeBytes === "number" ? item.sizeBytes : typeof item.size_bytes === "number" ? item.size_bytes : 0,
      moduleCount: typeof item.moduleCount === "number" ? item.moduleCount : typeof item.module_count === "number" ? item.module_count : 0,
      edgeCount: typeof item.edgeCount === "number" ? item.edgeCount : typeof item.edge_count === "number" ? item.edge_count : 0,
      externalCount:
        typeof item.externalCount === "number"
          ? item.externalCount
          : typeof item.external_count === "number"
            ? item.external_count
            : 0,
      chunkGroup:
        typeof item.chunkGroup === "string"
          ? item.chunkGroup
          : typeof item.chunk_group === "string"
            ? item.chunk_group
            : null,
      chunkFiles: uniqueSorted(chunkFilesRaw.filter((value): value is string => typeof value === "string" && value.endsWith(".js"))),
    });
  }

  return out;
}

function loadVendorPackRouting(depsRoot: string, depsHash: string): Map<string, string> {
  const raw = readJson<VendorPackIndexDisk>(path.join(depsRoot, "vendor-pack.v2.index.json"));
  if (!raw || raw.version !== 1 || raw.depsHash !== depsHash) return new Map();
  const routing = raw.fileNameToPackFile && typeof raw.fileNameToPackFile === "object" ? raw.fileNameToPackFile : {};
  return new Map(
    Object.entries(routing).filter(
      (entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string",
    ),
  );
}

export function summarizeDuplicateFindings(
  graphNodes: GraphNodeSummary[] | null,
  depUsageIndex: Map<string, DepUsageSummary> | null,
  depsManifestIndex: Map<string, DepsManifestEntrySummary> | null,
  limit: number,
): AnalyzeDuplicateFinding[] {
  type VersionAggregate = {
    graphModules: Set<string>;
    depArtifacts: Set<string>;
    importers: Set<string>;
    entryRoots: Set<string>;
    sampleIds: Set<string>;
    sources: Set<"graph" | "dep-usage" | "deps-manifest">;
  };

  const packages = new Map<string, Map<string, VersionAggregate>>();

  const ensureVersion = (packageName: string, version: string): VersionAggregate => {
    let versions = packages.get(packageName);
    if (!versions) {
      versions = new Map();
      packages.set(packageName, versions);
    }
    let aggregate = versions.get(version);
    if (!aggregate) {
      aggregate = {
        graphModules: new Set(),
        depArtifacts: new Set(),
        importers: new Set(),
        entryRoots: new Set(),
        sampleIds: new Set(),
        sources: new Set(),
      };
      versions.set(version, aggregate);
    }
    return aggregate;
  };

  for (const node of graphNodes ?? []) {
    const identity = extractPackageIdentityFromModuleId(node.id);
    if (!identity) continue;
    const aggregate = ensureVersion(identity.packageName, identity.packageVersion);
    aggregate.graphModules.add(node.id);
    aggregate.sampleIds.add(node.id);
    aggregate.sources.add("graph");
  }

  for (const [fileName, usage] of depUsageIndex ?? []) {
    const aggregate = ensureVersion(usage.packageName, usage.packageVersion);
    aggregate.depArtifacts.add(fileName);
    usage.importerKeys.forEach((value) => aggregate.importers.add(value));
    usage.entryRootKeys.forEach((value) => aggregate.entryRoots.add(value));
    aggregate.sampleIds.add(fileName);
    aggregate.sources.add("dep-usage");
  }

  for (const [fileName, entry] of depsManifestIndex ?? []) {
    const aggregate = ensureVersion(entry.packageName, entry.packageVersion);
    aggregate.depArtifacts.add(fileName);
    aggregate.sampleIds.add(fileName);
    aggregate.sources.add("deps-manifest");
  }

  return Array.from(packages.entries())
    .filter(([, versions]) => versions.size > 1)
    .map(([packageName, versions]) => {
      const versionDetails = Array.from(versions.entries())
        .map(([version, aggregate]) => ({
          version,
          graphModules: aggregate.graphModules.size,
          depArtifacts: aggregate.depArtifacts.size,
          importers: aggregate.importers.size,
          entryRoots: aggregate.entryRoots.size,
          sampleIds: Array.from(aggregate.sampleIds).sort().slice(0, 5),
        }))
        .sort(
          (a, b) =>
            b.depArtifacts - a.depArtifacts ||
            b.graphModules - a.graphModules ||
            b.importers - a.importers ||
            a.version.localeCompare(b.version),
        );

      const evidenceSources = Array.from(
        new Set(Array.from(versions.values()).flatMap((aggregate) => Array.from(aggregate.sources))),
      ).sort() as Array<"graph" | "dep-usage" | "deps-manifest">;

      return {
        packageName,
        versions: versionDetails,
        evidenceSources,
        totalGraphModules: versionDetails.reduce((sum, value) => sum + value.graphModules, 0),
        totalDepArtifacts: versionDetails.reduce((sum, value) => sum + value.depArtifacts, 0),
        totalImporters: versionDetails.reduce((sum, value) => sum + value.importers, 0),
        severity: classifyDuplicateSeverity(versionDetails.length, versionDetails.reduce((sum, value) => sum + value.depArtifacts, 0)),
        confidence: "high" as const,
      };
    })
    .sort(
      (a, b) =>
        b.versions.length - a.versions.length ||
        b.totalDepArtifacts - a.totalDepArtifacts ||
        b.totalGraphModules - a.totalGraphModules ||
        a.packageName.localeCompare(b.packageName),
    )
    .slice(0, Math.max(1, limit));
}

export function summarizeChunkBloatFindings(outDir: string, limit: number): AnalyzeChunkBloatFinding[] {
  const manifest = readJson<BuildManifestDisk>(path.join(path.resolve(outDir), "manifest.json"));
  const stats = readJson<Record<string, { bytes?: number; type?: string }>>(path.join(path.resolve(outDir), "build.stats.json"));
  const chunks = Array.isArray(manifest?.chunks) ? manifest.chunks : [];
  if (!chunks.length || !stats) return [];

  return chunks
    .map((chunk) => {
      const files = chunk.files ?? {};
      const jsFiles = Array.isArray(files.js) ? files.js.filter((value): value is string => typeof value === "string") : [];
      const cssFiles = Array.isArray(files.css) ? files.css.filter((value): value is string => typeof value === "string") : [];
      const assetFiles = Array.isArray(files.assets) ? files.assets.filter((value): value is string => typeof value === "string") : [];
      const sumBytes = (fileNames: string[]) =>
        fileNames.reduce((sum, fileName) => sum + (typeof stats[fileName]?.bytes === "number" ? stats[fileName].bytes ?? 0 : 0), 0);
      const jsBytes = sumBytes(jsFiles);
      const cssBytes = sumBytes(cssFiles);
      const assetBytes = sumBytes(assetFiles);
      const totalBytes = jsBytes + cssBytes + assetBytes;
      const modules = Array.isArray(chunk.modules) ? chunk.modules : [];
      const topModules = modules
        .map((module) => ({
          id: typeof module?.id === "string" ? module.id : "unknown",
          deps: Array.isArray(module?.deps) ? module.deps.length : 0,
        }))
        .sort((a, b) => b.deps - a.deps || a.id.localeCompare(b.id))
        .slice(0, 3);

      return {
        kind: "build-chunk" as const,
        chunkId: typeof chunk.id === "string" ? chunk.id : "unknown",
        entry: chunk.entry === true,
        shared: chunk.shared === true,
        totalBytes,
        jsBytes,
        cssBytes,
        assetBytes,
        consumerCount: Array.isArray(chunk.consumers) ? chunk.consumers.length : 0,
        moduleCount: modules.length,
        depReferenceCount: modules.reduce(
          (sum, module) => sum + (Array.isArray(module?.deps) ? module.deps.length : 0) + (Array.isArray(module?.dynamicDeps) ? module.dynamicDeps.length : 0),
          0,
        ),
        topModules,
        severity: classifyChunkSeverity(totalBytes, chunk.shared === true),
        confidence: "high" as const,
      };
    })
    .filter((item) => item.totalBytes > 0)
    .sort((a, b) => b.totalBytes - a.totalBytes || b.jsBytes - a.jsBytes || a.chunkId.localeCompare(b.chunkId))
    .slice(0, Math.max(1, limit));
}

export function summarizeDependencyBloatFindings(
  depsRoot: string,
  depsHash: string,
  limit: number,
): AnalyzeDependencyBloatFinding[] {
  const depsManifestIndex = loadDepsManifestIndex(depsRoot);
  if (depsManifestIndex.size === 0) return [];
  const depUsageIndex = loadDepUsageIndex(depsRoot, depsHash);
  const packRouting = loadVendorPackRouting(depsRoot, depsHash);

  return Array.from(depsManifestIndex.values())
    .map((entry) => {
      const usage = depUsageIndex?.get(entry.fileName) ?? null;
      const packFileName = packRouting.get(entry.fileName) ?? null;
      const confidence: AnalyzeCertainty = !usage
        ? "low"
        : usage.hasNamespace || usage.hasExportStar
          ? "medium"
          : "high";
      const severity = classifyDependencySeverity(
        entry.sizeBytes,
        usage?.importerKeys.length ?? 0,
        usage?.entryRootKeys.length ?? 0,
        packFileName !== null,
      );
      return {
        kind: "dep-artifact" as const,
        fileName: entry.fileName,
        packageName: entry.packageName,
        packageVersion: entry.packageVersion,
        packageLabel: entry.packageLabel,
        bytes: entry.sizeBytes,
        moduleCount: entry.moduleCount,
        edgeCount: entry.edgeCount,
        externalCount: entry.externalCount,
        importerCount: usage?.importerKeys.length ?? 0,
        entryRootCount: usage?.entryRootKeys.length ?? 0,
        usedExportCount: usage ? usage.usedExports.length : null,
        hasNamespace: usage ? usage.hasNamespace : null,
        hasExportStar: usage ? usage.hasExportStar : null,
        chunkGroup: entry.chunkGroup,
        chunkFiles: entry.chunkFiles,
        packFileName,
        packed: packFileName !== null,
        severity,
        confidence,
      };
    })
    .sort(
      (a, b) =>
        b.bytes - a.bytes ||
        b.importerCount - a.importerCount ||
        Number(a.packed) - Number(b.packed) ||
        a.packageLabel.localeCompare(b.packageLabel),
    )
    .slice(0, Math.max(1, limit));
}

export function buildAnalyzeSuggestions(
  duplicates: AnalyzeDuplicateFinding[],
  dependencies: AnalyzeDependencyBloatFinding[],
  limit: number,
): AnalyzeSuggestion[] {
  const suggestions: AnalyzeSuggestion[] = [];

  for (const duplicate of duplicates) {
    suggestions.push({
      kind: "align-package-versions",
      target: duplicate.packageName,
      severity: duplicate.severity,
      confidence: "high",
      rationale: `${duplicate.packageName} resolves to ${duplicate.versions.length} versions; align versions to reduce duplicate dependency state.`,
    });
  }

  for (const dependency of dependencies) {
    if (dependency.confidence !== "high") continue;
    if (dependency.packed) continue;
    if (dependency.bytes < HEAVY_DEP_SUGGESTION_MIN_BYTES) continue;
    if (Math.max(dependency.importerCount, dependency.entryRootCount) < HEAVY_DEP_SUGGESTION_MIN_IMPORTERS) continue;
    suggestions.push({
      kind: "review-pack-coverage",
      target: `${dependency.packageName}@${dependency.packageVersion}`,
      severity: dependency.bytes >= 512 * 1024 ? "high" : "medium",
      confidence: "high",
      rationale: `${dependency.packageName}@${dependency.packageVersion} emits ${formatBytes(
        dependency.bytes,
      )} outside vendor-pack coverage across ${Math.max(dependency.importerCount, dependency.entryRootCount)} import roots.`,
    });
  }

  const kindPriority = (kind: AnalyzeSuggestion["kind"]) => (kind === "align-package-versions" ? 0 : 1);
  return suggestions
    .sort(
      (a, b) =>
        compareSeverity(a.severity, b.severity) ||
        kindPriority(a.kind) - kindPriority(b.kind) ||
        a.target.localeCompare(b.target),
    )
    .slice(0, Math.max(1, limit));
}

export function summarizeFindings(options: {
  graphNodes: GraphNodeSummary[] | null;
  outDir: string;
  depsSelection: DepsRootSelection | null;
  limit: number;
}): AnalyzeFindings | null {
  const { graphNodes, outDir, depsSelection, limit } = options;
  const depsManifestIndex = depsSelection ? loadDepsManifestIndex(depsSelection.depsRoot) : null;
  const depUsageIndex = depsSelection ? loadDepUsageIndex(depsSelection.depsRoot, depsSelection.depsHash) : null;
  const duplicates = summarizeDuplicateFindings(graphNodes, depUsageIndex, depsManifestIndex, limit);
  const chunkBloat = summarizeChunkBloatFindings(outDir, limit);
  const dependencyBloat = depsSelection ? summarizeDependencyBloatFindings(depsSelection.depsRoot, depsSelection.depsHash, limit) : [];
  const suggestions = buildAnalyzeSuggestions(duplicates, dependencyBloat, limit);

  if (!graphNodes && chunkBloat.length === 0 && dependencyBloat.length === 0 && duplicates.length === 0) {
    return null;
  }

  return {
    duplicates,
    bloat: {
      chunks: chunkBloat,
      dependencies: dependencyBloat,
    },
    suggestions,
  };
}

function countPackSavings(summary: VendorPackAnalyzeSummary | null | undefined): number | null {
  if (!summary) return null;
  return summary.packs.reduce((sum, pack) => sum + pack.requestsSaved, 0);
}

export function deriveAnalyzeOverview(input: {
  graph?: GraphAnalyzeSummary | null;
  build?: BuildAnalyzeSummary | null;
  packs?: VendorPackAnalyzeSummary | null;
}): AnalyzeOverviewSummary {
  return {
    modules: input.graph?.modules ?? null,
    dependencies: input.graph?.edges ?? null,
    entries: input.build?.entries ?? null,
    chunks: input.build?.chunks.total ?? null,
    jsBytes: input.build?.bytes.js ?? null,
    cssBytes: input.build?.bytes.css ?? null,
    packSavingsRequests: countPackSavings(input.packs),
  };
}

export function deriveAnalyzeHealth(input: {
  build?: BuildAnalyzeSummary | null;
  routes?: RouteAnalyzeSummary | null;
  findings?: AnalyzeFindings | null;
}): AnalyzeHealthSummary {
  const maxChunkBytes = input.findings?.bloat.chunks[0]?.totalBytes ?? 0;
  const jsBytes = input.build?.bytes.js ?? 0;
  let bundlePressure: AnalyzeHealthLevel = "missing";
  if (input.build || (input.findings?.bloat.chunks.length ?? 0) > 0) {
    if (maxChunkBytes >= 2 * 1024 * 1024 || jsBytes >= 5 * 1024 * 1024) bundlePressure = "high";
    else if (maxChunkBytes >= 512 * 1024 || jsBytes >= 1 * 1024 * 1024) bundlePressure = "medium";
    else bundlePressure = "low";
  }

  let duplicatePressure: AnalyzeHealthLevel = "missing";
  if (input.findings) {
    if (input.findings.duplicates.some((item) => item.severity === "high")) duplicatePressure = "high";
    else if (input.findings.duplicates.length > 0) duplicatePressure = "medium";
    else duplicatePressure = "low";
  }

  let packCoverage: AnalyzeHealthLevel = "missing";
  if (input.routes?.packCoverage && input.routes.packCoverage.coverageRate !== null) {
    const ratio = input.routes.packCoverage.coverageRate;
    if (ratio >= 0.67) packCoverage = "high";
    else if (ratio >= 0.34) packCoverage = "medium";
    else packCoverage = "low";
  } else if (input.findings) {
    const relevantDeps = input.findings.bloat.dependencies.filter((item) => item.confidence !== "low");
    if (relevantDeps.length > 0) {
      const packedCount = relevantDeps.filter((item) => item.packed).length;
      const ratio = packedCount / relevantDeps.length;
      if (ratio >= 0.67) packCoverage = "high";
      else if (ratio >= 0.34) packCoverage = "medium";
      else packCoverage = "low";
    }
  }

  return {
    bundlePressure,
    duplicatePressure,
    packCoverage,
    routeVisibility: input.routes && input.routes.routeCount > 0 ? "present" : "missing",
  };
}

function getTopModuleLabel(module: AnalyzeChunkModuleHint | undefined): string | null {
  return module?.id ?? null;
}

function buildTopFindingScore(finding: AnalyzeTopFinding): number {
  const severityWeight = finding.severity === "high" ? 1_000_000_000 : finding.severity === "medium" ? 100_000_000 : 10_000_000;
  const confidenceWeight = finding.confidence === "high" ? 1_000_000 : finding.confidence === "medium" ? 100_000 : 10_000;
  const numericEvidence =
    typeof finding.evidence.bytes === "number"
      ? finding.evidence.bytes
      : typeof finding.evidence.versions === "number"
        ? finding.evidence.versions * 10_000
        : typeof finding.evidence.totalDepArtifacts === "number"
          ? finding.evidence.totalDepArtifacts * 1_000
          : 0;
  return severityWeight + confidenceWeight + numericEvidence;
}

export function buildTopFindings(findings: AnalyzeFindings | null | undefined, limit: number): AnalyzeTopFinding[] {
  if (!findings) return [];
  const normalized: AnalyzeTopFinding[] = [];

  for (const duplicate of findings.duplicates) {
    normalized.push({
      id: `duplicate:${duplicate.packageName}`,
      severity: duplicate.severity,
      title: `Duplicate ${duplicate.packageName} versions detected`,
      why: "Duplicate dependency state increases emitted waste and package divergence.",
      action: "Align versions across the workspace dependency graph.",
      confidence: duplicate.confidence,
      evidence: {
        packageName: duplicate.packageName,
        versions: duplicate.versions.length,
        totalDepArtifacts: duplicate.totalDepArtifacts,
        totalGraphModules: duplicate.totalGraphModules,
      },
      source: "duplicate",
    });
  }

  for (const chunk of findings.bloat.chunks) {
    normalized.push({
      id: `chunk:${chunk.chunkId}`,
      severity: chunk.severity,
      title: chunk.shared ? "Oversized shared chunk" : "Oversized entry chunk",
      why: "Large emitted chunks increase parse and first-load pressure.",
      action: "Revisit chunk policy or reduce imported surface for this chunk.",
      confidence: chunk.confidence,
      evidence: {
        chunkId: chunk.chunkId,
        bytes: chunk.totalBytes,
        modules: chunk.moduleCount,
        topModule: getTopModuleLabel(chunk.topModules[0]),
      },
      source: "chunk-bloat",
    });
  }

  for (const dependency of findings.bloat.dependencies) {
    normalized.push({
      id: `dep:${dependency.fileName}`,
      severity: dependency.severity,
      title: dependency.packed ? "Heavy dependency artifact" : "Heavy unpacked dependency artifact",
      why: dependency.packed
        ? "Large dependency artifacts still add byte and parse pressure."
        : "Large unpacked dependency artifacts increase request and transfer pressure.",
      action: dependency.packed
        ? "Reduce the imported surface or review whether this dependency should stay this large."
        : "Review pack coverage or reduce the imported surface for this dependency.",
      confidence: dependency.confidence,
      evidence: {
        packageName: dependency.packageName,
        packageVersion: dependency.packageVersion,
        bytes: dependency.bytes,
        importers: dependency.importerCount,
        packed: dependency.packed,
      },
      source: "dep-bloat",
    });
  }

  return normalized
    .sort(
      (a, b) =>
        buildTopFindingScore(b) - buildTopFindingScore(a) ||
        compareSeverity(a.severity, b.severity) ||
        compareCertainty(a.confidence, b.confidence) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, Math.max(1, limit));
}

function compactWorkspaceLabel(projectRoot: string): string {
  const base = path.basename(projectRoot);
  return base || projectRoot;
}

function uniquePreservingOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function formatSeverity(severity: AnalyzeSeverity): string {
  return severity[0].toUpperCase() + severity.slice(1);
}

function formatHealth(level: AnalyzeHealthLevel | AnalyzeRouteVisibility): string {
  return level[0].toUpperCase() + level.slice(1);
}

function collectNextActions(summary: AnalyzeSummary, limit: number): string[] {
  const actions: string[] = [];
  for (const finding of summary.topFindings) {
    if (finding.action) actions.push(finding.action);
  }
  for (const suggestion of summary.findings?.suggestions ?? []) {
    actions.push(suggestion.rationale);
  }
  const unique = uniquePreservingOrder(actions);
  return unique.slice(0, Math.max(1, limit));
}

function printCompactSectionStatus(label: string, available: boolean, detail?: string | null): void {
  const state = available ? accent(detail ?? "available") : chalk.bold.red("unavailable");
  console.log(` ${chalk.bold(label)}: ${state}`);
}

function printDefaultSummary(summary: AnalyzeSummary, options: AnalyzeOptions, limit: number): void {
  logInfo("Ionify Analyzer");
  console.log(` ${chalk.bold("Workspace")}: ${accent(compactWorkspaceLabel(summary.workspace.projectRoot))}`);

  printCompactSectionStatus(
    "Graph",
    !!summary.graph,
    summary.summary.modules !== null && summary.summary.dependencies !== null
      ? `${summary.summary.modules} modules • ${summary.summary.dependencies} deps`
      : null,
  );
  printCompactSectionStatus(
    "Build",
    !!summary.build,
    summary.build
      ? `${summary.build.chunks.total} chunks • ${formatBytes(summary.build.bytes.js)} JS • ${formatBytes(summary.build.bytes.css)} CSS`
      : null,
  );
  printCompactSectionStatus(
    "Packs",
    !!summary.packs,
    summary.summary.packSavingsRequests !== null
      ? `${summary.packs?.packs.length ?? 0} active packs • ~${summary.summary.packSavingsRequests} requests saved`
      : null,
  );
  printCompactSectionStatus(
    "Routes",
    !!summary.routes,
    summary.routes ? `${summary.routes.routeCount} tracked route${summary.routes.routeCount === 1 ? "" : "s"}` : null,
  );

  console.log(`\n ${sectionTitle("Health")}`);
  console.log(` ${dimText("-")} Bundle size pressure: ${colorHealth(summary.health.bundlePressure)}`);
  console.log(` ${dimText("-")} Duplicate dependency pressure: ${colorHealth(summary.health.duplicatePressure)}`);
  console.log(` ${dimText("-")} Pack coverage: ${colorHealth(summary.health.packCoverage)}`);
  console.log(` ${dimText("-")} Route visibility: ${colorHealth(summary.health.routeVisibility)}`);

  console.log(`\n ${sectionTitle("Top Issues")}`);
  if (summary.topFindings.length === 0) {
    console.log(` ${dimText("No high-signal findings from the current engine state.")}`);
  } else {
    const topIssueCount = options.verbose ? Math.max(1, Math.min(5, limit)) : Math.max(1, Math.min(3, limit));
    for (const [index, finding] of summary.topFindings.slice(0, topIssueCount).entries()) {
      const evidenceParts = Object.entries(finding.evidence)
        .filter(([, value]) => value !== null && value !== false && value !== "")
        .slice(0, 3)
        .map(([key, value]) => `${key}=${typeof value === "number" && key === "bytes" ? formatBytes(value) : value}`);
      console.log(`${accent(`${index + 1}.`)} [${colorSeverity(finding.severity)}] ${chalk.bold(finding.title)}`);
      console.log(`   ${dimText("Why:")} ${finding.why}`);
      if (evidenceParts.length > 0) console.log(`   ${dimText("Evidence:")} ${evidenceParts.join(` ${chalk.gray("•")} `)}`);
      if (finding.action) console.log(`   ${dimText("Action:")} ${chalk.green(finding.action)}`);
      console.log(`   ${dimText("Confidence:")} ${colorConfidence(finding.confidence)}`);
    }
  }

  console.log(`\n ${sectionTitle("Key Metrics")}`);
  console.log(
    ` ${dimText("-")} Largest chunk: ${metric(
      summary.findings?.bloat.chunks[0] ? `${formatBytes(summary.findings.bloat.chunks[0].totalBytes)} (${summary.findings.bloat.chunks[0].chunkId})` : "n/a",
    )}`,
  );
  console.log(
    ` ${dimText("-")} Largest dependency artifact: ${metric(
      summary.findings?.bloat.dependencies[0]
        ? `${summary.findings.bloat.dependencies[0].packageLabel} (${formatBytes(summary.findings.bloat.dependencies[0].bytes)})`
        : "n/a",
    )}`,
  );
  console.log(` ${dimText("-")} Duplicate families: ${metric(String(summary.findings?.duplicates.length ?? 0))}`);
  console.log(` ${dimText("-")} Vendor pack request savings: ${metric(String(summary.summary.packSavingsRequests ?? "n/a"))}`);

  const nextActions = collectNextActions(summary, 3);
  if (nextActions.length > 0) {
    console.log(`\n ${sectionTitle("Recommended Next Steps")}`);
    for (const action of nextActions) console.log(` ${dimText("-")} ${chalk.green(action)}`);
  }

  if (!options.verbose) {
    console.log(`\n ${dimText("Use --verbose for full findings, --json for stable machine output, or --section <name> for focused analysis.")}`);
  }
}

function printDepsSection(summary: AnalyzeSummary): void {
  console.log(`\n ${sectionTitle("Dependencies")}`);
  if (!summary.findings) {
    console.log(` ${dimText("Duplicate and bloat findings are unavailable for the current engine state.")}`);
    return;
  }
  if (summary.findings.duplicates.length > 0) {
    console.log(` ${subSectionTitle("Duplicate versions:")}`);
    for (const duplicate of summary.findings.duplicates) {
      console.log(bullet(`[${colorSeverity(duplicate.severity)}] ${duplicate.packageName} ${chalk.gray("→")} ${duplicate.versions.map((item) => item.version).join(", ")}`));
    }
  } else {
    console.log(` ${subSectionTitle("Duplicate versions:")} ${dimText("none detected")}`);
  }

  if (summary.findings.bloat.dependencies.length > 0) {
    console.log(`\n ${subSectionTitle("Heavy dependency artifacts:")}`);
    for (const dependency of summary.findings.bloat.dependencies) {
      console.log(
        bullet(
          `[${colorSeverity(dependency.severity)}] ${dependency.packageLabel} ${metric(formatBytes(dependency.bytes))} ${dimText(
            `packed=${dependency.packed ? "yes" : "no"} confidence=`,
          )}${colorConfidence(dependency.confidence)}`,
        ),
      );
    }
  } else {
    console.log(`\n ${subSectionTitle("Heavy dependency artifacts:")} ${dimText("unavailable")}`);
  }

  if (summary.findings.suggestions.length > 0) {
    console.log(`\n ${subSectionTitle("Suggestions:")}`);
    for (const suggestion of summary.findings.suggestions) {
      console.log(bullet(`[${colorSeverity(suggestion.severity)}] ${chalk.green(suggestion.rationale)}`));
    }
  }
}

function printFocusedSection(section: AnalyzeSection, summary: AnalyzeSummary, options: AnalyzeOptions): void {
  switch (section) {
    case "graph":
      if (summary.graph) printGraphSummary(summary.graph, !!(options.tree || options.deps));
      else console.log("\n Graph\n No cached graph found. Run `ionify dev` to generate dependency data.");
      return;
    case "build":
      if (summary.build) printBuildSummary(summary.build);
      else console.log("\n Build\n No build outputs found. Run `ionify build` to generate manifest and build stats.");
      if (summary.findings?.bloat.chunks.length) {
        console.log("\n Chunk findings:");
        for (const chunk of summary.findings.bloat.chunks) {
          console.log(
            `  • [${formatSeverity(chunk.severity)}] ${chunk.chunkId} ${formatBytes(chunk.totalBytes)} modules=${chunk.moduleCount} depRefs=${chunk.depReferenceCount}`,
          );
        }
      }
      return;
    case "deps":
      printDepsSection(summary);
      return;
    case "packs":
      if (summary.packs) printPackSummary(summary.packs);
      else console.log("\n Vendor packs (v2)\n No deps pack index found.");
      return;
    case "routes":
      if (summary.routes) printRouteSummary(summary.routes);
      else console.log("\n Routes\n Routes: unavailable (no route-hint state found)");
      return;
    case "findings":
      if (summary.findings) printFindingsSummary(summary.findings);
      else console.log("\n Findings\n No duplicate-version or bloat findings available.");
      return;
  }
}

function printGraphTree(nodes: GraphTreeNode[], prefix = ""): void {
  nodes.forEach((node, index) => {
    const isLast = index === nodes.length - 1;
    const branch = prefix ? (isLast ? "└─ " : "├─ ") : "";
    const suffixParts: string[] = [];
    if (node.cycle) suffixParts.push("cycle");
    if (node.truncated) suffixParts.push("truncated");
    suffixParts.push(`${node.depCount} deps`);
    console.log(`${prefix}${branch}${node.id} (${suffixParts.join(", ")})`);
    if (node.deps && node.deps.length > 0) {
      printGraphTree(node.deps, `${prefix}${prefix ? (isLast ? "   " : "│  ") : ""}`);
    }
  });
}

function printGraphSummary(summary: GraphAnalyzeSummary, includeTree: boolean): void {
  console.log(`\n ${sectionTitle("Graph")}`);
  console.log(` ${chalk.bold("Modules")}: ${metric(String(summary.modules))}`);
  console.log(` ${chalk.bold("Dependencies")}: ${metric(String(summary.edges))}`);
  console.log(` ${chalk.bold("Avg deps / module")}: ${metric(summary.averageDeps.toFixed(2))}`);
  console.log(` ${chalk.bold("Roots")}: ${metric(String(summary.roots.length))}`);

  if (summary.densest.length > 0) {
    console.log(`\n ${subSectionTitle("Top modules by dependency count:")}`);
    for (const entry of summary.densest) console.log(bullet(`${entry.id} ${dimText(`(${entry.deps})`)}`));
  }

  if (summary.mostDepended.length > 0) {
    console.log(`\n ${subSectionTitle("Top modules by inbound dependents:")}`);
    for (const entry of summary.mostDepended) console.log(bullet(`${entry.id} ${dimText(`(${entry.dependents})`)}`));
  }

  if (summary.orphans.length > 0) {
    console.log(`\n ${subSectionTitle("Root/orphan modules:")}`);
    for (const file of summary.orphans.slice(0, 10)) console.log(bullet(file));
    if (summary.orphans.length > 10) console.log(bullet(dimText(`...and ${summary.orphans.length - 10} more`)));
  }

  if (includeTree && summary.tree && summary.tree.length > 0) {
    console.log(`\n ${subSectionTitle("Dependency tree:")}`);
    printGraphTree(summary.tree);
  }
}

function printBuildSummary(summary: BuildAnalyzeSummary): void {
  console.log(`\n ${sectionTitle("Build")}`);
  console.log(` ${chalk.bold("Out dir")}: ${summary.outDir}`);
  console.log(` ${chalk.bold("Manifest")}: ${summary.hasManifest ? chalk.green("yes") : chalk.red("no")}`);
  console.log(` ${chalk.bold("Build stats")}: ${summary.hasStats ? chalk.green("yes") : chalk.red("no")}`);
  console.log(` ${chalk.bold("Entries")}: ${metric(String(summary.entries))}`);
  console.log(` ${chalk.bold("Chunks")}: ${metric(String(summary.chunks.total))} ${dimText(`(entry ${summary.chunks.entry}, shared ${summary.chunks.shared})`)}`);
  console.log(
    ` ${chalk.bold("Files")}: ${dimText(`js ${summary.files.js}, css ${summary.files.css}, assets ${summary.files.assets}, maps ${summary.files.maps}, public ${summary.files.publicAssets}`)}`,
  );
  console.log(
    ` ${chalk.bold("Bytes")}: ${dimText(`js ${formatBytes(summary.bytes.js)}, css ${formatBytes(summary.bytes.css)}, assets ${formatBytes(
      summary.bytes.assets,
    )}, maps ${formatBytes(summary.bytes.maps)}, public ${formatBytes(summary.bytes.publicAssets)}`)}`,
  );
  if (summary.topFiles.length > 0) {
    console.log(`\n ${subSectionTitle("Largest tracked files:")}`);
    for (const file of summary.topFiles) console.log(bullet(`${file.file} ${dimText(`(${file.type}, ${formatBytes(file.bytes)})`)}`));
  }
}

function printPackSummary(summary: VendorPackAnalyzeSummary): void {
  console.log(`\n ${sectionTitle("Vendor packs (v2)")}`);
  console.log(` ${chalk.bold("depsHash")}: ${accent(summary.depsHash)}`);
  console.log(` ${chalk.bold("selection")}: ${summary.selectionMode}`);
  if (summary.packIndexHash) console.log(` ${chalk.bold("packIndexHash")}: ${dimText(summary.packIndexHash)}`);
  if (summary.usageIndexHash) console.log(` ${chalk.bold("usageIndexHash")}: ${dimText(summary.usageIndexHash)}`);

  if (summary.packs.length > 0) {
    console.log(`\n ${subSectionTitle("Top packs by request savings (approx):")}`);
    for (const p of summary.packs) {
      const reqLabel = `${p.requestsUnpacked}→${p.requestsPacked} (saved ${p.requestsSaved})`;
      const bytesLabel =
        p.bytesWrappers !== null && p.bytesPacked !== null
          ? `${formatBytes(p.bytesWrappers)}→${formatBytes(p.bytesPacked)}`
          : "n/a";
      console.log(bullet(`${p.packFileName} ${dimText(`members=${p.members} requests=${reqLabel} bytes=${bytesLabel}`)}`));
    }
  }

  if (summary.slimGroups.length > 0) {
    console.log(`\n ${subSectionTitle("Slimming (base → slim shared bytes):")}`);
    for (const g of summary.slimGroups) {
      const saved = g.savedBytes !== null && g.savedBytes > 0 ? `saved ${formatBytes(g.savedBytes)}` : "saved n/a";
      console.log(bullet(`${g.label}: ${formatBytes(g.baseSharedBytes)}→${formatBytes(g.slimSharedBytes)} ${dimText(`(${saved})`)}`));
    }
  }
}

function printRouteSummary(summary: RouteAnalyzeSummary): void {
  console.log(`\n ${sectionTitle("Routes")}`);
  console.log(` ${chalk.bold("State")}: ${summary.statePath}`);
  console.log(` ${chalk.bold("Routes tracked")}: ${metric(String(summary.routeCount))}`);
  console.log(` ${chalk.bold("Primary route")}: ${accent(summary.primaryRouteKey ?? "n/a")}`);

  if (summary.routes.length > 0) {
    console.log(`\n ${subSectionTitle("Top routes:")}`);
    for (const route of summary.routes) {
      console.log(bullet(`${route.routeKey} ${dimText(`documents=${route.documents} requests=${route.totalRequests} assets=${route.totalAssets} (dep ${route.depAssets}, source ${route.sourceAssets})`)}`));
    }
  }

  if (summary.topDepAssets.length > 0) {
    console.log(`\n ${subSectionTitle("Top dep assets:")}`);
    for (const item of summary.topDepAssets) {
      console.log(bullet(`${item.url} ${dimText(`requests=${item.totalRequestCount} depth=${item.minDepth} routes=${item.routeKeys.length}`)}`));
    }
  }

  if (summary.topSourceAssets.length > 0) {
    console.log(`\n ${subSectionTitle("Top source assets:")}`);
    for (const item of summary.topSourceAssets) {
      console.log(bullet(`${item.url} ${dimText(`requests=${item.totalRequestCount} depth=${item.minDepth} routes=${item.routeKeys.length}`)}`));
    }
  }

  if (summary.suggestedPreloads.length > 0) {
    console.log(`\n ${subSectionTitle("Suggested preloads:")}`);
    for (const item of summary.suggestedPreloads) {
      console.log(bullet(`${item.url} ${dimText(`(${item.kind}) route=${item.routeRequestCount} total=${item.totalRequestCount} depth=${item.minDepth}`)}`));
    }
  }

  if (summary.firstRouteBytes) {
    console.log(`\n ${subSectionTitle("Primary route observed bytes:")}`);
    console.log(
      bullet(
        `total=${formatBytes(summary.firstRouteBytes.totalObservedBytes)} dep=${formatBytes(summary.firstRouteBytes.depObservedBytes)} source=${formatBytes(summary.firstRouteBytes.sourceObservedBytes)} ${dimText(`resolved=${summary.firstRouteBytes.observedAssets} unresolved=${summary.firstRouteBytes.unresolvedAssets}`)}`,
      ),
    );
  }

  if (summary.packCoverage) {
    console.log(`\n ${subSectionTitle("Pack coverage:")}`);
    console.log(
      bullet(
        `covered=${summary.packCoverage.coveredDepAssets}/${summary.packCoverage.totalDepAssets} uncovered=${summary.packCoverage.uncoveredDepAssets} estimated requests ${summary.packCoverage.estimatedCurrentRequests ?? 0}→${summary.packCoverage.estimatedPackedRequests ?? 0} ${dimText(`saved=${summary.packCoverage.estimatedRequestsSaved ?? 0}`)}`,
      ),
    );
  }

  if (summary.uncoveredHotDeps.length > 0) {
    console.log(`\n ${subSectionTitle("Uncovered hot deps:")}`);
    for (const dep of summary.uncoveredHotDeps) {
      const label = dep.packageLabel ?? dep.fileName;
      console.log(
        bullet(
          `${label} ${dimText(`requests=${dep.routeRequestCount} depth=${dep.minDepth} bytes=${formatBytes(dep.bytes)} importers=${dep.importers} roots=${dep.entryRoots}`)}`,
        ),
      );
    }
  }

  console.log(`\n ${subSectionTitle("History and policy visibility:")}`);
  const signals = summary.policyVisibility.signals;
  console.log(
    bullet(
      `signals routeHints=${signals.routeHints ? "yes" : "no"} depUsage=${signals.depUsage ? "yes" : "no"} packRouting=${signals.packRouting ? "yes" : "no"} manifestOwnership=${signals.manifestOwnership ? "yes" : "no"}`,
    ),
  );
  if (summary.policyVisibility.entryCriticalEvidence) {
    const evidence = summary.policyVisibility.entryCriticalEvidence;
    console.log(
      bullet(
        `entry-critical evidence assets=${evidence.criticalAssets} deferred=${evidence.deferredAssets} requests=${evidence.criticalRequests}/${evidence.deferredRequests} ${dimText("(derived from minDepth)")}`,
      ),
    );
  }
  console.log(
    bullet(
      `policy reuse=${summary.policyVisibility.policyReuse.status} ${dimText(`(${summary.policyVisibility.policyReuse.reason})`)}`,
    ),
  );
  for (const effect of summary.policyVisibility.currentEffects) {
    console.log(bullet(effect));
  }
  for (const missing of summary.policyVisibility.missingCapabilities) {
    console.log(bullet(dimText(`Not yet: ${missing}`)));
  }
}

function printFindingsSummary(summary: AnalyzeFindings): void {
  console.log(`\n ${sectionTitle("Findings")}`);

  if (summary.duplicates.length > 0) {
    console.log(`\n ${subSectionTitle("Duplicate versions:")}`);
    for (const duplicate of summary.duplicates) {
      const versions = duplicate.versions.map((item) => item.version).join(", ");
      console.log(bullet(`[${colorSeverity(duplicate.severity)}] ${duplicate.packageName} ${chalk.gray("→")} ${versions} ${dimText(`(${duplicate.confidence})`)}`));
    }
  }

  if (summary.bloat.chunks.length > 0) {
    console.log(`\n ${subSectionTitle("Largest emitted chunks:")}`);
    for (const chunk of summary.bloat.chunks) {
      const role = chunk.entry ? "entry" : chunk.shared ? "shared" : "chunk";
      console.log(
        bullet(`[${colorSeverity(chunk.severity)}] ${chunk.chunkId} ${dimText(`(${role})`)} ${metric(formatBytes(chunk.totalBytes))} ${dimText(`modules=${chunk.moduleCount} depRefs=${chunk.depReferenceCount}`)}`),
      );
    }
  }

  if (summary.bloat.dependencies.length > 0) {
    console.log(`\n ${subSectionTitle("Heaviest dependency artifacts:")}`);
    for (const dependency of summary.bloat.dependencies) {
      const usageLabel =
        dependency.importerCount > 0
          ? `importers=${dependency.importerCount} roots=${dependency.entryRootCount}`
          : "usage=n/a";
      const packLabel = dependency.packed ? `packed via ${dependency.packFileName}` : "not packed";
      console.log(
        bullet(`[${colorSeverity(dependency.severity)}] ${dependency.packageLabel} ${metric(formatBytes(dependency.bytes))} ${dimText(`${usageLabel} ${packLabel} certainty=`)}${colorConfidence(dependency.confidence)}`),
      );
    }
  }

  if (summary.suggestions.length > 0) {
    console.log(`\n ${subSectionTitle("Conservative suggestions:")}`);
    for (const suggestion of summary.suggestions) {
      console.log(bullet(`[${colorSeverity(suggestion.severity)}] ${suggestion.target}: ${chalk.green(suggestion.rationale)} ${dimText(`(${suggestion.confidence})`)}`));
    }
  }

  if (
    summary.duplicates.length === 0 &&
    summary.bloat.chunks.length === 0 &&
    summary.bloat.dependencies.length === 0 &&
    summary.suggestions.length === 0
  ) {
    console.log(` ${dimText("No duplicate-version or bloat findings from the current engine state.")}`);
  }
}

async function withSuppressedConsole<T>(enabled: boolean, work: () => Promise<T> | T): Promise<T> {
  if (!enabled) return await work();

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return await work();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

export async function runAnalyzeCommand(options: AnalyzeOptions = {}) {
  const limit = Math.max(1, options.limit ?? 10);
  const selected = getSelectedSurfaces(options);
  const ws = await withSuppressedConsole(!!options.json, () => resolveAnalyzeWorkspace());
  const outDir = options.outDir ? path.resolve(options.outDir) : path.join(ws.projectRoot, "dist");
  const needsGraphState = selected.includes("graph") || selected.includes("findings");
  const needsDepsState = selected.includes("packs") || selected.includes("findings") || selected.includes("routes");
  const nodes = needsGraphState
    ? await withSuppressedConsole(!!options.json, () => loadGraphSnapshot(ws.ionifyDir))
    : null;
  const depsInfo = needsDepsState ? selectDepsRoot(ws.ionifyDir, options.depsHash, process.env.IONIFY_DEPS_HASH) : null;
  const summary: AnalyzeSummary = {
    version: 1,
    workspace: {
      projectRoot: ws.projectRoot,
      workspaceRoot: ws.workspaceRoot,
      ionifyDir: ws.ionifyDir,
    },
    selected,
    summary: {
      modules: null,
      dependencies: null,
      entries: null,
      chunks: null,
      jsBytes: null,
      cssBytes: null,
      packSavingsRequests: null,
    },
    health: {
      bundlePressure: "missing",
      duplicatePressure: "missing",
      packCoverage: "missing",
      routeVisibility: "missing",
    },
    topFindings: [],
  };

  if (selected.includes("graph")) {
    summary.graph = nodes && nodes.length > 0 ? computeGraphSummary(nodes, limit, !!(options.tree || options.deps)) : null;
  }

  if (selected.includes("build")) {
    summary.build = summarizeBuildOutputs(outDir, limit);
  }

  if (selected.includes("packs")) {
    summary.packs = depsInfo
      ? analyzeVendorPacks(depsInfo.depsRoot, depsInfo.depsHash, depsInfo.selectionMode, limit)
      : null;
  }

  if (selected.includes("routes")) {
    const routeHintStatePath = path.join(ws.ionifyDir, "route-hints.v1.json");
    summary.routes = summarizeRoutes(routeHintStatePath, limit, {
      projectRoot: ws.projectRoot,
      depsSelection: depsInfo,
    });
  }

  if (selected.includes("findings")) {
    summary.findings = summarizeFindings({
      graphNodes: nodes,
      outDir,
      depsSelection: depsInfo,
      limit,
    });
  }

  summary.summary = deriveAnalyzeOverview({
    graph: summary.graph,
    build: summary.build,
    packs: summary.packs,
  });
  summary.health = deriveAnalyzeHealth({
    build: summary.build,
    routes: summary.routes,
    findings: summary.findings,
  });
  summary.topFindings = buildTopFindings(summary.findings, Math.min(limit, 5));

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (options.section) {
    printFocusedSection(options.section, summary, options);
    return;
  }

  printDefaultSummary(summary, options, limit);

  if (!options.verbose) {
    return;
  }

  if (selected.includes("graph")) {
    if (summary.graph) printGraphSummary(summary.graph, !!(options.tree || options.deps));
    else console.log("\n Graph\n No cached graph found. Run `ionify dev` to generate dependency data.");
  }

  if (selected.includes("build")) {
    if (summary.build) printBuildSummary(summary.build);
    else console.log("\n Build\n No build outputs found. Run `ionify build` to generate manifest and build stats.");
  }

  if (selected.includes("packs")) {
    if (summary.packs) {
      if (summary.packs.selectionMode === "latest-mtime-fallback") {
        logInfo("[Analyze] Using latest deps directory by mtime fallback; pass `--deps-hash` to pin a specific deps state.");
      }
      printPackSummary(summary.packs);
    } else {
      console.log("\n Vendor packs (v2)\n No deps pack index found.");
    }
  }

  if (selected.includes("routes")) {
    if (summary.routes) printRouteSummary(summary.routes);
    else console.log("\n Routes\n Routes: unavailable (no route-hint state found)");
  }

  if (selected.includes("findings")) {
    if (summary.findings) printFindingsSummary(summary.findings);
    else console.log("\n Findings\n No duplicate-version or bloat findings available.");
  }
}
