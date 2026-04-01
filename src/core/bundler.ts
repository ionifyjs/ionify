/**
{
  "description": "Bridge layer that interfaces with Rust bundler module. Orchestrates production build process, combining cached transforms into final chunks.",
  "phase": 1,
  "todo": [
    "Implement callBundler(entryPoints, graph).",
    "Load Rust napi binding from /rust/bundler.",
    "Manage parallel chunk generation.",
    "Emit build manifest and sourcemaps.",
    "Handle errors and pass logs to CLI."
  ]
}
*/

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { native, ensureNativeGraph, computeGraphVersion } from "@native/index";
import type { NativeBuildChunksOptions } from "@native/index";
import { logWarn, logInfo } from "@cli/utils/logger";
import { getCacheKey } from "@core/cache";
import { WS_MODULE_PREFIX, fromWsModuleId, resolveWorkspaceRoot, toWsModuleId } from "@core/module-id";
import { extractImports, resolveImports } from "@core/resolver";
import type { BuildPlan, BuildPlanChunk, BuildPlanModule, BuildPlanModuleKind } from "../types/plan";

type NativeAssetArtifact = { source: string; file_name: string };
type NativeChunkArtifact = {
  id: string;
  file_name: string;
  code: string;
  map?: string | null;
  assets: NativeAssetArtifact[];
  code_bytes: number;
  map_bytes: number;
};

type CssPipelineProfile = {
  chunksWithCss: number;
  cssModulesVisited: number;
  cssFsFallbackReads: number;
  cssDedupedModules: number;
  cssFilesWritten: number;
  cssInputBytes: number;
  cssOutputBytes: number;
  nsOrder: bigint;
  nsMinify: bigint;
  nsEmit: bigint;
};

export type EmittedOutputInfo = {
  file: string;
  bytes: number;
  hash: string;
};

interface SnapshotNode {
  id: string;
  hash: string | null;
  deps: string[];
  dynamicDeps?: string[];
  kind?: string;
}

function resolveIonifyDir(): string {
  const fromEnv = process.env.IONIFY_STATE_DIR;
  if (fromEnv && path.isAbsolute(fromEnv)) return fromEnv;
  const projectRoot = process.env.IONIFY_PROJECT_ROOT;
  if (projectRoot && path.isAbsolute(projectRoot)) return path.join(projectRoot, ".ionify");
  return path.join(process.cwd(), ".ionify");
}

function readGraphSnapshot(): SnapshotNode[] {
  // Try to load from native persisted graph first
  if (native?.graphLoadMap) {
    try {
      const nativeMap = native.graphLoadMap();
      if (nativeMap && Object.keys(nativeMap).length > 0) {
        return Object.values(nativeMap).map(node => ({
          id: node.id,
          hash: node.hash,
          deps: node.deps || [],
          dynamicDeps: (node as any).dynamicDeps || [],
          kind: typeof (node as any).kind === "string" ? (node as any).kind : undefined,
        }));
      }
    } catch (err) {
      logWarn(`Failed to load native graph: ${String(err)}`);
    }
  }
  
  // Fallback to JSON file for backward compatibility
  const file = path.join(resolveIonifyDir(), "graph.json");
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, "utf8");
    const snapshot = JSON.parse(raw);
    if (snapshot?.version !== 2 || !snapshot?.nodes) return [];
    return Object.entries(snapshot.nodes).map(([id, node]: [string, any]) => ({
      id,
      hash: typeof node.hash === "string" ? node.hash : null,
      deps: Array.isArray(node.deps) ? node.deps : [],
      dynamicDeps: Array.isArray(node.dynamicDeps) ? node.dynamicDeps : [],
      kind: typeof node.kind === "string" ? node.kind : undefined,
    }));
  } catch (err) {
    logWarn(`Failed to read graph snapshot: ${String(err)}`);
    return [];
  }
}

const JS_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"]);
const CSS_EXTENSIONS = new Set([".css"]);

