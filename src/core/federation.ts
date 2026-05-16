import fs from "fs";
import path from "path";
import { getCacheKey } from "@core/cache";
import { normalizeConfiguredExternalSpecifiers } from "@core/external-policy";
import { toWsModuleId } from "@core/module-id";
import type {
  IonifyConfig,
  IonifyFederationRemoteConfig,
  IonifyFederationSharedConfig,
} from "@core/types/config";
import type { BuildPlan } from "../types/plan";

type ChunkFiles = { js: string[]; css: string[]; assets: string[] };

export interface FederationBuildManifest {
  version: 1;
  host: {
    name: string;
    entryIds: string[];
    entryChunkIds: string[];
    contractHash: string;
  };
  container?: FederationContainerManifest;
  remotes: Record<string, FederationRemoteManifest>;
  exposes: Record<string, FederationExposeManifest>;
  shared: Record<string, FederationSharedManifest>;
}

interface FederationVersionContract {
  host: string | null;
  remotes: Array<{
    name: string;
    entry: string;
    external: string[];
    version: string | null;
    integrity: string | null;
    hash: string | null;
  }>;
  exposes: Array<{
    name: string;
    source: string;
  }>;
  shared: Array<{
    name: string;
    singleton: boolean;
    requiredVersion: string | null;
    version: string | null;
    strictVersion: boolean;
    eager: boolean;
    shareScope: string | null;
  }>;
}

interface FederationRemoteManifest {
  entry: string;
  external: string[];
  format: "esm";
  version?: string;
  integrity?: string;
  hash: string;
  contractHash: string;
}

interface FederationExposeManifest {
  source: string;
  id: string;
  artifactHash?: string;
  entryChunkId?: string;
  entryFile?: string;
  entryNamespace?: string;
  chunkIds: string[];
  files: ChunkFiles;
  contractHash: string;
}

interface FederationSharedManifest {
  singleton: boolean;
  requiredVersion?: string;
  providedVersion?: string;
  strictVersion: boolean;
  eager: boolean;
  shareScope: string;
  contractHash: string;
}

export interface FederationContainerManifest {
  entry: string;
  format: "esm";
  exposes: string[];
  shareScopes: string[];
  contractHash: string;
}

export interface FederationContainerBuildSpec {
  moduleId: string;
  chunkId: string;
  entry: string;
  source: string;
  contractHash: string;
}

export interface FederationPersistedGraphNode {
  id: string;
  hash: string | null;
  deps: string[];
  dynamicDeps?: string[];
  kind: string;
}

export interface FederationRemoteImportBinding {
  remoteName: string;
  appNodeId: string;
  externalSpecifiers: string[];
}

export const FEDERATION_GRAPH_PREFIX = "ionify:federation:";
const FEDERATION_GRAPH_KIND_REMOTE_APP = "remote_app";
const FEDERATION_GRAPH_KIND_REMOTE_MANIFEST = "remote_manifest";
const FEDERATION_GRAPH_KIND_REMOTE_EXPOSE = "remote_expose";
const FEDERATION_GRAPH_KIND_REMOTE_SHARED_DEP = "remote_shared_dep";

