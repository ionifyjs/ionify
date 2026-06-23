#!/usr/bin/env node
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  createFederationHostRuntime: () => createFederationHostRuntime,
  defineConfig: () => defineConfig,
  fetchRemoteContainer: () => fetchRemoteContainer,
  fetchRemoteManifest: () => fetchRemoteManifest,
  loadRemoteExposeModule: () => loadRemoteExposeModule,
  loadRemoteModule: () => loadRemoteModule,
  preloadRemoteExpose: () => preloadRemoteExpose,
  resolveRemoteExpose: () => resolveRemoteExpose
});
module.exports = __toCommonJS(src_exports);

// src/runtime/federation.ts
function runtimeCache() {
  const target = globalThis;
  if (!target.__IONIFY_FEDERATION_RUNTIME_CACHE__) {
    target.__IONIFY_FEDERATION_RUNTIME_CACHE__ = {
      manifests: /* @__PURE__ */ new Map(),
      containers: /* @__PURE__ */ new Map(),
      modules: /* @__PURE__ */ new Map()
    };
  }
  return target.__IONIFY_FEDERATION_RUNTIME_CACHE__;
}
function ensureFetch(fetchImpl) {
  const resolved = fetchImpl ?? globalThis.fetch;
  if (typeof resolved !== "function") {
    throw new Error("Ionify federation runtime requires fetch support");
  }
  return resolved;
}
function normalizeEntryUrl(remote) {
  if (typeof remote === "string" && remote.trim().length > 0) return remote.trim();
  if (remote && typeof remote === "object" && typeof remote.entry === "string" && remote.entry.trim().length > 0) {
    return remote.entry.trim();
  }
  throw new Error("Ionify federation remote entry URL is required");
}
function validateChunkFiles(files) {
  const value = files && typeof files === "object" ? files : {};
  const normalize = (input) => Array.isArray(input) ? input.filter((item) => typeof item === "string" && item.length > 0) : [];
  return {
    js: normalize(value.js),
    css: normalize(value.css),
    assets: normalize(value.assets)
  };
}
function isIonifyBuildManifest(value) {
  if (!value || typeof value !== "object") return false;
  const manifest = value;
  if (!Array.isArray(manifest.entries) || !Array.isArray(manifest.chunks)) return false;
  const federation = manifest.federation;
  if (!federation || typeof federation !== "object") return false;
  return federation.version === 1;
}
function isIonifyFederationContainerModule(value) {
  return !!value && typeof value === "object" && typeof value.get === "function";
}
function toAbsoluteUrl(baseUrl, target) {
  return new URL(target, baseUrl).toString();
}
function absolutizeChunkFiles(baseUrl, files) {
  return {
    js: files.js.map((file) => toAbsoluteUrl(baseUrl, file)),
    css: files.css.map((file) => toAbsoluteUrl(baseUrl, file)),
    assets: files.assets.map((file) => toAbsoluteUrl(baseUrl, file))
  };
}
function appendModulePreload(href) {
  if (typeof document === "undefined") return;
  const existing = document.querySelector(`link[rel="modulepreload"][href="${href}"]`);
  if (existing) return;
  const link = document.createElement("link");
  link.rel = "modulepreload";
  link.href = href;
  document.head.appendChild(link);
}
function appendStylesheet(href) {
  if (typeof document === "undefined") return;
  const existing = document.querySelector(`link[rel="stylesheet"][href="${href}"]`);
  if (existing) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}