function classifyModuleKind(id: string): BuildPlanModuleKind {
  const raw = id.startsWith(WS_MODULE_PREFIX) ? id.slice(WS_MODULE_PREFIX.length) : id;
  const ext = path.posix.extname(raw.replace(/\\/g, "/")).toLowerCase();
  if (CSS_EXTENSIONS.has(ext)) return "css";
  if (JS_EXTENSIONS.has(ext)) return "js";
  return "asset";
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const toPosix = (p: string) => p.split(path.sep).join("/");
const isBundleProfileEnabled = () =>
  process.env.IONIFY_BUNDLE_PROFILE === "1" ||
  process.env.IONIFY_BUNDLE_PROFILE === "true";
const nsToMs = (value: bigint) => Number(value) / 1_000_000;

async function writeTextFileIfChanged(filePath: string, contents: string): Promise<boolean> {
  const nextBytes = Buffer.byteLength(contents, "utf8");
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.isFile() && stat.size === nextBytes) {
      const existing = await fs.promises.readFile(filePath, "utf8");
      if (existing === contents) return false;
    }
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, contents, "utf8");
  return true;
}

async function writeBufferFileIfChanged(filePath: string, contents: Buffer): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.isFile() && stat.size === contents.length) {
      const existing = await fs.promises.readFile(filePath);
      if (Buffer.compare(existing, contents) === 0) return false;
    }
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, contents);
  return true;
}

function minifyCss(input: string): string {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{};:,])\s*/g, "$1")
    .trim();
}

function orderCssModules(chunk: BuildPlanChunk): string[] {
  const cssModules = chunk.modules.filter((m) => m.kind === "css");
  const cssSet = new Set(cssModules.map((m) => m.id));
  const adj = new Map<string, string[]>();
  for (const mod of cssModules) {
    const deps = [...(mod.deps || []), ...(mod.dynamicDeps || [])].filter((d) => cssSet.has(d));
    deps.sort();
    adj.set(mod.id, deps);
  }
  const visited = new Set<string>();
  const temp = new Set<string>();
  const ordered: string[] = [];
  const dfs = (id: string) => {
    if (visited.has(id) || temp.has(id)) return;
    temp.add(id);
    const edges = adj.get(id) || [];
    for (const dep of edges) dfs(dep);
    temp.delete(id);
    visited.add(id);
    ordered.push(id);
  };
  const sorted = [...cssModules.map((m) => m.id)].sort();
  for (const id of sorted) {
    dfs(id);
  }
  return ordered;
}

function normalizeModules(rawModules: any[]): BuildPlanModule[] {
  const modules: BuildPlanModule[] = [];
  for (const raw of rawModules) {
    if (typeof raw === "string") {
      modules.push({
        id: raw,
        fsPath: null,
        hash: null,
        kind: classifyModuleKind(raw),
        deps: [],
        dynamicDeps: [],
      });
      continue;
    }
    if (!raw || typeof raw !== "object") continue;
    const id = typeof raw.id === "string" ? raw.id : null;
    if (!id) continue;
    const rawKind = typeof raw.kind === "string" ? raw.kind : classifyModuleKind(id);
    const kind: BuildPlanModuleKind =
      rawKind === "asset"
        ? "asset"
        : rawKind.startsWith("css")
          ? "css"
          : "js";
    const deps = Array.isArray(raw.deps) ? raw.deps.filter(isNonEmptyString) : [];
    const dynamicSource = Array.isArray(raw.dynamicDeps)
      ? raw.dynamicDeps
      : Array.isArray((raw as any).dynamic_deps)
        ? (raw as any).dynamic_deps
        : [];
    const dynamicDeps = dynamicSource.filter(isNonEmptyString);
    const fsPath =
      typeof (raw as any).fsPath === "string"
        ? (raw as any).fsPath
        : typeof (raw as any).fs_path === "string"
          ? (raw as any).fs_path
          : null;
    const hash =
      typeof raw.hash === "string" && raw.hash.length
        ? raw.hash
        : null;
    modules.push({
      id,
      fsPath,
      hash,
      kind,
      deps,
      dynamicDeps,
    });
  }
  return modules;
}

