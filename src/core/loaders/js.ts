/**
{
  "description": "JS/TS loader. Uses SWC for transpilation, injects React Refresh HMR hooks, and auto-accepts modules for hot updates. Parser mode (oxc/swc/hybrid) affects import extraction only.",
  "phase": 2,
  "todo": [
    "Transpile TS/TSX/JSX to vanilla JS via SWC",
    "Enable React Fast Refresh during development",
    "Fallback accept handler for non-React modules"
  ]
}
*/

import { transform as swcTransform, parseSync, printSync } from "@swc/core";
import { init, parse } from "es-module-lexer";
import type { Loader } from "@core/transform";
import { getCacheKey } from "@core/cache";
import { resolveImport } from "@core/resolver";
import { publicPathForFile, MODULE_REQUEST_PREFIX } from "@core/utils/public-path";
import { getCasArtifactPath } from "@core/utils/cas";
import { isCssLikeExt } from "@core/utils/css-ext";
import { isTypeDeclarationPath } from "@core/utils/declaration-file";
import { native, tryBundleNodeModule, tryNativeTransform } from "@native/index";
import {
  registerDepEntry,
  cacheDepRegistration,
  computeSubpathFromEntryPath,
  isCoreSingletonDepFileName,
  type DepEntry,
} from "@core/deps/registry";
import { instrumentReactRefresh } from "@core/refresh/reactRefreshInstrumentation";
import { isEntryModule } from "@core/refresh/entryDetection";
import { shouldUseReactRefresh } from "@core/refresh/refreshEligibility";
import fs from "fs";
import path from "path";

// Must include ESM/CJS variants from node_modules (e.g. Radix ships .mjs),
// otherwise bare imports like "react" won't be rewritten and the browser will throw.
const JS_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);

function resolveIonifyDir(rootDir: string): string {
  const fromEnv = process.env.IONIFY_STATE_DIR;
  if (fromEnv && path.isAbsolute(fromEnv)) return fromEnv;
  return path.join(rootDir, ".ionify");
}

function resolveDepsRoot(rootDir: string, depsHash: string): string {
  return path.join(resolveIonifyDir(rootDir), "deps", depsHash);
}

type FeaturePackIndex = {
  version: number;
  depsHash: string;
  fileNameToChunkGroupId?: Record<string, unknown>;
};

type VendorPackV2Index = {
  version: number;
  depsHash: string;
  packFileToSharedFile?: Record<string, unknown>;
  packFileToKey?: Record<string, unknown>;
  packFileToChunkFiles?: Record<string, unknown>;
  fileNameToPackFile?: Record<string, unknown>;
};

let featurePackIndexCache:
  | {
      depsRoot: string;
      depsHash: string;
      mtimeMs: number;
      mapping: Map<string, string>;
    }
  | null = null;

function getFeaturePackChunkGroupId(rootDir: string, fileName: string): string | null {
  const depsHash = process.env.IONIFY_DEPS_HASH;
  if (!depsHash) return null;
  const depsRoot = resolveDepsRoot(rootDir, depsHash);
  const indexPath = path.join(depsRoot, "vendor-pack.feature.index.json");
  if (!fs.existsSync(indexPath)) return null;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(indexPath);
  } catch {
    return null;
  }

  const mtimeMs = stat.mtimeMs;
  if (
    !featurePackIndexCache ||
    featurePackIndexCache.depsRoot !== depsRoot ||
    featurePackIndexCache.depsHash !== depsHash ||
    featurePackIndexCache.mtimeMs !== mtimeMs
  ) {
    try {
      const raw = fs.readFileSync(indexPath, "utf8");
      const parsed = JSON.parse(raw) as FeaturePackIndex;
      const mapping = new Map<string, string>();
      if (parsed?.version === 1 && parsed?.depsHash === depsHash) {
        const obj = parsed.fileNameToChunkGroupId;
        if (obj && typeof obj === "object") {
          for (const [k, v] of Object.entries(obj)) {
            if (typeof k !== "string" || typeof v !== "string") continue;
            mapping.set(k, v);
          }
        }
      }
      featurePackIndexCache = { depsRoot, depsHash, mtimeMs, mapping };
    } catch {
      featurePackIndexCache = { depsRoot, depsHash, mtimeMs, mapping: new Map() };
    }
  }

  const cg = featurePackIndexCache.mapping.get(fileName) ?? null;
  if (!cg) return null;
  // Guardrail: never rewrite to a pack that doesn't exist on disk (restart-safe).
  const sharedPath = path.join(depsRoot, `shared.${cg}.js`);
  if (!fs.existsSync(sharedPath)) return null;
  return cg;
}

let vendorPackV2IndexCache:
  | {
      depsRoot: string;
      depsHash: string;
      mtimeMs: number;
      fileNameToPackFile: Map<string, string>;
      packFileToSharedFile: Map<string, string>;
      packFileToKey: Map<string, string>;
      packFileToChunkFiles: Map<string, string[]>;
    }
  | null = null;

