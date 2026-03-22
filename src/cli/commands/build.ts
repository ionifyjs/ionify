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
import { resolveMinifier, type MinifierChoice } from "@cli/utils/minifier";
import { resolveTreeshake } from "@cli/utils/treeshake";
import { native, computeGraphVersion, getDepsOptimizerOutputVersion } from "@native/index";
import { COMPRESSION_CAS_VERSION, getCasArtifactPath, getCompressionCasArtifactPath } from "@core/utils/cas";
import { resolveScopeHoist } from "@cli/utils/scope-hoist";
import { resolveOptimizationLevel, getOptimizationPreset } from "@cli/utils/optimization-level";
import { resolveParser, applyParserEnv } from "@cli/utils/parser";
import {
  generateBuildPlan,
  writeBuildManifest,
  emitChunks,
  writeAssetsManifest,
  type EmittedOutputInfo,
} from "@core/bundler";
import type { BuildPlan } from "../../types/plan";
import { TransformWorkerPool } from "@core/worker/pool";
import { getCacheKey } from "@core/cache";
import { resolveWorkspace } from "@core/workspace";
import { loadEnv as loadIonifyEnv } from "@cli/utils/env";
import { applyDefineReplacements, buildDefineConfig } from "@core/utils/define";
import { WS_MODULE_PREFIX, fromWsModuleId, toWsModuleId } from "@core/module-id";
import { computeChunkGroupIdFromStableIds } from "@core/deps/vendor-pack-utils";
import { reconcilePackEntries, resolveChunkedPackEntries } from "@core/deps/feature-pack-planner";
import {
  buildCanonicalDepFileNameIndex,
  canonicalizeDepFileName,
  canonicalizeDepUsageIndex,
  scanDepUsage,
  type DepUsageIndex,
} from "@core/deps/usage";
import {
  getDepEntry,
  registerDepEntry,
  computeSubpathFromEntryPath,
} from "@core/deps/registry";
import { VendorPackV2IndexManager } from "@core/deps/vendor-pack-v2";
import { renderCssTokensModule } from "@core/loaders/css";
import { isForbiddenFsPath } from "@core/utils/public-path";
import { REACT_REFRESH_RUNTIME_MODULE } from "@core/refresh/reactRefreshInstrumentation";

interface BuildOptions {
  outDir?: string;
  level?: number;
}

const DEPS_OPTIMIZER_OUTPUT_VERSION = getDepsOptimizerOutputVersion();

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (!val || typeof val !== "object") return val;
    if (Array.isArray(val)) return val;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(val as Record<string, unknown>).sort()) {
      out[k] = (val as Record<string, unknown>)[k];
    }
    return out;
  });
}

function computeDefineSignature(defineConfig: Record<string, unknown>): string {
  const keys = Object.keys(defineConfig).sort();
  if (keys.length === 0) return "";
  const parts: string[] = [];
  for (const key of keys) {
    parts.push(`${key}=${stableStringify((defineConfig as any)[key])}`);
  }
  return parts.join("|");
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

function resolvePublicDir(rootDir: string, value: unknown): string | null {
  if (value === false) return null;
  const dir = typeof value === "string" && value.trim().length > 0 ? value.trim() : "public";
  return path.isAbsolute(dir) ? dir : path.resolve(rootDir, dir);
}

function resolveHtmlModuleEntryPath(htmlInput: string, rootDir: string, src: string): string | null {
  const trimmed = typeof src === "string" ? src.trim() : "";
  if (!trimmed) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(trimmed)) return null;
  if (trimmed.startsWith("data:") || trimmed.startsWith("javascript:") || trimmed.startsWith("#")) return null;

  const withoutQuery = trimmed.split("#", 1)[0]?.split("?", 1)[0]?.trim() ?? "";
  if (!withoutQuery) return null;

  if (withoutQuery.startsWith("/")) {
    return path.join(rootDir, withoutQuery.replace(/^[/\\]+/, ""));
  }

  return path.resolve(path.dirname(htmlInput), withoutQuery);
}

function inferBuildEntriesFromHtml(rootDir: string): string[] {
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
    const resolved = resolveHtmlModuleEntryPath(htmlInput, rootDir, src);
    if (!resolved) continue;
    if (!fs.existsSync(resolved)) {
      logWarn(`[Build] Skipping inferred entry "${src}" from index.html because the file does not exist`);
      continue;
    }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    entries.push(resolved);
  }

  return entries;
}

type CopiedAssetEntry = {
  file: string;
  bytes: number;
  hash: string;
};

