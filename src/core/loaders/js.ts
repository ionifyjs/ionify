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

import { transform as swcTransform } from "@swc/core";
import { init, parse } from "es-module-lexer";
import type { Loader } from "@core/transform";
import { resolveImport } from "@core/resolver";
import { publicPathForFile, MODULE_REQUEST_PREFIX } from "@core/utils/public-path";
import { native, tryBundleNodeModule, tryNativeTransform } from "@native/index";
import { registerDepEntry, computeSubpathFromEntryPath } from "@core/deps/registry";
import { instrumentReactRefresh } from "@core/refresh/reactRefreshInstrumentation";
import { isEntryModule } from "@core/refresh/entryDetection";
import { shouldUseReactRefresh } from "@core/refresh/refreshEligibility";
import fs from "fs";
import path from "path";

// Must include ESM/CJS variants from node_modules (e.g. Radix ships .mjs),
// otherwise bare imports like "react" won't be rewritten and the browser will throw.
const JS_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);

function shouldTransform(ext: string, filePath: string): boolean {
  if (!JS_EXTENSIONS.has(ext)) return false;
  if (filePath.endsWith(".d.ts")) return false;
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

function makeDepsProxyForFile(filePath: string, code: string): string | null {
  if (!looksLikeCjsWrapperSource(code)) return null;
  const pkgJsonPath = findNearestPackageJson(filePath);
  if (!pkgJsonPath) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    const fileName = registerDepEntry({
      entryPath: filePath,
      packageName: pkg?.name ?? "dep",
      packageVersion: pkg?.version ?? "0.0.0",
      subpath: null,
    }).fileName;
    return (
      `import * as __ionify_dep__ from "/@deps/${fileName}";\n` +
      `export default __ionify_dep__;\n` +
      `export * from "/@deps/${fileName}";\n`
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
  const isTypeScript = ext === ".ts" || ext === ".tsx";
  const isTsx = ext === ".tsx";
  const isJsx = ext === ".jsx";

  const swcParser =
    isTypeScript
      ? {
          syntax: "typescript" as const,
          tsx: isTsx,
          decorators: true,
          dynamicImport: true,
        }
      : {
          syntax: "ecmascript" as const,
          jsx: isJsx,
          decorators: true,
          dynamicImport: true,
        };

  const result = await swcTransform(code, {
    filename: filePath,
    jsc: {
      parser: swcParser,
      target: "es2022",
      transform: reactRefresh
        ? {
            react: {
              development: true,
              refresh: true,
              runtime: "automatic",
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
    
    let output = code;
    
    // Try native bundler for node_modules files (handles CommonJS, tree-shaking, etc.)
    if (isNodeModules) {
      const depsProxy = makeDepsProxyForFile(filePath, code);
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
      // Regular transpilation for user code (non-node_modules)
      const isDev = process.env.NODE_ENV !== "production";
      const reactRefresh = shouldUseReactRefresh({ ext, code, isDev, config });
      const mode = currentMode();
      const nativeResult = tryNativeTransform(mode, code, {
        filename: filePath,
        jsx: ext === ".jsx" || ext === ".tsx",
        typescript: ext === ".ts" || ext === ".tsx",
        react_refresh: reactRefresh,
      });
      if (nativeResult) {
        output = nativeResult.code ?? code;
      } else {
        output = await swcTranspile(code, filePath, ext, reactRefresh);
      }

      if (reactRefresh) {
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
      } else {
        output += `\nif (import.meta.hot) {\n  import.meta.hot.accept();\n}\n`;
      }
    }

    // Rewrite imports to resolved paths with query parameters for CSS/assets
    // This applies to ALL files (user code, node_modules ESM, and converted CommonJS)
    await init; // Ensure es-module-lexer is initialized before parsing
    const [imports] = parse(output);
    if (rewriteDebug && ext === ".mjs" && isNodeModules) {
      console.warn(`[Ionify][rewrite] scanning ${imports.length} import(s) in ${filePath}`);
    }
    if (imports.length) {
      const rootDir = config?.root ? path.resolve(config.root) : process.cwd();
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
          
          // CJS deps must go through /@deps/ so they become valid browser ESM.
          if (kind === "PkgCjs" && fsPath) {
            const pkg = resolvedNative?.pkg;
            const fileName = registerDepEntry({
              entryPath: fsPath,
              packageName: pkg?.name ?? pathPart,
              packageVersion: pkg?.version ?? "0.0.0",
              subpath: computeSubpathForDep(fsPath, pkg),
            }).fileName;
            const replacement = `/@deps/${fileName}`;
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
                const fileName = registerDepEntry({
                  entryPath: fsPath,
                  packageName: pkg?.name ?? pathPart,
                  packageVersion: pkg?.version ?? "0.0.0",
                  subpath: computeSubpathForDep(fsPath, pkg),
                }).fileName;
                const replacement = `/@deps/${fileName}`;
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
            const fileName = registerDepEntry({
              entryPath: fsPath,
              packageName: pkg?.name ?? pathPart,
              packageVersion: pkg?.version ?? "0.0.0",
              subpath: computeSubpathForDep(fsPath, pkg),
            }).fileName;
            const replacement = `/@deps/${fileName}`;
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
        
        // CSS files need ?inline to be converted to JS modules (unless already has query)
        if (resolvedExt === ".css" && !suffix) {
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

    return { code: output };
  },
};
