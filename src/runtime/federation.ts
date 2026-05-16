export type IonifyChunkFiles = {
  js: string[];
  css: string[];
  assets: string[];
};

export type IonifyFederationExposeEntry = {
  source: string;
  id: string;
  artifactHash?: string;
  entryChunkId?: string;
  entryFile?: string;
  entryNamespace?: string;
  chunkIds: string[];
  files: IonifyChunkFiles;
  contractHash: string;
};

export type IonifyFederationRemoteEntry = {
  entry: string;
  external: string[];
  format: "esm";
  version?: string;
  integrity?: string;
  hash: string;
  contractHash: string;
};

export type IonifyFederationSharedEntry = {
  singleton: boolean;
  requiredVersion?: string;
  providedVersion?: string;
  strictVersion: boolean;
  eager: boolean;
  shareScope: string;
  contractHash: string;
};

export type IonifyFederationBuildSection = {
  version: 1;
  host: {
    name: string;
    entryIds: string[];
    entryChunkIds: string[];
    contractHash: string;
  };
  container?: {
    entry: string;
    format: "esm";
    exposes: string[];
    shareScopes: string[];
    contractHash: string;
  };
  remotes: Record<string, IonifyFederationRemoteEntry>;
  exposes: Record<string, IonifyFederationExposeEntry>;
  shared: Record<string, IonifyFederationSharedEntry>;
};

export type IonifyBuildManifest = {
  entries: string[];
  chunks: Array<{
    id: string;
    entry: boolean;
    shared: boolean;
    consumers: string[];
    modules: Array<{
      id: string;
      kind: string;
      deps: string[];
      dynamicDeps: string[];
      artifactHash?: string;
    }>;
    files: IonifyChunkFiles;
  }>;
  federation?: IonifyFederationBuildSection;
};

export type IonifyRemoteManifestHandle = {
  entryUrl: string;
  manifestUrl: string;
  baseUrl: string;
  manifest: IonifyBuildManifest;
};

export type IonifyRemoteExposeHandle = {
  remote: IonifyRemoteManifestHandle;
  exposeKey: string;
  expose: IonifyFederationExposeEntry;
  urls: IonifyChunkFiles;
};

export type IonifyFederationSharedModule = {
  version?: string;
  singleton?: boolean;
  eager?: boolean;
  get?: () => Promise<unknown> | unknown;
  module?: unknown;
};

export type IonifyFederationSharedRegistration =
  | IonifyFederationSharedModule
  | IonifyFederationSharedModule[];

export type IonifyFederationShareScopes = Record<string, Record<string, IonifyFederationSharedRegistration>>;

type NegotiatedFederationSharedModule = IonifyFederationSharedModule & {
  version?: string;
  singleton: boolean;
  eager: boolean;
};

type NegotiatedFederationShareScopes = Record<string, Record<string, NegotiatedFederationSharedModule>>;

export type IonifyFederationContainerModule = {
  init?: (sharedScopes?: IonifyFederationShareScopes) => Promise<void> | void;
  get: (exposeKey: string) => Promise<() => Promise<unknown>> | (() => Promise<unknown>);
  describe?: () => unknown;
};

export type IonifyRemoteContainerHandle = {
  remote: IonifyRemoteManifestHandle;
  entryUrl: string;
  container: IonifyFederationContainerModule;
};

export interface IonifyFederationFetchOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  cache?: boolean;
}

export interface IonifyFederationContainerLoadOptions extends IonifyFederationFetchOptions {
  sharedScopes?: IonifyFederationShareScopes;
}

export interface IonifyFederationHostRuntime {
  getRemoteManifest(
    remote: string | { entry: string },
    options?: IonifyFederationFetchOptions,
  ): Promise<IonifyRemoteManifestHandle>;
  resolveRemoteExpose(
    remote: IonifyRemoteManifestHandle,
    exposeKey: string,
  ): IonifyRemoteExposeHandle;
  preloadRemoteExpose(
    remote: IonifyRemoteManifestHandle,
    exposeKey: string,
  ): Promise<IonifyRemoteExposeHandle>;
  getRemoteContainer(
    remote: string | { entry: string } | IonifyRemoteManifestHandle,
    options?: IonifyFederationContainerLoadOptions,
  ): Promise<IonifyRemoteContainerHandle>;
  loadRemoteExposeModule<TModule = Record<string, unknown>>(
    remote: string | { entry: string } | IonifyRemoteManifestHandle,
    exposeKey: string,
    options?: IonifyFederationContainerLoadOptions,
  ): Promise<TModule>;
  loadRemoteModule<TModule = Record<string, unknown>>(
    moduleUrl: string,
  ): Promise<TModule>;
  clear(): void;
}