function normalizePlan(plan: any): BuildPlan {
  const entries = Array.isArray(plan?.entries)
    ? Array.from<string>(new Set(plan.entries.filter(isNonEmptyString)))
    : [];

  const rawChunks = Array.isArray(plan?.chunks) ? plan.chunks : [];
  const normalizedChunks = rawChunks.map((chunk: any, index: number): BuildPlanChunk => {
    const id =
      typeof chunk?.id === "string" && chunk.id.length
        ? chunk.id
        : `chunk-${index}`;
    const modules = normalizeModules(Array.isArray(chunk?.modules) ? chunk.modules : []);
    const consumersRaw = Array.isArray(chunk?.consumers) ? chunk.consumers.filter(isNonEmptyString) : null;
    const cssRaw = Array.isArray(chunk?.css) ? chunk.css.filter(isNonEmptyString) : null;
    const assetsRaw = Array.isArray(chunk?.assets) ? chunk.assets.filter(isNonEmptyString) : null;

    const consumers = consumersRaw && consumersRaw.length
      ? Array.from<string>(new Set(consumersRaw))
      : [...entries];
    const inferredCss = cssRaw && cssRaw.length
      ? cssRaw
      : modules.filter((m) => m.kind === "css").map((m) => m.id);
    const inferredAssets = assetsRaw && assetsRaw.length
      ? assetsRaw
      : modules.filter((m) => m.kind === "asset").map((m) => m.id);

    return {
      id,
      modules,
      entry: chunk?.entry === true,
      shared: chunk?.shared === true,
      consumers,
      css: inferredCss,
      assets: inferredAssets,
    };
  });

  return {
    entries,
    chunks: normalizedChunks,
  };
}

function fallbackPlan(entries?: string[]): BuildPlan {
  const workspaceRoot = resolveWorkspaceRoot(null);
  const nodes = readGraphSnapshot();
  logInfo(`[Fallback] modules: ${nodes.length}, entries: ${entries?.length ?? 0}`);
  logInfo(`[Fallback] module IDs: ${nodes.map(n => n.id).join(', ')}`);
  logInfo(`[Fallback] entry IDs: ${entries?.join(', ') ?? 'none'}`);
  
  const modules = nodes.map((n) => n.id);
  const deps = new Set<string>();
  for (const node of nodes) {
    for (const dep of node.deps) deps.add(dep);
  }
  let finalEntries = entries && entries.length ? [...entries] : modules.filter((m) => !deps.has(m));
  if (!finalEntries.length && modules.length) {
    finalEntries = [modules[0]];
  }

	  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
	  const planModules: BuildPlanModule[] = modules.map((id) => {
	    const node = nodeMap.get(id);
	    const fsPath = id.startsWith(WS_MODULE_PREFIX)
	      ? fromWsModuleId(id, workspaceRoot)
	      : path.isAbsolute(id)
	        ? id
	        : null;
	    const rawKind =
	      typeof node?.kind === "string" && node.kind.length > 0 ? node.kind : classifyModuleKind(id);
	    const kind: BuildPlanModuleKind =
	      rawKind === "asset" ? "asset" : rawKind.startsWith("css") ? "css" : "js";
	    return {
	      id,
	      fsPath,
	      hash: node?.hash ?? null,
	      kind,
	      deps: node?.deps ?? [],
	      dynamicDeps: node?.dynamicDeps ?? [],
	    };
	  });
  const css = planModules.filter((m) => m.kind === "css").map((m) => m.id);
  const assets = planModules.filter((m) => m.kind === "asset").map((m) => m.id);

  return normalizePlan({
    entries: finalEntries,
    chunks: [
      {
        id: "chunk-main",
        modules: planModules,
        entry: true,
        shared: false,
        consumers: finalEntries,
        css,
        assets,
      } as const,
    ],
  });
}