function readProjectPackageJson(rootDir: string): any | null {
  const filePath = path.join(rootDir, "package.json");
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeRemoteConfig(
  remoteName: string,
  remoteConfig: string | IonifyFederationRemoteConfig,
): IonifyFederationRemoteConfig {
  if (typeof remoteConfig === "string") {
    return { entry: remoteConfig, external: remoteName };
  }
  return {
    ...remoteConfig,
    external: remoteConfig.external ?? remoteName,
  };
}

function normalizeSharedConfig(
  sharedConfig: boolean | IonifyFederationSharedConfig | undefined,
) : IonifyFederationSharedConfig | null {
  if (sharedConfig === true || sharedConfig === undefined) {
    return {};
  }
  if (sharedConfig === false) {
    return null;
  }
  return sharedConfig;
}

function mergeChunkFiles(target: ChunkFiles, next: ChunkFiles): ChunkFiles {
  return {
    js: Array.from(new Set([...target.js, ...next.js])),
    css: Array.from(new Set([...target.css, ...next.css])),
    assets: Array.from(new Set([...target.assets, ...next.assets])),
  };
}

function relativeToRoot(rootDir: string, targetPath: string): string {
  const relative = path.relative(rootDir, targetPath).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function relativeToOutDir(outDir: string, targetPath: string): string {
  return path.relative(outDir, targetPath).split(path.sep).join("/");
}

function toPosixRelative(target: string): string {
  const normalized = target.split(path.sep).join("/");
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

function toPosixPath(target: string): string {
  return target.split(path.sep).join("/");
}

function synthNamespaceExportName(moduleId: string): string {
  return `__ionify_ns_${getCacheKey(moduleId).slice(0, 8)}`;
}

function federationGraphNodeId(kind: string, appName: string, key?: string): string {
  const parts = [FEDERATION_GRAPH_PREFIX, kind, ":", encodeURIComponent(appName)];
  if (typeof key === "string" && key.length > 0) {
    parts.push(":", encodeURIComponent(key));
  }
  return parts.join("");
}

function resolveFederationHostName(config: IonifyConfig | null, rootDir: string): string {
  const packageJson = readProjectPackageJson(rootDir);
  const packageName =
    typeof packageJson?.name === "string" && packageJson.name.trim().length > 0
      ? packageJson.name.trim()
      : path.basename(rootDir);
  return typeof config?.federation?.host === "string" && config.federation.host.trim().length > 0
    ? config.federation.host.trim()
    : packageName;
}

function buildFederationSharedContractHash(sharedName: string, appName: string, entry: FederationSharedManifest): string {
  return getCacheKey(
    JSON.stringify({
      sharedName,
      appName,
      singleton: entry.singleton,
      requiredVersion: entry.requiredVersion ?? null,
      providedVersion: entry.providedVersion ?? null,
      strictVersion: entry.strictVersion,
      eager: entry.eager,
      shareScope: entry.shareScope,
    }),
  );
}

function federationContainerChunkId(contractHash: string): string {
  return `federation-container-${contractHash.slice(0, 12)}`;
}

function federationContainerEntryFile(chunkId: string): string {
  return `chunks/${chunkId}/${chunkId}.native.js`;
}

function federationContainerVirtualModuleId(outDir: string, contractHash: string): string {
  void outDir;
  return `ionify:virtual-module:container.${contractHash.slice(0, 12)}.mjs`;
}

export function buildFederationVersionContract(
  federation: IonifyConfig["federation"] | undefined,
): FederationVersionContract | null {
  if (!federation) return null;

  const remotes = Object.entries(federation.remotes ?? {})
    .map(([remoteName, remoteConfig]) => {
      const normalized = normalizeRemoteConfig(remoteName, remoteConfig);
      return {
        name: remoteName,
        entry: normalized.entry,
        external: normalizeConfiguredExternalSpecifiers(normalized.external ?? remoteName),
        version: normalized.version ?? null,
        integrity: normalized.integrity ?? null,
        hash: normalized.hash ?? null,
      };
    })
    .filter((remote) => typeof remote.entry === "string" && remote.entry.trim().length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  const exposes = Object.entries(federation.exposes ?? {})
    .filter(([, exposeSource]) => typeof exposeSource === "string" && exposeSource.trim().length > 0)
    .map(([exposeName, exposeSource]) => ({
      name: exposeName,
      source: exposeSource,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const shared = Object.entries(federation.shared ?? {})
    .map(([sharedName, sharedConfigRaw]) => {
      const sharedConfig = normalizeSharedConfig(sharedConfigRaw);
      if (!sharedConfig) return null;
      return {
        name: sharedName,
        singleton: sharedConfig.singleton === true,
        requiredVersion:
          typeof sharedConfig.requiredVersion === "string" && sharedConfig.requiredVersion.trim().length > 0
            ? sharedConfig.requiredVersion.trim()
            : null,
        version:
          typeof sharedConfig.version === "string" && sharedConfig.version.trim().length > 0
            ? sharedConfig.version.trim()
            : null,
        strictVersion: sharedConfig.strictVersion === true,
        eager: sharedConfig.eager === true,
        shareScope:
          typeof sharedConfig.shareScope === "string" && sharedConfig.shareScope.trim().length > 0
            ? sharedConfig.shareScope.trim()
            : null,
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    host:
      typeof federation.host === "string" && federation.host.trim().length > 0
        ? federation.host.trim()
        : null,
    remotes,
    exposes,
    shared,
  };
}

export function isFederationGraphNodeId(id: string): boolean {
  return typeof id === "string" && id.startsWith(FEDERATION_GRAPH_PREFIX);
}

export function collectFederationRemoteImportBindings(
  config: IonifyConfig | null,
  rootDir: string,
): FederationRemoteImportBinding[] {
  const federation = config?.federation;
  if (!federation?.remotes || typeof federation.remotes !== "object") return [];

  const hostName = resolveFederationHostName(config, rootDir);
  void hostName;
  return Object.entries(federation.remotes)
    .map(([remoteName, remoteConfig]) => {
      const normalized = normalizeRemoteConfig(remoteName, remoteConfig);
      const externalSpecifiers = normalizeConfiguredExternalSpecifiers(normalized.external ?? remoteName);
      if (externalSpecifiers.length === 0) return null;
      return {
        remoteName,
        appNodeId: federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_APP, remoteName),
        externalSpecifiers,
      } satisfies FederationRemoteImportBinding;
    })
    .filter((binding): binding is FederationRemoteImportBinding => binding !== null)
    .sort((a, b) => a.remoteName.localeCompare(b.remoteName));
}

export function rewriteFederationGraphEdgeIds(
  deps: string[],
  bindings: readonly FederationRemoteImportBinding[],
): string[] {
  if (!Array.isArray(deps) || deps.length === 0 || bindings.length === 0) return Array.from(new Set(deps));
  const out = new Set<string>();
  for (const dep of deps) {
    let rewritten = dep;
    for (const binding of bindings) {
      if (binding.externalSpecifiers.some((specifier) =>
        dep === specifier || dep.startsWith(`${specifier}/`),
      )) {
        rewritten = binding.appNodeId;
        break;
      }
    }
    out.add(rewritten);
  }
  return Array.from(out);
}

export function buildFederationConfigGraphNodes(
  config: IonifyConfig | null,
  rootDir: string,
): FederationPersistedGraphNode[] {
  const federation = config?.federation;
  if (!federation) return [];

  const hostName = resolveFederationHostName(config, rootDir);
  const nodes = new Map<string, FederationPersistedGraphNode>();
  const sharedEntries: Record<string, FederationSharedManifest> = {};
  for (const [sharedName, sharedConfigRaw] of Object.entries(federation.shared ?? {})) {
    const sharedConfig = normalizeSharedConfig(sharedConfigRaw);
    if (!sharedConfig) continue;
    const entry: FederationSharedManifest = {
      singleton: sharedConfig.singleton === true,
      requiredVersion:
        typeof sharedConfig.requiredVersion === "string" && sharedConfig.requiredVersion.trim().length > 0
          ? sharedConfig.requiredVersion.trim()
          : undefined,
      providedVersion:
        typeof sharedConfig.version === "string" && sharedConfig.version.trim().length > 0
          ? sharedConfig.version.trim()
          : undefined,
      strictVersion: sharedConfig.strictVersion === true,
      eager: sharedConfig.eager === true,
      shareScope:
        typeof sharedConfig.shareScope === "string" && sharedConfig.shareScope.trim().length > 0
          ? sharedConfig.shareScope.trim()
          : "default",
      contractHash: "",
    };
    entry.contractHash = buildFederationSharedContractHash(sharedName, hostName, entry);
    sharedEntries[sharedName] = entry;
  }

  const localExposeNodeIds: string[] = [];
  for (const [exposeKey, exposeSource] of Object.entries(federation.exposes ?? {})) {
    if (typeof exposeSource !== "string" || exposeSource.trim().length === 0) continue;
    const sourcePath = exposeSource.startsWith("/")
      ? path.join(rootDir, exposeSource)
      : path.resolve(rootDir, exposeSource);
    const source = relativeToRoot(rootDir, sourcePath);
    const hash = getCacheKey(JSON.stringify({ app: hostName, exposeKey, source }));
    const nodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_EXPOSE, hostName, exposeKey);
    nodes.set(nodeId, {
      id: nodeId,
      hash,
      deps: [],
      dynamicDeps: [],
      kind: FEDERATION_GRAPH_KIND_REMOTE_EXPOSE,
    });
    localExposeNodeIds.push(nodeId);
  }

  const localSharedNodeIds: string[] = [];
  for (const [sharedName, entry] of Object.entries(sharedEntries)) {
    const nodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_SHARED_DEP, hostName, sharedName);
    nodes.set(nodeId, {
      id: nodeId,
      hash: entry.contractHash,
      deps: [],
      dynamicDeps: [],
      kind: FEDERATION_GRAPH_KIND_REMOTE_SHARED_DEP,
    });
    localSharedNodeIds.push(nodeId);
  }

  if (localExposeNodeIds.length > 0 || localSharedNodeIds.length > 0) {
    const manifestNodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_MANIFEST, hostName);
    const manifestHash = getCacheKey(
      JSON.stringify({
        hostName,
        exposes: localExposeNodeIds,
        shared: localSharedNodeIds,
      }),
    );
    nodes.set(manifestNodeId, {
      id: manifestNodeId,
      hash: manifestHash,
      deps: [],
      dynamicDeps: [],
      kind: FEDERATION_GRAPH_KIND_REMOTE_MANIFEST,
    });
    const appNodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_APP, hostName);
    nodes.set(appNodeId, {
      id: appNodeId,
      hash: getCacheKey(JSON.stringify({ hostName, manifestHash })),
      deps: [manifestNodeId, ...localExposeNodeIds, ...localSharedNodeIds],
      dynamicDeps: [],
      kind: FEDERATION_GRAPH_KIND_REMOTE_APP,
    });
  }

  for (const [remoteName, remoteConfig] of Object.entries(federation.remotes ?? {})) {
    const normalized = normalizeRemoteConfig(remoteName, remoteConfig);
    if (typeof normalized.entry !== "string" || normalized.entry.trim().length === 0) continue;
    const external = normalizeConfiguredExternalSpecifiers(normalized.external ?? remoteName);
    const manifestNodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_MANIFEST, remoteName);
    const manifestHash = getCacheKey(
      JSON.stringify({
        remoteName,
        entry: normalized.entry,
        external,
        version: normalized.version ?? null,
        integrity: normalized.integrity ?? null,
        hash: normalized.hash ?? null,
      }),
    );
    nodes.set(manifestNodeId, {
      id: manifestNodeId,
      hash: manifestHash,
      deps: [],
      dynamicDeps: [],
      kind: FEDERATION_GRAPH_KIND_REMOTE_MANIFEST,
    });

    const remoteSharedNodeIds: string[] = [];
    for (const [sharedName, entry] of Object.entries(sharedEntries)) {
      const sharedNodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_SHARED_DEP, remoteName, sharedName);
      nodes.set(sharedNodeId, {
        id: sharedNodeId,
        hash: buildFederationSharedContractHash(sharedName, remoteName, entry),
        deps: [],
        dynamicDeps: [],
        kind: FEDERATION_GRAPH_KIND_REMOTE_SHARED_DEP,
      });
      remoteSharedNodeIds.push(sharedNodeId);
    }

    const appNodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_APP, remoteName);
    nodes.set(appNodeId, {
      id: appNodeId,
      hash: getCacheKey(JSON.stringify({ remoteName, manifestHash, external })),
      deps: [manifestNodeId, ...remoteSharedNodeIds],
      dynamicDeps: [],
      kind: FEDERATION_GRAPH_KIND_REMOTE_APP,
    });
  }

  return Array.from(nodes.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export function buildFederationManifestGraphNodes(
  manifest: FederationBuildManifest | null | undefined,
): FederationPersistedGraphNode[] {
  if (!manifest?.host?.name) return [];

  const nodes = new Map<string, FederationPersistedGraphNode>();
  const hostName = manifest.host.name;
  const localManifestNodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_MANIFEST, hostName);
  const localExposeNodeIds: string[] = [];
  const localSharedNodeIds: string[] = [];

  for (const [exposeKey, expose] of Object.entries(manifest.exposes ?? {})) {
    const nodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_EXPOSE, hostName, exposeKey);
    nodes.set(nodeId, {
      id: nodeId,
      hash: expose.contractHash,
      deps: [],
      dynamicDeps: [],
      kind: FEDERATION_GRAPH_KIND_REMOTE_EXPOSE,
    });
    localExposeNodeIds.push(nodeId);
  }

  for (const [sharedName, shared] of Object.entries(manifest.shared ?? {})) {
    const nodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_SHARED_DEP, hostName, sharedName);
    nodes.set(nodeId, {
      id: nodeId,
      hash: shared.contractHash,
      deps: [],
      dynamicDeps: [],
      kind: FEDERATION_GRAPH_KIND_REMOTE_SHARED_DEP,
    });
    localSharedNodeIds.push(nodeId);
  }

  nodes.set(localManifestNodeId, {
    id: localManifestNodeId,
    hash: getCacheKey(
      JSON.stringify({
        host: manifest.host.contractHash,
        container: manifest.container?.contractHash ?? null,
      }),
    ),
    deps: [],
    dynamicDeps: [],
    kind: FEDERATION_GRAPH_KIND_REMOTE_MANIFEST,
  });

  const localAppNodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_APP, hostName);
  nodes.set(localAppNodeId, {
    id: localAppNodeId,
    hash: manifest.container?.contractHash ?? manifest.host.contractHash,
    deps: [localManifestNodeId, ...localExposeNodeIds, ...localSharedNodeIds],
    dynamicDeps: [],
    kind: FEDERATION_GRAPH_KIND_REMOTE_APP,
  });

  for (const [remoteName, remote] of Object.entries(manifest.remotes ?? {})) {
    const manifestNodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_MANIFEST, remoteName);
    nodes.set(manifestNodeId, {
      id: manifestNodeId,
      hash: remote.contractHash,
      deps: [],
      dynamicDeps: [],
      kind: FEDERATION_GRAPH_KIND_REMOTE_MANIFEST,
    });
    const appNodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_APP, remoteName);
    nodes.set(appNodeId, {
      id: appNodeId,
      hash: remote.hash ?? remote.contractHash,
      deps: [manifestNodeId],
      dynamicDeps: [],
      kind: FEDERATION_GRAPH_KIND_REMOTE_APP,
    });
  }

  return Array.from(nodes.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export function collectFederationExposeEntryPaths(
  config: IonifyConfig | null,
  rootDir: string,
): string[] {
  const federation = config?.federation;
  if (!federation?.exposes || typeof federation.exposes !== "object") return [];

  const paths = Object.values(federation.exposes)
    .filter((exposeSource): exposeSource is string => typeof exposeSource === "string" && exposeSource.trim().length > 0)
    .map((exposeSource) =>
      exposeSource.startsWith("/")
        ? path.join(rootDir, exposeSource)
        : path.resolve(rootDir, exposeSource),
    );

  return Array.from(new Set(paths)).sort((a, b) => a.localeCompare(b));
}

export function buildFederationBuildManifest(options: {
  config: IonifyConfig | null;
  rootDir: string;
  workspaceRoot: string;
  outDir: string;
  plan: BuildPlan;
  artifacts: Array<{ id: string; files: ChunkFiles }>;
  hostEntryIds: string[];
}): FederationBuildManifest | null {
  const { config, rootDir, workspaceRoot, outDir, plan, artifacts, hostEntryIds } = options;
  const federation = config?.federation;
  if (!federation) return null;

  const filesByChunk = new Map<string, ChunkFiles>();
  for (const artifact of artifacts) {
    filesByChunk.set(artifact.id, artifact.files);
  }

  const packageJson = readProjectPackageJson(rootDir);
  const packageName =
    typeof packageJson?.name === "string" && packageJson.name.trim().length > 0
      ? packageJson.name.trim()
      : path.basename(rootDir);
  const hostName =
    typeof federation.host === "string" && federation.host.trim().length > 0
      ? federation.host.trim()
      : packageName;

  const hostEntryIdSet = new Set(hostEntryIds);
  const entryChunkIds = plan.chunks
    .filter((chunk) => chunk.entry && chunk.consumers.some((consumer) => hostEntryIdSet.has(consumer)))
    .map((chunk) => chunk.id);
  const hostContractHash = getCacheKey(
    JSON.stringify({
      hostName,
      entryIds: hostEntryIds,
      entryChunkIds,
    }),
  );

  const remoteManifestEntries: Record<string, FederationRemoteManifest> = {};
  for (const [remoteName, remoteConfig] of Object.entries(federation.remotes ?? {})) {
    const normalized = normalizeRemoteConfig(remoteName, remoteConfig);
    if (typeof normalized.entry !== "string" || normalized.entry.trim().length === 0) continue;
    const external = normalizeConfiguredExternalSpecifiers(normalized.external ?? remoteName);
    const contractHash = getCacheKey(
      JSON.stringify({
        remoteName,
        entry: normalized.entry,
        external,
        version: normalized.version ?? null,
        integrity: normalized.integrity ?? null,
      }),
    );
    remoteManifestEntries[remoteName] = {
      entry: normalized.entry,
      external,
      format: "esm",
      version: normalized.version,
      integrity: normalized.integrity,
      hash: normalized.hash ?? contractHash,
      contractHash,
    };
  }

  const exposeManifestEntries: Record<string, FederationExposeManifest> = {};
  for (const [exposeName, exposeSource] of Object.entries(federation.exposes ?? {})) {
    if (typeof exposeSource !== "string" || exposeSource.trim().length === 0) continue;
    const absPath = exposeSource.startsWith("/")
      ? path.join(rootDir, exposeSource)
      : path.resolve(rootDir, exposeSource);
    const moduleId = toWsModuleId(absPath, workspaceRoot);
    if (!moduleId) continue;

    let artifactHash: string | undefined;
    const chunkIds: string[] = [];
    let files: ChunkFiles = { js: [], css: [], assets: [] };
    let entryChunkId: string | undefined;
    let entryFile: string | undefined;
    const entryNamespace = synthNamespaceExportName(moduleId);

    for (const chunk of plan.chunks) {
      const matchedModule = chunk.modules.find((mod) => mod.id === moduleId);
      if (!matchedModule) continue;
      chunkIds.push(chunk.id);
      artifactHash = artifactHash ?? matchedModule.hash ?? undefined;
      const chunkFiles = filesByChunk.get(chunk.id) ?? { js: [], css: [], assets: [] };
      files = mergeChunkFiles(files, chunkFiles);
      if (!entryChunkId || chunk.entry) {
        entryChunkId = chunk.id;
        entryFile = chunkFiles.js[0] ?? entryFile;
      }
    }

    const contractHash = getCacheKey(
      JSON.stringify({
        exposeName,
        source: relativeToRoot(rootDir, absPath),
        id: moduleId,
        artifactHash: artifactHash ?? null,
        entryChunkId: entryChunkId ?? null,
        entryFile: entryFile ?? null,
        entryNamespace,
        chunkIds: chunkIds.slice().sort(),
      }),
    );

    exposeManifestEntries[exposeName] = {
      source: relativeToRoot(rootDir, absPath),
      id: moduleId,
      artifactHash,
      entryChunkId,
      entryFile,
      entryNamespace,
      chunkIds: Array.from(new Set(chunkIds)).sort(),
      files,
      contractHash,
    };
  }

  const dependencyVersions = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.peerDependencies ?? {}),
    ...(packageJson?.optionalDependencies ?? {}),
  } as Record<string, string>;

  const sharedManifestEntries: Record<string, FederationSharedManifest> = {};
  for (const [sharedName, sharedConfigRaw] of Object.entries(federation.shared ?? {})) {
    const sharedConfig = normalizeSharedConfig(sharedConfigRaw);
    if (!sharedConfig) continue;
    const providedVersion =
      typeof sharedConfig.version === "string" && sharedConfig.version.trim().length > 0
        ? sharedConfig.version.trim()
        : typeof dependencyVersions[sharedName] === "string"
          ? dependencyVersions[sharedName]
          : undefined;
    const requiredVersion =
      typeof sharedConfig.requiredVersion === "string" && sharedConfig.requiredVersion.trim().length > 0
        ? sharedConfig.requiredVersion.trim()
        : providedVersion;
    const singleton = sharedConfig.singleton === true;
    const strictVersion = sharedConfig.strictVersion === true;
    const eager = sharedConfig.eager === true;
    const shareScope =
      typeof sharedConfig.shareScope === "string" && sharedConfig.shareScope.trim().length > 0
        ? sharedConfig.shareScope.trim()
        : "default";
    const contractHash = getCacheKey(
      JSON.stringify({
        sharedName,
        singleton,
        requiredVersion: requiredVersion ?? null,
        providedVersion: providedVersion ?? null,
        strictVersion,
        eager,
        shareScope,
      }),
    );

    sharedManifestEntries[sharedName] = {
      singleton,
      requiredVersion,
      providedVersion,
      strictVersion,
      eager,
      shareScope,
      contractHash,
    };
  }

  const shareScopes = Array.from(
    new Set(Object.values(sharedManifestEntries).map((entry) => entry.shareScope).filter(Boolean)),
  ).sort();
  const containerExposes = Object.keys(exposeManifestEntries).sort();
  const containerContractHash = getCacheKey(
    JSON.stringify({
      hostName,
      exposes: containerExposes.map((key) => ({
        key,
        entryFile: exposeManifestEntries[key]?.entryFile ?? null,
        files: exposeManifestEntries[key]?.files ?? { js: [], css: [], assets: [] },
      })),
      shareScopes,
    }),
  );
  const containerChunkId =
    containerExposes.length > 0
      ? federationContainerChunkId(containerContractHash)
      : undefined;
  const containerEntry =
    containerChunkId
      ? toPosixRelative(federationContainerEntryFile(containerChunkId))
      : undefined;

  return {
    version: 1,
    host: {
      name: hostName,
      entryIds: hostEntryIds,
      entryChunkIds,
      contractHash: hostContractHash,
    },
    container:
      containerEntry
        ? {
            entry: containerEntry,
            format: "esm",
            exposes: containerExposes,
            shareScopes,
            contractHash: containerContractHash,
          }
        : undefined,
    remotes: remoteManifestEntries,
    exposes: exposeManifestEntries,
    shared: sharedManifestEntries,
  };
}

