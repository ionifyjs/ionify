#!/usr/bin/env node

// src/core/cache.ts
import fs2 from "fs";
import path2 from "path";
import crypto from "crypto";

// src/native/index.ts
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

// src/core/version.ts
import { createHash } from "crypto";
function normalizeTreeshake(treeshake) {
  if (treeshake === false || treeshake === void 0 || treeshake === null) {
    return null;
  }
  if (treeshake === true) {
    return {
      mode: "safe",
      include: [],
      exclude: []
    };
  }
  if (typeof treeshake === "string") {
    return {
      mode: treeshake === "aggressive" ? "aggressive" : "safe",
      include: [],
      exclude: []
    };
  }
  return {
    mode: treeshake.mode === "aggressive" ? "aggressive" : "safe",
    include: Array.isArray(treeshake.include) ? [...treeshake.include].sort() : [],
    exclude: Array.isArray(treeshake.exclude) ? [...treeshake.exclude].sort() : []
  };
}
function normalizeScopeHoist(scopeHoist) {
  if (scopeHoist === false || scopeHoist === void 0 || scopeHoist === null) {
    return null;
  }
  if (scopeHoist === true) {
    return {
      inlineFunctions: true,
      constantFolding: true,
      combineVariables: true
    };
  }
  return {
    inlineFunctions: scopeHoist.inlineFunctions === true,
    constantFolding: scopeHoist.constantFolding === true,
    combineVariables: scopeHoist.combineVariables === true
  };
}
function normalizeStringArray(value) {
  if (!Array.isArray(value)) return null;
  const out = value.filter((item) => typeof item === "string" && item.length > 0);
  return out.length > 0 ? out : null;
}
function normalizeResolveAlias(alias) {
  if (!alias || typeof alias !== "object" || Array.isArray(alias)) return null;
  const entries = [];
  for (const [key, value] of Object.entries(alias)) {
    if (typeof key !== "string" || key.length === 0) continue;
    const values = Array.isArray(value) ? value : [value];
    const normalized = values.filter(
      (item) => typeof item === "string" && item.length > 0
    );
    if (normalized.length > 0) entries.push([key, normalized]);
  }
  return entries.length > 0 ? entries : null;
}
function normalizeResolveOptions(resolveOptions) {
  if (!resolveOptions || typeof resolveOptions !== "object") return null;
  const normalized = {};
  const alias = normalizeResolveAlias(resolveOptions.alias);
  const extensions = normalizeStringArray(resolveOptions.extensions);
  const conditions = normalizeStringArray(resolveOptions.conditions);
  const mainFields = normalizeStringArray(resolveOptions.mainFields);
  if (alias) normalized.alias = alias;
  if (extensions) normalized.extensions = extensions;
  if (conditions) normalized.conditions = conditions;
  if (mainFields) normalized.mainFields = mainFields;
  return Object.keys(normalized).length > 0 ? normalized : null;
}
function computeCanonicalVersionInputs(config) {
  const storageSchema = "phase6.6-ws-module-ids-v2";
  const parserMode = config.parserMode || "hybrid";
  const minifier = config.minifier || "auto";
  const treeshake = normalizeTreeshake(config.treeshake);
  const scopeHoist = normalizeScopeHoist(config.scopeHoist);
  const plugins = Array.isArray(config.plugins) ? config.plugins.map((p) => typeof p === "string" ? p : p.name).filter((name) => typeof name === "string").sort() : [];
  const resolveOptions = normalizeResolveOptions(config.resolveOptions);
  const cssOptions = config.cssOptions && Object.keys(config.cssOptions).length > 0 ? config.cssOptions : null;
  const assetOptions = config.assetOptions && Object.keys(config.assetOptions).length > 0 ? config.assetOptions : null;
  const runtimeContracts = config.runtimeContracts && Object.keys(config.runtimeContracts).length > 0 ? config.runtimeContracts : null;
  return {
    storageSchema,
    parserMode,
    minifier,
    treeshake,
    scopeHoist,
    plugins,
    resolveOptions,
    cssOptions,
    assetOptions,
    runtimeContracts
  };
}
function stableStringify(value) {
  return JSON.stringify(value, (_key, val) => {
    if (!val || typeof val !== "object") return val;
    if (Array.isArray(val)) return val;
    const out = {};
    for (const key of Object.keys(val).sort()) {
      out[key] = val[key];
    }
    return out;
  });
}
function computeVersionHash(inputs) {
  const json = stableStringify(inputs);
  const hash = createHash("sha256").update(json).digest("hex");
  return hash.slice(0, 16);
}

