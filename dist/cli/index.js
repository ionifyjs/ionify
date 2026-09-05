#!/usr/bin/env node
import {
  FEDERATION_GRAPH_PREFIX,
  Graph,
  LOCKFILE_ORDER,
  MODULE_PREFIX,
  PRODUCTION_PLAN_OUTPUT_VERSION,
  REACT_REFRESH_HMR_CONTRACT_VERSION,
  REACT_REFRESH_RUNTIME_MODULE,
  TransformWorkerPool,
  VendorPackV2IndexManager,
  WS_MODULE_PREFIX,
  admitTransformArtifact,
  analyzeFeaturePackSharedClosurePressure,
  applyDefineReplacements,
  applyParserEnv,
  auditProductionSourceFreshness,
  buildCanonicalDepFileNameIndex,
  buildDefineConfig,
  buildFederationConfigGraphNodes,
  buildFederationVersionContract,
  cacheDepRegistration,
  canonicalizeDepFileName,
  canonicalizeDepUsageIndex,
  classifyImportSpecifiersForGraph,
  clearProductionPublicationProgress,
  collectConfiguredExternalSpecifiers,
  collectFederationExposeEntryPaths,
  collectFederationRemoteImportBindings,
  collectNativeExternalModules,
  compileCss,
  computeChunkGroupIdFromStableIds,
  computeCssDemandGraphContentStamp,
  computeDefineSignature,
  computeDepsHash,
  computeSubpathFromEntryPath,
  createPartialProductionReadinessRecord,
  createProductionGraphVersionInputs,
  createProductionPublicationState,
  decodePublicPath,
  depsFileNameFromRuntimeUrl,
  deriveFeaturePackRoutingMap,
  extractImports,
  formatDepsRuntimeUrl,
  fromWsModuleId,
  generateBuildPlan,
  getCasArtifactPath,
  getDepEntry,
  hasReactRootRenderSideEffect,
  importNativeConfigModule,
  instrumentReactRefresh,
  isCoreSingletonDepFileName,
  isCssLikeExt,
  isCssLikePath,
  isCssModuleLikePath,
  isFeaturePackSlimAligned,
  isForbiddenFsPath,
  loadDepStopsFromManifest,
  loadEnv,
  loadIonifyConfig,
  localSourceExtensions,
  planAutoFeaturePackGroups,
  prepareCanonicalProductionDependencyPlan,
  publicPathForFile,
  readLockfile,
  readProductionPublicationPlan,
  readProductionPublicationState,
  reconcilePackEntries,
  registerCssDemandGraphSourceFiles,
  registerDepEntry,
  renderCssModule,
  renderCssRawStringModule,
  renderCssTokensModule,
  renderCssUrlModule,
  resolveChunkedPackEntries,
  resolveImport,
  resolveMinifier,
  resolveParser,
  resolveProductionBuildEntries,
  resolveProductionChunkPolicy,
  resolveScopeHoist,
  resolveTreeshake,
  resolveWorkspace,
  restoreCachedDepRegistrations,
  rewriteCssUrls,
  rewriteFederationGraphEdgeIds,
  runBuildCommand,
  scanDepUsage,
  substituteEnvPlaceholders,
  summarizePlanForPublication,
  toWsModuleId,
  vendorPackV2MemberKey,
  writeProductionPublicationPlan,
  writeProductionPublicationProgress,
  writeProductionPublicationReadinessRecord,
  writeProductionPublicationState,
  writeTransformArtifact
} from "../chunk-DDE1B75E.js";
import {
  computeGraphVersion,
  ensureNativeGraph,
  getCacheKey,
  getDepsOptimizerOutputVersion,
  native,
  tryBundleNodeModule,
  tryNativeTransform
} from "../chunk-PQP3Y562.js";
import {
  resolveCloudProfile,
  resolveCloudToken,
  runLoginCommand,
  runLogoutCommand,
  runWhoamiCommand,
  selectMenu
} from "../chunk-M5MAIMAN.js";
import {
  logError,
  logInfo,
  logWarn
} from "../chunk-SNACSSNX.js";
import "../chunk-F84D9131.js";

// src/cli/index.ts
import { readFileSync } from "fs";
import { fileURLToPath as fileURLToPath2 } from "url";
import { dirname, join } from "path";
import { Command, Option } from "commander";

// src/cli/commands/dev.ts
import http from "http";
import https from "https";
import url from "url";
import { spawn } from "child_process";
import fs8 from "fs";
import path7 from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import selfsigned from "selfsigned";

// src/core/deps/dep-coupling.ts
import fs from "fs";
import path from "path";
var NULL_PKG_INFO = { name: "", peerDeps: [] };
function isRealPackageName(name) {
  if (!name) return false;
  if (name.startsWith("@")) {
    const slashCount = (name.match(/\//g) ?? []).length;
    return slashCount === 1;
  }
  return !name.includes("/");
}
function readPackageJsonForEntry(entryPath, cache) {
  let dir = path.dirname(entryPath);
  for (let depth = 0; depth < 12; depth += 1) {
    const cached = cache.get(dir);
    if (cached) return cached;
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const text = fs.readFileSync(pkgPath, "utf8");
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object") {
          const name = typeof parsed.name === "string" ? parsed.name : "";
          if (isRealPackageName(name)) {
            const peerObj = parsed.peerDependencies;
            const peerDeps = peerObj && typeof peerObj === "object" && !Array.isArray(peerObj) ? Object.keys(peerObj).filter((k) => typeof k === "string" && k.length > 0) : [];
            const info = { name, peerDeps };
            cache.set(dir, info);
            return info;
          }
        }
      } catch {
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  cache.set(path.dirname(entryPath), NULL_PKG_INFO);
  return NULL_PKG_INFO;
}
var UnionFind = class {
  parent = /* @__PURE__ */ new Map();
  add(x) {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }
  find(x) {
    let cur = this.parent.get(x);
    if (cur === void 0) {
      this.parent.set(x, x);
      return x;
    }
    while (cur !== this.parent.get(cur)) {
      const next = this.parent.get(cur);
      this.parent.set(cur, this.parent.get(next));
      cur = this.parent.get(cur);
    }
    return cur;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
};
function extractDepCouplingGroups(candidates) {
  if (!candidates || candidates.length === 0) return [];
  const pkgCache = /* @__PURE__ */ new Map();
  const packageToFiles = /* @__PURE__ */ new Map();
  const fileToInfo = /* @__PURE__ */ new Map();
  for (const candidate of candidates) {
    if (!candidate?.fileName || !candidate?.entryPath) continue;
    const info = readPackageJsonForEntry(candidate.entryPath, pkgCache);
    if (!info.name) continue;
    fileToInfo.set(candidate.fileName, info);
    let bucket = packageToFiles.get(info.name);
    if (!bucket) {
      bucket = /* @__PURE__ */ new Set();
      packageToFiles.set(info.name, bucket);
    }
    bucket.add(candidate.fileName);
  }
  if (fileToInfo.size === 0) return [];
  const uf = new UnionFind();
  for (const fileName of fileToInfo.keys()) uf.add(fileName);
  for (const [fileName, info] of fileToInfo.entries()) {
    const sameNameFiles = packageToFiles.get(info.name);
    if (sameNameFiles && sameNameFiles.size > 1) {
      for (const peerFile of sameNameFiles) {
        if (peerFile === fileName) continue;
        uf.union(fileName, peerFile);
      }
    }
    if (info.peerDeps.length === 0) continue;
    for (const peerName of info.peerDeps) {
      const peerFiles = packageToFiles.get(peerName);
      if (!peerFiles || peerFiles.size === 0) continue;
      for (const peerFile of peerFiles) {
        if (peerFile === fileName) continue;
        uf.union(fileName, peerFile);
      }
    }
  }
  const groups = /* @__PURE__ */ new Map();
  for (const fileName of fileToInfo.keys()) {
    const root = uf.find(fileName);
    let bucket = groups.get(root);
    if (!bucket) {
      bucket = /* @__PURE__ */ new Set();
      groups.set(root, bucket);
    }
    bucket.add(fileName);
  }
  return Array.from(groups.values()).filter((g) => g.size >= 2);
}

// src/core/deps/routing-hash.ts
function isObject(value) {
  return !!value && typeof value === "object";
}
function hashFeaturePackRoutingIndex(index, depsHash, outputVersion) {
  if (!isObject(index)) return null;
  const parsed = index;
  if (parsed.version !== 1 || parsed.depsHash !== depsHash || parsed.outputVersion !== outputVersion) {
    return null;
  }
  const mapping = parsed.fileNameToChunkGroupId;
  const entries = [];
  if (isObject(mapping)) {
    for (const [fileName, chunkGroupId] of Object.entries(mapping)) {
      if (typeof fileName !== "string" || typeof chunkGroupId !== "string") continue;
      entries.push([fileName, chunkGroupId]);
    }
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  let body = `feature-pack-index:v1:${depsHash}
`;
  for (const [fileName, chunkGroupId] of entries) {
    body += `${fileName}=${chunkGroupId}
`;
  }
  return getCacheKey(body);
}
function hashVendorPackV2RoutingIndex(index, depsHash, outputVersion) {
  if (!isObject(index)) return null;
  const parsed = index;
  if (parsed.version !== 1 || parsed.depsHash !== depsHash || parsed.outputVersion !== outputVersion) {
    return null;
  }
  const packShared = isObject(parsed.packFileToSharedFile) ? parsed.packFileToSharedFile : {};
  const packKey = isObject(parsed.packFileToKey) ? parsed.packFileToKey : {};
  const packChunks = isObject(parsed.packFileToChunkFiles) ? parsed.packFileToChunkFiles : {};
  const routing = isObject(parsed.fileNameToPackFile) ? parsed.fileNameToPackFile : {};
  const sharedEntries = [];
  for (const [packFile, sharedFile] of Object.entries(packShared)) {
    if (typeof packFile !== "string" || typeof sharedFile !== "string") continue;
    sharedEntries.push([packFile, sharedFile]);
  }
  sharedEntries.sort((a, b) => a[0].localeCompare(b[0]));
  const keyEntries = [];
  for (const [packFile, key] of Object.entries(packKey)) {
    if (typeof packFile !== "string" || typeof key !== "string") continue;
    keyEntries.push([packFile, key.trim().toLowerCase()]);
  }
  keyEntries.sort((a, b) => a[0].localeCompare(b[0]));
  const chunkEntries = [];
  for (const [packFile, chunkFiles] of Object.entries(packChunks)) {
    if (typeof packFile !== "string" || !Array.isArray(chunkFiles)) continue;
    const normalized = chunkFiles.map((v) => typeof v === "string" ? v : "").filter(Boolean).slice().sort();
    const unique = [];
    for (const file of normalized) {
      if (unique.length === 0 || unique[unique.length - 1] !== file) unique.push(file);
    }
    chunkEntries.push([packFile, unique]);
  }
  chunkEntries.sort((a, b) => a[0].localeCompare(b[0]));
  const routeEntries = [];
  for (const [fileName, packFile] of Object.entries(routing)) {
    if (typeof fileName !== "string" || typeof packFile !== "string") continue;
    routeEntries.push([fileName, packFile]);
  }
  routeEntries.sort((a, b) => a[0].localeCompare(b[0]));
  let body = `vendor-pack-v2-index:v1:${depsHash}
`;
  for (const [packFile, sharedFile] of sharedEntries) {
    body += `shared:${packFile}=${sharedFile}
`;
  }
  for (const [packFile, key] of keyEntries) {
    body += `key:${packFile}=${key}
`;
  }
  for (const [packFile, files] of chunkEntries) {
    body += `chunks:${packFile}=${files.join(",")}
`;
  }
  for (const [fileName, packFile] of routeEntries) {
    body += `route:${fileName}=${packFile}
`;
  }
  return getCacheKey(body);
}

// src/core/deps/preload-routing.ts
function uniqueStrings(values) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
function getCurrentPackFiles(packFileToChunkFiles, packFileToSharedFile) {
  return /* @__PURE__ */ new Set([
    ...packFileToChunkFiles.keys(),
    ...packFileToSharedFile.keys()
  ]);
}
function findOwningPackFiles(fileName, packFileToChunkFiles, packFileToSharedFile) {
  const owners = [];
  for (const [packFile, chunkFiles] of packFileToChunkFiles.entries()) {
    if (chunkFiles.includes(fileName)) owners.push(packFile);
  }
  for (const [packFile, sharedFileName] of packFileToSharedFile.entries()) {
    if (sharedFileName === fileName) owners.push(packFile);
  }
  return uniqueStrings(owners);
}
function isCurrentSharedFile(fileName, packFileToChunkFiles, packFileToSharedFile, currentStableSharedFileNames) {
  if (currentStableSharedFileNames.includes(fileName)) return true;
  for (const chunkFiles of packFileToChunkFiles.values()) {
    if (chunkFiles.includes(fileName)) return true;
  }
  for (const sharedFileName of packFileToSharedFile.values()) {
    if (sharedFileName === fileName) return true;
  }
  return false;
}
function resolveAuthoritativeDepPreloadFiles(options) {
  const { fileName, fileExists, fileNameToPackFile, packFileToChunkFiles, packFileToSharedFile } = options;
  if (!fileName || !fileName.endsWith(".js")) return [];
  const currentStableSharedFileNames = Array.isArray(options.currentStableSharedFileNames) ? options.currentStableSharedFileNames.filter((value) => typeof value === "string" && value.endsWith(".js")) : [];
  const routedPackFile = fileNameToPackFile.get(fileName) ?? null;
  if (routedPackFile) {
    const chunkFiles = packFileToChunkFiles.get(routedPackFile) ?? (() => {
      const shared = packFileToSharedFile.get(routedPackFile) ?? null;
      return shared ? [shared] : [];
    })();
    return uniqueStrings([...chunkFiles.filter(fileExists), routedPackFile].filter(fileExists));
  }
  const currentPackFiles = getCurrentPackFiles(packFileToChunkFiles, packFileToSharedFile);
  if (fileName.startsWith("vendor-pack.")) {
    if (!currentPackFiles.has(fileName)) return [];
  }
  if (currentPackFiles.has(fileName)) {
    const chunkFiles = packFileToChunkFiles.get(fileName) ?? (() => {
      const shared = packFileToSharedFile.get(fileName) ?? null;
      return shared ? [shared] : [];
    })();
    return uniqueStrings([...chunkFiles.filter(fileExists), fileName].filter(fileExists));
  }
  if (fileName.startsWith("shared.")) {
    if (!isCurrentSharedFile(fileName, packFileToChunkFiles, packFileToSharedFile, currentStableSharedFileNames)) {
      return [];
    }
    if (!fileExists(fileName)) return [];
    const owningPackFiles = findOwningPackFiles(fileName, packFileToChunkFiles, packFileToSharedFile).filter(fileExists);
    return uniqueStrings([fileName, ...owningPackFiles]);
  }
  return fileExists(fileName) ? [fileName] : [];
}

// src/core/route-hints.ts
import fs2 from "fs";
var ROUTE_HINT_STATE_VERSION = 1;
var CLIENT_CONTEXT_TTL_MS = 3e4;
var MAX_TRACKED_ROUTES = 64;
var MAX_TRACKED_ASSETS_PER_ROUTE = 256;
function toIsoString(value) {
  const safe = Number.isFinite(value) ? value : Date.now();
  return new Date(safe).toISOString();
}
function parseTimestamp(value) {
  if (typeof value !== "string" || value.length === 0) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function normalizeHintUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed, "http://ionify.local");
    if (!parsed.pathname.startsWith("/")) return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}
function normalizeDocumentRouteKey(value) {
  const normalized = normalizeHintUrl(value) ?? "/";
  const queryIndex = normalized.indexOf("?");
  let pathname = queryIndex === -1 ? normalized : normalized.slice(0, queryIndex);
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  pathname = pathname.replace(/\/index\.html$/i, "/");
  if (pathname.endsWith(".html") && pathname.length > ".html".length) {
    pathname = pathname.slice(0, -".html".length);
  }
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
  return pathname || "/";
}
function readJsonFile(filePath) {
  if (!fs2.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs2.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
function writeJsonFile(filePath, data) {
  try {
    fs2.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  } catch {
  }
}
var RouteHintIndex = class {
  statePath;
  routes = /* @__PURE__ */ new Map();
  requestRouteContext = /* @__PURE__ */ new Map();
  clientRouteContext = /* @__PURE__ */ new Map();
  dirty = false;
  saveTimer = null;
  constructor(statePath) {
    this.statePath = statePath;
    this.loadFromDisk();
  }
  loadFromDisk() {
    const raw = readJsonFile(this.statePath);
    if (!raw || raw.version !== ROUTE_HINT_STATE_VERSION || typeof raw.routes !== "object" || !raw.routes) {
      return;
    }
    for (const [routeKeyRaw, routeRaw] of Object.entries(raw.routes)) {
      const routeKey = normalizeDocumentRouteKey(routeKeyRaw);
      const documents = typeof routeRaw?.documents === "number" && Number.isFinite(routeRaw.documents) && routeRaw.documents > 0 ? Math.floor(routeRaw.documents) : 0;
      const updatedAtMs = parseTimestamp(routeRaw?.updatedAt);
      const assets = /* @__PURE__ */ new Map();
      const rawAssets = routeRaw?.assets && typeof routeRaw.assets === "object" ? routeRaw.assets : {};
      for (const [url2, assetRaw] of Object.entries(rawAssets)) {
        const normalizedUrl = normalizeHintUrl(url2);
        if (!normalizedUrl) continue;
        if (assetRaw?.kind !== "dep" && assetRaw?.kind !== "source") continue;
        const requestCount = typeof assetRaw?.requestCount === "number" && Number.isFinite(assetRaw.requestCount) && assetRaw.requestCount > 0 ? Math.floor(assetRaw.requestCount) : 0;
        if (requestCount <= 0) continue;
        const minDepth = typeof assetRaw?.minDepth === "number" && Number.isFinite(assetRaw.minDepth) && assetRaw.minDepth >= 0 ? Math.floor(assetRaw.minDepth) : 0;
        assets.set(normalizedUrl, {
          kind: assetRaw.kind,
          requestCount,
          minDepth,
          lastSeenAtMs: parseTimestamp(assetRaw.lastSeenAt)
        });
      }
      if (documents <= 0 && assets.size === 0) continue;
      this.routes.set(routeKey, {
        documents,
        updatedAtMs,
        assets
      });
    }
    this.prunePersistedState();
  }
  queueSave() {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 250);
  }
  pruneEphemeralContexts(nowMs) {
    for (const [key, value] of this.requestRouteContext) {
      if (nowMs - value.observedAtMs > CLIENT_CONTEXT_TTL_MS) {
        this.requestRouteContext.delete(key);
      }
    }
    for (const [key, value] of this.clientRouteContext) {
      if (nowMs - value.observedAtMs > CLIENT_CONTEXT_TTL_MS) {
        this.clientRouteContext.delete(key);
      }
    }
  }
  prunePersistedState() {
    const sortedRoutes = Array.from(this.routes.entries()).sort((a, b) => {
      const updatedDelta = b[1].updatedAtMs - a[1].updatedAtMs;
      if (updatedDelta !== 0) return updatedDelta;
      return a[0].localeCompare(b[0]);
    });
    for (const [, route] of sortedRoutes) {
      const sortedAssets = Array.from(route.assets.entries()).sort((a, b) => {
        const depthDelta = a[1].minDepth - b[1].minDepth;
        if (depthDelta !== 0) return depthDelta;
        const requestDelta = b[1].requestCount - a[1].requestCount;
        if (requestDelta !== 0) return requestDelta;
        return a[0].localeCompare(b[0]);
      });
      for (const [url2] of sortedAssets.slice(MAX_TRACKED_ASSETS_PER_ROUTE)) {
        route.assets.delete(url2);
      }
    }
    for (const [routeKey] of sortedRoutes.slice(MAX_TRACKED_ROUTES)) {
      this.routes.delete(routeKey);
    }
  }
  getOrCreateRoute(routeKey, observedAtMs) {
    const normalized = normalizeDocumentRouteKey(routeKey);
    const existing = this.routes.get(normalized);
    if (existing) {
      existing.updatedAtMs = Math.max(existing.updatedAtMs, observedAtMs);
      return existing;
    }
    const created = {
      documents: 0,
      updatedAtMs: observedAtMs,
      assets: /* @__PURE__ */ new Map()
    };
    this.routes.set(normalized, created);
    return created;
  }
  beginDocument(options) {
    const observedAtMs = options.observedAtMs ?? Date.now();
    const routeKey = normalizeDocumentRouteKey(options.routeKey);
    const documentUrl = normalizeHintUrl(options.documentUrl);
    if (!documentUrl) return;
    this.pruneEphemeralContexts(observedAtMs);
    const route = this.getOrCreateRoute(routeKey, observedAtMs);
    route.documents += 1;
    route.updatedAtMs = observedAtMs;
    this.requestRouteContext.set(documentUrl, {
      routeKey,
      depth: 0,
      observedAtMs
    });
    const clientKey = typeof options.clientKey === "string" ? options.clientKey.trim() : "";
    if (clientKey) {
      this.clientRouteContext.set(clientKey, { routeKey, observedAtMs });
    }
    this.prunePersistedState();
    this.queueSave();
  }
  resolveRouteContext(options) {
    const refererUrl = normalizeHintUrl(options.refererUrl);
    if (refererUrl) {
      const routeContext = this.requestRouteContext.get(refererUrl);
      if (routeContext) {
        return {
          routeKey: routeContext.routeKey,
          depth: routeContext.depth + 1
        };
      }
    }
    const clientKey = typeof options.clientKey === "string" ? options.clientKey.trim() : "";
    if (clientKey) {
      const clientContext = this.clientRouteContext.get(clientKey);
      if (clientContext && options.observedAtMs - clientContext.observedAtMs <= CLIENT_CONTEXT_TTL_MS) {
        return {
          routeKey: clientContext.routeKey,
          depth: 1
        };
      }
    }
    return null;
  }
  noteRequest(options) {
    const observedAtMs = options.observedAtMs ?? Date.now();
    const url2 = normalizeHintUrl(options.url);
    if (!url2) return false;
    this.pruneEphemeralContexts(observedAtMs);
    const resolved = this.resolveRouteContext({
      refererUrl: options.refererUrl,
      clientKey: options.clientKey,
      observedAtMs
    });
    if (!resolved) return false;
    const route = this.getOrCreateRoute(resolved.routeKey, observedAtMs);
    const existing = route.assets.get(url2);
    if (existing) {
      existing.requestCount += 1;
      existing.minDepth = Math.min(existing.minDepth, resolved.depth);
      existing.lastSeenAtMs = observedAtMs;
      if (existing.kind !== options.kind && existing.kind === "source") {
        existing.kind = options.kind;
      }
    } else {
      route.assets.set(url2, {
        kind: options.kind,
        requestCount: 1,
        minDepth: resolved.depth,
        lastSeenAtMs: observedAtMs
      });
    }
    route.updatedAtMs = observedAtMs;
    this.requestRouteContext.set(url2, {
      routeKey: resolved.routeKey,
      depth: resolved.depth,
      observedAtMs
    });
    this.prunePersistedState();
    this.queueSave();
    return true;
  }
  getPrimaryRouteKey() {
    const routes = Array.from(this.routes.entries()).sort((a, b) => {
      const documentDelta = b[1].documents - a[1].documents;
      if (documentDelta !== 0) return documentDelta;
      const updatedDelta = b[1].updatedAtMs - a[1].updatedAtMs;
      if (updatedDelta !== 0) return updatedDelta;
      return a[0].localeCompare(b[0]);
    });
    return routes[0]?.[0] ?? null;
  }
  summarizeAssets(kind) {
    const aggregated = /* @__PURE__ */ new Map();
    for (const [routeKey, route] of this.routes) {
      for (const [url2, asset] of route.assets) {
        if (kind && asset.kind !== kind) continue;
        const existing = aggregated.get(url2);
        if (existing) {
          existing.totalRequestCount += asset.requestCount;
          existing.minDepth = Math.min(existing.minDepth, asset.minDepth);
          existing.routeRequestCounts.set(routeKey, (existing.routeRequestCounts.get(routeKey) ?? 0) + asset.requestCount);
          continue;
        }
        aggregated.set(url2, {
          kind: asset.kind,
          totalRequestCount: asset.requestCount,
          minDepth: asset.minDepth,
          routeRequestCounts: /* @__PURE__ */ new Map([[routeKey, asset.requestCount]])
        });
      }
    }
    return Array.from(aggregated.entries()).map(([url2, asset]) => {
      const routeRequestCounts = {};
      const routeKeys = Array.from(asset.routeRequestCounts.keys()).sort();
      for (const routeKey of routeKeys) {
        routeRequestCounts[routeKey] = asset.routeRequestCounts.get(routeKey) ?? 0;
      }
      return {
        url: url2,
        kind: asset.kind,
        totalRequestCount: asset.totalRequestCount,
        minDepth: asset.minDepth,
        routeKeys,
        routeRequestCounts
      };
    }).sort((a, b) => {
      const requestDelta = b.totalRequestCount - a.totalRequestCount;
      if (requestDelta !== 0) return requestDelta;
      const depthDelta = a.minDepth - b.minDepth;
      if (depthDelta !== 0) return depthDelta;
      return a.url.localeCompare(b.url);
    });
  }
  listRouteKeys() {
    return Array.from(this.routes.keys()).sort();
  }
  getRouteAssetEntries(routeKey, kind) {
    const normalizedRouteKey = normalizeDocumentRouteKey(routeKey || "/");
    const route = this.routes.get(normalizedRouteKey);
    if (!route) return [];
    return Array.from(route.assets.entries()).map(([url2, asset]) => ({
      url: url2,
      kind: asset.kind,
      requestCount: asset.requestCount,
      minDepth: asset.minDepth,
      lastSeenAtMs: asset.lastSeenAtMs
    })).filter((entry) => !kind || entry.kind === kind).sort((a, b) => {
      const requestDelta = b.requestCount - a.requestCount;
      if (requestDelta !== 0) return requestDelta;
      const depthDelta = a.minDepth - b.minDepth;
      if (depthDelta !== 0) return depthDelta;
      return a.url.localeCompare(b.url);
    });
  }
  selectPreloads(routeKey, options) {
    const normalizedRouteKey = normalizeDocumentRouteKey(routeKey || this.getPrimaryRouteKey() || "/");
    const maxEntries = typeof options?.maxEntries === "number" && Number.isFinite(options.maxEntries) && options.maxEntries > 0 ? Math.floor(options.maxEntries) : 24;
    const maxDepEntries = typeof options?.maxDepEntries === "number" && Number.isFinite(options.maxDepEntries) && options.maxDepEntries >= 0 ? Math.floor(options.maxDepEntries) : maxEntries;
    const maxSourceEntries = typeof options?.maxSourceEntries === "number" && Number.isFinite(options.maxSourceEntries) && options.maxSourceEntries >= 0 ? Math.floor(options.maxSourceEntries) : maxEntries;
    const minRequestCount = typeof options?.minRequestCount === "number" && Number.isFinite(options.minRequestCount) && options.minRequestCount > 0 ? Math.floor(options.minRequestCount) : 1;
    const candidates = this.summarizeAssets().map((summary) => ({
      ...summary,
      routeRequestCount: summary.routeRequestCounts[normalizedRouteKey] ?? 0
    })).filter((summary) => summary.totalRequestCount >= minRequestCount).filter((summary) => {
      if (summary.routeKeys.length === 0) return true;
      if (summary.routeRequestCount > 0) return true;
      return summary.routeKeys.length === 1 && summary.routeKeys[0] === normalizedRouteKey;
    }).sort((a, b) => {
      const routeDelta = b.routeRequestCount - a.routeRequestCount;
      if (routeDelta !== 0) return routeDelta;
      const depthDelta = a.minDepth - b.minDepth;
      if (depthDelta !== 0) return depthDelta;
      const totalDelta = b.totalRequestCount - a.totalRequestCount;
      if (totalDelta !== 0) return totalDelta;
      if (a.kind !== b.kind) return a.kind === "dep" ? -1 : 1;
      return a.url.localeCompare(b.url);
    });
    const selected = [];
    let depCount = 0;
    let sourceCount = 0;
    for (const candidate of candidates) {
      if (selected.length >= maxEntries) break;
      if (candidate.kind === "dep") {
        if (depCount >= maxDepEntries) continue;
        depCount += 1;
      } else {
        if (sourceCount >= maxSourceEntries) continue;
        sourceCount += 1;
      }
      selected.push({
        url: candidate.url,
        kind: candidate.kind,
        routeRequestCount: candidate.routeRequestCount,
        totalRequestCount: candidate.totalRequestCount,
        minDepth: candidate.minDepth
      });
    }
    return selected;
  }
  flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.dirty) return;
    const routeEntries = Array.from(this.routes.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const routes = {};
    for (const [routeKey, route] of routeEntries) {
      const assetEntries = Array.from(route.assets.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      const assets = {};
      for (const [url2, asset] of assetEntries) {
        assets[url2] = {
          kind: asset.kind,
          requestCount: asset.requestCount,
          minDepth: asset.minDepth,
          lastSeenAt: toIsoString(asset.lastSeenAtMs)
        };
      }
      routes[routeKey] = {
        documents: route.documents,
        updatedAt: toIsoString(route.updatedAtMs),
        assets
      };
    }
    writeJsonFile(this.statePath, {
      version: ROUTE_HINT_STATE_VERSION,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      routes
    });
    this.dirty = false;
  }
};

// src/core/startup-policy.ts
import fs3 from "fs";
var STARTUP_OBSERVATION_VERSION = 1;
var STARTUP_POLICY_VERSION = 1;
var MAX_EAGER_DEP_ASSETS = 10;
var MAX_EAGER_SOURCE_ASSETS = 16;
var DEFAULT_EAGER_BUDGET = {
  minRouteDocuments: 1,
  maxEagerDepAssets: MAX_EAGER_DEP_ASSETS,
  maxEagerSourceAssets: MAX_EAGER_SOURCE_ASSETS,
  maxEagerTotalAssets: MAX_EAGER_DEP_ASSETS + MAX_EAGER_SOURCE_ASSETS,
  maxEagerDepBytes: Number.POSITIVE_INFINITY,
  maxEagerSourceBytes: Number.POSITIVE_INFINITY,
  maxEagerTotalBytes: Number.POSITIVE_INFINITY
};
function readJsonFile2(filePath) {
  if (!fs3.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs3.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
function writeJsonFile2(filePath, data) {
  try {
    fs3.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  } catch {
  }
}
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort((a, b) => a[0].localeCompare(b[0]));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function countObservationAssets(assets, kind) {
  return Object.values(assets).reduce((sum, asset) => sum + (asset.kind === kind ? asset.count : 0), 0);
}
function finitePositiveOrDefault(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
function resolveEagerBudget(budget) {
  return {
    minRouteDocuments: finitePositiveOrDefault(budget?.minRouteDocuments, DEFAULT_EAGER_BUDGET.minRouteDocuments),
    maxEagerDepAssets: finitePositiveOrDefault(budget?.maxEagerDepAssets, DEFAULT_EAGER_BUDGET.maxEagerDepAssets),
    maxEagerSourceAssets: finitePositiveOrDefault(
      budget?.maxEagerSourceAssets,
      DEFAULT_EAGER_BUDGET.maxEagerSourceAssets
    ),
    maxEagerTotalAssets: finitePositiveOrDefault(
      budget?.maxEagerTotalAssets,
      DEFAULT_EAGER_BUDGET.maxEagerTotalAssets
    ),
    maxEagerDepBytes: finitePositiveOrDefault(budget?.maxEagerDepBytes, DEFAULT_EAGER_BUDGET.maxEagerDepBytes),
    maxEagerSourceBytes: finitePositiveOrDefault(
      budget?.maxEagerSourceBytes,
      DEFAULT_EAGER_BUDGET.maxEagerSourceBytes
    ),
    maxEagerTotalBytes: finitePositiveOrDefault(
      budget?.maxEagerTotalBytes,
      DEFAULT_EAGER_BUDGET.maxEagerTotalBytes
    )
  };
}
function sumAssetBytes(assets) {
  return assets.reduce((sum, asset) => sum + Math.max(0, asset.sizeBytes ?? 0), 0);
}
function selectBudgetedEagerAssets(assets, routeDocuments, rawBudget) {
  const budget = resolveEagerBudget(rawBudget);
  if (routeDocuments < budget.minRouteDocuments) return [];
  const eagerCandidates = assets.filter((asset) => asset.classification === "entry-critical");
  const eagerDepAssets = eagerCandidates.filter((asset) => asset.kind === "dep");
  const eagerSourceAssets = eagerCandidates.filter((asset) => asset.kind === "source");
  const depBytes = sumAssetBytes(eagerDepAssets);
  const sourceBytes = sumAssetBytes(eagerSourceAssets);
  const totalBytes = depBytes + sourceBytes;
  const closureFits = eagerCandidates.length <= budget.maxEagerTotalAssets && eagerDepAssets.length <= budget.maxEagerDepAssets && eagerSourceAssets.length <= budget.maxEagerSourceAssets && depBytes <= budget.maxEagerDepBytes && sourceBytes <= budget.maxEagerSourceBytes && totalBytes <= budget.maxEagerTotalBytes;
  if (!closureFits) return [];
  return eagerCandidates.slice().sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dep" ? -1 : 1;
    const evalDelta = b.observedPreFcpEvaluatedCount - a.observedPreFcpEvaluatedCount;
    if (evalDelta !== 0) return evalDelta;
    const loadDelta = b.observedPreFcpLoadedCount - a.observedPreFcpLoadedCount;
    if (loadDelta !== 0) return loadDelta;
    const sizeDelta = Math.max(0, a.sizeBytes ?? 0) - Math.max(0, b.sizeBytes ?? 0);
    if (sizeDelta !== 0) return sizeDelta;
    return a.url.localeCompare(b.url);
  });
}
var StartupObservationIndex = class {
  statePath;
  routes = /* @__PURE__ */ new Map();
  constructor(statePath) {
    this.statePath = statePath;
    this.loadFromDisk();
  }
  loadFromDisk() {
    const raw = readJsonFile2(this.statePath);
    if (!raw || raw.version !== STARTUP_OBSERVATION_VERSION || typeof raw.routes !== "object" || !raw.routes) return;
    for (const [routeKey, state] of Object.entries(raw.routes)) {
      if (!routeKey || !state || typeof state !== "object") continue;
      this.routes.set(routeKey, {
        documents: Math.max(0, Math.floor(state.documents ?? 0)),
        preFcpLoaded: { ...state.preFcpLoaded ?? {} },
        preFcpEvaluated: { ...state.preFcpEvaluated ?? {} },
        updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : (/* @__PURE__ */ new Date(0)).toISOString()
      });
    }
  }
  getOrCreateRoute(routeKey) {
    const existing = this.routes.get(routeKey);
    if (existing) return existing;
    const created = {
      documents: 0,
      preFcpLoaded: {},
      preFcpEvaluated: {},
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.routes.set(routeKey, created);
    return created;
  }
  recordRouteObservation(options) {
    const routeKey = String(options.routeKey || "/").trim() || "/";
    const route = this.getOrCreateRoute(routeKey);
    route.documents += 1;
    route.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    const apply = (target, urls) => {
      for (const url2 of urls ?? []) {
        if (typeof url2 !== "string" || !url2.startsWith("/")) continue;
        const kind = url2.startsWith("/@deps/") ? "dep" : "source";
        const existing = target[url2];
        if (existing) {
          existing.count += 1;
        } else {
          target[url2] = { count: 1, kind };
        }
      }
    };
    apply(route.preFcpLoaded, options.preFcpLoadedUrls);
    apply(route.preFcpEvaluated, options.preFcpEvaluatedUrls);
    this.flush();
  }
  getRoute(routeKey) {
    return this.routes.get(routeKey) ?? null;
  }
  flush() {
    const routes = {};
    for (const routeKey of Array.from(this.routes.keys()).sort()) {
      const route = this.routes.get(routeKey);
      routes[routeKey] = {
        documents: route.documents,
        preFcpLoaded: Object.fromEntries(Object.entries(route.preFcpLoaded).sort((a, b) => a[0].localeCompare(b[0]))),
        preFcpEvaluated: Object.fromEntries(
          Object.entries(route.preFcpEvaluated).sort((a, b) => a[0].localeCompare(b[0]))
        ),
        updatedAt: route.updatedAt
      };
    }
    writeJsonFile2(this.statePath, {
      version: STARTUP_OBSERVATION_VERSION,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      routes
    });
  }
};
function buildStartupPolicySnapshot(options) {
  const assetSummaryByUrl = new Map(options.assetSummaries.map((summary) => [summary.url, summary]));
  const routes = {};
  const normalizedRouteKeys = Array.from(new Set(options.routeKeys.filter(Boolean))).sort();
  for (const routeKey of normalizedRouteKeys) {
    const routeAssets = options.routeAssetsForRoute(routeKey).filter((asset) => options.isAssetValid?.(asset.url, asset.kind) ?? true);
    const validRouteAssetUrls = new Set(routeAssets.map((asset) => asset.url));
    const observation = options.observations.getRoute(routeKey);
    const filterObservedAssets = (assets2) => {
      const filtered = {};
      for (const [assetUrl, asset] of Object.entries(assets2 ?? {})) {
        if (!validRouteAssetUrls.has(assetUrl)) continue;
        if (!(options.isAssetValid?.(assetUrl, asset.kind) ?? true)) continue;
        filtered[assetUrl] = asset;
      }
      return filtered;
    };
    const preFcpLoaded = filterObservedAssets(observation?.preFcpLoaded);
    const preFcpEvaluated = filterObservedAssets(observation?.preFcpEvaluated);
    const assets = routeAssets.map((asset) => {
      const summary = assetSummaryByUrl.get(asset.url);
      const totalRequestCount = summary?.totalRequestCount ?? asset.requestCount;
      const routeCount = summary?.routeKeys.length ?? 1;
      const routeRequestCount = summary?.routeRequestCounts?.[routeKey] ?? asset.requestCount;
      const observedPreFcpLoadedCount = preFcpLoaded[asset.url]?.count ?? 0;
      const observedPreFcpEvaluatedCount = preFcpEvaluated[asset.url]?.count ?? 0;
      const rawSizeBytes = options.assetSizeBytes?.(asset.url, asset.kind);
      const sizeBytes = typeof rawSizeBytes === "number" && Number.isFinite(rawSizeBytes) && rawSizeBytes >= 0 ? Math.floor(rawSizeBytes) : null;
      let classification;
      let eagerReason;
      if (observedPreFcpEvaluatedCount > 0) {
        classification = "entry-critical";
        eagerReason = "pre-fcp-evaluated";
      } else if (observedPreFcpLoadedCount > 0) {
        classification = "entry-critical";
        eagerReason = "pre-fcp-loaded";
      } else if (asset.kind === "source" && asset.minDepth <= 1) {
        classification = "entry-critical";
        eagerReason = "entry-shell-fallback";
      } else if (asset.kind === "dep" && routeCount > 1) {
        classification = "shared-later";
        eagerReason = "shared-route-history";
      } else if (asset.requestCount > 0) {
        classification = "route-lazy";
        eagerReason = "route-local-history";
      } else {
        classification = "background";
        eagerReason = "background-history";
      }
      return {
        url: asset.url,
        kind: asset.kind,
        classification,
        sizeBytes,
        requestCount: asset.requestCount,
        totalRequestCount,
        minDepth: asset.minDepth,
        routeCount,
        routeRequestCount,
        observedPreFcpLoadedCount,
        observedPreFcpEvaluatedCount,
        eagerReason
      };
    }).sort((a, b) => {
      const classOrder = (value) => value === "entry-critical" ? 0 : value === "shared-later" ? 1 : value === "route-lazy" ? 2 : 3;
      const classDelta = classOrder(a.classification) - classOrder(b.classification);
      if (classDelta !== 0) return classDelta;
      const evalDelta = b.observedPreFcpEvaluatedCount - a.observedPreFcpEvaluatedCount;
      if (evalDelta !== 0) return evalDelta;
      const loadDelta = b.observedPreFcpLoadedCount - a.observedPreFcpLoadedCount;
      if (loadDelta !== 0) return loadDelta;
      const requestDelta = b.routeRequestCount - a.routeRequestCount;
      if (requestDelta !== 0) return requestDelta;
      const depthDelta = a.minDepth - b.minDepth;
      if (depthDelta !== 0) return depthDelta;
      return a.url.localeCompare(b.url);
    });
    const eagerAssets = selectBudgetedEagerAssets(assets, observation?.documents ?? 0, options.eagerBudget);
    const routePayload = {
      routeKey,
      assets: assets.map((asset) => ({
        url: asset.url,
        classification: asset.classification,
        kind: asset.kind,
        requestCount: asset.requestCount,
        totalRequestCount: asset.totalRequestCount,
        minDepth: asset.minDepth,
        routeCount: asset.routeCount,
        routeRequestCount: asset.routeRequestCount,
        sizeBytes: asset.sizeBytes,
        observedPreFcpLoadedCount: asset.observedPreFcpLoadedCount,
        observedPreFcpEvaluatedCount: asset.observedPreFcpEvaluatedCount,
        eagerReason: asset.eagerReason
      }))
    };
    const policyHash = stableStringify(routePayload);
    routes[routeKey] = {
      routeKey,
      policyHash,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      assets,
      eagerAssets,
      stats: {
        entryCritical: assets.filter((asset) => asset.classification === "entry-critical").length,
        sharedLater: assets.filter((asset) => asset.classification === "shared-later").length,
        routeLazy: assets.filter((asset) => asset.classification === "route-lazy").length,
        background: assets.filter((asset) => asset.classification === "background").length,
        preFcpLoadedModules: Object.keys(preFcpLoaded).length,
        preFcpEvaluatedModules: Object.keys(preFcpEvaluated).length,
        preFcpLoadedDepModules: countObservationAssets(preFcpLoaded, "dep"),
        preFcpLoadedSourceModules: countObservationAssets(preFcpLoaded, "source"),
        preFcpEvaluatedDepModules: countObservationAssets(preFcpEvaluated, "dep"),
        preFcpEvaluatedSourceModules: countObservationAssets(preFcpEvaluated, "source")
      }
    };
  }
  const policyPayload = {
    routes: Object.fromEntries(
      Object.entries(routes).map(([routeKey, route]) => [
        routeKey,
        {
          policyHash: route.policyHash,
          eagerAssets: route.eagerAssets.map((asset) => `${asset.kind}:${asset.url}:${asset.classification}:${asset.eagerReason}`),
          stats: route.stats
        }
      ])
    )
  };
  return {
    version: STARTUP_POLICY_VERSION,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    policyHash: stableStringify(policyPayload),
    routes
  };
}
function loadStartupPolicySnapshot(filePath) {
  const raw = readJsonFile2(filePath);
  if (!raw || raw.version !== STARTUP_POLICY_VERSION || typeof raw.routes !== "object" || !raw.routes) return null;
  return raw;
}
function persistStartupPolicySnapshot(filePath, snapshot) {
  writeJsonFile2(filePath, snapshot);
}
function selectStartupPolicyPreloads(snapshot, routeKey) {
  const route = snapshot?.routes?.[routeKey] ?? null;
  if (!route) return [];
  return route.eagerAssets.map((asset) => ({
    url: asset.url,
    kind: asset.kind,
    routeRequestCount: asset.routeRequestCount,
    totalRequestCount: asset.totalRequestCount,
    minDepth: asset.minDepth
  }));
}

// src/core/resolver/module-resolver.ts
import path2 from "path";
import fs4 from "fs";
var DEFAULT_CONDITIONS = ["import", "default"];
var DEFAULT_MAIN_FIELDS = ["module", "main"];
var ModuleResolver = class {
  options;
  rootDir;
  metadataByPath = /* @__PURE__ */ new Map();
  constructor(rootDir, options = {}) {
    this.rootDir = rootDir;
    this.options = {
      baseUrl: options.baseUrl || ".",
      paths: options.paths || {},
      extensions: options.extensions || localSourceExtensions(),
      alias: options.alias || {},
      conditions: options.conditions || DEFAULT_CONDITIONS,
      mainFields: options.mainFields || DEFAULT_MAIN_FIELDS
    };
  }
  resolve(importSpecifier, importer) {
    if (path2.isAbsolute(importSpecifier)) {
      return this.tryResolveFile(importSpecifier);
    }
    const aliasResolved = this.resolveAlias(importSpecifier);
    if (aliasResolved) {
      return this.tryResolveFile(aliasResolved);
    }
    if (importSpecifier.startsWith(".")) {
      const resolvedPath = path2.resolve(path2.dirname(importer), importSpecifier);
      return this.tryResolveFile(resolvedPath);
    }
    return this.resolveBareModule(importSpecifier, importer);
  }
  getMetadata(resolvedPath) {
    return this.metadataByPath.get(resolvedPath);
  }
  resolveAlias(specifier) {
    for (const [alias, target] of Object.entries(this.options.alias)) {
      if (specifier === alias || specifier.startsWith(`${alias}/`)) {
        const relativePath = specifier.slice(alias.length);
        const targets = Array.isArray(target) ? target : [target];
        for (const t of targets) {
          const resolved = path2.join(this.rootDir, t, relativePath);
          if (fs4.existsSync(resolved)) {
            return resolved;
          }
        }
      }
    }
    for (const [pattern, targets] of Object.entries(this.options.paths)) {
      const wildcardIndex = pattern.indexOf("*");
      if (wildcardIndex === -1) {
        if (specifier === pattern) {
          return path2.join(this.rootDir, this.options.baseUrl, targets[0]);
        }
      } else {
        const prefix = pattern.slice(0, wildcardIndex);
        const suffix = pattern.slice(wildcardIndex + 1);
        if (specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
          const matchedPortion = specifier.slice(prefix.length, -suffix.length || void 0);
          for (const target of targets) {
            const resolved = path2.join(
              this.rootDir,
              this.options.baseUrl,
              target.replace("*", matchedPortion)
            );
            if (fs4.existsSync(resolved)) {
              return resolved;
            }
          }
        }
      }
    }
    return null;
  }
  resolveBareModule(specifier, importer) {
    const nativeResolved = native?.resolveModule?.(specifier, importer);
    if (nativeResolved?.kind) {
      const fsPath = nativeResolved.fsPath ?? nativeResolved.fs_path ?? null;
      const kind = normalizeResolveKind(nativeResolved.kind);
      if (kind === "pkg_cjs") {
        if (fsPath) {
          this.metadataByPath.set(fsPath, {
            format: "cjs",
            needsInterop: true
          });
        }
        if (process.env.IONIFY_DEBUG) {
          const name = nativeResolved.pkg?.name ?? specifier;
          console.log(`[resolver] CJS package detected: ${name} (conversion deferred)`);
        }
      }
      if (kind === "pkg_esm" && fsPath) {
        return fsPath;
      }
      if (kind === "pkg_cjs" && fsPath) {
        return fsPath;
      }
      if (kind === "local" && fsPath) {
        return fsPath;
      }
      return null;
    }
    const parts = specifier.split("/");
    const packageName = parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
    const subpath = parts.slice(packageName.startsWith("@") ? 2 : 1).join("/");
    let dir = path2.dirname(importer);
    while (dir !== "/") {
      const nodeModulesPath = path2.join(dir, "node_modules", packageName);
      if (fs4.existsSync(nodeModulesPath)) {
        if (subpath) {
          return this.tryResolveFile(path2.join(nodeModulesPath, subpath));
        }
        return this.resolvePackageMain(nodeModulesPath);
      }
      dir = path2.dirname(dir);
    }
    return null;
  }
  resolvePackageMain(packageDir) {
    const pkgJsonPath = path2.join(packageDir, "package.json");
    if (fs4.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs4.readFileSync(pkgJsonPath, "utf8"));
        if (pkg.exports) {
          const resolved = this.resolveExports(pkg.exports, packageDir);
          if (resolved) return resolved;
        }
        for (const field of this.options.mainFields) {
          if (pkg[field]) {
            const resolved = this.tryResolveFile(path2.join(packageDir, pkg[field]));
            if (resolved) return resolved;
          }
        }
      } catch {
      }
    }
    return this.tryResolveFile(path2.join(packageDir, "index"));
  }
  resolveExports(exports, packageDir) {
    if (typeof exports === "string") {
      return this.tryResolveFile(path2.join(packageDir, exports));
    }
    if (Array.isArray(exports)) {
      for (const exp of exports) {
        const resolved = this.resolveExports(exp, packageDir);
        if (resolved) return resolved;
      }
      return null;
    }
    if (typeof exports === "object") {
      for (const condition of this.options.conditions) {
        if (condition in exports) {
          const resolved = this.resolveExports(exports[condition], packageDir);
          if (resolved) return resolved;
        }
      }
      if ("default" in exports) {
        return this.resolveExports(exports.default, packageDir);
      }
    }
    return null;
  }
  tryResolveFile(filepath) {
    if (fs4.existsSync(filepath) && fs4.statSync(filepath).isFile()) {
      return filepath;
    }
    for (const ext of this.options.extensions) {
      const withExt = `${filepath}${ext}`;
      if (fs4.existsSync(withExt) && fs4.statSync(withExt).isFile()) {
        return withExt;
      }
    }
    if (fs4.existsSync(filepath) && fs4.statSync(filepath).isDirectory()) {
      for (const ext of this.options.extensions) {
        const indexFile = path2.join(filepath, `index${ext}`);
        if (fs4.existsSync(indexFile) && fs4.statSync(indexFile).isFile()) {
          return indexFile;
        }
      }
    }
    return null;
  }
};
function normalizeResolveKind(kind) {
  const mapping = {
    PkgEsm: "pkg_esm",
    PkgCjs: "pkg_cjs",
    Builtin: "builtin",
    Virtual: "virtual",
    Local: "local"
  };
  if (kind in mapping) {
    return mapping[kind];
  }
  return kind.toLowerCase();
}

// src/core/watcher.ts
import fs5 from "fs";
import path3 from "path";
import { EventEmitter } from "events";
var IonifyWatcher = class extends EventEmitter {
  constructor(rootDir) {
    super();
    this.rootDir = rootDir;
  }
  watchers = /* @__PURE__ */ new Map();
  debounce = /* @__PURE__ */ new Map();
  lastEmitted = /* @__PURE__ */ new Map();
  polled = /* @__PURE__ */ new Set();
  isWatched(filePath) {
    const abs = path3.resolve(filePath);
    return this.watchers.has(abs) || this.polled.has(abs);
  }
  watchFile(filePath, options = {}) {
    const abs = path3.resolve(filePath);
    if (this.isWatched(abs)) return;
    if (/(node_modules|\.git|\.ionify|dist)/.test(abs)) return;
    if (!fs5.existsSync(abs) && !options.allowMissing) return;
    try {
      const dir = path3.dirname(abs);
      const watcher = fs5.watch(dir, (event, filename) => {
        if (!filename) return;
        const full = path3.join(dir, filename.toString());
        if (full !== abs) return;
        const exists = fs5.existsSync(abs);
        const stat = exists ? fs5.statSync(abs) : null;
        this.emitChange(abs, exists ? "changed" : "deleted", stat);
      });
      watcher.on("error", () => {
        watcher.close();
        this.watchers.delete(abs);
      });
      this.watchers.set(abs, watcher);
      this.polled.add(abs);
      fs5.watchFile(abs, { interval: options.allowMissing ? 500 : 5e3 }, (curr, prev) => {
        if (curr.mtimeMs !== prev.mtimeMs || curr.nlink !== prev.nlink) {
          const status = curr.nlink === 0 ? "deleted" : prev.nlink === 0 ? "added" : "changed";
          this.emitChange(abs, status, curr.nlink === 0 ? null : curr);
        }
      });
    } catch {
      this.polled.add(abs);
      fs5.watchFile(abs, { interval: options.allowMissing ? 500 : 8e3 }, (curr, prev) => {
        if (curr.mtimeMs !== prev.mtimeMs || curr.nlink !== prev.nlink) {
          const status = curr.nlink === 0 ? "deleted" : prev.nlink === 0 ? "added" : "changed";
          this.emitChange(abs, status, curr.nlink === 0 ? null : curr);
        }
      });
    }
  }
  emitChange(abs, status, stat) {
    const now = Date.now();
    const last = this.debounce.get(abs) || 0;
    if (now - last < 100) return;
    const fingerprint = status === "deleted" ? "deleted" : stat ? `${status}:${stat.mtimeMs}:${stat.size}` : `${status}:unknown`;
    if (this.lastEmitted.get(abs) === fingerprint) return;
    this.debounce.set(abs, now);
    this.lastEmitted.set(abs, fingerprint);
    this.emit("change", abs, status);
  }
  unwatchFile(filePath) {
    const abs = path3.resolve(filePath);
    const watcher = this.watchers.get(abs);
    if (watcher) watcher.close();
    fs5.unwatchFile(abs);
    this.watchers.delete(abs);
    this.polled.delete(abs);
    this.debounce.delete(abs);
    this.lastEmitted.delete(abs);
  }
  closeAll() {
    for (const [abs, w] of this.watchers) {
      w.close();
      fs5.unwatchFile(abs);
    }
    this.watchers.clear();
    for (const abs of this.polled) {
      fs5.unwatchFile(abs);
    }
    this.polled.clear();
    this.debounce.clear();
    this.lastEmitted.clear();
  }
};

// src/core/transform.ts
var TransformCache = class {
  store = /* @__PURE__ */ new Map();
  hits = 0;
  misses = 0;
  maxEntries;
  constructor(maxEntries) {
    const envMax = process.env.IONIFY_DEV_TRANSFORM_CACHE_MAX;
    const parsedEnv = envMax ? parseInt(envMax, 10) : NaN;
    this.maxEntries = Number.isFinite(parsedEnv) ? parsedEnv : maxEntries ?? 5e3;
  }
  setMaxEntries(maxEntries) {
    this.maxEntries = maxEntries;
    this.prune();
  }
  get(key) {
    const entry = this.store.get(key);
    if (entry) {
      this.hits += 1;
      entry.timestamp = Date.now();
      return entry;
    }
    this.misses += 1;
    return null;
  }
  set(key, entry) {
    this.store.set(key, { ...entry, timestamp: Date.now() });
    this.prune();
  }
  prune(maxEntries) {
    const limit = maxEntries ?? this.maxEntries;
    if (this.store.size <= limit) return;
    const sorted = Array.from(this.store.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp
    );
    const removeCount = this.store.size - limit;
    for (let i = 0; i < removeCount; i++) {
      this.store.delete(sorted[i][0]);
    }
  }
  metrics() {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.store.size,
      max: this.maxEntries
    };
  }
};
var transformCache = new TransformCache();
var TransformEngine = class {
  loaders = [];
  cacheEnabled;
  // Bump when the on-disk transform output format or semantics change.
  // Included in CAS paths so restarts never serve stale transformed output.
  cacheVersion = "v6";
  casRoot;
  versionHash;
  constructor(options) {
    this.cacheEnabled = options?.cache ?? true;
    this.casRoot = options?.casRoot;
    this.versionHash = options?.versionHash;
  }
  useLoader(loader) {
    this.loaders.push(loader);
    this.loaders.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  async run(ctx) {
    const { getCacheKey: getCacheKey2 } = await import("../cache-GE7HHBPC.js");
    const path19 = await import("path");
    const fs18 = await import("fs");
    const moduleHash = ctx.moduleHash || getCacheKey2(ctx.code);
    const loaderSig = `${this.cacheVersion}|${this.loaders.map((l) => l.name || "loader").join("|")}`;
    const loaderHash = getCacheKey2(loaderSig);
    const memKey = `${moduleHash}-${loaderHash}`;
    const casDir = this.casRoot && this.versionHash ? path19.join(this.casRoot, this.versionHash, this.cacheVersion, loaderHash, moduleHash) : null;
    const casFile = casDir ? path19.join(casDir, "transformed.js") : null;
    const casMapFile = casDir ? path19.join(casDir, "transformed.js.map") : null;
    const casMetaFile = casDir ? path19.join(casDir, "transform.meta.json") : null;
    const workspaceRoot = ctx.config?.root ? path19.resolve(ctx.config.root) : process.cwd();
    const debug = process.env.IONIFY_DEV_TRANSFORM_CACHE_DEBUG === "1";
    if (this.cacheEnabled) {
      const memHit = transformCache.get(memKey);
      if (memHit && restoreCachedDepRegistrations(memHit.dependencyEntries, workspaceRoot)) {
        if (debug) {
          console.log(`[Dev Cache] HIT mem key=${memKey} size=${transformCache.metrics().size}`);
        }
        return {
          code: memHit.transformed,
          map: memHit.map,
          dependencyEntries: memHit.dependencyEntries,
          runtimeDependencies: memHit.runtimeDependencies
        };
      }
      if (casFile && casMetaFile && fs18.existsSync(casFile) && fs18.existsSync(casMetaFile)) {
        try {
          const code = fs18.readFileSync(casFile, "utf8");
          const meta = JSON.parse(fs18.readFileSync(casMetaFile, "utf8"));
          if (meta.version !== 2 || meta.codeHash !== getCacheKey2(code) || typeof meta.hasMap !== "boolean" || !Array.isArray(meta.dependencyEntries) || !Array.isArray(meta.runtimeDependencies) || !meta.runtimeDependencies.every(
            (dependency) => dependency !== null && typeof dependency === "object" && typeof dependency.specifier === "string" && dependency.specifier.length > 0 && (dependency.kind === "static" || dependency.kind === "dynamic")
          )) {
            throw new Error("incomplete transform metadata");
          }
          const map = meta.hasMap ? casMapFile && fs18.existsSync(casMapFile) ? fs18.readFileSync(casMapFile, "utf8") : (() => {
            throw new Error("missing transform source map");
          })() : void 0;
          const dependencyEntries = meta.dependencyEntries;
          const runtimeDependencies = meta.runtimeDependencies;
          if (!restoreCachedDepRegistrations(dependencyEntries, workspaceRoot)) {
            throw new Error("unrestorable transform dependency metadata");
          }
          const parsed = { code, map, dependencyEntries, runtimeDependencies };
          transformCache.set(memKey, {
            hash: moduleHash,
            loaderHash,
            transformed: parsed.code,
            map: parsed.map,
            dependencyEntries,
            runtimeDependencies,
            timestamp: Date.now()
          });
          if (debug) {
            console.log(`[Dev Cache] HIT cas key=${memKey} size=${transformCache.metrics().size}`);
          }
          return parsed;
        } catch {
        }
      }
    }
    let working = { ...ctx };
    let result = {
      code: ctx.code,
      dependencyEntries: [],
      runtimeDependencies: []
    };
    for (const loader of this.loaders) {
      if (!loader.test(working)) continue;
      const output = await loader.transform({ ...working, code: result.code });
      if (output && output.code !== void 0) {
        const dependencyEntries = [
          ...result.dependencyEntries ?? [],
          ...output.dependencyEntries ?? []
        ];
        const uniqueDependencyEntries = Array.from(
          new Map(dependencyEntries.map((entry) => [entry.fileName, entry])).values()
        ).sort((a, b) => a.fileName.localeCompare(b.fileName));
        const runtimeDependencies = [
          ...result.runtimeDependencies ?? [],
          ...output.runtimeDependencies ?? []
        ];
        const uniqueRuntimeDependencies = Array.from(
          new Map(
            runtimeDependencies.map((dependency) => [
              `${dependency.kind}:${dependency.specifier}`,
              dependency
            ])
          ).values()
        ).sort(
          (a, b) => a.kind === b.kind ? a.specifier.localeCompare(b.specifier) : a.kind.localeCompare(b.kind)
        );
        result = {
          ...result,
          ...output,
          dependencyEntries: uniqueDependencyEntries,
          runtimeDependencies: uniqueRuntimeDependencies
        };
        working = { ...working, code: result.code };
      }
    }
    if (this.cacheEnabled) {
      transformCache.set(memKey, {
        hash: moduleHash,
        loaderHash,
        transformed: result.code,
        map: result.map,
        dependencyEntries: result.dependencyEntries ?? [],
        runtimeDependencies: result.runtimeDependencies ?? [],
        timestamp: Date.now()
      });
      if (casFile && casMetaFile) {
        const tempFiles = [];
        try {
          fs18.mkdirSync(path19.dirname(casFile), { recursive: true });
          const suffix = `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          const codeTmp = `${casFile}${suffix}`;
          const metaTmp = `${casMetaFile}${suffix}`;
          tempFiles.push(codeTmp, metaTmp);
          fs18.writeFileSync(codeTmp, result.code, "utf8");
          let mapTmp = null;
          if (result.map && casMapFile) {
            mapTmp = `${casMapFile}${suffix}`;
            tempFiles.push(mapTmp);
            fs18.writeFileSync(mapTmp, typeof result.map === "string" ? result.map : JSON.stringify(result.map), "utf8");
          }
          fs18.writeFileSync(
            metaTmp,
            JSON.stringify({
              version: 2,
              codeHash: getCacheKey2(result.code),
              hasMap: Boolean(result.map),
              dependencyEntries: result.dependencyEntries ?? [],
              runtimeDependencies: result.runtimeDependencies ?? []
            }),
            "utf8"
          );
          fs18.renameSync(codeTmp, casFile);
          if (mapTmp && casMapFile) fs18.renameSync(mapTmp, casMapFile);
          fs18.renameSync(metaTmp, casMetaFile);
        } catch {
        } finally {
          for (const tempFile of tempFiles) {
            try {
              if (fs18.existsSync(tempFile)) fs18.unlinkSync(tempFile);
            } catch {
            }
          }
        }
      }
      if (debug) {
        const m = transformCache.metrics();
        console.log(`[Dev Cache] MISS stored key=${memKey} size=${m.size} hits=${m.hits} misses=${m.misses}`);
      }
    }
    return result;
  }
};

// src/core/hmr.ts
var DEFAULT_PENDING_UPDATE_TTL_MS = 6e4;
var HMRServer = class {
  constructor(pendingUpdateTtlMs = DEFAULT_PENDING_UPDATE_TTL_MS) {
    this.pendingUpdateTtlMs = pendingUpdateTtlMs;
  }
  clients = /* @__PURE__ */ new Set();
  pending = /* @__PURE__ */ new Map();
  retainedEvents = /* @__PURE__ */ new Map();
  nextId = 1;
  closed = false;
  /** Handle an incoming SSE subscription request */
  handleSSE(req, res) {
    if (this.closed) {
      res.writeHead(503);
      res.end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write(`event: ready
data: "ok"

`);
    for (const [event, payload] of this.retainedEvents.entries()) {
      this.sendToClient(res, event, payload);
    }
    this.clients.add(res);
    req.on("close", () => {
      this.clients.delete(res);
      try {
        res.end();
      } catch {
      }
    });
  }
  sendToClient(client, event, payload) {
    const data = (event ? `event: ${event}
` : "") + `data: ${JSON.stringify(payload)}

`;
    try {
      client.write(data);
    } catch {
    }
  }
  send(event, payload) {
    for (const client of this.clients) {
      this.sendToClient(client, event, payload);
    }
  }
  /** Broadcast a JSON event to all SSE clients */
  broadcast(payload) {
    this.send(null, payload);
  }
  broadcastEvent(event, payload, options) {
    if (options?.retain) {
      this.retainedEvents.set(event, payload);
    }
    this.send(event, payload);
  }
  queueUpdate(modules) {
    if (!modules.length) return null;
    const timestamp = Date.now();
    this.prunePending(timestamp);
    const id = `${timestamp}-${this.nextId++}`;
    const summary = {
      type: "update",
      id,
      timestamp,
      modules: modules.map(({ url: url2, hash, reason }) => ({ url: url2, hash, reason }))
    };
    this.pending.set(id, { summary, modules, createdAt: timestamp });
    this.broadcastEvent("update", summary);
    return summary;
  }
  consumeUpdate(id) {
    const now = Date.now();
    this.prunePending(now);
    const pending = this.pending.get(id);
    if (!pending) return void 0;
    if (now - pending.createdAt > this.pendingUpdateTtlMs) {
      this.pending.delete(id);
      return void 0;
    }
    return pending;
  }
  prunePending(now = Date.now()) {
    for (const [id, pending] of this.pending.entries()) {
      if (now - pending.createdAt > this.pendingUpdateTtlMs) {
        this.pending.delete(id);
      }
    }
  }
  broadcastError(payload) {
    this.broadcastEvent("error", { type: "error", ...payload });
  }
  close() {
    this.closed = true;
    for (const client of this.clients) {
      try {
        client.end();
      } catch {
      }
    }
    this.clients.clear();
    this.pending.clear();
    this.retainedEvents.clear();
  }
};
function injectHMRClient(html) {
  const tag = `<script type="module" src="/__ionify_hmr_client.js"></script>`;
  return html.includes("</body>") ? html.replace("</body>", `${tag}
</body>`) : html + "\n" + tag;
}

// src/core/loaders/asset.ts
function assetAsModule(urlPath) {
  const safe = urlPath.replace(/"/g, "%22");
  return `export default "${safe}";`;
}
function isAssetExt(ext) {
  return [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".ico",
    ".webp",
    ".avif",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".eot"
  ].includes(ext);
}
function contentTypeForAsset(ext) {
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".webp":
      return "image/webp";
    case ".avif":
      return "image/avif";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    case ".otf":
      return "font/otf";
    case ".eot":
      return "application/vnd.ms-fontobject";
    default:
      return "application/octet-stream";
  }
}
function normalizeUrlFromFs(rootDir, fsPath) {
  return publicPathForFile(rootDir, fsPath);
}

// src/core/refresh/entryDetection.ts
import path4 from "path";
var ENTRY_PATTERNS = [
  /\/src\/main\.(tsx?|jsx?)$/,
  /\/src\/index\.(tsx?|jsx?)$/
];
function normalizePath(input) {
  const normalized = path4.normalize(input).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
function isEntryModule(filePath, config) {
  const normalized = normalizePath(path4.resolve(filePath));
  if (config?.entry) {
    const root = config.root ?? process.cwd();
    const entries = Array.isArray(config.entry) ? config.entry : [config.entry];
    for (const entry of entries) {
      const resolvedEntry = path4.resolve(root, entry);
      const normalizedEntry = normalizePath(resolvedEntry);
      if (normalized === normalizedEntry) return true;
    }
  }
  return ENTRY_PATTERNS.some((pattern) => pattern.test(normalized));
}

// src/core/loaders/js.ts
import { transform as swcTransform, parseSync, printSync } from "@swc/core";
import { init, parse } from "es-module-lexer";

// src/core/utils/declaration-file.ts
function isTypeDeclarationPath(filePath) {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase().split("?")[0]?.split("#")[0] ?? "";
  return normalized.endsWith(".d.ts") || normalized.endsWith(".d.mts") || normalized.endsWith(".d.cts");
}

// src/core/refresh/refreshEligibility.ts
function containsJSX(code) {
  const sample = code.slice(0, 8 * 1024);
  if (sample.includes("React.createElement")) return true;
  if (/\bjsx(?:s)?\s*\(/.test(sample)) return true;
  if (sample.includes("<>") || sample.includes("</>")) return true;
  if (/<[A-Za-z][A-Za-z0-9.$_-]*\b[^>]*\/>/.test(sample)) return true;
  if (/<[A-Za-z][A-Za-z0-9.$_-]*\b[^>]*>/.test(sample) && /<\/[A-Za-z]/.test(sample)) {
    return true;
  }
  return false;
}
function shouldUseReactRefresh(options) {
  const { ext, code, isDev, config } = options;
  if (!isDev) return false;
  if (config?.fastRefresh === false) return false;
  if (ext === ".jsx" || ext === ".tsx") return containsJSX(code);
  if (ext === ".js" || ext === ".ts" || ext === ".mjs" || ext === ".mts") return containsJSX(code);
  return false;
}

// src/core/loaders/js.ts
import fs6 from "fs";
import path5 from "path";
var JS_EXTENSIONS = /* @__PURE__ */ new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);
function depsRuntimeUrl(fileName, chunkGroup) {
  return formatDepsRuntimeUrl(fileName, process.env.IONIFY_DEPS_HASH, chunkGroup);
}
function resolveIonifyDir(rootDir) {
  const fromEnv = process.env.IONIFY_STATE_DIR;
  if (fromEnv && path5.isAbsolute(fromEnv)) return fromEnv;
  return path5.join(rootDir, ".ionify");
}
function resolveDepsRoot(rootDir, depsHash) {
  return path5.join(resolveIonifyDir(rootDir), "deps", depsHash);
}
var featurePackIndexCache = null;
function getFeaturePackChunkGroupId(rootDir, fileName) {
  const depsHash = process.env.IONIFY_DEPS_HASH;
  if (!depsHash) return null;
  const depsRoot = resolveDepsRoot(rootDir, depsHash);
  const indexPath = path5.join(depsRoot, "vendor-pack.feature.index.json");
  if (!fs6.existsSync(indexPath)) return null;
  let stat;
  try {
    stat = fs6.statSync(indexPath);
  } catch {
    return null;
  }
  const mtimeMs = stat.mtimeMs;
  if (!featurePackIndexCache || featurePackIndexCache.depsRoot !== depsRoot || featurePackIndexCache.depsHash !== depsHash || featurePackIndexCache.mtimeMs !== mtimeMs) {
    try {
      const raw = fs6.readFileSync(indexPath, "utf8");
      const parsed = JSON.parse(raw);
      const mapping = /* @__PURE__ */ new Map();
      if (parsed?.version === 1 && parsed?.depsHash === depsHash) {
        const obj = parsed.fileNameToChunkGroupId;
        if (obj && typeof obj === "object") {
          for (const [k, v] of Object.entries(obj)) {
            if (typeof k !== "string" || typeof v !== "string") continue;
            mapping.set(k, v);
          }
        }
      }
      featurePackIndexCache = { depsRoot, depsHash, mtimeMs, mapping };
    } catch {
      featurePackIndexCache = { depsRoot, depsHash, mtimeMs, mapping: /* @__PURE__ */ new Map() };
    }
  }
  const cg = featurePackIndexCache.mapping.get(fileName) ?? null;
  if (!cg) return null;
  const sharedPath = path5.join(depsRoot, `shared.${cg}.js`);
  if (!fs6.existsSync(sharedPath)) return null;
  return cg;
}
var vendorPackV2IndexCache = null;
function vendorPackV2MemberKey2(fileName) {
  return getCacheKey(`vp2:${fileName}`).slice(0, 12);
}
var vendorPackV2PackValidationCache = null;
function validateVendorPackV2Module(depsRoot, depsHash, packFileName, expectedKey, chunkFiles) {
  const packPath = path5.join(depsRoot, packFileName);
  if (!fs6.existsSync(packPath)) return false;
  for (const chunkFile of chunkFiles) {
    if (typeof chunkFile !== "string" || !chunkFile.endsWith(".js")) return false;
    if (!fs6.existsSync(path5.join(depsRoot, chunkFile))) return false;
  }
  if (!vendorPackV2PackValidationCache || vendorPackV2PackValidationCache.depsRoot !== depsRoot || vendorPackV2PackValidationCache.depsHash !== depsHash) {
    vendorPackV2PackValidationCache = { depsRoot, depsHash, byPackFile: /* @__PURE__ */ new Map() };
  }
  let stat;
  try {
    stat = fs6.statSync(packPath);
  } catch {
    return false;
  }
  const cached = vendorPackV2PackValidationCache.byPackFile.get(packFileName);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    if (!cached.ok) return false;
    if (expectedKey && cached.key !== expectedKey) return false;
    return true;
  }
  let ok = false;
  let actualKey = null;
  try {
    const head = fs6.readFileSync(packPath, "utf8").slice(0, 256);
    const match = head.match(/\/\/\s*ionify:vendor-pack-v2\s+([0-9a-fA-F]{32,})/);
    actualKey = match?.[1] ? String(match[1]).toLowerCase() : null;
    ok = !!actualKey && (!expectedKey || actualKey === expectedKey);
  } catch {
    ok = false;
  }
  vendorPackV2PackValidationCache.byPackFile.set(packFileName, {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    ok,
    key: actualKey
  });
  return ok;
}
function getVendorPackV2ImportFileName(rootDir, fileName) {
  if (isCoreSingletonDepFileName(fileName)) return null;
  const depsHash = process.env.IONIFY_DEPS_HASH;
  if (!depsHash) return null;
  const depsRoot = resolveDepsRoot(rootDir, depsHash);
  const indexPath = path5.join(depsRoot, "vendor-pack.v2.index.json");
  if (!fs6.existsSync(indexPath)) return null;
  let stat;
  try {
    stat = fs6.statSync(indexPath);
  } catch {
    return null;
  }
  const mtimeMs = stat.mtimeMs;
  if (!vendorPackV2IndexCache || vendorPackV2IndexCache.depsRoot !== depsRoot || vendorPackV2IndexCache.depsHash !== depsHash || vendorPackV2IndexCache.mtimeMs !== mtimeMs) {
    try {
      const raw = fs6.readFileSync(indexPath, "utf8");
      const parsed = JSON.parse(raw);
      const fileNameToPackFile = /* @__PURE__ */ new Map();
      const packFileToSharedFile = /* @__PURE__ */ new Map();
      const packFileToKey = /* @__PURE__ */ new Map();
      const packFileToChunkFiles = /* @__PURE__ */ new Map();
      if (parsed?.version === 1 && parsed?.depsHash === depsHash) {
        const sharedObj = parsed.packFileToSharedFile;
        if (sharedObj && typeof sharedObj === "object") {
          for (const [packFile, sharedFile] of Object.entries(sharedObj)) {
            if (typeof packFile !== "string" || typeof sharedFile !== "string") continue;
            if (!packFile.endsWith(".js") || !sharedFile.endsWith(".js")) continue;
            packFileToSharedFile.set(packFile, sharedFile);
          }
        }
        const keyObj = parsed.packFileToKey;
        if (keyObj && typeof keyObj === "object") {
          for (const [packFile, key] of Object.entries(keyObj)) {
            if (typeof packFile !== "string" || typeof key !== "string") continue;
            if (!packFile.endsWith(".js")) continue;
            const cleaned = key.trim().toLowerCase();
            if (!/^[0-9a-f]{32,}$/.test(cleaned)) continue;
            packFileToKey.set(packFile, cleaned);
          }
        }
        const chunkObj = parsed.packFileToChunkFiles;
        if (chunkObj && typeof chunkObj === "object") {
          for (const [packFile, chunkFiles2] of Object.entries(chunkObj)) {
            if (typeof packFile !== "string" || !Array.isArray(chunkFiles2)) continue;
            if (!packFile.endsWith(".js")) continue;
            const normalized = chunkFiles2.map((v) => typeof v === "string" ? v : "").filter(Boolean).slice().sort();
            const unique = [];
            for (const file of normalized) {
              if (!file.endsWith(".js")) continue;
              if (unique.length === 0 || unique[unique.length - 1] !== file) unique.push(file);
            }
            if (unique.length > 0) packFileToChunkFiles.set(packFile, unique);
          }
        }
        const obj = parsed.fileNameToPackFile;
        if (obj && typeof obj === "object") {
          for (const [k, v] of Object.entries(obj)) {
            if (typeof k !== "string" || typeof v !== "string") continue;
            if (!v.endsWith(".js")) continue;
            fileNameToPackFile.set(k, v);
          }
        }
      }
      vendorPackV2IndexCache = {
        depsRoot,
        depsHash,
        mtimeMs,
        fileNameToPackFile,
        packFileToSharedFile,
        packFileToKey,
        packFileToChunkFiles
      };
      vendorPackV2PackValidationCache = null;
    } catch {
      vendorPackV2IndexCache = {
        depsRoot,
        depsHash,
        mtimeMs,
        fileNameToPackFile: /* @__PURE__ */ new Map(),
        packFileToSharedFile: /* @__PURE__ */ new Map(),
        packFileToKey: /* @__PURE__ */ new Map(),
        packFileToChunkFiles: /* @__PURE__ */ new Map()
      };
      vendorPackV2PackValidationCache = null;
    }
  }
  const packFileName = vendorPackV2IndexCache.fileNameToPackFile.get(fileName) ?? null;
  if (!packFileName) return null;
  const expectedKey = vendorPackV2IndexCache.packFileToKey.get(packFileName) ?? null;
  const chunkFiles = vendorPackV2IndexCache.packFileToChunkFiles.get(packFileName) ?? (() => {
    const shared = vendorPackV2IndexCache?.packFileToSharedFile.get(packFileName) ?? null;
    return shared ? [shared] : [];
  })();
  if (chunkFiles.length === 0) return null;
  if (!validateVendorPackV2Module(depsRoot, depsHash, packFileName, expectedKey, chunkFiles)) return null;
  return packFileName;
}
function extractDepsFileNameFromUrl(url2) {
  if (!url2.startsWith("/@deps/")) return null;
  let rest = url2.slice("/@deps/".length);
  const queryIndex = rest.indexOf("?");
  const hashIndex = rest.indexOf("#");
  const splitIndex = queryIndex === -1 ? hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
  if (splitIndex !== -1) {
    rest = rest.slice(0, splitIndex);
  }
  if (!rest.endsWith(".js")) return null;
  return rest;
}
function rewriteVendorPackV2Imports(code, rootDir) {
  const depsHash = process.env.IONIFY_DEPS_HASH;
  if (!depsHash) return code;
  if (!code.includes("/@deps/")) return code;
  const depsRoot = resolveDepsRoot(rootDir, depsHash);
  const indexPath = path5.join(depsRoot, "vendor-pack.v2.index.json");
  if (!fs6.existsSync(indexPath)) return code;
  let ast;
  try {
    ast = parseSync(code, {
      syntax: "ecmascript",
      jsx: true,
      decorators: true,
      dynamicImport: true,
      importAssertions: true
    });
  } catch {
    return code;
  }
  let mutated = false;
  const body = Array.isArray(ast?.body) ? ast.body : [];
  for (const item of body) {
    if (!item || item.type !== "ImportDeclaration") continue;
    const sourceValue = item.source?.value;
    if (typeof sourceValue !== "string") continue;
    const depFileName = extractDepsFileNameFromUrl(sourceValue);
    if (!depFileName) continue;
    const importFileName = getVendorPackV2ImportFileName(rootDir, depFileName);
    if (!importFileName) continue;
    const memberKey = vendorPackV2MemberKey2(depFileName);
    const prefix = `__ionify_vp_${memberKey}`;
    const newSourceValue = depsRuntimeUrl(importFileName);
    const makeImportedIdent = (value, template) => ({
      type: "Identifier",
      span: template?.span ?? { start: 0, end: 0 },
      ctxt: 0,
      value,
      optional: false
    });
    const specifiers = Array.isArray(item.specifiers) ? item.specifiers : [];
    if (specifiers.length === 0) {
      item.source.value = newSourceValue;
      item.source.raw = JSON.stringify(newSourceValue);
      mutated = true;
      continue;
    }
    const nextSpecs = [];
    let ok = true;
    for (const spec of specifiers) {
      if (!spec || typeof spec.type !== "string") {
        ok = false;
        break;
      }
      if (spec.type === "ImportDefaultSpecifier") {
        const local = spec.local;
        nextSpecs.push({
          type: "ImportSpecifier",
          span: spec.span,
          local,
          imported: makeImportedIdent(`${prefix}__default`, local),
          isTypeOnly: false
        });
        continue;
      }
      if (spec.type === "ImportNamespaceSpecifier") {
        const local = spec.local;
        nextSpecs.push({
          type: "ImportSpecifier",
          span: spec.span,
          local,
          imported: makeImportedIdent(`${prefix}__ns`, local),
          isTypeOnly: false
        });
        continue;
      }
      if (spec.type === "ImportSpecifier") {
        const local = spec.local;
        const imported = spec.imported ?? local;
        const importedName = imported?.value;
        if (typeof importedName !== "string" || importedName.length === 0) {
          ok = false;
          break;
        }
        nextSpecs.push({
          type: "ImportSpecifier",
          span: spec.span,
          local,
          imported: makeImportedIdent(`${prefix}__${importedName}`, imported ?? local),
          isTypeOnly: false
        });
        continue;
      }
      ok = false;
      break;
    }
    if (!ok) continue;
    item.specifiers = nextSpecs;
    item.source.value = newSourceValue;
    item.source.raw = JSON.stringify(newSourceValue);
    mutated = true;
  }
  if (!mutated) return code;
  try {
    const printed = printSync(ast, { minify: false });
    return printed?.code ?? code;
  } catch {
    return code;
  }
}
function shouldTransform(ext, filePath) {
  if (!JS_EXTENSIONS.has(ext)) return false;
  return true;
}
function computeSubpathForDep(fsPath, pkg) {
  const computed = computeSubpathFromEntryPath(fsPath);
  if (!computed && !fs6.existsSync(fsPath) && pkg && typeof pkg.subpath === "string") {
    const raw = pkg.subpath;
    const cleaned = raw.replace(/^\.\//, "").replace(/^\/+/, "");
    if (cleaned && cleaned !== "." && cleaned !== "index") {
      return cleaned;
    }
  }
  if (process.env.DEBUG_DEPS) {
    console.log(`[computeSubpathForDep] fsPath: ${fsPath}`);
    console.log(`[computeSubpathForDep] pkg.name: ${pkg?.name}, pkg.subpath: ${pkg?.subpath}`);
    console.log(`[computeSubpathForDep] computed: "${computed}"`);
  }
  return computed || null;
}
function looksLikeCjsWrapperSource(source) {
  const sample = source.slice(0, 16 * 1024);
  return sample.includes("module.exports") || sample.includes("exports.") || sample.includes("Object.defineProperty(exports") || sample.includes("Object.defineProperty(module.exports") || sample.includes("require(") || sample.includes("require (");
}
function looksLikeEsmSource(source) {
  const sample = source.slice(0, 16 * 1024);
  return sample.includes("import ") || sample.includes("export ") || sample.includes("import{") || sample.includes("export{") || sample.includes("import(");
}
function findNearestPackageJson(filePath) {
  let current = path5.dirname(filePath);
  for (let i = 0; i < 25; i++) {
    const candidate = path5.join(current, "package.json");
    if (fs6.existsSync(candidate)) return candidate;
    const parent = path5.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}
function makeDepsProxyForFile(filePath, code, rootDir, recordDepEntry) {
  if (!looksLikeCjsWrapperSource(code)) return null;
  const pkgJsonPath = findNearestPackageJson(filePath);
  if (!pkgJsonPath) return null;
  try {
    const pkg = JSON.parse(fs6.readFileSync(pkgJsonPath, "utf8"));
    const depEntry = registerDepEntry({
      entryPath: filePath,
      packageName: pkg?.name ?? "dep",
      packageVersion: pkg?.version ?? "0.0.0",
      // Important: include the physical subpath so stable dep ids remain correct across restarts
      // and match the optimizer's stable id (e.g. react-refresh/runtime must include `__runtime`).
      subpath: computeSubpathForDep(filePath, pkg)
    });
    recordDepEntry(depEntry);
    const fileName = depEntry.fileName;
    const importFileName = getVendorPackV2ImportFileName(rootDir, fileName);
    if (importFileName) {
      const depsHash = process.env.IONIFY_DEPS_HASH;
      const depsRoot = depsHash ? resolveDepsRoot(rootDir, depsHash) : null;
      const wrapperPath = depsRoot ? path5.join(depsRoot, fileName) : null;
      let exportNames = [];
      if (wrapperPath && fs6.existsSync(wrapperPath)) {
        try {
          const wrapperCode = fs6.readFileSync(wrapperPath, "utf8");
          const names = [];
          for (const match of wrapperCode.matchAll(
            /export\s+\{\s*__ionify_export_[A-Za-z0-9_$]+\s+as\s+([A-Za-z0-9_$]+)\s*\}\s*;\s*/g
          )) {
            const name = match[1];
            if (typeof name === "string" && name.length > 0) names.push(name);
          }
          exportNames = names.slice().sort().filter((v, i, arr) => i === 0 || arr[i - 1] !== v);
        } catch {
          exportNames = [];
        }
      }
      const memberKey = vendorPackV2MemberKey2(fileName);
      const prefix = `__ionify_vp_${memberKey}`;
      const packUrl = depsRuntimeUrl(importFileName);
      const lines = [];
      lines.push(`import { ${prefix}__default, ${prefix}__ns } from "${packUrl}";`);
      for (const name of exportNames) {
        lines.push(`import { ${prefix}__${name} as ${name} } from "${packUrl}";`);
      }
      lines.push(`export default ${prefix}__default;`);
      if (exportNames.length > 0) {
        lines.push(`export { ${exportNames.join(", ")} };`);
      }
      lines.push("");
      return lines.join("\n");
    }
    const cg = getFeaturePackChunkGroupId(rootDir, fileName);
    const url2 = depsRuntimeUrl(fileName, cg);
    return `import __ionify_dep__default, * as __ionify_dep__ns from "${url2}";
export default __ionify_dep__default;
export * from "${url2}";
`;
  } catch {
    return null;
  }
}
async function swcTranspile(code, filePath, ext, reactRefresh) {
  const isTypeScript = ext === ".ts" || ext === ".tsx" || ext === ".mts" || ext === ".cts" || isTypeDeclarationPath(filePath);
  const isTsx = ext === ".tsx";
  const isJsx = ext === ".jsx";
  const swcParser = isTypeScript ? {
    syntax: "typescript",
    tsx: isTsx,
    decorators: true,
    dynamicImport: true,
    dts: false
  } : {
    syntax: "ecmascript",
    jsx: isJsx,
    decorators: true,
    dynamicImport: true
  };
  const result = await swcTransform(code, {
    filename: runtimeTransformFilename(filePath),
    jsc: {
      parser: swcParser,
      target: "es2022",
      transform: isTsx || isJsx ? {
        react: {
          // Canonical base transform: keep transpiled output consistent across dev/build/test.
          development: false,
          runtime: "automatic",
          ...reactRefresh ? { refresh: true } : {}
        }
      } : void 0
    },
    sourceMaps: false,
    module: {
      type: "es6"
    }
  });
  return result.code ?? code;
}
function runtimeTransformFilename(filePath) {
  if (!isTypeDeclarationPath(filePath)) return filePath;
  return filePath.replace(/\.d\.ts$/i, ".ts").replace(/\.d\.mts$/i, ".mts").replace(/\.d\.cts$/i, ".cts");
}
function currentMode() {
  const mode = (process.env.IONIFY_PARSER || "hybrid").toLowerCase();
  if (mode === "swc") return "swc";
  if (mode === "oxc") return "oxc";
  return "hybrid";
}
var jsLoader = {
  name: "js",
  order: 0,
  test: ({ ext, path: filePath }) => shouldTransform(ext, filePath),
  transform: async ({ path: filePath, code, ext, config }) => {
    const isNodeModules = filePath.includes("node_modules");
    const rewriteDebug = process.env.IONIFY_IMPORT_REWRITE_DEBUG === "1";
    const rootDir = config?.root ? path5.resolve(config.root) : process.cwd();
    const dependencyEntries = /* @__PURE__ */ new Map();
    const recordDepEntry = (entry) => {
      dependencyEntries.set(entry.fileName, cacheDepRegistration(entry, rootDir));
    };
    const stateDir = process.env.IONIFY_STATE_DIR && path5.isAbsolute(process.env.IONIFY_STATE_DIR) ? process.env.IONIFY_STATE_DIR : null;
    const versionHash = process.env.IONIFY_CONFIG_HASH || null;
    const casRoot = stateDir ? path5.join(stateDir, "cas") : null;
    let output = code;
    if (isNodeModules) {
      const depsProxy = makeDepsProxyForFile(filePath, code, rootDir, recordDepEntry);
      if (depsProxy) {
        output = depsProxy;
      } else {
        const shouldAttemptBundle = ext === ".cjs" || looksLikeCjsWrapperSource(code) || !looksLikeEsmSource(code) && ext !== ".mjs";
        if (shouldAttemptBundle) {
          const bundled = tryBundleNodeModule(filePath, code);
          if (bundled) {
            output = bundled;
          } else {
            output = code;
          }
        } else {
          output = code;
        }
      }
    } else {
      const isDev = process.env.NODE_ENV !== "production";
      const reactRefresh = shouldUseReactRefresh({ ext, code, isDev, config });
      const mode = currentMode();
      const runtimeFilename = runtimeTransformFilename(filePath);
      const isTypeScriptRuntime = ext === ".ts" || ext === ".tsx" || ext === ".mts" || ext === ".cts" || isTypeDeclarationPath(filePath);
      const nativeResult = tryNativeTransform(mode, code, {
        filename: runtimeFilename,
        jsx: ext === ".jsx" || ext === ".tsx",
        typescript: isTypeScriptRuntime,
        react_refresh: false
      });
      const transpiled = nativeResult ? nativeResult.code ?? code : await swcTranspile(code, filePath, ext, false);
      if (casRoot && versionHash) {
        try {
          const baseHash = getCacheKey(code);
          const baseDir = getCasArtifactPath(casRoot, versionHash, baseHash);
          const baseFile = path5.join(baseDir, "transformed.js");
          if (!fs6.existsSync(baseFile)) {
            fs6.mkdirSync(baseDir, { recursive: true });
            const tmp = `${baseFile}.tmp-${process.pid}`;
            fs6.writeFileSync(tmp, transpiled, "utf8");
            fs6.renameSync(tmp, baseFile);
          }
        } catch {
        }
      }
      output = transpiled;
      if (isDev && reactRefresh) {
        const isEntry = isEntryModule(filePath, config ?? void 0);
        if (process.env.IONIFY_REFRESH_DEBUG === "1") {
          console.log(`[Refresh] ${filePath} \u2192 isEntry=${isEntry}, ext=${ext}`);
        }
        const result = await instrumentReactRefresh({
          code: output,
          filePath,
          ext,
          isDev,
          isEntry
        });
        if (process.env.IONIFY_REFRESH_DEBUG === "1") {
          console.log(
            `[Refresh] instrument=${result.shouldInstrument} ${filePath} \u2192 isEntry=${isEntry}`
          );
        }
        if (result.shouldInstrument) {
          output = result.prologue + output + result.registrations + result.epilogue;
        } else {
          output += `
if (import.meta.hot) import.meta.hot.accept();
`;
        }
      } else if (isDev) {
        output += `
if (import.meta.hot) {
  import.meta.hot.accept();
}
`;
      }
    }
    await init;
    const [imports] = parse(output);
    const runtimeDependencies = Array.from(
      new Map(
        imports.filter((record) => typeof record.n === "string" && record.n.length > 0).map((record) => {
          const dependency = {
            specifier: record.n,
            kind: record.t === 2 ? "dynamic" : "static"
          };
          return [`${dependency.kind}:${dependency.specifier}`, dependency];
        })
      ).values()
    ).sort(
      (a, b) => a.kind === b.kind ? a.specifier.localeCompare(b.specifier) : a.kind.localeCompare(b.kind)
    );
    if (rewriteDebug && ext === ".mjs" && isNodeModules) {
      console.warn(`[Ionify][rewrite] scanning ${imports.length} import(s) in ${filePath}`);
    }
    if (imports.length) {
      let rewritten = "";
      let lastIndex = 0;
      let mutated = false;
      for (const record of imports) {
        if (!record.n) continue;
        const spec = record.n;
        if (spec.startsWith("http://") || spec.startsWith("https://") || spec.startsWith(MODULE_PREFIX)) {
          continue;
        }
        let pathPart = spec;
        let suffix = "";
        const queryIndex = spec.indexOf("?");
        const hashIndex = spec.indexOf("#");
        const splitIndex = queryIndex === -1 ? hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
        if (splitIndex !== -1) {
          pathPart = spec.slice(0, splitIndex);
          suffix = spec.slice(splitIndex);
        }
        const isBare = !pathPart.startsWith(".") && !pathPart.startsWith("/") && !pathPart.startsWith("http://") && !pathPart.startsWith("https://");
        if (isBare && native?.resolveModule) {
          const resolvedNative = native.resolveModule(pathPart, filePath);
          const kind = resolvedNative?.kind;
          const fsPath = resolvedNative?.fsPath ?? resolvedNative?.fs_path ?? null;
          if (fsPath && isCssLikeExt(path5.extname(fsPath))) {
            const replacement2 = publicPathForFile(rootDir, fsPath) + (suffix || "?inline");
            mutated = true;
            if (record.t === 2) {
              rewritten += output.slice(lastIndex, record.s + 1);
              rewritten += replacement2;
              rewritten += output[record.e - 1];
              lastIndex = record.e;
            } else {
              rewritten += output.slice(lastIndex, record.s);
              rewritten += replacement2;
              lastIndex = record.e;
            }
            continue;
          }
          if (kind === "PkgCjs" && fsPath) {
            const pkg = resolvedNative?.pkg;
            const depEntry = registerDepEntry({
              entryPath: fsPath,
              packageName: pkg?.name ?? pathPart,
              packageVersion: pkg?.version ?? "0.0.0",
              subpath: computeSubpathForDep(fsPath, pkg)
            });
            recordDepEntry(depEntry);
            const fileName = depEntry.fileName;
            const cg = getFeaturePackChunkGroupId(rootDir, fileName);
            const replacement2 = depsRuntimeUrl(fileName, cg);
            if (!mutated) {
              mutated = true;
            }
            if (record.t === 2) {
              rewritten += output.slice(lastIndex, record.s + 1);
              rewritten += replacement2;
              rewritten += output[record.e - 1];
              lastIndex = record.e;
            } else {
              rewritten += output.slice(lastIndex, record.s);
              rewritten += replacement2;
              lastIndex = record.e;
            }
            continue;
          }
          if (kind === "PkgEsm" && fsPath) {
            try {
              const resolvedCode = fs6.readFileSync(fsPath, "utf8");
              if (looksLikeCjsWrapperSource(resolvedCode)) {
                const pkg2 = resolvedNative?.pkg;
                const depEntry2 = registerDepEntry({
                  entryPath: fsPath,
                  packageName: pkg2?.name ?? pathPart,
                  packageVersion: pkg2?.version ?? "0.0.0",
                  subpath: computeSubpathForDep(fsPath, pkg2)
                });
                recordDepEntry(depEntry2);
                const fileName2 = depEntry2.fileName;
                const cg2 = getFeaturePackChunkGroupId(rootDir, fileName2);
                const replacement3 = depsRuntimeUrl(fileName2, cg2);
                if (!mutated) mutated = true;
                if (record.t === 2) {
                  rewritten += output.slice(lastIndex, record.s + 1);
                  rewritten += replacement3;
                  rewritten += output[record.e - 1];
                  lastIndex = record.e;
                } else {
                  rewritten += output.slice(lastIndex, record.s);
                  rewritten += replacement3;
                  lastIndex = record.e;
                }
                continue;
              }
            } catch {
            }
            const pkg = resolvedNative?.pkg;
            const depEntry = registerDepEntry({
              entryPath: fsPath,
              packageName: pkg?.name ?? pathPart,
              packageVersion: pkg?.version ?? "0.0.0",
              subpath: computeSubpathForDep(fsPath, pkg)
            });
            recordDepEntry(depEntry);
            const fileName = depEntry.fileName;
            const cg = getFeaturePackChunkGroupId(rootDir, fileName);
            const replacement2 = depsRuntimeUrl(fileName, cg);
            if (!mutated) mutated = true;
            if (record.t === 2) {
              rewritten += output.slice(lastIndex, record.s + 1);
              rewritten += replacement2;
              rewritten += output[record.e - 1];
              lastIndex = record.e;
            } else {
              rewritten += output.slice(lastIndex, record.s);
              rewritten += replacement2;
              lastIndex = record.e;
            }
            continue;
          }
          if (kind === "Builtin" || kind === "Virtual") {
            continue;
          }
        }
        const resolved = resolveImport(pathPart, filePath);
        if (!resolved) {
          if (rewriteDebug) {
            console.warn(
              `[Ionify][rewrite] FAILED to resolve '${pathPart}' from '${filePath}'`
            );
          }
          continue;
        }
        const resolvedExt = resolved.slice(resolved.lastIndexOf("."));
        let augmentedSuffix = suffix;
        if (isCssLikeExt(resolvedExt) && !suffix) {
          augmentedSuffix = "?inline";
        }
        const assetExts = [
          ".png",
          ".jpg",
          ".jpeg",
          ".gif",
          ".svg",
          ".ico",
          ".webp",
          ".avif",
          ".woff",
          ".woff2",
          ".ttf",
          ".otf",
          ".eot"
        ];
        if (assetExts.includes(resolvedExt) && !suffix) {
          augmentedSuffix = "?import";
        }
        const replacementPath = publicPathForFile(rootDir, resolved);
        const replacement = replacementPath + augmentedSuffix;
        if (replacement === spec) continue;
        if (!mutated) {
          mutated = true;
        }
        if (record.t === 2) {
          rewritten += output.slice(lastIndex, record.s + 1);
          rewritten += replacement;
          rewritten += output[record.e - 1];
          lastIndex = record.e;
        } else {
          rewritten += output.slice(lastIndex, record.s);
          rewritten += replacement;
          lastIndex = record.e;
        }
      }
      if (mutated) {
        rewritten += output.slice(lastIndex);
        output = rewritten;
      } else if (rewriteDebug && isNodeModules) {
        const sample = imports.slice(0, 8).map((r) => r.n).filter(Boolean).join(", ");
        console.warn(
          `[Ionify][rewrite] no rewrites applied for ${filePath}; first imports: ${sample}`
        );
      }
    }
    const vendorPacks = config?.optimizeDeps?.vendorPacks;
    const vendorPackV2Enabled = vendorPacks === "auto" || !!vendorPacks && typeof vendorPacks === "object";
    if (vendorPackV2Enabled) {
      output = rewriteVendorPackV2Imports(output, rootDir);
    }
    return {
      code: output,
      dependencyEntries: Array.from(dependencyEntries.values()).sort(
        (a, b) => a.fileName.localeCompare(b.fileName)
      ),
      runtimeDependencies
    };
  }
};

// src/core/loaders/registry.ts
var registry = /* @__PURE__ */ new Set();
function registerLoader(registration) {
  registry.add(registration);
}
async function applyRegisteredLoaders(engine, config) {
  for (const registration of registry) {
    await registration(engine, config ?? null);
  }
  if (config?.plugins) {
    for (const plugin of config.plugins) {
      if (plugin.loaders) {
        for (const loader of plugin.loaders) {
          engine.useLoader(loader);
        }
      }
      if (plugin.setup) {
        const context = {
          config: config ?? null,
          registerLoader: (loader) => engine.useLoader(loader)
        };
        await plugin.setup(context);
      }
    }
  }
  if (config?.loaders) {
    for (const loader of config.loaders) {
      engine.useLoader(loader);
    }
  }
}
registerLoader((engine) => {
  engine.useLoader(jsLoader);
});

// src/cli/commands/dev.ts
import os from "os";

// src/core/http-cache.ts
function normalizeEtag(tag) {
  return tag.trim().replace(/^W\//, "");
}
function isNotModified(req, etag) {
  const header = req.headers["if-none-match"];
  const value = Array.isArray(header) ? header.join(",") : header;
  if (!value) return false;
  if (value.trim() === "*") return true;
  const expected = normalizeEtag(etag);
  return value.split(",").map((t) => t.trim()).filter(Boolean).some((t) => normalizeEtag(t) === expected);
}
function weakEtagFromStat(prefix, stat) {
  const mtime = Math.floor(stat.mtimeMs);
  return `W/"${prefix}-${stat.size}-${mtime}"`;
}
function weakEtagFromContent(prefix, content) {
  const size = typeof content === "string" ? Buffer.byteLength(content, "utf8") : Buffer.byteLength(content);
  const hash = getCacheKey(content).slice(0, 16);
  return `W/"${prefix}-${size}-${hash}"`;
}

// src/cli/commands/dev.ts
import crypto2 from "crypto";
import zlib from "zlib";

// src/core/deps/dependency-environment.ts
import crypto from "crypto";
import fs7 from "fs";
import path6 from "path";
function uniqueRoots(workspaceRoot, projectRoot) {
  return Array.from(new Set([workspaceRoot, projectRoot].map((root) => path6.resolve(root))));
}
function dependencyEnvironmentWatchPaths(workspaceRoot, projectRoot) {
  const paths = /* @__PURE__ */ new Set();
  for (const root of uniqueRoots(workspaceRoot, projectRoot)) {
    paths.add(path6.join(root, "package.json"));
    for (const lockfileName of LOCKFILE_ORDER) {
      paths.add(path6.join(root, lockfileName));
    }
  }
  return Array.from(paths).sort();
}
function validateJsonFile(filePath, contents) {
  try {
    const parsed = JSON.parse(contents.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return `${path6.basename(filePath)} must contain a JSON object`;
    }
    return null;
  } catch {
    return `${path6.basename(filePath)} is not stable valid JSON`;
  }
}
function validateLockfile(lockfile) {
  if (!lockfile) return null;
  if (lockfile.name === "package-lock.json") {
    return validateJsonFile(lockfile.path, lockfile.contents);
  }
  if (lockfile.name === "pnpm-lock.yaml") {
    const text = lockfile.contents.toString("utf8");
    return /^lockfileVersion\s*:/m.test(text) ? null : "pnpm-lock.yaml has no lockfileVersion";
  }
  if (lockfile.name === "yarn.lock") {
    return lockfile.contents.length > 0 ? null : "yarn.lock is empty";
  }
  if (lockfile.name === "bun.lockb") {
    return lockfile.contents.length > 0 ? null : "bun.lockb is empty";
  }
  return null;
}
function readDependencyEnvironmentSnapshot(workspaceRoot, projectRoot) {
  const watchedPaths = dependencyEnvironmentWatchPaths(workspaceRoot, projectRoot);
  const hash = crypto.createHash("sha256");
  for (const root of uniqueRoots(workspaceRoot, projectRoot)) {
    const packagePath = path6.join(root, "package.json");
    if (!fs7.existsSync(packagePath)) continue;
    let contents;
    try {
      contents = fs7.readFileSync(packagePath);
    } catch {
      return { ok: false, reason: `${packagePath} could not be read`, watchedPaths };
    }
    const invalid = validateJsonFile(packagePath, contents);
    if (invalid) return { ok: false, reason: invalid, watchedPaths };
    hash.update(packagePath);
    hash.update(contents);
  }
  let lockfile;
  try {
    lockfile = readLockfile(workspaceRoot, projectRoot);
  } catch {
    return { ok: false, reason: "lockfile could not be read atomically", watchedPaths };
  }
  const invalidLockfile = validateLockfile(lockfile);
  if (invalidLockfile) {
    return { ok: false, reason: invalidLockfile, watchedPaths };
  }
  if (lockfile) {
    hash.update(lockfile.path);
    hash.update(lockfile.contents);
  } else {
    hash.update("no-lockfile");
  }
  return {
    ok: true,
    snapshot: {
      fingerprint: hash.digest("hex"),
      lockfile,
      watchedPaths
    }
  };
}
var DependencyEnvironmentSettler = class {
  constructor(options) {
    this.options = options;
  }
  timer = null;
  closed = false;
  pendingReasons = /* @__PURE__ */ new Set();
  notify(reason) {
    if (this.closed) return;
    this.pendingReasons.add(reason);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.reconcile();
    }, this.options.settleMs);
    this.timer.unref?.();
  }
  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pendingReasons.clear();
  }
  async reconcile() {
    if (this.closed) return;
    const first = readDependencyEnvironmentSnapshot(
      this.options.workspaceRoot,
      this.options.projectRoot
    );
    if (!first.ok) {
      this.options.onInvalid?.(first.reason);
      this.notify("retry-invalid");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, this.options.settleMs));
    if (this.closed) return;
    const second = readDependencyEnvironmentSnapshot(
      this.options.workspaceRoot,
      this.options.projectRoot
    );
    if (!second.ok) {
      this.options.onInvalid?.(second.reason);
      this.notify("retry-invalid");
      return;
    }
    if (first.snapshot.fingerprint !== second.snapshot.fingerprint) {
      this.notify("retry-changing");
      return;
    }
    const reasons = Array.from(this.pendingReasons).sort();
    this.pendingReasons.clear();
    try {
      await this.options.onStable(second.snapshot, reasons);
    } catch (error) {
      this.options.onInvalid?.(
        `generation activation failed: ${error instanceof Error ? error.message : String(error)}`
      );
      this.notify("retry-activation");
    }
  }
};

// src/cli/commands/dev.ts
var IONIFY_CSS_JS_MARKER = "// ionify:css";
var IONIFY_VENDOR_PACK_MARKER = "// ionify:vendor-pack";
var DEPS_OPTIMIZER_OUTPUT_VERSION = getDepsOptimizerOutputVersion();
var VENDOR_PACK_V2_REWRITE_POLICY_VERSION = 2;
var __filename2 = fileURLToPath(import.meta.url);
var __dirname2 = path7.dirname(__filename2);
var CLIENT_DIR = path7.resolve(__dirname2, "../client");
var CLIENT_FALLBACK_DIR = path7.resolve(process.cwd(), "src/client");
var DEPS_PREFIX = "/@deps/";
function syncFederationGraphNodes(graph, nodes) {
  const nextIds = new Set(nodes.map((node) => node.id));
  for (const existingId of graph.listNodeIdsByPrefix(FEDERATION_GRAPH_PREFIX)) {
    if (!nextIds.has(existingId)) graph.removeNodeById(existingId);
  }
  for (const node of nodes) {
    graph.recordNodeById(node.id, node.hash, node.deps, node.dynamicDeps ?? [], node.kind);
  }
}
function resolvePublicDir(rootDir, value) {
  if (value === false) return null;
  const dir = typeof value === "string" && value.trim().length > 0 ? value.trim() : "public";
  return path7.isAbsolute(dir) ? dir : path7.resolve(rootDir, dir);
}
function decodePublicDirPath(publicDirAbs, urlPath) {
  if (!urlPath.startsWith("/")) return null;
  const normalizedRoot = path7.resolve(publicDirAbs);
  const joined = path7.resolve(normalizedRoot, "." + urlPath);
  if (!joined.startsWith(normalizedRoot + path7.sep) && joined !== normalizedRoot) return null;
  if (isForbiddenFsPath(joined)) return null;
  return joined;
}
function shouldTryPublicDir(reqPath) {
  if (!reqPath || reqPath === "/" || reqPath === "/index.html") return false;
  if (reqPath.startsWith(DEPS_PREFIX)) return false;
  if (reqPath.startsWith("/__ionify")) return false;
  return true;
}
function resolveSpaFallbackPolicy(rootDir, rawValue) {
  const objectValue = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue) ? rawValue : null;
  const rawEnabled = objectValue ? objectValue.enabled : rawValue;
  const mode = rawEnabled === void 0 ? "auto" : rawEnabled === true || rawEnabled === false ? rawEnabled : rawEnabled === "auto" ? "auto" : "auto";
  const entryRaw = objectValue && typeof objectValue.entry === "string" && objectValue.entry.trim().length > 0 ? objectValue.entry.trim() : "/index.html";
  const entryFilePath = entryRaw.startsWith("/") ? path7.join(rootDir, entryRaw) : path7.resolve(rootDir, entryRaw);
  const disableDotRule = objectValue?.disableDotRule === true;
  const entryExists = fs8.existsSync(entryFilePath) && fs8.statSync(entryFilePath).isFile();
  const enabled = mode === "auto" ? entryExists : mode === true ? entryExists : false;
  return {
    enabled,
    entryFilePath: enabled ? entryFilePath : null,
    entryUrlPath: enabled ? normalizeUrlFromFs(rootDir, entryFilePath) : null,
    disableDotRule
  };
}
function headerValue(value) {
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" ? value : "";
}
function isHtmlNavigationRequest(req, reqPath, query, policy) {
  if (!policy.enabled || !policy.entryFilePath) return false;
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  if (!reqPath.startsWith("/")) return false;
  if (reqPath.startsWith(DEPS_PREFIX) || reqPath.startsWith("/__ionify")) return false;
  if ("import" in query || "inline" in query || "raw" in query || "module" in query || "url" in query) {
    return false;
  }
  const baseName = path7.posix.basename(reqPath);
  if (!policy.disableDotRule && baseName.includes(".")) {
    return false;
  }
  const secFetchDest = headerValue(req.headers["sec-fetch-dest"]).toLowerCase();
  if (secFetchDest === "document") return true;
  const secFetchMode = headerValue(req.headers["sec-fetch-mode"]).toLowerCase();
  if (secFetchMode === "navigate") return true;
  const accept = headerValue(req.headers.accept).toLowerCase();
  return accept.includes("text/html");
}
function normalizeGraphDepForClient(rootDir, dep) {
  return dep.startsWith("http://") || dep.startsWith("https://") ? dep : path7.isAbsolute(dep) ? normalizeUrlFromFs(rootDir, dep) : dep;
}
function rewriteCssImportSpecifiers(cssText, filePath, rootDir, moduleResolver) {
  const importRe = /@import\s+(?:url\(\s*)?(?:'([^']+)'|"([^"]+)"|([^'"\s)]+))\s*\)?[^;]*;/gi;
  let rewritten = "";
  let lastIndex = 0;
  let mutated = false;
  let match;
  while (match = importRe.exec(cssText)) {
    const spec = (match[1] || match[2] || match[3] || "").trim();
    if (!spec || /^(data:|https?:|\/\/)/i.test(spec) || spec.startsWith("/")) {
      continue;
    }
    const resolved = moduleResolver.resolve(spec, filePath);
    if (!resolved) {
      continue;
    }
    const replacement = normalizeUrlFromFs(rootDir, resolved);
    if (!replacement || replacement === spec) {
      continue;
    }
    mutated = true;
    rewritten += cssText.slice(lastIndex, match.index);
    rewritten += match[0].replace(spec, replacement);
    lastIndex = match.index + match[0].length;
  }
  if (!mutated) {
    return cssText;
  }
  rewritten += cssText.slice(lastIndex);
  return rewritten;
}
function readClientAssetFile(fileName) {
  const primary = path7.join(CLIENT_DIR, fileName);
  if (fs8.existsSync(primary)) {
    return { filePath: primary, code: fs8.readFileSync(primary, "utf8") };
  }
  const fallback = path7.join(CLIENT_FALLBACK_DIR, fileName);
  if (fs8.existsSync(fallback)) {
    return { filePath: fallback, code: fs8.readFileSync(fallback, "utf8") };
  }
  throw new Error(`Missing Ionify client asset: ${fileName}`);
}
function readClientAsset(fileName) {
  return readClientAssetFile(fileName).code;
}
function resolveHttpsMaterial(rootDir, rawValue) {
  if (typeof rawValue !== "string") return void 0;
  const trimmed = rawValue.trim();
  if (!trimmed) return void 0;
  if (trimmed.includes("BEGIN ")) return trimmed;
  const candidate = path7.isAbsolute(trimmed) ? trimmed : path7.resolve(rootDir, trimmed);
  if (!fs8.existsSync(candidate)) return void 0;
  return fs8.readFileSync(candidate);
}
function ensureDevHttpsOptions(httpsConfig, rootDir, ionifyDir) {
  if (!httpsConfig) return null;
  if (typeof httpsConfig === "object" && httpsConfig !== null) {
    const configObject = httpsConfig;
    const key = resolveHttpsMaterial(rootDir, configObject.key);
    const cert = resolveHttpsMaterial(rootDir, configObject.cert);
    if (key && cert) {
      return {
        ...configObject,
        key,
        cert
      };
    }
  }
  const certDir = path7.join(ionifyDir, "certs");
  const keyPath = path7.join(certDir, "dev-server.key");
  const certPath = path7.join(certDir, "dev-server.crt");
  if (!fs8.existsSync(keyPath) || !fs8.existsSync(certPath)) {
    fs8.mkdirSync(certDir, { recursive: true });
    const generated = selfsigned.generate(
      [
        { name: "commonName", value: "localhost" },
        { name: "organizationName", value: "Ionify Dev Server" }
      ],
      {
        algorithm: "sha256",
        days: 30,
        keySize: 2048,
        extensions: [
          {
            name: "subjectAltName",
            altNames: [
              { type: 2, value: "localhost" },
              { type: 2, value: "127.0.0.1" },
              { type: 7, ip: "127.0.0.1" }
            ]
          }
        ]
      }
    );
    fs8.writeFileSync(keyPath, generated.private, "utf8");
    fs8.writeFileSync(certPath, generated.cert, "utf8");
  }
  return {
    key: fs8.readFileSync(keyPath),
    cert: fs8.readFileSync(certPath)
  };
}
function guessContentType(filePath) {
  const ext = path7.extname(filePath);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (isCssLikeExt(ext)) return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if ([".mjs", ".js", ".ts", ".tsx", ".jsx", ".cjs", ".mts", ".cts"].includes(ext))
    return "application/javascript; charset=utf-8";
  if ([".wasm"].includes(ext))
    return "application/wasm";
  if ([".map"].includes(ext))
    return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}
function mergeVaryHeader(existing, next) {
  const parts = /* @__PURE__ */ new Set();
  const add = (value) => {
    value.split(",").map((v) => v.trim()).filter(Boolean).forEach((v) => parts.add(v));
  };
  if (typeof existing === "string") add(existing);
  else if (Array.isArray(existing)) existing.forEach(add);
  add(next);
  return Array.from(parts).join(", ");
}
function shouldCompressContentType(contentType) {
  const ct = contentType.toLowerCase();
  return ct.startsWith("text/") || ct.includes("javascript") || ct.includes("json") || ct.includes("xml") || ct.includes("svg");
}
function selectCompressionEncoding(req) {
  const header = req.headers["accept-encoding"];
  const value = Array.isArray(header) ? header.join(",") : header;
  if (!value) return null;
  const enc = value.toLowerCase();
  if (enc.includes("gzip")) return "gzip";
  return null;
}
function selectPrecompressedVariant(req, baseFilePath) {
  const header = req.headers["accept-encoding"];
  const value = Array.isArray(header) ? header.join(",") : header;
  if (!value) return null;
  const enc = value.toLowerCase();
  if (enc.includes("br")) {
    const brPath = `${baseFilePath}.br`;
    if (fs8.existsSync(brPath)) return { filePath: brPath, encoding: "br" };
  }
  if (enc.includes("gzip")) {
    const gzPath = `${baseFilePath}.gz`;
    if (fs8.existsSync(gzPath)) return { filePath: gzPath, encoding: "gzip" };
  }
  return null;
}
function sendPrecompressedFile(req, res, status, contentType, variant, opts) {
  const stat = fs8.statSync(variant.filePath);
  const etag = weakEtagFromStat(opts.etagPrefix, stat);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", opts.cacheControl);
  res.setHeader("Vary", mergeVaryHeader(res.getHeader("Vary"), "Accept-Encoding"));
  res.setHeader("Content-Encoding", variant.encoding);
  res.setHeader("ETag", etag);
  if (isNotModified(req, etag)) {
    res.statusCode = 304;
    res.end();
    return;
  }
  res.statusCode = status;
  res.end(fs8.readFileSync(variant.filePath));
}
function looksLikeIonifyCssJsModule(body) {
  const head = body.subarray(0, 96).toString("utf8");
  return head.trimStart().startsWith(IONIFY_CSS_JS_MARKER);
}
function computeDepsStampHash(depsAbs) {
  if (!depsAbs.length) return "0";
  const entries = [];
  for (const dep of depsAbs) {
    const abs = path7.resolve(dep);
    try {
      entries.push(`${abs}:${getCacheKey(fs8.readFileSync(abs))}`);
    } catch {
      entries.push(`${abs}:missing`);
    }
  }
  entries.sort();
  return getCacheKey(entries.join("|"));
}
function sendBuffer(req, res, status, contentType, body, opts) {
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
  const encoding = body.length >= 1024 && shouldCompressContentType(contentType) ? selectCompressionEncoding(req) : null;
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
function readProjectPackageJson(rootDir) {
  const pkgPath = path7.join(rootDir, "package.json");
  if (!fs8.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs8.readFileSync(pkgPath, "utf8"));
  } catch {
    return null;
  }
}
function detectVendorSpecifiers(pkgJson) {
  if (!pkgJson || typeof pkgJson !== "object") return [];
  const deps = {
    ...pkgJson.dependencies || {},
    ...pkgJson.devDependencies || {},
    ...pkgJson.peerDependencies || {}
  };
  const has = (name) => Object.prototype.hasOwnProperty.call(deps, name);
  if (has("react") || has("react-dom")) {
    return [
      "react",
      "react-dom",
      "react-dom/client",
      "scheduler",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-refresh"
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
function computeSubpathForDep2(fsPath, pkg) {
  const computed = computeSubpathFromEntryPath(fsPath);
  if (computed) return computed;
  if (fs8.existsSync(fsPath)) return null;
  const raw = pkg?.subpath;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/^\.\//, "").replace(/^\/+/, "");
    if (cleaned && cleaned !== "." && cleaned !== "index") {
      return cleaned;
    }
  }
  return null;
}
function resolveVendorDeps(rootDir, specifiers) {
  if (!native?.resolveModule) return [];
  const seen = /* @__PURE__ */ new Set();
  const resolved = [];
  for (const spec of specifiers) {
    try {
      const r = native.resolveModule(spec, rootDir);
      const fsPath = r?.fsPath ?? r?.fs_path ?? null;
      if (!fsPath || typeof fsPath !== "string") continue;
      const pkg = r?.pkg ?? null;
      const packageName = typeof pkg?.name === "string" ? pkg.name : spec;
      const packageVersion = typeof pkg?.version === "string" ? pkg.version : "0.0.0";
      const subpath = computeSubpathForDep2(fsPath, pkg);
      const entry = registerDepEntry({
        entryPath: fsPath,
        packageName,
        packageVersion,
        subpath
      });
      if (seen.has(entry.fileName)) continue;
      seen.add(entry.fileName);
      resolved.push({
        specifier: spec,
        entryPath: fsPath,
        fileName: entry.fileName,
        packageLabel: formatDepLabel(packageName, subpath)
      });
    } catch {
    }
  }
  return resolved;
}
function injectModulePreload(html, href) {
  const tag = `<link rel="modulepreload" href="${href}">`;
  if (html.includes(tag)) return html;
  const headCloseMatch = html.match(/<\/head>/i);
  if (headCloseMatch?.index !== void 0) {
    const idx = headCloseMatch.index;
    return `${html.slice(0, idx)}${tag}
${html.slice(idx)}`;
  }
  const headOpenMatch = html.match(/<head[^>]*>/i);
  if (headOpenMatch?.index !== void 0) {
    const idx = headOpenMatch.index + headOpenMatch[0].length;
    return `${html.slice(0, idx)}
${tag}${html.slice(idx)}`;
  }
  return `${tag}
${html}`;
}
function injectInlineScript(html, script) {
  const tag = `<script>${script}</script>`;
  if (html.includes(tag)) return html;
  const headCloseMatch = html.match(/<\/head>/i);
  if (headCloseMatch?.index !== void 0) {
    const idx = headCloseMatch.index;
    return `${html.slice(0, idx)}${tag}
${html.slice(idx)}`;
  }
  const bodyOpenMatch = html.match(/<body[^>]*>/i);
  if (bodyOpenMatch?.index !== void 0) {
    const idx = bodyOpenMatch.index + bodyOpenMatch[0].length;
    return `${html.slice(0, idx)}
${tag}${html.slice(idx)}`;
  }
  return `${tag}
${html}`;
}
function injectStartupEvaluationMarker(code) {
  const marker = "globalThis.__IONIFY_STARTUP__?.markEvaluated?.(import.meta.url);";
  return code.startsWith(marker) ? code : `${marker}
${code}`;
}
function instrumentJavaScriptBuffer(buffer, enabled) {
  if (!enabled) return buffer;
  return Buffer.from(injectStartupEvaluationMarker(buffer.toString("utf8")));
}
function extractBarePackageRoot(specifier) {
  const raw = String(specifier || "").trim();
  if (!raw) return null;
  if (raw.startsWith(".") || raw.startsWith("/") || raw.startsWith("http://") || raw.startsWith("https://")) {
    return null;
  }
  if (raw.startsWith("@")) {
    const parts = raw.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : raw;
  }
  const slashIndex = raw.indexOf("/");
  return slashIndex === -1 ? raw : raw.slice(0, slashIndex);
}
function extractPackageRootFromLabel(label) {
  return extractBarePackageRoot(label);
}
function buildRouteHintClientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const remoteAddress = typeof forwardedValue === "string" && forwardedValue.trim().length > 0 ? forwardedValue.split(",")[0]?.trim() ?? "" : req.socket.remoteAddress ?? "";
  const userAgent = Array.isArray(req.headers["user-agent"]) ? req.headers["user-agent"][0] ?? "" : req.headers["user-agent"] ?? "";
  const key = `${remoteAddress}::${userAgent}`.trim();
  return key.length > 2 ? key : null;
}
function pruneDepsCache(ionifyDir, depsHash) {
  const depsRoot = path7.join(ionifyDir, "deps");
  if (!fs8.existsSync(depsRoot)) return;
  const entries = fs8.readdirSync(depsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
    const fullPath = path7.join(depsRoot, entry.name);
    const stat = fs8.statSync(fullPath);
    return { name: entry.name, path: fullPath, mtimeMs: stat.mtimeMs };
  }).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const keep = /* @__PURE__ */ new Set();
  keep.add(depsHash);
  for (const entry of entries.slice(0, 2)) {
    keep.add(entry.name);
  }
  for (const entry of entries) {
    if (!keep.has(entry.name)) {
      fs8.rmSync(entry.path, { recursive: true, force: true });
    }
  }
}
function loadDepsManifestIndex(depsRoot) {
  const manifestPath = path7.join(depsRoot, "manifest.json");
  if (!fs8.existsSync(manifestPath)) return /* @__PURE__ */ new Map();
  try {
    const raw = fs8.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    const entries = parsed?.entries ?? {};
    const map = /* @__PURE__ */ new Map();
    for (const [entryPath, entry] of Object.entries(entries)) {
      if (!entry?.outFile) continue;
      const artifactHash = typeof entry.artifactHash === "string" && entry.artifactHash.length > 0 ? entry.artifactHash : typeof entry.artifact_hash === "string" && entry.artifact_hash.length > 0 ? entry.artifact_hash : null;
      const sizeBytes = typeof entry.sizeBytes === "number" ? entry.sizeBytes : typeof entry.size_bytes === "number" ? entry.size_bytes : 0;
      const moduleCount = typeof entry.moduleCount === "number" ? entry.moduleCount : typeof entry.module_count === "number" ? entry.module_count : 0;
      const edgeCount = typeof entry.edgeCount === "number" ? entry.edgeCount : typeof entry.edge_count === "number" ? entry.edge_count : 0;
      const externalCount = typeof entry.externalCount === "number" ? entry.externalCount : typeof entry.external_count === "number" ? entry.external_count : 0;
      const chunkGroup = typeof entry.chunkGroup === "string" ? entry.chunkGroup : typeof entry.chunk_group === "string" ? entry.chunk_group : null;
      const outputVersion = typeof entry.outputVersion === "number" ? entry.outputVersion : typeof entry.output_version === "number" ? entry.output_version : 0;
      const chunkFilesRaw = Array.isArray(entry.chunkFiles) ? entry.chunkFiles : Array.isArray(entry.chunk_files) ? entry.chunk_files : [];
      const chunkFiles = (Array.isArray(chunkFilesRaw) ? chunkFilesRaw : []).map((v) => typeof v === "string" ? v : null).filter((v) => typeof v === "string" && v.length > 0);
      map.set(entry.outFile, {
        entryPath,
        artifactHash,
        packageLabel: entry.package || "unknown",
        hasSourcemap: entry.hasSourcemap === true,
        sizeBytes,
        moduleCount,
        edgeCount,
        externalCount,
        outputVersion,
        chunkGroup,
        chunkFiles
      });
    }
    return map;
  } catch {
    return /* @__PURE__ */ new Map();
  }
}
function readJsonFile3(filePath) {
  if (!fs8.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs8.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
function writeJsonFile3(filePath, data) {
  try {
    fs8.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  } catch {
  }
}
function normalizeAbsList(values) {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values.filter((value) => typeof value === "string" && value.length > 0).map((value) => path7.resolve(value))
    )
  ).sort();
}
var DEV_CSS_META_VERSION = 2;
function metaTailwindStampForRecipe(meta) {
  return meta?.tailwindGraphContent?.enabled === true && typeof meta.tailwindGraphContent.stamp === "string" && meta.tailwindGraphContent.stamp.length > 0 ? meta.tailwindGraphContent.stamp : "none";
}
function compileTailwindStampForRecipe(tailwindGraphContent) {
  return tailwindGraphContent?.enabled === true && typeof tailwindGraphContent.stamp === "string" && tailwindGraphContent.stamp.length > 0 ? tailwindGraphContent.stamp : "none";
}
function devCssMetaIsCurrent(meta, contentHash, modules, rootDir) {
  if (!meta || typeof meta !== "object") return false;
  if (meta.version !== DEV_CSS_META_VERSION || meta.baseHash !== contentHash || meta.modules !== modules) return false;
  if (typeof meta.depsStampHash !== "string" || meta.depsStampHash.length === 0) return false;
  const deps = normalizeAbsList([...Array.isArray(meta.deps) ? meta.deps : [], ...Array.isArray(meta.urlDeps) ? meta.urlDeps : []]);
  const currentStamp = computeDepsStampHash(deps);
  if (currentStamp !== meta.depsStampHash) return false;
  if (meta.tailwindGraphContent?.enabled === true && Number(meta.tailwindGraphContent?.files ?? 0) > 0) {
    if (typeof meta.tailwindGraphContent.stamp !== "string" || meta.tailwindGraphContent.stamp.length === 0) {
      return false;
    }
    const current = computeCssDemandGraphContentStamp(rootDir);
    if (!current || current.stamp !== meta.tailwindGraphContent.stamp) return false;
  }
  return true;
}
function buildDevCssMeta(options) {
  const deps = normalizeAbsList(options.depsAbs);
  const urlDeps = normalizeAbsList(options.urlDepsAbs);
  const tw = options.tailwindGraphContent;
  const twEnabled = tw?.enabled === true && Number(tw?.files ?? 0) > 0;
  return {
    version: DEV_CSS_META_VERSION,
    baseHash: options.contentHash,
    pipelineHash: options.pipelineHash,
    depsStampHash: computeDepsStampHash([...deps, ...urlDeps]),
    deps,
    urlDeps,
    modules: options.modules,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    tailwindGraphContent: tw ? {
      enabled: tw.enabled === true,
      files: Number(tw.files ?? 0),
      plugins: Number(tw.plugins ?? 0),
      configPath: typeof tw.configPath === "string" ? tw.configPath : null,
      fallbackReason: typeof tw.fallbackReason === "string" ? tw.fallbackReason : null,
      stamp: twEnabled && typeof tw.stamp === "string" && tw.stamp.length > 0 ? tw.stamp : null
    } : null
  };
}
function loadDepRequestCounts(filePath) {
  const raw = readJsonFile3(filePath);
  if (!raw || typeof raw !== "object") return /* @__PURE__ */ new Map();
  const map = /* @__PURE__ */ new Map();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      map.set(key, value);
    }
  }
  return map;
}
function saveDepRequestCounts(filePath, counts) {
  const obj = {};
  const keys = Array.from(counts.keys()).sort();
  for (const key of keys) {
    const value = counts.get(key) ?? 0;
    if (value > 0) obj[key] = value;
  }
  writeJsonFile3(filePath, obj);
}
function buildVendorPackPlan(options) {
  const {
    depsHash,
    mode,
    vendorDeps,
    manifestIndex,
    requestCounts,
    maxBytes,
    maxMembers
  } = options;
  const vendorFileNames = new Set(vendorDeps.map((d) => d.fileName));
  const candidates = [];
  for (const [fileName, entry] of manifestIndex.entries()) {
    if (vendorFileNames.has(fileName)) continue;
    if (!entry?.entryPath) continue;
    const requestCount = requestCounts.get(fileName) ?? 0;
    const sizeBytes = entry.sizeBytes ?? 0;
    const moduleCount = entry.moduleCount ?? 0;
    const edgeCount = entry.edgeCount ?? 0;
    const externalCount = entry.externalCount ?? 0;
    const qualifies = (
      // Force mode: any requested dep can be eligible, still subject to caps.
      mode === "force" && requestCount >= 1 || // Heuristic v1 (Phase 6.1 roadmap).
      requestCount >= 2 || sizeBytes >= 80 * 1024 || moduleCount >= 120 || edgeCount >= 400 || // Ionify-native signal: many external deps implies a request-waterfall root (e.g. Radix).
      externalCount >= 6
    );
    if (!qualifies) continue;
    const sizeKb = Math.max(sizeBytes / 1024, 1);
    const score = 10 * Math.min(requestCount, 5) + 8 * Math.log2(sizeKb) + 3 * Math.min(moduleCount / 50, 5) + // Extra weight for deps that trigger many external `/@deps/*` requests (waterfall roots).
    4 * Math.min(externalCount, 10);
    candidates.push({
      fileName,
      entryPath: entry.entryPath,
      packageLabel: entry.packageLabel || fileName,
      score,
      signals: { requestCount, sizeBytes, moduleCount, edgeCount, externalCount }
    });
  }
  candidates.sort((a, b) => {
    const scoreDelta = b.score - a.score;
    if (scoreDelta !== 0) return scoreDelta;
    return a.packageLabel.localeCompare(b.packageLabel);
  });
  const selected = [];
  const seen = /* @__PURE__ */ new Set();
  let totalBytes = 0;
  for (const candidate of candidates) {
    if (selected.length >= maxMembers) break;
    if (seen.has(candidate.fileName)) continue;
    const sizeBytes = candidate.signals.sizeBytes ?? 0;
    if (totalBytes + sizeBytes > maxBytes) continue;
    if (!candidate.entryPath || !fs8.existsSync(candidate.entryPath)) continue;
    seen.add(candidate.fileName);
    totalBytes += sizeBytes;
    selected.push(candidate);
  }
  return {
    version: 1,
    depsHash,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    members: selected
  };
}
function formatDepLabel(name, subpath) {
  if (!subpath) return name;
  const cleaned = subpath.replace(/^\.\//, "").replace(/^\/+/, "");
  if (!cleaned || cleaned === ".") return name;
  return `${name}/${cleaned}`;
}
function resolveDevProductionPublishingBuildMode(productionArtifactPublishing, env = process.env) {
  const raw = productionArtifactPublishing && typeof productionArtifactPublishing === "object" && typeof productionArtifactPublishing.mode === "string" ? productionArtifactPublishing.mode : env.IONIFY_PRODUCTION_PUBLISHING_MODE;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : "production";
}
async function startDevServer({
  port,
  host,
  enableSignalHandlers = true,
  mode
} = {}) {
  const bootStartMs = Date.now();
  const envMode = mode ?? process.env.IONIFY_MODE ?? process.env.MODE ?? "development";
  process.env.IONIFY_MODE = envMode;
  process.env.MODE = envMode;
  const userConfig = await loadIonifyConfig(process.cwd(), envMode);
  const configuredExternalSpecifiers = collectConfiguredExternalSpecifiers(userConfig);
  const projectRootOverride = userConfig?.root ? path7.resolve(userConfig.root) : null;
  const workspace = resolveWorkspace(projectRootOverride ?? process.cwd(), {
    projectRootOverride
  });
  const rootDir = workspace.projectRoot;
  const ionifyDir = workspace.ionifyDir;
  const allowedRoots = workspace.allowedRoots;
  const publicDirAbs = resolvePublicDir(rootDir, userConfig?.publicDir);
  fs8.mkdirSync(ionifyDir, { recursive: true });
  process.env.IONIFY_PROJECT_ROOT = rootDir;
  process.env.IONIFY_WORKSPACE_ROOT = workspace.workspaceRoot;
  process.env.IONIFY_STATE_DIR = ionifyDir;
  process.env.IONIFY_WORKSPACE_ID = workspace.workspaceId;
  process.env.IONIFY_PROJECT_ID = workspace.projectId;
  process.env.IONIFY_MODE = envMode;
  const configuredServer = userConfig?.server ?? {};
  const resolvedPort = port ?? configuredServer.port ?? 5173;
  const resolvedHost = host ?? configuredServer.host ?? process.env.IONIFY_HOST ?? "127.0.0.1";
  const httpsOptions = ensureDevHttpsOptions(configuredServer.https, rootDir, ionifyDir);
  const spaFallback = resolveSpaFallbackPolicy(rootDir, configuredServer.spaFallback);
  const protocol = httpsOptions ? "https" : "http";
  const watcher = new IonifyWatcher(rootDir);
  const cacheDebug = process.env.IONIFY_DEV_TRANSFORM_CACHE_DEBUG === "1";
  const minifier = resolveMinifier(userConfig, { envVar: process.env.IONIFY_MINIFIER });
  const parserMode = resolveParser(userConfig, { envMode: process.env.IONIFY_PARSER });
  applyParserEnv(parserMode);
  const treeshake = resolveTreeshake(userConfig?.treeshake, {
    envMode: process.env.IONIFY_TREESHAKE,
    includeEnv: process.env.IONIFY_TREESHAKE_INCLUDE,
    excludeEnv: process.env.IONIFY_TREESHAKE_EXCLUDE
  });
  const scopeHoist = resolveScopeHoist(userConfig?.scopeHoist, {
    envMode: process.env.IONIFY_SCOPE_HOIST,
    inlineEnv: process.env.IONIFY_SCOPE_HOIST_INLINE,
    constantEnv: process.env.IONIFY_SCOPE_HOIST_CONST,
    combineEnv: process.env.IONIFY_SCOPE_HOIST_COMBINE
  });
  const resolvedEntries = userConfig?.entry ? (Array.isArray(userConfig.entry) ? userConfig.entry : [userConfig.entry]).map(
    (entry) => entry.startsWith("/") ? path7.join(rootDir, entry) : path7.resolve(rootDir, entry)
  ) : void 0;
  const pluginNames = Array.isArray(userConfig?.plugins) ? userConfig.plugins.map((p) => typeof p === "string" ? p : p?.name).filter((name) => typeof name === "string" && name.length > 0) : void 0;
  const rawVersionInputs = {
    parserMode,
    minifier,
    treeshake,
    scopeHoist,
    plugins: pluginNames,
    entry: resolvedEntries ?? null,
    resolveOptions: {
      alias: userConfig?.resolve?.alias,
      builtinFallback: userConfig?.resolve?.builtinFallback,
      runtimeGlobals: userConfig?.resolve?.runtimeGlobals,
      extensions: userConfig?.resolve?.extensions,
      conditions: userConfig?.resolve?.conditions,
      mainFields: userConfig?.resolve?.mainFields
    },
    cssOptions: userConfig?.css,
    assetOptions: userConfig?.assets ?? userConfig?.asset,
    runtimeContracts: {
      reactRefreshRuntimeModule: REACT_REFRESH_RUNTIME_MODULE,
      reactRefreshHmr: REACT_REFRESH_HMR_CONTRACT_VERSION,
      federation: buildFederationVersionContract(userConfig?.federation)
    }
  };
  const configHash = computeGraphVersion(rawVersionInputs);
  logInfo(`[Dev] Version hash: ${configHash}`);
  process.env.IONIFY_CONFIG_HASH = configHash;
  const casRoot = path7.join(ionifyDir, "cas");
  const lockfile = readLockfile(workspace.workspaceRoot, rootDir);
  if (lockfile) {
    const countLabel = lockfile.packageCount === null ? "unknown" : lockfile.packageCount;
    logInfo(`[deps] SCAN lockfile: ${lockfile.name} (${countLabel} packages)`);
  }
  const depsSourcemapEnabled = userConfig?.optimizeDeps?.sourcemap === true;
  const depsBundleEsmEnabled = userConfig?.optimizeDeps?.bundleEsm !== false;
  const depsSharedChunksRaw = userConfig?.optimizeDeps?.sharedChunks;
  const depsSharedChunksMode = depsSharedChunksRaw === void 0 || depsSharedChunksRaw === "auto" ? "auto" : depsSharedChunksRaw === true ? "1" : depsSharedChunksRaw === false ? "0" : String(depsSharedChunksRaw);
  const depsSharedChunksEnabled = depsSharedChunksMode !== "0";
  const depsNodeEnv = process.env.NODE_ENV ?? "development";
  let depsHash = computeDepsHash(configHash, lockfile, {
    nodeEnv: depsNodeEnv,
    sourcemap: depsSourcemapEnabled,
    bundleEsm: depsBundleEsmEnabled,
    sharedChunks: depsSharedChunksMode,
    outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION
  });
  logInfo(`[deps] depsHash: ${depsHash} from ${lockfile?.name ?? "config"}`);
  process.env.IONIFY_DEPS_HASH = depsHash;
  const depsRuntimeUrl2 = (fileName) => formatDepsRuntimeUrl(fileName, depsHash);
  let depsRoot = path7.join(ionifyDir, "deps", depsHash);
  fs8.mkdirSync(depsRoot, { recursive: true });
  pruneDepsCache(ionifyDir, depsHash);
  const DEV_STABLE_DEBOUNCE_MS = 5e3;
  let devStableTimer = null;
  let devStableServedCount = 0;
  const writeDevStableSentinel = () => {
    try {
      const sentinelPath = path7.join(depsRoot, ".dev-stable");
      const payload = {
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        depsHash,
        nodeEnv: depsNodeEnv,
        servedDepCount: devStableServedCount
      };
      fs8.writeFileSync(sentinelPath, JSON.stringify(payload));
    } catch {
    }
  };
  const bumpDevStable = () => {
    devStableServedCount += 1;
    if (devStableTimer) clearTimeout(devStableTimer);
    devStableTimer = setTimeout(writeDevStableSentinel, DEV_STABLE_DEBOUNCE_MS);
    if (devStableTimer.unref) devStableTimer.unref();
  };
  const depsManifestIndex = loadDepsManifestIndex(depsRoot);
  let depsManifestCanonicalFileNames = buildCanonicalDepFileNameIndex(
    Array.from(depsManifestIndex, ([fileName, entry]) => ({ fileName, entryPath: entry.entryPath }))
  );
  const refreshDepsManifestIndex = () => {
    const refreshed = loadDepsManifestIndex(depsRoot);
    depsManifestIndex.clear();
    refreshed.forEach((value, key) => depsManifestIndex.set(key, value));
    depsManifestCanonicalFileNames = buildCanonicalDepFileNameIndex(
      Array.from(depsManifestIndex, ([fileName, entry]) => ({ fileName, entryPath: entry.entryPath }))
    );
  };
  const canonicalFileNameForEntry = (fileName, entryPath) => {
    return canonicalizeDepFileName(fileName, entryPath, depsManifestCanonicalFileNames);
  };
  const realpathOrSelf = (filePath) => {
    try {
      return fs8.realpathSync(filePath);
    } catch {
      return filePath;
    }
  };
  const recordDepLeafGraphNodes = (depAbsPaths) => {
    if (depAbsPaths.length === 0) return;
    if (depsManifestIndex.size === 0) refreshDepsManifestIndex();
    const manifestEntries = Array.from(depsManifestIndex.values());
    const byCanonicalEntry = /* @__PURE__ */ new Map();
    for (const entry of manifestEntries) {
      if (!entry.artifactHash) continue;
      byCanonicalEntry.set(realpathOrSelf(entry.entryPath), entry);
    }
    const seen = /* @__PURE__ */ new Set();
    for (const depAbs of depAbsPaths) {
      if (typeof depAbs !== "string" || depAbs.length === 0) continue;
      if (!depAbs.includes(`${path7.sep}node_modules${path7.sep}`)) continue;
      const canonical = realpathOrSelf(depAbs);
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      const existing = graph.getNode(canonical) ?? graph.getNode(depAbs);
      if (existing?.hash) continue;
      const depId = toWsModuleId(depAbs, workspace.workspaceRoot);
      if (!depId) continue;
      const entry = byCanonicalEntry.get(canonical);
      let hash = entry?.artifactHash ?? null;
      if (!hash) {
        try {
          hash = crypto2.createHash("sha256").update(fs8.readFileSync(canonical)).digest("hex");
        } catch {
          continue;
        }
      }
      graph.recordNodeById(depId, hash, [], [], "dep", configHash);
    }
  };
  const graphCompletionExts = /* @__PURE__ */ new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);
  const completeLocalGraphClosure = (seedAbsPaths) => {
    const queue = seedAbsPaths.filter((dep) => typeof dep === "string" && dep.length > 0);
    const seen = /* @__PURE__ */ new Set();
    let processed = 0;
    while (queue.length && processed < 2e3) {
      const absPath = queue.shift();
      if (!path7.isAbsolute(absPath)) continue;
      const canonical = realpathOrSelf(absPath);
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      if (canonical.includes(`${path7.sep}node_modules${path7.sep}`)) {
        recordDepLeafGraphNodes([canonical]);
        continue;
      }
      if (graph.getNode(canonical)) continue;
      if (!fs8.existsSync(canonical)) continue;
      const extName = path7.extname(canonical).toLowerCase();
      if (isAssetExt(extName)) {
        try {
          const assetHash = crypto2.createHash("sha256").update(fs8.readFileSync(canonical)).digest("hex");
          graph.recordFile(canonical, assetHash, [], [], "asset");
        } catch {
        }
        continue;
      }
      if (!graphCompletionExts.has(extName)) continue;
      let code;
      try {
        code = fs8.readFileSync(canonical, "utf8");
      } catch {
        continue;
      }
      processed++;
      let hash;
      let specs;
      if (native?.parseModuleIr) {
        try {
          const ir = native.parseModuleIr(canonical, code);
          hash = ir.hash;
          specs = ir.dependencies.map((dep) => dep.specifier);
        } catch {
          hash = getCacheKey(code);
          specs = extractImports(code, canonical);
        }
      } else {
        hash = getCacheKey(code);
        specs = extractImports(code, canonical);
      }
      const { localDeps, externalDeps } = classifyImportSpecifiersForGraph(
        specs,
        canonical,
        configuredExternalSpecifiers
      );
      const nextDeps = rewriteFederationGraphEdgeIds(
        [...localDeps, ...externalDeps],
        federationRemoteBindings
      );
      recordDepLeafGraphNodes(localDeps);
      graph.recordFile(canonical, hash, nextDeps);
      for (const dep of localDeps) queue.push(dep);
    }
  };
  const pendingGraphCompletionSeeds = /* @__PURE__ */ new Set();
  const enqueueLocalGraphCompletion = (seedAbsPaths) => {
    for (const depAbs of seedAbsPaths) {
      if (typeof depAbs !== "string" || depAbs.length === 0 || !path7.isAbsolute(depAbs)) continue;
      pendingGraphCompletionSeeds.add(depAbs);
    }
  };
  const drainPendingGraphCompletion = async () => {
    if (pendingGraphCompletionSeeds.size === 0) return;
    const seeds = Array.from(pendingGraphCompletionSeeds);
    pendingGraphCompletionSeeds.clear();
    completeLocalGraphClosure(seeds);
    graph.flush();
  };
  const upsertObservedPackEntry = (groupMap, entry) => {
    const canonicalEntryPath = realpathOrSelf(entry.entryPath);
    let existed = groupMap.has(entry.fileName);
    for (const [existingFileName, existing] of Array.from(groupMap.entries())) {
      if (!existing?.entryPath) continue;
      if (realpathOrSelf(existing.entryPath) !== canonicalEntryPath) continue;
      existed = true;
      if (existingFileName !== entry.fileName) {
        groupMap.delete(existingFileName);
      }
    }
    groupMap.set(entry.fileName, entry);
    return !existed;
  };
  const depUsageStatePath = () => path7.join(depsRoot, "deps-usage.v2.json");
  const legacyDepUsageStatePath = () => path7.join(depsRoot, "deps-usage.v1.json");
  const directDepUsageFileNames = /* @__PURE__ */ new Set();
  const setDirectDepUsageFileNames = (index) => {
    directDepUsageFileNames.clear();
    if (!index) return;
    for (const usage of index.values()) {
      if (!usage?.fileName || !usage?.entryPath) continue;
      directDepUsageFileNames.add(canonicalFileNameForEntry(usage.fileName, usage.entryPath));
    }
  };
  const loadDirectDepUsageFileNamesFromDisk = () => {
    const raw = readJsonFile3(depUsageStatePath()) ?? readJsonFile3(legacyDepUsageStatePath());
    if (!raw || raw.version !== 1 && raw.version !== 2 || raw.depsHash !== depsHash) return;
    const deps = raw.deps && typeof raw.deps === "object" ? raw.deps : {};
    for (const [fileName, value] of Object.entries(deps)) {
      const entryPath = typeof value?.entryPath === "string" ? value.entryPath : "";
      if (!fileName || !entryPath) continue;
      directDepUsageFileNames.add(canonicalFileNameForEntry(fileName, entryPath));
    }
  };
  loadDirectDepUsageFileNamesFromDisk();
  const isDirectlyUsedDepFile = (fileName, entryPath) => {
    if (directDepUsageFileNames.size === 0) return true;
    return directDepUsageFileNames.has(canonicalFileNameForEntry(fileName, entryPath));
  };
  const optimizeVendorMode = userConfig?.optimizeDeps?.vendor ?? "auto";
  const optimizeExclude = Array.isArray(userConfig?.optimizeDeps?.exclude) ? new Set(userConfig.optimizeDeps.exclude) : null;
  const autoVendor = optimizeVendorMode === "auto";
  const vendorSpecifiersRaw = optimizeVendorMode === false ? [] : Array.isArray(optimizeVendorMode) ? optimizeVendorMode : autoVendor ? detectVendorSpecifiers(readProjectPackageJson(rootDir)) : [];
  const vendorSpecifiers = vendorSpecifiersRaw.map((s) => String(s).trim()).filter(Boolean).filter((s) => !optimizeExclude?.has(s));
  const vendorDeps = resolveVendorDeps(rootDir, vendorSpecifiers);
  const vendorPacksRaw = userConfig?.optimizeDeps?.vendorPacks ?? false;
  const packSlimmingRaw = userConfig?.optimizeDeps?.packSlimming ?? "auto";
  const vendorPacksForce = vendorPacksRaw === true;
  const vendorPacksProgressive = vendorPacksRaw === "auto";
  const vendorPacksManualRaw = !vendorPacksForce && !vendorPacksProgressive && vendorPacksRaw && typeof vendorPacksRaw === "object" && !Array.isArray(vendorPacksRaw) ? vendorPacksRaw : null;
  const normalizeManualPackGroup = (raw) => {
    const base = String(raw ?? "").trim().toLowerCase();
    if (!base) return null;
    const normalized = base.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
    return normalized || null;
  };
  const normalizeMatchSubpath = (subpath) => {
    if (!subpath) return null;
    const cleaned = String(subpath).trim().replace(/^\.\//, "").replace(/^\/+/, "");
    if (!cleaned || cleaned === "." || cleaned === "index") return null;
    return cleaned;
  };
  const escapeRegExp = (value) => {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };
  const compileManualPackMatchers = (patterns) => {
    const matchers = [];
    for (const rawPattern of patterns) {
      const pattern = String(rawPattern ?? "").trim();
      if (!pattern) continue;
      if (pattern.includes("*")) {
        const source = `^${escapeRegExp(pattern).replace(/\\\*/g, ".*")}$`;
        let re = null;
        try {
          re = new RegExp(source);
        } catch {
          re = null;
        }
        if (!re) continue;
        matchers.push({
          raw: pattern,
          test: (pkgName, subpath) => {
            const pkg = String(pkgName ?? "");
            if (re.test(pkg)) return true;
            const sp = normalizeMatchSubpath(subpath);
            if (!sp) return false;
            return re.test(`${pkg}/${sp}`);
          }
        });
        continue;
      }
      matchers.push({
        raw: pattern,
        test: (pkgName, subpath) => {
          const pkg = String(pkgName ?? "");
          if (pkg === pattern) return true;
          const sp = normalizeMatchSubpath(subpath);
          if (!sp) return false;
          return `${pkg}/${sp}` === pattern;
        }
      });
    }
    return matchers;
  };
  const vendorPacksManualDefs = [];
  if (vendorPacksManualRaw) {
    const defsByGroup = /* @__PURE__ */ new Map();
    for (const [rawGroup, rawPatterns] of Object.entries(vendorPacksManualRaw)) {
      const group = normalizeManualPackGroup(rawGroup);
      if (!group) continue;
      const patterns = Array.isArray(rawPatterns) ? rawPatterns : [];
      const matchers = compileManualPackMatchers(
        patterns.map((v) => String(v ?? "").trim()).filter(Boolean).filter((spec) => !optimizeExclude?.has(spec))
      );
      if (matchers.length === 0) continue;
      const existing = defsByGroup.get(group);
      if (existing) {
        existing.matchers.push(...matchers);
        continue;
      }
      const def = { group, matchers };
      defsByGroup.set(group, def);
      vendorPacksManualDefs.push(def);
    }
  }
  const classifyManualPackGroup = (pkgName, subpath) => {
    if (!pkgName) return null;
    const pkg = String(pkgName);
    if (optimizeExclude?.has(pkg)) return null;
    const sp = normalizeMatchSubpath(subpath);
    if (sp && optimizeExclude?.has(`${pkg}/${sp}`)) return null;
    for (const def of vendorPacksManualDefs) {
      for (const matcher of def.matchers) {
        try {
          if (matcher.test(pkg, sp)) return def.group;
        } catch {
        }
      }
    }
    return null;
  };
  const vendorPacksManual = vendorPacksManualDefs.length > 0;
  const vendorPacksEnabled = vendorPacksForce || vendorPacksProgressive || vendorPacksManual;
  const packSlimmingEnabled = vendorPacksEnabled && (packSlimmingRaw === true || packSlimmingRaw === "auto" || packSlimmingRaw === void 0);
  const vendorPacksMode = vendorPacksForce ? "force" : "auto";
  const vendorPackMaxBytes = typeof userConfig?.optimizeDeps?.vendorPackMaxBytes === "number" && userConfig.optimizeDeps.vendorPackMaxBytes > 0 ? Math.floor(userConfig.optimizeDeps.vendorPackMaxBytes) : 600 * 1024;
  const vendorPackMaxMembers = typeof userConfig?.optimizeDeps?.vendorPackMaxMembers === "number" && userConfig.optimizeDeps.vendorPackMaxMembers > 0 ? Math.floor(userConfig.optimizeDeps.vendorPackMaxMembers) : 25;
  const vendorPackPlanPath = () => path7.join(depsRoot, "vendor-pack.app.json");
  const vendorPackRequestsPath = () => path7.join(depsRoot, "deps-requests.json");
  let vendorPackLastRequestCounts = vendorPacksEnabled ? loadDepRequestCounts(vendorPackRequestsPath()) : /* @__PURE__ */ new Map();
  const vendorPackPlanFromDisk = vendorPacksForce ? readJsonFile3(vendorPackPlanPath()) : null;
  const vendorPackPlanFromDiskValid = vendorPacksForce && vendorPackPlanFromDisk && typeof vendorPackPlanFromDisk?.depsHash === "string" && vendorPackPlanFromDisk.depsHash === depsHash && Array.isArray(vendorPackPlanFromDisk?.members) ? vendorPackPlanFromDisk : null;
  const vendorPackComputedPlan = vendorPacksForce ? buildVendorPackPlan({
    depsHash,
    mode: vendorPacksMode,
    vendorDeps,
    manifestIndex: depsManifestIndex,
    requestCounts: vendorPackLastRequestCounts,
    maxBytes: vendorPackMaxBytes,
    maxMembers: vendorPackMaxMembers
  }) : null;
  const vendorPackPlan = vendorPacksForce ? vendorPackComputedPlan && vendorPackComputedPlan.members.length > 0 ? vendorPackComputedPlan : vendorPackPlanFromDiskValid ?? vendorPackComputedPlan : null;
  if (vendorPacksForce && vendorPackPlan) {
    writeJsonFile3(vendorPackPlanPath(), vendorPackPlan);
  }
  const vendorPackMembers = vendorPacksForce && vendorPackPlan ? vendorPackPlan.members : [];
  const vendorPackEntries = [];
  const vendorPackFileNameSet = /* @__PURE__ */ new Set();
  for (const dep of vendorDeps) {
    if (vendorPackFileNameSet.has(dep.fileName)) continue;
    vendorPackFileNameSet.add(dep.fileName);
    vendorPackEntries.push({ entryPath: dep.entryPath, fileName: dep.fileName, packageLabel: dep.packageLabel });
  }
  for (const member of vendorPackMembers) {
    if (!member?.fileName || !member?.entryPath) continue;
    if (!fs8.existsSync(member.entryPath)) continue;
    if (vendorPackFileNameSet.has(member.fileName)) continue;
    vendorPackFileNameSet.add(member.fileName);
    vendorPackEntries.push({
      entryPath: member.entryPath,
      fileName: member.fileName,
      packageLabel: member.packageLabel || member.fileName
    });
  }
  const vendorPackDepFileNames = new Set(vendorPackEntries.map((d) => d.fileName));
  const canChunkVendorPacks = vendorPacksForce && depsSharedChunksEnabled && vendorPackEntries.length > 1 && !!native?.optimizeDependenciesChunked && !depsSourcemapEnabled && depsBundleEsmEnabled;
  if (vendorPacksForce && !canChunkVendorPacks) {
    const reasons = [];
    if (!depsSharedChunksEnabled) reasons.push("sharedChunks=0");
    if (depsSourcemapEnabled) reasons.push("sourcemap=1");
    if (!depsBundleEsmEnabled) reasons.push("bundleEsm=0");
    if (!native?.optimizeDependenciesChunked) reasons.push("nativeChunked=0");
    if (vendorPackEntries.length <= 1) reasons.push("members<=1");
    logWarn(
      `[deps] vendorPacks enabled but chunking is unavailable (${reasons.join(", ")}). Falling back to per-entry deps.`
    );
  }
  const vendorPackChunkGroupId = canChunkVendorPacks ? computeChunkGroupIdFromStableIds(vendorPackEntries.map((d) => d.fileName)) : null;
  const vendorPackSharedFileName = vendorPackChunkGroupId ? `shared.${vendorPackChunkGroupId}.js` : null;
  const vendorPackSharedUrl = vendorPackSharedFileName ? depsRuntimeUrl2(vendorPackSharedFileName) : null;
  const vendorPackSessionRequestCounts = vendorPacksEnabled ? /* @__PURE__ */ new Map() : null;
  let vendorPackRequestCountsDirty = false;
  let vendorPackRequestCountsLastFlush = 0;
  const flushVendorPackRequestCounts = (force = false) => {
    if (!vendorPackSessionRequestCounts || !vendorPacksEnabled) return;
    if (!vendorPackRequestCountsDirty && !force) return;
    const now = Date.now();
    if (!force && now - vendorPackRequestCountsLastFlush < 2e3) return;
    vendorPackRequestCountsLastFlush = now;
    vendorPackRequestCountsDirty = false;
    saveDepRequestCounts(vendorPackRequestsPath(), vendorPackSessionRequestCounts);
  };
  const getKnownDepRequestCount = (fileName) => {
    const sessionCount = vendorPackSessionRequestCounts?.get(fileName) ?? 0;
    if (sessionCount > 0) return sessionCount;
    return vendorPackLastRequestCounts.get(fileName) ?? 0;
  };
  const getVendorPackFileName = () => vendorDeps.length > 0 ? `vendor.${depsHash}.js` : null;
  const getVendorPackUrl = () => {
    const fileName = getVendorPackFileName();
    return fileName ? depsRuntimeUrl2(fileName) : null;
  };
  const vendorDepFileNames = new Set(vendorDeps.map((d) => d.fileName));
  const canChunkVendorCore = depsSharedChunksEnabled && vendorDeps.length > 1 && !!native?.optimizeDependenciesChunked && !depsSourcemapEnabled && depsBundleEsmEnabled && // Avoid conflicting chunk groups when `vendorPacks: true` is active and chunked.
  !canChunkVendorPacks;
  const vendorCoreChunkGroupId = canChunkVendorCore ? computeChunkGroupIdFromStableIds(vendorDeps.map((d) => d.fileName)) : null;
  const vendorCoreSharedFileName = vendorCoreChunkGroupId ? `shared.${vendorCoreChunkGroupId}.js` : null;
  const vendorCoreSharedUrl = vendorCoreSharedFileName ? depsRuntimeUrl2(vendorCoreSharedFileName) : null;
  const ensureVendorPackFile = () => {
    const vendorPackFileName = getVendorPackFileName();
    const vendorPackUrl = getVendorPackUrl();
    if (!vendorPackFileName || !vendorPackUrl || vendorDeps.length === 0) return;
    const vendorKey = getCacheKey(
      `vendor:v1:${vendorDeps.map((d) => `${d.specifier}:${d.fileName}`).sort().join("|")}`
    );
    const filePath = path7.join(depsRoot, vendorPackFileName);
    if (fs8.existsSync(filePath)) {
      try {
        const head = fs8.readFileSync(filePath, "utf8").slice(0, 256);
        if (head.includes(`${IONIFY_VENDOR_PACK_MARKER} ${vendorKey}`)) return;
      } catch {
      }
    }
    const imports = vendorDeps.slice().sort((a, b) => a.specifier.localeCompare(b.specifier)).map((d) => `import "${depsRuntimeUrl2(d.fileName)}";`).join("\n");
    const body = `${IONIFY_VENDOR_PACK_MARKER} ${vendorKey}
// depsHash: ${depsHash}
// vendor: ${vendorDeps.map((d) => d.specifier).join(", ")}
${imports}
`;
    try {
      fs8.writeFileSync(filePath, body, "utf8");
    } catch {
    }
  };
  const vendorPackV2IndexPath = () => path7.join(depsRoot, "vendor-pack.v2.index.json");
  const vendorPackV2AllowedPrefix = vendorPacksManual ? "vendor-pack.manual." : vendorPacksProgressive ? "vendor-pack.feature." : null;
  let vendorPackV2 = new VendorPackV2IndexManager({
    depsRoot,
    depsHash,
    outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
    allowPackFilePrefix: vendorPackV2AllowedPrefix,
    log: { info: logInfo, warn: logWarn }
  });
  vendorPackV2.loadFromDisk();
  const routeHintStatePath = path7.join(ionifyDir, "route-hints.v1.json");
  const routeHints = new RouteHintIndex(routeHintStatePath);
  const startupPolicyRaw = userConfig?.startupPolicy;
  const startupPolicyObject = startupPolicyRaw && typeof startupPolicyRaw === "object" && !Array.isArray(startupPolicyRaw) ? startupPolicyRaw : {};
  const startupPolicyModeRaw = String(
    process.env.IONIFY_STARTUP_POLICY ?? startupPolicyObject.mode ?? (startupPolicyRaw === false ? "off" : "auto")
  ).toLowerCase();
  const startupPolicyEnabled = startupPolicyModeRaw !== "off" && startupPolicyRaw !== false;
  const startupPolicyPreloadAuthorityEnabled = startupPolicyEnabled && startupPolicyModeRaw !== "observe";
  const startupPolicyObserveEvaluations = startupPolicyEnabled && (process.env.IONIFY_STARTUP_OBSERVE_EVALUATIONS === "1" || process.env.IONIFY_STARTUP_EVAL_OBSERVATION === "1" || startupPolicyObject.observeEvaluations === true);
  const startupPolicyEagerBudget = {
    minRouteDocuments: typeof startupPolicyObject.minRouteDocuments === "number" ? startupPolicyObject.minRouteDocuments : 3,
    maxEagerDepAssets: typeof startupPolicyObject.maxEagerDepAssets === "number" ? startupPolicyObject.maxEagerDepAssets : 4,
    maxEagerSourceAssets: typeof startupPolicyObject.maxEagerSourceAssets === "number" ? startupPolicyObject.maxEagerSourceAssets : 4,
    maxEagerTotalAssets: typeof startupPolicyObject.maxEagerTotalAssets === "number" ? startupPolicyObject.maxEagerTotalAssets : 6,
    maxEagerDepBytes: typeof startupPolicyObject.maxEagerDepBytes === "number" ? startupPolicyObject.maxEagerDepBytes : 256 * 1024,
    maxEagerSourceBytes: typeof startupPolicyObject.maxEagerSourceBytes === "number" ? startupPolicyObject.maxEagerSourceBytes : 128 * 1024,
    maxEagerTotalBytes: typeof startupPolicyObject.maxEagerTotalBytes === "number" ? startupPolicyObject.maxEagerTotalBytes : 384 * 1024
  };
  const startupObservationStatePath = path7.join(ionifyDir, "startup-observations.v1.json");
  const startupPolicyStatePath = path7.join(ionifyDir, "startup-policy.v1.json");
  const startupObservations = new StartupObservationIndex(startupObservationStatePath);
  let startupPolicySnapshot = loadStartupPolicySnapshot(startupPolicyStatePath);
  const startupInstrumentJavaScriptBuffer = (buffer) => instrumentJavaScriptBuffer(buffer, startupPolicyObserveEvaluations);
  const startupInstrumentJavaScriptCode = (code) => startupPolicyObserveEvaluations ? injectStartupEvaluationMarker(code) : code;
  const bootstrapSourceExts = /* @__PURE__ */ new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);
  const resolveBootstrapEntryFile = (rawEntryPath) => {
    const raw = String(rawEntryPath || "").trim();
    if (!raw) return null;
    const candidates = path7.isAbsolute(raw) ? [raw, path7.join(rootDir, raw.replace(/^\/+/, ""))] : [path7.resolve(rootDir, raw)];
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (fs8.existsSync(candidate)) return candidate;
    }
    return null;
  };
  const bootstrapEntryFiles = (() => {
    if (Array.isArray(resolvedEntries) && resolvedEntries.length > 0) {
      return resolvedEntries.map((entryPath) => resolveBootstrapEntryFile(String(entryPath))).filter((entryPath) => typeof entryPath === "string" && entryPath.length > 0);
    }
    const entries = [];
    for (const candidate of [
      path7.join(rootDir, "src", "main.tsx"),
      path7.join(rootDir, "src", "main.ts"),
      path7.join(rootDir, "src", "index.tsx"),
      path7.join(rootDir, "src", "index.ts")
    ]) {
      if (fs8.existsSync(candidate)) entries.push(candidate);
    }
    return entries;
  })();
  const resolveAuthoritativeDepPreloadUrls = (hintUrl) => {
    const fileName = depsFileNameFromRuntimeUrl(hintUrl);
    if (!fileName) return [];
    const fileNames = resolveAuthoritativeDepPreloadFiles({
      fileName,
      fileExists: (candidateFileName) => fs8.existsSync(path7.join(depsRoot, candidateFileName)),
      fileNameToPackFile: vendorPackV2.fileNameToPackFile,
      packFileToChunkFiles: vendorPackV2.packFileToChunkFiles,
      packFileToSharedFile: vendorPackV2.packFileToSharedFile,
      currentStableSharedFileNames: [vendorPackSharedFileName, vendorCoreSharedFileName].filter(
        (value) => typeof value === "string" && value.endsWith(".js")
      )
    });
    return fileNames.map((candidateFileName) => depsRuntimeUrl2(candidateFileName));
  };
  const isRouteHintPreloadValid = (hintUrl, kind) => {
    if (kind === "dep") {
      return resolveAuthoritativeDepPreloadUrls(hintUrl).length > 0;
    }
    const parsedHint = url.parse(hintUrl);
    const hintPath = parsedHint.pathname || "";
    if (!hintPath || hintPath === "/" || hintPath.startsWith(DEPS_PREFIX) || hintPath.startsWith("/__ionify")) {
      return false;
    }
    const resolved = decodePublicPath(rootDir, hintPath, {
      allowedRoots,
      workspaceRoot: workspace.workspaceRoot
    });
    if (!resolved || !fs8.existsSync(resolved)) return false;
    const stat = fs8.statSync(resolved);
    if (stat.isDirectory()) return false;
    const ext = path7.extname(resolved).toLowerCase();
    return ext !== ".html" && !isAssetExt(ext);
  };
  const expandRouteHintPreloadUrls = (hintUrl, kind) => {
    if (kind !== "dep" || !hintUrl.startsWith(DEPS_PREFIX)) return [hintUrl];
    const authoritative = resolveAuthoritativeDepPreloadUrls(hintUrl);
    return authoritative.length > 0 ? authoritative : [hintUrl];
  };
  const estimateStartupAssetSize = (assetUrl, kind) => {
    const parsed = url.parse(assetUrl);
    const pathname = parsed.pathname || "";
    if (!pathname) return null;
    const candidatePath = kind === "dep" && pathname.startsWith(DEPS_PREFIX) ? path7.join(depsRoot, pathname.slice(DEPS_PREFIX.length)) : decodePublicPath(rootDir, pathname, { allowedRoots, workspaceRoot: workspace.workspaceRoot });
    if (!candidatePath || !fs8.existsSync(candidatePath)) return null;
    try {
      const stat = fs8.statSync(candidatePath);
      return stat.isFile() ? stat.size : null;
    } catch {
      return null;
    }
  };
  const refreshStartupPolicySnapshot = () => {
    const next = buildStartupPolicySnapshot({
      routeKeys: routeHints.listRouteKeys(),
      routeAssetsForRoute: (routeKey) => routeHints.getRouteAssetEntries(routeKey),
      assetSummaries: routeHints.summarizeAssets(),
      observations: startupObservations,
      assetSizeBytes: estimateStartupAssetSize,
      isAssetValid: isRouteHintPreloadValid,
      eagerBudget: startupPolicyEagerBudget
    });
    if (!startupPolicySnapshot || startupPolicySnapshot.policyHash !== next.policyHash) {
      persistStartupPolicySnapshot(startupPolicyStatePath, next);
    }
    startupPolicySnapshot = next;
    return next;
  };
  const buildStartupPolicyClientScript = (documentRouteKey) => `(()=>{const routeKey=${JSON.stringify(documentRouteKey)};const reportUrl="/__ionify_startup/report";const loaded=[];const loadedSet=new Set();const evaluated=[];const evaluatedSet=new Set();let fcpTime=Number.POSITIVE_INFINITY;let reported=false;const normalize=(value)=>{try{const parsed=new URL(String(value),location.href);if(parsed.origin!==location.origin)return null;return parsed.pathname+parsed.search;}catch{return null;}};const trackLoaded=(name,startTime)=>{const url=normalize(name);if(!url)return;loaded.push({url,startTime:Number(startTime)||0});};globalThis.__IONIFY_STARTUP__={markEvaluated:(value)=>{const url=normalize(value);if(!url||evaluatedSet.has(url))return;evaluatedSet.add(url);evaluated.push({url,time:(globalThis.performance&&performance.now)?performance.now():0});}};const send=()=>{if(reported)return;reported=true;const effectiveFcp=Number.isFinite(fcpTime)?fcpTime:Number.POSITIVE_INFINITY;const preFcpLoadedUrls=[];for(const item of loaded){if(item.startTime<=effectiveFcp&&!loadedSet.has(item.url)){loadedSet.add(item.url);preFcpLoadedUrls.push(item.url);}}const preFcpEvaluatedUrls=[];for(const item of evaluated){if(item.time<=effectiveFcp&&!preFcpEvaluatedUrls.includes(item.url))preFcpEvaluatedUrls.push(item.url);}const payload={routeKey,documentUrl:location.pathname+location.search,preFcpLoadedUrls,preFcpEvaluatedUrls};const body=JSON.stringify(payload);const fallbackBeacon=()=>{if(!navigator.sendBeacon)return;try{const blob=new Blob([body],{type:"application/json"});navigator.sendBeacon(reportUrl,blob);}catch{}};fetch(reportUrl,{method:"POST",headers:{"content-type":"application/json"},body}).catch(()=>{fallbackBeacon();});};try{new PerformanceObserver((list)=>{for(const entry of list.getEntries()){if(entry.name==="first-contentful-paint"){fcpTime=Math.min(fcpTime,entry.startTime);setTimeout(send,0);}}}).observe({type:"paint",buffered:true});}catch{}try{new PerformanceObserver((list)=>{for(const entry of list.getEntries()){if(entry.entryType==="resource")trackLoaded(entry.name,entry.startTime);}}).observe({type:"resource",buffered:true});}catch{}if(globalThis.performance&&typeof performance.getEntriesByType==="function"){for(const entry of performance.getEntriesByType("resource"))trackLoaded(entry.name,entry.startTime);}globalThis.addEventListener("pagehide",()=>setTimeout(send,0),{once:true});globalThis.addEventListener("load",()=>setTimeout(send,250),{once:true});})();`;
  const collectBootstrapPackageRootToDepFiles = () => {
    const next = /* @__PURE__ */ new Map();
    const register = (packageRoot, fileName) => {
      if (!packageRoot || !fileName) return;
      const normalizedRoot = packageRoot.trim();
      const normalizedFileName = String(fileName).trim();
      if (!normalizedRoot || !normalizedFileName) return;
      let set = next.get(normalizedRoot);
      if (!set) {
        set = /* @__PURE__ */ new Set();
        next.set(normalizedRoot, set);
      }
      set.add(normalizedFileName);
    };
    for (const state of featureLastReadyState.values()) {
      if (!state || state.status !== "ready" || !state.chunkGroupId || !state.sharedFileName || !Array.isArray(state.entries)) {
        continue;
      }
      for (const entry of state.entries) {
        if (!entry?.fileName) continue;
        register(extractPackageRootFromLabel(entry.packageLabel), entry.fileName);
      }
    }
    return next;
  };
  const collectBootstrapRoutedPackPreloadUrls = () => {
    if (!vendorPacksEnabled || vendorPackV2.fileNameToPackFile.size === 0) return [];
    if (!native?.resolveModule || bootstrapEntryFiles.length === 0) return [];
    const queue = bootstrapEntryFiles.slice();
    const visited = /* @__PURE__ */ new Set();
    const routedPreloads = /* @__PURE__ */ new Set();
    const resolvedDepFiles = /* @__PURE__ */ new Set();
    const observedBarePackageRoots = /* @__PURE__ */ new Set();
    const maxSourceFiles = 32;
    while (queue.length > 0 && visited.size < maxSourceFiles) {
      const nextPath = queue.shift();
      if (!nextPath || !fs8.existsSync(nextPath)) continue;
      const canonicalPath = (() => {
        try {
          return fs8.realpathSync(nextPath);
        } catch {
          return nextPath;
        }
      })();
      if (visited.has(canonicalPath)) continue;
      visited.add(canonicalPath);
      if (!bootstrapSourceExts.has(path7.extname(canonicalPath).toLowerCase())) continue;
      let code = "";
      try {
        code = fs8.readFileSync(canonicalPath, "utf8");
      } catch {
        continue;
      }
      let specs = [];
      if (native?.parseModuleIr) {
        try {
          const ir = native.parseModuleIr(canonicalPath, code);
          specs = Array.isArray(ir?.dependencies) ? ir.dependencies.map((dep) => dep.specifier).filter((value) => typeof value === "string" && value.length > 0) : [];
        } catch {
          specs = extractImports(code, canonicalPath);
        }
      } else {
        specs = extractImports(code, canonicalPath);
      }
      for (const spec of specs) {
        const packageRoot = extractBarePackageRoot(spec);
        if (packageRoot) observedBarePackageRoots.add(packageRoot);
      }
      const { localDeps, externalDeps } = classifyImportSpecifiersForGraph(
        specs,
        canonicalPath,
        configuredExternalSpecifiers
      );
      for (const localDep of localDeps) {
        if (!path7.isAbsolute(localDep)) continue;
        if (!fs8.existsSync(localDep)) continue;
        if (localDep.includes(`${path7.sep}node_modules${path7.sep}`)) continue;
        if (!bootstrapSourceExts.has(path7.extname(localDep).toLowerCase())) continue;
        queue.push(localDep);
      }
      for (const externalDep of externalDeps) {
        const packageRoot = extractBarePackageRoot(externalDep);
        if (packageRoot) observedBarePackageRoots.add(packageRoot);
        try {
          const resolved = native.resolveModule(externalDep, rootDir);
          const fsPath = resolved?.fsPath ?? resolved?.fs_path ?? null;
          if (!fsPath || typeof fsPath !== "string") continue;
          const pkg = resolved?.pkg ?? null;
          const packageName = typeof pkg?.name === "string" ? pkg.name : externalDep;
          const packageVersion = typeof pkg?.version === "string" ? pkg.version : "0.0.0";
          const subpath = computeSubpathForDep2(fsPath, pkg);
          const entry = registerDepEntry({
            entryPath: fsPath,
            packageName,
            packageVersion,
            subpath
          });
          resolvedDepFiles.add(entry.fileName);
        } catch {
        }
      }
    }
    const bootstrapPackageRootToDepFiles = collectBootstrapPackageRootToDepFiles();
    for (const packageRoot of Array.from(observedBarePackageRoots).sort()) {
      const fileNames = bootstrapPackageRootToDepFiles.get(packageRoot);
      if (!fileNames || fileNames.size === 0) continue;
      for (const depFileName of fileNames) {
        resolvedDepFiles.add(depFileName);
      }
    }
    for (const depFileName of Array.from(resolvedDepFiles).sort()) {
      for (const preloadUrl of resolveAuthoritativeDepPreloadUrls(depsRuntimeUrl2(depFileName))) {
        routedPreloads.add(preloadUrl);
      }
    }
    return Array.from(routedPreloads);
  };
  const minimumRequestPositivePackMembers = depsSharedChunksEnabled ? 4 : 3;
  const hasPositivePackRequestSavings = (memberCount) => {
    return Number.isFinite(memberCount) && memberCount >= minimumRequestPositivePackMembers;
  };
  const featurePacksEnabled = vendorPacksProgressive && depsSharedChunksEnabled && !!native?.optimizeDependenciesChunked && !depsSourcemapEnabled && depsBundleEsmEnabled;
  if (vendorPacksProgressive && !featurePacksEnabled) {
    const reasons = [];
    if (!depsSharedChunksEnabled) reasons.push("sharedChunks=0");
    if (depsSourcemapEnabled) reasons.push("sourcemap=1");
    if (!depsBundleEsmEnabled) reasons.push("bundleEsm=0");
    if (!native?.optimizeDependenciesChunked) reasons.push("nativeChunked=0");
    logWarn(
      `[deps] vendorPacks:auto enabled but feature packs are unavailable (${reasons.join(", ")}). Falling back to per-entry deps.`
    );
  }
  const featurePackIndexPath = () => path7.join(depsRoot, "vendor-pack.feature.index.json");
  const featurePackStatePathFor = (group) => path7.join(depsRoot, `vendor-pack.feature.${group}.json`);
  const featurePackSlimStatePathFor = (group) => path7.join(depsRoot, `vendor-pack.feature.${group}.slim.json`);
  const discoverFeaturePackGroupsFromDisk = () => {
    if (!featurePacksEnabled) return [];
    let names = [];
    try {
      names = fs8.readdirSync(depsRoot);
    } catch {
      return [];
    }
    const groups = /* @__PURE__ */ new Set();
    for (const name of names) {
      const slimMatch = /^vendor-pack\.feature\.([a-z0-9_-]+)\.slim\.json$/i.exec(name);
      if (slimMatch?.[1]) {
        groups.add(slimMatch[1]);
        continue;
      }
      const baseMatch = /^vendor-pack\.feature\.([a-z0-9_-]+)\.json$/i.exec(name);
      if (baseMatch?.[1]) {
        groups.add(baseMatch[1]);
      }
    }
    return Array.from(groups).sort();
  };
  const featurePackFileNameToChunkGroup = /* @__PURE__ */ new Map();
  const loadFeaturePackIndex = () => {
    featurePackFileNameToChunkGroup.clear();
    const raw = featurePacksEnabled ? readJsonFile3(featurePackIndexPath()) : null;
    if (!raw || raw.depsHash !== depsHash || raw.version !== 1 || raw.outputVersion !== DEPS_OPTIMIZER_OUTPUT_VERSION) {
      return;
    }
    const mapping = raw.fileNameToChunkGroupId;
    if (!mapping || typeof mapping !== "object") return;
    let rawCount = 0;
    for (const [fileName, chunkGroupId] of Object.entries(mapping)) {
      if (typeof fileName !== "string" || typeof chunkGroupId !== "string") continue;
      if (!fileName.endsWith(".js")) continue;
      rawCount += 1;
      const shared = path7.join(depsRoot, `shared.${chunkGroupId}.js`);
      const wrapper = path7.join(depsRoot, fileName);
      if (!fs8.existsSync(shared) || !fs8.existsSync(wrapper)) continue;
      featurePackFileNameToChunkGroup.set(fileName, chunkGroupId);
    }
    if (rawCount > 0 && featurePackFileNameToChunkGroup.size !== rawCount) {
      writeFeaturePackIndex();
    }
  };
  const writeFeaturePackIndex = () => {
    const obj = {};
    const keys = Array.from(featurePackFileNameToChunkGroup.keys()).sort();
    for (const key of keys) {
      const value = featurePackFileNameToChunkGroup.get(key);
      if (value) obj[key] = value;
    }
    const payload = {
      version: 2,
      depsHash,
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      fileNameToChunkGroupId: obj
    };
    writeJsonFile3(featurePackIndexPath(), payload);
  };
  loadFeaturePackIndex();
  const ensureVendorPackV2Module = (options) => {
    return vendorPackV2.ensurePackModuleFromEntries(options);
  };
  const ensureVendorPackV2ModuleFromWrappers = (options) => {
    return vendorPackV2.ensurePackModuleFromWrappers(options);
  };
  const manualPacksEnabled = vendorPacksManual && depsSharedChunksEnabled && !!native?.optimizeDependenciesChunked && !depsSourcemapEnabled && depsBundleEsmEnabled;
  if (vendorPacksManual && !manualPacksEnabled) {
    const reasons = [];
    if (!depsSharedChunksEnabled) reasons.push("sharedChunks=0");
    if (depsSourcemapEnabled) reasons.push("sourcemap=1");
    if (!depsBundleEsmEnabled) reasons.push("bundleEsm=0");
    if (!native?.optimizeDependenciesChunked) reasons.push("nativeChunked=0");
    logWarn(
      `[deps] vendorPacks manual mode configured but pack modules are unavailable (${reasons.join(", ")}). Falling back to per-entry deps.`
    );
  }
  const manualObserved = /* @__PURE__ */ new Map();
  const manualState = /* @__PURE__ */ new Map();
  const manualSlimState = /* @__PURE__ */ new Map();
  for (const def of vendorPacksManualDefs) {
    manualObserved.set(def.group, /* @__PURE__ */ new Map());
  }
  const manualHasCore = manualObserved.has("core");
  const manualPackStatePathFor = (group) => path7.join(depsRoot, `vendor-pack.manual.${group}.json`);
  const manualPackSlimStatePathFor = (group) => path7.join(depsRoot, `vendor-pack.manual.${group}.slim.json`);
  const updateManualState = (group, next) => {
    const stamped = { ...next, outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION };
    manualState.set(group, stamped);
    writeJsonFile3(manualPackStatePathFor(group), stamped);
  };
  const updateManualSlimState = (group, next) => {
    const stamped = { ...next, outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION };
    manualSlimState.set(group, stamped);
    writeJsonFile3(manualPackSlimStatePathFor(group), stamped);
  };
  const pruneManualPackRoutes = (group) => {
    vendorPackV2.prunePackPrefix(`vendor-pack.manual.${group}.`);
  };
  const pruneFeaturePackRoutes = (group) => {
    vendorPackV2.prunePackPrefix(`vendor-pack.feature.${group}.`);
  };
  const planManualPackEntries = (group) => {
    const entries = reconcilePackEntries(Array.from(manualObserved.get(group)?.values() ?? []), canonicalFileNameForEntry);
    const selected = [];
    const seen = /* @__PURE__ */ new Set();
    let totalBytes = 0;
    for (const entry of entries) {
      if (selected.length >= vendorPackMaxMembers) break;
      if (seen.has(entry.fileName)) continue;
      if (!entry.entryPath || !fs8.existsSync(entry.entryPath)) continue;
      if (isCoreSingletonDepFileName(entry.fileName)) continue;
      if (manualHasCore && group !== "core" && vendorDepFileNames.has(entry.fileName)) continue;
      const sizeBytes = depsManifestIndex.get(entry.fileName)?.sizeBytes ?? 0;
      if (totalBytes + sizeBytes > vendorPackMaxBytes) continue;
      seen.add(entry.fileName);
      totalBytes += sizeBytes;
      selected.push(entry);
    }
    if (!hasPositivePackRequestSavings(selected.length)) {
      return [];
    }
    return selected;
  };
  if (manualPacksEnabled) {
    for (const def of vendorPacksManualDefs) {
      const group = def.group;
      const raw = readJsonFile3(manualPackStatePathFor(group));
      if (!raw || raw.depsHash !== depsHash || raw.version !== 1 || raw.outputVersion !== DEPS_OPTIMIZER_OUTPUT_VERSION || raw.group !== group) {
        continue;
      }
      if ((Array.isArray(raw.entries) ? raw.entries : []).some(
        (entry) => !entry?.fileName || !entry?.entryPath || isCoreSingletonDepFileName(entry.fileName) || canonicalFileNameForEntry(entry.fileName, entry.entryPath) !== entry.fileName
      )) {
        pruneManualPackRoutes(group);
        continue;
      }
      if (!hasPositivePackRequestSavings(Array.isArray(raw.entries) ? raw.entries.length : 0)) {
        pruneManualPackRoutes(group);
        continue;
      }
      manualState.set(group, raw);
      const groupMap = manualObserved.get(group);
      if (!groupMap) continue;
      for (const entry of Array.isArray(raw.entries) ? raw.entries : []) {
        if (!entry?.fileName || !entry?.entryPath) continue;
        groupMap.set(entry.fileName, entry);
      }
    }
  }
  if (manualPacksEnabled && packSlimmingEnabled) {
    for (const def of vendorPacksManualDefs) {
      const group = def.group;
      const raw = readJsonFile3(manualPackSlimStatePathFor(group));
      if (!raw || raw.depsHash !== depsHash || raw.version !== 1 || raw.outputVersion !== DEPS_OPTIMIZER_OUTPUT_VERSION || raw.group !== group) {
        continue;
      }
      if ((Array.isArray(raw.entries) ? raw.entries : []).some(
        (entry) => !entry?.baseFileName || !entry?.entryPath || isCoreSingletonDepFileName(entry.baseFileName) || canonicalFileNameForEntry(entry.baseFileName, entry.entryPath) !== entry.baseFileName
      )) {
        pruneManualPackRoutes(group);
        continue;
      }
      if (!hasPositivePackRequestSavings(Array.isArray(raw.entries) ? raw.entries.length : 0)) {
        pruneManualPackRoutes(group);
        continue;
      }
      manualSlimState.set(group, raw);
    }
  }
  if (manualPacksEnabled) {
    for (const def of vendorPacksManualDefs) {
      const group = def.group;
      const slim = packSlimmingEnabled ? manualSlimState.get(group) : null;
      if (slim && !hasPositivePackRequestSavings(Array.isArray(slim.entries) ? slim.entries.length : 0)) {
        pruneManualPackRoutes(group);
        continue;
      }
      if (slim && slim.status === "ready" && slim.chunkGroupId && slim.sharedFileName) {
        const ok = ensureVendorPackV2ModuleFromWrappers({
          label: `manual/${group}/slim`,
          packFileName: `vendor-pack.manual.${group}.${slim.chunkGroupId}.js`,
          sharedFileName: slim.sharedFileName,
          members: slim.entries.map((e) => ({
            baseFileName: e.baseFileName,
            wrapperFileName: e.wrapperFileName,
            packageLabel: e.packageLabel
          })),
          prunePackPrefix: `vendor-pack.manual.${group}.`
        });
        if (ok) continue;
      }
      const state = manualState.get(group);
      if (state && !hasPositivePackRequestSavings(Array.isArray(state.entries) ? state.entries.length : 0)) {
        pruneManualPackRoutes(group);
        continue;
      }
      if (!state || state.status !== "ready" || !state.chunkGroupId || !state.sharedFileName) continue;
      ensureVendorPackV2Module({
        label: `manual/${group}`,
        packFileName: `vendor-pack.manual.${group}.${state.chunkGroupId}.js`,
        sharedFileName: state.sharedFileName,
        entries: state.entries,
        prunePackPrefix: `vendor-pack.manual.${group}.`
      });
    }
  }
  const loadDepUsageIndexFromDisk = () => {
    const raw = readJsonFile3(depUsageStatePath()) ?? readJsonFile3(legacyDepUsageStatePath());
    if (!raw || raw.version !== 1 && raw.version !== 2 || raw.depsHash !== depsHash) return null;
    const out = /* @__PURE__ */ new Map();
    const deps = raw.deps && typeof raw.deps === "object" ? raw.deps : {};
    for (const [fileName, value] of Object.entries(deps)) {
      const item = value;
      if (!item || typeof item !== "object") continue;
      if (typeof item.entryPath !== "string" || typeof item.packageName !== "string") continue;
      if (typeof item.packageVersion !== "string" || !Array.isArray(item.usedExports)) continue;
      const usedExports = item.usedExports.map((v) => typeof v === "string" ? v : "").filter(Boolean).slice().sort();
      const unique = [];
      for (const name of usedExports) {
        if (unique.length === 0 || unique[unique.length - 1] !== name) unique.push(name);
      }
      out.set(fileName, {
        fileName,
        entryPath: item.entryPath,
        packageName: item.packageName,
        packageVersion: item.packageVersion,
        moduleFormat: item.moduleFormat === "esm" || item.moduleFormat === "cjs" ? item.moduleFormat : "unknown",
        usedExports: unique,
        hasNamespace: item.hasNamespace === true,
        hasExportStar: item.hasExportStar === true,
        importerKeys: Array.isArray(item.importerKeys) ? item.importerKeys.map((v) => typeof v === "string" ? v : "").filter(Boolean) : [],
        entryRootKeys: Array.isArray(item.entryRootKeys) ? item.entryRootKeys.map((v) => typeof v === "string" ? v : "").filter(Boolean) : []
      });
    }
    return out;
  };
  const saveDepUsageIndexToDisk = (index) => {
    const depsObj = {};
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
        entryRootKeys: Array.isArray(item.entryRootKeys) ? item.entryRootKeys.slice() : []
      };
    }
    writeJsonFile3(depUsageStatePath(), {
      version: 2,
      depsHash,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      deps: depsObj
    });
  };
  const computeUsageIndexHash = (index) => {
    const keys = Array.from(index.keys()).sort();
    let body = `deps-usage:v2:${depsHash}
`;
    for (const fileName of keys) {
      const item = index.get(fileName);
      if (!item) continue;
      const used = Array.isArray(item.usedExports) ? item.usedExports.slice().sort() : [];
      const importers = Array.isArray(item.importerKeys) ? item.importerKeys.slice().sort() : [];
      const entryRoots = Array.isArray(item.entryRootKeys) ? item.entryRootKeys.slice().sort() : [];
      body += `${fileName}|ns=${item.hasNamespace ? 1 : 0}|star=${item.hasExportStar ? 1 : 0}|used=${used.join(",")}|importers=${importers.join(",")}|entryRoots=${entryRoots.join(",")}
`;
    }
    return getCacheKey(body);
  };
  let depUsageIndex = packSlimmingEnabled ? loadDepUsageIndexFromDisk() : null;
  if (depUsageIndex) {
    depUsageIndex = canonicalizeDepUsageIndex(depUsageIndex, depsManifestCanonicalFileNames);
  }
  setDirectDepUsageFileNames(depUsageIndex);
  let depUsageScanRunning = false;
  const manualSlimBuildQueue = [];
  let manualSlimBuildRunning = false;
  const manualSlimBuildTimers = /* @__PURE__ */ new Map();
  const scheduleManualSlimBuild = (group) => {
    if (!manualPacksEnabled || !packSlimmingEnabled) return;
    const existing = manualSlimBuildTimers.get(group);
    if (existing) clearTimeout(existing);
    manualSlimBuildTimers.set(
      group,
      setTimeout(() => {
        manualSlimBuildTimers.delete(group);
        if (!manualSlimBuildQueue.includes(group)) manualSlimBuildQueue.push(group);
        if (manualSlimBuildRunning) return;
        manualSlimBuildRunning = true;
        void (async () => {
          try {
            while (manualSlimBuildQueue.length) {
              const next = manualSlimBuildQueue.shift();
              if (!next) continue;
              if (next === "core") continue;
              const baseState = manualState.get(next);
              if (!baseState || baseState.status !== "ready" || !baseState.sharedFileName || !baseState.chunkGroupId) {
                continue;
              }
              if (!depUsageIndex) continue;
              while (activeRequests > 0) {
                await new Promise((r) => setTimeout(r, 250));
              }
              const baseEntries = Array.isArray(baseState.entries) ? baseState.entries : [];
              if (baseEntries.length === 0) continue;
              const usedByBase = /* @__PURE__ */ new Map();
              for (const entry of baseEntries) {
                const u = depUsageIndex.get(entry.fileName);
                if (!u) continue;
                if (u.hasNamespace || u.hasExportStar) continue;
                if (!Array.isArray(u.usedExports) || u.usedExports.length === 0) continue;
                usedByBase.set(entry.fileName, u.usedExports.slice());
              }
              const hasAnyUsage = usedByBase.size > 0;
              if (!hasAnyUsage) continue;
              const existingSlim = manualSlimState.get(next);
              if (existingSlim && existingSlim.status === "ready" && existingSlim.depsHash === depsHash && existingSlim.group === next && existingSlim.chunkGroupId && existingSlim.sharedFileName && Array.isArray(existingSlim.entries) && existingSlim.entries.length > 0) {
                const sharedPath = path7.join(depsRoot, existingSlim.sharedFileName);
                const byBase = new Map(existingSlim.entries.map((e) => [e.baseFileName, e]));
                const baseSet = new Set(baseEntries.map((e) => e.fileName));
                const inputsMatch = fs8.existsSync(sharedPath) && existingSlim.entries.every((e) => baseSet.has(e.baseFileName)) && baseEntries.every((base) => {
                  const entry = byBase.get(base.fileName);
                  if (!entry) return false;
                  if (entry.entryPath !== base.entryPath) return false;
                  if (!fs8.existsSync(path7.join(depsRoot, entry.wrapperFileName))) return false;
                  const expected = (usedByBase.get(base.fileName) ?? []).slice().sort();
                  const actual = Array.isArray(entry.usedExports) ? entry.usedExports.slice().sort() : [];
                  if (expected.length !== actual.length) return false;
                  for (let i = 0; i < expected.length; i++) {
                    if (expected[i] !== actual[i]) return false;
                  }
                  return true;
                });
                if (inputsMatch) {
                  ensureVendorPackV2ModuleFromWrappers({
                    label: `manual/${next}/slim`,
                    packFileName: `vendor-pack.manual.${next}.${existingSlim.chunkGroupId}.js`,
                    sharedFileName: existingSlim.sharedFileName,
                    members: existingSlim.entries.map((e) => ({
                      baseFileName: e.baseFileName,
                      wrapperFileName: e.wrapperFileName,
                      packageLabel: e.packageLabel
                    })),
                    prunePackPrefix: `vendor-pack.manual.${next}.`
                  });
                  continue;
                }
              }
              updateManualSlimState(next, {
                version: 1,
                depsHash,
                group: next,
                updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
                status: "building",
                chunkGroupId: null,
                sharedFileName: null,
                entries: baseEntries.map((e) => ({
                  baseFileName: e.fileName,
                  wrapperFileName: e.fileName,
                  entryPath: e.entryPath,
                  packageLabel: e.packageLabel,
                  usedExports: usedByBase.get(e.fileName) ?? []
                }))
              });
              try {
                const chunked = native?.optimizeDependenciesChunked;
                if (!chunked) throw new Error("native.optimizeDependenciesChunked is not available");
                const start = Date.now();
                const result = chunked(
                  baseEntries.map((e) => {
                    const usedExports = usedByBase.get(e.fileName);
                    return usedExports && usedExports.length > 0 ? { entryPath: e.entryPath, depsHash, usedExports } : { entryPath: e.entryPath, depsHash };
                  }),
                  ionifyDir
                );
                const groupId = result?.chunk_group ?? result?.chunkGroup ?? null;
                if (!groupId || typeof groupId !== "string") throw new Error("Missing chunkGroupId");
                broadcastPeerDepWarnings(result?.peerDepWarnings ?? result?.peer_dep_warnings);
                const elapsed = Date.now() - start;
                const sharedFileName = `shared.${groupId}.js`;
                const sharedOut = path7.join(depsRoot, sharedFileName);
                if (!fs8.existsSync(sharedOut)) throw new Error("Slim shared chunk not found on disk");
                const resultsArr = Array.isArray(result?.entries) ? result.entries : [];
                const outByEntryPath = /* @__PURE__ */ new Map();
                for (const item of resultsArr) {
                  const entryPath = item?.entry_path ?? item?.entryPath ?? null;
                  const outPath = item?.out_path ?? item?.outPath ?? null;
                  if (typeof entryPath !== "string" || typeof outPath !== "string") continue;
                  const canonicalEntryPath = (() => {
                    try {
                      return fs8.realpathSync(entryPath);
                    } catch {
                      return entryPath;
                    }
                  })();
                  outByEntryPath.set(canonicalEntryPath, path7.basename(outPath));
                }
                const slimMembers = [];
                const slimEntries = [];
                for (const base of baseEntries) {
                  const canonicalBaseEntryPath = (() => {
                    try {
                      return fs8.realpathSync(base.entryPath);
                    } catch {
                      return base.entryPath;
                    }
                  })();
                  const wrapperFileName = outByEntryPath.get(canonicalBaseEntryPath) ?? base.fileName;
                  if (!fs8.existsSync(path7.join(depsRoot, wrapperFileName))) {
                    throw new Error(`Slim wrapper missing for ${base.packageLabel}: ${wrapperFileName}`);
                  }
                  slimMembers.push({
                    baseFileName: base.fileName,
                    wrapperFileName,
                    packageLabel: base.packageLabel
                  });
                  slimEntries.push({
                    baseFileName: base.fileName,
                    wrapperFileName,
                    entryPath: base.entryPath,
                    packageLabel: base.packageLabel,
                    usedExports: usedByBase.get(base.fileName) ?? []
                  });
                }
                ensureVendorPackV2ModuleFromWrappers({
                  label: `manual/${next}/slim`,
                  packFileName: `vendor-pack.manual.${next}.${groupId}.js`,
                  sharedFileName,
                  members: slimMembers,
                  prunePackPrefix: `vendor-pack.manual.${next}.`
                });
                refreshDepsManifestIndex();
                updateManualSlimState(next, {
                  version: 1,
                  depsHash,
                  group: next,
                  updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
                  status: "ready",
                  chunkGroupId: groupId,
                  sharedFileName,
                  entries: slimEntries
                });
                const fullSharedPath = path7.join(depsRoot, baseState.sharedFileName);
                const fullBytes = fs8.existsSync(fullSharedPath) ? fs8.statSync(fullSharedPath).size : 0;
                const slimBytes = fs8.existsSync(sharedOut) ? fs8.statSync(sharedOut).size : 0;
                const saved = fullBytes > 0 && slimBytes > 0 ? fullBytes - slimBytes : 0;
                const savedLabel = saved > 0 ? ` (-${formatByteDelta(saved)})` : "";
                if (process.env.DEBUG_DEPS) {
                  logInfo(
                    `[deps] \u2713 Manual pack slimmed (${next}) group=${groupId} members=${baseEntries.length} (${elapsed}ms)${savedLabel}.`
                  );
                }
                logInfo(`Slim pack ready: ${next}${savedLabel}`);
              } catch (err) {
                updateManualSlimState(next, {
                  version: 1,
                  depsHash,
                  group: next,
                  updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
                  status: "failed",
                  chunkGroupId: null,
                  sharedFileName: null,
                  entries: manualSlimState.get(next)?.entries ?? [],
                  error: String(err)
                });
                logWarn(`[deps] WARN: Manual pack slimming failed (${next}): ${String(err)}`);
              }
            }
          } finally {
            manualSlimBuildRunning = false;
          }
        })();
      }, 800)
    );
  };
  const manualBuildQueue = [];
  let manualBuildRunning = false;
  const manualBuildTimers = /* @__PURE__ */ new Map();
  const enqueueManualBuild = (group) => {
    if (!manualPacksEnabled) return;
    if (!manualObserved.has(group)) return;
    if (!manualBuildQueue.includes(group)) {
      manualBuildQueue.push(group);
    }
    if (manualBuildRunning) return;
    manualBuildRunning = true;
    void (async () => {
      try {
        while (manualBuildQueue.length) {
          const next = manualBuildQueue.shift();
          if (!next) continue;
          while (activeRequests > 0) {
            await new Promise((r) => setTimeout(r, 250));
          }
          const entries = planManualPackEntries(next);
          if (entries.length === 0) continue;
          const chunkGroupId = computeChunkGroupIdFromStableIds(entries.map((e) => e.fileName));
          const sharedFileName = `shared.${chunkGroupId}.js`;
          const sharedPath = path7.join(depsRoot, sharedFileName);
          const alreadyReady = fs8.existsSync(sharedPath) && entries.every((e) => fs8.existsSync(path7.join(depsRoot, e.fileName)));
          if (alreadyReady) {
            updateManualState(next, {
              version: 1,
              depsHash,
              group: next,
              updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
              status: "ready",
              chunkGroupId,
              sharedFileName,
              entries
            });
            ensureVendorPackV2Module({
              label: `manual/${next}`,
              packFileName: `vendor-pack.manual.${next}.${chunkGroupId}.js`,
              sharedFileName,
              entries,
              prunePackPrefix: `vendor-pack.manual.${next}.`
            });
            if (packSlimmingEnabled) scheduleManualSlimBuild(next);
            continue;
          }
          updateManualState(next, {
            version: 1,
            depsHash,
            group: next,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
            status: "building",
            chunkGroupId,
            sharedFileName,
            entries
          });
          try {
            const chunked = native?.optimizeDependenciesChunked;
            if (!chunked) throw new Error("native.optimizeDependenciesChunked is not available");
            const start = Date.now();
            const result = chunked(entries.map((e) => ({ entryPath: e.entryPath, depsHash })), ionifyDir);
            const groupId = result?.chunk_group ?? result?.chunkGroup ?? chunkGroupId;
            const resolvedEntries2 = resolveChunkedPackEntries(
              entries,
              Array.isArray(result?.entries) ? result.entries.map((item) => ({
                entryPath: item?.entry_path ?? item?.entryPath ?? null,
                outPath: item?.out_path ?? item?.outPath ?? null
              })) : []
            );
            broadcastPeerDepWarnings(result?.peerDepWarnings ?? result?.peer_dep_warnings);
            const elapsed = Date.now() - start;
            const sharedOut = path7.join(depsRoot, `shared.${groupId}.js`);
            const ok = fs8.existsSync(sharedOut) && resolvedEntries2.every((entry) => fs8.existsSync(path7.join(depsRoot, entry.fileName)));
            if (!ok) {
              throw new Error("Manual pack optimizer did not produce expected outputs");
            }
            refreshDepsManifestIndex();
            updateManualState(next, {
              version: 1,
              depsHash,
              group: next,
              updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
              status: "ready",
              chunkGroupId: groupId,
              sharedFileName: `shared.${groupId}.js`,
              entries: resolvedEntries2
            });
            ensureVendorPackV2Module({
              label: `manual/${next}`,
              packFileName: `vendor-pack.manual.${next}.${groupId}.js`,
              sharedFileName: `shared.${groupId}.js`,
              entries: resolvedEntries2,
              prunePackPrefix: `vendor-pack.manual.${next}.`
            });
            logInfo(
              `[deps] \u2713 Manual pack ready (${next}) group=${groupId} members=${entries.length} (${elapsed}ms). Reload to apply.`
            );
            if (packSlimmingEnabled) scheduleManualSlimBuild(next);
          } catch (err) {
            updateManualState(next, {
              version: 1,
              depsHash,
              group: next,
              updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
              status: "failed",
              chunkGroupId,
              sharedFileName,
              entries,
              error: String(err)
            });
            logWarn(`[deps] WARN: Manual pack build failed (${next}): ${String(err)}`);
          }
        }
      } finally {
        manualBuildRunning = false;
      }
    })();
  };
  const scheduleManualBuild = (group) => {
    if (!manualPacksEnabled) return;
    const existing = manualBuildTimers.get(group);
    if (existing) clearTimeout(existing);
    manualBuildTimers.set(
      group,
      setTimeout(() => {
        manualBuildTimers.delete(group);
        enqueueManualBuild(group);
      }, 600)
    );
  };
  const recordManualCandidate = (entry) => {
    if (!manualPacksEnabled) return;
    if (!entry.fileName || !entry.entryPath) return;
    if (!fs8.existsSync(entry.entryPath)) return;
    if (isCoreSingletonDepFileName(entry.fileName)) return;
    const fileName = canonicalFileNameForEntry(entry.fileName, entry.entryPath);
    const group = classifyManualPackGroup(entry.packageName, entry.subpath);
    if (!group) return;
    const groupMap = manualObserved.get(group);
    if (!groupMap) return;
    const wasNew = upsertObservedPackEntry(groupMap, {
      entryPath: entry.entryPath,
      fileName,
      packageLabel: entry.packageLabel
    });
    const state = manualState.get(group);
    const alreadyInState = !!state && Array.isArray(state.entries) && state.entries.some((e) => e.fileName === fileName);
    const shouldRebuild = !state || state.status !== "ready" || !alreadyInState;
    if (wasNew || shouldRebuild) {
      updateManualState(group, {
        version: 1,
        depsHash,
        group,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        status: "planned",
        chunkGroupId: null,
        sharedFileName: null,
        entries: planManualPackEntries(group)
      });
      if (packSlimmingEnabled) {
        const plannedEntries = planManualPackEntries(group);
        updateManualSlimState(group, {
          version: 1,
          depsHash,
          group,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
          status: "planned",
          chunkGroupId: null,
          sharedFileName: null,
          entries: plannedEntries.map((e) => ({
            baseFileName: e.fileName,
            wrapperFileName: e.fileName,
            entryPath: e.entryPath,
            packageLabel: e.packageLabel,
            usedExports: []
          }))
        });
      }
      scheduleManualBuild(group);
    }
  };
  const featureObserved = /* @__PURE__ */ new Map();
  const featureState = /* @__PURE__ */ new Map();
  const featureLastReadyState = /* @__PURE__ */ new Map();
  const featureSlimState = /* @__PURE__ */ new Map();
  const featureLastReadySlimState = /* @__PURE__ */ new Map();
  let featurePackActivationPending = false;
  const listFeaturePackGroups = () => {
    const groups = /* @__PURE__ */ new Set();
    for (const map of [featureState, featureLastReadyState, featureSlimState, featureLastReadySlimState]) {
      for (const group of map.keys()) groups.add(group);
    }
    return Array.from(groups).sort();
  };
  const featureStateFilesFor = (group) => [
    featurePackStatePathFor(group),
    featurePackSlimStatePathFor(group)
  ];
  const removeFeatureGroupState = (group) => {
    featureState.delete(group);
    featureLastReadyState.delete(group);
    featureSlimState.delete(group);
    featureLastReadySlimState.delete(group);
    pruneFeaturePackRoutes(group);
    for (const filePath of featureStateFilesFor(group)) {
      try {
        fs8.unlinkSync(filePath);
      } catch {
      }
    }
  };
  if (featurePacksEnabled) {
    for (const group of discoverFeaturePackGroupsFromDisk()) {
      const raw = readJsonFile3(featurePackStatePathFor(group));
      if (!raw || raw.depsHash !== depsHash || raw.version !== 1 || raw.outputVersion !== DEPS_OPTIMIZER_OUTPUT_VERSION || raw.group !== group) {
        continue;
      }
      if ((Array.isArray(raw.entries) ? raw.entries : []).some(
        (entry) => !entry?.fileName || !entry?.entryPath || canonicalFileNameForEntry(entry.fileName, entry.entryPath) !== entry.fileName
      )) {
        pruneFeaturePackRoutes(group);
        continue;
      }
      if (!hasPositivePackRequestSavings(Array.isArray(raw.entries) ? raw.entries.length : 0)) {
        pruneFeaturePackRoutes(group);
        continue;
      }
      featureState.set(group, raw);
      if (raw.status === "ready" && raw.chunkGroupId && raw.sharedFileName) {
        featureLastReadyState.set(group, raw);
      }
      for (const entry of Array.isArray(raw.entries) ? raw.entries : []) {
        if (!entry?.fileName || !entry?.entryPath) continue;
        upsertObservedPackEntry(featureObserved, {
          entryPath: entry.entryPath,
          fileName: entry.fileName,
          packageLabel: entry.packageLabel,
          packageName: entry?.packageName ?? null
        });
      }
    }
  }
  if (featurePacksEnabled && packSlimmingEnabled) {
    for (const group of discoverFeaturePackGroupsFromDisk()) {
      const raw = readJsonFile3(featurePackSlimStatePathFor(group));
      if (!raw || raw.depsHash !== depsHash || raw.version !== 1 || raw.outputVersion !== DEPS_OPTIMIZER_OUTPUT_VERSION || raw.group !== group) {
        continue;
      }
      if ((Array.isArray(raw.entries) ? raw.entries : []).some(
        (entry) => !entry?.baseFileName || !entry?.entryPath || canonicalFileNameForEntry(entry.baseFileName, entry.entryPath) !== entry.baseFileName
      )) {
        pruneFeaturePackRoutes(group);
        continue;
      }
      if (!hasPositivePackRequestSavings(Array.isArray(raw.entries) ? raw.entries.length : 0)) {
        pruneFeaturePackRoutes(group);
        continue;
      }
      featureSlimState.set(group, raw);
      if (raw.status === "ready" && raw.chunkGroupId && raw.sharedFileName) {
        featureLastReadySlimState.set(group, raw);
      }
    }
  }
  const syncFeaturePackRoutingIndexFromState = (states) => {
    featurePackFileNameToChunkGroup.clear();
    const nextRouting = deriveFeaturePackRoutingMap(states);
    for (const [fileName, chunkGroupId] of nextRouting) {
      featurePackFileNameToChunkGroup.set(fileName, chunkGroupId);
    }
    writeFeaturePackIndex();
  };
  const isActivatableFeatureSlimState = (baseState, slimState) => {
    if (!baseState || baseState.status !== "ready" || !baseState.chunkGroupId || !baseState.sharedFileName || !slimState || slimState.status !== "ready" || !slimState.chunkGroupId || !slimState.sharedFileName) {
      return false;
    }
    if (!hasPositivePackRequestSavings(Array.isArray(slimState.entries) ? slimState.entries.length : 0)) {
      return false;
    }
    return isFeaturePackSlimAligned(baseState.entries, slimState.entries);
  };
  const activateFeaturePackRoutes = () => {
    vendorPackV2.prunePackPrefix("vendor-pack.feature.");
    const activeBaseStates = [];
    for (const group of listFeaturePackGroups()) {
      const baseState = featureLastReadyState.get(group);
      if (!baseState || baseState.status !== "ready" || !baseState.chunkGroupId || !baseState.sharedFileName || !hasPositivePackRequestSavings(Array.isArray(baseState.entries) ? baseState.entries.length : 0)) {
        continue;
      }
      activeBaseStates.push(baseState);
      const slimState = packSlimmingEnabled ? featureLastReadySlimState.get(group) : null;
      if (isActivatableFeatureSlimState(baseState, slimState)) {
        ensureVendorPackV2ModuleFromWrappers({
          label: `feature/${group}/slim`,
          packFileName: `vendor-pack.feature.${group}.${slimState.chunkGroupId}.js`,
          sharedFileName: slimState.sharedFileName,
          members: slimState.entries.map((entry) => ({
            baseFileName: entry.baseFileName,
            wrapperFileName: entry.wrapperFileName,
            packageLabel: entry.packageLabel
          }))
        });
        continue;
      }
      ensureVendorPackV2Module({
        label: `feature/${group}`,
        packFileName: `vendor-pack.feature.${group}.${baseState.chunkGroupId}.js`,
        sharedFileName: baseState.sharedFileName,
        entries: baseState.entries
      });
    }
    syncFeaturePackRoutingIndexFromState(activeBaseStates);
    featurePackActivationPending = false;
  };
  const activateFeaturePacksOnNextDocument = () => {
    if (!featurePacksEnabled || !featurePackActivationPending) return;
    activateFeaturePackRoutes();
  };
  if (featurePacksEnabled) {
    activateFeaturePackRoutes();
  }
  const updateFeatureState = (group, next) => {
    const stamped = { ...next, outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION };
    featureState.set(group, stamped);
    if (stamped.status === "ready" && stamped.chunkGroupId && stamped.sharedFileName) {
      featureLastReadyState.set(group, stamped);
      featurePackActivationPending = true;
    }
    writeJsonFile3(featurePackStatePathFor(group), stamped);
  };
  const updateFeatureSlimState = (group, next) => {
    const stamped = { ...next, outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION };
    featureSlimState.set(group, stamped);
    if (stamped.status === "ready" && stamped.chunkGroupId && stamped.sharedFileName) {
      featureLastReadySlimState.set(group, stamped);
      featurePackActivationPending = true;
    }
    writeJsonFile3(featurePackSlimStatePathFor(group), stamped);
  };
  const featureEntriesSignature = (entries) => entries.map((entry) => entry.fileName).filter(Boolean).slice().sort().join("|");
  const featurePackSourceExts = /* @__PURE__ */ new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);
  const plannedFeatureGroups = /* @__PURE__ */ new Map();
  const featurePlanReportPath = () => path7.join(depsRoot, "vendor-pack.feature.plan-report.json");
  const computeFeatureCandidates = () => {
    const entries = reconcilePackEntries(Array.from(featureObserved.values()), canonicalFileNameForEntry);
    const candidates = [];
    const depRouteHints = new Map(
      routeHints.summarizeAssets("dep").flatMap((summary) => {
        const fileName = depsFileNameFromRuntimeUrl(summary.url);
        return fileName ? [[fileName, summary]] : [];
      })
    );
    for (const entry of entries) {
      if (!entry.entryPath || !fs8.existsSync(entry.entryPath)) continue;
      if (!featurePackSourceExts.has(path7.extname(entry.entryPath).toLowerCase())) continue;
      if (vendorDepFileNames.has(entry.fileName) || isCoreSingletonDepFileName(entry.fileName)) continue;
      const manifestEntry = depsManifestIndex.get(entry.fileName);
      const requestCount = getKnownDepRequestCount(entry.fileName);
      const sizeBytes = manifestEntry?.sizeBytes ?? 0;
      const moduleCount = manifestEntry?.moduleCount ?? 0;
      const edgeCount = manifestEntry?.edgeCount ?? 0;
      const externalCount = manifestEntry?.externalCount ?? 0;
      const sizeKb = Math.max(sizeBytes / 1024, 1);
      const routeHint = depRouteHints.get(entry.fileName) ?? null;
      const routeKeys = Array.isArray(routeHint?.routeKeys) ? routeHint.routeKeys.slice() : [];
      const routeRequestCounts = routeHint && routeHint.routeRequestCounts && typeof routeHint.routeRequestCounts === "object" ? { ...routeHint.routeRequestCounts } : {};
      const routeCount = routeKeys.length;
      const score = 12 * Math.min(Math.max(requestCount, 1), 6) + 8 * Math.min(externalCount, 10) + 4 * Math.min(moduleCount / 40, 6) + 2 * Math.min(edgeCount / 80, 6) + 4 * Math.log2(sizeKb) - Math.max(0, routeCount - 1) * 5;
      const usage = depUsageIndex?.get(entry.fileName);
      candidates.push({
        ...entry,
        score,
        sizeBytes,
        importerKeys: Array.isArray(usage?.importerKeys) ? usage.importerKeys.slice() : [],
        entryRootKeys: Array.isArray(usage?.entryRootKeys) ? usage.entryRootKeys.slice() : [],
        routeKeys,
        routeRequestCounts
      });
    }
    return candidates;
  };
  const computeFeatureAutoMaxGroups = (candidateCount) => {
    if (candidateCount <= 0) return 1;
    const targetMembersPerGroup = Math.max(12, Math.min(vendorPackMaxMembers, 18));
    return Math.max(4, Math.min(8, Math.ceil(candidateCount / targetMembersPerGroup)));
  };
  const assignFeaturePlanGroup = (usedGroups, plan) => {
    if (plan.group) {
      usedGroups.add(plan.group);
      return plan.group;
    }
    const candidates = [
      `auto-${getCacheKey(`feature-plan:${plan.familyKey}:${plan.seedFileName}`).slice(0, 8)}`,
      `auto-${getCacheKey(`feature-plan:${featureEntriesSignature(plan.entries)}`).slice(0, 8)}`
    ];
    for (const candidate of candidates) {
      if (!usedGroups.has(candidate)) {
        usedGroups.add(candidate);
        return candidate;
      }
    }
    let index = 1;
    while (usedGroups.has(`auto-${index}`)) index += 1;
    const fallback = `auto-${index}`;
    usedGroups.add(fallback);
    return fallback;
  };
  const computePlannedFeatureGroups = () => {
    const candidates = computeFeatureCandidates();
    const candidatesByFileName = new Map(candidates.map((candidate) => [candidate.fileName, candidate]));
    const normalizeSourceHintKey = (hintUrl) => {
      const queryIndex = hintUrl.indexOf("?");
      const pathname = queryIndex === -1 ? hintUrl : hintUrl.slice(0, queryIndex);
      return pathname.replace(/^\/+/, "");
    };
    const sourceRouteHints = new Map(
      routeHints.summarizeAssets("source").filter((summary) => summary.url.startsWith("/")).map((summary) => [normalizeSourceHintKey(summary.url), summary])
    );
    const pressureCandidatesByFileName = new Map(
      candidates.map((candidate) => {
        const routeRequestCounts = { ...candidate.routeRequestCounts };
        for (const importerKey of candidate.importerKeys) {
          const sourceHint = sourceRouteHints.get(importerKey);
          if (!sourceHint) continue;
          for (const [routeKey, requestCount] of Object.entries(sourceHint.routeRequestCounts)) {
            if (!routeKey || !Number.isFinite(requestCount) || requestCount <= 0) continue;
            routeRequestCounts[routeKey] = Math.max(routeRequestCounts[routeKey] ?? 0, requestCount);
          }
        }
        return [
          candidate.fileName,
          {
            ...candidate,
            routeKeys: Object.keys(routeRequestCounts).sort(),
            routeRequestCounts
          }
        ];
      })
    );
    const usedGroups = new Set(listFeaturePackGroups());
    const coupledGroups = extractDepCouplingGroups(
      candidates.map((c) => ({ fileName: c.fileName, entryPath: c.entryPath }))
    );
    const readyGroupsForPlan = Array.from(featureLastReadyState.entries()).map(([group, state]) => ({
      group,
      entries: Array.isArray(state.entries) ? state.entries : []
    }));
    const plans = planAutoFeaturePackGroups({
      candidates,
      currentReadyGroups: readyGroupsForPlan,
      maxMembers: vendorPackMaxMembers,
      maxBytes: vendorPackMaxBytes,
      minMembers: minimumRequestPositivePackMembers,
      maxGroups: computeFeatureAutoMaxGroups(candidates.length),
      coupledGroups
    });
    const next = /* @__PURE__ */ new Map();
    for (const plan of plans) {
      const group = assignFeaturePlanGroup(usedGroups, plan);
      next.set(group, plan.entries.map((entry) => ({ ...entry })));
    }
    writeJsonFile3(featurePlanReportPath(), {
      version: 2,
      depsHash,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      candidates: candidates.slice().sort((a, b) => b.score - a.score || a.fileName.localeCompare(b.fileName)).map((candidate) => ({
        fileName: candidate.fileName,
        packageLabel: candidate.packageLabel,
        score: candidate.score,
        sizeBytes: candidate.sizeBytes,
        importerKeys: candidate.importerKeys,
        entryRootKeys: candidate.entryRootKeys,
        routeKeys: candidate.routeKeys,
        routeRequestCounts: candidate.routeRequestCounts,
        pressureRouteKeys: pressureCandidatesByFileName.get(candidate.fileName)?.routeKeys ?? [],
        pressureRouteRequestCounts: pressureCandidatesByFileName.get(candidate.fileName)?.routeRequestCounts ?? {}
      })),
      plans: Array.from(next.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([group, entries]) => ({
        currentActiveSharedArtifact: (() => {
          const baseState = featureLastReadyState.get(group);
          const slimState = packSlimmingEnabled ? featureLastReadySlimState.get(group) : null;
          const activeState = isActivatableFeatureSlimState(baseState, slimState) ? slimState : baseState;
          if (!activeState?.sharedFileName) return null;
          const sharedPath = path7.join(depsRoot, activeState.sharedFileName);
          const sharedBytes = fs8.existsSync(sharedPath) ? fs8.statSync(sharedPath).size : null;
          return {
            mode: activeState === slimState ? "slim" : "base",
            sharedFileName: activeState.sharedFileName,
            sharedBytes
          };
        })(),
        group,
        totalBytes: entries.reduce((sum, entry) => sum + (depsManifestIndex.get(entry.fileName)?.sizeBytes ?? 0), 0),
        sharedClosurePressure: (() => {
          const baseState = featureLastReadyState.get(group);
          const slimState = packSlimmingEnabled ? featureLastReadySlimState.get(group) : null;
          const activeState = isActivatableFeatureSlimState(baseState, slimState) ? slimState : baseState;
          const activeSharedBytes = activeState?.sharedFileName && fs8.existsSync(path7.join(depsRoot, activeState.sharedFileName)) ? fs8.statSync(path7.join(depsRoot, activeState.sharedFileName)).size : null;
          return analyzeFeaturePackSharedClosurePressure({
            entries,
            candidatesByFileName: pressureCandidatesByFileName,
            activeSharedBytes
          });
        })(),
        members: entries.map((entry) => ({
          fileName: entry.fileName,
          packageLabel: entry.packageLabel,
          routeKeys: candidates.find((candidate) => candidate.fileName === entry.fileName)?.routeKeys ?? []
        }))
      }))
    });
    return next;
  };
  const replanFeaturePacks = () => {
    if (!featurePacksEnabled) return;
    const nextPlans = computePlannedFeatureGroups();
    plannedFeatureGroups.clear();
    for (const [group, entries] of nextPlans) {
      plannedFeatureGroups.set(group, featureEntriesSignature(entries));
    }
    for (const group of listFeaturePackGroups()) {
      if (nextPlans.has(group)) continue;
      if (featureLastReadyState.has(group) || featureLastReadySlimState.has(group)) {
        removeFeatureGroupState(group);
        featurePackActivationPending = true;
        continue;
      }
      removeFeatureGroupState(group);
    }
    for (const [group, entries] of nextPlans) {
      const plannedSignature = featureEntriesSignature(entries);
      const currentState = featureState.get(group);
      const currentSignature = currentState ? featureEntriesSignature(currentState.entries) : "";
      const hasRoutedMembers = featureLastReadyState.get(group)?.status === "ready" && entries.every((entry) => featurePackFileNameToChunkGroup.get(entry.fileName));
      if (currentState?.status === "ready" && currentSignature === plannedSignature && hasRoutedMembers) {
        continue;
      }
      updateFeatureState(group, {
        version: 1,
        depsHash,
        group,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        status: "planned",
        chunkGroupId: null,
        sharedFileName: null,
        entries
      });
      if (packSlimmingEnabled) {
        updateFeatureSlimState(group, {
          version: 1,
          depsHash,
          group,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
          status: "planned",
          chunkGroupId: null,
          sharedFileName: null,
          entries: entries.map((entry) => ({
            baseFileName: entry.fileName,
            wrapperFileName: entry.fileName,
            entryPath: entry.entryPath,
            packageLabel: entry.packageLabel,
            usedExports: []
          }))
        });
      }
      scheduleFeatureBuild(group);
    }
  };
  const featureBuildQueue = [];
  let featureBuildRunning = false;
  const featureBuildTimers = /* @__PURE__ */ new Map();
  let activeRequests = 0;
  const papConfigRaw = userConfig?.productionArtifactPublishing ?? "auto";
  const papEnvRaw = process.env.IONIFY_PRODUCTION_PUBLISHING ?? process.env.IONIFY_PAP ?? process.env.IONIFY_PRODUCTION_PUBLICATION;
  const papEnvNormalized = typeof papEnvRaw === "string" ? papEnvRaw.trim().toLowerCase() : "";
  const papDisabledByEnv = papEnvNormalized === "0" || papEnvNormalized === "false" || papEnvNormalized === "off";
  const papEnabledByEnv = papEnvNormalized === "1" || papEnvNormalized === "true" || papEnvNormalized === "on" || papEnvNormalized === "auto" || papEnvNormalized === "contracts" || papEnvNormalized === "artifacts";
  const papEnabled = papConfigRaw !== false && !papDisabledByEnv && (papEnabledByEnv || process.env.VITEST !== "true");
  const papIdleDelayMsRaw = papConfigRaw && typeof papConfigRaw === "object" && typeof papConfigRaw.idleDelayMs === "number" ? papConfigRaw.idleDelayMs : Number(process.env.IONIFY_PAP_IDLE_MS ?? 2500);
  const papIdleDelayMs = Number.isFinite(papIdleDelayMsRaw) ? Math.max(500, Math.min(6e4, Math.floor(papIdleDelayMsRaw))) : 2500;
  const papPhaseRaw = typeof papConfigRaw === "string" ? papConfigRaw : papConfigRaw && typeof papConfigRaw === "object" && typeof papConfigRaw.level === "string" ? papConfigRaw.level : papConfigRaw && typeof papConfigRaw === "object" && typeof papConfigRaw.phase === "string" ? papConfigRaw.phase : process.env.IONIFY_PRODUCTION_PUBLISHING_LEVEL ?? process.env.IONIFY_PAP_PHASE ?? papEnvRaw;
  const papLevelRaw = String(papPhaseRaw ?? "auto").trim().toLowerCase();
  const papTargetLevel = papLevelRaw === "contracts" || papLevelRaw === "contract" || papLevelRaw === "a" || papLevelRaw === "production_contracts" ? "contracts" : "artifacts";
  const papArtifactsEnabled = papTargetLevel === "artifacts";
  const papArtifactsIdleDelayMsRaw = papConfigRaw && typeof papConfigRaw === "object" && typeof papConfigRaw.artifactsIdleDelayMs === "number" ? papConfigRaw.artifactsIdleDelayMs : papConfigRaw && typeof papConfigRaw === "object" && typeof papConfigRaw.deepIdleDelayMs === "number" ? papConfigRaw.deepIdleDelayMs : Number(process.env.IONIFY_PRODUCTION_PUBLISHING_ARTIFACTS_IDLE_MS ?? process.env.IONIFY_PAP_ARTIFACTS_IDLE_MS ?? papIdleDelayMs * 4);
  const papArtifactsIdleDelayMs = Number.isFinite(papArtifactsIdleDelayMsRaw) ? Math.max(papIdleDelayMs + 500, Math.min(12e4, Math.floor(papArtifactsIdleDelayMsRaw))) : Math.max(1e4, papIdleDelayMs * 4);
  const papCpuLoadFactorRaw = papConfigRaw && typeof papConfigRaw === "object" && typeof papConfigRaw.cpuLoadFactor === "number" ? papConfigRaw.cpuLoadFactor : Number(process.env.IONIFY_PRODUCTION_PUBLISHING_CPU_LOAD_FACTOR ?? 1.5);
  const papCpuLoadFactor = Number.isFinite(papCpuLoadFactorRaw) && papCpuLoadFactorRaw > 0 ? papCpuLoadFactorRaw : 1.5;
  const papBuildMode = resolveDevProductionPublishingBuildMode(papConfigRaw, process.env);
  let papTimer = null;
  let papRunning = false;
  let papRunningLevel = null;
  let papChild = null;
  let papContractsPublished = false;
  let papArtifactsPublished = false;
  let papDirty = false;
  let dependencyEnvironmentReconciling = false;
  const isProductionPublishingCpuPressured = () => {
    const parallelism = Math.max(1, typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length || 1);
    return os.loadavg()[0] > parallelism * papCpuLoadFactor;
  };
  const cancelProductionArtifactsPublication = (reason) => {
    if (papRunningLevel !== "artifacts" || !papChild || papChild.killed) return;
    papDirty = true;
    papArtifactsPublished = false;
    logInfo(`[publish] Canceling Production Artifacts publication (${reason})`);
    try {
      papChild.kill("SIGTERM");
    } catch {
    }
  };
  const scheduleProductionArtifactPublication = (reason, level = "contracts") => {
    if (!papEnabled || shuttingDown || dependencyEnvironmentReconciling) return;
    if (level === "artifacts" && !papArtifactsEnabled) return;
    if (level === "contracts" && papContractsPublished && !papDirty) {
      if (papArtifactsEnabled && !papArtifactsPublished) {
        scheduleProductionArtifactPublication("contracts-ready", "artifacts");
      }
      return;
    }
    if (level === "artifacts" && papArtifactsPublished && !papDirty) return;
    if (papTimer) clearTimeout(papTimer);
    const delayMs = level === "artifacts" ? papArtifactsIdleDelayMs : papIdleDelayMs;
    papTimer = setTimeout(() => {
      papTimer = null;
      if (shuttingDown) return;
      if (papRunning) {
        papDirty = true;
        return;
      }
      if (level === "artifacts") {
        if (activeRequests > 0 || isProductionPublishingCpuPressured()) {
          scheduleProductionArtifactPublication(activeRequests > 0 ? "active-requests" : "cpu-pressure", "artifacts");
          return;
        }
      }
      papRunning = true;
      papRunningLevel = level;
      void (async () => {
        let nextLevel = null;
        try {
          while (activeRequests > 0 && !shuttingDown) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          if (shuttingDown) return;
          const cliEntry = process.argv[1];
          if (!cliEntry || !fs8.existsSync(cliEntry)) {
            logWarn("[publish] Production publication skipped: CLI entry is not available for child handoff.");
            return;
          }
          if (level === "artifacts" && isProductionPublishingCpuPressured()) {
            scheduleProductionArtifactPublication("cpu-pressure", "artifacts");
            return;
          }
          logInfo(`[publish] Scheduling Production Publishing (${level}, ${reason})`);
          const child = spawn(
            process.execPath,
            [cliEntry, "publish", `--${level}`, "--mode", papBuildMode],
            {
              cwd: rootDir,
              env: {
                ...process.env,
                NODE_ENV: "production",
                MODE: papBuildMode,
                IONIFY_MODE: papBuildMode
              },
              stdio: ["ignore", "ignore", "pipe"]
            }
          );
          papChild = child;
          let stderr = "";
          child.stderr?.on("data", (chunk) => {
            stderr += String(chunk);
            if (stderr.length > 4096) stderr = stderr.slice(-4096);
          });
          const exitCode = await new Promise((resolve) => {
            child.on("error", () => resolve(-1));
            child.on("exit", (code) => resolve(code));
          });
          if (exitCode === 0) {
            if (!papDirty) {
              if (level === "contracts") {
                papContractsPublished = true;
                papArtifactsPublished = false;
                nextLevel = papArtifactsEnabled ? "artifacts" : null;
              } else {
                papArtifactsPublished = true;
              }
              logInfo(`[publish] Production Publishing complete (${level})`);
            }
          } else {
            const suffix = stderr.trim() ? `: ${stderr.trim().split(/\r?\n/).slice(-2).join(" | ")}` : "";
            logWarn(`[publish] WARN: Production publication failed (exit=${exitCode})${suffix}`);
          }
        } finally {
          papChild = null;
          papRunning = false;
          papRunningLevel = null;
          if (papDirty && !shuttingDown) {
            papDirty = false;
            scheduleProductionArtifactPublication("dirty-after-run", "contracts");
          } else if (nextLevel && !shuttingDown) {
            scheduleProductionArtifactPublication(`${level}-complete`, nextLevel);
          }
        }
      })();
    }, delayMs);
    if (papTimer.unref) papTimer.unref();
  };
  const formatByteDelta = (bytes) => {
    const value = Math.max(0, Math.floor(bytes));
    if (value < 1024) return `${value}B`;
    const kb = value / 1024;
    if (kb < 1024) return `${Math.round(kb)}KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)}MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)}GB`;
  };
  const featureSlimBuildQueue = [];
  let featureSlimBuildRunning = false;
  const featureSlimBuildTimers = /* @__PURE__ */ new Map();
  const scheduleFeatureSlimBuild = (group) => {
    if (!featurePacksEnabled || !packSlimmingEnabled) return;
    const existing = featureSlimBuildTimers.get(group);
    if (existing) clearTimeout(existing);
    featureSlimBuildTimers.set(
      group,
      setTimeout(() => {
        featureSlimBuildTimers.delete(group);
        if (!featureSlimBuildQueue.includes(group)) featureSlimBuildQueue.push(group);
        if (featureSlimBuildRunning) return;
        featureSlimBuildRunning = true;
        void (async () => {
          try {
            while (featureSlimBuildQueue.length) {
              const next = featureSlimBuildQueue.shift();
              if (!next) continue;
              const baseState = featureState.get(next);
              if (!baseState || baseState.status !== "ready" || !baseState.sharedFileName || !baseState.chunkGroupId) {
                continue;
              }
              if (!depUsageIndex) continue;
              while (activeRequests > 0) {
                await new Promise((r) => setTimeout(r, 250));
              }
              const baseEntries = Array.isArray(baseState.entries) ? baseState.entries : [];
              if (baseEntries.length === 0) continue;
              const usedByBase = /* @__PURE__ */ new Map();
              for (const entry of baseEntries) {
                const u = depUsageIndex.get(entry.fileName);
                if (!u) continue;
                if (u.hasNamespace || u.hasExportStar) continue;
                if (!Array.isArray(u.usedExports) || u.usedExports.length === 0) continue;
                usedByBase.set(entry.fileName, u.usedExports.slice());
              }
              if (usedByBase.size === 0) continue;
              const existingSlim = featureSlimState.get(next);
              if (existingSlim && existingSlim.status === "ready" && existingSlim.depsHash === depsHash && existingSlim.group === next && existingSlim.chunkGroupId && existingSlim.sharedFileName && Array.isArray(existingSlim.entries) && existingSlim.entries.length > 0) {
                const sharedPath = path7.join(depsRoot, existingSlim.sharedFileName);
                const byBase = new Map(existingSlim.entries.map((e) => [e.baseFileName, e]));
                const baseSet = new Set(baseEntries.map((e) => e.fileName));
                const inputsMatch = fs8.existsSync(sharedPath) && existingSlim.entries.every((e) => baseSet.has(e.baseFileName)) && baseEntries.every((base) => {
                  const entry = byBase.get(base.fileName);
                  if (!entry) return false;
                  if (entry.entryPath !== base.entryPath) return false;
                  if (!fs8.existsSync(path7.join(depsRoot, entry.wrapperFileName))) return false;
                  const expected = (usedByBase.get(base.fileName) ?? []).slice().sort();
                  const actual = Array.isArray(entry.usedExports) ? entry.usedExports.slice().sort() : [];
                  if (expected.length !== actual.length) return false;
                  for (let i = 0; i < expected.length; i++) {
                    if (expected[i] !== actual[i]) return false;
                  }
                  return true;
                });
                if (inputsMatch) {
                  continue;
                }
              }
              updateFeatureSlimState(next, {
                version: 1,
                depsHash,
                group: next,
                updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
                status: "building",
                chunkGroupId: null,
                sharedFileName: null,
                entries: baseEntries.map((e) => ({
                  baseFileName: e.fileName,
                  wrapperFileName: e.fileName,
                  entryPath: e.entryPath,
                  packageLabel: e.packageLabel,
                  usedExports: usedByBase.get(e.fileName) ?? []
                }))
              });
              try {
                const chunked = native?.optimizeDependenciesChunked;
                if (!chunked) throw new Error("native.optimizeDependenciesChunked is not available");
                const start = Date.now();
                const result = chunked(
                  baseEntries.map((e) => {
                    const usedExports = usedByBase.get(e.fileName) ?? null;
                    return usedExports && usedExports.length > 0 ? { entryPath: e.entryPath, depsHash, usedExports } : { entryPath: e.entryPath, depsHash };
                  }),
                  ionifyDir
                );
                const groupId = result?.chunk_group ?? result?.chunkGroup ?? null;
                if (!groupId || typeof groupId !== "string") throw new Error("Missing chunkGroupId");
                broadcastPeerDepWarnings(result?.peerDepWarnings ?? result?.peer_dep_warnings);
                const elapsed = Date.now() - start;
                const sharedFileName = `shared.${groupId}.js`;
                const sharedOut = path7.join(depsRoot, sharedFileName);
                if (!fs8.existsSync(sharedOut)) throw new Error("Slim shared chunk not found on disk");
                const resultsArr = Array.isArray(result?.entries) ? result.entries : [];
                const outByEntryPath = /* @__PURE__ */ new Map();
                for (const item of resultsArr) {
                  const entryPath = item?.entry_path ?? item?.entryPath ?? null;
                  const outPath = item?.out_path ?? item?.outPath ?? null;
                  if (typeof entryPath !== "string" || typeof outPath !== "string") continue;
                  const canonicalEntryPath = (() => {
                    try {
                      return fs8.realpathSync(entryPath);
                    } catch {
                      return entryPath;
                    }
                  })();
                  outByEntryPath.set(canonicalEntryPath, path7.basename(outPath));
                }
                const slimEntries = [];
                for (const base of baseEntries) {
                  const canonicalBaseEntryPath = (() => {
                    try {
                      return fs8.realpathSync(base.entryPath);
                    } catch {
                      return base.entryPath;
                    }
                  })();
                  const wrapperFileName = outByEntryPath.get(canonicalBaseEntryPath) ?? base.fileName;
                  if (!fs8.existsSync(path7.join(depsRoot, wrapperFileName))) {
                    throw new Error(`Slim wrapper missing for ${base.packageLabel}: ${wrapperFileName}`);
                  }
                  slimEntries.push({
                    baseFileName: base.fileName,
                    wrapperFileName,
                    entryPath: base.entryPath,
                    packageLabel: base.packageLabel,
                    usedExports: usedByBase.get(base.fileName) ?? []
                  });
                }
                refreshDepsManifestIndex();
                updateFeatureSlimState(next, {
                  version: 1,
                  depsHash,
                  group: next,
                  updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
                  status: "ready",
                  chunkGroupId: groupId,
                  sharedFileName,
                  entries: slimEntries
                });
                const fullSharedPath = path7.join(depsRoot, baseState.sharedFileName);
                const fullBytes = fs8.existsSync(fullSharedPath) ? fs8.statSync(fullSharedPath).size : 0;
                const slimBytes = fs8.existsSync(sharedOut) ? fs8.statSync(sharedOut).size : 0;
                const saved = fullBytes > 0 && slimBytes > 0 ? fullBytes - slimBytes : 0;
                const savedLabel = saved > 0 ? ` (-${formatByteDelta(saved)})` : "";
                logInfo(`Slim pack ready: ${next}${savedLabel}`);
              } catch (err) {
                updateFeatureSlimState(next, {
                  version: 1,
                  depsHash,
                  group: next,
                  updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
                  status: "failed",
                  chunkGroupId: null,
                  sharedFileName: null,
                  entries: featureSlimState.get(next)?.entries ?? [],
                  error: String(err)
                });
                logWarn(`[deps] WARN: Feature pack slimming failed (${next}): ${String(err)}`);
              }
            }
          } finally {
            featureSlimBuildRunning = false;
          }
        })();
      }, 800)
    );
  };
  const enqueueFeatureBuild = (group) => {
    if (!featurePacksEnabled) return;
    if (!featureBuildQueue.includes(group)) {
      featureBuildQueue.push(group);
    }
    if (featureBuildRunning) return;
    featureBuildRunning = true;
    void (async () => {
      try {
        while (featureBuildQueue.length) {
          const next = featureBuildQueue.shift();
          if (!next) continue;
          while (activeRequests > 0) {
            await new Promise((r) => setTimeout(r, 250));
          }
          const state = featureState.get(next);
          const entries = Array.isArray(state?.entries) ? state.entries.slice() : [];
          if (!hasPositivePackRequestSavings(entries.length)) continue;
          const chunkGroupId = computeChunkGroupIdFromStableIds(entries.map((e) => e.fileName));
          const sharedFileName = `shared.${chunkGroupId}.js`;
          const sharedPath = path7.join(depsRoot, sharedFileName);
          const alreadyReady = fs8.existsSync(sharedPath) && entries.every((e) => fs8.existsSync(path7.join(depsRoot, e.fileName)));
          if (alreadyReady) {
            updateFeatureState(next, {
              version: 1,
              depsHash,
              group: next,
              updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
              status: "ready",
              chunkGroupId,
              sharedFileName,
              entries
            });
            if (packSlimmingEnabled) scheduleFeatureSlimBuild(next);
            continue;
          }
          updateFeatureState(next, {
            version: 1,
            depsHash,
            group: next,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
            status: "building",
            chunkGroupId,
            sharedFileName,
            entries
          });
          try {
            const chunked = native?.optimizeDependenciesChunked;
            if (!chunked) throw new Error("native.optimizeDependenciesChunked is not available");
            const start = Date.now();
            const result = chunked(entries.map((e) => ({ entryPath: e.entryPath, depsHash })), ionifyDir);
            const groupId = result?.chunk_group ?? result?.chunkGroup ?? chunkGroupId;
            const resolvedEntries2 = resolveChunkedPackEntries(
              entries,
              Array.isArray(result?.entries) ? result.entries.map((item) => ({
                entryPath: item?.entry_path ?? item?.entryPath ?? null,
                outPath: item?.out_path ?? item?.outPath ?? null
              })) : []
            );
            broadcastPeerDepWarnings(result?.peerDepWarnings ?? result?.peer_dep_warnings);
            const elapsed = Date.now() - start;
            const sharedOut = path7.join(depsRoot, `shared.${groupId}.js`);
            const ok = fs8.existsSync(sharedOut) && resolvedEntries2.every((entry) => fs8.existsSync(path7.join(depsRoot, entry.fileName)));
            if (!ok) {
              throw new Error("Feature pack optimizer did not produce expected outputs");
            }
            refreshDepsManifestIndex();
            for (const entry of resolvedEntries2) {
              upsertObservedPackEntry(featureObserved, entry);
            }
            updateFeatureState(next, {
              version: 1,
              depsHash,
              group: next,
              updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
              status: "ready",
              chunkGroupId: groupId,
              sharedFileName: `shared.${groupId}.js`,
              entries: resolvedEntries2
            });
            logInfo(
              `[deps] \u2713 Feature pack ready (${next}) group=${groupId} members=${resolvedEntries2.length} (${elapsed}ms). Reload to apply.`
            );
            if (packSlimmingEnabled) scheduleFeatureSlimBuild(next);
          } catch (err) {
            updateFeatureState(next, {
              version: 1,
              depsHash,
              group: next,
              updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
              status: "failed",
              chunkGroupId,
              sharedFileName,
              entries,
              error: String(err)
            });
            logWarn(`[deps] WARN: Feature pack build failed (${next}): ${String(err)}`);
          }
        }
      } finally {
        featureBuildRunning = false;
      }
    })();
  };
  const scheduleFeatureBuild = (group) => {
    if (!featurePacksEnabled) return;
    const plannedSignature = plannedFeatureGroups.get(group);
    if (!plannedSignature) return;
    const existing = featureBuildTimers.get(group);
    if (existing) clearTimeout(existing);
    featureBuildTimers.set(
      group,
      setTimeout(() => {
        featureBuildTimers.delete(group);
        enqueueFeatureBuild(group);
      }, 600)
    );
  };
  const recordFeatureCandidate = (entry) => {
    if (!featurePacksEnabled) return;
    if (!entry.fileName || !entry.entryPath) return;
    if (!fs8.existsSync(entry.entryPath)) return;
    const fileName = canonicalFileNameForEntry(entry.fileName, entry.entryPath);
    if (vendorDepFileNames.has(fileName) || isCoreSingletonDepFileName(fileName)) return;
    const wasNew = upsertObservedPackEntry(featureObserved, {
      entryPath: entry.entryPath,
      fileName,
      packageLabel: entry.packageLabel,
      packageName: entry.packageName
    });
    if (!wasNew && featurePackFileNameToChunkGroup.has(fileName)) return;
    replanFeaturePacks();
  };
  const seedFeatureCandidatesFromUsageIndex = (index) => {
    if (!featurePacksEnabled || !index) return;
    let changed = false;
    for (const usage of index.values()) {
      if (!usage?.fileName || !usage?.entryPath || !usage?.packageName) continue;
      if (!fs8.existsSync(usage.entryPath)) continue;
      const fileName = canonicalFileNameForEntry(usage.fileName, usage.entryPath);
      if (vendorDepFileNames.has(fileName) || isCoreSingletonDepFileName(fileName)) continue;
      const subpath = typeof getDepEntry(fileName)?.subpath === "string" ? getDepEntry(fileName)?.subpath ?? null : computeSubpathFromEntryPath(usage.entryPath);
      const wasNew = upsertObservedPackEntry(featureObserved, {
        entryPath: usage.entryPath,
        fileName,
        packageLabel: formatDepLabel(usage.packageName, subpath),
        packageName: usage.packageName
      });
      if (wasNew || !featurePackFileNameToChunkGroup.has(fileName)) {
        changed = true;
      }
    }
    if (changed) {
      replanFeaturePacks();
    }
  };
  if (featurePacksEnabled && depUsageIndex) {
    seedFeatureCandidatesFromUsageIndex(depUsageIndex);
  } else if (featurePacksEnabled && featureObserved.size > 0) {
    replanFeaturePacks();
  }
  const pkgNameFromLabel = (label) => {
    if (!label) return null;
    const at = label.lastIndexOf("@");
    if (at <= 0) return null;
    return label.slice(0, at) || null;
  };
  const observeDepForPackPlanning = (fileName) => {
    if (!manualPacksEnabled && !featurePacksEnabled) return;
    if (!fileName.endsWith(".js")) return;
    if (fileName.startsWith("shared.") || fileName.startsWith("vendor.") || fileName.startsWith("vendor-pack.")) {
      return;
    }
    if (fileName === getVendorPackFileName()) return;
    const entryFromManifest = depsManifestIndex.get(fileName);
    const entryFromRegistry = getDepEntry(fileName);
    const entryPath = entryFromManifest?.entryPath ?? entryFromRegistry?.entryPath;
    if (!entryPath || !fs8.existsSync(entryPath)) return;
    const packageLabel = entryFromRegistry?.packageName ? formatDepLabel(entryFromRegistry.packageName, entryFromRegistry.subpath) : entryFromManifest?.packageLabel ?? fileName;
    const packageName = entryFromRegistry?.packageName ?? pkgNameFromLabel(entryFromManifest?.packageLabel) ?? null;
    const subpath = typeof entryFromRegistry?.subpath === "string" ? entryFromRegistry.subpath : null;
    if (manualPacksEnabled) {
      recordManualCandidate({
        fileName,
        entryPath,
        packageLabel,
        packageName,
        subpath
      });
    }
    if (featurePacksEnabled) {
      recordFeatureCandidate({
        fileName,
        entryPath,
        packageLabel,
        packageName
      });
    }
  };
  let featurePackRoutingHashCache = null;
  let vendorPackV2RoutingHashCache = null;
  const resolveReactRefreshRuntimeImportStatement = () => {
    let packImport = null;
    if (manualPacksEnabled && manualHasCore && native?.resolveModule) {
      try {
        const coreState = manualState.get("core");
        const coreChunkGroupId = coreState?.status === "ready" ? coreState.chunkGroupId : null;
        const corePackFileName = coreChunkGroupId ? `vendor-pack.manual.core.${coreChunkGroupId}.js` : null;
        if (corePackFileName && fs8.existsSync(path7.join(depsRoot, corePackFileName))) {
          const r = native.resolveModule("react-refresh/runtime", rootDir);
          const fsPath = r?.fsPath ?? r?.fs_path ?? null;
          if (fsPath && typeof fsPath === "string") {
            const pkg = r?.pkg ?? null;
            const packageName = typeof pkg?.name === "string" ? pkg.name : "react-refresh";
            const packageVersion = typeof pkg?.version === "string" ? pkg.version : "0.0.0";
            const subpath = computeSubpathForDep2(fsPath, pkg);
            const fileName = registerDepEntry({
              entryPath: fsPath,
              packageName,
              packageVersion,
              subpath
            }).fileName;
            if (!isCoreSingletonDepFileName(fileName)) {
              const routedPack = vendorPackV2.fileNameToPackFile.get(fileName) ?? null;
              if (routedPack === corePackFileName) {
                const memberKey = vendorPackV2MemberKey(fileName);
                packImport = `import { __ionify_vp_${memberKey}__default as RefreshRuntime } from "${depsRuntimeUrl2(corePackFileName)}"`;
              }
            }
          }
        }
      } catch {
        packImport = null;
      }
    }
    if (packImport) return packImport;
    let reactRefreshImport = null;
    try {
      const resolved = native?.resolveModule?.("react-refresh/runtime", rootDir);
      const fsPath = resolved?.fsPath ?? resolved?.fs_path ?? null;
      const pkg = resolved?.pkg ?? null;
      if (typeof fsPath === "string") {
        const packageName = typeof pkg?.name === "string" ? pkg.name : "react-refresh";
        const packageVersion = typeof pkg?.version === "string" ? pkg.version : "0.0.0";
        const subpath = computeSubpathForDep2(fsPath, pkg);
        const fileName = registerDepEntry({
          entryPath: fsPath,
          packageName,
          packageVersion,
          subpath
        }).fileName;
        reactRefreshImport = depsRuntimeUrl2(fileName);
      }
    } catch {
      reactRefreshImport = null;
    }
    if (!reactRefreshImport) {
      try {
        const ionifyRequire = createRequire(import.meta.url);
        const reactRefreshPath = ionifyRequire.resolve("react-refresh/runtime");
        const reactRefreshPkgPath = ionifyRequire.resolve("react-refresh/package.json");
        const reactRefreshPkg = JSON.parse(fs8.readFileSync(reactRefreshPkgPath, "utf8"));
        const fileName = registerDepEntry({
          entryPath: reactRefreshPath,
          packageName: "react-refresh",
          packageVersion: typeof reactRefreshPkg?.version === "string" && reactRefreshPkg.version.trim().length > 0 ? reactRefreshPkg.version : "0.0.0",
          subpath: computeSubpathFromEntryPath(reactRefreshPath)
        }).fileName;
        reactRefreshImport = depsRuntimeUrl2(fileName);
      } catch (err) {
        logError("Failed to resolve react-refresh/runtime", err);
        return null;
      }
    }
    return `import RefreshRuntime from "${reactRefreshImport}"`;
  };
  const buildHmrClientAssetCode = () => {
    try {
      const hmrAsset = readClientAsset("hmr.js");
      const refreshAsset = readClientAsset("react-refresh-runtime.js");
      const refreshImport = resolveReactRefreshRuntimeImportStatement();
      if (!refreshImport) return null;
      const refreshCode = refreshAsset.replace(
        'import RefreshRuntime from "react-refresh/runtime"',
        refreshImport
      );
      return `${hmrAsset}

${refreshCode}
`;
    } catch (err) {
      logError("Failed to build HMR client asset", err);
      return null;
    }
  };
  const getFeaturePackRoutingHash = () => {
    if (!featurePacksEnabled) return null;
    const indexPath = featurePackIndexPath();
    if (!fs8.existsSync(indexPath)) return null;
    try {
      const stat = fs8.statSync(indexPath);
      if (featurePackRoutingHashCache && featurePackRoutingHashCache.mtimeMs === stat.mtimeMs && featurePackRoutingHashCache.size === stat.size) {
        return featurePackRoutingHashCache.hash;
      }
      const raw = JSON.parse(fs8.readFileSync(indexPath, "utf8"));
      const hash = hashFeaturePackRoutingIndex(
        raw,
        depsHash,
        DEPS_OPTIMIZER_OUTPUT_VERSION
      );
      featurePackRoutingHashCache = { mtimeMs: stat.mtimeMs, size: stat.size, hash };
      return hash;
    } catch {
      featurePackRoutingHashCache = null;
      return null;
    }
  };
  const getVendorPackV2RoutingHash = () => {
    const indexPath = vendorPackV2IndexPath();
    if (!fs8.existsSync(indexPath)) return null;
    try {
      const stat = fs8.statSync(indexPath);
      if (vendorPackV2RoutingHashCache && vendorPackV2RoutingHashCache.mtimeMs === stat.mtimeMs && vendorPackV2RoutingHashCache.size === stat.size) {
        return vendorPackV2RoutingHashCache.hash;
      }
      const raw = JSON.parse(fs8.readFileSync(indexPath, "utf8"));
      const hash = hashVendorPackV2RoutingIndex(
        raw,
        depsHash,
        DEPS_OPTIMIZER_OUTPUT_VERSION
      );
      vendorPackV2RoutingHashCache = { mtimeMs: stat.mtimeMs, size: stat.size, hash };
      return hash;
    } catch {
      vendorPackV2RoutingHashCache = null;
      return null;
    }
  };
  const computeTransformHash = (baseHash) => {
    const parts = [];
    parts.push(`reactRefreshHmr:${REACT_REFRESH_HMR_CONTRACT_VERSION}`);
    parts.push(`depsRouting:${depsHash}:${DEPS_OPTIMIZER_OUTPUT_VERSION}`);
    parts.push(`vendorPackV2Policy:${VENDOR_PACK_V2_REWRITE_POLICY_VERSION}`);
    const featureHash = getFeaturePackRoutingHash();
    if (featureHash) parts.push(`featurePacks:${featureHash}`);
    const vendorHash = getVendorPackV2RoutingHash();
    if (vendorHash) parts.push(`vendorPackV2:${vendorHash}`);
    if (parts.length === 0) return baseHash;
    return getCacheKey(`${baseHash}|${parts.join("|")}`);
  };
  const rewriteIonifySharedChunkImportsForVendorPackV2 = (code) => {
    if (!code.startsWith("// Ionify Shared Chunk")) return null;
    if (!vendorPacksEnabled) return null;
    if (vendorPackV2.fileNameToPackFile.size === 0) return null;
    if (!code.includes(`${DEPS_PREFIX}`)) return null;
    const modulesMarker = "\nconst __ionifyModules";
    const cutIndex = code.indexOf(modulesMarker);
    const headEnd = cutIndex === -1 ? Math.min(code.length, 8 * 1024) : cutIndex;
    const head = code.slice(0, headEnd);
    const tail = code.slice(headEnd);
    const lines = head.split("\n");
    let mutated = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("//")) continue;
      if (!trimmed.startsWith("import ")) break;
      const defMatch = trimmed.match(/^import\s+([A-Za-z0-9_$]+)\s+from\s+["']\/@deps\/([^"']+)["'];?\s*$/);
      if (defMatch) {
        const local = defMatch[1];
        const depFileName = depsFileNameFromRuntimeUrl(`${DEPS_PREFIX}${defMatch[2]}`);
        if (!depFileName) continue;
        if (isCoreSingletonDepFileName(depFileName)) continue;
        const packFileName = vendorPackV2.fileNameToPackFile.get(depFileName) ?? null;
        if (!packFileName) continue;
        if (!fs8.existsSync(path7.join(depsRoot, packFileName))) continue;
        const memberKey = vendorPackV2MemberKey(depFileName);
        lines[i] = `import { __ionify_vp_${memberKey}__default as ${local} } from "${depsRuntimeUrl2(packFileName)}";`;
        mutated = true;
        continue;
      }
      const nsMatch = trimmed.match(
        /^import\s+\*\s+as\s+([A-Za-z0-9_$]+)\s+from\s+["']\/@deps\/([^"']+)["'];?\s*$/
      );
      if (nsMatch) {
        const local = nsMatch[1];
        const depFileName = depsFileNameFromRuntimeUrl(`${DEPS_PREFIX}${nsMatch[2]}`);
        if (!depFileName) continue;
        if (isCoreSingletonDepFileName(depFileName)) continue;
        const packFileName = vendorPackV2.fileNameToPackFile.get(depFileName) ?? null;
        if (!packFileName) continue;
        if (!fs8.existsSync(path7.join(depsRoot, packFileName))) continue;
        const memberKey = vendorPackV2MemberKey(depFileName);
        lines[i] = `import { __ionify_vp_${memberKey}__ns as ${local} } from "${depsRuntimeUrl2(packFileName)}";`;
        mutated = true;
        continue;
      }
    }
    if (!mutated) return null;
    return `${lines.join("\n")}${tail}`;
  };
  const transformer = new TransformEngine({ casRoot, versionHash: configHash });
  const baseCasExts = /* @__PURE__ */ new Set([
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts"
  ]);
  let baseCasPool = null;
  const pendingBaseCas = /* @__PURE__ */ new Map();
  let shuttingDown = false;
  const getBaseCasPool = () => {
    if (baseCasPool) return baseCasPool;
    baseCasPool = new TransformWorkerPool({ size: 1 });
    return baseCasPool;
  };
  const ensureBaseCasTransform = async (opts) => {
    const ext = opts.ext.toLowerCase();
    if (!baseCasExts.has(ext)) return;
    if (opts.filePath.includes(`${path7.sep}node_modules${path7.sep}`)) return;
    if (!opts.baseHash) return;
    const dir = getCasArtifactPath(casRoot, configHash, opts.baseHash);
    const outFile = path7.join(dir, "transformed.js");
    if (fs8.existsSync(outFile)) return;
    const existing = pendingBaseCas.get(opts.baseHash);
    if (existing) {
      await existing;
      return;
    }
    const jobPromise = (async () => {
      try {
        const pool = getBaseCasPool();
        const result = await pool.run({
          id: opts.baseHash,
          filePath: opts.filePath,
          ext,
          code: opts.code
        });
        if (result.error) {
          logWarn(`[CAS] base transform failed for ${opts.filePath}: ${result.error}`);
          return;
        }
        try {
          fs8.mkdirSync(dir, { recursive: true });
          const tmp = `${outFile}.tmp-${process.pid}-${Date.now()}`;
          fs8.writeFileSync(tmp, result.code, "utf8");
          fs8.renameSync(tmp, outFile);
          if (result.map) {
            const mapFile = `${outFile}.map`;
            const tmpMap = `${mapFile}.tmp-${process.pid}-${Date.now()}`;
            fs8.writeFileSync(tmpMap, result.map, "utf8");
            fs8.renameSync(tmpMap, mapFile);
          }
        } catch {
        }
      } finally {
        pendingBaseCas.delete(opts.baseHash);
      }
    })();
    pendingBaseCas.set(opts.baseHash, jobPromise);
    await jobPromise;
  };
  const pendingWatchedDeps = /* @__PURE__ */ new Set();
  let pendingWatchFlush = false;
  const scheduleDependencyWatches = (depsAbs) => {
    if (shuttingDown) return;
    for (const dep of depsAbs) {
      if (typeof dep === "string" && dep.length > 0) pendingWatchedDeps.add(dep);
    }
    if (pendingWatchFlush || pendingWatchedDeps.size === 0) return;
    pendingWatchFlush = true;
    setImmediate(() => {
      if (shuttingDown) {
        pendingWatchFlush = false;
        pendingWatchedDeps.clear();
        return;
      }
      pendingWatchFlush = false;
      const batch = Array.from(pendingWatchedDeps);
      pendingWatchedDeps.clear();
      for (const dep of batch) {
        try {
          watcher.watchFile(dep);
        } catch {
        }
      }
    });
  };
  const scheduleBaseCasTransform = (opts) => {
    if (shuttingDown) return;
    setImmediate(() => {
      if (shuttingDown) return;
      void ensureBaseCasTransform(opts).catch(() => {
      });
    });
  };
  const graph = new Graph(rawVersionInputs, { ionifyDir });
  const registerDevCssGraphSources = () => {
    return registerCssDemandGraphSourceFiles(
      rootDir,
      graph.listFilesByKind("js").filter((filePath) => {
        if (filePath.includes("node_modules") || filePath.includes(`${path7.sep}.ionify${path7.sep}`)) return false;
        const clean = filePath.split("?")[0].split("#")[0].toLowerCase();
        return clean.endsWith(".js") || clean.endsWith(".jsx") || clean.endsWith(".ts") || clean.endsWith(".tsx") || clean.endsWith(".mdx");
      })
    );
  };
  const federationRemoteBindings = collectFederationRemoteImportBindings(userConfig, rootDir);
  const resolveTransformedRuntimeGraphDeps = (runtimeDependencies, importerAbs, fallbackStaticDeps, fallbackDynamicDeps = []) => {
    if (!Array.isArray(runtimeDependencies)) {
      return { deps: fallbackStaticDeps, dynamicDeps: fallbackDynamicDeps };
    }
    const staticSpecs = runtimeDependencies.filter((dependency) => dependency.kind === "static").map((dependency) => dependency.specifier);
    const dynamicSpecs = runtimeDependencies.filter((dependency) => dependency.kind === "dynamic").map((dependency) => dependency.specifier);
    const staticClassified = classifyImportSpecifiersForGraph(
      staticSpecs,
      importerAbs,
      configuredExternalSpecifiers
    );
    const dynamicClassified = classifyImportSpecifiersForGraph(
      dynamicSpecs,
      importerAbs,
      configuredExternalSpecifiers
    );
    const localRuntimeDeps = [
      ...staticClassified.localDeps,
      ...dynamicClassified.localDeps
    ];
    recordDepLeafGraphNodes(localRuntimeDeps);
    enqueueLocalGraphCompletion(localRuntimeDeps);
    scheduleDependencyWatches(localRuntimeDeps);
    return {
      deps: rewriteFederationGraphEdgeIds(
        [...staticClassified.localDeps, ...staticClassified.externalDeps],
        federationRemoteBindings
      ),
      dynamicDeps: rewriteFederationGraphEdgeIds(
        [...dynamicClassified.localDeps, ...dynamicClassified.externalDeps],
        federationRemoteBindings
      )
    };
  };
  if (userConfig?.federation) {
    syncFederationGraphNodes(graph, buildFederationConfigGraphNodes(userConfig, rootDir));
  }
  if (native?.initAstCache) {
    const versionHash = JSON.stringify(rawVersionInputs);
    native.initAstCache(versionHash);
    logInfo(`AST cache initialized with version hash`);
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
        const entries = stats.total_entries ?? stats.totalEntries ?? 0;
        const sizeBytes = stats.total_size_bytes ?? stats.totalSizeBytes ?? 0;
        const hits = stats.total_hits ?? stats.totalHits ?? 0;
        const hitRate = stats.hit_rate ?? stats.hitRate ?? 0;
        logInfo(`[AST Cache] entries=${entries}, size=${sizeBytes} bytes, hits=${hits}, hitRate=${hitRate}`);
      } catch {
      }
    }
  }
  const moduleResolver = new ModuleResolver(rootDir, {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json", ".mjs"],
    conditions: ["import", "default"],
    mainFields: ["module", "main"],
    ...userConfig?.resolve || {}
  });
  await applyRegisteredLoaders(transformer, userConfig);
  const hmr = new HMRServer();
  const peerDepWarningSet = /* @__PURE__ */ new Set();
  const peerDepWarningLog = [];
  function broadcastPeerDepWarnings(warnings) {
    if (!warnings || warnings.length === 0) return;
    const freshWarnings = [];
    for (const msg of warnings) {
      if (typeof msg !== "string" || msg.length === 0 || peerDepWarningSet.has(msg)) continue;
      peerDepWarningSet.add(msg);
      peerDepWarningLog.push(msg);
      freshWarnings.push(msg);
    }
    if (freshWarnings.length === 0) return;
    for (const msg of freshWarnings) {
      logWarn(`[deps] ${msg}`);
    }
    hmr.broadcastEvent("peer-dep-warning", { warnings: peerDepWarningLog.slice() }, { retain: true });
  }
  const envFromFiles = loadEnv(envMode, rootDir);
  process.env.NODE_ENV = process.env.NODE_ENV ?? "development";
  process.env.MODE = envMode;
  const envValues = {
    ...envFromFiles,
    NODE_ENV: process.env.NODE_ENV,
    MODE: process.env.MODE
  };
  const envPrefix = userConfig?.envPrefix || ["VITE_", "IONIFY_"];
  const defineConfig = buildDefineConfig(userConfig?.define, envValues, envPrefix);
  logInfo(`[define] ${Object.keys(defineConfig).length} replacements configured`);
  const envEnabledExts = /* @__PURE__ */ new Set([
    ".html",
    ".js",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
    ".jsx"
  ]);
  const applyEnvPlaceholders = (input, extname) => {
    if (!envEnabledExts.has(extname)) return input;
    return substituteEnvPlaceholders(input, envValues, envPrefix);
  };
  const parseJsonBody = async (req) => {
    const chunks = [];
    await new Promise((resolve, reject) => {
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => resolve());
      req.on("error", (err) => reject(err));
    });
    if (!chunks.length) return null;
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  };
  const sendJson = (res, status, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(body);
  };
  const buildUpdatePayload = async (modules) => {
    const updates = [];
    for (const mod of modules) {
      const exists = fs8.existsSync(mod.absPath);
      if (mod.reason === "deleted" || !exists) {
        graph.removeFile(mod.absPath);
        watcher.unwatchFile(mod.absPath);
        updates.push({
          url: mod.url,
          hash: null,
          deps: [],
          reason: mod.reason,
          status: "deleted"
        });
        continue;
      }
      watcher.watchFile(mod.absPath);
      const ext = path7.extname(mod.absPath).toLowerCase();
      if (isCssLikeExt(ext)) {
        let hash2 = mod.hash;
        if (!hash2) {
          try {
            hash2 = getCacheKey(fs8.readFileSync(mod.absPath, "utf8"));
          } catch {
            hash2 = graph.getNode(mod.absPath)?.hash ?? getCacheKey(mod.absPath);
          }
        }
        const depsAbs = graph.getNode(mod.absPath)?.deps ?? [];
        graph.recordFile(mod.absPath, hash2, depsAbs, [], "css");
        updates.push({
          url: mod.url,
          hash: hash2,
          deps: depsAbs.map((dep) => normalizeUrlFromFs(rootDir, dep)),
          reason: mod.reason,
          status: "updated",
          code: ""
        });
        continue;
      }
      if (isAssetExt(ext)) {
        let hash2 = mod.hash;
        if (!hash2) {
          try {
            const buf = fs8.readFileSync(mod.absPath);
            hash2 = crypto2.createHash("sha256").update(buf).digest("hex");
          } catch {
            hash2 = graph.getNode(mod.absPath)?.hash ?? getCacheKey(mod.absPath);
          }
        }
        graph.recordFile(mod.absPath, hash2, [], [], "asset");
        updates.push({
          url: mod.url,
          hash: hash2,
          deps: [],
          reason: mod.reason,
          status: "updated",
          code: ""
        });
        continue;
      }
      let code;
      try {
        code = fs8.readFileSync(mod.absPath, "utf8");
      } catch (err) {
        logError("Failed to read module during HMR apply", err);
        throw err;
      }
      let hash;
      let specs;
      if (native?.parseModuleIr) {
        try {
          const ir = native.parseModuleIr(mod.absPath, code);
          hash = ir.hash;
          specs = ir.dependencies.map((dep) => dep.specifier);
        } catch {
          hash = getCacheKey(code);
          specs = extractImports(code, mod.absPath);
        }
      } else {
        hash = getCacheKey(code);
        specs = extractImports(code, mod.absPath);
      }
      const { localDeps, externalDeps } = classifyImportSpecifiersForGraph(
        specs,
        mod.absPath,
        configuredExternalSpecifiers
      );
      const nextDeps = rewriteFederationGraphEdgeIds(
        [...localDeps, ...externalDeps],
        federationRemoteBindings
      );
      enqueueLocalGraphCompletion(localDeps);
      graph.recordFile(mod.absPath, hash, nextDeps);
      scheduleDependencyWatches(localDeps);
      if (isEntryModule(mod.absPath, userConfig ?? void 0) || hasReactRootRenderSideEffect(code)) {
        updates.push({
          url: mod.url,
          hash,
          deps: nextDeps.map((dep) => normalizeGraphDepForClient(rootDir, dep)),
          reason: mod.reason,
          status: "reload"
        });
        continue;
      }
      const extName = path7.extname(mod.absPath);
      const result = await transformer.run({
        path: mod.absPath,
        code,
        ext: extName,
        moduleHash: computeTransformHash(hash),
        config: userConfig ?? null
      });
      scheduleBaseCasTransform({
        filePath: mod.absPath,
        ext: extName,
        code,
        baseHash: hash
      });
      const runtimeGraph = resolveTransformedRuntimeGraphDeps(
        result.runtimeDependencies,
        mod.absPath,
        nextDeps
      );
      graph.recordFile(
        mod.absPath,
        hash,
        runtimeGraph.deps,
        runtimeGraph.dynamicDeps
      );
      const transformed = result.code;
      const envApplied = applyEnvPlaceholders(
        transformed,
        extName
      );
      updates.push({
        url: mod.url,
        hash,
        deps: runtimeGraph.deps.map((dep) => normalizeGraphDepForClient(rootDir, dep)),
        reason: mod.reason,
        status: "updated",
        code: envApplied
      });
    }
    return updates;
  };
  const requestHandler = async (req, res) => {
    activeRequests += 1;
    if (papRunningLevel === "artifacts") {
      cancelProductionArtifactsPublication("active-request");
    }
    try {
      const parsed = url.parse(req.url || "/", true);
      let reqPath = parsed.pathname || "/";
      try {
        reqPath = decodeURIComponent(reqPath);
      } catch {
      }
      const q = parsed.query || {};
      const requestUrlWithQuery = `${reqPath}${parsed.search ?? ""}`;
      const routeHintClientKey = buildRouteHintClientKey(req);
      const routeHintReferer = Array.isArray(req.headers.referer) ? req.headers.referer[0] ?? null : req.headers.referer ?? null;
      const routeHintObservedAtMs = Date.now();
      if (reqPath === "/__ionify_hmr") {
        hmr.handleSSE(req, res);
        return;
      }
      if (reqPath === "/__ionify_hmr_client.js") {
        const code2 = buildHmrClientAssetCode();
        if (!code2) {
          res.statusCode = 500;
          res.end("Failed to build HMR client");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
        res.end(code2);
        return;
      }
      if (reqPath === "/__ionify_overlay.js") {
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
        res.end(readClientAsset("overlay.js"));
        return;
      }
      if (reqPath === "/__ionify_react_refresh.js") {
        try {
          const asset = readClientAsset("react-refresh-runtime.js");
          const refreshImport = resolveReactRefreshRuntimeImportStatement();
          if (!refreshImport) {
            res.statusCode = 500;
            res.end("Failed to resolve react-refresh/runtime. Make sure react-refresh is installed.");
            return;
          }
          const code2 = asset.replace(
            'import RefreshRuntime from "react-refresh/runtime"',
            refreshImport
          );
          res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
          res.end(code2);
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
        let body;
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
            modules
          });
        } catch (err) {
          logError("Failed to build HMR update payload", err);
          hmr.broadcastError({
            id,
            message: "Failed to compile update; falling back to full reload"
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
        let body;
        try {
          body = await parseJsonBody(req);
        } catch {
          body = null;
        }
        const id = typeof body?.id === "string" ? body.id : void 0;
        const message = typeof body?.message === "string" ? body.message : "Unknown HMR error";
        logError(`[HMR] client reported error${id ? ` ${id}` : ""}: ${message}`);
        hmr.broadcastError({ id, message });
        sendJson(res, 200, { ok: true });
        return;
      }
      if (reqPath === "/__ionify_startup/report") {
        if (!startupPolicyEnabled) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        if (req.method !== "POST") {
          res.writeHead(405, { Allow: "POST" });
          res.end("Method Not Allowed");
          return;
        }
        let body;
        try {
          body = await parseJsonBody(req);
        } catch {
          body = null;
        }
        const routeKey = normalizeDocumentRouteKey(typeof body?.routeKey === "string" ? body.routeKey : "/");
        const preFcpLoadedUrls = Array.isArray(body?.preFcpLoadedUrls) ? body.preFcpLoadedUrls.filter((value) => {
          if (typeof value !== "string" || !value.startsWith("/")) return false;
          return isRouteHintPreloadValid(value, value.startsWith(DEPS_PREFIX) ? "dep" : "source");
        }) : [];
        const preFcpEvaluatedUrls = Array.isArray(body?.preFcpEvaluatedUrls) ? body.preFcpEvaluatedUrls.filter((value) => {
          if (typeof value !== "string" || !value.startsWith("/")) return false;
          return isRouteHintPreloadValid(value, value.startsWith(DEPS_PREFIX) ? "dep" : "source");
        }) : [];
        startupObservations.recordRouteObservation({
          routeKey,
          preFcpLoadedUrls,
          preFcpEvaluatedUrls
        });
        refreshStartupPolicySnapshot();
        scheduleProductionArtifactPublication(`startup-report:${routeKey}`);
        sendJson(res, 200, { ok: true });
        return;
      }
      if (reqPath.startsWith(DEPS_PREFIX)) {
        const fileName = reqPath.slice(DEPS_PREFIX.length);
        if (fileName.endsWith(".js")) bumpDevStable();
        if (fileName === getVendorPackFileName()) {
          ensureVendorPackFile();
        }
        if (fileName.endsWith(".js.map")) {
          const mapPath = path7.join(depsRoot, fileName);
          if (fs8.existsSync(mapPath)) {
            const stat = fs8.statSync(mapPath);
            const etag = weakEtagFromStat(`deps-map-${depsHash}`, stat);
            if (isNotModified(req, etag)) {
              res.setHeader("ETag", etag);
              res.setHeader("Cache-Control", "no-cache");
              res.statusCode = 304;
              res.end();
              return;
            }
            sendBuffer(
              req,
              res,
              200,
              "application/json; charset=utf-8",
              fs8.readFileSync(mapPath),
              { etag, cacheControl: "no-cache" }
            );
            return;
          }
        }
        if (vendorPackSessionRequestCounts && fileName.endsWith(".js") && !fileName.startsWith("shared.") && fileName !== getVendorPackFileName()) {
          vendorPackSessionRequestCounts.set(
            fileName,
            (vendorPackSessionRequestCounts.get(fileName) ?? 0) + 1
          );
          vendorPackRequestCountsDirty = true;
          flushVendorPackRequestCounts(false);
        }
        const depsFilePath = path7.join(depsRoot, fileName);
        const entryFromManifest = depsManifestIndex.get(fileName);
        let entryFromRegistry = getDepEntry(fileName);
        let entryPath = entryFromManifest?.entryPath ?? entryFromRegistry?.entryPath;
        let packageLabel = entryFromRegistry?.packageName ? formatDepLabel(entryFromRegistry.packageName, entryFromRegistry.subpath) : entryFromManifest?.packageLabel ?? fileName;
        const observeRouteHintDepRequest = () => {
          if (!fileName.endsWith(".js")) return;
          routeHints.noteRequest({
            url: requestUrlWithQuery,
            kind: "dep",
            refererUrl: routeHintReferer,
            clientKey: routeHintClientKey,
            observedAtMs: routeHintObservedAtMs
          });
        };
        observeDepForPackPlanning(fileName);
        const isVersionedDepWrapper = fileName.endsWith(".js") && !fileName.startsWith("shared.") && !fileName.startsWith("vendor.") && !fileName.startsWith("vendor-pack.");
        const manifestVersionCurrent = !isVersionedDepWrapper || // No manifest entry means no recorded version — treat the on-disk file as current
        // (it may have been written directly, e.g. by tests or external tooling).
        // Only trigger a stale-rebuild when an entry exists WITH a mismatched outputVersion.
        !entryFromManifest || entryFromManifest.outputVersion === DEPS_OPTIMIZER_OUTPUT_VERSION;
        if (fs8.existsSync(depsFilePath) && manifestVersionCurrent) {
          observeRouteHintDepRequest();
          const vendorV2Hash = getVendorPackV2RoutingHash();
          if (vendorV2Hash && fileName.startsWith("shared.") && fileName.endsWith(".js")) {
            const stat2 = fs8.statSync(depsFilePath);
            const etag2 = weakEtagFromStat(`deps-${depsHash}-vp2-${vendorV2Hash}`, stat2);
            if (isNotModified(req, etag2)) {
              res.setHeader("ETag", etag2);
              res.setHeader("Cache-Control", "no-cache");
              res.statusCode = 304;
              res.end();
              logInfo(`[deps] OPTIMIZE ${packageLabel}: HIT from cache (304) (vp2)`);
              return;
            }
            const raw = fs8.readFileSync(depsFilePath, "utf8");
            const rewritten = rewriteIonifySharedChunkImportsForVendorPackV2(raw) ?? raw;
            sendBuffer(req, res, 200, "application/javascript; charset=utf-8", startupInstrumentJavaScriptBuffer(Buffer.from(rewritten, "utf8")), {
              etag: etag2,
              cacheControl: "no-cache"
            });
            logInfo(`[deps] OPTIMIZE ${packageLabel}: HIT from cache (vp2)`);
            return;
          }
          const variant = selectPrecompressedVariant(req, depsFilePath);
          if (variant) {
            sendPrecompressedFile(req, res, 200, "application/javascript; charset=utf-8", variant, {
              etagPrefix: `deps-${depsHash}`,
              cacheControl: "no-cache"
            });
            const status = res.statusCode === 304 ? " (304)" : "";
            logInfo(`[deps] OPTIMIZE ${packageLabel}: HIT from cache${status} (${variant.encoding})`);
            return;
          }
          const stat = fs8.statSync(depsFilePath);
          const etag = weakEtagFromStat(`deps-${depsHash}`, stat);
          if (isNotModified(req, etag)) {
            res.setHeader("ETag", etag);
            res.setHeader("Cache-Control", "no-cache");
            res.statusCode = 304;
            res.end();
            logInfo(`[deps] OPTIMIZE ${packageLabel}: HIT from cache (304)`);
            return;
          }
          sendBuffer(req, res, 200, "application/javascript; charset=utf-8", startupInstrumentJavaScriptBuffer(fs8.readFileSync(depsFilePath)), {
            etag,
            cacheControl: "no-cache"
          });
          logInfo(`[deps] OPTIMIZE ${packageLabel}: HIT from cache`);
          return;
        }
        if (fs8.existsSync(depsFilePath) && !manifestVersionCurrent) {
          try {
            fs8.rmSync(depsFilePath, { force: true });
            fs8.rmSync(`${depsFilePath}.gz`, { force: true });
            fs8.rmSync(`${depsFilePath}.map`, { force: true });
          } catch {
          }
          logInfo(
            `[deps] OPTIMIZE ${packageLabel}: STALE cache (outputVersion=${entryFromManifest?.outputVersion ?? 0} expected=${DEPS_OPTIMIZER_OUTPUT_VERSION}) \u2192 REBUILD`
          );
        }
        if (canChunkVendorPacks && vendorPackEntries.length > 1 && (vendorPackDepFileNames.has(fileName) || vendorPackSharedFileName && fileName === vendorPackSharedFileName)) {
          try {
            const start = Date.now();
            const rawSize = entryPath && fs8.existsSync(entryPath) ? fs8.statSync(entryPath).size : 0;
            const chunked = native?.optimizeDependenciesChunked;
            if (!chunked) throw new Error("native.optimizeDependenciesChunked is not available");
            const result2 = chunked(
              vendorPackEntries.map((d) => ({ entryPath: d.entryPath, depsHash })),
              ionifyDir
            );
            broadcastPeerDepWarnings(result2?.peerDepWarnings ?? result2?.peer_dep_warnings);
            const group = result2?.chunk_group ?? result2?.chunkGroup ?? "unknown";
            const chunks = result2?.chunk_files ?? result2?.chunkFiles ?? [];
            if (!fs8.existsSync(depsFilePath)) {
              throw new Error("Vendor pack optimizer did not produce requested file");
            }
            const stat = fs8.statSync(depsFilePath);
            const optimizedSize = stat.size;
            const etag = weakEtagFromStat(`deps-${depsHash}`, stat);
            observeRouteHintDepRequest();
            const variant = selectPrecompressedVariant(req, depsFilePath);
            if (variant) {
              sendPrecompressedFile(req, res, 200, "application/javascript; charset=utf-8", variant, {
                etagPrefix: `deps-${depsHash}`,
                cacheControl: "no-cache"
              });
            } else {
              sendBuffer(req, res, 200, "application/javascript; charset=utf-8", startupInstrumentJavaScriptBuffer(fs8.readFileSync(depsFilePath)), {
                etag,
                cacheControl: "no-cache"
              });
            }
            const elapsed = Date.now() - start;
            const rawKb = (rawSize / 1024).toFixed(1);
            const optKb = (optimizedSize / 1024).toFixed(1);
            const chunkCount = Array.isArray(chunks) ? chunks.length : 0;
            logInfo(
              `[deps] OPTIMIZE ${packageLabel}: MISS \u2192 BUILD (vendor pack group=${group}, ${elapsed}ms, ${rawKb}KB \u2192 ${optKb}KB, chunks=${chunkCount})`
            );
            refreshDepsManifestIndex();
            observeDepForPackPlanning(fileName);
            return;
          } catch (err) {
            logWarn(
              `[deps] WARN: Vendor pack optimization failed for ${packageLabel}, falling back to per-entry: ${String(err)}`
            );
          }
        }
        if (canChunkVendorCore && (vendorDepFileNames.has(fileName) || vendorCoreSharedFileName && fileName === vendorCoreSharedFileName)) {
          try {
            const start = Date.now();
            const rawSize = entryPath && fs8.existsSync(entryPath) ? fs8.statSync(entryPath).size : 0;
            const chunked = native?.optimizeDependenciesChunked;
            if (!chunked) throw new Error("native.optimizeDependenciesChunked is not available");
            const result2 = chunked(
              vendorDeps.map((d) => ({ entryPath: d.entryPath, depsHash })),
              ionifyDir
            );
            broadcastPeerDepWarnings(result2?.peerDepWarnings ?? result2?.peer_dep_warnings);
            const group = result2?.chunk_group ?? result2?.chunkGroup ?? "unknown";
            const chunks = result2?.chunk_files ?? result2?.chunkFiles ?? [];
            if (!fs8.existsSync(depsFilePath)) {
              throw new Error("Chunked optimizer did not produce requested file");
            }
            const stat = fs8.statSync(depsFilePath);
            const optimizedSize = stat.size;
            const etag = weakEtagFromStat(`deps-${depsHash}`, stat);
            observeRouteHintDepRequest();
            const variant = selectPrecompressedVariant(req, depsFilePath);
            if (variant) {
              sendPrecompressedFile(req, res, 200, "application/javascript; charset=utf-8", variant, {
                etagPrefix: `deps-${depsHash}`,
                cacheControl: "no-cache"
              });
            } else {
              sendBuffer(req, res, 200, "application/javascript; charset=utf-8", startupInstrumentJavaScriptBuffer(fs8.readFileSync(depsFilePath)), {
                etag,
                cacheControl: "no-cache"
              });
            }
            const elapsed = Date.now() - start;
            const rawKb = (rawSize / 1024).toFixed(1);
            const optKb = (optimizedSize / 1024).toFixed(1);
            const chunkCount = Array.isArray(chunks) ? chunks.length : 0;
            logInfo(
              `[deps] OPTIMIZE ${packageLabel}: MISS \u2192 BUILD (chunked group=${group}, ${elapsed}ms, ${rawKb}KB \u2192 ${optKb}KB, chunks=${chunkCount})`
            );
            refreshDepsManifestIndex();
            observeDepForPackPlanning(fileName);
            return;
          } catch (err) {
            logWarn(
              `[deps] WARN: Chunked optimization failed for ${packageLabel}, falling back to per-entry: ${String(err)}`
            );
          }
        }
        if (!entryPath || !native?.optimizeDependency) {
          res.statusCode = 404;
          res.end("Dependency not found");
          return;
        }
        try {
          const start = Date.now();
          const rawSize = fs8.existsSync(entryPath) ? fs8.statSync(entryPath).size : 0;
          const result2 = native.optimizeDependency(
            entryPath,
            depsHash,
            depsSourcemapEnabled,
            depsBundleEsmEnabled,
            ionifyDir
          );
          broadcastPeerDepWarnings(result2?.peerDepWarnings ?? result2?.peer_dep_warnings);
          const outPath = result2?.out_path ?? result2?.outPath ?? depsFilePath;
          const mapPath = result2?.map_path ?? result2?.mapPath ?? null;
          const resolvedOutPath = path7.isAbsolute(outPath) ? outPath : path7.join(depsRoot, outPath);
          if (!fs8.existsSync(resolvedOutPath)) {
            throw new Error("Optimizer did not produce output");
          }
          const stat = fs8.statSync(resolvedOutPath);
          const optimizedSize = stat.size;
          const etag = weakEtagFromStat(`deps-${depsHash}`, stat);
          observeRouteHintDepRequest();
          const variant = selectPrecompressedVariant(req, resolvedOutPath);
          if (variant) {
            sendPrecompressedFile(req, res, 200, "application/javascript; charset=utf-8", variant, {
              etagPrefix: `deps-${depsHash}`,
              cacheControl: "no-cache"
            });
          } else {
            const outBuffer = fs8.readFileSync(resolvedOutPath);
            sendBuffer(req, res, 200, "application/javascript; charset=utf-8", startupInstrumentJavaScriptBuffer(outBuffer), {
              etag,
              cacheControl: "no-cache"
            });
          }
          const elapsed = Date.now() - start;
          const rawKb = (rawSize / 1024).toFixed(1);
          const optKb = (optimizedSize / 1024).toFixed(1);
          const mapSuffix = mapPath ? ` map=${path7.basename(mapPath)}` : "";
          logInfo(`[deps] OPTIMIZE ${packageLabel}: MISS \u2192 BUILD (${elapsed}ms, ${rawKb}KB \u2192 ${optKb}KB)${mapSuffix}`);
          refreshDepsManifestIndex();
          observeDepForPackPlanning(fileName);
          return;
        } catch (err) {
          logWarn(
            `[deps] WARN: Optimization failed for ${packageLabel}; refusing raw fallback to preserve /@deps contract: ${String(err)}`
          );
          res.statusCode = 500;
          res.end("Dependency optimization failed");
          return;
        }
      }
      let fsPath = null;
      let isPublicFile = false;
      if (publicDirAbs && shouldTryPublicDir(reqPath)) {
        const candidate = decodePublicDirPath(publicDirAbs, reqPath);
        if (candidate && fs8.existsSync(candidate)) {
          fsPath = candidate;
          isPublicFile = true;
        }
      }
      if (!fsPath) {
        fsPath = decodePublicPath(rootDir, reqPath, { allowedRoots, workspaceRoot: workspace.workspaceRoot });
      }
      if (!fsPath) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      let effectiveFsPath = fsPath;
      let effectiveUrlPath = reqPath;
      if (fs8.existsSync(effectiveFsPath) && fs8.statSync(effectiveFsPath).isDirectory()) {
        const indexExtensions = [".html", ".js", ".ts", ".tsx", ".jsx"];
        let found = false;
        for (const ext2 of indexExtensions) {
          const indexFile = path7.join(effectiveFsPath, `index${ext2}`);
          if (fs8.existsSync(indexFile)) {
            effectiveFsPath = indexFile;
            effectiveUrlPath = effectiveUrlPath.endsWith("/") ? `${effectiveUrlPath}index${ext2}` : `${effectiveUrlPath}/index${ext2}`;
            found = true;
            break;
          }
        }
        if (!found) {
          const packageJson = path7.join(effectiveFsPath, "package.json");
          if (fs8.existsSync(packageJson)) {
            try {
              const pkg = JSON.parse(fs8.readFileSync(packageJson, "utf8"));
              if (pkg.main) {
                const mainFile = path7.join(effectiveFsPath, pkg.main);
                if (fs8.existsSync(mainFile)) {
                  effectiveFsPath = mainFile;
                  found = true;
                }
              }
            } catch (e) {
            }
          }
        }
        if (!found) {
          for (const ext2 of indexExtensions) {
            const moduleFile = path7.join(effectiveFsPath, `module${ext2}`);
            if (fs8.existsSync(moduleFile)) {
              effectiveFsPath = moduleFile;
              found = true;
              break;
            }
          }
        }
        if (!found) {
          if (isHtmlNavigationRequest(req, reqPath, q, spaFallback) && spaFallback.entryFilePath) {
            effectiveFsPath = spaFallback.entryFilePath;
            isPublicFile = false;
          } else {
            res.statusCode = 404;
            res.end("Module not found");
            return;
          }
        }
      }
      if (!fs8.existsSync(effectiveFsPath)) {
        if (isHtmlNavigationRequest(req, reqPath, q, spaFallback) && spaFallback.entryFilePath) {
          effectiveFsPath = spaFallback.entryFilePath;
          isPublicFile = false;
        } else {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
      }
      if (!fs8.existsSync(effectiveFsPath)) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      const ext = path7.extname(effectiveFsPath);
      if (isPublicFile && !isAssetExt(ext)) {
        try {
          watcher.watchFile(effectiveFsPath);
        } catch {
        }
        res.writeHead(200, { "Content-Type": guessContentType(effectiveFsPath) });
        fs8.createReadStream(effectiveFsPath).pipe(res);
        return;
      }
      if (isAssetExt(ext)) {
        try {
          const data = fs8.readFileSync(effectiveFsPath);
          const assetHash = crypto2.createHash("sha256").update(data).digest("hex");
          const kind = "asset";
          const changed2 = graph.recordFile(effectiveFsPath, assetHash, [], [], kind);
          watcher.watchFile(effectiveFsPath);
          if (changed2) {
            logInfo(`[Graph] Asset updated: ${effectiveFsPath}`);
          }
        } catch {
        }
        if ("import" in q) {
          const urlPath = isPublicFile ? effectiveUrlPath : normalizeUrlFromFs(rootDir, effectiveFsPath);
          const js = assetAsModule(urlPath);
          res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
          res.end(js);
          return;
        } else {
          res.writeHead(200, { "Content-Type": contentTypeForAsset(ext) });
          fs8.createReadStream(effectiveFsPath).pipe(res);
          return;
        }
      }
      if (isCssLikeExt(ext)) {
        try {
          const cssSource = fs8.readFileSync(effectiveFsPath, "utf8");
          const isModule = "module" in q || isCssModuleLikePath(effectiveFsPath);
          const mode2 = "raw" in q ? "css:raw-string" : "url" in q ? "css:url" : isModule ? "css:module" : "inline" in q ? "css:inline" : "css:raw";
          const contentHash = getCacheKey(cssSource);
          const baseCssDir = getCasArtifactPath(casRoot, configHash, contentHash);
          const baseCssFile = path7.join(baseCssDir, "transformed.css");
          const baseCssMetaFile = path7.join(baseCssDir, "meta.json");
          watcher.watchFile(effectiveFsPath);
          const kind = "css";
          registerDevCssGraphSources();
          const baseCssMeta = readJsonFile3(baseCssMetaFile);
          const baseCssMetaCurrent = devCssMetaIsCurrent(baseCssMeta, contentHash, isModule, rootDir);
          const prevDeps = graph.getNode(effectiveFsPath)?.deps ?? [];
          graph.recordStructuralFiles(prevDeps);
          scheduleDependencyWatches(prevDeps);
          const depsStampHash = computeDepsStampHash(prevDeps);
          let artifactHash = getCacheKey(
            `css:v3:${effectiveFsPath}:${contentHash}:${mode2}:${depsStampHash}:${metaTailwindStampForRecipe(baseCssMeta)}`
          );
          let casDir = getCasArtifactPath(casRoot, configHash, artifactHash);
          const jsMode = mode2 !== "css:raw";
          let casFile = path7.join(casDir, jsMode ? "transformed.js" : "transformed.css");
          let finalBuffer = null;
          if (fs8.existsSync(casFile)) {
            try {
              finalBuffer = fs8.readFileSync(casFile);
              const ok = jsMode ? looksLikeIonifyCssJsModule(finalBuffer) : !looksLikeIonifyCssJsModule(finalBuffer);
              if (ok) {
                if (baseCssMetaCurrent) {
                  res.setHeader("X-Ionify-Cache", "HIT");
                } else {
                  finalBuffer = null;
                  res.setHeader("X-Ionify-Cache", "STALE");
                }
              } else {
                finalBuffer = null;
                res.setHeader("X-Ionify-Cache", "MISMATCH");
              }
            } catch {
              finalBuffer = null;
            }
          }
          if (finalBuffer && !fs8.existsSync(baseCssFile)) {
            try {
              registerDevCssGraphSources();
              const { css: compiledCss, tokens, deps, urlDeps, pipelineHash, tailwindGraphContent } = await compileCss({
                code: cssSource,
                filePath: effectiveFsPath,
                rootDir,
                modules: isModule,
                preprocessorOptions: userConfig?.css?.preprocessorOptions,
                // R1 (Completeness law): dev's live graph is request-shaped and
                // cannot be proven complete for the first document, so Tailwind
                // content must fail closed to the config globs — never narrow.
                tailwindContentAuthority: { mode: "config-globs" }
              });
              const depsAbs = deps.map((d) => d.filePath).filter(Boolean);
              const urlDepsAbs = urlDeps.map((d) => d.filePath).filter(Boolean);
              const allDepsAbs = [...depsAbs, ...urlDepsAbs];
              graph.recordStructuralFiles(allDepsAbs);
              const changed2 = graph.recordFile(effectiveFsPath, contentHash, allDepsAbs, [], kind);
              if (changed2) {
                logInfo(`[Graph] CSS updated: ${effectiveFsPath}`);
              }
              scheduleDependencyWatches(allDepsAbs);
              fs8.mkdirSync(baseCssDir, { recursive: true });
              const tmp = `${baseCssFile}.tmp-${process.pid}-${Date.now()}`;
              fs8.writeFileSync(tmp, compiledCss, "utf8");
              fs8.renameSync(tmp, baseCssFile);
              writeJsonFile3(baseCssMetaFile, buildDevCssMeta({
                contentHash,
                pipelineHash,
                depsAbs,
                urlDepsAbs,
                modules: isModule,
                tailwindGraphContent
              }));
              if (isModule && tokens) {
                const tokPath = path7.join(baseCssDir, "tokens.json");
                if (!fs8.existsSync(tokPath)) writeJsonFile3(tokPath, tokens);
              }
            } catch {
            }
          }
          if (!finalBuffer) {
            let body;
            if (mode2 === "css:url") {
              const rawUrl = `${effectiveUrlPath}?v=${contentHash}-${depsStampHash.slice(0, 8)}`;
              body = renderCssUrlModule(rawUrl);
              if (!fs8.existsSync(baseCssFile) || !baseCssMetaCurrent) {
                try {
                  registerDevCssGraphSources();
                  const { css: compiledCss, tokens, deps, urlDeps, pipelineHash, tailwindGraphContent } = await compileCss({
                    code: cssSource,
                    filePath: effectiveFsPath,
                    rootDir,
                    modules: isModule,
                    preprocessorOptions: userConfig?.css?.preprocessorOptions,
                    // R1 (Completeness law): dev fails closed to config globs.
                    tailwindContentAuthority: { mode: "config-globs" }
                  });
                  const depsAbs = deps.map((d) => d.filePath).filter(Boolean);
                  const urlDepsAbs = urlDeps.map((d) => d.filePath).filter(Boolean);
                  const allDepsAbs = [...depsAbs, ...urlDepsAbs];
                  body = renderCssUrlModule(`${effectiveUrlPath}?v=${contentHash}-${computeDepsStampHash(allDepsAbs).slice(0, 8)}`);
                  graph.recordStructuralFiles(allDepsAbs);
                  const changed2 = graph.recordFile(effectiveFsPath, contentHash, allDepsAbs, [], kind);
                  if (changed2) {
                    logInfo(`[Graph] CSS updated: ${effectiveFsPath}`);
                  }
                  scheduleDependencyWatches(allDepsAbs);
                  fs8.mkdirSync(baseCssDir, { recursive: true });
                  const tmp = `${baseCssFile}.tmp-${process.pid}-${Date.now()}`;
                  fs8.writeFileSync(tmp, compiledCss, "utf8");
                  fs8.renameSync(tmp, baseCssFile);
                  writeJsonFile3(baseCssMetaFile, buildDevCssMeta({
                    contentHash,
                    pipelineHash,
                    depsAbs,
                    urlDepsAbs,
                    modules: isModule,
                    tailwindGraphContent
                  }));
                  if (isModule && tokens) {
                    const tokPath = path7.join(baseCssDir, "tokens.json");
                    if (!fs8.existsSync(tokPath)) writeJsonFile3(tokPath, tokens);
                  }
                } catch {
                }
              }
            } else {
              registerDevCssGraphSources();
              const { css: compiledCss, tokens, deps, urlDeps, pipelineHash, tailwindGraphContent } = await compileCss({
                code: cssSource,
                filePath: effectiveFsPath,
                rootDir,
                modules: isModule,
                preprocessorOptions: userConfig?.css?.preprocessorOptions,
                // R1 (Completeness law): dev's live graph is request-shaped and
                // cannot be proven complete for the first document, so Tailwind
                // content must fail closed to the config globs — never narrow.
                tailwindContentAuthority: { mode: "config-globs" }
              });
              const servedCss = rewriteCssUrls(
                rewriteCssImportSpecifiers(
                  compiledCss,
                  effectiveFsPath,
                  rootDir,
                  moduleResolver
                ),
                effectiveFsPath,
                rootDir,
                // Dev serve-time url() rebasing (CSS Option 2) — map each local url() asset to its
                // dev-served public path so `@/`-alias + bare-package url()s resolve (relative ones
                // already would). Mirrors the build emit-time rebasing via the shared resolver, so
                // the phase-neutral CAS `transformed.css` stays untouched.
                (abs) => isForbiddenFsPath(abs) || !fs8.existsSync(abs) ? null : normalizeUrlFromFs(rootDir, abs)
              );
              const depsAbs = deps.map((d) => d.filePath).filter(Boolean);
              const urlDepsAbs = urlDeps.map((d) => d.filePath).filter(Boolean);
              const allDepsAbs = [...depsAbs, ...urlDepsAbs];
              const nextDepsStampHash = computeDepsStampHash(allDepsAbs);
              artifactHash = getCacheKey(
                `css:v3:${effectiveFsPath}:${contentHash}:${mode2}:${nextDepsStampHash}:${compileTailwindStampForRecipe(tailwindGraphContent)}`
              );
              casDir = getCasArtifactPath(casRoot, configHash, artifactHash);
              casFile = path7.join(casDir, jsMode ? "transformed.js" : "transformed.css");
              graph.recordStructuralFiles(allDepsAbs);
              const changed2 = graph.recordFile(effectiveFsPath, contentHash, allDepsAbs, [], kind);
              if (changed2) {
                logInfo(`[Graph] CSS updated: ${effectiveFsPath}`);
              }
              scheduleDependencyWatches(allDepsAbs);
              try {
                const alreadyExists = fs8.existsSync(baseCssFile) && baseCssMetaCurrent;
                if (!alreadyExists) {
                  fs8.mkdirSync(baseCssDir, { recursive: true });
                  const tmp = `${baseCssFile}.tmp-${process.pid}-${Date.now()}`;
                  fs8.writeFileSync(tmp, compiledCss, "utf8");
                  fs8.renameSync(tmp, baseCssFile);
                }
                writeJsonFile3(baseCssMetaFile, buildDevCssMeta({
                  contentHash,
                  pipelineHash,
                  depsAbs,
                  urlDepsAbs,
                  modules: isModule,
                  tailwindGraphContent
                }));
                if (isModule && tokens) {
                  const tokPath = path7.join(baseCssDir, "tokens.json");
                  if (!fs8.existsSync(tokPath)) writeJsonFile3(tokPath, tokens);
                }
              } catch {
              }
              if (mode2 === "css:raw") {
                body = servedCss;
              } else if (mode2 === "css:raw-string") {
                body = renderCssRawStringModule(servedCss);
              } else {
                body = renderCssModule({
                  css: servedCss,
                  filePath: effectiveFsPath,
                  tokens: isModule ? tokens ?? {} : void 0
                });
              }
            }
            finalBuffer = Buffer.from(body, "utf8");
            res.setHeader("X-Ionify-Cache", "MISS");
            try {
              fs8.mkdirSync(casDir, { recursive: true });
              fs8.writeFileSync(casFile, finalBuffer);
            } catch {
            }
          }
          const etag = `W/"css-${configHash}-${artifactHash}-${mode2}"`;
          if (jsMode) {
            sendBuffer(req, res, 200, "application/javascript; charset=utf-8", finalBuffer, {
              etag,
              cacheControl: "no-cache"
            });
          } else {
            sendBuffer(req, res, 200, "text/css; charset=utf-8", finalBuffer, {
              etag,
              cacheControl: "no-cache"
            });
          }
          logInfo(`Served: ${effectiveUrlPath} ${mode2}`);
          return;
        } catch (err) {
          logError("Failed to process CSS", err);
          hmr.broadcastError({
            message: err instanceof Error ? `Failed to process CSS: ${err.stack || err.message}` : `Failed to process CSS: ${String(err)}`
          });
          res.statusCode = 500;
          res.end("Failed to process CSS");
          return;
        }
      }
      const code = fs8.readFileSync(effectiveFsPath, "utf8");
      let hash;
      let specs;
      if (native?.parseModuleIr) {
        try {
          const ir = native.parseModuleIr(effectiveFsPath, code);
          hash = ir.hash;
          specs = ir.dependencies.map((dep) => dep.specifier);
        } catch {
          hash = getCacheKey(code);
          specs = extractImports(code, effectiveFsPath);
        }
      } else {
        hash = getCacheKey(code);
        specs = extractImports(code, effectiveFsPath);
      }
      const { localDeps, externalDeps } = classifyImportSpecifiersForGraph(
        specs,
        effectiveFsPath,
        configuredExternalSpecifiers
      );
      const nextDeps = rewriteFederationGraphEdgeIds(
        [...localDeps, ...externalDeps],
        federationRemoteBindings
      );
      enqueueLocalGraphCompletion(localDeps);
      const changed = graph.recordFile(effectiveFsPath, hash, nextDeps);
      if (!watcher.isWatched(effectiveFsPath)) {
        watcher.watchFile(effectiveFsPath);
      }
      scheduleDependencyWatches(localDeps);
      let result;
      try {
        result = await transformer.run({
          path: effectiveFsPath,
          code,
          ext,
          moduleHash: computeTransformHash(hash),
          config: userConfig ?? null
        });
      } catch (err) {
        const message = err instanceof Error ? err.stack || err.message : String(err);
        hmr.broadcastError({ message: `Failed to transform ${effectiveUrlPath}: ${message}` });
        throw err;
      }
      scheduleBaseCasTransform({
        filePath: effectiveFsPath,
        ext,
        code,
        baseHash: hash
      });
      const runtimeGraph = resolveTransformedRuntimeGraphDeps(
        result.runtimeDependencies,
        effectiveFsPath,
        nextDeps
      );
      graph.recordFile(
        effectiveFsPath,
        hash,
        runtimeGraph.deps,
        runtimeGraph.dynamicDeps
      );
      const transformedCode = result.code;
      res.setHeader("X-Ionify-Cache", changed ? "MISS" : "HIT");
      const withDefine = applyDefineReplacements(transformedCode, defineConfig);
      const envApplied = applyEnvPlaceholders(withDefine, ext);
      if (path7.extname(effectiveFsPath) === ".html") {
        activateFeaturePacksOnNextDocument();
        const documentRouteKey = normalizeDocumentRouteKey(reqPath);
        routeHints.beginDocument({
          routeKey: documentRouteKey,
          documentUrl: requestUrlWithQuery,
          clientKey: routeHintClientKey,
          observedAtMs: routeHintObservedAtMs
        });
        scheduleProductionArtifactPublication(`document:${documentRouteKey}`);
        const currentStartupPolicySnapshot = startupPolicyEnabled ? refreshStartupPolicySnapshot() : null;
        let htmlOut = envApplied;
        const preloadUrl = (hintUrl) => {
          if (!hintUrl) return;
          htmlOut = injectModulePreload(htmlOut, hintUrl);
        };
        if (startupPolicyEnabled) {
          htmlOut = injectInlineScript(htmlOut, buildStartupPolicyClientScript(documentRouteKey));
        }
        const routeAwarePreloads = /* @__PURE__ */ new Set();
        const startupPolicyPreloads = startupPolicyPreloadAuthorityEnabled ? selectStartupPolicyPreloads(currentStartupPolicySnapshot, documentRouteKey) : [];
        const preloadHints = startupPolicyPreloads.length > 0 ? startupPolicyPreloads : routeHints.selectPreloads(documentRouteKey, {
          maxEntries: 24,
          maxDepEntries: 8,
          maxSourceEntries: 16,
          minRequestCount: 1
        });
        for (const hint of preloadHints) {
          if (!isRouteHintPreloadValid(hint.url, hint.kind)) continue;
          for (const preloadUrlCandidate of expandRouteHintPreloadUrls(hint.url, hint.kind)) {
            routeAwarePreloads.add(preloadUrlCandidate);
          }
        }
        if (routeAwarePreloads.size > 0) {
          for (const routePreload of routeAwarePreloads) {
            preloadUrl(routePreload);
          }
          logInfo(
            startupPolicyPreloads.length > 0 ? `[phase23] Startup policy ${documentRouteKey}: modulepreload=${routeAwarePreloads.size}` : `[phase22] Route hints ${documentRouteKey}: modulepreload=${routeAwarePreloads.size}`
          );
        } else {
          const preloadDepsUrl = (hintUrl) => {
            const fileName = depsFileNameFromRuntimeUrl(hintUrl);
            if (!fileName) return;
            if (!fs8.existsSync(path7.join(depsRoot, fileName))) return;
            preloadUrl(depsRuntimeUrl2(fileName));
          };
          const packPreloads = new Set(collectBootstrapRoutedPackPreloadUrls());
          const packFilesForVendorDeps = /* @__PURE__ */ new Set();
          if (vendorPacksEnabled) {
            for (const dep of vendorDeps) {
              const packFileName = vendorPackV2.fileNameToPackFile.get(dep.fileName) ?? null;
              if (!packFileName) continue;
              if (!fs8.existsSync(path7.join(depsRoot, packFileName))) continue;
              packFilesForVendorDeps.add(packFileName);
              const chunkFiles = vendorPackV2.packFileToChunkFiles.get(packFileName) ?? (() => {
                const shared = vendorPackV2.packFileToSharedFile.get(packFileName) ?? null;
                return shared ? [shared] : [];
              })();
              if (chunkFiles.length === 0) continue;
              for (const chunkFile of chunkFiles) {
                if (typeof chunkFile !== "string" || !chunkFile.endsWith(".js")) continue;
                if (!fs8.existsSync(path7.join(depsRoot, chunkFile))) continue;
                packPreloads.add(depsRuntimeUrl2(chunkFile));
              }
            }
          }
          if (packFilesForVendorDeps.size > 0) {
            for (const depsUrl of Array.from(packPreloads).sort()) preloadDepsUrl(depsUrl);
            for (const packFileName of Array.from(packFilesForVendorDeps).sort()) {
              preloadDepsUrl(depsRuntimeUrl2(packFileName));
            }
          } else if (packPreloads.size > 0) {
            const sharedPreload = vendorPackSharedUrl || vendorCoreSharedUrl;
            if (sharedPreload) preloadDepsUrl(sharedPreload);
            for (const depsUrl of Array.from(packPreloads).sort()) preloadDepsUrl(depsUrl);
          } else {
            ensureVendorPackFile();
            const sharedPreload = vendorPackSharedUrl || vendorCoreSharedUrl;
            if (sharedPreload) preloadDepsUrl(sharedPreload);
            const vendorPackUrl = getVendorPackUrl();
            if (vendorPackUrl) preloadUrl(vendorPackUrl);
          }
        }
        const injected = injectHMRClient(htmlOut);
        const htmlBuffer = Buffer.from(injected, "utf8");
        const etag = weakEtagFromContent(`html-${configHash}`, htmlBuffer);
        sendBuffer(req, res, 200, "text/html; charset=utf-8", htmlBuffer, {
          etag,
          cacheControl: "no-cache"
        });
      } else {
        routeHints.noteRequest({
          url: requestUrlWithQuery,
          kind: "source",
          refererUrl: routeHintReferer,
          clientKey: routeHintClientKey,
          observedAtMs: routeHintObservedAtMs
        });
        const startupInstrumented = guessContentType(effectiveFsPath).startsWith("application/javascript") ? startupInstrumentJavaScriptCode(envApplied) : envApplied;
        const finalBuffer = Buffer.from(startupInstrumented);
        const etag = weakEtagFromContent(`mod-${configHash}`, finalBuffer);
        sendBuffer(req, res, 200, guessContentType(effectiveFsPath), finalBuffer, {
          etag,
          cacheControl: "no-cache"
        });
      }
      logInfo(`Served: ${effectiveUrlPath} deps:${nextDeps.length} ${changed ? "(updated)" : "(cached)"}`);
      if (cacheDebug) {
        const m = transformCache.metrics();
        logInfo(`[Ionify][Dev Cache] hits:${m.hits} misses:${m.misses} size:${m.size}`);
      }
    } catch (err) {
      logError("Error serving request:", err);
      res.statusCode = 500;
      res.end("Internal Server Error");
    } finally {
      activeRequests = Math.max(activeRequests - 1, 0);
    }
  };
  const server = httpsOptions ? https.createServer(httpsOptions, requestHandler) : http.createServer(requestHandler);
  const dependencyEnvironmentPaths = new Set(
    dependencyEnvironmentWatchPaths(workspace.workspaceRoot, rootDir)
  );
  const clearGenerationTimers = (timers) => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };
  const dependencySubsystemBusy = () => activeRequests > 0 || depUsageScanRunning || manualSlimBuildRunning || manualBuildRunning || featureBuildRunning || featureSlimBuildRunning;
  const activateDependencyGeneration = async (snapshot, reasons) => {
    if (shuttingDown) return;
    if (dependencySubsystemBusy()) {
      dependencyEnvironmentSettler.notify("await-dependency-quiescence");
      return;
    }
    const nextDepsHash = computeDepsHash(configHash, snapshot.lockfile, {
      nodeEnv: depsNodeEnv,
      sourcemap: depsSourcemapEnabled,
      bundleEsm: depsBundleEsmEnabled,
      sharedChunks: depsSharedChunksMode,
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION
    });
    const previousDepsHash = depsHash;
    const previousDepsRoot = depsRoot;
    papContractsPublished = false;
    papArtifactsPublished = false;
    papDirty = true;
    cancelProductionArtifactsPublication("dependency-environment");
    if (nextDepsHash !== previousDepsHash) {
      const nextDepsRoot = path7.join(ionifyDir, "deps", nextDepsHash);
      fs8.mkdirSync(nextDepsRoot, { recursive: true });
      let promoted = 0;
      let skipped = 0;
      if (native?.depsPromoteArtifacts && fs8.existsSync(path7.join(previousDepsRoot, "manifest.json"))) {
        try {
          const result = native.depsPromoteArtifacts(
            previousDepsRoot,
            nextDepsRoot,
            nextDepsHash,
            DEPS_OPTIMIZER_OUTPUT_VERSION
          );
          promoted = result.promoted;
          skipped = result.skipped;
        } catch (error) {
          logWarn(`[deps] DPL generation promotion failed closed: ${String(error)}`);
        }
      }
      if (devStableTimer) clearTimeout(devStableTimer);
      devStableTimer = null;
      devStableServedCount = 0;
      depsHash = nextDepsHash;
      depsRoot = nextDepsRoot;
      process.env.IONIFY_DEPS_HASH = nextDepsHash;
      pruneDepsCache(ionifyDir, nextDepsHash);
      refreshDepsManifestIndex();
      directDepUsageFileNames.clear();
      loadDirectDepUsageFileNamesFromDisk();
      depUsageIndex = packSlimmingEnabled ? loadDepUsageIndexFromDisk() : null;
      setDirectDepUsageFileNames(depUsageIndex);
      vendorPackLastRequestCounts = vendorPacksEnabled ? loadDepRequestCounts(vendorPackRequestsPath()) : /* @__PURE__ */ new Map();
      vendorPackSessionRequestCounts?.clear();
      vendorPackRequestCountsDirty = false;
      vendorPackRequestCountsLastFlush = 0;
      clearGenerationTimers(manualSlimBuildTimers);
      clearGenerationTimers(manualBuildTimers);
      clearGenerationTimers(featureBuildTimers);
      clearGenerationTimers(featureSlimBuildTimers);
      manualSlimBuildQueue.length = 0;
      manualBuildQueue.length = 0;
      featureBuildQueue.length = 0;
      featureSlimBuildQueue.length = 0;
      manualState.clear();
      manualSlimState.clear();
      for (const entries of manualObserved.values()) entries.clear();
      featureObserved.clear();
      featureState.clear();
      featureLastReadyState.clear();
      featureSlimState.clear();
      featureLastReadySlimState.clear();
      featurePackFileNameToChunkGroup.clear();
      plannedFeatureGroups.clear();
      featurePackActivationPending = false;
      vendorPackV2 = new VendorPackV2IndexManager({
        depsRoot,
        depsHash,
        outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
        allowPackFilePrefix: vendorPackV2AllowedPrefix,
        log: { info: logInfo, warn: logWarn }
      });
      vendorPackV2.loadFromDisk();
      loadFeaturePackIndex();
      featurePackRoutingHashCache = null;
      vendorPackV2RoutingHashCache = null;
      for (const depFile of graph.listFilesByKind("dep")) {
        graph.removeFile(depFile);
      }
      graph.flush();
      bumpDevStable();
      logInfo(
        `[deps] DPL generation activated ${previousDepsHash} -> ${nextDepsHash} (promoted=${promoted}, reoptimize=${skipped}, reasons=${reasons.join(",") || "unknown"})`
      );
    } else {
      refreshDepsManifestIndex();
      logInfo(
        `[deps] Dependency environment converged without store rotation (depsHash=${depsHash}, reasons=${reasons.join(",") || "unknown"})`
      );
    }
    hmr.broadcastEvent("dependency-generation", {
      previous: previousDepsHash,
      current: depsHash
    });
    dependencyEnvironmentReconciling = false;
    scheduleProductionArtifactPublication("dependency-generation", "contracts");
  };
  const dependencyEnvironmentSettler = new DependencyEnvironmentSettler({
    workspaceRoot: workspace.workspaceRoot,
    projectRoot: rootDir,
    settleMs: 250,
    onStable: activateDependencyGeneration,
    onInvalid: (reason) => {
      logWarn(`[deps] Dependency environment is not stable; retaining ${depsHash}: ${reason}`);
    }
  });
  for (const dependencyEnvironmentPath of dependencyEnvironmentPaths) {
    watcher.watchFile(dependencyEnvironmentPath, { allowMissing: true });
  }
  watcher.on("change", (file, status) => {
    logInfo(`[Watcher] ${status}: ${file}`);
    if (dependencyEnvironmentPaths.has(path7.resolve(file))) {
      dependencyEnvironmentReconciling = true;
      papContractsPublished = false;
      papArtifactsPublished = false;
      papDirty = true;
      cancelProductionArtifactsPublication(`dependency:${status}`);
      dependencyEnvironmentSettler.notify(`${status}:${path7.basename(file)}`);
      return;
    }
    papContractsPublished = false;
    papArtifactsPublished = false;
    papDirty = true;
    cancelProductionArtifactsPublication(`watch:${status}`);
    scheduleProductionArtifactPublication(`watch:${status}`, "contracts");
    const ext = path7.extname(file).toLowerCase();
    const isReactFastRefreshBoundary = status !== "deleted" && (ext === ".tsx" || ext === ".jsx");
    const isCssBoundary = status !== "deleted" && isCssLikeExt(ext);
    const collected = graph.collectAffected([file]);
    const affected = isReactFastRefreshBoundary || isCssBoundary ? [
      file,
      ...collected.filter(
        (absPath) => absPath !== file && isCssLikePath(absPath)
      )
    ] : collected;
    if (!affected.includes(file)) {
      affected.unshift(file);
    }
    const modules = [];
    for (const absPath of affected) {
      const reason = absPath === file ? status === "deleted" ? "deleted" : "changed" : "dependent";
      let hash = null;
      if (reason !== "deleted") {
        if (absPath === file) {
          try {
            const code = fs8.readFileSync(absPath, "utf8");
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
        url: isCssLikePath(absPath) ? `${normalizeUrlFromFs(rootDir, absPath)}?inline` : isAssetExt(path7.extname(absPath).toLowerCase()) ? `${normalizeUrlFromFs(rootDir, absPath)}?import` : normalizeUrlFromFs(rootDir, absPath),
        hash,
        reason
      });
    }
    const summary = hmr.queueUpdate(modules);
    if (summary) {
      logInfo(
        `[HMR] update ${summary.id} -> ${summary.modules.length} module(s) queued`
      );
    }
    if (status === "deleted") {
      graph.removeFile(file);
      watcher.unwatchFile(file);
    }
  });
  let closingPromise = null;
  let cleanedUp = false;
  let shutdownPrepared = false;
  const signalHandlers = [];
  const prepareShutdown = () => {
    if (shutdownPrepared) return;
    shutdownPrepared = true;
    shuttingDown = true;
    pendingWatchedDeps.clear();
    pendingWatchFlush = false;
    dependencyEnvironmentSettler.close();
    try {
      hmr.close();
    } catch (err) {
      logError("Error closing HMR:", err);
    }
    if (typeof server.closeIdleConnections === "function") {
      try {
        server.closeIdleConnections();
      } catch (err) {
        logError("Error closing idle HTTP connections:", err);
      }
    }
  };
  const cleanup = (force = false) => {
    if (cleanedUp) return;
    cleanedUp = true;
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
    routeHints.flush();
    graph.flush();
    for (const { event, handler } of signalHandlers) {
      process.off(event, handler);
    }
  };
  server.on("close", () => cleanup(false));
  const shutdown = async (exitProcess) => {
    flushVendorPackRequestCounts(true);
    prepareShutdown();
    await drainPendingGraphCompletion();
    if (!closingPromise) {
      closingPromise = new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          logInfo("Server shutdown taking too long, forcing cleanup...");
          cleanup(true);
          resolve();
        }, 3e3);
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
        new Promise(
          (_, reject) => setTimeout(() => reject(new Error("Shutdown timeout")), 5e3)
        )
      ]);
    } catch (err) {
      logError("Shutdown error:", err);
      cleanup(true);
    }
    try {
      const pending = Array.from(pendingBaseCas.values());
      if (pending.length > 0) {
        await Promise.allSettled(pending);
      }
    } catch {
    }
    if (baseCasPool) {
      try {
        await baseCasPool.drain();
      } catch {
      }
      try {
        await baseCasPool.close();
      } catch {
      }
      baseCasPool = null;
    }
    if (exitProcess) {
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
  await new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once("error", onError);
    server.listen(resolvedPort, resolvedHost, () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  const actualPort = address && typeof address === "object" && address?.port ? address.port : resolvedPort;
  logInfo(`Ionify Dev Server (Phase 2) at ${protocol}://localhost:${actualPort}`);
  logInfo(`Ready in ${Date.now() - bootStartMs}ms`);
  logInfo(`HMR listening at /__ionify_hmr (SSE)`);
  bumpDevStable();
  const prewarmLabel = vendorPacksForce ? "vendor pack" : vendorPacksProgressive || vendorPacksManual ? "vendor core" : "vendor deps";
  const prewarmEntries = vendorPacksForce ? vendorPackEntries : vendorDeps;
  if (prewarmEntries.length > 0) {
    if (vendorPacksForce && vendorPackPlan) {
      logInfo(
        `[deps] Vendor packs enabled (${vendorPacksMode}) members=${vendorPackEntries.length} maxBytes=${vendorPackMaxBytes} maxMembers=${vendorPackMaxMembers}`
      );
    }
    const labels = prewarmEntries.map((d) => d.packageLabel).join(", ");
    logInfo(`[deps] ${prewarmLabel} detected (${prewarmEntries.length}): ${labels}`);
    ensureVendorPackFile();
    const missing = prewarmEntries.filter((d) => !fs8.existsSync(path7.join(depsRoot, d.fileName)));
    const sharedMissing = vendorPacksForce ? vendorPackSharedFileName ? !fs8.existsSync(path7.join(depsRoot, vendorPackSharedFileName)) : false : vendorCoreSharedFileName ? !fs8.existsSync(path7.join(depsRoot, vendorCoreSharedFileName)) : false;
    if (missing.length > 0 || sharedMissing) {
      const entryCount = missing.length;
      logInfo(`[deps] Pre-warming ${prewarmLabel} (${entryCount}) in parallel...`);
      Promise.resolve().then(() => {
        const canChunk = vendorPacksForce ? canChunkVendorPacks : canChunkVendorCore;
        if (canChunk) {
          try {
            const start = Date.now();
            const chunked = native?.optimizeDependenciesChunked;
            if (!chunked) throw new Error("native.optimizeDependenciesChunked is not available");
            const result = chunked(
              prewarmEntries.map((d) => ({ entryPath: d.entryPath, depsHash })),
              ionifyDir
            );
            broadcastPeerDepWarnings(result?.peerDepWarnings ?? result?.peer_dep_warnings);
            const group = result?.chunk_group ?? result?.chunkGroup ?? "unknown";
            const chunks = result?.chunk_files ?? result?.chunkFiles ?? [];
            const elapsed = Date.now() - start;
            logInfo(
              `[deps] \u2713 Prewarmed (shared chunks) group=${group} (${elapsed}ms, chunks=${Array.isArray(chunks) ? chunks.length : 0})`
            );
            refreshDepsManifestIndex();
            return;
          } catch (err) {
            logWarn(`[deps] Prewarm chunked failed (fallback to per-entry): ${String(err)}`);
          }
        }
        if (native?.optimizeDependenciesBatch && !depsSourcemapEnabled && depsBundleEsmEnabled) {
          const results = native.optimizeDependenciesBatch(
            missing.map((d) => ({ entryPath: d.entryPath, depsHash })),
            ionifyDir
          );
          results.forEach((r, idx) => {
            const dep = missing[idx];
            if (r?.error) {
              logWarn(`[deps] Prewarm failed ${dep.packageLabel}: ${r.error}`);
            } else if (r?.out_path || r?.outPath) {
              const outPath = r.out_path ?? r.outPath;
              logInfo(
                `[deps] \u2713 Prewarmed ${dep.packageLabel} \u2192 ${path7.basename(outPath)}`
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
              ionifyDir
            );
            broadcastPeerDepWarnings(result?.peerDepWarnings ?? result?.peer_dep_warnings);
            const outPath = result?.out_path ?? result?.outPath ?? null;
            if (outPath) {
              logInfo(`[deps] \u2713 Prewarmed ${dep.packageLabel} \u2192 ${path7.basename(outPath)}`);
            }
          } catch (err) {
            logWarn(`[deps] Prewarm failed ${dep.packageLabel}: ${String(err)}`);
          }
        }
      }).catch((err) => {
        logWarn(`[deps] Prewarm error: ${err}`);
      });
    }
  }
  if (userConfig?.optimizeDeps?.include && Array.isArray(userConfig.optimizeDeps.include)) {
    const includes = userConfig.optimizeDeps.include;
    if (includes.length > 0) {
      logInfo(`[deps] Pre-warming ${includes.length} dependencies: ${includes.join(", ")}`);
      Promise.all(
        includes.map(async (pkgName) => {
          try {
            if (!native?.resolveModule || !native?.optimizeDependency) {
              logWarn(`[deps] Cannot pre-warm ${pkgName}: native functions not available`);
              return;
            }
            const resolved = native.resolveModule(pkgName, rootDir);
            if (!resolved || !resolved.fsPath && !resolved.fs_path) {
              logWarn(`[deps] Cannot pre-warm ${pkgName}: resolution failed`);
              return;
            }
            const entryPath = resolved.fsPath || resolved.fs_path;
            const result = native.optimizeDependency(
              entryPath,
              depsHash,
              depsSourcemapEnabled,
              depsBundleEsmEnabled,
              ionifyDir
            );
            broadcastPeerDepWarnings(result?.peerDepWarnings ?? result?.peer_dep_warnings);
            if (result?.out_path) {
              const fileName = path7.basename(result.out_path);
              logInfo(`[deps] \u2713 Pre-warmed ${pkgName} \u2192 ${fileName}`);
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
  if (packSlimmingEnabled) {
    const usageEntries = [];
    if (resolvedEntries && resolvedEntries.length > 0) {
      usageEntries.push(...resolvedEntries);
    } else {
      for (const candidate of [
        path7.join(rootDir, "src", "main.tsx"),
        path7.join(rootDir, "src", "main.ts"),
        path7.join(rootDir, "src", "index.tsx"),
        path7.join(rootDir, "src", "index.ts")
      ]) {
        if (fs8.existsSync(candidate)) usageEntries.push(candidate);
      }
    }
    if (!native?.resolveModule) {
      logWarn("[deps] packSlimming enabled but native.resolveModule is unavailable; skipping usage scan.");
    } else if (usageEntries.length === 0) {
      logWarn("[deps] packSlimming enabled but no entry files were detected; skipping usage scan.");
    } else if (!depUsageScanRunning) {
      depUsageScanRunning = true;
      Promise.resolve().then(async () => {
        const start = Date.now();
        if (process.env.DEBUG_DEPS) {
          logInfo(`[deps] Usage scan (Phase 5.5) starting from ${usageEntries.length} entry file(s)...`);
        }
        const index = canonicalizeDepUsageIndex(
          await scanDepUsage({ rootDir, entries: usageEntries, allowedRoots }),
          depsManifestCanonicalFileNames
        );
        depUsageIndex = index;
        setDirectDepUsageFileNames(index);
        saveDepUsageIndexToDisk(index);
        const usageIndexHash = computeUsageIndexHash(index);
        vendorPackV2.setUsageIndexHash(usageIndexHash);
        const elapsed = Date.now() - start;
        let safe = 0;
        for (const item of index.values()) {
          if (item.hasNamespace || item.hasExportStar) continue;
          if (!Array.isArray(item.usedExports) || item.usedExports.length === 0) continue;
          safe += 1;
        }
        const skipped = Math.max(0, index.size - safe);
        if (process.env.DEBUG_DEPS) {
          logInfo(`[deps] Usage scan completed in ${elapsed}ms.`);
        }
        logInfo(`Usage scan complete (safe: ${safe}, skipped: ${skipped})`);
        if (featurePacksEnabled) {
          seedFeatureCandidatesFromUsageIndex(index);
        }
        if (manualPacksEnabled) {
          for (const def of vendorPacksManualDefs) {
            const group = def.group;
            const state = manualState.get(group);
            if (state?.status === "ready") {
              scheduleManualSlimBuild(group);
            }
          }
        }
        if (featurePacksEnabled) {
          for (const group of listFeaturePackGroups()) {
            const state = featureState.get(group);
            if (state?.status === "ready") scheduleFeatureSlimBuild(group);
          }
        }
      }).catch((err) => {
        logWarn(`[deps] WARN: Usage scan failed (Phase 5.5): ${String(err)}`);
      }).finally(() => {
        depUsageScanRunning = false;
      });
    }
  }
  return {
    server,
    port: actualPort,
    close: async () => {
      await shutdown(false);
    }
  };
}

// src/cli/commands/analyze.ts
import fs9 from "fs";
import path8 from "path";
import chalk from "chalk";
var GRAPH_TREE_MAX_DEPTH = 4;
var HEAVY_DEP_SUGGESTION_MIN_BYTES = 50 * 1024;
var HEAVY_DEP_SUGGESTION_MIN_IMPORTERS = 2;
function sectionTitle(label) {
  return chalk.bold.cyan(label);
}
function subSectionTitle(label) {
  return chalk.bold(label);
}
function dimText(value) {
  return chalk.dim(value);
}
function accent(value) {
  return chalk.bold.white(value);
}
function metric(value) {
  return chalk.bold(value);
}
function colorSeverity(severity) {
  switch (severity) {
    case "high":
      return chalk.bold.red("High");
    case "medium":
      return chalk.bold.yellow("Medium");
    case "low":
      return chalk.bold.blue("Low");
  }
}
function colorConfidence(confidence) {
  switch (confidence) {
    case "high":
      return chalk.bold.green("High");
    case "medium":
      return chalk.bold.yellow("Medium");
    case "low":
      return chalk.bold.gray("Low");
  }
}
function colorHealth(level) {
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
function bullet(value) {
  return `  ${chalk.gray("\u2022")} ${value}`;
}
function compareSeverity(a, b) {
  const rank = { high: 3, medium: 2, low: 1 };
  return rank[b] - rank[a];
}
function compareCertainty(a, b) {
  const rank = { high: 3, medium: 2, low: 1 };
  return rank[b] - rank[a];
}
function classifyDuplicateSeverity(versionCount, totalDepArtifacts) {
  if (versionCount >= 3 || totalDepArtifacts >= 6) return "high";
  if (versionCount >= 2) return "medium";
  return "low";
}
function classifyChunkSeverity(totalBytes, shared) {
  if (shared && totalBytes >= 5 * 1024 * 1024) return "high";
  if (!shared && totalBytes >= 2 * 1024 * 1024) return "high";
  if (shared && totalBytes >= 1 * 1024 * 1024) return "medium";
  if (!shared && totalBytes >= 512 * 1024) return "medium";
  return "low";
}
function classifyDependencySeverity(bytes, importerCount, entryRootCount, packed) {
  const reach = Math.max(importerCount, entryRootCount);
  if (!packed && bytes >= 512 * 1024) return "high";
  if (!packed && bytes >= 128 * 1024 && reach >= 2) return "medium";
  if (packed && bytes >= 512 * 1024) return "medium";
  return "low";
}
function resolveAnalyzeEntryFromHtmlInput(htmlInput, rootDir, specifier) {
  if (typeof specifier !== "string" || specifier.length === 0) return null;
  if (/^(?:https?:)?\/\//.test(specifier)) return null;
  const withoutHash = specifier.split("#", 1)[0] ?? specifier;
  const withoutQuery = withoutHash.split("?", 1)[0] ?? withoutHash;
  if (!withoutQuery) return null;
  if (withoutQuery.startsWith("/")) {
    return path8.join(rootDir, withoutQuery);
  }
  return path8.resolve(path8.dirname(htmlInput), withoutQuery);
}
function inferAnalyzeEntriesFromHtml(rootDir) {
  const htmlInput = path8.join(rootDir, "index.html");
  if (!fs9.existsSync(htmlInput)) return [];
  let html = "";
  try {
    html = fs9.readFileSync(htmlInput, "utf8");
  } catch {
    return [];
  }
  const moduleScriptRe = /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi;
  const entries = [];
  const seen = /* @__PURE__ */ new Set();
  for (const match of html.matchAll(moduleScriptRe)) {
    const src = typeof match[1] === "string" ? match[1] : "";
    const resolved = resolveAnalyzeEntryFromHtmlInput(htmlInput, rootDir, src);
    if (!resolved || !fs9.existsSync(resolved) || seen.has(resolved)) continue;
    seen.add(resolved);
    entries.push(resolved);
  }
  return entries;
}
function readJson(filePath) {
  if (!fs9.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs9.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
function statSize(filePath) {
  try {
    return fs9.statSync(filePath).size;
  } catch {
    return null;
  }
}
function normalizeUrlPath(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "";
  const queryIndex = trimmed.indexOf("?");
  const hashIndex = trimmed.indexOf("#");
  let end = trimmed.length;
  if (queryIndex >= 0) end = Math.min(end, queryIndex);
  if (hashIndex >= 0) end = Math.min(end, hashIndex);
  return trimmed.slice(0, end);
}
function getDepFileNameFromUrl(url2) {
  const normalized = normalizeUrlPath(url2);
  if (!normalized.startsWith("/@deps/")) return null;
  const fileName = normalized.slice("/@deps/".length);
  return fileName && fileName.endsWith(".js") ? fileName : null;
}
function resolveRouteSourceAssetPath(projectRoot, url2) {
  const normalized = normalizeUrlPath(url2);
  if (!normalized.startsWith("/")) return null;
  const relative = normalized.slice(1);
  if (!relative) return null;
  return path8.join(projectRoot, relative);
}
function formatBytes(bytes) {
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
function loadVendorPackRoutingIndex(depsRoot, depsHash) {
  const index = readJson(path8.join(depsRoot, "vendor-pack.v2.index.json"));
  if (!index || index.version !== 1 || index.depsHash !== depsHash) return null;
  return index;
}
function getSelectedSurfaces(options) {
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
  const selected = [];
  if (options.graph || options.tree || options.deps) selected.push("graph");
  if (options.build) selected.push("build");
  if (options.packs) selected.push("packs");
  if (options.routes) selected.push("routes");
  if (options.findings) selected.push("findings");
  return selected.length > 0 ? selected : ["graph", "build", "packs", "routes", "findings"];
}
function listDepsRootCandidates(ionifyDir) {
  const depsDir = path8.join(ionifyDir, "deps");
  if (!fs9.existsSync(depsDir)) return [];
  return fs9.readdirSync(depsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
    const depsHash = entry.name;
    const depsRoot = path8.join(depsDir, depsHash);
    const indexPath = path8.join(depsRoot, "vendor-pack.v2.index.json");
    const manifestPath = path8.join(depsRoot, "manifest.json");
    const usagePath = path8.join(depsRoot, "deps-usage.v2.json");
    const legacyUsagePath = path8.join(depsRoot, "deps-usage.v1.json");
    const statPath = fs9.existsSync(indexPath) ? indexPath : depsRoot;
    let mtimeMs = 0;
    try {
      mtimeMs = fs9.statSync(statPath).mtimeMs;
    } catch {
      mtimeMs = 0;
    }
    const completeness = Number(fs9.existsSync(indexPath)) + Number(fs9.existsSync(manifestPath)) + Number(fs9.existsSync(usagePath) || fs9.existsSync(legacyUsagePath));
    return { depsHash, depsRoot, mtimeMs, completeness };
  }).sort((a, b) => b.completeness - a.completeness || b.mtimeMs - a.mtimeMs || a.depsHash.localeCompare(b.depsHash));
}
function selectDepsRoot(ionifyDir, depsHash, envDepsHash) {
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
  return best ? { depsHash: best.depsHash, depsRoot: best.depsRoot, selectionMode: "latest-mtime-fallback" } : null;
}
function computeInboundCounts(nodes) {
  const dependentCounts = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    for (const dep of node.deps) {
      dependentCounts.set(dep, (dependentCounts.get(dep) ?? 0) + 1);
    }
  }
  return dependentCounts;
}
function buildGraphTree(nodesById, roots, limit, maxDepth = GRAPH_TREE_MAX_DEPTH) {
  const childLimit = Math.max(1, limit);
  const visit = (id, depth, stack) => {
    const node = nodesById.get(id);
    const deps = node?.deps ?? [];
    const summary = {
      id,
      depCount: deps.length
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
          cycle: true
        };
      }
      return visit(depId, depth + 1, nextStack);
    });
    if (sortedDeps.length > limitedDeps.length) summary.truncated = true;
    return summary;
  };
  return roots.slice(0, Math.max(1, limit)).map((root) => visit(root, 0, /* @__PURE__ */ new Set()));
}
function computeGraphSummary(nodes, limit = 10, includeTree = false) {
  const modules = nodes.length;
  let edgeCount = 0;
  const dependentCounts = computeInboundCounts(nodes);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    edgeCount += node.deps.length;
  }
  const densest = [...nodes].sort((a, b) => b.deps.length - a.deps.length || a.id.localeCompare(b.id)).slice(0, limit).map((node) => ({ id: node.id, deps: node.deps.length }));
  const mostDepended = [...dependentCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([id, count]) => ({ id, dependents: count }));
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
    tree: includeTree ? buildGraphTree(nodesById, roots, limit) : void 0
  };
}
function readGraphFromDisk(ionifyDir) {
  const file = path8.join(ionifyDir, "graph.json");
  if (!fs9.existsSync(file)) return null;
  try {
    const snapshot = JSON.parse(fs9.readFileSync(file, "utf8"));
    if (snapshot?.version !== 1 || !snapshot?.nodes) return null;
    return Object.entries(snapshot.nodes).map(([id, node]) => ({
      id,
      hash: node.hash ?? null,
      deps: Array.isArray(node.deps) ? node.deps : []
    }));
  } catch (err) {
    logError("Failed to read graph snapshot", err);
    return null;
  }
}
async function loadGraphSnapshot(ionifyDir) {
  if (native?.graphLoad) {
    try {
      const nodes = native.graphLoad();
      if (Array.isArray(nodes)) {
        return nodes.map((node) => ({
          id: node.id,
          hash: node.hash ?? null,
          deps: Array.isArray(node.deps) ? node.deps : []
        }));
      }
    } catch {
    }
  }
  return readGraphFromDisk(ionifyDir);
}
async function resolveAnalyzeWorkspace() {
  const envMode = process.env.IONIFY_MODE ?? process.env.MODE ?? process.env.NODE_ENV ?? "development";
  const config = await loadIonifyConfig(process.cwd(), envMode);
  const projectRootOverride = config?.root ? path8.resolve(config.root) : null;
  const workspace = resolveWorkspace(projectRootOverride ?? process.cwd(), {
    projectRootOverride
  });
  const rootDir = workspace.projectRoot;
  const parserMode = resolveParser(config, { envMode: process.env.IONIFY_PARSER });
  applyParserEnv(parserMode);
  const minifier = resolveMinifier(config, { envVar: process.env.IONIFY_MINIFIER });
  const treeshake = resolveTreeshake(config?.treeshake, {
    envMode: process.env.IONIFY_TREESHAKE,
    includeEnv: process.env.IONIFY_TREESHAKE_INCLUDE,
    excludeEnv: process.env.IONIFY_TREESHAKE_EXCLUDE
  });
  const scopeHoist = resolveScopeHoist(config?.scopeHoist, {
    envMode: process.env.IONIFY_SCOPE_HOIST,
    inlineEnv: process.env.IONIFY_SCOPE_HOIST_INLINE,
    constantEnv: process.env.IONIFY_SCOPE_HOIST_CONST,
    combineEnv: process.env.IONIFY_SCOPE_HOIST_COMBINE
  });
  const configuredEntries = config?.entry ? (Array.isArray(config.entry) ? config.entry : [config.entry]).map((entry) => entry.startsWith("/") ? path8.join(rootDir, entry) : path8.resolve(rootDir, entry)).filter((entry) => typeof entry === "string" && entry.length > 0) : [];
  const entries = configuredEntries.length > 0 ? configuredEntries : inferAnalyzeEntriesFromHtml(rootDir);
  const pluginNames = Array.isArray(config?.plugins) ? config.plugins.map((plugin) => typeof plugin === "string" ? plugin : plugin?.name).filter((name) => typeof name === "string" && name.length > 0) : void 0;
  const configHash = computeGraphVersion({
    parserMode,
    minifier,
    treeshake,
    scopeHoist,
    plugins: pluginNames,
    entry: entries.length > 0 ? entries : null,
    cssOptions: config?.css,
    assetOptions: config?.assets ?? config?.asset,
    runtimeContracts: {
      reactRefreshRuntimeModule: REACT_REFRESH_RUNTIME_MODULE
    }
  });
  process.env.IONIFY_CONFIG_HASH = configHash;
  ensureNativeGraph(path8.join(workspace.ionifyDir, "graph.db"), configHash);
  return workspace;
}
function summarizeBuildOutputs(outDir, limit) {
  const absOutDir = path8.resolve(outDir);
  const manifestPath = path8.join(absOutDir, "manifest.json");
  const statsPath = path8.join(absOutDir, "build.stats.json");
  const manifest = readJson(manifestPath);
  const stats = readJson(statsPath);
  if (!manifest && !stats) return null;
  const chunkEntries = Array.isArray(manifest?.chunks) ? manifest.chunks : [];
  const topFiles = [];
  const files = {
    js: 0,
    css: 0,
    assets: 0,
    maps: 0,
    publicAssets: 0,
    totalTracked: 0
  };
  const bytes = {
    js: 0,
    css: 0,
    assets: 0,
    maps: 0,
    publicAssets: 0,
    totalTracked: 0
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
    const publicAssets = Array.isArray(stats.publicAssets) ? stats.publicAssets : [];
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
      entry: chunkEntries.filter((chunk) => chunk?.entry === true).length,
      shared: chunkEntries.filter((chunk) => chunk?.shared === true).length
    },
    files,
    bytes,
    topFiles: topFiles.slice(0, Math.max(1, limit))
  };
}
function analyzeVendorPacks(depsRoot, depsHash, selectionMode, limit) {
  const index = loadVendorPackRoutingIndex(depsRoot, depsHash);
  if (!index) return null;
  const derivedPackIndexHash = typeof index.outputVersion === "number" ? hashVendorPackV2RoutingIndex(index, depsHash, index.outputVersion) : null;
  const packIndexHash = typeof index.packIndexHash === "string" ? index.packIndexHash : derivedPackIndexHash;
  const usageIndexHash = typeof index.usageIndexHash === "string" ? index.usageIndexHash : null;
  const routing = index.fileNameToPackFile && typeof index.fileNameToPackFile === "object" ? index.fileNameToPackFile : {};
  const packToChunks = index.packFileToChunkFiles && typeof index.packFileToChunkFiles === "object" ? index.packFileToChunkFiles : {};
  const membersByPack = /* @__PURE__ */ new Map();
  for (const [fileName, packFileName] of Object.entries(routing)) {
    if (typeof fileName !== "string" || typeof packFileName !== "string") continue;
    const list = membersByPack.get(packFileName) ?? [];
    list.push(fileName);
    membersByPack.set(packFileName, list);
  }
  const packs = [];
  for (const [packFileName, members] of membersByPack.entries()) {
    const chunkFilesRaw = Array.isArray(packToChunks[packFileName]) ? packToChunks[packFileName] : [];
    const chunkFiles = chunkFilesRaw.filter((v) => typeof v === "string" && v.endsWith(".js"));
    const uniqueChunks = Array.from(new Set(chunkFiles)).sort();
    const requestsPacked = 1 + uniqueChunks.length;
    const requestsUnpacked = members.length;
    const requestsSaved = Math.max(0, requestsUnpacked - requestsPacked);
    const packBytes = statSize(path8.join(depsRoot, packFileName));
    let chunksBytes = 0;
    let chunksKnown = true;
    for (const chunk of uniqueChunks) {
      const b = statSize(path8.join(depsRoot, chunk));
      if (b === null) chunksKnown = false;
      chunksBytes += b ?? 0;
    }
    const bytesPacked = packBytes === null || !chunksKnown ? null : packBytes + chunksBytes;
    let wrappersBytes = 0;
    let wrappersKnown = true;
    for (const fileName of members) {
      const b = statSize(path8.join(depsRoot, fileName));
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
      bytesWrappers
    });
  }
  packs.sort((a, b) => b.requestsSaved - a.requestsSaved || b.members - a.members || a.packFileName.localeCompare(b.packFileName));
  const slimGroups = [];
  const files = fs9.existsSync(depsRoot) ? fs9.readdirSync(depsRoot) : [];
  const stateFiles = files.filter((f) => f.startsWith("vendor-pack.") && f.endsWith(".json"));
  for (const file of stateFiles) {
    if (file.endsWith(".slim.json")) continue;
    const base = readJson(path8.join(depsRoot, file));
    if (!base || base.version !== 1 || base.depsHash !== depsHash) continue;
    const slimFile = file.replace(/\.json$/, ".slim.json");
    const slim = readJson(path8.join(depsRoot, slimFile));
    if (!slim || slim.version !== 1 || slim.depsHash !== depsHash) continue;
    if (base.status !== "ready" || slim.status !== "ready") continue;
    const baseShared = typeof base.sharedFileName === "string" ? base.sharedFileName : null;
    const slimShared = typeof slim.sharedFileName === "string" ? slim.sharedFileName : null;
    const baseBytes = baseShared ? statSize(path8.join(depsRoot, baseShared)) : null;
    const slimBytes = slimShared ? statSize(path8.join(depsRoot, slimShared)) : null;
    const savedBytes = baseBytes !== null && slimBytes !== null && baseBytes > 0 && slimBytes > 0 ? baseBytes - slimBytes : null;
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
    slimGroups: slimGroups.slice(0, Math.max(1, limit))
  };
}
function buildRouteFirstRouteBytes(projectRoot, routeAssets, depsSelection) {
  if (!projectRoot || routeAssets.length === 0) return null;
  let depObservedBytes = 0;
  let sourceObservedBytes = 0;
  let observedAssets = 0;
  let unresolvedAssets = 0;
  for (const asset of routeAssets) {
    let bytes = null;
    if (asset.kind === "dep") {
      const fileName = getDepFileNameFromUrl(asset.url);
      if (fileName && depsSelection) {
        bytes = statSize(path8.join(depsSelection.depsRoot, fileName));
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
    unresolvedAssets
  };
}
function buildRoutePackCoverage(options) {
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
        manifestOwnership: false
      }
    };
  }
  const depUsageIndex = loadDepUsageIndex(depsSelection.depsRoot, depsSelection.depsHash);
  const depsManifestIndex = loadDepsManifestIndex2(depsSelection.depsRoot);
  const routingIndex = loadVendorPackRoutingIndex(depsSelection.depsRoot, depsSelection.depsHash);
  const fileNameToPackFile = routingIndex?.fileNameToPackFile && typeof routingIndex.fileNameToPackFile === "object" ? routingIndex.fileNameToPackFile : {};
  const packFileToChunkFiles = routingIndex?.packFileToChunkFiles && typeof routingIndex.packFileToChunkFiles === "object" ? routingIndex.packFileToChunkFiles : {};
  const routeDepWrappers = depAssets.map((asset) => {
    const fileName = getDepFileNameFromUrl(asset.url);
    if (!fileName) return null;
    if (!depsManifestIndex.has(fileName) && !depUsageIndex?.has(fileName)) return null;
    return { ...asset, fileName };
  }).filter((asset) => !!asset);
  if (routeDepWrappers.length === 0) {
    return {
      packCoverage: {
        totalDepAssets: 0,
        coveredDepAssets: 0,
        uncoveredDepAssets: 0,
        coverageRate: null,
        estimatedCurrentRequests: 0,
        estimatedPackedRequests: 0,
        estimatedRequestsSaved: 0
      },
      uncoveredHotDeps: [],
      signals: {
        routeHints: true,
        depUsage: !!depUsageIndex,
        packRouting: !!routingIndex,
        manifestOwnership: depsManifestIndex.size > 0
      }
    };
  }
  const uniqueCurrentFiles = /* @__PURE__ */ new Set();
  const uniquePackRequests = /* @__PURE__ */ new Set();
  const uncoveredHotDeps = [];
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
    const bytes = manifestEntry?.sizeBytes ?? statSize(path8.join(depsSelection.depsRoot, asset.fileName));
    const packageLabel = manifestEntry?.packageLabel ?? (usageEntry ? `${usageEntry.packageName}@${usageEntry.packageVersion}` : null);
    uncoveredHotDeps.push({
      url: asset.url,
      fileName: asset.fileName,
      packageLabel,
      totalRequestCount: asset.requestCount,
      routeRequestCount: asset.requestCount,
      minDepth: asset.minDepth,
      bytes,
      importers: usageEntry?.importerKeys.length ?? 0,
      entryRoots: usageEntry?.entryRootKeys.length ?? 0
    });
  }
  uncoveredHotDeps.sort(
    (a, b) => b.routeRequestCount - a.routeRequestCount || a.minDepth - b.minDepth || (b.bytes ?? -1) - (a.bytes ?? -1) || a.fileName.localeCompare(b.fileName)
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
      estimatedRequestsSaved: Math.max(0, estimatedCurrentRequests - estimatedPackedRequests)
    },
    uncoveredHotDeps: uncoveredHotDeps.slice(0, Math.max(1, limit)),
    signals: {
      routeHints: true,
      depUsage: !!depUsageIndex,
      packRouting: !!routingIndex,
      manifestOwnership: depsManifestIndex.size > 0
    }
  };
}
function buildRoutePolicyVisibility(options) {
  const { primaryRouteKey, routeAssets, suggestedPreloads, packCoverage, signals, startupPolicy } = options;
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
  const currentEffects = [];
  if (primaryRouteKey && suggestedPreloads.length > 0) {
    currentEffects.push(
      `Route hints currently influence preload selection for ${primaryRouteKey} (${suggestedPreloads.length} candidate${suggestedPreloads.length === 1 ? "" : "s"}).`
    );
  }
  if (packCoverage && packCoverage.totalDepAssets > 0) {
    currentEffects.push(
      `Vendor-pack routing currently covers ${packCoverage.coveredDepAssets}/${packCoverage.totalDepAssets} primary-route dep artifacts.`
    );
    currentEffects.push(
      `Estimated route dep requests drop from ${packCoverage.estimatedCurrentRequests ?? 0} to ${packCoverage.estimatedPackedRequests ?? 0} when current routing applies.`
    );
  }
  if (signals.depUsage) {
    currentEffects.push("Dep-usage evidence is available for route dependency explainability.");
  }
  if (startupPolicy) {
    currentEffects.push(
      `Startup policy snapshot classifies ${startupPolicy.eagerAssets} eager asset${startupPolicy.eagerAssets === 1 ? "" : "s"} for ${startupPolicy.routeKey}.`
    );
  }
  return {
    signals,
    currentEffects,
    entryCriticalEvidence: routeAssets.length > 0 ? {
      criticalAssets,
      deferredAssets,
      criticalRequests,
      deferredRequests
    } : null,
    policyReuse: {
      status: startupPolicy ? "available" : "unavailable",
      reason: startupPolicy ? "Versioned startup-policy snapshot is available for this route." : "Planner-owned history policy hashing is not implemented yet, so reuse vs recompute is not observable."
    },
    startupPolicy,
    missingCapabilities: [
      "Route history currently influences preload/modulepreload selection more strongly than full history-aware chunk membership.",
      startupPolicy ? "Startup policy exists, but source-pack-driven startup closure planning is not implemented yet." : "Entry-critical vs deferred is derived from route-hint minDepth only and is not a planner-owned chunk policy verdict.",
      startupPolicy ? "Policy reuse is visible for startup preload decisions, but build/dev parity is not implemented yet." : "Planner-owned policy reuse reporting is not available until a versioned history policy layer exists."
    ]
  };
}
function summarizeRoutes(routeHintStatePath, limit, options) {
  if (!fs9.existsSync(routeHintStatePath)) return null;
  const raw = readJson(routeHintStatePath);
  if (!raw || raw.version !== 1 || !raw.routes || typeof raw.routes !== "object") return null;
  const index = new RouteHintIndex(routeHintStatePath);
  const primaryRouteKey = index.getPrimaryRouteKey();
  const routeEntries = Object.entries(raw.routes).map(([routeKey, route]) => {
    const assets = route?.assets && typeof route.assets === "object" ? route.assets : {};
    let depAssets = 0;
    let sourceAssets = 0;
    let totalRequests = 0;
    for (const asset of Object.values(assets)) {
      const requestCount = typeof asset?.requestCount === "number" && Number.isFinite(asset.requestCount) ? Math.floor(asset.requestCount) : 0;
      totalRequests += requestCount;
      if (asset?.kind === "dep") depAssets += 1;
      else if (asset?.kind === "source") sourceAssets += 1;
    }
    return {
      routeKey,
      documents: typeof route?.documents === "number" && Number.isFinite(route.documents) ? Math.floor(route.documents) : 0,
      totalAssets: depAssets + sourceAssets,
      depAssets,
      sourceAssets,
      totalRequests
    };
  });
  routeEntries.sort((a, b) => b.documents - a.documents || b.totalRequests - a.totalRequests || a.routeKey.localeCompare(b.routeKey));
  const topDepAssets = index.summarizeAssets("dep").slice(0, Math.max(1, limit)).map((item) => ({
    url: item.url,
    kind: item.kind,
    totalRequestCount: item.totalRequestCount,
    minDepth: item.minDepth,
    routeKeys: item.routeKeys
  }));
  const topSourceAssets = index.summarizeAssets("source").slice(0, Math.max(1, limit)).map((item) => ({
    url: item.url,
    kind: item.kind,
    totalRequestCount: item.totalRequestCount,
    minDepth: item.minDepth,
    routeKeys: item.routeKeys
  }));
  const suggestedPreloads = index.selectPreloads(primaryRouteKey, {
    maxEntries: Math.max(1, limit),
    maxDepEntries: Math.max(1, limit),
    maxSourceEntries: Math.max(1, limit),
    minRequestCount: 1
  });
  const normalizedPrimaryRouteKey = primaryRouteKey ? normalizeDocumentRouteKey(primaryRouteKey) : null;
  const primaryRouteRaw = normalizedPrimaryRouteKey && raw.routes[normalizedPrimaryRouteKey] ? raw.routes[normalizedPrimaryRouteKey] : null;
  const primaryRouteAssets = primaryRouteRaw?.assets && typeof primaryRouteRaw.assets === "object" ? primaryRouteRaw.assets : {};
  const primaryRouteAssetEntries = Object.entries(primaryRouteAssets).map(([url2, asset]) => ({
    url: url2,
    kind: asset?.kind === "dep" ? "dep" : "source",
    requestCount: typeof asset?.requestCount === "number" && Number.isFinite(asset.requestCount) ? Math.floor(asset.requestCount) : 0,
    minDepth: typeof asset?.minDepth === "number" && Number.isFinite(asset.minDepth) && asset.minDepth >= 0 ? Math.floor(asset.minDepth) : 0
  })).filter((asset) => asset.requestCount > 0).sort((a, b) => b.requestCount - a.requestCount || a.minDepth - b.minDepth || a.url.localeCompare(b.url));
  const firstRouteBytes = options?.projectRoot && normalizedPrimaryRouteKey ? buildRouteFirstRouteBytes(options.projectRoot, primaryRouteAssetEntries, options.depsSelection) : null;
  const coverage = buildRoutePackCoverage({
    routeAssets: primaryRouteAssetEntries,
    depsSelection: options?.depsSelection,
    limit
  });
  const startupPolicyStatePath = path8.join(path8.dirname(routeHintStatePath), "startup-policy.v1.json");
  const startupPolicySnapshot = loadStartupPolicySnapshot(startupPolicyStatePath);
  const startupPolicyRoute = normalizedPrimaryRouteKey ? startupPolicySnapshot?.routes?.[normalizedPrimaryRouteKey] ?? null : null;
  const startupPolicy = startupPolicyRoute && normalizedPrimaryRouteKey ? {
    statePath: startupPolicyStatePath,
    routeKey: normalizedPrimaryRouteKey,
    policyHash: startupPolicyRoute.policyHash,
    eagerAssets: startupPolicyRoute.eagerAssets.length,
    entryCritical: startupPolicyRoute.stats.entryCritical,
    sharedLater: startupPolicyRoute.stats.sharedLater,
    routeLazy: startupPolicyRoute.stats.routeLazy,
    background: startupPolicyRoute.stats.background,
    preFcpLoadedModules: startupPolicyRoute.stats.preFcpLoadedModules,
    preFcpEvaluatedModules: startupPolicyRoute.stats.preFcpEvaluatedModules
  } : null;
  const policyVisibility = buildRoutePolicyVisibility({
    primaryRouteKey: normalizedPrimaryRouteKey,
    routeAssets: primaryRouteAssetEntries,
    suggestedPreloads,
    packCoverage: coverage.packCoverage,
    signals: coverage.signals,
    startupPolicy
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
    policyVisibility
  };
}
function uniqueSorted(values) {
  const out = values.filter((value) => typeof value === "string" && value.length > 0).slice().sort();
  return out.filter((value, index) => index === 0 || out[index - 1] !== value);
}
function parsePackageLabel(label) {
  if (typeof label !== "string" || label.length === 0) return null;
  const at = label.lastIndexOf("@");
  if (at <= 0 || at === label.length - 1) return null;
  const packageName = label.slice(0, at);
  const packageVersion = label.slice(at + 1);
  if (!packageName || !packageVersion) return null;
  return { packageName, packageVersion };
}
var packageVersionCache = /* @__PURE__ */ new Map();
function readPackageVersion(packageRoot) {
  const normalizedRoot = path8.resolve(packageRoot);
  if (packageVersionCache.has(normalizedRoot)) {
    return packageVersionCache.get(normalizedRoot) ?? null;
  }
  const manifest = readJson(path8.join(normalizedRoot, "package.json"));
  const version = typeof manifest?.version === "string" && manifest.version.length > 0 ? manifest.version : null;
  packageVersionCache.set(normalizedRoot, version);
  return version;
}
function extractPackageIdentityFromModuleId(moduleId) {
  const fsPath = moduleId.startsWith("ws://") ? moduleId.slice("ws://".length) : moduleId;
  const marker = `${path8.sep}node_modules${path8.sep}`;
  const idx = fsPath.lastIndexOf(marker);
  if (idx < 0) return null;
  const packageRootBase = fsPath.slice(0, idx + marker.length);
  const after = fsPath.slice(idx + marker.length);
  const parts = after.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return null;
  const packageName = parts[0].startsWith("@") && parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
  if (!packageName) return null;
  const pnpmMarker = `${path8.sep}.pnpm${path8.sep}`;
  const pnpmIdx = fsPath.indexOf(pnpmMarker);
  if (pnpmIdx >= 0) {
    const segment = fsPath.slice(pnpmIdx + pnpmMarker.length).split(/[\\/]/, 1)[0] ?? "";
    const encodedName = packageName.replace(/\//g, "+");
    if (segment.startsWith(`${encodedName}@`)) {
      const version2 = segment.slice(encodedName.length + 1).split("_", 1)[0] ?? "";
      if (version2) return { packageName, packageVersion: version2 };
    }
  }
  const packageRoot = parts[0].startsWith("@") && parts.length >= 2 ? path8.join(packageRootBase, parts[0], parts[1]) : path8.join(packageRootBase, parts[0]);
  const version = readPackageVersion(packageRoot);
  return version ? { packageName, packageVersion: version } : null;
}
function loadDepUsageIndex(depsRoot, depsHash) {
  const depUsagePath = path8.join(depsRoot, "deps-usage.v2.json");
  const legacyPath = path8.join(depsRoot, "deps-usage.v1.json");
  const raw = readJson(depUsagePath) ?? readJson(legacyPath);
  if (!raw || raw.version !== 1 && raw.version !== 2 || raw.depsHash !== depsHash) return null;
  const entries = raw.deps && typeof raw.deps === "object" ? raw.deps : {};
  const out = /* @__PURE__ */ new Map();
  for (const [fileName, item] of Object.entries(entries)) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.entryPath !== "string" || typeof item.packageName !== "string") continue;
    if (typeof item.packageVersion !== "string" || !Array.isArray(item.usedExports)) continue;
    out.set(fileName, {
      fileName,
      entryPath: item.entryPath,
      packageName: item.packageName,
      packageVersion: item.packageVersion,
      usedExports: uniqueSorted(item.usedExports.filter((value) => typeof value === "string")),
      hasNamespace: item.hasNamespace === true,
      hasExportStar: item.hasExportStar === true,
      importerKeys: uniqueSorted(Array.isArray(item.importerKeys) ? item.importerKeys.filter((value) => typeof value === "string") : []),
      entryRootKeys: uniqueSorted(Array.isArray(item.entryRootKeys) ? item.entryRootKeys.filter((value) => typeof value === "string") : [])
    });
  }
  return out;
}
function loadDepsManifestIndex2(depsRoot) {
  const manifestPath = path8.join(depsRoot, "manifest.json");
  const raw = readJson(manifestPath);
  const entries = raw?.entries && typeof raw.entries === "object" ? raw.entries : {};
  const out = /* @__PURE__ */ new Map();
  for (const [entryPath, value] of Object.entries(entries)) {
    const item = value;
    if (!item || typeof item !== "object") continue;
    const fileName = typeof item.outFile === "string" ? item.outFile : typeof item.out_file === "string" ? item.out_file : null;
    if (!fileName || !fileName.endsWith(".js")) continue;
    const packageLabel = typeof item.package === "string" ? item.package : "unknown";
    const parsed = parsePackageLabel(packageLabel) ?? extractPackageIdentityFromModuleId(`ws://${entryPath}`);
    if (!parsed) continue;
    const chunkFilesRaw = Array.isArray(item.chunkFiles) ? item.chunkFiles : Array.isArray(item.chunk_files) ? item.chunk_files : [];
    out.set(fileName, {
      fileName,
      entryPath,
      packageLabel,
      packageName: parsed.packageName,
      packageVersion: parsed.packageVersion,
      sizeBytes: typeof item.sizeBytes === "number" ? item.sizeBytes : typeof item.size_bytes === "number" ? item.size_bytes : 0,
      moduleCount: typeof item.moduleCount === "number" ? item.moduleCount : typeof item.module_count === "number" ? item.module_count : 0,
      edgeCount: typeof item.edgeCount === "number" ? item.edgeCount : typeof item.edge_count === "number" ? item.edge_count : 0,
      externalCount: typeof item.externalCount === "number" ? item.externalCount : typeof item.external_count === "number" ? item.external_count : 0,
      chunkGroup: typeof item.chunkGroup === "string" ? item.chunkGroup : typeof item.chunk_group === "string" ? item.chunk_group : null,
      chunkFiles: uniqueSorted(chunkFilesRaw.filter((value2) => typeof value2 === "string" && value2.endsWith(".js")))
    });
  }
  return out;
}
function loadVendorPackRouting(depsRoot, depsHash) {
  const raw = readJson(path8.join(depsRoot, "vendor-pack.v2.index.json"));
  if (!raw || raw.version !== 1 || raw.depsHash !== depsHash) return /* @__PURE__ */ new Map();
  const routing = raw.fileNameToPackFile && typeof raw.fileNameToPackFile === "object" ? raw.fileNameToPackFile : {};
  return new Map(
    Object.entries(routing).filter(
      (entry) => typeof entry[0] === "string" && typeof entry[1] === "string"
    )
  );
}
function summarizeDuplicateFindings(graphNodes, depUsageIndex, depsManifestIndex, limit) {
  const packages = /* @__PURE__ */ new Map();
  const ensureVersion = (packageName, version) => {
    let versions = packages.get(packageName);
    if (!versions) {
      versions = /* @__PURE__ */ new Map();
      packages.set(packageName, versions);
    }
    let aggregate = versions.get(version);
    if (!aggregate) {
      aggregate = {
        graphModules: /* @__PURE__ */ new Set(),
        depArtifacts: /* @__PURE__ */ new Set(),
        importers: /* @__PURE__ */ new Set(),
        entryRoots: /* @__PURE__ */ new Set(),
        sampleIds: /* @__PURE__ */ new Set(),
        sources: /* @__PURE__ */ new Set()
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
  return Array.from(packages.entries()).filter(([, versions]) => versions.size > 1).map(([packageName, versions]) => {
    const versionDetails = Array.from(versions.entries()).map(([version, aggregate]) => ({
      version,
      graphModules: aggregate.graphModules.size,
      depArtifacts: aggregate.depArtifacts.size,
      importers: aggregate.importers.size,
      entryRoots: aggregate.entryRoots.size,
      sampleIds: Array.from(aggregate.sampleIds).sort().slice(0, 5)
    })).sort(
      (a, b) => b.depArtifacts - a.depArtifacts || b.graphModules - a.graphModules || b.importers - a.importers || a.version.localeCompare(b.version)
    );
    const evidenceSources = Array.from(
      new Set(Array.from(versions.values()).flatMap((aggregate) => Array.from(aggregate.sources)))
    ).sort();
    return {
      packageName,
      versions: versionDetails,
      evidenceSources,
      totalGraphModules: versionDetails.reduce((sum, value) => sum + value.graphModules, 0),
      totalDepArtifacts: versionDetails.reduce((sum, value) => sum + value.depArtifacts, 0),
      totalImporters: versionDetails.reduce((sum, value) => sum + value.importers, 0),
      severity: classifyDuplicateSeverity(versionDetails.length, versionDetails.reduce((sum, value) => sum + value.depArtifacts, 0)),
      confidence: "high"
    };
  }).sort(
    (a, b) => b.versions.length - a.versions.length || b.totalDepArtifacts - a.totalDepArtifacts || b.totalGraphModules - a.totalGraphModules || a.packageName.localeCompare(b.packageName)
  ).slice(0, Math.max(1, limit));
}
function summarizeChunkBloatFindings(outDir, limit) {
  const manifest = readJson(path8.join(path8.resolve(outDir), "manifest.json"));
  const stats = readJson(path8.join(path8.resolve(outDir), "build.stats.json"));
  const chunks = Array.isArray(manifest?.chunks) ? manifest.chunks : [];
  if (!chunks.length || !stats) return [];
  return chunks.map((chunk) => {
    const files = chunk.files ?? {};
    const jsFiles = Array.isArray(files.js) ? files.js.filter((value) => typeof value === "string") : [];
    const cssFiles = Array.isArray(files.css) ? files.css.filter((value) => typeof value === "string") : [];
    const assetFiles = Array.isArray(files.assets) ? files.assets.filter((value) => typeof value === "string") : [];
    const sumBytes = (fileNames) => fileNames.reduce((sum, fileName) => sum + (typeof stats[fileName]?.bytes === "number" ? stats[fileName].bytes ?? 0 : 0), 0);
    const jsBytes = sumBytes(jsFiles);
    const cssBytes = sumBytes(cssFiles);
    const assetBytes = sumBytes(assetFiles);
    const totalBytes = jsBytes + cssBytes + assetBytes;
    const modules = Array.isArray(chunk.modules) ? chunk.modules : [];
    const topModules = modules.map((module) => ({
      id: typeof module?.id === "string" ? module.id : "unknown",
      deps: Array.isArray(module?.deps) ? module.deps.length : 0
    })).sort((a, b) => b.deps - a.deps || a.id.localeCompare(b.id)).slice(0, 3);
    return {
      kind: "build-chunk",
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
        0
      ),
      topModules,
      severity: classifyChunkSeverity(totalBytes, chunk.shared === true),
      confidence: "high"
    };
  }).filter((item) => item.totalBytes > 0).sort((a, b) => b.totalBytes - a.totalBytes || b.jsBytes - a.jsBytes || a.chunkId.localeCompare(b.chunkId)).slice(0, Math.max(1, limit));
}
function summarizeDependencyBloatFindings(depsRoot, depsHash, limit) {
  const depsManifestIndex = loadDepsManifestIndex2(depsRoot);
  if (depsManifestIndex.size === 0) return [];
  const depUsageIndex = loadDepUsageIndex(depsRoot, depsHash);
  const packRouting = loadVendorPackRouting(depsRoot, depsHash);
  return Array.from(depsManifestIndex.values()).map((entry) => {
    const usage = depUsageIndex?.get(entry.fileName) ?? null;
    const packFileName = packRouting.get(entry.fileName) ?? null;
    const confidence = !usage ? "low" : usage.hasNamespace || usage.hasExportStar ? "medium" : "high";
    const severity = classifyDependencySeverity(
      entry.sizeBytes,
      usage?.importerKeys.length ?? 0,
      usage?.entryRootKeys.length ?? 0,
      packFileName !== null
    );
    return {
      kind: "dep-artifact",
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
      confidence
    };
  }).sort(
    (a, b) => b.bytes - a.bytes || b.importerCount - a.importerCount || Number(a.packed) - Number(b.packed) || a.packageLabel.localeCompare(b.packageLabel)
  ).slice(0, Math.max(1, limit));
}
function buildAnalyzeSuggestions(duplicates, dependencies, limit) {
  const suggestions = [];
  for (const duplicate of duplicates) {
    suggestions.push({
      kind: "align-package-versions",
      target: duplicate.packageName,
      severity: duplicate.severity,
      confidence: "high",
      rationale: `${duplicate.packageName} resolves to ${duplicate.versions.length} versions; align versions to reduce duplicate dependency state.`
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
        dependency.bytes
      )} outside vendor-pack coverage across ${Math.max(dependency.importerCount, dependency.entryRootCount)} import roots.`
    });
  }
  const kindPriority = (kind) => kind === "align-package-versions" ? 0 : 1;
  return suggestions.sort(
    (a, b) => compareSeverity(a.severity, b.severity) || kindPriority(a.kind) - kindPriority(b.kind) || a.target.localeCompare(b.target)
  ).slice(0, Math.max(1, limit));
}
function summarizeFindings(options) {
  const { graphNodes, outDir, depsSelection, limit } = options;
  const depsManifestIndex = depsSelection ? loadDepsManifestIndex2(depsSelection.depsRoot) : null;
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
      dependencies: dependencyBloat
    },
    suggestions
  };
}
function countPackSavings(summary) {
  if (!summary) return null;
  return summary.packs.reduce((sum, pack) => sum + pack.requestsSaved, 0);
}
function deriveAnalyzeOverview(input) {
  return {
    modules: input.graph?.modules ?? null,
    dependencies: input.graph?.edges ?? null,
    entries: input.build?.entries ?? null,
    chunks: input.build?.chunks.total ?? null,
    jsBytes: input.build?.bytes.js ?? null,
    cssBytes: input.build?.bytes.css ?? null,
    packSavingsRequests: countPackSavings(input.packs)
  };
}
function deriveAnalyzeHealth(input) {
  const maxChunkBytes = input.findings?.bloat.chunks[0]?.totalBytes ?? 0;
  const jsBytes = input.build?.bytes.js ?? 0;
  let bundlePressure = "missing";
  if (input.build || (input.findings?.bloat.chunks.length ?? 0) > 0) {
    if (maxChunkBytes >= 2 * 1024 * 1024 || jsBytes >= 5 * 1024 * 1024) bundlePressure = "high";
    else if (maxChunkBytes >= 512 * 1024 || jsBytes >= 1 * 1024 * 1024) bundlePressure = "medium";
    else bundlePressure = "low";
  }
  let duplicatePressure = "missing";
  if (input.findings) {
    if (input.findings.duplicates.some((item) => item.severity === "high")) duplicatePressure = "high";
    else if (input.findings.duplicates.length > 0) duplicatePressure = "medium";
    else duplicatePressure = "low";
  }
  let packCoverage = "missing";
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
    routeVisibility: input.routes && input.routes.routeCount > 0 ? "present" : "missing"
  };
}
function getTopModuleLabel(module) {
  return module?.id ?? null;
}
function buildTopFindingScore(finding) {
  const severityWeight = finding.severity === "high" ? 1e9 : finding.severity === "medium" ? 1e8 : 1e7;
  const confidenceWeight = finding.confidence === "high" ? 1e6 : finding.confidence === "medium" ? 1e5 : 1e4;
  const numericEvidence = typeof finding.evidence.bytes === "number" ? finding.evidence.bytes : typeof finding.evidence.versions === "number" ? finding.evidence.versions * 1e4 : typeof finding.evidence.totalDepArtifacts === "number" ? finding.evidence.totalDepArtifacts * 1e3 : 0;
  return severityWeight + confidenceWeight + numericEvidence;
}
function buildTopFindings(findings, limit) {
  if (!findings) return [];
  const normalized = [];
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
        totalGraphModules: duplicate.totalGraphModules
      },
      source: "duplicate"
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
        topModule: getTopModuleLabel(chunk.topModules[0])
      },
      source: "chunk-bloat"
    });
  }
  for (const dependency of findings.bloat.dependencies) {
    normalized.push({
      id: `dep:${dependency.fileName}`,
      severity: dependency.severity,
      title: dependency.packed ? "Heavy dependency artifact" : "Heavy unpacked dependency artifact",
      why: dependency.packed ? "Large dependency artifacts still add byte and parse pressure." : "Large unpacked dependency artifacts increase request and transfer pressure.",
      action: dependency.packed ? "Reduce the imported surface or review whether this dependency should stay this large." : "Review pack coverage or reduce the imported surface for this dependency.",
      confidence: dependency.confidence,
      evidence: {
        packageName: dependency.packageName,
        packageVersion: dependency.packageVersion,
        bytes: dependency.bytes,
        importers: dependency.importerCount,
        packed: dependency.packed
      },
      source: "dep-bloat"
    });
  }
  return normalized.sort(
    (a, b) => buildTopFindingScore(b) - buildTopFindingScore(a) || compareSeverity(a.severity, b.severity) || compareCertainty(a.confidence, b.confidence) || a.id.localeCompare(b.id)
  ).slice(0, Math.max(1, limit));
}
function compactWorkspaceLabel(projectRoot) {
  const base = path8.basename(projectRoot);
  return base || projectRoot;
}
function uniquePreservingOrder(values) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
function formatSeverity(severity) {
  return severity[0].toUpperCase() + severity.slice(1);
}
function formatHealth(level) {
  return level[0].toUpperCase() + level.slice(1);
}
function collectNextActions(summary, limit) {
  const actions = [];
  for (const finding of summary.topFindings) {
    if (finding.action) actions.push(finding.action);
  }
  for (const suggestion of summary.findings?.suggestions ?? []) {
    actions.push(suggestion.rationale);
  }
  const unique = uniquePreservingOrder(actions);
  return unique.slice(0, Math.max(1, limit));
}
function printCompactSectionStatus(label, available, detail) {
  const state = available ? accent(detail ?? "available") : chalk.bold.red("unavailable");
  console.log(` ${chalk.bold(label)}: ${state}`);
}
function printDefaultSummary(summary, options, limit) {
  logInfo("Ionify Analyzer");
  console.log(` ${chalk.bold("Workspace")}: ${accent(compactWorkspaceLabel(summary.workspace.projectRoot))}`);
  printCompactSectionStatus(
    "Graph",
    !!summary.graph,
    summary.summary.modules !== null && summary.summary.dependencies !== null ? `${summary.summary.modules} modules \u2022 ${summary.summary.dependencies} deps` : null
  );
  printCompactSectionStatus(
    "Build",
    !!summary.build,
    summary.build ? `${summary.build.chunks.total} chunks \u2022 ${formatBytes(summary.build.bytes.js)} JS \u2022 ${formatBytes(summary.build.bytes.css)} CSS` : null
  );
  printCompactSectionStatus(
    "Packs",
    !!summary.packs,
    summary.summary.packSavingsRequests !== null ? `${summary.packs?.packs.length ?? 0} active packs \u2022 ~${summary.summary.packSavingsRequests} requests saved` : null
  );
  printCompactSectionStatus(
    "Routes",
    !!summary.routes,
    summary.routes ? `${summary.routes.routeCount} tracked route${summary.routes.routeCount === 1 ? "" : "s"}` : null
  );
  console.log(`
 ${sectionTitle("Health")}`);
  console.log(` ${dimText("-")} Bundle size pressure: ${colorHealth(summary.health.bundlePressure)}`);
  console.log(` ${dimText("-")} Duplicate dependency pressure: ${colorHealth(summary.health.duplicatePressure)}`);
  console.log(` ${dimText("-")} Pack coverage: ${colorHealth(summary.health.packCoverage)}`);
  console.log(` ${dimText("-")} Route visibility: ${colorHealth(summary.health.routeVisibility)}`);
  console.log(`
 ${sectionTitle("Top Issues")}`);
  if (summary.topFindings.length === 0) {
    console.log(` ${dimText("No high-signal findings from the current engine state.")}`);
  } else {
    const topIssueCount = options.verbose ? Math.max(1, Math.min(5, limit)) : Math.max(1, Math.min(3, limit));
    for (const [index, finding] of summary.topFindings.slice(0, topIssueCount).entries()) {
      const evidenceParts = Object.entries(finding.evidence).filter(([, value]) => value !== null && value !== false && value !== "").slice(0, 3).map(([key, value]) => `${key}=${typeof value === "number" && key === "bytes" ? formatBytes(value) : value}`);
      console.log(`${accent(`${index + 1}.`)} [${colorSeverity(finding.severity)}] ${chalk.bold(finding.title)}`);
      console.log(`   ${dimText("Why:")} ${finding.why}`);
      if (evidenceParts.length > 0) console.log(`   ${dimText("Evidence:")} ${evidenceParts.join(` ${chalk.gray("\u2022")} `)}`);
      if (finding.action) console.log(`   ${dimText("Action:")} ${chalk.green(finding.action)}`);
      console.log(`   ${dimText("Confidence:")} ${colorConfidence(finding.confidence)}`);
    }
  }
  console.log(`
 ${sectionTitle("Key Metrics")}`);
  console.log(
    ` ${dimText("-")} Largest chunk: ${metric(
      summary.findings?.bloat.chunks[0] ? `${formatBytes(summary.findings.bloat.chunks[0].totalBytes)} (${summary.findings.bloat.chunks[0].chunkId})` : "n/a"
    )}`
  );
  console.log(
    ` ${dimText("-")} Largest dependency artifact: ${metric(
      summary.findings?.bloat.dependencies[0] ? `${summary.findings.bloat.dependencies[0].packageLabel} (${formatBytes(summary.findings.bloat.dependencies[0].bytes)})` : "n/a"
    )}`
  );
  console.log(` ${dimText("-")} Duplicate families: ${metric(String(summary.findings?.duplicates.length ?? 0))}`);
  console.log(` ${dimText("-")} Vendor pack request savings: ${metric(String(summary.summary.packSavingsRequests ?? "n/a"))}`);
  const nextActions = collectNextActions(summary, 3);
  if (nextActions.length > 0) {
    console.log(`
 ${sectionTitle("Recommended Next Steps")}`);
    for (const action of nextActions) console.log(` ${dimText("-")} ${chalk.green(action)}`);
  }
  if (!options.verbose) {
    console.log(`
 ${dimText("Use --verbose for full findings, --json for stable machine output, or --section <name> for focused analysis.")}`);
  }
}
function printDepsSection(summary) {
  console.log(`
 ${sectionTitle("Dependencies")}`);
  if (!summary.findings) {
    console.log(` ${dimText("Duplicate and bloat findings are unavailable for the current engine state.")}`);
    return;
  }
  if (summary.findings.duplicates.length > 0) {
    console.log(` ${subSectionTitle("Duplicate versions:")}`);
    for (const duplicate of summary.findings.duplicates) {
      console.log(bullet(`[${colorSeverity(duplicate.severity)}] ${duplicate.packageName} ${chalk.gray("\u2192")} ${duplicate.versions.map((item) => item.version).join(", ")}`));
    }
  } else {
    console.log(` ${subSectionTitle("Duplicate versions:")} ${dimText("none detected")}`);
  }
  if (summary.findings.bloat.dependencies.length > 0) {
    console.log(`
 ${subSectionTitle("Heavy dependency artifacts:")}`);
    for (const dependency of summary.findings.bloat.dependencies) {
      console.log(
        bullet(
          `[${colorSeverity(dependency.severity)}] ${dependency.packageLabel} ${metric(formatBytes(dependency.bytes))} ${dimText(
            `packed=${dependency.packed ? "yes" : "no"} confidence=`
          )}${colorConfidence(dependency.confidence)}`
        )
      );
    }
  } else {
    console.log(`
 ${subSectionTitle("Heavy dependency artifacts:")} ${dimText("unavailable")}`);
  }
  if (summary.findings.suggestions.length > 0) {
    console.log(`
 ${subSectionTitle("Suggestions:")}`);
    for (const suggestion of summary.findings.suggestions) {
      console.log(bullet(`[${colorSeverity(suggestion.severity)}] ${chalk.green(suggestion.rationale)}`));
    }
  }
}
function printFocusedSection(section, summary, options) {
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
            `  \u2022 [${formatSeverity(chunk.severity)}] ${chunk.chunkId} ${formatBytes(chunk.totalBytes)} modules=${chunk.moduleCount} depRefs=${chunk.depReferenceCount}`
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
function printGraphTree(nodes, prefix = "") {
  nodes.forEach((node, index) => {
    const isLast = index === nodes.length - 1;
    const branch = prefix ? isLast ? "\u2514\u2500 " : "\u251C\u2500 " : "";
    const suffixParts = [];
    if (node.cycle) suffixParts.push("cycle");
    if (node.truncated) suffixParts.push("truncated");
    suffixParts.push(`${node.depCount} deps`);
    console.log(`${prefix}${branch}${node.id} (${suffixParts.join(", ")})`);
    if (node.deps && node.deps.length > 0) {
      printGraphTree(node.deps, `${prefix}${prefix ? isLast ? "   " : "\u2502  " : ""}`);
    }
  });
}
function printGraphSummary(summary, includeTree) {
  console.log(`
 ${sectionTitle("Graph")}`);
  console.log(` ${chalk.bold("Modules")}: ${metric(String(summary.modules))}`);
  console.log(` ${chalk.bold("Dependencies")}: ${metric(String(summary.edges))}`);
  console.log(` ${chalk.bold("Avg deps / module")}: ${metric(summary.averageDeps.toFixed(2))}`);
  console.log(` ${chalk.bold("Roots")}: ${metric(String(summary.roots.length))}`);
  if (summary.densest.length > 0) {
    console.log(`
 ${subSectionTitle("Top modules by dependency count:")}`);
    for (const entry of summary.densest) console.log(bullet(`${entry.id} ${dimText(`(${entry.deps})`)}`));
  }
  if (summary.mostDepended.length > 0) {
    console.log(`
 ${subSectionTitle("Top modules by inbound dependents:")}`);
    for (const entry of summary.mostDepended) console.log(bullet(`${entry.id} ${dimText(`(${entry.dependents})`)}`));
  }
  if (summary.orphans.length > 0) {
    console.log(`
 ${subSectionTitle("Root/orphan modules:")}`);
    for (const file of summary.orphans.slice(0, 10)) console.log(bullet(file));
    if (summary.orphans.length > 10) console.log(bullet(dimText(`...and ${summary.orphans.length - 10} more`)));
  }
  if (includeTree && summary.tree && summary.tree.length > 0) {
    console.log(`
 ${subSectionTitle("Dependency tree:")}`);
    printGraphTree(summary.tree);
  }
}
function printBuildSummary(summary) {
  console.log(`
 ${sectionTitle("Build")}`);
  console.log(` ${chalk.bold("Out dir")}: ${summary.outDir}`);
  console.log(` ${chalk.bold("Manifest")}: ${summary.hasManifest ? chalk.green("yes") : chalk.red("no")}`);
  console.log(` ${chalk.bold("Build stats")}: ${summary.hasStats ? chalk.green("yes") : chalk.red("no")}`);
  console.log(` ${chalk.bold("Entries")}: ${metric(String(summary.entries))}`);
  console.log(` ${chalk.bold("Chunks")}: ${metric(String(summary.chunks.total))} ${dimText(`(entry ${summary.chunks.entry}, shared ${summary.chunks.shared})`)}`);
  console.log(
    ` ${chalk.bold("Files")}: ${dimText(`js ${summary.files.js}, css ${summary.files.css}, assets ${summary.files.assets}, maps ${summary.files.maps}, public ${summary.files.publicAssets}`)}`
  );
  console.log(
    ` ${chalk.bold("Bytes")}: ${dimText(`js ${formatBytes(summary.bytes.js)}, css ${formatBytes(summary.bytes.css)}, assets ${formatBytes(
      summary.bytes.assets
    )}, maps ${formatBytes(summary.bytes.maps)}, public ${formatBytes(summary.bytes.publicAssets)}`)}`
  );
  if (summary.topFiles.length > 0) {
    console.log(`
 ${subSectionTitle("Largest tracked files:")}`);
    for (const file of summary.topFiles) console.log(bullet(`${file.file} ${dimText(`(${file.type}, ${formatBytes(file.bytes)})`)}`));
  }
}
function printPackSummary(summary) {
  console.log(`
 ${sectionTitle("Vendor packs (v2)")}`);
  console.log(` ${chalk.bold("depsHash")}: ${accent(summary.depsHash)}`);
  console.log(` ${chalk.bold("selection")}: ${summary.selectionMode}`);
  if (summary.packIndexHash) console.log(` ${chalk.bold("packIndexHash")}: ${dimText(summary.packIndexHash)}`);
  if (summary.usageIndexHash) console.log(` ${chalk.bold("usageIndexHash")}: ${dimText(summary.usageIndexHash)}`);
  if (summary.packs.length > 0) {
    console.log(`
 ${subSectionTitle("Top packs by request savings (approx):")}`);
    for (const p of summary.packs) {
      const reqLabel = `${p.requestsUnpacked}\u2192${p.requestsPacked} (saved ${p.requestsSaved})`;
      const bytesLabel = p.bytesWrappers !== null && p.bytesPacked !== null ? `${formatBytes(p.bytesWrappers)}\u2192${formatBytes(p.bytesPacked)}` : "n/a";
      console.log(bullet(`${p.packFileName} ${dimText(`members=${p.members} requests=${reqLabel} bytes=${bytesLabel}`)}`));
    }
  }
  if (summary.slimGroups.length > 0) {
    console.log(`
 ${subSectionTitle("Slimming (base \u2192 slim shared bytes):")}`);
    for (const g of summary.slimGroups) {
      const saved = g.savedBytes !== null && g.savedBytes > 0 ? `saved ${formatBytes(g.savedBytes)}` : "saved n/a";
      console.log(bullet(`${g.label}: ${formatBytes(g.baseSharedBytes)}\u2192${formatBytes(g.slimSharedBytes)} ${dimText(`(${saved})`)}`));
    }
  }
}
function printRouteSummary(summary) {
  console.log(`
 ${sectionTitle("Routes")}`);
  console.log(` ${chalk.bold("State")}: ${summary.statePath}`);
  console.log(` ${chalk.bold("Routes tracked")}: ${metric(String(summary.routeCount))}`);
  console.log(` ${chalk.bold("Primary route")}: ${accent(summary.primaryRouteKey ?? "n/a")}`);
  if (summary.routes.length > 0) {
    console.log(`
 ${subSectionTitle("Top routes:")}`);
    for (const route of summary.routes) {
      console.log(bullet(`${route.routeKey} ${dimText(`documents=${route.documents} requests=${route.totalRequests} assets=${route.totalAssets} (dep ${route.depAssets}, source ${route.sourceAssets})`)}`));
    }
  }
  if (summary.topDepAssets.length > 0) {
    console.log(`
 ${subSectionTitle("Top dep assets:")}`);
    for (const item of summary.topDepAssets) {
      console.log(bullet(`${item.url} ${dimText(`requests=${item.totalRequestCount} depth=${item.minDepth} routes=${item.routeKeys.length}`)}`));
    }
  }
  if (summary.topSourceAssets.length > 0) {
    console.log(`
 ${subSectionTitle("Top source assets:")}`);
    for (const item of summary.topSourceAssets) {
      console.log(bullet(`${item.url} ${dimText(`requests=${item.totalRequestCount} depth=${item.minDepth} routes=${item.routeKeys.length}`)}`));
    }
  }
  if (summary.suggestedPreloads.length > 0) {
    console.log(`
 ${subSectionTitle("Suggested preloads:")}`);
    for (const item of summary.suggestedPreloads) {
      console.log(bullet(`${item.url} ${dimText(`(${item.kind}) route=${item.routeRequestCount} total=${item.totalRequestCount} depth=${item.minDepth}`)}`));
    }
  }
  if (summary.firstRouteBytes) {
    console.log(`
 ${subSectionTitle("Primary route observed bytes:")}`);
    console.log(
      bullet(
        `total=${formatBytes(summary.firstRouteBytes.totalObservedBytes)} dep=${formatBytes(summary.firstRouteBytes.depObservedBytes)} source=${formatBytes(summary.firstRouteBytes.sourceObservedBytes)} ${dimText(`resolved=${summary.firstRouteBytes.observedAssets} unresolved=${summary.firstRouteBytes.unresolvedAssets}`)}`
      )
    );
  }
  if (summary.packCoverage) {
    console.log(`
 ${subSectionTitle("Pack coverage:")}`);
    console.log(
      bullet(
        `covered=${summary.packCoverage.coveredDepAssets}/${summary.packCoverage.totalDepAssets} uncovered=${summary.packCoverage.uncoveredDepAssets} estimated requests ${summary.packCoverage.estimatedCurrentRequests ?? 0}\u2192${summary.packCoverage.estimatedPackedRequests ?? 0} ${dimText(`saved=${summary.packCoverage.estimatedRequestsSaved ?? 0}`)}`
      )
    );
  }
  if (summary.uncoveredHotDeps.length > 0) {
    console.log(`
 ${subSectionTitle("Uncovered hot deps:")}`);
    for (const dep of summary.uncoveredHotDeps) {
      const label = dep.packageLabel ?? dep.fileName;
      console.log(
        bullet(
          `${label} ${dimText(`requests=${dep.routeRequestCount} depth=${dep.minDepth} bytes=${formatBytes(dep.bytes)} importers=${dep.importers} roots=${dep.entryRoots}`)}`
        )
      );
    }
  }
  console.log(`
 ${subSectionTitle("History and policy visibility:")}`);
  const signals = summary.policyVisibility.signals;
  console.log(
    bullet(
      `signals routeHints=${signals.routeHints ? "yes" : "no"} depUsage=${signals.depUsage ? "yes" : "no"} packRouting=${signals.packRouting ? "yes" : "no"} manifestOwnership=${signals.manifestOwnership ? "yes" : "no"}`
    )
  );
  if (summary.policyVisibility.entryCriticalEvidence) {
    const evidence = summary.policyVisibility.entryCriticalEvidence;
    console.log(
      bullet(
        `entry-critical evidence assets=${evidence.criticalAssets} deferred=${evidence.deferredAssets} requests=${evidence.criticalRequests}/${evidence.deferredRequests} ${dimText(summary.policyVisibility.startupPolicy ? "(startup policy + history)" : "(derived from minDepth)")}`
      )
    );
  }
  if (summary.policyVisibility.startupPolicy) {
    const startupPolicy = summary.policyVisibility.startupPolicy;
    console.log(
      bullet(
        `startup-policy route=${startupPolicy.routeKey} eager=${startupPolicy.eagerAssets} preFcpLoaded=${startupPolicy.preFcpLoadedModules} preFcpEvaluated=${startupPolicy.preFcpEvaluatedModules} ${dimText(`hash=${startupPolicy.policyHash.slice(0, 12)}`)}`
      )
    );
    console.log(
      bullet(
        `classifications entry-critical=${startupPolicy.entryCritical} shared-later=${startupPolicy.sharedLater} route-lazy=${startupPolicy.routeLazy} background=${startupPolicy.background}`
      )
    );
  }
  console.log(
    bullet(
      `policy reuse=${summary.policyVisibility.policyReuse.status} ${dimText(`(${summary.policyVisibility.policyReuse.reason})`)}`
    )
  );
  for (const effect of summary.policyVisibility.currentEffects) {
    console.log(bullet(effect));
  }
  for (const missing of summary.policyVisibility.missingCapabilities) {
    console.log(bullet(dimText(`Not yet: ${missing}`)));
  }
}
function printFindingsSummary(summary) {
  console.log(`
 ${sectionTitle("Findings")}`);
  if (summary.duplicates.length > 0) {
    console.log(`
 ${subSectionTitle("Duplicate versions:")}`);
    for (const duplicate of summary.duplicates) {
      const versions = duplicate.versions.map((item) => item.version).join(", ");
      console.log(bullet(`[${colorSeverity(duplicate.severity)}] ${duplicate.packageName} ${chalk.gray("\u2192")} ${versions} ${dimText(`(${duplicate.confidence})`)}`));
    }
  }
  if (summary.bloat.chunks.length > 0) {
    console.log(`
 ${subSectionTitle("Largest emitted chunks:")}`);
    for (const chunk of summary.bloat.chunks) {
      const role = chunk.entry ? "entry" : chunk.shared ? "shared" : "chunk";
      console.log(
        bullet(`[${colorSeverity(chunk.severity)}] ${chunk.chunkId} ${dimText(`(${role})`)} ${metric(formatBytes(chunk.totalBytes))} ${dimText(`modules=${chunk.moduleCount} depRefs=${chunk.depReferenceCount}`)}`)
      );
    }
  }
  if (summary.bloat.dependencies.length > 0) {
    console.log(`
 ${subSectionTitle("Heaviest dependency artifacts:")}`);
    for (const dependency of summary.bloat.dependencies) {
      const usageLabel = dependency.importerCount > 0 ? `importers=${dependency.importerCount} roots=${dependency.entryRootCount}` : "usage=n/a";
      const packLabel = dependency.packed ? `packed via ${dependency.packFileName}` : "not packed";
      console.log(
        bullet(`[${colorSeverity(dependency.severity)}] ${dependency.packageLabel} ${metric(formatBytes(dependency.bytes))} ${dimText(`${usageLabel} ${packLabel} certainty=`)}${colorConfidence(dependency.confidence)}`)
      );
    }
  }
  if (summary.suggestions.length > 0) {
    console.log(`
 ${subSectionTitle("Conservative suggestions:")}`);
    for (const suggestion of summary.suggestions) {
      console.log(bullet(`[${colorSeverity(suggestion.severity)}] ${suggestion.target}: ${chalk.green(suggestion.rationale)} ${dimText(`(${suggestion.confidence})`)}`));
    }
  }
  if (summary.duplicates.length === 0 && summary.bloat.chunks.length === 0 && summary.bloat.dependencies.length === 0 && summary.suggestions.length === 0) {
    console.log(` ${dimText("No duplicate-version or bloat findings from the current engine state.")}`);
  }
}
async function withSuppressedConsole(enabled, work) {
  if (!enabled) return await work();
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = () => {
  };
  console.warn = () => {
  };
  console.error = () => {
  };
  try {
    return await work();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}
async function runAnalyzeCommand(options = {}) {
  const limit = Math.max(1, options.limit ?? 10);
  const selected = getSelectedSurfaces(options);
  const ws = await withSuppressedConsole(!!options.json, () => resolveAnalyzeWorkspace());
  const outDir = options.outDir ? path8.resolve(options.outDir) : path8.join(ws.projectRoot, "dist");
  const needsGraphState = selected.includes("graph") || selected.includes("findings");
  const needsDepsState = selected.includes("packs") || selected.includes("findings") || selected.includes("routes");
  const nodes = needsGraphState ? await withSuppressedConsole(!!options.json, () => loadGraphSnapshot(ws.ionifyDir)) : null;
  const depsInfo = needsDepsState ? selectDepsRoot(ws.ionifyDir, options.depsHash, process.env.IONIFY_DEPS_HASH) : null;
  const summary = {
    version: 1,
    workspace: {
      projectRoot: ws.projectRoot,
      workspaceRoot: ws.workspaceRoot,
      ionifyDir: ws.ionifyDir
    },
    selected,
    summary: {
      modules: null,
      dependencies: null,
      entries: null,
      chunks: null,
      jsBytes: null,
      cssBytes: null,
      packSavingsRequests: null
    },
    health: {
      bundlePressure: "missing",
      duplicatePressure: "missing",
      packCoverage: "missing",
      routeVisibility: "missing"
    },
    topFindings: []
  };
  if (selected.includes("graph")) {
    summary.graph = nodes && nodes.length > 0 ? computeGraphSummary(nodes, limit, !!(options.tree || options.deps)) : null;
  }
  if (selected.includes("build")) {
    summary.build = summarizeBuildOutputs(outDir, limit);
  }
  if (selected.includes("packs")) {
    summary.packs = depsInfo ? analyzeVendorPacks(depsInfo.depsRoot, depsInfo.depsHash, depsInfo.selectionMode, limit) : null;
  }
  if (selected.includes("routes")) {
    const routeHintStatePath = path8.join(ws.ionifyDir, "route-hints.v1.json");
    summary.routes = summarizeRoutes(routeHintStatePath, limit, {
      projectRoot: ws.projectRoot,
      depsSelection: depsInfo
    });
  }
  if (selected.includes("findings")) {
    summary.findings = summarizeFindings({
      graphNodes: nodes,
      outDir,
      depsSelection: depsInfo,
      limit
    });
  }
  summary.summary = deriveAnalyzeOverview({
    graph: summary.graph,
    build: summary.build,
    packs: summary.packs
  });
  summary.health = deriveAnalyzeHealth({
    build: summary.build,
    routes: summary.routes,
    findings: summary.findings
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

// src/cli/commands/publish.ts
import fs11 from "fs";
import path10 from "path";

// src/core/production-transform-publication.ts
import fs10 from "fs";
import path9 from "path";
var CSS_CAS_META_VERSION = 2;
function metaTailwindStampForRecipe2(cssMeta) {
  const tw = cssMeta?.tailwindGraphContent;
  return tw?.enabled === true && typeof tw.stamp === "string" && tw.stamp.length > 0 ? tw.stamp : "none";
}
async function publishProductionTransformCas(options) {
  const startedAt = Date.now();
  const moduleMetaById = collectModuleMeta(options.plan, options.workspaceRoot);
  const defineSignature = computeDefineSignature(options.defineConfig);
  const defineHash = defineSignature ? getCacheKey(defineSignature) : "";
  const getArtifactHash = (baseHash, kind, dh = defineHash) => {
    if (kind !== "js") return baseHash;
    if (!dh) return baseHash;
    return getCacheKey(`${baseHash}|define:${dh}`);
  };
  const jsProofExpectation = (baseHash, artifactHash) => ({
    sourceHash: baseHash,
    recipeConfigHash: options.configHash,
    defineHash,
    artifactKind: "js",
    variant: defineHash ? "define" : "base",
    artifactHash,
    recomputeArtifactHash: (sh, kind, dh) => getArtifactHash(sh, kind === "css" ? "css" : "js", dh)
  });
  const jsBaseProofExpectation = (baseHash) => ({
    sourceHash: baseHash,
    recipeConfigHash: options.configHash,
    defineHash: "",
    artifactKind: "js",
    variant: "base",
    artifactHash: baseHash,
    recomputeArtifactHash: (sh, kind, dh) => getArtifactHash(sh, kind === "css" ? "css" : "js", dh)
  });
  let hits = 0;
  let defineDerived = 0;
  const jobs = [];
  const artifactHashById = /* @__PURE__ */ new Map();
  for (const [id, meta] of moduleMetaById.entries()) {
    const baseHashFromPlan = meta.hash;
    const cssNeedsJsWrapper = meta.kind === "css" && isCssModuleLikePath(meta.fsPath);
    let artifactHashFromPlan = baseHashFromPlan ? getArtifactHash(baseHashFromPlan, meta.kind) : null;
    if (meta.kind === "css" && baseHashFromPlan) {
      const baseDir = getCasArtifactPath(options.casRoot, options.configHash, baseHashFromPlan);
      const cssMeta = readJsonFile4(path9.join(baseDir, "meta.json"));
      if (cssMeta && cssMeta.version === CSS_CAS_META_VERSION && cssMeta.baseHash === baseHashFromPlan && typeof cssMeta.pipelineHash === "string" && cssMeta.pipelineHash.length > 0) {
        const depsAbs = Array.from(
          new Set(
            [...cssMeta.deps ?? [], ...cssMeta.urlDeps ?? []].filter(
              (p) => typeof p === "string" && p.length > 0
            )
          )
        );
        const depsStampHash = computeDepsContentStampHash(depsAbs, moduleMetaById, options.workspaceRoot);
        artifactHashFromPlan = getCacheKey(
          `css:v3:${id}:${baseHashFromPlan}:${cssMeta.pipelineHash}:${depsStampHash}:${cssNeedsJsWrapper ? 1 : 0}:${metaTailwindStampForRecipe2(cssMeta)}`
        );
      }
    }
    const casDir = artifactHashFromPlan ? getCasArtifactPath(options.casRoot, options.configHash, artifactHashFromPlan) : null;
    const casJsFile = casDir ? path9.join(casDir, "transformed.js") : null;
    const casCssFile = casDir ? path9.join(casDir, "transformed.css") : null;
    if (artifactHashFromPlan) {
      artifactHashById.set(id, artifactHashFromPlan);
    }
    if (meta.kind === "js" && casDir && casJsFile && baseHashFromPlan && artifactHashFromPlan && fs10.existsSync(casJsFile) && admitTransformArtifact(casDir, jsProofExpectation(baseHashFromPlan, artifactHashFromPlan)).admissible) {
      hits++;
      continue;
    }
    if (meta.kind === "css" && casCssFile && fs10.existsSync(casCssFile)) {
      hits++;
      if (cssNeedsJsWrapper && casJsFile && !fs10.existsSync(casJsFile)) {
        const tokens = readJsonFile4(path9.join(casDir, "tokens.json"));
        if (tokens) writeTextFile(path9.join(casDir, "transformed.js"), renderCssTokensModule(tokens));
      }
      continue;
    }
    if (meta.kind === "js" && baseHashFromPlan && defineHash) {
      const baseDir = getCasArtifactPath(options.casRoot, options.configHash, baseHashFromPlan);
      const baseFile = path9.join(baseDir, "transformed.js");
      if (fs10.existsSync(baseFile) && admitTransformArtifact(baseDir, jsBaseProofExpectation(baseHashFromPlan)).admissible) {
        const artifactHash = getArtifactHash(baseHashFromPlan, "js");
        writeTransformArtifact({
          dir: getCasArtifactPath(options.casRoot, options.configHash, artifactHash),
          bytes: applyDefineReplacements(fs10.readFileSync(baseFile, "utf8"), options.defineConfig),
          map: null,
          identity: {
            sourceHash: baseHashFromPlan,
            recipeConfigHash: options.configHash,
            defineHash,
            artifactKind: "js",
            variant: "define"
          }
        });
        defineDerived++;
        continue;
      }
    }
    if (!fs10.existsSync(meta.fsPath)) {
      throw new Error(`Module missing on disk: ${meta.fsPath}`);
    }
    const code = fs10.readFileSync(meta.fsPath, "utf8");
    const baseHash = baseHashFromPlan ?? getCacheKey(code);
    jobs.push({
      id,
      filePath: meta.fsPath,
      ext: path9.extname(meta.fsPath),
      code,
      kind: meta.kind,
      baseHash,
      artifactHash: meta.kind === "js" ? getArtifactHash(baseHash, "js") : baseHash,
      cssNeedsJsWrapper
    });
  }
  if (jobs.length > 0) {
    const resultsById = await runTransformJobs(jobs, options.parserMode);
    for (const job of jobs) {
      const result = resultsById.get(job.id);
      if (!result) throw new Error(`Transform failed for ${job.filePath}: no transform result returned`);
      if (result.error) throw new Error(`Transform failed for ${result.filePath}: ${result.error}`);
      const isJs = (result.type ?? "js") === "js";
      if (isJs) {
        writeTransformArtifact({
          dir: getCasArtifactPath(options.casRoot, options.configHash, job.baseHash),
          bytes: result.code,
          map: result.map ?? null,
          identity: {
            sourceHash: job.baseHash,
            recipeConfigHash: options.configHash,
            defineHash: "",
            artifactKind: "js",
            variant: "base"
          }
        });
        const finalCode = applyDefineReplacements(result.code, options.defineConfig);
        if (job.artifactHash !== job.baseHash) {
          writeTransformArtifact({
            dir: getCasArtifactPath(options.casRoot, options.configHash, job.artifactHash),
            bytes: finalCode,
            map: result.map && finalCode === result.code ? result.map : null,
            identity: {
              sourceHash: job.baseHash,
              recipeConfigHash: options.configHash,
              defineHash,
              artifactKind: "js",
              variant: "define"
            }
          });
        }
        artifactHashById.set(job.id, job.artifactHash);
        continue;
      }
      const deps = Array.isArray(result.deps) ? result.deps.filter((p) => typeof p === "string" && p.length > 0) : [];
      const urlDeps = Array.isArray(result.urlDeps) ? result.urlDeps.filter((p) => typeof p === "string" && p.length > 0) : [];
      const pipelineHash = typeof result.pipelineHash === "string" && result.pipelineHash.length > 0 ? result.pipelineHash : "0";
      const depsAbs = Array.from(new Set([...deps, ...urlDeps].map((p) => path9.resolve(p))));
      const depsStampHash = computeDepsContentStampHash(depsAbs, moduleMetaById, options.workspaceRoot);
      const artifactHash = getCacheKey(
        `css:v3:${job.id}:${job.baseHash}:${pipelineHash}:${depsStampHash}:${job.cssNeedsJsWrapper ? 1 : 0}:none`
      );
      artifactHashById.set(job.id, artifactHash);
      const baseDir = getCasArtifactPath(options.casRoot, options.configHash, job.baseHash);
      writeJsonFile4(path9.join(baseDir, "meta.json"), {
        version: CSS_CAS_META_VERSION,
        baseHash: job.baseHash,
        artifactHash,
        pipelineHash,
        depsStampHash,
        deps: depsAbs.sort(),
        urlDeps: Array.from(new Set(urlDeps.map((p) => path9.resolve(p)))).sort(),
        depsProof: buildCssCasDepProof(depsAbs, moduleMetaById, options.workspaceRoot),
        modules: job.cssNeedsJsWrapper === true,
        generatedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      const artifactDir = getCasArtifactPath(options.casRoot, options.configHash, artifactHash);
      writeTextFile(path9.join(artifactDir, "transformed.css"), result.code);
      if (job.cssNeedsJsWrapper) {
        const tokens = result.tokens && typeof result.tokens === "object" ? result.tokens : {};
        writeTextFile(path9.join(artifactDir, "transformed.js"), renderCssTokensModule(tokens));
        writeJsonFile4(path9.join(artifactDir, "tokens.json"), tokens);
      }
    }
  }
  if (artifactHashById.size) {
    for (const chunk of options.plan.chunks) {
      for (const mod of chunk.modules) {
        const artifactHash = artifactHashById.get(mod.id);
        if (artifactHash) mod.hash = artifactHash;
      }
    }
  }
  const js = Array.from(moduleMetaById.values()).filter((meta) => meta.kind === "js").length;
  const css = Array.from(moduleMetaById.values()).filter((meta) => meta.kind === "css").length;
  return {
    modules: moduleMetaById.size,
    hits,
    transformed: jobs.length,
    defineDerived,
    js,
    css,
    ms: Date.now() - startedAt
  };
}
function collectModuleMeta(plan, workspaceRoot) {
  const out = /* @__PURE__ */ new Map();
  for (const chunk of plan.chunks) {
    for (const mod of chunk.modules) {
      if (mod.kind !== "js" && mod.kind !== "css") continue;
      let fsPath = typeof mod.fsPath === "string" && mod.fsPath.length > 0 ? mod.fsPath : null;
      if (!fsPath && typeof mod.id === "string" && mod.id.startsWith(WS_MODULE_PREFIX)) {
        fsPath = fromWsModuleId(mod.id, workspaceRoot);
      }
      if (!fsPath || !path9.isAbsolute(fsPath)) continue;
      if (out.has(mod.id)) continue;
      out.set(mod.id, {
        fsPath,
        kind: mod.kind,
        hash: typeof mod.hash === "string" && mod.hash.length > 0 ? mod.hash : null
      });
    }
  }
  return out;
}
async function runTransformJobs(jobs, parserMode) {
  const resultsById = /* @__PURE__ */ new Map();
  const nativeHandledIds = /* @__PURE__ */ new Set();
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const jsJobs = jobs.filter((job) => job.kind === "js");
  if (typeof native?.nativeTransformBatch === "function" && jsJobs.length > 0) {
    try {
      const nativeResults = native.nativeTransformBatch(
        jsJobs.map((job) => ({
          id: job.id,
          filePath: job.filePath,
          ext: job.ext,
          code: job.code
        })),
        parserMode
      );
      for (const result of nativeResults) {
        const job = jobById.get(result.id);
        if (!job) continue;
        nativeHandledIds.add(result.id);
        resultsById.set(result.id, {
          id: result.id,
          filePath: result.filePath ?? result.file_path ?? job.filePath,
          code: result.code,
          map: result.map ?? void 0,
          type: result.type ?? result.kind ?? "js",
          error: result.error ?? void 0
        });
      }
    } catch {
      nativeHandledIds.clear();
    }
  }
  const workerJobs = jobs.filter((job) => job.kind !== "js" || !nativeHandledIds.has(job.id));
  if (workerJobs.length > 0) {
    const pool = new TransformWorkerPool();
    try {
      const workerResults = await pool.runMany(
        workerJobs.map((job) => ({
          id: job.id,
          filePath: job.filePath,
          ext: job.ext,
          code: job.code
        }))
      );
      for (const result of workerResults) resultsById.set(result.id, result);
    } finally {
      await pool.close();
    }
  }
  return resultsById;
}
function computeDepsContentStampHash(depsAbs, moduleMetaById, workspaceRoot) {
  if (!depsAbs.length) return "0";
  const entries = [];
  for (const depAbs of depsAbs) {
    const abs = path9.resolve(depAbs);
    let hash = null;
    const depId = toWsModuleId(abs, workspaceRoot);
    if (depId) hash = moduleMetaById.get(depId)?.hash ?? null;
    if (!hash) {
      try {
        hash = getCacheKey(fs10.readFileSync(abs));
      } catch {
        hash = "missing";
      }
    }
    entries.push(`${depId ?? abs.replace(/\\+/g, "/")}:${hash}`);
  }
  entries.sort();
  return getCacheKey(entries.join("|"));
}
function buildCssCasDepProof(depsAbs, moduleMetaById, workspaceRoot) {
  const proofs = [];
  const seen = /* @__PURE__ */ new Set();
  for (const depAbs of depsAbs) {
    const abs = path9.resolve(depAbs);
    if (seen.has(abs)) continue;
    seen.add(abs);
    const depId = toWsModuleId(abs, workspaceRoot);
    if (depId && moduleMetaById.has(depId)) continue;
    try {
      const st = fs10.statSync(abs);
      if (!st.isFile()) continue;
      proofs.push({
        filePath: abs,
        dev: st.dev,
        ino: st.ino,
        mtimeMs: st.mtimeMs,
        ctimeMs: st.ctimeMs,
        size: st.size,
        hash: getCacheKey(fs10.readFileSync(abs))
      });
    } catch {
      proofs.push({
        filePath: abs,
        dev: 0,
        ino: 0,
        mtimeMs: 0,
        ctimeMs: 0,
        size: -1,
        hash: "missing"
      });
    }
  }
  return proofs.sort((a, b) => a.filePath.localeCompare(b.filePath));
}
function readJsonFile4(filePath) {
  if (!fs10.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs10.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
function writeJsonFile4(filePath, data) {
  fs10.mkdirSync(path9.dirname(filePath), { recursive: true });
  fs10.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}
`, "utf8");
}
function writeTextFile(filePath, contents) {
  fs10.mkdirSync(path9.dirname(filePath), { recursive: true });
  fs10.writeFileSync(filePath, contents, "utf8");
}

// src/core/production-chunk-publication.ts
function publishProductionChunkCas(options) {
  if (!native?.buildChunks) {
    throw new Error("Production Artifacts publication requires the native buildChunks binding to publish chunk artifacts.");
  }
  const start = Date.now();
  const rawArtifacts = native.buildChunks(options.plan, options.casRoot, options.configHash, options.nativeOptions ?? null) ?? [];
  let codeBytes = 0;
  let mapBytes = 0;
  for (const artifact of rawArtifacts) {
    codeBytes += typeof artifact.code_bytes === "number" ? artifact.code_bytes : Buffer.byteLength(artifact.code ?? "", "utf8");
    mapBytes += typeof artifact.map_bytes === "number" ? artifact.map_bytes : artifact.map ? Buffer.byteLength(artifact.map, "utf8") : 0;
  }
  const artifactManifestHash = getCacheKey(
    JSON.stringify(
      rawArtifacts.map((artifact) => ({
        id: typeof artifact.id === "string" ? artifact.id : "",
        fileName: typeof artifact.file_name === "string" ? artifact.file_name : "",
        codeBytes: typeof artifact.code_bytes === "number" ? artifact.code_bytes : Buffer.byteLength(artifact.code ?? "", "utf8"),
        mapBytes: typeof artifact.map_bytes === "number" ? artifact.map_bytes : artifact.map ? Buffer.byteLength(artifact.map, "utf8") : 0,
        assets: Array.isArray(artifact.assets) ? artifact.assets.map((asset) => ({
          fileName: typeof asset.file_name === "string" ? asset.file_name : "",
          source: typeof asset.source === "string" ? getCacheKey(asset.source) : ""
        })).sort((a, b) => a.fileName.localeCompare(b.fileName)) : []
      })).sort((a, b) => a.id.localeCompare(b.id))
    )
  );
  return {
    chunks: options.plan.chunks.length,
    artifacts: rawArtifacts.length,
    codeBytes,
    mapBytes,
    artifactManifestHash,
    ms: Date.now() - start
  };
}

// src/cli/commands/publish.ts
var DEPS_OPTIMIZER_OUTPUT_VERSION2 = getDepsOptimizerOutputVersion();
async function runPublishCommand(options = {}) {
  const phase = resolvePublicationPhase(options);
  if (!phase) {
    throw new Error("Unsupported Production Publishing target. Use `ionify publish --contracts` or `ionify publish --artifacts`.");
  }
  const targetLabel = phase === "B" ? "Production Artifacts" : "Production Contracts";
  const previousNodeEnv = process.env.NODE_ENV;
  const previousMode = process.env.MODE;
  const previousIonifyMode = process.env.IONIFY_MODE;
  const previousConfigHash = process.env.IONIFY_CONFIG_HASH;
  const previousDepsHash = process.env.IONIFY_DEPS_HASH;
  const previousVendorMaxChunkBytes = process.env.IONIFY_VENDOR_MAX_CHUNK_BYTES;
  try {
    process.env.NODE_ENV = "production";
    const mode = options.mode ?? process.env.IONIFY_MODE ?? process.env.MODE ?? "production";
    process.env.MODE = mode;
    process.env.IONIFY_MODE = mode;
    const config = await loadIonifyConfig(process.cwd(), mode);
    const projectRootOverride = config?.root ? path10.resolve(config.root) : null;
    const workspace = resolveWorkspace(projectRootOverride ?? process.cwd(), {
      projectRootOverride
    });
    const rootDir = workspace.projectRoot;
    const ionifyDir = workspace.ionifyDir;
    fs11.mkdirSync(ionifyDir, { recursive: true });
    process.env.IONIFY_PROJECT_ROOT = rootDir;
    process.env.IONIFY_WORKSPACE_ROOT = workspace.workspaceRoot;
    process.env.IONIFY_STATE_DIR = ionifyDir;
    process.env.IONIFY_WORKSPACE_ID = workspace.workspaceId;
    process.env.IONIFY_PROJECT_ID = workspace.projectId;
    const minifier = resolveMinifier(config, { envVar: process.env.IONIFY_MINIFIER });
    const parserMode = resolveParser(config, { envMode: process.env.IONIFY_PARSER });
    applyParserEnv(parserMode);
    const treeshake = resolveTreeshake(config?.treeshake, {
      envMode: process.env.IONIFY_TREESHAKE,
      includeEnv: process.env.IONIFY_TREESHAKE_INCLUDE,
      excludeEnv: process.env.IONIFY_TREESHAKE_EXCLUDE
    });
    const scopeHoist = resolveScopeHoist(config?.scopeHoist, {
      envMode: process.env.IONIFY_SCOPE_HOIST,
      inlineEnv: process.env.IONIFY_SCOPE_HOIST_INLINE,
      constantEnv: process.env.IONIFY_SCOPE_HOIST_CONST,
      combineEnv: process.env.IONIFY_SCOPE_HOIST_COMBINE
    });
    const envFromFiles = loadEnv(mode, rootDir);
    const envPrefix = config?.envPrefix || ["VITE_", "IONIFY_"];
    const defineConfig = buildDefineConfig(config?.define, {
      ...envFromFiles,
      NODE_ENV: "production",
      MODE: mode
    }, envPrefix);
    logInfo(`[publish] Production define contract: ${Object.keys(defineConfig).length} replacement(s)`);
    const resolvedEntries = resolveProductionBuildEntries(config, rootDir, (message) => logWarn(message));
    const rawVersionInputs = createProductionGraphVersionInputs({
      config,
      parserMode,
      minifier,
      treeshake,
      scopeHoist,
      entries: resolvedEntries.entries
    });
    const configHash = computeGraphVersion(rawVersionInputs);
    process.env.IONIFY_CONFIG_HASH = configHash;
    const productionChunkPolicy = resolveProductionChunkPolicy(config);
    if (productionChunkPolicy.vendorMaxBytes !== null) {
      process.env.IONIFY_VENDOR_MAX_CHUNK_BYTES = String(productionChunkPolicy.vendorMaxBytes);
    } else {
      delete process.env.IONIFY_VENDOR_MAX_CHUNK_BYTES;
    }
    const lockfile = readLockfile(workspace.workspaceRoot, rootDir);
    const depsSourcemapEnabled = config?.optimizeDeps?.sourcemap === true;
    const depsBundleEsmEnabled = config?.optimizeDeps?.bundleEsm !== false;
    const depsSharedChunksRaw = config?.optimizeDeps?.sharedChunks;
    const depsSharedChunksMode = depsSharedChunksRaw === void 0 || depsSharedChunksRaw === "auto" ? "auto" : depsSharedChunksRaw === true ? "1" : depsSharedChunksRaw === false ? "0" : String(depsSharedChunksRaw);
    const depsHash = computeDepsHash(configHash, lockfile, {
      nodeEnv: "production",
      sourcemap: depsSourcemapEnabled,
      bundleEsm: depsBundleEsmEnabled,
      sharedChunks: depsSharedChunksMode,
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION2
    });
    process.env.IONIFY_DEPS_HASH = depsHash;
    const identity = {
      productionPlanOutputVersion: PRODUCTION_PLAN_OUTPUT_VERSION,
      mode,
      nodeEnv: "production",
      configHash,
      depsHash,
      depsOptimizerOutputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION2,
      entries: resolvedEntries.entries ?? [],
      entrySource: resolvedEntries.source
    };
    const depsRoot = path10.join(ionifyDir, "deps", depsHash);
    const casRoot = path10.join(ionifyDir, "cas");
    const priorPublicationState = readProductionPublicationState(ionifyDir);
    const priorPublishedPlan = readProductionPublicationPlan(ionifyDir, identity);
    const priorPlanFreshness = priorPublishedPlan ? auditProductionSourceFreshness(
      priorPublishedPlan,
      ionifyDir,
      workspace.workspaceRoot,
      casRoot,
      configHash
    ) : null;
    let dplGenerationCurrent = false;
    if (priorPublishedPlan && priorPlanFreshness?.current === true) {
      try {
        dplGenerationCurrent = native?.depsVerifiedGenerationCurrent?.(depsRoot) === true;
      } catch {
        dplGenerationCurrent = false;
      }
    }
    const reusableContractsPlan = priorPublishedPlan !== null && priorPlanFreshness?.current === true && dplGenerationCurrent && priorPublicationState?.state === "published" && priorPublicationState.tiers.deps.state === "published" && priorPublicationState.tiers.graph.state === "published" && priorPublicationState.tiers.plan.state === "published" && priorPublicationState.tiers.transforms.state === "published";
    if (phase === "A" && reusableContractsPlan) {
      clearProductionPublicationProgress(ionifyDir);
      logInfo(
        `[publish] Production Contracts are current (DPL generation, Planner identity, source proof, and Transform artifacts verified); no publication work required.`
      );
      return;
    }
    const state = createProductionPublicationState(identity, phase, "publishing");
    if (reusableContractsPlan && priorPublicationState) {
      state.planHash = priorPublicationState.planHash;
      state.tiers.deps = {
        ...priorPublicationState.tiers.deps,
        state: "published",
        ms: 0,
        reason: "Reused identity- and source-verified Production Contracts publication"
      };
      state.tiers.graph = {
        ...priorPublicationState.tiers.graph,
        state: "published",
        ms: 0,
        reason: "Reused identity- and source-verified Production Contracts publication"
      };
      state.tiers.plan = {
        ...priorPublicationState.tiers.plan,
        state: "published",
        ms: 0,
        reason: "Reused identity- and source-verified Production Contracts publication"
      };
      state.timingsMs.deps = 0;
      state.timingsMs.plan = 0;
      state.timingsMs.pdc = 0;
    }
    writeProductionPublicationProgress(ionifyDir, state);
    logInfo(
      `[publish] Publishing ${targetLabel} (configHash=${configHash}, depsHash=${depsHash})`
    );
    let plan;
    let readinessPlanForIdentity;
    const federationExposeEntries = collectFederationExposeEntryPaths(config, rootDir);
    if (reusableContractsPlan && priorPublishedPlan) {
      readinessPlanForIdentity = JSON.parse(JSON.stringify(priorPublishedPlan));
      plan = JSON.parse(JSON.stringify(priorPublishedPlan));
      logInfo("[publish] Reusing source-verified Production Contracts for Production Artifacts");
    } else {
      if (phase === "B" && priorPublishedPlan) {
        logInfo(
          `[publish] Production Contracts reuse rejected (${priorPlanFreshness?.reason ?? "publication-tiers-incomplete"}); recomputing fail-closed`
        );
      }
      const depsStart = Date.now();
      const dependencyPreparation = await runBuildCommand({
        depsOnly: true,
        mode,
        publicationContracts: true
      });
      state.tiers.deps = {
        state: "published",
        artifactCount: countManifestEntries(depsRoot),
        ms: Date.now() - depsStart
      };
      state.timingsMs.deps = state.tiers.deps.ms ?? 0;
      writeProductionPublicationProgress(ionifyDir, { ...state, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
      const planStart = Date.now();
      if (dependencyPreparation?.canonicalPlan) {
        plan = JSON.parse(JSON.stringify(dependencyPreparation.canonicalPlan));
      } else {
        const buildEntries = Array.from(/* @__PURE__ */ new Set([...resolvedEntries.entries ?? [], ...federationExposeEntries]));
        plan = await generateBuildPlan(
          buildEntries.length > 0 ? buildEntries : void 0,
          rawVersionInputs,
          loadDepStopsFromManifest(depsRoot),
          collectConfiguredExternalSpecifiers(config)
        );
        await prepareCanonicalProductionDependencyPlan({
          plan,
          rootDir,
          ionifyDir,
          depsRoot,
          depsHash,
          resolvedEntries: resolvedEntries.entries ?? [],
          allowedRoots: workspace.allowedRoots,
          casRoot,
          configHash,
          workspaceRoot: workspace.workspaceRoot,
          config,
          // Publish MUST prepare the plan identically to `ionify build`, or the
          // published plan (and its Tier-4 chunks) diverge from what build produces.
          vendorMaxBytes: productionChunkPolicy.vendorMaxBytes
        });
      }
      readinessPlanForIdentity = JSON.parse(JSON.stringify(plan));
      state.planHash = writeProductionPublicationPlan(
        ionifyDir,
        identity,
        readinessPlanForIdentity
      );
      const planSummary2 = summarizePlanForPublication(plan);
      state.tiers.graph = {
        state: "published",
        artifactCount: planSummary2.modules,
        ms: Date.now() - planStart
      };
      state.tiers.plan = {
        state: "published",
        artifactCount: planSummary2.chunks,
        ms: state.tiers.graph.ms
      };
      state.timingsMs.plan = state.tiers.plan.ms ?? 0;
      state.timingsMs.pdc = 0;
    }
    const planSummary = summarizePlanForPublication(plan);
    state.tiers.transforms = { state: "publishing" };
    writeProductionPublicationProgress(ionifyDir, { ...state, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
    const transformResult = await publishProductionTransformCas({
      plan,
      casRoot,
      configHash,
      workspaceRoot: workspace.workspaceRoot,
      parserMode,
      defineConfig
    });
    let tier4ChunkManifestHash = null;
    state.tiers.transforms = {
      state: "published",
      artifactCount: transformResult.transformed + transformResult.defineDerived,
      ms: transformResult.ms,
      reason: `modules=${transformResult.modules}, hits=${transformResult.hits}, js=${transformResult.js}, css=${transformResult.css}`
    };
    state.timingsMs.transforms = transformResult.ms;
    if (phase === "B") {
      state.tiers.chunks = { state: "publishing" };
      state.tiers.compression = { state: "skipped", reason: "Compression artifact publication is not implemented yet" };
      writeProductionPublicationProgress(ionifyDir, { ...state, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
      const buildMinifyRaw = config?.build?.minify;
      const minifyEnabled = buildMinifyRaw === false ? false : true;
      const federationExposeEntryIds = federationExposeEntries.map((entry) => toWsModuleId(entry, workspace.workspaceRoot)).filter((entryId) => typeof entryId === "string" && entryId.length > 0);
      const chunkResult = publishProductionChunkCas({
        plan,
        casRoot,
        configHash,
        nativeOptions: {
          minifier,
          minify: minifyEnabled,
          mangle: minifyEnabled,
          treeshake,
          scopeHoist,
          externalModules: collectNativeExternalModules(plan, collectConfiguredExternalSpecifiers(config)),
          federationExposeEntries: federationExposeEntryIds
        }
      });
      state.tiers.chunks = {
        state: "published",
        artifactCount: chunkResult.artifacts,
        byteCount: chunkResult.codeBytes + chunkResult.mapBytes,
        ms: chunkResult.ms,
        reason: `chunks=${chunkResult.chunks}, codeBytes=${chunkResult.codeBytes}, mapBytes=${chunkResult.mapBytes}`
      };
      tier4ChunkManifestHash = chunkResult.artifactManifestHash;
      state.timingsMs.chunks = chunkResult.ms;
    }
    state.state = "published";
    state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    writeProductionPublicationState(ionifyDir, state);
    clearProductionPublicationProgress(ionifyDir);
    try {
      const readinessWrite = writeProductionPublicationReadinessRecord(
        ionifyDir,
        createPartialProductionReadinessRecord({
          producer: phase === "B" ? "publish-artifacts" : "publish-contracts",
          configHash,
          workspaceRoot: workspace.workspaceRoot,
          projectRoot: rootDir,
          depsHash,
          plan: readinessPlanForIdentity,
          tier4ChunkManifestHash,
          depsOptimizerOutputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION2
        })
      );
      if (readinessWrite === "verified-preserved") {
        logInfo("[PRA] Preserved exact deploy-ready proof; PAP published no dist mutation");
      }
    } catch (err) {
      logWarn(`[PRA] Skipped partial deploy-ready.v1 emit during publish: ${err instanceof Error ? err.message : String(err)}`);
    }
    logInfo(
      `[publish] Published ${targetLabel} (${planSummary.entries} entries, ${planSummary.chunks} chunks, ${planSummary.modules} modules, transform artifacts=${transformResult.transformed}, hits=${transformResult.hits}${phase === "B" ? ", chunk artifacts=yes" : ""}); no build output written.`
    );
  } catch (err) {
    logError("ionify publish failed", err);
    throw err;
  } finally {
    if (previousNodeEnv === void 0) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousMode === void 0) delete process.env.MODE;
    else process.env.MODE = previousMode;
    if (previousIonifyMode === void 0) delete process.env.IONIFY_MODE;
    else process.env.IONIFY_MODE = previousIonifyMode;
    if (previousConfigHash === void 0) delete process.env.IONIFY_CONFIG_HASH;
    else process.env.IONIFY_CONFIG_HASH = previousConfigHash;
    if (previousDepsHash === void 0) delete process.env.IONIFY_DEPS_HASH;
    else process.env.IONIFY_DEPS_HASH = previousDepsHash;
    if (previousVendorMaxChunkBytes === void 0) delete process.env.IONIFY_VENDOR_MAX_CHUNK_BYTES;
    else process.env.IONIFY_VENDOR_MAX_CHUNK_BYTES = previousVendorMaxChunkBytes;
  }
}
function resolvePublicationPhase(options) {
  if (options.contracts && options.artifacts) {
    throw new Error("Choose either `ionify publish --contracts` or `ionify publish --artifacts`, not both.");
  }
  if (options.artifacts) return "B";
  if (options.contracts) return "A";
  return normalizePublicationPhase(options.phase);
}
function normalizePublicationPhase(phase) {
  if (phase === void 0) return "A";
  const normalized = String(phase ?? "A").trim().toUpperCase();
  if (normalized === "A" || normalized === "CONTRACTS" || normalized === "PRODUCTION_CONTRACTS") return "A";
  if (normalized === "B" || normalized === "ARTIFACTS" || normalized === "PRODUCTION_ARTIFACTS") return "B";
  return null;
}
function countManifestEntries(depsRoot) {
  try {
    const manifest = JSON.parse(fs11.readFileSync(path10.join(depsRoot, "manifest.json"), "utf8"));
    return Object.keys(manifest?.entries ?? {}).length;
  } catch {
    return 0;
  }
}

// src/cli/commands/add.ts
import fs12 from "fs";
import path11 from "path";

// src/cli/components/registry.ts
function normalizeNewlines(value) {
  return value.replace(/\r\n/g, "\n");
}
var BUTTON_TSX = normalizeNewlines(`import * as React from "react";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "secondary" | "ghost";
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", className = "", ...props }, ref) => {
    const base = "ionify-button";
    const v =
      variant === "secondary"
        ? "ionify-button--secondary"
        : variant === "ghost"
          ? "ionify-button--ghost"
          : "";
    const cn = [base, v, className].filter(Boolean).join(" ");
    return <button ref={ref} className={cn} {...props} />;
  },
);
Button.displayName = "Button";
`);
var BUTTON_JSX = normalizeNewlines(`import * as React from "react";

export const Button = React.forwardRef(function Button(
  { variant = "default", className = "", ...props },
  ref,
) {
  const base = "ionify-button";
  const v =
    variant === "secondary"
      ? "ionify-button--secondary"
      : variant === "ghost"
        ? "ionify-button--ghost"
        : "";
  const cn = [base, v, className].filter(Boolean).join(" ");
  return <button ref={ref} className={cn} {...props} />;
});
`);
var CARD_TSX = normalizeNewlines(`import * as React from "react";

export function Card({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={["ionify-card", className].filter(Boolean).join(" ")} {...props} />;
}

export function CardHeader({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={["ionify-card__header", className].filter(Boolean).join(" ")} {...props} />;
}

export function CardTitle({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={["ionify-card__title", className].filter(Boolean).join(" ")} {...props} />;
}

export function CardContent({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={["ionify-card__content", className].filter(Boolean).join(" ")} {...props} />;
}
`);
var CARD_JSX = normalizeNewlines(`import * as React from "react";

export function Card({ className = "", ...props }) {
  return <div className={["ionify-card", className].filter(Boolean).join(" ")} {...props} />;
}

export function CardHeader({ className = "", ...props }) {
  return <div className={["ionify-card__header", className].filter(Boolean).join(" ")} {...props} />;
}

export function CardTitle({ className = "", ...props }) {
  return <h3 className={["ionify-card__title", className].filter(Boolean).join(" ")} {...props} />;
}

export function CardContent({ className = "", ...props }) {
  return <div className={["ionify-card__content", className].filter(Boolean).join(" ")} {...props} />;
}
`);
var DIALOG_TSX = normalizeNewlines(`import * as React from "react";

type DialogContextValue = {
  open: boolean;
  setOpen(next: boolean): void;
};

const DialogContext = React.createContext<DialogContextValue | null>(null);

function useDialogContext(): DialogContextValue {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error("Dialog components must be used inside <Dialog />");
  return ctx;
}

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange(next: boolean): void;
  children: React.ReactNode;
}) {
  const value = React.useMemo(
    () => ({ open, setOpen: onOpenChange }),
    [open, onOpenChange],
  );
  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
}

export function DialogTrigger({
  children,
}: {
  children: React.ReactElement;
}) {
  const { open, setOpen } = useDialogContext();
  return React.cloneElement(children, {
    onClick: (e: any) => {
      children.props.onClick?.(e);
      setOpen(!open);
    },
  });
}

export function DialogOverlay({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { open, setOpen } = useDialogContext();
  if (!open) return null;
  return (
    <div
      className={["ionify-dialog__overlay", className].filter(Boolean).join(" ")}
      onClick={() => setOpen(false)}
      {...props}
    />
  );
}

export function DialogContent({
  className = "",
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { open } = useDialogContext();
  if (!open) return null;
  return <div className={["ionify-dialog__content", className].filter(Boolean).join(" ")} {...props} />;
}
`);
var DIALOG_JSX = normalizeNewlines(`import * as React from "react";

const DialogContext = React.createContext(null);

function useDialogContext() {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error("Dialog components must be used inside <Dialog />");
  return ctx;
}

export function Dialog({ open, onOpenChange, children }) {
  const value = React.useMemo(
    () => ({ open, setOpen: onOpenChange }),
    [open, onOpenChange],
  );
  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
}

export function DialogTrigger({ children }) {
  const { open, setOpen } = useDialogContext();
  return React.cloneElement(children, {
    onClick: (e) => {
      children.props.onClick?.(e);
      setOpen(!open);
    },
  });
}

export function DialogOverlay({ className = "", ...props }) {
  const { open, setOpen } = useDialogContext();
  if (!open) return null;
  return (
    <div
      className={["ionify-dialog__overlay", className].filter(Boolean).join(" ")}
      onClick={() => setOpen(false)}
      {...props}
    />
  );
}

export function DialogContent({ className = "", ...props }) {
  const { open } = useDialogContext();
  if (!open) return null;
  return <div className={["ionify-dialog__content", className].filter(Boolean).join(" ")} {...props} />;
}
`);
var IONIFY_COMPONENTS = {
  button: {
    name: "button",
    description: "Basic <Button /> with variants (no external deps)",
    fileBase: "button",
    tsx: BUTTON_TSX,
    jsx: BUTTON_JSX
  },
  card: {
    name: "card",
    description: "Card primitives (<Card />, <CardHeader />, etc.)",
    fileBase: "card",
    tsx: CARD_TSX,
    jsx: CARD_JSX
  },
  dialog: {
    name: "dialog",
    description: "Lightweight dialog primitives (context-based, no external deps)",
    fileBase: "dialog",
    tsx: DIALOG_TSX,
    jsx: DIALOG_JSX
  }
};

// src/cli/commands/add.ts
function findProjectRoot(startDir) {
  let dir = path11.resolve(startDir);
  for (let i = 0; i < 15; i++) {
    const pkg = path11.join(dir, "package.json");
    if (fs12.existsSync(pkg) && fs12.statSync(pkg).isFile()) return dir;
    const parent = path11.dirname(dir);
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return null;
}
function isTypeScriptProject(projectRoot) {
  const tsconfig = path11.join(projectRoot, "tsconfig.json");
  if (fs12.existsSync(tsconfig) && fs12.statSync(tsconfig).isFile()) return true;
  try {
    const pkg = JSON.parse(fs12.readFileSync(path11.join(projectRoot, "package.json"), "utf8"));
    const deps = { ...pkg?.dependencies ?? {}, ...pkg?.devDependencies ?? {} };
    return typeof deps.typescript === "string";
  } catch {
    return false;
  }
}
async function runAddCommand(componentName, options = {}) {
  const { list, force } = options;
  const templates = IONIFY_COMPONENTS;
  if (list || !componentName) {
    const names = Object.keys(templates).sort();
    logInfo(`Available components (${names.length}):`);
    for (const name of names) {
      const t = templates[name];
      console.log(`- ${t.name}: ${t.description}`);
    }
    if (!componentName) return;
  }
  const normalized = String(componentName ?? "").trim().toLowerCase();
  const template = templates[normalized];
  if (!template) {
    logError(`Unknown component '${componentName}'. Use 'ionify add --list' to see available components.`);
    process.exitCode = 1;
    return;
  }
  const projectRoot = findProjectRoot(process.cwd());
  if (!projectRoot) {
    logError("Could not find project root (package.json). Run this inside a project directory.");
    process.exitCode = 1;
    return;
  }
  const ts = isTypeScriptProject(projectRoot);
  const targetDir = path11.resolve(projectRoot, options.dir ?? "src/components/ui");
  const ext = ts ? "tsx" : "jsx";
  const outFile = path11.join(targetDir, `${template.fileBase}.${ext}`);
  fs12.mkdirSync(targetDir, { recursive: true });
  if (fs12.existsSync(outFile) && !force) {
    logError(`File already exists: ${outFile} (use --force to overwrite)`);
    process.exitCode = 1;
    return;
  }
  const code = ts ? template.tsx : template.jsx;
  fs12.writeFileSync(outFile, code, "utf8");
  logInfo(`Added ${template.name} \u2192 ${path11.relative(projectRoot, outFile)}`);
}

// src/cli/commands/push.ts
import fs15 from "fs";
import path14 from "path";

// src/cli/utils/cloud-binding.ts
import childProcess from "child_process";
import crypto3 from "crypto";
import fs13 from "fs";
import os2 from "os";
import path12 from "path";
var BINDINGS_FILE = path12.join(os2.homedir(), ".ionify", "bindings.json");
function normalizeProjectSlug(input) {
  const cleaned = input.trim().replace(/^@/, "").replace(/\//g, "-").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
  return cleaned || "ionify-project";
}
function normalizeGitRemoteUrl(input) {
  let raw = input.trim();
  if (!raw) return "";
  raw = raw.replace(/\/+$/, "");
  const scpLike = raw.match(/^(?:([^@/:]+)@)?([^/:]+):(.+)$/);
  if (scpLike && !raw.includes("://")) {
    const host = scpLike[2].toLowerCase();
    const repoPath = normalizeRemotePath(scpLike[3]);
    return `https://${host}/${repoPath}`;
  }
  try {
    const url2 = new URL(raw);
    url2.username = "";
    url2.password = "";
    const host = url2.host.toLowerCase();
    const repoPath = normalizeRemotePath(url2.pathname);
    return `https://${host}/${repoPath}`;
  } catch {
    return normalizeRemotePath(raw).toLowerCase();
  }
}
function normalizeRemotePath(input) {
  return input.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/i, "").replace(/\/{2,}/g, "/");
}
function computeFingerprintV1(parts) {
  const canonical = `ionify:fingerprint:v1
remote=${parts.normalizedRemote}
workspace=${parts.workspaceRelPath}
slug=${normalizeProjectSlug(parts.projectSlug)}
`;
  return crypto3.createHash("sha256").update(canonical).digest("hex");
}
function resolveBindingContext(workspace, opts = {}) {
  const git = readGitRepositoryInfo(workspace.projectRoot);
  const projectSlug = normalizeProjectSlug(opts.projectSlug ?? inferProjectSlug(workspace.projectRoot));
  const workspaceRelPath = normalizeWorkspaceRelPath(
    git?.repositoryRoot ? path12.relative(git.repositoryRoot, workspace.projectRoot) : workspace.projectRelPath
  );
  const normalizedRemote = git?.normalizedRemote ?? null;
  const fingerprint = normalizedRemote ? computeFingerprintV1({ normalizedRemote, workspaceRelPath, projectSlug }) : null;
  return {
    normalizedRemote,
    repositoryRoot: git?.repositoryRoot ?? null,
    workspaceRelPath,
    projectSlug,
    fingerprint,
    localPathHash: computeLocalPathHash(workspace.projectRoot)
  };
}
function bindProject(workspace, opts) {
  const context = resolveBindingContext(workspace, { projectSlug: opts.projectSlug });
  if (!context.normalizedRemote && !opts.allowLocal) {
    throw stacklessError(
      "bind: no git remote was found for this folder.\n  Ionify will not create a trusted binding automatically.\n  For local experiments, run `ionify bind --project <project-id> --allow-local`."
    );
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const binding = {
    version: 1,
    projectId: opts.projectId,
    apiUrl: opts.apiUrl,
    projectSlug: context.projectSlug,
    bindingType: context.normalizedRemote ? "git_verified" : "local_unverified",
    fingerprint: context.fingerprint,
    normalizedRemote: context.normalizedRemote,
    workspaceRelPath: context.workspaceRelPath,
    localProjectRelPath: workspace.projectRelPath,
    localPathHash: context.localPathHash,
    createdAt: now,
    updatedAt: now
  };
  writeProjectBinding(binding);
  return binding;
}
function resolveProjectBinding(workspace) {
  const bindings = readBindingsFile()?.bindings ?? [];
  if (bindings.length === 0) return null;
  for (const entry of bindings) {
    if (entry.bindingType !== "git_verified") continue;
    const context2 = resolveBindingContext(workspace, { projectSlug: entry.projectSlug });
    if (context2.fingerprint && entry.fingerprint === context2.fingerprint) {
      return { binding: entry, context: context2 };
    }
  }
  const context = resolveBindingContext(workspace);
  const localMatch = bindings.find((entry) => entry.localPathHash === context.localPathHash);
  if (localMatch) {
    return {
      binding: localMatch,
      context: resolveBindingContext(workspace, { projectSlug: localMatch.projectSlug })
    };
  }
  return null;
}
function assertValidProjectBinding(resolved, command, expectedProjectId) {
  if (!resolved) {
    throw stacklessError(
      `${command}: this folder is not bound to an Ionify Cloud project.
  Run \`ionify bind --project <project-id>\` from the project root.
  For local experiments without a git remote, use \`--allow-local\` explicitly.`
    );
  }
  const { binding, context } = resolved;
  if (expectedProjectId && expectedProjectId !== binding.projectId) {
    throw stacklessError(
      `${command}: cloud.projectId does not match this folder's binding.
  binding project : ${binding.projectId}
  config project  : ${expectedProjectId}
  Re-bind this folder or update the config before pushing.`
    );
  }
  if (binding.bindingType === "local_unverified" && binding.localPathHash !== context.localPathHash) {
    throw stacklessError(
      `${command}: the saved local binding is invalid for this folder.
  Local unverified bindings are path-scoped and must be recreated after moving a project.`
    );
  }
  return binding;
}
function bindingWarning(resolved) {
  const { binding, context } = resolved;
  if (binding.bindingType === "git_verified" && context.fingerprint && binding.fingerprint !== context.fingerprint) {
    return "[cloud] Fingerprint V1 changed for this bound folder. Continuing because authorization is token/RBAC/project-binding based; audit metadata will be sent.";
  }
  if (binding.bindingType === "local_unverified") {
    return "[cloud] local_unverified project binding in use. Allowed for local experiments; do not use this binding for CI/team workflows.";
  }
  return null;
}
function writeProjectBinding(binding) {
  const dir = path12.dirname(BINDINGS_FILE);
  fs13.mkdirSync(dir, { recursive: true });
  const existing = readBindingsFile()?.bindings ?? [];
  const next = existing.filter((entry) => {
    if (binding.bindingType === "git_verified" && entry.fingerprint === binding.fingerprint) return false;
    if (entry.localPathHash === binding.localPathHash) return false;
    return true;
  });
  next.push(binding);
  fs13.writeFileSync(
    BINDINGS_FILE,
    JSON.stringify({ bindings: next }, null, 2) + "\n",
    { encoding: "utf8", mode: 384 }
  );
}
function readBindingsFile() {
  if (!fs13.existsSync(BINDINGS_FILE)) return null;
  try {
    const raw = fs13.readFileSync(BINDINGS_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function readGitRepositoryInfo(startDir) {
  const repositoryRoot = execGit(startDir, ["rev-parse", "--show-toplevel"]);
  if (!repositoryRoot) return null;
  const remote = execGit(repositoryRoot, ["config", "--get", "remote.origin.url"]);
  return {
    repositoryRoot: path12.resolve(repositoryRoot),
    normalizedRemote: remote ? normalizeGitRemoteUrl(remote) : null
  };
}
function execGit(cwd, args) {
  try {
    return childProcess.execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim() || null;
  } catch {
    return null;
  }
}
function inferProjectSlug(projectRoot) {
  const pkgPath = path12.join(projectRoot, "package.json");
  try {
    const pkg = JSON.parse(fs13.readFileSync(pkgPath, "utf8"));
    if (typeof pkg.name === "string" && pkg.name.trim()) return pkg.name;
  } catch {
  }
  return path12.basename(projectRoot);
}
function normalizeWorkspaceRelPath(input) {
  const normalized = input.split(path12.sep).join("/").replace(/^\.\/?$/, "");
  return normalized && normalized !== "." ? normalized : "root";
}
function computeLocalPathHash(projectRoot) {
  return crypto3.createHash("sha256").update(`ionify:local-binding:v1:${path12.resolve(projectRoot)}`).digest("hex");
}
function stacklessError(message) {
  const error = new Error(message);
  error.stack = void 0;
  return error;
}

// src/cli/utils/cloud-client.ts
import https2 from "https";
import http2 from "http";
import { URL as URL2 } from "url";
import crypto4 from "crypto";
var CloudApiError = class extends Error {
  constructor(statusCode, body, message, parsedBody = parseCloudApiErrorBody(body)) {
    super(message);
    this.statusCode = statusCode;
    this.body = body;
    this.parsedBody = parsedBody;
    this.name = "CloudApiError";
  }
};
function parseCloudApiErrorBody(body) {
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object") return {};
    const record = parsed;
    return {
      error: typeof record.error === "string" ? record.error : void 0,
      message: typeof record.message === "string" ? record.message : void 0,
      limit_kind: typeof record.limit_kind === "string" ? record.limit_kind : void 0,
      scope: typeof record.scope === "string" ? record.scope : void 0,
      current_value: typeof record.current_value === "number" ? record.current_value : void 0,
      limit_value: typeof record.limit_value === "number" ? record.limit_value : void 0,
      retry_after_secs: typeof record.retry_after_secs === "number" ? record.retry_after_secs : void 0,
      retryable: typeof record.retryable === "boolean" ? record.retryable : void 0
    };
  } catch {
    return {};
  }
}
var CloudUnreachableError = class extends Error {
  constructor(cause) {
    super(
      `Cloud unreachable: ${cause instanceof Error ? cause.message : String(cause)}`
    );
    this.name = "CloudUnreachableError";
    if (cause instanceof Error) this.cause = cause;
  }
};
var CloudClient = class {
  baseUrl;
  token;
  projectId;
  binding;
  intent;
  constructor(opts) {
    this.baseUrl = opts.apiUrl.replace(/\/$/, "");
    this.token = opts.token;
    this.projectId = opts.projectId;
    this.binding = opts.binding ?? null;
    this.intent = opts.intent ?? "read";
  }
  // ── CDC (Tier-2) ─────────────────────────────────────────────────────────
  async createSession(depsHash, optimizerVersion, nodeEnv) {
    const body = JSON.stringify({
      deps_hash: depsHash,
      optimizer_version: optimizerVersion,
      node_env: nodeEnv
    });
    const res = await this._request(
      "POST",
      `/v1/deps-cache/sessions?project_id=${this.projectId}`,
      body,
      { "Content-Type": "application/json" }
    );
    return res.json;
  }
  async uploadArtifact(sessionId, artifactType, cacheKey, bytes, contentHash) {
    const resolvedContentHash = contentHash ?? computeContentHash(bytes);
    const encodedKey = encodeURIComponent(cacheKey);
    const res = await this._request(
      "PUT",
      `/v1/deps-cache/sessions/${sessionId}/artifacts/${artifactType}/${encodedKey}?project_id=${this.projectId}`,
      bytes,
      {
        "Content-Type": "application/octet-stream",
        "x-content-hash": resolvedContentHash
      }
    );
    return res.json;
  }
  async attachArtifact(sessionId, artifactType, cacheKey, contentHash) {
    const encodedKey = encodeURIComponent(cacheKey);
    const res = await this._request(
      "POST",
      `/v1/deps-cache/sessions/${sessionId}/artifact-links/${artifactType}/${encodedKey}?project_id=${this.projectId}`,
      JSON.stringify({ content_hash: contentHash }),
      { "Content-Type": "application/json" }
    );
    return res.json;
  }
  async completeSession(sessionId) {
    const res = await this._request(
      "POST",
      `/v1/deps-cache/sessions/${sessionId}/complete?project_id=${this.projectId}`,
      "",
      {}
    );
    return res.json;
  }
  /**
   * Look up a committed CDC session. Returns null if none exists (cache miss).
   * This is the hydration entry point.
   */
  async lookupSession(depsHash, optimizerVersion, nodeEnv) {
    const qs = new URLSearchParams({
      project_id: this.projectId,
      deps_hash: depsHash,
      optimizer_version: optimizerVersion,
      node_env: nodeEnv
    });
    try {
      const res = await this._request(
        "GET",
        `/v1/deps-cache/sessions?${qs}`,
        null,
        this.writeProbeHeaders()
      );
      return res.json;
    } catch (err) {
      if (err instanceof CloudApiError && err.statusCode === 404) return null;
      throw err;
    }
  }
  async downloadArtifact(sessionId, artifactType, cacheKey) {
    const encodedKey = encodeURIComponent(cacheKey);
    const res = await this._request(
      "GET",
      `/v1/deps-cache/sessions/${sessionId}/artifacts/${artifactType}/${encodedKey}?project_id=${this.projectId}`,
      null,
      {}
    );
    return res.raw;
  }
  async putBlob(bytes) {
    const res = await this._request(
      "POST",
      `/v1/blobs?project_id=${this.projectId}`,
      bytes,
      { "Content-Type": "application/octet-stream" }
    );
    const raw = res.json;
    return { blob_hash: raw.hash, size_bytes: raw.size_bytes };
  }
  async getNamespace(scope, name) {
    const res = await this._request(
      "GET",
      `/v1/namespaces/${encodeURIComponent(scope)}/${encodeURIComponent(name)}?project_id=${this.projectId}`,
      null,
      this.writeProbeHeaders()
    );
    const raw = res.json;
    return { version: raw.version, etag: raw.etag, current_manifest_hash: raw.current_manifest_hash };
  }
  /**
   * Create a namespace. Used by push when the target namespace does not exist
   * yet (first push for a project). Cloud API requires the namespace to exist
   * before `publishManifest` will accept entries.
   */
  async createNamespace(scope, name) {
    const body = JSON.stringify({
      project_id: this.projectId,
      scope,
      name
    });
    const res = await this._request(
      "POST",
      `/v1/namespaces`,
      body,
      { "Content-Type": "application/json" }
    );
    const raw = res.json;
    return { version: raw.version, etag: raw.etag, current_manifest_hash: raw.current_manifest_hash };
  }
  async getBlobBytes(hash) {
    const res = await this._request(
      "GET",
      `/v1/blobs/${hash}/bytes?project_id=${this.projectId}`,
      null,
      {}
    );
    return res.raw;
  }
  async publishManifest(req) {
    const body = JSON.stringify({
      project_id: this.projectId,
      scope: req.scope,
      name: req.name,
      expected_namespace_version: req.expected_namespace_version,
      entries: req.entries
    });
    const res = await this._request(
      "POST",
      `/v1/manifests?project_id=${this.projectId}`,
      body,
      { "Content-Type": "application/json" }
    );
    return res.json;
  }
  async getManifest(manifestHash) {
    const res = await this._request(
      "GET",
      `/v1/manifests/${encodeURIComponent(manifestHash)}?project_id=${this.projectId}`,
      null,
      {}
    );
    const raw = res.json;
    return { manifest_hash: raw.manifest_hash, entries: raw.entries, version: raw.version };
  }
  async getUsage() {
    const res = await this._request(
      "GET",
      `/v1/usage?project_id=${this.projectId}`,
      null,
      {}
    );
    return res.json;
  }
  // ── Internal HTTP ─────────────────────────────────────────────────────────
  async _request(method, urlPath, body, extraHeaders) {
    const fullUrl = new URL2(this.baseUrl + urlPath);
    const bodyBuf = body === null ? null : typeof body === "string" ? Buffer.from(body, "utf8") : body;
    const headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
      ...extraHeaders
    };
    if (this.binding) {
      headers["x-ionify-binding-type"] = this.binding.bindingType;
      headers["x-ionify-project-slug"] = this.binding.projectSlug;
      if (this.binding.normalizedRemote) {
        headers["x-ionify-normalized-remote"] = this.binding.normalizedRemote;
      }
      if (this.binding.workspaceRelPath) {
        headers["x-ionify-workspace-rel-path"] = this.binding.workspaceRelPath;
      }
      if (this.binding.localProjectRelPath) {
        headers["x-ionify-local-project-rel-path"] = this.binding.localProjectRelPath;
      }
      if (this.binding.fingerprint) {
        headers["x-ionify-fingerprint-v1"] = this.binding.fingerprint;
      }
    }
    if (bodyBuf !== null) {
      headers["Content-Length"] = String(bodyBuf.length);
    }
    const maxAttempts = 8;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const chunks = [];
      let statusCode = 0;
      await new Promise((resolve, reject) => {
        const transport = fullUrl.protocol === "https:" ? https2 : http2;
        const req = transport.request(
          {
            hostname: fullUrl.hostname,
            port: fullUrl.port || (fullUrl.protocol === "https:" ? 443 : 80),
            path: fullUrl.pathname + fullUrl.search,
            method,
            headers
          },
          (res) => {
            statusCode = res.statusCode ?? 0;
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", resolve);
            res.on("error", reject);
          }
        );
        req.on("error", (err) => reject(new CloudUnreachableError(err)));
        if (bodyBuf !== null) req.write(bodyBuf);
        req.end();
      });
      const raw = Buffer.concat(chunks);
      const text = raw.toString("utf8");
      if (statusCode >= 400) {
        const parsedBody = parseCloudApiErrorBody(text);
        if (shouldRetryCloudRateLimit(statusCode, parsedBody, attempt, maxAttempts)) {
          await sleep((parsedBody.retry_after_secs ?? 1) * 1e3);
          continue;
        }
        const cloudMessage = parsedBody.message ?? text.slice(0, 200);
        throw new CloudApiError(
          statusCode,
          text,
          `Cloud API ${method} ${urlPath} returned ${statusCode}: ${cloudMessage}`,
          parsedBody
        );
      }
      let json = null;
      try {
        if (text.trim().length > 0) json = JSON.parse(text);
      } catch {
      }
      return { json, raw };
    }
    throw new CloudUnreachableError(new Error(`Cloud API ${method} ${urlPath} exhausted retry attempts`));
  }
  writeProbeHeaders() {
    if (this.intent !== "write") return {};
    return { "x-ionify-quota-intent": "write-probe" };
  }
};
function computeContentHash(bytes) {
  return crypto4.createHash("sha256").update(bytes).digest("hex");
}
function shouldRetryCloudRateLimit(statusCode, body, attempt, maxAttempts) {
  return statusCode === 429 && body.retryable === true && typeof body.retry_after_secs === "number" && body.retry_after_secs > 0 && body.retry_after_secs <= 30 && attempt < maxAttempts;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/cli/utils/cloud-errors.ts
function isCloudQuotaError(error) {
  return error instanceof CloudApiError && error.statusCode === 429;
}
function quotaDetails(error) {
  const body = error.parsedBody;
  const message = body.message ?? error.body;
  const kind = inferQuotaKind(body.limit_kind, message);
  const usage = formatQuotaUsage(body.current_value, body.limit_value) ?? inferQuotaUsage(message);
  const retry = body.retry_after_secs && body.retry_after_secs > 0 ? `${body.retry_after_secs}s` : extractRetryHint(message);
  return {
    kind,
    scope: body.scope === "workspace" ? "Workspace" : "Project",
    reason: formatQuotaReason(kind, message),
    usage,
    retry,
    retryable: body.retryable === true
  };
}
function formatCloudQuotaError(command, action, error) {
  const details = quotaDetails(error);
  return `${command} stopped: Ionify Cloud limit reached.
  Action : ${action}
  Scope  : ${details.scope} quota shared by the owner and members
  Limit  : ${details.reason}
` + (details.usage ? `  Usage  : ${details.usage}
` : "") + (details.retry ? `  Retry  : wait about ${details.retry}, then retry the command.
` : "  Retry  : this limit does not reset in seconds; free usage or change the workspace plan.\n") + "  Billing: open Usage & billing to see storage, reads, writes, and member limits.";
}
function formatCloudAuthError(command) {
  return `${command} failed: the saved Ionify Cloud session is not authorized.
  Run \`ionify login\`, then retry \`${command}\` for this project.`;
}
function inferQuotaKind(limitKind, message) {
  if (isKnownQuotaKind(limitKind)) return limitKind;
  if (/blob_write rate limit exceeded|source\/blob upload burst/i.test(message)) return "blob_write_rate";
  if (/meta_write rate limit exceeded|metadata write burst/i.test(message)) return "meta_write_rate";
  if (/monthly write limit exceeded/i.test(message)) return "monthly_write_ops";
  if (/monthly read limit exceeded/i.test(message)) return "monthly_read_ops";
  if (/storage limit/i.test(message)) return "storage";
  if (/member limit/i.test(message)) return "member_count";
  return "unknown";
}
function isKnownQuotaKind(value) {
  return value === "storage" || value === "monthly_write_ops" || value === "monthly_read_ops" || value === "blob_write_rate" || value === "meta_write_rate" || value === "member_count";
}
function formatQuotaReason(kind, message) {
  if (kind === "blob_write_rate") {
    return "source/blob upload burst rate exceeded (per-minute writes), not storage.";
  }
  if (kind === "meta_write_rate") return "metadata write burst rate exceeded (per-minute metadata ops).";
  if (kind === "monthly_write_ops") return "monthly write quota exceeded.";
  if (kind === "monthly_read_ops") return "monthly read quota exceeded.";
  if (kind === "storage") return "artifact storage quota exceeded.";
  if (kind === "member_count") return "workspace member limit exceeded.";
  return message.replace(/^quota exceeded:\s*/i, "").trim() || "plan quota exceeded.";
}
function formatQuotaUsage(current, limit) {
  if (typeof current !== "number" || typeof limit !== "number") return null;
  return `${current.toLocaleString()} / ${limit.toLocaleString()}`;
}
function inferQuotaUsage(message) {
  const match = message.match(/\((\d[\d,]*)\s*\/\s*(\d[\d,]*)\s+(?:rolling\s+30d\s+)?(?:read|write)?\s*ops?\)/i);
  if (!match) return null;
  return `${match[1]} / ${match[2]}`;
}
function extractRetryHint(message) {
  const match = message.match(/retry in ~?(\d+)s/i);
  if (!match) return null;
  return `${match[1]}s`;
}

// src/cli/utils/cloud-env.ts
var NODE_ENV_TAGS = ["development", "production"];
function readNodeEnv() {
  const raw = process.env.NODE_ENV;
  if (raw === "development" || raw === "production") return raw;
  return null;
}

// src/cli/utils/deps-identity.ts
import fs14 from "fs";
import path13 from "path";
var DEPS_OPTIMIZER_OUTPUT_VERSION3 = getDepsOptimizerOutputVersion();
async function computeStandaloneDepsIdentity(config, workspace, rootDir, nodeEnv) {
  const lockfile = readCanonicalLockfile(workspace, rootDir);
  const minifier = resolveMinifier(config, { envVar: process.env.IONIFY_MINIFIER });
  const parserMode = resolveParser(config, { envMode: process.env.IONIFY_PARSER });
  const treeshake = resolveTreeshake(config?.treeshake, {
    envMode: process.env.IONIFY_TREESHAKE,
    includeEnv: process.env.IONIFY_TREESHAKE_INCLUDE,
    excludeEnv: process.env.IONIFY_TREESHAKE_EXCLUDE
  });
  const scopeHoist = resolveScopeHoist(config?.scopeHoist, {
    envMode: process.env.IONIFY_SCOPE_HOIST,
    inlineEnv: process.env.IONIFY_SCOPE_HOIST_INLINE,
    constantEnv: process.env.IONIFY_SCOPE_HOIST_CONST,
    combineEnv: process.env.IONIFY_SCOPE_HOIST_COMBINE
  });
  const entries = resolveConfiguredEntries(config, rootDir);
  const rawVersionInputs = createProductionGraphVersionInputs({
    config,
    parserMode,
    minifier,
    treeshake,
    scopeHoist,
    entries
  });
  const configHash = computeGraphVersion(rawVersionInputs);
  const depsSourcemapEnabled = config?.optimizeDeps?.sourcemap === true;
  const depsBundleEsmEnabled = config?.optimizeDeps?.bundleEsm !== false;
  const depsSharedChunksMode = normalizeSharedChunksMode(config?.optimizeDeps?.sharedChunks);
  return {
    depsHash: computeDepsHash(configHash, lockfile, {
      nodeEnv,
      sourcemap: depsSourcemapEnabled,
      bundleEsm: depsBundleEsmEnabled,
      sharedChunks: depsSharedChunksMode,
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION3
    }),
    configHash
  };
}
function readCanonicalLockfile(workspace, rootDir) {
  const lockfileOrder = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb"];
  const roots = [...new Set([workspace.workspaceRoot, rootDir].map((root) => path13.resolve(root)))];
  for (const root of roots) {
    for (const name of lockfileOrder) {
      const filePath = path13.join(root, name);
      if (fs14.existsSync(filePath)) {
        return { contents: fs14.readFileSync(filePath) };
      }
    }
  }
  return null;
}
function resolveConfiguredEntries(config, rootDir) {
  if (!config?.entry) return void 0;
  const entries = Array.isArray(config.entry) ? config.entry : [config.entry];
  return entries.map(
    (entry) => entry.startsWith("/") ? path13.join(rootDir, entry) : path13.resolve(rootDir, entry)
  );
}
function normalizeSharedChunksMode(sharedChunks) {
  if (sharedChunks === void 0 || sharedChunks === "auto") return "auto";
  if (sharedChunks === true) return "1";
  if (sharedChunks === false) return "0";
  return String(sharedChunks);
}

// src/cli/utils/push-target-state.ts
function selectPreparedPushTargets(probes) {
  const out = [];
  for (const probe of probes) {
    if (probe.hasCommittedCloudSession) {
      out.push({
        nodeEnv: probe.nodeEnv,
        depsHash: probe.depsHash,
        configHash: probe.configHash,
        depsRoot: probe.depsRoot,
        source: "cloud-committed",
        tier2Disposition: "reuse-committed-cloud-session",
        committedCloudSessionId: probe.committedCloudSessionId,
        committedCloudArtifactCount: probe.committedCloudArtifactCount,
        committedCloudTotalBytes: probe.committedCloudTotalBytes
      });
      continue;
    }
    if (probe.hasVerified) {
      out.push({
        nodeEnv: probe.nodeEnv,
        depsHash: probe.depsHash,
        configHash: probe.configHash,
        depsRoot: probe.depsRoot,
        source: "local-verified",
        tier2Disposition: "upload-local-snapshot",
        committedCloudSessionId: probe.committedCloudSessionId,
        committedCloudArtifactCount: probe.committedCloudArtifactCount,
        committedCloudTotalBytes: probe.committedCloudTotalBytes
      });
    }
  }
  return out;
}
function hasLocalSnapshotEvidence(probes) {
  return probes.some((probe) => probe.hasVerified || probe.hasDevStable);
}

// src/core/cloud/tier1-publish-source.ts
function inferTier1ModuleKind(moduleId) {
  const normalized = moduleId.startsWith("ws://") ? moduleId.slice("ws://".length) : moduleId;
  const lower = normalized.toLowerCase();
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs") || lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".jsx")) {
    return "js";
  }
  return "asset";
}
function isTier1SourceTransformModule(moduleId, kind) {
  const resolvedKind = typeof kind === "string" && kind.length > 0 ? kind.toLowerCase() : inferTier1ModuleKind(moduleId);
  return resolvedKind === "js" || resolvedKind.startsWith("css");
}

// src/core/cloud/dev-tier1-manifest.ts
function enumerateTier1ModulesFromGraph(options) {
  if (!native?.graphLoad) return [];
  ensureNativeGraph(options.graphDbPath, options.configHash);
  const nodes = native.graphLoad();
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const node of nodes) {
    if (!node || typeof node.id !== "string") continue;
    if (typeof node.hash !== "string" || node.hash.length === 0) continue;
    if (node.origin === "dep") continue;
    if (node.kind === "dep") continue;
    if (!isTier1SourceTransformModule(node.id, node.kind)) continue;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    out.push({
      moduleId: node.id,
      artifactHash: node.hash,
      kind: node.kind ?? "js"
    });
  }
  out.sort((a, b) => a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0);
  return out;
}

// src/cli/commands/push.ts
import chalk2 from "chalk";
var DEPS_OPTIMIZER_OUTPUT_VERSION4 = getDepsOptimizerOutputVersion();
var EMPTY_PROJECT_ID = "00000000-0000-0000-0000-000000000000";
function classifyArtifact(filename) {
  if (filename === ".verified") return null;
  if (filename === "manifest.json") return "manifest";
  if (filename === "vendor-pack.v2.index.json") return "pack_index";
  if (filename.endsWith(".json")) return null;
  if (filename.startsWith("shared.") && filename.endsWith(".js")) return "shared_chunk";
  if (filename.startsWith("vendor-core.") && filename.endsWith(".js")) return "shared_chunk";
  if (filename.startsWith("vendor-pack.") && filename.endsWith(".js")) return "vendor_pack";
  if (filename.endsWith(".js")) return "dep_wrapper";
  return null;
}
function createConcurrencyLimiter(limit) {
  let running = 0;
  const queue = [];
  function next() {
    if (running >= limit || queue.length === 0) return;
    running++;
    const fn = queue.shift();
    fn();
  }
  return function run(task) {
    return new Promise((resolve, reject) => {
      queue.push(() => {
        task().then((val) => {
          running--;
          resolve(val);
          next();
        }).catch((err) => {
          running--;
          reject(err);
          next();
        });
      });
      next();
    });
  };
}
async function runPushCommand(options = {}) {
  const doBoth = !options.tier1 && !options.tier2;
  const doTier1 = doBoth || !!options.tier1;
  const doTier2 = doBoth || !!options.tier2;
  const config = await loadIonifyConfig();
  const cloud = config?.cloud;
  const profile = resolveCloudProfile();
  const cwd = process.cwd();
  const rootDir = config?.root ? path14.resolve(cwd, config.root) : cwd;
  const workspace = resolveWorkspace(rootDir, { projectRootOverride: rootDir });
  const resolvedBinding = resolveProjectBinding(workspace);
  const configuredProjectId = cloud?.projectId === EMPTY_PROJECT_ID ? void 0 : cloud?.projectId;
  const binding = assertValidProjectBinding(resolvedBinding, "push", configuredProjectId);
  const bindingWarn = resolvedBinding ? bindingWarning(resolvedBinding) : null;
  if (bindingWarn) logWarn(bindingWarn);
  const projectId = binding.projectId;
  const apiUrl = binding.apiUrl ?? profile?.apiUrl ?? cloud?.apiUrl ?? "https://api.ionify.cloud";
  if (!projectId) {
    logError(
      "push: cloud project is not configured.\n  Run `ionify bind --project <project-id>` from the project root."
    );
    process.exit(1);
  }
  let token = resolveCloudToken();
  if (!token) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      const choice = await selectMenu({
        title: chalk2.yellow("No cloud token found."),
        subtitle: "Pick how to authenticate before pushing:",
        options: [
          {
            label: "Run `ionify login` now",
            description: "Interactively saves a token to ~/.ionify/credentials.json.",
            value: "login",
            recommended: true
          },
          {
            label: "Cancel",
            description: "Set IONIFY_CLOUD_TOKEN env var or run `ionify login` separately.",
            value: "cancel"
          }
        ],
        initial: 0
      });
      if (choice !== "login") {
        logInfo(chalk2.dim("[push] Cancelled \u2014 no token."));
        return;
      }
      const { runLoginCommand: runLoginCommand2 } = await import("../login-N4CZT6CR.js");
      await runLoginCommand2();
      logInfo(chalk2.dim("[push] Login complete. Re-run `ionify bind --project <project-id>` if this folder is not bound yet."));
      token = resolveCloudToken();
      if (!token) {
        logError("push: login did not produce a token. Aborting.");
        process.exit(1);
      }
    } else {
      logError(
        "push: no cloud token found.\n  Set IONIFY_CLOUD_TOKEN env var (CI/CD) or run `ionify login` (developer machine)."
      );
      process.exit(1);
    }
  }
  const concurrency = options.concurrency ?? cloud?.uploadConcurrency ?? 8;
  const client = new CloudClient({ apiUrl, token, projectId, binding, intent: "write" });
  const ionifyDir = workspace.ionifyDir;
  const loadTargetProbes = () => resolvePushTargetProbes(
    config,
    workspace,
    rootDir,
    options.env,
    doTier2 ? client : null,
    projectId
  );
  let targetProbes = await loadTargetProbes();
  let targets = selectPreparedPushTargets(targetProbes);
  const tier1Only = doTier1 && !doTier2;
  if (targets.length === 0 && !tier1Only) {
    const requested = options.env ? ` for env=${options.env}` : "";
    const depsDir = path14.join(ionifyDir, "deps");
    const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true && !process.env.CI;
    const partialCandidates = extractPartialTargets(targetProbes);
    const localSnapshotEvidence = hasLocalSnapshotEvidence(targetProbes);
    if (!interactive) {
      logError(
        `push: no prepared dependency snapshot found${requested} under ${depsDir}, and cloud does not have the exact committed deps tuple.
  Run \`ionify build\`, \`ionify optimize-all\`, or \`ionify dev\` to prepare deps first, then retry \`ionify push\`.
` + (partialCandidates.length > 0 ? `  (${partialCandidates.length} partial dev-stable snapshot(s) detected \u2014 re-run interactively to choose complete snapshot prep or partial push.)
` : "") + "  Tip: NODE_ENV during the build determines which env snapshot is produced."
      );
      process.exit(1);
    }
    logWarn(
      `push: no prepared dependency snapshot found${requested} under ${depsDir}, and cloud does not have the exact committed deps tuple.`
    );
    if (partialCandidates.length === 0) {
      const choice = await promptStateANoSnapshot(options.env, localSnapshotEvidence);
      if (choice === null || choice === "cancel") {
        logInfo(chalk2.dim("[push] Cancelled by user."));
        return;
      }
      if (choice === "run-dev") {
        await runDevInteractiveAndWait(rootDir);
        targetProbes = await loadTargetProbes();
        targets = selectPreparedPushTargets(targetProbes);
        if (targets.length === 0) {
          const partialAfter = extractPartialTargets(targetProbes);
          if (partialAfter.length === 0) {
            logError(
              `push: dev session exited but no snapshot was produced${requested}. Aborting.`
            );
            process.exit(1);
          }
          const followup = await promptStateBPartialOnly(partialAfter);
          if (followup === null || followup === "cancel") {
            logInfo(chalk2.dim("[push] Cancelled by user."));
            return;
          }
          if (followup === "optimize-all") {
            const { runOptimizeAllCommand } = await import("../optimize-all-QSJEDG5K.js");
            await runOptimizeAllCommand({ env: options.env });
            targetProbes = await loadTargetProbes();
            targets = selectPreparedPushTargets(targetProbes);
            if (targets.length === 0) {
              logError(
                `push: dependency snapshot preparation ran but produced no complete local snapshot${requested}. Aborting.`
              );
              process.exit(1);
            }
          } else {
            logPartialPushBanner();
            targets = partialAfter.map((target) => ({
              ...target,
              source: "local-verified",
              tier2Disposition: "upload-local-snapshot",
              committedCloudSessionId: null
            }));
          }
        }
      } else if (choice === "optimize-all") {
        const { runOptimizeAllCommand } = await import("../optimize-all-QSJEDG5K.js");
        await runOptimizeAllCommand({ env: options.env });
        targetProbes = await loadTargetProbes();
        targets = selectPreparedPushTargets(targetProbes);
        if (targets.length === 0) {
          logError(
            `push: dependency snapshot preparation ran but produced no complete local snapshot${requested}. Aborting.`
          );
          process.exit(1);
        }
      }
    } else {
      const choice = await promptStateBPartialOnly(partialCandidates);
      if (choice === null || choice === "cancel") {
        logInfo(chalk2.dim("[push] Cancelled by user."));
        return;
      }
      if (choice === "optimize-all") {
        const { runOptimizeAllCommand } = await import("../optimize-all-QSJEDG5K.js");
        await runOptimizeAllCommand({ env: options.env });
        targetProbes = await loadTargetProbes();
        targets = selectPreparedPushTargets(targetProbes);
        if (targets.length === 0) {
          logError(
            `push: dependency snapshot preparation ran but produced no complete local snapshot${requested}. Aborting.`
          );
          process.exit(1);
        }
      } else {
        logPartialPushBanner();
        targets = partialCandidates.map((target) => ({
          ...target,
          source: "local-verified",
          tier2Disposition: "upload-local-snapshot",
          committedCloudSessionId: null
        }));
      }
    }
  }
  const effectiveTier2Mode = doTier2 ? targets.some((target) => target.tier2Disposition === "upload-local-snapshot") ? "sync" : "reuse" : null;
  const activeWork = [doTier1 && "Tier-1", effectiveTier2Mode === "sync" && "Tier-2 sync", effectiveTier2Mode === "reuse" && "Tier-2 reuse"].filter(Boolean).join(" + ");
  logInfo(
    `[push] Targets: ${targets.length > 0 ? targets.map((t) => `${t.nodeEnv}(${t.depsHash})${t.source === "cloud-committed" ? "[cloud]" : "[local]"}`).join(", ") : "none"}${activeWork ? ` \u2022 Active work: ${activeWork}` : ""}`
  );
  const tier2Results = [];
  for (const target of targets) {
    logInfo(`[push] \u2500\u2500 env=${target.nodeEnv} depsHash=${target.depsHash} \u2500\u2500`);
    if (doTier2) {
      if (target.tier2Disposition === "reuse-committed-cloud-session") {
        logInfo(
          `[push:tier2] Dependency snapshot already exists in cloud (${target.committedCloudSessionId ?? "exact tuple"}). Skipping artifact upload.`
        );
        tier2Results.push({
          status: "reused-cloud",
          nodeEnv: target.nodeEnv,
          depsHash: target.depsHash,
          sessionId: target.committedCloudSessionId,
          artifactCount: target.committedCloudArtifactCount ?? 0,
          logicalBytes: target.committedCloudTotalBytes ?? 0,
          linkedArtifacts: 0,
          linkedBytes: 0,
          uploadedArtifacts: 0,
          uploadedBytes: 0
        });
        logInfo(
          chalk2.dim(
            "[push:tier2] Tip: run `ionify hydrate` if you want the local dependency files before dev/build on this machine."
          )
        );
      } else {
        tier2Results.push(
          await pushTier2(client, target.depsRoot, target.depsHash, target.nodeEnv, concurrency, projectId)
        );
      }
    }
  }
  let tier1Result = null;
  if (doTier1) {
    const namespace = await resolveTier1Namespace({
      explicitNamespace: options.namespace,
      fixedConfigNamespace: cloud?.namespace,
      rootDir
    });
    if (!namespace) {
      logError(
        "push: Tier-1 requires a namespace.\n  Use --namespace, add cloud.namespace only if you want a fixed namespace,\n  or run from a named git branch or workspace folder."
      );
      process.exit(1);
    }
    const tier1ConfigHash = targets.length > 0 ? targets[0].configHash : await computeStandaloneConfigHash(config, workspace, rootDir, options.env);
    for (const t of targets) {
      if (t.configHash !== tier1ConfigHash) {
        logWarn(
          `[push:tier1] configHash mismatch across env targets (${tier1ConfigHash} vs ${t.configHash}); Tier-1 only pushes once per invocation \u2014 using the first target.`
        );
        break;
      }
    }
    const outDir = path14.resolve(rootDir, config?.build?.outDir ?? "dist");
    const tier1Mode = targets.find((target) => target.nodeEnv === "production")?.nodeEnv ?? targets[0]?.nodeEnv ?? options.env ?? "production";
    tier1Result = await pushTier1({
      client,
      ionifyDir,
      configHash: tier1ConfigHash,
      outDir,
      namespace,
      concurrency,
      rootDir,
      workspaceRoot: workspace.workspaceRoot,
      config,
      nodeEnv: tier1Mode
    });
  }
  logPushSummary(tier1Result, tier2Results, { doTier1, doTier2 });
}
async function resolvePushTargetProbes(config, workspace, rootDir, envFilter, client, projectId) {
  const envDepsHash = process.env.IONIFY_DEPS_HASH;
  const envConfigHash = process.env.IONIFY_CONFIG_HASH;
  const envNodeEnv = process.env.IONIFY_NODE_ENV;
  if (envDepsHash && envConfigHash && (envNodeEnv === "development" || envNodeEnv === "production")) {
    const depsRoot = process.env.IONIFY_DEPS_ROOT ?? path14.join(workspace.ionifyDir, "deps", envDepsHash);
    if (!fs15.existsSync(path14.join(depsRoot, ".verified"))) {
      logError(
        `push: deps at ${depsRoot} are not verified (env=${envNodeEnv}).
  The build that invoked --push did not complete the deps optimizer.`
      );
      process.exit(1);
    }
    logInfo(`[push] Using handoff from build: env=${envNodeEnv} depsHash=${envDepsHash}`);
    return [
      {
        nodeEnv: envNodeEnv,
        depsHash: envDepsHash,
        configHash: envConfigHash,
        depsRoot,
        hasVerified: true,
        hasDevStable: false,
        hasCommittedCloudSession: false,
        committedCloudSessionId: null,
        committedCloudArtifactCount: null,
        committedCloudTotalBytes: null
      }
    ];
  }
  const envsToProbe = envFilter ? [envFilter] : [...NODE_ENV_TAGS];
  const candidates = [];
  for (const nodeEnv of envsToProbe) {
    const { depsHash, configHash } = await computeStandaloneDepsHash(
      config,
      workspace,
      rootDir,
      nodeEnv
    );
    const depsRoot = path14.join(workspace.ionifyDir, "deps", depsHash);
    const hasVerified = fs15.existsSync(path14.join(depsRoot, ".verified"));
    const hasDevStable = fs15.existsSync(path14.join(depsRoot, ".dev-stable"));
    let hasCommittedCloudSession = false;
    let committedCloudSessionId = null;
    let committedCloudArtifactCount = null;
    let committedCloudTotalBytes = null;
    if (client) {
      const existing = await client.lookupSession(depsHash, String(DEPS_OPTIMIZER_OUTPUT_VERSION4), nodeEnv).catch((err) => throwPushCloudError(err, "lookup CDC session"));
      if (existing && existing.status === "committed") {
        hasCommittedCloudSession = true;
        committedCloudSessionId = existing.session_id;
        committedCloudArtifactCount = existing.artifact_count;
        committedCloudTotalBytes = existing.artifacts.reduce((sum, artifact) => sum + artifact.size_bytes, 0);
      }
    }
    candidates.push({
      nodeEnv,
      depsHash,
      configHash,
      depsRoot,
      hasVerified,
      hasDevStable,
      hasCommittedCloudSession,
      committedCloudSessionId,
      committedCloudArtifactCount,
      committedCloudTotalBytes
    });
  }
  return candidates;
}
function extractPartialTargets(probes) {
  return probes.filter((probe) => !probe.hasVerified && probe.hasDevStable).map(({ nodeEnv, depsHash, configHash, depsRoot }) => ({
    nodeEnv,
    depsHash,
    configHash,
    depsRoot
  }));
}
async function pushTier2(client, depsRoot, depsHash, nodeEnv, concurrency, projectId) {
  const optimizerVersion = String(DEPS_OPTIMIZER_OUTPUT_VERSION4);
  logInfo(`[push:tier2] Local verified dependency snapshot found for env=${nodeEnv}.`);
  logInfo("[push:tier2] Checking cloud for reusable artifact bytes\u2026");
  const existing = await client.lookupSession(depsHash, optimizerVersion, nodeEnv).catch((err) => throwPushCloudError(err, "lookup CDC session"));
  if (existing && existing.status === "committed") {
    const logicalBytes = existing.artifacts.reduce((sum, artifact) => sum + artifact.size_bytes, 0);
    logInfo(`[push:tier2] Exact dependency snapshot already committed in cloud (${existing.session_id}).`);
    return {
      status: "reused-cloud",
      nodeEnv,
      depsHash,
      sessionId: existing.session_id,
      artifactCount: existing.artifact_count,
      logicalBytes,
      linkedArtifacts: 0,
      linkedBytes: 0,
      uploadedArtifacts: 0,
      uploadedBytes: 0
    };
  }
  logInfo(`[push:tier2] Creating snapshot session (env=${nodeEnv})\u2026`);
  const session = await client.createSession(depsHash, optimizerVersion, nodeEnv).catch((err) => throwPushCloudError(err, "create CDC session"));
  logInfo(`[push:tier2] Session ${session.session_id} (${session.status})`);
  const manifestPath = path14.join(depsRoot, "manifest.json");
  let manifestRaw;
  try {
    manifestRaw = JSON.parse(fs15.readFileSync(manifestPath, "utf8"));
  } catch {
    logError(`[push:tier2] Failed to parse manifest.json at ${manifestPath}`);
    process.exit(1);
  }
  const manifestEntries = manifestRaw?.entries ?? {};
  const authorizedFiles = /* @__PURE__ */ new Set();
  authorizedFiles.add("manifest.json");
  for (const entry of Object.values(manifestEntries)) {
    const outFile = entry?.outFile ?? entry?.out_file;
    if (typeof outFile === "string" && outFile.endsWith(".js") && fs15.existsSync(path14.join(depsRoot, outFile))) {
      authorizedFiles.add(outFile);
    }
    const sharedImports = Array.isArray(entry?.sharedImports) ? entry.sharedImports : [];
    for (const shared of sharedImports) {
      if (typeof shared === "string" && shared.endsWith(".js") && fs15.existsSync(path14.join(depsRoot, shared))) {
        authorizedFiles.add(shared);
      }
    }
  }
  const packIndexPath = path14.join(depsRoot, "vendor-pack.v2.index.json");
  if (fs15.existsSync(packIndexPath)) {
    authorizedFiles.add("vendor-pack.v2.index.json");
    try {
      const packIndex = JSON.parse(fs15.readFileSync(packIndexPath, "utf8"));
      const packToShared = packIndex?.packFileToSharedFile ?? {};
      const packToChunks = packIndex?.packFileToChunkFiles ?? {};
      for (const [packFile, sharedFile] of Object.entries(packToShared)) {
        if (typeof packFile === "string" && packFile.endsWith(".js") && fs15.existsSync(path14.join(depsRoot, packFile))) {
          authorizedFiles.add(packFile);
        }
        if (typeof sharedFile === "string" && sharedFile.endsWith(".js") && fs15.existsSync(path14.join(depsRoot, sharedFile))) {
          authorizedFiles.add(sharedFile);
        }
      }
      for (const chunkFiles of Object.values(packToChunks)) {
        if (!Array.isArray(chunkFiles)) continue;
        for (const chunkFile of chunkFiles) {
          if (typeof chunkFile === "string" && chunkFile.endsWith(".js") && fs15.existsSync(path14.join(depsRoot, chunkFile))) {
            authorizedFiles.add(chunkFile);
          }
        }
      }
    } catch {
      logWarn("[push:tier2] Failed to parse vendor-pack.v2.index.json; pack files collected from manifest only.");
    }
  }
  const packIndexFiles = [...authorizedFiles].filter((f) => classifyArtifact(f) === "pack_index");
  const uploadFirstFiles = [...authorizedFiles].filter((f) => classifyArtifact(f) !== "pack_index");
  logInfo(
    `[push:tier2] Syncing ${authorizedFiles.size} authorized artifacts (attach-or-upload, concurrency=${concurrency})\u2026`
  );
  const limit = createConcurrencyLimiter(concurrency);
  let completed = 0;
  let uploaded = 0;
  let uploadedBytes = 0;
  let linked = 0;
  let linkedBytes = 0;
  let failed = 0;
  const uploadFile = (filename) => limit(async () => {
    const artifactType = classifyArtifact(filename);
    const filePath = path14.join(depsRoot, filename);
    if (artifactType === "vendor_pack") {
      if (!validatePackHeader(filePath)) {
        logWarn(`[push:tier2] Skipping ${filename}: missing or invalid vendor-pack-v2 header (corrupt or partial file)`);
        return;
      }
    }
    const bytes = fs15.readFileSync(filePath);
    const contentHash = computeContentHash(bytes);
    try {
      const linkedArtifact = await client.attachArtifact(session.session_id, artifactType, filename, contentHash);
      linked++;
      linkedBytes += linkedArtifact.size_bytes;
      completed++;
      if (completed % 50 === 0) {
        logInfo(
          `[push:tier2] ${completed}/${authorizedFiles.size} synced\u2026 (${linked} linked, ${uploaded} uploaded)`
        );
      }
    } catch (err) {
      if (err instanceof CloudApiError && err.statusCode === 404) {
        try {
          const uploadedArtifact = await client.uploadArtifact(session.session_id, artifactType, filename, bytes, contentHash);
          uploaded++;
          uploadedBytes += uploadedArtifact.size_bytes;
          completed++;
          if (completed % 50 === 0) {
            logInfo(
              `[push:tier2] ${completed}/${authorizedFiles.size} synced\u2026 (${linked} linked, ${uploaded} uploaded)`
            );
          }
        } catch (uploadErr) {
          if (uploadErr instanceof CloudApiError && (uploadErr.statusCode === 403 || uploadErr.statusCode === 429)) {
            throwPushCloudError(uploadErr, `upload CDC artifact ${filename}`);
          } else if (uploadErr instanceof CloudApiError && uploadErr.statusCode === 409) {
            completed++;
          } else {
            failed++;
            logWarn(
              `[push:tier2] Failed to upload ${filename}: ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`
            );
          }
        }
        return;
      }
      if (err instanceof CloudApiError && (err.statusCode === 403 || err.statusCode === 429)) {
        throwPushCloudError(err, `attach CDC artifact ${filename}`);
      }
      if (err instanceof CloudApiError && err.statusCode === 409) {
        completed++;
        return;
      }
      failed++;
      logWarn(`[push:tier2] Failed to link ${filename}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  await Promise.all(uploadFirstFiles.map(uploadFile));
  if (failed > 0) {
    logError(`[push:tier2] ${failed} artifact(s) failed to sync. Session not completed.`);
    process.exit(1);
  }
  for (const filename of packIndexFiles) {
    await uploadFile(filename);
  }
  if (failed > 0) {
    logError(`[push:tier2] pack_index sync failed. Session not completed.`);
    process.exit(1);
  }
  logInfo(
    `[push:tier2] Completing session (${completed} artifacts: ${linked} linked, ${uploaded} uploaded)\u2026`
  );
  const completedSession = await client.completeSession(session.session_id).catch((err) => throwPushCloudError(err, "complete CDC session"));
  logInfo(
    `[push:tier2] Session committed. artifacts=${completedSession.artifact_count} total_bytes=${completedSession.total_bytes}`
  );
  return {
    status: "synced",
    nodeEnv,
    depsHash,
    sessionId: completedSession.session_id,
    artifactCount: completedSession.artifact_count,
    logicalBytes: completedSession.total_bytes,
    linkedArtifacts: linked,
    linkedBytes,
    uploadedArtifacts: uploaded,
    uploadedBytes
  };
}
function validatePackHeader(filePath) {
  try {
    const fd = fs15.openSync(filePath, "r");
    const buf = Buffer.alloc(256);
    const n = fs15.readSync(fd, buf, 0, 256, 0);
    fs15.closeSync(fd);
    const firstLine = buf.subarray(0, n).toString("utf8").split("\n")[0];
    return /^\/\/ ionify:vendor-pack-v2 [0-9a-fA-F]{32,}$/.test(firstLine);
  } catch {
    return false;
  }
}
var TIER1_RESOLVER_VERSION = "0.1.0";
async function pushTier1(options) {
  const {
    client,
    ionifyDir,
    configHash,
    outDir,
    namespace,
    concurrency,
    rootDir,
    workspaceRoot,
    config,
    nodeEnv
  } = options;
  const casRoot = path14.join(ionifyDir, "cas");
  const casVersionDir = path14.join(casRoot, configHash);
  const envSignature = "shared";
  const limiter = createConcurrencyLimiter(concurrency);
  let graphModules = [];
  try {
    graphModules = enumerateTier1ModulesFromGraph({
      graphDbPath: path14.join(ionifyDir, "graph.db"),
      configHash
    });
  } catch (err) {
    logWarn(`[push:tier1] Graph-walk failed: ${err.message}; falling back to CAS recovery.`);
  }
  let modules = graphModules;
  if (modules.length > 0) {
    logInfo(`[push:tier1] Graph-authoritative mode: ${modules.length} source module(s) from .ionify/graph.db.`);
    modules = await refreshTier1SourceTransforms({
      modules,
      casRoot,
      configHash,
      rootDir,
      workspaceRoot,
      config,
      nodeEnv
    });
  }
  if (modules.length === 0) {
    if (!fs15.existsSync(casVersionDir)) {
      logWarn(
        `[push:tier1] No CAS found at ${casVersionDir}.
  Run \`ionify dev\` or \`ionify build\` to populate the CAS first.`
      );
      return {
        status: "no-cas",
        verifiedBlobCount: 0,
        publishedEntryCount: 0,
        namespace,
        manifestHash: null
      };
    }
    const artifactDirs = fs15.readdirSync(casVersionDir).filter((d) => fs15.statSync(path14.join(casVersionDir, d)).isDirectory());
    if (artifactDirs.length === 0) {
      logWarn("[push:tier1] CAS directory is empty. Nothing to push.");
      return {
        status: "empty-cas",
        verifiedBlobCount: 0,
        publishedEntryCount: 0,
        namespace,
        manifestHash: null
      };
    }
    logInfo(
      `[push:tier1] CAS-scan mode: ${artifactDirs.length} artifact(s) found.
  Uploading blobs... (no manifest published \u2014 run \`ionify build && ionify push\` to publish)`
    );
    let uploaded = 0;
    let skipped = 0;
    await Promise.all(
      artifactDirs.map(
        (artifactHash) => limiter(async () => {
          const jsPath = path14.join(casVersionDir, artifactHash, "transformed.js");
          const cssPath = path14.join(casVersionDir, artifactHash, "transformed.css");
          const blobPath = fs15.existsSync(jsPath) ? jsPath : fs15.existsSync(cssPath) ? cssPath : null;
          if (!blobPath) {
            skipped++;
            return;
          }
          await client.putBlob(fs15.readFileSync(blobPath)).catch((err) => throwPushCloudError(err, "upload source blob"));
          uploaded++;
        })
      )
    );
    logInfo(`[push:tier1] CAS-scan: ${uploaded} blob reference(s) verified, ${skipped} skipped.`);
    return {
      status: "prewarmed-blobs",
      verifiedBlobCount: uploaded,
      publishedEntryCount: 0,
      namespace,
      manifestHash: null
    };
  }
  const results = [];
  let cassMisses = 0;
  await Promise.all(
    modules.map(
      (mod) => limiter(async () => {
        const casDir = path14.join(casVersionDir, mod.artifactHash);
        const jsPath = path14.join(casDir, "transformed.js");
        const cssPath = path14.join(casDir, "transformed.css");
        const blobPath = fs15.existsSync(jsPath) ? jsPath : fs15.existsSync(cssPath) ? cssPath : null;
        if (!blobPath) {
          logWarn(
            `[push:tier1] CAS miss: ${mod.moduleId} (${mod.artifactHash.slice(0, 8)}) \u2014 skipped.`
          );
          cassMisses++;
          return;
        }
        const { blob_hash } = await client.putBlob(fs15.readFileSync(blobPath)).catch((err) => throwPushCloudError(err, "upload source blob"));
        results.push({ moduleId: mod.moduleId, artifactHash: mod.artifactHash, kind: mod.kind, blobHash: blob_hash });
      })
    )
  );
  if (cassMisses > 0) {
    logWarn(`[push:tier1] ${cassMisses} module(s) had CAS misses and were excluded from the manifest.`);
  }
  if (results.length === 0) {
    logWarn("[push:tier1] No source blob references were verified. Cannot publish manifest.");
    return {
      status: "no-blobs",
      verifiedBlobCount: 0,
      publishedEntryCount: 0,
      namespace,
      manifestHash: null
    };
  }
  logInfo(`[push:tier1] ${results.length} source blob reference(s) verified.`);
  let expectedNamespaceVersion = 0;
  let currentManifestHashBeforePublish = null;
  try {
    const ns = await client.getNamespace("branch", namespace);
    expectedNamespaceVersion = ns.version;
    currentManifestHashBeforePublish = ns.current_manifest_hash;
    logInfo(`[push:tier1] Namespace "${namespace}" exists at version ${expectedNamespaceVersion}.`);
  } catch (err) {
    if (err instanceof CloudApiError && err.statusCode === 404) {
      logInfo(`[push:tier1] Namespace "${namespace}" does not exist. Creating\u2026`);
      const created = await client.createNamespace("branch", namespace).catch((createErr) => throwPushCloudError(createErr, "create namespace"));
      expectedNamespaceVersion = created.version;
      logInfo(`[push:tier1] Namespace "${namespace}" created at version ${expectedNamespaceVersion}.`);
    } else {
      throw err;
    }
  }
  const entries = results.map((r) => ({
    module_id: r.moduleId,
    artifact_hash: r.artifactHash,
    artifact_type: "source_transform",
    blob_hash: r.blobHash,
    config_hash: configHash,
    resolver_version: TIER1_RESOLVER_VERSION,
    env_signature: envSignature
  }));
  logInfo(
    `[push:tier1] Publishing manifest (${entries.length} entries) \u2192 namespace "${namespace}"...`
  );
  try {
    const result = await client.publishManifest({
      scope: "branch",
      name: namespace,
      expected_namespace_version: expectedNamespaceVersion,
      entries
    }).catch((publishErr) => throwPushCloudError(publishErr, "publish manifest"));
    const noChanges = currentManifestHashBeforePublish !== null && currentManifestHashBeforePublish === result.manifest_hash;
    if (noChanges) {
      logInfo("[push:tier1] No new artifacts to publish.");
    } else {
      logInfo(
        `[push:tier1] Manifest published. hash=${result.manifest_hash} ns_version=${result.namespace_version ?? "new"}`
      );
    }
    return {
      status: noChanges ? "no-changes" : "published",
      verifiedBlobCount: results.length,
      publishedEntryCount: entries.length,
      namespace,
      manifestHash: result.manifest_hash
    };
  } catch (err) {
    if (err instanceof CloudApiError && err.statusCode === 409) {
      logWarn(
        `[push:tier1] OCC conflict: namespace "${namespace}" was updated concurrently.
  Re-run ionify push to retry.`
      );
      return {
        status: "occ-conflict",
        verifiedBlobCount: results.length,
        publishedEntryCount: entries.length,
        namespace,
        manifestHash: null
      };
    }
    throw err;
  }
}
async function refreshTier1SourceTransforms(options) {
  const planModules = options.modules.map((mod) => {
    const fsPath = resolveTier1ModuleFsPath(mod.moduleId, options.workspaceRoot);
    if (!fsPath || !fs15.existsSync(fsPath)) return null;
    const kind = normalizeTier1ModuleKind(mod.kind);
    if (kind !== "js" && kind !== "css") return null;
    const sourceHash = getCacheKey(fs15.readFileSync(fsPath, "utf8"));
    return {
      id: mod.moduleId,
      fsPath,
      hash: sourceHash,
      kind,
      deps: [],
      dynamicDeps: []
    };
  }).filter((mod) => mod !== null);
  if (planModules.length === 0) return options.modules;
  configurePushTransformEnvironment(options);
  const parserMode = resolveParser(options.config, { envMode: process.env.IONIFY_PARSER });
  const defineConfig = buildPushDefineConfig(options.config, options.rootDir, options.nodeEnv);
  const plan = {
    entries: [],
    chunks: [
      {
        id: "cloud-tier1",
        modules: planModules,
        entry: false,
        shared: true,
        consumers: [],
        css: [],
        assets: []
      }
    ]
  };
  const result = await publishProductionTransformCas({
    plan,
    casRoot: options.casRoot,
    configHash: options.configHash,
    workspaceRoot: options.workspaceRoot,
    parserMode,
    defineConfig
  });
  if (result.transformed > 0 || result.defineDerived > 0) {
    logInfo(
      `[push:tier1] Refreshed ${result.transformed + result.defineDerived} stale source transform(s) before publishing.`
    );
  }
  const refreshedById = /* @__PURE__ */ new Map();
  for (const mod of plan.chunks[0]?.modules ?? []) {
    if (typeof mod.hash !== "string" || mod.hash.length === 0) continue;
    refreshedById.set(mod.id, {
      moduleId: mod.id,
      artifactHash: mod.hash,
      kind: mod.kind
    });
  }
  return options.modules.map((mod) => refreshedById.get(mod.moduleId) ?? mod);
}
function resolveTier1ModuleFsPath(moduleId, workspaceRoot) {
  if (!moduleId.startsWith(WS_MODULE_PREFIX)) return null;
  return fromWsModuleId(moduleId, workspaceRoot);
}
function normalizeTier1ModuleKind(kind) {
  const lower = kind.toLowerCase();
  if (lower === "css" || lower.startsWith("css")) return "css";
  if (lower === "js") return "js";
  return "asset";
}
function configurePushTransformEnvironment(options) {
  const ionifyDir = path14.dirname(options.casRoot);
  fs15.mkdirSync(ionifyDir, { recursive: true });
  process.env.IONIFY_PROJECT_ROOT = options.rootDir;
  process.env.IONIFY_WORKSPACE_ROOT = options.workspaceRoot;
  process.env.IONIFY_STATE_DIR = ionifyDir;
  process.env.IONIFY_CONFIG_HASH = options.configHash;
  process.env.MODE = options.nodeEnv;
  process.env.NODE_ENV = options.nodeEnv;
  try {
    const preOpts = options.config?.css?.preprocessorOptions;
    process.env.IONIFY_CSS_PREPROCESSOR_OPTIONS = preOpts ? JSON.stringify(preOpts) : "";
  } catch {
    process.env.IONIFY_CSS_PREPROCESSOR_OPTIONS = "";
  }
}
function buildPushDefineConfig(config, rootDir, nodeEnv) {
  const envFromFiles = loadEnv(nodeEnv, rootDir);
  const envValues = {
    ...envFromFiles,
    NODE_ENV: nodeEnv,
    MODE: nodeEnv
  };
  const envPrefix = config?.envPrefix || ["VITE_", "IONIFY_"];
  return buildDefineConfig(config?.define, envValues, envPrefix);
}
async function computeStandaloneDepsHash(config, workspace, rootDir, nodeEnv) {
  return computeStandaloneDepsIdentity(config, workspace, rootDir, nodeEnv);
}
async function computeStandaloneConfigHash(config, workspace, rootDir, envFilter) {
  const { configHash } = await computeStandaloneDepsHash(
    config,
    workspace,
    rootDir,
    envFilter ?? "development"
  );
  return configHash;
}
async function resolveTier1Namespace(args) {
  if (args.explicitNamespace) return args.explicitNamespace;
  if (args.fixedConfigNamespace) return args.fixedConfigNamespace;
  const gitBranch = await resolveGitBranch();
  if (gitBranch) return gitBranch;
  const fallback = sanitizeNamespace(path14.basename(args.rootDir));
  if (fallback) {
    logInfo(
      `[push:tier1] No named git branch found. Using workspace namespace "${fallback}".`
    );
    return fallback;
  }
  return null;
}
function sanitizeNamespace(value) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : null;
}
function formatBytes2(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}
function logPushSummary(tier1Result, tier2Results, options) {
  logInfo("Push complete");
  if (options.doTier1) {
    if (!tier1Result) {
      logInfo("  Tier-1: skipped");
    } else if (tier1Result.status === "no-changes") {
      logInfo("  Tier-1: no changes");
    } else if (tier1Result.status === "published") {
      logInfo(
        `  Tier-1: published ${tier1Result.publishedEntryCount} entry(s) from ${tier1Result.verifiedBlobCount} verified blob reference(s)`
      );
    } else if (tier1Result.status === "prewarmed-blobs") {
      logInfo(`  Tier-1: prewarmed ${tier1Result.verifiedBlobCount} blob reference(s)`);
    } else if (tier1Result.status === "occ-conflict") {
      logInfo("  Tier-1: namespace conflict (retry needed)");
    } else {
      logInfo("  Tier-1: no changes");
    }
  }
  if (options.doTier2) {
    if (tier2Results.length === 0) {
      logInfo("  Tier-2: skipped");
    } else {
      const reused = tier2Results.filter((result) => result.status === "reused-cloud");
      const synced = tier2Results.filter((result) => result.status === "synced");
      const logicalBytes = tier2Results.reduce((sum, result) => sum + result.logicalBytes, 0);
      const linkedArtifacts = synced.reduce((sum, result) => sum + result.linkedArtifacts, 0);
      const linkedBytes = synced.reduce((sum, result) => sum + result.linkedBytes, 0);
      const uploadedArtifacts = synced.reduce((sum, result) => sum + result.uploadedArtifacts, 0);
      const uploadedBytes = synced.reduce((sum, result) => sum + result.uploadedBytes, 0);
      if (synced.length === 0) {
        logInfo(`  Tier-2: reused cloud snapshot${reused.length > 1 ? "s" : ""}`);
      } else {
        logInfo(`  Tier-2: linked ${linkedArtifacts}, uploaded ${uploadedArtifacts}`);
      }
      if (logicalBytes > 0) {
        logInfo(`  Tier-2 logical snapshot: ${formatBytes2(logicalBytes)}`);
      }
      if (linkedBytes > 0) {
        logInfo(`  Tier-2 linked artifact bytes: ${formatBytes2(linkedBytes)}`);
      }
      if (uploadedBytes > 0) {
        logInfo(`  Tier-2 uploaded artifact bytes: ${formatBytes2(uploadedBytes)}`);
      }
    }
  }
}
async function resolveGitBranch() {
  try {
    const { execSync } = await import("child_process");
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (!branch || branch === "HEAD") return null;
    return branch;
  } catch {
    return null;
  }
}
function throwUnreachable(err) {
  if (err instanceof CloudUnreachableError) {
    logError(
      `${err.message}
  Your local build succeeded. Run \`ionify push\` again when cloud is available.`
    );
    process.exit(1);
  }
  throw err;
}
function throwPushCloudError(err, action) {
  if (err instanceof CloudApiError && err.statusCode === 429) {
    logError(formatCloudQuotaError("Push", action, err));
    process.exit(1);
  }
  if (err instanceof CloudApiError && err.statusCode === 401) {
    logError(formatCloudAuthError("Push"));
    process.exit(1);
  }
  if (err instanceof CloudApiError && err.statusCode === 403) {
    logError(
      `push: cloud rejected ${action}.
  The saved token is likely scoped to a different project or lacks access.
  Run \`ionify login\` with this Project ID, or update cloud.projectId in ionify.config.ts.`
    );
    process.exit(1);
  }
  return throwUnreachable(err);
}
async function promptStateANoSnapshot(envFilter, hasLocalEvidence) {
  const envHint = envFilter ? ` (env=${envFilter})` : "";
  const devCommand = detectDevCommand(process.cwd());
  const result = await selectMenu({
    title: `No prepared dependency snapshot found${envHint}.`,
    subtitle: hasLocalEvidence ? "This exact deps tuple is not complete locally or in cloud yet. Pick how to prepare it before pushing:" : "This exact deps tuple is not available locally or in cloud yet. Pick how to prepare it before pushing:",
    options: [
      {
        label: "Prepare a complete dependency snapshot now",
        description: "Recommended. Runs `ionify optimize-all` and creates the full snapshot teammates and CI can hydrate.",
        value: "optimize-all",
        recommended: true
      },
      {
        label: `Run \`${devCommand.label}\` and render the app`,
        description: "Fastest. Captures only what the first page actually loads (partial dependency snapshot).",
        value: "run-dev"
      },
      {
        label: "Cancel",
        value: "cancel"
      }
    ],
    initial: 0
  });
  return result;
}
async function promptStateBPartialOnly(partialCandidates) {
  const summary = partialCandidates.map((c) => `${c.nodeEnv} (${c.depsHash.slice(0, 12)})`).join(", ");
  const result = await selectMenu({
    title: `Found a ${chalk2.yellow("PARTIAL")} dependency snapshot from a dev session: ${chalk2.cyan(summary)}`,
    subtitle: "This covers what the browser loaded, but not the full dependency snapshot.",
    options: [
      {
        label: "Prepare the complete dependency snapshot and push it",
        description: "Captures every dependency. Best for teammates and CI hydrate.",
        value: "optimize-all",
        recommended: true
      },
      {
        label: "Push partial snapshot anyway",
        description: "Experimental. Teammates hydrating this may get fewer deps than a complete snapshot.",
        value: "push-anyway"
      },
      {
        label: "Cancel",
        value: "cancel"
      }
    ],
    initial: 0
  });
  return result;
}
function logPartialPushBanner() {
  logWarn(
    chalk2.yellow(
      `[push] Pushing PARTIAL dev-stable dependency snapshot(s) \u2014 only what the browser actually loaded.`
    )
  );
  logWarn(
    chalk2.dim(
      `       Experimental DX path: hydrate may miss deps that were not loaded during this dev session.`
    )
  );
}
function detectPackageManager(cwd) {
  if (fs15.existsSync(path14.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (fs15.existsSync(path14.join(cwd, "yarn.lock"))) return "yarn";
  if (fs15.existsSync(path14.join(cwd, "bun.lockb"))) return "bun";
  return "npm";
}
function readPackageScripts(rootDir) {
  try {
    const raw = fs15.readFileSync(path14.join(rootDir, "package.json"), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && parsed.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
  } catch {
    return {};
  }
}
function detectDevCommand(rootDir) {
  const pm = detectPackageManager(rootDir);
  const scripts = readPackageScripts(rootDir);
  const preferredScript = typeof scripts.start === "string" ? "start" : typeof scripts.dev === "string" ? "dev" : null;
  if (preferredScript) {
    const args = pm === "npm" ? ["run", preferredScript] : pm === "bun" ? ["run", preferredScript] : [preferredScript];
    return {
      command: pm,
      args,
      label: `${pm} ${args.join(" ")}`
    };
  }
  return {
    command: "ionify",
    args: ["dev"],
    label: "ionify dev"
  };
}
async function runDevInteractiveAndWait(rootDir) {
  const { spawn: spawn2 } = await import("child_process");
  const devCommand = detectDevCommand(rootDir);
  logInfo("");
  logInfo(chalk2.cyan.bold(`\u25B6 Launching \`${devCommand.label}\`\u2026`));
  logInfo(chalk2.dim(`  Render your app in the browser, then press Ctrl+C to return to push.`));
  logInfo("");
  return new Promise((resolve) => {
    const child = spawn2(devCommand.command, devCommand.args, { stdio: "inherit", cwd: rootDir, shell: false });
    const onParentSigint = () => {
      try {
        child.kill("SIGINT");
      } catch {
      }
    };
    process.on("SIGINT", onParentSigint);
    child.on("exit", () => {
      process.removeListener("SIGINT", onParentSigint);
      logInfo("");
      logInfo(chalk2.dim(`\u25C0 Dev session ended \u2014 re-checking for snapshot\u2026`));
      logInfo("");
      resolve();
    });
    child.on("error", (err) => {
      process.removeListener("SIGINT", onParentSigint);
      logWarn(chalk2.yellow(`[push] Failed to launch \`${devCommand.label}\`: ${String(err)}`));
      resolve();
    });
  });
}

// src/cli/commands/hydrate.ts
import fs16 from "fs";
import path15 from "path";
var DEPS_OPTIMIZER_OUTPUT_VERSION5 = getDepsOptimizerOutputVersion();
var EMPTY_PROJECT_ID2 = "00000000-0000-0000-0000-000000000000";
function createConcurrencyLimiter2(limit) {
  let running = 0;
  const queue = [];
  function next() {
    if (running >= limit || queue.length === 0) return;
    running++;
    const fn = queue.shift();
    fn();
  }
  return function run(task) {
    return new Promise((resolve, reject) => {
      queue.push(() => {
        task().then((val) => {
          running--;
          resolve(val);
          next();
        }).catch((err) => {
          running--;
          reject(err);
          next();
        });
      });
      next();
    });
  };
}
async function runHydrateCommand(options = {}) {
  const doBoth = !options.tier1 && !options.tier2;
  const doTier1 = doBoth || !!options.tier1;
  const doTier2 = doBoth || !!options.tier2;
  const config = await loadIonifyConfig();
  const cloud = config?.cloud;
  const profile = resolveCloudProfile();
  const cwd = process.cwd();
  const rootDir = config?.root ? path15.resolve(cwd, config.root) : cwd;
  loadEnv(process.env.MODE, rootDir);
  const workspace = resolveWorkspace(rootDir, { projectRootOverride: rootDir });
  const resolvedBinding = resolveProjectBinding(workspace);
  const configuredProjectId = cloud?.projectId === EMPTY_PROJECT_ID2 ? void 0 : cloud?.projectId;
  const binding = assertValidProjectBinding(resolvedBinding, "hydrate", configuredProjectId);
  const bindingWarn = resolvedBinding ? bindingWarning(resolvedBinding) : null;
  if (bindingWarn) logWarn(bindingWarn);
  const projectId = binding.projectId;
  const apiUrl = binding.apiUrl ?? profile?.apiUrl ?? cloud?.apiUrl ?? "https://api.ionify.cloud";
  if (!projectId) {
    logError(
      "hydrate: cloud project is not configured.\n  Run `ionify bind --project <project-id>` from the project root."
    );
    process.exit(1);
  }
  const token = resolveCloudToken();
  if (!token) {
    logError(
      "hydrate: no cloud token found.\n  Set IONIFY_CLOUD_TOKEN env var (CI/CD) or run `ionify login` (developer machine)."
    );
    process.exit(1);
  }
  const concurrency = options.concurrency ?? cloud?.uploadConcurrency ?? 8;
  const client = new CloudClient({ apiUrl, token, projectId, binding });
  let cloudHydrationBlocked = false;
  let quotaSkipLogged = false;
  const reportHydrateQuotaSkip = (action, err) => {
    if (!quotaSkipLogged) {
      quotaSkipLogged = true;
      logHydrateQuotaSkip(action, err);
    }
    cloudHydrationBlocked = true;
  };
  const ionifyDir = workspace.ionifyDir;
  const targets = [];
  let configHashForTier1 = null;
  const envHandoff = process.env.IONIFY_DEPS_HASH && process.env.IONIFY_CONFIG_HASH && (process.env.IONIFY_NODE_ENV === "development" || process.env.IONIFY_NODE_ENV === "production") ? process.env.IONIFY_NODE_ENV : null;
  if (envHandoff) {
    const depsHash = process.env.IONIFY_DEPS_HASH;
    const configHash = process.env.IONIFY_CONFIG_HASH;
    const depsRoot = process.env.IONIFY_DEPS_ROOT ?? path15.join(ionifyDir, "deps", depsHash);
    targets.push({ nodeEnv: envHandoff, depsHash, configHash, depsRoot });
    configHashForTier1 = configHash;
    logInfo(`[hydrate] Using handoff from build: env=${envHandoff} depsHash=${depsHash}`);
    logInfo(`[hydrate] Using configHash from env: ${configHash}`);
  } else {
    const envFromNode = readNodeEnv();
    const envsToProbe = options.env ? [options.env] : envFromNode ? [envFromNode] : [...NODE_ENV_TAGS];
    if (!options.env && !envFromNode) {
      logInfo(
        `[hydrate] No --env or NODE_ENV; probing all envs: ${envsToProbe.join(", ")}.`
      );
    }
    for (const nodeEnv of envsToProbe) {
      const { depsHash, configHash } = await computeDepsHashFromConfig(
        config,
        workspace,
        rootDir,
        nodeEnv
      );
      configHashForTier1 = configHash;
      const depsRoot = path15.join(ionifyDir, "deps", depsHash);
      targets.push({ nodeEnv, depsHash, configHash, depsRoot });
      logInfo(`[hydrate] env=${nodeEnv} depsHash=${depsHash}`);
    }
  }
  if (doTier2) {
    let alreadyVerified = 0;
    let downloadedSessions = 0;
    let missingSessions = 0;
    for (const target of targets) {
      if (cloudHydrationBlocked) break;
      const verifiedSentinel = path15.join(target.depsRoot, ".verified");
      if (fs16.existsSync(verifiedSentinel)) {
        logInfo(
          `[hydrate] env=${target.nodeEnv}: deps already verified locally (depsHash=${target.depsHash}). Skipping Tier-2.`
        );
        alreadyVerified++;
        continue;
      }
      const ok = await hydrateTier2ForTarget(client, target, concurrency);
      if (ok === "downloaded") downloadedSessions++;
      else if (ok === "missing") missingSessions++;
    }
    if (targets.length > 1 && !cloudHydrationBlocked) {
      logInfo(
        `[hydrate] Tier-2 summary: ${alreadyVerified} already verified, ${downloadedSessions} downloaded, ${missingSessions} no committed session.`
      );
    }
  }
  if (doTier1 && configHashForTier1) {
    if (cloudHydrationBlocked) return;
    const namespace = options.namespace ?? cloud?.namespace ?? await resolveGitBranchForHydrate() ?? null;
    if (!namespace) {
      logWarn(
        "[hydrate:tier1] Skipping Tier-1 \u2014 no namespace available.\n  Set cloud.namespace in ionify.config.ts, use --namespace flag,\n  or ensure you are on a named git branch."
      );
    } else {
      await hydrateTier1(client, ionifyDir, configHashForTier1, namespace, concurrency);
    }
  }
  async function hydrateTier2ForTarget(client2, target, concurrency2) {
    const optimizerVersion = String(DEPS_OPTIMIZER_OUTPUT_VERSION5);
    logInfo(
      `[hydrate] Looking up cloud CDC session (env=${target.nodeEnv} depsHash=${target.depsHash})\u2026`
    );
    let session;
    try {
      session = await client2.lookupSession(target.depsHash, optimizerVersion, target.nodeEnv);
    } catch (err) {
      if (err instanceof CloudUnreachableError) {
        logWarn(
          `[hydrate] ${err.message}
  Proceeding without Tier-2 hydration \u2014 optimizer will run locally.`
        );
        return "failed";
      }
      if (isCloudQuotaError(err)) {
        reportHydrateQuotaSkip("lookup dependency session", err);
        return "failed";
      }
      throw err;
    }
    if (!session) {
      logInfo(
        `[hydrate] env=${target.nodeEnv}: no committed CDC session for depsHash=${target.depsHash}.`
      );
      return "missing";
    }
    if (session.status !== "committed") {
      logInfo(
        `[hydrate] env=${target.nodeEnv}: session status is "${session.status}" (not committed).`
      );
      return "missing";
    }
    logInfo(
      `[hydrate] env=${target.nodeEnv}: found session ${session.session_id} with ${session.artifact_count} artifact(s). Downloading\u2026`
    );
    fs16.mkdirSync(target.depsRoot, { recursive: true });
    const limit = createConcurrencyLimiter2(concurrency2);
    let downloaded = 0;
    let failed = 0;
    await Promise.all(
      session.artifacts.map(
        (artifact) => limit(async () => {
          const { cache_key } = artifact;
          const localFilename = cache_key.split(":").slice(3).join(":");
          const destPath = path15.join(target.depsRoot, localFilename);
          if (fs16.existsSync(destPath)) {
            downloaded++;
            return;
          }
          try {
            const bytes = await client2.downloadArtifact(
              session.session_id,
              artifact.artifact_type,
              cache_key
            );
            const tmpPath = destPath + ".tmp";
            fs16.writeFileSync(tmpPath, bytes);
            fs16.renameSync(tmpPath, destPath);
            downloaded++;
            if (downloaded % 50 === 0) {
              logInfo(
                `[hydrate] env=${target.nodeEnv}: ${downloaded}/${session.artifact_count} downloaded\u2026`
              );
            }
          } catch (err) {
            failed++;
            if (isCloudQuotaError(err)) {
              reportHydrateQuotaSkip("download dependency artifact", err);
              return;
            }
            logWarn(
              `[hydrate] Failed to download ${cache_key}: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        })
      )
    );
    if (failed > 0) {
      logWarn(
        `[hydrate] env=${target.nodeEnv}: ${failed} artifact(s) failed. Cleaning up partial state.`
      );
      cleanupPartialHydration(target.depsRoot);
      logWarn(`[hydrate] env=${target.nodeEnv}: will run deps optimizer locally.`);
      return "failed";
    }
    fs16.writeFileSync(
      path15.join(target.depsRoot, ".verified"),
      (/* @__PURE__ */ new Date()).toISOString() + "\n",
      "utf8"
    );
    logInfo(
      `[hydrate] env=${target.nodeEnv}: Tier-2 done. ${downloaded} artifact(s) restored (depsHash=${target.depsHash}).`
    );
    return "downloaded";
  }
}
async function computeDepsHashFromConfig(config, workspace, rootDir, nodeEnv) {
  const identity = await computeStandaloneDepsIdentity(config, workspace, rootDir, nodeEnv);
  const configHash = identity.configHash;
  logInfo(`[hydrate] Computed configHash: ${configHash}`);
  return identity;
}
async function hydrateTier1(client, ionifyDir, configHash, namespace, concurrency) {
  logInfo(`[hydrate:tier1] Looking up namespace "${namespace}"\u2026`);
  let manifestHash;
  try {
    const ns = await client.getNamespace("branch", namespace);
    if (!ns.current_manifest_hash) {
      logInfo(`[hydrate:tier1] Namespace "${namespace}" has no manifest yet. Nothing to hydrate.`);
      return;
    }
    manifestHash = ns.current_manifest_hash;
    logInfo(`[hydrate:tier1] Found manifest ${manifestHash.slice(0, 12)}\u2026 (ns version ${ns.version})`);
  } catch (err) {
    if (err instanceof CloudApiError && err.statusCode === 404) {
      logInfo(`[hydrate:tier1] Namespace "${namespace}" not found. Nothing to hydrate.`);
      return;
    }
    if (err instanceof CloudUnreachableError) {
      logWarn(`[hydrate:tier1] ${err.message}  Skipping Tier-1 hydration.`);
      return;
    }
    if (isCloudQuotaError(err)) {
      logHydrateQuotaSkip("lookup namespace", err);
      return;
    }
    throw err;
  }
  let manifest;
  try {
    manifest = await client.getManifest(manifestHash);
  } catch (err) {
    if (err instanceof CloudUnreachableError) {
      logWarn(`[hydrate:tier1] ${err.message}  Skipping Tier-1 hydration.`);
      return;
    }
    if (isCloudQuotaError(err)) {
      logHydrateQuotaSkip("download manifest", err);
      return;
    }
    throw err;
  }
  const casRoot = path15.join(ionifyDir, "cas");
  const entries = manifest.entries.filter((e) => e.artifact_type === "source_transform");
  logInfo(`[hydrate:tier1] ${entries.length} source transform(s) to hydrate.`);
  if (entries.length === 0) return;
  const limit = createConcurrencyLimiter2(concurrency);
  let hydrated = 0;
  let skipped = 0;
  let failed = 0;
  let quotaLogged = false;
  await Promise.all(
    entries.map(
      (entry) => limit(async () => {
        const casDir = path15.join(casRoot, entry.config_hash, entry.artifact_hash);
        const destPath = path15.join(casDir, "transformed.js");
        if (fs16.existsSync(destPath)) {
          skipped++;
          return;
        }
        try {
          const bytes = await client.getBlobBytes(entry.blob_hash);
          fs16.mkdirSync(casDir, { recursive: true });
          const tmpPath = destPath + ".tmp";
          fs16.writeFileSync(tmpPath, bytes);
          fs16.renameSync(tmpPath, destPath);
          hydrated++;
        } catch (err) {
          failed++;
          if (isCloudQuotaError(err)) {
            if (!quotaLogged) {
              quotaLogged = true;
              logHydrateQuotaSkip("download source transform", err);
            }
            return;
          }
          logWarn(
            `[hydrate:tier1] Failed to download blob for ${entry.module_id}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      })
    )
  );
  if (failed > 0) {
    logWarn(
      `[hydrate:tier1] ${failed} blob(s) failed. Affected modules will be recompiled locally.`
    );
  }
  logInfo(
    `[hydrate:tier1] Done. ${hydrated} downloaded, ${skipped} already cached. Build will use warm CAS for these modules.`
  );
}
async function resolveGitBranchForHydrate() {
  try {
    const { execSync } = await import("child_process");
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (!branch || branch === "HEAD") return null;
    return branch;
  } catch {
    return null;
  }
}
function logHydrateQuotaSkip(action, err) {
  const details = quotaDetails(err);
  const message = formatCloudQuotaError("Hydrate", action, err).replace(
    /^Hydrate stopped:/,
    "Hydrate skipped:"
  );
  logWarn(
    message + "\n  Local  : no local files were changed; existing local artifacts remain usable.\n  Hydrate: skipping cloud hydration; local build/push can continue from local artifacts."
  );
  if (details.kind !== "monthly_read_ops") {
    logWarn("[hydrate] Non-read quota reached during hydration; this may indicate a cloud endpoint classification issue.");
  }
}
function cleanupPartialHydration(depsRoot) {
  try {
    const files = fs16.readdirSync(depsRoot);
    for (const file of files) {
      fs16.rmSync(path15.join(depsRoot, file), { force: true });
    }
  } catch {
  }
}

// src/cli/commands/bind.ts
import path16 from "path";
async function runBindCommand(options = {}) {
  const projectId = options.projectId?.trim();
  if (!projectId) {
    logError("bind: --project <project-id> is required.");
    process.exit(1);
  }
  const config = await loadIonifyConfig();
  const cloud = config?.cloud;
  const profile = resolveCloudProfile();
  const apiUrl = options.apiUrl?.trim() || profile?.apiUrl || cloud?.apiUrl || "https://api.ionify.cloud";
  const token = resolveCloudToken();
  if (!token) {
    logError(
      "bind: no cloud token found.\n  Run `ionify login --token <token>` first, or set IONIFY_CLOUD_TOKEN for CI."
    );
    process.exit(1);
  }
  await verifyProjectAccess(apiUrl, token, projectId);
  const cwd = process.cwd();
  const rootDir = config?.root ? path16.resolve(cwd, config.root) : cwd;
  const workspace = resolveWorkspace(rootDir, { projectRootOverride: rootDir });
  let binding;
  try {
    binding = bindProject(workspace, {
      projectId,
      apiUrl,
      projectSlug: options.slug,
      allowLocal: !!options.allowLocal
    });
  } catch (err) {
    logError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  logInfo("\u2713 Project binding saved to ~/.ionify/bindings.json");
  logInfo(`  project_id   : ${binding.projectId}`);
  logInfo(`  api_url      : ${apiUrl}`);
  logInfo(`  project_slug : ${binding.projectSlug}`);
  logInfo(`  binding_type : ${binding.bindingType}`);
  if (binding.fingerprint) logInfo(`  fingerprint  : ${binding.fingerprint.slice(0, 16)}\u2026`);
  const warning = bindingWarning({ binding, context: resolveBindingContext(workspace, { projectSlug: binding.projectSlug }) });
  if (warning) logWarn(warning);
}
async function verifyProjectAccess(apiUrl, token, projectId) {
  logInfo("Verifying project access\u2026");
  const client = new CloudClient({ apiUrl, token, projectId });
  try {
    await client._request("GET", `/v1/usage?project_id=${projectId}`, null, {});
  } catch (err) {
    if (err instanceof CloudUnreachableError) {
      logError(`bind: ${err.message}`);
      process.exit(1);
    }
    if (err instanceof CloudApiError && (err.statusCode === 401 || err.statusCode === 403)) {
      logError("bind: token is invalid or does not have access to this project.");
      process.exit(1);
    }
  }
}

// src/cli/commands/status.ts
import path17 from "path";
var EMPTY_PROJECT_ID3 = "00000000-0000-0000-0000-000000000000";
async function runStatusCommand(options = {}) {
  const config = await loadIonifyConfig();
  const cloud = config?.cloud;
  const profile = resolveCloudProfile();
  const token = resolveCloudToken();
  const cwd = process.cwd();
  const rootDir = config?.root ? path17.resolve(cwd, config.root) : cwd;
  const workspace = resolveWorkspace(rootDir, { projectRootOverride: rootDir });
  const resolvedBinding = resolveProjectBinding(workspace);
  const binding = resolvedBinding?.binding ?? null;
  const bindingWarn = resolvedBinding ? bindingWarning(resolvedBinding) : null;
  const configuredProjectId = cloud?.projectId === EMPTY_PROJECT_ID3 ? void 0 : cloud?.projectId;
  const apiUrl = binding?.apiUrl ?? profile?.apiUrl ?? cloud?.apiUrl ?? "https://api.ionify.cloud";
  const projectId = binding?.projectId ?? configuredProjectId ?? null;
  let cloudState = "not_checked";
  let cloudMessage = null;
  let usage = null;
  if (token && projectId) {
    const client = new CloudClient({
      apiUrl,
      token,
      projectId,
      binding: binding ?? void 0
    });
    try {
      usage = await client.getUsage();
      cloudState = "reachable";
    } catch (err) {
      if (err instanceof CloudUnreachableError) {
        cloudState = "unreachable";
        cloudMessage = err.message;
      } else if (err instanceof CloudApiError && (err.statusCode === 401 || err.statusCode === 403)) {
        cloudState = "unauthorized";
        cloudMessage = `Cloud API rejected the token for project ${projectId}.`;
      } else if (err instanceof Error) {
        cloudState = "error";
        cloudMessage = err.message;
      } else {
        cloudState = "error";
        cloudMessage = String(err);
      }
    }
  }
  const payload = {
    cwd,
    apiUrl,
    hasToken: Boolean(token),
    tokenSource: process.env.IONIFY_CLOUD_TOKEN ? "IONIFY_CLOUD_TOKEN" : token ? "~/.ionify/credentials.json" : null,
    projectId,
    configuredProjectId: configuredProjectId ?? null,
    binding: binding ? {
      projectId: binding.projectId,
      projectSlug: binding.projectSlug,
      bindingType: binding.bindingType,
      fingerprint: binding.fingerprint,
      normalizedRemote: binding.normalizedRemote,
      workspaceRelPath: binding.workspaceRelPath,
      localProjectRelPath: binding.localProjectRelPath,
      createdAt: binding.createdAt,
      updatedAt: binding.updatedAt
    } : null,
    bindingWarning: bindingWarn,
    cloud: {
      state: cloudState,
      message: cloudMessage,
      usage
    }
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}
`);
    return;
  }
  logInfo("Ionify Cloud status");
  logInfo(`  cwd          : ${cwd}`);
  logInfo(`  api_url      : ${apiUrl}`);
  logInfo(`  token        : ${payload.hasToken ? `found (${payload.tokenSource})` : "missing"}`);
  logInfo(`  project_id   : ${projectId ?? "not bound"}`);
  if (configuredProjectId && binding && configuredProjectId !== binding.projectId) {
    logWarn(`config project_id differs from binding: ${configuredProjectId}`);
  }
  if (binding) {
    logInfo(`  binding      : ${binding.bindingType}`);
    logInfo(`  project_slug : ${binding.projectSlug}`);
    logInfo(`  workspace    : ${binding.workspaceRelPath}`);
    if (binding.normalizedRemote) logInfo(`  git_remote   : ${binding.normalizedRemote}`);
    if (binding.fingerprint) logInfo(`  fingerprint  : ${binding.fingerprint.slice(0, 16)}\u2026`);
    if (bindingWarn) logWarn(bindingWarn);
  } else {
    logWarn("No project binding found. Run `ionify bind --project <project-id>` from this project root.");
  }
  if (!token) {
    logWarn("Cloud check skipped: no token found. Run `ionify login --token <token>`.");
  } else if (!projectId) {
    logWarn("Cloud check skipped: no project binding found.");
  } else if (cloudState === "reachable") {
    logInfo("  cloud        : reachable");
  } else {
    logError(`  cloud        : ${cloudState}${cloudMessage ? ` \u2014 ${cloudMessage}` : ""}`);
  }
}

// src/cli/commands/migrate.ts
import fs17 from "fs";
import path18 from "path";
var VITE_CONFIG_NAMES = [
  "vite.config.ts",
  "vite.config.mts",
  "vite.config.cts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs"
];
async function runMigrateCommand(options = {}) {
  const cwd = options.cwd ? path18.resolve(options.cwd) : process.cwd();
  const report = [];
  const viteConfigPath = VITE_CONFIG_NAMES.map((name) => path18.join(cwd, name)).find((p) => fs17.existsSync(p)) ?? null;
  const pkgPath = path18.join(cwd, "package.json");
  const pkg = readJson2(pkgPath);
  const hasViteDep = !!(pkg && (pkg.dependencies && pkg.dependencies.vite || pkg.devDependencies && pkg.devDependencies.vite));
  if (!viteConfigPath && !hasViteDep) {
    logError(
      "No Vite project detected here (no vite.config.* and no `vite` dependency). Run `ionify migrate` from the project root."
    );
    process.exit(1);
  }
  const ionifyConfigOut = path18.join(cwd, "ionify.config.ts");
  if (fs17.existsSync(ionifyConfigOut) && !options.force) {
    logError(
      "ionify.config.ts already exists. Re-run with --force to overwrite (a .bak copy is kept)."
    );
    process.exit(1);
  }
  logInfo(`Migrating Vite \u2192 Ionify in ${cwd}`);
  let viteConfig = {};
  if (viteConfigPath) {
    try {
      viteConfig = await loadViteConfig(viteConfigPath);
      logInfo(`Resolved ${path18.basename(viteConfigPath)}`);
    } catch (err) {
      logWarn(
        `Could not execute ${path18.basename(viteConfigPath)} (${String(
          err?.message ?? err
        )}); using best-effort static parse.`
      );
      report.push(
        `\u26A0 The Vite config could not be executed; values were extracted by static parse. Review the generated ionify.config.ts against ${path18.basename(viteConfigPath)}.`
      );
      viteConfig = staticParseViteConfig(fs17.readFileSync(viteConfigPath, "utf8"));
    }
  } else {
    report.push("\u26A0 No vite.config.* found \u2014 generated a minimal ionify.config.ts from package.json.");
  }
  const { ionifyConfig, notes } = mapViteToIonify(viteConfig, cwd);
  report.push(...notes);
  if (fs17.existsSync(ionifyConfigOut)) backupFile(ionifyConfigOut);
  fs17.writeFileSync(ionifyConfigOut, serializeIonifyConfig(ionifyConfig), "utf8");
  logInfo("Wrote ionify.config.ts");
  if (viteConfigPath) {
    backupFile(viteConfigPath);
    report.push(`\u2022 Backed up ${path18.basename(viteConfigPath)} \u2192 ${path18.basename(viteConfigPath)}.bak`);
  }
  if (pkg) {
    backupFile(pkgPath);
    report.push(...updatePackageJson(pkg, pkgPath));
    logInfo("Updated package.json scripts + added `ionify` devDependency (vite left installed)");
  }
  writeReport(cwd, viteConfigPath, ionifyConfig, report);
  logInfo("");
  logInfo("\u2705 Migration complete.");
  logInfo("   1. Install Ionify:  npm install   (or pnpm/yarn install)");
  logInfo("   2. Start dev:       ionify dev");
  logInfo("   3. Review MIGRATION_REPORT.md for anything that needs manual attention.");
}
async function loadViteConfig(configPath) {
  const mod = await importNativeConfigModule(configPath);
  let cfg = mod.default ?? mod;
  if (typeof cfg === "function") {
    cfg = await cfg({
      command: "build",
      mode: "production",
      isSsrBuild: false,
      isPreview: false,
      ssrBuild: false
    });
  }
  cfg = await cfg;
  return cfg && typeof cfg === "object" ? cfg : {};
}
function staticParseViteConfig(source) {
  const out = {};
  const baseMatch = source.match(/\bbase\s*:\s*["'`]([^"'`]+)["'`]/);
  if (baseMatch) out.base = baseMatch[1];
  const portMatch = source.match(/\bport\s*:\s*(\d+)/);
  const outDirMatch = source.match(/\boutDir\s*:\s*["'`]([^"'`]+)["'`]/);
  if (portMatch) out.server = { port: Number(portMatch[1]) };
  if (outDirMatch) out.build = { outDir: outDirMatch[1] };
  return out;
}
function mapViteToIonify(vite, cwd) {
  const out = {
    productionArtifactPublishing: "auto"
  };
  const notes = [
    "\u2022 Enabled Production Publishing in auto mode; set productionArtifactPublishing: false to opt out."
  ];
  const v = (k) => vite[k];
  const alias = v("resolve")?.alias;
  const aliasObj = {};
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
  const server = {};
  const vServer = v("server");
  if (typeof vServer?.port === "number") server.port = vServer.port;
  if (typeof vServer?.host === "string") server.host = vServer.host;
  else if (vServer?.host === true) server.host = "0.0.0.0";
  if (vServer?.https) {
    server.https = true;
    notes.push("\u2022 server.https \u2192 `true`. If you used custom cert/key, set them in Ionify's server.https config.");
  }
  if (vServer?.cors !== void 0) server.cors = !!vServer.cors;
  if (vServer?.proxy) {
    notes.push("\u26A0 server.proxy is set in Vite \u2014 Ionify's dev proxy is configured differently. Port it manually.");
  }
  if (Object.keys(server).length) out.server = server;
  const build = {};
  const vBuild = v("build");
  if (typeof vBuild?.outDir === "string") build.outDir = vBuild.outDir;
  if (typeof vBuild?.sourcemap === "boolean") build.sourcemap = vBuild.sourcemap;
  if (vBuild?.minify !== void 0) build.minify = vBuild.minify !== false;
  if (typeof vBuild?.target === "string") build.target = vBuild.target;
  if (Object.keys(build).length) out.build = build;
  const vCss = v("css");
  if (vCss) {
    const css = {};
    if (vCss.modules) css.modules = vCss.modules === true ? {} : vCss.modules;
    if (typeof vCss.postcss === "string") css.postcss = vCss.postcss;
    if (Object.keys(css).length) out.css = css;
    if (vCss.preprocessorOptions) {
      notes.push("\u26A0 css.preprocessorOptions (Sass/Less) present \u2014 verify under Ionify css config.");
    }
  }
  if (vite.define && typeof vite.define === "object") out.define = vite.define;
  if (vite.envPrefix) out.envPrefix = vite.envPrefix;
  if (typeof vite.base === "string" && vite.base !== "/") out.base = vite.base;
  if (typeof vite.publicDir === "string") out.publicDir = toRootRelative(vite.publicDir, cwd);
  else if (vite.publicDir === false) out.publicDir = false;
  const plugins = Array.isArray(vite.plugins) ? vite.plugins.flat(Infinity) : [];
  for (const p of plugins) {
    const name = pluginName(p);
    if (!name) continue;
    if (/(^|[^a-z])react([^a-z]|$)/i.test(name)) {
      notes.push(`\u2022 Plugin "${name}" \u2192 Ionify has built-in React + Fast Refresh; no plugin needed.`);
    } else {
      notes.push(`\u26A0 Plugin "${name}" is not auto-mapped \u2014 check whether Ionify covers it natively.`);
    }
  }
  return { ionifyConfig: out, notes };
}
function pluginName(plugin) {
  if (!plugin) return null;
  if (Array.isArray(plugin)) {
    for (const p of plugin) {
      const n = pluginName(p);
      if (n) return n;
    }
    return null;
  }
  if (typeof plugin === "object" && typeof plugin.name === "string") {
    return plugin.name;
  }
  return null;
}
function toRootRelative(p, cwd) {
  if (!path18.isAbsolute(p)) {
    return "/" + p.replace(/^\.\//, "").replace(/^\/+/, "");
  }
  const rel = path18.relative(cwd, p);
  if (rel.startsWith("..")) return p;
  return "/" + rel.split(path18.sep).join("/");
}
function updatePackageJson(pkg, pkgPath) {
  const notes = [];
  pkg.scripts = pkg.scripts || {};
  for (const [name, raw] of Object.entries(pkg.scripts)) {
    if (typeof raw !== "string") continue;
    if (/\bvite\s+preview\b/.test(raw)) {
      notes.push(
        `\u2022 Script "${name}" runs \`vite preview\` \u2014 Ionify has no preview server; serve the build output with any static file server.`
      );
      continue;
    }
    const next = raw.replace(/\bvite\s+build\b/g, "ionify build").replace(/\bvite\s+optimize\b/g, "ionify build").replace(/(^|\s)vite(\s|$)/g, "$1ionify dev$2").trimEnd();
    if (next !== raw) pkg.scripts[name] = next;
  }
  pkg.devDependencies = pkg.devDependencies || {};
  const hasIonify = pkg.dependencies && pkg.dependencies.ionify || pkg.devDependencies.ionify;
  if (!hasIonify) {
    pkg.devDependencies.ionify = "latest";
    notes.push("\u2022 Added `ionify@latest` to devDependencies \u2014 run your package manager's install.");
  }
  fs17.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  notes.push("\u2022 package.json scripts rewritten (vite \u2192 ionify); original saved as package.json.bak.");
  return notes;
}
function serializeIonifyConfig(config) {
  const body = Object.keys(config).length ? JSON.stringify(config, null, 2) : "{}";
  return `import { defineConfig } from "ionify";

// Generated by \`ionify migrate\`. Review against your previous vite.config.
export default defineConfig(${body});
`;
}
function writeReport(cwd, viteConfigPath, ionifyConfig, notes) {
  const lines = [];
  lines.push("# Ionify Migration Report", "");
  lines.push(`Migrated from: \`${viteConfigPath ? path18.basename(viteConfigPath) : "(no vite.config)"}\``);
  lines.push("Generated: `ionify.config.ts` + updated `package.json` scripts", "");
  lines.push("## Mapped configuration", "");
  lines.push("```ts");
  lines.push(serializeIonifyConfig(ionifyConfig).trim());
  lines.push("```", "");
  lines.push("## Notes & manual steps", "");
  if (notes.length === 0) {
    lines.push("- Nothing flagged \u2014 a clean, fully-mapped migration. \u{1F389}");
  } else {
    for (const n of notes) lines.push(`- ${n.replace(/^[•\s]+/, "")}`);
  }
  lines.push("", "## Runtime compatibility (already handled by Ionify)", "");
  lines.push("- `.env` files load in Vite order; `%VITE_*%` placeholders in `index.html` are substituted.");
  lines.push("- `index.html` is the entry document as in Vite \u2014 no change needed.");
  lines.push("- `vite` is left installed so you can revert via the `.bak` files if needed.");
  fs17.writeFileSync(path18.join(cwd, "MIGRATION_REPORT.md"), lines.join("\n") + "\n", "utf8");
}
function backupFile(filePath) {
  try {
    fs17.copyFileSync(filePath, `${filePath}.bak`);
  } catch {
  }
}
function readJson2(filePath) {
  try {
    return JSON.parse(fs17.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

// src/cli/index.ts
if (!process.env.NODE_COMPILE_CACHE) {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (home) process.env.NODE_COMPILE_CACHE = home + "/.ionify/global/compile-cache";
}
function resolveCliVersion() {
  try {
    const here = dirname(fileURLToPath2(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "..", "package.json"), "utf8"));
    return typeof pkg?.version === "string" && pkg.version.length > 0 ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
var program = new Command();
function validateEnvFlag(cmd, value) {
  if (value === "development" || value === "production") return value;
  logError(`${cmd}: --env must be 'development' or 'production' (got '${value}')`);
  process.exit(1);
}
function logPushCommandError(err) {
  if (err instanceof CloudApiError && err.statusCode === 401) {
    logError(formatCloudAuthError("Push"));
    return;
  }
  if (err instanceof CloudApiError && err.statusCode === 429) {
    logError(formatCloudQuotaError("Push", "cloud request", err));
    return;
  }
  logError("Push failed", err);
}
function logHydrateCommandError(err) {
  if (err instanceof CloudApiError && err.statusCode === 401) {
    logError(formatCloudAuthError("Hydrate"));
    return;
  }
  if (err instanceof CloudApiError && err.statusCode === 429) {
    logError(formatCloudQuotaError("Hydrate", "cloud request", err));
    return;
  }
  logError("Hydrate failed", err);
}
program.name("ionify").description("Ionify \u2013 Instant, Intelligent, Unified Build Engine").version(resolveCliVersion());
program.command("dev").description("Start Ionify development server").option("-p, --port <port>", "Port to run the server on", "5173").option("-m, --mode <mode>", "Environment mode, loads .env.<mode> file (default: development)").option("--hydrate", "Hydrate deps from Ionify Cloud CDC before starting (Tier-2)").option("--hydrate-tier1", "Also hydrate Tier-1 source transforms before starting").option("--namespace <name>", "Tier-1 namespace for hydration (overrides config.cloud.namespace)").option("--concurrency <n>", "Upload/download concurrency for cloud ops", parseInt).action(async (options) => {
  try {
    if (options.hydrate || options.hydrateTier1) {
      await runHydrateCommand({
        tier1: !!options.hydrateTier1,
        tier2: !options.hydrateTier1 || !!options.hydrate,
        namespace: options.namespace,
        concurrency: options.concurrency,
        env: "development"
      });
    }
    const port = parseInt(options.port, 10);
    await startDevServer({ port, mode: options.mode });
  } catch (err) {
    logError("Failed to start dev server", err);
    process.exit(1);
  }
});
program.command("build").description("Create production build using Ionify bundler").option("-o, --out-dir <dir>", "Output directory", "dist").option("-m, --mode <mode>", "Environment mode, loads .env.<mode> while keeping production build semantics").option("--push", "Push artifacts to Ionify Cloud after build (Tier-1 + Tier-2 by default)").option("--tier1", "With --push: push only Tier-1 (source transforms)").option("--tier2", "With --push: push only Tier-2 (CDC deps cache)").option("--hydrate", "Hydrate Tier-2 deps from cloud before building").option("--hydrate-tier1", "Also hydrate Tier-1 source transforms before building").option("--namespace <name>", "Tier-1 namespace name (overrides config.cloud.namespace)").option("--concurrency <n>", "Upload/download concurrency for cloud ops", parseInt).action(async (options) => {
  try {
    if (options.mode) {
      process.env.MODE = options.mode;
      process.env.IONIFY_MODE = options.mode;
    }
    if (options.hydrate || options.hydrateTier1) {
      await runHydrateCommand({
        tier1: !!options.hydrateTier1,
        tier2: !options.hydrateTier1 || !!options.hydrate,
        namespace: options.namespace,
        concurrency: options.concurrency,
        env: "production"
      });
    }
    await runBuildCommand({ outDir: options.outDir, mode: options.mode });
    if (options.push) {
      await runPushCommand({
        tier1: !!options.tier1,
        tier2: !!options.tier2,
        concurrency: options.concurrency,
        namespace: options.namespace
      });
    }
  } catch {
    process.exit(1);
  }
});
program.command("publish").description("Publish production contracts or artifacts into .ionify without writing build output").option("-m, --mode <mode>", "Environment mode, loads .env.<mode> while keeping production publication semantics").option("--contracts", "Publish Production Contracts (graph, plan, dependency contracts, transform artifacts)").option("--artifacts", "Publish Production Artifacts (contracts plus chunk artifacts)").addOption(new Option("--phase <phase>", "Internal compatibility alias: A/contracts or B/artifacts").hideHelp()).action(async (options) => {
  try {
    await runPublishCommand({
      mode: options.mode,
      phase: options.phase,
      contracts: !!options.contracts,
      artifacts: !!options.artifacts
    });
  } catch {
    process.exit(1);
  }
});
program.command("push").description("Push build artifacts to Ionify Cloud (Tier-1 + Tier-2 by default)").option("--tier1", "Push only Tier-1 (source transform blobs + manifest)").option("--tier2", "Push only Tier-2 (CDC deps cache session)").option("--namespace <name>", "Tier-1 namespace name (overrides config.cloud.namespace)").option("--env <env>", "Restrict push to a single env (development|production); default: every verified env on disk").option("--concurrency <n>", "Upload concurrency", parseInt).action(async (options) => {
  try {
    const env = options.env ? validateEnvFlag("push", options.env) : void 0;
    await runPushCommand({
      tier1: !!options.tier1,
      tier2: !!options.tier2,
      namespace: options.namespace,
      concurrency: options.concurrency,
      env
    });
  } catch (err) {
    logPushCommandError(err);
    process.exit(1);
  }
});
program.command("optimize-all").description("Fully optimize every dependency without starting dev or pushing").option("--env <env>", "Env to optimize (development|production); default: NODE_ENV or development").action(async (options) => {
  try {
    const env = options.env ? validateEnvFlag("optimize-all", options.env) : void 0;
    const { runOptimizeAllCommand } = await import("../optimize-all-QSJEDG5K.js");
    await runOptimizeAllCommand({ env });
  } catch (err) {
    logError("optimize-all failed", err);
    process.exit(1);
  }
});
program.command("hydrate").description("Hydrate artifacts from Ionify Cloud (Tier-1 + Tier-2 by default)").option("--tier1", "Hydrate only Tier-1 (source transform blobs from manifest)").option("--tier2", "Hydrate only Tier-2 (CDC deps cache)").option("--namespace <name>", "Tier-1 namespace name (overrides config.cloud.namespace)").option("--env <env>", "Env to hydrate (development|production); default: NODE_ENV or production").option("--concurrency <n>", "Download concurrency", parseInt).action(async (options) => {
  try {
    const env = options.env ? validateEnvFlag("hydrate", options.env) : void 0;
    await runHydrateCommand({
      tier1: !!options.tier1,
      tier2: !!options.tier2,
      namespace: options.namespace,
      concurrency: options.concurrency,
      env
    });
  } catch (err) {
    logHydrateCommandError(err);
    process.exit(1);
  }
});
program.command("login").description("Log in to Ionify Cloud (auth only; project binding is separate)").option("--api <url>", "Ionify Cloud API URL").option("--token <token>", "Existing project token from the dashboard").action(async (options) => {
  try {
    await runLoginCommand({
      apiUrl: options.api,
      token: options.token
    });
  } catch (err) {
    logError("Login failed", err);
    process.exit(1);
  }
});
program.command("bind").description("Bind the current folder to an Ionify Cloud project").requiredOption("--project <projectId>", "Project ID from the dashboard").option("--api <url>", "Ionify Cloud API URL").option("--slug <slug>", "Project slug/name used in the Fingerprint V1 hash").option("--allow-local", "Create a local_unverified binding when no git remote exists").action(async (options) => {
  try {
    await runBindCommand({
      projectId: options.project,
      apiUrl: options.api,
      slug: options.slug,
      allowLocal: !!options.allowLocal
    });
  } catch (err) {
    logError("Bind failed", err);
    process.exit(1);
  }
});
program.command("status").description("Show local binding and Ionify Cloud project status").option("--json", "Print machine-readable status JSON").action(async (options) => {
  try {
    await runStatusCommand({ json: !!options.json });
  } catch (err) {
    logError("Status failed", err);
    process.exit(1);
  }
});
program.command("logout").description("Log out from Ionify Cloud").action(() => runLogoutCommand());
program.command("whoami").description("Show current Ionify Cloud identity").action(async () => {
  try {
    await runWhoamiCommand();
  } catch (err) {
    logError("whoami failed", err);
    process.exit(1);
  }
});
program.command("migrate").description("Convert a Vite project to Ionify (config + scripts), with backups + a report").option("-f, --force", "Overwrite an existing ionify.config.ts (a .bak is kept)").option("-C, --cwd <dir>", "Project directory to migrate (defaults to current directory)").action(async (options) => {
  try {
    await runMigrateCommand({ cwd: options.cwd, force: !!options.force });
  } catch (err) {
    logError("Migration failed", err);
    process.exit(1);
  }
});
program.command("add").description("Add a copy-paste component to your project (shadcn-style, Ionify-native)").argument("[component]", "Component name, e.g. button").option("--list", "List available components").option("-d, --dir <dir>", "Target directory", "src/components/ui").option("-f, --force", "Overwrite if file exists").action(async (component, options) => {
  try {
    await runAddCommand(component, {
      list: !!options.list,
      dir: options.dir,
      force: !!options.force
    });
  } catch (err) {
    logError("Failed to add component", err);
    process.exit(1);
  }
});
program.command("analyze").description("Inspect graph, build, packs, routes, and Phase B analyzer findings").option("--json", "Output summary as JSON").option("--verbose", "Show full detailed analyzer sections after the summary").option("--section <name>", "Focus on one section: graph, build, deps, packs, routes, findings").option("-l, --limit <count>", "Limit list outputs", "10").option("--top <count>", "Alias for --limit").option("--graph", "Show graph summary").option("--tree", "Include dependency tree in graph summary").option("--deps", "Alias for --tree").option("--build", "Show build manifest/build.stats summary").option("--packs", "Show vendor-pack summary").option("--routes", "Show route-hint summary").option("--findings", "Show duplicate, bloat, and suggestion findings").option("--deps-hash <hash>", "Pin analyzer pack summary to a specific depsHash").option("--out-dir <dir>", "Build output directory to inspect", "dist").action(async (options) => {
  try {
    const rawLimit = options.top ?? options.limit ?? "10";
    const limit = parseInt(rawLimit, 10);
    const section = typeof options.section === "string" && options.section.length > 0 ? options.section.toLowerCase() : void 0;
    if (section && !["graph", "build", "deps", "packs", "routes", "findings"].includes(section)) {
      throw new Error(`Invalid --section value "${options.section}"`);
    }
    await runAnalyzeCommand({
      json: !!options.json,
      verbose: !!options.verbose,
      section,
      limit: Number.isFinite(limit) ? limit : 10,
      graph: !!options.graph,
      tree: !!options.tree,
      deps: !!options.deps,
      build: !!options.build,
      packs: !!options.packs,
      routes: !!options.routes,
      findings: !!options.findings,
      depsHash: options.depsHash,
      outDir: options.outDir
    });
  } catch (err) {
    logError("Analyzer failed", err);
    process.exit(1);
  }
});
program.parse(process.argv);