type RuntimeCache = {
  manifests: Map<string, Promise<IonifyRemoteManifestHandle>>;
  containers: Map<string, Promise<IonifyRemoteContainerHandle>>;
  modules: Map<string, Promise<unknown>>;
};

declare global {
  var __IONIFY_FEDERATION_RUNTIME_CACHE__: RuntimeCache | undefined;
  var __IONIFY_FEDERATION_CONTAINER_BASE_URLS__: Record<string, string> | undefined;
}

function runtimeCache(): RuntimeCache {
  const target = globalThis as typeof globalThis & {
    __IONIFY_FEDERATION_RUNTIME_CACHE__?: RuntimeCache;
  };
  if (!target.__IONIFY_FEDERATION_RUNTIME_CACHE__) {
    target.__IONIFY_FEDERATION_RUNTIME_CACHE__ = {
      manifests: new Map(),
      containers: new Map(),
      modules: new Map(),
    };
  }
  return target.__IONIFY_FEDERATION_RUNTIME_CACHE__;
}

function ensureFetch(fetchImpl?: typeof fetch): typeof fetch {
  const resolved = fetchImpl ?? globalThis.fetch;
  if (typeof resolved !== "function") {
    throw new Error("Ionify federation runtime requires fetch support");
  }
  return resolved;
}

function normalizeEntryUrl(remote: string | { entry: string }): string {
  if (typeof remote === "string" && remote.trim().length > 0) return remote.trim();
  if (remote && typeof remote === "object" && typeof remote.entry === "string" && remote.entry.trim().length > 0) {
    return remote.entry.trim();
  }
  throw new Error("Ionify federation remote entry URL is required");
}

function validateChunkFiles(files: unknown): IonifyChunkFiles {
  const value = files && typeof files === "object" ? (files as Record<string, unknown>) : {};
  const normalize = (input: unknown) =>
    Array.isArray(input)
      ? input.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
  return {
    js: normalize(value.js),
    css: normalize(value.css),
    assets: normalize(value.assets),
  };
}

function isIonifyBuildManifest(value: unknown): value is IonifyBuildManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Record<string, unknown>;
  if (!Array.isArray(manifest.entries) || !Array.isArray(manifest.chunks)) return false;
  const federation = manifest.federation;
  if (!federation || typeof federation !== "object") return false;
  return (federation as Record<string, unknown>).version === 1;
}

function isIonifyFederationContainerModule(value: unknown): value is IonifyFederationContainerModule {
  return !!value && typeof value === "object" && typeof (value as Record<string, unknown>).get === "function";
}

function toAbsoluteUrl(baseUrl: string, target: string): string {
  return new URL(target, baseUrl).toString();
}

function absolutizeChunkFiles(baseUrl: string, files: IonifyChunkFiles): IonifyChunkFiles {
  return {
    js: files.js.map((file) => toAbsoluteUrl(baseUrl, file)),
    css: files.css.map((file) => toAbsoluteUrl(baseUrl, file)),
    assets: files.assets.map((file) => toAbsoluteUrl(baseUrl, file)),
  };
}

function appendModulePreload(href: string): void {
  if (typeof document === "undefined") return;
  const existing = document.querySelector(`link[rel="modulepreload"][href="${href}"]`);
  if (existing) return;
  const link = document.createElement("link");
  link.rel = "modulepreload";
  link.href = href;
  document.head.appendChild(link);
}