// src/native/index.ts
function resolveCandidates() {
  const cwd = process.cwd();
  const releaseDir = path.resolve(cwd, "target", "release");
  const debugDir = path.resolve(cwd, "target", "debug");
  const nativeDir = path.resolve(cwd, "native");
  const modulePath = fileURLToPath(import.meta.url);
  const moduleDir = path.dirname(modulePath);
  const findPackageRoot = (startDir) => {
    let dir = startDir;
    for (let i = 0; i < 6; i++) {
      const pkgPath = path.join(dir, "package.json");
      try {
        if (fs.existsSync(pkgPath) && fs.statSync(pkgPath).isFile()) {
          return dir;
        }
      } catch {
      }
      const parent = path.dirname(dir);
      if (!parent || parent === dir) break;
      dir = parent;
    }
    return null;
  };
  const packageRoot = findPackageRoot(moduleDir);
  const packageNativeDir = packageRoot ? path.join(packageRoot, "native") : null;
  const packageDistDir = packageRoot ? path.join(packageRoot, "dist") : null;
  const platformFile = process.platform === "win32" ? "ionify_core.dll" : process.platform === "darwin" ? "libionify_core.dylib" : "libionify_core.so";
  const candidates = [
    // Installed package location (preferred): dist/ionify_core.node (published via "files": ["dist"]).
    path.join(moduleDir, "ionify_core.node"),
    // Alternative installed layouts (fallback):
    // Prefer `native/` when present (repo/dev layouts) so local rebuilds are picked up even if an old `dist/` exists.
    ...packageNativeDir ? [path.join(packageNativeDir, "ionify_core.node")] : [],
    ...packageDistDir ? [path.join(packageDistDir, "ionify_core.node")] : [],
    ...packageRoot ? [path.join(packageRoot, "ionify_core.node")] : [],
    // Development locations
    path.join(nativeDir, "ionify_core.node"),
    path.join(releaseDir, "ionify_core.node"),
    path.join(releaseDir, platformFile),
    path.join(debugDir, "ionify_core.node"),
    path.join(debugDir, platformFile)
  ];
  return candidates.filter((candidate) => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}
var nativeBinding = null;
(() => {
  const require2 = createRequire(import.meta.url);
  for (const candidate of resolveCandidates()) {
    try {
      const mod = require2(candidate);
      if (mod) {
        nativeBinding = mod;
        break;
      }
    } catch {
    }
  }
})();
var native = nativeBinding;
function getDepsOptimizerOutputVersion() {
  return nativeBinding?.depsOptimizerOutputVersion?.() ?? 0;
}
function shouldUseSwcOnly() {
  return (process.env.IONIFY_PARSER ?? "").toLowerCase() === "swc";
}
function tryParseImports(source, filename) {
  if (!nativeBinding?.parseImports) return null;
  if (shouldUseSwcOnly()) return null;
  try {
    const result = nativeBinding.parseImports(source, filename);
    return Array.isArray(result) ? result : null;
  } catch {
    return null;
  }
}
function tryParseModuleMetadata(source, filename) {
  if (!nativeBinding?.parseModuleMetadata) return null;
  if (shouldUseSwcOnly()) return null;
  try {
    const result = nativeBinding.parseModuleMetadata(source, filename);
    if (result && Array.isArray(result.imports) && typeof result.hash === "string") {
      return { imports: result.imports, hash: result.hash };
    }
  } catch {
  }
  return null;
}
function tryNativeTransform(mode, code, options) {
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
function isGraphLockError(err) {
  const message = String(err);
  return /could not acquire lock|Resource temporarily unavailable|WouldBlock|database is locked|lock/i.test(message);
}
function sleepSync(ms) {
  if (ms <= 0) return;
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}
function ensureNativeGraph(graphPath, version, options = {}) {
  if (!nativeBinding?.graphInit) return false;
  const retryMs = Math.max(0, Math.floor(options.retryMs ?? 0));
  const retryIntervalMs = Math.max(10, Math.floor(options.retryIntervalMs ?? 50));
  const deadline = retryMs > 0 ? Date.now() + retryMs : 0;
  let attempts = 0;
  let lastErr = null;
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
  return false;
}
function computeGraphVersion(inputs) {
  const canonical = computeCanonicalVersionInputs(inputs);
  return computeVersionHash(canonical);
}
function tryBundleNodeModule(filePath, code) {
  if (!nativeBinding?.plannerPlanBuild || !nativeBinding?.buildChunks) {
    return null;
  }
  try {
    const plan = nativeBinding.plannerPlanBuild([filePath]);
    if (!plan || !plan.chunks || plan.chunks.length === 0) {
      return null;
    }
    const artifacts = nativeBinding.buildChunks(plan);
    if (artifacts && artifacts.length > 0 && artifacts[0].code) {
      return artifacts[0].code;
    }
  } catch (error) {
    console.warn(`[Ionify] Native bundler failed for ${filePath}:`, error);
  }
  return null;
}

// src/core/cache.ts
function resolveIonifyDir() {
  const fromEnv = process.env.IONIFY_STATE_DIR;
  if (fromEnv && path2.isAbsolute(fromEnv)) return fromEnv;
  const projectRoot = process.env.IONIFY_PROJECT_ROOT;
  if (projectRoot && path2.isAbsolute(projectRoot)) return path2.join(projectRoot, ".ionify");
  return path2.join(process.cwd(), ".ionify");
}
function cacheDir() {
  return path2.join(resolveIonifyDir(), "cache");
}
function ensureCacheDir() {
  const dir = cacheDir();
  if (!fs2.existsSync(dir)) {
    fs2.mkdirSync(dir, { recursive: true });
  }
}
function getCacheKey(content) {
  if (native?.cacheHash) {
    try {
      const data = typeof content === "string" ? Buffer.from(content) : content;
      return native.cacheHash(data);
    } catch {
    }
  }
  return crypto.createHash("sha256").update(content).digest("hex");
}
function writeCache(hash, data) {
  ensureCacheDir();
  const target = path2.join(cacheDir(), hash);
  fs2.writeFileSync(target, data);
}
function readCache(hash) {
  const target = path2.join(cacheDir(), hash);
  return fs2.existsSync(target) ? fs2.readFileSync(target) : null;
}
function clearCache() {
  const dir = cacheDir();
  if (fs2.existsSync(dir)) {
    fs2.rmSync(dir, { recursive: true, force: true });
  }
}

export {
  native,
  getDepsOptimizerOutputVersion,
  tryParseImports,
  tryParseModuleMetadata,
  tryNativeTransform,
  ensureNativeGraph,
  computeGraphVersion,
  tryBundleNodeModule,
  getCacheKey,
  writeCache,
  readCache,
  clearCache
};