function vendorPackV2MemberKey(fileName: string): string {
  return getCacheKey(`vp2:${fileName}`).slice(0, 12);
}

let vendorPackV2PackValidationCache:
  | {
      depsRoot: string;
      depsHash: string;
      byPackFile: Map<string, { mtimeMs: number; size: number; ok: boolean; key: string | null }>;
    }
  | null = null;

function validateVendorPackV2Module(
  depsRoot: string,
  depsHash: string,
  packFileName: string,
  expectedKey: string | null,
  chunkFiles: string[],
): boolean {
  const packPath = path.join(depsRoot, packFileName);
  if (!fs.existsSync(packPath)) return false;
  for (const chunkFile of chunkFiles) {
    if (typeof chunkFile !== "string" || !chunkFile.endsWith(".js")) return false;
    if (!fs.existsSync(path.join(depsRoot, chunkFile))) return false;
  }

  if (
    !vendorPackV2PackValidationCache ||
    vendorPackV2PackValidationCache.depsRoot !== depsRoot ||
    vendorPackV2PackValidationCache.depsHash !== depsHash
  ) {
    vendorPackV2PackValidationCache = { depsRoot, depsHash, byPackFile: new Map() };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(packPath);
  } catch {
    return false;
  }

  const cached = vendorPackV2PackValidationCache.byPackFile.get(packFileName);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    if (!cached.ok) return false;
    if (expectedKey && cached.key !== expectedKey) return false;
    return true;
  }

  let ok = false;
  let actualKey: string | null = null;
  try {
    const head = fs.readFileSync(packPath, "utf8").slice(0, 256);
    const match = head.match(/\/\/\s*ionify:vendor-pack-v2\s+([0-9a-fA-F]{32,})/);
    actualKey = match?.[1] ? String(match[1]).toLowerCase() : null;
    ok = !!actualKey && (!expectedKey || actualKey === expectedKey);
  } catch {
    ok = false;
  }

  vendorPackV2PackValidationCache.byPackFile.set(packFileName, {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    ok,
    key: actualKey,
  });

  return ok;
}

function getVendorPackV2ImportFileName(rootDir: string, fileName: string): string | null {
  if (isCoreSingletonDepFileName(fileName)) return null;
  const depsHash = process.env.IONIFY_DEPS_HASH;
  if (!depsHash) return null;
  const depsRoot = resolveDepsRoot(rootDir, depsHash);
  const indexPath = path.join(depsRoot, "vendor-pack.v2.index.json");
  if (!fs.existsSync(indexPath)) return null;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(indexPath);
  } catch {
    return null;
  }

  const mtimeMs = stat.mtimeMs;
  if (
    !vendorPackV2IndexCache ||
    vendorPackV2IndexCache.depsRoot !== depsRoot ||
    vendorPackV2IndexCache.depsHash !== depsHash ||
    vendorPackV2IndexCache.mtimeMs !== mtimeMs
  ) {
    try {
      const raw = fs.readFileSync(indexPath, "utf8");
      const parsed = JSON.parse(raw) as VendorPackV2Index;
      const fileNameToPackFile = new Map<string, string>();
      const packFileToSharedFile = new Map<string, string>();
      const packFileToKey = new Map<string, string>();
      const packFileToChunkFiles = new Map<string, string[]>();
      if (parsed?.version === 1 && parsed?.depsHash === depsHash) {
        const sharedObj = parsed.packFileToSharedFile;
        if (sharedObj && typeof sharedObj === "object") {
          for (const [packFile, sharedFile] of Object.entries(sharedObj)) {
            if (typeof packFile !== "string" || typeof sharedFile !== "string") continue;
            if (!packFile.endsWith(".js") || !sharedFile.endsWith(".js")) continue;
            packFileToSharedFile.set(packFile, sharedFile);
          }
        }
        const keyObj = parsed.packFileToKey;
        if (keyObj && typeof keyObj === "object") {
          for (const [packFile, key] of Object.entries(keyObj)) {
            if (typeof packFile !== "string" || typeof key !== "string") continue;
            if (!packFile.endsWith(".js")) continue;
            const cleaned = key.trim().toLowerCase();
            if (!/^[0-9a-f]{32,}$/.test(cleaned)) continue;
            packFileToKey.set(packFile, cleaned);
          }
        }
        const chunkObj = parsed.packFileToChunkFiles;
        if (chunkObj && typeof chunkObj === "object") {
          for (const [packFile, chunkFiles] of Object.entries(chunkObj)) {
            if (typeof packFile !== "string" || !Array.isArray(chunkFiles)) continue;
            if (!packFile.endsWith(".js")) continue;
            const normalized = chunkFiles
              .map((v) => (typeof v === "string" ? v : ""))
              .filter(Boolean)
              .slice()
              .sort();
            const unique: string[] = [];
            for (const file of normalized) {
              if (!file.endsWith(".js")) continue;
              if (unique.length === 0 || unique[unique.length - 1] !== file) unique.push(file);
            }
            if (unique.length > 0) packFileToChunkFiles.set(packFile, unique);
          }
        }

        const obj = parsed.fileNameToPackFile;
        if (obj && typeof obj === "object") {
          for (const [k, v] of Object.entries(obj)) {
            if (typeof k !== "string" || typeof v !== "string") continue;
            if (!v.endsWith(".js")) continue;
            fileNameToPackFile.set(k, v);
          }
        }
      }
      vendorPackV2IndexCache = {
        depsRoot,
        depsHash,
        mtimeMs,
        fileNameToPackFile,
        packFileToSharedFile,
        packFileToKey,
        packFileToChunkFiles,
      };
      vendorPackV2PackValidationCache = null;
    } catch {
      vendorPackV2IndexCache = {
        depsRoot,
        depsHash,
        mtimeMs,
        fileNameToPackFile: new Map(),
        packFileToSharedFile: new Map(),
        packFileToKey: new Map(),
        packFileToChunkFiles: new Map(),
      };
      vendorPackV2PackValidationCache = null;
    }
  }

  const packFileName = vendorPackV2IndexCache.fileNameToPackFile.get(fileName) ?? null;
  if (!packFileName) return null;

  const expectedKey = vendorPackV2IndexCache.packFileToKey.get(packFileName) ?? null;
  const chunkFiles =
    vendorPackV2IndexCache.packFileToChunkFiles.get(packFileName) ??
    (() => {
      const shared = vendorPackV2IndexCache?.packFileToSharedFile.get(packFileName) ?? null;
      return shared ? [shared] : [];
    })();
  if (chunkFiles.length === 0) return null;

  if (!validateVendorPackV2Module(depsRoot, depsHash, packFileName, expectedKey, chunkFiles)) return null;
  return packFileName;
}

