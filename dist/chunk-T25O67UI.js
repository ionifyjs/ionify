#!/usr/bin/env node
import {
  computeGraphVersion,
  ensureNativeGraph,
  getCacheKey,
  getDepsOptimizerOutputVersion,
  native,
  tryNativeTransform,
  tryParseImports,
  tryParseModuleMetadata
} from "./chunk-EAESHDA5.js";
import {
  logError,
  logInfo,
  logWarn
} from "./chunk-SNACSSNX.js";
import {
  __filename
} from "./chunk-FHXXO743.js";

// src/cli/commands/build.ts
import fs23 from "fs";
import os2 from "os";
import path26 from "path";
import crypto6 from "crypto";
import zlib from "zlib";

// src/cli/utils/config.ts
import fs4 from "fs";
import path4 from "path";

// src/core/resolver.ts
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { pathToFileURL, fileURLToPath } from "url";

// src/core/resolver/local-source-extensions.ts
var LOCAL_SOURCE_EXTENSIONS_FALLBACK = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css"
];
var cachedNative = null;
function localSourceExtensions() {
  if (cachedNative) return cachedNative;
  const fromNative = native?.localSourceExtensions?.();
  if (Array.isArray(fromNative) && fromNative.length > 0) {
    cachedNative = fromNative;
    return cachedNative;
  }
  return [...LOCAL_SOURCE_EXTENSIONS_FALLBACK];
}

// src/core/resolver.ts
var CONFIG_FILES = ["tsconfig.json", "jsconfig.json"];
var swc = null;
(() => {
  try {
    const require3 = createRequire(import.meta.url);
    swc = require3("@swc/core");
  } catch {
    swc = null;
  }
})();
function extractImports(source, filename = "inline.ts") {
  if (native?.parseModuleIr) {
    try {
      const result = native.parseModuleIr(filename, source);
      return result.dependencies.map((dep) => dep.specifier);
    } catch {
    }
  }
  const meta = tryParseModuleMetadata(source, filename);
  if (meta && Array.isArray(meta.imports)) {
    return meta.imports;
  }
  const nativeImports = tryParseImports(source, filename);
  if (nativeImports && Array.isArray(nativeImports)) {
    return nativeImports;
  }
  const deps = /* @__PURE__ */ new Set();
  const fallbackRegex = () => {
    const re = /(?:import\s+(?:[^'"]+\s+from\s+)??['"]([^'"]+)['"])|(?:export\s+[^'"]+\s+from\s+['"]([^'"]+)['"])|(?:import\s*?\(\s*?['"]([^'"]+)['"]\s*?\))/g;
    let m;
    while (m = re.exec(source)) {
      const statement = m[0] ?? "";
      if (/^\s*(?:import|export)\s+type\b/.test(statement)) continue;
      const spec = m[1] || m[2] || m[3];
      if (spec) deps.add(spec);
    }
  };
  try {
    const parseSync2 = swc?.parseSync;
    if (parseSync2) {
      const ast = parseSync2(source, {
        filename,
        isModule: true,
        target: "es2022",
        syntax: "typescript",
        tsx: true,
        decorators: true,
        dynamicImport: true
      });
      const visit = (node) => {
        if (!node || typeof node !== "object") return;
        const anyNode = node;
        const type = anyNode.type;
        const specifiers = Array.isArray(anyNode.specifiers) ? anyNode.specifiers : [];
        const isTypeOnlyDecl = anyNode.typeOnly === true;
        const hasOnlyTypeSpecifiers = specifiers.length > 0 && specifiers.every((specifier) => {
          if (!specifier || typeof specifier !== "object") return false;
          return specifier.typeOnly === true;
        });
        if (type === "ImportDeclaration" && !isTypeOnlyDecl && !hasOnlyTypeSpecifiers && anyNode.source && typeof anyNode.source.value === "string") {
          deps.add(anyNode.source.value);
        } else if (type === "ExportAllDeclaration" && !isTypeOnlyDecl && anyNode.source && typeof anyNode.source.value === "string") {
          deps.add(anyNode.source.value);
        } else if (type === "ExportNamedDeclaration" && !isTypeOnlyDecl && !hasOnlyTypeSpecifiers && anyNode.source && typeof anyNode.source.value === "string") {
          deps.add(anyNode.source.value);
        } else if (type === "CallExpression") {
          const callee = anyNode.callee ?? {};
          if (callee.type === "Import") {
            const args = anyNode.arguments ?? [];
            const first = args[0];
            if (first && typeof first === "object") {
              const expr = first.expression;
              if (expr && expr.type === "StringLiteral" && typeof expr.value === "string") {
                deps.add(expr.value);
              }
            }
          }
        }
        for (const value of Object.values(anyNode)) {
          if (!value) continue;
          if (Array.isArray(value)) {
            for (const item of value) visit(item);
          } else if (typeof value === "object") {
            visit(value);
          }
        }
      };
      visit(ast);
    } else {
      fallbackRegex();
    }
  } catch {
    fallbackRegex();
  }
  if (!deps.size) {
    fallbackRegex();
  }
  return Array.from(deps);
}
function tryFile(p) {
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  return null;
}
function tryWithExt(p) {
  if (tryFile(p)) return p;
  for (const ext of localSourceExtensions()) {
    const cand = p.endsWith(ext) ? p : p + ext;
    const found = tryFile(cand);
    if (found) return found;
  }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
    const pkgPath = path.join(p, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        if (pkg.main) {
          const mainPath = path.join(p, pkg.main);
          const mainResolved = tryFile(mainPath) || tryWithExt(mainPath);
          if (mainResolved) return mainResolved;
        }
        if (pkg.module) {
          const modulePath = path.join(p, pkg.module);
          const moduleResolved = tryFile(modulePath) || tryWithExt(modulePath);
          if (moduleResolved) return moduleResolved;
        }
      } catch {
      }
    }
    for (const ext of localSourceExtensions()) {
      const idx = path.join(p, "index" + ext);
      const found = tryFile(idx);
      if (found) return found;
    }
  }
  return null;
}
var cachedTsconfigAliases;
var customAliasEntries = [];
var resolvePathCache = /* @__PURE__ */ new Map();
function resolverRootDir() {
  const fromEnv = process.env.IONIFY_PROJECT_ROOT;
  if (fromEnv && path.isAbsolute(fromEnv)) return fromEnv;
  return process.cwd();
}
function createAliasEntry(pattern, targets) {
  const hasWildcard = pattern.includes("*");
  if (hasWildcard) {
    const escaped = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&");
    const matcher = new RegExp(`^${escaped.replace(/\*/g, "(.*)")}$`);
    return {
      resolveCandidates(specifier) {
        const match = matcher.exec(specifier);
        if (!match) return [];
        const wildcards = match.slice(1);
        return targets.map((target) => {
          if (!target.includes("*")) return target;
          const segments = target.split("*");
          let rebuilt = segments[0] ?? "";
          for (let i = 1; i < segments.length; i++) {
            const replacement = wildcards[i - 1] ?? wildcards[wildcards.length - 1] ?? "";
            rebuilt += replacement + segments[i];
          }
          return rebuilt;
        });
      }
    };
  }
  const normalizedPattern = pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
  return {
    resolveCandidates(specifier) {
      if (specifier === normalizedPattern) {
        return targets;
      }
      if (normalizedPattern && specifier.startsWith(normalizedPattern + "/")) {
        const remainder = specifier.slice(normalizedPattern.length + 1);
        return targets.map((target) => path.join(target, remainder));
      }
      return [];
    }
  };
}
function buildAliasEntries(aliases, baseDir) {
  const entries = [];
  for (const [pattern, value] of Object.entries(aliases)) {
    const replacements = Array.isArray(value) ? value : [value];
    const targets = replacements.filter((rep) => typeof rep === "string" && rep.trim().length > 0).map((rep) => {
      if (rep.startsWith("/")) {
        return path.resolve(baseDir, rep.slice(1));
      }
      return path.isAbsolute(rep) ? rep : path.resolve(baseDir, rep);
    });
    if (!targets.length) continue;
    entries.push(createAliasEntry(pattern, targets));
  }
  return entries;
}
function loadTsconfigAliases() {
  if (cachedTsconfigAliases !== void 0) {
    return cachedTsconfigAliases ?? [];
  }
  const rootDir = resolverRootDir();
  for (const configName of CONFIG_FILES) {
    const candidate = path.resolve(rootDir, configName);
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
      continue;
    }
    try {
      const raw = fs.readFileSync(candidate, "utf8");
      const parsed = JSON.parse(raw);
      const compilerOptions = parsed?.compilerOptions ?? {};
      const baseUrl = compilerOptions.baseUrl ? path.resolve(path.dirname(candidate), compilerOptions.baseUrl) : path.dirname(candidate);
      const paths = compilerOptions.paths ?? {};
      cachedTsconfigAliases = buildAliasEntries(paths, baseUrl);
      return cachedTsconfigAliases;
    } catch {
    }
  }
  cachedTsconfigAliases = [];
  return cachedTsconfigAliases;
}
function resolveFromEntries(entries, specifier) {
  const debug = process.env.IONIFY_RESOLVE_DEBUG === "1";
  for (const entry of entries) {
    const candidates = entry.resolveCandidates(specifier);
    if (debug && candidates.length > 0) {
      console.log(`[RESOLVE] Candidates for ${specifier}:`, candidates);
    }
    for (const candidate of candidates) {
      const resolved = tryWithExt(candidate);
      if (resolved) {
        if (debug) console.log(`[RESOLVE] Found: ${resolved}`);
        return resolved;
      }
    }
  }
  return null;
}
function resolveWithAliases(specifier) {
  const debug = process.env.IONIFY_RESOLVE_DEBUG === "1";
  if (debug) {
    console.log(`[RESOLVE] Trying to resolve: ${specifier}`);
    console.log(`[RESOLVE] Custom aliases count: ${customAliasEntries.length}`);
  }
  const custom = resolveFromEntries(customAliasEntries, specifier);
  if (custom) {
    if (debug) console.log(`[RESOLVE] \u2705 Resolved via custom alias: ${custom}`);
    return custom;
  }
  const tsconfigEntries = loadTsconfigAliases();
  if (debug) console.log(`[RESOLVE] Tsconfig aliases count: ${tsconfigEntries.length}`);
  const result = resolveFromEntries(tsconfigEntries, specifier);
  if (debug) {
    if (result) console.log(`[RESOLVE] \u2705 Resolved via tsconfig: ${result}`);
    else console.log(`[RESOLVE] \u274C Not resolved`);
  }
  return result;
}
function configureResolverAliases(aliases, baseDir) {
  customAliasEntries = aliases ? buildAliasEntries(aliases, baseDir) : [];
}
function resolveImport(specifier, importerAbs) {
  const cacheKey = `${importerAbs}\0${specifier}`;
  if (resolvePathCache.has(cacheKey)) {
    return resolvePathCache.get(cacheKey) ?? null;
  }
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    const aliasResolved = resolveWithAliases(specifier);
    if (aliasResolved) {
      resolvePathCache.set(cacheKey, aliasResolved);
      return aliasResolved;
    }
    if (native?.resolveModule) {
      try {
        const resolved2 = native.resolveModule(specifier, importerAbs);
        const kind = resolved2?.kind;
        if (kind && kind !== "Builtin" && kind !== "Virtual" && kind !== "NotFound") {
          const fsPath = resolved2?.fsPath ?? resolved2?.fs_path ?? null;
          if (typeof fsPath === "string" && fsPath.length > 0) {
            resolvePathCache.set(cacheKey, fsPath);
            return fsPath;
          }
        }
      } catch {
      }
    }
    try {
      const require3 = createRequire(importerAbs);
      const resolved2 = require3.resolve(specifier);
      resolvePathCache.set(cacheKey, resolved2);
      return resolved2;
    } catch {
      try {
        const importerUrl = pathToFileURL(importerAbs).href;
        const resolvedUrl = import.meta.resolve(specifier, importerUrl);
        if (resolvedUrl.startsWith("file://")) {
          const resolved2 = fileURLToPath(resolvedUrl);
          resolvePathCache.set(cacheKey, resolved2);
          return resolved2;
        }
        resolvePathCache.set(cacheKey, resolvedUrl);
        return resolvedUrl;
      } catch {
        const nodeModulesPath = path.join(path.dirname(importerAbs), "node_modules", specifier);
        const resolvedNodeModules = tryWithExt(nodeModulesPath);
        if (resolvedNodeModules) {
          resolvePathCache.set(cacheKey, resolvedNodeModules);
          return resolvedNodeModules;
        }
        const srcPath = path.join(resolverRootDir(), "src", specifier);
        const resolvedSrc = tryWithExt(srcPath);
        if (resolvedSrc) {
          resolvePathCache.set(cacheKey, resolvedSrc);
          return resolvedSrc;
        }
        const rootPath = path.join(resolverRootDir(), specifier);
        const resolvedRoot = tryWithExt(rootPath);
        if (resolvedRoot) {
          resolvePathCache.set(cacheKey, resolvedRoot);
          return resolvedRoot;
        }
        resolvePathCache.set(cacheKey, null);
        return null;
      }
    }
  }
  const baseDir = path.dirname(importerAbs);
  const target = path.resolve(baseDir, specifier);
  const resolved = tryWithExt(target);
  resolvePathCache.set(cacheKey, resolved);
  return resolved;
}

// src/cli/utils/env.ts
import fs2 from "fs";
import path2 from "path";
function parseValue(raw) {
  let value = raw.trim();
  if (!value) return "";
  if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  }
  value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
  return value;
}
function parseEnvFile(source) {
  const env = {};
  const lines = source.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_\.]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rest] = match;
    env[key] = parseValue(rest);
  }
  return env;
}
function getModeAliases(mode) {
  const normalized = typeof mode === "string" ? mode.trim() : "";
  return [normalized || "development"];
}
function loadEnv(mode = "development", rootDir = process.cwd()) {
  const [modeName] = getModeAliases(mode);
  const candidates = [".env", ".env.local", `.env.${modeName}`, `.env.${modeName}.local`];
  const merged = {};
  for (const name of candidates) {
    const filePath = path2.resolve(rootDir, name);
    if (!fs2.existsSync(filePath) || !fs2.statSync(filePath).isFile()) {
      continue;
    }
    const contents = fs2.readFileSync(filePath, "utf8");
    const parsed = parseEnvFile(contents);
    Object.assign(merged, parsed);
  }
  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === void 0) {
      process.env[key] = value;
    }
  }
  return {
    ...merged
  };
}

// src/cli/utils/native-config-loader.ts
import fs3 from "fs";
import path3 from "path";
import { createRequire as createRequire2 } from "module";
import { pathToFileURL as pathToFileURL2 } from "url";
var require2 = createRequire2(import.meta.url);
async function importNativeConfigModule(configPath) {
  const ext = path3.extname(configPath).toLowerCase();
  let importUrl;
  let tmpFile = null;
  let helperFile = null;
  const tempPrefix = `.ionify-config.${process.pid}.${Date.now()}`;
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    const source = fs3.readFileSync(configPath, "utf8");
    const helper = ionifyConfigHelperImportPath(source, tempPrefix);
    if (helper) {
      helperFile = path3.join(path3.dirname(configPath), helper.fileName);
      tmpFile = path3.join(path3.dirname(configPath), `${tempPrefix}.mjs`);
      fs3.writeFileSync(helperFile, configHelperModuleSource(), "utf8");
      fs3.writeFileSync(tmpFile, rewriteIonifyConfigHelperImports(source, `./${helper.fileName}`), "utf8");
      importUrl = pathToFileURL2(tmpFile).href;
    } else {
      importUrl = pathToFileURL2(configPath).href;
    }
  } else {
    const source = fs3.readFileSync(configPath, "utf8");
    const helper = ionifyConfigHelperImportPath(source, tempPrefix);
    const rewrittenSource = helper ? rewriteIonifyConfigHelperImports(source, `./${helper.fileName}`) : source;
    const code = transpileConfigToEsm(rewrittenSource, configPath);
    tmpFile = path3.join(path3.dirname(configPath), `${tempPrefix}.mjs`);
    if (helper) {
      helperFile = path3.join(path3.dirname(configPath), helper.fileName);
      fs3.writeFileSync(helperFile, configHelperModuleSource(), "utf8");
    }
    fs3.writeFileSync(tmpFile, code, "utf8");
    importUrl = pathToFileURL2(tmpFile).href;
  }
  try {
    return await import(importUrl);
  } finally {
    if (tmpFile) {
      try {
        fs3.rmSync(tmpFile, { force: true });
      } catch {
      }
    }
    if (helperFile) {
      try {
        fs3.rmSync(helperFile, { force: true });
      } catch {
      }
    }
  }
}
function ionifyConfigHelperImportPath(source, tempPrefix) {
  return /\bfrom\s*["'](?:ionify|@ionify\/ionify)["']/.test(source) ? { fileName: `${tempPrefix}.helper.mjs` } : null;
}
function rewriteIonifyConfigHelperImports(source, helperSpecifier) {
  return source.replace(
    /(\bfrom\s*["'])(?:ionify|@ionify\/ionify)(["'])/g,
    `$1${helperSpecifier}$2`
  );
}
function configHelperModuleSource() {
  return "export function defineConfig(config) { return config; }\n";
}
function transpileConfigToEsm(source, filename) {
  let code = null;
  const native2 = tryNativeTransform("swc", source, { filename, typescript: true, jsx: false });
  if (native2?.code) {
    code = native2.code;
  } else {
    try {
      const swc2 = require2("@swc/core");
      code = swc2.transformSync(source, {
        filename,
        jsc: { parser: { syntax: "typescript", tsx: false }, target: "es2022" },
        module: { type: "es6" },
        sourceMaps: false
      }).code;
    } catch (err) {
      throw new Error(`native transform unavailable and @swc/core fallback failed: ${String(err)}`);
    }
  }
  const usesDirname = /\b__dirname\b/.test(source) || /\b__filename\b/.test(source);
  const declaresDirname = /\b(?:const|let|var)\s+__(?:dir|file)name\b/.test(source);
  if (usesDirname && !declaresDirname) {
    const shim = `import { fileURLToPath as __ionifyFileURLToPath } from "url";
import { dirname as __ionifyDirname } from "path";
const __filename = __ionifyFileURLToPath(import.meta.url);
const __dirname = __ionifyDirname(__filename);
`;
    code = shim + code;
  }
  return code;
}

// src/cli/utils/config.ts
var CONFIG_BASENAMES = [
  "ionify.config.ts",
  "ionify.config.mts",
  "ionify.config.js",
  "ionify.config.mjs",
  "ionify.config.cjs"
];
var cachedConfig = null;
var configLoaded = false;
function resolveConfigMode(mode) {
  return mode || process.env.MODE || process.env.IONIFY_MODE || process.env.NODE_ENV || "development";
}
function buildConfigEnv(mode, rootDir) {
  const env = loadEnv(mode, rootDir);
  const merged = {
    ...env,
    MODE: mode
  };
  if (typeof process.env.NODE_ENV === "string") {
    merged.NODE_ENV = process.env.NODE_ENV;
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string") continue;
    if (key.startsWith("VITE_") || key.startsWith("IONIFY_")) {
      merged[key] = value;
    }
  }
  return merged;
}
function findProjectRoot(startDir) {
  let dir = path4.resolve(startDir);
  for (let i = 0; i < 15; i++) {
    const pkg = path4.join(dir, "package.json");
    try {
      if (fs4.existsSync(pkg) && fs4.statSync(pkg).isFile()) return dir;
    } catch {
    }
    const parent = path4.dirname(dir);
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return null;
}
function findConfigFile(cwd) {
  for (const name of CONFIG_BASENAMES) {
    const candidate = path4.resolve(cwd, name);
    if (fs4.existsSync(candidate) && fs4.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}
async function loadIonifyConfig(cwd = process.cwd(), mode) {
  if (configLoaded) return cachedConfig;
  configLoaded = true;
  const configMode = resolveConfigMode(mode);
  const configPath = findConfigFile(cwd);
  if (!configPath) {
    const projectRoot = findProjectRoot(cwd) ?? cwd;
    cachedConfig = { root: projectRoot };
    configureResolverAliases(void 0, projectRoot);
    delete process.env.IONIFY_RESOLVE_ALIAS;
    delete process.env.IONIFY_BROWSER_BUILTIN_FALLBACK;
    delete process.env.IONIFY_BROWSER_RUNTIME_GLOBALS;
    return cachedConfig;
  }
  try {
    const configDir = path4.dirname(configPath);
    const configEnv = buildConfigEnv(configMode, configDir);
    const imported = await importNativeConfigModule(configPath);
    let resolved = imported?.default ?? imported?.config ?? imported ?? null;
    if (resolved && typeof resolved === "function") {
      resolved = resolved({ mode: configMode, env: configEnv });
    }
    if (resolved && typeof resolved?.then === "function") {
      resolved = await resolved;
    }
    if (resolved && typeof resolved === "object") {
      if (resolved.root) {
        const rootPath = path4.isAbsolute(resolved.root) ? resolved.root : path4.resolve(path4.dirname(configPath), resolved.root);
        if (!fs4.existsSync(rootPath)) {
          logError(`Config error: root directory does not exist: ${rootPath}`);
          throw new Error(`Invalid root: ${rootPath}`);
        }
        if (!fs4.statSync(rootPath).isDirectory()) {
          logError(`Config error: root must be a directory: ${rootPath}`);
          throw new Error(`Invalid root: ${rootPath}`);
        }
        resolved.root = rootPath;
        logInfo(`Using project root: ${path4.relative(cwd, rootPath)}`);
      } else {
        resolved.root = path4.dirname(configPath);
      }
      if (resolved.optimizeDeps?.esbuildOptions) {
        logWarn("optimizeDeps.esbuildOptions is not supported in Ionify (uses native Rust optimizer). This option will be ignored.");
      }
      cachedConfig = resolved;
      const baseDir = typeof resolved.root === "string" && resolved.root.length > 0 ? resolved.root : path4.dirname(configPath);
      const aliases = resolved?.resolve?.alias;
      if (aliases && typeof aliases === "object") {
        configureResolverAliases(aliases, baseDir);
        try {
          process.env.IONIFY_RESOLVE_ALIAS = JSON.stringify(aliases);
        } catch {
          delete process.env.IONIFY_RESOLVE_ALIAS;
        }
      } else {
        configureResolverAliases(void 0, baseDir);
        delete process.env.IONIFY_RESOLVE_ALIAS;
      }
      const builtinFallback = resolved?.resolve?.builtinFallback;
      if (builtinFallback && typeof builtinFallback === "object" && !Array.isArray(builtinFallback)) {
        process.env.IONIFY_BROWSER_BUILTIN_FALLBACK = JSON.stringify(builtinFallback);
      } else {
        delete process.env.IONIFY_BROWSER_BUILTIN_FALLBACK;
      }
      const runtimeGlobals = resolved?.resolve?.runtimeGlobals;
      if (runtimeGlobals && typeof runtimeGlobals === "object" && !Array.isArray(runtimeGlobals)) {
        process.env.IONIFY_BROWSER_RUNTIME_GLOBALS = JSON.stringify(runtimeGlobals);
      } else {
        delete process.env.IONIFY_BROWSER_RUNTIME_GLOBALS;
      }
      logInfo(`Loaded ionify config from ${path4.relative(cwd, configPath)}`);
    } else {
      throw new Error("Config did not export an object");
    }
  } catch (err) {
    logError("Failed to load ionify.config", err);
    cachedConfig = null;
    configureResolverAliases(void 0, cwd);
    delete process.env.IONIFY_RESOLVE_ALIAS;
    delete process.env.IONIFY_BROWSER_BUILTIN_FALLBACK;
    delete process.env.IONIFY_BROWSER_RUNTIME_GLOBALS;
  }
  return cachedConfig;
}

// src/cli/utils/lockfile.ts
import fs5 from "fs";
import path5 from "path";
var LOCKFILE_ORDER = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb"
];
function readLockfile(workspaceRoot, projectRoot) {
  const roots = [workspaceRoot, projectRoot].filter(Boolean);
  const uniqueRoots2 = [];
  for (const r of roots) {
    const abs = path5.resolve(r);
    if (!uniqueRoots2.includes(abs)) uniqueRoots2.push(abs);
  }
  for (const root of uniqueRoots2) {
    for (const name of LOCKFILE_ORDER) {
      const filePath = path5.join(root, name);
      if (!fs5.existsSync(filePath)) continue;
      const contents = fs5.readFileSync(filePath);
      return { name, path: filePath, contents, packageCount: estimateLockfilePackageCount(name, contents) };
    }
  }
  return null;
}
function estimateLockfilePackageCount(name, contents) {
  if (name === "package-lock.json") {
    try {
      const parsed = JSON.parse(contents.toString("utf8"));
      if (parsed?.packages && typeof parsed.packages === "object") {
        return Object.keys(parsed.packages).length;
      }
    } catch {
      return null;
    }
  }
  if (name === "pnpm-lock.yaml") {
    const text = contents.toString("utf8");
    const lines = text.split(/\r?\n/);
    const legacyCount = lines.filter((line) => line.trimStart().startsWith("/")).length;
    if (legacyCount > 0) return legacyCount;
    const packageSectionIndex = lines.findIndex((line) => line.trim() === "packages:");
    if (packageSectionIndex < 0) return null;
    let count = 0;
    for (let i = packageSectionIndex + 1; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (/^\S/.test(line)) break;
      if (/^\s{2}[^#\s].*:\s*$/.test(line)) count++;
    }
    return count;
  }
  if (name === "yarn.lock") {
    const text = contents.toString("utf8");
    return text.split("\n").filter((line) => line && !line.startsWith(" ") && line.endsWith(":")).length;
  }
  return null;
}

// src/cli/utils/minifier.ts
function normalize(value) {
  if (value === "oxc" || value === "swc" || value === "auto") return value;
  if (typeof value === "string") {
    const v = value.toLowerCase();
    if (v === "oxc" || v === "swc" || v === "auto") return v;
  }
  return null;
}
function resolveMinifier(config, opts = {}) {
  const fromCli = normalize(opts.cliFlag);
  if (fromCli) return fromCli;
  const fromEnv = normalize(opts.envVar);
  if (fromEnv) return fromEnv;
  const fromConfig = normalize(config?.minifier);
  if (fromConfig) return fromConfig;
  return "auto";
}

// src/cli/utils/treeshake.ts
var DEFAULT_RESOLUTION = {
  mode: "safe",
  include: [],
  exclude: []
};
function parseMode(value) {
  if (!value) return null;
  switch (value.toLowerCase()) {
    case "off":
    case "false":
      return "off";
    case "aggressive":
      return "aggressive";
    case "safe":
    case "true":
      return "safe";
    default:
      return null;
  }
}
function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === "string" && entry.length > 0);
  }
  return [];
}
function parseEnvList(raw) {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return normalizeList(parsed);
  } catch {
    return null;
  }
}
function extractConfigObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return null;
}
function resolveTreeshake(input, options = {}) {
  let resolved = { ...DEFAULT_RESOLUTION };
  const objectValue = extractConfigObject(input);
  if (objectValue) {
    resolved.include = normalizeList(objectValue.include);
    resolved.exclude = normalizeList(objectValue.exclude);
    if (objectValue.mode) {
      const objectMode = parseMode(objectValue.mode);
      if (objectMode) {
        resolved.mode = objectMode;
      }
    }
  } else if (typeof input === "boolean") {
    resolved.mode = input ? "safe" : "off";
  } else if (typeof input === "string") {
    resolved.mode = parseMode(input) ?? DEFAULT_RESOLUTION.mode;
  }
  const envMode = parseMode(options.envMode);
  if (envMode) {
    resolved.mode = envMode;
  }
  const includeOverride = parseEnvList(options.includeEnv);
  if (includeOverride) {
    resolved.include = includeOverride;
  }
  const excludeOverride = parseEnvList(options.excludeEnv);
  if (excludeOverride) {
    resolved.exclude = excludeOverride;
  }
  return resolved;
}

// src/core/utils/cas.ts
import path6 from "path";
var COMPRESSION_CAS_VERSION = 1;
function getCasArtifactPath(casRoot, versionHash, moduleHash) {
  return path6.join(casRoot, versionHash, moduleHash);
}
function getCompressionCasArtifactPath(casRoot, finalOutputHash, opts) {
  const shard = finalOutputHash.slice(0, 2) || "00";
  const settingsKey = `br${Math.max(0, Math.floor(opts.brotliQuality))}-gz${Math.max(0, Math.floor(opts.gzipLevel))}`;
  return path6.join(casRoot, "compression", `v${COMPRESSION_CAS_VERSION}`, shard, finalOutputHash, settingsKey);
}

// src/core/utils/css-ext.ts
var CSS_LIKE_EXTENSIONS = [".css", ".scss", ".sass", ".less", ".styl"];
function isCssLikeExt(ext) {
  return CSS_LIKE_EXTENSIONS.includes(ext.toLowerCase());
}
function isCssLikePath(p) {
  const clean = p.split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  if (dot < 0) return false;
  return isCssLikeExt(clean.slice(dot));
}
function isCssModuleLikePath(p) {
  const clean = p.split("?")[0].split("#")[0].toLowerCase();
  return /\.module\.(?:css|scss|sass|less|styl)$/.test(clean);
}

// src/cli/utils/scope-hoist.ts
var DEFAULT_SCOPE_HOIST = {
  enable: true,
  inlineFunctions: true,
  constantFolding: true,
  combineVariables: true
};
function parseBool(value) {
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (["true", "1", "yes", "on", "enable"].includes(normalized)) return true;
    if (["false", "0", "no", "off", "disable"].includes(normalized)) return false;
  }
  return null;
}
function parseEnvFlag(value) {
  if (!value) return null;
  return parseBool(value);
}
function resolveScopeHoist(configValue, options = {}) {
  let resolved = { ...DEFAULT_SCOPE_HOIST };
  const scopeConfig = configValue;
  if (typeof scopeConfig === "boolean") {
    resolved.enable = scopeConfig;
  } else if (scopeConfig && typeof scopeConfig === "object") {
    resolved.enable = true;
    if (scopeConfig.inlineFunctions !== void 0) {
      resolved.inlineFunctions = !!scopeConfig.inlineFunctions;
    }
    if (scopeConfig.constantFolding !== void 0) {
      resolved.constantFolding = !!scopeConfig.constantFolding;
    }
    if (scopeConfig.combineVariables !== void 0) {
      resolved.combineVariables = !!scopeConfig.combineVariables;
    }
  }
  const envMode = parseEnvFlag(options.envMode);
  if (envMode !== null) {
    resolved.enable = envMode;
  }
  const inlineEnv = parseEnvFlag(options.inlineEnv);
  if (inlineEnv !== null) {
    resolved.inlineFunctions = inlineEnv;
  } else if (!resolved.enable) {
    resolved.inlineFunctions = false;
  }
  const constantEnv = parseEnvFlag(options.constantEnv);
  if (constantEnv !== null) {
    resolved.constantFolding = constantEnv;
  } else if (!resolved.enable) {
    resolved.constantFolding = false;
  }
  const combineEnv = parseEnvFlag(options.combineEnv);
  if (combineEnv !== null) {
    resolved.combineVariables = combineEnv;
  } else if (!resolved.enable) {
    resolved.combineVariables = false;
  }
  return resolved;
}

// src/cli/utils/optimization-level.ts
function getOptimizationPreset(level) {
  switch (level) {
    case 0:
      return {
        minifier: "swc",
        treeshake: {
          mode: "off",
          include: [],
          exclude: []
        },
        scopeHoist: {
          enable: false,
          inlineFunctions: false,
          constantFolding: false,
          combineVariables: false
        }
      };
    case 1:
      return {
        minifier: "oxc",
        treeshake: {
          mode: "safe",
          include: [],
          exclude: []
        },
        scopeHoist: {
          enable: true,
          inlineFunctions: true,
          constantFolding: false,
          combineVariables: false
        }
      };
    case 2:
      return {
        minifier: "oxc",
        treeshake: {
          mode: "safe",
          include: [],
          exclude: []
        },
        scopeHoist: {
          enable: true,
          inlineFunctions: true,
          constantFolding: true,
          combineVariables: true
        }
      };
    case 3:
      return {
        minifier: "oxc",
        treeshake: {
          mode: "aggressive",
          include: [],
          exclude: []
        },
        scopeHoist: {
          enable: true,
          inlineFunctions: true,
          constantFolding: true,
          combineVariables: true
        }
      };
    default:
      return getOptimizationPreset(2);
  }
}
function resolveOptimizationLevel(configLevel, options = {}) {
  if (options.cliLevel !== void 0) {
    const parsed = typeof options.cliLevel === "number" ? options.cliLevel : parseInt(options.cliLevel, 10);
    if ([0, 1, 2, 3].includes(parsed)) {
      return parsed;
    }
  }
  if (options.envLevel) {
    const parsed = parseInt(options.envLevel, 10);
    if ([0, 1, 2, 3].includes(parsed)) {
      return parsed;
    }
  }
  if (configLevel !== void 0 && [0, 1, 2, 3].includes(configLevel)) {
    return configLevel;
  }
  return null;
}

// src/cli/utils/parser.ts
function normalize2(mode) {
  if (typeof mode !== "string") return null;
  const lower = mode.toLowerCase();
  if (lower === "swc") return "swc";
  if (lower === "hybrid") return "hybrid";
  if (lower === "oxc") return "oxc";
  return null;
}
function resolveParser(config, opts) {
  const envRaw = opts?.envMode ?? process.env.IONIFY_PARSER;
  const env = normalize2(envRaw);
  if (env) return env;
  const fromConfig = normalize2(config?.parser);
  return fromConfig ?? "hybrid";
}
function applyParserEnv(mode) {
  process.env.IONIFY_PARSER = mode;
}

// src/core/bundler.ts
import fs10 from "fs";
import path12 from "path";
import crypto2 from "crypto";

// src/core/loaders/css.ts
import fs7 from "fs";
import path8 from "path";
import crypto from "crypto";
import { performance as performance2 } from "perf_hooks";
import { createRequire as createRequire3 } from "module";
import { pathToFileURL as pathToFileURL3, fileURLToPath as fileURLToPath2 } from "url";
import postcss from "postcss";
import postcssLoadConfig from "postcss-load-config";
import postcssModules from "postcss-modules";

// src/core/loaders/css-demand.ts
import fs6 from "fs";
import path7 from "path";
var CSS_DEMAND_PROOF_VERSION = 1;
var CSS_CLASS_EXTRACTOR_VERSION = 2;
var EMPTY_PROFILE = {
  extractionMs: 0,
  filesScanned: 0,
  cacheHits: 0,
  cacheMisses: 0,
  tokens: 0,
  proofWriteMs: 0
};
var inMemorySourceFacts = /* @__PURE__ */ new Map();
var graphSourceFilesByRoot = /* @__PURE__ */ new Map();
var statKeyedContentHashes = /* @__PURE__ */ new Map();
function statIdentityKey(stat) {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}
function getSourceContentHash(filePath) {
  let stat;
  try {
    stat = fs6.statSync(filePath);
  } catch {
    statKeyedContentHashes.delete(filePath);
    return null;
  }
  if (!stat.isFile()) {
    statKeyedContentHashes.delete(filePath);
    return null;
  }
  const statKey = statIdentityKey(stat);
  const memo = statKeyedContentHashes.get(filePath);
  if (memo && memo.statKey === statKey) return memo.contentHash;
  let raw;
  try {
    raw = fs6.readFileSync(filePath);
  } catch {
    statKeyedContentHashes.delete(filePath);
    return null;
  }
  const contentHash = getCacheKey(raw);
  statKeyedContentHashes.set(filePath, { statKey, contentHash });
  return contentHash;
}
function nowMs() {
  return Date.now();
}
function cloneProfile(profile) {
  return { ...profile };
}
function createCssDemandProfile() {
  return cloneProfile(EMPTY_PROFILE);
}
function isCssDemandSourceFile(filePath) {
  const clean = filePath.split("?")[0].split("#")[0].toLowerCase();
  return clean.endsWith(".js") || clean.endsWith(".jsx") || clean.endsWith(".ts") || clean.endsWith(".tsx") || clean.endsWith(".mdx") || clean.endsWith(".html");
}
function cssDemandRoot(rootDir) {
  return path7.join(process.env.IONIFY_STATE_DIR || path7.join(rootDir, ".ionify"), "css-demand");
}
function canonicalPath(filePath) {
  const abs = path7.resolve(filePath);
  try {
    return fs6.realpathSync.native(abs);
  } catch {
    return abs;
  }
}
function sourceFactPath(rootDir, filePath, contentHash) {
  const key = getCacheKey(`css-demand-source:v${CSS_CLASS_EXTRACTOR_VERSION}:${canonicalPath(filePath)}:${contentHash}`);
  return path7.join(cssDemandRoot(rootDir), "sources", `${key}.json`);
}
function proofPath(rootDir, cssFile, cssHash, pipelineHash) {
  const key = getCacheKey(`css-demand-proof:v${CSS_DEMAND_PROOF_VERSION}:${canonicalPath(cssFile)}:${cssHash}:${pipelineHash}`);
  return path7.join(cssDemandRoot(rootDir), "proofs", `${key}.json`);
}
function readJson(filePath) {
  try {
    return JSON.parse(fs6.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
function writeJson(filePath, value) {
  fs6.mkdirSync(path7.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs6.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}
`, "utf8");
  fs6.renameSync(tmp, filePath);
}
function normalizeToken(token) {
  const value = token.trim();
  if (!value || value.length > 240) return null;
  if (/[\s"'`<>]/.test(value)) return null;
  if (!/[A-Za-z0-9_\-\[\]():/%#.!]/.test(value)) return null;
  return value;
}
function addTokensFromClassString(value, tokens) {
  for (const raw of value.split(/\s+/g)) {
    const token = normalizeToken(raw);
    if (token) tokens.add(token);
  }
}
function dynamicTemplateCanAffectClassDemand(code, templateStart) {
  const prefix = code.slice(Math.max(0, templateStart - 160), templateStart);
  const jsxAttribute = prefix.match(/\b([A-Za-z_:][-A-Za-z0-9_:]*)\s*=\s*\{\s*$/);
  if (!jsxAttribute) return true;
  const attribute = jsxAttribute[1].toLowerCase();
  return attribute !== "alt" && attribute !== "src" && !attribute.startsWith("aria-");
}
function extractClassDemandTokens(code) {
  const tokens = /* @__PURE__ */ new Set();
  const reasons = /* @__PURE__ */ new Set();
  let uncertain = false;
  const classAttrRe = /\b(?:class|className)\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`$]*)`|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`$]*)`)\s*\})/g;
  let match;
  while (match = classAttrRe.exec(code)) {
    addTokensFromClassString(match[1] || match[2] || match[3] || match[4] || match[5] || match[6] || "", tokens);
  }
  const classMapKeyRe = /(?:^|[\s,{])(?:"([^"]+)"|'([^']+)'|`([^`$]+)`)\s*:/g;
  while (match = classMapKeyRe.exec(code)) {
    const value = match[1] || match[2] || match[3] || "";
    if (value.includes(" ") || /[:\[\]\/!-]/.test(value)) addTokensFromClassString(value, tokens);
  }
  const quotedUtilityRe = /(?:"([^"]*[\w\]-](?:[:\[\]\/!-][^"]*)?)"|'([^']*[\w\]-](?:[:\[\]\/!-][^']*)?)'|`([^`$]*[\w\]-](?:[:\[\]\/!-][^`$]*)?)`)/g;
  while (match = quotedUtilityRe.exec(code)) {
    const value = match[1] || match[2] || match[3] || "";
    if (value.includes(" ") || /[:\[\]\/!-]/.test(value)) addTokensFromClassString(value, tokens);
  }
  if (/\b(?:class|className)\s*=\s*\{(?!\s*["'`])/.test(code)) {
    uncertain = true;
    reasons.add("dynamic-class-expression");
  }
  const dynamicTemplateRe = /`[^`]*\$\{/g;
  while (match = dynamicTemplateRe.exec(code)) {
    if (!dynamicTemplateCanAffectClassDemand(code, match.index)) continue;
    uncertain = true;
    reasons.add("dynamic-template-literal");
    break;
  }
  return {
    tokens: Array.from(tokens).sort(),
    uncertain,
    reasons: Array.from(reasons).sort()
  };
}
function loadOrExtractSourceFact(rootDir, filePath, profile) {
  if (!isCssDemandSourceFile(filePath)) return null;
  const contentHash = getSourceContentHash(filePath);
  if (!contentHash) return null;
  const canonical = canonicalPath(filePath);
  const cacheKey = `${canonical}:${contentHash}`;
  const memory = inMemorySourceFacts.get(cacheKey);
  if (memory) {
    profile.cacheHits += 1;
    profile.tokens += memory.tokenCount;
    return memory;
  }
  const diskPath = sourceFactPath(rootDir, filePath, contentHash);
  const disk = readJson(diskPath);
  if (disk && disk.version === CSS_DEMAND_PROOF_VERSION && disk.extractorVersion === CSS_CLASS_EXTRACTOR_VERSION && disk.filePath === canonical && disk.contentHash === contentHash && Array.isArray(disk.tokens)) {
    inMemorySourceFacts.set(cacheKey, disk);
    profile.cacheHits += 1;
    profile.tokens += disk.tokenCount;
    return disk;
  }
  let code;
  try {
    code = fs6.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const started = nowMs();
  const extracted = extractClassDemandTokens(code);
  const fact = {
    version: CSS_DEMAND_PROOF_VERSION,
    extractorVersion: CSS_CLASS_EXTRACTOR_VERSION,
    filePath: canonical,
    contentHash,
    tokens: extracted.tokens,
    tokenCount: extracted.tokens.length,
    uncertain: extracted.uncertain,
    uncertaintyReasons: extracted.reasons
  };
  profile.extractionMs += nowMs() - started;
  profile.filesScanned += 1;
  profile.cacheMisses += 1;
  profile.tokens += fact.tokenCount;
  inMemorySourceFacts.set(cacheKey, fact);
  try {
    writeJson(diskPath, fact);
  } catch {
  }
  return fact;
}
function buildCssDemandAnalysis(options) {
  const profile = createCssDemandProfile();
  const sourceFacts = [];
  const seen = /* @__PURE__ */ new Set();
  const sortedDeps = Array.from(new Set(options.deps.map((dep) => canonicalPath(dep)))).sort();
  for (const dep of sortedDeps) {
    if (seen.has(dep)) continue;
    seen.add(dep);
    const fact = loadOrExtractSourceFact(options.rootDir, dep, profile);
    if (fact) sourceFacts.push(fact);
  }
  if (sourceFacts.length === 0) return null;
  const tokenSet = /* @__PURE__ */ new Set();
  const uncertaintyReasons = /* @__PURE__ */ new Set();
  let uncertain = false;
  for (const fact of sourceFacts) {
    for (const token of fact.tokens) tokenSet.add(token);
    if (fact.uncertain) uncertain = true;
    for (const reason of fact.uncertaintyReasons) uncertaintyReasons.add(reason);
  }
  const tokens = Array.from(tokenSet).sort();
  const dependencyHash = getCacheKey(sortedDeps.map((dep) => {
    const fact = sourceFacts.find((item) => item.filePath === dep);
    return `${dep}:${fact?.contentHash ?? "unknown"}`;
  }).join("|"));
  const proof = {
    proofVersion: CSS_DEMAND_PROOF_VERSION,
    extractorVersion: CSS_CLASS_EXTRACTOR_VERSION,
    cssFile: canonicalPath(options.cssFile),
    cssHash: options.cssHash,
    pipelineHash: options.pipelineHash,
    dependencyCount: sortedDeps.length,
    dependencyHash,
    classDemandHash: getCacheKey(tokens.join(" ")),
    tokenCount: tokens.length,
    sourceFiles: sourceFacts.map((fact) => ({
      filePath: fact.filePath,
      contentHash: fact.contentHash,
      tokenCount: fact.tokenCount,
      uncertain: fact.uncertain
    })).sort((a, b) => a.filePath.localeCompare(b.filePath)),
    uncertain,
    uncertaintyReasons: Array.from(uncertaintyReasons).sort()
  };
  const writeStart = nowMs();
  try {
    writeJson(proofPath(options.rootDir, options.cssFile, options.cssHash, options.pipelineHash), proof);
  } catch {
  } finally {
    profile.proofWriteMs += nowMs() - writeStart;
  }
  return { proof, profile };
}
function registerCssDemandGraphSourceFiles(rootDir, files, options) {
  if (options?.stableTopology) {
    const persisted = readJson(graphStampIndexPath(rootDir));
    const persistedPaths = persisted?.version === 2 && persisted.extractorVersion === CSS_CLASS_EXTRACTOR_VERSION ? Object.keys(persisted.entries) : [];
    if (persistedPaths.length > 0) {
      const canonicalRoot = canonicalPath(rootDir);
      const stableFiles = persistedPaths.sort().map((relative) => path7.join(canonicalRoot, relative));
      graphSourceFilesByRoot.set(canonicalRoot, stableFiles);
      return stableFiles;
    }
  }
  const canonicalFiles = files.map((item) => canonicalPath(item)).filter((item) => isCssDemandSourceFile(item)).sort();
  const unique = Array.from(new Set(canonicalFiles));
  graphSourceFilesByRoot.set(canonicalPath(rootDir), unique);
  return unique;
}
function getCssDemandGraphSourceFiles(rootDir) {
  return graphSourceFilesByRoot.get(canonicalPath(rootDir))?.slice() ?? [];
}
function graphStampIndexPath(rootDir) {
  return path7.join(cssDemandRoot(rootDir), "graph-stamp.v2.json");
}
function computePersistedStableTopologyStamp(rootDir, changedFiles, persisted) {
  const rootCanonical = canonicalPath(rootDir);
  const previousEntries = persisted.entries;
  const persistedFileCount = Number.isInteger(persisted.files) && persisted.files > 0 ? persisted.files : Object.keys(previousEntries).length;
  if (persistedFileCount === 0) return null;
  let previousStamp = typeof persisted.stamp === "string" && persisted.stamp.length > 0 ? persisted.stamp : null;
  if (!previousStamp) {
    const previousDemandEntries = Object.values(previousEntries).map((entry) => entry.demandEntry).sort();
    if (previousDemandEntries.length === 0) return null;
    previousStamp = getCacheKey(
      `css-demand-graph-stamp:v2
${previousDemandEntries.join("\n")}`
    );
  }
  const profile = createCssDemandProfile();
  const changedEntries = /* @__PURE__ */ new Map();
  for (const changedFile of changedFiles) {
    const canonical = canonicalPath(changedFile);
    const rel = path7.relative(rootCanonical, canonical).split(path7.sep).join("/");
    if (rel.startsWith("../")) return null;
    if (!previousEntries[rel]) {
      continue;
    }
    let stat;
    try {
      stat = fs6.statSync(canonical);
    } catch {
      return null;
    }
    if (!stat.isFile()) return null;
    const fact = loadOrExtractSourceFact(rootDir, canonical, profile);
    if (!fact) return null;
    const demandIdentity = fact.uncertain ? `content:${fact.contentHash}` : `demand:${getCacheKey(fact.tokens.join("\n"))}`;
    const nextEntry = {
      statKey: statIdentityKey(stat),
      demandEntry: `${rel}:extractor=${fact.extractorVersion}:uncertain=${fact.uncertain ? 1 : 0}:reasons=${fact.uncertaintyReasons.join(",")}:${demandIdentity}`
    };
    if (previousEntries[rel].demandEntry !== nextEntry.demandEntry) {
      changedEntries.set(rel, nextEntry);
    }
  }
  if (changedEntries.size === 0) {
    if (persisted.stamp !== previousStamp || persisted.files !== persistedFileCount) {
      try {
        writeJson(graphStampIndexPath(rootDir), {
          ...persisted,
          stamp: previousStamp,
          files: persistedFileCount
        });
      } catch {
      }
    }
    return {
      files: persistedFileCount,
      stamp: previousStamp,
      changed: false
    };
  }
  const nextEntries = { ...previousEntries };
  for (const [relative, entry] of changedEntries) nextEntries[relative] = entry;
  const entries = Object.values(nextEntries).map((entry) => entry.demandEntry).sort();
  const stamp = getCacheKey(`css-demand-graph-stamp:v2
${entries.join("\n")}`);
  try {
    writeJson(graphStampIndexPath(rootDir), {
      version: 2,
      extractorVersion: CSS_CLASS_EXTRACTOR_VERSION,
      stamp,
      files: entries.length,
      entries: nextEntries
    });
  } catch {
  }
  return {
    files: entries.length,
    stamp,
    changed: previousStamp !== stamp
  };
}
function refreshCssDemandGraphContentStamp(rootDir, changedFiles) {
  const persisted = readJson(graphStampIndexPath(rootDir));
  if (persisted?.version !== 2 || persisted.extractorVersion !== CSS_CLASS_EXTRACTOR_VERSION) {
    return null;
  }
  return computePersistedStableTopologyStamp(rootDir, changedFiles, persisted);
}
function requiresCssDemandGraphContentStamp(facts) {
  if (facts.length === 0) return false;
  return facts.some((fact) => fact === null || fact.enabled === true && fact.files > 0);
}
function computeCssDemandGraphContentStamp(rootDir, options) {
  const files = getCssDemandGraphSourceFiles(rootDir);
  if (files.length === 0) return null;
  const rootCanonical = canonicalPath(rootDir);
  const profile = createCssDemandProfile();
  const indexPath = graphStampIndexPath(rootDir);
  const persisted = readJson(indexPath);
  const previousEntries = persisted?.version === 2 && persisted.extractorVersion === CSS_CLASS_EXTRACTOR_VERSION ? persisted.entries : {};
  const previousStamp = typeof persisted?.stamp === "string" && persisted.stamp.length > 0 ? persisted.stamp : (() => {
    const previousDemandEntries = Object.values(previousEntries).map((entry) => entry.demandEntry).sort();
    return previousDemandEntries.length > 0 ? getCacheKey(`css-demand-graph-stamp:v2
${previousDemandEntries.join("\n")}`) : null;
  })();
  const stableChangedFiles = options?.stableTopologyChangedFiles;
  if (stableChangedFiles && previousStamp && Object.keys(previousEntries).length === files.length) {
    return computePersistedStableTopologyStamp(rootDir, stableChangedFiles, persisted);
  }
  const nextEntries = {};
  const entries = [];
  for (const file of files) {
    const rel = path7.relative(rootCanonical, file).split(path7.sep).join("/");
    let stat;
    try {
      stat = fs6.statSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const statKey = statIdentityKey(stat);
    const previous = previousEntries[rel];
    if (previous?.statKey === statKey && typeof previous.demandEntry === "string") {
      nextEntries[rel] = previous;
      entries.push(previous.demandEntry);
      continue;
    }
    const fact = loadOrExtractSourceFact(rootDir, file, profile);
    if (!fact) continue;
    const demandIdentity = fact.uncertain ? `content:${fact.contentHash}` : `demand:${getCacheKey(fact.tokens.join("\n"))}`;
    const demandEntry = `${rel}:extractor=${fact.extractorVersion}:uncertain=${fact.uncertain ? 1 : 0}:reasons=${fact.uncertaintyReasons.join(",")}:${demandIdentity}`;
    nextEntries[rel] = { statKey, demandEntry };
    entries.push(demandEntry);
  }
  entries.sort();
  const stamp = getCacheKey(`css-demand-graph-stamp:v2
${entries.join("\n")}`);
  try {
    writeJson(indexPath, {
      version: 2,
      extractorVersion: CSS_CLASS_EXTRACTOR_VERSION,
      stamp,
      files: entries.length,
      entries: nextEntries
    });
  } catch {
  }
  return {
    files: entries.length,
    stamp,
    changed: previousStamp !== stamp
  };
}

// src/core/loaders/css.ts
function detectPreprocessorLang(filePath) {
  const ext = path8.extname(filePath.split("?")[0].split("#")[0]).toLowerCase();
  if (ext === ".scss") return "scss";
  if (ext === ".sass") return "sass";
  if (ext === ".less") return "less";
  if (ext === ".styl" || ext === ".stylus") return "styl";
  return null;
}
function loadProjectPreprocessor(name, rootDir, fromFile) {
  for (const base of [fromFile, path8.join(rootDir, "package.json")]) {
    try {
      const req = createRequire3(base);
      req.resolve(name);
      return req(name);
    } catch {
    }
  }
  try {
    return createRequire3(__filename ?? fromFile)(name);
  } catch {
    return null;
  }
}
async function runPreprocessor(code, filePath, rootDir, lang, options) {
  const deps = [];
  if (lang === "scss" || lang === "sass") {
    const sass = loadProjectPreprocessor("sass", rootDir, filePath);
    if (!sass) {
      throw new Error(
        `[ionify:css] "${path8.basename(filePath)}" requires the "sass" package \u2014 install it in your project: pnpm add -D sass`
      );
    }
    const langOpts = options?.[lang] ?? options?.scss ?? {};
    const result = sass.compileString(code, {
      syntax: lang === "sass" ? "indented" : "scss",
      url: pathToFileURL3(filePath),
      loadPaths: [path8.dirname(filePath), rootDir, path8.join(rootDir, "node_modules")],
      ...langOpts
    });
    for (const u of result.loadedUrls ?? []) {
      try {
        const p = fileURLToPath2(u);
        if (p && p !== filePath) deps.push(p);
      } catch {
      }
    }
    return { css: result.css, deps, version: `sass:${String(sass.info ?? "").split("	")[1] ?? ""}` };
  }
  if (lang === "less") {
    const less = loadProjectPreprocessor("less", rootDir, filePath);
    if (!less) {
      throw new Error(
        `[ionify:css] "${path8.basename(filePath)}" requires the "less" package \u2014 install it in your project: pnpm add -D less`
      );
    }
    const langOpts = options?.less ?? {};
    const result = await less.render(code, {
      filename: filePath,
      paths: [path8.dirname(filePath), rootDir],
      ...langOpts
    });
    for (const p of result.imports ?? []) {
      if (p && p !== filePath) deps.push(p);
    }
    return { css: result.css, deps, version: `less:${String((less.version ?? []).join?.(".") ?? less.version ?? "")}` };
  }
  throw new Error(
    `[ionify:css] Stylus (.styl) is not yet wired into Ionify's preprocessor pre-pass \u2014 Sass/SCSS and Less are supported. (Native-Rust + Stylus are future-planned: css-pipeline-contract \xA78.)`
  );
}
var cachedPostcssConfigByRoot = /* @__PURE__ */ new Map();
var pendingPostcssConfigByRoot = /* @__PURE__ */ new Map();
var postcssConfigFailedRoots = /* @__PURE__ */ new Set();
async function getPostcssConfigProfiled(rootDir) {
  const key = path8.resolve(rootDir);
  const cached = cachedPostcssConfigByRoot.get(key);
  if (cached) return { config: cached, loadMs: 0, waitMs: 0, cacheHit: true };
  const pending = pendingPostcssConfigByRoot.get(key);
  if (pending) {
    const started2 = cssProfileNow();
    return { config: await pending, loadMs: 0, waitMs: cssProfileNow() - started2, cacheHit: false };
  }
  if (postcssConfigFailedRoots.has(key)) {
    const empty = { plugins: [], options: {}, configFile: null };
    cachedPostcssConfigByRoot.set(key, empty);
    return { config: empty, loadMs: 0, waitMs: 0, cacheHit: true };
  }
  const started = cssProfileNow();
  const load = (async () => {
    try {
      const result = await postcssLoadConfig({}, rootDir);
      const configFile = typeof result?.file === "string" ? result.file : null;
      const loaded = {
        plugins: Array.isArray(result.plugins) ? result.plugins : [],
        options: result.options ?? {},
        configFile
      };
      cachedPostcssConfigByRoot.set(key, loaded);
      return loaded;
    } catch {
      postcssConfigFailedRoots.add(key);
      const empty = { plugins: [], options: {}, configFile: null };
      cachedPostcssConfigByRoot.set(key, empty);
      return empty;
    } finally {
      pendingPostcssConfigByRoot.delete(key);
    }
  })();
  pendingPostcssConfigByRoot.set(key, load);
  return { config: await load, loadMs: cssProfileNow() - started, waitMs: 0, cacheHit: false };
}
async function getPostcssConfig(rootDir) {
  return (await getPostcssConfigProfiled(rootDir)).config;
}
function stablePluginName(plugin) {
  if (!plugin || typeof plugin !== "function") return "unknown";
  const anyPlugin = plugin;
  if (typeof anyPlugin.postcssPlugin === "string" && anyPlugin.postcssPlugin.length > 0) {
    return anyPlugin.postcssPlugin;
  }
  if (typeof anyPlugin.name === "string" && anyPlugin.name.length > 0) return anyPlugin.name;
  if (typeof plugin.toString === "function") {
    return "anonymous";
  }
  return "unknown";
}
function cssProfileNow() {
  return performance2.now();
}
function addCssTiming(timings, label, ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  timings.set(label, (timings.get(label) ?? 0) + ms);
}
function labelPostcssPlugin(plugin, index) {
  const anyPlugin = plugin;
  const direct = typeof anyPlugin?.postcssPlugin === "string" && anyPlugin.postcssPlugin.length > 0 ? anyPlugin.postcssPlugin : typeof anyPlugin?.name === "string" && anyPlugin.name.length > 0 ? anyPlugin.name : "";
  return direct || `postcss-plugin-${index}`;
}
function timeMaybePromise(timings, label, started, value) {
  if (value && typeof value.then === "function") {
    return value.finally(() => addCssTiming(timings, label, cssProfileNow() - started));
  }
  addCssTiming(timings, label, cssProfileNow() - started);
  return value;
}
function wrapPostcssVisitorObject(visitor, label, timings) {
  if (!visitor || typeof visitor !== "object") return visitor;
  const source = visitor;
  const out = Array.isArray(source) ? [...source] : { ...source };
  for (const key of Object.keys(out)) {
    if (key === "postcssPlugin") continue;
    const value = out[key];
    if (typeof value === "function") {
      out[key] = function timedPostcssVisitor(...args) {
        const started = cssProfileNow();
        const result = value.apply(this, args);
        if (key === "prepare" && result && typeof result === "object" && typeof result.then !== "function") {
          addCssTiming(timings, label, cssProfileNow() - started);
          return wrapPostcssVisitorObject(result, label, timings);
        }
        if (key === "prepare" && result && typeof result.then === "function") {
          return result.then((prepared) => {
            addCssTiming(timings, label, cssProfileNow() - started);
            return wrapPostcssVisitorObject(prepared, label, timings);
          });
        }
        return timeMaybePromise(timings, label, started, result);
      };
      continue;
    }
    if (value && typeof value === "object") {
      out[key] = wrapPostcssVisitorObject(value, label, timings);
    }
  }
  return out;
}
function wrapPostcssPluginsForTiming(plugins, timings) {
  return plugins.map((plugin, index) => {
    const label = labelPostcssPlugin(plugin, index);
    if (typeof plugin === "function") {
      const original = plugin;
      const wrapped = function timedPostcssPlugin(...args) {
        const started = cssProfileNow();
        const result = original.apply(this, args);
        if (result && typeof result === "object" && typeof result.then !== "function") {
          addCssTiming(timings, label, cssProfileNow() - started);
          return wrapPostcssVisitorObject(result, label, timings);
        }
        if (result && typeof result.then === "function") {
          return result.then((prepared) => {
            addCssTiming(timings, label, cssProfileNow() - started);
            return wrapPostcssVisitorObject(prepared, label, timings);
          });
        }
        return timeMaybePromise(timings, label, started, result);
      };
      Object.assign(wrapped, original);
      return wrapped;
    }
    return wrapPostcssVisitorObject(plugin, label, timings);
  });
}
function classifyPostcssPluginTimings(timings) {
  let tailwindPluginMs = 0;
  let autoprefixerPluginMs = 0;
  let rtlcssPluginMs = 0;
  let otherPostcssPluginMs = 0;
  const entries = Object.entries(timings).sort(([a], [b]) => a.localeCompare(b));
  for (const [label, ms] of entries) {
    const normalized = label.toLowerCase();
    if (normalized.includes("tailwind")) {
      tailwindPluginMs += ms;
    } else if (normalized.includes("autoprefixer") || normalized === "plugin") {
      autoprefixerPluginMs += ms;
    } else if (normalized.includes("rtlcss")) {
      rtlcssPluginMs += ms;
    } else {
      otherPostcssPluginMs += ms;
    }
  }
  return { tailwindPluginMs, autoprefixerPluginMs, rtlcssPluginMs, otherPostcssPluginMs };
}
function emptyTailwindGraphContentProfile(fallbackReason) {
  return {
    attempted: false,
    enabled: false,
    ms: 0,
    files: 0,
    plugins: 0,
    configPath: null,
    fallbackReason
  };
}
function findTailwindConfigPath(rootDir) {
  const candidates = [
    "tailwind.config.js",
    "tailwind.config.cjs",
    "tailwind.config.mjs",
    "tailwind.config.ts",
    "tailwind.config.cts",
    "tailwind.config.mts"
  ];
  for (const candidate of candidates) {
    const abs = path8.join(rootDir, candidate);
    if (fs7.existsSync(abs)) return abs;
  }
  return null;
}
function isTailwindPluginFactory(plugin) {
  if (typeof plugin !== "function") return false;
  const fn = plugin;
  if (fn.name === "tailwindcss" && fn.postcss === true) return true;
  const source = typeof fn.toString === "function" ? fn.toString() : "";
  return fn.postcss === true && source.includes('postcssPlugin: "tailwindcss"');
}
function cssMayUseTailwindSyntax(css) {
  return /@(?:tailwind|apply|config|import|layer|screen|variants|responsive|theme|utility|variant|custom-variant)\b|\b(?:theme|screen)\s*\(/.test(css);
}
function cssNeedsTailwindContentScan(css) {
  return /@tailwind\s+utilities\b|@(?:source|plugin)\b/.test(css);
}
function graphTailwindContent(originalContent, files) {
  if (originalContent && typeof originalContent === "object" && !Array.isArray(originalContent)) {
    return {
      ...originalContent,
      files
    };
  }
  return { files };
}
function stripPresetContent(preset) {
  if (!preset || typeof preset !== "object" || Array.isArray(preset)) return preset;
  const input = preset;
  const output = {};
  for (const key of Object.keys(input)) {
    if (key === "content") continue;
    output[key] = key === "presets" && Array.isArray(input[key]) ? input[key].map(stripPresetContent) : input[key];
  }
  return output;
}
function cloneTailwindConfigForGraphContent(config, files) {
  const source = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  return {
    ...source,
    content: graphTailwindContent(source.content, files),
    presets: Array.isArray(source.presets) ? source.presets.map(stripPresetContent) : source.presets
  };
}
function createTailwindGraphContentPipeline(rootDir, css, plugins, contentAuthority) {
  const started = Date.now();
  const tailwindIndexes = plugins.map((plugin, index) => isTailwindPluginFactory(plugin) ? index : -1).filter((index) => index >= 0);
  if (tailwindIndexes.length === 0) return { plugins, profile: emptyTailwindGraphContentProfile("no-tailwind-plugin") };
  if (!cssMayUseTailwindSyntax(css)) {
    const tailwindIndexSet = new Set(tailwindIndexes);
    return {
      plugins: plugins.filter((_plugin, index) => !tailwindIndexSet.has(index)),
      profile: {
        ...emptyTailwindGraphContentProfile("no-tailwind-syntax"),
        attempted: true,
        ms: Date.now() - started,
        plugins: tailwindIndexes.length
      }
    };
  }
  if (contentAuthority.mode === "config-globs") {
    return { plugins, profile: emptyTailwindGraphContentProfile("content-authority-config-globs") };
  }
  const graphFiles = contentAuthority.files;
  if (graphFiles.length === 0) return { plugins, profile: emptyTailwindGraphContentProfile("no-graph-source-files") };
  const configPath = findTailwindConfigPath(rootDir);
  if (!configPath) return { plugins, profile: emptyTailwindGraphContentProfile("no-tailwind-config") };
  try {
    const req = createRequire3(path8.join(rootDir, "package.json"));
    const tailwindFactory = req("tailwindcss");
    const tailwindEntry = req.resolve("tailwindcss");
    const loadConfigPath = [
      path8.join(path8.dirname(tailwindEntry), "lib", "load-config.js"),
      path8.join(path8.dirname(tailwindEntry), "lib", "lib", "load-config.js")
    ].find((candidate) => fs7.existsSync(candidate)) ?? path8.join(path8.dirname(tailwindEntry), "lib", "load-config.js");
    const loadConfigModule = req(loadConfigPath);
    if (typeof tailwindFactory !== "function" || typeof loadConfigModule.loadConfig !== "function") {
      return {
        plugins,
        profile: {
          ...emptyTailwindGraphContentProfile("tailwind-loader-unavailable"),
          attempted: true,
          ms: Date.now() - started,
          files: graphFiles.length,
          configPath
        }
      };
    }
    const userConfig = loadConfigModule.loadConfig(configPath);
    const contentFiles = cssNeedsTailwindContentScan(css) ? graphFiles : [];
    const graphConfig = cloneTailwindConfigForGraphContent(userConfig, contentFiles);
    let replaced = 0;
    const nextPlugins = plugins.map((plugin, index) => {
      if (!tailwindIndexes.includes(index)) return plugin;
      replaced += 1;
      return tailwindFactory(graphConfig);
    });
    return {
      plugins: nextPlugins,
      profile: {
        attempted: true,
        enabled: replaced > 0,
        ms: Date.now() - started,
        files: contentFiles.length,
        plugins: replaced,
        configPath,
        fallbackReason: replaced > 0 ? null : "tailwind-plugin-not-replaced"
      }
    };
  } catch (err) {
    return {
      plugins,
      profile: {
        ...emptyTailwindGraphContentProfile(`tailwind-graph-content-error:${String(err).split("\n")[0]}`),
        attempted: true,
        ms: Date.now() - started,
        files: graphFiles.length,
        configPath
      }
    };
  }
}
function sortObjectKeys(value) {
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = value[key];
  }
  return out;
}
function resolveCssSpecifier(spec, filePath, rootDir) {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  if (/^(data:|https?:|\/\/)/i.test(trimmed)) return null;
  if (trimmed.startsWith("/")) return path8.resolve(rootDir, "." + trimmed);
  if (trimmed.startsWith("@/")) return path8.resolve(rootDir, "src", trimmed.slice(2));
  if (trimmed.startsWith(".") || trimmed.startsWith("..")) return path8.resolve(path8.dirname(filePath), trimmed);
  const specifier = trimmed.startsWith("~") ? trimmed.slice(1) : trimmed;
  try {
    return createRequire3(filePath).resolve(specifier);
  } catch {
    return path8.resolve(path8.dirname(filePath), trimmed);
  }
}
function discoverUrlDeps(css, filePath, rootDir) {
  const deps = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (p) => {
    if (!p) return;
    const norm = p.replace(/\\+/g, "/");
    if (seen.has(norm)) return;
    seen.add(norm);
    deps.push(p);
  };
  const urlRe = /url\(\s*(?:'([^']+)'|"([^"]+)"|([^'"\s)]+))\s*\)/gi;
  let match;
  while (match = urlRe.exec(css)) {
    const spec = (match[1] || match[2] || match[3] || "").trim();
    add(resolveCssSpecifier(spec, filePath, rootDir));
  }
  return deps;
}
var POSTCSS_DIR_DEPENDENCY_MAX_FILES = 5e3;
function normalizeDependencyPath(depPath, rootDir, fromFile) {
  const value = String(depPath || "").trim();
  if (!value) return null;
  if (/^(?:data:|https?:|\/\/)/i.test(value)) return null;
  return path8.isAbsolute(value) ? path8.resolve(value) : path8.resolve(path8.dirname(fromFile) || rootDir, value);
}
function globToRegExp(glob) {
  const normalized = glob.replace(/\\+/g, "/").replace(/^\.\//, "");
  let out = "^";
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === "*") {
      if (normalized[i + 1] === "*") {
        if (normalized[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    if (ch === "{") {
      const end = normalized.indexOf("}", i + 1);
      if (end !== -1) {
        const body = normalized.slice(i + 1, end);
        const parts = body.split(",").map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"));
        out += `(?:${parts.join("|")})`;
        i = end;
        continue;
      }
    }
    out += ch.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  out += "$";
  return new RegExp(out);
}
function expandDirectoryDependency(dir, glob) {
  const deps = [];
  const root = path8.resolve(dir);
  if (!fs7.existsSync(root)) return deps;
  const stat = fs7.statSync(root);
  if (!stat.isDirectory()) return stat.isFile() ? [root] : deps;
  const re = globToRegExp(glob && glob.trim() ? glob : "**/*");
  const visit = (current) => {
    if (deps.length >= POSTCSS_DIR_DEPENDENCY_MAX_FILES) return;
    let entries;
    try {
      entries = fs7.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (deps.length >= POSTCSS_DIR_DEPENDENCY_MAX_FILES) return;
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".ionify" || entry.name === "dist") {
        continue;
      }
      const abs = path8.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path8.relative(root, abs).replace(/\\+/g, "/");
      if (re.test(rel)) deps.push(abs);
    }
  };
  visit(root);
  return deps;
}
function collectPostcssMessageDeps(messages, rootDir, filePath, tailwindGraphFiles = null) {
  const deps = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (depPath, plugin) => {
    if (!depPath) return;
    const normalized = path8.resolve(depPath).replace(/\\+/g, "/");
    if (plugin === "tailwindcss" && tailwindGraphFiles?.has(normalized)) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    deps.push(depPath);
  };
  for (const message of messages) {
    const msg = message;
    if (!msg || typeof msg !== "object") continue;
    if ((msg.type === "dependency" || msg.type === "build-dependency" || msg.type === "missing-dependency") && typeof msg.file === "string") {
      add(normalizeDependencyPath(msg.file, rootDir, filePath), msg.plugin);
      continue;
    }
    if (msg.type === "dir-dependency" && typeof msg.dir === "string") {
      const baseDir = normalizeDependencyPath(msg.dir, rootDir, filePath);
      if (!baseDir) continue;
      for (const dep of expandDirectoryDependency(baseDir, typeof msg.glob === "string" ? msg.glob : null)) {
        add(dep, msg.plugin);
      }
      continue;
    }
    if (msg.type === "context-dependency") {
      const raw = typeof msg.dir === "string" ? msg.dir : typeof msg.file === "string" ? msg.file : null;
      const dep = raw ? normalizeDependencyPath(raw, rootDir, filePath) : null;
      if (!dep) continue;
      if (fs7.existsSync(dep) && fs7.statSync(dep).isDirectory()) {
        for (const child of expandDirectoryDependency(dep, typeof msg.glob === "string" ? msg.glob : null)) {
          add(child, msg.plugin);
        }
      } else {
        add(dep, msg.plugin);
      }
    }
  }
  return deps;
}
function rewriteCssUrls(css, fromFsPath, rootDir, mapTarget) {
  const urlRe = /url\(\s*(?:'([^']*)'|"([^"]*)"|([^'")\s]+))\s*\)/gi;
  return css.replace(urlRe, (full, sQuote, dQuote, bare) => {
    const spec = (sQuote ?? dQuote ?? bare ?? "").trim();
    if (!spec) return full;
    if (/^(?:data:|https?:|\/\/|#|\/)/i.test(spec)) return full;
    const abs = resolveCssSpecifier(spec, fromFsPath, rootDir);
    if (!abs) return full;
    const replacement = mapTarget(abs, spec);
    if (!replacement || replacement === spec) return full;
    const quote = sQuote != null ? "'" : '"';
    return `url(${quote}${replacement}${quote})`;
  });
}
async function computePipelineHash(rootDir, modules, modulesOptions, preprocessor) {
  const { plugins, options, configFile } = await getPostcssConfig(rootDir);
  const pluginNames = plugins.map(stablePluginName).filter(Boolean).sort();
  let configFileHash = null;
  let configFileId = null;
  if (configFile && fs7.existsSync(configFile)) {
    try {
      const raw = fs7.readFileSync(configFile);
      configFileHash = getCacheKey(raw);
      const abs = path8.resolve(configFile);
      const rel = path8.relative(rootDir, abs).replace(/\\+/g, "/");
      configFileId = rel && !rel.startsWith("../") ? rel : path8.basename(abs);
    } catch {
      configFileHash = null;
    }
  }
  const normalizedModules = modules && modulesOptions ? {
    localsConvention: typeof modulesOptions.localsConvention === "string" ? modulesOptions.localsConvention : null,
    generateScopedName: typeof modulesOptions.generateScopedName === "string" ? modulesOptions.generateScopedName : typeof modulesOptions.generateScopedName === "function" ? "function" : null
  } : null;
  const normalizedOptions = {
    map: options?.map ?? null
  };
  const payload = {
    schema: "ionify:css-pipeline:v1",
    configFile: configFileId,
    configFileHash,
    pluginNames,
    options: normalizedOptions,
    modules: modules ? 1 : 0,
    modulesOptions: normalizedModules
  };
  if (preprocessor) {
    let optionsTag = null;
    try {
      optionsTag = preprocessor.options ? JSON.stringify(preprocessor.options) : null;
    } catch {
      optionsTag = "<unserializable>";
    }
    payload.preprocessor = { lang: preprocessor.lang, version: preprocessor.version, options: optionsTag };
  }
  return getCacheKey(JSON.stringify(payload));
}
function createScopedNameGenerator({
  rootDir,
  filePath,
  modulesOptions
}) {
  const custom = modulesOptions?.generateScopedName;
  if (typeof custom === "function") {
    return (name, filename, css) => custom(name, filename, css);
  }
  if (typeof custom === "string" && custom.trim().length > 0) {
    const pattern = custom;
    return (name, filename) => {
      const baseName = path8.basename(filename || filePath).replace(/\.[^.]+$/, "");
      const rel = path8.relative(rootDir, filename || filePath).replace(/\\+/g, "/");
      const hashHex = crypto.createHash("sha256").update(`${rel}:${name}`).digest("hex");
      return pattern.replace(/\[name\]/g, baseName).replace(/\[local\]/g, name).replace(/\[hash(?::(hex|base64))?(?::(\d+))?\]/g, (_m, enc, lenRaw) => {
        const len = lenRaw ? Math.max(1, Math.min(32, Number(lenRaw))) : 6;
        if (enc === "base64") {
          const b64 = Buffer.from(hashHex, "hex").toString("base64url");
          return b64.slice(0, len);
        }
        return hashHex.slice(0, len);
      });
    };
  }
  return (name, filename) => {
    const relative = path8.relative(rootDir, filename || filePath).replace(/\\+/g, "/");
    const seed = crypto.createHash("sha1").update(relative).digest("hex").slice(0, 6);
    return `${name}___${seed}`;
  };
}
async function compileCss({
  code,
  filePath,
  rootDir,
  modules = false,
  modulesOptions,
  preprocessorOptions,
  // R1: fail closed. Absent authority = completeness unproven → config globs.
  tailwindContentAuthority = { mode: "config-globs" }
}) {
  const totalStart = cssProfileNow();
  let preprocessorMs = 0;
  let postcssConfigLoadMs = 0;
  let postcssConfigWaitMs = 0;
  let postcssConfigCacheHit = false;
  let tailwindGraphContentMs = 0;
  let postcssProcessMs = 0;
  let dependencyCollectionMs = 0;
  let importDependencyDiscoveryMs = 0;
  let urlDependencyDiscoveryMs = 0;
  let pipelineHashMs = 0;
  let cssDemandProofMs = 0;
  const pluginTimingMap = /* @__PURE__ */ new Map();
  const preprocessorLang = detectPreprocessorLang(filePath);
  let sourceCss = code;
  let preprocessorIdentity = null;
  const preprocessorDeps = [];
  if (preprocessorLang) {
    const started = cssProfileNow();
    const pre = await runPreprocessor(code, filePath, rootDir, preprocessorLang, preprocessorOptions);
    preprocessorMs += cssProfileNow() - started;
    sourceCss = pre.css;
    preprocessorDeps.push(...pre.deps);
    preprocessorIdentity = { lang: preprocessorLang, version: pre.version, options: preprocessorOptions };
  }
  const configProfile = await getPostcssConfigProfiled(rootDir);
  const { plugins, options, configFile } = configProfile.config;
  postcssConfigLoadMs += configProfile.loadMs;
  postcssConfigWaitMs += configProfile.waitMs;
  postcssConfigCacheHit = configProfile.cacheHit;
  const tailwindStart = cssProfileNow();
  const tailwindGraphContent = createTailwindGraphContentPipeline(
    rootDir,
    sourceCss,
    plugins,
    tailwindContentAuthority
  );
  tailwindGraphContentMs += cssProfileNow() - tailwindStart;
  const pipeline = [...tailwindGraphContent.plugins];
  let tokens;
  if (modules) {
    const scopedName = createScopedNameGenerator({ rootDir, filePath, modulesOptions });
    pipeline.push(
      postcssModules({
        generateScopedName: scopedName,
        localsConvention: modulesOptions?.localsConvention,
        getJSON(_filename, json) {
          tokens = sortObjectKeys(json);
        }
      })
    );
  }
  const timedPipeline = wrapPostcssPluginsForTiming(pipeline, pluginTimingMap);
  const runner = postcss(timedPipeline);
  const processStart = cssProfileNow();
  const result = await runner.process(sourceCss, {
    ...options,
    from: filePath,
    map: false
  });
  postcssProcessMs += cssProfileNow() - processStart;
  const depStart = cssProfileNow();
  const deps = [];
  const urlDeps = [];
  const seenDeps = /* @__PURE__ */ new Set();
  const seenUrlDeps = /* @__PURE__ */ new Set();
  const addDep = (depPath) => {
    const normalized = depPath.replace(/\\+/g, "/");
    if (seenDeps.has(normalized)) return;
    seenDeps.add(normalized);
    deps.push({ filePath: depPath, kind: "dependency" });
  };
  const addUrlDep = (depPath) => {
    const normalized = depPath.replace(/\\+/g, "/");
    if (seenUrlDeps.has(normalized)) return;
    seenUrlDeps.add(normalized);
    urlDeps.push({ filePath: depPath, kind: "dependency" });
  };
  if (configFile) addDep(configFile);
  for (const dep of preprocessorDeps) addDep(dep);
  const tailwindGraphFiles = tailwindGraphContent.profile.enabled && tailwindContentAuthority.mode === "graph" ? new Set(tailwindContentAuthority.files.map((item) => path8.resolve(item).replace(/\\+/g, "/"))) : null;
  for (const dep of collectPostcssMessageDeps(result.messages || [], rootDir, filePath, tailwindGraphFiles)) {
    addDep(dep);
  }
  dependencyCollectionMs += cssProfileNow() - depStart;
  const importStart = cssProfileNow();
  const importRe = /@import\s+(?:url\(\s*)?(?:'([^']+)'|"([^"]+)"|([^'"\s)]+))\s*\)?[^;]*;/gi;
  let match;
  while (match = importRe.exec(sourceCss)) {
    const spec = (match[1] || match[2] || match[3] || "").trim();
    if (!spec) continue;
    const resolved = resolveCssSpecifier(spec, filePath, rootDir);
    if (resolved) addDep(resolved);
  }
  importDependencyDiscoveryMs += cssProfileNow() - importStart;
  const urlStart = cssProfileNow();
  for (const dep of discoverUrlDeps(result.css, filePath, rootDir)) {
    addUrlDep(dep);
  }
  urlDependencyDiscoveryMs += cssProfileNow() - urlStart;
  const pipelineHashStart = cssProfileNow();
  const pipelineHash = await computePipelineHash(rootDir, modules, modulesOptions, preprocessorIdentity);
  pipelineHashMs += cssProfileNow() - pipelineHashStart;
  const depsForDemand = Array.from(/* @__PURE__ */ new Set([...deps.map((dep) => dep.filePath), ...urlDeps.map((dep) => dep.filePath)]));
  const demandStart = cssProfileNow();
  const cssDemand = buildCssDemandAnalysis({
    rootDir,
    cssFile: filePath,
    cssHash: getCacheKey(code),
    pipelineHash,
    deps: depsForDemand
  });
  cssDemandProofMs += cssProfileNow() - demandStart;
  const postcssPluginTimings = Object.fromEntries(
    Array.from(pluginTimingMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([label, ms]) => [label, Number(ms.toFixed(2))])
  );
  const pluginClassifications = classifyPostcssPluginTimings(postcssPluginTimings);
  tailwindGraphContent.profile.stamp = tailwindGraphContent.profile.enabled && tailwindGraphContent.profile.files > 0 ? computeCssDemandGraphContentStamp(rootDir)?.stamp ?? null : null;
  const compiled = {
    css: result.css,
    tokens,
    deps,
    urlDeps,
    pipelineHash,
    cssDemand,
    tailwindGraphContent: tailwindGraphContent.profile,
    profile: {
      totalMs: cssProfileNow() - totalStart,
      preprocessorMs,
      postcssConfigLoadMs,
      postcssConfigWaitMs,
      postcssConfigCacheHit,
      tailwindGraphContentMs,
      postcssProcessMs,
      postcssPluginMs: Object.values(postcssPluginTimings).reduce((sum, ms) => sum + ms, 0),
      ...pluginClassifications,
      dependencyCollectionMs,
      importDependencyDiscoveryMs,
      urlDependencyDiscoveryMs,
      pipelineHashMs,
      cssDemandProofMs,
      postcssPluginTimings
    }
  };
  return compiled;
}
function renderCssModule({
  css,
  filePath,
  tokens,
  hmr = true,
  inject = true
}) {
  const cssJson = JSON.stringify(css);
  const styleId = `ionify-css-${getCacheKey(filePath).slice(0, 8)}`;
  const tokensJson = tokens ? JSON.stringify(tokens) : "null";
  return `
// ionify:css
const cssText = ${cssJson};
const styleId = ${JSON.stringify(styleId)};
${inject ? `let style = document.querySelector(\`style[data-ionify-id="\${styleId}"]\`);
if (!style) {
  style = document.createElement("style");
  style.setAttribute("data-ionify-id", styleId);
  document.head.appendChild(style);
}
style.textContent = cssText;` : ""}
${tokens ? `const tokens = ${tokensJson};` : ""}
export const css = cssText;
${tokens ? `export const classes = tokens;
export default tokens;` : `export default cssText;`}
${hmr ? `if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    const existing = document.querySelector(\`style[data-ionify-id="\${styleId}"]\`);
    if (existing) existing.remove();
  });
}` : ""}
`.trim();
}
function renderCssTokensModule(tokens) {
  const sorted = sortObjectKeys(tokens);
  const tokensJson = JSON.stringify(sorted);
  return `
// ionify:css
const tokens = ${tokensJson};
export const classes = tokens;
export default tokens;
`.trim();
}
function renderCssRawStringModule(cssText) {
  return `
// ionify:css
const css = ${JSON.stringify(cssText)};
export { css };
export default css;
`.trim();
}
function renderCssUrlModule(url) {
  return `
// ionify:css
const url = ${JSON.stringify(url)};
export { url };
export default url;
`.trim();
}

// src/core/utils/public-path.ts
import path10 from "path";
import fs9 from "fs";

// src/core/module-id.ts
import fs8 from "fs";
import path9 from "path";
var WS_MODULE_PREFIX = "ws://";
function realpathOrResolve(absPath) {
  try {
    const fn = fs8.realpathSync.native;
    if (fn) return fn(absPath);
    return fs8.realpathSync(absPath);
  } catch {
    return path9.resolve(absPath);
  }
}
function toPosixPath(p) {
  return p.split(path9.sep).join("/");
}
function isSafeRelPath(relPosix) {
  if (!relPosix) return false;
  if (relPosix === "." || relPosix.startsWith("./")) return false;
  if (relPosix.includes("\0")) return false;
  if (relPosix.startsWith("../") || relPosix === "..") return false;
  if (/^[A-Za-z]:\//.test(relPosix) || relPosix.startsWith("//")) return false;
  const parts = relPosix.split("/");
  if (parts.some((part) => part === ".." || part === "")) return false;
  return true;
}
function resolveWorkspaceRoot(defaultRoot) {
  const fromEnv = process.env.IONIFY_WORKSPACE_ROOT;
  if (fromEnv && path9.isAbsolute(fromEnv)) return realpathOrResolve(fromEnv);
  if (defaultRoot && path9.isAbsolute(defaultRoot)) return realpathOrResolve(defaultRoot);
  return realpathOrResolve(process.cwd());
}
function isWsModuleId(value) {
  return typeof value === "string" && value.startsWith(WS_MODULE_PREFIX);
}
function toWsModuleId(absPath, workspaceRoot) {
  if (!absPath || typeof absPath !== "string") return null;
  if (!path9.isAbsolute(absPath)) return null;
  const wsRoot = resolveWorkspaceRoot(workspaceRoot ?? null);
  const normalizedWs = realpathOrResolve(wsRoot);
  const exists = fs8.existsSync(absPath);
  const normalizedFile = exists ? realpathOrResolve(absPath) : path9.resolve(absPath);
  if (normalizedFile !== normalizedWs && !normalizedFile.startsWith(normalizedWs + path9.sep)) {
    return null;
  }
  const rel = path9.relative(normalizedWs, normalizedFile);
  const relPosix = toPosixPath(rel);
  if (!isSafeRelPath(relPosix)) return null;
  return WS_MODULE_PREFIX + relPosix;
}
function fromWsModuleId(id, workspaceRoot) {
  if (!isWsModuleId(id)) return null;
  const relPosix = id.slice(WS_MODULE_PREFIX.length);
  if (!isSafeRelPath(relPosix)) return null;
  const wsRoot = resolveWorkspaceRoot(workspaceRoot ?? null);
  const normalizedWs = realpathOrResolve(wsRoot);
  const relNative = relPosix.split("/").join(path9.sep);
  const joined = path9.resolve(normalizedWs, relNative);
  if (joined !== normalizedWs && !joined.startsWith(normalizedWs + path9.sep)) {
    return null;
  }
  return joined;
}

// src/core/utils/public-path.ts
var MODULE_PREFIX = "/__ionify__/modules/";
function publicPathForFile(rootDir, absPath) {
  const normalizedRoot = path10.resolve(rootDir);
  const normalizedFile = path10.resolve(absPath);
  if (normalizedFile.startsWith(normalizedRoot + path10.sep) || normalizedFile === normalizedRoot) {
    const relative = path10.relative(normalizedRoot, normalizedFile).split(path10.sep).join("/");
    return "/" + (relative.length ? relative : "");
  }
  const logicalNodeModulesPath = mapRealPathToProjectNodeModules(normalizedRoot, normalizedFile);
  if (logicalNodeModulesPath) {
    const relative = path10.relative(normalizedRoot, logicalNodeModulesPath).split(path10.sep).join("/");
    return "/" + relative;
  }
  const wsId = toWsModuleId(normalizedFile, null);
  const encoded = Buffer.from(wsId ?? "invalid").toString("base64url");
  return MODULE_PREFIX + encoded;
}
function realpathOrResolve2(absPath) {
  try {
    const fn = fs9.realpathSync.native;
    if (fn) return fn(absPath);
    return fs9.realpathSync(absPath);
  } catch {
    return path10.resolve(absPath);
  }
}
function mapRealPathToProjectNodeModules(rootDir, absPath) {
  const normalizedRoot = path10.resolve(rootDir);
  const normalizedFile = realpathOrResolve2(absPath);
  const parts = normalizedFile.split(path10.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] !== "node_modules") continue;
    if (index === parts.length - 1) continue;
    const suffix = parts.slice(index + 1);
    if (suffix[0]?.startsWith("@") && suffix.length < 2) continue;
    const candidate = path10.join(normalizedRoot, "node_modules", ...suffix);
    if (!fs9.existsSync(candidate)) continue;
    if (realpathOrResolve2(candidate) !== normalizedFile) continue;
    return candidate;
  }
  return null;
}
function isWithinRoots(filePath, roots) {
  const exists = fs9.existsSync(filePath);
  const normalizedFile = exists ? realpathOrResolve2(filePath) : path10.resolve(filePath);
  for (const root of roots) {
    const normalizedRoot = realpathOrResolve2(root);
    if (normalizedFile === normalizedRoot) return true;
    if (normalizedFile.startsWith(normalizedRoot + path10.sep)) return true;
  }
  return false;
}
function isForbiddenPath(filePath) {
  const normalized = filePath.replace(/\\+/g, "/");
  return normalized.includes("/.git/") || normalized.includes("/.ionify/") || normalized.endsWith("/.git") || normalized.endsWith("/.ionify");
}
function isForbiddenFsPath(filePath) {
  return isForbiddenPath(filePath);
}
function decodePublicPath(rootDir, urlPath, opts) {
  if (urlPath.startsWith(MODULE_PREFIX)) {
    const encoded = urlPath.slice(MODULE_PREFIX.length);
    try {
      const decoded = Buffer.from(encoded, "base64url").toString("utf8");
      if (!decoded || decoded.includes("\0")) return null;
      const abs = fromWsModuleId(decoded, opts?.workspaceRoot ?? null);
      if (!abs) return null;
      if (isForbiddenPath(abs)) return null;
      const allowedRoots = opts?.allowedRoots;
      if (Array.isArray(allowedRoots) && allowedRoots.length > 0) {
        if (!isWithinRoots(abs, allowedRoots)) return null;
      }
      return abs;
    } catch {
      return null;
    }
  }
  const normalizedRoot = path10.resolve(rootDir);
  const joined = path10.resolve(normalizedRoot, "." + urlPath);
  if (!joined.startsWith(normalizedRoot + path10.sep) && joined !== normalizedRoot) {
    return null;
  }
  if (isForbiddenPath(joined)) return null;
  return joined;
}

// src/core/external-policy.ts
import path11 from "path";
function isRemoteUrlSpecifier(specifier) {
  return specifier.startsWith("http://") || specifier.startsWith("https://");
}
function matchesExternalSpecifier(specifier, externalSpecifiers) {
  for (const external of externalSpecifiers) {
    if (typeof external !== "string") continue;
    const trimmed = external.trim();
    if (!trimmed) continue;
    if (specifier === trimmed) return true;
    if (trimmed.endsWith("/")) {
      if (specifier.startsWith(trimmed)) return true;
      continue;
    }
    if (specifier.startsWith(`${trimmed}/`)) return true;
  }
  return false;
}
function normalizeConfiguredExternalSpecifiers(raw) {
  if (typeof raw === "string") return normalizeConfiguredExternalSpecifiers([raw]);
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw.filter((value) => typeof value === "string").map((value) => value.trim()).filter((value) => value.length > 0)
    )
  );
}
function collectFederationRemoteExternalSpecifiers(config) {
  const remotes = config?.federation?.remotes;
  if (!remotes || typeof remotes !== "object") return [];
  const externalSpecifiers = [];
  for (const [remoteName, remoteConfig] of Object.entries(remotes)) {
    const normalizedName = typeof remoteName === "string" ? remoteName.trim() : "";
    if (!normalizedName) continue;
    externalSpecifiers.push(normalizedName);
    if (remoteConfig && typeof remoteConfig === "object" && !Array.isArray(remoteConfig)) {
      externalSpecifiers.push(
        ...normalizeConfiguredExternalSpecifiers(remoteConfig.external)
      );
    }
  }
  return normalizeConfiguredExternalSpecifiers(externalSpecifiers);
}
function collectConfiguredExternalSpecifiers(config) {
  return normalizeConfiguredExternalSpecifiers([
    ...normalizeConfiguredExternalSpecifiers(config?.build?.external),
    ...collectFederationRemoteExternalSpecifiers(config)
  ]);
}
function isExternalGraphLeafId(id, externalSpecifiers = []) {
  return isRemoteUrlSpecifier(id) || matchesExternalSpecifier(id, externalSpecifiers);
}
function isGenericExternalSpecifier(id) {
  if (typeof id !== "string" || id.length === 0) return false;
  if (id.startsWith("ws://")) return false;
  if (path11.isAbsolute(id)) return false;
  if (id.startsWith("./") || id.startsWith("../") || id === "." || id === "..") {
    return false;
  }
  if (id.startsWith("/")) return false;
  return true;
}
function isPersistableExternalGraphLeafId(id) {
  return isRemoteUrlSpecifier(id) || isGenericExternalSpecifier(id);
}
function classifyImportSpecifiersForGraph(specs, importerAbs, externalSpecifiers) {
  const localDeps = /* @__PURE__ */ new Set();
  const externalDeps = /* @__PURE__ */ new Set();
  for (const rawSpec of specs) {
    if (typeof rawSpec !== "string") continue;
    const spec = rawSpec.trim();
    if (!spec) continue;
    if (isExternalGraphLeafId(spec, externalSpecifiers)) {
      externalDeps.add(spec);
      continue;
    }
    const resolved = resolveImport(spec, importerAbs);
    if (!resolved) continue;
    if (isExternalGraphLeafId(resolved, externalSpecifiers)) {
      externalDeps.add(resolved);
      continue;
    }
    localDeps.add(resolved);
  }
  return {
    localDeps: Array.from(localDeps),
    externalDeps: Array.from(externalDeps)
  };
}

// src/core/bundler.ts
function resolveIonifyDir() {
  const fromEnv = process.env.IONIFY_STATE_DIR;
  if (fromEnv && path12.isAbsolute(fromEnv)) return fromEnv;
  const projectRoot = process.env.IONIFY_PROJECT_ROOT;
  if (projectRoot && path12.isAbsolute(projectRoot)) return path12.join(projectRoot, ".ionify");
  return path12.join(process.cwd(), ".ionify");
}
var JS_EXTENSIONS = /* @__PURE__ */ new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"]);
var CSS_EXTENSIONS = new Set(CSS_LIKE_EXTENSIONS);
function classifyModuleKind(id) {
  const raw = id.startsWith(WS_MODULE_PREFIX) ? id.slice(WS_MODULE_PREFIX.length) : id;
  const ext = path12.posix.extname(raw.replace(/\\/g, "/")).toLowerCase();
  if (CSS_EXTENSIONS.has(ext)) return "css";
  if (JS_EXTENSIONS.has(ext)) return "js";
  return "asset";
}
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var toPosix = (p) => p.split(path12.sep).join("/");
var isBundleProfileEnabled = () => process.env.IONIFY_BUNDLE_PROFILE === "1" || process.env.IONIFY_BUNDLE_PROFILE === "true";
var nsToMs = (value) => Number(value) / 1e6;
var profileLog = (message) => {
  if (isBundleProfileEnabled()) logInfo(`[BuildProfile] ${message}`);
};
async function writeTextFileIfChanged(filePath, contents) {
  const nextBytes = Buffer.byteLength(contents, "utf8");
  try {
    const stat = await fs10.promises.stat(filePath);
    if (stat.isFile() && stat.size === nextBytes) {
      const existing = await fs10.promises.readFile(filePath, "utf8");
      if (existing === contents) return false;
    }
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
  await fs10.promises.mkdir(path12.dirname(filePath), { recursive: true });
  await fs10.promises.writeFile(filePath, contents, "utf8");
  return true;
}
async function writeBufferFileIfChanged(filePath, contents) {
  try {
    const stat = await fs10.promises.stat(filePath);
    if (stat.isFile() && stat.size === contents.length) {
      const existing = await fs10.promises.readFile(filePath);
      if (Buffer.compare(existing, contents) === 0) return false;
    }
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
  await fs10.promises.mkdir(path12.dirname(filePath), { recursive: true });
  await fs10.promises.writeFile(filePath, contents);
  return true;
}
function loadPreviousOutputStats(outputDir) {
  const statsPath = path12.join(outputDir, "build.stats.json");
  try {
    const statsFile = fs10.statSync(statsPath);
    if (!statsFile.isFile()) return null;
    const raw = fs10.readFileSync(statsPath, "utf8");
    const parsed = JSON.parse(raw);
    const files = /* @__PURE__ */ new Map();
    for (const [rel, entry] of Object.entries(parsed)) {
      if (entry && typeof entry === "object" && typeof entry.bytes === "number" && Number.isFinite(entry.bytes) && typeof entry.hash === "string" && entry.hash.length > 0) {
        files.set(rel, { bytes: entry.bytes, hash: entry.hash });
      }
    }
    return { statsMtimeMs: statsFile.mtimeMs, files };
  } catch {
    return null;
  }
}
async function writeTextFileIfStatsMatch(outputDir, previousStats, filePath, contents, hash) {
  const rel = toPosix(path12.relative(outputDir, filePath));
  const bytes = Buffer.byteLength(contents, "utf8");
  const previous = previousStats?.files.get(rel);
  if (previous && previous.bytes === bytes && previous.hash === hash) {
    try {
      const stat = await fs10.promises.stat(filePath);
      if (stat.isFile() && stat.size === bytes && stat.mtimeMs <= previousStats.statsMtimeMs + 1) {
        return false;
      }
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
    }
  }
  await fs10.promises.mkdir(path12.dirname(filePath), { recursive: true });
  await fs10.promises.writeFile(filePath, contents, "utf8");
  return true;
}
function toCssHexByte(value) {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
}
function compactCssRgb(r, g, b, alpha) {
  const red = Number(r);
  const green = Number(g);
  const blue = Number(b);
  if (![red, green, blue].every((value) => Number.isFinite(value) && value >= 0 && value <= 255)) return "";
  const base = `#${toCssHexByte(red)}${toCssHexByte(green)}${toCssHexByte(blue)}`;
  if (alpha === void 0) return base;
  const opacity = alpha.startsWith(".") ? Number(`0${alpha}`) : Number(alpha);
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) return "";
  return `${base}${toCssHexByte(Math.round(opacity * 255))}`;
}
function compactCssColors(input) {
  return input.replace(/\btransparent\b/g, "#0000").replace(/rgb\((\d+) (\d+) (\d+)\)/gi, (match, r, g, b) => {
    const compact = compactCssRgb(r, g, b);
    return compact && compact.length < match.length ? compact : match;
  }).replace(/rgba\((\d+),(\d+),(\d+),([01]?(?:\.\d+)?)\)/gi, (match, r, g, b, a) => {
    const compact = compactCssRgb(r, g, b, a);
    return compact && compact.length < match.length ? compact : match;
  }).replace(/rgb\((\d+) (\d+) (\d+) \/ ?([01]?(?:\.\d+)?)\)/gi, (match, r, g, b, a) => {
    const compact = compactCssRgb(r, g, b, a);
    return compact && compact.length < match.length ? compact : match;
  }).replace(/#([0-9a-fA-F]{6})([0-9a-fA-F]{2})\b/g, (match, rgb, alpha) => {
    const value = `${rgb}${alpha}`.toLowerCase();
    if (value[0] !== value[1] || value[2] !== value[3] || value[4] !== value[5] || value[6] !== value[7]) {
      return match;
    }
    const compact = `#${value[0]}${value[2]}${value[4]}${value[6]}`;
    return compact.length < match.length ? compact : match;
  });
}
function compactCssTime(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0 || ms >= 1e3) return `${value}ms`;
  const seconds = `${String(ms / 1e3).replace(/^0/, "")}s`;
  const millis = `${value}ms`;
  return seconds.length < millis.length ? seconds : millis;
}
function compactCssFunctionWhitespace(input) {
  return input.replace(
    /((?:-webkit-)?(?:backdrop-)?filter:[^;}]+)(?=[;}])/g,
    (match) => match.replace(/\)\s+(?=[a-zA-Z-]+\()/g, ")")
  );
}
function mergeAdjacentIdenticalCssRules(input) {
  let css = input;
  const adjacentRule = /(^|[}])([^@{}][^{}]*)\{([^{}]+)\}([^@{}][^{}]*)\{\3\}/g;
  for (; ; ) {
    const next = css.replace(adjacentRule, (_match, prefix, left, body, right) => {
      const leftSelector = String(left).trim();
      const rightSelector = String(right).trim();
      if (!leftSelector || !rightSelector) return _match;
      return `${prefix}${leftSelector},${rightSelector}{${body}}`;
    });
    if (next === css) return css;
    css = next;
  }
}
function minifyCss(input) {
  const compacted = input.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").replace(/\s*([{};:,])\s*/g, "$1").replace(/\s*([>+~])\s*/g, "$1").replace(/;}/g, "}").replace(/(:|\s)0(?:px|em|rem|vh|vw|vmin|vmax|cm|mm|in|pt|pc|q|%)(?=[;}, ])/gi, "$10").replace(/(:|\s|\(|,)0\.(\d+)/g, "$1.$2").replace(/\b(\d+)ms\b/g, (_match, ms) => compactCssTime(ms)).replace(/(\b|[\s,])((?:\.\d+|\d+(?:\.\d+)?)s) ease(?=[,;} ])/g, "$1$2").replace(/border-width:([^;{}]+);border-style:([^;{}]+);border-color:([^;{}]+)(?=[;}])/g, "border:$1 $2 $3").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/\s*!important/g, "!important").replace(/\[([A-Za-z0-9_-]+)=['"]([A-Za-z0-9_-]+)['"]\]/g, "[$1=$2]").replace(/"([A-Za-z][A-Za-z0-9 -]*[A-Za-z0-9])"/g, "$1").replace(/::(before|after|first-letter|first-line)\b/g, ":$1").replace(/#([0-9a-fA-F])\1([0-9a-fA-F])\2([0-9a-fA-F])\3\b/g, "#$1$2$3").replace(/translateX\(([^()]+)\)/g, (match, value) => {
    const compact = `translate(${value})`;
    return compact.length < match.length ? compact : match;
  }).replace(/flex:1 1 0(?=[;}])/g, "flex:1").replace(/flex:1 1 auto(?=[;}])/g, "flex:auto").replace(/min\(calc\(([^()]+)\),([^()]+)\)/g, "min($1,$2)").replace(/\*:(focus-visible)/g, ":$1").replace(/\*::(-webkit-scrollbar)/g, "::$1").trim();
  return mergeAdjacentIdenticalCssRules(compactCssColors(compactCssFunctionWhitespace(compacted)));
}
function orderCssModules(chunk) {
  const cssModules = chunk.modules.filter((m) => m.kind === "css");
  const cssSet = new Set(cssModules.map((m) => m.id));
  const adj = /* @__PURE__ */ new Map();
  for (const mod of cssModules) {
    const deps = [...mod.deps || [], ...mod.dynamicDeps || []].filter((d) => cssSet.has(d));
    deps.sort();
    adj.set(mod.id, deps);
  }
  const visited = /* @__PURE__ */ new Set();
  const temp = /* @__PURE__ */ new Set();
  const ordered = [];
  const dfs = (id) => {
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
function normalizeModules(rawModules) {
  const modules = [];
  for (const raw of rawModules) {
    if (typeof raw === "string") {
      modules.push({
        id: raw,
        fsPath: null,
        hash: null,
        kind: classifyModuleKind(raw),
        deps: [],
        dynamicDeps: []
      });
      continue;
    }
    if (!raw || typeof raw !== "object") continue;
    const id = typeof raw.id === "string" ? raw.id : null;
    if (!id) continue;
    const rawKind = typeof raw.kind === "string" ? raw.kind : classifyModuleKind(id);
    const kind = rawKind === "asset" ? "asset" : rawKind.startsWith("css") ? "css" : "js";
    const deps = Array.isArray(raw.deps) ? raw.deps.filter(isNonEmptyString) : [];
    const dynamicSource = Array.isArray(raw.dynamicDeps) ? raw.dynamicDeps : Array.isArray(raw.dynamic_deps) ? raw.dynamic_deps : [];
    const dynamicDeps = dynamicSource.filter(isNonEmptyString);
    const fsPath = typeof raw.fsPath === "string" ? raw.fsPath : typeof raw.fs_path === "string" ? raw.fs_path : null;
    const hash = typeof raw.hash === "string" && raw.hash.length ? raw.hash : null;
    const runtimeDemandHash = typeof raw.runtimeDemandHash === "string" && raw.runtimeDemandHash.length ? raw.runtimeDemandHash : typeof raw.runtime_demand_hash === "string" && raw.runtime_demand_hash.length ? raw.runtime_demand_hash : void 0;
    const runtimeLinksSource = Array.isArray(raw.runtimeLinks) ? raw.runtimeLinks : Array.isArray(raw.runtime_links) ? raw.runtime_links : [];
    const runtimeLinks = runtimeLinksSource.flatMap((link) => {
      const specifier = typeof link?.specifier === "string" ? link.specifier : "";
      const targetId = typeof link?.targetId === "string" ? link.targetId : typeof link?.target_id === "string" ? link.target_id : "";
      if (!specifier || !targetId) return [];
      return [{
        specifier,
        targetId,
        isDynamic: link?.isDynamic === true || link?.is_dynamic === true
      }];
    });
    modules.push({
      id,
      fsPath,
      hash,
      kind,
      deps,
      dynamicDeps,
      runtimeDemandHash,
      runtimeMutationVerified: raw.runtimeMutationVerified === true || raw.runtime_mutation_verified === true,
      runtimeLinks,
      dependencyFormat: raw.dependencyFormat === "esm" || raw.dependencyFormat === "cjs" || raw.dependencyFormat === "unknown" ? raw.dependencyFormat : raw.dependency_format === "esm" || raw.dependency_format === "cjs" || raw.dependency_format === "unknown" ? raw.dependency_format : void 0,
      usedExports: Array.isArray(raw.usedExports) ? raw.usedExports.filter(isNonEmptyString) : Array.isArray(raw.used_exports) ? raw.used_exports.filter(isNonEmptyString) : void 0,
      dependencyAbiHash: typeof raw.dependencyAbiHash === "string" && raw.dependencyAbiHash.length ? raw.dependencyAbiHash : typeof raw.dependency_abi_hash === "string" && raw.dependency_abi_hash.length ? raw.dependency_abi_hash : void 0,
      dependencyAbi: (() => {
        const abi = raw.dependencyAbi ?? raw.dependency_abi;
        if (!abi || typeof abi !== "object") return void 0;
        const imports = Array.isArray(abi.imports) ? abi.imports.filter((item) => item && typeof item === "object" && isNonEmptyString(item.outFile ?? item.out_file)).map((item) => ({
          outFile: String(item.outFile ?? item.out_file),
          mode: typeof item.mode === "string" ? item.mode : "",
          names: Array.isArray(item.names) ? item.names.filter(isNonEmptyString) : [],
          hasDefault: Boolean(item.hasDefault ?? item.has_default),
          hasNamespace: Boolean(item.hasNamespace ?? item.has_namespace),
          hasSideEffect: Boolean(item.hasSideEffect ?? item.has_side_effect),
          hasExportStar: Boolean(item.hasExportStar ?? item.has_export_star),
          uncertain: Boolean(item.uncertain)
        })) : [];
        const abiHash = abi.abiHash ?? abi.abi_hash;
        if (Number(abi.version) <= 0 || !isNonEmptyString(abiHash)) return void 0;
        return {
          version: Number(abi.version),
          names: Array.isArray(abi.names) ? abi.names.filter(isNonEmptyString) : [],
          hasDefault: Boolean(abi.hasDefault ?? abi.has_default),
          uncertain: Boolean(abi.uncertain),
          abiHash,
          imports
        };
      })(),
      sideEffects: raw.sideEffects === "none" || raw.sideEffects === "present" || raw.sideEffects === "unknown" ? raw.sideEffects : raw.side_effects === "none" || raw.side_effects === "present" || raw.side_effects === "unknown" ? raw.side_effects : void 0,
      artifactTopology: raw.artifactTopology === "wrapper" || raw.artifactTopology === "esm-native" || raw.artifactTopology === "esm-native-slim" ? raw.artifactTopology : raw.artifact_topology === "wrapper" || raw.artifact_topology === "esm-native" || raw.artifact_topology === "esm-native-slim" ? raw.artifact_topology : void 0
    });
  }
  return modules;
}
function normalizePlan(plan) {
  const entries = Array.isArray(plan?.entries) ? Array.from(new Set(plan.entries.filter(isNonEmptyString))) : [];
  const rawChunks = Array.isArray(plan?.chunks) ? plan.chunks : [];
  const normalizedChunks = rawChunks.map((chunk, index) => {
    const id = typeof chunk?.id === "string" && chunk.id.length ? chunk.id : `chunk-${index}`;
    const modules = normalizeModules(Array.isArray(chunk?.modules) ? chunk.modules : []);
    const consumersRaw = Array.isArray(chunk?.consumers) ? chunk.consumers.filter(isNonEmptyString) : null;
    const cssRaw = Array.isArray(chunk?.css) ? chunk.css.filter(isNonEmptyString) : null;
    const assetsRaw = Array.isArray(chunk?.assets) ? chunk.assets.filter(isNonEmptyString) : null;
    const consumers = consumersRaw && consumersRaw.length ? Array.from(new Set(consumersRaw)) : [...entries];
    const inferredCss = cssRaw && cssRaw.length ? cssRaw : modules.filter((m) => m.kind === "css").map((m) => m.id);
    const inferredAssets = assetsRaw && assetsRaw.length ? assetsRaw : modules.filter((m) => m.kind === "asset").map((m) => m.id);
    return {
      id,
      modules,
      entry: chunk?.entry === true,
      shared: chunk?.shared === true,
      consumers,
      css: inferredCss,
      assets: inferredAssets
    };
  });
  return {
    entries,
    chunks: normalizedChunks
  };
}
function normalizeNativeGraphMap(graph) {
  const out = /* @__PURE__ */ new Map();
  if (!graph) return out;
  for (const raw of Object.values(graph)) {
    if (!raw || typeof raw.id !== "string" || raw.id.length === 0) continue;
    out.set(raw.id, {
      id: raw.id,
      hash: typeof raw.hash === "string" ? raw.hash : null,
      deps: Array.isArray(raw.deps) ? raw.deps.filter(isNonEmptyString) : [],
      dynamicDeps: Array.isArray(raw.dynamicDeps) ? raw.dynamicDeps.filter(isNonEmptyString) : Array.isArray(raw.dynamic_deps) ? raw.dynamic_deps.filter(isNonEmptyString) : [],
      kind: typeof raw.kind === "string" ? raw.kind : void 0
    });
  }
  return out;
}
function resolveGraphSeedDeps(specs, importerAbs, externalSpecifiers) {
  return classifyImportSpecifiersForGraph(specs, importerAbs, externalSpecifiers);
}
function validateGraphForEntries(graph, entryIds, externalSpecifiers = []) {
  const nodes = normalizeNativeGraphMap(graph);
  if (nodes.size === 0) return { ok: false, reason: "empty" };
  if (entryIds.length === 0) return { ok: true, reason: "no explicit entries" };
  for (const entryId of entryIds) {
    if (!nodes.has(entryId)) {
      return { ok: false, reason: `entry missing: ${entryId}` };
    }
  }
  const queue = [...entryIds];
  const seen = /* @__PURE__ */ new Set();
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const node = nodes.get(id);
    if (!node) {
      if (isExternalGraphLeafId(id, externalSpecifiers)) {
        continue;
      }
      return { ok: false, reason: `reachable node missing: ${id}` };
    }
    for (const dep of [...node.deps || [], ...node.dynamicDeps || []]) {
      if (!seen.has(dep)) queue.push(dep);
    }
  }
  return { ok: true, reason: `entry-reachable (${seen.size} modules)` };
}
function buildGraphSeedNodesFromEntries(entryPaths, workspaceRoot, depStopMap, externalSpecifiers = []) {
  const queue = [...entryPaths];
  const seen = new Set(queue);
  const graphSeedNodes = [];
  while (queue.length) {
    const file = queue.shift();
    if (!fs10.existsSync(file)) continue;
    const code = fs10.readFileSync(file, "utf8");
    let hash = getCacheKey(code);
    let specs = [];
    let dynamicSpecs = [];
    if (native?.parseModuleIr) {
      try {
        const ir = native.parseModuleIr(file, code);
        hash = ir.hash;
        const staticDeps = ir.dependencies.filter((d) => d.kind !== "Dynamic");
        const dynamicDeps = ir.dependencies.filter((d) => d.kind === "Dynamic");
        specs = staticDeps.map((d) => d.specifier);
        dynamicSpecs = dynamicDeps.map((d) => d.specifier);
      } catch {
        specs = extractImports(code, file);
      }
    } else {
      specs = extractImports(code, file);
    }
    const staticResolved = resolveGraphSeedDeps(specs, file, externalSpecifiers);
    const dynamicResolved = resolveGraphSeedDeps(dynamicSpecs, file, externalSpecifiers);
    const depsAbs = staticResolved.localDeps;
    const dynamicAbs = dynamicResolved.localDeps;
    const fileId = toWsModuleId(file, workspaceRoot);
    if (!fileId) continue;
    const depsIds = Array.from(/* @__PURE__ */ new Set([
      ...depsAbs.map((dep) => toWsModuleId(dep, workspaceRoot)).filter((id) => typeof id === "string" && id.length > 0),
      ...staticResolved.externalDeps
    ]));
    const dynamicIds = Array.from(/* @__PURE__ */ new Set([
      ...dynamicAbs.map((dep) => toWsModuleId(dep, workspaceRoot)).filter((id) => typeof id === "string" && id.length > 0),
      ...dynamicResolved.externalDeps
    ]));
    const runtimeLinks = [
      ...specs.map((specifier) => ({ specifier, isDynamic: false })),
      ...dynamicSpecs.map((specifier) => ({ specifier, isDynamic: true }))
    ].flatMap(({ specifier, isDynamic }) => {
      const resolved = resolveGraphSeedDeps([specifier], file, externalSpecifiers);
      const targetId = resolved.localDeps.map((dep) => toWsModuleId(dep, workspaceRoot)).find((id) => typeof id === "string" && id.length > 0) ?? resolved.externalDeps[0];
      return targetId ? [{ specifier, targetId, isDynamic }] : [];
    });
    graphSeedNodes.push({
      id: fileId,
      hash,
      deps: depsIds,
      dynamicDeps: dynamicIds,
      runtimeLinks,
      kind: classifyModuleKind(fileId)
    });
    for (const dep of [...depsAbs, ...dynamicAbs]) {
      if (!seen.has(dep)) {
        seen.add(dep);
        if (depStopMap && depStopMap.size > 0) {
          let canonical;
          try {
            canonical = fs10.realpathSync.native(dep);
          } catch {
            canonical = path12.resolve(dep);
          }
          const artifactHash = depStopMap.get(canonical);
          if (artifactHash) {
            const depId = toWsModuleId(dep, workspaceRoot) ?? canonical;
            graphSeedNodes.push({
              id: depId,
              hash: artifactHash,
              deps: [],
              dynamicDeps: [],
              runtimeLinks: [],
              kind: "dep"
            });
            continue;
          }
        }
        queue.push(dep);
      }
    }
  }
  return graphSeedNodes;
}
function recordGraphSeedNodes(nodes) {
  if (nodes.length === 0) return;
  if (typeof native?.graphRecordBatch === "function") {
    native.graphRecordBatch(nodes);
    return;
  }
  if (typeof native?.graphRecord === "function") {
    for (const node of nodes) {
      native.graphRecord(node.id, node.hash, node.deps, node.dynamicDeps, node.kind);
    }
    return;
  }
  if (typeof native?.recordFile === "function") {
    for (const node of nodes) {
      native.recordFile(node.id, node.hash, node.deps, node.dynamicDeps, node.kind);
    }
  }
}
function rebuildGraphFromEntries(entryPaths, workspaceRoot, depStops, externalSpecifiers = [], canonicalContext) {
  const depStopMap = depStops && depStops.length > 0 ? new Map(
    depStops.filter((s) => s.artifactHash.length > 0).map((s) => {
      let canonical;
      try {
        canonical = fs10.realpathSync.native(s.entryPath);
      } catch {
        canonical = path12.resolve(s.entryPath);
      }
      return [canonical, s.artifactHash];
    })
  ) : null;
  const canUseNativeBuilder = typeof native?.graphBuildFromEntries === "function";
  if (canUseNativeBuilder) {
    try {
      const result = native.graphBuildFromEntries(
        entryPaths,
        workspaceRoot,
        resolveIonifyDir(),
        depStops ?? null,
        externalSpecifiers.length ? Array.from(externalSpecifiers) : null
      );
      const moduleCount = typeof result?.moduleCount === "number" ? result.moduleCount : typeof result?.module_count === "number" ? result.module_count : 0;
      if (moduleCount > 0) {
        const equivPath = process.env.IONIFY_C3_EQUIV;
        if (equivPath && native?.canonicalSchedulerBegin && native.graphLoad) {
          try {
            const isAppJs = (id) => id.startsWith("ws://") && !id.startsWith("ws://.ionify/deps/");
            const legacyNodes = native.graphLoad() ?? [];
            const legacyById = new Map(legacyNodes.map((n) => [n.id, n]));
            const gOld = new Set(
              legacyNodes.filter((n) => n.kind === "js" && isAppJs(n.id)).map((n) => n.id)
            );
            const schedAppRecords = /* @__PURE__ */ new Map();
            const schedDepLeaves = /* @__PURE__ */ new Map();
            const schedId = native.canonicalSchedulerBegin(
              entryPaths,
              workspaceRoot,
              externalSpecifiers.length ? Array.from(externalSpecifiers) : null,
              canonicalContext?.defineRecipe?.replacements ?? [],
              canonicalContext?.defineRecipe?.importMetaEnvLiteral ?? void 0,
              "hybrid",
              depStops ?? null
            );
            const gNew = /* @__PURE__ */ new Set();
            const widths = [];
            let peakWaveMaterial = 0;
            let wholeClosureMaterial = 0;
            const schedulerDemands = {};
            const schedulerDepSpecifiers = {};
            const t0 = Date.now();
            for (; ; ) {
              const wave = native.canonicalSchedulerNextWave(schedId);
              if (wave.length === 0) break;
              let waveMaterial = 0;
              for (const g of wave) {
                gNew.add(g.id);
                waveMaterial += Buffer.byteLength(g.codeA, "utf8") + Buffer.byteLength(g.mapA ?? "", "utf8") + Buffer.byteLength(g.codeB, "utf8");
                let importerKey;
                try {
                  importerKey = fs10.realpathSync.native(g.filePath);
                } catch {
                  importerKey = g.filePath;
                }
                schedulerDemands[importerKey] = (g.demands ?? []).map((d) => ({
                  specifier: d.specifier,
                  usedExports: [...d.usedExports].sort(),
                  hasNamespace: d.hasNamespace,
                  hasExportStar: d.hasExportStar,
                  isDynamic: d.isDynamic
                }));
                schedulerDepSpecifiers[importerKey] = [...g.depSpecifiers ?? []];
                if (g.record) schedAppRecords.set(g.record.id, g.record);
                for (const dl of g.depLeafRecords ?? []) schedDepLeaves.set(dl.id, dl);
              }
              widths.push(wave.length);
              wholeClosureMaterial += waveMaterial;
              if (waveMaterial > peakWaveMaterial) peakWaveMaterial = waveMaterial;
              native.canonicalSchedulerAck(schedId, true);
            }
            const schedulerMs = Date.now() - t0;
            native.canonicalSchedulerEnd(schedId);
            const oldMinusNew = [...gOld].filter((x) => !gNew.has(x)).sort();
            const newMinusOld = [...gNew].filter((x) => !gOld.has(x)).sort();
            const normArr = (a) => [...a ?? []].sort();
            const eqArr = (a, b) => {
              const x = normArr(a), y = normArr(b);
              return x.length === y.length && x.every((v, i) => v === y[i]);
            };
            const recordMismatches = [];
            for (const [id, rec] of schedAppRecords) {
              const leg = legacyById.get(id);
              if (!leg) {
                recordMismatches.push({ id, why: "app-missing-in-legacy" });
                continue;
              }
              if ((leg.kind ?? null) !== (rec.kind ?? null) || (leg.hash ?? null) !== (rec.hash ?? null) || !eqArr(leg.deps, rec.deps) || !eqArr(leg.dynamicDeps, rec.dynamicDeps)) {
                recordMismatches.push({
                  id,
                  why: "app-record",
                  leg: { kind: leg.kind, hash: leg.hash, deps: normArr(leg.deps), dyn: normArr(leg.dynamicDeps) },
                  sched: { kind: rec.kind, hash: rec.hash, deps: normArr(rec.deps), dyn: normArr(rec.dynamicDeps) }
                });
              }
            }
            for (const [id, dl] of schedDepLeaves) {
              const leg = legacyById.get(id);
              if (!leg) {
                recordMismatches.push({ id, why: "depleaf-missing-in-legacy" });
                continue;
              }
              if ((leg.kind ?? null) !== "dep" || (leg.hash ?? null) !== (dl.hash ?? null)) {
                recordMismatches.push({
                  id,
                  why: "depleaf-record",
                  leg: { kind: leg.kind, hash: leg.hash },
                  sched: { kind: dl.kind, hash: dl.hash }
                });
              }
            }
            fs10.writeFileSync(
              equivPath,
              JSON.stringify(
                {
                  workspaceRoot,
                  entries: entryPaths.length,
                  depStops: depStops?.length ?? 0,
                  externals: externalSpecifiers.length,
                  gOld: gOld.size,
                  gNew: gNew.size,
                  equal: oldMinusNew.length === 0 && newMinusOld.length === 0,
                  oldMinusNew,
                  newMinusOld,
                  waves: widths.length,
                  maxWaveWidth: widths.length ? Math.max(...widths) : 0,
                  peakWaveMaterialBytes: peakWaveMaterial,
                  wholeClosureMaterialBytes: wholeClosureMaterial,
                  schedulerMs,
                  widths,
                  entryPaths,
                  recipeSize: canonicalContext?.defineRecipe?.replacements?.length ?? 0,
                  appRecordCount: schedAppRecords.size,
                  depLeafCount: schedDepLeaves.size,
                  legacyNodeCount: legacyById.size,
                  recordMismatchCount: recordMismatches.length,
                  recordMismatches: recordMismatches.slice(0, 20),
                  schedulerDemands,
                  schedulerDepSpecifiers
                },
                null,
                2
              ) + "\n"
            );
          } catch (e) {
            try {
              fs10.writeFileSync(equivPath, `ERROR ${String(e)}
`);
            } catch {
            }
          }
        }
        return { moduleCount, native: true };
      }
      logWarn("[Build] Native graph build returned no modules; falling back to TS graph rebuild.");
    } catch (err) {
      logWarn(`[Build] Native graph build failed; falling back to TS graph rebuild (${String(err)})`);
    }
  }
  const graphSeedNodes = buildGraphSeedNodesFromEntries(entryPaths, workspaceRoot, depStopMap, externalSpecifiers);
  recordGraphSeedNodes(graphSeedNodes);
  return { moduleCount: graphSeedNodes.length, native: false };
}
function collectGraphRuntimeMutationInputs(mutations, allowedPaths) {
  return mutations.flatMap((mutation) => {
    const filePath = mutation.filePath ?? mutation.file_path;
    const sourceHash = mutation.sourceHash ?? mutation.source_hash;
    const staticSpecifiers = mutation.staticSpecifiers ?? mutation.static_specifiers;
    const dynamicSpecifiers = mutation.dynamicSpecifiers ?? mutation.dynamic_specifiers;
    const runtimeDemands = mutation.runtimeDemands ?? mutation.runtime_demands;
    if (!filePath || !sourceHash || allowedPaths && !allowedPaths.has(path12.resolve(filePath)) || !Array.isArray(staticSpecifiers) || !Array.isArray(dynamicSpecifiers) || !Array.isArray(runtimeDemands)) {
      return [];
    }
    return [{ filePath, sourceHash, staticSpecifiers, dynamicSpecifiers, runtimeDemands }];
  });
}
function refreshChangedRuntimeGraphNodes(options) {
  const freshnessScanStart = Date.now();
  const ionifyDir = resolveIonifyDir();
  const freshnessCacheFile = path12.join(ionifyDir, "source-freshness.v1.json");
  let cache = {};
  try {
    const raw = JSON.parse(fs10.readFileSync(freshnessCacheFile, "utf8"));
    if (raw && typeof raw === "object") cache = raw;
  } catch {
  }
  const changedPaths = options.knownChangedSourcePaths ? Array.from(new Set(options.knownChangedSourcePaths.map((filePath) => path12.resolve(filePath)))) : [];
  const nextCache = { ...cache };
  for (const [id, node] of options.knownChangedSourcePaths ? [] : Object.entries(options.graph).sort(([a], [b]) => a.localeCompare(b))) {
    const kind = typeof node?.kind === "string" ? node.kind : "js";
    if (kind !== "js" && kind !== "css" && kind !== "asset") continue;
    const fsPath = id.startsWith(WS_MODULE_PREFIX) ? fromWsModuleId(id, options.workspaceRoot) : path12.isAbsolute(id) ? id : null;
    if (!fsPath || fsPath.includes(`${path12.sep}node_modules${path12.sep}`) || fsPath.includes(`${path12.sep}.ionify${path12.sep}`)) {
      continue;
    }
    try {
      const stat = fs10.statSync(fsPath);
      const cacheKey = `${id}
${fsPath}`;
      const cached = cache[cacheKey];
      const diskHash = cached && cached.fsPath === fsPath && cached.dev === stat.dev && cached.ino === stat.ino && cached.mtimeMs === stat.mtimeMs && cached.ctimeMs === stat.ctimeMs && cached.size === stat.size && typeof cached.hash === "string" && cached.hash.length > 0 ? cached.hash : getCacheKey(fs10.readFileSync(fsPath));
      nextCache[cacheKey] = {
        fsPath,
        dev: stat.dev,
        ino: stat.ino,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
        size: stat.size,
        hash: diskHash
      };
      if (diskHash !== node?.hash) changedPaths.push(fsPath);
    } catch {
    }
  }
  if (!options.knownChangedSourcePaths) {
    try {
      fs10.mkdirSync(ionifyDir, { recursive: true });
      const tempPath = `${freshnessCacheFile}.${process.pid}.${Date.now()}.tmp`;
      fs10.writeFileSync(tempPath, `${JSON.stringify(nextCache)}
`, "utf8");
      fs10.renameSync(tempPath, freshnessCacheFile);
    } catch {
    }
  }
  profileLog(`graphFreshnessScan_ms=${Date.now() - freshnessScanStart} changed=${changedPaths.length}`);
  if (changedPaths.length === 0) return 0;
  if (!native?.graphRefreshFromEntries) {
    throw new Error("Native emitted-runtime graph refresh authority is unavailable");
  }
  const nativeRefreshStart = Date.now();
  const changedSet = new Set(changedPaths.map((filePath) => path12.resolve(filePath)));
  const runtimeFacts = collectGraphRuntimeMutationInputs(
    options.runtimeMutations ?? [],
    changedSet
  );
  let closureNodes = 0;
  let refreshedFromFacts = /* @__PURE__ */ new Set();
  if (runtimeFacts.length > 0 && native.graphRefreshFromRuntimeFacts) {
    try {
      const result = native.graphRefreshFromRuntimeFacts(
        runtimeFacts,
        options.workspaceRoot,
        ionifyDir,
        options.depStops ?? null,
        options.externalSpecifiers.length ? Array.from(options.externalSpecifiers) : null
      );
      closureNodes += result.moduleCount;
      refreshedFromFacts = new Set(runtimeFacts.map((fact) => path12.resolve(fact.filePath)));
    } catch (error) {
      logWarn(
        `[Build] Canonical runtime mutation fact rejected; using full native graph refresh (${String(error)})`
      );
    }
  }
  const fallbackPaths = changedPaths.filter((filePath) => !refreshedFromFacts.has(path12.resolve(filePath)));
  if (fallbackPaths.length > 0) {
    const result = native.graphRefreshFromEntries(
      fallbackPaths,
      options.workspaceRoot,
      ionifyDir,
      options.depStops ?? null,
      options.externalSpecifiers.length ? Array.from(options.externalSpecifiers) : null
    );
    closureNodes += result.moduleCount;
  }
  profileLog(`graphRefreshDurable_ms=${Date.now() - nativeRefreshStart} seeds=${changedPaths.length} closure=${closureNodes} runtimeFacts=${refreshedFromFacts.size}`);
  logInfo(
    `[Build] Incremental graph refresh: ${changedPaths.length} changed source(s), ${closureNodes} changed/new closure node(s)`
  );
  return changedPaths.length;
}
async function generateBuildPlan(entries, versionInputs, depStops, externalSpecifiers = [], knownChangedSourcePaths, runtimeMutations, canonicalPlanCandidate, canonicalDepsRoot, dplPublicationEdges, canonicalContext) {
  const workspaceRoot = resolveWorkspaceRoot(null);
  const entryIds = Array.isArray(entries) ? entries.map((entry) => {
    if (typeof entry !== "string" || entry.length === 0) return null;
    if (entry.startsWith(WS_MODULE_PREFIX)) return entry;
    if (!path12.isAbsolute(entry)) return null;
    return toWsModuleId(entry, workspaceRoot);
  }).filter((id) => typeof id === "string" && id.length > 0) : [];
  const entryPaths = Array.isArray(entries) ? entries.map((entry) => {
    if (typeof entry !== "string" || entry.length === 0) return null;
    if (path12.isAbsolute(entry)) return entry;
    if (entry.startsWith(WS_MODULE_PREFIX)) return fromWsModuleId(entry, workspaceRoot);
    return null;
  }).filter((p) => typeof p === "string" && p.length > 0) : [];
  const version = versionInputs ? computeGraphVersion(versionInputs) : void 0;
  logInfo(`Graph version: ${version || "default"}`);
  const graphDbPath = path12.join(resolveIonifyDir(), "graph.db");
  const graphInitStart = Date.now();
  let nativeGraphReady = ensureNativeGraph(graphDbPath, version, {
    retryMs: 1500,
    retryIntervalMs: 50
  });
  profileLog(`ensureNativeGraph_ms=${Date.now() - graphInitStart} graph=shared`);
  let usingBuildLocalGraph = false;
  let moduleCount = 0;
  let persistedGraph = null;
  if (nativeGraphReady && native?.graphLoadMap) {
    try {
      const graphLoadStart = Date.now();
      persistedGraph = native.graphLoadMap();
      profileLog(`graphLoadMap_ms=${Date.now() - graphLoadStart}`);
      const graphSize = persistedGraph ? Object.keys(persistedGraph).length : 0;
      moduleCount = graphSize;
      logInfo(`Native graph loaded: ${graphSize} modules`);
      if (persistedGraph && graphSize > 0) {
        logInfo(`Loaded persisted graph with ${graphSize} modules`);
      }
    } catch (err) {
      logWarn(`Failed to load persisted graph: ${String(err)}`);
      persistedGraph = null;
    }
  } else {
    logWarn(`graphLoadMap not available, native binding: ${!!native}`);
  }
  let graphValidation = nativeGraphReady ? validateGraphForEntries(persistedGraph, entryIds, externalSpecifiers) : { ok: false, reason: "native graph unavailable" };
  if (!graphValidation.ok && entryPaths.length > 0 && native) {
    if (!nativeGraphReady) {
      const buildGraphDbPath = path12.join(resolveIonifyDir(), "build", "graph.db");
      try {
        fs10.rmSync(buildGraphDbPath, { recursive: true, force: true });
      } catch {
      }
      const buildGraphVersion = version ? `${version}-build` : "build";
      const buildGraphInitStart = Date.now();
      nativeGraphReady = ensureNativeGraph(buildGraphDbPath, buildGraphVersion);
      profileLog(`ensureNativeGraph_ms=${Date.now() - buildGraphInitStart} graph=build-local`);
      usingBuildLocalGraph = nativeGraphReady;
      if (nativeGraphReady) {
        logWarn(`[Build] Shared graph unavailable (${graphValidation.reason}); using build-local planner graph.`);
      }
    }
    if (!nativeGraphReady) {
      throw new Error(`Build graph is not available and cannot be rebuilt (${graphValidation.reason})`);
    }
    logWarn(`[Build] Graph is not planner-ready (${graphValidation.reason}) \u2014 rebuilding from entries...`);
    const rebuild = rebuildGraphFromEntries(entryPaths, workspaceRoot, depStops, externalSpecifiers, canonicalContext);
    try {
      const reloadStart = Date.now();
      persistedGraph = native?.graphLoadMap ? native.graphLoadMap() : null;
      profileLog(`graphReloadAfterRebuild_ms=${Date.now() - reloadStart}`);
      moduleCount = persistedGraph ? Object.keys(persistedGraph).length : rebuild.moduleCount;
    } catch (err) {
      persistedGraph = null;
      moduleCount = rebuild.moduleCount;
      logWarn(`Failed to reload rebuilt graph: ${String(err)}`);
    }
    graphValidation = validateGraphForEntries(persistedGraph, entryIds, externalSpecifiers);
    if (!graphValidation.ok) {
      throw new Error(`Build graph rebuild did not produce an entry-reachable graph (${graphValidation.reason})`);
    }
    logInfo(`[Build] Dependency graph rebuilt: ${moduleCount} modules (${rebuild.native ? "native" : "ts"})`);
  }
  if (!nativeGraphReady) {
    throw new Error("Native graph is unavailable; refusing to emit build output from fallback graph state.");
  }
  if (persistedGraph) {
    const refreshed = refreshChangedRuntimeGraphNodes({
      graph: persistedGraph,
      workspaceRoot,
      depStops,
      externalSpecifiers,
      knownChangedSourcePaths,
      runtimeMutations
    });
    if (refreshed > 0) {
      persistedGraph = native.graphLoadMap ? native.graphLoadMap() : null;
      moduleCount = persistedGraph ? Object.keys(persistedGraph).length : moduleCount;
      graphValidation = validateGraphForEntries(persistedGraph, entryIds, externalSpecifiers);
      if (!graphValidation.ok) {
        throw new Error(`Incremental graph refresh produced an invalid planner graph (${graphValidation.reason})`);
      }
    }
  }
  if (canonicalPlanCandidate && canonicalDepsRoot && knownChangedSourcePaths && runtimeMutations && dplPublicationEdges && native?.plannerRefreshCanonicalPlan) {
    const changedSet = new Set(knownChangedSourcePaths.map((filePath) => path12.resolve(filePath)));
    const runtimeFacts = collectGraphRuntimeMutationInputs(runtimeMutations, changedSet);
    const factPaths = new Set(runtimeFacts.map((fact) => path12.resolve(fact.filePath)));
    const hasCompleteMutationSet = runtimeFacts.length === changedSet.size && factPaths.size === changedSet.size && Array.from(changedSet).every((filePath) => factPaths.has(filePath));
    if (hasCompleteMutationSet) {
      const refreshStart = Date.now();
      try {
        const refreshed = native.plannerRefreshCanonicalPlan(
          normalizePlan(canonicalPlanCandidate),
          runtimeFacts,
          Array.from(dplPublicationEdges),
          workspaceRoot,
          canonicalDepsRoot,
          externalSpecifiers.length ? Array.from(externalSpecifiers) : null
        );
        profileLog(`canonicalPlanRefresh_ms=${Date.now() - refreshStart} admitted=true`);
        logInfo("[Planner] Canonical publication plan admitted: emitted-runtime topology unchanged");
        return normalizePlan(refreshed.plan);
      } catch (error) {
        profileLog(`canonicalPlanRefresh_ms=${Date.now() - refreshStart} admitted=false`);
        logInfo(`[Planner] Canonical publication plan rejected; using normal planning (${String(error)})`);
      }
    }
  }
  let planCachePath = null;
  let planTopologyFingerprint = null;
  if (nativeGraphReady && version && native?.planCacheTopologyFingerprint) {
    try {
      const fpStart = Date.now();
      const fp = native.planCacheTopologyFingerprint();
      profileLog(`planFingerprint_ms=${Date.now() - fpStart}`);
      if (fp) {
        planTopologyFingerprint = fp;
        planCachePath = path12.join(resolveIonifyDir(), "cas", version, "plan-v3", `${fp}.json`);
        if (fs10.existsSync(planCachePath)) {
          try {
            const planReadStart = Date.now();
            const cached = JSON.parse(fs10.readFileSync(planCachePath, "utf8"));
            if (cached.version !== 3 || cached.topologyFingerprint !== fp || !cached.plan || cached.planHash !== getCacheKey(JSON.stringify(cached.plan)) || !native.plannerRefreshPlanHashes) {
              throw new Error("invalid Planner topology-cache proof");
            }
            const refreshed = native.plannerRefreshPlanHashes(normalizePlan(cached.plan), fp);
            profileLog(`planCacheRead_ms=${Date.now() - planReadStart}`);
            logInfo(`[Planner] Topology cache HIT (fp=${fp.slice(0, 8)}): refreshed graph-owned hashes, skipped BFS`);
            return normalizePlan(refreshed);
          } catch {
          }
        }
        logInfo(`[Planner] Plan cache path ready (fp=${fp.slice(0, 8)})`);
      }
    } catch {
      planCachePath = null;
    }
  }
  if (nativeGraphReady && native?.plannerPlanBuild) {
    try {
      const start = Date.now();
      const graphLabel = usingBuildLocalGraph ? "build-local" : "shared";
      logInfo(`[Planner] Calling native plannerPlanBuild with ${entryIds.length} entries (${graphLabel} graph)`);
      const plan = native.plannerPlanBuild(entryIds);
      logInfo(`[Planner] Native plan returned: ${plan.entries.length} entries, ${plan.chunks.length} chunks in ${Date.now() - start}ms`);
      const normalized = normalizePlan(plan);
      if (planCachePath && planTopologyFingerprint) {
        try {
          fs10.mkdirSync(path12.dirname(planCachePath), { recursive: true });
          const envelope = {
            version: 3,
            topologyFingerprint: planTopologyFingerprint,
            planHash: getCacheKey(JSON.stringify(normalized)),
            plan: normalized
          };
          const tempPath = `${planCachePath}.${process.pid}.${Date.now()}.tmp`;
          fs10.writeFileSync(tempPath, JSON.stringify(envelope), "utf8");
          fs10.renameSync(tempPath, planCachePath);
        } catch {
        }
      }
      return normalized;
    } catch (err) {
      throw new Error(`plannerPlanBuild failed after graph validation: ${String(err)}`);
    }
  }
  throw new Error("native.plannerPlanBuild is unavailable; refusing to emit build output from fallback graph state.");
}
function admitCanonicalBuildPlanMutation(options) {
  if ((options.consumer === "plan" ? !native?.plannerRefreshCanonicalPlan : !native?.plannerRefreshCanonicalPlanDelta && !native?.plannerRefreshCanonicalPlan) || !native.graphStageCanonicalMutations || options.changedSourcePaths.length === 0) {
    return null;
  }
  const workspaceRoot = resolveWorkspaceRoot(null);
  const changedSet = new Set(options.changedSourcePaths.map((filePath) => path12.resolve(filePath)));
  const runtimeFacts = collectGraphRuntimeMutationInputs(options.runtimeMutations, changedSet);
  const factPaths = new Set(runtimeFacts.map((fact) => path12.resolve(fact.filePath)));
  const hasCompleteMutationSet = runtimeFacts.length === changedSet.size && factPaths.size === changedSet.size && Array.from(changedSet).every((filePath) => factPaths.has(filePath));
  if (!hasCompleteMutationSet) return null;
  const refreshStart = Date.now();
  try {
    const externalSpecifiers = options.externalSpecifiers?.length ? Array.from(options.externalSpecifiers) : null;
    const nativeRefreshStart = process.hrtime.bigint();
    const refreshed = options.consumer !== "plan" && native.plannerRefreshCanonicalPlanDelta ? native.plannerRefreshCanonicalPlanDelta(
      options.plan,
      runtimeFacts,
      [],
      workspaceRoot,
      options.depsRoot,
      externalSpecifiers
    ) : native.plannerRefreshCanonicalPlan(
      normalizePlan(options.plan),
      runtimeFacts,
      [],
      workspaceRoot,
      options.depsRoot,
      externalSpecifiers
    );
    const nativeRefreshMs = nsToMs(process.hrtime.bigint() - nativeRefreshStart);
    const jsPlanIndexStart = process.hrtime.bigint();
    const moduleUpdates = "moduleUpdates" in refreshed ? refreshed.moduleUpdates : [];
    const updateRefs = /* @__PURE__ */ new Map();
    if (moduleUpdates.length > 0) {
      const expectedIds = new Set(moduleUpdates.map((update) => update.id));
      for (const chunk of options.plan.chunks) {
        for (const module of chunk.modules) {
          if (!expectedIds.has(module.id)) continue;
          if (updateRefs.has(module.id)) {
            throw new Error(`Planner delta targets duplicate module '${module.id}'`);
          }
          updateRefs.set(module.id, module);
        }
      }
      if (updateRefs.size !== expectedIds.size) {
        throw new Error("Planner delta targets a module absent from the canonical plan");
      }
    }
    const jsPlanIndexMs = nsToMs(process.hrtime.bigint() - jsPlanIndexStart);
    const graphVersion = computeGraphVersion(options.versionInputs);
    const graphCommitStart = process.hrtime.bigint();
    const stagedRecords = native.graphStageCanonicalMutations(
      path12.join(resolveIonifyDir(), "graph.db"),
      graphVersion,
      refreshed.graphRecords
    );
    const graphCommitMs = nsToMs(process.hrtime.bigint() - graphCommitStart);
    const jsPatchStart = process.hrtime.bigint();
    for (const update of moduleUpdates) {
      const module = updateRefs.get(update.id);
      module.hash = update.hash ?? null;
      module.runtimeDemandHash = update.runtimeDemandHash ?? null;
      module.runtimeMutationVerified = update.runtimeMutationVerified === true;
      module.runtimeLinks = update.runtimeLinks ?? [];
    }
    const jsPatchMs = nsToMs(process.hrtime.bigint() - jsPatchStart);
    profileLog(
      `canonicalPlanMutationBreakdown nativeRefresh_ms=${nativeRefreshMs.toFixed(2)} jsPlanIndex_ms=${jsPlanIndexMs.toFixed(2)} graphCommit_ms=${graphCommitMs.toFixed(2)} jsPatch_ms=${jsPatchMs.toFixed(2)}`
    );
    profileLog(
      `canonicalPlanMutation_ms=${Date.now() - refreshStart} admitted=true records=${refreshed.graphRecords.length}`
    );
    logInfo(
      `[Planner] Canonical publication plan admitted and Graph mutation staged (records=${stagedRecords})`
    );
    const affectedChunkIds = Array.from(new Set(refreshed.affectedChunkIds ?? [])).sort();
    if (affectedChunkIds.length === 0) return null;
    const canonicalChunkIds = new Set(options.plan.chunks.map((chunk) => chunk.id));
    if (affectedChunkIds.some((chunkId) => !canonicalChunkIds.has(chunkId))) return null;
    const publicationContext = "publicationContext" in refreshed && Number.isInteger(refreshed.publicationContext) && refreshed.publicationContext > 0 ? refreshed.publicationContext : null;
    return {
      plan: "plan" in refreshed ? normalizePlan(refreshed.plan) : options.plan,
      affectedChunkIds,
      publicationContext
    };
  } catch (error) {
    profileLog(`canonicalPlanMutation_ms=${Date.now() - refreshStart} admitted=false`);
    logInfo(`[Planner] Canonical publication plan mutation rejected; using normal planning (${String(error)})`);
    return null;
  }
}
async function writeBuildManifest(outputDir, plan, artifacts, options) {
  const filesByChunk = /* @__PURE__ */ new Map();
  for (const artifact of artifacts) {
    filesByChunk.set(artifact.id, artifact.files);
  }
  const manifest = {
    version: 3,
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
        dynamicDeps: mod.dynamicDeps
      })),
      files: filesByChunk.get(chunk.id) ?? { js: [], css: [], assets: [] }
    })),
    federation: options?.federation ?? void 0
  };
  const dir = path12.resolve(outputDir);
  await fs10.promises.mkdir(dir, { recursive: true });
  const file = path12.join(dir, "manifest.json");
  const contents = `${JSON.stringify(manifest)}
`;
  await writeTextFileIfChanged(file, contents);
  return {
    file: toPosix(path12.relative(dir, file)),
    bytes: Buffer.byteLength(contents, "utf8"),
    hash: getCacheKey(contents)
  };
}
var CSS_AT_IMPORT_RE_SRC = `@import\\s+(?:url\\(\\s*)?(['"]?)([^'")\\s]+)\\1\\s*\\)?\\s*([^;]*);`;
function makeCssSelfContained(css, fromFsPath, visited, ctx) {
  if (!fromFsPath) return css;
  const importRe = new RegExp(CSS_AT_IMPORT_RE_SRC, "gi");
  let out = "";
  let lastIndex = 0;
  let match;
  while (match = importRe.exec(css)) {
    out += rewriteCssUrls(css.slice(lastIndex, match.index), fromFsPath, ctx.rootDir, ctx.emitUrlAsset);
    out += inlineOneCssImport(match, fromFsPath, visited, ctx);
    lastIndex = match.index + match[0].length;
  }
  out += rewriteCssUrls(css.slice(lastIndex), fromFsPath, ctx.rootDir, ctx.emitUrlAsset);
  return out;
}
function inlineOneCssImport(match, fromFsPath, visited, ctx) {
  const full = match[0];
  const spec = (match[2] || "").trim();
  const mediaTail = (match[3] || "").trim();
  if (!spec) return full;
  if (/^(?:[a-z]+:)?\/\//i.test(spec) || spec.startsWith("data:")) return full;
  let target = null;
  if (spec.startsWith(".")) {
    target = path12.resolve(path12.dirname(fromFsPath), spec);
  } else {
    try {
      const r = native?.resolveModule?.(spec, fromFsPath);
      const fp = r?.fsPath ?? r?.fs_path ?? null;
      if (typeof fp === "string" && fp.toLowerCase().endsWith(".css")) target = fp;
    } catch {
    }
  }
  if (!target) return full;
  target = target.split("?")[0].split("#")[0];
  if (!fs10.existsSync(target)) return full;
  let real;
  try {
    real = fs10.realpathSync(target);
  } catch {
    real = target;
  }
  if (visited.has(real)) return "";
  visited.add(real);
  let imported;
  try {
    imported = fs10.readFileSync(target, "utf8");
  } catch {
    return full;
  }
  imported = makeCssSelfContained(imported, target, visited, ctx);
  return mediaTail ? `@media ${mediaTail} {
${imported}
}` : imported;
}
async function emitChunks(outputDir, plan, moduleOutputs, opts) {
  if (!native?.buildChunks) {
    logWarn("Native buildChunks binding is not available; using JS fallback emitter.");
    const rawArtifacts2 = buildJsFallbackArtifacts(plan, moduleOutputs);
    return emitChunksFromArtifacts(outputDir, plan, moduleOutputs, rawArtifacts2);
  }
  const start = Date.now();
  const plannerPublicationContext = opts?.nativePublicationContext;
  const nativePlan = plannerPublicationContext ? null : normalizePlan(plan);
  const nativeOptions = plannerPublicationContext ? { ...opts?.nativeOptions, plannerPublicationContext } : opts?.nativeOptions;
  const rawArtifacts = native.buildChunks(nativePlan, opts?.casRoot, opts?.versionHash, nativeOptions) ?? [];
  logInfo(`[Bundler] buildChunks completed in ${Date.now() - start}ms (native)`);
  return emitChunksFromArtifacts(outputDir, plan, moduleOutputs, rawArtifacts, opts?.incrementalBase);
}
function buildJsFallbackArtifacts(plan, moduleOutputs) {
  const artifacts = [];
  for (const chunk of plan.chunks) {
    const jsParts = [];
    const assets = [];
    const idToFsPath = /* @__PURE__ */ new Map();
    for (const mod of chunk.modules) {
      const fsPath = mod.fsPath;
      if (typeof fsPath === "string" && fsPath.length > 0) {
        idToFsPath.set(mod.id, fsPath);
      }
    }
    for (const mod of chunk.modules) {
      const output = moduleOutputs.get(mod.id);
      if (output?.type === "js") {
        jsParts.push(`// ${mod.id}
${output.code}`);
      }
    }
    for (const assetId of chunk.assets) {
      const assetPath = idToFsPath.get(assetId);
      if (!assetPath) continue;
      try {
        const data = fs10.readFileSync(assetPath);
        if (data.length < 4096) {
          const mime = "application/octet-stream";
          const inline = `data:${mime};base64,${data.toString("base64")}`;
          jsParts.push(`// ${assetId}
export const __ionify_asset = "${inline}";`);
          continue;
        }
        const hash = crypto2.createHash("sha256").update(data).digest("hex").slice(0, 16);
        const ext = path12.extname(assetPath) || ".bin";
        const fileName = `assets/${hash}${ext}`;
        assets.push({
          source: assetPath,
          file_name: fileName
        });
      } catch {
        const fileName = path12.basename(assetPath) || "asset";
        assets.push({
          source: assetPath,
          file_name: fileName
        });
      }
    }
    const code = jsParts.length ? jsParts.join("\n\n") : `// Ionify JS fallback for ${chunk.id}
export default {};`;
    artifacts.push({
      id: chunk.id,
      file_name: `${chunk.id}.fallback.js`,
      code,
      map: null,
      assets,
      code_bytes: Buffer.byteLength(code, "utf8"),
      map_bytes: 0
    });
  }
  return artifacts;
}
function normalizeNativeArtifact(raw) {
  const id = raw.id;
  if (!id) {
    throw new Error("Native artifact missing id");
  }
  const file_name = raw.file_name ?? `${id.replace(/::/g, ".")}.native.js`;
  const code = raw.code ?? "";
  const map = raw.map ?? null;
  const code_bytes = typeof raw.code_bytes === "number" ? raw.code_bytes : Buffer.byteLength(code, "utf8");
  const map_bytes = typeof raw.map_bytes === "number" ? raw.map_bytes : map ? Buffer.byteLength(map, "utf8") : 0;
  const assets = Array.isArray(raw.assets) ? raw.assets.map((asset) => ({
    source: asset.source,
    file_name: asset.file_name ?? asset.fileName ?? path12.basename(asset.source ?? "asset")
  })) : [];
  return { id, file_name, code, map, assets, code_bytes, map_bytes };
}
async function emitChunksFromArtifacts(outputDir, plan, moduleOutputs, rawArtifacts, incrementalBase) {
  const publicationProfileStart = isBundleProfileEnabled() ? process.hrtime.bigint() : 0n;
  let publicationSetupEnd = publicationProfileStart;
  let publicationReusedNs = 0n;
  let publicationChangedNs = 0n;
  let publicationReusedChunks = 0;
  let publicationChangedChunks = 0;
  const chunkDir = path12.join(outputDir, "chunks");
  await fs10.promises.mkdir(chunkDir, { recursive: true });
  const assetsDir = path12.join(outputDir, "assets");
  await fs10.promises.mkdir(assetsDir, { recursive: true });
  const previousOutputStats = loadPreviousOutputStats(outputDir);
  const enableSourceMaps = process.env.IONIFY_SOURCEMAPS === "true";
  const cssProfile = isBundleProfileEnabled() ? {
    chunksWithCss: 0,
    cssModulesVisited: 0,
    cssFsFallbackReads: 0,
    cssDedupedModules: 0,
    cssFilesWritten: 0,
    cssInputBytes: 0,
    cssOutputBytes: 0,
    nsOrder: 0n,
    nsMinify: 0n,
    nsEmit: 0n
  } : null;
  const grouped = /* @__PURE__ */ new Map();
  for (const raw of rawArtifacts) {
    const artifact = normalizeNativeArtifact(raw);
    const baseId = artifact.id.split("::")[0] ?? artifact.id;
    const bucket = grouped.get(baseId);
    if (bucket) bucket.push(artifact);
    else grouped.set(baseId, [artifact]);
  }
  const buildStats = incrementalBase ? { ...incrementalBase.stats } : {};
  delete buildStats.__cssPipelineProfile;
  const incrementalBaseById = new Map(
    (incrementalBase?.artifacts ?? []).map((artifact) => [artifact.id, artifact.files])
  );
  const verifiedResourceStableChunkIds = new Set(
    incrementalBase?.verifiedResourceStableChunkIds ?? []
  );
  const results = [];
  const cssUrlRootDir = process.env.IONIFY_PROJECT_ROOT || process.cwd();
  const emittedUrlAssets = /* @__PURE__ */ new Set();
  const cssCtx = {
    rootDir: cssUrlRootDir,
    emitUrlAsset: (absPath) => {
      try {
        if (isForbiddenFsPath(absPath) || !fs10.existsSync(absPath)) return null;
        const data = fs10.readFileSync(absPath);
        const ext = path12.extname(absPath);
        const safeBase = path12.basename(absPath, ext).replace(/[^a-zA-Z0-9._-]/g, "_") || "asset";
        const hash = getCacheKey(data).slice(0, 8);
        const fileName = `${safeBase}.${hash}${ext}`;
        if (!emittedUrlAssets.has(fileName)) {
          const destAbs = path12.join(assetsDir, fileName);
          let needWrite = true;
          try {
            if (fs10.existsSync(destAbs) && fs10.readFileSync(destAbs).equals(data)) needWrite = false;
          } catch {
          }
          if (needWrite) fs10.writeFileSync(destAbs, data);
          buildStats[`assets/${fileName}`] = {
            bytes: data.length,
            hash: getCacheKey(data),
            emitter: "css-url",
            type: "asset"
          };
          emittedUrlAssets.add(fileName);
        }
        return `./${fileName}`;
      } catch {
        return null;
      }
    }
  };
  if (publicationProfileStart) publicationSetupEnd = process.hrtime.bigint();
  for (const chunk of plan.chunks) {
    const chunkPublicationStart = publicationProfileStart ? process.hrtime.bigint() : 0n;
    const artifacts = grouped.get(chunk.id);
    if (!artifacts || !artifacts.length) {
      const reused = incrementalBaseById.get(chunk.id);
      if (!reused) {
        throw new Error(`Native bundler did not emit artifacts for ${chunk.id}`);
      }
      results.push({
        id: chunk.id,
        files: {
          js: [...reused.js],
          css: [...reused.css],
          assets: [...reused.assets]
        }
      });
      if (publicationProfileStart) {
        publicationReusedNs += process.hrtime.bigint() - chunkPublicationStart;
        publicationReusedChunks += 1;
      }
      continue;
    }
    const replaced = incrementalBaseById.get(chunk.id);
    const reuseVerifiedResources = replaced !== void 0 && verifiedResourceStableChunkIds.has(chunk.id) && // The current emitter publishes at most one CSS artifact per chunk. An
    // unknown legacy shape fails closed to normal resource assembly.
    replaced.css.length <= 1;
    if (replaced) {
      const replacedFiles = reuseVerifiedResources ? replaced.js : [...replaced.js, ...replaced.css, ...replaced.assets];
      for (const rel of replacedFiles) {
        delete buildStats[rel];
      }
    }
    const chunkOutDir = path12.join(chunkDir, chunk.id);
    await fs10.promises.mkdir(chunkOutDir, { recursive: true });
    artifacts.sort((a, b) => {
      if (a.id === chunk.id) return -1;
      if (b.id === chunk.id) return 1;
      return a.id.localeCompare(b.id);
    });
    const jsFiles = [];
    const cssFiles = reuseVerifiedResources ? [...replaced.css] : [];
    const assetFiles = reuseVerifiedResources ? [...replaced.assets] : [];
    const assetWritten = /* @__PURE__ */ new Set();
    const idToFsPath = /* @__PURE__ */ new Map();
    for (const mod of chunk.modules) {
      const fsPath = mod.fsPath;
      if (typeof fsPath === "string" && fsPath.length > 0) {
        idToFsPath.set(mod.id, fsPath);
      }
    }
    const copyAssets = async (assets) => {
      for (const asset of assets) {
        if (!asset?.source) continue;
        const relName = asset.file_name ?? path12.basename(asset.source);
        const assetFile = path12.join(outputDir, relName);
        if (assetWritten.has(assetFile)) continue;
        try {
          const data = await fs10.promises.readFile(asset.source);
          await writeBufferFileIfChanged(assetFile, data);
          const rel = toPosix(path12.relative(outputDir, assetFile));
          buildStats[rel] = {
            bytes: data.length,
            hash: getCacheKey(data),
            emitter: "native",
            type: "asset"
          };
          assetFiles.push(rel);
          assetWritten.add(assetFile);
        } catch (err) {
          logWarn(`Failed to emit asset ${asset.source}: ${String(err)}`);
        }
      }
    };
    const cssOrderStart = cssProfile ? process.hrtime.bigint() : 0n;
    const cssOrder = reuseVerifiedResources ? [] : orderCssModules(chunk);
    if (cssProfile) {
      cssProfile.nsOrder += process.hrtime.bigint() - cssOrderStart;
      if (cssOrder.length) cssProfile.chunksWithCss += 1;
    }
    let cssFileRel = reuseVerifiedResources ? cssFiles[0] ?? null : null;
    if (!reuseVerifiedResources && cssOrder.length) {
      const seenCss = /* @__PURE__ */ new Set();
      const cssPieces = [];
      for (const cssId of cssOrder) {
        if (cssProfile) cssProfile.cssModulesVisited += 1;
        let cssSource = moduleOutputs.get(cssId)?.code;
        const cssPath = idToFsPath.get(cssId) ?? null;
        if (!cssSource && cssPath && fs10.existsSync(cssPath)) {
          try {
            cssSource = await fs10.promises.readFile(cssPath, "utf8");
            if (cssProfile) cssProfile.cssFsFallbackReads += 1;
          } catch (err) {
            logWarn(`Failed to read CSS source ${cssId}: ${String(err)}`);
          }
        }
        if (!cssSource) continue;
        cssSource = makeCssSelfContained(cssSource, cssPath, /* @__PURE__ */ new Set(), cssCtx);
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
        const cssFilePath = path12.join(outputDir, cssFileName);
        const cssFullHash = getCacheKey(combinedCss);
        const emitStart = cssProfile ? process.hrtime.bigint() : 0n;
        const cssChanged = await writeTextFileIfStatsMatch(
          outputDir,
          previousOutputStats,
          cssFilePath,
          combinedCss,
          cssFullHash
        );
        if (cssProfile) {
          cssProfile.nsEmit += process.hrtime.bigint() - emitStart;
          if (cssChanged) cssProfile.cssFilesWritten += 1;
        }
        cssFileRel = toPosix(path12.relative(outputDir, cssFilePath));
        buildStats[cssFileRel] = {
          bytes: Buffer.byteLength(combinedCss),
          hash: cssFullHash,
          emitter: "native",
          type: "css"
        };
        cssFiles.push(cssFileRel);
      }
    }
    for (const artifact of artifacts) {
      const nativeFile = path12.join(chunkOutDir, artifact.file_name);
      let nativeCode = artifact.code;
      if (cssFileRel && !chunk.entry) {
        const absCss = path12.join(outputDir, cssFileRel);
        const relCss = toPosix(path12.relative(path12.dirname(nativeFile), absCss));
        const inject = `(()=>{const url=new URL(${JSON.stringify(
          relCss
        )},import.meta.url).toString();if(typeof document!=="undefined"&&!document.querySelector('link[data-ionify-css="'+url+'"]')){const l=document.createElement("link");l.rel="stylesheet";l.href=url;l.setAttribute("data-ionify-css",url);document.head.appendChild(l);}})();`;
        nativeCode = `${inject}
${nativeCode}`;
      }
      if (enableSourceMaps && artifact.map) {
        const mapFile = `${nativeFile}.map`;
        const mapHash = getCacheKey(artifact.map);
        await writeTextFileIfStatsMatch(outputDir, previousOutputStats, mapFile, artifact.map, mapHash);
        nativeCode = `${nativeCode}
//# sourceMappingURL=${path12.basename(mapFile)}`;
        const relMap = toPosix(path12.relative(outputDir, mapFile));
        buildStats[relMap] = {
          bytes: Buffer.byteLength(artifact.map, "utf8"),
          hash: mapHash,
          emitter: "native",
          type: "map"
        };
        jsFiles.push(relMap);
      }
      const nativeHash = getCacheKey(nativeCode);
      await writeTextFileIfStatsMatch(
        outputDir,
        previousOutputStats,
        nativeFile,
        nativeCode,
        nativeHash
      );
      const relNative = toPosix(path12.relative(outputDir, nativeFile));
      buildStats[relNative] = {
        bytes: Buffer.byteLength(nativeCode, "utf8"),
        hash: nativeHash,
        emitter: "native",
        type: "js"
      };
      jsFiles.push(relNative);
      if (!reuseVerifiedResources) {
        await copyAssets(artifact.assets);
      }
    }
    results.push({
      id: chunk.id,
      files: {
        js: jsFiles,
        css: cssFiles,
        assets: assetFiles
      }
    });
    if (publicationProfileStart) {
      publicationChangedNs += process.hrtime.bigint() - chunkPublicationStart;
      publicationChangedChunks += 1;
    }
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
      emitMs: nsToMs(cssProfile.nsEmit)
    };
    console.error(
      `[BundlerProfile][css] chunks=${cssProfile.chunksWithCss} modules=${cssProfile.cssModulesVisited} fs_reads=${cssProfile.cssFsFallbackReads} deduped=${cssProfile.cssDedupedModules} writes=${cssProfile.cssFilesWritten} order_ms=${nsToMs(
        cssProfile.nsOrder
      ).toFixed(2)} minify_ms=${nsToMs(cssProfile.nsMinify).toFixed(2)} emit_ms=${nsToMs(
        cssProfile.nsEmit
      ).toFixed(2)} bytes_in=${cssProfile.cssInputBytes} bytes_out=${cssProfile.cssOutputBytes}`
    );
    const publicationEnd = process.hrtime.bigint();
    console.error(
      `[BundlerProfile][publication] total_ms=${nsToMs(publicationEnd - publicationProfileStart).toFixed(2)} setup_ms=${nsToMs(publicationSetupEnd - publicationProfileStart).toFixed(2)} changed_ms=${nsToMs(publicationChangedNs).toFixed(2)} changed_chunks=${publicationChangedChunks} reused_ms=${nsToMs(publicationReusedNs).toFixed(2)} reused_chunks=${publicationReusedChunks}`
    );
  }
  return { artifacts: results, stats: buildStats };
}
async function writeAssetsManifest(outputDir, artifacts) {
  const dir = path12.resolve(outputDir);
  await fs10.promises.mkdir(dir, { recursive: true });
  const file = path12.join(dir, "manifest.assets.json");
  const payload = {
    chunks: artifacts
  };
  const contents = JSON.stringify(payload, null, 2);
  await writeTextFileIfChanged(file, contents);
  return {
    file: toPosix(path12.relative(dir, file)),
    bytes: Buffer.byteLength(contents, "utf8"),
    hash: getCacheKey(contents)
  };
}

// src/core/worker/pool.ts
import { Worker } from "worker_threads";
import os from "os";
import { fileURLToPath as fileURLToPath3 } from "url";
var workerPath = fileURLToPath3(new URL("./worker.cjs", import.meta.url));
var TransformWorkerPool = class {
  workers = [];
  queue = [];
  active = /* @__PURE__ */ new Map();
  callbacks = /* @__PURE__ */ new Map();
  waiters = [];
  pendingBytes = 0;
  closed = false;
  size;
  maxQueueBytes;
  constructor(options = {}) {
    const cpuDefault = Math.max(1, os.cpus().length - 1);
    this.size = Math.max(1, options.size ?? cpuDefault);
    this.maxQueueBytes = options.maxQueueBytes;
    for (let i = 0; i < this.size; i++) {
      this.spawnWorker();
    }
  }
  spawnWorker() {
    const worker = new Worker(workerPath, { env: process.env });
    const id = worker.threadId;
    worker.on("message", (message) => {
      const item = this.active.get(id);
      if (item) {
        this.active.delete(id);
        this.pendingBytes -= item.size;
        this.resolveWaiters();
      }
      const cb = message ? this.callbacks.get(message.id) : void 0;
      if (message && cb) cb(message);
      if (message) this.callbacks.delete(message.id);
      this.dequeue(worker);
    });
    worker.on("error", (err) => {
      logWarn(`Transform worker error: ${String(err)}`);
      const item = this.active.get(id);
      if (item) {
        this.active.delete(id);
        this.queue.unshift(item);
      }
      this.spawnWorker();
    });
    worker.on("exit", (code) => {
      const item = this.active.get(id);
      if (item) {
        this.active.delete(id);
        this.queue.unshift(item);
      }
      if (!this.closed && code !== 0) {
        logWarn(`Transform worker exited unexpectedly (${code}), respawning`);
        this.spawnWorker();
      }
    });
    this.workers.push(worker);
  }
  dequeue(worker) {
    if (this.queue.length === 0) return;
    const item = this.queue.shift();
    this.active.set(worker.threadId, item);
    worker.postMessage(item.job);
  }
  resolveWaiters() {
    if (!this.maxQueueBytes) return;
    while (this.waiters.length && this.pendingBytes < this.maxQueueBytes) {
      const resolve = this.waiters.shift();
      resolve && resolve();
    }
  }
  async run(job) {
    if (this.closed) {
      throw new Error("Worker pool already closed");
    }
    const size = Buffer.byteLength(job.code, "utf8");
    if (this.maxQueueBytes) {
      while (this.pendingBytes + size > this.maxQueueBytes) {
        await new Promise((resolve) => this.waiters.push(resolve));
        await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
      }
    }
    this.pendingBytes += size;
    return new Promise((resolve) => {
      this.callbacks.set(job.id, resolve);
      const idleWorker = this.workers.find((w) => !this.active.has(w.threadId));
      const item = { job, size };
      if (idleWorker) {
        this.active.set(idleWorker.threadId, item);
        idleWorker.postMessage(job);
      } else {
        this.queue.push(item);
      }
    });
  }
  async runMany(jobs) {
    const resultMap = /* @__PURE__ */ new Map();
    await Promise.all(
      jobs.map(async (job) => {
        const res = await this.run(job);
        resultMap.set(job.id, res);
      })
    );
    return jobs.map((job) => resultMap.get(job.id));
  }
  async close() {
    this.closed = true;
    await Promise.all(this.workers.map((worker) => worker.terminate()));
    this.workers = [];
    this.queue = [];
    this.active.clear();
    this.callbacks.clear();
    this.waiters.forEach((resolve) => resolve());
    this.waiters = [];
    this.pendingBytes = 0;
  }
  async drain() {
    while (!this.closed && (this.queue.length || this.active.size)) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
};

// src/core/transform-artifact-proof.ts
import fs11 from "fs";
import path13 from "path";
var TRANSFORM_PROOF_VERSION = 1;
var TRANSFORM_PROOF_FILE = "transform.proof.json";
function proofPathOf(dir) {
  return path13.join(dir, TRANSFORM_PROOF_FILE);
}
function jsPathOf(dir) {
  return path13.join(dir, "transformed.js");
}
function mapPathOf(dir) {
  return path13.join(dir, "transformed.js.map");
}
function writeTemp(target, data) {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs11.writeFileSync(tmp, data);
  return tmp;
}
function writeTransformArtifact(opts) {
  fs11.mkdirSync(opts.dir, { recursive: true });
  const jsPath = jsPathOf(opts.dir);
  const mapPath = mapPathOf(opts.dir);
  const proofPath2 = proofPathOf(opts.dir);
  const tmpJs = writeTemp(jsPath, opts.bytes);
  const tmpMap = opts.map != null ? writeTemp(mapPath, opts.map) : null;
  const proof = {
    proofVersion: TRANSFORM_PROOF_VERSION,
    outputHash: getCacheKey(opts.bytes),
    map: opts.map != null ? { mapHash: getCacheKey(opts.map) } : { authoritativeAbsence: true },
    ...opts.identity
  };
  fs11.renameSync(tmpJs, jsPath);
  if (tmpMap) {
    fs11.renameSync(tmpMap, mapPath);
  } else if (fs11.existsSync(mapPath)) {
    fs11.rmSync(mapPath);
  }
  fs11.renameSync(writeTemp(proofPath2, `${JSON.stringify(proof)}
`), proofPath2);
  return proof;
}
function admitTransformArtifact(dir, exp) {
  const proofPath2 = proofPathOf(dir);
  const jsPath = jsPathOf(dir);
  const mapPath = mapPathOf(dir);
  if (!fs11.existsSync(proofPath2) || !fs11.existsSync(jsPath)) {
    return { admissible: false, reason: "missing artifact or proof" };
  }
  let proof;
  try {
    proof = JSON.parse(fs11.readFileSync(proofPath2, "utf8"));
  } catch {
    return { admissible: false, reason: "malformed proof" };
  }
  if (proof.proofVersion !== TRANSFORM_PROOF_VERSION) {
    return { admissible: false, reason: "unsupported proofVersion" };
  }
  if (proof.sourceHash !== exp.sourceHash) {
    return { admissible: false, reason: "sourceHash mismatch" };
  }
  if (exp.recomputeArtifactHash(proof.sourceHash, proof.artifactKind, proof.defineHash) !== exp.artifactHash) {
    return { admissible: false, reason: "proof/location mismatch" };
  }
  if (proof.recipeConfigHash !== exp.recipeConfigHash || proof.defineHash !== exp.defineHash) {
    return { admissible: false, reason: "recipe mismatch" };
  }
  if (proof.artifactKind !== exp.artifactKind || proof.variant !== exp.variant) {
    return { admissible: false, reason: "kind/variant mismatch" };
  }
  if (getCacheKey(fs11.readFileSync(jsPath, "utf8")) !== proof.outputHash) {
    return { admissible: false, reason: "outputHash mismatch" };
  }
  if ("authoritativeAbsence" in proof.map) {
    if (fs11.existsSync(mapPath)) {
      return { admissible: false, reason: "unexpected map present" };
    }
  } else if (!fs11.existsSync(mapPath) || getCacheKey(fs11.readFileSync(mapPath, "utf8")) !== proof.map.mapHash) {
    return { admissible: false, reason: "map integrity mismatch" };
  }
  return { admissible: true, proof };
}

// src/core/canonical-materialize.ts
function canonicalArtifactHash(sourceHash, kind, defineHash) {
  if (kind !== "js") return sourceHash;
  if (!defineHash) return sourceHash;
  return getCacheKey(`${sourceHash}|define:${defineHash}`);
}
function materializeCanonicalGeneration(gen, ctx) {
  const baseHash = gen.sourceHash;
  const baseProof = writeTransformArtifact({
    dir: getCasArtifactPath(ctx.casRoot, ctx.configHash, baseHash),
    bytes: gen.codeA,
    map: gen.mapA ?? null,
    identity: {
      sourceHash: baseHash,
      recipeConfigHash: ctx.configHash,
      defineHash: "",
      artifactKind: "js",
      variant: "base"
    }
  });
  const result = { baseArtifactHash: baseHash, baseProof };
  if (ctx.defineHash) {
    const artifactHash = canonicalArtifactHash(baseHash, "js", ctx.defineHash);
    const mapB = gen.codeB === gen.codeA ? gen.mapA ?? null : null;
    result.defineProof = writeTransformArtifact({
      dir: getCasArtifactPath(ctx.casRoot, ctx.configHash, artifactHash),
      bytes: gen.codeB,
      map: mapB,
      identity: {
        sourceHash: baseHash,
        recipeConfigHash: ctx.configHash,
        defineHash: ctx.defineHash,
        artifactKind: "js",
        variant: "define"
      }
    });
    result.defineArtifactHash = artifactHash;
  }
  return result;
}

// src/core/workspace.ts
import fs12 from "fs";
import path14 from "path";
import crypto3 from "crypto";
var WORKSPACE_MARKERS = [
  "pnpm-workspace.yaml",
  "turbo.json",
  "lerna.json",
  "nx.json",
  "rush.json",
  ".gitmodules"
];
var LOCKFILE_MARKERS = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb"];
function realpathOrResolve3(absPath) {
  try {
    const fn = fs12.realpathSync.native;
    if (fn) return fn(absPath);
    return fs12.realpathSync(absPath);
  } catch {
    return path14.resolve(absPath);
  }
}
function fileExists(filePath) {
  try {
    return fs12.existsSync(filePath) && fs12.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
function dirExists(dirPath) {
  try {
    return fs12.existsSync(dirPath) && fs12.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}
function hasGitRootMarker(dir) {
  const dotGit = path14.join(dir, ".git");
  return fileExists(dotGit) || dirExists(dotGit);
}
function hasWorkspacesField(dir) {
  const pkgPath = path14.join(dir, "package.json");
  if (!fileExists(pkgPath)) return false;
  try {
    const raw = fs12.readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw);
    const ws = parsed?.workspaces;
    if (Array.isArray(ws) && ws.length > 0) return true;
    if (ws && typeof ws === "object") return true;
  } catch {
    return false;
  }
  return false;
}
function findUp(startDir, predicate) {
  let current = path14.resolve(startDir);
  for (let i = 0; i < 50; i++) {
    const markers = predicate(current);
    if (markers && markers.length) return { dir: current, markers };
    const parent = path14.dirname(current);
    if (!parent || parent === current) break;
    current = parent;
  }
  return null;
}
function findNearestPackageRoot(startDir) {
  const found = findUp(startDir, (dir) => fileExists(path14.join(dir, "package.json")) ? ["package.json"] : null);
  return found?.dir ?? null;
}
function detectWorkspaceRoot(projectRoot) {
  const explicit = findUp(projectRoot, (dir) => {
    const markers = [];
    for (const name of WORKSPACE_MARKERS) {
      if (fileExists(path14.join(dir, name))) markers.push(name);
    }
    if (hasWorkspacesField(dir)) markers.push("package.json#workspaces");
    for (const name of LOCKFILE_MARKERS) {
      if (fileExists(path14.join(dir, name))) markers.push(name);
    }
    return markers.length ? markers : null;
  });
  if (explicit) return explicit;
  const git = findUp(projectRoot, (dir) => hasGitRootMarker(dir) ? [".git"] : null);
  if (git) return git;
  return { dir: projectRoot, markers: [] };
}
function readGitSubmoduleRoots(workspaceRoot) {
  const gitmodulesPath = path14.join(workspaceRoot, ".gitmodules");
  if (!fileExists(gitmodulesPath)) return [];
  let text;
  try {
    text = fs12.readFileSync(gitmodulesPath, "utf8");
  } catch {
    return [];
  }
  const roots = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*path\s*=\s*(.+)\s*$/);
    if (!m) continue;
    const raw = m[1] ? String(m[1]).trim() : "";
    if (!raw) continue;
    const abs = path14.resolve(workspaceRoot, raw);
    const normalizedWs = realpathOrResolve3(workspaceRoot);
    const normalizedAbs = realpathOrResolve3(abs);
    if (normalizedAbs === normalizedWs || normalizedAbs.startsWith(normalizedWs + path14.sep)) {
      roots.push(abs);
    }
  }
  return Array.from(new Set(roots.map((p) => realpathOrResolve3(p)))).sort();
}
function computeWorkspaceId(workspaceRoot) {
  const hash = crypto3.createHash("sha256");
  hash.update("ionify:workspace:v1\n");
  const identityFiles = [
    "package.json",
    "pnpm-workspace.yaml",
    "turbo.json",
    "lerna.json",
    "nx.json",
    "rush.json",
    ".gitmodules"
  ];
  for (const name of identityFiles) {
    const p = path14.join(workspaceRoot, name);
    if (!fileExists(p)) continue;
    try {
      hash.update(name);
      hash.update("\0");
      hash.update(fs12.readFileSync(p));
      hash.update("\0");
    } catch {
    }
  }
  return hash.digest("hex").slice(0, 12);
}
function computeProjectId(workspaceRoot, projectRoot) {
  const rel = path14.relative(workspaceRoot, projectRoot).split(path14.sep).join("/");
  const normalizedRel = rel && rel !== "." ? rel : "root";
  const hash = crypto3.createHash("sha256").update(`ionify:project:v1:${normalizedRel}`).digest("hex");
  return { id: hash.slice(0, 10), rel: normalizedRel };
}
function uniqueRoots(roots) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const r of roots) {
    const normalized = realpathOrResolve3(path14.resolve(r));
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}
function resolveWorkspace(startDir, opts = {}) {
  const startAbs = realpathOrResolve3(path14.resolve(startDir));
  const projectRoot = opts.projectRootOverride ? realpathOrResolve3(path14.resolve(opts.projectRootOverride)) : realpathOrResolve3(findNearestPackageRoot(startAbs) ?? startAbs);
  const ws = detectWorkspaceRoot(projectRoot);
  const workspaceRoot = realpathOrResolve3(ws.dir);
  const ionifyDir = path14.join(workspaceRoot, ".ionify");
  const submoduleRoots = readGitSubmoduleRoots(workspaceRoot);
  const markers = ws.markers;
  const workspaceId = computeWorkspaceId(workspaceRoot);
  const { id: projectId, rel: projectRelPath } = computeProjectId(workspaceRoot, projectRoot);
  const allowedRoots = uniqueRoots([workspaceRoot, projectRoot, ...submoduleRoots]);
  return {
    projectRoot,
    workspaceRoot,
    ionifyDir,
    workspaceId,
    projectId,
    projectRelPath,
    markers,
    submoduleRoots,
    allowedRoots
  };
}

// src/core/utils/define.ts
function applyDefineReplacements(code, definitions) {
  if (!definitions || Object.keys(definitions).length === 0) {
    return code;
  }
  if (!native?.applyDefineReplacements) {
    throw new Error("[define] canonical native applyDefineReplacements binding is unavailable");
  }
  const { replacements, importMetaEnvLiteral } = buildDefineRecipe(definitions);
  return native.applyDefineReplacements(code, replacements, importMetaEnvLiteral ?? void 0);
}
function buildDefineRecipe(definitions) {
  const sortedKeys = Object.keys(definitions).sort((a, b) => b.length - a.length);
  const replacements = [];
  for (const key of sortedKeys) {
    if (key === "import.meta.env") continue;
    const value = definitions[key];
    let replacement;
    if (typeof value === "string") {
      if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
        replacement = value;
      } else {
        replacement = JSON.stringify(value);
      }
    } else if (typeof value === "number" || typeof value === "boolean") {
      replacement = String(value);
    } else if (value === null || value === void 0) {
      replacement = "null";
    } else {
      replacement = JSON.stringify(value);
    }
    replacements.push({ key, replacement, isMember: key.includes(".") });
  }
  let importMetaEnvLiteral = null;
  if ("import.meta.env" in definitions) {
    const envObj = definitions["import.meta.env"];
    importMetaEnvLiteral = typeof envObj === "string" && envObj.startsWith("{") ? envObj : JSON.stringify(envObj);
  }
  return { replacements, importMetaEnvLiteral };
}
function buildDefineConfig(userDefine, envValues, envPrefix = ["VITE_", "IONIFY_"]) {
  const define = { ...userDefine || {} };
  const prefixes = Array.isArray(envPrefix) ? envPrefix : [envPrefix];
  const prefixedEnvVars = {};
  for (const [key, value] of Object.entries(envValues)) {
    const hasPrefix = prefixes.some((prefix) => key.startsWith(prefix));
    if (hasPrefix || key === "NODE_ENV" || key === "MODE") {
      prefixedEnvVars[key] = value;
    }
  }
  for (const [key, value] of Object.entries(prefixedEnvVars)) {
    const importMetaKey = `import.meta.env.${key}`;
    if (!(importMetaKey in define)) {
      define[importMetaKey] = value;
    }
  }
  const isProductionRuntime = envValues.NODE_ENV === "production";
  if (!("import.meta.env.DEV" in define)) {
    define["import.meta.env.DEV"] = !isProductionRuntime;
  }
  if (!("import.meta.env.PROD" in define)) {
    define["import.meta.env.PROD"] = isProductionRuntime;
  }
  if (!("process.env.NODE_ENV" in define) && typeof envValues.NODE_ENV === "string") {
    define["process.env.NODE_ENV"] = envValues.NODE_ENV;
  }
  if (!("process.env.MODE" in define) && typeof envValues.MODE === "string") {
    define["process.env.MODE"] = envValues.MODE;
  }
  if (!("import.meta.env" in define)) {
    const envObj = {
      MODE: envValues.MODE ?? "development",
      DEV: !isProductionRuntime,
      PROD: isProductionRuntime,
      BASE_URL: "/",
      SSR: false
    };
    for (const [key, value] of Object.entries(prefixedEnvVars)) {
      envObj[key] = value;
    }
    define["import.meta.env"] = envObj;
  }
  return define;
}
var ENV_PLACEHOLDER_PATTERN = /%([A-Z0-9_]+)%/g;
function substituteEnvPlaceholders(input, envValues, envPrefix = ["VITE_", "IONIFY_"]) {
  const prefixes = Array.isArray(envPrefix) ? envPrefix : [envPrefix];
  return input.replace(ENV_PLACEHOLDER_PATTERN, (match, key) => {
    const known = key === "NODE_ENV" || key === "MODE" || prefixes.some((prefix) => key.startsWith(prefix));
    if (!known) return match;
    const replacement = envValues[key];
    return replacement !== void 0 ? replacement : match;
  });
}

// src/core/utils/define-signature.ts
function stableStringify(value) {
  return JSON.stringify(value, (_key, val) => {
    if (!val || typeof val !== "object") return val;
    if (Array.isArray(val)) return val;
    const out = {};
    for (const k of Object.keys(val).sort()) {
      out[k] = val[k];
    }
    return out;
  });
}
function computeDefineSignature(defineConfig) {
  const keys = Object.keys(defineConfig).sort();
  if (keys.length === 0) return "";
  const parts = [];
  for (const key of keys) {
    parts.push(`${key}=${stableStringify(defineConfig[key])}`);
  }
  return parts.join("|");
}

// src/core/deps/vendor-pack-utils.ts
import crypto4 from "crypto";
function computeChunkGroupIdFromStableIds(stableIds) {
  const ids = stableIds.map((v) => String(v)).filter(Boolean).slice().sort();
  const unique = [];
  for (const id of ids) {
    if (unique.length === 0 || unique[unique.length - 1] !== id) unique.push(id);
  }
  const hash = crypto4.createHash("sha256");
  for (const id of unique) {
    hash.update(id);
    hash.update("|");
  }
  const digest = hash.digest("hex");
  return `sc${digest.slice(0, 8)}`;
}

// src/core/deps/dep-stops.ts
import fs13 from "fs";
import path15 from "path";
function loadDepStopsFromManifest(depsRoot) {
  const manifestPath = path15.join(depsRoot, "manifest.json");
  if (!fs13.existsSync(manifestPath)) return [];
  try {
    const raw = fs13.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    const entries = parsed?.entries ?? {};
    const stops = [];
    for (const [entryPath, entry] of Object.entries(entries)) {
      const artifactHash = entry?.artifactHash ?? "";
      if (!artifactHash) continue;
      stops.push({ entryPath, artifactHash });
    }
    return stops;
  } catch {
    return [];
  }
}

// src/core/deps/feature-pack-planner.ts
import fs14 from "fs";
import path16 from "path";
function realpathOrSelf(filePath) {
  try {
    return fs14.realpathSync(filePath);
  } catch {
    return filePath;
  }
}
function sortPackEntries(entries) {
  return entries.slice().sort((a, b) => {
    const labelDelta = a.packageLabel.localeCompare(b.packageLabel);
    if (labelDelta !== 0) return labelDelta;
    return a.fileName.localeCompare(b.fileName);
  });
}
function dedupeSortedStrings(values) {
  const unique = /* @__PURE__ */ new Set();
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) continue;
    unique.add(value);
  }
  return Array.from(unique).sort();
}
function deriveFamilyKey(packageName, packageLabel) {
  const pkg = String(packageName ?? "").trim();
  if (pkg.startsWith("@")) {
    const scope = pkg.split("/", 1)[0];
    if (scope) return scope;
  }
  if (pkg) {
    const base = pkg.split("/", 1)[0];
    if (base) return base;
  }
  const label = String(packageLabel ?? "").trim();
  if (label.startsWith("@")) {
    const parts = label.split("/");
    if (parts[0]) return parts[0];
  }
  if (label) {
    const base = label.split("/", 1)[0];
    if (base) return base;
  }
  return "";
}
function countIntersection(a, b) {
  if (!a?.length || !b?.length) return 0;
  const set = new Set(a);
  let count = 0;
  for (const value of b) {
    if (set.has(value)) count += 1;
  }
  return count;
}
function dominantRouteKeys(candidatesByFileName, entries) {
  const totals = /* @__PURE__ */ new Map();
  const support = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    const candidate = candidatesByFileName.get(entry.fileName);
    const routeRequestCounts = candidate?.routeRequestCounts ?? null;
    if (routeRequestCounts) {
      const seenForEntry = /* @__PURE__ */ new Set();
      for (const [routeKey, count] of Object.entries(routeRequestCounts)) {
        if (!routeKey || !Number.isFinite(count) || count <= 0) continue;
        totals.set(routeKey, (totals.get(routeKey) ?? 0) + count);
        if (!seenForEntry.has(routeKey)) {
          seenForEntry.add(routeKey);
          support.set(routeKey, (support.get(routeKey) ?? 0) + 1);
        }
      }
    }
  }
  const minSupport = entries.length <= 1 ? 1 : 2;
  return Array.from(totals.entries()).filter(([routeKey]) => (support.get(routeKey) ?? 0) >= minSupport).sort((a, b) => {
    const countDelta = b[1] - a[1];
    if (countDelta !== 0) return countDelta;
    return a[0].localeCompare(b[0]);
  }).slice(0, 3).map(([routeKey]) => routeKey);
}
function routeAffinityScore(candidate, anchorRouteKeys) {
  if (!anchorRouteKeys?.length || !candidate.routeKeys?.length) return 0;
  return countIntersection(candidate.routeKeys, anchorRouteKeys);
}
function routeBreadthPenalty(candidate) {
  const routeCount = Array.isArray(candidate.routeKeys) ? candidate.routeKeys.length : 0;
  const rootCount = Array.isArray(candidate.entryRootKeys) ? candidate.entryRootKeys.length : 0;
  const importerCount = Array.isArray(candidate.importerKeys) ? candidate.importerKeys.length : 0;
  return Math.max(0, routeCount - 1) * 90 + Math.max(0, rootCount - 2) * 30 + Math.max(0, importerCount - 3) * 12;
}
function collectAnchorSignals(candidatesByFileName, entries) {
  const families = /* @__PURE__ */ new Set();
  const importerKeys = /* @__PURE__ */ new Set();
  const entryRootKeys = /* @__PURE__ */ new Set();
  for (const entry of entries) {
    const candidate = candidatesByFileName.get(entry.fileName);
    const familyKey = deriveFamilyKey(candidate?.packageName, candidate?.packageLabel ?? entry.packageLabel);
    if (familyKey) families.add(familyKey);
    for (const importer of candidate?.importerKeys ?? []) {
      if (importer) importerKeys.add(importer);
    }
    for (const entryRoot of candidate?.entryRootKeys ?? []) {
      if (entryRoot) entryRootKeys.add(entryRoot);
    }
  }
  return {
    families: dedupeSortedStrings(families),
    importerKeys: dedupeSortedStrings(importerKeys),
    entryRootKeys: dedupeSortedStrings(entryRootKeys)
  };
}
function boostedCandidateOrder(candidates, getBoost) {
  return candidates.slice().sort((a, b) => {
    const scoreDelta = b.score + getBoost(b) - (a.score + getBoost(a));
    if (scoreDelta !== 0) return scoreDelta;
    const labelDelta = a.packageLabel.localeCompare(b.packageLabel);
    if (labelDelta !== 0) return labelDelta;
    return a.fileName.localeCompare(b.fileName);
  });
}
function reconcilePackEntries(entries, canonicalizeFileName) {
  const byEntryPath = /* @__PURE__ */ new Map();
  for (const entry of entries ?? []) {
    if (!entry?.entryPath || !entry?.fileName) continue;
    const next = {
      ...entry,
      fileName: canonicalizeFileName(entry.fileName, entry.entryPath) || entry.fileName
    };
    byEntryPath.set(realpathOrSelf(next.entryPath), next);
  }
  const deduped = [];
  const seenFileNames = /* @__PURE__ */ new Set();
  for (const entry of sortPackEntries(Array.from(byEntryPath.values()))) {
    if (seenFileNames.has(entry.fileName)) continue;
    seenFileNames.add(entry.fileName);
    deduped.push(entry);
  }
  return deduped;
}
function resolveChunkedPackEntries(entries, chunkedEntries) {
  const outByEntryPath = /* @__PURE__ */ new Map();
  for (const item of chunkedEntries ?? []) {
    const entryPath = typeof item?.entryPath === "string" ? item.entryPath : "";
    const outPath = typeof item?.outPath === "string" ? item.outPath : "";
    if (!entryPath || !outPath) continue;
    outByEntryPath.set(realpathOrSelf(entryPath), path16.basename(outPath));
  }
  const resolved = (entries ?? []).map((entry) => {
    const nextFileName = outByEntryPath.get(realpathOrSelf(entry.entryPath)) ?? entry.fileName;
    return { ...entry, fileName: nextFileName };
  });
  return reconcilePackEntries(resolved, (fileName) => fileName);
}
function deriveFeaturePackRoutingMap(states) {
  const routing = /* @__PURE__ */ new Map();
  for (const state of states) {
    if (!state || state.status !== "ready" || !state.chunkGroupId) continue;
    for (const entry of Array.isArray(state.entries) ? state.entries : []) {
      if (!entry?.fileName) continue;
      routing.set(entry.fileName, state.chunkGroupId);
    }
  }
  return routing;
}
function isFeaturePackSlimAligned(baseEntries, slimEntries) {
  const base = Array.isArray(baseEntries) ? baseEntries : [];
  const slim = Array.isArray(slimEntries) ? slimEntries : [];
  if (base.length === 0 || slim.length === 0) return false;
  const baseFileNames = base.map((entry) => entry?.fileName ?? "").filter(Boolean).slice().sort();
  const slimBaseFileNames = slim.map((entry) => entry?.baseFileName ?? "").filter(Boolean).slice().sort();
  if (baseFileNames.length !== slimBaseFileNames.length) return false;
  for (let i = 0; i < baseFileNames.length; i += 1) {
    if (baseFileNames[i] !== slimBaseFileNames[i]) return false;
  }
  return true;
}
function selectStableFeaturePackEntries(options) {
  const selected = [];
  const seen = /* @__PURE__ */ new Set();
  let totalBytes = 0;
  const forced = options.forcedFileNames ?? null;
  const candidateByFileName = /* @__PURE__ */ new Map();
  for (const candidate of options.candidates) {
    if (!candidate?.fileName || candidateByFileName.has(candidate.fileName)) continue;
    candidateByFileName.set(candidate.fileName, candidate);
  }
  const pushCandidate = (candidate) => {
    seen.add(candidate.fileName);
    totalBytes += Math.max(0, candidate.sizeBytes);
    selected.push({
      entryPath: candidate.entryPath,
      fileName: candidate.fileName,
      packageLabel: candidate.packageLabel
    });
  };
  if (forced && forced.size > 0) {
    for (const fileName of forced) {
      const candidate = candidateByFileName.get(fileName);
      if (!candidate || seen.has(candidate.fileName)) continue;
      pushCandidate(candidate);
    }
  }
  for (const entry of options.currentReadyEntries ?? []) {
    if (options.preserveReadyFileNames && !options.preserveReadyFileNames.has(entry.fileName)) continue;
    const candidate = candidateByFileName.get(entry.fileName);
    if (!candidate || seen.has(candidate.fileName)) continue;
    pushCandidate(candidate);
  }
  for (const candidate of options.candidates) {
    if (selected.length >= options.maxMembers) break;
    if (seen.has(candidate.fileName)) continue;
    const nextTotal = totalBytes + Math.max(0, candidate.sizeBytes);
    if (nextTotal > options.maxBytes) continue;
    pushCandidate(candidate);
  }
  return selected;
}
function expandSelectionByCoupling(selected, ctx) {
  if (ctx.couplingClusters.length === 0) return;
  const inSelection = new Set(selected.map((e) => e.fileName));
  let changed = true;
  while (changed) {
    changed = false;
    for (const fileName of Array.from(inSelection)) {
      const idx = ctx.fileToClusterIdx.get(fileName);
      if (idx === void 0 || ctx.claimedClusters.has(idx)) continue;
      ctx.claimedClusters.add(idx);
      for (const peerFile of ctx.couplingClusters[idx]) {
        if (inSelection.has(peerFile) || ctx.assigned.has(peerFile)) continue;
        const candidate = ctx.candidatesByFileName.get(peerFile);
        if (!candidate) continue;
        selected.push({
          entryPath: candidate.entryPath,
          fileName: candidate.fileName,
          packageLabel: candidate.packageLabel
        });
        inSelection.add(peerFile);
        changed = true;
      }
    }
  }
}
function planAutoFeaturePackGroups(options) {
  const candidatesByFileName = /* @__PURE__ */ new Map();
  for (const candidate of options.candidates) {
    if (!candidate?.fileName || candidatesByFileName.has(candidate.fileName)) continue;
    candidatesByFileName.set(candidate.fileName, candidate);
  }
  const candidates = Array.from(candidatesByFileName.values()).sort((a, b) => {
    const scoreDelta = b.score - a.score;
    if (scoreDelta !== 0) return scoreDelta;
    const labelDelta = a.packageLabel.localeCompare(b.packageLabel);
    if (labelDelta !== 0) return labelDelta;
    return a.fileName.localeCompare(b.fileName);
  });
  if (candidates.length === 0) return [];
  const minMembers = Math.max(1, Math.floor(options.minMembers));
  const maxGroups = Math.max(1, Math.floor(options.maxGroups ?? 4));
  const readyGroups = (options.currentReadyGroups ?? []).filter((group) => group?.group && Array.isArray(group.entries) && group.entries.length > 0).slice().sort((a, b) => a.group.localeCompare(b.group));
  const couplingClusters = [];
  const fileToClusterIdx = /* @__PURE__ */ new Map();
  for (const rawCluster of options.coupledGroups ?? []) {
    if (!rawCluster) continue;
    const filtered = /* @__PURE__ */ new Set();
    for (const fileName of rawCluster) {
      if (typeof fileName !== "string") continue;
      if (!candidatesByFileName.has(fileName)) continue;
      filtered.add(fileName);
    }
    if (filtered.size < 2) continue;
    const idx = couplingClusters.length;
    couplingClusters.push(filtered);
    for (const fileName of filtered) {
      if (!fileToClusterIdx.has(fileName)) fileToClusterIdx.set(fileName, idx);
    }
  }
  const claimedClusters = /* @__PURE__ */ new Set();
  const familyToReadyGroup = /* @__PURE__ */ new Map();
  const fileToReadyGroup = /* @__PURE__ */ new Map();
  for (const ready of readyGroups) {
    for (const entry of ready.entries) {
      if (!entry?.fileName) continue;
      fileToReadyGroup.set(entry.fileName, ready.group);
      const candidate = candidatesByFileName.get(entry.fileName);
      const familyKey = deriveFamilyKey(candidate?.packageName, candidate?.packageLabel ?? entry.packageLabel);
      if (familyKey && !familyToReadyGroup.has(familyKey)) {
        familyToReadyGroup.set(familyKey, ready.group);
      }
    }
  }
  const assigned = /* @__PURE__ */ new Set();
  const plans = [];
  for (const ready of readyGroups) {
    const anchors = collectAnchorSignals(candidatesByFileName, ready.entries);
    const anchorRouteKeys = dominantRouteKeys(candidatesByFileName, ready.entries);
    const forcedFiles = /* @__PURE__ */ new Set();
    for (const entry of ready.entries) {
      const idx = fileToClusterIdx.get(entry.fileName);
      if (idx === void 0 || claimedClusters.has(idx)) continue;
      claimedClusters.add(idx);
      for (const f of couplingClusters[idx]) {
        if (!assigned.has(f) && candidatesByFileName.has(f)) forcedFiles.add(f);
      }
    }
    const preserveReadyFileNames = /* @__PURE__ */ new Set();
    const strongestReadyFileName = ready.entries.map((entry) => candidatesByFileName.get(entry.fileName)).filter((candidate) => !!candidate).sort((a, b) => b.score - a.score || a.fileName.localeCompare(b.fileName))[0]?.fileName ?? null;
    for (const entry of ready.entries) {
      const candidate = candidatesByFileName.get(entry.fileName);
      if (!candidate) continue;
      const sharedRoutes = routeAffinityScore(candidate, anchorRouteKeys) > 0;
      const hasPeerAffinity = ready.entries.some((peer) => {
        if (peer.fileName === candidate.fileName) return false;
        const peerCandidate = candidatesByFileName.get(peer.fileName);
        if (!peerCandidate) return false;
        const candidateFamily = deriveFamilyKey(candidate.packageName, candidate.packageLabel);
        const peerFamily = deriveFamilyKey(peerCandidate.packageName, peerCandidate.packageLabel);
        return !!candidateFamily && candidateFamily === peerFamily || countIntersection(candidate.entryRootKeys, peerCandidate.entryRootKeys) > 0 || countIntersection(candidate.importerKeys, peerCandidate.importerKeys) > 0;
      });
      if (forcedFiles.has(candidate.fileName) || candidate.fileName === strongestReadyFileName || hasPeerAffinity || anchorRouteKeys.length === 0 && ready.entries.length <= 1 || sharedRoutes) {
        preserveReadyFileNames.add(candidate.fileName);
      }
    }
    const ordered = boostedCandidateOrder(
      candidates.filter((candidate) => {
        if (assigned.has(candidate.fileName)) return false;
        if (forcedFiles.has(candidate.fileName)) return true;
        const reservedGroup = fileToReadyGroup.get(candidate.fileName);
        if (reservedGroup && reservedGroup !== ready.group) return false;
        const familyKey2 = deriveFamilyKey(candidate.packageName, candidate.packageLabel);
        const reservedFamilyGroup = familyKey2 ? familyToReadyGroup.get(familyKey2) : null;
        if (reservedFamilyGroup && reservedFamilyGroup !== ready.group) return false;
        const candidateClusterIdx = fileToClusterIdx.get(candidate.fileName);
        if (candidateClusterIdx !== void 0 && claimedClusters.has(candidateClusterIdx) && !forcedFiles.has(candidate.fileName)) {
          return false;
        }
        const sameReadyMember = ready.entries.some((entry) => entry.fileName === candidate.fileName);
        if (sameReadyMember && !forcedFiles.has(candidate.fileName) && !preserveReadyFileNames.has(candidate.fileName)) {
          return false;
        }
        const sameFamily = !!familyKey2 && anchors.families.includes(familyKey2);
        const sharedRoots = countIntersection(candidate.entryRootKeys, anchors.entryRootKeys) > 0;
        const sharedImporters = countIntersection(candidate.importerKeys, anchors.importerKeys) > 0;
        const sharedRoutes = routeAffinityScore(candidate, anchorRouteKeys) > 0;
        if (sameReadyMember && !forcedFiles.has(candidate.fileName) && anchorRouteKeys.length > 0 && !sharedRoutes && !sameFamily && !sharedRoots && !sharedImporters) {
          return false;
        }
        if (!sameReadyMember && !sameFamily && !sharedRoots && !sharedImporters && !sharedRoutes) return false;
        return true;
      }),
      (candidate) => {
        let boost = 0;
        if (forcedFiles.has(candidate.fileName)) boost += 5e3;
        if (ready.entries.some((entry) => entry.fileName === candidate.fileName)) boost += 2e3;
        const familyKey2 = deriveFamilyKey(candidate.packageName, candidate.packageLabel);
        if (familyKey2 && anchors.families.includes(familyKey2)) boost += 800;
        boost += Math.min(3, routeAffinityScore(candidate, anchorRouteKeys)) * 260;
        boost += Math.min(3, countIntersection(candidate.entryRootKeys, anchors.entryRootKeys)) * 140;
        boost += Math.min(4, countIntersection(candidate.importerKeys, anchors.importerKeys)) * 50;
        boost -= routeBreadthPenalty(candidate);
        return boost;
      }
    );
    const selected = selectStableFeaturePackEntries({
      currentReadyEntries: ready.entries,
      candidates: ordered,
      maxMembers: options.maxMembers,
      maxBytes: options.maxBytes,
      forcedFileNames: forcedFiles,
      preserveReadyFileNames
    });
    expandSelectionByCoupling(selected, {
      candidatesByFileName,
      couplingClusters,
      fileToClusterIdx,
      claimedClusters,
      assigned
    });
    if (selected.length < minMembers) continue;
    for (const entry of selected) assigned.add(entry.fileName);
    const familyKey = anchors.families[0] || deriveFamilyKey(candidatesByFileName.get(selected[0]?.fileName ?? "")?.packageName, selected[0]?.packageLabel);
    plans.push({
      group: ready.group,
      seedFileName: selected[0]?.fileName ?? "",
      familyKey,
      entries: selected
    });
  }
  for (const seed of candidates) {
    if (plans.length >= maxGroups) break;
    if (assigned.has(seed.fileName)) continue;
    const reservedGroup = fileToReadyGroup.get(seed.fileName);
    if (reservedGroup) continue;
    const seedFamily = deriveFamilyKey(seed.packageName, seed.packageLabel);
    const reservedFamilyGroup = seedFamily ? familyToReadyGroup.get(seedFamily) : null;
    if (reservedFamilyGroup) continue;
    const seedClusterIdx = fileToClusterIdx.get(seed.fileName);
    const forcedFiles = /* @__PURE__ */ new Set();
    if (seedClusterIdx !== void 0 && !claimedClusters.has(seedClusterIdx)) {
      claimedClusters.add(seedClusterIdx);
      for (const f of couplingClusters[seedClusterIdx]) {
        if (!assigned.has(f) && candidatesByFileName.has(f)) forcedFiles.add(f);
      }
    } else if (seedClusterIdx !== void 0 && claimedClusters.has(seedClusterIdx)) {
      continue;
    }
    const ordered = boostedCandidateOrder(
      candidates.filter((candidate) => {
        if (assigned.has(candidate.fileName)) return false;
        if (forcedFiles.has(candidate.fileName)) return true;
        if (fileToReadyGroup.has(candidate.fileName)) return false;
        const candidateFamily = deriveFamilyKey(candidate.packageName, candidate.packageLabel);
        if (candidateFamily && familyToReadyGroup.has(candidateFamily)) return false;
        const candidateClusterIdx = fileToClusterIdx.get(candidate.fileName);
        if (candidateClusterIdx !== void 0 && claimedClusters.has(candidateClusterIdx) && candidateClusterIdx !== seedClusterIdx) {
          return false;
        }
        const sharedRoots = countIntersection(candidate.entryRootKeys, seed.entryRootKeys) > 0;
        const sharedImporters = countIntersection(candidate.importerKeys, seed.importerKeys) > 0;
        const sharedRoutes = routeAffinityScore(candidate, seed.routeKeys) > 0;
        const sameFamily = !!seedFamily && candidateFamily === seedFamily;
        if (candidate.fileName !== seed.fileName && !sameFamily && !sharedRoots && !sharedImporters && !sharedRoutes) {
          return false;
        }
        return true;
      }),
      (candidate) => {
        let boost = 0;
        const candidateFamily = deriveFamilyKey(candidate.packageName, candidate.packageLabel);
        if (forcedFiles.has(candidate.fileName)) boost += 5e3;
        if (candidate.fileName === seed.fileName) boost += 2e3;
        if (seedFamily && candidateFamily === seedFamily) boost += 900;
        boost += Math.min(3, routeAffinityScore(candidate, seed.routeKeys)) * 260;
        boost += Math.min(3, countIntersection(candidate.entryRootKeys, seed.entryRootKeys)) * 180;
        boost += Math.min(4, countIntersection(candidate.importerKeys, seed.importerKeys)) * 60;
        boost -= routeBreadthPenalty(candidate);
        return boost;
      }
    );
    const selected = selectStableFeaturePackEntries({
      candidates: ordered,
      maxMembers: options.maxMembers,
      maxBytes: options.maxBytes,
      forcedFileNames: forcedFiles
    });
    expandSelectionByCoupling(selected, {
      candidatesByFileName,
      couplingClusters,
      fileToClusterIdx,
      claimedClusters,
      assigned
    });
    if (selected.length < minMembers) continue;
    for (const entry of selected) assigned.add(entry.fileName);
    plans.push({
      group: null,
      seedFileName: selected[0]?.fileName ?? seed.fileName,
      familyKey: seedFamily,
      entries: selected
    });
  }
  return plans;
}
function analyzeFeaturePackSharedClosurePressure(options) {
  const entries = Array.isArray(options.entries) ? options.entries : [];
  const deliveredMembers = entries.map((entry) => ({
    entry,
    candidate: options.candidatesByFileName.get(entry.fileName) ?? null
  })).filter(
    (item) => !!item.entry?.fileName
  );
  const logicalDeliveredBytes = deliveredMembers.reduce(
    (sum, item) => sum + Math.max(0, item.candidate?.sizeBytes ?? 0),
    0
  );
  if (deliveredMembers.length === 0 || logicalDeliveredBytes <= 0) {
    return {
      routeCount: 0,
      logicalDeliveredBytes,
      peakLogicalUnusedBytes: 0,
      peakLogicalUnusedRouteKey: null,
      peakLogicalUnusedRatio: 0,
      estimatedPeakSharedPressureBytes: null,
      routes: []
    };
  }
  const routeScores = /* @__PURE__ */ new Map();
  for (const item of deliveredMembers) {
    const routeRequestCounts = item.candidate?.routeRequestCounts ?? null;
    if (!routeRequestCounts) continue;
    for (const [routeKey, requestCount] of Object.entries(routeRequestCounts)) {
      if (!routeKey || !Number.isFinite(requestCount) || requestCount <= 0) continue;
      routeScores.set(routeKey, (routeScores.get(routeKey) ?? 0) + requestCount);
    }
  }
  const maxUnusedMembersPerRoute = Math.max(1, Math.floor(options.maxUnusedMembersPerRoute ?? 5));
  const activeSharedBytes = typeof options.activeSharedBytes === "number" && Number.isFinite(options.activeSharedBytes) && options.activeSharedBytes > 0 ? Math.floor(options.activeSharedBytes) : null;
  const routes = Array.from(routeScores.entries()).map(([routeKey, routeRequestCount]) => {
    const usedMembers = deliveredMembers.filter((item) => {
      const count = item.candidate?.routeRequestCounts?.[routeKey] ?? 0;
      return Number.isFinite(count) && count > 0;
    });
    const logicalUsedBytes = usedMembers.reduce(
      (sum, item) => sum + Math.max(0, item.candidate?.sizeBytes ?? 0),
      0
    );
    const logicalUnusedBytes = Math.max(0, logicalDeliveredBytes - logicalUsedBytes);
    const logicalUnusedRatio = logicalDeliveredBytes > 0 ? logicalUnusedBytes / logicalDeliveredBytes : 0;
    const unusedMembers = deliveredMembers.filter((item) => !usedMembers.includes(item)).map((item) => ({
      fileName: item.entry.fileName,
      packageLabel: item.entry.packageLabel,
      sizeBytes: Math.max(0, item.candidate?.sizeBytes ?? 0)
    })).sort((a, b) => b.sizeBytes - a.sizeBytes || a.fileName.localeCompare(b.fileName));
    const estimatedSharedPressureBytes = activeSharedBytes && logicalDeliveredBytes > 0 ? Math.round(activeSharedBytes * logicalUnusedRatio) : null;
    return {
      routeKey,
      routeRequestCount,
      logicalDeliveredBytes,
      logicalUsedBytes,
      logicalUnusedBytes,
      logicalUnusedRatio,
      deliveredMemberCount: deliveredMembers.length,
      usedMemberCount: usedMembers.length,
      unusedMemberCount: Math.max(0, deliveredMembers.length - usedMembers.length),
      estimatedSharedPressureBytes,
      topUnusedMembers: unusedMembers.slice(0, maxUnusedMembersPerRoute)
    };
  }).sort((a, b) => {
    const unusedDelta = b.logicalUnusedBytes - a.logicalUnusedBytes;
    if (unusedDelta !== 0) return unusedDelta;
    const requestDelta = b.routeRequestCount - a.routeRequestCount;
    if (requestDelta !== 0) return requestDelta;
    return a.routeKey.localeCompare(b.routeKey);
  });
  const limitedRoutes = routes.slice(0, Math.max(1, Math.floor(options.maxRoutes ?? 8)));
  const peak = limitedRoutes[0] ?? null;
  return {
    routeCount: routes.length,
    logicalDeliveredBytes,
    peakLogicalUnusedBytes: peak?.logicalUnusedBytes ?? 0,
    peakLogicalUnusedRouteKey: peak?.routeKey ?? null,
    peakLogicalUnusedRatio: peak?.logicalUnusedRatio ?? 0,
    estimatedPeakSharedPressureBytes: peak?.estimatedSharedPressureBytes ?? null,
    routes: limitedRoutes
  };
}

// src/core/deps/usage.ts
import fs16 from "fs";
import path18 from "path";
import { parseSync } from "@swc/core";

// src/core/deps/registry.ts
import fs15 from "fs";
import path17 from "path";
var registry = /* @__PURE__ */ new Map();
function computeStableDepFileName(options) {
  const pkgVersion = options.packageVersion || "0.0.0";
  const authority = native?.stableDepArtifactFileName;
  if (typeof authority !== "function") {
    throw new Error(
      "[Ionify] DPL dependency identity authority is unavailable; rebuild the native Ionify binding"
    );
  }
  const fileName = authority(
    options.entryPath,
    options.packageName,
    pkgVersion,
    options.subpath ?? void 0
  );
  if (typeof fileName !== "string" || fileName.length === 0) {
    throw new Error("[Ionify] DPL dependency identity authority returned an invalid artifact name");
  }
  return fileName;
}
function registerDepEntry(entry) {
  const fileName = computeStableDepFileName({
    entryPath: entry.entryPath,
    packageName: entry.packageName,
    packageVersion: entry.packageVersion,
    subpath: entry.subpath
  });
  const existing = registry.get(fileName);
  if (existing) {
    return existing;
  }
  const record = { ...entry, fileName };
  registry.set(fileName, record);
  return record;
}
function getDepEntry(fileName) {
  return registry.get(fileName);
}
function cacheDepRegistration(entry, workspaceRoot) {
  const entryModuleId = toWsModuleId(entry.entryPath, workspaceRoot);
  return {
    fileName: entry.fileName,
    entryModuleId,
    // Linked packages may live outside the workspace. Their local path is safe
    // only for this workspace instance; a cross-machine restore fails closed.
    localEntryPath: entryModuleId ? null : entry.entryPath,
    packageName: entry.packageName,
    packageVersion: entry.packageVersion,
    subpath: entry.subpath ?? null
  };
}
function restoreCachedDepRegistrations(facts, workspaceRoot) {
  if (!Array.isArray(facts)) return false;
  const resolved = [];
  for (const fact of facts) {
    if (!fact || typeof fact.fileName !== "string" || typeof fact.packageName !== "string" || typeof fact.packageVersion !== "string" || fact.subpath !== null && typeof fact.subpath !== "string") {
      return false;
    }
    const entryPath = fact.entryModuleId ? fromWsModuleId(fact.entryModuleId, workspaceRoot) : fact.localEntryPath;
    if (!entryPath || !path17.isAbsolute(entryPath) || !fs15.existsSync(entryPath)) {
      return false;
    }
    const expectedFileName = computeStableDepFileName({
      entryPath,
      packageName: fact.packageName,
      packageVersion: fact.packageVersion,
      subpath: fact.subpath
    });
    if (expectedFileName !== fact.fileName) return false;
    resolved.push({
      entryPath,
      fileName: fact.fileName,
      packageName: fact.packageName,
      packageVersion: fact.packageVersion,
      subpath: fact.subpath
    });
  }
  for (const fact of resolved) {
    const restored = registerDepEntry({
      entryPath: fact.entryPath,
      packageName: fact.packageName,
      packageVersion: fact.packageVersion,
      subpath: fact.subpath
    });
    if (restored.fileName !== fact.fileName) return false;
  }
  return true;
}
function isCoreSingletonDepFileName(fileName) {
  const normalized = String(fileName || "").trim().toLowerCase();
  return normalized.startsWith("react@") || normalized.startsWith("react-dom@") || normalized.startsWith("scheduler@") || normalized.startsWith("react-refresh@");
}
function computeSubpathFromEntryPath(entryPath) {
  const packageRoot = findPackageRoot(entryPath);
  if (!packageRoot) {
    if (process.env.DEBUG_DEPS) {
      console.log(`[computeSubpathFromEntryPath] No package root for: ${entryPath}`);
    }
    return "";
  }
  let rel = path17.relative(packageRoot, entryPath).replace(/\\/g, "/");
  const extIndex = rel.lastIndexOf(".");
  if (extIndex !== -1) {
    rel = rel.substring(0, extIndex);
  }
  if (rel.endsWith("/index")) {
    rel = rel.substring(0, rel.length - "/index".length);
  }
  const pkgName = path17.basename(packageRoot);
  if (process.env.DEBUG_DEPS) {
    console.log(`[subpath] entry: ${path17.basename(entryPath)}, root: ${pkgName}, rel: "${rel}", isMain: ${rel === pkgName}`);
  }
  if (rel === pkgName || rel === "index" || rel === "" || rel === ".") {
    return "";
  }
  return rel || "";
}
function findPackageRoot(entryPath) {
  let currentDir = path17.dirname(entryPath);
  let previousDir = entryPath;
  while (currentDir && currentDir !== previousDir) {
    const parent = path17.dirname(currentDir);
    const grandparent = path17.dirname(parent);
    if (path17.basename(parent) === "node_modules") {
      const pkgJsonPath = path17.join(currentDir, "package.json");
      if (fs15.existsSync(pkgJsonPath)) {
        return currentDir;
      }
    }
    if (path17.basename(grandparent) === "node_modules" && path17.basename(parent).startsWith("@")) {
      const pkgJsonPath = path17.join(currentDir, "package.json");
      if (fs15.existsSync(pkgJsonPath)) {
        return currentDir;
      }
    }
    previousDir = currentDir;
    currentDir = parent;
  }
  let dir = path17.dirname(entryPath);
  let prev = "";
  while (dir && dir !== prev) {
    if (fs15.existsSync(path17.join(dir, "package.json"))) {
      return dir;
    }
    prev = dir;
    dir = path17.dirname(dir);
  }
  return null;
}

// src/core/deps/usage.ts
var SCAN_EXTS = /* @__PURE__ */ new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts"
]);
function isBareSpecifier(spec) {
  if (!spec) return false;
  return !spec.startsWith(".") && !spec.startsWith("/") && !spec.startsWith("http://") && !spec.startsWith("https://");
}
function compareCodeUnitStrings(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
function getStringLiteralValue(node) {
  if (!node || typeof node !== "object") return null;
  const type = node.type;
  if (type === "StringLiteral" || type === "Str") {
    const value = node.value;
    return typeof value === "string" ? value : null;
  }
  if (type === "Literal") {
    const value = node.value;
    return typeof value === "string" ? value : null;
  }
  return null;
}
function collectDynamicImports(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectDynamicImports(item, out);
    return;
  }
  if (node.type === "CallExpression" || node.type === "CallExpr") {
    const callee = node.callee;
    if (callee && typeof callee === "object" && callee.type === "Import") {
      const args = node.arguments ?? node.args ?? [];
      const first = Array.isArray(args) ? args[0] : null;
      const expr = first?.expression ?? first?.expr ?? first;
      const value = getStringLiteralValue(expr);
      if (value) out.push(value);
    }
  }
  for (const value of Object.values(node)) {
    collectDynamicImports(value, out);
  }
}
function identifierName(node) {
  if (!node || typeof node !== "object") return null;
  const value = node.value ?? node.sym ?? node.name;
  return typeof value === "string" && value.length > 0 ? value : null;
}
function collectBindingNames(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectBindingNames(item, out);
    return;
  }
  const type = typeof node.type === "string" ? node.type : "";
  if (type === "Identifier" || type === "BindingIdentifier") {
    const name = identifierName(node);
    if (name) out.add(name);
    return;
  }
  for (const key of ["id", "left", "argument", "arguments", "properties", "elements", "params", "pattern", "pat"]) {
    const value = node[key];
    if (value) collectBindingNames(value, out);
  }
}
function collectScopeDeclaredNames(body, out) {
  for (const item of body) {
    if (!item || typeof item.type !== "string") continue;
    if (item.type === "VariableDeclaration") {
      const declarations = Array.isArray(item.declarations) ? item.declarations : [];
      for (const declaration of declarations) collectBindingNames(declaration?.id, out);
    } else if (item.type === "FunctionDeclaration" || item.type === "ClassDeclaration") {
      collectBindingNames(item.identifier ?? item.id, out);
    }
  }
}
function collectImportedBindingValueReferences(node, importedLocals, out, shadowed = /* @__PURE__ */ new Set()) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectImportedBindingValueReferences(item, importedLocals, out, shadowed);
    return;
  }
  const type = typeof node.type === "string" ? node.type : "";
  if (type === "ImportDeclaration") return;
  if (type === "TsAsExpression" || type === "TSAsExpression" || type === "TsTypeAssertion" || type === "TSTypeAssertion") {
    collectImportedBindingValueReferences(node.expression ?? node.expr, importedLocals, out, shadowed);
    return;
  }
  if (type === "TsNonNullExpression" || type === "TSNonNullExpression" || type === "TsInstantiation" || type === "TSInstantiation") {
    collectImportedBindingValueReferences(node.expression ?? node.expr, importedLocals, out, shadowed);
    return;
  }
  if (type.startsWith("Ts") || type.startsWith("TS")) return;
  if (type === "ClassImplements" || type === "TypeScriptClassImplements" || type === "TSTypeParameterDeclaration" || type === "TSTypeParameterInstantiation" || type === "TypeParameterDeclaration" || type === "TypeParameterInstantiation") {
    return;
  }
  if (type === "Program" || type === "Module" || type === "BlockStatement") {
    const body = Array.isArray(node.body) ? node.body : Array.isArray(node.stmts) ? node.stmts : [];
    const nextShadowed = new Set(shadowed);
    collectScopeDeclaredNames(body, nextShadowed);
    for (const item of body) collectImportedBindingValueReferences(item, importedLocals, out, nextShadowed);
    return;
  }
  if (type === "FunctionDeclaration" || type === "FunctionExpression" || type === "ArrowFunctionExpression") {
    const nextShadowed = new Set(shadowed);
    collectBindingNames(node.params, nextShadowed);
    collectImportedBindingValueReferences(node.body, importedLocals, out, nextShadowed);
    return;
  }
  if (type === "ExportNamedDeclaration") {
    if (node.typeOnly === true || node.source) return;
    const specs = Array.isArray(node.specifiers) ? node.specifiers : [];
    for (const spec of specs) {
      if (!spec || spec.isTypeOnly === true) continue;
      if (spec.type === "ExportSpecifier") {
        const name = identifierName(spec.orig ?? spec.local);
        if (name && importedLocals.has(name) && !shadowed.has(name)) out.add(name);
      }
    }
    return;
  }
  if (type === "Identifier" || type === "JSXIdentifier") {
    const name = identifierName(node);
    if (name && importedLocals.has(name) && !shadowed.has(name)) out.add(name);
    return;
  }
  for (const value of Object.values(node)) {
    collectImportedBindingValueReferences(value, importedLocals, out, shadowed);
  }
}
function parseModuleForUsage(absPath, code) {
  const ext = path18.extname(absPath).toLowerCase();
  const isTypeScript = ext === ".ts" || ext === ".tsx" || ext === ".mts" || ext === ".cts";
  const isTsx = ext === ".tsx";
  const isJsx = ext === ".jsx";
  let ast;
  try {
    ast = parseSync(code, {
      syntax: isTypeScript ? "typescript" : "ecmascript",
      tsx: isTypeScript ? isTsx : false,
      jsx: !isTypeScript ? isJsx : false,
      decorators: true,
      dynamicImport: true,
      importAssertions: true
    });
  } catch {
    return null;
  }
  const out = [];
  const body = Array.isArray(ast?.body) ? ast.body : [];
  const importedLocals = /* @__PURE__ */ new Set();
  for (const item of body) {
    if (!item || item.type !== "ImportDeclaration" || item.typeOnly === true) continue;
    const specs = Array.isArray(item.specifiers) ? item.specifiers : [];
    for (const spec of specs) {
      if (!spec || spec.isTypeOnly === true || spec.type === "ImportNamespaceSpecifier") continue;
      const localName = identifierName(spec.local);
      if (localName) importedLocals.add(localName);
    }
  }
  const valueReferences = /* @__PURE__ */ new Set();
  collectImportedBindingValueReferences(ast, importedLocals, valueReferences);
  for (const item of body) {
    if (!item || typeof item.type !== "string") continue;
    if (item.type === "ImportDeclaration") {
      const source = item.source?.value;
      if (typeof source !== "string") continue;
      if (item.typeOnly === true) continue;
      const imported = [];
      const specs = Array.isArray(item.specifiers) ? item.specifiers : [];
      for (const spec of specs) {
        if (!spec || typeof spec.type !== "string") continue;
        if (spec.isTypeOnly === true) continue;
        if (spec.type === "ImportDefaultSpecifier") {
          imported.push({ kind: "default" });
        } else if (spec.type === "ImportNamespaceSpecifier") {
          imported.push({ kind: "namespace" });
        } else if (spec.type === "ImportSpecifier") {
          const importedName = identifierName(spec.imported ?? spec.local);
          const localName = identifierName(spec.local);
          if (typeof importedName === "string" && importedName.length > 0 && (!localName || valueReferences.has(localName))) {
            imported.push({
              kind: importedName === "default" ? "default" : "named",
              name: importedName
            });
          }
        }
      }
      if (specs.length > 0 && imported.length === 0) continue;
      out.push({ source, imported, isDynamic: false });
      continue;
    }
    if (item.type === "ExportNamedDeclaration") {
      const source = item.source?.value;
      if (typeof source !== "string") continue;
      if (item.typeOnly === true) continue;
      const imported = [];
      const specs = Array.isArray(item.specifiers) ? item.specifiers : [];
      for (const spec of specs) {
        if (!spec || typeof spec.type !== "string") continue;
        if (spec.isTypeOnly === true) continue;
        if (spec.type === "ExportSpecifier") {
          const named = spec?.orig ?? spec?.local ?? spec?.exported;
          const exported = spec?.exported ?? named;
          const name = exported?.value ?? named?.value;
          if (typeof name === "string" && name.length > 0) {
            imported.push({
              kind: name === "default" ? "default" : "named",
              name
            });
          }
        } else if (spec.type === "ExportNamespaceSpecifier") {
          imported.push({ kind: "namespace" });
        }
      }
      out.push({ source, imported, isDynamic: false });
      continue;
    }
    if (item.type === "ExportAllDeclaration") {
      const source = item.source?.value;
      if (typeof source !== "string") continue;
      out.push({ source, imported: [{ kind: "export-star" }], isDynamic: false });
      continue;
    }
  }
  const dynamic = [];
  collectDynamicImports(ast, dynamic);
  for (const source of dynamic) {
    if (typeof source === "string" && source.length > 0) {
      out.push({ source, imported: [], isDynamic: true });
    }
  }
  return out;
}
function collectRuntimeMutationFactsForFiles(files, parserMode) {
  if (files.length === 0) return { demands: [], mutations: [] };
  if (!native?.nativeRuntimeMutationBatch) return null;
  const inputReadStart = performance.now();
  const jobs = [];
  for (const filePath of Array.from(new Set(files.map((file) => safeRealpath(file)))).sort()) {
    try {
      jobs.push({
        id: filePath,
        filePath,
        ext: path18.extname(filePath).toLowerCase(),
        code: fs16.readFileSync(filePath, "utf8")
      });
    } catch {
      return null;
    }
  }
  const inputReadMs = performance.now() - inputReadStart;
  const nativeMutationStart = performance.now();
  const transformed = native.nativeRuntimeMutationBatch(jobs, parserMode);
  const nativeMutationMs = performance.now() - nativeMutationStart;
  if (transformed.length !== jobs.length || transformed.some((result) => result.error)) {
    return null;
  }
  const aggregationStart = performance.now();
  const aggregated = /* @__PURE__ */ new Map();
  for (const result of transformed) {
    const importerPath = result.filePath ?? result.file_path ?? result.id;
    const sourceHash = result.sourceHash ?? result.source_hash;
    const staticSpecifiers = result.staticSpecifiers ?? result.static_specifiers;
    const dynamicSpecifiers = result.dynamicSpecifiers ?? result.dynamic_specifiers;
    const runtimeDemands = result.runtimeDemands ?? result.runtime_demands;
    if (!sourceHash || !Array.isArray(staticSpecifiers) || !Array.isArray(dynamicSpecifiers) || !Array.isArray(runtimeDemands)) {
      return null;
    }
    for (const record of runtimeDemands) {
      if (!isBareSpecifier(record.specifier)) continue;
      const key = `${importerPath}\0${record.specifier}`;
      let fact = aggregated.get(key);
      if (!fact) {
        fact = {
          importerPath,
          specifier: record.specifier,
          usedExports: [],
          hasNamespace: false,
          hasExportStar: false,
          isDynamic: false
        };
        aggregated.set(key, fact);
      }
      const exports = new Set(fact.usedExports);
      for (const imported of record.usedExports ?? []) exports.add(imported);
      fact.usedExports = Array.from(exports).sort();
      fact.hasNamespace = fact.hasNamespace || record.hasNamespace;
      fact.hasExportStar = fact.hasExportStar || record.hasExportStar;
      fact.isDynamic = fact.isDynamic || record.isDynamic;
    }
  }
  const demands = Array.from(aggregated.values()).sort((left, right) => {
    const importerOrder = compareCodeUnitStrings(left.importerPath, right.importerPath);
    return importerOrder !== 0 ? importerOrder : compareCodeUnitStrings(left.specifier, right.specifier);
  });
  const aggregationMs = performance.now() - aggregationStart;
  return {
    demands,
    mutations: transformed,
    profile: { inputReadMs, nativeMutationMs, aggregationMs }
  };
}
function resolveDepEntryForBareImport(spec, importerAbs) {
  const resolved = native?.resolveModule ? native.resolveModule(spec, importerAbs) : null;
  const kind = resolved?.kind;
  if (!resolved || kind === "Builtin" || kind === "Virtual" || kind === "NotFound") return null;
  const fsPath = resolved?.fsPath ?? resolved?.fs_path ?? null;
  if (typeof fsPath !== "string" || fsPath.length === 0) return null;
  const pkg = resolved?.pkg ?? null;
  const packageName = pkg && typeof pkg.name === "string" && pkg.name.length > 0 ? pkg.name : spec;
  const packageVersion = pkg && typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : "0.0.0";
  const subpath = computeSubpathFromEntryPath(fsPath);
  const dep = registerDepEntry({
    entryPath: fsPath,
    packageName,
    packageVersion,
    subpath
  });
  const moduleFormat = kind === "PkgEsm" ? "esm" : kind === "PkgCjs" ? "cjs" : "unknown";
  return { fileName: dep.fileName, entryPath: fsPath, packageName, packageVersion, moduleFormat };
}
function safeRealpath(absPath) {
  const resolved = path18.resolve(absPath);
  try {
    const nativeFn = fs16.realpathSync.native;
    return nativeFn ? nativeFn(resolved) : fs16.realpathSync(resolved);
  } catch {
    return resolved;
  }
}
function dedupeSortedStrings2(values) {
  const sorted = Array.from(values).map((value) => typeof value === "string" ? value : "").filter(Boolean).sort();
  const unique = [];
  for (const name of sorted) {
    if (unique.length === 0 || unique[unique.length - 1] !== name) unique.push(name);
  }
  return unique;
}
function buildCanonicalDepFileNameIndex(entries) {
  const out = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    const fileName = typeof entry?.fileName === "string" ? entry.fileName : "";
    const entryPath = typeof entry?.entryPath === "string" ? entry.entryPath : "";
    if (!fileName || !entryPath) continue;
    const key = safeRealpath(entryPath);
    if (!out.has(key)) out.set(key, fileName);
  }
  return out;
}
function canonicalizeDepFileName(fileName, entryPath, canonicalFileNamesByEntryPath) {
  if (!fileName || !entryPath || !canonicalFileNamesByEntryPath || canonicalFileNamesByEntryPath.size === 0) {
    return fileName;
  }
  return canonicalFileNamesByEntryPath.get(safeRealpath(entryPath)) ?? fileName;
}
function canonicalizeDepUsageIndex(index, canonicalFileNamesByEntryPath) {
  if (!canonicalFileNamesByEntryPath || canonicalFileNamesByEntryPath.size === 0) {
    return index;
  }
  const out = /* @__PURE__ */ new Map();
  for (const usage of index.values()) {
    const canonicalFileName = canonicalizeDepFileName(
      usage.fileName,
      usage.entryPath,
      canonicalFileNamesByEntryPath
    );
    const existing = out.get(canonicalFileName);
    if (!existing) {
      out.set(canonicalFileName, {
        ...usage,
        fileName: canonicalFileName,
        usedExports: dedupeSortedStrings2(usage.usedExports),
        importerKeys: dedupeSortedStrings2(usage.importerKeys),
        entryRootKeys: dedupeSortedStrings2(usage.entryRootKeys)
      });
      continue;
    }
    existing.usedExports = dedupeSortedStrings2([
      ...existing.usedExports,
      ...Array.isArray(usage.usedExports) ? usage.usedExports : []
    ]);
    existing.hasNamespace = existing.hasNamespace || usage.hasNamespace;
    existing.hasExportStar = existing.hasExportStar || usage.hasExportStar;
    existing.importerKeys = dedupeSortedStrings2([
      ...Array.isArray(existing.importerKeys) ? existing.importerKeys : [],
      ...Array.isArray(usage.importerKeys) ? usage.importerKeys : []
    ]);
    existing.entryRootKeys = dedupeSortedStrings2([
      ...Array.isArray(existing.entryRootKeys) ? existing.entryRootKeys : [],
      ...Array.isArray(usage.entryRootKeys) ? usage.entryRootKeys : []
    ]);
  }
  return out;
}
function normalizeAllowedRoots(roots) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const root of roots) {
    if (typeof root !== "string" || root.length === 0) continue;
    const normalized = safeRealpath(root).replace(/[\\\/]+$/, "");
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  out.sort();
  return out;
}
function isWithinAllowedRoots(absPath, allowedRoots) {
  for (const root of allowedRoots) {
    if (absPath === root) return true;
    if (absPath.startsWith(root + path18.sep)) return true;
  }
  return false;
}
function normalizeProjectKey(rootDir, absPath) {
  const normalizedRoot = safeRealpath(rootDir);
  const normalizedPath = safeRealpath(absPath);
  const rel = path18.relative(normalizedRoot, normalizedPath).replace(/\\/g, "/");
  if (!rel || rel === ".") return ".";
  return rel;
}
async function scanDepUsageFacts(options) {
  const { rootDir, entries } = options;
  const allowedRoots = normalizeAllowedRoots(
    Array.isArray(options.allowedRoots) && options.allowedRoots.length ? options.allowedRoots : [rootDir]
  );
  const usage = /* @__PURE__ */ new Map();
  const queue = [];
  const visitedFiles = /* @__PURE__ */ new Set();
  const runtimeDemands = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    const abs = path18.isAbsolute(entry) ? entry : path18.resolve(rootDir, entry);
    queue.push({
      absPath: abs,
      entryRootKey: normalizeProjectKey(rootDir, abs)
    });
  }
  while (queue.length) {
    const queued = queue.shift();
    const absPath = safeRealpath(queued.absPath);
    const entryRootKey = queued.entryRootKey;
    const visitKey = `${absPath}\0${entryRootKey}`;
    if (visitedFiles.has(visitKey)) continue;
    visitedFiles.add(visitKey);
    if (!isWithinAllowedRoots(absPath, allowedRoots)) continue;
    if (absPath.includes(`${path18.sep}node_modules${path18.sep}`)) continue;
    const ext = path18.extname(absPath).toLowerCase();
    if (!SCAN_EXTS.has(ext)) continue;
    if (absPath.endsWith(".d.ts")) continue;
    if (!fs16.existsSync(absPath)) continue;
    let code = "";
    try {
      code = fs16.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }
    const records = parseModuleForUsage(absPath, code);
    if (!records) continue;
    for (const record of records) {
      const source = record.source;
      if (typeof source !== "string" || source.length === 0) continue;
      const resolvedImport = resolveImport(source, absPath);
      const resolvedLocalImport = resolvedImport && isWithinAllowedRoots(safeRealpath(resolvedImport), allowedRoots) && !resolvedImport.includes(`${path18.sep}node_modules${path18.sep}`) ? resolvedImport : null;
      if (resolvedLocalImport) {
        queue.push({ absPath: resolvedLocalImport, entryRootKey });
        continue;
      }
      if (isBareSpecifier(source)) {
        const demandKey = `${absPath}\0${source}`;
        let demand = runtimeDemands.get(demandKey);
        if (!demand) {
          demand = {
            importerPath: absPath,
            specifier: source,
            usedExports: [],
            hasNamespace: false,
            hasExportStar: false,
            isDynamic: false
          };
          runtimeDemands.set(demandKey, demand);
        }
        const demandedExports = new Set(demand.usedExports);
        for (const imported of record.imported) {
          if (imported.kind === "namespace") demand.hasNamespace = true;
          if (imported.kind === "export-star") demand.hasExportStar = true;
          if (imported.kind === "default") demandedExports.add("default");
          if (imported.kind === "named" && imported.name) demandedExports.add(imported.name);
        }
        demand.usedExports = Array.from(demandedExports).sort(compareCodeUnitStrings);
        demand.isDynamic = demand.isDynamic || record.isDynamic;
        const resolved = resolveDepEntryForBareImport(source, absPath);
        if (!resolved) continue;
        const key = resolved.fileName;
        let item = usage.get(key);
        if (!item) {
          item = {
            fileName: resolved.fileName,
            entryPath: resolved.entryPath,
            packageName: resolved.packageName,
            packageVersion: resolved.packageVersion,
            moduleFormat: resolved.moduleFormat,
            used: /* @__PURE__ */ new Set(),
            hasNamespace: false,
            hasExportStar: false,
            importers: /* @__PURE__ */ new Set(),
            entryRoots: /* @__PURE__ */ new Set()
          };
          usage.set(key, item);
        }
        item.importers.add(normalizeProjectKey(rootDir, absPath));
        item.entryRoots.add(entryRootKey);
        for (const imp of record.imported) {
          if (imp.kind === "namespace") item.hasNamespace = true;
          if (imp.kind === "export-star") item.hasExportStar = true;
          if (imp.kind === "default") item.used.add("default");
          if (imp.kind === "named" && imp.name) item.used.add(imp.name);
        }
        continue;
      }
    }
  }
  const out = /* @__PURE__ */ new Map();
  for (const item of usage.values()) {
    out.set(item.fileName, {
      fileName: item.fileName,
      entryPath: item.entryPath,
      packageName: item.packageName,
      packageVersion: item.packageVersion,
      moduleFormat: item.moduleFormat,
      usedExports: dedupeSortedStrings2(item.used.values()),
      hasNamespace: item.hasNamespace,
      hasExportStar: item.hasExportStar,
      importerKeys: dedupeSortedStrings2(item.importers.values()),
      entryRootKeys: dedupeSortedStrings2(item.entryRoots.values())
    });
  }
  const orderedRuntimeDemands = Array.from(runtimeDemands.values()).sort((left, right) => {
    const importerOrder = compareCodeUnitStrings(left.importerPath, right.importerPath);
    return importerOrder !== 0 ? importerOrder : compareCodeUnitStrings(left.specifier, right.specifier);
  });
  return { usage: out, runtimeDemands: orderedRuntimeDemands };
}
function usageIndexFromRuntimeDemands(demands, rootDir, entryRoots) {
  const entryRootKeys = entryRoots.map((e) => normalizeProjectKey(rootDir, e));
  const usage = /* @__PURE__ */ new Map();
  for (const d of demands) {
    if (!isBareSpecifier(d.specifier)) continue;
    const resolved = resolveDepEntryForBareImport(d.specifier, d.importerPath);
    if (!resolved) continue;
    const key = resolved.fileName;
    let item = usage.get(key);
    if (!item) {
      item = {
        fileName: resolved.fileName,
        entryPath: resolved.entryPath,
        packageName: resolved.packageName,
        packageVersion: resolved.packageVersion,
        moduleFormat: resolved.moduleFormat,
        used: /* @__PURE__ */ new Set(),
        hasNamespace: false,
        hasExportStar: false,
        importers: /* @__PURE__ */ new Set(),
        entryRoots: /* @__PURE__ */ new Set()
      };
      usage.set(key, item);
    }
    item.importers.add(normalizeProjectKey(rootDir, d.importerPath));
    for (const r of entryRootKeys) item.entryRoots.add(r);
    if (d.hasNamespace) item.hasNamespace = true;
    if (d.hasExportStar) item.hasExportStar = true;
    for (const e of d.usedExports ?? []) item.used.add(e);
  }
  const out = /* @__PURE__ */ new Map();
  for (const item of usage.values()) {
    out.set(item.fileName, {
      fileName: item.fileName,
      entryPath: item.entryPath,
      packageName: item.packageName,
      packageVersion: item.packageVersion,
      moduleFormat: item.moduleFormat,
      usedExports: dedupeSortedStrings2(item.used.values()),
      hasNamespace: item.hasNamespace,
      hasExportStar: item.hasExportStar,
      importerKeys: dedupeSortedStrings2(item.importers.values()),
      entryRootKeys: dedupeSortedStrings2(item.entryRoots.values())
    });
  }
  return out;
}
async function scanDepUsage(options) {
  return (await scanDepUsageFacts(options)).usage;
}
async function scanDepEntryPaths(options) {
  const { rootDir, entries } = options;
  const allowedRoots = normalizeAllowedRoots(
    Array.isArray(options.allowedRoots) && options.allowedRoots.length ? options.allowedRoots : [rootDir]
  );
  const queue = [];
  const visitedFiles = /* @__PURE__ */ new Set();
  const entryPaths = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    queue.push(path18.isAbsolute(entry) ? entry : path18.resolve(rootDir, entry));
  }
  while (queue.length) {
    const absPath = safeRealpath(queue.shift());
    if (visitedFiles.has(absPath)) continue;
    visitedFiles.add(absPath);
    if (!isWithinAllowedRoots(absPath, allowedRoots)) continue;
    if (absPath.includes(`${path18.sep}node_modules${path18.sep}`)) continue;
    const ext = path18.extname(absPath).toLowerCase();
    if (!SCAN_EXTS.has(ext)) continue;
    if (absPath.endsWith(".d.ts")) continue;
    if (!fs16.existsSync(absPath)) continue;
    let code = "";
    try {
      code = fs16.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }
    const records = parseModuleForUsage(absPath, code);
    for (const record of records) {
      const source = record.source;
      if (typeof source !== "string" || source.length === 0) continue;
      const resolvedImport = resolveImport(source, absPath);
      const resolvedLocalImport = resolvedImport && isWithinAllowedRoots(safeRealpath(resolvedImport), allowedRoots) && !resolvedImport.includes(`${path18.sep}node_modules${path18.sep}`) ? resolvedImport : null;
      if (resolvedLocalImport) {
        queue.push(resolvedLocalImport);
        continue;
      }
      if (!isBareSpecifier(source)) continue;
      const resolved = resolveDepEntryForBareImport(source, absPath);
      if (!resolved || !resolved.entryPath.includes("node_modules")) continue;
      const canonicalEntryPath = safeRealpath(resolved.entryPath);
      if (!entryPaths.has(canonicalEntryPath)) {
        entryPaths.set(canonicalEntryPath, {
          entryPath: canonicalEntryPath,
          packageName: resolved.packageName
        });
      }
    }
  }
  return Array.from(entryPaths.values()).sort((a, b) => a.entryPath.localeCompare(b.entryPath));
}

// src/core/production-readiness-authority.ts
import fs18 from "fs";
import path20 from "path";

// src/core/production-artifact-publishing.ts
import fs17 from "fs";
import path19 from "path";
var PRODUCTION_PLAN_OUTPUT_VERSION = 8;
function resolveProductionPublicationDir(ionifyDir) {
  return path19.join(ionifyDir, "production-publication");
}
function resolveProductionPublicationStatePath(ionifyDir) {
  return path19.join(resolveProductionPublicationDir(ionifyDir), "state.v2.json");
}
function resolveProductionPublicationPlanPath(ionifyDir, planHash) {
  return path19.join(resolveProductionPublicationDir(ionifyDir), "plans", "v2", `${planHash}.json`);
}
function resolveProductionPublicationProgressPath(ionifyDir) {
  return path19.join(resolveProductionPublicationDir(ionifyDir), "transaction.v2.json");
}
function readProductionPublicationState(ionifyDir) {
  const statePath = resolveProductionPublicationStatePath(ionifyDir);
  try {
    const parsed = JSON.parse(fs17.readFileSync(statePath, "utf8"));
    if (parsed?.version !== 2 || parsed?.noDistWrites !== true) return null;
    return parsed;
  } catch {
    return null;
  }
}
function samePublicationIdentity(a, b) {
  return a.mode === b.mode && a.productionPlanOutputVersion === b.productionPlanOutputVersion && a.nodeEnv === b.nodeEnv && a.configHash === b.configHash && a.depsHash === b.depsHash && a.depsOptimizerOutputVersion === b.depsOptimizerOutputVersion && a.entrySource === b.entrySource && JSON.stringify(a.entries ?? []) === JSON.stringify(b.entries ?? []);
}
function readProductionPublicationPlan(ionifyDir, expectedIdentity, committedState) {
  const state = committedState === void 0 ? readProductionPublicationState(ionifyDir) : committedState;
  if (!state || state.state !== "published" || state.tiers.plan.state !== "published" || !samePublicationIdentity(state.identity, expectedIdentity)) {
    return null;
  }
  try {
    if (!state.planHash) return null;
    const planFile = fs17.readFileSync(
      resolveProductionPublicationPlanPath(ionifyDir, state.planHash)
    );
    if (typeof state.planFileHash === "string" && state.planFileHash.length > 0 && getCacheKey(planFile) !== state.planFileHash) {
      return null;
    }
    const parsed = JSON.parse(planFile.toString("utf8"));
    if (parsed?.version !== 2 || !parsed.identity || !parsed.plan || !parsed.planHash) return null;
    if (!samePublicationIdentity(parsed.identity, expectedIdentity)) return null;
    if (parsed.planHash !== state.planHash) return null;
    if ((!state.planFileHash || state.planFileHash.length === 0) && parsed.planHash !== getCacheKey(JSON.stringify(parsed.plan))) {
      return null;
    }
    if (!Array.isArray(parsed.plan.entries) || !Array.isArray(parsed.plan.chunks)) return null;
    return parsed.plan;
  } catch {
    return null;
  }
}
function writeProductionPublicationPlan(ionifyDir, identity, plan) {
  const planBytes = JSON.stringify(plan);
  const planHash = getCacheKey(planBytes);
  const planPath = resolveProductionPublicationPlanPath(ionifyDir, planHash);
  const dir = path19.dirname(planPath);
  fs17.mkdirSync(dir, { recursive: true });
  if (fs17.existsSync(planPath)) return planHash;
  const tmp = path19.join(dir, `.${planHash}.${process.pid}.${Date.now()}.tmp`);
  fs17.writeFileSync(
    tmp,
    `${JSON.stringify({
      version: 2,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      identity,
      planHash,
      plan
    })}
`,
    "utf8"
  );
  fs17.renameSync(tmp, planPath);
  return planHash;
}
function writeProductionBuildPlanProof(ionifyDir, identity, plan, timingsMs = {}) {
  const planHash = writeProductionPublicationPlan(ionifyDir, identity, plan);
  const state = createProductionPublicationState(identity, "A", "published");
  state.planHash = planHash;
  const summary = summarizePlanForPublication(plan);
  const planMs = timingsMs.plan ?? timingsMs.graph ?? 0;
  state.tiers.deps = {
    state: "published",
    reason: "Validated by direct production build before deploy-ready output was emitted"
  };
  state.tiers.graph = {
    state: "published",
    artifactCount: summary.modules,
    ms: planMs,
    reason: "Planner proof emitted by successful direct production build"
  };
  state.tiers.plan = {
    state: "published",
    artifactCount: summary.chunks,
    ms: planMs,
    reason: "Planner proof emitted by successful direct production build"
  };
  state.tiers.transforms = {
    state: "skipped",
    reason: "Direct build emitted deploy-ready output; this record carries planner proof only"
  };
  state.tiers.chunks = {
    state: "skipped",
    reason: "Direct build emitted deploy-ready output; this record carries planner proof only"
  };
  state.tiers.compression = {
    state: "skipped",
    reason: "Direct build emitted deploy-ready output; this record carries planner proof only"
  };
  state.timingsMs = { ...timingsMs, plan: planMs };
  writeProductionPublicationState(ionifyDir, state);
}
function writeProductionPublicationState(ionifyDir, state) {
  const statePath = resolveProductionPublicationStatePath(ionifyDir);
  const dir = path19.dirname(statePath);
  fs17.mkdirSync(dir, { recursive: true });
  const tmp = path19.join(dir, `.state.v2.${process.pid}.${Date.now()}.tmp`);
  const committedState = { ...state };
  if (committedState.planHash) {
    try {
      committedState.planFileHash = getCacheKey(
        fs17.readFileSync(resolveProductionPublicationPlanPath(ionifyDir, committedState.planHash))
      );
    } catch {
      committedState.planFileHash = null;
    }
  } else {
    committedState.planFileHash = null;
  }
  fs17.writeFileSync(tmp, `${JSON.stringify(committedState, null, 2)}
`, "utf8");
  fs17.renameSync(tmp, statePath);
}
function writeProductionPublicationProgress(ionifyDir, state) {
  const progressPath = resolveProductionPublicationProgressPath(ionifyDir);
  const dir = path19.dirname(progressPath);
  fs17.mkdirSync(dir, { recursive: true });
  const tmp = path19.join(dir, `.transaction.v2.${process.pid}.${Date.now()}.tmp`);
  fs17.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}
`, "utf8");
  fs17.renameSync(tmp, progressPath);
}
function clearProductionPublicationProgress(ionifyDir) {
  try {
    fs17.unlinkSync(resolveProductionPublicationProgressPath(ionifyDir));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
function createProductionPublicationState(identity, phase, state) {
  return {
    version: 2,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    state,
    phase,
    noDistWrites: true,
    planHash: null,
    planFileHash: null,
    identity,
    tiers: {
      deps: { state: "pending" },
      graph: { state: "pending" },
      plan: { state: "pending" },
      transforms: { state: "pending" },
      chunks: { state: phase === "B" ? "pending" : "skipped", reason: "Production Artifacts publishes chunk artifacts" },
      compression: { state: phase === "B" ? "pending" : "skipped", reason: "Production Artifacts publishes compression sidecars" }
    },
    timingsMs: {}
  };
}
function summarizePlanForPublication(plan) {
  return {
    chunks: plan.chunks.length,
    modules: plan.chunks.reduce((sum, chunk) => sum + chunk.modules.length, 0),
    entries: plan.entries.length
  };
}

// src/core/production-readiness-authority.ts
var PRODUCTION_READINESS_AUTHORITY_VERSION = 1;
var PRODUCTION_READINESS_RECORD_KIND = "deploy-ready.v1";
function resolveProductionReadinessRecordPath(ionifyDir) {
  return path20.join(ionifyDir, "production-readiness", "deploy-ready.v1.json");
}
function stableJson(value) {
  return JSON.stringify(normalizeForStableJson(value));
}
function hashStable(value) {
  return getCacheKey(stableJson(value));
}
function hashFileIfExists(filePath) {
  try {
    const stat = fs18.statSync(filePath);
    if (!stat.isFile()) return null;
    return getCacheKey(fs18.readFileSync(filePath));
  } catch {
    return null;
  }
}
function computeProductionPlanHash(plan) {
  return hashStable({
    entries: [...plan.entries].sort(),
    chunks: plan.chunks.map((chunk) => ({
      id: chunk.id,
      entry: chunk.entry,
      shared: chunk.shared,
      consumers: [...chunk.consumers ?? []].sort(),
      css: [...chunk.css ?? []].sort(),
      assets: [...chunk.assets ?? []].sort(),
      modules: chunk.modules.map((mod) => ({
        id: mod.id,
        fsPath: mod.fsPath ?? null,
        hash: mod.hash ?? null,
        kind: mod.kind,
        deps: [...mod.deps ?? []].sort(),
        dynamicDeps: [...mod.dynamicDeps ?? []].sort(),
        dependencyFormat: mod.dependencyFormat ?? null,
        usedExports: mod.usedExports ? [...mod.usedExports].sort() : null,
        dependencyAbiHash: mod.dependencyAbiHash ?? null,
        sideEffects: mod.sideEffects ?? null
      }))
    }))
  });
}
function computeTier4ChunkManifestHash(artifacts) {
  return hashStable(
    artifacts.map((artifact) => ({
      id: artifact.id,
      files: {
        js: [...artifact.files.js ?? []].sort(),
        css: [...artifact.files.css ?? []].sort(),
        assets: [...artifact.files.assets ?? []].sort()
      }
    }))
  );
}
function computeDistOutputManifestHash(input) {
  return hashStable({
    manifestHash: input.manifestHash,
    buildStatsHash: input.buildStatsHash,
    assetsManifestHash: input.assetsManifestHash ?? null,
    indexHtmlHash: input.indexHtmlHash ?? null
  });
}
function computePublicAssetManifestHash(input) {
  return hashStable({
    assets: input.assets.map((asset) => ({
      file: asset.file,
      bytes: asset.bytes,
      hash: asset.hash
    })),
    conflicts: [...input.conflicts].sort()
  });
}
function createProductionReadinessRecord(input) {
  const workspaceHash = hashStable({
    workspaceRoot: input.workspaceRoot,
    projectRoot: input.projectRoot
  });
  const productionPlanHash = computeProductionPlanHash(input.plan);
  const tier4ChunkManifestHash = computeTier4ChunkManifestHash(input.artifacts);
  const distOutputManifestHash = computeDistOutputManifestHash(input.dist);
  const publicAssetManifestHash = computePublicAssetManifestHash(input.publicAssets);
  const compressionManifestHash = input.compression.manifestHash ?? null;
  const compressionState = input.compression.state;
  const hasRequiredOutputProofs = input.configHash.length > 0 && input.depsHash.length > 0 && input.dist.manifestHash.length > 0 && input.dist.buildStatsHash.length > 0 && input.artifacts.length > 0;
  const state = hasRequiredOutputProofs && compressionState === "verified" && compressionManifestHash && input.publicAssets.conflicts.length === 0 ? "verified" : "partial";
  const identity = {
    praVersion: PRODUCTION_READINESS_AUTHORITY_VERSION,
    kind: PRODUCTION_READINESS_RECORD_KIND,
    productionPlanOutputVersion: PRODUCTION_PLAN_OUTPUT_VERSION,
    configHash: input.configHash,
    workspaceHash,
    depsHash: input.depsHash,
    productionPlanHash,
    tier4ChunkManifestHash,
    distOutputManifestHash,
    compressionManifestHash,
    compressionState,
    publicAssetManifestHash,
    integrityPolicyHash: input.integrityPolicyHash ?? null,
    engineVersion: input.engineVersion ?? getIonifyEngineVersion(),
    depsOptimizerOutputVersion: String(input.depsOptimizerOutputVersion)
  };
  return {
    version: PRODUCTION_READINESS_AUTHORITY_VERSION,
    kind: PRODUCTION_READINESS_RECORD_KIND,
    state,
    identityHash: hashStable(identity),
    identity,
    proofs: {
      workspace: {
        workspaceRoot: input.workspaceRoot,
        projectRoot: input.projectRoot
      },
      dist: {
        manifestHash: input.dist.manifestHash,
        buildStatsHash: input.dist.buildStatsHash,
        assetsManifestHash: input.dist.assetsManifestHash ?? null,
        indexHtmlHash: input.dist.indexHtmlHash ?? null
      },
      compression: {
        state: compressionState,
        manifestHash: compressionManifestHash
      },
      publicAssets: {
        assets: input.publicAssets.assets.map((asset) => ({ ...asset })),
        conflicts: [...input.publicAssets.conflicts].sort()
      }
    },
    metadata: {
      updatedAt: input.updatedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
      producer: "build"
    }
  };
}
function createPartialProductionReadinessRecord(input) {
  const workspaceHash = hashStable({
    workspaceRoot: input.workspaceRoot,
    projectRoot: input.projectRoot
  });
  const identity = {
    praVersion: PRODUCTION_READINESS_AUTHORITY_VERSION,
    kind: PRODUCTION_READINESS_RECORD_KIND,
    productionPlanOutputVersion: PRODUCTION_PLAN_OUTPUT_VERSION,
    configHash: input.configHash,
    workspaceHash,
    depsHash: input.depsHash,
    productionPlanHash: computeProductionPlanHash(input.plan),
    tier4ChunkManifestHash: input.tier4ChunkManifestHash ?? null,
    distOutputManifestHash: null,
    compressionManifestHash: null,
    compressionState: "missing",
    publicAssetManifestHash: null,
    integrityPolicyHash: input.integrityPolicyHash ?? null,
    engineVersion: input.engineVersion ?? getIonifyEngineVersion(),
    depsOptimizerOutputVersion: String(input.depsOptimizerOutputVersion)
  };
  return {
    version: PRODUCTION_READINESS_AUTHORITY_VERSION,
    kind: PRODUCTION_READINESS_RECORD_KIND,
    state: "partial",
    identityHash: hashStable(identity),
    identity,
    proofs: {
      workspace: {
        workspaceRoot: input.workspaceRoot,
        projectRoot: input.projectRoot
      },
      dist: {
        manifestHash: null,
        buildStatsHash: null,
        assetsManifestHash: null,
        indexHtmlHash: null
      },
      compression: {
        state: "missing",
        manifestHash: null
      },
      publicAssets: {
        assets: [],
        conflicts: []
      }
    },
    metadata: {
      updatedAt: input.updatedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
      producer: input.producer
    }
  };
}
function writeProductionReadinessRecord(ionifyDir, record) {
  writeProductionReadinessRecordAtomic(ionifyDir, record);
}
function writeProductionPublicationReadinessRecord(ionifyDir, record) {
  if (record.state !== "partial" || record.metadata.producer !== "publish-contracts" && record.metadata.producer !== "publish-artifacts") {
    throw new Error("PRA publication admission requires a PAP-owned partial record");
  }
  const current = readProductionReadinessRecord(ionifyDir);
  if (current?.state === "verified" && sameProductionContractIdentity(current.identity, record.identity)) {
    return "verified-preserved";
  }
  writeProductionReadinessRecordAtomic(ionifyDir, record);
  return "partial-published";
}
function writeProductionReadinessRecordAtomic(ionifyDir, record) {
  const recordPath = resolveProductionReadinessRecordPath(ionifyDir);
  fs18.mkdirSync(path20.dirname(recordPath), { recursive: true });
  const tmpPath = `${recordPath}.${process.pid}.${Date.now()}.tmp`;
  fs18.writeFileSync(tmpPath, `${JSON.stringify(record, null, 2)}
`, "utf8");
  fs18.renameSync(tmpPath, recordPath);
}
function sameProductionContractIdentity(left, right) {
  return left.praVersion === right.praVersion && left.kind === right.kind && left.productionPlanOutputVersion === right.productionPlanOutputVersion && left.configHash === right.configHash && left.workspaceHash === right.workspaceHash && left.depsHash === right.depsHash && left.productionPlanHash === right.productionPlanHash && left.integrityPolicyHash === right.integrityPolicyHash && left.engineVersion === right.engineVersion && left.depsOptimizerOutputVersion === right.depsOptimizerOutputVersion;
}
function readProductionReadinessRecord(ionifyDir) {
  const recordPath = resolveProductionReadinessRecordPath(ionifyDir);
  try {
    const raw = JSON.parse(fs18.readFileSync(recordPath, "utf8"));
    if (!isProductionReadinessRecord(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}
function isVerifiedProductionReadinessForPlan(record, input) {
  if (!record || record.state !== "verified") return false;
  const identity = record.identity;
  if (identity.productionPlanOutputVersion !== PRODUCTION_PLAN_OUTPUT_VERSION) return false;
  if (identity.configHash !== input.configHash) return false;
  if (identity.depsHash !== input.depsHash) return false;
  if (identity.depsOptimizerOutputVersion !== String(input.depsOptimizerOutputVersion)) return false;
  if (identity.engineVersion !== (input.engineVersion ?? getIonifyEngineVersion())) return false;
  if (identity.workspaceHash !== hashStable({
    workspaceRoot: input.workspaceRoot,
    projectRoot: input.projectRoot
  })) {
    return false;
  }
  if (identity.productionPlanHash !== computeProductionPlanHash(input.plan)) return false;
  return true;
}
function isProductionReadinessRecord(value) {
  if (!value || typeof value !== "object") return false;
  const record = value;
  if (record.version !== PRODUCTION_READINESS_AUTHORITY_VERSION) return false;
  if (record.kind !== PRODUCTION_READINESS_RECORD_KIND) return false;
  if (typeof record.identityHash !== "string" || record.identityHash.length === 0) return false;
  if (!record.identity || typeof record.identity !== "object") return false;
  if (hashStable(record.identity) !== record.identityHash) return false;
  return true;
}
function normalizeForStableJson(value) {
  if (Array.isArray(value)) return value.map(normalizeForStableJson);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = normalizeForStableJson(value[key]);
  }
  return out;
}
function getIonifyEngineVersion() {
  const candidates = ["../package.json", "../../package.json"];
  for (const candidate of candidates) {
    try {
      const pkgUrl = new URL(candidate, import.meta.url);
      const pkg = JSON.parse(fs18.readFileSync(pkgUrl, "utf8"));
      if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
    } catch {
    }
  }
  try {
    const pkgPath = path20.resolve(process.cwd(), "node_modules", "ionify", "package.json");
    const pkg = JSON.parse(fs18.readFileSync(pkgPath, "utf8"));
    if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
  } catch {
  }
  return "unknown";
}

// src/core/deps/vendor-pack-v2.ts
import fs19 from "fs";
import path21 from "path";
var DEPS_PREFIX = "/@deps/";
var IONIFY_VENDOR_PACK_V2_MARKER = "// ionify:vendor-pack-v2";
function readJsonFile(filePath) {
  if (!fs19.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs19.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
function writeJsonFile(filePath, data) {
  try {
    fs19.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  } catch {
  }
}
function vendorPackV2MemberKey(fileName) {
  return getCacheKey(`vp2:${fileName}`).slice(0, 12);
}
function readVendorPackV2KeyFromDisk(depsRoot, packFileName) {
  const packPath = path21.join(depsRoot, packFileName);
  if (!fs19.existsSync(packPath)) return null;
  try {
    const head = fs19.readFileSync(packPath, "utf8").slice(0, 256);
    const match = head.match(/\/\/\s*ionify:vendor-pack-v2\s+([0-9a-fA-F]{32,})/);
    const key = match?.[1] ? String(match[1]).toLowerCase() : null;
    return key && /^[0-9a-f]{32,}$/.test(key) ? key : null;
  } catch {
    return null;
  }
}
function uniqueSorted(values) {
  const normalized = values.map((v) => String(v)).filter(Boolean).slice().sort();
  const unique = [];
  for (const v of normalized) {
    if (unique.length === 0 || unique[unique.length - 1] !== v) unique.push(v);
  }
  return unique;
}
function isPublishedArtifactFile(depsRoot, fileName) {
  if (!fileName.endsWith(".js") || path21.isAbsolute(fileName)) return false;
  const relative = path21.relative(path21.resolve(depsRoot), path21.resolve(depsRoot, fileName));
  if (!relative || path21.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path21.sep}`)) {
    return false;
  }
  return fs19.existsSync(path21.join(depsRoot, relative));
}
function readWrapperExportAbiNames(depsRoot, fileName) {
  const manifestPath = path21.join(depsRoot, "manifest.json");
  if (!fs19.existsSync(manifestPath)) return null;
  try {
    const raw = JSON.parse(fs19.readFileSync(manifestPath, "utf8"));
    const entries = raw?.entries && typeof raw.entries === "object" ? raw.entries : {};
    for (const entry of Object.values(entries)) {
      const outFile = entry?.outFile ?? entry?.out_file;
      if (outFile !== fileName) continue;
      const abi = entry?.exportAbi ?? entry?.export_abi;
      if (!abi || abi.version !== 1 || abi.uncertain === true) return null;
      const names = Array.isArray(abi.names) ? abi.names.filter((name) => typeof name === "string" && name.length > 0) : [];
      return uniqueSorted(names);
    }
  } catch {
    return null;
  }
  return null;
}
function parseWrapperForVendorPackV2(depsRoot, fileName) {
  const wrapperPath = path21.join(depsRoot, fileName);
  if (!fs19.existsSync(wrapperPath)) return null;
  let code = "";
  try {
    code = fs19.readFileSync(wrapperPath, "utf8");
  } catch {
    return null;
  }
  const abiExportNames = readWrapperExportAbiNames(depsRoot, fileName);
  if (code.includes("export * from") && !abiExportNames) return null;
  const entryIdMatch = code.match(/const __exports = __ionifyRequire\(["']([^"']+)["']\);/);
  const entryId = entryIdMatch?.[1] ?? null;
  if (!entryId) return null;
  const cssImports = [];
  for (const match of code.matchAll(/import\s+["']([^"']+\?inline)["'];\s*/g)) {
    const url = match[1];
    if (typeof url === "string" && url.length > 0) cssImports.push(url);
  }
  const exportNames = abiExportNames ?? [];
  if (!abiExportNames) {
    for (const match of code.matchAll(
      /export\s+\{\s*__ionify_export_[A-Za-z0-9_$]+\s+as\s+([A-Za-z0-9_$]+)\s*\}\s*;\s*/g
    )) {
      const name = match[1];
      if (typeof name === "string" && name.length > 0) exportNames.push(name);
    }
  }
  return {
    entryId,
    cssImports: uniqueSorted(cssImports),
    exportNames: uniqueSorted(exportNames)
  };
}
var VendorPackV2IndexManager = class {
  depsRoot;
  depsHash;
  outputVersion;
  indexPath;
  allowPackFilePrefix;
  log;
  packFileToSharedFile = /* @__PURE__ */ new Map();
  packFileToKey = /* @__PURE__ */ new Map();
  packFileToChunkFiles = /* @__PURE__ */ new Map();
  fileNameToPackFile = /* @__PURE__ */ new Map();
  usageIndexHash = null;
  constructor(options) {
    this.depsRoot = options.depsRoot;
    this.depsHash = options.depsHash;
    this.outputVersion = options.outputVersion;
    this.indexPath = path21.join(this.depsRoot, "vendor-pack.v2.index.json");
    this.allowPackFilePrefix = options.allowPackFilePrefix ?? null;
    this.log = options.log ?? {};
  }
  setUsageIndexHash(hash) {
    const cleaned = hash && typeof hash === "string" ? hash.trim().toLowerCase() : "";
    const next = cleaned && /^[0-9a-f]{32,}$/.test(cleaned) ? cleaned : null;
    if (this.usageIndexHash === next) return;
    this.usageIndexHash = next;
    this.writeIndex();
  }
  writeIndex() {
    const packKeys = Array.from(this.packFileToSharedFile.keys()).sort();
    const packObj = {};
    const keyObj = {};
    const chunkObj = {};
    for (const packFile of packKeys) {
      const shared = this.packFileToSharedFile.get(packFile);
      if (shared) packObj[packFile] = shared;
      const key = this.packFileToKey.get(packFile);
      if (key) {
        const cleaned = key.trim().toLowerCase();
        keyObj[packFile] = cleaned;
      }
      const chunkFiles = this.packFileToChunkFiles.get(packFile);
      if (chunkFiles && chunkFiles.length > 0) {
        const unique = uniqueSorted(chunkFiles);
        chunkObj[packFile] = unique;
      }
    }
    const fileObj = {};
    const fileKeys = Array.from(this.fileNameToPackFile.keys()).sort();
    for (const fileName of fileKeys) {
      const packFile = this.fileNameToPackFile.get(fileName);
      if (packFile) fileObj[fileName] = packFile;
    }
    let routingBody = `vendor-pack-v2-index:v1:${this.depsHash}
`;
    for (const packFile of packKeys) {
      const shared = packObj[packFile];
      if (shared) routingBody += `shared:${packFile}=${shared}
`;
    }
    for (const packFile of packKeys) {
      const key = keyObj[packFile];
      if (key) routingBody += `key:${packFile}=${key}
`;
    }
    for (const packFile of packKeys) {
      const files = chunkObj[packFile];
      if (files && files.length > 0) routingBody += `chunks:${packFile}=${files.join(",")}
`;
    }
    for (const fileName of fileKeys) {
      const packFile = fileObj[fileName];
      if (packFile) routingBody += `route:${fileName}=${packFile}
`;
    }
    const payload = {
      version: 1,
      depsHash: this.depsHash,
      outputVersion: this.outputVersion,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      usageIndexHash: this.usageIndexHash,
      packFileToSharedFile: packObj,
      packFileToKey: keyObj,
      packFileToChunkFiles: chunkObj,
      fileNameToPackFile: fileObj
    };
    payload.packIndexHash = getCacheKey(routingBody);
    writeJsonFile(this.indexPath, payload);
  }
  loadFromDisk() {
    this.packFileToSharedFile.clear();
    this.packFileToKey.clear();
    this.packFileToChunkFiles.clear();
    this.fileNameToPackFile.clear();
    const raw = readJsonFile(this.indexPath);
    if (!raw || raw.version !== 1 || raw.depsHash !== this.depsHash || raw.outputVersion !== this.outputVersion) {
      return;
    }
    this.usageIndexHash = typeof raw.usageIndexHash === "string" ? raw.usageIndexHash.trim().toLowerCase() : null;
    const rawPackMap = raw.packFileToSharedFile;
    const rawKeyMap = raw.packFileToKey;
    const rawChunkMap = raw.packFileToChunkFiles;
    const rawFileMap = raw.fileNameToPackFile;
    const packFileToShared = /* @__PURE__ */ new Map();
    const packFileToKey = /* @__PURE__ */ new Map();
    const packFileToChunkFiles = /* @__PURE__ */ new Map();
    const fileNameToPackFile = /* @__PURE__ */ new Map();
    const validPackFiles = /* @__PURE__ */ new Set();
    let rawPackCount = 0;
    if (rawPackMap && typeof rawPackMap === "object") {
      for (const [packFileName, sharedFileName] of Object.entries(rawPackMap)) {
        if (typeof packFileName !== "string" || typeof sharedFileName !== "string") continue;
        if (!packFileName.endsWith(".js") || !sharedFileName.endsWith(".js")) continue;
        rawPackCount += 1;
        const packPath = path21.join(this.depsRoot, packFileName);
        const sharedPath = path21.join(this.depsRoot, sharedFileName);
        if (!fs19.existsSync(packPath) || !fs19.existsSync(sharedPath)) continue;
        packFileToShared.set(packFileName, sharedFileName);
        validPackFiles.add(packFileName);
      }
    }
    let rawKeyCount = 0;
    if (rawKeyMap && typeof rawKeyMap === "object") {
      for (const [packFileName, key] of Object.entries(rawKeyMap)) {
        if (typeof packFileName !== "string" || typeof key !== "string") continue;
        if (!validPackFiles.has(packFileName)) continue;
        rawKeyCount += 1;
        const cleaned = key.trim().toLowerCase();
        if (!/^[0-9a-f]{32,}$/.test(cleaned)) continue;
        packFileToKey.set(packFileName, cleaned);
      }
    }
    let rawChunkCount = 0;
    if (rawChunkMap && typeof rawChunkMap === "object") {
      for (const [packFileName, chunkFiles] of Object.entries(rawChunkMap)) {
        if (typeof packFileName !== "string" || !Array.isArray(chunkFiles)) continue;
        if (!validPackFiles.has(packFileName)) continue;
        rawChunkCount += 1;
        const normalized = chunkFiles.map((v) => typeof v === "string" ? v : "").filter(Boolean);
        if (normalized.length > 0) packFileToChunkFiles.set(packFileName, uniqueSorted(normalized));
      }
    }
    let needsRewrite = false;
    for (const packFileName of Array.from(validPackFiles.values())) {
      const sharedFileName = packFileToShared.get(packFileName);
      if (!sharedFileName) continue;
      const expectedKey = packFileToKey.get(packFileName) ?? readVendorPackV2KeyFromDisk(this.depsRoot, packFileName);
      if (expectedKey && !packFileToKey.has(packFileName)) {
        packFileToKey.set(packFileName, expectedKey);
        needsRewrite = true;
      }
      const chunkFiles = packFileToChunkFiles.get(packFileName) ?? [sharedFileName];
      if (!packFileToChunkFiles.has(packFileName)) {
        packFileToChunkFiles.set(packFileName, chunkFiles);
        needsRewrite = true;
      }
      const packPath = path21.join(this.depsRoot, packFileName);
      const sharedPath = path21.join(this.depsRoot, sharedFileName);
      const chunksOk = fs19.existsSync(packPath) && fs19.existsSync(sharedPath) && chunkFiles.every((f) => typeof f === "string" && f.endsWith(".js") && fs19.existsSync(path21.join(this.depsRoot, f)));
      if (!chunksOk) {
        validPackFiles.delete(packFileName);
        packFileToShared.delete(packFileName);
        packFileToKey.delete(packFileName);
        packFileToChunkFiles.delete(packFileName);
        needsRewrite = true;
        continue;
      }
      if (expectedKey) {
        try {
          const head = fs19.readFileSync(packPath, "utf8").slice(0, 256);
          if (!head.includes(`${IONIFY_VENDOR_PACK_V2_MARKER} ${expectedKey}`)) {
            validPackFiles.delete(packFileName);
            packFileToShared.delete(packFileName);
            packFileToKey.delete(packFileName);
            packFileToChunkFiles.delete(packFileName);
            needsRewrite = true;
          }
        } catch {
          validPackFiles.delete(packFileName);
          packFileToShared.delete(packFileName);
          packFileToKey.delete(packFileName);
          packFileToChunkFiles.delete(packFileName);
          needsRewrite = true;
        }
      }
    }
    let rawFileCount = 0;
    if (rawFileMap && typeof rawFileMap === "object") {
      for (const [fileName, packFileName] of Object.entries(rawFileMap)) {
        if (typeof fileName !== "string" || typeof packFileName !== "string") continue;
        if (!fileName.endsWith(".js") || !packFileName.endsWith(".js")) continue;
        rawFileCount += 1;
        if (!validPackFiles.has(packFileName)) continue;
        const wrapperPath = path21.join(this.depsRoot, fileName);
        if (!fs19.existsSync(wrapperPath)) continue;
        fileNameToPackFile.set(fileName, packFileName);
      }
    }
    if (this.allowPackFilePrefix) {
      for (const packFileName of Array.from(validPackFiles.values())) {
        if (packFileName.startsWith(this.allowPackFilePrefix)) continue;
        validPackFiles.delete(packFileName);
        packFileToShared.delete(packFileName);
        packFileToKey.delete(packFileName);
        packFileToChunkFiles.delete(packFileName);
        needsRewrite = true;
      }
      for (const [fileName, packFileName] of Array.from(fileNameToPackFile.entries())) {
        if (packFileName.startsWith(this.allowPackFilePrefix)) continue;
        fileNameToPackFile.delete(fileName);
        needsRewrite = true;
      }
    }
    for (const [packFileName, sharedFileName] of packFileToShared.entries()) {
      this.packFileToSharedFile.set(packFileName, sharedFileName);
    }
    for (const [packFileName, key] of packFileToKey.entries()) {
      this.packFileToKey.set(packFileName, key);
    }
    for (const [packFileName, chunkFiles] of packFileToChunkFiles.entries()) {
      this.packFileToChunkFiles.set(packFileName, chunkFiles);
    }
    for (const [fileName, packFileName] of fileNameToPackFile.entries()) {
      this.fileNameToPackFile.set(fileName, packFileName);
    }
    if (needsRewrite || rawPackCount > 0 && this.packFileToSharedFile.size !== rawPackCount || rawKeyCount > 0 && this.packFileToKey.size !== rawKeyCount || rawChunkCount > 0 && this.packFileToChunkFiles.size !== rawChunkCount || rawFileCount > 0 && this.fileNameToPackFile.size !== rawFileCount) {
      this.writeIndex();
    }
  }
  prunePackPrefix(prefix) {
    const cleanedPrefix = typeof prefix === "string" ? prefix.trim() : "";
    if (!cleanedPrefix) return;
    let indexChanged = false;
    for (const [fileName, packFileName] of Array.from(this.fileNameToPackFile.entries())) {
      if (!packFileName.startsWith(cleanedPrefix)) continue;
      this.fileNameToPackFile.delete(fileName);
      indexChanged = true;
    }
    for (const packFileName of Array.from(this.packFileToSharedFile.keys())) {
      if (!packFileName.startsWith(cleanedPrefix)) continue;
      this.packFileToSharedFile.delete(packFileName);
      this.packFileToKey.delete(packFileName);
      this.packFileToChunkFiles.delete(packFileName);
      indexChanged = true;
    }
    if (indexChanged || !fs19.existsSync(this.indexPath)) {
      this.writeIndex();
    }
  }
  ensurePackModuleFromEntries(options) {
    const { label, packFileName, sharedFileName, entries, prunePackPrefix } = options;
    if (!packFileName.endsWith(".js") || !sharedFileName.endsWith(".js")) return null;
    const chunkFiles = uniqueSorted(options.chunkFiles ?? [sharedFileName]);
    if (!chunkFiles.includes(sharedFileName)) return null;
    if (chunkFiles.length === 0 || chunkFiles.some((fileName) => !isPublishedArtifactFile(this.depsRoot, fileName))) {
      return null;
    }
    const parsedByFile = /* @__PURE__ */ new Map();
    const safeMembers = [];
    const memberSet = /* @__PURE__ */ new Set();
    for (const entry of entries) {
      const fileName = entry.fileName;
      if (!fileName || !fileName.endsWith(".js")) continue;
      memberSet.add(fileName);
      const parsed = parseWrapperForVendorPackV2(this.depsRoot, fileName);
      if (!parsed) continue;
      const memberKey = vendorPackV2MemberKey(fileName);
      parsedByFile.set(fileName, { ...parsed, memberKey });
      safeMembers.push(fileName);
    }
    safeMembers.sort();
    if (safeMembers.length === 0) return null;
    const cssSet = /* @__PURE__ */ new Set();
    for (const fileName of safeMembers) {
      const parsed = parsedByFile.get(fileName);
      if (!parsed) continue;
      for (const url of parsed.cssImports) cssSet.add(url);
    }
    const cssImports = Array.from(cssSet).sort();
    const vendorKey = getCacheKey(
      `vendor-pack-v2:v1:${this.depsHash}:${packFileName}:${chunkFiles.join("|")}:${safeMembers.join("|")}`
    );
    const outPath = path21.join(this.depsRoot, packFileName);
    let wroteModule = false;
    const moduleIsValidOnDisk = () => {
      if (!fs19.existsSync(outPath)) return false;
      try {
        const head = fs19.readFileSync(outPath, "utf8").slice(0, 256);
        return head.includes(`${IONIFY_VENDOR_PACK_V2_MARKER} ${vendorKey}`);
      } catch {
        return false;
      }
    };
    if (!moduleIsValidOnDisk()) {
      const lines = [];
      lines.push(`${IONIFY_VENDOR_PACK_V2_MARKER} ${vendorKey}`);
      lines.push(`// depsHash: ${this.depsHash}`);
      lines.push(`// pack: ${label}`);
      lines.push(`// shared: ${sharedFileName}`);
      lines.push(`// chunks: ${chunkFiles.join(",")}`);
      lines.push(`// members: ${safeMembers.length}`);
      lines.push(`import { __ionifyRequire } from "${DEPS_PREFIX}${sharedFileName}";`);
      for (const chunkFile of chunkFiles) {
        if (chunkFile === sharedFileName) continue;
        lines.push(`import "${DEPS_PREFIX}${chunkFile}";`);
      }
      for (const url of cssImports) {
        lines.push(`import "${url}";`);
      }
      lines.push("");
      for (const fileName of safeMembers) {
        const parsed = parsedByFile.get(fileName);
        if (!parsed) continue;
        const { entryId, exportNames, memberKey } = parsed;
        const prefix = `__ionify_vp_${memberKey}`;
        lines.push(`// member: ${fileName}`);
        lines.push(`const ${prefix}__ns = __ionifyRequire("${entryId}");`);
        lines.push(
          `const ${prefix}__default = ${prefix}__ns && ${prefix}__ns.__esModule && Object.prototype.hasOwnProperty.call(${prefix}__ns, "default") ? ${prefix}__ns.default : ${prefix}__ns;`
        );
        lines.push(`export { ${prefix}__default, ${prefix}__ns };`);
        for (const name of exportNames) {
          lines.push(`export const ${prefix}__${name} = ${prefix}__ns.${name};`);
        }
        lines.push("");
      }
      const body = lines.join("\n") + "\n";
      try {
        fs19.writeFileSync(outPath, body, "utf8");
      } catch (err) {
        this.log.warn?.(
          `[deps] WARN: Failed to write vendor pack v2 module (${label}): ${String(err)}`
        );
        return null;
      }
      wroteModule = true;
    }
    if (!moduleIsValidOnDisk()) return null;
    let indexChanged = false;
    if (prunePackPrefix) {
      for (const [fileName, existingPackFile] of Array.from(this.fileNameToPackFile.entries())) {
        if (existingPackFile === packFileName) continue;
        if (!existingPackFile.startsWith(prunePackPrefix)) continue;
        this.fileNameToPackFile.delete(fileName);
        indexChanged = true;
      }
    }
    const previousShared = this.packFileToSharedFile.get(packFileName);
    if (previousShared !== sharedFileName) {
      this.packFileToSharedFile.set(packFileName, sharedFileName);
      indexChanged = true;
    }
    const previousKey = this.packFileToKey.get(packFileName);
    if (previousKey !== vendorKey) {
      this.packFileToKey.set(packFileName, vendorKey);
      indexChanged = true;
    }
    const previousChunks = this.packFileToChunkFiles.get(packFileName);
    const nextChunks = chunkFiles;
    if (!previousChunks || previousChunks.length !== nextChunks.length || previousChunks.some((v, i) => v !== nextChunks[i])) {
      this.packFileToChunkFiles.set(packFileName, nextChunks);
      indexChanged = true;
    }
    for (const fileName of safeMembers) {
      const prev = this.fileNameToPackFile.get(fileName);
      if (prev !== packFileName) {
        this.fileNameToPackFile.set(fileName, packFileName);
        indexChanged = true;
      }
    }
    if (prunePackPrefix) {
      for (const fileName of memberSet) {
        if (safeMembers.includes(fileName)) continue;
        const prev = this.fileNameToPackFile.get(fileName);
        if (prev && prev.startsWith(prunePackPrefix)) {
          this.fileNameToPackFile.delete(fileName);
          indexChanged = true;
        }
      }
    }
    if (prunePackPrefix) {
      const referenced = new Set(this.fileNameToPackFile.values());
      for (const packFile of Array.from(this.packFileToSharedFile.keys())) {
        if (!packFile.startsWith(prunePackPrefix)) continue;
        if (referenced.has(packFile)) continue;
        this.packFileToSharedFile.delete(packFile);
        this.packFileToKey.delete(packFile);
        this.packFileToChunkFiles.delete(packFile);
        indexChanged = true;
      }
    }
    if (indexChanged || !fs19.existsSync(this.indexPath)) {
      this.writeIndex();
    }
    if (wroteModule) {
      this.log.info?.(
        `[deps] \u2713 Vendor pack v2 module ready (${label}): ${DEPS_PREFIX}${packFileName} members=${safeMembers.length}`
      );
    }
    return { packFileName, safeMembers };
  }
  ensurePackModuleFromWrappers(options) {
    const { label, packFileName, sharedFileName, members, prunePackPrefix } = options;
    if (!packFileName.endsWith(".js") || !sharedFileName.endsWith(".js")) return null;
    const sharedPath = path21.join(this.depsRoot, sharedFileName);
    if (!fs19.existsSync(sharedPath)) return null;
    const parsedByBase = /* @__PURE__ */ new Map();
    const safeMembers = [];
    const memberSet = /* @__PURE__ */ new Set();
    const wrapperByBase = /* @__PURE__ */ new Map();
    for (const member of members) {
      const baseFileName = member.baseFileName;
      const wrapperFileName = member.wrapperFileName;
      if (!baseFileName || !baseFileName.endsWith(".js")) continue;
      if (!wrapperFileName || !wrapperFileName.endsWith(".js")) continue;
      memberSet.add(baseFileName);
      wrapperByBase.set(baseFileName, wrapperFileName);
      const parsed = parseWrapperForVendorPackV2(this.depsRoot, wrapperFileName);
      if (!parsed) continue;
      const memberKey = vendorPackV2MemberKey(baseFileName);
      parsedByBase.set(baseFileName, { ...parsed, memberKey, wrapperFileName });
      safeMembers.push(baseFileName);
    }
    safeMembers.sort();
    if (safeMembers.length === 0) return null;
    const cssSet = /* @__PURE__ */ new Set();
    for (const baseFileName of safeMembers) {
      const parsed = parsedByBase.get(baseFileName);
      if (!parsed) continue;
      for (const url of parsed.cssImports) cssSet.add(url);
    }
    const cssImports = Array.from(cssSet).sort();
    const mappingKey = safeMembers.map((base) => `${base}=>${wrapperByBase.get(base) ?? ""}`).sort().join("|");
    const vendorKey = getCacheKey(
      `vendor-pack-v2:usage:v1:${this.depsHash}:${packFileName}:${sharedFileName}:${mappingKey}`
    );
    const outPath = path21.join(this.depsRoot, packFileName);
    let wroteModule = false;
    const moduleIsValidOnDisk = () => {
      if (!fs19.existsSync(outPath)) return false;
      try {
        const head = fs19.readFileSync(outPath, "utf8").slice(0, 256);
        return head.includes(`${IONIFY_VENDOR_PACK_V2_MARKER} ${vendorKey}`);
      } catch {
        return false;
      }
    };
    if (!moduleIsValidOnDisk()) {
      const lines = [];
      lines.push(`${IONIFY_VENDOR_PACK_V2_MARKER} ${vendorKey}`);
      lines.push(`// depsHash: ${this.depsHash}`);
      lines.push(`// pack: ${label}`);
      lines.push(`// shared: ${sharedFileName}`);
      lines.push(`// members: ${safeMembers.length}`);
      lines.push(`import { __ionifyRequire } from "${DEPS_PREFIX}${sharedFileName}";`);
      for (const url of cssImports) {
        lines.push(`import "${url}";`);
      }
      lines.push("");
      for (const baseFileName of safeMembers) {
        const parsed = parsedByBase.get(baseFileName);
        if (!parsed) continue;
        const { entryId, exportNames, memberKey, wrapperFileName } = parsed;
        const prefix = `__ionify_vp_${memberKey}`;
        lines.push(`// member: ${baseFileName} (wrapper: ${wrapperFileName})`);
        lines.push(`const ${prefix}__ns = __ionifyRequire("${entryId}");`);
        lines.push(
          `const ${prefix}__default = ${prefix}__ns && ${prefix}__ns.__esModule && Object.prototype.hasOwnProperty.call(${prefix}__ns, "default") ? ${prefix}__ns.default : ${prefix}__ns;`
        );
        lines.push(`export { ${prefix}__default, ${prefix}__ns };`);
        for (const name of exportNames) {
          lines.push(`export const ${prefix}__${name} = ${prefix}__ns.${name};`);
        }
        lines.push("");
      }
      const body = lines.join("\n") + "\n";
      try {
        fs19.writeFileSync(outPath, body, "utf8");
      } catch (err) {
        this.log.warn?.(
          `[deps] WARN: Failed to write vendor pack v2 module (${label}): ${String(err)}`
        );
        return null;
      }
      wroteModule = true;
    }
    if (!moduleIsValidOnDisk()) return null;
    let indexChanged = false;
    if (prunePackPrefix) {
      for (const [fileName, existingPackFile] of Array.from(this.fileNameToPackFile.entries())) {
        if (existingPackFile === packFileName) continue;
        if (!existingPackFile.startsWith(prunePackPrefix)) continue;
        this.fileNameToPackFile.delete(fileName);
        indexChanged = true;
      }
    }
    const previousShared = this.packFileToSharedFile.get(packFileName);
    if (previousShared !== sharedFileName) {
      this.packFileToSharedFile.set(packFileName, sharedFileName);
      indexChanged = true;
    }
    const previousKey = this.packFileToKey.get(packFileName);
    if (previousKey !== vendorKey) {
      this.packFileToKey.set(packFileName, vendorKey);
      indexChanged = true;
    }
    const previousChunks = this.packFileToChunkFiles.get(packFileName);
    const nextChunks = [sharedFileName];
    if (!previousChunks || previousChunks.length !== nextChunks.length || previousChunks.some((v, i) => v !== nextChunks[i])) {
      this.packFileToChunkFiles.set(packFileName, nextChunks);
      indexChanged = true;
    }
    for (const baseFileName of safeMembers) {
      const prev = this.fileNameToPackFile.get(baseFileName);
      if (prev !== packFileName) {
        this.fileNameToPackFile.set(baseFileName, packFileName);
        indexChanged = true;
      }
    }
    if (prunePackPrefix) {
      for (const fileName of memberSet) {
        if (safeMembers.includes(fileName)) continue;
        const prev = this.fileNameToPackFile.get(fileName);
        if (prev && prev.startsWith(prunePackPrefix)) {
          this.fileNameToPackFile.delete(fileName);
          indexChanged = true;
        }
      }
    }
    if (prunePackPrefix) {
      const referenced = new Set(this.fileNameToPackFile.values());
      for (const packFile of Array.from(this.packFileToSharedFile.keys())) {
        if (!packFile.startsWith(prunePackPrefix)) continue;
        if (referenced.has(packFile)) continue;
        this.packFileToSharedFile.delete(packFile);
        this.packFileToKey.delete(packFile);
        this.packFileToChunkFiles.delete(packFile);
        indexChanged = true;
      }
    }
    if (indexChanged || !fs19.existsSync(this.indexPath)) {
      this.writeIndex();
    }
    if (wroteModule) {
      this.log.info?.(
        `[deps] \u2713 Vendor pack v2 module ready (${label}): ${DEPS_PREFIX}${packFileName} members=${safeMembers.length}`
      );
    }
    return { packFileName, safeMembers };
  }
};

// src/cli/utils/deps-hash.ts
function computeDepsHash(configHash, lockfile, opts) {
  if (!native?.depsStoreHash) {
    throw new Error("DPL dependency store identity authority is unavailable");
  }
  return native.depsStoreHash(
    configHash,
    lockfile?.contents ?? null,
    opts.nodeEnv ?? null,
    opts.sourcemap,
    opts.bundleEsm,
    opts.sharedChunks,
    opts.outputVersion
  );
}

// src/core/federation.ts
import fs20 from "fs";
import path22 from "path";
var FEDERATION_GRAPH_PREFIX = "ionify:federation:";
var FEDERATION_GRAPH_KIND_REMOTE_APP = "remote_app";
var FEDERATION_GRAPH_KIND_REMOTE_MANIFEST = "remote_manifest";
var FEDERATION_GRAPH_KIND_REMOTE_EXPOSE = "remote_expose";
var FEDERATION_GRAPH_KIND_REMOTE_SHARED_DEP = "remote_shared_dep";
function readProjectPackageJson(rootDir) {
  const filePath = path22.join(rootDir, "package.json");
  if (!fs20.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs20.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
function normalizeRemoteConfig(remoteName, remoteConfig) {
  if (typeof remoteConfig === "string") {
    return { entry: remoteConfig, external: remoteName };
  }
  return {
    ...remoteConfig,
    external: remoteConfig.external ?? remoteName
  };
}
function normalizeSharedConfig(sharedConfig) {
  if (sharedConfig === true || sharedConfig === void 0) {
    return {};
  }
  if (sharedConfig === false) {
    return null;
  }
  return sharedConfig;
}
function mergeChunkFiles(target, next) {
  return {
    js: Array.from(/* @__PURE__ */ new Set([...target.js, ...next.js])),
    css: Array.from(/* @__PURE__ */ new Set([...target.css, ...next.css])),
    assets: Array.from(/* @__PURE__ */ new Set([...target.assets, ...next.assets]))
  };
}
function relativeToRoot(rootDir, targetPath) {
  const relative = path22.relative(rootDir, targetPath).split(path22.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}
function toPosixRelative(target) {
  const normalized = target.split(path22.sep).join("/");
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}
function synthNamespaceExportName(moduleId) {
  return `__ionify_ns_${getCacheKey(moduleId).slice(0, 8)}`;
}
function federationGraphNodeId(kind, appName, key) {
  const parts = [FEDERATION_GRAPH_PREFIX, kind, ":", encodeURIComponent(appName)];
  if (typeof key === "string" && key.length > 0) {
    parts.push(":", encodeURIComponent(key));
  }
  return parts.join("");
}
function resolveFederationHostName(config, rootDir) {
  const packageJson = readProjectPackageJson(rootDir);
  const packageName = typeof packageJson?.name === "string" && packageJson.name.trim().length > 0 ? packageJson.name.trim() : path22.basename(rootDir);
  return typeof config?.federation?.host === "string" && config.federation.host.trim().length > 0 ? config.federation.host.trim() : packageName;
}
function buildFederationSharedContractHash(sharedName, appName, entry) {
  return getCacheKey(
    JSON.stringify({
      sharedName,
      appName,
      singleton: entry.singleton,
      requiredVersion: entry.requiredVersion ?? null,
      providedVersion: entry.providedVersion ?? null,
      strictVersion: entry.strictVersion,
      eager: entry.eager,
      shareScope: entry.shareScope
    })
  );
}
function federationContainerChunkId(contractHash) {
  return `federation-container-${contractHash.slice(0, 12)}`;
}
function federationContainerEntryFile(chunkId) {
  return `chunks/${chunkId}/${chunkId}.native.js`;
}
function federationContainerVirtualModuleId(outDir, contractHash) {
  void outDir;
  return `ionify:virtual-module:container.${contractHash.slice(0, 12)}.mjs`;
}
function buildFederationVersionContract(federation) {
  if (!federation) return null;
  const remotes = Object.entries(federation.remotes ?? {}).map(([remoteName, remoteConfig]) => {
    const normalized = normalizeRemoteConfig(remoteName, remoteConfig);
    return {
      name: remoteName,
      entry: normalized.entry,
      external: normalizeConfiguredExternalSpecifiers(normalized.external ?? remoteName),
      version: normalized.version ?? null,
      integrity: normalized.integrity ?? null,
      hash: normalized.hash ?? null
    };
  }).filter((remote) => typeof remote.entry === "string" && remote.entry.trim().length > 0).sort((a, b) => a.name.localeCompare(b.name));
  const exposes = Object.entries(federation.exposes ?? {}).filter(([, exposeSource]) => typeof exposeSource === "string" && exposeSource.trim().length > 0).map(([exposeName, exposeSource]) => ({
    name: exposeName,
    source: exposeSource
  })).sort((a, b) => a.name.localeCompare(b.name));
  const shared = Object.entries(federation.shared ?? {}).map(([sharedName, sharedConfigRaw]) => {
    const sharedConfig = normalizeSharedConfig(sharedConfigRaw);
    if (!sharedConfig) return null;
    return {
      name: sharedName,
      singleton: sharedConfig.singleton === true,
      requiredVersion: typeof sharedConfig.requiredVersion === "string" && sharedConfig.requiredVersion.trim().length > 0 ? sharedConfig.requiredVersion.trim() : null,
      version: typeof sharedConfig.version === "string" && sharedConfig.version.trim().length > 0 ? sharedConfig.version.trim() : null,
      strictVersion: sharedConfig.strictVersion === true,
      eager: sharedConfig.eager === true,
      shareScope: typeof sharedConfig.shareScope === "string" && sharedConfig.shareScope.trim().length > 0 ? sharedConfig.shareScope.trim() : null
    };
  }).filter((value) => value !== null).sort((a, b) => a.name.localeCompare(b.name));
  return {
    host: typeof federation.host === "string" && federation.host.trim().length > 0 ? federation.host.trim() : null,
    remotes,
    exposes,
    shared
  };
}
function isFederationGraphNodeId(id) {
  return typeof id === "string" && id.startsWith(FEDERATION_GRAPH_PREFIX);
}
function collectFederationRemoteImportBindings(config, rootDir) {
  const federation = config?.federation;
  if (!federation?.remotes || typeof federation.remotes !== "object") return [];
  const hostName = resolveFederationHostName(config, rootDir);
  void hostName;
  return Object.entries(federation.remotes).map(([remoteName, remoteConfig]) => {
    const normalized = normalizeRemoteConfig(remoteName, remoteConfig);
    const externalSpecifiers = normalizeConfiguredExternalSpecifiers(normalized.external ?? remoteName);
    if (externalSpecifiers.length === 0) return null;
    return {
      remoteName,
      appNodeId: federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_APP, remoteName),
      externalSpecifiers
    };
  }).filter((binding) => binding !== null).sort((a, b) => a.remoteName.localeCompare(b.remoteName));
}
function rewriteFederationGraphEdgeIds(deps, bindings) {
  if (!Array.isArray(deps) || deps.length === 0 || bindings.length === 0) return Array.from(new Set(deps));
  const out = /* @__PURE__ */ new Set();
  for (const dep of deps) {
    let rewritten = dep;
    for (const binding of bindings) {
      if (binding.externalSpecifiers.some(
        (specifier) => dep === specifier || dep.startsWith(`${specifier}/`)
      )) {
        rewritten = binding.appNodeId;
        break;
      }
    }
    out.add(rewritten);
  }
  return Array.from(out);
}
function buildFederationConfigGraphNodes(config, rootDir) {
  const federation = config?.federation;
  if (!federation) return [];
  const hostName = resolveFederationHostName(config, rootDir);
  const nodes = /* @__PURE__ */ new Map();
  const sharedEntries = {};
  for (const [sharedName, sharedConfigRaw] of Object.entries(federation.shared ?? {})) {
    const sharedConfig = normalizeSharedConfig(sharedConfigRaw);
    if (!sharedConfig) continue;
    const entry = {
      singleton: sharedConfig.singleton === true,
      requiredVersion: typeof sharedConfig.requiredVersion === "string" && sharedConfig.requiredVersion.trim().length > 0 ? sharedConfig.requiredVersion.trim() : void 0,
      providedVersion: typeof sharedConfig.version === "string" && sharedConfig.version.trim().length > 0 ? sharedConfig.version.trim() : void 0,
      strictVersion: sharedConfig.strictVersion === true,
      eager: sharedConfig.eager === true,
      shareScope: typeof sharedConfig.shareScope === "string" && sharedConfig.shareScope.trim().length > 0 ? sharedConfig.shareScope.trim() : "default",
      contractHash: ""
    };
    entry.contractHash = buildFederationSharedContractHash(sharedName, hostName, entry);
    sharedEntries[sharedName] = entry;
  }
  const localExposeNodeIds = [];
  for (const [exposeKey, exposeSource] of Object.entries(federation.exposes ?? {})) {
    if (typeof exposeSource !== "string" || exposeSource.trim().length === 0) continue;
    const sourcePath = exposeSource.startsWith("/") ? path22.join(rootDir, exposeSource) : path22.resolve(rootDir, exposeSource);
    const source = relativeToRoot(rootDir, sourcePath);
    const hash = getCacheKey(JSON.stringify({ app: hostName, exposeKey, source }));
    const nodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_EXPOSE, hostName, exposeKey);
    nodes.set(nodeId, {
      id: nodeId,
      hash,
      deps: [],
      dynamicDeps: [],
      kind: FEDERATION_GRAPH_KIND_REMOTE_EXPOSE
    });
    localExposeNodeIds.push(nodeId);
  }
  const localSharedNodeIds = [];
  for (const [sharedName, entry] of Object.entries(sharedEntries)) {
    const nodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_SHARED_DEP, hostName, sharedName);
    nodes.set(nodeId, {
      id: nodeId,
      hash: entry.contractHash,
      deps: [],
      dynamicDeps: [],
      kind: FEDERATION_GRAPH_KIND_REMOTE_SHARED_DEP
    });
    localSharedNodeIds.push(nodeId);
  }
  if (localExposeNodeIds.length > 0 || localSharedNodeIds.length > 0) {
    const manifestNodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_MANIFEST, hostName);
    const manifestHash = getCacheKey(
      JSON.stringify({
        hostName,
        exposes: localExposeNodeIds,
        shared: localSharedNodeIds
      })
    );
    nodes.set(manifestNodeId, {
      id: manifestNodeId,
      hash: manifestHash,
      deps: [],
      dynamicDeps: [],
      kind: FEDERATION_GRAPH_KIND_REMOTE_MANIFEST
    });
    const appNodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_APP, hostName);
    nodes.set(appNodeId, {
      id: appNodeId,
      hash: getCacheKey(JSON.stringify({ hostName, manifestHash })),
      deps: [manifestNodeId, ...localExposeNodeIds, ...localSharedNodeIds],
      dynamicDeps: [],
      kind: FEDERATION_GRAPH_KIND_REMOTE_APP
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
        hash: normalized.hash ?? null
      })
    );
    nodes.set(manifestNodeId, {
      id: manifestNodeId,
      hash: manifestHash,
      deps: [],
      dynamicDeps: [],
      kind: FEDERATION_GRAPH_KIND_REMOTE_MANIFEST
    });
    const remoteSharedNodeIds = [];
    for (const [sharedName, entry] of Object.entries(sharedEntries)) {
      const sharedNodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_SHARED_DEP, remoteName, sharedName);
      nodes.set(sharedNodeId, {
        id: sharedNodeId,
        hash: buildFederationSharedContractHash(sharedName, remoteName, entry),
        deps: [],
        dynamicDeps: [],
        kind: FEDERATION_GRAPH_KIND_REMOTE_SHARED_DEP
      });
      remoteSharedNodeIds.push(sharedNodeId);
    }
    const appNodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_APP, remoteName);
    nodes.set(appNodeId, {
      id: appNodeId,
      hash: getCacheKey(JSON.stringify({ remoteName, manifestHash, external })),
      deps: [manifestNodeId, ...remoteSharedNodeIds],
      dynamicDeps: [],
      kind: FEDERATION_GRAPH_KIND_REMOTE_APP
    });
  }
  return Array.from(nodes.values()).sort((a, b) => a.id.localeCompare(b.id));
}
function buildFederationManifestGraphNodes(manifest) {
  if (!manifest?.host?.name) return [];
  const nodes = /* @__PURE__ */ new Map();
  const hostName = manifest.host.name;
  const localManifestNodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_MANIFEST, hostName);
  const localExposeNodeIds = [];
  const localSharedNodeIds = [];
  for (const [exposeKey, expose] of Object.entries(manifest.exposes ?? {})) {
    const nodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_EXPOSE, hostName, exposeKey);
    nodes.set(nodeId, {
      id: nodeId,
      hash: expose.contractHash,
      deps: [],
      dynamicDeps: [],
      kind: FEDERATION_GRAPH_KIND_REMOTE_EXPOSE
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
      kind: FEDERATION_GRAPH_KIND_REMOTE_SHARED_DEP
    });
    localSharedNodeIds.push(nodeId);
  }
  nodes.set(localManifestNodeId, {
    id: localManifestNodeId,
    hash: getCacheKey(
      JSON.stringify({
        host: manifest.host.contractHash,
        container: manifest.container?.contractHash ?? null
      })
    ),
    deps: [],
    dynamicDeps: [],
    kind: FEDERATION_GRAPH_KIND_REMOTE_MANIFEST
  });
  const localAppNodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_APP, hostName);
  nodes.set(localAppNodeId, {
    id: localAppNodeId,
    hash: manifest.container?.contractHash ?? manifest.host.contractHash,
    deps: [localManifestNodeId, ...localExposeNodeIds, ...localSharedNodeIds],
    dynamicDeps: [],
    kind: FEDERATION_GRAPH_KIND_REMOTE_APP
  });
  for (const [remoteName, remote] of Object.entries(manifest.remotes ?? {})) {
    const manifestNodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_MANIFEST, remoteName);
    nodes.set(manifestNodeId, {
      id: manifestNodeId,
      hash: remote.contractHash,
      deps: [],
      dynamicDeps: [],
      kind: FEDERATION_GRAPH_KIND_REMOTE_MANIFEST
    });
    const appNodeId = federationGraphNodeId(FEDERATION_GRAPH_KIND_REMOTE_APP, remoteName);
    nodes.set(appNodeId, {
      id: appNodeId,
      hash: remote.hash ?? remote.contractHash,
      deps: [manifestNodeId],
      dynamicDeps: [],
      kind: FEDERATION_GRAPH_KIND_REMOTE_APP
    });
  }
  return Array.from(nodes.values()).sort((a, b) => a.id.localeCompare(b.id));
}
function collectFederationExposeEntryPaths(config, rootDir) {
  const federation = config?.federation;
  if (!federation?.exposes || typeof federation.exposes !== "object") return [];
  const paths = Object.values(federation.exposes).filter((exposeSource) => typeof exposeSource === "string" && exposeSource.trim().length > 0).map(
    (exposeSource) => exposeSource.startsWith("/") ? path22.join(rootDir, exposeSource) : path22.resolve(rootDir, exposeSource)
  );
  return Array.from(new Set(paths)).sort((a, b) => a.localeCompare(b));
}
function buildFederationBuildManifest(options) {
  const { config, rootDir, workspaceRoot, outDir, plan, artifacts, hostEntryIds } = options;
  const federation = config?.federation;
  if (!federation) return null;
  const filesByChunk = /* @__PURE__ */ new Map();
  for (const artifact of artifacts) {
    filesByChunk.set(artifact.id, artifact.files);
  }
  const packageJson = readProjectPackageJson(rootDir);
  const packageName = typeof packageJson?.name === "string" && packageJson.name.trim().length > 0 ? packageJson.name.trim() : path22.basename(rootDir);
  const hostName = typeof federation.host === "string" && federation.host.trim().length > 0 ? federation.host.trim() : packageName;
  const hostEntryIdSet = new Set(hostEntryIds);
  const entryChunkIds = plan.chunks.filter((chunk) => chunk.entry && chunk.consumers.some((consumer) => hostEntryIdSet.has(consumer))).map((chunk) => chunk.id);
  const hostContractHash = getCacheKey(
    JSON.stringify({
      hostName,
      entryIds: hostEntryIds,
      entryChunkIds
    })
  );
  const remoteManifestEntries = {};
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
        integrity: normalized.integrity ?? null
      })
    );
    remoteManifestEntries[remoteName] = {
      entry: normalized.entry,
      external,
      format: "esm",
      version: normalized.version,
      integrity: normalized.integrity,
      hash: normalized.hash ?? contractHash,
      contractHash
    };
  }
  const exposeManifestEntries = {};
  for (const [exposeName, exposeSource] of Object.entries(federation.exposes ?? {})) {
    if (typeof exposeSource !== "string" || exposeSource.trim().length === 0) continue;
    const absPath = exposeSource.startsWith("/") ? path22.join(rootDir, exposeSource) : path22.resolve(rootDir, exposeSource);
    const moduleId = toWsModuleId(absPath, workspaceRoot);
    if (!moduleId) continue;
    let artifactHash;
    const chunkIds = [];
    let files = { js: [], css: [], assets: [] };
    let entryChunkId;
    let entryFile;
    const entryNamespace = synthNamespaceExportName(moduleId);
    for (const chunk of plan.chunks) {
      const matchedModule = chunk.modules.find((mod) => mod.id === moduleId);
      if (!matchedModule) continue;
      chunkIds.push(chunk.id);
      artifactHash = artifactHash ?? matchedModule.hash ?? void 0;
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
        chunkIds: chunkIds.slice().sort()
      })
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
      contractHash
    };
  }
  const dependencyVersions = {
    ...packageJson?.dependencies ?? {},
    ...packageJson?.peerDependencies ?? {},
    ...packageJson?.optionalDependencies ?? {}
  };
  const sharedManifestEntries = {};
  for (const [sharedName, sharedConfigRaw] of Object.entries(federation.shared ?? {})) {
    const sharedConfig = normalizeSharedConfig(sharedConfigRaw);
    if (!sharedConfig) continue;
    const providedVersion = typeof sharedConfig.version === "string" && sharedConfig.version.trim().length > 0 ? sharedConfig.version.trim() : typeof dependencyVersions[sharedName] === "string" ? dependencyVersions[sharedName] : void 0;
    const requiredVersion = typeof sharedConfig.requiredVersion === "string" && sharedConfig.requiredVersion.trim().length > 0 ? sharedConfig.requiredVersion.trim() : providedVersion;
    const singleton = sharedConfig.singleton === true;
    const strictVersion = sharedConfig.strictVersion === true;
    const eager = sharedConfig.eager === true;
    const shareScope = typeof sharedConfig.shareScope === "string" && sharedConfig.shareScope.trim().length > 0 ? sharedConfig.shareScope.trim() : "default";
    const contractHash = getCacheKey(
      JSON.stringify({
        sharedName,
        singleton,
        requiredVersion: requiredVersion ?? null,
        providedVersion: providedVersion ?? null,
        strictVersion,
        eager,
        shareScope
      })
    );
    sharedManifestEntries[sharedName] = {
      singleton,
      requiredVersion,
      providedVersion,
      strictVersion,
      eager,
      shareScope,
      contractHash
    };
  }
  const shareScopes = Array.from(
    new Set(Object.values(sharedManifestEntries).map((entry) => entry.shareScope).filter(Boolean))
  ).sort();
  const containerExposes = Object.keys(exposeManifestEntries).sort();
  const containerContractHash = getCacheKey(
    JSON.stringify({
      hostName,
      exposes: containerExposes.map((key) => ({
        key,
        entryFile: exposeManifestEntries[key]?.entryFile ?? null,
        files: exposeManifestEntries[key]?.files ?? { js: [], css: [], assets: [] }
      })),
      shareScopes
    })
  );
  const containerChunkId = containerExposes.length > 0 ? federationContainerChunkId(containerContractHash) : void 0;
  const containerEntry = containerChunkId ? toPosixRelative(federationContainerEntryFile(containerChunkId)) : void 0;
  return {
    version: 1,
    host: {
      name: hostName,
      entryIds: hostEntryIds,
      entryChunkIds,
      contractHash: hostContractHash
    },
    container: containerEntry ? {
      entry: containerEntry,
      format: "esm",
      exposes: containerExposes,
      shareScopes,
      contractHash: containerContractHash
    } : void 0,
    remotes: remoteManifestEntries,
    exposes: exposeManifestEntries,
    shared: sharedManifestEntries
  };
}
function renderFederationContainerModule(manifest) {
  const container = manifest.container;
  if (!container) {
    throw new Error("Federation container metadata is required to render a remote container module");
  }
  const containerDir = path22.posix.dirname(container.entry);
  const relativeFromContainer = (target) => {
    const relative = path22.posix.relative(containerDir, target);
    return relative.startsWith(".") ? relative : `./${relative}`;
  };
  const exposes = Object.fromEntries(
    Object.entries(manifest.exposes).filter(([, entry]) => typeof entry.entryFile === "string" && entry.entryFile.length > 0).map(([key, entry]) => [
      key,
      {
        id: entry.id,
        entryFile: relativeFromContainer(entry.entryFile),
        entryNamespace: entry.entryNamespace ?? null,
        files: {
          js: entry.files.js.map(relativeFromContainer),
          css: entry.files.css.map(relativeFromContainer),
          assets: entry.files.assets.map(relativeFromContainer)
        },
        contractHash: entry.contractHash
      }
    ])
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
        contractHash: entry.contractHash
      }
    ])
  );
  const payload = JSON.stringify(
    {
      version: manifest.version,
      host: manifest.host,
      container,
      exposes,
      shared
    },
    null,
    2
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
function buildFederationContainerBuildSpec(manifest, outDir) {
  const container = manifest.container;
  if (!container?.entry) return null;
  return {
    moduleId: federationContainerVirtualModuleId(outDir, container.contractHash),
    chunkId: federationContainerChunkId(container.contractHash),
    entry: container.entry,
    source: renderFederationContainerModule(manifest),
    contractHash: container.contractHash
  };
}

// src/core/graph.ts
import fs21 from "fs";
import path24 from "path";
import crypto5 from "crypto";

// src/core/graph-kind.ts
import path23 from "path";
var GRAPH_KIND_DEPENDENCY = "dependency";
var GRAPH_KIND_VIRTUAL = "virtual";
var GRAPH_KIND_CONFIG = "config";
var GRAPH_KIND_TOOLCHAIN = "toolchain";
var RUNTIME_GRAPH_KINDS = /* @__PURE__ */ new Set(["js", "css", "asset", "dep"]);
function isRuntimeGraphKind(kind) {
  return typeof kind === "string" && RUNTIME_GRAPH_KINDS.has(kind);
}
function classifyStructuralGraphKind(absPath) {
  const base = path23.basename(absPath).toLowerCase();
  if (/^postcss\.config\./.test(base) || /^tailwind\.config\./.test(base) || /^dga\.config\./.test(base)) {
    return GRAPH_KIND_TOOLCHAIN;
  }
  if (/^ionify\.config\./.test(base) || base === "package.json" || base === "pnpm-lock.yaml" || base === "package-lock.json" || base === "yarn.lock" || base === "tsconfig.json" || base === "jsconfig.json") {
    return GRAPH_KIND_CONFIG;
  }
  return GRAPH_KIND_DEPENDENCY;
}

// src/core/graph.ts
function resolveIonifyDir2(explicit) {
  if (explicit) return path24.resolve(explicit);
  const fromEnv = process.env.IONIFY_STATE_DIR;
  if (fromEnv && path24.isAbsolute(fromEnv)) return fromEnv;
  return path24.join(process.cwd(), ".ionify");
}
var Graph = class {
  ionifyDir;
  graphFile;
  graphDbPath;
  workspaceRoot;
  nodes = /* @__PURE__ */ new Map();
  dirty = false;
  saveTimer = null;
  native = native ?? null;
  nativeFlushTimer = null;
  queueSave() {
    if (this.native) return;
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.save(), 300);
  }
  constructor(versionInputs, opts = {}) {
    this.ionifyDir = resolveIonifyDir2(opts.ionifyDir ?? null);
    this.graphFile = path24.join(this.ionifyDir, "graph.json");
    this.graphDbPath = path24.join(this.ionifyDir, "graph.db");
    this.workspaceRoot = resolveWorkspaceRoot(null);
    if (!fs21.existsSync(this.ionifyDir)) {
      fs21.mkdirSync(this.ionifyDir, { recursive: true });
    }
    if (this.native) {
      const version = versionInputs ? computeGraphVersion(versionInputs) : void 0;
      const ok = ensureNativeGraph(this.graphDbPath, version);
      if (!ok) {
        this.native = null;
      }
    }
    this.load();
  }
  load() {
    if (this.native) {
      try {
        const snapshot = this.native.graphLoad();
        for (const node of snapshot) {
          const id = node.id;
          const fsPath = fromWsModuleId(id, this.workspaceRoot);
          const stat = fsPath && fs21.existsSync(fsPath) ? fs21.statSync(fsPath) : null;
          const dynamicDeps = Array.isArray(node.dynamicDeps) ? node.dynamicDeps : Array.isArray(node.dynamic_deps) ? node.dynamic_deps : [];
          this.nodes.set(id, {
            id,
            hash: node.hash,
            deps: Array.isArray(node.deps) ? node.deps : [],
            dynamicDeps,
            kind: node.kind,
            configHash: node.config_hash ?? node.configHash ?? null,
            mtimeMs: stat ? stat.mtimeMs : null
          });
        }
      } catch {
        this.loadFromDisk();
      }
      return;
    }
    this.loadFromDisk();
  }
  loadFromDisk() {
    if (!fs21.existsSync(this.graphFile)) return;
    try {
      const raw = fs21.readFileSync(this.graphFile, "utf8");
      const snap = JSON.parse(raw);
      if (snap.version === 2 && snap.nodes) {
        for (const [id, node] of Object.entries(snap.nodes)) {
          if (!id.startsWith("ws://") && !isFederationGraphNodeId(id)) continue;
          this.nodes.set(id, node);
        }
      }
    } catch {
    }
  }
  scheduleNativeFlush() {
    if (!this.native?.graphFlush) return;
    if (this.nativeFlushTimer) return;
    this.nativeFlushTimer = setTimeout(() => {
      this.nativeFlushTimer = null;
      try {
        this.native?.graphFlush?.();
      } catch {
      }
    }, 250);
  }
  scheduleSave() {
    if (this.native) return;
    this.queueSave();
  }
  save() {
    if (this.native) return;
    try {
      const snap = {
        version: 2,
        nodes: Object.fromEntries(this.nodes.entries())
      };
      fs21.writeFileSync(this.graphFile, JSON.stringify(snap, null, 2), "utf8");
      this.dirty = false;
    } catch {
    } finally {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
    }
  }
  moduleIdForPath(absPath) {
    return toWsModuleId(absPath, this.workspaceRoot);
  }
  pathForModuleId(moduleId) {
    return fromWsModuleId(moduleId, this.workspaceRoot);
  }
  depsToPaths(ids) {
    const out = [];
    for (const id of ids) {
      if (isPersistableExternalGraphLeafId(id) || isFederationGraphNodeId(id)) {
        out.push(id);
        continue;
      }
      const abs = this.pathForModuleId(id);
      if (abs) out.push(abs);
    }
    return out;
  }
  listNodeIdsByPrefix(prefix) {
    if (typeof prefix !== "string" || prefix.length === 0) return [];
    return Array.from(this.nodes.keys()).filter((id) => id.startsWith(prefix)).sort((a, b) => a.localeCompare(b));
  }
  recordNodeById(id, hash, deps, dynamicDeps = [], kind = "virtual", configHash) {
    if (typeof id !== "string" || id.length === 0) return false;
    const prev = this.nodes.get(id);
    const normalizedDeps = Array.from(new Set(deps.filter((dep) => typeof dep === "string" && dep.length > 0)));
    const normalizedDynamicDeps = Array.from(
      new Set(dynamicDeps.filter((dep) => typeof dep === "string" && dep.length > 0))
    );
    const node = {
      id,
      hash,
      deps: normalizedDeps,
      dynamicDeps: normalizedDynamicDeps,
      kind,
      configHash: configHash ?? process.env.IONIFY_CONFIG_HASH ?? null,
      mtimeMs: null
    };
    this.nodes.set(id, node);
    let changed = !prev || prev.hash !== node.hash || prev.kind !== node.kind || prev.configHash !== node.configHash || JSON.stringify(prev.deps) !== JSON.stringify(node.deps) || JSON.stringify(prev.dynamicDeps ?? []) !== JSON.stringify(node.dynamicDeps ?? []);
    if (this.native) {
      try {
        changed = this.native.graphRecord(
          id,
          hash,
          normalizedDeps,
          normalizedDynamicDeps,
          kind,
          node.configHash ?? null
        );
        this.scheduleNativeFlush();
      } catch (err) {
        console.error(`[Graph] Failed to record virtual node ${id}:`, err);
      }
    }
    this.scheduleSave();
    return changed;
  }
  removeNodeById(id) {
    if (typeof id !== "string" || id.length === 0) return;
    const existed = this.nodes.delete(id);
    if (!existed) return;
    for (const node of this.nodes.values()) {
      if (node.deps.includes(id)) {
        node.deps = node.deps.filter((dep) => dep !== id);
      }
      if (node.dynamicDeps?.includes(id)) {
        node.dynamicDeps = node.dynamicDeps.filter((dep) => dep !== id);
      }
    }
    if (this.native) {
      try {
        this.native.graphRemove(id);
        this.scheduleNativeFlush();
      } catch {
      }
    }
    this.queueSave();
  }
  /** Upsert a node and its deps; returns true if hash changed */
  recordFile(absPath, contentHash, depsAbs, dynamicDeps, kind) {
    const moduleId = this.moduleIdForPath(absPath);
    if (!moduleId) return false;
    const stat = fs21.existsSync(absPath) ? fs21.statSync(absPath) : null;
    const mtimeMs = stat ? stat.mtimeMs : null;
    const configHash = process.env.IONIFY_CONFIG_HASH || null;
    const prev = this.nodes.get(moduleId);
    let changed = !prev || prev.hash !== contentHash;
    const deps = Array.from(new Set(
      depsAbs.map((p) => {
        if (isPersistableExternalGraphLeafId(p) || isFederationGraphNodeId(p)) return p;
        return this.moduleIdForPath(p);
      }).filter((v) => !!v)
    ));
    const dyn = dynamicDeps ? Array.from(new Set(
      dynamicDeps.map((p) => {
        if (isPersistableExternalGraphLeafId(p) || isFederationGraphNodeId(p)) return p;
        return this.moduleIdForPath(p);
      }).filter((v) => !!v)
    )) : void 0;
    const node = {
      id: moduleId,
      hash: contentHash,
      deps,
      dynamicDeps: dyn,
      kind: kind || this.inferKind(absPath),
      configHash,
      mtimeMs
    };
    this.nodes.set(moduleId, node);
    if (this.native) {
      try {
        changed = this.native.graphRecord(
          moduleId,
          contentHash,
          deps,
          dyn || [],
          node.kind,
          node.configHash ?? null
        );
        this.scheduleNativeFlush();
      } catch (err) {
        console.error(`[Graph] Failed to record ${moduleId}:`, err);
      }
    }
    this.scheduleSave();
    return changed;
  }
  recordStructuralFile(absPath, kind = classifyStructuralGraphKind(absPath)) {
    const moduleId = this.moduleIdForPath(absPath);
    if (!moduleId) return false;
    const prev = this.nodes.get(moduleId);
    if (prev && isRuntimeGraphKind(prev.kind)) return false;
    if (!fs21.existsSync(absPath)) {
      return this.recordNodeById(moduleId, null, [], [], GRAPH_KIND_VIRTUAL);
    }
    const stat = fs21.statSync(absPath);
    if (!stat.isFile()) return false;
    const hash = crypto5.createHash("sha256").update(fs21.readFileSync(absPath)).digest("hex");
    return this.recordNodeById(moduleId, hash, [], [], kind);
  }
  recordStructuralFiles(absPaths) {
    let changed = 0;
    const seen = /* @__PURE__ */ new Set();
    for (const absPath of absPaths) {
      if (typeof absPath !== "string" || absPath.length === 0) continue;
      if (!path24.isAbsolute(absPath) || seen.has(absPath)) continue;
      seen.add(absPath);
      if (this.recordStructuralFile(absPath)) changed++;
    }
    return changed;
  }
  /** Infer module kind from file extension */
  inferKind(absPath) {
    const ext = path24.extname(absPath).toLowerCase();
    if ([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"].includes(ext)) return "js";
    if (isCssLikeExt(ext)) return "css";
    if ([".json"].includes(ext)) return "json";
    return "asset";
  }
  getNode(absPath) {
    const moduleId = this.moduleIdForPath(absPath);
    if (!moduleId) return void 0;
    const node = this.nodes.get(moduleId);
    if (!node) return void 0;
    return {
      id: absPath,
      hash: node.hash,
      deps: this.depsToPaths(node.deps),
      dynamicDeps: node.dynamicDeps ? this.depsToPaths(node.dynamicDeps) : void 0,
      kind: node.kind,
      configHash: node.configHash,
      mtimeMs: node.mtimeMs
    };
  }
  getDeps(absPath) {
    return this.getNode(absPath)?.deps ?? [];
  }
  listFilesByKind(kind) {
    const out = [];
    for (const node of this.nodes.values()) {
      if (node.kind !== kind) continue;
      const abs = this.pathForModuleId(node.id);
      if (abs) out.push(abs);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }
  /** Reverse edges: who depends on target? */
  getDependents(targetAbs) {
    const targetId = this.moduleIdForPath(targetAbs);
    if (!targetId) return [];
    const candidates = /* @__PURE__ */ new Set();
    if (this.native?.graphDependents) {
      try {
        for (const dep of this.native.graphDependents(targetId) ?? []) {
          candidates.add(dep);
        }
      } catch {
      }
    }
    for (const [id, node] of this.nodes) {
      if (node.deps.includes(targetId)) candidates.add(id);
    }
    const out = [];
    for (const id of candidates) {
      const abs = this.pathForModuleId(id);
      if (abs) out.push(abs);
    }
    return out;
  }
  /** Collect dependents recursively (breadth-first) */
  collectDependentsDeep(targetAbs) {
    const targetId = this.moduleIdForPath(targetAbs);
    if (!targetId) return [];
    const result = /* @__PURE__ */ new Set();
    const queue = [targetId];
    while (queue.length) {
      const current = queue.shift();
      const abs = this.pathForModuleId(current);
      if (!abs) continue;
      const deps = this.getDependents(abs);
      for (const depAbs of deps) {
        const depId = this.moduleIdForPath(depAbs);
        if (!depId) continue;
        if (!result.has(depId)) {
          result.add(depId);
          queue.push(depId);
        }
      }
    }
    const out = [];
    for (const id of result) {
      const abs = this.pathForModuleId(id);
      if (abs) out.push(abs);
    }
    return out;
  }
  /** Includes changed files and all dependents */
  collectAffected(changed) {
    const resultIds = /* @__PURE__ */ new Set();
    const resultAbs = /* @__PURE__ */ new Set();
    const changedIds = changed.map((p) => this.moduleIdForPath(p)).filter((v) => !!v);
    let usedNative = false;
    if (this.native?.graphCollectAffected) {
      try {
        const nativeList = this.native.graphCollectAffected(changedIds);
        for (const item of nativeList ?? []) {
          resultIds.add(item);
        }
        usedNative = true;
      } catch {
      }
    }
    for (const targetAbs of changed) {
      resultAbs.add(targetAbs);
      const id = this.moduleIdForPath(targetAbs);
      if (id) resultIds.add(id);
    }
    if (!usedNative || resultIds.size === 0) {
      for (const targetAbs of changed) {
        const targetId = this.moduleIdForPath(targetAbs);
        if (targetId) resultIds.add(targetId);
        for (const depAbs of this.collectDependentsDeep(targetAbs)) {
          resultAbs.add(depAbs);
          const depId = this.moduleIdForPath(depAbs);
          if (depId) resultIds.add(depId);
        }
      }
    }
    for (const id of resultIds) {
      const abs = this.pathForModuleId(id);
      if (abs) resultAbs.add(abs);
    }
    return Array.from(resultAbs);
  }
  /** Remove file from graph and clean up dependents lists */
  removeFile(absPath) {
    const moduleId = this.moduleIdForPath(absPath);
    if (!moduleId) return;
    const existed = this.nodes.delete(moduleId);
    if (existed) {
      for (const node of this.nodes.values()) {
        if (node.deps.includes(moduleId)) {
          node.deps = node.deps.filter((dep) => dep !== moduleId);
        }
      }
      if (this.native) {
        try {
          this.native.graphRemove(moduleId);
          this.scheduleNativeFlush();
        } catch {
        }
      }
      this.queueSave();
    }
  }
  /** Persist immediately (e.g., on shutdown) */
  flush() {
    if (this.nativeFlushTimer) {
      clearTimeout(this.nativeFlushTimer);
      this.nativeFlushTimer = null;
    }
    if (this.native?.graphFlush) {
      try {
        this.native.graphFlush();
      } catch {
      }
    }
    if (this.dirty) this.save();
  }
};

// src/core/build-entry-inference.ts
import fs22 from "fs";
import path25 from "path";
function resolveConfiguredBuildEntries(config, rootDir) {
  const configured = config?.entry ? (Array.isArray(config.entry) ? config.entry : [config.entry]).map((entry) => entry.startsWith("/") ? path25.join(rootDir, entry) : path25.resolve(rootDir, entry)).filter((entry) => typeof entry === "string" && entry.length > 0) : [];
  return configured.length > 0 ? configured : void 0;
}
function resolveHtmlModuleEntryPath(htmlInput, rootDir, src) {
  const trimmed = typeof src === "string" ? src.trim() : "";
  if (!trimmed) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(trimmed)) return null;
  if (trimmed.startsWith("data:") || trimmed.startsWith("javascript:") || trimmed.startsWith("#")) return null;
  const withoutQuery = trimmed.split("#", 1)[0]?.split("?", 1)[0]?.trim() ?? "";
  if (!withoutQuery) return null;
  if (withoutQuery.startsWith("/")) {
    return path25.join(rootDir, withoutQuery.replace(/^[/\\]+/, ""));
  }
  return path25.resolve(path25.dirname(htmlInput), withoutQuery);
}
function inferBuildEntriesFromHtml(rootDir, onWarn) {
  const htmlInput = path25.join(rootDir, "index.html");
  if (!fs22.existsSync(htmlInput)) return [];
  let html = "";
  try {
    html = fs22.readFileSync(htmlInput, "utf8");
  } catch {
    return [];
  }
  const moduleScriptRe = /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi;
  const entries = [];
  const seen = /* @__PURE__ */ new Set();
  for (const match of html.matchAll(moduleScriptRe)) {
    const src = typeof match[1] === "string" ? match[1] : "";
    const resolved = resolveHtmlModuleEntryPath(htmlInput, rootDir, src);
    if (!resolved) continue;
    if (!fs22.existsSync(resolved)) {
      onWarn?.(`[Build] Skipping inferred entry "${src}" from index.html because the file does not exist`);
      continue;
    }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    entries.push(resolved);
  }
  return entries;
}
function resolveProductionBuildEntries(config, rootDir, onWarn) {
  const configured = resolveConfiguredBuildEntries(config, rootDir);
  if (configured?.length) return { entries: configured, source: "config" };
  const inferred = inferBuildEntriesFromHtml(rootDir, onWarn);
  if (inferred.length > 0) return { entries: inferred, source: "html" };
  return { entries: void 0, source: "graph" };
}

// src/core/refresh/reactRefreshInstrumentation.ts
var REACT_REFRESH_RUNTIME_MODULE = "/__ionify_hmr_client.js";
var REACT_REFRESH_HMR_CONTRACT_VERSION = "entry-root-full-reload-v1";
function isPascalCaseIdentifier(name) {
  return /^[A-Z][A-Za-z0-9_$]*$/.test(name);
}
function hasRefreshRegistrationsAlready(code) {
  return /\$RefreshReg\$/.test(code);
}
function dedupeByExportName(items) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const it of items) {
    const key = `${it.exportName}::${it.localName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}
function detectRefreshBoundaryExports(code) {
  const out = [];
  function isValidIdentifier(name) {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
  }
  {
    const re = /export\s+(?:async\s+)?function\s+([A-Z][A-Za-z0-9_$]*)\s*\(/g;
    let m;
    while (m = re.exec(code)) {
      const name = m[1];
      out.push({ exportName: name, localName: name });
    }
  }
  {
    const re = /export\s+(?:const|let)\s+([A-Z][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][A-Za-z0-9_$]*\s*=>)/g;
    let m;
    while (m = re.exec(code)) {
      const name = m[1];
      out.push({ exportName: name, localName: name });
    }
  }
  {
    const re = /export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
    const m = re.exec(code);
    if (m?.[1]) {
      const local = m[1];
      if (isPascalCaseIdentifier(local)) {
        out.push({ exportName: "default", localName: local });
      }
    }
  }
  {
    const re = /export\s+default\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*;?/g;
    let m;
    while (m = re.exec(code)) {
      const local = m[1];
      if (local === "function" || local === "class") continue;
      if (isPascalCaseIdentifier(local)) {
        out.push({ exportName: "default", localName: local });
      }
    }
  }
  {
    const re = /export\s+(default\s+)?class\s+([A-Z][A-Za-z0-9_$]*)\b/g;
    let m;
    while (m = re.exec(code)) {
      const isDefault = Boolean(m[1]);
      const local = m[2];
      if (!isPascalCaseIdentifier(local)) continue;
      out.push({ exportName: isDefault ? "default" : local, localName: local });
    }
  }
  {
    const re = /export\s+(?:const|let)\s+([A-Z][A-Za-z0-9_$]*)\s*=\s*class\b/g;
    let m;
    while (m = re.exec(code)) {
      const name = m[1];
      if (!isPascalCaseIdentifier(name)) continue;
      out.push({ exportName: name, localName: name });
    }
  }
  {
    const re = /export\s*{\s*([^}]+)\s*}\s*(?:from\s*(['"][^'"]+['"]))?\s*;?/g;
    let m;
    while (m = re.exec(code)) {
      const from = m[2];
      if (from) continue;
      const specList = m[1] ?? "";
      const parts = specList.split(",").map((p) => p.trim()).filter(Boolean);
      for (const part of parts) {
        if (part.startsWith("type ")) continue;
        const asMatch = part.split(/\s+as\s+/);
        const local = (asMatch[0] ?? "").trim();
        const exported = (asMatch[1] ?? local).trim();
        if (!local || !exported) continue;
        if (local === "default") continue;
        if (!isValidIdentifier(local) || !isValidIdentifier(exported)) continue;
        if (!isPascalCaseIdentifier(local)) continue;
        if (exported !== "default" && !isPascalCaseIdentifier(exported)) continue;
        out.push({ exportName: exported, localName: local });
      }
    }
  }
  return dedupeByExportName(out);
}
async function buildReactRefreshRegistrations(code, _filePath) {
  if (hasRefreshRegistrationsAlready(code)) return "";
  const candidates = detectRefreshBoundaryExports(code);
  if (!candidates.length) return "";
  const lines = candidates.map(({ exportName, localName }) => {
    return `window.$RefreshReg$?.(${localName}, normalizeRefreshModuleId(import.meta.url) + ":" + ${JSON.stringify(exportName)});`;
  });
  return "\n" + lines.join("\n") + "\n";
}
function needsReactRefresh(ext, isDev) {
  if (!isDev) return false;
  return ext === ".jsx" || ext === ".tsx";
}
function hasReactRootRenderSideEffect(code) {
  const sample = code.slice(0, 64 * 1024);
  return /\bcreateRoot\s*\(/.test(sample) || /\bhydrateRoot\s*\(/.test(sample) || /\bReactDOM\s*\.\s*createRoot\s*\(/.test(sample) || /\bReactDOM\s*\.\s*hydrateRoot\s*\(/.test(sample) || /\bReactDOM\s*\.\s*render\s*\(/.test(sample);
}
async function instrumentReactRefresh(options) {
  const { code, filePath, ext, isDev, isEntry = false } = options;
  if (!needsReactRefresh(ext, isDev)) {
    return { shouldInstrument: false, prologue: "", registrations: "", epilogue: "" };
  }
  const registrations = isEntry ? "" : await buildReactRefreshRegistrations(code, filePath);
  const prologue = `import { setupReactRefresh, normalizeRefreshModuleId } from "${REACT_REFRESH_RUNTIME_MODULE}";
const __ionifyRefresh__ = setupReactRefresh(import.meta.hot ?? { accept() {}, dispose() {} }, normalizeRefreshModuleId(import.meta.url));
`;
  const shouldSelfAccept = !(isEntry && hasReactRootRenderSideEffect(code));
  const epilogue = shouldSelfAccept ? `
__ionifyRefresh__?.finalize?.();

if (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    __ionifyRefresh__?.refresh?.(newModule);
  });
  import.meta.hot.dispose(() => {
    __ionifyRefresh__?.dispose?.();
  });
}
` : `
__ionifyRefresh__?.finalize?.();
`;
  return { shouldInstrument: true, prologue, registrations, epilogue };
}

// src/core/chunk-policy.ts
var DEFAULT_VENDOR_CHUNK_MAX_BYTES = 4 * 1024 * 1024;
function normalizePositiveInteger(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : null;
}
function resolveProductionChunkPolicy(config) {
  const raw = config?.build?.vendorChunkMaxBytes;
  if (raw === false || raw === null) return { vendorMaxBytes: null };
  const explicit = normalizePositiveInteger(raw);
  return { vendorMaxBytes: explicit ?? DEFAULT_VENDOR_CHUNK_MAX_BYTES };
}

// src/core/production-build-identity.ts
function createProductionGraphVersionInputs(options) {
  const { config, parserMode, minifier, treeshake, scopeHoist, entries } = options;
  const pluginNames = Array.isArray(config?.plugins) ? config.plugins.map((p) => typeof p === "string" ? p : p?.name).filter((name) => typeof name === "string" && name.length > 0) : void 0;
  return {
    parserMode,
    minifier,
    treeshake,
    scopeHoist,
    plugins: pluginNames,
    entry: entries ?? null,
    resolveOptions: {
      alias: config?.resolve?.alias,
      builtinFallback: config?.resolve?.builtinFallback,
      runtimeGlobals: config?.resolve?.runtimeGlobals,
      extensions: config?.resolve?.extensions,
      conditions: config?.resolve?.conditions,
      mainFields: config?.resolve?.mainFields
    },
    cssOptions: config?.css,
    assetOptions: config?.assets ?? config?.asset,
    chunkPolicy: resolveProductionChunkPolicy(config),
    runtimeContracts: {
      reactRefreshRuntimeModule: REACT_REFRESH_RUNTIME_MODULE,
      federation: buildFederationVersionContract(config?.federation)
    }
  };
}

// src/cli/commands/build.ts
var DEPS_OPTIMIZER_OUTPUT_VERSION = getDepsOptimizerOutputVersion();
var TOPOLOGY_PROOF_VERSION = 1;
var PACKAGE_GRAPH_VERSION = 5;
var topologyValidationProfile = {
  proofValidationTimeMs: 0,
  byteScanTimeMs: 0,
  packageGraphCacheHit: 0
};
var depsMeasurementProfile = {
  cacheMode: "unknown",
  promoted: 0,
  promotionSkipped: 0,
  outputVersionMismatchSeen: false
};
function isBuildProfileEnabled() {
  return process.env.IONIFY_BUNDLE_PROFILE === "1" || process.env.IONIFY_BUNDLE_PROFILE === "true";
}
function logBuildProfile(label, startedAt) {
  if (!isBuildProfileEnabled()) return;
  logInfo(`[BuildProfile] ${label}_ms=${Date.now() - startedAt}`);
}
function logBuildProfileDuration(label, elapsedMs) {
  if (!isBuildProfileEnabled()) return;
  logInfo(`[BuildProfile] ${label}_ms=${elapsedMs}`);
}
function logBuildProfileValue(label, value) {
  if (!isBuildProfileEnabled()) return;
  logInfo(`[BuildProfile] ${label}=${value}`);
}
function logBuildProfileText(label, value) {
  if (!isBuildProfileEnabled()) return;
  logInfo(`[BuildProfile] ${label}=${value}`);
}
function createTransformCasProfile() {
  return {
    nativeJsTransformMs: 0,
    nativeJsTransformJobs: 0,
    nativeJsTransformReuseJobs: 0,
    cssCompileWallMs: 0,
    cssCompileTotalMs: 0,
    cssPostcssConfigLoadMs: 0,
    cssPostcssConfigWaitMs: 0,
    cssPostcssConfigCacheHits: 0,
    cssTailwindGraphSetupMs: 0,
    cssPostcssProcessMs: 0,
    cssPostcssPluginMs: 0,
    cssTailwindPluginMs: 0,
    cssAutoprefixerPluginMs: 0,
    cssRtlcssPluginMs: 0,
    cssOtherPostcssPluginMs: 0,
    cssDependencyCollectionMs: 0,
    cssImportDependencyDiscoveryMs: 0,
    cssUrlDependencyDiscoveryMs: 0,
    cssPipelineHashMs: 0,
    cssDemandProofMs: 0,
    cssWorkerJobs: 0,
    cssGlobalCacheRestoreMs: 0,
    cssGlobalCacheRestoreHit: 0,
    cssGlobalCacheRestoreMiss: 0,
    cssGlobalCacheWriteMs: 0,
    cssGlobalCacheWriteFiles: 0,
    workerTransformJobs: 0,
    workerTransformMs: 0,
    defineReplacementMs: 0,
    defineReplacementCalls: 0,
    artifactHashBookkeepingMs: 0,
    artifactHashBookkeepingCalls: 0,
    casMkdirMs: 0,
    casMkdirCalls: 0,
    casWriteMs: 0,
    casWriteFiles: 0,
    casWriteBytes: 0,
    baseArtifactWriteMs: 0,
    baseArtifactWriteFiles: 0,
    baseArtifactWriteBytes: 0,
    variantArtifactWriteMs: 0,
    variantArtifactWriteFiles: 0,
    variantArtifactWriteBytes: 0,
    cssDemandExtractionMs: 0,
    cssDemandFilesScanned: 0,
    cssDemandCacheHit: 0,
    cssDemandCacheMiss: 0,
    cssDemandTokens: 0,
    cssDemandProofWriteMs: 0,
    cssTailwindGraphContentMs: 0,
    cssTailwindGraphContentFiles: 0,
    cssTailwindGraphContentPlugins: 0,
    cssTailwindGraphContentOptimized: 0,
    cssTailwindGraphContentFallbacks: 0
  };
}
function profileElapsed(profile, key, fn) {
  const started = Date.now();
  try {
    return fn();
  } finally {
    profile[key] = profile[key] + (Date.now() - started);
  }
}
function profileCasMkdir(profile, dir) {
  const started = Date.now();
  try {
    fs23.mkdirSync(dir, { recursive: true });
  } finally {
    profile.casMkdirMs += Date.now() - started;
    profile.casMkdirCalls += 1;
  }
}
function byteLengthOfWriteData(data) {
  if (typeof data === "string") return Buffer.byteLength(data, "utf8");
  return data.byteLength;
}
function profileCasWrite(profile, filePath, data, kind) {
  const started = Date.now();
  try {
    fs23.writeFileSync(filePath, data, "utf8");
  } finally {
    const elapsed = Date.now() - started;
    const bytes = byteLengthOfWriteData(data);
    profile.casWriteMs += elapsed;
    profile.casWriteFiles += 1;
    profile.casWriteBytes += bytes;
    if (kind === "base") {
      profile.baseArtifactWriteMs += elapsed;
      profile.baseArtifactWriteFiles += 1;
      profile.baseArtifactWriteBytes += bytes;
    } else {
      profile.variantArtifactWriteMs += elapsed;
      profile.variantArtifactWriteFiles += 1;
      profile.variantArtifactWriteBytes += bytes;
    }
  }
}
function profileJsonCasWrite(profile, filePath, data, kind) {
  const bytes = Buffer.byteLength(JSON.stringify(data, null, 2) + "\n", "utf8");
  const started = Date.now();
  try {
    writeJsonFile2(filePath, data);
  } finally {
    const elapsed = Date.now() - started;
    profile.casWriteMs += elapsed;
    profile.casWriteFiles += 1;
    profile.casWriteBytes += bytes;
    if (kind === "base") {
      profile.baseArtifactWriteMs += elapsed;
      profile.baseArtifactWriteFiles += 1;
      profile.baseArtifactWriteBytes += bytes;
    } else {
      profile.variantArtifactWriteMs += elapsed;
      profile.variantArtifactWriteFiles += 1;
      profile.variantArtifactWriteBytes += bytes;
    }
  }
}
function logTransformCasProfile(profile) {
  if (!isBuildProfileEnabled()) return;
  logInfo(
    `[BuildProfile][transformCas] nativeJsTransform_ms=${profile.nativeJsTransformMs} jobs=${profile.nativeJsTransformJobs} reusedMutationFacts=${profile.nativeJsTransformReuseJobs}`
  );
  logInfo(
    `[BuildProfile][transformCas] cssCompileWall_ms=${profile.cssCompileWallMs.toFixed(2)} cssJobs=${profile.cssWorkerJobs} workerTransform_ms=${profile.workerTransformMs.toFixed(2)} workerJobs=${profile.workerTransformJobs}`
  );
  logInfo(
    `[BuildProfile][cssCompile] total_ms=${profile.cssCompileTotalMs.toFixed(2)} postcssConfigLoad_ms=${profile.cssPostcssConfigLoadMs.toFixed(2)} postcssConfigWait_ms=${profile.cssPostcssConfigWaitMs.toFixed(2)} postcssConfigCacheHits=${profile.cssPostcssConfigCacheHits} tailwindGraphSetup_ms=${profile.cssTailwindGraphSetupMs.toFixed(2)} postcssProcess_ms=${profile.cssPostcssProcessMs.toFixed(2)} pluginTotal_ms=${profile.cssPostcssPluginMs.toFixed(2)}`
  );
  logInfo(
    `[BuildProfile][cssCompile][plugins] tailwind_ms=${profile.cssTailwindPluginMs.toFixed(2)} autoprefixer_ms=${profile.cssAutoprefixerPluginMs.toFixed(2)} rtlcss_ms=${profile.cssRtlcssPluginMs.toFixed(2)} other_ms=${profile.cssOtherPostcssPluginMs.toFixed(2)}`
  );
  logInfo(
    `[BuildProfile][cssCompile][proof] dependencyCollection_ms=${profile.cssDependencyCollectionMs.toFixed(2)} importDiscovery_ms=${profile.cssImportDependencyDiscoveryMs.toFixed(2)} urlDiscovery_ms=${profile.cssUrlDependencyDiscoveryMs.toFixed(2)} pipelineHash_ms=${profile.cssPipelineHashMs.toFixed(2)} demandProof_ms=${profile.cssDemandProofMs.toFixed(2)}`
  );
  logInfo(
    `[BuildProfile][cssGlobalCache] restore_ms=${profile.cssGlobalCacheRestoreMs.toFixed(2)} hit=${profile.cssGlobalCacheRestoreHit} miss=${profile.cssGlobalCacheRestoreMiss} write_ms=${profile.cssGlobalCacheWriteMs.toFixed(2)} files=${profile.cssGlobalCacheWriteFiles}`
  );
  logInfo(
    `[BuildProfile][transformCas] defineReplacement_ms=${profile.defineReplacementMs} calls=${profile.defineReplacementCalls}`
  );
  logInfo(
    `[BuildProfile][transformCas] artifactHashBookkeeping_ms=${profile.artifactHashBookkeepingMs} calls=${profile.artifactHashBookkeepingCalls}`
  );
  logInfo(
    `[BuildProfile][transformCas] casMkdir_ms=${profile.casMkdirMs} calls=${profile.casMkdirCalls}`
  );
  logInfo(
    `[BuildProfile][transformCas] casWrite_ms=${profile.casWriteMs} files=${profile.casWriteFiles} bytes=${profile.casWriteBytes}`
  );
  logInfo(
    `[BuildProfile][transformCas] baseArtifactWrite_ms=${profile.baseArtifactWriteMs} files=${profile.baseArtifactWriteFiles} bytes=${profile.baseArtifactWriteBytes}`
  );
  logInfo(
    `[BuildProfile][transformCas] variantArtifactWrite_ms=${profile.variantArtifactWriteMs} files=${profile.variantArtifactWriteFiles} bytes=${profile.variantArtifactWriteBytes}`
  );
  logInfo(
    `[BuildProfile][cssDemand] extraction_ms=${profile.cssDemandExtractionMs} filesScanned=${profile.cssDemandFilesScanned} cacheHit=${profile.cssDemandCacheHit} cacheMiss=${profile.cssDemandCacheMiss} tokens=${profile.cssDemandTokens} proofWrite_ms=${profile.cssDemandProofWriteMs}`
  );
  logInfo(
    `[BuildProfile][cssTailwindGraphContent] override_ms=${profile.cssTailwindGraphContentMs} files=${profile.cssTailwindGraphContentFiles} plugins=${profile.cssTailwindGraphContentPlugins} optimized=${profile.cssTailwindGraphContentOptimized} fallbacks=${profile.cssTailwindGraphContentFallbacks}`
  );
}
function addCssCompileProfile(profile, cssProfile) {
  if (!cssProfile || typeof cssProfile !== "object") return;
  const p = cssProfile;
  profile.cssCompileTotalMs += Number(p.totalMs ?? 0);
  profile.cssPostcssConfigLoadMs += Number(p.postcssConfigLoadMs ?? 0);
  profile.cssPostcssConfigWaitMs += Number(p.postcssConfigWaitMs ?? 0);
  if (p.postcssConfigCacheHit === true) profile.cssPostcssConfigCacheHits += 1;
  profile.cssTailwindGraphSetupMs += Number(p.tailwindGraphContentMs ?? 0);
  profile.cssPostcssProcessMs += Number(p.postcssProcessMs ?? 0);
  profile.cssPostcssPluginMs += Number(p.postcssPluginMs ?? 0);
  profile.cssTailwindPluginMs += Number(p.tailwindPluginMs ?? 0);
  profile.cssAutoprefixerPluginMs += Number(p.autoprefixerPluginMs ?? 0);
  profile.cssRtlcssPluginMs += Number(p.rtlcssPluginMs ?? 0);
  profile.cssOtherPostcssPluginMs += Number(p.otherPostcssPluginMs ?? 0);
  profile.cssDependencyCollectionMs += Number(p.dependencyCollectionMs ?? 0);
  profile.cssImportDependencyDiscoveryMs += Number(p.importDependencyDiscoveryMs ?? 0);
  profile.cssUrlDependencyDiscoveryMs += Number(p.urlDependencyDiscoveryMs ?? 0);
  profile.cssPipelineHashMs += Number(p.pipelineHashMs ?? 0);
  profile.cssDemandProofMs += Number(p.cssDemandProofMs ?? 0);
}
function cloneWorkerSafeCssOptions(value) {
  if (value == null) return void 0;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return void 0;
  }
}
function resetTopologyValidationProfile() {
  topologyValidationProfile.proofValidationTimeMs = 0;
  topologyValidationProfile.byteScanTimeMs = 0;
  topologyValidationProfile.packageGraphCacheHit = 0;
  depsMeasurementProfile.cacheMode = "unknown";
  depsMeasurementProfile.promoted = 0;
  depsMeasurementProfile.promotionSkipped = 0;
  depsMeasurementProfile.outputVersionMismatchSeen = false;
  native?.depsOptimizerTopologyProfileReset?.();
}
function logTopologyValidationProfile(depsRoot) {
  if (!isBuildProfileEnabled()) return;
  const nativeProfile = native?.depsOptimizerTopologyProfile?.();
  const manifestCounts = countDepsManifestTopologies(depsRoot);
  logBuildProfileDuration("topologyDecisionTime", nativeProfile?.topologyDecisionTimeMs ?? 0);
  logBuildProfileDuration(
    "esmNativeSlimEmissionTime",
    nativeProfile?.esmNativeSlimEmissionTimeMs ?? nativeProfile?.esm_native_slim_emission_time_ms ?? 0
  );
  logBuildProfileDuration(
    "esmNativeSlimDceTime",
    nativeProfile?.esmNativeSlimDceTimeMs ?? nativeProfile?.esm_native_slim_dce_time_ms ?? 0
  );
  logBuildProfileValue(
    "esmNativeSlimDceRemovedDeclarations",
    nativeProfile?.esmNativeSlimDceRemovedDeclarations ?? nativeProfile?.esm_native_slim_dce_removed_declarations ?? 0
  );
  logBuildProfileValue(
    "esmNativeSlimDceRemovedPureExpressions",
    nativeProfile?.esmNativeSlimDceRemovedPureExpressions ?? nativeProfile?.esm_native_slim_dce_removed_pure_expressions ?? 0
  );
  logBuildProfileValue(
    "esmNativeSlimDceFoldedBranches",
    nativeProfile?.esmNativeSlimDceFoldedBranches ?? nativeProfile?.esm_native_slim_dce_folded_branches ?? 0
  );
  logBuildProfileDuration(
    "topologyProofValidationTime",
    topologyValidationProfile.proofValidationTimeMs + (nativeProfile?.topologyProofValidationTimeMs ?? 0)
  );
  logBuildProfileDuration(
    "topologyByteScanTime",
    topologyValidationProfile.byteScanTimeMs + (nativeProfile?.topologyByteScanTimeMs ?? 0)
  );
  logBuildProfileValue(
    "esmNativeArtifactCount",
    manifestCounts.esmNative + manifestCounts.esmNativeSlim || nativeProfile?.esmNativeArtifactCount || 0
  );
  logBuildProfileValue("esmNativeSlimArtifactCount", manifestCounts.esmNativeSlim);
  logBuildProfileValue(
    "wrapperArtifactCount",
    manifestCounts.wrapper || nativeProfile?.wrapperArtifactCount || 0
  );
  logBuildProfileDuration("packageGraphBuildTime", nativeProfile?.packageGraphBuildTimeMs ?? 0);
  logBuildProfileValue(
    "packageGraphCacheHit",
    topologyValidationProfile.packageGraphCacheHit + (nativeProfile?.packageGraphCacheHit ?? 0)
  );
  logBuildProfileValue("packageGraphCacheMiss", nativeProfile?.packageGraphCacheMiss ?? 0);
  logBuildProfileText("depsCacheMode", depsMeasurementProfile.cacheMode);
  logBuildProfileValue("depsPromotedArtifactCount", depsMeasurementProfile.promoted);
  logBuildProfileValue("depsPromotionSkippedCount", depsMeasurementProfile.promotionSkipped);
  logBuildProfileValue("depsOutputVersionMismatchSeen", depsMeasurementProfile.outputVersionMismatchSeen ? 1 : 0);
}
function readJsonFile2(filePath) {
  if (!fs23.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs23.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
function writeJsonFile2(filePath, data) {
  try {
    const next = JSON.stringify(data, null, 2) + "\n";
    try {
      if (fs23.existsSync(filePath)) {
        const prev = fs23.readFileSync(filePath, "utf8");
        if (prev === next) return;
      }
    } catch {
    }
    fs23.writeFileSync(filePath, next, "utf8");
  } catch {
  }
}
async function writeTextFileIfChanged2(filePath, contents) {
  const nextBytes = Buffer.byteLength(contents, "utf8");
  try {
    const stat = await fs23.promises.stat(filePath);
    if (stat.isFile() && stat.size === nextBytes) {
      const existing = await fs23.promises.readFile(filePath, "utf8");
      if (existing === contents) return;
    }
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
  await fs23.promises.mkdir(path26.dirname(filePath), { recursive: true });
  await fs23.promises.writeFile(filePath, contents, "utf8");
}
function syncFederationGraphNodes(graph, nodes) {
  const nextIds = new Set(nodes.map((node) => node.id));
  for (const existingId of graph.listNodeIdsByPrefix(FEDERATION_GRAPH_PREFIX)) {
    if (!nextIds.has(existingId)) {
      graph.removeNodeById(existingId);
    }
  }
  for (const node of nodes) {
    graph.recordNodeById(node.id, node.hash, node.deps, node.dynamicDeps ?? [], node.kind);
  }
}
function mergeFederationGraphNodes(...groups) {
  const merged = /* @__PURE__ */ new Map();
  for (const group of groups) {
    for (const node of group) merged.set(node.id, node);
  }
  return Array.from(merged.values()).sort((a, b) => a.id.localeCompare(b.id));
}
function resolvePublicDir(rootDir, value) {
  if (value === false) return null;
  const dir = typeof value === "string" && value.trim().length > 0 ? value.trim() : "public";
  return path26.isAbsolute(dir) ? dir : path26.resolve(rootDir, dir);
}
var ENGINE_OWNED_PUBLIC_OUTPUTS = /* @__PURE__ */ new Set(["index.html", "manifest.json", "manifest.assets.json", "build.stats.json"]);
async function copyPublicDirToOutDir(publicDirAbs, outDirAbs, previousPublicAssets = []) {
  if (!publicDirAbs) return { assets: [], copied: [], conflicts: [], reservedConflicts: [] };
  const srcRoot = path26.resolve(publicDirAbs);
  const destRoot = path26.resolve(outDirAbs);
  const previousByFile = new Map(previousPublicAssets.map((asset) => [asset.file, asset]));
  let srcStat = null;
  try {
    srcStat = fs23.statSync(srcRoot);
  } catch {
    return { assets: [], copied: [], conflicts: [], reservedConflicts: [] };
  }
  if (!srcStat.isDirectory()) return { assets: [], copied: [], conflicts: [], reservedConflicts: [] };
  const currentEntries = [];
  const copiedEntries = [];
  const conflicts = [];
  const reservedConflicts = [];
  const queue = [srcRoot];
  while (queue.length) {
    const dir = queue.pop();
    let entries;
    try {
      entries = await fs23.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const srcPath = path26.join(dir, entry.name);
      if (isForbiddenFsPath(srcPath)) continue;
      if (entry.isDirectory()) {
        queue.push(srcPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path26.relative(srcRoot, srcPath);
      if (!rel || rel.startsWith("..")) continue;
      const relPosix = rel.replace(/\\+/g, "/");
      const destPath = path26.join(destRoot, rel);
      if (!destPath.startsWith(destRoot + path26.sep) && destPath !== destRoot) continue;
      if (fs23.existsSync(destPath)) {
        const previous = previousByFile.get(relPosix);
        if (previous) {
          currentEntries.push(previous);
          continue;
        }
        try {
          const srcBytes = await fs23.promises.readFile(srcPath);
          const destStat = await fs23.promises.stat(destPath);
          if (destStat.isFile() && destStat.size === srcBytes.length) {
            const srcHash = getCacheKey(srcBytes);
            const destHash = getCacheKey(await fs23.promises.readFile(destPath));
            if (destHash === srcHash) {
              currentEntries.push({
                file: relPosix,
                bytes: srcBytes.length,
                hash: srcHash
              });
              continue;
            }
          }
        } catch {
        }
        if (ENGINE_OWNED_PUBLIC_OUTPUTS.has(relPosix)) {
          reservedConflicts.push(relPosix);
          continue;
        }
        conflicts.push(relPosix);
        continue;
      }
      try {
        const fileBytes = await fs23.promises.readFile(srcPath);
        await fs23.promises.mkdir(path26.dirname(destPath), { recursive: true });
        await fs23.promises.writeFile(destPath, fileBytes);
        const copied = {
          file: relPosix,
          bytes: fileBytes.length,
          hash: getCacheKey(fileBytes)
        };
        copiedEntries.push(copied);
        currentEntries.push(copied);
      } catch {
      }
    }
  }
  if (copiedEntries.length) {
    logInfo(`[Build][public] Copied ${copiedEntries.length} file(s) from publicDir into ${path26.basename(destRoot)}/`);
  }
  if (conflicts.length) {
    logWarn(`[Build][public] Skipped ${conflicts.length} file(s) due to output conflicts (will not overwrite build artifacts)`);
  }
  if (reservedConflicts.length) {
    logWarn(
      `[Build][public] Skipped ${reservedConflicts.length} engine-owned public file(s) (${reservedConflicts.join(", ")})`
    );
  }
  return { assets: currentEntries, copied: copiedEntries, conflicts, reservedConflicts };
}
function auditProductionSourceFreshness(plan, ionifyDir, workspaceRoot, casRoot, configHash) {
  const freshnessCacheFile = path26.join(ionifyDir, "source-freshness.v1.json");
  let freshnessCache = {};
  try {
    const parsed = JSON.parse(fs23.readFileSync(freshnessCacheFile, "utf8"));
    if (parsed && typeof parsed === "object") {
      freshnessCache = parsed;
    }
  } catch {
    return { current: false, changedPaths: [], reason: "missing-source-freshness-cache" };
  }
  const changedPaths = [];
  for (const chunk of plan.chunks) {
    for (const mod of chunk.modules) {
      if (mod.kind !== "js" && mod.kind !== "css") continue;
      let fsPath = typeof mod.fsPath === "string" && mod.fsPath.length > 0 ? mod.fsPath : null;
      if (!fsPath && typeof mod.id === "string" && mod.id.startsWith(WS_MODULE_PREFIX)) {
        fsPath = fromWsModuleId(mod.id, workspaceRoot);
      }
      if (!fsPath || !path26.isAbsolute(fsPath)) continue;
      if (fsPath.includes("node_modules") || fsPath.includes("/.ionify/")) continue;
      try {
        const st = fs23.statSync(fsPath);
        const cacheKey = `${mod.id}
${fsPath}`;
        const cached = freshnessCache[cacheKey];
        const statMatches = cached && cached.fsPath === fsPath && cached.dev === st.dev && cached.ino === st.ino && cached.mtimeMs === st.mtimeMs && cached.ctimeMs === st.ctimeMs && cached.size === st.size && typeof cached.hash === "string" && cached.hash.length > 0;
        const diskHash = statMatches ? cached.hash : getCacheKey(fs23.readFileSync(fsPath));
        if (!cached || cached.hash !== diskHash) {
          changedPaths.push(fsPath);
          continue;
        }
        if (mod.kind !== "css" && typeof mod.hash === "string" && mod.hash.length > 0 && mod.hash !== diskHash) {
          changedPaths.push(fsPath);
          continue;
        }
        if (mod.kind === "css") {
          const cssMeta = readJsonFile2(
            path26.join(getCasArtifactPath(casRoot, configHash, cached.hash), "meta.json")
          );
          if (!cssMeta || cssMeta.version !== CSS_CAS_META_VERSION || cssMeta.baseHash !== cached.hash || typeof cssMeta.pipelineHash !== "string" || cssMeta.pipelineHash.length === 0) {
            return { current: false, changedPaths, reason: "css-meta-stale" };
          }
          const publishedHash = typeof mod.hash === "string" ? mod.hash : "";
          if (cssMeta.artifactHash && cssMeta.depsStampHash && cssDepProofIsCurrent(cssMeta)) {
            const derivedCssFile = path26.join(getCasArtifactPath(casRoot, configHash, cssMeta.artifactHash), "transformed.css");
            if (!fs23.existsSync(derivedCssFile) || publishedHash !== cssMeta.artifactHash && publishedHash !== cached.hash) {
              return { current: false, changedPaths, reason: "css-artifact-stale" };
            }
          } else {
            const depsAbs = Array.from(
              new Set(
                [...cssMeta.deps ?? [], ...cssMeta.urlDeps ?? []].filter(
                  (p) => typeof p === "string" && p.length > 0
                )
              )
            );
            const depsStampHash = computeDepsContentStampHash(depsAbs, /* @__PURE__ */ new Map(), workspaceRoot);
            const expectedCssHash = getCacheKey(
              `css:v3:${mod.id}:${cached.hash}:${cssMeta.pipelineHash}:${depsStampHash}:${cssMeta.modules ? 1 : 0}:${metaTailwindStampForRecipe(cssMeta)}`
            );
            const derivedCssFile = path26.join(getCasArtifactPath(casRoot, configHash, expectedCssHash), "transformed.css");
            const legacyBaseHashIsMaterialized = publishedHash === cached.hash && fs23.existsSync(derivedCssFile);
            if (publishedHash !== expectedCssHash && !legacyBaseHashIsMaterialized) {
              return { current: false, changedPaths, reason: "css-recipe-stale" };
            }
          }
        }
      } catch {
        return { current: false, changedPaths: [], reason: "source-unreadable" };
      }
    }
  }
  return {
    current: changedPaths.length === 0,
    changedPaths: Array.from(new Set(changedPaths)).sort(),
    reason: changedPaths.length > 0 ? "source-content-changed" : void 0
  };
}
function updateSourceFreshnessCacheForCanonicalMutation(plan, ionifyDir, workspaceRoot, changedPaths) {
  if (changedPaths.length === 0) return;
  const freshnessCacheFile = path26.join(ionifyDir, "source-freshness.v1.json");
  let freshnessCache;
  try {
    const parsed = JSON.parse(fs23.readFileSync(freshnessCacheFile, "utf8"));
    if (!parsed || typeof parsed !== "object") return;
    freshnessCache = parsed;
  } catch {
    return;
  }
  const changed = new Set(changedPaths.map((filePath) => path26.resolve(filePath)));
  let updated = false;
  for (const chunk of plan.chunks) {
    for (const mod of chunk.modules) {
      if (mod.kind !== "js" || typeof mod.hash !== "string" || mod.hash.length === 0) continue;
      let fsPath = typeof mod.fsPath === "string" && mod.fsPath.length > 0 ? mod.fsPath : null;
      if (!fsPath && typeof mod.id === "string" && mod.id.startsWith(WS_MODULE_PREFIX)) {
        fsPath = fromWsModuleId(mod.id, workspaceRoot);
      }
      if (!fsPath || !changed.has(path26.resolve(fsPath))) continue;
      try {
        const bytes = fs23.readFileSync(fsPath);
        if (getCacheKey(bytes) !== mod.hash) continue;
        const st = fs23.statSync(fsPath);
        freshnessCache[`${mod.id}
${fsPath}`] = {
          fsPath,
          dev: st.dev,
          ino: st.ino,
          mtimeMs: st.mtimeMs,
          ctimeMs: st.ctimeMs,
          size: st.size,
          hash: mod.hash
        };
        updated = true;
      } catch {
      }
    }
  }
  if (!updated) return;
  try {
    const tmp = `${freshnessCacheFile}.${process.pid}.${Date.now()}.tmp`;
    fs23.writeFileSync(tmp, `${JSON.stringify(freshnessCache)}
`, "utf8");
    fs23.renameSync(tmp, freshnessCacheFile);
  } catch {
  }
}
function collectSourceOnlyMutationProof(plan, workspaceRoot, parserMode, changedPaths) {
  if (changedPaths.length === 0) {
    return { ok: false, changed: 0, changedPaths: [], runtimeMutations: [], reason: "no-source-changes" };
  }
  const planScanStart = performance.now();
  const changedSet = new Set(changedPaths.map((filePath) => path26.resolve(filePath)));
  const changedJsPaths = [];
  for (const chunk of plan.chunks) {
    for (const mod of chunk.modules) {
      if (mod.kind !== "js" && mod.kind !== "css") continue;
      let fsPath = typeof mod.fsPath === "string" && mod.fsPath.length > 0 ? mod.fsPath : null;
      if (!fsPath && typeof mod.id === "string" && mod.id.startsWith(WS_MODULE_PREFIX)) {
        fsPath = fromWsModuleId(mod.id, workspaceRoot);
      }
      if (!fsPath || !path26.isAbsolute(fsPath)) continue;
      if (fsPath.includes("node_modules") || fsPath.includes("/.ionify/")) continue;
      if (!changedSet.has(path26.resolve(fsPath))) continue;
      if (mod.kind !== "css") changedJsPaths.push(fsPath);
    }
  }
  const planScanMs = performance.now() - planScanStart;
  const runtimeFactsStart = performance.now();
  const runtimeFacts = collectRuntimeMutationFactsForFiles(changedJsPaths, parserMode);
  const runtimeFactsMs = performance.now() - runtimeFactsStart;
  logBuildProfileText(
    "sourceOnlyMutationProofBreakdown",
    `planScan_ms=${planScanMs.toFixed(2)} nativeFacts_ms=${runtimeFactsMs.toFixed(2)} files=${changedJsPaths.length}`
  );
  if (runtimeFacts?.profile) {
    logBuildProfileText(
      "runtimeMutationFactBreakdown",
      `inputRead_ms=${runtimeFacts.profile.inputReadMs.toFixed(2)} nativeCall_ms=${runtimeFacts.profile.nativeMutationMs.toFixed(2)} aggregation_ms=${runtimeFacts.profile.aggregationMs.toFixed(2)}`
    );
  }
  if (!runtimeFacts) {
    return { ok: false, changed: changedPaths.length, changedPaths: [], runtimeMutations: [], reason: "runtime-demand-facts-unavailable" };
  }
  return {
    ok: true,
    changed: changedPaths.length,
    changedPaths: Array.from(changedPaths),
    runtimeMutations: runtimeFacts.mutations
  };
}
var CSS_CAS_META_VERSION = 2;
function metaTailwindStampForRecipe(cssMeta) {
  const tw = cssMeta?.tailwindGraphContent;
  return tw?.enabled === true && typeof tw.stamp === "string" && tw.stamp.length > 0 ? tw.stamp : "none";
}
function isCssModuleFile(filePath) {
  return isCssModuleLikePath(filePath);
}
function recordStructuralGraphFiles(absPaths, workspaceRoot, configHash) {
  if (!native?.graphRecord) return;
  const seen = /* @__PURE__ */ new Set();
  for (const absPath of absPaths) {
    if (typeof absPath !== "string" || absPath.length === 0 || !path26.isAbsolute(absPath)) continue;
    if (seen.has(absPath)) continue;
    seen.add(absPath);
    const id = toWsModuleId(absPath, workspaceRoot);
    if (!id) continue;
    try {
      const existing = typeof native.graphGet === "function" ? native.graphGet(id) : null;
      if (existing && isRuntimeGraphKind(existing.kind)) continue;
      if (!fs23.existsSync(absPath)) {
        native.graphRecord(id, null, [], [], GRAPH_KIND_VIRTUAL, configHash);
        continue;
      }
      const stat = fs23.statSync(absPath);
      if (!stat.isFile()) continue;
      const hash = crypto6.createHash("sha256").update(fs23.readFileSync(absPath)).digest("hex");
      native.graphRecord(id, hash, [], [], classifyStructuralGraphKind(absPath), configHash);
    } catch {
    }
  }
}
function computeDepsContentStampHash(depsAbs, moduleMetaById, workspaceRoot) {
  if (!depsAbs.length) return "0";
  const entries = [];
  for (const depAbs of depsAbs) {
    const abs = path26.resolve(depAbs);
    let hash = null;
    const depId = toWsModuleId(abs, workspaceRoot);
    if (depId) hash = moduleMetaById.get(depId)?.hash ?? null;
    if (!hash) {
      try {
        const raw = fs23.readFileSync(abs);
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
function buildCssCasDepProof(depsAbs, moduleMetaById, workspaceRoot) {
  const proofs = [];
  const seen = /* @__PURE__ */ new Set();
  for (const depAbs of depsAbs) {
    const abs = path26.resolve(depAbs);
    if (seen.has(abs)) continue;
    seen.add(abs);
    const depId = toWsModuleId(abs, workspaceRoot);
    if (depId && moduleMetaById.has(depId)) continue;
    try {
      const st = fs23.statSync(abs);
      if (!st.isFile()) continue;
      proofs.push({
        filePath: abs,
        dev: st.dev,
        ino: st.ino,
        mtimeMs: st.mtimeMs,
        ctimeMs: st.ctimeMs,
        size: st.size,
        hash: getCacheKey(fs23.readFileSync(abs))
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
function cssDepProofIsCurrent(cssMeta) {
  if (!Array.isArray(cssMeta.depsProof)) return false;
  for (const proof of cssMeta.depsProof) {
    const depAbs = path26.resolve(proof.filePath);
    try {
      const st = fs23.statSync(depAbs);
      if (!st.isFile() || proof.dev !== st.dev || proof.ino !== st.ino || proof.mtimeMs !== st.mtimeMs || proof.ctimeMs !== st.ctimeMs || proof.size !== st.size) {
        return false;
      }
      if (getCacheKey(fs23.readFileSync(depAbs)) !== proof.hash) {
        return false;
      }
    } catch {
      return proof.hash === "missing";
    }
  }
  return true;
}
function cssMetaAdmitsCurrentTailwindGraph(cssMeta, currentGraphStamp) {
  if (cssMeta.tailwindGraphContent?.enabled !== true || Number(cssMeta.tailwindGraphContent.files ?? 0) <= 0) {
    return true;
  }
  const stamp = cssMeta.tailwindGraphContent.stamp;
  if (typeof stamp !== "string" || stamp.length === 0) return false;
  return currentGraphStamp !== null && stamp === currentGraphStamp;
}
function copyFileWithHardlinkFallback(src, dst) {
  try {
    fs23.mkdirSync(path26.dirname(dst), { recursive: true });
    if (fs23.existsSync(dst)) return true;
    try {
      fs23.linkSync(src, dst);
    } catch {
      fs23.copyFileSync(src, dst);
    }
    return true;
  } catch {
    return false;
  }
}
function canonicalFsPath(value) {
  try {
    return fs23.realpathSync.native(value);
  } catch {
    return path26.resolve(value);
  }
}
function loadDepsManifestIndex(depsRoot) {
  const manifestPath = path26.join(depsRoot, "manifest.json");
  if (!fs23.existsSync(manifestPath)) return /* @__PURE__ */ new Map();
  try {
    const raw = fs23.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    const entries = parsed?.entries ?? {};
    const activeEntriesRaw = parsed?.activeEntries ?? parsed?.active_entries;
    const activeManifestKeys = activeEntriesRaw && typeof activeEntriesRaw === "object" ? new Set(Object.values(activeEntriesRaw).filter((value) => typeof value === "string")) : null;
    const map = /* @__PURE__ */ new Map();
    for (const [manifestKey, entry] of Object.entries(entries)) {
      if (activeManifestKeys && !activeManifestKeys.has(manifestKey)) continue;
      const outFile = entry?.outFile ?? entry?.out_file ?? null;
      if (typeof outFile !== "string" || !outFile.endsWith(".js")) continue;
      const sizeBytes = typeof entry.sizeBytes === "number" ? entry.sizeBytes : typeof entry.size_bytes === "number" ? entry.size_bytes : 0;
      const moduleCount = typeof entry.moduleCount === "number" ? entry.moduleCount : typeof entry.module_count === "number" ? entry.module_count : 0;
      const edgeCount = typeof entry.edgeCount === "number" ? entry.edgeCount : typeof entry.edge_count === "number" ? entry.edge_count : 0;
      const externalCount = typeof entry.externalCount === "number" ? entry.externalCount : typeof entry.external_count === "number" ? entry.external_count : 0;
      const chunkGroup = typeof entry.chunkGroup === "string" ? entry.chunkGroup : typeof entry.chunk_group === "string" ? entry.chunk_group : null;
      const chunkFilesRaw = Array.isArray(entry.chunkFiles) ? entry.chunkFiles : Array.isArray(entry.chunk_files) ? entry.chunk_files : [];
      const chunkFiles = (Array.isArray(chunkFilesRaw) ? chunkFilesRaw : []).map((v) => typeof v === "string" ? v : null).filter((v) => typeof v === "string" && v.length > 0);
      const artifactTopologyReasonRaw = entry.artifactTopologyReason ?? entry.artifact_topology_reason;
      map.set(outFile, {
        entryPath: typeof entry?.entryPath === "string" ? entry.entryPath : typeof entry?.entry_path === "string" ? entry.entry_path : manifestKey.split("::usage::", 1)[0],
        packageLabel: entry.package || "unknown",
        hasSourcemap: entry.hasSourcemap === true,
        sizeBytes,
        moduleCount,
        edgeCount,
        externalCount,
        chunkGroup,
        chunkFiles,
        artifactTopologyReason: typeof artifactTopologyReasonRaw === "string" && artifactTopologyReasonRaw.length > 0 ? artifactTopologyReasonRaw : null
      });
    }
    return map;
  } catch {
    return /* @__PURE__ */ new Map();
  }
}
function normalizeManifestString(value) {
  return typeof value === "string" ? value : "";
}
function normalizeManifestStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function countDepsManifestTopologies(depsRoot) {
  try {
    const parsed = JSON.parse(fs23.readFileSync(path26.join(depsRoot, "manifest.json"), "utf8"));
    const entries = parsed?.entries && typeof parsed.entries === "object" ? Object.values(parsed.entries) : [];
    let esmNative = 0;
    let esmNativeSlim = 0;
    let wrapper = 0;
    for (const entry of entries) {
      const topology = normalizeManifestString(entry?.artifactTopology ?? entry?.artifact_topology);
      if (topology === "esm-native") esmNative++;
      else if (topology === "esm-native-slim") esmNativeSlim++;
      else if (topology === "wrapper") wrapper++;
    }
    return { esmNative, esmNativeSlim, wrapper };
  } catch {
    return { esmNative: 0, esmNativeSlim: 0, wrapper: 0 };
  }
}
function hasForbiddenFactoryTokens(code) {
  return code.includes("__ionifyModules") || code.includes("__ionifyRequire") || code.includes("shared.sc");
}
function validateDepsPackageGraphFact(entry, depsRoot) {
  const graph = entry?.packageGraph ?? entry?.package_graph;
  if (!graph || typeof graph !== "object") return { ok: true, graphOutFiles: [] };
  if (graph.version !== PACKAGE_GRAPH_VERSION) return { ok: false, reason: "package-graph-version", graphOutFiles: [] };
  if (graph.status !== "ready") return { ok: true, graphOutFiles: [] };
  if (normalizeManifestString(graph.identityHash ?? graph.identity_hash).length === 0 || normalizeManifestString(graph.entryFile ?? graph.entry_file).length === 0) {
    return { ok: false, reason: "package-graph-identity", graphOutFiles: [] };
  }
  const files = Array.isArray(graph.files) ? graph.files : [];
  const reachableFilesRaw = graph.reachableFiles ?? graph.reachable_files;
  const reachableFiles = Array.isArray(reachableFilesRaw) ? reachableFilesRaw : [];
  if (files.length === 0 || reachableFiles.length === 0) {
    return { ok: false, reason: "package-graph-files", graphOutFiles: [] };
  }
  const graphOutFiles = [];
  for (const file of files) {
    const graphOutFile = normalizeManifestString(file?.outFile ?? file?.out_file);
    const graphSourceFile = normalizeManifestString(file?.file);
    const graphHash = normalizeManifestString(file?.hash);
    if (!graphOutFile.endsWith(".js") || graphSourceFile.length === 0 || graphHash.length === 0) {
      return { ok: false, reason: "package-graph-file-invalid", graphOutFiles: [] };
    }
    if (!fs23.existsSync(path26.join(depsRoot, graphOutFile))) {
      return { ok: false, reason: "package-graph-artifact-missing", graphOutFiles: [] };
    }
    graphOutFiles.push(graphOutFile);
  }
  topologyValidationProfile.packageGraphCacheHit += 1;
  return { ok: true, graphOutFiles };
}
function validateDepsManifestEntryTopology(entry, depsRoot, outputVersion = DEPS_OPTIMIZER_OUTPUT_VERSION) {
  const proofStarted = Date.now();
  try {
    if (!entry || typeof entry !== "object") return { ok: false, reason: "entry-invalid" };
    const entryOutputVersion = typeof entry.outputVersion === "number" ? entry.outputVersion : typeof entry.output_version === "number" ? entry.output_version : 0;
    if (entryOutputVersion !== outputVersion) {
      depsMeasurementProfile.outputVersionMismatchSeen = true;
      return { ok: false, reason: "output-version-mismatch" };
    }
    const topology = normalizeManifestString(entry.artifactTopology ?? entry.artifact_topology);
    if (topology !== "wrapper" && topology !== "esm-native" && topology !== "esm-native-slim") {
      return { ok: false, reason: "artifact-topology-missing-or-invalid" };
    }
    const topologyReason = normalizeManifestString(entry.artifactTopologyReason ?? entry.artifact_topology_reason);
    if (topologyReason.length === 0) {
      return { ok: false, reason: "artifact-topology-reason-missing" };
    }
    const outFile = normalizeManifestString(entry.outFile ?? entry.out_file);
    if (!outFile.endsWith(".js")) return { ok: false, reason: "topology-out-file" };
    if (!fs23.existsSync(path26.join(depsRoot, outFile))) {
      return { ok: false, reason: "topology-artifact-missing" };
    }
    const artifactHash = normalizeManifestString(entry.artifactHash ?? entry.artifact_hash);
    if (artifactHash.length === 0) return { ok: false, reason: "topology-artifact-hash-missing" };
    const proofVersion = typeof entry.proofVersion === "number" ? entry.proofVersion : typeof entry.proof_version === "number" ? entry.proof_version : 0;
    if (topology === "wrapper") {
      return proofVersion === TOPOLOGY_PROOF_VERSION ? { ok: true } : { ok: false, reason: "topology-proof-version" };
    }
    if (entry.runtimeFormat !== "esm" && entry.runtime_format !== "esm") {
      return { ok: false, reason: "esm-native-runtime-format" };
    }
    if (entry.productionEsmSafe !== true && entry.production_esm_safe !== true) {
      return { ok: false, reason: "esm-native-production-safe" };
    }
    const sharedImportsRaw = entry.sharedImports ?? entry.shared_imports;
    if (!Array.isArray(sharedImportsRaw)) return { ok: false, reason: "esm-native-shared-imports-missing" };
    const sharedImports = normalizeManifestStringArray(sharedImportsRaw);
    if (sharedImports.length > 0) return { ok: false, reason: "esm-native-shared-imports" };
    const chunkGroup = normalizeManifestString(entry.chunkGroup ?? entry.chunk_group);
    if (chunkGroup.length > 0) return { ok: false, reason: "esm-native-chunk-group" };
    const chunkFilesRaw = entry.chunkFiles ?? entry.chunk_files;
    if (!Array.isArray(chunkFilesRaw)) return { ok: false, reason: "esm-native-chunk-files-missing" };
    const chunkFiles = normalizeManifestStringArray(chunkFilesRaw);
    if (chunkFiles.length > 0) return { ok: false, reason: "esm-native-chunk-files" };
    const forbiddenFactoryTokensAbsent = entry.forbiddenFactoryTokensAbsent === true || entry.forbidden_factory_tokens_absent === true;
    const graphValidation = validateDepsPackageGraphFact(entry, depsRoot);
    if (!graphValidation.ok) return { ok: false, reason: graphValidation.reason };
    if (proofVersion === TOPOLOGY_PROOF_VERSION && forbiddenFactoryTokensAbsent) {
      return { ok: true };
    }
    const scanStarted = Date.now();
    let code = "";
    try {
      code = fs23.readFileSync(path26.join(depsRoot, outFile), "utf8");
    } catch {
      return { ok: false, reason: "esm-native-artifact-missing" };
    } finally {
      topologyValidationProfile.byteScanTimeMs += Date.now() - scanStarted;
    }
    if (code.includes("__ionifyModules")) return { ok: false, reason: "esm-native-factory-modules" };
    if (code.includes("__ionifyRequire")) return { ok: false, reason: "esm-native-factory-require" };
    if (code.includes("shared.sc")) return { ok: false, reason: "esm-native-shared-factory" };
    for (const graphOutFile of graphValidation.graphOutFiles) {
      if (graphOutFile === outFile) continue;
      const graphScanStarted = Date.now();
      let graphCode = "";
      try {
        graphCode = fs23.readFileSync(path26.join(depsRoot, graphOutFile), "utf8");
      } catch {
        return { ok: false, reason: "esm-native-graph-artifact-missing" };
      } finally {
        topologyValidationProfile.byteScanTimeMs += Date.now() - graphScanStarted;
      }
      if (hasForbiddenFactoryTokens(graphCode)) {
        return { ok: false, reason: "esm-native-graph-factory-topology" };
      }
    }
    return { ok: true, reason: "topology-proof-fallback-byte-scan" };
  } finally {
    topologyValidationProfile.proofValidationTimeMs += Date.now() - proofStarted;
  }
}
function manifestHasDifferentOutputVersion(manifestPath, outputVersion = DEPS_OPTIMIZER_OUTPUT_VERSION) {
  try {
    const parsed = JSON.parse(fs23.readFileSync(manifestPath, "utf8"));
    const entries = parsed?.entries && typeof parsed.entries === "object" ? Object.values(parsed.entries) : [];
    return entries.some((entry) => {
      const entryOutputVersion = typeof entry?.outputVersion === "number" ? entry.outputVersion : typeof entry?.output_version === "number" ? entry.output_version : 0;
      return entryOutputVersion > 0 && entryOutputVersion !== outputVersion;
    });
  } catch {
    return false;
  }
}
function hasPriorDepsOutputVersionMismatch(ionifyDir, currentDepsRoot) {
  const localDepsDir = path26.join(ionifyDir, "deps");
  const checkParent = (parent) => {
    if (!fs23.existsSync(parent)) return false;
    try {
      for (const entry of fs23.readdirSync(parent, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dirPath = path26.join(parent, entry.name);
        if (path26.resolve(dirPath) === path26.resolve(currentDepsRoot)) continue;
        if (manifestHasDifferentOutputVersion(path26.join(dirPath, "manifest.json"))) return true;
      }
    } catch {
      return false;
    }
    return false;
  };
  if (checkParent(localDepsDir)) return true;
  return checkParent(path26.join(os2.homedir(), ".ionify", "global", "dep-artifacts", GLOBAL_DEP_CACHE_VERSION));
}
function statFileBytes(filePath) {
  try {
    const stat = fs23.statSync(filePath);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}
function sortedDirectoryFiles(root) {
  const out = [];
  if (!fs23.existsSync(root)) return out;
  const visit = (dir) => {
    for (const name of fs23.readdirSync(dir).sort()) {
      const filePath = path26.join(dir, name);
      let stat;
      try {
        stat = fs23.statSync(filePath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) visit(filePath);
      else if (stat.isFile()) out.push(filePath);
    }
  };
  visit(root);
  return out;
}
function depsRootRelativePath(depsRoot, filePath) {
  return path26.relative(depsRoot, filePath).split(path26.sep).join("/");
}
function collectManifestReferencedJsFiles(entry) {
  const out = /* @__PURE__ */ new Set();
  const outFile = normalizeManifestString(entry?.outFile ?? entry?.out_file);
  if (outFile.endsWith(".js")) out.add(outFile);
  const graph = entry?.packageGraph ?? entry?.package_graph;
  const graphFiles = graph && typeof graph === "object" && Array.isArray(graph.files) ? graph.files : [];
  for (const file of graphFiles) {
    const graphOutFile = normalizeManifestString(file?.outFile ?? file?.out_file);
    if (graphOutFile.endsWith(".js")) out.add(graphOutFile);
  }
  return Array.from(out).sort();
}
function sumFilesBytes(depsRoot, files) {
  let total = 0;
  for (const file of files) total += statFileBytes(path26.join(depsRoot, file)) ?? 0;
  return total;
}
function writeGate4ValueAccountingArtifact(depsRoot) {
  const started = Date.now();
  const manifestPath = path26.join(depsRoot, "manifest.json");
  if (!fs23.existsSync(manifestPath)) return { bytes: 0, timeMs: Date.now() - started };
  try {
    const parsed = JSON.parse(fs23.readFileSync(manifestPath, "utf8"));
    const entriesRaw = parsed?.entries && typeof parsed.entries === "object" ? Object.values(parsed.entries) : [];
    const dependencyJsFiles = /* @__PURE__ */ new Set();
    const dependencyGzipFiles = /* @__PURE__ */ new Set();
    const summary = {
      totalEntries: 0,
      wrapperEntries: 0,
      esmNativeEntries: 0,
      esmNativeSlimEntries: 0,
      wrapperJsBytes: 0,
      esmNativeJsBytes: 0,
      esmNativeSlimJsBytes: 0,
      realDependencyJsBytes: 0,
      realDependencyGzipBytes: 0,
      realDependencyFileCount: 0,
      allDependencyJsBytes: 0,
      allDependencyGzipBytes: 0,
      allDependencyFileCount: 0,
      nonManifestDependencyJsBytes: 0,
      nonManifestDependencyGzipBytes: 0,
      nonManifestDependencyFileCount: 0,
      packageGraphJsBytes: 0,
      packageGraphFileCount: 0,
      diagnosticReportBytes: 0,
      diagnosticReportFileCount: 0,
      contractMetadataBytes: 0,
      contractMetadataFileCount: 0,
      otherNonValueBytes: 0,
      otherNonValueFileCount: 0
    };
    const entries = entriesRaw.map((entry) => {
      const topology = normalizeManifestString(entry?.artifactTopology ?? entry?.artifact_topology) || "wrapper";
      const files = collectManifestReferencedJsFiles(entry);
      for (const file of files) {
        dependencyJsFiles.add(file);
        const gzipFile = `${file}.gz`;
        if (fs23.existsSync(path26.join(depsRoot, gzipFile))) dependencyGzipFiles.add(gzipFile);
      }
      const graph = entry?.packageGraph ?? entry?.package_graph;
      const graphFiles = graph && typeof graph === "object" && Array.isArray(graph.files) ? graph.files : [];
      const outFile = normalizeManifestString(entry?.outFile ?? entry?.out_file);
      const entryJsBytes = sumFilesBytes(depsRoot, files);
      const graphOnlyFiles = graphFiles.map((file) => normalizeManifestString(file?.outFile ?? file?.out_file)).filter((file) => file.endsWith(".js") && file !== outFile).sort();
      const graphJsBytes = sumFilesBytes(depsRoot, graphOnlyFiles);
      summary.totalEntries += 1;
      if (topology === "wrapper") {
        summary.wrapperEntries += 1;
        summary.wrapperJsBytes += entryJsBytes;
      } else if (topology === "esm-native-slim") {
        summary.esmNativeEntries += 1;
        summary.esmNativeSlimEntries += 1;
        summary.esmNativeJsBytes += entryJsBytes;
        summary.esmNativeSlimJsBytes += entryJsBytes;
      } else if (topology === "esm-native") {
        summary.esmNativeEntries += 1;
        summary.esmNativeJsBytes += entryJsBytes;
      }
      summary.packageGraphJsBytes += graphJsBytes;
      summary.packageGraphFileCount += graphOnlyFiles.length;
      return {
        package: normalizeManifestString(entry?.package) || `${normalizeManifestString(entry?.packageName ?? entry?.package_name)}@${normalizeManifestString(entry?.packageVersion ?? entry?.package_version)}`,
        packageName: normalizeManifestString(entry?.packageName ?? entry?.package_name),
        packageVersion: normalizeManifestString(entry?.packageVersion ?? entry?.package_version),
        packageSubpath: normalizeManifestString(entry?.packageSubpath ?? entry?.package_subpath),
        topology,
        artifactJsBytes: entryJsBytes,
        packageGraphJsBytes: graphJsBytes,
        dependencyFiles: files,
        fallbackReason: topology === "wrapper" ? normalizeManifestString(entry?.artifactTopologyReason ?? entry?.artifact_topology_reason) : null
      };
    }).sort((a, b) => {
      const packageCompare = a.package.localeCompare(b.package);
      if (packageCompare !== 0) return packageCompare;
      return a.packageSubpath.localeCompare(b.packageSubpath);
    });
    summary.realDependencyJsBytes = sumFilesBytes(depsRoot, dependencyJsFiles);
    summary.realDependencyGzipBytes = sumFilesBytes(depsRoot, dependencyGzipFiles);
    summary.realDependencyFileCount = dependencyJsFiles.size;
    const dependencyValueFiles = /* @__PURE__ */ new Set([...dependencyJsFiles, ...dependencyGzipFiles]);
    const diagnosticReportFiles = /* @__PURE__ */ new Set([
      "deps-usage.v2.json",
      "gate3-profile.json",
      "gate4-value-accounting.json"
    ]);
    for (const filePath of sortedDirectoryFiles(depsRoot)) {
      const rel = depsRootRelativePath(depsRoot, filePath);
      const bytes = statFileBytes(filePath) ?? 0;
      if (dependencyValueFiles.has(rel)) {
        if (rel.endsWith(".js")) summary.allDependencyJsBytes += bytes;
        else if (rel.endsWith(".js.gz")) summary.allDependencyGzipBytes += bytes;
        summary.allDependencyFileCount += 1;
        continue;
      }
      if (rel.endsWith(".js") || rel.endsWith(".js.gz")) {
        if (rel.endsWith(".js")) {
          summary.allDependencyJsBytes += bytes;
          summary.nonManifestDependencyJsBytes += bytes;
        } else {
          summary.allDependencyGzipBytes += bytes;
          summary.nonManifestDependencyGzipBytes += bytes;
        }
        summary.allDependencyFileCount += 1;
        summary.nonManifestDependencyFileCount += 1;
        continue;
      }
      if (rel === "manifest.json" || rel === ".verified" || rel.startsWith("vendor-pack.")) {
        summary.contractMetadataBytes += bytes;
        summary.contractMetadataFileCount += 1;
      } else if (diagnosticReportFiles.has(rel)) {
        summary.diagnosticReportBytes += bytes;
        summary.diagnosticReportFileCount += 1;
      } else {
        summary.otherNonValueBytes += bytes;
        summary.otherNonValueFileCount += 1;
      }
    }
    const artifactPath = path26.join(depsRoot, "gate4-value-accounting.json");
    writeJsonFile2(artifactPath, {
      version: 1,
      diagnostic: true,
      valueBytesExcludeReports: true,
      depsHash: normalizeManifestString(parsed?.depsHash ?? parsed?.deps_hash),
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      packageGraphVersion: PACKAGE_GRAPH_VERSION,
      cacheMode: depsMeasurementProfile.cacheMode,
      promotedArtifacts: depsMeasurementProfile.promoted,
      promotionSkippedArtifacts: depsMeasurementProfile.promotionSkipped,
      outputVersionMismatchSeen: depsMeasurementProfile.outputVersionMismatchSeen,
      summary,
      entries
    });
    return { bytes: statFileBytes(artifactPath) ?? 0, timeMs: Date.now() - started };
  } catch (err) {
    logWarn(`[deps] WARN: Failed to write Gate 4 value accounting artifact: ${String(err)}`);
    return { bytes: 0, timeMs: Date.now() - started };
  }
}
function writeGate3ProfileArtifact(depsRoot) {
  const started = Date.now();
  const manifestPath = path26.join(depsRoot, "manifest.json");
  if (!fs23.existsSync(manifestPath)) return { bytes: 0, timeMs: Date.now() - started };
  try {
    const parsed = JSON.parse(fs23.readFileSync(manifestPath, "utf8"));
    const entriesRaw = parsed?.entries && typeof parsed.entries === "object" ? Object.values(parsed.entries) : [];
    const entries = entriesRaw.map((entry) => {
      const topology = normalizeManifestString(entry?.artifactTopology ?? entry?.artifact_topology);
      const outFile = normalizeManifestString(entry?.outFile ?? entry?.out_file);
      const artifactPath2 = outFile ? path26.join(depsRoot, outFile) : "";
      const artifactBytes = artifactPath2 ? statFileBytes(artifactPath2) : null;
      const graph = entry?.packageGraph ?? entry?.package_graph;
      const graphFiles = graph && typeof graph === "object" && Array.isArray(graph.files) ? graph.files : [];
      const graphBytes = graphFiles.reduce((total, file) => {
        const graphOutFile = normalizeManifestString(file?.outFile ?? file?.out_file);
        if (!graphOutFile || graphOutFile === outFile) return total;
        return total + (statFileBytes(path26.join(depsRoot, graphOutFile)) ?? 0);
      }, 0);
      const wrapperBytes = topology === "wrapper" ? artifactBytes : null;
      const esmNativeBytes = (topology === "esm-native" || topology === "esm-native-slim") && artifactBytes !== null ? artifactBytes + graphBytes : null;
      const esmNativeSlimBytes = topology === "esm-native-slim" ? artifactBytes : null;
      const deltaBytes = typeof wrapperBytes === "number" && typeof esmNativeBytes === "number" ? wrapperBytes - esmNativeBytes : null;
      const reachableRaw = graph?.reachableFiles ?? graph?.reachable_files;
      const exportDemandRaw = entry?.exportDemand ?? entry?.export_demand ?? graph?.usedExports ?? graph?.used_exports;
      return {
        package: normalizeManifestString(entry?.package) || `${normalizeManifestString(entry?.packageName ?? entry?.package_name)}@${normalizeManifestString(entry?.packageVersion ?? entry?.package_version)}`,
        entry: normalizeManifestString(entry?.entryPath ?? entry?.entry_path),
        packageName: normalizeManifestString(entry?.packageName ?? entry?.package_name),
        packageVersion: normalizeManifestString(entry?.packageVersion ?? entry?.package_version),
        packageSubpath: normalizeManifestString(entry?.packageSubpath ?? entry?.package_subpath),
        topology,
        wrapperBytes,
        esmNativeBytes,
        esmNativeSlimBytes,
        deltaBytes,
        reachableFiles: normalizeManifestStringArray(reachableRaw),
        usedExports: normalizeManifestStringArray(exportDemandRaw),
        fallbackReason: topology === "wrapper" ? normalizeManifestString(entry?.artifactTopologyReason ?? entry?.artifact_topology_reason) : null
      };
    }).sort((a, b) => {
      const packageCompare = a.package.localeCompare(b.package);
      if (packageCompare !== 0) return packageCompare;
      return a.entry.localeCompare(b.entry);
    });
    const summary = entries.reduce(
      (acc, entry) => {
        acc.total += 1;
        if (entry.topology === "esm-native") acc.esmNative += 1;
        else if (entry.topology === "esm-native-slim") acc.esmNativeSlim += 1;
        else if (entry.topology === "wrapper") acc.wrapper += 1;
        if (typeof entry.wrapperBytes === "number") acc.wrapperBytes += entry.wrapperBytes;
        if (typeof entry.esmNativeBytes === "number") acc.esmNativeBytes += entry.esmNativeBytes;
        if (typeof entry.esmNativeSlimBytes === "number") acc.esmNativeSlimBytes += entry.esmNativeSlimBytes;
        return acc;
      },
      { total: 0, wrapper: 0, esmNative: 0, esmNativeSlim: 0, wrapperBytes: 0, esmNativeBytes: 0, esmNativeSlimBytes: 0 }
    );
    const artifactPath = path26.join(depsRoot, "gate3-profile.json");
    writeJsonFile2(artifactPath, {
      version: 1,
      diagnostic: true,
      valueBytesExcludeReports: true,
      depsHash: normalizeManifestString(parsed?.depsHash ?? parsed?.deps_hash),
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      summary,
      entries
    });
    return { bytes: statFileBytes(artifactPath) ?? 0, timeMs: Date.now() - started };
  } catch (err) {
    logWarn(`[deps] WARN: Failed to write Gate 3 profile artifact: ${String(err)}`);
    return { bytes: 0, timeMs: Date.now() - started };
  }
}
function writeDepsMeasurementArtifacts(depsRoot) {
  const started = Date.now();
  const gate3 = writeGate3ProfileArtifact(depsRoot);
  const gate4 = writeGate4ValueAccountingArtifact(depsRoot);
  if (!isBuildProfileEnabled()) return;
  logBuildProfileDuration("profileReportWriteTime", Date.now() - started);
  logBuildProfileValue("gate3ProfileBytes", gate3.bytes);
  logBuildProfileValue("gate4ValueAccountingBytes", gate4.bytes);
  logBuildProfileDuration("gate3ProfileWriteTime", gate3.timeMs);
  logBuildProfileDuration("gate4ValueAccountingWriteTime", gate4.timeMs);
}
function readDplSnapshotPublicationFacts(depsRoot, outputVersion = DEPS_OPTIMIZER_OUTPUT_VERSION) {
  const readActivePublications = native?.depsActivePublications;
  if (!readActivePublications) return null;
  try {
    const publications = readActivePublications(depsRoot);
    if (publications.some((publication) => publication.outputVersion !== outputVersion)) return null;
    return publications;
  } catch {
    return null;
  }
}
async function checkVerifiedDepsSnapshotFreshness(options) {
  if (!native?.depsRuntimeDemandCovered) {
    return { fresh: false, checked: 0, missing: [], reason: "dpl-demand-authority-unavailable" };
  }
  const demandFacts = await collectDplGenerationDemandFacts(options);
  if (!demandFacts.ok) return demandFacts.failure;
  try {
    const coverage = native.depsRuntimeDemandCovered(options.depsRoot, demandFacts.demands);
    if (!coverage.covered) {
      return {
        fresh: false,
        checked: coverage.checked,
        missing: [],
        reason: "dpl-runtime-demand-uncovered",
        detail: coverage.reason ?? void 0
      };
    }
    return { fresh: true, checked: coverage.checked, missing: [], reason: void 0 };
  } catch {
    return { fresh: false, checked: 0, missing: [], reason: "manifest-missing-or-invalid" };
  }
}
async function collectDplGenerationDemandFacts(options) {
  const usageEntries = await resolveUsageEntries(options.rootDir, options.resolvedEntries);
  if (usageEntries.length === 0) return { ok: true, demands: [] };
  let runtimeDemands = options.runtimeDemands;
  try {
    if (!runtimeDemands) {
      const coldPump = __c3ColdPumpDemand && __c3ColdPumpDemand.rootDir === options.rootDir ? __c3ColdPumpDemand : null;
      runtimeDemands = coldPump ? coldPump.demands : (await scanDepUsageFacts({
        rootDir: options.rootDir,
        entries: usageEntries,
        allowedRoots: options.allowedRoots
      })).runtimeDemands;
    }
  } catch {
    return {
      ok: false,
      failure: { fresh: false, checked: 0, missing: [], reason: "runtime-demand-scan-failed" }
    };
  }
  const optimizeExclude = Array.isArray(options.config?.optimizeDeps?.exclude) ? new Set(options.config.optimizeDeps.exclude.map((value) => String(value))) : null;
  return {
    ok: true,
    demands: runtimeDemands.filter((demand) => {
      if (!optimizeExclude || optimizeExclude.size === 0) return true;
      for (const excluded of optimizeExclude) {
        if (demand.specifier === excluded || demand.specifier.startsWith(`${excluded}/`)) return false;
      }
      return true;
    })
  };
}
async function publishVerifiedDepsGeneration(options) {
  const sentinelPath = path26.join(options.depsRoot, ".verified");
  const publishGeneration = native?.depsPublishVerifiedGeneration;
  if (!publishGeneration) {
    removeSnapshotMarker(sentinelPath);
    throw new Error("[deps] DPL generation publication authority is unavailable");
  }
  const demandFacts = await collectDplGenerationDemandFacts(options);
  if (!demandFacts.ok) {
    removeSnapshotMarker(sentinelPath);
    throw new Error(`[deps] Cannot publish DPL generation: ${demandFacts.failure.reason ?? "unknown"}`);
  }
  const coverage = publishGeneration(options.depsRoot, demandFacts.demands);
  if (!coverage.covered) {
    throw new Error(
      `[deps] DPL did not admit the optimized generation (dpl-runtime-demand-uncovered, checked=${coverage.checked}${coverage.reason ? `, detail=${coverage.reason}` : ""})`
    );
  }
  writeDepArtifactsToGlobalCache(
    options.depsHash,
    options.depsRoot,
    DEPS_OPTIMIZER_OUTPUT_VERSION
  );
}
async function verifyRestoredDepsSnapshot(options) {
  if (!removeSnapshotMarker(options.sentinelPath)) {
    throw new Error(
      `[Ionify] Cannot invalidate restored dependency marker ${options.sentinelPath}`
    );
  }
  const publishGeneration = native?.depsPublishVerifiedGeneration;
  if (!publishGeneration) return false;
  const demandFacts = await collectDplGenerationDemandFacts({
    rootDir: options.rootDir,
    resolvedEntries: options.resolvedEntries,
    allowedRoots: options.allowedRoots,
    config: options.config
  });
  if (!demandFacts.ok) {
    logWarn(
      `[deps] Restored global snapshot does not cover current demand (${demandFacts.failure.reason ?? "unknown"}); repairing`
    );
    return false;
  }
  try {
    const coverage = publishGeneration(options.depsRoot, demandFacts.demands);
    if (!coverage.covered) {
      logWarn(
        `[deps] Restored global snapshot does not cover current demand (dpl-runtime-demand-uncovered${coverage.reason ? `, detail=${coverage.reason}` : ""}); repairing`
      );
      return false;
    }
  } catch {
    return false;
  }
  return true;
}
function collectNativeExternalModules(plan, configuredExternals) {
  const externals = /* @__PURE__ */ new Set();
  for (const chunk of plan.chunks) {
    for (const mod of chunk.modules) {
      for (const dep of [...mod.deps ?? [], ...mod.dynamicDeps ?? []]) {
        if (isExternalGraphLeafId(dep, configuredExternals)) {
          externals.add(dep);
        }
      }
    }
  }
  return Array.from(externals).sort();
}
function rerouteDepsArtifacts(options) {
  const { plan, depsRoot, casRoot, configHash, workspaceRoot } = options;
  const depsArtifactsByEntry = /* @__PURE__ */ new Map();
  const publishedArtifacts = [];
  const readActivePublications = native?.depsActivePublications;
  if (!readActivePublications) {
    throw new Error("[deps] DPL publication-closure authority is unavailable");
  }
  try {
    const publications = readActivePublications(depsRoot);
    for (const publication of publications) {
      const outFile = publication.outFile;
      if (path26.basename(outFile) !== outFile || !outFile.endsWith(".js")) {
        throw new Error(`[deps] DPL published an invalid artifact path: ${outFile}`);
      }
      const artifactPath = path26.join(depsRoot, outFile);
      const topology = normalizeManifestString(publication.artifactTopology);
      const artifactTopology = topology === "esm-native" || topology === "esm-native-slim" || topology === "wrapper" ? topology : "wrapper";
      const exportAbi = publication.exportAbi;
      if (!exportAbi || !Number.isInteger(exportAbi.version) || exportAbi.version <= 0 || typeof exportAbi.abiHash !== "string" || exportAbi.abiHash.length === 0) {
        throw new Error(`[deps] DPL publication ${outFile} has no transportable export ABI`);
      }
      const dependencyAbi = {
        version: exportAbi.version,
        names: Array.from(new Set(exportAbi.names)).sort(),
        hasDefault: exportAbi.hasDefault,
        uncertain: exportAbi.uncertain,
        abiHash: exportAbi.abiHash,
        imports: publication.dependencyImportAbi.map((dependency) => ({
          outFile: dependency.outFile,
          mode: dependency.mode,
          names: Array.from(new Set(dependency.names)).sort(),
          hasDefault: dependency.hasDefault,
          hasNamespace: dependency.hasNamespace,
          hasSideEffect: dependency.hasSideEffect,
          hasExportStar: dependency.hasExportStar,
          uncertain: dependency.uncertain
        }))
      };
      const graphAbiByOutFile = new Map(
        publication.packageGraphFileAbi.map((file) => [file.outFile, file])
      );
      const artifact = {
        outFile,
        artifactPath,
        artifactHash: publication.artifactHash,
        artifactTopology,
        dependencyAbi,
        sharedImports: Array.from(new Set(publication.sharedImports)).sort(),
        dependencyImports: Array.from(new Set(publication.dependencyImports)).sort(),
        graphFiles: Array.from(new Set(publication.packageGraphFiles)).filter((graphOutFile) => graphOutFile !== outFile).sort().map((graphOutFile) => ({
          outFile: graphOutFile,
          artifactPath: path26.join(depsRoot, graphOutFile),
          dependencyAbi: {
            version: exportAbi.version,
            names: Array.from(new Set(graphAbiByOutFile.get(graphOutFile)?.exports ?? [])).sort(),
            hasDefault: (graphAbiByOutFile.get(graphOutFile)?.exports ?? []).includes("default"),
            uncertain: false,
            abiHash: exportAbi.abiHash,
            imports: []
          }
        }))
      };
      publishedArtifacts.push(artifact);
      for (const member of publication.publicationMembers ?? []) {
        const memberTopology = normalizeManifestString(member.artifactTopology);
        const artifactTopology2 = memberTopology === "esm-native" || memberTopology === "esm-native-slim" || memberTopology === "wrapper" ? memberTopology : "wrapper";
        const memberAbi = member.exportAbi;
        if (path26.basename(member.outFile) !== member.outFile || !member.outFile.endsWith(".js") || !member.artifactHash || !memberAbi || !Number.isInteger(memberAbi.version) || memberAbi.version <= 0 || !memberAbi.abiHash) {
          throw new Error(`[deps] DPL publication member ${member.outFile} has an invalid artifact contract`);
        }
        const memberDependencyAbi = {
          version: memberAbi.version,
          names: Array.from(new Set(memberAbi.names)).sort(),
          hasDefault: memberAbi.hasDefault,
          uncertain: memberAbi.uncertain,
          abiHash: memberAbi.abiHash,
          imports: member.dependencyImportAbi.map((dependency) => ({
            outFile: dependency.outFile,
            mode: dependency.mode,
            names: Array.from(new Set(dependency.names)).sort(),
            hasDefault: dependency.hasDefault,
            hasNamespace: dependency.hasNamespace,
            hasSideEffect: dependency.hasSideEffect,
            hasExportStar: dependency.hasExportStar,
            uncertain: dependency.uncertain
          }))
        };
        publishedArtifacts.push({
          outFile: member.outFile,
          artifactPath: path26.join(depsRoot, member.outFile),
          artifactHash: member.artifactHash,
          artifactTopology: artifactTopology2,
          dependencyAbi: memberDependencyAbi,
          sharedImports: [],
          dependencyImports: memberDependencyAbi.imports.map((dependency) => dependency.outFile),
          graphFiles: []
        });
      }
      if (!publication.routeActive) continue;
      const canonicalEntry = canonicalFsPath(publication.entryPath);
      if (depsArtifactsByEntry.has(canonicalEntry)) {
        throw new Error(`[deps] DPL published multiple active routes for ${publication.entryPath}`);
      }
      depsArtifactsByEntry.set(canonicalEntry, artifact);
    }
  } catch (error) {
    throw new Error(`[deps] Failed to consume DPL publication closure: ${String(error)}`);
  }
  if (depsArtifactsByEntry.size === 0)
    return { rerouted: 0, pruned: 0, sharedPrewarmed: 0, idRewritten: 0 };
  const depsArtifactsByOutFile = /* @__PURE__ */ new Map();
  for (const artifact of publishedArtifacts) {
    const existing = depsArtifactsByOutFile.get(artifact.outFile);
    if (existing) {
      const existingContract = JSON.stringify({
        hash: existing.artifactHash,
        topology: existing.artifactTopology,
        shared: existing.sharedImports,
        dependencies: existing.dependencyImports,
        graph: existing.graphFiles.map((file) => file.outFile),
        abi: existing.dependencyAbi.abiHash
      });
      const nextContract = JSON.stringify({
        hash: artifact.artifactHash,
        topology: artifact.artifactTopology,
        shared: artifact.sharedImports,
        dependencies: artifact.dependencyImports,
        graph: artifact.graphFiles.map((file) => file.outFile),
        abi: artifact.dependencyAbi.abiHash
      });
      if (existingContract !== nextContract) {
        throw new Error(`[deps] DPL publication conflict for ${artifact.outFile}`);
      }
      continue;
    }
    depsArtifactsByOutFile.set(artifact.outFile, artifact);
  }
  let rerouted = 0;
  let pruned = 0;
  let idRewritten = 0;
  const idRemap = /* @__PURE__ */ new Map();
  const claimedNewIds = /* @__PURE__ */ new Set();
  const dplArtifactByModuleId = /* @__PURE__ */ new Map();
  for (const chunk of plan.chunks) {
    const keptModules = [];
    for (const mod of chunk.modules) {
      let fsPath = typeof mod.fsPath === "string" && mod.fsPath.length > 0 ? mod.fsPath : null;
      if (!fsPath && typeof mod.id === "string" && mod.id.startsWith(WS_MODULE_PREFIX)) {
        fsPath = fromWsModuleId(mod.id, workspaceRoot);
      }
      if (!fsPath && typeof mod.id === "string" && path26.isAbsolute(mod.id)) {
        fsPath = mod.id;
      }
      let canonical = null;
      if (fsPath) {
        try {
          canonical = fs23.realpathSync.native(fsPath);
        } catch {
          canonical = path26.resolve(fsPath);
        }
      }
      const artifact = canonical ? depsArtifactsByEntry.get(canonical) : null;
      const isNodeModules = fsPath ? fsPath.includes("node_modules") : mod.id.includes("node_modules");
      if (!artifact && !isNodeModules) {
        if (mod.kind === "js") mod.proofKind = "TransformArtifactProof";
        keptModules.push(mod);
        continue;
      }
      if (artifact) {
        let resolvedHash;
        const artifactCasDir = artifact.artifactHash ? getCasArtifactPath(casRoot, configHash, artifact.artifactHash) : null;
        const artifactCasFile = artifactCasDir ? path26.join(artifactCasDir, "transformed.js") : null;
        if (artifact.artifactHash && artifactCasFile && fs23.existsSync(artifactCasFile) && casTextFileMatchesHash(artifactCasFile, artifact.artifactHash)) {
          resolvedHash = artifact.artifactHash;
        } else {
          const artifactCode = fs23.readFileSync(artifact.artifactPath, "utf8");
          resolvedHash = artifact.artifactHash || getCacheKey(artifactCode);
          const casDir = getCasArtifactPath(casRoot, configHash, resolvedHash);
          const casFile = path26.join(casDir, "transformed.js");
          fs23.mkdirSync(casDir, { recursive: true });
          fs23.writeFileSync(casFile, artifactCode, "utf8");
        }
        mod.fsPath = artifact.artifactPath;
        mod.hash = resolvedHash;
        mod.artifactTopology = artifact.artifactTopology;
        mod.dependencyAbi = artifact.dependencyAbi;
        mod.dependencyAbiHash = artifact.dependencyAbi.abiHash;
        mod.kind = "js";
        const oldId = typeof mod.id === "string" ? mod.id : null;
        let newId = null;
        try {
          newId = toWsModuleId(artifact.artifactPath, workspaceRoot);
        } catch {
          newId = null;
        }
        if (oldId && newId && oldId !== newId) {
          idRemap.set(oldId, newId);
          if (claimedNewIds.has(newId)) {
            pruned += 1;
            continue;
          }
          claimedNewIds.add(newId);
          mod.id = newId;
          idRewritten += 1;
        }
        if (newId) dplArtifactByModuleId.set(newId, artifact);
        mod.proofKind = "DplContentHash";
        keptModules.push(mod);
        rerouted += 1;
      } else {
        pruned += 1;
      }
    }
    chunk.modules = keptModules;
  }
  if (idRemap.size > 0 || pruned > 0) {
    const remapDepList = (list) => {
      const out = [];
      const seen = /* @__PURE__ */ new Set();
      for (const dep of list) {
        let mapped = dep;
        if (idRemap.has(dep)) {
          mapped = idRemap.get(dep);
        } else if (typeof dep === "string" && dep.includes("node_modules")) {
          mapped = null;
        }
        if (mapped && !seen.has(mapped)) {
          seen.add(mapped);
          out.push(mapped);
        }
      }
      return out;
    };
    for (const chunk of plan.chunks) {
      for (const mod of chunk.modules) {
        if (Array.isArray(mod.deps)) mod.deps = remapDepList(mod.deps);
        if (Array.isArray(mod.dynamicDeps)) {
          mod.dynamicDeps = remapDepList(mod.dynamicDeps);
        }
        if (Array.isArray(mod.runtimeLinks)) {
          mod.runtimeLinks = mod.runtimeLinks.flatMap((link) => {
            const [targetId] = remapDepList([link.targetId]);
            return targetId ? [{ ...link, targetId }] : [];
          });
        }
      }
    }
  }
  let sharedPrewarmed = 0;
  const owners = /* @__PURE__ */ new Map();
  for (const chunk of plan.chunks) {
    for (const mod of chunk.modules) {
      const existing = owners.get(mod.id);
      if (existing && dplArtifactByModuleId.has(mod.id)) {
        throw new Error(`[deps] DPL artifact has multiple plan owners: ${mod.id}`);
      }
      if (!existing) owners.set(mod.id, { chunk, mod });
    }
  }
  const moduleIdForOutFile = (outFile) => {
    if (path26.basename(outFile) !== outFile || !outFile.endsWith(".js")) {
      throw new Error(`[deps] Invalid DPL topology outFile: ${outFile}`);
    }
    const artifactPath = path26.join(depsRoot, outFile);
    return toWsModuleId(artifactPath, workspaceRoot) ?? artifactPath;
  };
  const hydrateArtifact = (artifactPath, expectedHash = "") => {
    if (!fs23.existsSync(artifactPath)) {
      throw new Error(`[deps] DPL topology artifact is missing: ${path26.basename(artifactPath)}`);
    }
    const code = fs23.readFileSync(artifactPath, "utf8");
    const hash = getCacheKey(code);
    if (expectedHash && expectedHash !== hash) {
      throw new Error(`[deps] DPL artifact hash mismatch: ${path26.basename(artifactPath)}`);
    }
    const casDir = getCasArtifactPath(casRoot, configHash, hash);
    const casFile = path26.join(casDir, "transformed.js");
    if (!fs23.existsSync(casFile) || !casTextFileMatchesHash(casFile, hash)) {
      fs23.mkdirSync(casDir, { recursive: true });
      fs23.writeFileSync(casFile, code, "utf8");
    }
    return hash;
  };
  const queue = Array.from(dplArtifactByModuleId.keys());
  const visited = /* @__PURE__ */ new Set();
  const sharedInjected = /* @__PURE__ */ new Set();
  while (queue.length > 0) {
    const moduleId = queue.shift();
    if (!visited.add(moduleId)) continue;
    const artifact = dplArtifactByModuleId.get(moduleId);
    const owner = owners.get(moduleId);
    if (!artifact || !owner) {
      throw new Error(`[deps] DPL topology owner is missing for ${moduleId}`);
    }
    const declared = [
      ...artifact.dependencyImports.map((outFile) => ({
        outFile,
        kind: "dependency",
        dependencyAbi: void 0
      })),
      ...artifact.sharedImports.map((outFile) => ({
        outFile,
        kind: "shared",
        dependencyAbi: void 0
      })),
      ...artifact.graphFiles.map((file) => ({
        outFile: file.outFile,
        kind: "graph",
        dependencyAbi: file.dependencyAbi
      }))
    ];
    const dependencyIds = [];
    for (const target of declared) {
      const targetPath = path26.join(depsRoot, target.outFile);
      const targetId = moduleIdForOutFile(target.outFile);
      dependencyIds.push(targetId);
      const targetArtifact = depsArtifactsByOutFile.get(target.outFile);
      if (target.kind === "dependency" && !targetArtifact) {
        throw new Error(`[deps] DPL dependencyImport is unpublished: ${target.outFile}`);
      }
      if (!owners.has(targetId)) {
        const hash = hydrateArtifact(targetPath, targetArtifact?.artifactHash ?? "");
        const targetModule = {
          id: targetId,
          fsPath: targetPath,
          hash,
          kind: "js",
          deps: [],
          dynamicDeps: [],
          artifactTopology: targetArtifact?.artifactTopology ?? (target.kind === "graph" ? "esm-native" : void 0),
          dependencyAbi: targetArtifact?.dependencyAbi ?? target.dependencyAbi,
          dependencyAbiHash: targetArtifact?.dependencyAbi.abiHash ?? target.dependencyAbi?.abiHash,
          // G2-C3: DPL-injected dependency/shared/graph target → DPL contract.
          proofKind: "DplContentHash"
        };
        owner.chunk.modules.push(targetModule);
        owners.set(targetId, { chunk: owner.chunk, mod: targetModule });
        if (target.kind === "shared" && sharedInjected.add(targetId)) sharedPrewarmed += 1;
      }
      if (targetArtifact) {
        dplArtifactByModuleId.set(targetId, targetArtifact);
        queue.push(targetId);
      }
    }
    owner.mod.deps = Array.from(new Set(dependencyIds));
    owner.mod.dynamicDeps = [];
  }
  return { rerouted, pruned, sharedPrewarmed, idRewritten };
}
function stablePlanChunkId(prefix, moduleIds) {
  const sorted = [...moduleIds].sort();
  const digest = crypto6.createHash("sha256").update(sorted.join("")).digest("hex");
  return `${prefix}-${digest.slice(0, 8)}`;
}
function estimateCanonicalPlanModuleBytes(mod, workspaceRoot) {
  let fsPath = typeof mod.fsPath === "string" && mod.fsPath.length > 0 ? mod.fsPath : "";
  if (!fsPath && typeof mod.id === "string" && mod.id.startsWith(WS_MODULE_PREFIX)) {
    fsPath = fromWsModuleId(mod.id, workspaceRoot) ?? "";
  }
  if (!fsPath && typeof mod.id === "string" && path26.isAbsolute(mod.id)) {
    fsPath = mod.id;
  }
  if (!fsPath || !path26.isAbsolute(fsPath)) return 1;
  try {
    const stat = fs23.statSync(fsPath);
    return Math.max(1, stat.size);
  } catch {
    return 1;
  }
}
function buildDepsArtifactCostIndex(depsRoot) {
  const out = /* @__PURE__ */ new Map();
  const manifestPath = path26.join(depsRoot, "manifest.json");
  if (!fs23.existsSync(manifestPath)) return out;
  try {
    const parsed = JSON.parse(fs23.readFileSync(manifestPath, "utf8"));
    const entries = parsed?.entries ?? {};
    for (const entry of Object.values(entries)) {
      const outFile = entry?.outFile ?? entry?.out_file;
      if (typeof outFile !== "string" || outFile.length === 0) continue;
      const chunkGroupRaw = entry?.chunkGroup ?? entry?.chunk_group;
      const declaredChunkGroup = typeof chunkGroupRaw === "string" && chunkGroupRaw.length > 0 ? chunkGroupRaw : null;
      const packageGraph = entry?.packageGraph ?? entry?.package_graph;
      const packageGraphFiles = packageGraph && packageGraph.status === "ready" && Array.isArray(packageGraph.files) ? packageGraph.files : [];
      const chunkGroup = declaredChunkGroup ?? (packageGraphFiles.length > 0 ? `package-graph:${outFile}` : null);
      const fact = {
        chunkGroup,
        dependencies: [
          ...Array.isArray(entry?.dependencyImports) ? entry.dependencyImports.map((dependency) => dependency?.outFile ?? dependency?.out_file).filter((file) => typeof file === "string" && file.endsWith(".js")) : [],
          ...Array.isArray(entry?.sharedImports) ? entry.sharedImports.filter(
            (file) => typeof file === "string" && file.endsWith(".js")
          ) : []
        ]
      };
      out.set(outFile, fact);
      if (chunkGroup && packageGraphFiles.length > 0) {
        for (const graphFile of packageGraphFiles) {
          const graphOutFile = graphFile?.outFile ?? graphFile?.out_file;
          if (typeof graphOutFile !== "string" || !graphOutFile.endsWith(".js")) continue;
          const existing = out.get(graphOutFile);
          if (existing?.chunkGroup && existing.chunkGroup !== chunkGroup) {
            existing.chunkGroup = null;
            continue;
          }
          out.set(graphOutFile, {
            chunkGroup,
            dependencies: existing?.dependencies ?? []
          });
        }
      }
      const chunkFilesRaw = entry?.chunkFiles ?? entry?.chunk_files;
      if (declaredChunkGroup && Array.isArray(chunkFilesRaw)) {
        for (const chunkFile of chunkFilesRaw) {
          if (typeof chunkFile !== "string" || !chunkFile.endsWith(".js")) continue;
          const existing = out.get(chunkFile);
          if (existing && existing.chunkGroup && existing.chunkGroup !== declaredChunkGroup) {
            existing.chunkGroup = null;
            continue;
          }
          out.set(chunkFile, {
            chunkGroup: declaredChunkGroup,
            dependencies: existing?.dependencies ?? []
          });
        }
      }
    }
  } catch {
    return out;
  }
  return out;
}
function orderCanonicalVendorPlanningUnits(units) {
  if (units.length < 2) return units;
  const unitByOutFile = /* @__PURE__ */ new Map();
  units.forEach((unit, index) => {
    for (const outFile of unit.outFiles) unitByOutFile.set(outFile, index);
  });
  const edges = units.map(() => /* @__PURE__ */ new Set());
  units.forEach((unit, index) => {
    for (const dependency of unit.dependencies) {
      const target = unitByOutFile.get(dependency);
      if (target !== void 0 && target !== index) edges[index].add(target);
    }
  });
  let nextIndex = 0;
  const indices = new Array(units.length).fill(-1);
  const lowLinks = new Array(units.length).fill(0);
  const stack = [];
  const onStack = new Array(units.length).fill(false);
  const components = [];
  const visit = (node) => {
    indices[node] = nextIndex;
    lowLinks[node] = nextIndex;
    nextIndex += 1;
    stack.push(node);
    onStack[node] = true;
    for (const target of edges[node]) {
      if (indices[target] === -1) {
        visit(target);
        lowLinks[node] = Math.min(lowLinks[node], lowLinks[target]);
      } else if (onStack[target]) {
        lowLinks[node] = Math.min(lowLinks[node], indices[target]);
      }
    }
    if (lowLinks[node] !== indices[node]) return;
    const component = [];
    while (stack.length > 0) {
      const member = stack.pop();
      onStack[member] = false;
      component.push(member);
      if (member === node) break;
    }
    component.sort((a, b) => units[a].order - units[b].order);
    components.push(component);
  };
  for (let index = 0; index < units.length; index += 1) {
    if (indices[index] === -1) visit(index);
  }
  const componentByUnit = new Array(units.length);
  components.forEach((component, componentIndex) => {
    for (const unitIndex of component) componentByUnit[unitIndex] = componentIndex;
  });
  const merged = components.map((component) => {
    const members = component.map((index) => units[index]);
    return {
      modules: members.flatMap((unit) => unit.modules),
      cost: members.reduce((sum, unit) => sum + unit.cost, 0),
      outFiles: new Set(members.flatMap((unit) => [...unit.outFiles])),
      dependencies: new Set(members.flatMap((unit) => [...unit.dependencies])),
      order: Math.min(...members.map((unit) => unit.order))
    };
  });
  const consumers = merged.map(() => /* @__PURE__ */ new Set());
  const indegree = new Array(merged.length).fill(0);
  edges.forEach((targets, sourceUnit) => {
    const source = componentByUnit[sourceUnit];
    for (const targetUnit of targets) {
      const dependency = componentByUnit[targetUnit];
      if (source === dependency || consumers[dependency].has(source)) continue;
      consumers[dependency].add(source);
      indegree[source] += 1;
    }
  });
  const ready = merged.map((_, index) => index).filter((index) => indegree[index] === 0).sort((a, b) => merged[a].order - merged[b].order);
  const ordered = [];
  while (ready.length > 0) {
    const component = ready.shift();
    ordered.push(merged[component]);
    for (const consumer of consumers[component]) {
      indegree[consumer] -= 1;
      if (indegree[consumer] === 0) {
        ready.push(consumer);
        ready.sort((a, b) => merged[a].order - merged[b].order);
      }
    }
  }
  return ordered.length === merged.length ? ordered : merged.sort((a, b) => a.order - b.order);
}
function expandCanonicalVendorPlanningDependencies(units, costIndex) {
  const plannedOutFiles = /* @__PURE__ */ new Set();
  for (const unit of units) {
    for (const outFile of unit.outFiles) plannedOutFiles.add(outFile);
  }
  const memo = /* @__PURE__ */ new Map();
  const resolving = /* @__PURE__ */ new Set();
  const resolveToPlanned = (outFile) => {
    if (plannedOutFiles.has(outFile)) return /* @__PURE__ */ new Set([outFile]);
    const cached = memo.get(outFile);
    if (cached) return cached;
    if (resolving.has(outFile)) return /* @__PURE__ */ new Set();
    const fact = costIndex.get(outFile);
    if (!fact) return /* @__PURE__ */ new Set();
    resolving.add(outFile);
    const resolved = /* @__PURE__ */ new Set();
    for (const dependency of fact.dependencies) {
      for (const planned of resolveToPlanned(dependency)) resolved.add(planned);
    }
    resolving.delete(outFile);
    memo.set(outFile, resolved);
    return resolved;
  };
  for (const unit of units) {
    const expanded = /* @__PURE__ */ new Set();
    for (const dependency of unit.dependencies) {
      for (const planned of resolveToPlanned(dependency)) expanded.add(planned);
    }
    unit.dependencies = expanded;
  }
}
function canonicalPlanModuleCost(mod, workspaceRoot) {
  const bytes = estimateCanonicalPlanModuleBytes(mod, workspaceRoot);
  return { bytes, cost: bytes };
}
function rebalanceCanonicalVendorChunks(options) {
  const maxBytes = typeof options.maxBytes === "number" && options.maxBytes > 0 ? options.maxBytes : null;
  if (maxBytes === null) return { before: 0, after: 0, modules: 0, totalEstimatedBytes: 0 };
  const vendorEntries = options.plan.chunks.map((chunk, index) => ({ chunk, index })).filter(({ chunk }) => chunk.id.startsWith("chunk-vendor"));
  if (vendorEntries.length === 0) return { before: 0, after: 0, modules: 0, totalEstimatedBytes: 0 };
  const seenModules = /* @__PURE__ */ new Set();
  const vendorModules = [];
  const consumers = /* @__PURE__ */ new Set();
  for (const { chunk } of vendorEntries) {
    for (const consumer of chunk.consumers ?? []) consumers.add(consumer);
    for (const mod of chunk.modules) {
      if (seenModules.has(mod.id)) continue;
      seenModules.add(mod.id);
      vendorModules.push(mod);
    }
  }
  if (vendorModules.length === 0) {
    return { before: vendorEntries.length, after: 0, modules: 0, totalEstimatedBytes: 0 };
  }
  const costIndex = buildDepsArtifactCostIndex(options.depsRoot);
  const estimated = vendorModules.map((mod) => ({
    mod,
    ...canonicalPlanModuleCost(mod, options.workspaceRoot),
    outFile: path26.basename(mod.id),
    chunkGroup: costIndex.get(path26.basename(mod.id))?.chunkGroup ?? null,
    dependencies: costIndex.get(path26.basename(mod.id))?.dependencies ?? []
  }));
  const totalEstimatedBytes = estimated.reduce((sum, entry) => sum + entry.bytes, 0);
  const totalPlanningCost = estimated.reduce((sum, entry) => sum + entry.cost, 0);
  const planningUnits = [];
  const unitByKey = /* @__PURE__ */ new Map();
  for (const [order, entry] of estimated.entries()) {
    const key = entry.chunkGroup ? `dpl:${entry.chunkGroup}` : `module:${entry.mod.id}`;
    let unit = unitByKey.get(key);
    if (!unit) {
      unit = { modules: [], cost: 0, outFiles: /* @__PURE__ */ new Set(), dependencies: /* @__PURE__ */ new Set(), order };
      unitByKey.set(key, unit);
      planningUnits.push(unit);
    }
    unit.modules.push(entry.mod);
    unit.cost += entry.cost;
    unit.outFiles.add(entry.outFile);
    for (const dependency of entry.dependencies) unit.dependencies.add(dependency);
  }
  expandCanonicalVendorPlanningDependencies(planningUnits, costIndex);
  const orderedUnits = orderCanonicalVendorPlanningUnits(planningUnits);
  const binCountFor = (cap) => {
    let bins = 0;
    let cost = 0;
    let open = false;
    for (const unit of orderedUnits) {
      if (open && cost + unit.cost > cap) {
        open = false;
        cost = 0;
      }
      if (!open) {
        bins += 1;
        open = true;
      }
      cost += unit.cost;
    }
    return bins;
  };
  const targetBins = binCountFor(maxBytes);
  let low = 1;
  let high = Math.min(
    maxBytes,
    orderedUnits.reduce((sum, unit) => sum + unit.cost, 0)
  );
  let balancedCap = high;
  while (low <= high) {
    const cap = Math.floor((low + high) / 2);
    if (binCountFor(cap) <= targetBins) {
      balancedCap = cap;
      high = cap - 1;
    } else {
      low = cap + 1;
    }
  }
  const groups = [];
  let current = [];
  let currentCost = 0;
  for (const unit of orderedUnits) {
    if (current.length > 0 && currentCost + unit.cost > balancedCap) {
      groups.push(current);
      current = [];
      currentCost = 0;
    }
    current.push(...unit.modules);
    currentCost += unit.cost;
  }
  if (current.length > 0) groups.push(current);
  const sortedConsumers = Array.from(consumers).sort();
  const nextVendorChunks = groups.map((modules) => ({
    id: stablePlanChunkId("chunk-vendor", modules.map((mod) => mod.id)),
    modules,
    entry: false,
    shared: true,
    consumers: sortedConsumers,
    css: modules.filter((mod) => mod.kind === "css").map((mod) => mod.id).sort(),
    assets: modules.filter((mod) => mod.kind === "asset").map((mod) => mod.id).sort()
  }));
  const firstVendorIndex = vendorEntries[0].index;
  const vendorIndexSet = new Set(vendorEntries.map(({ index }) => index));
  const nextChunks = options.plan.chunks.filter((_, index) => !vendorIndexSet.has(index));
  nextChunks.splice(firstVendorIndex, 0, ...nextVendorChunks);
  options.plan.chunks = nextChunks;
  if (isBuildProfileEnabled()) {
    const top = estimated.slice().sort((a, b) => b.bytes - a.bytes || a.mod.id.localeCompare(b.mod.id)).slice(0, 8).map((entry) => `${entry.mod.id}=${entry.bytes}/${entry.cost}`).join(",");
    logInfo(
      `[BuildProfile][canonicalVendorRebalance] before=${vendorEntries.length} after=${nextVendorChunks.length} modules=${vendorModules.length} maxBytes=${maxBytes} totalEstimatedBytes=${totalEstimatedBytes} totalPlanningCost=${totalPlanningCost} top=${top}`
    );
  }
  return {
    before: vendorEntries.length,
    after: nextVendorChunks.length,
    modules: vendorModules.length,
    totalEstimatedBytes
  };
}
async function prepareCanonicalProductionDependencyPlan(options) {
  const coverageRepairStart = Date.now();
  if (!options.skipDependencyCoverageRepair) {
    await repairMissingPlanDependencyArtifacts({
      plan: options.plan,
      rootDir: options.rootDir,
      ionifyDir: options.ionifyDir,
      depsRoot: options.depsRoot,
      depsHash: options.depsHash,
      resolvedEntries: options.resolvedEntries,
      allowedRoots: options.allowedRoots,
      workspaceRoot: options.workspaceRoot,
      config: options.config
    });
  }
  logBuildProfile("dependencyCoverageRepair", coverageRepairStart);
  writeDepsMeasurementArtifacts(options.depsRoot);
  const rerouteStart = Date.now();
  const { rerouted, pruned, sharedPrewarmed, idRewritten } = rerouteDepsArtifacts({
    plan: options.plan,
    depsRoot: options.depsRoot,
    casRoot: options.casRoot,
    configHash: options.configHash,
    workspaceRoot: options.workspaceRoot
  });
  const rebalance = rebalanceCanonicalVendorChunks({
    plan: options.plan,
    depsRoot: options.depsRoot,
    workspaceRoot: options.workspaceRoot,
    maxBytes: options.vendorMaxBytes
  });
  const rerouteMs = Date.now() - rerouteStart;
  return {
    rerouted,
    pruned,
    sharedPrewarmed,
    idRewritten,
    rerouteMs,
    rebalancedVendorChunks: rebalance.after
  };
}
async function repairMissingPlanDependencyArtifacts(options) {
  if (!native?.optimizeDependenciesBatch && !native?.optimizeDependency) return;
  const coveredEntryPaths = /* @__PURE__ */ new Set();
  const demandlessWrapperByEntryPath = /* @__PURE__ */ new Map();
  const readActivePublications = native?.depsActivePublications;
  if (!readActivePublications) {
    throw new Error("[deps] DPL publication-closure authority is unavailable during plan coverage repair");
  }
  const currentPublications = readActivePublications(options.depsRoot);
  for (const publication of currentPublications) {
    if (!publication.routeActive || !publication.entryPath) continue;
    const canonical = canonicalFsPath(publication.entryPath);
    coveredEntryPaths.add(canonical);
    if (publication.artifactTopologyReason === "package-graph-no-export-demand") {
      demandlessWrapperByEntryPath.set(canonical, publication.entryPath);
    }
  }
  const missing = /* @__PURE__ */ new Set();
  const demandlessInPlan = /* @__PURE__ */ new Set();
  for (const chunk of options.plan.chunks) {
    for (const mod of chunk.modules) {
      let fsPath = typeof mod.fsPath === "string" && mod.fsPath.length > 0 ? mod.fsPath : null;
      if (!fsPath && typeof mod.id === "string" && mod.id.startsWith(WS_MODULE_PREFIX)) {
        fsPath = fromWsModuleId(mod.id, options.workspaceRoot);
      }
      if (!fsPath && typeof mod.id === "string" && path26.isAbsolute(mod.id)) {
        fsPath = mod.id;
      }
      if (!fsPath || !fsPath.includes(`${path26.sep}node_modules${path26.sep}`)) continue;
      if (!isOptimizableDepEntryPath(fsPath)) continue;
      const canonical = canonicalFsPath(fsPath);
      if (!coveredEntryPaths.has(canonical)) missing.add(canonical);
      else if (demandlessWrapperByEntryPath.has(canonical)) demandlessInPlan.add(canonical);
    }
  }
  if (missing.size === 0 && demandlessInPlan.size === 0) return;
  fs23.mkdirSync(options.depsRoot, { recursive: true });
  const dplDemand = await scanDplUsageDemand({
    rootDir: options.rootDir,
    depsRoot: options.depsRoot,
    depsHash: options.depsHash,
    resolvedEntries: options.resolvedEntries,
    allowedRoots: options.allowedRoots
  });
  if (dplDemand.demandByEntryPath.size > 0) {
    for (const canonical of demandlessInPlan) missing.add(canonical);
  }
  if (missing.size === 0) return;
  const sentinelPath = path26.join(options.depsRoot, ".verified");
  try {
    fs23.unlinkSync(sentinelPath);
  } catch {
  }
  const repairEntries = Array.from(missing).map(
    (entryPath) => withDplUsageDemand(entryPath, options.depsHash, dplDemand.demandByEntryPath)
  );
  let failed = 0;
  let singleRepairEntries = [];
  if (native?.optimizeDependenciesBatch) {
    try {
      const results = native.optimizeDependenciesBatch(repairEntries, options.ionifyDir) ?? [];
      for (let index = 0; index < repairEntries.length; index++) {
        const result = results[index];
        if (result?.error) {
          failed += 1;
          singleRepairEntries.push(repairEntries[index]);
        }
      }
    } catch (err) {
      failed = repairEntries.length;
      singleRepairEntries = repairEntries.slice();
      logWarn(`[deps] WARN: Plan dependency coverage repair batch failed: ${String(err)}`);
    }
  } else {
    singleRepairEntries = repairEntries.slice();
  }
  if (singleRepairEntries.length > 0 && native?.optimizeDependency) {
    let singleFailures = 0;
    for (const entry of singleRepairEntries) {
      try {
        native.optimizeDependency(entry.entryPath, options.depsHash, false, true, options.ionifyDir);
      } catch {
        singleFailures += 1;
      }
    }
    failed = singleFailures;
  }
  const repairedEntryPaths = /* @__PURE__ */ new Set();
  const repairedPublications = readActivePublications(options.depsRoot);
  for (const publication of repairedPublications) {
    if (!publication.routeActive || !publication.entryPath) continue;
    repairedEntryPaths.add(canonicalFsPath(publication.entryPath));
  }
  const stillMissing = repairEntries.filter((entry) => !repairedEntryPaths.has(canonicalFsPath(entry.entryPath)));
  if (failed === 0 && stillMissing.length === 0) {
    await publishVerifiedDepsGeneration({
      rootDir: options.rootDir,
      depsRoot: options.depsRoot,
      depsHash: options.depsHash,
      resolvedEntries: options.resolvedEntries,
      allowedRoots: options.allowedRoots,
      config: options.config,
      runtimeDemands: dplDemand.runtimeDemands ?? void 0
    });
    logInfo(`[deps] Repaired ${repairEntries.length} plan dependency artifact(s) before canonical reroute`);
  } else {
    const failedLabel = failed > 0 ? `, failed=${failed}` : "";
    const sample = stillMissing.slice(0, 5).map((entry) => path26.basename(entry.entryPath)).join(", ");
    logWarn(
      `[deps] WARN: Plan dependency coverage repair incomplete (missing=${stillMissing.length}${failedLabel}${sample ? `, sample=${sample}` : ""}); DBI will fail closed if raw deps remain`
    );
  }
}
function casTextFileMatchesHash(filePath, expectedHash) {
  try {
    return getCacheKey(fs23.readFileSync(filePath, "utf8")) === expectedHash;
  } catch {
    return false;
  }
}
function computeBuildSlimmingSavedPercent(depsRoot, depsHash) {
  let entries = [];
  try {
    entries = fs23.readdirSync(depsRoot);
  } catch {
    return null;
  }
  let totalFull = 0;
  let totalSlim = 0;
  const slimFiles = entries.filter((name) => name.startsWith("vendor-pack.manual.") && name.endsWith(".slim.json"));
  for (const fileName of slimFiles) {
    const group = fileName.slice("vendor-pack.manual.".length, -".slim.json".length);
    if (!group) continue;
    const baseStatePath = path26.join(depsRoot, `vendor-pack.manual.${group}.json`);
    const slimStatePath = path26.join(depsRoot, fileName);
    if (!fs23.existsSync(baseStatePath) || !fs23.existsSync(slimStatePath)) continue;
    try {
      const base = JSON.parse(fs23.readFileSync(baseStatePath, "utf8"));
      const slim = JSON.parse(fs23.readFileSync(slimStatePath, "utf8"));
      if (!base || !slim) continue;
      if (base.depsHash !== depsHash || slim.depsHash !== depsHash) continue;
      if (base.status !== "ready" || slim.status !== "ready") continue;
      const fullShared = typeof base.sharedFileName === "string" ? base.sharedFileName : null;
      const slimShared = typeof slim.sharedFileName === "string" ? slim.sharedFileName : null;
      if (!fullShared || !slimShared) continue;
      const fullPath = path26.join(depsRoot, fullShared);
      const slimPath = path26.join(depsRoot, slimShared);
      if (!fs23.existsSync(fullPath) || !fs23.existsSync(slimPath)) continue;
      const fullBytes = fs23.statSync(fullPath).size;
      const slimBytes = fs23.statSync(slimPath).size;
      if (fullBytes > 0 && slimBytes > 0 && slimBytes <= fullBytes) {
        totalFull += fullBytes;
        totalSlim += slimBytes;
      }
    } catch {
    }
  }
  if (totalFull <= 0 || totalSlim <= 0) return null;
  const saved = totalFull - totalSlim;
  if (saved <= 0) return 0;
  return Math.round(saved * 100 / totalFull);
}
function computeBuildVendorPackRequestsSavedPercent(depsRoot, depsHash) {
  const indexPath = path26.join(depsRoot, "vendor-pack.v2.index.json");
  if (!fs23.existsSync(indexPath)) return null;
  try {
    const raw = JSON.parse(fs23.readFileSync(indexPath, "utf8"));
    if (!raw || raw.version !== 1 || raw.depsHash !== depsHash) return null;
    const fileMap = raw.fileNameToPackFile;
    if (!fileMap || typeof fileMap !== "object") return null;
    const memberFiles = Object.keys(fileMap).filter((k) => typeof k === "string" && k.endsWith(".js"));
    const baseline = memberFiles.length;
    if (baseline === 0) return null;
    const packFiles = /* @__PURE__ */ new Set();
    for (const fileName of memberFiles) {
      const packFile = fileMap[fileName];
      if (typeof packFile === "string" && packFile.endsWith(".js")) {
        packFiles.add(packFile);
      }
    }
    const chunkMap = raw.packFileToChunkFiles ?? null;
    const sharedMap = raw.packFileToSharedFile ?? null;
    const chunks = /* @__PURE__ */ new Set();
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
    return Math.round(saved * 100 / baseline);
  } catch {
    return null;
  }
}
function dplArtifactRelativePath(depsRoot, artifactPath) {
  const absolute = path26.resolve(artifactPath);
  const relative = path26.relative(path26.resolve(depsRoot), absolute);
  if (!relative || path26.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path26.sep}`)) {
    return null;
  }
  return toPosixPath2(relative);
}
function validateDplArtifactClosure(depsRoot, files) {
  const normalized = [];
  const seen = /* @__PURE__ */ new Set();
  for (const file of files) {
    const value = toPosixPath2(String(file).trim());
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  if (normalized.length === 0) return null;
  for (const file of normalized) {
    const relative = path26.normalize(file);
    if (path26.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path26.sep}`)) return null;
    if (!relative.endsWith(".js") || !fs23.existsSync(path26.join(depsRoot, relative))) return null;
  }
  return normalized;
}
function sameStringSet(left, right) {
  if (left.length !== right.length) return false;
  const leftSorted = Array.from(new Set(left)).sort();
  const rightSorted = Array.from(new Set(right)).sort();
  return leftSorted.length === rightSorted.length && leftSorted.every((value, index) => value === rightSorted[index]);
}
function resolveDplChunkedPackPublication(options) {
  const { depsRoot, requests, result } = options;
  const chunkGroupId = String(result.chunkGroup ?? result.chunk_group ?? "").trim();
  const chunkFiles = validateDplArtifactClosure(
    depsRoot,
    Array.isArray(result.chunkFiles) ? result.chunkFiles : Array.isArray(result.chunk_files) ? result.chunk_files : []
  );
  if (!chunkGroupId || !chunkFiles) return null;
  const publications = Array.isArray(result.entries) ? result.entries : [];
  if (publications.length !== requests.length) return null;
  const byEntryPath = /* @__PURE__ */ new Map();
  for (const publication of publications) {
    const entryPath = publication.entryPath ?? publication.entry_path;
    const outPath = publication.outPath ?? publication.out_path;
    if (typeof entryPath !== "string" || typeof outPath !== "string") return null;
    const key = canonicalFsPath(entryPath);
    const fileName = dplArtifactRelativePath(depsRoot, outPath);
    if (!fileName || !fileName.endsWith(".js") || !fs23.existsSync(path26.join(depsRoot, fileName))) return null;
    if (byEntryPath.has(key)) return null;
    byEntryPath.set(key, fileName);
  }
  const entries = [];
  const seenRequests = /* @__PURE__ */ new Set();
  for (const request of requests) {
    const key = canonicalFsPath(request.entryPath);
    if (seenRequests.has(key)) return null;
    seenRequests.add(key);
    const fileName = byEntryPath.get(key);
    if (!fileName) return null;
    entries.push({ ...request, entryPath: key, fileName });
  }
  if (seenRequests.size !== byEntryPath.size) return null;
  return {
    chunkGroupId,
    chunkFiles,
    sharedFileName: chunkFiles[0],
    entries
  };
}
function readDplChunkedPackPublication(options) {
  const { depsRoot, requests, nodeEnv } = options;
  const readActivePublications = native?.depsActivePublications;
  if (!readActivePublications) return null;
  let publications;
  try {
    publications = readActivePublications(depsRoot);
  } catch {
    return null;
  }
  const byEntryPath = /* @__PURE__ */ new Map();
  for (const publication of publications) {
    if (!publication.routeActive) continue;
    const key = canonicalFsPath(publication.entryPath);
    if (byEntryPath.has(key)) return null;
    byEntryPath.set(key, publication);
  }
  let chunkGroupId = null;
  let chunkFiles = null;
  const entries = [];
  const seenRequests = /* @__PURE__ */ new Set();
  for (const request of requests) {
    const key = canonicalFsPath(request.entryPath);
    if (seenRequests.has(key)) return null;
    seenRequests.add(key);
    const publication = byEntryPath.get(key);
    if (!publication) return null;
    const fileName = publication.outFile;
    if (!publication.chunkGroup || publication.outputVersion !== DEPS_OPTIMIZER_OUTPUT_VERSION || publication.nodeEnv.toLowerCase() !== nodeEnv.toLowerCase() || !fs23.existsSync(path26.join(depsRoot, fileName))) {
      return null;
    }
    const publicationChunkFiles = validateDplArtifactClosure(depsRoot, publication.chunkFiles);
    if (!publicationChunkFiles) return null;
    if (chunkGroupId === null) {
      chunkGroupId = publication.chunkGroup;
      chunkFiles = publicationChunkFiles;
    } else if (chunkGroupId !== publication.chunkGroup || !sameStringSet(chunkFiles ?? [], publicationChunkFiles)) {
      return null;
    }
    entries.push({ ...request, entryPath: key, fileName });
  }
  if (!chunkGroupId || !chunkFiles || entries.length !== requests.length) return null;
  return {
    chunkGroupId,
    chunkFiles,
    sharedFileName: chunkFiles[0],
    entries
  };
}
function normalizeManualPackGroup(raw) {
  const base = String(raw ?? "").trim().toLowerCase();
  if (!base) return null;
  const normalized = base.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
  return normalized || null;
}
function normalizeMatchSubpath(subpath) {
  if (!subpath) return null;
  const cleaned = String(subpath).trim().replace(/^\.\//, "").replace(/^\/+/, "");
  if (!cleaned || cleaned === "." || cleaned === "index") return null;
  return cleaned;
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function compileManualPackMatchers(patterns) {
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
}
function compileManualPackDefs(vendorPacksManualRaw, optimizeExclude) {
  const defsByGroup = /* @__PURE__ */ new Map();
  const defs = [];
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
    defs.push(def);
  }
  return defs;
}
function classifyManualPackGroup(defs, pkgName, subpath, optimizeExclude) {
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
      }
    }
  }
  return null;
}
function formatDepLabel(pkgName, subpath) {
  const sp = normalizeMatchSubpath(subpath);
  return sp ? `${pkgName}/${sp}` : pkgName;
}
function loadDepUsageIndexFromDisk(depsRoot, depsHash) {
  const depUsagePath = path26.join(depsRoot, "deps-usage.v2.json");
  const legacyDepUsagePath = path26.join(depsRoot, "deps-usage.v1.json");
  const raw = readJsonFile2(depUsagePath) ?? readJsonFile2(legacyDepUsagePath);
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
}
function saveDepUsageIndexToDisk(depsRoot, depsHash, index) {
  const depUsagePath = path26.join(depsRoot, "deps-usage.v2.json");
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
  writeJsonFile2(depUsagePath, {
    version: 2,
    depsHash,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    deps: depsObj
  });
}
function depUsageDemandByEntryPath(index) {
  const out = /* @__PURE__ */ new Map();
  if (!index) return out;
  for (const usage of index.values()) {
    if (!usage) continue;
    if (usage.hasNamespace || usage.hasExportStar) continue;
    if (!Array.isArray(usage.usedExports) || usage.usedExports.length === 0) continue;
    const demand = Array.from(new Set(usage.usedExports.map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))).sort();
    if (demand.length > 0) out.set(canonicalFsPath(usage.entryPath), demand);
  }
  return out;
}
var dplUsageDemandMemo = null;
var __c3ColdPumpDemand = null;
function runCanonicalColdDerivation(opts) {
  const { entryPaths, workspaceRoot, externalSpecifiers, context } = opts;
  if (!native?.canonicalSchedulerBegin || !native.canonicalSchedulerNextWave || !native.canonicalSchedulerAck || !native.canonicalSchedulerEnd) {
    throw new Error("[C3-c] canonical scheduler unavailable; cannot run cold derivation (fail-closed)");
  }
  const materializeCtx = {
    casRoot: context.casRoot,
    configHash: context.configHash,
    defineHash: context.defineHash
  };
  const schedId = native.canonicalSchedulerBegin(
    entryPaths,
    workspaceRoot,
    externalSpecifiers.length ? Array.from(externalSpecifiers) : null,
    context.defineRecipe?.replacements ?? [],
    context.defineRecipe?.importMetaEnvLiteral ?? void 0,
    opts.parserMode ?? "hybrid",
    // Phase A runs BEFORE DPL publication: no depStops yet. ResolveKind bounds the
    // frontier (Fact A); dep-leaf artifact identity (Fact B) is joined in Phase C.
    []
  );
  const appRecords = [];
  const depBoundaryTargets = /* @__PURE__ */ new Set();
  const dplDemand = [];
  let moduleCount = 0;
  let waves = 0;
  let peakWaveMaterialBytes = 0;
  try {
    for (; ; ) {
      const wave = native.canonicalSchedulerNextWave(schedId);
      if (wave.length === 0) break;
      waves += 1;
      let waveMaterialBytes = 0;
      let ok = true;
      for (const g of wave) {
        try {
          materializeCanonicalGeneration(
            { sourceHash: g.sourceHash, codeA: g.codeA, mapA: g.mapA ?? null, codeB: g.codeB },
            materializeCtx
          );
        } catch {
          ok = false;
          break;
        }
        waveMaterialBytes += Buffer.byteLength(g.codeA, "utf8") + Buffer.byteLength(g.mapA ?? "", "utf8") + Buffer.byteLength(g.codeB, "utf8");
        appRecords.push(g.record);
        for (const t of g.depBoundaryTargets ?? []) depBoundaryTargets.add(t);
        const depSpecSet = new Set(g.depSpecifiers ?? []);
        let importerPath;
        try {
          importerPath = fs23.realpathSync.native(g.filePath);
        } catch {
          importerPath = g.filePath;
        }
        for (const d of g.demands ?? []) {
          if (depSpecSet.has(d.specifier)) {
            dplDemand.push({
              importerPath,
              specifier: d.specifier,
              usedExports: [...d.usedExports ?? []],
              hasNamespace: !!d.hasNamespace,
              hasExportStar: !!d.hasExportStar,
              isDynamic: !!d.isDynamic
            });
          }
        }
        moduleCount += 1;
      }
      if (waveMaterialBytes > peakWaveMaterialBytes) peakWaveMaterialBytes = waveMaterialBytes;
      native.canonicalSchedulerAck(schedId, ok);
      if (!ok) {
        throw new Error("[C3-c] canonical materialization failed; build fails closed");
      }
    }
  } finally {
    try {
      native.canonicalSchedulerEnd(schedId);
    } catch {
    }
  }
  return { moduleCount, waves, peakWaveMaterialBytes, appRecords, depBoundaryTargets, dplDemand };
}
async function scanDplUsageDemand(options) {
  const memoKey = `${options.depsHash}
${path26.resolve(options.rootDir)}`;
  if (dplUsageDemandMemo && dplUsageDemandMemo.key === memoKey) return dplUsageDemandMemo.value;
  const result = await scanDplUsageDemandUncached(options);
  dplUsageDemandMemo = { key: memoKey, value: result };
  return result;
}
async function scanDplUsageDemandUncached(options) {
  const usageEntries = await resolveUsageEntries(options.rootDir, options.resolvedEntries);
  if (usageEntries.length === 0 || !native?.resolveModule) {
    const cached = loadDepUsageIndexFromDisk(options.depsRoot, options.depsHash);
    return {
      index: cached,
      demandByEntryPath: depUsageDemandByEntryPath(cached),
      runtimeDemands: usageEntries.length === 0 ? [] : null
    };
  }
  try {
    const manifestIndex = loadDepsManifestIndex(options.depsRoot);
    const canonicalFileNames = buildCanonicalDepFileNameIndex(
      Array.from(manifestIndex, ([fileName, entry]) => ({ fileName, entryPath: entry.entryPath }))
    );
    const coldPump = __c3ColdPumpDemand && __c3ColdPumpDemand.rootDir === options.rootDir && __c3ColdPumpDemand.depsHash === options.depsHash ? __c3ColdPumpDemand : null;
    if (coldPump) {
      const pumpUsage = usageIndexFromRuntimeDemands(
        coldPump.demands,
        options.rootDir,
        coldPump.entryRoots
      );
      const index2 = canonicalizeDepUsageIndex(pumpUsage, canonicalFileNames);
      saveDepUsageIndexToDisk(options.depsRoot, options.depsHash, index2);
      logInfo(`[C3-c] Phase B DPL demand authority: Parser(B)+Resolver (deps=${index2.size}, demands=${coldPump.demands.length}) \u2014 source scanner retired`);
      return {
        index: index2,
        demandByEntryPath: depUsageDemandByEntryPath(index2),
        runtimeDemands: coldPump.demands
      };
    }
    const scanned = await scanDepUsageFacts({
      rootDir: options.rootDir,
      entries: usageEntries,
      allowedRoots: options.allowedRoots
    });
    const index = canonicalizeDepUsageIndex(
      scanned.usage,
      canonicalFileNames
    );
    saveDepUsageIndexToDisk(options.depsRoot, options.depsHash, index);
    return {
      index,
      demandByEntryPath: depUsageDemandByEntryPath(index),
      runtimeDemands: scanned.runtimeDemands
    };
  } catch (err) {
    logWarn(`[deps] WARN: DPL usage demand scan failed; using complete dep artifacts (${String(err)})`);
    const cached = loadDepUsageIndexFromDisk(options.depsRoot, options.depsHash);
    return { index: cached, demandByEntryPath: /* @__PURE__ */ new Map(), runtimeDemands: null };
  }
}
function withDplUsageDemand(entryPath, depsHash, demandByEntryPath) {
  const usedExports = demandByEntryPath?.get(canonicalFsPath(entryPath));
  return usedExports && usedExports.length > 0 ? { entryPath, depsHash, usedExports: usedExports.slice() } : { entryPath, depsHash };
}
async function resolveUsageEntries(rootDir, resolvedEntries) {
  const usageEntries = [];
  if (Array.isArray(resolvedEntries) && resolvedEntries.length > 0) {
    usageEntries.push(...resolvedEntries);
    return usageEntries;
  }
  for (const candidate of [
    path26.join(rootDir, "src", "main.tsx"),
    path26.join(rootDir, "src", "main.ts"),
    path26.join(rootDir, "src", "index.tsx"),
    path26.join(rootDir, "src", "index.ts")
  ]) {
    if (fs23.existsSync(candidate)) usageEntries.push(candidate);
  }
  return usageEntries;
}
function isReadyManualPackState(raw, depsRoot, depsHash, group) {
  if (!raw || typeof raw !== "object") return false;
  if (raw.version !== 1 || raw.depsHash !== depsHash || raw.group !== group) return false;
  if (raw.outputVersion !== DEPS_OPTIMIZER_OUTPUT_VERSION) return false;
  if (raw.status !== "ready") return false;
  if (typeof raw.chunkGroupId !== "string" || raw.chunkGroupId.length === 0) return false;
  if (typeof raw.sharedFileName !== "string" || raw.sharedFileName.length === 0) return false;
  if (!Array.isArray(raw.entries) || raw.entries.length === 0) return false;
  if (!fs23.existsSync(path26.join(depsRoot, raw.sharedFileName))) return false;
  return raw.entries.every((e) => e?.fileName && fs23.existsSync(path26.join(depsRoot, String(e.fileName))));
}
function isReadyManualSlimState(raw, depsRoot, depsHash, group) {
  if (!raw || typeof raw !== "object") return false;
  if (raw.version !== 1 || raw.depsHash !== depsHash || raw.group !== group) return false;
  if (raw.outputVersion !== DEPS_OPTIMIZER_OUTPUT_VERSION) return false;
  if (raw.status !== "ready") return false;
  if (typeof raw.chunkGroupId !== "string" || raw.chunkGroupId.length === 0) return false;
  if (typeof raw.sharedFileName !== "string" || raw.sharedFileName.length === 0) return false;
  if (!Array.isArray(raw.entries) || raw.entries.length === 0) return false;
  if (!fs23.existsSync(path26.join(depsRoot, raw.sharedFileName))) return false;
  return raw.entries.every((e) => e?.wrapperFileName && fs23.existsSync(path26.join(depsRoot, String(e.wrapperFileName))));
}
async function prepareProductionAutoCorePack(options) {
  const profileStart = Date.now();
  const { rootDir, ionifyDir, depsHash, depsRoot, config } = options;
  const optimizeDeps = config?.optimizeDeps ?? {};
  const vendorPacksRaw = optimizeDeps.vendorPacks ?? false;
  if (vendorPacksRaw !== "auto") return { enabled: false, didWork: false };
  const depsSourcemapEnabled = optimizeDeps.sourcemap === true;
  const depsBundleEsmEnabled = optimizeDeps.bundleEsm !== false;
  const depsSharedChunksRaw = optimizeDeps.sharedChunks;
  const depsSharedChunksMode = depsSharedChunksRaw === void 0 || depsSharedChunksRaw === "auto" ? "auto" : depsSharedChunksRaw === true ? "1" : depsSharedChunksRaw === false ? "0" : String(depsSharedChunksRaw);
  const depsSharedChunksEnabled = depsSharedChunksMode !== "0";
  const autoEnabled = depsSharedChunksEnabled && !!native?.optimizeDependenciesChunked && !depsSourcemapEnabled && depsBundleEsmEnabled;
  if (!autoEnabled) {
    const reasons = [];
    if (!depsSharedChunksEnabled) reasons.push("sharedChunks=0");
    if (depsSourcemapEnabled) reasons.push("sourcemap=1");
    if (!depsBundleEsmEnabled) reasons.push("bundleEsm=0");
    if (!native?.optimizeDependenciesChunked) reasons.push("nativeChunked=0");
    return { enabled: true, didWork: false, reasons };
  }
  const optimizeExclude = Array.isArray(optimizeDeps.exclude) ? new Set(optimizeDeps.exclude.map((s) => String(s))) : null;
  const pkgJson = readProjectPackageJson2(rootDir);
  const vendorSpecifiers = detectVendorSpecifiers(pkgJson).map((s) => String(s ?? "").trim()).filter(Boolean).filter((s) => !optimizeExclude?.has(s));
  if (!native?.resolveModule) {
    logWarn("[deps] vendorPacks:auto enabled but native.resolveModule is unavailable; skipping production pack prep.");
    return { enabled: true, didWork: false };
  }
  const requests = [];
  const seen = /* @__PURE__ */ new Set();
  const requestResolutionStart = Date.now();
  for (const spec of vendorSpecifiers) {
    try {
      const resolved = native.resolveModule(spec, rootDir);
      const kind = resolved?.kind;
      if (!kind || kind === "Builtin" || kind === "Virtual" || kind === "NotFound") continue;
      const fsPath = resolved?.fsPath ?? resolved?.fs_path ?? null;
      if (!fsPath || typeof fsPath !== "string") continue;
      if (!fsPath.includes("node_modules")) continue;
      if (!isOptimizableDepEntryPath(fsPath)) continue;
      const canonicalEntryPath = canonicalFsPath(fsPath);
      if (seen.has(canonicalEntryPath)) continue;
      seen.add(canonicalEntryPath);
      requests.push({ entryPath: canonicalEntryPath, packageLabel: spec });
    } catch {
    }
  }
  logBuildProfile("productionAutoPackRequestResolution", requestResolutionStart);
  if (requests.length <= 1) return { enabled: true, didWork: false };
  requests.sort((a, b) => a.packageLabel.localeCompare(b.packageLabel));
  const statePath = path26.join(depsRoot, "vendor-pack.feature.core.json");
  const currentNodeEnv = process.env.NODE_ENV ?? "development";
  const activePublicationStart = Date.now();
  const activePublication = readDplChunkedPackPublication({
    depsRoot,
    requests,
    nodeEnv: currentNodeEnv
  });
  logBuildProfile("productionAutoPackDplPublicationRead", activePublicationStart);
  const routingIndexStart = Date.now();
  const vendorPackV2 = new VendorPackV2IndexManager({
    depsRoot,
    depsHash,
    outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
    allowPackFilePrefix: "vendor-pack.feature.",
    log: { info: logInfo, warn: logWarn }
  });
  vendorPackV2.loadFromDisk();
  logBuildProfile("productionAutoPackRoutingIndexRead", routingIndexStart);
  if (activePublication) {
    const publicationAdmissionStart = Date.now();
    writeJsonFile2(statePath, {
      version: 1,
      depsHash,
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      nodeEnv: process.env.NODE_ENV,
      group: "core",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      status: "ready",
      chunkGroupId: activePublication.chunkGroupId,
      sharedFileName: activePublication.sharedFileName,
      entries: activePublication.entries
    });
    const pack = vendorPackV2.ensurePackModuleFromEntries({
      label: "feature/core",
      packFileName: `vendor-pack.feature.core.${activePublication.chunkGroupId}.js`,
      sharedFileName: activePublication.sharedFileName,
      chunkFiles: activePublication.chunkFiles,
      entries: activePublication.entries,
      prunePackPrefix: "vendor-pack.feature.core."
    });
    logBuildProfile("productionAutoPackPublicationAdmission", publicationAdmissionStart);
    logBuildProfile("productionAutoPackTotal", profileStart);
    if (!pack) {
      vendorPackV2.prunePackPrefix("vendor-pack.feature.core.");
      writeJsonFile2(statePath, {
        version: 1,
        depsHash,
        outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
        nodeEnv: currentNodeEnv,
        group: "core",
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        status: "failed",
        chunkGroupId: activePublication.chunkGroupId,
        sharedFileName: activePublication.sharedFileName,
        entries: activePublication.entries,
        error: "DPL chunked publication could not prove a pack-compatible export ABI"
      });
      return { enabled: true, didWork: false, reasons: ["core-pack-abi-unproven"] };
    }
    return { enabled: true, didWork: false };
  }
  writeJsonFile2(statePath, {
    version: 1,
    depsHash,
    outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
    nodeEnv: currentNodeEnv,
    group: "core",
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    status: "building",
    chunkGroupId: null,
    sharedFileName: null,
    entries: []
  });
  let didWork = false;
  let attemptedPublication = null;
  try {
    const chunked = native?.optimizeDependenciesChunked;
    if (!chunked) throw new Error("native.optimizeDependenciesChunked is not available");
    didWork = true;
    const result = chunked(requests.map((entry) => ({ entryPath: entry.entryPath, depsHash })), ionifyDir);
    attemptedPublication = resolveDplChunkedPackPublication({ depsRoot, requests, result });
    if (!attemptedPublication) {
      throw new Error("DPL chunked optimizer returned an incomplete publication closure");
    }
    const active = readDplChunkedPackPublication({ depsRoot, requests, nodeEnv: currentNodeEnv });
    if (!active || active.chunkGroupId !== attemptedPublication.chunkGroupId || !sameStringSet(active.chunkFiles, attemptedPublication.chunkFiles) || active.entries.some((entry, index) => entry.fileName !== attemptedPublication.entries[index]?.fileName)) {
      throw new Error("DPL active publication does not select the optimizer-returned chunked closure");
    }
    attemptedPublication = active;
    writeJsonFile2(statePath, {
      version: 1,
      depsHash,
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      nodeEnv: currentNodeEnv,
      group: "core",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      status: "ready",
      chunkGroupId: active.chunkGroupId,
      sharedFileName: active.sharedFileName,
      entries: active.entries
    });
    const pack = vendorPackV2.ensurePackModuleFromEntries({
      label: "feature/core",
      packFileName: `vendor-pack.feature.core.${active.chunkGroupId}.js`,
      sharedFileName: active.sharedFileName,
      chunkFiles: active.chunkFiles,
      entries: active.entries,
      prunePackPrefix: "vendor-pack.feature.core."
    });
    if (!pack) throw new Error("DPL chunked publication could not prove a pack-compatible export ABI");
  } catch (err) {
    vendorPackV2.prunePackPrefix("vendor-pack.feature.core.");
    writeJsonFile2(statePath, {
      version: 1,
      depsHash,
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      nodeEnv: currentNodeEnv,
      group: "core",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      status: "failed",
      chunkGroupId: attemptedPublication?.chunkGroupId ?? null,
      sharedFileName: attemptedPublication?.sharedFileName ?? null,
      entries: attemptedPublication?.entries ?? [],
      error: String(err)
    });
    logWarn(`[deps] WARN: Auto core production pack build failed: ${String(err)}`);
  }
  logBuildProfile("productionAutoPackTotal", profileStart);
  return { enabled: true, didWork };
}
async function prepareProductionManualPacks(options) {
  const { rootDir, ionifyDir, depsHash, depsRoot, config, resolvedEntries, allowedRoots, depsManifestIndex } = options;
  const optimizeDeps = config?.optimizeDeps ?? {};
  const vendorPacksRaw = optimizeDeps.vendorPacks ?? false;
  const vendorPacksManualRaw = vendorPacksRaw && typeof vendorPacksRaw === "object" && !Array.isArray(vendorPacksRaw) && vendorPacksRaw !== true ? vendorPacksRaw : null;
  if (!vendorPacksManualRaw) return { enabled: false, didWork: false };
  const depsSourcemapEnabled = optimizeDeps.sourcemap === true;
  const depsBundleEsmEnabled = optimizeDeps.bundleEsm !== false;
  const depsSharedChunksRaw = optimizeDeps.sharedChunks;
  const depsSharedChunksMode = depsSharedChunksRaw === void 0 || depsSharedChunksRaw === "auto" ? "auto" : depsSharedChunksRaw === true ? "1" : depsSharedChunksRaw === false ? "0" : String(depsSharedChunksRaw);
  const depsSharedChunksEnabled = depsSharedChunksMode !== "0";
  const manualPacksEnabled = depsSharedChunksEnabled && !!native?.optimizeDependenciesChunked && !depsSourcemapEnabled && depsBundleEsmEnabled;
  if (!manualPacksEnabled) {
    const reasons = [];
    if (!depsSharedChunksEnabled) reasons.push("sharedChunks=0");
    if (depsSourcemapEnabled) reasons.push("sourcemap=1");
    if (!depsBundleEsmEnabled) reasons.push("bundleEsm=0");
    if (!native?.optimizeDependenciesChunked) reasons.push("nativeChunked=0");
    return { enabled: true, didWork: false, reasons };
  }
  const packSlimmingRaw = optimizeDeps.packSlimming ?? "auto";
  const packSlimmingEnabled = packSlimmingRaw === true || packSlimmingRaw === "auto" || packSlimmingRaw === void 0;
  const optimizeExclude = Array.isArray(optimizeDeps.exclude) ? new Set(optimizeDeps.exclude.map((s) => String(s))) : null;
  const defs = compileManualPackDefs(vendorPacksManualRaw, optimizeExclude);
  if (defs.length === 0) return { enabled: false, didWork: false };
  const vendorPackMaxBytes = typeof optimizeDeps.vendorPackMaxBytes === "number" && optimizeDeps.vendorPackMaxBytes > 0 ? Math.floor(optimizeDeps.vendorPackMaxBytes) : 600 * 1024;
  const vendorPackMaxMembers = typeof optimizeDeps.vendorPackMaxMembers === "number" && optimizeDeps.vendorPackMaxMembers > 0 ? Math.floor(optimizeDeps.vendorPackMaxMembers) : 25;
  const vendorPackV2 = new VendorPackV2IndexManager({
    depsRoot,
    depsHash,
    outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
    allowPackFilePrefix: "vendor-pack.manual.",
    log: { info: logInfo, warn: logWarn }
  });
  vendorPackV2.loadFromDisk();
  const depsManifestCanonicalFileNames = buildCanonicalDepFileNameIndex(
    Array.from(depsManifestIndex, ([fileName, entry]) => ({ fileName, entryPath: entry.entryPath }))
  );
  const usageEntries = await resolveUsageEntries(rootDir, resolvedEntries);
  let depUsageIndex = loadDepUsageIndexFromDisk(depsRoot, depsHash);
  if (!native?.resolveModule) {
    if (!depUsageIndex) {
      logWarn(
        "[deps] vendorPacks manual enabled but native.resolveModule is unavailable; skipping production pack prep."
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
        depsManifestCanonicalFileNames
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
  const manualObserved = /* @__PURE__ */ new Map();
  for (const def of defs) manualObserved.set(def.group, /* @__PURE__ */ new Map());
  for (const usage of depUsageIndex.values()) {
    if (!usage.fileName || !usage.entryPath || !usage.packageName) continue;
    const reg = getDepEntry(usage.fileName);
    const computedSubpath = computeSubpathFromEntryPath(usage.entryPath);
    const subpath = typeof reg?.subpath === "string" ? reg.subpath : computedSubpath ? computedSubpath : null;
    const group = classifyManualPackGroup(defs, usage.packageName, subpath, optimizeExclude);
    if (!group) continue;
    const groupMap = manualObserved.get(group);
    if (!groupMap) continue;
    if (!fs23.existsSync(usage.entryPath)) continue;
    const fileName = canonicalizeDepFileName(usage.fileName, usage.entryPath, depsManifestCanonicalFileNames);
    groupMap.set(fileName, {
      entryPath: usage.entryPath,
      fileName,
      packageLabel: formatDepLabel(usage.packageName, subpath)
    });
  }
  const planManualPackEntries = (group) => {
    const entries = reconcilePackEntries(
      Array.from(manualObserved.get(group)?.values() ?? []),
      (fileName, entryPath) => canonicalizeDepFileName(fileName, entryPath, depsManifestCanonicalFileNames)
    );
    const selected = [];
    const seen = /* @__PURE__ */ new Set();
    let totalBytes = 0;
    for (const entry of entries) {
      if (selected.length >= vendorPackMaxMembers) break;
      if (seen.has(entry.fileName)) continue;
      if (!entry.entryPath || !fs23.existsSync(entry.entryPath)) continue;
      const sizeBytes = depsManifestIndex.get(entry.fileName)?.sizeBytes ?? 0;
      if (totalBytes + sizeBytes > vendorPackMaxBytes) continue;
      seen.add(entry.fileName);
      totalBytes += sizeBytes;
      selected.push(entry);
    }
    return selected;
  };
  const manualPackStatePathFor = (group) => path26.join(depsRoot, `vendor-pack.manual.${group}.json`);
  const manualPackSlimStatePathFor = (group) => path26.join(depsRoot, `vendor-pack.manual.${group}.slim.json`);
  let didWork = false;
  const chunked = native?.optimizeDependenciesChunked;
  for (const def of defs) {
    const group = def.group;
    const entries = planManualPackEntries(group);
    if (entries.length === 0) continue;
    const plannedChunkGroupId = computeChunkGroupIdFromStableIds(entries.map((e) => e.fileName));
    const plannedSharedFileName = `shared.${plannedChunkGroupId}.js`;
    const statePath = manualPackStatePathFor(group);
    const existing = readJsonFile2(statePath);
    const isCached = isReadyManualPackState(existing, depsRoot, depsHash, group);
    const sharedOk = isCached && existing.entries.every(
      (entry) => entry?.entryPath && canonicalizeDepFileName(entry.fileName, entry.entryPath, depsManifestCanonicalFileNames) === entry.fileName
    ) && existing.sharedFileName === plannedSharedFileName && fs23.existsSync(path26.join(depsRoot, plannedSharedFileName));
    let baseState = null;
    if (sharedOk) {
      baseState = existing;
    } else {
      didWork = true;
      writeJsonFile2(statePath, {
        version: 1,
        depsHash,
        outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
        group,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        status: "building",
        chunkGroupId: plannedChunkGroupId,
        sharedFileName: plannedSharedFileName,
        entries
      });
      try {
        if (!chunked) throw new Error("native.optimizeDependenciesChunked is not available");
        const result = chunked(entries.map((e) => ({ entryPath: e.entryPath, depsHash })), ionifyDir);
        const groupId = result?.chunk_group ?? result?.chunkGroup ?? plannedChunkGroupId;
        const resolvedEntries2 = resolveChunkedPackEntries(
          entries,
          Array.isArray(result?.entries) ? result.entries.map((item) => ({
            entryPath: item?.entry_path ?? item?.entryPath ?? null,
            outPath: item?.out_path ?? item?.outPath ?? null
          })) : []
        );
        const sharedFileName = `shared.${groupId}.js`;
        const sharedOut = path26.join(depsRoot, sharedFileName);
        const ok = fs23.existsSync(sharedOut) && resolvedEntries2.every((entry) => fs23.existsSync(path26.join(depsRoot, entry.fileName)));
        if (!ok) throw new Error("Manual pack optimizer did not produce expected outputs");
        const readyState = {
          version: 1,
          depsHash,
          outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
          group,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
          status: "ready",
          chunkGroupId: groupId,
          sharedFileName,
          entries: resolvedEntries2
        };
        writeJsonFile2(statePath, readyState);
        baseState = readyState;
      } catch (err) {
        writeJsonFile2(statePath, {
          version: 1,
          depsHash,
          outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
          group,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
          status: "failed",
          chunkGroupId: plannedChunkGroupId,
          sharedFileName: plannedSharedFileName,
          entries,
          error: String(err)
        });
        logWarn(`[deps] WARN: Manual production pack build failed (${group}): ${String(err)}`);
      }
    }
    if (!isReadyManualPackState(baseState, depsRoot, depsHash, group)) continue;
    const baseEntries = Array.isArray(baseState.entries) ? baseState.entries : [];
    if (baseEntries.length === 0) continue;
    if (packSlimmingEnabled && group !== "core") {
      const usedByBase = /* @__PURE__ */ new Map();
      for (const entry of baseEntries) {
        const u = depUsageIndex.get(entry.fileName);
        if (!u) continue;
        if (u.hasNamespace || u.hasExportStar) continue;
        if (!Array.isArray(u.usedExports) || u.usedExports.length === 0) continue;
        usedByBase.set(entry.fileName, u.usedExports.slice());
      }
      if (usedByBase.size > 0) {
        const slimPath = manualPackSlimStatePathFor(group);
        const existingSlim = readJsonFile2(slimPath);
        if (isReadyManualSlimState(existingSlim, depsRoot, depsHash, group) && existingSlim.entries.every(
          (entry) => entry?.entryPath && canonicalizeDepFileName(entry.baseFileName, entry.entryPath, depsManifestCanonicalFileNames) === entry.baseFileName
        )) {
          const sharedPath = path26.join(depsRoot, existingSlim.sharedFileName);
          const byBase = new Map(existingSlim.entries.map((e) => [e.baseFileName, e]));
          const baseSet = new Set(baseEntries.map((e) => e.fileName));
          const inputsMatch = fs23.existsSync(sharedPath) && existingSlim.entries.every((e) => baseSet.has(e.baseFileName)) && baseEntries.every((base) => {
            const entry = byBase.get(base.fileName);
            if (!entry) return false;
            if (entry.entryPath !== base.entryPath) return false;
            if (!fs23.existsSync(path26.join(depsRoot, entry.wrapperFileName))) return false;
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
                packageLabel: e.packageLabel
              })),
              prunePackPrefix: `vendor-pack.manual.${group}.`
            });
            if (ok) continue;
          }
        }
        didWork = true;
        writeJsonFile2(slimPath, {
          version: 1,
          depsHash,
          outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
          group,
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
          if (!chunked) throw new Error("native.optimizeDependenciesChunked is not available");
          const result = chunked(
            baseEntries.map((e) => {
              const usedExports = usedByBase.get(e.fileName);
              return usedExports && usedExports.length > 0 ? { entryPath: e.entryPath, depsHash, usedExports } : { entryPath: e.entryPath, depsHash };
            }),
            ionifyDir
          );
          const groupId = result?.chunk_group ?? result?.chunkGroup ?? null;
          if (!groupId || typeof groupId !== "string") throw new Error("Missing chunkGroupId");
          const sharedFileName = `shared.${groupId}.js`;
          const sharedOut = path26.join(depsRoot, sharedFileName);
          if (!fs23.existsSync(sharedOut)) throw new Error("Slim shared chunk not found on disk");
          const resultsArr = Array.isArray(result?.entries) ? result.entries : [];
          const outByEntryPath = /* @__PURE__ */ new Map();
          for (const item of resultsArr) {
            const entryPath = item?.entry_path ?? item?.entryPath ?? null;
            const outPath = item?.out_path ?? item?.outPath ?? null;
            if (typeof entryPath !== "string" || typeof outPath !== "string") continue;
            const canonicalEntryPath = (() => {
              try {
                return fs23.realpathSync(entryPath);
              } catch {
                return entryPath;
              }
            })();
            outByEntryPath.set(canonicalEntryPath, path26.basename(outPath));
          }
          const slimMembers = [];
          const slimEntries = [];
          for (const base of baseEntries) {
            const canonicalBaseEntryPath = (() => {
              try {
                return fs23.realpathSync(base.entryPath);
              } catch {
                return base.entryPath;
              }
            })();
            const wrapperFileName = outByEntryPath.get(canonicalBaseEntryPath) ?? base.fileName;
            if (!fs23.existsSync(path26.join(depsRoot, wrapperFileName))) {
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
          const ok = vendorPackV2.ensurePackModuleFromWrappers({
            label: `manual/${group}/slim`,
            packFileName: `vendor-pack.manual.${group}.${groupId}.js`,
            sharedFileName,
            members: slimMembers,
            prunePackPrefix: `vendor-pack.manual.${group}.`
          });
          writeJsonFile2(slimPath, {
            version: 1,
            depsHash,
            outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
            group,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
            status: "ready",
            chunkGroupId: groupId,
            sharedFileName,
            entries: slimEntries
          });
          if (ok) continue;
        } catch (err) {
          writeJsonFile2(slimPath, {
            version: 1,
            depsHash,
            outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
            group,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
            status: "failed",
            chunkGroupId: null,
            sharedFileName: null,
            entries: readJsonFile2(slimPath)?.entries ?? [],
            error: String(err)
          });
          logWarn(`[deps] WARN: Manual production pack slimming failed (${group}): ${String(err)}`);
        }
      }
    }
    vendorPackV2.ensurePackModuleFromEntries({
      label: `manual/${group}`,
      packFileName: `vendor-pack.manual.${group}.${baseState.chunkGroupId}.js`,
      sharedFileName: baseState.sharedFileName,
      entries: baseState.entries,
      prunePackPrefix: `vendor-pack.manual.${group}.`
    });
  }
  return { enabled: true, didWork };
}
async function runBuildCommand(options = {}) {
  try {
    const buildStart = Date.now();
    const setupStart = Date.now();
    const buildMode = options.mode ?? process.env.IONIFY_MODE ?? process.env.MODE ?? (options.depsOnly ? process.env.NODE_ENV ?? "development" : "production");
    if (!options.depsOnly) {
      process.env.NODE_ENV = "production";
    } else if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "production") {
      process.env.NODE_ENV = "development";
    }
    process.env.MODE = buildMode;
    process.env.IONIFY_MODE = buildMode;
    const config = await loadIonifyConfig(process.cwd(), buildMode);
    const projectRootOverride = config?.root ? path26.resolve(config.root) : null;
    const workspace = resolveWorkspace(projectRootOverride ?? process.cwd(), {
      projectRootOverride
    });
    const rootDir = workspace.projectRoot;
    const ionifyDir = workspace.ionifyDir;
    const publicDirAbs = resolvePublicDir(rootDir, config?.publicDir);
    fs23.mkdirSync(ionifyDir, { recursive: true });
    process.env.IONIFY_PROJECT_ROOT = rootDir;
    process.env.IONIFY_WORKSPACE_ROOT = workspace.workspaceRoot;
    process.env.IONIFY_STATE_DIR = ionifyDir;
    process.env.IONIFY_WORKSPACE_ID = workspace.workspaceId;
    process.env.IONIFY_PROJECT_ID = workspace.projectId;
    try {
      const preOpts = config?.css?.preprocessorOptions;
      process.env.IONIFY_CSS_PREPROCESSOR_OPTIONS = preOpts ? JSON.stringify(preOpts) : "";
    } catch {
      process.env.IONIFY_CSS_PREPROCESSOR_OPTIONS = "";
    }
    process.env.MODE = buildMode;
    const envFromFiles = loadEnv(process.env.MODE, rootDir);
    if (!options.depsOnly) {
      process.env.NODE_ENV = "production";
    }
    const envValues = {
      ...envFromFiles,
      NODE_ENV: process.env.NODE_ENV,
      MODE: process.env.MODE
    };
    const envPrefix = config?.envPrefix || ["VITE_", "IONIFY_"];
    const defineConfig = buildDefineConfig(config?.define, envValues, envPrefix);
    logInfo(`[define] ${Object.keys(defineConfig).length} replacements configured`);
    const canonicalDefineRecipe = buildDefineRecipe(defineConfig);
    const optLevel = resolveOptimizationLevel(config?.optimizationLevel, {
      cliLevel: options.level,
      envLevel: process.env.IONIFY_OPTIMIZATION_LEVEL
    });
    let minifier;
    const parserMode = resolveParser(config, { envMode: process.env.IONIFY_PARSER });
    let treeshake;
    let scopeHoist;
    if (optLevel !== null) {
      const preset = getOptimizationPreset(optLevel);
      minifier = preset.minifier;
      treeshake = preset.treeshake;
      scopeHoist = preset.scopeHoist;
      logInfo(`Using optimization level ${optLevel} (preset)`);
    } else {
      minifier = resolveMinifier(config, { envVar: process.env.IONIFY_MINIFIER });
      treeshake = resolveTreeshake(config?.treeshake, {
        envMode: process.env.IONIFY_TREESHAKE,
        includeEnv: process.env.IONIFY_TREESHAKE_INCLUDE,
        excludeEnv: process.env.IONIFY_TREESHAKE_EXCLUDE
      });
      scopeHoist = resolveScopeHoist(config?.scopeHoist, {
        envMode: process.env.IONIFY_SCOPE_HOIST,
        inlineEnv: process.env.IONIFY_SCOPE_HOIST_INLINE,
        constantEnv: process.env.IONIFY_SCOPE_HOIST_CONST,
        combineEnv: process.env.IONIFY_SCOPE_HOIST_COMBINE
      });
    }
    applyParserEnv(parserMode);
    const resolvedBuildEntries = resolveProductionBuildEntries(config, rootDir, (message) => logWarn(message));
    let entries = resolvedBuildEntries.entries;
    if (entries?.length && resolvedBuildEntries.source === "config") {
      logInfo(`Build entries: ${entries.join(", ")}`);
    } else if (entries?.length && resolvedBuildEntries.source === "html") {
      logInfo(`Build entries inferred from index.html: ${entries.join(", ")}`);
    } else {
      logInfo(`No entries in config or index.html, planner will infer from graph`);
    }
    const rawVersionInputs = createProductionGraphVersionInputs({
      config,
      parserMode,
      minifier,
      treeshake,
      scopeHoist,
      entries
    });
    const configHash = computeGraphVersion(rawVersionInputs);
    logInfo(`[Build] Version hash: ${configHash}`);
    process.env.IONIFY_CONFIG_HASH = configHash;
    const casRoot = path26.join(ionifyDir, "cas");
    const defineSignature = computeDefineSignature(defineConfig);
    const defineHash = defineSignature ? getCacheKey(defineSignature) : "";
    const canonicalBuildContext = {
      defineRecipe: canonicalDefineRecipe,
      defineHash,
      configHash,
      casRoot
    };
    const productionChunkPolicy = resolveProductionChunkPolicy(config);
    if (productionChunkPolicy.vendorMaxBytes !== null) {
      process.env.IONIFY_VENDOR_MAX_CHUNK_BYTES = String(productionChunkPolicy.vendorMaxBytes);
    } else {
      delete process.env.IONIFY_VENDOR_MAX_CHUNK_BYTES;
    }
    logBuildProfile("setupConfigIdentity", setupStart);
    const depsPhaseStart = Date.now();
    resetTopologyValidationProfile();
    const lockfile = readLockfile(workspace.workspaceRoot, rootDir);
    const depsSourcemapEnabled = config?.optimizeDeps?.sourcemap === true;
    const depsBundleEsmEnabled = config?.optimizeDeps?.bundleEsm !== false;
    const depsSharedChunksRaw = config?.optimizeDeps?.sharedChunks;
    const depsSharedChunksMode = depsSharedChunksRaw === void 0 || depsSharedChunksRaw === "auto" ? "auto" : depsSharedChunksRaw === true ? "1" : depsSharedChunksRaw === false ? "0" : String(depsSharedChunksRaw);
    const depsHash = computeDepsHash(configHash, lockfile, {
      nodeEnv: process.env.NODE_ENV,
      sourcemap: depsSourcemapEnabled,
      bundleEsm: depsBundleEsmEnabled,
      sharedChunks: depsSharedChunksMode,
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION
    });
    process.env.IONIFY_DEPS_HASH = depsHash;
    const depsRoot = path26.join(ionifyDir, "deps", depsHash);
    process.env.IONIFY_DEPS_ROOT = depsRoot;
    fs23.mkdirSync(depsRoot, { recursive: true });
    const buildExternalSpecifiers = collectConfiguredExternalSpecifiers(config);
    const productionPublicationIdentity = {
      productionPlanOutputVersion: PRODUCTION_PLAN_OUTPUT_VERSION,
      mode: buildMode,
      nodeEnv: "production",
      configHash,
      depsHash,
      depsOptimizerOutputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      entries: entries ?? [],
      entrySource: resolvedBuildEntries.source
    };
    const earlyOutDir = options.outDir || "dist";
    const earlyAbsOutDir = path26.resolve(earlyOutDir);
    const earlyPlanStart = Date.now();
    const earlyPublicationState = readProductionPublicationState(ionifyDir);
    const earlyPublishedPlan = readProductionPublicationPlan(
      ionifyDir,
      productionPublicationIdentity,
      earlyPublicationState
    );
    const earlyProductionReadinessRecord = earlyPublishedPlan ? readProductionReadinessRecord(ionifyDir) : null;
    const earlyPraIdentityVerified = earlyPublishedPlan !== null && isVerifiedProductionReadinessForPlan(earlyProductionReadinessRecord, {
      configHash,
      workspaceRoot: workspace.workspaceRoot,
      projectRoot: rootDir,
      depsHash,
      plan: earlyPublishedPlan,
      depsOptimizerOutputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION
    });
    let sourceMutationOutputBase = null;
    let earlySourceFreshnessAudit = null;
    let earlyPublishedDplGenerationCurrent = false;
    if (earlyPublishedPlan) {
      logBuildProfile("publishedProductionPlanRead", earlyPlanStart);
      const sourceFreshnessPreflightStart2 = Date.now();
      earlySourceFreshnessAudit = auditProductionSourceFreshness(
        earlyPublishedPlan,
        ionifyDir,
        workspace.workspaceRoot,
        path26.join(ionifyDir, "cas"),
        configHash
      );
      logBuildProfile("praSourceFreshnessPreflight", sourceFreshnessPreflightStart2);
      const sourceFreshnessCurrent2 = earlySourceFreshnessAudit.current;
      if (!sourceFreshnessCurrent2 && earlyPraIdentityVerified && earlyProductionReadinessRecord) {
        sourceMutationOutputBase = tryVerifyProductionReadinessMaterializedOutputs(
          earlyAbsOutDir,
          earlyProductionReadinessRecord
        );
      }
      const verifiedPraForDeployReadyOutput = sourceFreshnessCurrent2 && earlyPraIdentityVerified;
      const materializedReadiness = verifiedPraForDeployReadyOutput && earlyProductionReadinessRecord ? tryVerifyProductionReadinessMaterializedOutputs(earlyAbsOutDir, earlyProductionReadinessRecord) : null;
      if (!options.depsOnly && materializedReadiness) {
        logInfo("Building...");
        logInfo(`[Build] Using published Production Plan (${earlyPublishedPlan.chunks.length} chunk(s), identity verified)`);
        const totalPlannedModules2 = earlyPublishedPlan.chunks.reduce((acc, chunk) => acc + chunk.modules.length, 0);
        logInfo(
          `[Build] Plan ready: entries=${earlyPublishedPlan.entries.length}, chunks=${earlyPublishedPlan.chunks.length}, modules=${totalPlannedModules2}`
        );
        logInfo("[PRA] Verified deploy-ready identity for current Production Plan; skipping dependency/CAS/dist readiness probes");
        logBuildProfileDuration("depsAuthorityAndPacks", 0);
        logBuildProfileDuration("generateBuildPlan", 0);
        logBuildProfileDuration("depsReroute", 0);
        logBuildProfileDuration("canonicalDependencyPlan", 0);
        logBuildProfileDuration("moduleIndex", 0);
        logBuildProfileDuration("freshnessScan", 0);
        logBuildProfileDuration("praOutputReadinessProbe", 0);
        logBuildProfileDuration("casBatchCheck", 0);
        logBuildProfileDuration("casHydration", 0);
        logBuildProfileDuration("distReuseProbe", 0);
        logBuildProfileDuration("emitChunksAndFiles", 0);
        logBuildProfileDuration("writeBuildManifest", 0);
        logBuildProfileDuration("writeAssetsManifest", 0);
        logBuildProfileDuration("emitIndexHtml", 0);
        logBuildProfileDuration("publicAssetReadiness", 0);
        logBuildProfileDuration("writeBuildStats", 0);
        logBuildProfileDuration("manifestAssetsStats", 0);
        const outputHashHints2 = collectOutputHashHints(materializedReadiness.stats);
        const distProof = earlyProductionReadinessRecord.proofs.dist;
        if (distProof.manifestHash) outputHashHints2.set("manifest.json", distProof.manifestHash);
        if (distProof.buildStatsHash) outputHashHints2.set("build.stats.json", distProof.buildStatsHash);
        if (distProof.assetsManifestHash) outputHashHints2.set("manifest.assets.json", distProof.assetsManifestHash);
        if (distProof.indexHtmlHash) outputHashHints2.set("index.html", distProof.indexHtmlHash);
        for (const asset of earlyProductionReadinessRecord.proofs.publicAssets.assets) {
          outputHashHints2.set(toPosixPath2(asset.file), asset.hash);
        }
        const coreBuildElapsed2 = Date.now() - buildStart;
        logInfo(`Build plan generated \u2192 ${path26.join(earlyAbsOutDir, "manifest.json")}`);
        logInfo(`Entries: ${earlyPublishedPlan.entries.length}, Chunks: ${earlyPublishedPlan.chunks.length}`);
        logInfo(`Modules in plan: ${totalPlannedModules2}`);
        logInfo(`CAS hits: PRA verified \u2022 transforms needed: 0`);
        logInfo(`Build complete in ${coreBuildElapsed2}ms`);
        logInfo(`[Build] Time-to-deploy-ready: ${coreBuildElapsed2}ms`);
        logBuildProfileDuration("timeToDeployReady", coreBuildElapsed2);
        const compression2 = await runPostBuildCompression({
          config,
          absOutDir: earlyAbsOutDir,
          casRoot: path26.join(ionifyDir, "cas"),
          outputHashHints: outputHashHints2,
          buildStart
        });
        const praEmitStart2 = Date.now();
        try {
          const readinessRecord = createProductionReadinessRecord({
            configHash,
            workspaceRoot: workspace.workspaceRoot,
            projectRoot: rootDir,
            depsHash,
            plan: earlyPublishedPlan,
            artifacts: materializedReadiness.artifacts,
            dist: {
              manifestHash: distProof.manifestHash ?? "",
              buildStatsHash: distProof.buildStatsHash ?? "",
              assetsManifestHash: distProof.assetsManifestHash,
              indexHtmlHash: distProof.indexHtmlHash
            },
            compression: compression2,
            publicAssets: earlyProductionReadinessRecord.proofs.publicAssets,
            depsOptimizerOutputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION
          });
          writeProductionReadinessRecord(ionifyDir, readinessRecord);
        } catch (err) {
          logWarn(`[PRA] Skipped deploy-ready.v1 emit: ${err instanceof Error ? err.message : String(err)}`);
        }
        logBuildProfile("praEmit", praEmitStart2);
        const slimmingSaved2 = computeBuildSlimmingSavedPercent(depsRoot, depsHash);
        const vendorPacksSaved2 = computeBuildVendorPackRequestsSavedPercent(depsRoot, depsHash);
        logInfo(`Slimming saved: ${typeof slimmingSaved2 === "number" ? `${slimmingSaved2}%` : "0%"}`);
        logInfo(`Vendor packs saved: ${typeof vendorPacksSaved2 === "number" ? `${vendorPacksSaved2}%` : "0%"} requests`);
        return;
      }
    }
    if (!options.depsOnly && earlyPublishedPlan && earlySourceFreshnessAudit?.current === true && earlyPublicationState?.tiers.deps.state === "published") {
      const dplPublishedGenerationProofStart = Date.now();
      try {
        earlyPublishedDplGenerationCurrent = native?.depsVerifiedGenerationCurrent?.(depsRoot) === true;
      } catch {
        earlyPublishedDplGenerationCurrent = false;
      }
      logBuildProfile("dplPublishedGenerationProof", dplPublishedGenerationProofStart);
    }
    if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "production") {
      process.env.IONIFY_NODE_ENV = process.env.NODE_ENV;
    }
    if (native?.initAstCache) {
      const versionHash = JSON.stringify(rawVersionInputs);
      native.initAstCache(versionHash);
      logInfo(`AST cache initialized with version hash`);
    }
    const sourceOnlyMutationProofStart = Date.now();
    const sourceOnlyMutationProof = earlyPublishedPlan && (!options.depsOnly || options.publicationContracts === true) ? collectSourceOnlyMutationProof(
      earlyPublishedPlan,
      workspace.workspaceRoot,
      parserMode,
      earlySourceFreshnessAudit?.changedPaths ?? []
    ) : { ok: false, changed: 0, changedPaths: [], runtimeMutations: [], reason: "no-published-plan" };
    logBuildProfile("sourceOnlyMutationProof", sourceOnlyMutationProofStart);
    if (!sourceOnlyMutationProof.ok) {
      logBuildProfileText("sourceOnlyAdmission", `dpl-rejected:${sourceOnlyMutationProof.reason ?? "unknown"}`);
    }
    const sourceOnlyCanonicalMutation = sourceOnlyMutationProof.ok && earlyPublishedPlan ? admitCanonicalBuildPlanMutation({
      plan: earlyPublishedPlan,
      versionInputs: rawVersionInputs,
      changedSourcePaths: sourceOnlyMutationProof.changedPaths,
      runtimeMutations: sourceOnlyMutationProof.runtimeMutations,
      depsRoot,
      externalSpecifiers: buildExternalSpecifiers,
      consumer: options.depsOnly ? "plan" : "bundler"
    }) : null;
    const sourceOnlyCanonicalPlan = sourceOnlyCanonicalMutation?.plan ?? null;
    const sourceMutationPlannerChunkIds = sourceOnlyCanonicalMutation?.affectedChunkIds ?? null;
    const sourceMutationPublicationContext = sourceOnlyCanonicalMutation?.publicationContext ?? null;
    const skipDepsAuthorityForSourceOnlyEdit = sourceOnlyCanonicalPlan !== null;
    const skipDepsAuthorityForPublishedPlan = !options.depsOnly && earlyPublishedPlan !== null && earlySourceFreshnessAudit?.current === true && earlyPublishedDplGenerationCurrent;
    const skipDepsAuthorityForCanonicalPlan = skipDepsAuthorityForSourceOnlyEdit || skipDepsAuthorityForPublishedPlan;
    if (sourceOnlyMutationProof.ok && !skipDepsAuthorityForSourceOnlyEdit) {
      logBuildProfileText("sourceOnlyAdmission", "planner-rejected");
    } else if (skipDepsAuthorityForSourceOnlyEdit) {
      logBuildProfileText("sourceOnlyAdmission", "dpl-and-planner-admitted");
      const freshnessCacheUpdateStart = Date.now();
      updateSourceFreshnessCacheForCanonicalMutation(
        sourceOnlyCanonicalPlan,
        ionifyDir,
        workspace.workspaceRoot,
        sourceOnlyMutationProof.changedPaths
      );
      logBuildProfile("sourceFreshnessDeltaWrite", freshnessCacheUpdateStart);
    }
    let coldDerivation = null;
    __c3ColdPumpDemand = null;
    if (!skipDepsAuthorityForCanonicalPlan && !options.depsOnly) {
      const coldWsRoot = workspace.workspaceRoot;
      const coldEntrySet = Array.from(
        /* @__PURE__ */ new Set([...entries ?? [], ...collectFederationExposeEntryPaths(config, rootDir)])
      );
      const coldEntryAbs = coldEntrySet.map(
        (e) => path26.isAbsolute(e) ? e : e.startsWith(WS_MODULE_PREFIX) ? fromWsModuleId(e, coldWsRoot) : path26.resolve(rootDir, e)
      ).filter((p) => typeof p === "string" && p.length > 0 && fs23.existsSync(p));
      if (coldEntryAbs.length > 0) {
        const coldStart = Date.now();
        coldDerivation = runCanonicalColdDerivation({
          entryPaths: coldEntryAbs,
          workspaceRoot: coldWsRoot,
          externalSpecifiers: buildExternalSpecifiers,
          context: canonicalBuildContext
        });
        logBuildProfile("coldCanonicalDerivation", coldStart);
        logInfo(
          `[C3-c] cold canonical derivation: modules=${coldDerivation.moduleCount} waves=${coldDerivation.waves} peakWaveBytes=${coldDerivation.peakWaveMaterialBytes} depBoundary=${coldDerivation.depBoundaryTargets.size} demand=${coldDerivation.dplDemand.length}`
        );
        __c3ColdPumpDemand = {
          rootDir,
          depsHash,
          demands: coldDerivation.dplDemand,
          entryRoots: coldEntryAbs
        };
      }
    }
    const vendorPacksRaw = config?.optimizeDeps?.vendorPacks ?? false;
    const vendorPacksManualConfigured = vendorPacksRaw && typeof vendorPacksRaw === "object" && !Array.isArray(vendorPacksRaw) && Object.keys(vendorPacksRaw).length > 0;
    const vendorPacksAutoConfigured = vendorPacksRaw === "auto";
    if (skipDepsAuthorityForSourceOnlyEdit) {
      depsMeasurementProfile.cacheMode = "local-verified-warm-source-only";
      logInfo(
        `[deps] Skipping dependency freshness scan for source-only edit (changed=${sourceOnlyMutationProof.changed}, depsHash=${depsHash}, DPL publication identity and Planner topology admitted)`
      );
    } else if (skipDepsAuthorityForPublishedPlan) {
      depsMeasurementProfile.cacheMode = "pap-contract-current";
      logInfo(
        `[deps] Reusing DPL-verified Production Contracts generation (depsHash=${depsHash}, Planner identity and source proof current)`
      );
    } else if (vendorPacksAutoConfigured) {
      const packsStart = Date.now();
      const vendorExclude = resolveAutoVendorEntryFsPaths(rootDir, config);
      if (vendorExclude !== null && vendorExclude.size > 1 && native?.optimizeDepsParallelSplit) {
        const sentinelPath = path26.join(depsRoot, ".verified");
        let depsSnapshotAlreadyFresh = false;
        let skipGlobalRestore = false;
        if (fs23.existsSync(sentinelPath)) {
          const freshness = await checkVerifiedDepsSnapshotFreshness({
            rootDir,
            depsRoot,
            resolvedEntries: entries,
            allowedRoots: workspace.allowedRoots,
            config
          });
          if (freshness.fresh) {
            const checkedLabel = freshness.checked > 0 ? `, checked=${freshness.checked}` : "";
            logInfo(`[deps] Skipping optimization (depsHash=${depsHash} already verified${checkedLabel})`);
            depsMeasurementProfile.cacheMode = "local-verified-warm";
            depsSnapshotAlreadyFresh = true;
          } else {
            try {
              fs23.unlinkSync(sentinelPath);
            } catch {
            }
            skipGlobalRestore = true;
            const missingLabel = freshness.missing.length > 0 ? `, missing=${freshness.missing.length}` : "";
            logWarn(
              `[deps] Verified deps snapshot is stale (${freshness.reason ?? "unknown"}${missingLabel}); repairing`
            );
          }
        }
        if (depsSnapshotAlreadyFresh) {
        } else if (!skipGlobalRestore && restoreDepArtifactsFromGlobalCache(depsHash, depsRoot, DEPS_OPTIMIZER_OUTPUT_VERSION) && await verifyRestoredDepsSnapshot({
          rootDir,
          depsRoot,
          sentinelPath,
          resolvedEntries: entries,
          allowedRoots: workspace.allowedRoots,
          config
        })) {
          logInfo(`[deps] Restored from global cache (depsHash=${depsHash})`);
          depsMeasurementProfile.cacheMode = "global-cache-restored-cold";
        } else {
          depsMeasurementProfile.cacheMode = depsMeasurementProfile.outputVersionMismatchSeen || hasPriorDepsOutputVersionMismatch(ionifyDir, depsRoot) ? "first-run-after-output-version-bump" : "no-cache-true-cold";
          if (native?.depsPromoteArtifacts) {
            const prevRoot = findPreviousDepsRoot(ionifyDir, depsRoot);
            if (prevRoot) {
              try {
                const r = native.depsPromoteArtifacts(prevRoot, depsRoot, depsHash, DEPS_OPTIMIZER_OUTPUT_VERSION);
                depsMeasurementProfile.promoted += r.promoted;
                depsMeasurementProfile.promotionSkipped += r.skipped;
                if (r.promoted > 0) {
                  depsMeasurementProfile.cacheMode = "cross-depshash-promotion";
                  logInfo(`[deps] Promoted ${r.promoted} artifacts from previous deps dir (${r.skipped} need re-optimization)`);
                }
              } catch {
              }
            }
          }
          const batchEntryPaths = await (async () => {
            const out = /* @__PURE__ */ new Set();
            if (!native?.resolveModule) return out;
            const pkgJson = readProjectPackageJson2(rootDir);
            const optimizeExclude = Array.isArray(config?.optimizeDeps?.exclude) ? new Set(config.optimizeDeps.exclude.map((s) => String(s))) : null;
            const depSpecifiers = Object.keys(pkgJson?.dependencies ?? {});
            const includeSpecifiers = Array.isArray(config?.optimizeDeps?.include) ? config.optimizeDeps.include.map((s) => String(s)) : [];
            const vendorMode = config?.optimizeDeps?.vendor ?? "auto";
            const vendorSpecifiers = vendorMode === false ? [] : Array.isArray(vendorMode) ? vendorMode.map((s) => String(s)) : vendorMode === "auto" ? detectVendorSpecifiers(pkgJson) : [];
            const allSpecs = Array.from(new Set([...vendorSpecifiers, ...includeSpecifiers, ...depSpecifiers].map((s) => s.trim()).filter(Boolean))).filter((s) => !optimizeExclude?.has(s));
            for (const spec of allSpecs) {
              try {
                const r = native.resolveModule(spec, rootDir);
                const fsPath = r?.fsPath ?? r?.fs_path ?? null;
                if (!fsPath || typeof fsPath !== "string" || !fsPath.includes("node_modules")) continue;
                if (!isOptimizableDepEntryPath(fsPath)) continue;
                if (!vendorExclude.has(fsPath)) out.add(fsPath);
              } catch {
              }
            }
            const usageEntries = await resolveUsageEntries(rootDir, entries);
            if (usageEntries.length > 0) {
              try {
                const scanned = await scanDepEntryPaths({ rootDir, entries: usageEntries, allowedRoots: workspace.allowedRoots });
                for (const e of scanned) {
                  if (optimizeExclude?.has(e.packageName)) continue;
                  if (!isOptimizableDepEntryPath(e.entryPath)) continue;
                  if (!vendorExclude.has(e.entryPath)) out.add(e.entryPath);
                }
              } catch {
              }
            }
            return out;
          })();
          if (batchEntryPaths.size > 0 || vendorExclude.size > 0) {
            fs23.mkdirSync(depsRoot, { recursive: true });
            const dplDemand = await scanDplUsageDemand({
              rootDir,
              depsRoot,
              depsHash,
              resolvedEntries: entries,
              allowedRoots: workspace.allowedRoots
            });
            const batchEntries = Array.from(batchEntryPaths).map(
              (entryPath) => withDplUsageDemand(entryPath, depsHash, dplDemand.demandByEntryPath)
            );
            const chunkedEntries = Array.from(vendorExclude).map(
              (entryPath) => withDplUsageDemand(entryPath, depsHash, dplDemand.demandByEntryPath)
            );
            try {
              const splitResult = native.optimizeDepsParallelSplit(batchEntries, chunkedEntries, ionifyDir);
              for (const err of splitResult.errors ?? []) {
                logWarn(`[deps] WARN (parallel split): ${err}`);
              }
            } catch (err) {
              logWarn(`[deps] WARN: Parallel split failed, falling back: ${String(err)}`);
              await ensureOptimizedDeps({
                rootDir,
                ionifyDir,
                depsHash,
                depsRoot,
                config,
                resolvedEntries: entries,
                allowedRoots: workspace.allowedRoots,
                excludeEntryPaths: vendorExclude,
                publishGeneration: false
              });
            }
            await publishVerifiedDepsGeneration({
              rootDir,
              depsRoot,
              depsHash,
              resolvedEntries: entries,
              allowedRoots: workspace.allowedRoots,
              config,
              runtimeDemands: dplDemand.runtimeDemands ?? void 0
            });
          } else {
            await publishVerifiedDepsGeneration({
              rootDir,
              depsRoot,
              depsHash,
              resolvedEntries: entries,
              allowedRoots: workspace.allowedRoots,
              config
            });
          }
        }
        try {
          const packs = await prepareProductionAutoCorePack({ rootDir, ionifyDir, depsHash, depsRoot, config });
          if (packs.reasons && packs.reasons.length) {
            logWarn(`[deps] Production packs unavailable (${packs.reasons.join(", ")}). Skipping.`);
          } else if (packs.didWork) {
            logInfo(`Production packs ready in ${Date.now() - packsStart}ms (CAS-first, rust-parallel)`);
          } else {
            logInfo(`Production packs ready in ${Date.now() - packsStart}ms (cached)`);
          }
        } catch (err) {
          logWarn(`[deps] WARN: Production pack prep failed: ${String(err)}`);
        }
      } else {
        await ensureOptimizedDeps({
          rootDir,
          ionifyDir,
          depsHash,
          depsRoot,
          config,
          resolvedEntries: entries,
          allowedRoots: workspace.allowedRoots,
          excludeEntryPaths: vendorExclude ?? void 0
        });
        const packsStart2 = Date.now();
        try {
          const packs = await prepareProductionAutoCorePack({
            rootDir,
            ionifyDir,
            depsHash,
            depsRoot,
            config
          });
          if (packs.reasons && packs.reasons.length) {
            logWarn(`[deps] Production packs unavailable (${packs.reasons.join(", ")}). Skipping.`);
          } else if (packs.didWork) {
            logInfo(`Production packs ready in ${Date.now() - packsStart2}ms (CAS-first)`);
          } else {
            logInfo("Production packs ready (cached)");
          }
        } catch (err) {
          logWarn(`[deps] WARN: Production pack prep failed: ${String(err)}`);
        }
      }
    } else {
      await ensureOptimizedDeps({
        rootDir,
        ionifyDir,
        depsHash,
        depsRoot,
        config,
        resolvedEntries: entries,
        allowedRoots: workspace.allowedRoots
      });
      if (vendorPacksManualConfigured) {
        const depsManifestIndexForPacks = loadDepsManifestIndex(depsRoot);
        const packsStart = Date.now();
        try {
          const packs = await prepareProductionManualPacks({
            rootDir,
            ionifyDir,
            depsHash,
            depsRoot,
            config,
            resolvedEntries: entries,
            allowedRoots: workspace.allowedRoots,
            depsManifestIndex: depsManifestIndexForPacks
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
    }
    const depStops = skipDepsAuthorityForCanonicalPlan ? [] : loadDepStopsFromManifest(depsRoot);
    logBuildProfile("depsAuthorityAndPacks", depsPhaseStart);
    if (coldDerivation && !skipDepsAuthorityForCanonicalPlan && native?.graphRecordBatch) {
      const phaseCStart = Date.now();
      const phaseCGraphReady = ensureNativeGraph(
        path26.join(ionifyDir, "graph.db"),
        computeGraphVersion(rawVersionInputs),
        { retryMs: 1500, retryIntervalMs: 50 }
      );
      const depStopById = /* @__PURE__ */ new Map();
      for (const s of depStops) {
        if (!s.artifactHash) continue;
        const depId = toWsModuleId(canonicalFsPath(s.entryPath), workspace.workspaceRoot);
        if (depId) depStopById.set(depId, s.artifactHash);
      }
      const appIds = new Set(coldDerivation.appRecords.map((r) => r.id));
      const depLeafRecords = [];
      const emittedLeaf = /* @__PURE__ */ new Set();
      for (const rec of coldDerivation.appRecords) {
        for (const edge of [...rec.deps ?? [], ...rec.dynamicDeps ?? []]) {
          if (emittedLeaf.has(edge) || appIds.has(edge)) continue;
          const artifactHash = depStopById.get(edge);
          if (artifactHash) {
            emittedLeaf.add(edge);
            depLeafRecords.push({ id: edge, hash: artifactHash, deps: [], dynamicDeps: [], runtimeLinks: [], kind: "dep" });
            continue;
          }
          const edgeAbs = edge.startsWith(WS_MODULE_PREFIX) ? fromWsModuleId(edge, workspace.workspaceRoot) : null;
          if (!edgeAbs || !fs23.existsSync(edgeAbs)) continue;
          const ext = path26.extname(edgeAbs).toLowerCase();
          const isCss = ext === ".css" || ext === ".scss" || ext === ".sass" || ext === ".less";
          emittedLeaf.add(edge);
          depLeafRecords.push({
            id: edge,
            hash: getCacheKey(fs23.readFileSync(edgeAbs)),
            deps: [],
            dynamicDeps: [],
            runtimeLinks: [],
            kind: isCss ? "css" : "asset"
          });
        }
      }
      const admitted = phaseCGraphReady ? native.graphRecordBatch([...coldDerivation.appRecords, ...depLeafRecords]) : -1;
      logBuildProfile("coldCanonicalGraphProjection", phaseCStart);
      logInfo(
        `[C3-c] Phase C graph projection: ready=${phaseCGraphReady} app=${coldDerivation.appRecords.length} depLeaf=${depLeafRecords.length} admitted=${admitted}`
      );
    }
    logTopologyValidationProfile(depsRoot);
    if (options.depsOnly) {
      writeDepsMeasurementArtifacts(depsRoot);
      logInfo(
        `[deps] optimize-all: snapshot ready at .ionify/deps/${depsHash}/ (skipping bundler, no dist/ output).`
      );
      return {
        depsHash,
        canonicalPlan: sourceOnlyCanonicalPlan
      };
    }
    const federationExposeEntries = collectFederationExposeEntryPaths(config, rootDir);
    const buildEntries = Array.from(
      /* @__PURE__ */ new Set([...entries ?? [], ...federationExposeEntries])
    );
    logInfo("Building...");
    const planStart = Date.now();
    const publishedPlanCandidate = earlyPublishedPlan;
    logBuildProfileDuration("publishedProductionPlanReread", 0);
    const publishedPlan = publishedPlanCandidate && !sourceOnlyCanonicalPlan && earlySourceFreshnessAudit?.current === true ? publishedPlanCandidate : null;
    if (publishedPlanCandidate && !publishedPlan) {
      logInfo("[PRA] Published Production Plan source proof is stale; refreshing graph before planning");
    }
    const canonicalMutationPlan = !publishedPlan ? sourceOnlyCanonicalPlan : null;
    let plan = publishedPlan ? publishedPlan : canonicalMutationPlan ? canonicalMutationPlan : await generateBuildPlan(
      buildEntries.length > 0 ? buildEntries : void 0,
      rawVersionInputs,
      depStops,
      buildExternalSpecifiers,
      skipDepsAuthorityForSourceOnlyEdit ? sourceOnlyMutationProof.changedPaths : void 0,
      skipDepsAuthorityForSourceOnlyEdit ? sourceOnlyMutationProof.runtimeMutations : void 0,
      skipDepsAuthorityForSourceOnlyEdit ? publishedPlanCandidate ?? void 0 : void 0,
      skipDepsAuthorityForSourceOnlyEdit ? depsRoot : void 0,
      void 0,
      canonicalBuildContext
    );
    logBuildProfile("generateBuildPlan", planStart);
    if (publishedPlan) {
      logInfo(`[Build] Using published Production Plan (${plan.chunks.length} chunk(s), identity verified)`);
    }
    const totalPlannedModules = plan.chunks.reduce((acc, chunk) => acc + chunk.modules.length, 0);
    logInfo(
      `[Build] Plan ready: entries=${plan.entries.length}, chunks=${plan.chunks.length}, modules=${totalPlannedModules}`
    );
    const readinessRecordReadStart = Date.now();
    const productionReadinessRecord = earlyProductionReadinessRecord;
    logBuildProfile("productionReadinessRecordRead", readinessRecordReadStart);
    const sourceFreshnessPreflightStart = Date.now();
    const sourceFreshnessCurrent = publishedPlan !== null && earlySourceFreshnessAudit?.current === true;
    logBuildProfile("praSourceFreshnessPreflight", sourceFreshnessPreflightStart);
    const verifiedPraForPublishedPlan = publishedPlan !== null && sourceFreshnessCurrent && isVerifiedProductionReadinessForPlan(productionReadinessRecord, {
      configHash,
      workspaceRoot: workspace.workspaceRoot,
      projectRoot: rootDir,
      depsHash,
      plan,
      depsOptimizerOutputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION
    });
    if (verifiedPraForPublishedPlan) {
      logInfo("[PRA] Verified deploy-ready identity for current Production Plan; skipping duplicate canonical dependency readiness probe");
    } else if (productionReadinessRecord?.state === "verified" && publishedPlan !== null && !sourceFreshnessCurrent) {
      logInfo("[PRA] Verified deploy-ready identity found, but source freshness proof is missing or stale; using normal canonical dependency probe");
    }
    const federationGraphStart = Date.now();
    const federationGraph = config?.federation ? new Graph(rawVersionInputs, { ionifyDir }) : null;
    const federationRemoteBindings = config?.federation ? collectFederationRemoteImportBindings(config, rootDir) : /* @__PURE__ */ new Map();
    logBuildProfile("federationGraphSetup", federationGraphStart);
    if (config?.federation && federationGraph) {
      syncFederationGraphNodes(federationGraph, buildFederationConfigGraphNodes(config, rootDir));
      for (const chunk of plan.chunks) {
        for (const mod of chunk.modules) {
          if (mod.kind !== "js") continue;
          let fsPath = typeof mod.fsPath === "string" && mod.fsPath.length > 0 ? mod.fsPath : null;
          if (!fsPath && typeof mod.id === "string" && mod.id.startsWith(WS_MODULE_PREFIX)) {
            fsPath = fromWsModuleId(mod.id, workspace.workspaceRoot);
          }
          const existingNode = fsPath ? federationGraph.getNode(fsPath) : void 0;
          let nextStaticDeps = existingNode?.deps ?? mod.deps ?? [];
          let nextDynamicDeps = existingNode?.dynamicDeps ?? mod.dynamicDeps ?? [];
          if (fsPath && path26.isAbsolute(fsPath) && fs23.existsSync(fsPath)) {
            try {
              const code = fs23.readFileSync(fsPath, "utf8");
              const specs = native?.parseModuleIr ? (native.parseModuleIr(fsPath, code)?.dependencies ?? []).map((dep) => dep.specifier) : extractImports(code, fsPath);
              const { localDeps, externalDeps } = classifyImportSpecifiersForGraph(
                specs,
                fsPath,
                buildExternalSpecifiers
              );
              nextStaticDeps = [...localDeps, ...externalDeps];
              nextDynamicDeps = [];
            } catch {
            }
          }
          const deps = rewriteFederationGraphEdgeIds(nextStaticDeps, federationRemoteBindings);
          const dynamicDeps = rewriteFederationGraphEdgeIds(
            nextDynamicDeps,
            federationRemoteBindings
          );
          if (JSON.stringify(deps) === JSON.stringify(nextStaticDeps) && JSON.stringify(dynamicDeps) === JSON.stringify(nextDynamicDeps)) {
            continue;
          }
          if (fsPath && path26.isAbsolute(fsPath)) {
            federationGraph.recordFile(fsPath, mod.hash ?? existingNode?.hash ?? getCacheKey(mod.id), deps, dynamicDeps, mod.kind);
          } else {
            federationGraph.recordNodeById(mod.id, mod.hash ?? null, deps, dynamicDeps, mod.kind);
          }
        }
      }
    }
    let readinessPlanForIdentity = null;
    if (!verifiedPraForPublishedPlan && !skipDepsAuthorityForCanonicalPlan) {
      const casRoot2 = path26.join(ionifyDir, "cas");
      const canonicalDeps = await prepareCanonicalProductionDependencyPlan({
        plan,
        rootDir,
        ionifyDir,
        depsRoot,
        depsHash,
        resolvedEntries: entries,
        allowedRoots: workspace.allowedRoots,
        casRoot: casRoot2,
        configHash,
        workspaceRoot: workspace.workspaceRoot,
        config,
        vendorMaxBytes: productionChunkPolicy.vendorMaxBytes,
        skipDependencyCoverageRepair: skipDepsAuthorityForCanonicalPlan
      });
      if (canonicalDeps.rerouted > 0 || canonicalDeps.pruned > 0) {
        logInfo(
          `[Build] Deps artifact rerouting: ${canonicalDeps.rerouted} entries rerouted (${canonicalDeps.idRewritten} ids \u2192 artifact identity), ${canonicalDeps.pruned} internal modules pruned${canonicalDeps.sharedPrewarmed > 0 ? `, ${canonicalDeps.sharedPrewarmed} shared artifacts pre-warmed` : ""}`
        );
      }
      logBuildProfileDuration("depsReroute", canonicalDeps.rerouteMs);
      logBuildProfileDuration("canonicalDependencyPlan", canonicalDeps.rerouteMs);
    } else {
      logBuildProfileDuration("depsReroute", 0);
      logBuildProfileDuration("canonicalDependencyPlan", 0);
    }
    const outDir = options.outDir || "dist";
    const absOutDir = path26.resolve(outDir);
    const readinessPlanCloneStart = Date.now();
    readinessPlanForIdentity = plan;
    plan = createEmissionPlanProjection(plan);
    logBuildProfile("readinessPlanClone", readinessPlanCloneStart);
    const moduleRefsById = /* @__PURE__ */ new Map();
    const moduleMetaById = /* @__PURE__ */ new Map();
    const moduleIndexStart = Date.now();
    for (const chunk of plan.chunks) {
      for (const mod of chunk.modules) {
        if (mod.kind !== "js" && mod.kind !== "css") continue;
        let fsPath = typeof mod.fsPath === "string" && mod.fsPath.length > 0 ? mod.fsPath : null;
        if (!fsPath && typeof mod.id === "string" && mod.id.startsWith(WS_MODULE_PREFIX)) {
          fsPath = fromWsModuleId(mod.id, workspace.workspaceRoot);
        }
        if (!fsPath && typeof mod.id === "string" && path26.isAbsolute(mod.id)) {
          fsPath = mod.id;
        }
        if (!fsPath || !path26.isAbsolute(fsPath)) continue;
        mod.fsPath = fsPath;
        const existing = moduleMetaById.get(mod.id);
        if (!existing) {
          moduleMetaById.set(mod.id, {
            fsPath,
            kind: mod.kind,
            hash: typeof mod.hash === "string" && mod.hash.length > 0 ? mod.hash : null,
            proofKind: mod.proofKind ?? null
          });
        }
        const bucket = moduleRefsById.get(mod.id);
        if (bucket) bucket.push(mod);
        else moduleRefsById.set(mod.id, [mod]);
      }
    }
    logBuildProfile("moduleIndex", moduleIndexStart);
    const cssDemandGraphRegisterStart = Date.now();
    const compactCssDemandGraphContent = skipDepsAuthorityForSourceOnlyEdit ? refreshCssDemandGraphContentStamp(
      rootDir,
      sourceOnlyMutationProof.changedPaths
    ) : null;
    let cssDemandGraphRequired;
    let cssDemandRegisteredFiles;
    let cssDemandGraphContent;
    if (compactCssDemandGraphContent) {
      cssDemandGraphRequired = true;
      cssDemandGraphContent = compactCssDemandGraphContent;
      cssDemandRegisteredFiles = compactCssDemandGraphContent.changed ? registerCssDemandGraphSourceFiles(rootDir, [], { stableTopology: true }) : [];
    } else {
      cssDemandGraphRequired = requiresCssDemandGraphContentStamp(
        Array.from(moduleMetaById.values()).filter((meta) => meta.kind === "css").map((meta) => {
          if (!meta.hash) return null;
          const cssMeta = readJsonFile2(
            path26.join(getCasArtifactPath(casRoot, configHash, meta.hash), "meta.json")
          );
          if (!cssMeta || cssMeta.version !== CSS_CAS_META_VERSION || cssMeta.baseHash !== meta.hash || !cssMeta.tailwindGraphContent) {
            return null;
          }
          return {
            enabled: cssMeta.tailwindGraphContent.enabled === true,
            files: Number(cssMeta.tailwindGraphContent.files ?? 0)
          };
        })
      );
      const cssDemandGraphFiles = cssDemandGraphRequired ? Array.from(moduleMetaById.values()).filter((meta) => {
        if (meta.kind !== "js") return false;
        if (meta.fsPath.includes("node_modules") || meta.fsPath.includes("/.ionify/")) return false;
        const clean = meta.fsPath.split("?")[0].split("#")[0].toLowerCase();
        return clean.endsWith(".js") || clean.endsWith(".jsx") || clean.endsWith(".ts") || clean.endsWith(".tsx") || clean.endsWith(".mdx");
      }).map((meta) => meta.fsPath) : [];
      cssDemandRegisteredFiles = registerCssDemandGraphSourceFiles(
        rootDir,
        cssDemandGraphFiles,
        skipDepsAuthorityForSourceOnlyEdit ? { stableTopology: true } : void 0
      );
      cssDemandGraphContent = computeCssDemandGraphContentStamp(
        rootDir,
        skipDepsAuthorityForSourceOnlyEdit ? { stableTopologyChangedFiles: sourceOnlyMutationProof.changedPaths } : void 0
      );
    }
    const cssDemandGraphStamp = cssDemandGraphContent?.stamp ?? null;
    if (isBuildProfileEnabled()) {
      logInfo(
        `[BuildProfile][cssDemandGraph] register_ms=${Date.now() - cssDemandGraphRegisterStart} required=${cssDemandGraphRequired ? 1 : 0} files=${cssDemandGraphContent?.files ?? cssDemandRegisteredFiles.length} stamp=${cssDemandGraphStamp ? cssDemandGraphStamp.slice(0, 12) : "none"} extraction_ms=0 cacheHit=0 cacheMiss=0 tokens=0`
      );
    }
    const moduleOutputs = /* @__PURE__ */ new Map();
    const modulesInPlan = moduleMetaById.size;
    const transformCasProfile = createTransformCasProfile();
    let casHits = 0;
    const sourceOnlyChangedPaths = new Set(
      (skipDepsAuthorityForSourceOnlyEdit ? sourceOnlyMutationProof.changedPaths : []).map((filePath) => path26.resolve(filePath))
    );
    const incrementalHydrationModuleIds = skipDepsAuthorityForSourceOnlyEdit && sourceOnlyChangedPaths.size > 0 ? new Set(
      Array.from(moduleMetaById.entries()).filter(([, meta]) => {
        if (sourceOnlyChangedPaths.has(path26.resolve(meta.fsPath))) return true;
        return meta.kind === "css" && cssDemandGraphContent?.changed === true;
      }).map(([id]) => id)
    ) : null;
    if (incrementalHydrationModuleIds) {
      casHits = Math.max(0, modulesInPlan - incrementalHydrationModuleIds.size);
    }
    if (!skipDepsAuthorityForSourceOnlyEdit) {
      const freshnessStart = Date.now();
      const freshnessCacheFile = path26.join(ionifyDir, "source-freshness.v1.json");
      let freshnessCache = {};
      try {
        const parsed = JSON.parse(fs23.readFileSync(freshnessCacheFile, "utf8"));
        if (parsed && typeof parsed === "object") {
          freshnessCache = parsed;
        }
      } catch {
      }
      let staleCount = 0;
      const nextFreshnessCache = {};
      for (const [id, meta] of moduleMetaById.entries()) {
        if (!meta.hash || !meta.fsPath) continue;
        const fp = meta.fsPath;
        if (fp.includes("node_modules") || fp.includes("/.ionify/")) continue;
        if (meta.kind !== "js" && meta.kind !== "css") continue;
        try {
          const st = fs23.statSync(fp);
          const cacheKey = `${id}
${fp}`;
          const cached = freshnessCache[cacheKey];
          const diskHash = cached && cached.fsPath === fp && cached.dev === st.dev && cached.ino === st.ino && cached.mtimeMs === st.mtimeMs && cached.ctimeMs === st.ctimeMs && cached.size === st.size && typeof cached.hash === "string" && cached.hash.length > 0 ? cached.hash : getCacheKey(fs23.readFileSync(fp));
          nextFreshnessCache[cacheKey] = {
            fsPath: fp,
            dev: st.dev,
            ino: st.ino,
            mtimeMs: st.mtimeMs,
            ctimeMs: st.ctimeMs,
            size: st.size,
            hash: diskHash
          };
          if (diskHash !== meta.hash) {
            meta.hash = diskHash;
            const refs = moduleRefsById.get(id) ?? [];
            for (const ref of refs) ref.hash = diskHash;
            staleCount++;
            if (native?.graphRecord) {
              const firstRef = refs[0];
              const deps = Array.isArray(firstRef?.deps) ? firstRef.deps : [];
              const dynDeps = Array.isArray(firstRef?.dynamicDeps) ? firstRef.dynamicDeps : [];
              try {
                native.graphRecord(id, diskHash, deps, dynDeps, meta.kind, null);
              } catch {
              }
            }
          }
        } catch {
        }
      }
      if (staleCount > 0) {
        logInfo(`[Build] ${staleCount} source module(s) changed since last graph update \u2014 CAS keys refreshed`);
      }
      try {
        fs23.mkdirSync(ionifyDir, { recursive: true });
        const tmpFreshness = `${freshnessCacheFile}.${process.pid}.${Date.now()}.tmp`;
        fs23.writeFileSync(tmpFreshness, `${JSON.stringify(nextFreshnessCache)}
`, "utf8");
        fs23.renameSync(tmpFreshness, freshnessCacheFile);
      } catch {
      }
      logBuildProfile("freshnessScan", freshnessStart);
    } else {
      logBuildProfileDuration("freshnessScan", 0);
    }
    const praOutputProbeStart = Date.now();
    const verifiedPraOutputReuse = verifiedPraForPublishedPlan && productionReadinessRecord ? tryVerifyProductionReadinessOutputReuse(absOutDir, productionReadinessRecord) : null;
    logBuildProfile("praOutputReadinessProbe", praOutputProbeStart);
    if (verifiedPraOutputReuse) {
      logInfo("[PRA] Verified deploy-ready outputs for current Production Plan; skipping duplicate CAS/dist probes");
      logBuildProfileDuration("casBatchCheck", 0);
      logBuildProfileDuration("casHydration", 0);
      logBuildProfileDuration("distReuseProbe", 0);
      logBuildProfileDuration("emitChunksAndFiles", 0);
      logBuildProfileDuration("writeBuildManifest", 0);
      logBuildProfileDuration("writeAssetsManifest", 0);
      logBuildProfileDuration("emitIndexHtml", 0);
      logBuildProfileDuration("publicAssetReadiness", 0);
      logBuildProfileDuration("writeBuildStats", 0);
      logBuildProfileDuration("manifestAssetsStats", 0);
      const outputHashHints2 = collectOutputHashHints(verifiedPraOutputReuse.stats);
      const distProof = productionReadinessRecord.proofs.dist;
      if (distProof.manifestHash) outputHashHints2.set("manifest.json", distProof.manifestHash);
      if (distProof.buildStatsHash) outputHashHints2.set("build.stats.json", distProof.buildStatsHash);
      if (distProof.assetsManifestHash) outputHashHints2.set("manifest.assets.json", distProof.assetsManifestHash);
      if (distProof.indexHtmlHash) outputHashHints2.set("index.html", distProof.indexHtmlHash);
      for (const asset of productionReadinessRecord.proofs.publicAssets.assets) {
        outputHashHints2.set(toPosixPath2(asset.file), asset.hash);
      }
      const coreBuildElapsed2 = Date.now() - buildStart;
      logInfo(`Build plan generated \u2192 ${path26.join(absOutDir, "manifest.json")}`);
      logInfo(`Entries: ${plan.entries.length}, Chunks: ${plan.chunks.length}`);
      logInfo(`Modules in plan: ${modulesInPlan}`);
      logInfo(`CAS hits: PRA verified \u2022 transforms needed: 0`);
      logInfo(`Build complete in ${coreBuildElapsed2}ms`);
      logInfo(`[Build] Time-to-deploy-ready: ${coreBuildElapsed2}ms`);
      logBuildProfileDuration("timeToDeployReady", coreBuildElapsed2);
      const compression2 = await runPostBuildCompression({
        config,
        absOutDir,
        casRoot,
        outputHashHints: outputHashHints2,
        buildStart
      });
      const praEmitStart2 = Date.now();
      try {
        const readinessRecord = createProductionReadinessRecord({
          configHash,
          workspaceRoot: workspace.workspaceRoot,
          projectRoot: rootDir,
          depsHash,
          plan: readinessPlanForIdentity,
          artifacts: verifiedPraOutputReuse.artifacts,
          dist: {
            manifestHash: distProof.manifestHash ?? "",
            buildStatsHash: distProof.buildStatsHash ?? "",
            assetsManifestHash: distProof.assetsManifestHash,
            indexHtmlHash: distProof.indexHtmlHash
          },
          compression: compression2,
          publicAssets: productionReadinessRecord.proofs.publicAssets,
          depsOptimizerOutputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION
        });
        writeProductionReadinessRecord(ionifyDir, readinessRecord);
      } catch (err) {
        logWarn(`[PRA] Skipped deploy-ready.v1 emit: ${err instanceof Error ? err.message : String(err)}`);
      }
      logBuildProfile("praEmit", praEmitStart2);
      const slimmingSaved2 = computeBuildSlimmingSavedPercent(depsRoot, depsHash);
      const vendorPacksSaved2 = computeBuildVendorPackRequestsSavedPercent(depsRoot, depsHash);
      logInfo(`Slimming saved: ${typeof slimmingSaved2 === "number" ? `${slimmingSaved2}%` : "0%"}`);
      logInfo(`Vendor packs saved: ${typeof vendorPacksSaved2 === "number" ? `${vendorPacksSaved2}%` : "0%"} requests`);
      return;
    }
    const defineJobs = [];
    const cssDerivedArtifactHashById = /* @__PURE__ */ new Map();
    const jobs = [];
    const getArtifactHash = (baseHash, kind, dh = defineHash) => {
      if (kind !== "js") return baseHash;
      if (!dh) return baseHash;
      return getCacheKey(`${baseHash}|define:${dh}`);
    };
    const jsProofExpectation = (baseHash, artifactHash) => ({
      sourceHash: baseHash,
      recipeConfigHash: configHash,
      defineHash,
      artifactKind: "js",
      variant: defineHash ? "define" : "base",
      artifactHash,
      recomputeArtifactHash: (sh, kind, dh) => getArtifactHash(sh, kind === "css" ? "css" : "js", dh)
    });
    const jsBaseProofExpectation = (baseHash) => ({
      sourceHash: baseHash,
      recipeConfigHash: configHash,
      defineHash: "",
      artifactKind: "js",
      variant: "base",
      artifactHash: baseHash,
      recomputeArtifactHash: (sh, kind, dh) => getArtifactHash(sh, kind === "css" ? "css" : "js", dh)
    });
    const jsCasFileById = /* @__PURE__ */ new Map();
    for (const [id, meta] of moduleMetaById.entries()) {
      if (incrementalHydrationModuleIds && !incrementalHydrationModuleIds.has(id)) continue;
      if (meta.kind !== "css" && meta.hash) {
        const ah = getArtifactHash(meta.hash, meta.kind);
        jsCasFileById.set(id, path26.join(getCasArtifactPath(casRoot, configHash, ah), "transformed.js"));
      }
    }
    const casExistsMap = /* @__PURE__ */ new Map();
    if (jsCasFileById.size > 0) {
      const batchPaths = Array.from(jsCasFileById.values());
      const casBatchStart = Date.now();
      const batchExists = native.casBatchCheck(batchPaths);
      logBuildProfile("casBatchCheck", casBatchStart);
      for (let i = 0; i < batchPaths.length; i++) {
        casExistsMap.set(batchPaths[i], batchExists[i]);
      }
    }
    const hydrationStart = Date.now();
    for (const [id, meta] of moduleMetaById.entries()) {
      if (incrementalHydrationModuleIds && !incrementalHydrationModuleIds.has(id)) continue;
      const refs = moduleRefsById.get(id) ?? [];
      const baseHashFromPlan = meta.hash;
      const cssNeedsJsWrapper = meta.kind === "css" && isCssModuleFile(meta.fsPath);
      let artifactHashFromPlan = baseHashFromPlan && meta.kind !== "css" ? getArtifactHash(baseHashFromPlan, meta.kind) : null;
      if (meta.kind === "css" && baseHashFromPlan) {
        const baseDir = getCasArtifactPath(casRoot, configHash, baseHashFromPlan);
        let cssMeta = readJsonFile2(path26.join(baseDir, "meta.json"));
        if (!cssMeta) {
          const restoreStart = Date.now();
          const restored = restoreCssArtifactFromGlobalCache(
            configHash,
            baseHashFromPlan,
            casRoot,
            cssNeedsJsWrapper,
            cssDemandGraphStamp
          );
          transformCasProfile.cssGlobalCacheRestoreMs += Date.now() - restoreStart;
          if (restored.restored) {
            transformCasProfile.cssGlobalCacheRestoreHit += 1;
            cssMeta = readJsonFile2(path26.join(baseDir, "meta.json"));
          } else {
            transformCasProfile.cssGlobalCacheRestoreMiss += 1;
          }
        }
        if (cssMeta && cssMeta.version === CSS_CAS_META_VERSION && cssMeta.baseHash === baseHashFromPlan && typeof cssMeta.pipelineHash === "string" && cssMeta.pipelineHash.length > 0 && cssDepProofIsCurrent(cssMeta) && cssMetaAdmitsCurrentTailwindGraph(cssMeta, cssDemandGraphStamp)) {
          const depsAbs = Array.from(
            new Set(
              [...cssMeta.deps ?? [], ...cssMeta.urlDeps ?? []].filter(
                (p) => typeof p === "string" && p.length > 0
              )
            )
          );
          const depsStampHash = computeDepsContentStampHash(
            depsAbs,
            moduleMetaById,
            workspace.workspaceRoot
          );
          artifactHashFromPlan = getCacheKey(
            `css:v3:${id}:${baseHashFromPlan}:${cssMeta.pipelineHash}:${depsStampHash}:${cssNeedsJsWrapper ? 1 : 0}:${metaTailwindStampForRecipe(cssMeta)}`
          );
        }
      }
      if (artifactHashFromPlan) {
        for (const ref of refs) ref.hash = artifactHashFromPlan;
      }
      const casDir = artifactHashFromPlan ? getCasArtifactPath(casRoot, configHash, artifactHashFromPlan) : null;
      const casCssFile = casDir ? path26.join(casDir, "transformed.css") : null;
      const casJsFile = casDir ? path26.join(casDir, "transformed.js") : null;
      if (meta.kind === "css") {
        if (casCssFile && fs23.existsSync(casCssFile)) {
          try {
            const css = fs23.readFileSync(casCssFile, "utf8");
            moduleOutputs.set(id, { code: css, type: "css" });
            casHits += 1;
            if (cssNeedsJsWrapper && casJsFile && !fs23.existsSync(casJsFile)) {
              const tokensFile = path26.join(casDir, "tokens.json");
              const storedTokens = readJsonFile2(tokensFile);
              if (storedTokens) {
                try {
                  fs23.mkdirSync(casDir, { recursive: true });
                  fs23.writeFileSync(casJsFile, renderCssTokensModule(storedTokens), "utf8");
                } catch {
                }
              }
            }
            continue;
          } catch {
          }
        }
        if (baseHashFromPlan && casDir && casCssFile) {
          const baseCasDir = getCasArtifactPath(casRoot, configHash, baseHashFromPlan);
          if (baseCasDir !== casDir) {
            const baseCssArtifact = path26.join(baseCasDir, "transformed.css");
            if (fs23.existsSync(baseCssArtifact)) {
              try {
                const css = fs23.readFileSync(baseCssArtifact, "utf8");
                fs23.mkdirSync(casDir, { recursive: true });
                fs23.writeFileSync(casCssFile, css, "utf8");
                moduleOutputs.set(id, { code: css, type: "css" });
                casHits += 1;
                if (cssNeedsJsWrapper && casJsFile) {
                  const baseTokFile = path26.join(baseCasDir, "tokens.json");
                  const storedTokens = readJsonFile2(baseTokFile);
                  if (storedTokens) {
                    fs23.writeFileSync(casJsFile, renderCssTokensModule(storedTokens), "utf8");
                    try {
                      fs23.writeFileSync(path26.join(casDir, "tokens.json"), JSON.stringify(storedTokens), "utf8");
                    } catch {
                    }
                  }
                }
                continue;
              } catch {
              }
            }
          }
        }
      } else {
        const proofKind = meta.proofKind;
        if (proofKind === "DplContentHash") {
          if (baseHashFromPlan) {
            const dplDir = getCasArtifactPath(casRoot, configHash, baseHashFromPlan);
            const dplFile = path26.join(dplDir, "transformed.js");
            for (const ref of refs) ref.hash = baseHashFromPlan;
            if (fs23.existsSync(dplFile) && casTextFileMatchesHash(dplFile, baseHashFromPlan)) {
              casHits += 1;
              continue;
            }
            if (fs23.existsSync(meta.fsPath)) {
              const bytes = fs23.readFileSync(meta.fsPath, "utf8");
              if (getCacheKey(bytes) === baseHashFromPlan) {
                fs23.mkdirSync(dplDir, { recursive: true });
                fs23.writeFileSync(dplFile, bytes, "utf8");
                casHits += 1;
                continue;
              }
            }
          }
        } else if (proofKind === "TransformArtifactProof") {
          const casFile = casDir ? path26.join(casDir, "transformed.js") : null;
          if (casDir && casFile && baseHashFromPlan && artifactHashFromPlan && (casExistsMap.get(casFile) ?? fs23.existsSync(casFile))) {
            const admission = admitTransformArtifact(casDir, jsProofExpectation(baseHashFromPlan, artifactHashFromPlan));
            if (admission.admissible) {
              for (const ref of refs) ref.admittedOutputHash = admission.proof.outputHash;
              casHits += 1;
              continue;
            }
          }
        } else {
          throw new Error(
            `[G2-C3] Non-self-describing plan: JS consumable '${id}' (${meta.fsPath ?? "?"}) carries no proofKind. A sealed reusable plan must stamp exactly one authority-owned admission contract per consumable module; rebuild to re-stamp (NonReusable).`
          );
        }
      }
      if (meta.kind === "js" && baseHashFromPlan && defineHash) {
        const baseDir = getCasArtifactPath(casRoot, configHash, baseHashFromPlan);
        const baseFile = path26.join(baseDir, "transformed.js");
        if (fs23.existsSync(baseFile) && admitTransformArtifact(baseDir, jsBaseProofExpectation(baseHashFromPlan)).admissible) {
          try {
            const baseCode = fs23.readFileSync(baseFile, "utf8");
            const artifactHash2 = getArtifactHash(baseHashFromPlan, "js");
            for (const ref of refs) ref.hash = artifactHash2;
            defineJobs.push({ id, artifactHash: artifactHash2, baseHash: baseHashFromPlan, baseCode });
            casHits += 1;
            continue;
          } catch {
          }
        }
      }
      const filePath = meta.fsPath;
      if (!fs23.existsSync(filePath)) {
        throw new Error(`Module missing on disk: ${filePath}`);
      }
      const code = fs23.readFileSync(filePath, "utf8");
      const baseHash = baseHashFromPlan ?? getCacheKey(code);
      const artifactHash = meta.kind === "css" ? artifactHashFromPlan ?? baseHash : getArtifactHash(baseHash, meta.kind);
      if (meta.kind !== "css") {
        for (const ref of refs) ref.hash = artifactHash;
      }
      if (meta.kind === "js" && defineHash) {
        const baseDir = getCasArtifactPath(casRoot, configHash, baseHash);
        const baseFile = path26.join(baseDir, "transformed.js");
        if (fs23.existsSync(baseFile) && admitTransformArtifact(baseDir, jsBaseProofExpectation(baseHash)).admissible) {
          try {
            const baseCode = fs23.readFileSync(baseFile, "utf8");
            defineJobs.push({ id, artifactHash, baseHash, baseCode });
            casHits += 1;
            continue;
          } catch {
          }
        }
      }
      jobs.push({
        id,
        filePath,
        ext: path26.extname(filePath),
        code,
        kind: meta.kind,
        baseHash,
        artifactHash,
        cssNeedsJsWrapper: meta.kind === "css" ? cssNeedsJsWrapper : void 0
      });
    }
    logBuildProfile("casHydration", hydrationStart);
    const transformsNeeded = jobs.length;
    const percentHits = modulesInPlan > 0 ? Math.round(casHits * 100 / modulesInPlan) : 100;
    const cssJobs = jobs.filter((job) => job.kind === "css");
    const cssModulesOptionsForWorker = cloneWorkerSafeCssOptions(config?.css?.modules);
    const cssPreprocessorOptionsForWorker = cloneWorkerSafeCssOptions(config?.css?.preprocessorOptions);
    const configuredCssWorkers = Number(process.env.IONIFY_CSS_WORKERS || "");
    const cssWorkerCount = Number.isFinite(configuredCssWorkers) && configuredCssWorkers > 0 ? Math.max(1, Math.min(cssJobs.length || 1, Math.floor(configuredCssWorkers))) : cssJobs.length <= 3 ? 1 : Math.max(1, Math.min(cssJobs.length, Math.max(1, Math.floor(os2.cpus().length / 2))));
    const cssResultsPromise = cssJobs.length > 0 ? (async () => {
      const cssStart = Date.now();
      const cssPool = new TransformWorkerPool({
        size: cssWorkerCount
      });
      try {
        const cssResults = await cssPool.runMany(
          cssJobs.map((job) => ({
            id: job.id,
            filePath: job.filePath,
            ext: job.ext,
            code: job.code,
            rootDir,
            cssModules: job.cssNeedsJsWrapper === true,
            cssModulesOptions: cssModulesOptionsForWorker,
            cssPreprocessorOptions: cssPreprocessorOptionsForWorker,
            // Content override input for CSSA Tailwind graph narrowing.
            cssDemandGraphFiles: cssDemandRegisteredFiles,
            // Freshness/identity proof for that content set (main-process computed).
            cssDemandGraphStamp
          }))
        );
        transformCasProfile.cssCompileWallMs += Date.now() - cssStart;
        transformCasProfile.cssWorkerJobs += cssJobs.length;
        for (const result of cssResults) {
          const deps = Array.isArray(result.deps) ? result.deps.filter((p) => typeof p === "string" && p.length > 0) : [];
          const urlDeps = Array.isArray(result.urlDeps) ? result.urlDeps.filter((p) => typeof p === "string" && p.length > 0) : [];
          const pipelineHash = typeof result.pipelineHash === "string" && result.pipelineHash.length > 0 ? result.pipelineHash : "0";
          const demandStart = Date.now();
          result.cssDemand = buildCssDemandAnalysis({
            rootDir,
            cssFile: result.filePath,
            cssHash: getCacheKey(cssJobs.find((job) => job.id === result.id)?.code ?? ""),
            pipelineHash,
            deps: Array.from(/* @__PURE__ */ new Set([...deps, ...urlDeps]))
          });
          if (result.cssProfile && typeof result.cssProfile === "object") {
            result.cssProfile.cssDemandProofMs = Number(result.cssProfile.cssDemandProofMs ?? 0) + (Date.now() - demandStart);
          }
          addCssCompileProfile(transformCasProfile, result.cssProfile);
        }
        return cssResults;
      } catch (err) {
        transformCasProfile.cssCompileWallMs += Date.now() - cssStart;
        throw err;
      } finally {
        await cssPool.close();
      }
    })() : null;
    const defineStart = Date.now();
    for (const job of defineJobs) {
      const cacheDir = getCasArtifactPath(casRoot, configHash, job.artifactHash);
      try {
        const proof = writeTransformArtifact({
          dir: cacheDir,
          bytes: applyDefineReplacements(job.baseCode, defineConfig),
          map: null,
          identity: {
            sourceHash: job.baseHash,
            recipeConfigHash: configHash,
            defineHash,
            artifactKind: "js",
            variant: "define"
          }
        });
        for (const ref of moduleRefsById.get(job.id) ?? []) ref.admittedOutputHash = proof.outputHash;
      } catch {
      }
    }
    if (defineJobs.length > 0) {
      logBuildProfile("defineVariantDerive", defineStart);
    }
    if (jobs.length > 0) {
      const transformStart = Date.now();
      const transformResultsById = /* @__PURE__ */ new Map();
      const nativeHandledIds = /* @__PURE__ */ new Set();
      const jobById = new Map(jobs.map((job) => [job.id, job]));
      const jsJobs = jobs.filter((job) => job.kind === "js");
      const nativeTransformBatch = native?.nativeTransformBatch;
      const reusableMutationByPath = new Map(
        // F3-A: reuse the canonical producer's bytes whenever THIS build's
        // mutation proof produced them (`.ok`), not only on the source-only fast
        // path. A topology/demand change requires Graph + DPL re-admission but
        // does NOT invalidate Transform bytes already produced for the same
        // current source and within-build recipe context. Tier-1 stays a
        // materializer; the sourceHash guard + error check below keep it
        // fail-closed to `nativeTransformBatch`.
        (sourceOnlyMutationProof.ok ? sourceOnlyMutationProof.runtimeMutations : []).flatMap((mutation) => {
          const filePath = mutation.filePath ?? mutation.file_path;
          const sourceHash = mutation.sourceHash ?? mutation.source_hash;
          if (!filePath || !sourceHash || mutation.error || typeof mutation.code !== "string") return [];
          return [[canonicalFsPath(filePath), { ...mutation, sourceHash }]];
        })
      );
      for (const job of jsJobs) {
        const reusable = reusableMutationByPath.get(canonicalFsPath(job.filePath));
        if (!reusable || reusable.sourceHash !== getCacheKey(job.code)) continue;
        nativeHandledIds.add(job.id);
        transformResultsById.set(job.id, {
          id: job.id,
          filePath: reusable.filePath ?? reusable.file_path ?? job.filePath,
          code: reusable.code,
          map: reusable.map ?? void 0,
          type: "js"
        });
        transformCasProfile.nativeJsTransformReuseJobs += 1;
      }
      const nativeTransformJobs = jsJobs.filter((job) => !nativeHandledIds.has(job.id));
      if (typeof nativeTransformBatch === "function" && nativeTransformJobs.length > 0) {
        try {
          const nativeResults = profileElapsed(
            transformCasProfile,
            "nativeJsTransformMs",
            () => nativeTransformBatch(
              nativeTransformJobs.map((job) => ({
                id: job.id,
                filePath: job.filePath,
                ext: job.ext,
                code: job.code
              })),
              parserMode
            )
          );
          transformCasProfile.nativeJsTransformJobs += nativeTransformJobs.length;
          for (const result of nativeResults) {
            const job = jobById.get(result.id);
            if (!job) continue;
            nativeHandledIds.add(result.id);
            transformResultsById.set(result.id, {
              id: result.id,
              filePath: result.filePath ?? result.file_path ?? job.filePath,
              code: result.code,
              map: result.map ?? void 0,
              type: result.type ?? result.kind ?? "js",
              error: result.error ?? void 0
            });
          }
          if (nativeHandledIds.size > 0) {
            logInfo(`[Build] Native transform batch handled ${nativeHandledIds.size} JS module(s)`);
          }
        } catch (err) {
          logWarn(
            `[Build] Native transform batch unavailable; falling back to worker transforms (${err instanceof Error ? err.message : String(err)})`
          );
        }
      }
      if (cssResultsPromise) {
        const cssResults = await cssResultsPromise;
        for (const result of cssResults) {
          transformResultsById.set(result.id, result);
        }
      }
      const workerJobs = jobs.filter((job) => job.kind !== "css" && (job.kind !== "js" || !nativeHandledIds.has(job.id)));
      if (workerJobs.length > 0) {
        const pool = new TransformWorkerPool();
        try {
          const workerStart = Date.now();
          const results = await pool.runMany(
            workerJobs.map((job) => ({
              id: job.id,
              filePath: job.filePath,
              ext: job.ext,
              code: job.code
            }))
          );
          transformCasProfile.workerTransformMs += Date.now() - workerStart;
          transformCasProfile.workerTransformJobs += workerJobs.length;
          for (const result of results) {
            transformResultsById.set(result.id, result);
          }
        } finally {
          await pool.close();
        }
      }
      for (const job of jobs) {
        const result = transformResultsById.get(job.id);
        if (!result) {
          throw new Error(`Transform failed for ${job.filePath}: no transform result returned`);
        }
        if (result.error) {
          throw new Error(`Transform failed for ${result.filePath}: ${result.error}`);
        }
        const isJs = (result.type ?? "js") === "js";
        if (isJs) {
          const baseProof = writeTransformArtifact({
            dir: getCasArtifactPath(casRoot, configHash, job.baseHash),
            bytes: result.code,
            map: result.map ?? null,
            identity: {
              sourceHash: job.baseHash,
              recipeConfigHash: configHash,
              defineHash: "",
              artifactKind: "js",
              variant: "base"
            }
          });
          const finalCode2 = profileElapsed(
            transformCasProfile,
            "defineReplacementMs",
            () => applyDefineReplacements(result.code, defineConfig)
          );
          transformCasProfile.defineReplacementCalls += 1;
          let consumedOutputHash = baseProof.outputHash;
          if (job.artifactHash !== job.baseHash) {
            const variantProof = writeTransformArtifact({
              dir: getCasArtifactPath(casRoot, configHash, job.artifactHash),
              bytes: finalCode2,
              map: result.map && finalCode2 === result.code ? result.map : null,
              identity: {
                sourceHash: job.baseHash,
                recipeConfigHash: configHash,
                defineHash,
                artifactKind: "js",
                variant: "define"
              }
            });
            consumedOutputHash = variantProof.outputHash;
          }
          for (const ref of moduleRefsById.get(job.id) ?? []) ref.admittedOutputHash = consumedOutputHash;
        } else {
          const deps = Array.isArray(result.deps) ? result.deps.filter((p) => typeof p === "string" && p.length > 0) : [];
          const urlDeps = Array.isArray(result.urlDeps) ? result.urlDeps.filter((p) => typeof p === "string" && p.length > 0) : [];
          const pipelineHash = typeof result.pipelineHash === "string" && result.pipelineHash.length > 0 ? result.pipelineHash : "0";
          const cssDemand = result.cssDemand;
          const cssDemandProfile = cssDemand?.profile;
          if (cssDemandProfile && typeof cssDemandProfile === "object") {
            transformCasProfile.cssDemandExtractionMs += Number(cssDemandProfile.extractionMs ?? 0);
            transformCasProfile.cssDemandFilesScanned += Number(cssDemandProfile.filesScanned ?? 0);
            transformCasProfile.cssDemandCacheHit += Number(cssDemandProfile.cacheHits ?? 0);
            transformCasProfile.cssDemandCacheMiss += Number(cssDemandProfile.cacheMisses ?? 0);
            transformCasProfile.cssDemandTokens += Number(cssDemandProfile.tokens ?? 0);
            transformCasProfile.cssDemandProofWriteMs += Number(cssDemandProfile.proofWriteMs ?? 0);
          }
          const tailwindGraphContent = result.tailwindGraphContent;
          if (tailwindGraphContent && typeof tailwindGraphContent === "object") {
            transformCasProfile.cssTailwindGraphContentMs += Number(tailwindGraphContent.ms ?? 0);
            transformCasProfile.cssTailwindGraphContentFiles += Number(tailwindGraphContent.files ?? 0);
            transformCasProfile.cssTailwindGraphContentPlugins += Number(tailwindGraphContent.plugins ?? 0);
            if (tailwindGraphContent.enabled === true) transformCasProfile.cssTailwindGraphContentOptimized += 1;
            if (tailwindGraphContent.fallbackReason) transformCasProfile.cssTailwindGraphContentFallbacks += 1;
          }
          const depsAbs = profileElapsed(
            transformCasProfile,
            "artifactHashBookkeepingMs",
            () => Array.from(new Set([...deps, ...urlDeps].map((p) => path26.resolve(p))))
          );
          transformCasProfile.artifactHashBookkeepingCalls += 1;
          profileElapsed(
            transformCasProfile,
            "artifactHashBookkeepingMs",
            () => recordStructuralGraphFiles(depsAbs, workspace.workspaceRoot, configHash)
          );
          transformCasProfile.artifactHashBookkeepingCalls += 1;
          const depsStampHash = profileElapsed(
            transformCasProfile,
            "artifactHashBookkeepingMs",
            () => computeDepsContentStampHash(
              depsAbs,
              moduleMetaById,
              workspace.workspaceRoot
            )
          );
          transformCasProfile.artifactHashBookkeepingCalls += 1;
          const cssNeedsJsWrapper = job.cssNeedsJsWrapper === true;
          const artifactHash = profileElapsed(
            transformCasProfile,
            "artifactHashBookkeepingMs",
            () => getCacheKey(
              `css:v3:${job.id}:${job.baseHash}:${pipelineHash}:${depsStampHash}:${cssNeedsJsWrapper ? 1 : 0}:${metaTailwindStampForRecipe({ tailwindGraphContent })}`
            )
          );
          transformCasProfile.artifactHashBookkeepingCalls += 1;
          const artifactBytesHash = profileElapsed(
            transformCasProfile,
            "artifactHashBookkeepingMs",
            () => getCacheKey(result.code)
          );
          transformCasProfile.artifactHashBookkeepingCalls += 1;
          cssDerivedArtifactHashById.set(job.id, artifactHash);
          const baseDir = profileElapsed(
            transformCasProfile,
            "artifactHashBookkeepingMs",
            () => getCasArtifactPath(casRoot, configHash, job.baseHash)
          );
          transformCasProfile.artifactHashBookkeepingCalls += 1;
          profileCasMkdir(transformCasProfile, baseDir);
          const meta = {
            version: CSS_CAS_META_VERSION,
            baseHash: job.baseHash,
            artifactHash,
            artifactBytesHash,
            pipelineHash,
            depsStampHash,
            deps: depsAbs.sort(),
            urlDeps: Array.from(new Set(urlDeps.map((p) => path26.resolve(p)))).sort(),
            depsProof: buildCssCasDepProof(depsAbs, moduleMetaById, workspace.workspaceRoot),
            modules: cssNeedsJsWrapper,
            generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
            cssDemand: cssDemand?.proof ? {
              proofVersion: Number(cssDemand.proof.proofVersion ?? 0),
              extractorVersion: Number(cssDemand.proof.extractorVersion ?? 0),
              classDemandHash: String(cssDemand.proof.classDemandHash ?? ""),
              dependencyHash: String(cssDemand.proof.dependencyHash ?? ""),
              tokenCount: Number(cssDemand.proof.tokenCount ?? 0),
              sourceFileCount: Array.isArray(cssDemand.proof.sourceFiles) ? cssDemand.proof.sourceFiles.length : 0,
              uncertain: Boolean(cssDemand.proof.uncertain),
              uncertaintyReasons: Array.isArray(cssDemand.proof.uncertaintyReasons) ? cssDemand.proof.uncertaintyReasons.map((reason) => String(reason)).sort() : []
            } : null,
            tailwindGraphContent: tailwindGraphContent ? {
              enabled: tailwindGraphContent.enabled === true,
              files: Number(tailwindGraphContent.files ?? 0),
              plugins: Number(tailwindGraphContent.plugins ?? 0),
              configPath: typeof tailwindGraphContent.configPath === "string" ? tailwindGraphContent.configPath : null,
              fallbackReason: typeof tailwindGraphContent.fallbackReason === "string" ? tailwindGraphContent.fallbackReason : null,
              stamp: typeof tailwindGraphContent.stamp === "string" && tailwindGraphContent.stamp.length > 0 ? tailwindGraphContent.stamp : null
            } : null
          };
          profileJsonCasWrite(transformCasProfile, path26.join(baseDir, "meta.json"), meta, "base");
          const artifactDir = profileElapsed(
            transformCasProfile,
            "artifactHashBookkeepingMs",
            () => getCasArtifactPath(casRoot, configHash, artifactHash)
          );
          transformCasProfile.artifactHashBookkeepingCalls += 1;
          profileCasMkdir(transformCasProfile, artifactDir);
          profileCasWrite(transformCasProfile, path26.join(artifactDir, "transformed.css"), result.code, "variant");
          if (cssNeedsJsWrapper) {
            const tokens = result.tokens && typeof result.tokens === "object" ? result.tokens : {};
            const js = renderCssTokensModule(tokens);
            profileCasWrite(transformCasProfile, path26.join(artifactDir, "transformed.js"), js, "variant");
            profileJsonCasWrite(transformCasProfile, path26.join(artifactDir, "tokens.json"), tokens, "variant");
          }
          const globalWriteStart = Date.now();
          const globalFiles = writeCssArtifactToGlobalCache(
            configHash,
            job.baseHash,
            artifactHash,
            casRoot,
            cssNeedsJsWrapper
          );
          transformCasProfile.cssGlobalCacheWriteMs += Date.now() - globalWriteStart;
          transformCasProfile.cssGlobalCacheWriteFiles += globalFiles;
          const refs = moduleRefsById.get(job.id) ?? [];
          for (const ref of refs) ref.hash = artifactHash;
          job.artifactHash = artifactHash;
        }
        const finalCode = isJs ? profileElapsed(
          transformCasProfile,
          "defineReplacementMs",
          () => applyDefineReplacements(result.code, defineConfig)
        ) : result.code;
        if (isJs) transformCasProfile.defineReplacementCalls += 1;
        moduleOutputs.set(job.id, { code: finalCode, type: result.type });
      }
      logBuildProfile("transformsAndCasWrites", transformStart);
      logTransformCasProfile(transformCasProfile);
    }
    if (jobs.length === 0 && (transformCasProfile.cssGlobalCacheRestoreHit > 0 || transformCasProfile.cssGlobalCacheRestoreMiss > 0 || transformCasProfile.cssGlobalCacheRestoreMs > 0)) {
      logTransformCasProfile(transformCasProfile);
    }
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
      const sample = Array.from(cssDerivedArtifactHashById.entries()).slice(0, 5).map(([id, hash]) => `${id}:${hash.slice(0, 8)}`).join(", ");
      logInfo(`[Build][css] derived artifacts: ${sample}`);
      const missing = plan.chunks.flatMap((c) => c.modules).filter((m) => m.kind === "css" && isCssModuleFile(m.fsPath ?? "")).filter((m) => !m.hash || typeof m.hash !== "string" || m.hash.length === 0);
      if (missing.length) {
        logWarn(`[Build][css] WARN: missing hashes for ${missing.length} CSS module(s)`);
      }
    }
    const emitPreparationStart = Date.now();
    const buildMinifyRaw = config?.build?.minify;
    const buildMinifyEnabled = buildMinifyRaw === false ? false : true;
    const minifyEnabled = optLevel !== null ? optLevel !== 0 : buildMinifyEnabled;
    const mangleEnabled = minifyEnabled;
    const nativeExternalModules = collectNativeExternalModules(plan, buildExternalSpecifiers);
    const federationExposeEntryIds = collectFederationExposeEntryPaths(config, rootDir).map((entry) => toWsModuleId(entry, workspace.workspaceRoot)).filter((entryId) => typeof entryId === "string" && entryId.length > 0);
    const hostEntryIds = (entries ?? []).map((entry) => toWsModuleId(entry, workspace.workspaceRoot)).filter((entryId) => typeof entryId === "string" && entryId.length > 0);
    const incrementalChunkIdSet = skipDepsAuthorityForSourceOnlyEdit && sourceMutationOutputBase && sourceMutationPlannerChunkIds && !config?.federation ? new Set(sourceMutationPlannerChunkIds) : null;
    if (incrementalChunkIdSet && cssJobs.length > 0) {
      const changedCssIds = new Set(cssJobs.map((job) => job.id));
      for (const chunk of plan.chunks) {
        if (chunk.css.some((cssId) => changedCssIds.has(cssId))) {
          incrementalChunkIdSet.add(chunk.id);
        }
      }
    }
    const incrementalChunkIds = incrementalChunkIdSet ? Array.from(incrementalChunkIdSet).sort() : null;
    const changedCssModuleIds = new Set(
      incrementalHydrationModuleIds ? Array.from(incrementalHydrationModuleIds).filter(
        (moduleId) => moduleMetaById.get(moduleId)?.kind === "css"
      ) : []
    );
    const verifiedResourceStableChunkIds = incrementalChunkIdSet && sourceMutationOutputBase ? plan.chunks.filter(
      (chunk) => incrementalChunkIdSet.has(chunk.id) && chunk.css.every((cssId) => !changedCssModuleIds.has(cssId))
    ).map((chunk) => chunk.id).sort() : [];
    logBuildProfileText(
      "incrementalChunkPublication",
      incrementalChunkIds ? `admitted:${incrementalChunkIds.length},resources-stable:${verifiedResourceStableChunkIds.length}` : "full-emission"
    );
    logBuildProfile("emitPreparation", emitPreparationStart);
    const emitStart = Date.now();
    logBuildProfileDuration("distReuseProbe", 0);
    let emittedPlan = plan;
    logInfo(`[Build] Emitting chunks via native bundler`);
    const { artifacts: baseArtifacts, stats: baseStats } = await emitChunks(absOutDir, plan, moduleOutputs, {
      casRoot,
      versionHash: configHash,
      nativePublicationContext: incrementalChunkIds && sourceMutationPublicationContext ? sourceMutationPublicationContext : void 0,
      nativeOptions: {
        minifier,
        minify: minifyEnabled,
        mangle: mangleEnabled,
        treeshake,
        scopeHoist,
        externalModules: nativeExternalModules,
        federationExposeEntries: federationExposeEntryIds,
        incrementalChunkIds: incrementalChunkIds ?? void 0,
        incrementalOnly: incrementalChunkIds ? true : void 0
      },
      incrementalBase: incrementalChunkIds && sourceMutationOutputBase ? {
        ...sourceMutationOutputBase,
        verifiedResourceStableChunkIds
      } : void 0
    });
    let artifacts = baseArtifacts;
    let combinedStats = { ...baseStats };
    logBuildProfile("emitChunksAndFiles", emitStart);
    let federationManifest = buildFederationBuildManifest({
      config,
      rootDir,
      workspaceRoot: workspace.workspaceRoot,
      outDir: absOutDir,
      plan: emittedPlan,
      artifacts,
      hostEntryIds
    });
    if (federationManifest?.container?.entry) {
      const containerSpec = buildFederationContainerBuildSpec(federationManifest, absOutDir);
      if (containerSpec) {
        const containerPlan = {
          entries: [containerSpec.moduleId],
          chunks: [
            {
              id: containerSpec.chunkId,
              entry: true,
              shared: false,
              consumers: [containerSpec.moduleId],
              css: [],
              assets: [],
              modules: [
                {
                  id: containerSpec.moduleId,
                  fsPath: containerSpec.moduleId,
                  hash: containerSpec.contractHash,
                  kind: "js",
                  deps: [],
                  dynamicDeps: []
                }
              ]
            }
          ]
        };
        const { artifacts: containerArtifacts, stats: containerStats } = await emitChunks(
          absOutDir,
          containerPlan,
          /* @__PURE__ */ new Map([[containerSpec.moduleId, { code: containerSpec.source, type: "js" }]]),
          {
            casRoot,
            versionHash: configHash,
            nativeOptions: {
              minifier,
              minify: minifyEnabled,
              mangle: mangleEnabled,
              treeshake,
              scopeHoist,
              virtualModuleIds: [containerSpec.moduleId],
              virtualModuleSources: [containerSpec.source]
            }
          }
        );
        emittedPlan = {
          entries: plan.entries.slice(),
          chunks: [...plan.chunks, ...containerPlan.chunks]
        };
        artifacts = [...artifacts, ...containerArtifacts];
        combinedStats = { ...combinedStats, ...containerStats };
        federationManifest = buildFederationBuildManifest({
          config,
          rootDir,
          workspaceRoot: workspace.workspaceRoot,
          outDir: absOutDir,
          plan: emittedPlan,
          artifacts,
          hostEntryIds
        });
      }
    }
    if (config?.federation && federationGraph) {
      syncFederationGraphNodes(
        federationGraph,
        mergeFederationGraphNodes(
          buildFederationConfigGraphNodes(config, rootDir),
          buildFederationManifestGraphNodes(federationManifest)
        )
      );
      federationGraph.flush();
    }
    const manifestStart = Date.now();
    const outputHashHints = collectOutputHashHints(combinedStats);
    const buildManifestStart = Date.now();
    const reusableRoutingManifest = incrementalChunkIds && sourceMutationOutputBase && !federationManifest ? sourceMutationOutputBase.routingManifest : null;
    const buildManifestInfo = reusableRoutingManifest ?? await writeBuildManifest(absOutDir, emittedPlan, artifacts, {
      federation: federationManifest
    });
    logBuildProfile("writeBuildManifest", buildManifestStart);
    recordOutputHashHint(
      outputHashHints,
      buildManifestInfo
    );
    const assetsManifestStart = Date.now();
    const assetsManifestInfo = await writeAssetsManifest(absOutDir, artifacts);
    logBuildProfile("writeAssetsManifest", assetsManifestStart);
    recordOutputHashHint(outputHashHints, assetsManifestInfo);
    const indexHtmlStart = Date.now();
    const indexHtmlInfo = await emitIndexHtml({
      rootDir,
      outDir: absOutDir,
      entries: entries ?? [],
      hostEntryIds,
      plan: emittedPlan,
      artifacts,
      envValues,
      envPrefix
    });
    logBuildProfile("emitIndexHtml", indexHtmlStart);
    recordOutputHashHint(outputHashHints, indexHtmlInfo);
    const previousPublicAssetSource = Array.isArray(combinedStats.publicAssets) ? combinedStats.publicAssets : productionReadinessRecord?.proofs.publicAssets.assets;
    const previousPublicAssets = Array.isArray(previousPublicAssetSource) ? previousPublicAssetSource.filter(
      (asset) => asset && typeof asset === "object" && typeof asset.file === "string" && typeof asset.bytes === "number" && typeof asset.hash === "string"
    ) : [];
    const publicCopyStart = Date.now();
    const publicCopy = await copyPublicDirToOutDir(publicDirAbs, absOutDir, previousPublicAssets);
    logBuildProfile("publicAssetReadiness", publicCopyStart);
    if (publicCopy.assets.length > 0) {
      combinedStats.publicAssets = publicCopy.assets;
      for (const asset of publicCopy.assets) {
        outputHashHints.set(asset.file, asset.hash);
      }
    }
    const statsWriteStart = Date.now();
    const statsJson = JSON.stringify(combinedStats, null, 2);
    await writeTextFileIfChanged2(path26.join(absOutDir, "build.stats.json"), statsJson);
    const buildStatsHash = getCacheKey(statsJson);
    outputHashHints.set("build.stats.json", buildStatsHash);
    logBuildProfile("writeBuildStats", statsWriteStart);
    logBuildProfile("manifestAssetsStats", manifestStart);
    const coreBuildElapsed = Date.now() - buildStart;
    logInfo(`Build plan generated \u2192 ${path26.join(absOutDir, "manifest.json")}`);
    logInfo(`Entries: ${plan.entries.length}, Chunks: ${plan.chunks.length}`);
    logInfo(`Modules in plan: ${modulesInPlan}`);
    logInfo(`CAS hits: ${casHits} (${percentHits}%) \u2022 transforms needed: ${transformsNeeded}`);
    logInfo(`Build complete in ${coreBuildElapsed}ms`);
    logInfo(`[Build] Time-to-deploy-ready: ${coreBuildElapsed}ms`);
    logBuildProfileDuration("timeToDeployReady", coreBuildElapsed);
    const compression = await runPostBuildCompression({
      config,
      absOutDir,
      casRoot,
      outputHashHints,
      buildStart
    });
    if (publishedPlan === null || !sourceFreshnessCurrent) {
      try {
        writeProductionBuildPlanProof(
          ionifyDir,
          productionPublicationIdentity,
          readinessPlanForIdentity ?? plan,
          { plan: Date.now() - planStart }
        );
      } catch (err) {
        logWarn(`[Planner] Skipped production plan proof emit: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const praEmitStart = Date.now();
    try {
      const readinessRecord = createProductionReadinessRecord({
        configHash,
        workspaceRoot: workspace.workspaceRoot,
        projectRoot: rootDir,
        depsHash,
        plan: readinessPlanForIdentity ?? emittedPlan,
        artifacts,
        dist: {
          manifestHash: buildManifestInfo?.hash ?? hashFileIfExists(path26.join(absOutDir, "manifest.json")) ?? "",
          buildStatsHash,
          assetsManifestHash: assetsManifestInfo?.hash ?? hashFileIfExists(path26.join(absOutDir, "manifest.assets.json")),
          indexHtmlHash: indexHtmlInfo?.hash ?? hashFileIfExists(path26.join(absOutDir, "index.html"))
        },
        compression: {
          state: compression.state,
          manifestHash: compression.manifestHash
        },
        publicAssets: {
          assets: publicCopy.assets,
          conflicts: publicCopy.conflicts
        },
        depsOptimizerOutputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION
      });
      writeProductionReadinessRecord(ionifyDir, readinessRecord);
    } catch (err) {
      logWarn(`[PRA] Skipped deploy-ready.v1 emit: ${err instanceof Error ? err.message : String(err)}`);
    }
    logBuildProfile("praEmit", praEmitStart);
    const slimmingSaved = computeBuildSlimmingSavedPercent(depsRoot, depsHash);
    const vendorPacksSaved = computeBuildVendorPackRequestsSavedPercent(depsRoot, depsHash);
    logInfo(`Slimming saved: ${typeof slimmingSaved === "number" ? `${slimmingSaved}%` : "0%"}`);
    logInfo(`Vendor packs saved: ${typeof vendorPacksSaved === "number" ? `${vendorPacksSaved}%` : "0%"} requests`);
  } catch (err) {
    logError("ionify build failed", err);
    throw err;
  }
}
async function runPostBuildCompression(options) {
  const precompressRaw = options.config?.build?.precompress;
  const precompressEnabled = precompressRaw !== false;
  let compressionState = precompressEnabled ? "missing" : "skipped";
  let compressionManifestHash = null;
  const precompressConfig = precompressRaw && typeof precompressRaw === "object" && !Array.isArray(precompressRaw) ? precompressRaw : null;
  if (!precompressEnabled) {
    return { state: compressionState, manifestHash: compressionManifestHash };
  }
  const thresholdRaw = precompressConfig?.thresholdBytes;
  const thresholdBytes = typeof thresholdRaw === "number" && Number.isFinite(thresholdRaw) ? Math.max(0, Math.floor(thresholdRaw)) : 1024;
  const gzipLevelRaw = precompressConfig?.gzipLevel;
  const gzipLevel = typeof gzipLevelRaw === "number" && Number.isFinite(gzipLevelRaw) ? Math.max(0, Math.min(9, Math.floor(gzipLevelRaw))) : 9;
  const brotliQualityRaw = precompressConfig?.brotliQuality;
  const brotliQuality = typeof brotliQualityRaw === "number" && Number.isFinite(brotliQualityRaw) ? Math.max(0, Math.min(11, Math.floor(brotliQualityRaw))) : 11;
  const concurrency = resolvePrecompressConcurrency(precompressConfig?.concurrency);
  const emitManifest = precompressConfig?.manifest === false ? false : true;
  const nativeCompressBatchFn = native?.compressBatch?.bind(native);
  const nativeCompressor = nativeCompressBatchFn ? (items) => nativeCompressBatchFn(
    items.map((it) => ({
      id: it.id,
      bytes: it.bytes,
      brotliQuality: it.brotliQuality,
      gzipLevel: it.gzipLevel
    }))
  ) : void 0;
  const compressStart = Date.now();
  const report = await precompressBuildOutputs(options.absOutDir, {
    casRoot: options.casRoot,
    thresholdBytes,
    gzipLevel,
    brotliQuality,
    emitManifest,
    concurrency,
    outputHashHints: options.outputHashHints,
    nativeCompressor
  });
  if (emitManifest) {
    compressionManifestHash = hashFileIfExists(path26.join(options.absOutDir, "manifest.compression.json"));
    compressionState = compressionManifestHash ? "verified" : "missing";
  }
  const elapsed = Date.now() - compressStart;
  const backendNote = native?.compressBatch ? " [text=rust]" : "";
  logInfo(
    `[Build][compress]${backendNote} ${report.totals.filesWithSidecars}/${report.totals.filesEligible} files precompressed in ${elapsed}ms (parallel=${report.concurrency}, current=${report.totals.filesAlreadyCurrent}, touched=${report.totals.filesTouched}, cas ${report.totals.casHits} hit/${report.totals.casMisses} miss, copied=${report.totals.sidecarsCopiedFromCas}, compressed=${report.totals.sidecarsCompressed}, br ${formatByteDelta(
      report.totals.brotliOriginalBytes
    )}\u2192${formatByteDelta(report.totals.brotliBytes)}, gzip ${formatByteDelta(
      report.totals.gzipOriginalBytes
    )}\u2192${formatByteDelta(report.totals.gzipBytes)})`
  );
  logInfo(`Build total in ${Date.now() - options.buildStart}ms`);
  return { state: compressionState, manifestHash: compressionManifestHash };
}
function readProjectPackageJson2(rootDir) {
  const pkgPath = path26.join(rootDir, "package.json");
  if (!fs23.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs23.readFileSync(pkgPath, "utf8"));
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
      "react/jsx-dev-runtime"
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
var OPTIMIZABLE_DEP_ENTRY_EXTS = /* @__PURE__ */ new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".json"
]);
function isOptimizableDepEntryPath(entryPath) {
  return OPTIMIZABLE_DEP_ENTRY_EXTS.has(path26.extname(entryPath).toLowerCase());
}
function resolveAutoVendorEntryFsPaths(rootDir, config) {
  if (!native?.resolveModule) return null;
  const optimizeDeps = config?.optimizeDeps ?? {};
  const optimizeExclude = Array.isArray(optimizeDeps.exclude) ? new Set(optimizeDeps.exclude.map((s) => String(s))) : null;
  const pkgJson = readProjectPackageJson2(rootDir);
  const vendorSpecifiers = detectVendorSpecifiers(pkgJson).filter((s) => !optimizeExclude?.has(s));
  if (vendorSpecifiers.length === 0) return /* @__PURE__ */ new Set();
  const result = /* @__PURE__ */ new Set();
  for (const spec of vendorSpecifiers) {
    try {
      const r = native.resolveModule(spec, rootDir);
      const fsPath = r?.fsPath ?? r?.fs_path ?? null;
      if (!fsPath || typeof fsPath !== "string") continue;
      if (!fsPath.includes("node_modules")) continue;
      if (!isOptimizableDepEntryPath(fsPath)) continue;
      result.add(fsPath);
    } catch {
    }
  }
  return result;
}
async function ensureOptimizedDeps(options) {
  const { rootDir, ionifyDir, depsHash, depsRoot, config, resolvedEntries, allowedRoots, excludeEntryPaths } = options;
  const shouldPublishGeneration = options.publishGeneration !== false;
  const sentinelPath = path26.join(depsRoot, ".verified");
  let skipGlobalRestore = false;
  if (fs23.existsSync(sentinelPath)) {
    const freshness = await checkVerifiedDepsSnapshotFreshness({
      rootDir,
      depsRoot,
      resolvedEntries,
      allowedRoots,
      config
    });
    if (freshness.fresh) {
      const checkedLabel = freshness.checked > 0 ? `, checked=${freshness.checked}` : "";
      logInfo(`[deps] Skipping optimization (depsHash=${depsHash} already verified${checkedLabel})`);
      depsMeasurementProfile.cacheMode = "local-verified-warm";
      return;
    }
    try {
      fs23.unlinkSync(sentinelPath);
    } catch {
    }
    skipGlobalRestore = true;
    const missingLabel = freshness.missing.length > 0 ? `, missing=${freshness.missing.length}` : "";
    logWarn(
      `[deps] Verified deps snapshot is stale (${freshness.reason ?? "unknown"}${missingLabel}); repairing`
    );
  }
  if (!skipGlobalRestore && restoreDepArtifactsFromGlobalCache(depsHash, depsRoot, DEPS_OPTIMIZER_OUTPUT_VERSION) && await verifyRestoredDepsSnapshot({
    rootDir,
    depsRoot,
    sentinelPath,
    resolvedEntries,
    allowedRoots,
    config
  })) {
    logInfo(`[deps] Restored from global cache (depsHash=${depsHash})`);
    depsMeasurementProfile.cacheMode = "global-cache-restored-cold";
    return;
  }
  depsMeasurementProfile.cacheMode = depsMeasurementProfile.outputVersionMismatchSeen || hasPriorDepsOutputVersionMismatch(ionifyDir, depsRoot) ? "first-run-after-output-version-bump" : "no-cache-true-cold";
  if (native?.depsPromoteArtifacts) {
    const prevRoot = findPreviousDepsRoot(ionifyDir, depsRoot);
    if (prevRoot) {
      try {
        const result = native.depsPromoteArtifacts(
          prevRoot,
          depsRoot,
          depsHash,
          DEPS_OPTIMIZER_OUTPUT_VERSION
        );
        depsMeasurementProfile.promoted += result.promoted;
        depsMeasurementProfile.promotionSkipped += result.skipped;
        if (result.promoted > 0) {
          depsMeasurementProfile.cacheMode = "cross-depshash-promotion";
          logInfo(
            `[deps] Promoted ${result.promoted} artifacts from previous deps dir (${result.skipped} need re-optimization)`
          );
        }
      } catch {
      }
    }
  }
  if (!native?.resolveModule) return;
  if (!native?.optimizeDependenciesChunked && !native?.optimizeDependenciesBatch && !native?.optimizeDependency) {
    return;
  }
  const pkgJson = readProjectPackageJson2(rootDir);
  const optimizeExclude = Array.isArray(config?.optimizeDeps?.exclude) ? new Set(config.optimizeDeps.exclude.map((s) => String(s))) : null;
  const depSpecifiers = Object.keys(pkgJson?.dependencies ?? {});
  const includeSpecifiers = Array.isArray(config?.optimizeDeps?.include) ? config.optimizeDeps.include.map((s) => String(s)) : [];
  const vendorMode = config?.optimizeDeps?.vendor ?? "auto";
  const vendorSpecifiers = vendorMode === false ? [] : Array.isArray(vendorMode) ? vendorMode.map((s) => String(s)) : vendorMode === "auto" ? detectVendorSpecifiers(pkgJson) : [];
  const allSpecifiers = Array.from(
    new Set([...vendorSpecifiers, ...includeSpecifiers, ...depSpecifiers].map((s) => s.trim()).filter(Boolean))
  ).filter((s) => !optimizeExclude?.has(s));
  const entryPaths = /* @__PURE__ */ new Set();
  for (const spec of allSpecifiers) {
    try {
      const r = native.resolveModule(spec, rootDir);
      const fsPath = r?.fsPath ?? r?.fs_path ?? null;
      if (!fsPath || typeof fsPath !== "string") continue;
      if (!fsPath.includes("node_modules")) continue;
      if (!isOptimizableDepEntryPath(fsPath)) continue;
      entryPaths.add(fsPath);
    } catch {
    }
  }
  const usageEntries = await resolveUsageEntries(rootDir, resolvedEntries);
  if (usageEntries.length > 0) {
    try {
      const scannedEntryPaths = await scanDepEntryPaths({ rootDir, entries: usageEntries, allowedRoots });
      for (const entry of scannedEntryPaths) {
        if (optimizeExclude?.has(entry.packageName)) continue;
        if (!isOptimizableDepEntryPath(entry.entryPath)) continue;
        entryPaths.add(entry.entryPath);
      }
    } catch {
    }
  }
  if (entryPaths.size === 0) {
    if (shouldPublishGeneration) {
      await publishVerifiedDepsGeneration({
        rootDir,
        depsRoot,
        depsHash,
        resolvedEntries,
        allowedRoots,
        config
      });
    }
    return;
  }
  if (excludeEntryPaths && excludeEntryPaths.size > 0) {
    for (const p of excludeEntryPaths) entryPaths.delete(p);
  }
  if (entryPaths.size === 0) {
    if (shouldPublishGeneration) {
      await publishVerifiedDepsGeneration({
        rootDir,
        depsRoot,
        depsHash,
        resolvedEntries,
        allowedRoots,
        config
      });
    }
    return;
  }
  fs23.mkdirSync(depsRoot, { recursive: true });
  const dplDemand = await scanDplUsageDemand({
    rootDir,
    depsRoot,
    depsHash,
    resolvedEntries,
    allowedRoots
  });
  const entries = Array.from(entryPaths).map(
    (entryPath) => withDplUsageDemand(entryPath, depsHash, dplDemand.demandByEntryPath)
  );
  const depsSharedChunksRaw = config?.optimizeDeps?.sharedChunks;
  const depsSharedChunksMode = depsSharedChunksRaw === void 0 || depsSharedChunksRaw === "auto" ? "auto" : depsSharedChunksRaw === true ? "1" : depsSharedChunksRaw === false ? "0" : String(depsSharedChunksRaw);
  const depsSharedChunksEnabled = depsSharedChunksMode !== "0";
  const vendorPacks = config?.optimizeDeps?.vendorPacks;
  const vendorPackV2Enabled = vendorPacks === "auto" || !!vendorPacks && typeof vendorPacks === "object" && !Array.isArray(vendorPacks);
  const avoidGlobalChunked = vendorPackV2Enabled;
  if (depsSharedChunksEnabled && !avoidGlobalChunked && native?.optimizeDependenciesChunked) {
    let optimized = false;
    try {
      native.optimizeDependenciesChunked(entries, ionifyDir);
      optimized = true;
    } catch {
    }
    if (optimized) {
      if (shouldPublishGeneration) {
        await publishVerifiedDepsGeneration({
          rootDir,
          depsRoot,
          depsHash,
          resolvedEntries,
          allowedRoots,
          config,
          runtimeDemands: dplDemand.runtimeDemands ?? void 0
        });
      }
      return;
    }
  }
  if (native?.optimizeDependenciesBatch) {
    let optimized = false;
    try {
      native.optimizeDependenciesBatch(entries, ionifyDir);
      optimized = true;
    } catch {
    }
    if (optimized) {
      if (shouldPublishGeneration) {
        await publishVerifiedDepsGeneration({
          rootDir,
          depsRoot,
          depsHash,
          resolvedEntries,
          allowedRoots,
          config,
          runtimeDemands: dplDemand.runtimeDemands ?? void 0
        });
      }
      return;
    }
  }
  if (native?.optimizeDependency) {
    for (const entry of entries) {
      try {
        native.optimizeDependency(entry.entryPath, depsHash, false, true, ionifyDir);
      } catch {
      }
    }
  }
  if (shouldPublishGeneration) {
    await publishVerifiedDepsGeneration({
      rootDir,
      depsRoot,
      depsHash,
      resolvedEntries,
      allowedRoots,
      config,
      runtimeDemands: dplDemand.runtimeDemands ?? void 0
    });
  }
}
function toPosixPath2(value) {
  return value.split(path26.sep).join("/");
}
var GLOBAL_DEP_CACHE_VERSION = "v1";
var GLOBAL_CSS_ARTIFACT_CACHE_VERSION = "v1";
var globalDepSnapshotSequence = 0;
function getGlobalDepCacheDir(depsHash) {
  return path26.join(os2.homedir(), ".ionify", "global", "dep-artifacts", GLOBAL_DEP_CACHE_VERSION, depsHash);
}
function getGlobalCssBaseDir(configHash, baseHash) {
  return path26.join(
    os2.homedir(),
    ".ionify",
    "global",
    "css-artifacts",
    GLOBAL_CSS_ARTIFACT_CACHE_VERSION,
    configHash,
    "base",
    baseHash
  );
}
function getGlobalCssArtifactDir(configHash, artifactHash) {
  return path26.join(
    os2.homedir(),
    ".ionify",
    "global",
    "css-artifacts",
    GLOBAL_CSS_ARTIFACT_CACHE_VERSION,
    configHash,
    "artifact",
    artifactHash
  );
}
function restoreCssArtifactFromGlobalCache(configHash, baseHash, casRoot, modules, currentGraphStamp) {
  const globalBaseDir = getGlobalCssBaseDir(configHash, baseHash);
  const globalMetaFile = path26.join(globalBaseDir, "meta.json");
  const cssMeta = readJsonFile2(globalMetaFile);
  if (!cssMeta || cssMeta.version !== CSS_CAS_META_VERSION || cssMeta.baseHash !== baseHash || cssMeta.modules !== modules || typeof cssMeta.artifactHash !== "string" || cssMeta.artifactHash.length === 0 || typeof cssMeta.pipelineHash !== "string" || cssMeta.pipelineHash.length === 0 || typeof cssMeta.depsStampHash !== "string" || cssMeta.depsStampHash.length === 0 || !cssDepProofIsCurrent(cssMeta) || !cssMetaAdmitsCurrentTailwindGraph(cssMeta, currentGraphStamp)) {
    return { restored: false, artifactHash: null };
  }
  const artifactHash = cssMeta.artifactHash;
  const globalArtifactDir = getGlobalCssArtifactDir(configHash, artifactHash);
  const globalCssFile = path26.join(globalArtifactDir, "transformed.css");
  if (!fs23.existsSync(globalCssFile)) return { restored: false, artifactHash: null };
  if (cssMeta.artifactBytesHash) {
    try {
      if (getCacheKey(fs23.readFileSync(globalCssFile)) !== cssMeta.artifactBytesHash) {
        return { restored: false, artifactHash: null };
      }
    } catch {
      return { restored: false, artifactHash: null };
    }
  }
  const localBaseDir = getCasArtifactPath(casRoot, configHash, baseHash);
  const localArtifactDir = getCasArtifactPath(casRoot, configHash, artifactHash);
  if (!copyFileWithHardlinkFallback(globalMetaFile, path26.join(localBaseDir, "meta.json"))) {
    return { restored: false, artifactHash: null };
  }
  if (!copyFileWithHardlinkFallback(globalCssFile, path26.join(localArtifactDir, "transformed.css"))) {
    return { restored: false, artifactHash: null };
  }
  if (modules) {
    const globalTokensFile = path26.join(globalArtifactDir, "tokens.json");
    if (!fs23.existsSync(globalTokensFile)) return { restored: false, artifactHash: null };
    if (!copyFileWithHardlinkFallback(globalTokensFile, path26.join(localArtifactDir, "tokens.json"))) {
      return { restored: false, artifactHash: null };
    }
    const globalJsFile = path26.join(globalArtifactDir, "transformed.js");
    if (fs23.existsSync(globalJsFile)) {
      copyFileWithHardlinkFallback(globalJsFile, path26.join(localArtifactDir, "transformed.js"));
    }
  }
  return { restored: true, artifactHash };
}
function writeCssArtifactToGlobalCache(configHash, baseHash, artifactHash, casRoot, modules) {
  let files = 0;
  const localBaseDir = getCasArtifactPath(casRoot, configHash, baseHash);
  const localArtifactDir = getCasArtifactPath(casRoot, configHash, artifactHash);
  const globalBaseDir = getGlobalCssBaseDir(configHash, baseHash);
  const globalArtifactDir = getGlobalCssArtifactDir(configHash, artifactHash);
  if (copyFileWithHardlinkFallback(path26.join(localBaseDir, "meta.json"), path26.join(globalBaseDir, "meta.json"))) files += 1;
  if (copyFileWithHardlinkFallback(
    path26.join(localArtifactDir, "transformed.css"),
    path26.join(globalArtifactDir, "transformed.css")
  )) files += 1;
  if (modules) {
    if (copyFileWithHardlinkFallback(
      path26.join(localArtifactDir, "transformed.js"),
      path26.join(globalArtifactDir, "transformed.js")
    )) files += 1;
    if (copyFileWithHardlinkFallback(path26.join(localArtifactDir, "tokens.json"), path26.join(globalArtifactDir, "tokens.json"))) {
      files += 1;
    }
  }
  return files;
}
function dplSnapshotSatisfiesPublicationContract(depsRoot, outputVersion) {
  const publications = readDplSnapshotPublicationFacts(depsRoot, outputVersion);
  if (publications === null || publications.length === 0) return false;
  try {
    const parsed = JSON.parse(fs23.readFileSync(path26.join(depsRoot, "manifest.json"), "utf8"));
    const entries = parsed?.entries && typeof parsed.entries === "object" ? Object.values(parsed.entries) : [];
    if (entries.length === 0) return false;
    return entries.every((entry) => {
      if (!entry || typeof entry !== "object") return false;
      if (entry.outputVersion !== outputVersion) return false;
      if (typeof entry.outFile !== "string" || entry.outFile.length === 0) return false;
      if (typeof entry.entryPath !== "string" || entry.entryPath.length === 0) return false;
      if (typeof entry.packageName !== "string" || entry.packageName.length === 0) return false;
      if (typeof entry.packageVersion !== "string" || entry.packageVersion.length === 0) return false;
      if (typeof entry.packageSubpath !== "string" || entry.packageSubpath.length === 0) return false;
      if (typeof entry.packageRoot !== "string") return false;
      if (entry.runtimeFormat !== "esm" && entry.runtimeFormat !== "cjs" && entry.runtimeFormat !== "unknown") return false;
      if (entry.sideEffects !== "none" && entry.sideEffects !== "present" && entry.sideEffects !== "unknown") return false;
      if (typeof entry.artifactHash !== "string" || entry.artifactHash.length === 0) return false;
      return validateDepsManifestEntryTopology(entry, depsRoot, outputVersion).ok;
    });
  } catch {
    return false;
  }
}
function removeSnapshotMarker(markerPath) {
  try {
    fs23.unlinkSync(markerPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    return !fs23.existsSync(markerPath);
  }
}
function replaceSnapshotFileAtomic(src, dst, copyOnly = false) {
  fs23.mkdirSync(path26.dirname(dst), { recursive: true });
  const sequence = globalDepSnapshotSequence++;
  const tempPath = path26.join(
    path26.dirname(dst),
    `.${path26.basename(dst)}.tmp-${process.pid}-${sequence}`
  );
  try {
    if (copyOnly) {
      fs23.copyFileSync(src, tempPath);
    } else {
      try {
        fs23.linkSync(src, tempPath);
      } catch {
        fs23.copyFileSync(src, tempPath);
      }
    }
    try {
      fs23.renameSync(tempPath, dst);
    } catch {
      if (!removeSnapshotMarker(dst)) throw new Error(`Cannot replace snapshot file: ${dst}`);
      fs23.renameSync(tempPath, dst);
    }
  } finally {
    try {
      fs23.unlinkSync(tempPath);
    } catch {
    }
  }
}
function snapshotEntryIsMutableControl(entry) {
  return entry === ".verified" || entry.endsWith(".json");
}
function restoreDepArtifactsSnapshot(globalDir, localDepsRoot, outputVersion) {
  const globalSentinel = path26.join(globalDir, ".verified");
  if (!fs23.existsSync(globalSentinel)) return false;
  if (!dplSnapshotSatisfiesPublicationContract(globalDir, outputVersion)) {
    removeSnapshotMarker(globalSentinel);
    return false;
  }
  try {
    fs23.mkdirSync(localDepsRoot, { recursive: true });
    if (!removeSnapshotMarker(path26.join(localDepsRoot, ".verified"))) return false;
    const entries = fs23.readdirSync(globalDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".verified") continue;
      if (!entry.isFile()) return false;
      const src = path26.join(globalDir, entry.name);
      const dst = path26.join(localDepsRoot, entry.name);
      replaceSnapshotFileAtomic(src, dst, snapshotEntryIsMutableControl(entry.name));
    }
    return true;
  } catch {
    removeSnapshotMarker(path26.join(localDepsRoot, ".verified"));
    return false;
  }
}
function restoreDepArtifactsFromGlobalCache(depsHash, localDepsRoot, outputVersion) {
  return restoreDepArtifactsSnapshot(getGlobalDepCacheDir(depsHash), localDepsRoot, outputVersion);
}
function publishDepArtifactsSnapshot(localDepsRoot, globalDir, outputVersion) {
  const localSentinel = path26.join(localDepsRoot, ".verified");
  const globalSentinel = path26.join(globalDir, ".verified");
  if (!fs23.existsSync(localSentinel)) return false;
  if (!dplSnapshotSatisfiesPublicationContract(localDepsRoot, outputVersion)) {
    return false;
  }
  try {
    fs23.mkdirSync(globalDir, { recursive: true });
    if (!removeSnapshotMarker(globalSentinel)) return false;
    const entries = fs23.readdirSync(localDepsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".verified") continue;
      if (!entry.isFile()) throw new Error(`Unsupported dependency snapshot entry: ${entry.name}`);
      const src = path26.join(localDepsRoot, entry.name);
      const dst = path26.join(globalDir, entry.name);
      replaceSnapshotFileAtomic(src, dst, snapshotEntryIsMutableControl(entry.name));
    }
    if (!dplSnapshotSatisfiesPublicationContract(globalDir, outputVersion)) {
      return false;
    }
    replaceSnapshotFileAtomic(localSentinel, globalSentinel, true);
    return true;
  } catch {
    removeSnapshotMarker(globalSentinel);
    return false;
  }
}
function writeDepArtifactsToGlobalCache(depsHash, localDepsRoot, outputVersion) {
  publishDepArtifactsSnapshot(localDepsRoot, getGlobalDepCacheDir(depsHash), outputVersion);
}
function findPreviousDepsRoot(ionifyDir, currentDepsRoot) {
  const depsDir = path26.join(ionifyDir, "deps");
  if (!fs23.existsSync(depsDir)) return null;
  try {
    const entries = fs23.readdirSync(depsDir, { withFileTypes: true });
    let best = null;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path26.join(depsDir, entry.name);
      if (dirPath === currentDepsRoot) continue;
      if (!fs23.existsSync(path26.join(dirPath, ".verified"))) continue;
      if (!fs23.existsSync(path26.join(dirPath, "manifest.json"))) continue;
      try {
        const mtime = fs23.statSync(path26.join(dirPath, ".verified")).mtimeMs;
        if (!best || mtime > best.mtime) best = { mtime, dirPath };
      } catch {
      }
    }
    return best?.dirPath ?? null;
  } catch {
    return null;
  }
}
function createEmissionPlanProjection(plan) {
  return {
    entries: [...plan.entries],
    chunks: plan.chunks.map((chunk) => ({
      ...chunk,
      consumers: [...chunk.consumers ?? []],
      css: [...chunk.css ?? []],
      assets: [...chunk.assets ?? []],
      modules: chunk.modules.map((mod) => ({
        ...mod,
        deps: [...mod.deps ?? []],
        dynamicDeps: [...mod.dynamicDeps ?? []],
        usedExports: mod.usedExports ? [...mod.usedExports] : mod.usedExports,
        dependencyAbi: mod.dependencyAbi ? {
          ...mod.dependencyAbi,
          names: [...mod.dependencyAbi.names],
          imports: mod.dependencyAbi.imports.map((item) => ({
            ...item,
            names: [...item.names]
          }))
        } : mod.dependencyAbi,
        runtimeLinks: mod.runtimeLinks ? mod.runtimeLinks.map((link) => ({ ...link })) : mod.runtimeLinks
      }))
    }))
  };
}
function readPraVerifiedBuildOutputs(outDir) {
  const manifestPath = path26.join(outDir, "manifest.json");
  const statsPath = path26.join(outDir, "build.stats.json");
  let manifestStat;
  let statsStat;
  let manifest;
  let stats;
  try {
    manifestStat = fs23.statSync(manifestPath);
    statsStat = fs23.statSync(statsPath);
    if (!manifestStat.isFile() || !statsStat.isFile()) return null;
    manifest = JSON.parse(fs23.readFileSync(manifestPath, "utf8"));
    stats = JSON.parse(fs23.readFileSync(statsPath, "utf8"));
  } catch {
    return null;
  }
  if (manifest?.version !== 3) return null;
  const previousChunks = Array.isArray(manifest?.chunks) ? manifest.chunks : [];
  if (previousChunks.length === 0) return null;
  const artifacts = [];
  const allFiles = /* @__PURE__ */ new Set();
  for (const previous of previousChunks) {
    if (!previous || typeof previous.id !== "string") return null;
    const files = {
      js: Array.isArray(previous.files?.js) ? previous.files.js : [],
      css: Array.isArray(previous.files?.css) ? previous.files.css : [],
      assets: Array.isArray(previous.files?.assets) ? previous.files.assets : []
    };
    artifacts.push({ id: previous.id, files });
    for (const rel of [...files.js, ...files.css, ...files.assets]) {
      if (typeof rel === "string" && rel.length > 0) allFiles.add(toPosixPath2(rel));
    }
  }
  for (const rel of allFiles) {
    const meta = stats?.[rel];
    if (!meta || typeof meta !== "object") return null;
    if (typeof meta.bytes !== "number" || !Number.isFinite(meta.bytes)) return null;
    if (typeof meta.hash !== "string" || meta.hash.length === 0) return null;
    try {
      const fileStat = fs23.statSync(path26.join(outDir, rel));
      if (!fileStat.isFile()) return null;
      if (fileStat.size !== meta.bytes) return null;
      if (fileStat.mtimeMs > statsStat.mtimeMs + 1) return null;
    } catch {
      return null;
    }
  }
  return {
    artifacts,
    stats,
    routingManifest: {
      file: "manifest.json",
      bytes: manifestStat.size,
      hash: getCacheKey(fs23.readFileSync(manifestPath))
    }
  };
}
function tryVerifyProductionReadinessOutputReuse(outDir, record) {
  if (record.state !== "verified") return null;
  const distProof = record.proofs.dist;
  if (!distProof.manifestHash || !distProof.buildStatsHash) return null;
  if (record.proofs.publicAssets.conflicts.length > 0) return null;
  const manifestHash = hashFileIfExists(path26.join(outDir, "manifest.json"));
  if (manifestHash !== distProof.manifestHash) return null;
  const buildStatsHash = hashFileIfExists(path26.join(outDir, "build.stats.json"));
  if (buildStatsHash !== distProof.buildStatsHash) return null;
  if (distProof.assetsManifestHash) {
    const assetsManifestHash = hashFileIfExists(path26.join(outDir, "manifest.assets.json"));
    if (assetsManifestHash !== distProof.assetsManifestHash) return null;
  }
  if (distProof.indexHtmlHash) {
    const indexHtmlHash = hashFileIfExists(path26.join(outDir, "index.html"));
    if (indexHtmlHash !== distProof.indexHtmlHash) return null;
  }
  return readPraVerifiedBuildOutputs(outDir);
}
function tryVerifyProductionReadinessMaterializedOutputs(outDir, record) {
  if (record.state !== "verified") return null;
  const distProof = record.proofs.dist;
  if (!distProof.manifestHash || !distProof.buildStatsHash) return null;
  if (record.proofs.publicAssets.conflicts.length > 0) return null;
  const manifestPath = path26.join(outDir, "manifest.json");
  const statsPath = path26.join(outDir, "build.stats.json");
  let manifestStat;
  let statsStat;
  let manifest;
  let stats;
  try {
    manifestStat = fs23.statSync(manifestPath);
    statsStat = fs23.statSync(statsPath);
    if (!manifestStat.isFile() || !statsStat.isFile()) return null;
    if (hashFileIfExists(manifestPath) !== distProof.manifestHash) return null;
    if (hashFileIfExists(statsPath) !== distProof.buildStatsHash) return null;
    manifest = JSON.parse(fs23.readFileSync(manifestPath, "utf8"));
    stats = JSON.parse(fs23.readFileSync(statsPath, "utf8"));
  } catch {
    return null;
  }
  if (manifest?.version !== 3) return null;
  if (distProof.assetsManifestHash) {
    const assetsManifestHash = hashFileIfExists(path26.join(outDir, "manifest.assets.json"));
    if (assetsManifestHash !== distProof.assetsManifestHash) return null;
  }
  if (distProof.indexHtmlHash) {
    const indexHtmlHash = hashFileIfExists(path26.join(outDir, "index.html"));
    if (indexHtmlHash !== distProof.indexHtmlHash) return null;
  }
  const artifacts = [];
  const allFiles = /* @__PURE__ */ new Set();
  const explicitOutputHashes = /* @__PURE__ */ new Map();
  if (distProof.assetsManifestHash) {
    explicitOutputHashes.set("manifest.assets.json", distProof.assetsManifestHash);
  }
  if (distProof.indexHtmlHash) {
    explicitOutputHashes.set("index.html", distProof.indexHtmlHash);
  }
  const chunks = Array.isArray(manifest?.chunks) ? manifest.chunks : [];
  for (const chunk of chunks) {
    if (!chunk || typeof chunk.id !== "string") return null;
    const files = {
      js: Array.isArray(chunk.files?.js) ? chunk.files.js : [],
      css: Array.isArray(chunk.files?.css) ? chunk.files.css : [],
      assets: Array.isArray(chunk.files?.assets) ? chunk.files.assets : []
    };
    artifacts.push({ id: chunk.id, files });
    for (const rel of [...files.js, ...files.css, ...files.assets]) {
      if (typeof rel === "string" && rel.length > 0) allFiles.add(toPosixPath2(rel));
    }
  }
  for (const asset of record.proofs.publicAssets.assets) {
    if (typeof asset.file === "string" && asset.file.length > 0) {
      const file = toPosixPath2(asset.file);
      allFiles.add(file);
      explicitOutputHashes.set(file, asset.hash);
    }
  }
  if (distProof.assetsManifestHash) allFiles.add("manifest.assets.json");
  if (distProof.indexHtmlHash) allFiles.add("index.html");
  for (const rel of allFiles) {
    const meta = stats?.[rel];
    let expectedBytes = null;
    let expectedHash = explicitOutputHashes.get(rel) ?? null;
    if (meta && typeof meta === "object" && typeof meta.bytes === "number" && Number.isFinite(meta.bytes)) {
      expectedBytes = meta.bytes;
      if (!expectedHash && typeof meta.hash === "string" && meta.hash.length > 0) {
        expectedHash = meta.hash;
      }
    } else {
      const publicAsset = record.proofs.publicAssets.assets.find((asset) => toPosixPath2(asset.file) === rel);
      if (publicAsset) expectedBytes = publicAsset.bytes;
    }
    try {
      const fileStat = fs23.statSync(path26.join(outDir, rel));
      if (!fileStat.isFile()) return null;
      if (expectedBytes !== null && fileStat.size !== expectedBytes) return null;
      if (fileStat.mtimeMs > statsStat.mtimeMs + 1) {
        if (!expectedHash || hashFileIfExists(path26.join(outDir, rel)) !== expectedHash) return null;
      }
    } catch {
      return null;
    }
  }
  return {
    artifacts,
    stats,
    routingManifest: {
      file: "manifest.json",
      bytes: manifestStat.size,
      hash: distProof.manifestHash
    }
  };
}
function collectOutputHashHints(stats) {
  const hints = /* @__PURE__ */ new Map();
  for (const [file, meta] of Object.entries(stats)) {
    if (!meta || typeof meta !== "object" || file.startsWith("__")) continue;
    const hash = typeof meta.hash === "string" && meta.hash.length > 0 ? meta.hash : null;
    if (!hash) continue;
    hints.set(toPosixPath2(file), hash);
  }
  return hints;
}
function recordOutputHashHint(hints, info) {
  if (!info || typeof info.file !== "string" || info.file.length === 0) return;
  if (typeof info.hash !== "string" || info.hash.length === 0) return;
  hints.set(toPosixPath2(info.file), info.hash);
}
function formatByteDelta(bytes) {
  const value = Math.max(0, Math.floor(bytes));
  if (value < 1024) return `${value}B`;
  const kb = value / 1024;
  if (kb < 1024) return `${Math.round(kb)}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)}GB`;
}
async function collectFilesRecursive(rootDir) {
  const out = [];
  const walk = async (dir) => {
    let entries;
    try {
      entries = await fs23.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (ent) => {
        const full = path26.join(dir, ent.name);
        if (ent.isDirectory()) {
          await walk(full);
          return;
        }
        if (ent.isFile()) out.push(full);
      })
    );
  };
  await walk(rootDir);
  return out;
}
function resolvePrecompressConcurrency(value) {
  const defaultParallelism = typeof os2.availableParallelism === "function" ? os2.availableParallelism() : os2.cpus().length;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  return Math.max(1, defaultParallelism);
}
async function mapWithConcurrency(items, concurrency, worker) {
  if (!items.length) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array(items.length);
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
function brotliCompressAsync(input, quality) {
  return new Promise((resolve, reject) => {
    zlib.brotliCompress(
      input,
      {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: quality,
          [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT
        }
      },
      (err, result) => {
        if (err || !result) {
          reject(err ?? new Error("brotli compression failed"));
          return;
        }
        resolve(result);
      }
    );
  });
}
function gzipCompressAsync(input, level) {
  return new Promise((resolve, reject) => {
    zlib.gzip(input, { level, mtime: 0 }, (err, result) => {
      if (err || !result) {
        reject(err ?? new Error("gzip compression failed"));
        return;
      }
      resolve(result);
    });
  });
}
function shouldPrecompressPath(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".br") || lower.endsWith(".gz")) return false;
  if (path26.basename(lower) === "manifest.compression.json") return false;
  const ext = path26.extname(lower);
  return ext === ".js" || ext === ".mjs" || ext === ".cjs" || ext === ".css" || ext === ".html" || ext === ".json" || ext === ".svg" || ext === ".xml" || ext === ".txt" || ext === ".map";
}
async function precompressBuildOutputs(outDir, opts) {
  const files = await collectFilesRecursive(outDir);
  const candidates = [];
  const report = {
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
      gzipSavedBytes: 0
    },
    entries: []
  };
  for (const absPath of files) {
    if (!shouldPrecompressPath(absPath)) continue;
    let stat;
    try {
      stat = await fs23.promises.stat(absPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (stat.size < opts.thresholdBytes) continue;
    candidates.push({
      absPath,
      rel: toPosixPath2(path26.relative(outDir, absPath)),
      stat
    });
  }
  report.totals.filesEligible = candidates.length;
  const readUsableSidecar = async (sidecarPath, originalBytes) => {
    try {
      const stat = await fs23.promises.stat(sidecarPath);
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
    let outputHash = null;
    if (hintedOutputHash) outputHash = hintedOutputHash;
    let body = null;
    let bodyPromise = null;
    let outputHashPromise = outputHash ? Promise.resolve(outputHash) : null;
    let brotliBytes = null;
    let gzipBytes = null;
    let brotliSidecar = null;
    let gzipSidecar = null;
    let brotliSource = null;
    let gzipSource = null;
    let filesAlreadyCurrent = 0;
    let filesTouched = 0;
    let casHits = 0;
    let casMisses = 0;
    let sidecarsCopiedFromCas = 0;
    let sidecarsCompressed = 0;
    const brPath = `${absPath}.br`;
    const gzPath = `${absPath}.gz`;
    const ensureBody = async () => {
      if (body) return body;
      if (!bodyPromise) {
        bodyPromise = fs23.promises.readFile(absPath).then((loaded) => {
          body = loaded;
          if (!outputHash) outputHash = getCacheKey(loaded);
          return loaded;
        });
      }
      body = await bodyPromise;
      return body;
    };
    const ensureOutputHash = async () => {
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
    const tryRestoreFromCompressionCas = async (sidecarKind, sidecarPath) => {
      const finalOutputHash = await ensureOutputHash();
      const compressionCasDir = getCompressionCasArtifactPath(opts.casRoot, finalOutputHash, {
        brotliQuality: opts.brotliQuality,
        gzipLevel: opts.gzipLevel
      });
      const sourceFile = path26.join(compressionCasDir, sidecarKind === "br" ? "sidecar.br" : "sidecar.gz");
      const cached = await readUsableSidecar(sourceFile, originalBytes);
      if (!cached) {
        casMisses += 1;
        return { restored: false, size: null };
      }
      try {
        await fs23.promises.mkdir(path26.dirname(sidecarPath), { recursive: true });
        await fs23.promises.copyFile(sourceFile, sidecarPath);
        filesTouched += 1;
        casHits += 1;
        sidecarsCopiedFromCas += 1;
        return { restored: true, size: cached.size };
      } catch {
        casMisses += 1;
        return { restored: false, size: null };
      }
    };
    const persistCompressionCasSidecar = async (sidecarKind, finalOutputHash, data) => {
      const compressionCasDir = getCompressionCasArtifactPath(opts.casRoot, finalOutputHash, {
        brotliQuality: opts.brotliQuality,
        gzipLevel: opts.gzipLevel
      });
      const targetFile = path26.join(compressionCasDir, sidecarKind === "br" ? "sidecar.br" : "sidecar.gz");
      try {
        if (!data || data.length <= 0 || data.length >= originalBytes) {
          await fs23.promises.unlink(targetFile).catch(() => {
          });
          return;
        }
        await fs23.promises.mkdir(compressionCasDir, { recursive: true });
        await fs23.promises.writeFile(targetFile, data);
      } catch {
      }
    };
    try {
      const currentBr = await readUsableSidecar(brPath, originalBytes);
      const currentGz = await readUsableSidecar(gzPath, originalBytes);
      const skipBr = !!currentBr && currentBr.mtimeMs >= stat.mtimeMs;
      const skipGz = !!currentGz && currentGz.mtimeMs >= stat.mtimeMs;
      if (skipBr && currentBr) {
        brotliBytes = currentBr.size;
        brotliSidecar = toPosixPath2(path26.relative(outDir, brPath));
        brotliSource = "current";
      }
      if (skipGz && currentGz) {
        gzipBytes = currentGz.size;
        gzipSidecar = toPosixPath2(path26.relative(outDir, gzPath));
        gzipSource = "current";
      }
      if (skipBr && skipGz) filesAlreadyCurrent = 1;
      const [restoredBr, restoredGz] = await Promise.all([
        skipBr ? Promise.resolve({ restored: false, size: null }) : tryRestoreFromCompressionCas("br", brPath),
        skipGz ? Promise.resolve({ restored: false, size: null }) : tryRestoreFromCompressionCas("gz", gzPath)
      ]);
      if (restoredBr.restored) {
        brotliBytes = restoredBr.size;
        brotliSidecar = toPosixPath2(path26.relative(outDir, brPath));
        brotliSource = "cas";
      }
      if (restoredGz.restored) {
        gzipBytes = restoredGz.size;
        gzipSidecar = toPosixPath2(path26.relative(outDir, gzPath));
        gzipSource = "cas";
      }
      const needsBrCompression = !skipBr && brotliSource === null;
      const needsGzCompression = !skipGz && gzipSource === null;
      const loadedBody = needsBrCompression || needsGzCompression ? await ensureBody() : null;
      let br = null;
      let gz = null;
      if ((needsBrCompression || needsGzCompression) && loadedBody) {
        const useNative = !!opts.nativeCompressor;
        if (useNative && opts.nativeCompressor) {
          const results2 = opts.nativeCompressor([
            { id: rel, bytes: loadedBody, brotliQuality: opts.brotliQuality, gzipLevel: opts.gzipLevel }
          ]);
          const result = results2[0];
          if (result) {
            br = needsBrCompression ? result.br ?? null : null;
            gz = needsGzCompression ? result.gz ?? null : null;
          }
        } else {
          [br, gz] = await Promise.all([
            needsBrCompression ? brotliCompressAsync(loadedBody, opts.brotliQuality) : Promise.resolve(null),
            needsGzCompression ? gzipCompressAsync(loadedBody, opts.gzipLevel) : Promise.resolve(null)
          ]);
        }
      }
      if (needsBrCompression && loadedBody) {
        if (br && br.length < loadedBody.length) {
          await fs23.promises.writeFile(brPath, br);
          filesTouched += 1;
          sidecarsCompressed += 1;
          brotliBytes = br.length;
          brotliSidecar = toPosixPath2(path26.relative(outDir, brPath));
          brotliSource = "compressed";
        } else {
          try {
            await fs23.promises.unlink(brPath);
            filesTouched += 1;
          } catch {
          }
        }
        await persistCompressionCasSidecar("br", await ensureOutputHash(), br);
      }
      if (brotliBytes === null) {
        const resolved = await readUsableSidecar(brPath, originalBytes);
        if (resolved) {
          brotliBytes = resolved.size;
          brotliSidecar = toPosixPath2(path26.relative(outDir, brPath));
        }
      }
      if (needsGzCompression && loadedBody) {
        if (gz && gz.length < loadedBody.length) {
          await fs23.promises.writeFile(gzPath, gz);
          filesTouched += 1;
          sidecarsCompressed += 1;
          gzipBytes = gz.length;
          gzipSidecar = toPosixPath2(path26.relative(outDir, gzPath));
          gzipSource = "compressed";
        } else {
          try {
            await fs23.promises.unlink(gzPath);
            filesTouched += 1;
          } catch {
          }
        }
        await persistCompressionCasSidecar("gz", await ensureOutputHash(), gz);
      }
      if (gzipBytes === null) {
        const resolved = await readUsableSidecar(gzPath, originalBytes);
        if (resolved) {
          gzipBytes = resolved.size;
          gzipSidecar = toPosixPath2(path26.relative(outDir, gzPath));
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
          gzipSource
        },
        filesAlreadyCurrent,
        filesTouched,
        casHits,
        casMisses,
        sidecarsCopiedFromCas,
        sidecarsCompressed
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
        gzipSource
      },
      filesAlreadyCurrent,
      filesTouched,
      casHits,
      casMisses,
      sidecarsCopiedFromCas,
      sidecarsCompressed
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
    writeJsonFile2(
      path26.join(outDir, "manifest.compression.json"),
      toBuildCompressionManifest(report)
    );
  }
  return report;
}
function toBuildCompressionManifest(report) {
  const {
    filesEligible,
    filesWithSidecars,
    brotliFiles,
    gzipFiles,
    brotliOriginalBytes,
    brotliBytes,
    gzipOriginalBytes,
    gzipBytes,
    brotliSavedBytes,
    gzipSavedBytes
  } = report.totals;
  return {
    version: 2,
    compressionCasVersion: report.compressionCasVersion,
    thresholdBytes: report.thresholdBytes,
    gzipLevel: report.gzipLevel,
    brotliQuality: report.brotliQuality,
    totals: {
      filesEligible,
      filesWithSidecars,
      brotliFiles,
      gzipFiles,
      brotliOriginalBytes,
      brotliBytes,
      gzipOriginalBytes,
      gzipBytes,
      brotliSavedBytes,
      gzipSavedBytes
    },
    entries: report.entries.map((entry) => ({
      file: entry.file,
      originalBytes: entry.originalBytes,
      brotliBytes: entry.brotliBytes,
      gzipBytes: entry.gzipBytes,
      brotliSidecar: entry.brotliSidecar,
      gzipSidecar: entry.gzipSidecar
    }))
  };
}
function pickPrimaryJs(files) {
  if (!files?.length) return null;
  for (const file of files) {
    if (typeof file !== "string") continue;
    if (!file.endsWith(".js")) continue;
    if (file.endsWith(".js.map")) continue;
    return file.startsWith("/") ? file : `/${file}`;
  }
  return null;
}
function pickPrimaryEntryCss(files) {
  if (!files?.length) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (file) => {
    const href = file.startsWith("/") ? file : `/${file}`;
    if (seen.has(href)) return;
    seen.add(href);
    out.push(href);
  };
  for (const file of files) {
    if (typeof file !== "string") continue;
    if (!file.endsWith(".css")) continue;
    if (file.endsWith(".css.map")) continue;
    if (file.endsWith(".native.css")) continue;
    if (!file.startsWith("assets/") && !file.startsWith("/assets/")) continue;
    add(file);
  }
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
async function emitIndexHtml(options) {
  const profileStart = isBuildProfileEnabled() ? process.hrtime.bigint() : 0n;
  const { rootDir, outDir, entries, hostEntryIds, plan, artifacts, envValues, envPrefix } = options;
  const htmlInput = path26.join(rootDir, "index.html");
  if (!fs23.existsSync(htmlInput)) {
    return null;
  }
  const hostEntryIdSet = new Set(hostEntryIds);
  const isHostEntryChunk = (chunk) => chunk.entry && chunk.consumers.some((consumer) => hostEntryIdSet.has(consumer));
  const isHostSharedChunk = (chunk) => !chunk.entry && chunk.shared && Array.isArray(chunk.consumers) && chunk.consumers.some((consumer) => hostEntryIdSet.has(consumer));
  const entryChunks = plan.chunks.filter(isHostEntryChunk);
  const eagerCssChunks = plan.chunks.filter((chunk) => isHostEntryChunk(chunk) || isHostSharedChunk(chunk));
  const entryScripts = entryChunks.map((chunk) => {
    const artifact = artifacts.find((a) => a.id === chunk.id);
    return pickPrimaryJs(artifact?.files?.js);
  }).filter((x) => typeof x === "string" && x.length > 0);
  const entryCss = eagerCssChunks.flatMap((chunk) => {
    const artifact = artifacts.find((a) => a.id === chunk.id);
    return pickPrimaryEntryCss(artifact?.files?.css);
  }).filter((x) => typeof x === "string" && x.length > 0);
  const profilePlanEnd = profileStart ? process.hrtime.bigint() : 0n;
  if (!entryScripts.length) {
    return null;
  }
  const candidateSrcs = /* @__PURE__ */ new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== "string") continue;
    const rel = toPosixPath2(path26.relative(rootDir, entry));
    if (rel && rel !== ".") {
      candidateSrcs.add(`/${rel}`);
      candidateSrcs.add(rel);
    }
  }
  let html = await fs23.promises.readFile(htmlInput, "utf8");
  const profileReadEnd = profileStart ? process.hrtime.bigint() : 0n;
  html = substituteEnvPlaceholders(html, envValues, envPrefix);
  if (entryCss.length) {
    const unique = [];
    const seen = /* @__PURE__ */ new Set();
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
      if (headClose?.index !== void 0) {
        const idx = headClose.index;
        html = `${html.slice(0, idx)}${injected}
${html.slice(idx)}`;
      } else {
        html = `${injected}
${html}`;
      }
    }
  }
  const entryIds = new Set(hostEntryIds);
  const sharedPreloads = plan.chunks.filter((chunk) => !chunk.entry && chunk.shared && Array.isArray(chunk.consumers) && chunk.consumers.some((c) => entryIds.has(c))).map((chunk) => {
    const artifact = artifacts.find((a) => a.id === chunk.id);
    return pickPrimaryJs(artifact?.files?.js);
  }).filter((x) => typeof x === "string" && x.length > 0).sort();
  if (sharedPreloads.length) {
    const unique = [];
    const seen = /* @__PURE__ */ new Set();
    for (const href of sharedPreloads) {
      if (seen.has(href)) continue;
      seen.add(href);
      const hrefRe = new RegExp(`href=["']${escapeRegExp(href)}["']`, "i");
      if (hrefRe.test(html)) continue;
      unique.push(href);
    }
    if (unique.length) {
      const injected = unique.map((href) => `  <link rel="modulepreload" href="${href}">`).join("\n");
      const headClose = html.match(/<\/head>/i);
      if (headClose?.index !== void 0) {
        const idx = headClose.index;
        html = `${html.slice(0, idx)}${injected}
${html.slice(idx)}`;
      } else {
        html = `${injected}
${html}`;
      }
    }
  }
  const moduleScriptRe = /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi;
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
    const next = entryScripts[scriptIndex++];
    return `<script type="module" src="${next}"></script>`;
  });
  if (!replacedAny) {
    const injected = entryScripts.map((s) => `  <script type="module" src="${s}"></script>`).join("\n");
    const bodyClose = html.match(/<\/body>/i);
    if (bodyClose?.index !== void 0) {
      const idx = bodyClose.index;
      html = `${html.slice(0, idx)}${injected}
${html.slice(idx)}`;
    } else {
      html = `${html}
${injected}
`;
    }
  }
  const profileRenderEnd = profileStart ? process.hrtime.bigint() : 0n;
  await fs23.promises.mkdir(outDir, { recursive: true });
  const outputFile = path26.join(outDir, "index.html");
  await writeTextFileIfChanged2(outputFile, html);
  if (profileStart) {
    const profileWriteEnd = process.hrtime.bigint();
    const toMs = (value) => (Number(value) / 1e6).toFixed(2);
    console.error(
      `[BuildProfile][indexHtml] total_ms=${toMs(profileWriteEnd - profileStart)} plan_ms=${toMs(profilePlanEnd - profileStart)} read_ms=${toMs(profileReadEnd - profilePlanEnd)} render_ms=${toMs(profileRenderEnd - profileReadEnd)} write_ms=${toMs(profileWriteEnd - profileRenderEnd)}`
    );
  }
  return {
    file: "index.html",
    bytes: Buffer.byteLength(html, "utf8"),
    hash: getCacheKey(html)
  };
}

export {
  reconcilePackEntries,
  resolveChunkedPackEntries,
  deriveFeaturePackRoutingMap,
  isFeaturePackSlimAligned,
  planAutoFeaturePackGroups,
  analyzeFeaturePackSharedClosurePressure,
  computeChunkGroupIdFromStableIds,
  vendorPackV2MemberKey,
  VendorPackV2IndexManager,
  WS_MODULE_PREFIX,
  toWsModuleId,
  fromWsModuleId,
  localSourceExtensions,
  extractImports,
  resolveImport,
  collectConfiguredExternalSpecifiers,
  classifyImportSpecifiersForGraph,
  FEDERATION_GRAPH_PREFIX,
  buildFederationVersionContract,
  collectFederationRemoteImportBindings,
  rewriteFederationGraphEdgeIds,
  buildFederationConfigGraphNodes,
  collectFederationExposeEntryPaths,
  isCssLikeExt,
  isCssLikePath,
  isCssModuleLikePath,
  Graph,
  registerDepEntry,
  getDepEntry,
  cacheDepRegistration,
  restoreCachedDepRegistrations,
  isCoreSingletonDepFileName,
  computeSubpathFromEntryPath,
  TransformWorkerPool,
  registerCssDemandGraphSourceFiles,
  computeCssDemandGraphContentStamp,
  rewriteCssUrls,
  compileCss,
  renderCssModule,
  renderCssTokensModule,
  renderCssRawStringModule,
  renderCssUrlModule,
  MODULE_PREFIX,
  publicPathForFile,
  isForbiddenFsPath,
  decodePublicPath,
  getCasArtifactPath,
  REACT_REFRESH_RUNTIME_MODULE,
  REACT_REFRESH_HMR_CONTRACT_VERSION,
  hasReactRootRenderSideEffect,
  instrumentReactRefresh,
  loadEnv,
  importNativeConfigModule,
  loadIonifyConfig,
  LOCKFILE_ORDER,
  readLockfile,
  resolveMinifier,
  resolveTreeshake,
  resolveScopeHoist,
  resolveParser,
  applyParserEnv,
  resolveWorkspace,
  buildCanonicalDepFileNameIndex,
  canonicalizeDepFileName,
  canonicalizeDepUsageIndex,
  scanDepUsage,
  applyDefineReplacements,
  buildDefineConfig,
  substituteEnvPlaceholders,
  computeDepsHash,
  generateBuildPlan,
  writeTransformArtifact,
  admitTransformArtifact,
  computeDefineSignature,
  loadDepStopsFromManifest,
  PRODUCTION_PLAN_OUTPUT_VERSION,
  readProductionPublicationState,
  readProductionPublicationPlan,
  writeProductionPublicationPlan,
  writeProductionPublicationState,
  writeProductionPublicationProgress,
  clearProductionPublicationProgress,
  createProductionPublicationState,
  summarizePlanForPublication,
  createPartialProductionReadinessRecord,
  writeProductionPublicationReadinessRecord,
  resolveProductionBuildEntries,
  resolveProductionChunkPolicy,
  createProductionGraphVersionInputs,
  auditProductionSourceFreshness,
  validateDepsManifestEntryTopology,
  checkVerifiedDepsSnapshotFreshness,
  verifyRestoredDepsSnapshot,
  collectNativeExternalModules,
  rerouteDepsArtifacts,
  rebalanceCanonicalVendorChunks,
  prepareCanonicalProductionDependencyPlan,
  resolveDplChunkedPackPublication,
  runBuildCommand,
  restoreDepArtifactsSnapshot,
  publishDepArtifactsSnapshot,
  precompressBuildOutputs
};