export async function generateBuildPlan(
  entries?: string[],
  versionInputs?: Parameters<typeof computeGraphVersion>[0]
): Promise<BuildPlan> {
  const workspaceRoot = resolveWorkspaceRoot(null);
  const entryIds = Array.isArray(entries)
    ? entries
        .map((entry) => {
          if (typeof entry !== "string" || entry.length === 0) return null;
          if (entry.startsWith(WS_MODULE_PREFIX)) return entry;
          if (!path.isAbsolute(entry)) return null;
          return toWsModuleId(entry, workspaceRoot);
        })
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const entryPaths = Array.isArray(entries)
    ? entries
        .map((entry) => {
          if (typeof entry !== "string" || entry.length === 0) return null;
          if (path.isAbsolute(entry)) return entry;
          if (entry.startsWith(WS_MODULE_PREFIX)) return fromWsModuleId(entry, workspaceRoot);
          return null;
        })
        .filter((p): p is string => typeof p === "string" && p.length > 0)
    : [];
  const version = versionInputs ? computeGraphVersion(versionInputs) : undefined;
  logInfo(`Graph version: ${version || 'default'}`);
  
  // Use the same graph database path as Graph class
  const graphDbPath = path.join(resolveIonifyDir(), "graph.db");
  const nativeGraphReady = ensureNativeGraph(graphDbPath, version);
  
  // Try to load persisted graph first
  let moduleCount = 0;
  if (nativeGraphReady && native?.graphLoadMap) {
    try {
      const persistedGraph = native.graphLoadMap();
      const graphSize = persistedGraph ? Object.keys(persistedGraph).length : 0;
      moduleCount = graphSize;
      logInfo(`Native graph loaded: ${graphSize} modules`);
      if (persistedGraph && graphSize > 0) {
        logInfo(`Loaded persisted graph with ${graphSize} modules`);
        // Graph is loaded, planner will use it
      }
    } catch (err) {
      logWarn(`Failed to load persisted graph: ${String(err)}`);
    }
  } else {
    logWarn(`graphLoadMap not available, native binding: ${!!native}`);
  }

  // If graph is empty, rebuild from entries via BFS to avoid planner failure.
  if (nativeGraphReady && moduleCount === 0 && entryPaths.length && native) {
    logWarn(`[Build] Graph is empty — rebuilding dependency graph from entries...`);

    const queue = [...entryPaths];
    const seen = new Set(queue);
    const graphSeedNodes: Array<{
      id: string;
      hash: string;
      deps: string[];
      dynamicDeps: string[];
      kind: BuildPlanModuleKind;
    }> = [];

    while (queue.length) {
      const file = queue.shift()!;
      if (!fs.existsSync(file)) continue;

      const code = fs.readFileSync(file, "utf8");
      let hash = getCacheKey(code);
      let specs: string[] = [];

      let dynamicSpecs: string[] = [];
      if (native.parseModuleIr) {
        try {
          const ir = native.parseModuleIr(file, code);
          hash = ir.hash;
          const staticDeps = ir.dependencies.filter((d: any) => d.kind !== "Dynamic");
          const dynamicDeps = ir.dependencies.filter((d: any) => d.kind === "Dynamic");
          specs = staticDeps.map((d: any) => d.specifier);
          dynamicSpecs = dynamicDeps.map((d: any) => d.specifier);
        } catch {
          specs = extractImports(code, file);
        }
      } else {
        specs = extractImports(code, file);
      }

      const depsAbs = resolveImports(specs, file);
      const dynamicAbs = resolveImports(dynamicSpecs, file);
      const fileId = toWsModuleId(file, workspaceRoot);
      if (!fileId) continue;
      const depsIds = depsAbs
        .map((dep) => toWsModuleId(dep, workspaceRoot))
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      const dynamicIds = dynamicAbs
        .map((dep) => toWsModuleId(dep, workspaceRoot))
        .filter((id): id is string => typeof id === "string" && id.length > 0);

      graphSeedNodes.push({
        id: fileId,
        hash,
        deps: depsIds,
        dynamicDeps: dynamicIds,
        kind: classifyModuleKind(fileId),
      });

      // BFS propagation — include dynamic import targets so they are also recorded
      for (const dep of [...depsAbs, ...dynamicAbs]) {
        if (!seen.has(dep)) {
          seen.add(dep);
          queue.push(dep);
        }
      }
    }

    if (graphSeedNodes.length > 0) {
      if (typeof native.graphRecordBatch === "function") {
        native.graphRecordBatch(graphSeedNodes);
      } else if (typeof (native as any).graphRecord === "function") {
        for (const node of graphSeedNodes) {
          (native as any).graphRecord(node.id, node.hash, node.deps, node.dynamicDeps, node.kind);
        }
      } else if (typeof (native as any).recordFile === "function") {
        for (const node of graphSeedNodes) {
          (native as any).recordFile(node.id, node.hash, node.deps, node.dynamicDeps, node.kind);
        }
      }
    }

    // Reload module count after rebuild
    try {
      if (typeof (native as any).loadModulesCount === "function") {
        moduleCount = (native as any).loadModulesCount() ?? moduleCount;
      } else if (native.graphLoadMap) {
        const persistedGraph = native.graphLoadMap();
        moduleCount = persistedGraph ? Object.keys(persistedGraph).length : moduleCount;
      }
    } catch {
      // ignore count errors
    }
    logInfo(`[Build] Dependency graph rebuilt: ${moduleCount} modules`);
  }
  
  if (nativeGraphReady && native?.plannerPlanBuild) {
    try {
      const start = Date.now();
      logInfo(`[Planner] Calling native plannerPlanBuild with ${entryIds.length} entries`);
      const plan = native.plannerPlanBuild(entryIds);
      logInfo(`[Planner] Native plan returned: ${plan.entries.length} entries, ${plan.chunks.length} chunks in ${Date.now() - start}ms`);
      return normalizePlan(plan);
    } catch (err) {
      logWarn(`plannerPlanBuild failed, falling back to JS planner: ${String(err)}`);
    }
  }
  return fallbackPlan(entryIds);
}

