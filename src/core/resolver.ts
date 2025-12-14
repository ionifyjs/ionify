import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { pathToFileURL, fileURLToPath } from "url";
import { native } from "@native/index";

const SUPPORTED_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];
const CONFIG_FILES = ["tsconfig.json", "jsconfig.json"];

type SWCModule = {
  parseSync?: (code: string, options: Record<string, unknown>) => unknown;
};

let swc: SWCModule | null = null;
(() => {
  try {
    const require = createRequire(import.meta.url);
    swc = require("@swc/core");
  } catch {
    swc = null;
  }
})();

export function extractImports(source: string, filename = "inline.ts"): string[] {
  // Try new IR-based parser
  if (native?.parseModuleIr) {
    try {
      const result = native.parseModuleIr(filename, source);
      return result.dependencies.map((dep: any) => dep.specifier);
    } catch {
      // Fall through to fallback
    }
  }

  const deps = new Set<string>();

  const fallbackRegex = () => {
    const re =
      /(?:import\s+(?:[^'"]+\s+from\s+)??['"]([^'"]+)['"])|(?:export\s+[^'"]+\s+from\s+['"]([^'"]+)['"])|(?:import\s*?\(\s*?['"]([^'"]+)['"]\s*?\))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
      const spec = m[1] || m[2] || m[3];
      if (spec) deps.add(spec);
    }
  };

  try {
    const parseSync = swc?.parseSync;
    if (parseSync) {
      const ast = parseSync(source, {
        filename,
        isModule: true,
        target: "es2022",
        syntax: "typescript",
        tsx: true,
        decorators: true,
        dynamicImport: true,
      });

      const visit = (node: unknown) => {
        if (!node || typeof node !== "object") return;

        const anyNode = node as Record<string, unknown>;
        const type = anyNode.type;

        if (type === "ImportDeclaration" && anyNode.source && typeof (anyNode.source as any).value === "string") {
          deps.add((anyNode.source as any).value);
        } else if (type === "ExportAllDeclaration" && anyNode.source && typeof (anyNode.source as any).value === "string") {
          deps.add((anyNode.source as any).value);
        } else if (type === "ExportNamedDeclaration" && anyNode.source && typeof (anyNode.source as any).value === "string") {
          deps.add((anyNode.source as any).value);
        } else if (type === "CallExpression") {
          const callee = (anyNode.callee ?? {}) as Record<string, unknown>;
          if (callee.type === "Import") {
            const args = (anyNode.arguments as any[]) ?? [];
            const first = args[0];
            if (first && typeof first === "object") {
              const expr = (first as any).expression;
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
    // ensure regex fallback runs if parser found nothing (e.g., script)
    fallbackRegex();
  }

  return Array.from(deps);
}

function tryFile(p: string): string | null {
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  return null;
}

function tryWithExt(p: string): string | null {
  // Check exact match first
  if (tryFile(p)) return p;

  // Try adding extensions
  for (const ext of SUPPORTED_EXTS) {
    const cand = p.endsWith(ext) ? p : p + ext;
    const found = tryFile(cand);
    if (found) return found;
  }

  // Try directory index files
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
    // Check package.json first
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
        // Ignore package.json errors and continue with other strategies
      }
    }

    // Try index files
    for (const ext of SUPPORTED_EXTS) {
      const idx = path.join(p, "index" + ext);
      const found = tryFile(idx);
      if (found) return found;
    }
  }

  return null;
}

type AliasEntry = {
  resolveCandidates: (specifier: string) => string[];
};

let cachedTsconfigAliases: AliasEntry[] | null | undefined;
let customAliasEntries: AliasEntry[] = [];
// Simple in-memory memoization for resolved paths to cut repeated work during dev.
// Keyed by `${importerAbs}\u0000${specifier}` to avoid accidental collisions.
const resolvePathCache = new Map<string, string | null>();

function createAliasEntry(pattern: string, targets: string[]): AliasEntry {
  const hasWildcard = pattern.includes("*");
  if (hasWildcard) {
    const escaped = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&");
    const matcher = new RegExp(`^${escaped.replace(/\*/g, "(.*)")}$`);
    return {
      resolveCandidates(specifier: string) {
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
      },
    };
  }

  const normalizedPattern = pattern.endsWith("/")
    ? pattern.slice(0, -1)
    : pattern;

  return {
    resolveCandidates(specifier: string) {
      if (specifier === normalizedPattern) {
        return targets;
      }
      if (normalizedPattern && specifier.startsWith(normalizedPattern + "/")) {
        const remainder = specifier.slice(normalizedPattern.length + 1);
        return targets.map((target) => path.join(target, remainder));
      }
      return [];
    },
  };
}

function buildAliasEntries(
  aliases: Record<string, string | string[]>,
  baseDir: string
): AliasEntry[] {
  const entries: AliasEntry[] = [];
  for (const [pattern, value] of Object.entries(aliases)) {
    const replacements = Array.isArray(value) ? value : [value];
    const targets = replacements
      .filter((rep) => typeof rep === "string" && rep.trim().length > 0)
      .map((rep) =>
        path.isAbsolute(rep) ? rep : path.resolve(baseDir, rep)
      );
    if (!targets.length) continue;
    entries.push(createAliasEntry(pattern, targets));
  }
  return entries;
}

function loadTsconfigAliases(): AliasEntry[] {
  if (cachedTsconfigAliases !== undefined) {
    return cachedTsconfigAliases ?? [];
  }

  const rootDir = process.cwd();
  for (const configName of CONFIG_FILES) {
    const candidate = path.resolve(rootDir, configName);
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
      continue;
    }
    try {
      const raw = fs.readFileSync(candidate, "utf8");
      const parsed = JSON.parse(raw);
      const compilerOptions = parsed?.compilerOptions ?? {};
      const baseUrl = compilerOptions.baseUrl
        ? path.resolve(path.dirname(candidate), compilerOptions.baseUrl)
        : path.dirname(candidate);
      const paths = compilerOptions.paths ?? {};
      cachedTsconfigAliases = buildAliasEntries(paths, baseUrl);
      return cachedTsconfigAliases;
    } catch {
      // ignore malformed config and continue
    }
  }

  cachedTsconfigAliases = [];
  return cachedTsconfigAliases;
}

function resolveFromEntries(entries: AliasEntry[], specifier: string): string | null {
  for (const entry of entries) {
    const candidates = entry.resolveCandidates(specifier);
    for (const candidate of candidates) {
      const resolved = tryWithExt(candidate);
      if (resolved) return resolved;
    }
  }
  return null;
}

function resolveWithAliases(specifier: string): string | null {
  const custom = resolveFromEntries(customAliasEntries, specifier);
  if (custom) return custom;
  const tsconfigEntries = loadTsconfigAliases();
  return resolveFromEntries(tsconfigEntries, specifier);
}

export function configureResolverAliases(
  aliases: Record<string, string | string[]> | undefined,
  baseDir: string
) {
  customAliasEntries = aliases ? buildAliasEntries(aliases, baseDir) : [];
}

export function resetResolverAliasCache() {
  customAliasEntries = [];
  cachedTsconfigAliases = undefined;
  resolvePathCache.clear();
}

/** Resolve a module specifier to an absolute path. */
export function resolveImport(specifier: string, importerAbs: string): string | null {
  const cacheKey = `${importerAbs}\u0000${specifier}`;
  if (resolvePathCache.has(cacheKey)) {
    // Return cached resolution (including null misses to avoid rework on not-found)
    return resolvePathCache.get(cacheKey) ?? null;
  }
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    // Try alias resolution first
    const aliasResolved = resolveWithAliases(specifier);
    if (aliasResolved) {
      resolvePathCache.set(cacheKey, aliasResolved);
      return aliasResolved;
    }

    try {
      // Try commonjs resolution
      const require = createRequire(importerAbs);
      const resolved = require.resolve(specifier);
      resolvePathCache.set(cacheKey, resolved);
      return resolved;
    } catch {
      try {
        // Try native ESM resolution
        const importerUrl = pathToFileURL(importerAbs).href;
        const resolvedUrl = import.meta.resolve(specifier, importerUrl);
        if (resolvedUrl.startsWith("file://")) {
          const resolved = fileURLToPath(resolvedUrl);
          resolvePathCache.set(cacheKey, resolved);
          return resolved;
        }
        resolvePathCache.set(cacheKey, resolvedUrl);
        return resolvedUrl;
      } catch {
        // Fallback resolution steps:
        // 1. Try node_modules
        const nodeModulesPath = path.join(path.dirname(importerAbs), "node_modules", specifier);
        const resolvedNodeModules = tryWithExt(nodeModulesPath);
        if (resolvedNodeModules) {
          resolvePathCache.set(cacheKey, resolvedNodeModules);
          return resolvedNodeModules;
        }
        
        // 2. Try src-relative path (for projects following src/ convention)
        const srcPath = path.join(process.cwd(), "src", specifier);
        const resolvedSrc = tryWithExt(srcPath);
        if (resolvedSrc) {
          resolvePathCache.set(cacheKey, resolvedSrc);
          return resolvedSrc;
        }
        
        // 3. Try workspace root-relative path
        const rootPath = path.join(process.cwd(), specifier);
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

/** Resolve many deps to absolute paths (filtering nulls/duplicates). */
export function resolveImports(specs: string[], importerAbs: string): string[] {
  const abs = specs
    .map((s) => resolveImport(s, importerAbs))
    .filter((x): x is string => !!x);
  return Array.from(new Set(abs));
}