function extractDepsFileNameFromUrl(url: string): string | null {
  if (!url.startsWith("/@deps/")) return null;
  let rest = url.slice("/@deps/".length);
  const queryIndex = rest.indexOf("?");
  const hashIndex = rest.indexOf("#");
  const splitIndex =
    queryIndex === -1 ? hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
  if (splitIndex !== -1) {
    rest = rest.slice(0, splitIndex);
  }
  if (!rest.endsWith(".js")) return null;
  return rest;
}

function rewriteVendorPackV2Imports(code: string, rootDir: string): string {
  const depsHash = process.env.IONIFY_DEPS_HASH;
  if (!depsHash) return code;
  if (!code.includes("/@deps/")) return code;
  const depsRoot = resolveDepsRoot(rootDir, depsHash);
  const indexPath = path.join(depsRoot, "vendor-pack.v2.index.json");
  if (!fs.existsSync(indexPath)) return code;

  let ast: any;
  try {
    ast = parseSync(code, {
      syntax: "ecmascript",
      jsx: true,
      decorators: true,
      dynamicImport: true,
      importAssertions: true,
    } as any);
  } catch {
    return code;
  }

  let mutated = false;
  const body: any[] = Array.isArray(ast?.body) ? ast.body : [];
  for (const item of body) {
    if (!item || item.type !== "ImportDeclaration") continue;
    const sourceValue: string | undefined = item.source?.value;
    if (typeof sourceValue !== "string") continue;
    const depFileName = extractDepsFileNameFromUrl(sourceValue);
    if (!depFileName) continue;

    const importFileName = getVendorPackV2ImportFileName(rootDir, depFileName);
    if (!importFileName) continue;

    const memberKey = vendorPackV2MemberKey(depFileName);
    const prefix = `__ionify_vp_${memberKey}`;
    const newSourceValue = `/@deps/${importFileName}`;

    const makeImportedIdent = (value: string, template: any) => ({
      type: "Identifier",
      span: template?.span ?? { start: 0, end: 0 },
      ctxt: 0,
      value,
      optional: false,
    });

    const specifiers: any[] = Array.isArray(item.specifiers) ? item.specifiers : [];
    if (specifiers.length === 0) {
      item.source.value = newSourceValue;
      item.source.raw = JSON.stringify(newSourceValue);
      mutated = true;
      continue;
    }

    const nextSpecs: any[] = [];
    let ok = true;
    for (const spec of specifiers) {
      if (!spec || typeof spec.type !== "string") {
        ok = false;
        break;
      }
      if (spec.type === "ImportDefaultSpecifier") {
        const local = spec.local;
        nextSpecs.push({
          type: "ImportSpecifier",
          span: spec.span,
          local,
          imported: makeImportedIdent(`${prefix}__default`, local),
          isTypeOnly: false,
        });
        continue;
      }
      if (spec.type === "ImportNamespaceSpecifier") {
        const local = spec.local;
        nextSpecs.push({
          type: "ImportSpecifier",
          span: spec.span,
          local,
          imported: makeImportedIdent(`${prefix}__ns`, local),
          isTypeOnly: false,
        });
        continue;
      }
      if (spec.type === "ImportSpecifier") {
        const local = spec.local;
        const imported = spec.imported ?? local;
        const importedName = imported?.value;
        if (typeof importedName !== "string" || importedName.length === 0) {
          ok = false;
          break;
        }
        nextSpecs.push({
          type: "ImportSpecifier",
          span: spec.span,
          local,
          imported: makeImportedIdent(`${prefix}__${importedName}`, imported ?? local),
          isTypeOnly: false,
        });
        continue;
      }
      ok = false;
      break;
    }

    if (!ok) continue;
    item.specifiers = nextSpecs;
    item.source.value = newSourceValue;
    item.source.raw = JSON.stringify(newSourceValue);
    mutated = true;
  }

  if (!mutated) return code;
  try {
    const printed = printSync(ast, { minify: false } as any);
    return printed?.code ?? code;
  } catch {
    return code;
  }
}