type ChunkFiles = { js: string[]; css: string[]; assets: string[] };

export async function writeBuildManifest(
  outputDir: string,
  plan: BuildPlan,
  artifacts: Array<{ id: string; files: ChunkFiles }>,
): Promise<EmittedOutputInfo> {
  const filesByChunk = new Map<string, ChunkFiles>();
  for (const artifact of artifacts) {
    filesByChunk.set(artifact.id, artifact.files);
  }

  const manifest = {
    entries: plan.entries,
    chunks: plan.chunks.map((chunk) => ({
      id: chunk.id,
      entry: chunk.entry,
      shared: chunk.shared,
      consumers: chunk.consumers,
      modules: chunk.modules.map((mod) => ({
        id: mod.id,
        kind: mod.kind,
        deps: mod.deps,
        dynamicDeps: mod.dynamicDeps,
      })),
      files: filesByChunk.get(chunk.id) ?? { js: [], css: [], assets: [] },
    })),
  };

  const dir = path.resolve(outputDir);
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, "manifest.json");
  const contents = JSON.stringify(manifest, null, 2);
  await writeTextFileIfChanged(file, contents);
  return {
    file: toPosix(path.relative(dir, file)),
    bytes: Buffer.byteLength(contents, "utf8"),
    hash: getCacheKey(contents),
  };
}

export async function emitChunks(
  outputDir: string,
  plan: BuildPlan,
  moduleOutputs: Map<string, { code: string; type: "js" | "css" | "asset" }>,
  opts?: { casRoot?: string; versionHash?: string; nativeOptions?: NativeBuildChunksOptions },
): Promise<{ artifacts: Array<{ id: string; files: ChunkFiles }>; stats: Record<string, any> }> {
  if (!native?.buildChunks) {
    logWarn("Native buildChunks binding is not available; using JS fallback emitter.");
    const rawArtifacts = buildJsFallbackArtifacts(plan, moduleOutputs);
    return emitChunksFromArtifacts(outputDir, plan, moduleOutputs, rawArtifacts);
  }
  const start = Date.now();
  const rawArtifacts = native.buildChunks(plan, opts?.casRoot, opts?.versionHash, opts?.nativeOptions) ?? [];
  logInfo(`[Bundler] buildChunks completed in ${Date.now() - start}ms (native)`);
  return emitChunksFromArtifacts(outputDir, plan, moduleOutputs, rawArtifacts);
}