async function copyPublicDirToOutDir(publicDirAbs: string | null, outDirAbs: string): Promise<CopiedAssetEntry[]> {
  if (!publicDirAbs) return [];
  const srcRoot = path.resolve(publicDirAbs);
  const destRoot = path.resolve(outDirAbs);

  let srcStat: fs.Stats | null = null;
  try {
    srcStat = fs.statSync(srcRoot);
  } catch {
    return [];
  }
  if (!srcStat.isDirectory()) return [];

  const copiedEntries: CopiedAssetEntry[] = [];
  const conflicts: string[] = [];

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
      const destPath = path.join(destRoot, rel);
      if (!destPath.startsWith(destRoot + path.sep) && destPath !== destRoot) continue;

      if (fs.existsSync(destPath)) {
        conflicts.push(rel.replace(/\\+/g, "/"));
        continue;
      }

      try {
        const fileBytes = await fs.promises.readFile(srcPath);
        await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
        await fs.promises.writeFile(destPath, fileBytes);
        copiedEntries.push({
          file: rel.replace(/\\+/g, "/"),
          bytes: fileBytes.length,
          hash: getCacheKey(fileBytes),
        });
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

  return copiedEntries;
}

type CssCasMeta = {
  version: 1;
  baseHash: string;
  pipelineHash: string;
  deps: string[];
  urlDeps: string[];
  modules: boolean;
  generatedAt: string;
};

function isCssModuleFile(filePath: string): boolean {
  return /\.module\.css$/i.test(filePath);
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
      map.set(outFile, {
        entryPath,
        packageLabel: (entry as any).package || "unknown",
        hasSourcemap: (entry as any).hasSourcemap === true,
        sizeBytes,
        moduleCount,
        edgeCount,
        externalCount,
        chunkGroup,
        chunkFiles,
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * T3 — Route node_modules deps through deps optimizer artifacts.
 *
 * Reads the deps manifest at `depsRoot/manifest.json`, builds a reverse map from
 * canonical entry paths to artifact paths, then walks the build plan:
 *   - Entry modules (matching a manifest entry) are rerouted to the pre-built artifact,
 *     their hash is recomputed from artifact bytes, and the artifact is written into CAS.
 *   - Internal transitive modules (node_modules files that are NOT direct entries) are
 *     pruned from the plan since the entry artifact already bundles them.
 *
 * Returns `{ rerouted, pruned }` counts.
 */
export function rerouteDepsArtifacts(options: {
  plan: BuildPlan;
  depsRoot: string;
  casRoot: string;
  configHash: string;
  workspaceRoot: string;
}): { rerouted: number; pruned: number } {
  const { plan, depsRoot, casRoot, configHash, workspaceRoot } = options;

  // Build reverse map: canonical entry path → { outFile, artifactPath }
  const depsArtifactsByEntry = new Map<string, { outFile: string; artifactPath: string }>();
  const manifestPath = path.join(depsRoot, "manifest.json");
  if (!fs.existsSync(manifestPath)) return { rerouted: 0, pruned: 0 };
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    const manifestEntries: Record<string, any> = parsed?.entries ?? {};
    for (const [entryPath, entry] of Object.entries(manifestEntries)) {
      const outFile = (entry as any)?.outFile ?? (entry as any)?.out_file ?? null;
      if (typeof outFile !== "string" || !outFile.endsWith(".js")) continue;
      const artifactPath = path.join(depsRoot, outFile);
      if (!fs.existsSync(artifactPath)) continue;
      let canonicalEntry: string;
      try {
        canonicalEntry = fs.realpathSync.native(entryPath);
      } catch {
        canonicalEntry = path.resolve(entryPath);
      }
      depsArtifactsByEntry.set(canonicalEntry, { outFile, artifactPath });
    }
  } catch {
    return { rerouted: 0, pruned: 0 };
  }

  if (depsArtifactsByEntry.size === 0) return { rerouted: 0, pruned: 0 };

  let rerouted = 0;
  let pruned = 0;

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

      const isNodeModules = fsPath ? fsPath.includes("node_modules") : mod.id.includes("node_modules");
      if (!isNodeModules) {
        keptModules.push(mod);
        continue;
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
      if (artifact) {
        const artifactCode = fs.readFileSync(artifact.artifactPath, "utf8");
        const artifactHash = getCacheKey(artifactCode);

        // Write artifact to CAS so the Rust bundler can find it via load_module_code.
        const artifactCasDir = getCasArtifactPath(casRoot, configHash, artifactHash);
        const artifactCasFile = path.join(artifactCasDir, "transformed.js");
        if (!fs.existsSync(artifactCasFile)) {
          fs.mkdirSync(artifactCasDir, { recursive: true });
          fs.writeFileSync(artifactCasFile, artifactCode, "utf8");
        }

        mod.fsPath = artifact.artifactPath;
        mod.hash = artifactHash;
        keptModules.push(mod);
        rerouted += 1;
      } else {
        pruned += 1;
      }
    }
    chunk.modules = keptModules;
  }

  return { rerouted, pruned };
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

type PackEntry = { entryPath: string; fileName: string; packageLabel: string };

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

type DepUsageDisk = {
  version: 1;
  depsHash: string;
  updatedAt: string;
  deps: Record<
    string,
    {
      entryPath: string;
      packageName: string;
      packageVersion: string;
      usedExports: string[];
      hasNamespace: boolean;
      hasExportStar: boolean;
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
  const depUsagePath = path.join(depsRoot, "deps-usage.v1.json");
  const raw = readJsonFile<DepUsageDisk>(depUsagePath);
  if (!raw || raw.version !== 1 || raw.depsHash !== depsHash) return null;
  const out: DepUsageIndex = new Map();
  const deps = raw.deps && typeof raw.deps === "object" ? raw.deps : {};
  for (const [fileName, value] of Object.entries(deps)) {
    if (!value || typeof value !== "object") continue;
    if (typeof value.entryPath !== "string" || typeof value.packageName !== "string") continue;
    if (typeof value.packageVersion !== "string" || !Array.isArray(value.usedExports)) continue;
    const usedExports = value.usedExports
      .map((v) => (typeof v === "string" ? v : ""))
      .filter(Boolean)
      .slice()
      .sort();
    const unique: string[] = [];
    for (const name of usedExports) {
      if (unique.length === 0 || unique[unique.length - 1] !== name) unique.push(name);
    }
    out.set(fileName, {
      fileName,
      entryPath: value.entryPath,
      packageName: value.packageName,
      packageVersion: value.packageVersion,
      usedExports: unique,
      hasNamespace: value.hasNamespace === true,
      hasExportStar: value.hasExportStar === true,
    });
  }
  return out;
}

function saveDepUsageIndexToDisk(depsRoot: string, depsHash: string, index: DepUsageIndex): void {
  const depUsagePath = path.join(depsRoot, "deps-usage.v1.json");
  const depsObj: DepUsageDisk["deps"] = {};
  const keys = Array.from(index.keys()).sort();
  for (const fileName of keys) {
    const item = index.get(fileName);
    if (!item) continue;
    depsObj[fileName] = {
      entryPath: item.entryPath,
      packageName: item.packageName,
      packageVersion: item.packageVersion,
      usedExports: item.usedExports.slice(),
      hasNamespace: item.hasNamespace,
      hasExportStar: item.hasExportStar,
    };
  }
  writeJsonFile(depUsagePath, {
    version: 1,
    depsHash,
    updatedAt: new Date().toISOString(),
    deps: depsObj,
  } satisfies DepUsageDisk);
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

  const entries: PackEntry[] = [];
  const seen = new Set<string>();
  for (const spec of vendorSpecifiers) {
    try {
      const resolved = native.resolveModule(spec, rootDir) as any;
      const kind = resolved?.kind;
      if (!kind || kind === "Builtin" || kind === "Virtual" || kind === "NotFound") continue;
      const fsPath = resolved?.fsPath ?? resolved?.fs_path ?? null;
      if (!fsPath || typeof fsPath !== "string") continue;
      if (!fsPath.includes("node_modules")) continue;

      const pkg = resolved?.pkg ?? null;
      const packageName = typeof pkg?.name === "string" ? pkg.name : spec;
      const packageVersion = typeof pkg?.version === "string" ? pkg.version : "0.0.0";
      const subpath = computeSubpathFromEntryPath(fsPath);
      const dep = registerDepEntry({
        entryPath: fsPath,
        packageName,
        packageVersion,
        subpath,
      });
      if (!dep?.fileName || seen.has(dep.fileName)) continue;
      seen.add(dep.fileName);
      entries.push({ entryPath: fsPath, fileName: dep.fileName, packageLabel: spec });
    } catch {
      // ignore resolution failures
    }
  }

  if (entries.length <= 1) return { enabled: true, didWork: false };
  entries.sort((a, b) => a.packageLabel.localeCompare(b.packageLabel));

  const chunkGroupId = computeChunkGroupIdFromStableIds(entries.map((e) => e.fileName));
  const sharedFileName = `shared.${chunkGroupId}.js`;
  const sharedPath = path.join(depsRoot, sharedFileName);
  const alreadyReady =
    fs.existsSync(sharedPath) && entries.every((e) => fs.existsSync(path.join(depsRoot, e.fileName)));

  const vendorPackV2 = new VendorPackV2IndexManager({
    depsRoot,
    depsHash,
    outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
    allowPackFilePrefix: "vendor-pack.feature.",
    log: { info: logInfo, warn: logWarn },
  });
  vendorPackV2.loadFromDisk();

  const statePath = path.join(depsRoot, "vendor-pack.feature.core.json");
  if (alreadyReady) {
    writeJsonFile(statePath, {
      version: 1,
      depsHash,
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      group: "core",
      updatedAt: new Date().toISOString(),
      status: "ready",
      chunkGroupId,
      sharedFileName,
      entries,
    } satisfies VendorManualPackState);

    vendorPackV2.ensurePackModuleFromEntries({
      label: "feature/core",
      packFileName: `vendor-pack.feature.core.${chunkGroupId}.js`,
      sharedFileName,
      entries,
      prunePackPrefix: "vendor-pack.feature.core.",
    });

    return { enabled: true, didWork: false };
  }

  writeJsonFile(statePath, {
    version: 1,
    depsHash,
    outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
    group: "core",
    updatedAt: new Date().toISOString(),
    status: "building",
    chunkGroupId,
    sharedFileName,
    entries,
  } satisfies VendorManualPackState);

  let didWork = false;
  try {
    const chunked = native?.optimizeDependenciesChunked;
    if (!chunked) throw new Error("native.optimizeDependenciesChunked is not available");
    didWork = true;
    const result = chunked(entries.map((e) => ({ entryPath: e.entryPath, depsHash })), ionifyDir);
    const groupId = (result as any)?.chunk_group ?? (result as any)?.chunkGroup ?? chunkGroupId;

    const sharedFileName = `shared.${groupId}.js`;
    const sharedOut = path.join(depsRoot, sharedFileName);
    const ok =
      fs.existsSync(sharedOut) && entries.every((e) => fs.existsSync(path.join(depsRoot, e.fileName)));
    if (!ok) throw new Error("Auto core pack optimizer did not produce expected outputs");

    writeJsonFile(statePath, {
      version: 1,
      depsHash,
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      group: "core",
      updatedAt: new Date().toISOString(),
      status: "ready",
      chunkGroupId: groupId,
      sharedFileName,
      entries,
    } satisfies VendorManualPackState);

    vendorPackV2.ensurePackModuleFromEntries({
      label: "feature/core",
      packFileName: `vendor-pack.feature.core.${groupId}.js`,
      sharedFileName,
      entries,
      prunePackPrefix: "vendor-pack.feature.core.",
    });
  } catch (err) {
    writeJsonFile(statePath, {
      version: 1,
      depsHash,
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      group: "core",
      updatedAt: new Date().toISOString(),
      status: "failed",
      chunkGroupId,
      sharedFileName,
      entries,
      error: String(err),
    } satisfies VendorManualPackState);
    logWarn(`[deps] WARN: Auto core production pack build failed: ${String(err)}`);
  }

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
    process.env.NODE_ENV = "production";
    const config = await loadIonifyConfig();
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

    // Align env exposure and define replacements with dev server behavior.
    // NOTE: NODE_ENV is forced to production for builds even if env files set it.
    process.env.MODE = process.env.MODE ?? "production";
    const envFromFiles = loadIonifyEnv(process.env.MODE, rootDir);
    process.env.NODE_ENV = "production";
    const envValues: Record<string, string> = {
      ...envFromFiles,
      NODE_ENV: process.env.NODE_ENV,
      MODE: process.env.MODE,
    };
    const envPrefix = config?.envPrefix || ["VITE_", "IONIFY_"];
    const defineConfig = buildDefineConfig(config?.define, envValues, envPrefix);
    logInfo(`[define] ${Object.keys(defineConfig).length} replacements configured`);
    
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
    const configuredEntries = config?.entry
      ? (Array.isArray(config.entry) ? config.entry : [config.entry])
          .map((entry) => (entry.startsWith("/") ? path.join(rootDir, entry) : path.resolve(rootDir, entry)))
          .filter((entry) => typeof entry === "string" && entry.length > 0)
      : [];
    let entries = configuredEntries.length > 0 ? configuredEntries : undefined;

    if (entries?.length) {
      logInfo(`Build entries: ${entries.join(", ")}`);
    } else {
      const inferredEntries = inferBuildEntriesFromHtml(rootDir);
      if (inferredEntries.length > 0) {
        entries = inferredEntries;
        logInfo(`Build entries inferred from index.html: ${entries.join(", ")}`);
      } else {
        logInfo(`No entries in config or index.html, planner will infer from graph`);
      }
    }
    
    // Create version inputs for automatic cache invalidation
    // computeGraphVersion handles canonicalization internally to ensure consistency
    const pluginNames = Array.isArray(config?.plugins)
      ? config.plugins
          .map((p: any) => (typeof p === "string" ? p : p?.name))
          .filter((name): name is string => typeof name === "string" && name.length > 0)
      : undefined;
    const rawVersionInputs: Parameters<typeof computeGraphVersion>[0] = {
      parserMode,
      minifier,
      treeshake,
      scopeHoist,
      plugins: pluginNames,
      entry: entries ?? null,
      cssOptions: (config as any)?.css,
      assetOptions: (config as any)?.assets ?? (config as any)?.asset,
      runtimeContracts: {
        reactRefreshRuntimeModule: REACT_REFRESH_RUNTIME_MODULE,
      },
    };
    // Propagate config hash to native for AST/cache invalidation
    const configHash = computeGraphVersion(rawVersionInputs);
    logInfo(`[Build] Version hash: ${configHash}`);
    process.env.IONIFY_CONFIG_HASH = configHash;

    // Align deps optimizer (/@deps) with build so native bundler can consume optimized ESM deps
    // (CJS wrappers like react/index.js must be optimized to browser-safe ESM).
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

    // Wave 5: Initialize AST cache with version hash
    if (native?.initAstCache) {
      const versionHash = JSON.stringify(rawVersionInputs);
      native.initAstCache(versionHash);
      logInfo(`AST cache initialized with version hash`);
    }

    await ensureOptimizedDeps({
      rootDir,
      ionifyDir,
      depsHash,
      depsRoot,
      config,
    });

	    const depsManifestIndex = loadDepsManifestIndex(depsRoot);

	    const vendorPacksRaw = config?.optimizeDeps?.vendorPacks ?? false;
		    const vendorPacksManualConfigured =
		      vendorPacksRaw &&
		      typeof vendorPacksRaw === "object" &&
		      !Array.isArray(vendorPacksRaw) &&
		      Object.keys(vendorPacksRaw as any).length > 0;
		    const vendorPacksAutoConfigured = vendorPacksRaw === "auto";

		    if (vendorPacksManualConfigured || vendorPacksAutoConfigured) {
		      const packsStart = Date.now();
		      try {
		        const packs = vendorPacksManualConfigured
		          ? await prepareProductionManualPacks({
		              rootDir,
	              ionifyDir,
	              depsHash,
	              depsRoot,
	              config,
	              resolvedEntries: entries,
	              allowedRoots: workspace.allowedRoots,
	              depsManifestIndex,
	            })
	          : await prepareProductionAutoCorePack({
	              rootDir,
	              ionifyDir,
	              depsHash,
		              depsRoot,
		              config,
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

    logInfo("Building...");

    const plan = await generateBuildPlan(entries, rawVersionInputs);
    const totalPlannedModules = plan.chunks.reduce((acc, chunk) => acc + chunk.modules.length, 0);
    logInfo(
      `[Build] Plan ready: entries=${plan.entries.length}, chunks=${plan.chunks.length}, modules=${totalPlannedModules}`,
    );

    // ── T3: Route node_modules deps through deps optimizer artifacts ──
    {
      const casRoot = path.join(ionifyDir, "cas");
      const { rerouted, pruned } = rerouteDepsArtifacts({
        plan,
        depsRoot,
        casRoot,
        configHash,
        workspaceRoot: workspace.workspaceRoot,
      });
      if (rerouted > 0 || pruned > 0) {
        logInfo(
          `[Build] Deps artifact rerouting: ${rerouted} entries rerouted, ${pruned} internal modules pruned`,
        );
      }
    }

    const outDir = options.outDir || "dist";

    const defineSignature = computeDefineSignature(defineConfig as any);
    const defineHash = defineSignature ? getCacheKey(defineSignature) : "";

    const moduleRefsById = new Map<
      string,
      Array<{ id: string; fsPath?: string | null; hash?: string | null; kind?: string | null }>
    >();
    const moduleMetaById = new Map<string, { fsPath: string; kind: "js" | "css"; hash: string | null }>();
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
          });
        }
        const bucket = moduleRefsById.get(mod.id);
        if (bucket) bucket.push(mod as any);
        else moduleRefsById.set(mod.id, [mod as any]);
      }
    }

    const moduleOutputs = new Map<string, { code: string; type: "js" | "css" | "asset" }>();

    const modulesInPlan = moduleMetaById.size;
    const casRoot = path.join(ionifyDir, "cas");

    let casHits = 0;
    const defineJobs: Array<{ id: string; artifactHash: string; baseCode: string }> = [];
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
    const getArtifactHash = (baseHash: string, kind: "js" | "css"): string => {
      if (kind !== "js") return baseHash;
      if (!defineHash) return baseHash;
      return getCacheKey(`${baseHash}|define:${defineHash}`);
    };

    // CAS hydration pass: skip transforms when artifacts already exist.
    for (const [id, meta] of moduleMetaById.entries()) {
      const refs = moduleRefsById.get(id) ?? [];
      const baseHashFromPlan = meta.hash;
      const cssNeedsJsWrapper = meta.kind === "css" && isCssModuleFile(meta.fsPath);
      let artifactHashFromPlan = baseHashFromPlan ? getArtifactHash(baseHashFromPlan, meta.kind) : null;

      if (meta.kind === "css" && baseHashFromPlan) {
        const baseDir = getCasArtifactPath(casRoot, configHash, baseHashFromPlan);
        const cssMeta = readJsonFile<CssCasMeta>(path.join(baseDir, "meta.json"));
        if (
          cssMeta &&
          cssMeta.version === 1 &&
          cssMeta.baseHash === baseHashFromPlan &&
          typeof cssMeta.pipelineHash === "string" &&
          cssMeta.pipelineHash.length > 0
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
            `css:v3:${id}:${baseHashFromPlan}:${cssMeta.pipelineHash}:${depsStampHash}:${cssNeedsJsWrapper ? 1 : 0}`,
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
        const casFileName = "transformed.js";
        const casFile = casDir ? path.join(casDir, casFileName) : null;
        if (casFile && fs.existsSync(casFile)) {
          casHits += 1;
          continue;
        }
      }

      // Define variant miss: if the base (pre-define) transform exists in CAS, derive the define variant
      // without re-running the transform worker.
      if (meta.kind === "js" && baseHashFromPlan) {
        const baseDir = getCasArtifactPath(casRoot, configHash, baseHashFromPlan);
        const baseFile = path.join(baseDir, "transformed.js");
        if (fs.existsSync(baseFile)) {
          try {
            const baseCode = fs.readFileSync(baseFile, "utf8");
            const artifactHash = getArtifactHash(baseHashFromPlan, "js");
            for (const ref of refs) ref.hash = artifactHash;
            defineJobs.push({ id, artifactHash, baseCode });
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
      // derive the define variant without invoking the worker transform.
      if (meta.kind === "js" && defineHash) {
        const baseDir = getCasArtifactPath(casRoot, configHash, baseHash);
        const baseFile = path.join(baseDir, "transformed.js");
        if (fs.existsSync(baseFile)) {
          try {
            const baseCode = fs.readFileSync(baseFile, "utf8");
            defineJobs.push({ id, artifactHash, baseCode });
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

    const transformsNeeded = jobs.length;
    const percentHits = modulesInPlan > 0 ? Math.round((casHits * 100) / modulesInPlan) : 100;

    // Derive define variants from base transforms already present in CAS.
    for (const job of defineJobs) {
      const cacheDir = getCasArtifactPath(casRoot, configHash, job.artifactHash);
      try {
        fs.mkdirSync(cacheDir, { recursive: true });
        const finalCode = applyDefineReplacements(job.baseCode, defineConfig);
        fs.writeFileSync(path.join(cacheDir, "transformed.js"), finalCode, "utf8");
      } catch {
        // ignore CAS write errors
      }
    }

    const pool = new TransformWorkerPool();
    try {
      const results = await pool.runMany(
        jobs.map((job) => ({
          id: job.id,
          filePath: job.filePath,
          ext: job.ext,
          code: job.code,
        }))
      );
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const job = jobs[i];
        if (result.error) {
          throw new Error(`Transform failed for ${result.filePath}: ${result.error}`);
        }

        const isJs = (result.type ?? "js") === "js";
        if (isJs) {
          const baseDir = getCasArtifactPath(casRoot, configHash, job.baseHash);
          const artifactDir = getCasArtifactPath(casRoot, configHash, job.artifactHash);
          fs.mkdirSync(baseDir, { recursive: true });
          fs.writeFileSync(path.join(baseDir, "transformed.js"), result.code, "utf8");
          if (result.map) {
            fs.writeFileSync(path.join(baseDir, "transformed.js.map"), result.map, "utf8");
          }

          fs.mkdirSync(artifactDir, { recursive: true });
          const finalCode = applyDefineReplacements(result.code, defineConfig);
          fs.writeFileSync(path.join(artifactDir, "transformed.js"), finalCode, "utf8");
          if (result.map && finalCode === result.code) {
            fs.writeFileSync(path.join(artifactDir, "transformed.js.map"), result.map, "utf8");
          }
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

          const depsAbs = Array.from(new Set([...deps, ...urlDeps].map((p) => path.resolve(p))));
          const depsStampHash = computeDepsContentStampHash(
            depsAbs,
            moduleMetaById,
            workspace.workspaceRoot,
          );

          const cssNeedsJsWrapper = job.cssNeedsJsWrapper === true;
          const artifactHash = getCacheKey(
            `css:v3:${job.id}:${job.baseHash}:${pipelineHash}:${depsStampHash}:${cssNeedsJsWrapper ? 1 : 0}`,
          );
          cssDerivedArtifactHashById.set(job.id, artifactHash);

          // Persist meta under the base hash (content-identity) for future artifact hash derivation.
          const baseDir = getCasArtifactPath(casRoot, configHash, job.baseHash);
          fs.mkdirSync(baseDir, { recursive: true });
          const meta: CssCasMeta = {
            version: 1,
            baseHash: job.baseHash,
            pipelineHash,
            deps: depsAbs.sort(),
            urlDeps: Array.from(new Set(urlDeps.map((p) => path.resolve(p)))).sort(),
            modules: cssNeedsJsWrapper,
            generatedAt: new Date().toISOString(),
          };
          writeJsonFile(path.join(baseDir, "meta.json"), meta);

          const artifactDir = getCasArtifactPath(casRoot, configHash, artifactHash);
          fs.mkdirSync(artifactDir, { recursive: true });
          fs.writeFileSync(path.join(artifactDir, "transformed.css"), result.code, "utf8");

          // CSS Modules build parity: provide a JS module exporting tokens for `.module.css`.
          if (cssNeedsJsWrapper) {
            const tokens =
              result.tokens && typeof result.tokens === "object"
                ? (result.tokens as Record<string, string>)
                : {};
            const js = renderCssTokensModule(tokens);
            fs.writeFileSync(path.join(artifactDir, "transformed.js"), js, "utf8");
            // Persist tokens for fast JS-wrapper synthesis on subsequent builds (tokens.json
            // allows the CAS hydration pass to skip PostCSS entirely for .module.css hits).
            writeJsonFile(path.join(artifactDir, "tokens.json"), tokens);
          }

          // Ensure plan modules use the derived CSS artifact hash so native bundler can hydrate JS wrappers.
          const refs = moduleRefsById.get(job.id) ?? [];
          for (const ref of refs) ref.hash = artifactHash;
          job.artifactHash = artifactHash;
        }
        
        const finalCode = isJs ? applyDefineReplacements(result.code, defineConfig) : result.code;
        moduleOutputs.set(job.id, { code: finalCode, type: result.type });
      }
    } finally {
      await pool.close();
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

    const absOutDir = path.resolve(outDir);

	    logInfo(`[Build] Emitting chunks via native bundler`);
	    const buildMinifyRaw = (config as any)?.build?.minify;
	    const buildMinifyEnabled = buildMinifyRaw === false ? false : true;
	    const minifyEnabled = optLevel !== null ? optLevel !== 0 : buildMinifyEnabled;
	    const mangleEnabled = minifyEnabled;
    const { artifacts, stats } = await emitChunks(absOutDir, plan, moduleOutputs, {
	      casRoot,
	      versionHash: configHash,
	      nativeOptions: {
	        minifier,
	        minify: minifyEnabled,
	        mangle: mangleEnabled,
	        treeshake,
	        scopeHoist,
	      },
	    });
    const outputHashHints = collectOutputHashHints(stats);
    recordOutputHashHint(outputHashHints, await writeBuildManifest(absOutDir, plan, artifacts));
    recordOutputHashHint(outputHashHints, await writeAssetsManifest(absOutDir, artifacts));

    // Emit index.html for SPA deployments (Phase 6.6+: manifest-driven output)
    recordOutputHashHint(outputHashHints, await emitIndexHtml({
      rootDir,
      outDir: absOutDir,
      entries: entries ?? [],
      plan,
      artifacts,
    }));

    // Copy publicDir assets BEFORE writing build.stats.json so they are included in the
    // publicAssets section and eligible for precompressBuildOutputs via outputHashHints.
    const copiedPublicAssets = await copyPublicDirToOutDir(publicDirAbs, absOutDir);
    if (copiedPublicAssets.length > 0) {
      stats.publicAssets = copiedPublicAssets;
      for (const asset of copiedPublicAssets) {
        outputHashHints.set(asset.file, asset.hash);
      }
    }

    const statsJson = JSON.stringify(stats, null, 2);
    await writeTextFileIfChanged(path.join(absOutDir, "build.stats.json"), statsJson);
    outputHashHints.set("build.stats.json", getCacheKey(statsJson));

    const coreBuildElapsed = Date.now() - buildStart;
    logInfo(`Build plan generated → ${path.join(absOutDir, "manifest.json")}`);
    logInfo(`Entries: ${plan.entries.length}, Chunks: ${plan.chunks.length}`);
    logInfo(`Modules in plan: ${modulesInPlan}`);
    logInfo(`CAS hits: ${casHits} (${percentHits}%) • transforms needed: ${transformsNeeded}`);
    logInfo(`Build complete in ${coreBuildElapsed}ms`);
    logInfo(`[Build] Time-to-deploy-ready: ${coreBuildElapsed}ms`);

    const precompressRaw = (config as any)?.build?.precompress;
    const precompressEnabled = precompressRaw !== false;
    const precompressConfig =
      precompressRaw && typeof precompressRaw === "object" && !Array.isArray(precompressRaw)
        ? (precompressRaw as Record<string, unknown>)
        : null;
    if (precompressEnabled) {
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

      // Phase 18C: plug in the Rust-native batch compressor when available.
      // The compressor is used only for JS chunk files (chunks/**/*.js) on CAS miss;
      // all other eligible files continue to use the Node.js zlib path.
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
      const report = await precompressBuildOutputs(absOutDir, {
        casRoot,
        thresholdBytes,
        gzipLevel,
        brotliQuality,
        emitManifest,
        concurrency,
        outputHashHints,
        nativeCompressor,
      });
      const elapsed = Date.now() - compressStart;
      const backendNote = native?.compressBatch ? " [js-chunks=rust]" : "";
      logInfo(
        `[Build][compress]${backendNote} ${report.totals.filesWithSidecars}/${report.totals.filesEligible} files precompressed in ${elapsed}ms (parallel=${report.concurrency}, current=${report.totals.filesAlreadyCurrent}, touched=${report.totals.filesTouched}, cas ${report.totals.casHits} hit/${report.totals.casMisses} miss, copied=${report.totals.sidecarsCopiedFromCas}, compressed=${report.totals.sidecarsCompressed}, br ${formatByteDelta(
          report.totals.brotliOriginalBytes,
        )}→${formatByteDelta(report.totals.brotliBytes)}, gzip ${formatByteDelta(
          report.totals.gzipOriginalBytes,
        )}→${formatByteDelta(report.totals.gzipBytes)})`,
      );
      logInfo(`Build total in ${Date.now() - buildStart}ms`);
    }
    const slimmingSaved = computeBuildSlimmingSavedPercent(depsRoot, depsHash);
    const vendorPacksSaved = computeBuildVendorPackRequestsSavedPercent(depsRoot, depsHash);
    logInfo(`Slimming saved: ${typeof slimmingSaved === "number" ? `${slimmingSaved}%` : "0%"}`);
    logInfo(`Vendor packs saved: ${typeof vendorPacksSaved === "number" ? `${vendorPacksSaved}%` : "0%"} requests`);
  } catch (err) {
    logError("ionify build failed", err);
    throw err;
  }
}

type LockfileInfo = {
  name: string;
  path: string;
  contents: Buffer;
};

const LOCKFILE_ORDER = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
];
const DEPS_CACHE_SCHEMA_VERSION = 1;

function readLockfile(workspaceRoot: string, projectRoot: string): LockfileInfo | null {
  const roots = [workspaceRoot, projectRoot].filter(Boolean);
  const uniqueRoots: string[] = [];
  for (const r of roots) {
    const abs = path.resolve(r);
    if (!uniqueRoots.includes(abs)) uniqueRoots.push(abs);
  }

  for (const root of uniqueRoots) {
    for (const name of LOCKFILE_ORDER) {
      const filePath = path.join(root, name);
      if (!fs.existsSync(filePath)) continue;
      const contents = fs.readFileSync(filePath);
      return { name, path: filePath, contents };
    }
  }
  return null;
}

function computeDepsHash(
  configHash: string,
  lockfile: LockfileInfo | null,
  opts: {
    nodeEnv: string;
    sourcemap: boolean;
    bundleEsm: boolean;
    sharedChunks: string;
    outputVersion: number;
  },
): string {
  const hash = crypto.createHash("sha256");
  hash.update(configHash);
  hash.update(`depsSchema=${DEPS_CACHE_SCHEMA_VERSION}`);
  if (lockfile) {
    hash.update(lockfile.contents);
  }
  hash.update(`NODE_ENV=${opts.nodeEnv}`);
  hash.update(`optimizeDeps.sourcemap=${opts.sourcemap ? "1" : "0"}`);
  hash.update(`optimizeDeps.bundleEsm=${opts.bundleEsm ? "1" : "0"}`);
  hash.update(`optimizeDeps.sharedChunks=${opts.sharedChunks}`);
  hash.update(`optimizeDeps.outputVersion=${opts.outputVersion}`);
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

async function ensureOptimizedDeps(options: {
  rootDir: string;
  ionifyDir: string;
  depsHash: string;
  depsRoot: string;
  config: any;
}) {
  const { rootDir, ionifyDir, depsHash, depsRoot, config } = options;
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
      entryPaths.add(fsPath);
    } catch {
      // ignore
    }
  }

  if (entryPaths.size === 0) return;
  fs.mkdirSync(depsRoot, { recursive: true });

  const entries = Array.from(entryPaths).map((entryPath) => ({ entryPath, depsHash }));

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
    try {
      native.optimizeDependenciesChunked(entries, ionifyDir);
      return;
    } catch {
      // fall through to batch/single
    }
  }

  if (native?.optimizeDependenciesBatch) {
    try {
      native.optimizeDependenciesBatch(entries, ionifyDir);
      return;
    } catch {
      // fall through to single
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
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
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

/**
 * Phase 18C: returns `true` for JS chunk files emitted by the native bundler
 * (relative path starts with `chunks/` and has a `.js` / `.mjs` extension).
 * These files are candidates for the Rust-native compression backend.
 */
function isJsChunkFile(relPosixPath: string): boolean {
  return (
    relPosixPath.startsWith("chunks/") &&
    (relPosixPath.endsWith(".js") || relPosixPath.endsWith(".mjs"))
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
     * Phase 18C: optional Rust-native compressor for JS chunk files.
     * When provided, JS chunk CAS misses are compressed via Rust (Rayon-parallel Brotli+gzip)
     * instead of Node.js zlib, eliminating the Node.js compression bottleneck for JS chunks.
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

      // Phase 18C: for JS chunk files use the Rust-native compressor on CAS miss (no Node zlib).
      // For all other files (CSS, HTML, JSON, …) fall back to the Node.js zlib path.
      let br: Buffer | null = null;
      let gz: Buffer | null = null;

      if ((needsBrCompression || needsGzCompression) && loadedBody) {
        const useNative = !!opts.nativeCompressor && isJsChunkFile(rel);
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
    writeJsonFile(path.join(outDir, "manifest.compression.json"), report);
  }
  return report;
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
  plan: Awaited<ReturnType<typeof generateBuildPlan>>;
  artifacts: Array<{ id: string; files: { js: string[]; css: string[]; assets: string[] } }>;
}): Promise<EmittedOutputInfo | null> {
  const { rootDir, outDir, entries, plan, artifacts } = options;

  const htmlInput = path.join(rootDir, "index.html");
  if (!fs.existsSync(htmlInput)) {
    return null;
  }

  const entryChunks = plan.chunks.filter((chunk) => chunk.entry);

  const entryScripts = entryChunks
    .map((chunk) => {
      const artifact = artifacts.find((a) => a.id === chunk.id);
      return pickPrimaryJs(artifact?.files?.js);
    })
    .filter((x): x is string => typeof x === "string" && x.length > 0);

  const entryCss = entryChunks
    .flatMap((chunk) => {
      const artifact = artifacts.find((a) => a.id === chunk.id);
      return pickPrimaryEntryCss(artifact?.files?.css);
    })
    .filter((x): x is string => typeof x === "string" && x.length > 0);

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
  const entryIds = new Set(plan.entries);
  const sharedPreloads = plan.chunks
    .filter((chunk) => !chunk.entry && chunk.shared && Array.isArray(chunk.consumers) && chunk.consumers.some((c) => entryIds.has(c)))
    .map((chunk) => {
      const artifact = artifacts.find((a) => a.id === chunk.id);
      return pickPrimaryJs(artifact?.files?.js);
    })
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .sort((a, b) => a.localeCompare(b));

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

  await fs.promises.mkdir(outDir, { recursive: true });
  const outputFile = path.join(outDir, "index.html");
  await writeTextFileIfChanged(outputFile, html);
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
