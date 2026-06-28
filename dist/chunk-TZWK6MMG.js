#!/usr/bin/env node
import {
  computeGraphVersion,
  ensureNativeGraph,
  getCacheKey,
  getDepsOptimizerOutputVersion,
  native,
  tryParseImports,
  tryParseModuleMetadata
} from "./chunk-ORW3UGOY.js";
import {
  logError,
  logInfo,
  logWarn
} from "./chunk-SNACSSNX.js";
import {
  __filename
} from "./chunk-GOMN5GJQ.js";

// src/cli/commands/build.ts
import fs21 from "fs";
import os2 from "os";
import path24 from "path";
import crypto9 from "crypto";
import zlib from "zlib";

// src/cli/utils/config.ts
import fs3 from "fs";
import path3 from "path";
import { pathToFileURL as pathToFileURL2 } from "url";
import { build } from "esbuild";

// src/core/resolver.ts
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { pathToFileURL, fileURLToPath } from "url";
var SUPPORTED_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];
var CONFIG_FILES = ["tsconfig.json", "jsconfig.json"];
var swc = null;
(() => {
  try {
    const require2 = createRequire(import.meta.url);
    swc = require2("@swc/core");
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
  for (const ext of SUPPORTED_EXTS) {
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
    for (const ext of SUPPORTED_EXTS) {
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
      const require2 = createRequire(importerAbs);
      const resolved2 = require2.resolve(specifier);
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
  let dir = path3.resolve(startDir);
  for (let i = 0; i < 15; i++) {
    const pkg = path3.join(dir, "package.json");
    try {
      if (fs3.existsSync(pkg) && fs3.statSync(pkg).isFile()) return dir;
    } catch {
    }
    const parent = path3.dirname(dir);
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return null;
}
async function bundleConfig(entry) {
  const absDir = path3.dirname(entry);
  const inlineIonifyPlugin = {
    name: "inline-ionify",
    setup(build2) {
      build2.onResolve({ filter: /^ionify$/ }, () => ({
        path: "ionify-virtual",
        namespace: "ionify-ns"
      }));
      build2.onResolve({ filter: /^@ionify\/ionify$/ }, () => ({
        path: "ionify-virtual",
        namespace: "ionify-ns"
      }));
      build2.onLoad({ filter: /.*/, namespace: "ionify-ns" }, () => ({
        contents: `
          export function defineConfig(config) {
            return config;
          }
        `,
        loader: "js"
      }));
    }
  };
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    sourcemap: "inline",
    write: false,
    target: "node18",
    logLevel: "silent",
    absWorkingDir: absDir,
    plugins: [inlineIonifyPlugin]
  });
  const output = result.outputFiles?.[0];
  if (!output) throw new Error("Failed to bundle ionify config");
  const dirnameLiteral = JSON.stringify(absDir);
  const filenameLiteral = JSON.stringify(entry);
  const importMetaLiteral = JSON.stringify(pathToFileURL2(entry).href);
  let contents = output.text;
  if (contents.includes("import.meta.url")) {
    contents = contents.replace(/import\.meta\.url/g, "__IONIFY_IMPORT_META_URL");
    contents = `const __IONIFY_IMPORT_META_URL = ${importMetaLiteral};
${contents}`;
  }
  const preamble = `const __dirname = ${dirnameLiteral};
const __filename = ${filenameLiteral};
`;
  return preamble + contents;
}
function findConfigFile(cwd) {
  for (const name of CONFIG_BASENAMES) {
    const candidate = path3.resolve(cwd, name);
    if (fs3.existsSync(candidate) && fs3.statSync(candidate).isFile()) {
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
    return cachedConfig;
  }
  try {
    const configDir = path3.dirname(configPath);
    const configEnv = buildConfigEnv(configMode, configDir);
    const bundled = await bundleConfig(configPath);
    const dataUrl = `data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`;
    const imported = await import(dataUrl);
    let resolved = imported?.default ?? imported?.config ?? imported ?? null;
    if (resolved && typeof resolved === "function") {
      resolved = resolved({ mode: configMode, env: configEnv });
    }
    if (resolved && typeof resolved?.then === "function") {
      resolved = await resolved;
    }
    if (resolved && typeof resolved === "object") {
      if (resolved.root) {
        const rootPath = path3.isAbsolute(resolved.root) ? resolved.root : path3.resolve(path3.dirname(configPath), resolved.root);
        if (!fs3.existsSync(rootPath)) {
          logError(`Config error: root directory does not exist: ${rootPath}`);
          throw new Error(`Invalid root: ${rootPath}`);
        }
        if (!fs3.statSync(rootPath).isDirectory()) {
          logError(`Config error: root must be a directory: ${rootPath}`);
          throw new Error(`Invalid root: ${rootPath}`);
        }
        resolved.root = rootPath;
        logInfo(`Using project root: ${path3.relative(cwd, rootPath)}`);
      } else {
        resolved.root = path3.dirname(configPath);
      }
      if (resolved.optimizeDeps?.esbuildOptions) {
        logWarn("optimizeDeps.esbuildOptions is not supported in Ionify (uses native Rust optimizer). This option will be ignored.");
      }
      cachedConfig = resolved;
      const baseDir = typeof resolved.root === "string" && resolved.root.length > 0 ? resolved.root : path3.dirname(configPath);
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
      logInfo(`Loaded ionify config from ${path3.relative(cwd, configPath)}`);
    } else {
      throw new Error("Config did not export an object");
    }
  } catch (err) {
    logError("Failed to load ionify.config", err);
    cachedConfig = null;
    configureResolverAliases(void 0, cwd);
    delete process.env.IONIFY_RESOLVE_ALIAS;
  }
  return cachedConfig;
}

// src/cli/utils/lockfile.ts
import fs4 from "fs";
import path4 from "path";
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
    const abs = path4.resolve(r);
    if (!uniqueRoots2.includes(abs)) uniqueRoots2.push(abs);
  }
  for (const root of uniqueRoots2) {
    for (const name of LOCKFILE_ORDER) {
      const filePath = path4.join(root, name);
      if (!fs4.existsSync(filePath)) continue;
      const contents = fs4.readFileSync(filePath);
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
import path5 from "path";
var COMPRESSION_CAS_VERSION = 1;
function getCasArtifactPath(casRoot, versionHash, moduleHash) {
  return path5.join(casRoot, versionHash, moduleHash);
}
function getCompressionCasArtifactPath(casRoot, finalOutputHash, opts) {
  const shard = finalOutputHash.slice(0, 2) || "00";
  const settingsKey = `br${Math.max(0, Math.floor(opts.brotliQuality))}-gz${Math.max(0, Math.floor(opts.gzipLevel))}`;
  return path5.join(casRoot, "compression", `v${COMPRESSION_CAS_VERSION}`, shard, finalOutputHash, settingsKey);
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
import fs8 from "fs";
import path10 from "path";
import crypto2 from "crypto";

// src/core/loaders/css.ts
import fs5 from "fs";
import path6 from "path";
import crypto from "crypto";
import { createRequire as createRequire2 } from "module";
import { pathToFileURL as pathToFileURL3, fileURLToPath as fileURLToPath2 } from "url";
import postcss from "postcss";
import postcssLoadConfig from "postcss-load-config";
import postcssModules from "postcss-modules";
function detectPreprocessorLang(filePath) {
  const ext = path6.extname(filePath.split("?")[0].split("#")[0]).toLowerCase();
  if (ext === ".scss") return "scss";
  if (ext === ".sass") return "sass";
  if (ext === ".less") return "less";
  if (ext === ".styl" || ext === ".stylus") return "styl";
  return null;
}
function loadProjectPreprocessor(name, rootDir, fromFile) {
  for (const base of [fromFile, path6.join(rootDir, "package.json")]) {
    try {
      const req = createRequire2(base);
      req.resolve(name);
      return req(name);
    } catch {
    }
  }
  try {
    return createRequire2(__filename ?? fromFile)(name);
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
        `[ionify:css] "${path6.basename(filePath)}" requires the "sass" package \u2014 install it in your project: pnpm add -D sass`
      );
    }
    const langOpts = options?.[lang] ?? options?.scss ?? {};
    const result = sass.compileString(code, {
      syntax: lang === "sass" ? "indented" : "scss",
      url: pathToFileURL3(filePath),
      loadPaths: [path6.dirname(filePath), rootDir, path6.join(rootDir, "node_modules")],
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
        `[ionify:css] "${path6.basename(filePath)}" requires the "less" package \u2014 install it in your project: pnpm add -D less`
      );
    }
    const langOpts = options?.less ?? {};
    const result = await less.render(code, {
      filename: filePath,
      paths: [path6.dirname(filePath), rootDir],
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
var postcssConfigFailedRoots = /* @__PURE__ */ new Set();
async function getPostcssConfig(rootDir) {
  const key = path6.resolve(rootDir);
  const cached = cachedPostcssConfigByRoot.get(key);
  if (cached) return cached;
  if (postcssConfigFailedRoots.has(key)) {
    const empty = { plugins: [], options: {}, configFile: null };
    cachedPostcssConfigByRoot.set(key, empty);
    return empty;
  }
  try {
    const result = await postcssLoadConfig({}, rootDir);
    const configFile = typeof result?.file === "string" ? result.file : null;
    const loaded = {
      plugins: Array.isArray(result.plugins) ? result.plugins : [],
      options: result.options ?? {},
      configFile
    };
    cachedPostcssConfigByRoot.set(key, loaded);
  } catch {
    postcssConfigFailedRoots.add(key);
    const empty = { plugins: [], options: {}, configFile: null };
    cachedPostcssConfigByRoot.set(key, empty);
  }
  return cachedPostcssConfigByRoot.get(key);
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
  if (trimmed.startsWith("/")) return path6.resolve(rootDir, "." + trimmed);
  if (trimmed.startsWith("@/")) return path6.resolve(rootDir, "src", trimmed.slice(2));
  if (trimmed.startsWith(".") || trimmed.startsWith("..")) return path6.resolve(path6.dirname(filePath), trimmed);
  const specifier = trimmed.startsWith("~") ? trimmed.slice(1) : trimmed;
  try {
    return createRequire2(filePath).resolve(specifier);
  } catch {
    return path6.resolve(path6.dirname(filePath), trimmed);
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
  if (configFile && fs5.existsSync(configFile)) {
    try {
      const raw = fs5.readFileSync(configFile);
      configFileHash = getCacheKey(raw);
      const abs = path6.resolve(configFile);
      const rel = path6.relative(rootDir, abs).replace(/\\+/g, "/");
      configFileId = rel && !rel.startsWith("../") ? rel : path6.basename(abs);
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
      const baseName = path6.basename(filename || filePath).replace(/\.[^.]+$/, "");
      const rel = path6.relative(rootDir, filename || filePath).replace(/\\+/g, "/");
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
    const relative = path6.relative(rootDir, filename || filePath).replace(/\\+/g, "/");
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
  preprocessorOptions
}) {
  const preprocessorLang = detectPreprocessorLang(filePath);
  let sourceCss = code;
  let preprocessorIdentity = null;
  const preprocessorDeps = [];
  if (preprocessorLang) {
    const pre = await runPreprocessor(code, filePath, rootDir, preprocessorLang, preprocessorOptions);
    sourceCss = pre.css;
    preprocessorDeps.push(...pre.deps);
    preprocessorIdentity = { lang: preprocessorLang, version: pre.version, options: preprocessorOptions };
  }
  const { plugins, options, configFile } = await getPostcssConfig(rootDir);
  const pipeline = [...plugins];
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
  const runner = postcss(pipeline);
  const result = await runner.process(sourceCss, {
    ...options,
    from: filePath,
    map: false
  });
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
  for (const message of result.messages || []) {
    const anyMsg = message;
    if (anyMsg?.type === "dependency" && typeof anyMsg.file === "string") {
      addDep(anyMsg.file);
    }
  }
  const importRe = /@import\s+(?:url\(\s*)?(?:'([^']+)'|"([^"]+)"|([^'"\s)]+))\s*\)?[^;]*;/gi;
  let match;
  while (match = importRe.exec(sourceCss)) {
    const spec = (match[1] || match[2] || match[3] || "").trim();
    if (!spec) continue;
    const resolved = resolveCssSpecifier(spec, filePath, rootDir);
    if (resolved) addDep(resolved);
  }
  for (const dep of discoverUrlDeps(result.css, filePath, rootDir)) {
    addUrlDep(dep);
  }
  const pipelineHash = await computePipelineHash(rootDir, modules, modulesOptions, preprocessorIdentity);
  const compiled = {
    css: result.css,
    tokens,
    deps,
    urlDeps,
    pipelineHash
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
import path8 from "path";
import fs7 from "fs";

// src/core/module-id.ts
import fs6 from "fs";
import path7 from "path";
var WS_MODULE_PREFIX = "ws://";
function realpathOrResolve(absPath) {
  try {
    const fn = fs6.realpathSync.native;
    if (fn) return fn(absPath);
    return fs6.realpathSync(absPath);
  } catch {
    return path7.resolve(absPath);
  }
}
function toPosixPath(p) {
  return p.split(path7.sep).join("/");
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
  if (fromEnv && path7.isAbsolute(fromEnv)) return realpathOrResolve(fromEnv);
  if (defaultRoot && path7.isAbsolute(defaultRoot)) return realpathOrResolve(defaultRoot);
  return realpathOrResolve(process.cwd());
}
function isWsModuleId(value) {
  return typeof value === "string" && value.startsWith(WS_MODULE_PREFIX);
}
function toWsModuleId(absPath, workspaceRoot) {
  if (!absPath || typeof absPath !== "string") return null;
  if (!path7.isAbsolute(absPath)) return null;
  const wsRoot = resolveWorkspaceRoot(workspaceRoot ?? null);
  const normalizedWs = realpathOrResolve(wsRoot);
  const exists = fs6.existsSync(absPath);
  const normalizedFile = exists ? realpathOrResolve(absPath) : path7.resolve(absPath);
  if (normalizedFile !== normalizedWs && !normalizedFile.startsWith(normalizedWs + path7.sep)) {
    return null;
  }
  const rel = path7.relative(normalizedWs, normalizedFile);
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
  const relNative = relPosix.split("/").join(path7.sep);
  const joined = path7.resolve(normalizedWs, relNative);
  if (joined !== normalizedWs && !joined.startsWith(normalizedWs + path7.sep)) {
    return null;
  }
  return joined;
}

// src/core/utils/public-path.ts
var MODULE_PREFIX = "/__ionify__/modules/";
function publicPathForFile(rootDir, absPath) {
  const normalizedRoot = path8.resolve(rootDir);
  const normalizedFile = path8.resolve(absPath);
  if (normalizedFile.startsWith(normalizedRoot + path8.sep) || normalizedFile === normalizedRoot) {
    const relative = path8.relative(normalizedRoot, normalizedFile).split(path8.sep).join("/");
    return "/" + (relative.length ? relative : "");
  }
  const logicalNodeModulesPath = mapRealPathToProjectNodeModules(normalizedRoot, normalizedFile);
  if (logicalNodeModulesPath) {
    const relative = path8.relative(normalizedRoot, logicalNodeModulesPath).split(path8.sep).join("/");
    return "/" + relative;
  }
  const wsId = toWsModuleId(normalizedFile, null);
  const encoded = Buffer.from(wsId ?? "invalid").toString("base64url");
  return MODULE_PREFIX + encoded;
}
function realpathOrResolve2(absPath) {
  try {
    const fn = fs7.realpathSync.native;
    if (fn) return fn(absPath);
    return fs7.realpathSync(absPath);
  } catch {
    return path8.resolve(absPath);
  }
}
function mapRealPathToProjectNodeModules(rootDir, absPath) {
  const normalizedRoot = path8.resolve(rootDir);
  const normalizedFile = realpathOrResolve2(absPath);
  const parts = normalizedFile.split(path8.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] !== "node_modules") continue;
    if (index === parts.length - 1) continue;
    const suffix = parts.slice(index + 1);
    if (suffix[0]?.startsWith("@") && suffix.length < 2) continue;
    const candidate = path8.join(normalizedRoot, "node_modules", ...suffix);
    if (!fs7.existsSync(candidate)) continue;
    if (realpathOrResolve2(candidate) !== normalizedFile) continue;
    return candidate;
  }
  return null;
}
function isWithinRoots(filePath, roots) {
  const exists = fs7.existsSync(filePath);
  const normalizedFile = exists ? realpathOrResolve2(filePath) : path8.resolve(filePath);
  for (const root of roots) {
    const normalizedRoot = realpathOrResolve2(root);
    if (normalizedFile === normalizedRoot) return true;
    if (normalizedFile.startsWith(normalizedRoot + path8.sep)) return true;
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
  const normalizedRoot = path8.resolve(rootDir);
  const joined = path8.resolve(normalizedRoot, "." + urlPath);
  if (!joined.startsWith(normalizedRoot + path8.sep) && joined !== normalizedRoot) {
    return null;
  }
  if (isForbiddenPath(joined)) return null;
  return joined;
}

// src/core/external-policy.ts
import path9 from "path";
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
  if (path9.isAbsolute(id)) return false;
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
  if (fromEnv && path10.isAbsolute(fromEnv)) return fromEnv;
  const projectRoot = process.env.IONIFY_PROJECT_ROOT;
  if (projectRoot && path10.isAbsolute(projectRoot)) return path10.join(projectRoot, ".ionify");
  return path10.join(process.cwd(), ".ionify");
}
var JS_EXTENSIONS = /* @__PURE__ */ new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"]);
var CSS_EXTENSIONS = new Set(CSS_LIKE_EXTENSIONS);
function classifyModuleKind(id) {
  const raw = id.startsWith(WS_MODULE_PREFIX) ? id.slice(WS_MODULE_PREFIX.length) : id;
  const ext = path10.posix.extname(raw.replace(/\\/g, "/")).toLowerCase();
  if (CSS_EXTENSIONS.has(ext)) return "css";
  if (JS_EXTENSIONS.has(ext)) return "js";
  return "asset";
}
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var toPosix = (p) => p.split(path10.sep).join("/");
var isBundleProfileEnabled = () => process.env.IONIFY_BUNDLE_PROFILE === "1" || process.env.IONIFY_BUNDLE_PROFILE === "true";
var nsToMs = (value) => Number(value) / 1e6;
var profileLog = (message) => {
  if (isBundleProfileEnabled()) logInfo(`[BuildProfile] ${message}`);
};
async function writeTextFileIfChanged(filePath, contents) {
  const nextBytes = Buffer.byteLength(contents, "utf8");
  try {
    const stat = await fs8.promises.stat(filePath);
    if (stat.isFile() && stat.size === nextBytes) {
      const existing = await fs8.promises.readFile(filePath, "utf8");
      if (existing === contents) return false;
    }
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
  await fs8.promises.mkdir(path10.dirname(filePath), { recursive: true });
  await fs8.promises.writeFile(filePath, contents, "utf8");
  return true;
}
async function writeBufferFileIfChanged(filePath, contents) {
  try {
    const stat = await fs8.promises.stat(filePath);
    if (stat.isFile() && stat.size === contents.length) {
      const existing = await fs8.promises.readFile(filePath);
      if (Buffer.compare(existing, contents) === 0) return false;
    }
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
  await fs8.promises.mkdir(path10.dirname(filePath), { recursive: true });
  await fs8.promises.writeFile(filePath, contents);
  return true;
}
function loadPreviousOutputStats(outputDir) {
  const statsPath = path10.join(outputDir, "build.stats.json");
  try {
    const statsFile = fs8.statSync(statsPath);
    if (!statsFile.isFile()) return null;
    const raw = fs8.readFileSync(statsPath, "utf8");
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
  const rel = toPosix(path10.relative(outputDir, filePath));
  const bytes = Buffer.byteLength(contents, "utf8");
  const previous = previousStats?.files.get(rel);
  if (previous && previous.bytes === bytes && previous.hash === hash) {
    try {
      const stat = await fs8.promises.stat(filePath);
      if (stat.isFile() && stat.size === bytes && stat.mtimeMs <= previousStats.statsMtimeMs + 1) {
        return false;
      }
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
    }
  }
  await fs8.promises.mkdir(path10.dirname(filePath), { recursive: true });
  await fs8.promises.writeFile(filePath, contents, "utf8");
  return true;
}
function minifyCss(input) {
  return input.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").replace(/\s*([{};:,])\s*/g, "$1").trim();
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
    modules.push({
      id,
      fsPath,
      hash,
      kind,
      deps,
      dynamicDeps
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
    if (!fs8.existsSync(file)) continue;
    const code = fs8.readFileSync(file, "utf8");
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
    graphSeedNodes.push({
      id: fileId,
      hash,
      deps: depsIds,
      dynamicDeps: dynamicIds,
      kind: classifyModuleKind(fileId)
    });
    for (const dep of [...depsAbs, ...dynamicAbs]) {
      if (!seen.has(dep)) {
        seen.add(dep);
        if (depStopMap && depStopMap.size > 0) {
          let canonical;
          try {
            canonical = fs8.realpathSync.native(dep);
          } catch {
            canonical = path10.resolve(dep);
          }
          const artifactHash = depStopMap.get(canonical);
          if (artifactHash) {
            const depId = toWsModuleId(dep, workspaceRoot) ?? canonical;
            graphSeedNodes.push({
              id: depId,
              hash: artifactHash,
              deps: [],
              dynamicDeps: [],
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
function rebuildGraphFromEntries(entryPaths, workspaceRoot, depStops, externalSpecifiers = []) {
  const depStopMap = depStops && depStops.length > 0 ? new Map(
    depStops.filter((s) => s.artifactHash.length > 0).map((s) => {
      let canonical;
      try {
        canonical = fs8.realpathSync.native(s.entryPath);
      } catch {
        canonical = path10.resolve(s.entryPath);
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
async function generateBuildPlan(entries, versionInputs, depStops, externalSpecifiers = []) {
  const workspaceRoot = resolveWorkspaceRoot(null);
  const entryIds = Array.isArray(entries) ? entries.map((entry) => {
    if (typeof entry !== "string" || entry.length === 0) return null;
    if (entry.startsWith(WS_MODULE_PREFIX)) return entry;
    if (!path10.isAbsolute(entry)) return null;
    return toWsModuleId(entry, workspaceRoot);
  }).filter((id) => typeof id === "string" && id.length > 0) : [];
  const entryPaths = Array.isArray(entries) ? entries.map((entry) => {
    if (typeof entry !== "string" || entry.length === 0) return null;
    if (path10.isAbsolute(entry)) return entry;
    if (entry.startsWith(WS_MODULE_PREFIX)) return fromWsModuleId(entry, workspaceRoot);
    return null;
  }).filter((p) => typeof p === "string" && p.length > 0) : [];
  const version = versionInputs ? computeGraphVersion(versionInputs) : void 0;
  logInfo(`Graph version: ${version || "default"}`);
  const graphDbPath = path10.join(resolveIonifyDir(), "graph.db");
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
      const buildGraphDbPath = path10.join(resolveIonifyDir(), "build", "graph.db");
      try {
        fs8.rmSync(buildGraphDbPath, { recursive: true, force: true });
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
    const rebuild = rebuildGraphFromEntries(entryPaths, workspaceRoot, depStops, externalSpecifiers);
    try {
      const reloadStart = Date.now();
      persistedGraph = native.graphLoadMap ? native.graphLoadMap() : null;
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
  let planCachePath = null;
  if (nativeGraphReady && version && native?.graphStateFingerprint) {
    try {
      const fpStart = Date.now();
      const fp = typeof native.planCacheFingerprint === "function" ? native.planCacheFingerprint() : native.graphStateFingerprint();
      profileLog(`planFingerprint_ms=${Date.now() - fpStart}`);
      if (fp) {
        planCachePath = path10.join(resolveIonifyDir(), "cas", version, "plan-v1", `${fp}.json`);
        if (fs8.existsSync(planCachePath)) {
          try {
            const planReadStart = Date.now();
            const cached = JSON.parse(fs8.readFileSync(planCachePath, "utf8"));
            profileLog(`planCacheRead_ms=${Date.now() - planReadStart}`);
            logInfo(`[Planner] Plan cache HIT (fp=${fp.slice(0, 8)}): skipped graphLoadMap + BFS`);
            return normalizePlan(cached);
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
      if (planCachePath) {
        try {
          fs8.mkdirSync(path10.dirname(planCachePath), { recursive: true });
          fs8.writeFileSync(planCachePath, JSON.stringify(normalized), "utf8");
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
async function writeBuildManifest(outputDir, plan, artifacts, options) {
  const filesByChunk = /* @__PURE__ */ new Map();
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
        dependencyFormat: mod.dependencyFormat ?? void 0,
        usedExports: mod.usedExports ?? void 0,
        dependencyAbiHash: mod.dependencyAbiHash ?? void 0,
        productionClosureHash: mod.productionClosureHash ?? void 0,
        sideEffects: mod.sideEffects ?? void 0,
        // artifactHash is the final computed transform hash (set via plan refs during build/dev).
        // Used by `ionify push --tier1` to locate CAS blobs and publish the cloud manifest.
        artifactHash: mod.hash ?? void 0
      })),
      files: filesByChunk.get(chunk.id) ?? { js: [], css: [], assets: [] }
    })),
    federation: options?.federation ?? void 0
  };
  const dir = path10.resolve(outputDir);
  await fs8.promises.mkdir(dir, { recursive: true });
  const file = path10.join(dir, "manifest.json");
  const contents = JSON.stringify(manifest, null, 2);
  await writeTextFileIfChanged(file, contents);
  return {
    file: toPosix(path10.relative(dir, file)),
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
    target = path10.resolve(path10.dirname(fromFsPath), spec);
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
  if (!fs8.existsSync(target)) return full;
  let real;
  try {
    real = fs8.realpathSync(target);
  } catch {
    real = target;
  }
  if (visited.has(real)) return "";
  visited.add(real);
  let imported;
  try {
    imported = fs8.readFileSync(target, "utf8");
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
  const rawArtifacts = native.buildChunks(plan, opts?.casRoot, opts?.versionHash, opts?.nativeOptions) ?? [];
  logInfo(`[Bundler] buildChunks completed in ${Date.now() - start}ms (native)`);
  return emitChunksFromArtifacts(outputDir, plan, moduleOutputs, rawArtifacts);
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
        const data = fs8.readFileSync(assetPath);
        if (data.length < 4096) {
          const mime = "application/octet-stream";
          const inline = `data:${mime};base64,${data.toString("base64")}`;
          jsParts.push(`// ${assetId}
export const __ionify_asset = "${inline}";`);
          continue;
        }
        const hash = crypto2.createHash("sha256").update(data).digest("hex").slice(0, 16);
        const ext = path10.extname(assetPath) || ".bin";
        const fileName = `assets/${hash}${ext}`;
        assets.push({
          source: assetPath,
          file_name: fileName
        });
      } catch {
        const fileName = path10.basename(assetPath) || "asset";
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
    file_name: asset.file_name ?? asset.fileName ?? path10.basename(asset.source ?? "asset")
  })) : [];
  return { id, file_name, code, map, assets, code_bytes, map_bytes };
}
async function emitChunksFromArtifacts(outputDir, plan, moduleOutputs, rawArtifacts) {
  const chunkDir = path10.join(outputDir, "chunks");
  await fs8.promises.mkdir(chunkDir, { recursive: true });
  const assetsDir = path10.join(outputDir, "assets");
  await fs8.promises.mkdir(assetsDir, { recursive: true });
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
  const buildStats = {};
  const results = [];
  const cssUrlRootDir = process.env.IONIFY_PROJECT_ROOT || process.cwd();
  const emittedUrlAssets = /* @__PURE__ */ new Set();
  const cssCtx = {
    rootDir: cssUrlRootDir,
    emitUrlAsset: (absPath) => {
      try {
        if (isForbiddenFsPath(absPath) || !fs8.existsSync(absPath)) return null;
        const data = fs8.readFileSync(absPath);
        const ext = path10.extname(absPath);
        const safeBase = path10.basename(absPath, ext).replace(/[^a-zA-Z0-9._-]/g, "_") || "asset";
        const hash = getCacheKey(data).slice(0, 8);
        const fileName = `${safeBase}.${hash}${ext}`;
        if (!emittedUrlAssets.has(fileName)) {
          const destAbs = path10.join(assetsDir, fileName);
          let needWrite = true;
          try {
            if (fs8.existsSync(destAbs) && fs8.readFileSync(destAbs).equals(data)) needWrite = false;
          } catch {
          }
          if (needWrite) fs8.writeFileSync(destAbs, data);
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
  for (const chunk of plan.chunks) {
    const artifacts = grouped.get(chunk.id);
    if (!artifacts || !artifacts.length) {
      throw new Error(`Native bundler did not emit artifacts for ${chunk.id}`);
    }
    const chunkOutDir = path10.join(chunkDir, chunk.id);
    await fs8.promises.mkdir(chunkOutDir, { recursive: true });
    artifacts.sort((a, b) => {
      if (a.id === chunk.id) return -1;
      if (b.id === chunk.id) return 1;
      return a.id.localeCompare(b.id);
    });
    const jsFiles = [];
    const cssFiles = [];
    const assetFiles = [];
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
        const relName = asset.file_name ?? path10.basename(asset.source);
        const assetFile = path10.join(outputDir, relName);
        if (assetWritten.has(assetFile)) continue;
        try {
          const data = await fs8.promises.readFile(asset.source);
          await writeBufferFileIfChanged(assetFile, data);
          const rel = toPosix(path10.relative(outputDir, assetFile));
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
    const cssOrder = orderCssModules(chunk);
    if (cssProfile) {
      cssProfile.nsOrder += process.hrtime.bigint() - cssOrderStart;
      if (cssOrder.length) cssProfile.chunksWithCss += 1;
    }
    let cssFileRel = null;
    if (cssOrder.length) {
      const seenCss = /* @__PURE__ */ new Set();
      const cssPieces = [];
      for (const cssId of cssOrder) {
        if (cssProfile) cssProfile.cssModulesVisited += 1;
        let cssSource = moduleOutputs.get(cssId)?.code;
        const cssPath = idToFsPath.get(cssId) ?? null;
        if (!cssSource && cssPath && fs8.existsSync(cssPath)) {
          try {
            cssSource = await fs8.promises.readFile(cssPath, "utf8");
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
        const cssFilePath = path10.join(outputDir, cssFileName);
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
        cssFileRel = toPosix(path10.relative(outputDir, cssFilePath));
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
      const nativeFile = path10.join(chunkOutDir, artifact.file_name);
      let nativeCode = artifact.code;
      if (cssFileRel && !chunk.entry) {
        const absCss = path10.join(outputDir, cssFileRel);
        const relCss = toPosix(path10.relative(path10.dirname(nativeFile), absCss));
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
//# sourceMappingURL=${path10.basename(mapFile)}`;
        const relMap = toPosix(path10.relative(outputDir, mapFile));
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
      const relNative = toPosix(path10.relative(outputDir, nativeFile));
      buildStats[relNative] = {
        bytes: Buffer.byteLength(nativeCode, "utf8"),
        hash: nativeHash,
        emitter: "native",
        type: "js"
      };
      jsFiles.push(relNative);
      await copyAssets(artifact.assets);
    }
    results.push({
      id: chunk.id,
      files: {
        js: jsFiles,
        css: cssFiles,
        assets: assetFiles
      }
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
      emitMs: nsToMs(cssProfile.nsEmit)
    };
    console.error(
      `[BundlerProfile][css] chunks=${cssProfile.chunksWithCss} modules=${cssProfile.cssModulesVisited} fs_reads=${cssProfile.cssFsFallbackReads} deduped=${cssProfile.cssDedupedModules} writes=${cssProfile.cssFilesWritten} order_ms=${nsToMs(
        cssProfile.nsOrder
      ).toFixed(2)} minify_ms=${nsToMs(cssProfile.nsMinify).toFixed(2)} emit_ms=${nsToMs(
        cssProfile.nsEmit
      ).toFixed(2)} bytes_in=${cssProfile.cssInputBytes} bytes_out=${cssProfile.cssOutputBytes}`
    );
  }
  return { artifacts: results, stats: buildStats };
}
async function writeAssetsManifest(outputDir, artifacts) {
  const dir = path10.resolve(outputDir);
  await fs8.promises.mkdir(dir, { recursive: true });
  const file = path10.join(dir, "manifest.assets.json");
  const payload = {
    chunks: artifacts
  };
  const contents = JSON.stringify(payload, null, 2);
  await writeTextFileIfChanged(file, contents);
  return {
    file: toPosix(path10.relative(dir, file)),
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

// src/core/workspace.ts
import fs9 from "fs";
import path11 from "path";
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
    const fn = fs9.realpathSync.native;
    if (fn) return fn(absPath);
    return fs9.realpathSync(absPath);
  } catch {
    return path11.resolve(absPath);
  }
}
function fileExists(filePath) {
  try {
    return fs9.existsSync(filePath) && fs9.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
function dirExists(dirPath) {
  try {
    return fs9.existsSync(dirPath) && fs9.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}
function hasGitRootMarker(dir) {
  const dotGit = path11.join(dir, ".git");
  return fileExists(dotGit) || dirExists(dotGit);
}
function hasWorkspacesField(dir) {
  const pkgPath = path11.join(dir, "package.json");
  if (!fileExists(pkgPath)) return false;
  try {
    const raw = fs9.readFileSync(pkgPath, "utf8");
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
  let current = path11.resolve(startDir);
  for (let i = 0; i < 50; i++) {
    const markers = predicate(current);
    if (markers && markers.length) return { dir: current, markers };
    const parent = path11.dirname(current);
    if (!parent || parent === current) break;
    current = parent;
  }
  return null;
}
function findNearestPackageRoot(startDir) {
  const found = findUp(startDir, (dir) => fileExists(path11.join(dir, "package.json")) ? ["package.json"] : null);
  return found?.dir ?? null;
}
function detectWorkspaceRoot(projectRoot) {
  const explicit = findUp(projectRoot, (dir) => {
    const markers = [];
    for (const name of WORKSPACE_MARKERS) {
      if (fileExists(path11.join(dir, name))) markers.push(name);
    }
    if (hasWorkspacesField(dir)) markers.push("package.json#workspaces");
    for (const name of LOCKFILE_MARKERS) {
      if (fileExists(path11.join(dir, name))) markers.push(name);
    }
    return markers.length ? markers : null;
  });
  if (explicit) return explicit;
  const git = findUp(projectRoot, (dir) => hasGitRootMarker(dir) ? [".git"] : null);
  if (git) return git;
  return { dir: projectRoot, markers: [] };
}
function readGitSubmoduleRoots(workspaceRoot) {
  const gitmodulesPath = path11.join(workspaceRoot, ".gitmodules");
  if (!fileExists(gitmodulesPath)) return [];
  let text;
  try {
    text = fs9.readFileSync(gitmodulesPath, "utf8");
  } catch {
    return [];
  }
  const roots = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*path\s*=\s*(.+)\s*$/);
    if (!m) continue;
    const raw = m[1] ? String(m[1]).trim() : "";
    if (!raw) continue;
    const abs = path11.resolve(workspaceRoot, raw);
    const normalizedWs = realpathOrResolve3(workspaceRoot);
    const normalizedAbs = realpathOrResolve3(abs);
    if (normalizedAbs === normalizedWs || normalizedAbs.startsWith(normalizedWs + path11.sep)) {
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
    const p = path11.join(workspaceRoot, name);
    if (!fileExists(p)) continue;
    try {
      hash.update(name);
      hash.update("\0");
      hash.update(fs9.readFileSync(p));
      hash.update("\0");
    } catch {
    }
  }
  return hash.digest("hex").slice(0, 12);
}
function computeProjectId(workspaceRoot, projectRoot) {
  const rel = path11.relative(workspaceRoot, projectRoot).split(path11.sep).join("/");
  const normalizedRel = rel && rel !== "." ? rel : "root";
  const hash = crypto3.createHash("sha256").update(`ionify:project:v1:${normalizedRel}`).digest("hex");
  return { id: hash.slice(0, 10), rel: normalizedRel };
}
function uniqueRoots(roots) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const r of roots) {
    const normalized = realpathOrResolve3(path11.resolve(r));
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}
function resolveWorkspace(startDir, opts = {}) {
  const startAbs = realpathOrResolve3(path11.resolve(startDir));
  const projectRoot = opts.projectRootOverride ? realpathOrResolve3(path11.resolve(opts.projectRootOverride)) : realpathOrResolve3(findNearestPackageRoot(startAbs) ?? startAbs);
  const ws = detectWorkspaceRoot(projectRoot);
  const workspaceRoot = realpathOrResolve3(ws.dir);
  const ionifyDir = path11.join(workspaceRoot, ".ionify");
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
  let result = code;
  const sortedKeys = Object.keys(definitions).sort((a, b) => b.length - a.length);
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
    if (key.includes(".")) {
      result = replaceMemberExpression(result, key, replacement);
    } else {
      result = replaceIdentifier(result, key, replacement);
    }
  }
  if ("import.meta.env" in definitions) {
    const envObj = definitions["import.meta.env"];
    let envObjLiteral;
    if (typeof envObj === "string" && envObj.startsWith("{")) {
      envObjLiteral = envObj;
    } else {
      envObjLiteral = JSON.stringify(envObj);
    }
    result = result.replace(/(?<![\w.$])import\.meta\.env(?!\w)/g, envObjLiteral);
  }
  return result;
}
function replaceIdentifier(code, identifier, replacement) {
  const regex = new RegExp(
    `(?<![\\w.$])${escapeRegExp(identifier)}(?![\\w])`,
    "g"
  );
  return code.replace(regex, replacement);
}
function replaceMemberExpression(code, expression, replacement) {
  const parts = expression.split(".");
  const pattern = parts.map(escapeRegExp).join("\\s*\\.\\s*");
  const regex = new RegExp(
    `(?<![\\w.$])${pattern}(?![\\w.])`,
    "g"
  );
  return code.replace(regex, replacement);
}
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
import fs10 from "fs";
import path12 from "path";
function loadDepStopsFromManifest(depsRoot) {
  const manifestPath = path12.join(depsRoot, "manifest.json");
  if (!fs10.existsSync(manifestPath)) return [];
  try {
    const raw = fs10.readFileSync(manifestPath, "utf8");
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
import fs11 from "fs";
import path13 from "path";
function realpathOrSelf(filePath) {
  try {
    return fs11.realpathSync(filePath);
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
    outByEntryPath.set(realpathOrSelf(entryPath), path13.basename(outPath));
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
import fs13 from "fs";
import path15 from "path";
import { parseSync } from "@swc/core";

// src/core/deps/registry.ts
import crypto5 from "crypto";
import fs12 from "fs";
import path14 from "path";
var registry = /* @__PURE__ */ new Map();
var manifestCache = /* @__PURE__ */ new Map();
var peerIdentityCache = /* @__PURE__ */ new Map();
function computeStableDepFileName(options) {
  const pkgName = sanitizePackageName(options.packageName);
  const pkgVersion = options.packageVersion || "0.0.0";
  const subpath = normalizeSubpath(options.subpath);
  const identity = buildDepIdentityFingerprint({
    entryPath: options.entryPath,
    packageName: options.packageName,
    packageVersion: pkgVersion,
    subpath
  });
  const hash = crypto5.createHash("sha256").update(identity).digest("hex").slice(0, 6);
  const subpathSuffix = subpath ? `__${subpath}` : "";
  return `${pkgName}@${pkgVersion}${subpathSuffix}_${hash}.js`;
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
  let rel = path14.relative(packageRoot, entryPath).replace(/\\/g, "/");
  const extIndex = rel.lastIndexOf(".");
  if (extIndex !== -1) {
    rel = rel.substring(0, extIndex);
  }
  if (rel.endsWith("/index")) {
    rel = rel.substring(0, rel.length - "/index".length);
  }
  const pkgName = path14.basename(packageRoot);
  if (process.env.DEBUG_DEPS) {
    console.log(`[subpath] entry: ${path14.basename(entryPath)}, root: ${pkgName}, rel: "${rel}", isMain: ${rel === pkgName}`);
  }
  if (rel === pkgName || rel === "index" || rel === "" || rel === ".") {
    return "";
  }
  return rel || "";
}
function findPackageRoot(entryPath) {
  let currentDir = path14.dirname(entryPath);
  let previousDir = entryPath;
  while (currentDir && currentDir !== previousDir) {
    const parent = path14.dirname(currentDir);
    const grandparent = path14.dirname(parent);
    if (path14.basename(parent) === "node_modules") {
      const pkgJsonPath = path14.join(currentDir, "package.json");
      if (fs12.existsSync(pkgJsonPath)) {
        return currentDir;
      }
    }
    if (path14.basename(grandparent) === "node_modules" && path14.basename(parent).startsWith("@")) {
      const pkgJsonPath = path14.join(currentDir, "package.json");
      if (fs12.existsSync(pkgJsonPath)) {
        return currentDir;
      }
    }
    previousDir = currentDir;
    currentDir = parent;
  }
  return null;
}
function sanitizePackageName(name) {
  return name.replace(/^@/, "").replace(/\//g, "__");
}
function normalizeSubpath(subpath) {
  if (!subpath) return "";
  const cleaned = subpath.replace(/^\.\//, "").replace(/^\//, "");
  if (!cleaned || cleaned === "." || cleaned === "index") return "";
  return cleaned.replace(/\//g, "__");
}
function buildDepIdentityFingerprint(options) {
  const canonicalPath = realpathOrSelf2(options.entryPath);
  const peerIdentity = resolvePeerIdentitySignature(canonicalPath);
  if (!peerIdentity) {
    return canonicalPath;
  }
  return [
    "peer-aware:v1",
    options.packageName,
    options.packageVersion,
    options.subpath,
    peerIdentity
  ].join("|");
}
function resolvePeerIdentitySignature(entryPath) {
  const canonicalEntry = realpathOrSelf2(entryPath);
  if (peerIdentityCache.has(canonicalEntry)) {
    return peerIdentityCache.get(canonicalEntry) ?? null;
  }
  const packageRoot = findPackageRoot(canonicalEntry);
  if (!packageRoot) {
    peerIdentityCache.set(canonicalEntry, null);
    return null;
  }
  const manifest = readPackageManifest(packageRoot);
  const peerNames = Object.keys(manifest?.peerDependencies ?? {}).sort();
  if (!peerNames.length) {
    peerIdentityCache.set(canonicalEntry, null);
    return null;
  }
  const startDir = path14.dirname(packageRoot);
  const signature = peerNames.map((peerName) => `${peerName}@${resolveInstalledPackageVersion(startDir, peerName) ?? "missing"}`).join("|");
  peerIdentityCache.set(canonicalEntry, signature);
  return signature;
}
function resolveInstalledPackageVersion(startDir, packageName) {
  let currentDir = startDir;
  let previousDir = "";
  while (currentDir && currentDir !== previousDir) {
    const manifestPath = path14.join(currentDir, "node_modules", packageName, "package.json");
    if (fs12.existsSync(manifestPath)) {
      return readPackageManifest(path14.dirname(manifestPath))?.version ?? null;
    }
    previousDir = currentDir;
    currentDir = path14.dirname(currentDir);
  }
  return null;
}
function readPackageManifest(packageRoot) {
  const canonicalRoot = realpathOrSelf2(packageRoot);
  if (manifestCache.has(canonicalRoot)) {
    return manifestCache.get(canonicalRoot) ?? null;
  }
  const manifestPath = path14.join(canonicalRoot, "package.json");
  try {
    const parsed = JSON.parse(fs12.readFileSync(manifestPath, "utf8"));
    manifestCache.set(canonicalRoot, parsed);
    return parsed;
  } catch {
    manifestCache.set(canonicalRoot, null);
    return null;
  }
}
function realpathOrSelf2(targetPath) {
  try {
    return fs12.realpathSync(targetPath);
  } catch {
    return targetPath;
  }
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
function parseModuleForUsage(absPath, code) {
  const ext = path15.extname(absPath).toLowerCase();
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
    return [];
  }
  const out = [];
  const body = Array.isArray(ast?.body) ? ast.body : [];
  for (const item of body) {
    if (!item || typeof item.type !== "string") continue;
    if (item.type === "ImportDeclaration") {
      const source = item.source?.value;
      if (typeof source !== "string") continue;
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
          const importedName = spec.imported?.value ?? spec.local?.value;
          if (typeof importedName === "string" && importedName.length > 0) {
            imported.push({
              kind: importedName === "default" ? "default" : "named",
              name: importedName
            });
          }
        }
      }
      out.push({ source, imported });
      continue;
    }
    if (item.type === "ExportNamedDeclaration") {
      const source = item.source?.value;
      if (typeof source !== "string") continue;
      const imported = [];
      const specs = Array.isArray(item.specifiers) ? item.specifiers : [];
      for (const spec of specs) {
        if (!spec || typeof spec.type !== "string") continue;
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
      out.push({ source, imported });
      continue;
    }
    if (item.type === "ExportAllDeclaration") {
      const source = item.source?.value;
      if (typeof source !== "string") continue;
      out.push({ source, imported: [{ kind: "export-star" }] });
      continue;
    }
  }
  const dynamic = [];
  collectDynamicImports(ast, dynamic);
  for (const source of dynamic) {
    if (typeof source === "string" && source.length > 0) {
      out.push({ source, imported: [] });
    }
  }
  return out;
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
  const resolved = path15.resolve(absPath);
  try {
    const nativeFn = fs13.realpathSync.native;
    return nativeFn ? nativeFn(resolved) : fs13.realpathSync(resolved);
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
    if (absPath.startsWith(root + path15.sep)) return true;
  }
  return false;
}
function normalizeProjectKey(rootDir, absPath) {
  const normalizedRoot = safeRealpath(rootDir);
  const normalizedPath = safeRealpath(absPath);
  const rel = path15.relative(normalizedRoot, normalizedPath).replace(/\\/g, "/");
  if (!rel || rel === ".") return ".";
  return rel;
}
async function scanDepUsage(options) {
  const { rootDir, entries } = options;
  const allowedRoots = normalizeAllowedRoots(
    Array.isArray(options.allowedRoots) && options.allowedRoots.length ? options.allowedRoots : [rootDir]
  );
  const usage = /* @__PURE__ */ new Map();
  const queue = [];
  const visitedFiles = /* @__PURE__ */ new Set();
  for (const entry of entries) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    const abs = path15.isAbsolute(entry) ? entry : path15.resolve(rootDir, entry);
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
    if (absPath.includes(`${path15.sep}node_modules${path15.sep}`)) continue;
    const ext = path15.extname(absPath).toLowerCase();
    if (!SCAN_EXTS.has(ext)) continue;
    if (absPath.endsWith(".d.ts")) continue;
    if (!fs13.existsSync(absPath)) continue;
    let code = "";
    try {
      code = fs13.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }
    const records = parseModuleForUsage(absPath, code);
    for (const record of records) {
      const source = record.source;
      if (typeof source !== "string" || source.length === 0) continue;
      const resolvedImport = resolveImport(source, absPath);
      const resolvedLocalImport = resolvedImport && isWithinAllowedRoots(safeRealpath(resolvedImport), allowedRoots) && !resolvedImport.includes(`${path15.sep}node_modules${path15.sep}`) ? resolvedImport : null;
      if (resolvedLocalImport) {
        queue.push({ absPath: resolvedLocalImport, entryRootKey });
        continue;
      }
      if (isBareSpecifier(source)) {
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
  return out;
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
    queue.push(path15.isAbsolute(entry) ? entry : path15.resolve(rootDir, entry));
  }
  while (queue.length) {
    const absPath = safeRealpath(queue.shift());
    if (visitedFiles.has(absPath)) continue;
    visitedFiles.add(absPath);
    if (!isWithinAllowedRoots(absPath, allowedRoots)) continue;
    if (absPath.includes(`${path15.sep}node_modules${path15.sep}`)) continue;
    const ext = path15.extname(absPath).toLowerCase();
    if (!SCAN_EXTS.has(ext)) continue;
    if (absPath.endsWith(".d.ts")) continue;
    if (!fs13.existsSync(absPath)) continue;
    let code = "";
    try {
      code = fs13.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }
    const records = parseModuleForUsage(absPath, code);
    for (const record of records) {
      const source = record.source;
      if (typeof source !== "string" || source.length === 0) continue;
      const resolvedImport = resolveImport(source, absPath);
      const resolvedLocalImport = resolvedImport && isWithinAllowedRoots(safeRealpath(resolvedImport), allowedRoots) && !resolvedImport.includes(`${path15.sep}node_modules${path15.sep}`) ? resolvedImport : null;
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

// src/core/deps/production-closure.ts
import crypto6 from "crypto";
import fs14 from "fs";
import path16 from "path";
var PRODUCTION_DEPENDENCY_CLOSURE_VERSION = 1;
function sortedUnique(values) {
  return Array.from(
    new Set(
      Array.from(values).map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean)
    )
  ).sort();
}
function stableHash(lines) {
  const hash = crypto6.createHash("sha256");
  for (const line of lines) {
    hash.update(line);
    hash.update("\n");
  }
  return hash.digest("hex");
}
function isStaticExportName(name) {
  return name === "default" || /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}
function normalizeFormat(value) {
  return value === "esm" || value === "cjs" ? value : "unknown";
}
function normalizeSideEffects(value) {
  return value === "none" || value === "present" ? value : "unknown";
}
function manifestFacts(entry, fallbackOutFile) {
  if (!entry) return null;
  const outFile = entry.outFile ?? entry.out_file ?? fallbackOutFile;
  const entryPath = entry.entryPath ?? entry.entry_path ?? "";
  const packageName = entry.packageName ?? entry.package_name ?? "";
  const packageVersion = entry.packageVersion ?? entry.package_version ?? "";
  const packageSubpath = entry.packageSubpath ?? entry.package_subpath ?? "";
  const packageRoot = entry.packageRoot ?? entry.package_root ?? "";
  const artifactHash = entry.artifactHash ?? entry.artifact_hash ?? "";
  if (!outFile || !entryPath || !packageName || !packageVersion || !artifactHash) return null;
  return {
    outFile,
    entryPath,
    packageName,
    packageVersion,
    packageSubpath: packageSubpath || ".",
    packageRoot,
    format: normalizeFormat(entry.runtimeFormat ?? entry.runtime_format),
    sideEffects: normalizeSideEffects(entry.sideEffects ?? entry.side_effects),
    artifactHash
  };
}
function writeJsonAtomicIfChanged(filePath, value) {
  const next = `${JSON.stringify(value, null, 2)}
`;
  try {
    if (fs14.existsSync(filePath) && fs14.readFileSync(filePath, "utf8") === next) return;
  } catch {
  }
  fs14.mkdirSync(path16.dirname(filePath), { recursive: true });
  const tmp = path16.join(
    path16.dirname(filePath),
    `.${path16.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  fs14.writeFileSync(tmp, next, "utf8");
  fs14.renameSync(tmp, filePath);
}
function applyTransitiveDependencyDemand(directUsage, manifestByOutFile) {
  const usage = /* @__PURE__ */ new Map();
  for (const [fileName, item] of directUsage) {
    usage.set(fileName, {
      ...item,
      usedExports: sortedUnique(item.usedExports),
      importerKeys: sortedUnique(item.importerKeys),
      entryRootKeys: sortedUnique(item.entryRootKeys)
    });
  }
  const ensureTarget = (outFile, ownerFile, edgeKind) => {
    const existing = usage.get(outFile);
    if (existing) return existing;
    const facts = manifestFacts(manifestByOutFile.get(outFile), outFile);
    if (!facts) return null;
    const created = {
      fileName: outFile,
      entryPath: facts.entryPath,
      packageName: facts.packageName,
      packageVersion: facts.packageVersion,
      moduleFormat: facts.format,
      usedExports: [],
      hasNamespace: false,
      hasExportStar: false,
      importerKeys: [`${edgeKind}:${ownerFile}`],
      entryRootKeys: []
    };
    usage.set(outFile, created);
    return created;
  };
  const queue = Array.from(usage.keys()).sort();
  const visited = /* @__PURE__ */ new Set();
  while (queue.length > 0) {
    const ownerFile = queue.shift();
    if (visited.has(ownerFile)) continue;
    visited.add(ownerFile);
    const owner = manifestByOutFile.get(ownerFile);
    if (!owner) continue;
    const imports = Array.isArray(owner.dependencyImports) ? owner.dependencyImports.map((item) => ({
      outFile: item?.outFile ?? item?.out_file ?? "",
      mode: item?.mode === "default" ? "default" : "namespace",
      names: sortedUnique(item?.names ?? []),
      hasDefault: Boolean(item?.hasDefault ?? item?.has_default),
      hasNamespace: Boolean(item?.hasNamespace ?? item?.has_namespace),
      hasSideEffect: Boolean(item?.hasSideEffect ?? item?.has_side_effect),
      hasExportStar: Boolean(item?.hasExportStar ?? item?.has_export_star),
      uncertain: Boolean(item?.uncertain)
    })).filter((item) => item.outFile).map((item) => {
      const hasExactDemand = item.names.length > 0 || item.hasDefault || item.hasNamespace || item.hasSideEffect || item.hasExportStar || item.uncertain;
      if (hasExactDemand) return item;
      return item.mode === "default" ? { ...item, hasDefault: true } : { ...item, hasNamespace: true };
    }).sort(
      (a, b) => a.outFile.localeCompare(b.outFile) || a.mode.localeCompare(b.mode) || a.names.join(",").localeCompare(b.names.join(","))
    ) : [];
    for (const dependency of imports) {
      if (!visited.has(dependency.outFile) && manifestByOutFile.has(dependency.outFile)) {
        queue.push(dependency.outFile);
      }
      const target = ensureTarget(dependency.outFile, ownerFile, "dpl");
      if (!target) continue;
      if (dependency.uncertain || dependency.hasNamespace) {
        target.hasNamespace = true;
      }
      if (dependency.hasExportStar) {
        target.hasExportStar = true;
      }
      const nextExports = [
        ...target.usedExports,
        ...dependency.hasDefault ? ["default"] : [],
        ...dependency.names
      ];
      target.usedExports = sortedUnique(nextExports);
      target.importerKeys = sortedUnique([
        ...target.importerKeys,
        `dpl:${ownerFile}`
      ]);
    }
    const externalStar = sortedUnique(owner.exportAbi?.externalStar ?? []);
    for (const targetFile of externalStar) {
      if (!visited.has(targetFile) && manifestByOutFile.has(targetFile)) {
        queue.push(targetFile);
      }
      const target = ensureTarget(targetFile, ownerFile, "dpl-star");
      if (!target) continue;
      target.hasExportStar = true;
      target.importerKeys = sortedUnique([
        ...target.importerKeys,
        `dpl-star:${ownerFile}`
      ]);
    }
    queue.sort();
  }
  return usage;
}
function productionDependencyClosurePath(depsRoot) {
  return path16.join(depsRoot, "production-closure.v1.json");
}
function buildProductionDependencyClosure(options) {
  const manifestPath = path16.join(options.depsRoot, "manifest.json");
  const manifest = JSON.parse(fs14.readFileSync(manifestPath, "utf8"));
  const manifestEntries = manifest.entries ?? {};
  const manifestByOutFile = /* @__PURE__ */ new Map();
  for (const entry of Object.values(manifestEntries)) {
    const outFile = entry.outFile ?? entry.out_file;
    if (typeof outFile === "string" && outFile.length > 0 && !manifestByOutFile.has(outFile)) {
      manifestByOutFile.set(outFile, entry);
    }
  }
  const effectiveUsage = options.includeTransitiveDemand === true ? applyTransitiveDependencyDemand(options.usage, manifestByOutFile) : options.usage;
  const entries = {};
  for (const baseFileName of Array.from(effectiveUsage.keys()).sort()) {
    const usage = effectiveUsage.get(baseFileName);
    if (!usage) continue;
    const manifestEntry = manifestByOutFile.get(baseFileName);
    const facts = manifestFacts(manifestEntry, baseFileName);
    const abi = manifestEntry?.exportAbi;
    const abiNames = new Set(sortedUnique(abi?.names ?? []));
    const demanded = sortedUnique(usage.usedExports);
    const externalStar = sortedUnique(abi?.externalStar ?? []);
    const format = facts?.format ?? "unknown";
    const sideEffects = facts?.sideEffects ?? "unknown";
    const entryPath = facts?.entryPath ?? usage.entryPath;
    const packageName = facts?.packageName ?? usage.packageName;
    const packageVersion = facts?.packageVersion ?? usage.packageVersion;
    const packageSubpath = facts?.packageSubpath ?? ".";
    const packageRoot = facts?.packageRoot ?? "";
    const artifactHash = facts?.artifactHash ?? "";
    const dependencyAbiHash = typeof abi?.abiHash === "string" && abi.abiHash.length > 0 ? abi.abiHash : "";
    let fallbackReason = null;
    if (!manifestEntry || !facts || abi?.version !== 1 || !dependencyAbiHash) {
      fallbackReason = "missing-dabi";
    } else if (abi.uncertain === true) {
      fallbackReason = "uncertain-dabi";
    } else if (usage.hasNamespace) {
      fallbackReason = "namespace-import";
    } else if (usage.hasExportStar) {
      fallbackReason = "export-star";
    } else if (demanded.length === 0) {
      fallbackReason = "side-effect-or-dynamic-only";
    } else if (demanded.some((name) => name !== "default" && !abiNames.has(name)) || demanded.includes("default") && abi.hasDefault !== true) {
      fallbackReason = "demand-outside-dabi";
    } else if (format !== "esm") {
      fallbackReason = "non-esm";
    } else if (sideEffects !== "none") {
      fallbackReason = "side-effects-unproven";
    } else if (manifestEntry?.productionEsmSafe !== true) {
      fallbackReason = "esm-graph-unproven";
    } else if (demanded.some((name) => !isStaticExportName(name))) {
      fallbackReason = "non-static-export-name";
    }
    const finiteExports = fallbackReason === null ? demanded : null;
    const productionClosureHash = stableHash([
      `pdc:v${PRODUCTION_DEPENDENCY_CLOSURE_VERSION}`,
      `deps:${options.depsHash}`,
      `file:${baseFileName}`,
      `package:${packageName}@${packageVersion}`,
      `subpath:${packageSubpath}`,
      `artifact:${artifactHash || "missing"}`,
      `format:${format}`,
      `sideEffects:${sideEffects}`,
      `abi:${dependencyAbiHash || "missing"}`,
      `namespace:${usage.hasNamespace ? 1 : 0}`,
      `exportStar:${usage.hasExportStar ? 1 : 0}`,
      `fallback:${fallbackReason ?? "none"}`,
      ...demanded.map((name) => `use:${name}`),
      ...externalStar.map((name) => `star:${name}`)
    ]);
    entries[baseFileName] = {
      baseFileName,
      entryPath,
      packageName,
      packageVersion,
      packageSubpath,
      packageRoot,
      format,
      usedExports: finiteExports,
      hasNamespace: usage.hasNamespace,
      hasExportStar: usage.hasExportStar,
      sideEffects,
      dependencyAbiHash,
      externalStar,
      productionClosureHash,
      fallbackReason
    };
  }
  const closureHash = stableHash([
    `pdc-index:v${PRODUCTION_DEPENDENCY_CLOSURE_VERSION}`,
    `deps:${options.depsHash}`,
    ...Object.keys(entries).sort().map((key) => `${key}=${entries[key].productionClosureHash}`)
  ]);
  return {
    version: PRODUCTION_DEPENDENCY_CLOSURE_VERSION,
    depsHash: options.depsHash,
    appDemandIdentity: options.appDemandIdentity ?? "",
    entries,
    closureHash
  };
}
function computeAppDemandIdentity(modules, depsHash) {
  const rows = Array.from(modules).map((m) => `${m.id}\0${typeof m.hash === "string" ? m.hash : ""}`).sort();
  return stableHash([
    `pdc-demand:v${PRODUCTION_DEPENDENCY_CLOSURE_VERSION}`,
    `deps:${depsHash}`,
    ...rows
  ]);
}
function persistProductionDependencyClosure(depsRoot, closure) {
  writeJsonAtomicIfChanged(productionDependencyClosurePath(depsRoot), closure);
}
function loadProductionDependencyClosure(depsRoot, depsHash) {
  try {
    const parsed = JSON.parse(
      fs14.readFileSync(productionDependencyClosurePath(depsRoot), "utf8")
    );
    if (parsed?.version !== PRODUCTION_DEPENDENCY_CLOSURE_VERSION || parsed.depsHash !== depsHash || !parsed.entries || typeof parsed.entries !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// src/core/production-readiness-authority.ts
import fs15 from "fs";
import path17 from "path";
var PRODUCTION_READINESS_AUTHORITY_VERSION = 1;
var PRODUCTION_READINESS_RECORD_KIND = "deploy-ready.v1";
function resolveProductionReadinessRecordPath(ionifyDir) {
  return path17.join(ionifyDir, "production-readiness", "deploy-ready.v1.json");
}
function stableJson(value) {
  return JSON.stringify(normalizeForStableJson(value));
}
function hashStable(value) {
  return getCacheKey(stableJson(value));
}
function hashFileIfExists(filePath) {
  try {
    const stat = fs15.statSync(filePath);
    if (!stat.isFile()) return null;
    return getCacheKey(fs15.readFileSync(filePath));
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
        productionClosureHash: mod.productionClosureHash ?? null,
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
    configHash: input.configHash,
    workspaceHash,
    depsHash: input.depsHash,
    productionPlanHash,
    pdcClosureHash: input.pdcClosureHash ?? null,
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
    configHash: input.configHash,
    workspaceHash,
    depsHash: input.depsHash,
    productionPlanHash: computeProductionPlanHash(input.plan),
    pdcClosureHash: input.pdcClosureHash ?? null,
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
  const recordPath = resolveProductionReadinessRecordPath(ionifyDir);
  fs15.mkdirSync(path17.dirname(recordPath), { recursive: true });
  const tmpPath = `${recordPath}.${process.pid}.${Date.now()}.tmp`;
  fs15.writeFileSync(tmpPath, `${JSON.stringify(record, null, 2)}
`, "utf8");
  fs15.renameSync(tmpPath, recordPath);
}
function readProductionReadinessRecord(ionifyDir) {
  const recordPath = resolveProductionReadinessRecordPath(ionifyDir);
  try {
    const raw = JSON.parse(fs15.readFileSync(recordPath, "utf8"));
    if (!isProductionReadinessRecord(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}
function isVerifiedProductionReadinessForPlan(record, input) {
  if (!record || record.state !== "verified") return false;
  const identity = record.identity;
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
      const pkg = JSON.parse(fs15.readFileSync(pkgUrl, "utf8"));
      if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
    } catch {
    }
  }
  try {
    const pkgPath = path17.resolve(process.cwd(), "node_modules", "ionify", "package.json");
    const pkg = JSON.parse(fs15.readFileSync(pkgPath, "utf8"));
    if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
  } catch {
  }
  return "unknown";
}

// src/core/deps/vendor-pack-v2.ts
import fs16 from "fs";
import path18 from "path";
var DEPS_PREFIX = "/@deps/";
var IONIFY_VENDOR_PACK_V2_MARKER = "// ionify:vendor-pack-v2";
function readJsonFile(filePath) {
  if (!fs16.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs16.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
function writeJsonFile(filePath, data) {
  try {
    fs16.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  } catch {
  }
}
function vendorPackV2MemberKey(fileName) {
  return getCacheKey(`vp2:${fileName}`).slice(0, 12);
}
function readVendorPackV2KeyFromDisk(depsRoot, packFileName) {
  const packPath = path18.join(depsRoot, packFileName);
  if (!fs16.existsSync(packPath)) return null;
  try {
    const head = fs16.readFileSync(packPath, "utf8").slice(0, 256);
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
function readWrapperExportAbiNames(depsRoot, fileName) {
  const manifestPath = path18.join(depsRoot, "manifest.json");
  if (!fs16.existsSync(manifestPath)) return null;
  try {
    const raw = JSON.parse(fs16.readFileSync(manifestPath, "utf8"));
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
  const wrapperPath = path18.join(depsRoot, fileName);
  if (!fs16.existsSync(wrapperPath)) return null;
  let code = "";
  try {
    code = fs16.readFileSync(wrapperPath, "utf8");
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
    this.indexPath = path18.join(this.depsRoot, "vendor-pack.v2.index.json");
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
        const packPath = path18.join(this.depsRoot, packFileName);
        const sharedPath = path18.join(this.depsRoot, sharedFileName);
        if (!fs16.existsSync(packPath) || !fs16.existsSync(sharedPath)) continue;
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
      const packPath = path18.join(this.depsRoot, packFileName);
      const sharedPath = path18.join(this.depsRoot, sharedFileName);
      const chunksOk = fs16.existsSync(packPath) && fs16.existsSync(sharedPath) && chunkFiles.every((f) => typeof f === "string" && f.endsWith(".js") && fs16.existsSync(path18.join(this.depsRoot, f)));
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
          const head = fs16.readFileSync(packPath, "utf8").slice(0, 256);
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
        const wrapperPath = path18.join(this.depsRoot, fileName);
        if (!fs16.existsSync(wrapperPath)) continue;
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
    if (indexChanged || !fs16.existsSync(this.indexPath)) {
      this.writeIndex();
    }
  }
  ensurePackModuleFromEntries(options) {
    const { label, packFileName, sharedFileName, entries, prunePackPrefix } = options;
    if (!packFileName.endsWith(".js") || !sharedFileName.endsWith(".js")) return null;
    const sharedPath = path18.join(this.depsRoot, sharedFileName);
    if (!fs16.existsSync(sharedPath)) return null;
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
      `vendor-pack-v2:v1:${this.depsHash}:${packFileName}:${sharedFileName}:${safeMembers.join("|")}`
    );
    const outPath = path18.join(this.depsRoot, packFileName);
    let wroteModule = false;
    const moduleIsValidOnDisk = () => {
      if (!fs16.existsSync(outPath)) return false;
      try {
        const head = fs16.readFileSync(outPath, "utf8").slice(0, 256);
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
        fs16.writeFileSync(outPath, body, "utf8");
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
    if (indexChanged || !fs16.existsSync(this.indexPath)) {
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
    const sharedPath = path18.join(this.depsRoot, sharedFileName);
    if (!fs16.existsSync(sharedPath)) return null;
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
    const outPath = path18.join(this.depsRoot, packFileName);
    let wroteModule = false;
    const moduleIsValidOnDisk = () => {
      if (!fs16.existsSync(outPath)) return false;
      try {
        const head = fs16.readFileSync(outPath, "utf8").slice(0, 256);
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
        fs16.writeFileSync(outPath, body, "utf8");
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
    if (indexChanged || !fs16.existsSync(this.indexPath)) {
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
import crypto7 from "crypto";
var DEPS_CACHE_SCHEMA_VERSION = 1;
function computeDepsHash(configHash, lockfile, opts) {
  const hash = crypto7.createHash("sha256");
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

// src/core/production-artifact-publishing.ts
import fs17 from "fs";
import path19 from "path";
function resolveProductionPublicationDir(ionifyDir) {
  return path19.join(ionifyDir, "production-publication");
}
function resolveProductionPublicationStatePath(ionifyDir) {
  return path19.join(resolveProductionPublicationDir(ionifyDir), "state.v1.json");
}
function resolveProductionPublicationPlanPath(ionifyDir) {
  return path19.join(resolveProductionPublicationDir(ionifyDir), "plan.v1.json");
}
function readProductionPublicationState(ionifyDir) {
  const statePath = resolveProductionPublicationStatePath(ionifyDir);
  try {
    const parsed = JSON.parse(fs17.readFileSync(statePath, "utf8"));
    if (parsed?.version !== 1 || parsed?.noDistWrites !== true) return null;
    return parsed;
  } catch {
    return null;
  }
}
function samePublicationIdentity(a, b) {
  return a.mode === b.mode && a.nodeEnv === b.nodeEnv && a.configHash === b.configHash && a.depsHash === b.depsHash && a.depsOptimizerOutputVersion === b.depsOptimizerOutputVersion && a.entrySource === b.entrySource && JSON.stringify(a.entries ?? []) === JSON.stringify(b.entries ?? []);
}
function readProductionPublicationPlan(ionifyDir, expectedIdentity) {
  const state = readProductionPublicationState(ionifyDir);
  if (!state || state.state !== "published" || state.tiers.plan.state !== "published" || !samePublicationIdentity(state.identity, expectedIdentity)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs17.readFileSync(resolveProductionPublicationPlanPath(ionifyDir), "utf8"));
    if (parsed?.version !== 1 || !parsed.identity || !parsed.plan) return null;
    if (!samePublicationIdentity(parsed.identity, expectedIdentity)) return null;
    if (!Array.isArray(parsed.plan.entries) || !Array.isArray(parsed.plan.chunks)) return null;
    return parsed.plan;
  } catch {
    return null;
  }
}
function writeProductionPublicationPlan(ionifyDir, identity, plan) {
  const planPath = resolveProductionPublicationPlanPath(ionifyDir);
  const dir = path19.dirname(planPath);
  fs17.mkdirSync(dir, { recursive: true });
  const tmp = path19.join(dir, `.plan.v1.${process.pid}.${Date.now()}.tmp`);
  fs17.writeFileSync(
    tmp,
    `${JSON.stringify(
      {
        version: 1,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        identity,
        plan
      },
      null,
      2
    )}
`,
    "utf8"
  );
  fs17.renameSync(tmp, planPath);
}
function writeProductionBuildPlanProof(ionifyDir, identity, plan, timingsMs = {}) {
  writeProductionPublicationPlan(ionifyDir, identity, plan);
  const state = createProductionPublicationState(identity, "A", "published");
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
  const tmp = path19.join(dir, `.state.v1.${process.pid}.${Date.now()}.tmp`);
  fs17.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}
`, "utf8");
  fs17.renameSync(tmp, statePath);
}
function createProductionPublicationState(identity, phase, state) {
  return {
    version: 1,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    state,
    phase,
    noDistWrites: true,
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

// src/core/federation.ts
import fs18 from "fs";
import path20 from "path";
var FEDERATION_GRAPH_PREFIX = "ionify:federation:";
var FEDERATION_GRAPH_KIND_REMOTE_APP = "remote_app";
var FEDERATION_GRAPH_KIND_REMOTE_MANIFEST = "remote_manifest";
var FEDERATION_GRAPH_KIND_REMOTE_EXPOSE = "remote_expose";
var FEDERATION_GRAPH_KIND_REMOTE_SHARED_DEP = "remote_shared_dep";
function readProjectPackageJson(rootDir) {
  const filePath = path20.join(rootDir, "package.json");
  if (!fs18.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs18.readFileSync(filePath, "utf8"));
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
  const relative = path20.relative(rootDir, targetPath).split(path20.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}
function toPosixRelative(target) {
  const normalized = target.split(path20.sep).join("/");
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
  const packageName = typeof packageJson?.name === "string" && packageJson.name.trim().length > 0 ? packageJson.name.trim() : path20.basename(rootDir);
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
    const sourcePath = exposeSource.startsWith("/") ? path20.join(rootDir, exposeSource) : path20.resolve(rootDir, exposeSource);
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
    (exposeSource) => exposeSource.startsWith("/") ? path20.join(rootDir, exposeSource) : path20.resolve(rootDir, exposeSource)
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
  const packageName = typeof packageJson?.name === "string" && packageJson.name.trim().length > 0 ? packageJson.name.trim() : path20.basename(rootDir);
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
    const absPath = exposeSource.startsWith("/") ? path20.join(rootDir, exposeSource) : path20.resolve(rootDir, exposeSource);
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
  const containerDir = path20.posix.dirname(container.entry);
  const relativeFromContainer = (target) => {
    const relative = path20.posix.relative(containerDir, target);
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
import fs19 from "fs";
import path22 from "path";
import crypto8 from "crypto";

// src/core/graph-kind.ts
import path21 from "path";
var GRAPH_KIND_DEPENDENCY = "dependency";
var GRAPH_KIND_VIRTUAL = "virtual";
var GRAPH_KIND_CONFIG = "config";
var GRAPH_KIND_TOOLCHAIN = "toolchain";
var RUNTIME_GRAPH_KINDS = /* @__PURE__ */ new Set(["js", "css", "asset", "dep"]);
function isRuntimeGraphKind(kind) {
  return typeof kind === "string" && RUNTIME_GRAPH_KINDS.has(kind);
}
function classifyStructuralGraphKind(absPath) {
  const base = path21.basename(absPath).toLowerCase();
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
  if (explicit) return path22.resolve(explicit);
  const fromEnv = process.env.IONIFY_STATE_DIR;
  if (fromEnv && path22.isAbsolute(fromEnv)) return fromEnv;
  return path22.join(process.cwd(), ".ionify");
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
    this.graphFile = path22.join(this.ionifyDir, "graph.json");
    this.graphDbPath = path22.join(this.ionifyDir, "graph.db");
    this.workspaceRoot = resolveWorkspaceRoot(null);
    if (!fs19.existsSync(this.ionifyDir)) {
      fs19.mkdirSync(this.ionifyDir, { recursive: true });
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
          const stat = fsPath && fs19.existsSync(fsPath) ? fs19.statSync(fsPath) : null;
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
    if (!fs19.existsSync(this.graphFile)) return;
    try {
      const raw = fs19.readFileSync(this.graphFile, "utf8");
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
      fs19.writeFileSync(this.graphFile, JSON.stringify(snap, null, 2), "utf8");
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
    const stat = fs19.existsSync(absPath) ? fs19.statSync(absPath) : null;
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
    if (!fs19.existsSync(absPath)) {
      return this.recordNodeById(moduleId, null, [], [], GRAPH_KIND_VIRTUAL);
    }
    const stat = fs19.statSync(absPath);
    if (!stat.isFile()) return false;
    const hash = crypto8.createHash("sha256").update(fs19.readFileSync(absPath)).digest("hex");
    return this.recordNodeById(moduleId, hash, [], [], kind);
  }
  recordStructuralFiles(absPaths) {
    let changed = 0;
    const seen = /* @__PURE__ */ new Set();
    for (const absPath of absPaths) {
      if (typeof absPath !== "string" || absPath.length === 0) continue;
      if (!path22.isAbsolute(absPath) || seen.has(absPath)) continue;
      seen.add(absPath);
      if (this.recordStructuralFile(absPath)) changed++;
    }
    return changed;
  }
  /** Infer module kind from file extension */
  inferKind(absPath) {
    const ext = path22.extname(absPath).toLowerCase();
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
import fs20 from "fs";
import path23 from "path";
function resolveConfiguredBuildEntries(config, rootDir) {
  const configured = config?.entry ? (Array.isArray(config.entry) ? config.entry : [config.entry]).map((entry) => entry.startsWith("/") ? path23.join(rootDir, entry) : path23.resolve(rootDir, entry)).filter((entry) => typeof entry === "string" && entry.length > 0) : [];
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
    return path23.join(rootDir, withoutQuery.replace(/^[/\\]+/, ""));
  }
  return path23.resolve(path23.dirname(htmlInput), withoutQuery);
}
function inferBuildEntriesFromHtml(rootDir, onWarn) {
  const htmlInput = path23.join(rootDir, "index.html");
  if (!fs20.existsSync(htmlInput)) return [];
  let html = "";
  try {
    html = fs20.readFileSync(htmlInput, "utf8");
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
    if (!fs20.existsSync(resolved)) {
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
      extensions: config?.resolve?.extensions,
      conditions: config?.resolve?.conditions,
      mainFields: config?.resolve?.mainFields
    },
    cssOptions: config?.css,
    assetOptions: config?.assets ?? config?.asset,
    runtimeContracts: {
      reactRefreshRuntimeModule: REACT_REFRESH_RUNTIME_MODULE,
      federation: buildFederationVersionContract(config?.federation)
    }
  };
}

// src/cli/commands/build.ts
var DEPS_OPTIMIZER_OUTPUT_VERSION = getDepsOptimizerOutputVersion();
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
function readJsonFile2(filePath) {
  if (!fs21.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs21.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
function writeJsonFile2(filePath, data) {
  try {
    const next = JSON.stringify(data, null, 2) + "\n";
    try {
      if (fs21.existsSync(filePath)) {
        const prev = fs21.readFileSync(filePath, "utf8");
        if (prev === next) return;
      }
    } catch {
    }
    fs21.writeFileSync(filePath, next, "utf8");
  } catch {
  }
}
async function writeTextFileIfChanged2(filePath, contents) {
  const nextBytes = Buffer.byteLength(contents, "utf8");
  try {
    const stat = await fs21.promises.stat(filePath);
    if (stat.isFile() && stat.size === nextBytes) {
      const existing = await fs21.promises.readFile(filePath, "utf8");
      if (existing === contents) return;
    }
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
  await fs21.promises.mkdir(path24.dirname(filePath), { recursive: true });
  await fs21.promises.writeFile(filePath, contents, "utf8");
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
  return path24.isAbsolute(dir) ? dir : path24.resolve(rootDir, dir);
}
async function copyPublicDirToOutDir(publicDirAbs, outDirAbs, previousPublicAssets = []) {
  if (!publicDirAbs) return { assets: [], copied: [], conflicts: [] };
  const srcRoot = path24.resolve(publicDirAbs);
  const destRoot = path24.resolve(outDirAbs);
  const previousByFile = new Map(previousPublicAssets.map((asset) => [asset.file, asset]));
  let srcStat = null;
  try {
    srcStat = fs21.statSync(srcRoot);
  } catch {
    return { assets: [], copied: [], conflicts: [] };
  }
  if (!srcStat.isDirectory()) return { assets: [], copied: [], conflicts: [] };
  const currentEntries = [];
  const copiedEntries = [];
  const conflicts = [];
  const queue = [srcRoot];
  while (queue.length) {
    const dir = queue.pop();
    let entries;
    try {
      entries = await fs21.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const srcPath = path24.join(dir, entry.name);
      if (isForbiddenFsPath(srcPath)) continue;
      if (entry.isDirectory()) {
        queue.push(srcPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path24.relative(srcRoot, srcPath);
      if (!rel || rel.startsWith("..")) continue;
      const relPosix = rel.replace(/\\+/g, "/");
      const destPath = path24.join(destRoot, rel);
      if (!destPath.startsWith(destRoot + path24.sep) && destPath !== destRoot) continue;
      if (fs21.existsSync(destPath)) {
        const previous = previousByFile.get(relPosix);
        if (previous) {
          currentEntries.push(previous);
          continue;
        }
        conflicts.push(relPosix);
        continue;
      }
      try {
        const fileBytes = await fs21.promises.readFile(srcPath);
        await fs21.promises.mkdir(path24.dirname(destPath), { recursive: true });
        await fs21.promises.writeFile(destPath, fileBytes);
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
    logInfo(`[Build][public] Copied ${copiedEntries.length} file(s) from publicDir into ${path24.basename(destRoot)}/`);
  }
  if (conflicts.length) {
    logWarn(`[Build][public] Skipped ${conflicts.length} file(s) due to output conflicts (will not overwrite build artifacts)`);
  }
  return { assets: currentEntries, copied: copiedEntries, conflicts };
}
function isProductionSourceFreshnessCurrent(plan, ionifyDir, workspaceRoot) {
  const freshnessCacheFile = path24.join(ionifyDir, "source-freshness.v1.json");
  let freshnessCache = {};
  try {
    const parsed = JSON.parse(fs21.readFileSync(freshnessCacheFile, "utf8"));
    if (parsed && typeof parsed === "object") {
      freshnessCache = parsed;
    }
  } catch {
    return false;
  }
  for (const chunk of plan.chunks) {
    for (const mod of chunk.modules) {
      if (mod.kind !== "js" && mod.kind !== "css") continue;
      let fsPath = typeof mod.fsPath === "string" && mod.fsPath.length > 0 ? mod.fsPath : null;
      if (!fsPath && typeof mod.id === "string" && mod.id.startsWith(WS_MODULE_PREFIX)) {
        fsPath = fromWsModuleId(mod.id, workspaceRoot);
      }
      if (!fsPath || !path24.isAbsolute(fsPath)) continue;
      if (fsPath.includes("node_modules") || fsPath.includes("/.ionify/")) continue;
      try {
        const st = fs21.statSync(fsPath);
        const cacheKey = `${mod.id}
${fsPath}`;
        const cached = freshnessCache[cacheKey];
        if (!cached || cached.fsPath !== fsPath || cached.dev !== st.dev || cached.ino !== st.ino || cached.mtimeMs !== st.mtimeMs || cached.ctimeMs !== st.ctimeMs || cached.size !== st.size || typeof cached.hash !== "string" || cached.hash.length === 0 || typeof mod.hash === "string" && mod.hash.length > 0 && mod.hash !== cached.hash) {
          return false;
        }
      } catch {
        return false;
      }
    }
  }
  return true;
}
function isCssModuleFile(filePath) {
  return isCssModuleLikePath(filePath);
}
function recordStructuralGraphFiles(absPaths, workspaceRoot, configHash) {
  if (!native?.graphRecord) return;
  const seen = /* @__PURE__ */ new Set();
  for (const absPath of absPaths) {
    if (typeof absPath !== "string" || absPath.length === 0 || !path24.isAbsolute(absPath)) continue;
    if (seen.has(absPath)) continue;
    seen.add(absPath);
    const id = toWsModuleId(absPath, workspaceRoot);
    if (!id) continue;
    try {
      const existing = typeof native.graphGet === "function" ? native.graphGet(id) : null;
      if (existing && isRuntimeGraphKind(existing.kind)) continue;
      if (!fs21.existsSync(absPath)) {
        native.graphRecord(id, null, [], [], GRAPH_KIND_VIRTUAL, configHash);
        continue;
      }
      const stat = fs21.statSync(absPath);
      if (!stat.isFile()) continue;
      const hash = crypto9.createHash("sha256").update(fs21.readFileSync(absPath)).digest("hex");
      native.graphRecord(id, hash, [], [], classifyStructuralGraphKind(absPath), configHash);
    } catch {
    }
  }
}
function computeDepsContentStampHash(depsAbs, moduleMetaById, workspaceRoot) {
  if (!depsAbs.length) return "0";
  const entries = [];
  for (const depAbs of depsAbs) {
    const abs = path24.resolve(depAbs);
    let hash = null;
    const depId = toWsModuleId(abs, workspaceRoot);
    if (depId) hash = moduleMetaById.get(depId)?.hash ?? null;
    if (!hash) {
      try {
        const raw = fs21.readFileSync(abs);
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
function loadDepsManifestIndex(depsRoot) {
  const manifestPath = path24.join(depsRoot, "manifest.json");
  if (!fs21.existsSync(manifestPath)) return /* @__PURE__ */ new Map();
  try {
    const raw = fs21.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    const entries = parsed?.entries ?? {};
    const map = /* @__PURE__ */ new Map();
    for (const [entryPath, entry] of Object.entries(entries)) {
      const outFile = entry?.outFile ?? entry?.out_file ?? null;
      if (typeof outFile !== "string" || !outFile.endsWith(".js")) continue;
      const sizeBytes = typeof entry.sizeBytes === "number" ? entry.sizeBytes : typeof entry.size_bytes === "number" ? entry.size_bytes : 0;
      const moduleCount = typeof entry.moduleCount === "number" ? entry.moduleCount : typeof entry.module_count === "number" ? entry.module_count : 0;
      const edgeCount = typeof entry.edgeCount === "number" ? entry.edgeCount : typeof entry.edge_count === "number" ? entry.edge_count : 0;
      const externalCount = typeof entry.externalCount === "number" ? entry.externalCount : typeof entry.external_count === "number" ? entry.external_count : 0;
      const chunkGroup = typeof entry.chunkGroup === "string" ? entry.chunkGroup : typeof entry.chunk_group === "string" ? entry.chunk_group : null;
      const chunkFilesRaw = Array.isArray(entry.chunkFiles) ? entry.chunkFiles : Array.isArray(entry.chunk_files) ? entry.chunk_files : [];
      const chunkFiles = (Array.isArray(chunkFilesRaw) ? chunkFilesRaw : []).map((v) => typeof v === "string" ? v : null).filter((v) => typeof v === "string" && v.length > 0);
      map.set(outFile, {
        entryPath,
        packageLabel: entry.package || "unknown",
        hasSourcemap: entry.hasSourcemap === true,
        sizeBytes,
        moduleCount,
        edgeCount,
        externalCount,
        chunkGroup,
        chunkFiles
      });
    }
    return map;
  } catch {
    return /* @__PURE__ */ new Map();
  }
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
  const { plan, depsRoot, casRoot, configHash, workspaceRoot, productionClosure } = options;
  const depsArtifactsByEntry = /* @__PURE__ */ new Map();
  const manifestPath = path24.join(depsRoot, "manifest.json");
  if (!fs21.existsSync(manifestPath)) return { rerouted: 0, pruned: 0, sharedPrewarmed: 0, idRewritten: 0 };
  try {
    const raw = fs21.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    const manifestEntries = parsed?.entries ?? {};
    for (const [entryPath, entry] of Object.entries(manifestEntries)) {
      const outFile = entry?.outFile ?? entry?.out_file ?? null;
      if (typeof outFile !== "string" || !outFile.endsWith(".js")) continue;
      const artifactPath = path24.join(depsRoot, outFile);
      if (!fs21.existsSync(artifactPath)) continue;
      const artifactHash = entry?.artifactHash ?? "";
      const sharedImports = Array.isArray(entry?.sharedImports) ? entry.sharedImports : [];
      let canonicalEntry;
      try {
        canonicalEntry = fs21.realpathSync.native(entryPath);
      } catch {
        canonicalEntry = path24.resolve(entryPath);
      }
      depsArtifactsByEntry.set(canonicalEntry, { outFile, artifactPath, artifactHash, sharedImports });
    }
  } catch {
    return { rerouted: 0, pruned: 0, sharedPrewarmed: 0, idRewritten: 0 };
  }
  if (depsArtifactsByEntry.size === 0) return { rerouted: 0, pruned: 0, sharedPrewarmed: 0, idRewritten: 0 };
  let rerouted = 0;
  let pruned = 0;
  let idRewritten = 0;
  const idRemap = /* @__PURE__ */ new Map();
  const claimedNewIds = /* @__PURE__ */ new Set();
  const reroutedPathsByChunk = /* @__PURE__ */ new Map();
  for (const chunk of plan.chunks) {
    const keptModules = [];
    for (const mod of chunk.modules) {
      let fsPath = typeof mod.fsPath === "string" && mod.fsPath.length > 0 ? mod.fsPath : null;
      if (!fsPath && typeof mod.id === "string" && mod.id.startsWith(WS_MODULE_PREFIX)) {
        fsPath = fromWsModuleId(mod.id, workspaceRoot);
      }
      if (!fsPath && typeof mod.id === "string" && path24.isAbsolute(mod.id)) {
        fsPath = mod.id;
      }
      const isNodeModules = fsPath ? fsPath.includes("node_modules") : mod.id.includes("node_modules");
      if (!isNodeModules) {
        keptModules.push(mod);
        continue;
      }
      let canonical = null;
      if (fsPath) {
        try {
          canonical = fs21.realpathSync.native(fsPath);
        } catch {
          canonical = path24.resolve(fsPath);
        }
      }
      const artifact = canonical ? depsArtifactsByEntry.get(canonical) : null;
      if (artifact) {
        let resolvedHash;
        const artifactCasDir = artifact.artifactHash ? getCasArtifactPath(casRoot, configHash, artifact.artifactHash) : null;
        const artifactCasFile = artifactCasDir ? path24.join(artifactCasDir, "transformed.js") : null;
        if (artifact.artifactHash && artifactCasFile && fs21.existsSync(artifactCasFile) && casTextFileMatchesHash(artifactCasFile, artifact.artifactHash)) {
          resolvedHash = artifact.artifactHash;
        } else {
          const artifactCode = fs21.readFileSync(artifact.artifactPath, "utf8");
          resolvedHash = artifact.artifactHash || getCacheKey(artifactCode);
          const casDir = getCasArtifactPath(casRoot, configHash, resolvedHash);
          const casFile = path24.join(casDir, "transformed.js");
          fs21.mkdirSync(casDir, { recursive: true });
          fs21.writeFileSync(casFile, artifactCode, "utf8");
        }
        mod.fsPath = artifact.artifactPath;
        mod.hash = resolvedHash;
        const closure = productionClosure?.entries?.[artifact.outFile];
        if (closure) {
          mod.dependencyFormat = closure.format;
          mod.dependencyAbiHash = closure.dependencyAbiHash || void 0;
          mod.productionClosureHash = closure.productionClosureHash;
          mod.sideEffects = closure.sideEffects;
        }
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
        keptModules.push(mod);
        rerouted += 1;
        let chunkSet = reroutedPathsByChunk.get(chunk.id);
        if (!chunkSet) {
          chunkSet = /* @__PURE__ */ new Set();
          reroutedPathsByChunk.set(chunk.id, chunkSet);
        }
        chunkSet.add(artifact.artifactPath);
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
      }
    }
  }
  const artifactSharedImports = /* @__PURE__ */ new Map();
  for (const entry of depsArtifactsByEntry.values()) {
    if (entry.sharedImports.length > 0) {
      artifactSharedImports.set(entry.artifactPath, entry.sharedImports);
    }
  }
  const depsImportRe = /["'](\/@deps\/([^"'?]+\.js))["']/g;
  const prewarnedSharedPaths = /* @__PURE__ */ new Set();
  let sharedPrewarmed = 0;
  for (const [chunkId, artifactPaths] of reroutedPathsByChunk.entries()) {
    const chunk = plan.chunks.find((c) => c.id === chunkId);
    if (!chunk) continue;
    const sharedFilesToAdd = [];
    for (const wrapperPath of artifactPaths) {
      const persistedImports = artifactSharedImports.get(wrapperPath);
      if (persistedImports !== void 0) {
        for (const relFile of persistedImports) {
          const absPath = path24.join(depsRoot, relFile);
          if (prewarnedSharedPaths.has(absPath)) continue;
          if (!fs21.existsSync(absPath)) continue;
          let sharedCode;
          try {
            sharedCode = fs21.readFileSync(absPath, "utf8");
          } catch {
            continue;
          }
          const sharedHash = getCacheKey(sharedCode);
          const sharedCasDir = getCasArtifactPath(casRoot, configHash, sharedHash);
          const sharedCasFile = path24.join(sharedCasDir, "transformed.js");
          if (!fs21.existsSync(sharedCasFile)) {
            fs21.mkdirSync(sharedCasDir, { recursive: true });
            fs21.writeFileSync(sharedCasFile, sharedCode, "utf8");
          }
          prewarnedSharedPaths.add(absPath);
          sharedFilesToAdd.push({ absPath, hash: sharedHash });
          sharedPrewarmed += 1;
        }
        continue;
      }
      let wrapperCode;
      try {
        wrapperCode = fs21.readFileSync(wrapperPath, "utf8");
      } catch {
        continue;
      }
      depsImportRe.lastIndex = 0;
      let match;
      while ((match = depsImportRe.exec(wrapperCode)) !== null) {
        const relFile = match[2];
        const isSharedOrPack = relFile.startsWith("shared.") || relFile.startsWith("vendor-pack.") || relFile.startsWith("vendor-core.");
        if (!isSharedOrPack) continue;
        const absPath = path24.join(depsRoot, relFile);
        if (prewarnedSharedPaths.has(absPath)) continue;
        if (!fs21.existsSync(absPath)) continue;
        let sharedCode;
        try {
          sharedCode = fs21.readFileSync(absPath, "utf8");
        } catch {
          continue;
        }
        const sharedHash = getCacheKey(sharedCode);
        const sharedCasDir = getCasArtifactPath(casRoot, configHash, sharedHash);
        const sharedCasFile = path24.join(sharedCasDir, "transformed.js");
        if (!fs21.existsSync(sharedCasFile)) {
          fs21.mkdirSync(sharedCasDir, { recursive: true });
          fs21.writeFileSync(sharedCasFile, sharedCode, "utf8");
        }
        prewarnedSharedPaths.add(absPath);
        sharedFilesToAdd.push({ absPath, hash: sharedHash });
        sharedPrewarmed += 1;
      }
    }
    for (const { absPath, hash } of sharedFilesToAdd) {
      let sharedId = absPath;
      try {
        sharedId = toWsModuleId(absPath, workspaceRoot) ?? absPath;
      } catch {
        sharedId = absPath;
      }
      chunk.modules.push({
        id: sharedId,
        fsPath: absPath,
        hash,
        kind: "js",
        deps: [],
        dynamicDeps: []
      });
    }
  }
  return { rerouted, pruned, sharedPrewarmed, idRewritten };
}
function attachProductionClosureMetadata(options) {
  const { plan, depsRoot, workspaceRoot, productionClosure } = options;
  if (!productionClosure) return 0;
  const manifestPath = path24.join(depsRoot, "manifest.json");
  if (!fs21.existsSync(manifestPath)) return 0;
  const closureByArtifactPath = /* @__PURE__ */ new Map();
  const closureByArtifactId = /* @__PURE__ */ new Map();
  try {
    const raw = fs21.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    const manifestEntries = parsed?.entries ?? {};
    for (const entry of Object.values(manifestEntries)) {
      const outFile = entry?.outFile ?? entry?.out_file ?? null;
      if (typeof outFile !== "string" || !outFile.endsWith(".js")) continue;
      const closure = productionClosure.entries[outFile];
      if (!closure) continue;
      const artifactPath = path24.join(depsRoot, outFile);
      closureByArtifactPath.set(path24.resolve(artifactPath), closure);
      try {
        closureByArtifactId.set(toWsModuleId(artifactPath, workspaceRoot), closure);
      } catch {
      }
    }
  } catch {
    return 0;
  }
  if (closureByArtifactPath.size === 0 && closureByArtifactId.size === 0) return 0;
  let attached = 0;
  for (const chunk of plan.chunks) {
    for (const mod of chunk.modules) {
      let closure = typeof mod.id === "string" ? closureByArtifactId.get(mod.id) : void 0;
      if (!closure && typeof mod.fsPath === "string" && mod.fsPath.length > 0) {
        closure = closureByArtifactPath.get(path24.resolve(mod.fsPath));
      }
      if (!closure) continue;
      mod.dependencyFormat = closure.format;
      mod.dependencyAbiHash = closure.dependencyAbiHash || void 0;
      mod.productionClosureHash = closure.productionClosureHash;
      mod.sideEffects = closure.sideEffects;
      attached += 1;
    }
  }
  return attached;
}
async function prepareCanonicalProductionDependencyPlan(options) {
  const rerouteStart = Date.now();
  const { rerouted, pruned, sharedPrewarmed, idRewritten } = rerouteDepsArtifacts({
    plan: options.plan,
    depsRoot: options.depsRoot,
    casRoot: options.casRoot,
    configHash: options.configHash,
    workspaceRoot: options.workspaceRoot
  });
  const rerouteMs = Date.now() - rerouteStart;
  const pdcStart = Date.now();
  const appDemandIdentity = computeAppDemandIdentity(
    options.plan.chunks.flatMap((chunk) => chunk.modules),
    options.depsHash
  );
  const productionClosure = await prepareProductionDependencyClosure({
    rootDir: options.rootDir,
    depsRoot: options.depsRoot,
    depsHash: options.depsHash,
    resolvedEntries: options.resolvedEntries,
    allowedRoots: options.allowedRoots,
    appDemandIdentity
  });
  const metadataAttached = attachProductionClosureMetadata({
    plan: options.plan,
    depsRoot: options.depsRoot,
    workspaceRoot: options.workspaceRoot,
    productionClosure
  });
  const closureEntries = productionClosure ? Object.values(productionClosure.entries) : [];
  const finite = closureEntries.filter((entry) => entry.usedExports !== null).length;
  return {
    productionClosure,
    rerouted,
    pruned,
    sharedPrewarmed,
    idRewritten,
    metadataAttached,
    finite,
    fallback: closureEntries.length - finite,
    pdcMs: Date.now() - pdcStart,
    rerouteMs
  };
}
function casTextFileMatchesHash(filePath, expectedHash) {
  try {
    return getCacheKey(fs21.readFileSync(filePath, "utf8")) === expectedHash;
  } catch {
    return false;
  }
}
function computeBuildSlimmingSavedPercent(depsRoot, depsHash) {
  let entries = [];
  try {
    entries = fs21.readdirSync(depsRoot);
  } catch {
    return null;
  }
  let totalFull = 0;
  let totalSlim = 0;
  const slimFiles = entries.filter((name) => name.startsWith("vendor-pack.manual.") && name.endsWith(".slim.json"));
  for (const fileName of slimFiles) {
    const group = fileName.slice("vendor-pack.manual.".length, -".slim.json".length);
    if (!group) continue;
    const baseStatePath = path24.join(depsRoot, `vendor-pack.manual.${group}.json`);
    const slimStatePath = path24.join(depsRoot, fileName);
    if (!fs21.existsSync(baseStatePath) || !fs21.existsSync(slimStatePath)) continue;
    try {
      const base = JSON.parse(fs21.readFileSync(baseStatePath, "utf8"));
      const slim = JSON.parse(fs21.readFileSync(slimStatePath, "utf8"));
      if (!base || !slim) continue;
      if (base.depsHash !== depsHash || slim.depsHash !== depsHash) continue;
      if (base.status !== "ready" || slim.status !== "ready") continue;
      const fullShared = typeof base.sharedFileName === "string" ? base.sharedFileName : null;
      const slimShared = typeof slim.sharedFileName === "string" ? slim.sharedFileName : null;
      if (!fullShared || !slimShared) continue;
      const fullPath = path24.join(depsRoot, fullShared);
      const slimPath = path24.join(depsRoot, slimShared);
      if (!fs21.existsSync(fullPath) || !fs21.existsSync(slimPath)) continue;
      const fullBytes = fs21.statSync(fullPath).size;
      const slimBytes = fs21.statSync(slimPath).size;
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
  const indexPath = path24.join(depsRoot, "vendor-pack.v2.index.json");
  if (!fs21.existsSync(indexPath)) return null;
  try {
    const raw = JSON.parse(fs21.readFileSync(indexPath, "utf8"));
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
function escapeRegExp2(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function compileManualPackMatchers(patterns) {
  const matchers = [];
  for (const rawPattern of patterns) {
    const pattern = String(rawPattern ?? "").trim();
    if (!pattern) continue;
    if (pattern.includes("*")) {
      const source = `^${escapeRegExp2(pattern).replace(/\\\*/g, ".*")}$`;
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
  const depUsagePath = path24.join(depsRoot, "deps-usage.v2.json");
  const legacyDepUsagePath = path24.join(depsRoot, "deps-usage.v1.json");
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
  const depUsagePath = path24.join(depsRoot, "deps-usage.v2.json");
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
async function resolveUsageEntries(rootDir, resolvedEntries) {
  const usageEntries = [];
  if (Array.isArray(resolvedEntries) && resolvedEntries.length > 0) {
    usageEntries.push(...resolvedEntries);
    return usageEntries;
  }
  for (const candidate of [
    path24.join(rootDir, "src", "main.tsx"),
    path24.join(rootDir, "src", "main.ts"),
    path24.join(rootDir, "src", "index.tsx"),
    path24.join(rootDir, "src", "index.ts")
  ]) {
    if (fs21.existsSync(candidate)) usageEntries.push(candidate);
  }
  return usageEntries;
}
async function prepareProductionDependencyClosure(options) {
  if (options.appDemandIdentity) {
    const cached = loadProductionDependencyClosure(options.depsRoot, options.depsHash);
    if (cached && cached.appDemandIdentity === options.appDemandIdentity) {
      return cached;
    }
  }
  if (!fs21.existsSync(path24.join(options.depsRoot, "manifest.json"))) {
    return null;
  }
  const usageEntries = await resolveUsageEntries(options.rootDir, options.resolvedEntries);
  if (usageEntries.length === 0) {
    return null;
  }
  const manifestIndex = loadDepsManifestIndex(options.depsRoot);
  const canonicalFileNames = buildCanonicalDepFileNameIndex(
    Array.from(manifestIndex, ([fileName, entry]) => ({
      fileName,
      entryPath: entry.entryPath
    }))
  );
  try {
    const usage = canonicalizeDepUsageIndex(
      await scanDepUsage({
        rootDir: options.rootDir,
        entries: usageEntries,
        allowedRoots: options.allowedRoots
      }),
      canonicalFileNames
    );
    saveDepUsageIndexToDisk(options.depsRoot, options.depsHash, usage);
    const closure = buildProductionDependencyClosure({
      depsRoot: options.depsRoot,
      depsHash: options.depsHash,
      usage,
      appDemandIdentity: options.appDemandIdentity
    });
    persistProductionDependencyClosure(options.depsRoot, closure);
    return closure;
  } catch (err) {
    logWarn(`[PDC] Closure computation failed; using complete DPL artifacts (${String(err)})`);
    return null;
  }
}
function isReadyManualPackState(raw, depsRoot, depsHash, group) {
  if (!raw || typeof raw !== "object") return false;
  if (raw.version !== 1 || raw.depsHash !== depsHash || raw.group !== group) return false;
  if (raw.outputVersion !== DEPS_OPTIMIZER_OUTPUT_VERSION) return false;
  if (raw.status !== "ready") return false;
  if (typeof raw.chunkGroupId !== "string" || raw.chunkGroupId.length === 0) return false;
  if (typeof raw.sharedFileName !== "string" || raw.sharedFileName.length === 0) return false;
  if (!Array.isArray(raw.entries) || raw.entries.length === 0) return false;
  if (!fs21.existsSync(path24.join(depsRoot, raw.sharedFileName))) return false;
  return raw.entries.every((e) => e?.fileName && fs21.existsSync(path24.join(depsRoot, String(e.fileName))));
}
function isReadyManualSlimState(raw, depsRoot, depsHash, group) {
  if (!raw || typeof raw !== "object") return false;
  if (raw.version !== 1 || raw.depsHash !== depsHash || raw.group !== group) return false;
  if (raw.outputVersion !== DEPS_OPTIMIZER_OUTPUT_VERSION) return false;
  if (raw.status !== "ready") return false;
  if (typeof raw.chunkGroupId !== "string" || raw.chunkGroupId.length === 0) return false;
  if (typeof raw.sharedFileName !== "string" || raw.sharedFileName.length === 0) return false;
  if (!Array.isArray(raw.entries) || raw.entries.length === 0) return false;
  if (!fs21.existsSync(path24.join(depsRoot, raw.sharedFileName))) return false;
  return raw.entries.every((e) => e?.wrapperFileName && fs21.existsSync(path24.join(depsRoot, String(e.wrapperFileName))));
}
async function prepareProductionAutoCorePack(options) {
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
  const entries = [];
  const seen = /* @__PURE__ */ new Set();
  for (const spec of vendorSpecifiers) {
    try {
      const resolved = native.resolveModule(spec, rootDir);
      const kind = resolved?.kind;
      if (!kind || kind === "Builtin" || kind === "Virtual" || kind === "NotFound") continue;
      const fsPath = resolved?.fsPath ?? resolved?.fs_path ?? null;
      if (!fsPath || typeof fsPath !== "string") continue;
      if (!fsPath.includes("node_modules")) continue;
      if (!isOptimizableDepEntryPath(fsPath)) continue;
      const pkg = resolved?.pkg ?? null;
      const packageName = typeof pkg?.name === "string" ? pkg.name : spec;
      const packageVersion = typeof pkg?.version === "string" ? pkg.version : "0.0.0";
      const subpath = computeSubpathFromEntryPath(fsPath);
      const dep = registerDepEntry({
        entryPath: fsPath,
        packageName,
        packageVersion,
        subpath
      });
      if (!dep?.fileName || seen.has(dep.fileName)) continue;
      seen.add(dep.fileName);
      entries.push({ entryPath: fsPath, fileName: dep.fileName, packageLabel: spec });
    } catch {
    }
  }
  if (entries.length <= 1) return { enabled: true, didWork: false };
  entries.sort((a, b) => a.packageLabel.localeCompare(b.packageLabel));
  const chunkGroupId = computeChunkGroupIdFromStableIds(entries.map((e) => e.fileName));
  const sharedFileName = `shared.${chunkGroupId}.js`;
  const sharedPath = path24.join(depsRoot, sharedFileName);
  const statePath = path24.join(depsRoot, "vendor-pack.feature.core.json");
  const existingState = readJsonFile2(statePath);
  const currentNodeEnv = process.env.NODE_ENV ?? "development";
  const alreadyReady = fs21.existsSync(sharedPath) && entries.every((e) => fs21.existsSync(path24.join(depsRoot, e.fileName))) && // nodeEnv guard: empty/absent means pre-T17 pack — allow as cache hit on first run,
  // the pack will be re-stamped with nodeEnv on next re-optimization cycle.
  (!existingState?.nodeEnv || existingState.nodeEnv.toLowerCase() === currentNodeEnv.toLowerCase());
  const vendorPackV2 = new VendorPackV2IndexManager({
    depsRoot,
    depsHash,
    outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
    allowPackFilePrefix: "vendor-pack.feature.",
    log: { info: logInfo, warn: logWarn }
  });
  vendorPackV2.loadFromDisk();
  if (alreadyReady) {
    writeJsonFile2(statePath, {
      version: 1,
      depsHash,
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      nodeEnv: process.env.NODE_ENV,
      group: "core",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      status: "ready",
      chunkGroupId,
      sharedFileName,
      entries
    });
    vendorPackV2.ensurePackModuleFromEntries({
      label: "feature/core",
      packFileName: `vendor-pack.feature.core.${chunkGroupId}.js`,
      sharedFileName,
      entries,
      prunePackPrefix: "vendor-pack.feature.core."
    });
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
    chunkGroupId,
    sharedFileName,
    entries
  });
  let didWork = false;
  try {
    const chunked = native?.optimizeDependenciesChunked;
    if (!chunked) throw new Error("native.optimizeDependenciesChunked is not available");
    didWork = true;
    const result = chunked(entries.map((e) => ({ entryPath: e.entryPath, depsHash })), ionifyDir);
    const groupId = result?.chunk_group ?? result?.chunkGroup ?? chunkGroupId;
    const sharedFileName2 = `shared.${groupId}.js`;
    const sharedOut = path24.join(depsRoot, sharedFileName2);
    const ok = fs21.existsSync(sharedOut) && entries.every((e) => fs21.existsSync(path24.join(depsRoot, e.fileName)));
    if (!ok) throw new Error("Auto core pack optimizer did not produce expected outputs");
    writeJsonFile2(statePath, {
      version: 1,
      depsHash,
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      nodeEnv: currentNodeEnv,
      group: "core",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      status: "ready",
      chunkGroupId: groupId,
      sharedFileName: sharedFileName2,
      entries
    });
    vendorPackV2.ensurePackModuleFromEntries({
      label: "feature/core",
      packFileName: `vendor-pack.feature.core.${groupId}.js`,
      sharedFileName: sharedFileName2,
      entries,
      prunePackPrefix: "vendor-pack.feature.core."
    });
  } catch (err) {
    writeJsonFile2(statePath, {
      version: 1,
      depsHash,
      outputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      nodeEnv: currentNodeEnv,
      group: "core",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      status: "failed",
      chunkGroupId,
      sharedFileName,
      entries,
      error: String(err)
    });
    logWarn(`[deps] WARN: Auto core production pack build failed: ${String(err)}`);
  }
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
    if (!fs21.existsSync(usage.entryPath)) continue;
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
      if (!entry.entryPath || !fs21.existsSync(entry.entryPath)) continue;
      const sizeBytes = depsManifestIndex.get(entry.fileName)?.sizeBytes ?? 0;
      if (totalBytes + sizeBytes > vendorPackMaxBytes) continue;
      seen.add(entry.fileName);
      totalBytes += sizeBytes;
      selected.push(entry);
    }
    return selected;
  };
  const manualPackStatePathFor = (group) => path24.join(depsRoot, `vendor-pack.manual.${group}.json`);
  const manualPackSlimStatePathFor = (group) => path24.join(depsRoot, `vendor-pack.manual.${group}.slim.json`);
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
    ) && existing.sharedFileName === plannedSharedFileName && fs21.existsSync(path24.join(depsRoot, plannedSharedFileName));
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
        const sharedOut = path24.join(depsRoot, sharedFileName);
        const ok = fs21.existsSync(sharedOut) && resolvedEntries2.every((entry) => fs21.existsSync(path24.join(depsRoot, entry.fileName)));
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
          const sharedPath = path24.join(depsRoot, existingSlim.sharedFileName);
          const byBase = new Map(existingSlim.entries.map((e) => [e.baseFileName, e]));
          const baseSet = new Set(baseEntries.map((e) => e.fileName));
          const inputsMatch = fs21.existsSync(sharedPath) && existingSlim.entries.every((e) => baseSet.has(e.baseFileName)) && baseEntries.every((base) => {
            const entry = byBase.get(base.fileName);
            if (!entry) return false;
            if (entry.entryPath !== base.entryPath) return false;
            if (!fs21.existsSync(path24.join(depsRoot, entry.wrapperFileName))) return false;
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
          const sharedOut = path24.join(depsRoot, sharedFileName);
          if (!fs21.existsSync(sharedOut)) throw new Error("Slim shared chunk not found on disk");
          const resultsArr = Array.isArray(result?.entries) ? result.entries : [];
          const outByEntryPath = /* @__PURE__ */ new Map();
          for (const item of resultsArr) {
            const entryPath = item?.entry_path ?? item?.entryPath ?? null;
            const outPath = item?.out_path ?? item?.outPath ?? null;
            if (typeof entryPath !== "string" || typeof outPath !== "string") continue;
            const canonicalEntryPath = (() => {
              try {
                return fs21.realpathSync(entryPath);
              } catch {
                return entryPath;
              }
            })();
            outByEntryPath.set(canonicalEntryPath, path24.basename(outPath));
          }
          const slimMembers = [];
          const slimEntries = [];
          for (const base of baseEntries) {
            const canonicalBaseEntryPath = (() => {
              try {
                return fs21.realpathSync(base.entryPath);
              } catch {
                return base.entryPath;
              }
            })();
            const wrapperFileName = outByEntryPath.get(canonicalBaseEntryPath) ?? base.fileName;
            if (!fs21.existsSync(path24.join(depsRoot, wrapperFileName))) {
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
    const projectRootOverride = config?.root ? path24.resolve(config.root) : null;
    const workspace = resolveWorkspace(projectRootOverride ?? process.cwd(), {
      projectRootOverride
    });
    const rootDir = workspace.projectRoot;
    const ionifyDir = workspace.ionifyDir;
    const publicDirAbs = resolvePublicDir(rootDir, config?.publicDir);
    fs21.mkdirSync(ionifyDir, { recursive: true });
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
    logBuildProfile("setupConfigIdentity", setupStart);
    const depsPhaseStart = Date.now();
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
    const depsRoot = path24.join(ionifyDir, "deps", depsHash);
    process.env.IONIFY_DEPS_ROOT = depsRoot;
    fs21.mkdirSync(depsRoot, { recursive: true });
    const buildExternalSpecifiers = collectConfiguredExternalSpecifiers(config);
    const productionPublicationIdentity = {
      mode: buildMode,
      nodeEnv: "production",
      configHash,
      depsHash,
      depsOptimizerOutputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION,
      entries: entries ?? [],
      entrySource: resolvedBuildEntries.source
    };
    const earlyOutDir = options.outDir || "dist";
    const earlyAbsOutDir = path24.resolve(earlyOutDir);
    const earlyPlanStart = Date.now();
    const earlyPublishedPlan = readProductionPublicationPlan(ionifyDir, productionPublicationIdentity);
    const earlyProductionReadinessRecord = earlyPublishedPlan ? readProductionReadinessRecord(ionifyDir) : null;
    if (earlyPublishedPlan) {
      logBuildProfile("publishedProductionPlanRead", earlyPlanStart);
      const sourceFreshnessPreflightStart2 = Date.now();
      const sourceFreshnessCurrent2 = isProductionSourceFreshnessCurrent(
        earlyPublishedPlan,
        ionifyDir,
        workspace.workspaceRoot
      );
      logBuildProfile("praSourceFreshnessPreflight", sourceFreshnessPreflightStart2);
      const verifiedPraForDeployReadyOutput = sourceFreshnessCurrent2 && isVerifiedProductionReadinessForPlan(earlyProductionReadinessRecord, {
        configHash,
        workspaceRoot: workspace.workspaceRoot,
        projectRoot: rootDir,
        depsHash,
        plan: earlyPublishedPlan,
        depsOptimizerOutputVersion: DEPS_OPTIMIZER_OUTPUT_VERSION
      });
      const materializedReadiness = verifiedPraForDeployReadyOutput && earlyProductionReadinessRecord ? tryVerifyProductionReadinessMaterializedOutputs(earlyAbsOutDir, earlyProductionReadinessRecord) : null;
      if (materializedReadiness) {
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
        logBuildProfileDuration("pdcClosure", 0);
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
        logInfo(`Build plan generated \u2192 ${path24.join(earlyAbsOutDir, "manifest.json")}`);
        logInfo(`Entries: ${earlyPublishedPlan.entries.length}, Chunks: ${earlyPublishedPlan.chunks.length}`);
        logInfo(`Modules in plan: ${totalPlannedModules2}`);
        logInfo(`CAS hits: PRA verified \u2022 transforms needed: 0`);
        logInfo(`Build complete in ${coreBuildElapsed2}ms`);
        logInfo(`[Build] Time-to-deploy-ready: ${coreBuildElapsed2}ms`);
        logBuildProfileDuration("timeToDeployReady", coreBuildElapsed2);
        const compression2 = await runPostBuildCompression({
          config,
          absOutDir: earlyAbsOutDir,
          casRoot: path24.join(ionifyDir, "cas"),
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
            pdcClosureHash: earlyProductionReadinessRecord.identity.pdcClosureHash,
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
    if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "production") {
      process.env.IONIFY_NODE_ENV = process.env.NODE_ENV;
    }
    if (native?.initAstCache) {
      const versionHash = JSON.stringify(rawVersionInputs);
      native.initAstCache(versionHash);
      logInfo(`AST cache initialized with version hash`);
    }
    const vendorPacksRaw = config?.optimizeDeps?.vendorPacks ?? false;
    const vendorPacksManualConfigured = vendorPacksRaw && typeof vendorPacksRaw === "object" && !Array.isArray(vendorPacksRaw) && Object.keys(vendorPacksRaw).length > 0;
    const vendorPacksAutoConfigured = vendorPacksRaw === "auto";
    if (vendorPacksAutoConfigured) {
      const packsStart = Date.now();
      const vendorExclude = resolveAutoVendorEntryFsPaths(rootDir, config);
      if (vendorExclude !== null && vendorExclude.size > 1 && native?.optimizeDepsParallelSplit) {
        const sentinelPath = path24.join(depsRoot, ".verified");
        if (fs21.existsSync(sentinelPath)) {
          logInfo(`[deps] Skipping optimization (depsHash=${depsHash} already verified)`);
        } else if (restoreDepArtifactsFromGlobalCache(depsHash, depsRoot, DEPS_OPTIMIZER_OUTPUT_VERSION)) {
          try {
            fs21.writeFileSync(sentinelPath, String(Date.now()));
          } catch {
          }
          logInfo(`[deps] Restored from global cache (depsHash=${depsHash})`);
        } else {
          if (native?.depsPromoteArtifacts) {
            const prevRoot = findPreviousDepsRoot(ionifyDir, depsRoot);
            if (prevRoot) {
              try {
                const r = native.depsPromoteArtifacts(prevRoot, depsRoot, depsHash, DEPS_OPTIMIZER_OUTPUT_VERSION);
                if (r.promoted > 0) logInfo(`[deps] Promoted ${r.promoted} artifacts from previous deps dir (${r.skipped} need re-optimization)`);
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
            fs21.mkdirSync(depsRoot, { recursive: true });
            const batchEntries = Array.from(batchEntryPaths).map((entryPath) => ({ entryPath, depsHash }));
            const chunkedEntries = Array.from(vendorExclude).map((entryPath) => ({ entryPath, depsHash }));
            let splitHadErrors = false;
            try {
              const splitResult = native.optimizeDepsParallelSplit(batchEntries, chunkedEntries, ionifyDir);
              for (const err of splitResult.errors ?? []) {
                logWarn(`[deps] WARN (parallel split): ${err}`);
                splitHadErrors = true;
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
                excludeEntryPaths: vendorExclude
              });
            }
            if (!splitHadErrors) {
              try {
                fs21.writeFileSync(sentinelPath, String(Date.now()));
              } catch {
              }
              writeDepArtifactsToGlobalCache(depsHash, depsRoot);
            }
          } else {
            try {
              fs21.writeFileSync(sentinelPath, String(Date.now()));
            } catch {
            }
            writeDepArtifactsToGlobalCache(depsHash, depsRoot);
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
    const depsManifestIndex = loadDepsManifestIndex(depsRoot);
    const depStops = loadDepStopsFromManifest(depsRoot);
    logBuildProfile("depsAuthorityAndPacks", depsPhaseStart);
    if (options.depsOnly) {
      logInfo(
        `[deps] optimize-all: snapshot ready at .ionify/deps/${depsHash}/ (skipping bundler, no dist/ output).`
      );
      void depsManifestIndex;
      void depStops;
      return;
    }
    const federationExposeEntries = collectFederationExposeEntryPaths(config, rootDir);
    const buildEntries = Array.from(
      /* @__PURE__ */ new Set([...entries ?? [], ...federationExposeEntries])
    );
    logInfo("Building...");
    const planStart = Date.now();
    const publishedPlan = readProductionPublicationPlan(ionifyDir, productionPublicationIdentity);
    const plan = publishedPlan ? publishedPlan : await generateBuildPlan(
      buildEntries.length > 0 ? buildEntries : void 0,
      rawVersionInputs,
      depStops,
      buildExternalSpecifiers
    );
    logBuildProfile("generateBuildPlan", planStart);
    if (publishedPlan) {
      logInfo(`[Build] Using published Production Plan (${plan.chunks.length} chunk(s), identity verified)`);
    }
    const totalPlannedModules = plan.chunks.reduce((acc, chunk) => acc + chunk.modules.length, 0);
    logInfo(
      `[Build] Plan ready: entries=${plan.entries.length}, chunks=${plan.chunks.length}, modules=${totalPlannedModules}`
    );
    const productionReadinessRecord = readProductionReadinessRecord(ionifyDir);
    const sourceFreshnessPreflightStart = Date.now();
    const sourceFreshnessCurrent = isProductionSourceFreshnessCurrent(plan, ionifyDir, workspace.workspaceRoot);
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
    const federationGraph = new Graph(rawVersionInputs, { ionifyDir });
    const federationRemoteBindings = collectFederationRemoteImportBindings(config, rootDir);
    if (config?.federation) {
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
          if (fsPath && path24.isAbsolute(fsPath) && fs21.existsSync(fsPath)) {
            try {
              const code = fs21.readFileSync(fsPath, "utf8");
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
          if (fsPath && path24.isAbsolute(fsPath)) {
            federationGraph.recordFile(fsPath, mod.hash ?? existingNode?.hash ?? getCacheKey(mod.id), deps, dynamicDeps, mod.kind);
          } else {
            federationGraph.recordNodeById(mod.id, mod.hash ?? null, deps, dynamicDeps, mod.kind);
          }
        }
      }
    }
    let canonicalDepsForReadiness = null;
    let readinessPlanForIdentity = null;
    if (!verifiedPraForPublishedPlan) {
      const casRoot2 = path24.join(ionifyDir, "cas");
      const canonicalDeps = await prepareCanonicalProductionDependencyPlan({
        plan,
        rootDir,
        depsRoot,
        depsHash,
        resolvedEntries: entries,
        allowedRoots: workspace.allowedRoots,
        casRoot: casRoot2,
        configHash,
        workspaceRoot: workspace.workspaceRoot
      });
      canonicalDepsForReadiness = canonicalDeps;
      if (canonicalDeps.rerouted > 0 || canonicalDeps.pruned > 0) {
        logInfo(
          `[Build] Deps artifact rerouting: ${canonicalDeps.rerouted} entries rerouted (${canonicalDeps.idRewritten} ids \u2192 artifact identity), ${canonicalDeps.pruned} internal modules pruned${canonicalDeps.sharedPrewarmed > 0 ? `, ${canonicalDeps.sharedPrewarmed} shared artifacts pre-warmed` : ""}`
        );
      }
      if (canonicalDeps.productionClosure) {
        logInfo(
          `[PDC] Production closure ready: ${canonicalDeps.finite} finite, ${canonicalDeps.fallback} conservative fallback (${canonicalDeps.pdcMs}ms, metadata=${canonicalDeps.metadataAttached})`
        );
      }
      logBuildProfileDuration("depsReroute", canonicalDeps.rerouteMs);
      logBuildProfileDuration("pdcClosure", canonicalDeps.pdcMs);
      logBuildProfileDuration("canonicalDependencyPlan", canonicalDeps.rerouteMs + canonicalDeps.pdcMs);
    } else {
      logBuildProfileDuration("depsReroute", 0);
      logBuildProfileDuration("pdcClosure", 0);
      logBuildProfileDuration("canonicalDependencyPlan", 0);
    }
    const outDir = options.outDir || "dist";
    const absOutDir = path24.resolve(outDir);
    const defineSignature = computeDefineSignature(defineConfig);
    const defineHash = defineSignature ? getCacheKey(defineSignature) : "";
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
        if (!fsPath && typeof mod.id === "string" && path24.isAbsolute(mod.id)) {
          fsPath = mod.id;
        }
        if (!fsPath || !path24.isAbsolute(fsPath)) continue;
        mod.fsPath = fsPath;
        const existing = moduleMetaById.get(mod.id);
        if (!existing) {
          moduleMetaById.set(mod.id, {
            fsPath,
            kind: mod.kind,
            hash: typeof mod.hash === "string" && mod.hash.length > 0 ? mod.hash : null
          });
        }
        const bucket = moduleRefsById.get(mod.id);
        if (bucket) bucket.push(mod);
        else moduleRefsById.set(mod.id, [mod]);
      }
    }
    logBuildProfile("moduleIndex", moduleIndexStart);
    const moduleOutputs = /* @__PURE__ */ new Map();
    const modulesInPlan = moduleMetaById.size;
    const casRoot = path24.join(ionifyDir, "cas");
    let casHits = 0;
    {
      const freshnessStart = Date.now();
      const freshnessCacheFile = path24.join(ionifyDir, "source-freshness.v1.json");
      let freshnessCache = {};
      try {
        const parsed = JSON.parse(fs21.readFileSync(freshnessCacheFile, "utf8"));
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
          const st = fs21.statSync(fp);
          const cacheKey = `${id}
${fp}`;
          const cached = freshnessCache[cacheKey];
          const diskHash = cached && cached.fsPath === fp && cached.dev === st.dev && cached.ino === st.ino && cached.mtimeMs === st.mtimeMs && cached.ctimeMs === st.ctimeMs && cached.size === st.size && typeof cached.hash === "string" && cached.hash.length > 0 ? cached.hash : getCacheKey(fs21.readFileSync(fp));
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
        fs21.mkdirSync(ionifyDir, { recursive: true });
        const tmpFreshness = `${freshnessCacheFile}.${process.pid}.${Date.now()}.tmp`;
        fs21.writeFileSync(tmpFreshness, `${JSON.stringify(nextFreshnessCache)}
`, "utf8");
        fs21.renameSync(tmpFreshness, freshnessCacheFile);
      } catch {
      }
      logBuildProfile("freshnessScan", freshnessStart);
    }
    readinessPlanForIdentity = JSON.parse(JSON.stringify(plan));
    const praOutputProbeStart = Date.now();
    const verifiedPraOutputReuse = verifiedPraForPublishedPlan && productionReadinessRecord ? tryVerifyProductionReadinessOutputReuse(absOutDir, plan, productionReadinessRecord) : null;
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
      logInfo(`Build plan generated \u2192 ${path24.join(absOutDir, "manifest.json")}`);
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
          pdcClosureHash: productionReadinessRecord.identity.pdcClosureHash,
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
    const getArtifactHash = (baseHash, kind) => {
      if (kind !== "js") return baseHash;
      if (!defineHash) return baseHash;
      return getCacheKey(`${baseHash}|define:${defineHash}`);
    };
    const jsCasFileById = /* @__PURE__ */ new Map();
    for (const [id, meta] of moduleMetaById.entries()) {
      if (meta.kind !== "css" && meta.hash) {
        const ah = getArtifactHash(meta.hash, meta.kind);
        jsCasFileById.set(id, path24.join(getCasArtifactPath(casRoot, configHash, ah), "transformed.js"));
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
      const refs = moduleRefsById.get(id) ?? [];
      const baseHashFromPlan = meta.hash;
      const cssNeedsJsWrapper = meta.kind === "css" && isCssModuleFile(meta.fsPath);
      let artifactHashFromPlan = baseHashFromPlan ? getArtifactHash(baseHashFromPlan, meta.kind) : null;
      if (meta.kind === "css" && baseHashFromPlan) {
        const baseDir = getCasArtifactPath(casRoot, configHash, baseHashFromPlan);
        const cssMeta = readJsonFile2(path24.join(baseDir, "meta.json"));
        if (cssMeta && cssMeta.version === 1 && cssMeta.baseHash === baseHashFromPlan && typeof cssMeta.pipelineHash === "string" && cssMeta.pipelineHash.length > 0) {
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
            `css:v3:${id}:${baseHashFromPlan}:${cssMeta.pipelineHash}:${depsStampHash}:${cssNeedsJsWrapper ? 1 : 0}`
          );
        }
      }
      if (artifactHashFromPlan) {
        for (const ref of refs) ref.hash = artifactHashFromPlan;
      }
      const casDir = artifactHashFromPlan ? getCasArtifactPath(casRoot, configHash, artifactHashFromPlan) : null;
      const casCssFile = casDir ? path24.join(casDir, "transformed.css") : null;
      const casJsFile = casDir ? path24.join(casDir, "transformed.js") : null;
      if (meta.kind === "css") {
        if (casCssFile && fs21.existsSync(casCssFile)) {
          try {
            const css = fs21.readFileSync(casCssFile, "utf8");
            moduleOutputs.set(id, { code: css, type: "css" });
            casHits += 1;
            if (cssNeedsJsWrapper && casJsFile && !fs21.existsSync(casJsFile)) {
              const tokensFile = path24.join(casDir, "tokens.json");
              const storedTokens = readJsonFile2(tokensFile);
              if (storedTokens) {
                try {
                  fs21.mkdirSync(casDir, { recursive: true });
                  fs21.writeFileSync(casJsFile, renderCssTokensModule(storedTokens), "utf8");
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
            const baseCssArtifact = path24.join(baseCasDir, "transformed.css");
            if (fs21.existsSync(baseCssArtifact)) {
              try {
                const css = fs21.readFileSync(baseCssArtifact, "utf8");
                fs21.mkdirSync(casDir, { recursive: true });
                fs21.writeFileSync(casCssFile, css, "utf8");
                moduleOutputs.set(id, { code: css, type: "css" });
                casHits += 1;
                if (cssNeedsJsWrapper && casJsFile) {
                  const baseTokFile = path24.join(baseCasDir, "tokens.json");
                  const storedTokens = readJsonFile2(baseTokFile);
                  if (storedTokens) {
                    fs21.writeFileSync(casJsFile, renderCssTokensModule(storedTokens), "utf8");
                    try {
                      fs21.writeFileSync(path24.join(casDir, "tokens.json"), JSON.stringify(storedTokens), "utf8");
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
        const casFileName = "transformed.js";
        const casFile = casDir ? path24.join(casDir, casFileName) : null;
        if (casFile && (casExistsMap.get(casFile) ?? fs21.existsSync(casFile))) {
          casHits += 1;
          continue;
        }
      }
      if (meta.kind === "js" && baseHashFromPlan) {
        const baseDir = getCasArtifactPath(casRoot, configHash, baseHashFromPlan);
        const baseFile = path24.join(baseDir, "transformed.js");
        if (fs21.existsSync(baseFile)) {
          try {
            const baseCode = fs21.readFileSync(baseFile, "utf8");
            const artifactHash2 = getArtifactHash(baseHashFromPlan, "js");
            for (const ref of refs) ref.hash = artifactHash2;
            defineJobs.push({ id, artifactHash: artifactHash2, baseCode });
            casHits += 1;
            continue;
          } catch {
          }
        }
      }
      const filePath = meta.fsPath;
      if (!fs21.existsSync(filePath)) {
        throw new Error(`Module missing on disk: ${filePath}`);
      }
      const code = fs21.readFileSync(filePath, "utf8");
      const baseHash = baseHashFromPlan ?? getCacheKey(code);
      const artifactHash = meta.kind === "css" ? artifactHashFromPlan ?? baseHash : getArtifactHash(baseHash, meta.kind);
      if (meta.kind !== "css") {
        for (const ref of refs) ref.hash = artifactHash;
      }
      if (meta.kind === "js" && defineHash) {
        const baseDir = getCasArtifactPath(casRoot, configHash, baseHash);
        const baseFile = path24.join(baseDir, "transformed.js");
        if (fs21.existsSync(baseFile)) {
          try {
            const baseCode = fs21.readFileSync(baseFile, "utf8");
            defineJobs.push({ id, artifactHash, baseCode });
            casHits += 1;
            continue;
          } catch {
          }
        }
      }
      jobs.push({
        id,
        filePath,
        ext: path24.extname(filePath),
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
    const defineStart = Date.now();
    for (const job of defineJobs) {
      const cacheDir = getCasArtifactPath(casRoot, configHash, job.artifactHash);
      try {
        fs21.mkdirSync(cacheDir, { recursive: true });
        const finalCode = applyDefineReplacements(job.baseCode, defineConfig);
        fs21.writeFileSync(path24.join(cacheDir, "transformed.js"), finalCode, "utf8");
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
          nativeHandledIds.clear();
          logWarn(
            `[Build] Native transform batch unavailable; falling back to worker transforms (${err instanceof Error ? err.message : String(err)})`
          );
        }
      }
      const workerJobs = jobs.filter((job) => job.kind !== "js" || !nativeHandledIds.has(job.id));
      if (workerJobs.length > 0) {
        const pool = new TransformWorkerPool();
        try {
          const results = await pool.runMany(
            workerJobs.map((job) => ({
              id: job.id,
              filePath: job.filePath,
              ext: job.ext,
              code: job.code
            }))
          );
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
          const baseDir = getCasArtifactPath(casRoot, configHash, job.baseHash);
          const artifactDir = getCasArtifactPath(casRoot, configHash, job.artifactHash);
          fs21.mkdirSync(baseDir, { recursive: true });
          fs21.writeFileSync(path24.join(baseDir, "transformed.js"), result.code, "utf8");
          if (result.map) {
            fs21.writeFileSync(path24.join(baseDir, "transformed.js.map"), result.map, "utf8");
          }
          fs21.mkdirSync(artifactDir, { recursive: true });
          const finalCode2 = applyDefineReplacements(result.code, defineConfig);
          fs21.writeFileSync(path24.join(artifactDir, "transformed.js"), finalCode2, "utf8");
          if (result.map && finalCode2 === result.code) {
            fs21.writeFileSync(path24.join(artifactDir, "transformed.js.map"), result.map, "utf8");
          }
        } else {
          const deps = Array.isArray(result.deps) ? result.deps.filter((p) => typeof p === "string" && p.length > 0) : [];
          const urlDeps = Array.isArray(result.urlDeps) ? result.urlDeps.filter((p) => typeof p === "string" && p.length > 0) : [];
          const pipelineHash = typeof result.pipelineHash === "string" && result.pipelineHash.length > 0 ? result.pipelineHash : "0";
          const depsAbs = Array.from(new Set([...deps, ...urlDeps].map((p) => path24.resolve(p))));
          recordStructuralGraphFiles(depsAbs, workspace.workspaceRoot, configHash);
          const depsStampHash = computeDepsContentStampHash(
            depsAbs,
            moduleMetaById,
            workspace.workspaceRoot
          );
          const cssNeedsJsWrapper = job.cssNeedsJsWrapper === true;
          const artifactHash = getCacheKey(
            `css:v3:${job.id}:${job.baseHash}:${pipelineHash}:${depsStampHash}:${cssNeedsJsWrapper ? 1 : 0}`
          );
          cssDerivedArtifactHashById.set(job.id, artifactHash);
          const baseDir = getCasArtifactPath(casRoot, configHash, job.baseHash);
          fs21.mkdirSync(baseDir, { recursive: true });
          const meta = {
            version: 1,
            baseHash: job.baseHash,
            pipelineHash,
            deps: depsAbs.sort(),
            urlDeps: Array.from(new Set(urlDeps.map((p) => path24.resolve(p)))).sort(),
            modules: cssNeedsJsWrapper,
            generatedAt: (/* @__PURE__ */ new Date()).toISOString()
          };
          writeJsonFile2(path24.join(baseDir, "meta.json"), meta);
          const artifactDir = getCasArtifactPath(casRoot, configHash, artifactHash);
          fs21.mkdirSync(artifactDir, { recursive: true });
          fs21.writeFileSync(path24.join(artifactDir, "transformed.css"), result.code, "utf8");
          if (cssNeedsJsWrapper) {
            const tokens = result.tokens && typeof result.tokens === "object" ? result.tokens : {};
            const js = renderCssTokensModule(tokens);
            fs21.writeFileSync(path24.join(artifactDir, "transformed.js"), js, "utf8");
            writeJsonFile2(path24.join(artifactDir, "tokens.json"), tokens);
          }
          const refs = moduleRefsById.get(job.id) ?? [];
          for (const ref of refs) ref.hash = artifactHash;
          job.artifactHash = artifactHash;
        }
        const finalCode = isJs ? applyDefineReplacements(result.code, defineConfig) : result.code;
        moduleOutputs.set(job.id, { code: finalCode, type: result.type });
      }
      logBuildProfile("transformsAndCasWrites", transformStart);
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
    const buildMinifyRaw = config?.build?.minify;
    const buildMinifyEnabled = buildMinifyRaw === false ? false : true;
    const minifyEnabled = optLevel !== null ? optLevel !== 0 : buildMinifyEnabled;
    const mangleEnabled = minifyEnabled;
    const nativeExternalModules = collectNativeExternalModules(plan, buildExternalSpecifiers);
    const federationExposeEntryIds = collectFederationExposeEntryPaths(config, rootDir).map((entry) => toWsModuleId(entry, workspace.workspaceRoot)).filter((entryId) => typeof entryId === "string" && entryId.length > 0);
    const hostEntryIds = (entries ?? []).map((entry) => toWsModuleId(entry, workspace.workspaceRoot)).filter((entryId) => typeof entryId === "string" && entryId.length > 0);
    const emitStart = Date.now();
    const distReuseProbeStart = Date.now();
    const reusedOutputs = transformsNeeded === 0 && defineJobs.length === 0 && !config?.federation ? tryReusePreviousBuildOutputs(absOutDir, plan) : null;
    logBuildProfile("distReuseProbe", distReuseProbeStart);
    let emittedPlan = plan;
    let artifacts;
    let combinedStats;
    if (reusedOutputs) {
      artifacts = reusedOutputs.artifacts;
      combinedStats = { ...reusedOutputs.stats };
      logInfo(`[Build] Reused previous dist outputs (${artifacts.length} chunk(s), manifest+stats verified)`);
      logBuildProfile("emitChunksAndFiles", emitStart);
    } else {
      logInfo(`[Build] Emitting chunks via native bundler`);
      const { artifacts: baseArtifacts, stats: baseStats } = await emitChunks(absOutDir, plan, moduleOutputs, {
        casRoot,
        versionHash: configHash,
        nativeOptions: {
          minifier,
          minify: minifyEnabled,
          mangle: mangleEnabled,
          treeshake,
          scopeHoist,
          externalModules: nativeExternalModules,
          federationExposeEntries: federationExposeEntryIds
        }
      });
      artifacts = baseArtifacts;
      combinedStats = { ...baseStats };
      logBuildProfile("emitChunksAndFiles", emitStart);
    }
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
    if (config?.federation) {
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
    const buildManifestInfo = await writeBuildManifest(absOutDir, emittedPlan, artifacts, {
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
    const previousPublicAssets = Array.isArray(combinedStats.publicAssets) ? combinedStats.publicAssets.filter(
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
    await writeTextFileIfChanged2(path24.join(absOutDir, "build.stats.json"), statsJson);
    const buildStatsHash = getCacheKey(statsJson);
    outputHashHints.set("build.stats.json", buildStatsHash);
    logBuildProfile("writeBuildStats", statsWriteStart);
    logBuildProfile("manifestAssetsStats", manifestStart);
    const coreBuildElapsed = Date.now() - buildStart;
    logInfo(`Build plan generated \u2192 ${path24.join(absOutDir, "manifest.json")}`);
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
        pdcClosureHash: canonicalDepsForReadiness?.productionClosure?.closureHash ?? productionReadinessRecord?.identity.pdcClosureHash ?? null,
        artifacts,
        dist: {
          manifestHash: buildManifestInfo?.hash ?? hashFileIfExists(path24.join(absOutDir, "manifest.json")) ?? "",
          buildStatsHash,
          assetsManifestHash: assetsManifestInfo?.hash ?? hashFileIfExists(path24.join(absOutDir, "manifest.assets.json")),
          indexHtmlHash: indexHtmlInfo?.hash ?? hashFileIfExists(path24.join(absOutDir, "index.html"))
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
    compressionManifestHash = hashFileIfExists(path24.join(options.absOutDir, "manifest.compression.json"));
    compressionState = compressionManifestHash ? "verified" : "missing";
  }
  const elapsed = Date.now() - compressStart;
  const backendNote = native?.compressBatch ? " [js-chunks=rust]" : "";
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
  const pkgPath = path24.join(rootDir, "package.json");
  if (!fs21.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs21.readFileSync(pkgPath, "utf8"));
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
  return OPTIMIZABLE_DEP_ENTRY_EXTS.has(path24.extname(entryPath).toLowerCase());
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
  const sentinelPath = path24.join(depsRoot, ".verified");
  if (fs21.existsSync(sentinelPath)) {
    logInfo(`[deps] Skipping optimization (depsHash=${depsHash} already verified)`);
    return;
  }
  if (restoreDepArtifactsFromGlobalCache(depsHash, depsRoot, DEPS_OPTIMIZER_OUTPUT_VERSION)) {
    try {
      fs21.writeFileSync(sentinelPath, String(Date.now()));
    } catch {
    }
    logInfo(`[deps] Restored from global cache (depsHash=${depsHash})`);
    return;
  }
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
        if (result.promoted > 0) {
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
  if (entryPaths.size === 0) return;
  if (excludeEntryPaths && excludeEntryPaths.size > 0) {
    for (const p of excludeEntryPaths) entryPaths.delete(p);
  }
  if (entryPaths.size === 0) return;
  fs21.mkdirSync(depsRoot, { recursive: true });
  const entries = Array.from(entryPaths).map((entryPath) => ({ entryPath, depsHash }));
  const depsSharedChunksRaw = config?.optimizeDeps?.sharedChunks;
  const depsSharedChunksMode = depsSharedChunksRaw === void 0 || depsSharedChunksRaw === "auto" ? "auto" : depsSharedChunksRaw === true ? "1" : depsSharedChunksRaw === false ? "0" : String(depsSharedChunksRaw);
  const depsSharedChunksEnabled = depsSharedChunksMode !== "0";
  const vendorPacks = config?.optimizeDeps?.vendorPacks;
  const vendorPackV2Enabled = vendorPacks === "auto" || !!vendorPacks && typeof vendorPacks === "object" && !Array.isArray(vendorPacks);
  const avoidGlobalChunked = vendorPackV2Enabled;
  if (depsSharedChunksEnabled && !avoidGlobalChunked && native?.optimizeDependenciesChunked) {
    try {
      native.optimizeDependenciesChunked(entries, ionifyDir);
      try {
        fs21.writeFileSync(sentinelPath, String(Date.now()));
      } catch {
      }
      writeDepArtifactsToGlobalCache(depsHash, depsRoot);
      return;
    } catch {
    }
  }
  if (native?.optimizeDependenciesBatch) {
    try {
      native.optimizeDependenciesBatch(entries, ionifyDir);
      try {
        fs21.writeFileSync(sentinelPath, String(Date.now()));
      } catch {
      }
      writeDepArtifactsToGlobalCache(depsHash, depsRoot);
      return;
    } catch {
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
  try {
    fs21.writeFileSync(sentinelPath, String(Date.now()));
  } catch {
  }
  writeDepArtifactsToGlobalCache(depsHash, depsRoot);
}
function toPosixPath2(value) {
  return value.split(path24.sep).join("/");
}
var GLOBAL_DEP_CACHE_VERSION = "v1";
function getGlobalDepCacheDir(depsHash) {
  return path24.join(os2.homedir(), ".ionify", "global", "dep-artifacts", GLOBAL_DEP_CACHE_VERSION, depsHash);
}
function manifestEntryHasPdcC1Facts(entry, outputVersion) {
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
  return true;
}
function depsManifestSatisfiesPdcC1Contract(manifestPath, outputVersion) {
  try {
    const parsed = JSON.parse(fs21.readFileSync(manifestPath, "utf8"));
    const entries = parsed?.entries && typeof parsed.entries === "object" ? Object.values(parsed.entries) : [];
    if (!entries.length) return false;
    return entries.every((entry) => manifestEntryHasPdcC1Facts(entry, outputVersion));
  } catch {
    return false;
  }
}
function restoreDepArtifactsFromGlobalCache(depsHash, localDepsRoot, outputVersion) {
  const globalDir = getGlobalDepCacheDir(depsHash);
  const globalSentinel = path24.join(globalDir, ".verified");
  if (!fs21.existsSync(globalSentinel)) return false;
  if (!depsManifestSatisfiesPdcC1Contract(path24.join(globalDir, "manifest.json"), outputVersion)) {
    try {
      fs21.rmSync(globalDir, { recursive: true, force: true });
    } catch {
    }
    return false;
  }
  try {
    const entries = fs21.readdirSync(globalDir);
    for (const entry of entries) {
      const src = path24.join(globalDir, entry);
      const dst = path24.join(localDepsRoot, entry);
      if (fs21.existsSync(dst)) continue;
      try {
        fs21.linkSync(src, dst);
      } catch {
        fs21.copyFileSync(src, dst);
      }
    }
    return true;
  } catch {
    return false;
  }
}
function writeDepArtifactsToGlobalCache(depsHash, localDepsRoot) {
  try {
    const globalDir = getGlobalDepCacheDir(depsHash);
    fs21.mkdirSync(globalDir, { recursive: true });
    const entries = fs21.readdirSync(localDepsRoot);
    for (const entry of entries) {
      const src = path24.join(localDepsRoot, entry);
      const dst = path24.join(globalDir, entry);
      if (fs21.existsSync(dst)) continue;
      try {
        fs21.linkSync(src, dst);
      } catch {
        fs21.copyFileSync(src, dst);
      }
    }
  } catch {
  }
}
function findPreviousDepsRoot(ionifyDir, currentDepsRoot) {
  const depsDir = path24.join(ionifyDir, "deps");
  if (!fs21.existsSync(depsDir)) return null;
  try {
    const entries = fs21.readdirSync(depsDir, { withFileTypes: true });
    let best = null;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path24.join(depsDir, entry.name);
      if (dirPath === currentDepsRoot) continue;
      if (!fs21.existsSync(path24.join(dirPath, ".verified"))) continue;
      if (!fs21.existsSync(path24.join(dirPath, "manifest.json"))) continue;
      try {
        const mtime = fs21.statSync(path24.join(dirPath, ".verified")).mtimeMs;
        if (!best || mtime > best.mtime) best = { mtime, dirPath };
      } catch {
      }
    }
    return best?.dirPath ?? null;
  } catch {
    return null;
  }
}
function normalizePlanChunkForReuse(chunk) {
  return {
    id: chunk.id,
    entry: chunk.entry,
    shared: chunk.shared,
    consumers: [...chunk.consumers ?? []],
    modules: chunk.modules.map((mod) => ({
      id: mod.id,
      kind: mod.kind,
      deps: [...mod.deps ?? []],
      dynamicDeps: [...mod.dynamicDeps ?? []],
      dependencyFormat: mod.dependencyFormat ?? void 0,
      usedExports: mod.usedExports ?? void 0,
      dependencyAbiHash: mod.dependencyAbiHash ?? void 0,
      productionClosureHash: mod.productionClosureHash ?? void 0,
      sideEffects: mod.sideEffects ?? void 0,
      artifactHash: mod.hash ?? void 0
    }))
  };
}
function tryReusePreviousBuildOutputs(outDir, plan) {
  const manifestPath = path24.join(outDir, "manifest.json");
  const statsPath = path24.join(outDir, "build.stats.json");
  let manifestStat;
  let statsStat;
  let manifest;
  let stats;
  try {
    manifestStat = fs21.statSync(manifestPath);
    statsStat = fs21.statSync(statsPath);
    if (!manifestStat.isFile() || !statsStat.isFile()) return null;
    manifest = JSON.parse(fs21.readFileSync(manifestPath, "utf8"));
    stats = JSON.parse(fs21.readFileSync(statsPath, "utf8"));
  } catch {
    return null;
  }
  if (JSON.stringify(manifest?.entries ?? []) !== JSON.stringify(plan.entries)) return null;
  const previousChunks = Array.isArray(manifest?.chunks) ? manifest.chunks : [];
  if (previousChunks.length !== plan.chunks.length) return null;
  const currentById = new Map(plan.chunks.map((chunk) => [chunk.id, normalizePlanChunkForReuse(chunk)]));
  const artifacts = [];
  const allFiles = /* @__PURE__ */ new Set();
  for (const previous of previousChunks) {
    const current = currentById.get(previous?.id);
    if (!current) return null;
    const comparablePrevious = {
      id: previous.id,
      entry: previous.entry,
      shared: previous.shared,
      consumers: previous.consumers ?? [],
      modules: (previous.modules ?? []).map((mod) => ({
        id: mod.id,
        kind: mod.kind,
        deps: mod.deps ?? [],
        dynamicDeps: mod.dynamicDeps ?? [],
        dependencyFormat: mod.dependencyFormat ?? void 0,
        usedExports: mod.usedExports ?? void 0,
        dependencyAbiHash: mod.dependencyAbiHash ?? void 0,
        productionClosureHash: mod.productionClosureHash ?? void 0,
        sideEffects: mod.sideEffects ?? void 0,
        artifactHash: mod.artifactHash
      }))
    };
    if (JSON.stringify(comparablePrevious) !== JSON.stringify(current)) return null;
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
      const fileStat = fs21.statSync(path24.join(outDir, rel));
      if (!fileStat.isFile()) return null;
      if (fileStat.size !== meta.bytes) return null;
      if (fileStat.mtimeMs > statsStat.mtimeMs + 1) return null;
    } catch {
      return null;
    }
  }
  return { artifacts, stats };
}
function tryVerifyProductionReadinessOutputReuse(outDir, plan, record) {
  if (record.state !== "verified") return null;
  const distProof = record.proofs.dist;
  if (!distProof.manifestHash || !distProof.buildStatsHash) return null;
  if (record.proofs.publicAssets.conflicts.length > 0) return null;
  const manifestHash = hashFileIfExists(path24.join(outDir, "manifest.json"));
  if (manifestHash !== distProof.manifestHash) return null;
  const buildStatsHash = hashFileIfExists(path24.join(outDir, "build.stats.json"));
  if (buildStatsHash !== distProof.buildStatsHash) return null;
  if (distProof.assetsManifestHash) {
    const assetsManifestHash = hashFileIfExists(path24.join(outDir, "manifest.assets.json"));
    if (assetsManifestHash !== distProof.assetsManifestHash) return null;
  }
  if (distProof.indexHtmlHash) {
    const indexHtmlHash = hashFileIfExists(path24.join(outDir, "index.html"));
    if (indexHtmlHash !== distProof.indexHtmlHash) return null;
  }
  return tryReusePreviousBuildOutputs(outDir, plan);
}
function tryVerifyProductionReadinessMaterializedOutputs(outDir, record) {
  if (record.state !== "verified") return null;
  const distProof = record.proofs.dist;
  if (!distProof.manifestHash || !distProof.buildStatsHash) return null;
  if (record.proofs.publicAssets.conflicts.length > 0) return null;
  const manifestPath = path24.join(outDir, "manifest.json");
  const statsPath = path24.join(outDir, "build.stats.json");
  let manifestStat;
  let statsStat;
  let manifest;
  let stats;
  try {
    manifestStat = fs21.statSync(manifestPath);
    statsStat = fs21.statSync(statsPath);
    if (!manifestStat.isFile() || !statsStat.isFile()) return null;
    if (hashFileIfExists(manifestPath) !== distProof.manifestHash) return null;
    if (hashFileIfExists(statsPath) !== distProof.buildStatsHash) return null;
    manifest = JSON.parse(fs21.readFileSync(manifestPath, "utf8"));
    stats = JSON.parse(fs21.readFileSync(statsPath, "utf8"));
  } catch {
    return null;
  }
  if (distProof.assetsManifestHash) {
    const assetsManifestHash = hashFileIfExists(path24.join(outDir, "manifest.assets.json"));
    if (assetsManifestHash !== distProof.assetsManifestHash) return null;
  }
  if (distProof.indexHtmlHash) {
    const indexHtmlHash = hashFileIfExists(path24.join(outDir, "index.html"));
    if (indexHtmlHash !== distProof.indexHtmlHash) return null;
  }
  const artifacts = [];
  const allFiles = /* @__PURE__ */ new Set();
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
    if (typeof asset.file === "string" && asset.file.length > 0) allFiles.add(toPosixPath2(asset.file));
  }
  if (distProof.assetsManifestHash) allFiles.add("manifest.assets.json");
  if (distProof.indexHtmlHash) allFiles.add("index.html");
  for (const rel of allFiles) {
    const meta = stats?.[rel];
    let expectedBytes = null;
    if (meta && typeof meta === "object" && typeof meta.bytes === "number" && Number.isFinite(meta.bytes)) {
      expectedBytes = meta.bytes;
    } else {
      const publicAsset = record.proofs.publicAssets.assets.find((asset) => toPosixPath2(asset.file) === rel);
      if (publicAsset) expectedBytes = publicAsset.bytes;
    }
    try {
      const fileStat = fs21.statSync(path24.join(outDir, rel));
      if (!fileStat.isFile()) return null;
      if (expectedBytes !== null && fileStat.size !== expectedBytes) return null;
      if (fileStat.mtimeMs > statsStat.mtimeMs + 1) return null;
    } catch {
      return null;
    }
  }
  return { artifacts, stats };
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
      entries = await fs21.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (ent) => {
        const full = path24.join(dir, ent.name);
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
  if (path24.basename(lower) === "manifest.compression.json") return false;
  const ext = path24.extname(lower);
  return ext === ".js" || ext === ".mjs" || ext === ".cjs" || ext === ".css" || ext === ".html" || ext === ".json" || ext === ".svg" || ext === ".xml" || ext === ".txt" || ext === ".map";
}
function isJsChunkFile(relPosixPath) {
  return relPosixPath.startsWith("chunks/") && (relPosixPath.endsWith(".js") || relPosixPath.endsWith(".mjs"));
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
      stat = await fs21.promises.stat(absPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (stat.size < opts.thresholdBytes) continue;
    candidates.push({
      absPath,
      rel: toPosixPath2(path24.relative(outDir, absPath)),
      stat
    });
  }
  report.totals.filesEligible = candidates.length;
  const readUsableSidecar = async (sidecarPath, originalBytes) => {
    try {
      const stat = await fs21.promises.stat(sidecarPath);
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
        bodyPromise = fs21.promises.readFile(absPath).then((loaded) => {
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
      const sourceFile = path24.join(compressionCasDir, sidecarKind === "br" ? "sidecar.br" : "sidecar.gz");
      const cached = await readUsableSidecar(sourceFile, originalBytes);
      if (!cached) {
        casMisses += 1;
        return { restored: false, size: null };
      }
      try {
        await fs21.promises.mkdir(path24.dirname(sidecarPath), { recursive: true });
        await fs21.promises.copyFile(sourceFile, sidecarPath);
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
      const targetFile = path24.join(compressionCasDir, sidecarKind === "br" ? "sidecar.br" : "sidecar.gz");
      try {
        if (!data || data.length <= 0 || data.length >= originalBytes) {
          await fs21.promises.unlink(targetFile).catch(() => {
          });
          return;
        }
        await fs21.promises.mkdir(compressionCasDir, { recursive: true });
        await fs21.promises.writeFile(targetFile, data);
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
        brotliSidecar = toPosixPath2(path24.relative(outDir, brPath));
        brotliSource = "current";
      }
      if (skipGz && currentGz) {
        gzipBytes = currentGz.size;
        gzipSidecar = toPosixPath2(path24.relative(outDir, gzPath));
        gzipSource = "current";
      }
      if (skipBr && skipGz) filesAlreadyCurrent = 1;
      const [restoredBr, restoredGz] = await Promise.all([
        skipBr ? Promise.resolve({ restored: false, size: null }) : tryRestoreFromCompressionCas("br", brPath),
        skipGz ? Promise.resolve({ restored: false, size: null }) : tryRestoreFromCompressionCas("gz", gzPath)
      ]);
      if (restoredBr.restored) {
        brotliBytes = restoredBr.size;
        brotliSidecar = toPosixPath2(path24.relative(outDir, brPath));
        brotliSource = "cas";
      }
      if (restoredGz.restored) {
        gzipBytes = restoredGz.size;
        gzipSidecar = toPosixPath2(path24.relative(outDir, gzPath));
        gzipSource = "cas";
      }
      const needsBrCompression = !skipBr && brotliSource === null;
      const needsGzCompression = !skipGz && gzipSource === null;
      const loadedBody = needsBrCompression || needsGzCompression ? await ensureBody() : null;
      let br = null;
      let gz = null;
      if ((needsBrCompression || needsGzCompression) && loadedBody) {
        const useNative = !!opts.nativeCompressor && isJsChunkFile(rel);
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
          await fs21.promises.writeFile(brPath, br);
          filesTouched += 1;
          sidecarsCompressed += 1;
          brotliBytes = br.length;
          brotliSidecar = toPosixPath2(path24.relative(outDir, brPath));
          brotliSource = "compressed";
        } else {
          try {
            await fs21.promises.unlink(brPath);
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
          brotliSidecar = toPosixPath2(path24.relative(outDir, brPath));
        }
      }
      if (needsGzCompression && loadedBody) {
        if (gz && gz.length < loadedBody.length) {
          await fs21.promises.writeFile(gzPath, gz);
          filesTouched += 1;
          sidecarsCompressed += 1;
          gzipBytes = gz.length;
          gzipSidecar = toPosixPath2(path24.relative(outDir, gzPath));
          gzipSource = "compressed";
        } else {
          try {
            await fs21.promises.unlink(gzPath);
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
          gzipSidecar = toPosixPath2(path24.relative(outDir, gzPath));
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
      path24.join(outDir, "manifest.compression.json"),
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
  const { rootDir, outDir, entries, hostEntryIds, plan, artifacts, envValues, envPrefix } = options;
  const htmlInput = path24.join(rootDir, "index.html");
  if (!fs21.existsSync(htmlInput)) {
    return null;
  }
  const hostEntryIdSet = new Set(hostEntryIds);
  const entryChunks = plan.chunks.filter(
    (chunk) => chunk.entry && chunk.consumers.some((consumer) => hostEntryIdSet.has(consumer))
  );
  const entryScripts = entryChunks.map((chunk) => {
    const artifact = artifacts.find((a) => a.id === chunk.id);
    return pickPrimaryJs(artifact?.files?.js);
  }).filter((x) => typeof x === "string" && x.length > 0);
  const entryCss = entryChunks.flatMap((chunk) => {
    const artifact = artifacts.find((a) => a.id === chunk.id);
    return pickPrimaryEntryCss(artifact?.files?.css);
  }).filter((x) => typeof x === "string" && x.length > 0);
  if (!entryScripts.length) {
    return null;
  }
  const candidateSrcs = /* @__PURE__ */ new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== "string") continue;
    const rel = toPosixPath2(path24.relative(rootDir, entry));
    if (rel && rel !== ".") {
      candidateSrcs.add(`/${rel}`);
      candidateSrcs.add(rel);
    }
  }
  let html = await fs21.promises.readFile(htmlInput, "utf8");
  html = substituteEnvPlaceholders(html, envValues, envPrefix);
  if (entryCss.length) {
    const unique = [];
    const seen = /* @__PURE__ */ new Set();
    for (const href of entryCss) {
      if (seen.has(href)) continue;
      seen.add(href);
      const hrefRe = new RegExp(`href=["']${escapeRegExp2(href)}["']`, "i");
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
  }).filter((x) => typeof x === "string" && x.length > 0).sort((a, b) => a.localeCompare(b));
  if (sharedPreloads.length) {
    const unique = [];
    const seen = /* @__PURE__ */ new Set();
    for (const href of sharedPreloads) {
      if (seen.has(href)) continue;
      seen.add(href);
      const hrefRe = new RegExp(`href=["']${escapeRegExp2(href)}["']`, "i");
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
  await fs21.promises.mkdir(outDir, { recursive: true });
  const outputFile = path24.join(outDir, "index.html");
  await writeTextFileIfChanged2(outputFile, html);
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
  TransformWorkerPool,
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
  registerDepEntry,
  getDepEntry,
  isCoreSingletonDepFileName,
  computeSubpathFromEntryPath,
  REACT_REFRESH_RUNTIME_MODULE,
  REACT_REFRESH_HMR_CONTRACT_VERSION,
  hasReactRootRenderSideEffect,
  instrumentReactRefresh,
  loadEnv,
  loadIonifyConfig,
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
  computeDefineSignature,
  loadDepStopsFromManifest,
  createPartialProductionReadinessRecord,
  writeProductionReadinessRecord,
  writeProductionPublicationPlan,
  writeProductionPublicationState,
  createProductionPublicationState,
  summarizePlanForPublication,
  resolveProductionBuildEntries,
  createProductionGraphVersionInputs,
  collectNativeExternalModules,
  rerouteDepsArtifacts,
  attachProductionClosureMetadata,
  prepareCanonicalProductionDependencyPlan,
  prepareProductionDependencyClosure,
  runBuildCommand,
  precompressBuildOutputs
};