function buildJsFallbackArtifacts(
  plan: BuildPlan,
  moduleOutputs: Map<string, { code: string; type: "js" | "css" | "asset" }>,
): NativeChunkArtifact[] {
  const artifacts: NativeChunkArtifact[] = [];

  for (const chunk of plan.chunks) {
    const jsParts: string[] = [];
    const assets: NativeAssetArtifact[] = [];
    const idToFsPath = new Map<string, string>();
    for (const mod of chunk.modules) {
      const fsPath = mod.fsPath;
      if (typeof fsPath === "string" && fsPath.length > 0) {
        idToFsPath.set(mod.id, fsPath);
      }
    }

    for (const mod of chunk.modules) {
      const output = moduleOutputs.get(mod.id);
      if (output?.type === "js") {
        jsParts.push(`// ${mod.id}\n${output.code}`);
      }
    }

    for (const assetId of chunk.assets) {
      const assetPath = idToFsPath.get(assetId);
      if (!assetPath) continue;
      try {
        const data = fs.readFileSync(assetPath);
        if (data.length < 4096) {
          // Inline small assets via data URI emitted through JS fallback
          const mime = "application/octet-stream";
          const inline = `data:${mime};base64,${data.toString("base64")}`;
          jsParts.push(`// ${assetId}\nexport const __ionify_asset = "${inline}";`);
          continue;
        }
        // Hash raw bytes to avoid UTF-8 coercion issues for binary assets
        const hash = crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
        const ext = path.extname(assetPath) || ".bin";
        const fileName = `assets/${hash}${ext}`;
        assets.push({
          source: assetPath,
          file_name: fileName,
        });
      } catch {
        const fileName = path.basename(assetPath) || "asset";
        assets.push({
          source: assetPath,
          file_name: fileName,
        });
      }
    }

    const code = jsParts.length
      ? jsParts.join("\n\n")
      : `// Ionify JS fallback for ${chunk.id}\nexport default {};`;

    artifacts.push({
      id: chunk.id,
      file_name: `${chunk.id}.fallback.js`,
      code,
      map: null,
      assets,
      code_bytes: Buffer.byteLength(code, "utf8"),
      map_bytes: 0,
    });
  }

  return artifacts;
}

function normalizeNativeArtifact(raw: any): NativeChunkArtifact {
  const id: string = raw.id;
  if (!id) {
    throw new Error("Native artifact missing id");
  }
  const file_name: string = raw.file_name ?? `${id.replace(/::/g, ".")}.native.js`;
  const code: string = raw.code ?? "";
  const map: string | null = raw.map ?? null;
  const code_bytes: number =
    typeof raw.code_bytes === "number" ? raw.code_bytes : Buffer.byteLength(code, "utf8");
  const map_bytes: number =
    typeof raw.map_bytes === "number"
      ? raw.map_bytes
      : map
        ? Buffer.byteLength(map, "utf8")
        : 0;
  const assets: NativeAssetArtifact[] = Array.isArray(raw.assets)
    ? raw.assets.map((asset: any) => ({
        source: asset.source,
        file_name: asset.file_name ?? asset.fileName ?? path.basename(asset.source ?? "asset"),
      }))
    : [];

  return { id, file_name, code, map, assets, code_bytes, map_bytes };
}