export function renderFederationContainerModule(manifest: FederationBuildManifest): string {
  const container = manifest.container;
  if (!container) {
    throw new Error("Federation container metadata is required to render a remote container module");
  }

  const containerDir = path.posix.dirname(container.entry);
  const relativeFromContainer = (target: string): string => {
    const relative = path.posix.relative(containerDir, target);
    return relative.startsWith(".") ? relative : `./${relative}`;
  };

  const exposes = Object.fromEntries(
    Object.entries(manifest.exposes)
      .filter(([, entry]) => typeof entry.entryFile === "string" && entry.entryFile.length > 0)
      .map(([key, entry]) => [
        key,
        {
          id: entry.id,
          entryFile: relativeFromContainer(entry.entryFile!),
          entryNamespace: entry.entryNamespace ?? null,
          files: {
            js: entry.files.js.map(relativeFromContainer),
            css: entry.files.css.map(relativeFromContainer),
            assets: entry.files.assets.map(relativeFromContainer),
          },
          contractHash: entry.contractHash,
        },
      ]),
  );

  const shared = Object.fromEntries(
    Object.entries(manifest.shared).map(([key, entry]) => [
      key,
      {
        singleton: entry.singleton,
        requiredVersion: entry.requiredVersion ?? null,
        providedVersion: entry.providedVersion ?? null,
        strictVersion: entry.strictVersion,
        eager: entry.eager,
        shareScope: entry.shareScope,
        contractHash: entry.contractHash,
      },
    ]),
  );

  const payload = JSON.stringify(
    {
      version: manifest.version,
      host: manifest.host,
      container,
      exposes,
      shared,
    },
    null,
    2,
  );

  return `const __ionify_container = ${payload};
const __ionify_scope_state = new Map();

function __ionify_to_absolute(target) {
  try {
    return new URL(target).toString();
  } catch {}
  const registry = globalThis && typeof globalThis === "object"
    ? globalThis.__IONIFY_FEDERATION_CONTAINER_BASE_URLS__
    : undefined;
  const registeredBase =
    registry && typeof registry === "object"
      ? registry[__ionify_container.container.contractHash]
      : undefined;
  const fallbackBase =
    typeof registeredBase === "string" && registeredBase.length > 0
      ? registeredBase
      : typeof document !== "undefined" &&
          document.currentScript &&
          typeof document.currentScript.src === "string" &&
          document.currentScript.src.length > 0
        ? document.currentScript.src
        : typeof location !== "undefined" && typeof location.href === "string" && location.href.length > 0
          ? location.href
          : null;
  if (!fallbackBase) {
    throw new Error("Ionify federation container base URL is unavailable");
  }
  return new URL(target, fallbackBase).toString();
}

function __ionify_append_module_preload(href) {
  if (typeof document === "undefined") return;
  const existing = document.querySelector(\`link[rel="modulepreload"][href="\${href}"]\`);
  if (existing) return;
  const link = document.createElement("link");
  link.rel = "modulepreload";
  link.href = href;
  document.head.appendChild(link);
}

function __ionify_append_stylesheet(href) {
  if (typeof document === "undefined") return;
  const existing = document.querySelector(\`link[rel="stylesheet"][href="\${href}"]\`);
  if (existing) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function __ionify_set_scope(scopeName, scopeValue) {
  if (!scopeValue || typeof scopeValue !== "object") return;
  __ionify_scope_state.set(scopeName, { ...scopeValue });
}

async function __ionify_preload_expose(entry) {
  for (const href of entry.files.js || []) __ionify_append_module_preload(__ionify_to_absolute(href));
  for (const href of entry.files.css || []) __ionify_append_stylesheet(__ionify_to_absolute(href));
}

async function __ionify_import_expose(entry) {
  await __ionify_preload_expose(entry);
  const mod = await import(/* @vite-ignore */ __ionify_to_absolute(entry.entryFile));
  if (entry.entryNamespace && mod && typeof mod === "object" && entry.entryNamespace in mod) {
    return mod[entry.entryNamespace];
  }
  return mod;
}

export async function init(sharedScopes = {}) {
  __ionify_scope_state.clear();
  for (const [scopeName, scopeValue] of Object.entries(sharedScopes || {})) {
    __ionify_set_scope(scopeName, scopeValue);
  }
  return Object.fromEntries(__ionify_scope_state.entries());
}

export async function get(exposeKey) {
  const expose = __ionify_container.exposes[exposeKey];
  if (!expose || !expose.entryFile) {
    throw new Error(\`Ionify federation expose not found: \${String(exposeKey)}\`);
  }
  return async () => __ionify_import_expose(expose);
}

export function describe() {
  return {
    version: __ionify_container.version,
    host: __ionify_container.host,
    container: __ionify_container.container,
    exposes: Object.keys(__ionify_container.exposes),
    shared: __ionify_container.shared,
    scopes: Object.fromEntries(__ionify_scope_state.entries()),
  };
}

export default {
  init,
  get,
  describe,
};
`;
}

export function buildFederationContainerBuildSpec(
  manifest: FederationBuildManifest,
  outDir: string,
): FederationContainerBuildSpec | null {
  const container = manifest.container;
  if (!container?.entry) return null;
  return {
    moduleId: federationContainerVirtualModuleId(outDir, container.contractHash),
    chunkId: federationContainerChunkId(container.contractHash),
    entry: container.entry,
    source: renderFederationContainerModule(manifest),
    contractHash: container.contractHash,
  };
}