function shouldTransform(ext: string, filePath: string): boolean {
  if (!JS_EXTENSIONS.has(ext)) return false;
  return true;
}

/**
 * Compute subpath for dependency registration.
 * Always computes from actual file path for consistency.
 * We ignore pkg.subpath from resolver because it's the logical subpath (".")
 * but we need the physical subpath ("dist/es2015") to match optimizer.
 */
function computeSubpathForDep(fsPath: string, pkg?: any): string | null {
  const computed = computeSubpathFromEntryPath(fsPath);

  // In tests/mocked environments, the dependency path may not exist on disk,
  // so computing a physical subpath will fail. Fall back to resolver-provided
  // logical subpath when available.
  if (!computed && !fs.existsSync(fsPath) && pkg && typeof pkg.subpath === "string") {
    const raw = pkg.subpath;
    const cleaned = raw.replace(/^\.\//, "").replace(/^\/+/, "");
    if (cleaned && cleaned !== "." && cleaned !== "index") {
      return cleaned;
    }
  }
  
  // Debug logging to trace subpath computation
  if (process.env.DEBUG_DEPS) {
    console.log(`[computeSubpathForDep] fsPath: ${fsPath}`);
    console.log(`[computeSubpathForDep] pkg.name: ${pkg?.name}, pkg.subpath: ${pkg?.subpath}`);
    console.log(`[computeSubpathForDep] computed: "${computed}"`);
  }
  
  return computed || null;
}

function looksLikeCjsWrapperSource(source: string): boolean {
  const sample = source.slice(0, 16 * 1024);
  return (
    sample.includes("module.exports") ||
    sample.includes("exports.") ||
    sample.includes("Object.defineProperty(exports") ||
    sample.includes("Object.defineProperty(module.exports") ||
    sample.includes("require(") ||
    sample.includes("require (")
  );
}

function looksLikeEsmSource(source: string): boolean {
  const sample = source.slice(0, 16 * 1024);
  // Heuristic: enough to avoid running the CJS bundler on pure ESM libraries like Radix.
  return (
    sample.includes("import ") ||
    sample.includes("export ") ||
    sample.includes("import{") ||
    sample.includes("export{") ||
    sample.includes("import(")
  );
}

function findNearestPackageJson(filePath: string): string | null {
  let current = path.dirname(filePath);
  for (let i = 0; i < 25; i++) {
    const candidate = path.join(current, "package.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function makeDepsProxyForFile(
  filePath: string,
  code: string,
  rootDir: string,
  recordDepEntry: (entry: DepEntry) => void,
): string | null {
  if (!looksLikeCjsWrapperSource(code)) return null;
  const pkgJsonPath = findNearestPackageJson(filePath);
  if (!pkgJsonPath) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    const depEntry = registerDepEntry({
      entryPath: filePath,
      packageName: pkg?.name ?? "dep",
      packageVersion: pkg?.version ?? "0.0.0",
      // Important: include the physical subpath so stable dep ids remain correct across restarts
      // and match the optimizer's stable id (e.g. react-refresh/runtime must include `__runtime`).
      subpath: computeSubpathForDep(filePath, pkg),
    });
    recordDepEntry(depEntry);
    const fileName = depEntry.fileName;

    // Phase 6.4: No-duplication policy.
    // If this dep wrapper is routed through a vendor-pack-v2 module, prefer re-exporting from the pack
    // instead of `export * from "/@deps/<wrapper>"` (which would force an extra wrapper request).
    const importFileName = getVendorPackV2ImportFileName(rootDir, fileName);
    if (importFileName) {
      const depsHash = process.env.IONIFY_DEPS_HASH;
      const depsRoot = depsHash ? resolveDepsRoot(rootDir, depsHash) : null;
      const wrapperPath = depsRoot ? path.join(depsRoot, fileName) : null;
      let exportNames: string[] = [];
      if (wrapperPath && fs.existsSync(wrapperPath)) {
        try {
          const wrapperCode = fs.readFileSync(wrapperPath, "utf8");
          const names: string[] = [];
          for (const match of wrapperCode.matchAll(
            /export\s+\{\s*__ionify_export_[A-Za-z0-9_$]+\s+as\s+([A-Za-z0-9_$]+)\s*\}\s*;\s*/g,
          )) {
            const name = match[1];
            if (typeof name === "string" && name.length > 0) names.push(name);
          }
          exportNames = names
            .slice()
            .sort()
            .filter((v, i, arr) => i === 0 || arr[i - 1] !== v);
        } catch {
          exportNames = [];
        }
      }

      const memberKey = vendorPackV2MemberKey(fileName);
      const prefix = `__ionify_vp_${memberKey}`;
      const packUrl = `/@deps/${importFileName}`;
      const lines: string[] = [];
      lines.push(`import { ${prefix}__default, ${prefix}__ns } from "${packUrl}";`);
      for (const name of exportNames) {
        lines.push(`import { ${prefix}__${name} as ${name} } from "${packUrl}";`);
      }
      lines.push(`export default ${prefix}__default;`);
      if (exportNames.length > 0) {
        lines.push(`export { ${exportNames.join(", ")} };`);
      }
      lines.push("");
      return lines.join("\n");
    }

    const cg = getFeaturePackChunkGroupId(rootDir, fileName);
    const url = cg ? `/@deps/${fileName}?cg=${encodeURIComponent(cg)}` : `/@deps/${fileName}`;
    return (
      `import __ionify_dep__default, * as __ionify_dep__ns from "${url}";\n` +
      `export default __ionify_dep__default;\n` +
      `export * from "${url}";\n`
    );
  } catch {
    return null;
  }
}

async function swcTranspile(
  code: string,
  filePath: string,
  ext: string,
  reactRefresh: boolean,
): Promise<string> {
  const isTypeScript = ext === ".ts" || ext === ".tsx" || ext === ".mts" || ext === ".cts" || isTypeDeclarationPath(filePath);
  const isTsx = ext === ".tsx";
  const isJsx = ext === ".jsx";

  const swcParser =
    isTypeScript
      ? {
          syntax: "typescript" as const,
          tsx: isTsx,
          decorators: true,
          dynamicImport: true,
          dts: false,
        }
      : {
          syntax: "ecmascript" as const,
          jsx: isJsx,
          decorators: true,
          dynamicImport: true,
        };

	  const result = await swcTransform(code, {
	    filename: runtimeTransformFilename(filePath),
	    jsc: {
	      parser: swcParser,
	      target: "es2022",
	      transform:
	        isTsx || isJsx
	          ? {
	              react: {
	                // Canonical base transform: keep transpiled output consistent across dev/build/test.
	                development: false,
	                runtime: "automatic",
	                ...(reactRefresh ? { refresh: true } : {}),
	              },
	            }
	          : undefined,
	    },
	    sourceMaps: false,
	    module: {
	      type: "es6",
	    },
	  });

  return result.code ?? code;
}

function runtimeTransformFilename(filePath: string): string {
  if (!isTypeDeclarationPath(filePath)) return filePath;
  return filePath
    .replace(/\.d\.ts$/i, ".ts")
    .replace(/\.d\.mts$/i, ".mts")
    .replace(/\.d\.cts$/i, ".cts");
}

function currentMode(): "oxc" | "swc" | "hybrid" {
  const mode = (process.env.IONIFY_PARSER || "hybrid").toLowerCase();
  if (mode === "swc") return "swc";
  if (mode === "oxc") return "oxc";
  return "hybrid";
}

export const jsLoader: Loader = {
  name: "js",
  order: 0,
  test: ({ ext, path: filePath }) => shouldTransform(ext, filePath),
  transform: async ({ path: filePath, code, ext, config }) => {
    const isNodeModules = filePath.includes("node_modules");
    const rewriteDebug = process.env.IONIFY_IMPORT_REWRITE_DEBUG === "1";
    const rootDir = config?.root ? path.resolve(config.root) : process.cwd();
    const dependencyEntries = new Map<string, ReturnType<typeof cacheDepRegistration>>();
    const recordDepEntry = (entry: DepEntry) => {
      dependencyEntries.set(entry.fileName, cacheDepRegistration(entry, rootDir));
    };
    const stateDir =
      process.env.IONIFY_STATE_DIR && path.isAbsolute(process.env.IONIFY_STATE_DIR)
        ? process.env.IONIFY_STATE_DIR
        : null;
    const versionHash = process.env.IONIFY_CONFIG_HASH || null;
    const casRoot = stateDir ? path.join(stateDir, "cas") : null;
    
    let output = code;
    
    // Try native bundler for node_modules files (handles CommonJS, tree-shaking, etc.)
    if (isNodeModules) {
      const depsProxy = makeDepsProxyForFile(filePath, code, rootDir, recordDepEntry);
      if (depsProxy) {
        // Avoid serving obvious CJS wrappers to the browser (even if the extension is .mjs).
        // Route through /@deps/ so the CJS optimizer produces valid browser ESM.
        output = depsProxy;
      } else {
        // Architecture intent: only run the native (CJS-focused) bundler when needed.
        // Pure ESM deps should be served as-is with import rewriting (no bundling).
        const shouldAttemptBundle =
          ext === ".cjs" ||
          looksLikeCjsWrapperSource(code) ||
          (!looksLikeEsmSource(code) && ext !== ".mjs");

        if (shouldAttemptBundle) {
          const bundled = tryBundleNodeModule(filePath, code);
          if (bundled) {
            // Native bundler succeeded - use its ESM output
            output = bundled;
          } else {
            // Native bundler unavailable/failed - use original code as-is
            output = code;
          }
        } else {
          output = code;
        }
      }
    } else {
      // Regular transpilation for user code (non-node_modules).
      // IMPORTANT: base transforms must be consistent across dev/build/test so CAS artifacts are reusable.
      const isDev = process.env.NODE_ENV !== "production";
      const reactRefresh = shouldUseReactRefresh({ ext, code, isDev, config });
      const mode = currentMode();
      const runtimeFilename = runtimeTransformFilename(filePath);
      const isTypeScriptRuntime = ext === ".ts" || ext === ".tsx" || ext === ".mts" || ext === ".cts" || isTypeDeclarationPath(filePath);
      const nativeResult = tryNativeTransform(mode, code, {
        filename: runtimeFilename,
        jsx: ext === ".jsx" || ext === ".tsx",
        typescript: isTypeScriptRuntime,
        react_refresh: false,
      });
      const transpiled = nativeResult ? (nativeResult.code ?? code) : await swcTranspile(code, filePath, ext, false);

      // Populate shared CAS with the canonical base transform (pre-define, pre-import-rewrite, no HMR).
      if (casRoot && versionHash) {
        try {
          const baseHash = getCacheKey(code);
          const baseDir = getCasArtifactPath(casRoot, versionHash, baseHash);
          const baseFile = path.join(baseDir, "transformed.js");
          if (!fs.existsSync(baseFile)) {
            fs.mkdirSync(baseDir, { recursive: true });
            const tmp = `${baseFile}.tmp-${process.pid}`;
            fs.writeFileSync(tmp, transpiled, "utf8");
            fs.renameSync(tmp, baseFile);
          }
        } catch {
          // ignore CAS write errors
        }
      }

      output = transpiled;

      if (isDev && reactRefresh) {
        // Use dedicated instrumentation layer (Phase 5.6.2.1)
        const isEntry = isEntryModule(filePath, config ?? undefined);
        
        // Debug: Log entry detection (enable with IONIFY_REFRESH_DEBUG=1)
        if (process.env.IONIFY_REFRESH_DEBUG === "1") {
          console.log(`[Refresh] ${filePath} → isEntry=${isEntry}, ext=${ext}`);
        }
        
        const result = await instrumentReactRefresh({
          code: output,
          filePath,
          ext,
          isDev,
          isEntry,
        });

        if (process.env.IONIFY_REFRESH_DEBUG === "1") {
          console.log(
            `[Refresh] instrument=${result.shouldInstrument} ${filePath} → isEntry=${isEntry}`,
          );
        }
        
        if (result.shouldInstrument) {
          output = result.prologue + output + result.registrations + result.epilogue;
        } else {
          output += `\nif (import.meta.hot) import.meta.hot.accept();\n`;
        }
      } else if (isDev) {
        output += `\nif (import.meta.hot) {\n  import.meta.hot.accept();\n}\n`;
      }
    }

    // Rewrite imports to resolved paths with query parameters for CSS/assets
    // This applies to ALL files (user code, node_modules ESM, and converted CommonJS)
    await init; // Ensure es-module-lexer is initialized before parsing
    const [imports] = parse(output);
    // Runtime-edge facts are captured from the canonical transformed module
    // before URL/DPL serving rewrites. The persistent graph and production
    // planner consume these facts so compiler-injected imports (automatic JSX
    // runtimes, helpers, future transforms) cannot diverge from emitted code.
    const runtimeDependencies = Array.from(
      new Map(
        imports
          .filter((record) => typeof record.n === "string" && record.n.length > 0)
          .map((record) => {
            const dependency = {
              specifier: record.n!,
              kind: record.t === 2 ? ("dynamic" as const) : ("static" as const),
            };
            return [`${dependency.kind}:${dependency.specifier}`, dependency] as const;
          }),
      ).values(),
    ).sort((a, b) =>
      a.kind === b.kind
        ? a.specifier.localeCompare(b.specifier)
        : a.kind.localeCompare(b.kind),
    );
    if (rewriteDebug && ext === ".mjs" && isNodeModules) {
      console.warn(`[Ionify][rewrite] scanning ${imports.length} import(s) in ${filePath}`);
    }
    if (imports.length) {
      let rewritten = "";
      let lastIndex = 0;
      let mutated = false;

      for (const record of imports) {
        if (!record.n) continue;
        const spec = record.n;
        
        // Skip special imports
        if (spec.startsWith("http://") || spec.startsWith("https://") || spec.startsWith(MODULE_REQUEST_PREFIX)) {
          continue;
        }

        let pathPart = spec;
        let suffix = "";
        const queryIndex = spec.indexOf("?");
        const hashIndex = spec.indexOf("#");
        const splitIndex =
          queryIndex === -1
            ? hashIndex
            : hashIndex === -1
            ? queryIndex
            : Math.min(queryIndex, hashIndex);
        if (splitIndex !== -1) {
          pathPart = spec.slice(0, splitIndex);
          suffix = spec.slice(splitIndex);
        }

        const isBare =
          !pathPart.startsWith(".") &&
          !pathPart.startsWith("/") &&
          !pathPart.startsWith("http://") &&
          !pathPart.startsWith("https://");

        if (isBare && native?.resolveModule) {
          const resolvedNative = native.resolveModule(pathPart, filePath);
          const kind = resolvedNative?.kind;
          const fsPath =
            (resolvedNative as any)?.fsPath ??
            (resolvedNative as any)?.fs_path ??
            null;

          // Package format describes the package boundary, not necessarily the
          // resolved export's artifact kind. A package may validly export CSS
          // (for example `./styles.css`) while the resolver reports `PkgEsm`.
          // Keep that resource on the shared CSSA path instead of registering it
          // as a JavaScript dependency artifact in DPL.
          if (fsPath && isCssLikeExt(path.extname(fsPath))) {
            const replacement =
              publicPathForFile(rootDir, fsPath) + (suffix || "?inline");
            mutated = true;
            if (record.t === 2) {
              rewritten += output.slice(lastIndex, record.s + 1);
              rewritten += replacement;
              rewritten += output[record.e - 1];
              lastIndex = record.e;
            } else {
              rewritten += output.slice(lastIndex, record.s);
              rewritten += replacement;
              lastIndex = record.e;
            }
            continue;
          }
          
          // CJS deps must go through /@deps/ so they become valid browser ESM.
	          if (kind === "PkgCjs" && fsPath) {
	            const pkg = resolvedNative?.pkg;
	            const depEntry = registerDepEntry({
	              entryPath: fsPath,
	              packageName: pkg?.name ?? pathPart,
	              packageVersion: pkg?.version ?? "0.0.0",
	              subpath: computeSubpathForDep(fsPath, pkg),
	            });
	            recordDepEntry(depEntry);
	            const fileName = depEntry.fileName;
	            const cg = getFeaturePackChunkGroupId(rootDir, fileName);
	            const replacement = cg ? `/@deps/${fileName}?cg=${encodeURIComponent(cg)}` : `/@deps/${fileName}`;
	            if (!mutated) {
	              mutated = true;
	            }
            if (record.t === 2) {
              rewritten += output.slice(lastIndex, record.s + 1);
              rewritten += replacement;
              rewritten += output[record.e - 1];
              lastIndex = record.e;
            } else {
              rewritten += output.slice(lastIndex, record.s);
              rewritten += replacement;
              lastIndex = record.e;
            }
            continue;
          }

          // ESM deps can be served directly; just rewrite to an absolute public path.
          // This avoids routing pure ESM (e.g. Radix `.mjs`) through the CJS optimizer,
          // which can produce invalid output for certain patterns.
          if (kind === "PkgEsm" && fsPath) {
            try {
              const resolvedCode = fs.readFileSync(fsPath, "utf8");
	              if (looksLikeCjsWrapperSource(resolvedCode)) {
	                const pkg = resolvedNative?.pkg;
	                const depEntry = registerDepEntry({
	                  entryPath: fsPath,
	                  packageName: pkg?.name ?? pathPart,
	                  packageVersion: pkg?.version ?? "0.0.0",
	                  subpath: computeSubpathForDep(fsPath, pkg),
	                });
	                recordDepEntry(depEntry);
	                const fileName = depEntry.fileName;
	                const cg = getFeaturePackChunkGroupId(rootDir, fileName);
	                const replacement = cg ? `/@deps/${fileName}?cg=${encodeURIComponent(cg)}` : `/@deps/${fileName}`;
	                if (!mutated) mutated = true;
	                if (record.t === 2) {
	                  rewritten += output.slice(lastIndex, record.s + 1);
	                  rewritten += replacement;
                  rewritten += output[record.e - 1];
                  lastIndex = record.e;
                } else {
                  rewritten += output.slice(lastIndex, record.s);
                  rewritten += replacement;
                  lastIndex = record.e;
                }
                continue;
              }
            } catch {
              // If reading fails, route through optimizer anyway
            }

            // Route all ESM through optimizer for nested dependency resolution
            const pkg = resolvedNative?.pkg;
	            const depEntry = registerDepEntry({
	              entryPath: fsPath,
	              packageName: pkg?.name ?? pathPart,
	              packageVersion: pkg?.version ?? "0.0.0",
	              subpath: computeSubpathForDep(fsPath, pkg),
	            });
	            recordDepEntry(depEntry);
	            const fileName = depEntry.fileName;
	            const cg = getFeaturePackChunkGroupId(rootDir, fileName);
	            const replacement = cg ? `/@deps/${fileName}?cg=${encodeURIComponent(cg)}` : `/@deps/${fileName}`;
	            if (!mutated) mutated = true;
	            if (record.t === 2) {
	              rewritten += output.slice(lastIndex, record.s + 1);
	              rewritten += replacement;
              rewritten += output[record.e - 1];
              lastIndex = record.e;
            } else {
              rewritten += output.slice(lastIndex, record.s);
              rewritten += replacement;
              lastIndex = record.e;
            }
            continue;
          }
          
          // Builtin (fs, path, crypto, etc.) and Virtual (HMR client, etc.) don't need rewriting
          if (kind === "Builtin" || kind === "Virtual") {
            continue;
          }
          
          // Only NotFound falls through to TypeScript resolver (for aliases)
        }

        // Resolve the import path (handles aliases, relative paths, etc.)
        const resolved = resolveImport(pathPart, filePath);
        if (!resolved) {
          if (rewriteDebug) {
            console.warn(
              `[Ionify][rewrite] FAILED to resolve '${pathPart}' from '${filePath}'`,
            );
          }
          continue;
        }
        
        // Check file extension from the resolved path
        const resolvedExt = resolved.slice(resolved.lastIndexOf("."));
        let augmentedSuffix = suffix;
        
        // CSS (and preprocessor .scss/.sass/.less/.styl) need ?inline to become JS modules
        // (unless already queried). The preprocessor pre-pass compiles them to CSS.
        if (isCssLikeExt(resolvedExt) && !suffix) {
          augmentedSuffix = "?inline";
        }
        
        // Asset files need ?import to be converted to JS modules (unless already has query)
        const assetExts = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".avif",
                          ".woff", ".woff2", ".ttf", ".otf", ".eot"];
        if (assetExts.includes(resolvedExt) && !suffix) {
          augmentedSuffix = "?import";
        }
        
        const replacementPath = publicPathForFile(rootDir, resolved);
        const replacement = replacementPath + augmentedSuffix;
        if (replacement === spec) continue;
        
        if (!mutated) {
          mutated = true;
        }
        
        // Preserve quotes around the import path
        // es-module-lexer behaves differently for static vs dynamic imports:
        // - Static (type 1): record.s = first char after opening quote, record.e = closing quote
        // - Dynamic (type 2): record.s = opening quote, record.e = char after closing quote
        if (record.t === 2) {
          // Dynamic import: slice includes both quotes
          rewritten += output.slice(lastIndex, record.s + 1); // Keep opening quote
          rewritten += replacement;
          rewritten += output[record.e - 1]; // Add closing quote
          lastIndex = record.e;
        } else {
          // Static import: need to include quote before record.s
          rewritten += output.slice(lastIndex, record.s);
          rewritten += replacement;
          lastIndex = record.e;
        }
      }
      
      if (mutated) {
        rewritten += output.slice(lastIndex);
        output = rewritten;
      } else if (rewriteDebug && isNodeModules) {
        const sample = imports
          .slice(0, 8)
          .map((r) => r.n)
          .filter(Boolean)
          .join(", ");
        console.warn(
          `[Ionify][rewrite] no rewrites applied for ${filePath}; first imports: ${sample}`,
        );
      }
    }

    // Phase 6.3: Vendor pack v2 (few-request mode) rewrite.
    const vendorPacks = (config as any)?.optimizeDeps?.vendorPacks;
    const vendorPackV2Enabled =
      vendorPacks === "auto" || (!!vendorPacks && typeof vendorPacks === "object");
    if (vendorPackV2Enabled) {
      output = rewriteVendorPackV2Imports(output, rootDir);
    }

    return {
      code: output,
      dependencyEntries: Array.from(dependencyEntries.values()).sort((a, b) =>
        a.fileName.localeCompare(b.fileName),
      ),
      runtimeDependencies,
    };
  },
};