function appendStylesheet(href: string): void {
  if (typeof document === "undefined") return;
  const existing = document.querySelector(`link[rel="stylesheet"][href="${href}"]`);
  if (existing) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function registerContainerBaseUrl(contractHash: string | undefined, entryUrl: string): void {
  if (typeof contractHash !== "string" || contractHash.length === 0) return;
  const target = globalThis as typeof globalThis & {
    __IONIFY_FEDERATION_CONTAINER_BASE_URLS__?: Record<string, string>;
  };
  const existing = target.__IONIFY_FEDERATION_CONTAINER_BASE_URLS__ ?? {};
  existing[contractHash] = entryUrl;
  target.__IONIFY_FEDERATION_CONTAINER_BASE_URLS__ = existing;
}

function parseSemver(version: string | undefined): { major: number; minor: number; patch: number } | null {
  if (typeof version !== "string") return null;
  const normalized = version.trim().replace(/^v/i, "").split("+")[0]?.split("-")[0] ?? "";
  if (!normalized) return null;
  const parts = normalized.split(".");
  const major = Number(parts[0] ?? "0");
  const minor = Number(parts[1] ?? "0");
  const patch = Number(parts[2] ?? "0");
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return null;
  return { major, minor, patch };
}

function compareSemver(left: string | undefined, right: string | undefined): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return 0;
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return 0;
}

