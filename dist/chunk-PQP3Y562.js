#!/usr/bin/env node

// src/core/cache.ts
import fs2 from "fs";
import path2 from "path";
import crypto from "crypto";

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
function normalizeBuiltinFallback(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value).filter(
    (entry) => entry[0].length > 0 && (entry[1] === false || typeof entry[1] === "string" && entry[1].length > 0)
  ).sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0 ? entries : null;
}
function normalizeRuntimeGlobals(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = [];
  for (const [globalName, provider] of Object.entries(value)) {
    if (globalName.length === 0) continue;
    if (typeof provider === "string" && provider.length > 0) {
      entries.push([globalName, provider]);
      continue;
    }
    if (Array.isArray(provider) && provider.length === 2 && typeof provider[0] === "string" && provider[0].length > 0 && typeof provider[1] === "string" && provider[1].length > 0) {
      entries.push([globalName, [provider[0], provider[1]]]);
    }
  }
  entries.sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0 ? entries : null;
}
function normalizeResolveOptions(resolveOptions) {
  if (!resolveOptions || typeof resolveOptions !== "object") return null;
  const normalized = {};
  const alias = normalizeResolveAlias(resolveOptions.alias);
  const builtinFallback = normalizeBuiltinFallback(resolveOptions.builtinFallback);
  const runtimeGlobals = normalizeRuntimeGlobals(resolveOptions.runtimeGlobals);
  const extensions = normalizeStringArray(resolveOptions.extensions);
  const conditions = normalizeStringArray(resolveOptions.conditions);
  const mainFields = normalizeStringArray(resolveOptions.mainFields);
  if (alias) normalized.alias = alias;
  if (builtinFallback) normalized.builtinFallback = builtinFallback;
  if (runtimeGlobals) normalized.runtimeGlobals = runtimeGlobals;
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

// src/native/native-loader.ts
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
var NATIVE_PACKAGE_BY_TARGET = Object.freeze({
  "darwin-arm64": "@ionify/ionify-darwin-arm64",
  "darwin-x64": "@ionify/ionify-darwin-x64",
  "win32-arm64-msvc": "@ionify/ionify-win32-arm64-msvc",
  "win32-x64-msvc": "@ionify/ionify-win32-x64-msvc",
  "linux-arm64-gnu": "@ionify/ionify-linux-arm64-gnu",
  "linux-x64-gnu": "@ionify/ionify-linux-x64-gnu",
  "linux-arm64-musl": "@ionify/ionify-linux-arm64-musl",
  "linux-x64-musl": "@ionify/ionify-linux-x64-musl"
});
function detectLinuxLibc(getReport = process.report?.getReport) {
  const report = typeof getReport === "function" ? getReport() : void 0;
  const header = report && typeof report === "object" && "header" in report ? report.header : void 0;
  const glibcVersionRuntime = header && typeof header === "object" && "glibcVersionRuntime" in header ? header.glibcVersionRuntime : void 0;
  return typeof glibcVersionRuntime === "string" && glibcVersionRuntime.length > 0 ? "gnu" : "musl";
}
function targetKey(platform, arch, libc) {
  if (platform === "linux") {
    return `${platform}-${arch}-${libc ?? detectLinuxLibc()}`;
  }
  if (platform === "win32") return `${platform}-${arch}-msvc`;
  return `${platform}-${arch}`;
}
function describeOriginalError(error) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
function errorCode(error) {
  return error && typeof error === "object" && "code" in error ? String(error.code ?? "") : void 0;
}
function makeError(message, code, cause) {
  const error = new Error(message);
  error.name = "IonifyNativeBindingError";
  error.code = code;
  if (cause !== void 0) error.cause = cause;
  return error;
}
function selectNativePackage(platform, arch, libc) {
  const key = targetKey(platform, arch, libc);
  const selected = NATIVE_PACKAGE_BY_TARGET[key];
  if (selected) return selected;
  throw makeError(
    [
      `[Ionify] Unsupported native platform: ${key}.`,
      `Supported platforms: ${Object.keys(NATIVE_PACKAGE_BY_TARGET).join(", ")}.`,
      "Ionify did not attempt to load a binary for another platform."
    ].join("\n"),
    "IONIFY_UNSUPPORTED_NATIVE_PLATFORM"
  );
}
function findPackageRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const packagePath = path.join(dir, "package.json");
    try {
      if (fs.statSync(packagePath).isFile()) return dir;
    } catch {
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
function privateCheckoutBinding(moduleUrl) {
  const packageRoot = findPackageRoot(path.dirname(fileURLToPath(moduleUrl)));
  if (!packageRoot) return null;
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")
    );
    if (packageJson.name !== "ionify" || packageJson.private !== true) return null;
  } catch {
    return null;
  }
  const candidate = path.join(packageRoot, "native", "ionify_core.node");
  try {
    return fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}
function selectedPackageIsMissing(error, packageName) {
  return errorCode(error) === "MODULE_NOT_FOUND" && describeOriginalError(error).includes(packageName);
}
function loadFailure(platform, arch, libc, packageName, error) {
  const key = targetKey(platform, arch, libc);
  const missing = selectedPackageIsMissing(error, packageName);
  const guidance = missing ? [
    "The platform package was not installed. Optional dependencies may have been omitted or the install may be incomplete.",
    "Reinstall the main package without --omit=optional / --no-optional:",
    "  npm install @ionify/ionify",
    "  pnpm add @ionify/ionify"
  ] : [
    "The selected package exists, but Node could not load its native addon.",
    "Check that the package was not copied from a different OS/CPU and that the downloaded binary is intact."
  ];
  return makeError(
    [
      `[Ionify] Failed to load the native binding for ${key}.`,
      `Selected package: ${packageName}`,
      ...guidance,
      `Original Node error: ${describeOriginalError(error)}`
    ].join("\n"),
    missing ? "IONIFY_NATIVE_PACKAGE_MISSING" : "IONIFY_NATIVE_DLOPEN_FAILED",
    error
  );
}
function loadNativeBinding(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const libc = platform === "linux" ? options.libc ?? detectLinuxLibc() : void 0;
  const packageName = selectNativePackage(platform, arch, libc);
  const requireFn = options.requireFn ?? createRequire(options.moduleUrl ?? import.meta.url);
  try {
    return requireFn(packageName);
  } catch (selectedError) {
    const checkoutPath = options.privateCheckoutBindingPath === void 0 ? privateCheckoutBinding(options.moduleUrl ?? import.meta.url) : options.privateCheckoutBindingPath;
    if (checkoutPath && selectedPackageIsMissing(selectedError, packageName)) {
      try {
        return requireFn(checkoutPath);
      } catch (checkoutError) {
        throw loadFailure(platform, arch, libc, checkoutPath, checkoutError);
      }
    }
    throw loadFailure(platform, arch, libc, packageName, selectedError);
  }
}

// src/native/index.ts
var nativeBinding = loadNativeBinding();
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
