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
import https from "https";
import url from "url";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import selfsigned from "selfsigned";
import { logInfo, logError, logWarn } from "@cli/utils/logger";
import { getCacheKey } from "@core/cache";
import {
  analyzeFeaturePackSharedClosurePressure,
  planAutoFeaturePackGroups,
  deriveFeaturePackRoutingMap,
  isFeaturePackSlimAligned,
  reconcilePackEntries,
  resolveChunkedPackEntries,
} from "@core/deps/feature-pack-planner";
import { extractDepCouplingGroups } from "@core/deps/dep-coupling";
import { computeChunkGroupIdFromStableIds } from "@core/deps/vendor-pack-utils";
import { hashFeaturePackRoutingIndex, hashVendorPackV2RoutingIndex } from "@core/deps/routing-hash";
import { VendorPackV2IndexManager, vendorPackV2MemberKey } from "@core/deps/vendor-pack-v2";
import { resolveAuthoritativeDepPreloadFiles } from "@core/deps/preload-routing";
import { Graph } from "@core/graph";
import { RouteHintIndex, normalizeDocumentRouteKey, type RouteHintKind } from "@core/route-hints";
import {
  buildStartupPolicySnapshot,
  loadStartupPolicySnapshot,
  persistStartupPolicySnapshot,
  selectStartupPolicyPreloads,
  StartupObservationIndex,
  type StartupPolicyEagerBudget,
  type StartupPolicySnapshot,
} from "@core/startup-policy";
import { extractImports } from "@core/resolver";
import { ModuleResolver } from "@core/resolver/module-resolver";
import { classifyImportSpecifiersForGraph, collectConfiguredExternalSpecifiers } from "@core/external-policy";
import { IonifyWatcher } from "@core/watcher";
import {
  TransformEngine,
  transformCache,
  type RuntimeDependencyFact,
  type TransformResult,
} from "@core/transform";
import { TransformWorkerPool } from "@core/worker/pool";
import { HMRServer, injectHMRClient, PendingHMRModule } from "@core/hmr";
import { compileCss, renderCssModule, renderCssRawStringModule, renderCssUrlModule, renderCssTokensModule, rewriteCssUrls } from "@core/loaders/css";
import { computeCssDemandGraphContentStamp, registerCssDemandGraphSourceFiles } from "@core/loaders/css-demand";
import { isCssLikeExt, isCssLikePath, isCssModuleLikePath } from "@core/utils/css-ext";
import { isAssetExt, contentTypeForAsset, assetAsModule, normalizeUrlFromFs } from "@core/loaders/asset";
import { isEntryModule } from "@core/refresh/entryDetection";
import { applyRegisteredLoaders } from "@core/loaders/registry";
import { loadIonifyConfig } from "@cli/utils/config";
import { readLockfile } from "@cli/utils/lockfile";
import { resolveMinifier } from "@cli/utils/minifier";
import { loadEnv as loadIonifyEnv } from "@cli/utils/env";
import { resolveTreeshake } from "@cli/utils/treeshake";
import { resolveScopeHoist } from "@cli/utils/scope-hoist";
import { resolveParser, applyParserEnv } from "@cli/utils/parser";
import { decodePublicPath, isForbiddenFsPath } from "@core/utils/public-path";
import { getCasArtifactPath } from "@core/utils/cas";
import os from "os";
import { resolveWorkspace } from "@core/workspace";
import { native, computeGraphVersion, getDepsOptimizerOutputVersion } from "@native/index";
import {
  getDepEntry,
  registerDepEntry,
  computeSubpathFromEntryPath,
  isCoreSingletonDepFileName,
} from "@core/deps/registry";
import { depsFileNameFromRuntimeUrl, formatDepsRuntimeUrl } from "@core/deps/runtime-url";
import {
  buildCanonicalDepFileNameIndex,
  canonicalizeDepFileName,
  canonicalizeDepUsageIndex,
  scanDepUsage,
  type DepUsageIndex,
} from "@core/deps/usage";
import {
  REACT_REFRESH_RUNTIME_MODULE,
  REACT_REFRESH_HMR_CONTRACT_VERSION,
  hasReactRootRenderSideEffect,
} from "@core/refresh/reactRefreshInstrumentation";
import { applyDefineReplacements, buildDefineConfig, substituteEnvPlaceholders } from "@core/utils/define";
import { isNotModified, weakEtagFromContent, weakEtagFromStat } from "@core/http-cache";
import crypto from "crypto";
import zlib from "zlib";
import { computeDepsHash } from "@cli/utils/deps-hash";
import {
  DependencyEnvironmentSettler,
  dependencyEnvironmentWatchPaths,
  type DependencyEnvironmentSnapshot,
} from "@core/deps/dependency-environment";
import {
  FEDERATION_GRAPH_PREFIX,
  buildFederationConfigGraphNodes,
  buildFederationVersionContract,
  collectFederationRemoteImportBindings,
  rewriteFederationGraphEdgeIds,
  type FederationPersistedGraphNode,
} from "@core/federation";
import { toWsModuleId } from "@core/module-id";

const IONIFY_CSS_JS_MARKER = "// ionify:css";
const IONIFY_VENDOR_PACK_MARKER = "// ionify:vendor-pack";
const IONIFY_VENDOR_PACK_V2_MARKER = "// ionify:vendor-pack-v2";
const DEPS_OPTIMIZER_OUTPUT_VERSION = getDepsOptimizerOutputVersion();
const VENDOR_PACK_V2_REWRITE_POLICY_VERSION = 2;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// When running from dist/cli/index.js, __dirname is dist/cli
// We need to go up to dist, then into client: dist/cli -> dist -> dist/client
const CLIENT_DIR = path.resolve(__dirname, "../client");
const CLIENT_FALLBACK_DIR = path.resolve(process.cwd(), "src/client");
const DEPS_PREFIX = "/@deps/";

function syncFederationGraphNodes(graph: Graph, nodes: FederationPersistedGraphNode[]): void {
  const nextIds = new Set(nodes.map((node) => node.id));
  for (const existingId of graph.listNodeIdsByPrefix(FEDERATION_GRAPH_PREFIX)) {
    if (!nextIds.has(existingId)) graph.removeNodeById(existingId);
  }
  for (const node of nodes) {
    graph.recordNodeById(node.id, node.hash, node.deps, node.dynamicDeps ?? [], node.kind);
  }
}

function resolvePublicDir(rootDir: string, value: unknown): string | null {
  if (value === false) return null;
  const dir = typeof value === "string" && value.trim().length > 0 ? value.trim() : "public";
  return path.isAbsolute(dir) ? dir : path.resolve(rootDir, dir);
}

function decodePublicDirPath(publicDirAbs: string, urlPath: string): string | null {
  if (!urlPath.startsWith("/")) return null;
  const normalizedRoot = path.resolve(publicDirAbs);
  const joined = path.resolve(normalizedRoot, "." + urlPath);
  if (!joined.startsWith(normalizedRoot + path.sep) && joined !== normalizedRoot) return null;
  if (isForbiddenFsPath(joined)) return null;
  return joined;
}

function shouldTryPublicDir(reqPath: string): boolean {
  if (!reqPath || reqPath === "/" || reqPath === "/index.html") return false;
  if (reqPath.startsWith(DEPS_PREFIX)) return false;
  if (reqPath.startsWith("/__ionify")) return false;
  return true;
}

type ResolvedSpaFallbackPolicy = {
  enabled: boolean;
  entryFilePath: string | null;
  entryUrlPath: string | null;
  disableDotRule: boolean;
};

function resolveSpaFallbackPolicy(rootDir: string, rawValue: unknown): ResolvedSpaFallbackPolicy {
  const objectValue =
    rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
      ? (rawValue as Record<string, unknown>)
      : null;
  const rawEnabled = objectValue ? objectValue.enabled : rawValue;
  const mode =
    rawEnabled === undefined ? "auto" : rawEnabled === true || rawEnabled === false ? rawEnabled : rawEnabled === "auto" ? "auto" : "auto";
  const entryRaw =
    objectValue && typeof objectValue.entry === "string" && objectValue.entry.trim().length > 0
      ? objectValue.entry.trim()
      : "/index.html";
  const entryFilePath = entryRaw.startsWith("/")
    ? path.join(rootDir, entryRaw)
    : path.resolve(rootDir, entryRaw);
  const disableDotRule = objectValue?.disableDotRule === true;
  const entryExists = fs.existsSync(entryFilePath) && fs.statSync(entryFilePath).isFile();
  const enabled = mode === "auto" ? entryExists : mode === true ? entryExists : false;

  return {
    enabled,
    entryFilePath: enabled ? entryFilePath : null,
    entryUrlPath: enabled ? normalizeUrlFromFs(rootDir, entryFilePath) : null,
    disableDotRule,
  };
}

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" ? value : "";
}

function isHtmlNavigationRequest(
  req: IncomingMessage,
  reqPath: string,
  query: Record<string, unknown>,
  policy: ResolvedSpaFallbackPolicy,
): boolean {
  if (!policy.enabled || !policy.entryFilePath) return false;
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  if (!reqPath.startsWith("/")) return false;
  if (reqPath.startsWith(DEPS_PREFIX) || reqPath.startsWith("/__ionify")) return false;
  if ("import" in query || "inline" in query || "raw" in query || "module" in query || "url" in query) {
    return false;
  }

  const baseName = path.posix.basename(reqPath);
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

function normalizeGraphDepForClient(rootDir: string, dep: string): string {
  return dep.startsWith("http://") || dep.startsWith("https://")
    ? dep
    : path.isAbsolute(dep)
      ? normalizeUrlFromFs(rootDir, dep)
      : dep;
}

function rewriteCssImportSpecifiers(
  cssText: string,
  filePath: string,
  rootDir: string,
  moduleResolver: ModuleResolver,
): string {
  const importRe =
    /@import\s+(?:url\(\s*)?(?:'([^']+)'|"([^"]+)"|([^'"\s)]+))\s*\)?[^;]*;/gi;
  let rewritten = "";
  let lastIndex = 0;
  let mutated = false;
  let match: RegExpExecArray | null;

  while ((match = importRe.exec(cssText))) {
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

function resolveHttpsMaterial(rootDir: string, rawValue: unknown): Buffer | string | undefined {
  if (typeof rawValue !== "string") return undefined;
  const trimmed = rawValue.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes("BEGIN ")) return trimmed;

  const candidate = path.isAbsolute(trimmed) ? trimmed : path.resolve(rootDir, trimmed);
  if (!fs.existsSync(candidate)) return undefined;
  return fs.readFileSync(candidate);
}

function ensureDevHttpsOptions(
  httpsConfig: unknown,
  rootDir: string,
  ionifyDir: string,
): https.ServerOptions | null {
  if (!httpsConfig) return null;

  if (typeof httpsConfig === "object" && httpsConfig !== null) {
    const configObject = httpsConfig as Record<string, unknown>;
    const key = resolveHttpsMaterial(rootDir, configObject.key);
    const cert = resolveHttpsMaterial(rootDir, configObject.cert);
    if (key && cert) {
      return {
        ...configObject,
        key,
        cert,
      } as https.ServerOptions;
    }
  }

  const certDir = path.join(ionifyDir, "certs");
  const keyPath = path.join(certDir, "dev-server.key");
  const certPath = path.join(certDir, "dev-server.crt");

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    fs.mkdirSync(certDir, { recursive: true });
    const generated = selfsigned.generate(
      [
        { name: "commonName", value: "localhost" },
        { name: "organizationName", value: "Ionify Dev Server" },
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
              { type: 7, ip: "127.0.0.1" },
            ],
          },
        ],
      },
    );
    fs.writeFileSync(keyPath, generated.private, "utf8");
    fs.writeFileSync(certPath, generated.cert, "utf8");
  }

  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (isCssLikeExt(ext)) return "text/css; charset=utf-8";
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

function selectPrecompressedVariant(
  req: IncomingMessage,
  baseFilePath: string,
): { filePath: string; encoding: "br" | "gzip" } | null {
  const header = req.headers["accept-encoding"];
  const value = Array.isArray(header) ? header.join(",") : header;
  if (!value) return null;
  const enc = value.toLowerCase();

  // Prefer brotli if a sidecar exists (zero CPU on serve path).
  if (enc.includes("br")) {
    const brPath = `${baseFilePath}.br`;
    if (fs.existsSync(brPath)) return { filePath: brPath, encoding: "br" };
  }

  if (enc.includes("gzip")) {
    const gzPath = `${baseFilePath}.gz`;
    if (fs.existsSync(gzPath)) return { filePath: gzPath, encoding: "gzip" };
  }

  return null;
}

function sendPrecompressedFile(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  contentType: string,
  variant: { filePath: string; encoding: "br" | "gzip" },
  opts: { etagPrefix: string; cacheControl: string },
): void {
  const stat = fs.statSync(variant.filePath);
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
  res.end(fs.readFileSync(variant.filePath));
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
      entries.push(`${abs}:${getCacheKey(fs.readFileSync(abs))}`);
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

function injectInlineScript(html: string, script: string): string {
  const tag = `<script>${script}</script>`;
  if (html.includes(tag)) return html;

  const headCloseMatch = html.match(/<\/head>/i);
  if (headCloseMatch?.index !== undefined) {
    const idx = headCloseMatch.index;
    return `${html.slice(0, idx)}${tag}\n${html.slice(idx)}`;
  }

  const bodyOpenMatch = html.match(/<body[^>]*>/i);
  if (bodyOpenMatch?.index !== undefined) {
    const idx = bodyOpenMatch.index + bodyOpenMatch[0].length;
    return `${html.slice(0, idx)}\n${tag}${html.slice(idx)}`;
  }

  return `${tag}\n${html}`;
}

function injectStartupEvaluationMarker(code: string): string {
  const marker = "globalThis.__IONIFY_STARTUP__?.markEvaluated?.(import.meta.url);";
  return code.startsWith(marker) ? code : `${marker}\n${code}`;
}

function instrumentJavaScriptBuffer(buffer: Buffer, enabled: boolean): Buffer {
  if (!enabled) return buffer;
  return Buffer.from(injectStartupEvaluationMarker(buffer.toString("utf8")));
}

function extractBarePackageRoot(specifier: string): string | null {
  const raw = String(specifier || "").trim();
  if (!raw) return null;
  if (
    raw.startsWith(".") ||
    raw.startsWith("/") ||
    raw.startsWith("http://") ||
    raw.startsWith("https://")
  ) {
    return null;
  }
  if (raw.startsWith("@")) {
    const parts = raw.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : raw;
  }
  const slashIndex = raw.indexOf("/");
  return slashIndex === -1 ? raw : raw.slice(0, slashIndex);
}

function extractPackageRootFromLabel(label: string): string | null {
  return extractBarePackageRoot(label);
}

function buildRouteHintClientKey(req: IncomingMessage): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const remoteAddress = typeof forwardedValue === "string" && forwardedValue.trim().length > 0
    ? forwardedValue.split(",")[0]?.trim() ?? ""
    : req.socket.remoteAddress ?? "";
  const userAgent = Array.isArray(req.headers["user-agent"])
    ? req.headers["user-agent"][0] ?? ""
    : req.headers["user-agent"] ?? "";
  const key = `${remoteAddress}::${userAgent}`.trim();
  return key.length > 2 ? key : null;
}

function pruneDepsCache(ionifyDir: string, depsHash: string) {
  const depsRoot = path.join(ionifyDir, "deps");
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

type DepsManifestIndexEntry = {
  entryPath: string;
  artifactHash: string | null;
  packageLabel: string;
  hasSourcemap: boolean;
  sizeBytes: number;
  moduleCount: number;
  edgeCount: number;
  externalCount: number;
  outputVersion: number;
  chunkGroup: string | null;
  chunkFiles: string[];
};

function loadDepsManifestIndex(depsRoot: string): Map<string, DepsManifestIndexEntry> {
  const manifestPath = path.join(depsRoot, "manifest.json");
  if (!fs.existsSync(manifestPath)) return new Map();
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    const entries: Record<string, any> = parsed?.entries ?? {};
    const map = new Map<string, DepsManifestIndexEntry>();
    for (const [entryPath, entry] of Object.entries(entries)) {
      if (!entry?.outFile) continue;
      const artifactHash =
        typeof (entry as any).artifactHash === "string" && (entry as any).artifactHash.length > 0
          ? (entry as any).artifactHash
          : typeof (entry as any).artifact_hash === "string" && (entry as any).artifact_hash.length > 0
            ? (entry as any).artifact_hash
            : null;
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
      const outputVersion =
        typeof (entry as any).outputVersion === "number"
          ? (entry as any).outputVersion
          : typeof (entry as any).output_version === "number"
            ? (entry as any).output_version
            : 0;
      const chunkFilesRaw =
        Array.isArray((entry as any).chunkFiles)
          ? (entry as any).chunkFiles
          : Array.isArray((entry as any).chunk_files)
            ? (entry as any).chunk_files
            : [];
      const chunkFiles = (Array.isArray(chunkFilesRaw) ? chunkFilesRaw : [])
        .map((v) => (typeof v === "string" ? v : null))
        .filter((v): v is string => typeof v === "string" && v.length > 0);
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
        chunkFiles,
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Phase 6.1: Vendor Packs (Few-Request Mode)
// ---------------------------------------------------------------------------

type VendorPackMember = {
  fileName: string;
  entryPath: string;
  packageLabel: string;
  score: number;
  signals: {
    requestCount: number;
    sizeBytes: number;
    moduleCount: number;
    edgeCount: number;
    externalCount: number;
  };
};

type VendorPackPlan = {
  version: number;
  depsHash: string;
  updatedAt: string;
  members: VendorPackMember[];
};

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
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  } catch {
    // ignore write errors; vendor packs are best-effort
  }
}

function normalizeAbsList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .map((value) => path.resolve(value)),
    ),
  ).sort();
}

// Tailwind graph-content freshness is proven by the CSSA-owned aggregated
// stamp (one stamp over graph-admitted source content identity), never by
// admitting source files as per-artifact CSS dependencies. meta.json v2 keeps
// deps/urlDeps for the real CSS dependency surface only (configs, partials,
// @imports, url() assets).
const DEV_CSS_META_VERSION = 2;

function metaTailwindStampForRecipe(meta: any): string {
  return meta?.tailwindGraphContent?.enabled === true &&
    typeof meta.tailwindGraphContent.stamp === "string" &&
    meta.tailwindGraphContent.stamp.length > 0
    ? meta.tailwindGraphContent.stamp
    : "none";
}

function compileTailwindStampForRecipe(tailwindGraphContent: any): string {
  return tailwindGraphContent?.enabled === true &&
    typeof tailwindGraphContent.stamp === "string" &&
    tailwindGraphContent.stamp.length > 0
    ? tailwindGraphContent.stamp
    : "none";
}

function devCssMetaIsCurrent(
  meta: any,
  contentHash: string,
  modules: boolean,
  rootDir: string,
): boolean {
  if (!meta || typeof meta !== "object") return false;
  if (meta.version !== DEV_CSS_META_VERSION || meta.baseHash !== contentHash || meta.modules !== modules) return false;
  if (typeof meta.depsStampHash !== "string" || meta.depsStampHash.length === 0) return false;
  const deps = normalizeAbsList([...(Array.isArray(meta.deps) ? meta.deps : []), ...(Array.isArray(meta.urlDeps) ? meta.urlDeps : [])]);
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

function buildDevCssMeta(options: {
  contentHash: string;
  pipelineHash: string;
  depsAbs: string[];
  urlDepsAbs: string[];
  modules: boolean;
  tailwindGraphContent: any;
}) {
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
    generatedAt: new Date().toISOString(),
    tailwindGraphContent: tw
      ? {
          enabled: tw.enabled === true,
          files: Number(tw.files ?? 0),
          plugins: Number(tw.plugins ?? 0),
          configPath: typeof tw.configPath === "string" ? tw.configPath : null,
          fallbackReason: typeof tw.fallbackReason === "string" ? tw.fallbackReason : null,
          stamp: twEnabled && typeof tw.stamp === "string" && tw.stamp.length > 0 ? tw.stamp : null,
        }
      : null,
  };
}

function loadDepRequestCounts(filePath: string): Map<string, number> {
  const raw = readJsonFile<Record<string, unknown>>(filePath);
  if (!raw || typeof raw !== "object") return new Map();
  const map = new Map<string, number>();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      map.set(key, value);
    }
  }
  return map;
}

function saveDepRequestCounts(filePath: string, counts: Map<string, number>): void {
  const obj: Record<string, number> = {};
  const keys = Array.from(counts.keys()).sort();
  for (const key of keys) {
    const value = counts.get(key) ?? 0;
    if (value > 0) obj[key] = value;
  }
  writeJsonFile(filePath, obj);
}

function buildVendorPackPlan(options: {
  depsHash: string;
  mode: "auto" | "force";
  vendorDeps: VendorDep[];
  manifestIndex: Map<string, DepsManifestIndexEntry>;
  requestCounts: Map<string, number>;
  maxBytes: number;
  maxMembers: number;
}): VendorPackPlan {
  const {
    depsHash,
    mode,
    vendorDeps,
    manifestIndex,
    requestCounts,
    maxBytes,
    maxMembers,
  } = options;

  const vendorFileNames = new Set(vendorDeps.map((d) => d.fileName));
  const candidates: VendorPackMember[] = [];

  for (const [fileName, entry] of manifestIndex.entries()) {
    if (vendorFileNames.has(fileName)) continue;
    if (!entry?.entryPath) continue;

    const requestCount = requestCounts.get(fileName) ?? 0;
    const sizeBytes = entry.sizeBytes ?? 0;
    const moduleCount = entry.moduleCount ?? 0;
    const edgeCount = entry.edgeCount ?? 0;
    const externalCount = entry.externalCount ?? 0;

    const qualifies =
      // Force mode: any requested dep can be eligible, still subject to caps.
      (mode === "force" && requestCount >= 1) ||
      // Heuristic v1 (Phase 6.1 roadmap).
      requestCount >= 2 ||
      sizeBytes >= 80 * 1024 ||
      moduleCount >= 120 ||
      edgeCount >= 400 ||
      // Ionify-native signal: many external deps implies a request-waterfall root (e.g. Radix).
      externalCount >= 6;

    if (!qualifies) continue;

    const sizeKb = Math.max(sizeBytes / 1024, 1);
    const score =
      10 * Math.min(requestCount, 5) +
      8 * Math.log2(sizeKb) +
      3 * Math.min(moduleCount / 50, 5) +
      // Extra weight for deps that trigger many external `/@deps/*` requests (waterfall roots).
      4 * Math.min(externalCount, 10);

    candidates.push({
      fileName,
      entryPath: entry.entryPath,
      packageLabel: entry.packageLabel || fileName,
      score,
      signals: { requestCount, sizeBytes, moduleCount, edgeCount, externalCount },
    });
  }

  candidates.sort((a, b) => {
    const scoreDelta = b.score - a.score;
    if (scoreDelta !== 0) return scoreDelta;
    return a.packageLabel.localeCompare(b.packageLabel);
  });

  const selected: VendorPackMember[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const candidate of candidates) {
    if (selected.length >= maxMembers) break;
    if (seen.has(candidate.fileName)) continue;
    const sizeBytes = candidate.signals.sizeBytes ?? 0;
    if (totalBytes + sizeBytes > maxBytes) continue;
    if (!candidate.entryPath || !fs.existsSync(candidate.entryPath)) continue;
    seen.add(candidate.fileName);
    totalBytes += sizeBytes;
    selected.push(candidate);
  }

  return {
    version: 1,
    depsHash,
    updatedAt: new Date().toISOString(),
    members: selected,
  };
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
      status: "reload";
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
  /** Dev mode name, determines which `.env.<mode>` file is loaded (default: "development"). */
  mode?: string;
}