function registerContainerBaseUrl(contractHash, entryUrl) {
  if (typeof contractHash !== "string" || contractHash.length === 0) return;
  const target = globalThis;
  const existing = target.__IONIFY_FEDERATION_CONTAINER_BASE_URLS__ ?? {};
  existing[contractHash] = entryUrl;
  target.__IONIFY_FEDERATION_CONTAINER_BASE_URLS__ = existing;
}
function parseSemver(version) {
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
function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return 0;
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return 0;
}
function satisfiesComparator(version, comparator) {
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
function satisfiesRange(version, range) {
  const raw = typeof range === "string" ? range.trim() : "";
  if (!raw || raw === "*") return true;
  return raw.split("||").map((part) => part.trim()).filter(Boolean).some(
    (part) => part.split(/\s+/).filter(Boolean).every((comparator) => satisfiesComparator(version, comparator))
  );
}
function normalizeShareCandidates(registration) {
  return (Array.isArray(registration) ? registration : [registration]).filter(
    (candidate) => !!candidate && typeof candidate === "object"
  );
}
async function realizeSharedCandidate(candidate, eager) {
  if (!eager || candidate.module !== void 0 || typeof candidate.get !== "function") {
    return candidate;
  }
  const loaded = await candidate.get();
  return {
    ...candidate,
    module: loaded
  };
}
async function negotiateSharedScopes(requirements, providedScopes) {
  const resolvedScopes = {};
  for (const [sharedName, requirement] of Object.entries(requirements)) {
    const scopeName = requirement.shareScope || "default";
    const registration = providedScopes?.[scopeName]?.[sharedName];
    const candidates = normalizeShareCandidates(registration);
    if (candidates.length === 0) {
      throw new Error(`Ionify federation shared dependency missing: ${sharedName} (scope: ${scopeName})`);
    }
    const versions = new Set(
      candidates.map(
        (candidate) => typeof candidate.version === "string" && candidate.version.trim().length > 0 ? candidate.version.trim() : "0.0.0"
      )
    );
    const matching = typeof requirement.requiredVersion === "string" && requirement.requiredVersion.trim().length > 0 ? candidates.filter((candidate) => satisfiesRange(candidate.version, requirement.requiredVersion)) : candidates.slice();
    if (matching.length === 0) {
      throw new Error(
        `Ionify federation version mismatch for ${sharedName}: required ${requirement.requiredVersion}, received ${Array.from(versions).join(", ")}`
      );
    }
    matching.sort((left, right) => compareSemver(right.version, left.version));
    const selected = await realizeSharedCandidate(matching[0], requirement.eager === true);
    const scope = resolvedScopes[scopeName] ?? {};
    scope[sharedName] = {
      ...selected,
      version: typeof selected.version === "string" && selected.version.trim().length > 0 ? selected.version.trim() : requirement.providedVersion,
      singleton: requirement.singleton === true,
      eager: requirement.eager === true
    };
    resolvedScopes[scopeName] = scope;
  }
  return resolvedScopes;
}
function createFederationHostRuntime() {
  return {
    async getRemoteManifest(remote, options = {}) {
      const entryUrl = normalizeEntryUrl(remote);
      const cacheKey = entryUrl;
      const cache = runtimeCache();
      const useCache = options.cache !== false;
      if (useCache && cache.manifests.has(cacheKey)) {
        return cache.manifests.get(cacheKey);
      }
      const loadPromise = (async () => {
        const fetchImpl = ensureFetch(options.fetchImpl);
        const response = await fetchImpl(entryUrl, {
          headers: options.headers,
          signal: options.signal
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
          manifest
        };
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
        urls: absolutizeChunkFiles(remote.baseUrl, validateChunkFiles(expose.files))
      };
    },
    async preloadRemoteExpose(remote, exposeKey) {
      const handle = this.resolveRemoteExpose(remote, exposeKey);
      for (const href of handle.urls.js) appendModulePreload(href);
      for (const href of handle.urls.css) appendStylesheet(href);
      return handle;
    },
    async getRemoteContainer(remote, options = {}) {
      const remoteHandle = typeof remote === "string" || remote && typeof remote === "object" && "entry" in remote && !("manifest" in remote) ? await this.getRemoteManifest(remote, options) : remote;
      const federation = remoteHandle.manifest.federation;
      const containerMeta = federation?.container;
      if (!containerMeta?.entry) {
        throw new Error("Remote manifest does not contain federation container metadata");
      }
      const entryUrl = toAbsoluteUrl(remoteHandle.baseUrl, containerMeta.entry);
      const cache = runtimeCache();
      const useCache = options.cache !== false;
      if (useCache && cache.containers.has(entryUrl)) {
        const existing = await cache.containers.get(entryUrl);
        if (options.sharedScopes) {
          const negotiatedScopes2 = await negotiateSharedScopes(federation?.shared ?? {}, options.sharedScopes);
          await existing.container.init?.(negotiatedScopes2);
        }
        return existing;
      }
      const needsSharedNegotiation = Object.keys(federation?.shared ?? {}).length > 0;
      const negotiatedScopes = options.sharedScopes || needsSharedNegotiation ? await negotiateSharedScopes(federation?.shared ?? {}, options.sharedScopes) : void 0;
      const loadPromise = (async () => {
        registerContainerBaseUrl(containerMeta.contractHash, entryUrl);
        const mod = await this.loadRemoteModule(entryUrl);
        const candidate = mod.default ?? mod;
        if (!isIonifyFederationContainerModule(candidate)) {
          throw new Error("Remote federation container is missing get(exposeKey)");
        }
        const handle = {
          remote: remoteHandle,
          entryUrl,
          container: candidate
        };
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
    async loadRemoteExposeModule(remote, exposeKey, options = {}) {
      const container = await this.getRemoteContainer(remote, options);
      const factory = await container.container.get(exposeKey);
      if (typeof factory !== "function") {
        throw new Error(`Remote federation expose factory is invalid: ${exposeKey}`);
      }
      return await factory();
    },
    async loadRemoteModule(moduleUrl) {
      const cache = runtimeCache();
      if (cache.modules.has(moduleUrl)) {
        return cache.modules.get(moduleUrl);
      }
      const loadPromise = import(
        /* @vite-ignore */
        moduleUrl
      );
      cache.modules.set(moduleUrl, loadPromise);
      try {
        return await loadPromise;
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
    }
  };
}
async function fetchRemoteManifest(remote, options) {
  return createFederationHostRuntime().getRemoteManifest(remote, options);
}
function resolveRemoteExpose(remote, exposeKey) {
  return createFederationHostRuntime().resolveRemoteExpose(remote, exposeKey);
}
async function preloadRemoteExpose(remote, exposeKey) {
  return createFederationHostRuntime().preloadRemoteExpose(remote, exposeKey);
}
async function fetchRemoteContainer(remote, options) {
  return createFederationHostRuntime().getRemoteContainer(remote, options);
}
async function loadRemoteExposeModule(remote, exposeKey, options) {
  return createFederationHostRuntime().loadRemoteExposeModule(remote, exposeKey, options);
}
async function loadRemoteModule(moduleUrl) {
  return createFederationHostRuntime().loadRemoteModule(moduleUrl);
}

// src/types.ts
function defineConfig(config) {
  return config;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createFederationHostRuntime,
  defineConfig,
  fetchRemoteContainer,
  fetchRemoteManifest,
  loadRemoteExposeModule,
  loadRemoteModule,
  preloadRemoteExpose,
  resolveRemoteExpose
});
