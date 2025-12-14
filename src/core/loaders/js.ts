import { transform as swcTransform } from "@swc/core";
import { init, parse } from "es-module-lexer";
import type { Loader } from "@core/transform";
import { resolveImport } from "@core/resolver";
import { publicPathForFile, MODULE_REQUEST_PREFIX } from "@core/utils/public-path";
import { tryBundleNodeModule, tryNativeTransform } from "@native/index";

const JS_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);

function needsReactRefresh(ext: string) {
  if (ext === ".jsx" || ext === ".tsx") return true;
  if (!ext.endsWith("x")) return false;
  return false;
}

function shouldTransform(ext: string, filePath: string): boolean {
  if (!JS_EXTENSIONS.has(ext)) return false;
  if (filePath.endsWith(".d.ts")) return false;
  return true;
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
  transform: async ({ path: filePath, code, ext }) => {
    const isNodeModules = filePath.includes("node_modules");
    
    let output = code;
    
    // Try native bundler for node_modules files (handles CommonJS, tree-shaking, etc.)
    if (isNodeModules) {
      const bundled = tryBundleNodeModule(filePath, code);
      if (bundled) {
        // Native bundler succeeded - use its ESM output
        output = bundled;
      } else {
        // Native bundler unavailable/failed - use original code as-is
        // (may fail in browser if it's CommonJS, but that's expected without bundler)
        output = code;
      }
    } else {
      // Regular transpilation for user code (non-node_modules)
      const reactRefresh = needsReactRefresh(ext);
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
        const prologue =
          `import { setupReactRefresh } from "/__ionify_react_refresh.js";\n` +
          `const __ionifyRefresh__ = setupReactRefresh(import.meta.hot, import.meta.url);\n`;
        const epilogue = `\n__ionifyRefresh__?.finalize?.();\n\nif (import.meta.hot) {\n  import.meta.hot.accept((newModule) => {\n    __ionifyRefresh__?.refresh?.(newModule);\n  });\n  import.meta.hot.dispose(() => {\n    __ionifyRefresh__?.dispose?.();\n  });\n}\n`;
        output = prologue + output + epilogue;
      } else {
        output += `\nif (import.meta.hot) {\n  import.meta.hot.accept();\n}\n`;
      }
    }

    // Rewrite imports to resolved paths with query parameters for CSS/assets
    // This applies to ALL files (user code, node_modules ESM, and converted CommonJS)
    await init;
    const [imports] = parse(output);
    if (imports.length) {
      const rootDir = process.cwd();
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

        // Resolve the import path
        const resolved = resolveImport(pathPart, filePath);
        if (!resolved) continue;
        
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
      }
    }

    return { code: output };
  },
};