export interface DevServerHandle {
  server: http.Server | https.Server;
  port: number;
  close: () => Promise<void>;
}

export function resolveDevProductionPublishingBuildMode(
  productionArtifactPublishing: unknown,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw =
    productionArtifactPublishing &&
    typeof productionArtifactPublishing === "object" &&
    typeof (productionArtifactPublishing as any).mode === "string"
      ? (productionArtifactPublishing as any).mode
      : env.IONIFY_PRODUCTION_PUBLISHING_MODE;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : "production";
}

export async function startDevServer({
  port,
  host,
  enableSignalHandlers = true,
  mode,
}: StartDevServerOptions = {}): Promise<DevServerHandle> {
  const bootStartMs = Date.now();
  const envMode = mode ?? process.env.IONIFY_MODE ?? process.env.MODE ?? "development";
  process.env.IONIFY_MODE = envMode;
  process.env.MODE = envMode;
  // Phase 5.4.2: Load config first to get root option
  const userConfig = await loadIonifyConfig(process.cwd(), envMode);
  const configuredExternalSpecifiers = collectConfiguredExternalSpecifiers(userConfig);
  const projectRootOverride = userConfig?.root ? path.resolve(userConfig.root) : null;
  const workspace = resolveWorkspace(projectRootOverride ?? process.cwd(), {
    projectRootOverride,
  });
  const rootDir = workspace.projectRoot;
  const ionifyDir = workspace.ionifyDir;
  const allowedRoots = workspace.allowedRoots;
  const publicDirAbs = resolvePublicDir(rootDir, (userConfig as any)?.publicDir);

  // Ensure deterministic workspace-scoped state, independent of where the command is run from.
  fs.mkdirSync(ionifyDir, { recursive: true });
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
    resolveOptions: {
      alias: (userConfig as any)?.resolve?.alias,
      builtinFallback: (userConfig as any)?.resolve?.builtinFallback,
      runtimeGlobals: (userConfig as any)?.resolve?.runtimeGlobals,
      extensions: (userConfig as any)?.resolve?.extensions,
      conditions: (userConfig as any)?.resolve?.conditions,
      mainFields: (userConfig as any)?.resolve?.mainFields,
    },
    cssOptions: (userConfig as any)?.css,
    assetOptions: (userConfig as any)?.assets ?? (userConfig as any)?.asset,
    runtimeContracts: {
      reactRefreshRuntimeModule: REACT_REFRESH_RUNTIME_MODULE,
      reactRefreshHmr: REACT_REFRESH_HMR_CONTRACT_VERSION,
      federation: buildFederationVersionContract(userConfig?.federation),
    },
  };
  const configHash = computeGraphVersion(rawVersionInputs);
  logInfo(`[Dev] Version hash: ${configHash}`);
  process.env.IONIFY_CONFIG_HASH = configHash;
  const casRoot = path.join(ionifyDir, "cas");

  const lockfile = readLockfile(workspace.workspaceRoot, rootDir);
  if (lockfile) {
    const countLabel = lockfile.packageCount === null ? "unknown" : lockfile.packageCount;
    logInfo(`[deps] SCAN lockfile: ${lockfile.name} (${countLabel} packages)`);
  }

  // Deps hashing must include options that affect optimized output to keep artifacts version-isolated.
  const depsSourcemapEnabled = userConfig?.optimizeDeps?.sourcemap === true;
  const depsBundleEsmEnabled = userConfig?.optimizeDeps?.bundleEsm !== false; // default true
  const depsSharedChunksRaw = userConfig?.optimizeDeps?.sharedChunks;
  const depsSharedChunksMode =
    depsSharedChunksRaw === undefined || depsSharedChunksRaw === "auto"
      ? "auto"
      : depsSharedChunksRaw === true
        ? "1"
        : depsSharedChunksRaw === false
          ? "0"
          : String(depsSharedChunksRaw);
  const depsSharedChunksEnabled = depsSharedChunksMode !== "0";
  const depsNodeEnv = process.env.NODE_ENV ?? "development";

  let depsHash = computeDepsHash(configHash, lockfile, {
    nodeEnv: depsNodeEnv,
    sourcemap: depsSourcemapEnabled,
    bundleEsm: depsBundleEsmEnabled,
    sharedChunks: depsSharedChunksMode,
    outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
  });
  logInfo(`[deps] depsHash: ${depsHash} from ${lockfile?.name ?? "config"}`);
  // Expose for loaders/import rewriting (Phase 6.x progressive deps behavior).
  process.env.IONIFY_DEPS_HASH = depsHash;
  const depsRuntimeUrl = (fileName: string): string => formatDepsRuntimeUrl(fileName, depsHash);
  let depsRoot = path.join(ionifyDir, "deps", depsHash);
  fs.mkdirSync(depsRoot, { recursive: true });
  pruneDepsCache(ionifyDir, depsHash);

  // Phase 5-Cloud-EI-DX2: dev "stable point" sentinel.
  // Once the prewarm phase has settled (no new /@deps/* responses for
  // DEV_STABLE_DEBOUNCE_MS), write `.ionify/deps/<depsHash>/.dev-stable` so
  // `ionify push` can offer to push this partial-but-functional snapshot
  // (distinct from `.verified`, which only build / optimize-all writes).
  const DEV_STABLE_DEBOUNCE_MS = 5_000;
  let devStableTimer: NodeJS.Timeout | null = null;
  let devStableServedCount = 0;
  const writeDevStableSentinel = () => {
    try {
      const sentinelPath = path.join(depsRoot, ".dev-stable");
      const payload = {
        ts: new Date().toISOString(),
        depsHash,
        nodeEnv: depsNodeEnv,
        servedDepCount: devStableServedCount,
      };
      fs.writeFileSync(sentinelPath, JSON.stringify(payload));
    } catch {
      // best-effort — never crash dev because of sentinel write
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
    Array.from(depsManifestIndex, ([fileName, entry]) => ({ fileName, entryPath: entry.entryPath })),
  );
  const refreshDepsManifestIndex = () => {
    const refreshed = loadDepsManifestIndex(depsRoot);
    depsManifestIndex.clear();
    refreshed.forEach((value, key) => depsManifestIndex.set(key, value));
    depsManifestCanonicalFileNames = buildCanonicalDepFileNameIndex(
      Array.from(depsManifestIndex, ([fileName, entry]) => ({ fileName, entryPath: entry.entryPath })),
    );
  };
  const canonicalFileNameForEntry = (fileName: string, entryPath: string): string => {
    return canonicalizeDepFileName(fileName, entryPath, depsManifestCanonicalFileNames);
  };
  const realpathOrSelf = (filePath: string): string => {
    try {
      return fs.realpathSync(filePath);
    } catch {
      return filePath;
    }
  };
  const recordDepLeafGraphNodes = (depAbsPaths: readonly string[]): void => {
    if (depAbsPaths.length === 0) return;
    if (depsManifestIndex.size === 0) refreshDepsManifestIndex();
    const manifestEntries = Array.from(depsManifestIndex.values());

    const byCanonicalEntry = new Map<string, DepsManifestIndexEntry>();
    for (const entry of manifestEntries) {
      if (!entry.artifactHash) continue;
      byCanonicalEntry.set(realpathOrSelf(entry.entryPath), entry);
    }

    const seen = new Set<string>();
    for (const depAbs of depAbsPaths) {
      if (typeof depAbs !== "string" || depAbs.length === 0) continue;
      if (!depAbs.includes(`${path.sep}node_modules${path.sep}`)) continue;
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
          hash = crypto.createHash("sha256").update(fs.readFileSync(canonical)).digest("hex");
        } catch {
          continue;
        }
      }
      graph.recordNodeById(depId, hash, [], [], "dep", configHash);
    }
  };
  const graphCompletionExts = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);
  const completeLocalGraphClosure = (seedAbsPaths: readonly string[]): void => {
    const queue = seedAbsPaths.filter((dep) => typeof dep === "string" && dep.length > 0);
    const seen = new Set<string>();
    let processed = 0;

    while (queue.length && processed < 2000) {
      const absPath = queue.shift()!;
      if (!path.isAbsolute(absPath)) continue;
      const canonical = realpathOrSelf(absPath);
      if (seen.has(canonical)) continue;
      seen.add(canonical);

      if (canonical.includes(`${path.sep}node_modules${path.sep}`)) {
        recordDepLeafGraphNodes([canonical]);
        continue;
      }
      if (graph.getNode(canonical)) continue;
      if (!fs.existsSync(canonical)) continue;

      const extName = path.extname(canonical).toLowerCase();
      if (isAssetExt(extName)) {
        try {
          const assetHash = crypto.createHash("sha256").update(fs.readFileSync(canonical)).digest("hex");
          graph.recordFile(canonical, assetHash, [], [], "asset");
        } catch {
          // best effort
        }
        continue;
      }
      if (!graphCompletionExts.has(extName)) continue;

      let code: string;
      try {
        code = fs.readFileSync(canonical, "utf8");
      } catch {
        continue;
      }
      processed++;

      let hash: string;
      let specs: string[];
      if (native?.parseModuleIr) {
        try {
          const ir = native.parseModuleIr(canonical, code);
          hash = ir.hash;
          specs = ir.dependencies.map((dep: any) => dep.specifier);
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
        configuredExternalSpecifiers,
      );
      const nextDeps = rewriteFederationGraphEdgeIds(
        [...localDeps, ...externalDeps],
        federationRemoteBindings,
      );
      recordDepLeafGraphNodes(localDeps);
      graph.recordFile(canonical, hash, nextDeps);
      for (const dep of localDeps) queue.push(dep);
    }
  };
  const pendingGraphCompletionSeeds = new Set<string>();
  const enqueueLocalGraphCompletion = (seedAbsPaths: readonly string[]): void => {
    for (const depAbs of seedAbsPaths) {
      if (typeof depAbs !== "string" || depAbs.length === 0 || !path.isAbsolute(depAbs)) continue;
      pendingGraphCompletionSeeds.add(depAbs);
    }
  };
  const drainPendingGraphCompletion = async (): Promise<void> => {
    if (pendingGraphCompletionSeeds.size === 0) return;
    const seeds = Array.from(pendingGraphCompletionSeeds);
    pendingGraphCompletionSeeds.clear();
    completeLocalGraphClosure(seeds);
    graph.flush();
  };
  const upsertObservedPackEntry = (groupMap: Map<string, PackEntry>, entry: PackEntry): boolean => {
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
  const depUsageStatePath = () => path.join(depsRoot, "deps-usage.v2.json");
  const legacyDepUsageStatePath = () => path.join(depsRoot, "deps-usage.v1.json");
  const directDepUsageFileNames = new Set<string>();
  const setDirectDepUsageFileNames = (index: DepUsageIndex | null) => {
    directDepUsageFileNames.clear();
    if (!index) return;
    for (const usage of index.values()) {
      if (!usage?.fileName || !usage?.entryPath) continue;
      directDepUsageFileNames.add(canonicalFileNameForEntry(usage.fileName, usage.entryPath));
    }
  };
  const loadDirectDepUsageFileNamesFromDisk = () => {
    const raw = readJsonFile<any>(depUsageStatePath()) ?? readJsonFile<any>(legacyDepUsageStatePath());
    if (!raw || (raw.version !== 1 && raw.version !== 2) || raw.depsHash !== depsHash) return;
    const deps = raw.deps && typeof raw.deps === "object" ? raw.deps : {};
    for (const [fileName, value] of Object.entries(deps)) {
      const entryPath = typeof (value as any)?.entryPath === "string" ? (value as any).entryPath : "";
      if (!fileName || !entryPath) continue;
      directDepUsageFileNames.add(canonicalFileNameForEntry(fileName, entryPath));
    }
  };
  loadDirectDepUsageFileNamesFromDisk();
  const isDirectlyUsedDepFile = (fileName: string, entryPath: string): boolean => {
    if (directDepUsageFileNames.size === 0) return true;
    return directDepUsageFileNames.has(canonicalFileNameForEntry(fileName, entryPath));
  };
  
  // Phase 5.9.2: Vendor pack (dev) — preload hot framework deps early to reduce cold-start waterfalls.
  const optimizeVendorMode = userConfig?.optimizeDeps?.vendor ?? "auto";
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

  // -------------------------------------------------------------------------
  // Phase 6.1: Vendor packs (few-request mode).
  // Build one deterministic "app vendor pack" as a shared-chunk group.
  // Membership is computed from persisted session signals (request counts) + manifest metrics.
  // It is applied on next restart (like Vite optimizeDeps cache).
  // -------------------------------------------------------------------------
  const vendorPacksRaw = userConfig?.optimizeDeps?.vendorPacks ?? false;
  const packSlimmingRaw = userConfig?.optimizeDeps?.packSlimming ?? "auto";
  const vendorPacksForce = vendorPacksRaw === true;
  const vendorPacksProgressive = vendorPacksRaw === "auto";
  const vendorPacksManualRaw =
    !vendorPacksForce &&
    !vendorPacksProgressive &&
    vendorPacksRaw &&
    typeof vendorPacksRaw === "object" &&
    !Array.isArray(vendorPacksRaw)
      ? (vendorPacksRaw as Record<string, unknown>)
      : null;

  type ManualPackMatcher = {
    raw: string;
    test: (pkgName: string, subpath: string | null) => boolean;
  };

  type ManualPackDef = {
    group: string;
    matchers: ManualPackMatcher[];
  };

  const normalizeManualPackGroup = (raw: string): string | null => {
    const base = String(raw ?? "").trim().toLowerCase();
    if (!base) return null;
    const normalized = base
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "");
    return normalized || null;
  };

  const normalizeMatchSubpath = (subpath: string | null | undefined): string | null => {
    if (!subpath) return null;
    const cleaned = String(subpath).trim().replace(/^\.\//, "").replace(/^\/+/, "");
    if (!cleaned || cleaned === "." || cleaned === "index") return null;
    return cleaned;
  };

  const escapeRegExp = (value: string): string => {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };

  const compileManualPackMatchers = (patterns: string[]): ManualPackMatcher[] => {
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
  };

  const vendorPacksManualDefs: ManualPackDef[] = [];
  if (vendorPacksManualRaw) {
    const defsByGroup = new Map<string, ManualPackDef>();
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
      vendorPacksManualDefs.push(def);
    }
  }

  const classifyManualPackGroup = (pkgName: string | null, subpath: string | null): string | null => {
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
          // ignore matcher errors; manual packs should never crash the server
        }
      }
    }
    return null;
  };

  const vendorPacksManual = vendorPacksManualDefs.length > 0;
  const vendorPacksEnabled = vendorPacksForce || vendorPacksProgressive || vendorPacksManual;
  const packSlimmingEnabled =
    vendorPacksEnabled && (packSlimmingRaw === true || packSlimmingRaw === "auto" || packSlimmingRaw === undefined);
  const vendorPacksMode: "auto" | "force" = vendorPacksForce ? "force" : "auto";
  const vendorPackMaxBytes =
    typeof userConfig?.optimizeDeps?.vendorPackMaxBytes === "number" && userConfig.optimizeDeps.vendorPackMaxBytes > 0
      ? Math.floor(userConfig.optimizeDeps.vendorPackMaxBytes)
      : 600 * 1024;
  const vendorPackMaxMembers =
    typeof userConfig?.optimizeDeps?.vendorPackMaxMembers === "number" && userConfig.optimizeDeps.vendorPackMaxMembers > 0
      ? Math.floor(userConfig.optimizeDeps.vendorPackMaxMembers)
      : 25;
  const vendorPackPlanPath = () => path.join(depsRoot, "vendor-pack.app.json");
  const vendorPackRequestsPath = () => path.join(depsRoot, "deps-requests.json");
  let vendorPackLastRequestCounts = vendorPacksEnabled ? loadDepRequestCounts(vendorPackRequestsPath()) : new Map<string, number>();
  const vendorPackPlanFromDisk = vendorPacksForce ? readJsonFile<VendorPackPlan>(vendorPackPlanPath()) : null;
  const vendorPackPlanFromDiskValid =
    vendorPacksForce &&
    vendorPackPlanFromDisk &&
    typeof (vendorPackPlanFromDisk as any)?.depsHash === "string" &&
    (vendorPackPlanFromDisk as any).depsHash === depsHash &&
    Array.isArray((vendorPackPlanFromDisk as any)?.members)
      ? vendorPackPlanFromDisk
      : null;
  const vendorPackComputedPlan = vendorPacksForce
    ? buildVendorPackPlan({
        depsHash,
        mode: vendorPacksMode,
        vendorDeps,
        manifestIndex: depsManifestIndex,
        requestCounts: vendorPackLastRequestCounts,
        maxBytes: vendorPackMaxBytes,
        maxMembers: vendorPackMaxMembers,
      })
    : null;
  const vendorPackPlan = vendorPacksForce
    ? vendorPackComputedPlan && vendorPackComputedPlan.members.length > 0
      ? vendorPackComputedPlan
      : vendorPackPlanFromDiskValid ?? vendorPackComputedPlan
    : null;

  if (vendorPacksForce && vendorPackPlan) {
    // Persist for transparency + deterministic behavior across restarts.
    writeJsonFile(vendorPackPlanPath(), vendorPackPlan);
  }

  type PackEntry = { entryPath: string; fileName: string; packageLabel: string; packageName?: string | null };
  const vendorPackMembers = vendorPacksForce && vendorPackPlan ? vendorPackPlan.members : [];
  const vendorPackEntries: PackEntry[] = [];
  const vendorPackFileNameSet = new Set<string>();
  for (const dep of vendorDeps) {
    if (vendorPackFileNameSet.has(dep.fileName)) continue;
    vendorPackFileNameSet.add(dep.fileName);
    vendorPackEntries.push({ entryPath: dep.entryPath, fileName: dep.fileName, packageLabel: dep.packageLabel });
  }
  for (const member of vendorPackMembers) {
    if (!member?.fileName || !member?.entryPath) continue;
    if (!fs.existsSync(member.entryPath)) continue;
    if (vendorPackFileNameSet.has(member.fileName)) continue;
    vendorPackFileNameSet.add(member.fileName);
    vendorPackEntries.push({
      entryPath: member.entryPath,
      fileName: member.fileName,
      packageLabel: member.packageLabel || member.fileName,
    });
  }

  const vendorPackDepFileNames = new Set(vendorPackEntries.map((d) => d.fileName));
  const canChunkVendorPacks =
    vendorPacksForce &&
    depsSharedChunksEnabled &&
    vendorPackEntries.length > 1 &&
    !!native?.optimizeDependenciesChunked &&
    !depsSourcemapEnabled &&
    depsBundleEsmEnabled;
  if (vendorPacksForce && !canChunkVendorPacks) {
    const reasons: string[] = [];
    if (!depsSharedChunksEnabled) reasons.push("sharedChunks=0");
    if (depsSourcemapEnabled) reasons.push("sourcemap=1");
    if (!depsBundleEsmEnabled) reasons.push("bundleEsm=0");
    if (!native?.optimizeDependenciesChunked) reasons.push("nativeChunked=0");
    if (vendorPackEntries.length <= 1) reasons.push("members<=1");
    logWarn(
      `[deps] vendorPacks enabled but chunking is unavailable (${reasons.join(", ")}). Falling back to per-entry deps.`,
    );
  }
  const vendorPackChunkGroupId = canChunkVendorPacks
    ? computeChunkGroupIdFromStableIds(vendorPackEntries.map((d) => d.fileName))
    : null;
  const vendorPackSharedFileName = vendorPackChunkGroupId ? `shared.${vendorPackChunkGroupId}.js` : null;
  const vendorPackSharedUrl = vendorPackSharedFileName ? depsRuntimeUrl(vendorPackSharedFileName) : null;

  // Track current-session /@deps request counts (persisted per depsHash for next restart selection).
  const vendorPackSessionRequestCounts: Map<string, number> | null = vendorPacksEnabled ? new Map() : null;
  let vendorPackRequestCountsDirty = false;
  let vendorPackRequestCountsLastFlush = 0;
  const flushVendorPackRequestCounts = (force: boolean = false) => {
    if (!vendorPackSessionRequestCounts || !vendorPacksEnabled) return;
    if (!vendorPackRequestCountsDirty && !force) return;
    const now = Date.now();
    if (!force && now - vendorPackRequestCountsLastFlush < 2000) return;
    vendorPackRequestCountsLastFlush = now;
    vendorPackRequestCountsDirty = false;
    saveDepRequestCounts(vendorPackRequestsPath(), vendorPackSessionRequestCounts);
  };
  const getKnownDepRequestCount = (fileName: string): number => {
    const sessionCount = vendorPackSessionRequestCounts?.get(fileName) ?? 0;
    if (sessionCount > 0) return sessionCount;
    return vendorPackLastRequestCounts.get(fileName) ?? 0;
  };

  const getVendorPackFileName = () => vendorDeps.length > 0 ? `vendor.${depsHash}.js` : null;
  const getVendorPackUrl = () => {
    const fileName = getVendorPackFileName();
    return fileName ? depsRuntimeUrl(fileName) : null;
  };
  const vendorDepFileNames = new Set(vendorDeps.map((d) => d.fileName));
  // Phase 6.2: Vendor Core is always-on. Even when `vendorPacks: "auto"`, we still want
  // shared-chunk chunking for the core set (React runtime hot path) without pulling feature deps in.
  const canChunkVendorCore =
    depsSharedChunksEnabled &&
    vendorDeps.length > 1 &&
    !!native?.optimizeDependenciesChunked &&
    !depsSourcemapEnabled &&
    depsBundleEsmEnabled &&
    // Avoid conflicting chunk groups when `vendorPacks: true` is active and chunked.
    !canChunkVendorPacks;
  const vendorCoreChunkGroupId = canChunkVendorCore
    ? computeChunkGroupIdFromStableIds(vendorDeps.map((d) => d.fileName))
    : null;
  const vendorCoreSharedFileName = vendorCoreChunkGroupId ? `shared.${vendorCoreChunkGroupId}.js` : null;
  const vendorCoreSharedUrl = vendorCoreSharedFileName ? depsRuntimeUrl(vendorCoreSharedFileName) : null;

  const ensureVendorPackFile = (): void => {
    const vendorPackFileName = getVendorPackFileName();
    const vendorPackUrl = getVendorPackUrl();
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
      .map((d) => `import "${depsRuntimeUrl(d.fileName)}";`)
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

  // -------------------------------------------------------------------------
  // Phase 6.2: Progressive prebundle (Lazy layered vendor)
  // - Always-on "vendor core" (vendorDeps)
  // - Lazy-built inferred feature packs in the background, applied on next reload
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // Phase 6.3: Vendor Pack Modules v2 (few-request mode)
  // - Emit pack modules under `/@deps/` to collapse many dep wrapper requests into a small set.
  // - Apply via AST-based import rewrite (in jsLoader) using a restart-safe index persisted under depsRoot.
  //
  // Pack filenames include chunkGroupId for artifact identity. Runtime URLs additionally bind to
  // the opaque depsHash and revalidate because logical wrapper filenames may span layouts.
  // -------------------------------------------------------------------------
  const vendorPackV2IndexPath = () => path.join(depsRoot, "vendor-pack.v2.index.json");
  const vendorPackV2AllowedPrefix = vendorPacksManual
    ? "vendor-pack.manual."
    : vendorPacksProgressive
      ? "vendor-pack.feature."
      : null;
  let vendorPackV2 = new VendorPackV2IndexManager({
    depsRoot,
    depsHash,
    outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
    allowPackFilePrefix: vendorPackV2AllowedPrefix,
    log: { info: logInfo, warn: logWarn },
  });
  vendorPackV2.loadFromDisk();
  const routeHintStatePath = path.join(ionifyDir, "route-hints.v1.json");
  const routeHints = new RouteHintIndex(routeHintStatePath);
  const startupPolicyRaw = (userConfig as any)?.startupPolicy;
  const startupPolicyObject =
    startupPolicyRaw && typeof startupPolicyRaw === "object" && !Array.isArray(startupPolicyRaw)
      ? (startupPolicyRaw as Record<string, unknown>)
      : {};
  const startupPolicyModeRaw = String(
    process.env.IONIFY_STARTUP_POLICY ??
      startupPolicyObject.mode ??
      (startupPolicyRaw === false ? "off" : "auto"),
  ).toLowerCase();
  const startupPolicyEnabled = startupPolicyModeRaw !== "off" && startupPolicyRaw !== false;
  const startupPolicyPreloadAuthorityEnabled = startupPolicyEnabled && startupPolicyModeRaw !== "observe";
  const startupPolicyObserveEvaluations =
    startupPolicyEnabled &&
    (process.env.IONIFY_STARTUP_OBSERVE_EVALUATIONS === "1" ||
      process.env.IONIFY_STARTUP_EVAL_OBSERVATION === "1" ||
      startupPolicyObject.observeEvaluations === true);
  const startupPolicyEagerBudget: StartupPolicyEagerBudget = {
    minRouteDocuments:
      typeof startupPolicyObject.minRouteDocuments === "number"
        ? startupPolicyObject.minRouteDocuments
        : 3,
    maxEagerDepAssets:
      typeof startupPolicyObject.maxEagerDepAssets === "number"
        ? startupPolicyObject.maxEagerDepAssets
        : 4,
    maxEagerSourceAssets:
      typeof startupPolicyObject.maxEagerSourceAssets === "number"
        ? startupPolicyObject.maxEagerSourceAssets
        : 4,
    maxEagerTotalAssets:
      typeof startupPolicyObject.maxEagerTotalAssets === "number"
        ? startupPolicyObject.maxEagerTotalAssets
        : 6,
    maxEagerDepBytes:
      typeof startupPolicyObject.maxEagerDepBytes === "number"
        ? startupPolicyObject.maxEagerDepBytes
        : 256 * 1024,
    maxEagerSourceBytes:
      typeof startupPolicyObject.maxEagerSourceBytes === "number"
        ? startupPolicyObject.maxEagerSourceBytes
        : 128 * 1024,
    maxEagerTotalBytes:
      typeof startupPolicyObject.maxEagerTotalBytes === "number"
        ? startupPolicyObject.maxEagerTotalBytes
        : 384 * 1024,
  };
  const startupObservationStatePath = path.join(ionifyDir, "startup-observations.v1.json");
  const startupPolicyStatePath = path.join(ionifyDir, "startup-policy.v1.json");
  const startupObservations = new StartupObservationIndex(startupObservationStatePath);
  let startupPolicySnapshot: StartupPolicySnapshot | null = loadStartupPolicySnapshot(startupPolicyStatePath);
  const startupInstrumentJavaScriptBuffer = (buffer: Buffer): Buffer =>
    instrumentJavaScriptBuffer(buffer, startupPolicyObserveEvaluations);
  const startupInstrumentJavaScriptCode = (code: string): string =>
    startupPolicyObserveEvaluations ? injectStartupEvaluationMarker(code) : code;
  const bootstrapSourceExts = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);
  const resolveBootstrapEntryFile = (rawEntryPath: string): string | null => {
    const raw = String(rawEntryPath || "").trim();
    if (!raw) return null;
    const candidates = path.isAbsolute(raw)
      ? [raw, path.join(rootDir, raw.replace(/^\/+/, ""))]
      : [path.resolve(rootDir, raw)];
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  };
  const bootstrapEntryFiles = (() => {
    if (Array.isArray(resolvedEntries) && resolvedEntries.length > 0) {
      return resolvedEntries
        .map((entryPath) => resolveBootstrapEntryFile(String(entryPath)))
        .filter((entryPath): entryPath is string => typeof entryPath === "string" && entryPath.length > 0);
    }
    const entries: string[] = [];
    for (const candidate of [
      path.join(rootDir, "src", "main.tsx"),
      path.join(rootDir, "src", "main.ts"),
      path.join(rootDir, "src", "index.tsx"),
      path.join(rootDir, "src", "index.ts"),
    ]) {
      if (fs.existsSync(candidate)) entries.push(candidate);
    }
    return entries;
  })();
  const resolveAuthoritativeDepPreloadUrls = (hintUrl: string): string[] => {
    const fileName = depsFileNameFromRuntimeUrl(hintUrl);
    if (!fileName) return [];
    const fileNames = resolveAuthoritativeDepPreloadFiles({
      fileName,
      fileExists: (candidateFileName) => fs.existsSync(path.join(depsRoot, candidateFileName)),
      fileNameToPackFile: vendorPackV2.fileNameToPackFile,
      packFileToChunkFiles: vendorPackV2.packFileToChunkFiles,
      packFileToSharedFile: vendorPackV2.packFileToSharedFile,
      currentStableSharedFileNames: [vendorPackSharedFileName, vendorCoreSharedFileName].filter(
        (value): value is string => typeof value === "string" && value.endsWith(".js"),
      ),
    });
    return fileNames.map((candidateFileName) => depsRuntimeUrl(candidateFileName));
  };
  const isRouteHintPreloadValid = (hintUrl: string, kind: RouteHintKind): boolean => {
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
      workspaceRoot: workspace.workspaceRoot,
    });
    if (!resolved || !fs.existsSync(resolved)) return false;
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return false;
    const ext = path.extname(resolved).toLowerCase();
    return ext !== ".html" && !isAssetExt(ext);
  };
  const expandRouteHintPreloadUrls = (hintUrl: string, kind: RouteHintKind): string[] => {
    if (kind !== "dep" || !hintUrl.startsWith(DEPS_PREFIX)) return [hintUrl];
    const authoritative = resolveAuthoritativeDepPreloadUrls(hintUrl);
    return authoritative.length > 0 ? authoritative : [hintUrl];
  };
  const estimateStartupAssetSize = (assetUrl: string, kind: RouteHintKind): number | null => {
    const parsed = url.parse(assetUrl);
    const pathname = parsed.pathname || "";
    if (!pathname) return null;
    const candidatePath =
      kind === "dep" && pathname.startsWith(DEPS_PREFIX)
        ? path.join(depsRoot, pathname.slice(DEPS_PREFIX.length))
        : decodePublicPath(rootDir, pathname, { allowedRoots, workspaceRoot: workspace.workspaceRoot });
    if (!candidatePath || !fs.existsSync(candidatePath)) return null;
    try {
      const stat = fs.statSync(candidatePath);
      return stat.isFile() ? stat.size : null;
    } catch {
      return null;
    }
  };
  const refreshStartupPolicySnapshot = (): StartupPolicySnapshot => {
    const next = buildStartupPolicySnapshot({
      routeKeys: routeHints.listRouteKeys(),
      routeAssetsForRoute: (routeKey) => routeHints.getRouteAssetEntries(routeKey),
      assetSummaries: routeHints.summarizeAssets(),
      observations: startupObservations,
      assetSizeBytes: estimateStartupAssetSize,
      isAssetValid: isRouteHintPreloadValid,
      eagerBudget: startupPolicyEagerBudget,
    });
    if (!startupPolicySnapshot || startupPolicySnapshot.policyHash !== next.policyHash) {
      persistStartupPolicySnapshot(startupPolicyStatePath, next);
    }
    startupPolicySnapshot = next;
    return next;
  };
  const buildStartupPolicyClientScript = (documentRouteKey: string): string =>
    `(()=>{const routeKey=${JSON.stringify(documentRouteKey)};const reportUrl="/__ionify_startup/report";const loaded=[];const loadedSet=new Set();const evaluated=[];const evaluatedSet=new Set();let fcpTime=Number.POSITIVE_INFINITY;let reported=false;const normalize=(value)=>{try{const parsed=new URL(String(value),location.href);if(parsed.origin!==location.origin)return null;return parsed.pathname+parsed.search;}catch{return null;}};const trackLoaded=(name,startTime)=>{const url=normalize(name);if(!url)return;loaded.push({url,startTime:Number(startTime)||0});};globalThis.__IONIFY_STARTUP__={markEvaluated:(value)=>{const url=normalize(value);if(!url||evaluatedSet.has(url))return;evaluatedSet.add(url);evaluated.push({url,time:(globalThis.performance&&performance.now)?performance.now():0});}};const send=()=>{if(reported)return;reported=true;const effectiveFcp=Number.isFinite(fcpTime)?fcpTime:Number.POSITIVE_INFINITY;const preFcpLoadedUrls=[];for(const item of loaded){if(item.startTime<=effectiveFcp&&!loadedSet.has(item.url)){loadedSet.add(item.url);preFcpLoadedUrls.push(item.url);}}const preFcpEvaluatedUrls=[];for(const item of evaluated){if(item.time<=effectiveFcp&&!preFcpEvaluatedUrls.includes(item.url))preFcpEvaluatedUrls.push(item.url);}const payload={routeKey,documentUrl:location.pathname+location.search,preFcpLoadedUrls,preFcpEvaluatedUrls};const body=JSON.stringify(payload);const fallbackBeacon=()=>{if(!navigator.sendBeacon)return;try{const blob=new Blob([body],{type:"application/json"});navigator.sendBeacon(reportUrl,blob);}catch{}};fetch(reportUrl,{method:"POST",headers:{\"content-type\":\"application/json\"},body}).catch(()=>{fallbackBeacon();});};try{new PerformanceObserver((list)=>{for(const entry of list.getEntries()){if(entry.name===\"first-contentful-paint\"){fcpTime=Math.min(fcpTime,entry.startTime);setTimeout(send,0);}}}).observe({type:\"paint\",buffered:true});}catch{}try{new PerformanceObserver((list)=>{for(const entry of list.getEntries()){if(entry.entryType===\"resource\")trackLoaded(entry.name,entry.startTime);}}).observe({type:\"resource\",buffered:true});}catch{}if(globalThis.performance&&typeof performance.getEntriesByType===\"function\"){for(const entry of performance.getEntriesByType(\"resource\"))trackLoaded(entry.name,entry.startTime);}globalThis.addEventListener(\"pagehide\",()=>setTimeout(send,0),{once:true});globalThis.addEventListener(\"load\",()=>setTimeout(send,250),{once:true});})();`;
  const collectBootstrapPackageRootToDepFiles = () => {
    const next = new Map<string, Set<string>>();
    const register = (packageRoot: string | null, fileName: string | null | undefined) => {
      if (!packageRoot || !fileName) return;
      const normalizedRoot = packageRoot.trim();
      const normalizedFileName = String(fileName).trim();
      if (!normalizedRoot || !normalizedFileName) return;
      let set = next.get(normalizedRoot);
      if (!set) {
        set = new Set<string>();
        next.set(normalizedRoot, set);
      }
      set.add(normalizedFileName);
    };
    for (const state of featureLastReadyState.values()) {
      if (
        !state ||
        state.status !== "ready" ||
        !state.chunkGroupId ||
        !state.sharedFileName ||
        !Array.isArray(state.entries)
      ) {
        continue;
      }
      for (const entry of state.entries) {
        if (!entry?.fileName) continue;
        register(extractPackageRootFromLabel(entry.packageLabel), entry.fileName);
      }
    }
    return next;
  };
  const collectBootstrapRoutedPackPreloadUrls = (): string[] => {
    if (!vendorPacksEnabled || vendorPackV2.fileNameToPackFile.size === 0) return [];
    if (!native?.resolveModule || bootstrapEntryFiles.length === 0) return [];

    const queue = bootstrapEntryFiles.slice();
    const visited = new Set<string>();
    const routedPreloads = new Set<string>();
    const resolvedDepFiles = new Set<string>();
    const observedBarePackageRoots = new Set<string>();
    const maxSourceFiles = 32;

    while (queue.length > 0 && visited.size < maxSourceFiles) {
      const nextPath = queue.shift();
      if (!nextPath || !fs.existsSync(nextPath)) continue;
      const canonicalPath = (() => {
        try {
          return fs.realpathSync(nextPath);
        } catch {
          return nextPath;
        }
      })();
      if (visited.has(canonicalPath)) continue;
      visited.add(canonicalPath);
      if (!bootstrapSourceExts.has(path.extname(canonicalPath).toLowerCase())) continue;

      let code = "";
      try {
        code = fs.readFileSync(canonicalPath, "utf8");
      } catch {
        continue;
      }

      let specs: string[] = [];
      if (native?.parseModuleIr) {
        try {
          const ir = native.parseModuleIr(canonicalPath, code);
          specs = Array.isArray(ir?.dependencies) ? ir.dependencies.map((dep: any) => dep.specifier).filter((value: unknown): value is string => typeof value === "string" && value.length > 0) : [];
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
        configuredExternalSpecifiers,
      );

      for (const localDep of localDeps) {
        if (!path.isAbsolute(localDep)) continue;
        if (!fs.existsSync(localDep)) continue;
        if (localDep.includes(`${path.sep}node_modules${path.sep}`)) continue;
        if (!bootstrapSourceExts.has(path.extname(localDep).toLowerCase())) continue;
        queue.push(localDep);
      }

      for (const externalDep of externalDeps) {
        const packageRoot = extractBarePackageRoot(externalDep);
        if (packageRoot) observedBarePackageRoots.add(packageRoot);
        try {
          const resolved = native.resolveModule(externalDep, rootDir);
          const fsPath = (resolved as any)?.fsPath ?? (resolved as any)?.fs_path ?? null;
          if (!fsPath || typeof fsPath !== "string") continue;
          const pkg = (resolved as any)?.pkg ?? null;
          const packageName = typeof pkg?.name === "string" ? pkg.name : externalDep;
          const packageVersion = typeof pkg?.version === "string" ? pkg.version : "0.0.0";
          const subpath = computeSubpathForDep(fsPath, pkg);
          const entry = registerDepEntry({
            entryPath: fsPath,
            packageName,
            packageVersion,
            subpath,
          });
          resolvedDepFiles.add(entry.fileName);
        } catch {
          // Ignore resolution failures and continue with the conservative set.
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
      for (const preloadUrl of resolveAuthoritativeDepPreloadUrls(depsRuntimeUrl(depFileName))) {
        routedPreloads.add(preloadUrl);
      }
    }

    return Array.from(routedPreloads);
  };
  const minimumRequestPositivePackMembers = depsSharedChunksEnabled ? 4 : 3;
  const hasPositivePackRequestSavings = (memberCount: number): boolean => {
    return Number.isFinite(memberCount) && memberCount >= minimumRequestPositivePackMembers;
  };

  type FeaturePackGroup = string;
  type VendorFeaturePackStatus = "planned" | "building" | "ready" | "failed";
  type VendorFeaturePackState = {
    version: 1;
    depsHash: string;
    outputVersion?: number;
    group: FeaturePackGroup;
    updatedAt: string;
    status: VendorFeaturePackStatus;
    chunkGroupId: string | null;
    sharedFileName: string | null;
    entries: PackEntry[];
    error?: string;
  };
  type VendorFeaturePackIndex = {
    version: 1;
    depsHash: string;
    outputVersion?: number;
    updatedAt: string;
    fileNameToChunkGroupId: Record<string, string>;
  };

  type VendorFeaturePackSlimStatus = "planned" | "building" | "ready" | "failed";
  type VendorFeaturePackSlimEntry = {
    baseFileName: string;
    wrapperFileName: string;
    entryPath: string;
    packageLabel: string;
    usedExports: string[];
  };
  type VendorFeaturePackSlimState = {
    version: 1;
    depsHash: string;
    outputVersion?: number;
    group: FeaturePackGroup;
    updatedAt: string;
    status: VendorFeaturePackSlimStatus;
    chunkGroupId: string | null;
    sharedFileName: string | null;
    entries: VendorFeaturePackSlimEntry[];
    error?: string;
  };

  const featurePacksEnabled =
    vendorPacksProgressive &&
    depsSharedChunksEnabled &&
    !!native?.optimizeDependenciesChunked &&
    !depsSourcemapEnabled &&
    depsBundleEsmEnabled;
  if (vendorPacksProgressive && !featurePacksEnabled) {
    const reasons: string[] = [];
    if (!depsSharedChunksEnabled) reasons.push("sharedChunks=0");
    if (depsSourcemapEnabled) reasons.push("sourcemap=1");
    if (!depsBundleEsmEnabled) reasons.push("bundleEsm=0");
    if (!native?.optimizeDependenciesChunked) reasons.push("nativeChunked=0");
    logWarn(
      `[deps] vendorPacks:auto enabled but feature packs are unavailable (${reasons.join(", ")}). Falling back to per-entry deps.`,
    );
  }

  const featurePackIndexPath = () => path.join(depsRoot, "vendor-pack.feature.index.json");
  const featurePackStatePathFor = (group: FeaturePackGroup) =>
    path.join(depsRoot, `vendor-pack.feature.${group}.json`);
  const featurePackSlimStatePathFor = (group: FeaturePackGroup) =>
    path.join(depsRoot, `vendor-pack.feature.${group}.slim.json`);
  const discoverFeaturePackGroupsFromDisk = (): FeaturePackGroup[] => {
    if (!featurePacksEnabled) return [];
    let names: string[] = [];
    try {
      names = fs.readdirSync(depsRoot);
    } catch {
      return [];
    }
    const groups = new Set<string>();
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

  const featurePackFileNameToChunkGroup = new Map<string, string>();
  const loadFeaturePackIndex = () => {
    featurePackFileNameToChunkGroup.clear();
    const raw = featurePacksEnabled ? readJsonFile<VendorFeaturePackIndex>(featurePackIndexPath()) : null;
    if (
      !raw ||
      raw.depsHash !== depsHash ||
      raw.version !== 1 ||
      raw.outputVersion !== DEPS_OPTIMIZER_OUTPUT_VERSION
    ) {
      return;
    }
    const mapping = raw.fileNameToChunkGroupId;
    if (!mapping || typeof mapping !== "object") return;
    let rawCount = 0;
    for (const [fileName, chunkGroupId] of Object.entries(mapping)) {
      if (typeof fileName !== "string" || typeof chunkGroupId !== "string") continue;
      if (!fileName.endsWith(".js")) continue;
      rawCount += 1;
      const shared = path.join(depsRoot, `shared.${chunkGroupId}.js`);
      const wrapper = path.join(depsRoot, fileName);
      if (!fs.existsSync(shared) || !fs.existsSync(wrapper)) continue;
      featurePackFileNameToChunkGroup.set(fileName, chunkGroupId);
    }

    // Self-heal stale index entries on restart so loaders never rewrite to missing packs.
    if (rawCount > 0 && featurePackFileNameToChunkGroup.size !== rawCount) {
      writeFeaturePackIndex();
    }
  };
  const writeFeaturePackIndex = () => {
    const obj: Record<string, string> = {};
    const keys = Array.from(featurePackFileNameToChunkGroup.keys()).sort();
    for (const key of keys) {
      const value = featurePackFileNameToChunkGroup.get(key);
      if (value) obj[key] = value;
    }
    const payload: VendorFeaturePackIndex = {
      version: 2,
      depsHash,
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      updatedAt: new Date().toISOString(),
      fileNameToChunkGroupId: obj,
    };
    writeJsonFile(featurePackIndexPath(), payload);
  };

  // Load index on boot (restart-safe).
  loadFeaturePackIndex();

  const ensureVendorPackV2Module = (options: {
    label: string;
    packFileName: string;
    sharedFileName: string;
    entries: PackEntry[];
    prunePackPrefix?: string;
  }): { packFileName: string; safeMembers: string[] } | null => {
    return vendorPackV2.ensurePackModuleFromEntries(options);
  };

  // Phase 5.5: usage-driven pack slimming needs baseFileName -> wrapperFileName mapping.
  // Pack module keys MUST remain derived from base file names so the AST rewrite stays stable.
  type PackMemberWrapper = {
    baseFileName: string;
    wrapperFileName: string;
    packageLabel?: string;
  };

  const ensureVendorPackV2ModuleFromWrappers = (options: {
    label: string;
    packFileName: string;
    sharedFileName: string;
    members: PackMemberWrapper[];
    prunePackPrefix?: string;
  }): { packFileName: string; safeMembers: string[] } | null => {
    return vendorPackV2.ensurePackModuleFromWrappers(options);
  };

  // -------------------------------------------------------------------------
  // Phase 6.3: Manual Vendor Packs (multi-pack mode)
  // - Config: optimizeDeps.vendorPacks = { [group]: [patterns...] }
  // - Packs are built lazily in the background (idle-aware) and applied on next reload via vendor-pack-v2 rewrite.
  // - Pack modules are content-addressed by chunkGroupId, so browser caching stays correct.
  // -------------------------------------------------------------------------
  type VendorManualPackStatus = "planned" | "building" | "ready" | "failed";
  type VendorManualPackState = {
    version: 1;
    depsHash: string;
    outputVersion?: number;
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

  const manualPacksEnabled =
    vendorPacksManual &&
    depsSharedChunksEnabled &&
    !!native?.optimizeDependenciesChunked &&
    !depsSourcemapEnabled &&
    depsBundleEsmEnabled;

  if (vendorPacksManual && !manualPacksEnabled) {
    const reasons: string[] = [];
    if (!depsSharedChunksEnabled) reasons.push("sharedChunks=0");
    if (depsSourcemapEnabled) reasons.push("sourcemap=1");
    if (!depsBundleEsmEnabled) reasons.push("bundleEsm=0");
    if (!native?.optimizeDependenciesChunked) reasons.push("nativeChunked=0");
    logWarn(
      `[deps] vendorPacks manual mode configured but pack modules are unavailable (${reasons.join(", ")}). Falling back to per-entry deps.`,
    );
  }

  const manualObserved = new Map<string, Map<string, PackEntry>>();
  const manualState = new Map<string, VendorManualPackState>();
  const manualSlimState = new Map<string, VendorManualPackSlimState>();
  for (const def of vendorPacksManualDefs) {
    manualObserved.set(def.group, new Map());
  }

  const manualHasCore = manualObserved.has("core");
  const manualPackStatePathFor = (group: string) => path.join(depsRoot, `vendor-pack.manual.${group}.json`);
  const manualPackSlimStatePathFor = (group: string) => path.join(depsRoot, `vendor-pack.manual.${group}.slim.json`);
  const updateManualState = (group: string, next: VendorManualPackState) => {
    const stamped = { ...next, outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION };
    manualState.set(group, stamped);
    writeJsonFile(manualPackStatePathFor(group), stamped);
  };
  const updateManualSlimState = (group: string, next: VendorManualPackSlimState) => {
    const stamped = { ...next, outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION };
    manualSlimState.set(group, stamped);
    writeJsonFile(manualPackSlimStatePathFor(group), stamped);
  };
  const pruneManualPackRoutes = (group: string) => {
    vendorPackV2.prunePackPrefix(`vendor-pack.manual.${group}.`);
  };
  const pruneFeaturePackRoutes = (group: FeaturePackGroup) => {
    vendorPackV2.prunePackPrefix(`vendor-pack.feature.${group}.`);
  };

  const planManualPackEntries = (group: string): PackEntry[] => {
    const entries = reconcilePackEntries(Array.from(manualObserved.get(group)?.values() ?? []), canonicalFileNameForEntry);

    const selected: PackEntry[] = [];
    const seen = new Set<string>();
    let totalBytes = 0;
    for (const entry of entries) {
      if (selected.length >= vendorPackMaxMembers) break;
      if (seen.has(entry.fileName)) continue;
      if (!entry.entryPath || !fs.existsSync(entry.entryPath)) continue;
      if (isCoreSingletonDepFileName(entry.fileName)) continue;
      // Keep vendor core entries in `core` when defined; avoid duplicating them into other packs.
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

  // Load previous state on boot (restart-safe) so manual packs persist across restarts.
  if (manualPacksEnabled) {
    for (const def of vendorPacksManualDefs) {
      const group = def.group;
      const raw = readJsonFile<VendorManualPackState>(manualPackStatePathFor(group));
      if (
        !raw ||
        raw.depsHash !== depsHash ||
        raw.version !== 1 ||
        raw.outputVersion !== DEPS_OPTIMIZER_OUTPUT_VERSION ||
        raw.group !== group
      ) {
        continue;
      }
      if (
        (Array.isArray(raw.entries) ? raw.entries : []).some(
          (entry) =>
            !entry?.fileName ||
            !entry?.entryPath ||
            isCoreSingletonDepFileName(entry.fileName) ||
            canonicalFileNameForEntry(entry.fileName, entry.entryPath) !== entry.fileName,
        )
      ) {
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

  // Phase 5.5: Load usage-slim state on boot (restart-safe).
  if (manualPacksEnabled && packSlimmingEnabled) {
    for (const def of vendorPacksManualDefs) {
      const group = def.group;
      const raw = readJsonFile<VendorManualPackSlimState>(manualPackSlimStatePathFor(group));
      if (
        !raw ||
        raw.depsHash !== depsHash ||
        raw.version !== 1 ||
        raw.outputVersion !== DEPS_OPTIMIZER_OUTPUT_VERSION ||
        raw.group !== group
      ) {
        continue;
      }
      if (
        (Array.isArray(raw.entries) ? raw.entries : []).some(
          (entry) =>
            !entry?.baseFileName ||
            !entry?.entryPath ||
            isCoreSingletonDepFileName(entry.baseFileName) ||
            canonicalFileNameForEntry(entry.baseFileName, entry.entryPath) !== entry.baseFileName,
        )
      ) {
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

  // Upgrade path: ensure pack modules + routing index exist when the shared chunk group is already ready on disk.
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
            packageLabel: e.packageLabel,
          })),
          prunePackPrefix: `vendor-pack.manual.${group}.`,
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
        prunePackPrefix: `vendor-pack.manual.${group}.`,
      });
    }
  }

  // Phase 5.5: usage scan (project -> dep export usage) + usage-driven pack slimming.
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
  const loadDepUsageIndexFromDisk = (): DepUsageIndex | null => {
    const raw = readJsonFile<any>(depUsageStatePath()) ?? readJsonFile<any>(legacyDepUsageStatePath());
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
  };
  const saveDepUsageIndexToDisk = (index: DepUsageIndex) => {
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
    writeJsonFile(depUsageStatePath(), {
      version: 2,
      depsHash,
      updatedAt: new Date().toISOString(),
      deps: depsObj,
    } satisfies DepUsageDisk);
  };

  const computeUsageIndexHash = (index: DepUsageIndex): string => {
    const keys = Array.from(index.keys()).sort();
    let body = `deps-usage:v2:${depsHash}\n`;
    for (const fileName of keys) {
      const item = index.get(fileName);
      if (!item) continue;
      const used = Array.isArray(item.usedExports) ? item.usedExports.slice().sort() : [];
      const importers = Array.isArray(item.importerKeys) ? item.importerKeys.slice().sort() : [];
      const entryRoots = Array.isArray(item.entryRootKeys) ? item.entryRootKeys.slice().sort() : [];
      body +=
        `${fileName}|ns=${item.hasNamespace ? 1 : 0}|star=${item.hasExportStar ? 1 : 0}` +
        `|used=${used.join(",")}|importers=${importers.join(",")}|entryRoots=${entryRoots.join(",")}\n`;
    }
    return getCacheKey(body);
  };

  let depUsageIndex: DepUsageIndex | null = packSlimmingEnabled ? loadDepUsageIndexFromDisk() : null;
  if (depUsageIndex) {
    depUsageIndex = canonicalizeDepUsageIndex(depUsageIndex, depsManifestCanonicalFileNames);
  }
  setDirectDepUsageFileNames(depUsageIndex);
  let depUsageScanRunning = false;

  const manualSlimBuildQueue: string[] = [];
  let manualSlimBuildRunning = false;
  const manualSlimBuildTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const scheduleManualSlimBuild = (group: string) => {
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
              if (next === "core") continue; // keep core packs conservative (React runtime/HMR)

              const baseState = manualState.get(next);
              if (!baseState || baseState.status !== "ready" || !baseState.sharedFileName || !baseState.chunkGroupId) {
                continue;
              }
              if (!depUsageIndex) continue;

              // Avoid building while the server is actively serving requests.
              while (activeRequests > 0) {
                await new Promise((r) => setTimeout(r, 250));
              }

              const baseEntries = Array.isArray(baseState.entries) ? baseState.entries : [];
              if (baseEntries.length === 0) continue;

              // Build per-entry usedExports (safe-only).
              const usedByBase = new Map<string, string[]>();
              for (const entry of baseEntries) {
                const u = depUsageIndex.get(entry.fileName);
                if (!u) continue;
                if (u.hasNamespace || u.hasExportStar) continue;
                if (!Array.isArray(u.usedExports) || u.usedExports.length === 0) continue;
                usedByBase.set(entry.fileName, u.usedExports.slice());
              }

              const hasAnyUsage = usedByBase.size > 0;
              if (!hasAnyUsage) continue;

              // Cache hit: if a ready slim state exists and matches current usage inputs, skip rebuild.
              const existingSlim = manualSlimState.get(next);
              if (
                existingSlim &&
                existingSlim.status === "ready" &&
                existingSlim.depsHash === depsHash &&
                existingSlim.group === next &&
                existingSlim.chunkGroupId &&
                existingSlim.sharedFileName &&
                Array.isArray(existingSlim.entries) &&
                existingSlim.entries.length > 0
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
                  // Ensure routing/module is in place (restart-safe).
                  ensureVendorPackV2ModuleFromWrappers({
                    label: `manual/${next}/slim`,
                    packFileName: `vendor-pack.manual.${next}.${existingSlim.chunkGroupId}.js`,
                    sharedFileName: existingSlim.sharedFileName,
                    members: existingSlim.entries.map((e) => ({
                      baseFileName: e.baseFileName,
                      wrapperFileName: e.wrapperFileName,
                      packageLabel: e.packageLabel,
                    })),
                    prunePackPrefix: `vendor-pack.manual.${next}.`,
                  });
                  continue;
                }
              }

              updateManualSlimState(next, {
                version: 1,
                depsHash,
                group: next,
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
              });

              try {
                const chunked = native?.optimizeDependenciesChunked;
                if (!chunked) throw new Error("native.optimizeDependenciesChunked is not available");
                const start = Date.now();
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
                // P19R: surface peer dep warnings after chunked optimization.
                broadcastPeerDepWarnings((result as any)?.peerDepWarnings ?? (result as any)?.peer_dep_warnings);
                const elapsed = Date.now() - start;

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

                const slimMembers: PackMemberWrapper[] = [];
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

                // Generate pack module + update v2 index routing to this slim pack.
                ensureVendorPackV2ModuleFromWrappers({
                  label: `manual/${next}/slim`,
                  packFileName: `vendor-pack.manual.${next}.${groupId}.js`,
                  sharedFileName,
                  members: slimMembers,
                  prunePackPrefix: `vendor-pack.manual.${next}.`,
                });

                refreshDepsManifestIndex();

                updateManualSlimState(next, {
                  version: 1,
                  depsHash,
                  group: next,
                  updatedAt: new Date().toISOString(),
                  status: "ready",
                  chunkGroupId: groupId,
                  sharedFileName,
                  entries: slimEntries,
                });

	                const fullSharedPath = path.join(depsRoot, baseState.sharedFileName);
	                const fullBytes = fs.existsSync(fullSharedPath) ? fs.statSync(fullSharedPath).size : 0;
	                const slimBytes = fs.existsSync(sharedOut) ? fs.statSync(sharedOut).size : 0;
	                const saved = fullBytes > 0 && slimBytes > 0 ? fullBytes - slimBytes : 0;
	                const savedLabel = saved > 0 ? ` (-${formatByteDelta(saved)})` : "";
	                if (process.env.DEBUG_DEPS) {
	                  logInfo(
	                    `[deps] ✓ Manual pack slimmed (${next}) group=${groupId} members=${baseEntries.length} (${elapsed}ms)${savedLabel}.`,
	                  );
	                }
	                logInfo(`Slim pack ready: ${next}${savedLabel}`);
	              } catch (err) {
	                updateManualSlimState(next, {
	                  version: 1,
	                  depsHash,
                  group: next,
                  updatedAt: new Date().toISOString(),
                  status: "failed",
                  chunkGroupId: null,
                  sharedFileName: null,
                  entries: manualSlimState.get(next)?.entries ?? [],
                  error: String(err),
                });
                logWarn(`[deps] WARN: Manual pack slimming failed (${next}): ${String(err)}`);
              }
            }
          } finally {
            manualSlimBuildRunning = false;
          }
        })();
      }, 800),
    );
  };

  const manualBuildQueue: string[] = [];
  let manualBuildRunning = false;
  const manualBuildTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const enqueueManualBuild = (group: string) => {
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

          // Avoid building while the server is actively serving requests.
          while (activeRequests > 0) {
            await new Promise((r) => setTimeout(r, 250));
          }

          const entries = planManualPackEntries(next);
          if (entries.length === 0) continue;

          const chunkGroupId = computeChunkGroupIdFromStableIds(entries.map((e) => e.fileName));
          const sharedFileName = `shared.${chunkGroupId}.js`;
          const sharedPath = path.join(depsRoot, sharedFileName);
          const alreadyReady =
            fs.existsSync(sharedPath) && entries.every((e) => fs.existsSync(path.join(depsRoot, e.fileName)));
          if (alreadyReady) {
            updateManualState(next, {
              version: 1,
              depsHash,
              group: next,
              updatedAt: new Date().toISOString(),
              status: "ready",
              chunkGroupId,
              sharedFileName,
              entries,
            });
            ensureVendorPackV2Module({
              label: `manual/${next}`,
              packFileName: `vendor-pack.manual.${next}.${chunkGroupId}.js`,
              sharedFileName,
              entries,
              prunePackPrefix: `vendor-pack.manual.${next}.`,
            });
            if (packSlimmingEnabled) scheduleManualSlimBuild(next);
            continue;
          }

          updateManualState(next, {
            version: 1,
            depsHash,
            group: next,
            updatedAt: new Date().toISOString(),
            status: "building",
            chunkGroupId,
            sharedFileName,
            entries,
          });

          try {
            const chunked = native?.optimizeDependenciesChunked;
            if (!chunked) throw new Error("native.optimizeDependenciesChunked is not available");
            const start = Date.now();
            const result = chunked(entries.map((e) => ({ entryPath: e.entryPath, depsHash })), ionifyDir);
            const groupId = (result as any)?.chunk_group ?? (result as any)?.chunkGroup ?? chunkGroupId;
            const resolvedEntries = resolveChunkedPackEntries(
              entries,
              Array.isArray((result as any)?.entries)
                ? (result as any).entries.map((item: any) => ({
                    entryPath: (item as any)?.entry_path ?? (item as any)?.entryPath ?? null,
                    outPath: (item as any)?.out_path ?? (item as any)?.outPath ?? null,
                  }))
                : [],
            );
            // P19R: surface peer dep warnings after chunked optimization.
            broadcastPeerDepWarnings((result as any)?.peerDepWarnings ?? (result as any)?.peer_dep_warnings);
            const elapsed = Date.now() - start;

            // Validate artifacts exist before advertising readiness.
            const sharedOut = path.join(depsRoot, `shared.${groupId}.js`);
            const ok =
              fs.existsSync(sharedOut) &&
              resolvedEntries.every((entry) => fs.existsSync(path.join(depsRoot, entry.fileName)));
            if (!ok) {
              throw new Error("Manual pack optimizer did not produce expected outputs");
            }

            refreshDepsManifestIndex();

            updateManualState(next, {
              version: 1,
              depsHash,
              group: next,
              updatedAt: new Date().toISOString(),
              status: "ready",
              chunkGroupId: groupId,
              sharedFileName: `shared.${groupId}.js`,
              entries: resolvedEntries,
            });

            ensureVendorPackV2Module({
              label: `manual/${next}`,
              packFileName: `vendor-pack.manual.${next}.${groupId}.js`,
              sharedFileName: `shared.${groupId}.js`,
              entries: resolvedEntries,
              prunePackPrefix: `vendor-pack.manual.${next}.`,
            });

            logInfo(
              `[deps] ✓ Manual pack ready (${next}) group=${groupId} members=${entries.length} (${elapsed}ms). Reload to apply.`,
            );
            if (packSlimmingEnabled) scheduleManualSlimBuild(next);
          } catch (err) {
            updateManualState(next, {
              version: 1,
              depsHash,
              group: next,
              updatedAt: new Date().toISOString(),
              status: "failed",
              chunkGroupId,
              sharedFileName,
              entries,
              error: String(err),
            });
            logWarn(`[deps] WARN: Manual pack build failed (${next}): ${String(err)}`);
          }
        }
      } finally {
        manualBuildRunning = false;
      }
    })();
  };

  const scheduleManualBuild = (group: string) => {
    if (!manualPacksEnabled) return;
    const existing = manualBuildTimers.get(group);
    if (existing) clearTimeout(existing);
    manualBuildTimers.set(
      group,
      setTimeout(() => {
        manualBuildTimers.delete(group);
        enqueueManualBuild(group);
      }, 600),
    );
  };

  const recordManualCandidate = (entry: {
    fileName: string;
    entryPath: string;
    packageLabel: string;
    packageName: string | null;
    subpath: string | null;
  }) => {
    if (!manualPacksEnabled) return;
    if (!entry.fileName || !entry.entryPath) return;
    if (!fs.existsSync(entry.entryPath)) return;
    if (isCoreSingletonDepFileName(entry.fileName)) return;
    const fileName = canonicalFileNameForEntry(entry.fileName, entry.entryPath);
    const group = classifyManualPackGroup(entry.packageName, entry.subpath);
    if (!group) return;
    const groupMap = manualObserved.get(group);
    if (!groupMap) return;

    const wasNew = upsertObservedPackEntry(groupMap, {
      entryPath: entry.entryPath,
      fileName,
      packageLabel: entry.packageLabel,
    });

    const state = manualState.get(group);
    const alreadyInState = !!state && Array.isArray(state.entries) && state.entries.some((e) => e.fileName === fileName);
    const shouldRebuild = !state || state.status !== "ready" || !alreadyInState;
    if (wasNew || shouldRebuild) {
      updateManualState(group, {
        version: 1,
        depsHash,
        group,
        updatedAt: new Date().toISOString(),
        status: "planned",
        chunkGroupId: null,
        sharedFileName: null,
        entries: planManualPackEntries(group),
      });
      if (packSlimmingEnabled) {
        const plannedEntries = planManualPackEntries(group);
        updateManualSlimState(group, {
          version: 1,
          depsHash,
          group,
          updatedAt: new Date().toISOString(),
          status: "planned",
          chunkGroupId: null,
          sharedFileName: null,
          entries: plannedEntries.map((e) => ({
            baseFileName: e.fileName,
            wrapperFileName: e.fileName,
            entryPath: e.entryPath,
            packageLabel: e.packageLabel,
            usedExports: [],
          })),
        });
      }
      scheduleManualBuild(group);
    }
  };

  const featureObserved = new Map<string, PackEntry>();
  const featureState = new Map<FeaturePackGroup, VendorFeaturePackState>();
  const featureLastReadyState = new Map<FeaturePackGroup, VendorFeaturePackState>();
  const featureSlimState = new Map<FeaturePackGroup, VendorFeaturePackSlimState>();
  const featureLastReadySlimState = new Map<FeaturePackGroup, VendorFeaturePackSlimState>();
  let featurePackActivationPending = false;
  const listFeaturePackGroups = (): FeaturePackGroup[] => {
    const groups = new Set<string>();
    for (const map of [featureState, featureLastReadyState, featureSlimState, featureLastReadySlimState]) {
      for (const group of map.keys()) groups.add(group);
    }
    return Array.from(groups).sort();
  };
  const featureStateFilesFor = (group: FeaturePackGroup): string[] => [
    featurePackStatePathFor(group),
    featurePackSlimStatePathFor(group),
  ];
  const removeFeatureGroupState = (group: FeaturePackGroup) => {
    featureState.delete(group);
    featureLastReadyState.delete(group);
    featureSlimState.delete(group);
    featureLastReadySlimState.delete(group);
    pruneFeaturePackRoutes(group);
    for (const filePath of featureStateFilesFor(group)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // ignore cleanup failures; stale metadata is best-effort
      }
    }
  };
  if (featurePacksEnabled) {
    for (const group of discoverFeaturePackGroupsFromDisk()) {
      const raw = readJsonFile<VendorFeaturePackState>(featurePackStatePathFor(group));
      if (
        !raw ||
        raw.depsHash !== depsHash ||
        raw.version !== 1 ||
        raw.outputVersion !== DEPS_OPTIMIZER_OUTPUT_VERSION ||
        raw.group !== group
      ) {
        continue;
      }
      if (
        (Array.isArray(raw.entries) ? raw.entries : []).some(
          (entry) =>
            !entry?.fileName ||
            !entry?.entryPath ||
            canonicalFileNameForEntry(entry.fileName, entry.entryPath) !== entry.fileName,
        )
      ) {
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
          packageName: (entry as any)?.packageName ?? null,
        });
      }
    }
  }

  if (featurePacksEnabled && packSlimmingEnabled) {
    for (const group of discoverFeaturePackGroupsFromDisk()) {
      const raw = readJsonFile<VendorFeaturePackSlimState>(featurePackSlimStatePathFor(group));
      if (
        !raw ||
        raw.depsHash !== depsHash ||
        raw.version !== 1 ||
        raw.outputVersion !== DEPS_OPTIMIZER_OUTPUT_VERSION ||
        raw.group !== group
      ) {
        continue;
      }
      if (
        (Array.isArray(raw.entries) ? raw.entries : []).some(
          (entry) =>
            !entry?.baseFileName ||
            !entry?.entryPath ||
            canonicalFileNameForEntry(entry.baseFileName, entry.entryPath) !== entry.baseFileName,
        )
      ) {
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

  const syncFeaturePackRoutingIndexFromState = (
    states: Iterable<VendorFeaturePackState | null | undefined>,
  ) => {
    featurePackFileNameToChunkGroup.clear();
    const nextRouting = deriveFeaturePackRoutingMap(states);
    for (const [fileName, chunkGroupId] of nextRouting) {
      featurePackFileNameToChunkGroup.set(fileName, chunkGroupId);
    }
    writeFeaturePackIndex();
  };

  const isActivatableFeatureSlimState = (
    baseState: VendorFeaturePackState | null | undefined,
    slimState: VendorFeaturePackSlimState | null | undefined,
  ): slimState is VendorFeaturePackSlimState & { chunkGroupId: string; sharedFileName: string } => {
    if (
      !baseState ||
      baseState.status !== "ready" ||
      !baseState.chunkGroupId ||
      !baseState.sharedFileName ||
      !slimState ||
      slimState.status !== "ready" ||
      !slimState.chunkGroupId ||
      !slimState.sharedFileName
    ) {
      return false;
    }

    if (!hasPositivePackRequestSavings(Array.isArray(slimState.entries) ? slimState.entries.length : 0)) {
      return false;
    }

    return isFeaturePackSlimAligned(baseState.entries, slimState.entries);
  };

  const activateFeaturePackRoutes = () => {
    vendorPackV2.prunePackPrefix("vendor-pack.feature.");

    const activeBaseStates: VendorFeaturePackState[] = [];
    for (const group of listFeaturePackGroups()) {
      const baseState = featureLastReadyState.get(group);
      if (
        !baseState ||
        baseState.status !== "ready" ||
        !baseState.chunkGroupId ||
        !baseState.sharedFileName ||
        !hasPositivePackRequestSavings(Array.isArray(baseState.entries) ? baseState.entries.length : 0)
      ) {
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
            packageLabel: entry.packageLabel,
          })),
        });
        continue;
      }

      ensureVendorPackV2Module({
        label: `feature/${group}`,
        packFileName: `vendor-pack.feature.${group}.${baseState.chunkGroupId}.js`,
        sharedFileName: baseState.sharedFileName,
        entries: baseState.entries,
      });
    }

    syncFeaturePackRoutingIndexFromState(activeBaseStates);
    featurePackActivationPending = false;
  };

  const activateFeaturePacksOnNextDocument = () => {
    if (!featurePacksEnabled || !featurePackActivationPending) return;
    activateFeaturePackRoutes();
  };

  // Phase 6.3: Upgrade path. If feature packs are already ready on disk (from an older Ionify build),
  // generate v2 pack modules + routing index without forcing a rebuild.
  if (featurePacksEnabled) {
    activateFeaturePackRoutes();
  }

  const updateFeatureState = (group: FeaturePackGroup, next: VendorFeaturePackState) => {
    const stamped = { ...next, outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION };
    featureState.set(group, stamped);
    if (stamped.status === "ready" && stamped.chunkGroupId && stamped.sharedFileName) {
      featureLastReadyState.set(group, stamped);
      featurePackActivationPending = true;
    }
    writeJsonFile(featurePackStatePathFor(group), stamped);
  };

  const updateFeatureSlimState = (group: FeaturePackGroup, next: VendorFeaturePackSlimState) => {
    const stamped = { ...next, outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION };
    featureSlimState.set(group, stamped);
    if (stamped.status === "ready" && stamped.chunkGroupId && stamped.sharedFileName) {
      featureLastReadySlimState.set(group, stamped);
      featurePackActivationPending = true;
    }
    writeJsonFile(featurePackSlimStatePathFor(group), stamped);
  };

  const featureEntriesSignature = (entries: readonly Pick<PackEntry, "fileName">[]): string =>
    entries
      .map((entry) => entry.fileName)
      .filter(Boolean)
      .slice()
      .sort()
      .join("|");
  const featurePackSourceExts = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);
  const plannedFeatureGroups = new Map<FeaturePackGroup, string>();
  const featurePlanReportPath = () => path.join(depsRoot, "vendor-pack.feature.plan-report.json");
  const computeFeatureCandidates = (): Array<
    PackEntry & {
      score: number;
      sizeBytes: number;
      importerKeys: string[];
      entryRootKeys: string[];
      routeKeys: string[];
      routeRequestCounts: Record<string, number>;
    }
  > => {
    const entries = reconcilePackEntries(Array.from(featureObserved.values()), canonicalFileNameForEntry);
    const candidates: Array<
      PackEntry & {
        score: number;
        sizeBytes: number;
        importerKeys: string[];
        entryRootKeys: string[];
        routeKeys: string[];
        routeRequestCounts: Record<string, number>;
      }
    > = [];
    const depRouteHints = new Map(
      routeHints.summarizeAssets("dep").flatMap((summary) => {
        const fileName = depsFileNameFromRuntimeUrl(summary.url);
        return fileName ? ([[fileName, summary]] as const) : [];
      }),
    );
    for (const entry of entries) {
      if (!entry.entryPath || !fs.existsSync(entry.entryPath)) continue;
      if (!featurePackSourceExts.has(path.extname(entry.entryPath).toLowerCase())) continue;
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
      const routeRequestCounts =
        routeHint && routeHint.routeRequestCounts && typeof routeHint.routeRequestCounts === "object"
          ? { ...routeHint.routeRequestCounts }
          : {};
      const routeCount = routeKeys.length;
      const score =
        12 * Math.min(Math.max(requestCount, 1), 6) +
        8 * Math.min(externalCount, 10) +
        4 * Math.min(moduleCount / 40, 6) +
        2 * Math.min(edgeCount / 80, 6) +
        4 * Math.log2(sizeKb) -
        Math.max(0, routeCount - 1) * 5;
      const usage = depUsageIndex?.get(entry.fileName);
      candidates.push({
        ...entry,
        score,
        sizeBytes,
        importerKeys: Array.isArray(usage?.importerKeys) ? usage!.importerKeys.slice() : [],
        entryRootKeys: Array.isArray(usage?.entryRootKeys) ? usage!.entryRootKeys.slice() : [],
        routeKeys,
        routeRequestCounts,
      });
    }
    return candidates;
  };
  const computeFeatureAutoMaxGroups = (candidateCount: number): number => {
    if (candidateCount <= 0) return 1;
    const targetMembersPerGroup = Math.max(12, Math.min(vendorPackMaxMembers, 18));
    return Math.max(4, Math.min(8, Math.ceil(candidateCount / targetMembersPerGroup)));
  };
  const assignFeaturePlanGroup = (
    usedGroups: Set<string>,
    plan: { group: string | null; familyKey: string; seedFileName: string; entries: PackEntry[] },
  ): FeaturePackGroup => {
    if (plan.group) {
      usedGroups.add(plan.group);
      return plan.group;
    }
    const candidates = [
      `auto-${getCacheKey(`feature-plan:${plan.familyKey}:${plan.seedFileName}`).slice(0, 8)}`,
      `auto-${getCacheKey(`feature-plan:${featureEntriesSignature(plan.entries)}`).slice(0, 8)}`,
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
  const computePlannedFeatureGroups = (): Map<FeaturePackGroup, PackEntry[]> => {
    const candidates = computeFeatureCandidates();
    const candidatesByFileName = new Map(candidates.map((candidate) => [candidate.fileName, candidate] as const));
    const normalizeSourceHintKey = (hintUrl: string): string => {
      const queryIndex = hintUrl.indexOf("?");
      const pathname = queryIndex === -1 ? hintUrl : hintUrl.slice(0, queryIndex);
      return pathname.replace(/^\/+/, "");
    };
    const sourceRouteHints = new Map(
      routeHints
        .summarizeAssets("source")
        .filter((summary) => summary.url.startsWith("/"))
        .map((summary) => [normalizeSourceHintKey(summary.url), summary] as const),
    );
    const pressureCandidatesByFileName = new Map(
      candidates.map((candidate) => {
        const routeRequestCounts: Record<string, number> = { ...candidate.routeRequestCounts };
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
            routeRequestCounts,
          },
        ] as const;
      }),
    );
    const usedGroups = new Set<string>(listFeaturePackGroups());
    const coupledGroups = extractDepCouplingGroups(
      candidates.map((c) => ({ fileName: c.fileName, entryPath: c.entryPath })),
    );
    const readyGroupsForPlan = Array.from(featureLastReadyState.entries()).map(([group, state]) => ({
      group,
      entries: Array.isArray(state.entries) ? state.entries : [],
    }));
    const plans = planAutoFeaturePackGroups({
      candidates,
      currentReadyGroups: readyGroupsForPlan,
      maxMembers: vendorPackMaxMembers,
      maxBytes: vendorPackMaxBytes,
      minMembers: minimumRequestPositivePackMembers,
      maxGroups: computeFeatureAutoMaxGroups(candidates.length),
      coupledGroups,
    });
    const next = new Map<FeaturePackGroup, PackEntry[]>();
    for (const plan of plans) {
      const group = assignFeaturePlanGroup(usedGroups, plan);
      next.set(group, plan.entries.map((entry) => ({ ...entry })));
    }
    writeJsonFile(featurePlanReportPath(), {
      version: 2,
      depsHash,
      updatedAt: new Date().toISOString(),
      candidates: candidates
        .slice()
        .sort((a, b) => b.score - a.score || a.fileName.localeCompare(b.fileName))
        .map((candidate) => ({
          fileName: candidate.fileName,
          packageLabel: candidate.packageLabel,
          score: candidate.score,
          sizeBytes: candidate.sizeBytes,
          importerKeys: candidate.importerKeys,
          entryRootKeys: candidate.entryRootKeys,
          routeKeys: candidate.routeKeys,
          routeRequestCounts: candidate.routeRequestCounts,
          pressureRouteKeys: pressureCandidatesByFileName.get(candidate.fileName)?.routeKeys ?? [],
          pressureRouteRequestCounts: pressureCandidatesByFileName.get(candidate.fileName)?.routeRequestCounts ?? {},
        })),
      plans: Array.from(next.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([group, entries]) => ({
          currentActiveSharedArtifact: (() => {
            const baseState = featureLastReadyState.get(group);
            const slimState = packSlimmingEnabled ? featureLastReadySlimState.get(group) : null;
            const activeState = isActivatableFeatureSlimState(baseState, slimState) ? slimState : baseState;
            if (!activeState?.sharedFileName) return null;
            const sharedPath = path.join(depsRoot, activeState.sharedFileName);
            const sharedBytes = fs.existsSync(sharedPath) ? fs.statSync(sharedPath).size : null;
            return {
              mode: activeState === slimState ? "slim" : "base",
              sharedFileName: activeState.sharedFileName,
              sharedBytes,
            };
          })(),
          group,
          totalBytes: entries.reduce((sum, entry) => sum + (depsManifestIndex.get(entry.fileName)?.sizeBytes ?? 0), 0),
          sharedClosurePressure: (() => {
            const baseState = featureLastReadyState.get(group);
            const slimState = packSlimmingEnabled ? featureLastReadySlimState.get(group) : null;
            const activeState = isActivatableFeatureSlimState(baseState, slimState) ? slimState : baseState;
            const activeSharedBytes =
              activeState?.sharedFileName && fs.existsSync(path.join(depsRoot, activeState.sharedFileName))
                ? fs.statSync(path.join(depsRoot, activeState.sharedFileName)).size
                : null;
            return analyzeFeaturePackSharedClosurePressure({
              entries,
              candidatesByFileName: pressureCandidatesByFileName,
              activeSharedBytes,
            });
          })(),
          members: entries.map((entry) => ({
            fileName: entry.fileName,
            packageLabel: entry.packageLabel,
            routeKeys: candidates.find((candidate) => candidate.fileName === entry.fileName)?.routeKeys ?? [],
          })),
        })),
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
      const hasRoutedMembers =
        featureLastReadyState.get(group)?.status === "ready" &&
        entries.every((entry) => featurePackFileNameToChunkGroup.get(entry.fileName));
      if (currentState?.status === "ready" && currentSignature === plannedSignature && hasRoutedMembers) {
        continue;
      }

      updateFeatureState(group, {
        version: 1,
        depsHash,
        group,
        updatedAt: new Date().toISOString(),
        status: "planned",
        chunkGroupId: null,
        sharedFileName: null,
        entries,
      });
      if (packSlimmingEnabled) {
        updateFeatureSlimState(group, {
          version: 1,
          depsHash,
          group,
          updatedAt: new Date().toISOString(),
          status: "planned",
          chunkGroupId: null,
          sharedFileName: null,
          entries: entries.map((entry) => ({
            baseFileName: entry.fileName,
            wrapperFileName: entry.fileName,
            entryPath: entry.entryPath,
            packageLabel: entry.packageLabel,
            usedExports: [],
          })),
        });
      }
      scheduleFeatureBuild(group);
    }
  };

  const featureBuildQueue: FeaturePackGroup[] = [];
  let featureBuildRunning = false;
  const featureBuildTimers = new Map<FeaturePackGroup, ReturnType<typeof setTimeout>>();

  // Track server load so background builds can wait for idle periods.
  let activeRequests = 0;

  type ProductionPublishingLevel = "contracts" | "artifacts";
  const papConfigRaw = (userConfig as any)?.productionArtifactPublishing ?? "auto";
  const papEnvRaw = process.env.IONIFY_PRODUCTION_PUBLISHING ?? process.env.IONIFY_PAP ?? process.env.IONIFY_PRODUCTION_PUBLICATION;
  const papEnvNormalized = typeof papEnvRaw === "string" ? papEnvRaw.trim().toLowerCase() : "";
  const papDisabledByEnv = papEnvNormalized === "0" || papEnvNormalized === "false" || papEnvNormalized === "off";
  const papEnabledByEnv =
    papEnvNormalized === "1" ||
    papEnvNormalized === "true" ||
    papEnvNormalized === "on" ||
    papEnvNormalized === "auto" ||
    papEnvNormalized === "contracts" ||
    papEnvNormalized === "artifacts";
  const papEnabled =
    papConfigRaw !== false &&
    !papDisabledByEnv &&
    (papEnabledByEnv || process.env.VITEST !== "true");
  const papIdleDelayMsRaw =
    papConfigRaw && typeof papConfigRaw === "object" && typeof papConfigRaw.idleDelayMs === "number"
      ? papConfigRaw.idleDelayMs
      : Number(process.env.IONIFY_PAP_IDLE_MS ?? 2500);
  const papIdleDelayMs = Number.isFinite(papIdleDelayMsRaw)
    ? Math.max(500, Math.min(60_000, Math.floor(papIdleDelayMsRaw)))
    : 2500;
  const papPhaseRaw =
    typeof papConfigRaw === "string"
      ? papConfigRaw
      : papConfigRaw && typeof papConfigRaw === "object" && typeof papConfigRaw.level === "string"
        ? papConfigRaw.level
        : papConfigRaw && typeof papConfigRaw === "object" && typeof papConfigRaw.phase === "string"
          ? papConfigRaw.phase
          : process.env.IONIFY_PRODUCTION_PUBLISHING_LEVEL ?? process.env.IONIFY_PAP_PHASE ?? papEnvRaw;
  const papLevelRaw = String(papPhaseRaw ?? "auto").trim().toLowerCase();
  const papTargetLevel =
    papLevelRaw === "contracts" || papLevelRaw === "contract" || papLevelRaw === "a" || papLevelRaw === "production_contracts"
      ? "contracts"
      : "artifacts";
  const papArtifactsEnabled = papTargetLevel === "artifacts";
  const papArtifactsIdleDelayMsRaw =
    papConfigRaw && typeof papConfigRaw === "object" && typeof (papConfigRaw as any).artifactsIdleDelayMs === "number"
      ? (papConfigRaw as any).artifactsIdleDelayMs
      : papConfigRaw && typeof papConfigRaw === "object" && typeof (papConfigRaw as any).deepIdleDelayMs === "number"
        ? (papConfigRaw as any).deepIdleDelayMs
        : Number(process.env.IONIFY_PRODUCTION_PUBLISHING_ARTIFACTS_IDLE_MS ?? process.env.IONIFY_PAP_ARTIFACTS_IDLE_MS ?? papIdleDelayMs * 4);
  const papArtifactsIdleDelayMs = Number.isFinite(papArtifactsIdleDelayMsRaw)
    ? Math.max(papIdleDelayMs + 500, Math.min(120_000, Math.floor(papArtifactsIdleDelayMsRaw)))
    : Math.max(10_000, papIdleDelayMs * 4);
  const papCpuLoadFactorRaw =
    papConfigRaw && typeof papConfigRaw === "object" && typeof (papConfigRaw as any).cpuLoadFactor === "number"
      ? (papConfigRaw as any).cpuLoadFactor
      : Number(process.env.IONIFY_PRODUCTION_PUBLISHING_CPU_LOAD_FACTOR ?? 1.5);
  const papCpuLoadFactor = Number.isFinite(papCpuLoadFactorRaw) && papCpuLoadFactorRaw > 0
    ? papCpuLoadFactorRaw
    : 1.5;
  const papBuildMode = resolveDevProductionPublishingBuildMode(papConfigRaw, process.env);
  let papTimer: ReturnType<typeof setTimeout> | null = null;
  let papRunning = false;
  let papRunningLevel: ProductionPublishingLevel | null = null;
  let papChild: ReturnType<typeof spawn> | null = null;
  let papContractsPublished = false;
  let papArtifactsPublished = false;
  let papDirty = false;
  let dependencyEnvironmentReconciling = false;

  const isProductionPublishingCpuPressured = (): boolean => {
    const parallelism = Math.max(1, typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length || 1);
    return os.loadavg()[0] > parallelism * papCpuLoadFactor;
  };

  const cancelProductionArtifactsPublication = (reason: string): void => {
    if (papRunningLevel !== "artifacts" || !papChild || papChild.killed) return;
    papDirty = true;
    papArtifactsPublished = false;
    logInfo(`[publish] Canceling Production Artifacts publication (${reason})`);
    try {
      papChild.kill("SIGTERM");
    } catch {
      /* child may have already exited */
    }
  };

  const scheduleProductionArtifactPublication = (
    reason: string,
    level: ProductionPublishingLevel = "contracts",
  ): void => {
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
        let nextLevel: ProductionPublishingLevel | null = null;
        try {
          while (activeRequests > 0 && !shuttingDown) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          if (shuttingDown) return;
          const cliEntry = process.argv[1];
          if (!cliEntry || !fs.existsSync(cliEntry)) {
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
                IONIFY_MODE: papBuildMode,
              },
              stdio: ["ignore", "ignore", "pipe"],
            },
          );
          papChild = child;
          let stderr = "";
          child.stderr?.on("data", (chunk) => {
            stderr += String(chunk);
            if (stderr.length > 4096) stderr = stderr.slice(-4096);
          });
          const exitCode = await new Promise<number | null>((resolve) => {
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

  const formatByteDelta = (bytes: number): string => {
    const value = Math.max(0, Math.floor(bytes));
    if (value < 1024) return `${value}B`;
    const kb = value / 1024;
    if (kb < 1024) return `${Math.round(kb)}KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)}MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)}GB`;
  };

  const featureSlimBuildQueue: FeaturePackGroup[] = [];
  let featureSlimBuildRunning = false;
  const featureSlimBuildTimers = new Map<FeaturePackGroup, ReturnType<typeof setTimeout>>();

  const scheduleFeatureSlimBuild = (group: FeaturePackGroup) => {
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

              // Avoid building while the server is actively serving requests.
              while (activeRequests > 0) {
                await new Promise((r) => setTimeout(r, 250));
              }

              const baseEntries = Array.isArray(baseState.entries) ? baseState.entries : [];
              if (baseEntries.length === 0) continue;

              // Build per-entry usedExports (safe-only).
              const usedByBase = new Map<string, string[]>();
              for (const entry of baseEntries) {
                const u = depUsageIndex.get(entry.fileName);
                if (!u) continue;
                if (u.hasNamespace || u.hasExportStar) continue;
                if (!Array.isArray(u.usedExports) || u.usedExports.length === 0) continue;
                usedByBase.set(entry.fileName, u.usedExports.slice());
              }

              if (usedByBase.size === 0) continue;

              // Cache hit: if a ready slim state exists and matches current usage inputs, skip rebuild.
              const existingSlim = featureSlimState.get(next);
              if (
                existingSlim &&
                existingSlim.status === "ready" &&
                existingSlim.depsHash === depsHash &&
                existingSlim.group === next &&
                existingSlim.chunkGroupId &&
                existingSlim.sharedFileName &&
                Array.isArray(existingSlim.entries) &&
                existingSlim.entries.length > 0
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
                  continue;
                }
              }

              updateFeatureSlimState(next, {
                version: 1,
                depsHash,
                group: next,
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
              });

              try {
                const chunked = native?.optimizeDependenciesChunked;
                if (!chunked) throw new Error("native.optimizeDependenciesChunked is not available");

                const start = Date.now();
                const result = chunked(
                  baseEntries.map((e) => {
                    const usedExports = usedByBase.get(e.fileName) ?? null;
                    return usedExports && usedExports.length > 0
                      ? ({ entryPath: e.entryPath, depsHash, usedExports } as any)
                      : ({ entryPath: e.entryPath, depsHash } as any);
                  }),
                  ionifyDir,
                );
                const groupId = (result as any)?.chunk_group ?? (result as any)?.chunkGroup ?? null;
                if (!groupId || typeof groupId !== "string") throw new Error("Missing chunkGroupId");
                // P19R: surface peer dep warnings after chunked optimization.
                broadcastPeerDepWarnings((result as any)?.peerDepWarnings ?? (result as any)?.peer_dep_warnings);
                const elapsed = Date.now() - start;

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

                const slimEntries: VendorFeaturePackSlimEntry[] = [];
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
                  slimEntries.push({
                    baseFileName: base.fileName,
                    wrapperFileName,
                    entryPath: base.entryPath,
                    packageLabel: base.packageLabel,
                    usedExports: usedByBase.get(base.fileName) ?? [],
                  });
                }

                refreshDepsManifestIndex();

                updateFeatureSlimState(next, {
                  version: 1,
                  depsHash,
                  group: next,
                  updatedAt: new Date().toISOString(),
                  status: "ready",
                  chunkGroupId: groupId,
                  sharedFileName,
                  entries: slimEntries,
                });

                const fullSharedPath = path.join(depsRoot, baseState.sharedFileName);
                const fullBytes = fs.existsSync(fullSharedPath) ? fs.statSync(fullSharedPath).size : 0;
	                const slimBytes = fs.existsSync(sharedOut) ? fs.statSync(sharedOut).size : 0;
	                const saved = fullBytes > 0 && slimBytes > 0 ? fullBytes - slimBytes : 0;
	                const savedLabel = saved > 0 ? ` (-${formatByteDelta(saved)})` : "";
	                logInfo(`Slim pack ready: ${next}${savedLabel}`);
	              } catch (err) {
	                updateFeatureSlimState(next, {
	                  version: 1,
	                  depsHash,
                  group: next,
                  updatedAt: new Date().toISOString(),
                  status: "failed",
                  chunkGroupId: null,
                  sharedFileName: null,
                  entries: featureSlimState.get(next)?.entries ?? [],
                  error: String(err),
                });
                logWarn(`[deps] WARN: Feature pack slimming failed (${next}): ${String(err)}`);
              }
            }
          } finally {
            featureSlimBuildRunning = false;
          }
        })();
      }, 800),
    );
  };

  const enqueueFeatureBuild = (group: FeaturePackGroup) => {
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

            // Avoid building while the server is actively serving requests.
          while (activeRequests > 0) {
            await new Promise((r) => setTimeout(r, 250));
          }

          const state = featureState.get(next);
          const entries = Array.isArray(state?.entries) ? state!.entries.slice() : [];
          if (!hasPositivePackRequestSavings(entries.length)) continue;

          const chunkGroupId = computeChunkGroupIdFromStableIds(entries.map((e) => e.fileName));
          const sharedFileName = `shared.${chunkGroupId}.js`;
          const sharedPath = path.join(depsRoot, sharedFileName);
          const alreadyReady =
            fs.existsSync(sharedPath) && entries.every((e) => fs.existsSync(path.join(depsRoot, e.fileName)));
          if (alreadyReady) {
            updateFeatureState(next, {
              version: 1,
              depsHash,
              group: next,
              updatedAt: new Date().toISOString(),
              status: "ready",
              chunkGroupId,
              sharedFileName,
              entries,
            });
            if (packSlimmingEnabled) scheduleFeatureSlimBuild(next);
            continue;
          }

          updateFeatureState(next, {
            version: 1,
            depsHash,
            group: next,
            updatedAt: new Date().toISOString(),
            status: "building",
            chunkGroupId,
            sharedFileName,
            entries,
          });

          try {
            const chunked = native?.optimizeDependenciesChunked;
            if (!chunked) throw new Error("native.optimizeDependenciesChunked is not available");
            const start = Date.now();
            const result = chunked(entries.map((e) => ({ entryPath: e.entryPath, depsHash })), ionifyDir);
            const groupId = (result as any)?.chunk_group ?? (result as any)?.chunkGroup ?? chunkGroupId;
            const resolvedEntries = resolveChunkedPackEntries(
              entries,
              Array.isArray((result as any)?.entries)
                ? (result as any).entries.map((item: any) => ({
                    entryPath: (item as any)?.entry_path ?? (item as any)?.entryPath ?? null,
                    outPath: (item as any)?.out_path ?? (item as any)?.outPath ?? null,
                  }))
                : [],
            );
            // P19R: surface peer dep warnings after chunked optimization.
            broadcastPeerDepWarnings((result as any)?.peerDepWarnings ?? (result as any)?.peer_dep_warnings);
            const elapsed = Date.now() - start;

            // Validate artifacts exist before advertising readiness.
            const sharedOut = path.join(depsRoot, `shared.${groupId}.js`);
            const ok =
              fs.existsSync(sharedOut) &&
              resolvedEntries.every((entry) => fs.existsSync(path.join(depsRoot, entry.fileName)));
            if (!ok) {
              throw new Error("Feature pack optimizer did not produce expected outputs");
            }

            // Refresh manifest index after optimization (for future caps/signals).
            refreshDepsManifestIndex();

            for (const entry of resolvedEntries) {
              upsertObservedPackEntry(featureObserved, entry);
            }

            updateFeatureState(next, {
              version: 1,
              depsHash,
              group: next,
              updatedAt: new Date().toISOString(),
              status: "ready",
              chunkGroupId: groupId,
              sharedFileName: `shared.${groupId}.js`,
              entries: resolvedEntries,
            });
            logInfo(
              `[deps] ✓ Feature pack ready (${next}) group=${groupId} members=${resolvedEntries.length} (${elapsed}ms). Reload to apply.`,
            );
            if (packSlimmingEnabled) scheduleFeatureSlimBuild(next);
          } catch (err) {
            updateFeatureState(next, {
              version: 1,
              depsHash,
              group: next,
              updatedAt: new Date().toISOString(),
              status: "failed",
              chunkGroupId,
              sharedFileName,
              entries,
              error: String(err),
            });
            logWarn(`[deps] WARN: Feature pack build failed (${next}): ${String(err)}`);
          }
        }
      } finally {
        featureBuildRunning = false;
      }
    })();
  };

  const scheduleFeatureBuild = (group: FeaturePackGroup) => {
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
      }, 600),
    );
  };

  const recordFeatureCandidate = (entry: {
    fileName: string;
    entryPath: string;
    packageLabel: string;
    packageName: string | null;
  }) => {
    if (!featurePacksEnabled) return;
    if (!entry.fileName || !entry.entryPath) return;
    if (!fs.existsSync(entry.entryPath)) return;
    const fileName = canonicalFileNameForEntry(entry.fileName, entry.entryPath);
    if (vendorDepFileNames.has(fileName) || isCoreSingletonDepFileName(fileName)) return; // core stays core
    const wasNew = upsertObservedPackEntry(featureObserved, {
      entryPath: entry.entryPath,
      fileName,
      packageLabel: entry.packageLabel,
      packageName: entry.packageName,
    });
    if (!wasNew && featurePackFileNameToChunkGroup.has(fileName)) return;
    replanFeaturePacks();
  };

  const seedFeatureCandidatesFromUsageIndex = (index: DepUsageIndex | null) => {
    if (!featurePacksEnabled || !index) return;
    let changed = false;
    for (const usage of index.values()) {
      if (!usage?.fileName || !usage?.entryPath || !usage?.packageName) continue;
      if (!fs.existsSync(usage.entryPath)) continue;
      const fileName = canonicalFileNameForEntry(usage.fileName, usage.entryPath);
      if (vendorDepFileNames.has(fileName) || isCoreSingletonDepFileName(fileName)) continue;
      const subpath =
        typeof getDepEntry(fileName)?.subpath === "string"
          ? getDepEntry(fileName)?.subpath ?? null
          : computeSubpathFromEntryPath(usage.entryPath);
      const wasNew = upsertObservedPackEntry(featureObserved, {
        entryPath: usage.entryPath,
        fileName,
        packageLabel: formatDepLabel(usage.packageName, subpath),
        packageName: usage.packageName,
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

  const pkgNameFromLabel = (label: string | undefined): string | null => {
    if (!label) return null;
    const at = label.lastIndexOf("@");
    if (at <= 0) return null;
    return label.slice(0, at) || null;
  };

  const observeDepForPackPlanning = (fileName: string): void => {
    if (!manualPacksEnabled && !featurePacksEnabled) return;
    if (!fileName.endsWith(".js")) return;
    if (fileName.startsWith("shared.") || fileName.startsWith("vendor.") || fileName.startsWith("vendor-pack.")) {
      return;
    }
    if (fileName === getVendorPackFileName()) return;

    const entryFromManifest = depsManifestIndex.get(fileName);
    const entryFromRegistry = getDepEntry(fileName);
    const entryPath = entryFromManifest?.entryPath ?? entryFromRegistry?.entryPath;

    if (!entryPath || !fs.existsSync(entryPath)) return;

    const packageLabel =
      entryFromRegistry?.packageName
        ? formatDepLabel(entryFromRegistry.packageName, entryFromRegistry.subpath)
        : entryFromManifest?.packageLabel ?? fileName;
    const packageName =
      entryFromRegistry?.packageName ?? pkgNameFromLabel(entryFromManifest?.packageLabel) ?? null;
    const subpath = typeof entryFromRegistry?.subpath === "string" ? entryFromRegistry.subpath : null;

    if (manualPacksEnabled) {
      recordManualCandidate({
        fileName,
        entryPath,
        packageLabel,
        packageName,
        subpath,
      });
    }

    if (featurePacksEnabled) {
      recordFeatureCandidate({
        fileName,
        entryPath,
        packageLabel,
        packageName,
      });
    }
  };

  // Transform output depends on pack routing state (Phase 6.2 `?cg=` and Phase 6.3 vendor-pack-v2 modules).
  // Cache key must be content-addressed (not timestamps) to keep determinism across machines/restarts.
  type IndexHashCache = { mtimeMs: number; size: number; hash: string | null };
  let featurePackRoutingHashCache: IndexHashCache | null = null;
  let vendorPackV2RoutingHashCache: IndexHashCache | null = null;

  const resolveReactRefreshRuntimeImportStatement = (): string | null => {
    let packImport: string | null = null;
    if (manualPacksEnabled && manualHasCore && native?.resolveModule) {
      try {
        const coreState = manualState.get("core");
        const coreChunkGroupId =
          coreState?.status === "ready" ? coreState.chunkGroupId : null;
        const corePackFileName = coreChunkGroupId
          ? `vendor-pack.manual.core.${coreChunkGroupId}.js`
          : null;
        if (corePackFileName && fs.existsSync(path.join(depsRoot, corePackFileName))) {
          const r = native.resolveModule("react-refresh/runtime", rootDir);
          const fsPath = (r as any)?.fsPath ?? (r as any)?.fs_path ?? null;
          if (fsPath && typeof fsPath === "string") {
            const pkg = (r as any)?.pkg ?? null;
            const packageName = typeof pkg?.name === "string" ? pkg.name : "react-refresh";
            const packageVersion = typeof pkg?.version === "string" ? pkg.version : "0.0.0";
            const subpath = computeSubpathForDep(fsPath, pkg);
            const fileName = registerDepEntry({
              entryPath: fsPath,
              packageName,
              packageVersion,
              subpath,
            }).fileName;
            if (!isCoreSingletonDepFileName(fileName)) {
              const routedPack = vendorPackV2.fileNameToPackFile.get(fileName) ?? null;
              if (routedPack === corePackFileName) {
                const memberKey = vendorPackV2MemberKey(fileName);
                packImport =
                  `import { __ionify_vp_${memberKey}__default as RefreshRuntime } from "${depsRuntimeUrl(corePackFileName)}"`;
              }
            }
          }
        }
      } catch {
        packImport = null;
      }
    }

    if (packImport) return packImport;

    let reactRefreshImport: string | null = null;
    try {
      const resolved = native?.resolveModule?.("react-refresh/runtime", rootDir) as any;
      const fsPath = resolved?.fsPath ?? resolved?.fs_path ?? null;
      const pkg = resolved?.pkg ?? null;
      if (typeof fsPath === "string") {
        const packageName = typeof pkg?.name === "string" ? pkg.name : "react-refresh";
        const packageVersion = typeof pkg?.version === "string" ? pkg.version : "0.0.0";
        const subpath = computeSubpathForDep(fsPath, pkg);
        const fileName = registerDepEntry({
          entryPath: fsPath,
          packageName,
          packageVersion,
          subpath,
        }).fileName;
        reactRefreshImport = depsRuntimeUrl(fileName);
      }
    } catch {
      reactRefreshImport = null;
    }

    if (!reactRefreshImport) {
      try {
        const ionifyRequire = createRequire(import.meta.url);
        const reactRefreshPath = ionifyRequire.resolve("react-refresh/runtime");
        const reactRefreshPkgPath = ionifyRequire.resolve("react-refresh/package.json");
        const reactRefreshPkg = JSON.parse(fs.readFileSync(reactRefreshPkgPath, "utf8"));
        const fileName = registerDepEntry({
          entryPath: reactRefreshPath,
          packageName: "react-refresh",
          packageVersion:
            typeof reactRefreshPkg?.version === "string" && reactRefreshPkg.version.trim().length > 0
              ? reactRefreshPkg.version
              : "0.0.0",
          subpath: computeSubpathFromEntryPath(reactRefreshPath),
        }).fileName;
        reactRefreshImport = depsRuntimeUrl(fileName);
      } catch (err) {
        logError("Failed to resolve react-refresh/runtime", err);
        return null;
      }
    }

    return `import RefreshRuntime from "${reactRefreshImport}"`;
  };

  const buildHmrClientAssetCode = (): string | null => {
    try {
      const hmrAsset = readClientAsset("hmr.js");
      const refreshAsset = readClientAsset("react-refresh-runtime.js");
      const refreshImport = resolveReactRefreshRuntimeImportStatement();
      if (!refreshImport) return null;
      const refreshCode = refreshAsset.replace(
        'import RefreshRuntime from "react-refresh/runtime"',
        refreshImport,
      );
      return `${hmrAsset}\n\n${refreshCode}\n`;
    } catch (err) {
      logError("Failed to build HMR client asset", err);
      return null;
    }
  };

  const getFeaturePackRoutingHash = (): string | null => {
    if (!featurePacksEnabled) return null;
    const indexPath = featurePackIndexPath();
    if (!fs.existsSync(indexPath)) return null;
    try {
      const stat = fs.statSync(indexPath);
      if (
        featurePackRoutingHashCache &&
        featurePackRoutingHashCache.mtimeMs === stat.mtimeMs &&
        featurePackRoutingHashCache.size === stat.size
      ) {
        return featurePackRoutingHashCache.hash;
      }
      const raw = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      const hash = hashFeaturePackRoutingIndex(
        raw,
        depsHash,
        DEPS_OPTIMIZER_OUTPUT_VERSION,
      );
      featurePackRoutingHashCache = { mtimeMs: stat.mtimeMs, size: stat.size, hash };
      return hash;
    } catch {
      featurePackRoutingHashCache = null;
      return null;
    }
  };

  const getVendorPackV2RoutingHash = (): string | null => {
    const indexPath = vendorPackV2IndexPath();
    if (!fs.existsSync(indexPath)) return null;
    try {
      const stat = fs.statSync(indexPath);
      if (
        vendorPackV2RoutingHashCache &&
        vendorPackV2RoutingHashCache.mtimeMs === stat.mtimeMs &&
        vendorPackV2RoutingHashCache.size === stat.size
      ) {
        return vendorPackV2RoutingHashCache.hash;
      }
      const raw = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      const hash = hashVendorPackV2RoutingIndex(
        raw,
        depsHash,
        DEPS_OPTIMIZER_OUTPUT_VERSION,
      );
      vendorPackV2RoutingHashCache = { mtimeMs: stat.mtimeMs, size: stat.size, hash };
      return hash;
    } catch {
      vendorPackV2RoutingHashCache = null;
      return null;
    }
  };

  const computeTransformHash = (baseHash: string): string => {
    const parts: string[] = [];
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

  const rewriteIonifySharedChunkImportsForVendorPackV2 = (code: string): string | null => {
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

      // Default import: import local from "/@deps/<fileName>";
      const defMatch = trimmed.match(/^import\s+([A-Za-z0-9_$]+)\s+from\s+["']\/@deps\/([^"']+)["'];?\s*$/);
      if (defMatch) {
        const local = defMatch[1]!;
        const depFileName = depsFileNameFromRuntimeUrl(`${DEPS_PREFIX}${defMatch[2]!}`);
        if (!depFileName) continue;
        if (isCoreSingletonDepFileName(depFileName)) continue;
        const packFileName = vendorPackV2.fileNameToPackFile.get(depFileName) ?? null;
        if (!packFileName) continue;
        if (!fs.existsSync(path.join(depsRoot, packFileName))) continue;
        const memberKey = vendorPackV2MemberKey(depFileName);
        lines[i] = `import { __ionify_vp_${memberKey}__default as ${local} } from "${depsRuntimeUrl(packFileName)}";`;
        mutated = true;
        continue;
      }

      // Namespace import: import * as local from "/@deps/<fileName>";
      const nsMatch = trimmed.match(
        /^import\s+\*\s+as\s+([A-Za-z0-9_$]+)\s+from\s+["']\/@deps\/([^"']+)["'];?\s*$/,
      );
      if (nsMatch) {
        const local = nsMatch[1]!;
        const depFileName = depsFileNameFromRuntimeUrl(`${DEPS_PREFIX}${nsMatch[2]!}`);
        if (!depFileName) continue;
        if (isCoreSingletonDepFileName(depFileName)) continue;
        const packFileName = vendorPackV2.fileNameToPackFile.get(depFileName) ?? null;
        if (!packFileName) continue;
        if (!fs.existsSync(path.join(depsRoot, packFileName))) continue;
        const memberKey = vendorPackV2MemberKey(depFileName);
        lines[i] = `import { __ionify_vp_${memberKey}__ns as ${local} } from "${depsRuntimeUrl(packFileName)}";`;
        mutated = true;
        continue;
      }
    }

    if (!mutated) return null;
    return `${lines.join("\n")}${tail}`;
  };
  
  // Initialize transformer with CAS after configHash is computed
  const transformer = new TransformEngine({ casRoot, versionHash: configHash });

  // Ensure dev populates the unified CAS used by build/test, even when dev serves from its own
  // persistent transform cache (TransformEngine v2 layout). This keeps the pipeline CAS-first.
  const baseCasExts = new Set([
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts",
  ]);
  type BaseCasTransformOptions = {
    filePath: string;
    ext: string;
    code: string;
    baseHash: string;
  };
  let baseCasPool: TransformWorkerPool | null = null;
  const pendingBaseCas = new Map<string, Promise<void>>();
  let shuttingDown = false;
  const getBaseCasPool = (): TransformWorkerPool => {
    if (baseCasPool) return baseCasPool;
    baseCasPool = new TransformWorkerPool({ size: 1 });
    return baseCasPool;
  };
  const ensureBaseCasTransform = async (opts: BaseCasTransformOptions): Promise<void> => {
    const ext = opts.ext.toLowerCase();
    if (!baseCasExts.has(ext)) return;
    if (opts.filePath.includes(`${path.sep}node_modules${path.sep}`)) return;
    if (!opts.baseHash) return;

    const dir = getCasArtifactPath(casRoot, configHash, opts.baseHash);
    const outFile = path.join(dir, "transformed.js");
    if (fs.existsSync(outFile)) return;

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
          code: opts.code,
        });
        if (result.error) {
          logWarn(`[CAS] base transform failed for ${opts.filePath}: ${result.error}`);
          return;
        }

        try {
          fs.mkdirSync(dir, { recursive: true });
          const tmp = `${outFile}.tmp-${process.pid}-${Date.now()}`;
          fs.writeFileSync(tmp, result.code, "utf8");
          fs.renameSync(tmp, outFile);
          if (result.map) {
            const mapFile = `${outFile}.map`;
            const tmpMap = `${mapFile}.tmp-${process.pid}-${Date.now()}`;
            fs.writeFileSync(tmpMap, result.map, "utf8");
            fs.renameSync(tmpMap, mapFile);
          }
        } catch {
          // ignore CAS write errors
        }
      } finally {
        pendingBaseCas.delete(opts.baseHash);
      }
    })();

    pendingBaseCas.set(opts.baseHash, jobPromise);
    await jobPromise;
  };
  const pendingWatchedDeps = new Set<string>();
  let pendingWatchFlush = false;
  const scheduleDependencyWatches = (depsAbs: readonly string[]): void => {
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
          // ignore watch errors; response path already completed
        }
      }
    });
  };
  const scheduleBaseCasTransform = (opts: BaseCasTransformOptions): void => {
    if (shuttingDown) return;
    setImmediate(() => {
      if (shuttingDown) return;
      void ensureBaseCasTransform(opts).catch(() => {
        // ignore base CAS backfill errors (dev must continue serving)
      });
    });
  };
  
  const graph = new Graph(rawVersionInputs, { ionifyDir });
  const registerDevCssGraphSources = (): string[] => {
    return registerCssDemandGraphSourceFiles(
      rootDir,
      graph.listFilesByKind("js").filter((filePath) => {
        if (filePath.includes("node_modules") || filePath.includes(`${path.sep}.ionify${path.sep}`)) return false;
        const clean = filePath.split("?")[0]!.split("#")[0]!.toLowerCase();
        return clean.endsWith(".js") || clean.endsWith(".jsx") || clean.endsWith(".ts") || clean.endsWith(".tsx") || clean.endsWith(".mdx");
      }),
    );
  };
  const federationRemoteBindings = collectFederationRemoteImportBindings(userConfig, rootDir);
  const resolveTransformedRuntimeGraphDeps = (
    runtimeDependencies: RuntimeDependencyFact[] | undefined,
    importerAbs: string,
    fallbackStaticDeps: string[],
    fallbackDynamicDeps: string[] = [],
  ): { deps: string[]; dynamicDeps: string[] } => {
    if (!Array.isArray(runtimeDependencies)) {
      return { deps: fallbackStaticDeps, dynamicDeps: fallbackDynamicDeps };
    }
    const staticSpecs = runtimeDependencies
      .filter((dependency) => dependency.kind === "static")
      .map((dependency) => dependency.specifier);
    const dynamicSpecs = runtimeDependencies
      .filter((dependency) => dependency.kind === "dynamic")
      .map((dependency) => dependency.specifier);
    const staticClassified = classifyImportSpecifiersForGraph(
      staticSpecs,
      importerAbs,
      configuredExternalSpecifiers,
    );
    const dynamicClassified = classifyImportSpecifiersForGraph(
      dynamicSpecs,
      importerAbs,
      configuredExternalSpecifiers,
    );
    const localRuntimeDeps = [
      ...staticClassified.localDeps,
      ...dynamicClassified.localDeps,
    ];
    recordDepLeafGraphNodes(localRuntimeDeps);
    enqueueLocalGraphCompletion(localRuntimeDeps);
    scheduleDependencyWatches(localRuntimeDeps);
    return {
      deps: rewriteFederationGraphEdgeIds(
        [...staticClassified.localDeps, ...staticClassified.externalDeps],
        federationRemoteBindings,
      ),
      dynamicDeps: rewriteFederationGraphEdgeIds(
        [...dynamicClassified.localDeps, ...dynamicClassified.externalDeps],
        federationRemoteBindings,
      ),
    };
  };
  if (userConfig?.federation) {
    syncFederationGraphNodes(graph, buildFederationConfigGraphNodes(userConfig, rootDir));
  }
  
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
  const peerDepWarningSet = new Set<string>();
  const peerDepWarningLog: string[] = [];

  /**
   * P19R: Broadcast peer dependency version mismatch warnings to all connected
   * browser SSE clients. Warnings are displayed as a non-blocking overlay in the
   * browser and logged to the server console for CI visibility.
   */
  function broadcastPeerDepWarnings(warnings: string[] | undefined | null): void {
    if (!warnings || warnings.length === 0) return;
    const freshWarnings: string[] = [];
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

  const envFromFiles = loadIonifyEnv(envMode, rootDir);
  process.env.NODE_ENV = process.env.NODE_ENV ?? "development";
  process.env.MODE = envMode;
  const envValues: Record<string, string> = {
    ...envFromFiles,
    NODE_ENV: process.env.NODE_ENV,
    MODE: process.env.MODE,
  };
  
  // Phase 5.4.3: Build define config from user config + env variables
  const envPrefix = userConfig?.envPrefix || ["VITE_", "IONIFY_"];
  const defineConfig = buildDefineConfig(userConfig?.define, envValues, envPrefix);
  logInfo(`[define] ${Object.keys(defineConfig).length} replacements configured`);
  
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
    // Delegate to the shared substitutor so dev + build never drift (Vite-compat).
    return substituteEnvPlaceholders(input, envValues, envPrefix);
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
      if (isCssLikeExt(ext)) {
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
        graph.recordFile(mod.absPath, hash, depsAbs, [], "css");
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
      
      const { localDeps, externalDeps } = classifyImportSpecifiersForGraph(
        specs,
        mod.absPath,
        configuredExternalSpecifiers,
      );
      const nextDeps = rewriteFederationGraphEdgeIds(
        [...localDeps, ...externalDeps],
        federationRemoteBindings,
      );
      enqueueLocalGraphCompletion(localDeps);
      graph.recordFile(mod.absPath, hash, nextDeps);
      scheduleDependencyWatches(localDeps);

      if (isEntryModule(mod.absPath, userConfig ?? undefined) || hasReactRootRenderSideEffect(code)) {
        updates.push({
          url: mod.url,
          hash,
          deps: nextDeps.map((dep) => normalizeGraphDepForClient(rootDir, dep)),
          reason: mod.reason,
          status: "reload",
        });
        continue;
      }

	      const extName = path.extname(mod.absPath);
	      const result = await transformer.run({
	        path: mod.absPath,
	        code,
	        ext: extName,
	        moduleHash: computeTransformHash(hash),
	        config: userConfig ?? null,
	      });
	      scheduleBaseCasTransform({
	        filePath: mod.absPath,
	        ext: extName,
	        code,
	        baseHash: hash,
	      });

      const runtimeGraph = resolveTransformedRuntimeGraphDeps(
        result.runtimeDependencies,
        mod.absPath,
        nextDeps,
      );
      graph.recordFile(
        mod.absPath,
        hash,
        runtimeGraph.deps,
        runtimeGraph.dynamicDeps,
      );

      const transformed = result.code;
      const envApplied = applyEnvPlaceholders(
        transformed,
        extName,
      );

      updates.push({
        url: mod.url,
        hash,
          deps: runtimeGraph.deps.map((dep) => normalizeGraphDepForClient(rootDir, dep)),
        reason: mod.reason,
        status: "updated",
        code: envApplied,
      });
    }
    return updates;
  };

  const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
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
        // leave as undecoded path to avoid crashing on malformed encodings
      }
      const q = parsed.query || {};
      const requestUrlWithQuery = `${reqPath}${parsed.search ?? ""}`;
      const routeHintClientKey = buildRouteHintClientKey(req);
      const routeHintReferer = Array.isArray(req.headers.referer)
        ? req.headers.referer[0] ?? null
        : req.headers.referer ?? null;
      const routeHintObservedAtMs = Date.now();

      // --- HMR endpoints ---
      if (reqPath === "/__ionify_hmr") {
        // Browser subscribes to this SSE channel for HMR summaries.
        hmr.handleSSE(req, res);
        return;
      }
      if (reqPath === "/__ionify_hmr_client.js") {
        const code = buildHmrClientAssetCode();
        if (!code) {
          res.statusCode = 500;
          res.end("Failed to build HMR client");
          return;
        }
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
        res.end(code);
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
	          const code = asset.replace(
	            'import RefreshRuntime from "react-refresh/runtime"',
              refreshImport,
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
        let body: any;
        try {
          body = await parseJsonBody(req);
        } catch {
          body = null;
        }
        const routeKey = normalizeDocumentRouteKey(typeof body?.routeKey === "string" ? body.routeKey : "/");
        const preFcpLoadedUrls = Array.isArray(body?.preFcpLoadedUrls)
          ? body.preFcpLoadedUrls.filter((value: unknown): value is string => {
              if (typeof value !== "string" || !value.startsWith("/")) return false;
              return isRouteHintPreloadValid(value, value.startsWith(DEPS_PREFIX) ? "dep" : "source");
            })
          : [];
        const preFcpEvaluatedUrls = Array.isArray(body?.preFcpEvaluatedUrls)
          ? body.preFcpEvaluatedUrls.filter((value: unknown): value is string => {
              if (typeof value !== "string" || !value.startsWith("/")) return false;
              return isRouteHintPreloadValid(value, value.startsWith(DEPS_PREFIX) ? "dep" : "source");
            })
          : [];
        startupObservations.recordRouteObservation({
          routeKey,
          preFcpLoadedUrls,
          preFcpEvaluatedUrls,
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
          const mapPath = path.join(depsRoot, fileName);
          if (fs.existsSync(mapPath)) {
            const stat = fs.statSync(mapPath);
            const etag = weakEtagFromStat(`deps-map-${depsHash}`, stat);
            // Check 304 before reading file
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
              fs.readFileSync(mapPath),
              { etag, cacheControl: "no-cache" },
            );
            return;
          }
        }

        // Phase 6.1: Track dep request counts for vendor pack selection (persisted per depsHash).
        if (
          vendorPackSessionRequestCounts &&
          fileName.endsWith(".js") &&
          !fileName.startsWith("shared.") &&
          fileName !== getVendorPackFileName()
        ) {
          vendorPackSessionRequestCounts.set(
            fileName,
            (vendorPackSessionRequestCounts.get(fileName) ?? 0) + 1,
          );
          vendorPackRequestCountsDirty = true;
          flushVendorPackRequestCounts(false);
        }

        const depsFilePath = path.join(depsRoot, fileName);
        const entryFromManifest = depsManifestIndex.get(fileName);
        let entryFromRegistry = getDepEntry(fileName);
        let entryPath = entryFromManifest?.entryPath ?? entryFromRegistry?.entryPath;
        let packageLabel =
          entryFromRegistry?.packageName
            ? formatDepLabel(entryFromRegistry.packageName, entryFromRegistry.subpath)
            : entryFromManifest?.packageLabel ?? fileName;
        const observeRouteHintDepRequest = () => {
          if (!fileName.endsWith(".js")) return;
          routeHints.noteRequest({
            url: requestUrlWithQuery,
            kind: "dep",
            refererUrl: routeHintReferer,
            clientKey: routeHintClientKey,
            observedAtMs: routeHintObservedAtMs,
          });
        };

		        observeDepForPackPlanning(fileName);

		        const isVersionedDepWrapper =
		          fileName.endsWith(".js") &&
		          !fileName.startsWith("shared.") &&
		          !fileName.startsWith("vendor.") &&
		          !fileName.startsWith("vendor-pack.");
		        const manifestVersionCurrent =
		          !isVersionedDepWrapper ||
		          // No manifest entry means no recorded version — treat the on-disk file as current
		          // (it may have been written directly, e.g. by tests or external tooling).
		          // Only trigger a stale-rebuild when an entry exists WITH a mismatched outputVersion.
		          !entryFromManifest ||
		          entryFromManifest.outputVersion === DEPS_OPTIMIZER_OUTPUT_VERSION;
		        if (fs.existsSync(depsFilePath) && manifestVersionCurrent) {
              observeRouteHintDepRequest();
		          // Phase 6.4: No-duplication policy across packs.
		          // Shared chunks may import other `/@deps/*` wrappers as externals. If those wrappers are already
		          // covered by a vendor-pack-v2 route (e.g. `react` covered by `core`), rewrite the shared chunk
		          // imports to the pack module so the browser doesn't fetch both the pack and the wrapper.
		          const vendorV2Hash = getVendorPackV2RoutingHash();
		          if (vendorV2Hash && fileName.startsWith("shared.") && fileName.endsWith(".js")) {
		            const stat = fs.statSync(depsFilePath);
		            const etag = weakEtagFromStat(`deps-${depsHash}-vp2-${vendorV2Hash}`, stat);
		            if (isNotModified(req, etag)) {
		              res.setHeader("ETag", etag);
	              res.setHeader("Cache-Control", "no-cache");
		              res.statusCode = 304;
		              res.end();
		              logInfo(`[deps] OPTIMIZE ${packageLabel}: HIT from cache (304) (vp2)`);
		              return;
		            }

		            const raw = fs.readFileSync(depsFilePath, "utf8");
		            const rewritten = rewriteIonifySharedChunkImportsForVendorPackV2(raw) ?? raw;
		            sendBuffer(req, res, 200, "application/javascript; charset=utf-8", startupInstrumentJavaScriptBuffer(Buffer.from(rewritten, "utf8")), {
		              etag,
	              cacheControl: "no-cache",
		            });
		            logInfo(`[deps] OPTIMIZE ${packageLabel}: HIT from cache (vp2)`);
		            return;
		          }

		          const variant = selectPrecompressedVariant(req, depsFilePath);
		          if (variant) {
		            sendPrecompressedFile(req, res, 200, "application/javascript; charset=utf-8", variant, {
		              etagPrefix: `deps-${depsHash}`,
              cacheControl: "no-cache",
            });
            const status = res.statusCode === 304 ? " (304)" : "";
            logInfo(`[deps] OPTIMIZE ${packageLabel}: HIT from cache${status} (${variant.encoding})`);
            return;
          }

          const stat = fs.statSync(depsFilePath);
          const etag = weakEtagFromStat(`deps-${depsHash}`, stat);
          // Check 304 before reading file (avoid blocking IO)
          if (isNotModified(req, etag)) {
            res.setHeader("ETag", etag);
            res.setHeader("Cache-Control", "no-cache");
            res.statusCode = 304;
            res.end();
            logInfo(`[deps] OPTIMIZE ${packageLabel}: HIT from cache (304)`);
            return;
          }
          sendBuffer(req, res, 200, "application/javascript; charset=utf-8", startupInstrumentJavaScriptBuffer(fs.readFileSync(depsFilePath)), {
            etag,
            cacheControl: "no-cache",
          });
		          logInfo(`[deps] OPTIMIZE ${packageLabel}: HIT from cache`);
		          return;
		        }
		        if (fs.existsSync(depsFilePath) && !manifestVersionCurrent) {
		          try {
		            fs.rmSync(depsFilePath, { force: true });
		            fs.rmSync(`${depsFilePath}.gz`, { force: true });
		            fs.rmSync(`${depsFilePath}.map`, { force: true });
		          } catch {
		            // Ignore stale cache cleanup failures and fall through to rebuild.
		          }
		          logInfo(
		            `[deps] OPTIMIZE ${packageLabel}: STALE cache (outputVersion=${entryFromManifest?.outputVersion ?? 0} expected=${DEPS_OPTIMIZER_OUTPUT_VERSION}) → REBUILD`,
		          );
		        }

        // Phase 6.1: Vendor packs (few-request mode).
        // If this request is for a pack member (or its shared chunk), build the whole pack group.
        if (
          canChunkVendorPacks &&
          vendorPackEntries.length > 1 &&
          (vendorPackDepFileNames.has(fileName) || (vendorPackSharedFileName && fileName === vendorPackSharedFileName))
        ) {
          try {
            const start = Date.now();
            const rawSize = entryPath && fs.existsSync(entryPath) ? fs.statSync(entryPath).size : 0;
            const chunked = native?.optimizeDependenciesChunked;
            if (!chunked) throw new Error("native.optimizeDependenciesChunked is not available");
            const result = chunked(
              vendorPackEntries.map((d) => ({ entryPath: d.entryPath, depsHash })),
              ionifyDir,
            );
            // P19R: surface peer dep warnings after chunked optimization.
            broadcastPeerDepWarnings((result as any)?.peerDepWarnings ?? (result as any)?.peer_dep_warnings);
            const group =
              (result as any)?.chunk_group ??
              (result as any)?.chunkGroup ??
              "unknown";
            const chunks =
              (result as any)?.chunk_files ??
              (result as any)?.chunkFiles ??
              [];
            if (!fs.existsSync(depsFilePath)) {
              throw new Error("Vendor pack optimizer did not produce requested file");
            }
            const stat = fs.statSync(depsFilePath);
            const optimizedSize = stat.size;
            const etag = weakEtagFromStat(`deps-${depsHash}`, stat);
            observeRouteHintDepRequest();
            const variant = selectPrecompressedVariant(req, depsFilePath);
            if (variant) {
              sendPrecompressedFile(req, res, 200, "application/javascript; charset=utf-8", variant, {
                etagPrefix: `deps-${depsHash}`,
                cacheControl: "no-cache",
              });
            } else {
              sendBuffer(req, res, 200, "application/javascript; charset=utf-8", startupInstrumentJavaScriptBuffer(fs.readFileSync(depsFilePath)), {
                etag,
                cacheControl: "no-cache",
              });
            }
            const elapsed = Date.now() - start;
            const rawKb = (rawSize / 1024).toFixed(1);
            const optKb = (optimizedSize / 1024).toFixed(1);
            const chunkCount = Array.isArray(chunks) ? chunks.length : 0;
            logInfo(
              `[deps] OPTIMIZE ${packageLabel}: MISS → BUILD (vendor pack group=${group}, ${elapsed}ms, ${rawKb}KB → ${optKb}KB, chunks=${chunkCount})`,
            );
            refreshDepsManifestIndex();
            observeDepForPackPlanning(fileName);
            return;
          } catch (err) {
            logWarn(
              `[deps] WARN: Vendor pack optimization failed for ${packageLabel}, falling back to per-entry: ${String(err)}`,
            );
          }
        }

        // Phase 6.0 + 6.2: Vendor Core shared-chunks prebundle (on-demand).
        // If this requested dep is part of the vendor core set (or its shared chunk), build the entire set as one graph
        // so shared transitives are emitted once. (Core stays small and deterministic.)
        if (
          canChunkVendorCore &&
          (vendorDepFileNames.has(fileName) || (vendorCoreSharedFileName && fileName === vendorCoreSharedFileName))
        ) {
          try {
            const start = Date.now();
            const rawSize = entryPath && fs.existsSync(entryPath) ? fs.statSync(entryPath).size : 0;
            const chunked = native?.optimizeDependenciesChunked;
            if (!chunked) throw new Error("native.optimizeDependenciesChunked is not available");
            const result = chunked(
              vendorDeps.map((d) => ({ entryPath: d.entryPath, depsHash })),
              ionifyDir,
            );
            // P19R: surface peer dep warnings after chunked optimization.
            broadcastPeerDepWarnings((result as any)?.peerDepWarnings ?? (result as any)?.peer_dep_warnings);
            const group =
              (result as any)?.chunk_group ??
              (result as any)?.chunkGroup ??
              "unknown";
            const chunks =
              (result as any)?.chunk_files ??
              (result as any)?.chunkFiles ??
              [];
            if (!fs.existsSync(depsFilePath)) {
              throw new Error("Chunked optimizer did not produce requested file");
            }
            const stat = fs.statSync(depsFilePath);
            const optimizedSize = stat.size;
            const etag = weakEtagFromStat(`deps-${depsHash}`, stat);
            observeRouteHintDepRequest();
            const variant = selectPrecompressedVariant(req, depsFilePath);
            if (variant) {
              sendPrecompressedFile(req, res, 200, "application/javascript; charset=utf-8", variant, {
                etagPrefix: `deps-${depsHash}`,
                cacheControl: "no-cache",
              });
            } else {
              sendBuffer(req, res, 200, "application/javascript; charset=utf-8", startupInstrumentJavaScriptBuffer(fs.readFileSync(depsFilePath)), {
                etag,
                cacheControl: "no-cache",
              });
            }
            const elapsed = Date.now() - start;
            const rawKb = (rawSize / 1024).toFixed(1);
            const optKb = (optimizedSize / 1024).toFixed(1);
            const chunkCount = Array.isArray(chunks) ? chunks.length : 0;
            logInfo(
              `[deps] OPTIMIZE ${packageLabel}: MISS → BUILD (chunked group=${group}, ${elapsed}ms, ${rawKb}KB → ${optKb}KB, chunks=${chunkCount})`,
            );
            refreshDepsManifestIndex();
            observeDepForPackPlanning(fileName);
            return;
          } catch (err) {
            logWarn(
              `[deps] WARN: Chunked optimization failed for ${packageLabel}, falling back to per-entry: ${String(err)}`,
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
          const rawSize = fs.existsSync(entryPath) ? fs.statSync(entryPath).size : 0;
          const result = native.optimizeDependency(
            entryPath,
            depsHash,
            depsSourcemapEnabled,
            depsBundleEsmEnabled,
            ionifyDir,
          );
          // P19R: surface any peer dep warnings to the browser dev overlay.
          broadcastPeerDepWarnings((result as any)?.peerDepWarnings ?? (result as any)?.peer_dep_warnings);
          const outPath = (result as any)?.out_path ?? (result as any)?.outPath ?? depsFilePath;
          const mapPath = (result as any)?.map_path ?? (result as any)?.mapPath ?? null;
          const resolvedOutPath = path.isAbsolute(outPath)
            ? outPath
            : path.join(depsRoot, outPath);
          if (!fs.existsSync(resolvedOutPath)) {
            throw new Error("Optimizer did not produce output");
          }
          const stat = fs.statSync(resolvedOutPath);
          const optimizedSize = stat.size;
          const etag = weakEtagFromStat(`deps-${depsHash}`, stat);
          observeRouteHintDepRequest();
          const variant = selectPrecompressedVariant(req, resolvedOutPath);
          if (variant) {
            sendPrecompressedFile(req, res, 200, "application/javascript; charset=utf-8", variant, {
              etagPrefix: `deps-${depsHash}`,
              cacheControl: "no-cache",
            });
          } else {
            const outBuffer = fs.readFileSync(resolvedOutPath);
            sendBuffer(req, res, 200, "application/javascript; charset=utf-8", startupInstrumentJavaScriptBuffer(outBuffer), {
              etag,
              cacheControl: "no-cache",
            });
          }
          const elapsed = Date.now() - start;
          const rawKb = (rawSize / 1024).toFixed(1);
          const optKb = (optimizedSize / 1024).toFixed(1);
          const mapSuffix = mapPath ? ` map=${path.basename(mapPath)}` : "";
          logInfo(`[deps] OPTIMIZE ${packageLabel}: MISS → BUILD (${elapsed}ms, ${rawKb}KB → ${optKb}KB)${mapSuffix}`);
          // Refresh manifest index after optimization
          refreshDepsManifestIndex();
          observeDepForPackPlanning(fileName);
          return;
        } catch (err) {
          logWarn(
            `[deps] WARN: Optimization failed for ${packageLabel}; refusing raw fallback to preserve /@deps contract: ${String(err)}`,
          );
          res.statusCode = 500;
          res.end("Dependency optimization failed");
          return;
        }
      }

      // Resolve to FS path (publicDir first, then project/module routes).
      let fsPath: string | null = null;
      let isPublicFile = false;
      if (publicDirAbs && shouldTryPublicDir(reqPath)) {
        const candidate = decodePublicDirPath(publicDirAbs, reqPath);
        if (candidate && fs.existsSync(candidate)) {
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
          if (isHtmlNavigationRequest(req, reqPath, q as Record<string, unknown>, spaFallback) && spaFallback.entryFilePath) {
            effectiveFsPath = spaFallback.entryFilePath;
            isPublicFile = false;
          } else {
            res.statusCode = 404;
            res.end("Module not found");
            return;
          }
        }
      }
      if (!fs.existsSync(effectiveFsPath)) {
        if (isHtmlNavigationRequest(req, reqPath, q as Record<string, unknown>, spaFallback) && spaFallback.entryFilePath) {
          effectiveFsPath = spaFallback.entryFilePath;
          isPublicFile = false;
        } else {
          res.statusCode = 404;
          res.end("Not found");
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
      // PublicDir files are served as-is (no transforms).
      if (isPublicFile && !isAssetExt(ext)) {
        try {
          watcher.watchFile(effectiveFsPath);
        } catch {
          // ignore watch errors; still serve
        }
        res.writeHead(200, { "Content-Type": guessContentType(effectiveFsPath) });
        fs.createReadStream(effectiveFsPath).pipe(res);
        return;
      }
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
          const urlPath = isPublicFile ? effectiveUrlPath : normalizeUrlFromFs(rootDir, effectiveFsPath);
          const js = assetAsModule(urlPath);
          res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
          res.end(js);
          return;
        } else {
          res.writeHead(200, { "Content-Type": contentTypeForAsset(ext) });
          fs.createReadStream(effectiveFsPath).pipe(res);
          return;
        }
      }

      // CSS loader: ?inline or .module.css (+ preprocessor .scss/.sass/.less/.styl) => JS module
      if (isCssLikeExt(ext)) {
        try {
          const cssSource = fs.readFileSync(effectiveFsPath, "utf8");
          const isModule = "module" in q || isCssModuleLikePath(effectiveFsPath);

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
          const baseCssDir = getCasArtifactPath(casRoot, configHash, contentHash);
          const baseCssFile = path.join(baseCssDir, "transformed.css");
          const baseCssMetaFile = path.join(baseCssDir, "meta.json");
          watcher.watchFile(effectiveFsPath);

          const kind = "css";

          // Mode + dependency-isolated CAS key to prevent cross-mode collisions and stale CSS
          // when @import or PostCSS plugin dependencies change. Tailwind graph-content
          // freshness is proven by the CSSA aggregated stamp folded into the recipe below.
          registerDevCssGraphSources();
          const baseCssMeta = readJsonFile<any>(baseCssMetaFile);
          const baseCssMetaCurrent = devCssMetaIsCurrent(baseCssMeta, contentHash, isModule, rootDir);
          const prevDeps = graph.getNode(effectiveFsPath)?.deps ?? [];
          graph.recordStructuralFiles(prevDeps);
          scheduleDependencyWatches(prevDeps);
          const depsStampHash = computeDepsStampHash(prevDeps);
          let artifactHash = getCacheKey(
            `css:v3:${effectiveFsPath}:${contentHash}:${mode}:${depsStampHash}:${metaTailwindStampForRecipe(baseCssMeta)}`,
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

          // Ensure build-compatible CSS artifact exists in unified CAS, even if we serve a mode-specific cache hit.
          // This enables `ionify build` to hydrate from CAS immediately after `ionify dev` (Phase U / unified pipeline).
          if (finalBuffer && !fs.existsSync(baseCssFile)) {
            try {
              registerDevCssGraphSources();
              const { css: compiledCss, tokens, deps, urlDeps, pipelineHash, tailwindGraphContent } = await compileCss({
                code: cssSource,
                filePath: effectiveFsPath,
                rootDir,
                modules: isModule,
                preprocessorOptions: (userConfig as any)?.css?.preprocessorOptions,
                // R1 (Completeness law): dev's live graph is request-shaped and
                // cannot be proven complete for the first document, so Tailwind
                // content must fail closed to the config globs — never narrow.
                tailwindContentAuthority: { mode: "config-globs" },
              });
              const depsAbs = deps.map((d) => d.filePath).filter(Boolean);
              const urlDepsAbs = urlDeps.map((d) => d.filePath).filter(Boolean);
              const allDepsAbs = [...depsAbs, ...urlDepsAbs];
              graph.recordStructuralFiles(allDepsAbs);
              const changed = graph.recordFile(effectiveFsPath, contentHash, allDepsAbs, [], kind);
              if (changed) {
                logInfo(`[Graph] CSS updated: ${effectiveFsPath}`);
              }
              scheduleDependencyWatches(allDepsAbs);
              fs.mkdirSync(baseCssDir, { recursive: true });
              const tmp = `${baseCssFile}.tmp-${process.pid}-${Date.now()}`;
              fs.writeFileSync(tmp, compiledCss, "utf8");
              fs.renameSync(tmp, baseCssFile);
              // Write build-hydration sidecar files so `ionify build` can compute the css:v3
              // derived artifact hash and skip PostCSS entirely on the first build after dev.
              writeJsonFile(baseCssMetaFile, buildDevCssMeta({
                contentHash,
                pipelineHash,
                depsAbs,
                urlDepsAbs,
                modules: isModule,
                tailwindGraphContent,
              }));
              if (isModule && tokens) {
                const tokPath = path.join(baseCssDir, "tokens.json");
                if (!fs.existsSync(tokPath)) writeJsonFile(tokPath, tokens);
              }
            } catch {
              // ignore base CSS CAS write errors
            }
          }

          if (!finalBuffer) {
            let body: string;

            if (mode === "css:url") {
              // Vite-style URL export for CSS.
              // Include a stable version key to make the JS module update when CSS changes.
              const rawUrl = `${effectiveUrlPath}?v=${contentHash}-${depsStampHash.slice(0, 8)}`;
              body = renderCssUrlModule(rawUrl);

              // `css:url` doesn't require compilation for the response, but build still needs a compiled CSS artifact.
              if (!fs.existsSync(baseCssFile) || !baseCssMetaCurrent) {
                try {
                  registerDevCssGraphSources();
                  const { css: compiledCss, tokens, deps, urlDeps, pipelineHash, tailwindGraphContent } = await compileCss({
                    code: cssSource,
                    filePath: effectiveFsPath,
                    rootDir,
                    modules: isModule,
                    preprocessorOptions: (userConfig as any)?.css?.preprocessorOptions,
                    // R1 (Completeness law): dev fails closed to config globs.
                    tailwindContentAuthority: { mode: "config-globs" },
                  });
                  const depsAbs = deps.map((d) => d.filePath).filter(Boolean);
                  const urlDepsAbs = urlDeps.map((d) => d.filePath).filter(Boolean);
                  const allDepsAbs = [...depsAbs, ...urlDepsAbs];
                  body = renderCssUrlModule(`${effectiveUrlPath}?v=${contentHash}-${computeDepsStampHash(allDepsAbs).slice(0, 8)}`);
                  graph.recordStructuralFiles(allDepsAbs);
                  const changed = graph.recordFile(effectiveFsPath, contentHash, allDepsAbs, [], kind);
                  if (changed) {
                    logInfo(`[Graph] CSS updated: ${effectiveFsPath}`);
                  }
                  scheduleDependencyWatches(allDepsAbs);
                  fs.mkdirSync(baseCssDir, { recursive: true });
                  const tmp = `${baseCssFile}.tmp-${process.pid}-${Date.now()}`;
                  fs.writeFileSync(tmp, compiledCss, "utf8");
                  fs.renameSync(tmp, baseCssFile);
                  writeJsonFile(baseCssMetaFile, buildDevCssMeta({
                    contentHash,
                    pipelineHash,
                    depsAbs,
                    urlDepsAbs,
                    modules: isModule,
                    tailwindGraphContent,
                  }));
                  if (isModule && tokens) {
                    const tokPath = path.join(baseCssDir, "tokens.json");
                    if (!fs.existsSync(tokPath)) writeJsonFile(tokPath, tokens);
                  }
                } catch {
                  // ignore base CSS CAS write errors
                }
              }
            } else {
              // Run PostCSS + (optional) modules pipeline.
              registerDevCssGraphSources();
              const { css: compiledCss, tokens, deps, urlDeps, pipelineHash, tailwindGraphContent } = await compileCss({
                code: cssSource,
                filePath: effectiveFsPath,
                rootDir,
                modules: isModule,
                preprocessorOptions: (userConfig as any)?.css?.preprocessorOptions,
                // R1 (Completeness law): dev's live graph is request-shaped and
                // cannot be proven complete for the first document, so Tailwind
                // content must fail closed to the config globs — never narrow.
                tailwindContentAuthority: { mode: "config-globs" },
              });
              const servedCss = rewriteCssUrls(
                rewriteCssImportSpecifiers(
                  compiledCss,
                  effectiveFsPath,
                  rootDir,
                  moduleResolver,
                ),
                effectiveFsPath,
                rootDir,
                // Dev serve-time url() rebasing (CSS Option 2) — map each local url() asset to its
                // dev-served public path so `@/`-alias + bare-package url()s resolve (relative ones
                // already would). Mirrors the build emit-time rebasing via the shared resolver, so
                // the phase-neutral CAS `transformed.css` stays untouched.
                (abs) =>
                  isForbiddenFsPath(abs) || !fs.existsSync(abs) ? null : normalizeUrlFromFs(rootDir, abs),
              );

              const depsAbs = deps.map((d) => d.filePath).filter(Boolean);
              const urlDepsAbs = urlDeps.map((d) => d.filePath).filter(Boolean);
              const allDepsAbs = [...depsAbs, ...urlDepsAbs];
              const nextDepsStampHash = computeDepsStampHash(allDepsAbs);
              artifactHash = getCacheKey(
                `css:v3:${effectiveFsPath}:${contentHash}:${mode}:${nextDepsStampHash}:${compileTailwindStampForRecipe(tailwindGraphContent)}`,
              );
              casDir = getCasArtifactPath(casRoot, configHash, artifactHash);
              casFile = path.join(casDir, jsMode ? "transformed.js" : "transformed.css");
              graph.recordStructuralFiles(allDepsAbs);
              const changed = graph.recordFile(effectiveFsPath, contentHash, allDepsAbs, [], kind);
              if (changed) {
                logInfo(`[Graph] CSS updated: ${effectiveFsPath}`);
              }
              scheduleDependencyWatches(allDepsAbs);

              // Write build-compatible compiled CSS to unified CAS (content-hash keyed).
              // Also write meta.json and tokens.json so `ionify build` can compute the css:v3
              // derived artifact hash and skip PostCSS on the first build after `ionify dev`.
              try {
                const alreadyExists = fs.existsSync(baseCssFile) && baseCssMetaCurrent;
                if (!alreadyExists) {
                  fs.mkdirSync(baseCssDir, { recursive: true });
                  const tmp = `${baseCssFile}.tmp-${process.pid}-${Date.now()}`;
                  fs.writeFileSync(tmp, compiledCss, "utf8");
                  fs.renameSync(tmp, baseCssFile);
                }
                writeJsonFile(baseCssMetaFile, buildDevCssMeta({
                  contentHash,
                  pipelineHash,
                  depsAbs,
                  urlDepsAbs,
                  modules: isModule,
                  tailwindGraphContent,
                }));
                if (isModule && tokens) {
                  const tokPath = path.join(baseCssDir, "tokens.json");
                  if (!fs.existsSync(tokPath)) writeJsonFile(tokPath, tokens);
                }
              } catch {
                // ignore base CSS CAS write errors
              }

              if (mode === "css:raw") {
                body = servedCss;
              } else if (mode === "css:raw-string") {
                body = renderCssRawStringModule(servedCss);
              } else {
                // css:inline and css:module are both injector JS modules; css:module additionally exports tokens.
                body = renderCssModule({
                  css: servedCss,
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
      
      const { localDeps, externalDeps } = classifyImportSpecifiersForGraph(
        specs,
        effectiveFsPath,
        configuredExternalSpecifiers,
      );
      const nextDeps = rewriteFederationGraphEdgeIds(
        [...localDeps, ...externalDeps],
        federationRemoteBindings,
      );
      enqueueLocalGraphCompletion(localDeps);
      const changed = graph.recordFile(effectiveFsPath, hash, nextDeps);

      if (!watcher.isWatched(effectiveFsPath)) {
        watcher.watchFile(effectiveFsPath);
      }
      
      scheduleDependencyWatches(localDeps);

      let result: TransformResult;
      try {
	        result = await transformer.run({
	          path: effectiveFsPath,
	          code,
	          ext,
	          moduleHash: computeTransformHash(hash),
	          config: userConfig ?? null,
	        });
      } catch (err) {
        const message =
          err instanceof Error ? err.stack || err.message : String(err);
        hmr.broadcastError({ message: `Failed to transform ${effectiveUrlPath}: ${message}` });
        throw err;
      }
      scheduleBaseCasTransform({
        filePath: effectiveFsPath,
        ext,
        code,
        baseHash: hash,
      });
      const runtimeGraph = resolveTransformedRuntimeGraphDeps(
        result.runtimeDependencies,
        effectiveFsPath,
        nextDeps,
      );
      graph.recordFile(
        effectiveFsPath,
        hash,
        runtimeGraph.deps,
        runtimeGraph.dynamicDeps,
      );
      const transformedCode = result.code;
      res.setHeader("X-Ionify-Cache", changed ? "MISS" : "HIT");

      // Phase 5.4.3: Apply define replacements first
      const withDefine = applyDefineReplacements(transformedCode, defineConfig);
      const envApplied = applyEnvPlaceholders(withDefine, ext);

      // HTML: inject HMR client
      if (path.extname(effectiveFsPath) === ".html") {
        activateFeaturePacksOnNextDocument();

        const documentRouteKey = normalizeDocumentRouteKey(reqPath);
        routeHints.beginDocument({
          routeKey: documentRouteKey,
          documentUrl: requestUrlWithQuery,
          clientKey: routeHintClientKey,
          observedAtMs: routeHintObservedAtMs,
        });
        scheduleProductionArtifactPublication(`document:${documentRouteKey}`);
        const currentStartupPolicySnapshot = startupPolicyEnabled ? refreshStartupPolicySnapshot() : null;

        let htmlOut = envApplied;
        const preloadUrl = (hintUrl: string) => {
          if (!hintUrl) return;
          htmlOut = injectModulePreload(htmlOut, hintUrl);
        };
        if (startupPolicyEnabled) {
          htmlOut = injectInlineScript(htmlOut, buildStartupPolicyClientScript(documentRouteKey));
        }

        const routeAwarePreloads = new Set<string>();
        const startupPolicyPreloads = startupPolicyPreloadAuthorityEnabled
          ? selectStartupPolicyPreloads(currentStartupPolicySnapshot, documentRouteKey)
          : [];
        const preloadHints =
          startupPolicyPreloads.length > 0
            ? startupPolicyPreloads
            : routeHints.selectPreloads(documentRouteKey, {
                maxEntries: 24,
                maxDepEntries: 8,
                maxSourceEntries: 16,
                minRequestCount: 1,
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
            startupPolicyPreloads.length > 0
              ? `[phase23] Startup policy ${documentRouteKey}: modulepreload=${routeAwarePreloads.size}`
              : `[phase22] Route hints ${documentRouteKey}: modulepreload=${routeAwarePreloads.size}`,
          );
        } else {
          // Phase 6.4: No-duplication policy.
          // Prefer pack/routing preloads when the current v2 routing index can
          // conservatively explain the bootstrap graph. This keeps first-hit HTML
          // aligned with the active vendor-pack routing authority and avoids
          // trusting stale pack files still sitting on disk.
          const preloadDepsUrl = (hintUrl: string) => {
            const fileName = depsFileNameFromRuntimeUrl(hintUrl);
            if (!fileName) return;
            if (!fs.existsSync(path.join(depsRoot, fileName))) return;
            preloadUrl(depsRuntimeUrl(fileName));
          };

          const packPreloads = new Set<string>(collectBootstrapRoutedPackPreloadUrls());
          const packFilesForVendorDeps = new Set<string>();
          if (vendorPacksEnabled) {
            for (const dep of vendorDeps) {
              const packFileName = vendorPackV2.fileNameToPackFile.get(dep.fileName) ?? null;
              if (!packFileName) continue;
              if (!fs.existsSync(path.join(depsRoot, packFileName))) continue;
              packFilesForVendorDeps.add(packFileName);
              const chunkFiles =
                vendorPackV2.packFileToChunkFiles.get(packFileName) ??
                (() => {
                  const shared = vendorPackV2.packFileToSharedFile.get(packFileName) ?? null;
                  return shared ? [shared] : [];
                })();
              if (chunkFiles.length === 0) continue;
              for (const chunkFile of chunkFiles) {
                if (typeof chunkFile !== "string" || !chunkFile.endsWith(".js")) continue;
                if (!fs.existsSync(path.join(depsRoot, chunkFile))) continue;
                packPreloads.add(depsRuntimeUrl(chunkFile));
              }
            }
          }

          if (packFilesForVendorDeps.size > 0) {
            for (const depsUrl of Array.from(packPreloads).sort()) preloadDepsUrl(depsUrl);
            for (const packFileName of Array.from(packFilesForVendorDeps).sort()) {
              preloadDepsUrl(depsRuntimeUrl(packFileName));
            }
          } else if (packPreloads.size > 0) {
            const sharedPreload = vendorPackSharedUrl || vendorCoreSharedUrl;
            if (sharedPreload) preloadDepsUrl(sharedPreload);
            for (const depsUrl of Array.from(packPreloads).sort()) preloadDepsUrl(depsUrl);
          } else {
            ensureVendorPackFile();
            const sharedPreload = vendorPackSharedUrl || vendorCoreSharedUrl;
            // The native chunker is the artifact authority for the emitted shared
            // filename. A stable-id prediction can differ from the optimizer's
            // actual chunk group, especially on the first cold request while
            // prewarm is still running. Never advertise a predicted file that
            // does not exist; the browser would otherwise retain a failed module
            // request for the active DPL generation.
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
          cacheControl: "no-cache",
        });
      } else {
        routeHints.noteRequest({
          url: requestUrlWithQuery,
          kind: "source",
          refererUrl: routeHintReferer,
          clientKey: routeHintClientKey,
          observedAtMs: routeHintObservedAtMs,
        });
        const startupInstrumented =
          guessContentType(effectiveFsPath).startsWith("application/javascript")
            ? startupInstrumentJavaScriptCode(envApplied)
            : envApplied;
        const finalBuffer = Buffer.from(startupInstrumented);
        const etag = weakEtagFromContent(`mod-${configHash}`, finalBuffer);
        sendBuffer(req, res, 200, guessContentType(effectiveFsPath), finalBuffer, {
          etag,
          cacheControl: "no-cache",
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

  const server = httpsOptions
    ? https.createServer(httpsOptions, requestHandler)
    : http.createServer(requestHandler);

  const dependencyEnvironmentPaths = new Set(
    dependencyEnvironmentWatchPaths(workspace.workspaceRoot, rootDir),
  );
  const clearGenerationTimers = <T>(timers: Map<T, ReturnType<typeof setTimeout>>) => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };
  const dependencySubsystemBusy = (): boolean =>
    activeRequests > 0 ||
    depUsageScanRunning ||
    manualSlimBuildRunning ||
    manualBuildRunning ||
    featureBuildRunning ||
    featureSlimBuildRunning;

  const activateDependencyGeneration = async (
    snapshot: DependencyEnvironmentSnapshot,
    reasons: string[],
  ): Promise<void> => {
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
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
    });
    const previousDepsHash = depsHash;
    const previousDepsRoot = depsRoot;

    papContractsPublished = false;
    papArtifactsPublished = false;
    papDirty = true;
    cancelProductionArtifactsPublication("dependency-environment");

    if (nextDepsHash !== previousDepsHash) {
      const nextDepsRoot = path.join(ionifyDir, "deps", nextDepsHash);
      fs.mkdirSync(nextDepsRoot, { recursive: true });
      let promoted = 0;
      let skipped = 0;
      if (native?.depsPromoteArtifacts && fs.existsSync(path.join(previousDepsRoot, "manifest.json"))) {
        try {
          const result = native.depsPromoteArtifacts(
            previousDepsRoot,
            nextDepsRoot,
            nextDepsHash,
            DEPS_OPTIMIZER_OUTPUT_VERSION,
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

      vendorPackLastRequestCounts = vendorPacksEnabled
        ? loadDepRequestCounts(vendorPackRequestsPath())
        : new Map<string, number>();
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
        log: { info: logInfo, warn: logWarn },
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
        `[deps] DPL generation activated ${previousDepsHash} -> ${nextDepsHash}` +
        ` (promoted=${promoted}, reoptimize=${skipped}, reasons=${reasons.join(",") || "unknown"})`,
      );
    } else {
      refreshDepsManifestIndex();
      logInfo(
        `[deps] Dependency environment converged without store rotation` +
        ` (depsHash=${depsHash}, reasons=${reasons.join(",") || "unknown"})`,
      );
    }

    hmr.broadcastEvent("dependency-generation", {
      previous: previousDepsHash,
      current: depsHash,
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
    },
  });

  for (const dependencyEnvironmentPath of dependencyEnvironmentPaths) {
    watcher.watchFile(dependencyEnvironmentPath, { allowMissing: true });
  }

  // Broadcast HMR reload on changes
  watcher.on("change", (file, status) => {
    logInfo(`[Watcher] ${status}: ${file}`);
    if (dependencyEnvironmentPaths.has(path.resolve(file))) {
      dependencyEnvironmentReconciling = true;
      papContractsPublished = false;
      papArtifactsPublished = false;
      papDirty = true;
      cancelProductionArtifactsPublication(`dependency:${status}`);
      dependencyEnvironmentSettler.notify(`${status}:${path.basename(file)}`);
      return;
    }
    papContractsPublished = false;
    papArtifactsPublished = false;
    papDirty = true;
    cancelProductionArtifactsPublication(`watch:${status}`);
    scheduleProductionArtifactPublication(`watch:${status}`, "contracts");
    const ext = path.extname(file).toLowerCase();
    const isReactFastRefreshBoundary =
      status !== "deleted" && (ext === ".tsx" || ext === ".jsx");
    const isCssBoundary = status !== "deleted" && isCssLikeExt(ext);

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
                isCssLikePath(absPath),
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
          isCssLikePath(absPath)
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
  let shutdownPrepared = false;
  const signalHandlers: Array<{ event: NodeJS.Signals; handler: () => void }> = [];

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

    routeHints.flush();
    graph.flush();
    
    for (const { event, handler } of signalHandlers) {
      process.off(event, handler);
    }
  };

  server.on("close", () => cleanup(false));

  const shutdown = async (exitProcess: boolean) => {
    flushVendorPackRequestCounts(true);
    prepareShutdown();
    await drainPendingGraphCompletion();
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

    // Flush any pending unified-CAS base writes before shutting down, so a subsequent
    // `ionify build` can hydrate immediately from CAS (Phase U / unified pipeline).
    try {
      const pending = Array.from(pendingBaseCas.values());
      if (pending.length > 0) {
        await Promise.allSettled(pending);
      }
    } catch {
      // ignore
    }
    if (baseCasPool) {
      try {
        await baseCasPool.drain();
      } catch {
        // ignore
      }
      try {
        await baseCasPool.close();
      } catch {
        // ignore
      }
      baseCasPool = null;
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
    server.listen(resolvedPort, resolvedHost, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  const actualPort =
    address && typeof address === "object" && address?.port
      ? address.port
      : resolvedPort;

  logInfo(`Ionify Dev Server (Phase 2) at ${protocol}://localhost:${actualPort}`);
  logInfo(`Ready in ${Date.now() - bootStartMs}ms`);
  logInfo(`HMR listening at /__ionify_hmr (SSE)`);

  // Phase 5-Cloud-EI-DX2: schedule an initial `.dev-stable` write so a
  // freshly prewarmed depsRoot still gets a sentinel even without any
  // browser traffic. Subsequent /@deps/* requests further debounce it.
  bumpDevStable();

  // Phase 5.9.2 + 6.2: Pre-warm vendor core (best-effort, non-blocking).
  // Phase 6.1 force-mode keeps the legacy "app vendor pack" prewarm behavior.
  const prewarmLabel = vendorPacksForce
    ? "vendor pack"
    : vendorPacksProgressive || vendorPacksManual
      ? "vendor core"
      : "vendor deps";
  const prewarmEntries: Array<{ entryPath: string; fileName: string; packageLabel: string }> = vendorPacksForce
    ? vendorPackEntries
    : vendorDeps;
  if (prewarmEntries.length > 0) {
    if (vendorPacksForce && vendorPackPlan) {
      logInfo(
        `[deps] Vendor packs enabled (${vendorPacksMode}) members=${vendorPackEntries.length} maxBytes=${vendorPackMaxBytes} maxMembers=${vendorPackMaxMembers}`,
      );
    }
    const labels = prewarmEntries.map((d) => d.packageLabel).join(", ");
    logInfo(`[deps] ${prewarmLabel} detected (${prewarmEntries.length}): ${labels}`);
    ensureVendorPackFile();

    const missing = prewarmEntries.filter((d) => !fs.existsSync(path.join(depsRoot, d.fileName)));
    const sharedMissing = vendorPacksForce
      ? vendorPackSharedFileName
        ? !fs.existsSync(path.join(depsRoot, vendorPackSharedFileName))
        : false
      : vendorCoreSharedFileName
        ? !fs.existsSync(path.join(depsRoot, vendorCoreSharedFileName))
      : false;
    if (missing.length > 0 || sharedMissing) {
      const entryCount = missing.length;
      logInfo(`[deps] Pre-warming ${prewarmLabel} (${entryCount}) in parallel...`);
      Promise.resolve()
        .then(() => {
          // Phase 6.0 + 6.1: Multi-entry shared-chunks prebundle (Ionify-native).
          const canChunk = vendorPacksForce ? canChunkVendorPacks : canChunkVendorCore;
          if (canChunk) {
            try {
              const start = Date.now();
              const chunked = native?.optimizeDependenciesChunked;
              if (!chunked) throw new Error("native.optimizeDependenciesChunked is not available");
              const result = chunked(
                prewarmEntries.map((d) => ({ entryPath: d.entryPath, depsHash })),
                ionifyDir,
              );
              // P19R: surface peer dep warnings after chunked optimization.
              broadcastPeerDepWarnings((result as any)?.peerDepWarnings ?? (result as any)?.peer_dep_warnings);
              const group =
                (result as any)?.chunk_group ??
                (result as any)?.chunkGroup ??
                "unknown";
              const chunks =
                (result as any)?.chunk_files ??
                (result as any)?.chunkFiles ??
                [];
              const elapsed = Date.now() - start;
              logInfo(
                `[deps] ✓ Prewarmed (shared chunks) group=${group} (${elapsed}ms, chunks=${Array.isArray(chunks) ? chunks.length : 0})`,
              );
              // Refresh manifest index after chunked optimization
              refreshDepsManifestIndex();
              return;
            } catch (err) {
              logWarn(`[deps] Prewarm chunked failed (fallback to per-entry): ${String(err)}`);
            }
          }

          if (native?.optimizeDependenciesBatch && !depsSourcemapEnabled && depsBundleEsmEnabled) {
            const results = native.optimizeDependenciesBatch(
              missing.map((d) => ({ entryPath: d.entryPath, depsHash })),
              ionifyDir,
            );
            results.forEach((r, idx) => {
              const dep = missing[idx];
              if (r?.error) {
                logWarn(`[deps] Prewarm failed ${dep.packageLabel}: ${r.error}`);
              } else if (r?.out_path || r?.outPath) {
                const outPath = (r as any).out_path ?? (r as any).outPath;
                logInfo(
                  `[deps] ✓ Prewarmed ${dep.packageLabel} → ${path.basename(outPath)}`,
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
                ionifyDir,
              );
              // P19R: surface peer dep warnings even during prewarm.
              broadcastPeerDepWarnings((result as any)?.peerDepWarnings ?? (result as any)?.peer_dep_warnings);
              const outPath = (result as any)?.out_path ?? (result as any)?.outPath ?? null;
              if (outPath) {
                logInfo(`[deps] ✓ Prewarmed ${dep.packageLabel} → ${path.basename(outPath)}`);
              }
            } catch (err) {
              logWarn(`[deps] Prewarm failed ${dep.packageLabel}: ${String(err)}`);
            }
          }
        })
        .catch((err) => {
          logWarn(`[deps] Prewarm error: ${err}`);
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
            const result = native.optimizeDependency(
              entryPath,
              depsHash,
              depsSourcemapEnabled,
              depsBundleEsmEnabled,
              ionifyDir,
            );
            // P19R: surface peer dep warnings even during prewarm.
            broadcastPeerDepWarnings((result as any)?.peerDepWarnings ?? (result as any)?.peer_dep_warnings);

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

  // -------------------------------------------------------------------------
  // Phase 5.5: Usage-driven pack slimming (Tree-Shaking v1)
  // - Scan the project graph for named imports from deps (deterministic usage map)
  // - Build usage-minimized variants of heavy manual packs in the background
  // - Apply on next reload via vendor-pack-v2 routing (restart-safe)
  // -------------------------------------------------------------------------
  if (packSlimmingEnabled) {
    const usageEntries: string[] = [];
    if (resolvedEntries && resolvedEntries.length > 0) {
      usageEntries.push(...resolvedEntries);
    } else {
      for (const candidate of [
        path.join(rootDir, "src", "main.tsx"),
        path.join(rootDir, "src", "main.ts"),
        path.join(rootDir, "src", "index.tsx"),
        path.join(rootDir, "src", "index.ts"),
      ]) {
        if (fs.existsSync(candidate)) usageEntries.push(candidate);
      }
    }

    if (!native?.resolveModule) {
      logWarn("[deps] packSlimming enabled but native.resolveModule is unavailable; skipping usage scan.");
	    } else if (usageEntries.length === 0) {
	      logWarn("[deps] packSlimming enabled but no entry files were detected; skipping usage scan.");
	    } else if (!depUsageScanRunning) {
	      depUsageScanRunning = true;
	      Promise.resolve()
	        .then(async () => {
	          const start = Date.now();
	          if (process.env.DEBUG_DEPS) {
	            logInfo(`[deps] Usage scan (Phase 5.5) starting from ${usageEntries.length} entry file(s)...`);
	          }
	          const index = canonicalizeDepUsageIndex(
              await scanDepUsage({ rootDir, entries: usageEntries, allowedRoots }),
              depsManifestCanonicalFileNames,
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

          // If manual packs are already ready (warm restart), schedule slimming immediately.
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
        })
        .catch((err) => {
          logWarn(`[deps] WARN: Usage scan failed (Phase 5.5): ${String(err)}`);
        })
        .finally(() => {
          depUsageScanRunning = false;
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