function satisfiesComparator(version: string | undefined, comparator: string): boolean {
  const raw = comparator.trim();
  if (!raw || raw === "*" || /^x$/i.test(raw)) return true;
  const wildcard = raw.match(/^(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/i);
  if (wildcard && /x|\*/i.test(raw)) {
    const parsed = parseSemver(version);
    if (!parsed) return false;
    const majorRaw = wildcard[1];
    const minorRaw = wildcard[2];
    const patchRaw = wildcard[3];
    if (majorRaw && parsed.major !== Number(majorRaw)) return false;
    if (minorRaw && !/x|\*/i.test(minorRaw) && parsed.minor !== Number(minorRaw)) return false;
    if (patchRaw && !/x|\*/i.test(patchRaw) && parsed.patch !== Number(patchRaw)) return false;
    return true;
  }

  const exact = raw.match(/^(?:=)?(\d+(?:\.\d+){0,2})$/);
  if (exact) return compareSemver(version, exact[1]) === 0;

  const prefixed = raw.match(/^([~^]|>=|<=|>|<)(\d+(?:\.\d+){0,2})$/);
  if (!prefixed) return false;
  const operator = prefixed[1];
  const base = prefixed[2];
  const cmp = compareSemver(version, base);
  if (operator === ">") return cmp > 0;
  if (operator === ">=") return cmp >= 0;
  if (operator === "<") return cmp < 0;
  if (operator === "<=") return cmp <= 0;
  if (operator === "~") {
    const parsed = parseSemver(version);
    const target = parseSemver(base);
    if (!parsed || !target) return false;
    return parsed.major === target.major && parsed.minor === target.minor && cmp >= 0;
  }
  if (operator === "^") {
    const parsed = parseSemver(version);
    const target = parseSemver(base);
    if (!parsed || !target || cmp < 0) return false;
    if (target.major > 0) return parsed.major === target.major;
    if (target.minor > 0) return parsed.major === 0 && parsed.minor === target.minor;
    return parsed.major === 0 && parsed.minor === 0 && parsed.patch === target.patch;
  }
  return false;
}

function satisfiesRange(version: string | undefined, range: string | undefined): boolean {
  const raw = typeof range === "string" ? range.trim() : "";
  if (!raw || raw === "*") return true;
  return raw
    .split("||")
    .map((part) => part.trim())
    .filter(Boolean)
    .some((part) =>
      part
        .split(/\s+/)
        .filter(Boolean)
        .every((comparator) => satisfiesComparator(version, comparator)),
    );
}

function normalizeShareCandidates(
  registration: IonifyFederationSharedRegistration | undefined,
): IonifyFederationSharedModule[] {
  return (Array.isArray(registration) ? registration : [registration]).filter(
    (candidate): candidate is IonifyFederationSharedModule =>
      !!candidate && typeof candidate === "object",
  );
}

async function realizeSharedCandidate(
  candidate: IonifyFederationSharedModule,
  eager: boolean,
): Promise<IonifyFederationSharedModule> {
  if (!eager || candidate.module !== undefined || typeof candidate.get !== "function") {
    return candidate;
  }
  const loaded = await candidate.get();
  return {
    ...candidate,
    module: loaded,
  };
}

async function negotiateSharedScopes(
  requirements: Record<string, IonifyFederationSharedEntry>,
  providedScopes: IonifyFederationShareScopes | undefined,
): Promise<NegotiatedFederationShareScopes> {
  const resolvedScopes: NegotiatedFederationShareScopes = {};

  for (const [sharedName, requirement] of Object.entries(requirements)) {
    const scopeName = requirement.shareScope || "default";
    const registration = providedScopes?.[scopeName]?.[sharedName];
    const candidates = normalizeShareCandidates(registration);
    if (candidates.length === 0) {
      throw new Error(`Ionify federation shared dependency missing: ${sharedName} (scope: ${scopeName})`);
    }

    const versions = new Set(
      candidates.map((candidate) =>
        typeof candidate.version === "string" && candidate.version.trim().length > 0
          ? candidate.version.trim()
          : "0.0.0",
      ),
    );
    const matching =
      typeof requirement.requiredVersion === "string" && requirement.requiredVersion.trim().length > 0
        ? candidates.filter((candidate) => satisfiesRange(candidate.version, requirement.requiredVersion))
        : candidates.slice();
    if (matching.length === 0) {
      throw new Error(
        `Ionify federation version mismatch for ${sharedName}: required ${requirement.requiredVersion}, received ${Array.from(versions).join(", ")}`,
      );
    }

    matching.sort((left, right) => compareSemver(right.version, left.version));
    const selected = await realizeSharedCandidate(matching[0]!, requirement.eager === true);
    const scope = resolvedScopes[scopeName] ?? {};
    scope[sharedName] = {
      ...selected,
      version:
        typeof selected.version === "string" && selected.version.trim().length > 0
          ? selected.version.trim()
          : requirement.providedVersion,
      singleton: requirement.singleton === true,
      eager: requirement.eager === true,
    };
    resolvedScopes[scopeName] = scope;
  }

  return resolvedScopes;
}

export function createFederationHostRuntime(): IonifyFederationHostRuntime {
  return {
    async getRemoteManifest(remote, options = {}) {
      const entryUrl = normalizeEntryUrl(remote);
      const cacheKey = entryUrl;
      const cache = runtimeCache();
      const useCache = options.cache !== false;
      if (useCache && cache.manifests.has(cacheKey)) {
        return cache.manifests.get(cacheKey)!;
      }

      const loadPromise = (async () => {
        const fetchImpl = ensureFetch(options.fetchImpl);
        const response = await fetchImpl(entryUrl, {
          headers: options.headers,
          signal: options.signal,
        });
        if (!response.ok) {
          throw new Error(`Failed to fetch remote manifest: ${response.status} ${response.statusText}`);
        }
        const manifest = await response.json();
        if (!isIonifyBuildManifest(manifest)) {
          throw new Error("Remote manifest is not a valid Ionify federation manifest");
        }
        const manifestUrl = response.url || entryUrl;
        return {
          entryUrl,
          manifestUrl,
          baseUrl: new URL(".", manifestUrl).toString(),
          manifest,
        } satisfies IonifyRemoteManifestHandle;
      })();

      if (useCache) {
        cache.manifests.set(cacheKey, loadPromise);
      }
      try {
        return await loadPromise;
      } catch (error) {
        cache.manifests.delete(cacheKey);
        throw error;
      }
    },

    resolveRemoteExpose(remote, exposeKey) {
      const federation = remote.manifest.federation;
      if (!federation) {
        throw new Error("Remote manifest does not contain federation metadata");
      }
      const expose = federation.exposes[exposeKey];
      if (!expose) {
        throw new Error(`Remote expose not found: ${exposeKey}`);
      }
      return {
        remote,
        exposeKey,
        expose,
        urls: absolutizeChunkFiles(remote.baseUrl, validateChunkFiles(expose.files)),
      };
    },

    async preloadRemoteExpose(remote, exposeKey) {
      const handle = this.resolveRemoteExpose(remote, exposeKey);
      for (const href of handle.urls.js) appendModulePreload(href);
      for (const href of handle.urls.css) appendStylesheet(href);
      return handle;
    },

    async getRemoteContainer(remote, options = {}) {
      const remoteHandle =
        typeof remote === "string" || (remote && typeof remote === "object" && "entry" in remote && !("manifest" in remote))
          ? await this.getRemoteManifest(remote as string | { entry: string }, options)
          : (remote as IonifyRemoteManifestHandle);
      const federation = remoteHandle.manifest.federation;
      const containerMeta = federation?.container;
      if (!containerMeta?.entry) {
        throw new Error("Remote manifest does not contain federation container metadata");
      }

      const entryUrl = toAbsoluteUrl(remoteHandle.baseUrl, containerMeta.entry);
      const cache = runtimeCache();
      const useCache = options.cache !== false;
      if (useCache && cache.containers.has(entryUrl)) {
        const existing = await cache.containers.get(entryUrl)!;
        if (options.sharedScopes) {
          const negotiatedScopes = await negotiateSharedScopes(federation?.shared ?? {}, options.sharedScopes);
          await existing.container.init?.(negotiatedScopes);
        }
        return existing;
      }

      const needsSharedNegotiation = Object.keys(federation?.shared ?? {}).length > 0;
      const negotiatedScopes =
        options.sharedScopes || needsSharedNegotiation
          ? await negotiateSharedScopes(federation?.shared ?? {}, options.sharedScopes)
          : undefined;

      const loadPromise = (async () => {
        registerContainerBaseUrl(containerMeta.contractHash, entryUrl);
        const mod = await this.loadRemoteModule<Record<string, unknown>>(entryUrl);
        const candidate = (mod.default ?? mod) as unknown;
        if (!isIonifyFederationContainerModule(candidate)) {
          throw new Error("Remote federation container is missing get(exposeKey)");
        }
        const handle = {
          remote: remoteHandle,
          entryUrl,
          container: candidate,
        } satisfies IonifyRemoteContainerHandle;
        if (negotiatedScopes) {
          await handle.container.init?.(negotiatedScopes);
        }
        return handle;
      })();

      if (useCache) {
        cache.containers.set(entryUrl, loadPromise);
      }
      try {
        return await loadPromise;
      } catch (error) {
        cache.containers.delete(entryUrl);
        throw error;
      }
    },

    async loadRemoteExposeModule<TModule = Record<string, unknown>>(
      remote: string | { entry: string } | IonifyRemoteManifestHandle,
      exposeKey: string,
      options: IonifyFederationContainerLoadOptions = {},
    ) {
      const container = await this.getRemoteContainer(remote, options);
      const factory = await container.container.get(exposeKey);
      if (typeof factory !== "function") {
        throw new Error(`Remote federation expose factory is invalid: ${exposeKey}`);
      }
      return await factory() as TModule;
    },

    async loadRemoteModule(moduleUrl) {
      const cache = runtimeCache();
      if (cache.modules.has(moduleUrl)) {
        return cache.modules.get(moduleUrl) as Promise<Record<string, unknown>>;
      }
      const loadPromise = import(/* @vite-ignore */ moduleUrl) as Promise<Record<string, unknown>>;
      cache.modules.set(moduleUrl, loadPromise);
      try {
        return await loadPromise as any;
      } catch (error) {
        cache.modules.delete(moduleUrl);
        throw error;
      }
    },

    clear() {
      const cache = runtimeCache();
      cache.manifests.clear();
      cache.containers.clear();
      cache.modules.clear();
    },
  };
}

export async function fetchRemoteManifest(
  remote: string | { entry: string },
  options?: IonifyFederationFetchOptions,
): Promise<IonifyRemoteManifestHandle> {
  return createFederationHostRuntime().getRemoteManifest(remote, options);
}

export function resolveRemoteExpose(
  remote: IonifyRemoteManifestHandle,
  exposeKey: string,
): IonifyRemoteExposeHandle {
  return createFederationHostRuntime().resolveRemoteExpose(remote, exposeKey);
}

export async function preloadRemoteExpose(
  remote: IonifyRemoteManifestHandle,
  exposeKey: string,
): Promise<IonifyRemoteExposeHandle> {
  return createFederationHostRuntime().preloadRemoteExpose(remote, exposeKey);
}

export async function fetchRemoteContainer(
  remote: string | { entry: string } | IonifyRemoteManifestHandle,
  options?: IonifyFederationContainerLoadOptions,
): Promise<IonifyRemoteContainerHandle> {
  return createFederationHostRuntime().getRemoteContainer(remote, options);
}

export async function loadRemoteExposeModule<TModule = Record<string, unknown>>(
  remote: string | { entry: string } | IonifyRemoteManifestHandle,
  exposeKey: string,
  options?: IonifyFederationContainerLoadOptions,
): Promise<TModule> {
  return createFederationHostRuntime().loadRemoteExposeModule<TModule>(remote, exposeKey, options);
}

export async function loadRemoteModule<TModule = Record<string, unknown>>(
  moduleUrl: string,
): Promise<TModule> {
  return createFederationHostRuntime().loadRemoteModule<TModule>(moduleUrl);
}