export async function emitChunksFromArtifacts(
  outputDir: string,
  plan: BuildPlan,
  moduleOutputs: Map<string, { code: string; type: "js" | "css" | "asset" }>,
  rawArtifacts: Array<any>,
): Promise<{ artifacts: Array<{ id: string; files: ChunkFiles }>; stats: Record<string, any> }> {
  const chunkDir = path.join(outputDir, "chunks");
  await fs.promises.mkdir(chunkDir, { recursive: true });
  const assetsDir = path.join(outputDir, "assets");
  await fs.promises.mkdir(assetsDir, { recursive: true });

  const enableSourceMaps = process.env.IONIFY_SOURCEMAPS === "true";
  const cssProfile: CssPipelineProfile | null = isBundleProfileEnabled()
    ? {
        chunksWithCss: 0,
        cssModulesVisited: 0,
        cssFsFallbackReads: 0,
        cssDedupedModules: 0,
        cssFilesWritten: 0,
        cssInputBytes: 0,
        cssOutputBytes: 0,
        nsOrder: 0n,
        nsMinify: 0n,
        nsEmit: 0n,
      }
    : null;

  const grouped = new Map<string, NativeChunkArtifact[]>();
  for (const raw of rawArtifacts) {
    const artifact = normalizeNativeArtifact(raw);
    const baseId = artifact.id.split("::")[0] ?? artifact.id;
    const bucket = grouped.get(baseId);
    if (bucket) bucket.push(artifact);
    else grouped.set(baseId, [artifact]);
  }

  const buildStats: Record<string, any> = {};
  const results: Array<{ id: string; files: ChunkFiles }> = [];

  for (const chunk of plan.chunks) {
    const artifacts = grouped.get(chunk.id);
    if (!artifacts || !artifacts.length) {
      throw new Error(`Native bundler did not emit artifacts for ${chunk.id}`);
    }

    const chunkOutDir = path.join(chunkDir, chunk.id);
    await fs.promises.mkdir(chunkOutDir, { recursive: true });

    artifacts.sort((a, b) => {
      if (a.id === chunk.id) return -1;
      if (b.id === chunk.id) return 1;
      return a.id.localeCompare(b.id);
    });

    const jsFiles: string[] = [];
    const cssFiles: string[] = [];
    const assetFiles: string[] = [];
    const assetWritten = new Set<string>();
    const idToFsPath = new Map<string, string>();
    for (const mod of chunk.modules) {
      const fsPath = mod.fsPath;
      if (typeof fsPath === "string" && fsPath.length > 0) {
        idToFsPath.set(mod.id, fsPath);
      }
    }

    const copyAssets = async (assets: NativeAssetArtifact[]) => {
      for (const asset of assets) {
        if (!asset?.source) continue;
        const relName = asset.file_name ?? path.basename(asset.source);
        const assetFile = path.join(outputDir, relName);
        if (assetWritten.has(assetFile)) continue;
        try {
          const data = await fs.promises.readFile(asset.source);
          await writeBufferFileIfChanged(assetFile, data);
          const rel = toPosix(path.relative(outputDir, assetFile));
          buildStats[rel] = {
            bytes: data.length,
            hash: getCacheKey(data),
            emitter: "native",
            type: "asset",
          };
          assetFiles.push(rel);
          assetWritten.add(assetFile);
        } catch (err) {
          logWarn(`Failed to emit asset ${asset.source}: ${String(err)}`);
        }
      }
    };

    // Build chunk-level CSS (ordered, minified, deduped)
    const cssOrderStart = cssProfile ? process.hrtime.bigint() : 0n;
    const cssOrder = orderCssModules(chunk);
    if (cssProfile) {
      cssProfile.nsOrder += process.hrtime.bigint() - cssOrderStart;
      if (cssOrder.length) cssProfile.chunksWithCss += 1;
    }
    let cssFileRel: string | null = null;
    if (cssOrder.length) {
      const seenCss = new Set<string>();
      const cssPieces: string[] = [];
      for (const cssId of cssOrder) {
        if (cssProfile) cssProfile.cssModulesVisited += 1;
        let cssSource = moduleOutputs.get(cssId)?.code;
        const cssPath = idToFsPath.get(cssId) ?? null;
        if (!cssSource && cssPath && fs.existsSync(cssPath)) {
          try {
            cssSource = await fs.promises.readFile(cssPath, "utf8");
            if (cssProfile) cssProfile.cssFsFallbackReads += 1;
          } catch (err) {
            logWarn(`Failed to read CSS source ${cssId}: ${String(err)}`);
          }
        }
        if (!cssSource) continue;
        if (cssProfile) cssProfile.cssInputBytes += Buffer.byteLength(cssSource, "utf8");
        const minifyStart = cssProfile ? process.hrtime.bigint() : 0n;
        const minified = minifyCss(cssSource);
        if (cssProfile) cssProfile.nsMinify += process.hrtime.bigint() - minifyStart;
        if (!minified.length) continue;
        const key = getCacheKey(minified);
        if (seenCss.has(key)) {
          if (cssProfile) cssProfile.cssDedupedModules += 1;
          continue;
        }
        seenCss.add(key);
        cssPieces.push(minified);
      }
      if (cssPieces.length) {
        const combinedCss = cssPieces.join("\n");
        if (cssProfile) cssProfile.cssOutputBytes += Buffer.byteLength(combinedCss, "utf8");
        const cssHash = getCacheKey(combinedCss).slice(0, 8);
        const cssFileName = `assets/${chunk.id}.${cssHash}.css`;
        const cssFilePath = path.join(outputDir, cssFileName);
        const emitStart = cssProfile ? process.hrtime.bigint() : 0n;
        const cssChanged = await writeTextFileIfChanged(cssFilePath, combinedCss);
        if (cssProfile) {
          cssProfile.nsEmit += process.hrtime.bigint() - emitStart;
          if (cssChanged) cssProfile.cssFilesWritten += 1;
        }
        cssFileRel = toPosix(path.relative(outputDir, cssFilePath));
        buildStats[cssFileRel] = {
          bytes: Buffer.byteLength(combinedCss),
          hash: getCacheKey(combinedCss),
          emitter: "native",
          type: "css",
        };
        cssFiles.push(cssFileRel);
      }
    }

    for (const artifact of artifacts) {
      const nativeFile = path.join(chunkOutDir, artifact.file_name);
      let nativeCode = artifact.code;
      if (cssFileRel && !chunk.entry) {
        const absCss = path.join(outputDir, cssFileRel);
        const relCss = toPosix(path.relative(path.dirname(nativeFile), absCss));
        const inject = `(()=>{const url=new URL(${JSON.stringify(
          relCss,
        )},import.meta.url).toString();if(typeof document!=="undefined"&&!document.querySelector('link[data-ionify-css="'+url+'"]')){const l=document.createElement("link");l.rel="stylesheet";l.href=url;l.setAttribute("data-ionify-css",url);document.head.appendChild(l);}})();`;
        nativeCode = `${inject}\n${nativeCode}`;
      }
      if (enableSourceMaps && artifact.map) {
        const mapFile = `${nativeFile}.map`;
        await writeTextFileIfChanged(mapFile, artifact.map);
        nativeCode = `${nativeCode}\n//# sourceMappingURL=${path.basename(mapFile)}`;
        const relMap = toPosix(path.relative(outputDir, mapFile));
        buildStats[relMap] = {
          bytes: Buffer.byteLength(artifact.map, "utf8"),
          hash: getCacheKey(artifact.map),
          emitter: "native",
          type: "map",
        };
        jsFiles.push(relMap);
      }
      await writeTextFileIfChanged(nativeFile, nativeCode);
      const relNative = toPosix(path.relative(outputDir, nativeFile));
      buildStats[relNative] = {
        bytes: Buffer.byteLength(nativeCode, "utf8"),
        hash: getCacheKey(nativeCode),
        emitter: "native",
        type: "js",
      };
      jsFiles.push(relNative);
      await copyAssets(artifact.assets);
    }

    results.push({
      id: chunk.id,
      files: {
        js: jsFiles,
        css: cssFiles,
        assets: assetFiles,
      },
    });
  }

  if (cssProfile) {
    buildStats.__cssPipelineProfile = {
      chunksWithCss: cssProfile.chunksWithCss,
      cssModulesVisited: cssProfile.cssModulesVisited,
      cssFsFallbackReads: cssProfile.cssFsFallbackReads,
      cssDedupedModules: cssProfile.cssDedupedModules,
      cssFilesWritten: cssProfile.cssFilesWritten,
      cssInputBytes: cssProfile.cssInputBytes,
      cssOutputBytes: cssProfile.cssOutputBytes,
      orderMs: nsToMs(cssProfile.nsOrder),
      minifyMs: nsToMs(cssProfile.nsMinify),
      emitMs: nsToMs(cssProfile.nsEmit),
    };
    console.error(
      `[BundlerProfile][css] chunks=${cssProfile.chunksWithCss} modules=${cssProfile.cssModulesVisited} fs_reads=${cssProfile.cssFsFallbackReads} deduped=${cssProfile.cssDedupedModules} writes=${cssProfile.cssFilesWritten} order_ms=${nsToMs(
        cssProfile.nsOrder,
      ).toFixed(2)} minify_ms=${nsToMs(cssProfile.nsMinify).toFixed(2)} emit_ms=${nsToMs(
        cssProfile.nsEmit,
      ).toFixed(2)} bytes_in=${cssProfile.cssInputBytes} bytes_out=${cssProfile.cssOutputBytes}`,
    );
  }

  return { artifacts: results, stats: buildStats };
}

export async function writeAssetsManifest(
  outputDir: string,
  artifacts: Array<{ id: string; files: ChunkFiles }>,
): Promise<EmittedOutputInfo> {
  const dir = path.resolve(outputDir);
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, "manifest.assets.json");
  const payload = {
    chunks: artifacts,
  };
  const contents = JSON.stringify(payload, null, 2);
  await writeTextFileIfChanged(file, contents);
  return {
    file: toPosix(path.relative(dir, file)),
    bytes: Buffer.byteLength(contents, "utf8"),
    hash: getCacheKey(contents),
  };
}



// ===== Next Phase TODOs =====
// Phase 3: Implement full Rust bundling logic.
// Phase 4: Add plugin pipeline integration.
// Phase 5: Feed build statistics to Analyzer.
